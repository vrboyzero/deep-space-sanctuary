import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { resolveStateDir } from "@belldandy/protocol";
import { getGlobalMemoryManager, type ExperienceCandidate } from "@belldandy/memory";
import { publishSkillCandidate, getGlobalSkillRegistry, getUserSkillsDir } from "@belldandy/skills";
import { getGoalUpdateAreas } from "./goal-events.js";
import { normalizeGoalId, normalizeGoalSlug, resolveGoalPaths } from "./paths.js";
import { buildGoalHandoffResult, generateGoalHandoff } from "./handoff.js";
import { loadGoalHandoffBridgeGovernanceSummary } from "./handoff-bridge.js";
import { generateGoalMethodCandidates } from "./method-candidates.js";
import { appendGoalProgressEntry } from "./progress.js";
import { generateGoalRetrospective } from "./retrospective.js";
import { generateGoalSkillCandidates } from "./skill-candidates.js";
import { generateGoalFlowPatterns } from "./flow-patterns.js";
import { generateCrossGoalFlowPatterns } from "./cross-goal-flow-patterns.js";
import { runGoalReviewScanLearningReview } from "../learning-review-runner.js";
import { getGoalRegistryEntry, listGoalRegistryEntries, upsertGoalRegistryEntry } from "./registry.js";
import { scaffoldGoalFiles } from "./scaffold.js";
import { createGoalConversationId, createGoalNodeConversationId, createGoalRunId } from "./session.js";
import { GoalRuntimeBindingStore } from "../goal-runtime-binding-store.js";
import { analyzeGoalCapabilityPlan, getDefaultCapabilityPlanAnalysis } from "./capability-analysis.js";
import { enrichGoalCapabilityPlanOrchestration } from "./capability-acceptance-gate.js";
import {
  buildGoalLearningReviewRefreshFingerprint,
  readGoalLearningReviewRefreshState,
  writeGoalLearningReviewRefreshState,
} from "./learning-review-refresh.js";
import {
  getGoalFlowPatternsPath,
  getGoalMethodCandidatesPath,
  getGoalPublishRecordsPath,
  getGoalSkillCandidatesPath,
  readGoalCapabilityPlans,
  readGoalCheckpoints,
  readGoalFlowPatterns,
  readGoalMethodCandidates,
  readGoalReviewNotificationDispatches,
  readGoalReviewNotifications,
  readGoalRuntime,
  readGoalSkillCandidates,
  readGoalSuggestionReviews,
  readGoalPublishRecords,
  writeGoalCapabilityPlans,
  writeGoalCheckpoints,
  writeGoalReviewNotificationDispatches,
  writeGoalReviewNotifications,
  writeGoalRuntime,
  writeGoalPublishRecords,
  writeGoalSuggestionReviews,
} from "./runtime.js";
import {
  getGoalReviewNotificationDispatchesPath,
  getGoalReviewNotificationsPath,
  getReviewGovernanceConfigPath,
  readReviewGovernanceConfig,
} from "./review-governance.js";
import { createGoalTaskNode, readGoalTaskGraph, transitionGoalTaskNode, updateGoalTaskNode, writeGoalTaskGraph } from "./task-graph.js";
import type {
  GoalApprovalWorkflowScanItem,
  GoalApprovalWorkflowScanResult,
  GoalCapabilityPlan,
  GoalCapabilityPlanSubAgent,
  GoalExperienceSuggestResult,
  GoalCheckpointEscalateInput,
  GoalReviewDeliveryChannel,
  GoalReviewGovernanceSummary,
  GoalReviewGovernanceConfig,
  GoalReviewNotification,
  GoalReviewNotificationDispatch,
  GoalReviewNotificationDispatchCounts,
  GoalReviewNotificationDispatchState,
  GoalReviewNotificationState,
  GoalReviewTemplate,
  GoalSuggestionReviewEscalateInput,
  GoalSuggestionReviewDecisionInput,
  GoalSuggestionReviewItem,
  GoalSuggestionReviewMutationResult,
  GoalSuggestionReviewState,
  GoalSuggestionReviewStatus,
  GoalSuggestionReviewWorkflow,
  GoalSuggestionReviewWorkflowConfigureInput,
  GoalSuggestionReviewWorkflowScanInput,
  GoalSuggestionReviewWorkflowScanItem,
  GoalSuggestionReviewWorkflowScanResult,
  GoalSuggestionReviewWorkflowDecision,
  GoalSuggestionReviewWorkflowEscalation,
  GoalSuggestionReviewWorkflowMode,
  GoalSuggestionReviewWorkflowReviewer,
  GoalSuggestionReviewWorkflowStage,
  GoalSuggestionReviewWorkflowStageInput,
  GoalSuggestionReviewWorkflowVote,
  GoalSuggestionPublishInput,
  GoalSuggestionPublishMutationResult,
  GoalSuggestionPublishRecord,
  GoalSuggestionPublishState,
  GoalSuggestionType,
  GoalCrossFlowPatternGenerateResult,
  GoalHandoffGenerateResult,
  GoalHandoffReadResult,
  GoalMethodCandidateGenerateResult,
  GoalRetrospectiveGenerateResult,
  GoalRuntimeState,
  GoalSkillCandidate,
  GoalSkillCandidateGenerateResult,
  GoalFlowPatternGenerateResult,
  GoalCapabilityPlanSaveInput,
  GoalCapabilityPlanState,
  GoalCheckpointPolicy,
  GoalCheckpointDecisionInput,
  GoalCheckpointHistoryEntry,
  GoalCheckpointItem,
  GoalCheckpointRequestInput,
  GoalCheckpointState,
  GoalScaffoldInput,
  GoalTaskGraph,
  GoalTaskNode,
  GoalTaskNodeCreateInput,
  GoalTaskNodeTransitionInput,
  GoalTaskNodeUpdateInput,
  GoalUpdateEvent,
  GoalUpdateReason,
  LongTermGoal,
} from "./types.js";

type GoalTaskMutationResult = {
  goal: LongTermGoal;
  graph: GoalTaskGraph;
  node: GoalTaskNode;
};

type GoalCheckpointMutationResult = GoalTaskMutationResult & {
  checkpoints: GoalCheckpointState;
  checkpoint: GoalCheckpointItem;
};

export class GoalManager {
  private eventSink?: (event: GoalUpdateEvent) => void | Promise<void>;
  private readonly goalMutationLocks = new Map<string, Promise<void>>();
  private readonly bindingStore: GoalRuntimeBindingStore;

  constructor(
    private readonly stateDir = resolveStateDir(process.env),
    options?: {
      bindingStore?: GoalRuntimeBindingStore;
    },
  ) {
    this.bindingStore = options?.bindingStore ?? new GoalRuntimeBindingStore(stateDir);
  }

  setEventSink(sink?: (event: GoalUpdateEvent) => void | Promise<void>): void {
    this.eventSink = sink;
  }

  async createGoal(input: GoalScaffoldInput): Promise<LongTermGoal> {
    const now = new Date().toISOString();
    const slug = normalizeGoalSlug(input.slug || input.title);
    const id = `goal_${normalizeGoalId(slug || crypto.randomUUID().slice(0, 8))}`;
    const paths = resolveGoalPaths({
      stateDir: this.stateDir,
      slug,
      goalId: id,
      goalRoot: input.goalRoot,
    });

    const goal: LongTermGoal = {
      id,
      slug,
      title: input.title.trim(),
      status: "planning",
      objective: input.objective?.trim() || undefined,
      currentPhase: input.currentPhase ?? "aligning",
      goalRoot: paths.goalRoot,
      runtimeRoot: paths.runtimeRoot,
      docRoot: paths.docRoot,
      northstarPath: paths.northstarPath,
      tasksPath: paths.tasksPath,
      progressPath: paths.progressPath,
      handoffPath: paths.handoffPath,
      registryPath: paths.registryPath,
      pathSource: paths.pathSource,
      boardId: `${id}_main`,
      createdAt: now,
      updatedAt: now,
      activeConversationId: createGoalConversationId(id),
    };

    await scaffoldGoalFiles(goal);
    await upsertGoalRegistryEntry(this.stateDir, goal);
    return goal;
  }

  async listGoals(): Promise<LongTermGoal[]> {
    return listGoalRegistryEntries(this.stateDir);
  }

  async getGoal(goalId: string): Promise<LongTermGoal | null> {
    return getGoalRegistryEntry(this.stateDir, goalId);
  }

  async resumeGoal(
    goalId: string,
    nodeId?: string,
    replay?: { checkpointId?: string },
  ): Promise<{ goal: LongTermGoal; conversationId: string; runId?: string }> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const runId = nodeId ? createGoalRunId() : undefined;
      const conversationId = nodeId
        ? createGoalNodeConversationId(goal.id, nodeId, runId)
        : createGoalConversationId(goal.id);
      const now = new Date().toISOString();
      const updatedGoal: LongTermGoal = {
        ...goal,
        status: "executing",
        activeConversationId: conversationId,
        activeNodeId: nodeId,
        lastNodeId: nodeId ?? goal.lastNodeId,
        lastRunId: runId ?? goal.lastRunId,
        lastActiveAt: now,
        pausedAt: undefined,
        updatedAt: now,
      };
      await this.persistGoalHeaderState(goal, updatedGoal, {
        resumedAt: now,
        pausedAt: undefined,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        conversationId,
        nodeId,
        runId,
        status: updatedGoal.status,
      });
      if (replay?.checkpointId) {
        await appendGoalProgressEntry(updatedGoal, {
          kind: "checkpoint_replay_started",
          title: `Replay checkpoint ${replay.checkpointId}`,
          nodeId,
          status: updatedGoal.status,
          summary: `Resume replay started from checkpoint ${replay.checkpointId}.`,
          note: nodeId
            ? `Checkpoint replay resumed into node ${nodeId}.`
            : "Checkpoint replay resumed into the goal channel.",
          runId,
          checkpointId: replay.checkpointId,
        });
      }
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "goal_resumed",
        nodeId,
        checkpointId: replay?.checkpointId,
        runId,
      });
      return { goal: updatedGoal, conversationId, runId };
    });
  }

  async pauseGoal(goalId: string): Promise<LongTermGoal> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const now = new Date().toISOString();
      const updatedGoal: LongTermGoal = {
        ...goal,
        status: "paused",
        pausedAt: now,
        activeConversationId: undefined,
        activeNodeId: undefined,
        lastNodeId: goal.activeNodeId ?? goal.lastNodeId,
        updatedAt: now,
      };
      await this.persistGoalHeaderState(goal, updatedGoal, {
        pausedAt: now,
      });
      if (goal.activeConversationId) {
        await this.syncGoalSessionBinding(updatedGoal, {
          conversationId: goal.activeConversationId,
          nodeId: goal.activeNodeId ?? goal.lastNodeId,
          runId: goal.lastRunId,
          status: updatedGoal.status,
        });
      }
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "goal_paused",
        nodeId: updatedGoal.lastNodeId,
        runId: updatedGoal.lastRunId,
      });
      return updatedGoal;
    });
  }

  async readTaskGraph(goalId: string): Promise<GoalTaskGraph> {
    const goal = await this.requireGoal(goalId);
    const graph = await readGoalTaskGraph(goal);
    if (graph.version !== 2 || graph.goalId !== goal.id) {
      return writeGoalTaskGraph(goal, graph);
    }
    return graph;
  }

  async createTaskNode(goalId: string, input: GoalTaskNodeCreateInput): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = createGoalTaskNode(graph, input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_created",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.description,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_created",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async updateTaskNode(goalId: string, nodeId: string, patch: GoalTaskNodeUpdateInput): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = updateGoalTaskNode(graph, nodeId, patch);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_updated",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary ?? result.node.description,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_updated",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async claimTaskNode(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = transitionGoalTaskNode(graph, nodeId, "in_progress", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        status: "executing",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_claimed",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_claimed",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async markTaskNodePendingReview(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = transitionGoalTaskNode(graph, nodeId, "pending_review", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        status: "reviewing",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_pending_review",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_pending_review",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async markTaskNodeValidating(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = transitionGoalTaskNode(graph, nodeId, "validating", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        status: "reviewing",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_validating",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_validating",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async completeTaskNode(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const currentNode = graph.nodes.find((node) => node.id === nodeId);
      if (!currentNode) {
        throw new Error(`Task node not found: ${nodeId}`);
      }
      if (currentNode.checkpointRequired && currentNode.checkpointStatus !== "approved") {
        throw new Error(`Task node "${nodeId}" still requires an approved checkpoint before completion.`);
      }
      const result = transitionGoalTaskNode(graph, nodeId, "done", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        status: "executing",
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_completed",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_completed",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async blockTaskNode(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = transitionGoalTaskNode(graph, nodeId, "blocked", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
        status: "blocked",
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_blocked",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        note: result.node.blockReason,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_blocked",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async failTaskNode(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = transitionGoalTaskNode(graph, nodeId, "failed", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        status: "blocked",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_failed",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        note: result.node.blockReason,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_failed",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async skipTaskNode(goalId: string, nodeId: string, input: GoalTaskNodeTransitionInput = {}): Promise<GoalTaskMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const result = transitionGoalTaskNode(graph, nodeId, "skipped", input);
      const savedGraph = await writeGoalTaskGraph(goal, result.graph);
      const updatedGoal = await this.touchGoal(goal, {
        status: "executing",
        lastNodeId: nodeId,
        lastRunId: input.runId?.trim() || goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "task_node_skipped",
        title: result.node.title,
        nodeId: result.node.id,
        status: result.node.status,
        summary: result.node.summary,
        note: result.node.blockReason,
        runId: result.node.lastRunId,
      });
      await this.syncGoalSessionBinding(updatedGoal, {
        nodeId: result.node.id,
        runId: result.node.lastRunId,
        status: updatedGoal.status,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "task_node_skipped",
        nodeId: result.node.id,
        runId: result.node.lastRunId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: result.node };
    });
  }

  async listCheckpoints(goalId: string): Promise<GoalCheckpointState> {
    const goal = await this.requireGoal(goalId);
    return readGoalCheckpoints(goal);
  }

  async listSuggestionReviews(goalId: string): Promise<GoalSuggestionReviewState> {
    const goal = await this.requireGoal(goalId);
    return this.syncSuggestionReviews(goal);
  }

  async getReviewGovernanceSummary(goalId: string): Promise<GoalReviewGovernanceSummary> {
    const goal = await this.requireGoal(goalId);
    const now = new Date().toISOString();
    const [governanceConfig, reviews, publishRecords, notifications, notificationDispatches, crossGoal, checkpoints, graph, plans] = await Promise.all([
      readReviewGovernanceConfig(this.stateDir),
      this.syncSuggestionReviews(goal),
      readGoalPublishRecords(goal),
      readGoalReviewNotifications(goal),
      readGoalReviewNotificationDispatches(goal),
      this.generateCrossGoalFlowPatterns(),
      readGoalCheckpoints(goal),
      readGoalTaskGraph(goal),
      readGoalCapabilityPlans(goal),
    ]);
    const reviewStatusCounts = this.buildSuggestionReviewStatusCounts(reviews.items);
    const reviewTypeCounts = this.buildSuggestionReviewTypeCounts(reviews.items);
    const publishedKeys = new Set(publishRecords.items.map((item) => `${item.suggestionType}:${item.suggestionId}`));
    const overdueReviews = this.listOverdueSuggestionReviews(reviews.items, now);
    const actionableCheckpoints = this.listActionableCheckpoints(checkpoints.items, now);
    const workflowPendingCount = reviews.items.filter((item) => this.getPendingSuggestionReviewWorkflowStage(item.workflow)).length;
    const workflowOverdueCount = overdueReviews.length;
    const checkpointWorkflowPendingCount = actionableCheckpoints.length;
    const checkpointWorkflowOverdueCount = actionableCheckpoints.filter((item) => this.isCheckpointWorkflowOverdue(item, now)).length;
    const actionableReviews = reviews.items
      .filter((item) =>
        item.status === "pending_review"
        || item.status === "needs_revision"
        || (item.status === "accepted" && !publishedKeys.has(`${item.suggestionType}:${item.suggestionId}`)))
      .sort((left, right) => {
        const leftOverdue = overdueReviews.some((item) => item.id === left.id) ? 1 : 0;
        const rightOverdue = overdueReviews.some((item) => item.id === right.id) ? 1 : 0;
        if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
        return right.updatedAt.localeCompare(left.updatedAt);
      });
    const relatedCrossGoalPatterns = crossGoal.patterns
      .filter((item) => item.goalRefs.some((ref) => ref.goalId === goal.id))
      .slice(0, 5);
    const acceptedUnpublished = actionableReviews.filter((item) => item.status === "accepted");
    const pendingReviews = actionableReviews.filter((item) => item.status === "pending_review");
    const needsRevision = actionableReviews.filter((item) => item.status === "needs_revision");
    const recommendations = [
      overdueReviews[0]
        ? `存在已超 SLA 的 suggestion review：${overdueReviews[0].title}，建议立即执行 review scan / escalation。`
        : "",
      actionableCheckpoints[0] && this.isCheckpointWorkflowOverdue(actionableCheckpoints[0], now)
        ? `存在已超 SLA 的 checkpoint：${actionableCheckpoints[0].title}，建议执行 approval scan / escalation。`
        : "",
      acceptedUnpublished[0]
        ? `优先发布已通过审阅的 suggestion：${acceptedUnpublished[0].title}`
        : "",
      pendingReviews[0]
        ? `优先处理待审阅 suggestion：${pendingReviews[0].title}`
        : "",
      needsRevision[0]
        ? `存在待修订 suggestion，建议先补证据或草稿：${needsRevision[0].title}`
        : "",
      relatedCrossGoalPatterns[0]
        ? `当前 goal 已命中跨 goal 高频流程：${relatedCrossGoalPatterns[0].id}，可作为 method/skill 治理优先级依据`
        : "",
      actionableReviews.length === 0
        ? "当前没有待处理的 review / publish 项；如需继续提升，可转入 review chain / quorum / escalation workflow。"
        : "",
    ]
      .map((item) => item.trim())
      .filter(Boolean);
    const commanderFocus = this.buildCommanderFocusSummary(goal, graph, plans);
    if (commanderFocus?.managerActionHint) {
      recommendations.unshift(`Commander 建议：${commanderFocus.managerActionHint}`);
    } else if (commanderFocus?.nextAction) {
      recommendations.unshift(`Commander 下一步：${commanderFocus.nextAction}`);
    }
    return {
      goal,
      generatedAt: new Date().toISOString(),
      governanceConfig,
      governanceConfigPath: getReviewGovernanceConfigPath(this.stateDir),
      reviews,
      publishRecords,
      notifications,
      notificationsPath: getGoalReviewNotificationsPath(goal),
      notificationDispatches,
      notificationDispatchesPath: getGoalReviewNotificationDispatchesPath(goal),
      notificationDispatchCounts: this.buildNotificationDispatchCounts(notificationDispatches),
      crossGoal: {
        goalsScanned: crossGoal.goalsScanned,
        markdownPath: crossGoal.markdownPath,
        jsonPath: crossGoal.jsonPath,
        items: relatedCrossGoalPatterns,
      },
      reviewStatusCounts,
      reviewTypeCounts,
      workflowPendingCount,
      workflowOverdueCount,
      actionableReviews: actionableReviews.slice(0, 8),
      overdueReviews: overdueReviews.slice(0, 8),
      actionableCheckpoints: actionableCheckpoints.slice(0, 8),
      checkpointWorkflowPendingCount,
      checkpointWorkflowOverdueCount,
      commanderFocus,
      summary: [
        `reviews=${reviews.items.length}`,
        `pending=${reviewStatusCounts.pending_review}`,
        `workflow_pending=${workflowPendingCount}`,
        `workflow_overdue=${workflowOverdueCount}`,
        `checkpoint_pending=${checkpointWorkflowPendingCount}`,
        `checkpoint_overdue=${checkpointWorkflowOverdueCount}`,
        `accepted_unpublished=${acceptedUnpublished.length}`,
        `published=${publishRecords.items.length}`,
        `notifications=${notifications.items.length}`,
        `dispatches=${notificationDispatches.items.length}`,
        `templates=${governanceConfig.templates.length}`,
        `cross_goal_matches=${relatedCrossGoalPatterns.length}`,
      ].join(" | "),
      recommendations,
    };
  }

  private buildCommanderFocusSummary(
    goal: LongTermGoal,
    graph: GoalTaskGraph,
    plans: GoalCapabilityPlanState,
  ): GoalReviewGovernanceSummary["commanderFocus"] | undefined {
    const preferredNodeIds = [goal.activeNodeId, goal.lastNodeId]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    const focusPlan = preferredNodeIds
      .map((nodeId) => this.resolveCapabilityPlanForNode(plans, nodeId))
      .find((item) => item?.governanceMode === "commander")
      ?? plans.items
        .filter((item) => item.governanceMode === "commander")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!focusPlan) {
      return undefined;
    }
    const focusNode = graph.nodes.find((item) => item.id === focusPlan.nodeId);
    const gate = focusPlan.orchestration?.acceptanceGate;
    const reviewStatus = gate?.status ?? "pending";
    const finalApprovalMode = focusPlan.orchestration?.finalApprovalMode ?? "user_required";
    const nextAction = reviewStatus === "accepted"
      ? finalApprovalMode === "agent_auto_complete"
        ? "可由 Agent 自动收口到 done，或先进入 validating 再补充经验沉淀。"
        : "应进入 validating，并等待用户最终审批验收后再收口。"
      : reviewStatus === "rejected"
        ? "应根据失败分工或收口原因下发返工单。"
        : "继续等待子分工回传或补齐 fan-in 证据。";
    const checkLines = gate?.contractSpecificChecks?.length
      ? gate.contractSpecificChecks.map((item, index) => `${index + 1}. [${item.status}] ${item.label}${item.evidence ? ` | ${item.evidence}` : ""}`)
      : [];
    return {
      goalId: goal.id,
      nodeId: focusPlan.nodeId,
      runId: focusPlan.runId,
      planId: focusPlan.id,
      nodeTitle: focusNode?.title ?? focusPlan.nodeId,
      governanceMode: focusPlan.governanceMode,
      executionMode: focusPlan.executionMode,
      commanderAgentId: focusPlan.commanderAgentId ?? focusPlan.orchestration?.coordinationPlan?.managerAgentId,
      reviewStatus,
      finalApprovalMode,
      reworkRevisionCount: focusPlan.orchestration?.reworkRevisionCount ?? 0,
      lastReworkReason: focusPlan.orchestration?.lastReworkReason,
      lastReworkAt: focusPlan.orchestration?.lastReworkAt,
      reworkContext: focusPlan.orchestration?.reworkContext,
      fanInSummary: gate?.summary,
      managerActionHint: gate?.managerActionHint,
      reasons: gate?.reasons ?? [],
      delegationResults: (focusPlan.orchestration?.delegationResults ?? []).map((item) => ({
        agentId: item.agentId,
        role: item.role,
        status: item.status,
        summary: item.summary,
        taskId: item.taskId,
        outputPath: item.outputPath,
      })),
      checkLines,
      nextAction,
      reviewPath: this.getCommanderReviewPath(goal, focusPlan),
      commanderPlanPath: this.getCommanderPlanPath(goal, focusPlan),
      workOrderPaths: focusPlan.subAgents.map((subAgent) => this.getCommanderWorkOrderPath(goal, focusPlan, subAgent)),
    };
  }

  private async buildGoalLearningReviewRefreshFingerprint(goal: LongTermGoal): Promise<string> {
    const [graph, plans, checkpoints] = await Promise.all([
      readGoalTaskGraph(goal),
      readGoalCapabilityPlans(goal),
      readGoalCheckpoints(goal),
    ]);
    return buildGoalLearningReviewRefreshFingerprint({
      goal,
      nodes: graph.nodes,
      plans: plans.items,
      checkpoints: checkpoints.items,
    });
  }

  async scanSuggestionReviewWorkflows(
    goalId: string,
    input: GoalSuggestionReviewWorkflowScanInput = {},
  ): Promise<GoalSuggestionReviewWorkflowScanResult> {
    return this.withGoalMutationLock(goalId, () => this.scanSuggestionReviewWorkflowsUnlocked(goalId, input));
  }

  private async scanSuggestionReviewWorkflowsUnlocked(
    goalId: string,
    input: GoalSuggestionReviewWorkflowScanInput = {},
  ): Promise<GoalSuggestionReviewWorkflowScanResult> {
    const goal = await this.requireGoal(goalId);
    const reviews = await this.syncSuggestionReviews(goal);
    const scannedAt = input.now?.trim() || new Date().toISOString();
    const autoEscalate = input.autoEscalate === true;
    const items: GoalSuggestionReviewWorkflowScanItem[] = [];
    let mutated = false;
    let escalatedCount = 0;
    let overdueCount = 0;
    const nextReviewItems = reviews.items.map((review) => {
      const stage = this.getPendingSuggestionReviewWorkflowStage(review.workflow);
      if (!stage || !review.workflow) {
        return review;
      }
      const overdue = this.isSuggestionReviewWorkflowStageOverdue(stage, scannedAt);
      if (!overdue) {
        return review;
      }
      overdueCount += 1;
      let nextReview = review;
      let action: GoalSuggestionReviewWorkflowScanItem["action"] = "overdue";
      let escalated = false;
      const overdueMarkedReview = this.markSuggestionReviewWorkflowStageOverdue(nextReview, scannedAt);
      if (overdueMarkedReview !== nextReview) {
        nextReview = overdueMarkedReview;
        mutated = true;
      }
      if (autoEscalate) {
        const autoEscalatedReview = this.tryAutoEscalateSuggestionReview(nextReview, scannedAt);
        if (autoEscalatedReview !== nextReview) {
          nextReview = autoEscalatedReview;
          mutated = true;
          escalated = true;
          escalatedCount += 1;
          action = "auto_escalated";
        }
      }
      const workflow = nextReview.workflow ?? review.workflow;
      if (!workflow) {
        return nextReview;
      }
      const currentStage = this.getPendingSuggestionReviewWorkflowStage(workflow) ?? stage;
      const overdueMinutes = stage.slaAt
        ? Math.max(0, Math.floor((new Date(scannedAt).getTime() - new Date(stage.slaAt).getTime()) / (60 * 1000)))
        : undefined;
      items.push({
        goalId: goal.id,
        reviewId: nextReview.id,
        suggestionType: nextReview.suggestionType,
        suggestionId: nextReview.suggestionId,
        title: nextReview.title,
        nodeId: nextReview.nodeId,
        runId: nextReview.runId,
        workflowMode: workflow.mode,
        stageId: currentStage.id,
        stageTitle: currentStage.title,
        stageIndex: workflow.currentStageIndex,
        status: nextReview.status,
        reviewer: nextReview.reviewer,
        slaAt: stage.slaAt,
        overdue: true,
        overdueMinutes,
        escalated,
        action,
        escalatedTo: currentStage.escalation.escalatedTo,
        scannedAt,
      });
      return nextReview;
    });
    const nextReviews: GoalSuggestionReviewState = mutated
      ? { version: 1, syncedAt: scannedAt, items: nextReviewItems }
      : reviews;
    if (mutated) {
      await writeGoalSuggestionReviews(goal, nextReviews);
    }
    const updatedGoal = mutated ? await this.touchGoal(goal) : goal;
    if (items.length > 0) {
      await appendGoalProgressEntry(updatedGoal, {
        kind: "suggestion_review_scanned",
        title: "Suggestion review workflow scan",
        status: `overdue=${overdueCount} | escalated=${escalatedCount}`,
        summary: autoEscalate ? "SLA scan with auto escalation" : "SLA scan",
        note: items.slice(0, 3).map((item) => `${item.reviewId}:${item.action}`).join(" | "),
      });
      await this.emitGoalUpdate(updatedGoal, {
        reason: "suggestion_review_scanned",
        nodeId: items[0]?.nodeId,
        runId: items[0]?.runId,
      });
    }
    const recommendations = [
      overdueCount > 0 && escalatedCount === 0
        ? "存在已超 SLA 的 suggestion review，但当前未执行自动 escalation；建议补 reviewer 或手动升级。"
        : "",
      escalatedCount > 0
        ? `已自动升级 ${escalatedCount} 个 suggestion review，建议尽快由升级 reviewer 处理。`
        : "",
      overdueCount === 0
        ? "当前没有超 SLA 的 suggestion review workflow。"
        : "",
    ].filter(Boolean);
    let learningReview: GoalSuggestionReviewWorkflowScanResult["learningReview"];
    try {
      const governanceSummary = await this.getReviewGovernanceSummary(goalId);
      const refreshState = await readGoalLearningReviewRefreshState(updatedGoal);
      const refreshFingerprint = await this.buildGoalLearningReviewRefreshFingerprint(updatedGoal);
      learningReview = await runGoalReviewScanLearningReview({
        stateDir: this.stateDir,
        governanceSummary,
        refreshState,
        refreshFingerprint,
        generateSuggestions: () => this.generateExperienceSuggestions(goalId),
        syncReviews: () => this.syncSuggestionReviews(updatedGoal),
      });
      await writeGoalLearningReviewRefreshState(updatedGoal, {
        version: 1,
        lastScanAt: scannedAt,
        lastScanFingerprint: refreshFingerprint,
        lastRefreshAt: learningReview.refreshed ? scannedAt : refreshState.lastRefreshAt,
        lastRefreshFingerprint: learningReview.refreshed ? refreshFingerprint : refreshState.lastRefreshFingerprint,
        lastGeneratedAt: learningReview.generated ? (learningReview.generatedAt ?? scannedAt) : refreshState.lastGeneratedAt,
        lastOutcome: learningReview.outcome,
        lastReason: learningReview.recommendations[0] ?? refreshState.lastReason,
        lastPriority: learningReview.priorityKind ?? refreshState.lastPriority,
      });
    } catch (err) {
      console.warn("[GoalManager] Failed to run review-scan learning review:", err);
    }
    return {
      goal: updatedGoal,
      reviews: learningReview?.reviews ?? nextReviews,
      scannedAt,
      scannedCount: reviews.items.filter((item) => this.getPendingSuggestionReviewWorkflowStage(item.workflow)).length,
      overdueCount,
      escalatedCount,
      items,
      learningReview,
      summary: `scanned=${reviews.items.length} | overdue=${overdueCount} | escalated=${escalatedCount}`,
      recommendations,
    };
  }

  async configureSuggestionReviewWorkflow(goalId: string, input: GoalSuggestionReviewWorkflowConfigureInput): Promise<GoalSuggestionReviewMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const reviews = await this.syncSuggestionReviews(goal);
      const review = this.resolveSuggestionReview(reviews, input.reviewId, input.suggestionType, input.suggestionId);
      const governanceConfig = await readReviewGovernanceConfig(this.stateDir);
      const effectiveInput = this.resolveSuggestionReviewWorkflowInput(review, input, governanceConfig);
      const now = new Date().toISOString();
      const workflow = this.buildSuggestionReviewWorkflow(review, effectiveInput, now);
      const nextReview: GoalSuggestionReviewItem = {
        ...review,
        status: "pending_review",
        decidedBy: undefined,
        decidedAt: undefined,
        note: effectiveInput.note?.trim() || review.note,
        reviewer: this.getCurrentWorkflowReviewer(workflow) ?? review.reviewer,
        workflow,
        updatedAt: now,
      };
      const nextReviews: GoalSuggestionReviewState = {
        version: 1,
        syncedAt: now,
        items: reviews.items.map((item) => item.id === nextReview.id ? nextReview : item),
      };
      await writeGoalSuggestionReviews(goal, nextReviews);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: "suggestion_review_workflow_configured",
        title: nextReview.title,
        nodeId: nextReview.nodeId,
        status: `${workflow.mode}:${workflow.currentStageIndex + 1}/${workflow.stages.length}`,
        summary: `${workflow.mode} workflow configured`,
        note: nextReview.note,
        runId: nextReview.runId,
      });
      await this.emitGoalUpdate(updatedGoal, {
        reason: "suggestion_review_updated",
        nodeId: nextReview.nodeId,
        runId: nextReview.runId,
      });
      return { goal: updatedGoal, reviews: nextReviews, review: nextReview };
    });
  }

  async decideSuggestionReview(goalId: string, input: GoalSuggestionReviewDecisionInput): Promise<GoalSuggestionReviewMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const reviews = await this.syncSuggestionReviews(goal);
      const review = this.resolveSuggestionReview(reviews, input.reviewId, input.suggestionType, input.suggestionId);
      const now = new Date().toISOString();
      const nextReview = review.workflow
        ? this.applySuggestionReviewWorkflowDecision(review, input, now)
        : {
          ...review,
          status: input.decision,
          reviewer: input.reviewer?.trim() || review.reviewer,
          decidedBy: input.decidedBy?.trim() || review.decidedBy,
          note: input.note?.trim() || review.note,
          decidedAt: now,
          updatedAt: now,
        };
      const nextReviews: GoalSuggestionReviewState = {
        version: 1,
        syncedAt: now,
        items: reviews.items.map((item) => item.id === nextReview.id ? nextReview : item),
      };
      await writeGoalSuggestionReviews(goal, nextReviews);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: "suggestion_review_decided",
        title: nextReview.title,
        nodeId: nextReview.nodeId,
        status: nextReview.status,
        summary: nextReview.summary,
        note: nextReview.note,
        runId: nextReview.runId,
      });
      await this.emitGoalUpdate(updatedGoal, {
        reason: "suggestion_review_updated",
        nodeId: nextReview.nodeId,
        runId: nextReview.runId,
      });
      return { goal: updatedGoal, reviews: nextReviews, review: nextReview };
    });
  }

  async escalateSuggestionReview(goalId: string, input: GoalSuggestionReviewEscalateInput): Promise<GoalSuggestionReviewMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const reviews = await this.syncSuggestionReviews(goal);
      const review = this.resolveSuggestionReview(reviews, input.reviewId, input.suggestionType, input.suggestionId);
      const now = new Date().toISOString();
      const nextReview = this.applySuggestionReviewEscalation(review, input, now);
      const nextReviews: GoalSuggestionReviewState = {
        version: 1,
        syncedAt: now,
        items: reviews.items.map((item) => item.id === nextReview.id ? nextReview : item),
      };
      await writeGoalSuggestionReviews(goal, nextReviews);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: "suggestion_review_escalated",
        title: nextReview.title,
        nodeId: nextReview.nodeId,
        status: nextReview.workflow ? `${nextReview.workflow.mode}:${nextReview.workflow.currentStageIndex + 1}/${nextReview.workflow.stages.length}` : nextReview.status,
        summary: nextReview.summary,
        note: input.reason?.trim() || input.escalatedTo?.trim() || nextReview.note,
        runId: nextReview.runId,
      });
      await this.emitGoalUpdate(updatedGoal, {
        reason: "suggestion_review_updated",
        nodeId: nextReview.nodeId,
        runId: nextReview.runId,
      });
      return { goal: updatedGoal, reviews: nextReviews, review: nextReview };
    });
  }

  async publishSuggestion(goalId: string, input: GoalSuggestionPublishInput = {}): Promise<GoalSuggestionPublishMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const reviews = await this.syncSuggestionReviews(goal);
      const review = this.resolveSuggestionReview(reviews, input.reviewId, input.suggestionType, input.suggestionId);
      if (review.status !== "accepted") {
        throw new Error(`Suggestion review "${review.id}" must be accepted before publishing. Current status: ${review.status}.`);
      }
      if (review.suggestionType === "flow_pattern") {
        throw new Error("Flow pattern suggestions are not publishable in Phase 6 P6-2.");
      }

      const records = await readGoalPublishRecords(goal);
      const existing = records.items.find((item) => item.reviewId === review.id);
      if (existing) {
        return { goal, review, record: existing, records };
      }

      const publishRecord = await this.recoverPublishedSuggestionRecord(goal, review, input)
        ?? (review.suggestionType === "method_candidate"
          ? await this.publishMethodSuggestion(goal, review, new Date().toISOString(), input)
          : await this.publishSkillSuggestion(goal, review, new Date().toISOString(), input));
      const syncedCandidate = await this.syncPublishedSuggestionToExperienceCandidate(goal, review, publishRecord);
      if (syncedCandidate) {
        publishRecord.experienceCandidateId = syncedCandidate.id;
      }
      const nextRecords: GoalSuggestionPublishState = {
        version: 1,
        items: [...records.items, publishRecord].sort((left, right) => left.publishedAt.localeCompare(right.publishedAt)),
      };
      await writeGoalPublishRecords(goal, nextRecords);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: "suggestion_published",
        title: publishRecord.title,
        nodeId: publishRecord.nodeId,
        status: publishRecord.assetType,
        summary: `${publishRecord.suggestionType} -> ${publishRecord.assetType}`,
        note: publishRecord.publishedPath,
        runId: publishRecord.runId,
      });
      await this.emitGoalUpdate(updatedGoal, {
        reason: "suggestion_published",
        nodeId: publishRecord.nodeId,
        runId: publishRecord.runId,
      });
      return { goal: updatedGoal, review, record: publishRecord, records: nextRecords };
    });
  }

  async listCapabilityPlans(goalId: string): Promise<GoalCapabilityPlanState> {
    const goal = await this.requireGoal(goalId);
    return readGoalCapabilityPlans(goal);
  }

  async getCapabilityPlan(goalId: string, nodeId: string): Promise<GoalCapabilityPlan | null> {
    const goal = await this.requireGoal(goalId);
    const plans = await readGoalCapabilityPlans(goal);
    return this.resolveCapabilityPlanForNode(plans, nodeId);
  }

  async saveCapabilityPlan(goalId: string, nodeId: string, input: GoalCapabilityPlanSaveInput): Promise<GoalCapabilityPlan> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Task node not found: ${nodeId}`);
      }

      const plans = await readGoalCapabilityPlans(goal);
      const existing = input.id
        ? plans.items.find((item) => item.id === input.id)
        : this.resolveCapabilityPlanForNode(plans, nodeId);
      const now = new Date().toISOString();
      const status = input.status ?? existing?.status ?? "planned";
      const governanceMode = input.governanceMode ?? existing?.governanceMode ?? "direct";
      const riskLevel = input.riskLevel ?? existing?.riskLevel ?? "low";
      const subAgents = input.subAgents ?? existing?.subAgents ?? [];
      const checkpoint = input.checkpoint ?? existing?.checkpoint ?? {
        required: false,
        reasons: [],
        approvalMode: "none",
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none",
      };
      const orchestration = enrichGoalCapabilityPlanOrchestration({
        status,
        executionMode: input.executionMode,
        subAgents,
        orchestration: input.orchestration ?? existing?.orchestration,
      });
      const defaultFinalApprovalMode = governanceMode === "commander"
        ? riskLevel === "low" && !checkpoint.required ? "agent_auto_complete" : "user_required"
        : undefined;
      const nextPlanBase: GoalCapabilityPlan = {
        id: existing?.id ?? (input.id?.trim() || `plan_${crypto.randomUUID().slice(0, 8)}`),
        goalId: goal.id,
        nodeId,
        runId: input.runId?.trim() || existing?.runId || node.lastRunId,
        status,
        executionMode: input.executionMode,
        governanceMode,
        commanderAgentId: input.commanderAgentId?.trim() || existing?.commanderAgentId,
        preferredAgents: input.preferredAgents?.map((item) => item.trim()).filter(Boolean) ?? existing?.preferredAgents ?? [],
        riskLevel,
        objective: input.objective.trim(),
        summary: input.summary.trim(),
        queryHints: input.queryHints?.map((item) => item.trim()).filter(Boolean) ?? existing?.queryHints ?? [],
        reasoning: input.reasoning?.map((item) => item.trim()).filter(Boolean) ?? existing?.reasoning ?? [],
        methods: input.methods ?? existing?.methods ?? [],
        skills: input.skills ?? existing?.skills ?? [],
        mcpServers: input.mcpServers ?? existing?.mcpServers ?? [],
        subAgents,
        gaps: input.gaps?.map((item) => item.trim()).filter(Boolean) ?? existing?.gaps ?? [],
        checkpoint,
        actualUsage: input.actualUsage ?? existing?.actualUsage ?? { methods: [], skills: [], mcpServers: [], toolNames: [] },
        analysis: existing?.analysis ?? getDefaultCapabilityPlanAnalysis(),
        generatedAt: existing?.generatedAt ?? now,
        updatedAt: now,
        orchestratedAt: input.orchestratedAt ?? existing?.orchestratedAt,
        orchestration: orchestration
          ? {
            ...orchestration,
            finalApprovalMode: orchestration.finalApprovalMode ?? defaultFinalApprovalMode,
          }
          : defaultFinalApprovalMode
            ? { finalApprovalMode: defaultFinalApprovalMode }
            : undefined,
      };
      const nextPlan: GoalCapabilityPlan = {
        ...nextPlanBase,
        analysis: analyzeGoalCapabilityPlan(nextPlanBase),
      };
      const nextPlans: GoalCapabilityPlanState = {
        version: 1,
        items: [
          ...plans.items.filter((item) => item.id !== nextPlan.id),
          nextPlan,
        ].sort((left, right) => left.nodeId.localeCompare(right.nodeId, "zh-CN") || left.generatedAt.localeCompare(right.generatedAt)),
      };
      await writeGoalCapabilityPlans(goal, nextPlans);
      await this.persistCommanderGovernanceArtifacts(goal, nextPlan, node);
      const updatedGoal = await this.touchGoal(goal);
      await appendGoalProgressEntry(updatedGoal, {
        kind: nextPlan.status === "orchestrated" ? "node_orchestrated" : "capability_plan_generated",
        title: node.title,
        nodeId,
        status: nextPlan.status,
        summary: nextPlan.summary,
        note: nextPlan.executionMode === "multi_agent" || nextPlan.executionMode === "multi_agent_parallel" || nextPlan.executionMode === "multi_agent_sequential"
          ? `execution=${nextPlan.executionMode}; governance=${nextPlan.governanceMode}; subAgents=${nextPlan.subAgents.length}; gaps=${nextPlan.gaps.length}`
          : `execution=${nextPlan.executionMode}; governance=${nextPlan.governanceMode}; methods=${nextPlan.methods.length}; skills=${nextPlan.skills.length}`,
        runId: nextPlan.runId,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: nextPlan.status === "orchestrated" ? "capability_plan_orchestrated" : "capability_plan_saved",
        nodeId,
        runId: nextPlan.runId,
      });
      return nextPlan;
    });
  }

  async generateHandoff(goalId: string): Promise<GoalHandoffGenerateResult> {
    const goal = await this.requireGoal(goalId);
    const result = await this.persistHandoff(goal);
    await appendGoalProgressEntry(goal, {
      kind: "handoff_generated",
      title: goal.title,
      nodeId: result.handoff.recommendedNodeId,
      status: result.handoff.resumeMode,
      summary: result.handoff.summary,
      note: result.handoff.nextAction,
      runId: result.handoff.lastRunId,
    });
    return result;
  }

  async getHandoff(goalId: string): Promise<GoalHandoffReadResult> {
    const goal = await this.requireGoal(goalId);
    return this.buildHandoff(goal);
  }

  private async readProgressContent(goal: LongTermGoal): Promise<string> {
    return fs.readFile(goal.progressPath, "utf-8").catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") return "";
      throw err;
    });
  }

  private async buildRetrospective(goal: LongTermGoal): Promise<GoalRetrospectiveGenerateResult> {
    const [runtime, graph, checkpoints, plansState, progressContent] = await Promise.all([
      readGoalRuntime(goal),
      readGoalTaskGraph(goal),
      readGoalCheckpoints(goal),
      readGoalCapabilityPlans(goal),
      this.readProgressContent(goal),
    ]);
    const bridgeGovernanceSummary = await loadGoalHandoffBridgeGovernanceSummary({
      stateDir: this.stateDir,
      graph,
    });
    const handoff = buildGoalHandoffResult({
      goal,
      runtime,
      graph,
      checkpoints,
      plans: plansState.items,
      progressContent,
      bridgeGovernanceSummary,
    });
    return generateGoalRetrospective({
      goal,
      graph,
      checkpoints,
      plans: plansState.items,
      progressContent,
      handoff: handoff.handoff,
    });
  }

  private async buildMethodCandidates(
    goal: LongTermGoal,
    retrospective: GoalRetrospectiveGenerateResult["retrospective"],
  ): Promise<GoalMethodCandidateGenerateResult> {
    const [graph, plansState, progressContent] = await Promise.all([
      readGoalTaskGraph(goal),
      readGoalCapabilityPlans(goal),
      this.readProgressContent(goal),
    ]);
    return generateGoalMethodCandidates({
      stateDir: this.stateDir,
      goal,
      graph,
      plans: plansState.items,
      progressContent,
      retrospective,
    });
  }

  private async buildSkillCandidates(
    goal: LongTermGoal,
    retrospective: GoalRetrospectiveGenerateResult["retrospective"],
  ): Promise<GoalSkillCandidateGenerateResult> {
    const plansState = await readGoalCapabilityPlans(goal);
    return generateGoalSkillCandidates({
      stateDir: this.stateDir,
      goal,
      plans: plansState.items,
      retrospective,
    });
  }

  private async buildFlowPatterns(
    goal: LongTermGoal,
    retrospective: GoalRetrospectiveGenerateResult["retrospective"],
  ): Promise<GoalFlowPatternGenerateResult> {
    const [graph, plansState, progressContent] = await Promise.all([
      readGoalTaskGraph(goal),
      readGoalCapabilityPlans(goal),
      this.readProgressContent(goal),
    ]);
    return generateGoalFlowPatterns({
      goal,
      graph,
      plans: plansState.items,
      progressContent,
      retrospective,
    });
  }

  async generateRetrospective(goalId: string): Promise<GoalRetrospectiveGenerateResult> {
    const goal = await this.requireGoal(goalId);
    const result = await this.buildRetrospective(goal);
    await appendGoalProgressEntry(goal, {
      kind: "retrospective_generated",
      title: goal.title,
      nodeId: goal.activeNodeId ?? goal.lastNodeId,
      status: result.retrospective.outcome,
      summary: result.retrospective.summary,
      note: result.retrospective.nextFocus,
      runId: goal.lastRunId,
    });
    return result;
  }

  async generateMethodCandidates(goalId: string): Promise<GoalMethodCandidateGenerateResult> {
    const goal = await this.requireGoal(goalId);
    const retrospectiveResult = await this.buildRetrospective(goal);
    const result = await this.buildMethodCandidates(goal, retrospectiveResult.retrospective);
    await appendGoalProgressEntry(goal, {
      kind: "method_candidates_generated",
      title: goal.title,
      nodeId: goal.activeNodeId ?? goal.lastNodeId,
      status: String(result.candidates.length),
      summary: `生成 ${result.candidates.length} 条 method candidate 建议。`,
      note: result.markdownPath,
      runId: goal.lastRunId,
    });
    return result;
  }

  async generateSkillCandidates(goalId: string): Promise<GoalSkillCandidateGenerateResult> {
    const goal = await this.requireGoal(goalId);
    const retrospectiveResult = await this.buildRetrospective(goal);
    const result = await this.buildSkillCandidates(goal, retrospectiveResult.retrospective);
    await appendGoalProgressEntry(goal, {
      kind: "skill_candidates_generated",
      title: goal.title,
      nodeId: goal.activeNodeId ?? goal.lastNodeId,
      status: String(result.candidates.length),
      summary: `生成 ${result.candidates.length} 条 skill candidate 建议。`,
      note: result.markdownPath,
      runId: goal.lastRunId,
    });
    return result;
  }

  async generateFlowPatterns(goalId: string): Promise<GoalFlowPatternGenerateResult> {
    const goal = await this.requireGoal(goalId);
    const retrospectiveResult = await this.buildRetrospective(goal);
    const result = await this.buildFlowPatterns(goal, retrospectiveResult.retrospective);
    await appendGoalProgressEntry(goal, {
      kind: "flow_patterns_generated",
      title: goal.title,
      nodeId: goal.activeNodeId ?? goal.lastNodeId,
      status: String(result.patterns.length),
      summary: `生成 ${result.patterns.length} 条 flow pattern 摘要。`,
      note: result.markdownPath,
      runId: goal.lastRunId,
    });
    return result;
  }

  async generateCrossGoalFlowPatterns(): Promise<GoalCrossFlowPatternGenerateResult> {
    const goals = await listGoalRegistryEntries(this.stateDir);
    const goalPatterns = await Promise.all(
      goals.map(async (goal) => ({
        goal,
        patterns: (await readGoalFlowPatterns(goal)).items,
      })),
    );
    return generateCrossGoalFlowPatterns({
      stateDir: this.stateDir,
      goals: goalPatterns.filter((item) => item.patterns.length > 0),
    });
  }

  async generateExperienceSuggestions(goalId: string): Promise<GoalExperienceSuggestResult> {
    const goal = await this.requireGoal(goalId);
    const retrospectiveResult = await this.buildRetrospective(goal);
    const [methodCandidatesResult, skillCandidatesResult, flowPatternsResult] = await Promise.all([
      this.buildMethodCandidates(goal, retrospectiveResult.retrospective),
      this.buildSkillCandidates(goal, retrospectiveResult.retrospective),
      this.buildFlowPatterns(goal, retrospectiveResult.retrospective),
    ]);
    const recommendations = [
      ...retrospectiveResult.retrospective.recommendations.slice(0, 2),
      methodCandidatesResult.candidates[0] ? `优先审阅 method candidate：${methodCandidatesResult.candidates[0].title}` : "",
      skillCandidatesResult.candidates[0] ? `优先审阅 skill candidate：${skillCandidatesResult.candidates[0].title}` : "",
      flowPatternsResult.patterns[0] ? `优先观察高频流程：${flowPatternsResult.patterns[0].summary}` : "",
    ]
      .map((item) => item.trim())
      .filter(Boolean);
    const result: GoalExperienceSuggestResult = {
      goal,
      generatedAt: new Date().toISOString(),
      retrospective: retrospectiveResult.retrospective,
      methodCandidates: {
        count: methodCandidatesResult.candidates.length,
        items: methodCandidatesResult.candidates,
        markdownPath: methodCandidatesResult.markdownPath,
        jsonPath: methodCandidatesResult.jsonPath,
      },
      skillCandidates: {
        count: skillCandidatesResult.candidates.length,
        items: skillCandidatesResult.candidates,
        markdownPath: skillCandidatesResult.markdownPath,
        jsonPath: skillCandidatesResult.jsonPath,
      },
      flowPatterns: {
        count: flowPatternsResult.patterns.length,
        items: flowPatternsResult.patterns,
        markdownPath: flowPatternsResult.markdownPath,
        jsonPath: flowPatternsResult.jsonPath,
      },
      summary: [
        retrospectiveResult.retrospective.summary,
        `method=${methodCandidatesResult.candidates.length}`,
        `skill=${skillCandidatesResult.candidates.length}`,
        `flow=${flowPatternsResult.patterns.length}`,
      ].join(" | "),
      recommendations,
    };
    await appendGoalProgressEntry(goal, {
      kind: "experience_suggestions_generated",
      title: goal.title,
      nodeId: goal.activeNodeId ?? goal.lastNodeId,
      status: `method=${result.methodCandidates.count}; skill=${result.skillCandidates.count}; flow=${result.flowPatterns.count}`,
      summary: result.summary,
      note: result.recommendations[0],
      runId: goal.lastRunId,
    });
    return result;
  }

  async requestCheckpoint(goalId: string, nodeId: string, input: GoalCheckpointRequestInput = {}): Promise<GoalCheckpointMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const currentNode = graph.nodes.find((node) => node.id === nodeId);
      if (!currentNode) {
        throw new Error(`Task node not found: ${nodeId}`);
      }
      if (!currentNode.checkpointRequired) {
        throw new Error(`Task node "${nodeId}" does not require a checkpoint.`);
      }

      const checkpoints = await readGoalCheckpoints(goal);
      const plans = await readGoalCapabilityPlans(goal);
      const governanceConfig = await readReviewGovernanceConfig(this.stateDir);
      const existingOpen = checkpoints.items.find((item) => item.nodeId === nodeId && (item.status === "required" || item.status === "waiting_user"));
      if (existingOpen) {
        throw new Error(`Task node "${nodeId}" already has a pending checkpoint: ${existingOpen.id}`);
      }
      const policy = this.resolveCheckpointPolicyForNode(plans, nodeId, currentNode.checkpointRequired, governanceConfig);
      const context = this.resolveCheckpointContext(input);
      this.assertCheckpointRequestPolicy(policy, {
        summary: input.summary?.trim(),
        note: input.note?.trim(),
        reviewer: context.reviewer,
        reviewerRole: context.reviewerRole,
        requestedBy: context.requestedBy,
        slaAt: context.slaAt,
      });

      const requestedNode = transitionGoalTaskNode(graph, nodeId, "pending_review", {
        summary: input.summary,
        checkpointStatus: "waiting_user",
        runId: input.runId,
      });
      const savedGraph = await writeGoalTaskGraph(goal, requestedNode.graph);
      const now = new Date().toISOString();
      const checkpoint: GoalCheckpointItem = {
        id: `checkpoint_${crypto.randomUUID().slice(0, 8)}`,
        goalId: goal.id,
        nodeId,
        runId: input.runId?.trim() || requestedNode.node.lastRunId,
        status: "waiting_user",
        title: input.title?.trim() || `${requestedNode.node.title} checkpoint`,
        summary: input.summary?.trim() || requestedNode.node.summary,
        note: input.note?.trim() || undefined,
        reviewer: context.reviewer,
        reviewerRole: context.reviewerRole,
        requestedBy: context.requestedBy,
        decidedBy: undefined,
        slaAt: context.slaAt,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
        policy,
        workflow: undefined,
        history: [{
          action: "requested",
          status: "waiting_user",
          at: now,
          summary: input.summary?.trim() || requestedNode.node.summary,
          note: input.note?.trim() || undefined,
          actor: context.requestedBy,
          reviewer: context.reviewer,
          reviewerRole: context.reviewerRole,
          requestedBy: context.requestedBy,
          slaAt: context.slaAt,
          runId: input.runId?.trim() || requestedNode.node.lastRunId,
        }],
      };
      checkpoint.workflow = this.buildCheckpointWorkflow(checkpoint, policy, now);
      checkpoint.reviewer = checkpoint.workflow
        ? this.getCurrentWorkflowReviewer(checkpoint.workflow) ?? checkpoint.reviewer
        : checkpoint.reviewer;
      const nextCheckpoints: GoalCheckpointState = {
        version: 2,
        items: [...checkpoints.items, checkpoint],
      };
      await writeGoalCheckpoints(goal, nextCheckpoints);
      const updatedGoal = await this.touchGoal(goal, {
        status: "pending_approval",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: checkpoint.runId ?? goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "checkpoint_requested",
        title: checkpoint.title,
        nodeId,
        status: checkpoint.status,
        summary: checkpoint.summary,
        note: checkpoint.note,
        runId: checkpoint.runId,
        checkpointId: checkpoint.id,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "checkpoint_requested",
        nodeId,
        checkpointId: checkpoint.id,
        runId: checkpoint.runId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: requestedNode.node, checkpoints: nextCheckpoints, checkpoint };
    });
  }

  async approveCheckpoint(goalId: string, nodeId: string, input: GoalCheckpointDecisionInput = {}): Promise<GoalCheckpointMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const checkpoints = await readGoalCheckpoints(goal);
      const checkpoint = this.resolveCheckpointForDecision(checkpoints, nodeId, input.checkpointId);
      if (checkpoint.status !== "required" && checkpoint.status !== "waiting_user") {
        throw new Error(`Checkpoint "${checkpoint.id}" is not awaiting approval.`);
      }

      const now = new Date().toISOString();
      const context = this.resolveCheckpointContext(input, checkpoint);
      this.assertCheckpointDecisionPolicy(checkpoint.policy, {
        summary: input.summary?.trim() || checkpoint.summary,
        note: input.note?.trim() || checkpoint.note,
        decidedBy: context.decidedBy,
      }, "approve");
      const nextCheckpoint = checkpoint.workflow
        ? this.applyCheckpointWorkflowDecision(checkpoint, input, context, "accepted", now)
        : this.applyCheckpointTerminalDecision(checkpoint, input, context, "approved", "approved", now);
      const approvedNode = transitionGoalTaskNode(
        graph,
        nodeId,
        nextCheckpoint.status === "approved" ? "validating" : "pending_review",
        {
          summary: input.summary,
          checkpointStatus: nextCheckpoint.status === "approved" ? "approved" : "waiting_user",
          runId: input.runId,
        },
      );
      const savedGraph = await writeGoalTaskGraph(goal, approvedNode.graph);
      const nextCheckpoints = this.replaceCheckpoint(checkpoints, nextCheckpoint);
      await writeGoalCheckpoints(goal, nextCheckpoints);
      const updatedGoal = await this.touchGoal(goal, {
        status: nextCheckpoint.status === "approved" ? "reviewing" : "pending_approval",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: nextCheckpoint.runId ?? goal.lastRunId,
      });
      if (nextCheckpoint.status === "approved") {
        await appendGoalProgressEntry(updatedGoal, {
          kind: "checkpoint_approved",
          title: nextCheckpoint.title,
          nodeId,
          status: nextCheckpoint.status,
          summary: nextCheckpoint.summary,
          note: nextCheckpoint.note,
          runId: nextCheckpoint.runId,
          checkpointId: nextCheckpoint.id,
        });
      }
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: nextCheckpoint.status === "approved" ? "checkpoint_approved" : "checkpoint_requested",
        nodeId,
        checkpointId: nextCheckpoint.id,
        runId: nextCheckpoint.runId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: approvedNode.node, checkpoints: nextCheckpoints, checkpoint: nextCheckpoint };
    });
  }

  async rejectCheckpoint(goalId: string, nodeId: string, input: GoalCheckpointDecisionInput = {}): Promise<GoalCheckpointMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const checkpoints = await readGoalCheckpoints(goal);
      const checkpoint = this.resolveCheckpointForDecision(checkpoints, nodeId, input.checkpointId);
      if (checkpoint.status !== "required" && checkpoint.status !== "waiting_user") {
        throw new Error(`Checkpoint "${checkpoint.id}" is not awaiting approval.`);
      }

      const rejectNote = input.note?.trim() || "Checkpoint rejected";
      const now = new Date().toISOString();
      const context = this.resolveCheckpointContext(input, checkpoint);
      this.assertCheckpointDecisionPolicy(checkpoint.policy, {
        summary: input.summary?.trim() || checkpoint.summary,
        note: rejectNote,
        decidedBy: context.decidedBy,
      }, "reject");
      const nextCheckpoint = checkpoint.workflow
        ? this.applyCheckpointWorkflowDecision(checkpoint, { ...input, note: rejectNote }, context, "rejected", now)
        : this.applyCheckpointTerminalDecision(checkpoint, { ...input, note: rejectNote }, context, "rejected", "rejected", now);
      const rejectedNode = transitionGoalTaskNode(
        graph,
        nodeId,
        nextCheckpoint.status === "rejected" ? "blocked" : "pending_review",
        {
          summary: input.summary,
          blockReason: nextCheckpoint.status === "rejected" ? rejectNote : undefined,
          checkpointStatus: nextCheckpoint.status === "rejected" ? "rejected" : "waiting_user",
          runId: input.runId,
        },
      );
      const savedGraph = await writeGoalTaskGraph(goal, rejectedNode.graph);
      const nextCheckpoints = this.replaceCheckpoint(checkpoints, nextCheckpoint);
      await writeGoalCheckpoints(goal, nextCheckpoints);
      const updatedGoal = await this.touchGoal(goal, {
        status: nextCheckpoint.status === "rejected" ? "blocked" : "pending_approval",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: nextCheckpoint.runId ?? goal.lastRunId,
      });
      if (nextCheckpoint.status === "rejected") {
        await appendGoalProgressEntry(updatedGoal, {
          kind: "checkpoint_rejected",
          title: nextCheckpoint.title,
          nodeId,
          status: nextCheckpoint.status,
          summary: nextCheckpoint.summary,
          note: nextCheckpoint.note,
          runId: nextCheckpoint.runId,
          checkpointId: nextCheckpoint.id,
        });
      }
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: nextCheckpoint.status === "rejected" ? "checkpoint_rejected" : "checkpoint_requested",
        nodeId,
        checkpointId: nextCheckpoint.id,
        runId: nextCheckpoint.runId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: rejectedNode.node, checkpoints: nextCheckpoints, checkpoint: nextCheckpoint };
    });
  }

  async expireCheckpoint(goalId: string, nodeId: string, input: GoalCheckpointDecisionInput = {}): Promise<GoalCheckpointMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const checkpoints = await readGoalCheckpoints(goal);
      const checkpoint = this.resolveCheckpointForDecision(checkpoints, nodeId, input.checkpointId);
      if (checkpoint.status !== "required" && checkpoint.status !== "waiting_user") {
        throw new Error(`Checkpoint "${checkpoint.id}" is not active and cannot expire.`);
      }

      const expireNote = input.note?.trim() || "Checkpoint expired";
      const expiredNode = transitionGoalTaskNode(graph, nodeId, "blocked", {
        summary: input.summary,
        blockReason: expireNote,
        checkpointStatus: "expired",
        runId: input.runId,
      });
      const savedGraph = await writeGoalTaskGraph(goal, expiredNode.graph);
      const now = new Date().toISOString();
      const context = this.resolveCheckpointContext(input, checkpoint);
      this.assertCheckpointDecisionPolicy(checkpoint.policy, {
        summary: input.summary?.trim() || checkpoint.summary,
        note: expireNote,
        decidedBy: context.decidedBy,
      }, "expire");
      const nextCheckpoint: GoalCheckpointItem = {
        ...checkpoint,
        status: "expired",
        summary: input.summary?.trim() || checkpoint.summary,
        note: expireNote,
        reviewer: context.reviewer,
        reviewerRole: context.reviewerRole,
        requestedBy: context.requestedBy,
        decidedBy: context.decidedBy,
        slaAt: context.slaAt,
        decidedAt: now,
        updatedAt: now,
        runId: input.runId?.trim() || checkpoint.runId,
        history: this.appendCheckpointHistory(checkpoint, {
          action: "expired",
          status: "expired",
          at: now,
          summary: input.summary?.trim() || checkpoint.summary,
          note: expireNote,
          actor: context.decidedBy,
          reviewer: context.reviewer,
          reviewerRole: context.reviewerRole,
          requestedBy: context.requestedBy,
          decidedBy: context.decidedBy,
          slaAt: context.slaAt,
          runId: input.runId?.trim() || checkpoint.runId,
        }),
      };
      const nextCheckpoints = this.replaceCheckpoint(checkpoints, nextCheckpoint);
      await writeGoalCheckpoints(goal, nextCheckpoints);
      const updatedGoal = await this.touchGoal(goal, {
        status: "blocked",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: nextCheckpoint.runId ?? goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "checkpoint_expired",
        title: nextCheckpoint.title,
        nodeId,
        status: nextCheckpoint.status,
        summary: nextCheckpoint.summary,
        note: nextCheckpoint.note,
        runId: nextCheckpoint.runId,
        checkpointId: nextCheckpoint.id,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "checkpoint_expired",
        nodeId,
        checkpointId: nextCheckpoint.id,
        runId: nextCheckpoint.runId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: expiredNode.node, checkpoints: nextCheckpoints, checkpoint: nextCheckpoint };
    });
  }

  async reopenCheckpoint(goalId: string, nodeId: string, input: GoalCheckpointDecisionInput = {}): Promise<GoalCheckpointMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const checkpoints = await readGoalCheckpoints(goal);
      const plans = await readGoalCapabilityPlans(goal);
      const governanceConfig = await readReviewGovernanceConfig(this.stateDir);
      const checkpoint = this.resolveCheckpointForDecision(checkpoints, nodeId, input.checkpointId);
      if (checkpoint.status !== "rejected" && checkpoint.status !== "expired") {
        throw new Error(`Checkpoint "${checkpoint.id}" is not rejected/expired and cannot reopen.`);
      }

      const reopenedNode = transitionGoalTaskNode(graph, nodeId, "pending_review", {
        summary: input.summary,
        checkpointStatus: "waiting_user",
        runId: input.runId,
      });
      const savedGraph = await writeGoalTaskGraph(goal, reopenedNode.graph);
      const now = new Date().toISOString();
      const context = this.resolveCheckpointContext(input, checkpoint, { clearDecidedBy: true });
      const policy = this.resolveCheckpointPolicyForNode(plans, nodeId, true, governanceConfig, checkpoint.policy);
      this.assertCheckpointRequestPolicy(policy, {
        summary: input.summary?.trim() || checkpoint.summary,
        note: input.note?.trim() || checkpoint.note,
        reviewer: context.reviewer,
        reviewerRole: context.reviewerRole,
        requestedBy: context.requestedBy,
        slaAt: context.slaAt,
      }, "reopen");
      const nextCheckpoint: GoalCheckpointItem = {
        ...checkpoint,
        status: "waiting_user",
        summary: input.summary?.trim() || checkpoint.summary,
        note: input.note?.trim() || checkpoint.note,
        reviewer: context.reviewer,
        reviewerRole: context.reviewerRole,
        requestedBy: context.requestedBy,
        decidedBy: undefined,
        slaAt: context.slaAt,
        requestedAt: now,
        decidedAt: undefined,
        updatedAt: now,
        runId: input.runId?.trim() || checkpoint.runId,
        policy,
        workflow: undefined,
        history: this.appendCheckpointHistory(checkpoint, {
          action: "reopened",
          status: "waiting_user",
          at: now,
          summary: input.summary?.trim() || checkpoint.summary,
          note: input.note?.trim() || checkpoint.note,
          actor: context.requestedBy ?? context.decidedBy,
          reviewer: context.reviewer,
          reviewerRole: context.reviewerRole,
          requestedBy: context.requestedBy,
          slaAt: context.slaAt,
          runId: input.runId?.trim() || checkpoint.runId,
        }),
      };
      nextCheckpoint.workflow = this.buildCheckpointWorkflow(nextCheckpoint, policy, now);
      nextCheckpoint.reviewer = nextCheckpoint.workflow
        ? this.getCurrentWorkflowReviewer(nextCheckpoint.workflow) ?? nextCheckpoint.reviewer
        : nextCheckpoint.reviewer;
      const nextCheckpoints = this.replaceCheckpoint(checkpoints, nextCheckpoint);
      await writeGoalCheckpoints(goal, nextCheckpoints);
      const updatedGoal = await this.touchGoal(goal, {
        status: "pending_approval",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: nextCheckpoint.runId ?? goal.lastRunId,
      });
      await appendGoalProgressEntry(updatedGoal, {
        kind: "checkpoint_reopened",
        title: nextCheckpoint.title,
        nodeId,
        status: nextCheckpoint.status,
        summary: nextCheckpoint.summary,
        note: nextCheckpoint.note,
        runId: nextCheckpoint.runId,
        checkpointId: nextCheckpoint.id,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "checkpoint_reopened",
        nodeId,
        checkpointId: nextCheckpoint.id,
        runId: nextCheckpoint.runId,
      });
      return { goal: updatedGoal, graph: savedGraph, node: reopenedNode.node, checkpoints: nextCheckpoints, checkpoint: nextCheckpoint };
    });
  }

  async escalateCheckpoint(goalId: string, nodeId: string, input: GoalCheckpointEscalateInput = {}): Promise<GoalCheckpointMutationResult> {
    return this.withGoalMutationLock(goalId, async () => {
      const goal = await this.requireGoal(goalId);
      const graph = await readGoalTaskGraph(goal);
      const checkpoints = await readGoalCheckpoints(goal);
      const checkpoint = this.resolveCheckpointForDecision(checkpoints, nodeId, input.checkpointId);
      if (checkpoint.status !== "required" && checkpoint.status !== "waiting_user") {
        throw new Error(`Checkpoint "${checkpoint.id}" is not active and cannot escalate.`);
      }
      const now = new Date().toISOString();
      const nextCheckpoint = this.applyCheckpointWorkflowEscalation(checkpoint, input, now);
      const nextCheckpoints = this.replaceCheckpoint(checkpoints, nextCheckpoint);
      await writeGoalCheckpoints(goal, nextCheckpoints);
      const updatedGoal = await this.touchGoal(goal, {
        status: "pending_approval",
        activeNodeId: nodeId,
        lastNodeId: nodeId,
        lastRunId: nextCheckpoint.runId ?? goal.lastRunId,
      });
      await this.refreshHandoffAfterMutation(updatedGoal);
      await this.emitGoalUpdate(updatedGoal, {
        reason: "checkpoint_requested",
        nodeId,
        checkpointId: nextCheckpoint.id,
        runId: nextCheckpoint.runId,
      });
      return { goal: updatedGoal, graph, node: graph.nodes.find((item) => item.id === nodeId) ?? this.resolveTaskNode(graph, nodeId), checkpoints: nextCheckpoints, checkpoint: nextCheckpoint };
    });
  }

  async scanApprovalWorkflows(
    goalId: string,
    input: GoalSuggestionReviewWorkflowScanInput = {},
  ): Promise<GoalApprovalWorkflowScanResult> {
    return this.withGoalMutationLock(goalId, () => this.scanApprovalWorkflowsUnlocked(goalId, input));
  }

  private async scanApprovalWorkflowsUnlocked(
    goalId: string,
    input: GoalSuggestionReviewWorkflowScanInput = {},
  ): Promise<GoalApprovalWorkflowScanResult> {
    const goal = await this.requireGoal(goalId);
    const governanceConfig = await readReviewGovernanceConfig(this.stateDir);
    const reviewResult = await this.scanSuggestionReviewWorkflowsUnlocked(goalId, input);
    const checkpoints = await readGoalCheckpoints(goal);
    const existingNotifications = await readGoalReviewNotifications(goal);
    const existingDispatches = await readGoalReviewNotificationDispatches(goal);
    const scannedAt = input.now?.trim() || new Date().toISOString();
    const checkpointScan = this.scanCheckpointApprovalWorkflows(checkpoints.items, scannedAt, Boolean(input.autoEscalate));
    if (checkpointScan.mutated) {
      await writeGoalCheckpoints(goal, {
        version: checkpoints.version,
        items: checkpointScan.items,
      });
    }
    const notifications = this.collectApprovalNotifications(
      goal,
      governanceConfig,
      reviewResult.reviews.items,
      checkpointScan.items,
      existingNotifications,
      reviewResult.items,
      checkpointScan.scanItems,
      scannedAt,
    );
    if (!isDeepStrictEqual(notifications.state, existingNotifications)) {
      await writeGoalReviewNotifications(goal, notifications.state);
    }
    const dispatches = this.materializeNotificationDispatches(
      goal,
      governanceConfig,
      existingDispatches,
      notifications.state.items,
      scannedAt,
    );
    if (!isDeepStrictEqual(dispatches.state, existingDispatches)) {
      await writeGoalReviewNotificationDispatches(goal, dispatches.state);
    }
    const updatedGoal = checkpointScan.mutated ? await this.touchGoal(reviewResult.goal) : reviewResult.goal;
    return {
      goal: updatedGoal,
      scannedAt,
      reviewResult: {
        ...reviewResult,
        goal: updatedGoal,
      },
      checkpointItems: checkpointScan.scanItems,
      notifications: notifications.created,
      dispatches: dispatches.created,
      learningReview: reviewResult.learningReview,
      summary: `review_overdue=${reviewResult.overdueCount} | review_escalated=${reviewResult.escalatedCount} | checkpoint_overdue=${checkpointScan.overdueCount} | checkpoint_escalated=${checkpointScan.escalatedCount} | notifications=${notifications.created.length} | dispatches=${dispatches.created.length}`,
      recommendations: [
        reviewResult.overdueCount > 0 || checkpointScan.overdueCount > 0
          ? "存在超时审批项，建议优先处理 overdue stage。"
          : "",
        notifications.created.length > 0
          ? `本次新增 ${notifications.created.length} 条 reminder / escalation 通知。`
          : "",
        dispatches.created.length > 0
          ? `本次已落运行态通知 outbox ${dispatches.created.length} 条，可在 goal detail 查看 dispatch channel / status。`
          : "",
      ].filter(Boolean),
    };
  }

  private async requireGoal(goalId: string): Promise<LongTermGoal> {
    const goal = await this.getGoal(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }
    return goal;
  }

  private async withGoalMutationLock<T>(goalId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.goalMutationLocks.get(goalId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.goalMutationLocks.set(goalId, tail);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      releaseCurrent();
      if (this.goalMutationLocks.get(goalId) === tail) {
        this.goalMutationLocks.delete(goalId);
      }
    }
  }

  private async syncSuggestionReviews(goal: LongTermGoal): Promise<GoalSuggestionReviewState> {
    const [existing, methodCandidates, skillCandidates, flowPatterns] = await Promise.all([
      readGoalSuggestionReviews(goal),
      readGoalMethodCandidates(goal),
      readGoalSkillCandidates(goal),
      readGoalFlowPatterns(goal),
    ]);
    const existingByKey = new Map(existing.items.map((item) => [`${item.suggestionType}:${item.suggestionId}`, item] as const));
    const now = new Date().toISOString();
    const nextItems: GoalSuggestionReviewItem[] = [
      ...methodCandidates.items.map((item) => this.buildSuggestionReviewItem(goal, {
        suggestionType: "method_candidate",
        suggestionId: item.id,
        title: item.title,
        summary: item.summary,
        nodeId: item.nodeId,
        runId: item.runId,
        sourcePath: getGoalMethodCandidatesPath(goal),
        evidenceRefs: item.evidence.references,
      }, existingByKey.get(`method_candidate:${item.id}`), now)),
      ...skillCandidates.items.map((item) => this.buildSuggestionReviewItem(goal, {
        suggestionType: "skill_candidate",
        suggestionId: item.id,
        title: item.title,
        summary: item.summary,
        nodeId: item.nodeId,
        runId: item.runId,
        sourcePath: getGoalSkillCandidatesPath(goal),
        evidenceRefs: item.evidence.references,
      }, existingByKey.get(`skill_candidate:${item.id}`), now)),
      ...flowPatterns.items.map((item) => this.buildSuggestionReviewItem(goal, {
        suggestionType: "flow_pattern",
        suggestionId: item.id,
        title: item.id,
        summary: item.summary,
        sourcePath: getGoalFlowPatternsPath(goal),
        evidenceRefs: item.nodeRefs.map((node) => `${goal.id}:${node.nodeId}`),
      }, existingByKey.get(`flow_pattern:${item.id}`), now)),
    ].sort((left, right) =>
      left.suggestionType.localeCompare(right.suggestionType, "zh-CN")
      || left.title.localeCompare(right.title, "zh-CN")
      || left.createdAt.localeCompare(right.createdAt));
    const nextState: GoalSuggestionReviewState = {
      version: 1,
      syncedAt: now,
      items: nextItems,
    };
    const changed = !isDeepStrictEqual(existing, nextState);
    if (changed) {
      await writeGoalSuggestionReviews(goal, nextState);
    }
    return nextState;
  }

  private buildSuggestionReviewStatusCounts(items: GoalSuggestionReviewItem[]): Record<GoalSuggestionReviewStatus, number> {
    const counts: Record<GoalSuggestionReviewStatus, number> = {
      pending_review: 0,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      needs_revision: 0,
    };
    for (const item of items) counts[item.status] += 1;
    return counts;
  }

  private buildSuggestionReviewTypeCounts(items: GoalSuggestionReviewItem[]): Record<GoalSuggestionType, number> {
    const counts: Record<GoalSuggestionType, number> = {
      method_candidate: 0,
      skill_candidate: 0,
      flow_pattern: 0,
    };
    for (const item of items) counts[item.suggestionType] += 1;
    return counts;
  }

  private buildSuggestionReviewWorkflow(
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionReviewWorkflowConfigureInput,
    now: string,
  ): GoalSuggestionReviewWorkflow {
    const mode = input.mode;
    const stages = mode === "chain"
      ? this.buildChainSuggestionReviewWorkflowStages(review, input, now)
      : [this.buildSuggestionReviewWorkflowStage(review, {
        title: mode === "quorum" ? "Quorum Review" : "Primary Review",
        reviewers: input.reviewers ?? [],
        reviewerRoles: input.reviewerRoles,
        minApprovals: input.minApprovals,
        slaHours: input.slaHours,
        reminderMinutes: input.stages?.[0]?.reminderMinutes,
      }, 0, now, mode === "quorum" ? "quorum" : "single", input.escalationMode, input.escalationReviewer)];
    if (stages.length === 0) {
      throw new Error("Workflow stages are required.");
    }
    return {
      mode,
      status: "pending_review",
      currentStageIndex: 0,
      stages,
      configuredAt: now,
      updatedAt: now,
    };
  }

  private buildChainSuggestionReviewWorkflowStages(
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionReviewWorkflowConfigureInput,
    now: string,
  ): GoalSuggestionReviewWorkflowStage[] {
    const rawStages = (input.stages && input.stages.length > 0)
      ? input.stages
      : (input.reviewers ?? []).map<GoalSuggestionReviewWorkflowStageInput>((reviewer, index) => ({
        title: `Chain Stage ${index + 1}`,
        reviewers: [reviewer],
        reviewerRoles: input.reviewerRoles?.[index] ? [input.reviewerRoles[index] as string] : undefined,
        minApprovals: 1,
        slaHours: input.slaHours,
      }));
    if (rawStages.length === 0) {
      const fallbackReviewer = review.reviewer?.trim();
      if (!fallbackReviewer) {
        throw new Error("chain workflow requires stages or reviewers.");
      }
      rawStages.push({
        title: "Chain Stage 1",
        reviewers: [fallbackReviewer],
        minApprovals: 1,
        slaHours: input.slaHours,
        reminderMinutes: undefined,
      });
    }
    return rawStages.map((stage, index) => this.buildSuggestionReviewWorkflowStage(
      review,
      stage,
      index,
      now,
      (stage.minApprovals ?? 1) > 1 || (stage.reviewers?.length ?? 0) > 1 ? "quorum" : "single",
      input.escalationMode,
      input.escalationReviewer,
    ));
  }

  private buildSuggestionReviewWorkflowStage(
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionReviewWorkflowStageInput,
    index: number,
    now: string,
    mode: GoalSuggestionReviewWorkflowStage["mode"],
    escalationMode: GoalSuggestionReviewWorkflowEscalation["mode"] = "none",
    escalationReviewer?: string,
  ): GoalSuggestionReviewWorkflowStage {
    const reviewers = this.toSuggestionReviewWorkflowReviewers(input.reviewers, input.reviewerRoles, review.reviewer);
    if (reviewers.length === 0) {
      throw new Error("workflow stage requires at least one reviewer.");
    }
    const minApprovals = mode === "quorum"
      ? Math.max(1, Math.min(reviewers.length, input.minApprovals ?? Math.ceil(reviewers.length / 2)))
      : 1;
    return {
      id: `stage_${index + 1}`,
      title: input.title?.trim() || `Stage ${index + 1}`,
      mode,
      reviewers,
      minApprovals,
      status: "pending_review",
      votes: [],
      startedAt: now,
      decidedAt: undefined,
      slaAt: this.computeSuggestionReviewStageSlaAt(input.slaHours, now),
      reminderMinutes: input.reminderMinutes?.filter((item) => Number.isFinite(item) && item >= 0).map((item) => Math.floor(item)),
      escalation: {
        mode: escalationMode,
        count: 0,
        defaultReviewer: escalationReviewer?.trim() || undefined,
        history: [],
      },
    };
  }

  private toSuggestionReviewWorkflowReviewers(
    reviewers: string[] | undefined,
    reviewerRoles: string[] | undefined,
    fallbackReviewer?: string,
  ): GoalSuggestionReviewWorkflowReviewer[] {
    const items: GoalSuggestionReviewWorkflowReviewer[] = [];
    for (const [index, reviewer] of (reviewers ?? []).entries()) {
      const normalized = reviewer?.trim();
      if (!normalized) continue;
      items.push({
        reviewer: normalized,
        reviewerRole: reviewerRoles?.[index]?.trim() || undefined,
      });
    }
    if (items.length > 0) return items;
    const normalizedFallback = fallbackReviewer?.trim();
    return normalizedFallback ? [{ reviewer: normalizedFallback }] : [];
  }

  private computeSuggestionReviewStageSlaAt(slaHours: number | undefined, now: string): string | undefined {
    if (typeof slaHours !== "number" || !Number.isFinite(slaHours) || slaHours <= 0) return undefined;
    return new Date(new Date(now).getTime() + slaHours * 60 * 60 * 1000).toISOString();
  }

  private getCurrentWorkflowReviewer(workflow: GoalSuggestionReviewWorkflow): string | undefined {
    const stage = workflow.stages[workflow.currentStageIndex];
    return stage?.reviewers[0]?.reviewer;
  }

  private getPendingSuggestionReviewWorkflowStage(
    workflow: GoalSuggestionReviewWorkflow | undefined,
  ): GoalSuggestionReviewWorkflowStage | undefined {
    if (!workflow || workflow.status !== "pending_review") return undefined;
    const stage = workflow.stages[workflow.currentStageIndex];
    return stage?.status === "pending_review" ? stage : undefined;
  }

  private isSuggestionReviewWorkflowStageOverdue(stage: GoalSuggestionReviewWorkflowStage, now: string): boolean {
    if (!stage.slaAt || stage.status !== "pending_review") return false;
    return new Date(now).getTime() > new Date(stage.slaAt).getTime();
  }

  private listOverdueSuggestionReviews(
    items: GoalSuggestionReviewItem[],
    now: string,
  ): GoalSuggestionReviewItem[] {
    return items
      .filter((item) => {
        const stage = this.getPendingSuggestionReviewWorkflowStage(item.workflow);
        return Boolean(stage && this.isSuggestionReviewWorkflowStageOverdue(stage, now));
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private applySuggestionReviewWorkflowDecision(
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionReviewDecisionInput,
    now: string,
  ): GoalSuggestionReviewItem {
    const workflow = review.workflow;
    if (!workflow) return review;
    const stage = workflow.stages[workflow.currentStageIndex];
    if (!stage) {
      throw new Error(`Workflow stage not found: ${workflow.currentStageIndex}`);
    }
    const actor = input.decidedBy?.trim() || input.reviewer?.trim() || review.decidedBy || review.reviewer;
    if (!actor) {
      throw new Error("Workflow decision requires decidedBy or reviewer.");
    }
    const allowedReviewers = new Set(stage.reviewers.map((item) => item.reviewer));
    if (allowedReviewers.size > 0 && !allowedReviewers.has(actor)) {
      throw new Error(`Reviewer "${actor}" is not assigned to current stage "${stage.title}".`);
    }

    const reviewerRole = stage.reviewers.find((item) => item.reviewer === actor)?.reviewerRole;
    const vote: GoalSuggestionReviewWorkflowVote = {
      reviewer: actor,
      reviewerRole,
      decision: input.decision,
      note: input.note?.trim() || undefined,
      decidedBy: input.decidedBy?.trim() || actor,
      decidedAt: now,
    };
    const votes = [...stage.votes.filter((item) => item.reviewer !== actor), vote]
      .sort((left, right) => left.reviewer.localeCompare(right.reviewer, "zh-CN"));
    const updatedStage: GoalSuggestionReviewWorkflowStage = {
      ...stage,
      votes,
      status: stage.status,
      decidedAt: stage.decidedAt,
    };
    const nextWorkflow: GoalSuggestionReviewWorkflow = {
      ...workflow,
      updatedAt: now,
      stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? updatedStage : item),
    };
    return this.finishSuggestionReviewWorkflowDecision(review, nextWorkflow, vote, now);
  }

  private finishSuggestionReviewWorkflowDecision(
    review: GoalSuggestionReviewItem,
    workflow: GoalSuggestionReviewWorkflow,
    vote: GoalSuggestionReviewWorkflowVote,
    now: string,
  ): GoalSuggestionReviewItem {
    const stage = workflow.stages[workflow.currentStageIndex];
    const approvals = stage.votes.filter((item) => item.decision === "accepted").length;
    const rejections = stage.votes.filter((item) => item.decision === "rejected").length;
    const needsRevision = stage.votes.some((item) => item.decision === "needs_revision");
    const deferred = stage.votes.some((item) => item.decision === "deferred");
    const rejectionThreshold = Math.max(1, stage.reviewers.length - stage.minApprovals + 1);

    if (needsRevision) {
      const nextStage = { ...stage, status: "needs_revision" as const, decidedAt: now };
      return this.finalizeSuggestionReviewWorkflow(review, {
        ...workflow,
        status: "needs_revision",
        updatedAt: now,
        stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? nextStage : item),
      }, "needs_revision", vote, now, review.reviewer);
    }

    if (deferred) {
      const nextStage = { ...stage, status: "deferred" as const, decidedAt: now };
      return this.finalizeSuggestionReviewWorkflow(review, {
        ...workflow,
        status: "deferred",
        updatedAt: now,
        stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? nextStage : item),
      }, "deferred", vote, now, review.reviewer);
    }

    if (stage.mode === "quorum") {
      if (approvals >= stage.minApprovals) {
        const approvedStage = { ...stage, status: "accepted" as const, decidedAt: now };
        const withApprovedStage = {
          ...workflow,
          updatedAt: now,
          stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? approvedStage : item),
        };
        if (workflow.mode === "chain" && workflow.currentStageIndex < workflow.stages.length - 1) {
          return this.advanceSuggestionReviewWorkflow(review, withApprovedStage, vote, now);
        }
        return this.finalizeSuggestionReviewWorkflow(review, {
          ...withApprovedStage,
          status: "accepted",
        }, "accepted", vote, now, review.reviewer);
      }
      if (rejections >= rejectionThreshold) {
        const rejectedStage = { ...stage, status: "rejected" as const, decidedAt: now };
        return this.finalizeSuggestionReviewWorkflow(review, {
          ...workflow,
          status: "rejected",
          updatedAt: now,
          stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? rejectedStage : item),
        }, "rejected", vote, now, review.reviewer);
      }
      const pendingStage = { ...stage, status: "pending_review" as const };
      return {
        ...review,
        status: "pending_review",
        reviewer: stage.reviewers.map((item) => item.reviewer).join(", "),
        decidedBy: vote.decidedBy,
        note: vote.note ?? review.note,
        decidedAt: undefined,
        workflow: {
          ...workflow,
          status: "pending_review",
          updatedAt: now,
          stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? pendingStage : item),
        },
        updatedAt: now,
      };
    }

    if (vote.decision === "accepted") {
      const approvedStage = { ...stage, status: "accepted" as const, decidedAt: now };
      const withApprovedStage = {
        ...workflow,
        updatedAt: now,
        stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? approvedStage : item),
      };
      if (workflow.mode === "chain" && workflow.currentStageIndex < workflow.stages.length - 1) {
        return this.advanceSuggestionReviewWorkflow(review, withApprovedStage, vote, now);
      }
      return this.finalizeSuggestionReviewWorkflow(review, {
        ...withApprovedStage,
        status: "accepted",
      }, "accepted", vote, now, review.reviewer);
    }

    const stageStatus = vote.decision;
    const decidedStage = { ...stage, status: stageStatus, decidedAt: now };
    return this.finalizeSuggestionReviewWorkflow(review, {
      ...workflow,
      status: stageStatus,
      updatedAt: now,
      stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? decidedStage : item),
    }, stageStatus, vote, now, review.reviewer);
  }

  private advanceSuggestionReviewWorkflow(
    review: GoalSuggestionReviewItem,
    workflow: GoalSuggestionReviewWorkflow,
    vote: GoalSuggestionReviewWorkflowVote,
    now: string,
  ): GoalSuggestionReviewItem {
    const nextIndex = workflow.currentStageIndex + 1;
    const nextStage = workflow.stages[nextIndex];
    if (!nextStage) {
      return this.finalizeSuggestionReviewWorkflow(review, {
        ...workflow,
        status: "accepted",
        updatedAt: now,
      }, "accepted", vote, now, review.reviewer);
    }
    const startedStage: GoalSuggestionReviewWorkflowStage = {
      ...nextStage,
      status: "pending_review",
      startedAt: nextStage.startedAt || now,
    };
    return {
      ...review,
      status: "pending_review",
      reviewer: startedStage.reviewers.map((item) => item.reviewer).join(", "),
      decidedBy: vote.decidedBy,
      note: vote.note ?? review.note,
      decidedAt: undefined,
      workflow: {
        ...workflow,
        status: "pending_review",
        currentStageIndex: nextIndex,
        updatedAt: now,
        stages: workflow.stages.map((item, index) => index === nextIndex ? startedStage : item),
      },
      updatedAt: now,
    };
  }

  private finalizeSuggestionReviewWorkflow(
    review: GoalSuggestionReviewItem,
    workflow: GoalSuggestionReviewWorkflow,
    status: GoalSuggestionReviewStatus,
    vote: GoalSuggestionReviewWorkflowVote,
    now: string,
    fallbackReviewer?: string,
  ): GoalSuggestionReviewItem {
    return {
      ...review,
      status,
      reviewer: this.getCurrentWorkflowReviewer(workflow) ?? fallbackReviewer ?? review.reviewer,
      decidedBy: vote.decidedBy,
      note: vote.note ?? review.note,
      decidedAt: now,
      workflow: {
        ...workflow,
        status,
        updatedAt: now,
      },
      updatedAt: now,
    };
  }

  private applySuggestionReviewEscalation(
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionReviewEscalateInput,
    now: string,
  ): GoalSuggestionReviewItem {
    const workflow = review.workflow;
    if (!workflow) {
      throw new Error("Suggestion review workflow is not configured.");
    }
    const stage = workflow.stages[workflow.currentStageIndex];
    if (!stage) {
      throw new Error(`Workflow stage not found: ${workflow.currentStageIndex}`);
    }
    if (workflow.status !== "pending_review" || stage.status !== "pending_review") {
      throw new Error(`Current workflow stage "${stage.title}" is not pending.`);
    }
    const overdue = stage.slaAt ? new Date(now).getTime() > new Date(stage.slaAt).getTime() : false;
    if (!input.force && !overdue) {
      throw new Error(`Current workflow stage "${stage.title}" is not overdue; use force=true to escalate manually.`);
    }
    if (stage.escalation.mode === "none" && !input.force) {
      throw new Error(`Current workflow stage "${stage.title}" does not allow escalation.`);
    }
    const escalatedTo = input.escalatedTo?.trim() || stage.escalation.defaultReviewer;
    const escalationEvent = {
      at: now,
      by: input.escalatedBy?.trim(),
      to: escalatedTo,
      reason: input.reason?.trim(),
    };
    const reviewers = escalatedTo && !stage.reviewers.some((item) => item.reviewer === escalatedTo)
      ? [...stage.reviewers, { reviewer: escalatedTo }]
      : [...stage.reviewers];
    const nextStage: GoalSuggestionReviewWorkflowStage = {
      ...stage,
      reviewers,
      escalation: {
        ...stage.escalation,
        mode: stage.escalation.mode === "manual" || input.force ? "manual" : stage.escalation.mode,
        count: stage.escalation.count + 1,
        defaultReviewer: stage.escalation.defaultReviewer,
        lastEscalatedAt: now,
        escalatedTo,
        escalatedBy: input.escalatedBy?.trim(),
        overdueAt: stage.escalation.overdueAt,
        reason: input.reason?.trim(),
        history: [...stage.escalation.history, escalationEvent],
      },
    };
    const nextWorkflow: GoalSuggestionReviewWorkflow = {
      ...workflow,
      status: "pending_review",
      updatedAt: now,
      stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? nextStage : item),
    };
    return {
      ...review,
      reviewer: escalatedTo ?? reviewers.map((item) => item.reviewer).join(", "),
      note: input.reason?.trim() || review.note,
      workflow: nextWorkflow,
      updatedAt: now,
    };
  }

  private markSuggestionReviewWorkflowStageOverdue(
    review: GoalSuggestionReviewItem,
    now: string,
  ): GoalSuggestionReviewItem {
    const workflow = review.workflow;
    const stage = this.getPendingSuggestionReviewWorkflowStage(workflow);
    if (!workflow || !stage || !this.isSuggestionReviewWorkflowStageOverdue(stage, now) || stage.escalation.overdueAt) {
      return review;
    }
    const nextStage: GoalSuggestionReviewWorkflowStage = {
      ...stage,
      escalation: {
        ...stage.escalation,
        overdueAt: now,
      },
    };
    return {
      ...review,
      workflow: {
        ...workflow,
        updatedAt: now,
        stages: workflow.stages.map((item, index) => index === workflow.currentStageIndex ? nextStage : item),
      },
      updatedAt: now,
    };
  }

  private tryAutoEscalateSuggestionReview(
    review: GoalSuggestionReviewItem,
    now: string,
  ): GoalSuggestionReviewItem {
    const workflow = review.workflow;
    const stage = this.getPendingSuggestionReviewWorkflowStage(workflow);
    if (!workflow || !stage || stage.escalation.mode !== "manual") {
      return review;
    }
    const escalatedTo = stage.escalation.defaultReviewer?.trim();
    if (!escalatedTo || stage.escalation.count > 0 || stage.reviewers.some((item) => item.reviewer === escalatedTo)) {
      return review;
    }
    return this.applySuggestionReviewEscalation(review, {
      escalatedBy: "workflow_scan",
      escalatedTo,
      reason: "SLA overdue auto escalation",
      force: true,
    }, now);
  }

  private async publishMethodSuggestion(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    publishedAt: string,
    input: GoalSuggestionPublishInput,
  ): Promise<GoalSuggestionPublishRecord> {
    const methodCandidates = await readGoalMethodCandidates(goal);
    const candidate = methodCandidates.items.find((item) => item.id === review.suggestionId);
    if (!candidate) {
      throw new Error(`Method candidate not found: ${review.suggestionId}`);
    }
    const methodsDir = path.join(this.stateDir, "methods");
    await fs.mkdir(methodsDir, { recursive: true });
    const publishedPath = await this.resolveMethodPublishPath(methodsDir, candidate.slug, candidate.nodeId, candidate.id);
    await fs.writeFile(publishedPath, candidate.draftContent, "utf-8");
    return this.buildGoalSuggestionPublishRecord(goal, review, input, {
      assetType: "method",
      publishedPath,
      assetKey: path.basename(publishedPath),
      sourcePath: getGoalMethodCandidatesPath(goal),
      publishedAt,
    });
  }

  private async publishSkillSuggestion(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    publishedAt: string,
    input: GoalSuggestionPublishInput,
  ): Promise<GoalSuggestionPublishRecord> {
    const skillCandidates = await readGoalSkillCandidates(goal);
    const candidate = skillCandidates.items.find((item) => item.id === review.suggestionId);
    if (!candidate) {
      throw new Error(`Skill candidate not found: ${review.suggestionId}`);
    }
    const syntheticCandidate = this.buildSyntheticGoalSkillCandidate(goal, review, candidate, publishedAt);
    const publishedPath = await publishSkillCandidate(syntheticCandidate, this.stateDir, getGlobalSkillRegistry());
    return this.buildGoalSuggestionPublishRecord(goal, review, input, {
      assetType: "skill",
      publishedPath,
      assetKey: path.basename(path.dirname(publishedPath)),
      sourcePath: getGoalSkillCandidatesPath(goal),
      publishedAt,
    });
  }

  private async recoverPublishedSuggestionRecord(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionPublishInput,
  ): Promise<GoalSuggestionPublishRecord | null> {
    return review.suggestionType === "method_candidate"
      ? this.recoverPublishedMethodSuggestion(goal, review, input)
      : this.recoverPublishedSkillSuggestion(goal, review, input);
  }

  private async recoverPublishedMethodSuggestion(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionPublishInput,
  ): Promise<GoalSuggestionPublishRecord | null> {
    const methodCandidates = await readGoalMethodCandidates(goal);
    const candidate = methodCandidates.items.find((item) => item.id === review.suggestionId);
    if (!candidate) {
      return null;
    }
    const methodsDir = path.join(this.stateDir, "methods");
    const publishedPath = await this.findMatchingPublishedArtifactPath(
      this.getMethodPublishPathCandidates(methodsDir, candidate.slug, candidate.nodeId, candidate.id),
      candidate.draftContent,
    );
    if (!publishedPath) {
      return null;
    }
    return this.buildGoalSuggestionPublishRecord(goal, review, input, {
      assetType: "method",
      publishedPath,
      assetKey: path.basename(publishedPath),
      sourcePath: getGoalMethodCandidatesPath(goal),
      publishedAt: await this.getPublishedArtifactTimestamp(publishedPath),
    });
  }

  private async recoverPublishedSkillSuggestion(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionPublishInput,
  ): Promise<GoalSuggestionPublishRecord | null> {
    const skillCandidates = await readGoalSkillCandidates(goal);
    const candidate = skillCandidates.items.find((item) => item.id === review.suggestionId);
    if (!candidate) {
      return null;
    }
    const publishedPath = await this.findMatchingPublishedArtifactPath(
      this.getSkillPublishPathCandidates(getUserSkillsDir(this.stateDir), candidate.slug, `${goal.id}:${review.nodeId ?? review.suggestionId}`, review.id),
      candidate.draftContent,
    );
    if (!publishedPath) {
      return null;
    }
    return this.buildGoalSuggestionPublishRecord(goal, review, input, {
      assetType: "skill",
      publishedPath,
      assetKey: path.basename(path.dirname(publishedPath)),
      sourcePath: getGoalSkillCandidatesPath(goal),
      publishedAt: await this.getPublishedArtifactTimestamp(publishedPath),
    });
  }

  private async syncPublishedSuggestionToExperienceCandidate(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    record: GoalSuggestionPublishRecord,
  ): Promise<ExperienceCandidate | null> {
    const manager = getGlobalMemoryManager({
      conversationId: goal.activeConversationId,
      workspaceRoot: this.stateDir,
    }) as {
      upsertExperienceCandidate?: (candidate: ExperienceCandidate) => ExperienceCandidate;
      store?: {
        findExperienceCandidateByTaskAndType?: (taskId: string, type: ExperienceCandidate["type"]) => ExperienceCandidate | null;
        updateExperienceCandidate?: (candidateId: string, patch: Partial<ExperienceCandidate>) => ExperienceCandidate | null;
        createExperienceCandidate?: (candidate: ExperienceCandidate) => void;
        getExperienceCandidate?: (candidateId: string) => ExperienceCandidate | null;
      };
    } | null;
    if (!manager) return null;
    const syntheticTaskId = this.buildGoalSuggestionTaskId(goal.id, review.suggestionType, review.suggestionId);
    const now = record.publishedAt;
    const content = await fs.readFile(record.publishedPath, "utf-8").catch(() => "");
    const candidate = this.buildExperienceCandidateFromPublishedSuggestion(goal, review, record, syntheticTaskId, now, content);
    if (typeof manager.upsertExperienceCandidate === "function") {
      return manager.upsertExperienceCandidate(candidate);
    }
    const existing = manager.store?.findExperienceCandidateByTaskAndType?.(candidate.taskId, candidate.type) ?? null;
    if (existing && manager.store?.updateExperienceCandidate) {
      return manager.store.updateExperienceCandidate(existing.id, {
        status: candidate.status,
        title: candidate.title,
        slug: candidate.slug,
        content: candidate.content,
        summary: candidate.summary,
        qualityScore: candidate.qualityScore,
        sourceTaskSnapshot: candidate.sourceTaskSnapshot,
        publishedPath: candidate.publishedPath,
        reviewedAt: candidate.reviewedAt,
        acceptedAt: candidate.acceptedAt,
        rejectedAt: candidate.rejectedAt,
      });
    }
    if (manager.store?.createExperienceCandidate) {
      manager.store.createExperienceCandidate(candidate);
      return manager.store.getExperienceCandidate?.(candidate.id) ?? candidate;
    }
    return null;
  }

  private async buildHandoff(goal: LongTermGoal): Promise<GoalHandoffReadResult> {
    const [runtime, graph, checkpoints, plansState, progressContent] = await Promise.all([
      readGoalRuntime(goal),
      readGoalTaskGraph(goal),
      readGoalCheckpoints(goal),
      readGoalCapabilityPlans(goal),
      fs.readFile(goal.progressPath, "utf-8").catch((err: NodeJS.ErrnoException) => {
        if (err?.code === "ENOENT") return "";
        throw err;
      }),
    ]);
    const bridgeGovernanceSummary = await loadGoalHandoffBridgeGovernanceSummary({
      stateDir: this.stateDir,
      graph,
    });
    return buildGoalHandoffResult({
      goal,
      runtime,
      graph,
      checkpoints,
      plans: plansState.items,
      progressContent,
      bridgeGovernanceSummary,
    });
  }

  private async persistHandoff(goal: LongTermGoal): Promise<GoalHandoffGenerateResult> {
    const [runtime, graph, checkpoints, plansState, progressContent] = await Promise.all([
      readGoalRuntime(goal),
      readGoalTaskGraph(goal),
      readGoalCheckpoints(goal),
      readGoalCapabilityPlans(goal),
      fs.readFile(goal.progressPath, "utf-8").catch((err: NodeJS.ErrnoException) => {
        if (err?.code === "ENOENT") return "";
        throw err;
      }),
    ]);
    const bridgeGovernanceSummary = await loadGoalHandoffBridgeGovernanceSummary({
      stateDir: this.stateDir,
      graph,
    });
    return generateGoalHandoff({
      goal,
      runtime,
      graph,
      checkpoints,
      plans: plansState.items,
      progressContent,
      bridgeGovernanceSummary,
    });
  }

  private async refreshHandoffAfterMutation(goal: LongTermGoal): Promise<void> {
    try {
      await this.persistHandoff(goal);
    } catch {
      // best effort auto-refresh: do not break core task/checkpoint state mutation because handoff refresh failed
    }
  }

  private async emitGoalUpdate(
    goal: LongTermGoal,
    input: {
      reason: GoalUpdateReason;
      nodeId?: string;
      checkpointId?: string;
      runId?: string;
    },
  ): Promise<void> {
    if (!this.eventSink) return;
    try {
      await this.eventSink({
        goal,
        reason: input.reason,
        areas: getGoalUpdateAreas(input.reason),
        nodeId: input.nodeId,
        checkpointId: input.checkpointId,
        runId: input.runId,
        at: new Date().toISOString(),
      });
    } catch {
      // event broadcast failure should not block core goal state mutation
    }
  }

  private async touchGoal(goal: LongTermGoal, patch: Partial<LongTermGoal> = {}): Promise<LongTermGoal> {
    const now = new Date().toISOString();
    const updatedGoal: LongTermGoal = {
      ...goal,
      ...patch,
      updatedAt: now,
      lastActiveAt: patch.lastActiveAt ?? now,
    };
    await this.persistGoalHeaderState(goal, updatedGoal);
    return updatedGoal;
  }

  private async persistGoalHeaderState(
    previousGoal: LongTermGoal,
    updatedGoal: LongTermGoal,
    runtimePatch: Partial<GoalRuntimeState> = {},
  ): Promise<void> {
    const previousRuntime = await readGoalRuntime(previousGoal);
    const nextRuntime: GoalRuntimeState = {
      ...previousRuntime,
      goalId: updatedGoal.id,
      status: updatedGoal.status,
      activeConversationId: updatedGoal.activeConversationId,
      activeNodeId: updatedGoal.activeNodeId,
      lastNodeId: updatedGoal.lastNodeId,
      lastRunId: updatedGoal.lastRunId,
      pausedAt: updatedGoal.pausedAt,
      updatedAt: updatedGoal.updatedAt,
      ...runtimePatch,
    };
    await writeGoalRuntime(updatedGoal, nextRuntime);
    try {
      await upsertGoalRegistryEntry(this.stateDir, updatedGoal);
    } catch (error) {
      try {
        await writeGoalRuntime(previousGoal, previousRuntime);
      } catch {
        // best effort rollback: preserve original error and avoid masking the primary failure
      }
      throw error;
    }
  }

  private async syncGoalSessionBinding(
    goal: LongTermGoal,
    input: {
      conversationId?: string;
      nodeId?: string;
      runId?: string;
      status?: string;
    },
  ): Promise<void> {
    const nodeId = input.nodeId?.trim() || goal.activeNodeId || goal.lastNodeId;
    const runId = input.runId?.trim() || goal.lastRunId;
    const conversationId = input.conversationId?.trim()
      || goal.activeConversationId
      || (nodeId && runId ? createGoalNodeConversationId(goal.id, nodeId, runId) : undefined)
      || (!nodeId ? createGoalConversationId(goal.id) : undefined);
    if (!conversationId) {
      return;
    }
    await this.bindingStore.upsertGoalSession({
      goalId: goal.id,
      nodeId,
      runId,
      conversationId,
      status: input.status || goal.status,
    });
  }

  private resolveCheckpointForDecision(
    checkpoints: GoalCheckpointState,
    nodeId: string,
    checkpointId?: string,
  ): GoalCheckpointItem {
    const normalizedCheckpointId = checkpointId?.trim();
    if (normalizedCheckpointId) {
      const byId = checkpoints.items.find((item) => item.id === normalizedCheckpointId);
      if (!byId) {
        throw new Error(`Checkpoint not found: ${normalizedCheckpointId}`);
      }
      return byId;
    }
    const candidates = checkpoints.items
      .filter((item) => item.nodeId === nodeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const latest = candidates[0];
    if (!latest) {
      throw new Error(`No checkpoint found for node: ${nodeId}`);
    }
    return latest;
  }

  private resolveCapabilityPlanForNode(
    plans: GoalCapabilityPlanState,
    nodeId: string,
  ): GoalCapabilityPlan | null {
    const matched = plans.items
      .filter((item) => item.nodeId === nodeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return matched[0] ?? null;
  }

  private getCommanderPlanPath(goal: LongTermGoal, plan: GoalCapabilityPlan): string {
    return path.join(this.getCommanderRunRoot(goal, plan), "commander-plan.md");
  }

  private getCommanderReviewPath(goal: LongTermGoal, plan: GoalCapabilityPlan): string {
    return path.join(this.getCommanderRunRoot(goal, plan), "review-results", `review-${this.normalizeAsciiToken(plan.nodeId, "node")}.md`);
  }

  private getCommanderWorkOrderPath(goal: LongTermGoal, plan: GoalCapabilityPlan, subAgent: GoalCapabilityPlanSubAgent): string {
    return path.join(
      this.getCommanderRunRoot(goal, plan),
      "work-order",
      `${this.normalizeAsciiToken(subAgent.agentId, "agent")}.md`,
    );
  }

  private getCommanderRunRoot(goal: LongTermGoal, plan: GoalCapabilityPlan): string {
    const runSegment = this.normalizeAsciiToken(plan.runId, `node-${plan.nodeId}`);
    return path.join(goal.runtimeRoot, "runs", runSegment);
  }

  private async atomicWriteText(targetPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, targetPath);
  }

  private buildCommanderPlanMarkdown(
    goal: LongTermGoal,
    node: GoalTaskNode,
    plan: GoalCapabilityPlan,
  ): string {
    const coordinationPlan = plan.orchestration?.coordinationPlan;
    const rolePolicy = coordinationPlan?.rolePolicy;
    const finalApprovalMode = plan.orchestration?.finalApprovalMode ?? "user_required";
    const reworkRevisionCount = plan.orchestration?.reworkRevisionCount ?? 0;
    const reworkTargets = plan.orchestration?.reworkTargetAgentIds?.length
      ? plan.orchestration.reworkTargetAgentIds.join(", ")
      : "(none)";
    const subAgentLines = plan.subAgents.length > 0
      ? plan.subAgents.map((item, index) => `${index + 1}. ${item.agentId}${item.role ? ` [${item.role}]` : ""} | ${item.objective}${item.deliverable ? ` | deliverable=${item.deliverable}` : ""}`)
      : ["(none)"];
    return [
      "# Commander Plan",
      "",
      `- Goal ID: ${goal.id}`,
      `- Node ID: ${node.id}`,
      `- Run ID: ${plan.runId ?? "(none)"}`,
      `- Plan ID: ${plan.id}`,
      `- Execution Mode: ${plan.executionMode}`,
      `- Governance Mode: ${plan.governanceMode}`,
      `- Commander Agent: ${plan.commanderAgentId ?? coordinationPlan?.managerAgentId ?? "(none)"}`,
      `- Preferred Agents: ${plan.preferredAgents.length > 0 ? plan.preferredAgents.join(", ") : "(none)"}`,
      `- Risk Level: ${plan.riskLevel}`,
      `- Final Approval Default: ${finalApprovalMode}`,
      `- Rework Revision Count: ${reworkRevisionCount}`,
      `- Last Rework Reason: ${plan.orchestration?.lastReworkReason ?? "(none)"}`,
      `- Last Rework At: ${plan.orchestration?.lastReworkAt ?? "(none)"}`,
      `- Rework Targets: ${reworkTargets}`,
      "",
      "## Objective",
      "",
      plan.objective,
      "",
      "## Summary",
      "",
      plan.summary,
      "",
      "## Coordination",
      "",
      coordinationPlan?.summary ?? "(none)",
      "",
      `Role Policy: ${rolePolicy ? `roles=${rolePolicy.selectedRoles.join(", ") || "(none)"} | fanIn=${rolePolicy.fanInStrategy}` : "(none)"}`,
      "",
      "## Work Orders",
      "",
      ...subAgentLines,
      "",
      "## Verification Hints",
      "",
      `- Checkpoint: ${plan.checkpoint.required ? `${plan.checkpoint.approvalMode} | ${plan.checkpoint.reasons.join(" | ") || "(none)"}` : "optional"}`,
      `- Gaps: ${plan.gaps.length > 0 ? plan.gaps.join(" | ") : "(none)"}`,
      "",
    ].join("\n");
  }

  private buildCommanderWorkOrderMarkdown(
    goal: LongTermGoal,
    node: GoalTaskNode,
    plan: GoalCapabilityPlan,
    subAgent: GoalCapabilityPlanSubAgent,
  ): string {
    const outOfScope = plan.subAgents
      .filter((item) => item.agentId !== subAgent.agentId || item.objective !== subAgent.objective)
      .map((item) => `${item.agentId}${item.role ? ` [${item.role}]` : ""}: ${item.objective}`);
    return [
      "# Work Order",
      "",
      `- Goal ID: ${goal.id}`,
      `- Node ID: ${node.id}`,
      `- Run ID: ${plan.runId ?? "(none)"}`,
      `- Plan ID: ${plan.id}`,
      `- Agent ID: ${subAgent.agentId}`,
      `- Role: ${subAgent.role ?? "default"}`,
      `- Commander Agent: ${plan.commanderAgentId ?? "(none)"}`,
      `- Final Approval Default: ${plan.orchestration?.finalApprovalMode ?? "user_required"}`,
      `- Rework Revision Count: ${plan.orchestration?.reworkRevisionCount ?? 0}`,
      `- Rework Targets: ${plan.orchestration?.reworkTargetAgentIds?.join(", ") || "(none)"}`,
      "",
      "## Scope",
      "",
      subAgent.objective,
      "",
      "## Deliverable",
      "",
      subAgent.deliverable ?? subAgent.objective,
      "",
      "## Out Of Scope",
      "",
      ...(outOfScope.length > 0 ? outOfScope.map((item) => `- ${item}`) : ["- Follow other work orders for remaining scopes."]),
      "",
      "## Rework Context",
      "",
      `- Last Rework Reason: ${plan.orchestration?.lastReworkReason ?? "(none)"}`,
      `- Last Rework At: ${plan.orchestration?.lastReworkAt ?? "(none)"}`,
      "",
      "## Verification Hints",
      "",
      `- Node Summary: ${plan.summary}`,
      `- Checkpoint: ${plan.checkpoint.required ? `${plan.checkpoint.approvalMode} | ${plan.checkpoint.reasons.join(" | ") || "(none)"}` : "optional"}`,
      `- Methods: ${plan.methods.length > 0 ? plan.methods.map((item) => item.file).join(", ") : "(none)"}`,
      `- Skills: ${plan.skills.length > 0 ? plan.skills.map((item) => item.name).join(", ") : "(none)"}`,
      `- MCP: ${plan.mcpServers.length > 0 ? plan.mcpServers.map((item) => item.serverId).join(", ") : "(none)"}`,
      `- Gaps: ${plan.gaps.length > 0 ? plan.gaps.join(" | ") : "(none)"}`,
      "",
    ].join("\n");
  }

  private buildCommanderReviewMarkdown(
    goal: LongTermGoal,
    node: GoalTaskNode,
    plan: GoalCapabilityPlan,
  ): string {
    const gate = plan.orchestration?.acceptanceGate;
    const delegationResults = plan.orchestration?.delegationResults ?? [];
    const reviewStatus = gate?.status ?? "pending";
    const finalApprovalMode = plan.orchestration?.finalApprovalMode ?? "user_required";
    const reworkTargets = plan.orchestration?.reworkTargetAgentIds?.length
      ? plan.orchestration.reworkTargetAgentIds.join(", ")
      : "(none)";
    const nextAction = reviewStatus === "accepted"
      ? finalApprovalMode === "agent_auto_complete"
        ? "可由 Agent 自动收口到 done，或先进入 validating 再补充经验沉淀。"
        : "应进入 validating，并等待用户最终审批验收后再收口。"
      : reviewStatus === "rejected"
        ? "应根据失败分工或收口原因下发返工单。"
        : "继续等待子分工回传或补齐 fan-in 证据。";
    const resultLines = delegationResults.length > 0
      ? delegationResults.map((item, index) => `${index + 1}. ${item.agentId}${item.role ? ` [${item.role}]` : ""} | ${item.status} | ${item.summary}${item.taskId ? ` | task=${item.taskId}` : ""}`)
      : ["(none)"];
    const checkLines = gate?.contractSpecificChecks?.length
      ? gate.contractSpecificChecks.map((item, index) => `${index + 1}. [${item.status}] ${item.id} | ${item.label}${item.evidence ? ` | ${item.evidence}` : ""}`)
      : ["(none)"];
    return [
      "# Commander Review",
      "",
      `- Goal ID: ${goal.id}`,
      `- Node ID: ${node.id}`,
      `- Run ID: ${plan.runId ?? "(none)"}`,
      `- Plan ID: ${plan.id}`,
      `- Governance Mode: ${plan.governanceMode}`,
      `- Commander Agent: ${plan.commanderAgentId ?? "(none)"}`,
      `- Review Status: ${reviewStatus}`,
      `- Final Approval Default: ${finalApprovalMode}`,
      `- Rework Revision Count: ${plan.orchestration?.reworkRevisionCount ?? 0}`,
      `- Rework Targets: ${reworkTargets}`,
      "",
      "## Fan-in Summary",
      "",
      gate?.summary ?? "Commander review is waiting for orchestration evidence.",
      "",
      "## Delegation Results",
      "",
      ...resultLines,
      "",
      "## Acceptance Checks",
      "",
      ...checkLines,
      "",
      "## Next Action",
      "",
      `- ${nextAction}`,
      `- Last Rework Reason: ${plan.orchestration?.lastReworkReason ?? "(none)"}`,
      `- Last Rework At: ${plan.orchestration?.lastReworkAt ?? "(none)"}`,
      ...(gate?.managerActionHint ? [`- ${gate.managerActionHint}`] : []),
      ...(gate?.reasons?.length ? gate.reasons.map((item) => `- ${item}`) : []),
      "",
    ].join("\n");
  }

  private async persistCommanderGovernanceArtifacts(
    goal: LongTermGoal,
    plan: GoalCapabilityPlan,
    node: GoalTaskNode,
  ): Promise<void> {
    if (plan.governanceMode !== "commander") {
      return;
    }
    const commanderPlanPath = this.getCommanderPlanPath(goal, plan);
    await this.atomicWriteText(commanderPlanPath, this.buildCommanderPlanMarkdown(goal, node, plan));
    const targetedAgents = new Set((plan.orchestration?.reworkTargetAgentIds ?? []).filter(Boolean));
    for (const subAgent of plan.subAgents) {
      if (targetedAgents.size > 0 && !targetedAgents.has(subAgent.agentId)) {
        continue;
      }
      const workOrderPath = this.getCommanderWorkOrderPath(goal, plan, subAgent);
      await this.atomicWriteText(workOrderPath, this.buildCommanderWorkOrderMarkdown(goal, node, plan, subAgent));
    }
    if (plan.status === "orchestrated") {
      const commanderReviewPath = this.getCommanderReviewPath(goal, plan);
      await this.atomicWriteText(commanderReviewPath, this.buildCommanderReviewMarkdown(goal, node, plan));
    }
  }

  private buildSuggestionReviewItem(
    goal: LongTermGoal,
    input: {
      suggestionType: GoalSuggestionType;
      suggestionId: string;
      title: string;
      summary: string;
      sourcePath: string;
      nodeId?: string;
      runId?: string;
      evidenceRefs: string[];
    },
    existing?: GoalSuggestionReviewItem,
    now = new Date().toISOString(),
  ): GoalSuggestionReviewItem {
    return {
      id: existing?.id ?? `review_${input.suggestionType}_${input.suggestionId}`,
      goalId: goal.id,
      suggestionType: input.suggestionType,
      suggestionId: input.suggestionId,
      title: input.title,
      summary: input.summary,
      sourcePath: input.sourcePath,
      nodeId: input.nodeId,
      runId: input.runId,
      status: existing?.status ?? "pending_review",
      reviewer: existing?.reviewer,
      decidedBy: existing?.decidedBy,
      note: existing?.note,
      decidedAt: existing?.decidedAt,
      evidenceRefs: [...new Set(input.evidenceRefs.filter(Boolean))],
      workflow: existing?.workflow,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
    };
  }

  private buildExperienceCandidateFromPublishedSuggestion(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    record: GoalSuggestionPublishRecord,
    taskId: string,
    now: string,
    content: string,
  ): ExperienceCandidate {
    const candidateType = record.assetType;
    return {
      id: `goal_exp_${this.normalizeAsciiToken(goal.id, "goal")}_${this.normalizeAsciiToken(review.suggestionId, "suggestion")}_${candidateType}`,
      taskId,
      type: candidateType,
      status: "accepted",
      title: review.title,
      slug: this.normalizeAsciiToken(review.suggestionId, candidateType),
      content,
      summary: review.summary,
      qualityScore: undefined,
      sourceTaskSnapshot: {
        taskId,
        conversationId: goal.activeConversationId ?? `goal:${goal.id}`,
        source: "manual",
        status: "success",
        title: review.title,
        objective: review.summary,
        summary: review.summary,
        reflection: review.note,
        outcome: `${review.suggestionType} published to ${record.assetType}`,
        artifactPaths: [record.publishedPath],
        startedAt: review.createdAt,
        finishedAt: now,
      },
      publishedPath: record.publishedPath,
      createdAt: review.createdAt,
      reviewedAt: review.decidedAt ?? now,
      acceptedAt: now,
      rejectedAt: undefined,
    };
  }

  private buildGoalSuggestionTaskId(goalId: string, suggestionType: GoalSuggestionType, suggestionId: string): string {
    return `goal_suggestion:${goalId}:${suggestionType}:${suggestionId}`;
  }

  private buildGoalSuggestionPublishRecord(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionPublishInput,
    payload: {
      assetType: GoalSuggestionPublishRecord["assetType"];
      publishedPath: string;
      assetKey: string;
      sourcePath: string;
      publishedAt: string;
    },
  ): GoalSuggestionPublishRecord {
    return {
      id: `publish_${review.id}`,
      goalId: goal.id,
      reviewId: review.id,
      suggestionType: review.suggestionType,
      suggestionId: review.suggestionId,
      assetType: payload.assetType,
      title: review.title,
      publishedPath: payload.publishedPath,
      assetKey: payload.assetKey,
      reviewer: input.reviewer?.trim() || review.reviewer,
      decidedBy: input.decidedBy?.trim() || review.decidedBy,
      note: input.note?.trim() || review.note,
      nodeId: review.nodeId,
      runId: review.runId,
      sourcePath: payload.sourcePath,
      publishedAt: payload.publishedAt,
    };
  }

  private buildSyntheticGoalSkillCandidate(
    goal: LongTermGoal,
    review: GoalSuggestionReviewItem,
    candidate: GoalSkillCandidate,
    publishedAt: string,
  ): ExperienceCandidate {
    return {
      id: review.id,
      taskId: `${goal.id}:${review.nodeId ?? review.suggestionId}`,
      type: "skill",
      status: "draft",
      title: candidate.title,
      slug: candidate.slug,
      content: candidate.draftContent,
      summary: candidate.summary,
      qualityScore: candidate.qualityScore,
      sourceTaskSnapshot: {
        taskId: `${goal.id}:${review.nodeId ?? review.suggestionId}`,
        conversationId: goal.activeConversationId ?? `goal:${goal.id}`,
        source: "manual",
        status: "success",
        title: candidate.title,
        objective: candidate.evidence.objective,
        summary: candidate.summary,
        reflection: candidate.rationale.join(" | "),
        outcome: candidate.summary,
        toolCalls: candidate.evidence.toolNamesUsed.map((toolName: string) => ({ toolName, success: true })),
        artifactPaths: [],
        startedAt: candidate.createdAt,
        finishedAt: publishedAt,
      },
      createdAt: candidate.createdAt,
    };
  }

  private getMethodPublishPathCandidates(
    methodsDir: string,
    slug: string,
    nodeId: string | undefined,
    candidateId: string,
  ): string[] {
    const baseName = this.toSafeMethodFilenameBase(slug, nodeId ?? candidateId);
    const suffixNodeId = this.normalizeAsciiToken(nodeId, "node");
    const suffixCandidateId = this.normalizeAsciiToken(candidateId, "candidate");
    return [
      path.join(methodsDir, `${baseName}.md`),
      path.join(methodsDir, `${baseName}-${suffixNodeId}.md`),
      path.join(methodsDir, `${baseName}-${suffixCandidateId}.md`),
    ];
  }

  private getSkillPublishPathCandidates(
    skillsDir: string,
    slug: string,
    taskId: string,
    candidateId: string,
  ): string[] {
    const baseDirName = this.toSafeSkillDirName(slug, taskId);
    const taskToken = this.normalizeAsciiToken(taskId, "task");
    const candidateToken = this.normalizeAsciiToken(candidateId, "candidate");
    return [
      path.join(skillsDir, baseDirName, "SKILL.md"),
      path.join(skillsDir, `${baseDirName}-${taskToken}`, "SKILL.md"),
      path.join(skillsDir, `${baseDirName}-${candidateToken}`, "SKILL.md"),
    ];
  }

  private async findMatchingPublishedArtifactPath(
    candidates: string[],
    expectedContent: string,
  ): Promise<string | null> {
    for (const candidatePath of candidates) {
      if (!(await this.pathExists(candidatePath))) {
        continue;
      }
      const content = await fs.readFile(candidatePath, "utf-8").catch(() => null);
      if (content === expectedContent) {
        return candidatePath;
      }
    }
    return null;
  }

  private async getPublishedArtifactTimestamp(targetPath: string): Promise<string> {
    const stat = await fs.stat(targetPath);
    return stat.mtime.toISOString();
  }

  private async resolveMethodPublishPath(methodsDir: string, slug: string, nodeId: string | undefined, candidateId: string): Promise<string> {
    for (const filePath of this.getMethodPublishPathCandidates(methodsDir, slug, nodeId, candidateId)) {
      if (!(await this.pathExists(filePath))) {
        return filePath;
      }
    }
    const baseName = this.toSafeMethodFilenameBase(slug, nodeId ?? candidateId);
    const suffixCandidateId = this.normalizeAsciiToken(candidateId, "candidate");
    return path.join(methodsDir, `${baseName}-${suffixCandidateId}-${Date.now()}.md`);
  }

  private toSafeMethodFilenameBase(slug: string, fallback: string): string {
    const normalized = String(slug ?? "")
      .trim()
      .replace(/\.md$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || `method-${this.normalizeAsciiToken(fallback, "goal")}`;
  }

  private toSafeSkillDirName(slug: string, fallback: string): string {
    const normalized = String(slug ?? "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    return normalized || `skill-${this.normalizeAsciiToken(fallback, "task")}`;
  }

  private normalizeAsciiToken(value: string | undefined, fallback: string): string {
    const normalized = String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || fallback;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private resolveSuggestionReview(
    reviews: GoalSuggestionReviewState,
    reviewId?: string,
    suggestionType?: GoalSuggestionType,
    suggestionId?: string,
  ): GoalSuggestionReviewItem {
    const normalizedReviewId = reviewId?.trim();
    if (normalizedReviewId) {
      const matched = reviews.items.find((item) => item.id === normalizedReviewId);
      if (!matched) {
        throw new Error(`Suggestion review not found: ${normalizedReviewId}`);
      }
      return matched;
    }
    const normalizedSuggestionId = suggestionId?.trim();
    if (suggestionType && normalizedSuggestionId) {
      const matched = reviews.items.find((item) => item.suggestionType === suggestionType && item.suggestionId === normalizedSuggestionId);
      if (!matched) {
        throw new Error(`Suggestion review not found: ${suggestionType}/${normalizedSuggestionId}`);
      }
      return matched;
    }
    throw new Error("reviewId or suggestionType + suggestionId is required.");
  }

  private resolveTaskNode(graph: GoalTaskGraph, nodeId: string): GoalTaskNode {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error(`Task node not found: ${nodeId}`);
    }
    return node;
  }

  private resolveReviewTemplate(
    config: GoalReviewGovernanceConfig,
    target: GoalReviewTemplate["target"],
    options: {
      templateId?: string;
      suggestionType?: GoalSuggestionType;
      riskLevel?: GoalCapabilityPlan["riskLevel"];
      approvalMode?: GoalCheckpointPolicy["approvalMode"];
    } = {},
  ): GoalReviewTemplate | undefined {
    const candidates = config.templates.filter((item) => item.enabled !== false && (item.target === target || item.target === "all"));
    const explicitTemplateId = options.templateId?.trim();
    if (explicitTemplateId) {
      return candidates.find((item) => item.id === explicitTemplateId);
    }
    if (target === "suggestion_review" && config.defaults.suggestionTemplateId) {
      const defaultTemplate = candidates.find((item) => item.id === config.defaults.suggestionTemplateId);
      if (defaultTemplate) return defaultTemplate;
    }
    if (target === "checkpoint") {
      const byRisk = options.riskLevel ? config.defaults.checkpointTemplateByRisk?.[options.riskLevel] : undefined;
      if (byRisk) {
        const template = candidates.find((item) => item.id === byRisk);
        if (template) return template;
      }
      const byApprovalMode = options.approvalMode ? config.defaults.checkpointTemplateByApprovalMode?.[options.approvalMode] : undefined;
      if (byApprovalMode) {
        const template = candidates.find((item) => item.id === byApprovalMode);
        if (template) return template;
      }
    }
    return candidates.find((item) => {
      if (options.suggestionType && item.suggestionTypes && !item.suggestionTypes.includes(options.suggestionType)) return false;
      if (options.riskLevel && item.riskLevels && !item.riskLevels.includes(options.riskLevel)) return false;
      if (options.approvalMode && item.approvalModes && !item.approvalModes.includes(options.approvalMode)) return false;
      return true;
    });
  }

  private normalizeReminderMinutes(values: number[] | undefined): number[] | undefined {
    if (!values || values.length === 0) return undefined;
    const items = values
      .filter((item) => Number.isFinite(item) && item >= 0)
      .map((item) => Math.floor(item));
    return items.length > 0 ? [...new Set(items)].sort((left, right) => right - left) : undefined;
  }

  private normalizeReviewDeliveryChannels(values: GoalReviewDeliveryChannel[] | undefined): GoalReviewDeliveryChannel[] {
    if (!values || values.length === 0) return [];
    return [...new Set(values.filter((item) =>
      item === "goal_detail"
      || item === "goal_channel"
      || item === "reviewer_inbox"
      || item === "org_feed"
      || item === "im_dm"
      || item === "webhook"))];
  }

  private buildNotificationDispatchCounts(
    state: GoalReviewNotificationDispatchState,
  ): GoalReviewNotificationDispatchCounts {
    const byChannel: GoalReviewNotificationDispatchCounts["byChannel"] = {};
    const byStatus: GoalReviewNotificationDispatchCounts["byStatus"] = {};
    for (const item of state.items) {
      byChannel[item.channel] = (byChannel[item.channel] ?? 0) + 1;
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    }
    return {
      total: state.items.length,
      byChannel,
      byStatus,
    };
  }

  private resolveSuggestionReviewWorkflowInput(
    review: GoalSuggestionReviewItem,
    input: GoalSuggestionReviewWorkflowConfigureInput,
    config: GoalReviewGovernanceConfig,
  ): GoalSuggestionReviewWorkflowConfigureInput {
    const template = this.resolveReviewTemplate(config, "suggestion_review", {
      templateId: input.templateId,
      suggestionType: review.suggestionType,
    });
    const reminderMinutes = this.normalizeReminderMinutes(
      input.stages?.[0]?.reminderMinutes
      ?? template?.reminderMinutes
      ?? config.defaults.reminderMinutes,
    );
    return {
      ...input,
      templateId: input.templateId ?? template?.id,
      reviewers: input.reviewers && input.reviewers.length > 0 ? input.reviewers : template?.reviewers,
      reviewerRoles: input.reviewerRoles && input.reviewerRoles.length > 0 ? input.reviewerRoles : template?.reviewerRoles,
      minApprovals: input.minApprovals ?? template?.minApprovals,
      stages: input.stages && input.stages.length > 0
        ? input.stages.map((stage) => ({
          ...stage,
          reminderMinutes: this.normalizeReminderMinutes(stage.reminderMinutes ?? reminderMinutes),
        }))
        : template?.stages?.map((stage) => ({
          ...stage,
          reminderMinutes: this.normalizeReminderMinutes(stage.reminderMinutes ?? reminderMinutes),
        })) ?? (input.mode !== "chain" && reminderMinutes ? [{
          title: template?.title,
          reviewers: input.reviewers ?? template?.reviewers ?? [],
          reviewerRoles: input.reviewerRoles ?? template?.reviewerRoles,
          minApprovals: input.minApprovals ?? template?.minApprovals,
          slaHours: input.slaHours ?? template?.slaHours,
          reminderMinutes,
        }] : undefined),
      slaHours: input.slaHours ?? template?.slaHours,
      escalationMode: input.escalationMode ?? template?.escalationMode,
      escalationReviewer: input.escalationReviewer ?? template?.escalationReviewer,
      note: input.note,
    };
  }

  private resolveCheckpointPolicyForNode(
    plans: GoalCapabilityPlanState,
    nodeId: string,
    checkpointRequired: boolean,
    config: GoalReviewGovernanceConfig,
    basePolicy?: GoalCheckpointPolicy,
  ): GoalCheckpointPolicy {
    const plan = this.resolveCapabilityPlanForNode(plans, nodeId);
    const policySource = basePolicy ?? (plan
      ? {
        riskLevel: plan.riskLevel,
        approvalMode: plan.checkpoint.approvalMode,
        requiredRequestFields: [...plan.checkpoint.requiredRequestFields],
        requiredDecisionFields: [...plan.checkpoint.requiredDecisionFields],
        templateId: plan.checkpoint.templateId,
        workflowMode: plan.checkpoint.workflowMode,
        reviewers: plan.checkpoint.reviewers,
        reviewerRoles: plan.checkpoint.reviewerRoles,
        minApprovals: plan.checkpoint.minApprovals,
        stages: plan.checkpoint.stages,
        suggestedReviewer: plan.checkpoint.suggestedReviewer,
        suggestedReviewerRole: plan.checkpoint.suggestedReviewerRole,
        suggestedSlaHours: plan.checkpoint.suggestedSlaHours,
        reminderMinutes: plan.checkpoint.reminderMinutes,
        escalationMode: plan.checkpoint.escalationMode ?? "none",
        escalationReviewer: plan.checkpoint.escalationReviewer,
        rationale: [...plan.checkpoint.reasons],
      } satisfies GoalCheckpointPolicy
      : {
        approvalMode: checkpointRequired ? "single" : "none",
        requiredRequestFields: [],
        requiredDecisionFields: [],
        escalationMode: "none",
        rationale: checkpointRequired ? ["节点被显式标记为 checkpointRequired，但当前没有对应 capability plan。"] : [],
      } satisfies GoalCheckpointPolicy);
    const template = this.resolveReviewTemplate(config, "checkpoint", {
      templateId: policySource.templateId,
      riskLevel: plan?.riskLevel ?? policySource.riskLevel,
      approvalMode: policySource.approvalMode,
    });
    const reminderMinutes = this.normalizeReminderMinutes(
      policySource.reminderMinutes
      ?? template?.reminderMinutes
      ?? config.defaults.reminderMinutes,
    );
    return {
      riskLevel: plan?.riskLevel ?? policySource.riskLevel,
      approvalMode: policySource.approvalMode !== "none" ? policySource.approvalMode : (checkpointRequired ? "single" : "none"),
      requiredRequestFields: [...policySource.requiredRequestFields],
      requiredDecisionFields: [...policySource.requiredDecisionFields],
      templateId: policySource.templateId ?? template?.id,
      workflowMode: policySource.workflowMode ?? template?.mode ?? (checkpointRequired ? "single" : undefined),
      reviewers: policySource.reviewers && policySource.reviewers.length > 0
        ? [...policySource.reviewers]
        : template?.reviewers ?? (policySource.suggestedReviewer ? [policySource.suggestedReviewer] : undefined),
      reviewerRoles: policySource.reviewerRoles && policySource.reviewerRoles.length > 0
        ? [...policySource.reviewerRoles]
        : template?.reviewerRoles ?? (policySource.suggestedReviewerRole ? [policySource.suggestedReviewerRole] : undefined),
      minApprovals: policySource.minApprovals ?? template?.minApprovals,
      stages: policySource.stages && policySource.stages.length > 0
        ? policySource.stages.map((stage) => ({
          ...stage,
          reminderMinutes: this.normalizeReminderMinutes(stage.reminderMinutes ?? reminderMinutes),
        }))
        : template?.stages?.map((stage) => ({
          ...stage,
          reminderMinutes: this.normalizeReminderMinutes(stage.reminderMinutes ?? reminderMinutes),
        })),
      suggestedReviewer: policySource.suggestedReviewer ?? template?.reviewers?.[0],
      suggestedReviewerRole: policySource.suggestedReviewerRole ?? template?.reviewerRoles?.[0],
      suggestedSlaHours: policySource.suggestedSlaHours ?? template?.slaHours,
      reminderMinutes,
      escalationMode: policySource.escalationMode ?? template?.escalationMode ?? "none",
      escalationReviewer: policySource.escalationReviewer ?? template?.escalationReviewer,
      rationale: [...(policySource.rationale ?? [])],
    };
  }

  private buildCheckpointReviewProxy(checkpoint: GoalCheckpointItem): GoalSuggestionReviewItem {
    return {
      id: checkpoint.id,
      goalId: checkpoint.goalId ?? "",
      suggestionType: "flow_pattern",
      suggestionId: checkpoint.id,
      title: checkpoint.title,
      summary: checkpoint.summary ?? checkpoint.title,
      sourcePath: checkpoint.nodeId ?? checkpoint.id,
      nodeId: checkpoint.nodeId,
      runId: checkpoint.runId,
      status: checkpoint.status === "approved"
        ? "accepted"
        : checkpoint.status === "rejected"
          ? "rejected"
          : checkpoint.status === "expired"
            ? "deferred"
            : "pending_review",
      reviewer: checkpoint.reviewer,
      decidedBy: checkpoint.decidedBy,
      note: checkpoint.note,
      decidedAt: checkpoint.decidedAt,
      evidenceRefs: [],
      workflow: checkpoint.workflow,
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.updatedAt,
    };
  }

  private getCurrentCheckpointWorkflowReviewerRole(workflow: GoalSuggestionReviewWorkflow | undefined, reviewer: string | undefined): string | undefined {
    const stage = this.getPendingSuggestionReviewWorkflowStage(workflow)
      ?? (workflow ? workflow.stages[workflow.currentStageIndex] : undefined);
    if (!stage || !reviewer) return undefined;
    return stage.reviewers.find((item) => item.reviewer === reviewer)?.reviewerRole;
  }

  private buildCheckpointWorkflow(
    checkpoint: GoalCheckpointItem,
    policy: GoalCheckpointPolicy | undefined,
    now: string,
  ): GoalSuggestionReviewWorkflow | undefined {
    if (!policy) return undefined;
    const reviewers = policy.reviewers && policy.reviewers.length > 0
      ? policy.reviewers
      : (policy.suggestedReviewer ? [policy.suggestedReviewer] : []);
    if ((!policy.stages || policy.stages.length === 0) && reviewers.length === 0) {
      return undefined;
    }
    const workflow = this.buildSuggestionReviewWorkflow(this.buildCheckpointReviewProxy(checkpoint), {
      reviewId: checkpoint.id,
      mode: policy.workflowMode ?? (policy.approvalMode === "strict" ? "chain" : "single"),
      reviewers,
      reviewerRoles: policy.reviewerRoles && policy.reviewerRoles.length > 0
        ? policy.reviewerRoles
        : (policy.suggestedReviewerRole ? [policy.suggestedReviewerRole] : undefined),
      minApprovals: policy.minApprovals,
      stages: policy.stages?.map((stage) => ({
        ...stage,
        reminderMinutes: this.normalizeReminderMinutes(stage.reminderMinutes ?? policy.reminderMinutes),
      })),
      slaHours: policy.suggestedSlaHours,
      escalationMode: policy.escalationMode,
      escalationReviewer: policy.escalationReviewer,
      note: checkpoint.note,
    }, now);
    if (checkpoint.slaAt || policy.reminderMinutes) {
      const stage = workflow.stages[0];
      if (stage) {
        workflow.stages[0] = {
          ...stage,
          slaAt: checkpoint.slaAt ?? stage.slaAt,
          reminderMinutes: this.normalizeReminderMinutes(stage.reminderMinutes ?? policy.reminderMinutes),
        };
      }
    }
    return workflow;
  }

  private applyCheckpointTerminalDecision(
    checkpoint: GoalCheckpointItem,
    input: GoalCheckpointDecisionInput,
    context: Pick<GoalCheckpointItem, "reviewer" | "reviewerRole" | "requestedBy" | "decidedBy" | "slaAt">,
    status: GoalCheckpointItem["status"],
    action: GoalCheckpointHistoryEntry["action"],
    now: string,
  ): GoalCheckpointItem {
    return {
      ...checkpoint,
      status,
      summary: input.summary?.trim() || checkpoint.summary,
      note: input.note?.trim() || checkpoint.note,
      reviewer: context.reviewer,
      reviewerRole: context.reviewerRole,
      requestedBy: context.requestedBy,
      decidedBy: context.decidedBy,
      slaAt: context.slaAt,
      decidedAt: now,
      updatedAt: now,
      runId: input.runId?.trim() || checkpoint.runId,
      history: this.appendCheckpointHistory(checkpoint, {
        action,
        status,
        at: now,
        summary: input.summary?.trim() || checkpoint.summary,
        note: input.note?.trim() || checkpoint.note,
        actor: context.decidedBy,
        reviewer: context.reviewer,
        reviewerRole: context.reviewerRole,
        requestedBy: context.requestedBy,
        decidedBy: context.decidedBy,
        slaAt: context.slaAt,
        runId: input.runId?.trim() || checkpoint.runId,
      }),
    };
  }

  private applyCheckpointWorkflowDecision(
    checkpoint: GoalCheckpointItem,
    input: GoalCheckpointDecisionInput,
    context: Pick<GoalCheckpointItem, "reviewer" | "reviewerRole" | "requestedBy" | "decidedBy" | "slaAt">,
    decision: GoalSuggestionReviewWorkflowDecision,
    now: string,
  ): GoalCheckpointItem {
    const nextReview = this.applySuggestionReviewWorkflowDecision(this.buildCheckpointReviewProxy(checkpoint), {
      reviewId: checkpoint.id,
      decision,
      reviewer: context.decidedBy ?? context.reviewer,
      decidedBy: context.decidedBy,
      note: input.note?.trim() || checkpoint.note,
    }, now);
    const nextStatus: GoalCheckpointItem["status"] = nextReview.status === "accepted"
      ? "approved"
      : nextReview.status === "rejected"
        ? "rejected"
        : "waiting_user";
    const action: GoalCheckpointHistoryEntry["action"] = nextStatus === "waiting_user"
      ? "reviewed"
      : nextStatus === "approved"
        ? "approved"
        : "rejected";
    return {
      ...checkpoint,
      status: nextStatus,
      summary: input.summary?.trim() || checkpoint.summary,
      note: input.note?.trim() || checkpoint.note,
      reviewer: nextReview.reviewer,
      reviewerRole: this.getCurrentCheckpointWorkflowReviewerRole(nextReview.workflow, nextReview.reviewer) ?? context.reviewerRole,
      requestedBy: context.requestedBy,
      decidedBy: nextStatus === "waiting_user" ? undefined : context.decidedBy,
      slaAt: context.slaAt,
      decidedAt: nextStatus === "waiting_user" ? undefined : now,
      updatedAt: now,
      runId: input.runId?.trim() || checkpoint.runId,
      workflow: nextReview.workflow,
      history: this.appendCheckpointHistory(checkpoint, {
        action,
        status: nextStatus,
        at: now,
        summary: input.summary?.trim() || checkpoint.summary,
        note: input.note?.trim() || checkpoint.note,
        actor: context.decidedBy,
        reviewer: nextReview.reviewer,
        reviewerRole: this.getCurrentCheckpointWorkflowReviewerRole(nextReview.workflow, nextReview.reviewer) ?? context.reviewerRole,
        requestedBy: context.requestedBy,
        decidedBy: nextStatus === "waiting_user" ? undefined : context.decidedBy,
        slaAt: context.slaAt,
        runId: input.runId?.trim() || checkpoint.runId,
      }),
    };
  }

  private applyCheckpointWorkflowEscalation(
    checkpoint: GoalCheckpointItem,
    input: GoalCheckpointEscalateInput,
    now: string,
  ): GoalCheckpointItem {
    if (!checkpoint.workflow) {
      throw new Error("Checkpoint workflow is not configured.");
    }
    const nextReview = this.applySuggestionReviewEscalation(this.buildCheckpointReviewProxy(checkpoint), {
      reviewId: checkpoint.id,
      escalatedBy: input.escalatedBy,
      escalatedTo: input.escalatedTo,
      reason: input.reason,
      force: input.force,
    }, now);
    const reviewerRole = this.getCurrentCheckpointWorkflowReviewerRole(nextReview.workflow, nextReview.reviewer);
    return {
      ...checkpoint,
      reviewer: nextReview.reviewer,
      reviewerRole,
      note: input.reason?.trim() || checkpoint.note,
      workflow: nextReview.workflow,
      updatedAt: now,
      runId: input.runId?.trim() || checkpoint.runId,
      history: this.appendCheckpointHistory(checkpoint, {
        action: "escalated",
        status: checkpoint.status,
        at: now,
        summary: checkpoint.summary,
        note: input.reason?.trim() || checkpoint.note,
        actor: input.escalatedBy?.trim(),
        reviewer: nextReview.reviewer,
        reviewerRole,
        requestedBy: checkpoint.requestedBy,
        decidedBy: checkpoint.decidedBy,
        slaAt: checkpoint.slaAt,
        runId: input.runId?.trim() || checkpoint.runId,
      }),
    };
  }

  private getPendingCheckpointWorkflowStage(checkpoint: GoalCheckpointItem): GoalSuggestionReviewWorkflowStage | undefined {
    return this.getPendingSuggestionReviewWorkflowStage(checkpoint.workflow);
  }

  private isCheckpointWorkflowOverdue(checkpoint: GoalCheckpointItem, now: string): boolean {
    const stage = this.getPendingCheckpointWorkflowStage(checkpoint);
    if (stage) {
      return this.isSuggestionReviewWorkflowStageOverdue(stage, now);
    }
    if ((checkpoint.status !== "required" && checkpoint.status !== "waiting_user") || !checkpoint.slaAt) {
      return false;
    }
    return new Date(now).getTime() > new Date(checkpoint.slaAt).getTime();
  }

  private listActionableCheckpoints(items: GoalCheckpointItem[], now: string): GoalCheckpointItem[] {
    return items
      .filter((item) => item.status === "required" || item.status === "waiting_user")
      .sort((left, right) => {
        const leftOverdue = this.isCheckpointWorkflowOverdue(left, now) ? 1 : 0;
        const rightOverdue = this.isCheckpointWorkflowOverdue(right, now) ? 1 : 0;
        if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }

  private scanCheckpointApprovalWorkflows(
    checkpoints: GoalCheckpointItem[],
    scannedAt: string,
    autoEscalate: boolean,
  ): {
    items: GoalCheckpointItem[];
    scanItems: GoalApprovalWorkflowScanItem[];
    overdueCount: number;
    escalatedCount: number;
    mutated: boolean;
  } {
    const scanItems: GoalApprovalWorkflowScanItem[] = [];
    let overdueCount = 0;
    let escalatedCount = 0;
    let mutated = false;
    const items = checkpoints.map((checkpoint) => {
      if (checkpoint.status !== "required" && checkpoint.status !== "waiting_user") {
        return checkpoint;
      }
      const pendingStage = this.getPendingCheckpointWorkflowStage(checkpoint);
      const overdue = this.isCheckpointWorkflowOverdue(checkpoint, scannedAt);
      if (!overdue) {
        return checkpoint;
      }
      overdueCount += 1;
      let nextCheckpoint = checkpoint;
      let action: GoalApprovalWorkflowScanItem["action"] = "overdue";
      let escalated = false;
      if (pendingStage && checkpoint.workflow) {
        const overdueMarked = this.markSuggestionReviewWorkflowStageOverdue(this.buildCheckpointReviewProxy(nextCheckpoint), scannedAt);
        if (overdueMarked.workflow && overdueMarked.workflow !== nextCheckpoint.workflow) {
          nextCheckpoint = {
            ...nextCheckpoint,
            reviewer: overdueMarked.reviewer,
            workflow: overdueMarked.workflow,
            updatedAt: scannedAt,
          };
          mutated = true;
        }
        if (autoEscalate) {
          const escalatedReview = this.tryAutoEscalateSuggestionReview(this.buildCheckpointReviewProxy(nextCheckpoint), scannedAt);
          if (escalatedReview.workflow && escalatedReview.workflow !== nextCheckpoint.workflow) {
            nextCheckpoint = {
              ...nextCheckpoint,
              reviewer: escalatedReview.reviewer,
              reviewerRole: this.getCurrentCheckpointWorkflowReviewerRole(escalatedReview.workflow, escalatedReview.reviewer) ?? nextCheckpoint.reviewerRole,
              workflow: escalatedReview.workflow,
              updatedAt: scannedAt,
              history: this.appendCheckpointHistory(nextCheckpoint, {
                action: "escalated",
                status: nextCheckpoint.status,
                at: scannedAt,
                summary: nextCheckpoint.summary,
                note: "SLA overdue auto escalation",
                actor: "workflow_scan",
                reviewer: escalatedReview.reviewer,
                reviewerRole: this.getCurrentCheckpointWorkflowReviewerRole(escalatedReview.workflow, escalatedReview.reviewer) ?? nextCheckpoint.reviewerRole,
                requestedBy: nextCheckpoint.requestedBy,
                decidedBy: nextCheckpoint.decidedBy,
                slaAt: nextCheckpoint.slaAt,
                runId: nextCheckpoint.runId,
              }),
            };
            action = "auto_escalated";
            escalated = true;
            escalatedCount += 1;
            mutated = true;
          }
        }
      }
      const stage = this.getPendingCheckpointWorkflowStage(nextCheckpoint) ?? pendingStage;
      scanItems.push({
        targetType: "checkpoint",
        targetId: nextCheckpoint.id,
        title: nextCheckpoint.title,
        nodeId: nextCheckpoint.nodeId,
        stageId: stage?.id ?? "checkpoint",
        stageTitle: stage?.title ?? "Checkpoint Approval",
        stageIndex: nextCheckpoint.workflow?.currentStageIndex ?? 0,
        reviewer: nextCheckpoint.reviewer,
        slaAt: stage?.slaAt ?? nextCheckpoint.slaAt,
        overdue: true,
        overdueMinutes: (stage?.slaAt ?? nextCheckpoint.slaAt)
          ? Math.max(0, Math.floor((new Date(scannedAt).getTime() - new Date(stage?.slaAt ?? nextCheckpoint.slaAt as string).getTime()) / (60 * 1000)))
          : undefined,
        escalated,
        action,
      });
      return nextCheckpoint;
    });
    return { items, scanItems, overdueCount, escalatedCount, mutated };
  }

  private collectApprovalNotifications(
    goal: LongTermGoal,
    config: GoalReviewGovernanceConfig,
    reviews: GoalSuggestionReviewItem[],
    checkpoints: GoalCheckpointItem[],
    existingState: GoalReviewNotificationState,
    reviewScanItems: GoalSuggestionReviewWorkflowScanItem[],
    checkpointScanItems: GoalApprovalWorkflowScanItem[],
    now: string,
  ): { state: GoalReviewNotificationState; created: GoalReviewNotification[] } {
    const created: GoalReviewNotification[] = [];
    const dedupe = new Set(existingState.items.map((item) => item.dedupeKey));
    const items = [...existingState.items];
    const append = (notification: GoalReviewNotification) => {
      if (dedupe.has(notification.dedupeKey)) return;
      dedupe.add(notification.dedupeKey);
      items.push(notification);
      created.push(notification);
    };
    for (const review of reviews) {
      const stage = this.getPendingSuggestionReviewWorkflowStage(review.workflow);
      if (!stage) continue;
      this.appendWorkflowNotifications(append, goal, config, {
        targetType: "suggestion_review",
        targetId: review.id,
        title: review.title,
        nodeId: review.nodeId,
        reviewer: review.reviewer,
        stageId: stage.id,
        stageTitle: stage.title,
        slaAt: stage.slaAt,
        reminderMinutes: stage.reminderMinutes,
        action: reviewScanItems.find((item) => item.reviewId === review.id)?.action,
        escalatedTo: stage.escalation.escalatedTo,
      }, now);
    }
    for (const checkpoint of checkpoints) {
      const stage = this.getPendingCheckpointWorkflowStage(checkpoint);
      this.appendWorkflowNotifications(append, goal, config, {
        targetType: "checkpoint",
        targetId: checkpoint.id,
        title: checkpoint.title,
        nodeId: checkpoint.nodeId,
        reviewer: checkpoint.reviewer,
        stageId: stage?.id,
        stageTitle: stage?.title ?? "Checkpoint Approval",
        slaAt: stage?.slaAt ?? checkpoint.slaAt,
        reminderMinutes: stage?.reminderMinutes ?? checkpoint.policy?.reminderMinutes,
        action: checkpointScanItems.find((item) => item.targetId === checkpoint.id)?.action,
        escalatedTo: stage?.escalation.escalatedTo,
      }, now);
    }
    return {
      state: {
        version: 1,
        items: items.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(-200),
      },
      created,
    };
  }

  private materializeNotificationDispatches(
    goal: LongTermGoal,
    config: GoalReviewGovernanceConfig,
    existingState: GoalReviewNotificationDispatchState,
    notifications: GoalReviewNotification[],
    now: string,
  ): { state: GoalReviewNotificationDispatchState; created: GoalReviewNotificationDispatch[] } {
    if (notifications.length === 0) {
      return { state: existingState, created: [] };
    }
    const created: GoalReviewNotificationDispatch[] = [];
    const dedupe = new Set(existingState.items.map((item) => item.dedupeKey));
    const items = [...existingState.items];
    const append = (dispatch: GoalReviewNotificationDispatch) => {
      if (dedupe.has(dispatch.dedupeKey)) return;
      dedupe.add(dispatch.dedupeKey);
      items.push(dispatch);
      created.push(dispatch);
    };
    for (const notification of notifications) {
      const targets = this.resolveNotificationDispatchTargets(goal, config, notification);
      for (const target of targets) {
        const seed = `${notification.id}:${target.channel}:${target.routeKey ?? target.recipient ?? ""}`;
        const suffix = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10);
        append({
          id: `review_dispatch_${goal.id}_${suffix}`,
          notificationId: notification.id,
          goalId: notification.goalId,
          targetType: notification.targetType,
          targetId: notification.targetId,
          nodeId: notification.nodeId,
          stageId: notification.stageId,
          kind: notification.kind,
          channel: target.channel,
          recipient: target.recipient,
          routeKey: target.routeKey,
          message: notification.message,
          dedupeKey: `${notification.dedupeKey}:dispatch:${target.channel}:${target.routeKey ?? target.recipient ?? "default"}`,
          status: target.status,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return {
      state: {
        version: 1,
        items: items.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(-400),
      },
      created,
    };
  }

  private resolveNotificationDispatchTargets(
    goal: LongTermGoal,
    config: GoalReviewGovernanceConfig,
    notification: GoalReviewNotification,
  ): Array<{
    channel: GoalReviewDeliveryChannel;
    recipient?: string;
    routeKey?: string;
    status: GoalReviewNotificationDispatch["status"];
  }> {
    const targets = new Map<string, {
      channel: GoalReviewDeliveryChannel;
      recipient?: string;
      routeKey?: string;
      status: GoalReviewNotificationDispatch["status"];
    }>();
    const reviewer = notification.recipient
      ? config.reviewers.find((item) => item.id === notification.recipient && item.active !== false)
      : undefined;
    const addChannel = (
      channel: GoalReviewDeliveryChannel,
      recipient?: string,
    ) => {
      if ((channel === "reviewer_inbox" || channel === "im_dm") && !recipient) return;
      const routeKey = this.resolveNotificationDispatchRouteKey(goal, config, notification, channel, recipient);
      const key = `${channel}:${recipient ?? ""}:${routeKey ?? ""}`;
      if (targets.has(key)) return;
      targets.set(key, {
        channel,
        recipient,
        routeKey,
        status: this.resolveNotificationDispatchStatus(channel),
      });
    };

    for (const channel of this.normalizeReviewDeliveryChannels(config.defaults.notificationChannels)) {
      addChannel(channel, notification.recipient);
    }
    if (notification.kind === "sla_overdue" || notification.kind === "auto_escalated") {
      addChannel("goal_channel");
    }
    if (notification.kind === "auto_escalated") {
      addChannel("org_feed");
    }
    for (const channel of this.normalizeReviewDeliveryChannels(reviewer?.channels)) {
      addChannel(channel, notification.recipient);
    }
    addChannel("goal_detail");
    return [...targets.values()];
  }

  private resolveNotificationDispatchRouteKey(
    goal: LongTermGoal,
    config: GoalReviewGovernanceConfig,
    notification: GoalReviewNotification,
    channel: GoalReviewDeliveryChannel,
    recipient?: string,
  ): string | undefined {
    const configured = config.defaults.notificationRoutes?.[channel];
    if (configured) {
      return configured
        .replaceAll("{goalId}", goal.id)
        .replaceAll("{targetId}", notification.targetId)
        .replaceAll("{targetType}", notification.targetType)
        .replaceAll("{kind}", notification.kind)
        .replaceAll("{recipient}", recipient ?? "")
        .replaceAll("{stageId}", notification.stageId ?? "")
        .replaceAll("{nodeId}", notification.nodeId ?? "");
    }
    switch (channel) {
      case "goal_detail":
        return `goal:${goal.id}:detail`;
      case "goal_channel":
        return `goal:${goal.id}:channel`;
      case "reviewer_inbox":
        return recipient ? `reviewer:${recipient}:inbox` : undefined;
      case "org_feed":
        return "org:review-governance";
      case "im_dm":
        return recipient ? `reviewer:${recipient}:im_dm` : undefined;
      case "webhook":
        return recipient ? `reviewer:${recipient}:webhook` : "org:webhook";
      default:
        return undefined;
    }
  }

  private resolveNotificationDispatchStatus(
    channel: GoalReviewDeliveryChannel,
  ): GoalReviewNotificationDispatch["status"] {
    return channel === "im_dm" || channel === "webhook" ? "pending" : "materialized";
  }

  private appendWorkflowNotifications(
    append: (notification: GoalReviewNotification) => void,
    goal: LongTermGoal,
    config: GoalReviewGovernanceConfig,
    input: {
      targetType: GoalReviewNotification["targetType"];
      targetId: string;
      title: string;
      nodeId?: string;
      reviewer?: string;
      stageId?: string;
      stageTitle: string;
      slaAt?: string;
      reminderMinutes?: number[];
      action?: GoalSuggestionReviewWorkflowScanItem["action"];
      escalatedTo?: string;
    },
    now: string,
  ): void {
    const reminderMinutes = this.normalizeReminderMinutes(input.reminderMinutes ?? config.defaults.reminderMinutes);
    const stageKey = input.stageId ?? "checkpoint";
    if (input.slaAt && reminderMinutes) {
      const minutesUntil = Math.floor((new Date(input.slaAt).getTime() - new Date(now).getTime()) / (60 * 1000));
      for (const minute of reminderMinutes) {
        if (minutesUntil <= minute && minutesUntil >= 0) {
          append({
            id: `review_notification_${goal.id}_${input.targetType}_${input.targetId}_${stageKey}_reminder_${minute}`,
            goalId: goal.id,
            targetType: input.targetType,
            targetId: input.targetId,
            nodeId: input.nodeId,
            stageId: input.stageId,
            recipient: input.reviewer,
            kind: "sla_reminder",
            message: `${input.title} / ${input.stageTitle} 将在 ${minute} 分钟内到期`,
            dedupeKey: `${input.targetType}:${input.targetId}:${stageKey}:reminder:${minute}`,
            createdAt: now,
          });
        }
      }
      if (new Date(now).getTime() > new Date(input.slaAt).getTime()) {
        append({
          id: `review_notification_${goal.id}_${input.targetType}_${input.targetId}_${stageKey}_overdue`,
          goalId: goal.id,
          targetType: input.targetType,
          targetId: input.targetId,
          nodeId: input.nodeId,
          stageId: input.stageId,
          recipient: input.reviewer,
          kind: "sla_overdue",
          message: `${input.title} / ${input.stageTitle} 已超过 SLA`,
          dedupeKey: `${input.targetType}:${input.targetId}:${stageKey}:overdue`,
          createdAt: now,
        });
      }
    }
    if (input.action === "auto_escalated") {
      append({
        id: `review_notification_${goal.id}_${input.targetType}_${input.targetId}_${stageKey}_auto_escalated`,
        goalId: goal.id,
        targetType: input.targetType,
        targetId: input.targetId,
        nodeId: input.nodeId,
        stageId: input.stageId,
        recipient: input.escalatedTo ?? input.reviewer,
        kind: "auto_escalated",
        message: `${input.title} / ${input.stageTitle} 已自动升级给 ${input.escalatedTo ?? input.reviewer ?? "下一位 reviewer"}`,
        dedupeKey: `${input.targetType}:${input.targetId}:${stageKey}:auto_escalated`,
        createdAt: now,
      });
    }
  }

  private replaceCheckpoint(
    checkpoints: GoalCheckpointState,
    checkpoint: GoalCheckpointItem,
  ): GoalCheckpointState {
    return {
      version: 2,
      items: checkpoints.items.map((item) => (item.id === checkpoint.id ? checkpoint : item)),
    };
  }

  private appendCheckpointHistory(
    checkpoint: GoalCheckpointItem,
    entry: GoalCheckpointHistoryEntry,
  ): GoalCheckpointHistoryEntry[] {
    return [...checkpoint.history, entry];
  }

  private assertCheckpointRequestPolicy(
    policy: GoalCheckpointPolicy | undefined,
    value: {
      reviewer?: string;
      reviewerRole?: string;
      requestedBy?: string;
      slaAt?: string;
      summary?: string;
      note?: string;
    },
    action = "request",
  ): void {
    const effectivePolicy = policy ?? {
      approvalMode: "none" as const,
      requiredRequestFields: [],
      requiredDecisionFields: [],
      escalationMode: "none" as const,
    };
    const missing = effectivePolicy.requiredRequestFields.filter((field) => !this.readCheckpointPolicyField(field, value));
    if (missing.length === 0) return;
    throw new Error(`Checkpoint policy requires ${action} fields: ${missing.join(", ")}`);
  }

  private assertCheckpointDecisionPolicy(
    policy: GoalCheckpointPolicy | undefined,
    value: {
      summary?: string;
      note?: string;
      decidedBy?: string;
      reviewer?: string;
      reviewerRole?: string;
      requestedBy?: string;
      slaAt?: string;
    },
    action: "approve" | "reject" | "expire",
  ): void {
    const effectivePolicy = policy ?? {
      approvalMode: "none" as const,
      requiredRequestFields: [],
      requiredDecisionFields: [],
      escalationMode: "none" as const,
    };
    const missing = effectivePolicy.requiredDecisionFields.filter((field) => !this.readCheckpointPolicyField(field, value));
    if (missing.length === 0) return;
    throw new Error(`Checkpoint policy requires ${action} fields: ${missing.join(", ")}`);
  }

  private readCheckpointPolicyField(
    field: GoalCheckpointPolicy["requiredRequestFields"][number],
    value: {
      reviewer?: string;
      reviewerRole?: string;
      requestedBy?: string;
      slaAt?: string;
      summary?: string;
      note?: string;
      decidedBy?: string;
    },
  ): string | undefined {
    const raw = value[field];
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    return normalized || undefined;
  }

  private resolveCheckpointContext(
    input: {
      reviewer?: string;
      reviewerRole?: string;
      requestedBy?: string;
      decidedBy?: string;
      slaAt?: string;
    },
    checkpoint?: GoalCheckpointItem,
    options: { clearDecidedBy?: boolean } = {},
  ): Pick<GoalCheckpointItem, "reviewer" | "reviewerRole" | "requestedBy" | "decidedBy" | "slaAt"> {
    const reviewer = input.reviewer?.trim() || checkpoint?.reviewer;
    const reviewerRole = input.reviewerRole?.trim() || checkpoint?.reviewerRole;
    const requestedBy = input.requestedBy?.trim() || checkpoint?.requestedBy;
    const decidedBy = options.clearDecidedBy
      ? undefined
      : input.decidedBy?.trim() || checkpoint?.decidedBy;
    const slaAt = input.slaAt?.trim() || checkpoint?.slaAt;
    return {
      reviewer: reviewer || undefined,
      reviewerRole: reviewerRole || undefined,
      requestedBy: requestedBy || undefined,
      decidedBy: decidedBy || undefined,
      slaAt: slaAt || undefined,
    };
  }
}
