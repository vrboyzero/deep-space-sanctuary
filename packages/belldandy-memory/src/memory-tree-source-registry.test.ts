import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryManager } from "./manager.js";

describe("memory tree source registry integration", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("persists source registry metadata for inventory and dynamic sources", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tree-source-registry-"));
    cleanupDirs.add(stateDir);
    const sessionsDir = path.join(stateDir, "sessions");
    const docsDir = path.join(stateDir, "docs");
    const memoryDir = path.join(stateDir, "memory");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, "2026-05-21.md"), "# Daily Memory\n", "utf-8");

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      additionalRoots: [memoryDir],
    });

    try {
      const workspaceFilePath = path.join(docsDir, "source-registry.md");
      manager.upsertMemoryChunk({
        id: "tree-source-workspace-1",
        sourcePath: workspaceFilePath,
        sourceType: "file",
        memoryType: "other",
        content: "workspace evidence for source registry",
      });

      const rebuild = await manager.rebuildMemoryTreeSources();
      expect(rebuild.totalSources).toBeGreaterThan(0);

      const sources = manager.listMemoryTreeSources(50);
      const daily = sources.find((item) => item.id === "builtin:memory:daily-notes");
      const workspace = sources.find((item) => item.sourcePath === workspaceFilePath);

      expect(daily?.metadata).toMatchObject({
        sourceRegistry: {
          admission: {
            searchPolicy: "searchable",
          },
          identity: {
            canonicalSourceKey: "builtin:builtin:memory:daily-notes",
          },
        },
      });
      expect(workspace?.metadata).toMatchObject({
        sourceRegistry: {
          admission: {
            searchPolicy: "searchable",
          },
          identity: {
            canonicalSourceKey: expect.stringContaining("path:"),
            sourceFamilyKey: expect.stringContaining("path:"),
          },
        },
      });
    } finally {
      manager.close();
    }
  });
});
