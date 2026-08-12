const TASK_PROJECTION_SCHEMA_VERSION = "task-projection/v1";
const TASK_STATUSES = new Set(["queued", "running", "needs_input", "blocked", "verifying", "completed", "failed", "cancelled", "interrupted", "uncertain"]);
const REASON_CATEGORIES = new Set(["queued", "running", "awaiting_input", "blocked_by_capability", "owner_blocked", "verification", "completed", "owner_failure", "owner_cancelled", "owner_interrupted", "evidence_conflict"]);
const CAPABILITY_NAMES = ["tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal", "trace", "verifier", "mcp", "plugin", "skill"];
const CAPABILITY_STATES = new Set(["available", "degraded", "unavailable", "unknown"]);
const CAPABILITY_STATUSES = new Set(["satisfied", "degraded", "blocked", "unknown"]);
const ACTIONS_BY_STATUS = {
  queued: ["observe", "cancel"], running: ["observe", "cancel"], needs_input: ["observe", "respond"], blocked: ["observe"],
  verifying: ["observe", "cancel"], completed: ["observe"], failed: ["observe", "retry"], cancelled: ["observe"],
  interrupted: ["observe", "resume"], uncertain: ["observe"],
};

export function createWebChatTaskProjectionAdapter({ request } = {}) {
  const gatewayRequest = typeof request === "function" ? request : () => Promise.resolve(null);
  return Object.freeze({
    async list(input = {}, options = {}) {
      const params = normalizeProjectionRequest(input);
      const response = await gatewayRequest({ type: "req", method: "task.projection.list", params }, options);
      if (!response?.ok) return response ?? null;
      return { ...response, payload: parseTaskProjectionCollectionPage(response.payload) };
    },
  });
}

export function parseTaskProjectionCollectionPage(payload) {
  if (!isRecord(payload) || !hasExactKeys(payload, ["epoch", "revision", "totalCount", "items"], ["nextCursor"])
    || !isIdentifier(payload.epoch) || !isSafeNonNegativeInteger(payload.revision)
    || !isSafeNonNegativeInteger(payload.totalCount) || !Array.isArray(payload.items)
    || payload.items.length > 100 || payload.items.some((item) => !isTaskProjection(item))) {
    throw new Error("Gateway returned an invalid TaskProjection collection page.");
  }
  if (payload.items.length > payload.totalCount) throw new Error("Gateway returned an inconsistent TaskProjection collection count.");
  if (payload.nextCursor !== undefined && !isCursor(payload.nextCursor, payload.epoch, payload.revision, payload.totalCount)) {
    throw new Error("Gateway returned an invalid TaskProjection collection cursor.");
  }
  return payload;
}

function normalizeProjectionRequest(input) {
  if (!isRecord(input) || !hasExactKeys(input, [], ["limit", "cursor"])) throw new Error("Task projection request contains unsupported fields.");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
    throw new Error("limit must be an integer between 1 and 100.");
  }
  if (input.cursor !== undefined && !isCursor(input.cursor)) throw new Error("cursor must contain epoch, revision, and offset.");
  return {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: { ...input.cursor, epoch: input.cursor.epoch.trim() } }),
  };
}

function isTaskProjection(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "taskId", "status", "owner", "evidence", "allowedActions", "capabilityClosure"], ["supportingEvidence"])) return false;
  if (value.schemaVersion !== TASK_PROJECTION_SCHEMA_VERSION || !isIdentifier(value.taskId) || !TASK_STATUSES.has(value.status)) return false;
  if (!isRecord(value.owner) || !hasExactKeys(value.owner, ["source", "binding"]) || !isBindingForSource(value.owner.source, value.owner.binding)) return false;
  if (!isRecord(value.evidence) || !hasExactKeys(value.evidence, ["observedAtMs", "reasonCategory", "reasonCode"])
    || !isSafeNonNegativeInteger(value.evidence.observedAtMs) || !REASON_CATEGORIES.has(value.evidence.reasonCategory)
    || !isIdentifier(value.evidence.reasonCode)) return false;
  if (!Array.isArray(value.allowedActions) || !arraysEqual(value.allowedActions, ACTIONS_BY_STATUS[value.status])) return false;
  if (!isCapabilityClosure(value.capabilityClosure)) return false;
  return value.supportingEvidence === undefined || isSupportingEvidence(value.supportingEvidence);
}

function isCapabilityClosure(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "evaluatedAtMs", "status", "capabilities"])
    || value.schemaVersion !== "task-capability-closure/v1" || !isSafeNonNegativeInteger(value.evaluatedAtMs)
    || !CAPABILITY_STATUSES.has(value.status) || !isRecord(value.capabilities)) return false;
  return hasExactKeys(value.capabilities, CAPABILITY_NAMES)
    && CAPABILITY_NAMES.every((name) => isRecord(value.capabilities[name])
      && hasExactKeys(value.capabilities[name], ["required", "state"], ["reasonCode"])
      && typeof value.capabilities[name].required === "boolean"
      && CAPABILITY_STATES.has(value.capabilities[name].state)
      && (value.capabilities[name].reasonCode === undefined || isIdentifier(value.capabilities[name].reasonCode)));
}

function isSupportingEvidence(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !["commandJob", "worktree", "journal", "validation"].includes(key))) return false;
  return (!value.commandJob || isObserved(value.commandJob, ["running", "completed", "cancelled", "failed", "lost"]))
    && (!value.worktree || isObserved(value.worktree, ["ready", "dirty", "conflicted", "missing", "uncertain"]))
    && (!value.journal || isObserved(value.journal, ["pending", "done", "error", "skipped", "uncertain"]))
    && (!value.validation || isObserved(value.validation, ["queued", "running", "passed", "failed", "incomplete", "uncertain"], true));
}

function isObserved(value, statuses, required = false) {
  return isRecord(value) && (required ? hasExactKeys(value, ["status", "observedAtMs", "required"]) : hasExactKeys(value, ["status", "observedAtMs"]))
    && statuses.includes(value.status) && isSafeNonNegativeInteger(value.observedAtMs)
    && (!required || typeof value.required === "boolean");
}

function isBindingForSource(source, binding) {
  if (!isBinding(binding) || !["conversation", "goal", "workflow", "subtask"].includes(source)) return false;
  if (source === "conversation") return isIdentifier(binding.conversationId);
  if (source === "goal") return isRef(binding.goal, ["goalId"], ["nodeId"]);
  if (source === "workflow") return isRef(binding.workflow, ["journalId"], ["workflowRunId"]);
  return isRef(binding.subtask, ["taskId"]);
}

function isBinding(value) {
  return isRecord(value) && isIdentifier(value.agentRunId) && Object.keys(value).every((key) => ["agentRunId", "conversationId", "goal", "workflow", "subtask", "worktreeId", "workspaceCheckpoint"].includes(key))
    && (value.conversationId === undefined || isIdentifier(value.conversationId))
    && (value.worktreeId === undefined || isIdentifier(value.worktreeId))
    && (value.goal === undefined || isRef(value.goal, ["goalId"], ["nodeId"]))
    && (value.workflow === undefined || isRef(value.workflow, ["journalId"], ["workflowRunId"]))
    && (value.subtask === undefined || isRef(value.subtask, ["taskId"]))
    && (value.workspaceCheckpoint === undefined || isWorkspaceCheckpoint(value.workspaceCheckpoint));
}

function isRef(value, required, optional = []) {
  return isRecord(value) && required.every((key) => isIdentifier(value[key]))
    && Object.keys(value).every((key) => [...required, ...optional].includes(key))
    && optional.every((key) => value[key] === undefined || isIdentifier(value[key]));
}

function isWorkspaceCheckpoint(value) {
  return isRecord(value) && hasExactKeys(value, ["workspaceCheckpointId", "recoveryGuarantee"])
    && isIdentifier(value.workspaceCheckpointId)
    && ["exact", "managed_worktree", "detect_only"].includes(value.recoveryGuarantee);
}

function isCursor(value, epoch, revision, totalCount) {
  return isRecord(value) && hasExactKeys(value, ["epoch", "revision", "offset"])
    && isIdentifier(value.epoch) && isSafeNonNegativeInteger(value.revision) && isSafeNonNegativeInteger(value.offset)
    && (epoch === undefined || value.epoch === epoch)
    && (revision === undefined || value.revision === revision)
    && (totalCount === undefined || (value.offset > 0 && value.offset < totalCount));
}

function isIdentifier(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeNonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
