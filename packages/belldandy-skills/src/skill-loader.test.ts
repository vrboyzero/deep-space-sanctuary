import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_SKILL_FILE_BYTES, loadSkillFromDir } from "./skill-loader.js";

const SKILL_PREFIX = Buffer.from([
  "---",
  "name: bounded-skill",
  "description: bounded skill fixture",
  "priority: always",
  "---",
  "",
].join("\n"), "utf-8");

function createSkillFile(totalBytes: number, useUtf8 = false): Buffer {
  const bodyBytes = totalBytes - SKILL_PREFIX.byteLength;
  if (bodyBytes <= 0) {
    throw new Error("Skill fixture is smaller than its frontmatter.");
  }
  if (!useUtf8) {
    return Buffer.concat([SKILL_PREFIX, Buffer.alloc(bodyBytes, 0x61)]);
  }

  const utf8Unit = Buffer.from("你", "utf-8");
  const unitCount = Math.floor(bodyBytes / utf8Unit.byteLength);
  const remainder = bodyBytes - unitCount * utf8Unit.byteLength;
  return Buffer.concat([
    SKILL_PREFIX,
    Buffer.from("你".repeat(unitCount), "utf-8"),
    Buffer.alloc(remainder, 0x61),
  ]);
}

describe("skill loader byte limits", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts limit-1 and limit files but rejects limit+1 without logging content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sizes = [MAX_SKILL_FILE_BYTES - 1, MAX_SKILL_FILE_BYTES, MAX_SKILL_FILE_BYTES + 1];
    const results = [];

    for (const size of sizes) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `belldandy-skill-loader-${size}-`));
      tempDirs.push(dir);
      await fs.writeFile(path.join(dir, "SKILL.md"), createSkillFile(size));
      results.push(await loadSkillFromDir(dir, { type: "bundled" }));
    }

    expect(results[0]?.name).toBe("bounded-skill");
    expect(results[1]?.name).toBe("bounded-skill");
    expect(results[2]).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(`${MAX_SKILL_FILE_BYTES} bytes`);
    expect(warn.mock.calls[0]?.[0]).not.toContain("aaaa");
  });

  it("applies the exact limit to UTF-8 bytes rather than JavaScript characters", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-skill-loader-utf8-"));
    tempDirs.push(dir);
    const content = createSkillFile(MAX_SKILL_FILE_BYTES, true);
    await fs.writeFile(path.join(dir, "SKILL.md"), content);

    const skill = await loadSkillFromDir(dir, { type: "bundled" });

    expect(content.byteLength).toBe(MAX_SKILL_FILE_BYTES);
    expect(skill?.instructions).toContain("你");
  });
});
