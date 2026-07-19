import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TaskExperienceDetail } from "./experience-types.js";
import { MemoryStore } from "./store.js";
import type { TaskActivityRecord, TaskRecord } from "./task-types.js";

describe("task detail batch projection", () => {
  let rootDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-task-detail-batch-"));
    store = new MemoryStore(path.join(rootDir, "memory.db"));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it("matches legacy per-task detail fields while preserving requested task order", () => {
    const taskA = createTask("task-batch-a", "conv-batch-a", "2026-07-17T10:00:00.000Z");
    const taskB = createTask("task-batch-b", "conv-batch-b", "2026-07-17T11:00:00.000Z");
    store.createTask(taskA);
    store.createTask(taskB);

    for (let index = 0; index < 201; index += 1) {
      store.createTaskActivity(createActivity(taskA, index));
    }
    store.createTaskActivity(createActivity(taskB, 0));

    store.upsertChunk({
      id: "batch-link-a",
      sourcePath: "/tmp/batch-link-a.md",
      sourceType: "file",
      memoryType: "other",
      visibility: "private",
      content: "task A linked chunk",
    });
    store.upsertChunk({
      id: "batch-link-b",
      sourcePath: "/tmp/batch-link-b.md",
      sourceType: "file",
      memoryType: "other",
      visibility: "shared",
      content: "task B linked chunk",
    });
    store.linkTaskMemory(taskA.id, "batch-link-a", "used");
    store.linkTaskMemory(taskB.id, "batch-link-b", "generated");

    store.createExperienceCandidate({
      id: "batch-candidate",
      taskId: taskA.id,
      type: "method",
      status: "accepted",
      title: "Batch projection method",
      slug: "batch-projection-method",
      content: "# Batch projection method",
      sourceTaskSnapshot: {
        taskId: taskA.id,
        conversationId: taskA.conversationId,
        source: taskA.source,
        status: taskA.status,
        startedAt: taskA.startedAt,
      },
      createdAt: "2026-07-17T11:30:00.000Z",
    });

    for (let index = 0; index < 101; index += 1) {
      store.createExperienceUsage({
        id: `batch-usage-a-${index}`,
        taskId: taskA.id,
        assetType: "method",
        assetKey: `method-batch-${index}`,
        sourceCandidateId: index === 100 ? "batch-candidate" : undefined,
        usedVia: "search",
        createdAt: new Date(Date.UTC(2026, 6, 17, 12, 0, index)).toISOString(),
      });
    }
    store.createExperienceUsage({
      id: "batch-usage-b-shared",
      taskId: taskB.id,
      assetType: "method",
      assetKey: "method-batch-100",
      sourceCandidateId: "batch-candidate",
      usedVia: "tool",
      createdAt: "2026-07-17T13:00:00.000Z",
    });

    const requestedIds = [taskB.id, "missing-task", taskA.id, taskB.id, "  "];
    const expected = [taskB.id, taskA.id]
      .map((taskId) => getLegacyTaskDetail(store, taskId))
      .filter((detail): detail is TaskExperienceDetail => Boolean(detail));

    const actual = store.getTaskDetails(requestedIds);

    expect(actual).toEqual(expected);
    expect(actual[0]?.id).toBe(taskB.id);
    expect(actual[1]?.activities).toHaveLength(200);
    expect(actual[1]?.usedMethods).toHaveLength(100);
    expect(actual[0]?.usedMethods[0]).toMatchObject({
      assetKey: "method-batch-100",
      usageCount: 2,
      lastUsedTaskId: taskB.id,
      sourceCandidateTitle: "Batch projection method",
    });
  });
});

function getLegacyTaskDetail(store: MemoryStore, taskId: string): TaskExperienceDetail | null {
  const task = store.getTask(taskId);
  if (!task) return null;
  const usages = store.listExperienceUsages(100, { taskId });
  const toUsageSummary = (usage: (typeof usages)[number]) => {
    const stats = store.getExperienceUsageStats(usage.assetType, usage.assetKey);
    return {
      ...stats,
      usageId: usage.id,
      taskId: usage.taskId,
      assetType: usage.assetType,
      assetKey: usage.assetKey,
      sourceCandidateId: usage.sourceCandidateId ?? stats.sourceCandidateId,
      usedVia: usage.usedVia,
      createdAt: usage.createdAt,
    };
  };

  return {
    ...task,
    activities: store.listTaskActivities(taskId, 200),
    memoryLinks: store.listTaskMemoryLinks(taskId),
    usedMethods: usages.filter((item) => item.assetType === "method").map(toUsageSummary),
    usedSkills: usages.filter((item) => item.assetType === "skill").map(toUsageSummary),
  };
}

function createTask(id: string, conversationId: string, updatedAt: string): TaskRecord {
  return {
    id,
    conversationId,
    sessionKey: conversationId,
    source: "chat",
    status: "partial",
    title: `${id} title`,
    objective: `${id} objective`,
    summary: `${id} summary`,
    startedAt: updatedAt,
    createdAt: updatedAt,
    updatedAt,
  };
}

function createActivity(task: TaskRecord, sequence: number): TaskActivityRecord {
  const happenedAt = new Date(Date.UTC(2026, 6, 17, 10, 0, sequence)).toISOString();
  return {
    id: `${task.id}-activity-${sequence}`,
    taskId: task.id,
    conversationId: task.conversationId,
    sessionKey: task.sessionKey,
    source: task.source,
    kind: "tool_called",
    state: "completed",
    sequence,
    happenedAt,
    recordedAt: happenedAt,
    title: `${task.id} activity ${sequence}`,
  };
}
