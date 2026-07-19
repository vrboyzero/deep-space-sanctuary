import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PtyManager } from "../system/pty.js";
import { BRIDGE_ARTIFACTS_DIR } from "./types.js";
import { persistBridgeSessionArtifacts } from "./artifacts.js";
import type { BridgeSessionRecord, BridgeSessionTranscriptEvent } from "./types.js";

const MAX_TRANSCRIPT_EVENT_CHARS = 16_000;
const MAX_TRANSCRIPT_EVENTS = 400;

type PersistSessionStateOptions = {
  includeRegistry?: boolean;
  includeTranscript?: boolean;
};

function stripUtf8Bom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function normalizeTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function clampTranscriptContent(content: string): { content: string; truncated: boolean; bytes: number } {
  const buffer = Buffer.from(content, "utf-8");
  if (content.length <= MAX_TRANSCRIPT_EVENT_CHARS && buffer.length <= MAX_TRANSCRIPT_EVENT_CHARS * 4) {
    return {
      content,
      truncated: false,
      bytes: buffer.length,
    };
  }
  const truncatedContent = content.slice(0, MAX_TRANSCRIPT_EVENT_CHARS);
  return {
    content: truncatedContent,
    truncated: true,
    bytes: buffer.length,
  };
}

export class BridgeSessionStore {
  private static instance?: BridgeSessionStore;
  private records = new Map<string, BridgeSessionRecord>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private closePromises = new Map<string, Promise<BridgeSessionRecord>>();
  private transcripts = new Map<string, BridgeSessionTranscriptEvent[]>();
  private loadedWorkspaceRoot?: string;
  private loadPromise?: Promise<void>;

  static getInstance(): BridgeSessionStore {
    if (!BridgeSessionStore.instance) {
      BridgeSessionStore.instance = new BridgeSessionStore();
    }
    return BridgeSessionStore.instance;
  }

  static resetInstanceForTests(): void {
    BridgeSessionStore.instance?.clear();
    BridgeSessionStore.instance = undefined;
  }

  async ensureLoaded(workspaceRoot: string): Promise<void> {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    if (this.loadedWorkspaceRoot === resolvedWorkspaceRoot && !this.loadPromise) {
      return;
    }
    if (this.loadedWorkspaceRoot !== resolvedWorkspaceRoot) {
      this.clear();
      this.loadedWorkspaceRoot = resolvedWorkspaceRoot;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk(resolvedWorkspaceRoot)
        .finally(() => {
          this.loadPromise = undefined;
        });
    }
    await this.loadPromise;
  }

  create(input: Omit<BridgeSessionRecord, "id" | "createdAt" | "updatedAt" | "status">): BridgeSessionRecord {
    const now = Date.now();
    const record: BridgeSessionRecord = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "active",
      ...(input.idleTimeoutMs ? { idleDeadlineAt: now + input.idleTimeoutMs } : {}),
      ...input,
    };
    this.records.set(record.id, record);
    this.transcripts.set(record.id, []);
    this.appendTranscript(record.id, "system", `Session started: ${record.commandPreview}`);
    this.scheduleIdleCleanup(record);
    return record;
  }

  get(sessionId: string): BridgeSessionRecord | undefined {
    return this.records.get(sessionId);
  }

  list(): BridgeSessionRecord[] {
    return Array.from(this.records.values())
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  appendTranscript(sessionId: string, direction: BridgeSessionTranscriptEvent["direction"], content: string): void {
    const record = this.records.get(sessionId);
    if (!record) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    const normalized = typeof content === "string" ? content : String(content ?? "");
    if (!normalized) return;
    const events = this.transcripts.get(sessionId) ?? [];
    const clamped = clampTranscriptContent(normalized);
    events.push({
      timestamp: Date.now(),
      direction,
      content: clamped.content,
      bytes: clamped.bytes,
      truncated: clamped.truncated,
    });
    if (events.length > MAX_TRANSCRIPT_EVENTS) {
      events.splice(0, events.length - MAX_TRANSCRIPT_EVENTS);
    }
    this.transcripts.set(sessionId, events);
  }

  getTranscript(sessionId: string): BridgeSessionTranscriptEvent[] {
    return [...(this.transcripts.get(sessionId) ?? [])];
  }

  async persistSessionState(sessionId: string, options: PersistSessionStateOptions = {}): Promise<void> {
    const record = this.records.get(sessionId);
    if (!record) {
      return;
    }
    const includeRegistry = options.includeRegistry !== false;
    const includeTranscript = options.includeTranscript !== false;
    if (!includeRegistry && !includeTranscript) {
      return;
    }
    if (includeTranscript) {
      await this.writeTranscriptSnapshot(record);
    }
    if (includeRegistry) {
      await this.writeRegistry();
    }
  }

  touch(
    sessionId: string,
    patch?: Partial<Pick<BridgeSessionRecord, "cols" | "rows" | "updatedAt" | "firstTurnWriteObservedAt">>,
  ): BridgeSessionRecord {
    const current = this.records.get(sessionId);
    if (!current) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    const now = patch?.updatedAt ?? Date.now();
    const next: BridgeSessionRecord = {
      ...current,
      ...patch,
      updatedAt: now,
      ...(current.idleTimeoutMs ? { idleDeadlineAt: now + current.idleTimeoutMs } : {}),
    };
    this.records.set(sessionId, next);
    this.scheduleIdleCleanup(next);
    return next;
  }

  async close(
    sessionId: string,
    reason: BridgeSessionRecord["closeReason"] = "manual",
  ): Promise<BridgeSessionRecord> {
    const existing = this.closePromises.get(sessionId);
    if (existing) {
      return existing;
    }
    let tracked: Promise<BridgeSessionRecord>;
    const closing = this.closeInternal(sessionId, reason);
    tracked = closing.finally(() => {
      if (this.closePromises.get(sessionId) === tracked) {
        this.closePromises.delete(sessionId);
      }
    });
    this.closePromises.set(sessionId, tracked);
    return tracked;
  }

  private async closeInternal(
    sessionId: string,
    reason: BridgeSessionRecord["closeReason"],
  ): Promise<BridgeSessionRecord> {
    const current = this.records.get(sessionId);
    if (!current) {
      throw new Error(`Bridge session 不存在: ${sessionId}`);
    }
    if (current.status === "closed") {
      this.clearIdleTimer(sessionId);
      return current;
    }
    this.appendTranscript(sessionId, "system", `Session closed: ${reason ?? "manual"}`);
    const now = Date.now();
    const next: BridgeSessionRecord = {
      ...current,
      status: "closed",
      closedAt: now,
      updatedAt: now,
      idleDeadlineAt: undefined,
      closeReason: reason,
    };
    this.clearIdleTimer(sessionId);
    const transcript = this.getTranscript(sessionId);
    const artifacts = await persistBridgeSessionArtifacts(next, transcript);
    const finalized: BridgeSessionRecord = {
      ...next,
      artifactPath: artifacts.artifactPath,
      transcriptPath: artifacts.transcriptPath,
    };
    // closed 对外可见时必须同时具备 durable artifact 引用，避免观察到半提交 terminal record。
    this.records.set(sessionId, finalized);
    await this.persistSessionState(sessionId);
    return finalized;
  }

  clear(): void {
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.closePromises.clear();
    this.records.clear();
    this.transcripts.clear();
    this.loadedWorkspaceRoot = undefined;
    this.loadPromise = undefined;
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  private scheduleIdleCleanup(record: BridgeSessionRecord): void {
    this.clearIdleTimer(record.id);
    if (record.status !== "active" || !record.idleTimeoutMs || record.idleTimeoutMs <= 0) {
      return;
    }
    const timer = setTimeout(async () => {
      const current = this.records.get(record.id);
      if (!current || current.status !== "active") {
        return;
      }
      try {
        PtyManager.getInstance().kill(current.runtimeSessionId, "idle-timeout");
      } catch {
        // ignore cleanup race
      }
      try {
        await this.close(current.id, "idle-timeout");
      } catch {
        this.clearIdleTimer(current.id);
      }
    }, record.idleTimeoutMs);
    this.idleTimers.set(record.id, timer);
  }

  private async loadFromDisk(workspaceRoot: string): Promise<void> {
    const registryPath = this.resolveRegistryPath(workspaceRoot);
    const raw = await fs.readFile(registryPath, "utf-8").catch((error: NodeJS.ErrnoException | Error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!raw) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripUtf8Bom(raw));
    } catch {
      return;
    }

    const records = Array.isArray((parsed as { records?: unknown })?.records)
      ? (parsed as { records: BridgeSessionRecord[] }).records
      : [];

    for (const record of records) {
      const normalized: BridgeSessionRecord = {
        ...record,
        workspaceRoot,
      };
      this.records.set(normalized.id, normalized);
      const liveTranscript = await this.readTranscriptSnapshot(normalized);
      this.transcripts.set(normalized.id, liveTranscript);
      if (normalized.status === "active") {
        try {
          PtyManager.getInstance().kill(normalized.runtimeSessionId);
        } catch {
          // ignore stale runtime session ids
        }
        await this.close(normalized.id, normalizeTaskId(normalized.taskId) ? "runtime-lost" : "orphan");
      }
    }
  }

  private async writeRegistry(): Promise<void> {
    const workspaceRoot = this.loadedWorkspaceRoot;
    if (!workspaceRoot) return;
    const registryPath = this.resolveRegistryPath(workspaceRoot);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    const records = this.list().map((record) => ({
      ...record,
      workspaceRoot,
    }));
    await fs.writeFile(registryPath, JSON.stringify({ records }, null, 2), "utf-8");
  }

  private resolveRegistryPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, BRIDGE_ARTIFACTS_DIR, "sessions", "registry.json");
  }

  private resolveTranscriptSnapshotPath(record: Pick<BridgeSessionRecord, "workspaceRoot" | "id">): string {
    return path.join(record.workspaceRoot, BRIDGE_ARTIFACTS_DIR, "sessions", record.id, "transcript.live.json");
  }

  private async writeTranscriptSnapshot(record: BridgeSessionRecord): Promise<void> {
    const transcriptPath = this.resolveTranscriptSnapshotPath(record);
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(transcriptPath, JSON.stringify({ events: this.getTranscript(record.id) }, null, 2), "utf-8");
  }

  private async readTranscriptSnapshot(record: BridgeSessionRecord): Promise<BridgeSessionTranscriptEvent[]> {
    const transcriptPath = this.resolveTranscriptSnapshotPath(record);
    const raw = await fs.readFile(transcriptPath, "utf-8").catch((error: NodeJS.ErrnoException | Error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(stripUtf8Bom(raw)) as { events?: BridgeSessionTranscriptEvent[] };
      return Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      return [];
    }
  }
}

export async function shutdownBridgeSessions(): Promise<{
  runtimeSessionsClosed: number;
  bridgeSessionsClosed: number;
}> {
  const manager = PtyManager.getInstance();
  const store = BridgeSessionStore.getInstance();
  const activeRecords = store.list().filter((record) => record.status === "active");
  const runtimeSessionsClosed = manager.shutdownAll();
  for (const record of activeRecords) {
    await store.close(record.id, "manual");
  }
  return {
    runtimeSessionsClosed,
    bridgeSessionsClosed: activeRecords.length,
  };
}

export async function loadRuntimeLostBridgeSessions(
  workspaceRoot: string,
): Promise<BridgeSessionRecord[]> {
  const store = BridgeSessionStore.getInstance();
  await store.ensureLoaded(workspaceRoot);
  return store.list().filter((record) => record.closeReason === "runtime-lost");
}

export async function loadRecoveredBridgeSessions(
  workspaceRoot: string,
): Promise<BridgeSessionRecord[]> {
  const store = BridgeSessionStore.getInstance();
  await store.ensureLoaded(workspaceRoot);
  return store.list().filter((record) => record.closeReason === "runtime-lost" || record.closeReason === "orphan");
}
