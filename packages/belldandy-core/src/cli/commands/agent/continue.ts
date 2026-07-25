import { defineCommand } from "citty";

import {
  CODING_RUN_EXIT_CODES,
  CODING_RUN_PROTOCOL_VERSION,
  isRunControlV1,
} from "../../../coding-run/contracts.js";
import { createCLIContext } from "../../shared/context.js";
import { resolveOptionalOutputSchema } from "../../shared/output-schema.js";
import {
  resolveAgentRunCliOptions,
  resolveAgentRunPrompt,
  runAgentRunCommand,
  type AgentRunCommandInput,
} from "./run.js";

type TextWriter = (text: string) => void;

export type AgentContinueCommandInput = Omit<AgentRunCommandInput, "conversationId"> & {
  conversationId: string;
};

/**
 * Starts a new run in an existing Conversation; it never restores a Goal or Workflow.
 */
export async function continueAgentRunCommand(input: AgentContinueCommandInput): Promise<number> {
  const conversationId = input.conversationId.trim();
  const prompt = input.prompt.trim();
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  const control = {
    version: CODING_RUN_PROTOCOL_VERSION,
    operation: "conversation.continue" as const,
    binding: { conversationId },
    prompt,
  };
  if (!isRunControlV1(control)) {
    writeStderr("conversation-id and a non-empty prompt are required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  return await runAgentRunCommand({
    ...input,
    conversationId: control.binding.conversationId,
    prompt: control.prompt,
    writeStderr,
  });
}

export default defineCommand({
  meta: { name: "continue", description: "Continue an existing Conversation with a new Agent run" },
  args: {
    "conversation-id": { type: "string", description: "Conversation ID", required: true },
    prompt: { type: "string", description: "Prompt text (reads stdin when omitted)" },
    jsonl: { type: "boolean", description: "Write AgentRunEvent v1 records as JSON Lines" },
    "state-dir": { type: "string", description: "Override state directory" },
    "agent-id": { type: "string", description: "Optional Agent ID" },
    "model-id": { type: "string", description: "Optional Model ID" },
    timeout: { type: "string", description: "Run timeout in milliseconds (minimum: 1000)" },
    cwd: { type: "string", description: "Filesystem scope for this local Gateway run" },
    "tool-allow": { type: "string", description: "Comma-separated tool allowlist" },
    "tool-deny": { type: "string", description: "Comma-separated tool denylist (takes precedence)" },
    "permission-mode": { type: "string", description: "plan, accept-edits, or confirm" },
    "max-turns": { type: "string", description: "Maximum model-call turns for this run" },
    "max-tokens": { type: "string", description: "Maximum cumulative tokens for this run" },
    "max-cost-usd": { type: "string", description: "Maximum priced model cost in USD for this run" },
    "output-schema": { type: "string", description: "Path to a JSON Schema for the final output" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    const promptResult = await resolveAgentRunPrompt({ prompt: args.prompt });
    if (!promptResult.ok) {
      process.stderr.write(`${promptResult.message}\n`);
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }
    const runOptions = resolveAgentRunCliOptions({
      timeout: args.timeout,
      cwd: args.cwd,
      toolAllow: args["tool-allow"],
      toolDeny: args["tool-deny"],
      permissionMode: args["permission-mode"],
      maxTurns: args["max-turns"],
      maxTokens: args["max-tokens"],
      maxCostUsd: args["max-cost-usd"],
    });
    if (!runOptions.ok) {
      process.stderr.write(`${runOptions.message}\n`);
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }
    const outputSchemaResult = await resolveOptionalOutputSchema(args["output-schema"]);
    if (!outputSchemaResult.ok) {
      process.stderr.write(`${outputSchemaResult.message}\n`);
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }
    process.exitCode = await continueAgentRunCommand({
      stateDir: ctx.stateDir,
      conversationId: typeof args["conversation-id"] === "string" ? args["conversation-id"] : "",
      prompt: promptResult.prompt,
      jsonl: args.jsonl === true,
      ...(typeof args["agent-id"] === "string" ? { agentId: args["agent-id"] } : {}),
      ...(typeof args["model-id"] === "string" ? { modelId: args["model-id"] } : {}),
      ...(runOptions.timeoutMs === undefined ? {} : { timeoutMs: runOptions.timeoutMs }),
      ...(runOptions.codingRun === undefined ? {} : { codingRun: runOptions.codingRun }),
      ...(outputSchemaResult.schema === undefined ? {} : { outputSchema: outputSchemaResult.schema }),
    });
  },
});
