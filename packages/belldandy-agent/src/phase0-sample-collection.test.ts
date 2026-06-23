import { describe, expect, it } from "vitest";

import {
  buildBudgetCompetition,
  buildPrefixShape,
  classifyPrefixDrift,
} from "./prompt-budget-observability.js";
import type { AgentPromptDelta } from "./prompt-snapshot.js";
import type { ProviderNativeSystemBlock } from "./system-prompt.js";

/**
 * Phase 0 真实长会话样本采集（本地诊断，不调用 API）
 *
 * 本测试构造模拟真实 tool-heavy 长会话的 fixture，跑 buildPrefixShape /
 * classifyPrefixDrift / buildBudgetCompetition，输出 Phase 0 需要的诊断样本。
 *
 * 这些样本用于回答：
 * 1. tool result / memory injection / tool schema / reasoning history 谁最耗 token
 * 2. tool loop 中 prefix drift 的主要来源是什么
 * 3. 预算吃紧时 history trim 是否先于 tool schema 牺牲
 */

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
  };
};

// 模拟真实 system prompt（包含 workspace、tool governance、memory 等 section）
const REALISTIC_SYSTEM_PROMPT = [
  "# Role",
  "You are Belldandy, a local-first personal AI assistant.",
  "",
  "# Workspace",
  "Project: star-sanctuary",
  "Working directory: E:\\project\\star-sanctuary",
  "",
  "# Tool Behavior Contracts",
  "- run_command requires BELLDANDY_DANGEROUS_TOOLS_ENABLED=true",
  "- web_fetch has SSRF protection with DNS rebinding check",
  "- file_read respects workspace boundary",
  "",
  "# Tool Routing",
  "- Prefer file_read for reading files",
  "- Prefer list_files for directory listing",
  "- Use tool_search when current tool set is insufficient",
  "",
  "# Skills",
  "- code-analysis: analyze code structure",
  "- refactoring: safe code transformation",
  "- testing: generate and run tests",
  "",
  "# Memory Context",
  "User prefers concise responses. Project uses TypeScript ESM.",
].join("\n");

// 模拟真实 memory injection prelude
const MEMORY_PRELUDE = [
  "<recent-memory hint=\"以下是按重要性筛选后的近期记忆。\">",
  "2026-06-20 修复了 tool-agent.ts 的 reasoning_content 回传问题",
  "2026-06-21 完成了 prompt-budget-observability 的落地",
  "2026-06-22 讨论了 headroom 借鉴方案",
  "2026-06-23 开始 Phase 0 live probe",
  "</recent-memory>",
  "<work-overview hint=\"任务记忆一级摘要。\">",
  "当前任务: SS借鉴RH项目优化项 Phase 0",
  "下一步: 完成 live probe 与真实样本收集",
  "</work-overview>",
].join("\n");

// 模拟真实 tool schema 集合（10 个工具，模拟真实负载）
function buildRealisticToolSet(toolCount: number): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    { type: "function", function: { name: "run_command", description: "Execute a shell command", parameters: { type: "object", properties: { command: { type: "string" } } } } },
    { type: "function", function: { name: "file_read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "function", function: { name: "file_write", description: "Write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } } },
    { type: "function", function: { name: "list_files", description: "List files in directory", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "function", function: { name: "web_fetch", description: "Fetch URL content", parameters: { type: "object", properties: { url: { type: "string" } } } } },
    { type: "function", function: { name: "tool_search", description: "Search for available tools", parameters: { type: "object", properties: { query: { type: "string" } } } } },
    { type: "function", function: { name: "memory_search", description: "Search memory store", parameters: { type: "object", properties: { query: { type: "string" } } } } },
    { type: "function", function: { name: "apply_patch", description: "Apply a unified diff patch", parameters: { type: "object", properties: { patch: { type: "string" } } } } },
    { type: "function", function: { name: "delegate_task", description: "Delegate to sub-agent", parameters: { type: "object", properties: { task: { type: "string" } } } } },
    { type: "function", function: { name: "image_generate", description: "Generate image", parameters: { type: "object", properties: { prompt: { type: "string" } } } } },
    { type: "function", function: { name: "browser_navigate", description: "Navigate browser to URL", parameters: { type: "object", properties: { url: { type: "string" } } } } },
    { type: "function", function: { name: "browser_screenshot", description: "Take screenshot", parameters: { type: "object", properties: {} } } },
  ];
  return tools.slice(0, toolCount);
}

// 模拟真实 tool result（大输出）
function buildLargeToolOutput(toolName: string, lines: number): string {
  const output: string[] = [];
  for (let i = 0; i < lines; i++) {
    output.push(`[line ${i + 1}] ${toolName} output: some realistic content with details about the operation result`);
  }
  return output.join("\n");
}

// 模拟 reasoning_content
function buildReasoningContent(sentences: number): string {
  return Array.from({ length: sentences }, (_, i) =>
    `Step ${i + 1}: I need to analyze the requirement and consider the trade-offs carefully before proceeding.`
  ).join(" ");
}

// 构造一个模拟真实 tool loop 的消息序列
function buildToolLoopConversation(toolCallCount: number, largeOutputLines: number): Message[] {
  const messages: Message[] = [
    { role: "system", content: REALISTIC_SYSTEM_PROMPT },
    { role: "user", content: "请帮我分析项目结构并修复 bug" },
  ];

  for (let i = 0; i < toolCallCount; i++) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: `call_${i + 1}`,
        type: "function",
        function: {
          name: i % 3 === 0 ? "file_read" : i % 3 === 1 ? "run_command" : "list_files",
          arguments: JSON.stringify({ path: `src/file_${i}.ts` }),
        },
      }],
      reasoning_content: buildReasoningContent(5),
    });
    messages.push({
      role: "tool",
      tool_call_id: `call_${i + 1}`,
      content: buildLargeToolOutput(["file_read", "run_command", "list_files"][i % 3], largeOutputLines),
    });
  }

  messages.push({ role: "user", content: "继续分析" });
  return messages;
}

// 构造 runtime prompt deltas（模拟真实 tool loop 中的 deltas）
function buildRuntimeDeltas(scenario: "with-tool-followup" | "with-team" | "minimal"): AgentPromptDelta[] {
  const deltas: AgentPromptDelta[] = [
    {
      id: "recent-memory",
      deltaType: "user-prelude",
      role: "user-prelude",
      text: MEMORY_PRELUDE,
      metadata: { blockTag: "recent-memory" },
    },
  ];

  if (scenario === "with-tool-followup") {
    deltas.push({
      id: "tool-failure-recovery",
      deltaType: "tool-failure-recovery",
      role: "system",
      text: "上一个工具调用失败，请检查参数后重试。失败原因：文件路径不存在。",
    });
    deltas.push({
      id: "tool-search-follow-up",
      deltaType: "tool-search-follow-up",
      role: "system",
      text: "已加载额外工具。请直接使用新加载的工具，不要重复搜索。",
    });
  }

  if (scenario === "with-team") {
    deltas.push({
      id: "team-topology",
      deltaType: "team-topology-and-ownership",
      role: "system",
      text: "当前 team: manager=Belldandy, worker=coder-agent, verifier=review-agent。Manager 负责分派任务，worker 负责执行，verifier 负责验收。",
    });
    deltas.push({
      id: "team-handoff",
      deltaType: "team-handoff-review",
      role: "system",
      text: "Worker 已完成代码修改，交付物摘要：修复了 tool-agent.ts 的 reasoning_content 回传。请 verifier 验收。",
    });
  }

  return deltas;
}

function buildProviderNativeBlocks(): ProviderNativeSystemBlock[] {
  return [
    {
      id: "provider-native-static-capability",
      blockType: "static-capability",
      text: "You have access to file operations, command execution, and web fetching capabilities.",
      sourceSectionIds: [],
      sourceDeltaIds: [],
      cacheControlEligible: true,
    },
  ];
}

describe("phase 0 real conversation sample collection", () => {
  it("scenario A: short conversation, 4 tools, minimal deltas", () => {
    const messages: Message[] = [
      { role: "system", content: REALISTIC_SYSTEM_PROMPT },
      { role: "user", content: "hello" },
    ];
    const tools = buildRealisticToolSet(4);
    const deltas = buildRuntimeDeltas("minimal");
    const blocks = buildProviderNativeBlocks();

    const shape = buildPrefixShape({ messages, tools, runtimePromptDeltas: deltas, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });
    const budget = buildBudgetCompetition({ messages, tools, runtimePromptDeltas: deltas, providerNativeSystemBlocks: blocks, prependContext: MEMORY_PRELUDE, maxInputTokens: 64000, model: "deepseek-v4-pro" });

    const sample = {
      scenario: "A: short conversation, 4 tools, minimal deltas",
      shape: { fingerprint: shape.fingerprint, counts: shape.counts, prefixTokens: shape.prefixTokens },
      budget: {
        tokenBreakdown: budget.tokenBreakdown,
        pressure: budget.pressure,
        competition: budget.competition,
        sacrifice: budget.sacrifice,
      },
    };

    console.log("=== Phase 0 Sample A ===");
    console.log(JSON.stringify(sample, null, 2));

    expect(shape.fingerprint).toMatch(/^[0-9a-f]+$/);
    expect(budget.tokenBreakdown.totalPromptTokens).toBeGreaterThan(0);
  });

  it("scenario B: tool-heavy conversation, 10 tool calls, 12 tools, large outputs", () => {
    const messages = buildToolLoopConversation(10, 50);
    const tools = buildRealisticToolSet(12);
    const deltas = buildRuntimeDeltas("with-tool-followup");
    const blocks = buildProviderNativeBlocks();

    const shape = buildPrefixShape({ messages, tools, runtimePromptDeltas: deltas, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });
    const budget = buildBudgetCompetition({ messages, tools, runtimePromptDeltas: deltas, providerNativeSystemBlocks: blocks, prependContext: MEMORY_PRELUDE, maxInputTokens: 64000, model: "deepseek-v4-pro" });

    const sample = {
      scenario: "B: tool-heavy, 10 tool calls, 12 tools, large outputs",
      shape: { fingerprint: shape.fingerprint, counts: shape.counts, prefixTokens: shape.prefixTokens },
      budget: {
        tokenBreakdown: budget.tokenBreakdown,
        pressure: budget.pressure,
        competition: budget.competition,
        sacrifice: budget.sacrifice,
      },
    };

    console.log("=== Phase 0 Sample B ===");
    console.log(JSON.stringify(sample, null, 2));

    expect(budget.tokenBreakdown.historyTokens).toBeGreaterThan(budget.tokenBreakdown.systemPromptTokens);
    expect(budget.tokenBreakdown.toolSchemaTokens).toBeGreaterThan(0);
  });

  it("scenario C: long conversation with reasoning history, 20 tool calls, budget pressure", () => {
    const messages = buildToolLoopConversation(20, 80);
    const tools = buildRealisticToolSet(12);
    const deltas = buildRuntimeDeltas("with-team");
    const blocks = buildProviderNativeBlocks();

    const shape = buildPrefixShape({ messages, tools, runtimePromptDeltas: deltas, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });
    // 设置较低的 maxInputTokens 模拟预算压力
    const budget = buildBudgetCompetition({
      messages,
      tools,
      runtimePromptDeltas: deltas,
      providerNativeSystemBlocks: blocks,
      prependContext: MEMORY_PRELUDE,
      maxInputTokens: 8000,
      model: "deepseek-v4-pro",
      trimDiagnostics: { trimmedMessageCount: 5, trimmedHistoryTokens: 1200 },
    });

    const sample = {
      scenario: "C: long conversation, 20 tool calls, reasoning history, budget pressure",
      shape: { fingerprint: shape.fingerprint, counts: shape.counts, prefixTokens: shape.prefixTokens },
      budget: {
        tokenBreakdown: budget.tokenBreakdown,
        pressure: budget.pressure,
        competition: budget.competition,
        sacrifice: budget.sacrifice,
      },
    };

    console.log("=== Phase 0 Sample C ===");
    console.log(JSON.stringify(sample, null, 2));

    expect(budget.pressure.overBudget).toBe(true);
    expect(budget.sacrifice.historyTrimmed).toBe(true);
    expect(budget.sacrifice.keptToolSchemaCount).toBe(12);
  });

  it("scenario D: prefix drift across tool loop iterations", () => {
    // 模拟 tool loop 中三轮请求的 prefix shape 变化
    const tools = buildRealisticToolSet(12);
    const blocks = buildProviderNativeBlocks();

    // 第一轮：minimal deltas
    const messages1 = buildToolLoopConversation(2, 30);
    const deltas1 = buildRuntimeDeltas("minimal");
    const shape1 = buildPrefixShape({ messages: messages1, tools, runtimePromptDeltas: deltas1, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // 第二轮：加入 tool-followup deltas（模拟 tool failure 后的恢复）
    const messages2 = buildToolLoopConversation(5, 30);
    const deltas2 = buildRuntimeDeltas("with-tool-followup");
    const shape2 = buildPrefixShape({ messages: messages2, tools, runtimePromptDeltas: deltas2, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // 第三轮：加入 team deltas + 工具数变化（模拟 tool_search 后 schema 扩张）
    // 注意：buildRealisticToolSet(14) 取的是前 14 个，但数组只有 12 个，所以实际仍是 12 个
    // 改为直接构造不同工具集来确保 tool_schema drift
    const tools3 = [
      ...buildRealisticToolSet(12),
      { type: "function" as const, function: { name: "extra_tool_1", description: "Extra tool 1", parameters: { type: "object", properties: { arg: { type: "string" } } } } },
      { type: "function" as const, function: { name: "extra_tool_2", description: "Extra tool 2", parameters: { type: "object", properties: { arg: { type: "string" } } } } },
    ];
    const messages3 = buildToolLoopConversation(8, 30);
    const deltas3 = buildRuntimeDeltas("with-team");
    const shape3 = buildPrefixShape({ messages: messages3, tools: tools3, runtimePromptDeltas: deltas3, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    const drift1to2 = classifyPrefixDrift({
      previous: { fingerprint: shape1.fingerprint, shapeHashes: shape1.shapeHashes, routeModel: "deepseek-v4-pro" },
      current: { fingerprint: shape2.fingerprint, shapeHashes: shape2.shapeHashes, routeModel: "deepseek-v4-pro" },
    });

    const drift2to3 = classifyPrefixDrift({
      previous: { fingerprint: shape2.fingerprint, shapeHashes: shape2.shapeHashes, routeModel: "deepseek-v4-pro" },
      current: { fingerprint: shape3.fingerprint, shapeHashes: shape3.shapeHashes, routeModel: "deepseek-v4-pro" },
    });

    const sample = {
      scenario: "D: prefix drift across tool loop iterations",
      round1: { fingerprint: shape1.fingerprint, shapeHashes: shape1.shapeHashes, counts: shape1.counts },
      round2: { fingerprint: shape2.fingerprint, shapeHashes: shape2.shapeHashes, counts: shape2.counts },
      round3: { fingerprint: shape3.fingerprint, shapeHashes: shape3.shapeHashes, counts: shape3.counts },
      driftRound1to2: drift1to2,
      driftRound2to3: drift2to3,
    };

    console.log("=== Phase 0 Sample D (drift) ===");
    console.log(JSON.stringify(sample, null, 2));

    expect(drift1to2.changed).toBe(true);
    expect(drift2to3.changed).toBe(true);
    // round2->round3 工具集从 12 变 14，tool_schema hash 应变化
    expect(drift2to3.reasons).toEqual(expect.arrayContaining(["tool_schema_shape_changed"]));
  });
});
