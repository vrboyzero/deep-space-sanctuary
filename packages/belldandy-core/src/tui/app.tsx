import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, usePaste, useStdin, useStdout } from "ink";

import { toSafeCodingRunErrorMessage, type AgentRunEvent } from "../coding-run/contracts.js";
import type { WorkspaceChangeRecovery } from "../workspace-change-recovery.js";
import {
  acquireTuiMouseMode,
  parseTuiMouseInput,
  resolveTuiInputAction,
  resolveTuiMouseAction,
  sanitizeTuiTextInput,
  TUI_TABS,
  type TuiInputAction,
  type TuiInputContext,
  type TuiModal,
} from "./input.js";
import type { CodingTuiRuntime } from "./runtime.js";
import {
  createInitialTuiState,
  reduceTuiState,
  type TuiState,
  type TuiTab,
} from "./state.js";
import { formatTuiTimestamp, toLeadingVisibleLines, toVisibleLines, truncateTuiIdentifier } from "./view.js";

const MAX_INPUT_CHARS = 64_000;
const MAX_DIFF_VIEW_CHARS = 16_000;

export function CodingTuiApp(input: {
  runtime: CodingTuiRuntime;
  onEventRegistration: (handler: (event: AgentRunEvent) => void) => void;
  onErrorRegistration: (handler: (message: string) => void) => void;
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState(() => readDimensions(stdout));
  const [state, dispatch] = useReducer(reduceTuiState, createInitialTuiState(input.runtime.cwd));
  const [modalChoice, setModalChoice] = useState(0);
  const selectedPermission = state.pendingPermissions[state.selectedPermissionIndex];
  const cancelRequestedRunId = useRef<string | undefined>(undefined);
  const permissionResponseInFlight = useRef<string | undefined>(undefined);
  const permissionRevisionRef = useRef(state.permissionRevision);
  permissionRevisionRef.current = state.permissionRevision;
  const steerRequestInFlight = useRef(false);
  const hunkNavigationInFlight = useRef(false);
  const commandJobReadInFlight = useRef<string | undefined>(undefined);
  const commandJobNavigationInFlight = useRef(false);
  const commandJobCancelInFlight = useRef(false);
  const workspaceSwitchInFlight = useRef<string | undefined>(undefined);

  useEffect(() => {
    const update = () => setDimensions(readDimensions(stdout));
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  useEffect(() => {
    const mouseMode = acquireTuiMouseMode({
      stdinIsTTY: isRawModeSupported,
      stdout,
      env: process.env,
    });
    return mouseMode.release;
  }, [isRawModeSupported, stdout]);

  const runTask = useCallback(async (task: () => Promise<void>) => {
    dispatch({ type: "busy.changed", busy: true });
    try {
      await task();
    } catch (error) {
      dispatch({ type: "notice.changed", notice: toSafeCodingRunErrorMessage(error) });
    } finally {
      dispatch({ type: "busy.changed", busy: false });
    }
  }, []);

  useEffect(() => {
    input.onEventRegistration((event) => {
      dispatch({ type: "run.event", event });
      if (!isTerminalRunEvent(event)) return;
      const workspaceCwd = input.runtime.cwd;
      void input.runtime.completeChangeSnapshot(event.binding.agentRunId)
        .then((result) => {
          if (result) dispatch({
            type: "change.snapshot.completed",
            agentRunId: event.binding.agentRunId,
            cwd: workspaceCwd,
            result,
          });
        })
        .catch(() => dispatch({ type: "notice.changed", notice: "Run diff unavailable." }));
    });
    input.onErrorRegistration((message) => dispatch({ type: "notice.changed", notice: message }));
  }, [input]);

  const refreshSessions = useCallback(async () => {
    const conversations = await input.runtime.listConversations();
    dispatch({ type: "conversations.loaded", conversations });
  }, [input.runtime]);

  const refreshChanges = useCallback(async () => {
    const expectedCwd = input.runtime.cwd;
    const remoteTargetsPromise = typeof input.runtime.listRemoteDeliveryTargets === "function"
      ? input.runtime.listRemoteDeliveryTargets().catch(() => [])
      : Promise.resolve([]);
    const [summary, revisions, remoteTargets] = await Promise.all([
      input.runtime.inspectWorkspace(),
      input.runtime.listRevisions(),
      remoteTargetsPromise,
    ]);
    dispatch({ type: "workspace.loaded", summary, expectedCwd });
    dispatch({ type: "revisions.loaded", revisions, expectedCwd });
    dispatch({ type: "remote-delivery.targets.loaded", targets: remoteTargets, expectedCwd });
  }, [input.runtime]);

  const refreshRuntime = useCallback(async () => {
    const runtime = await input.runtime.loadRuntimeSnapshot();
    dispatch({ type: "runtime.loaded", runtime });
    if (!runtime.gatewayConnected || !runtime.gatewayPaired) {
      dispatch({ type: "command.jobs.loaded", jobs: [] });
      return;
    }
    const permissionBaseRevision = permissionRevisionRef.current;
    const expectedCwd = input.runtime.cwd;
    const [jobs, permissions, targets] = await Promise.all([
      input.runtime.listCommandJobs(),
      input.runtime.listPendingPermissions(),
      input.runtime.listWorkspaceTargets().catch(() => undefined),
    ]);
    dispatch({ type: "command.jobs.loaded", jobs });
    dispatch({ type: "permissions.loaded", permissions, baseRevision: permissionBaseRevision });
    if (targets) dispatch({ type: "workspace.targets.loaded", targets, expectedCwd });
  }, [input.runtime]);

  useEffect(() => {
    void runTask(async () => {
      const results = await Promise.allSettled([refreshSessions(), refreshChanges(), refreshRuntime()]);
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    });
  }, [refreshChanges, refreshRuntime, refreshSessions, runTask]);

  useEffect(() => {
    if (state.tab === "sessions") void runTask(refreshSessions);
    if (state.tab === "changes") void runTask(refreshChanges);
    if (state.tab === "runtime") void runTask(refreshRuntime);
  }, [refreshChanges, refreshRuntime, refreshSessions, runTask, state.tab]);

  useEffect(() => {
    setModalChoice(0);
  }, [
    selectedPermission?.agentRunId,
    selectedPermission?.toolCallId,
    selectedPermission?.worktreeId,
    state.restoreConfirmation?.revisionId,
    state.commandJobCancelConfirmation?.jobId,
    state.remoteDeliveryConfirmation?.receiptId,
  ]);

  const selectedCommandJob = state.commandJobs[state.selectedCommandJobIndex];
  useEffect(() => {
    const jobId = selectedCommandJob?.jobId;
    if (state.tab !== "runtime" || !jobId || state.commandJobOutput?.jobId === jobId
      || commandJobReadInFlight.current === jobId) {
      return;
    }
    commandJobReadInFlight.current = jobId;
    void input.runtime.readCommandJob(jobId)
      .then((page) => dispatch({ type: "command.job.output.loaded", jobId, page }))
      .catch((error) => dispatch({ type: "notice.changed", notice: toSafeCodingRunErrorMessage(error) }))
      .finally(() => {
        if (commandJobReadInFlight.current === jobId) commandJobReadInFlight.current = undefined;
      });
  }, [input.runtime, selectedCommandJob?.jobId, state.commandJobOutput?.jobId, state.tab]);

  useEffect(() => {
    const active = state.runStatus === "starting" || state.runStatus === "running";
    if (!active || cancelRequestedRunId.current !== state.binding?.agentRunId) {
      cancelRequestedRunId.current = undefined;
    }
  }, [state.binding?.agentRunId, state.runStatus]);

  const sendPrompt = useCallback(async () => {
    const prompt = state.input.trim();
    if (!prompt || state.busy) return;
    if (state.runStatus === "starting" || state.runStatus === "running") {
      const binding = state.binding;
      if (!binding || steerRequestInFlight.current) return;
      steerRequestInFlight.current = true;
      try {
        await runTask(async () => {
          await input.runtime.steer(binding, prompt);
          dispatch({ type: "conversation.steered", binding, prompt });
        });
      } finally {
        steerRequestInFlight.current = false;
      }
      return;
    }
    await runTask(async () => {
      const binding = await input.runtime.requestConversation(prompt, state.selectedConversationId);
      dispatch({ type: "conversation.accepted", binding, prompt });
    });
  }, [input.runtime, runTask, state.binding, state.busy, state.input, state.runStatus, state.selectedConversationId]);

  const chooseConversation = useCallback(async () => {
    const selected = state.conversations[state.selectedConversationIndex];
    if (!selected) return;
    await runTask(async () => {
      const chat = await input.runtime.loadConversationChat(selected.conversationId);
      dispatch({ type: "conversation.selected", conversationId: selected.conversationId, chat });
      dispatch({ type: "tab.selected", tab: "chat" });
    });
  }, [input.runtime, runTask, state.conversations, state.selectedConversationIndex]);

  const previewRevision = useCallback(async () => {
    const revision = state.revisions[state.selectedRevisionIndex];
    if (!revision) return;
    if (state.revisionPreview?.revisionId === revision.revisionId) {
      dispatch({ type: "revision.restore.requested" });
      return;
    }
    await runTask(async () => {
      const preview = await input.runtime.previewRevision(revision.revisionId, revision.workspaceId);
      dispatch({ type: "revision.previewed", preview });
    });
  }, [input.runtime, runTask, state.revisionPreview?.revisionId, state.revisions, state.selectedRevisionIndex]);

  const chooseWorkspace = useCallback(async () => {
    const target = state.workspaceTargets[state.selectedWorkspaceTargetIndex];
    if (!target || state.busy || workspaceSwitchInFlight.current) return;
    if (state.runStatus === "starting" || state.runStatus === "running") {
      dispatch({ type: "notice.changed", notice: "Cancel or wait for the active run before switching workspaces." });
      return;
    }
    if (target.status === "unavailable") {
      dispatch({ type: "notice.changed", notice: "The selected managed worktree is unavailable." });
      return;
    }
    if (target.cwd === state.cwd) {
      dispatch({ type: "notice.changed", notice: "The selected workspace is already active." });
      return;
    }
    const previousCwd = state.cwd;
    workspaceSwitchInFlight.current = target.targetKey;
    try {
      await runTask(async () => {
        const resolved = await input.runtime.switchWorkspace(target.targetKey);
        dispatch({
          type: "workspace.switched",
          previousCwd,
          targetKey: target.targetKey,
          target: resolved,
        });
        await refreshChanges();
        const targets = await input.runtime.listWorkspaceTargets();
        dispatch({ type: "workspace.targets.loaded", targets, expectedCwd: resolved.cwd });
      });
    } finally {
      if (workspaceSwitchInFlight.current === target.targetKey) workspaceSwitchInFlight.current = undefined;
    }
  }, [input.runtime, refreshChanges, runTask, state.busy, state.cwd, state.runStatus, state.selectedWorkspaceTargetIndex, state.workspaceTargets]);

  const resolvePermission = useCallback(async (decision: "allow" | "deny") => {
    const request = selectedPermission;
    if (!request) return;
    const requestKey = `${request.agentRunId}\u0000${request.worktreeId ?? ""}\u0000${request.toolCallId}`;
    if (permissionResponseInFlight.current) return;
    permissionResponseInFlight.current = requestKey;
    try {
      await runTask(async () => {
        await input.runtime.respondPermission(request, decision);
        dispatch({
          type: "permission.resolved",
          binding: {
            agentRunId: request.agentRunId,
            ...(request.worktreeId ? { worktreeId: request.worktreeId } : {}),
          },
          toolCallId: request.toolCallId,
          decision,
        });
      });
    } finally {
      if (permissionResponseInFlight.current === requestKey) permissionResponseInFlight.current = undefined;
    }
  }, [input.runtime, runTask, selectedPermission]);

  const confirmRestore = useCallback(async () => {
    const confirmation = state.restoreConfirmation;
    const preview = state.revisionPreview;
    if (!confirmation || !preview || confirmation.revisionId !== preview.revisionId) return;
    await runTask(async () => {
      const result = await input.runtime.restoreRevision(preview.revisionId, preview.workspaceId);
      dispatch({ type: "revision.restored", result });
      if (result.applied) {
        const snapshot = await input.runtime.recomputeChangeSnapshot(preview.revisionId);
        if (snapshot?.status === "available") {
          dispatch({ type: "change.snapshot.completed", agentRunId: preview.revisionId, result: snapshot });
        } else if (snapshot) {
          dispatch({ type: "notice.changed", notice: "Restored, but the run diff could not be refreshed." });
        }
      }
      await refreshChanges();
    });
  }, [input.runtime, refreshChanges, runTask, state.restoreConfirmation, state.revisionPreview]);

  const previewRemotePush = useCallback(async () => {
    if (state.busy) return;
    if (state.runStatus === "starting" || state.runStatus === "running") {
      dispatch({ type: "notice.changed", notice: "Cancel or wait for the active run before remote delivery." });
      return;
    }
    const branch = state.workspaceChanges?.branch;
    const candidates = branch
      ? state.remoteDeliveryTargets.filter((target) => target.pushBranches.includes(branch))
      : [];
    if (!branch || candidates.length !== 1) {
      dispatch({ type: "notice.changed", notice: "Remote push requires one exact allowlisted target for the current branch." });
      return;
    }
    await runTask(async () => {
      const preview = await input.runtime.previewRemotePush(candidates[0]!.remote, branch);
      dispatch({ type: "remote-delivery.push.previewed", preview });
      if (preview.canConfirm) dispatch({ type: "remote-delivery.push.requested" });
    });
  }, [input.runtime, runTask, state.busy, state.remoteDeliveryTargets, state.runStatus, state.workspaceChanges?.branch]);

  const confirmRemotePush = useCallback(async () => {
    const confirmation = state.remoteDeliveryConfirmation;
    if (!confirmation) return;
    await runTask(async () => {
      const result = await input.runtime.confirmRemotePush(confirmation.receiptId);
      dispatch({ type: "remote-delivery.push.completed", result });
      await refreshChanges();
    });
  }, [input.runtime, refreshChanges, runTask, state.remoteDeliveryConfirmation]);

  const navigateChangeHunk = useCallback(async (direction: "next" | "previous") => {
    const result = state.changeSnapshot;
    const snapshot = result?.status === "available" ? result.snapshot : undefined;
    const page = result?.status === "available" ? result.page : undefined;
    if (state.busy || hunkNavigationInFlight.current || !snapshot || !page) return;
    let cursor: string | undefined;
    if (direction === "next") {
      cursor = page.nextCursor;
      if (!cursor) return;
    } else {
      if (state.changeHunkIndex <= 0) return;
      cursor = state.changeHunkIndex === 1
        ? undefined
        : state.changeHunkPageCursors[state.changeHunkIndex - 2];
    }
    hunkNavigationInFlight.current = true;
    try {
      await runTask(async () => {
        const nextPage = await input.runtime.readChangeSnapshotPage(snapshot.snapshotId, cursor);
        dispatch({ type: "change.hunk.navigated", direction, ...(cursor ? { cursor } : {}), page: nextPage });
      });
    } finally {
      hunkNavigationInFlight.current = false;
    }
  }, [
    input.runtime,
    runTask,
    state.busy,
    state.changeHunkIndex,
    state.changeHunkPageCursors,
    state.changeSnapshot,
  ]);

  const navigateCommandJobOutput = useCallback(async (direction: "next" | "previous") => {
    const selected = state.commandJobs[state.selectedCommandJobIndex];
    const page = state.commandJobOutput;
    if (state.busy || commandJobNavigationInFlight.current || !selected || !page || page.jobId !== selected.jobId) return;
    let cursor: number;
    if (direction === "next") {
      if (!page.hasMore) return;
      cursor = page.nextCursor;
    } else {
      if (state.commandJobPageCursors.length <= 1) return;
      cursor = state.commandJobPageCursors[state.commandJobPageCursors.length - 2]!;
    }
    commandJobNavigationInFlight.current = true;
    try {
      await runTask(async () => {
        const nextPage = await input.runtime.readCommandJob(selected.jobId, cursor);
        dispatch({
          type: "command.job.output.page.navigated",
          direction,
          jobId: selected.jobId,
          cursor,
          page: nextPage,
        });
      });
    } finally {
      commandJobNavigationInFlight.current = false;
    }
  }, [
    input.runtime,
    runTask,
    state.busy,
    state.commandJobOutput,
    state.commandJobPageCursors,
    state.commandJobs,
    state.selectedCommandJobIndex,
  ]);

  const confirmCommandJobCancel = useCallback(async () => {
    const confirmation = state.commandJobCancelConfirmation;
    if (!confirmation || commandJobCancelInFlight.current) return;
    commandJobCancelInFlight.current = true;
    try {
      await runTask(async () => {
        const snapshot = await input.runtime.cancelCommandJob(confirmation.jobId);
        dispatch({ type: "command.job.cancelled", jobId: confirmation.jobId, snapshot });
      });
    } finally {
      commandJobCancelInFlight.current = false;
    }
  }, [input.runtime, runTask, state.commandJobCancelConfirmation]);

  const compact = dimensions.columns < 80;
  const footerHeight = selectedPermission?.commandPreview ? 4 : selectedPermission ? 3 : 2;
  const bodyHeight = Math.max(5, dimensions.rows - footerHeight - 3);
  const modal: TuiModal | undefined = selectedPermission
    ? "permission"
    : state.restoreConfirmation
      ? "restore"
      : state.commandJobCancelConfirmation
        ? "command-job-cancel"
        : state.remoteDeliveryConfirmation ? "remote-push" : undefined;
  const inputContext: TuiInputContext = {
    tab: state.tab,
    changesFocus: state.changesFocus,
    modal,
    busy: state.busy,
    columns: dimensions.columns,
    rows: dimensions.rows,
    bodyHeight,
    conversationCount: state.conversations.length,
    selectedConversationIndex: state.selectedConversationIndex,
    workspaceTargetCount: state.workspaceTargets.length,
    selectedWorkspaceTargetIndex: state.selectedWorkspaceTargetIndex,
    revisionCount: state.revisions.length,
    selectedRevisionIndex: state.selectedRevisionIndex,
    commandJobCount: state.commandJobs.length,
    selectedCommandJobIndex: state.selectedCommandJobIndex,
    runtimeAvailable: Boolean(state.runtime),
  };

  const handleInputAction = (action: TuiInputAction) => {
    if (action.type === "ignored") return;
    if (action.type === "modal.choice.toggle") {
      setModalChoice((value) => value === 0 ? 1 : 0);
      return;
    }
    if (action.type === "modal.confirm") {
      const choice = action.choice ?? modalChoice;
      if (selectedPermission) void resolvePermission(choice === 0 ? "allow" : "deny");
      else if (state.restoreConfirmation) {
        if (choice === 0) void confirmRestore();
        else dispatch({ type: "revision.restore.cancelled" });
      } else if (state.commandJobCancelConfirmation) {
        if (choice === 0) void confirmCommandJobCancel();
        else dispatch({ type: "command.job.cancel.dismissed" });
      } else if (state.remoteDeliveryConfirmation) {
        if (choice === 0) void confirmRemotePush();
        else dispatch({ type: "remote-delivery.push.cancelled" });
      }
      return;
    }
    if (action.type === "modal.dismiss") {
      if (selectedPermission) void resolvePermission("deny");
      else if (state.restoreConfirmation) dispatch({ type: "revision.restore.cancelled" });
      else if (state.commandJobCancelConfirmation) dispatch({ type: "command.job.cancel.dismissed" });
      else if (state.remoteDeliveryConfirmation) dispatch({ type: "remote-delivery.push.cancelled" });
      return;
    }
    if (action.type === "cancel-or-exit") {
      if ((state.runStatus === "starting" || state.runStatus === "running") && state.binding) {
        const binding = state.binding;
        if (cancelRequestedRunId.current === binding.agentRunId) return;
        cancelRequestedRunId.current = binding.agentRunId;
        void runTask(async () => {
          try {
            await input.runtime.cancel(binding);
          } catch (error) {
            if (cancelRequestedRunId.current === binding.agentRunId) cancelRequestedRunId.current = undefined;
            throw error;
          }
        });
      } else {
        exit();
      }
      return;
    }
    if (action.type === "tab.cycle") {
      const current = TUI_TABS.indexOf(state.tab);
      dispatch({
        type: "tab.selected",
        tab: TUI_TABS[(current + action.offset + TUI_TABS.length) % TUI_TABS.length]!,
      });
      return;
    }
    if (action.type === "tab.select") {
      dispatch({ type: "tab.selected", tab: action.tab });
      return;
    }
    if (action.type === "changes.focus") {
      dispatch({ type: "changes.focus.selected", focus: action.focus });
      return;
    }
    if (action.type === "list.move") {
      if (action.list === "permissions") {
        dispatch({ type: "permission.index.selected", index: state.selectedPermissionIndex + action.offset });
      } else if (action.list === "conversations") {
        dispatch({ type: "conversation.index.selected", index: state.selectedConversationIndex + action.offset });
      } else if (action.list === "worktrees") {
        if (!state.busy) dispatch({ type: "workspace.target.index.selected", index: state.selectedWorkspaceTargetIndex + action.offset });
      } else if (action.list === "revisions") {
        dispatch({ type: "revision.index.selected", index: state.selectedRevisionIndex + action.offset });
      } else {
        dispatch({ type: "command.job.index.selected", index: state.selectedCommandJobIndex + action.offset });
      }
      return;
    }
    if (action.type === "list.select") {
      if (action.list === "conversations") {
        dispatch({ type: "conversation.index.selected", index: action.index });
      } else if (action.list === "worktrees") {
        if (!state.busy) {
          dispatch({ type: "changes.focus.selected", focus: "worktrees" });
          dispatch({ type: "workspace.target.index.selected", index: action.index });
        }
      } else if (action.list === "revisions") {
        dispatch({ type: "changes.focus.selected", focus: "revisions" });
        dispatch({ type: "revision.index.selected", index: action.index });
      } else {
        dispatch({ type: "command.job.index.selected", index: action.index });
      }
      return;
    }
    if (action.type === "page.navigate") {
      if (action.owner === "changes") void navigateChangeHunk(action.direction);
      else void navigateCommandJobOutput(action.direction);
      return;
    }
    if (action.type === "command-job.cancel.request") {
      const selected = state.commandJobs[state.selectedCommandJobIndex];
      if (selected) dispatch({ type: "command.job.cancel.requested", jobId: selected.jobId });
      return;
    }
    if (action.type === "remote-delivery.push.request") {
      void previewRemotePush();
      return;
    }
    if (action.type === "activate") {
      if (state.tab === "chat") void sendPrompt();
      else if (state.tab === "sessions") void chooseConversation();
      else if (state.tab === "changes") {
        if (state.changesFocus === "worktrees") void chooseWorkspace();
        else void previewRevision();
      } else {
        void runTask(refreshRuntime);
      }
      return;
    }
    if (action.type === "transient.clear") {
      dispatch({ type: "input.changed", input: "" });
      dispatch({ type: "notice.changed" });
      return;
    }
    if (action.type === "input.backspace") {
      dispatch({ type: "input.changed", input: removeLastCharacter(state.input) });
      return;
    }
    const text = sanitizeTuiTextInput(action.text, MAX_INPUT_CHARS - state.input.length);
    if (text) dispatch({ type: "input.changed", input: `${state.input}${text}` });
  };

  useInput((character, key) => {
    const mouse = parseTuiMouseInput(character);
    handleInputAction(mouse
      ? resolveTuiMouseAction(mouse, inputContext)
      : resolveTuiInputAction(character, key, inputContext));
  });

  usePaste((text) => {
    if (modal || state.tab !== "chat" || state.busy) return;
    const visible = sanitizeTuiTextInput(text, MAX_INPUT_CHARS - state.input.length);
    if (visible) dispatch({ type: "input.changed", input: `${state.input}${visible}` });
  });

  if (dimensions.columns < 32 || dimensions.rows < 10) {
    return (
      <Box width={dimensions.columns} height={dimensions.rows} paddingX={1}>
        <Text>{toVisibleLines("Terminal too small.", Math.max(1, dimensions.columns - 2), 2).join("\n")}</Text>
      </Box>
    );
  }
  return (
    <Box width={dimensions.columns} height={dimensions.rows} flexDirection="column">
      <Header state={state} />
      <TabBar active={state.tab} />
      <Box height={bodyHeight} minHeight={5} flexGrow={1}>
        {state.tab === "chat" && <ChatView state={state} width={dimensions.columns} height={bodyHeight} compact={compact} />}
        {state.tab === "sessions" && <SessionsView state={state} width={dimensions.columns} height={bodyHeight} />}
        {state.tab === "changes" && <ChangesView state={state} width={dimensions.columns} height={bodyHeight} compact={compact} />}
        {state.tab === "runtime" && <RuntimeView state={state} width={dimensions.columns} height={bodyHeight} />}
      </Box>
      <Footer state={state} width={dimensions.columns} modalChoice={modalChoice} />
    </Box>
  );
}

function Header({ state }: { state: TuiState }) {
  const runColor = state.runStatus === "failed" || state.runStatus === "interrupted"
    ? "red"
    : state.runStatus === "running" || state.runStatus === "starting"
      ? "yellow"
      : state.runStatus === "completed"
        ? "green"
        : "gray";
  return (
    <Box height={1} paddingX={1} justifyContent="space-between">
      <Text bold color="cyan">Star Sanctuary</Text>
      <Text color={runColor}>{state.busy ? "busy" : state.runStatus}</Text>
    </Box>
  );
}

function TabBar({ active }: { active: TuiTab }) {
  return (
    <Box height={1} paddingX={1} gap={1} aria-role="tablist">
      {TUI_TABS.map((tab) => (
        <Text key={tab} inverse={tab === active} bold={tab === active}>{tab.toUpperCase()}</Text>
      ))}
    </Box>
  );
}

function ChatView(input: { state: TuiState; width: number; height: number; compact: boolean }) {
  const activityWidth = input.compact ? input.width : Math.max(24, Math.floor(input.width * 0.3));
  const chatWidth = input.compact ? input.width : input.width - activityWidth;
  const activityHeight = input.compact ? Math.min(6, Math.max(3, Math.floor(input.height * 0.3))) : input.height;
  const chatHeight = input.compact ? input.height - activityHeight : input.height;
  const chatText = [
    ...input.state.chat.map((entry) => `${entry.role === "user" ? "You" : "Agent"}: ${entry.text}`),
    ...((input.state.runStatus === "starting" || input.state.runStatus === "running") && input.state.stream.text
      ? [`Agent: ${input.state.stream.text}`]
      : []),
  ].join("\n\n");
  const lines = toVisibleLines(chatText || "No conversation selected.", Math.max(8, chatWidth - 4), Math.max(1, chatHeight - 2));
  return (
    <Box width="100%" height="100%" flexDirection={input.compact ? "column" : "row"}>
      <Box borderStyle="single" borderColor="gray" width={chatWidth} height={chatHeight} paddingX={1} flexDirection="column">
        {lines.map((line, index) => <Text key={`${index}-${line}`}>{line || " "}</Text>)}
      </Box>
      <Box borderStyle="single" borderColor="gray" width={activityWidth} height={activityHeight} paddingX={1} flexDirection="column">
        <Text bold>Activity</Text>
        <Text dimColor>{input.state.binding ? truncateTuiIdentifier(input.state.binding.agentRunId, 28) : "no active run"}</Text>
        {input.state.tools.slice(-Math.max(1, activityHeight - 4)).map((tool) => (
          <Text key={tool.id} color={tool.status === "failed" ? "red" : tool.status === "succeeded" ? "green" : "yellow"}>
            {truncateTuiIdentifier(tool.name, 18)} {tool.status}
          </Text>
        ))}
        {input.state.notice && <Text color="yellow">{toVisibleLines(input.state.notice, Math.max(8, activityWidth - 4), 1)[0]}</Text>}
      </Box>
    </Box>
  );
}

function SessionsView({ state, width, height }: { state: TuiState; width: number; height: number }) {
  const visibleCount = Math.max(1, height - 2);
  const start = Math.max(0, Math.min(state.selectedConversationIndex - Math.floor(visibleCount / 2), state.conversations.length - visibleCount));
  return (
    <Box borderStyle="single" borderColor="gray" width={width} height={height} paddingX={1} flexDirection="column">
      {state.conversations.length === 0 && <Text dimColor>No persisted conversations.</Text>}
      {state.conversations.slice(start, start + visibleCount).map((conversation, offset) => {
        const index = start + offset;
        return (
          <Text key={conversation.conversationId} inverse={index === state.selectedConversationIndex}>
            {truncateTuiIdentifier(conversation.conversationId, Math.max(18, width - 44))}  {conversation.messageCount}  {formatTuiTimestamp(conversation.updatedAt)}
          </Text>
        );
      })}
    </Box>
  );
}

function ChangesView(input: { state: TuiState; width: number; height: number; compact: boolean }) {
  const workspace = input.state.workspaceChanges;
  const conflict = input.state.revisionPreview?.changes.find((change) => change.action === "conflict");
  const workspaceLines = workspace
    ? [
      workspace.repoRoot
        ? `Workspace ${workspace.branch ?? "detached"}  ${workspace.worktree ? "managed worktree" : "primary worktree"}`
        : `Workspace ${workspace.cwd}`,
      `tracked ${workspace.trackedChanges}  untracked ${workspace.untrackedChanges}  conflicts ${workspace.conflictChanges}`,
      ...formatRemoteDeliveryLines(input.state),
      ...(workspace.error ? [workspace.error] : []),
      ...formatChangeSnapshotLines(input.state.changeSnapshot, input.state.changeHunkIndex),
      ...workspace.changedPaths.slice(0, Math.max(1, Math.floor(input.height / 2) - 3)),
    ]
    : ["Workspace status unavailable.", ...formatChangeSnapshotLines(input.state.changeSnapshot, input.state.changeHunkIndex)];
  const leftWidth = input.compact ? input.width : Math.max(30, Math.floor(input.width * 0.5));
  const rightWidth = input.compact ? input.width : input.width - leftWidth;
  const upperHeight = input.compact
    ? Math.max(3, Math.min(input.height - 2, Math.ceil(input.height * 0.65)))
    : input.height;
  const lowerHeight = input.compact ? input.height - upperHeight : input.height;
  const maxWorktreeLines = Math.max(1, Math.min(3, Math.floor((upperHeight - 5) / 4)));
  const worktreeStart = Math.max(0, Math.min(
    input.state.selectedWorkspaceTargetIndex - Math.floor(maxWorktreeLines / 2),
    input.state.workspaceTargets.length - maxWorktreeLines,
  ));
  const workspaceDetailHeight = Math.max(1, upperHeight - maxWorktreeLines - 3);
  return (
    <Box width="100%" height="100%" flexDirection={input.compact ? "column" : "row"}>
      <Box borderStyle="single" borderColor="gray" width={leftWidth} height={upperHeight} paddingX={1} flexDirection="column">
        <Text bold inverse={input.state.changesFocus === "worktrees"}>Worktrees</Text>
        {input.state.workspaceTargets.slice(worktreeStart, worktreeStart + maxWorktreeLines).map((target, offset) => {
          const index = worktreeStart + offset;
          const current = target.cwd === input.state.cwd ? ">" : " ";
          const label = target.kind === "launch" ? "launch" : target.branch ?? target.worktreeId ?? "managed";
          return (
            <Text
              key={target.targetKey}
              inverse={input.state.changesFocus === "worktrees" && index === input.state.selectedWorkspaceTargetIndex}
              color={target.status === "unavailable" ? "red" : target.status === "blocked" ? "yellow" : undefined}
            >
              {current} {target.status} {truncateTuiIdentifier(label, Math.max(8, leftWidth - 18))}
            </Text>
          );
        })}
        {toLeadingVisibleLines(workspaceLines.join("\n"), Math.max(8, leftWidth - 4), workspaceDetailHeight).map((line, index) => (
          <Text key={`${index}-${line}`}>{line || " "}</Text>
        ))}
      </Box>
      <Box borderStyle="single" borderColor="gray" width={rightWidth} height={lowerHeight} paddingX={1} flexDirection="column">
        <Text bold inverse={input.state.changesFocus === "revisions"}>Revision Checkpoints</Text>
        {input.state.revisions.length === 0 && <Text dimColor>No restorable revisions.</Text>}
        {input.state.revisions.slice(0, Math.max(1, lowerHeight - 4)).map((revision, index) => (
          <Text key={`${revision.workspaceId}-${revision.revisionId}`} inverse={index === input.state.selectedRevisionIndex}>
            {truncateTuiIdentifier(revision.revisionId, Math.max(12, rightWidth - 28))}  {revision.changedFileCount} files
          </Text>
        ))}
        {input.state.revisionPreview && (
          <Text color={input.state.revisionPreview.canRestore ? "green" : "red"}>
            preview: {input.state.revisionPreview.changes.filter((change) => change.action !== "unchanged").length} changes
          </Text>
        )}
        {conflict && (
          <>
            <Text color="red">conflict {truncateTuiIdentifier(conflict.relativePath, Math.max(8, rightWidth - 14))}</Text>
            <Text color="red">agent {formatConflictHash(conflict.recordedAfterHash)} current {formatConflictHash(conflict.currentHash)}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

function formatChangeSnapshotLines(result: TuiState["changeSnapshot"], hunkIndex: number): string[] {
  if (!result) return [];
  if (result.status !== "available" || !result.snapshot) return ["Run diff unavailable."];
  const hunk = result.page?.hunks[0];
  const boundedPatch = hunk && hunk.patch.length > MAX_DIFF_VIEW_CHARS
    ? `${hunk.patch.slice(0, MAX_DIFF_VIEW_CHARS)}\n[patch viewport truncated]`
    : hunk?.patch;
  const patchLines = boundedPatch?.split(/\r?\n/) ?? [];
  return [
    `Run diff ${result.snapshot.files.length} files ${result.snapshot.hunkCount} hunks${result.snapshot.truncated ? " truncated" : ""}; ${formatRecoveryLine(result.snapshot.recovery)}`,
    ...(hunk
      ? [`Hunk ${Math.min(hunkIndex + 1, result.snapshot.hunkCount)}/${result.snapshot.hunkCount} ${hunk.path}`, ...patchLines]
      : []),
  ];
}

function formatRemoteDeliveryLines(state: TuiState): string[] {
  const branch = state.workspaceChanges?.branch;
  const targets = branch
    ? state.remoteDeliveryTargets.filter((target) => target.pushBranches.includes(branch))
    : [];
  const lines = targets.length === 1 ? [`Delivery ${targets[0]!.remote}/${branch}`] : [];
  if (state.remoteDeliveryResult) {
    lines.push(state.remoteDeliveryResult.applied
      ? `Push verified ${truncateTuiIdentifier(state.remoteDeliveryResult.postcondition?.remoteOid ?? "unavailable", 12)}`
      : `Push blocked ${state.remoteDeliveryResult.blockers.join(",")}`);
  }
  return lines;
}

function formatRecoveryLine(recovery: WorkspaceChangeRecovery | undefined): string {
  if (!recovery) return "Recovery detect-only checkpoint missing";
  if (recovery.recoveryGuarantee === "exact") return `Recovery exact checkpoint ${truncateTuiIdentifier(recovery.checkpointId, 22)}`;
  if (recovery.recoveryGuarantee === "managed_worktree") return `Recovery managed worktree ${truncateTuiIdentifier(recovery.worktreeId, 22)}`;
  return `Recovery detect-only ${recovery.reason.replace(/_/g, " ")}`;
}

function formatConflictHash(value: string | undefined): string {
  return value ? truncateTuiIdentifier(value, 10) : "missing";
}

function RuntimeView({ state, width, height }: { state: TuiState; width: number; height: number }) {
  const runtime = state.runtime;
  const summaryLines = runtime
    ? [
      `Gateway ${runtime.gatewayConnected ? "connected" : "unreachable"}  pairing ${runtime.gatewayPaired ? "ready" : "not established"}`,
      `Checks pass ${runtime.checks.pass}  warn ${runtime.checks.warn}  fail ${runtime.checks.fail}`,
      `Agents total ${runtime.agents.total}  active ${runtime.agents.running}  error ${runtime.agents.error}`,
      `Subtasks total ${runtime.subtasks.total}  active ${runtime.subtasks.active}  failed ${runtime.subtasks.failed}`,
      `Workspace ${state.cwd}`,
      `State ${state.binding?.conversationId ?? state.selectedConversationId ?? "no conversation"}`,
      "",
      ...runtime.hints,
    ]
    : ["Runtime snapshot unavailable."];
  const compact = width < 80;
  const jobsWidth = compact ? width : Math.max(38, Math.floor(width * 0.46));
  const outputWidth = compact ? width : width - jobsWidth;
  const jobsHeight = compact
    ? Math.max(3, Math.min(Math.max(3, height - 2), Math.ceil(height * 0.55)))
    : height;
  const outputHeight = compact ? Math.max(2, height - jobsHeight) : height;
  const selected = state.commandJobs[state.selectedCommandJobIndex];
  const output = state.commandJobOutput?.jobId === selected?.jobId ? state.commandJobOutput : undefined;
  const maxJobLines = Math.max(1, jobsHeight - Math.min(summaryLines.length, 7) - 4);
  const start = Math.max(0, Math.min(
    state.selectedCommandJobIndex - Math.floor(maxJobLines / 2),
    state.commandJobs.length - maxJobLines,
  ));
  return (
    <Box width={width} height={height} flexDirection={compact ? "column" : "row"}>
      <Box borderStyle="single" borderColor="gray" width={jobsWidth} height={jobsHeight} paddingX={1} flexDirection="column">
        {toLeadingVisibleLines(summaryLines.join("\n"), Math.max(8, jobsWidth - 4), Math.max(1, jobsHeight - 4 - maxJobLines)).map((line, index) => (
          <Text key={`summary-${index}-${line}`}>{line || " "}</Text>
        ))}
        <Text bold>Command Jobs</Text>
        {state.commandJobs.length === 0 && <Text dimColor>No command jobs.</Text>}
        {state.commandJobs.slice(start, start + maxJobLines).map((job, offset) => {
          const index = start + offset;
          return (
            <Text key={job.jobId} inverse={index === state.selectedCommandJobIndex} color={commandJobStatusColor(job.status)}>
              {job.status} {truncateTuiIdentifier(job.jobId, Math.max(12, jobsWidth - 24))} {job.stdinMode}
            </Text>
          );
        })}
      </Box>
      <Box borderStyle="single" borderColor="gray" width={outputWidth} height={outputHeight} paddingX={1} flexDirection="column">
        <Text bold>Job Output</Text>
        {selected && <Text dimColor>{truncateTuiIdentifier(selected.jobId, Math.max(12, outputWidth - 4))}</Text>}
        {output
          ? toLeadingVisibleLines(output.output || "[no output]", Math.max(8, outputWidth - 4), Math.max(1, outputHeight - 4)).map((line, index) => (
            <Text key={`output-${output.startCursor}-${index}-${line}`}>{line || " "}</Text>
          ))
          : <Text dimColor>{selected ? "Output unavailable." : "No command job selected."}</Text>}
      </Box>
    </Box>
  );
}

function commandJobStatusColor(status: TuiState["commandJobs"][number]["status"]): "green" | "yellow" | "red" | "gray" {
  if (status === "running") return "yellow";
  if (status === "completed") return "green";
  if (status === "failed" || status === "lost") return "red";
  return "gray";
}

function Footer(input: { state: TuiState; width: number; modalChoice: number }) {
  const pendingPermission = input.state.pendingPermissions[input.state.selectedPermissionIndex];
  if (pendingPermission) {
    const preview = pendingPermission.commandPreview;
    const toolNameWidth = Math.max(4, Math.min(24, Math.floor((input.width - 22) / 2)));
    return (
      <Box height={preview ? 4 : 3} borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
        <Box height={1} justifyContent="space-between">
          <Text>{input.state.selectedPermissionIndex + 1}/{input.state.pendingPermissions.length} {truncateTuiIdentifier(pendingPermission.toolName, toolNameWidth)} ({truncateTuiIdentifier(pendingPermission.toolCallId, toolNameWidth)})</Text>
          <Text><Text inverse={input.modalChoice === 0}> Allow </Text> <Text inverse={input.modalChoice === 1}> Deny </Text></Text>
        </Box>
        {preview && <Text dimColor>{toVisibleLines(formatCommandPermissionPreview(preview), Math.max(8, input.width - 4), 1)[0]}</Text>}
      </Box>
    );
  }
  if (input.state.restoreConfirmation) {
    return (
      <Box height={2} borderStyle="single" borderColor="red" paddingX={1} justifyContent="space-between">
        <Text>{truncateTuiIdentifier(input.state.restoreConfirmation.revisionId, Math.max(12, input.width - 34))}</Text>
        <Text><Text inverse={input.modalChoice === 0}> Restore </Text> <Text inverse={input.modalChoice === 1}> Cancel </Text></Text>
      </Box>
    );
  }
  if (input.state.commandJobCancelConfirmation) {
    return (
      <Box height={2} borderStyle="single" borderColor="red" paddingX={1} justifyContent="space-between">
        <Text>{truncateTuiIdentifier(input.state.commandJobCancelConfirmation.jobId, Math.max(8, input.width - 30))}</Text>
        <Text><Text inverse={input.modalChoice === 0}> Cancel Job </Text> <Text inverse={input.modalChoice === 1}> Keep Running </Text></Text>
      </Box>
    );
  }
  if (input.state.remoteDeliveryConfirmation) {
    const preview = input.state.remoteDeliveryPreview;
    const target = preview?.target;
    const commit = preview?.source?.commit ?? "unavailable";
    const diffHash = preview?.diff?.sha256 ?? "unavailable";
    const label = `${target?.remote ?? "remote"}/${target?.branch ?? "branch"} ${truncateTuiIdentifier(commit, 10)} diff ${truncateTuiIdentifier(diffHash, 10)}`;
    return (
      <Box height={2} borderStyle="single" borderColor="red" paddingX={1} justifyContent="space-between">
        <Text>{truncateTuiIdentifier(label, Math.max(12, input.width - 24))}</Text>
        <Text><Text inverse={input.modalChoice === 0}> Push </Text> <Text inverse={input.modalChoice === 1}> Cancel </Text></Text>
      </Box>
    );
  }
  const inputLine = toVisibleLines(input.state.input, Math.max(8, input.width - 6), 1)[0] ?? "";
  return (
    <Box height={2} borderStyle="single" borderColor={input.state.tab === "chat" ? "cyan" : "gray"} paddingX={1}>
      {input.state.tab === "chat"
        ? <Text>&gt; {inputLine}<Text inverse> </Text></Text>
        : <Text color={input.state.notice ? "yellow" : "gray"}>{input.state.notice ?? input.state.tab}</Text>}
    </Box>
  );
}

function formatCommandPermissionPreview(preview: TuiState["pendingPermissions"][number]["commandPreview"]): string {
  if (!preview) return "";
  const parts: string[] = [preview.action];
  if (preview.commandPlan) {
    const plan = preview.commandPlan;
    parts.push(`${plan.executable}${plan.argv.length > 0 ? ` ${plan.argv.join(" ")}` : ""}`);
    parts.push(`cwd=${plan.cwd}`);
    parts.push(`env=${plan.environmentKeys.length > 0 ? plan.environmentKeys.join(",") : "-"}`);
    parts.push(`network=${plan.network}`);
    parts.push(`write=${plan.writeScope}`);
    parts.push(`stdin=${plan.stdinMode}`);
    if (plan.timeoutMs) parts.push(`timeout=${plan.timeoutMs}ms`);
  }
  if (preview.jobId) parts.push(`job=${truncateTuiIdentifier(preview.jobId, 12)}`);
  if (preview.stdinProvided) parts.push("stdin=provided");
  if (preview.cursor !== undefined) parts.push(`cursor=${preview.cursor}`);
  if (preview.maxBytes !== undefined) parts.push(`max=${preview.maxBytes}`);
  if (preview.cols !== undefined && preview.rows !== undefined) parts.push(`size=${preview.cols}x${preview.rows}`);
  return parts.join(" | ");
}

function readDimensions(stdout: NodeJS.WriteStream): { columns: number; rows: number } {
  return {
    columns: Math.max(1, stdout.columns || 80),
    rows: Math.max(1, stdout.rows || 24),
  };
}

function isTerminalRunEvent(event: AgentRunEvent): boolean {
  return event.type === "run.completed"
    || event.type === "run.failed"
    || event.type === "run.cancelled"
    || event.type === "run.interrupted";
}

function removeLastCharacter(value: string): string {
  return Array.from(value).slice(0, -1).join("");
}
