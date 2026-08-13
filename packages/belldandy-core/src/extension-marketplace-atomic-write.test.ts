import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { atomicWriteMarketplaceJson } from "./extension-marketplace-atomic-write.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("atomicWriteMarketplaceJson", () => {
  it("retries a transient Windows rename failure", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-atomic-"));
    tempDirs.push(directory);
    const targetPath = path.join(directory, "state.json");
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

    await atomicWriteMarketplaceJson(targetPath, { version: 1 });

    expect(attempts).toBe(2);
    await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe(JSON.stringify({ version: 1 }, null, 2));
  });

  it("does not retry non-transient failures and removes the temporary file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-atomic-"));
    tempDirs.push(directory);
    const targetPath = path.join(directory, "state.json");
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async () => {
      const error = new Error("persistent rename failure") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    });

    await expect(atomicWriteMarketplaceJson(targetPath, { version: 1 }))
      .rejects.toThrow("persistent rename failure");

    expect(renameSpy).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });
});
