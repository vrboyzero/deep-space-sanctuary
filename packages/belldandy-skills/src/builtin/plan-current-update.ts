import type {
  ConversationPlanPatchOperation,
  ConversationPlanState,
  ConversationPlanSeed,
  ConversationPlanUpdateInput,
  JsonObject,
  Tool,
  ToolCallResult,
  ToolContext,
} from "../types.js";
import { withToolContract } from "../tool-contract.js";

const TOOL_NAME = "plan_current_update";
type PlanLifecycleAction = "created" | "updated" | "replaced" | "cleared";

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readSeed(value: unknown): ConversationPlanSeed | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as ConversationPlanSeed;
}

function readOperations(value: unknown): ConversationPlanPatchOperation[] | undefined {
  if (Array.isArray(value)) {
    return value as ConversationPlanPatchOperation[];
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed as ConversationPlanPatchOperation[];
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function inferFailureKind(result: {
  conflict?: boolean;
  reasonCode?: string;
}): ToolCallResult["failureKind"] {
  if (result.conflict) {
    return "business_logic_error";
  }
  if (result.reasonCode === "invalid_patch" || result.reasonCode === "missing_seed") {
    return "input_error";
  }
  if (result.reasonCode === "missing_plan") {
    return "business_logic_error";
  }
  return "unknown";
}

function buildPlanLifecycleMetadata(input: {
  previousPlanState: ConversationPlanState | null;
  nextPlanState: ConversationPlanState | null;
  operations: ConversationPlanPatchOperation[];
  cleared: boolean;
}): {
  action: PlanLifecycleAction;
  hadExistingPlan: boolean;
  enteredPlanMode: boolean;
  switchedCurrentPlan: boolean;
  retainedTerminalSnapshot: boolean;
  operationTypes: string[];
  previousPlanId: string | null;
  planId: string | null;
  status: string | null;
  revision: number | null;
  stepCount: number;
} {
  const hadExistingPlan = Boolean(input.previousPlanState);
  const nextPlanState = input.nextPlanState ?? null;
  const operationTypes = input.operations
    .map((operation) => typeof operation?.type === "string" ? operation.type.trim() : "")
    .filter(Boolean);
  const switchedCurrentPlan = Boolean(
    input.previousPlanState
      && nextPlanState
      && input.previousPlanState.planId !== nextPlanState.planId,
  );
  const enteredPlanMode = !hadExistingPlan && Boolean(nextPlanState);
  const retainedTerminalSnapshot = Boolean(
    nextPlanState
      && (nextPlanState.status === "completed" || nextPlanState.status === "cancelled"),
  );

  let action: PlanLifecycleAction;
  if (input.cleared || !nextPlanState) {
    action = "cleared";
  } else if (switchedCurrentPlan) {
    action = "replaced";
  } else if (enteredPlanMode) {
    action = "created";
  } else {
    action = "updated";
  }

  return {
    action,
    hadExistingPlan,
    enteredPlanMode,
    switchedCurrentPlan,
    retainedTerminalSnapshot,
    operationTypes,
    previousPlanId: input.previousPlanState?.planId ?? null,
    planId: nextPlanState?.planId ?? null,
    status: nextPlanState?.status ?? null,
    revision: nextPlanState?.revision ?? null,
    stepCount: Array.isArray(nextPlanState?.steps) ? nextPlanState.steps.length : 0,
  };
}

export const planCurrentUpdateTool: Tool = withToolContract({
  definition: {
    name: TOOL_NAME,
    description: "以 patch 方式更新当前会话的统一计划状态。仅在复杂多步任务需要持续推进时创建或维护 current plan；完成后默认保留终态；为新任务制定新计划时用 replace 结束旧 current plan 并切换到新计划；goal/workflow/subtask refs 仅作只读 bridge 与跳转。",
    parameters: {
      type: "object",
      properties: {
        baseRevision: {
          type: "number",
          description: "可选。乐观并发控制版本号；若与当前 revision 不一致则返回 conflict。",
        },
        ifAbsent: {
          type: "string",
          enum: ["create", "reject"],
          description: "当前会话没有计划时的处理方式。仅在任务已明确进入复杂多步推进时使用 create；普通会话默认不建 plan。reject 会直接失败。",
        },
        seed: {
          type: "object",
          description: "create 模式下的计划种子，至少应包含 title，用于首次懒创建 current plan。",
        },
        operations: {
          type: "array",
          items: { type: "object" },
          description: "计划 patch 操作数组，例如 set_header / upsert_step / set_focus / set_status / attach_ref / clear。replace 用于显式结束旧 current plan 并切换到新计划；attach_ref 只记录只读 bridge，不接管底层真源。",
        },
      },
      required: ["operations"],
    },
  },
  async execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult> {
    const start = Date.now();

    if (!context.conversationStore?.updatePlanState) {
      return {
        id: "",
        name: TOOL_NAME,
        success: false,
        output: "",
        error: "Conversation plan state updates are not available in the current runtime.",
        failureKind: "environment_error",
        durationMs: Date.now() - start,
      };
    }

    const operations = readOperations(args.operations);
    if (!operations || operations.length === 0) {
      return {
        id: "",
        name: TOOL_NAME,
        success: false,
        output: "",
        error: "operations is required.",
        failureKind: "input_error",
        durationMs: Date.now() - start,
      };
    }

    const previousPlanState = context.conversationStore.getPlanState?.(context.conversationId) ?? null;
    const input: ConversationPlanUpdateInput = {
      operations,
      updatedBy: "agent",
    };
    const baseRevision = readFiniteNumber(args.baseRevision ?? args.base_revision);
    if (typeof baseRevision === "number") {
      input.baseRevision = Math.max(0, Math.floor(baseRevision));
    }
    const ifAbsent = readOptionalString(args.ifAbsent ?? args.if_absent);
    if (ifAbsent === "create" || ifAbsent === "reject") {
      input.ifAbsent = ifAbsent;
    }
    const seed = readSeed(args.seed);
    if (seed) {
      input.seed = seed;
    }

    const result = context.conversationStore.updatePlanState(context.conversationId, input);
    if (!result.applied) {
      return {
        id: "",
        name: TOOL_NAME,
        success: false,
        output: JSON.stringify({
          success: false,
          conversationId: context.conversationId,
          applied: false,
          conflict: result.conflict,
          reasonCode: result.reasonCode,
          message: result.message,
          planState: result.planState,
        }, null, 2),
        error: result.message ?? "Failed to update current plan state.",
        failureKind: inferFailureKind(result),
        durationMs: Date.now() - start,
        metadata: {
          conversationId: context.conversationId,
          applied: false,
          conflict: result.conflict,
          reasonCode: result.reasonCode ?? null,
          planState: result.planState,
          revision: result.planState?.revision ?? null,
        },
      };
    }

    const updatedAt = result.planState?.updatedAt ?? Date.now();
    const cleared = result.cleared === true || result.planState === null;
    const planLifecycle = buildPlanLifecycleMetadata({
      previousPlanState,
      nextPlanState: result.planState ?? null,
      operations,
      cleared,
    });
    context.broadcast?.("conversation.plan.updated", {
      conversationId: context.conversationId,
      source: "tool",
      planState: result.planState,
      revision: result.planState?.revision ?? null,
      updatedAt,
      cleared,
      reasonCode: result.reasonCode ?? "ok",
      planLifecycle,
    });

    return {
      id: "",
      name: TOOL_NAME,
      success: true,
      output: JSON.stringify({
        success: true,
        conversationId: context.conversationId,
        applied: true,
        cleared,
        reasonCode: result.reasonCode ?? "ok",
        planState: result.planState,
      }, null, 2),
      durationMs: Date.now() - start,
      metadata: {
        conversationId: context.conversationId,
        applied: true,
        cleared,
        reasonCode: result.reasonCode ?? "ok",
        planLifecycle,
        planState: result.planState,
        revision: result.planState?.revision ?? null,
        updatedAt,
      },
    };
  },
}, {
  family: "other",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway", "web"],
  safeScopes: ["local-safe", "web-safe"],
  activityDescription: "Patch the current conversation plan state for complex multi-step task orchestration",
  resultSchema: {
    kind: "json",
    description: "Conversation plan patch application result.",
    jsonShape: {
      type: "object",
      properties: {
        success: { type: "boolean", description: "Whether the plan update succeeded." },
        conversationId: { type: "string", description: "Current conversation id." },
        applied: { type: "boolean", description: "Whether the patch was applied." },
        cleared: { type: "boolean", description: "Whether the current plan was cleared." },
        reasonCode: { type: "string", description: "Patch result reason code." },
        planState: { type: "object", description: "Latest current plan state, or null when cleared." },
      },
      required: ["success", "conversationId", "applied", "cleared", "reasonCode", "planState"],
    },
  },
  outputPersistencePolicy: "external-state",
});
