import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";

import { MemoryManager, clearMemoryTreeJobInflightForTest, registerGlobalMemoryManager } from "@belldandy/memory";

import { handleMemoryExperienceMethod } from "./server-methods/memory-experience.js";
import { cleanupGlobalMemoryManagersForTest } from "./server-testkit.js";

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(() => {
  cleanupGlobalMemoryManagersForTest();
  clearMemoryTreeJobInflightForTest();
});

test("memory.tree.lifecycle.get and ensure expose managed dirty states and refresh results", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-lifecycle-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-lifecycle-workspace-"));
  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(manager);

  try {
    manager.upsertMemoryChunk({
      id: "rpc-lifecycle-core",
      sourcePath: path.join(stateDir, "MEMORY.md"),
      sourceType: "file",
      memoryType: "other",
      agentId: "default",
      visibility: "private",
      content: "goal alpha rollout prefers stable high-level anchors before evidence expansion.",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
    };
    store.createTask({
      id: "rpc-lifecycle-task-1",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "default",
      source: "chat",
      status: "success",
      title: "Ship goal alpha rollout",
      summary: "Finalize goal alpha rollout checklist.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-21T09:00:00.000Z",
      finishedAt: "2026-05-21T09:20:00.000Z",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:20:00.000Z",
    });
    store.linkTaskMemory("rpc-lifecycle-task-1", "rpc-lifecycle-core", "generated");

    const getBefore = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-get-before",
      method: "memory.tree.lifecycle.get",
      params: {
        kinds: ["profile", "global"],
      },
    }, { stateDir });
    expect(getBefore).toBeTruthy();
    if (!getBefore || !getBefore.ok) {
      throw new Error("expected successful memory.tree.lifecycle.get response before ensure");
    }
    expect(getBefore.payload?.snapshot).toMatchObject({
      source: expect.objectContaining({
        dirty: true,
      }),
      nodes: expect.arrayContaining([
        expect.objectContaining({
          kind: "profile",
          dirty: true,
          reasons: expect.arrayContaining(["missing_nodes", "never_rebuilt"]),
        }),
        expect.objectContaining({
          kind: "global",
          dirty: true,
          reasons: expect.arrayContaining(["missing_nodes", "never_rebuilt"]),
        }),
      ]),
    });

    const ensureRes = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-ensure",
      method: "memory.tree.lifecycle.ensure",
      params: {
        kinds: ["profile", "global"],
        nodeLimit: 10,
      },
    }, { stateDir });
    expect(ensureRes).toBeTruthy();
    if (!ensureRes || !ensureRes.ok) {
      throw new Error("expected successful memory.tree.lifecycle.ensure response");
    }
    expect(ensureRes.payload?.result).toMatchObject({
      sourceRebuilt: true,
      rebuiltKinds: ["profile", "global"],
      before: {
        source: expect.objectContaining({
          dirty: true,
        }),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            kind: "profile",
            dirty: true,
          }),
          expect.objectContaining({
            kind: "global",
            dirty: true,
          }),
        ]),
      },
      after: {
        source: expect.objectContaining({
          dirty: false,
        }),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            kind: "profile",
            dirty: false,
          }),
          expect.objectContaining({
            kind: "global",
            dirty: false,
          }),
        ]),
      },
    });

    const getAfter = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-get-after",
      method: "memory.tree.lifecycle.get",
      params: {
        kinds: ["profile", "global"],
      },
    }, { stateDir });
    expect(getAfter).toBeTruthy();
    if (!getAfter || !getAfter.ok) {
      throw new Error("expected successful memory.tree.lifecycle.get response after ensure");
    }
    expect(getAfter.payload?.snapshot).toMatchObject({
      source: expect.objectContaining({
        dirty: false,
      }),
      nodes: expect.arrayContaining([
        expect.objectContaining({
          kind: "profile",
          dirty: false,
        }),
        expect.objectContaining({
          kind: "global",
          dirty: false,
        }),
      ]),
    });

    const jobReportAfterEnsure = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-job-report-after-ensure",
      method: "memory.tree.job.report",
      params: {
        kinds: ["profile", "global"],
      },
    }, { stateDir });
    expect(jobReportAfterEnsure).toBeTruthy();
    if (!jobReportAfterEnsure || !jobReportAfterEnsure.ok) {
      throw new Error("expected successful memory.tree.job.report response after ensure");
    }
    const ensuredJobReport = jobReportAfterEnsure.payload?.report as Record<string, any> | undefined;
    expect(ensuredJobReport?.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "source_rebuild:source",
        triggerSource: "memory.tree.lifecycle.ensure",
      }),
      expect.objectContaining({
        jobKey: "node_rebuild:profile",
        triggerSource: "memory.tree.lifecycle.ensure",
      }),
      expect.objectContaining({
        jobKey: "node_rebuild:global",
        triggerSource: "memory.tree.lifecycle.ensure",
      }),
    ]));

    manager.upsertMemoryChunk({
      id: "rpc-lifecycle-global",
      sourcePath: path.join(workspaceRoot, "roadmap.md"),
      sourceType: "file",
      memoryType: "other",
      category: "fact",
      content: "goal beta regression guard now joins the workspace focus.",
    });
    store.createTask({
      id: "rpc-lifecycle-task-2",
      conversationId: "goal:beta:conv",
      sessionKey: "goal:beta:conv",
      agentId: "default",
      source: "chat",
      status: "partial",
      title: "Review goal beta guard",
      summary: "Check goal beta regression guard before release.",
      metadata: { goalId: "goal-beta" },
      startedAt: "2026-05-21T10:00:00.000Z",
      finishedAt: "2026-05-21T10:10:00.000Z",
      createdAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:10:00.000Z",
    });
    store.linkTaskMemory("rpc-lifecycle-task-2", "rpc-lifecycle-global", "used");

    const getDirtyAgain = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-get-dirty-again",
      method: "memory.tree.lifecycle.get",
      params: {
        kinds: ["profile", "global"],
      },
    }, { stateDir });
    expect(getDirtyAgain).toBeTruthy();
    if (!getDirtyAgain || !getDirtyAgain.ok) {
      throw new Error("expected successful memory.tree.lifecycle.get response after new memory changes");
    }
    expect(getDirtyAgain.payload?.snapshot).toMatchObject({
      source: expect.objectContaining({
        dirty: true,
        reasons: expect.arrayContaining(["memory_changed"]),
      }),
      nodes: expect.arrayContaining([
        expect.objectContaining({
          kind: "profile",
          dirty: true,
          reasons: expect.arrayContaining(["memory_changed", "task_changed"]),
        }),
        expect.objectContaining({
          kind: "global",
          dirty: true,
          reasons: expect.arrayContaining(["memory_changed", "task_changed"]),
        }),
      ]),
    });
  } finally {
    manager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test("memory.tree.lifecycle.ensure records last_error and cooldown when managed rebuild fails", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-lifecycle-failure-"));
  const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-tree-lifecycle-failure-workspace-"));
  const manager = new MemoryManager({
    workspaceRoot,
    stateDir,
    taskMemoryEnabled: true,
  });
  registerGlobalMemoryManager(manager);

  try {
    manager.upsertMemoryChunk({
      id: "rpc-lifecycle-failure-core",
      sourcePath: path.join(stateDir, "MEMORY.md"),
      sourceType: "file",
      memoryType: "other",
      agentId: "default",
      visibility: "private",
      content: "goal alpha profile anchor should be refreshed through lifecycle ensure.",
    });

    const store = (manager as any).store as {
      createTask: (task: Record<string, unknown>) => void;
      linkTaskMemory: (taskId: string, chunkId: string, relation: "used" | "generated" | "referenced") => void;
      upsertMemoryTreeNodes: (...args: any[]) => void;
    };
    store.createTask({
      id: "rpc-lifecycle-failure-task-1",
      conversationId: "goal:alpha:conv",
      sessionKey: "goal:alpha:conv",
      agentId: "default",
      source: "chat",
      status: "success",
      title: "Ship goal alpha rollout",
      summary: "Finalize goal alpha rollout checklist.",
      metadata: { goalId: "goal-alpha", goalSession: true },
      startedAt: "2026-05-21T09:00:00.000Z",
      finishedAt: "2026-05-21T09:20:00.000Z",
      createdAt: "2026-05-21T09:00:00.000Z",
      updatedAt: "2026-05-21T09:20:00.000Z",
    });
    store.linkTaskMemory("rpc-lifecycle-failure-task-1", "rpc-lifecycle-failure-core", "generated");

    const originalUpsertMemoryTreeNodes = store.upsertMemoryTreeNodes.bind(store);
    store.upsertMemoryTreeNodes = () => {
      throw new Error("profile lifecycle boom");
    };

    const ensureFailed = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-ensure-failed",
      method: "memory.tree.lifecycle.ensure",
      params: {
        kinds: ["profile"],
        nodeLimit: 10,
        rebuildSources: false,
      },
    }, { stateDir });
    expect(ensureFailed).toBeTruthy();
    if (!ensureFailed || !ensureFailed.ok) {
      throw new Error("expected successful memory.tree.lifecycle.ensure response for failure recording");
    }
    const failedResult = ensureFailed.payload?.result as Record<string, any> | undefined;
    expect(failedResult).toBeTruthy();
    expect(failedResult?.sourceRebuilt).toBe(false);
    expect(failedResult?.rebuiltKinds).toEqual([]);
    expect(failedResult?.skipped).toEqual([]);
    expect(failedResult?.failures).toEqual([
      expect.objectContaining({
        target: "profile",
        message: "profile lifecycle boom",
      }),
    ]);
    expect(failedResult?.after?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "profile",
        dirty: true,
        reasons: expect.arrayContaining(["last_error", "cooldown_active"]),
        governance: expect.objectContaining({
          failureCount: 1,
          lastError: "profile lifecycle boom",
          cooldownActive: true,
          cooldownUntil: expect.any(String),
        }),
      }),
    ]));

    const getFailed = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-get-failed",
      method: "memory.tree.lifecycle.get",
      params: {
        kinds: ["profile"],
      },
    }, { stateDir });
    expect(getFailed).toBeTruthy();
    if (!getFailed || !getFailed.ok) {
      throw new Error("expected successful memory.tree.lifecycle.get response after failure recording");
    }
    const failedSnapshot = getFailed.payload?.snapshot as Record<string, any> | undefined;
    expect(failedSnapshot?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "profile",
        governance: expect.objectContaining({
          failureCount: 1,
          lastError: "profile lifecycle boom",
          cooldownActive: true,
        }),
      }),
    ]));

    const jobReportFailed = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-job-report-after-failure",
      method: "memory.tree.job.report",
      params: {
        kinds: ["profile"],
      },
    }, { stateDir });
    expect(jobReportFailed).toBeTruthy();
    if (!jobReportFailed || !jobReportFailed.ok) {
      throw new Error("expected successful memory.tree.job.report response after failure recording");
    }
    const failedJobReport = jobReportFailed.payload?.report as Record<string, any> | undefined;
    expect(failedJobReport?.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "node_rebuild:profile",
        status: "cooldown",
        lastFailureAt: expect.any(String),
        lastFailureError: "profile lifecycle boom",
        nextEligibleAt: expect.any(String),
        triggerSource: "memory.tree.lifecycle.ensure",
      }),
    ]));

    const ensureSkipped = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-lifecycle-ensure-skipped",
      method: "memory.tree.lifecycle.ensure",
      params: {
        kinds: ["profile"],
        nodeLimit: 10,
        rebuildSources: false,
      },
    }, { stateDir });
    expect(ensureSkipped).toBeTruthy();
    if (!ensureSkipped || !ensureSkipped.ok) {
      throw new Error("expected successful memory.tree.lifecycle.ensure response during cooldown");
    }
    const skippedResult = ensureSkipped.payload?.result as Record<string, any> | undefined;
    expect(skippedResult?.rebuiltKinds).toEqual([]);
    expect(skippedResult?.failures).toEqual([]);
    expect(skippedResult?.skipped).toEqual([
      expect.objectContaining({
        target: "profile",
        reason: "cooldown_active",
        lastError: "profile lifecycle boom",
        failureCount: 1,
      }),
    ]);

    const jobReportSkipped = await handleMemoryExperienceMethod({
      type: "req",
      id: "memory-tree-job-report-after-cooldown-skip",
      method: "memory.tree.job.report",
      params: {
        kinds: ["profile"],
      },
    }, { stateDir });
    expect(jobReportSkipped).toBeTruthy();
    if (!jobReportSkipped || !jobReportSkipped.ok) {
      throw new Error("expected successful memory.tree.job.report response after cooldown skip");
    }
    const skippedJobReport = jobReportSkipped.payload?.report as Record<string, any> | undefined;
    expect(skippedJobReport?.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobKey: "node_rebuild:profile",
        status: "cooldown",
        skipCount: 1,
        lastSkipReason: "cooldown_active",
      }),
    ]));

    store.upsertMemoryTreeNodes = originalUpsertMemoryTreeNodes;
  } finally {
    manager.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
});
