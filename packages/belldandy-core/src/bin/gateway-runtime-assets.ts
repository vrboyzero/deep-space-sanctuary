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

export const DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT = 20;

export type RuntimeMethodAssetSummaryLoadResult = {
  summaries: RuntimeMethodAssetSummary[];
  totalCount: number;
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

function compareByUpdatedAtDesc(
  left: { updatedAt?: number; name: string },
  right: { updatedAt?: number; name: string },
): number {
  const leftUpdatedAt = left.updatedAt ?? 0;
  const rightUpdatedAt = right.updatedAt ?? 0;
  if (rightUpdatedAt !== leftUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }
  return compareByLocale(left.name, right.name);
}

function resolveSkillPath(skill: SkillDefinition): string {
  if (skill.source.type === "user") {
    return path.join(skill.source.path, skill.name, "SKILL.md");
  }
  if (skill.source.type === "plugin") {
    return `plugin:${skill.source.pluginId}/skills/${skill.name}/SKILL.md`;
  }
  return `bundled:${skill.name}`;
}

async function readSkillUpdatedAt(skill: SkillDefinition): Promise<number | undefined> {
  if (skill.source.type !== "user") {
    return undefined;
  }
  try {
    const stat = await fs.stat(resolveSkillPath(skill));
    return stat.mtimeMs;
  } catch {
    return undefined;
  }
}

export async function loadRuntimeMethodAssetSummaries(
  stateDir: string,
  maxItems = DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT,
): Promise<RuntimeMethodAssetSummaryLoadResult> {
  const methodsDir = path.join(stateDir, "methods");
  try {
    const files = await fs.readdir(methodsDir, { withFileTypes: true });
    const mdFiles = await Promise.all(
      files
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map(async (entry) => {
          const filePath = path.join(methodsDir, entry.name);
          const stat = await fs.stat(filePath);
          return {
            name: entry.name,
            path: filePath,
            updatedAt: stat.mtimeMs,
          };
        }),
    );

    const selectedFiles = mdFiles
      .sort((left, right) => compareByUpdatedAtDesc(left, right))
      .slice(0, Math.max(0, maxItems));

    const summaries = await Promise.all(selectedFiles.map(async (file) => {
      const raw = await fs.readFile(file.path, "utf-8");
      const parsed = parseMethodContent(raw);
      return {
        fileName: file.name,
        path: path.join("methods", file.name).replaceAll("\\", "/"),
        title: parsed.title,
        summary: parsed.metadata.summary,
        status: parsed.metadata.status,
        updatedAt: file.updatedAt,
      } satisfies RuntimeMethodAssetSummary;
    }));

    return {
      summaries,
      totalCount: mdFiles.length,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return {
        summaries: [],
        totalCount: 0,
      };
    }
    throw error;
  }
}

export function buildRuntimeSkillAssetSummaries(
  skills: readonly SkillDefinition[],
  maxItems = DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT,
): Promise<RuntimeSkillAssetSummary[]> {
  return Promise.all(
    skills.map(async (skill) => ({
      skill,
      path: resolveSkillPath(skill),
      updatedAt: await readSkillUpdatedAt(skill),
    })),
  ).then((items) => items
    .sort((left, right) => {
      const priorityDelta = SKILL_PRIORITY_ORDER[left.skill.priority] - SKILL_PRIORITY_ORDER[right.skill.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return compareByUpdatedAtDesc(
        { updatedAt: left.updatedAt, name: left.skill.name },
        { updatedAt: right.updatedAt, name: right.skill.name },
      );
    })
    .slice(0, Math.max(0, maxItems))
    .map(({ skill, path: skillPath, updatedAt }) => ({
      name: skill.name,
      description: skill.description,
      priority: skill.priority,
      source: summarizeSkillSource(skill),
      path: skillPath.replaceAll("\\", "/"),
      tags: skill.tags ? [...skill.tags] : [],
      updatedAt,
    })));
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

export function resolveRecommendedMethodNames(
  preferredMethods: readonly string[] | undefined,
  availableMethods: readonly RuntimeMethodAssetSummary[],
  maxItems = 4,
): string[] {
  if (!preferredMethods || preferredMethods.length === 0) {
    return [];
  }
  const availableNames = new Set(availableMethods.map((method) => method.fileName));
  return preferredMethods
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && availableNames.has(item))
    .slice(0, Math.max(0, maxItems));
}
