import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { ensurePortableRuntime } from "./portable-runtime.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "star-portable-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("portable runtime", () => {
  it("keeps the missing payload error when a compressed runtime asset is absent", async () => {
    const portableRoot = await createTempDir();
    const payloadRoot = path.join(portableRoot, "payload");
    await fs.mkdir(path.join(payloadRoot, "runtime-files"), { recursive: true });
    await fs.writeFile(path.join(payloadRoot, "version.json"), JSON.stringify({
      productName: "Star Sanctuary",
      version: "0.2.4",
      platform: process.platform,
      arch: process.arch,
      builtAt: "2026-04-20T00:00:00.000Z",
      includeOptionalNative: false,
      runtimeDir: "runtime",
      entryScript: "runtime/packages/belldandy-core/dist/bin/gateway.js",
    }), "utf-8");
    await fs.writeFile(path.join(payloadRoot, "runtime-manifest.json"), JSON.stringify({
      productName: "Star Sanctuary",
      version: "0.2.4",
      platform: process.platform,
      arch: process.arch,
      builtAt: "2026-04-20T00:00:00.000Z",
      includeOptionalNative: false,
      runtimeDir: "runtime",
      summary: {
        fileCount: 1,
        totalSize: 12,
      },
      files: [
        {
          path: "packages/belldandy-core/dist/bin/gateway.js",
          type: "file",
          size: 12,
          sha256: "a".repeat(64),
        },
      ],
    }), "utf-8");

    await expect(() => ensurePortableRuntime({ portableRoot })).toThrow(
      "Portable recovery payload is missing packages/belldandy-core/dist/bin/gateway.js",
    );
  });

  it("rejects an unsafe recovery manifest before creating portable runtime files", async () => {
    const portableRoot = await createTempDir();
    const payloadRoot = path.join(portableRoot, "payload");
    await fs.mkdir(path.join(payloadRoot, "runtime-files"), { recursive: true });
    await fs.writeFile(path.join(payloadRoot, "version.json"), JSON.stringify({
      productName: "Star Sanctuary",
      version: "0.2.4",
      platform: process.platform,
      arch: process.arch,
      builtAt: "2026-04-20T00:00:00.000Z",
      includeOptionalNative: false,
      runtimeDir: "runtime",
      entryScript: "runtime/packages/belldandy-core/dist/bin/gateway.js",
    }), "utf-8");
    await fs.writeFile(path.join(payloadRoot, "runtime-manifest.json"), JSON.stringify({
      productName: "Star Sanctuary",
      version: "0.2.4",
      platform: process.platform,
      arch: process.arch,
      builtAt: "2026-04-20T00:00:00.000Z",
      includeOptionalNative: false,
      runtimeDir: "runtime",
      summary: {
        fileCount: 1,
        totalSize: 12,
      },
      files: [
        {
          path: "../outside.js",
          type: "file",
          size: 12,
          sha256: "a".repeat(64),
        },
      ],
    }), "utf-8");

    expect(() => ensurePortableRuntime({ portableRoot })).toThrow(/unsafe runtime relative path/i);
    await expect(fs.access(path.join(portableRoot, "runtime"))).rejects.toThrow();
  });
});
