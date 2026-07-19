/**
 * WorkflowJournal — 动态工作流事件溯源
 *
 * 复用 MemoryStore 的 better-sqlite3 db 句柄，在同一个 SQLite 文件中维护
 * `workflow_journal` 表。每条记录对应一次 ctx.agent() 调用的指纹与结果，
 * 用于断点续传：只有已完成的相同 journalId + fingerprint 才能命中缓存。
 *
 * 设计要点：
 * - schema 由本类自行安装，不污染 MemoryStore 的 schema 常量
 * - 不关闭 db 句柄（close 由 MemoryStore 管理）
 * - 所有写操作使用 prepared statement，同进程同步执行
 * - UNIQUE(journal_id, fingerprint) 保证同一运行内指纹唯一
 */

import type { SqliteDatabase } from "@belldandy/memory";
import { randomUUID } from "node:crypto";

// ─── Schema ───────────────────────────────────────────────────────────────

const SCHEMA_WORKFLOW_JOURNAL = `
CREATE TABLE IF NOT EXISTS workflow_journal (
  id              TEXT    PRIMARY KEY,
  journal_id      TEXT    NOT NULL,
  workflow_name   TEXT,
  script_hash     TEXT    NOT NULL,
  call_key        TEXT    NOT NULL,
  fingerprint     TEXT    NOT NULL,
  prompt          TEXT    NOT NULL,
  opts_json       TEXT    NOT NULL,
  result          TEXT,
  result_json     TEXT,
  error           TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',
  token_count     INTEGER,
  cache_hit_count INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  UNIQUE(journal_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_wj_journal ON workflow_journal(journal_id);
CREATE INDEX IF NOT EXISTS idx_wj_script ON workflow_journal(journal_id, script_hash);
CREATE INDEX IF NOT EXISTS idx_wj_status ON workflow_journal(journal_id, status);
`;

// ─── Types ────────────────────────────────────────────────────────────────

export type WorkflowJournalStatus = "pending" | "done" | "error" | "skipped";

export type WorkflowJournalRow = {
  id: string;
  journalId: string;
  workflowName: string | null;
  scriptHash: string;
  callKey: string;
  fingerprint: string;
  prompt: string;
  optsJson: string;
  result: string | null;
  resultJson: string | null;
  error: string | null;
  status: WorkflowJournalStatus;
  tokenCount: number | null;
  cacheHitCount: number;
  createdAt: number;
  completedAt: number | null;
};

export type WorkflowJournalHit = {
  fingerprint: string;
  result: string;
  resultJson: string | null;
  tokenCount: number | null;
  status: "done";
};

export type WorkflowJournalPendingInput = {
  journalId: string;
  workflowName?: string;
  scriptHash: string;
  callKey: string;
  fingerprint: string;
  prompt: string;
  optsJson: string;
};

export type WorkflowJournalRecordInput = {
  journalId: string;
  fingerprint: string;
  result: string;
  tokenCount?: number;
  resultJson?: string;
  metadata?: unknown;
};

export type WorkflowJournalStats = {
  total: number;
  pending: number;
  done: number;
  errors: number;
  skipped: number;
  totalTokens: number;
  cacheHits: number;
};

// ─── WorkflowJournal ──────────────────────────────────────────────────────

export class WorkflowJournal {
  private readonly db: SqliteDatabase;
  private readonly stmtLookup;
  private readonly stmtInsertPending;
  private readonly stmtMarkDone;
  private readonly stmtMarkError;
  private readonly stmtMarkSkipped;
  private readonly stmtIncrCacheHit;
  private readonly stmtStats;
  private readonly stmtListByJournal;
  private readonly stmtDeleteByJournal;
  private readonly stmtLookupMigratable;
  private readonly stmtInsertMigrated;
  private schemaInstalled = false;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.installSchema();

    this.stmtLookup = db.prepare<{
      journal_id: string;
      fingerprint: string;
    }, WorkflowJournalRow>(`
      SELECT id, journal_id AS journalId, workflow_name AS workflowName,
             script_hash AS scriptHash, call_key AS callKey, fingerprint,
             prompt, opts_json AS optsJson, result, result_json AS resultJson,
             error, status, token_count AS tokenCount,
             cache_hit_count AS cacheHitCount, created_at AS createdAt,
             completed_at AS completedAt
      FROM workflow_journal
      WHERE journal_id = :journal_id AND fingerprint = :fingerprint
      LIMIT 1
    `);

    this.stmtInsertPending = db.prepare<{
      id: string;
      journal_id: string;
      workflow_name: string | null;
      script_hash: string;
      call_key: string;
      fingerprint: string;
      prompt: string;
      opts_json: string;
      created_at: number;
    }>(`
      INSERT OR IGNORE INTO workflow_journal
        (id, journal_id, workflow_name, script_hash, call_key, fingerprint,
         prompt, opts_json, status, cache_hit_count, created_at)
      VALUES
        (:id, :journal_id, :workflow_name, :script_hash, :call_key, :fingerprint,
         :prompt, :opts_json, 'pending', 0, :created_at)
    `);

    this.stmtMarkDone = db.prepare<{
      fingerprint: string;
      journal_id: string;
      result: string;
      result_json: string | null;
      token_count: number | null;
      completed_at: number;
    }>(`
      UPDATE workflow_journal
      SET status = 'done', result = :result, result_json = :result_json,
          token_count = :token_count, completed_at = :completed_at
      WHERE journal_id = :journal_id AND fingerprint = :fingerprint
    `);

    this.stmtMarkError = db.prepare<{
      fingerprint: string;
      journal_id: string;
      error: string;
      completed_at: number;
    }>(`
      UPDATE workflow_journal
      SET status = 'error', error = :error, completed_at = :completed_at
      WHERE journal_id = :journal_id AND fingerprint = :fingerprint
    `);

    this.stmtMarkSkipped = db.prepare<{
      fingerprint: string;
      journal_id: string;
      completed_at: number;
    }>(`
      UPDATE workflow_journal
      SET status = 'skipped', completed_at = :completed_at
      WHERE journal_id = :journal_id AND fingerprint = :fingerprint
    `);

    this.stmtIncrCacheHit = db.prepare<{
      fingerprint: string;
      journal_id: string;
    }>(`
      UPDATE workflow_journal
      SET cache_hit_count = cache_hit_count + 1
      WHERE journal_id = :journal_id AND fingerprint = :fingerprint
    `);

    this.stmtStats = db.prepare<{ journal_id: string }, {
      total: number;
      pending: number;
      done: number;
      errors: number;
      skipped: number;
      totalTokens: number | null;
      cacheHits: number | null;
    }>(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
        COALESCE(SUM(token_count), 0) AS totalTokens,
        COALESCE(SUM(cache_hit_count), 0) AS cacheHits
      FROM workflow_journal
      WHERE journal_id = :journal_id
    `);

    this.stmtListByJournal = db.prepare<{ journal_id: string }, WorkflowJournalRow>(`
      SELECT id, journal_id AS journalId, workflow_name AS workflowName,
             script_hash AS scriptHash, call_key AS callKey, fingerprint,
             prompt, opts_json AS optsJson, result, result_json AS resultJson,
             error, status, token_count AS tokenCount,
             cache_hit_count AS cacheHitCount, created_at AS createdAt,
             completed_at AS completedAt
      FROM workflow_journal
      WHERE journal_id = :journal_id
      ORDER BY created_at ASC
    `);

    this.stmtDeleteByJournal = db.prepare<{ journal_id: string }>(`
      DELETE FROM workflow_journal WHERE journal_id = :journal_id
    `);

    // migration 查询：按 journal_id + call_key + prompt 查找旧记录（忽略 script_hash）
    // 用于跨版本迁移——当脚本升级导致 scriptHash 变化但 callKey + prompt 不变时，
    // 可以复用旧记录的结果，避免重新执行。
    this.stmtLookupMigratable = db.prepare<{
      journal_id: string;
      call_key: string;
      prompt: string;
    }, WorkflowJournalRow>(`
      SELECT id, journal_id AS journalId, workflow_name AS workflowName,
             script_hash AS scriptHash, call_key AS callKey, fingerprint,
             prompt, opts_json AS optsJson, result, result_json AS resultJson,
             error, status, token_count AS tokenCount,
             cache_hit_count AS cacheHitCount, created_at AS createdAt,
             completed_at AS completedAt
      FROM workflow_journal
      WHERE journal_id = :journal_id AND call_key = :call_key AND prompt = :prompt
        AND status = 'done'
      ORDER BY completed_at DESC
      LIMIT 1
    `);

    // 复制一条记录到新 fingerprint 下（用于 migration）
    this.stmtInsertMigrated = db.prepare<{
      id: string;
      journal_id: string;
      workflow_name: string | null;
      script_hash: string;
      call_key: string;
      fingerprint: string;
      prompt: string;
      opts_json: string;
      result: string;
      result_json: string | null;
      token_count: number | null;
      status: string;
      created_at: number;
      completed_at: number;
    }>(`
      INSERT OR IGNORE INTO workflow_journal
        (id, journal_id, workflow_name, script_hash, call_key, fingerprint,
         prompt, opts_json, result, result_json, status, token_count,
         cache_hit_count, created_at, completed_at)
      VALUES
        (:id, :journal_id, :workflow_name, :script_hash, :call_key, :fingerprint,
         :prompt, :opts_json, :result, :result_json, 'done', :token_count,
         0, :created_at, :completed_at)
    `);
  }

  private installSchema(): void {
    if (this.schemaInstalled) return;
    this.db.exec(SCHEMA_WORKFLOW_JOURNAL);
    this.schemaInstalled = true;
  }

  /**
   * 查询某次运行中是否已有该 fingerprint 的成功记录。
   * error/skipped/pending 都必须重新执行，不能以空 result 伪装成 cache hit。
   */
  lookup(journalId: string, fingerprint: string): WorkflowJournalHit | null {
    const row = this.stmtLookup.get({ journal_id: journalId, fingerprint });
    if (!row || row.status !== "done") return null;
    return {
      fingerprint: row.fingerprint,
      result: row.result ?? "",
      resultJson: row.resultJson,
      tokenCount: row.tokenCount,
      status: row.status,
    };
  }

  /**
   * 写入一条 pending 记录。若 UNIQUE(journal_id, fingerprint) 冲突则忽略。
   */
  recordPending(input: WorkflowJournalPendingInput): void {
    this.stmtInsertPending.run({
      id: randomUUID(),
      journal_id: input.journalId,
      workflow_name: input.workflowName ?? null,
      script_hash: input.scriptHash,
      call_key: input.callKey,
      fingerprint: input.fingerprint,
      prompt: input.prompt,
      opts_json: input.optsJson,
      created_at: Date.now(),
    });
  }

  /**
   * 将 pending 记录标记为 done。若记录不存在则忽略。
   */
  record(input: WorkflowJournalRecordInput): void {
    this.stmtMarkDone.run({
      journal_id: input.journalId,
      fingerprint: input.fingerprint,
      result: input.result,
      result_json: input.resultJson ?? null,
      token_count: input.tokenCount ?? null,
      completed_at: Date.now(),
    });
  }

  /**
   * 将 pending 记录标记为 error。
   */
  recordError(journalId: string, fingerprint: string, error: string): void {
    this.stmtMarkError.run({
      journal_id: journalId,
      fingerprint,
      error,
      completed_at: Date.now(),
    });
  }

  /**
   * 将 pending 记录标记为 skipped（例如预算熔断后跳过）。
   */
  markSkipped(journalId: string, fingerprint: string): void {
    this.stmtMarkSkipped.run({
      journal_id: journalId,
      fingerprint,
      completed_at: Date.now(),
    });
  }

  /**
   * 命中缓存时累加 cache_hit_count（用于可观测性）。
   */
  incrementCacheHit(journalId: string, fingerprint: string): void {
    this.stmtIncrCacheHit.run({ journal_id: journalId, fingerprint });
  }

  /**
   * 获取某次运行的统计信息。
   */
  getStats(journalId: string): WorkflowJournalStats {
    const row = this.stmtStats.get({ journal_id: journalId });
    if (!row) {
      return {
        total: 0, pending: 0, done: 0, errors: 0, skipped: 0,
        totalTokens: 0, cacheHits: 0,
      };
    }
    return {
      total: row.total ?? 0,
      pending: row.pending ?? 0,
      done: row.done ?? 0,
      errors: row.errors ?? 0,
      skipped: row.skipped ?? 0,
      totalTokens: row.totalTokens ?? 0,
      cacheHits: row.cacheHits ?? 0,
    };
  }

  /**
   * 列出某次运行的所有 journal 记录（按创建时间升序）。
   */
  listByJournal(journalId: string): WorkflowJournalRow[] {
    return this.stmtListByJournal.all({ journal_id: journalId });
  }

  /**
   * 删除某次运行的所有 journal 记录（用于清理或重跑）。
   */
  deleteByJournal(journalId: string): number {
    const info = this.stmtDeleteByJournal.run({ journal_id: journalId });
    return info.changes;
  }

  // ─── 跨版本 migration ────────────────────────────────────────────────────
  //
  // 当脚本升级导致 scriptHash 变化时，断点续传默认会因 fingerprint 不匹配
  // 而失效。migration policy 允许在 callKey + prompt 不变的前提下复用旧记录：
  //
  //   可迁移条件：journal_id + call_key + prompt 相同，且旧记录 status=done
  //   不迁移条件：workflowVersion 变化、prompt 变化、callKey 变化
  //
  // 迁移方式：将旧记录的 result 复制到新 fingerprint 下，原记录保留。

  /**
   * 按 journal_id + call_key + prompt 查找可迁移的旧记录。
   * 只返回 status=done 的记录，忽略 script_hash 差异。
   */
  lookupMigratable(journalId: string, callKey: string, prompt: string): WorkflowJournalRow | null {
    const row = this.stmtLookupMigratable.get({
      journal_id: journalId,
      call_key: callKey,
      prompt,
    });
    return row ?? null;
  }

  /**
   * 将一条旧记录的结果复制到新 fingerprint 下。
   * 用于 migration：新脚本版本执行前，把可复用的旧结果预填充到新 fingerprint，
   * 使后续 lookup() 命中缓存。INSERT OR IGNORE 保证幂等。
   */
  insertMigratedRecord(input: {
    journalId: string;
    workflowName?: string;
    scriptHash: string;
    callKey: string;
    fingerprint: string;
    prompt: string;
    optsJson: string;
    result: string;
    resultJson: string | null;
    tokenCount: number | null;
    completedAt: number;
  }): void {
    this.stmtInsertMigrated.run({
      id: randomUUID(),
      journal_id: input.journalId,
      workflow_name: input.workflowName ?? null,
      script_hash: input.scriptHash,
      call_key: input.callKey,
      fingerprint: input.fingerprint,
      prompt: input.prompt,
      opts_json: input.optsJson,
      result: input.result,
      result_json: input.resultJson,
      token_count: input.tokenCount,
      status: "done",
      created_at: Date.now(),
      completed_at: input.completedAt,
    });
  }

  /**
   * 在一个事务中执行多个 journal 操作。
   * 用于保证 recordPending + record 的原子性。
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
