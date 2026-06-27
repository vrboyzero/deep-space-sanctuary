import type { JsonObject, Tool, ToolCallResult, ToolContext } from "../types.js";
import { withToolContract } from "../tool-contract.js";

const TOOL_NAME = "plan_current_get";

export const planCurrentGetTool: Tool = withToolContract({
  definition: {
    name: TOOL_NAME,
    description: "读取当前会话的统一计划状态（current plan state）。普通会话可以没有计划；当主 Agent 进入复杂多步任务推进时，用它读取当前正在维护的计划对象。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async execute(_args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
    const start = Date.now();
    const planState = context.conversationStore?.getPlanState?.(context.conversationId) ?? null;

    if (!context.conversationStore?.getPlanState) {
      return {
        id: "",
        name: TOOL_NAME,
        success: false,
        output: "",
        error: "Conversation plan state is not available in the current runtime.",
        failureKind: "environment_error",
        durationMs: Date.now() - start,
      };
    }

    return {
      id: "",
      name: TOOL_NAME,
      success: true,
      output: JSON.stringify({
        success: true,
        conversationId: context.conversationId,
        hasPlan: Boolean(planState),
        planState,
      }, null, 2),
      durationMs: Date.now() - start,
      metadata: {
        conversationId: context.conversationId,
        hasPlan: Boolean(planState),
        planState,
        revision: planState?.revision ?? null,
      },
    };
  },
}, {
  family: "other",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Read the current conversation plan state for complex multi-step work",
  resultSchema: {
    kind: "json",
    description: "Current conversation plan state snapshot.",
    jsonShape: {
      type: "object",
      properties: {
        success: { type: "boolean", description: "Whether the plan state read succeeded." },
        conversationId: { type: "string", description: "Current conversation id." },
        hasPlan: { type: "boolean", description: "Whether a current plan exists." },
        planState: { type: "object", description: "Current plan state object, or null when absent." },
      },
      required: ["success", "conversationId", "hasPlan", "planState"],
    },
  },
  outputPersistencePolicy: "conversation",
});
