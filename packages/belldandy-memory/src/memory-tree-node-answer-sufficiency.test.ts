import { describe, expect, it } from "vitest";

import { resolveMemoryTreeNodeRoutingPlan } from "./memory-tree-node-intent.js";
import { buildMemoryTreeNodeAnswerStrategy } from "./memory-tree-node-answer-sufficiency.js";
import type { MemorySearchResult } from "./types.js";
import type { MemoryTreeNodeSearchResult } from "./memory-tree-types.js";

describe("memory tree node answer sufficiency", () => {
  it("keeps high-level routing compact when the top node summary is already sufficient", () => {
    const plan = resolveMemoryTreeNodeRoutingPlan("global focus goal alpha");
    const strategy = buildMemoryTreeNodeAnswerStrategy({
      limit: 3,
      routingPlan: plan,
      nodeResults: [
        buildNodeResult({
          id: "global:workspace",
          kind: "global",
          summary: "Workspace priorities | goal alpha rollout | keep regression guard in place",
          score: 15,
          matchReasons: ["摘要", "intent:global"],
          chunkIds: ["global-1", "global-2"],
        }),
        buildNodeResult({
          id: "project:goal-alpha",
          kind: "project",
          summary: "Goal alpha rollout summary",
          score: 11.5,
          matchReasons: ["project"],
          chunkIds: ["project-1"],
        }),
      ],
    });

    expect(strategy).toMatchObject({
      answerSufficient: true,
      evidenceExpanded: false,
      highLevelOnly: true,
      evidenceChunkCount: 0,
      selectedNodeIds: ["global:workspace"],
    });
    expect(strategy.selections).toHaveLength(1);
    expect(strategy.selections[0]).toMatchObject({
      nodeIndex: 0,
      chunkIndex: 0,
      stage: "high_level",
    });
  });

  it("expands evidence chunks when topic lookup still needs supporting details", () => {
    const plan = resolveMemoryTreeNodeRoutingPlan("viewer audit details", {
      topic: "viewer-audit",
    } as any);
    const strategy = buildMemoryTreeNodeAnswerStrategy({
      limit: 2,
      routingPlan: plan,
      nodeResults: [
        buildNodeResult({
          id: "topic:viewer-audit",
          kind: "topic",
          summary: "Viewer audit notes",
          score: 9.5,
          matchReasons: ["topic", "intent:topic"],
          chunkIds: ["topic-1", "topic-2", "topic-3"],
        }),
      ],
    });

    expect(strategy).toMatchObject({
      answerSufficient: false,
      evidenceExpanded: true,
      highLevelOnly: false,
      evidenceChunkCount: 2,
      selectedNodeIds: ["topic:viewer-audit"],
    });
    expect(strategy.selections.map((item) => item.stage)).toEqual([
      "high_level",
      "evidence",
      "evidence",
    ]);
  });
});

function buildNodeResult(input: {
  id: string;
  kind: MemoryTreeNodeSearchResult["node"]["kind"];
  summary: string;
  score: number;
  matchReasons: string[];
  chunkIds: string[];
}): MemoryTreeNodeSearchResult {
  return {
    node: {
      id: input.id,
      level: 2,
      kind: input.kind,
      scope: "private",
      title: input.id,
      topicKey: input.id,
      summary: input.summary,
    },
    score: input.score,
    matchReasons: input.matchReasons,
    edges: [],
    chunks: input.chunkIds.map((id, index) => buildChunk(id, index)),
  };
}

function buildChunk(id: string, index: number): MemorySearchResult {
  return {
    id,
    sourcePath: `docs/${id}.md`,
    sourceType: "file",
    memoryType: "other",
    snippet: `snippet-${id}`,
    summary: `summary-${id}`,
    score: 0.7 - (index * 0.05),
    updatedAt: "2026-05-21T08:00:00.000Z",
    metadata: {},
  };
}
