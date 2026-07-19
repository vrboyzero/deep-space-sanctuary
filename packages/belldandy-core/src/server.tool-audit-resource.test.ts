import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
import WebSocket from "ws";

import { ToolExecutor } from "@belldandy/skills";

import { startGatewayServer } from "./server.js";
import {
  createTestTool,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";

test("system.doctor exposes bounded tool audit queue watermarks without audit details", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tool-audit-resource-"));
  let releaseFirstAudit: (() => void) | undefined;
  let markFirstAuditStarted: (() => void) | undefined;
  const firstAuditStarted = new Promise<void>((resolve) => {
    markFirstAuditStarted = resolve;
  });
  let auditCallCount = 0;
  const auditTool = createTestTool("tool_audit_resource");
  const toolExecutor = new ToolExecutor({
    tools: [auditTool],
    workspaceRoot: stateDir,
    stateDir,
    maxAuditQueueSize: 1,
    auditLogger: async () => {
      auditCallCount += 1;
      if (auditCallCount !== 1) {
        return;
      }
      markFirstAuditStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirstAudit = resolve;
      });
    },
  });

  let server: Awaited<ReturnType<typeof startGatewayServer>> | undefined;
  let ws: WebSocket | undefined;
  let closePromise: Promise<void> | undefined;
  try {
    await toolExecutor.execute({
      id: "tool-audit-resource-1",
      name: "tool_audit_resource",
      arguments: {},
    }, "conversation-tool-audit-resource");
    await firstAuditStarted;
    await toolExecutor.execute({
      id: "tool-audit-resource-2",
      name: "tool_audit_resource",
      arguments: {},
    }, "conversation-tool-audit-resource");
    await toolExecutor.execute({
      id: "tool-audit-resource-3",
      name: "tool_audit_resource",
      arguments: {},
    }, "conversation-tool-audit-resource");

    server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      toolExecutor,
    });
    ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    closePromise = new Promise<void>((resolve) => ws?.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    await pairWebSocketClient(ws, frames, stateDir);
    ws.send(JSON.stringify({
      type: "req",
      id: "system-doctor-tool-audit-resource",
      method: "system.doctor",
      params: {},
    }));
    await waitFor(() => frames.some((frame) => (
      frame.type === "res" && frame.id === "system-doctor-tool-audit-resource"
    )));

    const response = frames.find((frame) => (
      frame.type === "res" && frame.id === "system-doctor-tool-audit-resource"
    ));
    expect(response?.ok).toBe(true);
    const queue = response?.payload?.runtimeResources?.latest?.queues?.find((entry: { id?: string }) => (
      entry.id === "tool_audit"
    ));
    expect(queue).toEqual({
      id: "tool_audit",
      activeCount: 1,
      queuedCount: 1,
      capacity: 1,
      rejectedCount: 1,
    });
    expect(queue).not.toHaveProperty("failedCount");
    expect(queue).not.toHaveProperty("dispatchedCount");
  } finally {
    releaseFirstAudit?.();
    ws?.close();
    await closePromise;
    await server?.close();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
