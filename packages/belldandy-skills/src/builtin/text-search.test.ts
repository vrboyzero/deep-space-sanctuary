import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ToolContext } from "../types.js";
import { textSearchTool } from "./text-search.js";

type SearchPayload = {
  root: string;
  mode: "fixed" | "regex";
  caseSensitive: boolean;
  results: Array<{
    path: string;
    line: number;
    column: number;
    text: string;
    before?: Array<{ line: number; text: string }>;
    after?: Array<{ line: number; text: string }>;
  }>;
  truncated: boolean;
  nextCursor?: string;
  ignore: {
    mode: "respected" | "overridden";
  };
  skipped: {
    ignored: number;
    hidden: number;
    sensitive: number;
    policyDenied: number;
    binary: number;
  };
};

describe("text_search", () => {
  let tempDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-text-search-"));
    context = {
      conversationId: "conv-text-search",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [".git", "node_modules", "restricted"],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 64 * 1024,
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("searches fixed text case-insensitively within a glob and returns bounded context", async () => {
    await writeFile("src/alpha.ts", "before\nNeedle in alpha\nafter\n");
    await writeFile("src/beta.ts", "needle in beta\n");
    await writeFile("docs/ignored.md", "needle in docs\n");

    const result = await textSearchTool.execute({
      query: "needle",
      glob: "src/**/*.ts",
      contextLines: 1,
    }, context);

    expect(result.success).toBe(true);
    const payload = parsePayload(result.output);
    expect(payload.root).toBe(".");
    expect(payload.mode).toBe("fixed");
    expect(payload.caseSensitive).toBe(false);
    expect(payload.results.map((entry) => entry.path)).toEqual(["src/alpha.ts", "src/beta.ts"]);
    expect(payload.results[0]).toMatchObject({
      line: 2,
      column: 1,
      text: "Needle in alpha",
      before: [{ line: 1, text: "before" }],
      after: [{ line: 3, text: "after" }],
    });
  });

  it("supports case-sensitive regular expressions", async () => {
    await writeFile("src/query.ts", "Needle\nneedle\nneedle-extra\n");

    const result = await textSearchTool.execute({
      query: "^needle$",
      mode: "regex",
      caseSensitive: true,
    }, context);

    expect(result.success).toBe(true);
    const payload = parsePayload(result.output);
    expect(payload.mode).toBe("regex");
    expect(payload.caseSensitive).toBe(true);
    expect(payload.results.map((entry) => entry.line)).toEqual([2]);
  });

  it("uses an input-bound cursor to resume deterministic path and line ordering", async () => {
    await writeFile("a.ts", "needle a\n");
    await writeFile("b.ts", "needle b\n");
    await writeFile("c.ts", "needle c\n");

    const first = await textSearchTool.execute({
      query: "needle",
      glob: "**/*.ts",
      maxResults: 2,
    }, context);

    expect(first.success).toBe(true);
    const firstPayload = parsePayload(first.output);
    expect(firstPayload.results.map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);
    expect(firstPayload.truncated).toBe(true);
    expect(firstPayload.nextCursor).toEqual(expect.any(String));

    const second = await textSearchTool.execute({
      query: "needle",
      glob: "**/*.ts",
      maxResults: 2,
      cursor: firstPayload.nextCursor,
    }, context);

    expect(second.success).toBe(true);
    const secondPayload = parsePayload(second.output);
    expect(secondPayload.results.map((entry) => entry.path)).toEqual(["c.ts"]);
    expect(secondPayload.truncated).toBe(false);

    const mismatched = await textSearchTool.execute({
      query: "other",
      glob: "**/*.ts",
      maxResults: 2,
      cursor: firstPayload.nextCursor,
    }, context);
    expect(mismatched.success).toBe(false);
    expect(mismatched.error).toContain("cursor");
  });

  it("respects gitignore, hidden, sensitive, binary, and policy boundaries unless ignore is explicitly overridden", async () => {
    await writeFile(".gitignore", "ignored/\n*.generated.ts\n!keep.generated.ts\n");
    await writeFile("visible.ts", "needle visible\n");
    await writeFile("ignored/hidden.ts", "needle ignored\n");
    await writeFile("generated.generated.ts", "needle generated\n");
    await writeFile("keep.generated.ts", "needle keep\n");
    await writeFile(".hidden.ts", "needle hidden\n");
    await writeFile(".env", "needle env\n");
    await writeFile("restricted/blocked.ts", "needle blocked\n");
    await fs.writeFile(path.join(tempDir, "binary.dat"), Buffer.from([0, 1, 2, 3]));

    const normal = await textSearchTool.execute({ query: "needle" }, context);
    expect(normal.success).toBe(true);
    const normalPayload = parsePayload(normal.output);
    expect(normalPayload.results.map((entry) => entry.path)).toEqual(["keep.generated.ts", "visible.ts"]);
    expect(normalPayload.ignore.mode).toBe("respected");
    expect(normalPayload.skipped).toMatchObject({
      ignored: expect.any(Number),
      hidden: expect.any(Number),
      sensitive: expect.any(Number),
      policyDenied: expect.any(Number),
      binary: expect.any(Number),
    });

    const ignoredRoot = await textSearchTool.execute({
      query: "needle",
      path: "ignored",
    }, context);
    expect(ignoredRoot.success).toBe(true);
    const ignoredRootPayload = parsePayload(ignoredRoot.output);
    expect(ignoredRootPayload.results).toEqual([]);
    expect(ignoredRootPayload.skipped.ignored).toBe(1);

    const overridden = await textSearchTool.execute({
      query: "needle",
      includeIgnored: true,
    }, context);
    expect(overridden.success).toBe(true);
    const overriddenPayload = parsePayload(overridden.output);
    expect(overriddenPayload.results.map((entry) => entry.path)).toEqual([
      "generated.generated.ts",
      "ignored/hidden.ts",
      "keep.generated.ts",
      "visible.ts",
    ]);
    expect(overriddenPayload.ignore.mode).toBe("overridden");
  });

  it("keeps a valid response within the configured byte budget and resumes from the returned cursor", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => writeFile(
      `src/result-${index}.ts`,
      `needle ${"x".repeat(120)}\n`,
    )));

    const result = await textSearchTool.execute({
      query: "needle",
      maxResults: 8,
    }, {
      ...context,
      policy: {
        ...context.policy,
        maxResponseBytes: 1_200,
      },
    });

    expect(result.success).toBe(true);
    expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(1_200);
    const payload = parsePayload(result.output);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.length).toBeLessThan(8);
    expect(payload.truncated).toBe(true);
    expect(payload.nextCursor).toEqual(expect.any(String));
  });

  async function writeFile(relativePath: string, content: string): Promise<void> {
    const filePath = path.join(tempDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
});

function parsePayload(value: string): SearchPayload {
  return JSON.parse(value) as SearchPayload;
}
