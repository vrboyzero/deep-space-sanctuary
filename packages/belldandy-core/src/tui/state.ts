import type { PersistedConversationSummary } from "@belldandy/agent";
import { sanitizeCommandPermissionPreview, type CommandPermissionPreview } from "@belldandy/skills";

import type { AgentRunEvent } from "../coding-run/contracts.js";
import type {
  WorkspaceRevisionRestorePreview,
  WorkspaceRevisionRestoreResult,
  WorkspaceRevisionSummary,
} from "../workspace-revision.js";
import type {
  WorkspaceChangeSnapshot,
  WorkspaceChangeSnapshotPage,
} from "../workspace-change-snapshot.js";

export const MAX_TUI_STREAM_CHARS = 32_000;
export const MAX_TUI_CHAT_ENTRIES = 40;
export const MAX_TUI_TOOL_ENTRIES = 12;
const STREAM_TRUNCATION_MARKER = "\n[stream truncated]";

export type TuiTab = "chat" | "sessions" | "changes" | "runtime";
export type TuiRunStatus = "idle" | "starting" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type TuiConversationBinding = {
  conversationId: string;
  agentRunId: string;
};

export type TuiPermissionRequest = {
  agentRunId: string;
  toolCallId: string;
  toolName: string;
  worktreeId?: string;
  commandPreview?: CommandPermissionPreview;
};

export type TuiToolSummary = {
  id: string;
  name: string;
  status: "running" | "succeeded" | "failed";
};

export type TuiChatEntry = {
  role: "user" | "assistant";
  text: string;
};

export type TuiWorkspaceChangeSummary = {
  cwd: string;
  repoRoot?: string;
  branch?: string;
  worktree?: boolean;
  trackedChanges: number;
  untrackedChanges: number;
  conflictChanges: number;
  changedPaths: string[];
  error?: string;
};

export type TuiRuntimeSnapshot = {
  generatedAt: string;
  gatewayConnected: boolean;
  gatewayPaired: boolean;
  checks: { pass: number; warn: number; fail: number };
  agents: { total: number; running: number; error: number };
  subtasks: { total: number; active: number; failed: number };
  hints: string[];
};

export type TuiChangeSnapshotResult = {
  status: "available" | "unavailable";
  snapshot?: WorkspaceChangeSnapshot;
  page?: WorkspaceChangeSnapshotPage;
  error?: string;
};

export type TuiState = {
  cwd: string;
  tab: TuiTab;
  input: string;
  runStatus: TuiRunStatus;
  binding?: TuiConversationBinding;
  selectedConversationId?: string;
  lastSeq: number;
  chat: TuiChatEntry[];
  stream: { text: string; truncated: boolean };
  tools: TuiToolSummary[];
  pendingPermission?: TuiPermissionRequest;
  conversations: PersistedConversationSummary[];
  selectedConversationIndex: number;
  workspaceChanges?: TuiWorkspaceChangeSummary;
  changeSnapshot?: TuiChangeSnapshotResult;
  revisions: WorkspaceRevisionSummary[];
  selectedRevisionIndex: number;
  revisionPreview?: WorkspaceRevisionRestorePreview;
  restoreConfirmation?: { revisionId: string; stage: "confirm" };
  restoreResult?: WorkspaceRevisionRestoreResult;
  runtime?: TuiRuntimeSnapshot;
  busy: boolean;
  notice?: string;
};

export type TuiAction =
  | { type: "tab.selected"; tab: TuiTab }
  | { type: "input.changed"; input: string }
  | { type: "busy.changed"; busy: boolean }
  | { type: "notice.changed"; notice?: string }
  | { type: "conversation.accepted"; binding: TuiConversationBinding; prompt: string }
  | { type: "conversation.selected"; conversationId: string; chat?: TuiChatEntry[] }
  | { type: "conversations.loaded"; conversations: PersistedConversationSummary[] }
  | { type: "conversation.index.selected"; index: number }
  | { type: "run.event"; event: AgentRunEvent }
  | {
    type: "permission.resolved";
    binding: { agentRunId: string; worktreeId?: string };
    toolCallId: string;
    decision: "allow" | "deny";
  }
  | { type: "workspace.loaded"; summary: TuiWorkspaceChangeSummary }
  | { type: "change.snapshot.completed"; agentRunId: string; result: TuiChangeSnapshotResult }
  | { type: "revisions.loaded"; revisions: WorkspaceRevisionSummary[] }
  | { type: "revision.index.selected"; index: number }
  | { type: "revision.previewed"; preview: WorkspaceRevisionRestorePreview }
  | { type: "revision.restore.requested" }
  | { type: "revision.restore.cancelled" }
  | { type: "revision.restored"; result: WorkspaceRevisionRestoreResult }
  | { type: "runtime.loaded"; runtime: TuiRuntimeSnapshot };

export function createInitialTuiState(cwd: string): TuiState {
  return {
    cwd,
    tab: "chat",
    input: "",
    runStatus: "idle",
    lastSeq: 0,
    chat: [],
    stream: { text: "", truncated: false },
    tools: [],
    conversations: [],
    selectedConversationIndex: 0,
    revisions: [],
    selectedRevisionIndex: 0,
    busy: false,
  };
}

export function reduceTuiState(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "tab.selected":
      return { ...state, tab: action.tab, notice: undefined };
    case "input.changed":
      return { ...state, input: action.input };
    case "busy.changed":
      return { ...state, busy: action.busy };
    case "notice.changed":
      return { ...state, notice: action.notice };
    case "conversation.accepted":
      return {
        ...state,
        binding: { ...action.binding },
        selectedConversationId: action.binding.conversationId,
        runStatus: "starting",
        lastSeq: 0,
        input: "",
        stream: { text: "", truncated: false },
        tools: [],
        pendingPermission: undefined,
        changeSnapshot: undefined,
        restoreConfirmation: undefined,
        notice: undefined,
        chat: appendLimited(state.chat, { role: "user", text: action.prompt }, MAX_TUI_CHAT_ENTRIES),
      };
    case "conversation.selected":
      if (state.runStatus === "starting" || state.runStatus === "running") {
        return { ...state, notice: "Cancel or wait for the active run before switching conversations." };
      }
      return {
        ...state,
        selectedConversationId: action.conversationId,
        chat: action.chat ? action.chat.slice(-MAX_TUI_CHAT_ENTRIES) : state.chat,
        stream: { text: "", truncated: false },
        tools: [],
        pendingPermission: undefined,
        notice: `Conversation ${action.conversationId} selected.`,
      };
    case "conversations.loaded": {
      const conversations = action.conversations.slice(0, 100);
      return {
        ...state,
        conversations,
        selectedConversationIndex: clampIndex(state.selectedConversationIndex, conversations.length),
      };
    }
    case "conversation.index.selected":
      return {
        ...state,
        selectedConversationIndex: clampIndex(action.index, state.conversations.length),
      };
    case "run.event":
      return reduceRunEvent(state, action.event);
    case "permission.resolved": {
      const pending = state.pendingPermission;
      if (!pending
        || pending.agentRunId !== action.binding.agentRunId
        || pending.toolCallId !== action.toolCallId
        || pending.worktreeId !== action.binding.worktreeId) {
        return state;
      }
      return {
        ...state,
        pendingPermission: undefined,
        notice: action.decision === "allow" ? "Tool permission allowed." : "Tool permission denied.",
      };
    }
    case "workspace.loaded":
      return { ...state, workspaceChanges: action.summary };
    case "change.snapshot.completed":
      if (!state.binding
        || state.binding.agentRunId !== action.agentRunId) {
        return state;
      }
      return {
        ...state,
        changeSnapshot: action.result,
        notice: action.result.status === "available" ? "Run diff ready." : "Run diff unavailable.",
      };
    case "revisions.loaded": {
      const revisions = action.revisions.slice(0, 100);
      return {
        ...state,
        revisions,
        selectedRevisionIndex: clampIndex(state.selectedRevisionIndex, revisions.length),
      };
    }
    case "revision.index.selected":
      return {
        ...state,
        selectedRevisionIndex: clampIndex(action.index, state.revisions.length),
      };
    case "revision.previewed":
      return {
        ...state,
        revisionPreview: action.preview,
        restoreConfirmation: undefined,
        restoreResult: undefined,
        notice: action.preview.canRestore ? "Restore preview ready." : "Restore preview contains conflicts.",
      };
    case "revision.restore.requested":
      if (!state.revisionPreview?.canRestore) {
        return { ...state, restoreConfirmation: undefined, notice: "This revision cannot be restored safely." };
      }
      return {
        ...state,
        restoreConfirmation: { revisionId: state.revisionPreview.revisionId, stage: "confirm" },
        notice: undefined,
      };
    case "revision.restore.cancelled":
      return { ...state, restoreConfirmation: undefined, notice: "Restore cancelled." };
    case "revision.restored":
      return {
        ...state,
        restoreConfirmation: undefined,
        restoreResult: action.result,
        revisionPreview: action.result,
        notice: action.result.applied ? "Workspace revision restored." : "Restore completed without writing files.",
      };
    case "runtime.loaded":
      return { ...state, runtime: action.runtime };
  }
}

function reduceRunEvent(state: TuiState, event: AgentRunEvent): TuiState {
  if (!state.binding
    || event.binding.agentRunId !== state.binding.agentRunId
    || event.binding.conversationId !== state.binding.conversationId
    || event.seq <= state.lastSeq) {
    return state;
  }

  const base = { ...state, lastSeq: event.seq };
  if (event.type === "run.started" || event.type === "run.status") {
    return { ...base, runStatus: "running" };
  }
  if (event.type === "message.delta") {
    const delta = typeof event.payload.delta === "string" ? event.payload.delta.replace(/\u0000/g, "") : "";
    return delta ? { ...base, stream: appendStream(state.stream, delta) } : base;
  }
  if (event.type === "tool.started") {
    const tool = readTool(event.payload);
    return tool
      ? { ...base, tools: upsertTool(state.tools, { ...tool, status: "running" }) }
      : base;
  }
  if (event.type === "tool.completed") {
    const tool = readTool(event.payload);
    if (!tool) return base;
    const completed = {
      ...tool,
      status: readToolSuccess(event.payload) === false ? "failed" as const : "succeeded" as const,
    };
    const pendingPermission = state.pendingPermission?.toolCallId === tool.id
      ? undefined
      : state.pendingPermission;
    return {
      ...base,
      tools: upsertTool(state.tools, completed),
      ...(pendingPermission ? { pendingPermission } : { pendingPermission: undefined }),
    };
  }
  if (event.type === "permission.requested") {
    const permission = readPermission(event);
    return permission ? { ...base, pendingPermission: permission } : base;
  }
  if (event.type === "run.completed") {
    const output = readOutputText(event.payload);
    const nextStream = !state.stream.text && output ? appendStream(state.stream, output) : state.stream;
    return finishRun(base, "completed", nextStream);
  }
  if (event.type === "run.failed") return finishRun(base, "failed", state.stream);
  if (event.type === "run.cancelled") return finishRun(base, "cancelled", state.stream);
  if (event.type === "run.interrupted") return finishRun(base, "interrupted", state.stream);
  return base;
}

function finishRun(state: TuiState, runStatus: TuiRunStatus, stream: TuiState["stream"]): TuiState {
  const assistantEntry: TuiChatEntry = { role: "assistant", text: stream.text };
  const chat = stream.text
    ? appendLimited(state.chat, assistantEntry, MAX_TUI_CHAT_ENTRIES)
    : state.chat;
  return {
    ...state,
    runStatus,
    stream,
    chat,
    pendingPermission: undefined,
  };
}

function appendStream(stream: TuiState["stream"], delta: string): TuiState["stream"] {
  if (stream.truncated || !delta) return stream;
  if (stream.text.length + delta.length <= MAX_TUI_STREAM_CHARS) {
    return { text: `${stream.text}${delta}`, truncated: false };
  }
  const contentLimit = MAX_TUI_STREAM_CHARS - STREAM_TRUNCATION_MARKER.length;
  const existing = stream.text.slice(0, contentLimit);
  const remaining = Math.max(0, contentLimit - existing.length);
  return {
    text: `${existing}${delta.slice(0, remaining)}${STREAM_TRUNCATION_MARKER}`,
    truncated: true,
  };
}

function readTool(payload: Record<string, unknown>): Pick<TuiToolSummary, "id" | "name"> | undefined {
  const tool = isRecord(payload.tool) ? payload.tool : undefined;
  const id = readIdentifier(tool?.id);
  const name = readIdentifier(tool?.name);
  return id && name ? { id, name } : undefined;
}

function readToolSuccess(payload: Record<string, unknown>): boolean | undefined {
  const tool = isRecord(payload.tool) ? payload.tool : undefined;
  return typeof tool?.success === "boolean" ? tool.success : undefined;
}

function readPermission(event: AgentRunEvent): TuiPermissionRequest | undefined {
  const permission = isRecord(event.payload.permission) ? event.payload.permission : undefined;
  const toolCallId = readIdentifier(permission?.toolCallId);
  const toolName = readIdentifier(permission?.toolName);
  if (!toolCallId || !toolName) return undefined;
  const worktreeId = readIdentifier(permission?.worktreeId);
  const commandPreview = toolName === "run_command" || toolName === "command_job"
    ? sanitizeCommandPermissionPreview(permission?.commandPreview)
    : undefined;
  return {
    agentRunId: event.binding.agentRunId,
    toolCallId,
    toolName,
    ...(worktreeId ? { worktreeId } : {}),
    ...(commandPreview ? { commandPreview } : {}),
  };
}

function readOutputText(payload: Record<string, unknown>): string | undefined {
  const output = isRecord(payload.output) ? payload.output : undefined;
  return typeof output?.text === "string" ? output.text.replace(/\u0000/g, "") : undefined;
}

function upsertTool(tools: TuiToolSummary[], item: TuiToolSummary): TuiToolSummary[] {
  const existingIndex = tools.findIndex((tool) => tool.id === item.id);
  const next = existingIndex >= 0
    ? tools.map((tool, index) => index === existingIndex ? item : tool)
    : [...tools, item];
  return next.slice(-MAX_TUI_TOOL_ENTRIES);
}

function appendLimited<T>(items: T[], item: T, limit: number): T[] {
  return [...items, item].slice(-limit);
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length - 1));
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
