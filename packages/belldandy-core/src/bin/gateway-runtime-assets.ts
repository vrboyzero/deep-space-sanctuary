import fs from "node:fs/promises";
import path from "node:path";

import {
  parseMethodContent,
  type SkillDefinition,
} from "@belldandy/skills";

import type {
  RuntimeMethodAssetSummary,
  RuntimeSkillAssetSummary,
} from "./gateway-prompt-sections.js";

const SKILL_PRIORITY_ORDER: Record<SkillDefinition["priority"], number> = {
  always: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function compareByLocale(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN");
}

function summarizeSkillSource(skill: SkillDefinition): string {
  if (skill.source.type === "plugin") {
    return `plugin:${skill.source.pluginId}`;
  }
  return skill.source.type;
}

export async function loadRuntimeMethodAssetSummaries(
  stateDir: string,
  maxItems = 4,
): Promise<RuntimeMethodAssetSummary[]> {
  const methodsDir = path.join(stateDir, "methods");
  try {
    const files = await fs.readdir(methodsDir, { withFileTypes: true });
    const mdFiles = files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort(compareByLocale)
      .slice(0, Math.max(0, maxItems));

    const summaries = await Promise.all(mdFiles.map(async (fileName) => {
      const raw = await fs.readFile(path.join(methodsDir, fileName), "utf-8");
      const parsed = parseMethodContent(raw);
      return {
        fileName,
        title: parsed.title,
        summary: parsed.metadata.summary,
        status: parsed.metadata.status,
      } satisfies RuntimeMethodAssetSummary;
    }));

    return summaries;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function buildRuntimeSkillAssetSummaries(
  skills: readonly SkillDefinition[],
  maxItems = 6,
): RuntimeSkillAssetSummary[] {
  return [...skills]
    .sort((left, right) => {
      const priorityDelta = SKILL_PRIORITY_ORDER[left.priority] - SKILL_PRIORITY_ORDER[right.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return compareByLocale(left.name, right.name);
    })
    .slice(0, Math.max(0, maxItems))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      priority: skill.priority,
      source: summarizeSkillSource(skill),
      tags: skill.tags ? [...skill.tags] : [],
    }));
}

export function resolveRecommendedSkillNames(
  preferredSkills: readonly string[] | undefined,
  availableSkills: readonly SkillDefinition[],
  maxItems = 4,
): string[] {
  if (!preferredSkills || preferredSkills.length === 0) {
    return [];
  }
  const availableNames = new Set(availableSkills.map((skill) => skill.name));
  return preferredSkills
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && availableNames.has(item))
    .slice(0, Math.max(0, maxItems));
}
