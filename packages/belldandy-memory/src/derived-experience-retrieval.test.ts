import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryManager } from "./manager.js";

describe("derived experience retrieval integration", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("returns accepted experience candidates in searchWithDiagnostics", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-experience-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      manager.createExperienceCandidate({
        id: "exp_viewer_lazy_loading",
        taskId: "task-viewer-experience",
        type: "method",
        status: "accepted",
        title: "Viewer Lazy Loading Rollout",
        slug: "viewer-lazy-loading-rollout",
        summary: "Use staged rollout plus regression checks for viewer lazy loading.",
        content: [
          "# Viewer Lazy Loading Rollout",
          "",
          "## Trigger",
          "- viewer lazy loading blocks resume flow",
          "",
          "## Steps",
          "1. continue viewer lazy loading wiring",
          "2. add regression validation",
        ].join("\n"),
        qualityScore: 92,
        sourceTaskSnapshot: {
          taskId: "task-viewer-experience",
          conversationId: "conv-viewer-experience",
          source: "chat",
          status: "success",
          title: "收口 viewer 懒加载",
          summary: "完成 viewer 懒加载接线与回归验证。",
          outcome: "viewer lazy loading ready",
          startedAt: "2026-05-21T09:00:00.000Z",
          finishedAt: "2026-05-21T10:00:00.000Z",
        },
        publishedPath: path.join(stateDir, "methods", "Viewer Lazy Loading Rollout.md"),
        createdAt: "2026-05-21T10:00:00.000Z",
        reviewedAt: "2026-05-21T10:10:00.000Z",
        acceptedAt: "2026-05-21T10:12:00.000Z",
      });

      const execution = await manager.searchWithDiagnostics("viewer lazy loading", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items[0]).toMatchObject({
        id: "derived-experience:exp_viewer_lazy_loading",
        sourceType: "experience_derived",
        metadata: {
          derivedRetrieval: {
            candidateId: "exp_viewer_lazy_loading",
            candidateType: "method",
            candidateStatus: "accepted",
          },
          memoryTree: {
            sourceClass: "curated",
            sourceKind: "experience_candidates",
          },
        },
      });
      expect(execution.diagnostics.stages.raw.topHits[0]).toMatchObject({
        id: "derived-experience:exp_viewer_lazy_loading",
        sourceClass: "curated",
      });
    } finally {
      manager.close();
    }
  });

  it("does not inject draft-only experience candidates into unified retrieval", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-experience-draft-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      manager.createExperienceCandidate({
        id: "exp_viewer_lazy_loading_draft",
        taskId: "task-viewer-experience-draft",
        type: "method",
        status: "draft",
        title: "Viewer Lazy Loading Draft",
        slug: "viewer-lazy-loading-draft",
        summary: "Draft only.",
        content: "# Viewer Lazy Loading Draft\n\ncontinue viewer lazy loading wiring",
        sourceTaskSnapshot: {
          taskId: "task-viewer-experience-draft",
          conversationId: "conv-viewer-experience-draft",
          source: "chat",
          status: "success",
          title: "viewer draft",
          startedAt: "2026-05-21T09:00:00.000Z",
          finishedAt: "2026-05-21T10:00:00.000Z",
        },
        createdAt: "2026-05-21T10:00:00.000Z",
      });

      const execution = await manager.searchWithDiagnostics("viewer lazy loading", {
        limit: 3,
        routingPolicy: "chunk_only",
      });

      expect(execution.items).toEqual([]);
      expect(execution.diagnostics.stages.raw.count).toBe(0);
    } finally {
      manager.close();
    }
  });

  it("does not inject private experience-derived results for shared-only searches", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-derived-experience-shared-"));
    cleanupDirs.add(stateDir);
    const docsDir = path.join(stateDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    const manager = new MemoryManager({
      workspaceRoot: docsDir,
      stateDir,
      taskMemoryEnabled: true,
    });

    try {
      manager.createExperienceCandidate({
        id: "exp_shared_block",
        taskId: "task-shared-block",
        type: "skill",
        status: "accepted",
        title: "Private Viewer Skill",
        slug: "private-viewer-skill",
        summary: "Should stay private.",
        content: "# Private Viewer Skill\n\nviewer lazy loading troubleshooting",
        sourceTaskSnapshot: {
          taskId: "task-shared-block",
          conversationId: "conv-shared-block",
          source: "chat",
          status: "success",
          title: "private skill",
          startedAt: "2026-05-21T09:00:00.000Z",
          finishedAt: "2026-05-21T10:00:00.000Z",
        },
        createdAt: "2026-05-21T10:00:00.000Z",
        reviewedAt: "2026-05-21T10:10:00.000Z",
        acceptedAt: "2026-05-21T10:12:00.000Z",
      });

      const execution = await manager.searchWithDiagnostics("viewer lazy loading", {
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
});
