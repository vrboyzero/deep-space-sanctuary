import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRuntimeDependencyStoreSnapshot,
  createRuntimeDependencyStoreSnapshot,
} from "./runtime-dependency-store-snapshot-policy.mjs";

const cleanupRoots = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })));
});

async function createStoreFixture() {
  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "star-runtime-store-snapshot-"));
  cleanupRoots.push(storeRoot);
  const contentRoot = path.join(storeRoot, "v10", "files", "aa");
  await fs.mkdir(contentRoot, { recursive: true });
  const payloadPath = path.join(contentRoot, "payload");
  await fs.writeFile(payloadPath, "runtime-store-a\n", "utf-8");
  return { storeRoot, payloadPath };
}

describe("runtime dependency store snapshot policy", () => {
  it("rejects a same-length prefetched store content replacement", async () => {
    const { storeRoot, payloadPath } = await createStoreFixture();
    const snapshot = await createRuntimeDependencyStoreSnapshot(storeRoot);

    await fs.writeFile(payloadPath, "runtime-store-b\n", "utf-8");

    await expect(assertRuntimeDependencyStoreSnapshot(snapshot, storeRoot))
      .rejects.toThrow(/entriesSha256/i);
  });

  it("ignores volatile checkedAt values in pnpm index metadata", async () => {
    const { storeRoot } = await createStoreFixture();
    const indexRoot = path.join(storeRoot, "v10", "index", "aa");
    const indexPath = path.join(indexRoot, "package.json");
    await fs.mkdir(indexRoot, { recursive: true });
    await fs.writeFile(indexPath, JSON.stringify({
      name: "fixture",
      files: {
        "index.js": {
          checkedAt: 100,
          integrity: "sha512-fixture",
          size: 16,
        },
      },
    }), "utf-8");
    const first = await createRuntimeDependencyStoreSnapshot(storeRoot);

    await fs.writeFile(indexPath, JSON.stringify({
      files: {
        "index.js": {
          size: 16,
          integrity: "sha512-fixture",
          checkedAt: 200,
        },
      },
      name: "fixture",
    }), "utf-8");
    const second = await createRuntimeDependencyStoreSnapshot(storeRoot);

    expect(second).toEqual(first);
  });
});
