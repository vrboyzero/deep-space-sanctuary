import { defineCommand } from "citty";

import { CODING_RUN_EXIT_CODES } from "../../../coding-run/contracts.js";
import { parseTaskProjectionCollectionPage } from "../../../coding-run/task-projection-consumer.js";
import type { TaskProjectionCollectionCursor } from "../../../coding-run/task-projection-collection.js";
import { createCLIContext } from "../../shared/context.js";
import { invokeGatewayMethod } from "../../shared/gateway-rpc.js";

type TextWriter = (text: string) => void;

export async function listAgentTaskProjectionsCommand(input: {
  stateDir: string;
  limit?: string;
  cursor?: string;
  writeStdout?: TextWriter;
  writeStderr?: TextWriter;
}): Promise<number> {
  const writeStdout = input.writeStdout ?? ((text) => { process.stdout.write(text); });
  const writeStderr = input.writeStderr ?? ((text) => { process.stderr.write(text); });
  const limit = parseLimit(input.limit);
  if (input.limit !== undefined && limit === undefined) {
    writeStderr("limit must be an integer between 1 and 100.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }
  const cursor = parseCursor(input.cursor);
  if (input.cursor !== undefined && !cursor) {
    writeStderr("cursor must be a JSON object with epoch, revision, and offset.\n");
    return CODING_RUN_EXIT_CODES.invalidInput;
  }

  const result = await invokeGatewayMethod({
    stateDir: input.stateDir,
    method: "task.projection.list",
    params: {
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
    },
    requestIdPrefix: "bdd-agent-task-projections",
    clientName: "bdd agent task-projections",
    parsePayload: parseTaskProjectionCollectionPage,
  });
  if (!result.ok) {
    writeStderr(`${result.error}\n`);
    return exitCodeForGatewayFailure(result.error);
  }
  writeStdout(`${JSON.stringify(result.payload)}\n`);
  return CODING_RUN_EXIT_CODES.success;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return value === undefined ? undefined : undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : undefined;
}

function parseCursor(value: string | undefined): TaskProjectionCollectionCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || typeof parsed.epoch !== "string" || !parsed.epoch.trim()
      || !Number.isSafeInteger(parsed.revision) || (parsed.revision as number) < 0
      || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0
      || Object.keys(parsed).some((key) => !["epoch", "revision", "offset"].includes(key))) {
      return undefined;
    }
    return {
      epoch: parsed.epoch.trim(),
      revision: parsed.revision as number,
      offset: parsed.offset as number,
    };
  } catch {
    return undefined;
  }
}

function exitCodeForGatewayFailure(message: string): number {
  if (/pairing|permission|denied/i.test(message)) return CODING_RUN_EXIT_CODES.permissionDenied;
  if (/timed out|websocket|connect|ECONN/i.test(message)) return CODING_RUN_EXIT_CODES.gatewayUnavailable;
  return CODING_RUN_EXIT_CODES.executionFailed;
}

export default defineCommand({
  meta: { name: "task-projections", description: "Read the bounded TaskProjection collection as JSON" },
  args: {
    limit: { type: "string", description: "Return at most N tasks (1-100)" },
    cursor: { type: "string", description: "JSON cursor from the previous page" },
    "state-dir": { type: "string", description: "Override state directory" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ stateDir: args["state-dir"] });
    process.exitCode = await listAgentTaskProjectionsCommand({
      stateDir: ctx.stateDir,
      limit: typeof args.limit === "string" ? args.limit : undefined,
      cursor: typeof args.cursor === "string" ? args.cursor : undefined,
    });
  },
});
