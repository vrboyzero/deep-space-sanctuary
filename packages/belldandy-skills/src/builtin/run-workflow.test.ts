import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runWorkflowTool, RUN_WORKFLOW_TOOL_NAME } from "./run-workflow.js";
import type { ToolContext, WorkflowRuntimeCapabilities, WorkflowRunResultLike } from "../types.js";

// ─── Mock WorkflowRuntime ─────────────────────────────────────────────────

function createMockWorkflowRuntime(behavior: {
  runResult?: Partial<WorkflowRunResultLike>;
  throwError?: Error;
}): WorkflowRuntimeCapabilities {
  return {
    run: vi.fn(async () => {
      if (behavior.throwError) throw behavior.throwError;
      return {
        success: true,
        output: "workflow output",
        journalId: "wf_test_123",
        scriptHash: "hash_abc",
        workflowName: "test-wf",
        workflowVersion: "1.0.0",
        stats: { agentCalls: 3, cacheHits: 1, totalTokens: 500, durationMs: 1000 },
        ...behavior.runResult,
      } as WorkflowRunResultLike;
    }),
    stop: vi.fn(async () => true),
    getStatus: vi.fn(() => null),
    listActiveRuns: vi.fn(() => []),
  };
}

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: "conv-test-1",
    workspaceRoot: "/tmp/test",
    stateDir: "/tmp/test",
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 30000,
      maxResponseBytes: 512000,
    },
    ...overrides,
  } as ToolContext;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe("run_workflow tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-run-wf-tool-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("工具定义正确", () => {
    expect(runWorkflowTool.definition.name).toBe(RUN_WORKFLOW_TOOL_NAME);
    expect(runWorkflowTool.definition.parameters.required).toEqual(["workflowName"]);
    expect(runWorkflowTool.contract?.family).toBe("session-orchestration");
    expect(runWorkflowTool.contract?.riskLevel).toBe("low");
  });

  it("缺少 workflowName 时返回 input_error", async () => {
    const ctx = createToolContext({ workflowRuntime: createMockWorkflowRuntime({}) });
    const result = await runWorkflowTool.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("input_error");
    expect(result.error).toBe("workflowName is required");
  });

  it("缺少 workflowRuntime 时返回 environment_error", async () => {
    const ctx = createToolContext(); // 无 workflowRuntime
    const result = await runWorkflowTool.execute({ workflowName: "test" }, ctx);
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("environment_error");
    expect(result.error).toMatch(/not available/i);
  });

  it("file 模式找不到文件时返回 input_error", async () => {
    const ctx = createToolContext({
      stateDir: tempDir,
      workflowRuntime: createMockWorkflowRuntime({}),
    });
    const result = await runWorkflowTool.execute({ workflowName: "nonexistent" }, ctx);
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("input_error");
    expect(result.error).toMatch(/not found/i);
  });

  it("file 模式找到文件时调用 runtime.run 成功", async () => {
    // 创建 workflows 目录和脚本文件
    const workflowsDir = path.join(tempDir, "workflows");
    await fs.mkdir(workflowsDir, { recursive: true });
    const wfPath = path.join(workflowsDir, "test-wf.mjs");
    await fs.writeFile(wfPath, `export default async function(ctx) { return "ok"; }\n`, "utf-8");

    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    const result = await runWorkflowTool.execute({ workflowName: "test-wf" }, ctx);

    expect(result.success).toBe(true);
    expect(result.output).toContain("test-wf");
    expect(result.output).toContain("wf_test_123");
    expect(result.metadata?.journalId).toBe("wf_test_123");
    expect(mockRuntime.run).toHaveBeenCalledTimes(1);
  });

  it("builtin 模式调用 runtime.run 成功", async () => {
    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    const result = await runWorkflowTool.execute(
      { workflowName: "code-audit", sourceKind: "builtin" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(mockRuntime.run).toHaveBeenCalledTimes(1);
    const callArgs = (mockRuntime.run as any).mock.calls[0][0];
    expect(callArgs.source.kind).toBe("builtin");
    expect(callArgs.source.name).toBe("code-audit");
  });

  it("inline 模式透传 inlineCode 与 allowInlineScript", async () => {
    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    const result = await runWorkflowTool.execute(
      {
        workflowName: "inline-audit",
        sourceKind: "inline",
        inlineCode: `export default async function(ctx) { return "inline ok"; }`,
        allowInlineScript: true,
      },
      ctx,
    );
    expect(result.success).toBe(true);
    const callArgs = (mockRuntime.run as any).mock.calls[0][0];
    expect(callArgs.source).toEqual({
      kind: "inline",
      name: "inline-audit",
      code: `export default async function(ctx) { return "inline ok"; }`,
    });
    expect(callArgs.allowInlineScript).toBe(true);
  });

  it("inline 模式缺少 inlineCode 时返回 input_error", async () => {
    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    const result = await runWorkflowTool.execute(
      { workflowName: "inline-audit", sourceKind: "inline", allowInlineScript: true },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("input_error");
    expect(result.error).toMatch(/inlineCode is required/i);
  });

  it("runtime.run 抛错时返回 business_logic_error", async () => {
    const mockRuntime = createMockWorkflowRuntime({ throwError: new Error("runtime boom") });
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    const result = await runWorkflowTool.execute(
      { workflowName: "test", sourceKind: "builtin" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("business_logic_error");
    expect(result.error).toMatch(/runtime boom/);
  });

  it("budget 参数透传到 runtime.run", async () => {
    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    await runWorkflowTool.execute(
      {
        workflowName: "test",
        sourceKind: "builtin",
        budget: { maxAgentCalls: 10, maxTokens: 5000 },
      },
      ctx,
    );
    const callArgs = (mockRuntime.run as any).mock.calls[0][0];
    expect(callArgs.budget.maxAgentCalls).toBe(10);
    expect(callArgs.budget.maxTokens).toBe(5000);
  });

  it("resumeJournalId 参数透传", async () => {
    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    await runWorkflowTool.execute(
      {
        workflowName: "test",
        sourceKind: "builtin",
        resumeJournalId: "wf_resume_001",
      },
      ctx,
    );
    const callArgs = (mockRuntime.run as any).mock.calls[0][0];
    expect(callArgs.resumeJournalId).toBe("wf_resume_001");
  });

  it("args 参数透传", async () => {
    const mockRuntime = createMockWorkflowRuntime({});
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    await runWorkflowTool.execute(
      {
        workflowName: "test",
        sourceKind: "builtin",
        args: { targetDir: "src", count: 5 },
      },
      ctx,
    );
    const callArgs = (mockRuntime.run as any).mock.calls[0][0];
    expect(callArgs.args).toEqual({ targetDir: "src", count: 5 });
  });

  it("失败的工作流结果正确反映在工具结果中", async () => {
    const mockRuntime = createMockWorkflowRuntime({
      runResult: {
        success: false,
        error: "budget exceeded",
        output: "",
        stats: { agentCalls: 3, cacheHits: 0, totalTokens: 10000, durationMs: 500 },
      },
    });
    const ctx = createToolContext({ stateDir: tempDir, workflowRuntime: mockRuntime });
    const result = await runWorkflowTool.execute(
      { workflowName: "test", sourceKind: "builtin" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("budget exceeded");
    expect(result.failureKind).toBe("business_logic_error");
  });
});
