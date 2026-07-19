import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryManager } from "./manager.js";
import { MemoryStore } from "./store.js";

describe("MemoryManager batch reranking", () => {
  let rootDir: string;
  let manager: MemoryManager | undefined;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-manager-rerank-batch-"));
  });

  afterEach(async () => {
    await manager?.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("loads MMR candidate vectors through the Store batch API", async () => {
    manager = new MemoryManager({
      workspaceRoot: rootDir,
      stateDir: rootDir,
    });
    const store = (manager as any).store as MemoryStore;
    const searchHybrid = vi.spyOn(store, "searchHybrid").mockReturnValue([
      createSearchResult("batch-manager-first", 0.9),
      createSearchResult("batch-manager-duplicate", 0.8),
      createSearchResult("batch-manager-distinct", 0.7),
    ]);
    const getChunkVector = vi.spyOn(store, "getChunkVector");
    const getChunkVectors = vi.spyOn(store, "getChunkVectors").mockImplementation((chunkIds: string[]) => new Map([
      [chunkIds[0], [1, 0]],
      [chunkIds[1], [1, 0]],
      [chunkIds[2], [0, 1]],
    ]));

    await manager.searchWithDiagnostics("batch rerank marker", {
      limit: 3,
      routingPolicy: "chunk_only",
    });

    expect(searchHybrid).toHaveBeenCalledTimes(1);
    expect(getChunkVectors).toHaveBeenCalledWith([
      "batch-manager-first",
      "batch-manager-duplicate",
      "batch-manager-distinct",
    ]);
    expect(getChunkVector).not.toHaveBeenCalled();
  });
});

function createSearchResult(id: string, score: number) {
  return {
    id,
    sourcePath: `memory/${id}.md`,
    sourceType: "manual" as const,
    memoryType: "other" as const,
    visibility: "private" as const,
    content: id,
    snippet: id,
    score,
    metadata: {},
  };
}
