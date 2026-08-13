import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "../coding-run/contracts.js";
import { createCodingRunGatewayEventBroker } from "../coding-run/gateway-event-broker.js";
import { PendingToolPermissionRuntime } from "../coding-run/pending-tool-permission-runtime.js";
import { invokeGatewayMethod } from "../cli/shared/gateway-rpc.js";
import { startGatewayServer } from "../server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
  withEnv,
} from "../server-testkit.js";
import { buildGatewayServerOptions } from "./gateway-server-runtime.js";

describe("Gateway production server options", () => {
  it("forwards the pending permission owner to a real Gateway control request", async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-gateway-options-permission-"));
    let now = 1_000;
    const eventBroker = createCodingRunGatewayEventBroker({ now: () => now });
    const binding = { conversationId: "conversation-1", agentRunId: "run-1" };
    eventBroker.registerConversationRun(binding);
    const pendingPermissions = new PendingToolPermissionRuntime({
      timeoutMs: 500,
      onRequested: (request) => eventBroker.publishGatewayEvent({
        event: "tool_event",
        payload: {
          conversationId: request.conversationId,
          runId: request.agentRunId,
          kind: "coding_run_permission_requested",
          toolCallId: request.toolCallId,
          toolName: request.toolName,
        },
      }),
      onSettled: (settlement) => eventBroker.observePermissionSettled({
        conversationId: settlement.conversationId,
        agentRunId: settlement.agentRunId,
      }, settlement),
    });
    const options = buildGatewayServerOptions({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      codingRunEventBroker: eventBroker,
      pendingToolPermissionRuntime: pendingPermissions,
    } as Parameters<typeof buildGatewayServerOptions>[0]);
    expect(options.codingRunEventBroker).toBe(eventBroker);
    const gateway = await startGatewayServer(options);

    try {
      const decision = pendingPermissions.request({
        conversationId: "conversation-1",
        agentRunId: "run-1",
        toolCallId: "tool-1",
        toolName: "command_job",
      });
      let response: Awaited<ReturnType<typeof invokeGatewayMethod>> | undefined;
      await withEnv({
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(gateway.port),
        BELLDANDY_AUTH_MODE: "none",
      }, async () => {
        response = await invokeGatewayMethod({
          stateDir,
          method: "coding.run.control",
          params: {
            control: {
              version: CODING_RUN_PROTOCOL_VERSION,
              operation: "permission.respond",
              binding: { agentRunId: "run-1" },
              toolCallId: "tool-1",
              decision: "allow",
            },
          },
          requestIdPrefix: "gateway-options-permission",
          parsePayload: (payload) => payload,
        });
      });

      expect(response).toMatchObject({ ok: true, payload: { accepted: true } });
      await expect(decision).resolves.toBe("allow");
      now = 1_500;
      eventBroker.publishGatewayEvent({
        event: "chat.final",
        payload: { conversationId: binding.conversationId, runId: binding.agentRunId, text: "private" },
      });
      const evidence = eventBroker.readEfficiencyEvidence(binding);
      expect(evidence).toMatchObject({ status: "complete" });
      if (evidence.status !== "complete") throw new Error("expected complete lifecycle evidence");
      expect(evidence).not.toHaveProperty("humanInterventionEvidence");
      expect(JSON.stringify(evidence)).not.toContain("private");
    } finally {
      await gateway.close();
      await cleanupGlobalMemoryManagersForTest();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }
  }, 10_000);
});
