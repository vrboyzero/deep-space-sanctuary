import crypto from "node:crypto";

import type { AgentRegistry, BelldandyAgent, ConversationStore } from "@belldandy/agent";
import type { GatewayEventFrame } from "@belldandy/protocol";

import { ConversationRunRegistry } from "./conversation-run-registry.js";
import { runAgentWithLifecycle } from "./query-runtime-agent-run.js";
import { ensureResidentAgentSession } from "./query-runtime-agent-sessions.js";
import { ResidentAgentRuntimeRegistry } from "./resident-agent-runtime.js";

type ResidentAutoRunLogger = {
  debug: (module: string, message: string, data?: unknown) => void;
  info: (module: string, message: string, data?: unknown) => void;
  warn: (module: string, message: string, data?: unknown) => void;
  error: (module: string, message: string, data?: unknown) => void;
};

function sanitizeVisibleAssistantText(text: string): string {
  return typeof text === "string" ? text.trim() : "";
}

export async function autoRunResidentAgent(input: {
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
  broadcast: (frame: GatewayEventFrame) => void;
  log: ResidentAutoRunLogger;
}): Promise<{ conversationId: string; runId: string }> {
  const resolvedAgentId = typeof input.agentId === "string" && input.agentId.trim()
    ? input.agentId.trim()
    : "default";
  const resolvedConversationId = typeof input.conversationId === "string" && input.conversationId.trim()
    ? input.conversationId.trim()
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
