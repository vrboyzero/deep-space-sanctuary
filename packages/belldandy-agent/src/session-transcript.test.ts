import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSessionTranscriptFile,
  readSessionTranscriptFileResult,
  readSessionTranscriptPage,
  sessionTranscriptReadStreamFs,
  type SessionTranscriptEvent,
} from "./session-transcript.js";

describe("readSessionTranscriptFile", () => {
  const originalCreateReadStream = sessionTranscriptReadStreamFs.createReadStream;

  afterEach(() => {
    sessionTranscriptReadStreamFs.createReadStream = originalCreateReadStream;
  });

  it("reads chunked transcript input without buffering the complete file", async () => {
    const firstEvent: SessionTranscriptEvent = {
      schemaVersion: 1,
      eventId: "stx-first",
      conversationId: "conv-streamed",
      type: "user_message_accepted",
      createdAt: 1,
      payload: {
        message: {
          id: "message-first",
          role: "user",
          content: "first",
          timestamp: 1,
        },
      },
    };
    const secondEvent: SessionTranscriptEvent = {
      schemaVersion: 1,
      eventId: "stx-second",
      conversationId: "conv-streamed",
      type: "assistant_message_finalized",
      createdAt: 2,
      payload: {
        message: {
          id: "message-second",
          role: "assistant",
          content: "second",
          timestamp: 2,
        },
      },
    };
    const createReadStream = vi.fn(() => Readable.from([
      `${JSON.stringify(firstEvent).slice(0, 32)}`,
      `${JSON.stringify(firstEvent).slice(32)}\nnot-json\n`,
      `${JSON.stringify(secondEvent)}\n`,
    ]));
    sessionTranscriptReadStreamFs.createReadStream = createReadStream;

    await expect(readSessionTranscriptFile("virtual.transcript.jsonl")).resolves.toEqual([
      firstEvent,
      secondEvent,
    ]);
    expect(createReadStream).toHaveBeenCalledWith("virtual.transcript.jsonl");
  });

  it("stops at the file byte limit without parsing a partial event", async () => {
    const firstEvent = buildMessageEvent("stx-file-first", "first");
    const secondEvent = buildMessageEvent("stx-file-second", "second");
    const firstLine = `${JSON.stringify(firstEvent)}\n`;
    const stream = Readable.from([
      firstLine,
      `${JSON.stringify(secondEvent)}\n`,
    ]);
    sessionTranscriptReadStreamFs.createReadStream = vi.fn(() => stream);

    await expect(readSessionTranscriptFileResult("virtual.transcript.jsonl", {
      maxFileBytes: Buffer.byteLength(firstLine, "utf8") + 8,
      maxLineBytes: 1024,
      maxEvents: 10,
    })).resolves.toEqual({
      events: [firstEvent],
      diagnostics: expect.objectContaining({
        truncated: true,
        corrupt: false,
        truncatedReason: "file_bytes",
        eventCount: 1,
      }),
    });
    expect(stream.destroyed).toBe(true);
  });

  it("preserves multibyte events across chunks, CRLF, and a final line without newline", async () => {
    const firstEvent = buildMessageEvent("stx-crlf", "第一条");
    const secondEvent = buildMessageEvent("stx-no-tail-newline", "第二条");
    const firstBytes = Buffer.from(`${JSON.stringify(firstEvent)}\r\n`, "utf8");
    const splitAt = firstBytes.indexOf(Buffer.from("一", "utf8")) + 1;
    sessionTranscriptReadStreamFs.createReadStream = vi.fn(() => Readable.from([
      firstBytes.subarray(0, splitAt),
      Buffer.concat([
        firstBytes.subarray(splitAt),
        Buffer.from(JSON.stringify(secondEvent), "utf8"),
      ]),
    ]));

    const result = await readSessionTranscriptFileResult("virtual.transcript.jsonl", {
      maxFileBytes: 4096,
      maxLineBytes: 1024,
      maxEvents: 10,
    });

    expect(result.events).toEqual([firstEvent, secondEvent]);
    expect(result.diagnostics).toMatchObject({
      lineCount: 2,
      eventCount: 2,
      truncated: false,
      corrupt: false,
    });
  });

  it("skips an oversized line, reports corruption, and continues with later events", async () => {
    const event = buildMessageEvent("stx-after-oversized", "after");
    sessionTranscriptReadStreamFs.createReadStream = vi.fn(() => Readable.from([
      `${"x".repeat(512)}\n${JSON.stringify(event)}\n`,
    ]));

    await expect(readSessionTranscriptFileResult("virtual.transcript.jsonl", {
      maxFileBytes: 4096,
      maxLineBytes: 256,
      maxEvents: 10,
    })).resolves.toEqual({
      events: [event],
      diagnostics: expect.objectContaining({
        truncated: false,
        corrupt: true,
        oversizedLineCount: 1,
        malformedLineCount: 0,
        eventCount: 1,
      }),
    });
  });

  it("stops before the next valid event when the event limit is reached", async () => {
    const firstEvent = buildMessageEvent("stx-event-first", "first");
    const secondEvent = buildMessageEvent("stx-event-second", "second");
    sessionTranscriptReadStreamFs.createReadStream = vi.fn(() => Readable.from([
      `${JSON.stringify(firstEvent)}\n${JSON.stringify(secondEvent)}\n`,
    ]));

    await expect(readSessionTranscriptFileResult("virtual.transcript.jsonl", {
      maxFileBytes: 4096,
      maxLineBytes: 1024,
      maxEvents: 1,
    })).resolves.toEqual({
      events: [firstEvent],
      diagnostics: expect.objectContaining({
        truncated: true,
        corrupt: false,
        truncatedReason: "event_count",
        eventCount: 1,
      }),
    });
  });

  it("does not report truncation when the event count exactly reaches the limit", async () => {
    const event = buildMessageEvent("stx-event-exact", "only");
    sessionTranscriptReadStreamFs.createReadStream = vi.fn(() => Readable.from([
      `${JSON.stringify(event)}\n\n`,
    ]));

    const result = await readSessionTranscriptFileResult("virtual.transcript.jsonl", {
      maxFileBytes: 4096,
      maxLineBytes: 1024,
      maxEvents: 1,
    });

    expect(result.events).toEqual([event]);
    expect(result.diagnostics).toMatchObject({
      eventCount: 1,
      truncated: false,
      corrupt: false,
    });
  });

  it("reports malformed lines separately from hard-limit truncation", async () => {
    const event = buildMessageEvent("stx-after-malformed", "after");
    sessionTranscriptReadStreamFs.createReadStream = vi.fn(() => Readable.from([
      `not-json\n${JSON.stringify(event)}\n`,
    ]));

    const result = await readSessionTranscriptFileResult("virtual.transcript.jsonl", {
      maxFileBytes: 4096,
      maxLineBytes: 1024,
      maxEvents: 10,
    });

    expect(result.events).toEqual([event]);
    expect(result.diagnostics).toMatchObject({
      truncated: false,
      corrupt: true,
      malformedLineCount: 1,
      oversizedLineCount: 0,
      eventCount: 1,
    });
  });

  it("reads timeline-sized pages from a byte cursor without replaying prior events", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-transcript-page-"));
    const transcriptPath = path.join(tempDir, "page.transcript.jsonl");
    const events = [
      buildMessageEvent("stx-page-1", "first"),
      buildMessageEvent("stx-page-2", "second"),
      buildMessageEvent("stx-page-3", "third"),
    ];
    const firstTwoLines = events.slice(0, 2).map((event) => `${JSON.stringify(event)}\n`).join("");
    await fs.writeFile(transcriptPath, `${firstTwoLines}${JSON.stringify(events[2])}\n`, "utf8");
    const createReadStream = vi.spyOn(sessionTranscriptReadStreamFs, "createReadStream");

    try {
      const firstPage = await readSessionTranscriptPage(transcriptPath, { pageSize: 2 });
      expect(firstPage).toMatchObject({
        events: events.slice(0, 2),
        cursorStatus: "initial",
        nextCursor: expect.any(String),
      });

      const secondPage = await readSessionTranscriptPage(transcriptPath, {
        cursor: firstPage.nextCursor,
        pageSize: 2,
      });
      expect(secondPage).toMatchObject({
        events: [events[2]],
        cursorStatus: "valid",
      });
      expect(secondPage.nextCursor).toBeUndefined();
      expect(createReadStream).toHaveBeenNthCalledWith(2, transcriptPath, expect.objectContaining({
        start: Buffer.byteLength(firstTwoLines, "utf8"),
      }));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("invalidates a transcript page cursor when the source revision changes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-transcript-page-"));
    const transcriptPath = path.join(tempDir, "changed.transcript.jsonl");
    const firstEvent = buildMessageEvent("stx-page-revision-1", "first");
    const secondEvent = buildMessageEvent("stx-page-revision-2", "second");
    await fs.writeFile(transcriptPath, `${JSON.stringify(firstEvent)}\n${JSON.stringify(secondEvent)}\n`, "utf8");

    try {
      const firstPage = await readSessionTranscriptPage(transcriptPath, { pageSize: 1 });
      await fs.appendFile(transcriptPath, `${JSON.stringify(buildMessageEvent("stx-page-revision-3", "third"))}\n`, "utf8");

      await expect(readSessionTranscriptPage(transcriptPath, {
        cursor: firstPage.nextCursor,
        pageSize: 1,
      })).resolves.toMatchObject({
        events: [],
        cursorStatus: "invalidated",
        cursorInvalidationReason: "revision_changed",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function buildMessageEvent(eventId: string, content: string): SessionTranscriptEvent {
  return {
    schemaVersion: 1,
    eventId,
    conversationId: "conv-bounded",
    type: "user_message_accepted",
    createdAt: 1,
    payload: {
      message: {
        id: `${eventId}-message`,
        role: "user",
        content,
        timestamp: 1,
      },
    },
  };
}
