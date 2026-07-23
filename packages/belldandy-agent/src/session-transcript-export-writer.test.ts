import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { SessionTranscriptExportBundle } from "./session-transcript-export.js";
import { writeSessionTranscriptExportBundle } from "./session-transcript-export-writer.js";

describe("writeSessionTranscriptExportBundle", () => {
  it("writes a parse-equivalent bundle incrementally and atomically", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-transcript-export-writer-"));
    const targetPath = path.join(tempDir, "transcript.json");
    const bundle = createBundle();

    try {
      await writeSessionTranscriptExportBundle(targetPath, bundle, { pretty: true });

      await expect(fs.readFile(targetPath, "utf8")).resolves.toEqual(expect.any(String));
      const written = JSON.parse(await fs.readFile(targetPath, "utf8"));
      expect(written).toEqual(bundle);
      await expect(fs.readdir(tempDir)).resolves.toEqual(["transcript.json"]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function createBundle(): SessionTranscriptExportBundle {
  return {
    manifest: {
      schemaVersion: 1,
      conversationId: "conv-export-writer",
      exportedAt: 1,
      source: "conversation.transcript.export",
      redactionMode: "internal",
    },
    events: [
      {
        schemaVersion: 1,
        eventId: "event-1",
        conversationId: "conv-export-writer",
        type: "user_message_accepted",
        createdAt: 1,
        payload: { message: { id: "message-1", role: "user", content: "first" } },
      },
      {
        schemaVersion: 1,
        eventId: "event-2",
        conversationId: "conv-export-writer",
        type: "assistant_message_finalized",
        createdAt: 2,
        payload: { message: { id: "message-2", role: "assistant", content: "second" } },
      },
    ],
    restore: {
      rawMessages: [
        { id: "message-1", role: "user", content: "first" },
        { id: "message-2", role: "assistant", content: "second" },
      ],
      compactedView: [],
      canonicalExtractionView: [],
      diagnostics: {
        source: "transcript",
        transcriptEventCount: 2,
        transcriptMessageEventCount: 2,
        transcriptUsed: true,
        relinkAttempted: false,
        relinkApplied: false,
        fallbackToRaw: false,
      },
    },
    summary: {
      eventCount: 2,
      messageEventCount: 2,
      compactBoundaryCount: 0,
      partialCompactionViewCount: 0,
      latestEventAt: 2,
      restore: {
        source: "transcript",
        relinkApplied: false,
        fallbackToRaw: false,
      },
    },
    redaction: {
      mode: "internal",
      contentRedacted: false,
      notes: ["Full transcript and restore text are preserved for internal debugging."],
    },
  };
}
