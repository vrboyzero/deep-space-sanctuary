import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GoalManager } from "./manager.js";
import { GoalRuntimeBindingStore } from "../goal-runtime-binding-store.js";
import { upsertGoalRegistryEntry } from "./registry.js";

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

  it("requires a matching owner marker before recursively deleting a default goal root", async () => {
    const goal = await manager.createGoal({
      title: "Protected Goal Root",
      objective: "Owner marker must guard recursive cleanup.",
    });
    const markerPath = path.join(goal.goalRoot, ".belldandy-goal-owner.json");
    const retainedPath = path.join(goal.goalRoot, "retain-after-marker-loss.txt");

    await expect(fs.access(markerPath)).resolves.toBeUndefined();
    await fs.writeFile(retainedPath, "keep", "utf8");
    await manager.archiveGoal(goal.id, { reason: "Ready for guarded deletion." });
    await fs.unlink(markerPath);

    const result = await manager.deleteGoal(goal.id, { confirmText: goal.id });

    expect(result.cleanupWarnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/owner marker/i),
    ]));
    await expect(fs.readFile(retainedPath, "utf8")).resolves.toBe("keep");
  });

  it("does not recursively delete a user-configured goal root", async () => {
    const customRoot = path.join(stateDir, "workspace", "preserve-me");
    const goal = await manager.createGoal({
      title: "Custom Goal Root",
      objective: "User content must survive logical goal deletion.",
      goalRoot: customRoot,
    });
    const retainedPath = path.join(customRoot, "user-file.txt");
    await fs.writeFile(retainedPath, "keep", "utf8");
    await manager.archiveGoal(goal.id, { reason: "Custom root compatibility." });

    const preview = await manager.previewGoalDeletion(goal.id);
    expect(preview.storagePreview).toMatchObject({
      goalId: goal.id,
      roots: expect.arrayContaining([
        expect.objectContaining({ rootKind: "goal", action: "retain" }),
        expect.objectContaining({ rootKind: "docs", action: "remove" }),
      ]),
      warnings: expect.arrayContaining([
        expect.stringMatching(/user-configured goal root/i),
      ]),
    });
    await expect(fs.readFile(retainedPath, "utf8")).resolves.toBe("keep");

    const result = await manager.deleteGoal(goal.id, { confirmText: goal.id });

    expect(result.cleanupWarnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/user-configured goal root/i),
    ]));
    await expect(fs.readFile(retainedPath, "utf8")).resolves.toBe("keep");
  });

  it("retains legacy goal storage without an owner nonce while completing logical deletion", async () => {
    const goal = await manager.createGoal({
      title: "Legacy Goal Storage",
      objective: "Legacy roots cannot be proven to be owned.",
    });
    const retainedPath = path.join(goal.goalRoot, "retain-legacy.txt");
    await fs.writeFile(retainedPath, "keep", "utf8");
    const archived = await manager.archiveGoal(goal.id, { reason: "Exercise legacy ownership migration." });
    await upsertGoalRegistryEntry(stateDir, {
      ...archived,
      storageOwnerNonce: undefined,
    });

    const preview = await manager.previewGoalDeletion(goal.id);
    expect(preview.storagePreview.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/legacy goal storage has no owner nonce/i),
    ]));
    expect(preview.storagePreview.roots).toEqual(expect.arrayContaining([
      expect.objectContaining({ rootKind: "goal", action: "retain" }),
      expect.objectContaining({ rootKind: "docs", action: "retain" }),
    ]));

    const result = await manager.deleteGoal(goal.id, { confirmText: goal.id });
    expect(result.cleanupWarnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/legacy goal storage has no owner nonce/i),
    ]));
    expect(await manager.getGoal(goal.id)).toBeNull();
    await expect(fs.readFile(retainedPath, "utf8")).resolves.toBe("keep");
    await expect(fs.access(goal.docRoot)).resolves.toBeUndefined();
  });

  it("does not follow a default goal root replaced by a symlink or junction", async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-outside-"));
    try {
      const goal = await manager.createGoal({
        title: "Replaced Goal Root",
        objective: "Deletion must recheck the canonical root.",
      });
      const retainedPath = path.join(outsideRoot, "retain.txt");
      await fs.writeFile(retainedPath, "keep", "utf8");
      await manager.archiveGoal(goal.id, { reason: "Exercise root replacement guard." });
      await fs.rm(goal.goalRoot, { recursive: true, force: true });
      await fs.symlink(outsideRoot, goal.goalRoot, process.platform === "win32" ? "junction" : "dir");

      const result = await manager.deleteGoal(goal.id, { confirmText: goal.id });

      expect(result.cleanupWarnings).toEqual(expect.arrayContaining([
        expect.stringMatching(/resolves outside capability root/i),
      ]));
      await expect(fs.readFile(retainedPath, "utf8")).resolves.toBe("keep");
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
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
