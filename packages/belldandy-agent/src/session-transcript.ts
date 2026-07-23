import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";

export const SESSION_TRANSCRIPT_SCHEMA_VERSION = 1;

export const DEFAULT_SESSION_TRANSCRIPT_READ_LIMITS = {
  maxFileBytes: 64 * 1024 * 1024,
  maxLineBytes: 4 * 1024 * 1024,
  maxEvents: 100_000,
} as const;

export const DEFAULT_SESSION_TRANSCRIPT_PAGE_SIZE = 100;
export const MAX_SESSION_TRANSCRIPT_PAGE_SIZE = 500;

export type SessionTranscriptReadLimits = {
  maxFileBytes: number;
  maxLineBytes: number;
  maxEvents: number;
};

export type SessionTranscriptTruncatedReason = "file_bytes" | "event_count";

export type SessionTranscriptReadDiagnostics = {
  bytesRead: number;
  lineCount: number;
  eventCount: number;
  malformedLineCount: number;
  oversizedLineCount: number;
  truncated: boolean;
  corrupt: boolean;
  truncatedReason?: SessionTranscriptTruncatedReason;
  limits: SessionTranscriptReadLimits;
};

export type SessionTranscriptReadResult = {
  events: SessionTranscriptEvent[];
  diagnostics: SessionTranscriptReadDiagnostics;
};

export type SessionTranscriptPageOptions = {
  cursor?: string;
  pageSize?: number;
  limits?: Partial<SessionTranscriptReadLimits>;
};

export type SessionTranscriptCursorStatus = "initial" | "valid" | "invalidated";

export type SessionTranscriptCursorInvalidationReason =
  | "cursor_malformed"
  | "revision_changed"
  | "offset_invalid"
  | "source_missing";

export type SessionTranscriptPageReadResult = SessionTranscriptReadResult & {
  revision?: string;
  cursorStatus: SessionTranscriptCursorStatus;
  cursorInvalidationReason?: SessionTranscriptCursorInvalidationReason;
  nextCursor?: string;
};

export type SessionTranscriptEventType =
  | "user_message_accepted"
  | "assistant_message_finalized"
  | "compact_boundary_recorded"
  | "partial_compaction_view_recorded";

export type SessionTranscriptMessagePayload = {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    agentId?: string;
    clientContext?: {
      sentAtMs?: number;
      timezoneOffsetMinutes?: number;
      locale?: string;
    };
  };
  conversation?: {
    agentId?: string;
    channel?: string;
  };
};

export type SessionTranscriptMessageEvent = {
  schemaVersion: number;
  eventId: string;
  conversationId: string;
  type: "user_message_accepted" | "assistant_message_finalized";
  createdAt: number;
  payload: SessionTranscriptMessagePayload;
};

export type SessionTranscriptCompactBoundaryPayload = {
  boundary: {
    id: string;
    trigger: "request" | "manual" | "partial_up_to" | "partial_from";
    createdAt: number;
    summaryStateVersion: number;
    preCompactTokenCount: number;
    postCompactTokenCount: number;
    compactedMessageCount: number;
    tier?: "rolling" | "archival";
    fallbackUsed: boolean;
    rebuildTriggered: boolean;
    preservedSegment: {
      headMessageId?: string;
      anchorId?: string;
      tailMessageId?: string;
      preservedMessageCount: number;
    };
  };
  summaryRef?: {
    kind: "compaction_state" | "partial_compaction_view";
    partialCompactionViewId?: string;
  };
};

export type SessionTranscriptCompactBoundaryEvent = {
  schemaVersion: number;
  eventId: string;
  conversationId: string;
  type: "compact_boundary_recorded";
  createdAt: number;
  payload: SessionTranscriptCompactBoundaryPayload;
};

export type SessionTranscriptPartialCompactionViewPayload = {
  boundaryId?: string;
  view: {
    id: string;
    direction: "from";
    pivotMessageId: string;
    pivotMessageCount: number;
    compactedMessageCount: number;
    summaryMessages: Array<{ role: "user" | "assistant"; content: string }>;
    createdAt: number;
    originalTokens: number;
    compactedTokens: number;
    fallbackUsed: boolean;
    tier?: "rolling" | "archival";
  };
};

export type SessionTranscriptPartialCompactionViewEvent = {
  schemaVersion: number;
  eventId: string;
  conversationId: string;
  type: "partial_compaction_view_recorded";
  createdAt: number;
  payload: SessionTranscriptPartialCompactionViewPayload;
};

export type SessionTranscriptEvent = SessionTranscriptMessageEvent | SessionTranscriptCompactBoundaryEvent | SessionTranscriptPartialCompactionViewEvent | {
  schemaVersion: number;
  eventId: string;
  conversationId: string;
  type: Exclude<SessionTranscriptEventType, SessionTranscriptMessageEvent["type"] | SessionTranscriptCompactBoundaryEvent["type"] | SessionTranscriptPartialCompactionViewEvent["type"]>;
  createdAt: number;
  payload: Record<string, unknown>;
};

export const sessionTranscriptAsyncFs = {
  appendFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void> {
    return fsp.appendFile(filePath, data, encoding);
  },
};

export const sessionTranscriptReadStreamFs = {
  createReadStream(filePath: string, options?: { start?: number; end?: number }): NodeJS.ReadableStream {
    return createReadStream(filePath, options);
  },
};

export const sessionTranscriptFileFs = {
  stat(filePath: string): Promise<{ size: number; mtimeMs: number }> {
    return fsp.stat(filePath);
  },
};

let sessionTranscriptEventIdCounter = 0;

function createSessionTranscriptEventId(createdAt: number): string {
  sessionTranscriptEventIdCounter += 1;
  return `stx_${createdAt}_${sessionTranscriptEventIdCounter.toString(36)}`;
}

export function createSessionTranscriptMessageEvent(input: {
  conversationId: string;
  message: SessionTranscriptMessagePayload["message"];
  conversation?: SessionTranscriptMessagePayload["conversation"];
  createdAt?: number;
}): SessionTranscriptMessageEvent {
  const createdAt = typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
    ? Math.max(0, Math.floor(input.createdAt))
    : Date.now();

  return {
    schemaVersion: SESSION_TRANSCRIPT_SCHEMA_VERSION,
    eventId: createSessionTranscriptEventId(createdAt),
    conversationId: input.conversationId,
    type: input.message.role === "user" ? "user_message_accepted" : "assistant_message_finalized",
    createdAt,
    payload: {
      message: { ...input.message },
      conversation: input.conversation ? { ...input.conversation } : undefined,
    },
  };
}

export function createSessionTranscriptCompactBoundaryEvent(input: {
  conversationId: string;
  boundary: SessionTranscriptCompactBoundaryPayload["boundary"];
  summaryRef?: SessionTranscriptCompactBoundaryPayload["summaryRef"];
  createdAt?: number;
}): SessionTranscriptCompactBoundaryEvent {
  const createdAt = typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
    ? Math.max(0, Math.floor(input.createdAt))
    : Date.now();

  return {
    schemaVersion: SESSION_TRANSCRIPT_SCHEMA_VERSION,
    eventId: createSessionTranscriptEventId(createdAt),
    conversationId: input.conversationId,
    type: "compact_boundary_recorded",
    createdAt,
    payload: {
      boundary: {
        ...input.boundary,
        preservedSegment: { ...input.boundary.preservedSegment },
      },
      summaryRef: input.summaryRef ? { ...input.summaryRef } : undefined,
    },
  };
}

export function createSessionTranscriptPartialCompactionViewEvent(input: {
  conversationId: string;
  boundaryId?: string;
  view: SessionTranscriptPartialCompactionViewPayload["view"];
  createdAt?: number;
}): SessionTranscriptPartialCompactionViewEvent {
  const createdAt = typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
    ? Math.max(0, Math.floor(input.createdAt))
    : Date.now();

  return {
    schemaVersion: SESSION_TRANSCRIPT_SCHEMA_VERSION,
    eventId: createSessionTranscriptEventId(createdAt),
    conversationId: input.conversationId,
    type: "partial_compaction_view_recorded",
    createdAt,
    payload: {
      boundaryId: input.boundaryId,
      view: {
        ...input.view,
        summaryMessages: input.view.summaryMessages.map((message) => ({ ...message })),
      },
    },
  };
}

export function serializeSessionTranscriptEvent(event: SessionTranscriptEvent): string {
  return JSON.stringify(event) + "\n";
}

export async function appendSessionTranscriptEvent(
  filePath: string,
  event: SessionTranscriptEvent,
): Promise<void> {
  await sessionTranscriptAsyncFs.appendFile(filePath, serializeSessionTranscriptEvent(event), "utf-8");
}

export async function readSessionTranscriptFileResult(
  filePath?: string,
  requestedLimits?: Partial<SessionTranscriptReadLimits>,
): Promise<SessionTranscriptReadResult> {
  const limits = normalizeSessionTranscriptReadLimits(requestedLimits);
  const result: SessionTranscriptReadResult = {
    events: [],
    diagnostics: {
      bytesRead: 0,
      lineCount: 0,
      eventCount: 0,
      malformedLineCount: 0,
      oversizedLineCount: 0,
      truncated: false,
      corrupt: false,
      limits,
    },
  };
  if (!filePath) return result;

  try {
    const stream = sessionTranscriptReadStreamFs.createReadStream(filePath);
    let lineParts: Buffer[] = [];
    let lineBytes = 0;
    let lineOversized = false;
    let stopReading = false;

    const appendLineSegment = (segment: Buffer): void => {
      if (segment.length <= 0 || lineOversized) return;
      if (lineBytes + segment.length > limits.maxLineBytes) {
        lineParts = [];
        lineBytes = 0;
        lineOversized = true;
        return;
      }
      lineParts.push(segment);
      lineBytes += segment.length;
    };

    const finishLine = (): void => {
      result.diagnostics.lineCount += 1;
      if (lineOversized) {
        result.diagnostics.oversizedLineCount += 1;
        result.diagnostics.corrupt = true;
      } else {
        const lineBuffer = lineParts.length === 1
          ? lineParts[0]!
          : Buffer.concat(lineParts, lineBytes);
        parseSessionTranscriptLine(lineBuffer, result);
      }
      lineParts = [];
      lineBytes = 0;
      lineOversized = false;
    };

    outer: for await (const rawChunk of stream as AsyncIterable<string | Buffer>) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, "utf8");
      const remainingBytes = limits.maxFileBytes - result.diagnostics.bytesRead;
      if (remainingBytes <= 0) {
        markSessionTranscriptTruncated(result.diagnostics, "file_bytes");
        break;
      }

      const boundedChunk = chunk.length > remainingBytes
        ? chunk.subarray(0, remainingBytes)
        : chunk;
      result.diagnostics.bytesRead += boundedChunk.length;

      let offset = 0;
      while (offset < boundedChunk.length) {
        const newlineIndex = boundedChunk.indexOf(0x0a, offset);
        const segmentEnd = newlineIndex >= 0 ? newlineIndex : boundedChunk.length;
        appendLineSegment(boundedChunk.subarray(offset, segmentEnd));
        if (newlineIndex < 0) break;

        finishLine();
        if (result.diagnostics.truncatedReason === "event_count") {
          stopReading = true;
          break;
        }
        offset = newlineIndex + 1;
      }

      if (stopReading) break outer;
      if (boundedChunk.length < chunk.length) {
        markSessionTranscriptTruncated(result.diagnostics, "file_bytes");
        break;
      }
    }

    if (!result.diagnostics.truncated && (lineParts.length > 0 || lineOversized)) {
      finishLine();
    }
    result.diagnostics.eventCount = result.events.length;
    return result;
  } catch (err) {
    const fsErr = err as NodeJS.ErrnoException;
    if (fsErr.code === "ENOENT") {
      return result;
    }
    throw err;
  }
}

export async function readSessionTranscriptFile(filePath?: string): Promise<SessionTranscriptEvent[]> {
  return (await readSessionTranscriptFileResult(filePath)).events;
}

/**
 * Reads one immutable transcript page. The opaque cursor carries the byte offset
 * and the file revision so a growing transcript never silently skips or replays data.
 */
export async function readSessionTranscriptPage(
  filePath: string | undefined,
  options: SessionTranscriptPageOptions = {},
): Promise<SessionTranscriptPageReadResult> {
  const limits = normalizeSessionTranscriptReadLimits(options.limits);
  const pageSize = normalizeSessionTranscriptPageSize(options.pageSize);
  const result: SessionTranscriptPageReadResult = {
    events: [],
    diagnostics: {
      bytesRead: 0,
      lineCount: 0,
      eventCount: 0,
      malformedLineCount: 0,
      oversizedLineCount: 0,
      truncated: false,
      corrupt: false,
      limits,
    },
    cursorStatus: options.cursor ? "valid" : "initial",
  };
  if (!filePath) {
    return options.cursor
      ? invalidateSessionTranscriptCursor(result, "source_missing")
      : result;
  }

  let stat: { size: number; mtimeMs: number };
  try {
    stat = await sessionTranscriptFileFs.stat(filePath);
  } catch (err) {
    const fsErr = err as NodeJS.ErrnoException;
    if (fsErr.code === "ENOENT") {
      return options.cursor
        ? invalidateSessionTranscriptCursor(result, "source_missing")
        : result;
    }
    throw err;
  }

  const revision = createSessionTranscriptRevision(stat);
  result.revision = revision;
  let startOffset = 0;
  if (options.cursor) {
    const parsedCursor = parseSessionTranscriptCursor(options.cursor);
    if (!parsedCursor) {
      return invalidateSessionTranscriptCursor(result, "cursor_malformed");
    }
    if (parsedCursor.revision !== revision) {
      return invalidateSessionTranscriptCursor(result, "revision_changed");
    }
    if (parsedCursor.offset < 0 || parsedCursor.offset > stat.size) {
      return invalidateSessionTranscriptCursor(result, "offset_invalid");
    }
    startOffset = parsedCursor.offset;
  }

  if (startOffset === stat.size) {
    return result;
  }

  const bytesAvailable = stat.size - startOffset;
  const maxReadableBytes = Math.min(bytesAvailable, limits.maxFileBytes);
  const endOffset = startOffset + maxReadableBytes - 1;
  const stream = sessionTranscriptReadStreamFs.createReadStream(filePath, {
    start: startOffset,
    end: endOffset,
  });
  let lineParts: Buffer[] = [];
  let lineBytes = 0;
  let lineOversized = false;
  let absoluteChunkStart = startOffset;
  let nextOffset: number | undefined;
  let pageFilled = false;

  const appendLineSegment = (segment: Buffer): void => {
    if (segment.length <= 0 || lineOversized) return;
    if (lineBytes + segment.length > limits.maxLineBytes) {
      lineParts = [];
      lineBytes = 0;
      lineOversized = true;
      return;
    }
    lineParts.push(segment);
    lineBytes += segment.length;
  };

  const finishLine = (): boolean => {
    result.diagnostics.lineCount += 1;
    let added = false;
    if (lineOversized) {
      result.diagnostics.oversizedLineCount += 1;
      result.diagnostics.corrupt = true;
    } else {
      const lineBuffer = lineParts.length === 1
        ? lineParts[0]!
        : Buffer.concat(lineParts, lineBytes);
      added = parseSessionTranscriptPageLine(lineBuffer, result);
    }
    lineParts = [];
    lineBytes = 0;
    lineOversized = false;
    return added;
  };

  try {
    outer: for await (const rawChunk of stream as AsyncIterable<string | Buffer>) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, "utf8");
      result.diagnostics.bytesRead += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        const newlineIndex = chunk.indexOf(0x0a, offset);
        const segmentEnd = newlineIndex >= 0 ? newlineIndex : chunk.length;
        appendLineSegment(chunk.subarray(offset, segmentEnd));
        if (newlineIndex < 0) break;

        const added = finishLine();
        const lineEndOffset = absoluteChunkStart + newlineIndex + 1;
        if (added && result.events.length >= pageSize) {
          pageFilled = true;
          nextOffset = lineEndOffset;
          break outer;
        }
        offset = newlineIndex + 1;
      }
      absoluteChunkStart += chunk.length;
    }
  } catch (err) {
    const fsErr = err as NodeJS.ErrnoException;
    if (fsErr.code === "ENOENT") {
      return options.cursor
        ? invalidateSessionTranscriptCursor(result, "source_missing")
        : result;
    }
    throw err;
  }

  if (!pageFilled && (lineParts.length > 0 || lineOversized)) {
    finishLine();
  }
  if (!pageFilled && bytesAvailable > maxReadableBytes) {
    markSessionTranscriptTruncated(result.diagnostics, "file_bytes");
  }
  result.diagnostics.eventCount = result.events.length;
  if (pageFilled && typeof nextOffset === "number" && nextOffset < stat.size) {
    result.nextCursor = serializeSessionTranscriptCursor({ revision, offset: nextOffset });
  }
  return result;
}

function normalizeSessionTranscriptReadLimits(
  requested?: Partial<SessionTranscriptReadLimits>,
): SessionTranscriptReadLimits {
  return {
    maxFileBytes: normalizePositiveSafeInteger(
      requested?.maxFileBytes,
      DEFAULT_SESSION_TRANSCRIPT_READ_LIMITS.maxFileBytes,
    ),
    maxLineBytes: normalizePositiveSafeInteger(
      requested?.maxLineBytes,
      DEFAULT_SESSION_TRANSCRIPT_READ_LIMITS.maxLineBytes,
    ),
    maxEvents: normalizePositiveSafeInteger(
      requested?.maxEvents,
      DEFAULT_SESSION_TRANSCRIPT_READ_LIMITS.maxEvents,
    ),
  };
}

function normalizePositiveSafeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function normalizeSessionTranscriptPageSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_SESSION_TRANSCRIPT_PAGE_SIZE;
  }
  return Math.min(value, MAX_SESSION_TRANSCRIPT_PAGE_SIZE);
}

type SessionTranscriptCursorPayload = {
  version: 1;
  revision: string;
  offset: number;
};

function createSessionTranscriptRevision(stat: { size: number; mtimeMs: number }): string {
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

function serializeSessionTranscriptCursor(payload: Omit<SessionTranscriptCursorPayload, "version">): string {
  return Buffer.from(JSON.stringify({ version: 1, ...payload } satisfies SessionTranscriptCursorPayload), "utf8")
    .toString("base64url");
}

function parseSessionTranscriptCursor(cursor: string): SessionTranscriptCursorPayload | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<SessionTranscriptCursorPayload>;
    if (parsed.version !== 1 || typeof parsed.revision !== "string" || !parsed.revision) return undefined;
    if (typeof parsed.offset !== "number" || !Number.isSafeInteger(parsed.offset)) return undefined;
    return {
      version: 1,
      revision: parsed.revision,
      offset: parsed.offset,
    };
  } catch {
    return undefined;
  }
}

function invalidateSessionTranscriptCursor(
  result: SessionTranscriptPageReadResult,
  reason: SessionTranscriptCursorInvalidationReason,
): SessionTranscriptPageReadResult {
  result.cursorStatus = "invalidated";
  result.cursorInvalidationReason = reason;
  return result;
}

function markSessionTranscriptTruncated(
  diagnostics: SessionTranscriptReadDiagnostics,
  reason: SessionTranscriptTruncatedReason,
): void {
  diagnostics.truncated = true;
  diagnostics.truncatedReason = reason;
}

function parseSessionTranscriptLine(
  rawLine: Buffer,
  result: SessionTranscriptReadResult,
): void {
  const withoutCarriageReturn = rawLine.at(-1) === 0x0d
    ? rawLine.subarray(0, rawLine.length - 1)
    : rawLine;
  const line = withoutCarriageReturn.toString("utf8").trim();
  if (!line) return;
  if (result.events.length >= result.diagnostics.limits.maxEvents) {
    markSessionTranscriptTruncated(result.diagnostics, "event_count");
    return;
  }

  try {
    const parsed = JSON.parse(line) as SessionTranscriptEvent;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid transcript event.");
    }
    if (typeof parsed.conversationId !== "string" || typeof parsed.type !== "string") {
      throw new Error("Invalid transcript event identity.");
    }
    result.events.push(parsed);
  } catch {
    // Preserve tolerance for partial or malformed JSONL while making it observable.
    result.diagnostics.malformedLineCount += 1;
    result.diagnostics.corrupt = true;
  }
}

function parseSessionTranscriptPageLine(
  rawLine: Buffer,
  result: SessionTranscriptPageReadResult,
): boolean {
  const withoutCarriageReturn = rawLine.at(-1) === 0x0d
    ? rawLine.subarray(0, rawLine.length - 1)
    : rawLine;
  const line = withoutCarriageReturn.toString("utf8").trim();
  if (!line) return false;

  try {
    const parsed = JSON.parse(line) as SessionTranscriptEvent;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid transcript event.");
    }
    if (typeof parsed.conversationId !== "string" || typeof parsed.type !== "string") {
      throw new Error("Invalid transcript event identity.");
    }
    result.events.push(parsed);
    return true;
  } catch {
    result.diagnostics.malformedLineCount += 1;
    result.diagnostics.corrupt = true;
    return false;
  }
}
