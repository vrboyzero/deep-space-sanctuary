import crypto from "node:crypto";

import type { AgentRegistry, BelldandyAgent, ConversationStore } from "@belldandy/agent";
import type { GatewayEventFrame } from "@belldandy/protocol";

import { ConversationRunRegistry } from "./conversation-run-registry.js";
import { runAgentWithLifecycle } from "./query-runtime-agent-run.js";
import { ensureResidentAgentSession } from "./query-runtime-agent-sessions.js";
import { buildResidentMainConversationId, ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";
import type {
  TopLevelConversationLease,
  TopLevelConversationLifecycle,
} from "./top-level-conversation-lifecycle.js";

type ResidentAutoRunLogger = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

function sanitizeVisibleAssistantText(text: string): string {
  return typeof text === "string" ? text.trim() : "";
}

type ResidentAutoRunInput = {
  agentId?: string;
  conversationId?: string;
  text: string;
  visibleReminder?: string;
  skipRun?: boolean;
  userUuid?: string;
  createAgent: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  conversationStore: ConversationStore;
  conversationRunRegistry: ConversationRunRegistry;
  residentAgentRuntime: ResidentAgentRuntimeRegistry;
  topLevelConversationLifecycle?: TopLevelConversationLifecycle;
  broadcast: (frame: GatewayEventFrame) => void;
  log: ResidentAutoRunLogger;
};

export async function autoRunResidentAgent(
  input: ResidentAutoRunInput,
): Promise<{ conversationId: string; runId: string }> {
  const resolvedAgentId = typeof input.agentId === "string" && input.agentId.trim()
    ? input.agentId.trim()
    : "default";
  const requestedConversationId = typeof input.conversationId === "string" && input.conversationId.trim()
    ? input.conversationId.trim()
    : undefined;
  const conversationIdForLease = requestedConversationId ?? buildResidentMainConversationId(resolvedAgentId);
  const lifecycleLease = input.topLevelConversationLifecycle
    ? await input.topLevelConversationLifecycle.acquire({
        conversationId: conversationIdForLease,
        owners: [{
          key: input.conversationStore,
          priority: 100,
          release: () => input.conversationStore.releaseConversation(conversationIdForLease),
        }],
      })
    : undefined;

  try {
    return await executeResidentAutoRun({
      input,
      resolvedAgentId,
      requestedConversationId,
      lifecycleLease,
    });
  } finally {
    await lifecycleLease?.release();
  }
}

async function executeResidentAutoRun(runtime: {
  input: ResidentAutoRunInput;
  resolvedAgentId: string;
  requestedConversationId?: string;
  lifecycleLease?: TopLevelConversationLease;
}): Promise<{ conversationId: string; runId: string }> {
  const { input, resolvedAgentId, requestedConversationId, lifecycleLease } = runtime;
  const resolvedConversationId = requestedConversationId
    ? requestedConversationId
    : ensureResidentAgentSession({
      agentId: resolvedAgentId,
      agentRegistry: input.agentRegistry,
      residentAgentRuntime: input.residentAgentRuntime,
      conversationStore: input.conversationStore,
    }).conversationId;

  const visibleReminder = typeof input.visibleReminder === "string" ? input.visibleReminder.trim() : "";
  if (visibleReminder) {
    const assistantMessage = input.conversationStore.addMessage(
      resolvedConversationId,
      "assistant",
      visibleReminder,
      {
        agentId: resolvedAgentId,
        channel: "webchat",
      },
    );
    await input.conversationStore.waitForPendingPersistence(resolvedConversationId);
    input.broadcast({
      type: "event",
      event: "chat.final",
      payload: {
        agentId: resolvedAgentId,
        conversationId: resolvedConversationId,
        role: "assistant",
        text: visibleReminder,
        messageMeta: {
          timestampMs: assistantMessage.timestamp,
          isLatest: true,
        },
      },
    });
  }

  if (input.skipRun === true) {
    return {
      conversationId: resolvedConversationId,
      runId: "",
    };
  }

  const runId = crypto.randomUUID();
  const userText = typeof input.text === "string" ? input.text : "";
  const userMessage = input.conversationStore.addMessage(
    resolvedConversationId,
    "user",
    userText,
    {
      agentId: resolvedAgentId,
      channel: "webchat",
    },
  );
  await input.conversationStore.waitForPendingPersistence(resolvedConversationId);

  const { history } = await input.conversationStore.getConversationHistoryCompacted(resolvedConversationId);
  const agent = input.createAgent();
  const agentOwnerKey = input.agentRegistry ? agent : input.createAgent;
  if (lifecycleLease && typeof agent.releaseConversation === "function") {
    lifecycleLease.addOwner({
      // Registry Agent 按实例区分 profile；无 Registry 时 createAgent 是跨 run 稳定 owner key。
      key: agentOwnerKey,
      priority: 0,
      release: () => agent.releaseConversation?.(resolvedConversationId),
    });
  }

  input.conversationRunRegistry.register({
    conversationId: resolvedConversationId,
    runId,
    agentId: resolvedAgentId,
    startedAt: Date.now(),
    state: "running",
    stop: () => false,
  });
  input.residentAgentRuntime.markStatus(resolvedAgentId, "running");
  input.residentAgentRuntime.touchConversation(resolvedAgentId, resolvedConversationId, {
    main: resolvedConversationId === input.residentAgentRuntime.get(resolvedAgentId).mainConversationId,
  });
  input.broadcast({
    type: "event",
    event: "agent.status",
    payload: {
      agentId: resolvedAgentId,
      conversationId: resolvedConversationId,
      runId,
      status: "running",
    },
  });

  try {
    const result = await runAgentWithLifecycle(agent, {
      conversationId: resolvedConversationId,
      runInput: {
        conversationId: resolvedConversationId,
        text: userText,
        history,
        agentId: resolvedAgentId,
        userUuid: input.userUuid,
        meta: {
          runId,
          currentMessageTime: {
            timestampMs: userMessage.timestamp,
            isLatest: true,
            role: "user",
          },
        },
      },
      onDelta: ({ delta }) => {
        input.broadcast({
          type: "event",
          event: "chat.delta",
          payload: {
            agentId: resolvedAgentId,
            conversationId: resolvedConversationId,
            runId,
            delta,
          },
        });
      },
    });

    const finalText = sanitizeVisibleAssistantText(result.finalText || result.fullText);
    if (finalText) {
      const assistantMessage = input.conversationStore.addMessage(
        resolvedConversationId,
        "assistant",
        finalText,
        {
          agentId: resolvedAgentId,
        },
      );
      await input.conversationStore.waitForPendingPersistence(resolvedConversationId);
      input.broadcast({
        type: "event",
        event: "chat.final",
        payload: {
          agentId: resolvedAgentId,
          conversationId: resolvedConversationId,
          role: "assistant",
          text: finalText,
          messageMeta: {
            timestampMs: assistantMessage.timestamp,
            isLatest: true,
          },
        },
      });
    }

    input.broadcast({
      type: "event",
      event: "agent.status",
      payload: {
        agentId: resolvedAgentId,
        conversationId: resolvedConversationId,
        runId,
        status: "done",
      },
    });
    input.residentAgentRuntime.markStatus(resolvedAgentId, "idle");
    return {
      conversationId: resolvedConversationId,
      runId,
    };
  } catch (error) {
    input.residentAgentRuntime.markStatus(resolvedAgentId, "error");
    input.broadcast({
      type: "event",
      event: "agent.status",
      payload: {
        agentId: resolvedAgentId,
        conversationId: resolvedConversationId,
        runId,
        status: "error",
      },
    });
    input.log.error("resident-auto-run", "Resident auto-run failed", {
      conversationId: resolvedConversationId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    input.conversationRunRegistry.clear(resolvedConversationId, runId);
  }
}
