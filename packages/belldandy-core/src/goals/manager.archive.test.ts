import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GoalManager } from "./manager.js";
import { GoalRuntimeBindingStore } from "../goal-runtime-binding-store.js";

describe("GoalManager archive", () => {
  let stateDir: string;
  let manager: GoalManager;

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-archive-"));
    manager = new GoalManager(stateDir);
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  });

  it("archives a goal, records metadata, and hides it from default list results", async () => {
    const goal = await manager.createGoal({
      title: "Archive Dream Retrieval Goal",
      objective: "Validate archived metadata and list filtering.",
    });

    const archived = await manager.archiveGoal(goal.id, {
      reason: "No longer active for this phase.",
    });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.archiveReason).toBe("No longer active for this phase.");
    expect(archived.activeConversationId).toBeUndefined();
    expect(archived.activeNodeId).toBeUndefined();

    expect(await manager.listGoals()).toEqual([]);
    expect(await manager.listGoals({ includeArchived: true })).toEqual([
      expect.objectContaining({
        id: goal.id,
        status: "archived",
        archiveReason: "No longer active for this phase.",
      }),
    ]);

    const persisted = await manager.getGoal(goal.id);
    expect(persisted).toMatchObject({
      id: goal.id,
      status: "archived",
      archiveReason: "No longer active for this phase.",
    });

    const progress = await fs.readFile(goal.progressPath, "utf-8");
    expect(progress).toContain("goal_archived");
    expect(progress).toContain("No longer active for this phase.");
  });

  it("refuses to archive a goal that is still executing", async () => {
    const goal = await manager.createGoal({
      title: "Executing Goal",
      objective: "Archive should reject running goals.",
    });

    await manager.resumeGoal(goal.id);

    await expect(manager.archiveGoal(goal.id, {
      reason: "Should be rejected while running.",
    })).rejects.toThrow(/cannot be archived/i);
  });

  it("deletes an archived goal, removes bindings, and clears goal artifacts", async () => {
    const goal = await manager.createGoal({
      title: "Delete Archived Goal",
      objective: "Validate hard delete after archive.",
    });
    const bindingStore = new GoalRuntimeBindingStore(stateDir);

    await manager.resumeGoal(goal.id);
    await manager.pauseGoal(goal.id);
    await manager.archiveGoal(goal.id, {
      reason: "Ready to delete.",
    });

    expect(await bindingStore.listBindings({ goalId: goal.id })).not.toEqual([]);

    const result = await manager.deleteGoal(goal.id, {
      confirmText: goal.id,
    });

    expect(result.goalId).toBe(goal.id);
    expect(result.cleanupWarnings).toEqual([]);
    expect(await manager.getGoal(goal.id)).toBeNull();
    expect(await manager.listGoals({ includeArchived: true })).toEqual([]);
    expect(await new GoalRuntimeBindingStore(stateDir).listBindings({ goalId: goal.id })).toEqual([]);
    await expect(fs.access(goal.goalRoot)).rejects.toThrow();
    await expect(fs.access(goal.docRoot)).rejects.toThrow();
  });

  it("refuses to delete a goal that is not archived or not explicitly confirmed", async () => {
    const goal = await manager.createGoal({
      title: "Protected Goal",
      objective: "Delete should keep safety boundaries.",
    });

    await expect(manager.deleteGoal(goal.id, {
      confirmText: goal.id,
    })).rejects.toThrow(/must be archived/i);

    await manager.archiveGoal(goal.id, {
      reason: "Archived but still protected.",
    });

    await expect(manager.deleteGoal(goal.id, {
      confirmText: "wrong-confirmation",
    })).rejects.toThrow(/confirmation mismatch/i);
  });
});
