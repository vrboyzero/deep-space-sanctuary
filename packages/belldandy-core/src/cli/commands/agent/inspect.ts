import { defineCommand } from "citty";

import { CODING_RUN_EXIT_CODES } from "../../../coding-run/contracts.js";
import { createCLIContext } from "../../shared/context.js";
import { invokeGatewayMethod } from "../../shared/gateway-rpc.js";

type TextWriter = (text: string) => void;

export async function inspectAgentConversation(input: {
  stateDir: string;
  conversationId: string;
  json: boolean;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
}): Promise<number> {
  const conversationId = input.conversationId.trim();
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  if (!conversationId) {
    writeStderr("conversation-id is required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  const result = await invokeGatewayMethod({
    stateDir: input.stateDir,
    method: "conversation.meta",
    params: { conversationId },
    requestIdPrefix: "bdd-agent-inspect",
    clientName: "bdd agent inspect",
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
  meta: { name: "inspect", description: "Inspect Gateway-owned metadata for one Conversation" },
  args: {
    "conversation-id": { type: "string", description: "Conversation ID", required: true },
    "state-dir": { type: "string", description: "Override state directory" },
    json: { type: "boolean", description: "Write compact JSON" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    process.exitCode = await inspectAgentConversation({
      stateDir: ctx.stateDir,
      conversationId: typeof args["conversation-id"] === "string" ? args["conversation-id"] : "",
      json: args.json === true,
    });
  },
});
