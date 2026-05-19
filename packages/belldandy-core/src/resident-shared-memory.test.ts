import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryManager } from "@belldandy/memory";

import type { ResolvedResidentMemoryPolicy } from "./resident-memory-policy.js";
import {
  claimResidentSharedMemoryPromotion,
  getResidentMemory,
  listRecentResidentMemory,
  mergeResidentMemoryStatus,
  promoteResidentMemoryToShared,
  reviewResidentSharedMemoryPromotion,
  searchResidentMemory,
} from "./resident-shared-memory.js";

const tempDirs: string[] = [];

async function createMemoryManager(name: string): Promise<MemoryManager> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `belldandy-${name}-`));
  tempDirs.push(root);
  return new MemoryManager({
    workspaceRoot: root,
    stateDir: root,
  });
}

function createHybridPolicy(privateDir: string, sharedDir: string): ResolvedResidentMemoryPolicy {
  return {
    agentId: "coder",
    workspaceDir: "coder",
    memoryMode: "hybrid",
    privateStateDir: privateDir,
    sharedStateDir: sharedDir,
    managerStateDir: privateDir,
    includeSharedMemoryReads: true,
    readTargets: ["private", "shared"],
    writeTarget: "private",
    summary: "Writes stay private; reads include both private memory and the shared team layer.",
  };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (!target) continue;
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
  }
});

describe("resident shared memory", () => {
  it("merges private and shared memory results for hybrid residents", async () => {
    const privateManager = await createMemoryManager("resident-private");
    const sharedManager = await createMemoryManager("resident-shared");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "private-chunk",
      sourcePath: "memory/private.md",
      sourceType: "manual",
      memoryType: "other",
      content: "hybrid search marker private branch",
      visibility: "private",
    });
    sharedManager.upsertMemoryChunk({
      id: "shared-chunk",
      sourcePath: "team-memory/shared.md",
      sourceType: "manual",
      memoryType: "other",
      content: "hybrid search marker shared branch",
      visibility: "shared",
    });

    const results = await searchResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      query: "hybrid search marker",
      limit: 10,
      includeContent: true,
    });
    expect(results.map((item) => item.id)).toEqual(expect.arrayContaining(["private-chunk", "shared-chunk"]));

    const recent = listRecentResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      limit: 10,
      includeContent: false,
    });
    expect(recent.map((item) => item.id)).toEqual(expect.arrayContaining(["private-chunk", "shared-chunk"]));

    const sharedItem = getResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      chunkId: "shared-chunk",
    });
    expect(sharedItem?.visibility).toBe("shared");

    const mergedStatus = mergeResidentMemoryStatus(privateManager.getStatus(), sharedManager.getStatus());
    expect(mergedStatus.chunks).toBe(2);
  });

  it("keeps score-aware ordering after private/shared hybrid merge", async () => {
    const privateManager = await createMemoryManager("resident-private-score");
    const sharedManager = await createMemoryManager("resident-shared-score");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "private-score-low",
      sourcePath: "memory/private-score.md",
      sourceType: "manual",
      memoryType: "other",
      content: "resident score smoke marker for gateway retry rollout",
      visibility: "private",
    });
    sharedManager.upsertMemoryChunk({
      id: "shared-score-high",
      sourcePath: "memory/shared-score.md",
      sourceType: "manual",
      memoryType: "other",
      content: "resident score smoke marker for gateway retry rollout",
      visibility: "shared",
    });

    (privateManager as any).store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:private-score-low",
        targetType: "chunk",
        targetId: "private-score-low",
        sourceId: "private:derived",
        scoreTotal: 0.2,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "derived" },
      },
    ]);
    (sharedManager as any).store.upsertMemoryScores([
      {
        id: "score:v1_rule_only:chunk:shared-score-high",
        targetType: "chunk",
        targetId: "shared-score-high",
        sourceId: "shared:curated",
        scoreTotal: 0.95,
        scoreVersion: "v1_rule_only",
        rationale: { sourceClass: "curated" },
      },
    ]);

    const results = await searchResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      query: "resident score smoke marker gateway retry rollout",
      limit: 10,
      includeContent: false,
    });

    expect(results.map((item) => item.id)).toEqual(expect.arrayContaining(["private-score-low", "shared-score-high"]));
    expect(results[0]).toMatchObject({
      id: "shared-score-high",
      metadata: {
        memoryTree: expect.objectContaining({
          scoreVersion: "v1_rule_only",
          sourceClass: "curated",
        }),
      },
    });
  });

  it("keeps shared chunks queryable on a unified non-resident memory surface", async () => {
    const manager = await createMemoryManager("viewer-unified");

    manager.upsertMemoryChunk({
      id: "private-viewer-chunk",
      sourcePath: "memory/private-viewer.md",
      sourceType: "manual",
      memoryType: "other",
      content: "viewer private marker",
      visibility: "private",
    });
    manager.upsertMemoryChunk({
      id: "shared-viewer-chunk",
      sourcePath: "memory/shared-viewer.md",
      sourceType: "manual",
      memoryType: "other",
      content: "viewer topic marker",
      topic: "viewer-audit",
      visibility: "shared",
    });

    const recentShared = listRecentResidentMemory({
      manager,
      limit: 10,
      filter: { scope: "shared", topic: "viewer-audit" },
      includeContent: false,
    });
    expect(recentShared.map((item) => item.id)).toEqual(["shared-viewer-chunk"]);

    const recentAll = listRecentResidentMemory({
      manager,
      limit: 10,
      includeContent: false,
    });
    expect(recentAll.map((item) => item.id)).toEqual(expect.arrayContaining(["private-viewer-chunk", "shared-viewer-chunk"]));
  });

  it("creates a pending shared promotion first and only exposes it after approval", async () => {
    const privateManager = await createMemoryManager("promote-private");
    const sharedManager = await createMemoryManager("promote-shared");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "private-promote-chunk",
      sourcePath: "memory/private-promote.md",
      sourceType: "manual",
      memoryType: "other",
      content: "share promotion candidate marker",
      category: "decision",
      visibility: "private",
      metadata: {
        original: true,
      },
    });

    const promoted = promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      chunkId: "private-promote-chunk",
      reason: "cross-agent reuse",
    });

    expect(promoted.promotedCount).toBe(1);
    expect(promoted.item?.visibility).toBe("shared");
    expect(promoted.item?.metadata?.sharedPromotion).toMatchObject({
      kind: "manual",
      status: "pending",
      sourceAgentId: "coder",
      sourceChunkId: "private-promote-chunk",
      reason: "cross-agent reuse",
    });
    expect(privateManager.getMemory("private-promote-chunk")?.visibility).toBe("private");
    expect(privateManager.countChunks({ sharedPromotionStatus: "pending" })).toBe(1);
    expect(privateManager.countChunks({ sharedPromotionStatus: "approved" })).toBe(0);

    const sharedChunkId = String(promoted.item?.id || "");
    expect(sharedChunkId).toBeTruthy();

    const hiddenShared = getResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      chunkId: sharedChunkId,
    });
    expect(hiddenShared).toBeNull();

    const hiddenSearch = await searchResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      query: "share promotion candidate marker",
      limit: 10,
      filter: { scope: "shared" },
      includeContent: true,
    });
    expect(hiddenSearch).toHaveLength(0);

    const approved = reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      chunkId: "private-promote-chunk",
      decision: "approved",
      note: "looks reusable",
    });
    expect(approved.privateItem?.metadata?.sharedPromotion).toMatchObject({
      status: "approved",
      reviewerAgentId: "reviewer",
      decisionNote: "looks reusable",
    });
    expect(approved.sharedItem?.metadata?.sharedPromotion).toMatchObject({
      status: "approved",
      reviewerAgentId: "reviewer",
      decisionNote: "looks reusable",
    });
    expect(privateManager.countChunks({ sharedPromotionStatus: "pending" })).toBe(0);
    expect(privateManager.countChunks({ sharedPromotionStatus: "approved" })).toBe(1);

    const visibleShared = getResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      chunkId: sharedChunkId,
    });
    expect(visibleShared?.visibility).toBe("shared");

    const visibleSearch = await searchResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      query: "share promotion candidate marker",
      limit: 10,
      filter: { scope: "shared" },
      includeContent: true,
    });
    expect(visibleSearch.map((item) => item.id)).toContain(sharedChunkId);
  });

  it("supports rejecting and revoking shared promotions", async () => {
    const privateManager = await createMemoryManager("review-private");
    const sharedManager = await createMemoryManager("review-shared");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "reject-chunk",
      sourcePath: "memory/reject.md",
      sourceType: "manual",
      memoryType: "other",
      content: "reject me",
      visibility: "private",
    });
    privateManager.upsertMemoryChunk({
      id: "revoke-chunk",
      sourcePath: "memory/revoke.md",
      sourceType: "manual",
      memoryType: "other",
      content: "revoke me",
      visibility: "private",
    });

    const rejectedPromotion = promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      chunkId: "reject-chunk",
      reason: "candidate for rejection",
    });
    reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      chunkId: "reject-chunk",
      decision: "rejected",
      note: "not general enough",
    });
    expect(privateManager.getMemory("reject-chunk")?.metadata?.sharedPromotion).toMatchObject({
      status: "rejected",
      reviewerAgentId: "reviewer",
      decisionNote: "not general enough",
    });
    expect(privateManager.countChunks({ sharedPromotionStatus: "rejected" })).toBe(1);
    expect(getResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      chunkId: String(rejectedPromotion.item?.id || ""),
    })).toBeNull();

    const approvedPromotion = promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      chunkId: "revoke-chunk",
      reason: "candidate for revoke",
    });
    reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      chunkId: "revoke-chunk",
      decision: "approved",
      note: "approved first",
    });
    const revoked = reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer-2",
      chunkId: "revoke-chunk",
      decision: "revoked",
      note: "stale shared memory",
    });
    expect(revoked.privateItem?.metadata?.sharedPromotion).toMatchObject({
      status: "revoked",
      reviewerAgentId: "reviewer-2",
      revokedByAgentId: "reviewer-2",
      decisionNote: "stale shared memory",
    });
    expect(revoked.sharedItem?.metadata?.sharedPromotion).toMatchObject({
      status: "revoked",
      reviewerAgentId: "reviewer-2",
      revokedByAgentId: "reviewer-2",
      decisionNote: "stale shared memory",
    });
    expect(privateManager.countChunks({ sharedPromotionStatus: "revoked" })).toBe(1);

    const sharedRecent = listRecentResidentMemory({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      limit: 10,
      filter: { scope: "shared" },
      includeContent: false,
    });
    expect(sharedRecent.map((item) => item.id)).not.toContain(String(rejectedPromotion.item?.id || ""));
    expect(sharedRecent.map((item) => item.id)).not.toContain(String(approvedPromotion.item?.id || ""));
  });

  it("supports claim and release for pending shared promotions", async () => {
    const privateManager = await createMemoryManager("claim-private");
    const sharedManager = await createMemoryManager("claim-shared");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "claim-chunk",
      sourcePath: "memory/claim.md",
      sourceType: "manual",
      memoryType: "other",
      content: "claim me",
      visibility: "private",
    });

    promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      chunkId: "claim-chunk",
      reason: "claim smoke",
    });

    const claimed = claimResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      action: "claim",
      chunkId: "claim-chunk",
    });
    expect(claimed.claimedCount).toBe(1);
    expect(claimed.privateItem?.metadata?.sharedPromotion).toMatchObject({
      status: "pending",
      claimedByAgentId: "reviewer",
    });
    expect(claimed.sharedItem?.metadata?.sharedPromotion).toMatchObject({
      status: "pending",
      claimedByAgentId: "reviewer",
    });
    expect(privateManager.countChunks({ sharedPromotionStatus: "pending", sharedPromotionClaimed: true })).toBe(1);

    const released = claimResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      action: "release",
      chunkId: "claim-chunk",
    });
    expect(released.privateItem?.metadata?.sharedPromotion).toMatchObject({
      status: "pending",
    });
    expect(released.privateItem?.metadata?.sharedPromotion?.claimedByAgentId).toBeUndefined();
    expect(privateManager.countChunks({ sharedPromotionStatus: "pending", sharedPromotionClaimed: true })).toBe(0);
  });

  it("blocks review from other reviewers after a pending promotion is claimed", async () => {
    const privateManager = await createMemoryManager("claim-guard-private");
    const sharedManager = await createMemoryManager("claim-guard-shared");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "claim-guard-chunk",
      sourcePath: "memory/claim-guard.md",
      sourceType: "manual",
      memoryType: "other",
      content: "claim guard",
      visibility: "private",
    });

    promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      chunkId: "claim-guard-chunk",
      reason: "claim guard smoke",
    });
    claimResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer-a",
      action: "claim",
      chunkId: "claim-guard-chunk",
    });

    expect(() => reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer-b",
      chunkId: "claim-guard-chunk",
      decision: "approved",
    })).toThrow(/claimed by reviewer-a/i);
  });

  it("supports batch review by sourcePath", async () => {
    const privateManager = await createMemoryManager("batch-private");
    const sharedManager = await createMemoryManager("batch-shared");
    const policy = createHybridPolicy("private", "shared");

    privateManager.upsertMemoryChunk({
      id: "batch-approve-1",
      sourcePath: "memory/group-approve.md",
      sourceType: "manual",
      memoryType: "other",
      content: "batch approve 1",
      visibility: "private",
    });
    privateManager.upsertMemoryChunk({
      id: "batch-approve-2",
      sourcePath: "memory/group-approve.md",
      sourceType: "manual",
      memoryType: "other",
      content: "batch approve 2",
      visibility: "private",
    });
    privateManager.upsertMemoryChunk({
      id: "batch-reject-1",
      sourcePath: "memory/group-reject.md",
      sourceType: "manual",
      memoryType: "other",
      content: "batch reject 1",
      visibility: "private",
    });
    privateManager.upsertMemoryChunk({
      id: "batch-reject-2",
      sourcePath: "memory/group-reject.md",
      sourceType: "manual",
      memoryType: "other",
      content: "batch reject 2",
      visibility: "private",
    });

    const approvePromoted = promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      sourcePath: "memory/group-approve.md",
      reason: "batch approve",
    });
    expect(approvePromoted.promotedCount).toBe(2);

    claimResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      action: "claim",
      sourcePath: "memory/group-approve.md",
    });
    const approved = reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      sourcePath: "memory/group-approve.md",
      decision: "approved",
      note: "batch approve",
    });
    expect(approved.mode).toBe("source");
    expect(approved.reviewedCount).toBe(2);
    expect(privateManager.countChunks({ sharedPromotionStatus: "approved" })).toBe(2);

    const rejectPromoted = promoteResidentMemoryToShared({
      manager: privateManager,
      sharedManager,
      residentPolicy: policy,
      agentId: "coder",
      sourcePath: "memory/group-reject.md",
      reason: "batch reject",
    });
    expect(rejectPromoted.promotedCount).toBe(2);
    const rejected = reviewResidentSharedMemoryPromotion({
      manager: privateManager,
      sharedManager,
      agentId: "reviewer",
      sourcePath: "memory/group-reject.md",
      decision: "rejected",
      note: "batch reject",
    });
    expect(rejected.mode).toBe("source");
    expect(rejected.reviewedCount).toBe(2);
    expect(privateManager.countChunks({ sharedPromotionStatus: "rejected" })).toBe(2);
  });
});
