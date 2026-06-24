import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it("lookup 未命中返回 null", () => {
    expect(journal.lookup("journal-1", "fp-1")).toBeNull();
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

  it("recordError 后 lookup 返回 error 状态", () => {
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
    const hit = journal.lookup(journalId, fingerprint);
    expect(hit).not.toBeNull();
    expect(hit?.status).toBe("error");
  });

  it("markSkipped 后 lookup 返回 skipped 状态", () => {
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
    const hit = journal.lookup(journalId, fingerprint);
    expect(hit).not.toBeNull();
    expect(hit?.status).toBe("skipped");
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
