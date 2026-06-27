import fs from "node:fs";
import path from "node:path";

import {
  buildDefaultProfile,
  ConversationStore,
  isResidentAgentProfile,
  type AgentRegistry,
  type CompactionRuntimeReport,
  type ConversationStoreOptions,
  type PersistedConversationSummary,
} from "@belldandy/agent";
import { resolveResidentSessionsDir } from "./resident-state-binding.js";

const INVALID_CONVERSATION_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F%]/g;
const TRAILING_CONVERSATION_FILENAME_CHARS = /[. ]+$/;
const RESERVED_WINDOWS_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CONVERSATION_FILE_SUFFIXES = [
  ".jsonl",
  ".meta.json",
  ".transcript.jsonl",
  ".compaction.json",
  ".digest.json",
  ".session-memory.json",
] as const;

type ResidentConversationStoreOptions = Omit<ConversationStoreOptions, "dataDir"> & {
  stateDir: string;
  agentRegistry?: AgentRegistry;
};

type PersistedConversationListOptions = Parameters<ConversationStore["listPersistedConversations"]>[0];

function toSafeConversationFileId(id: string): string {
  const encodeChar = (char: string): string => {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") return "_";
    return `%${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
  };

  let safeId = id.replace(INVALID_CONVERSATION_FILENAME_CHARS, encodeChar);
  safeId = safeId.replace(TRAILING_CONVERSATION_FILENAME_CHARS, (match) => Array.from(match).map(encodeChar).join(""));

  if (!safeId) {
    safeId = "_";
  }

  const windowsBasename = safeId.split(".")[0] ?? safeId;
  if (RESERVED_WINDOWS_BASENAME.test(windowsBasename)) {
    safeId = `_${safeId}`;
  }

  return safeId;
}

function parseResidentAgentId(conversationId: string): string | undefined {
  const match = /^agent:([^:]+):/.exec(conversationId);
  return match?.[1];
}

export class ResidentConversationStore extends ConversationStore {
  private readonly stateDir: string;
  private readonly agentRegistry?: AgentRegistry;
  private readonly storeOptions: ConversationStoreOptions;
  private readonly globalStore: ConversationStore;
  private readonly globalSessionsDir: string;
  private readonly residentStores = new Map<string, ConversationStore>();
  private readonly migratedResidentConversationIds = new Set<string>();

  constructor(options: ResidentConversationStoreOptions) {
    const { stateDir, agentRegistry, ...storeOptions } = options;
    super(storeOptions);
    this.stateDir = stateDir;
    this.agentRegistry = agentRegistry;
    this.storeOptions = storeOptions;
    this.globalSessionsDir = path.join(stateDir, "sessions");
    this.globalStore = new ConversationStore({
      ...storeOptions,
      dataDir: this.globalSessionsDir,
    });
  }

  get(id: string): ReturnType<ConversationStore["get"]> {
    return this.withConversationStore(id, (store) => store.get(id));
  }

  addMessage(...args: Parameters<ConversationStore["addMessage"]>): ReturnType<ConversationStore["addMessage"]> {
    const [id, role, content, opts] = args;
    return this.withConversationStore(id, (store) => store.addMessage(id, role, content, opts));
  }

  clear(id: string): void {
    const store = this.resolveConversationStore(id);
    store.clear(id);
    if (store !== this.globalStore) {
      this.globalStore.clear(id);
    }
  }

  getPartialCompactionView(id: string): ReturnType<ConversationStore["getPartialCompactionView"]> {
    return this.withConversationStore(id, (store) => store.getPartialCompactionView(id));
  }

  getHistory(id: string): ReturnType<ConversationStore["getHistory"]> {
    return this.withConversationStore(id, (store) => store.getHistory(id));
  }

  getCompactBoundaries(...args: Parameters<ConversationStore["getCompactBoundaries"]>): ReturnType<ConversationStore["getCompactBoundaries"]> {
    const [id, limit] = args;
    return this.withConversationStore(id, (store) => store.getCompactBoundaries(id, limit));
  }

  getLatestCompactBoundary(id: string): ReturnType<ConversationStore["getLatestCompactBoundary"]> {
    return this.withConversationStore(id, (store) => store.getLatestCompactBoundary(id));
  }

  getCompactionRuntimeReport(): CompactionRuntimeReport | undefined {
    return this.globalStore.getCompactionRuntimeReport();
  }

  async buildConversationRestoreView(...args: Parameters<ConversationStore["buildConversationRestoreView"]>): ReturnType<ConversationStore["buildConversationRestoreView"]> {
    const [id] = args;
    return this.withConversationStore(id, (store) => store.buildConversationRestoreView(id)) as ReturnType<ConversationStore["buildConversationRestoreView"]>;
  }

  async getCanonicalExtractionView(...args: Parameters<ConversationStore["getCanonicalExtractionView"]>): ReturnType<ConversationStore["getCanonicalExtractionView"]> {
    const [id] = args;
    return this.withConversationStore(id, (store) => store.getCanonicalExtractionView(id)) as ReturnType<ConversationStore["getCanonicalExtractionView"]>;
  }

  async buildConversationTranscriptExport(...args: Parameters<ConversationStore["buildConversationTranscriptExport"]>): ReturnType<ConversationStore["buildConversationTranscriptExport"]> {
    const [id, options] = args;
    return this.withConversationStore(id, (store) => store.buildConversationTranscriptExport(id, options)) as ReturnType<ConversationStore["buildConversationTranscriptExport"]>;
  }

  async buildConversationTimeline(...args: Parameters<ConversationStore["buildConversationTimeline"]>): ReturnType<ConversationStore["buildConversationTimeline"]> {
    const [id, options] = args;
    return this.withConversationStore(id, (store) => store.buildConversationTimeline(id, options)) as ReturnType<ConversationStore["buildConversationTimeline"]>;
  }

  async getConversationHistoryCompacted(...args: Parameters<ConversationStore["getConversationHistoryCompacted"]>): ReturnType<ConversationStore["getConversationHistoryCompacted"]> {
    const [id, overrideOpts] = args;
    return this.withConversationStore(id, (store) => store.getConversationHistoryCompacted(id, overrideOpts)) as ReturnType<ConversationStore["getConversationHistoryCompacted"]>;
  }

  async getHistoryCompacted(...args: Parameters<ConversationStore["getHistoryCompacted"]>): ReturnType<ConversationStore["getHistoryCompacted"]> {
    const [id, overrideOpts] = args;
    return this.withConversationStore(id, (store) => store.getHistoryCompacted(id, overrideOpts)) as ReturnType<ConversationStore["getHistoryCompacted"]>;
  }

  async forceCompact(...args: Parameters<ConversationStore["forceCompact"]>): ReturnType<ConversationStore["forceCompact"]> {
    const [id, overrideOpts] = args;
    return this.withConversationStore(id, (store) => store.forceCompact(id, overrideOpts)) as ReturnType<ConversationStore["forceCompact"]>;
  }

  async forcePartialCompact(...args: Parameters<ConversationStore["forcePartialCompact"]>): ReturnType<ConversationStore["forcePartialCompact"]> {
    const [id, options] = args;
    return this.withConversationStore(id, (store) => store.forcePartialCompact(id, options)) as ReturnType<ConversationStore["forcePartialCompact"]>;
  }

  async getSessionDigest(...args: Parameters<ConversationStore["getSessionDigest"]>): ReturnType<ConversationStore["getSessionDigest"]> {
    const [id, options] = args;
    return this.withConversationStore(id, (store) => store.getSessionDigest(id, options)) as ReturnType<ConversationStore["getSessionDigest"]>;
  }

  async refreshSessionDigest(...args: Parameters<ConversationStore["refreshSessionDigest"]>): ReturnType<ConversationStore["refreshSessionDigest"]> {
    const [id, options] = args;
    return this.withConversationStore(id, (store) => store.refreshSessionDigest(id, options)) as ReturnType<ConversationStore["refreshSessionDigest"]>;
  }

  async getSessionMemory(...args: Parameters<ConversationStore["getSessionMemory"]>): ReturnType<ConversationStore["getSessionMemory"]> {
    const [id] = args;
    return this.withConversationStore(id, (store) => store.getSessionMemory(id)) as ReturnType<ConversationStore["getSessionMemory"]>;
  }

  async refreshSessionMemory(...args: Parameters<ConversationStore["refreshSessionMemory"]>): ReturnType<ConversationStore["refreshSessionMemory"]> {
    const [id, options] = args;
    return this.withConversationStore(id, (store) => store.refreshSessionMemory(id, options)) as ReturnType<ConversationStore["refreshSessionMemory"]>;
  }

  async waitForPendingPersistence(...args: Parameters<ConversationStore["waitForPendingPersistence"]>): ReturnType<ConversationStore["waitForPendingPersistence"]> {
    const [id] = args;
    return this.withConversationStore(id, (store) => store.waitForPendingPersistence(id)) as ReturnType<ConversationStore["waitForPendingPersistence"]>;
  }

  async getSessionTranscriptEvents(...args: Parameters<ConversationStore["getSessionTranscriptEvents"]>): ReturnType<ConversationStore["getSessionTranscriptEvents"]> {
    const [id] = args;
    return this.withConversationStore(id, (store) => store.getSessionTranscriptEvents(id)) as ReturnType<ConversationStore["getSessionTranscriptEvents"]>;
  }

  async listPersistedConversations(options?: PersistedConversationListOptions): ReturnType<ConversationStore["listPersistedConversations"]> {
    const storeOptions = options?.conversationIdPrefix
      ? { conversationIdPrefix: options.conversationIdPrefix }
      : undefined;
    const stores = [this.globalStore, ...this.getKnownResidentStores()];
    const merged = new Map<string, PersistedConversationSummary>();

    for (const store of stores) {
      const items = await store.listPersistedConversations(storeOptions);
      for (const item of items) {
        const existing = merged.get(item.conversationId);
        if (!existing || item.updatedAt >= existing.updatedAt) {
          merged.set(item.conversationId, item);
        }
      }
    }

    const sorted = [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    const limit = typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : undefined;
    return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
  }

  setActiveCounters(...args: Parameters<ConversationStore["setActiveCounters"]>): void {
    const [conversationId, snapshots] = args;
    this.withConversationStore(conversationId, (store) => store.setActiveCounters(conversationId, snapshots));
  }

  getActiveCounters(...args: Parameters<ConversationStore["getActiveCounters"]>): ReturnType<ConversationStore["getActiveCounters"]> {
    const [conversationId] = args;
    return this.withConversationStore(conversationId, (store) => store.getActiveCounters(conversationId));
  }

  recordToolDigest(...args: Parameters<ConversationStore["recordToolDigest"]>): void {
    const [conversationId, record, limit] = args;
    this.withConversationStore(conversationId, (store) => store.recordToolDigest(conversationId, record, limit));
  }

  getToolDigests(...args: Parameters<ConversationStore["getToolDigests"]>): ReturnType<ConversationStore["getToolDigests"]> {
    const [conversationId, limit] = args;
    return this.withConversationStore(conversationId, (store) => store.getToolDigests(conversationId, limit));
  }

  recordRecentToolResult(...args: Parameters<ConversationStore["recordRecentToolResult"]>): void {
    const [conversationId, record, limit] = args;
    this.withConversationStore(conversationId, (store) => store.recordRecentToolResult(conversationId, record, limit));
  }

  getRecentToolResults(...args: Parameters<ConversationStore["getRecentToolResults"]>): ReturnType<ConversationStore["getRecentToolResults"]> {
    const [conversationId, options] = args;
    return this.withConversationStore(conversationId, (store) => store.getRecentToolResults(conversationId, options));
  }

  getCarryoverContext(...args: Parameters<ConversationStore["getCarryoverContext"]>): ReturnType<ConversationStore["getCarryoverContext"]> {
    const [conversationId, options] = args;
    return this.withConversationStore(conversationId, (store) => store.getCarryoverContext(conversationId, options));
  }

  setCarryoverContext(...args: Parameters<ConversationStore["setCarryoverContext"]>): ReturnType<ConversationStore["setCarryoverContext"]> {
    const [conversationId, records, limit] = args;
    return this.withConversationStore(conversationId, (store) => store.setCarryoverContext(conversationId, records, limit));
  }

  upsertCarryoverContext(...args: Parameters<ConversationStore["upsertCarryoverContext"]>): ReturnType<ConversationStore["upsertCarryoverContext"]> {
    const [conversationId, record, limit] = args;
    return this.withConversationStore(conversationId, (store) => store.upsertCarryoverContext(conversationId, record, limit));
  }

  recordTaskTokenResult(...args: Parameters<ConversationStore["recordTaskTokenResult"]>): void {
    const [conversationId, record, limit] = args;
    this.withConversationStore(conversationId, (store) => store.recordTaskTokenResult(conversationId, record, limit));
  }

  getTaskTokenResults(...args: Parameters<ConversationStore["getTaskTokenResults"]>): ReturnType<ConversationStore["getTaskTokenResults"]> {
    const [conversationId, limit] = args;
    return this.withConversationStore(conversationId, (store) => store.getTaskTokenResults(conversationId, limit));
  }

  getLoadedToolNames(...args: Parameters<ConversationStore["getLoadedToolNames"]>): ReturnType<ConversationStore["getLoadedToolNames"]> {
    const [conversationId] = args;
    return this.withConversationStore(conversationId, (store) => store.getLoadedToolNames(conversationId));
  }

  getPlanState(...args: Parameters<ConversationStore["getPlanState"]>): ReturnType<ConversationStore["getPlanState"]> {
    const [conversationId] = args;
    return this.withConversationStore(conversationId, (store) => store.getPlanState(conversationId));
  }

  updatePlanState(...args: Parameters<ConversationStore["updatePlanState"]>): ReturnType<ConversationStore["updatePlanState"]> {
    const [conversationId, input] = args;
    return this.withConversationStore(conversationId, (store) => store.updatePlanState(conversationId, input));
  }

  clearPlanState(...args: Parameters<ConversationStore["clearPlanState"]>): ReturnType<ConversationStore["clearPlanState"]> {
    const [conversationId, updatedBy] = args;
    return this.withConversationStore(conversationId, (store) => store.clearPlanState(conversationId, updatedBy));
  }

  setLoadedToolNames(...args: Parameters<ConversationStore["setLoadedToolNames"]>): ReturnType<ConversationStore["setLoadedToolNames"]> {
    const [conversationId, toolNames] = args;
    return this.withConversationStore(conversationId, (store) => store.setLoadedToolNames(conversationId, toolNames));
  }

  setRoomMembersCache(...args: Parameters<ConversationStore["setRoomMembersCache"]>): void {
    const [conversationId, members, ttl] = args;
    this.withConversationStore(conversationId, (store) => store.setRoomMembersCache(conversationId, members, ttl));
  }

  getRoomMembersCache(...args: Parameters<ConversationStore["getRoomMembersCache"]>): ReturnType<ConversationStore["getRoomMembersCache"]> {
    const [conversationId] = args;
    return this.withConversationStore(conversationId, (store) => store.getRoomMembersCache(conversationId));
  }

  clearRoomMembersCache(...args: Parameters<ConversationStore["clearRoomMembersCache"]>): void {
    const [conversationId] = args;
    this.withConversationStore(conversationId, (store) => store.clearRoomMembersCache(conversationId));
  }

  private withConversationStore<T>(conversationId: string, handler: (store: ConversationStore) => T): T {
    return handler(this.resolveConversationStore(conversationId));
  }

  private resolveConversationStore(conversationId: string): ConversationStore {
    const residentAgentId = parseResidentAgentId(conversationId);
    if (!residentAgentId) {
      return this.globalStore;
    }

    const residentSessionsDir = this.getResidentSessionsDir(residentAgentId);
    const residentStore = this.resolveResidentStore(residentAgentId);
    return this.ensureResidentConversationReady(conversationId, residentStore, residentSessionsDir);
  }

  private resolveResidentStore(agentId: string): ConversationStore {
    const residentSessionsDir = this.getResidentSessionsDir(agentId);
    if (path.resolve(residentSessionsDir) === path.resolve(this.globalSessionsDir)) {
      return this.globalStore;
    }
    const existing = this.residentStores.get(residentSessionsDir);
    if (existing) {
      return existing;
    }

    const store = new ConversationStore({
      ...this.storeOptions,
      dataDir: residentSessionsDir,
    });
    this.residentStores.set(residentSessionsDir, store);
    return store;
  }

  private resolveResidentProfile(agentId: string) {
    return this.agentRegistry?.getProfile(agentId)
      ?? (agentId === "default" ? buildDefaultProfile() : undefined);
  }

  private ensureResidentConversationReady(
    conversationId: string,
    residentStore: ConversationStore,
    residentSessionsDir: string,
  ): ConversationStore {
    if (this.migratedResidentConversationIds.has(conversationId)) {
      return residentStore;
    }

    if (this.hasPersistedConversationFiles(residentSessionsDir, conversationId)) {
      this.migratedResidentConversationIds.add(conversationId);
      return residentStore;
    }

    try {
      const sourceDir = this.getConversationMigrationSourceDir(conversationId, residentSessionsDir);
      if (!sourceDir) {
        this.migratedResidentConversationIds.add(conversationId);
        return residentStore;
      }
      this.migrateConversationFiles(conversationId, sourceDir, residentSessionsDir);
      if (path.resolve(sourceDir) === path.resolve(this.globalSessionsDir)) {
        this.globalStore.clear(conversationId);
      }
      this.migratedResidentConversationIds.add(conversationId);
      return residentStore;
    } catch (error) {
      console.error(`Failed to migrate resident conversation ${conversationId}:`, error);
      return this.globalStore;
    }
  }

  private getKnownResidentStores(): ConversationStore[] {
    const residentSessionDirs = new Set<string>(this.residentStores.keys());
    for (const profile of this.agentRegistry?.list() ?? []) {
      if (!isResidentAgentProfile(profile)) continue;
      const residentSessionsDir = this.getResidentSessionsDir(profile.id);
      if (path.resolve(residentSessionsDir) !== path.resolve(this.globalSessionsDir)) {
        residentSessionDirs.add(residentSessionsDir);
      }
    }
    return [...residentSessionDirs.values()].map((residentSessionsDir) => {
      const existing = this.residentStores.get(residentSessionsDir);
      if (existing) {
        return existing;
      }
      const store = new ConversationStore({
        ...this.storeOptions,
        dataDir: residentSessionsDir,
      });
      this.residentStores.set(residentSessionsDir, store);
      return store;
    });
  }

  private hasPersistedConversationFiles(dataDir: string, conversationId: string): boolean {
    return CONVERSATION_FILE_SUFFIXES.some((suffix) =>
      this.getConversationFileCandidates(dataDir, conversationId, suffix).some((filePath) => fs.existsSync(filePath)),
    );
  }

  private getResidentSessionsDir(agentId: string): string {
    return resolveResidentSessionsDir(this.stateDir, this.resolveResidentProfile(agentId));
  }

  private getConversationMigrationSourceDir(conversationId: string, targetDir: string): string | null {
    const residentAgentId = parseResidentAgentId(conversationId);
    const candidateDirs = residentAgentId
      ? this.getLegacyResidentSessionsDirs(residentAgentId)
      : [];

    if (path.resolve(this.globalSessionsDir) !== path.resolve(targetDir)) {
      candidateDirs.unshift(this.globalSessionsDir);
    }

    for (const sourceDir of candidateDirs) {
      if (path.resolve(sourceDir) === path.resolve(targetDir)) continue;
      if (this.hasPersistedConversationFiles(sourceDir, conversationId)) {
        return sourceDir;
      }
    }

    return null;
  }

  private getLegacyResidentSessionsDirs(agentId: string): string[] {
    const profile = this.resolveResidentProfile(agentId);
    if (!profile) return [];

    const dirs: string[] = [];
    if (agentId === "default") {
      dirs.push(path.join(this.stateDir, "agents", "default", "sessions"));
      return dirs;
    }

    const workspaceDir = profile.workspaceDir?.trim() || agentId;
    dirs.push(path.join(this.stateDir, "agents", workspaceDir, "sessions"));
    return dirs;
  }

  private migrateConversationFiles(conversationId: string, sourceDir: string, targetDir: string): void {
    fs.mkdirSync(targetDir, { recursive: true });

    for (const suffix of CONVERSATION_FILE_SUFFIXES) {
      const sourcePath = this.getConversationFileCandidates(sourceDir, conversationId, suffix)
        .find((candidate) => fs.existsSync(candidate));
      if (!sourcePath) {
        continue;
      }

      const targetPath = this.getConversationSafeFilePath(targetDir, conversationId, suffix);
      if (path.resolve(sourcePath) === path.resolve(targetPath)) {
        continue;
      }
      if (fs.existsSync(targetPath)) {
        continue;
      }

      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code !== "EXDEV") {
          throw error;
        }
        fs.copyFileSync(sourcePath, targetPath);
        fs.unlinkSync(sourcePath);
      }
    }
  }

  private getConversationSafeFilePath(dataDir: string, conversationId: string, suffix: string): string {
    return path.join(dataDir, `${toSafeConversationFileId(conversationId)}${suffix}`);
  }

  private getConversationFileCandidates(dataDir: string, conversationId: string, suffix: string): string[] {
    const primary = this.getConversationSafeFilePath(dataDir, conversationId, suffix);
    const legacy = path.join(dataDir, `${conversationId}${suffix}`);
    return primary === legacy ? [primary] : [primary, legacy];
  }
}
