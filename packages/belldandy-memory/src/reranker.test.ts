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
});
