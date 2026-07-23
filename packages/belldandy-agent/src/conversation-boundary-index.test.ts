import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ConversationStore } from "./conversation.js";
import { sessionTranscriptReadStreamFs } from "./session-transcript.js";

describe("ConversationStore transcript boundary side index", () => {
  it("uses the persisted latest boundary index for a cold compacted-history read", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-conversation-boundary-index-"));
    const dataDir = path.join(tempDir, "sessions");
    const conversationId = "conv-boundary-index-cold-read";
    const store = new ConversationStore({
      dataDir,
      compaction: {
        enabled: true,
        tokenThreshold: 10,
        keepRecentCount: 1,
      },
      summarizer: async () => "boundary-index-summary",
    });
    store.addMessage(conversationId, "user", "A".repeat(80));
    store.addMessage(conversationId, "assistant", "B".repeat(80));
    store.addMessage(conversationId, "user", "C".repeat(80));

    try {
      await store.forceCompact(conversationId);
      await store.waitForPendingPersistence(conversationId);
      await expect(fs.promises.access(path.join(dataDir, `${conversationId}.transcript.boundary-index.json`))).resolves.toBeUndefined();

      const reloaded = new ConversationStore({ dataDir });
      const transcriptRead = vi.spyOn(sessionTranscriptReadStreamFs, "createReadStream");
      const compacted = await reloaded.getConversationHistoryCompacted(conversationId);

      expect(compacted.boundary).toMatchObject({ trigger: "manual" });
      expect(transcriptRead).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
