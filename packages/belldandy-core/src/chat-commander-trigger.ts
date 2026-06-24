/**
 * ChatCommanderTrigger — 普通 chat 的 manual 显式触发判定
 *
 * 支持两种独立的编排模式触发：
 * 1. 指挥模式（Commander Mode）：主 Agent 在 ReAct 循环中实时调度子 Agent
 *    - 触发词：使用指挥模式 / 进指挥模式 / 成为指挥官
 *    - 建议工具：delegate_task / delegate_parallel
 *
 * 2. 动态工作流模式（Dynamic Workflow Mode）：确定性 TypeScript 脚本编排
 *    - 触发词：用动态工作流 / 进动态工作流 / 用DW模式 / 进DW模式
 *    - 建议工具：run_workflow
 *
 * 两种模式可同时触发（兼容），也可独立触发。
 * 不做普通对话 / 普通任务的 auto 判定。
 *
 * 非触发条件：
 * - 普通闲聊、问答、单文件小修、低风险短任务
 * - 仅因为任务看起来复杂就自动切换
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type ChatCommanderTriggerResult = {
  /** 任一模式触发时为 true */
  triggered: boolean;
  /** 指挥模式触发 */
  commanderTriggered: boolean;
  /** 动态工作流模式触发 */
  workflowTriggered: boolean;
  reason: string;
  matchedPhrases: string[];
  suggestedTools: string[];
};

// ─── 指挥模式触发关键词 ──────────────────────────────────────────────────

const COMMANDER_MODE_PHRASES: string[] = [
  // 中文
  "使用指挥模式",
  "进指挥模式",
  "成为指挥官",
  // 英文
  "use commander mode",
  "enter commander mode",
  "become commander",
  "act as commander",
];

// ─── 动态工作流模式触发关键词 ────────────────────────────────────────────

const WORKFLOW_MODE_PHRASES: string[] = [
  // 中文
  "用动态工作流",
  "进动态工作流",
  "用动态工作流模式",
  "进动态工作流模式",
  "用dw模式",
  "进dw模式",
  // 英文
  "use dynamic workflow",
  "enter dynamic workflow",
  "use dynamic workflow mode",
  "enter dynamic workflow mode",
  "use dw mode",
  "enter dw mode",
];

// ─── 检测函数 ─────────────────────────────────────────────────────────────

/**
 * 检测用户消息是否显式触发指挥模式或动态工作流模式。
 *
 * @param userText 用户消息文本
 * @param commanderMode 当前 commander 模式（"on" | "off" | "auto"）；"on" 时触发指挥模式
 * @returns 触发结果，区分两种模式
 */
export function detectChatCommanderTrigger(
  userText: string,
  commanderMode?: "on" | "off" | "auto",
): ChatCommanderTriggerResult {
  // commanderMode === "on" 时，指挥模式始终触发（用户已通过 UI 显式开启）
  // 但仍需继续检测工作流模式关键词，以支持两种模式同时触发
  const commanderModeOn = commanderMode === "on";

  if (!userText || typeof userText !== "string") {
    if (commanderModeOn) {
      return {
        triggered: true,
        commanderTriggered: true,
        workflowTriggered: false,
        reason: "Commander mode is explicitly enabled via settings",
        matchedPhrases: [],
        suggestedTools: ["delegate_task", "delegate_parallel"],
      };
    }
    return {
      triggered: false,
      commanderTriggered: false,
      workflowTriggered: false,
      reason: "",
      matchedPhrases: [],
      suggestedTools: [],
    };
  }

  const lowerText = userText.toLowerCase();
  const matchedPhrases: string[] = [];
  const suggestedTools = new Set<string>();
  const reasons: string[] = [];

  // 指挥模式触发判定
  let commanderTriggered = false;
  if (commanderModeOn) {
    commanderTriggered = true;
    suggestedTools.add("delegate_task");
    suggestedTools.add("delegate_parallel");
    reasons.push("Commander mode is explicitly enabled via settings");
  }
  for (const phrase of COMMANDER_MODE_PHRASES) {
    if (lowerText.includes(phrase.toLowerCase())) {
      commanderTriggered = true;
      matchedPhrases.push(phrase);
      suggestedTools.add("delegate_task");
      suggestedTools.add("delegate_parallel");
    }
  }
  if (commanderTriggered && !commanderModeOn) {
    reasons.push("用户显式要求使用指挥模式");
  }

  // 检测动态工作流模式关键词
  let workflowTriggered = false;
  for (const phrase of WORKFLOW_MODE_PHRASES) {
    if (lowerText.includes(phrase.toLowerCase())) {
      workflowTriggered = true;
      matchedPhrases.push(phrase);
      suggestedTools.add("run_workflow");
    }
  }
  if (workflowTriggered) {
    reasons.push("用户显式要求使用动态工作流模式");
  }

  const triggered = commanderTriggered || workflowTriggered;
  if (!triggered) {
    return {
      triggered: false,
      commanderTriggered: false,
      workflowTriggered: false,
      reason: "",
      matchedPhrases: [],
      suggestedTools: [],
    };
  }

  return {
    triggered,
    commanderTriggered,
    workflowTriggered,
    reason: reasons.join("; "),
    matchedPhrases,
    suggestedTools: [...suggestedTools],
  };
}

/**
 * 构建 chat commander hint prompt delta 文本。
 * 根据触发的模式生成不同的提示内容。
 */
export function buildChatCommanderHintText(result: ChatCommanderTriggerResult): string {
  const lines: string[] = [
    "## Chat Orchestration Hint (manual trigger)",
    "",
    `触发原因：${result.reason}`,
  ];

  if (result.matchedPhrases.length > 0) {
    lines.push(`匹配关键词：${result.matchedPhrases.join(", ")}`);
  } else {
    lines.push("匹配关键词：(settings enabled)");
  }

  lines.push("");

  if (result.commanderTriggered) {
    lines.push("### 指挥模式（Commander Mode）");
    lines.push("你可以在当前对话中作为指挥官，实时调度子 Agent 完成复杂任务：");
    lines.push("- delegate_task：将单个子任务委托给子 Agent");
    lines.push("- delegate_parallel：并行委托多个子任务给不同子 Agent");
    lines.push("");
  }

  if (result.workflowTriggered) {
    lines.push("### 动态工作流模式（Dynamic Workflow Mode）");
    lines.push("你可以使用确定性脚本来编排多步骤任务，支持断点续传和预算控制：");
    lines.push("- run_workflow：执行预定义的工作流脚本（file 或 builtin）");
    lines.push("");
  }

  lines.push("### 注意事项");
  lines.push("- 所有子 Agent 调用仍受工具安全矩阵、预算和并发限制");
  lines.push("- 普通对话不需要使用这些工具，只在任务确实需要拆分 / 并行 / 工作流时使用");
  if (result.commanderTriggered && result.workflowTriggered) {
    lines.push("- 指挥模式适合需要灵活应变的任务；动态工作流适合步骤固定的确定性任务");
  } else if (result.commanderTriggered) {
    lines.push("- 指挥模式适合需要灵活应变、实时调整的任务");
  } else if (result.workflowTriggered) {
    lines.push("- 动态工作流适合步骤固定、规模较大、需要可靠重跑的任务");
  }

  return lines.join("\n");
}
