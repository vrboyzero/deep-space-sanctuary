import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryStore } from "@belldandy/memory";
import { WorkflowJournal } from "./workflow-journal.js";

describe("WorkflowJournal", () => {
  let rootDir: string;
  let dbPath: string;
  let store: MemoryStore;
  let journal: WorkflowJournal;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workflow-journal-"));
    dbPath = path.join(rootDir, "memory.db");
    store = new MemoryStore(dbPath);
    journal = new WorkflowJournal(store.getDbHandleForSharedSchema());
  });

  afterEach(async () => {
    vi.useRealTimers();
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it("lookup 未命中返回 null", () => {
    expect(journal.lookup("journal-1", "fp-1")).toBeNull();
  });

  it("首次 pending claim 返回 owner generation 与 lease", () => {
    const claim = journal.claimPending({
      journalId: "journal-claim-first",
      workflowName: "code-audit",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-claim-first",
      prompt: "扫描 auth",
      optsJson: "{}",
      ownerId: "run-owner-a",
      leaseDurationMs: 30_000,
    });

    expect(claim).toMatchObject({
      outcome: "claimed",
      ownerId: "run-owner-a",
      generation: 1,
    });
    expect(claim.leaseExpiresAt).toBeGreaterThan(Date.now());
    expect(journal.listByJournal("journal-claim-first")).toEqual([
      expect.objectContaining({ fingerprint: "fp-claim-first", status: "pending" }),
    ]);
  });

  it("未过期 pending claim 拒绝竞争 owner", () => {
    const input = {
      journalId: "journal-claim-conflict",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-claim-conflict",
      prompt: "扫描 auth",
      optsJson: "{}",
      leaseDurationMs: 30_000,
    };
    const first = journal.claimPending({ ...input, ownerId: "run-owner-a" });
    const competing = journal.claimPending({ ...input, ownerId: "run-owner-b" });

    expect(first).toMatchObject({ outcome: "claimed", ownerId: "run-owner-a", generation: 1 });
    expect(competing).toEqual({
      outcome: "conflict",
      ownerId: "run-owner-a",
      generation: 1,
      leaseExpiresAt: first.leaseExpiresAt,
    });
  });

  it("过期 pending claim 可由新 owner 回收并递增 generation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const input = {
      journalId: "journal-claim-expired",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-claim-expired",
      prompt: "扫描 auth",
      optsJson: "{}",
      leaseDurationMs: 1_000,
    };
    journal.claimPending({ ...input, ownerId: "run-owner-a" });

    vi.advanceTimersByTime(1_000);
    const reclaimed = journal.claimPending({ ...input, ownerId: "run-owner-b" });

    expect(reclaimed).toEqual({
      outcome: "claimed",
      ownerId: "run-owner-b",
      generation: 2,
      leaseExpiresAt: Date.now() + 1_000,
    });
  });

  it("只有当前 owner generation 能续约未过期 pending claim", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const claim = journal.claimPending({
      journalId: "journal-renew",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-renew",
      prompt: "扫描 auth",
      optsJson: "{}",
      ownerId: "run-owner-a",
      leaseDurationMs: 1_000,
    });

    vi.advanceTimersByTime(500);
    expect(journal.renewPending({
      journalId: "journal-renew",
      fingerprint: "fp-renew",
      ownerId: "run-owner-b",
      generation: claim.generation,
      leaseDurationMs: 2_000,
    })).toBeNull();
    expect(journal.renewPending({
      journalId: "journal-renew",
      fingerprint: "fp-renew",
      ownerId: "run-owner-a",
      generation: claim.generation,
      leaseDurationMs: 2_000,
    })).toEqual({
      ownerId: "run-owner-a",
      generation: 1,
      leaseExpiresAt: Date.now() + 2_000,
    });
  });

  it("当前 owner generation 能把 pending claim 结算为 done", () => {
    const claim = journal.claimPending({
      journalId: "journal-settle-done",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-settle-done",
      prompt: "扫描 auth",
      optsJson: "{}",
      ownerId: "run-owner-a",
      leaseDurationMs: 30_000,
    });

    expect(journal.settlePending({
      journalId: "journal-settle-done",
      fingerprint: "fp-settle-done",
      ownerId: claim.ownerId,
      generation: claim.generation,
      status: "done",
      result: "发现 3 个隐患",
      resultJson: '{"count":3}',
      tokenCount: 500,
    })).toBe(true);
    expect(journal.lookup("journal-settle-done", "fp-settle-done")).toMatchObject({
      status: "done",
      result: "发现 3 个隐患",
      resultJson: '{"count":3}',
      tokenCount: 500,
    });
  });

  it("过期回收后拒绝旧 owner 的迟到结算", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
    const claimInput = {
      journalId: "journal-settle-fence",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-settle-fence",
      prompt: "扫描 auth",
      optsJson: "{}",
      leaseDurationMs: 1_000,
    };
    const oldClaim = journal.claimPending({ ...claimInput, ownerId: "run-owner-a" });
    vi.advanceTimersByTime(1_000);
    const currentClaim = journal.claimPending({ ...claimInput, ownerId: "run-owner-b" });

    expect(journal.settlePending({
      journalId: claimInput.journalId,
      fingerprint: claimInput.fingerprint,
      ownerId: oldClaim.ownerId,
      generation: oldClaim.generation,
      status: "done",
      result: "late result",
    })).toBe(false);
    expect(journal.settlePending({
      journalId: claimInput.journalId,
      fingerprint: claimInput.fingerprint,
      ownerId: currentClaim.ownerId,
      generation: currentClaim.generation,
      status: "done",
      result: "current result",
    })).toBe(true);
    expect(journal.lookup(claimInput.journalId, claimInput.fingerprint)?.result).toBe("current result");
  });

  it("旧 schema 的 pending 记录可迁移并由新 owner 接管", () => {
    const db = store.getDbHandleForSharedSchema();
    db.exec("DROP TABLE workflow_journal");
    db.exec(`
      CREATE TABLE workflow_journal (
        id TEXT PRIMARY KEY,
        journal_id TEXT NOT NULL,
        workflow_name TEXT,
        script_hash TEXT NOT NULL,
        call_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        prompt TEXT NOT NULL,
        opts_json TEXT NOT NULL,
        result TEXT,
        result_json TEXT,
        error TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        token_count INTEGER,
        cache_hit_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        UNIQUE(journal_id, fingerprint)
      )
    `);
    db.prepare(`
      INSERT INTO workflow_journal
        (id, journal_id, script_hash, call_key, fingerprint, prompt, opts_json, status, created_at)
      VALUES ('legacy-row', 'journal-legacy', 'hash-1', 'scan/0', 'fp-legacy', '扫描 auth', '{}', 'pending', 1)
    `).run();

    const migratedJournal = new WorkflowJournal(db);
    const claim = migratedJournal.claimPending({
      journalId: "journal-legacy",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-legacy",
      prompt: "扫描 auth",
      optsJson: "{}",
      ownerId: "run-owner-new",
      leaseDurationMs: 30_000,
    });

    expect(claim).toMatchObject({ outcome: "claimed", ownerId: "run-owner-new", generation: 1 });
    expect(migratedJournal.listByJournal("journal-legacy")).toHaveLength(1);
  });

  it("不同 Journal 实例竞争同一 pending claim 时只有一个 owner", () => {
    const competingJournal = new WorkflowJournal(store.getDbHandleForSharedSchema());
    const input = {
      journalId: "journal-instance-race",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-instance-race",
      prompt: "扫描 auth",
      optsJson: "{}",
      leaseDurationMs: 30_000,
    };

    const first = journal.claimPending({ ...input, ownerId: "run-owner-a" });
    const competing = competingJournal.claimPending({ ...input, ownerId: "run-owner-b" });

    expect(first.outcome).toBe("claimed");
    expect(competing).toMatchObject({
      outcome: "conflict",
      ownerId: "run-owner-a",
      generation: first.generation,
    });
  });

  it("当前 owner generation 能结算 error 与 skipped 终态", () => {
    const base = {
      journalId: "journal-settle-terminal",
      scriptHash: "hash-1",
      prompt: "扫描 auth",
      optsJson: "{}",
      ownerId: "run-owner-a",
      leaseDurationMs: 30_000,
    };
    const errorClaim = journal.claimPending({
      ...base,
      callKey: "scan/0",
      fingerprint: "fp-settle-error",
    });
    const skippedClaim = journal.claimPending({
      ...base,
      callKey: "scan/1",
      fingerprint: "fp-settle-skipped",
    });

    expect(journal.settlePending({
      journalId: base.journalId,
      fingerprint: "fp-settle-error",
      ownerId: errorClaim.ownerId,
      generation: errorClaim.generation,
      status: "error",
      error: "agent timeout",
    })).toBe(true);
    expect(journal.settlePending({
      journalId: base.journalId,
      fingerprint: "fp-settle-skipped",
      ownerId: skippedClaim.ownerId,
      generation: skippedClaim.generation,
      status: "skipped",
    })).toBe(true);
    expect(journal.listByJournal(base.journalId)).toEqual([
      expect.objectContaining({ status: "error", error: "agent timeout" }),
      expect.objectContaining({ status: "skipped" }),
    ]);
  });

  it("error 与 skipped 可重新 claim，但 done 结果不可覆盖", () => {
    const base = {
      journalId: "journal-terminal-reclaim",
      scriptHash: "hash-1",
      prompt: "扫描 auth",
      optsJson: "{}",
      leaseDurationMs: 30_000,
    };
    const errorClaim = journal.claimPending({
      ...base,
      callKey: "scan/error",
      fingerprint: "fp-error-reclaim",
      ownerId: "run-owner-a",
    });
    const skippedClaim = journal.claimPending({
      ...base,
      callKey: "scan/skipped",
      fingerprint: "fp-skipped-reclaim",
      ownerId: "run-owner-a",
    });
    const doneClaim = journal.claimPending({
      ...base,
      callKey: "scan/done",
      fingerprint: "fp-done-protected",
      ownerId: "run-owner-a",
    });
    journal.settlePending({
      journalId: base.journalId,
      fingerprint: "fp-error-reclaim",
      ownerId: errorClaim.ownerId,
      generation: errorClaim.generation,
      status: "error",
      error: "temporary failure",
    });
    journal.settlePending({
      journalId: base.journalId,
      fingerprint: "fp-skipped-reclaim",
      ownerId: skippedClaim.ownerId,
      generation: skippedClaim.generation,
      status: "skipped",
    });
    journal.settlePending({
      journalId: base.journalId,
      fingerprint: "fp-done-protected",
      ownerId: doneClaim.ownerId,
      generation: doneClaim.generation,
      status: "done",
      result: "stable result",
    });

    expect(journal.claimPending({
      ...base,
      callKey: "scan/error",
      fingerprint: "fp-error-reclaim",
      ownerId: "run-owner-b",
    })).toMatchObject({ outcome: "claimed", ownerId: "run-owner-b", generation: 2 });
    expect(journal.claimPending({
      ...base,
      callKey: "scan/skipped",
      fingerprint: "fp-skipped-reclaim",
      ownerId: "run-owner-b",
    })).toMatchObject({ outcome: "claimed", ownerId: "run-owner-b", generation: 2 });
    expect(() => journal.claimPending({
      ...base,
      callKey: "scan/done",
      fingerprint: "fp-done-protected",
      ownerId: "run-owner-b",
    })).toThrow(/cannot replace a completed result/i);
    expect(journal.lookup(base.journalId, "fp-done-protected")?.result).toBe("stable result");
  });

  it("recordPending + record 后 lookup 命中", () => {
    const journalId = "journal-1";
    const fingerprint = "fp-abc";
    journal.recordPending({
      journalId,
      workflowName: "code-audit",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "扫描 auth",
      optsJson: "{}",
    });
    journal.record({
      journalId,
      fingerprint,
      result: "发现 3 个隐患",
      tokenCount: 500,
    });
    const hit = journal.lookup(journalId, fingerprint);
    expect(hit).not.toBeNull();
    expect(hit?.status).toBe("done");
    expect(hit?.result).toBe("发现 3 个隐患");
    expect(hit?.tokenCount).toBe(500);
  });

  it("pending 状态不视为命中", () => {
    const journalId = "journal-2";
    const fingerprint = "fp-pending";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "prompt",
      optsJson: "{}",
    });
    expect(journal.lookup(journalId, fingerprint)).toBeNull();
  });

  it("recordError 后 lookup 不返回可复用的 cache hit", () => {
    const journalId = "journal-3";
    const fingerprint = "fp-err";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "prompt",
      optsJson: "{}",
    });
    journal.recordError(journalId, fingerprint, "agent timeout");
    expect(journal.lookup(journalId, fingerprint)).toBeNull();
  });

  it("markSkipped 后 lookup 不返回可复用的 cache hit", () => {
    const journalId = "journal-4";
    const fingerprint = "fp-skip";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "prompt",
      optsJson: "{}",
    });
    journal.markSkipped(journalId, fingerprint);
    expect(journal.lookup(journalId, fingerprint)).toBeNull();
  });

  it("UNIQUE(journal_id, fingerprint) 约束：重复 recordPending 不报错（幂等）", () => {
    const journalId = "journal-5";
    const fingerprint = "fp-dup";
    const input = {
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "prompt",
      optsJson: "{}",
    };
    // 第一次插入成功
    journal.recordPending(input);
    // 第二次插入相同 fingerprint 应该被忽略，不抛错
    expect(() => journal.recordPending(input)).not.toThrow();
    expect(journal.listByJournal(journalId)).toHaveLength(1);
  });

  it("跨 journalId 隔离：相同 fingerprint 不同 journalId 互不影响", () => {
    const fingerprint = "fp-shared";
    journal.recordPending({
      journalId: "journal-a",
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "prompt-a",
      optsJson: "{}",
    });
    journal.record({
      journalId: "journal-a",
      fingerprint,
      result: "result-a",
    });
    // journal-b 没有该 fingerprint
    expect(journal.lookup("journal-b", fingerprint)).toBeNull();
    expect(journal.lookup("journal-a", fingerprint)?.result).toBe("result-a");
  });

  it("getStats 统计正确", () => {
    const journalId = "journal-stats";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-1",
      prompt: "p1",
      optsJson: "{}",
    });
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/1",
      fingerprint: "fp-2",
      prompt: "p2",
      optsJson: "{}",
    });
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/2",
      fingerprint: "fp-3",
      prompt: "p3",
      optsJson: "{}",
    });
    journal.record({ journalId, fingerprint: "fp-1", result: "r1", tokenCount: 100 });
    journal.recordError(journalId, "fp-2", "err");
    journal.markSkipped(journalId, "fp-3");

    const stats = journal.getStats(journalId);
    expect(stats.total).toBe(3);
    expect(stats.done).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.totalTokens).toBe(100);
  });

  it("getStats 空 journalId 返回全零", () => {
    const stats = journal.getStats("nonexistent");
    expect(stats.total).toBe(0);
    expect(stats.done).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });

  it("incrementCacheHit 累加 cache_hit_count", () => {
    const journalId = "journal-cache";
    const fingerprint = "fp-cache";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "p",
      optsJson: "{}",
    });
    journal.record({ journalId, fingerprint, result: "r" });
    journal.incrementCacheHit(journalId, fingerprint);
    journal.incrementCacheHit(journalId, fingerprint);
    const rows = journal.listByJournal(journalId);
    expect(rows[0].cacheHitCount).toBe(2);
    const stats = journal.getStats(journalId);
    expect(stats.cacheHits).toBe(2);
  });

  it("listByJournal 按创建时间升序", () => {
    const journalId = "journal-list";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-1",
      prompt: "p1",
      optsJson: "{}",
    });
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/1",
      fingerprint: "fp-2",
      prompt: "p2",
      optsJson: "{}",
    });
    const rows = journal.listByJournal(journalId);
    expect(rows).toHaveLength(2);
    expect(rows[0].fingerprint).toBe("fp-1");
    expect(rows[1].fingerprint).toBe("fp-2");
  });

  it("deleteByJournal 删除所有记录", () => {
    const journalId = "journal-del";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint: "fp-1",
      prompt: "p1",
      optsJson: "{}",
    });
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/1",
      fingerprint: "fp-2",
      prompt: "p2",
      optsJson: "{}",
    });
    const deleted = journal.deleteByJournal(journalId);
    expect(deleted).toBe(2);
    expect(journal.listByJournal(journalId)).toHaveLength(0);
  });

  it("transaction 保证原子性", () => {
    const journalId = "journal-tx";
    journal.transaction(() => {
      journal.recordPending({
        journalId,
        scriptHash: "hash-1",
        callKey: "scan/0",
        fingerprint: "fp-1",
        prompt: "p1",
        optsJson: "{}",
      });
      journal.record({ journalId, fingerprint: "fp-1", result: "r1" });
    });
    const hit = journal.lookup(journalId, "fp-1");
    expect(hit?.result).toBe("r1");
  });

  it("多次构造 WorkflowJournal 不重复安装 schema（幂等）", () => {
    expect(() => new WorkflowJournal(store.getDbHandleForSharedSchema())).not.toThrow();
  });

  it("resultJson 可选字段", () => {
    const journalId = "journal-json";
    const fingerprint = "fp-json";
    journal.recordPending({
      journalId,
      scriptHash: "hash-1",
      callKey: "scan/0",
      fingerprint,
      prompt: "p",
      optsJson: "{}",
    });
    journal.record({
      journalId,
      fingerprint,
      result: "summary",
      resultJson: '{"details":[1,2]}',
      tokenCount: 50,
    });
    const hit = journal.lookup(journalId, fingerprint);
    expect(hit?.resultJson).toBe('{"details":[1,2]}');
  });

  // ─── 跨版本 migration ────────────────────────────────────────────────────

  describe("migration", () => {
    it("lookupMigratable 按 callKey + prompt 查找旧 done 记录", () => {
      const journalId = "journal-mig-1";
      journal.recordPending({
        journalId,
        scriptHash: "old-hash",
        callKey: "scan/0",
        fingerprint: "fp-old",
        prompt: "扫描 auth",
        optsJson: "{}",
      });
      journal.record({ journalId, fingerprint: "fp-old", result: "result-old", tokenCount: 100 });
      const row = journal.lookupMigratable(journalId, "scan/0", "扫描 auth");
      expect(row).not.toBeNull();
      expect(row?.scriptHash).toBe("old-hash");
      expect(row?.result).toBe("result-old");
    });

    it("lookupMigratable 不返回 pending/error/skipped 记录", () => {
      const journalId = "journal-mig-2";
      journal.recordPending({
        journalId,
        scriptHash: "old-hash",
        callKey: "scan/0",
        fingerprint: "fp-pending",
        prompt: "p",
        optsJson: "{}",
      });
      // pending 状态不返回
      expect(journal.lookupMigratable(journalId, "scan/0", "p")).toBeNull();
    });

    it("lookupMigratable callKey 或 prompt 不匹配时返回 null", () => {
      const journalId = "journal-mig-3";
      journal.recordPending({
        journalId,
        scriptHash: "old-hash",
        callKey: "scan/0",
        fingerprint: "fp-old",
        prompt: "扫描 auth",
        optsJson: "{}",
      });
      journal.record({ journalId, fingerprint: "fp-old", result: "r" });
      expect(journal.lookupMigratable(journalId, "scan/1", "扫描 auth")).toBeNull();
      expect(journal.lookupMigratable(journalId, "scan/0", "扫描 api")).toBeNull();
    });

    it("insertMigratedRecord 写入新 fingerprint 记录，可被 lookup 命中", () => {
      const journalId = "journal-mig-4";
      const newFingerprint = "fp-new";
      journal.insertMigratedRecord({
        journalId,
        workflowName: "code-audit",
        scriptHash: "new-hash",
        callKey: "scan/0",
        fingerprint: newFingerprint,
        prompt: "扫描 auth",
        optsJson: "{}",
        result: "migrated-result",
        resultJson: null,
        tokenCount: 100,
        completedAt: Date.now(),
      });
      const hit = journal.lookup(journalId, newFingerprint);
      expect(hit).not.toBeNull();
      expect(hit?.status).toBe("done");
      expect(hit?.result).toBe("migrated-result");
      expect(hit?.tokenCount).toBe(100);
    });

    it("insertMigratedRecord 幂等（INSERT OR IGNORE）", () => {
      const journalId = "journal-mig-5";
      const fingerprint = "fp-idem";
      const input = {
        journalId,
        workflowName: "wf" as string | undefined,
        scriptHash: "new-hash",
        callKey: "scan/0",
        fingerprint,
        prompt: "p",
        optsJson: "{}",
        result: "r",
        resultJson: null,
        tokenCount: 10,
        completedAt: Date.now(),
      };
      journal.insertMigratedRecord(input);
      // 重复插入不报错
      expect(() => journal.insertMigratedRecord(input)).not.toThrow();
      // 仍然只有一条记录
      const rows = journal.listByJournal(journalId);
      expect(rows).toHaveLength(1);
    });
  });
});
