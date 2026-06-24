import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { handleWorkflowMethod } from "./workflow.js";
import { registerBuiltinWorkflow, clearBuiltinWorkflows } from "../workflow-builtin-registry.js";
import type { WorkflowRuntimeCapabilities, WorkflowRunResultLike } from "@belldandy/skills";

// ─── Mock WorkflowRuntime ─────────────────────────────────────────────────

function createMockWorkflowRuntime(): WorkflowRuntimeCapabilities {
  return {
    run: vi.fn(async (opts): Promise<WorkflowRunResultLike> => {
      return {
        success: true,
        output: "rpc workflow output",
        journalId: "wf_rpc_001",
        scriptHash: "rpc_hash",
        workflowName: "rpc-wf",
        workflowVersion: "1.0.0",
        stats: { agentCalls: 2, cacheHits: 0, totalTokens: 300, durationMs: 500 },
      };
    }),
    stop: vi.fn(async () => true),
    getStatus: vi.fn(() => ({
      status: "done",
      journalId: "wf_rpc_001",
      workflowName: "rpc-wf",
      scriptHash: "rpc_hash",
      stats: { total: 2, done: 2, errors: 0, pending: 0, skipped: 0, totalTokens: 300, cacheHits: 0 },
      budgetUsage: { tokens: 300, calls: 2, retries: 0, durationMs: 500, exceeded: false },
    })),
    listActiveRuns: vi.fn(() => []),
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe("handleWorkflowMethod", () => {
  let tempDir: string;
  let mockRuntime: WorkflowRuntimeCapabilities;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-wf-rpc-"));
    mockRuntime = createMockWorkflowRuntime();
    clearBuiltinWorkflows();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    clearBuiltinWorkflows();
  });

  it("非 workflow.* 方法返回 null", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "1", method: "goal.list" },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result).toBeNull();
  });

  it("缺少 workflowRuntime 时返回 not_available", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "1", method: "workflow.list" },
      { stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("not_available");
    }
  });

  it("workflow.run 缺少 workflowName 返回 invalid_params", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "2", method: "workflow.run", params: {} },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("workflow.run builtin 模式成功", async () => {
    const result = await handleWorkflowMethod(
      {
        type: "req", id: "3", method: "workflow.run",
        params: { workflowName: "test-builtin", sourceKind: "builtin" },
      },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.payload?.result).toBeDefined();
      expect((result.payload as any).result.success).toBe(true);
    }
  });

  it("workflow.run inline 模式透传 inlineCode 与 allowInlineScript", async () => {
    const result = await handleWorkflowMethod(
      {
        type: "req",
        id: "3-inline",
        method: "workflow.run",
        params: {
          workflowName: "inline-audit",
          sourceKind: "inline",
          inlineCode: `export default async function(ctx) { return "inline ok"; }`,
          allowInlineScript: true,
        },
      },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
    const callArgs = (mockRuntime.run as any).mock.calls[0][0];
    expect(callArgs.source).toEqual({
      kind: "inline",
      name: "inline-audit",
      code: `export default async function(ctx) { return "inline ok"; }`,
    });
    expect(callArgs.allowInlineScript).toBe(true);
  });

  it("workflow.run inline 模式缺少 inlineCode 返回 invalid_params", async () => {
    const result = await handleWorkflowMethod(
      {
        type: "req",
        id: "3-inline-missing",
        method: "workflow.run",
        params: {
          workflowName: "inline-audit",
          sourceKind: "inline",
          allowInlineScript: true,
        },
      },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("invalid_params");
      expect(result.error.message).toMatch(/inlineCode is required/i);
    }
  });

  it("workflow.run file 模式找不到文件返回 invalid_params", async () => {
    const result = await handleWorkflowMethod(
      {
        type: "req", id: "4", method: "workflow.run",
        params: { workflowName: "nonexistent" },
      },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("invalid_params");
      expect(result.error.message).toMatch(/not found/i);
    }
  });

  it("workflow.run file 模式找到文件成功", async () => {
    const workflowsDir = path.join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(
      path.join(workflowsDir, "test-file.mjs"),
      `export default async function(ctx) { return "ok"; }\n`,
      "utf-8",
    );
    const result = await handleWorkflowMethod(
      {
        type: "req", id: "5", method: "workflow.run",
        params: { workflowName: "test-file" },
      },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
  });

  it("workflow.status 缺少 journalId 返回 invalid_params", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "6", method: "workflow.status", params: {} },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("workflow.status 成功返回状态", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "7", method: "workflow.status", params: { journalId: "wf_rpc_001" } },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.payload?.status).toBeDefined();
    }
  });

  it("workflow.status 不存在的 journalId 返回 not_found", async () => {
    const runtime: WorkflowRuntimeCapabilities = {
      ...mockRuntime,
      getStatus: vi.fn(() => null),
    };
    const result = await handleWorkflowMethod(
      { type: "req", id: "8", method: "workflow.status", params: { journalId: "nonexistent" } },
      { workflowRuntime: runtime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("workflow.stop 成功", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "9", method: "workflow.stop", params: { journalId: "wf_001" } },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.payload?.stopped).toBe(true);
    }
  });

  it("workflow.stop 缺少 journalId 返回 invalid_params", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "10", method: "workflow.stop", params: {} },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.code).toBe("invalid_params");
    }
  });

  it("workflow.list 返回文件和 builtin 列表", async () => {
    const workflowsDir = path.join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(path.join(workflowsDir, "a.mjs"), `export default async function(ctx) { return "a"; }\n`, "utf-8");
    await fs.writeFile(path.join(workflowsDir, "b.ts"), `export default async function(ctx): Promise<string> { return "b"; }\n`, "utf-8");

    registerBuiltinWorkflow({
      name: "builtin-x",
      description: "test builtin",
      scriptHash: "h1",
      default: async () => "x",
    });

    const result = await handleWorkflowMethod(
      { type: "req", id: "11", method: "workflow.list" },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const payload = result.payload as any;
      expect(payload.fileWorkflows.length).toBe(2);
      expect(payload.fileWorkflows.map((f: any) => f.name).sort()).toEqual(["a", "b"]);
      expect(payload.builtinWorkflows.length).toBe(1);
      expect(payload.builtinWorkflows[0].name).toBe("builtin-x");
    }
  });

  it("workflow.list 目录不存在时返回空列表", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "12", method: "workflow.list" },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      const payload = result.payload as any;
      expect(payload.fileWorkflows).toEqual([]);
      expect(payload.builtinWorkflows).toEqual([]);
    }
  });

  it("未知 workflow.* 方法返回 null", async () => {
    const result = await handleWorkflowMethod(
      { type: "req", id: "13", method: "workflow.unknown" },
      { workflowRuntime: mockRuntime, stateDir: tempDir },
    );
    expect(result).toBeNull();
  });
});
