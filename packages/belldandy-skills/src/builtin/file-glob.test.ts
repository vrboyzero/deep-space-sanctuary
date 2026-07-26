import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ToolContext } from "../types.js";
import { fileGlobTool } from "./file-glob.js";

type FileGlobPayload = {
  root: string;
  include?: string[];
  exclude?: string[];
  results: string[];
  truncated: boolean;
  ignore: {
    mode: "respected" | "overridden";
    gitignoreFiles: number;
  };
  skipped: {
    ignored: number;
    hidden: number;
    sensitive: number;
    policyDenied: number;
    excluded: number;
  };
};

describe("file_glob", () => {
  let tempDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-file-glob-"));
    context = {
      conversationId: "conv-file-glob",
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

  it("returns a stable include/exclude file inventory while respecting workspace boundaries", async () => {
    await writeFile(".gitignore", "ignored/\n*.generated.ts\n!src/keep.generated.ts\n");
    await writeFile("src/alpha.ts", "export const alpha = true;\n");
    await writeFile("src/beta.ts", "export const beta = true;\n");
    await writeFile("src/generated.generated.ts", "generated\n");
    await writeFile("src/keep.generated.ts", "keep\n");
    await writeFile("docs/readme.md", "docs\n");
    await writeFile("ignored/private.ts", "ignored\n");
    await writeFile(".hidden.ts", "hidden\n");
    await writeFile(".env", "secret\n");
    await writeFile("restricted/blocked.ts", "blocked\n");

    const result = await fileGlobTool.execute({
      include: ["**/*.ts", "**/*.md"],
      exclude: "src/beta.ts",
    }, context);

    expect(result.success).toBe(true);
    const payload = parsePayload(result.output);
    expect(payload.root).toBe(".");
    expect(payload.include).toEqual(["**/*.ts", "**/*.md"]);
    expect(payload.exclude).toEqual(["src/beta.ts"]);
    expect(payload.results).toEqual(["docs/readme.md", "src/alpha.ts", "src/keep.generated.ts"]);
    expect(payload.truncated).toBe(false);
    expect(payload.ignore).toMatchObject({ mode: "respected", gitignoreFiles: 1 });
    expect(payload.skipped).toMatchObject({
      ignored: expect.any(Number),
      hidden: expect.any(Number),
      sensitive: expect.any(Number),
      policyDenied: expect.any(Number),
      excluded: 1,
    });
  });

  it("only overrides gitignore when requested and never exposes sensitive paths", async () => {
    await writeFile(".gitignore", "ignored/\n");
    await writeFile("visible.ts", "visible\n");
    await writeFile("ignored/private.ts", "ignored\n");
    await writeFile(".hidden.ts", "hidden\n");
    await writeFile(".env", "secret\n");

    const result = await fileGlobTool.execute({
      include: "**/*.ts",
      includeIgnored: true,
      includeHidden: true,
    }, context);

    expect(result.success).toBe(true);
    const payload = parsePayload(result.output);
    expect(payload.results).toEqual([".hidden.ts", "ignored/private.ts", "visible.ts"]);
    expect(payload.ignore.mode).toBe("overridden");
    expect(payload.skipped.sensitive).toBeGreaterThan(0);
  });

  it("keeps the response valid and bounded when the matching file set is large", async () => {
    for (let index = 0; index < 24; index += 1) {
      await writeFile(`src/result-${String(index).padStart(2, "0")}-${"x".repeat(48)}.ts`, "export {};\n");
    }

    const result = await fileGlobTool.execute({
      include: "src/**/*.ts",
      maxResults: 24,
    }, {
      ...context,
      policy: {
        ...context.policy,
        maxResponseBytes: 1_000,
      },
    });

    expect(result.success).toBe(true);
    expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(1_000);
    const payload = parsePayload(result.output);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.length).toBeLessThan(24);
    expect(payload.truncated).toBe(true);
  });

  async function writeFile(relativePath: string, content: string): Promise<void> {
    const target = path.join(tempDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
  }
});

function parsePayload(value: string): FileGlobPayload {
  return JSON.parse(value) as FileGlobPayload;
}
