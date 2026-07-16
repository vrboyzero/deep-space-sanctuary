/**
 * SKILL.md 解析器
 *
 * 从目录加载 SKILL.md 文件，解析 YAML frontmatter + Markdown 指令。
 * 轻量实现，不依赖外部 YAML 库。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { SkillDefinition, SkillSource, SkillPriority, SkillEligibility } from "./skill-types.js";

const SKILL_FILENAME = "SKILL.md";

export class SkillDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillDirectoryError";
  }
}

export type LoadSkillsFromDirOptions = {
  /** Missing user-owned directories are optional; declared bundled/plugin directories are not. */
  requireDirectory?: boolean;
};

/**
 * 从单个目录加载一个 Skill
 */
export async function loadSkillFromDir(
  dirPath: string,
  source: SkillSource,
): Promise<SkillDefinition | null> {
  const filePath = path.join(dirPath, SKILL_FILENAME);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  try {
    return parseSkillMd(content, source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[skill-loader] Failed to parse ${filePath}: ${msg}`);
    return null;
  }
}

/**
 * 扫描目录下的所有子目录，逐个加载 Skill
 */
export async function loadSkillsFromDir(
  parentDir: string,
  source: SkillSource,
  options: LoadSkillsFromDirOptions = {},
): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    const stat = await fs.stat(parentDir);
    if (!stat.isDirectory()) {
      throw new SkillDirectoryError(`Invalid required skill directory: ${parentDir} is not a directory.`);
    }
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" && !options.requireDirectory) {
      return skills;
    }
    if (error instanceof SkillDirectoryError) {
      throw error;
    }
    throw new SkillDirectoryError(
      `Invalid required skill directory: ${parentDir} (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = await loadSkillFromDir(path.join(parentDir, entry.name), source);
    if (skill) skills.push(skill);
  }
  return skills;
}

// ============================================================================
// SKILL.md 解析
// ============================================================================

/**
 * 解析 SKILL.md 内容（YAML frontmatter + Markdown body）
 */
export function parseSkillMd(raw: string, source: SkillSource): SkillDefinition {
  const { frontmatter, body } = splitFrontmatter(raw);
  if (!frontmatter) {
    throw new Error("Missing YAML frontmatter (--- delimiters)");
  }

  const meta = parseSimpleYaml(frontmatter);

  const name = requireString(meta, "name");
  const description = requireString(meta, "description");
  const version = optionalString(meta, "version");
  const tags = optionalStringArray(meta, "tags");
  const priority = parsePriority(optionalString(meta, "priority"));
  const eligibility = parseEligibility(meta.eligibility);

  const instructions = body.trim();
  if (!instructions) {
    throw new Error("SKILL.md body (instructions) is empty");
  }

  return { name, description, version, tags, priority, eligibility, instructions, source };
}

// ============================================================================
// Frontmatter 分割
// ============================================================================

function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: null, body: raw };
  }

  const endIdx = trimmed.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter: null, body: raw };
  }

  const frontmatter = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4); // skip "\n---"
  return { frontmatter, body };
}

// ============================================================================
// 轻量 YAML 子集解析（支持 string / string[] / nested object）
// ============================================================================

type YamlValue = string | string[] | { [key: string]: YamlValue };

function parseSimpleYaml(text: string): Record<string, YamlValue> {
  const lines = text.split("\n");
  return parseYamlBlock(lines, 0, 0).result;
}

function parseYamlBlock(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): { result: Record<string, YamlValue>; endIdx: number } {
  const result: Record<string, YamlValue> = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    // skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < baseIndent) break; // dedented → parent block

    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const valueRaw = trimmed.slice(colonIdx + 1).trim();

    if (valueRaw === "|" || valueRaw === ">") {
      // YAML 块标量（literal | 或 folded >）— 将多行内容拼接为字符串
      const nextNonEmpty = findNextNonEmptyLine(lines, i + 1);
      if (nextNonEmpty !== -1) {
        const nextIndent = lines[nextNonEmpty].length - lines[nextNonEmpty].trimStart().length;
        if (nextIndent > indent) {
          // 收集所有属于该块标量的行（缩进大于当前 key 的缩进）
          const blockLines: string[] = [];
          let j = i + 1;
          while (j < lines.length) {
            const bLine = lines[j];
            // 空行保留（块标量中的空行是内容的一部分）
            if (bLine.trim() === "") {
              blockLines.push("");
              j++;
              continue;
            }
            const bIndent = bLine.length - bLine.trimStart().length;
            if (bIndent < nextIndent) break; // 回到父级缩进，块结束
            // 去掉块内容的公共缩进
            blockLines.push(bLine.slice(nextIndent));
            j++;
          }
          // 移除末尾空行（YAML block scalar 语义）
          while (blockLines.length > 0 && blockLines[blockLines.length - 1] === "") {
            blockLines.pop();
          }
          result[key] = blockLines.join("\n");
          i = j;
          continue;
        }
      }
      result[key] = "";
      i++;
    } else if (valueRaw === "") {
      // 空值 — 尝试解析为嵌套对象（mapping）
      const nextNonEmpty = findNextNonEmptyLine(lines, i + 1);
      if (nextNonEmpty !== -1) {
        const nextIndent = lines[nextNonEmpty].length - lines[nextNonEmpty].trimStart().length;
        if (nextIndent > indent) {
          const sub = parseYamlBlock(lines, i + 1, nextIndent);
          result[key] = sub.result;
          i = sub.endIdx;
          continue;
        }
      }
      result[key] = "";
      i++;
    } else if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      // inline array: [a, b, c]
      const inner = valueRaw.slice(1, -1);
      result[key] = inner
        .split(",")
        .map(s => stripQuotes(s.trim()))
        .filter(s => s.length > 0);
      i++;
    } else {
      result[key] = stripQuotes(valueRaw);
      i++;
    }
  }

  return { result, endIdx: i };
}

function findNextNonEmptyLine(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ============================================================================
// 字段提取辅助
// ============================================================================

function requireString(obj: Record<string, YamlValue>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || !v) {
    throw new Error(`Missing required field: ${key}`);
  }
  return v;
}

function optionalString(obj: Record<string, YamlValue>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function optionalStringArray(obj: Record<string, YamlValue>, key: string): string[] | undefined {
  const v = obj[key];
  if (Array.isArray(v)) return v;
  return undefined;
}

function parsePriority(raw: string | undefined): SkillPriority {
  if (!raw) return "normal";
  const valid: SkillPriority[] = ["low", "normal", "high", "always"];
  if (valid.includes(raw as SkillPriority)) return raw as SkillPriority;
  return "normal";
}

function parseEligibility(raw: YamlValue | undefined): SkillEligibility | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const obj = raw as Record<string, YamlValue>;
  const result: SkillEligibility = {};
  let hasAny = false;

  for (const key of ["env", "bin", "mcp", "tools", "files"] as const) {
    const v = obj[key];
    if (Array.isArray(v) && v.length > 0) {
      result[key] = v;
      hasAny = true;
    }
  }

  return hasAny ? result : undefined;
}
