import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AgentRegistry, ConversationStore, MockAgent } from "@belldandy/agent";

import { ObsidianCommonsRuntime } from "./obsidian-commons-runtime.js";
import { createScopedMemoryManagers } from "./resident-memory-managers.js";
import {
  promoteResidentMemoryToShared,
  resolveResidentSharedMemoryManager,
  reviewResidentSharedMemoryPromotion,
} from "./resident-shared-memory.js";
import { cleanupGlobalMemoryManagersForTest } from "./server-testkit.js";

describe("obsidian commons runtime", () => {
  const tempDirs: string[] = [];

  beforeAll(() => {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = "test-placeholder-key";
    }
  });

  beforeEach(async () => {
    await cleanupGlobalMemoryManagersForTest();
  });

  afterEach(async () => {
    await cleanupGlobalMemoryManagersForTest();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
    tempDirs.length = 0;
  });

  it("exports approved and revoked shared memory into Obsidian Commons without coupling to dream generation mode", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-commons-runtime-"));
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-commons-vault-"));
    tempDirs.push(stateDir, vaultDir);

    const registry = new AgentRegistry(() => new MockAgent());
    registry.register({
      id: "default",
      displayName: "Belldandy",
      model: "primary",
      memoryMode: "hybrid",
    });
    registry.register({
      id: "coder",
      displayName: "Coder",
      model: "primary",
      workspaceDir: "coder",
      sessionNamespace: "coder-main",
      memoryMode: "isolated",
    });

    const residentMemoryManagers = createScopedMemoryManagers({
      stateDir,
      agentRegistry: registry,
      modelsDir: path.join(stateDir, "models"),
      conversationStore: new ConversationStore({
        dataDir: path.join(stateDir, "sessions"),
      }),
      embeddingEnabled: false,
      indexerOptions: {
        watch: false,
      },
    }).records;

    const defaultRecord = residentMemoryManagers.find((record) => record.agentId === "default");
    expect(defaultRecord).toBeTruthy();
    if (!defaultRecord) {
      throw new Error("default resident memory manager is required");
    }
    const sharedManager = resolveResidentSharedMemoryManager(defaultRecord.policy);
    expect(sharedManager).toBeTruthy();
    if (!sharedManager) {
      throw new Error("shared memory manager is required");
    }

    defaultRecord.manager.upsertMemoryChunk({
      id: "approved-chunk",
      sourcePath: "memory/approved.md",
      sourceType: "manual",
      memoryType: "other",
      category: "decision",
      content: [
        "approved shared memory for commons",
        "",
        "Generation Mode: fallback",
        "Fallback Reason: missing_model_config",
      ].join("\n"),
      visibility: "private",
      metadata: {
        topic: "dream-runtime",
      },
    });
    defaultRecord.manager.upsertMemoryChunk({
      id: "revoked-chunk",
      sourcePath: "memory/revoked.md",
      sourceType: "manual",
      memoryType: "other",
      category: "fact",
      content: [
        "revoked shared memory for commons",
        "",
        "Generation Mode: llm",
      ].join("\n"),
      visibility: "private",
      metadata: {
        topic: "shared-memory",
      },
    });

    promoteResidentMemoryToShared({
      manager: defaultRecord.manager,
      sharedManager,
      residentPolicy: defaultRecord.policy,
      agentId: "default",
      chunkId: "approved-chunk",
      reason: "commons approved",
    });
    reviewResidentSharedMemoryPromotion({
      manager: defaultRecord.manager,
      sharedManager,
      agentId: "reviewer",
      chunkId: "approved-chunk",
      decision: "approved",
      note: "approved for commons",
    });

    promoteResidentMemoryToShared({
      manager: defaultRecord.manager,
      sharedManager,
      residentPolicy: defaultRecord.policy,
      agentId: "default",
      chunkId: "revoked-chunk",
      reason: "commons revoked",
    });
    reviewResidentSharedMemoryPromotion({
      manager: defaultRecord.manager,
      sharedManager,
      agentId: "reviewer",
      chunkId: "revoked-chunk",
      decision: "approved",
      note: "approved before revoke",
    });
    reviewResidentSharedMemoryPromotion({
      manager: defaultRecord.manager,
      sharedManager,
      agentId: "reviewer-2",
      chunkId: "revoked-chunk",
      decision: "revoked",
      note: "revoked later",
    });

    const runtime = new ObsidianCommonsRuntime({
      stateDir,
      residentMemoryManagers,
      mirror: {
        enabled: true,
        vaultPath: vaultDir,
      },
      now: () => new Date("2026-04-19T15:00:00.000Z"),
    });

    const result = await runtime.runNow();

    expect(result.exported).toBe(true);
    expect(result.state.status).toBe("completed");
    expect(result.state.approvedCount).toBe(1);
    expect(result.state.revokedCount).toBe(1);

    const commonsIndexPath = path.join(vaultDir, "Star Sanctuary", "Commons", "INDEX.md");
    const approvedSharedChunkId = `shared:default:${createHash("sha1").update("default:approved-chunk").digest("hex")}`;
    const revokedSharedChunkId = `shared:default:${createHash("sha1").update("default:revoked-chunk").digest("hex")}`;
    const approvedNotePath = path.join(vaultDir, "Star Sanctuary", "Commons", "Shared-Memory", "approved", `default--${approvedSharedChunkId.replace(/[^a-zA-Z0-9._-]+/g, "-")}.md`);
    const revokedNotePath = path.join(vaultDir, "Star Sanctuary", "Commons", "Shared-Memory", "revoked", `default--${revokedSharedChunkId.replace(/[^a-zA-Z0-9._-]+/g, "-")}.md`);

    const indexContent = await fs.readFile(commonsIndexPath, "utf-8");
    const approvedContent = await fs.readFile(approvedNotePath, "utf-8");
    const revokedContent = await fs.readFile(revokedNotePath, "utf-8");

    expect(indexContent).toContain("Approved Shared Memory Count: 1");
    expect(approvedContent).toContain("approved shared memory for commons");
    expect(approvedContent).toContain("Generation Mode: fallback");
    expect(approvedContent).toContain("Fallback Reason: missing_model_config");
    expect(revokedContent).toContain("shared_status: \"revoked\"");
    expect(revokedContent).toContain("Generation Mode: llm");
  }, 15000);
});
