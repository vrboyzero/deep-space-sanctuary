import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import type {
  GoalCapabilityPlan,
  GoalCapabilityPlanAcceptanceGate,
  GoalCapabilityPlanAcceptanceGateCheck,
  GoalCapabilityPlanAnalysis,
  GoalCapabilityPlanCoordinationPlan,
  GoalCapabilityPlanDelegationResult,
  GoalCapabilityPlanDeviation,
  GoalCapabilityPlanMethod,
  GoalCapabilityPlanMcpServer,
  GoalCapabilityPlanOrchestration,
  GoalCapabilityPlanActualUsage,
  GoalCapabilityPlanCheckpointPolicy,
  GoalCapabilityPlanRolePolicy,
  GoalCapabilityRiskLevel,
  GoalCapabilityPlanSkill,
  GoalCapabilityPlanState,
  GoalCapabilityPlanSubAgent,
  GoalCapabilityPlanVerifierFinding,
  GoalCapabilityPlanVerifierHandoff,
  GoalCapabilityPlanVerifierResult,
  GoalCheckpointPolicy,
  GoalCheckpointHistoryEntry,
  GoalCheckpointItem,
  GoalCheckpointItemStatus,
  GoalCheckpointState,
  GoalMethodCandidate,
  GoalMethodCandidateState,
  GoalFlowPattern,
  GoalFlowPatternState,
  GoalReviewDeliveryChannel,
  GoalSuggestionReviewItem,
  GoalSuggestionReviewWorkflow,
  GoalSuggestionReviewWorkflowEscalation,
  GoalSuggestionReviewWorkflowEscalationEvent,
  GoalSuggestionReviewWorkflowReviewer,
  GoalSuggestionReviewWorkflowStage,
  GoalSuggestionReviewWorkflowVote,
  GoalReviewNotification,
  GoalReviewNotificationDispatch,
  GoalReviewNotificationDispatchState,
  GoalReviewNotificationDispatchStatus,
  GoalReviewNotificationKind,
  GoalReviewNotificationState,
  GoalSuggestionPublishRecord,
  GoalSuggestionPublishState,
  GoalSuggestionReviewState,
  GoalSuggestionReviewStatus,
  GoalSuggestionType,
  GoalSkillCandidate,
  GoalSkillCandidateState,
  GoalRuntimeState,
  LongTermGoal,
} from "./types.js";
import { getDefaultCapabilityPlanAnalysis } from "./capability-analysis.js";
import {
  getDefaultGoalReviewNotificationDispatches,
  getDefaultGoalReviewNotifications,
  getGoalReviewNotificationDispatchesPath,
  getGoalReviewNotificationsPath,
} from "./review-governance.js";
import {
  getDefaultGoalLearningReviewRefreshState,
  getGoalLearningReviewRefreshStatePath,
} from "./learning-review-refresh.js";

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tempPath, targetPath);
}

export function getGoalStatePath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "state.json");
}

export function getGoalRuntimePath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "runtime.json");
}

export function getGoalCheckpointsPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "checkpoints.json");
}

export function getGoalBoardRefPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "board-ref.json");
}

export function getGoalCapabilityPlansPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "capability-plans.json");
}

export function getGoalMethodCandidatesPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "method-candidates.json");
}

export function getGoalSkillCandidatesPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "skill-candidates.json");
}

export function getGoalFlowPatternsPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "flow-patterns.json");
}

export function getGoalSuggestionReviewsPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "suggestion-reviews.json");
}

export function getGoalPublishRecordsPath(goal: Pick<LongTermGoal, "runtimeRoot">): string {
  return path.join(goal.runtimeRoot, "publish-records.json");
}

export async function ensureGoalRuntime(goal: LongTermGoal): Promise<void> {
  await fs.mkdir(goal.runtimeRoot, { recursive: true });
  await fs.mkdir(path.join(goal.runtimeRoot, "runs"), { recursive: true });
  await fs.mkdir(path.join(goal.runtimeRoot, "artifacts"), { recursive: true });

  const initialState: GoalRuntimeState = {
    goalId: goal.id,
    status: goal.status,
    activeConversationId: goal.activeConversationId,
    activeNodeId: goal.activeNodeId,
    lastNodeId: goal.lastNodeId,
    lastRunId: goal.lastRunId,
    pausedAt: goal.pausedAt,
    updatedAt: new Date().toISOString(),
  };
  const initialCheckpoints: GoalCheckpointState = {
    version: 2,
    items: [],
  };
  const initialCapabilityPlans: GoalCapabilityPlanState = {
    version: 1,
    items: [],
  };
  const initialMethodCandidates: GoalMethodCandidateState = {
    version: 1,
    items: [],
  };
  const initialSkillCandidates: GoalSkillCandidateState = {
    version: 1,
    items: [],
  };
  const initialFlowPatterns: GoalFlowPatternState = {
    version: 1,
    items: [],
  };
  const initialSuggestionReviews: GoalSuggestionReviewState = {
    version: 1,
    items: [],
  };
  const initialPublishRecords: GoalSuggestionPublishState = {
    version: 1,
    items: [],
  };

  await ensureJsonFile(getGoalStatePath(goal), {
    goalId: goal.id,
    status: goal.status,
    updatedAt: new Date().toISOString(),
  });
  await ensureJsonFile(getGoalRuntimePath(goal), initialState);
  await ensureJsonFile(getGoalCheckpointsPath(goal), initialCheckpoints);
  await ensureJsonFile(getGoalCapabilityPlansPath(goal), initialCapabilityPlans);
  await ensureJsonFile(getGoalMethodCandidatesPath(goal), initialMethodCandidates);
  await ensureJsonFile(getGoalSkillCandidatesPath(goal), initialSkillCandidates);
  await ensureJsonFile(getGoalFlowPatternsPath(goal), initialFlowPatterns);
  await ensureJsonFile(getGoalSuggestionReviewsPath(goal), initialSuggestionReviews);
  await ensureJsonFile(getGoalPublishRecordsPath(goal), initialPublishRecords);
  await ensureJsonFile(getGoalReviewNotificationsPath(goal), getDefaultGoalReviewNotifications());
  await ensureJsonFile(getGoalReviewNotificationDispatchesPath(goal), getDefaultGoalReviewNotificationDispatches());
  await ensureJsonFile(getGoalLearningReviewRefreshStatePath(goal), getDefaultGoalLearningReviewRefreshState());
  await ensureJsonFile(getGoalBoardRefPath(goal), { boardId: goal.boardId ?? null });
}

export async function readGoalRuntime(goal: Pick<LongTermGoal, "runtimeRoot" | "id" | "status">): Promise<GoalRuntimeState> {
  const runtimePath = getGoalRuntimePath(goal);
  try {
    const raw = await fs.readFile(runtimePath, "utf-8");
    return JSON.parse(raw) as GoalRuntimeState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        goalId: goal.id,
        status: goal.status,
        updatedAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}

export async function writeGoalRuntime(goal: Pick<LongTermGoal, "runtimeRoot">, runtime: GoalRuntimeState): Promise<void> {
  await atomicWriteJson(getGoalRuntimePath(goal), runtime);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeCheckpointStatus(value: unknown): GoalCheckpointItemStatus {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "required":
    case "waiting_user":
    case "approved":
    case "rejected":
    case "expired":
      return normalized;
    default:
      return "required";
  }
}

function normalizeCheckpointPolicy(value: unknown): GoalCheckpointPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const requiredRequestFields = Array.isArray(source.requiredRequestFields)
    ? source.requiredRequestFields.map((item) => normalizeString(item)).filter((item): item is GoalCheckpointPolicy["requiredRequestFields"][number] => Boolean(item))
    : [];
  const requiredDecisionFields = Array.isArray(source.requiredDecisionFields)
    ? source.requiredDecisionFields.map((item) => normalizeString(item)).filter((item): item is GoalCheckpointPolicy["requiredDecisionFields"][number] => Boolean(item))
    : [];
  const rationale = Array.isArray(source.rationale)
    ? source.rationale.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const reviewers = Array.isArray(source.reviewers)
    ? source.reviewers.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : undefined;
  const reviewerRoles = Array.isArray(source.reviewerRoles)
    ? source.reviewerRoles.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : undefined;
  const reminderMinutes = Array.isArray(source.reminderMinutes)
    ? source.reminderMinutes.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
    : undefined;
  const approvalMode = normalizeString(source.approvalMode);
  const escalationMode = normalizeString(source.escalationMode);
  const workflowMode = normalizeString(source.workflowMode);
  return {
    riskLevel: normalizeCapabilityRiskLevel(source.riskLevel),
    approvalMode: approvalMode === "single" || approvalMode === "strict" ? approvalMode : "none",
    requiredRequestFields,
    requiredDecisionFields,
    templateId: normalizeString(source.templateId),
    workflowMode: workflowMode === "chain" || workflowMode === "quorum" ? workflowMode : "single",
    reviewers,
    reviewerRoles,
    minApprovals: typeof source.minApprovals === "number" && Number.isFinite(source.minApprovals) ? source.minApprovals : undefined,
    stages: Array.isArray(source.stages) ? source.stages.filter((item) => Boolean(item)) as GoalCheckpointPolicy["stages"] : undefined,
    suggestedReviewer: normalizeString(source.suggestedReviewer),
    suggestedReviewerRole: normalizeString(source.suggestedReviewerRole),
    suggestedSlaHours: typeof source.suggestedSlaHours === "number" && Number.isFinite(source.suggestedSlaHours)
      ? source.suggestedSlaHours
      : undefined,
    reminderMinutes,
    escalationMode: escalationMode === "manual" ? "manual" : "none",
    escalationReviewer: normalizeString(source.escalationReviewer),
    rationale,
  };
}

function normalizeCheckpointItem(value: unknown, index: number, goalId?: string): GoalCheckpointItem {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const now = new Date().toISOString();
  const historyRaw = Array.isArray(source.history) ? source.history : [];
  const history = historyRaw
    .map((item): GoalCheckpointHistoryEntry | null => {
      const entry = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const action = normalizeString(entry.action);
      const at = normalizeString(entry.at);
      const status = normalizeString(entry.status);
      if (!action || !at || !status) return null;
      if (!["requested", "reviewed", "approved", "rejected", "expired", "reopened", "escalated", "reminded"].includes(action)) return null;
      if (!["required", "waiting_user", "approved", "rejected", "expired"].includes(status)) return null;
      return {
        action: action as GoalCheckpointHistoryEntry["action"],
        status: status as GoalCheckpointItemStatus,
        at,
        ...(normalizeString(entry.summary) ? { summary: normalizeString(entry.summary) } : {}),
        ...(normalizeString(entry.note) ? { note: normalizeString(entry.note) } : {}),
        ...(normalizeString(entry.actor) ? { actor: normalizeString(entry.actor) } : {}),
        ...(normalizeString(entry.reviewer) ? { reviewer: normalizeString(entry.reviewer) } : {}),
        ...(normalizeString(entry.reviewerRole) ? { reviewerRole: normalizeString(entry.reviewerRole) } : {}),
        ...(normalizeString(entry.requestedBy) ? { requestedBy: normalizeString(entry.requestedBy) } : {}),
        ...(normalizeString(entry.decidedBy) ? { decidedBy: normalizeString(entry.decidedBy) } : {}),
        ...(normalizeString(entry.slaAt) ? { slaAt: normalizeString(entry.slaAt) } : {}),
        ...(normalizeString(entry.runId) ? { runId: normalizeString(entry.runId) } : {}),
      };
    })
    .filter((item): item is GoalCheckpointHistoryEntry => Boolean(item));
  return {
    id: normalizeString(source.id) ?? `checkpoint_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId,
    nodeId: normalizeString(source.nodeId),
    runId: normalizeString(source.runId),
    status: normalizeCheckpointStatus(source.status),
    title: normalizeString(source.title) ?? `Checkpoint ${index + 1}`,
    summary: normalizeString(source.summary),
    note: normalizeString(source.note),
    reviewer: normalizeString(source.reviewer),
    reviewerRole: normalizeString(source.reviewerRole),
    requestedBy: normalizeString(source.requestedBy),
    decidedBy: normalizeString(source.decidedBy),
    slaAt: normalizeString(source.slaAt),
    requestedAt: normalizeString(source.requestedAt),
    decidedAt: normalizeString(source.decidedAt),
    createdAt: normalizeString(source.createdAt) ?? now,
    updatedAt: normalizeString(source.updatedAt) ?? now,
    policy: normalizeCheckpointPolicy(source.policy),
    workflow: normalizeSuggestionReviewWorkflow(source.workflow),
    history,
  };
}

function normalizeCapabilityPlanMethod(value: unknown): GoalCapabilityPlanMethod | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const file = normalizeString(source.file);
  if (!file) return null;
  const score = typeof source.score === "number" && Number.isFinite(source.score) ? source.score : undefined;
  return {
    file,
    title: normalizeString(source.title),
    score,
    reason: normalizeString(source.reason),
  };
}

function normalizeCapabilityPlanSkill(value: unknown): GoalCapabilityPlanSkill | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const name = normalizeString(source.name);
  if (!name) return null;
  const score = typeof source.score === "number" && Number.isFinite(source.score) ? source.score : undefined;
  return {
    name,
    description: normalizeString(source.description),
    priority: normalizeString(source.priority),
    source: normalizeString(source.source),
    score,
    reason: normalizeString(source.reason),
  };
}

function normalizeCapabilityPlanMcpServer(value: unknown): GoalCapabilityPlanMcpServer | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const serverId = normalizeString(source.serverId);
  if (!serverId) return null;
  const status = normalizeString(source.status);
  const toolCount = typeof source.toolCount === "number" && Number.isFinite(source.toolCount) ? source.toolCount : undefined;
  const resourceCount = typeof source.resourceCount === "number" && Number.isFinite(source.resourceCount) ? source.resourceCount : undefined;
  return {
    serverId,
    status: status === "connected" || status === "disconnected" ? status : "unknown",
    toolCount,
    resourceCount,
    reason: normalizeString(source.reason),
  };
}

function normalizeCapabilityPlanSubAgent(value: unknown): GoalCapabilityPlanSubAgent | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const agentId = normalizeString(source.agentId);
  const objective = normalizeString(source.objective);
  if (!agentId || !objective) return null;
  const role = normalizeString(source.role);
  const catalogSource = source.catalogDefault && typeof source.catalogDefault === "object" && !Array.isArray(source.catalogDefault)
    ? source.catalogDefault as Record<string, unknown>
    : undefined;
  return {
    agentId,
    role: role === "coder" || role === "researcher" || role === "verifier" ? role : role === "default" ? "default" : undefined,
    objective,
    reason: normalizeString(source.reason),
    deliverable: normalizeString(source.deliverable),
    handoffToVerifier: typeof source.handoffToVerifier === "boolean" ? source.handoffToVerifier : undefined,
    catalogDefault: catalogSource
      ? {
        permissionMode: (() => {
          const permissionMode = normalizeString(catalogSource.permissionMode);
          return permissionMode === "plan" || permissionMode === "acceptEdits" || permissionMode === "confirm"
            ? permissionMode
            : undefined;
        })(),
        allowedToolFamilies: Array.isArray(catalogSource.allowedToolFamilies)
          ? catalogSource.allowedToolFamilies
            .map((item) => normalizeString(item))
            .filter((item): item is string => Boolean(item))
          : undefined,
        maxToolRiskLevel: (() => {
          const risk = normalizeString(catalogSource.maxToolRiskLevel);
          return risk === "low" || risk === "medium" || risk === "high" || risk === "critical"
            ? risk
            : undefined;
        })(),
        handoffStyle: (() => {
          const handoffStyle = normalizeString(catalogSource.handoffStyle);
          return handoffStyle === "structured" ? "structured" : handoffStyle === "summary" ? "summary" : undefined;
        })(),
        whenToUse: Array.isArray(catalogSource.whenToUse)
          ? catalogSource.whenToUse
            .map((item) => normalizeString(item))
            .filter((item): item is string => Boolean(item))
          : undefined,
        skills: Array.isArray(catalogSource.skills)
          ? catalogSource.skills
            .map((item) => normalizeString(item))
            .filter((item): item is string => Boolean(item))
          : undefined,
      }
      : undefined,
  };
}

function normalizeCapabilityPlanRolePolicy(value: unknown): GoalCapabilityPlanRolePolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const selectedRoles = Array.isArray(source.selectedRoles)
    ? source.selectedRoles
      .map((item) => normalizeString(item))
      .filter((item): item is GoalCapabilityPlanRolePolicy["selectedRoles"][number] => (
        item === "default" || item === "coder" || item === "researcher" || item === "verifier"
      ))
    : [];
  const selectionReasons = Array.isArray(source.selectionReasons)
    ? source.selectionReasons.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const verifierRole = normalizeString(source.verifierRole);
  const fanInStrategy = normalizeString(source.fanInStrategy);
  return {
    selectedRoles: selectedRoles.length > 0 ? selectedRoles : ["default"],
    selectionReasons,
    verifierRole: verifierRole === "verifier" ? verifierRole : undefined,
    fanInStrategy: fanInStrategy === "verifier_handoff"
      ? "verifier_handoff"
      : fanInStrategy === "commander_review"
        ? "commander_review"
        : "main_agent_summary",
  };
}

function normalizeCapabilityPlanCoordinationPlan(value: unknown): GoalCapabilityPlanCoordinationPlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const summary = normalizeString(source.summary);
  const rolePolicy = normalizeCapabilityPlanRolePolicy(source.rolePolicy);
  if (!summary || !rolePolicy) return undefined;
  return {
    summary,
    plannedDelegationCount: typeof source.plannedDelegationCount === "number" && Number.isFinite(source.plannedDelegationCount)
      ? source.plannedDelegationCount
      : 0,
    managerAgentId: normalizeString(source.managerAgentId),
    rolePolicy,
  };
}

function normalizeCapabilityPlanDelegationResult(value: unknown): GoalCapabilityPlanDelegationResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const agentId = normalizeString(source.agentId);
  const status = normalizeString(source.status);
  const summary = normalizeString(source.summary);
  const role = normalizeString(source.role);
  if (!agentId || !summary) return null;
  return {
    agentId,
    role: role === "coder" || role === "researcher" || role === "verifier" ? role : role === "default" ? "default" : undefined,
    status: status === "failed" || status === "skipped" ? status : "success",
    summary,
    error: normalizeString(source.error),
    sessionId: normalizeString(source.sessionId),
    taskId: normalizeString(source.taskId),
    outputPath: normalizeString(source.outputPath),
  };
}

function normalizeCapabilityPlanVerifierHandoff(value: unknown): GoalCapabilityPlanVerifierHandoff | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const status = normalizeString(source.status);
  const summary = normalizeString(source.summary);
  if (!summary) return undefined;
  return {
    status: status === "pending" || status === "ready" || status === "running" || status === "completed" || status === "failed" || status === "skipped"
      ? status
      : "not_required",
    verifierRole: normalizeString(source.verifierRole) === "verifier" ? "verifier" : undefined,
    verifierAgentId: normalizeString(source.verifierAgentId),
    verifierTaskId: normalizeString(source.verifierTaskId),
    verifierSessionId: normalizeString(source.verifierSessionId),
    summary,
    sourceAgentIds: Array.isArray(source.sourceAgentIds)
      ? source.sourceAgentIds.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
      : [],
    sourceTaskIds: Array.isArray(source.sourceTaskIds)
      ? source.sourceTaskIds.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
      : undefined,
    outputPath: normalizeString(source.outputPath),
    notes: Array.isArray(source.notes)
      ? source.notes.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
      : undefined,
    error: normalizeString(source.error),
  };
}

function normalizeCapabilityPlanVerifierFinding(value: unknown): GoalCapabilityPlanVerifierFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const severity = normalizeString(source.severity);
  const summary = normalizeString(source.summary);
  if (!summary) return null;
  return {
    severity: severity === "high" || severity === "medium" ? severity : "low",
    summary,
  };
}

function normalizeCapabilityPlanVerifierResult(value: unknown): GoalCapabilityPlanVerifierResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const status = normalizeString(source.status);
  const summary = normalizeString(source.summary);
  const generatedAt = normalizeString(source.generatedAt);
  if (!summary || !generatedAt) return undefined;
  return {
    status: status === "completed" || status === "failed" ? status : "pending",
    summary,
    findings: Array.isArray(source.findings)
      ? source.findings
        .map((item) => normalizeCapabilityPlanVerifierFinding(item))
        .filter((item): item is GoalCapabilityPlanVerifierFinding => Boolean(item))
      : [],
    recommendation: (() => {
      const recommendation = normalizeString(source.recommendation);
      if (recommendation === "approve" || recommendation === "revise" || recommendation === "blocked") return recommendation;
      return "unknown";
    })(),
    evidenceTaskIds: Array.isArray(source.evidenceTaskIds)
      ? source.evidenceTaskIds.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
      : undefined,
    outputPath: normalizeString(source.outputPath),
    generatedAt,
  };
}

function normalizeCapabilityPlanAcceptanceGateCheck(value: unknown): GoalCapabilityPlanAcceptanceGateCheck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = normalizeString(source.id);
  const label = normalizeString(source.label);
  const status = normalizeString(source.status);
  if (!id || !label || (status !== "passed" && status !== "failed")) return null;
  return {
    id,
    label,
    status,
    enforced: source.enforced === true,
    evidence: normalizeString(source.evidence),
  };
}

function normalizeCapabilityPlanAcceptanceGate(value: unknown): GoalCapabilityPlanAcceptanceGate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const status = normalizeString(source.status);
  const summary = normalizeString(source.summary);
  if (!summary || (status !== "pending" && status !== "accepted" && status !== "rejected")) return undefined;
  const reasons = Array.isArray(source.reasons)
    ? source.reasons.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const normalizeList = (input: unknown) => Array.isArray(input)
    ? input.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const rejectionConfidence = normalizeString(source.rejectionConfidence);
  return {
    status,
    summary,
    reasons,
    requiredSourceAgentIds: normalizeList(source.requiredSourceAgentIds),
    missingSourceAgentIds: normalizeList(source.missingSourceAgentIds),
    requiredSourceTaskIds: normalizeList(source.requiredSourceTaskIds),
    missingSourceTaskIds: normalizeList(source.missingSourceTaskIds),
    requiredEvidenceTaskIds: normalizeList(source.requiredEvidenceTaskIds),
    missingEvidenceTaskIds: normalizeList(source.missingEvidenceTaskIds),
    contractSpecificChecks: Array.isArray(source.contractSpecificChecks)
      ? source.contractSpecificChecks
        .map((item) => normalizeCapabilityPlanAcceptanceGateCheck(item))
        .filter((item): item is GoalCapabilityPlanAcceptanceGateCheck => Boolean(item))
      : undefined,
    rejectionConfidence: rejectionConfidence === "low" || rejectionConfidence === "medium" || rejectionConfidence === "high"
      ? rejectionConfidence
      : undefined,
    managerActionHint: normalizeString(source.managerActionHint),
  };
}

function normalizeCapabilityPlanOrchestration(value: unknown): GoalCapabilityPlanOrchestration | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const notes = Array.isArray(source.notes)
    ? source.notes
      .map((item) => normalizeString(item))
      .filter((item): item is string => Boolean(item))
    : [];
  return {
    claimed: typeof source.claimed === "boolean" ? source.claimed : undefined,
    delegated: typeof source.delegated === "boolean" ? source.delegated : undefined,
    delegationCount: typeof source.delegationCount === "number" && Number.isFinite(source.delegationCount)
      ? source.delegationCount
      : undefined,
    finalApprovalMode: source.finalApprovalMode === "agent_auto_complete" ? "agent_auto_complete" : source.finalApprovalMode === "user_required" ? "user_required" : undefined,
    reworkRevisionCount: typeof source.reworkRevisionCount === "number" && Number.isFinite(source.reworkRevisionCount) && source.reworkRevisionCount >= 0
      ? source.reworkRevisionCount
      : undefined,
    lastReworkReason: normalizeString(source.lastReworkReason),
    lastReworkAt: normalizeString(source.lastReworkAt),
    reworkTargetAgentIds: Array.isArray(source.reworkTargetAgentIds)
      ? source.reworkTargetAgentIds.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
      : undefined,
    reworkContext: source.reworkContext && typeof source.reworkContext === "object" && !Array.isArray(source.reworkContext)
      ? {
        quickSummary: normalizeString((source.reworkContext as Record<string, unknown>).quickSummary),
        historySummary: normalizeString((source.reworkContext as Record<string, unknown>).historySummary),
        persistedReason: normalizeString((source.reworkContext as Record<string, unknown>).persistedReason),
      }
      : undefined,
    coordinationPlan: normalizeCapabilityPlanCoordinationPlan(source.coordinationPlan),
    delegationResults: Array.isArray(source.delegationResults)
      ? source.delegationResults
        .map((item) => normalizeCapabilityPlanDelegationResult(item))
        .filter((item): item is GoalCapabilityPlanDelegationResult => Boolean(item))
      : undefined,
    verifierHandoff: normalizeCapabilityPlanVerifierHandoff(source.verifierHandoff),
    verifierResult: normalizeCapabilityPlanVerifierResult(source.verifierResult),
    acceptanceGate: normalizeCapabilityPlanAcceptanceGate(source.acceptanceGate),
    notes: notes.length > 0 ? notes : undefined,
  };
}

function normalizeCapabilityRiskLevel(value: unknown): GoalCapabilityRiskLevel {
  const normalized = normalizeString(value);
  if (normalized === "high" || normalized === "medium") return normalized;
  return "low";
}

function normalizeCapabilityPlanCheckpoint(value: unknown): GoalCapabilityPlanCheckpointPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      required: false,
      reasons: [],
      approvalMode: "none",
      requiredRequestFields: [],
      requiredDecisionFields: [],
      escalationMode: "none",
    };
  }
  const source = value as Record<string, unknown>;
  const reasons = Array.isArray(source.reasons)
    ? source.reasons.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const requiredRequestFields = Array.isArray(source.requiredRequestFields)
    ? source.requiredRequestFields.map((item) => normalizeString(item)).filter((item): item is GoalCheckpointPolicy["requiredRequestFields"][number] => Boolean(item))
    : [];
  const requiredDecisionFields = Array.isArray(source.requiredDecisionFields)
    ? source.requiredDecisionFields.map((item) => normalizeString(item)).filter((item): item is GoalCheckpointPolicy["requiredDecisionFields"][number] => Boolean(item))
    : [];
  const reviewers = Array.isArray(source.reviewers)
    ? source.reviewers.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : undefined;
  const reviewerRoles = Array.isArray(source.reviewerRoles)
    ? source.reviewerRoles.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : undefined;
  const approvalMode = normalizeString(source.approvalMode);
  const escalationMode = normalizeString(source.escalationMode);
  const workflowMode = normalizeString(source.workflowMode);
  return {
    required: Boolean(source.required),
    reasons,
    approvalMode: approvalMode === "single" || approvalMode === "strict" ? approvalMode : "none",
    requiredRequestFields,
    requiredDecisionFields,
    templateId: normalizeString(source.templateId),
    workflowMode: workflowMode === "chain" || workflowMode === "quorum" ? workflowMode : "single",
    reviewers,
    reviewerRoles,
    minApprovals: typeof source.minApprovals === "number" && Number.isFinite(source.minApprovals) ? source.minApprovals : undefined,
    stages: Array.isArray(source.stages) ? source.stages.filter((item) => Boolean(item)) as GoalCapabilityPlanCheckpointPolicy["stages"] : undefined,
    suggestedTitle: normalizeString(source.suggestedTitle),
    suggestedNote: normalizeString(source.suggestedNote),
    suggestedReviewer: normalizeString(source.suggestedReviewer),
    suggestedReviewerRole: normalizeString(source.suggestedReviewerRole),
    suggestedSlaHours: typeof source.suggestedSlaHours === "number" && Number.isFinite(source.suggestedSlaHours)
      ? source.suggestedSlaHours
      : undefined,
    reminderMinutes: Array.isArray(source.reminderMinutes)
      ? source.reminderMinutes.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
      : undefined,
    escalationMode: escalationMode === "manual" ? "manual" : "none",
    escalationReviewer: normalizeString(source.escalationReviewer),
  };
}

function normalizeCapabilityPlanActualUsage(value: unknown): GoalCapabilityPlanActualUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { methods: [], skills: [], mcpServers: [], toolNames: [] };
  }
  const source = value as Record<string, unknown>;
  const normalizeList = (input: unknown) => Array.isArray(input)
    ? input.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    methods: normalizeList(source.methods),
    skills: normalizeList(source.skills),
    mcpServers: normalizeList(source.mcpServers),
    toolNames: normalizeList(source.toolNames),
    updatedAt: normalizeString(source.updatedAt),
  };
}

function normalizeCapabilityPlanDeviation(value: unknown): GoalCapabilityPlanDeviation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const kind = normalizeString(source.kind);
  const area = normalizeString(source.area);
  const severity = normalizeString(source.severity);
  const summary = normalizeString(source.summary);
  if (!kind || !area || !severity || !summary) return null;
  if (!["planned_but_unused", "unplanned_but_used", "delegation_gap", "usage_untracked"].includes(kind)) return null;
  if (!["method", "skill", "mcp", "sub_agent", "tooling"].includes(area)) return null;
  if (!["low", "medium", "high"].includes(severity)) return null;
  const normalizeList = (input: unknown) => Array.isArray(input)
    ? input.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    kind: kind as GoalCapabilityPlanDeviation["kind"],
    area: area as GoalCapabilityPlanDeviation["area"],
    severity: severity as GoalCapabilityPlanDeviation["severity"],
    summary,
    planned: normalizeList(source.planned),
    actual: normalizeList(source.actual),
  };
}

function normalizeCapabilityPlanAnalysis(value: unknown): GoalCapabilityPlanAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return getDefaultCapabilityPlanAnalysis();
  }
  const source = value as Record<string, unknown>;
  const status = normalizeString(source.status);
  const summary = normalizeString(source.summary);
  const recommendations = Array.isArray(source.recommendations)
    ? source.recommendations.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const deviations = Array.isArray(source.deviations)
    ? source.deviations.map((item) => normalizeCapabilityPlanDeviation(item)).filter((item): item is GoalCapabilityPlanDeviation => Boolean(item))
    : [];
  return {
    status: status === "aligned" || status === "partial" || status === "diverged" ? status : "pending",
    summary: summary ?? getDefaultCapabilityPlanAnalysis().summary,
    deviations,
    recommendations,
    updatedAt: normalizeString(source.updatedAt),
  };
}

function normalizeMethodCandidateEvidence(value: unknown): GoalMethodCandidate["evidence"] {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalizeList = (input: unknown) => Array.isArray(input)
    ? input.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    nodeId: normalizeString(source.nodeId) ?? "",
    runId: normalizeString(source.runId),
    nodeStatus: (() => {
      const status = normalizeString(source.nodeStatus);
      switch (status) {
        case "draft":
        case "ready":
        case "in_progress":
        case "blocked":
        case "pending_review":
        case "validating":
        case "done":
        case "failed":
        case "skipped":
          return status;
        default:
          return "draft";
      }
    })(),
    checkpointStatus: (() => {
      const status = normalizeString(source.checkpointStatus);
      switch (status) {
        case "not_required":
        case "required":
        case "waiting_user":
        case "approved":
        case "rejected":
        case "expired":
          return status;
        default:
          return "not_required";
      }
    })(),
    summary: normalizeString(source.summary),
    blockReason: normalizeString(source.blockReason),
    artifacts: normalizeList(source.artifacts),
    acceptance: normalizeList(source.acceptance),
    methodsUsed: normalizeList(source.methodsUsed),
    skillsUsed: normalizeList(source.skillsUsed),
    mcpServersUsed: normalizeList(source.mcpServersUsed),
    progressEvents: normalizeList(source.progressEvents),
    references: normalizeList(source.references),
  };
}

function normalizeMethodCandidate(value: unknown, index: number, goalId?: string): GoalMethodCandidate | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nodeId = normalizeString(source.nodeId);
  const title = normalizeString(source.title);
  const summary = normalizeString(source.summary);
  const draftContent = normalizeString(source.draftContent);
  if (!nodeId || !title || !summary || !draftContent) return null;
  const qualityScore = typeof source.qualityScore === "number" && Number.isFinite(source.qualityScore)
    ? source.qualityScore
    : 0;
  const rationale = Array.isArray(source.rationale)
    ? source.rationale.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const now = new Date().toISOString();
  return {
    id: normalizeString(source.id) ?? `method_candidate_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    nodeId,
    runId: normalizeString(source.runId),
    title,
    slug: normalizeString(source.slug) ?? `method-${index + 1}`,
    status: "suggested",
    summary,
    rationale,
    qualityScore,
    evidence: normalizeMethodCandidateEvidence(source.evidence),
    draftContent,
    createdAt: normalizeString(source.createdAt) ?? now,
  };
}

function normalizeSkillCandidateEvidence(value: unknown): GoalSkillCandidate["evidence"] {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalizeList = (input: unknown) => Array.isArray(input)
    ? input.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    nodeId: normalizeString(source.nodeId) ?? "",
    runId: normalizeString(source.runId),
    executionMode: normalizeString(source.executionMode) === "multi_agent" ? "multi_agent" : "single_agent",
    riskLevel: normalizeCapabilityRiskLevel(source.riskLevel),
    planStatus: normalizeString(source.planStatus) === "orchestrated" ? "orchestrated" : "planned",
    objective: normalizeString(source.objective) ?? "",
    summary: normalizeString(source.summary) ?? "",
    gaps: normalizeList(source.gaps),
    methodsUsed: normalizeList(source.methodsUsed),
    skillsUsed: normalizeList(source.skillsUsed),
    mcpServersUsed: normalizeList(source.mcpServersUsed),
    toolNamesUsed: normalizeList(source.toolNamesUsed),
    deviations: normalizeList(source.deviations),
    references: normalizeList(source.references),
  };
}

function normalizeSkillCandidate(value: unknown, index: number, goalId?: string): GoalSkillCandidate | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nodeId = normalizeString(source.nodeId);
  const title = normalizeString(source.title);
  const summary = normalizeString(source.summary);
  const draftContent = normalizeString(source.draftContent);
  if (!nodeId || !title || !summary || !draftContent) return null;
  const qualityScore = typeof source.qualityScore === "number" && Number.isFinite(source.qualityScore)
    ? source.qualityScore
    : 0;
  const rationale = Array.isArray(source.rationale)
    ? source.rationale.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const now = new Date().toISOString();
  return {
    id: normalizeString(source.id) ?? `skill_candidate_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    nodeId,
    runId: normalizeString(source.runId),
    title,
    slug: normalizeString(source.slug) ?? `skill-${index + 1}`,
    status: "suggested",
    summary,
    rationale,
    qualityScore,
    evidence: normalizeSkillCandidateEvidence(source.evidence),
    draftContent,
    createdAt: normalizeString(source.createdAt) ?? now,
  };
}

function normalizeFlowPattern(value: unknown, index: number, goalId?: string): GoalFlowPattern | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = normalizeString(source.id);
  const signature = normalizeString(source.signature);
  const summary = normalizeString(source.summary);
  if (!id || !signature || !summary) return null;
  const normalizeList = (input: unknown) => Array.isArray(input)
    ? input.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const nodeRefs = Array.isArray(source.nodeRefs)
    ? source.nodeRefs
      .map((item) => {
        const raw = item && typeof item === "object" && !Array.isArray(item)
          ? item as Record<string, unknown>
          : {};
        const nodeId = normalizeString(raw.nodeId);
        if (!nodeId) return null;
        const status = normalizeString(raw.status);
        const checkpointStatus = normalizeString(raw.checkpointStatus);
        const nodeRef: GoalFlowPattern["nodeRefs"][number] = {
          nodeId,
          ...(normalizeString(raw.runId) ? { runId: normalizeString(raw.runId) } : {}),
          status: status === "ready" || status === "in_progress" || status === "blocked" || status === "pending_review" || status === "validating" || status === "done" || status === "failed" || status === "skipped"
            ? status
            : "draft",
          checkpointStatus: checkpointStatus === "required" || checkpointStatus === "waiting_user" || checkpointStatus === "approved" || checkpointStatus === "rejected" || checkpointStatus === "expired"
            ? checkpointStatus
            : "not_required",
          ...(normalizeString(raw.phase) ? { phase: normalizeString(raw.phase) } : {}),
        };
        return nodeRef;
      })
      .filter((item): item is GoalFlowPattern["nodeRefs"][number] => item !== null)
    : [];
  const action = normalizeString(source.action);
  const executionMode = normalizeString(source.executionMode);
  const checkpointMode = normalizeString(source.checkpointMode);
  return {
    id,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    signature,
    summary,
    count: typeof source.count === "number" && Number.isFinite(source.count) ? source.count : 0,
    action: action === "promote_method" || action === "promote_skill" || action === "promote_both" ? action : "observe",
    confidence: typeof source.confidence === "number" && Number.isFinite(source.confidence) ? source.confidence : 0,
    eventSequence: normalizeList(source.eventSequence),
    executionMode: executionMode === "multi_agent" ? "multi_agent" : "single_agent",
    riskLevel: normalizeCapabilityRiskLevel(source.riskLevel),
    checkpointMode: checkpointMode === "single" || checkpointMode === "strict" ? checkpointMode : "none",
    toolNames: normalizeList(source.toolNames),
    mcpServers: normalizeList(source.mcpServers),
    methods: normalizeList(source.methods),
    skills: normalizeList(source.skills),
    gaps: normalizeList(source.gaps),
    nodeRefs,
    recommendations: normalizeList(source.recommendations),
  };
}

function normalizeSuggestionType(value: unknown): GoalSuggestionType | null {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "method_candidate":
    case "skill_candidate":
    case "flow_pattern":
      return normalized;
    default:
      return null;
  }
}

function normalizeSuggestionReviewStatus(value: unknown): GoalSuggestionReviewStatus {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "accepted":
    case "rejected":
    case "deferred":
    case "needs_revision":
      return normalized;
    default:
      return "pending_review";
  }
}

function normalizeSuggestionReviewWorkflowDecision(value: unknown): GoalSuggestionReviewWorkflowVote["decision"] | null {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "accepted":
    case "rejected":
    case "deferred":
    case "needs_revision":
      return normalized;
    default:
      return null;
  }
}

function normalizeSuggestionReviewWorkflowReviewer(value: unknown): GoalSuggestionReviewWorkflowReviewer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const reviewer = normalizeString(source.reviewer);
  if (!reviewer) return null;
  return {
    reviewer,
    reviewerRole: normalizeString(source.reviewerRole),
  };
}

function normalizeSuggestionReviewWorkflowVote(value: unknown): GoalSuggestionReviewWorkflowVote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const reviewer = normalizeString(source.reviewer);
  const decision = normalizeSuggestionReviewWorkflowDecision(source.decision);
  if (!reviewer || !decision) return null;
  return {
    reviewer,
    reviewerRole: normalizeString(source.reviewerRole),
    decision,
    note: normalizeString(source.note),
    decidedBy: normalizeString(source.decidedBy),
    decidedAt: normalizeString(source.decidedAt) ?? new Date().toISOString(),
  };
}

function normalizeSuggestionReviewWorkflowEscalationEvent(value: unknown): GoalSuggestionReviewWorkflowEscalationEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const at = normalizeString(source.at);
  if (!at) return null;
  return {
    at,
    by: normalizeString(source.by),
    to: normalizeString(source.to),
    reason: normalizeString(source.reason),
  };
}

function normalizeSuggestionReviewWorkflowEscalation(value: unknown): GoalSuggestionReviewWorkflowEscalation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { mode: "none", count: 0, history: [] };
  }
  const source = value as Record<string, unknown>;
  const mode = normalizeString(source.mode);
  const history = Array.isArray(source.history)
    ? source.history
      .map((item) => normalizeSuggestionReviewWorkflowEscalationEvent(item))
      .filter((item): item is GoalSuggestionReviewWorkflowEscalationEvent => Boolean(item))
    : [];
  return {
    mode: mode === "manual" ? "manual" : "none",
    count: typeof source.count === "number" && Number.isFinite(source.count) ? source.count : history.length,
    defaultReviewer: normalizeString(source.defaultReviewer),
    lastEscalatedAt: normalizeString(source.lastEscalatedAt),
    escalatedTo: normalizeString(source.escalatedTo),
    escalatedBy: normalizeString(source.escalatedBy),
    overdueAt: normalizeString(source.overdueAt),
    reason: normalizeString(source.reason),
    history,
  };
}

function normalizeSuggestionReviewWorkflowStage(value: unknown, index: number): GoalSuggestionReviewWorkflowStage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const mode = normalizeString(source.mode);
  const title = normalizeString(source.title);
  const reviewers = Array.isArray(source.reviewers)
    ? source.reviewers
      .map((item) => normalizeSuggestionReviewWorkflowReviewer(item))
      .filter((item): item is GoalSuggestionReviewWorkflowReviewer => Boolean(item))
    : [];
  const votes = Array.isArray(source.votes)
    ? source.votes
      .map((item) => normalizeSuggestionReviewWorkflowVote(item))
      .filter((item): item is GoalSuggestionReviewWorkflowVote => Boolean(item))
    : [];
  return {
    id: normalizeString(source.id) ?? `stage_${index + 1}`,
    title: title ?? `Stage ${index + 1}`,
    mode: mode === "quorum" ? "quorum" : "single",
    reviewers,
    minApprovals: typeof source.minApprovals === "number" && Number.isFinite(source.minApprovals)
      ? source.minApprovals
      : 1,
    status: normalizeSuggestionReviewStatus(source.status),
    votes,
    startedAt: normalizeString(source.startedAt) ?? new Date().toISOString(),
    decidedAt: normalizeString(source.decidedAt),
    slaAt: normalizeString(source.slaAt),
    reminderMinutes: Array.isArray(source.reminderMinutes)
      ? source.reminderMinutes.filter((item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0)
      : undefined,
    escalation: normalizeSuggestionReviewWorkflowEscalation(source.escalation),
  };
}

function normalizeSuggestionReviewWorkflow(value: unknown): GoalSuggestionReviewWorkflow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const mode = normalizeString(source.mode);
  const stages = Array.isArray(source.stages)
    ? source.stages
      .map((item, index) => normalizeSuggestionReviewWorkflowStage(item, index))
      .filter((item): item is GoalSuggestionReviewWorkflowStage => Boolean(item))
    : [];
  if (stages.length === 0) return undefined;
  return {
    mode: mode === "chain" || mode === "quorum" ? mode : "single",
    status: normalizeSuggestionReviewStatus(source.status),
    currentStageIndex: typeof source.currentStageIndex === "number" && Number.isFinite(source.currentStageIndex)
      ? Math.max(0, Math.min(stages.length - 1, source.currentStageIndex))
      : 0,
    stages,
    configuredAt: normalizeString(source.configuredAt) ?? new Date().toISOString(),
    updatedAt: normalizeString(source.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeSuggestionReviewItem(value: unknown, index: number, goalId?: string): GoalSuggestionReviewItem | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const suggestionType = normalizeSuggestionType(source.suggestionType);
  const suggestionId = normalizeString(source.suggestionId);
  const title = normalizeString(source.title);
  if (!suggestionType || !suggestionId || !title) return null;
  const now = new Date().toISOString();
  const evidenceRefs = Array.isArray(source.evidenceRefs)
    ? source.evidenceRefs.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    id: normalizeString(source.id) ?? `suggestion_review_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    suggestionType,
    suggestionId,
    title,
    summary: normalizeString(source.summary) ?? title,
    sourcePath: normalizeString(source.sourcePath) ?? "",
    nodeId: normalizeString(source.nodeId),
    runId: normalizeString(source.runId),
    status: normalizeSuggestionReviewStatus(source.status),
    reviewer: normalizeString(source.reviewer),
    decidedBy: normalizeString(source.decidedBy),
    note: normalizeString(source.note),
    decidedAt: normalizeString(source.decidedAt),
    evidenceRefs,
    workflow: normalizeSuggestionReviewWorkflow(source.workflow),
    createdAt: normalizeString(source.createdAt) ?? now,
    updatedAt: normalizeString(source.updatedAt) ?? now,
  };
}

function normalizeReviewNotification(value: unknown, index: number, goalId?: string): GoalReviewNotification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const targetType = normalizeString(source.targetType);
  const kind = normalizeString(source.kind);
  const targetId = normalizeString(source.targetId);
  const message = normalizeString(source.message);
  const dedupeKey = normalizeString(source.dedupeKey);
  const createdAt = normalizeString(source.createdAt);
  if (
    (targetType !== "suggestion_review" && targetType !== "checkpoint")
    || (kind !== "sla_reminder" && kind !== "sla_overdue" && kind !== "auto_escalated")
    || !targetId
    || !message
    || !dedupeKey
    || !createdAt
  ) {
    return null;
  }
  return {
    id: normalizeString(source.id) ?? `review_notification_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    targetType,
    targetId,
    nodeId: normalizeString(source.nodeId),
    stageId: normalizeString(source.stageId),
    recipient: normalizeString(source.recipient),
    kind,
    message,
    dedupeKey,
    createdAt,
  };
}

function normalizeReviewDeliveryChannel(value: unknown): GoalReviewDeliveryChannel | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "goal_detail":
    case "goal_channel":
    case "reviewer_inbox":
    case "org_feed":
    case "im_dm":
    case "webhook":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeReviewNotificationKind(value: unknown): GoalReviewNotificationKind | undefined {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "sla_reminder":
    case "sla_overdue":
    case "auto_escalated":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeReviewNotificationDispatchStatus(value: unknown): GoalReviewNotificationDispatchStatus {
  const normalized = normalizeString(value);
  switch (normalized) {
    case "pending":
    case "materialized":
    case "delivered":
    case "skipped":
    case "acked":
    case "failed":
      return normalized;
    default:
      return "pending";
  }
}

function normalizeReviewNotificationDispatch(
  value: unknown,
  index: number,
  goalId?: string,
): GoalReviewNotificationDispatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const targetType = normalizeString(source.targetType);
  const kind = normalizeReviewNotificationKind(source.kind);
  const targetId = normalizeString(source.targetId);
  const notificationId = normalizeString(source.notificationId);
  const channel = normalizeReviewDeliveryChannel(source.channel);
  const message = normalizeString(source.message);
  const dedupeKey = normalizeString(source.dedupeKey);
  const createdAt = normalizeString(source.createdAt);
  const updatedAt = normalizeString(source.updatedAt);
  if (
    (targetType !== "suggestion_review" && targetType !== "checkpoint")
    || !kind
    || !targetId
    || !notificationId
    || !channel
    || !message
    || !dedupeKey
    || !createdAt
    || !updatedAt
  ) {
    return null;
  }
  return {
    id: normalizeString(source.id) ?? `review_notification_dispatch_${index + 1}`,
    notificationId,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    targetType,
    targetId,
    nodeId: normalizeString(source.nodeId),
    stageId: normalizeString(source.stageId),
    kind,
    channel,
    recipient: normalizeString(source.recipient),
    routeKey: normalizeString(source.routeKey),
    message,
    dedupeKey,
    status: normalizeReviewNotificationDispatchStatus(source.status),
    createdAt,
    updatedAt,
    lastError: normalizeString(source.lastError),
  };
}

function normalizeSuggestionPublishRecord(value: unknown, index: number, goalId?: string): GoalSuggestionPublishRecord | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const suggestionType = normalizeSuggestionType(source.suggestionType);
  const suggestionId = normalizeString(source.suggestionId);
  const assetType = normalizeString(source.assetType);
  const title = normalizeString(source.title);
  const publishedPath = normalizeString(source.publishedPath);
  const assetKey = normalizeString(source.assetKey);
  const experienceCandidateId = normalizeString(source.experienceCandidateId);
  const reviewId = normalizeString(source.reviewId);
  const publishedAt = normalizeString(source.publishedAt);
  const sourcePath = normalizeString(source.sourcePath);
  if (!suggestionType || !suggestionId || !title || !publishedPath || !assetKey || !reviewId || !publishedAt || !sourcePath) {
    return null;
  }
  if (assetType !== "method" && assetType !== "skill") return null;
  return {
    id: normalizeString(source.id) ?? `publish_record_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    reviewId,
    suggestionType,
    suggestionId,
    assetType,
    title,
    publishedPath,
    assetKey,
    experienceCandidateId,
    reviewer: normalizeString(source.reviewer),
    decidedBy: normalizeString(source.decidedBy),
    note: normalizeString(source.note),
    nodeId: normalizeString(source.nodeId),
    runId: normalizeString(source.runId),
    sourcePath,
    publishedAt,
  };
}

function normalizeCapabilityPlanItem(value: unknown, index: number, goalId?: string): GoalCapabilityPlan | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const nodeId = normalizeString(source.nodeId);
  const objective = normalizeString(source.objective);
  const summary = normalizeString(source.summary);
  if (!nodeId || !objective || !summary) return null;
  const now = new Date().toISOString();
  const rawExecutionMode = normalizeString(source.executionMode);
  const executionMode = rawExecutionMode === "multi_agent"
    || rawExecutionMode === "multi_agent_parallel"
    || rawExecutionMode === "multi_agent_sequential"
    || rawExecutionMode === "auto"
    ? rawExecutionMode
    : "single_agent";
  const rawGovernanceMode = normalizeString(source.governanceMode);
  const governanceMode = rawGovernanceMode === "commander" || rawGovernanceMode === "auto"
    ? rawGovernanceMode
    : "direct";
  const status = normalizeString(source.status) === "orchestrated" ? "orchestrated" : "planned";
  const queryHints = Array.isArray(source.queryHints)
    ? source.queryHints.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const reasoning = Array.isArray(source.reasoning)
    ? source.reasoning.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  const gaps = Array.isArray(source.gaps)
    ? source.gaps.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
    : [];
  return {
    id: normalizeString(source.id) ?? `plan_${index + 1}`,
    goalId: normalizeString(source.goalId) ?? goalId ?? "",
    nodeId,
    runId: normalizeString(source.runId),
    status,
    executionMode,
    governanceMode,
    commanderAgentId: normalizeString(source.commanderAgentId),
    preferredAgents: Array.isArray(source.preferredAgents)
      ? source.preferredAgents.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))
      : [],
    riskLevel: normalizeCapabilityRiskLevel(source.riskLevel),
    objective,
    summary,
    queryHints,
    reasoning,
    methods: Array.isArray(source.methods)
      ? source.methods.map((item) => normalizeCapabilityPlanMethod(item)).filter((item): item is GoalCapabilityPlanMethod => Boolean(item))
      : [],
    skills: Array.isArray(source.skills)
      ? source.skills.map((item) => normalizeCapabilityPlanSkill(item)).filter((item): item is GoalCapabilityPlanSkill => Boolean(item))
      : [],
    mcpServers: Array.isArray(source.mcpServers)
      ? source.mcpServers.map((item) => normalizeCapabilityPlanMcpServer(item)).filter((item): item is GoalCapabilityPlanMcpServer => Boolean(item))
      : [],
    subAgents: Array.isArray(source.subAgents)
      ? source.subAgents.map((item) => normalizeCapabilityPlanSubAgent(item)).filter((item): item is GoalCapabilityPlanSubAgent => Boolean(item))
      : [],
    gaps,
    checkpoint: normalizeCapabilityPlanCheckpoint(source.checkpoint),
    actualUsage: normalizeCapabilityPlanActualUsage(source.actualUsage),
    analysis: normalizeCapabilityPlanAnalysis(source.analysis),
    generatedAt: normalizeString(source.generatedAt) ?? now,
    updatedAt: normalizeString(source.updatedAt) ?? now,
    orchestratedAt: normalizeString(source.orchestratedAt),
    orchestration: normalizeCapabilityPlanOrchestration(source.orchestration),
  };
}

export async function readGoalCheckpoints(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalCheckpointState> {
  const checkpointsPath = getGoalCheckpointsPath(goal);
  try {
    const raw = await fs.readFile(checkpointsPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => normalizeCheckpointItem(item, index, goal.id))
      : [];
    return {
      version: 2,
      items,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        version: 2,
        items: [],
      };
    }
    throw err;
  }
}

export async function writeGoalCheckpoints(goal: Pick<LongTermGoal, "runtimeRoot">, checkpoints: GoalCheckpointState): Promise<void> {
  await atomicWriteJson(getGoalCheckpointsPath(goal), {
    version: 2,
    items: checkpoints.items,
  } satisfies GoalCheckpointState);
}

export async function readGoalCapabilityPlans(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalCapabilityPlanState> {
  const plansPath = getGoalCapabilityPlansPath(goal);
  try {
    const raw = await fs.readFile(plansPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items
        .map((item, index) => normalizeCapabilityPlanItem(item, index, goal.id))
        .filter((item): item is GoalCapabilityPlan => Boolean(item))
      : [];
    return {
      version: 1,
      items,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        version: 1,
        items: [],
      };
    }
    throw err;
  }
}

export async function writeGoalCapabilityPlans(goal: Pick<LongTermGoal, "runtimeRoot">, plans: GoalCapabilityPlanState): Promise<void> {
  await atomicWriteJson(getGoalCapabilityPlansPath(goal), {
    version: 1,
    items: plans.items,
  } satisfies GoalCapabilityPlanState);
}

export async function readGoalMethodCandidates(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalMethodCandidateState> {
  const candidatesPath = getGoalMethodCandidatesPath(goal);
  try {
    const raw = await fs.readFile(candidatesPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items
        .map((item, index) => normalizeMethodCandidate(item, index, goal.id))
        .filter((item): item is GoalMethodCandidate => Boolean(item))
      : [];
    return {
      version: 1,
      items,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        version: 1,
        items: [],
      };
    }
    throw err;
  }
}

export async function writeGoalMethodCandidates(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalMethodCandidateState): Promise<void> {
  await atomicWriteJson(getGoalMethodCandidatesPath(goal), {
    version: 1,
    items: state.items,
  } satisfies GoalMethodCandidateState);
}

export async function readGoalSkillCandidates(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalSkillCandidateState> {
  const candidatesPath = getGoalSkillCandidatesPath(goal);
  try {
    const raw = await fs.readFile(candidatesPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items
        .map((item, index) => normalizeSkillCandidate(item, index, goal.id))
        .filter((item): item is GoalSkillCandidate => Boolean(item))
      : [];
    return {
      version: 1,
      items,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        version: 1,
        items: [],
      };
    }
    throw err;
  }
}

export async function writeGoalSkillCandidates(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalSkillCandidateState): Promise<void> {
  await atomicWriteJson(getGoalSkillCandidatesPath(goal), {
    version: 1,
    items: state.items,
  } satisfies GoalSkillCandidateState);
}

export async function readGoalFlowPatterns(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalFlowPatternState> {
  const patternsPath = getGoalFlowPatternsPath(goal);
  try {
    const raw = await fs.readFile(patternsPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown; generatedAt?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => normalizeFlowPattern(item, index, goal.id)).filter((item): item is GoalFlowPattern => Boolean(item))
      : [];
    return {
      version: 1,
      items,
      generatedAt: normalizeString(parsed.generatedAt),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, items: [] };
    }
    throw err;
  }
}

export async function writeGoalFlowPatterns(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalFlowPatternState): Promise<void> {
  await atomicWriteJson(getGoalFlowPatternsPath(goal), {
    version: 1,
    items: state.items,
    generatedAt: state.generatedAt,
  } satisfies GoalFlowPatternState);
}

export async function readGoalSuggestionReviews(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalSuggestionReviewState> {
  const reviewsPath = getGoalSuggestionReviewsPath(goal);
  try {
    const raw = await fs.readFile(reviewsPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown; syncedAt?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => normalizeSuggestionReviewItem(item, index, goal.id)).filter((item): item is GoalSuggestionReviewItem => Boolean(item))
      : [];
    return {
      version: 1,
      items,
      syncedAt: normalizeString(parsed.syncedAt),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, items: [] };
    }
    throw err;
  }
}

export async function writeGoalSuggestionReviews(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalSuggestionReviewState): Promise<void> {
  await atomicWriteJson(getGoalSuggestionReviewsPath(goal), {
    version: 1,
    items: state.items,
    syncedAt: state.syncedAt,
  } satisfies GoalSuggestionReviewState);
}

export async function readGoalPublishRecords(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalSuggestionPublishState> {
  const recordsPath = getGoalPublishRecordsPath(goal);
  try {
    const raw = await fs.readFile(recordsPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown; items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => normalizeSuggestionPublishRecord(item, index, goal.id)).filter((item): item is GoalSuggestionPublishRecord => Boolean(item))
      : [];
    return { version: 1, items };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: 1, items: [] };
    }
    throw err;
  }
}

export async function writeGoalPublishRecords(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalSuggestionPublishState): Promise<void> {
  await atomicWriteJson(getGoalPublishRecordsPath(goal), {
    version: 1,
    items: state.items,
  } satisfies GoalSuggestionPublishState);
}

export async function readGoalReviewNotifications(goal: Pick<LongTermGoal, "runtimeRoot" | "id">): Promise<GoalReviewNotificationState> {
  const notificationsPath = getGoalReviewNotificationsPath(goal);
  try {
    const raw = await fs.readFile(notificationsPath, "utf-8");
    const parsed = JSON.parse(raw) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => normalizeReviewNotification(item, index, goal.id)).filter((item): item is GoalReviewNotification => Boolean(item))
      : [];
    return { version: 1, items };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return getDefaultGoalReviewNotifications();
    }
    throw err;
  }
}

export async function writeGoalReviewNotifications(goal: Pick<LongTermGoal, "runtimeRoot">, state: GoalReviewNotificationState): Promise<void> {
  await atomicWriteJson(getGoalReviewNotificationsPath(goal), {
    version: 1,
    items: state.items,
  } satisfies GoalReviewNotificationState);
}

export async function readGoalReviewNotificationDispatches(
  goal: Pick<LongTermGoal, "runtimeRoot" | "id">,
): Promise<GoalReviewNotificationDispatchState> {
  const dispatchesPath = getGoalReviewNotificationDispatchesPath(goal);
  try {
    const raw = await fs.readFile(dispatchesPath, "utf-8");
    const parsed = JSON.parse(raw) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items
        .map((item, index) => normalizeReviewNotificationDispatch(item, index, goal.id))
        .filter((item): item is GoalReviewNotificationDispatch => Boolean(item))
      : [];
    return { version: 1, items };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return getDefaultGoalReviewNotificationDispatches();
    }
    throw err;
  }
}

export async function writeGoalReviewNotificationDispatches(
  goal: Pick<LongTermGoal, "runtimeRoot">,
  state: GoalReviewNotificationDispatchState,
): Promise<void> {
  await atomicWriteJson(getGoalReviewNotificationDispatchesPath(goal), {
    version: 1,
    items: state.items,
  } satisfies GoalReviewNotificationDispatchState);
}

async function ensureJsonFile(targetPath: string, value: unknown): Promise<void> {
  try {
    await fs.access(targetPath);
  } catch {
    await atomicWriteJson(targetPath, value);
  }
}
