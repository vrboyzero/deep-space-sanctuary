/**
 * Skill 注册表
 *
 * 汇总三个来源的 skills：bundled / user / plugin
 * 提供统一的发现、查询、eligibility 过滤 API。
 */

import type { SkillDefinition, EligibilityContext, EligibilityResult } from "./skill-types.js";
import { loadSkillsFromDir } from "./skill-loader.js";
import { checkEligibilityBatch } from "./skill-eligibility.js";

/** 内部存储键：source:name */
function makeKey(skill: SkillDefinition): string {
  return `${sourceScopeKey(skill.source)}:${skill.name}`;
}

function sourceScopeKey(source: SkillDefinition["source"]): string {
  if (source.type === "plugin") {
    return `plugin:${source.pluginId}`;
  }
  return source.type;
}

const SKILL_SOURCE_PRECEDENCE: Record<SkillDefinition["source"]["type"], number> = {
  bundled: 0,
  plugin: 1,
  user: 2,
};

export type SkillRegistryInventoryEntry = {
  name: string;
  source: SkillDefinition["source"]["type"];
  pluginId?: string;
  priority: SkillDefinition["priority"];
};

export type SkillRegistryInventory = {
  catalogGeneration: number;
  totalSkillCount: number;
  sourceCounts: Record<SkillDefinition["source"]["type"], number>;
  shadowedNames: string[];
  entries: SkillRegistryInventoryEntry[];
};

export class SkillRegistryRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillRegistryRegistrationError";
  }
}

let globalSkillRegistry: SkillRegistry | null = null;

export function registerGlobalSkillRegistry(registry: SkillRegistry): void {
  globalSkillRegistry = registry;
}

export function getGlobalSkillRegistry(): SkillRegistry | null {
  return globalSkillRegistry;
}

export class SkillRegistry {
  /** 所有已加载的 skills（key = source:name） */
  private skills = new Map<string, SkillDefinition>();

  /** 最近一次 eligibility 检查结果缓存 */
  private eligibilityCache = new Map<string, EligibilityResult>();
  private catalogGeneration = 0;

  // ========================================================================
  // 加载
  // ========================================================================

  /** 加载内置 skills（随项目发布） */
  async loadBundledSkills(dir: string): Promise<number> {
    const source = { type: "bundled" } as const;
    const loaded = await loadSkillsFromDir(dir, source, { requireDirectory: true });
    this.commitLoadedSources([{ source, skills: loaded }]);
    return loaded.length;
  }

  /** 加载用户 skills（~/.star_sanctuary/skills/ 默认目录） */
  async loadUserSkills(dir: string): Promise<number> {
    const source = { type: "user", path: dir } as const;
    const loaded = await loadSkillsFromDir(dir, source);
    this.commitLoadedSources([{ source, skills: loaded }]);
    return loaded.length;
  }

  /** 加载插件附带的 skills */
  async loadPluginSkills(dirs: Map<string, string[]>): Promise<number> {
    const loadedSources: Array<{ source: Extract<SkillDefinition["source"], { type: "plugin" }>; skills: SkillDefinition[] }> = [];
    for (const [pluginId, pluginDirs] of dirs) {
      const source = { type: "plugin", pluginId } as const;
      const skills: SkillDefinition[] = [];
      for (const dir of pluginDirs) {
        skills.push(...await loadSkillsFromDir(dir, source, { requireDirectory: true }));
      }
      loadedSources.push({ source, skills });
    }
    this.commitLoadedSources(loadedSources);
    return loadedSources.reduce((count, item) => count + item.skills.length, 0);
  }

  // ========================================================================
  // 查询
  // ========================================================================

  /** 列出所有已加载的 skills */
  listSkills(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  /** 按 user > plugin > bundled 解析每个名称唯一生效的 Skill。 */
  listActiveSkills(): SkillDefinition[] {
    const activeByName = new Map<string, SkillDefinition>();
    for (const skill of this.skills.values()) {
      const current = activeByName.get(skill.name);
      if (!current || SKILL_SOURCE_PRECEDENCE[skill.source.type] > SKILL_SOURCE_PRECEDENCE[current.source.type]) {
        activeByName.set(skill.name, skill);
      }
    }
    return [...activeByName.values()];
  }

  /**
   * 按名称获取 skill
   * 优先级：user > plugin > bundled
   */
  getSkill(name: string): SkillDefinition | undefined {
    return this.listActiveSkills().find((skill) => skill.name === name);
  }

  /** 获取已加载的 skill 数量 */
  get size(): number {
    return this.skills.size;
  }

  /** Returns the loaded source/name inventory without hiding source-priority shadows. */
  getRegistryInventory(): SkillRegistryInventory {
    const sourceCounts: SkillRegistryInventory["sourceCounts"] = {
      bundled: 0,
      user: 0,
      plugin: 0,
    };
    const nameCounts = new Map<string, number>();
    const entries = this.listSkills()
      .map((skill) => {
        sourceCounts[skill.source.type] += 1;
        nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1);
        return {
          name: skill.name,
          source: skill.source.type,
          ...(skill.source.type === "plugin" ? { pluginId: skill.source.pluginId } : {}),
          priority: skill.priority,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source));

    return {
      catalogGeneration: this.catalogGeneration,
      totalSkillCount: entries.length,
      sourceCounts,
      shadowedNames: Array.from(nameCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
        .sort((left, right) => left.localeCompare(right)),
      entries,
    };
  }

  // ========================================================================
  // Eligibility
  // ========================================================================

  /**
   * 执行 eligibility 检查并缓存结果
   */
  async refreshEligibility(ctx: EligibilityContext): Promise<void> {
    const active = this.listActiveSkills();
    const results = await checkEligibilityBatch(active, ctx, makeKey);
    this.eligibilityCache = results;
  }

  /** 获取所有通过 eligibility 检查的 skills */
  getEligibleSkills(): SkillDefinition[] {
    return this.listActiveSkills().filter(s => {
      const result = this.getEligibilityForSkill(s);
      return result ? result.eligible : true; // 未检查的默认 eligible
    });
  }

  /** 获取某个 skill 的 eligibility 结果 */
  getEligibilityResult(name: string): EligibilityResult | undefined {
    const selected = this.getSkill(name);
    return selected ? this.getEligibilityForSkill(selected) : this.eligibilityCache.get(name);
  }

  /**
   * 获取需要直接注入 system prompt 的 skills
   * 规则：eligible + priority 为 always 或 high
   */
  getPromptSkills(): SkillDefinition[] {
    return this.getEligibleSkills().filter(
      s => s.priority === "always" || s.priority === "high",
    );
  }

  /**
   * 获取可通过 skills_search 按需发现的 skills（eligible 但不直接注入）
   */
  getSearchableSkills(): SkillDefinition[] {
    return this.getEligibleSkills().filter(
      s => s.priority !== "always" && s.priority !== "high",
    );
  }

  /**
   * 搜索 skills（按关键词匹配 name / description / tags / instructions）
   */
  searchSkills(query: string): SkillDefinition[] {
    const q = query.toLowerCase();
    // 空格分词（帮英文多词查询），过滤空串
    const tokens = q.split(/\s+/).filter(t => t.length > 0);
    const eligible = this.getEligibleSkills();

    /** 双向包含：field.includes(q) || q.includes(field) */
    const biMatch = (field: string, keyword: string): boolean =>
      field.includes(keyword) || keyword.includes(field);

    const scoreOne = (skill: SkillDefinition, keyword: string): number => {
      let s = 0;
      if (biMatch(skill.name.toLowerCase(), keyword)) s += 10;
      if (biMatch(skill.description.toLowerCase(), keyword)) s += 5;
      if (skill.tags?.some(t => biMatch(t.toLowerCase(), keyword))) s += 8;
      if (skill.instructions.toLowerCase().includes(keyword)) s += 2;
      return s;
    };

    return eligible
      .map(skill => {
        let score = scoreOne(skill, q);
        // 分词后每个 token 单独匹配，累加得分
        if (tokens.length > 1) {
          for (const token of tokens) {
            score += scoreOne(skill, token);
          }
        }
        return { skill, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.skill);
  }

  private getEligibilityForSkill(skill: SkillDefinition): EligibilityResult | undefined {
    // The raw-name fallback preserves tests and integrations that populated the old cache shape.
    return this.eligibilityCache.get(makeKey(skill)) ?? this.eligibilityCache.get(skill.name);
  }

  private commitLoadedSources(sources: Array<{ source: SkillDefinition["source"]; skills: SkillDefinition[] }>): void {
    if (sources.length === 0) {
      return;
    }

    const scopesToReplace = new Set(sources.map((item) => sourceScopeKey(item.source)));
    const next = new Map(
      Array.from(this.skills.entries()).filter(([, skill]) => !scopesToReplace.has(sourceScopeKey(skill.source))),
    );
    const pluginNameOwners = new Map<string, string>();
    for (const skill of next.values()) {
      if (skill.source.type === "plugin") {
        pluginNameOwners.set(skill.name, skill.source.pluginId);
      }
    }

    for (const { source, skills } of sources) {
      const names = new Set<string>();
      for (const skill of skills) {
        if (names.has(skill.name)) {
          throw new SkillRegistryRegistrationError(`Duplicate skill registration: ${skill.name}`);
        }
        names.add(skill.name);
        if (source.type === "plugin") {
          const owner = pluginNameOwners.get(skill.name);
          if (owner && owner !== source.pluginId) {
            throw new SkillRegistryRegistrationError(`Duplicate plugin skill registration: ${skill.name}`);
          }
          pluginNameOwners.set(skill.name, source.pluginId);
        }
      }
    }

    for (const { skills } of sources) {
      for (const skill of skills) {
        next.set(makeKey(skill), skill);
      }
    }
    this.skills = next;
    this.eligibilityCache.clear();
    this.catalogGeneration += 1;
  }
}
