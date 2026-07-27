import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import {
  CODING_RUN_PROTOCOL_VERSION,
  sanitizeCodingRunData,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
  type CodingRunErrorCode,
  type CodingRunSubscription,
  type CodingRunSubscriptionErrorCode,
  type RunControl,
} from "./contracts.js";
import type { CodingRunConversationRequest } from "./stdio.js";

const MAX_IDENTIFIER_CHARS = 256;
const MAX_CONVERSATION_TEXT_CHARS = 64_000;
const MAX_STEER_TEXT_CHARS = 32_768;
const MAX_IDEMPOTENCY_KEY_CHARS = 128;

export const CODING_RUN_MCP_TOOL_NAMES = {
  capabilities: "star_sanctuary_capabilities",
  start: "star_sanctuary_run_start",
  subscribe: "star_sanctuary_run_subscribe",
  permissionRespond: "star_sanctuary_permission_respond",
  steer: "star_sanctuary_run_steer",
  cancel: "star_sanctuary_run_cancel",
  artifact: "star_sanctuary_run_artifact",
} as const;

export type CodingRunMcpOperationResult =
  | { ok: true; payload?: unknown }
  | { ok: false; error: { code: CodingRunErrorCode | CodingRunSubscriptionErrorCode; message: string } };

export type CodingRunMcpOperations = {
  start: (request: CodingRunConversationRequest) => Promise<CodingRunMcpOperationResult>;
  subscribe: (input: {
    subscription: CodingRunSubscription;
    onEvent: (event: AgentRunEvent) => void;
    onInterrupted: (error: { code: CodingRunSubscriptionErrorCode; message: string }) => void;
  }) => Promise<CodingRunMcpOperationResult>;
  control: (control: RunControl) => Promise<CodingRunMcpOperationResult>;
  readArtifact: (input: { revisionId: string; workspaceId?: string }) => Promise<CodingRunMcpOperationResult>;
};

const protocolVersionSchema = z.literal(CODING_RUN_PROTOCOL_VERSION);
const identifierSchema = z.string().trim().min(1).max(MAX_IDENTIFIER_CHARS);
const conversationBindingSchema = {
  conversationId: identifierSchema,
  agentRunId: identifierSchema,
};

export function createCodingRunMcpServer(input: {
  operations: CodingRunMcpOperations;
  serverVersion?: string;
}): McpServer {
  const server = new McpServer({
    name: "star-sanctuary-coding-run",
    version: input.serverVersion?.trim() || "1.0.0",
  }, {
    capabilities: { logging: {} },
    instructions: "Use capabilities first. All Star Sanctuary operations require protocolVersion v1 and remain Gateway-authorized.",
  });

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.capabilities, {
    title: "Star Sanctuary Coding Run Capabilities",
    description: "Report the fixed SS coding-run protocol mapping exposed by this MCP server.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => toolSuccess({
    transport: "mcp-stdio",
    eventDelivery: "notifications/message",
    eventLogger: "star-sanctuary.coding-run",
    authoritativeOwner: "gateway",
    operations: ["start", "subscribe", "permission.respond", "conversation.steer", "cancel", "artifact.read"],
    limitations: [
      "Only one active event subscription is owned by each MCP stdio process.",
      "Steer is delivered at the next safe model-call boundary, not into an in-flight Provider stream.",
      "Artifact access is read-only and resolves the workspace revision whose revisionId equals agentRunId.",
    ],
  }));

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.start, {
    title: "Start Star Sanctuary Coding Run",
    description: "Start a confirm-mode Conversation coding run through the paired Gateway.",
    inputSchema: {
      protocolVersion: protocolVersionSchema,
      prompt: z.string().trim().min(1).max(MAX_CONVERSATION_TEXT_CHARS),
      cwd: z.string().trim().min(1).max(4096).refine((value) => path.isAbsolute(value), "cwd must be absolute."),
      conversationId: identifierSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ prompt, cwd, conversationId }) => operationResult(await input.operations.start({
    version: CODING_RUN_PROTOCOL_VERSION,
    text: prompt,
    cwd,
    ...(conversationId ? { conversationId } : {}),
  })));

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.subscribe, {
    title: "Subscribe To Star Sanctuary Coding Run",
    description: "Subscribe one exact Conversation run; events arrive as MCP logging notifications with a v1 cursor.",
    inputSchema: {
      protocolVersion: protocolVersionSchema,
      ...conversationBindingSchema,
      cursor: z.number().int().nonnegative().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ conversationId, agentRunId, cursor }, extra) => {
    const binding = { conversationId, agentRunId };
    const publish = (level: "info" | "warning", data: Record<string, unknown>) => {
      void server.sendLoggingMessage({
        level,
        logger: "star-sanctuary.coding-run",
        data: sanitizeCodingRunData(data),
      }, extra.sessionId).catch(() => undefined);
    };
    return operationResult(await input.operations.subscribe({
      subscription: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding,
        ...(cursor === undefined ? {} : { cursor }),
      },
      onEvent: (event) => publish("info", {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "event",
        event,
      }),
      onInterrupted: (error) => publish("warning", {
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "subscription.error",
        binding,
        code: error.code,
        message: toSafeCodingRunErrorMessage(error.message),
      }),
    }));
  });

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.permissionRespond, {
    title: "Respond To Star Sanctuary Tool Permission",
    description: "Allow or deny one exact pending tool call; Gateway remains the permission owner.",
    inputSchema: {
      protocolVersion: protocolVersionSchema,
      agentRunId: identifierSchema,
      toolCallId: identifierSchema,
      decision: z.enum(["allow", "deny"]),
      worktreeId: identifierSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ agentRunId, toolCallId, decision, worktreeId }) => operationResult(await input.operations.control({
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: "permission.respond",
    binding: { agentRunId, ...(worktreeId ? { worktreeId } : {}) },
    toolCallId,
    decision,
  })));

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.steer, {
    title: "Steer Star Sanctuary Coding Run",
    description: "Queue one idempotent steer for the next safe model-call boundary of an exact active Conversation run.",
    inputSchema: {
      protocolVersion: protocolVersionSchema,
      ...conversationBindingSchema,
      prompt: z.string().trim().min(1).max(MAX_STEER_TEXT_CHARS),
      idempotencyKey: z.string().trim().min(1).max(MAX_IDEMPOTENCY_KEY_CHARS),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ conversationId, agentRunId, prompt, idempotencyKey }) => operationResult(await input.operations.control({
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: "conversation.steer",
    binding: { conversationId, agentRunId },
    prompt,
    idempotencyKey,
  })));

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.cancel, {
    title: "Cancel Star Sanctuary Coding Run",
    description: "Request cancellation of one exact active Conversation run.",
    inputSchema: {
      protocolVersion: protocolVersionSchema,
      ...conversationBindingSchema,
      reason: z.string().trim().min(1).max(512).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ conversationId, agentRunId, reason }) => operationResult(await input.operations.control({
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: "cancel",
    binding: { conversationId, agentRunId },
    ...(reason ? { reason } : {}),
  })));

  server.registerTool(CODING_RUN_MCP_TOOL_NAMES.artifact, {
    title: "Read Star Sanctuary Coding Run Artifact",
    description: "Read the workspace revision preview associated with an Agent run without restoring or modifying files.",
    inputSchema: {
      protocolVersion: protocolVersionSchema,
      agentRunId: identifierSchema,
      workspaceId: identifierSchema.optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ agentRunId, workspaceId }) => operationResult(await input.operations.readArtifact({
    revisionId: agentRunId,
    ...(workspaceId ? { workspaceId } : {}),
  })));

  return server;
}

export async function connectCodingRunMcpServer(input: {
  operations: CodingRunMcpOperations;
  transport: Transport;
  serverVersion?: string;
}): Promise<McpServer> {
  const server = createCodingRunMcpServer(input);
  await server.connect(input.transport);
  return server;
}

function operationResult(result: CodingRunMcpOperationResult) {
  if (result.ok) return toolSuccess(result.payload);
  return toolFailure(result.error.code, result.error.message);
}

function toolSuccess(result: unknown) {
  const body = sanitizeRecord({
    ok: true,
    protocolVersion: CODING_RUN_PROTOCOL_VERSION,
    ...(result === undefined ? {} : { result }),
  });
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function toolFailure(code: string, message: string) {
  const body = sanitizeRecord({
    ok: false,
    protocolVersion: CODING_RUN_PROTOCOL_VERSION,
    error: { code, message: toSafeCodingRunErrorMessage(message) },
  });
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeCodingRunData(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : { ok: false, protocolVersion: CODING_RUN_PROTOCOL_VERSION };
}
