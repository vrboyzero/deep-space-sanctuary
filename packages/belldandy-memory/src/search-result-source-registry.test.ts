import { describe, expect, it } from "vitest";

import { applySearchResultSourceRegistryHints } from "./search-result-source-registry.js";

describe("search result source registry hints", () => {
  it("annotates derived session results with source registry policies", () => {
    const [result] = applySearchResultSourceRegistryHints([
      {
        id: "session-derived-1",
        sourcePath: "E:/state/sessions/conv-3.session-memory.json",
        sourceType: "session_derived",
        memoryType: "session",
        visibility: "private",
        snippet: "下一步是继续整理统一记忆来源。",
        score: 0.82,
        updatedAt: "2026-05-21T08:00:00.000Z",
        metadata: {},
      },
    ]);

    expect(result?.metadata?.memoryTree).toMatchObject({
      sourceKind: "session_memory",
      sourceClass: "derived",
      sourceFamilyKey: "session:e:/state/sessions/conv-3",
      canonicalSourceKey: "path:e:/state/sessions/conv-3.session-memory.json",
      revisionHint: "2026-05-21T08:00:00.000Z",
      sourceRegistry: {
        sourceKind: "session_memory",
        sourceClass: "derived",
        searchPolicy: "summary-input-only",
        dedupPolicy: "derived-overlay",
        retentionHint: "refresh-from-source",
      },
    });
  });
});
