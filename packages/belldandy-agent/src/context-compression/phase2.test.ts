/**
 * Phase 2 测试：reference store、marker、cold resume prune、新压缩器
 */

import { describe, expect, it } from "vitest";

import {
  createCompressionPipeline,
  createCompressionPipelineWithStore,
  ConversationReferenceStore,
  generateRefId,
  hasCompressionMarker,
  hasLegacyCompressionMarker,
  isAnyCompactedContent,
  parseCompressionMarker,
  buildCompressionMarkerHeader,
  wrapWithMarker,
  rewriteMarkerRetrievable,
  coldResumePruneMessages,
  pruneBeforeSummarize,
  JsonToolOutputCompressor,
  CodeSnippetCompressor,
  type CompressionResult,
} from "./index.js";

describe("Phase 2: ConversationReferenceStore", () => {
  it("stores and retrieves content", () => {
    const store = new ConversationReferenceStore();
    const ref = store.store("original content", { tool: "test" });
    expect(ref.refId).toBeTruthy();
    expect(ref.status).toBe("active");

    const retrieved = store.retrieve(ref.refId);
    expect(retrieved.found).toBe(true);
    expect(retrieved.content).toBe("original content");
    expect(retrieved.status).toBe("active");
  });

  it("invalidates references", () => {
    const store = new ConversationReferenceStore();
    const ref = store.store("content");
    expect(store.invalidate(ref.refId)).toBe(true);

    const retrieved = store.retrieve(ref.refId);
    expect(retrieved.found).toBe(true);
    expect(retrieved.status).toBe("invalidated");
  });

  it("returns not found for unknown refId", () => {
    const store = new ConversationReferenceStore();
    const retrieved = store.retrieve("nonexistent");
    expect(retrieved.found).toBe(false);
  });

  it("prunes by predicate", () => {
    const store = new ConversationReferenceStore();
    const ref1 = store.store("content1");
    const ref2 = store.store("content2");
    store.invalidate(ref1.refId);

    const pruned = store.prune((r) => r.status !== "active");
    expect(pruned).toBe(1);
    expect(store.has(ref1.refId)).toBe(false);
    expect(store.has(ref2.refId)).toBe(true);
  });

  it("enforces max entries", () => {
    const store = new ConversationReferenceStore({ maxEntries: 3 });
    const refs = [];
    for (let i = 0; i < 5; i++) {
      refs.push(store.store(`content${i}`));
    }
    expect(store.size()).toBe(3);
    // 最老的应被淘汰
    expect(store.has(refs[0].refId)).toBe(false);
    expect(store.has(refs[4].refId)).toBe(true);
  });

  it("generateRefId produces unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRefId());
    }
    expect(ids.size).toBe(100);
  });
});

describe("Phase 2: marker format", () => {
  it("builds and parses marker header", () => {
    const header = buildCompressionMarkerHeader({
      refId: "cr_test_123",
      strategy: "log-output-extractive",
      source: "run_command",
      retrievable: true,
    });
    expect(header).toContain("id=cr_test_123");
    expect(header).toContain("strategy=log-output-extractive");
    expect(header).toContain("source=run_command");
    expect(header).toContain("retrievable=yes");

    const parsed = parseCompressionMarker(header + "\nsome content");
    expect(parsed).toBeDefined();
    expect(parsed?.refId).toBe("cr_test_123");
    expect(parsed?.strategy).toBe("log-output-extractive");
    expect(parsed?.source).toBe("run_command");
    expect(parsed?.retrievable).toBe(true);
  });

  it("wrapWithMarker produces parseable content", () => {
    const wrapped = wrapWithMarker({
      refId: "cr_abc",
      strategy: "json-tool-output-structure",
      source: "file_read",
      retrievable: true,
      compressedContent: "compressed body",
    });
    expect(hasCompressionMarker(wrapped)).toBe(true);
    const parsed = parseCompressionMarker(wrapped);
    expect(parsed?.refId).toBe("cr_abc");
    expect(wrapped).toContain("compressed body");
  });

  it("rewriteMarkerRetrievable changes retrievable flag", () => {
    const wrapped = wrapWithMarker({
      refId: "cr_xyz",
      strategy: "test",
      source: "test",
      retrievable: true,
      compressedContent: "body",
    });
    const rewritten = rewriteMarkerRetrievable(wrapped, false);
    const parsed = parseCompressionMarker(rewritten);
    expect(parsed?.retrievable).toBe(false);
    expect(rewritten).toContain("body");
  });

  it("rewriteMarkerRetrievable returns original for non-marker content", () => {
    const original = "just some content";
    expect(rewriteMarkerRetrievable(original, false)).toBe(original);
  });

  it("detects legacy and microcompact markers", () => {
    expect(hasLegacyCompressionMarker("[compressed tool output]\nfoo")).toBe(true);
    expect(isAnyCompactedContent("[old tool output cleared]\ntool=x")).toBe(true);
    expect(isAnyCompactedContent("[old tool error summary preserved]\ntool=x")).toBe(true);
    expect(isAnyCompactedContent("[compressed-ref id=x strategy=y]\nbody")).toBe(true);
    expect(isAnyCompactedContent("plain content")).toBe(false);
  });

  it("parseCompressionMarker returns undefined for non-marker", () => {
    expect(parseCompressionMarker("just text")).toBeUndefined();
  });
});

describe("Phase 2: cold resume prune", () => {
  it("invalidates markers when store is empty", () => {
    const messages = [
      {
        role: "tool",
        content: wrapWithMarker({
          refId: "cr_missing",
          strategy: "test",
          source: "test",
          retrievable: true,
          compressedContent: "body",
        }),
      },
    ];
    const result = coldResumePruneMessages(messages, undefined);
    expect(result.scannedMarkers).toBe(1);
    expect(result.invalidatedMarkers).toBe(1);
    expect(result.retrievableMarkers).toBe(0);
    const parsed = parseCompressionMarker(messages[0].content as string);
    expect(parsed?.retrievable).toBe(false);
  });

  it("keeps markers retrievable when store has active ref", () => {
    const store = new ConversationReferenceStore();
    const ref = store.store("original content");
    const messages = [
      {
        role: "tool",
        content: wrapWithMarker({
          refId: ref.refId,
          strategy: "test",
          source: "test",
          retrievable: true,
          compressedContent: "body",
        }),
      },
    ];
    const result = coldResumePruneMessages(messages, store);
    expect(result.scannedMarkers).toBe(1);
    expect(result.invalidatedMarkers).toBe(0);
    expect(result.retrievableMarkers).toBe(1);
  });

  it("invalidates markers when store ref is invalidated", () => {
    const store = new ConversationReferenceStore();
    const ref = store.store("original content");
    store.invalidate(ref.refId);
    const messages = [
      {
        role: "tool",
        content: wrapWithMarker({
          refId: ref.refId,
          strategy: "test",
          source: "test",
          retrievable: true,
          compressedContent: "body",
        }),
      },
    ];
    const result = coldResumePruneMessages(messages, store);
    expect(result.invalidatedMarkers).toBe(1);
    const parsed = parseCompressionMarker(messages[0].content as string);
    expect(parsed?.retrievable).toBe(false);
  });

  it("pruneBeforeSummarize also cleans store", () => {
    const store = new ConversationReferenceStore();
    const ref1 = store.store("content1");
    const ref2 = store.store("content2");
    store.invalidate(ref1.refId);

    const messages = [
      { role: "tool", content: wrapWithMarker({ refId: ref1.refId, strategy: "x", source: "x", retrievable: true, compressedContent: "b1" }) },
      { role: "tool", content: wrapWithMarker({ refId: ref2.refId, strategy: "x", source: "x", retrievable: true, compressedContent: "b2" }) },
    ];
    const result = pruneBeforeSummarize(messages, store);
    expect(result.invalidatedMarkers).toBe(1);
    expect(result.retrievableMarkers).toBe(1);
    // store 中失效条目应被清理
    expect(store.has(ref1.refId)).toBe(false);
    expect(store.has(ref2.refId)).toBe(true);
  });

  it("skips non-marker messages", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = coldResumePruneMessages(messages, undefined);
    expect(result.scannedMarkers).toBe(0);
  });
});

describe("Phase 2: JsonToolOutputCompressor", () => {
  it("compresses JSON with large string values", async () => {
    const compressor = new JsonToolOutputCompressor();
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      obj[`key${i}`] = "x".repeat(500);
    }
    obj["items"] = Array.from({ length: 20 }, (_, i) => ({ id: i, data: "y".repeat(300) }));
    const content = JSON.stringify(obj, null, 2);

    const result = await compressor.compress(
      { sourceKind: "tool_result", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(true);
    expect(result.compressedContent.length).toBeLessThan(content.length);
    expect(result.compressedContent).toContain("truncated");
    expect(result.qualityHint?.omittedSummary).toContain("截断");
  });

  it("passes through short JSON", async () => {
    const compressor = new JsonToolOutputCompressor();
    const result = await compressor.compress(
      { sourceKind: "tool_result", content: '{"a":1}' },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(false);
  });

  it("passes through JSON without large values", async () => {
    const compressor = new JsonToolOutputCompressor();
    const obj = { a: 1, b: "short", c: [1, 2, 3] };
    const content = JSON.stringify(obj, null, 2).padEnd(700, " ");
    const result = await compressor.compress(
      { sourceKind: "tool_result", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(false);
  });
});

describe("Phase 2: CodeSnippetCompressor", () => {
  it("compresses long code by omitting function bodies", async () => {
    const compressor = new CodeSnippetCompressor();
    const lines: string[] = [
      "import { foo } from 'bar';",
      "import { baz } from 'qux';",
      "",
      "export function main() {",
    ];
    for (let i = 0; i < 80; i++) {
      lines.push(`  const x${i} = doSomething(${i});`);
    }
    lines.push("  return result;");
    lines.push("}");
    lines.push("");
    lines.push("export function helper() {");
    for (let i = 0; i < 40; i++) {
      lines.push(`  process(${i});`);
    }
    lines.push("}");
    const content = lines.join("\n");

    const result = await compressor.compress(
      { sourceKind: "file_read", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    // 调试：如果未应用，输出原因
    if (!result.applied) {
      console.log("CodeSnippet not applied:", result.observability.reason, "originalChars:", result.originalChars, "lines:", content.split("\n").length);
    }
    expect(result.applied).toBe(true);
    expect(result.compressedContent.length).toBeLessThan(content.length);
    expect(result.compressedContent).toContain("import");
    expect(result.compressedContent).toContain("export function main");
    expect(result.compressedContent).toContain("lines omitted");
    expect(result.qualityHint?.omittedSummary).toContain("函数");
  });

  it("passes through short code", async () => {
    const compressor = new CodeSnippetCompressor();
    const content = "import { x } from 'y';\nexport function f() { return 1; }";
    const result = await compressor.compress(
      { sourceKind: "file_read", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(false);
  });
});

describe("Phase 2: pipeline with reference store", () => {
  it("stores original content and allows retrieval", async () => {
    const { pipeline, store } = createCompressionPipelineWithStore({
      allowReferenceStore: true,
      sourceOverrides: {
        tool_result: { enabled: true, allowLossy: true, allowReferenceStore: true },
      },
    });

    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`2026-06-23 10:00:${String(i).padStart(2, "0")} INFO Processing ${i}`);
    }
    const content = lines.join("\n");

    const result = await pipeline.compress({
      sourceKind: "tool_result",
      sourceName: "run_command",
      content,
    });

    expect(result.applied).toBe(true);
    expect(result.reference).toBeDefined();
    expect(result.reference?.refId).toBeTruthy();
    expect(result.reference?.status).toBe("active");
    expect(store.size()).toBeGreaterThan(0);

    // retrieve 原文
    const retrieved = await pipeline.retrieve!({ refId: result.reference!.refId });
    expect(retrieved.found).toBe(true);
    expect(retrieved.content).toBe(content);
  });

  it("does not store reference when policy disallows", async () => {
    const { pipeline, store } = createCompressionPipelineWithStore({
      allowReferenceStore: false,
      sourceOverrides: {
        tool_result: { enabled: true, allowLossy: true, allowReferenceStore: false },
      },
    });

    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`2026-06-23 10:00:${String(i).padStart(2, "0")} INFO Processing ${i}`);
    }
    const content = lines.join("\n");

    const result = await pipeline.compress({
      sourceKind: "tool_result",
      sourceName: "run_command",
      content,
    });

    expect(result.applied).toBe(true);
    expect(result.reference).toBeUndefined();
    expect(store.size()).toBe(0);
  });
});
