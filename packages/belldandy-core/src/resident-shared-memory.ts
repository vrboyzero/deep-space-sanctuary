import { createHash } from "node:crypto";

import type { AgentRegistry } from "@belldandy/agent";
import type {
  MemoryChunk,
  MemoryIndexStatus,
  MemorySearchDiagnostics,
  MemorySearchExecution,
  MemoryManager,
  MemorySearchFilter,
  MemorySearchResult,
} from "@belldandy/memory";
import { getGlobalMemoryManager, scanTeamSharedMemorySecrets } from "@belldandy/memory";

import type { ResolvedResidentMemoryPolicy } from "./resident-memory-policy.js";
import type { ScopedMemoryManagerRecord } from "./resident-memory-managers.js";

export type ResidentSharedPromotionStatus = "pending" | "approved" | "rejected" | "revoked" | "active";

export type ResidentMemorySearchDiagnostics = {
  scopeMode: "shared_only" | "private_only" | "unified" | "merged_all";
  sharedManagerUsed: boolean;
  branchCount: number;
  dedupedCount: number;
  returnedCount: number;
  branches: Array<{
    surface: "private" | "shared";
    diagnostics?: MemorySearchDiagnostics;
    resultCount: number;
  }>;
};

export type ResidentSharedPromotionMetadata = {
  kind: "manual";
  status: ResidentSharedPromotionStatus;
  requestedAt: string;
  requestedByAgentId: string;
  sourceAgentId: string;
  sourceChunkId: string;
  sourcePath: string;
  sourceVisibility: string;
  memoryMode: string;
  sessionNamespace?: string;
  workspaceDir?: string;
  reason: string;
  targetSharedChunkId: string;
  reviewerAgentId?: string;
  reviewedAt?: string;
  decisionNote?: string;
  claimedByAgentId?: string;
  claimedAt?: string;
  revokedAt?: string;
  revokedByAgentId?: string;
  promotedAt?: string;
  promotedByAgentId?: string;
};

export type ResidentMemorySharePromotionResult = {
  promotedCount: number;
  item?: MemorySearchResult;
  items: MemorySearchResult[];
  mode: "chunk" | "source";
  reason?: string;
};

export type ResidentMemoryShareReviewDecision = "approved" | "rejected" | "revoked";
export type ResidentMemoryShareClaimAction = "claim" | "release";

export type ResidentMemoryShareReviewResult = {
  decision: ResidentMemoryShareReviewDecision;
  reviewedCount: number;
  mode: "chunk" | "source";
  privateItem?: MemorySearchResult | null;
  sharedItem?: MemorySearchResult | null;
  privateItems?: MemorySearchResult[];
  sharedItems?: MemorySearchResult[];
};

export type ResidentMemoryShareClaimResult = {
  action: ResidentMemoryShareClaimAction;
  claimedCount: number;
  mode: "chunk" | "source";
  privateItem?: MemorySearchResult | null;
  sharedItem?: MemorySearchResult | null;
  privateItems: MemorySearchResult[];
  sharedItems: MemorySearchResult[];
};

export type ResidentSharedReviewQueueItem = MemorySearchResult & {
  targetAgentId: string;
  targetDisplayName: string;
  targetMemoryMode: string;
  reviewStatus: ResidentSharedPromotionStatus;
  claimOwner?: string;
  claimAgeMs?: number;
  claimExpiresAt?: string;
  claimTimedOut: boolean;
  actionableByReviewer: boolean;
  blockedByOtherReviewer: boolean;
};

export type ResidentSharedReviewQueueSummary = {
  totalCount: number;
  pendingCount: number;
  claimedCount: number;
  unclaimedCount: number;
  overdueCount: number;
  approvedCount: number;
  rejectedCount: number;
  revokedCount: number;
  claimTimeoutMs: number;
  reviewerAgentId?: string;
  reviewerClaimedCount: number;
  reviewerActionableCount: number;
  blockedCount: number;
  byAgent: Array<{
    agentId: string;
    displayName: string;
    totalCount: number;
    pendingCount: number;
    claimedCount: number;
    approvedCount: number;
    rejectedCount: number;
    revokedCount: number;
  }>;
  byReviewer: Array<{
    agentId: string;
    count: number;
  }>;
};

export type ResidentSharedReviewQueueResult = {
  items: ResidentSharedReviewQueueItem[];
  summary: ResidentSharedReviewQueueSummary;
};

function cloneFilterWithScope(
  filter: MemorySearchFilter | undefined,
  scope: "private" | "shared",
): MemorySearchFilter {
  return {
    ...(filter ?? {}),
    scope,
  };
}

function dedupeMemoryResults(items: MemorySearchResult[]): MemorySearchResult[] {
  const seen = new Set<string>();
  const deduped: MemorySearchResult[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function byUpdatedAtDesc(a: MemorySearchResult, b: MemorySearchResult): number {
  const left = typeof a.updatedAt === "string" ? Date.parse(a.updatedAt) : 0;
  const right = typeof b.updatedAt === "string" ? Date.parse(b.updatedAt) : 0;
  return right - left;
}

function byCountDesc<T extends { count: number }>(a: T, b: T): number {
  return b.count - a.count;
}

function mergeCategoryBuckets(
  left: MemoryIndexStatus["categoryBuckets"],
  right: MemoryIndexStatus["categoryBuckets"],
): MemoryIndexStatus["categoryBuckets"] {
  const merged: NonNullable<MemoryIndexStatus["categoryBuckets"]> = {};
  for (const [key, value] of Object.entries(left ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) {
      merged[key as keyof typeof merged] = value;
    }
  }
  for (const [key, value] of Object.entries(right ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const current = typeof merged[key as keyof typeof merged] === "number"
        ? Number(merged[key as keyof typeof merged])
        : 0;
      merged[key as keyof typeof merged] = current + value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

const DEFAULT_SHARED_REVIEW_CLAIM_TIMEOUT_MS = 60 * 60 * 1000;

function resolveSharedReviewClaimTimeoutMs(): number {
  const parsed = Number(process.env.BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHARED_REVIEW_CLAIM_TIMEOUT_MS;
  }
  return Math.max(60_000, Math.floor(parsed));
}

type ResidentPromotionClaimState = {
  claimOwner: string;
  claimAgeMs?: number;
  claimExpiresAt?: string;
  claimTimedOut: boolean;
  blocksOtherReviewers: boolean;
};

function resolvePromotionClaimState(
  promotion: ResidentSharedPromotionMetadata,
  nowMs = Date.now(),
  claimTimeoutMs = resolveSharedReviewClaimTimeoutMs(),
): ResidentPromotionClaimState {
  const claimOwner = typeof promotion.claimedByAgentId === "string" ? promotion.claimedByAgentId.trim() : "";
  const claimedAtRaw = typeof promotion.claimedAt === "string" ? promotion.claimedAt.trim() : "";
  const claimedAtMs = claimedAtRaw ? Date.parse(claimedAtRaw) : Number.NaN;
  const claimAgeMs = claimOwner && Number.isFinite(claimedAtMs)
    ? Math.max(0, nowMs - claimedAtMs)
    : undefined;
  const claimTimedOut = Boolean(claimOwner) && typeof claimAgeMs === "number" && claimAgeMs >= claimTimeoutMs;
  const claimExpiresAt = claimOwner && Number.isFinite(claimedAtMs)
    ? new Date(claimedAtMs + claimTimeoutMs).toISOString()
    : undefined;
  return {
    claimOwner,
    claimAgeMs,
    claimExpiresAt,
    claimTimedOut,
    blocksOtherReviewers: Boolean(claimOwner) && !claimTimedOut,
  };
}

function normalizeQueueStatuses(
  value: unknown,
): ResidentSharedPromotionStatus[] {
  const source = Array.isArray(value) ? value : [value];
  const statuses = source
    .map((item) => normalizeResidentSharedPromotionStatus(item))
    .filter((item): item is ResidentSharedPromotionStatus => Boolean(item));
  return statuses.length > 0 ? [...new Set(statuses)] : ["pending"];
}

function matchesQueueQuery(item: MemorySearchResult, promotion: ResidentSharedPromotionMetadata, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    item.id,
    item.sourcePath,
    item.summary,
    item.snippet,
    item.content,
    promotion.reason,
    promotion.sourceAgentId,
    promotion.requestedByAgentId,
    promotion.claimedByAgentId,
    promotion.reviewerAgentId,
    promotion.decisionNote,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();
  return haystack.includes(normalized);
}

export function normalizeResidentSharedPromotionStatus(value: unknown): ResidentSharedPromotionStatus | undefined {
  switch (value) {
    case "pending":
    case "approved":
    case "rejected":
    case "revoked":
    case "active":
      return value;
    default:
      return undefined;
  }
}

export function getResidentSharedPromotionMetadata(item: Pick<MemorySearchResult, "metadata"> | null | undefined): ResidentSharedPromotionMetadata | null {
  const metadata = safeObject(item?.metadata);
  const promotion = safeObject(metadata.sharedPromotion);
  const status = normalizeResidentSharedPromotionStatus(promotion.status);
  const sourceChunkId = typeof promotion.sourceChunkId === "string" ? promotion.sourceChunkId.trim() : "";
  const sourceAgentId = typeof promotion.sourceAgentId === "string" ? promotion.sourceAgentId.trim() : "";
  const targetSharedChunkId = typeof promotion.targetSharedChunkId === "string" ? promotion.targetSharedChunkId.trim() : "";
  const requestedByAgentId = typeof promotion.requestedByAgentId === "string"
    ? promotion.requestedByAgentId.trim()
    : typeof promotion.promotedByAgentId === "string"
      ? promotion.promotedByAgentId.trim()
      : "";
  const requestedAt = typeof promotion.requestedAt === "string"
    ? promotion.requestedAt.trim()
    : typeof promotion.promotedAt === "string"
      ? promotion.promotedAt.trim()
      : "";
  const sourcePath = typeof promotion.sourcePath === "string" ? promotion.sourcePath.trim() : "";
  if (!status || !sourceChunkId || !sourceAgentId || !requestedByAgentId || !requestedAt || !sourcePath) {
    return null;
  }

  return {
    kind: "manual",
    status,
    requestedAt,
    requestedByAgentId,
    sourceAgentId,
    sourceChunkId,
    sourcePath,
    sourceVisibility: typeof promotion.sourceVisibility === "string" ? promotion.sourceVisibility : "private",
    memoryMode: typeof promotion.memoryMode === "string" ? promotion.memoryMode : "isolated",
    sessionNamespace: typeof promotion.sessionNamespace === "string" ? promotion.sessionNamespace : undefined,
    workspaceDir: typeof promotion.workspaceDir === "string" ? promotion.workspaceDir : undefined,
    reason: typeof promotion.reason === "string" ? promotion.reason : "",
    targetSharedChunkId: targetSharedChunkId || buildSharedPromotionChunkId(sourceAgentId, sourceChunkId),
    reviewerAgentId: typeof promotion.reviewerAgentId === "string" ? promotion.reviewerAgentId : undefined,
    reviewedAt: typeof promotion.reviewedAt === "string" ? promotion.reviewedAt : undefined,
    decisionNote: typeof promotion.decisionNote === "string" ? promotion.decisionNote : undefined,
    claimedByAgentId: typeof promotion.claimedByAgentId === "string" ? promotion.claimedByAgentId : undefined,
    claimedAt: typeof promotion.claimedAt === "string" ? promotion.claimedAt : undefined,
    revokedAt: typeof promotion.revokedAt === "string" ? promotion.revokedAt : undefined,
    revokedByAgentId: typeof promotion.revokedByAgentId === "string" ? promotion.revokedByAgentId : undefined,
    promotedAt: typeof promotion.promotedAt === "string" ? promotion.promotedAt : undefined,
    promotedByAgentId: typeof promotion.promotedByAgentId === "string" ? promotion.promotedByAgentId : undefined,
  };
}

function isApprovedSharedPromotionStatus(status: ResidentSharedPromotionStatus | undefined): boolean {
  return status === "approved" || status === "active";
}

export function isResidentSharedMemoryVisible(item: MemorySearchResult): boolean {
  if (item.visibility !== "shared") return true;
  const promotion = getResidentSharedPromotionMetadata(item);
  if (!promotion) return true;
  return isApprovedSharedPromotionStatus(promotion.status);
}

function filterVisibleSharedItems(items: MemorySearchResult[]): MemorySearchResult[] {
  return items.filter((item) => isResidentSharedMemoryVisible(item));
}

function toMemoryChunk(item: MemorySearchResult, metadata: Record<string, unknown>, visibility = item.visibility ?? "private"): MemoryChunk {
  return {
    id: item.id,
    sourcePath: item.sourcePath,
    sourceType: item.sourceType === "session" || item.sourceType === "manual" ? item.sourceType : "file",
    memoryType: item.memoryType ?? "other",
    content: item.content ?? item.snippet,
    startLine: item.startLine,
    endLine: item.endLine,
    category: item.category,
    visibility,
    metadata,
  };
}

function upsertMemorySharedPromotion(manager: MemoryManager, item: MemorySearchResult, promotion: ResidentSharedPromotionMetadata, visibility = item.visibility ?? "private"): MemorySearchResult | null {
  const nextMetadata = {
    ...safeObject(item.metadata),
    sharedPromotion: promotion,
  };
  return manager.upsertMemoryChunk(toMemoryChunk(item, nextMetadata, visibility));
}

function buildSharedPromotionChunkId(sourceAgentId: string, chunkId: string): string {
  const digest = createHash("sha1")
    .update(`${sourceAgentId}:${chunkId}`)
    .digest("hex");
  return `shared:${sourceAgentId}:${digest}`;
}

function buildPendingSharedPromotion(input: {
  sourceItem: MemorySearchResult;
  sourceAgentId: string;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  reason: string;
}): ResidentSharedPromotionMetadata {
  const now = new Date().toISOString();
  return {
    kind: "manual",
    status: "pending",
    requestedAt: now,
    requestedByAgentId: input.sourceAgentId,
    sourceAgentId: input.sourceAgentId,
    sourceChunkId: input.sourceItem.id,
    sourcePath: input.sourceItem.sourcePath,
    sourceVisibility: input.sourceItem.visibility ?? "private",
    memoryMode: input.residentPolicy?.memoryMode ?? "isolated",
    sessionNamespace: input.residentPolicy?.agentId ?? input.sourceAgentId,
    workspaceDir: input.residentPolicy?.workspaceDir,
    reason: input.reason,
    targetSharedChunkId: buildSharedPromotionChunkId(input.sourceAgentId, input.sourceItem.id),
  };
}

function toSharedPromotionChunk(input: {
  sourceItem: MemorySearchResult;
  promotion: ResidentSharedPromotionMetadata;
}): MemoryChunk {
  return toMemoryChunk(
    {
      ...input.sourceItem,
      id: input.promotion.targetSharedChunkId,
      visibility: "shared",
    },
    {
      ...safeObject(input.sourceItem.metadata),
      sharedPromotion: input.promotion,
    },
    "shared",
  );
}

function getSharedReadManager(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
}): MemoryManager | null {
  if (input.residentPolicy?.includeSharedMemoryReads !== true) return null;
  if (!input.sharedManager || input.sharedManager === input.manager) return null;
  return input.sharedManager;
}

function shouldTreatManagerAsUnifiedMemorySurface(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
}): boolean {
  if (!input.residentPolicy) {
    return true;
  }
  if (!input.sharedManager || input.sharedManager === input.manager) {
    return true;
  }
  return false;
}

type ResidentSharePromotionContext = {
  privateItem: MemorySearchResult | null;
  sharedItem: MemorySearchResult | null;
  promotion: ResidentSharedPromotionMetadata;
};

function resolvePromotionContext(input: {
  manager: MemoryManager;
  sharedManager: MemoryManager;
  agentId: string;
  chunkId: string;
}): ResidentSharePromotionContext {
  const privateItem = input.manager.getMemory(input.chunkId);
  if (privateItem) {
    const privatePromotion = getResidentSharedPromotionMetadata(privateItem);
    const sourceAgentId = privatePromotion?.sourceAgentId || input.agentId;
    const sourceChunkId = privatePromotion?.sourceChunkId || privateItem.id;
    const sharedChunkId = privatePromotion?.targetSharedChunkId || buildSharedPromotionChunkId(sourceAgentId, sourceChunkId);
    const sharedItem = input.sharedManager.getMemory(sharedChunkId);
    const promotion = privatePromotion ?? getResidentSharedPromotionMetadata(sharedItem);
    if (!promotion) {
      throw new Error("Shared promotion metadata is not available for this memory.");
    }
    return { privateItem, sharedItem, promotion };
  }

  const sharedItem = input.sharedManager.getMemory(input.chunkId);
  const promotion = getResidentSharedPromotionMetadata(sharedItem);
  if (!sharedItem || !promotion) {
    throw new Error(`Shared promotion target not found: ${input.chunkId}`);
  }
  return {
    privateItem: input.manager.getMemory(promotion.sourceChunkId),
    sharedItem,
    promotion,
  };
}

function resolvePromotionContexts(input: {
  manager: MemoryManager;
  sharedManager: MemoryManager;
  agentId: string;
  chunkId?: string;
  sourcePath?: string;
}): ResidentSharePromotionContext[] {
  const chunkId = typeof input.chunkId === "string" ? input.chunkId.trim() : "";
  const sourcePath = typeof input.sourcePath === "string" ? input.sourcePath.trim() : "";
  if (chunkId) {
    return [resolvePromotionContext({
      manager: input.manager,
      sharedManager: input.sharedManager,
      agentId: input.agentId,
      chunkId,
    })];
  }
  if (!sourcePath) {
    throw new Error("chunkId or sourcePath is required.");
  }

  const sourceItems = input.manager.getMemoriesBySource(sourcePath, 200);
  if (sourceItems.length === 0) {
    throw new Error(`No memories found for sourcePath: ${sourcePath}`);
  }

  const contexts = sourceItems
    .map((item) => {
      try {
        return resolvePromotionContext({
          manager: input.manager,
          sharedManager: input.sharedManager,
          agentId: input.agentId,
          chunkId: item.id,
        });
      } catch {
        return null;
      }
    })
    .filter((item): item is ResidentSharePromotionContext => Boolean(item));
  if (contexts.length === 0) {
    throw new Error(`Shared promotion metadata is not available for sourcePath: ${sourcePath}`);
  }
  return contexts;
}

function buildReviewedPromotion(
  current: ResidentSharedPromotionMetadata,
  input: {
    decision: ResidentMemoryShareReviewDecision;
    reviewerAgentId: string;
    note?: string;
  },
): ResidentSharedPromotionMetadata {
  const now = new Date().toISOString();
  const base: ResidentSharedPromotionMetadata = {
    ...current,
    status: input.decision,
    reviewerAgentId: input.reviewerAgentId,
    reviewedAt: now,
    decisionNote: input.note,
    claimedByAgentId: undefined,
    claimedAt: undefined,
  };
  if (input.decision === "revoked") {
    return {
      ...base,
      revokedAt: now,
      revokedByAgentId: input.reviewerAgentId,
    };
  }
  return {
    ...base,
    revokedAt: undefined,
    revokedByAgentId: undefined,
  };
}

function buildClaimedPromotion(
  current: ResidentSharedPromotionMetadata,
  input: {
    action: ResidentMemoryShareClaimAction;
    agentId: string;
  },
): ResidentSharedPromotionMetadata {
  if (input.action === "claim") {
    return {
      ...current,
      claimedByAgentId: input.agentId,
      claimedAt: new Date().toISOString(),
    };
  }
  return {
    ...current,
    claimedByAgentId: undefined,
    claimedAt: undefined,
  };
}

function assertReviewTransition(
  currentStatus: ResidentSharedPromotionStatus,
  decision: ResidentMemoryShareReviewDecision,
): void {
  if (decision === "approved") {
    if (currentStatus === "pending") return;
    if (isApprovedSharedPromotionStatus(currentStatus)) {
      throw new Error("Shared promotion is already approved.");
    }
    throw new Error(`Cannot approve shared promotion from ${currentStatus} state. Please submit it again first.`);
  }

  if (decision === "rejected") {
    if (currentStatus === "pending") return;
    throw new Error(`Only pending shared promotions can be rejected. Current status: ${currentStatus}.`);
  }

  if (decision === "revoked") {
    if (isApprovedSharedPromotionStatus(currentStatus)) return;
    throw new Error(`Only approved shared promotions can be revoked. Current status: ${currentStatus}.`);
  }
}

function assertClaimTransition(
  promotion: ResidentSharedPromotionMetadata,
  action: ResidentMemoryShareClaimAction,
  agentId: string,
): void {
  if (promotion.status !== "pending") {
    throw new Error(`Only pending shared promotions can be ${action === "claim" ? "claimed" : "released"}. Current status: ${promotion.status}.`);
  }
  const claimState = resolvePromotionClaimState(promotion);
  const claimedByAgentId = claimState.blocksOtherReviewers ? claimState.claimOwner : "";
  if (action === "claim") {
    if (claimedByAgentId && claimedByAgentId !== agentId) {
      throw new Error(`Shared promotion is already claimed by ${claimedByAgentId}.`);
    }
    return;
  }
  if (!claimedByAgentId) {
    throw new Error("Shared promotion is not currently claimed.");
  }
  if (claimedByAgentId !== agentId) {
    throw new Error(`Only ${claimedByAgentId} can release this shared promotion claim.`);
  }
}

function assertClaimOwnershipForReview(
  promotion: ResidentSharedPromotionMetadata,
  reviewerAgentId: string,
): void {
  const claimState = resolvePromotionClaimState(promotion);
  const claimedByAgentId = claimState.blocksOtherReviewers ? claimState.claimOwner : "";
  if (promotion.status !== "pending" || !claimedByAgentId) {
    return;
  }
  if (claimedByAgentId !== reviewerAgentId) {
    throw new Error(`Shared promotion is currently claimed by ${claimedByAgentId}. Please let that reviewer finish or release the claim first.`);
  }
}

export function resolveResidentSharedMemoryManager(
  residentPolicy?: ResolvedResidentMemoryPolicy,
): MemoryManager | null {
  if (!residentPolicy?.sharedStateDir) {
    return null;
  }
  return getGlobalMemoryManager({
    workspaceRoot: residentPolicy.sharedStateDir,
  });
}

export async function searchResidentMemory(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  query: string;
  limit: number;
  filter?: MemorySearchFilter;
  includeContent: boolean;
}): Promise<MemorySearchResult[]> {
  return (await searchResidentMemoryWithDiagnostics(input)).items;
}

export async function searchResidentMemoryWithDiagnostics(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  query: string;
  limit: number;
  filter?: MemorySearchFilter;
  includeContent: boolean;
}): Promise<{
  items: MemorySearchResult[];
  diagnostics: ResidentMemorySearchDiagnostics;
}> {
  const { manager, query, limit, filter, includeContent } = input;
  const sharedManager = getSharedReadManager(input);
  const wantsSharedOnly = filter?.scope === "shared";
  const wantsPrivateOnly = filter?.scope === "private";
  const unifiedSurface = shouldTreatManagerAsUnifiedMemorySurface(input);

  if (wantsSharedOnly) {
    if (sharedManager) {
      const shared = await runMemorySearch(sharedManager, query, {
        limit,
        filter: cloneFilterWithScope(filter, "shared"),
        includeContent,
      });
      const items = filterVisibleSharedItems(shared.items);
      return {
        items,
        diagnostics: {
          scopeMode: "shared_only",
          sharedManagerUsed: true,
          branchCount: 1,
          dedupedCount: items.length,
          returnedCount: items.length,
          branches: [{
            surface: "shared",
            diagnostics: shared.diagnostics,
            resultCount: items.length,
          }],
        },
      };
    }
    if (!unifiedSurface) {
      return {
        items: [],
        diagnostics: {
          scopeMode: "shared_only",
          sharedManagerUsed: false,
          branchCount: 0,
          dedupedCount: 0,
          returnedCount: 0,
          branches: [],
        },
      };
    }
    const unified = await runMemorySearch(manager, query, {
      limit,
      filter: cloneFilterWithScope(filter, "shared"),
      includeContent,
    });
    const items = filterVisibleSharedItems(unified.items);
    return {
      items,
      diagnostics: {
        scopeMode: "shared_only",
        sharedManagerUsed: false,
        branchCount: 1,
        dedupedCount: items.length,
        returnedCount: items.length,
        branches: [{
          surface: "private",
          diagnostics: unified.diagnostics,
          resultCount: items.length,
        }],
      },
    };
  }

  if (wantsPrivateOnly) {
    const privateSearch = await runMemorySearch(manager, query, {
      limit,
      filter: cloneFilterWithScope(filter, "private"),
      includeContent,
    });
    return {
      items: privateSearch.items,
      diagnostics: {
        scopeMode: "private_only",
        sharedManagerUsed: false,
        branchCount: 1,
        dedupedCount: privateSearch.items.length,
        returnedCount: privateSearch.items.length,
        branches: [{
          surface: "private",
          diagnostics: privateSearch.diagnostics,
          resultCount: privateSearch.items.length,
        }],
      },
    };
  }

  if (unifiedSurface) {
    const unified = await runMemorySearch(manager, query, {
      limit,
      filter,
      includeContent,
    });
    return {
      items: unified.items,
      diagnostics: {
        scopeMode: "unified",
        sharedManagerUsed: false,
        branchCount: 1,
        dedupedCount: unified.items.length,
        returnedCount: unified.items.length,
        branches: [{
          surface: "private",
          diagnostics: unified.diagnostics,
          resultCount: unified.items.length,
        }],
      },
    };
  }

  const privateSearch = await runMemorySearch(manager, query, {
    limit,
    filter: cloneFilterWithScope(filter, "private"),
    includeContent,
  });
  const privateItems = privateSearch.items;
  if (!sharedManager) {
    const items = privateItems.slice(0, limit);
    return {
      items,
      diagnostics: {
        scopeMode: "merged_all",
        sharedManagerUsed: false,
        branchCount: 1,
        dedupedCount: privateItems.length,
        returnedCount: items.length,
        branches: [{
          surface: "private",
          diagnostics: privateSearch.diagnostics,
          resultCount: privateItems.length,
        }],
      },
    };
  }
  const sharedSearch = await runMemorySearch(sharedManager, query, {
    limit,
    filter: cloneFilterWithScope(filter, "shared"),
    includeContent,
  });
  const sharedItems = filterVisibleSharedItems(sharedSearch.items);
  const deduped = dedupeMemoryResults([...privateItems, ...sharedItems]);
  const items = deduped
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    items,
    diagnostics: {
      scopeMode: "merged_all",
      sharedManagerUsed: true,
      branchCount: 2,
      dedupedCount: deduped.length,
      returnedCount: items.length,
      branches: [
        {
          surface: "private",
          diagnostics: privateSearch.diagnostics,
          resultCount: privateItems.length,
        },
        {
          surface: "shared",
          diagnostics: sharedSearch.diagnostics,
          resultCount: sharedItems.length,
        },
      ],
    },
  };
}

async function runMemorySearch(
  manager: MemoryManager,
  query: string,
  options: {
    limit: number;
    filter?: MemorySearchFilter;
    includeContent: boolean;
  },
): Promise<MemorySearchExecution> {
  if (typeof manager.searchWithDiagnostics === "function") {
    return manager.searchWithDiagnostics(query, options);
  }
  const items = await manager.search(query, options);
  return {
    items,
    diagnostics: {
      retrievalMode: "explicit",
      limit: options.limit,
      routingPolicy: "chunk_only",
      skipped: false,
      deepRetrievalApplied: false,
      scoreSignalAppliedCount: 0,
      sourceClassMix: {},
      nodeAssisted: {
        enabled: false,
        policy: "chunk_only",
        nodeHitCount: 0,
        injectedChunkCount: 0,
        fallbackApplied: false,
        returnedMix: {
          nodeBacked: 0,
          chunkOnly: items.length,
        },
        topNodeHits: [],
      },
      stages: {
        raw: { count: items.length, topHits: [] },
        scoreAware: { count: items.length, topHits: [] },
        reranked: { count: items.length, topHits: [] },
        returned: { count: items.length, topHits: [] },
      },
    },
  };
}

export function listRecentResidentMemory(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  limit: number;
  filter?: MemorySearchFilter;
  includeContent: boolean;
}): MemorySearchResult[] {
  const { manager, limit, filter, includeContent } = input;
  const sharedManager = getSharedReadManager(input);
  const wantsSharedOnly = filter?.scope === "shared";
  const wantsPrivateOnly = filter?.scope === "private";
  const unifiedSurface = shouldTreatManagerAsUnifiedMemorySurface(input);

  if (wantsSharedOnly) {
    if (sharedManager) {
      return filterVisibleSharedItems(sharedManager.getRecent(limit, cloneFilterWithScope(filter, "shared"), includeContent));
    }
    if (!unifiedSurface) return [];
    return filterVisibleSharedItems(manager.getRecent(limit, cloneFilterWithScope(filter, "shared"), includeContent));
  }

  if (wantsPrivateOnly) {
    return manager.getRecent(limit, cloneFilterWithScope(filter, "private"), includeContent);
  }

  if (unifiedSurface) {
    return manager.getRecent(limit, filter, includeContent);
  }
  const privateItems = manager.getRecent(limit, cloneFilterWithScope(filter, "private"), includeContent);
  if (!sharedManager) {
    return privateItems.slice(0, limit);
  }
  const sharedItems = filterVisibleSharedItems(sharedManager.getRecent(limit, cloneFilterWithScope(filter, "shared"), includeContent));
  return dedupeMemoryResults([...privateItems, ...sharedItems])
    .sort(byUpdatedAtDesc)
    .slice(0, limit);
}

export function getResidentMemory(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  chunkId: string;
}): MemorySearchResult | null {
  const privateItem = input.manager.getMemory(input.chunkId);
  if (privateItem) return privateItem;

  const sharedManager = getSharedReadManager(input);
  if (!sharedManager) return null;
  const sharedItem = sharedManager.getMemory(input.chunkId);
  return sharedItem && isResidentSharedMemoryVisible(sharedItem) ? sharedItem : null;
}

export function mergeResidentMemoryStatus(
  primary: MemoryIndexStatus,
  secondary?: MemoryIndexStatus | null,
): MemoryIndexStatus {
  if (!secondary) return primary;
  return {
    files: (primary.files ?? 0) + (secondary.files ?? 0),
    chunks: (primary.chunks ?? 0) + (secondary.chunks ?? 0),
    categorized: (primary.categorized ?? 0) + (secondary.categorized ?? 0),
    uncategorized: (primary.uncategorized ?? 0) + (secondary.uncategorized ?? 0),
    vectorIndexed: (primary.vectorIndexed ?? 0) + (secondary.vectorIndexed ?? 0),
    vectorCached: (primary.vectorCached ?? 0) + (secondary.vectorCached ?? 0),
    summarized: (primary.summarized ?? 0) + (secondary.summarized ?? 0),
    summaryPending: (primary.summaryPending ?? 0) + (secondary.summaryPending ?? 0),
    categoryBuckets: mergeCategoryBuckets(primary.categoryBuckets, secondary.categoryBuckets),
    lastIndexedAt: [primary.lastIndexedAt, secondary.lastIndexedAt]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .sort()
      .at(-1),
  };
}

export function listResidentSharedReviewQueue(input: {
  records: ScopedMemoryManagerRecord[];
  agentRegistry?: AgentRegistry;
  reviewerAgentId?: string;
  limit: number;
  query?: string;
  includeContent?: boolean;
  filter?: {
    sharedPromotionStatus?: ResidentSharedPromotionStatus | ResidentSharedPromotionStatus[];
    targetAgentId?: string;
    claimedByAgentId?: string;
    actionableOnly?: boolean;
  };
}): ResidentSharedReviewQueueResult {
  const limit = Math.max(1, Math.min(input.limit, 200));
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const statuses = normalizeQueueStatuses(input.filter?.sharedPromotionStatus);
  const targetAgentFilter = typeof input.filter?.targetAgentId === "string" ? input.filter.targetAgentId.trim() : "";
  const claimedByFilter = typeof input.filter?.claimedByAgentId === "string" ? input.filter.claimedByAgentId.trim() : "";
  const reviewerAgentId = typeof input.reviewerAgentId === "string" ? input.reviewerAgentId.trim() : "";
  const actionableOnly = input.filter?.actionableOnly === true;
  const includeContent = input.includeContent === true;
  const perAgentLimit = Math.max(limit, 50);
  const claimTimeoutMs = resolveSharedReviewClaimTimeoutMs();
  const nowMs = Date.now();
  const items: ResidentSharedReviewQueueItem[] = [];

  for (const record of input.records) {
    if (record.policy.writeTarget === "shared") continue;
    if (targetAgentFilter && record.agentId !== targetAgentFilter) continue;

    const displayName = input.agentRegistry?.getProfile(record.agentId)?.displayName ?? record.agentId;
    const candidates = record.manager.getRecent(perAgentLimit, {
      scope: "private",
      sharedPromotionStatus: statuses,
    }, includeContent);

    for (const item of candidates) {
      const promotion = getResidentSharedPromotionMetadata(item);
      if (!promotion) continue;
      if (!statuses.includes(promotion.status)) continue;
      if (!matchesQueueQuery(item, promotion, query)) continue;
      if (claimedByFilter && promotion.claimedByAgentId !== claimedByFilter) continue;

      const claimState = resolvePromotionClaimState(promotion, nowMs, claimTimeoutMs);
      const actionableByReviewer = promotion.status === "pending" && (!claimState.blocksOtherReviewers || claimState.claimOwner === reviewerAgentId);
      const blockedByOtherReviewer = promotion.status === "pending" && claimState.blocksOtherReviewers && claimState.claimOwner !== reviewerAgentId;
      if (actionableOnly && !actionableByReviewer) continue;

      items.push({
        ...item,
        targetAgentId: record.agentId,
        targetDisplayName: displayName,
        targetMemoryMode: record.memoryMode,
        reviewStatus: promotion.status,
        claimOwner: claimState.claimOwner || undefined,
        claimAgeMs: claimState.claimAgeMs,
        claimExpiresAt: claimState.claimExpiresAt,
        claimTimedOut: claimState.claimTimedOut,
        actionableByReviewer,
        blockedByOtherReviewer,
      });
    }
  }

  items.sort(byUpdatedAtDesc);
  const limited = items.slice(0, limit);
  const byAgentMap = new Map<string, ResidentSharedReviewQueueSummary["byAgent"][number]>();
  const byReviewerMap = new Map<string, number>();
  const summary: ResidentSharedReviewQueueSummary = {
    totalCount: 0,
    pendingCount: 0,
    claimedCount: 0,
    unclaimedCount: 0,
    overdueCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    revokedCount: 0,
    claimTimeoutMs,
    reviewerAgentId: reviewerAgentId || undefined,
    reviewerClaimedCount: 0,
    reviewerActionableCount: 0,
    blockedCount: 0,
    byAgent: [],
    byReviewer: [],
  };

  for (const item of limited) {
    const promotion = getResidentSharedPromotionMetadata(item);
    if (!promotion) continue;
    const claimState = resolvePromotionClaimState(promotion, nowMs, claimTimeoutMs);
    summary.totalCount += 1;
    if (promotion.status === "pending") {
      summary.pendingCount += 1;
      if (claimState.claimTimedOut) {
        summary.overdueCount += 1;
      }
      if (claimState.blocksOtherReviewers) {
        summary.claimedCount += 1;
      } else {
        summary.unclaimedCount += 1;
      }
    } else if (promotion.status === "approved" || promotion.status === "active") {
      summary.approvedCount += 1;
    } else if (promotion.status === "rejected") {
      summary.rejectedCount += 1;
    } else if (promotion.status === "revoked") {
      summary.revokedCount += 1;
    }

    if (item.actionableByReviewer) {
      summary.reviewerActionableCount += 1;
    }
    if (item.blockedByOtherReviewer) {
      summary.blockedCount += 1;
    }
    if (reviewerAgentId && claimState.claimOwner === reviewerAgentId && claimState.blocksOtherReviewers) {
      summary.reviewerClaimedCount += 1;
    }

    const agentBucket = byAgentMap.get(item.targetAgentId) ?? {
      agentId: item.targetAgentId,
      displayName: item.targetDisplayName,
      totalCount: 0,
      pendingCount: 0,
      claimedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      revokedCount: 0,
    };
    agentBucket.totalCount += 1;
    if (promotion.status === "pending") {
      agentBucket.pendingCount += 1;
      if (claimState.blocksOtherReviewers) {
        agentBucket.claimedCount += 1;
      }
    } else if (promotion.status === "approved" || promotion.status === "active") {
      agentBucket.approvedCount += 1;
    } else if (promotion.status === "rejected") {
      agentBucket.rejectedCount += 1;
    } else if (promotion.status === "revoked") {
      agentBucket.revokedCount += 1;
    }
    byAgentMap.set(item.targetAgentId, agentBucket);

    if (claimState.claimOwner && claimState.blocksOtherReviewers) {
      byReviewerMap.set(claimState.claimOwner, (byReviewerMap.get(claimState.claimOwner) ?? 0) + 1);
    }
  }

  summary.byAgent = [...byAgentMap.values()].sort((a, b) => b.totalCount - a.totalCount);
  summary.byReviewer = [...byReviewerMap.entries()]
    .map(([agentId, count]) => ({ agentId, count }))
    .sort(byCountDesc);

  return {
    items: limited,
    summary,
  };
}

export function promoteResidentMemoryToShared(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  residentPolicy?: ResolvedResidentMemoryPolicy;
  agentId: string;
  chunkId?: string;
  sourcePath?: string;
  reason?: string;
}): ResidentMemorySharePromotionResult {
  const sharedManager = input.sharedManager;
  if (!sharedManager) {
    throw new Error("Shared memory manager is not available.");
  }
  if (sharedManager === input.manager) {
    throw new Error("Current resident already writes to the shared memory layer.");
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    throw new Error("reason is required for shared memory promotion.");
  }

  const chunkId = typeof input.chunkId === "string" ? input.chunkId.trim() : "";
  const sourcePath = typeof input.sourcePath === "string" ? input.sourcePath.trim() : "";
  if (!chunkId && !sourcePath) {
    throw new Error("chunkId or sourcePath is required.");
  }

  const sourceItems = chunkId
    ? [input.manager.getMemory(chunkId)].filter((item): item is MemorySearchResult => Boolean(item))
    : input.manager.getMemoriesBySource(sourcePath, 200);
  if (sourceItems.length === 0) {
    throw new Error(chunkId ? `Memory chunk not found: ${chunkId}` : `No memories found for sourcePath: ${sourcePath}`);
  }

  const blocked = sourceItems
    .map((item) => ({
      item,
      matches: scanTeamSharedMemorySecrets(item.content ?? item.snippet ?? ""),
    }))
    .find((entry) => entry.matches.length > 0);
  if (blocked) {
    throw new Error(`共享提升被拒绝：内容包含潜在敏感信息 ${blocked.matches.map((item) => item.label).join("、")}。`);
  }

  const promotedItems: MemorySearchResult[] = [];
  for (const item of sourceItems) {
    const existingPromotion = getResidentSharedPromotionMetadata(item);
    const currentStatus = existingPromotion?.status;
    if (currentStatus === "pending") {
      throw new Error(`共享审批已在等待中：${item.id}`);
    }
    if (isApprovedSharedPromotionStatus(currentStatus)) {
      throw new Error(`共享审批已通过：${item.id}`);
    }

    const promotion = buildPendingSharedPromotion({
      sourceItem: item,
      sourceAgentId: input.agentId,
      residentPolicy: input.residentPolicy,
      reason,
    });
    upsertMemorySharedPromotion(input.manager, item, promotion, item.visibility ?? "private");
    const sharedItem = sharedManager.upsertMemoryChunk(toSharedPromotionChunk({
      sourceItem: item,
      promotion,
    }));
    if (sharedItem) {
      promotedItems.push(sharedItem);
    }
  }

  return {
    promotedCount: promotedItems.length,
    item: promotedItems[0],
    items: promotedItems,
    mode: chunkId ? "chunk" : "source",
    reason,
  };
}

export function reviewResidentSharedMemoryPromotion(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  agentId: string;
  chunkId?: string;
  sourcePath?: string;
  decision: ResidentMemoryShareReviewDecision;
  note?: string;
}): ResidentMemoryShareReviewResult {
  const sharedManager = input.sharedManager;
  if (!sharedManager) {
    throw new Error("Shared memory manager is not available.");
  }
  if (sharedManager === input.manager) {
    throw new Error("Shared review is not available inside the shared memory resident.");
  }

  const contexts = resolvePromotionContexts({
    manager: input.manager,
    sharedManager,
    agentId: input.agentId,
    chunkId: input.chunkId,
    sourcePath: input.sourcePath,
  });
  const nextPrivateItems: MemorySearchResult[] = [];
  const nextSharedItems: MemorySearchResult[] = [];
  const note = typeof input.note === "string" ? input.note.trim() || undefined : undefined;

  for (const context of contexts) {
    assertReviewTransition(context.promotion.status, input.decision);
    assertClaimOwnershipForReview(context.promotion, input.agentId);

    const reviewedPromotion = buildReviewedPromotion(context.promotion, {
      decision: input.decision,
      reviewerAgentId: input.agentId,
      note,
    });

    const nextPrivateItem = context.privateItem
      ? upsertMemorySharedPromotion(input.manager, context.privateItem, reviewedPromotion, context.privateItem.visibility ?? "private")
      : null;
    const nextSharedItem = context.sharedItem
      ? upsertMemorySharedPromotion(sharedManager, context.sharedItem, reviewedPromotion, "shared")
      : null;
    if (nextPrivateItem) nextPrivateItems.push(nextPrivateItem);
    if (nextSharedItem) nextSharedItems.push(nextSharedItem);
  }

  return {
    decision: input.decision,
    reviewedCount: contexts.length,
    mode: typeof input.sourcePath === "string" && input.sourcePath.trim() ? "source" : "chunk",
    privateItem: nextPrivateItems[0] ?? null,
    sharedItem: nextSharedItems[0] ?? null,
    privateItems: nextPrivateItems,
    sharedItems: nextSharedItems,
  };
}

export function claimResidentSharedMemoryPromotion(input: {
  manager: MemoryManager;
  sharedManager?: MemoryManager | null;
  agentId: string;
  action: ResidentMemoryShareClaimAction;
  chunkId?: string;
  sourcePath?: string;
}): ResidentMemoryShareClaimResult {
  const sharedManager = input.sharedManager;
  if (!sharedManager) {
    throw new Error("Shared memory manager is not available.");
  }
  if (sharedManager === input.manager) {
    throw new Error("Shared claim is not available inside the shared memory resident.");
  }

  const contexts = resolvePromotionContexts({
    manager: input.manager,
    sharedManager,
    agentId: input.agentId,
    chunkId: input.chunkId,
    sourcePath: input.sourcePath,
  });
  const nextPrivateItems: MemorySearchResult[] = [];
  const nextSharedItems: MemorySearchResult[] = [];

  for (const context of contexts) {
    assertClaimTransition(context.promotion, input.action, input.agentId);
    const claimedPromotion = buildClaimedPromotion(context.promotion, {
      action: input.action,
      agentId: input.agentId,
    });
    const nextPrivateItem = context.privateItem
      ? upsertMemorySharedPromotion(input.manager, context.privateItem, claimedPromotion, context.privateItem.visibility ?? "private")
      : null;
    const nextSharedItem = context.sharedItem
      ? upsertMemorySharedPromotion(sharedManager, context.sharedItem, claimedPromotion, "shared")
      : null;
    if (nextPrivateItem) nextPrivateItems.push(nextPrivateItem);
    if (nextSharedItem) nextSharedItems.push(nextSharedItem);
  }

  return {
    action: input.action,
    claimedCount: contexts.length,
    mode: typeof input.sourcePath === "string" && input.sourcePath.trim() ? "source" : "chunk",
    privateItem: nextPrivateItems[0] ?? null,
    sharedItem: nextSharedItems[0] ?? null,
    privateItems: nextPrivateItems,
    sharedItems: nextSharedItems,
  };
}
