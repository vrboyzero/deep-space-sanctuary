import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CodeIntel,
  InMemoryCodeIntelProvider,
  type CodeIntelProviderResult,
} from "./index.js";

const workspaceRoot = path.resolve("fixtures/code-intel-workspace");

describe("CodeIntel.query", () => {
  it("accepts a workspace symbol query without requiring a source location", async () => {
    const codeIntel = new CodeIntel({
      providers: [new InMemoryCodeIntelProvider({
        profile: {
          id: "in-memory-ts",
          version: "1.0.0",
          status: "available",
          operations: ["symbols"],
          capabilities: ["semantic-live"],
        },
        responses: [{
          match: { operation: "symbols", query: "Alpha" },
          result: providerResult(),
        }],
      })],
      now: () => 1_000,
    });

    const outcome = await codeIntel.query({
      workspace: {
        rootPath: workspaceRoot,
        revision: "workspace-rev-1",
        externalRoots: [],
      },
      operation: "symbols",
      query: "Alpha",
      requiredCapability: "semantic",
      deadlineAtMs: 2_000,
    });

    expect(outcome).toMatchObject({
      ok: true,
      result: { operation: "symbols", items: [{ symbolKind: "function" }] },
    });
  });

  it("returns bounded live-semantic evidence with an opaque continuation cursor", async () => {
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      result: providerResult({
        items: [
          item("src/alpha.ts", 4, 2, "function", "doc-alpha-v1"),
          item("src/beta.ts", 8, 0, "function", "doc-beta-v1"),
        ],
        nextCursor: "provider-page-2",
      }),
    });

    const outcome = await codeIntel.query(definitionRequest({ limit: 1 }));

    expect(outcome).toEqual({
      ok: true,
      result: {
        contractVersion: "code-intel/v1",
        operation: "definition",
        status: "partial",
        items: [item("src/alpha.ts", 4, 2, "function", "doc-alpha-v1")],
        page: {
          returned: 1,
          truncated: true,
          nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/u),
        },
        freshness: { status: "fresh" },
        provenance: {
          providerId: "in-memory-ts",
          providerVersion: "1.0.0",
          capability: "semantic-live",
          workspaceRevision: "workspace-rev-1",
          observedAtMs: 1_000,
        },
        diagnostics: [],
      },
    });
    if (outcome.ok) {
      expect(outcome.result.page.nextCursor).not.toContain("provider-page-2");
    }
  });

  it("rejects a continuation cursor reused for a different query location", async () => {
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      result: providerResult({
        items: [
          item("src/alpha.ts", 4, 2, "function", "doc-alpha-v1"),
          item("src/beta.ts", 8, 0, "function", "doc-beta-v1"),
        ],
        nextCursor: "provider-page-2",
      }),
    });
    const firstPage = await codeIntel.query(definitionRequest({ limit: 1 }));
    if (!firstPage.ok || !firstPage.result.page.nextCursor) {
      throw new Error("Expected a continuation cursor.");
    }

    const outcome = await codeIntel.query(definitionRequest({
      location: { path: "src/other.ts", line: 1, column: 0 },
      cursor: firstPage.result.page.nextCursor,
    }));

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "invalid_request",
        message: "CodeIntel cursor is invalid for this query.",
        retryable: false,
      },
    });
  });

  it("fails closed when semantic evidence is required but only syntax fallback is available", async () => {
    const codeIntel = createCodeIntel({
      capability: "syntax-fallback",
      result: providerResult(),
    });

    await expect(codeIntel.query(definitionRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: "capability_unavailable",
        message: "Required CodeIntel capability is unavailable.",
        retryable: false,
      },
    });
  });

  it("selects a later Provider when it is the first one that satisfies the required capability", async () => {
    const syntaxProvider = new InMemoryCodeIntelProvider({
      profile: {
        id: "in-memory-syntax",
        version: "1.0.0",
        status: "available",
        operations: ["definition"],
        capabilities: ["syntax-fallback"],
      },
      responses: [{
        match: { operation: "definition", path: "src/caller.ts", line: 2, column: 4 },
        result: providerResult({ capability: "syntax-fallback" }),
      }],
    });
    const semanticProvider = new InMemoryCodeIntelProvider({
      profile: {
        id: "in-memory-semantic",
        version: "1.0.0",
        status: "available",
        operations: ["definition"],
        capabilities: ["semantic-live"],
      },
      responses: [{
        match: { operation: "definition", path: "src/caller.ts", line: 2, column: 4 },
        result: providerResult(),
      }],
    });
    const codeIntel = new CodeIntel({ providers: [syntaxProvider, semanticProvider], now: () => 1_000 });

    const outcome = await codeIntel.query(definitionRequest());

    expect(outcome).toMatchObject({
      ok: true,
      result: { provenance: { providerId: "in-memory-semantic" } },
    });
  });

  it("preserves stale partial evidence without promoting it to a fresh semantic success", async () => {
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      result: providerResult({
        status: "partial",
        freshness: { status: "stale", reason: "workspace_revision_changed" },
        diagnostics: [{ code: "provider_partial", message: "Index refresh is pending." }],
      }),
    });

    const outcome = await codeIntel.query(definitionRequest());

    expect(outcome).toMatchObject({
      ok: true,
      result: {
        status: "partial",
        freshness: { status: "stale", reason: "workspace_revision_changed" },
        provenance: { capability: "semantic-live" },
        diagnostics: [{ code: "provider_partial", message: "Index refresh is pending." }],
      },
    });
  });

  it("rejects malformed freshness and diagnostic metadata from a Provider", async () => {
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      result: providerResult({
        freshness: { status: "stale" } as never,
        diagnostics: [{ code: "", message: "" }],
      }),
    });

    const outcome = await codeIntel.query(definitionRequest());

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "provider_contract_invalid",
        message: "CodeIntel Provider returned an invalid contract result.",
        retryable: false,
        providerId: "in-memory-ts",
      },
    });
  });

  it("normalizes a provider that exceeds the caller deadline to a stable timeout", async () => {
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      delayMs: 50,
      result: providerResult(),
    }, () => Date.now());

    const outcome = await codeIntel.query(definitionRequest({ deadlineAtMs: Date.now() + 5 }));

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "CodeIntel query exceeded its deadline.",
        retryable: true,
        providerId: "in-memory-ts",
      },
    });
  });

  it("checks the deadline again after a synchronous Provider returns", async () => {
    const observedTimes = [1_000, 2_001];
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      result: providerResult(),
    }, () => observedTimes.shift() ?? 2_001);

    const outcome = await codeIntel.query(definitionRequest());

    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "CodeIntel query exceeded its deadline.",
        retryable: true,
        providerId: "in-memory-ts",
      },
    });
  });

  it("normalizes a fake Provider crash without leaking its internal error", async () => {
    const codeIntel = new CodeIntel({
      providers: [new InMemoryCodeIntelProvider({
        profile: {
          id: "in-memory-ts",
          version: "1.0.0",
          status: "available",
          operations: ["definition"],
          capabilities: ["semantic-live"],
        },
        responses: [{
          match: { operation: "definition", path: "src/caller.ts", line: 2, column: 4 },
          errorMessage: "sensitive provider stack",
        }],
      })],
      now: () => 1_000,
    });

    await expect(codeIntel.query(definitionRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: "provider_failure",
        message: "CodeIntel Provider failed to answer the query.",
        retryable: true,
        providerId: "in-memory-ts",
      },
    });
  });

  it("rejects external provider locations that are outside the request allowlist", async () => {
    const codeIntel = createCodeIntel({
      capability: "semantic-live",
      result: providerResult({
        items: [{
          location: {
            scope: "external",
            path: path.resolve("outside/dependency.d.ts"),
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: 10 } },
          },
          symbolKind: "interface",
          documentRevision: "external-v1",
        }],
      }),
    });

    await expect(codeIntel.query(definitionRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: "provider_contract_invalid",
        message: "CodeIntel Provider returned evidence outside the allowed workspace scope.",
        retryable: false,
        providerId: "in-memory-ts",
      },
    });
  });
});

function createCodeIntel(
  input: {
    capability: "semantic-live" | "syntax-fallback";
    result: CodeIntelProviderResult;
    delayMs?: number;
  },
  now: () => number = () => 1_000,
) {
  return new CodeIntel({
    providers: [new InMemoryCodeIntelProvider({
      profile: {
        id: "in-memory-ts",
        version: "1.0.0",
        status: "available",
        operations: ["definition"],
        capabilities: [input.capability],
      },
      responses: [{
        match: { operation: "definition", path: "src/caller.ts", line: 2, column: 4 },
        result: input.result,
        ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
      }],
    })],
    now,
  });
}

function definitionRequest(overrides: Record<string, unknown> = {}) {
  return {
    workspace: {
      rootPath: workspaceRoot,
      revision: "workspace-rev-1",
      externalRoots: [path.resolve("allowed-types")],
    },
    operation: "definition" as const,
    location: { path: "src/caller.ts", line: 2, column: 4 },
    requiredCapability: "semantic" as const,
    deadlineAtMs: 2_000,
    ...overrides,
  };
}

function providerResult(overrides: Partial<CodeIntelProviderResult> = {}): CodeIntelProviderResult {
  return {
    status: "completed",
    capability: "semantic-live",
    items: [item("src/alpha.ts", 4, 2, "function", "doc-alpha-v1")],
    freshness: { status: "fresh" },
    diagnostics: [],
    ...overrides,
  };
}

function item(
  itemPath: string,
  line: number,
  column: number,
  symbolKind: "function" | "interface",
  documentRevision: string,
) {
  return {
    location: {
      scope: "workspace" as const,
      path: itemPath,
      range: {
        start: { line, column },
        end: { line, column: column + 1 },
      },
    },
    symbolKind,
    documentRevision,
  };
}
