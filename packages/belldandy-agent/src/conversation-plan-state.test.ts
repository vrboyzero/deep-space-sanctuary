import { describe, expect, it } from "vitest";

import { updateConversationPlanState } from "./conversation-plan-state.js";

describe("conversation plan state", () => {
  it("replace starts a new current plan instance instead of mutating the old lifecycle", () => {
    const created = updateConversationPlanState(null, {
      ifAbsent: "create",
      seed: {
        title: "旧计划",
        status: "active",
        mode: "agent",
      },
      operations: [
        {
          type: "upsert_step",
          step: {
            id: "step-old",
            title: "旧步骤",
            status: "in_progress",
          },
        },
      ],
      updatedBy: "agent",
    }, 100);

    expect(created.applied).toBe(true);
    expect(created.planState).toMatchObject({
      title: "旧计划",
      revision: 1,
      createdAt: 100,
      steps: [
        {
          id: "step-old",
          title: "旧步骤",
          status: "in_progress",
        },
      ],
    });

    const replaced = updateConversationPlanState(created.planState, {
      baseRevision: created.planState?.revision,
      operations: [
        {
          type: "replace",
          plan: {
            version: 1,
            planId: "plan-new",
            status: "active",
            title: "新计划",
            mode: "agent",
            summary: "替换旧 current plan",
            currentStepId: "step-new",
            nextAction: "进入新任务",
            blocker: undefined,
            steps: [
              {
                id: "step-new",
                title: "新步骤",
                status: "pending",
                updatedAt: 0,
              },
            ],
          },
        },
      ],
      updatedBy: "agent",
    }, 200);

    expect(replaced.applied).toBe(true);
    expect(replaced.planState).toMatchObject({
      planId: "plan-new",
      title: "新计划",
      summary: "替换旧 current plan",
      revision: 0,
      createdAt: 200,
      updatedAt: 200,
      currentStepId: "step-new",
      nextAction: "进入新任务",
      steps: [
        {
          id: "step-new",
          title: "新步骤",
          status: "pending",
          updatedAt: 200,
        },
      ],
    });
    expect(replaced.planState?.planId).not.toBe(created.planState?.planId);
    expect(replaced.planState?.createdAt).not.toBe(created.planState?.createdAt);
  });
});
