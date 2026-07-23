import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildDreamConversationArtifactPath } from "./dream-input.js";
import { MemoryManager } from "./manager.js";
import type { SessionArtifactInventoryItem, SessionArtifactInventoryProvider } from "./session-artifact-inventory.js";

function createSessionArtifactInventory(
  items: SessionArtifactInventoryItem[],
): SessionArtifactInventoryProvider {
  return {
    async listPage(options) {
      return {
        status: "ready",
        items: items.slice(0, options?.limit),
      };
    },
  };
}

describe("derived session retrieval integration", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("returns session-memory derived results in searchWithDiagnostics", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-session-memory-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });

    const conversationId = "agent:coder:main";
    const sessionMemoryPath = buildDreamConversationArtifactPath({
      sessionsDir,
      conversationId,
      suffix: ".session-memory.json",
    });
    await fs.writeFile(
      sessionMemoryPath,
      JSON.stringify({
        summary: "当前主要在打通统一检索接线。",
        currentGoal: "让续做信息进入统一检索结果。",
        currentWork: "已接入 task 派生结果。",
        nextStep: "继续接 viewer 懒加载并补回归验证。",
        pendingTasks: ["补 session digest / session-memory 接线"],
        updatedAt: Date.parse("2026-05-21T10:20:00.000Z"),
      }),
      "utf-8",
    );
    const safeConversationId = path.basename(sessionMemoryPath, ".session-memory.json");
    await fs.writeFile(
      path.join(sessionsDir, `${safeConversationId}.meta.json`),
      JSON.stringify({ conversationId }),
      "utf-8",
    );

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
      sessionArtifactInventory: createSessionArtifactInventory([{
        safeConversationId,
        conversationId,
        newestFileMs: Date.now(),
        sessionMemoryPath,
      }]),
    });

    try {
      const execution = await manager.searchWithDiagnostics("继续接 viewer 懒加载", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items[0]?.sourceType).toBe("session_derived");
      expect(execution.items[0]?.id).toContain(":session_memory_resume");
      expect(execution.items[0]?.metadata).toMatchObject({
        derivedRetrieval: {
          conversationId,
          kind: "session_memory_resume",
          sourceKind: "session_memory",
        },
        memoryTree: {
          sourceClass: "derived",
          sourceKind: "session_memory",
        },
      });
      expect(execution.diagnostics.stages.raw.topHits[0]).toMatchObject({
        id: execution.items[0]?.id,
        sourceClass: "derived",
      });
      expect(execution.diagnostics.derived?.session).toMatchObject({
        admitted: true,
        candidateCount: 1,
        detailCount: 1,
        readByteCount: expect.any(Number),
        resultCount: 1,
        skipped: false,
        deadline: {
          exceededBeforeStart: false,
          exceededAfterCompletion: false,
        },
      });
    } finally {
      manager.close();
    }
  });

  it("returns digest-derived results when digest best matches the query", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-session-digest-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });

    const conversationId = "conv-digest-search";
    const digestPath = buildDreamConversationArtifactPath({
        sessionsDir,
        conversationId,
        suffix: ".digest.json",
      });
    await fs.writeFile(
      digestPath,
      JSON.stringify({
        conversationId,
        rollingSummary: "最近一轮在收口 gateway retry fallback 策略。",
        archivalSummary: "已确认重试窗口需要和 viewer 提示保持一致。",
        lastDigestAt: Date.parse("2026-05-21T09:40:00.000Z"),
      }),
      "utf-8",
    );

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
      sessionArtifactInventory: createSessionArtifactInventory([{
        safeConversationId: conversationId,
        conversationId,
        newestFileMs: Date.now(),
        digestPath,
      }]),
    });

    try {
      const execution = await manager.searchWithDiagnostics("gateway retry fallback", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items[0]?.id).toContain(":session_digest_summary");
      expect(execution.items[0]?.metadata).toMatchObject({
        derivedRetrieval: {
          conversationId,
          kind: "session_digest_summary",
          sourceKind: "session_digest",
        },
        memoryTree: {
          sourceClass: "derived",
          sourceKind: "session_digest",
        },
      });
    } finally {
      manager.close();
    }
  });

  it("keeps only the best derived layer for the same conversation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-session-family-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });

    const conversationId = "conv-family-aware";
    const sessionMemoryPath = buildDreamConversationArtifactPath({
        sessionsDir,
        conversationId,
        suffix: ".session-memory.json",
      });
    await fs.writeFile(
      sessionMemoryPath,
      JSON.stringify({
        summary: "当前在补统一检索派生层。",
        currentWork: "已把任务复盘接进统一检索。",
        nextStep: "继续接 viewer 懒加载并补回归验证。",
        updatedAt: Date.parse("2026-05-21T11:10:00.000Z"),
      }),
      "utf-8",
    );
    const digestPath = buildDreamConversationArtifactPath({
        sessionsDir,
        conversationId,
        suffix: ".digest.json",
      });
    await fs.writeFile(
      digestPath,
      JSON.stringify({
        conversationId,
        rollingSummary: "最近一轮在继续接 viewer 懒加载，并核对统一检索行为。",
        lastDigestAt: Date.parse("2026-05-21T11:00:00.000Z"),
      }),
      "utf-8",
    );

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
      sessionArtifactInventory: createSessionArtifactInventory([{
        safeConversationId: conversationId,
        conversationId,
        newestFileMs: Date.now(),
        digestPath,
        sessionMemoryPath,
      }]),
    });

    try {
      const execution = await manager.searchWithDiagnostics("继续接 viewer 懒加载", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      const derivedConversationItems = execution.items.filter((item) => item.id.startsWith("derived-session:"));
      expect(derivedConversationItems).toHaveLength(1);
      expect(derivedConversationItems[0]?.id).toContain(":session_memory_resume");
    } finally {
      manager.close();
    }
  });

  it("does not inject private session-derived results for shared-only searches", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-session-shared-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });

    await fs.writeFile(
      buildDreamConversationArtifactPath({
        sessionsDir,
        conversationId: "conv-shared-block",
        suffix: ".session-memory.json",
      }),
      JSON.stringify({
        summary: "这是私有续做结论。",
        nextStep: "不应进入 shared-only 检索。",
        updatedAt: Date.parse("2026-05-21T11:20:00.000Z"),
      }),
      "utf-8",
    );

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      const execution = await manager.searchWithDiagnostics("shared only 检索", {
        limit: 3,
        routingPolicy: "chunk_only",
        filter: { scope: "shared" },
      });

      expect(execution.items).toEqual([]);
      expect(execution.diagnostics.stages.raw.count).toBe(0);
    } finally {
      manager.close();
    }
  });

  it("does not fall back to scanning the raw sessions directory without a root-bound provider", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-session-no-provider-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "conv-no-provider.session-memory.json"),
      JSON.stringify({
        summary: "不应由裸目录扫描进入检索。",
        currentGoal: "阻断 legacy session scan。",
        updatedAt: Date.parse("2026-05-21T11:30:00.000Z"),
      }),
      "utf-8",
    );

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      const execution = await manager.searchWithDiagnostics("legacy session scan", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items.filter((item) => item.id.startsWith("derived-session:"))).toEqual([]);
      expect(execution.diagnostics.derived?.session).toMatchObject({
        admitted: false,
        skipped: true,
        skipReason: "unavailable",
      });
    } finally {
      manager.close();
    }
  });

  it("skips an oversized artifact without reading it", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-session-byte-limit-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionMemoryPath = path.join(sessionsDir, "conv-too-large.session-memory.json");
    await fs.writeFile(sessionMemoryPath, JSON.stringify({
      summary: "oversized artifact must not be read",
      currentGoal: "oversized artifact must not be read",
      padding: "x".repeat(64 * 1024),
      updatedAt: Date.parse("2026-05-21T11:40:00.000Z"),
    }), "utf-8");

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
      sessionArtifactInventory: createSessionArtifactInventory([{
        safeConversationId: "conv-too-large",
        conversationId: "conv-too-large",
        newestFileMs: Date.now(),
        sessionMemoryPath,
      }]),
    });

    try {
      const execution = await manager.searchWithDiagnostics("oversized artifact", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items.filter((item) => item.id.startsWith("derived-session:"))).toEqual([]);
    } finally {
      manager.close();
    }
  });
});
