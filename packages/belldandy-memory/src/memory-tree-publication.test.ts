import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "./store.js";

describe("memory tree publication", () => {
  let rootDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-publication-"));
    store = new MemoryStore(path.join(rootDir, "memory.db"));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it("keeps the previous kind snapshot when a replacement cannot be serialized", () => {
    const oldNode = createNode("topic:old", "old tree snapshot");
    const oldEdge = createEdge("edge:topic:old:chunk:old", oldNode.id, "chunk-old");
    store.upsertMemoryTreeNodes([oldNode]);
    store.upsertMemoryTreeEdges([oldEdge]);

    const circularMetadata: { self?: unknown } = {};
    circularMetadata.self = circularMetadata;
    const invalidNode = {
      ...createNode("topic:new", "new tree snapshot"),
      metadata: circularMetadata,
    };

    expect(() => store.publishMemoryTreeKind({
      kind: "topic",
      nodes: [invalidNode],
      edges: [createEdge("edge:topic:new:chunk:new", "topic:new", "chunk-new")],
    })).toThrow(/circular/i);

    expect(store.listMemoryTreeNodes(10, { kind: "topic" }).map((node) => node.id)).toEqual(["topic:old"]);
    expect(store.listMemoryTreeEdges({ parentNodeId: oldNode.id }).map((edge) => edge.id)).toEqual([oldEdge.id]);
  });

  it("replaces nodes and edges for one kind together", () => {
    const oldNode = createNode("topic:old", "old tree snapshot");
    store.upsertMemoryTreeNodes([oldNode]);
    store.upsertMemoryTreeEdges([createEdge("edge:topic:old:chunk:old", oldNode.id, "chunk-old")]);

    const newNode = createNode("topic:new", "new tree snapshot");
    const newEdge = createEdge("edge:topic:new:chunk:new", newNode.id, "chunk-new");
    store.publishMemoryTreeKind({
      kind: "topic",
      nodes: [newNode],
      edges: [newEdge],
    });

    expect(store.listMemoryTreeNodes(10, { kind: "topic" }).map((node) => node.id)).toEqual([newNode.id]);
    expect(store.listMemoryTreeEdges({ parentNodeId: newNode.id }).map((edge) => edge.id)).toEqual([newEdge.id]);
    expect(store.listMemoryTreeEdges({ parentNodeId: oldNode.id })).toEqual([]);
  });
});

function createNode(id: string, summary: string) {
  return {
    id,
    level: 1,
    kind: "topic" as const,
    scope: "private" as const,
    summary,
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
  };
}

function createEdge(id: string, parentNodeId: string, childId: string) {
  return {
    id,
    parentNodeId,
    childType: "chunk" as const,
    childId,
    relation: "contains",
    position: 0,
    weight: 1,
    createdAt: "2026-07-17T10:00:00.000Z",
  };
}
