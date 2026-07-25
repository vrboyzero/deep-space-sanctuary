import path from "node:path";

import { defineCommand } from "citty";
import type { CodingRunOptions } from "@belldandy/protocol";

import {
  CODING_RUN_EXIT_CODES,
  toSafeCodingRunErrorMessage,
  type AgentRunEvent,
} from "../../../coding-run/contracts.js";
import {
  GatewayConversationRunError,
  runGatewayConversation,
  type GatewayConversationRunResult,
} from "../../shared/gateway-conversation-run.js";
import { createCLIContext } from "../../shared/context.js";
import { compileOutputSchema, resolveOptionalOutputSchema } from "../../shared/output-schema.js";

type TextWriter = (text: string) => void;
const MAX_STDIN_PROMPT_BYTES = 1024 * 1024;

export type AgentRunCommandInput = {
  stateDir: string;
  prompt: string;
  jsonl: boolean;
  conversationId?: string;
  agentId?: string;
  modelId?: string;
  timeoutMs?: number;
  codingRun?: CodingRunOptions;
  outputSchema?: unknown;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
};

export type AgentRunCliOptionsInput = {
  timeout?: unknown;
  cwd?: unknown;
  toolAllow?: unknown;
  toolDeny?: unknown;
  permissionMode?: unknown;
  maxTurns?: unknown;
  maxTokens?: unknown;
  maxCostUsd?: unknown;
};

export function resolveAgentRunCliOptions(
  input: AgentRunCliOptionsInput,
): { ok: true; timeoutMs?: number; codingRun?: CodingRunOptions } | { ok: false; message: string } {
  const timeoutMs = parseTimeoutMs(input.timeout);
  if (input.timeout !== undefined && timeoutMs === undefined) {
    return { ok: false, message: "--timeout must be an integer of at least 1000 milliseconds." };
  }

  const cwd = resolveCwdOption(input.cwd);
  if (!cwd.ok) return cwd;
  const toolAllow = parseToolListOption(input.toolAllow, "--tool-allow");
  if (!toolAllow.ok) return toolAllow;
  const toolDeny = parseToolListOption(input.toolDeny, "--tool-deny");
  if (!toolDeny.ok) return toolDeny;
  const permissionMode = parsePermissionModeOption(input.permissionMode);
  if (!permissionMode.ok) return permissionMode;
  const maxTurns = parsePositiveIntegerOption(input.maxTurns, "--max-turns");
  if (!maxTurns.ok) return maxTurns;
  const maxTokens = parsePositiveIntegerOption(input.maxTokens, "--max-tokens");
  if (!maxTokens.ok) return maxTokens;
  const maxCostUsd = parsePositiveNumberOption(input.maxCostUsd, "--max-cost-usd");
  if (!maxCostUsd.ok) return maxCostUsd;

  const codingRun: CodingRunOptions = {
    ...(cwd.value ? { cwd: cwd.value } : {}),
    ...(toolAllow.value ? { toolAllow: toolAllow.value } : {}),
    ...(toolDeny.value ? { toolDeny: toolDeny.value } : {}),
    ...(permissionMode.value ? { permissionMode: permissionMode.value } : {}),
    ...(timeoutMs === undefined ? {} : { maxWallTimeMs: timeoutMs }),
    ...(maxTurns.value === undefined ? {} : { maxTurns: maxTurns.value }),
    ...(maxTokens.value === undefined ? {} : { maxTokens: maxTokens.value }),
    ...(maxCostUsd.value === undefined ? {} : { maxCostUsd: maxCostUsd.value }),
  };
  return {
    ok: true,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(Object.keys(codingRun).length > 0 ? { codingRun } : {}),
  };
}

export async function resolveAgentRunPrompt(input: {
  prompt?: unknown;
  stdinIsTTY?: boolean;
  readStdin?: () => Promise<string>;
}): Promise<{ ok: true; prompt: string } | { ok: false; message: string }> {
  const direct = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (direct) return { ok: true, prompt: direct };
  if (input.stdinIsTTY ?? process.stdin.isTTY) {
    return { ok: false, message: "A non-empty --prompt is required when stdin is interactive." };
  }

  try {
    const raw = await (input.readStdin ?? readPromptFromStdin)();
    const prompt = raw.trim();
    return prompt
      ? { ok: true, prompt }
      : { ok: false, message: "A non-empty prompt is required." };
  } catch (error) {
    return { ok: false, message: `Unable to read prompt from stdin: ${toSafeCodingRunErrorMessage(error)}` };
  }
}

/**
 * CLI transport wrapper for a single Conversation run. It owns no Conversation state.
 */
export async function runAgentRunCommand(input: AgentRunCommandInput): Promise<number> {
  const prompt = input.prompt.trim();
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });

  if (!prompt) {
    writeStderr("A non-empty prompt is required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }
  const schemaResult = input.outputSchema === undefined ? undefined : compileOutputSchema(input.outputSchema);
  if (schemaResult && !schemaResult.ok) {
    writeStderr(`${schemaResult.message}\n`);
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  let sawDelta = false;
  let terminalEvent: AgentRunEvent | undefined;
  const emitEvent = (event: AgentRunEvent) => {
    if (input.jsonl) {
      writeStdout(`${JSON.stringify(event)}\n`);
      return;
    }
    renderHumanEvent(event, {
      markDelta: () => { sawDelta = true; },
      writeStdout,
      writeStderr,
    });
  };
  let result: GatewayConversationRunResult;
  try {
    result = await runGatewayConversation({
      stateDir: input.stateDir,
      prompt,
      ...(input.conversationId?.trim() ? { conversationId: input.conversationId.trim() } : {}),
      ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      ...(input.modelId?.trim() ? { modelId: input.modelId.trim() } : {}),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.codingRun ? { codingRun: input.codingRun } : {}),
      onEvent: (event) => {
        if (isTerminalEvent(event)) {
          terminalEvent = event;
          return;
        }
        emitEvent(event);
      },
    });
  } catch (error) {
    writeStderr(`${toSafeCodingRunErrorMessage(error)}\n`);
    return error instanceof GatewayConversationRunError
      ? exitCodeForGatewayError(error)
      : CODING_RUN_EXIT_CODES.executionFailed;
  }

  if (!terminalEvent) {
    writeStderr("Gateway completed without a terminal coding-run event.\n");
    return CODING_RUN_EXIT_CODES.executionFailed;
  }
  if (terminalEvent.type === "run.completed" && schemaResult?.ok) {
    const validation = schemaResult.validator.validateOutput(result.outputText ?? "");
    if (!validation.ok) {
      emitEvent({
        ...terminalEvent,
        type: "run.failed",
        payload: {
          error: {
            code: "output_schema_invalid",
            message: validation.message,
          },
        },
      });
      if (!input.jsonl) {
        writeStderr(`[agent] ${validation.message}\n`);
      }
      return CODING_RUN_EXIT_CODES.outputSchemaInvalid;
    }
  }
  emitEvent(terminalEvent);
  if (!input.jsonl) {
    renderHumanCompletion(result, { sawDelta, writeStdout, writeStderr });
  }
  return exitCodeForTerminalType(result.terminalType);
}

function isTerminalEvent(event: AgentRunEvent): boolean {
  return event.type === "run.cancelled"
    || event.type === "run.interrupted"
    || event.type === "run.completed"
    || event.type === "run.failed";
}

function renderHumanEvent(
  event: AgentRunEvent,
  output: {
    markDelta: () => void;
    writeStdout: TextWriter;
    writeStderr: TextWriter;
  },
): void {
  if (event.type === "message.delta") {
    const delta = typeof event.payload.delta === "string" ? event.payload.delta : "";
    if (delta) {
      output.markDelta();
      output.writeStdout(delta);
    }
    return;
  }
  if (event.type === "run.status") {
    const status = typeof event.payload.status === "string" ? event.payload.status : "unknown";
    output.writeStderr(`[agent] ${status}\n`);
  }
}

function renderHumanCompletion(
  result: GatewayConversationRunResult,
  output: { sawDelta: boolean; writeStdout: TextWriter; writeStderr: TextWriter },
): void {
  if (result.terminalType === "run.completed") {
    if (!output.sawDelta && result.outputText) {
      output.writeStdout(`${result.outputText}\n`);
    } else if (output.sawDelta) {
      output.writeStdout("\n");
    }
    return;
  }
  output.writeStderr(`[agent] ${result.terminalType}\n`);
}

function exitCodeForTerminalType(type: GatewayConversationRunResult["terminalType"]): number {
  switch (type) {
    case "run.completed":
      return CODING_RUN_EXIT_CODES.success;
    case "run.cancelled":
      return CODING_RUN_EXIT_CODES.cancelled;
    case "run.interrupted":
      return CODING_RUN_EXIT_CODES.interrupted;
    case "run.failed":
      return CODING_RUN_EXIT_CODES.executionFailed;
  }
}

function exitCodeForGatewayError(error: GatewayConversationRunError): number {
  switch (error.code) {
    case "invalid_input":
      return CODING_RUN_EXIT_CODES.invalidInput;
    case "permission_denied":
      return CODING_RUN_EXIT_CODES.permissionDenied;
    case "gateway_unavailable":
      return CODING_RUN_EXIT_CODES.gatewayUnavailable;
    case "execution_failed":
      return CODING_RUN_EXIT_CODES.executionFailed;
  }
}

function parseTimeoutMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1_000 ? parsed : undefined;
}

function resolveCwdOption(value: unknown): { ok: true; value?: string } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: "--cwd must be a non-empty path." };
  }
  return { ok: true, value: path.resolve(value.trim()) };
}

function parseToolListOption(
  value: unknown,
  flag: "--tool-allow" | "--tool-deny",
): { ok: true; value?: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${flag} must be a comma-separated list of tool names.` };
  }
  const names = value.split(",").map((item) => item.trim());
  if (names.length === 0 || names.some((item) => !item || item.length > 160)) {
    return { ok: false, message: `${flag} contains an invalid tool name.` };
  }
  return { ok: true, value: [...new Set(names)] };
}

function parsePermissionModeOption(
  value: unknown,
): { ok: true; value?: CodingRunOptions["permissionMode"] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") {
    return { ok: false, message: "--permission-mode must be plan, accept-edits, or confirm." };
  }
  const normalized = value.trim();
  if (normalized === "plan" || normalized === "confirm") return { ok: true, value: normalized };
  if (normalized === "accept-edits" || normalized === "acceptEdits") {
    return { ok: true, value: "acceptEdits" };
  }
  return { ok: false, message: "--permission-mode must be plan, accept-edits, or confirm." };
}

function parsePositiveIntegerOption(
  value: unknown,
  flag: "--max-turns" | "--max-tokens",
): { ok: true; value?: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return { ok: false, message: `${flag} must be a positive integer.` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { ok: false, message: `${flag} must be a positive integer.` };
  }
  return { ok: true, value: parsed };
}

function parsePositiveNumberOption(
  value: unknown,
  flag: "--max-cost-usd",
): { ok: true; value?: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${flag} must be a positive finite number.` };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, message: `${flag} must be a positive finite number.` };
  }
  return { ok: true, value: parsed };
}

async function readPromptFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf-8");
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_STDIN_PROMPT_BYTES) {
      throw new Error("stdin prompt exceeds the 1 MiB size limit.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export default defineCommand({
  meta: { name: "run", description: "Run one Conversation agent through the local Gateway" },
  args: {
    prompt: { type: "string", description: "Prompt text (reads stdin when omitted)" },
    jsonl: { type: "boolean", description: "Write AgentRunEvent v1 records as JSON Lines" },
    "state-dir": { type: "string", description: "Override state directory" },
    "conversation-id": { type: "string", description: "Continue this Conversation ID" },
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

    process.exitCode = await runAgentRunCommand({
      stateDir: ctx.stateDir,
      prompt: promptResult.prompt,
      jsonl: args.jsonl === true,
      ...(typeof args["conversation-id"] === "string" ? { conversationId: args["conversation-id"] } : {}),
      ...(typeof args["agent-id"] === "string" ? { agentId: args["agent-id"] } : {}),
      ...(typeof args["model-id"] === "string" ? { modelId: args["model-id"] } : {}),
      ...(runOptions.timeoutMs === undefined ? {} : { timeoutMs: runOptions.timeoutMs }),
      ...(runOptions.codingRun === undefined ? {} : { codingRun: runOptions.codingRun }),
      ...(outputSchemaResult.schema === undefined ? {} : { outputSchema: outputSchemaResult.schema }),
    });
  },
});
