import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  validateInstalledRuntimeVersion,
  type PortableVersionFile,
  type RuntimeManifest,
} from "./runtime-manifest.js";

const tempDirs: string[] = [];

function sha256(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function createValidationFixture(): Promise<{
  versionRoot: string;
  dataPath: string;
  sourceVersionFile: PortableVersionFile;
  sourceRuntimeManifest: RuntimeManifest;
}> {
  const versionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-manifest-validation-"));
  tempDirs.push(versionRoot);
  const runtimeRoot = path.join(versionRoot, "runtime");
  const dataPath = path.join(runtimeRoot, "data.bin");
  const data = Buffer.alloc(128 * 1024 + 17, 0x61);
  const sourceRuntimeManifest: RuntimeManifest = {
    productName: "Star Sanctuary",
    version: "0.5.4",
    distributionMode: "slim",
    platform: process.platform,
    arch: process.arch,
    builtAt: "2026-07-17T00:00:00.000Z",
    includeOptionalNative: false,
    runtimeDir: "runtime",
    summary: {
      fileCount: 1,
      totalSize: data.length,
    },
    files: [{
      path: "data.bin",
      type: "file",
      size: data.length,
      sha256: sha256(data),
    }],
  };
  const manifestText = JSON.stringify(sourceRuntimeManifest);
  const sourceVersionFile: PortableVersionFile = {
    productName: "Star Sanctuary",
    version: "0.5.4",
    distributionMode: "slim",
    platform: process.platform,
    arch: process.arch,
    builtAt: "2026-07-17T00:00:00.000Z",
    includeOptionalNative: false,
    runtimeDir: "runtime",
    entryScript: "runtime/packages/belldandy-core/dist/bin/gateway.js",
    runtimeSummary: { ...sourceRuntimeManifest.summary },
    files: {
      runtimeManifest: {
        path: "runtime-manifest.json",
        size: Buffer.byteLength(manifestText),
        sha256: sha256(manifestText),
      },
    },
  };

  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, data);
  await fs.writeFile(path.join(versionRoot, "runtime-manifest.json"), manifestText, "utf-8");
  await fs.writeFile(path.join(versionRoot, "version.json"), JSON.stringify(sourceVersionFile), "utf-8");
  for (const relativePath of [
    "runtime/packages/belldandy-core/dist/bin/gateway.js",
    "runtime/apps/web/public/index.html",
    "runtime/templates/AGENTS.md",
  ]) {
    const filePath = path.join(versionRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "fixture", "utf-8");
  }

  return { versionRoot, dataPath, sourceVersionFile, sourceRuntimeManifest };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("installed runtime manifest validation", () => {
  it("streams large runtime file hashes without whole-file reads", async () => {
    const fixture = await createValidationFixture();
    const readFileSpy = vi.spyOn(fsSync, "readFileSync");

    try {
      expect(validateInstalledRuntimeVersion(fixture)).toMatchObject({ ok: true });
      expect(readFileSpy.mock.calls.some(([filePath]) => path.resolve(String(filePath)) === fixture.dataPath)).toBe(false);
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("keeps same-size runtime content tampering detectable", async () => {
    const fixture = await createValidationFixture();
    await fs.writeFile(fixture.dataPath, Buffer.alloc(128 * 1024 + 17, 0x62));

    expect(validateInstalledRuntimeVersion(fixture)).toMatchObject({
      ok: false,
      reason: "runtime_manifest_entry_mismatch",
      invalidPaths: [expect.objectContaining({ path: "data.bin", reason: "sha256_mismatch" })],
    });
  });
});
