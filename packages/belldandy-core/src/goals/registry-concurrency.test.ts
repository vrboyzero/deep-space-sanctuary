import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GoalManager } from "./manager.js";
import { withGoalRegistryMutationLock } from "./goal-registry-mutation-queue.js";
import { listGoalRegistryEntries, upsertGoalRegistryEntry } from "./registry.js";
import type { GoalRegistryEntry } from "./types.js";

describe("Goal registry concurrent mutations", () => {
  const stateDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(stateDirs.splice(0).map((stateDir) => fs.rm(stateDir, { recursive: true, force: true })));
  });

  it("keeps both entries when independent upserts share a state directory", async () => {
    const stateDir = await createStateDir();
    const alpha = createRegistryEntry(stateDir, "goal_alpha", "alpha");
    const beta = createRegistryEntry(stateDir, "goal_beta", "beta");

    await Promise.all([
      upsertGoalRegistryEntry(stateDir, alpha),
      // `.` 与绝对 stateDir 指向同一 registry，mutation owner 必须使用规范化 key。
      upsertGoalRegistryEntry(path.join(stateDir, "."), beta),
    ]);
    const entries = await listGoalRegistryEntries(stateDir);

    expect(entries.map((entry) => entry.id).sort()).toEqual([alpha.id, beta.id].sort());
  });

  it("rejects a same-slug concurrent create without replacing the published goal", async () => {
    const stateDir = await createStateDir();
    const firstManager = new GoalManager(stateDir);
    const secondManager = new GoalManager(stateDir);

    const results = await Promise.allSettled([
      firstManager.createGoal({ title: "Shared Goal", objective: "First owner" }),
      secondManager.createGoal({ title: "Shared Goal", objective: "Second owner" }),
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<GoalManager["createGoal"]>>> => (
      result.status === "fulfilled"
    ));
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const entries = await listGoalRegistryEntries(stateDir);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toMatch(/already registered/i);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(fulfilled[0]?.value.id);
  });

  it("releases the state directory lock after a mutation fails", async () => {
    const stateDir = await createStateDir();

    await expect(withGoalRegistryMutationLock(stateDir, async () => {
      throw new Error("expected mutation failure");
    })).rejects.toThrow("expected mutation failure");

    await expect(withGoalRegistryMutationLock(path.join(stateDir, "."), async () => "next mutation"))
      .resolves.toBe("next mutation");
  });

  async function createStateDir(): Promise<string> {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-goal-registry-concurrency-"));
    stateDirs.push(stateDir);
    return stateDir;
  }
});

function createRegistryEntry(stateDir: string, id: string, slug: string): GoalRegistryEntry {
  const goalRoot = path.join(stateDir, "goals", id);
  const docRoot = path.join(stateDir, "goals-docs", slug);
  const now = "2026-07-17T00:00:00.000Z";
  return {
    id,
    slug,
    title: slug,
    status: "planning",
    goalRoot,
    runtimeRoot: goalRoot,
    docRoot,
    northstarPath: path.join(docRoot, "NORTHSTAR.md"),
    tasksPath: path.join(docRoot, "tasks.json"),
    progressPath: path.join(docRoot, "progress.md"),
    handoffPath: path.join(docRoot, "handoff.md"),
    registryPath: path.join(stateDir, "goals", "index.json"),
    pathSource: "default",
    createdAt: now,
    updatedAt: now,
  };
}
