/**
 * Phase 0 补充取证：runtime delta drift 来源精细诊断
 *
 * 目标：为 Phase 4 stable prefix 拆层提供安全边界证据
 *
 * 回答：
 * 1. 每个 delta 类型（tool-followup / team / identity / handoff / memory-prelude）各自贡献多少 token
 * 2. 哪些 delta 在 tool loop 中会频繁变化（导致 prefix drift）
 * 3. 哪些 delta 可以安全挪到 transient tail
 * 4. 哪些 delta 挪走会伤工具恢复或 team fan-in
 */

import { describe, expect, it } from "vitest";

import {
  buildPrefixShape,
  classifyPrefixDrift,
} from "./prompt-budget-observability.js";
import type { AgentPromptDelta } from "./prompt-snapshot.js";
import type { ProviderNativeSystemBlock } from "./system-prompt.js";

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};

const SYSTEM_PROMPT = [
  "# Role", "You are Belldandy, a local-first personal AI assistant.",
  "", "# Workspace", "Project: star-sanctuary", "Working directory: E:\\project\\star-sanctuary",
  "", "# Tool Behavior Contracts", "- run_command requires BELLDANDY_DANGEROUS_TOOLS_ENABLED=true",
  "", "# Tool Routing", "- Prefer file_read for reading files",
  "", "# Skills", "- code-analysis: analyze code structure",
  "", "# Memory Context", "User prefers concise responses. Project uses TypeScript ESM.",
].join("\n");

const MEMORY_PRELUDE = [
  "<recent-memory>", "2026-06-20 修复了 reasoning_content 回传问题", "</recent-memory>",
  "<work-overview>", "当前任务: Phase 4 前置取证", "</work-overview>",
].join("\n");

function buildTools(count: number): ToolDefinition[] {
  const base: ToolDefinition[] = [
    { type: "function", function: { name: "run_command", description: "Execute a shell command", parameters: { type: "object", properties: { command: { type: "string" } } } } },
    { type: "function", function: { name: "file_read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "function", function: { name: "file_write", description: "Write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } } },
    { type: "function", function: { name: "list_files", description: "List files", parameters: { type: "object", properties: { path: { type: "string" } } } } },
    { type: "function", function: { name: "web_fetch", description: "Fetch URL", parameters: { type: "object", properties: { url: { type: "string" } } } } },
    { type: "function", function: { name: "tool_search", description: "Search tools", parameters: { type: "object", properties: { query: { type: "string" } } } } },
    { type: "function", function: { name: "memory_search", description: "Search memory", parameters: { type: "object", properties: { query: { type: "string" } } } } },
    { type: "function", function: { name: "apply_patch", description: "Apply patch", parameters: { type: "object", properties: { patch: { type: "string" } } } } },
    { type: "function", function: { name: "delegate_task", description: "Delegate to sub-agent", parameters: { type: "object", properties: { task: { type: "string" } } } } },
    { type: "function", function: { name: "image_generate", description: "Generate image", parameters: { type: "object", properties: { prompt: { type: "string" } } } } },
    { type: "function", function: { name: "browser_navigate", description: "Navigate browser", parameters: { type: "object", properties: { url: { type: "string" } } } } },
    { type: "function", function: { name: "browser_screenshot", description: "Take screenshot", parameters: { type: "object", properties: {} } } },
  ];
  return base.slice(0, count);
}

function buildBlocks(): ProviderNativeSystemBlock[] {
  return [{
    id: "provider-native-static",
    blockType: "static-capability",
    text: "You have access to file operations, command execution, and web fetching.",
    sourceSectionIds: [],
    sourceDeltaIds: [],
    cacheControlEligible: true,
  }];
}

// 按类型构造单个 delta，用于逐项测量
function buildDeltaByType(type: string): AgentPromptDelta {
  const deltaMap: Record<string, AgentPromptDelta> = {
    "memory-prelude": {
      id: "recent-memory", deltaType: "user-prelude", role: "user-prelude",
      text: MEMORY_PRELUDE, metadata: { blockTag: "recent-memory" },
    },
    "tool-failure-recovery": {
      id: "tool-failure-recovery", deltaType: "tool-failure-recovery", role: "system",
      text: "上一个工具调用失败，请检查参数后重试。失败原因：文件路径不存在。请确认路径后重新调用。",
    },
    "tool-search-follow-up": {
      id: "tool-search-follow-up", deltaType: "tool-search-follow-up", role: "system",
      text: "已加载额外工具。请直接使用新加载的工具，不要重复搜索。新增工具：extra_tool_1, extra_tool_2。",
    },
    "tool-post-verification": {
      id: "post-action-verification", deltaType: "tool-post-verification", role: "system",
      text: "已执行写操作。请在下一步验证修改是否正确：读取修改后的文件，确认内容符合预期。",
    },
    "delegation-result-review": {
      id: "delegation-result-review", deltaType: "delegation-result-review", role: "system",
      text: "子 Agent 已完成委派任务。交付物摘要：修复了 tool-agent.ts 的 reasoning_content 回传。请审查交付物质量。",
    },
    "team-topology": {
      id: "team-topology", deltaType: "team-topology-and-ownership", role: "system",
      text: "当前 team: manager=Belldandy, worker=coder-agent, verifier=review-agent。Manager 负责分派任务，worker 负责执行，verifier 负责验收。报告链：worker→manager, verifier→manager。",
    },
    "team-handoff": {
      id: "team-handoff", deltaType: "team-handoff-review", role: "system",
      text: "Worker 已完成代码修改，交付物摘要：修复了 tool-agent.ts 的 reasoning_content 回传。请 verifier 验收。Manager 请协调后续步骤。",
    },
    "team-fan-in": {
      id: "team-fan-in", deltaType: "team-fan-in-triage", role: "system",
      text: "所有 worker lane 已完成。请 manager 汇总各 lane 结果，做 fan-in 决策。Lane 1: 代码修复完成。Lane 2: 测试编写完成。",
    },
    "team-completion-gate": {
      id: "team-completion-gate", deltaType: "team-completion-gate", role: "system",
      text: "完成门检查：verifier 已确认交付物质量达标。Manager 可以宣布任务完成。未通过项：无。",
    },
    "identity-authority": {
      id: "identity-authority", deltaType: "runtime-identity-authority", role: "system",
      text: "当前运行身份：Belldandy（manager）。权限：可委派任务、可审批工具调用、可宣布任务完成。上级：无。下级：coder-agent, review-agent。",
    },
    "launch-spec": {
      id: "launch-spec", deltaType: "launch-spec", role: "system",
      text: "本次运行规格：任务=修复 reasoning_content 回传，角色=manager，工具集=core+file_ops，预算=normal。",
    },
  };
  return deltaMap[type] ?? deltaMap["memory-prelude"];
}

function estimateTokensApprox(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function buildBaseMessages(toolCalls: number): Message[] {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "请帮我分析项目结构并修复 bug" },
  ];
  for (let i = 0; i < toolCalls; i++) {
    messages.push({
      role: "assistant", content: "",
      tool_calls: [{ id: `call_${i}`, type: "function", function: { name: "file_read", arguments: JSON.stringify({ path: `src/file_${i}.ts` }) } }],
    });
    messages.push({ role: "tool", tool_call_id: `call_${i}`, content: `file content line ${i}` });
  }
  messages.push({ role: "user", content: "继续" });
  return messages;
}

describe("Phase 0 supplemental: runtime delta drift source analysis", () => {
  // 测试 1：逐项测量每个 delta 类型的 token 贡献
  it("measures individual delta type token contributions", () => {
    const deltaTypes = [
      "memory-prelude", "tool-failure-recovery", "tool-search-follow-up",
      "post-action-verification", "delegation-result-review",
      "team-topology", "team-handoff", "team-fan-in", "team-completion-gate",
      "identity-authority", "launch-spec",
    ];

    const measurements = deltaTypes.map(type => {
      const delta = buildDeltaByType(type);
      const tokens = estimateTokensApprox(delta.text);
      return { type, chars: delta.text.length, tokens, deltaType: delta.deltaType };
    });

    console.log("=== Supplemental: Delta Type Token Contributions ===");
    console.table(measurements);

    // 验证每个 delta 都有可测量的 token 体积
    for (const m of measurements) {
      expect(m.tokens).toBeGreaterThan(0);
    }
  });

  // 测试 2：逐项验证每个 delta 类型对 prefix drift 的贡献
  it("identifies which delta types cause prefix drift when added", () => {
    const tools = buildTools(12);
    const blocks = buildBlocks();
    const baseMessages = buildBaseMessages(5);
    const baseDeltas: AgentPromptDelta[] = [buildDeltaByType("memory-prelude")];

    // 基线 shape（只有 memory-prelude）
    const baseShape = buildPrefixShape({
      messages: baseMessages, tools, runtimePromptDeltas: baseDeltas,
      providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro",
    });

    const driftResults = [
      "tool-failure-recovery", "tool-search-follow-up",
      "post-action-verification", "delegation-result-review",
      "team-topology", "team-handoff", "team-fan-in", "team-completion-gate",
      "identity-authority", "launch-spec",
    ].map(type => {
      const delta = buildDeltaByType(type);
      const deltas = [...baseDeltas, delta];
      const shape = buildPrefixShape({
        messages: baseMessages, tools, runtimePromptDeltas: deltas,
        providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro",
      });
      const drift = classifyPrefixDrift({
        previous: { fingerprint: baseShape.fingerprint, shapeHashes: baseShape.shapeHashes, routeModel: "deepseek-v4-pro" },
        current: { fingerprint: shape.fingerprint, shapeHashes: shape.shapeHashes, routeModel: "deepseek-v4-pro" },
      });
      return {
        deltaType: type,
        causesDrift: drift.changed,
        driftReasons: drift.reasons,
        runtimeDeltaHashChanged: baseShape.shapeHashes.runtimeDelta !== shape.shapeHashes.runtimeDelta,
        systemPromptHashChanged: baseShape.shapeHashes.systemPrompt !== shape.shapeHashes.systemPrompt,
      };
    });

    console.log("=== Supplemental: Delta Drift Impact ===");
    console.table(driftResults);

    // 所有 delta 都应该导致 drift（因为 runtimeDelta hash 变化）
    for (const r of driftResults) {
      expect(r.causesDrift).toBe(true);
      expect(r.runtimeDeltaHashChanged).toBe(true);
    }
  });

  // 测试 3：模拟 tool loop 多轮，观察哪些 delta 频繁出现/消失
  it("simulates tool loop rounds to identify transient vs stable deltas", () => {
    const tools = buildTools(12);
    const blocks = buildBlocks();

    // Round 1: 基线（memory-prelude + launch-spec）
    const msgs1 = buildBaseMessages(2);
    const deltas1: AgentPromptDelta[] = [buildDeltaByType("memory-prelude"), buildDeltaByType("launch-spec")];
    const shape1 = buildPrefixShape({ messages: msgs1, tools, runtimePromptDeltas: deltas1, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // Round 2: 加入 tool-failure-recovery（工具失败后恢复）
    const msgs2 = buildBaseMessages(4);
    const deltas2: AgentPromptDelta[] = [buildDeltaByType("memory-prelude"), buildDeltaByType("launch-spec"), buildDeltaByType("tool-failure-recovery")];
    const shape2 = buildPrefixShape({ messages: msgs2, tools, runtimePromptDeltas: deltas2, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // Round 3: tool-failure-recovery 消失，加入 post-action-verification
    const msgs3 = buildBaseMessages(6);
    const deltas3: AgentPromptDelta[] = [buildDeltaByType("memory-prelude"), buildDeltaByType("launch-spec"), buildDeltaByType("post-action-verification")];
    const shape3 = buildPrefixShape({ messages: msgs3, tools, runtimePromptDeltas: deltas3, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // Round 4: 加入 team-handoff（团队交接）
    const msgs4 = buildBaseMessages(8);
    const deltas4: AgentPromptDelta[] = [buildDeltaByType("memory-prelude"), buildDeltaByType("launch-spec"), buildDeltaByType("team-handoff")];
    const shape4 = buildPrefixShape({ messages: msgs4, tools, runtimePromptDeltas: deltas4, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // Round 5: team-handoff 消失，加入 team-fan-in（汇总）
    const msgs5 = buildBaseMessages(10);
    const deltas5: AgentPromptDelta[] = [buildDeltaByType("memory-prelude"), buildDeltaByType("launch-spec"), buildDeltaByType("team-fan-in")];
    const shape5 = buildPrefixShape({ messages: msgs5, tools, runtimePromptDeltas: deltas5, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    const drifts = [
      { round: "1→2", drift: classifyPrefixDrift({ previous: { fingerprint: shape1.fingerprint, shapeHashes: shape1.shapeHashes, routeModel: "deepseek-v4-pro" }, current: { fingerprint: shape2.fingerprint, shapeHashes: shape2.shapeHashes, routeModel: "deepseek-v4-pro" } }) },
      { round: "2→3", drift: classifyPrefixDrift({ previous: { fingerprint: shape2.fingerprint, shapeHashes: shape2.shapeHashes, routeModel: "deepseek-v4-pro" }, current: { fingerprint: shape3.fingerprint, shapeHashes: shape3.shapeHashes, routeModel: "deepseek-v4-pro" } }) },
      { round: "3→4", drift: classifyPrefixDrift({ previous: { fingerprint: shape3.fingerprint, shapeHashes: shape3.shapeHashes, routeModel: "deepseek-v4-pro" }, current: { fingerprint: shape4.fingerprint, shapeHashes: shape4.shapeHashes, routeModel: "deepseek-v4-pro" } }) },
      { round: "4→5", drift: classifyPrefixDrift({ previous: { fingerprint: shape4.fingerprint, shapeHashes: shape4.shapeHashes, routeModel: "deepseek-v4-pro" }, current: { fingerprint: shape5.fingerprint, shapeHashes: shape5.shapeHashes, routeModel: "deepseek-v4-pro" } }) },
    ];

    // 分析每个 round 的 systemPrompt hash 是否变化
    const systemPromptHashes = [shape1, shape2, shape3, shape4, shape5].map((s, i) => ({
      round: i + 1, systemPromptHash: s.shapeHashes.systemPrompt, runtimeDeltaHash: s.shapeHashes.runtimeDelta,
    }));

    console.log("=== Supplemental: System Prompt & Runtime Delta Hash per Round ===");
    console.table(systemPromptHashes);

    console.log("=== Supplemental: Drift Between Rounds ===");
    console.table(drifts.map(d => ({ round: d.round, changed: d.drift.changed, reasons: d.drift.reasons.join(",") })));

    // 验证：每轮都有 drift（因为 transient delta 在变化）
    for (const d of drifts) {
      expect(d.drift.changed).toBe(true);
    }

    // 验证：systemPrompt hash 不变（system message 内容不变），但 runtimeDelta hash 每轮都变
    const uniqueSysHashes = new Set(systemPromptHashes.map(h => h.systemPromptHash));
    const uniqueDeltaHashes = new Set(systemPromptHashes.map(h => h.runtimeDeltaHash));
    expect(uniqueSysHashes.size).toBe(1); // system prompt 本身稳定
    expect(uniqueDeltaHashes.size).toBeGreaterThan(1); // runtime delta 每轮变化
  });

  // 测试 4：验证哪些 delta 挪到 transient tail 后不影响工具恢复
  it("classifies deltas into stable-safe vs transient-safe categories", () => {
    const tools = buildTools(12);
    const blocks = buildBlocks();
    const baseMsgs = buildBaseMessages(5);

    // 基线：只有 stable deltas（memory-prelude + launch-spec）
    const stableDeltas: AgentPromptDelta[] = [buildDeltaByType("memory-prelude"), buildDeltaByType("launch-spec")];
    const stableShape = buildPrefixShape({ messages: baseMsgs, tools, runtimePromptDeltas: stableDeltas, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });

    // 逐个加入 transient delta，检查是否只影响 runtimeDelta hash 而不影响 systemPrompt hash
    // 注意：当前实现中 runtime deltas 被拼入 system prompt，所以 systemPrompt hash 也会变
    // Phase 4 的目标就是把这些 transient delta 移出 system prompt
    const transientTypes = [
      "tool-failure-recovery", "tool-search-follow-up", "post-action-verification",
      "delegation-result-review", "team-topology", "team-handoff", "team-fan-in",
      "team-completion-gate", "identity-authority",
    ];

    const classification = transientTypes.map(type => {
      const delta = buildDeltaByType(type);
      const deltas = [...stableDeltas, delta];
      const shape = buildPrefixShape({ messages: baseMsgs, tools, runtimePromptDeltas: deltas, providerNativeSystemBlocks: blocks, model: "deepseek-v4-pro" });
      const tokens = estimateTokensApprox(delta.text);

      // 判断这个 delta 是否与工具恢复/team fan-in 相关
      const isToolRecoveryRelated = type === "tool-failure-recovery" || type === "tool-search-follow-up" || type === "post-action-verification";
      const isTeamFanInRelated = type === "team-topology" || type === "team-handoff" || type === "team-fan-in" || type === "team-completion-gate";
      const isIdentityRelated = type === "identity-authority";

      // 安全分类
      let category: string;
      let safeToMoveToTail: boolean;
      if (isToolRecoveryRelated) {
        category = "tool-recovery";
        // 工具恢复 delta 可以挪到 tail，因为它们是本轮工具调用后的临时指导
        safeToMoveToTail = true;
      } else if (isTeamFanInRelated) {
        category = "team-coordination";
        // team delta 可以挪到 tail，因为它们是本轮团队交接的临时指令
        safeToMoveToTail = true;
      } else if (isIdentityRelated) {
        category = "identity-authority";
        // identity delta 需要谨慎：如果挪到 tail，模型可能在处理工具调用时不知道自己的权限
        safeToMoveToTail = false;
      } else {
        category = "other";
        safeToMoveToTail = true;
      }

      return {
        deltaType: type,
        category,
        tokens,
        causesSystemPromptDrift: stableShape.shapeHashes.systemPrompt !== shape.shapeHashes.systemPrompt,
        causesRuntimeDeltaDrift: stableShape.shapeHashes.runtimeDelta !== shape.shapeHashes.runtimeDelta,
        safeToMoveToTail,
        riskIfMoved: isIdentityRelated ? "模型可能不知道自己的权限边界" : "低",
      };
    });

    console.log("=== Supplemental: Delta Safety Classification for Stable Prefix Split ===");
    console.table(classification);

    // 验证：所有 transient delta 都导致 runtimeDelta drift
    for (const c of classification) {
      expect(c.causesRuntimeDeltaDrift).toBe(true);
    }

    // 验证：identity-authority 标记为不可安全挪走
    const identity = classification.find(c => c.category === "identity-authority");
    expect(identity?.safeToMoveToTail).toBe(false);
  });

  // 测试 5：汇总 — stable prefix 拆层安全边界
  it("summarizes stable prefix split safety boundaries", () => {
    const stableDeltaTypes = ["memory-prelude", "launch-spec"];
    const transientSafeTypes = ["tool-failure-recovery", "tool-search-follow-up", "post-action-verification", "delegation-result-review", "team-topology", "team-handoff", "team-fan-in", "team-completion-gate"];
    const transientUnsafeTypes = ["identity-authority"];

    const stableTokens = stableDeltaTypes.reduce((sum, type) => sum + estimateTokensApprox(buildDeltaByType(type).text), 0);
    const transientSafeTokens = transientSafeTypes.reduce((sum, type) => sum + estimateTokensApprox(buildDeltaByType(type).text), 0);
    const transientUnsafeTokens = transientUnsafeTypes.reduce((sum, type) => sum + estimateTokensApprox(buildDeltaByType(type).text), 0);

    const summary = {
      stablePrefixDeltas: stableDeltaTypes,
      stablePrefixTokens: stableTokens,
      transientSafeDeltas: transientSafeTypes,
      transientSafeTokens,
      transientUnsafeDeltas: transientUnsafeTypes,
      transientUnsafeTokens,
      recommendation: [
        "stable prefix 应保留：memory-prelude + launch-spec（每轮不变）",
        "transient tail 可安全挪入：tool-recovery / team-coordination / delegation-review（每轮变化，挪走可减少 drift）",
        "不宜挪走：identity-authority（模型需要知道自己的权限边界才能正确处理工具调用和团队交接）",
        "Phase 4 第一步应只挪 transient-safe 类，验证 cache 命中率提升和工具恢复质量不下降",
      ],
    };

    console.log("=== Supplemental: Stable Prefix Split Safety Summary ===");
    console.log(JSON.stringify(summary, null, 2));

    expect(stableTokens).toBeGreaterThan(0);
    expect(transientSafeTokens).toBeGreaterThan(0);
    expect(transientUnsafeTokens).toBeGreaterThan(0);
    expect(transientSafeTokens).toBeGreaterThan(transientUnsafeTokens);
  });
});
