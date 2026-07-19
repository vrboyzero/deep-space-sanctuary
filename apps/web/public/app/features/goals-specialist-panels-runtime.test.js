// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  buildGoalBridgeGovernanceSummary,
  collectGoalTrackingRuntimeTaskIds,
  createGoalsSpecialistPanelsRuntimeFeature,
  mergeGoalTrackingRuntimeIndex,
} from "./goals-specialist-panels-runtime.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("goal tracking runtime helpers", () => {
  it("collects unique runtime task ids from recent nodes and the focused node", () => {
    const nodes = [
      { id: "node_1", lastRunId: "run_1" },
      { id: "node_2", lastRunId: "run_2" },
      { id: "node_3", lastRunId: "run_3" },
      { id: "node_4", lastRunId: "run_4" },
      { id: "node_5", lastRunId: "run_5" },
      { id: "node_6", lastRunId: "run_6" },
      { id: "node_7", lastRunId: "run_7" },
      { id: "node_8", lastRunId: "run_2" },
    ];

    expect(collectGoalTrackingRuntimeTaskIds(nodes, " node_7 ")).toEqual([
      "run_1",
      "run_2",
      "run_3",
      "run_4",
      "run_5",
      "run_6",
      "run_7",
    ]);
  });

  it("merges bridge runtime views back into matching nodes", () => {
    const merged = mergeGoalTrackingRuntimeIndex([
      { id: "node_impl", lastRunId: "run_bridge" },
      { id: "node_docs", lastRunId: "run_docs" },
    ], {
      run_bridge: {
        bridgeSubtaskView: { kind: "ide", label: "Bridge ide", summaryLine: "Bridge ide via vscode.open" },
        bridgeSessionView: {
          runtimeState: "orphaned",
          closeReason: "orphan",
          blockReason: "Bridge session lost its governed subtask binding and was cleaned up as an orphan session.",
          artifactPath: "artifacts/bridge.md",
        },
      },
    });

    expect(merged[0]).toMatchObject({
      id: "node_impl",
      lastRunId: "run_bridge",
      bridgeSubtaskView: {
        kind: "ide",
        label: "Bridge ide",
      },
      bridgeSessionView: {
        runtimeState: "orphaned",
        closeReason: "orphan",
        artifactPath: "artifacts/bridge.md",
      },
    });
    expect(merged[1]).toEqual({
      id: "node_docs",
      lastRunId: "run_docs",
    });
  });

  it("builds an aggregated bridge governance summary ordered by recovery severity", () => {
    const summary = buildGoalBridgeGovernanceSummary([
      {
        id: "node_review",
        title: "Review recovery",
        lastRunId: "run_review",
        bridgeSubtaskView: {
          summaryLine: "Bridge review via codex_session.interactive: validate the recovery path.",
        },
        bridgeSessionView: {
          runtimeState: "runtime-lost",
          closeReason: "runtime-lost",
          blockReason: "Bridge session runtime lost during startup recovery and must be resumed or relaunched before work can continue.",
          artifactPath: "artifacts/review.md",
        },
      },
      {
        id: "node_patch",
        title: "Patch orphan cleanup",
        lastRunId: "run_patch",
        bridgeSubtaskView: {
          summaryLine: "Bridge ide via vscode.open: patch the orphan cleanup flow.",
        },
        bridgeSessionView: {
          runtimeState: "orphaned",
          closeReason: "orphan",
          blockReason: "Bridge session lost its governed subtask binding and was cleaned up as an orphan session.",
          transcriptPath: "logs/orphan.jsonl",
        },
      },
      {
        id: "node_docs",
        title: "Update docs",
        lastRunId: "run_docs",
        bridgeSubtaskView: {
          summaryLine: "Bridge doc via files.open: update the rollout note.",
        },
        bridgeSessionView: {
          runtimeState: "active",
        },
      },
    ]);

    expect(summary).toMatchObject({
      bridgeNodeCount: 3,
      activeCount: 1,
      runtimeLostCount: 1,
      orphanedCount: 1,
      blockedCount: 2,
      artifactCount: 1,
      transcriptCount: 1,
    });
    expect(summary?.items.map((item) => item.nodeId)).toEqual([
      "node_review",
      "node_patch",
      "node_docs",
    ]);
    expect(summary?.items[0]).toMatchObject({
      taskId: "run_review",
      runtimeState: "runtime-lost",
      closeReason: "runtime-lost",
    });
    expect(summary?.items[1]).toMatchObject({
      taskId: "run_patch",
      runtimeState: "orphaned",
      closeReason: "orphan",
    });
  });

  it("routes governance suggestion actions to experience workbench with fallback filters", async () => {
    document.body.innerHTML = `
      <div id="goalsDetail">
        <div id="goalGovernancePanel">
          <button
            data-goal-open-experience="true"
            data-goal-open-experience-candidate-id=""
            data-goal-open-experience-type="skill"
            data-goal-open-experience-query="Skill candidate from goal"
          ></button>
          <button
            data-goal-open-experience="true"
            data-goal-open-experience-candidate-id="goal_exp_method_1"
            data-goal-open-experience-type="method"
            data-goal-open-experience-query="Method candidate from goal"
          ></button>
        </div>
      </div>
    `;

    const openExperienceWorkbench = vi.fn(async () => {});
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => ({
        capabilityCache: {},
        capabilityPending: {},
      }),
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(async () => null),
      goalRuntimeFilePath: vi.fn(() => ""),
      safeJsonParse: vi.fn(() => null),
      sendReq: vi.fn(async () => ({ ok: true })),
      makeId: () => "req-1",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench,
      applyGoalContinuationFocus: vi.fn(),
    });

    feature.bindGoalReviewGovernanceActions({ id: "goal_alpha" });

    const [skillNode, methodNode] = Array.from(document.querySelectorAll("[data-goal-open-experience]"));
    skillNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    methodNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(openExperienceWorkbench).toHaveBeenNthCalledWith(1, {
      candidateId: "",
      filters: {
        type: "skill",
        query: "Skill candidate from goal",
      },
      preferFirst: true,
    });
    expect(openExperienceWorkbench).toHaveBeenNthCalledWith(2, {
      candidateId: "goal_exp_method_1",
      filters: {
        type: "method",
        query: "Method candidate from goal",
      },
      preferFirst: true,
    });

    feature.dispose();
    skillNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(openExperienceWorkbench).toHaveBeenCalledTimes(2);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeGroupCount: 0,
      activeListenerCount: 0,
      disposed: true,
    });
  });

  it("loads tracking data from goal.task_graph.read and forwards memory freshness to the tracking panel", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalTrackingPanel"></div></div>';
    const renderGoalTrackingPanel = vi.fn();
    const sendReq = vi.fn(async (req) => {
      if (req.method === "goal.task_graph.read") {
        return {
          ok: true,
          payload: {
            graph: {
              nodes: [{
                id: "node_impl",
                title: "Implement runtime inspect",
                status: "running",
                lastRunId: "run_impl",
              }],
            },
            checkpoints: {
              items: [{
                id: "cp_1",
                nodeId: "node_impl",
                status: "waiting_user",
                title: "Checkpoint A",
                updatedAt: "2026-06-12T12:00:00.000Z",
                history: [],
              }],
            },
            memoryFreshness: {
              summary: {
                available: true,
                headline: "当前治理队列存在待收口项",
                reviewRequiredCount: 1,
              },
            },
          },
        };
      }
      if (req.method === "subtask.get") {
        return { ok: true, payload: { item: {} } };
      }
      return { ok: false, error: { message: "unexpected request" } };
    });
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => ({
        selectedId: "goal_alpha",
        trackingSeq: 0,
        continuationFocusNode: null,
        trackingCheckpoints: [],
        capabilityCache: {},
        capabilityPending: {},
      }),
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => ({
        renderGoalTrackingPanelLoading: vi.fn(),
        renderGoalTrackingPanel,
        renderGoalTrackingPanelError: vi.fn(),
      }),
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(async () => null),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: vi.fn(() => null),
      sendReq,
      makeId: (() => {
        let count = 0;
        return () => `req-${++count}`;
      })(),
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    await feature.loadGoalTrackingData({
      id: "goal_alpha",
      tasksPath: "tasks.json",
    });

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "goal.task_graph.read",
      params: { goalId: "goal_alpha" },
    }));
    expect(renderGoalTrackingPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "goal_alpha",
    }), expect.objectContaining({
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          id: "cp_1",
          nodeId: "node_impl",
        }),
      ]),
      memoryFreshness: expect.objectContaining({
        summary: expect.objectContaining({
          available: true,
          headline: "当前治理队列存在待收口项",
        }),
      }),
    }));
  });

  it("settles disposed tracking source reads without checkpoint or panel commits", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalTrackingPanel"></div></div>';
    const taskGraphRequest = createDeferred();
    const renderGoalTrackingPanel = vi.fn();
    const renderGoalTrackingPanelError = vi.fn();
    const applyGoalContinuationFocus = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      trackingSeq: 0,
      continuationFocusNode: null,
      trackingCheckpoints: [{ id: "cp_existing" }],
      capabilityCache: {},
      capabilityPending: {},
    };
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => ({
        renderGoalTrackingPanelLoading: vi.fn(),
        renderGoalTrackingPanel,
        renderGoalTrackingPanelError,
      }),
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(async () => null),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: JSON.parse,
      sendReq: vi.fn((req) => (
        req.method === "goal.task_graph.read"
          ? taskGraphRequest.promise
          : Promise.resolve({ ok: true, payload: { item: {} } })
      )),
      makeId: () => "req-tracking-source",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus,
    });

    const load = feature.loadGoalTrackingData({
      id: "goal_alpha",
      tasksPath: "tasks.json",
    });
    feature.dispose();
    taskGraphRequest.resolve({
      ok: true,
      payload: {
        graph: { nodes: [{ id: "node_late", title: "Late node" }] },
        checkpoints: { items: [{ id: "cp_late", nodeId: "node_late" }] },
      },
    });
    await load;

    expect(goalsState.trackingCheckpoints).toEqual([{ id: "cp_existing" }]);
    expect(renderGoalTrackingPanel).not.toHaveBeenCalled();
    expect(renderGoalTrackingPanelError).not.toHaveBeenCalled();
    expect(applyGoalContinuationFocus).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalTrackingReadCount: 0,
    });
  });

  it("settles a disposed tracking runtime-index read without final commits", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalTrackingPanel"></div></div>';
    const trackingRequest = createDeferred();
    const renderGoalTrackingPanel = vi.fn();
    const renderGoalTrackingPanelError = vi.fn();
    const applyGoalContinuationFocus = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      trackingSeq: 0,
      continuationFocusNode: null,
      trackingCheckpoints: [{ id: "cp_existing" }],
      capabilityCache: {},
      capabilityPending: {},
    };
    const sendReq = vi.fn((req) => {
      if (req.method === "goal.task_graph.read") {
        return Promise.resolve({
          ok: true,
          payload: {
            graph: {
              nodes: [{
                id: "node_late",
                title: "Late node",
                lastRunId: "run_late",
              }],
            },
            checkpoints: { items: [{ id: "cp_late", nodeId: "node_late" }] },
          },
        });
      }
      return trackingRequest.promise;
    });
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => ({
        renderGoalTrackingPanelLoading: vi.fn(),
        renderGoalTrackingPanel,
        renderGoalTrackingPanelError,
      }),
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(async () => null),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: JSON.parse,
      sendReq,
      makeId: (() => {
        let count = 0;
        return () => `req-tracking-index-${++count}`;
      })(),
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus,
    });

    const load = feature.loadGoalTrackingData({
      id: "goal_alpha",
      tasksPath: "tasks.json",
    });
    for (let attempt = 0; attempt < 20 && sendReq.mock.calls.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(sendReq.mock.calls.map(([req]) => req.method)).toEqual([
      "goal.task_graph.read",
      "subtask.get",
    ]);
    feature.dispose();
    trackingRequest.resolve({ ok: true, payload: { item: {} } });
    await load;

    expect(goalsState.trackingCheckpoints).toEqual([{ id: "cp_existing" }]);
    expect(renderGoalTrackingPanel).not.toHaveBeenCalled();
    expect(renderGoalTrackingPanelError).not.toHaveBeenCalled();
    expect(applyGoalContinuationFocus).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalTrackingReadCount: 0,
    });
  });

  it("loads capability data with governance freshness from cached or fetched governance summary", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalCapabilityPanel"></div></div>';
    const renderGoalCapabilityPanel = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      capabilitySeq: 0,
      governanceCache: {},
      capabilityCache: {},
      capabilityPending: {},
    };
    const sendReq = vi.fn(async (req) => {
      if (req.method === "goal.review_governance.summary") {
        return {
          ok: true,
          payload: {
            summary: {
              workflowPendingCount: 1,
              workflowOverdueCount: 0,
              checkpointWorkflowPendingCount: 1,
              checkpointWorkflowOverdueCount: 0,
              learningReviewInput: {
                summary: {
                  available: true,
                  headline: "memory=1, candidate=0, review=1, nudges=1",
                },
                summaryLines: [],
                nudges: [],
              },
              actionableReviews: [],
              actionableCheckpoints: [],
              templates: [],
              reviewers: [],
              notifications: { items: [] },
              notificationDispatches: { items: [] },
              publishRecords: { items: [] },
              reviewStatusCounts: {},
              reviewTypeCounts: {},
              recommendations: [],
            },
            memoryFreshness: {
              summary: {
                available: true,
                headline: "当前治理队列存在待收口项",
                reviewRequiredCount: 1,
              },
            },
          },
        };
      }
      return { ok: false, error: { message: "unexpected request" } };
    });
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => ({
        renderGoalCapabilityPanelLoading: vi.fn(),
        renderGoalCapabilityPanelError: vi.fn(),
        renderGoalCapabilityPanel,
      }),
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(async (filePath) => {
        if (filePath === "tasks.json") {
          return {
            content: JSON.stringify({
              nodes: [{
                id: "node_impl",
                title: "实现节点",
              }],
            }),
          };
        }
        if (filePath === "capability-plans.json") {
          return {
            content: JSON.stringify({
              items: [{
                id: "plan_impl",
                goalId: "goal_alpha",
                nodeId: "node_impl",
                status: "planned",
                executionMode: "single_agent",
                governanceMode: "direct",
                commanderAgentId: "",
                preferredAgents: [],
                riskLevel: "low",
                objective: "Ship implementation",
                summary: "Plan summary",
                queryHints: [],
                reasoning: [],
                methods: [],
                skills: [],
                mcpServers: [],
                subAgents: [],
                gaps: [],
                checkpoint: {
                  required: false,
                  reasons: [],
                  approvalMode: "none",
                  requiredRequestFields: [],
                  requiredDecisionFields: [],
                  escalationMode: "none",
                },
                actualUsage: {
                  methods: [],
                  skills: [],
                  mcpServers: [],
                  toolNames: [],
                },
                analysis: {
                  status: "aligned",
                  summary: "",
                  deviations: [],
                  recommendations: [],
                },
                generatedAt: "2026-05-17T10:00:00.000Z",
                updatedAt: "2026-05-17T10:10:00.000Z",
                orchestration: {
                  finalApprovalMode: "user_required",
                  notes: [],
                },
              }],
            }),
          };
        }
        return null;
      }),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: JSON.parse,
      sendReq,
      makeId: (() => {
        let count = 0;
        return () => `req-${++count}`;
      })(),
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    await feature.loadGoalCapabilityData({
      id: "goal_alpha",
      tasksPath: "tasks.json",
      activeNodeId: "node_impl",
    });

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "goal.review_governance.summary",
      params: { goalId: "goal_alpha" },
    }));
    expect(renderGoalCapabilityPanel).toHaveBeenCalledWith(expect.objectContaining({
      id: "goal_alpha",
    }), expect.objectContaining({
      memoryFreshness: expect.objectContaining({
        summary: expect.objectContaining({
          available: true,
          headline: "当前治理队列存在待收口项",
        }),
      }),
    }));
  });

  it("settles a disposed handoff read without rendering its late response", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalHandoffPanel"></div></div>';
    const request = createDeferred();
    const renderGoalHandoffPanelLoading = vi.fn();
    const renderGoalHandoffPanelError = vi.fn();
    const renderGoalHandoffPanel = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      handoffSeq: 0,
      capabilityCache: {},
      capabilityPending: {},
    };
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => ({
        renderGoalHandoffPanelLoading,
        renderGoalHandoffPanelError,
        renderGoalHandoffPanel,
      }),
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(async () => null),
      goalRuntimeFilePath: vi.fn(() => ""),
      safeJsonParse: vi.fn(() => null),
      sendReq: vi.fn(() => request.promise),
      makeId: () => "req-handoff",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    const load = feature.loadGoalHandoffData({ id: "goal_alpha" });
    expect(renderGoalHandoffPanelLoading).toHaveBeenCalledOnce();
    feature.dispose();
    request.resolve({
      ok: true,
      payload: {
        handoff: { summary: "late handoff" },
        continuationState: { status: "ready" },
      },
    });
    await load;

    expect(renderGoalHandoffPanel).not.toHaveBeenCalled();
    expect(renderGoalHandoffPanelError).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalHandoffReadCount: 0,
    });
  });

  it("settles a disposed progress read without rendering its late file content", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalProgressPanel"></div></div>';
    const request = createDeferred();
    const renderGoalProgressPanelLoading = vi.fn();
    const renderGoalProgressPanel = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      progressSeq: 0,
      capabilityCache: {},
      capabilityPending: {},
    };
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => ({
        renderGoalProgressPanelLoading,
        renderGoalProgressPanel,
      }),
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(() => request.promise),
      goalRuntimeFilePath: vi.fn(() => ""),
      safeJsonParse: vi.fn(() => null),
      sendReq: vi.fn(async () => ({ ok: true })),
      makeId: () => "req-progress",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    const load = feature.loadGoalProgressData({
      id: "goal_alpha",
      progressPath: "progress.md",
    });
    expect(renderGoalProgressPanelLoading).toHaveBeenCalledOnce();
    feature.dispose();
    request.resolve({
      content: "## 2026-07-19\n- event: completed\n- title: late progress",
    });
    await load;

    expect(renderGoalProgressPanel).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalProgressReadCount: 0,
    });
  });

  it("settles a disposed Canvas read without rendering its late board-ref content", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalCanvasPanel"></div></div>';
    const request = createDeferred();
    const renderGoalCanvasPanelLoading = vi.fn();
    const renderGoalCanvasPanel = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      canvasSeq: 0,
      capabilityCache: {},
      capabilityPending: {},
    };
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => ({
        renderGoalCanvasPanelLoading,
        renderGoalCanvasPanel,
      }),
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn(() => request.promise),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: JSON.parse,
      sendReq: vi.fn(async () => ({ ok: true })),
      makeId: () => "req-canvas",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    const load = feature.loadGoalCanvasData({ id: "goal_alpha" });
    expect(renderGoalCanvasPanelLoading).toHaveBeenCalledOnce();
    feature.dispose();
    request.resolve({
      content: JSON.stringify({ boardId: "board-late", updatedAt: "2026-07-19T00:00:00.000Z" }),
    });
    await load;

    expect(renderGoalCanvasPanel).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalCanvasReadCount: 0,
    });
  });

  it("settles a disposed governance summary read without cache or panel commits", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalGovernancePanel"></div></div>';
    const request = createDeferred();
    const renderGoalReviewGovernancePanelLoading = vi.fn();
    const renderGoalReviewGovernancePanelError = vi.fn();
    const renderGoalReviewGovernancePanel = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      governanceSeq: 0,
      governanceCache: {},
      continuationFocusNode: null,
      capabilityCache: {},
      capabilityPending: {},
    };
    const sendReq = vi.fn(() => request.promise);
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => ({
        renderGoalReviewGovernancePanelLoading,
        renderGoalReviewGovernancePanelError,
        renderGoalReviewGovernancePanel,
      }),
      readSourceFile: vi.fn(async () => null),
      goalRuntimeFilePath: vi.fn(() => ""),
      safeJsonParse: vi.fn(() => null),
      sendReq,
      makeId: () => "req-governance",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    const load = feature.loadGoalReviewGovernanceData({
      id: "goal_alpha",
      tasksPath: "tasks.json",
    });
    expect(renderGoalReviewGovernancePanelLoading).toHaveBeenCalledOnce();
    feature.dispose();
    request.resolve({
      ok: true,
      payload: { summary: { summary: "late governance" } },
    });
    await load;

    expect(goalsState.governanceCache).toEqual({});
    expect(renderGoalReviewGovernancePanel).not.toHaveBeenCalled();
    expect(renderGoalReviewGovernancePanelError).not.toHaveBeenCalled();
    expect(sendReq).toHaveBeenCalledTimes(1);
  });

  it("settles a disposed governance tracking-index read without final commits", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalGovernancePanel"></div></div>';
    const trackingRequest = createDeferred();
    const renderGoalReviewGovernancePanel = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      governanceSeq: 0,
      governanceCache: {},
      continuationFocusNode: null,
      capabilityCache: {},
      capabilityPending: {},
    };
    const sendReq = vi.fn((req) => {
      if (req.method === "goal.review_governance.summary") {
        return Promise.resolve({
          ok: true,
          payload: { summary: { summary: "active governance" } },
        });
      }
      return trackingRequest.promise;
    });
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => ({
        renderGoalReviewGovernancePanelLoading: vi.fn(),
        renderGoalReviewGovernancePanelError: vi.fn(),
        renderGoalReviewGovernancePanel,
      }),
      readSourceFile: vi.fn(async () => ({
        content: JSON.stringify({ nodes: [{ id: "node_impl", lastRunId: "run_impl" }] }),
      })),
      goalRuntimeFilePath: vi.fn(() => ""),
      safeJsonParse: JSON.parse,
      sendReq,
      makeId: (() => {
        let count = 0;
        return () => `req-governance-${++count}`;
      })(),
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });

    const load = feature.loadGoalReviewGovernanceData({
      id: "goal_alpha",
      tasksPath: "tasks.json",
    });
    for (let attempt = 0; attempt < 5 && sendReq.mock.calls.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(sendReq.mock.calls.map(([req]) => req.method)).toEqual([
      "goal.review_governance.summary",
      "subtask.get",
    ]);
    feature.dispose();
    trackingRequest.resolve({ ok: true, payload: { item: {} } });
    await load;

    expect(goalsState.governanceCache).toEqual({});
    expect(renderGoalReviewGovernancePanel).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalGovernanceReadCount: 0,
    });
  });

  it("settles disposed capability files without cache writes and cleans the public pending signal", async () => {
    document.body.innerHTML = '<div id="goalsDetail"></div>';
    const tasksRequest = createDeferred();
    const plansRequest = createDeferred();
    const goalsState = {
      selectedId: "goal_alpha",
      capabilityCache: {},
      capabilityPending: {},
    };
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => null,
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn((filePath) => (
        filePath === "tasks.json" ? tasksRequest.promise : plansRequest.promise
      )),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: JSON.parse,
      sendReq: vi.fn(async () => ({ ok: true })),
      makeId: () => "req-capability",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus: vi.fn(),
    });
    const goal = {
      id: "goal_alpha",
      tasksPath: "tasks.json",
    };

    const load = feature.ensureGoalCapabilityCache(goal);
    expect(goalsState.capabilityPending.goal_alpha).toBeTruthy();
    feature.dispose();
    tasksRequest.resolve({ content: JSON.stringify({ nodes: [{ id: "node_impl", title: "Impl" }] }) });
    plansRequest.resolve({ content: JSON.stringify({ items: [{ id: "plan_impl", nodeId: "node_impl" }] }) });

    await expect(load).resolves.toBeUndefined();
    expect(goalsState.capabilityCache).toEqual({});
    expect(goalsState.capabilityPending).toEqual({});
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalCapabilityCacheReadCount: 0,
    });
  });

  it("settles a disposed capability panel chain without success or error commits", async () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalCapabilityPanel"></div></div>';
    const tasksRequest = createDeferred();
    const plansRequest = createDeferred();
    const governanceRequest = createDeferred();
    const renderGoalCapabilityPanelLoading = vi.fn();
    const renderGoalCapabilityPanelError = vi.fn();
    const renderGoalCapabilityPanel = vi.fn();
    const disposeCapabilityPanel = vi.fn();
    const applyGoalContinuationFocus = vi.fn();
    const goalsState = {
      selectedId: "goal_alpha",
      capabilitySeq: 0,
      capabilityCache: {},
      capabilityPending: {},
      governanceCache: {},
    };
    const feature = createGoalsSpecialistPanelsRuntimeFeature({
      refs: {
        goalsDetailEl: document.getElementById("goalsDetail"),
      },
      getGoalsState: () => goalsState,
      getGoalsCapabilityPanelFeature: () => ({
        renderGoalCapabilityPanelLoading,
        renderGoalCapabilityPanelError,
        renderGoalCapabilityPanel,
        dispose: disposeCapabilityPanel,
      }),
      getGoalsReadonlyPanelsFeature: () => null,
      getGoalsTrackingPanelFeature: () => null,
      getGoalsGovernancePanelFeature: () => null,
      readSourceFile: vi.fn((filePath) => (
        filePath === "tasks.json" ? tasksRequest.promise : plansRequest.promise
      )),
      goalRuntimeFilePath: vi.fn((_goal, name) => name),
      safeJsonParse: JSON.parse,
      sendReq: vi.fn(() => governanceRequest.promise),
      makeId: () => "req-capability-panel",
      getCanvasContextFeature: () => null,
      openSourcePath: vi.fn(async () => {}),
      openContinuationAction: vi.fn(async () => {}),
      generateGoalHandoff: vi.fn(async () => {}),
      runGoalApprovalScan: vi.fn(async () => {}),
      runGoalSuggestionReviewDecision: vi.fn(async () => {}),
      runGoalSuggestionReviewEscalation: vi.fn(async () => {}),
      runGoalCheckpointEscalation: vi.fn(async () => {}),
      openExperienceWorkbench: vi.fn(async () => {}),
      applyGoalContinuationFocus,
    });
    const goal = {
      id: "goal_alpha",
      tasksPath: "tasks.json",
    };

    const load = feature.loadGoalCapabilityData(goal);
    expect(renderGoalCapabilityPanelLoading).toHaveBeenCalledOnce();
    feature.dispose();
    expect(disposeCapabilityPanel).toHaveBeenCalledOnce();
    tasksRequest.resolve({ content: JSON.stringify({ nodes: [{ id: "node_impl", title: "Impl" }] }) });
    plansRequest.resolve({ content: JSON.stringify({ items: [] }) });
    governanceRequest.resolve({
      ok: true,
      payload: { summary: { summary: "late governance" } },
    });
    await load;

    expect(renderGoalCapabilityPanel).not.toHaveBeenCalled();
    expect(renderGoalCapabilityPanelError).not.toHaveBeenCalled();
    expect(applyGoalContinuationFocus).not.toHaveBeenCalled();
    expect(goalsState.capabilityCache).toEqual({});
    expect(goalsState.governanceCache).toEqual({});
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingGoalCapabilityCacheReadCount: 0,
      pendingGoalCapabilityPanelReadCount: 0,
    });
  });
});
