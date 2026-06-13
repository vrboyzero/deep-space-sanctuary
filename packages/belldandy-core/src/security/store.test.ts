import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readAllowlistStore, readPairingStore, writePairingStore } from "./store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe("security store", () => {
  it("falls back to direct write when rename reports ENOENT", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-security-store-"));
    tempDirs.push(stateDir);

    const renameSpy = vi.spyOn(fs.promises, "rename").mockRejectedValue(Object.assign(new Error("missing temp file"), {
      code: "ENOENT",
    }));

    await writePairingStore(stateDir, {
      version: 1,
      pending: [
        {
          clientId: "client-1",
          code: "ABC23456",
          createdAt: "2026-04-17T00:00:00.000Z",
        },
      ],
    });

    expect(renameSpy).toHaveBeenCalled();
    await expect(readPairingStore(stateDir)).resolves.toMatchObject({
      pending: [
        expect.objectContaining({
          clientId: "client-1",
          code: "ABC23456",
        }),
      ],
    });
  });

  it("throws and warns when allowlist JSON is malformed", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-security-store-invalid-json-"));
    tempDirs.push(stateDir);
    await fs.promises.writeFile(path.join(stateDir, "allowlist.json"), "{not-json", "utf-8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(readAllowlistStore(stateDir)).rejects.toThrow(/allowlist\.json/i);
    expect(warnSpy).toHaveBeenCalledWith(
      "[security/store] Failed to read JSON store; refusing silent fallback.",
      expect.objectContaining({
        filePath: expect.stringMatching(/allowlist\.json$/),
      }),
    );
  });
});
