import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExperienceCandidate } from "./experience-types.js";
import { MemoryStore } from "./store.js";
import type { TaskRecord } from "./task-types.js";

const FTS_MARKER_KEY = "experience_derived_fts_schema_version";

describe("experience derived candidate search", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cleanupDirs.clear();
  });

  it("rebuilds a legacy candidate index and keeps insert/update/delete synchronized", async () => {
    const store = await createStore(cleanupDirs);
    const db = (store as any).db;
    db.exec(`
      DROP TRIGGER IF EXISTS experience_candidates_fts_ai;
      DROP TRIGGER IF EXISTS experience_candidates_fts_ad;
      DROP TRIGGER IF EXISTS experience_candidates_fts_au;
      DROP TABLE IF EXISTS experience_candidates_fts;
      DELETE FROM meta WHERE key = '${FTS_MARKER_KEY}';
    `);

    store.createExperienceCandidate(createCandidate("legacy-experience", {
      title: "Legacy experience search",
      content: "legacy token can only be found after rebuild",
    }));

    const dbPath = store.getDbPath();
    store.close();
    const reopened = new MemoryStore(dbPath);

    expect(reopened.getMeta(FTS_MARKER_KEY)).toBe("1");
    expect((reopened as any).searchExperienceDerivedCandidateIds("legacy token", 24, {})).toEqual(["legacy-experience"]);

    reopened.updateExperienceCandidate("legacy-experience", {
      title: "Updated experience search",
      content: "updated candidate only",
      summary: "updated summary",
    });
    expect((reopened as any).searchExperienceDerivedCandidateIds("legacy token", 24, {})).toEqual([]);
    expect((reopened as any).searchExperienceDerivedCandidateIds("updated candidate", 24, {})).toEqual(["legacy-experience"]);

    reopened.deleteExperienceCandidates({ taskId: "task-legacy-experience" });
    expect((reopened as any).searchExperienceDerivedCandidateIds("updated candidate", 24, {})).toEqual([]);
    reopened.close();
  });

  it("bounds candidate detail bodies without loading a full candidate set", async () => {
    const store = await createStore(cleanupDirs);
    const largeBody = `${"x".repeat(8_300)} searchable body marker`;
    for (let index = 0; index < 13; index += 1) {
      store.createExperienceCandidate(createCandidate(`bounded-${index}`, {
        title: `Bounded candidate ${index}`,
        content: `${largeBody} ${index}`,
      }));
    }

    const candidateIds = (store as any).searchExperienceDerivedCandidateIds("searchable body marker", 24, {});
    const details = (store as any).getExperienceDerivedCandidates(candidateIds);

    expect(candidateIds).toHaveLength(13);
    expect(details).toHaveLength(12);
    expect(details.every((item: { content: string }) => Buffer.byteLength(item.content, "utf8") <= 8 * 1024)).toBe(true);
    expect(details.reduce((total: number, item: { content: string }) => total + Buffer.byteLength(item.content, "utf8"), 0)).toBeLessThanOrEqual(96 * 1024);
    store.close();
  });

  it("uses a title-summary-only fallback when Experience FTS is unavailable", async () => {
    const store = await createStore(cleanupDirs);
    store.createExperienceCandidate(createCandidate("fallback-title", {
      title: "Fallback title matches",
      content: "content only hidden marker",
    }));
    (store as any).hasExperienceFts = false;

    expect((store as any).searchExperienceDerivedCandidateIds("fallback title", 24, {})).toEqual(["fallback-title"]);
    expect((store as any).searchExperienceDerivedCandidateIds("hidden marker", 24, {})).toEqual([]);
    store.close();
  });

  it("keeps a 250-candidate corpus to one candidate query plus one bounded detail query", async () => {
    const store = await createStore(cleanupDirs);
    const largeBody = `${"经验正文".repeat(16_000)} fixed-scale marker`;
    for (let index = 0; index < 250; index += 1) {
      store.createExperienceCandidate(createCandidate(`scale-${index}`, {
        title: `Fixed scale ${index}`,
        content: `${largeBody} ${index}`,
      }));
    }

    const db = (store as any).db;
    const prepareSpy = vi.spyOn(db, "prepare");
    const candidateIds = (store as any).searchExperienceDerivedCandidateIds("fixed-scale marker", 24, {});
    const details = (store as any).getExperienceDerivedCandidates(candidateIds);
    const queryStatements = prepareSpy.mock.calls
      .map((call) => String(call[0] ?? ""))
      .filter((sql) => sql.includes("experience_candidates_fts") || sql.includes("WHERE c.id IN"));

    expect(candidateIds).toHaveLength(24);
    expect(details).toHaveLength(12);
    expect(queryStatements).toHaveLength(2);
    expect(queryStatements.join("\n")).not.toContain("SELECT c.*");
    expect(details.reduce((total: number, item: { content: string }) => total + Buffer.byteLength(item.content, "utf8"), 0)).toBeLessThanOrEqual(96 * 1024);

    const queryPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT c.id
      FROM experience_candidates_fts f
      JOIN experience_candidates c ON c.rowid = f.rowid
      WHERE experience_candidates_fts MATCH ?
      ORDER BY bm25(experience_candidates_fts), c.id ASC
      LIMIT 24
    `).all('"fixed" OR "scale" OR "marker"') as Array<{ detail: string }>;
    expect(queryPlan.map((row) => row.detail).join(" ")).toMatch(/VIRTUAL TABLE/i);
    store.close();
  }, 15_000);

  it("preserves agent and consumed-candidate filters before reading details", async () => {
    const store = await createStore(cleanupDirs);
    store.createTask(createTask("task-agent-visible", "agent-visible"));
    store.createTask(createTask("task-agent-hidden", "agent-hidden"));
    store.createExperienceCandidate(createCandidate("agent-visible", {
      taskId: "task-agent-visible",
      title: "Agent filter marker",
      content: "agent filter marker",
    }));
    store.createExperienceCandidate(createCandidate("agent-consumed", {
      taskId: "task-agent-hidden",
      title: "Agent filter marker",
      content: "agent filter marker",
      metadata: {
        synthesisConsumed: {
          consumed: true,
          consumedByCandidateId: "newer-candidate",
          consumedAt: "2026-07-23T10:01:00.000Z",
          consumedRunId: "run-filter",
        },
      },
    }));

    expect((store as any).searchExperienceDerivedCandidateIds("agent filter marker", 24, {
      status: ["accepted", "published"],
      synthesisConsumed: false,
      agentId: "agent-visible",
    })).toEqual(["agent-visible"]);
    store.close();
  });

  it("does not advance the Experience FTS marker when rebuild cannot read its canonical table", async () => {
    const store = await createStore(cleanupDirs);
    const db = (store as any).db;
    db.exec(`
      DELETE FROM meta WHERE key = '${FTS_MARKER_KEY}';
      DROP TABLE experience_candidates;
    `);

    expect((store as any).installExperienceDerivedSearchSchema()).toMatchObject({ ready: false });
    expect(store.getMeta(FTS_MARKER_KEY)).toBeNull();
    store.close();
  });
});

async function createStore(cleanupDirs: Set<string>): Promise<MemoryStore> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-experience-derived-search-"));
  cleanupDirs.add(stateDir);
  return new MemoryStore(path.join(stateDir, "memory.sqlite"));
}

function createCandidate(id: string, patch: Partial<ExperienceCandidate> = {}): ExperienceCandidate {
  const createdAt = "2026-07-23T10:00:00.000Z";
  return {
    id,
    taskId: `task-${id}`,
    type: "method",
    status: "accepted",
    title: `Experience ${id}`,
    slug: id,
    content: "default experience content",
    summary: "default experience summary",
    sourceTaskSnapshot: {
      taskId: `task-${id}`,
      conversationId: `conversation-${id}`,
      source: "chat",
      status: "success",
      title: "Source task",
      summary: "Source task summary",
      startedAt: createdAt,
      finishedAt: createdAt,
    },
    createdAt,
    acceptedAt: createdAt,
    ...patch,
  };
}

function createTask(id: string, agentId: string): TaskRecord {
  const createdAt = "2026-07-23T10:00:00.000Z";
  return {
    id,
    conversationId: `conversation-${id}`,
    sessionKey: `conversation-${id}`,
    source: "chat",
    status: "partial",
    agentId,
    startedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}
