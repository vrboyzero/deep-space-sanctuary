import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ConversationStore } from "@belldandy/agent";
import { ResidentConversationStore } from "./resident-conversation-store.js";

function createResidentRegistry() {
  const coderProfile = {
    id: "coder",
    displayName: "Coder",
    model: "primary",
    kind: "resident" as const,
    memoryMode: "isolated" as const,
    sessionNamespace: "coder-main",
    workspaceBinding: "current" as const,
    workspaceDir: "coder",
  };
  return {
    getProfile: (agentId: string) => agentId === coderProfile.id ? coderProfile : undefined,
    list: () => [coderProfile],
  } as any;
}

describe("ResidentConversationStore lifecycle", () => {
  it("routes snapshot and release to the resident store, then evicts idle tracking", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-resident-store-"));
    try {
      const conversationId = "agent:coder:main";
      const store = new ResidentConversationStore({
        stateDir,
        agentRegistry: createResidentRegistry(),
      });
      store.addMessage(conversationId, "user", "resident canonical history");
      store.recordToolArtifacts(conversationId, {
        toolDigest: {
          toolName: "file_read",
          success: true,
          summary: "resident artifact",
          toolCallId: "resident-call-1",
        },
        recentToolResult: {
          toolCallId: "resident-call-1",
          toolName: "file_read",
          success: true,
          summary: "resident artifact",
          content: "resident result",
        },
      });
      await store.waitForPendingPersistence(conversationId);
      expect(store.getRecentToolResults(conversationId)).toMatchObject([
        expect.objectContaining({ toolCallId: "resident-call-1", content: "resident result" }),
      ]);

      expect(store.getConversationRuntimeSnapshot(conversationId)).toMatchObject({
        retainedConversation: true,
      });
      const residentEntry = [...(store as any).residentStores.values()][0] as { store: ConversationStore };
      const residentStore = residentEntry.store;
      const release = vi.spyOn(residentStore, "releaseConversation");
      expect((store as any).migratedResidentConversationIds.has(conversationId)).toBe(true);

      await store.releaseConversation(conversationId);

      expect(release).toHaveBeenCalledWith(conversationId);
      expect((store as any).residentStores.size).toBe(0);
      expect((store as any).migratedResidentConversationIds.has(conversationId)).toBe(false);
      expect(store.getRecentToolResults(conversationId)).toMatchObject([
        expect.objectContaining({ toolCallId: "resident-call-1", content: "resident result" }),
      ]);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("does not retain profile stores created only for persisted listing", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-resident-list-"));
    try {
      const store = new ResidentConversationStore({
        stateDir,
        agentRegistry: createResidentRegistry(),
      });

      await expect(store.listPersistedConversations()).resolves.toEqual([]);
      expect((store as any).residentStores.size).toBe(0);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("waits for an active resident call to settle before evicting its store entry", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-resident-active-"));
    try {
      let resolveSummary!: (value: string) => void;
      const summaryPending = new Promise<string>((resolve) => {
        resolveSummary = resolve;
      });
      const summarizer = vi.fn(() => summaryPending);
      const conversationId = "agent:coder:active";
      const store = new ResidentConversationStore({
        stateDir,
        agentRegistry: createResidentRegistry(),
        summarizer,
        compaction: {
          enabled: true,
          tokenThreshold: 1,
          keepRecentCount: 1,
        },
      });
      store.addMessage(conversationId, "user", "resident summary pending");

      const refresh = store.refreshSessionMemory(conversationId, { force: true });
      await vi.waitFor(() => expect(summarizer).toHaveBeenCalledTimes(1));
      await store.releaseConversation(conversationId);

      expect((store as any).residentStores.size).toBe(1);
      resolveSummary(JSON.stringify({ summary: "late resident summary" }));
      await expect(refresh).resolves.toMatchObject({ updated: false });
      expect((store as any).residentStores.size).toBe(0);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps resident tracking when a new call takes over during release", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-resident-takeover-"));
    try {
      const conversationId = "agent:coder:takeover";
      const store = new ResidentConversationStore({
        stateDir,
        agentRegistry: createResidentRegistry(),
      });
      store.addMessage(conversationId, "user", "keep tracking for takeover");
      await store.waitForPendingPersistence(conversationId);

      const residentEntry = [...(store as any).residentStores.values()][0] as { store: ConversationStore };
      let resolveUnderlyingRelease!: () => void;
      const underlyingReleasePending = new Promise<void>((resolve) => {
        resolveUnderlyingRelease = resolve;
      });
      const underlyingRelease = vi.spyOn(residentEntry.store, "releaseConversation")
        .mockReturnValue(underlyingReleasePending);

      const release = store.releaseConversation(conversationId);
      await vi.waitFor(() => expect(underlyingRelease).toHaveBeenCalledOnce());
      expect(store.getHistory(conversationId)).toEqual([
        { role: "user", content: "keep tracking for takeover" },
      ]);
      resolveUnderlyingRelease();
      await release;

      expect((store as any).residentStores.size).toBe(1);
      expect((store as any).migratedResidentConversationIds.has(conversationId)).toBe(true);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps a shared resident store until every tracked conversation is released", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "belldandy-resident-shared-"));
    try {
      const firstId = "agent:coder:first";
      const secondId = "agent:coder:second";
      const store = new ResidentConversationStore({
        stateDir,
        agentRegistry: createResidentRegistry(),
      });
      store.addMessage(firstId, "user", "first resident conversation");
      store.addMessage(secondId, "user", "second resident conversation");
      await Promise.all([
        store.waitForPendingPersistence(firstId),
        store.waitForPendingPersistence(secondId),
      ]);

      await store.releaseConversation(firstId);
      expect((store as any).residentStores.size).toBe(1);
      expect(store.getHistory(secondId)).toEqual([
        { role: "user", content: "second resident conversation" },
      ]);

      await store.releaseConversation(secondId);
      expect((store as any).residentStores.size).toBe(0);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
