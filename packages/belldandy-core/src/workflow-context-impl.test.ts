import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryStore } from "@belldandy/memory";
import type { SpawnOptions, SpawnResult, SubAgentEvent } from "@belldandy/agent";
import { WorkflowJournal } from "./workflow-journal.js";
import { WorkflowBudgetGuard, WorkflowBudgetExceededError } from "./workflow-budget-guard.js";
import { createWorkflowContext, type WorkflowContextDeps } from "./workflow-context-impl.js";

// ─── Mock Orchestrator ────────────────────────────────────────────────────

type MockSpawnBehavior = (opts: SpawnOptions) => Promise<SpawnResult> | SpawnResult;

function createMockOrchestrator(behavior: MockSpawnBehavior) {
  const spawnCalls: SpawnOptions[] = [];
  return {
    resolveLaunchSpec: vi.fn((input: any) => ({
      instruction: input.instruction ?? "",
      parentConversationId: input.parentConversationId ?? "system",
      agentId: input.agentId ?? "default",
      profileId: input.agentId ?? "default",
      modelOverride: input.modelOverride,
      background: true,
      timeoutMs: input.timeoutMs ?? 120_000,
      channel: "subtask",
      context: input.context,
      role: input.role,
      allowedToolFamilies: input.allowedToolFamilies,
      maxToolRiskLevel: input.maxToolRiskLevel,
      permissionMode: input.permissionMode,
      policySummary: input.policySummary,
      delegationProtocol: input.delegationProtocol,
    })),
    spawn: vi.fn(async (opts: SpawnOptions): Promise<SpawnResult> => {
      spawnCalls.push(opts);
      return behavior(opts);
    }),
    spawnCalls,
    spawnParallel: vi.fn(),
    listSessions: vi.fn(() => []),
    getSession: vi.fn(() => undefined),
    stopSession: vi.fn(async () => false),
    cleanup: vi.fn(() => 0),
    queueSize: 0,
  };
}

function successResult(output: string): SpawnResult {
  return { success: true, output, sessionId: `mock_${Math.random().toString(36).slice(2, 10)}` };
}

function errorResult(error: string): SpawnResult {
  return { success: false, output: "", error, sessionId: "mock_err" };
}

/** 从 SpawnOptions 中提取 instruction（兼容 legacy 和 launchSpec 模式） */
function getInstruction(opts: SpawnOptions): string {
  if ("instruction" in opts) return opts.instruction;
  return opts.launchSpec.instruction ?? "";
}

// ─── 测试夹具 ─────────────────────────────────────────────────────────────

async function setupContext(overrides: Partial<WorkflowContextDeps> & { orchestratorBehavior?: MockSpawnBehavior } = {}) {
  const rootDir = path.join(os.tmpdir(), `belldandy-wf-ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(rootDir, { recursive: true });
  const dbPath = path.join(rootDir, "memory.db");
  const store = new MemoryStore(dbPath);
  const journal = new WorkflowJournal(store.getDbHandleForSharedSchema());
  const budgetGuard = new WorkflowBudgetGuard({ maxAgentCalls: 100, maxTokens: 1_000_000 });
  const orchestrator = createMockOrchestrator(
    overrides.orchestratorBehavior ?? ((opts) => successResult(`result for: ${getInstruction(opts).slice(0, 20)}`)),
  );
  const events: SubAgentEvent[] = [];
  const phases: string[] = [];
  const logs: string[] = [];
  const ctx = createWorkflowContext({
    orchestrator: orchestrator as any,
    journal,
    budgetGuard,
    args: { targetDir: "src" },
    scriptHash: "test-hash-001",
    workflowName: "test-workflow",
    workflowVersion: "1.0.0",
    parentConversationId: "parent-conv-1",
    channel: "test",
    journalId: `journal-${Date.now()}`,
    maxConcurrent: 3,
    callbacks: {
      onPhase: (title) => phases.push(title),
      onLog: (msg) => logs.push(msg),
      onAgentEvent: (event) => events.push(event),
    },
    ...overrides,
  });
  return {
    ctx, orchestrator, journal, budgetGuard, store, rootDir,
    events, phases, logs,
    cleanup: async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {}); },
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe("createWorkflowContext", () => {
  let fixtures: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of fixtures) {
      await cleanup();
    }
    fixtures = [];
  });

  describe("agent()", () => {
    it("未命中缓存时调用 orchestrator.spawn 并写入 journal", async () => {
      const f = await setupContext({ journalId: "journal-basic" });
      fixtures.push(f.cleanup);
      const result = await f.ctx.agent("扫描 auth 模块", { callKey: "scan/0" });
      expect(result).toContain("result for:");
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(1);
      const rows = f.journal.listByJournal("journal-basic");
      expect(rows.some((r) => r.status === "done")).toBe(true);
    });

    it("透传 model/role/工具约束/timeout 到 launchSpec", async () => {
      const f = await setupContext({ journalId: "journal-launch-spec" });
      fixtures.push(f.cleanup);
      await f.ctx.agent("扫描 auth 模块", {
        callKey: "scan/0",
        model: "claude-opus",
        role: "researcher",
        allowedToolFamilies: ["workspace-read", "network-read"],
        maxToolRiskLevel: "medium",
        timeoutMs: 45_000,
      });
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(1);
      const [spawnCall] = f.orchestrator.spawnCalls;
      expect("launchSpec" in spawnCall).toBe(true);
      if (!("launchSpec" in spawnCall)) {
        throw new Error("expected launchSpec spawn call");
      }
      expect(spawnCall.launchSpec).toMatchObject({
        instruction: "扫描 auth 模块",
        parentConversationId: "parent-conv-1",
        modelOverride: "claude-opus",
        role: "researcher",
        allowedToolFamilies: ["workspace-read", "network-read"],
        maxToolRiskLevel: "medium",
        timeoutMs: 45_000,
      });
    });

    it("fingerprint 绑定 agentProfileId/systemPromptHash/toolPolicyHash，字段变化时不命中缓存", async () => {
      const resolver = vi.fn()
        .mockReturnValueOnce({
          agentProfileId: "ops-coder",
          systemPromptHash: "sys-a",
          toolPolicyHash: "policy-a",
        })
        .mockReturnValueOnce({
          agentProfileId: "ops-coder",
          systemPromptHash: "sys-b",
          toolPolicyHash: "policy-a",
        });
      const f = await setupContext({
        journalId: "journal-fingerprint-extra",
        resolveAgentExecutionFingerprintInputs: resolver,
      });
      fixtures.push(f.cleanup);
      await f.ctx.agent("扫描 auth", { callKey: "scan/0", role: "researcher" });
      await f.ctx.agent("扫描 auth", { callKey: "scan/0", role: "researcher" });
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(2);
    });

    it("相同 callKey + prompt 第二次调用命中缓存，不触发 spawn", async () => {
      const f = await setupContext({ journalId: "journal-cache-test" });
      fixtures.push(f.cleanup);
      await f.ctx.agent("扫描 auth", { callKey: "scan/0" });
      await f.ctx.agent("扫描 auth", { callKey: "scan/0" });
      // 第二次应该命中缓存，spawn 只被调用一次
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(1);
    });

    it("不同 callKey 不命中缓存", async () => {
      const f = await setupContext({ journalId: "journal-diff-key" });
      fixtures.push(f.cleanup);
      await f.ctx.agent("扫描 auth", { callKey: "scan/0" });
      await f.ctx.agent("扫描 auth", { callKey: "scan/1" });
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(2);
    });

    it("不同 prompt 不命中缓存", async () => {
      const f = await setupContext({ journalId: "journal-diff-prompt" });
      fixtures.push(f.cleanup);
      await f.ctx.agent("扫描 auth", { callKey: "scan/0" });
      await f.ctx.agent("扫描 api", { callKey: "scan/0" });
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(2);
    });

    it("orchestrator 失败时抛错并写入 journal error", async () => {
      const f = await setupContext({
        journalId: "journal-fail",
        orchestratorBehavior: () => errorResult("agent timeout"),
      });
      fixtures.push(f.cleanup);
      await expect(f.ctx.agent("扫描", { callKey: "scan/0" })).rejects.toThrow(/Workflow agent\(\) failed/);
      // journal 中应有 error 记录
      const rows = f.journal.listByJournal("journal-fail");
      expect(rows.some((r) => r.status === "error")).toBe(true);
    });

    it("budget 熔断时抛 WorkflowBudgetExceededError", async () => {
      const f = await setupContext({ journalId: "journal-budget" });
      fixtures.push(f.cleanup);
      // 替换 budgetGuard 为极小上限
      f.budgetGuard.consume(0, 100); // calls=100, maxAgentCalls=100 → 超限
      await expect(f.ctx.agent("扫描", { callKey: "scan/0" })).rejects.toThrow(WorkflowBudgetExceededError);
    });

    it("onAgentEvent 对单次 agent 调用仅触发一次 started/completed，且 sessionId 一致", async () => {
      const f = await setupContext({
        journalId: "journal-events",
        orchestratorBehavior: async (opts) => {
          const sessionId = "sub_evt_001";
          opts.onSessionCreated?.(sessionId, "default");
          return {
            success: true,
            output: "result for: 扫描",
            sessionId,
          };
        },
      });
      fixtures.push(f.cleanup);
      await f.ctx.agent("扫描", { callKey: "scan/0" });
      const started = f.events.filter((e) => e.type === "started");
      const completed = f.events.filter((e) => e.type === "completed");
      expect(started).toHaveLength(1);
      expect(completed).toHaveLength(1);
      expect(started[0]?.sessionId).toBe("sub_evt_001");
      expect(completed[0]?.sessionId).toBe("sub_evt_001");
      expect((completed[0] as Extract<SubAgentEvent, { type: "completed" }>).success).toBe(true);
    });
  });

  describe("parallel()", () => {
    it("全部成功返回 ok 结果", async () => {
      const f = await setupContext({ journalId: "journal-parallel-ok" });
      fixtures.push(f.cleanup);
      const results = await f.ctx.parallel([
        () => Promise.resolve("a"),
        () => Promise.resolve("b"),
        () => Promise.resolve("c"),
      ]);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.map((r) => (r as any).value)).toEqual(["a", "b", "c"]);
    });

    it("单个失败不影响其他任务", async () => {
      const f = await setupContext({ journalId: "journal-parallel-fail" });
      fixtures.push(f.cleanup);
      const results = await f.ctx.parallel([
        () => Promise.resolve("ok-1"),
        () => Promise.reject(new Error("boom")),
        () => Promise.resolve("ok-3"),
      ]);
      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect(results[1].ok).toBe(false);
      expect((results[1] as any).error).toBe("boom");
      expect(results[2].ok).toBe(true);
    });

    it("并发上限限制同时执行的任务数", async () => {
      let running = 0;
      let maxRunning = 0;
      const f = await setupContext({ journalId: "journal-concurrency", maxConcurrent: 2 });
      fixtures.push(f.cleanup);
      const tasks = Array.from({ length: 6 }, (_, i) => async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return i;
      });
      await f.ctx.parallel(tasks);
      expect(maxRunning).toBeLessThanOrEqual(2);
    });
  });

  describe("parallelMap()", () => {
    it("带 index 映射所有项", async () => {
      const f = await setupContext({ journalId: "journal-map" });
      fixtures.push(f.cleanup);
      const items = ["a", "b", "c"];
      const results = await f.ctx.parallelMap(items, async (item, index) => `${item}-${index}`);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.ok)).toBe(true);
      expect((results[0] as any).value).toBe("a-0");
      expect((results[1] as any).value).toBe("b-1");
      expect((results[2] as any).value).toBe("c-2");
    });

    it("单个 mapper 失败返回结构化失败项", async () => {
      const f = await setupContext({ journalId: "journal-map-fail" });
      fixtures.push(f.cleanup);
      const items = [1, 2, 3];
      const results = await f.ctx.parallelMap(items, async (item) => {
        if (item === 2) throw new Error("bad item");
        return item * 10;
      });
      expect(results[0].ok).toBe(true);
      expect((results[0] as any).value).toBe(10);
      expect(results[1].ok).toBe(false);
      expect((results[1] as any).error).toBe("bad item");
      expect(results[2].ok).toBe(true);
      expect((results[2] as any).value).toBe(30);
    });

    it("并发上限限制同时执行的 mapper 数", async () => {
      let running = 0;
      let maxRunning = 0;
      const f = await setupContext({ journalId: "journal-map-concurrency", maxConcurrent: 3 });
      fixtures.push(f.cleanup);
      const items = Array.from({ length: 9 }, (_, i) => i);
      await f.ctx.parallelMap(items, async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return item;
      });
      expect(maxRunning).toBeLessThanOrEqual(3);
    });
  });

  describe("pipeline()", () => {
    it("多 stage 全部成功，item 独立流经各 stage", async () => {
      const f = await setupContext({ journalId: "journal-pipe-ok" });
      fixtures.push(f.cleanup);
      const items = [1, 2, 3];
      const stage1 = async (item: number) => item * 10;
      const stage2 = async (item: number) => `v${item}`;
      const results = await f.ctx.pipeline<number, string>(items, stage1, stage2);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.ok)).toBe(true);
      expect((results[0] as any).value).toBe("v10");
      expect((results[1] as any).value).toBe("v20");
      expect((results[2] as any).value).toBe("v30");
    });

    it("单个 item 在某 stage 失败，该 item 后续 stage 跳过", async () => {
      const f = await setupContext({ journalId: "journal-pipe-fail" });
      fixtures.push(f.cleanup);
      const items = [1, 2, 3];
      const stage1 = async (item: number) => {
        if (item === 2) throw new Error("bad item at stage1");
        return item * 10;
      };
      const stage2 = async (item: number) => `v${item}`;
      const results = await f.ctx.pipeline<number, string>(items, stage1, stage2);
      expect(results).toHaveLength(3);
      expect(results[0].ok).toBe(true);
      expect((results[0] as any).value).toBe("v10");
      expect(results[1].ok).toBe(false);
      expect((results[1] as any).error).toBe("bad item at stage1");
      expect(results[2].ok).toBe(true);
      expect((results[2] as any).value).toBe("v30");
    });

    it("无 stage 时直接返回 item 作为成功结果", async () => {
      const f = await setupContext({ journalId: "journal-pipe-no-stages" });
      fixtures.push(f.cleanup);
      const items = ["a", "b"];
      const results = await f.ctx.pipeline<string, string>(items);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.ok)).toBe(true);
      expect((results[0] as any).value).toBe("a");
      expect((results[1] as any).value).toBe("b");
    });

    it("并发上限限制同时处理的 item 数", async () => {
      let running = 0;
      let maxRunning = 0;
      const f = await setupContext({ journalId: "journal-pipe-concurrency", maxConcurrent: 2 });
      fixtures.push(f.cleanup);
      const items = Array.from({ length: 6 }, (_, i) => i);
      const stage = async (item: number) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return item;
      };
      await f.ctx.pipeline(items, stage, stage);
      expect(maxRunning).toBeLessThanOrEqual(2);
    });

    it("处理快的 item 不必等慢的 item 即可进入下一 stage（无屏障特性）", async () => {
      // 用时间戳验证：快 item 完成两个 stage 的时刻早于慢 item 完成第一个 stage
      const f = await setupContext({ journalId: "journal-pipe-no-barrier", maxConcurrent: 3 });
      fixtures.push(f.cleanup);
      const completionLog: Array<{ item: number; stage: number; time: number }> = [];
      const items = [1, 2]; // item 1 慢，item 2 快
      const stage1 = async (item: number) => {
        const delay = item === 1 ? 60 : 10;
        await new Promise((r) => setTimeout(r, delay));
        completionLog.push({ item, stage: 1, time: Date.now() });
        return item;
      };
      const stage2 = async (item: number) => {
        await new Promise((r) => setTimeout(r, 10));
        completionLog.push({ item, stage: 2, time: Date.now() });
        return `done-${item}`;
      };
      await f.ctx.pipeline(items, stage1, stage2);
      // item 2 的 stage2 完成时间应早于 item 1 的 stage1 完成时间
      const item2Stage2 = completionLog.find((e) => e.item === 2 && e.stage === 2)!;
      const item1Stage1 = completionLog.find((e) => e.item === 1 && e.stage === 1)!;
      expect(item2Stage2.time).toBeLessThan(item1Stage1.time);
    });

    it("stage 内调用 ctx.agent 可正常工作", async () => {
      const f = await setupContext({ journalId: "journal-pipe-agent" });
      fixtures.push(f.cleanup);
      const items = ["a", "b"];
      const stage = async (item: string) => {
        return await f.ctx.agent(`process ${item}`, { callKey: `pipe/${item}` });
      };
      const results = await f.ctx.pipeline<string, string>(items, stage);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.ok)).toBe(true);
      expect((results[0] as any).value).toContain("result for:");
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(2);
    });
  });

  describe("workflow() 嵌套调用", () => {
    it("正常嵌套调用 builtin 子工作流", async () => {
      const mockRuntime = {
        run: vi.fn(async () => ({
          success: true,
          output: "child workflow output",
          journalId: "child-journal-1",
        })),
      };
      const f = await setupContext({
        journalId: "journal-wf-nest",
        runtime: mockRuntime as any,
      });
      fixtures.push(f.cleanup);
      const result = await f.ctx.workflow("child-wf", { topics: ["a"] });
      expect(result).toBe("child workflow output");
      expect(mockRuntime.run).toHaveBeenCalledTimes(1);
      const callArgs = (mockRuntime.run as any).mock.calls[0][0];
      expect(callArgs.source).toEqual({ kind: "builtin", name: "child-wf" });
      expect(callArgs.args).toEqual({ topics: ["a"] });
      expect(callArgs.depth).toBe(1);
      expect(callArgs.maxConcurrent).toBe(3); // 继承父级
      expect(callArgs.sharedBudgetGuard).toBe(f.budgetGuard);
    });

    it("无 runtime 引用时抛错", async () => {
      const f = await setupContext({ journalId: "journal-wf-no-runtime" });
      fixtures.push(f.cleanup);
      await expect(f.ctx.workflow("child-wf")).rejects.toThrow(/not available/);
    });

    it("超过最大深度时抛错", async () => {
      const mockRuntime = {
        run: vi.fn(async () => ({ success: true, output: "ok", journalId: "j" })),
      };
      const f = await setupContext({
        journalId: "journal-wf-depth",
        runtime: mockRuntime as any,
        depth: 1,
        maxDepth: 1,
      });
      fixtures.push(f.cleanup);
      await expect(f.ctx.workflow("child-wf")).rejects.toThrow(/depth exceeded/);
      expect(mockRuntime.run).not.toHaveBeenCalled();
    });

    it("子工作流失败时抛错", async () => {
      const mockRuntime = {
        run: vi.fn(async () => ({
          success: false,
          output: "",
          journalId: "child-journal-fail",
          error: "child boom",
        })),
      };
      const f = await setupContext({
        journalId: "journal-wf-fail",
        runtime: mockRuntime as any,
      });
      fixtures.push(f.cleanup);
      await expect(f.ctx.workflow("child-wf")).rejects.toThrow(/Nested workflow failed/);
    });

    it("对象形式 nameOrRef 传递 args", async () => {
      const mockRuntime = {
        run: vi.fn(async () => ({ success: true, output: "ok", journalId: "j" })),
      };
      const f = await setupContext({
        journalId: "journal-wf-obj",
        runtime: mockRuntime as any,
      });
      fixtures.push(f.cleanup);
      // 不传第二参数 → 回退到 nameOrRef.args
      await f.ctx.workflow({ kind: "builtin", name: "child-wf", args: { x: 1 } });
      const callArgs = (mockRuntime.run as any).mock.calls[0][0];
      expect(callArgs.source).toEqual({ kind: "builtin", name: "child-wf" });
      expect(callArgs.args).toEqual({ x: 1 });
    });

    it("file 模式嵌套抛错（本期不支持）", async () => {
      const mockRuntime = {
        run: vi.fn(async () => ({ success: true, output: "ok", journalId: "j" })),
      };
      const f = await setupContext({
        journalId: "journal-wf-file",
        runtime: mockRuntime as any,
      });
      fixtures.push(f.cleanup);
      await expect(f.ctx.workflow({ kind: "file", name: "child-wf" })).rejects.toThrow(/only supports builtin/);
    });
  });

  describe("phase() / log()", () => {
    it("phase 回调触发", async () => {
      const f = await setupContext({ journalId: "journal-phase" });
      fixtures.push(f.cleanup);
      f.ctx.phase("阶段1：扫描");
      f.ctx.phase("阶段2：验证");
      expect(f.phases).toEqual(["阶段1：扫描", "阶段2：验证"]);
    });

    it("log 回调触发", async () => {
      const f = await setupContext({ journalId: "journal-log" });
      fixtures.push(f.cleanup);
      f.ctx.log("开始处理");
      f.ctx.log("处理完成");
      expect(f.logs).toEqual(["开始处理", "处理完成"]);
    });

    it("phase 变化影响默认 callKey", async () => {
      const f = await setupContext({ journalId: "journal-phase-callkey" });
      fixtures.push(f.cleanup);
      f.ctx.phase("阶段1");
      await f.ctx.agent("prompt-a"); // callKey = "阶段1/0"
      await f.ctx.agent("prompt-b"); // callKey = "阶段1/1"
      f.ctx.phase("阶段2");
      await f.ctx.agent("prompt-a"); // callKey = "阶段2/0" — 不同 callKey，不命中
      expect(f.orchestrator.spawn).toHaveBeenCalledTimes(3);
    });
  });

  describe("args", () => {
    it("args 透传到 context", async () => {
      const f = await setupContext({ journalId: "journal-args", args: { targetDir: "lib", count: 5 } });
      fixtures.push(f.cleanup);
      expect(f.ctx.args).toEqual({ targetDir: "lib", count: 5 });
    });

    it("args 变化导致 fingerprint 不同，不命中缓存", async () => {
      const journalId = "journal-args-fp";
      const f1 = await setupContext({ journalId, args: { targetDir: "src" } });
      fixtures.push(f1.cleanup);
      await f1.ctx.agent("扫描", { callKey: "scan/0" });

      const f2 = await setupContext({ journalId, args: { targetDir: "lib" } });
      fixtures.push(f2.cleanup);
      await f2.ctx.agent("扫描", { callKey: "scan/0" });
      // args 不同 → fingerprint 不同 → 不命中 → spawn 被调用
      expect(f2.orchestrator.spawn).toHaveBeenCalledTimes(1);
    });
  });
});
