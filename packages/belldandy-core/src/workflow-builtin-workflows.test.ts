import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import type { WorkflowContext, WorkflowTaskResult } from "@belldandy/agent";
import {
  registerBuiltinWorkflow,
  getBuiltinWorkflow,
  clearBuiltinWorkflows,
  listBuiltinWorkflows,
} from "./workflow-builtin-registry.js";
import { registerCodeAuditBuiltinWorkflow } from "./workflow-builtin-code-audit.js";
import { registerParallelResearchBuiltinWorkflow } from "./workflow-builtin-parallel-research.js";

// ─── Mock WorkflowContext ─────────────────────────────────────────────────

function createMockCtx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  const phases: string[] = [];
  const logs: string[] = [];
  const phaseSpy = vi.fn((title: string) => phases.push(title));
  const logSpy = vi.fn((msg: string) => logs.push(msg));
  return {
    args: {},
    phase: phaseSpy,
    log: logSpy,
    agent: vi.fn(async (prompt: string) => `mock response for: ${prompt.slice(0, 30)}`),
    parallel: vi.fn(async <T>(tasks: Array<() => Promise<T>>): Promise<Array<WorkflowTaskResult<T>>> => {
      return Promise.all(
        tasks.map(async (task, index) => {
          try {
            const value = await task();
            return { ok: true as const, value, taskId: `task_${index}`, cacheHit: false };
          } catch (err) {
            return { ok: false as const, error: String(err), taskId: `task_${index}` };
          }
        }),
      );
    }),
    parallelMap: vi.fn(async <T, U>(
      items: T[],
      mapper: (item: T, index: number, ctx: WorkflowContext) => Promise<U>,
    ): Promise<Array<WorkflowTaskResult<U>>> => {
      return Promise.all(
        items.map(async (item, index) => {
          try {
            const value = await mapper(item, index, createMockCtx());
            return { ok: true as const, value, taskId: `map_${index}`, cacheHit: false };
          } catch (err) {
            return { ok: false as const, error: String(err), taskId: `map_${index}` };
          }
        }),
      );
    }),
    ...overrides,
  } as unknown as WorkflowContext;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe("code-audit builtin workflow", () => {
  beforeEach(() => clearBuiltinWorkflows());
  afterEach(() => clearBuiltinWorkflows());

  it("注册到 BUILTIN_WORKFLOWS", () => {
    registerCodeAuditBuiltinWorkflow();
    const entry = getBuiltinWorkflow("code-audit");
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("code-audit");
    expect(entry?.description).toContain("审计");
    expect(entry?.workflowVersion).toBe("1.0.0");
    expect(entry?.scriptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scriptHash 稳定（多次注册相同）", () => {
    registerCodeAuditBuiltinWorkflow();
    const hash1 = getBuiltinWorkflow("code-audit")?.scriptHash;
    clearBuiltinWorkflows();
    registerCodeAuditBuiltinWorkflow();
    const hash2 = getBuiltinWorkflow("code-audit")?.scriptHash;
    expect(hash1).toBe(hash2);
  });

  it("default 函数可执行（3 阶段）", async () => {
    registerCodeAuditBuiltinWorkflow();
    const entry = getBuiltinWorkflow("code-audit")!;
    const ctx = createMockCtx({ args: { targetDir: "src", modules: ["auth", "api"] } });
    const result = await entry.default(ctx);
    expect(result).toContain("mock response");
    // 验证调用了 phase 3 次
    expect((ctx.phase as any)).toHaveBeenCalled();
    // 验证调用了 parallel（阶段1）
    expect((ctx.parallel as any)).toHaveBeenCalled();
    // 验证调用了 agent（阶段3 汇总）
    expect((ctx.agent as any)).toHaveBeenCalled();
  });

  it("使用默认 modules 当 args.modules 未提供", async () => {
    registerCodeAuditBuiltinWorkflow();
    const entry = getBuiltinWorkflow("code-audit")!;
    const ctx = createMockCtx({ args: {} });
    await entry.default(ctx);
    // parallel 应该被调用，且 tasks 数量 = 默认 4 个模块
    const parallelCalls = (ctx.parallel as any).mock.calls;
    expect(parallelCalls.length).toBeGreaterThanOrEqual(1);
    const firstCallTasks = parallelCalls[0][0];
    expect(firstCallTasks.length).toBe(4);
  });

  it("部分扫描失败时继续验证已完成的", async () => {
    registerCodeAuditBuiltinWorkflow();
    const entry = getBuiltinWorkflow("code-audit")!;
    let parallelCallCount = 0;
    const ctx = createMockCtx({
      args: { modules: ["a", "b"] },
      parallel: (vi.fn(async (tasks: any) => {
        parallelCallCount++;
        if (parallelCallCount === 1) {
          // 第一次 parallel（扫描）：第一个成功，第二个失败
          return [
            { ok: true, value: "scan result a", taskId: "t0", cacheHit: false },
            { ok: false, error: "scan failed", taskId: "t1" },
          ];
        }
        // 第二次 parallel（验证）：全部成功
        return Promise.all(tasks.map(async (task: any, i: number) => ({
          ok: true as const,
          value: await task(),
          taskId: `v${i}`,
          cacheHit: false,
        })));
      }) as any),
    });
    const result = await entry.default(ctx);
    expect(result).toContain("mock response");
  });

  it("全部扫描失败时抛错，不生成成功报告", async () => {
    registerCodeAuditBuiltinWorkflow();
    const entry = getBuiltinWorkflow("code-audit")!;
    const ctx = createMockCtx({
      args: { modules: ["a", "b"] },
      parallel: (vi.fn(async () => [
        { ok: false, error: "scan failed", taskId: "t0" },
        { ok: false, error: "scan failed", taskId: "t1" },
      ]) as any),
    });
    await expect(entry.default(ctx)).rejects.toThrow(/扫描均失败|无法继续审计/);
  });

  it("交叉验证没有有效结果时抛错，不生成成功报告", async () => {
    registerCodeAuditBuiltinWorkflow();
    const entry = getBuiltinWorkflow("code-audit")!;
    let parallelCallCount = 0;
    const ctx = createMockCtx({
      args: { modules: ["a"] },
      parallel: (vi.fn(async (tasks: any) => {
        parallelCallCount++;
        if (parallelCallCount === 1) {
          return [
            { ok: true, value: "scan result a", taskId: "t0", cacheHit: false },
          ];
        }
        return Promise.all(tasks.map(async (_task: any, i: number) => ({
          ok: false as const,
          error: `verify failed ${i}`,
          taskId: `v${i}`,
        })));
      }) as any),
    });
    await expect(entry.default(ctx)).rejects.toThrow(/未通过验证|无法生成审计报告/);
  });
});

describe("parallel-research builtin workflow", () => {
  beforeEach(() => clearBuiltinWorkflows());
  afterEach(() => clearBuiltinWorkflows());

  it("注册到 BUILTIN_WORKFLOWS", () => {
    registerParallelResearchBuiltinWorkflow();
    const entry = getBuiltinWorkflow("parallel-research");
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("parallel-research");
    expect(entry?.description).toContain("研究");
    expect(entry?.workflowVersion).toBe("1.0.0");
    expect(entry?.scriptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("scriptHash 稳定", () => {
    registerParallelResearchBuiltinWorkflow();
    const hash1 = getBuiltinWorkflow("parallel-research")?.scriptHash;
    clearBuiltinWorkflows();
    registerParallelResearchBuiltinWorkflow();
    const hash2 = getBuiltinWorkflow("parallel-research")?.scriptHash;
    expect(hash1).toBe(hash2);
  });

  it("default 函数可执行（2 阶段）", async () => {
    registerParallelResearchBuiltinWorkflow();
    const entry = getBuiltinWorkflow("parallel-research")!;
    const ctx = createMockCtx({ args: { topics: ["AI agents", "RAG systems"] } });
    const result = await entry.default(ctx);
    expect(result).toContain("mock response");
    expect((ctx.parallelMap as any)).toHaveBeenCalled();
    expect((ctx.agent as any)).toHaveBeenCalled();
  });

  it("topics 为空时抛错", async () => {
    registerParallelResearchBuiltinWorkflow();
    const entry = getBuiltinWorkflow("parallel-research")!;
    const ctx = createMockCtx({ args: {} });
    await expect(entry.default(ctx)).rejects.toThrow(/topics/);
  });

  it("topics 非数组时抛错", async () => {
    registerParallelResearchBuiltinWorkflow();
    const entry = getBuiltinWorkflow("parallel-research")!;
    const ctx = createMockCtx({ args: { topics: "not-an-array" } });
    await expect(entry.default(ctx)).rejects.toThrow(/topics/);
  });

  it("depth 参数影响 prompt", async () => {
    registerParallelResearchBuiltinWorkflow();
    const entry = getBuiltinWorkflow("parallel-research")!;
    const ctx = createMockCtx({ args: { topics: ["test"], depth: "deep" } });
    await entry.default(ctx);
    const agentCalls = (ctx.agent as any).mock.calls;
    // parallelMap 内部的 agent 调用应该包含 depth 提示
    expect(agentCalls.length).toBeGreaterThan(0);
  });

  it("所有主题研究失败时抛错", async () => {
    registerParallelResearchBuiltinWorkflow();
    const entry = getBuiltinWorkflow("parallel-research")!;
    const ctx = createMockCtx({
      args: { topics: ["a", "b"] },
      parallelMap: (vi.fn(async () => [
        { ok: false, error: "research failed", taskId: "m0" },
        { ok: false, error: "research failed", taskId: "m1" },
      ]) as any),
    });
    await expect(entry.default(ctx)).rejects.toThrow(/研究均失败|无法生成汇总报告/);
  });
});

describe("同时注册两个 builtin 工作流", () => {
  beforeEach(() => clearBuiltinWorkflows());
  afterEach(() => clearBuiltinWorkflows());

  it("listBuiltinWorkflows 返回两个", () => {
    registerCodeAuditBuiltinWorkflow();
    registerParallelResearchBuiltinWorkflow();
    const list = listBuiltinWorkflows();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.name).sort()).toEqual(["code-audit", "parallel-research"]);
  });

  it("两个工作流 scriptHash 不同", () => {
    registerCodeAuditBuiltinWorkflow();
    registerParallelResearchBuiltinWorkflow();
    const audit = getBuiltinWorkflow("code-audit")!;
    const research = getBuiltinWorkflow("parallel-research")!;
    expect(audit.scriptHash).not.toBe(research.scriptHash);
  });
});
