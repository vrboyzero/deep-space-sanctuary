import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";
import type { CommandJobRuntime } from "@belldandy/skills";

type CommandJobMethodContext = {
  runtime: CommandJobRuntime;
};

const COMMAND_JOB_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_COMMAND_JOB_READ_BYTES = 16 * 1024;

function asParams(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function handleCommandJobMethod(
  req: GatewayReqFrame,
  ctx: CommandJobMethodContext,
): Promise<GatewayResFrame> {
  if (req.method === "command.job.list") {
    const params = req.params === undefined ? {} : asParams(req.params);
    if (!params || Object.keys(params).length > 0) {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "invalid_params", message: "params must be an empty object" },
      };
    }
    return { type: "res", id: req.id, ok: true, payload: { jobs: ctx.runtime.list() } };
  }
  if (req.method === "command.job.cancel") {
    const params = asParams(req.params);
    if (!params || Object.keys(params).some((key) => key !== "jobId")) {
      return invalidParams(req.id, "params must contain only jobId");
    }
    const jobId = typeof params.jobId === "string" ? params.jobId.trim() : "";
    if (!COMMAND_JOB_ID_PATTERN.test(jobId)) {
      return invalidParams(req.id, "jobId must be a UUID");
    }
    try {
      return { type: "res", id: req.id, ok: true, payload: await ctx.runtime.cancel(jobId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: "Command job was not found." } };
      }
      return { type: "res", id: req.id, ok: false, error: { code: "command_job_failed", message: "Command job cancellation failed." } };
    }
  }
  if (req.method === "command.job.read") {
    const params = asParams(req.params);
    if (!params || Object.keys(params).some((key) => key !== "jobId" && key !== "cursor" && key !== "maxBytes")) {
      return invalidParams(req.id, "params must contain only jobId, cursor, and maxBytes");
    }
    const jobId = typeof params.jobId === "string" ? params.jobId.trim() : "";
    if (!COMMAND_JOB_ID_PATTERN.test(jobId)) {
      return invalidParams(req.id, "jobId must be a UUID");
    }
    const cursor = params.cursor;
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || (cursor as number) < 0)) {
      return invalidParams(req.id, "cursor must be a non-negative safe integer");
    }
    const maxBytes = params.maxBytes;
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || (maxBytes as number) <= 0)) {
      return invalidParams(req.id, "maxBytes must be a positive safe integer");
    }
    try {
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: ctx.runtime.read(jobId, {
          ...(cursor !== undefined ? { cursor: cursor as number } : {}),
          maxBytes: Math.min(maxBytes as number || MAX_COMMAND_JOB_READ_BYTES, MAX_COMMAND_JOB_READ_BYTES),
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: "Command job was not found." } };
      }
      if (/cursor/i.test(message)) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_cursor", message: "Command job output cursor is unavailable." } };
      }
      return { type: "res", id: req.id, ok: false, error: { code: "command_job_failed", message: "Command job output is unavailable." } };
    }
  }
  return {
    type: "res",
    id: req.id,
    ok: false,
    error: { code: "not_found", message: "Unknown command job method." },
  };
}

function invalidParams(id: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code: "invalid_params", message } };
}
