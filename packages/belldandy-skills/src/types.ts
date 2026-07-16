import type { JsonObject } from "@belldandy/protocol";
import type { DelegationProtocol } from "./delegation-protocol.js";
import type { ToolContract, ToolContractChannel } from "./tool-contract.js";
export type { JsonObject };

/** 工具参数 schema（JSON Schema 子集，兼容 OpenAI function calling） */
export type ToolParameterSchema = {
  type: "object";
  properties: Record<string, {
    type: "string" | "number" | "boolean" | "array" | "object";
    description: string;
    enum?: string[];
    items?: { type: string };
  }>;
  required?: string[];
  oneOf?: Array<{ required: string[] }>;
};

export type ToolDiscoveryFamilyGateMode = "none" | "hidden-until-expanded";

export type ToolDiscoveryFamilyDefinition = {
  id: string;
  title: string;
  summary: string;
  gateMode?: ToolDiscoveryFamilyGateMode;
  order?: number;
  keywords?: string[];
};

/** 工具定义（用于发送给模型） */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  loadingMode?: "core" | "deferred";
  shortDescription?: string;
  keywords?: string[];
  tags?: string[];
  discoveryFamily?: ToolDiscoveryFamilyDefinition;
};

export type ToolCatalogEntry = {
  kind: "tool";
  name: string;
  description: string;
  shortDescription: string;
  keywords: string[];
  tags: string[];
  loadingMode: "core" | "deferred";
  loaded: boolean;
  discoveryFamilyId?: string;
};

export type ToolCatalogFamilyEntry = {
  kind: "family";
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  toolCount: number;
  loadedToolCount: number;
  loadingMode: "deferred";
  gateMode: ToolDiscoveryFamilyGateMode;
};

export type ToolDiscoveryEntry = ToolCatalogEntry | ToolCatalogFamilyEntry;

export type ToolDiscoveryEntriesOptions = {
  expandedFamilyIds?: string[];
};

/** 工具调用请求 */
export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: JsonObject;
};

/** 工具调用结果 */
export type ToolFailureKind =
  | "input_error"
  | "permission_or_policy"
  | "environment_error"
  | "business_logic_error"
  | "unknown";

export type ToolCallResult = {
  id: string;
  name: string;
  success: boolean;
  output: string;
  error?: string;
  failureKind?: ToolFailureKind;
  durationMs: number;
  metadata?: JsonObject;
};

export type RecentToolResultRecord = {
  toolCallId: string;
  toolName: string;
  success: boolean;
  summary: string;
  content?: string;
  contentPreview?: string;
  contentChars?: number;
  contentTruncated?: boolean;
  error?: string;
  errorPreview?: string;
  errorChars?: number;
  errorTruncated?: boolean;
  failureKind?: ToolFailureKind;
  target?: string;
  args?: JsonObject;
  createdAt: number;
  isSynthetic?: boolean;
};

/** 运行命令策略 */
export type ToolExecPolicy = {
  /** 快速命令超时（毫秒） */
  quickTimeoutMs?: number;
  /** 构建/长任务超时（毫秒） */
  longTimeoutMs?: number;
  /** 额外标记为快速命令的可执行名 */
  quickCommands?: string[];
  /** 额外标记为长任务的可执行名 */
  longCommands?: string[];
  /** 额外允许的命令（加入 safelist） */
  extraSafelist?: string[];
  /** 额外禁止的命令（加入 blocklist） */
  extraBlocklist?: string[];
  /** 非交互参数策略 */
  nonInteractive?: {
    enabled?: boolean;
    /** 额外识别的非交互标记 */
    additionalFlags?: string[];
    /** 默认追加到所有命令的标记（谨慎使用） */
    defaultFlags?: string[];
    /** 特定命令的追加规则：key 支持 "cmd" 或 "cmd sub" */
    rules?: Record<string, string[] | string>;
  };
};

/** 文件写入策略 */
export type ToolFileWritePolicy = {
  /** 允许写入的扩展名（为空表示不限制） */
  allowedExtensions?: string[];
  /** 是否允许点文件（如 .gitignore） */
  allowDotFiles?: boolean;
  /** 是否允许 base64 写入（二进制） */
  allowBinary?: boolean;
};

/** 权限策略 */
export type ToolPolicy = {
  /** 文件读取允许路径（空 = 不限制，仅检查工作区边界） */
  allowedPaths: string[];
  /** 文件操作禁止路径 */
  deniedPaths: string[];
  /** 网络访问允许域名（空 = 允许所有公网域名） */
  allowedDomains: string[];
  /** 网络访问禁止域名 */
  deniedDomains: string[];
  /** 最大超时（毫秒） */
  maxTimeoutMs: number;
  /** 最大响应大小（字节） */
  maxResponseBytes: number;
  /** 命令执行策略（可选） */
  exec?: ToolExecPolicy;
  /** 文件写入策略（可选） */
  fileWrite?: ToolFileWritePolicy;
};

export type SubAgentResult = {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  taskId?: string;
  outputPath?: string;
};

export type SessionInfo = {
  id: string;
  taskId?: string;
  parentId?: string;
  agentId?: string;
  status: "pending" | "running" | "done" | "error" | "timeout" | "stopped";
  createdAt: number;
  finishedAt?: number;
  summary?: string;
  progressText?: string;
  outputPath?: string;
  scratchPath?: string;
  reviewPath?: string;
  lessonPath?: string;
  notificationCount?: number;
};

export type BridgeSubtaskKind = "analyze" | "review" | "patch";

export type BridgeSubtaskSemantics = {
  kind: BridgeSubtaskKind;
  targetId?: string;
  action?: string;
  goalId?: string;
  goalNodeId?: string;
  summary?: string;
};

export type BridgeSessionLaunchSemantics = {
  targetId: string;
  action: string;
  transport: "pty";
  cwd: string;
  commandPreview: string;
  firstTurnStrategy?: "start-args-prompt" | "write";
  firstTurnHint?: string;
  recommendedReadWaitMs?: number;
  bridgeSubtask?: BridgeSubtaskSemantics;
  summary?: string;
};

export type BridgeSessionGovernanceCapabilities = {
  ensureSessionTask(input: {
    conversationId: string;
    agentId?: string;
    launchSpec?: ToolRuntimeLaunchSpec;
    taskId?: string;
    session: BridgeSessionLaunchSemantics;
  }): Promise<{ taskId: string } | undefined>;
  attachSession(input: {
    taskId: string;
    sessionId: string;
    agentId?: string;
  }): Promise<void>;
  recordOutput(input: {
    sessionId: string;
    output: string;
  }): Promise<void>;
  completeSession(input: {
    taskId?: string;
    sessionId?: string;
    status: "done" | "error" | "timeout" | "stopped";
    output?: string;
    error?: string;
    closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
    artifactPath?: string;
    transcriptPath?: string;
  }): Promise<void>;
};

export type SpawnSubAgentOptions = {
  instruction: string;
  agentId?: string;
  profileId?: string;
  background?: boolean;
  timeoutMs?: number;
  channel?: string;
  context?: JsonObject;
  cwd?: string;
  toolSet?: string[];
  permissionMode?: string;
  isolationMode?: string;
  parentTaskId?: string;
  parentConversationId?: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  policySummary?: string;
  delegationProtocol?: DelegationProtocol;
  bridgeSubtask?: BridgeSubtaskSemantics;
};

export type ToolRuntimeLaunchSpec = {
  agentId?: string;
  profileId?: string;
  instruction?: string;
  channel?: string;
  background?: boolean;
  timeoutMs?: number;
  cwd?: string;
  toolSet?: string[];
  permissionMode?: string;
  isolationMode?: string;
  parentTaskId?: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: "low" | "medium" | "high" | "critical";
  policySummary?: string;
  delegationProtocol?: DelegationProtocol;
  bridgeSubtask?: BridgeSubtaskSemantics;
};

export type ToolExecutionRuntimeContext = {
  launchSpec?: ToolRuntimeLaunchSpec;
  channel?: ToolContractChannel;
  bridgeGovernanceTaskId?: string;
  agentWhitelistMode?: "default" | "governed_bridge_internal";
  /** 执行链协作式中断信号 */
  abortSignal?: AbortSignal;
};

export type MCPRuntimeToolCallRequest = {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type MCPRuntimeToolInfoSnapshot = {
  serverId: string;
  toolName: string;
  bridgedName: string;
};

export type MCPRuntimeServerDiagnosticsSnapshot = {
  id: string;
  name: string;
  status: string;
  error?: string;
  toolCount: number;
  resourceCount: number;
};

export type MCPRuntimeDiagnosticsSnapshot = {
  initialized: boolean;
  toolCount: number;
  serverCount: number;
  connectedCount: number;
  servers: MCPRuntimeServerDiagnosticsSnapshot[];
  tools: MCPRuntimeToolInfoSnapshot[];
};

export type MCPRuntimeCapabilities = {
  callTool(request: MCPRuntimeToolCallRequest): Promise<unknown>;
  getDiagnostics?(): MCPRuntimeDiagnosticsSnapshot | null;
};

/** 动态工作流运行时能力接口（由 @belldandy/core 的 WorkflowRuntime 实现） */
export type WorkflowRunOptionsLike = {
  source:
    | { kind: "file"; path: string }
    | { kind: "builtin"; name: string }
    | { kind: "inline"; code: string; name?: string };
  args?: Record<string, unknown>;
  budget?: {
    maxTokens?: number;
    maxAgentCalls?: number;
    maxRetries?: number;
    maxWallClockMs?: number;
    maxConcurrent?: number;
    onExceeded?: "abort" | "warn";
  };
  maxConcurrent?: number;
  parentConversationId: string;
  channel: string;
  resumeJournalId?: string;
  stateDir?: string;
};

export type WorkflowRunResultLike = {
  success: boolean;
  output: string;
  journalId: string;
  scriptHash: string;
  workflowName: string;
  workflowVersion: string;
  stats: {
    agentCalls: number;
    cacheHits: number;
    totalTokens: number;
    durationMs: number;
  };
  error?: string;
};

export type WorkflowRuntimeCapabilities = {
  run(opts: WorkflowRunOptionsLike): Promise<WorkflowRunResultLike>;
  stop(journalId: string, reason?: string): Promise<boolean>;
  getStatus?(journalId: string): unknown | null;
  listActiveRuns?(): Array<{ journalId: string; status: string; workflowName: string; startedAt: number }>;
};

export type ConversationPlanStatus =
  | "draft"
  | "active"
  | "blocked"
  | "completed"
  | "cancelled";

export type ConversationPlanStepStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "completed"
  | "skipped";

export type ConversationPlanMode = "agent" | "manual";

export type ConversationPlanUpdatedBy = "agent" | "user" | "system";

export type ConversationPlanRef =
  | { kind: "goal"; goalId: string; nodeId?: string; label?: string }
  | { kind: "workflow"; journalId: string; workflowName?: string; label?: string }
  | { kind: "subtask"; taskId: string; sessionId?: string; label?: string };

export type ConversationPlanStep = {
  id: string;
  title: string;
  summary?: string;
  status: ConversationPlanStepStatus;
  blocker?: string;
  refs?: ConversationPlanRef[];
  updatedAt: number;
};

export type ConversationPlanState = {
  version: 1;
  planId: string;
  revision: number;
  status: ConversationPlanStatus;
  title: string;
  summary?: string;
  mode: ConversationPlanMode;
  createdAt: number;
  updatedAt: number;
  updatedBy: ConversationPlanUpdatedBy;
  currentStepId?: string;
  nextAction?: string;
  blocker?: string;
  steps: ConversationPlanStep[];
};

export type ConversationPlanSeed = {
  title: string;
  summary?: string;
  mode?: ConversationPlanMode;
  status?: Extract<ConversationPlanStatus, "draft" | "active">;
};

export type ConversationPlanPatchOperation =
  | {
    type: "replace";
    plan: Omit<ConversationPlanState, "revision" | "createdAt" | "updatedAt" | "updatedBy">;
  }
  | {
    type: "set_header";
    title?: string;
    summary?: string;
  }
  | {
    type: "set_status";
    status: ConversationPlanStatus;
    blocker?: string;
  }
  | {
    type: "set_focus";
    currentStepId?: string;
    nextAction?: string;
    blocker?: string;
  }
  | {
    type: "upsert_step";
    step: Omit<ConversationPlanStep, "updatedAt">;
  }
  | {
    type: "set_step_status";
    stepId: string;
    status: ConversationPlanStepStatus;
    blocker?: string;
  }
  | {
    type: "attach_ref";
    stepId: string;
    ref: ConversationPlanRef;
  }
  | {
    type: "clear";
  };

export type ConversationPlanUpdateInput = {
  baseRevision?: number;
  ifAbsent?: "create" | "reject";
  seed?: ConversationPlanSeed;
  operations: ConversationPlanPatchOperation[];
  updatedBy?: ConversationPlanUpdatedBy;
};

export type ConversationPlanUpdateReasonCode =
  | "ok"
  | "conflict"
  | "missing_plan"
  | "missing_seed"
  | "invalid_patch";

export type ConversationPlanUpdateResult = {
  applied: boolean;
  conflict: boolean;
  planState: ConversationPlanState | null;
  cleared?: boolean;
  reasonCode?: ConversationPlanUpdateReasonCode;
  message?: string;
};

export type AgentCapabilities = {
  spawnSubAgent?: (opts: SpawnSubAgentOptions) => Promise<SubAgentResult>;
  spawnParallel?: (tasks: SpawnSubAgentOptions[]) => Promise<SubAgentResult[]>;
  listSessions?: (parentConversationId?: string) => Promise<SessionInfo[]>;
};

export type GoalRecord = {
  id: string;
  slug: string;
  title: string;
  status: string;
  goalRoot: string;
  runtimeRoot: string;
  docRoot: string;
  northstarPath: string;
  tasksPath: string;
  progressPath: string;
  handoffPath?: string;
  registryPath: string;
  pathSource: string;
  objective?: string;
  currentPhase?: string;
  activeConversationId?: string;
  activeNodeId?: string;
  lastNodeId?: string;
  lastRunId?: string;
  lastActiveAt?: string;
  pausedAt?: string;
  createdAt: string;
  updatedAt: string;
};

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

export type GoalCheckpointPolicyModeRecord = "none" | "single" | "strict";

export type GoalCheckpointPolicyFieldRecord =
  | "reviewer"
  | "reviewerRole"
  | "requestedBy"
  | "slaAt"
  | "summary"
  | "note"
  | "decidedBy";

export type GoalCheckpointPolicyRecord = {
  riskLevel?: GoalCapabilityRiskLevel;
  approvalMode: GoalCheckpointPolicyModeRecord;
  requiredRequestFields: GoalCheckpointPolicyFieldRecord[];
  requiredDecisionFields: GoalCheckpointPolicyFieldRecord[];
  templateId?: string;
  workflowMode?: GoalSuggestionReviewWorkflowModeRecord;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: Array<{
    title?: string;
    reviewers: string[];
    reviewerRoles?: string[];
    minApprovals?: number;
    slaHours?: number;
    reminderMinutes?: number[];
  }>;
  suggestedReviewer?: string;
  suggestedReviewerRole?: string;
  suggestedSlaHours?: number;
  reminderMinutes?: number[];
  escalationMode?: "none" | "manual";
  escalationReviewer?: string;
  rationale?: string[];
};

export type GoalTaskNodeRecord = {
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

export type GoalTaskEdgeRecord = {
  id: string;
  from: string;
  to: string;
  kind: "depends_on";
};

export type GoalTaskGraphRecord = {
  version: 2;
  goalId?: string;
  updatedAt: string;
  nodes: GoalTaskNodeRecord[];
  edges: GoalTaskEdgeRecord[];
};

export type GoalCheckpointRecord = {
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
  policy?: GoalCheckpointPolicyRecord;
  workflow?: GoalSuggestionReviewWorkflowRecord;
  history: GoalCheckpointHistoryRecord[];
};

export type GoalCheckpointHistoryRecord = {
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

export type GoalCheckpointStateRecord = {
  version: 2;
  items: GoalCheckpointRecord[];
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

export type GoalCapabilityPlanMethodRecord = {
  file: string;
  title?: string;
  score?: number;
  reason?: string;
};

export type GoalCapabilityPlanSkillRecord = {
  name: string;
  description?: string;
  priority?: string;
  source?: string;
  score?: number;
  reason?: string;
};

export type GoalCapabilityPlanMcpServerRecord = {
  serverId: string;
  status: "connected" | "disconnected" | "unknown";
  toolCount?: number;
  resourceCount?: number;
  reason?: string;
};

export type GoalCapabilityPlanSubAgentRecord = {
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

export type GoalCapabilityPlanRolePolicyRecord = {
  selectedRoles: Array<"default" | "coder" | "researcher" | "verifier">;
  selectionReasons: string[];
  verifierRole?: "verifier";
  fanInStrategy: "main_agent_summary" | "verifier_handoff" | "commander_review";
};

export type GoalCapabilityPlanCoordinationPlanRecord = {
  summary: string;
  plannedDelegationCount: number;
  managerAgentId?: string;
  rolePolicy: GoalCapabilityPlanRolePolicyRecord;
};

export type GoalCapabilityPlanDelegationResultRecord = {
  agentId: string;
  role?: "default" | "coder" | "researcher" | "verifier";
  status: "success" | "failed" | "skipped";
  summary: string;
  error?: string;
  sessionId?: string;
  taskId?: string;
  outputPath?: string;
};

export type GoalCapabilityPlanVerifierHandoffRecord = {
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

export type GoalCapabilityPlanVerifierFindingRecord = {
  severity: "low" | "medium" | "high";
  summary: string;
};

export type GoalCapabilityPlanVerifierResultRecord = {
  status: "pending" | "completed" | "failed";
  summary: string;
  findings: GoalCapabilityPlanVerifierFindingRecord[];
  recommendation: "approve" | "revise" | "blocked" | "unknown";
  evidenceTaskIds?: string[];
  outputPath?: string;
  generatedAt: string;
};

export type GoalCapabilityPlanAcceptanceGateCheckRecord = {
  id: string;
  label: string;
  status: "passed" | "failed";
  enforced: boolean;
  evidence?: string;
};

export type GoalCapabilityPlanAcceptanceGateRecord = {
  status: "pending" | "accepted" | "rejected";
  summary: string;
  reasons: string[];
  requiredSourceAgentIds?: string[];
  missingSourceAgentIds?: string[];
  requiredSourceTaskIds?: string[];
  missingSourceTaskIds?: string[];
  requiredEvidenceTaskIds?: string[];
  missingEvidenceTaskIds?: string[];
  contractSpecificChecks?: GoalCapabilityPlanAcceptanceGateCheckRecord[];
  rejectionConfidence?: "low" | "medium" | "high";
  managerActionHint?: string;
};

export type GoalCapabilityPlanFinalApprovalModeRecord = "user_required" | "agent_auto_complete";

export type GoalCapabilityPlanOrchestrationRecord = {
  claimed?: boolean;
  delegated?: boolean;
  delegationCount?: number;
  finalApprovalMode?: GoalCapabilityPlanFinalApprovalModeRecord;
  reworkRevisionCount?: number;
  lastReworkReason?: string;
  lastReworkAt?: string;
  reworkTargetAgentIds?: string[];
  reworkContext?: {
    quickSummary?: string;
    historySummary?: string;
    persistedReason?: string;
  };
  coordinationPlan?: GoalCapabilityPlanCoordinationPlanRecord;
  delegationResults?: GoalCapabilityPlanDelegationResultRecord[];
  verifierHandoff?: GoalCapabilityPlanVerifierHandoffRecord;
  verifierResult?: GoalCapabilityPlanVerifierResultRecord;
  acceptanceGate?: GoalCapabilityPlanAcceptanceGateRecord;
  notes?: string[];
};

export type GoalCapabilityPlanCheckpointPolicyRecord = {
  required: boolean;
  reasons: string[];
  approvalMode: GoalCheckpointPolicyModeRecord;
  requiredRequestFields: GoalCheckpointPolicyFieldRecord[];
  requiredDecisionFields: GoalCheckpointPolicyFieldRecord[];
  templateId?: string;
  workflowMode?: GoalSuggestionReviewWorkflowModeRecord;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: Array<{
    title?: string;
    reviewers: string[];
    reviewerRoles?: string[];
    minApprovals?: number;
    slaHours?: number;
    reminderMinutes?: number[];
  }>;
  suggestedTitle?: string;
  suggestedNote?: string;
  suggestedReviewer?: string;
  suggestedReviewerRole?: string;
  suggestedSlaHours?: number;
  reminderMinutes?: number[];
  escalationMode?: "none" | "manual";
  escalationReviewer?: string;
};

export type GoalCapabilityPlanActualUsageRecord = {
  methods: string[];
  skills: string[];
  mcpServers: string[];
  toolNames: string[];
  updatedAt?: string;
};

export type GoalCapabilityPlanAnalysisStatusRecord = "pending" | "aligned" | "partial" | "diverged";

export type GoalCapabilityPlanDeviationKindRecord =
  | "planned_but_unused"
  | "unplanned_but_used"
  | "delegation_gap"
  | "usage_untracked";

export type GoalCapabilityPlanDeviationAreaRecord = "method" | "skill" | "mcp" | "sub_agent" | "tooling";

export type GoalCapabilityPlanDeviationRecord = {
  kind: GoalCapabilityPlanDeviationKindRecord;
  area: GoalCapabilityPlanDeviationAreaRecord;
  severity: "low" | "medium" | "high";
  summary: string;
  planned?: string[];
  actual?: string[];
};

export type GoalCapabilityPlanAnalysisRecord = {
  status: GoalCapabilityPlanAnalysisStatusRecord;
  summary: string;
  deviations: GoalCapabilityPlanDeviationRecord[];
  recommendations: string[];
  updatedAt?: string;
};

export type GoalCapabilityPlanRecord = {
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
  methods: GoalCapabilityPlanMethodRecord[];
  skills: GoalCapabilityPlanSkillRecord[];
  mcpServers: GoalCapabilityPlanMcpServerRecord[];
  subAgents: GoalCapabilityPlanSubAgentRecord[];
  gaps: string[];
  checkpoint: GoalCapabilityPlanCheckpointPolicyRecord;
  actualUsage: GoalCapabilityPlanActualUsageRecord;
  analysis: GoalCapabilityPlanAnalysisRecord;
  generatedAt: string;
  updatedAt: string;
  orchestratedAt?: string;
  orchestration?: GoalCapabilityPlanOrchestrationRecord;
};

export type GoalCapabilityPlanStateRecord = {
  version: 1;
  items: GoalCapabilityPlanRecord[];
};

export type GoalHandoffResumeModeRecord =
  | "goal_channel"
  | "current_node"
  | "last_node"
  | "checkpoint"
  | "blocked";

export type GoalHandoffCheckpointSummaryRecord = {
  id: string;
  status: GoalCheckpointItemStatus;
  title: string;
  nodeId?: string;
  summary?: string;
  reviewer?: string;
  reviewerRole?: string;
  updatedAt: string;
};

export type GoalHandoffBlockerRecord = {
  kind: "node" | "checkpoint" | "bridge";
  id: string;
  title: string;
  status: string;
  nodeId?: string;
  reason?: string;
};

export type GoalHandoffBridgeItemRecord = {
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

export type GoalHandoffBridgeSummaryRecord = {
  bridgeNodeCount: number;
  activeCount: number;
  runtimeLostCount: number;
  orphanedCount: number;
  closedCount: number;
  blockedCount: number;
  artifactCount: number;
  transcriptCount: number;
  items: GoalHandoffBridgeItemRecord[];
};

export type GoalCheckpointReplayDescriptorRecord = {
  checkpointId: string;
  nodeId: string;
  runId?: string;
  title: string;
  summary?: string;
  reason: string;
};

export type GoalHandoffTimelineEntryRecord = {
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

export type GoalHandoffCapabilityFocusRecord = {
  planId: string;
  nodeId: string;
  status: GoalCapabilityPlanStatus;
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  alignment: GoalCapabilityPlanAnalysisStatusRecord;
  summary: string;
};

export type GoalHandoffTrackingRecord = {
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

export type GoalHandoffRecord = {
  version: 1;
  goalId: string;
  generatedAt: string;
  goalStatus: string;
  currentPhase?: string;
  activeConversationId?: string;
  activeNodeId?: string;
  lastNodeId?: string;
  lastRunId?: string;
  resumeMode: GoalHandoffResumeModeRecord;
  recommendedNodeId?: string;
  summary: string;
  nextAction: string;
  tracking: GoalHandoffTrackingRecord;
  openCheckpoints: GoalHandoffCheckpointSummaryRecord[];
  checkpointReplay?: GoalCheckpointReplayDescriptorRecord;
  blockers: GoalHandoffBlockerRecord[];
  bridgeGovernance?: GoalHandoffBridgeSummaryRecord;
  focusCapability?: GoalHandoffCapabilityFocusRecord;
  recentProgress: GoalHandoffTimelineEntryRecord[];
};

export type GoalRetrospectiveOutcomeRecord = "completed" | "in_progress" | "blocked" | "paused" | "archived";

export type GoalRetrospectiveCheckpointSummaryRecord = {
  total: number;
  waitingUserCount: number;
  approvedCount: number;
  rejectedCount: number;
  expiredCount: number;
};

export type GoalRetrospectiveCapabilitySummaryRecord = {
  totalPlans: number;
  orchestratedPlans: number;
  highRiskPlans: number;
  divergedPlans: number;
  uniqueMethods: string[];
  uniqueSkills: string[];
  uniqueMcpServers: string[];
  topGaps: string[];
};

export type GoalRetrospectiveNodeSummaryRecord = {
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

export type GoalRetrospectiveRecord = {
  version: 1;
  goalId: string;
  generatedAt: string;
  goalStatus: string;
  currentPhase?: string;
  objective?: string;
  outcome: GoalRetrospectiveOutcomeRecord;
  summary: string;
  nextFocus: string;
  handoffSummary: string;
  taskSummary: GoalHandoffTrackingRecord;
  checkpointSummary: GoalRetrospectiveCheckpointSummaryRecord;
  capabilitySummary: GoalRetrospectiveCapabilitySummaryRecord;
  achievements: string[];
  blockers: string[];
  recommendations: string[];
  highlightedNodes: GoalRetrospectiveNodeSummaryRecord[];
  recentProgress: GoalHandoffTimelineEntryRecord[];
  markdownPath: string;
  jsonPath: string;
};

export type GoalMethodCandidateEvidenceRecord = {
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

export type GoalMethodCandidateRecord = {
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
  evidence: GoalMethodCandidateEvidenceRecord;
  draftContent: string;
  createdAt: string;
};

export type GoalSkillCandidateEvidenceRecord = {
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

export type GoalSkillCandidateRecord = {
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
  evidence: GoalSkillCandidateEvidenceRecord;
  draftContent: string;
  createdAt: string;
};

export type GoalFlowPatternActionRecord = "observe" | "promote_method" | "promote_skill" | "promote_both";

export type GoalFlowPatternNodeRecord = {
  nodeId: string;
  runId?: string;
  status: GoalTaskNodeStatus;
  checkpointStatus: GoalTaskCheckpointStatus;
  phase?: string;
};

export type GoalFlowPatternRecord = {
  id: string;
  goalId: string;
  signature: string;
  summary: string;
  count: number;
  action: GoalFlowPatternActionRecord;
  confidence: number;
  eventSequence: string[];
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  checkpointMode: GoalCheckpointPolicyModeRecord;
  toolNames: string[];
  mcpServers: string[];
  methods: string[];
  skills: string[];
  gaps: string[];
  nodeRefs: GoalFlowPatternNodeRecord[];
  recommendations: string[];
};

export type GoalCrossFlowPatternRefRecord = {
  goalId: string;
  goalTitle: string;
  patternId: string;
  count: number;
  confidence: number;
  nodeRefs: GoalFlowPatternNodeRecord[];
};

export type GoalCrossFlowPatternRecord = {
  id: string;
  signature: string;
  summary: string;
  goalCount: number;
  occurrenceCount: number;
  recommendedAction: GoalFlowPatternActionRecord;
  confidence: number;
  eventSequence: string[];
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  checkpointMode: GoalCheckpointPolicyModeRecord;
  toolNames: string[];
  mcpServers: string[];
  methods: string[];
  skills: string[];
  gaps: string[];
  goalRefs: GoalCrossFlowPatternRefRecord[];
  recommendations: string[];
};

export type GoalExperienceSuggestSectionRecord<TItem> = {
  count: number;
  items: TItem[];
  markdownPath: string;
  jsonPath: string;
};

export type GoalExperienceSuggestRecord = {
  goal: GoalRecord;
  generatedAt: string;
  retrospective: GoalRetrospectiveRecord;
  methodCandidates: GoalExperienceSuggestSectionRecord<GoalMethodCandidateRecord>;
  skillCandidates: GoalExperienceSuggestSectionRecord<GoalSkillCandidateRecord>;
  flowPatterns: GoalExperienceSuggestSectionRecord<GoalFlowPatternRecord>;
  summary: string;
  recommendations: string[];
};

export type GoalSuggestionTypeRecord = "method_candidate" | "skill_candidate" | "flow_pattern";

export type GoalSuggestionReviewStatusRecord = "pending_review" | "accepted" | "rejected" | "deferred" | "needs_revision";

export type GoalSuggestionReviewWorkflowModeRecord = "single" | "chain" | "quorum";

export type GoalSuggestionReviewWorkflowEscalationModeRecord = "none" | "manual";

export type GoalSuggestionReviewWorkflowReviewerRecord = {
  reviewer: string;
  reviewerRole?: string;
};

export type GoalSuggestionReviewWorkflowDecisionRecord = Exclude<GoalSuggestionReviewStatusRecord, "pending_review">;

export type GoalSuggestionReviewWorkflowVoteRecord = {
  reviewer: string;
  reviewerRole?: string;
  decision: GoalSuggestionReviewWorkflowDecisionRecord;
  note?: string;
  decidedBy?: string;
  decidedAt: string;
};

export type GoalSuggestionReviewWorkflowEscalationEventRecord = {
  at: string;
  by?: string;
  to?: string;
  reason?: string;
};

export type GoalSuggestionReviewWorkflowEscalationRecord = {
  mode: GoalSuggestionReviewWorkflowEscalationModeRecord;
  count: number;
  defaultReviewer?: string;
  lastEscalatedAt?: string;
  escalatedTo?: string;
  escalatedBy?: string;
  overdueAt?: string;
  reason?: string;
  history: GoalSuggestionReviewWorkflowEscalationEventRecord[];
};

export type GoalSuggestionReviewWorkflowStageModeRecord = "single" | "quorum";

export type GoalSuggestionReviewWorkflowStageRecord = {
  id: string;
  title: string;
  mode: GoalSuggestionReviewWorkflowStageModeRecord;
  reviewers: GoalSuggestionReviewWorkflowReviewerRecord[];
  minApprovals: number;
  status: GoalSuggestionReviewStatusRecord;
  votes: GoalSuggestionReviewWorkflowVoteRecord[];
  startedAt: string;
  decidedAt?: string;
  slaAt?: string;
  reminderMinutes?: number[];
  escalation: GoalSuggestionReviewWorkflowEscalationRecord;
};

export type GoalSuggestionReviewWorkflowRecord = {
  mode: GoalSuggestionReviewWorkflowModeRecord;
  status: GoalSuggestionReviewStatusRecord;
  currentStageIndex: number;
  stages: GoalSuggestionReviewWorkflowStageRecord[];
  configuredAt: string;
  updatedAt: string;
};

export type GoalSuggestionReviewItemRecord = {
  id: string;
  goalId: string;
  suggestionType: GoalSuggestionTypeRecord;
  suggestionId: string;
  title: string;
  summary: string;
  sourcePath: string;
  nodeId?: string;
  runId?: string;
  status: GoalSuggestionReviewStatusRecord;
  reviewer?: string;
  decidedBy?: string;
  note?: string;
  decidedAt?: string;
  evidenceRefs: string[];
  workflow?: GoalSuggestionReviewWorkflowRecord;
  createdAt: string;
  updatedAt: string;
};

export type GoalSuggestionReviewStateRecord = {
  version: 1;
  items: GoalSuggestionReviewItemRecord[];
  syncedAt?: string;
};

export type GoalSuggestionReviewWorkflowScanActionRecord = "noop" | "overdue" | "auto_escalated";

export type GoalSuggestionReviewWorkflowScanItemRecord = {
  goalId: string;
  reviewId: string;
  suggestionType: GoalSuggestionTypeRecord;
  suggestionId: string;
  title: string;
  nodeId?: string;
  runId?: string;
  workflowMode: GoalSuggestionReviewWorkflowModeRecord;
  stageId: string;
  stageTitle: string;
  stageIndex: number;
  status: GoalSuggestionReviewStatusRecord;
  reviewer?: string;
  slaAt?: string;
  overdue: boolean;
  overdueMinutes?: number;
  escalated: boolean;
  action: GoalSuggestionReviewWorkflowScanActionRecord;
  escalatedTo?: string;
  scannedAt: string;
};

export type GoalSuggestionReviewWorkflowScanResultRecord = {
  goal: GoalRecord;
  reviews: GoalSuggestionReviewStateRecord;
  scannedAt: string;
  scannedCount: number;
  overdueCount: number;
  escalatedCount: number;
  items: GoalSuggestionReviewWorkflowScanItemRecord[];
  summary: string;
  recommendations: string[];
};

export type GoalSuggestionPublishAssetTypeRecord = "method" | "skill";

export type GoalSuggestionPublishRecord = {
  id: string;
  goalId: string;
  reviewId: string;
  suggestionType: GoalSuggestionTypeRecord;
  suggestionId: string;
  assetType: GoalSuggestionPublishAssetTypeRecord;
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

export type GoalSuggestionPublishStateRecord = {
  version: 1;
  items: GoalSuggestionPublishRecord[];
};

export type GoalSuggestionReviewStatusCountsRecord = {
  pending_review: number;
  accepted: number;
  rejected: number;
  deferred: number;
  needs_revision: number;
};

export type GoalSuggestionReviewTypeCountsRecord = {
  method_candidate: number;
  skill_candidate: number;
  flow_pattern: number;
};

export type GoalReviewerDirectoryEntryRecord = {
  id: string;
  name: string;
  reviewerRole?: string;
  channels?: GoalReviewDeliveryChannelRecord[];
  tags?: string[];
  active: boolean;
};

export type GoalReviewTemplateRecord = {
  id: string;
  title: string;
  target: "suggestion_review" | "checkpoint" | "all";
  enabled: boolean;
  mode: GoalSuggestionReviewWorkflowModeRecord;
  reviewers?: string[];
  reviewerRoles?: string[];
  minApprovals?: number;
  stages?: Array<{
    title?: string;
    reviewers: string[];
    reviewerRoles?: string[];
    minApprovals?: number;
    slaHours?: number;
    reminderMinutes?: number[];
  }>;
  slaHours?: number;
  reminderMinutes?: number[];
  escalationMode?: GoalSuggestionReviewWorkflowEscalationModeRecord;
  escalationReviewer?: string;
  suggestionTypes?: GoalSuggestionTypeRecord[];
  riskLevels?: GoalCapabilityRiskLevel[];
  approvalModes?: GoalCheckpointPolicyModeRecord[];
};

export type GoalReviewGovernanceConfigRecord = {
  version: 1;
  reviewers: GoalReviewerDirectoryEntryRecord[];
  templates: GoalReviewTemplateRecord[];
  defaults: {
    suggestionTemplateId?: string;
    checkpointTemplateByRisk?: Partial<Record<GoalCapabilityRiskLevel, string>>;
    checkpointTemplateByApprovalMode?: Partial<Record<GoalCheckpointPolicyModeRecord, string>>;
    reminderMinutes?: number[];
    notificationChannels?: GoalReviewDeliveryChannelRecord[];
    notificationRoutes?: Partial<Record<GoalReviewDeliveryChannelRecord, string>>;
  };
  updatedAt: string;
};

export type GoalReviewNotificationKindRecord = "sla_reminder" | "sla_overdue" | "auto_escalated";

export type GoalReviewDeliveryChannelRecord =
  | "goal_detail"
  | "goal_channel"
  | "reviewer_inbox"
  | "org_feed"
  | "im_dm"
  | "webhook";

export type GoalReviewNotificationRecord = {
  id: string;
  goalId: string;
  targetType: "suggestion_review" | "checkpoint";
  targetId: string;
  nodeId?: string;
  stageId?: string;
  recipient?: string;
  kind: GoalReviewNotificationKindRecord;
  message: string;
  dedupeKey: string;
  createdAt: string;
};

export type GoalReviewNotificationStateRecord = {
  version: 1;
  items: GoalReviewNotificationRecord[];
};

export type GoalReviewNotificationDispatchStatusRecord =
  | "pending"
  | "materialized"
  | "delivered"
  | "skipped"
  | "acked"
  | "failed";

export type GoalReviewNotificationDispatchRecord = {
  id: string;
  notificationId: string;
  goalId: string;
  targetType: "suggestion_review" | "checkpoint";
  targetId: string;
  nodeId?: string;
  stageId?: string;
  kind: GoalReviewNotificationKindRecord;
  channel: GoalReviewDeliveryChannelRecord;
  recipient?: string;
  routeKey?: string;
  message: string;
  dedupeKey: string;
  status: GoalReviewNotificationDispatchStatusRecord;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export type GoalReviewNotificationDispatchStateRecord = {
  version: 1;
  items: GoalReviewNotificationDispatchRecord[];
};

export type GoalReviewNotificationDispatchCountsRecord = {
  total: number;
  byChannel: Partial<Record<GoalReviewDeliveryChannelRecord, number>>;
  byStatus: Partial<Record<GoalReviewNotificationDispatchStatusRecord, number>>;
};

export type GoalApprovalWorkflowScanItemRecord = {
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
  action: GoalSuggestionReviewWorkflowScanActionRecord;
};

export type GoalApprovalWorkflowScanResultRecord = {
  goal: GoalRecord;
  scannedAt: string;
  reviewResult: GoalSuggestionReviewWorkflowScanResultRecord;
  checkpointItems: GoalApprovalWorkflowScanItemRecord[];
  notifications: GoalReviewNotificationRecord[];
  dispatches: GoalReviewNotificationDispatchRecord[];
  summary: string;
  recommendations: string[];
};

export type GoalReviewGovernanceSummaryRecord = {
  goal: GoalRecord;
  generatedAt: string;
  governanceConfig: GoalReviewGovernanceConfigRecord;
  governanceConfigPath: string;
  reviews: GoalSuggestionReviewStateRecord;
  publishRecords: GoalSuggestionPublishStateRecord;
  notifications: GoalReviewNotificationStateRecord;
  notificationsPath: string;
  notificationDispatches: GoalReviewNotificationDispatchStateRecord;
  notificationDispatchesPath: string;
  notificationDispatchCounts: GoalReviewNotificationDispatchCountsRecord;
  crossGoal: {
    goalsScanned: number;
    markdownPath: string;
    jsonPath: string;
    items: GoalCrossFlowPatternRecord[];
  };
  reviewStatusCounts: GoalSuggestionReviewStatusCountsRecord;
  reviewTypeCounts: GoalSuggestionReviewTypeCountsRecord;
  workflowPendingCount: number;
  workflowOverdueCount: number;
  actionableReviews: GoalSuggestionReviewItemRecord[];
  overdueReviews: GoalSuggestionReviewItemRecord[];
  actionableCheckpoints: GoalCheckpointRecord[];
  checkpointWorkflowPendingCount: number;
  checkpointWorkflowOverdueCount: number;
  summary: string;
  recommendations: string[];
};

export type GoalCapabilities = {
  createGoal?: (input: {
    title: string;
    objective?: string;
    slug?: string;
    goalRoot?: string;
  }) => Promise<GoalRecord>;
  listGoals?: () => Promise<GoalRecord[]>;
  getGoal?: (goalId: string) => Promise<GoalRecord | null>;
  resumeGoal?: (goalId: string, nodeId?: string) => Promise<{
    goal: GoalRecord;
    conversationId: string;
    runId?: string;
  }>;
  pauseGoal?: (goalId: string) => Promise<GoalRecord>;
  readTaskGraph?: (goalId: string) => Promise<GoalTaskGraphRecord>;
  createTaskNode?: (goalId: string, input: {
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
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  updateTaskNode?: (goalId: string, nodeId: string, input: {
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
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  claimTaskNode?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  markTaskNodePendingReview?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  markTaskNodeValidating?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  completeTaskNode?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  blockTaskNode?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  failTaskNode?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  skipTaskNode?: (goalId: string, nodeId: string, input?: {
    owner?: string;
    summary?: string;
    blockReason?: string;
    artifacts?: string[];
    checkpointStatus?: GoalTaskCheckpointStatus;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
  }>;
  listCheckpoints?: (goalId: string) => Promise<GoalCheckpointStateRecord>;
  requestCheckpoint?: (goalId: string, nodeId: string, input?: {
    title?: string;
    summary?: string;
    note?: string;
    reviewer?: string;
    reviewerRole?: string;
    requestedBy?: string;
    slaAt?: string;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
    checkpoints: GoalCheckpointStateRecord;
    checkpoint: GoalCheckpointRecord;
  }>;
  approveCheckpoint?: (goalId: string, nodeId: string, input?: {
    checkpointId?: string;
    summary?: string;
    note?: string;
    reviewer?: string;
    reviewerRole?: string;
    requestedBy?: string;
    decidedBy?: string;
    slaAt?: string;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
    checkpoints: GoalCheckpointStateRecord;
    checkpoint: GoalCheckpointRecord;
  }>;
  rejectCheckpoint?: (goalId: string, nodeId: string, input?: {
    checkpointId?: string;
    summary?: string;
    note?: string;
    reviewer?: string;
    reviewerRole?: string;
    requestedBy?: string;
    decidedBy?: string;
    slaAt?: string;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
    checkpoints: GoalCheckpointStateRecord;
    checkpoint: GoalCheckpointRecord;
  }>;
  expireCheckpoint?: (goalId: string, nodeId: string, input?: {
    checkpointId?: string;
    summary?: string;
    note?: string;
    reviewer?: string;
    reviewerRole?: string;
    requestedBy?: string;
    decidedBy?: string;
    slaAt?: string;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
    checkpoints: GoalCheckpointStateRecord;
    checkpoint: GoalCheckpointRecord;
  }>;
  reopenCheckpoint?: (goalId: string, nodeId: string, input?: {
    checkpointId?: string;
    summary?: string;
    note?: string;
    reviewer?: string;
    reviewerRole?: string;
    requestedBy?: string;
    decidedBy?: string;
    slaAt?: string;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
    checkpoints: GoalCheckpointStateRecord;
    checkpoint: GoalCheckpointRecord;
  }>;
  escalateCheckpoint?: (goalId: string, nodeId: string, input?: {
    checkpointId?: string;
    escalatedBy?: string;
    escalatedTo?: string;
    reason?: string;
    force?: boolean;
    runId?: string;
  }) => Promise<{
    goal: GoalRecord;
    graph: GoalTaskGraphRecord;
    node: GoalTaskNodeRecord;
    checkpoints: GoalCheckpointStateRecord;
    checkpoint: GoalCheckpointRecord;
  }>;
  listCapabilityPlans?: (goalId: string) => Promise<GoalCapabilityPlanStateRecord>;
  getCapabilityPlan?: (goalId: string, nodeId: string) => Promise<GoalCapabilityPlanRecord | null>;
  saveCapabilityPlan?: (goalId: string, nodeId: string, input: {
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
    methods?: GoalCapabilityPlanMethodRecord[];
    skills?: GoalCapabilityPlanSkillRecord[];
    mcpServers?: GoalCapabilityPlanMcpServerRecord[];
    subAgents?: GoalCapabilityPlanSubAgentRecord[];
    gaps?: string[];
    checkpoint?: GoalCapabilityPlanCheckpointPolicyRecord;
    actualUsage?: GoalCapabilityPlanActualUsageRecord;
    orchestratedAt?: string;
    orchestration?: GoalCapabilityPlanOrchestrationRecord;
  }) => Promise<GoalCapabilityPlanRecord>;
  generateCapabilityPlan?: (goalId: string, nodeId: string, input?: {
    runId?: string;
    objective?: string;
    queryHints?: string[];
    forceMode?: GoalCapabilityExecutionMode;
  }) => Promise<{
    goal: GoalRecord;
    node: GoalTaskNodeRecord;
    plan: GoalCapabilityPlanRecord;
  }>;
  generateHandoff?: (goalId: string) => Promise<{
    goal: GoalRecord;
    handoff: GoalHandoffRecord;
    content: string;
  }>;
  generateRetrospective?: (goalId: string) => Promise<{
    goal: GoalRecord;
    retrospective: GoalRetrospectiveRecord;
    content: string;
  }>;
  generateExperienceSuggestions?: (goalId: string) => Promise<GoalExperienceSuggestRecord>;
  generateMethodCandidates?: (goalId: string) => Promise<{
    goal: GoalRecord;
    candidates: GoalMethodCandidateRecord[];
    markdownPath: string;
    jsonPath: string;
    content: string;
  }>;
  generateSkillCandidates?: (goalId: string) => Promise<{
    goal: GoalRecord;
    candidates: GoalSkillCandidateRecord[];
    markdownPath: string;
    jsonPath: string;
    content: string;
  }>;
  generateFlowPatterns?: (goalId: string) => Promise<{
    goal: GoalRecord;
    patterns: GoalFlowPatternRecord[];
    markdownPath: string;
    jsonPath: string;
    content: string;
  }>;
  generateCrossGoalFlowPatterns?: () => Promise<{
    generatedAt: string;
    goalsScanned: number;
    patterns: GoalCrossFlowPatternRecord[];
    markdownPath: string;
    jsonPath: string;
    content: string;
  }>;
  getReviewGovernanceSummary?: (goalId: string) => Promise<GoalReviewGovernanceSummaryRecord>;
  scanApprovalWorkflows?: (goalId: string, input?: {
    now?: string;
    autoEscalate?: boolean;
  }) => Promise<GoalApprovalWorkflowScanResultRecord>;
  listSuggestionReviews?: (goalId: string) => Promise<GoalSuggestionReviewStateRecord>;
  configureSuggestionReviewWorkflow?: (goalId: string, input: {
    reviewId?: string;
    suggestionType?: GoalSuggestionTypeRecord;
    suggestionId?: string;
    templateId?: string;
    mode: GoalSuggestionReviewWorkflowModeRecord;
    reviewers?: string[];
    reviewerRoles?: string[];
    minApprovals?: number;
    stages?: Array<{
      title?: string;
      reviewers: string[];
      reviewerRoles?: string[];
      minApprovals?: number;
      slaHours?: number;
      reminderMinutes?: number[];
    }>;
    slaHours?: number;
    escalationMode?: GoalSuggestionReviewWorkflowEscalationModeRecord;
    escalationReviewer?: string;
    note?: string;
  }) => Promise<{
    goal: GoalRecord;
    reviews: GoalSuggestionReviewStateRecord;
    review: GoalSuggestionReviewItemRecord;
  }>;
  scanSuggestionReviewWorkflows?: (goalId: string, input?: {
    now?: string;
    autoEscalate?: boolean;
  }) => Promise<GoalSuggestionReviewWorkflowScanResultRecord>;
  decideSuggestionReview?: (goalId: string, input: {
    reviewId?: string;
    suggestionType?: GoalSuggestionTypeRecord;
    suggestionId?: string;
    decision: Exclude<GoalSuggestionReviewStatusRecord, "pending_review">;
    reviewer?: string;
    decidedBy?: string;
    note?: string;
  }) => Promise<{
    goal: GoalRecord;
    reviews: GoalSuggestionReviewStateRecord;
    review: GoalSuggestionReviewItemRecord;
  }>;
  escalateSuggestionReview?: (goalId: string, input: {
    reviewId?: string;
    suggestionType?: GoalSuggestionTypeRecord;
    suggestionId?: string;
    escalatedBy?: string;
    escalatedTo?: string;
    reason?: string;
    force?: boolean;
  }) => Promise<{
    goal: GoalRecord;
    reviews: GoalSuggestionReviewStateRecord;
    review: GoalSuggestionReviewItemRecord;
  }>;
  publishSuggestion?: (goalId: string, input: {
    reviewId?: string;
    suggestionType?: GoalSuggestionTypeRecord;
    suggestionId?: string;
    reviewer?: string;
    decidedBy?: string;
    note?: string;
  }) => Promise<{
    goal: GoalRecord;
    review: GoalSuggestionReviewItemRecord;
    record: GoalSuggestionPublishRecord;
    records: GoalSuggestionPublishStateRecord;
  }>;
};

/** 消息发送者信息 */
export type SenderInfo = {
  type: "user" | "agent";
  id: string;
  name?: string;
  identity?: string; // Agent的身份标签（如：舰长、CEO）
};

/** 房间成员信息 */
export type RoomMember = {
  type: "user" | "agent";
  id: string;
  name?: string;
  identity?: string; // Agent的身份标签
};

/** 房间上下文信息 */
export type RoomContext = {
  roomId?: string;
  environment: "local" | "community"; // 本地WebChat vs office.goddess.ai社区
  sessionKey?: string;
  members?: RoomMember[];
  clientId?: string;
};

/** Token 计数器服务接口（由 belldandy-agent 实现，此处定义以避免循环依赖） */
export interface ITokenCounterService {
  start(name: string): void;
  stop(name: string): {
    name: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    inputCostUsd?: number;
    outputCostUsd?: number;
    totalCostUsd?: number;
  };
  list(): string[];
  notifyUsage(inputTokens: number, outputTokens: number, costs?: {
    inputCostUsd?: number;
    outputCostUsd?: number;
  }): void;
  cleanup(): string[];
}

/** 工具执行上下文 */
export type ToolContext = {
  conversationId: string;
  workspaceRoot: string;
  /** 当前运行时的 stateDir；工具若需跨进程持久化轻量状态，应优先使用这里 */
  stateDir?: string;
  /** 当前运行时的环境变量读取能力；未提供时工具可自行回退到 process.env */
  readEnv?: (name: string) => string | undefined;
  /** 当前运行的协作式中断信号；第一版只保证工具在安全点响应 */
  abortSignal?: AbortSignal;
  /** 额外允许的文件操作根目录（如其他盘符下的目录），路径必须落在 workspaceRoot 或其一内 */
  extraWorkspaceRoots?: string[];
  /** 当前运行的默认工作目录（来自 launchSpec.cwd） */
  defaultCwd?: string;
  /** 当前 Agent ID（用于 per-agent workspace 定位，如 switch_facet） */
  agentId?: string;
  /** 当前 Agent 的轻量能力偏好目录（仅用于软路由，不构成硬限制） */
  agentCatalogPreferences?: {
    methods?: string[];
    skills?: string[];
  };
  /** 当前运行的 launchSpec 摘要（用于工具级约束/展示） */
  launchSpec?: ToolRuntimeLaunchSpec;
  /** 用户UUID（用于身份权力验证） */
  userUuid?: string;
  /** 消息发送者信息（用于身份上下文） */
  senderInfo?: SenderInfo;
  /** 房间上下文信息（用于多人聊天场景） */
  roomContext?: RoomContext;
  /** 会话存储（用于缓存等功能） */
  conversationStore?: ConversationStoreInterface;
  /** 当前运行时允许读取的会话类别白名单；未提供时表示不额外限制 */
  allowedConversationKinds?: ConversationAccessKind[];
  /** bridge session 与 subtask runtime 的治理接线能力 */
  bridgeSessionGovernance?: BridgeSessionGovernanceCapabilities;
  /** bridge session 运行时若需复用已有治理 taskId，会在这里透传 */
  bridgeGovernanceTaskId?: string;
  policy: ToolPolicy;
  agentCapabilities?: AgentCapabilities;
  goalCapabilities?: GoalCapabilities;
  /** Token 计数器（由 ToolEnabledAgent 注入，用于任务级 token 统计） */
  tokenCounter?: ITokenCounterService;
  /** 事件广播回调（由 Gateway 注入，用于工具主动推送事件到前端） */
  broadcast?: (event: string, payload: Record<string, unknown>) => void;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
    trace(message: string): void;
  };
  mcp?: MCPRuntimeCapabilities;
  /** 动态工作流运行时能力（由 Gateway 注入 WorkflowRuntime 实例） */
  workflowRuntime?: WorkflowRuntimeCapabilities;
};

export type ConversationAccessKind = "main" | "subtask" | "goal" | "heartbeat";

export type ConversationMessageLike = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  agentId?: string;
  clientContext?: {
    sentAtMs?: number;
    timezoneOffsetMinutes?: number;
    locale?: string;
  };
};

export type PersistedConversationSummaryLike = {
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  hasTranscript: boolean;
  hasMeta: boolean;
  hasMessages: boolean;
  agentId?: string;
  channel?: string;
};

export type ConversationRestoreViewLike = {
  conversationId: string;
  rawMessages: ConversationMessageLike[];
  compactedView: Array<{ role: "user" | "assistant"; content: string }>;
  canonicalExtractionView: Array<{ role: "user" | "assistant"; content: string }>;
  diagnostics: {
    source: "transcript" | "conversation_fallback";
    transcriptEventCount: number;
    transcriptMessageEventCount: number;
    transcriptUsed: boolean;
    relinkAttempted: boolean;
    relinkApplied: boolean;
    fallbackToRaw: boolean;
    fallbackReason?: "no_boundary" | "relink_failed";
    boundarySource?: "transcript" | "conversation_meta";
    partialViewSource?: "transcript" | "conversation_meta";
  };
};

export type ConversationTimelineProjectionLike = {
  manifest: {
    schemaVersion: number;
    conversationId: string;
    projectedAt: number;
    source: string;
  };
  items: Array<Record<string, unknown>>;
  summary: {
    eventCount: number;
    itemCount: number;
    messageCount: number;
    compactBoundaryCount: number;
    partialCompactionCount: number;
    latestEventAt?: number;
    restore: {
      source: "transcript" | "conversation_fallback";
      relinkApplied: boolean;
      fallbackToRaw: boolean;
      fallbackReason?: "no_boundary" | "relink_failed";
    };
    boundaryId?: string;
    partialViewId?: string;
  };
  warnings: string[];
};

export type ConversationTranscriptExportLike = {
  manifest: {
    schemaVersion: number;
    conversationId: string;
    exportedAt: number;
    source: string;
    redactionMode: "internal" | "shareable" | "metadata_only";
  };
  events: Array<Record<string, unknown>>;
  restore: {
    rawMessages: Array<Record<string, unknown>>;
    compactedView: Array<Record<string, unknown>>;
    canonicalExtractionView: Array<Record<string, unknown>>;
    diagnostics: ConversationRestoreViewLike["diagnostics"];
  };
  summary: {
    eventCount: number;
    messageEventCount: number;
    compactBoundaryCount: number;
    partialCompactionViewCount: number;
    latestEventAt?: number;
    restore: {
      source: "transcript" | "conversation_fallback";
      relinkApplied: boolean;
      fallbackToRaw: boolean;
      fallbackReason?: "no_boundary" | "relink_failed";
    };
    boundaryId?: string;
    partialViewId?: string;
  };
  redaction: {
    mode: "internal" | "shareable" | "metadata_only";
    contentRedacted: boolean;
    notes: string[];
  };
};

/** ConversationStore 接口（避免循环依赖） */
export interface ConversationStoreInterface {
  getHistory(
    conversationId: string,
  ): Array<{ role: "user" | "assistant"; content: string }>;
  getPlanState?(
    conversationId: string,
  ): ConversationPlanState | null;
  updatePlanState?(
    conversationId: string,
    input: ConversationPlanUpdateInput,
  ): ConversationPlanUpdateResult;
  clearPlanState?(
    conversationId: string,
    updatedBy?: ConversationPlanUpdatedBy,
  ): ConversationPlanState | null;
  listPersistedConversations?(
    options?: {
      limit?: number;
      conversationIdPrefix?: string;
    },
  ): Promise<PersistedConversationSummaryLike[]>;
  buildConversationRestoreView?(
    conversationId: string,
  ): Promise<ConversationRestoreViewLike>;
  buildConversationTimeline?(
    conversationId: string,
    options?: { previewChars?: number },
  ): Promise<ConversationTimelineProjectionLike>;
  buildConversationTranscriptExport?(
    conversationId: string,
    options?: { mode?: "internal" | "shareable" | "metadata_only" },
  ): Promise<ConversationTranscriptExportLike>;
  getLoadedToolNames?(
    conversationId: string,
  ): string[];
  setLoadedToolNames?(
    conversationId: string,
    toolNames: string[],
  ): void | Promise<void>;
  setRoomMembersCache(
    conversationId: string,
    members: Array<{ type: "user" | "agent"; id: string; name?: string; identity?: string }>,
    ttl?: number,
  ): void;
  getRoomMembersCache(
    conversationId: string,
  ): Array<{ type: "user" | "agent"; id: string; name?: string; identity?: string }> | undefined;
  clearRoomMembersCache(conversationId: string): void;
  recordTaskTokenResult(
    conversationId: string,
    record: {
      name: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      durationMs: number;
      inputCostUsd?: number;
      outputCostUsd?: number;
      totalCostUsd?: number;
      createdAt?: number;
      auto?: boolean;
    },
    limit?: number,
  ): void;
  getTaskTokenResults(
    conversationId: string,
    limit?: number,
  ): Array<{
    name: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    inputCostUsd?: number;
    outputCostUsd?: number;
    totalCostUsd?: number;
    createdAt: number;
    auto?: boolean;
  }>;
  recordRecentToolResult?(
    conversationId: string,
    record: Omit<RecentToolResultRecord, "createdAt"> & { createdAt?: number },
    limit?: number,
  ): void;
  getRecentToolResults?(
    conversationId: string,
    options?: {
      limit?: number;
      toolCallId?: string;
      toolName?: string;
      success?: boolean;
      query?: string;
    },
  ): RecentToolResultRecord[];
}


/** 工具实现接口 */
export interface Tool {
  definition: ToolDefinition;
  contract?: ToolContract;
  execute(args: JsonObject, context: ToolContext): Promise<ToolCallResult>;
}

/** 工具审计日志 */
export type ToolAuditLog = {
  timestamp: string;
  conversationId: string;
  toolName: string;
  arguments: JsonObject;
  success: boolean;
  output?: string;
  error?: string;
  failureKind?: ToolFailureKind;
  durationMs: number;
};
