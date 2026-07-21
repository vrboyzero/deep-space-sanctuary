import { describe, expect, it, vi } from "vitest";

import { handleDreamMethod } from "./dreams.js";

describe("handleDreamMethod", () => {
  it("returns dream status payload", async () => {
    const runtime = {
      getAvailability: () => ({ enabled: true, available: true, model: "gpt-test" }),
      getState: vi.fn(async () => ({
        version: 1,
        agentId: "coder",
        status: "idle",
        updatedAt: "2026-04-19T12:00:00.000Z",
        settings: {
          inputWindowHours: 72,
          cooldownHours: 12,
          failureBackoffMinutes: 30,
          maxRecentRuns: 20,
        },
        recentRuns: [{
          id: "dream-state-1",
          agentId: "coder",
          status: "completed",
          triggerMode: "manual",
          requestedAt: "2026-04-19T11:55:00.000Z",
          finishedAt: "2026-04-19T12:00:00.000Z",
          summary: "latest dream state",
          consolidation: {
            headline: "Dream consolidation surfaced 1 profile patch, 0 stale, and 0 contradiction candidates.",
            summary: "Readonly consolidation candidates are available.",
            profilePatchCandidates: [{
              field: "profile.headline",
              valueSummary: "喜欢简洁状态表与短结论",
              source: "mind_profile",
              confidence: "medium",
              reason: "Mind snapshot keeps surfacing this as the strongest profile anchor.",
            }],
            staleCandidates: [],
            contradictionCandidates: [],
          },
        }],
      })),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-1",
      method: "dream.status.get",
      params: {
        agentId: "coder",
      },
    }, {
      resolveDreamRuntime: () => runtime as any,
      resolveDefaultConversationId: () => "agent:coder:main",
    });

    expect(res?.ok).toBe(true);
    expect(res && "payload" in res ? res.payload?.defaultConversationId : undefined).toBe("agent:coder:main");
    expect(res && "payload" in res ? (res.payload as any)?.state?.recentRuns?.[0]?.consolidation?.profilePatchCandidates?.[0]?.field : undefined).toBe("profile.headline");
    expect(runtime.getState).toHaveBeenCalledTimes(1);
  });

  it("runs dream with default conversation fallback", async () => {
    const claimSignal = new AbortController().signal;
    const complete = vi.fn(async <T>(commit: () => T | Promise<T>) => ({
      applied: true as const,
      value: await commit(),
    }));
    const jobScheduler = {
      acquire: vi.fn(async () => ({
        generation: 7,
        signal: claimSignal,
        complete,
        release: vi.fn(async () => undefined),
      })),
    };
    const runtime = {
      getAvailability: () => ({ enabled: true, available: true, model: "gpt-test" }),
      getBackgroundJobTokenEstimate: () => 6_144,
      run: vi.fn(async () => ({
        record: {
          id: "dream-1",
          agentId: "coder",
          status: "completed",
          triggerMode: "manual",
          requestedAt: "2026-04-19T12:00:00.000Z",
          consolidation: {
            headline: "Dream consolidation surfaced 1 profile patch, 1 stale, and 0 contradiction candidates.",
            summary: "Readonly consolidation candidates are available.",
            profilePatchCandidates: [{
              field: "profile.headline",
              valueSummary: "喜欢简洁状态表与短结论",
              source: "mind_profile",
              confidence: "medium",
              reason: "Mind snapshot keeps surfacing this as the strongest profile anchor.",
            }],
            staleCandidates: [{
              memoryClass: "episodic_task",
              reason: "Recent task evidence still needs follow-up.",
            }],
            contradictionCandidates: [],
          },
        },
        state: {
          version: 1,
          agentId: "coder",
          status: "idle",
          updatedAt: "2026-04-19T12:01:00.000Z",
          settings: {
            inputWindowHours: 72,
            cooldownHours: 12,
            failureBackoffMinutes: 30,
            maxRecentRuns: 20,
          },
          recentRuns: [],
        },
        draft: {
          stableInsights: [],
          corrections: [],
          openQuestions: [],
          shareCandidates: [],
          nextFocus: [],
        },
      })),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-2",
      method: "dream.run",
      params: {
        agentId: "coder",
        reason: "manual-smoke",
      },
    }, {
      resolveDreamRuntime: () => runtime as any,
      resolveDefaultConversationId: () => "agent:coder:main",
      jobScheduler: jobScheduler as any,
    });

    expect(res?.ok).toBe(true);
    expect(jobScheduler.acquire).toHaveBeenCalledWith({
      family: "dream",
      agentId: "coder",
      priority: "high",
      estimatedTokenUnits: 6_144,
    });
    expect(runtime.run).toHaveBeenCalledWith({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
      reason: "manual-smoke",
      signal: claimSignal,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    const payload = res && "payload" in res ? res.payload as any : undefined;
    expect(payload?.record?.consolidation).toMatchObject({
      headline: expect.any(String),
      profilePatchCandidates: [
        expect.objectContaining({
          field: "profile.headline",
        }),
      ],
    });
  });

  it("rejects manual dream before runtime side effects when scheduler admission fails", async () => {
    const runtime = {
      getAvailability: () => ({ enabled: true, available: true, model: "gpt-test" }),
      getBackgroundJobTokenEstimate: () => 4_096,
      run: vi.fn(),
    };
    const jobScheduler = {
      acquire: vi.fn(async () => ({
        reason: "Memory background model run budget exceeded.",
        reasonCode: "memory_background_run_budget_exceeded",
        retryAfterMs: 1_000,
      })),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-budget-rejected",
      method: "dream.run",
      params: {
        agentId: "coder",
      },
    }, {
      resolveDreamRuntime: () => runtime as any,
      resolveDefaultConversationId: () => "agent:coder:main",
      jobScheduler: jobScheduler as any,
    });

    expect(res).toMatchObject({
      ok: false,
      error: {
        code: "memory_background_run_budget_exceeded",
        message: "Memory background model run budget exceeded.",
      },
    });
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("runs commons export through dream.commons.export_now", async () => {
    const commonsRuntime = {
      getAvailability: () => ({ enabled: true, available: true, vaultPath: "E:/Obsidian" }),
      runNow: vi.fn(async () => ({
        exported: true,
        state: {
          version: 1,
          status: "completed",
          updatedAt: "2026-04-19T15:00:00.000Z",
          approvedCount: 2,
          revokedCount: 1,
          targetPath: "E:/Obsidian/Star Sanctuary/Commons",
          indexPath: "E:/Obsidian/Star Sanctuary/Commons/INDEX.md",
        },
      })),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-3",
      method: "dream.commons.export_now",
      params: {
        agentId: "coder",
      },
    }, {
      resolveDreamRuntime: () => null as any,
      resolveDefaultConversationId: () => "agent:coder:main",
      resolveCommonsExportRuntime: () => commonsRuntime as any,
    });

    const payload = res && "payload" in res ? res.payload as any : undefined;
    expect(res?.ok).toBe(true);
    expect(commonsRuntime.runNow).toHaveBeenCalledTimes(1);
    expect(payload?.state?.approvedCount).toBe(2);
  });

  it("reviews dream consolidation through dream.consolidation.review", async () => {
    const runtime = {
      getAvailability: () => ({ enabled: true, available: true, model: "gpt-test" }),
      reviewConsolidation: vi.fn(async () => ({
        record: {
          id: "dream-1",
          agentId: "coder",
          status: "completed",
          triggerMode: "manual",
          requestedAt: "2026-04-19T12:00:00.000Z",
          consolidation: {
            headline: "Dream consolidation surfaced 1 profile patch, 0 stale, and 0 contradiction candidates.",
            summary: "Readonly consolidation candidates are available.",
            profilePatchCandidates: [{
              field: "profile_state.preferences.response_style",
              valueSummary: "先给结论，再展开证据",
              source: "mind_profile",
              confidence: "medium",
              reason: "Canonical profile state already exposes this low-risk field in the current dream input snapshot.",
              profilePath: "preferences.response_style",
              profileValue: "先给结论，再展开证据",
            }],
            staleCandidates: [],
            contradictionCandidates: [],
            review: {
              status: "approved",
              reviewedBy: "tester",
              approvedCandidatePaths: ["preferences.response_style"],
            },
            apply: {
              status: "not_applied",
              appliedPatchCount: 0,
              appliedPatches: [],
            },
          },
        },
        state: {
          version: 1,
          agentId: "coder",
          status: "idle",
          updatedAt: "2026-04-19T12:01:00.000Z",
          settings: {
            inputWindowHours: 72,
            cooldownHours: 12,
            failureBackoffMinutes: 30,
            maxRecentRuns: 20,
          },
          recentRuns: [],
        },
      })),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-5",
      method: "dream.consolidation.review",
      params: {
        agentId: "coder",
        dreamId: "dream-1",
        decision: "approved",
        note: "looks safe",
        approvedCandidatePaths: ["preferences.response_style"],
      },
    }, {
      resolveDreamRuntime: () => runtime as any,
      resolveDefaultConversationId: () => "agent:coder:main",
    });

    expect(res?.ok).toBe(true);
    expect(runtime.reviewConsolidation).toHaveBeenCalledWith("dream-1", "approved", expect.objectContaining({
      note: "looks safe",
      approvedCandidatePaths: ["preferences.response_style"],
    }));
  });

  it("requires confirmation for dream.consolidation.apply", async () => {
    const runtime = {
      getAvailability: () => ({ enabled: true, available: true, model: "gpt-test" }),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-6",
      method: "dream.consolidation.apply",
      params: {
        agentId: "coder",
        dreamId: "dream-1",
      },
    }, {
      resolveDreamRuntime: () => runtime as any,
      resolveDefaultConversationId: () => "agent:coder:main",
    });

    expect(res?.ok).toBe(false);
    expect(res && "error" in res ? res.error?.code : undefined).toBe("confirmation_required");
  });

  it("returns commons export status through dream.commons.status.get", async () => {
    const commonsRuntime = {
      getAvailability: () => ({ enabled: true, available: true, vaultPath: "E:/Obsidian", sharedStateDir: "E:/state/team-memory" }),
      getState: vi.fn(async () => ({
        version: 1,
        status: "completed",
        updatedAt: "2026-04-19T15:00:00.000Z",
        lastAttemptAt: "2026-04-19T14:59:00.000Z",
        lastSuccessAt: "2026-04-19T15:00:00.000Z",
        approvedCount: 2,
        revokedCount: 1,
        noteCount: 3,
        agentPageCount: 2,
        targetPath: "E:/Obsidian/Star Sanctuary/Commons",
        indexPath: "E:/Obsidian/Star Sanctuary/Commons/INDEX.md",
      })),
    };

    const res = await handleDreamMethod({
      type: "req",
      id: "req-4",
      method: "dream.commons.status.get",
      params: {},
    }, {
      resolveDreamRuntime: () => null as any,
      resolveDefaultConversationId: () => "agent:coder:main",
      resolveCommonsExportRuntime: () => commonsRuntime as any,
    });

    const payload = res && "payload" in res ? res.payload as any : undefined;
    expect(res?.ok).toBe(true);
    expect(commonsRuntime.getState).toHaveBeenCalledTimes(1);
    expect(payload?.availability?.vaultPath).toBe("E:/Obsidian");
    expect(payload?.state?.noteCount).toBe(3);
    expect(payload?.headline).toContain("last completed");
  });
});
