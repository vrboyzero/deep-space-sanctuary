// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryRuntimeFeature } from "./memory-runtime.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(sendReq) {
  const state = {
    tab: "tasks",
    items: [],
    stats: null,
    selectedTask: { id: "task-1" },
    selectedCandidate: null,
    pendingExperienceActionKey: null,
    activeAgentId: "default",
  };

  const showNotice = vi.fn();

  const feature = createMemoryRuntimeFeature({
    refs: {
      memoryViewerSection: null,
      memoryTaskGoalFilterBarEl: null,
      memoryTaskGoalFilterLabelEl: null,
    },
    isConnected: () => true,
    sendReq,
    makeId: (() => {
      let seq = 0;
      return () => `req-${++seq}`;
    })(),
    getMemoryViewerState: () => state,
    getMemoryViewerFeature: () => ({
      loadMemoryViewer: vi.fn(),
      loadMemoryViewerStats: vi.fn(),
      loadTaskUsageOverview: vi.fn(),
      loadTaskViewer: vi.fn(),
      loadMemoryChunkViewer: vi.fn(),
      switchMemoryViewerTab: vi.fn(),
      syncMemoryViewerUi: vi.fn(),
    }),
    getCurrentAgentSelection: () => "default",
    getGoalDisplayName: () => "",
    switchMode: vi.fn(),
    loadGoals: vi.fn(async () => {}),
    showNotice,
    renderMemoryViewerStats: vi.fn(),
    renderTaskList: vi.fn(),
    renderMemoryList: vi.fn(),
    renderSharedReviewList: vi.fn(),
    renderTaskDetail: vi.fn(),
    renderCandidateOnlyDetail: vi.fn(),
    renderMemoryDetail: vi.fn(),
    renderMemoryViewerListEmpty: vi.fn(),
    renderMemoryViewerDetailEmpty: vi.fn(),
    getCurrentAgentLabel: () => "default",
    t: (_key, params, fallback) => {
      let text = fallback ?? "";
      if (params && typeof params === "object") {
        Object.entries(params).forEach(([key, value]) => {
          text = text.replaceAll(`{${key}}`, String(value ?? ""));
        });
      }
      return text;
    },
  });

  return {
    state,
    feature,
    showNotice,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.BELLDANDY_WEB_CONFIG;
});

describe("memory runtime read lifecycle", () => {
  it("settles a stale task read through the main lifecycle wiring", async () => {
    const request = createDeferred();
    const { feature, state } = createHarness(vi.fn(() => request.promise));
    const read = feature.loadTaskDetail("task-2");
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeTaskReadCount).toBe(1);

    feature.dispose();
    request.resolve({ ok: true, payload: { task: { id: "task-2" } } });
    await read;

    expect(state.selectedTask).toEqual({ id: "task-1" });
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeReadCount).toBe(0);
  });

  it.each([
    [
      "memory",
      (feature) => feature.loadMemoryDetail("chunk-2"),
      "pendingMemoryRuntimeMemoryReadCount",
      { ok: true, payload: { item: { id: "chunk-2" } } },
    ],
    [
      "candidate",
      (feature) => feature.loadCandidateDetail("candidate-2"),
      "pendingMemoryRuntimeCandidateReadCount",
      { ok: true, payload: { candidate: { id: "candidate-2" } } },
    ],
  ])("settles a stale %s read through the main lifecycle wiring", async (_kind, start, pendingKey, response) => {
    const request = createDeferred();
    const { feature, state } = createHarness(vi.fn(() => request.promise));
    const read = start(feature);
    expect(feature.getRuntimeSnapshot()[pendingKey]).toBe(1);

    feature.dispose();
    request.resolve(response);
    await read;

    expect(state.selectedCandidate).toBeNull();
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeReadCount).toBe(0);
  });
});

describe("memory runtime duplicate precheck", () => {
  it("settles a disposed generation preflight through the main action owner", async () => {
    const request = createDeferred();
    const { feature, showNotice, state } = createHarness(vi.fn(() => request.promise));

    const generate = feature.generateExperienceCandidate("task-1", "method");
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(1);
    expect(state.pendingExperienceActionKey).toBe("generate:method:task-1");

    feature.dispose();
    expect(state.pendingExperienceActionKey).toBeNull();
    request.resolve({ ok: true, payload: { decision: "no_match" } });
    await expect(generate).resolves.toBeNull();

    expect(showNotice).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeExperienceGenerateActionCount).toBe(0);
  });

  it("opens existing candidate when duplicate_existing is confirmed", async () => {
    const sendReq = vi.fn(async (req) => {
      if (req.method === "experience.candidate.check_duplicate") {
        return {
          ok: true,
          payload: {
            type: "method",
            taskId: "task-1",
            title: "实现候选层",
            slug: "method-demo",
            decision: "duplicate_existing",
            exactMatch: {
              source: "candidate",
              assetType: "method",
              key: "method-demo",
              title: "实现候选层",
              candidateId: "exp-dup-1",
              candidateStatus: "draft",
            },
            similarMatches: [],
          },
        };
      }
      if (req.method === "experience.candidate.get") {
        return {
          ok: true,
          payload: {
            candidate: {
              id: "exp-dup-1",
              title: "实现候选层",
            },
            memoryFreshness: {
              summary: {
                available: true,
                headline: "Procedural experience needs review before publish.",
                reviewRequiredCount: 1,
                staleCount: 0,
                supersededCount: 0,
              },
            },
          },
        };
      }
      throw new Error(`unexpected method ${req.method}`);
    });
    const { feature, state } = createHarness(sendReq);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const result = await feature.generateExperienceCandidate("task-1", "method");

    expect(result).toMatchObject({
      id: "exp-dup-1",
      title: "实现候选层",
    });
    expect(state.selectedCandidate).toMatchObject({
      id: "exp-dup-1",
      memoryFreshness: {
        summary: {
          available: true,
          headline: "Procedural experience needs review before publish.",
        },
      },
    });
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(sendReq.mock.calls.map(([req]) => req.method)).toEqual([
      "experience.candidate.check_duplicate",
      "experience.candidate.get",
    ]);
  });

  it("continues generation when similar_existing is confirmed", async () => {
    const sendReq = vi.fn(async (req) => {
      if (req.method === "experience.candidate.check_duplicate") {
        return {
          ok: true,
          payload: {
            type: "skill",
            taskId: "task-1",
            title: "修复任务",
            slug: "skill-demo",
            decision: "similar_existing",
            similarMatches: [
              {
                source: "skill_asset",
                assetType: "skill",
                key: "skill-demo",
                title: "修复任务技能",
              },
            ],
          },
        };
      }
      if (req.method === "experience.candidate.generate") {
        return {
          ok: true,
          payload: {
            candidate: {
              id: "exp-new-1",
              title: "修复任务",
            },
            created: true,
            reusedExisting: false,
          },
        };
      }
      if (req.method === "memory.task.get") {
        return { ok: true, payload: { task: { id: "task-1" } } };
      }
      if (req.method === "experience.candidate.get") {
        return { ok: true, payload: { candidate: { id: "exp-new-1", title: "修复任务" } } };
      }
      throw new Error(`unexpected method ${req.method}`);
    });
    const { feature } = createHarness(sendReq);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const result = await feature.generateExperienceCandidate("task-1", "skill");

    expect(result).toEqual({
      id: "exp-new-1",
      title: "修复任务",
    });
    expect(sendReq.mock.calls.map(([req]) => req.method)).toEqual([
      "experience.candidate.check_duplicate",
      "experience.candidate.generate",
      "memory.task.get",
      "experience.candidate.get",
    ]);
  });

  it("shows method draft generate notice by default", async () => {
    const sendReq = vi.fn(async (req) => {
      if (req.method === "experience.candidate.check_duplicate") {
        return {
          ok: true,
          payload: {
            decision: "no_match",
            similarMatches: [],
          },
        };
      }
      if (req.method === "experience.candidate.generate") {
        return {
          ok: true,
          payload: {
            candidate: {
              id: "exp-method-1",
              title: "Method Draft Demo",
            },
            reusedExisting: false,
          },
        };
      }
      if (req.method === "memory.task.get") {
        return { ok: true, payload: { task: { id: "task-1" } } };
      }
      if (req.method === "experience.candidate.get") {
        return { ok: true, payload: { candidate: { id: "exp-method-1", title: "Method Draft Demo" } } };
      }
      throw new Error(`unexpected method ${req.method}`);
    });
    const { feature, showNotice } = createHarness(sendReq);

    await feature.generateExperienceCandidate("task-1", "method");

    expect(showNotice).toHaveBeenCalledWith(
      "Method Draft 已生成",
      "Method Draft Demo",
      "success",
      2200,
    );
  });

  it("skips draft generate notice when disabled by web config", async () => {
    globalThis.BELLDANDY_WEB_CONFIG = {
      experienceDraftGenerateNoticeEnabled: false,
    };
    const sendReq = vi.fn(async (req) => {
      if (req.method === "experience.candidate.check_duplicate") {
        return {
          ok: true,
          payload: {
            decision: "no_match",
            similarMatches: [],
          },
        };
      }
      if (req.method === "experience.candidate.generate") {
        return {
          ok: true,
          payload: {
            candidate: {
              id: "exp-skill-1",
              title: "Skill Draft Demo",
            },
            reusedExisting: false,
          },
        };
      }
      if (req.method === "memory.task.get") {
        return { ok: true, payload: { task: { id: "task-1" } } };
      }
      if (req.method === "experience.candidate.get") {
        return { ok: true, payload: { candidate: { id: "exp-skill-1", title: "Skill Draft Demo" } } };
      }
      throw new Error(`unexpected method ${req.method}`);
    });
    const { feature, showNotice } = createHarness(sendReq);

    await feature.generateExperienceCandidate("task-1", "skill");

    expect(showNotice).not.toHaveBeenCalledWith(
      "Skill Draft 已生成",
      "Skill Draft Demo",
      "success",
      2200,
    );
  });
});

describe("memory runtime review lifecycle", () => {
  it("settles a disposed review through the main action owner", async () => {
    const request = createDeferred();
    const { feature, showNotice, state } = createHarness(vi.fn(() => request.promise));

    const review = feature.reviewExperienceCandidate("candidate-1", "accept", { taskId: "task-1" });
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeExperienceReviewActionCount).toBe(1);
    expect(state.pendingExperienceActionKey).toBe("candidate:candidate-1:accept");

    feature.dispose();
    expect(state.pendingExperienceActionKey).toBeNull();
    request.resolve({ ok: true, payload: { candidate: { id: "candidate-1" } } });
    await expect(review).resolves.toBeNull();

    expect(showNotice).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeExperienceReviewActionCount).toBe(0);
  });
});

describe("memory runtime skill freshness lifecycle", () => {
  it("settles a disposed freshness update through the main action owner", async () => {
    const request = createDeferred();
    const { feature, showNotice, state } = createHarness(vi.fn(() => request.promise));

    const update = feature.updateSkillFreshnessStaleMark({
      skillKey: "skill-demo",
      taskId: "task-1",
      candidateId: "candidate-1",
    });
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeSkillFreshnessActionCount).toBe(1);
    expect(state.pendingExperienceActionKey).toBe("skill-freshness:skill-demo:stale");

    feature.dispose();
    expect(state.pendingExperienceActionKey).toBeNull();
    request.resolve({ ok: true, payload: { skillFreshness: { stale: true } } });
    await expect(update).resolves.toBeNull();

    expect(showNotice).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot().pendingMemoryRuntimeSkillFreshnessActionCount).toBe(0);
  });
});
