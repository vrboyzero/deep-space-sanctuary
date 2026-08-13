import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { atomicWriteGoalJson, atomicWriteGoalText } from "./atomic-write.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("goal atomic writes", () => {
  it("retries transient Windows rename failures and preserves content formats", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-atomic-"));
    tempDirs.push(directory);
    const jsonPath = path.join(directory, "state.json");
    const textPath = path.join(directory, "report.md");
    const originalRename = fs.rename.bind(fs);
    let attempts = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("transient rename failure") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await originalRename(source, target);
    });

    await atomicWriteGoalJson(jsonPath, { version: 1 });
    await atomicWriteGoalText(textPath, "# Report\n");

    expect(attempts).toBe(3);
    await expect(fs.readFile(jsonPath, "utf-8")).resolves.toBe(JSON.stringify({ version: 1 }, null, 2));
    await expect(fs.readFile(textPath, "utf-8")).resolves.toBe("# Report\n");
  });

  it("does not retry non-transient failures and removes the temporary file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-atomic-"));
    tempDirs.push(directory);
    const targetPath = path.join(directory, "state.json");
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async () => {
      const error = new Error("persistent rename failure") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    });

    await expect(atomicWriteGoalJson(targetPath, { version: 1 }))
      .rejects.toThrow("persistent rename failure");

    expect(renameSpy).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });
});
