import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillRegistry } from "./skill-registry.js";

async function writeSkill(
  root: string,
  directory: string,
  name: string,
  options: {
    priority?: "low" | "normal" | "high" | "always";
    eligibilityFiles?: string[];
  } = {},
): Promise<void> {
  const skillDir = path.join(root, directory);
  await fs.mkdir(skillDir, { recursive: true });
  const eligibilityLines = options.eligibilityFiles && options.eligibilityFiles.length > 0
    ? ["eligibility:", `  files: [${options.eligibilityFiles.join(", ")}]`]
    : [];
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${name} description`,
      `priority: ${options.priority ?? "normal"}`,
      ...eligibilityLines,
      "---",
      `${name} instructions`,
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("SkillRegistry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("rejects duplicate names within one source without partially mutating the registry", async () => {
    const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-duplicate-"));
    tempDirs.push(bundledDir);
    await writeSkill(bundledDir, "first", "shared-skill");
    await writeSkill(bundledDir, "second", "shared-skill");

    const registry = new SkillRegistry();
    await expect(registry.loadBundledSkills(bundledDir))
      .rejects.toThrow(/Duplicate skill registration: shared-skill/);
    expect(registry.size).toBe(0);
  });

  it("keeps the documented user-over-bundled compatibility boundary visible in inventory", async () => {
    const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-bundled-"));
    const userDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-user-"));
    tempDirs.push(bundledDir, userDir);
    await writeSkill(bundledDir, "bundled", "shared-skill");
    await writeSkill(userDir, "user", "shared-skill");

    const registry = new SkillRegistry();
    await registry.loadBundledSkills(bundledDir);
    await registry.loadUserSkills(userDir);

    expect(registry.getSkill("shared-skill")?.source).toEqual({ type: "user", path: userDir });
    expect(registry.getRegistryInventory()).toMatchObject({
      totalSkillCount: 2,
      catalogGeneration: 2,
      shadowedNames: ["shared-skill"],
    });
  });

  it("classifies only the active source and never falls back to a shadowed eligible skill", async () => {
    const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-active-bundled-"));
    const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-active-plugin-"));
    const userDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-active-user-"));
    const emptyUserDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-active-empty-user-"));
    tempDirs.push(bundledDir, pluginDir, userDir, emptyUserDir);
    await writeSkill(bundledDir, "bundled", "active-shared", { priority: "always" });
    await writeSkill(pluginDir, "plugin", "active-shared", { priority: "always" });
    await writeSkill(userDir, "user", "active-shared", {
      priority: "always",
      eligibilityFiles: ["missing-active-skill-marker"],
    });

    const registry = new SkillRegistry();
    await registry.loadBundledSkills(bundledDir);
    await registry.loadPluginSkills(new Map([["plugin-one", [pluginDir]]]));
    await registry.loadUserSkills(userDir);
    await registry.refreshEligibility({
      registeredTools: [],
      activeMcpServers: [],
      workspaceRoot: userDir,
    });

    expect(registry.listSkills()).toHaveLength(3);
    expect(registry.listActiveSkills()).toHaveLength(1);
    expect(registry.getSkill("active-shared")?.source.type).toBe("user");
    expect(registry.getEligibilityResult("active-shared")).toEqual({
      eligible: false,
      reasons: ["missing file: missing-active-skill-marker"],
    });
    expect(registry.getEligibleSkills()).toEqual([]);
    expect(registry.getPromptSkills()).toEqual([]);
    expect(registry.searchSkills("active-shared")).toEqual([]);

    // Reloading an empty user source reveals the plugin owner without exposing bundled duplicates.
    await registry.loadUserSkills(emptyUserDir);
    await registry.refreshEligibility({
      registeredTools: [],
      activeMcpServers: [],
      workspaceRoot: userDir,
    });
    expect(registry.getSkill("active-shared")?.source).toEqual({ type: "plugin", pluginId: "plugin-one" });
    expect(registry.getEligibleSkills()).toEqual([expect.objectContaining({ name: "active-shared" })]);
    expect(registry.getPromptSkills()).toEqual([expect.objectContaining({ name: "active-shared" })]);
  });

  it("accepts a missing optional user directory but rejects an invalid declared plugin directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-dir-"));
    tempDirs.push(root);
    const registry = new SkillRegistry();

    await expect(registry.loadUserSkills(path.join(root, "missing-user-skills"))).resolves.toBe(0);
    const missingPluginSource = new Map<string, string[]>([
      ["plugin-one", [path.join(root, "missing-plugin-skills")]],
    ]);
    await expect(registry.loadPluginSkills(missingPluginSource))
      .rejects.toThrow(/Invalid required skill directory/);
  });

  it("rejects the same skill name from different plugins", async () => {
    const firstDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-plugin-one-"));
    const secondDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-registry-plugin-two-"));
    tempDirs.push(firstDir, secondDir);
    await writeSkill(firstDir, "first", "plugin-shared");
    await writeSkill(secondDir, "second", "plugin-shared");

    const registry = new SkillRegistry();
    await registry.loadPluginSkills(new Map<string, string[]>([["plugin-one", [firstDir]]]));
    await expect(registry.loadPluginSkills(new Map<string, string[]>([["plugin-two", [secondDir]]])))
      .rejects.toThrow(/Duplicate plugin skill registration: plugin-shared/);
    expect(registry.size).toBe(1);
  });
});
