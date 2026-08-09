import path from "node:path";

import { defineCommand } from "citty";
import {
  CodeIntel,
  TypeScriptLanguageServiceProvider,
  projectCodeIntelQueryResult,
} from "@belldandy/skills";

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
  symbol?: string;
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
  const symbol = input.symbol?.trim();
  if (input.symbol !== undefined && !symbol) {
    writeStderr("symbol must be non-empty when provided.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  try {
    const resolution = await resolveProjectRules({ cwd });
    const codeIntel = symbol
      ? await inspectProjectSymbol({
          rootPath: resolution.root.path,
          workspaceRevision: resolution.prompt.contentHash,
          query: symbol,
        })
      : undefined;
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
      ...(codeIntel === undefined ? {} : { codeIntel }),
    };
    writeStdout(`${JSON.stringify(payload, null, input.json ? 0 : 2)}\n`);
    if (codeIntel?.status === "failed") {
      writeStderr("CodeIntel symbol inspection failed closed.\n");
      return CODING_RUN_EXIT_CODES.executionFailed;
    }
    return CODING_RUN_EXIT_CODES.success;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeStderr(`Project rule inspection failed: ${message}\n`);
    return exitCodeForProjectRulesFailure(error);
  }
}

async function inspectProjectSymbol(input: {
  rootPath: string;
  workspaceRevision: string;
  query: string;
}) {
  const codeIntel = new CodeIntel({
    providers: [new TypeScriptLanguageServiceProvider()],
  });
  try {
    const outcome = await codeIntel.query({
      workspace: {
        rootPath: input.rootPath,
        revision: input.workspaceRevision,
      },
      operation: "symbols",
      query: input.query,
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 30_000,
      limit: 25,
    });
    if (!outcome.ok) {
      return {
        status: "failed" as const,
        query: {
          operation: "symbols" as const,
          query: input.query,
          requiredCapability: "semantic-live" as const,
        },
        evidence: null,
        error: { ...outcome.error },
        fallback: {
          used: false,
          reason: "semantic-live-required",
        },
      };
    }
    return {
      status: outcome.result.status,
      query: {
        operation: "symbols" as const,
        query: input.query,
        requiredCapability: "semantic-live" as const,
      },
      evidence: projectCodeIntelQueryResult(outcome.result),
      fallback: {
        used: false,
        reason: null,
      },
    };
  } finally {
    codeIntel.dispose();
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
    symbol: { type: "string", description: "Optional live semantic symbol query for --cwd inspection" },
    "state-dir": { type: "string", description: "Override state directory" },
    json: { type: "boolean", description: "Write compact JSON" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    const conversationId = typeof args["conversation-id"] === "string" ? args["conversation-id"].trim() : "";
    const cwd = typeof args.cwd === "string" ? args.cwd.trim() : "";
    const symbol = typeof args.symbol === "string" ? args.symbol.trim() : undefined;
    if ((!conversationId && !cwd) || (conversationId && cwd)) {
      process.stderr.write("Provide exactly one of --conversation-id or --cwd.\n");
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }
    if (symbol !== undefined && !cwd) {
      process.stderr.write("--symbol requires --cwd.\n");
      process.exitCode = CODING_RUN_EXIT_CODES.invalidInput;
      return;
    }

    process.exitCode = cwd
      ? await inspectAgentProjectRules({
          stateDir: ctx.stateDir,
          cwd,
          ...(symbol === undefined ? {} : { symbol }),
          json: args.json === true,
        })
      : await inspectAgentConversation({
          stateDir: ctx.stateDir,
          conversationId,
          json: args.json === true,
        });
  },
});
