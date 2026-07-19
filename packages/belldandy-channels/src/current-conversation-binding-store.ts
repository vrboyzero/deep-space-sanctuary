import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ChannelKind, ChatKind } from "./router/types.js";

export type CurrentConversationBindingRecord = {
  channel: ChannelKind;
  sessionKey: string;
  sessionScope: string;
  legacyConversationId: string;
  chatKind: ChatKind;
  chatId: string;
  accountId?: string;
  peerId?: string;
  updatedAt: number;
  target: Record<string, string>;
};

type CurrentConversationBindingSnapshot = {
  version: 1;
  bindings: Record<string, CurrentConversationBindingRecord>;
  latestByScope: Record<string, string>;
};

const DEFAULT_CURRENT_CONVERSATION_BINDING_MAX_ENTRIES = 4_096;
const DEFAULT_CURRENT_CONVERSATION_BINDING_RETENTION_MS = 30 * 24 * 60 * 60_000;

export type CurrentConversationBindingStore = {
  upsert(record: CurrentConversationBindingRecord): Promise<void>;
  get(sessionKey: string): Promise<CurrentConversationBindingRecord | undefined>;
  getLatestByChannel(input: {
    channel: ChannelKind;
    accountId?: string;
  }): Promise<CurrentConversationBindingRecord | undefined>;
};

export type CurrentConversationBindingStoreFileSystem = Pick<
  typeof fs,
  "readFile" | "mkdir" | "writeFile" | "rename" | "rm"
>;

export type CurrentConversationBindingStoreOptions = {
  /** 仅用于可重复的存储故障验证；生产默认使用 node:fs/promises。 */
  fileSystem?: CurrentConversationBindingStoreFileSystem;
  /** 非 latest binding 的最长保留时间；channel/account 的 latest binding 不会因 TTL 被删除。 */
  retentionMs?: number;
  /** 软容量上限；所有 channel/account latest binding 仍优先保留。 */
  maxEntries?: number;
  /** 仅用于可重复的 retention 验证；生产默认使用 Date.now。 */
  now?: () => number;
};

function createEmptySnapshot(): CurrentConversationBindingSnapshot {
  return {
    version: 1,
    bindings: {},
    latestByScope: {},
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeTarget(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const target: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const normalized = normalizeString(typeof rawValue === "string" ? rawValue : undefined);
    if (!normalized) continue;
    target[key] = normalized;
  }
  return target;
}

function normalizeRecord(value: unknown): CurrentConversationBindingRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const channel = normalizeString(source.channel) as ChannelKind | undefined;
  const sessionKey = normalizeString(source.sessionKey);
  const sessionScope = normalizeString(source.sessionScope);
  const legacyConversationId = normalizeString(source.legacyConversationId);
  const chatKind = normalizeString(source.chatKind) as ChatKind | undefined;
  const chatId = normalizeString(source.chatId);
  if (!channel || !sessionKey || !sessionScope || !legacyConversationId || !chatKind || !chatId) {
    return undefined;
  }
  const updatedAtRaw = Number(source.updatedAt);
  return {
    channel,
    sessionKey,
    sessionScope,
    legacyConversationId,
    chatKind,
    chatId,
    ...(normalizeString(source.accountId) ? { accountId: normalizeString(source.accountId) } : {}),
    ...(normalizeString(source.peerId) ? { peerId: normalizeString(source.peerId) } : {}),
    updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now(),
    target: normalizeTarget(source.target),
  };
}

function normalizeSnapshot(value: unknown): CurrentConversationBindingSnapshot {
  if (!value || typeof value !== "object") return createEmptySnapshot();
  const source = value as Record<string, unknown>;
  const bindingsSource = source.bindings && typeof source.bindings === "object"
    ? source.bindings as Record<string, unknown>
    : {};
  const latestByScopeSource = source.latestByScope && typeof source.latestByScope === "object"
    ? source.latestByScope as Record<string, unknown>
    : {};

  const bindings: Record<string, CurrentConversationBindingRecord> = {};
  for (const [key, rawValue] of Object.entries(bindingsSource)) {
    const record = normalizeRecord(rawValue);
    if (!record) continue;
    bindings[key] = record;
  }

  const latestByScope: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(latestByScopeSource)) {
    const normalizedKey = normalizeString(key);
    const normalizedValue = normalizeString(typeof rawValue === "string" ? rawValue : undefined);
    if (!normalizedKey || !normalizedValue || !bindings[normalizedValue]) continue;
    latestByScope[normalizedKey] = normalizedValue;
  }

  return {
    version: 1,
    bindings,
    latestByScope,
  };
}

function buildScopeKey(channel: ChannelKind, accountId?: string): string {
  const normalizedAccountId = normalizeString(accountId);
  return normalizedAccountId ? `${channel}::${normalizedAccountId}` : channel;
}

export function resolveCurrentConversationBindingStorePath(stateDir: string): string {
  return path.join(stateDir, "current-conversation-bindings.json");
}

function cloneRecord(record: CurrentConversationBindingRecord | undefined): CurrentConversationBindingRecord | undefined {
  if (!record) return undefined;
  return {
    ...record,
    target: { ...record.target },
  };
}

function cloneSnapshot(snapshot: CurrentConversationBindingSnapshot): CurrentConversationBindingSnapshot {
  const bindings: Record<string, CurrentConversationBindingRecord> = {};
  for (const [sessionKey, record] of Object.entries(snapshot.bindings)) {
    const cloned = cloneRecord(record);
    if (cloned) {
      bindings[sessionKey] = cloned;
    }
  }
  return {
    version: 1,
    bindings,
    latestByScope: { ...snapshot.latestByScope },
  };
}

function normalizeUpsertRecord(record: CurrentConversationBindingRecord): CurrentConversationBindingRecord {
  return {
    ...record,
    target: normalizeTarget(record.target),
    updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) && record.updatedAt > 0
      ? record.updatedAt
      : Date.now(),
  };
}

function applyUpsert(snapshot: CurrentConversationBindingSnapshot, record: CurrentConversationBindingRecord): void {
  for (const [scopeKey, sessionKey] of Object.entries(snapshot.latestByScope)) {
    if (sessionKey === record.sessionKey) {
      delete snapshot.latestByScope[scopeKey];
    }
  }
  snapshot.bindings[record.sessionKey] = record;
  snapshot.latestByScope[buildScopeKey(record.channel)] = record.sessionKey;
  if (record.accountId) {
    snapshot.latestByScope[buildScopeKey(record.channel, record.accountId)] = record.sessionKey;
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function collectPinnedSessionKeys(snapshot: CurrentConversationBindingSnapshot): Set<string> {
  const pinned = new Set<string>();
  for (const sessionKey of Object.values(snapshot.latestByScope)) {
    if (snapshot.bindings[sessionKey]) {
      pinned.add(sessionKey);
    }
  }
  return pinned;
}

function removeBinding(snapshot: CurrentConversationBindingSnapshot, sessionKey: string): void {
  delete snapshot.bindings[sessionKey];
  for (const [scopeKey, latestSessionKey] of Object.entries(snapshot.latestByScope)) {
    if (latestSessionKey === sessionKey) {
      delete snapshot.latestByScope[scopeKey];
    }
  }
}

function pruneSnapshot(input: {
  snapshot: CurrentConversationBindingSnapshot;
  now: number;
  retentionMs: number;
  maxEntries: number;
}): void {
  const { snapshot, now, retentionMs, maxEntries } = input;

  for (const [scopeKey, sessionKey] of Object.entries(snapshot.latestByScope)) {
    if (!snapshot.bindings[sessionKey]) {
      delete snapshot.latestByScope[scopeKey];
    }
  }

  // latestByScope 是按 channel/account fallback 的公开语义，TTL 和容量裁剪都不能删除它指向的 binding。
  let pinnedSessionKeys = collectPinnedSessionKeys(snapshot);
  for (const [sessionKey, record] of Object.entries(snapshot.bindings)) {
    if (!pinnedSessionKeys.has(sessionKey) && record.updatedAt <= now - retentionMs) {
      removeBinding(snapshot, sessionKey);
    }
  }

  pinnedSessionKeys = collectPinnedSessionKeys(snapshot);
  const evictionCandidates = Object.entries(snapshot.bindings)
    .filter(([sessionKey]) => !pinnedSessionKeys.has(sessionKey))
    .sort(([leftSessionKey, left], [rightSessionKey, right]) => {
      if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
      return leftSessionKey.localeCompare(rightSessionKey);
    });
  let bindingCount = Object.keys(snapshot.bindings).length;
  for (const [sessionKey] of evictionCandidates) {
    if (bindingCount <= maxEntries) break;
    removeBinding(snapshot, sessionKey);
    bindingCount -= 1;
  }
}

function isAvailableBinding(input: {
  snapshot: CurrentConversationBindingSnapshot;
  sessionKey: string;
  now: number;
  retentionMs: number;
}): boolean {
  const record = input.snapshot.bindings[input.sessionKey];
  if (!record) return false;
  if (record.updatedAt > input.now - input.retentionMs) return true;
  return collectPinnedSessionKeys(input.snapshot).has(input.sessionKey);
}

export function createFileCurrentConversationBindingStore(
  filePath: string,
  options: CurrentConversationBindingStoreOptions = {},
): CurrentConversationBindingStore {
  const fileSystem = options.fileSystem ?? fs;
  const retentionMs = normalizePositiveInteger(
    options.retentionMs,
    DEFAULT_CURRENT_CONVERSATION_BINDING_RETENTION_MS,
  );
  const maxEntries = normalizePositiveInteger(
    options.maxEntries,
    DEFAULT_CURRENT_CONVERSATION_BINDING_MAX_ENTRIES,
  );
  const getNow = options.now ?? Date.now;
  let snapshot: CurrentConversationBindingSnapshot | undefined;
  let loadPromise: Promise<CurrentConversationBindingSnapshot> | undefined;
  const pendingUpserts: Array<{
    record: CurrentConversationBindingRecord;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  let upsertDrainScheduled = false;

  async function ensureLoaded(): Promise<CurrentConversationBindingSnapshot> {
    if (snapshot) return snapshot;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const content = await fileSystem.readFile(filePath, "utf-8");
          return normalizeSnapshot(JSON.parse(content));
        } catch {
          return createEmptySnapshot();
        }
      })();
    }
    snapshot = await loadPromise;
    pruneSnapshot({ snapshot, now: getNow(), retentionMs, maxEntries });
    return snapshot;
  }

  async function persist(nextSnapshot: CurrentConversationBindingSnapshot): Promise<void> {
    const directory = path.dirname(filePath);
    const stagingPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
    await fileSystem.mkdir(directory, { recursive: true });
    try {
      await fileSystem.writeFile(stagingPath, `${JSON.stringify(nextSnapshot, null, 2)}\n`, "utf-8");
      await fileSystem.rename(stagingPath, filePath);
    } catch (error) {
      await fileSystem.rm(stagingPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function publishUpsertBatch(entries: typeof pendingUpserts): Promise<void> {
    const loaded = await ensureLoaded();
    const nextSnapshot = cloneSnapshot(loaded);
    pruneSnapshot({ snapshot: nextSnapshot, now: getNow(), retentionMs, maxEntries });
    for (const entry of entries) {
      applyUpsert(nextSnapshot, entry.record);
    }
    pruneSnapshot({ snapshot: nextSnapshot, now: getNow(), retentionMs, maxEntries });
    await persist(nextSnapshot);
    // 一个批次中的所有 binding 只有在同一份 staging snapshot 成功发布后才对读取端可见。
    snapshot = nextSnapshot;
  }

  async function drainPendingUpserts(): Promise<void> {
    try {
      while (pendingUpserts.length > 0) {
        const entries = pendingUpserts.splice(0);
        try {
          await publishUpsertBatch(entries);
          for (const entry of entries) entry.resolve();
        } catch (error) {
          for (const entry of entries) entry.reject(error);
        }
      }
    } finally {
      upsertDrainScheduled = false;
      if (pendingUpserts.length > 0) {
        schedulePendingUpsertDrain();
      }
    }
  }

  function schedulePendingUpsertDrain(): void {
    if (upsertDrainScheduled) return;
    upsertDrainScheduled = true;
    // 让同一事件循环轮次内的 ingress 合并到一个原子文件发布，且不延迟已 await 的调用者到定时器窗口。
    queueMicrotask(() => {
      void drainPendingUpserts().catch((error) => {
        const entries = pendingUpserts.splice(0);
        for (const entry of entries) entry.reject(error);
      });
    });
  }

  return {
    upsert(record) {
      const nextRecord = normalizeUpsertRecord(record);
      return new Promise<void>((resolve, reject) => {
        pendingUpserts.push({ record: nextRecord, resolve, reject });
        schedulePendingUpsertDrain();
      });
    },

    async get(sessionKey) {
      const loaded = await ensureLoaded();
      if (!isAvailableBinding({ snapshot: loaded, sessionKey, now: getNow(), retentionMs })) {
        return undefined;
      }
      return cloneRecord(loaded.bindings[sessionKey]);
    },

    async getLatestByChannel(input) {
      const loaded = await ensureLoaded();
      const exactScopeKey = buildScopeKey(input.channel, input.accountId);
      const fallbackScopeKey = buildScopeKey(input.channel);
      const sessionKey = loaded.latestByScope[exactScopeKey] ?? loaded.latestByScope[fallbackScopeKey];
      if (!sessionKey) return undefined;
      return cloneRecord(loaded.bindings[sessionKey]);
    },
  };
}
