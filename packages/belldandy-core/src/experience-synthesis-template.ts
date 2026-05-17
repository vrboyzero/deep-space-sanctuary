import fs from "node:fs/promises";
import path from "node:path";

import type { ExperienceCandidateType } from "@belldandy/memory";

export async function resolveExperienceSynthesisTemplateInfo(
  stateDir: string,
  type: ExperienceCandidateType,
): Promise<{ id: string; path: string | null }> {
  const resolved = await resolveExperienceSynthesisTemplate(stateDir, type, { includeContent: false });
  return {
    id: resolved.id,
    path: resolved.path,
  };
}

export async function resolveExperienceSynthesisTemplate(
  stateDir: string,
  type: ExperienceCandidateType,
  options: { includeContent?: boolean } = {},
): Promise<{ id: string; path: string | null; content: string }> {
  const fileName = type === "skill" ? "skill-synthesis.md" : "method-synthesis.md";
  const candidatePaths = [
    path.join(stateDir, "experience-templates", fileName),
    path.resolve(process.cwd(), "docs", "experience-templates", fileName),
  ];
  for (const candidatePath of candidatePaths) {
    const content = await fs.readFile(candidatePath, "utf-8").catch(() => "");
    if (!content.trim()) {
      continue;
    }
    return {
      id: `${type}-synthesis`,
      path: candidatePath,
      content: options.includeContent === false ? "" : content,
    };
  }
  throw new Error(`Experience synthesis template not found for ${type}. Checked: ${candidatePaths.join(" | ")}`);
}

export function extractExperienceTemplateMarkdownSkeleton(templateContent: string): string | null {
  const matched = String(templateContent ?? "").match(/```(?:md|markdown)\s*([\s\S]*?)```/i);
  const skeleton = matched?.[1]?.trim();
  return skeleton ? skeleton : null;
}
