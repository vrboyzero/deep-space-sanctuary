import path from "node:path";

import { defineCommand } from "citty";

import { CODING_RUN_EXIT_CODES } from "../../../coding-run/contracts.js";
import { resolveProjectRules } from "../../../project-rules.js";
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

export async function inspectAgentProjectRules(input: {
  stateDir: string;
  cwd: string;
  json: boolean;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
}): Promise<number> {
  const cwd = input.cwd.trim();
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  if (!cwd) {
    writeStderr("cwd is required.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  try {
    const resolution = await resolveProjectRules({ cwd });
    const payload = {
      kind: "project-rules",
      requestedCwd: resolution.requestedCwd,
      cwd: resolution.cwd,
      root: { ...resolution.root },
      precedence: "root-to-cwd-later-wins",
      identityRules: {
        source: "state-workspace",
        stateDir: path.resolve(input.stateDir),
        includedInProjectPrompt: false,
      },
      sources: resolution.rules.map((rule) => ({
        source: "project",
        path: rule.path,
        appliesTo: rule.scopeDir,
        priority: rule.priority,
        contentHash: rule.contentHash,
        sizeBytes: rule.sizeBytes,
      })),
      skipped: resolution.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      prompt: {
        contentHash: resolution.prompt.contentHash,
        charLength: resolution.prompt.text.length,
        sourceCount: resolution.prompt.sourceCount,
      },
    };
    writeStdout(`${JSON.stringify(payload, null, input.json ? 0 : 2)}\n`);
    return CODING_RUN_EXIT_CODES.success;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeStderr(`Project rule inspection failed: ${message}\n`);
    return exitCodeForProjectRulesFailure(error);
  }
}

function exitCodeForGatewayFailure(message: string): number {
  if (/pairing|permission|denied/i.test(message)) return CODING_RUN_EXIT_CODES.permissionDenied;
  if (/timed out|websocket|connect|ECONN/i.test(message)) return CODING_RUN_EXIT_CODES.gatewayUnavailable;
  return CODING_RUN_EXIT_CODES.executionFailed;
}

function exitCodeForProjectRulesFailure(error: unknown): number {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM") return CODING_RUN_EXIT_CODES.permissionDenied;
  if (code === "ENOENT" || code === "ENOTDIR") return CODING_RUN_EXIT_CODES.invalidInput;
  return CODING_RUN_EXIT_CODES.executionFailed;
}

export default defineCommand({
  meta: { name: "inspect", description: "Inspect Conversation metadata or cwd project rules" },
  args: {
    "conversation-id": { type: "string", description: "Conversation ID" },
    cwd: { type: "string", description: "Project working directory" },
    "state-dir": { type: "string", description: "Override state directory" },
    json: { type: "boolean", description: "Write compact JSON" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    const conversationId = typeof args["conversation-id"] === "string" ? args["conversation-id"].trim() : "";
    const cwd = typeof args.cwd === "string" ? args.cwd.trim() : "";
    if ((!conversationId && !cwd) || (conversationId && cwd)) {
      process.stderr.write("Provide exactly one of --conversation-id or --cwd.\n");
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }

    process.exitCode = cwd
      ? await inspectAgentProjectRules({
          stateDir: ctx.stateDir,
          cwd,
          json: args.json === true,
        })
      : await inspectAgentConversation({
          stateDir: ctx.stateDir,
          conversationId,
          json: args.json === true,
        });
  },
});
