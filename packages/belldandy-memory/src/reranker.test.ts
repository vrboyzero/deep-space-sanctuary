import { describe, expect, it } from "vitest";

import { ResultReranker } from "./reranker.js";

describe("ResultReranker", () => {
  it("does not turn short chunks into negative scores during length normalization", () => {
    const reranker = new ResultReranker({
      recencyHalfLifeDays: 0,
      diversityPenalty: 0,
      mmrLambda: 1,
    });

    const results = reranker.rerank([
      {
        id: "short-memory",
        sourcePath: "memory/short.md",
        sourceType: "manual",
        memoryType: "other",
        visibility: "private",
        content: "short memory keeps a stable score",
        snippet: "short memory keeps a stable score",
        score: 0.6,
        metadata: {},
      },
      {
        id: "long-memory",
        sourcePath: "memory/long.md",
        sourceType: "manual",
        memoryType: "other",
        visibility: "private",
        content: "long ".repeat(600),
        snippet: "long memory",
        score: 0.6,
        metadata: {},
      },
    ]);

    const shortResult = results.find((item) => item.id === "short-memory");
    const longResult = results.find((item) => item.id === "long-memory");

    expect(shortResult?.score).toBeGreaterThanOrEqual(0.45);
    expect(longResult?.score ?? 0).toBeLessThan(shortResult?.score ?? Number.POSITIVE_INFINITY);
  });

  it("applies diversity penalty by source family key across sibling session artifacts", () => {
    const reranker = new ResultReranker({
      recencyHalfLifeDays: 0,
      diversityPenalty: 0.2,
      mmrLambda: 1,
    });

    const results = reranker.rerank([
      {
        id: "session-raw",
        sourcePath: "E:/state/sessions/conv-1.jsonl",
        sourceType: "session",
        memoryType: "session",
        visibility: "private",
        snippet: "viewer lazy loading raw note",
        score: 0.8,
        metadata: {
          memoryTree: {
            sourceFamilyKey: "session:e:/state/sessions/conv-1",
          },
        },
      },
      {
        id: "session-digest",
        sourcePath: "E:/state/sessions/conv-1.digest.json",
        sourceType: "session_derived",
        memoryType: "session",
        visibility: "private",
        snippet: "viewer lazy loading digest summary",
        score: 0.79,
        metadata: {
          memoryTree: {
            sourceFamilyKey: "session:e:/state/sessions/conv-1",
          },
        },
      },
      {
        id: "other-family",
        sourcePath: "memory/other.md",
        sourceType: "manual",
        memoryType: "other",
        visibility: "private",
        snippet: "other family baseline",
        score: 0.78,
        metadata: {
          memoryTree: {
            sourceFamilyKey: "path:memory/other.md",
          },
        },
      },
    ]);

    expect(results.map((item) => item.id)).toEqual([
      "session-raw",
      "other-family",
      "session-digest",
    ]);
    expect((results.find((item) => item.id === "session-digest")?.score ?? 0)).toBeLessThan(
      results.find((item) => item.id === "other-family")?.score ?? Number.POSITIVE_INFINITY,
    );
  });
});
