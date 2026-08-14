import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { replaceFileWithRetry } from "./atomic-file-replace.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("replaceFileWithRetry", () => {
  it("retries a transient rename failure without changing the replacement bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-atomic-replace-"));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, "state.tmp");
    const targetPath = path.join(root, "state.json");
    await Promise.all([
      fs.writeFile(sourcePath, "replacement\n", "utf-8"),
      fs.writeFile(targetPath, "started\n", "utf-8"),
    ]);
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

    await replaceFileWithRetry(sourcePath, targetPath);

    expect(attempts).toBe(2);
    await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("replacement\n");
  });

  it("does not retry a non-transient rename failure", async () => {
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(
      Object.assign(new Error("persistent rename failure"), { code: "EIO" }),
    );

    await expect(replaceFileWithRetry("source.tmp", "target.json"))
      .rejects.toThrow("persistent rename failure");

    expect(renameSpy).toHaveBeenCalledTimes(1);
  });
});
