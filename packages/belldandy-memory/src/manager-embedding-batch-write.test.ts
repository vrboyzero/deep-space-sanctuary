import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryManager } from "./manager.js";
import { MemoryStore } from "./store.js";

describe("MemoryManager embedding batch write", () => {
  let rootDir: string;
  let manager: MemoryManager | undefined;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-manager-embedding-batch-write-"));
  });

  afterEach(async () => {
    await manager?.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("uses one Store batch write for a valid provider response", async () => {
    manager = new MemoryManager({
      workspaceRoot: rootDir,
      stateDir: rootDir,
      embeddingBatchSize: 2,
    });
    const store = (manager as any).store as MemoryStore;
    for (const id of ["manager-batch-write-a", "manager-batch-write-b"]) {
      store.upsertChunk({
        id,
        sourcePath: path.join(rootDir, `${id}.md`),
        sourceType: "file",
        memoryType: "other",
        content: id,
      });
    }
    const upsertChunkVectorsBatch = vi.spyOn(store, "upsertChunkVectorsBatch");
    (manager as any).embeddingProvider = {
      modelName: "manager-batch-write-test",
      dimension: 2,
      embed: async () => [0.1, 0.2],
      embedBatch: async () => [[0.1, 0.2], [0.3, 0.4]],
    };

    await (manager as any).processPendingEmbeddings();

    expect(upsertChunkVectorsBatch).toHaveBeenCalledTimes(1);
    expect(upsertChunkVectorsBatch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ chunkId: "manager-batch-write-a", embedding: [0.1, 0.2] }),
      expect.objectContaining({ chunkId: "manager-batch-write-b", embedding: [0.3, 0.4] }),
    ]);
    expect(store.getChunkVector("manager-batch-write-a")).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
    ]);
    expect(store.getChunkVector("manager-batch-write-b")).toEqual([
      expect.closeTo(0.3, 5),
      expect.closeTo(0.4, 5),
    ]);
  });
});
