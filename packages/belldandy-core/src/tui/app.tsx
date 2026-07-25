import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import { toSafeCodingRunErrorMessage, type AgentRunEvent } from "../coding-run/contracts.js";
import type { CodingTuiRuntime } from "./runtime.js";
import {
  createInitialTuiState,
  reduceTuiState,
  type TuiState,
  type TuiTab,
} from "./state.js";
import { formatTuiTimestamp, toVisibleLines, truncateTuiIdentifier } from "./view.js";

const TABS: TuiTab[] = ["chat", "sessions", "changes", "runtime"];
const MAX_INPUT_CHARS = 64_000;

export function CodingTuiApp(input: {
  runtime: CodingTuiRuntime;
  onEventRegistration: (handler: (event: AgentRunEvent) => void) => void;
  onErrorRegistration: (handler: (message: string) => void) => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState(() => readDimensions(stdout));
  const [state, dispatch] = useReducer(reduceTuiState, createInitialTuiState(input.runtime.cwd));
  const [modalChoice, setModalChoice] = useState(0);
  const cancelRequestedRunId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const update = () => setDimensions(readDimensions(stdout));
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  useEffect(() => {
    input.onEventRegistration((event) => dispatch({ type: "run.event", event }));
    input.onErrorRegistration((message) => dispatch({ type: "notice.changed", notice: message }));
  }, [input]);

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

  const refreshSessions = useCallback(async () => {
    const conversations = await input.runtime.listConversations();
    dispatch({ type: "conversations.loaded", conversations });
  }, [input.runtime]);

  const refreshChanges = useCallback(async () => {
    const [summary, revisions] = await Promise.all([
      input.runtime.inspectWorkspace(),
      input.runtime.listRevisions(),
    ]);
    dispatch({ type: "workspace.loaded", summary });
    dispatch({ type: "revisions.loaded", revisions });
  }, [input.runtime]);

  const refreshRuntime = useCallback(async () => {
    const runtime = await input.runtime.loadRuntimeSnapshot();
    dispatch({ type: "runtime.loaded", runtime });
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
  }, [state.pendingPermission?.toolCallId, state.restoreConfirmation?.revisionId]);

  useEffect(() => {
    const active = state.runStatus === "starting" || state.runStatus === "running";
    if (!active || cancelRequestedRunId.current !== state.binding?.agentRunId) {
      cancelRequestedRunId.current = undefined;
    }
  }, [state.binding?.agentRunId, state.runStatus]);

  const sendPrompt = useCallback(async () => {
    const prompt = state.input.trim();
    if (!prompt || state.busy || state.runStatus === "starting" || state.runStatus === "running") return;
    await runTask(async () => {
      const binding = await input.runtime.requestConversation(prompt, state.selectedConversationId);
      dispatch({ type: "conversation.accepted", binding, prompt });
    });
  }, [input.runtime, runTask, state.busy, state.input, state.runStatus, state.selectedConversationId]);

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

  const resolvePermission = useCallback(async (decision: "allow" | "deny") => {
    const request = state.pendingPermission;
    if (!request) return;
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
  }, [input.runtime, runTask, state.pendingPermission]);

  const confirmRestore = useCallback(async () => {
    const confirmation = state.restoreConfirmation;
    const preview = state.revisionPreview;
    if (!confirmation || !preview || confirmation.revisionId !== preview.revisionId) return;
    await runTask(async () => {
      const result = await input.runtime.restoreRevision(preview.revisionId, preview.workspaceId);
      dispatch({ type: "revision.restored", result });
      await refreshChanges();
    });
  }, [input.runtime, refreshChanges, runTask, state.restoreConfirmation, state.revisionPreview]);

  useInput((character, key) => {
    if (state.pendingPermission) {
      if (key.leftArrow || key.rightArrow || key.tab) setModalChoice((value) => value === 0 ? 1 : 0);
      if (key.return) void resolvePermission(modalChoice === 0 ? "allow" : "deny");
      if (key.escape) void resolvePermission("deny");
      return;
    }
    if (state.restoreConfirmation) {
      if (key.leftArrow || key.rightArrow || key.tab) setModalChoice((value) => value === 0 ? 1 : 0);
      if (key.return) {
        if (modalChoice === 0) void confirmRestore();
        else dispatch({ type: "revision.restore.cancelled" });
      }
      if (key.escape) dispatch({ type: "revision.restore.cancelled" });
      return;
    }
    if (key.ctrl && character === "c") {
      if ((state.runStatus === "starting" || state.runStatus === "running") && state.binding) {
        const binding = state.binding;
        if (cancelRequestedRunId.current === binding.agentRunId) return;
        cancelRequestedRunId.current = binding.agentRunId;
        void runTask(async () => {
          try {
            await input.runtime.cancel(binding);
          } catch (error) {
            if (cancelRequestedRunId.current === binding.agentRunId) {
              cancelRequestedRunId.current = undefined;
            }
            throw error;
          }
        });
      } else {
        exit();
      }
      return;
    }
    if (key.tab) {
      const current = TABS.indexOf(state.tab);
      const offset = key.shift ? -1 : 1;
      dispatch({ type: "tab.selected", tab: TABS[(current + offset + TABS.length) % TABS.length]! });
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      const current = TABS.indexOf(state.tab);
      const offset = key.leftArrow ? -1 : 1;
      dispatch({ type: "tab.selected", tab: TABS[(current + offset + TABS.length) % TABS.length]! });
      return;
    }
    if (key.upArrow || key.downArrow) {
      const offset = key.upArrow ? -1 : 1;
      if (state.tab === "sessions") {
        dispatch({ type: "conversation.index.selected", index: state.selectedConversationIndex + offset });
      }
      if (state.tab === "changes") {
        dispatch({ type: "revision.index.selected", index: state.selectedRevisionIndex + offset });
      }
      return;
    }
    if (key.return) {
      if (state.tab === "chat") void sendPrompt();
      if (state.tab === "sessions") void chooseConversation();
      if (state.tab === "changes") void previewRevision();
      if (state.tab === "runtime") void runTask(refreshRuntime);
      return;
    }
    if (key.escape) {
      dispatch({ type: "input.changed", input: "" });
      dispatch({ type: "notice.changed" });
      return;
    }
    if (state.tab !== "chat" || key.ctrl || key.meta || key.super || state.busy) return;
    if (key.backspace || key.delete) {
      dispatch({ type: "input.changed", input: removeLastCharacter(state.input) });
      return;
    }
    const visible = character.replace(/[\u0000-\u001f\u007f]/g, "");
    if (visible && state.input.length + visible.length <= MAX_INPUT_CHARS) {
      dispatch({ type: "input.changed", input: `${state.input}${visible}` });
    }
  });

  const compact = dimensions.columns < 80;
  const bodyHeight = Math.max(5, dimensions.rows - 5);
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
      {TABS.map((tab) => (
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
  const workspaceLines = workspace
    ? [
      workspace.repoRoot ? `${workspace.branch ?? "detached"}  ${workspace.worktree ? "managed worktree" : "primary worktree"}` : workspace.cwd,
      `tracked ${workspace.trackedChanges}  untracked ${workspace.untrackedChanges}  conflicts ${workspace.conflictChanges}`,
      ...(workspace.error ? [workspace.error] : []),
      ...workspace.changedPaths.slice(0, Math.max(1, Math.floor(input.height / 2) - 3)),
    ]
    : ["Workspace status unavailable."];
  const leftWidth = input.compact ? input.width : Math.max(30, Math.floor(input.width * 0.5));
  const rightWidth = input.compact ? input.width : input.width - leftWidth;
  const upperHeight = input.compact ? Math.max(3, Math.floor(input.height / 2)) : input.height;
  const lowerHeight = input.compact ? input.height - upperHeight : input.height;
  return (
    <Box width="100%" height="100%" flexDirection={input.compact ? "column" : "row"}>
      <Box borderStyle="single" borderColor="gray" width={leftWidth} height={upperHeight} paddingX={1} flexDirection="column">
        <Text bold>Workspace</Text>
        {toVisibleLines(workspaceLines.join("\n"), Math.max(8, leftWidth - 4), Math.max(1, upperHeight - 3)).map((line, index) => (
          <Text key={`${index}-${line}`}>{line || " "}</Text>
        ))}
      </Box>
      <Box borderStyle="single" borderColor="gray" width={rightWidth} height={lowerHeight} paddingX={1} flexDirection="column">
        <Text bold>Revision Checkpoints</Text>
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
      </Box>
    </Box>
  );
}

function RuntimeView({ state, width, height }: { state: TuiState; width: number; height: number }) {
  const runtime = state.runtime;
  const lines = runtime
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
  return (
    <Box borderStyle="single" borderColor="gray" width={width} height={height} paddingX={1} flexDirection="column">
      {toVisibleLines(lines.join("\n"), Math.max(8, width - 4), Math.max(1, height - 2)).map((line, index) => (
        <Text key={`${index}-${line}`}>{line || " "}</Text>
      ))}
    </Box>
  );
}

function Footer(input: { state: TuiState; width: number; modalChoice: number }) {
  if (input.state.pendingPermission) {
    return (
      <Box height={2} borderStyle="single" borderColor="yellow" paddingX={1} justifyContent="space-between">
        <Text>{truncateTuiIdentifier(input.state.pendingPermission.toolName, 24)} ({truncateTuiIdentifier(input.state.pendingPermission.toolCallId, 24)})</Text>
        <Text><Text inverse={input.modalChoice === 0}> Allow </Text> <Text inverse={input.modalChoice === 1}> Deny </Text></Text>
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
  const inputLine = toVisibleLines(input.state.input, Math.max(8, input.width - 6), 1)[0] ?? "";
  return (
    <Box height={2} borderStyle="single" borderColor={input.state.tab === "chat" ? "cyan" : "gray"} paddingX={1}>
      {input.state.tab === "chat"
        ? <Text>&gt; {inputLine}<Text inverse> </Text></Text>
        : <Text color={input.state.notice ? "yellow" : "gray"}>{input.state.notice ?? input.state.tab}</Text>}
    </Box>
  );
}

function readDimensions(stdout: NodeJS.WriteStream): { columns: number; rows: number } {
  return {
    columns: Math.max(1, stdout.columns || 80),
    rows: Math.max(1, stdout.rows || 24),
  };
}

function removeLastCharacter(value: string): string {
  return Array.from(value).slice(0, -1).join("");
}
