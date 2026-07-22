import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSessionTranscriptFile,
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
});
