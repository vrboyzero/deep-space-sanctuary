import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CodeIntel } from "../code-intel/code-intel.js";
import { TypeScriptLanguageServiceProvider } from "../code-intel/typescript-provider.js";
import type { ToolContext } from "../types.js";
import { createCodeIntelTool } from "./code-intel.js";

describe("code_intel tool", () => {
  let workspaceRoot: string;
  let codeIntel: CodeIntel;
  let context: ToolContext;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-code-intel-tool-"));
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" },
      include: ["src/**/*.ts"],
    }), "utf-8");
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "src", "greeter.ts"),
      "export function createGreeter(name: string): string { return `Hello ${name}`; }\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceRoot, "src", "contracts.ts"),
      [
        "export interface Greeter { greet(): string; }",
        "export class FriendlyGreeter implements Greeter { greet(): string { return \"hello\"; } }",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspaceRoot, "src", "usage.ts"),
      [
        "import { createGreeter } from \"./greeter.js\";",
        "import type { Greeter } from \"./contracts.js\";",
        "export const greeter: Greeter = { greet: () => createGreeter(\"Ada\") };",
        "",
      ].join("\n"),
      "utf-8",
    );
    codeIntel = new CodeIntel({ providers: [new TypeScriptLanguageServiceProvider()] });
    context = {
      conversationId: "conv-code-intel-tool",
      workspaceRoot,
      defaultCwd: workspaceRoot,
      workspaceRevisionId: "workspace-revision-1",
      policy: {
        allowedPaths: [],
        deniedPaths: [".git", "node_modules"],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 64 * 1024,
      },
    };
  });

  afterEach(async () => {
    codeIntel.dispose();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("returns live semantic symbol evidence through the public Tool interface", async () => {
    const tool = createCodeIntelTool({ codeIntel });
    const result = await tool.execute({
      operation: "symbols",
      query: "createGreeter",
      limit: 10,
    }, context);

    expect(result.success).toBe(true);
    expect(result.name).toBe("code_intel");
    expect(JSON.parse(result.output)).toMatchObject({
      contractVersion: "code-intel/v1",
      operation: "symbols",
      coordinateSystem: "zero-based-line-column",
      status: "completed",
      items: [{
        location: {
          scope: "workspace",
          path: "src/greeter.ts",
          range: {
            start: { line: 0, column: 16 },
            end: { line: 0, column: 29 },
          },
        },
        symbolKind: "function",
        documentRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }],
      page: { returned: 1, truncated: false },
      freshness: { status: "fresh" },
      provenance: {
        providerId: "typescript-language-service",
        providerVersion: expect.any(String),
        capability: "semantic-live",
        workspaceRevision: "workspace-revision-1",
        observedAtMs: expect.any(Number),
      },
      diagnostics: [],
      nextAction: {
        action: "inspect_returned_source_then_mutate_or_verify",
        targetPaths: ["src/greeter.ts"],
        instruction: expect.stringContaining("before any further broad exploration"),
      },
    });
    expect(result.metadata).toMatchObject({
      providerId: "typescript-language-service",
      capability: "semantic-live",
      returnedCount: 1,
      truncated: false,
    });
  });

  it("publishes an adoption and post-query progress contract to coding agents", () => {
    const tool = createCodeIntelTool({ codeIntel });

    expect(tool.definition.description).toContain("PRIMARY TS/JS NAVIGATION TOOL");
    expect(tool.definition.description).toContain("call code_intel before list_files");
    expect(tool.definition.description).toContain("Start with symbols and one identifier from the task");
    expect(tool.definition.description).toContain("before any further broad exploration");
    expect(tool.definition.parameters).toMatchObject({
      properties: {
        query: {
          description: expect.stringContaining("extract one identifier from the task"),
        },
      },
    });
  });

  it("routes definition, reference, and implementation locations without exposing TypeScript APIs", async () => {
    const tool = createCodeIntelTool({ codeIntel });
    const usageSource = await fs.readFile(path.join(workspaceRoot, "src", "usage.ts"), "utf-8");
    const contractsSource = await fs.readFile(path.join(workspaceRoot, "src", "contracts.ts"), "utf-8");

    const definition = await tool.execute({
      operation: "definition",
      path: "src/usage.ts",
      ...positionOf(usageSource, "createGreeter", { last: true }),
    }, context);
    const references = await tool.execute({
      operation: "references",
      path: "src/contracts.ts",
      ...positionOf(contractsSource, "Greeter"),
    }, context);
    const implementation = await tool.execute({
      operation: "implementation",
      path: "src/contracts.ts",
      ...positionOf(contractsSource, "Greeter"),
    }, context);

    expect(readOutput(definition)).toMatchObject({
      operation: "definition",
      items: [expect.objectContaining({
        location: expect.objectContaining({ path: "src/greeter.ts" }),
        symbolKind: "function",
      })],
    });
    expect(readOutput(references)).toMatchObject({
      operation: "references",
      items: expect.arrayContaining([
        expect.objectContaining({ location: expect.objectContaining({ path: "src/usage.ts" }) }),
      ]),
    });
    expect(readOutput(implementation)).toMatchObject({
      operation: "implementation",
      items: expect.arrayContaining([expect.objectContaining({
        location: expect.objectContaining({ path: "src/contracts.ts" }),
        symbolKind: "class",
      })]),
    });
  });

  it("fails closed outside a revision-bound coding workspace", async () => {
    const tool = createCodeIntelTool({ codeIntel });
    const missingCwd = await tool.execute(
      { operation: "symbols", query: "createGreeter" },
      { ...context, defaultCwd: undefined },
    );
    const missingRevision = await tool.execute(
      { operation: "symbols", query: "createGreeter" },
      { ...context, workspaceRevisionId: undefined },
    );

    expect(missingCwd).toMatchObject({
      success: false,
      failureKind: "environment_error",
      error: expect.stringContaining("coding workspace cwd"),
    });
    expect(missingRevision).toMatchObject({
      success: false,
      failureKind: "environment_error",
      error: expect.stringContaining("workspace revision"),
    });
  });

  it("rejects a semantic result that cannot fit the runtime response budget", async () => {
    const tool = createCodeIntelTool({ codeIntel });
    const result = await tool.execute(
      { operation: "symbols", query: "Greeter", limit: 10 },
      {
        ...context,
        policy: { ...context.policy, maxResponseBytes: 128 },
      },
    );

    expect(result).toMatchObject({
      success: false,
      failureKind: "input_error",
      output: "",
      error: expect.stringContaining("128 bytes"),
    });
  });
});

function positionOf(source: string, text: string, options: { last?: boolean } = {}) {
  const offset = options.last ? source.lastIndexOf(text) : source.indexOf(text);
  if (offset < 0) throw new Error(`Missing fixture text: ${text}`);
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, column: lines.at(-1)?.length ?? 0 };
}

function readOutput(result: Awaited<ReturnType<ReturnType<typeof createCodeIntelTool>["execute"]>>) {
  expect(result.success).toBe(true);
  return JSON.parse(result.output);
}
