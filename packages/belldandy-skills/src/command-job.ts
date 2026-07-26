import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JsonObject } from "./types.js";
import type { ProcessTerminationResult } from "./builtin/system/process-lease.js";

const COMMAND_JOB_STORE_DIRECTORY = "command-jobs";
const COMMAND_JOB_RECORD_VERSION = 1;
const COMMAND_JOB_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OCI_CONTAINER_NAME_PATTERN = /^belldandy-command-[a-f0-9]{32}$/i;

export const DEFAULT_COMMAND_JOB_MAX_ACTIVE = 16;
export const DEFAULT_COMMAND_JOB_TERMINAL_HISTORY_SIZE = 64;
export const DEFAULT_COMMAND_JOB_MAX_OUTPUT_BYTES = 512 * 1024;
export const DEFAULT_COMMAND_JOB_READ_BYTES = 64 * 1024;
export const DEFAULT_COMMAND_JOB_TIMEOUT_MS = 300_000;

export type CommandJobStatus = "running" | "completed" | "cancelled" | "failed" | "lost";
type PersistedCommandJobStatus = "starting" | CommandJobStatus;

export type CommandJobProcessExit = {
  exitCode?: number;
  signal?: string | number;
  error?: string;
};

/** A process adapter deliberately exposes only the controls owned by one command job. */
export interface CommandJobProcess {
  readonly pid: number;
  readonly supportsResize: boolean;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: CommandJobProcessExit) => void): void;
  terminate(): Promise<ProcessTerminationResult>;
}

export type PersistedCommandJob = {
  version: 1;
  jobId: string;
  status: PersistedCommandJobStatus;
  stdinMode: "closed" | "pipe" | "pty";
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  pid?: number;
  supportsResize: boolean;
  timeoutMs?: number;
  deadlineAt?: number;
  error?: string;
  persistedSandbox?: {
    runtime: "docker" | "podman";
    containerName: string;
  };
};

export type CommandJobSnapshot = {
  jobId: string;
  status: CommandJobStatus;
  stdinMode: "closed" | "pipe" | "pty";
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  pid?: number;
  supportsResize: boolean;
  timeoutMs?: number;
  deadlineAt?: number;
  oldestCursor: number;
  nextCursor: number;
  exitCode?: number;
  signal?: string | number;
  error?: string;
  processTerminationMethod?: ProcessTerminationResult["method"];
  processHardKillUsed?: boolean;
  processCloseObserved?: boolean;
  cleanup?: JsonObject;
};

export type CommandJobReadResult = CommandJobSnapshot & {
  output: string;
  startCursor: number;
  nextCursor: number;
  hasMore: boolean;
  cursorExpired: boolean;
  cursorAdjusted: boolean;
};

export type CommandJobStartInput = {
  /** The OCI lease ID is reused as the job ID so restart recovery has one stable owner key. */
  jobId?: string;
  stdinMode: "closed" | "pipe" | "pty";
  /** A job must always have a bounded lifetime, even when callers omit a plan timeout. */
  timeoutMs?: number;
  process?: CommandJobProcess;
  startProcess?: () => Promise<CommandJobProcess>;
  cleanup?: () => Promise<JsonObject | undefined>;
  persistedSandbox?: PersistedCommandJob["persistedSandbox"];
};

/** Lets a sandbox cleanup keep non-sensitive lease diagnostics while failing the job closed. */
export class CommandJobCleanupError extends Error {
  constructor(message: string, readonly metadata: JsonObject) {
    super(message);
    this.name = "CommandJobCleanupError";
  }
}

type CommandJob = {
  jobId: string;
  status: CommandJobStatus | "starting";
  stdinMode: CommandJobStartInput["stdinMode"];
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  pid?: number;
  supportsResize: boolean;
  timeoutMs?: number;
  deadlineAt?: number;
  timeoutTimer?: NodeJS.Timeout;
  startup?: {
    ready: Promise<void>;
    resolve: () => void;
  };
  output: CommandJobOutputBuffer;
  process?: CommandJobProcess;
  cleanup?: CommandJobStartInput["cleanup"];
  cleanupResult?: JsonObject;
  persistedSandbox?: PersistedCommandJob["persistedSandbox"];
  exitCode?: number;
  signal?: string | number;
  error?: string;
  termination?: ProcessTerminationResult;
  finalization?: Promise<CommandJobSnapshot>;
  cancellation?: Promise<CommandJobSnapshot>;
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function createStartupGate(): NonNullable<CommandJob["startup"]> {
  let resolve!: () => void;
  const ready = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { ready, resolve };
}

function isTerminalStatus(status: CommandJob["status"]): status is Exclude<CommandJobStatus, "running"> {
  return status !== "running" && status !== "starting";
}

function assertCommandJobId(value: string): void {
  if (!COMMAND_JOB_ID_PATTERN.test(value)) {
    throw new Error("Command job ID must be a UUID.");
  }
}

function isPersistedSandbox(value: unknown): value is NonNullable<PersistedCommandJob["persistedSandbox"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sandbox = value as Record<string, unknown>;
  return (sandbox.runtime === "docker" || sandbox.runtime === "podman")
    && typeof sandbox.containerName === "string"
    && OCI_CONTAINER_NAME_PATTERN.test(sandbox.containerName);
}

function parsePersistedCommandJob(value: unknown): PersistedCommandJob | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== COMMAND_JOB_RECORD_VERSION
    || typeof record.jobId !== "string"
    || !COMMAND_JOB_ID_PATTERN.test(record.jobId)
    || !["starting", "running", "completed", "cancelled", "failed", "lost"].includes(String(record.status))
    || !["closed", "pipe", "pty"].includes(String(record.stdinMode))
    || !Number.isSafeInteger(record.createdAt)
    || !Number.isSafeInteger(record.updatedAt)
    || typeof record.supportsResize !== "boolean") {
    return undefined;
  }
  const status = record.status as PersistedCommandJobStatus;
  const persistedSandbox = isPersistedSandbox(record.persistedSandbox) ? record.persistedSandbox : undefined;
  return {
    version: 1,
    jobId: record.jobId,
    status,
    stdinMode: record.stdinMode as PersistedCommandJob["stdinMode"],
    createdAt: record.createdAt as number,
    updatedAt: record.updatedAt as number,
    ...(Number.isSafeInteger(record.endedAt) ? { endedAt: record.endedAt as number } : {}),
    ...(Number.isSafeInteger(record.pid) && (record.pid as number) > 0 ? { pid: record.pid as number } : {}),
    supportsResize: record.supportsResize,
    ...(Number.isSafeInteger(record.timeoutMs) && (record.timeoutMs as number) > 0
      ? { timeoutMs: record.timeoutMs as number }
      : {}),
    ...(Number.isSafeInteger(record.deadlineAt) && (record.deadlineAt as number) > 0
      ? { deadlineAt: record.deadlineAt as number }
      : {}),
    ...(typeof record.error === "string" && record.error.length <= 512 ? { error: record.error } : {}),
    ...(persistedSandbox ? { persistedSandbox } : {}),
  };
}

/**
 * The job store intentionally contains lifecycle metadata only. Terminal output and
 * stdin may contain repository secrets, so they remain in memory and become unavailable
 * after a Gateway restart.
 */
export class CommandJobStateStore {
  private readonly directory: string;

  constructor(stateDir: string) {
    this.directory = path.join(path.resolve(stateDir), COMMAND_JOB_STORE_DIRECTORY);
  }

  async list(): Promise<PersistedCommandJob[]> {
    await mkdir(this.directory, { recursive: true });
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          const raw = await readFile(path.join(this.directory, entry), "utf8");
          return parsePersistedCommandJob(JSON.parse(raw));
        } catch {
          return undefined;
        }
      }));
    return records.filter((record): record is PersistedCommandJob => Boolean(record));
  }

  async save(record: PersistedCommandJob): Promise<void> {
    assertCommandJobId(record.jobId);
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${record.jobId}.json`);
    const temporary = path.join(this.directory, `${record.jobId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async remove(jobId: string): Promise<void> {
    assertCommandJobId(jobId);
    await rm(path.join(this.directory, `${jobId}.json`), { force: true });
  }
}

class CommandJobOutputBuffer {
  private buffer = Buffer.alloc(0);
  private oldest = 0;
  private next = 0;

  constructor(private readonly maxBytes: number) {}

  get oldestCursor(): number {
    return this.oldest;
  }

  get nextCursor(): number {
    return this.next;
  }

  append(data: string): void {
    if (!data) return;
    const appended = Buffer.from(data, "utf8");
    this.buffer = this.buffer.length === 0 ? appended : Buffer.concat([this.buffer, appended]);
    this.next += appended.length;
    if (this.buffer.length <= this.maxBytes) return;

    let start = this.buffer.length - this.maxBytes;
    while (start < this.buffer.length && isUtf8ContinuationByte(this.buffer[start])) {
      start += 1;
    }
    this.oldest += start;
    this.buffer = this.buffer.subarray(start);
  }

  read(input: { cursor?: number; maxBytes?: number }): {
    output: string;
    startCursor: number;
    nextCursor: number;
    hasMore: boolean;
    cursorExpired: boolean;
    cursorAdjusted: boolean;
  } {
    const requestedCursor = input.cursor ?? this.oldest;
    if (!Number.isSafeInteger(requestedCursor) || requestedCursor < 0) {
      throw new Error("Command job cursor must be a non-negative safe integer.");
    }
    if (requestedCursor > this.next) {
      throw new Error("Command job cursor is ahead of available output.");
    }
    const maxBytes = normalizePositiveInteger(input.maxBytes, DEFAULT_COMMAND_JOB_READ_BYTES);
    const cursorExpired = requestedCursor < this.oldest;
    let start = cursorExpired ? 0 : requestedCursor - this.oldest;
    while (start < this.buffer.length && isUtf8ContinuationByte(this.buffer[start])) {
      start += 1;
    }
    const cursorAdjusted = start !== (cursorExpired ? 0 : requestedCursor - this.oldest);
    let end = Math.min(this.buffer.length, start + maxBytes);
    while (end > start && end < this.buffer.length && isUtf8ContinuationByte(this.buffer[end])) {
      end -= 1;
    }
    // A caller may request fewer bytes than one Unicode code point. Return that code point
    // intact so the cursor always advances instead of repeatedly returning an empty page.
    if (end === start && start < this.buffer.length) {
      end = start + 1;
      while (end < this.buffer.length && isUtf8ContinuationByte(this.buffer[end])) {
        end += 1;
      }
    }
    const startCursor = this.oldest + start;
    const nextCursor = this.oldest + end;
    return {
      output: this.buffer.subarray(start, end).toString("utf8"),
      startCursor,
      nextCursor,
      hasMore: nextCursor < this.next,
      cursorExpired,
      cursorAdjusted,
    };
  }
}

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80;
}

export type CommandJobManagerOptions = {
  maxActiveJobs?: number;
  terminalHistorySize?: number;
  maxOutputBytes?: number;
  store?: CommandJobStateStore;
  recoverLostJob?: (job: PersistedCommandJob) => Promise<void>;
  now?: () => number;
};

/**
 * Authoritative in-process owner for a sandbox command job. It owns stdin, terminal
 * output cursors, process-tree cancellation, terminal cleanup, and restart recovery.
 */
export class CommandJobManager {
  private readonly jobs = new Map<string, CommandJob>();
  private readonly maxActiveJobs: number;
  private readonly terminalHistorySize: number;
  private readonly maxOutputBytes: number;
  private readonly now: () => number;
  private initialization?: Promise<void>;

  constructor(private readonly options: CommandJobManagerOptions = {}) {
    this.maxActiveJobs = normalizePositiveInteger(options.maxActiveJobs, DEFAULT_COMMAND_JOB_MAX_ACTIVE);
    this.terminalHistorySize = normalizePositiveInteger(
      options.terminalHistorySize,
      DEFAULT_COMMAND_JOB_TERMINAL_HISTORY_SIZE,
    );
    this.maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_COMMAND_JOB_MAX_OUTPUT_BYTES);
    this.now = options.now ?? (() => Date.now());
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeInternal();
    }
    await this.initialization;
  }

  async start(input: CommandJobStartInput): Promise<CommandJobSnapshot> {
    await this.initialize();
    if (!input.process && !input.startProcess) {
      throw new Error("Command job start requires a process or startProcess factory.");
    }
    if (input.process && input.startProcess) {
      throw new Error("Command job start cannot receive both a process and startProcess factory.");
    }
    const jobId = input.jobId ?? randomUUID();
    assertCommandJobId(jobId);
    if (this.jobs.has(jobId)) {
      throw new Error(`Command job ${jobId} already exists.`);
    }
    if (this.activeJobCount() >= this.maxActiveJobs) {
      throw new Error(`Command job limit reached (${this.maxActiveJobs}). Cancel or wait for an active job before starting another.`);
    }

    const now = this.now();
    const timeoutMs = normalizePositiveInteger(input.timeoutMs, DEFAULT_COMMAND_JOB_TIMEOUT_MS);
    const job: CommandJob = {
      jobId,
      status: "starting",
      stdinMode: input.stdinMode,
      createdAt: now,
      updatedAt: now,
      supportsResize: input.stdinMode === "pty",
      timeoutMs,
      deadlineAt: now + timeoutMs,
      startup: createStartupGate(),
      output: new CommandJobOutputBuffer(this.maxOutputBytes),
      cleanup: input.cleanup,
      persistedSandbox: input.persistedSandbox,
    };
    this.jobs.set(jobId, job);
    try {
      await this.persist(job);
    } catch (error) {
      this.jobs.delete(jobId);
      throw error;
    }

    try {
      const process = input.process ?? await this.startProcessWithinDeadline(input.startProcess!, timeoutMs);
      job.process = process;
      job.pid = process.pid;
      job.supportsResize = process.supportsResize;
      job.status = "running";
      job.updatedAt = this.now();
      await this.persist(job);
      process.onData((data) => {
        if (job.status !== "running") return;
        job.output.append(data);
        job.updatedAt = this.now();
      });
      process.onExit((event) => {
        if (job.cancellation) return;
        const status: CommandJobStatus = event.error || (event.exitCode ?? 0) !== 0 ? "failed" : "completed";
        void this.finalize(job, {
          status,
          ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
          ...(event.signal !== undefined ? { signal: event.signal } : {}),
          ...(event.error ? { error: event.error } : {}),
        });
      });
      if (job.status === "running") {
        job.timeoutTimer = setTimeout(() => {
          void this.timeout(job);
        }, timeoutMs);
        job.timeoutTimer.unref?.();
      }
      job.startup?.resolve();
      if (job.cancellation) return await job.cancellation;
      if (job.finalization) return await job.finalization;
      return this.snapshot(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command job failed to start.";
      if (job.process) {
        try {
          job.termination = await job.process.terminate();
        } catch {
          // Cleanup remains mandatory even if the runtime process has already disappeared.
        }
      }
      const terminal = await this.finalize(job, {
        status: "failed",
        error: `Command job start failed: ${message}`,
      });
      job.startup?.resolve();
      return terminal;
    }
  }

  get(jobId: string): CommandJobSnapshot {
    return this.snapshot(this.requireJob(jobId));
  }

  list(): CommandJobSnapshot[] {
    return Array.from(this.jobs.values(), (job) => this.snapshot(job))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  read(jobId: string, input: { cursor?: number; maxBytes?: number } = {}): CommandJobReadResult {
    const job = this.requireJob(jobId);
    return {
      ...this.snapshot(job),
      ...job.output.read(input),
    };
  }

  write(jobId: string, data: string): CommandJobSnapshot {
    const job = this.requireActiveJob(jobId);
    if (typeof data !== "string") {
      throw new Error("Command job stdin data must be a string.");
    }
    job.process!.write(data);
    job.updatedAt = this.now();
    return this.snapshot(job);
  }

  resize(jobId: string, cols: number, rows: number): CommandJobSnapshot {
    const job = this.requireActiveJob(jobId);
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols <= 0 || rows <= 0) {
      throw new Error("Command job resize dimensions must be positive integers.");
    }
    if (!job.supportsResize) {
      throw new Error(`Command job ${jobId} does not have a PTY and cannot be resized.`);
    }
    job.process!.resize(cols, rows);
    job.updatedAt = this.now();
    return this.snapshot(job);
  }

  async cancel(jobId: string): Promise<CommandJobSnapshot> {
    const job = this.requireJob(jobId);
    if (isTerminalStatus(job.status)) return this.snapshot(job);
    if (job.cancellation) return await job.cancellation;
    job.cancellation = this.terminate(job, "cancelled");
    return await job.cancellation;
  }

  async shutdown(): Promise<number> {
    await this.initialize();
    const active = Array.from(this.jobs.values())
      .filter((job) => job.status === "running" || job.status === "starting")
      .map((job) => job.jobId);
    await Promise.all(active.map((jobId) => this.cancel(jobId).catch(() => undefined)));
    return active.length;
  }

  /**
   * A runtime factory may await an asynchronous PTY or OCI launch result. Keep the
   * declared job timeout authoritative from the persisted `starting` state onward.
   * A process that appears after the deadline is still terminated so it cannot escape
   * the job owner after its lease has been finalized.
   */
  private async startProcessWithinDeadline(
    startProcess: () => Promise<CommandJobProcess>,
    timeoutMs: number,
  ): Promise<CommandJobProcess> {
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    return await new Promise<CommandJobProcess>((resolve, reject) => {
      const clearDeadline = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
      };
      timeout = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Command job startup timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      void Promise.resolve()
        .then(startProcess)
        .then(
          (process) => {
            if (timedOut) {
              void process.terminate().catch(() => {});
              return;
            }
            clearDeadline();
            resolve(process);
          },
          (error) => {
            if (timedOut) return;
            clearDeadline();
            reject(error);
          },
        );
    });
  }

  private async initializeInternal(): Promise<void> {
    if (!this.options.store) return;
    const persisted = await this.options.store.list();
    for (const record of persisted) {
      if (this.jobs.has(record.jobId)) continue;
      if (record.status === "starting" || record.status === "running") {
        let recoveryError: string | undefined;
        try {
          await this.options.recoverLostJob?.(record);
        } catch {
          recoveryError = "Recovered command job cleanup failed; inspect its sandbox lease before another command is run.";
        }
        const lost: CommandJob = {
          jobId: record.jobId,
          status: "lost",
          stdinMode: record.stdinMode,
          createdAt: record.createdAt,
          updatedAt: this.now(),
          endedAt: this.now(),
          pid: record.pid,
          supportsResize: record.supportsResize,
          timeoutMs: record.timeoutMs,
          deadlineAt: record.deadlineAt,
          output: new CommandJobOutputBuffer(this.maxOutputBytes),
          persistedSandbox: record.persistedSandbox,
          error: recoveryError ?? "Gateway restarted before the command job reached a terminal state; live output and stdin are unavailable.",
        };
        this.jobs.set(lost.jobId, lost);
        await this.persist(lost);
        continue;
      }
      this.jobs.set(record.jobId, {
        jobId: record.jobId,
        status: record.status,
        stdinMode: record.stdinMode,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
        ...(record.pid !== undefined ? { pid: record.pid } : {}),
        supportsResize: record.supportsResize,
        ...(record.timeoutMs !== undefined ? { timeoutMs: record.timeoutMs } : {}),
        ...(record.deadlineAt !== undefined ? { deadlineAt: record.deadlineAt } : {}),
        output: new CommandJobOutputBuffer(this.maxOutputBytes),
        ...(record.error ? { error: record.error } : {}),
        ...(record.persistedSandbox ? { persistedSandbox: record.persistedSandbox } : {}),
      });
    }
    await this.trimTerminalHistory();
  }

  private async finalize(job: CommandJob, outcome: {
    status: Exclude<CommandJobStatus, "running" | "lost">;
    exitCode?: number;
    signal?: string | number;
    error?: string;
  }): Promise<CommandJobSnapshot> {
    if (job.finalization) return await job.finalization;
    job.finalization = (async () => {
      if (job.timeoutTimer) {
        clearTimeout(job.timeoutTimer);
        job.timeoutTimer = undefined;
      }
      job.status = outcome.status;
      job.updatedAt = this.now();
      job.endedAt = job.updatedAt;
      if (outcome.exitCode !== undefined) job.exitCode = outcome.exitCode;
      if (outcome.signal !== undefined) job.signal = outcome.signal;
      if (outcome.error) job.error = outcome.error;
      try {
        job.cleanupResult = await job.cleanup?.();
      } catch (error) {
        if (error instanceof CommandJobCleanupError) {
          job.cleanupResult = error.metadata;
        }
        job.status = "failed";
        job.error = "Command job sandbox cleanup failed; investigate the reported lease before another command is run.";
      }
      await this.persist(job);
      await this.trimTerminalHistory();
      return this.snapshot(job);
    })();
    return await job.finalization;
  }

  private async timeout(job: CommandJob): Promise<void> {
    if (isTerminalStatus(job.status) || job.cancellation) return;
    job.cancellation = this.terminate(job, "timeout");
    await job.cancellation.catch(() => undefined);
  }

  private async terminate(job: CommandJob, intent: "cancelled" | "timeout"): Promise<CommandJobSnapshot> {
    if (job.status === "starting") {
      await job.startup?.ready;
    }
    if (isTerminalStatus(job.status)) return this.snapshot(job);
    if (!job.process) {
      return await this.finalize(job, {
        status: "failed",
        error: "Command job has no running process to cancel.",
      });
    }
    let termination: ProcessTerminationResult | undefined;
    try {
      termination = await job.process.terminate();
    } catch {
      return await this.finalize(job, {
        status: "failed",
        error: "Command job process-tree termination failed.",
      });
    }
    job.termination = termination;
    const timedOut = intent === "timeout";
    return await this.finalize(job, {
      status: !timedOut && termination.closeObserved ? "cancelled" : "failed",
      error: timedOut
        ? `Command job timed out after ${job.timeoutMs ?? DEFAULT_COMMAND_JOB_TIMEOUT_MS}ms.`
        : termination.closeObserved ? undefined : "Command job process tree did not close after cancellation.",
    });
  }

  private requireJob(jobId: string): CommandJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Command job ${jobId} was not found.`);
    return job;
  }

  private requireActiveJob(jobId: string): CommandJob {
    const job = this.requireJob(jobId);
    if (job.status !== "running" || !job.process) {
      throw new Error(`Command job ${jobId} is not running.`);
    }
    return job;
  }

  private activeJobCount(): number {
    return Array.from(this.jobs.values()).filter((job) => job.status === "running" || job.status === "starting").length;
  }

  private snapshot(job: CommandJob): CommandJobSnapshot {
    return {
      jobId: job.jobId,
      status: job.status === "starting" ? "running" : job.status,
      stdinMode: job.stdinMode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.endedAt !== undefined ? { endedAt: job.endedAt } : {}),
      ...(job.pid !== undefined ? { pid: job.pid } : {}),
      supportsResize: job.supportsResize,
      ...(job.timeoutMs !== undefined ? { timeoutMs: job.timeoutMs } : {}),
      ...(job.deadlineAt !== undefined ? { deadlineAt: job.deadlineAt } : {}),
      oldestCursor: job.output.oldestCursor,
      nextCursor: job.output.nextCursor,
      ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
      ...(job.signal !== undefined ? { signal: job.signal } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.termination ? {
        processTerminationMethod: job.termination.method,
        processHardKillUsed: job.termination.hardKillUsed,
        processCloseObserved: job.termination.closeObserved,
      } : {}),
      ...(job.cleanupResult ? { cleanup: job.cleanupResult } : {}),
    };
  }

  private async persist(job: CommandJob): Promise<void> {
    if (!this.options.store) return;
    await this.options.store.save({
      version: 1,
      jobId: job.jobId,
      status: job.status,
      stdinMode: job.stdinMode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.endedAt !== undefined ? { endedAt: job.endedAt } : {}),
      ...(job.pid !== undefined ? { pid: job.pid } : {}),
      supportsResize: job.supportsResize,
      ...(job.timeoutMs !== undefined ? { timeoutMs: job.timeoutMs } : {}),
      ...(job.deadlineAt !== undefined ? { deadlineAt: job.deadlineAt } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.persistedSandbox ? { persistedSandbox: job.persistedSandbox } : {}),
    });
  }

  private async trimTerminalHistory(): Promise<void> {
    const terminal = Array.from(this.jobs.values())
      .filter((job) => isTerminalStatus(job.status))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    for (const job of terminal.slice(this.terminalHistorySize)) {
      this.jobs.delete(job.jobId);
      await this.options.store?.remove(job.jobId);
    }
  }
}
