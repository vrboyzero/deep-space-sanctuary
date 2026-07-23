import * as fsp from "node:fs/promises";
import path from "node:path";

import type {
  SessionTranscriptCompactBoundaryEvent,
  SessionTranscriptEvent,
  SessionTranscriptPartialCompactionViewEvent,
} from "./session-transcript.js";
import { readSessionTranscriptFileResult } from "./session-transcript.js";
import type { TranscriptRelinkArtifacts } from "./session-transcript-relink.js";

export const SESSION_TRANSCRIPT_BOUNDARY_INDEX_SCHEMA_VERSION = 1;

type SessionTranscriptRevision = {
  size: number;
  mtimeMs: number;
};

export type SessionTranscriptBoundaryIndex = {
  schemaVersion: number;
  conversationId: string;
  revision: SessionTranscriptRevision;
  boundary: {
    eventId: string;
    createdAt: number;
    boundary: SessionTranscriptCompactBoundaryEvent["payload"]["boundary"];
  };
  partialView?: {
    eventId: string;
    createdAt: number;
    boundaryId?: string;
    view: SessionTranscriptPartialCompactionViewEvent["payload"]["view"];
  };
};

export function getSessionTranscriptBoundaryIndexPath(transcriptPath?: string): string | undefined {
  if (!transcriptPath) return undefined;
  return transcriptPath.endsWith(".transcript.jsonl")
    ? `${transcriptPath.slice(0, -".jsonl".length)}.boundary-index.json`
    : `${transcriptPath}.boundary-index.json`;
}

export async function readSessionTranscriptBoundaryIndex(
  transcriptPath: string | undefined,
  indexPath: string | undefined,
): Promise<SessionTranscriptBoundaryIndex | undefined> {
  if (!transcriptPath || !indexPath) return undefined;
  const index = await readSessionTranscriptBoundaryIndexFile(indexPath);
  if (!index) return undefined;

  try {
    const stat = await fsp.stat(transcriptPath);
    return isSameRevision(index.revision, toRevision(stat)) ? index : undefined;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function rebuildSessionTranscriptBoundaryIndex(
  transcriptPath: string | undefined,
  indexPath: string | undefined,
): Promise<SessionTranscriptBoundaryIndex | undefined> {
  if (!transcriptPath || !indexPath) return undefined;
  let beforeStat: { size: number; mtimeMs: number };
  try {
    beforeStat = await fsp.stat(transcriptPath);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") return undefined;
    throw error;
  }

  const transcript = await readSessionTranscriptFileResult(transcriptPath);
  if (transcript.diagnostics.truncated) return undefined;
  const afterStat = await fsp.stat(transcriptPath);
  if (!isSameRevision(toRevision(beforeStat), toRevision(afterStat))) {
    return undefined;
  }

  const index = buildSessionTranscriptBoundaryIndex(transcript.events, toRevision(afterStat));
  if (!index) {
    await fsp.unlink(indexPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return undefined;
  }
  await writeSessionTranscriptBoundaryIndex(indexPath, index);
  return index;
}

export async function writeSessionTranscriptBoundaryIndexFromEvents(
  transcriptPath: string | undefined,
  indexPath: string | undefined,
  events: SessionTranscriptEvent[],
): Promise<SessionTranscriptBoundaryIndex | undefined> {
  if (!transcriptPath || !indexPath) return undefined;
  const stat = await fsp.stat(transcriptPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return undefined;
  const index = buildSessionTranscriptBoundaryIndex(events, toRevision(stat));
  if (!index) return undefined;
  await writeSessionTranscriptBoundaryIndex(indexPath, index);
  return index;
}

/** Updates only revision metadata after a normal append; compaction events use full rebuild. */
export async function refreshSessionTranscriptBoundaryIndexRevision(
  transcriptPath: string | undefined,
  indexPath: string | undefined,
): Promise<SessionTranscriptBoundaryIndex | undefined> {
  if (!transcriptPath || !indexPath) return undefined;
  const index = await readSessionTranscriptBoundaryIndexFile(indexPath);
  if (!index) return undefined;
  const stat = await fsp.stat(transcriptPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return undefined;
  const refreshed = { ...index, revision: toRevision(stat) };
  await writeSessionTranscriptBoundaryIndex(indexPath, refreshed);
  return refreshed;
}

export function toTranscriptRelinkArtifacts(
  index: SessionTranscriptBoundaryIndex,
): TranscriptRelinkArtifacts {
  return {
    boundary: { ...index.boundary.boundary, preservedSegment: { ...index.boundary.boundary.preservedSegment } },
    partialView: index.partialView
      ? {
        ...index.partialView.view,
        summaryMessages: index.partialView.view.summaryMessages.map((message) => ({ ...message })),
      }
      : undefined,
  };
}

function buildSessionTranscriptBoundaryIndex(
  events: SessionTranscriptEvent[],
  revision: SessionTranscriptRevision,
): SessionTranscriptBoundaryIndex | undefined {
  const boundaryEvents = events.filter(isCompactBoundaryEvent);
  const latestBoundary = boundaryEvents.at(-1);
  if (!latestBoundary) return undefined;
  const partialView = latestBoundary.payload.boundary.trigger === "partial_from"
    ? events
      .filter(isPartialCompactionViewEvent)
      .filter((event) => !event.payload.boundaryId || event.payload.boundaryId === latestBoundary.payload.boundary.id)
      .at(-1)
    : undefined;

  return {
    schemaVersion: SESSION_TRANSCRIPT_BOUNDARY_INDEX_SCHEMA_VERSION,
    conversationId: latestBoundary.conversationId,
    revision,
    boundary: {
      eventId: latestBoundary.eventId,
      createdAt: latestBoundary.createdAt,
      boundary: {
        ...latestBoundary.payload.boundary,
        preservedSegment: { ...latestBoundary.payload.boundary.preservedSegment },
      },
    },
    ...(partialView ? {
      partialView: {
        eventId: partialView.eventId,
        createdAt: partialView.createdAt,
        boundaryId: partialView.payload.boundaryId,
        view: {
          ...partialView.payload.view,
          summaryMessages: partialView.payload.view.summaryMessages.map((message) => ({ ...message })),
        },
      },
    } : {}),
  };
}

function isCompactBoundaryEvent(event: SessionTranscriptEvent): event is SessionTranscriptCompactBoundaryEvent {
  return event.type === "compact_boundary_recorded";
}

function isPartialCompactionViewEvent(event: SessionTranscriptEvent): event is SessionTranscriptPartialCompactionViewEvent {
  return event.type === "partial_compaction_view_recorded";
}

function toRevision(stat: { size: number; mtimeMs: number }): SessionTranscriptRevision {
  return {
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
  };
}

function isSameRevision(left: SessionTranscriptRevision, right: SessionTranscriptRevision): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function readSessionTranscriptBoundaryIndexFile(
  indexPath: string,
): Promise<SessionTranscriptBoundaryIndex | undefined> {
  try {
    const raw = JSON.parse(await fsp.readFile(indexPath, "utf8")) as unknown;
    return isSessionTranscriptBoundaryIndex(raw) ? raw : undefined;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isSessionTranscriptBoundaryIndex(value: unknown): value is SessionTranscriptBoundaryIndex {
  if (!value || typeof value !== "object") return false;
  const index = value as Partial<SessionTranscriptBoundaryIndex>;
  if (index.schemaVersion !== SESSION_TRANSCRIPT_BOUNDARY_INDEX_SCHEMA_VERSION) return false;
  if (typeof index.conversationId !== "string" || !index.conversationId) return false;
  if (!index.revision || !Number.isSafeInteger(index.revision.size) || index.revision.size < 0) return false;
  if (!Number.isSafeInteger(index.revision.mtimeMs) || index.revision.mtimeMs < 0) return false;
  if (!index.boundary || typeof index.boundary.eventId !== "string") return false;
  if (!index.boundary.boundary || typeof index.boundary.boundary.id !== "string") return false;
  return true;
}

async function writeSessionTranscriptBoundaryIndex(
  indexPath: string,
  index: SessionTranscriptBoundaryIndex,
): Promise<void> {
  await fsp.mkdir(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(tempPath, JSON.stringify(index), "utf8");
    await fsp.rename(tempPath, indexPath);
  } catch (error) {
    await fsp.unlink(tempPath).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
}
