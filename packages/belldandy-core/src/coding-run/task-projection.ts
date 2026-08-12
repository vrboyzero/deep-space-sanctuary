import type { CodingContextBinding } from "./contracts.js";
import type { CodingRunSourceView, CodingRunAdapterStatus } from "./source-adapters.js";

export const TASK_PROJECTION_SCHEMA_VERSION = "task-projection/v1" as const;
export const TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION = "task-capability-closure/v1" as const;

export type TaskProjectionStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "blocked"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "uncertain";

export type TaskProjectionReasonCategory =
  | "queued"
  | "running"
  | "awaiting_input"
  | "blocked_by_capability"
  | "owner_blocked"
  | "verification"
  | "completed"
  | "owner_failure"
  | "owner_cancelled"
  | "owner_interrupted"
  | "evidence_conflict";

export type TaskProjectionAction =
  | "observe"
  | "respond"
  | "resume"
  | "cancel"
  | "retry"
  | "verify";

export type TaskCapabilityName =
  | "tools"
  | "languageToolchain"
  | "sandbox"
  | "approvalChannel"
  | "worktree"
  | "journal"
  | "trace"
  | "verifier"
  | "mcp"
  | "plugin"
  | "skill";

export type TaskCapabilityState = "available" | "degraded" | "unavailable" | "unknown";

export type TaskCapability = {
  required: boolean;
  state: TaskCapabilityState;
  reasonCode?: string;
};

export type TaskCapabilityClosure = {
  schemaVersion: typeof TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION;
  evaluatedAtMs: number;
  status: "satisfied" | "degraded" | "blocked" | "unknown";
  capabilities: Record<TaskCapabilityName, TaskCapability>;
};

export type TaskProjection = {
  schemaVersion: typeof TASK_PROJECTION_SCHEMA_VERSION;
  taskId: string;
  status: TaskProjectionStatus;
  owner: {
    source: CodingRunSourceView["source"];
    binding: CodingContextBinding;
  };
  evidence: {
    observedAtMs: number;
    reasonCategory: TaskProjectionReasonCategory;
    reasonCode: string;
  };
  allowedActions: TaskProjectionAction[];
  capabilityClosure: TaskCapabilityClosure;
  supportingEvidence?: TaskProjectionSupportingEvidence;
};

export type TaskProjectionSupportingEvidence = {
  commandJob?: { status: "running" | "completed" | "cancelled" | "failed" | "lost"; observedAtMs: number };
  worktree?: { status: "ready" | "dirty" | "conflicted" | "missing" | "uncertain"; observedAtMs: number };
  journal?: { status: "pending" | "done" | "error" | "skipped" | "uncertain"; observedAtMs: number };
  validation?: { status: "queued" | "running" | "passed" | "failed" | "incomplete" | "uncertain"; observedAtMs: number; required: boolean };
};

export type TaskProjectionInput = {
  taskId: string;
  view: CodingRunSourceView;
  observedAtMs: number;
  capabilityClosure: TaskCapabilityClosure;
  supportingEvidence?: TaskProjectionSupportingEvidence;
};

export type TaskProjectionSetInput = {
  sources: readonly TaskProjectionInput[];
};

export const TASK_PROJECTION_ACTIONS_SCHEMA_VERSION = "task-projection-actions/v1" as const;

export type TaskProjectionActionEnvelope = {
  schemaVersion: typeof TASK_PROJECTION_ACTIONS_SCHEMA_VERSION;
  requestId: string;
  taskId: string;
  action: TaskProjectionAction;
  binding: CodingContextBinding;
};

export type TaskProjectionActionEnvelopeInput = {
  projection: TaskProjection;
  action: TaskProjectionAction;
  requestId: string;
  binding?: CodingContextBinding;
};

const CAPABILITY_NAMES: readonly TaskCapabilityName[] = [
  "tools",
  "languageToolchain",
  "sandbox",
  "approvalChannel",
  "worktree",
  "journal",
  "trace",
  "verifier",
  "mcp",
  "plugin",
  "skill",
];

const ACTIONS_BY_STATUS: Record<TaskProjectionStatus, readonly TaskProjectionAction[]> = {
  queued: ["observe", "cancel"],
  running: ["observe", "cancel"],
  needs_input: ["observe", "respond"],
  blocked: ["observe"],
  verifying: ["observe", "cancel"],
  completed: ["observe"],
  failed: ["observe", "retry"],
  cancelled: ["observe"],
  interrupted: ["observe", "resume"],
  uncertain: ["observe"],
};

/**
 * 将 authoritative source view 归一化为只读任务投影；不会推进任何 owner 状态。
 */
export function createTaskProjection(input: TaskProjectionInput): TaskProjection {
  const taskId = requireNonEmptyString(input.taskId, "Task id");
  const observedAtMs = toNonNegativeInteger(input.observedAtMs, "Observed timestamp");
  assertTaskCapabilityClosure(input.capabilityClosure);
  assertSourceView(input.view);

  const supportingEvidence = normalizeSupportingEvidence(input.supportingEvidence);
  if (hasMissingRequiredCapability(input.capabilityClosure)) {
    return buildProjection({
      taskId,
      view: input.view,
      observedAtMs,
      capabilityClosure: input.capabilityClosure,
      status: "blocked",
      reasonCategory: "blocked_by_capability",
      reasonCode: "required_capability_unavailable",
      supportingEvidence,
    });
  }

  const mapped = mapSourceStatus(input.view.status, supportingEvidence);
  return buildProjection({
    taskId,
    view: input.view,
    observedAtMs,
    capabilityClosure: input.capabilityClosure,
    status: mapped.status,
    reasonCategory: mapped.reasonCategory,
    reasonCode: mapped.reasonCode,
    supportingEvidence,
  });
}

/**
 * 合并同一 task 的多份 authoritative evidence。终态与非终态冲突时保持 uncertain，
 * 防止迟到缓存把已完成/取消任务复活为可执行状态。
 */
export function createTaskProjectionSet(input: TaskProjectionSetInput): TaskProjection[] {
  const grouped = new Map<string, TaskProjectionInput[]>();
  for (const source of input.sources) {
    const taskId = requireNonEmptyString(source.taskId, "Task id");
    const bucket = grouped.get(taskId) ?? [];
    bucket.push(source);
    grouped.set(taskId, bucket);
  }

  return [...grouped.entries()].map(([taskId, sources]) => {
    const projections = sources.map(createTaskProjection);
    const latest = projections.reduce((left, right) =>
      right.evidence.observedAtMs >= left.evidence.observedAtMs ? right : left,
    );
    const distinctStates = new Set(projections.map((projection) => projection.status));
    const bindings = new Set(projections.map((projection) => JSON.stringify(projection.owner.binding)));
    if (bindings.size > 1) {
      return {
        ...latest,
        taskId,
        status: "uncertain",
        evidence: {
          observedAtMs: latest.evidence.observedAtMs,
          reasonCategory: "evidence_conflict",
          reasonCode: "owner_binding_drift",
        },
        allowedActions: ["observe"],
      };
    }
    if (distinctStates.size <= 1) return latest;

    return {
      ...latest,
      taskId,
      status: "uncertain",
      evidence: {
        observedAtMs: latest.evidence.observedAtMs,
        reasonCategory: "evidence_conflict",
        reasonCode: "conflicting_owner_evidence",
      },
      allowedActions: ["observe"],
    };
  });
}

/**
 * 仅生成供原 owner 进一步校验的 action envelope；此函数不执行 mutation。
 */
export function createTaskProjectionActionEnvelope(
  input: TaskProjectionActionEnvelopeInput,
): TaskProjectionActionEnvelope {
  if (!isTaskProjectionV1(input.projection)) throw new Error("Invalid task projection.");
  const requestId = requireNonEmptyString(input.requestId, "Request id");
  if (!input.projection.allowedActions.includes(input.action)) {
    throw new Error(`Action is not allowed for task status ${input.projection.status}.`);
  }
  const binding = input.binding ?? input.projection.owner.binding;
  if (!bindingsEqual(binding, input.projection.owner.binding)) {
    throw new Error("Task projection action binding does not match the authoritative projection binding.");
  }
  return {
    schemaVersion: TASK_PROJECTION_ACTIONS_SCHEMA_VERSION,
    requestId,
    taskId: input.projection.taskId,
    action: input.action,
    binding: cloneBinding(binding),
  };
}

export function isTaskProjectionV1(value: unknown): value is TaskProjection {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion",
    "taskId",
    "status",
    "owner",
    "evidence",
    "allowedActions",
    "capabilityClosure",
  ], ["supportingEvidence"])) return false;
  if (value.schemaVersion !== TASK_PROJECTION_SCHEMA_VERSION || !isNonEmptyString(value.taskId)) return false;
  if (!TASK_STATUSES.has(value.status as TaskProjectionStatus)) return false;
  if (!isRecord(value.owner) || !hasExactKeys(value.owner, ["source", "binding"])) return false;
  if (!isSource(value.owner.source) || !isBindingForSource(value.owner.source, value.owner.binding)) return false;
  if (!isRecord(value.evidence) || !hasExactKeys(value.evidence, ["observedAtMs", "reasonCategory", "reasonCode"])) return false;
  if (!isNonNegativeInteger(value.evidence.observedAtMs)
    || !REASON_CATEGORIES.has(value.evidence.reasonCategory as TaskProjectionReasonCategory)
    || !isNonEmptyString(value.evidence.reasonCode)) return false;
  if (!Array.isArray(value.allowedActions)
    || !value.allowedActions.every((action) => ACTIONS.has(action as TaskProjectionAction))
    || !arraysEqual(value.allowedActions, ACTIONS_BY_STATUS[value.status as TaskProjectionStatus])) return false;
  return isTaskCapabilityClosure(value.capabilityClosure)
    && (value.supportingEvidence === undefined || isTaskProjectionSupportingEvidence(value.supportingEvidence));
}

export function isTaskCapabilityClosure(value: unknown): value is TaskCapabilityClosure {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "evaluatedAtMs", "status", "capabilities"])) return false;
  if (value.schemaVersion !== TASK_CAPABILITY_CLOSURE_SCHEMA_VERSION
    || !isNonNegativeInteger(value.evaluatedAtMs)
    || !CAPABILITY_STATUSES.has(value.status as TaskCapabilityClosure["status"])
    || !isRecord(value.capabilities)
    || !hasExactKeys(value.capabilities, CAPABILITY_NAMES)) return false;
  return CAPABILITY_NAMES.every((name) => isTaskCapability(value.capabilities[name]));
}

export function isTaskProjectionActionEnvelopeV1(value: unknown): value is TaskProjectionActionEnvelope {
  return isRecord(value)
    && hasExactKeys(value, ["schemaVersion", "requestId", "taskId", "action", "binding"])
    && value.schemaVersion === TASK_PROJECTION_ACTIONS_SCHEMA_VERSION
    && isNonEmptyString(value.requestId)
    && isNonEmptyString(value.taskId)
    && ACTIONS.has(value.action as TaskProjectionAction)
    && isBinding(value.binding);
}

function isTaskProjectionSupportingEvidence(value: unknown): value is TaskProjectionSupportingEvidence {
  if (!isRecord(value) || !Object.keys(value).every((key) => ["commandJob", "worktree", "journal", "validation"].includes(key))) return false;
  const isObserved = (item: unknown, statuses: Set<string>, required = false): boolean => {
    if (!isRecord(item) || !hasExactKeys(item, required ? ["status", "observedAtMs", "required"] : ["status", "observedAtMs"])) return false;
    return statuses.has(item.status as string) && isNonNegativeInteger(item.observedAtMs) && (!required || typeof item.required === "boolean");
  };
  return (!Object.prototype.hasOwnProperty.call(value, "commandJob") || isObserved(value.commandJob, new Set(["running", "completed", "cancelled", "failed", "lost"])))
    && (!Object.prototype.hasOwnProperty.call(value, "worktree") || isObserved(value.worktree, new Set(["ready", "dirty", "conflicted", "missing", "uncertain"])))
    && (!Object.prototype.hasOwnProperty.call(value, "journal") || isObserved(value.journal, new Set(["pending", "done", "error", "skipped", "uncertain"])))
    && (!Object.prototype.hasOwnProperty.call(value, "validation") || isObserved(value.validation, new Set(["queued", "running", "passed", "failed", "incomplete", "uncertain"]), true));
}

function buildProjection(input: {
  taskId: string;
  view: CodingRunSourceView;
  observedAtMs: number;
  capabilityClosure: TaskCapabilityClosure;
  status: TaskProjectionStatus;
  reasonCategory: TaskProjectionReasonCategory;
  reasonCode: string;
  supportingEvidence?: TaskProjectionSupportingEvidence;
}): TaskProjection {
  return {
    schemaVersion: TASK_PROJECTION_SCHEMA_VERSION,
    taskId: input.taskId,
    status: input.status,
    owner: { source: input.view.source, binding: cloneBinding(input.view.binding) },
    evidence: {
      observedAtMs: input.observedAtMs,
      reasonCategory: input.reasonCategory,
      reasonCode: input.reasonCode,
    },
    allowedActions: [...ACTIONS_BY_STATUS[input.status]],
    capabilityClosure: cloneCapabilityClosure(input.capabilityClosure),
    ...(input.supportingEvidence ? { supportingEvidence: cloneSupportingEvidence(input.supportingEvidence) } : {}),
  };
}

function mapSourceStatus(status: CodingRunAdapterStatus, evidence?: TaskProjectionSupportingEvidence): {
  status: TaskProjectionStatus;
  reasonCategory: TaskProjectionReasonCategory;
  reasonCode: string;
} {
  if (evidence?.journal?.status === "uncertain") {
    return { status: "uncertain", reasonCategory: "evidence_conflict", reasonCode: "journal_evidence_uncertain" };
  }
  if (evidence?.worktree && ["conflicted", "missing", "uncertain"].includes(evidence.worktree.status)) {
    return { status: "uncertain", reasonCategory: "evidence_conflict", reasonCode: "worktree_evidence_uncertain" };
  }
  if (evidence?.commandJob?.status === "lost") {
    return { status: "interrupted", reasonCategory: "owner_interrupted", reasonCode: "command_job_lost" };
  }
  if (evidence?.validation?.required && ["queued", "running", "incomplete"].includes(evidence.validation.status)) {
    return { status: "verifying", reasonCategory: "verification", reasonCode: "validation_in_progress" };
  }
  if (evidence?.validation?.status === "failed") {
    return { status: "failed", reasonCategory: "owner_failure", reasonCode: "validation_failed" };
  }
  switch (status) {
    case "awaiting_review":
      return { status: "needs_input", reasonCategory: "awaiting_input", reasonCode: "awaiting_user_review" };
    case "running":
      return { status: "running", reasonCategory: "running", reasonCode: "owner_running" };
    case "blocked":
      return { status: "blocked", reasonCategory: "owner_blocked", reasonCode: "owner_reported_blocked" };
    case "completed":
      return { status: "completed", reasonCategory: "completed", reasonCode: "owner_completed" };
    case "failed":
      return { status: "failed", reasonCategory: "owner_failure", reasonCode: "owner_reported_failure" };
    case "cancelled":
      return { status: "cancelled", reasonCategory: "owner_cancelled", reasonCode: "owner_reported_cancelled" };
    case "interrupted":
      return { status: "interrupted", reasonCategory: "owner_interrupted", reasonCode: "owner_runtime_interrupted" };
    case "queued":
      return { status: "queued", reasonCategory: "queued", reasonCode: "owner_queued" };
  }
}

function normalizeSupportingEvidence(
  value: TaskProjectionSupportingEvidence | undefined,
): TaskProjectionSupportingEvidence | undefined {
  if (value === undefined) return undefined;
  if (!isTaskProjectionSupportingEvidence(value)) throw new Error("Invalid task projection supporting evidence.");
  return cloneSupportingEvidence(value);
}

function assertTaskCapabilityClosure(value: TaskCapabilityClosure): void {
  if (!isTaskCapabilityClosure(value)) throw new Error("Invalid task capability closure.");
}

function assertSourceView(value: CodingRunSourceView): void {
  if (!isSource(value.source) || !isBindingForSource(value.source, value.binding)) {
    throw new Error("Invalid task projection source binding.");
  }
}

function hasMissingRequiredCapability(closure: TaskCapabilityClosure): boolean {
  return closure.status === "blocked" || CAPABILITY_NAMES.some((name) => {
    const capability = closure.capabilities[name];
    return capability.required && capability.state !== "available";
  });
}

function isTaskCapability(value: unknown): value is TaskCapability {
  return isRecord(value)
    && (Object.keys(value).every((key) => ["required", "state", "reasonCode"].includes(key)))
    && typeof value.required === "boolean"
    && CAPABILITY_STATES.has(value.state as TaskCapabilityState)
    && (!Object.prototype.hasOwnProperty.call(value, "reasonCode") || isNonEmptyString(value.reasonCode));
}

function isSource(value: unknown): value is CodingRunSourceView["source"] {
  return value === "conversation" || value === "goal" || value === "workflow" || value === "subtask";
}

function isBindingForSource(source: CodingRunSourceView["source"], value: unknown): value is CodingContextBinding {
  if (!isBinding(value)) return false;
  if (source === "conversation" && !isNonEmptyString(value.conversationId)) return false;
  if (source === "goal" && !isRef(value.goal, ["goalId"], ["nodeId"])) return false;
  if (source === "workflow" && !isRef(value.workflow, ["journalId"], ["workflowRunId"])) return false;
  if (source === "subtask" && !isRef(value.subtask, ["taskId"])) return false;
  return true;
}

function isBinding(value: unknown): value is CodingContextBinding {
  return isRecord(value) && isNonEmptyString(value.agentRunId)
    && Object.keys(value).every((key) => ["agentRunId", "conversationId", "goal", "workflow", "subtask", "worktreeId", "workspaceCheckpoint"].includes(key))
    && (!Object.prototype.hasOwnProperty.call(value, "conversationId") || isNonEmptyString(value.conversationId))
    && (!Object.prototype.hasOwnProperty.call(value, "worktreeId") || isNonEmptyString(value.worktreeId))
    && (!Object.prototype.hasOwnProperty.call(value, "goal") || isRef(value.goal, ["goalId"], ["nodeId"]))
    && (!Object.prototype.hasOwnProperty.call(value, "workflow") || isRef(value.workflow, ["journalId"], ["workflowRunId"]))
    && (!Object.prototype.hasOwnProperty.call(value, "subtask") || isRef(value.subtask, ["taskId"]))
    && (!Object.prototype.hasOwnProperty.call(value, "workspaceCheckpoint") || isWorkspaceCheckpointRef(value.workspaceCheckpoint));
}

function isRef(value: unknown, requiredKeys: string[], optionalKeys: string[] = []): boolean {
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  return isRecord(value)
    && Object.keys(value).every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => isNonEmptyString(value[key]))
    && optionalKeys.every((key) => !Object.prototype.hasOwnProperty.call(value, key) || isNonEmptyString(value[key]));
}

function cloneBinding(binding: CodingContextBinding): CodingContextBinding {
  return {
    ...binding,
    ...(binding.goal ? { goal: { ...binding.goal } } : {}),
    ...(binding.workflow ? { workflow: { ...binding.workflow } } : {}),
    ...(binding.subtask ? { subtask: { ...binding.subtask } } : {}),
    ...(binding.workspaceCheckpoint ? { workspaceCheckpoint: { ...binding.workspaceCheckpoint } } : {}),
  };
}

function bindingsEqual(left: CodingContextBinding, right: CodingContextBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function arraysEqual(left: unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isWorkspaceCheckpointRef(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["workspaceCheckpointId", "recoveryGuarantee"])
    && isNonEmptyString(value.workspaceCheckpointId)
    && (value.recoveryGuarantee === "exact"
      || value.recoveryGuarantee === "managed_worktree"
      || value.recoveryGuarantee === "detect_only");
}

function cloneCapabilityClosure(closure: TaskCapabilityClosure): TaskCapabilityClosure {
  return {
    ...closure,
    capabilities: Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, { ...closure.capabilities[name] }])) as TaskCapabilityClosure["capabilities"],
  };
}

function cloneSupportingEvidence(value: TaskProjectionSupportingEvidence): TaskProjectionSupportingEvidence {
  return {
    ...(value.commandJob ? { commandJob: { ...value.commandJob } } : {}),
    ...(value.worktree ? { worktree: { ...value.worktree } } : {}),
    ...(value.journal ? { journal: { ...value.journal } } : {}),
    ...(value.validation ? { validation: { ...value.validation } } : {}),
  };
}

function requireNonEmptyString(value: string, label: string): string {
  if (!isNonEmptyString(value)) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function toNonNegativeInteger(value: number, label: string): number {
  if (!isNonNegativeInteger(value)) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

const TASK_STATUSES = new Set<TaskProjectionStatus>([
  "queued", "running", "needs_input", "blocked", "verifying", "completed", "failed", "cancelled", "interrupted", "uncertain",
]);
const REASON_CATEGORIES = new Set<TaskProjectionReasonCategory>([
  "queued", "running", "awaiting_input", "blocked_by_capability", "owner_blocked", "verification", "completed", "owner_failure", "owner_cancelled", "owner_interrupted", "evidence_conflict",
]);
const ACTIONS = new Set<TaskProjectionAction>(["observe", "respond", "resume", "cancel", "retry", "verify"]);
const CAPABILITY_STATES = new Set<TaskCapabilityState>(["available", "degraded", "unavailable", "unknown"]);
const CAPABILITY_STATUSES = new Set<TaskCapabilityClosure["status"]>(["satisfied", "degraded", "blocked", "unknown"]);
