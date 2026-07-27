import { defineCommand } from "citty";

import {
  CODING_RUN_EXIT_CODES,
  CODING_RUN_PROTOCOL_VERSION,
  isConversationFollowUpStatusQueryV1,
} from "../../../coding-run/contracts.js";
import { createCLIContext } from "../../shared/context.js";
import { invokeGatewayMethod } from "../../shared/gateway-rpc.js";

type TextWriter = (text: string) => void;

export async function followUpStatusAgentRunCommand(input: {
  stateDir: string;
  conversationId: string;
  agentRunId: string;
  commandId: string;
  json: boolean;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
}): Promise<number> {
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  const query = {
    version: CODING_RUN_PROTOCOL_VERSION,
    binding: {
      conversationId: input.conversationId.trim(),
      agentRunId: input.agentRunId.trim(),
    },
    commandId: input.commandId.trim(),
  };
  if (!isConversationFollowUpStatusQueryV1(query)) {
    writeStderr("conversation-id, run-id, and command-id are required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  const result = await invokeGatewayMethod({
    stateDir: input.stateDir,
    method: "coding.run.follow_up.status",
    params: { query },
    requestIdPrefix: "bdd-agent-follow-up-status",
    clientName: "bdd agent follow-up-status",
    parsePayload: (payload) => payload,
  });
  if (!result.ok) {
    writeStderr(`${result.error}\n`);
    return exitCodeForGatewayFailure(result.error);
  }
  writeStdout(`${JSON.stringify(result.payload, null, input.json ? 0 : 2)}\n`);
  return CODING_RUN_EXIT_CODES.success;
}

function exitCodeForGatewayFailure(message: string): number {
  if (/pairing|permission|denied/i.test(message)) return CODING_RUN_EXIT_CODES.permissionDenied;
  if (/timed out|websocket|connect|ECONN/i.test(message)) return CODING_RUN_EXIT_CODES.gatewayUnavailable;
  return CODING_RUN_EXIT_CODES.executionFailed;
}

export default defineCommand({
  meta: { name: "follow-up-status", description: "Inspect one queued Conversation follow-up command" },
  args: {
    "conversation-id": { type: "string", description: "Conversation ID", required: true },
    "run-id": { type: "string", description: "Source Agent run ID", required: true },
    "command-id": { type: "string", description: "Follow-up command ID", required: true },
    "state-dir": { type: "string", description: "Override state directory" },
    json: { type: "boolean", description: "Write compact JSON" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    process.exitCode = await followUpStatusAgentRunCommand({
      stateDir: ctx.stateDir,
      conversationId: typeof args["conversation-id"] === "string" ? args["conversation-id"] : "",
      agentRunId: typeof args["run-id"] === "string" ? args["run-id"] : "",
      commandId: typeof args["command-id"] === "string" ? args["command-id"] : "",
      json: args.json === true,
    });
  },
});
