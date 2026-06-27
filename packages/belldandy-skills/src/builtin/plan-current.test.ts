import { describe, expect, it, vi } from "vitest";

import { ToolExecutor } from "../executor.js";
import type { ConversationPlanState, ToolCallRequest } from "../types.js";
import { planCurrentGetTool } from "./plan-current-get.js";
import { planCurrentUpdateTool } from "./plan-current-update.js";

function createConversationStore() {
  let planState: ConversationPlanState | null = null;

  return {
    getHistory: () => [],
    getPlanState: () => planState ? {
      ...planState,
      steps: planState.steps.map((step) => ({
        ...step,
        ...(step.refs ? { refs: step.refs.map((ref) => ({ ...ref })) } : {}),
      })),
    } : null,
    updatePlanState: (_conversationId: string, input: {
      baseRevision?: number;
      ifAbsent?: "create" | "reject";
      seed?: { title: string; summary?: string; mode?: "agent" | "manual"; status?: "draft" | "active" };
      operations: Array<Record<string, unknown>>;
      updatedBy?: "agent" | "user" | "system";
    }) => {
      if (typeof input.baseRevision === "number" && planState && input.baseRevision !== planState.revision) {
        return {
          applied: false,
          conflict: true,
          planState,
          reasonCode: "conflict" as const,
          message: `Plan revision conflict: expected ${input.baseRevision}, current ${planState.revision}.`,
        };
      }
      if (!planState) {
        if (input.ifAbsent === "reject") {
          return {
            applied: false,
            conflict: false,
            planState: null,
            reasonCode: "missing_plan" as const,
            message: "No current plan exists.",
          };
        }
        if (!input.seed) {
          return {
            applied: false,
            conflict: false,
            planState: null,
            reasonCode: "missing_seed" as const,
            message: "seed is required when creating a new plan.",
          };
        }
        const now = Date.now();
        planState = {
          version: 1,
          planId: "plan-test",
          revision: 0,
          status: input.seed.status ?? "draft",
          title: input.seed.title,
          ...(input.seed.summary ? { summary: input.seed.summary } : {}),
          mode: input.seed.mode ?? "agent",
          createdAt: now,
          updatedAt: now,
          updatedBy: input.updatedBy ?? "agent",
          steps: [],
        };
      }

      for (const operation of input.operations) {
        if (operation.type === "clear") {
          planState = null;
          return {
            applied: true,
            conflict: false,
            cleared: true,
            planState: null,
            reasonCode: "ok" as const,
          };
        }
        if (!planState) {
          return {
            applied: false,
            conflict: false,
            planState: null,
            reasonCode: "missing_plan" as const,
            message: "Plan was cleared before remaining operations were applied.",
          };
        }
        if (operation.type === "set_header") {
          planState = {
            ...planState,
            ...(typeof operation.title === "string" ? { title: operation.title } : {}),
            ...(typeof operation.summary === "string" ? { summary: operation.summary } : {}),
            revision: planState.revision + 1,
            updatedAt: Date.now(),
            updatedBy: input.updatedBy ?? "agent",
          };
        }
        if (operation.type === "set_focus") {
          planState = {
            ...planState,
            ...(typeof operation.currentStepId === "string" ? { currentStepId: operation.currentStepId } : {}),
            ...(typeof operation.nextAction === "string" ? { nextAction: operation.nextAction } : {}),
            ...(typeof operation.blocker === "string" ? { blocker: operation.blocker } : {}),
            revision: planState.revision + 1,
            updatedAt: Date.now(),
            updatedBy: input.updatedBy ?? "agent",
          };
        }
        if (operation.type === "upsert_step" && operation.step && typeof operation.step === "object") {
          const step = operation.step as {
            id: string;
            title: string;
            status: "pending" | "in_progress" | "blocked" | "completed" | "skipped";
          };
          const nextSteps = planState.steps.filter((item) => item.id !== step.id);
          nextSteps.push({
            ...step,
            updatedAt: Date.now(),
          });
          planState = {
            ...planState,
            steps: nextSteps,
            revision: planState.revision + 1,
            updatedAt: Date.now(),
            updatedBy: input.updatedBy ?? "agent",
          };
        }
        if (operation.type === "replace" && operation.plan && typeof operation.plan === "object") {
          const nextPlan = operation.plan as {
            version: 1;
            planId: string;
            status: "draft" | "active" | "blocked" | "completed" | "cancelled";
            title: string;
            mode: "agent" | "manual";
            summary?: string;
            currentStepId?: string;
            nextAction?: string;
            blocker?: string;
            steps?: Array<{
              id: string;
              title: string;
              summary?: string;
              status: "pending" | "in_progress" | "blocked" | "completed" | "skipped";
              blocker?: string;
            }>;
          };
          const now = Date.now();
          planState = {
            version: 1,
            planId: nextPlan.planId,
            revision: 0,
            status: nextPlan.status,
            title: nextPlan.title,
            ...(nextPlan.summary ? { summary: nextPlan.summary } : {}),
            mode: nextPlan.mode,
            createdAt: now,
            updatedAt: now,
            updatedBy: input.updatedBy ?? "agent",
            ...(nextPlan.currentStepId ? { currentStepId: nextPlan.currentStepId } : {}),
            ...(nextPlan.nextAction ? { nextAction: nextPlan.nextAction } : {}),
            ...(nextPlan.blocker ? { blocker: nextPlan.blocker } : {}),
            steps: Array.isArray(nextPlan.steps)
              ? nextPlan.steps.map((step) => ({
                ...step,
                updatedAt: now,
              }))
              : [],
          };
        }
      }

      return {
        applied: true,
        conflict: false,
        planState,
        reasonCode: "ok" as const,
      };
    },
    clearPlanState: () => {
      planState = null;
      return null;
    },
  };
}

describe("plan current tools", () => {
  it("plan_current_get returns current conversation plan state", async () => {
    const conversationStore = createConversationStore();
    conversationStore.updatePlanState("conv-plan", {
      ifAbsent: "create",
      seed: {
        title: "Phase A",
        status: "active",
        mode: "agent",
      },
      operations: [{
        type: "upsert_step",
        step: {
          id: "step-a",
          title: "补齐会话真源",
          status: "in_progress",
        },
      }],
      updatedBy: "agent",
    });

    const executor = new ToolExecutor({
      tools: [planCurrentGetTool],
      workspaceRoot: "/tmp/test",
      conversationStore,
    });

    const result = await executor.execute({
      id: "plan-get-1",
      name: "plan_current_get",
      arguments: {},
    }, "conv-plan");

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload).toMatchObject({
      success: true,
      conversationId: "conv-plan",
      hasPlan: true,
      planState: {
        title: "Phase A",
        steps: [{
          id: "step-a",
          title: "补齐会话真源",
          status: "in_progress",
        }],
      },
    });
  });

  it("plan_current_update applies patch and emits conversation.plan.updated", async () => {
    const conversationStore = createConversationStore();
    const broadcast = vi.fn();
    const executor = new ToolExecutor({
      tools: [planCurrentUpdateTool],
      workspaceRoot: "/tmp/test",
      conversationStore,
      broadcast,
    });

    const request: ToolCallRequest = {
      id: "plan-update-1",
      name: "plan_current_update",
      arguments: {
        ifAbsent: "create",
        seed: {
          title: "Phase A",
          status: "active",
          mode: "agent",
        },
        operations: [
          {
            type: "set_header",
            summary: "先补 store / tools / server / tests",
          },
          {
            type: "upsert_step",
            step: {
              id: "store",
              title: "补 store 真源",
              status: "in_progress",
            },
          },
        ],
      },
    };

    const result = await executor.execute(request, "conv-plan-update");

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload).toMatchObject({
      success: true,
      conversationId: "conv-plan-update",
      applied: true,
      cleared: false,
      planState: {
        title: "Phase A",
        status: "active",
        steps: [{
          id: "store",
          title: "补 store 真源",
          status: "in_progress",
        }],
      },
    });
    expect(result.metadata).toMatchObject({
      planLifecycle: {
        action: "created",
        hadExistingPlan: false,
        enteredPlanMode: true,
        switchedCurrentPlan: false,
        retainedTerminalSnapshot: false,
        operationTypes: ["set_header", "upsert_step"],
      },
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith("conversation.plan.updated", expect.objectContaining({
      conversationId: "conv-plan-update",
      source: "tool",
      cleared: false,
      revision: expect.any(Number),
      planLifecycle: expect.objectContaining({
        action: "created",
        enteredPlanMode: true,
        switchedCurrentPlan: false,
      }),
      planState: expect.objectContaining({
        title: "Phase A",
      }),
    }));
  });

  it("plan_current_update returns conflict on stale revision", async () => {
    const conversationStore = createConversationStore();
    conversationStore.updatePlanState("conv-plan-conflict", {
      ifAbsent: "create",
      seed: {
        title: "Phase A",
        status: "active",
        mode: "agent",
      },
      operations: [{
        type: "upsert_step",
        step: {
          id: "server",
          title: "补 server 投影",
          status: "in_progress",
        },
      }],
      updatedBy: "agent",
    });

    const executor = new ToolExecutor({
      tools: [planCurrentUpdateTool],
      workspaceRoot: "/tmp/test",
      conversationStore,
    });

    const result = await executor.execute({
      id: "plan-update-conflict",
      name: "plan_current_update",
      arguments: {
        baseRevision: 0,
        operations: [{
          type: "set_header",
          title: "过期版本修改",
        }],
      },
    }, "conv-plan-conflict");

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("business_logic_error");
    expect(result.error).toContain("Plan revision conflict");
    const payload = JSON.parse(result.output);
    expect(payload).toMatchObject({
      success: false,
      applied: false,
      conflict: true,
      reasonCode: "conflict",
      planState: {
        title: "Phase A",
        revision: 1,
      },
    });
  });

  it("plan_current_update exposes replace and clear lifecycle metadata", async () => {
    const conversationStore = createConversationStore();
    const broadcast = vi.fn();
    const executor = new ToolExecutor({
      tools: [planCurrentUpdateTool],
      workspaceRoot: "/tmp/test",
      conversationStore,
      broadcast,
    });

    const initial = await executor.execute({
      id: "plan-update-create-lifecycle-2",
      name: "plan_current_update",
      arguments: {
        ifAbsent: "create",
        seed: {
          title: "Phase A",
          status: "active",
          mode: "agent",
        },
        operations: [{
          type: "upsert_step",
          step: {
            id: "step-a",
            title: "旧步骤",
            status: "in_progress",
          },
        }],
      },
    }, "conv-plan-lifecycle");

    expect(initial.success).toBe(true);
    broadcast.mockClear();

    const replaced = await executor.execute({
      id: "plan-update-replace-lifecycle",
      name: "plan_current_update",
      arguments: {
        operations: [{
          type: "replace",
          plan: {
            version: 1,
            planId: "plan-replaced",
            status: "active",
            title: "Phase B",
            mode: "agent",
            currentStepId: "step-b",
            nextAction: "切换新计划",
            steps: [{
              id: "step-b",
              title: "新步骤",
              status: "pending",
            }],
          },
        }],
      },
    }, "conv-plan-lifecycle");

    expect(replaced.success).toBe(true);
    expect(replaced.metadata).toMatchObject({
      planLifecycle: {
        action: "replaced",
        hadExistingPlan: true,
        enteredPlanMode: false,
        switchedCurrentPlan: true,
        planId: "plan-replaced",
        previousPlanId: "plan-test",
      },
    });
    expect(broadcast).toHaveBeenLastCalledWith("conversation.plan.updated", expect.objectContaining({
      planLifecycle: expect.objectContaining({
        action: "replaced",
        switchedCurrentPlan: true,
      }),
    }));

    const cleared = await executor.execute({
      id: "plan-update-clear-lifecycle",
      name: "plan_current_update",
      arguments: {
        operations: [{
          type: "clear",
        }],
      },
    }, "conv-plan-lifecycle");

    expect(cleared.success).toBe(true);
    expect(cleared.metadata).toMatchObject({
      cleared: true,
      planLifecycle: {
        action: "cleared",
        hadExistingPlan: true,
        enteredPlanMode: false,
        switchedCurrentPlan: false,
        planId: null,
      },
    });
    expect(broadcast).toHaveBeenLastCalledWith("conversation.plan.updated", expect.objectContaining({
      cleared: true,
      planLifecycle: expect.objectContaining({
        action: "cleared",
      }),
    }));
  });
});
