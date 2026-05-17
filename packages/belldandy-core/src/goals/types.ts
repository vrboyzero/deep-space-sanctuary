import type { ContinuationStateSnapshot } from "../continuation-state.js";
import type { LearningReviewInput } from "../learning-review-input.js";

export type GoalStatus =
  | "draft"
  | "aligning"
  | "planning"
  | "ready"
  | "executing"
  | "blocked"
  | "pending_approval"
  | "reviewing"
  | "paused"
  | "completed"
  | "archived";

export type GoalPathSource = "default" | "user-configured";

export type GoalTaskNodeStatus =
  | "draft"
  | "ready"
  | "in_progress"
  | "blocked"
  | "pending_review"
  | "validating"
  | "done"
  | "failed"
  | "skipped";

export type GoalTaskCheckpointStatus =
  | "not_required"
  | "required"
  | "waiting_user"
  | "approved"
  | "rejected"
  | "expired";

export type GoalCheckpointItemStatus =
  | "required"
  | "waiting_user"
  | "approved"
  | "rejected"
  | "expired";

export type GoalCheckpointHistoryAction =
  | "requested"
  | "reviewed"
  | "approved"
  | "rejected"
  | "expired"
  | "reopened"
  | "escalated"
  | "reminded";

export type GoalCheckpointPolicyMode = "none" | "single" | "strict";

export type GoalCheckpointPolicyField =
  | "reviewer"
  | "reviewerRole"
  | "requestedBy"
  | "slaAt"
  | "summary"
  | "note"
  | "decidedBy";

export type GoalCheckpointPolicy = {
  riskLevel?: GoalCapabilityRiskLevel;
  approvalMode: GoalCheckpointPolicyMode;
  requiredRequestFields: GoalCheckpointPolicyField[];
  requiredDecisionFields: GoalCheckpointPolicyField[];
  templateId?: string;
  workflowMode?: GoalSuggestionReviewWorkflowMode;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: GoalSuggestionReviewWorkflowStageInput[];
  suggestedReviewer?: string;
  suggestedReviewerRole?: string;
  suggestedSlaHours?: number;
  reminderMinutes?: number[];
  escalationMode?: "none" | "manual";
  escalationReviewer?: string;
  rationale?: string[];
};

export type GoalPaths = {
  registryPath: string;
  defaultGoalsRoot: string;
  docsRoot: string;
  goalRoot: string;
  runtimeRoot: string;
  docRoot: string;
  northstarPath: string;
  tasksPath: string;
  progressPath: string;
  handoffPath: string;
};

export type LongTermGoal = {
  id: string;
  slug: string;
  title: string;
  status: GoalStatus;
  objective?: string;
  currentPhase?: string;
  nonGoals?: string[];
  constraints?: string[];
  successCriteria?: string[];
  goalRoot: string;
  runtimeRoot: string;
  docRoot: string;
  northstarPath: string;
  tasksPath: string;
  progressPath: string;
  handoffPath: string;
  registryPath: string;
  pathSource: GoalPathSource;
  boardId?: string;
  activeConversationId?: string;
  activeNodeId?: string;
  lastNodeId?: string;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
  pausedAt?: string;
};

export type GoalRegistryEntry = LongTermGoal;

export type GoalRegistry = {
  version: 1;
  goals: GoalRegistryEntry[];
  updatedAt: string;
};

export type GoalRuntimeState = {
  goalId: string;
  status: GoalStatus;
  activeConversationId?: string;
  activeNodeId?: string;
  lastNodeId?: string;
  lastRunId?: string;
  pausedAt?: string;
  resumedAt?: string;
  updatedAt: string;
};

export type GoalCheckpointState = {
  version: 2;
  items: GoalCheckpointItem[];
};

export type GoalCheckpointItem = {
  id: string;
  goalId?: string;
  nodeId?: string;
  runId?: string;
  status: GoalCheckpointItemStatus;
  title: string;
  summary?: string;
  note?: string;
  reviewer?: string;
  reviewerRole?: string;
  requestedBy?: string;
  decidedBy?: string;
  slaAt?: string;
  requestedAt?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
  policy?: GoalCheckpointPolicy;
  workflow?: GoalSuggestionReviewWorkflow;
  history: GoalCheckpointHistoryEntry[];
};

export type GoalCheckpointHistoryEntry = {
  action: GoalCheckpointHistoryAction;
  status: GoalCheckpointItemStatus;
  at: string;
  summary?: string;
  note?: string;
  actor?: string;
  reviewer?: string;
  reviewerRole?: string;
  requestedBy?: string;
  decidedBy?: string;
  slaAt?: string;
  runId?: string;
};

export type GoalScaffoldInput = {
  title: string;
  slug?: string;
  objective?: string;
  goalRoot?: string;
  currentPhase?: string;
};

export type GoalTaskNode = {
  id: string;
  title: string;
  status: GoalTaskNodeStatus;
  description?: string;
  phase?: string;
  owner?: string;
  dependsOn: string[];
  acceptance: string[];
  artifacts: string[];
  summary?: string;
  blockReason?: string;
  checkpointRequired: boolean;
  checkpointStatus: GoalTaskCheckpointStatus;
  lastRunId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedAt?: string;
};

export type GoalTaskEdge = {
  id: string;
  from: string;
  to: string;
  kind: "depends_on";
};

export type GoalTaskGraph = {
  version: 2;
  goalId?: string;
  updatedAt: string;
  nodes: GoalTaskNode[];
  edges: GoalTaskEdge[];
};

export type GoalTaskNodeCreateInput = {
  id?: string;
  title: string;
  description?: string;
  phase?: string;
  owner?: string;
  dependsOn?: string[];
  acceptance?: string[];
  checkpointRequired?: boolean;
  checkpointStatus?: GoalTaskCheckpointStatus;
  metadata?: Record<string, unknown>;
  status?: "draft" | "ready" | "blocked" | "skipped";
};

export type GoalTaskNodeUpdateInput = {
  title?: string;
  description?: string;
  phase?: string;
  owner?: string;
  dependsOn?: string[];
  acceptance?: string[];
  artifacts?: string[];
  checkpointRequired?: boolean;
  checkpointStatus?: GoalTaskCheckpointStatus;
  metadata?: Record<string, unknown>;
};

export type GoalTaskNodeTransitionInput = {
  owner?: string;
  summary?: string;
  blockReason?: string;
  artifacts?: string[];
  checkpointStatus?: GoalTaskCheckpointStatus;
  runId?: string;
};

export type GoalCheckpointRequestInput = {
  title?: string;
  summary?: string;
  note?: string;
  reviewer?: string;
  reviewerRole?: string;
  requestedBy?: string;
  slaAt?: string;
  runId?: string;
};

export type GoalCheckpointDecisionInput = {
  checkpointId?: string;
  summary?: string;
  note?: string;
  reviewer?: string;
  reviewerRole?: string;
  requestedBy?: string;
  decidedBy?: string;
  slaAt?: string;
  runId?: string;
};

export type GoalCapabilityExecutionMode =
  | "single_agent"
  | "multi_agent"
  | "multi_agent_parallel"
  | "multi_agent_sequential"
  | "auto";

export type GoalCapabilityGovernanceMode = "direct" | "commander" | "auto";

export type GoalCapabilityPlanStatus = "planned" | "orchestrated";

export type GoalCapabilityRiskLevel = "low" | "medium" | "high";

export type GoalCapabilityPlanMethod = {
  file: string;
  title?: string;
  score?: number;
  reason?: string;
};

export type GoalCapabilityPlanSkill = {
  name: string;
  description?: string;
  priority?: string;
  source?: string;
  score?: number;
  reason?: string;
};

export type GoalCapabilityPlanMcpServer = {
  serverId: string;
  status: "connected" | "disconnected" | "unknown";
  toolCount?: number;
  resourceCount?: number;
  reason?: string;
};

export type GoalCapabilityPlanSubAgent = {
  agentId: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  objective: string;
  reason?: string;
  deliverable?: string;
  handoffToVerifier?: boolean;
  catalogDefault?: {
    permissionMode?: "plan" | "acceptEdits" | "confirm";
    allowedToolFamilies?: string[];
    maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
    handoffStyle?: "summary" | "structured";
    whenToUse?: string[];
    skills?: string[];
  };
};

export type GoalCapabilityPlanRolePolicy = {
  selectedRoles: Array<"default" | "coder" | "researcher" | "verifier">;
  selectionReasons: string[];
  verifierRole?: "verifier";
  fanInStrategy: "main_agent_summary" | "verifier_handoff" | "commander_review";
};

export type GoalCapabilityPlanCoordinationPlan = {
  summary: string;
  plannedDelegationCount: number;
  managerAgentId?: string;
  rolePolicy: GoalCapabilityPlanRolePolicy;
};

export type GoalCapabilityPlanDelegationResult = {
  agentId: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  status: "success" | "failed" | "skipped";
  summary: string;
  error?: string;
  sessionId?: string;
  taskId?: string;
  outputPath?: string;
};

export type GoalCapabilityPlanVerifierHandoff = {
  status: "not_required" | "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
  verifierRole?: "verifier";
  verifierAgentId?: string;
  verifierTaskId?: string;
  verifierSessionId?: string;
  summary: string;
  sourceAgentIds: string[];
  sourceTaskIds?: string[];
  outputPath?: string;
  notes?: string[];
  error?: string;
};

export type GoalCapabilityPlanVerifierFinding = {
  severity: "low" | "medium" | "high";
  summary: string;
};

export type GoalCapabilityPlanVerifierResult = {
  status: "pending" | "completed" | "failed";
  summary: string;
  findings: GoalCapabilityPlanVerifierFinding[];
  recommendation: "approve" | "revise" | "blocked" | "unknown";
  evidenceTaskIds?: string[];
  outputPath?: string;
  generatedAt: string;
};

export type GoalCapabilityPlanAcceptanceGateCheck = {
  id: string;
  label: string;
  status: "passed" | "failed";
  enforced: boolean;
  evidence?: string;
};

export type GoalCapabilityPlanAcceptanceGate = {
  status: "pending" | "accepted" | "rejected";
  summary: string;
  reasons: string[];
  requiredSourceAgentIds?: string[];
  missingSourceAgentIds?: string[];
  requiredSourceTaskIds?: string[];
  missingSourceTaskIds?: string[];
  requiredEvidenceTaskIds?: string[];
  missingEvidenceTaskIds?: string[];
  contractSpecificChecks?: GoalCapabilityPlanAcceptanceGateCheck[];
  rejectionConfidence?: "low" | "medium" | "high";
  managerActionHint?: string;
};

export type GoalCapabilityPlanFinalApprovalMode = "user_required" | "agent_auto_complete";

export type GoalCapabilityPlanOrchestration = {
  claimed?: boolean;
  delegated?: boolean;
  delegationCount?: number;
  finalApprovalMode?: GoalCapabilityPlanFinalApprovalMode;
  reworkRevisionCount?: number;
  lastReworkReason?: string;
  lastReworkAt?: string;
  reworkTargetAgentIds?: string[];
  reworkContext?: {
    quickSummary?: string;
    historySummary?: string;
    persistedReason?: string;
  };
  coordinationPlan?: GoalCapabilityPlanCoordinationPlan;
  delegationResults?: GoalCapabilityPlanDelegationResult[];
  verifierHandoff?: GoalCapabilityPlanVerifierHandoff;
  verifierResult?: GoalCapabilityPlanVerifierResult;
  acceptanceGate?: GoalCapabilityPlanAcceptanceGate;
  notes?: string[];
};

export type GoalCapabilityPlanCheckpointPolicy = {
  required: boolean;
  reasons: string[];
  approvalMode: GoalCheckpointPolicyMode;
  requiredRequestFields: GoalCheckpointPolicyField[];
  requiredDecisionFields: GoalCheckpointPolicyField[];
  templateId?: string;
  workflowMode?: GoalSuggestionReviewWorkflowMode;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: GoalSuggestionReviewWorkflowStageInput[];
  suggestedTitle?: string;
  suggestedNote?: string;
  suggestedReviewer?: string;
  suggestedReviewerRole?: string;
  suggestedSlaHours?: number;
  reminderMinutes?: number[];
  escalationMode?: "none" | "manual";
  escalationReviewer?: string;
};

export type GoalCapabilityPlanActualUsage = {
  methods: string[];
  skills: string[];
  mcpServers: string[];
  toolNames: string[];
  updatedAt?: string;
};

export type GoalCapabilityPlanAnalysisStatus = "pending" | "aligned" | "partial" | "diverged";

export type GoalCapabilityPlanDeviationKind =
  | "planned_but_unused"
  | "unplanned_but_used"
  | "delegation_gap"
  | "usage_untracked";

export type GoalCapabilityPlanDeviationArea = "method" | "skill" | "mcp" | "sub_agent" | "tooling";

export type GoalCapabilityPlanDeviation = {
  kind: GoalCapabilityPlanDeviationKind;
  area: GoalCapabilityPlanDeviationArea;
  severity: "low" | "medium" | "high";
  summary: string;
  planned?: string[];
  actual?: string[];
};

export type GoalCapabilityPlanAnalysis = {
  status: GoalCapabilityPlanAnalysisStatus;
  summary: string;
  deviations: GoalCapabilityPlanDeviation[];
  recommendations: string[];
  updatedAt?: string;
};

export type GoalCapabilityPlan = {
  id: string;
  goalId: string;
  nodeId: string;
  runId?: string;
  status: GoalCapabilityPlanStatus;
  executionMode: GoalCapabilityExecutionMode;
  governanceMode: GoalCapabilityGovernanceMode;
  commanderAgentId?: string;
  preferredAgents: string[];
  riskLevel: GoalCapabilityRiskLevel;
  objective: string;
  summary: string;
  queryHints: string[];
  reasoning: string[];
  methods: GoalCapabilityPlanMethod[];
  skills: GoalCapabilityPlanSkill[];
  mcpServers: GoalCapabilityPlanMcpServer[];
  subAgents: GoalCapabilityPlanSubAgent[];
  gaps: string[];
  checkpoint: GoalCapabilityPlanCheckpointPolicy;
  actualUsage: GoalCapabilityPlanActualUsage;
  analysis: GoalCapabilityPlanAnalysis;
  generatedAt: string;
  updatedAt: string;
  orchestratedAt?: string;
  orchestration?: GoalCapabilityPlanOrchestration;
};

export type GoalCapabilityPlanState = {
  version: 1;
  items: GoalCapabilityPlan[];
};

export type GoalCapabilityPlanSaveInput = {
  id?: string;
  runId?: string;
  status?: GoalCapabilityPlanStatus;
  executionMode: GoalCapabilityExecutionMode;
  governanceMode?: GoalCapabilityGovernanceMode;
  commanderAgentId?: string;
  preferredAgents?: string[];
  riskLevel?: GoalCapabilityRiskLevel;
  objective: string;
  summary: string;
  queryHints?: string[];
  reasoning?: string[];
  methods?: GoalCapabilityPlanMethod[];
  skills?: GoalCapabilityPlanSkill[];
  mcpServers?: GoalCapabilityPlanMcpServer[];
  subAgents?: GoalCapabilityPlanSubAgent[];
  gaps?: string[];
  checkpoint?: GoalCapabilityPlanCheckpointPolicy;
  actualUsage?: GoalCapabilityPlanActualUsage;
  orchestratedAt?: string;
  orchestration?: GoalCapabilityPlanOrchestration;
};

export type GoalHandoffResumeMode =
  | "goal_channel"
  | "current_node"
  | "last_node"
  | "checkpoint"
  | "blocked";

export type GoalHandoffCheckpointSummary = {
  id: string;
  status: GoalCheckpointItemStatus;
  title: string;
  nodeId?: string;
  summary?: string;
  reviewer?: string;
  reviewerRole?: string;
  updatedAt: string;
};

export type GoalHandoffBlocker = {
  kind: "node" | "checkpoint" | "bridge";
  id: string;
  title: string;
  status: string;
  nodeId?: string;
  reason?: string;
};

export type GoalHandoffBridgeItem = {
  nodeId: string;
  title: string;
  taskId?: string;
  runtimeState?: "active" | "closed" | "runtime-lost" | "orphaned";
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
  blockReason?: string;
  artifactPath?: string;
  transcriptPath?: string;
  summaryLines: string[];
};

export type GoalHandoffBridgeSummary = {
  bridgeNodeCount: number;
  activeCount: number;
  runtimeLostCount: number;
  orphanedCount: number;
  closedCount: number;
  blockedCount: number;
  artifactCount: number;
  transcriptCount: number;
  items: GoalHandoffBridgeItem[];
};

export type GoalHandoffTimelineEntry = {
  at: string;
  event: string;
  title: string;
  nodeId?: string;
  status?: string;
  runId?: string;
  checkpointId?: string;
  summary?: string;
  note?: string;
};

export type GoalHandoffCapabilityFocus = {
  planId: string;
  nodeId: string;
  status: GoalCapabilityPlanStatus;
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  alignment: GoalCapabilityPlanAnalysisStatus;
  summary: string;
};

export type GoalHandoffTrackingSnapshot = {
  totalNodes: number;
  completedNodes: number;
  inProgressNodes: number;
  blockedNodes: number;
  pendingReviewNodes: number;
  validatingNodes: number;
  failedNodes: number;
  skippedNodes: number;
  openCheckpointCount: number;
};

export type GoalCheckpointReplayDescriptor = {
  checkpointId: string;
  nodeId: string;
  runId?: string;
  title: string;
  summary?: string;
  reason: string;
};

export type GoalHandoffSnapshot = {
  version: 1;
  goalId: string;
  generatedAt: string;
  goalStatus: GoalStatus;
  currentPhase?: string;
  activeConversationId?: string;
  activeNodeId?: string;
  lastNodeId?: string;
  lastRunId?: string;
  resumeMode: GoalHandoffResumeMode;
  recommendedNodeId?: string;
  summary: string;
  nextAction: string;
  tracking: GoalHandoffTrackingSnapshot;
  openCheckpoints: GoalHandoffCheckpointSummary[];
  checkpointReplay?: GoalCheckpointReplayDescriptor;
  blockers: GoalHandoffBlocker[];
  bridgeGovernance?: GoalHandoffBridgeSummary;
  focusCapability?: GoalHandoffCapabilityFocus;
  recentProgress: GoalHandoffTimelineEntry[];
};

export type GoalHandoffGenerateResult = {
  goal: LongTermGoal;
  handoff: GoalHandoffSnapshot;
  continuationState: ContinuationStateSnapshot;
  content: string;
};

export type GoalHandoffReadResult = GoalHandoffGenerateResult;

export type GoalRetrospectiveOutcome = "completed" | "in_progress" | "blocked" | "paused" | "archived";

export type GoalRetrospectiveCheckpointSummary = {
  total: number;
  waitingUserCount: number;
  approvedCount: number;
  rejectedCount: number;
  expiredCount: number;
};

export type GoalRetrospectiveCapabilitySummary = {
  totalPlans: number;
  orchestratedPlans: number;
  highRiskPlans: number;
  divergedPlans: number;
  uniqueMethods: string[];
  uniqueSkills: string[];
  uniqueMcpServers: string[];
  topGaps: string[];
};

export type GoalRetrospectiveNodeSummary = {
  id: string;
  title: string;
  status: GoalTaskNodeStatus;
  phase?: string;
  owner?: string;
  summary?: string;
  blockReason?: string;
  checkpointStatus: GoalTaskCheckpointStatus;
  lastRunId?: string;
  artifacts: string[];
  updatedAt: string;
};

export type GoalRetrospectiveSnapshot = {
  version: 1;
  goalId: string;
  generatedAt: string;
  goalStatus: GoalStatus;
  currentPhase?: string;
  objective?: string;
  outcome: GoalRetrospectiveOutcome;
  summary: string;
  nextFocus: string;
  handoffSummary: string;
  taskSummary: GoalHandoffTrackingSnapshot;
  checkpointSummary: GoalRetrospectiveCheckpointSummary;
  capabilitySummary: GoalRetrospectiveCapabilitySummary;
  achievements: string[];
  blockers: string[];
  recommendations: string[];
  highlightedNodes: GoalRetrospectiveNodeSummary[];
  recentProgress: GoalHandoffTimelineEntry[];
  markdownPath: string;
  jsonPath: string;
};

export type GoalRetrospectiveGenerateResult = {
  goal: LongTermGoal;
  retrospective: GoalRetrospectiveSnapshot;
  content: string;
};

export type GoalMethodCandidateEvidence = {
  nodeId: string;
  runId?: string;
  nodeStatus: GoalTaskNodeStatus;
  checkpointStatus: GoalTaskCheckpointStatus;
  summary?: string;
  blockReason?: string;
  artifacts: string[];
  acceptance: string[];
  methodsUsed: string[];
  skillsUsed: string[];
  mcpServersUsed: string[];
  progressEvents: string[];
  references: string[];
};

export type GoalMethodCandidate = {
  id: string;
  goalId: string;
  nodeId: string;
  runId?: string;
  title: string;
  slug: string;
  status: "suggested";
  summary: string;
  rationale: string[];
  qualityScore: number;
  evidence: GoalMethodCandidateEvidence;
  draftContent: string;
  createdAt: string;
};

export type GoalMethodCandidateState = {
  version: 1;
  items: GoalMethodCandidate[];
};

export type GoalMethodCandidateGenerateResult = {
  goal: LongTermGoal;
  candidates: GoalMethodCandidate[];
  markdownPath: string;
  jsonPath: string;
  content: string;
};

export type GoalSkillCandidateEvidence = {
  nodeId: string;
  runId?: string;
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  planStatus: GoalCapabilityPlanStatus;
  objective: string;
  summary: string;
  gaps: string[];
  methodsUsed: string[];
  skillsUsed: string[];
  mcpServersUsed: string[];
  toolNamesUsed: string[];
  deviations: string[];
  references: string[];
};

export type GoalSkillCandidate = {
  id: string;
  goalId: string;
  nodeId: string;
  runId?: string;
  title: string;
  slug: string;
  status: "suggested";
  summary: string;
  rationale: string[];
  qualityScore: number;
  evidence: GoalSkillCandidateEvidence;
  draftContent: string;
  createdAt: string;
};

export type GoalSkillCandidateState = {
  version: 1;
  items: GoalSkillCandidate[];
};

export type GoalSkillCandidateGenerateResult = {
  goal: LongTermGoal;
  candidates: GoalSkillCandidate[];
  markdownPath: string;
  jsonPath: string;
  content: string;
};

export type GoalFlowPatternAction = "observe" | "promote_method" | "promote_skill" | "promote_both";

export type GoalFlowPatternNode = {
  nodeId: string;
  runId?: string;
  status: GoalTaskNodeStatus;
  checkpointStatus: GoalTaskCheckpointStatus;
  phase?: string;
};

export type GoalFlowPattern = {
  id: string;
  goalId: string;
  signature: string;
  summary: string;
  count: number;
  action: GoalFlowPatternAction;
  confidence: number;
  eventSequence: string[];
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  checkpointMode: GoalCheckpointPolicyMode;
  toolNames: string[];
  mcpServers: string[];
  methods: string[];
  skills: string[];
  gaps: string[];
  nodeRefs: GoalFlowPatternNode[];
  recommendations: string[];
};

export type GoalFlowPatternState = {
  version: 1;
  items: GoalFlowPattern[];
  generatedAt?: string;
};

export type GoalFlowPatternGenerateResult = {
  goal: LongTermGoal;
  patterns: GoalFlowPattern[];
  markdownPath: string;
  jsonPath: string;
  content: string;
};

export type GoalCrossFlowPatternRef = {
  goalId: string;
  goalTitle: string;
  patternId: string;
  count: number;
  confidence: number;
  nodeRefs: GoalFlowPatternNode[];
};

export type GoalCrossFlowPattern = {
  id: string;
  signature: string;
  summary: string;
  goalCount: number;
  occurrenceCount: number;
  recommendedAction: GoalFlowPatternAction;
  confidence: number;
  eventSequence: string[];
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  checkpointMode: GoalCheckpointPolicyMode;
  toolNames: string[];
  mcpServers: string[];
  methods: string[];
  skills: string[];
  gaps: string[];
  goalRefs: GoalCrossFlowPatternRef[];
  recommendations: string[];
};

export type GoalCrossFlowPatternState = {
  version: 1;
  items: GoalCrossFlowPattern[];
  generatedAt?: string;
  goalsScanned: number;
};

export type GoalCrossFlowPatternGenerateResult = {
  generatedAt: string;
  goalsScanned: number;
  patterns: GoalCrossFlowPattern[];
  markdownPath: string;
  jsonPath: string;
  content: string;
};

export type GoalSuggestionType = "method_candidate" | "skill_candidate" | "flow_pattern";

export type GoalSuggestionReviewStatus = "pending_review" | "accepted" | "rejected" | "deferred" | "needs_revision";

export type GoalSuggestionReviewWorkflowMode = "single" | "chain" | "quorum";

export type GoalSuggestionReviewWorkflowEscalationMode = "none" | "manual";

export type GoalSuggestionReviewWorkflowReviewer = {
  reviewer: string;
  reviewerRole?: string;
};

export type GoalSuggestionReviewWorkflowDecision = Exclude<GoalSuggestionReviewStatus, "pending_review">;

export type GoalSuggestionReviewWorkflowVote = {
  reviewer: string;
  reviewerRole?: string;
  decision: GoalSuggestionReviewWorkflowDecision;
  note?: string;
  decidedBy?: string;
  decidedAt: string;
};

export type GoalSuggestionReviewWorkflowEscalationEvent = {
  at: string;
  by?: string;
  to?: string;
  reason?: string;
};

export type GoalSuggestionReviewWorkflowEscalation = {
  mode: GoalSuggestionReviewWorkflowEscalationMode;
  count: number;
  defaultReviewer?: string;
  lastEscalatedAt?: string;
  escalatedTo?: string;
  escalatedBy?: string;
  overdueAt?: string;
  reason?: string;
  history: GoalSuggestionReviewWorkflowEscalationEvent[];
};

export type GoalSuggestionReviewWorkflowStageMode = "single" | "quorum";

export type GoalSuggestionReviewWorkflowStage = {
  id: string;
  title: string;
  mode: GoalSuggestionReviewWorkflowStageMode;
  reviewers: GoalSuggestionReviewWorkflowReviewer[];
  minApprovals: number;
  status: GoalSuggestionReviewStatus;
  votes: GoalSuggestionReviewWorkflowVote[];
  startedAt: string;
  decidedAt?: string;
  slaAt?: string;
  reminderMinutes?: number[];
  escalation: GoalSuggestionReviewWorkflowEscalation;
};

export type GoalSuggestionReviewWorkflow = {
  mode: GoalSuggestionReviewWorkflowMode;
  status: GoalSuggestionReviewStatus;
  currentStageIndex: number;
  stages: GoalSuggestionReviewWorkflowStage[];
  configuredAt: string;
  updatedAt: string;
};

export type GoalSuggestionReviewItem = {
  id: string;
  goalId: string;
  suggestionType: GoalSuggestionType;
  suggestionId: string;
  title: string;
  summary: string;
  sourcePath: string;
  nodeId?: string;
  runId?: string;
  status: GoalSuggestionReviewStatus;
  reviewer?: string;
  decidedBy?: string;
  note?: string;
  decidedAt?: string;
  evidenceRefs: string[];
  workflow?: GoalSuggestionReviewWorkflow;
  createdAt: string;
  updatedAt: string;
};

export type GoalSuggestionReviewState = {
  version: 1;
  items: GoalSuggestionReviewItem[];
  syncedAt?: string;
};

export type GoalSuggestionReviewDecisionInput = {
  reviewId?: string;
  suggestionType?: GoalSuggestionType;
  suggestionId?: string;
  decision: GoalSuggestionReviewWorkflowDecision;
  reviewer?: string;
  decidedBy?: string;
  note?: string;
};

export type GoalSuggestionReviewMutationResult = {
  goal: LongTermGoal;
  reviews: GoalSuggestionReviewState;
  review: GoalSuggestionReviewItem;
};

export type GoalSuggestionReviewWorkflowStageInput = {
  title?: string;
  reviewers: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  slaHours?: number;
  reminderMinutes?: number[];
};

export type GoalSuggestionReviewWorkflowConfigureInput = {
  reviewId?: string;
  suggestionType?: GoalSuggestionType;
  suggestionId?: string;
  templateId?: string;
  mode: GoalSuggestionReviewWorkflowMode;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: GoalSuggestionReviewWorkflowStageInput[];
  slaHours?: number;
  escalationMode?: GoalSuggestionReviewWorkflowEscalationMode;
  escalationReviewer?: string;
  note?: string;
};

export type GoalReviewerDirectoryEntry = {
  id: string;
  name: string;
  reviewerRole?: string;
  channels?: GoalReviewDeliveryChannel[];
  tags?: string[];
  active: boolean;
};

export type GoalReviewTemplate = {
  id: string;
  title: string;
  target: "suggestion_review" | "checkpoint" | "all";
  enabled: boolean;
  mode: GoalSuggestionReviewWorkflowMode;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: GoalSuggestionReviewWorkflowStageInput[];
  slaHours?: number;
  reminderMinutes?: number[];
  escalationMode?: GoalSuggestionReviewWorkflowEscalationMode;
  escalationReviewer?: string;
  suggestionTypes?: GoalSuggestionType[];
  riskLevels?: GoalCapabilityRiskLevel[];
  approvalModes?: GoalCheckpointPolicyMode[];
};

export type GoalReviewGovernanceConfig = {
  version: 1;
  reviewers: GoalReviewerDirectoryEntry[];
  templates: GoalReviewTemplate[];
  defaults: {
    suggestionTemplateId?: string;
    checkpointTemplateByRisk?: Partial<Record<GoalCapabilityRiskLevel, string>>;
    checkpointTemplateByApprovalMode?: Partial<Record<GoalCheckpointPolicyMode, string>>;
    reminderMinutes?: number[];
    notificationChannels?: GoalReviewDeliveryChannel[];
    notificationRoutes?: Partial<Record<GoalReviewDeliveryChannel, string>>;
  };
  updatedAt: string;
};

export type GoalReviewNotificationKind = "sla_reminder" | "sla_overdue" | "auto_escalated";

export type GoalReviewDeliveryChannel =
  | "goal_detail"
  | "goal_channel"
  | "reviewer_inbox"
  | "org_feed"
  | "im_dm"
  | "webhook";

export type GoalReviewNotification = {
  id: string;
  goalId: string;
  targetType: "suggestion_review" | "checkpoint";
  targetId: string;
  nodeId?: string;
  stageId?: string;
  recipient?: string;
  kind: GoalReviewNotificationKind;
  message: string;
  dedupeKey: string;
  createdAt: string;
};

export type GoalReviewNotificationState = {
  version: 1;
  items: GoalReviewNotification[];
};

export type GoalReviewNotificationDispatchStatus =
  | "pending"
  | "materialized"
  | "delivered"
  | "skipped"
  | "acked"
  | "failed";

export type GoalReviewNotificationDispatch = {
  id: string;
  notificationId: string;
  goalId: string;
  targetType: GoalReviewNotification["targetType"];
  targetId: string;
  nodeId?: string;
  stageId?: string;
  kind: GoalReviewNotificationKind;
  channel: GoalReviewDeliveryChannel;
  recipient?: string;
  routeKey?: string;
  message: string;
  dedupeKey: string;
  status: GoalReviewNotificationDispatchStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export type GoalReviewNotificationDispatchState = {
  version: 1;
  items: GoalReviewNotificationDispatch[];
};

export type GoalReviewNotificationDispatchCounts = {
  total: number;
  byChannel: Partial<Record<GoalReviewDeliveryChannel, number>>;
  byStatus: Partial<Record<GoalReviewNotificationDispatchStatus, number>>;
};

export type GoalSuggestionReviewWorkflowScanAction = "noop" | "overdue" | "auto_escalated";

export type GoalSuggestionReviewWorkflowScanInput = {
  now?: string;
  autoEscalate?: boolean;
};

export type GoalSuggestionReviewWorkflowScanItem = {
  goalId: string;
  reviewId: string;
  suggestionType: GoalSuggestionType;
  suggestionId: string;
  title: string;
  nodeId?: string;
  runId?: string;
  workflowMode: GoalSuggestionReviewWorkflowMode;
  stageId: string;
  stageTitle: string;
  stageIndex: number;
  status: GoalSuggestionReviewStatus;
  reviewer?: string;
  slaAt?: string;
  overdue: boolean;
  overdueMinutes?: number;
  escalated: boolean;
  action: GoalSuggestionReviewWorkflowScanAction;
  escalatedTo?: string;
  scannedAt: string;
};

export type GoalSuggestionReviewEscalateInput = {
  reviewId?: string;
  suggestionType?: GoalSuggestionType;
  suggestionId?: string;
  escalatedBy?: string;
  escalatedTo?: string;
  reason?: string;
  force?: boolean;
};

export type GoalSuggestionPublishAssetType = "method" | "skill";

export type GoalSuggestionPublishRecord = {
  id: string;
  goalId: string;
  reviewId: string;
  suggestionType: GoalSuggestionType;
  suggestionId: string;
  assetType: GoalSuggestionPublishAssetType;
  title: string;
  publishedPath: string;
  assetKey: string;
  experienceCandidateId?: string;
  reviewer?: string;
  decidedBy?: string;
  note?: string;
  nodeId?: string;
  runId?: string;
  sourcePath: string;
  publishedAt: string;
};

export type GoalSuggestionPublishState = {
  version: 1;
  items: GoalSuggestionPublishRecord[];
};

export type GoalSuggestionPublishInput = {
  reviewId?: string;
  suggestionType?: GoalSuggestionType;
  suggestionId?: string;
  reviewer?: string;
  decidedBy?: string;
  note?: string;
};

export type GoalSuggestionReviewStatusCounts = Record<GoalSuggestionReviewStatus, number>;

export type GoalSuggestionReviewTypeCounts = Record<GoalSuggestionType, number>;

export type GoalReviewGovernanceSummary = {
  goal: LongTermGoal;
  generatedAt: string;
  governanceConfig: GoalReviewGovernanceConfig;
  governanceConfigPath: string;
  reviews: GoalSuggestionReviewState;
  publishRecords: GoalSuggestionPublishState;
  notifications: GoalReviewNotificationState;
  notificationsPath: string;
  notificationDispatches: GoalReviewNotificationDispatchState;
  notificationDispatchesPath: string;
  notificationDispatchCounts: GoalReviewNotificationDispatchCounts;
  crossGoal: {
    goalsScanned: number;
    markdownPath: string;
    jsonPath: string;
    items: GoalCrossFlowPattern[];
  };
  reviewStatusCounts: GoalSuggestionReviewStatusCounts;
  reviewTypeCounts: GoalSuggestionReviewTypeCounts;
  workflowPendingCount: number;
  workflowOverdueCount: number;
  actionableReviews: GoalSuggestionReviewItem[];
  overdueReviews: GoalSuggestionReviewItem[];
  actionableCheckpoints: GoalCheckpointItem[];
  checkpointWorkflowPendingCount: number;
  checkpointWorkflowOverdueCount: number;
  commanderFocus?: {
    goalId: string;
    nodeId: string;
    runId?: string;
    planId: string;
    nodeTitle: string;
    governanceMode: GoalCapabilityGovernanceMode;
    executionMode: GoalCapabilityExecutionMode;
    commanderAgentId?: string;
    reviewStatus: string;
    finalApprovalMode?: GoalCapabilityPlanFinalApprovalMode;
    reworkRevisionCount: number;
    lastReworkReason?: string;
    lastReworkAt?: string;
    reworkContext?: {
      quickSummary?: string;
      historySummary?: string;
      persistedReason?: string;
    };
    fanInSummary?: string;
    managerActionHint?: string;
    reasons: string[];
    delegationResults: Array<{
      agentId: string;
      role?: string;
      status?: string;
      summary?: string;
      taskId?: string;
      outputPath?: string;
    }>;
    checkLines: string[];
    nextAction: string;
    reviewPath?: string;
    commanderPlanPath?: string;
    workOrderPaths: string[];
  };
  summary: string;
  recommendations: string[];
};

export type GoalApprovalWorkflowScanItem = {
  targetType: "suggestion_review" | "checkpoint";
  targetId: string;
  title: string;
  nodeId?: string;
  stageId: string;
  stageTitle: string;
  stageIndex: number;
  reviewer?: string;
  slaAt?: string;
  overdue: boolean;
  overdueMinutes?: number;
  escalated: boolean;
  action: GoalSuggestionReviewWorkflowScanAction;
};

export type GoalApprovalWorkflowScanResult = {
  goal: LongTermGoal;
  scannedAt: string;
  reviewResult: GoalSuggestionReviewWorkflowScanResult;
  checkpointItems: GoalApprovalWorkflowScanItem[];
  notifications: GoalReviewNotification[];
  dispatches: GoalReviewNotificationDispatch[];
  learningReview?: GoalReviewScanLearningReviewRunResult;
  summary: string;
  recommendations: string[];
};

export type GoalLearningReviewRefreshOutcome =
  | "generated"
  | "empty_input"
  | "actionable_reviews"
  | "weak_seed"
  | "unchanged_signal";

export type GoalLearningReviewRefreshState = {
  version: 1;
  lastScanAt?: string;
  lastScanFingerprint?: string;
  lastRefreshAt?: string;
  lastRefreshFingerprint?: string;
  lastGeneratedAt?: string;
  lastOutcome?: GoalLearningReviewRefreshOutcome;
  lastReason?: string;
  lastPriority?: "method" | "skill" | "flow";
};

export type GoalReviewScanLearningReviewRunResult = {
  goalId: string;
  outcome: GoalLearningReviewRefreshOutcome;
  refreshed: boolean;
  generated: boolean;
  generatedAt?: string;
  learningReviewInput: LearningReviewInput;
  reviews?: GoalSuggestionReviewState;
  suggestionCounts: {
    method: number;
    skill: number;
    flow: number;
  };
  priorityKind?: "method" | "skill" | "flow";
  summary: string;
  recommendations: string[];
};

export type GoalSuggestionReviewWorkflowScanResult = {
  goal: LongTermGoal;
  reviews: GoalSuggestionReviewState;
  scannedAt: string;
  scannedCount: number;
  overdueCount: number;
  escalatedCount: number;
  items: GoalSuggestionReviewWorkflowScanItem[];
  learningReview?: GoalReviewScanLearningReviewRunResult;
  summary: string;
  recommendations: string[];
};

export type GoalSuggestionPublishMutationResult = {
  goal: LongTermGoal;
  review: GoalSuggestionReviewItem;
  record: GoalSuggestionPublishRecord;
  records: GoalSuggestionPublishState;
};

export type GoalCheckpointEscalateInput = {
  checkpointId?: string;
  escalatedBy?: string;
  escalatedTo?: string;
  reason?: string;
  force?: boolean;
  runId?: string;
};

export type GoalExperienceSuggestSection<TItem> = {
  count: number;
  items: TItem[];
  markdownPath: string;
  jsonPath: string;
};

export type GoalExperienceSuggestResult = {
  goal: LongTermGoal;
  generatedAt: string;
  retrospective: GoalRetrospectiveSnapshot;
  methodCandidates: GoalExperienceSuggestSection<GoalMethodCandidate>;
  skillCandidates: GoalExperienceSuggestSection<GoalSkillCandidate>;
  flowPatterns: GoalExperienceSuggestSection<GoalFlowPattern>;
  summary: string;
  recommendations: string[];
};

export type GoalUpdateArea = "goal" | "tracking" | "progress" | "handoff" | "capability";

export type GoalUpdateReason =
  | "goal_resumed"
  | "goal_paused"
  | "task_node_created"
  | "task_node_updated"
  | "task_node_claimed"
  | "task_node_pending_review"
  | "task_node_validating"
  | "task_node_completed"
  | "task_node_blocked"
  | "task_node_failed"
  | "task_node_skipped"
  | "capability_plan_saved"
  | "capability_plan_orchestrated"
  | "checkpoint_requested"
  | "checkpoint_approved"
  | "checkpoint_rejected"
  | "checkpoint_expired"
  | "checkpoint_reopened"
  | "suggestion_review_updated"
  | "suggestion_review_workflow_configured"
  | "suggestion_review_escalated"
  | "suggestion_review_scanned"
  | "suggestion_published";

export type GoalUpdateEvent = {
  goal: LongTermGoal;
  reason: GoalUpdateReason;
  areas: GoalUpdateArea[];
  nodeId?: string;
  checkpointId?: string;
  runId?: string;
  at: string;
};
