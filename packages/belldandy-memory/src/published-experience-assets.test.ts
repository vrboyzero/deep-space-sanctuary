import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  buildVirtualCandidateFromPublishedAsset,
  listPublishedAssets,
} from "./published-experience-assets.js";

test("published method assets with Chinese filenames get stable distinct virtual ids", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-published-assets-"));
  try {
    const methodsDir = path.join(stateDir, "methods");
    await fs.mkdir(methodsDir, { recursive: true });
    await fs.writeFile(path.join(methodsDir, "方法论编写-撰写-指南.md"), "# 方法论编写\n", "utf-8");
    await fs.writeFile(path.join(methodsDir, "网页自动化-操作-基础.md"), "# 网页自动化\n", "utf-8");

    const assets = listPublishedAssets(stateDir, "method");
    expect(assets).toHaveLength(2);

    const virtualIds = assets.map((asset) => buildVirtualCandidateFromPublishedAsset({ asset }).id);
    expect(new Set(virtualIds).size).toBe(2);
    expect(virtualIds.every((id) => /^virtual:method:md-[a-f0-9]{10}$/.test(id))).toBe(true);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
