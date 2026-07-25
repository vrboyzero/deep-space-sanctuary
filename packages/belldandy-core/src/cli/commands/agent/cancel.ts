import { defineCommand } from "citty";

import {
  CODING_RUN_EXIT_CODES,
  CODING_RUN_PROTOCOL_VERSION,
  isRunControlV1,
} from "../../../coding-run/contracts.js";
import { createCLIContext } from "../../shared/context.js";
import { invokeGatewayMethod } from "../../shared/gateway-rpc.js";

type TextWriter = (text: string) => void;

export async function cancelAgentRunCommand(input: {
  stateDir: string;
  conversationId: string;
  agentRunId: string;
  reason?: string;
  json: boolean;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
}): Promise<number> {
  const conversationId = input.conversationId.trim();
  const agentRunId = input.agentRunId.trim();
  const reason = input.reason?.trim();
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  const control = {
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: "cancel" as const,
    binding: { conversationId, agentRunId },
    ...(reason ? { reason } : {}),
  };
  if (!isRunControlV1(control)) {
    writeStderr("conversation-id and run-id are required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  const result = await invokeGatewayMethod({
    stateDir: input.stateDir,
    method: "conversation.run.stop",
    params: {
      conversationId: control.binding.conversationId,
      runId: control.binding.agentRunId,
      ...(control.reason ? { reason: control.reason } : {}),
    },
    requestIdPrefix: "bdd-agent-cancel",
    clientName: "bdd agent cancel",
    parsePayload: (payload) => payload,
  });
  if (!result.ok) {
    writeStderr(`${result.error}\n`);
    return /pairing|permission|denied/i.test(result.error)
      ? CODING_RUN_EXIT_CODES.permissionDenied
      : /timed out|websocket|connect|ECONN/i.test(result.error)
        ? CODING_RUN_EXIT_CODES.gatewayUnavailable
        : CODING_RUN_EXIT_CODES.executionFailed;
  }

  const output = {
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: control.operation,
    binding: control.binding,
    ...(control.reason ? { reason: control.reason } : {}),
    result: result.payload,
  };
  writeStdout(`${JSON.stringify(output, null, input.json ? 0 : 2)}\n`);
  return CODING_RUN_EXIT_CODES.success;
}

export default defineCommand({
  meta: { name: "cancel", description: "Cancel one bound active Conversation run" },
  args: {
    "conversation-id": { type: "string", description: "Conversation ID", required: true },
    "run-id": { type: "string", description: "Agent run ID", required: true },
    reason: { type: "string", description: "Optional cancellation reason" },
    "state-dir": { type: "string", description: "Override state directory" },
    json: { type: "boolean", description: "Write compact JSON" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    process.exitCode = await cancelAgentRunCommand({
      stateDir: ctx.stateDir,
      conversationId: typeof args["conversation-id"] === "string" ? args["conversation-id"] : "",
      agentRunId: typeof args["run-id"] === "string" ? args["run-id"] : "",
      ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
      json: args.json === true,
    });
  },
});
