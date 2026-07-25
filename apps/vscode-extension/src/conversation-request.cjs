const path = require("node:path");

const MAX_IDENTIFIER_CHARS = 256;

function resolveWorkspaceCwd(workspace, activeDocumentUri) {
  if (activeDocumentUri && activeDocumentUri.scheme && activeDocumentUri.scheme !== "file") return undefined;
  const activeFolder = activeDocumentUri ? workspace.getWorkspaceFolder?.(activeDocumentUri) : undefined;
  const folder = activeFolder ?? workspace.workspaceFolders?.[0];
  const fsPath = folder?.uri?.fsPath;
  return typeof fsPath === "string" && path.isAbsolute(fsPath) ? path.resolve(fsPath) : undefined;
}

function readConversationBinding(value) {
  if (!isRecord(value) || !isRecord(value.binding)) return undefined;
  const conversationId = readIdentifier(value.binding.conversationId);
  const agentRunId = readIdentifier(value.binding.agentRunId);
  return conversationId && agentRunId ? { conversationId, agentRunId } : undefined;
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

module.exports = { readConversationBinding, resolveWorkspaceCwd };
