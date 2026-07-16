import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillRegistry } from "./skill-registry.js";

async function writeSkill(root: string, directory: string, name: string): Promise<void> {
  const skillDir = path.join(root, directory);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${name} description`,
      "priority: normal",
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
