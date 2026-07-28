import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODING_RUN_PROTOCOL_VERSION } from "../coding-run/contracts.js";
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
    const pendingPermissions = new PendingToolPermissionRuntime({ timeoutMs: 500 });
    const gateway = await startGatewayServer(buildGatewayServerOptions({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      pendingToolPermissionRuntime: pendingPermissions,
    } as Parameters<typeof buildGatewayServerOptions>[0]));

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
    } finally {
      await gateway.close();
      await cleanupGlobalMemoryManagersForTest();
      await fs.promises.rm(stateDir, { recursive: true, force: true });
    }
  }, 10_000);
});
