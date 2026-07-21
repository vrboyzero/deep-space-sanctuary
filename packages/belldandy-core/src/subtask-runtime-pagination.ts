export const DEFAULT_SUBTASK_PAGE_LIMIT = 100;
export const MAX_SUBTASK_PAGE_LIMIT = 200;

export type SubTaskPageCursor = {
  createdAt: number;
  taskId: string;
};

export type SubTaskPage<T> = {
  items: T[];
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
};

type SubTaskPageItem = {
  id: string;
  createdAt: number;
};

export class SubTaskPageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubTaskPageInputError";
  }
}

export function normalizeSubTaskPageLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SUBTASK_PAGE_LIMIT;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_SUBTASK_PAGE_LIMIT) {
    throw new SubTaskPageInputError(`limit must be an integer between 1 and ${MAX_SUBTASK_PAGE_LIMIT}`);
  }
  return Number(value);
}

export function encodeSubTaskPageCursor(cursor: SubTaskPageCursor): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    createdAt: cursor.createdAt,
    taskId: cursor.taskId,
  }), "utf-8").toString("base64url");
}

export function decodeSubTaskPageCursor(value: string): SubTaskPageCursor {
  try {
    if (!value || value.length > 512) {
      throw new Error("invalid cursor length");
    }
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as Record<string, unknown>;
    const createdAt = Number(parsed.createdAt);
    const taskId = typeof parsed.taskId === "string" ? parsed.taskId.trim() : "";
    if (parsed.v !== 1 || !Number.isFinite(createdAt) || createdAt < 0 || !taskId || taskId.length > 160) {
      throw new Error("invalid cursor payload");
    }
    return {
      createdAt,
      taskId,
    };
  } catch {
    throw new SubTaskPageInputError("cursor is invalid or unsupported");
  }
}

/**
 * 分页只依赖稳定的创建时间和 task id，不把任务正文、路径或状态复制进 cursor。
 */
export function paginateSubTaskRecords<T extends SubTaskPageItem>(
  records: readonly T[],
  options: {
    limit?: number;
    cursor?: string;
  } = {},
): SubTaskPage<T> {
  const limit = normalizeSubTaskPageLimit(options.limit);
  const cursor = options.cursor ? decodeSubTaskPageCursor(options.cursor) : undefined;
  const sorted = [...records].sort(compareSubTaskPageItems);
  const eligible = cursor
    ? sorted.filter((record) => compareSubTaskPageItems(record, {
      id: cursor.taskId,
      createdAt: cursor.createdAt,
    }) > 0)
    : sorted;
  const window = eligible.slice(0, limit + 1);
  const hasMore = window.length > limit;
  const items = window.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    limit,
    hasMore,
    ...(hasMore && last
      ? { nextCursor: encodeSubTaskPageCursor({ createdAt: last.createdAt, taskId: last.id }) }
      : {}),
  };
}

function compareSubTaskPageItems(left: SubTaskPageItem, right: SubTaskPageItem): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return right.id.localeCompare(left.id);
}
