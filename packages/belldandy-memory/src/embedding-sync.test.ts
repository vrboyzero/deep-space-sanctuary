import { describe, expect, it } from "vitest";

import { validateEmbeddingBatchResponse } from "./embedding-sync.js";

describe("validateEmbeddingBatchResponse", () => {
  it("accepts only finite vectors with the expected dimension", () => {
    const result = validateEmbeddingBatchResponse(
      [[0.1, 0.2], [0.3, 0.4]],
      2,
      2,
    );

    expect(result).toEqual({
      dimension: 2,
      receivedCount: 2,
      expectedCount: 2,
      responseCountMatches: true,
      vectors: [[0.1, 0.2], [0.3, 0.4]],
      failedCount: 0,
    });
  });

  it("rejects an underfilled response instead of accepting an ambiguous prefix", () => {
    const result = validateEmbeddingBatchResponse(
      [[0.1, 0.2], [Number.NaN, 0.4], [0.5]],
      4,
      2,
    );

    expect(result.dimension).toBe(2);
    expect(result.receivedCount).toBe(3);
    expect(result.responseCountMatches).toBe(false);
    expect(result.vectors).toEqual([null, null, null, null]);
    expect(result.failedCount).toBe(4);
  });

  it("marks wrong-dimension and non-finite entries as failed while retaining valid positions", () => {
    const result = validateEmbeddingBatchResponse(
      [[0.1, 0.2], [0.3], [Number.POSITIVE_INFINITY, 0.4]],
      3,
      2,
    );

    expect(result.responseCountMatches).toBe(true);
    expect(result.vectors).toEqual([[0.1, 0.2], null, null]);
    expect(result.failedCount).toBe(2);
  });

  it("derives a dimension only from a finite response vector", () => {
    const result = validateEmbeddingBatchResponse(
      [[], [Number.POSITIVE_INFINITY], [0.1, 0.2]],
      3,
    );

    expect(result.dimension).toBe(2);
    expect(result.vectors).toEqual([null, null, [0.1, 0.2]]);
    expect(result.failedCount).toBe(2);
  });
});
