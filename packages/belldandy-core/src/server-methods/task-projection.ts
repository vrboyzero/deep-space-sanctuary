import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import {
  readTaskProjectionCollectionSnapshot,
  type TaskProjectionCollectionCursor,
} from "../coding-run/task-projection-collection.js";
import { TaskProjectionCollectionRuntime } from "../coding-run/task-projection-collection-runtime.js";
import { collectTaskProjectionSources, type TaskProjectionCollectorContext } from "../coding-run/task-projection-collector.js";

type TaskProjectionMethodContext = TaskProjectionCollectorContext & {
  collectionRuntime: TaskProjectionCollectionRuntime;
};

export async function handleTaskProjectionMethod(
  req: GatewayReqFrame,
  ctx: TaskProjectionMethodContext,
): Promise<GatewayResFrame> {
  if (req.method !== "task.projection.list") {
    return failure(req.id, "not_found", "Unknown task projection method.");
  }
  const params = parseParams(req.params);
  if (!params.ok) return failure(req.id, "invalid_params", params.message);

  const sources = await collectTaskProjectionSources(ctx);
  const snapshot = ctx.collectionRuntime.refresh({
    observedAtMs: Date.now(),
    sources,
  });
  const page = readTaskProjectionCollectionSnapshot(snapshot, {
    cursor: params.cursor,
    limit: params.limit,
  });
  if ("ok" in page && page.ok === false) {
    return failure(req.id, page.code, `Task projection collection read failed: ${page.code}.`);
  }
  return {
    type: "res",
    id: req.id,
    ok: true,
    payload: page,
  };
}

function parseParams(value: unknown): {
  ok: true;
  limit?: number;
  cursor?: TaskProjectionCollectionCursor;
} | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "params must be an object." };
  const params = value as Record<string, unknown>;
  if (Object.keys(params).some((key) => key !== "limit" && key !== "cursor")) {
    return { ok: false, message: "params must contain only limit and cursor." };
  }

  let limit: number | undefined;
  if (params.limit !== undefined) {
    if (!Number.isSafeInteger(params.limit) || (params.limit as number) < 1 || (params.limit as number) > 100) {
      return { ok: false, message: "limit must be an integer between 1 and 100." };
    }
    limit = params.limit as number;
  }

  let cursor: TaskProjectionCollectionCursor | undefined;
  if (params.cursor !== undefined) {
    if (!params.cursor || typeof params.cursor !== "object" || Array.isArray(params.cursor)) {
      return { ok: false, message: "cursor must be an object." };
    }
    const raw = params.cursor as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !["epoch", "revision", "offset"].includes(key))) {
      return { ok: false, message: "cursor contains unsupported fields." };
    }
    if (typeof raw.epoch !== "string" || !raw.epoch.trim()
      || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0
      || !Number.isSafeInteger(raw.offset) || (raw.offset as number) < 0) {
      return { ok: false, message: "cursor requires epoch, revision, and offset." };
    }
    cursor = {
      epoch: raw.epoch.trim(),
      revision: raw.revision as number,
      offset: raw.offset as number,
    };
  }
  return { ok: true, ...(limit === undefined ? {} : { limit }), ...(cursor ? { cursor } : {}) };
}

function failure(id: string, code: string, message: string): GatewayResFrame {
  return { type: "res", id, ok: false, error: { code, message } };
}
