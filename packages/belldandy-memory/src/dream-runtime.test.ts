import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DreamRuntime } from "./dream-runtime.js";
import * as dreamWriterModule from "./dream-writer.js";
import type { DreamInputSnapshot } from "./dream-types.js";
import type { UpsertProfileStateEntryInput } from "./profile-state-types.js";

describe("dream runtime", () => {
  const tempDirs: string[] = [];

  function createSnapshot(partial: Partial<DreamInputSnapshot> = {}): DreamInputSnapshot {
    return {
      agentId: "coder",
      collectedAt: "2026-04-19T12:00:00.000Z",
      windowStartedAt: "2026-04-16T12:00:00.000Z",
      windowHours: 72,
      conversationId: "agent:coder:main",
      changeCursor: {
        digestGeneration: 2,
        sessionMemoryMessageCount: 6,
        sessionMemoryToolCursor: 2,
        taskChangeSeq: 3,
        memoryChangeSeq: 2,
      },
      sourceCounts: {
        recentTaskCount: 3,
        recentWorkCount: 3,
        recentWorkRecapCount: 2,
        recentResumeContextCount: 1,
        recentDurableMemoryCount: 2,
        recentPrivateMemoryCount: 2,
        recentSharedMemoryCount: 0,
        recentExperienceUsageCount: 1,
        sessionDigestAvailable: true,
        sessionMemoryAvailable: true,
        mindProfileAvailable: true,
        learningReviewAvailable: true,
      },
      sessionDigest: {
        rollingSummary: "最近正在接 dream runtime。",
        lastDigestAt: Date.parse("2026-04-19T11:35:00.000Z"),
      },
      sessionMemory: {
        summary: "当前主要在打通 Step 3。",
        nextStep: "补手动 RPC。",
        updatedAt: Date.parse("2026-04-19T11:40:00.000Z"),
      },
      mindProfileSnapshot: {
        profile: {
          headline: "喜欢简洁状态表与短结论",
          summaryLines: ["USER.md: 喜欢简洁状态表与短结论。"],
          stateEntries: [{
            path: "preferences.response_style",
            valueText: "先给结论，再展开证据",
            confidence: 0.9,
            updatedAt: "2026-04-18T12:00:00.000Z",
            lastConfirmedAt: "2026-04-18T12:00:00.000Z",
          }],
          treeSummaryLines: ["偏好短结论与结构化状态输出。"],
        },
        summary: {
          available: true,
          headline: "user ready, private 1, shared 0, digest 1/1, usage 0",
          hasUserProfile: true,
        },
      },
      learningReviewInput: {
        summary: {
          available: true,
          headline: "memory=2, task=2, review=0, nudges=1",
        },
        summaryLines: [
          "Mind snapshot: USER.md: 喜欢简洁状态表与短结论。",
          "Profile anchor: 偏好短结论与结构化状态输出。",
        ],
        nudges: [
          "当前输入已具备最小 learning/review 条件，可继续进入 candidate / governance 审阅。",
        ],
        memoryFreshness: {
          summary: {
            available: true,
            headline: "episodic task still needs review",
            reviewRequiredCount: 1,
            staleCount: 0,
          },
          items: [
            {
              memoryClass: "episodic_task",
              status: "review_required",
              freshnessHeadline: "Recent task evidence still needs follow-up.",
            },
          ],
        },
      },
      focusTask: {
        id: "task-1",
        conversationId: "agent:coder:main",
        sessionKey: "agent:coder:main",
        source: "chat",
        status: "success",
        startedAt: "2026-04-19T11:00:00.000Z",
        updatedAt: "2026-04-19T11:30:00.000Z",
        createdAt: "2026-04-19T11:00:00.000Z",
        title: "实现 dream runtime",
        summary: "已完成 runtime 主链路。",
        activities: [],
        memoryLinks: [],
        usedMethods: [],
        usedSkills: [],
      },
      recentTasks: [
        {
          id: "task-1",
          conversationId: "agent:coder:main",
          sessionKey: "agent:coder:main",
          source: "chat",
          status: "success",
          startedAt: "2026-04-19T11:00:00.000Z",
          updatedAt: "2026-04-19T11:30:00.000Z",
          createdAt: "2026-04-19T11:00:00.000Z",
          title: "实现 dream runtime",
          activities: [],
          memoryLinks: [],
          usedMethods: [],
          usedSkills: [],
        },
        {
          id: "task-2",
          conversationId: "agent:coder:main",
          sessionKey: "agent:coder:main",
          source: "chat",
          status: "success",
          startedAt: "2026-04-19T10:00:00.000Z",
          updatedAt: "2026-04-19T10:30:00.000Z",
          createdAt: "2026-04-19T10:00:00.000Z",
          title: "整理输入层",
          activities: [],
          memoryLinks: [],
          usedMethods: [],
          usedSkills: [],
        },
        {
          id: "task-3",
          conversationId: "agent:coder:main",
          sessionKey: "agent:coder:main",
          source: "chat",
          status: "success",
          startedAt: "2026-04-19T09:00:00.000Z",
          updatedAt: "2026-04-19T09:30:00.000Z",
          createdAt: "2026-04-19T09:00:00.000Z",
          title: "整理状态层",
          activities: [],
          memoryLinks: [],
          usedMethods: [],
          usedSkills: [],
        },
      ],
      recentWorkItems: [
        {
          taskId: "task-1",
          conversationId: "agent:coder:main",
          title: "实现 dream runtime",
          objective: "打通 automatic dream",
          summary: "已接 runtime 主链路。",
          status: "success",
          source: "chat",
          startedAt: "2026-04-19T11:00:00.000Z",
          finishedAt: "2026-04-19T11:30:00.000Z",
          updatedAt: "2026-04-19T11:40:00.000Z",
          agentId: "coder",
          toolNames: ["apply_patch"],
          artifactPaths: ["packages/belldandy-memory/src/dream-runtime.ts"],
          recentActivityTitles: ["接通 automatic dream runtime"],
          workRecap: {
            taskId: "task-1",
            conversationId: "agent:coder:main",
            sessionKey: "agent:coder:main",
            agentId: "coder",
            headline: "automatic dream 主链路已接通。",
            confirmedFacts: ["已具备自动 gate。"],
            derivedFromActivityIds: ["act-1"],
            updatedAt: "2026-04-19T11:35:00.000Z",
          },
          resumeContext: {
            taskId: "task-1",
            conversationId: "agent:coder:main",
            sessionKey: "agent:coder:main",
            agentId: "coder",
            currentStopPoint: "已经接到 runtime。",
            nextStep: "补观察层。",
            derivedFromActivityIds: ["act-1"],
            updatedAt: "2026-04-19T11:40:00.000Z",
          },
        },
      ],
      recentDurableMemories: [
        {
          id: "mem-1",
          sourcePath: "memory/2026-04-19.md",
          sourceType: "file",
          memoryType: "daily",
          visibility: "private",
          snippet: "automatic dream 已接通 runtime。",
          updatedAt: "2026-04-19T11:20:00.000Z",
        },
      ],
      recentExperienceUsages: [],
      ...partial,
    };
  }

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
    tempDirs.length = 0;
  });

  it("runs manual dream and writes dream artifacts", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-"));
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-obsidian-"));
    tempDirs.push(stateDir);
    tempDirs.push(vaultDir);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "Dream runtime ready",
                summary: "手动 dream.run 已可写回私有 dream 文件。",
                narrative: "runtime 先聚合输入，再调用模型，再写 dream 文件与索引。",
                stableInsights: ["manual run 应先稳定，再继续推进自动触发。"],
                corrections: ["当前不要让 dream 写 MEMORY.md。"],
                openQuestions: ["Step 4 的最小 UI 入口放在哪里更合理。"],
                shareCandidates: [{
                  title: "dream-run pipeline",
                  reason: "后续可复用到 observability",
                  suggestedVisibility: "shared_candidate",
                }],
                nextFocus: ["补 dream.status.get 与 history.list。"],
              }),
            },
          }],
        };
      },
    })));

    const snapshot = createSnapshot({
      sourceCounts: {
        recentTaskCount: 1,
        recentWorkCount: 1,
        recentWorkRecapCount: 1,
        recentResumeContextCount: 1,
        recentDurableMemoryCount: 1,
        recentPrivateMemoryCount: 1,
        recentSharedMemoryCount: 0,
        recentExperienceUsageCount: 1,
        sessionDigestAvailable: true,
        sessionMemoryAvailable: true,
        mindProfileAvailable: true,
        learningReviewAvailable: true,
      },
      recentTasks: [],
    });

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      obsidianMirror: {
        enabled: true,
        vaultPath: vaultDir,
      },
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => snapshot,
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
      reason: "step-3-smoke",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("llm");
    expect(result.record.fallbackReason).toBeUndefined();
    expect(result.record.consolidation).toMatchObject({
      headline: expect.stringContaining("Dream consolidation surfaced"),
      profilePatchCandidates: expect.arrayContaining([
        expect.objectContaining({
          field: "profile_state.preferences.response_style",
          source: "mind_profile",
          profilePath: "preferences.response_style",
        }),
      ]),
    });
    expect(result.record.dreamPath).toBeTruthy();
    expect(result.record.indexPath).toBeTruthy();
    expect(result.record.obsidianSync?.stage).toBe("synced");
    expect(result.markdown).toContain("## Next Focus");
    expect(result.markdown).toContain("- Generation Mode: llm");
    expect(result.state.status).toBe("idle");
    expect(result.state.lastObsidianSync?.stage).toBe("synced");
    expect(result.state.recentRuns[0]?.consolidation?.profilePatchCandidates?.length).toBeGreaterThan(0);

    const dreamContent = await fs.readFile(result.record.dreamPath!, "utf-8");
    const indexContent = await fs.readFile(result.record.indexPath!, "utf-8");
    const obsidianDreamPath = result.record.obsidianSync?.targetPath;
    const obsidianIndexPath = path.join(vaultDir, "Star Sanctuary", "Agents", "coder", "DREAM.md");
    expect(obsidianDreamPath).toBeTruthy();
    const obsidianDreamContent = await fs.readFile(obsidianDreamPath!, "utf-8");
    const obsidianIndexContent = await fs.readFile(obsidianIndexPath, "utf-8");
    expect(dreamContent).toContain("manual run 应先稳定");
    expect(indexContent).toContain("dream-20260419120000");
    expect(obsidianDreamContent).toContain("manual run 应先稳定");
    expect(obsidianIndexContent).toContain("dream-20260419120000");
  });

  it("writes a fallback dream when model config is missing", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-"));
    tempDirs.push(stateDir);

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("fallback");
    expect(result.record.fallbackReason).toBe("missing_model_config");
    expect(result.record.error).toBeUndefined();
    expect(result.markdown).toContain("Dream Fallback - coder - 2026-04-19");
    expect(result.markdown).toContain("## 本次主题候选");
    expect(result.markdown).toContain("- Generation Mode: fallback");
    expect(result.markdown).toContain("- Fallback Reason: missing_model_config");
    expect(result.state.recentRuns[0]?.generationMode).toBe("fallback");
  });

  it("reviews and applies approved low-risk dream consolidation patches into canonical profile state", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-"));
    tempDirs.push(stateDir);
    const appliedEntries: UpsertProfileStateEntryInput[] = [];

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot({
        mindProfileSnapshot: {
          profile: {
            headline: "喜欢简洁状态表与短结论",
            summaryLines: ["USER.md: 喜欢简洁状态表与短结论。"],
            stateEntries: [{
              path: "preferences.response_style",
              valueText: "先给结论，再展开证据",
              confidence: 0.9,
              updatedAt: "2026-04-18T12:00:00.000Z",
              lastConfirmedAt: "2026-04-18T12:00:00.000Z",
            }],
            treeSummaryLines: ["偏好短结论与结构化状态输出。"],
          },
          summary: {
            available: true,
            headline: "user ready, private 1, shared 0, digest 1/1, usage 0",
            hasUserProfile: true,
          },
        },
      }),
      profileStateDelegate: {
        upsertProfileStateEntry: (input) => {
          appliedEntries.push(input);
          return {
            id: `profile:${input.path}`,
            agentId: input.agentId,
            scope: input.scope ?? "user",
            path: input.path,
            value: input.value,
            valueType: "string",
            confidence: input.confidence,
            status: "active",
            sourceRefs: input.sourceRefs,
            lastConfirmedAt: input.lastConfirmedAt,
            createdAt: "2026-04-19T12:00:00.000Z",
            updatedAt: "2026-04-19T12:00:00.000Z",
          };
        },
      },
    });

    const run = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
    });
    const reviewed = await runtime.reviewConsolidation(run.record.id, "approved", {
      reviewedBy: "tester",
      note: "approve low-risk canonical patch",
    });
    expect(reviewed.record.consolidation?.review).toMatchObject({
      status: "approved",
      reviewedBy: "tester",
      approvedCandidatePaths: ["preferences.response_style"],
    });

    const applied = await runtime.applyConsolidation(run.record.id, {
      appliedBy: "tester",
      note: "apply approved dream patch",
    });
    expect(applied.appliedPatchCount).toBe(1);
    expect(appliedEntries).toHaveLength(1);
    expect(appliedEntries[0]).toMatchObject({
      path: "preferences.response_style",
      value: "先给结论，再展开证据",
      createdBy: "tester",
    });
    expect(applied.record.consolidation?.apply).toMatchObject({
      status: "applied",
      appliedBy: "tester",
      appliedPatchCount: 1,
      appliedPatches: [
        expect.objectContaining({
          profilePath: "preferences.response_style",
        }),
      ],
    });
  });

  it("mirrors fallback dream to Obsidian when model config is missing", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-fallback-obsidian-"));
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-fallback-vault-"));
    tempDirs.push(stateDir, vaultDir);

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      obsidianMirror: {
        enabled: true,
        vaultPath: vaultDir,
      },
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
      reason: "fallback-obsidian-smoke",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("fallback");
    expect(result.record.fallbackReason).toBe("missing_model_config");
    expect(result.record.obsidianSync?.stage).toBe("synced");

    const obsidianDreamPath = result.record.obsidianSync?.targetPath;
    const obsidianIndexPath = path.join(vaultDir, "Star Sanctuary", "Agents", "coder", "DREAM.md");
    expect(obsidianDreamPath).toBeTruthy();

    const obsidianDreamContent = await fs.readFile(obsidianDreamPath!, "utf-8");
    const obsidianIndexContent = await fs.readFile(obsidianIndexPath, "utf-8");

    expect(obsidianDreamContent).toContain("Dream Fallback - coder - 2026-04-19");
    expect(obsidianDreamContent).toContain("## 本次主题候选");
    expect(obsidianDreamContent).toContain("- Generation Mode: fallback");
    expect(obsidianDreamContent).toContain("- Fallback Reason: missing_model_config");
    expect(obsidianIndexContent).toContain("dream-20260419120000");
  });

  it("falls back when llm call fails instead of recording a failed run", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-fallback-"));
    tempDirs.push(stateDir);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      async text() {
        return "upstream unavailable";
      },
    })));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("fallback");
    expect(result.record.fallbackReason).toBe("llm_call_failed");
    expect(result.markdown).toContain("- Fallback Reason: llm_call_failed");
    expect(result.markdown).toContain("## 已确认事实");
  });

  it("passes thinking and reasoning_effort to dream chat completions payload", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-reasoning-"));
    tempDirs.push(stateDir);

    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  headline: "Reasoning dream ready",
                  stableInsights: ["reasoning config reached dream runtime"],
                  corrections: [],
                  openQuestions: [],
                  shareCandidates: [],
                  nextFocus: ["keep payload aligned"],
                }),
              },
            }],
          };
        },
      };
    }));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "deepseek-v4-pro",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      thinking: { type: "enabled" },
      reasoningEffort: "high",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
    });

    expect(result.record.status).toBe("completed");
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
  });

  it("retries dream generation with larger token budget when reasoning exhausts the first attempt", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-retry-budget-"));
    tempDirs.push(stateDir);

    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requestBodies.push(body);
      const maxTokens = Number(body.max_tokens ?? 0);
      if (maxTokens <= 1000) {
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                finish_reason: "length",
                message: {
                  content: null,
                  reasoning_content: "reasoning filled the first budget",
                },
              }],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  headline: "Dream retry succeeded",
                  stableInsights: ["second attempt had enough room for final json"],
                  corrections: [],
                  openQuestions: [],
                  shareCandidates: [],
                  nextFocus: ["keep automatic retry"],
                }),
              },
            }],
          };
        },
      };
    }));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "deepseek-v4-pro",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      thinking: { type: "enabled" },
      reasoningEffort: "max",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("llm");
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]?.max_tokens).toBe(1000);
    expect(requestBodies[1]?.max_tokens).toBe(4000);
  });

  it("logs finish_reason diagnostics when dream response has reasoning but no final content", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-empty-content-"));
    tempDirs.push(stateDir);

    const warn = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: "length",
            message: {
              content: null,
              reasoning_content: "long hidden chain of thought",
            },
          }],
        };
      },
    })));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "deepseek-v4-pro",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      thinking: { type: "enabled" },
      reasoningEffort: "max",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
      logger: { warn },
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("fallback");
    expect(result.record.fallbackReason).toBe("llm_call_failed");
    expect(warn).toHaveBeenNthCalledWith(1, "dream llm returned empty assistant content", expect.objectContaining({
      finishReason: "length",
      hasReasoningContent: true,
      reasoningContentLength: 28,
      maxTokens: 1000,
      thinkingType: "enabled",
      reasoningEffort: "max",
    }));
    expect(warn).toHaveBeenNthCalledWith(2, "dream llm exhausted token budget on reasoning, retrying with larger budget", expect.objectContaining({
      previousMaxTokens: 1000,
      retryMaxTokens: 4000,
      finishReason: "length",
      reasoningEffort: "max",
    }));
    expect(warn).toHaveBeenNthCalledWith(3, "dream llm returned empty assistant content", expect.objectContaining({
      finishReason: "length",
      hasReasoningContent: true,
      reasoningContentLength: 28,
      maxTokens: 4000,
      thinkingType: "enabled",
      reasoningEffort: "max",
    }));
    expect(warn).toHaveBeenNthCalledWith(4, "dream llm generation failed, using fallback", expect.objectContaining({
      error: expect.stringMatching(/finish_reason=length.*max_tokens=4000/),
    }));
  });

  it("falls back and clears running status when the larger-budget retry times out", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-timeout-"));
    tempDirs.push(stateDir);

    const warn = vi.fn();
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                finish_reason: "length",
                message: {
                  content: null,
                  reasoning_content: "reasoning filled the first budget",
                },
              }],
            };
          },
        };
      }
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
    }));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "deepseek-v4-pro",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      thinking: { type: "enabled" },
      reasoningEffort: "max",
      timeoutMs: 1000,
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
      logger: { warn },
    });

    const result = await runtime.run({
      conversationId: "agent:coder:main",
      triggerMode: "manual",
    });

    expect(result.record.status).toBe("completed");
    expect(result.record.generationMode).toBe("fallback");
    expect(result.record.fallbackReason).toBe("llm_call_failed");
    expect(result.state.status).toBe("idle");
    expect(warn).toHaveBeenCalledWith("dream llm generation failed, using fallback", expect.objectContaining({
      error: expect.stringContaining("timed out after 1000ms"),
    }));
  });

  it("runs automatic dream when heartbeat signal gate passes and then enters cooldown", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-auto-"));
    tempDirs.push(stateDir);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "Auto dream runtime ready",
                stableInsights: ["heartbeat signal gate works"],
                corrections: [],
                openQuestions: [],
                shareCandidates: [],
                nextFocus: ["keep cooldown active"],
              }),
            },
          }],
        };
      },
    })));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const first = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "heartbeat",
      reason: "heartbeat auto trigger",
    });
    const second = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "heartbeat",
      reason: "heartbeat auto trigger",
    });

    expect(first.executed).toBe(true);
    expect(first.record?.status).toBe("completed");
    expect(first.state.cooldownUntil).toBeTruthy();
    expect(first.state.lastAutoTrigger).toMatchObject({
      triggerMode: "heartbeat",
      executed: true,
      runId: first.record?.id,
      status: "completed",
      signal: {
        baselineAt: "2026-04-16T12:00:00.000Z",
        lastDreamCursor: {
          digestGeneration: 0,
          sessionMemoryMessageCount: 0,
          sessionMemoryToolCursor: 0,
          taskChangeSeq: 0,
          memoryChangeSeq: 0,
        },
        currentCursor: {
          digestGeneration: 2,
          sessionMemoryMessageCount: 6,
          sessionMemoryToolCursor: 2,
          taskChangeSeq: 3,
          memoryChangeSeq: 2,
        },
        recentWorkCount: 3,
        recentWorkRecapCount: 2,
        completedTaskCount: 3,
        recentDurableMemoryCount: 2,
        sessionDigestAvailable: true,
        sessionMemoryAvailable: true,
        digestGenerationDelta: 2,
        sessionMemoryMessageDelta: 6,
        sessionMemoryToolDelta: 2,
        sessionMemoryRevisionDelta: 2,
        taskChangeSeqDelta: 3,
        memoryChangeSeqDelta: 2,
        changeBudget: 19,
        latestWorkAt: "2026-04-19T11:40:00.000Z",
        latestWorkRecapAt: "2026-04-19T11:35:00.000Z",
        latestResumeContextAt: "2026-04-19T11:40:00.000Z",
        latestCompletedTaskAt: "2026-04-19T11:30:00.000Z",
        latestDurableMemoryAt: "2026-04-19T11:20:00.000Z",
        sessionDigestAt: "2026-04-19T11:35:00.000Z",
        sessionMemoryAt: "2026-04-19T11:40:00.000Z",
        freshWorkSinceBaseline: true,
        freshWorkRecapSinceBaseline: true,
        freshResumeContextSinceBaseline: true,
        freshCompletedTaskSinceBaseline: true,
        freshDurableMemorySinceBaseline: true,
        freshSessionDigestSinceBaseline: true,
        freshSessionMemorySinceBaseline: true,
      },
    });
    expect(first.state.lastDreamCursor).toMatchObject({
      digestGeneration: 2,
      sessionMemoryMessageCount: 6,
      sessionMemoryToolCursor: 2,
      taskChangeSeq: 3,
      memoryChangeSeq: 2,
    });
    expect(first.state.autoStats).toMatchObject({
      attemptedCount: 1,
      executedCount: 1,
      skippedCount: 0,
      signalGateCounts: {
        digest_generation: 1,
      },
      byTriggerMode: {
        heartbeat: {
          attemptedCount: 1,
          executedCount: 1,
          skippedCount: 0,
          signalGateCounts: {
            digest_generation: 1,
          },
        },
      },
    });
    expect(second.executed).toBe(false);
    expect(second.skipCode).toBe("cooldown_active");
    expect(second.state.lastAutoTrigger).toMatchObject({
      triggerMode: "heartbeat",
      executed: false,
      skipCode: "cooldown_active",
    });
    expect(second.state.autoStats).toMatchObject({
      attemptedCount: 2,
      executedCount: 1,
      skippedCount: 1,
      skipCodeCounts: {
        cooldown_active: 1,
      },
      signalGateCounts: {
        digest_generation: 1,
      },
      byTriggerMode: {
        heartbeat: {
          attemptedCount: 2,
          executedCount: 1,
          skippedCount: 1,
          skipCodeCounts: {
            cooldown_active: 1,
          },
          signalGateCounts: {
            digest_generation: 1,
          },
        },
      },
    });
    const persistedState = await runtime.getState();
    expect(persistedState.lastAutoTrigger).toMatchObject({
      triggerMode: "heartbeat",
      executed: false,
      skipCode: "cooldown_active",
    });
  });

  it("reserves an automatic run before awaiting its input snapshot", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-reservation-"));
    tempDirs.push(stateDir);
    let releaseSnapshot!: () => void;
    const snapshotBlocked = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    let snapshotCalls = 0;
    const buildInputSnapshot = vi.fn(async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        await snapshotBlocked;
      }
      return createSnapshot();
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "single reserved dream",
                stableInsights: ["reservation prevents duplicate billing"],
                corrections: [],
                openQuestions: [],
                shareCandidates: [],
                nextFocus: ["keep one owner"],
              }),
            },
          }],
        };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot,
    });

    const firstPromise = runtime.maybeAutoRun({ triggerMode: "heartbeat" });
    await vi.waitFor(() => expect(buildInputSnapshot).toHaveBeenCalledTimes(1));
    const secondPromise = runtime.maybeAutoRun({ triggerMode: "cron" });
    releaseSnapshot();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);
    expect(second.skipCode).toBe("already_running");
    expect(buildInputSnapshot).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs automatic fallback dream when model config is missing", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-auto-fallback-"));
    tempDirs.push(stateDir);

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const result = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "heartbeat",
      reason: "auto fallback trigger",
    });

    expect(result.executed).toBe(true);
    expect(result.record?.status).toBe("completed");
    expect(result.record?.generationMode).toBe("fallback");
    expect(result.record?.fallbackReason).toBe("missing_model_config");
    expect(result.state.lastAutoTrigger).toMatchObject({
      triggerMode: "heartbeat",
      executed: true,
      runId: result.record?.id,
      status: "completed",
    });
    expect(result.state.cooldownUntil).toBeTruthy();
    expect(result.state.failureBackoffUntil).toBeUndefined();
  });

  it("applies failure backoff for automatic dream retries when artifact writing fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-backoff-"));
    tempDirs.push(stateDir);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "writer fail path",
                stableInsights: ["writer failure should still mark run failed"],
                corrections: [],
                openQuestions: [],
                shareCandidates: [],
                nextFocus: ["keep backoff active"],
              }),
            },
          }],
        };
      },
    })));
    vi.spyOn(dreamWriterModule, "writeDreamArtifacts").mockRejectedValue(new Error("disk full"));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date("2026-04-19T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const first = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "cron",
      reason: "cron auto trigger",
    });
    const second = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "cron",
      reason: "cron auto trigger",
    });

    expect(first.executed).toBe(true);
    expect(first.record?.status).toBe("failed");
    expect(first.record?.generationMode).toBeUndefined();
    expect(first.state.failureBackoffUntil).toBeTruthy();
    expect(first.state.lastAutoTrigger).toMatchObject({
      triggerMode: "cron",
      executed: true,
      runId: first.record?.id,
      status: "failed",
      signal: {
        baselineAt: "2026-04-16T12:00:00.000Z",
        lastDreamCursor: {
          digestGeneration: 0,
          sessionMemoryMessageCount: 0,
          sessionMemoryToolCursor: 0,
          taskChangeSeq: 0,
          memoryChangeSeq: 0,
        },
        currentCursor: {
          digestGeneration: 2,
          sessionMemoryMessageCount: 6,
          sessionMemoryToolCursor: 2,
          taskChangeSeq: 3,
          memoryChangeSeq: 2,
        },
        recentWorkCount: 3,
        recentWorkRecapCount: 2,
        completedTaskCount: 3,
        recentDurableMemoryCount: 2,
        sessionDigestAvailable: true,
        sessionMemoryAvailable: true,
        digestGenerationDelta: 2,
        sessionMemoryRevisionDelta: 2,
        changeBudget: 19,
      },
    });
    expect(second.executed).toBe(false);
    expect(second.skipCode).toBe("failure_backoff_active");
    expect(second.state.lastAutoTrigger).toMatchObject({
      triggerMode: "cron",
      executed: false,
      skipCode: "failure_backoff_active",
    });
  });

  it("skips automatic dream after cooldown when cursor does not advance", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-stale-"));
    tempDirs.push(stateDir);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "Auto dream runtime ready",
                stableInsights: ["fresh signal gate works"],
                corrections: [],
                openQuestions: [],
                shareCandidates: [],
                nextFocus: ["wait for fresh updates"],
              }),
            },
          }],
        };
      },
    })));

    let nowIso = "2026-04-19T12:00:00.000Z";
    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date(nowIso),
      buildInputSnapshot: async () => createSnapshot(),
    });

    const first = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "heartbeat",
      reason: "heartbeat auto trigger",
    });
    expect(first.executed).toBe(true);

    nowIso = "2026-04-20T12:30:00.000Z";
    const second = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "heartbeat",
      reason: "heartbeat auto trigger",
    });

    expect(second.executed).toBe(false);
    expect(second.skipCode).toBe("insufficient_signal");
    expect(second.skipReason).toContain("change budget");
    expect(second.state.lastAutoTrigger).toMatchObject({
      triggerMode: "heartbeat",
      executed: false,
      skipCode: "insufficient_signal",
      signal: {
        baselineAt: "2026-04-19T12:00:00.000Z",
        lastDreamCursor: {
          digestGeneration: 2,
          sessionMemoryMessageCount: 6,
          sessionMemoryToolCursor: 2,
          taskChangeSeq: 3,
          memoryChangeSeq: 2,
        },
        currentCursor: {
          digestGeneration: 2,
          sessionMemoryMessageCount: 6,
          sessionMemoryToolCursor: 2,
          taskChangeSeq: 3,
          memoryChangeSeq: 2,
        },
        digestGenerationDelta: 0,
        sessionMemoryMessageDelta: 0,
        sessionMemoryToolDelta: 0,
        sessionMemoryRevisionDelta: 0,
        taskChangeSeqDelta: 0,
        memoryChangeSeqDelta: 0,
        changeBudget: 0,
      },
    });
    expect(second.state.autoStats).toMatchObject({
      attemptedCount: 2,
      executedCount: 1,
      skippedCount: 1,
      skipCodeCounts: {
        insufficient_signal: 1,
      },
      signalGateCounts: {
        digest_generation: 1,
        insufficient_signal: 1,
      },
      byTriggerMode: {
        heartbeat: {
          attemptedCount: 2,
          executedCount: 1,
          skippedCount: 1,
          skipCodeCounts: {
            insufficient_signal: 1,
          },
          signalGateCounts: {
            digest_generation: 1,
            insufficient_signal: 1,
          },
        },
      },
    });
  });

  it("runs automatic dream when task and memory change budget accumulates even without digest advance", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-dream-runtime-budget-"));
    tempDirs.push(stateDir);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                headline: "Budget gate passed",
                stableInsights: ["task/memory seq 可以驱动 automatic dream"],
                corrections: [],
                openQuestions: [],
                shareCandidates: [],
                nextFocus: ["继续观察真实流量"],
              }),
            },
          }],
        };
      },
    })));

    const runtime = new DreamRuntime({
      stateDir,
      agentId: "coder",
      model: "gpt-test",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      now: () => new Date("2026-04-20T12:00:00.000Z"),
      buildInputSnapshot: async () => createSnapshot({
        changeCursor: {
          digestGeneration: 0,
          sessionMemoryMessageCount: 0,
          sessionMemoryToolCursor: 0,
          taskChangeSeq: 2,
          memoryChangeSeq: 2,
        },
        sessionDigest: {
          rollingSummary: "digest 暂无新代数",
          lastDigestAt: Date.parse("2026-04-20T11:35:00.000Z"),
        },
        sessionMemory: {
          summary: "session memory 暂无新 revision",
          updatedAt: Date.parse("2026-04-20T11:40:00.000Z"),
        },
      }),
    });

    const result = await runtime.maybeAutoRun({
      conversationId: "agent:coder:main",
      triggerMode: "cron",
      reason: "change budget auto trigger",
    });

    expect(result.executed).toBe(true);
    expect(result.record?.status).toBe("completed");
    expect(result.state.lastAutoTrigger?.signal).toMatchObject({
      digestGenerationDelta: 0,
      sessionMemoryRevisionDelta: 0,
      taskChangeSeqDelta: 2,
      memoryChangeSeqDelta: 2,
      changeBudget: 4,
    });
    expect(result.state.autoStats).toMatchObject({
      attemptedCount: 1,
      executedCount: 1,
      skippedCount: 0,
      signalGateCounts: {
        change_budget: 1,
      },
      byTriggerMode: {
        cron: {
          attemptedCount: 1,
          executedCount: 1,
          skippedCount: 0,
          signalGateCounts: {
            change_budget: 1,
          },
        },
      },
    });
  });
});
