import type { PersistedConversationSummary } from "@belldandy/agent";
import {
  sanitizeCommandPermissionPreview,
  type CommandJobReadResult,
  type CommandJobSnapshot,
  type CommandPermissionPreview,
} from "@belldandy/skills";

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
import type {
  RemoteDeliveryPreview,
  RemoteDeliveryResult,
  RemoteDeliveryTarget,
} from "../remote-delivery-runtime.js";

export const MAX_TUI_STREAM_CHARS = 32_000;
export const MAX_TUI_CHAT_ENTRIES = 40;
export const MAX_TUI_TOOL_ENTRIES = 12;
const MAX_TUI_PENDING_PERMISSIONS = 100;
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

export type TuiWorkspaceTarget = {
  targetKey: string;
  kind: "launch" | "managed";
  cwd: string;
  worktreeId?: string;
  branch?: string;
  status: "ready" | "blocked" | "unavailable";
  dirty?: boolean;
  trackedChanges?: number;
  untrackedChanges?: number;
  conflictChanges?: number;
  extraCommitCount?: number;
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
  pendingPermissions: TuiPermissionRequest[];
  selectedPermissionIndex: number;
  resolvedPermissionKeys: string[];
  permissionRevision: number;
  conversations: PersistedConversationSummary[];
  selectedConversationIndex: number;
  changesFocus: "worktrees" | "revisions";
  workspaceTargets: TuiWorkspaceTarget[];
  selectedWorkspaceTargetIndex: number;
  workspaceChanges?: TuiWorkspaceChangeSummary;
  changeSnapshot?: TuiChangeSnapshotResult;
  changeHunkIndex: number;
  changeHunkPageCursors: string[];
  revisions: WorkspaceRevisionSummary[];
  selectedRevisionIndex: number;
  revisionPreview?: WorkspaceRevisionRestorePreview;
  restoreConfirmation?: { revisionId: string; stage: "confirm" };
  restoreResult?: WorkspaceRevisionRestoreResult;
  remoteDeliveryTargets: RemoteDeliveryTarget[];
  remoteDeliveryPreview?: RemoteDeliveryPreview;
  remoteDeliveryConfirmation?: { receiptId: string };
  remoteDeliveryResult?: RemoteDeliveryResult;
  runtime?: TuiRuntimeSnapshot;
  commandJobs: CommandJobSnapshot[];
  selectedCommandJobIndex: number;
  commandJobOutput?: CommandJobReadResult;
  commandJobPageCursors: number[];
  commandJobCancelConfirmation?: { jobId: string; stage: "confirm" };
  busy: boolean;
  notice?: string;
};

export type TuiAction =
  | { type: "tab.selected"; tab: TuiTab }
  | { type: "input.changed"; input: string }
  | { type: "busy.changed"; busy: boolean }
  | { type: "notice.changed"; notice?: string }
  | { type: "conversation.accepted"; binding: TuiConversationBinding; prompt: string }
  | { type: "conversation.steered"; binding: TuiConversationBinding; prompt: string }
  | { type: "conversation.selected"; conversationId: string; chat?: TuiChatEntry[] }
  | { type: "conversations.loaded"; conversations: PersistedConversationSummary[] }
  | { type: "conversation.index.selected"; index: number }
  | { type: "run.event"; event: AgentRunEvent }
  | { type: "permissions.loaded"; permissions: TuiPermissionRequest[]; baseRevision: number }
  | { type: "permission.index.selected"; index: number }
  | {
    type: "permission.resolved";
    binding: { agentRunId: string; worktreeId?: string };
    toolCallId: string;
    decision: "allow" | "deny";
  }
  | { type: "changes.focus.selected"; focus: "worktrees" | "revisions" }
  | { type: "workspace.targets.loaded"; targets: TuiWorkspaceTarget[]; expectedCwd: string }
  | { type: "workspace.target.index.selected"; index: number }
  | {
    type: "workspace.switched";
    previousCwd: string;
    targetKey: string;
    target: TuiWorkspaceTarget;
  }
  | { type: "workspace.loaded"; summary: TuiWorkspaceChangeSummary; expectedCwd?: string }
  | { type: "change.snapshot.completed"; agentRunId: string; result: TuiChangeSnapshotResult; cwd?: string }
  | {
    type: "change.hunk.navigated";
    direction: "next" | "previous";
    cursor?: string;
    page: WorkspaceChangeSnapshotPage;
  }
  | { type: "revisions.loaded"; revisions: WorkspaceRevisionSummary[]; expectedCwd?: string }
  | { type: "revision.index.selected"; index: number }
  | { type: "revision.previewed"; preview: WorkspaceRevisionRestorePreview }
  | { type: "revision.restore.requested" }
  | { type: "revision.restore.cancelled" }
  | { type: "revision.restored"; result: WorkspaceRevisionRestoreResult }
  | { type: "remote-delivery.targets.loaded"; targets: RemoteDeliveryTarget[]; expectedCwd: string }
  | { type: "remote-delivery.push.previewed"; preview: RemoteDeliveryPreview }
  | { type: "remote-delivery.push.requested" }
  | { type: "remote-delivery.push.cancelled" }
  | { type: "remote-delivery.push.completed"; result: RemoteDeliveryResult }
  | { type: "command.jobs.loaded"; jobs: CommandJobSnapshot[] }
  | { type: "command.job.index.selected"; index: number }
  | { type: "command.job.output.loaded"; jobId: string; page: CommandJobReadResult }
  | {
    type: "command.job.output.page.navigated";
    direction: "next" | "previous";
    jobId: string;
    cursor: number;
    page: CommandJobReadResult;
  }
  | { type: "command.job.cancel.requested"; jobId: string }
  | { type: "command.job.cancel.dismissed" }
  | { type: "command.job.cancelled"; jobId: string; snapshot: CommandJobSnapshot }
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
    pendingPermissions: [],
    selectedPermissionIndex: 0,
    resolvedPermissionKeys: [],
    permissionRevision: 0,
    conversations: [],
    selectedConversationIndex: 0,
    changesFocus: "revisions",
    workspaceTargets: [{ targetKey: "launch", kind: "launch", cwd, status: "ready" }],
    selectedWorkspaceTargetIndex: 0,
    changeHunkIndex: 0,
    changeHunkPageCursors: [],
    revisions: [],
    selectedRevisionIndex: 0,
    remoteDeliveryTargets: [],
    commandJobs: [],
    selectedCommandJobIndex: 0,
    commandJobPageCursors: [],
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
        changeSnapshot: undefined,
        changeHunkIndex: 0,
        changeHunkPageCursors: [],
        restoreConfirmation: undefined,
        notice: undefined,
        chat: appendLimited(state.chat, { role: "user", text: action.prompt }, MAX_TUI_CHAT_ENTRIES),
      };
    case "conversation.steered":
      if (!state.binding
        || state.binding.conversationId !== action.binding.conversationId
        || state.binding.agentRunId !== action.binding.agentRunId) {
        return state;
      }
      return {
        ...state,
        input: state.input.trim() === action.prompt ? "" : state.input,
        notice: "Steer queued for the active run.",
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
    case "permissions.loaded": {
      const selectedKey = permissionKey(state.pendingPermissions[state.selectedPermissionIndex]);
      const resolved = new Set(state.resolvedPermissionKeys);
      const pendingPermissions: TuiPermissionRequest[] = [];
      const seen = new Set<string>();
      const candidates = action.baseRevision === state.permissionRevision
        ? action.permissions
        : [...action.permissions, ...state.pendingPermissions];
      for (const candidate of candidates) {
        const permission = sanitizeTuiPermission(candidate);
        const key = permissionKey(permission);
        if (!permission || !key || resolved.has(key) || seen.has(key)) continue;
        seen.add(key);
        pendingPermissions.push(permission);
        if (pendingPermissions.length >= MAX_TUI_PENDING_PERMISSIONS) break;
      }
      const retainedIndex = selectedKey
        ? pendingPermissions.findIndex((permission) => permissionKey(permission) === selectedKey)
        : -1;
      return {
        ...state,
        pendingPermissions,
        selectedPermissionIndex: retainedIndex >= 0
          ? retainedIndex
          : clampIndex(state.selectedPermissionIndex, pendingPermissions.length),
        permissionRevision: state.permissionRevision + 1,
      };
    }
    case "permission.index.selected":
      return {
        ...state,
        selectedPermissionIndex: clampIndex(action.index, state.pendingPermissions.length),
      };
    case "permission.resolved": {
      const key = permissionKey({ ...action.binding, toolCallId: action.toolCallId });
      const resolvedIndex = state.pendingPermissions.findIndex((permission) => permissionKey(permission) === key);
      if (!key || resolvedIndex < 0) return state;
      const selectedKey = permissionKey(state.pendingPermissions[state.selectedPermissionIndex]);
      const pendingPermissions = state.pendingPermissions.filter((_permission, index) => index !== resolvedIndex);
      const retainedIndex = selectedKey
        ? pendingPermissions.findIndex((permission) => permissionKey(permission) === selectedKey)
        : -1;
      return {
        ...state,
        pendingPermissions,
        selectedPermissionIndex: retainedIndex >= 0
          ? retainedIndex
          : clampIndex(state.selectedPermissionIndex, pendingPermissions.length),
        resolvedPermissionKeys: appendUniqueLimited(
          state.resolvedPermissionKeys,
          key,
          MAX_TUI_PENDING_PERMISSIONS,
        ),
        permissionRevision: state.permissionRevision + 1,
        notice: action.decision === "allow" ? "Tool permission allowed." : "Tool permission denied.",
      };
    }
    case "changes.focus.selected":
      return { ...state, changesFocus: action.focus };
    case "workspace.targets.loaded": {
      if (action.expectedCwd !== state.cwd) return state;
      const targets = sanitizeWorkspaceTargets(action.targets);
      if (targets.length === 0) return state;
      const selectedKey = state.workspaceTargets[state.selectedWorkspaceTargetIndex]?.targetKey;
      const currentIndex = targets.findIndex((target) => target.cwd === state.cwd);
      const retainedIndex = selectedKey
        ? targets.findIndex((target) => target.targetKey === selectedKey)
        : -1;
      return {
        ...state,
        workspaceTargets: targets,
        selectedWorkspaceTargetIndex: currentIndex >= 0
          ? currentIndex
          : retainedIndex >= 0
            ? retainedIndex
            : clampIndex(state.selectedWorkspaceTargetIndex, targets.length),
      };
    }
    case "workspace.target.index.selected":
      return {
        ...state,
        selectedWorkspaceTargetIndex: clampIndex(action.index, state.workspaceTargets.length),
      };
    case "workspace.switched": {
      if (state.cwd !== action.previousCwd) return state;
      if (state.runStatus === "starting" || state.runStatus === "running") {
        return { ...state, notice: "Cancel or wait for the active run before switching workspaces." };
      }
      const target = sanitizeWorkspaceTarget(action.target);
      if (!target || target.status === "unavailable"
        || target.targetKey !== action.targetKey) {
        return state;
      }
      const existingIndex = state.workspaceTargets.findIndex(
        (candidate) => candidate.targetKey === target.targetKey,
      );
      const workspaceTargets = existingIndex >= 0
        ? state.workspaceTargets.map((candidate) => candidate.targetKey === target.targetKey ? target : candidate)
        : [target, ...state.workspaceTargets].slice(0, 100);
      return {
        ...state,
        cwd: target.cwd,
        workspaceTargets,
        selectedWorkspaceTargetIndex: existingIndex >= 0 ? existingIndex : 0,
        workspaceChanges: undefined,
        changeSnapshot: undefined,
        changeHunkIndex: 0,
        changeHunkPageCursors: [],
        revisions: [],
        selectedRevisionIndex: 0,
        revisionPreview: undefined,
        restoreConfirmation: undefined,
        restoreResult: undefined,
        remoteDeliveryTargets: [],
        remoteDeliveryPreview: undefined,
        remoteDeliveryConfirmation: undefined,
        remoteDeliveryResult: undefined,
        notice: `Workspace ${target.targetKey} selected.`,
      };
    }
    case "workspace.loaded":
      if ((action.expectedCwd && action.expectedCwd !== state.cwd) || action.summary.cwd !== state.cwd) return state;
      return { ...state, workspaceChanges: action.summary };
    case "remote-delivery.targets.loaded":
      if (action.expectedCwd !== state.cwd) return state;
      return {
        ...state,
        remoteDeliveryTargets: action.targets.slice(0, 50),
        remoteDeliveryPreview: undefined,
        remoteDeliveryConfirmation: undefined,
      };
    case "remote-delivery.push.previewed":
      return {
        ...state,
        remoteDeliveryPreview: action.preview,
        remoteDeliveryConfirmation: undefined,
        notice: action.preview.canConfirm ? "Remote push preview ready." : `Remote push blocked: ${action.preview.blockers.join(", ")}`,
      };
    case "remote-delivery.push.requested": {
      const receiptId = state.remoteDeliveryPreview?.canConfirm
        ? state.remoteDeliveryPreview.receipt?.receiptId
        : undefined;
      return receiptId
        ? { ...state, remoteDeliveryConfirmation: { receiptId } }
        : { ...state, remoteDeliveryConfirmation: undefined, notice: "A confirmable remote push preview is required." };
    }
    case "remote-delivery.push.cancelled":
      return { ...state, remoteDeliveryConfirmation: undefined, notice: "Remote push cancelled." };
    case "remote-delivery.push.completed":
      return {
        ...state,
        remoteDeliveryConfirmation: undefined,
        remoteDeliveryResult: action.result,
        notice: action.result.applied
          ? "Remote push verified."
          : `Remote push blocked: ${action.result.blockers.join(", ")}`,
      };
    case "change.snapshot.completed":
      if (!state.binding
        || state.binding.agentRunId !== action.agentRunId
        || (action.cwd && action.cwd !== state.cwd)) {
        return state;
      }
      return {
        ...state,
        changeSnapshot: action.result,
        changeHunkIndex: 0,
        changeHunkPageCursors: [],
        notice: action.result.status === "available" ? "Run diff ready." : "Run diff unavailable.",
      };
    case "change.hunk.navigated": {
      const result = state.changeSnapshot;
      if (!result || result.status !== "available" || !result.snapshot || !result.page
        || action.page.snapshotId !== result.snapshot.snapshotId
        || action.page.diffHash !== result.snapshot.diffHash
        || action.page.hunks.length !== 1) {
        return state;
      }
      const snapshot = result.snapshot;
      const currentPage = result.page;
      if (action.direction === "next") {
        if (!action.cursor
          || currentPage.nextCursor !== action.cursor
          || state.changeHunkIndex >= snapshot.hunkCount - 1) {
          return state;
        }
        return {
          ...state,
          changeSnapshot: { ...result, page: action.page },
          changeHunkIndex: state.changeHunkIndex + 1,
          changeHunkPageCursors: [...state.changeHunkPageCursors, action.cursor],
          notice: undefined,
        };
      }
      if (state.changeHunkIndex <= 0) return state;
      const expectedCursor = state.changeHunkIndex === 1
        ? undefined
        : state.changeHunkPageCursors[state.changeHunkIndex - 2];
      if (action.cursor !== expectedCursor) return state;
      return {
        ...state,
        changeSnapshot: { ...result, page: action.page },
        changeHunkIndex: state.changeHunkIndex - 1,
        changeHunkPageCursors: state.changeHunkPageCursors.slice(0, -1),
        notice: undefined,
      };
    }
    case "revisions.loaded": {
      if (action.expectedCwd && action.expectedCwd !== state.cwd) return state;
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
    case "command.jobs.loaded": {
      const jobs = action.jobs.slice(0, 80).map((incoming) => {
        const current = state.commandJobs.find((job) => job.jobId === incoming.jobId);
        return current && isStaleCommandJobSnapshot(current, incoming) ? current : incoming;
      });
      const selectedJobId = state.commandJobs[state.selectedCommandJobIndex]?.jobId;
      const retainedIndex = selectedJobId ? jobs.findIndex((job) => job.jobId === selectedJobId) : -1;
      const selectedCommandJobIndex = retainedIndex >= 0
        ? retainedIndex
        : clampIndex(state.selectedCommandJobIndex, jobs.length);
      const nextSelectedJobId = jobs[selectedCommandJobIndex]?.jobId;
      const retainsOutput = Boolean(nextSelectedJobId && state.commandJobOutput?.jobId === nextSelectedJobId);
      return {
        ...state,
        commandJobs: jobs,
        selectedCommandJobIndex,
        commandJobOutput: retainsOutput ? state.commandJobOutput : undefined,
        commandJobPageCursors: retainsOutput ? state.commandJobPageCursors : [],
        commandJobCancelConfirmation: undefined,
      };
    }
    case "command.job.index.selected": {
      const selectedCommandJobIndex = clampIndex(action.index, state.commandJobs.length);
      if (selectedCommandJobIndex === state.selectedCommandJobIndex) return state;
      return {
        ...state,
        selectedCommandJobIndex,
        commandJobOutput: undefined,
        commandJobPageCursors: [],
        commandJobCancelConfirmation: undefined,
      };
    }
    case "command.job.output.loaded": {
      const selected = state.commandJobs[state.selectedCommandJobIndex];
      if (!selected
        || selected.jobId !== action.jobId
        || action.page.jobId !== action.jobId
        || isStaleCommandJobSnapshot(selected, action.page)) {
        return state;
      }
      return {
        ...state,
        commandJobs: state.commandJobs.map((job) => job.jobId === action.jobId ? commandJobSnapshotFromPage(action.page) : job),
        commandJobOutput: action.page,
        commandJobPageCursors: [action.page.startCursor],
      };
    }
    case "command.job.output.page.navigated": {
      const selected = state.commandJobs[state.selectedCommandJobIndex];
      const current = state.commandJobOutput;
      if (!selected
        || selected.jobId !== action.jobId
        || !current
        || current.jobId !== action.jobId
        || action.page.jobId !== action.jobId
        || isStaleCommandJobSnapshot(selected, action.page)
        || (action.page.startCursor !== action.cursor && !action.page.cursorExpired && !action.page.cursorAdjusted)) {
        return state;
      }
      let commandJobPageCursors: number[];
      if (action.direction === "next") {
        if (!current.hasMore || current.nextCursor !== action.cursor) return state;
        commandJobPageCursors = action.page.cursorExpired
          ? [action.page.startCursor]
          : [...state.commandJobPageCursors, action.page.startCursor];
      } else {
        if (state.commandJobPageCursors.length <= 1
          || state.commandJobPageCursors[state.commandJobPageCursors.length - 2] !== action.cursor) {
          return state;
        }
        commandJobPageCursors = action.page.cursorExpired
          ? [action.page.startCursor]
          : state.commandJobPageCursors.slice(0, -1);
      }
      return {
        ...state,
        commandJobs: state.commandJobs.map((job) => job.jobId === action.jobId ? commandJobSnapshotFromPage(action.page) : job),
        commandJobOutput: action.page,
        commandJobPageCursors,
      };
    }
    case "command.job.cancel.requested": {
      const selected = state.commandJobs[state.selectedCommandJobIndex];
      if (!selected || selected.jobId !== action.jobId || selected.status !== "running") return state;
      return {
        ...state,
        commandJobCancelConfirmation: { jobId: action.jobId, stage: "confirm" },
        notice: undefined,
      };
    }
    case "command.job.cancel.dismissed":
      return { ...state, commandJobCancelConfirmation: undefined, notice: "Command job cancellation dismissed." };
    case "command.job.cancelled": {
      if (!state.commandJobCancelConfirmation
        || state.commandJobCancelConfirmation.jobId !== action.jobId
        || action.snapshot.jobId !== action.jobId
        || action.snapshot.status === "running") {
        return state;
      }
      return {
        ...state,
        commandJobs: state.commandJobs.map((job) => job.jobId === action.jobId ? action.snapshot : job),
        commandJobCancelConfirmation: undefined,
        notice: `Command job ${action.snapshot.status}.`,
      };
    }
    case "runtime.loaded":
      return { ...state, runtime: action.runtime };
  }
}

function commandJobSnapshotFromPage(page: CommandJobReadResult): CommandJobSnapshot {
  const { output: _output, startCursor: _startCursor, hasMore: _hasMore, cursorExpired: _cursorExpired, cursorAdjusted: _cursorAdjusted, ...snapshot } = page;
  return snapshot;
}

function isStaleCommandJobSnapshot(current: CommandJobSnapshot, incoming: CommandJobSnapshot): boolean {
  if (current.status !== "running" && incoming.status === "running") return true;
  if (current.status === "running" && incoming.status !== "running") return false;
  return incoming.updatedAt < current.updatedAt;
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
    const completedKey = permissionKey({
      agentRunId: event.binding.agentRunId,
      ...(event.binding.worktreeId ? { worktreeId: event.binding.worktreeId } : {}),
      toolCallId: tool.id,
    });
    const completedIndex = state.pendingPermissions.findIndex((permission) => permissionKey(permission) === completedKey);
    const pendingPermissions = completedIndex >= 0
      ? state.pendingPermissions.filter((_permission, index) => index !== completedIndex)
      : state.pendingPermissions;
    return {
      ...base,
      tools: upsertTool(state.tools, completed),
      pendingPermissions,
      selectedPermissionIndex: retainPermissionSelectionIndex(state, pendingPermissions),
      resolvedPermissionKeys: completedKey && completedIndex >= 0
        ? appendUniqueLimited(state.resolvedPermissionKeys, completedKey, MAX_TUI_PENDING_PERMISSIONS)
        : state.resolvedPermissionKeys,
      permissionRevision: completedIndex >= 0
        ? state.permissionRevision + 1
        : state.permissionRevision,
    };
  }
  if (event.type === "permission.requested") {
    const permission = readPermission(event);
    const key = permissionKey(permission);
    if (!permission || !key || state.resolvedPermissionKeys.includes(key)) return base;
    const existingIndex = state.pendingPermissions.findIndex((pending) => permissionKey(pending) === key);
    const pendingPermissions = existingIndex >= 0
      ? state.pendingPermissions.map((pending, index) => index === existingIndex ? permission : pending)
      : [...state.pendingPermissions, permission].slice(0, MAX_TUI_PENDING_PERMISSIONS);
    return { ...base, pendingPermissions, permissionRevision: state.permissionRevision + 1 };
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
  const resolved = state.pendingPermissions.filter((permission) => permission.agentRunId === state.binding?.agentRunId);
  const pendingPermissions = state.pendingPermissions.filter((permission) => permission.agentRunId !== state.binding?.agentRunId);
  return {
    ...state,
    runStatus,
    stream,
    chat,
    pendingPermissions,
    selectedPermissionIndex: retainPermissionSelectionIndex(state, pendingPermissions),
    resolvedPermissionKeys: resolved.reduce(
      (keys, permission) => {
        const key = permissionKey(permission);
        return key ? appendUniqueLimited(keys, key, MAX_TUI_PENDING_PERMISSIONS) : keys;
      },
      state.resolvedPermissionKeys,
    ),
    permissionRevision: resolved.length > 0
      ? state.permissionRevision + 1
      : state.permissionRevision,
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

function appendUniqueLimited(items: string[], item: string, limit: number): string[] {
  return [...items.filter((value) => value !== item), item].slice(-limit);
}

function sanitizeWorkspaceTargets(values: TuiWorkspaceTarget[]): TuiWorkspaceTarget[] {
  const targets: TuiWorkspaceTarget[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const target = sanitizeWorkspaceTarget(value);
    if (!target || seen.has(target.targetKey)) continue;
    seen.add(target.targetKey);
    targets.push(target);
    if (targets.length >= 100) break;
  }
  return targets;
}

function sanitizeWorkspaceTarget(value: TuiWorkspaceTarget | undefined): TuiWorkspaceTarget | undefined {
  if (!value
    || !readIdentifier(value.targetKey)
    || !readIdentifier(value.cwd)
    || (value.kind !== "launch" && value.kind !== "managed")
    || (value.status !== "ready" && value.status !== "blocked" && value.status !== "unavailable")) {
    return undefined;
  }
  if (value.kind === "launch" && value.targetKey !== "launch") return undefined;
  const worktreeId = readIdentifier(value.worktreeId);
  if (value.kind === "managed" && (!worktreeId || value.targetKey !== `worktree:${worktreeId}`)) return undefined;
  return {
    targetKey: value.targetKey,
    kind: value.kind,
    cwd: value.cwd,
    ...(worktreeId ? { worktreeId } : {}),
    ...(readIdentifier(value.branch) ? { branch: value.branch } : {}),
    status: value.status,
    ...(typeof value.dirty === "boolean" ? { dirty: value.dirty } : {}),
    ...copyWorkspaceTargetCount(value, "trackedChanges"),
    ...copyWorkspaceTargetCount(value, "untrackedChanges"),
    ...copyWorkspaceTargetCount(value, "conflictChanges"),
    ...copyWorkspaceTargetCount(value, "extraCommitCount"),
  };
}

function copyWorkspaceTargetCount(
  value: TuiWorkspaceTarget,
  field: "trackedChanges" | "untrackedChanges" | "conflictChanges" | "extraCommitCount",
): Partial<TuiWorkspaceTarget> {
  const count = value[field];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? { [field]: count } : {};
}

function sanitizeTuiPermission(value: TuiPermissionRequest | undefined): TuiPermissionRequest | undefined {
  if (!value) return undefined;
  const agentRunId = readIdentifier(value.agentRunId);
  const toolCallId = readIdentifier(value.toolCallId);
  const toolName = readIdentifier(value.toolName);
  if (!agentRunId || !toolCallId || !toolName) return undefined;
  const worktreeId = readIdentifier(value.worktreeId);
  const commandPreview = toolName === "run_command" || toolName === "command_job"
    ? sanitizeCommandPermissionPreview(value.commandPreview)
    : undefined;
  return {
    agentRunId,
    toolCallId,
    toolName,
    ...(worktreeId ? { worktreeId } : {}),
    ...(commandPreview ? { commandPreview } : {}),
  };
}

function permissionKey(value: {
  agentRunId?: string;
  worktreeId?: string;
  toolCallId?: string;
} | undefined): string | undefined {
  return value?.agentRunId && value.toolCallId
    ? `${value.agentRunId}\u0000${value.worktreeId ?? ""}\u0000${value.toolCallId}`
    : undefined;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length - 1));
}

function retainPermissionSelectionIndex(state: TuiState, pendingPermissions: TuiPermissionRequest[]): number {
  const selectedKey = permissionKey(state.pendingPermissions[state.selectedPermissionIndex]);
  const retainedIndex = selectedKey
    ? pendingPermissions.findIndex((permission) => permissionKey(permission) === selectedKey)
    : -1;
  return retainedIndex >= 0
    ? retainedIndex
    : clampIndex(state.selectedPermissionIndex, pendingPermissions.length);
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
