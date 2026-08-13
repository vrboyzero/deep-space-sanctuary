const TASK_STATUSES = new Set([
  "queued", "running", "needs_input", "blocked", "verifying", "completed", "failed", "cancelled", "interrupted", "uncertain",
]);
const REASON_CATEGORIES = new Set([
  "queued", "running", "awaiting_input", "blocked_by_capability", "owner_blocked", "verification", "completed",
  "owner_failure", "owner_cancelled", "owner_interrupted", "evidence_conflict",
]);
const CAPABILITY_NAMES = [
  "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal", "trace", "verifier", "mcp", "plugin", "skill",
];
const CAPABILITY_STATES = new Set(["available", "degraded", "unavailable", "unknown"]);
const CAPABILITY_STATUSES = new Set(["satisfied", "degraded", "blocked", "unknown"]);
const ACTIONS_BY_STATUS = {
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

function isTaskProjectionCollectionPage(value) {
  if (!isRecord(value)
    || !hasExactKeys(value, ["epoch", "revision", "totalCount", "items"], ["nextCursor"])
    || !isIdentifier(value.epoch)
    || !isSafeNonNegativeInteger(value.revision)
    || !isSafeNonNegativeInteger(value.totalCount)
    || !Array.isArray(value.items)
    || value.items.length > 100
    || value.items.length > value.totalCount
    || value.items.some((item) => !isTaskProjection(item))) {
    return false;
  }
  return value.nextCursor === undefined
    || isProjectionCursor(value.nextCursor, value.epoch, value.revision, value.totalCount);
}

function isTaskProjection(value) {
  if (!isRecord(value)
    || !hasExactKeys(
      value,
      ["schemaVersion", "taskId", "status", "owner", "evidence", "allowedActions", "capabilityClosure"],
      ["supportingEvidence"],
    )
    || value.schemaVersion !== "task-projection/v1"
    || !isIdentifier(value.taskId)
    || !TASK_STATUSES.has(value.status)
    || !isOwner(value.owner)
    || !isEvidence(value.evidence)
    || !Array.isArray(value.allowedActions)
    || !arraysEqual(value.allowedActions, ACTIONS_BY_STATUS[value.status])
    || !isCapabilityClosure(value.capabilityClosure)) {
    return false;
  }
  return value.supportingEvidence === undefined || isSupportingEvidence(value.supportingEvidence);
}

function isOwner(value) {
  return isRecord(value)
    && hasExactKeys(value, ["source", "binding"])
    && ["conversation", "goal", "workflow", "subtask"].includes(value.source)
    && isBindingForSource(value.source, value.binding);
}

function isBindingForSource(source, binding) {
  if (!isBinding(binding)) return false;
  if (source === "conversation") return isIdentifier(binding.conversationId);
  if (source === "goal") return isRef(binding.goal, ["goalId"], ["nodeId"]);
  if (source === "workflow") return isRef(binding.workflow, ["journalId"], ["workflowRunId"]);
  return isRef(binding.subtask, ["taskId"]);
}

function isBinding(value) {
  return isRecord(value)
    && isIdentifier(value.agentRunId)
    && Object.keys(value).every((key) => [
      "agentRunId", "conversationId", "goal", "workflow", "subtask", "worktreeId", "workspaceCheckpoint",
    ].includes(key))
    && (value.conversationId === undefined || isIdentifier(value.conversationId))
    && (value.worktreeId === undefined || isIdentifier(value.worktreeId))
    && (value.goal === undefined || isRef(value.goal, ["goalId"], ["nodeId"]))
    && (value.workflow === undefined || isRef(value.workflow, ["journalId"], ["workflowRunId"]))
    && (value.subtask === undefined || isRef(value.subtask, ["taskId"]))
    && (value.workspaceCheckpoint === undefined || isWorkspaceCheckpoint(value.workspaceCheckpoint));
}

function isEvidence(value) {
  return isRecord(value)
    && hasExactKeys(value, ["observedAtMs", "reasonCategory", "reasonCode"])
    && isSafeNonNegativeInteger(value.observedAtMs)
    && REASON_CATEGORIES.has(value.reasonCategory)
    && isIdentifier(value.reasonCode);
}

function isCapabilityClosure(value) {
  if (!isRecord(value)
    || !hasExactKeys(value, ["schemaVersion", "evaluatedAtMs", "status", "capabilities"])
    || value.schemaVersion !== "task-capability-closure/v1"
    || !isSafeNonNegativeInteger(value.evaluatedAtMs)
    || !CAPABILITY_STATUSES.has(value.status)
    || !isRecord(value.capabilities)
    || !hasExactKeys(value.capabilities, CAPABILITY_NAMES)) {
    return false;
  }
  return CAPABILITY_NAMES.every((name) => {
    const capability = value.capabilities[name];
    return isRecord(capability)
      && hasExactKeys(capability, ["required", "state"], ["reasonCode"])
      && typeof capability.required === "boolean"
      && CAPABILITY_STATES.has(capability.state)
      && (capability.reasonCode === undefined || isIdentifier(capability.reasonCode));
  });
}

function isSupportingEvidence(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "commandJob", "worktree", "journal", "validation",
  ].includes(key))) return false;
  return (value.commandJob === undefined || isObserved(value.commandJob, ["running", "completed", "cancelled", "failed", "lost"]))
    && (value.worktree === undefined || isWorktreeEvidence(value.worktree))
    && (value.journal === undefined || isObserved(value.journal, ["pending", "done", "error", "skipped", "uncertain"]))
    && (value.validation === undefined
      || isObserved(value.validation, ["queued", "running", "passed", "failed", "incomplete", "uncertain"], true));
}

function isWorktreeEvidence(value) {
  return isRecord(value)
    && hasExactKeys(value, ["status", "observedAtMs"], ["lifecycle"])
    && ["ready", "dirty", "conflicted", "missing", "uncertain"].includes(value.status)
    && isSafeNonNegativeInteger(value.observedAtMs)
    && (value.lifecycle === undefined || ["kept", "discard_pending", "discarded"].includes(value.lifecycle));
}

function isObserved(value, statuses, required = false) {
  return isRecord(value)
    && (required
      ? hasExactKeys(value, ["status", "observedAtMs", "required"])
      : hasExactKeys(value, ["status", "observedAtMs"]))
    && statuses.includes(value.status)
    && isSafeNonNegativeInteger(value.observedAtMs)
    && (!required || typeof value.required === "boolean");
}

function isProjectionCursor(value, epoch, revision, totalCount) {
  return isRecord(value)
    && hasExactKeys(value, ["epoch", "revision", "offset"])
    && isIdentifier(value.epoch)
    && isSafeNonNegativeInteger(value.revision)
    && isSafeNonNegativeInteger(value.offset)
    && (epoch === undefined || value.epoch.trim() === epoch.trim())
    && (revision === undefined || value.revision === revision)
    && (totalCount === undefined || (value.offset > 0 && value.offset < totalCount));
}

function isRef(value, required, optional = []) {
  return isRecord(value)
    && required.every((key) => isIdentifier(value[key]))
    && Object.keys(value).every((key) => [...required, ...optional].includes(key))
    && optional.every((key) => value[key] === undefined || isIdentifier(value[key]));
}

function isWorkspaceCheckpoint(value) {
  return isRecord(value)
    && hasExactKeys(value, ["workspaceCheckpointId", "recoveryGuarantee"])
    && isIdentifier(value.workspaceCheckpointId)
    && ["exact", "managed_worktree", "detect_only"].includes(value.recoveryGuarantee);
}

function isIdentifier(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
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

module.exports = { isTaskProjectionCollectionPage };
