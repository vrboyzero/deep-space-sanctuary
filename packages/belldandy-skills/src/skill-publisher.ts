import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExperienceCandidate } from "@belldandy/memory";
import type { SkillRegistry } from "./skill-registry.js";
import { parseSkillMd } from "./skill-loader.js";

export function getUserSkillsDir(stateDir: string): string {
  return path.join(stateDir, "skills");
}

export async function publishSkillCandidate(
  candidate: ExperienceCandidate,
  stateDir: string,
  registry?: SkillRegistry | null,
  options: {
    publishedPath?: string;
    skillName?: string;
  } = {},
): Promise<string> {
  const skillsDir = getUserSkillsDir(stateDir);
  await fs.mkdir(skillsDir, { recursive: true });

  const prepared = prepareSkillCandidateForPublish(candidate, options.skillName);
  const filePath = options.publishedPath
    ? options.publishedPath
    : await resolveSkillPublishPath(skillsDir, candidate, prepared.dirName);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, prepared.content, "utf-8");

  if (registry) {
    await registry.loadUserSkills(skillsDir);
  }

  return filePath;
}

async function resolveSkillPublishPath(skillsDir: string, candidate: ExperienceCandidate, baseDirName: string): Promise<string> {
  if (candidate.publishedPath) {
    return candidate.publishedPath;
  }

  const taskToken = normalizeAsciiToken(candidate.taskId, "task");
  const candidateToken = normalizeAsciiToken(candidate.id, "candidate");
  const candidateDirs = [
    baseDirName,
    `${baseDirName}-${taskToken}`,
    `${baseDirName}-${candidateToken}`,
  ];

  for (const dirName of candidateDirs) {
    const filePath = path.join(skillsDir, dirName, "SKILL.md");
    if (!(await pathExists(filePath))) {
      return filePath;
    }
  }

  return path.join(skillsDir, `${baseDirName}-${candidateToken}-${Date.now()}`, "SKILL.md");
}

function prepareSkillCandidateForPublish(
  candidate: ExperienceCandidate,
  explicitSkillName?: string,
): { dirName: string; content: string } {
  const issues = validateSkillCandidateDraftForPublish(candidate.content);
  if (issues.length > 0) {
    throw new Error(`Skill candidate publish validation failed: ${issues.join("；")}`);
  }

  const parsed = parseSkillMd(candidate.content, { type: "user", path: "candidate" });
  const title = readFirstMarkdownTitle(candidate.content);
  const canonicalName = buildCanonicalSkillName({
    explicitName: explicitSkillName,
    name: parsed.name,
    title,
    slug: candidate.slug,
    fallback: candidate.taskId,
  });

  return {
    dirName: canonicalName,
    content: rewriteSkillName(candidate.content, canonicalName),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeAsciiToken(value: string, fallback: string): string {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function rewriteSkillName(content: string, canonicalName: string): string {
  if (/(^---\r?\n[\s\S]*?\r?\n---)/.test(content)) {
    return content.replace(
      /(^---\r?\n[\s\S]*?^name:\s*)(["']?)([^"\r\n']+)(\2)(\s*$)/m,
      (_match, prefix, _quoteA, _value, _quoteB, suffix) => `${prefix}"${canonicalName}"${suffix}`,
    );
  }
  return content;
}

function buildCanonicalSkillName(input: {
  explicitName?: string;
  name?: string;
  title?: string;
  slug?: string;
  fallback: string;
}): string {
  const candidates = [
    input.explicitName,
    input.name,
    String(input.slug ?? "").replace(/^skill-/i, ""),
    input.title,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSkillMachineName(candidate);
    if (!normalized || normalized === "skill" || normalized === "task" || normalized === "candidate" || normalized === "draft") {
      continue;
    }
    return normalized;
  }

  return `skill-${normalizeAsciiToken(input.fallback, "task")}`;
}

function normalizeSkillMachineName(value: string | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/\/skill\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return normalized;
}

function readFirstMarkdownTitle(content: string): string | undefined {
  return String(content ?? "").match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function validateSkillCandidateDraftForPublish(content: string): string[] {
  const issues: string[] = [];
  const requiredHeadings = [
    "## 快速开始",
    "## 决策路由",
    "## 输入",
    "## 输出",
    "## 参考指引",
    "## NEVER",
  ];

  if (!readFirstMarkdownTitle(content)) {
    issues.push("缺少一级标题（# 标题）。");
  }
  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) {
      issues.push(`缺少必需章节：${heading}`);
    }
  }
  if (!/(?:^|\n)name:\s*["']?[^"\n']+["']?/i.test(content)) {
    issues.push("缺少 frontmatter.name。");
  }
  if (!/(?:^|\n)description:\s*["']?[^"\n']+["']?/i.test(content)) {
    issues.push("缺少 frontmatter.description。");
  }
  return issues;
}
