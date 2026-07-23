import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getSessionTranscriptBoundaryIndexPath,
  readSessionTranscriptBoundaryIndex,
  rebuildSessionTranscriptBoundaryIndex,
  refreshSessionTranscriptBoundaryIndexRevision,
} from "./session-transcript-boundary-index.js";
import type { SessionTranscriptEvent } from "./session-transcript.js";

describe("session transcript boundary side index", () => {
  it("rebuilds the latest boundary and remains valid after a known message append", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-boundary-index-"));
    const transcriptPath = path.join(tempDir, "conv.transcript.jsonl");
    const indexPath = getSessionTranscriptBoundaryIndexPath(transcriptPath)!;
    const events = [buildMessageEvent(), buildBoundaryEvent()];
    await fs.writeFile(transcriptPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");

    try {
      await rebuildSessionTranscriptBoundaryIndex(transcriptPath, indexPath);
      await expect(readSessionTranscriptBoundaryIndex(transcriptPath, indexPath)).resolves.toMatchObject({
        conversationId: "conv-boundary-index",
        boundary: {
          eventId: "boundary-1",
          boundary: { id: "boundary-1" },
        },
      });

      await fs.appendFile(transcriptPath, `${JSON.stringify(buildMessageEvent("message-2"))}\n`, "utf8");
      await refreshSessionTranscriptBoundaryIndexRevision(transcriptPath, indexPath);
      await expect(readSessionTranscriptBoundaryIndex(transcriptPath, indexPath)).resolves.toMatchObject({
        boundary: { eventId: "boundary-1" },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a stale index until a full rebuild refreshes it", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-boundary-index-"));
    const transcriptPath = path.join(tempDir, "stale.transcript.jsonl");
    const indexPath = getSessionTranscriptBoundaryIndexPath(transcriptPath)!;
    await fs.writeFile(transcriptPath, `${JSON.stringify(buildBoundaryEvent())}\n`, "utf8");

    try {
      await rebuildSessionTranscriptBoundaryIndex(transcriptPath, indexPath);
      await fs.appendFile(transcriptPath, `${JSON.stringify(buildMessageEvent("message-after-stale"))}\n`, "utf8");

      await expect(readSessionTranscriptBoundaryIndex(transcriptPath, indexPath)).resolves.toBeUndefined();
      await rebuildSessionTranscriptBoundaryIndex(transcriptPath, indexPath);
      await expect(readSessionTranscriptBoundaryIndex(transcriptPath, indexPath)).resolves.toMatchObject({
        boundary: { eventId: "boundary-1" },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function buildMessageEvent(eventId = "message-1"): SessionTranscriptEvent {
  return {
    schemaVersion: 1,
    eventId,
    conversationId: "conv-boundary-index",
    type: "user_message_accepted",
    createdAt: 1,
    payload: {
      message: { id: eventId, role: "user", content: eventId, timestamp: 1 },
    },
  };
}

function buildBoundaryEvent(): SessionTranscriptEvent {
  return {
    schemaVersion: 1,
    eventId: "boundary-1",
    conversationId: "conv-boundary-index",
    type: "compact_boundary_recorded",
    createdAt: 2,
    payload: {
      boundary: {
        id: "boundary-1",
        trigger: "request",
        createdAt: 2,
        summaryStateVersion: 1,
        preCompactTokenCount: 10,
        postCompactTokenCount: 5,
        compactedMessageCount: 1,
        fallbackUsed: false,
        rebuildTriggered: false,
        preservedSegment: { preservedMessageCount: 0 },
      },
    },
  };
}
