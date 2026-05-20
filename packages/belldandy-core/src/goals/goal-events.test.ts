import { describe, expect, it } from "vitest";
import { GOAL_UPDATE_PROTOCOL, getGoalUpdateAreas } from "./goal-events.js";
import type { GoalUpdateReason } from "./types.js";

describe("goal update protocol", () => {
  it("maps goal resume reason to the expected refresh areas", () => {
    expect(getGoalUpdateAreas("goal_resumed")).toEqual(["goal", "handoff", "tracking", "progress"]);
  });

  it("maps goal archive reason to the expected refresh areas", () => {
    expect(getGoalUpdateAreas("goal_archived")).toEqual(["goal", "handoff", "tracking", "progress"]);
  });

  it("maps goal delete reason to the expected refresh areas", () => {
    expect(getGoalUpdateAreas("goal_deleted")).toEqual(["goal", "handoff", "tracking", "progress", "capability"]);
  });

  it("maps capability plan save reason to the expected refresh areas", () => {
    expect(getGoalUpdateAreas("capability_plan_saved")).toEqual(["capability", "progress", "handoff"]);
  });

  it("covers every supported goal update reason", () => {
    const reasons: GoalUpdateReason[] = [
      "goal_resumed",
      "goal_paused",
      "goal_archived",
      "goal_deleted",
      "task_node_created",
      "task_node_updated",
      "task_node_claimed",
      "task_node_pending_review",
      "task_node_validating",
      "task_node_completed",
      "task_node_blocked",
      "task_node_failed",
      "task_node_skipped",
      "capability_plan_saved",
      "capability_plan_orchestrated",
      "checkpoint_requested",
      "checkpoint_approved",
      "checkpoint_rejected",
      "checkpoint_expired",
      "checkpoint_reopened",
    ];

    for (const reason of reasons) {
      expect(GOAL_UPDATE_PROTOCOL[reason]).toBeDefined();
      expect(GOAL_UPDATE_PROTOCOL[reason].areas.length).toBeGreaterThan(0);
      expect(typeof GOAL_UPDATE_PROTOCOL[reason].summary).toBe("string");
    }
  });
});
