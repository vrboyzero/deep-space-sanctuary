import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SessionArtifactInventory,
  SessionArtifactInventoryCursorError,
} from "./session-artifact-inventory.js";

describe("SessionArtifactInventory", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("returns root-bound entries in recency order with revision-bound keyset pages", async () => {
    const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-session-inventory-"));
    cleanupDirs.add(sessionsDir);
    const encodedId = "agent%3Acoder%3Amain";
    const directId = "conv-inventory-direct";
    await fs.writeFile(
      path.join(sessionsDir, `${encodedId}.meta.json`),
      JSON.stringify({ conversationId: "agent:coder:main" }),
      "utf-8",
    );
    await fs.writeFile(path.join(sessionsDir, `${encodedId}.session-memory.json`), "{}", "utf-8");
    await fs.writeFile(path.join(sessionsDir, `${directId}.digest.json`), "{}", "utf-8");
    await fs.writeFile(
      path.join(sessionsDir, `${encodedId}.transcript.jsonl`),
      `${JSON.stringify({ conversationId: "must-not-be-read" })}\n${"x".repeat(128 * 1024)}`,
      "utf-8",
    );

    const older = new Date("2026-07-20T10:00:00.000Z");
    const newer = new Date("2026-07-21T10:00:00.000Z");
    await fs.utimes(path.join(sessionsDir, `${encodedId}.session-memory.json`), older, older);
    await fs.utimes(path.join(sessionsDir, `${directId}.digest.json`), newer, newer);

    const inventory = new SessionArtifactInventory({ rootDir: sessionsDir });
    const first = await inventory.listPage({ limit: 1 });

    expect(first.status).toBe("ready");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      safeConversationId: directId,
      conversationId: directId,
      digestPath: path.join(sessionsDir, `${directId}.digest.json`),
    });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await inventory.listPage({ cursor: first.nextCursor, limit: 1 });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      safeConversationId: encodedId,
      conversationId: "agent:coder:main",
      sessionMemoryPath: path.join(sessionsDir, `${encodedId}.session-memory.json`),
    });

    await fs.writeFile(path.join(sessionsDir, `${directId}.meta.json`), JSON.stringify({ conversationId: directId }), "utf-8");
    await expect(inventory.listPage({ cursor: first.nextCursor, limit: 1 }))
      .rejects.toBeInstanceOf(SessionArtifactInventoryCursorError);
  });

  it("fails closed when a cold rebuild reaches the configured directory-entry budget", async () => {
    const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-session-inventory-limit-"));
    cleanupDirs.add(sessionsDir);
    await fs.writeFile(path.join(sessionsDir, "a.digest.json"), "{}", "utf-8");
    await fs.writeFile(path.join(sessionsDir, "b.digest.json"), "{}", "utf-8");
    await fs.writeFile(path.join(sessionsDir, "c.digest.json"), "{}", "utf-8");

    const inventory = new SessionArtifactInventory({
      rootDir: sessionsDir,
      limits: { maxDirectoryEntries: 2 },
    });

    await expect(inventory.listPage()).resolves.toMatchObject({
      status: "unavailable",
      items: [],
      diagnostics: { unavailableReason: "directory_entry_limit" },
    });
  });

  it("does not use a transcript fallback when an encoded artifact has invalid metadata", async () => {
    const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-session-inventory-invalid-meta-"));
    cleanupDirs.add(sessionsDir);
    const encodedId = "agent%3Ainvalid%3Amain";
    await fs.writeFile(path.join(sessionsDir, `${encodedId}.digest.json`), "{}", "utf-8");
    await fs.writeFile(path.join(sessionsDir, `${encodedId}.meta.json`), "{not-json", "utf-8");
    await fs.writeFile(
      path.join(sessionsDir, `${encodedId}.transcript.jsonl`),
      JSON.stringify({ conversationId: "must-not-be-used" }),
      "utf-8",
    );

    const inventory = new SessionArtifactInventory({ rootDir: sessionsDir });

    await expect(inventory.listPage()).resolves.toMatchObject({
      status: "ready",
      items: [],
      diagnostics: { ignoredArtifactCandidates: 1 },
    });
  });
});
