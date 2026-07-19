import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

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
    peerId: `peer-${input.chatId}`,
    updatedAt: input.updatedAt,
    target: {
      roomId: input.chatId,
      ...(input.accountId ? { accountId: input.accountId } : {}),
    },
  };
}

describe("current conversation binding store", () => {
  it("persists latest binding and resolves by channel/account scope", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    const store = createFileCurrentConversationBindingStore(filePath);

    try {
      await store.upsert({
        channel: "community",
        sessionKey: "channel=community:scope=per-account-channel-peer:chat=room-1:account=alpha:peer=user-1",
        sessionScope: "per-account-channel-peer",
        legacyConversationId: "community:room-1",
        chatKind: "room",
        chatId: "room-1",
        accountId: "alpha",
        peerId: "user-1",
        updatedAt: 123,
        target: {
          roomId: "room-1",
          accountId: "alpha",
        },
      });
      await store.upsert({
        channel: "community",
        sessionKey: "channel=community:scope=per-account-channel-peer:chat=room-2:account=beta:peer=user-2",
        sessionScope: "per-account-channel-peer",
        legacyConversationId: "community:room-2",
        chatKind: "room",
        chatId: "room-2",
        accountId: "beta",
        peerId: "user-2",
        updatedAt: 456,
        target: {
          roomId: "room-2",
          accountId: "beta",
        },
      });

      const reloaded = createFileCurrentConversationBindingStore(filePath);
      await expect(reloaded.get("channel=community:scope=per-account-channel-peer:chat=room-1:account=alpha:peer=user-1")).resolves.toMatchObject({
        legacyConversationId: "community:room-1",
        target: {
          roomId: "room-1",
          accountId: "alpha",
        },
      });
      await expect(reloaded.getLatestByChannel({ channel: "community" })).resolves.toMatchObject({
        chatId: "room-2",
      });
      await expect(reloaded.getLatestByChannel({ channel: "community", accountId: "alpha" })).resolves.toMatchObject({
        chatId: "room-1",
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("serializes concurrent upserts from one persisted snapshot", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-concurrent-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    const seed = createFileCurrentConversationBindingStore(filePath);
    const store = createFileCurrentConversationBindingStore(filePath);
    const now = Date.now();

    try {
      await seed.upsert(createRecord({ sessionKey: "community:seed", chatId: "seed", updatedAt: now }));
      await Promise.all([
        store.upsert(createRecord({ sessionKey: "community:first", chatId: "first", updatedAt: now + 1 })),
        store.upsert(createRecord({ sessionKey: "community:second", chatId: "second", updatedAt: now + 2 })),
      ]);

      const reloaded = createFileCurrentConversationBindingStore(filePath);
      await expect(reloaded.get("community:first")).resolves.toMatchObject({ chatId: "first" });
      await expect(reloaded.get("community:second")).resolves.toMatchObject({ chatId: "second" });
      await expect(reloaded.getLatestByChannel({ channel: "community" })).resolves.toMatchObject({ chatId: "second" });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("coalesces same-turn upserts into one atomic snapshot publish", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-coalesced-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
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
    const now = Date.now();

    try {
      await Promise.all([
        store.upsert(createRecord({ sessionKey: "community:first", chatId: "first", updatedAt: now })),
        store.upsert(createRecord({ sessionKey: "community:second", chatId: "second", updatedAt: now + 1 })),
        store.upsert(createRecord({ sessionKey: "community:third", chatId: "third", updatedAt: now + 2 })),
      ]);

      expect(writeCount).toBe(1);
      const reloaded = createFileCurrentConversationBindingStore(filePath);
      await expect(reloaded.get("community:first")).resolves.toMatchObject({ chatId: "first" });
      await expect(reloaded.get("community:second")).resolves.toMatchObject({ chatId: "second" });
      await expect(reloaded.get("community:third")).resolves.toMatchObject({ chatId: "third" });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects every coalesced caller and keeps the prior snapshot when publish fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-coalesced-failure-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    let failNextWrite = false;
    const store = createFileCurrentConversationBindingStore(filePath, {
      fileSystem: {
        readFile: fs.readFile.bind(fs),
        mkdir: fs.mkdir.bind(fs),
        writeFile: async (...args) => {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error("simulated batch write failure");
          }
          await fs.writeFile(...args);
        },
        rename: fs.rename.bind(fs),
        rm: fs.rm.bind(fs),
      },
    });
    const now = Date.now();

    try {
      await store.upsert(createRecord({ sessionKey: "community:published", chatId: "published", updatedAt: now }));
      failNextWrite = true;
      const outcomes = await Promise.allSettled([
        store.upsert(createRecord({ sessionKey: "community:first", chatId: "first", updatedAt: now + 1 })),
        store.upsert(createRecord({ sessionKey: "community:second", chatId: "second", updatedAt: now + 2 })),
      ]);
      expect(outcomes).toEqual([
        expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ message: "simulated batch write failure" }) }),
        expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ message: "simulated batch write failure" }) }),
      ]);

      const reloaded = createFileCurrentConversationBindingStore(filePath);
      await expect(reloaded.get("community:published")).resolves.toMatchObject({ chatId: "published" });
      await expect(reloaded.get("community:first")).resolves.toBeUndefined();
      await expect(reloaded.get("community:second")).resolves.toBeUndefined();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("keeps the published snapshot when atomic rename fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-rename-failure-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    const persisted = createFileCurrentConversationBindingStore(filePath);
    const failingStore = createFileCurrentConversationBindingStore(filePath, {
      fileSystem: {
        readFile: fs.readFile.bind(fs),
        mkdir: fs.mkdir.bind(fs),
        writeFile: fs.writeFile.bind(fs),
        rename: async () => {
          throw new Error("simulated rename failure");
        },
        rm: fs.rm.bind(fs),
      },
    });

    try {
      await persisted.upsert(createRecord({ sessionKey: "community:published", chatId: "published", updatedAt: 1 }));
      await expect(failingStore.upsert(
        createRecord({ sessionKey: "community:unpublished", chatId: "unpublished", updatedAt: 2 }),
      )).rejects.toThrow("simulated rename failure");

      const reloaded = createFileCurrentConversationBindingStore(filePath);
      await expect(reloaded.get("community:published")).resolves.toMatchObject({ chatId: "published" });
      await expect(reloaded.get("community:unpublished")).resolves.toBeUndefined();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("does not share empty nested snapshots between store files", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-isolation-"));
    const firstPath = path.join(stateDir, "first.json");
    const secondPath = path.join(stateDir, "second.json");
    const first = createFileCurrentConversationBindingStore(firstPath);
    const second = createFileCurrentConversationBindingStore(secondPath);

    try {
      await first.upsert(createRecord({ sessionKey: "community:first", chatId: "first", updatedAt: 1 }));
      await second.upsert(createRecord({ sessionKey: "community:second", chatId: "second", updatedAt: 2 }));

      await expect(first.get("community:second")).resolves.toBeUndefined();
      await expect(second.get("community:first")).resolves.toBeUndefined();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("prunes expired non-latest bindings but retains latest channel and account bindings", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-retention-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    let now = 1_000;
    const options = {
      maxEntries: 10,
      retentionMs: 100,
      now: () => now,
    };
    const store = createFileCurrentConversationBindingStore(filePath, options);

    try {
      await store.upsert(createRecord({ sessionKey: "community:old-alpha", chatId: "old-alpha", accountId: "alpha", updatedAt: now }));
      now = 1_001;
      await store.upsert(createRecord({ sessionKey: "community:latest-alpha", chatId: "latest-alpha", accountId: "alpha", updatedAt: now }));
      now = 1_200;
      await store.upsert(createRecord({ sessionKey: "community:latest-beta", chatId: "latest-beta", accountId: "beta", updatedAt: now }));

      const reloaded = createFileCurrentConversationBindingStore(filePath, options);
      await expect(reloaded.get("community:old-alpha")).resolves.toBeUndefined();
      await expect(reloaded.get("community:latest-alpha")).resolves.toMatchObject({ chatId: "latest-alpha" });
      await expect(reloaded.getLatestByChannel({ channel: "community", accountId: "alpha" })).resolves.toMatchObject({
        chatId: "latest-alpha",
      });
      await expect(reloaded.getLatestByChannel({ channel: "community", accountId: "beta" })).resolves.toMatchObject({
        chatId: "latest-beta",
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("persists explicit prune while exposing only retained and pending counts", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-explicit-prune-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    let now = 1_000;
    const store = createFileCurrentConversationBindingStore(filePath, {
      maxEntries: 10,
      retentionMs: 100,
      now: () => now,
    });

    try {
      await store.upsert(createRecord({
        sessionKey: "community:old-alpha",
        chatId: "old-alpha",
        accountId: "alpha",
        updatedAt: now,
      }));
      now += 1;
      await store.upsert(createRecord({
        sessionKey: "community:latest-alpha",
        chatId: "latest-alpha",
        accountId: "alpha",
        updatedAt: now,
      }));

      now = 1_200;
      await store.prune();

      const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
        bindings: Record<string, unknown>;
      };
      expect(Object.keys(persisted.bindings)).toEqual(["community:latest-alpha"]);
      expect(await store.getRuntimeSnapshot()).toEqual({
        retainedBindingCount: 1,
        latestScopeCount: 2,
        pendingMutationCount: 0,
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("coalesces same-turn prune and upsert without losing the new binding", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-prune-upsert-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    let now = 1_000;
    let writeCount = 0;
    const store = createFileCurrentConversationBindingStore(filePath, {
      maxEntries: 10,
      retentionMs: 100,
      now: () => now,
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
      await store.upsert(createRecord({
        sessionKey: "community:old-alpha",
        chatId: "old-alpha",
        accountId: "alpha",
        updatedAt: now,
      }));
      now += 1;
      await store.upsert(createRecord({
        sessionKey: "community:latest-alpha",
        chatId: "latest-alpha",
        accountId: "alpha",
        updatedAt: now,
      }));

      now = 1_200;
      writeCount = 0;
      await Promise.all([
        store.prune(),
        store.upsert(createRecord({
          sessionKey: "community:latest-beta",
          chatId: "latest-beta",
          accountId: "beta",
          updatedAt: now,
        })),
      ]);

      const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
        bindings: Record<string, unknown>;
      };
      expect(writeCount).toBe(1);
      expect(Object.keys(persisted.bindings).sort()).toEqual([
        "community:latest-alpha",
        "community:latest-beta",
      ]);
      expect(await store.getRuntimeSnapshot()).toEqual({
        retainedBindingCount: 2,
        latestScopeCount: 3,
        pendingMutationCount: 0,
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("counts an in-flight prune until its atomic publish settles", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-prune-pending-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    const seed = createFileCurrentConversationBindingStore(filePath);
    let releaseWrite = () => {};
    let markWriteStarted = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store = createFileCurrentConversationBindingStore(filePath, {
      fileSystem: {
        readFile: fs.readFile.bind(fs),
        mkdir: fs.mkdir.bind(fs),
        writeFile: async (...args) => {
          markWriteStarted();
          await writeGate;
          await fs.writeFile(...args);
        },
        rename: fs.rename.bind(fs),
        rm: fs.rm.bind(fs),
      },
    });

    try {
      await seed.upsert(createRecord({
        sessionKey: "community:latest",
        chatId: "latest",
        updatedAt: Date.now(),
      }));
      const pruning = store.prune();
      await writeStarted;

      await expect(store.getRuntimeSnapshot()).resolves.toMatchObject({
        retainedBindingCount: 1,
        pendingMutationCount: 1,
      });

      releaseWrite();
      await pruning;
      await expect(store.getRuntimeSnapshot()).resolves.toMatchObject({
        pendingMutationCount: 0,
      });
    } finally {
      releaseWrite();
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("keeps the previous file and clears pending counts when prune publish fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-prune-failure-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    let now = 1_000;
    let failNextWrite = false;
    const store = createFileCurrentConversationBindingStore(filePath, {
      maxEntries: 10,
      retentionMs: 100,
      now: () => now,
      fileSystem: {
        readFile: fs.readFile.bind(fs),
        mkdir: fs.mkdir.bind(fs),
        writeFile: async (...args) => {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error("simulated prune write failure");
          }
          await fs.writeFile(...args);
        },
        rename: fs.rename.bind(fs),
        rm: fs.rm.bind(fs),
      },
    });

    try {
      await store.upsert(createRecord({
        sessionKey: "community:old-alpha",
        chatId: "old-alpha",
        accountId: "alpha",
        updatedAt: now,
      }));
      now += 1;
      await store.upsert(createRecord({
        sessionKey: "community:latest-alpha",
        chatId: "latest-alpha",
        accountId: "alpha",
        updatedAt: now,
      }));

      now = 1_200;
      failNextWrite = true;
      await expect(store.prune()).rejects.toThrow("simulated prune write failure");

      const persisted = JSON.parse(await fs.readFile(filePath, "utf-8")) as {
        bindings: Record<string, unknown>;
      };
      expect(Object.keys(persisted.bindings).sort()).toEqual([
        "community:latest-alpha",
        "community:old-alpha",
      ]);
      expect(await store.getRuntimeSnapshot()).toEqual({
        retainedBindingCount: 1,
        latestScopeCount: 2,
        pendingMutationCount: 0,
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("evicts oldest non-latest bindings before latest scope bindings when capacity is exceeded", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "binding-store-capacity-"));
    const filePath = path.join(stateDir, "current-conversation-bindings.json");
    let now = 1_000;
    const options = {
      maxEntries: 2,
      retentionMs: 60_000,
      now: () => now,
    };
    const store = createFileCurrentConversationBindingStore(filePath, options);

    try {
      await store.upsert(createRecord({ sessionKey: "community:old-alpha", chatId: "old-alpha", accountId: "alpha", updatedAt: now }));
      now += 1;
      await store.upsert(createRecord({ sessionKey: "community:latest-alpha", chatId: "latest-alpha", accountId: "alpha", updatedAt: now }));
      now += 1;
      await store.upsert(createRecord({ sessionKey: "community:latest-beta", chatId: "latest-beta", accountId: "beta", updatedAt: now }));
      now += 1;
      await store.upsert(createRecord({ sessionKey: "community:latest-gamma", chatId: "latest-gamma", accountId: "gamma", updatedAt: now }));

      const reloaded = createFileCurrentConversationBindingStore(filePath, options);
      await expect(reloaded.get("community:old-alpha")).resolves.toBeUndefined();
      await expect(reloaded.get("community:latest-alpha")).resolves.toMatchObject({ chatId: "latest-alpha" });
      await expect(reloaded.get("community:latest-beta")).resolves.toMatchObject({ chatId: "latest-beta" });
      await expect(reloaded.get("community:latest-gamma")).resolves.toMatchObject({ chatId: "latest-gamma" });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
