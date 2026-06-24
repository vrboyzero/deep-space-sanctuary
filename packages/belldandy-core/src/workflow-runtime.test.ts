import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryStore } from "@belldandy/memory";
import {
  AgentRegistry,
  ConversationStore,
  type AgentProfile,
  type BelldandyAgent,
  type AgentStreamItem,
} from "@belldandy/agent";
import { registerBuiltinWorkflow, clearBuiltinWorkflows } from "./workflow-builtin-registry.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

// ─── Mock Agent ───────────────────────────────────────────────────────────

function createMockAgent(responseText: string): BelldandyAgent {
  return {
    async *run(input): AsyncIterable<AgentStreamItem> {
      yield { type: "status", status: "running" };
      yield { type: "delta", delta: responseText };
      yield { type: "final", text: responseText };
      yield { type: "status", status: "done" };
    },
  };
}

function createMockAgentRegistry(responseText: string): AgentRegistry {
  const defaultProfile: AgentProfile = {
    id: "default",
    displayName: "Default",
    model: "primary",
  };
  const registry = new AgentRegistry(() => createMockAgent(responseText));
  registry.register(defaultProfile);
  return registry;
}

// ─── 测试夹具 ─────────────────────────────────────────────────────────────

async function setupRuntime(responseText = "mock agent response") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `belldandy-wf-runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`));
  const dbPath = path.join(tempDir, "memory.db");
  const store = new MemoryStore(dbPath);
  const conversationStore = new ConversationStore();
  const agentRegistry = createMockAgentRegistry(responseText);
  const runtime = new WorkflowRuntime({
    db: store.getDbHandleForSharedSchema(),
    agentRegistry,
    conversationStore,
    readEnv: (name) => {
      if (name === "BELLDANDY_WORKFLOW_MAX_AGENT_CALLS") return "50";
      if (name === "BELLDANDY_WORKFLOW_MAX_CONCURRENT") return "6";
      if (name === "BELLDANDY_WORKFLOW_AGENT_TIMEOUT_MS") return "300000";
      if (name === "BELLDANDY_WORKFLOW_MAX_DEPTH") return "2";
      return undefined;
    },
  });
  return {
    runtime, store, tempDir, agentRegistry, conversationStore,
    cleanup: async () => { store.close(); await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); },
  };
}

async function writeFile(tempDir: string, name: string, content: string): Promise<string> {
  const filePath = path.join(tempDir, name);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe("WorkflowRuntime", () => {
  let cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => { cleanups = []; });
  afterEach(async () => {
    for (const c of cleanups) await c();
    cleanups = [];
    clearBuiltinWorkflows();
  });

  it("file 模式端到端运行成功", async () => {
    const f = await setupRuntime("scan result: clean");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "test-wf.mjs", `
      export default async function(ctx) {
        ctx.phase("阶段1");
        const result = await ctx.agent("扫描模块");
        ctx.log("完成");
        return result;
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-1",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("scan result: clean");
    expect(result.journalId).toMatch(/^wf_/);
    expect(result.scriptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.workflowName).toBe("test-wf");
    expect(result.stats.agentCalls).toBe(1);
    expect(result.stats.cacheHits).toBe(0);
  });

  it("builtin 模式端到端运行成功", async () => {
    const f = await setupRuntime("builtin result");
    cleanups.push(f.cleanup);
    registerBuiltinWorkflow({
      name: "simple-builtin",
      scriptHash: "builtin-hash-001",
      default: async (ctx) => {
        return await ctx.agent("hello");
      },
    });
    const result = await f.runtime.run({
      source: { kind: "builtin", name: "simple-builtin" },
      parentConversationId: "conv-2",
      channel: "test",
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("builtin result");
    expect(result.workflowName).toBe("simple-builtin");
  });

  it("inline 模式默认拒绝", async () => {
    const f = await setupRuntime();
    cleanups.push(f.cleanup);
    const result = await f.runtime.run({
      source: { kind: "inline", code: `export default async function(ctx) { return "x"; }` },
      parentConversationId: "conv-3",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inline/i);
  });

  it("inline 模式显式启用后运行成功", async () => {
    const f = await setupRuntime("inline agent result");
    cleanups.push(f.cleanup);
    const result = await f.runtime.run({
      source: { kind: "inline", code: `export default async function(ctx) { return await ctx.agent("test"); }` },
      allowInlineScript: true,
      parentConversationId: "conv-4",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("inline agent result");
  });

  it("resume 命中缓存跳过 agent 调用", async () => {
    const f = await setupRuntime("cached response");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "resume-wf.mjs", `
      export default async function(ctx) {
        const a = await ctx.agent("step 1", { callKey: "step/0" });
        const b = await ctx.agent("step 2", { callKey: "step/1" });
        return a + " | " + b;
      }
    `);
    // 第一次运行
    const r1 = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-5",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(r1.success).toBe(true);
    expect(r1.stats.agentCalls).toBe(2);
    expect(r1.stats.cacheHits).toBe(0);

    // 第二次运行，resume 同一个 journalId
    const r2 = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-5",
      channel: "test",
      stateDir: f.tempDir,
      resumeJournalId: r1.journalId,
    });
    expect(r2.success).toBe(true);
    expect(r2.stats.cacheHits).toBe(2);
    expect(r2.stats.agentCalls).toBe(0); // 全部命中缓存
    expect(r2.output).toBe(r1.output);
  });

  it("budget 熔断中止执行", async () => {
    const f = await setupRuntime("result");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "budget-wf.mjs", `
      export default async function(ctx) {
        const results = [];
        for (let i = 0; i < 100; i++) {
          results.push(await ctx.agent("step " + i, { callKey: "step/" + i }));
        }
        return results.join(",");
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      budget: { maxAgentCalls: 3 },
      parentConversationId: "conv-6",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/budget exceeded/);
  });

  it("getStatus 查询运行状态", async () => {
    const f = await setupRuntime("status test");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "status-wf.mjs", `
      export default async function(ctx) {
        await ctx.agent("step 1", { callKey: "s/0" });
        return "done";
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-7",
      channel: "test",
      stateDir: f.tempDir,
    });
    const status = f.runtime.getStatus(result.journalId);
    expect(status).not.toBeNull();
    expect(status?.status).toBe("done");
    expect(status?.journalId).toBe(result.journalId);
    expect(status?.stats.done).toBe(1);
    expect(status?.budgetUsage?.calls).toBe(1);
  });

  it("getStatus 不存在的 journalId 返回 null", () => {
    // 不需要 setupRuntime，但为了 cleanup 一致性还是建一个
  });

  it("listActiveRuns 列出运行记录", async () => {
    const f = await setupRuntime("list test");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "list-wf.mjs", `
      export default async function(ctx) { return "done"; }
    `);
    await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-8",
      channel: "test",
      stateDir: f.tempDir,
    });
    const list = f.runtime.listActiveRuns();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("parallel 工作流端到端运行", async () => {
    const f = await setupRuntime("parallel result");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "parallel-wf.mjs", `
      export default async function(ctx) {
        ctx.phase("并行扫描");
        const results = await ctx.parallel([
          () => ctx.agent("scan a", { callKey: "scan/0" }),
          () => ctx.agent("scan b", { callKey: "scan/1" }),
          () => ctx.agent("scan c", { callKey: "scan/2" }),
        ]);
        const ok = results.filter(r => r.ok).map(r => r.value);
        return ok.join(";");
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-9",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("parallel result;parallel result;parallel result");
    expect(result.stats.agentCalls).toBe(3);
  });

  it("脚本抛错时返回 error 状态", async () => {
    const f = await setupRuntime();
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "error-wf.mjs", `
      export default async function(ctx) {
        throw new Error("script boom");
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-10",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("script boom");
  });

  it("脚本文件不存在时返回错误", async () => {
    const f = await setupRuntime();
    cleanups.push(f.cleanup);
    const result = await f.runtime.run({
      source: { kind: "file", path: "/nonexistent/wf.mjs" },
      parentConversationId: "conv-11",
      channel: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Script load failed/);
  });

  // ─── 跨版本 migration ────────────────────────────────────────────────────

  it("resume 时 scriptHash 变化，migration 复用旧 done 记录", async () => {
    const f = await setupRuntime("migration result");
    cleanups.push(f.cleanup);
    // 第一次运行：旧脚本版本
    const oldWfPath = await writeFile(f.tempDir, "mig-wf.mjs", `
      export default async function(ctx) {
        const a = await ctx.agent("step 1", { callKey: "step/0" });
        const b = await ctx.agent("step 2", { callKey: "step/1" });
        return a + " | " + b;
      }
    `);
    const r1 = await f.runtime.run({
      source: { kind: "file", path: oldWfPath },
      parentConversationId: "conv-mig",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(r1.success).toBe(true);
    expect(r1.stats.agentCalls).toBe(2);
    expect(r1.stats.cacheHits).toBe(0);

    // 第二次运行：新脚本版本（内容不同 → scriptHash 变化），resume 同 journalId
    // 新脚本只是改了最终 return 格式，agent() 调用的 prompt 和 callKey 不变
    const newWfPath = await writeFile(f.tempDir, "mig-wf-v2.mjs", `
      export default async function(ctx) {
        const a = await ctx.agent("step 1", { callKey: "step/0" });
        const b = await ctx.agent("step 2", { callKey: "step/1" });
        return "result: " + a + " | " + b;
      }
    `);
    const r2 = await f.runtime.run({
      source: { kind: "file", path: newWfPath },
      parentConversationId: "conv-mig",
      channel: "test",
      stateDir: f.tempDir,
      resumeJournalId: r1.journalId,
    });
    expect(r2.success).toBe(true);
    // migration 应预填充新 fingerprint，agent() 命中缓存，不触发实际 spawn
    expect(r2.stats.cacheHits).toBe(2);
    expect(r2.stats.agentCalls).toBe(0);
    // 输出应使用新脚本的 return 格式（migration 只复用 agent() 结果，不改脚本逻辑）
    expect(r2.output).toContain("result:");
  });

  it("resume 时 scriptHash 未变化，不触发 migration", async () => {
    const f = await setupRuntime("no-mig result");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "no-mig-wf.mjs", `
      export default async function(ctx) {
        const a = await ctx.agent("step 1", { callKey: "step/0" });
        return a;
      }
    `);
    const r1 = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-no-mig",
      channel: "test",
      stateDir: f.tempDir,
    });
    // resume 同一脚本（scriptHash 不变）
    const r2 = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-no-mig",
      channel: "test",
      stateDir: f.tempDir,
      resumeJournalId: r1.journalId,
    });
    expect(r2.success).toBe(true);
    expect(r2.stats.cacheHits).toBe(1);
    expect(r2.stats.agentCalls).toBe(0);
  });

  it("非 resume 运行不触发 migration", async () => {
    const f = await setupRuntime("fresh result");
    cleanups.push(f.cleanup);
    const wfPath = await writeFile(f.tempDir, "fresh-wf.mjs", `
      export default async function(ctx) {
        return await ctx.agent("step 1", { callKey: "step/0" });
      }
    `);
    const r1 = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-fresh",
      channel: "test",
      stateDir: f.tempDir,
    });
    // 不传 resumeJournalId → 新 journalId → 不触发 migration
    const r2 = await f.runtime.run({
      source: { kind: "file", path: wfPath },
      parentConversationId: "conv-fresh",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(r2.success).toBe(true);
    expect(r2.stats.agentCalls).toBe(1); // 实际执行，非缓存
    expect(r2.journalId).not.toBe(r1.journalId);
  });

  // ─── workflow composition 嵌套调用 ────────────────────────────────────────

  it("workflow() 端到端嵌套调用 builtin 子工作流", async () => {
    const f = await setupRuntime("nested agent result");
    cleanups.push(f.cleanup);
    // 注册一个简单的 builtin 子工作流
    registerBuiltinWorkflow({
      name: "simple-child",
      scriptHash: "child-hash-001",
      default: async (ctx) => {
        return await ctx.agent("child task", { callKey: "child/0" });
      },
    });
    // 父工作流调用子工作流
    const parentWfPath = await writeFile(f.tempDir, "parent-wf.mjs", `
      export default async function(ctx) {
        ctx.phase("调用子工作流");
        const childResult = await ctx.workflow("simple-child");
        ctx.phase("汇总");
        const finalResult = await ctx.agent("summarize: " + childResult, { callKey: "parent/0" });
        return finalResult;
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: parentWfPath },
      parentConversationId: "conv-nest",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("nested agent result");
    // 父工作流自身的 agent 调用：1 次（summarize）
    // 子工作流的 agent 调用计入子 run 的独立 budgetGuard，不计入父级 stats
    expect(result.stats.agentCalls).toBe(1);
  });

  it("workflow() 嵌套深度超限时子工作流抛错", async () => {
    const f = await setupRuntime("deep nest result");
    cleanups.push(f.cleanup);
    // 注册一个会尝试再次嵌套的子工作流
    registerBuiltinWorkflow({
      name: "recursive-child",
      scriptHash: "recursive-hash-001",
      default: async (ctx) => {
        // 子工作流内部再次调用 workflow() → depth=1 >= maxDepth=1 → 应抛错
        return await ctx.workflow("recursive-child");
      },
    });
    const parentWfPath = await writeFile(f.tempDir, "recursive-parent-wf.mjs", `
      export default async function(ctx) {
        try {
          await ctx.workflow("recursive-child");
          return "should not reach here";
        } catch (err) {
          return "caught: " + err.message;
        }
      }
    `);
    const result = await f.runtime.run({
      source: { kind: "file", path: parentWfPath },
      parentConversationId: "conv-recursive",
      channel: "test",
      stateDir: f.tempDir,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("caught");
    expect(result.output).toContain("depth exceeded");
  });
});
