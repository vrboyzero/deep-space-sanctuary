import {
  createTaskProjectionSet,
  type TaskProjection,
  type TaskProjectionInput,
} from "./task-projection.js";

export const TASK_PROJECTION_COLLECTION_SCHEMA_VERSION = "task-projection-collection/v1" as const;
export const DEFAULT_TASK_PROJECTION_COLLECTION_LIMIT = 50;
export const MAX_TASK_PROJECTION_COLLECTION_LIMIT = 100;

export type TaskProjectionCollectionSource = TaskProjectionInput & {
  sourceRevision: number;
};

export type TaskProjectionCollectionSnapshot = {
  schemaVersion: typeof TASK_PROJECTION_COLLECTION_SCHEMA_VERSION;
  epoch: string;
  revision: number;
  observedAtMs: number;
  totalCount: number;
  items: TaskProjection[];
};

export type TaskProjectionCollectionCursor = {
  epoch: string;
  revision: number;
  offset: number;
};

export type TaskProjectionCollectionPage = {
  revision: number;
  epoch: string;
  totalCount: number;
  items: TaskProjection[];
  nextCursor?: TaskProjectionCollectionCursor;
};

export type TaskProjectionCollectionReadFailure = {
  ok: false;
  code: "invalid_limit" | "cursor_stale" | "cursor_future" | "cursor_out_of_range";
};

/**
 * 从已读取的 authoritative evidence 创建不可变只读快照；不缓存或持久化领域状态。
 */
export function createTaskProjectionCollectionSnapshot(input: {
  epoch: string;
  revision: number;
  minimumSourceRevision?: number;
  observedAtMs: number;
  sources: readonly TaskProjectionCollectionSource[];
}): TaskProjectionCollectionSnapshot {
  const epoch = requireIdentifier(input.epoch, "Collection epoch");
  const revision = requireSafeInteger(input.revision, "Collection revision");
  const minimumSourceRevision = input.minimumSourceRevision === undefined
    ? revision
    : requireSafeInteger(input.minimumSourceRevision, "Minimum source revision");
  if (minimumSourceRevision > revision) {
    throw new Error("Minimum source revision cannot be ahead of collection revision.");
  }
  const observedAtMs = requireSafeInteger(input.observedAtMs, "Collection observed timestamp");
  const sources = input.sources.map((source) => {
    const sourceRevision = requireSafeInteger(source.sourceRevision, "Source revision");
    if (sourceRevision < minimumSourceRevision) {
      throw new Error("Task projection collection received stale source evidence.");
    }
    if (sourceRevision > revision) {
      throw new Error("Task projection collection received future source evidence.");
    }
    const { sourceRevision: _sourceRevision, ...projectionInput } = source;
    return projectionInput;
  });
  const items = createTaskProjectionSet({ sources })
    .sort((left, right) => left.taskId.localeCompare(right.taskId));

  return {
    schemaVersion: TASK_PROJECTION_COLLECTION_SCHEMA_VERSION,
    epoch,
    revision,
    observedAtMs,
    totalCount: items.length,
    items,
  };
}

/**
 * 对固定 revision 快照分页；旧 revision 不做部分 replay，调用方必须重新获取快照。
 */
export function readTaskProjectionCollectionSnapshot(
  snapshot: TaskProjectionCollectionSnapshot,
  input: { cursor?: TaskProjectionCollectionCursor; limit?: number } = {},
): TaskProjectionCollectionPage | TaskProjectionCollectionReadFailure {
  const limit = input.limit ?? DEFAULT_TASK_PROJECTION_COLLECTION_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TASK_PROJECTION_COLLECTION_LIMIT) {
    return { ok: false, code: "invalid_limit" };
  }
  const cursor = input.cursor;
  if (cursor && (!Number.isSafeInteger(cursor.revision) || cursor.revision < 0
    || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !isIdentifier(cursor.epoch))) {
    return { ok: false, code: "cursor_out_of_range" };
  }
  if (cursor && cursor.epoch !== snapshot.epoch) return { ok: false, code: "cursor_stale" };
  if (cursor && cursor.revision < snapshot.revision) return { ok: false, code: "cursor_stale" };
  if (cursor && cursor.revision > snapshot.revision) return { ok: false, code: "cursor_future" };
  const offset = cursor?.offset ?? 0;
  if (offset > snapshot.items.length) return { ok: false, code: "cursor_out_of_range" };

  const items = snapshot.items.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    totalCount: snapshot.totalCount,
    items,
    ...(nextOffset < snapshot.items.length
      ? { nextCursor: { epoch: snapshot.epoch, revision: snapshot.revision, offset: nextOffset } }
      : {}),
  };
}

function requireSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function requireIdentifier(value: string, label: string): string {
  if (!isIdentifier(value)) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}
