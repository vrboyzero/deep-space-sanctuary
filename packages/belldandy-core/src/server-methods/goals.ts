import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import type { GoalCapabilityPlanFinalApprovalMode } from "../goals/types.js";

import { resolveCommanderRuntimeSwitches } from "../commander-runtime-switches.js";
import { buildLearningReviewInput } from "../learning-review-input.js";
import { buildMindProfileSnapshot } from "../mind-profile-snapshot.js";
import type { GoalManager } from "../goals/manager.js";
import type { ScopedMemoryManagerRecord } from "../resident-memory-managers.js";

type GoalsMethodContext = {
  goalManager?: GoalManager;
  stateDir: string;
  residentMemoryManagers?: ScopedMemoryManagerRecord[];
  readEnv?: (name: string) => string | undefined;
  parseGoalTaskCheckpointStatus: (value: unknown) => "not_required" | "required" | "waiting_user" | "approved" | "rejected" | "expired" | undefined;
  parseGoalTaskCreateStatus: (value: unknown) => "draft" | "ready" | "blocked" | "skipped" | undefined;
};

const SUGGESTION_TYPES = ["method_candidate", "skill_candidate", "flow_pattern"] as const;
const GOAL_CAPABILITY_EXECUTION_MODES = ["single_agent", "multi_agent", "multi_agent_parallel", "multi_agent_sequential", "auto"] as const;
const GOAL_CAPABILITY_GOVERNANCE_MODES = ["direct", "commander", "auto"] as const;
const GOAL_CAPABILITY_FINAL_APPROVAL_MODES = ["user_required", "agent_auto_complete"] as const;
const GOAL_COMMANDER_DECISIONS = ["accept", "rework", "escalate"] as const;

export async function handleGoalMethod(
  req: GatewayReqFrame,
  ctx: GoalsMethodContext,
): Promise<GatewayResFrame | null> {
  if (!req.method.startsWith("goal.")) {
    return null;
  }

  if (!ctx.goalManager) {
    return { type: "res", id: req.id, ok: false, error: { code: "not_available", message: "Goal manager is not available." } };
  }

  const params = asRecord(req.params);

  switch (req.method) {
    case "goal.create": {
      const title = readRequiredString(params, "title");
      if (!title) return invalid(req.id, "title is required");
      try {
        const goal = await ctx.goalManager.createGoal({
          title,
          objective: readOptionalString(params, "objective"),
          slug: readOptionalString(params, "slug"),
          goalRoot: readOptionalString(params, "goalRoot"),
        });
        return { type: "res", id: req.id, ok: true, payload: { goal, conversationId: goal.activeConversationId } };
      } catch (err) {
        return failure(req.id, "goal_create_failed", err);
      }
    }

    case "goal.list": {
      const goals = await ctx.goalManager.listGoals();
      return { type: "res", id: req.id, ok: true, payload: { goals } };
    }

    case "goal.get": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      const goal = await ctx.goalManager.getGoal(goalId);
      if (!goal) return notFound(req.id, "Goal not found.");
      return { type: "res", id: req.id, ok: true, payload: { goal } };
    }

    case "goal.resume": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const result = await ctx.goalManager.resumeGoal(goalId, readOptionalString(params, "nodeId"), {
          checkpointId: readOptionalString(params, "checkpointId"),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_resume_failed", err);
      }
    }

    case "goal.pause": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const goal = await ctx.goalManager.pauseGoal(goalId);
        return { type: "res", id: req.id, ok: true, payload: { goal } };
      } catch (err) {
        return failure(req.id, "goal_pause_failed", err);
      }
    }

    case "goal.handoff.get": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.getHandoff.bind(ctx.goalManager), "goal_handoff_get_failed");
    }

    case "goal.handoff.generate": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.generateHandoff.bind(ctx.goalManager), "goal_handoff_generate_failed");
    }

    case "goal.retrospect.generate": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.generateRetrospective.bind(ctx.goalManager), "goal_retrospect_generate_failed");
    }

    case "goal.experience.suggest": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.generateExperienceSuggestions.bind(ctx.goalManager), "goal_experience_suggest_failed");
    }

    case "goal.method_candidates.generate": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.generateMethodCandidates.bind(ctx.goalManager), "goal_method_candidates_generate_failed");
    }

    case "goal.skill_candidates.generate": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.generateSkillCandidates.bind(ctx.goalManager), "goal_skill_candidates_generate_failed");
    }

    case "goal.flow_patterns.generate": {
      return callGoalOnly(req.id, params, "goalId is required", ctx.goalManager.generateFlowPatterns.bind(ctx.goalManager), "goal_flow_patterns_generate_failed");
    }

    case "goal.flow_patterns.cross_goal": {
      try {
        const result = await ctx.goalManager.generateCrossGoalFlowPatterns();
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_cross_goal_flow_patterns_generate_failed", err);
      }
    }

    case "goal.review_governance.summary": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const summary = await ctx.goalManager.getReviewGovernanceSummary(goalId);
        const mindProfileSnapshot = await buildMindProfileSnapshot({
          stateDir: ctx.stateDir,
          residentMemoryManagers: ctx.residentMemoryManagers,
          agentId: readOptionalString(params, "agentId"),
        });
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: {
            summary: {
              ...summary,
              learningReviewInput: buildLearningReviewInput({
                mindProfileSnapshot,
                goalReviewGovernanceSummary: summary,
              }),
            },
          },
        };
      } catch (err) {
        return failure(req.id, "goal_review_governance_summary_failed", err);
      }
    }

    case "goal.approval.scan": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const result = await ctx.goalManager.scanApprovalWorkflows(goalId, {
          now: readOptionalString(params, "now"),
          autoEscalate: params.autoEscalate === true,
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_approval_scan_failed", err);
      }
    }

    case "goal.suggestion_review.list": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const reviews = await ctx.goalManager.listSuggestionReviews(goalId);
        return { type: "res", id: req.id, ok: true, payload: { reviews } };
      } catch (err) {
        return failure(req.id, "goal_suggestion_review_list_failed", err);
      }
    }

    case "goal.suggestion_review.workflow.set": {
      const goalId = readRequiredString(params, "goalId");
      const mode = readRequiredString(params, "mode");
      const suggestionType = readOptionalString(params, "suggestionType");
      if (!goalId || !mode) return invalid(req.id, "goalId and mode are required");
      if (!["single", "chain", "quorum"].includes(mode)) return invalid(req.id, "mode is invalid");
      if (suggestionType && !isSuggestionType(suggestionType)) return invalid(req.id, "suggestionType is invalid");
      try {
        const result = await ctx.goalManager.configureSuggestionReviewWorkflow(goalId, {
          reviewId: readOptionalString(params, "reviewId"),
          suggestionType: suggestionType as typeof SUGGESTION_TYPES[number] | undefined,
          suggestionId: readOptionalString(params, "suggestionId"),
          mode: mode as "single" | "chain" | "quorum",
          reviewers: readStringArray(params.reviewers),
          reviewerRoles: readStringArray(params.reviewerRoles),
          minApprovals: readFiniteNumber(params.minApprovals),
          stages: Array.isArray(params.stages)
            ? params.stages.map((item) => {
              const stage = asRecord(item);
              return {
                title: readOptionalString(stage, "title"),
                reviewers: readStringArray(stage.reviewers) ?? [],
                reviewerRoles: readStringArray(stage.reviewerRoles),
                minApprovals: readFiniteNumber(stage.minApprovals),
                slaHours: readFiniteNumber(stage.slaHours),
              };
            }).filter((item) => item.reviewers.length > 0)
            : undefined,
          slaHours: readFiniteNumber(params.slaHours),
          escalationMode: typeof params.escalationMode === "string" && (params.escalationMode === "none" || params.escalationMode === "manual")
            ? params.escalationMode
            : undefined,
          escalationReviewer: readOptionalString(params, "escalationReviewer"),
          note: readOptionalString(params, "note"),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_suggestion_review_workflow_set_failed", err);
      }
    }

    case "goal.suggestion_review.decide": {
      const goalId = readRequiredString(params, "goalId");
      const decision = readRequiredString(params, "decision");
      const suggestionType = readOptionalString(params, "suggestionType");
      if (!goalId || !decision) return invalid(req.id, "goalId and decision are required");
      if (!["accepted", "rejected", "deferred", "needs_revision"].includes(decision)) return invalid(req.id, "decision is invalid");
      if (suggestionType && !isSuggestionType(suggestionType)) return invalid(req.id, "suggestionType is invalid");
      try {
        const result = await ctx.goalManager.decideSuggestionReview(goalId, {
          reviewId: readOptionalString(params, "reviewId"),
          suggestionType: suggestionType as typeof SUGGESTION_TYPES[number] | undefined,
          suggestionId: readOptionalString(params, "suggestionId"),
          decision: decision as "accepted" | "rejected" | "deferred" | "needs_revision",
          reviewer: readOptionalString(params, "reviewer"),
          decidedBy: readOptionalString(params, "decidedBy"),
          note: readOptionalString(params, "note"),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_suggestion_review_decide_failed", err);
      }
    }

    case "goal.suggestion_review.escalate": {
      const goalId = readRequiredString(params, "goalId");
      const suggestionType = readOptionalString(params, "suggestionType");
      if (!goalId) return invalid(req.id, "goalId is required");
      if (suggestionType && !isSuggestionType(suggestionType)) return invalid(req.id, "suggestionType is invalid");
      try {
        const result = await ctx.goalManager.escalateSuggestionReview(goalId, {
          reviewId: readOptionalString(params, "reviewId"),
          suggestionType: suggestionType as typeof SUGGESTION_TYPES[number] | undefined,
          suggestionId: readOptionalString(params, "suggestionId"),
          escalatedBy: readOptionalString(params, "escalatedBy"),
          escalatedTo: readOptionalString(params, "escalatedTo"),
          reason: readOptionalString(params, "reason"),
          force: Boolean(params.force),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_suggestion_review_escalate_failed", err);
      }
    }

    case "goal.suggestion_review.scan": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const result = await ctx.goalManager.scanSuggestionReviewWorkflows(goalId, {
          now: readOptionalString(params, "now"),
          autoEscalate: Boolean(params.autoEscalate),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_suggestion_review_scan_failed", err);
      }
    }

    case "goal.suggestion.publish": {
      const goalId = readRequiredString(params, "goalId");
      const suggestionType = readOptionalString(params, "suggestionType");
      if (!goalId) return invalid(req.id, "goalId is required");
      if (suggestionType && !isSuggestionType(suggestionType)) return invalid(req.id, "suggestionType is invalid");
      try {
        const result = await ctx.goalManager.publishSuggestion(goalId, {
          reviewId: readOptionalString(params, "reviewId"),
          suggestionType: suggestionType as typeof SUGGESTION_TYPES[number] | undefined,
          suggestionId: readOptionalString(params, "suggestionId"),
          reviewer: readOptionalString(params, "reviewer"),
          decidedBy: readOptionalString(params, "decidedBy"),
          note: readOptionalString(params, "note"),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_suggestion_publish_failed", err);
      }
    }

    case "goal.checkpoint.list": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const checkpoints = await ctx.goalManager.listCheckpoints(goalId);
        return { type: "res", id: req.id, ok: true, payload: { checkpoints } };
      } catch (err) {
        return failure(req.id, "goal_checkpoint_list_failed", err);
      }
    }

    case "goal.capability.get": {
      const goalId = readRequiredString(params, "goalId");
      const nodeId = readRequiredString(params, "nodeId");
      if (!goalId || !nodeId) return invalid(req.id, "goalId and nodeId are required");
      try {
        const plan = await ctx.goalManager.getCapabilityPlan(goalId, nodeId);
        if (!plan) return notFound(req.id, "Capability plan not found.");
        return { type: "res", id: req.id, ok: true, payload: { plan } };
      } catch (err) {
        return failure(req.id, "goal_capability_get_failed", err);
      }
    }

    case "goal.capability.update": {
      const goalId = readRequiredString(params, "goalId");
      const nodeId = readRequiredString(params, "nodeId");
      if (!goalId || !nodeId) return invalid(req.id, "goalId and nodeId are required");
      try {
        const existing = await ctx.goalManager.getCapabilityPlan(goalId, nodeId);
        if (!existing) return notFound(req.id, "Capability plan not found.");
        const executionMode = readGoalCapabilityExecutionMode(params.executionMode) ?? existing.executionMode;
        const governanceMode = readGoalCapabilityGovernanceMode(params.governanceMode) ?? existing.governanceMode;
        const finalApprovalMode = readGoalCapabilityFinalApprovalMode(params.finalApprovalMode);
        const orchestration = {
          ...(existing.orchestration ?? {}),
          ...(finalApprovalMode ? { finalApprovalMode } : {}),
        };
        const plan = await ctx.goalManager.saveCapabilityPlan(goalId, nodeId, {
          ...existing,
          executionMode,
          governanceMode,
          commanderAgentId: readOptionalString(params, "commanderAgentId") ?? existing.commanderAgentId,
          preferredAgents: readStringArray(params.preferredAgents) ?? existing.preferredAgents,
          orchestratedAt: existing.orchestratedAt,
          orchestration,
        });
        return { type: "res", id: req.id, ok: true, payload: { plan } };
      } catch (err) {
        return failure(req.id, "goal_capability_update_failed", err);
      }
    }

    case "goal.capability.commander_decide": {
      const goalId = readRequiredString(params, "goalId");
      const nodeId = readRequiredString(params, "nodeId");
      const decision = readGoalCommanderDecision(params.decision);
      if (!goalId || !nodeId || !decision) return invalid(req.id, "goalId, nodeId and valid decision are required");
      try {
        const plan = await ctx.goalManager.getCapabilityPlan(goalId, nodeId);
        if (!plan) return notFound(req.id, "Capability plan not found.");
        if (plan.governanceMode !== "commander") {
          return invalid(req.id, `Node ${nodeId} is not using commander governance.`);
        }
        const gate = plan.orchestration?.acceptanceGate;
        if (!gate) {
          return invalid(req.id, `Node ${nodeId} has no acceptance gate yet.`);
        }
        if (decision === "accept" && gate.status !== "accepted") {
          return invalid(req.id, `Current acceptance gate status is ${gate.status}, cannot accept.`);
        }
        const summary = readOptionalString(params, "summary");
        const note = readOptionalString(params, "note");
        const runId = readOptionalString(params, "runId");
        const resolvedFinalApprovalMode = resolveGoalCommanderFinalApprovalMode(
          typeof params.requireUserApproval === "boolean" ? params.requireUserApproval : undefined,
          plan.orchestration?.finalApprovalMode,
        );
        const nextReworkRevisionCount = decision === "rework"
          ? (plan.orchestration?.reworkRevisionCount ?? 0) + 1
          : (plan.orchestration?.reworkRevisionCount ?? 0);
        const reworkTargetAgentIds = decision === "rework"
          ? resolveGoalCommanderReworkTargetAgentIds(plan)
          : (plan.orchestration?.reworkTargetAgentIds ?? []);
        const reworkContext = decision === "rework"
          ? buildGoalCommanderReworkContext({
            summary,
            note,
            gateSummary: gate.summary,
            gateManagerActionHint: gate.managerActionHint,
            gateReasons: gate.reasons,
            previousReason: plan.orchestration?.lastReworkReason,
            previousRevisionCount: plan.orchestration?.reworkRevisionCount,
            nextRevisionCount: nextReworkRevisionCount,
          })
          : null;
        const commanderRuntimeSwitches = resolveCommanderRuntimeSwitches((name) => {
          const value = ctx.readEnv?.(name);
          if (typeof value === "string") {
            return value;
          }
          const fallback = process.env[name];
          return fallback && fallback.trim() ? fallback.trim() : undefined;
        });
        const autoReworkEnabled = commanderRuntimeSwitches.autoReworkEnabled;
        const now = new Date().toISOString();
        const savedPlan = await ctx.goalManager.saveCapabilityPlan(goalId, nodeId, {
          ...plan,
          runId: runId ?? plan.runId,
          orchestratedAt: plan.orchestratedAt,
          orchestration: {
            ...(plan.orchestration ?? {}),
            finalApprovalMode: resolvedFinalApprovalMode,
            reworkRevisionCount: nextReworkRevisionCount > 0 ? nextReworkRevisionCount : plan.orchestration?.reworkRevisionCount,
            lastReworkReason: decision === "rework"
              ? (reworkContext?.persistedReason ?? note ?? summary ?? gate.managerActionHint ?? gate.summary)
              : plan.orchestration?.lastReworkReason,
            lastReworkAt: decision === "rework" ? now : plan.orchestration?.lastReworkAt,
            reworkTargetAgentIds: decision === "rework" ? reworkTargetAgentIds : plan.orchestration?.reworkTargetAgentIds,
            reworkContext: decision === "rework"
              ? {
                quickSummary: reworkContext?.quickSummary,
                historySummary: reworkContext?.historySummary,
                persistedReason: reworkContext?.persistedReason,
              }
              : plan.orchestration?.reworkContext,
            notes: [
              ...(plan.orchestration?.notes ?? []),
              buildGoalCommanderDecisionNote(
                decision,
                summary,
                decision === "rework" ? reworkContext?.persistedReason : note,
                gate.summary,
                decision === "escalate" ? resolvedFinalApprovalMode : undefined,
                decision === "rework" ? nextReworkRevisionCount : undefined,
              ),
            ],
          },
        });

        const transitionSummary = summary ?? gate.summary;
        const transitionResult = decision === "accept"
          ? await ctx.goalManager.markTaskNodeValidating(goalId, nodeId, { summary: transitionSummary, runId })
          : decision === "rework"
            ? autoReworkEnabled
              ? await ctx.goalManager.claimTaskNode(goalId, nodeId, {
                summary: transitionSummary,
                runId,
              })
              : await ctx.goalManager.blockTaskNode(goalId, nodeId, {
                summary: transitionSummary,
                blockReason: reworkContext?.persistedReason ?? note ?? summary ?? gate.managerActionHint ?? gate.summary,
                runId,
              })
            : resolvedFinalApprovalMode === "user_required"
              ? await ctx.goalManager.markTaskNodeValidating(goalId, nodeId, { summary: transitionSummary, runId })
              : await ctx.goalManager.completeTaskNode(goalId, nodeId, { summary: transitionSummary, runId });
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: {
            decision,
            finalApprovalMode: resolvedFinalApprovalMode,
            plan: savedPlan,
            transition: transitionResult,
            reworkTargetAgentIds,
            reworkContext,
            autoReworkEnabled,
          },
        };
      } catch (err) {
        return failure(req.id, "goal_capability_commander_decide_failed", err);
      }
    }

    case "goal.checkpoint.request":
    case "goal.checkpoint.approve":
    case "goal.checkpoint.reject":
    case "goal.checkpoint.expire":
    case "goal.checkpoint.reopen":
    case "goal.checkpoint.escalate": {
      const goalId = readRequiredString(params, "goalId");
      const nodeId = readRequiredString(params, "nodeId");
      if (!goalId || !nodeId) return invalid(req.id, "goalId and nodeId are required");
      try {
        const payload = {
          checkpointId: readOptionalString(params, "checkpointId"),
          title: readOptionalString(params, "title"),
          summary: readOptionalString(params, "summary"),
          note: readOptionalString(params, "note"),
          reviewer: readOptionalString(params, "reviewer"),
          reviewerRole: readOptionalString(params, "reviewerRole"),
          requestedBy: readOptionalString(params, "requestedBy"),
          decidedBy: readOptionalString(params, "decidedBy"),
          slaAt: readOptionalString(params, "slaAt"),
          runId: readOptionalString(params, "runId"),
          escalatedBy: readOptionalString(params, "escalatedBy"),
          escalatedTo: readOptionalString(params, "escalatedTo"),
          reason: readOptionalString(params, "reason"),
          force: Boolean(params.force),
        };
        const result = req.method === "goal.checkpoint.request"
          ? await ctx.goalManager.requestCheckpoint(goalId, nodeId, payload)
          : req.method === "goal.checkpoint.approve"
            ? await ctx.goalManager.approveCheckpoint(goalId, nodeId, payload)
            : req.method === "goal.checkpoint.reject"
              ? await ctx.goalManager.rejectCheckpoint(goalId, nodeId, payload)
              : req.method === "goal.checkpoint.expire"
                ? await ctx.goalManager.expireCheckpoint(goalId, nodeId, payload)
                : req.method === "goal.checkpoint.reopen"
                  ? await ctx.goalManager.reopenCheckpoint(goalId, nodeId, payload)
                  : await ctx.goalManager.escalateCheckpoint(goalId, nodeId, payload);
        return okPayload(req.id, result);
      } catch (err) {
        const code = req.method.replace(/\./g, "_").replace("goal_", "goal_").replace("checkpoint_", "checkpoint_");
        return failure(req.id, `${code}_failed`, err);
      }
    }

    case "goal.task_graph.read": {
      const goalId = readRequiredString(params, "goalId");
      if (!goalId) return invalid(req.id, "goalId is required");
      try {
        const graph = await ctx.goalManager.readTaskGraph(goalId);
        return { type: "res", id: req.id, ok: true, payload: { graph } };
      } catch (err) {
        return failure(req.id, "goal_task_graph_read_failed", err);
      }
    }

    case "goal.task_graph.create": {
      const goalId = readRequiredString(params, "goalId");
      const title = readRequiredString(params, "title");
      if (!goalId || !title) return invalid(req.id, "goalId and title are required");
      try {
        const result = await ctx.goalManager.createTaskNode(goalId, {
          id: readOptionalString(params, "nodeId"),
          title,
          description: readOptionalString(params, "description"),
          phase: readOptionalString(params, "phase"),
          owner: readOptionalString(params, "owner"),
          dependsOn: readArrayAsStrings(params.dependsOn),
          acceptance: readArrayAsStrings(params.acceptance),
          checkpointRequired: typeof params.checkpointRequired === "boolean" ? params.checkpointRequired : undefined,
          checkpointStatus: ctx.parseGoalTaskCheckpointStatus(params.checkpointStatus),
          status: ctx.parseGoalTaskCreateStatus(params.status),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_task_graph_create_failed", err);
      }
    }

    case "goal.task_graph.update": {
      const goalId = readRequiredString(params, "goalId");
      const nodeId = readRequiredString(params, "nodeId");
      if (!goalId || !nodeId) return invalid(req.id, "goalId and nodeId are required");
      try {
        const result = await ctx.goalManager.updateTaskNode(goalId, nodeId, {
          title: readOptionalString(params, "title"),
          description: typeof params.description === "string" ? params.description : undefined,
          phase: typeof params.phase === "string" ? params.phase : undefined,
          owner: typeof params.owner === "string" ? params.owner : undefined,
          dependsOn: readArrayAsStrings(params.dependsOn),
          acceptance: readArrayAsStrings(params.acceptance),
          artifacts: readArrayAsStrings(params.artifacts),
          checkpointRequired: typeof params.checkpointRequired === "boolean" ? params.checkpointRequired : undefined,
          checkpointStatus: ctx.parseGoalTaskCheckpointStatus(params.checkpointStatus),
        });
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, "goal_task_graph_update_failed", err);
      }
    }

    case "goal.task_graph.claim":
    case "goal.task_graph.pending_review":
    case "goal.task_graph.validating":
    case "goal.task_graph.complete":
    case "goal.task_graph.block":
    case "goal.task_graph.fail":
    case "goal.task_graph.skip": {
      const goalId = readRequiredString(params, "goalId");
      const nodeId = readRequiredString(params, "nodeId");
      if (!goalId || !nodeId) return invalid(req.id, "goalId and nodeId are required");
      const blockReason = readOptionalString(params, "blockReason");
      if (req.method === "goal.task_graph.block" && !blockReason) return invalid(req.id, "goalId, nodeId and blockReason are required");
      try {
        const payload = {
          owner: readOptionalString(params, "owner"),
          summary: readOptionalString(params, "summary"),
          blockReason,
          artifacts: readArrayAsStrings(params.artifacts),
          checkpointStatus: ctx.parseGoalTaskCheckpointStatus(params.checkpointStatus),
          runId: readOptionalString(params, "runId"),
        };
        const result = req.method === "goal.task_graph.claim"
          ? await ctx.goalManager.claimTaskNode(goalId, nodeId, payload)
          : req.method === "goal.task_graph.pending_review"
            ? await ctx.goalManager.markTaskNodePendingReview(goalId, nodeId, payload)
            : req.method === "goal.task_graph.validating"
              ? await ctx.goalManager.markTaskNodeValidating(goalId, nodeId, payload)
              : req.method === "goal.task_graph.complete"
                ? await ctx.goalManager.completeTaskNode(goalId, nodeId, payload)
                : req.method === "goal.task_graph.block"
                  ? await ctx.goalManager.blockTaskNode(goalId, nodeId, payload)
                  : req.method === "goal.task_graph.fail"
                    ? await ctx.goalManager.failTaskNode(goalId, nodeId, payload)
                    : await ctx.goalManager.skipTaskNode(goalId, nodeId, payload);
        return okPayload(req.id, result);
      } catch (err) {
        return failure(req.id, `${req.method.replace(/\./g, "_")}_failed`, err);
      }
    }

    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === "string" ? params[key].trim() : "";
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = readRequiredString(params, key);
  return value || undefined;
}

function readArrayAsStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readGoalCapabilityExecutionMode(value: unknown) {
  return typeof value === "string" && (GOAL_CAPABILITY_EXECUTION_MODES as readonly string[]).includes(value)
    ? value as typeof GOAL_CAPABILITY_EXECUTION_MODES[number]
    : undefined;
}

function readGoalCapabilityGovernanceMode(value: unknown) {
  return typeof value === "string" && (GOAL_CAPABILITY_GOVERNANCE_MODES as readonly string[]).includes(value)
    ? value as typeof GOAL_CAPABILITY_GOVERNANCE_MODES[number]
    : undefined;
}

function readGoalCapabilityFinalApprovalMode(value: unknown): GoalCapabilityPlanFinalApprovalMode | undefined {
  return typeof value === "string" && (GOAL_CAPABILITY_FINAL_APPROVAL_MODES as readonly string[]).includes(value)
    ? value as GoalCapabilityPlanFinalApprovalMode
    : undefined;
}

function readGoalCommanderDecision(value: unknown) {
  return typeof value === "string" && (GOAL_COMMANDER_DECISIONS as readonly string[]).includes(value)
    ? value as typeof GOAL_COMMANDER_DECISIONS[number]
    : undefined;
}

function resolveGoalCommanderFinalApprovalMode(
  explicitValue: boolean | undefined,
  fallback: GoalCapabilityPlanFinalApprovalMode | undefined,
): GoalCapabilityPlanFinalApprovalMode {
  if (explicitValue === false) return "agent_auto_complete";
  if (explicitValue === true) return "user_required";
  return fallback ?? "user_required";
}

function buildGoalCommanderDecisionNote(
  decision: typeof GOAL_COMMANDER_DECISIONS[number],
  summary?: string,
  note?: string,
  gateSummary?: string,
  approvalMode?: string,
  revision?: number,
): string {
  return [
    `commander decision=${decision}`,
    summary ? `summary=${summary}` : "",
    note ? `note=${note}` : "",
    gateSummary ? `gate=${gateSummary}` : "",
    approvalMode ? `approval=${approvalMode}` : "",
    typeof revision === "number" ? `revision=${revision}` : "",
  ].filter(Boolean).join(" | ");
}

function buildGoalCommanderReworkContext(input: {
  summary?: string;
  note?: string;
  gateSummary?: string;
  gateManagerActionHint?: string;
  gateReasons?: string[];
  previousReason?: string;
  previousRevisionCount?: number;
  nextRevisionCount: number;
}): {
  persistedReason: string;
  quickSummary: string;
  historySummary: string;
} {
  const lines = [
    input.summary?.trim() || "",
    input.note?.trim() || "",
    input.gateManagerActionHint?.trim() || "",
    input.gateSummary?.trim() || "",
    ...(Array.isArray(input.gateReasons) ? input.gateReasons.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean) : []),
  ].filter(Boolean);
  const uniqueLines = [...new Set(lines)];
  const quickSummary = uniqueLines[0] || "Commander rework requested.";
  const historyParts = [
    `Rework Revision ${input.nextRevisionCount}`,
    typeof input.previousRevisionCount === "number" && input.previousRevisionCount > 0
      ? `previous=${input.previousRevisionCount}`
      : "",
    input.previousReason?.trim() ? `last=${input.previousReason.trim()}` : "",
    uniqueLines.length > 0 ? `current=${uniqueLines.join(" | ")}` : "",
  ].filter(Boolean);
  return {
    persistedReason: historyParts.join(" || "),
    quickSummary,
    historySummary: historyParts.join(" | "),
  };
}

function resolveGoalCommanderReworkTargetAgentIds(plan: {
  subAgents?: Array<{ agentId?: string }>;
  orchestration?: {
    delegationResults?: Array<{ agentId?: string; status?: string }>;
  };
}): string[] {
  const failedAgentIds = (plan.orchestration?.delegationResults ?? [])
    .filter((item) => item?.status === "failed" && typeof item.agentId === "string" && item.agentId.trim())
    .map((item) => item.agentId!.trim());
  if (failedAgentIds.length > 0) {
    return [...new Set(failedAgentIds)];
  }
  return (plan.subAgents ?? [])
    .map((item) => typeof item.agentId === "string" ? item.agentId.trim() : "")
    .filter(Boolean);
}

function isSuggestionType(value: string): value is typeof SUGGESTION_TYPES[number] {
  return (SUGGESTION_TYPES as readonly string[]).includes(value);
}

function invalid(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "invalid_params", message } };
}

function notFound(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "not_found", message } };
}

function okPayload(id: string, payload: unknown): GatewayResFrame {
  return { type: "res", id, ok: true, payload: payload as Record<string, unknown> };
}

function failure(id: string, code: string, error: unknown): GatewayResFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: { code, message: error instanceof Error ? error.message : String(error) },
  };
}

async function callGoalOnly(
  id: string,
  params: Record<string, unknown>,
  missingMessage: string,
  fn: (goalId: string) => Promise<any>,
  errorCode: string,
): Promise<GatewayResFrame> {
  const goalId = readRequiredString(params, "goalId");
  if (!goalId) return invalid(id, missingMessage);
  try {
    return okPayload(id, await fn(goalId));
  } catch (err) {
    return failure(id, errorCode, err);
  }
}
