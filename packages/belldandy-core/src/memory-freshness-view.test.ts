import { describe, expect, it } from "vitest";

import {
  buildGovernanceFreshnessFromGoalReview,
  buildMemoryFreshnessFromInventoryDoctorReport,
  buildProceduralExperienceFreshnessView,
  buildProfileSemanticFreshnessView,
} from "./memory-freshness-view.js";

describe("memory freshness view", () => {
  it("marks confirmed profile state as fresh", () => {
    const now = new Date().toISOString();
    const result = buildProfileSemanticFreshnessView({
      summary: {
        available: true,
        selectedAgentId: "default",
        headline: "profile available",
        activeResidentCount: 0,
        digestReadyCount: 0,
        digestUpdatedCount: 0,
        usageLinkedCount: 0,
        privateMemoryCount: 0,
        sharedMemoryCount: 0,
        summaryLineCount: 1,
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: false,
      },
      identity: {
        userName: "小星",
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: false,
      },
      conversation: {
        activeResidentCount: 0,
        digestReadyCount: 0,
        digestUpdatedCount: 0,
        topResidents: [],
      },
      memory: {
        privateMemoryCount: 0,
        sharedMemoryCount: 0,
        privateSummary: "private 0",
        sharedSummary: "shared 0",
        recentMemorySnippets: [],
      },
      experience: {
        usageLinkedCount: 0,
        topUsageResidents: [],
      },
      profile: {
        headline: "Profile tree",
        summaryLines: ["偏好简洁结论"],
        stateEntries: [{
          path: "preferences.response_style",
          valueText: "简洁结论",
          updatedAt: now,
          lastConfirmedAt: now,
        }],
      },
    });

    expect(result).toMatchObject({
      memoryClass: "profile_semantic",
      status: "fresh",
      lastConfirmedAt: now,
      freshnessHeadline: expect.stringContaining("最近一次确认"),
    });
    expect(result?.freshnessSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "profile_state_confirmed",
        severity: "info",
      }),
    ]));
  });

  it("marks synthesis-consumed candidate as superseded", () => {
    const result = buildProceduralExperienceFreshnessView({
      candidate: {
        id: "exp_old",
        taskId: "task-1",
        type: "method",
        status: "accepted",
        title: "旧方法候选",
        slug: "old-method",
        content: "draft",
        summary: "旧版本方法候选",
        acceptedAt: "2026-06-11T10:00:00.000Z",
        metadata: {
          synthesisConsumed: {
            consumed: true,
            consumedAt: "2026-06-11T12:00:00.000Z",
            consumedByCandidateId: "exp_new",
          },
        },
      } as any,
    });

    expect(result).toMatchObject({
      memoryClass: "procedural_experience",
      status: "superseded",
      supersededAt: "2026-06-11T12:00:00.000Z",
      freshnessHeadline: expect.stringContaining("替代"),
    });
    expect(result?.freshnessSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "candidate_synthesis_consumed",
        severity: "warn",
      }),
    ]));
  });

  it("derives project and governance freshness from inventory doctor report", () => {
    const result = buildMemoryFreshnessFromInventoryDoctorReport({
      generatedAt: "2026-06-11T12:00:00.000Z",
      headline: "inventory doctor",
      summary: {
        headline: "inventory summary",
        sourceKinds: 3,
        presentSourceKinds: 3,
        sourceFamilyCount: 4,
        multiMemberFamilyCount: 1,
        highRiskFamilyCount: 1,
        suggestedReviewFamilyCount: 1,
        suggestedKeepFamilyCount: 0,
        suggestedArchiveFamilyCount: 0,
        sourceDuplicateFamilyCount: 1,
        derivedOverlapFamilyCount: 0,
        searchableItemCount: 5,
        summaryInputOnlyItemCount: 1,
        inventoryOnlyItemCount: 0,
        searchPolicyExplanations: [],
        topHighRiskFamilies: [],
        topSuggestedFamilies: [],
      },
      checks: [],
    }, {
      nowMs: Date.parse("2026-06-11T12:00:00.000Z"),
    });

    expect(result.summary).toMatchObject({
      available: true,
      itemCount: 2,
      reviewRequiredCount: 2,
      headline: "project=review_required, governance=review_required",
    });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "project_semantic",
        status: "review_required",
      }),
      expect.objectContaining({
        memoryClass: "governance",
        status: "review_required",
      }),
    ]));
  });

  it("counts checkpoint approval pressure as governance freshness debt", () => {
    const result = buildGovernanceFreshnessFromGoalReview({
      generatedAt: "2026-06-12T12:00:00.000Z",
      actionableReviews: [],
      reviewStatusCounts: {
        pending_review: 0,
        accepted: 0,
        rejected: 0,
        deferred: 0,
        needs_revision: 0,
      },
      workflowPendingCount: 0,
      workflowOverdueCount: 0,
      checkpointWorkflowPendingCount: 2,
      checkpointWorkflowOverdueCount: 1,
    } as any, {
      nowMs: Date.parse("2026-06-12T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      memoryClass: "governance",
      status: "review_required",
      freshnessHeadline: "当前治理队列存在待收口项",
    });
    expect(result?.freshnessSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "governance_pending_checkpoint",
        severity: "warn",
      }),
      expect.objectContaining({
        code: "governance_overdue_checkpoint",
        severity: "warn",
      }),
    ]));
  });
});
