import { isTaskProjectionV1, type TaskProjection } from "./task-projection.js";
import type {
  TaskProjectionCollectionCursor,
  TaskProjectionCollectionPage,
} from "./task-projection-collection.js";

/**
 * Consumer-side validation for the additive TaskProjection page.
 * This parser never stores or mutates task state.
 */
export function parseTaskProjectionCollectionPage(
  payload: Record<string, unknown>,
): TaskProjectionCollectionPage {
  const epoch = readIdentifier(payload.epoch);
  const revision = readSafeNonNegativeInteger(payload.revision);
  const totalCount = readSafeNonNegativeInteger(payload.totalCount);
  if (!hasOnlyKeys(payload, ["epoch", "revision", "totalCount", "items", "nextCursor"])
    || !epoch
    || revision === undefined
    || totalCount === undefined
    || !Array.isArray(payload.items)
    || payload.items.length > 100
    || payload.items.some((item) => !isTaskProjectionV1(item))) {
    throw new Error("Gateway returned an invalid TaskProjection collection page.");
  }

  const items = payload.items as TaskProjection[];
  if (items.length > totalCount) {
    throw new Error("Gateway returned an inconsistent TaskProjection collection count.");
  }

  let nextCursor: TaskProjectionCollectionCursor | undefined;
  if (payload.nextCursor !== undefined) {
    const cursor = payload.nextCursor;
    const cursorEpoch = isRecord(cursor) ? readIdentifier(cursor.epoch) : undefined;
    const cursorRevision = isRecord(cursor) ? readSafeNonNegativeInteger(cursor.revision) : undefined;
    const cursorOffset = isRecord(cursor) ? readSafeNonNegativeInteger(cursor.offset) : undefined;
    if (!isRecord(cursor)
      || !hasOnlyKeys(cursor, ["epoch", "revision", "offset"])
      || !cursorEpoch
      || cursorRevision === undefined
      || cursorOffset === undefined
      || cursorEpoch !== epoch
      || cursorRevision !== revision
      || cursorOffset <= 0
      || cursorOffset >= totalCount) {
      throw new Error("Gateway returned an invalid TaskProjection collection cursor.");
    }
    nextCursor = { epoch: cursorEpoch, revision: cursorRevision, offset: cursorOffset };
  }

  return {
    epoch,
    revision,
    totalCount,
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function readIdentifier(value: unknown): string | undefined {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : undefined;
}

function readSafeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
