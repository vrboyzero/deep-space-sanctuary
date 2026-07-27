import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION, type AgentRunEvent } from "./contracts.js";
import {
  CODING_RUN_MCP_TOOL_NAMES,
  createCodingRunMcpServer,
  type CodingRunMcpOperations,
} from "./mcp-server.js";

const connectedClients: Client[] = [];
const connectedServers: Array<ReturnType<typeof createCodingRunMcpServer>> = [];

afterEach(async () => {
  await Promise.all(connectedClients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(connectedServers.splice(0).map((server) => server.close().catch(() => undefined)));
});

describe("coding run MCP compatibility server", () => {
  it("advertises the v1 mapping and routes the six bounded operations to existing owners", async () => {
    let emitEvent: ((event: AgentRunEvent) => void) | undefined;
    const operations: CodingRunMcpOperations = {
      start: vi.fn(async () => success({ binding: { conversationId: "conversation-1", agentRunId: "run-1" } })),
      subscribe: vi.fn(async (input) => {
        emitEvent = input.onEvent;
        return success({ subscribed: true, binding: input.subscription.binding, nextCursor: 4 });
      }),
      control: vi.fn(async (control) => success({ accepted: true, operation: control.operation })),
      readArtifact: vi.fn(async () => success({ revisionId: "run-1", diffHash: "a".repeat(64) })),
    };
    const notifications: unknown[] = [];
    const { client } = await connectFixture(operations, (notification) => notifications.push(notification.params.data));

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      CODING_RUN_MCP_TOOL_NAMES.capabilities,
      CODING_RUN_MCP_TOOL_NAMES.start,
      CODING_RUN_MCP_TOOL_NAMES.subscribe,
      CODING_RUN_MCP_TOOL_NAMES.permissionRespond,
      CODING_RUN_MCP_TOOL_NAMES.steer,
      CODING_RUN_MCP_TOOL_NAMES.cancel,
      CODING_RUN_MCP_TOOL_NAMES.artifact,
    ]);

    const capabilities = await callJson(client, CODING_RUN_MCP_TOOL_NAMES.capabilities, {});
    expect(capabilities).toMatchObject({
      ok: true,
      protocolVersion: CODING_RUN_PROTOCOL_VERSION,
      result: {
        transport: "mcp-stdio",
        eventDelivery: "notifications/message",
      },
    });

    const version = { protocolVersion: CODING_RUN_PROTOCOL_VERSION };
    await callJson(client, CODING_RUN_MCP_TOOL_NAMES.start, {
      ...version,
      prompt: "Inspect the workspace.",
      cwd: process.cwd(),
      conversationId: "conversation-1",
    });
    await callJson(client, CODING_RUN_MCP_TOOL_NAMES.subscribe, {
      ...version,
      conversationId: "conversation-1",
      agentRunId: "run-1",
      cursor: 3,
    });
    await callJson(client, CODING_RUN_MCP_TOOL_NAMES.permissionRespond, {
      ...version,
      agentRunId: "run-1",
      toolCallId: "tool-1",
      decision: "allow",
      worktreeId: "worktree-1",
    });
    await callJson(client, CODING_RUN_MCP_TOOL_NAMES.steer, {
      ...version,
      conversationId: "conversation-1",
      agentRunId: "run-1",
      prompt: "Focus on the failing test.",
      idempotencyKey: "steer-1",
    });
    await callJson(client, CODING_RUN_MCP_TOOL_NAMES.cancel, {
      ...version,
      conversationId: "conversation-1",
      agentRunId: "run-1",
      reason: "client requested stop",
    });
    await callJson(client, CODING_RUN_MCP_TOOL_NAMES.artifact, {
      ...version,
      agentRunId: "run-1",
      workspaceId: "workspace-1",
    });

    expect(operations.start).toHaveBeenCalledWith({
      version: CODING_RUN_PROTOCOL_VERSION,
      text: "Inspect the workspace.",
      cwd: process.cwd(),
      conversationId: "conversation-1",
    });
    expect(operations.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      subscription: {
        version: CODING_RUN_PROTOCOL_VERSION,
        binding: { conversationId: "conversation-1", agentRunId: "run-1" },
        cursor: 3,
      },
    }));
    expect(operations.control).toHaveBeenNthCalledWith(1, {
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "permission.respond",
      binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
      toolCallId: "tool-1",
      decision: "allow",
    });
    expect(operations.control).toHaveBeenNthCalledWith(2, {
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "conversation.steer",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      prompt: "Focus on the failing test.",
      idempotencyKey: "steer-1",
    });
    expect(operations.control).toHaveBeenNthCalledWith(3, {
      version: CODING_RUN_PROTOCOL_VERSION,
      operation: "cancel",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      reason: "client requested stop",
    });
    expect(operations.readArtifact).toHaveBeenCalledWith({ revisionId: "run-1", workspaceId: "workspace-1" });

    emitEvent?.({
      version: CODING_RUN_PROTOCOL_VERSION,
      seq: 4,
      timestampMs: 10,
      source: "conversation",
      type: "run.completed",
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      payload: { output: { text: "done" } },
    });
    await vi.waitFor(() => expect(notifications).toEqual([
      expect.objectContaining({
        version: CODING_RUN_PROTOCOL_VERSION,
        type: "event",
        event: expect.objectContaining({ seq: 4, type: "run.completed" }),
      }),
    ]));
  });

  it("fails closed on unsupported SS protocol versions and returns bounded Gateway errors", async () => {
    const operations: CodingRunMcpOperations = {
      start: vi.fn(async () => ({
        ok: false as const,
        error: { code: "gateway_unavailable" as const, message: "Gateway unavailable." },
      })),
      subscribe: vi.fn(async () => success({ subscribed: true })),
      control: vi.fn(async () => success({ accepted: true })),
      readArtifact: vi.fn(async () => success({})),
    };
    const { client } = await connectFixture(operations);

    const unsupported = await client.callTool({
      name: CODING_RUN_MCP_TOOL_NAMES.start,
      arguments: { protocolVersion: "v2", prompt: "test", cwd: process.cwd() },
    });
    expect(unsupported.isError).toBe(true);
    expect(operations.start).not.toHaveBeenCalled();

    const failed = await client.callTool({
      name: CODING_RUN_MCP_TOOL_NAMES.start,
      arguments: {
        protocolVersion: CODING_RUN_PROTOCOL_VERSION,
        prompt: "test",
        cwd: process.cwd(),
      },
    });
    expect(failed.isError).toBe(true);
    expect(parseTextResult(failed)).toEqual({
      ok: false,
      protocolVersion: CODING_RUN_PROTOCOL_VERSION,
      error: { code: "gateway_unavailable", message: "Gateway unavailable." },
    });
  });
});

async function connectFixture(
  operations: CodingRunMcpOperations,
  onLogging?: (notification: { params: { data: unknown } }) => void,
): Promise<{ client: Client }> {
  const server = createCodingRunMcpServer({ operations });
  const client = new Client({ name: "external-mcp-fixture", version: "1.0.0" });
  if (onLogging) client.setNotificationHandler(LoggingMessageNotificationSchema, onLogging);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connectedServers.push(server);
  connectedClients.push(client);
  return { client };
}

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return parseTextResult(await client.callTool({ name, arguments: args }));
}

function parseTextResult(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content;
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Expected an MCP JSON text result.");
  return JSON.parse(text) as Record<string, unknown>;
}

function success(payload: unknown) {
  return { ok: true as const, payload };
}
