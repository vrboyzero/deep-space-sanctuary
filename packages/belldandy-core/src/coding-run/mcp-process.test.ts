import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { BelldandyAgent } from "@belldandy/agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "./contracts.js";
import { startCodingRunMcpProcess, type CodingRunMcpProcess } from "./mcp-process.js";
import { CODING_RUN_MCP_TOOL_NAMES } from "./mcp-server.js";
import { startGatewayServer, type GatewayServer } from "../server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
  waitFor,
  withEnv,
} from "../server-testkit.js";
import { WorkspaceRevisionRuntime } from "../workspace-revision.js";

const clients: Client[] = [];
const processes: CodingRunMcpProcess[] = [];
const gateways: GatewayServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(processes.splice(0).map((runtime) => runtime.close().catch(() => undefined)));
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close().catch(() => undefined)));
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.promises.rm(directory, { recursive: true, force: true })
  )));
});

describe("coding run MCP process", () => {
  it("lets an external MCP client start, subscribe, and read a run-bound artifact through a real Gateway", async () => {
    const stateDir = await createTemporaryDirectory("belldandy-coding-run-mcp-state-");
    const workspaceRoot = await createTemporaryDirectory("belldandy-coding-run-mcp-workspace-");
    const targetPath = path.join(workspaceRoot, "result.txt");
    await fs.promises.writeFile(targetPath, "before\n", "utf-8");
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "external MCP answer" };
        yield { type: "final" as const, text: "external MCP answer" };
        yield { type: "status" as const, status: "done" as const };
      },
    };
    const revisionRuntime = new WorkspaceRevisionRuntime({ stateDir });
    const gateway = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
      workspaceRevisionRuntime: revisionRuntime,
    });
    gateways.push(gateway);

    await withEnv({
      BELLDANDY_HOST: "127.0.0.1",
      BELLDANDY_PORT: String(gateway.port),
      BELLDANDY_AUTH_MODE: "none",
    }, async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const runtime = await startCodingRunMcpProcess({ stateDir, transport: serverTransport });
      const client = new Client({ name: "stage-6-external-client", version: "1.0.0" });
      const notifications: Array<Record<string, unknown>> = [];
      client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
        if (notification.params.data && typeof notification.params.data === "object") {
          notifications.push(notification.params.data as Record<string, unknown>);
        }
      });
      await client.connect(clientTransport);
      processes.push(runtime);
      clients.push(client);

      const started = await callJson(client, CODING_RUN_MCP_TOOL_NAMES.start, {
        protocolVersion: CODING_RUN_PROTOCOL_VERSION,
        prompt: "Inspect this workspace.",
        cwd: workspaceRoot,
        conversationId: "mcp-external-conversation",
      });
      const binding = readBinding(started);

      const targets = [{ absolutePath: targetPath, relativePath: "result.txt" }];
      await revisionRuntime.prepareMutations({
        revisionId: binding.agentRunId,
        workspaceRoot,
        toolName: "external_mcp_fixture",
        targets,
      });
      await fs.promises.writeFile(targetPath, "after\n", "utf-8");
      await revisionRuntime.commitMutations({
        revisionId: binding.agentRunId,
        workspaceRoot,
        toolName: "external_mcp_fixture",
        targets,
      });

      const subscribed = await callJson(client, CODING_RUN_MCP_TOOL_NAMES.subscribe, {
        protocolVersion: CODING_RUN_PROTOCOL_VERSION,
        ...binding,
      });
      expect(subscribed).toMatchObject({
        ok: true,
        result: {
          earliestSeq: expect.any(Number),
          latestSeq: expect.any(Number),
        },
      });
      await waitFor(() => notifications.some((notification) => {
        const event = notification.event as { type?: string } | undefined;
        return notification.type === "event" && event?.type === "run.completed";
      }));

      const artifact = await callJson(client, CODING_RUN_MCP_TOOL_NAMES.artifact, {
        protocolVersion: CODING_RUN_PROTOCOL_VERSION,
        agentRunId: binding.agentRunId,
      });
      if (artifact.ok !== true) throw new Error(`Artifact read failed: ${JSON.stringify(artifact)}`);
      expect(artifact).toMatchObject({
        ok: true,
        result: {
          revisionId: binding.agentRunId,
          canRestore: true,
          changes: [expect.objectContaining({ relativePath: "result.txt", action: "restore" })],
        },
      });
    });
  });
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`Expected JSON text from ${name}.`);
  return JSON.parse(text) as Record<string, unknown>;
}

function readBinding(result: Record<string, unknown>): { conversationId: string; agentRunId: string } {
  const binding = (result.result as { binding?: Record<string, unknown> } | undefined)?.binding;
  const conversationId = typeof binding?.conversationId === "string" ? binding.conversationId : "";
  const agentRunId = typeof binding?.agentRunId === "string" ? binding.agentRunId : "";
  if (!conversationId || !agentRunId) throw new Error("MCP start did not return an exact Conversation binding.");
  return { conversationId, agentRunId };
}
