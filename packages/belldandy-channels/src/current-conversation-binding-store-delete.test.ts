import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFileCurrentConversationBindingStore,
  type CurrentConversationBindingRecord,
} from "./current-conversation-binding-store.js";

function createRecord(input: {
  sessionKey: string;
  chatId: string;
  accountId?: string;
  updatedAt: number;
}): CurrentConversationBindingRecord {
  return {
    channel: "community",
    sessionKey: input.sessionKey,
    sessionScope: "per-account-channel-peer",
    legacyConversationId: `community:${input.chatId}`,
    chatKind: "room",
    chatId: input.chatId,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    updatedAt: input.updatedAt,
    target: { roomId: input.chatId },
  };
}

describe("current conversation binding delete", () => {
  it("removes the binding and repoints affected latest scopes to the newest retained record", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-delete-"));
    const filePath = path.join(stateDir, "bindings.json");
    const store = createFileCurrentConversationBindingStore(filePath);
    const now = Date.now();

    try {
      await store.upsert(createRecord({
        sessionKey: "community:alpha-old",
        chatId: "alpha-old",
        accountId: "alpha",
        updatedAt: now,
      }));
      await store.upsert(createRecord({
        sessionKey: "community:alpha-latest",
        chatId: "alpha-latest",
        accountId: "alpha",
        updatedAt: now + 1,
      }));

      await store.delete("community:alpha-latest");

      await expect(store.get("community:alpha-latest")).resolves.toBeUndefined();
      await expect(store.getLatestByChannel({ channel: "community" })).resolves.toMatchObject({
        sessionKey: "community:alpha-old",
      });
      await expect(store.getLatestByChannel({ channel: "community", accountId: "alpha" })).resolves.toMatchObject({
        sessionKey: "community:alpha-old",
      });
      await expect(store.getRuntimeSnapshot()).resolves.toEqual({
        retainedBindingCount: 1,
        latestScopeCount: 2,
        pendingMutationCount: 0,
      });

      const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
        bindings: Record<string, unknown>;
        latestByScope: Record<string, string>;
      };
      expect(Object.keys(persisted.bindings)).toEqual(["community:alpha-old"]);
      expect(persisted.latestByScope).toEqual({
        community: "community:alpha-old",
        "community::alpha": "community:alpha-old",
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("coalesces ordered delete and upsert mutations into one atomic publish", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-delete-coalesced-"));
    const filePath = path.join(stateDir, "bindings.json");
    let writeCount = 0;
    const store = createFileCurrentConversationBindingStore(filePath, {
      fileSystem: {
        readFile: fs.readFile.bind(fs),
        mkdir: fs.mkdir.bind(fs),
        writeFile: async (...args) => {
          writeCount += 1;
          await fs.writeFile(...args);
        },
        rename: fs.rename.bind(fs),
        rm: fs.rm.bind(fs),
      },
    });

    try {
      await store.upsert(createRecord({ sessionKey: "community:seed", chatId: "seed", updatedAt: 1 }));
      writeCount = 0;

      await Promise.all([
        store.delete("community:seed"),
        store.upsert(createRecord({ sessionKey: "community:replacement", chatId: "replacement", updatedAt: 2 })),
        store.upsert(createRecord({ sessionKey: "community:transient", chatId: "transient", updatedAt: 3 })),
        store.delete("community:transient"),
      ]);

      expect(writeCount).toBe(1);
      await expect(store.get("community:seed")).resolves.toBeUndefined();
      await expect(store.get("community:transient")).resolves.toBeUndefined();
      await expect(store.getLatestByChannel({ channel: "community" })).resolves.toMatchObject({
        sessionKey: "community:replacement",
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("rejects delete and keeps the published snapshot when atomic rename fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-delete-failure-"));
    const filePath = path.join(stateDir, "bindings.json");
    const seed = createFileCurrentConversationBindingStore(filePath);

    try {
      await seed.upsert(createRecord({ sessionKey: "community:published", chatId: "published", updatedAt: 1 }));
      const failingStore = createFileCurrentConversationBindingStore(filePath, {
        fileSystem: {
          readFile: fs.readFile.bind(fs),
          mkdir: fs.mkdir.bind(fs),
          writeFile: fs.writeFile.bind(fs),
          rename: async () => {
            throw new Error("simulated delete rename failure");
          },
          rm: fs.rm.bind(fs),
        },
      });

      await expect(failingStore.delete("community:published")).rejects.toThrow("simulated delete rename failure");
      await expect(failingStore.get("community:published")).resolves.toMatchObject({ chatId: "published" });
      await expect(failingStore.getRuntimeSnapshot()).resolves.toMatchObject({ pendingMutationCount: 0 });

      const reloaded = createFileCurrentConversationBindingStore(filePath);
      await expect(reloaded.get("community:published")).resolves.toMatchObject({ chatId: "published" });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
