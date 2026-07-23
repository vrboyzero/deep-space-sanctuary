import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryManager } from "./manager.js";
import { MemoryStore } from "./store.js";

describe("memory tree detail batch projection", () => {
  let directory: string;
  let databasePath: string;
  let store: MemoryStore | null;
  let manager: MemoryManager | null;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "memory-tree-detail-batch-"));
    databasePath = path.join(directory, "memory.sqlite");
    store = new MemoryStore(databasePath);
    manager = null;
  });

  afterEach(async () => {
    await manager?.close();
    store?.close();
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  });

  it("preserves caller and edge order while deduping ids, filling chunk limits and retaining source fallback", () => {
    seedBatchFixture(store!);

    const details = store!.getMemoryTreeNodeDetails([
      "node:b",
      "node:a",
      "node:b",
      "node:missing",
    ], { chunkLimit: 2 });

    expect([...details.keys()]).toEqual(["node:b", "node:a"]);
    expect(details.get("node:a")).toMatchObject({
      node: { id: "node:a" },
      edges: [
        { childId: "chunk:a:1", position: 0 },
        { childId: "chunk:a:missing", position: 1 },
        { childId: "chunk:a:3", position: 2 },
        { childId: "source:a", position: 3 },
      ],
      chunks: [
        { id: "chunk:a:1", content: "chunk a one" },
        { id: "chunk:a:3", content: "chunk a three" },
      ],
      sources: [{ id: "source:a", sourceKind: "workspace_file", sourceClass: "raw" }],
    });
    expect(details.get("node:b")?.chunks.map((item) => item.id)).toEqual(["chunk:b:1"]);
    expect(details.get("node:b")?.sources).toEqual([
      expect.objectContaining({
        id: "source:b:missing",
        sourceKind: "session_artifact",
        sourceClass: "derived",
        metadata: expect.objectContaining({ recordType: "tree_source_edge_fallback" }),
      }),
    ]);
    expect(details.has("node:missing")).toBe(false);
  });

  it("splits node ids before SQLite bind limits", () => {
    const database = store!.getDbHandleForSharedSchema();
    const prepareSpy = vi.spyOn(database, "prepare");
    const missingIds = Array.from({ length: 901 }, (_, index) => `missing:${index}`);

    const details = store!.getMemoryTreeNodeDetails(missingIds, { chunkLimit: 2 });

    expect(details.size).toBe(0);
    const nodeQueries = prepareSpy.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes("FROM memory_tree_nodes") && sql.includes("id IN"));
    expect(nodeQueries).toHaveLength(2);
  });

  it("uses one batch detail owner for search and keeps the single-node surface equivalent", async () => {
    seedBatchFixture(store!);
    store!.close();
    store = null;
    manager = new MemoryManager({
      workspaceRoot: directory,
      stateDir: directory,
      storePath: databasePath,
      embeddingEnabled: false,
    });
    const batchSpy = vi.spyOn(manager, "getMemoryTreeNodeDetails");
    const singleSpy = vi.spyOn(manager, "getMemoryTreeNodeDetail");

    const results = manager.searchMemoryTreeNodes("batch projection marker", {
      limit: 2,
      chunkLimitPerNode: 2,
    });

    expect(results.map((item) => item.node.id)).toEqual(["node:a", "node:b"]);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith(["node:a", "node:b"], { chunkLimit: 2 });
    expect(singleSpy).not.toHaveBeenCalled();
    expect(manager.getMemoryTreeNodeDetail("node:a", { chunkLimit: 2 }))
      .toEqual(batchSpy.mock.results[0]?.value.get("node:a"));
  });
});

function seedBatchFixture(store: MemoryStore): void {
  const timestamp = "2026-07-23T00:00:00.000Z";
  store.upsertMemoryTreeNodes([
    {
      id: "node:a",
      level: 2,
      kind: "topic",
      scope: "private",
      title: "Batch projection marker A",
      summary: "batch projection marker alpha",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "node:b",
      level: 2,
      kind: "topic",
      scope: "private",
      title: "Batch projection marker B",
      summary: "batch projection marker beta",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  for (const [id, content] of [
    ["chunk:a:1", "chunk a one"],
    ["chunk:a:3", "chunk a three"],
    ["chunk:b:1", "chunk b one"],
  ] as const) {
    store.upsertChunk({
      id,
      sourcePath: `${id}.md`,
      sourceType: "file",
      memoryType: "other",
      content,
    });
  }
  store.upsertMemorySources([{
    id: "source:a",
    sourceKind: "workspace_file",
    sourceClass: "raw",
    scope: "private",
    sourcePath: "source-a.md",
    createdAt: timestamp,
    updatedAt: timestamp,
  }]);
  store.upsertMemoryTreeEdges([
    edge("edge:a:1", "node:a", "chunk", "chunk:a:1", 0),
    edge("edge:a:missing", "node:a", "chunk", "chunk:a:missing", 1),
    edge("edge:a:3", "node:a", "chunk", "chunk:a:3", 2),
    edge("edge:a:source", "node:a", "source", "source:a", 3),
    edge("edge:b:1", "node:b", "chunk", "chunk:b:1", 0),
    {
      ...edge("edge:b:source", "node:b", "source", "source:b:missing", 1),
      metadata: {
        sourceKind: "session_artifact",
        sourceClass: "derived",
        sourcePath: "session-b.json",
        canonicalSourceKey: "session-b",
      },
    },
  ]);
}

function edge(
  id: string,
  parentNodeId: string,
  childType: "chunk" | "source",
  childId: string,
  position: number,
) {
  return {
    id,
    parentNodeId,
    childType,
    childId,
    relation: childType === "chunk" ? "contains" : "derived_from",
    position,
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}
