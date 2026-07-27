import { defineCommand } from "citty";

import {
  CODING_RUN_EXIT_CODES,
  CODING_RUN_PROTOCOL_VERSION,
  isRunControlV1,
} from "../../../coding-run/contracts.js";
import { createCLIContext } from "../../shared/context.js";
import { invokeGatewayMethod } from "../../shared/gateway-rpc.js";
import { resolveAgentRunPrompt } from "./run.js";

type TextWriter = (text: string) => void;

export async function steerAgentRunCommand(input: {
  stateDir: string;
  conversationId: string;
  agentRunId: string;
  prompt: string;
  idempotencyKey: string;
  json: boolean;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
}): Promise<number> {
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  const control = {
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: "conversation.steer" as const,
    binding: {
      conversationId: input.conversationId.trim(),
      agentRunId: input.agentRunId.trim(),
    },
    prompt: input.prompt.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
  };
  if (!isRunControlV1(control)) {
    writeStderr("conversation-id, run-id, idempotency-key, and a non-empty prompt are required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  const result = await invokeGatewayMethod({
    stateDir: input.stateDir,
    method: "coding.run.control",
    params: { control },
    requestIdPrefix: "bdd-agent-steer",
    clientName: "bdd agent steer",
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
  meta: { name: "steer", description: "Steer one active Conversation at its next model boundary" },
  args: {
    "conversation-id": { type: "string", description: "Conversation ID", required: true },
    "run-id": { type: "string", description: "Agent run ID", required: true },
    "idempotency-key": { type: "string", description: "Caller-owned retry key", required: true },
    prompt: { type: "string", description: "Steer prompt (reads stdin when omitted)" },
    "state-dir": { type: "string", description: "Override state directory" },
    json: { type: "boolean", description: "Write compact JSON" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    const promptResult = await resolveAgentRunPrompt({ prompt: args.prompt });
    if (!promptResult.ok) {
      process.stderr.write(`${promptResult.message}\n`);
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }
    process.exitCode = await steerAgentRunCommand({
      stateDir: ctx.stateDir,
      conversationId: typeof args["conversation-id"] === "string" ? args["conversation-id"] : "",
      agentRunId: typeof args["run-id"] === "string" ? args["run-id"] : "",
      idempotencyKey: typeof args["idempotency-key"] === "string" ? args["idempotency-key"] : "",
      prompt: promptResult.prompt,
      json: args.json === true,
    });
  },
});
