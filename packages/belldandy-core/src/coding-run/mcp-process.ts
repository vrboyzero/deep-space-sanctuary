import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { GatewayCodingRunSubscriptionSession } from "./gateway-subscription-session.js";
import {
  connectCodingRunMcpServer,
  type CodingRunMcpOperations,
} from "./mcp-server.js";
import {
  invokeGatewayCodingRunArtifact,
  invokeGatewayCodingRunConversation,
  invokeGatewayCodingRunControl,
} from "./stdio-process.js";

export type CodingRunMcpProcess = {
  close: () => Promise<void>;
};

export async function startCodingRunMcpProcess(input: {
  stateDir: string;
  transport?: Transport;
  operations?: CodingRunMcpOperations;
}): Promise<CodingRunMcpProcess> {
  const subscriptionSession = input.operations
    ? undefined
    : new GatewayCodingRunSubscriptionSession(input.stateDir);
  const operations = input.operations ?? createGatewayCodingRunMcpOperations({
    stateDir: input.stateDir,
    subscriptionSession: subscriptionSession!,
  });
  let server;
  try {
    server = await connectCodingRunMcpServer({
      operations,
      transport: input.transport ?? new StdioServerTransport(),
    });
  } catch (error) {
    subscriptionSession?.close();
    throw error;
  }
  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      subscriptionSession?.close();
      await server.close();
    },
  };
}

export function createGatewayCodingRunMcpOperations(input: {
  stateDir: string;
  subscriptionSession: GatewayCodingRunSubscriptionSession;
}): CodingRunMcpOperations {
  return {
    start: (request) => invokeGatewayCodingRunConversation(request, input.stateDir, "mcp"),
    control: (control) => invokeGatewayCodingRunControl(control, input.stateDir),
    subscribe: async ({ subscription, onEvent, onInterrupted }) => {
      const result = await input.subscriptionSession.subscribe({
        subscription,
        onEvent,
        onInterrupted,
      });
      return result.ok
        ? { ok: true, payload: result.payload }
        : { ok: false, error: result.error };
    },
    readArtifact: (artifact) => invokeGatewayCodingRunArtifact(artifact, input.stateDir),
  };
}
