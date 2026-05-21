import { describe, expect, it } from "vitest";

import { buildLearningReviewInput } from "./learning-review-input.js";

describe("buildLearningReviewInput", () => {
  it("builds compact learning/review guidance from mind snapshot, candidate, and governance summary", () => {
    const result = buildLearningReviewInput({
      mindProfileSnapshot: {
        summary: {
          available: true,
          selectedAgentId: "default",
          headline: "user ready, private 2, shared 1, digest 1/1, usage 1",
          activeResidentCount: 1,
          digestReadyCount: 1,
          digestUpdatedCount: 1,
          usageLinkedCount: 1,
          privateMemoryCount: 2,
          sharedMemoryCount: 1,
          summaryLineCount: 3,
          hasUserProfile: true,
          hasPrivateMemoryFile: true,
          hasSharedMemoryFile: true,
        },
        identity: {
          userName: "小星",
          hasUserProfile: true,
          hasPrivateMemoryFile: true,
          hasSharedMemoryFile: true,
        },
        conversation: {
          activeResidentCount: 1,
          digestReadyCount: 1,
          digestUpdatedCount: 1,
          topResidents: [],
        },
        memory: {
          privateMemoryCount: 2,
          sharedMemoryCount: 1,
          privateSummary: "private 2 chunk(s)",
          sharedSummary: "shared 1 chunk(s)",
          recentMemorySnippets: [],
        },
        experience: {
          usageLinkedCount: 1,
          topUsageResidents: [{
            agentId: "default",
            displayName: "Belldandy",
            usageCount: 3,
            headline: "Belldandy: usage=3, methods=2, skills=1, latest=send-channel-message",
          }],
        },
        profile: {
          headline: "Profile tree: 长期偏好简洁状态表与短结论, evidence=2",
          summaryLines: ["USER.md: 喜欢简洁状态表与短结论。"],
          treeSummaryLines: ["Profile tree: 长期偏好简洁状态表与短结论, evidence=2"],
        },
      },
      experienceCandidate: {
        id: "exp_123",
        taskId: "task-1",
        type: "method",
        status: "draft",
        title: "收口方法候选",
        slug: "method-a",
        content: "draft",
        summary: "把关键步骤与验收口径收敛到方法候选。",
        sourceTaskSnapshot: {
          taskId: "task-1",
          conversationId: "conv-1",
          source: "chat",
          status: "success",
          summary: "done",
          toolCalls: [{ toolName: "memory_search", success: true, durationMs: 10 }],
          artifactPaths: ["docs/a.md"],
          memoryLinks: [{ chunkId: "mem-1", relation: "used" }],
          startedAt: "2026-04-09T00:00:00.000Z",
        },
        createdAt: "2026-04-09T00:00:00.000Z",
      } as any,
      goalReviewGovernanceSummary: {
        reviewStatusCounts: {
          pending_review: 2,
          accepted: 1,
          rejected: 0,
          deferred: 0,
          needs_revision: 1,
        },
        workflowOverdueCount: 1,
        actionableReviews: [
          { status: "accepted" },
          { status: "pending_review" },
        ],
        recommendations: ["优先处理待审阅 suggestion：method candidate A"],
      } as any,
    });

    expect(result.summary).toMatchObject({
      available: true,
      memorySignalCount: 4,
      candidateSignalCount: 4,
      reviewSignalCount: 4,
    });
    expect(result.summaryLines.join("\n")).toContain("Mind snapshot:");
    expect(result.summaryLines.join("\n")).toContain("Profile anchor: Profile tree:");
    expect(result.summaryLines.join("\n")).toContain("method candidate:");
    expect(result.summaryLines.join("\n")).toContain("Review queue:");
    expect(result.nudges.join("\n")).toContain("存在超 SLA suggestion review");
    expect(result.nudges.join("\n")).toContain("存在已通过但未发布的 suggestion");
  });
});
