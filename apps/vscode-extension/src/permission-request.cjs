const MAX_IDENTIFIER_CHARS = 128;

function readPermissionRequest(event) {
  if (!isRecord(event) || event.type !== "permission.requested") return undefined;
  const agentRunId = readIdentifier(event.binding?.agentRunId);
  const permission = isRecord(event.payload?.permission) ? event.payload.permission : undefined;
  const toolCallId = readIdentifier(permission?.toolCallId);
  const toolName = readIdentifier(permission?.toolName);
  if (!agentRunId || !toolCallId || !toolName) return undefined;
  const worktreeId = readIdentifier(permission?.worktreeId);
  return {
    agentRunId,
    toolCallId,
    toolName,
    ...(worktreeId ? { worktreeId } : {}),
  };
}

function summarizePermissionRequest(request) {
  return `${request.toolName} (${request.toolCallId})`;
}

function isPermissionToolCompleted(event, request) {
  if (!isRecord(event) || event.type !== "tool.completed") return false;
  if (event.binding?.agentRunId !== request.agentRunId) return false;
  return event.payload?.tool?.id === request.toolCallId;
}

function readIdentifier(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_CHARS || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  isPermissionToolCompleted,
  readPermissionRequest,
  summarizePermissionRequest,
};
