import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryManager } from "./manager.js";

describe("memory source inventory", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("builds a readonly inventory report for builtin and configured sources", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-inventory-state-"));
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-memory-inventory-external-"));
    cleanupDirs.add(stateDir);
    cleanupDirs.add(externalDir);

    await fs.mkdir(path.join(stateDir, "sessions"), { recursive: true });
    await fs.mkdir(path.join(stateDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(stateDir, "dreams", "2026", "05"), { recursive: true });
    await fs.writeFile(path.join(stateDir, "sessions", "conv-1.jsonl"), "{\"role\":\"user\",\"content\":\"hello\"}\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "sessions", "conv-1.transcript.jsonl"), "{\"type\":\"message\",\"content\":\"hello\"}\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "sessions", "conv-1.meta.json"), "{\"conversationId\":\"conv-1\"}\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "sessions", "conv-1.digest.json"), "{\"digestGeneration\":1}\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "sessions", "conv-1.session-memory.json"), "{\"currentWork\":\"inventory\"}\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "MEMORY.md"), "# Core Memory\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "memory", "2026-05-19.md"), "# Daily Memory\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "dream-runtime.json"), "{\"status\":\"idle\"}\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "DREAM.md"), "# Dream Index\n", "utf-8");
    await fs.writeFile(path.join(stateDir, "dreams", "2026", "05", "dream-1.md"), "# Dream Note\n", "utf-8");
    await fs.writeFile(path.join(externalDir, "obsidian-note.md"), "# External Note\n", "utf-8");

    const memoryManager = new MemoryManager({
      workspaceRoot: path.join(stateDir, "sessions"),
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      const store = (memoryManager as any).store as {
        createTask: (task: Record<string, unknown>) => void;
        createTaskActivity: (activity: Record<string, unknown>) => void;
      };
      store.createTask({
        id: "task-inventory-1",
        conversationId: "conv-1",
        sessionKey: "conv-1",
        source: "chat",
        status: "success",
        title: "整理 source inventory",
        startedAt: "2026-05-19T10:00:00.000Z",
        finishedAt: "2026-05-19T10:05:00.000Z",
        createdAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:05:00.000Z",
      });
      store.createTaskActivity({
        id: "activity-inventory-1",
        taskId: "task-inventory-1",
        conversationId: "conv-1",
        sessionKey: "conv-1",
        source: "chat",
        kind: "task_completed",
        state: "completed",
        sequence: 1,
        happenedAt: "2026-05-19T10:05:00.000Z",
        recordedAt: "2026-05-19T10:05:00.000Z",
        title: "完成 inventory 初版",
      });
      memoryManager.upsertExperienceCandidate({
        id: "candidate-inventory-1",
        taskId: "task-inventory-1",
        type: "method",
        status: "draft",
        title: "Inventory Method Draft",
        slug: "inventory-method-draft",
        content: "# Inventory Method Draft",
        summary: "source inventory draft",
        sourceTaskSnapshot: {
          taskId: "task-inventory-1",
          conversationId: "conv-1",
          source: "chat",
          status: "success",
          title: "整理 source inventory",
          startedAt: "2026-05-19T10:00:00.000Z",
          finishedAt: "2026-05-19T10:05:00.000Z",
        },
        createdAt: "2026-05-19T10:06:00.000Z",
      });
      memoryManager.recordExperienceUsage({
        taskId: "task-inventory-1",
        assetType: "method",
        assetKey: "inventory-method-draft",
        sourceCandidateId: "candidate-inventory-1",
        usedVia: "manual",
      });

      const report = await memoryManager.previewSourceInventory({
        configuredSources: [
          {
            label: "Obsidian Vault",
            sourceClass: "curated",
            rootPath: externalDir,
            recursive: true,
            fileExtensions: [".md"],
            note: "用户声明的外部知识目录",
          },
        ],
      });

      expect(report.version).toBe("p10-source-registry-family-v1");
      expect(report.totals.sourceKinds).toBeGreaterThanOrEqual(14);
      expect(report.totals.indexedChunks).toBeGreaterThanOrEqual(0);
      expect(report.totals.sourceFamilyCount).toBeGreaterThan(0);
      expect(report.totals.highRiskFamilyCount).toBeGreaterThan(0);
      expect(report.totals.bySearchPolicy.searchable).toBeGreaterThan(0);
      expect(report.totals.bySearchPolicy["summary-input-only"]).toBeGreaterThan(0);

      const byId = new Map(report.items.map((item) => [item.id, item]));
      expect(byId.get("builtin:sessions:messages")).toMatchObject({
        sourceClass: "raw",
        storage: "filesystem",
        status: "present",
        admission: expect.objectContaining({ searchPolicy: "searchable" }),
        identity: expect.objectContaining({
          canonicalSourceKey: "builtin:builtin:sessions:messages",
        }),
        stats: expect.objectContaining({ fileCount: 1, itemCount: 1 }),
      });
      expect(byId.get("builtin:sessions:digest")).toMatchObject({
        sourceClass: "derived",
        status: "present",
        admission: expect.objectContaining({ searchPolicy: "summary-input-only" }),
        stats: expect.objectContaining({ fileCount: 1 }),
      });
      expect(byId.get("builtin:memory:core-note")).toMatchObject({
        sourceClass: "curated",
        status: "present",
      });
      expect(byId.get("builtin:db:tasks")).toMatchObject({
        storage: "database",
        status: "present",
        stats: expect.objectContaining({ rowCount: 1, itemCount: 1 }),
      });
      expect(byId.get("builtin:db:task-activities")).toMatchObject({
        storage: "database",
        status: "present",
        stats: expect.objectContaining({ rowCount: 1 }),
      });
      expect(byId.get("builtin:db:experience-candidates")).toMatchObject({
        sourceClass: "curated",
        status: "present",
        stats: expect.objectContaining({ rowCount: 1 }),
      });
      expect(byId.get("builtin:db:experience-usages")).toMatchObject({
        sourceClass: "derived",
        status: "present",
        stats: expect.objectContaining({ rowCount: 1 }),
      });

      const external = report.items.find((item) => item.label === "Obsidian Vault");
      expect(external).toMatchObject({
        sourceKind: "configured_external",
        sourceClass: "curated",
        storage: "external",
        status: "present",
        admission: expect.objectContaining({ searchPolicy: "inventory-only" }),
        stats: expect.objectContaining({ fileCount: 1 }),
      });
      expect(external?.notes.some((note) => note.includes("只读盘点"))).toBe(true);

      const byFamilyKey = new Map(report.families.map((item) => [item.sourceFamilyKey, item]));
      const sessionFamilyKey = byId.get("builtin:sessions:messages")?.identity.sourceFamilyKey;
      const sessionFamily = sessionFamilyKey ? byFamilyKey.get(sessionFamilyKey) : undefined;
      expect(sessionFamily).toMatchObject({
        memberCount: 5,
        sourceClasses: expect.arrayContaining(["raw", "derived"]),
        duplicateRisk: expect.objectContaining({
          level: "high",
        }),
      });
      expect(sessionFamily?.members.map((item) => item.id)).toEqual(expect.arrayContaining([
        "builtin:sessions:messages",
        "builtin:sessions:transcripts",
        "builtin:sessions:meta",
        "builtin:sessions:digest",
        "builtin:sessions:session-memory",
      ]));
    } finally {
      memoryManager.close();
    }
  });
});
