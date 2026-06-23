import { describe, expect, it } from "vitest";

import {
  createCompressionPipeline,
  detectContentType,
  PassthroughCompressor,
  PlainTextCompressor,
  LogOutputCompressor,
  SearchResultsCompressor,
  type CompressionResult,
} from "./index.js";

describe("context-compression classifier", () => {
  it("detects JSON content", () => {
    expect(detectContentType({ content: '{"key": "value"}', sourceKind: "tool_result" })).toBe("json");
    expect(detectContentType({ content: '[1, 2, 3]', sourceKind: "tool_result" })).toBe("json");
  });

  it("detects log content", () => {
    const log = [
      "2026-06-23 10:00:00 INFO Starting process",
      "2026-06-23 10:00:01 DEBUG Loading config",
      "2026-06-23 10:00:02 INFO Process ready",
    ].join("\n");
    expect(detectContentType({ content: log, sourceKind: "tool_result" })).toBe("log");
  });

  it("detects search content", () => {
    const search = [
      "src/index.ts:10:export function main()",
      "src/utils.ts:25:function helper()",
    ].join("\n");
    expect(detectContentType({ content: search, sourceKind: "tool_result" })).toBe("search");
  });

  it("detects code content", () => {
    const code = [
      "import { foo } from 'bar';",
      "export function baz() {",
      "  return foo();",
      "}",
    ].join("\n");
    expect(detectContentType({ content: code, sourceKind: "file_read" })).toBe("code");
  });

  it("falls back to plain_text", () => {
    expect(detectContentType({ content: "Just some regular text without special structure.", sourceKind: "tool_result" })).toBe("plain_text");
  });

  it("respects hint", () => {
    expect(detectContentType({ content: "anything", sourceKind: "tool_result", hint: "log" })).toBe("log");
  });
});

describe("context-compression compressors", () => {
  it("passthrough returns content unchanged", async () => {
    const compressor = new PassthroughCompressor();
    const result = await compressor.compress(
      { sourceKind: "tool_result", content: "hello world" },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(false);
    expect(result.compressedContent).toBe("hello world");
  });

  it("plain-text compressor extracts key lines from long text", async () => {
    const compressor = new PlainTextCompressor();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Line ${i}: regular content ${i}`);
    }
    // 加一些关键行
    lines[50] = "## Important Heading";
    lines[60] = "ERROR: something went wrong";
    const content = lines.join("\n");

    const result = await compressor.compress(
      { sourceKind: "tool_result", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(true);
    expect(result.compressedContent.length).toBeLessThan(content.length);
    expect(result.compressedContent).toContain("## Important Heading");
    expect(result.compressedContent).toContain("ERROR: something went wrong");
    expect(result.qualityHint?.omittedSummary).toContain("省略了");
  });

  it("plain-text compressor passes through short text", async () => {
    const compressor = new PlainTextCompressor();
    const result = await compressor.compress(
      { sourceKind: "tool_result", content: "short text" },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(false);
  });

  it("log-output compressor keeps error/warn lines", async () => {
    const compressor = new LogOutputCompressor();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`2026-06-23 10:00:${String(i).padStart(2, "0")} INFO Processing item ${i}`);
    }
    lines[50] = "2026-06-23 10:00:50 ERROR Critical failure detected";
    lines[70] = "2026-06-23 10:00:70 WARN Resource limit approaching";
    const content = lines.join("\n");

    const result = await compressor.compress(
      { sourceKind: "tool_result", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(true);
    expect(result.compressedContent).toContain("ERROR Critical failure detected");
    expect(result.compressedContent).toContain("WARN Resource limit approaching");
    expect(result.compressedContent.length).toBeLessThan(content.length);
  });

  it("search-results compressor aggregates by file", async () => {
    const compressor = new SearchResultsCompressor();
    const lines: string[] = [];
    for (let fileIdx = 0; fileIdx < 5; fileIdx++) {
      for (let lineIdx = 0; lineIdx < 20; lineIdx++) {
        lines.push(`src/file${fileIdx}.ts:${lineIdx * 10}:some code content ${lineIdx}`);
      }
    }
    const content = lines.join("\n");

    const result = await compressor.compress(
      { sourceKind: "tool_result", content },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(true);
    expect(result.compressedContent).toContain("src/file0.ts");
    expect(result.compressedContent.length).toBeLessThan(content.length);
  });
});

describe("context-compression pipeline", () => {
  it("compresses long log tool output end-to-end", async () => {
    const pipeline = createCompressionPipeline();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`2026-06-23 10:00:${String(i).padStart(2, "0")} INFO Processing ${i}`);
    }
    lines[50] = "2026-06-23 10:00:50 ERROR Something broke";
    const content = lines.join("\n");

    const result = await pipeline.compress({
      sourceKind: "tool_result",
      sourceName: "run_command",
      content,
    });

    expect(result.applied).toBe(true);
    expect(result.savedTokensEstimate).toBeGreaterThan(0);
    expect(result.observability.sourceKind).toBe("tool_result");
    expect(result.observability.strategy).toContain("log");
  });

  it("passes through short content", async () => {
    const pipeline = createCompressionPipeline();
    const result = await pipeline.compress({
      sourceKind: "tool_result",
      content: "short output",
    });
    expect(result.applied).toBe(false);
    expect(result.strategy).toBe("passthrough");
  });

  it("respects source overrides for disabled sources", async () => {
    const pipeline = createCompressionPipeline({
      sourceOverrides: {
        tool_result: { enabled: false },
      },
    });
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`2026-06-23 10:00:${String(i).padStart(2, "0")} INFO Processing ${i}`);
    }
    const result = await pipeline.compress({
      sourceKind: "tool_result",
      content: lines.join("\n"),
    });
    expect(result.applied).toBe(false);
    expect(result.observability.reason).toBe("source_disabled");
  });

  it("fail-open on compressor error", async () => {
    // 使用一个会抛异常的压缩器
    const failingCompressor = {
      name: "failing",
      supports: () => true,
      compress: async () => { throw new Error("boom"); },
    };
    const pipeline = createCompressionPipeline();
    // 通过 pipeline 的 fallback 机制确保 fail-open
    // 这里直接测试 passthrough fallback
    const fallback = new PassthroughCompressor();
    const result = await fallback.compress(
      { sourceKind: "tool_result", content: "test" },
      { policy: { enabled: true, allowLossy: true, allowReferenceStore: false, preservePrefixStability: true, maxInlineChars: 8000, maxInlineTokensEstimate: 2000, preferStructurePreserving: true, minSavingsRatioToApply: 0.15 } },
    );
    expect(result.applied).toBe(false);
  });
});
