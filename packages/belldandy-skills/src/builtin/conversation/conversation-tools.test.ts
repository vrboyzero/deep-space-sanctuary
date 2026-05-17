import { describe, expect, it, vi } from "vitest";

import type {
  ConversationRestoreViewLike,
  ConversationTimelineProjectionLike,
  ConversationTranscriptExportLike,
  PersistedConversationSummaryLike,
  RecentToolResultRecord,
  ToolContext,
} from "../../types.js";
import { conversationListTool } from "./list.js";
import { conversationReadTool } from "./read.js";
import { retrieveToolResultTool } from "./retrieve-tool-result.js";

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: "conv-active",
    workspaceRoot: "/tmp/workspace",
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 30_000,
      maxResponseBytes: 512_000,
    },
    conversationStore: {
      getHistory: () => [],
      setRoomMembersCache: () => {},
      getRoomMembersCache: () => undefined,
      clearRoomMembersCache: () => {},
      recordTaskTokenResult: () => {},
      getTaskTokenResults: () => [],
    },
    ...overrides,
  };
}

function createSummaries(): PersistedConversationSummaryLike[] {
  return [
    {
      conversationId: "conv-active",
      createdAt: 1712000000000,
      updatedAt: 1712000001000,
      messageCount: 4,
      hasTranscript: true,
      hasMeta: true,
      hasMessages: true,
      agentId: "default",
      channel: "webchat",
    },
    {
      conversationId: "agent:coder:main",
      createdAt: 1712000000000,
      updatedAt: 1712000002000,
      messageCount: 0,
      hasTranscript: false,
      hasMeta: true,
      hasMessages: false,
      agentId: "coder",
      channel: "resident",
    },
    {
      conversationId: "heartbeat-1712000003000",
      createdAt: 1712000000000,
      updatedAt: 1712000003000,
      messageCount: 0,
      hasTranscript: false,
      hasMeta: true,
      hasMessages: false,
      channel: "heartbeat",
    },
    {
      conversationId: "sub_a80b3d9c",
      createdAt: 1712000000000,
      updatedAt: 1712000002500,
      messageCount: 2,
      hasTranscript: true,
      hasMeta: true,
      hasMessages: true,
      agentId: "default",
      channel: "subtask",
    },
    {
      conversationId: "goal:goal_-",
      createdAt: 1712000000000,
      updatedAt: 1712000002600,
      messageCount: 0,
      hasTranscript: false,
      hasMeta: true,
      hasMessages: false,
      agentId: "default",
      channel: "goal",
    },
  ];
}

function createRestoreView(): ConversationRestoreViewLike {
  return {
    conversationId: "conv-active",
    rawMessages: [
      { id: "m1", role: "user", content: "first", timestamp: 1712000000000 },
      { id: "m2", role: "assistant", content: "second", timestamp: 1712000001000 },
      { id: "m3", role: "user", content: "third", timestamp: 1712000002000 },
    ],
    compactedView: [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ],
    canonicalExtractionView: [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ],
    diagnostics: {
      source: "transcript",
      transcriptEventCount: 3,
      transcriptMessageEventCount: 3,
      transcriptUsed: true,
      relinkAttempted: true,
      relinkApplied: true,
      fallbackToRaw: false,
      boundarySource: "transcript",
      partialViewSource: "transcript",
    },
  };
}

function createTimeline(): ConversationTimelineProjectionLike {
  return {
    manifest: {
      schemaVersion: 1,
      conversationId: "conv-active",
      projectedAt: 1712000003000,
      source: "conversation.timeline.get",
    },
    items: [
      {
        kind: "message",
        createdAt: 1712000000000,
        role: "user",
        messageId: "m1",
        contentPreview: "first",
      },
      {
        kind: "restore_result",
        createdAt: 1712000003000,
        source: "transcript",
        relinkApplied: true,
        fallbackToRaw: false,
        rawMessageCount: 3,
      },
    ],
    summary: {
      eventCount: 4,
      itemCount: 2,
      messageCount: 3,
      compactBoundaryCount: 0,
      partialCompactionCount: 0,
      latestEventAt: 1712000003000,
      restore: {
        source: "transcript",
        relinkApplied: true,
        fallbackToRaw: false,
      },
    },
    warnings: [],
  };
}

function createTranscript(): ConversationTranscriptExportLike {
  return {
    manifest: {
      schemaVersion: 1,
      conversationId: "conv-active",
      exportedAt: 1712000004000,
      source: "conversation.transcript.export",
      redactionMode: "internal",
    },
    events: [
      {
        type: "user_message_accepted",
        createdAt: 1712000000000,
      },
      {
        type: "assistant_message_finalized",
        createdAt: 1712000001000,
      },
    ],
    restore: {
      rawMessages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
      compactedView: [],
      canonicalExtractionView: [],
      diagnostics: createRestoreView().diagnostics,
    },
    summary: {
      eventCount: 2,
      messageEventCount: 2,
      compactBoundaryCount: 0,
      partialCompactionViewCount: 0,
      latestEventAt: 1712000001000,
      restore: {
        source: "transcript",
        relinkApplied: true,
        fallbackToRaw: false,
      },
    },
    redaction: {
      mode: "internal",
      contentRedacted: false,
      notes: ["Full transcript and restore text are preserved for internal debugging."],
    },
  };
}

function createRecentToolResults(): RecentToolResultRecord[] {
  return [
    {
      toolCallId: "call-2",
      toolName: "run_command",
      success: false,
      summary: "run_command failed | target=pnpm test | error=spawn EPERM",
      content: "",
      error: "spawn EPERM while launching pnpm test",
      failureKind: "environment_error",
      target: "pnpm test",
      args: { command: "pnpm test" },
      createdAt: 1712000006100,
    },
    {
      toolCallId: "call-1",
      toolName: "file_read",
      success: true,
      summary: "file_read succeeded | target=src/app.ts | result=export const answer = 42",
      content: "export const answer = 42;\n".repeat(20),
      target: "src/app.ts",
      args: { path: "src/app.ts" },
      createdAt: 1712000006000,
    },
  ];
}

describe("conversation tools", () => {
  it("conversation_list should keep conversationStore method binding", async () => {
    const context = createContext();
    const boundStore = {
      ...context.conversationStore!,
      summaries: createSummaries(),
      async listPersistedConversations() {
        return this.summaries;
      },
    };

    const result = await conversationListTool.execute({
      limit: 2,
    }, {
      ...context,
      conversationStore: boundStore,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Conversations: 2");
    expect(result.output).toContain("conv-active");
  });

  it("conversation_list should filter by agent and message presence", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
      },
    });

    const result = await conversationListTool.execute({
      agent_id: "default",
      has_messages_only: true,
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("conv-active");
    expect(result.output).not.toContain("agent:coder:main");
  });

  it("conversation_list should optionally exclude heartbeat conversations", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
      },
    });

    const result = await conversationListTool.execute({
      exclude_heartbeat: true,
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("conv-active");
    expect(result.output).not.toContain("heartbeat-1712000003000");
  });

  it("conversation_list should optionally exclude subtask and goal conversations", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
      },
    });

    const result = await conversationListTool.execute({
      exclude_subtasks: true,
      exclude_goal_sessions: true,
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("conv-active");
    expect(result.output).toContain("agent:coder:main");
    expect(result.output).not.toContain("sub_a80b3d9c");
    expect(result.output).not.toContain("goal:goal_-");
  });

  it("conversation_list should respect runtime allowed conversation kinds", async () => {
    const context = createContext({
      allowedConversationKinds: ["main"],
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
      },
    });

    const result = await conversationListTool.execute({
      limit: 10,
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("conv-active");
    expect(result.output).toContain("agent:coder:main");
    expect(result.output).not.toContain("sub_a80b3d9c");
    expect(result.output).not.toContain("goal:goal_-");
    expect(result.output).not.toContain("heartbeat-1712000003000");
  });

  it("conversation_read should render meta view with restore and token data", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
        buildConversationRestoreView: vi.fn(async () => createRestoreView()),
        getTaskTokenResults: vi.fn(() => [
          {
            name: "run",
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            durationMs: 1200,
            createdAt: 1712000005000,
          },
        ]),
        getLoadedToolNames: vi.fn(() => ["goal_checkpoint_request", "browser_open"]),
      },
    });

    const result = await conversationReadTool.execute({
      conversation_id: "conv-active",
      view: "meta",
      limit: 2,
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Conversation Meta");
    expect(result.output).toContain("task_token_results=1");
    expect(result.output).toContain("loaded_deferred_tools=2");
    expect(result.output).toContain("goal_checkpoint_request");
    expect(result.output).toContain("third");
  });

  it("conversation_read should render timeline view", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
        buildConversationTimeline: vi.fn(async () => createTimeline()),
      },
    });

    const result = await conversationReadTool.execute({
      conversation_id: "conv-active",
      view: "timeline",
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Conversation Timeline");
    expect(result.output).toContain("event_count=4");
  });

  it("conversation_read should reject unknown conversation ids when listing is available", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
        buildConversationTranscriptExport: vi.fn(async () => createTranscript()),
      },
    });

    const result = await conversationReadTool.execute({
      conversation_id: "conv-missing",
      view: "transcript",
    }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Conversation not found");
  });

  it("conversation_read should keep conversationStore method binding when checking existence", async () => {
    const context = createContext();
    const boundStore = {
      ...context.conversationStore!,
      summaries: createSummaries(),
      async listPersistedConversations() {
        return this.summaries;
      },
      buildConversationTranscriptExport: vi.fn(async () => createTranscript()),
    };

    const result = await conversationReadTool.execute({
      conversation_id: "agent:coder:main",
      view: "transcript",
    }, {
      ...context,
      conversationStore: boundStore,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Conversation Transcript Export");
  });

  it("conversation_read should reject conversations blocked by runtime allowed kinds", async () => {
    const context = createContext({
      allowedConversationKinds: ["main"],
      conversationStore: {
        ...createContext().conversationStore!,
        listPersistedConversations: vi.fn(async () => createSummaries()),
        buildConversationTranscriptExport: vi.fn(async () => createTranscript()),
      },
    });

    const result = await conversationReadTool.execute({
      conversation_id: "sub_a80b3d9c",
      view: "transcript",
    }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Conversation access denied by current runtime policy: subtask");
  });

  it("retrieve_tool_result should recover recent tool outputs by tool_call_id", async () => {
    const context = createContext({
      conversationStore: {
        ...createContext().conversationStore!,
        getRecentToolResults: vi.fn(() => createRecentToolResults().filter((item) => item.toolCallId === "call-1")),
      },
    });

    const result = await retrieveToolResultTool.execute({
      tool_call_id: "call-1",
      mode: "head",
      chars: 160,
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("tool=file_read");
    expect(result.output).toContain("call_id=call-1");
    expect(result.output).toContain("src/app.ts");
    expect(result.output).toContain("export const answer = 42");
  });

  it("retrieve_tool_result should filter failures by tool_name and respect allowed conversation kinds", async () => {
    const context = createContext({
      allowedConversationKinds: ["main"],
      conversationStore: {
        ...createContext().conversationStore!,
        getRecentToolResults: vi.fn(() => createRecentToolResults().filter((item) => item.toolName === "run_command")),
      },
    });

    const result = await retrieveToolResultTool.execute({
      conversation_id: "conv-active",
      tool_name: "run_command",
      success: false,
      mode: "summary",
    }, context);

    expect(result.success).toBe(true);
    expect(result.output).toContain("run_command");
    expect(result.output).toContain("spawn EPERM");
    expect(result.output).toContain("failure_kind=environment_error");
  });
});
