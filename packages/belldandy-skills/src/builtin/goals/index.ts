import type { Tool } from "../../types.js";
import { withToolContract } from "../../tool-contract.js";
import { goalInitTool as baseGoalInitTool } from "./goal-init.js";
import { goalGetTool as baseGoalGetTool } from "./goal-get.js";
import { goalListTool as baseGoalListTool } from "./goal-list.js";
import { goalResumeTool as baseGoalResumeTool } from "./goal-resume.js";
import { goalPauseTool as baseGoalPauseTool } from "./goal-pause.js";
import { goalHandoffGenerateTool as baseGoalHandoffGenerateTool } from "./goal-handoff-generate.js";
import { goalRetrospectGenerateTool as baseGoalRetrospectGenerateTool } from "./goal-retrospect-generate.js";
import { goalExperienceSuggestTool as baseGoalExperienceSuggestTool } from "./goal-experience-suggest.js";
import { goalMethodCandidatesGenerateTool as baseGoalMethodCandidatesGenerateTool } from "./goal-method-candidates-generate.js";
import { goalSkillCandidatesGenerateTool as baseGoalSkillCandidatesGenerateTool } from "./goal-skill-candidates-generate.js";
import { goalFlowPatternsGenerateTool as baseGoalFlowPatternsGenerateTool } from "./goal-flow-patterns-generate.js";
import { goalCrossGoalFlowPatternsTool as baseGoalCrossGoalFlowPatternsTool } from "./goal-cross-goal-flow-patterns.js";
import { goalReviewGovernanceSummaryTool as baseGoalReviewGovernanceSummaryTool } from "./goal-review-governance-summary.js";
import { goalApprovalScanTool as baseGoalApprovalScanTool } from "./goal-approval-scan.js";
import { goalSuggestionReviewListTool as baseGoalSuggestionReviewListTool } from "./goal-suggestion-review-list.js";
import { goalSuggestionReviewWorkflowSetTool as baseGoalSuggestionReviewWorkflowSetTool } from "./goal-suggestion-review-workflow-set.js";
import { goalSuggestionReviewDecideTool as baseGoalSuggestionReviewDecideTool } from "./goal-suggestion-review-decide.js";
import { goalSuggestionReviewEscalateTool as baseGoalSuggestionReviewEscalateTool } from "./goal-suggestion-review-escalate.js";
import { goalSuggestionReviewScanTool as baseGoalSuggestionReviewScanTool } from "./goal-suggestion-review-scan.js";
import { goalSuggestionPublishTool as baseGoalSuggestionPublishTool } from "./goal-suggestion-publish.js";
import { goalCheckpointListTool as baseGoalCheckpointListTool } from "./goal-checkpoint-list.js";
import { goalCheckpointRequestTool as baseGoalCheckpointRequestTool } from "./goal-checkpoint-request.js";
import { goalCheckpointApproveTool as baseGoalCheckpointApproveTool } from "./goal-checkpoint-approve.js";
import { goalCheckpointRejectTool as baseGoalCheckpointRejectTool } from "./goal-checkpoint-reject.js";
import { goalCheckpointExpireTool as baseGoalCheckpointExpireTool } from "./goal-checkpoint-expire.js";
import { goalCheckpointReopenTool as baseGoalCheckpointReopenTool } from "./goal-checkpoint-reopen.js";
import { goalCheckpointEscalateTool as baseGoalCheckpointEscalateTool } from "./goal-checkpoint-escalate.js";
import { goalCapabilityPlanTool as baseGoalCapabilityPlanTool } from "./goal-capability-plan.js";
import { goalOrchestrateTool as baseGoalOrchestrateTool } from "./goal-orchestrate.js";
import { goalCommanderDecideTool as baseGoalCommanderDecideTool } from "./goal-commander-decide.js";
import { taskGraphReadTool as baseTaskGraphReadTool } from "./task-graph-read.js";
import { taskGraphCreateTool as baseTaskGraphCreateTool } from "./task-graph-create.js";
import { taskGraphUpdateTool as baseTaskGraphUpdateTool } from "./task-graph-update.js";
import { taskGraphClaimTool as baseTaskGraphClaimTool } from "./task-graph-claim.js";
import { taskGraphPendingReviewTool as baseTaskGraphPendingReviewTool } from "./task-graph-pending-review.js";
import { taskGraphValidatingTool as baseTaskGraphValidatingTool } from "./task-graph-validating.js";
import { taskGraphCompleteTool as baseTaskGraphCompleteTool } from "./task-graph-complete.js";
import { taskGraphBlockTool as baseTaskGraphBlockTool } from "./task-graph-block.js";
import { taskGraphFailTool as baseTaskGraphFailTool } from "./task-graph-fail.js";
import { taskGraphSkipTool as baseTaskGraphSkipTool } from "./task-graph-skip.js";

function withGoalReadContract(tool: Tool, activityDescription: string): Tool {
  return withToolContract(tool, {
    family: "goal-governance",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription,
    resultSchema: {
      kind: "text",
      description: "Goal governance read result text.",
    },
    outputPersistencePolicy: "conversation",
  });
}

function withGoalArtifactContract(
  tool: Tool,
  activityDescription: string,
  riskLevel: "medium" | "high" = "medium",
): Tool {
  return withToolContract(tool, {
    family: "goal-governance",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    riskLevel,
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription,
    resultSchema: {
      kind: "text",
      description: "Goal artifact generation result text.",
    },
    outputPersistencePolicy: "artifact",
  });
}

function withGoalStateContract(
  tool: Tool,
  activityDescription: string,
  riskLevel: "medium" | "high" = "medium",
): Tool {
  return withToolContract(tool, {
    family: "goal-governance",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: false,
    riskLevel,
    channels: ["gateway", "web"],
    safeScopes: ["local-safe", "web-safe"],
    activityDescription,
    resultSchema: {
      kind: "text",
      description: "Goal state update result text.",
    },
    outputPersistencePolicy: "external-state",
  });
}

export const goalInitTool = withGoalStateContract(
  baseGoalInitTool,
  "Create a new long-running goal workspace",
);
export const goalGetTool = withGoalReadContract(
  baseGoalGetTool,
  "Read goal details and current runtime state",
);
export const goalListTool = withGoalReadContract(
  baseGoalListTool,
  "List registered long-running goals",
);
export const goalResumeTool = withGoalStateContract(
  baseGoalResumeTool,
  "Resume a goal and activate its conversation context",
);
export const goalPauseTool = withGoalStateContract(
  baseGoalPauseTool,
  "Pause a goal and update its runtime state",
);
export const goalHandoffGenerateTool = withGoalArtifactContract(
  baseGoalHandoffGenerateTool,
  "Generate a handoff summary for a goal",
);
export const goalRetrospectGenerateTool = withGoalArtifactContract(
  baseGoalRetrospectGenerateTool,
  "Generate a retrospective report for a goal",
);
export const goalExperienceSuggestTool = withGoalArtifactContract(
  baseGoalExperienceSuggestTool,
  "Generate experience suggestions from goal history",
);
export const goalMethodCandidatesGenerateTool = withGoalArtifactContract(
  baseGoalMethodCandidatesGenerateTool,
  "Generate method candidates for goal execution",
);
export const goalSkillCandidatesGenerateTool = withGoalArtifactContract(
  baseGoalSkillCandidatesGenerateTool,
  "Generate skill candidates for goal execution",
);
export const goalFlowPatternsGenerateTool = withGoalArtifactContract(
  baseGoalFlowPatternsGenerateTool,
  "Generate flow patterns from goal execution traces",
);
export const goalCrossGoalFlowPatternsTool = withGoalReadContract(
  baseGoalCrossGoalFlowPatternsTool,
  "Read cross-goal flow pattern summaries",
);
export const goalReviewGovernanceSummaryTool = withGoalReadContract(
  baseGoalReviewGovernanceSummaryTool,
  "Read governance and review summary for a goal",
);
export const goalApprovalScanTool = withGoalStateContract(
  baseGoalApprovalScanTool,
  "Scan goal approvals and dispatch overdue review actions",
  "high",
);
export const goalSuggestionReviewListTool = withGoalReadContract(
  baseGoalSuggestionReviewListTool,
  "List suggestion review items for a goal",
);
export const goalSuggestionReviewWorkflowSetTool = withGoalStateContract(
  baseGoalSuggestionReviewWorkflowSetTool,
  "Configure goal suggestion review workflow",
  "high",
);
export const goalSuggestionReviewDecideTool = withGoalStateContract(
  baseGoalSuggestionReviewDecideTool,
  "Decide a goal suggestion review item",
  "high",
);
export const goalSuggestionReviewEscalateTool = withGoalStateContract(
  baseGoalSuggestionReviewEscalateTool,
  "Escalate a goal suggestion review workflow",
  "high",
);
export const goalSuggestionReviewScanTool = withGoalStateContract(
  baseGoalSuggestionReviewScanTool,
  "Scan goal suggestion reviews for overdue stages",
  "high",
);
export const goalSuggestionPublishTool = withGoalStateContract(
  baseGoalSuggestionPublishTool,
  "Publish an accepted goal suggestion",
  "high",
);
export const goalCheckpointListTool = withGoalReadContract(
  baseGoalCheckpointListTool,
  "List checkpoints for the current goal",
);
export const goalCheckpointRequestTool = withGoalStateContract(
  baseGoalCheckpointRequestTool,
  "Request a new goal checkpoint",
);
export const goalCheckpointApproveTool = withGoalStateContract(
  baseGoalCheckpointApproveTool,
  "Approve a goal checkpoint",
  "high",
);
export const goalCheckpointRejectTool = withGoalStateContract(
  baseGoalCheckpointRejectTool,
  "Reject a goal checkpoint",
  "high",
);
export const goalCheckpointExpireTool = withGoalStateContract(
  baseGoalCheckpointExpireTool,
  "Expire a goal checkpoint",
  "high",
);
export const goalCheckpointReopenTool = withGoalStateContract(
  baseGoalCheckpointReopenTool,
  "Reopen a goal checkpoint",
  "high",
);
export const goalCheckpointEscalateTool = withGoalStateContract(
  baseGoalCheckpointEscalateTool,
  "Escalate a goal checkpoint",
  "high",
);
export const goalCapabilityPlanTool = withGoalReadContract(
  baseGoalCapabilityPlanTool,
  "Generate and read a goal capability plan",
);
export const goalOrchestrateTool = withGoalStateContract(
  baseGoalOrchestrateTool,
  "Orchestrate goal execution across task nodes and sub-agents",
  "high",
);
export const goalCommanderDecideTool = withGoalStateContract(
  baseGoalCommanderDecideTool,
  "Apply an explicit commander decision to a governed task node",
  "high",
);
export const taskGraphReadTool = withGoalReadContract(
  baseTaskGraphReadTool,
  "Read the task graph for a goal",
);
export const taskGraphCreateTool = withGoalStateContract(
  baseTaskGraphCreateTool,
  "Create a task node in a goal task graph",
);
export const taskGraphUpdateTool = withGoalStateContract(
  baseTaskGraphUpdateTool,
  "Update a task node in a goal task graph",
);
export const taskGraphClaimTool = withGoalStateContract(
  baseTaskGraphClaimTool,
  "Claim a task node in a goal task graph",
);
export const taskGraphPendingReviewTool = withGoalStateContract(
  baseTaskGraphPendingReviewTool,
  "Move a task node to pending-review state",
);
export const taskGraphValidatingTool = withGoalStateContract(
  baseTaskGraphValidatingTool,
  "Move a task node to validating state",
);
export const taskGraphCompleteTool = withGoalStateContract(
  baseTaskGraphCompleteTool,
  "Mark a task node as complete",
);
export const taskGraphBlockTool = withGoalStateContract(
  baseTaskGraphBlockTool,
  "Mark a task node as blocked",
);
export const taskGraphFailTool = withGoalStateContract(
  baseTaskGraphFailTool,
  "Mark a task node as failed",
);
export const taskGraphSkipTool = withGoalStateContract(
  baseTaskGraphSkipTool,
  "Mark a task node as skipped",
);
