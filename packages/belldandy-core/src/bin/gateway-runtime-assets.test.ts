import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SkillDefinition } from "@belldandy/skills";

import {
  buildRuntimeSkillAssetSummaries,
  DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT,
  loadRuntimeMethodAssetSummaries,
} from "./gateway-runtime-assets.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeMethodFile(filePath: string, input: {
  title: string;
  summary: string;
  status?: string;
  updatedAt: Date;
}): Promise<void> {
  const content = [
    "---",
    `summary: ${input.summary}`,
    input.status ? `status: ${input.status}` : undefined,
    "---",
    `# ${input.title}`,
    "",
    "## Purpose",
    input.summary,
    "",
  ].filter(Boolean).join("\n");
  await fs.writeFile(filePath, content, "utf-8");
  await fs.utimes(filePath, input.updatedAt, input.updatedAt);
}

function createUserSkill(input: {
  rootDir: string;
  name: string;
  description: string;
  priority: SkillDefinition["priority"];
}): SkillDefinition {
  return {
    name: input.name,
    description: input.description,
    priority: input.priority,
    instructions: `Use ${input.name}`,
    source: { type: "user", path: input.rootDir },
    tags: [],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("gateway runtime asset summaries", () => {
  it("loads methods by updated time descending and returns total count", async () => {
    const stateDir = await createTempDir("gateway-methods-");
    const methodsDir = path.join(stateDir, "methods");
    await fs.mkdir(methodsDir, { recursive: true });

    await writeMethodFile(path.join(methodsDir, "older.md"), {
      title: "旧方法",
      summary: "旧方法摘要",
      status: "draft",
      updatedAt: new Date("2026-05-17T10:00:00.000Z"),
    });
    await writeMethodFile(path.join(methodsDir, "newer.md"), {
      title: "新方法",
      summary: "新方法摘要",
      status: "active",
      updatedAt: new Date("2026-05-18T10:00:00.000Z"),
    });

    const result = await loadRuntimeMethodAssetSummaries(stateDir, 1);

    expect(result.totalCount).toBe(2);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]).toMatchObject({
      fileName: "newer.md",
      path: "methods/newer.md",
      title: "新方法",
      summary: "新方法摘要",
      status: "active",
    });
  });

  it("sorts user skill summaries by priority first and recent update second", async () => {
    const skillsRoot = await createTempDir("gateway-skills-");

    const alphaDir = path.join(skillsRoot, "alpha-skill");
    const betaDir = path.join(skillsRoot, "beta-skill");
    const gammaDir = path.join(skillsRoot, "gamma-skill");
    await fs.mkdir(alphaDir, { recursive: true });
    await fs.mkdir(betaDir, { recursive: true });
    await fs.mkdir(gammaDir, { recursive: true });
    await fs.writeFile(path.join(alphaDir, "SKILL.md"), "---\nname: alpha-skill\ndescription: alpha\n---\nalpha", "utf-8");
    await fs.writeFile(path.join(betaDir, "SKILL.md"), "---\nname: beta-skill\ndescription: beta\n---\nbeta", "utf-8");
    await fs.writeFile(path.join(gammaDir, "SKILL.md"), "---\nname: gamma-skill\ndescription: gamma\n---\ngamma", "utf-8");
    await fs.utimes(path.join(alphaDir, "SKILL.md"), new Date("2026-05-18T09:00:00.000Z"), new Date("2026-05-18T09:00:00.000Z"));
    await fs.utimes(path.join(betaDir, "SKILL.md"), new Date("2026-05-18T11:00:00.000Z"), new Date("2026-05-18T11:00:00.000Z"));
    await fs.utimes(path.join(gammaDir, "SKILL.md"), new Date("2026-05-18T08:00:00.000Z"), new Date("2026-05-18T08:00:00.000Z"));

    const result = await buildRuntimeSkillAssetSummaries([
      createUserSkill({
        rootDir: skillsRoot,
        name: "alpha-skill",
        description: "alpha",
        priority: "normal",
      }),
      createUserSkill({
        rootDir: skillsRoot,
        name: "beta-skill",
        description: "beta",
        priority: "always",
      }),
      createUserSkill({
        rootDir: skillsRoot,
        name: "gamma-skill",
        description: "gamma",
        priority: "normal",
      }),
    ], DEFAULT_METHOD_SKILL_ASSET_SUMMARY_LIMIT);

    expect(result.map((item) => item.name)).toEqual([
      "beta-skill",
      "alpha-skill",
      "gamma-skill",
    ]);
    expect(result[0]?.path.replaceAll("\\", "/")).toContain("/beta-skill/SKILL.md");
  });
});
