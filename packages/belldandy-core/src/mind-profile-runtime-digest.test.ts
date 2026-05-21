import { describe, expect, it } from "vitest";

import { buildMindProfileRuntimeDigest } from "./mind-profile-runtime-digest.js";

describe("buildMindProfileRuntimeDigest", () => {
  it("projects a compact runtime digest from the existing mind snapshot", () => {
    const digest = buildMindProfileRuntimeDigest({
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
        summaryLineCount: 4,
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: true,
      },
      identity: {
        userName: "小星",
        userAvatar: "🌟",
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: true,
      },
      conversation: {
        activeResidentCount: 1,
        digestReadyCount: 1,
        digestUpdatedCount: 1,
        topResidents: [{
          agentId: "default",
          displayName: "Belldandy",
          pendingMessageCount: 2,
          headline: "Belldandy: status=running, digest=updated, pending=2",
        }],
      },
      memory: {
        privateMemoryCount: 2,
        sharedMemoryCount: 1,
        privateSummary: "private 2 chunk(s)",
        sharedSummary: "shared 1 chunk(s)",
        recentMemorySnippets: [
          { scope: "private", sourcePath: "MEMORY.md", text: "用户偏好简洁状态表与短结论。" },
          { scope: "shared", sourcePath: "team-memory/MEMORY.md", text: "共享约定：外发统一显式带 sessionKey。" },
        ],
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
        headline: "Profile tree: 长期偏好简洁状态表与直接结论, evidence=2",
        summaryLines: ["USER.md: 喜欢简洁状态表与直接结论。"],
        treeSummaryLines: ["Profile tree: 长期偏好简洁状态表与直接结论, evidence=2"],
      },
    } as any, {
      maxLines: 4,
      maxLineLength: 96,
      maxChars: 260,
    });

    expect(digest.summary).toMatchObject({
      available: true,
      lineCount: 4,
      signalCount: 4,
    });
    expect(digest.lines.join("\n")).toContain("User anchor:");
    expect(digest.lines.join("\n")).toContain("Profile anchor: Profile tree:");
    expect(digest.lines.join("\n")).toContain("Durable memory:");
    expect(digest.lines.join("\n")).toContain("Residents:");
    expect(digest.summary.charCount).toBeLessThanOrEqual(260);
    expect(digest.lines.every((line) => line.length <= 96)).toBe(true);
  });

  it("respects line and char budgets while degrading gracefully", () => {
    const digest = buildMindProfileRuntimeDigest({
      summary: {
        available: true,
        selectedAgentId: "default",
        headline: "headline",
        activeResidentCount: 0,
        digestReadyCount: 0,
        digestUpdatedCount: 0,
        usageLinkedCount: 1,
        privateMemoryCount: 3,
        sharedMemoryCount: 2,
        summaryLineCount: 3,
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: true,
      },
      identity: {
        userName: "小星小星小星小星小星小星小星小星小星",
        hasUserProfile: true,
        hasPrivateMemoryFile: true,
        hasSharedMemoryFile: true,
      },
      conversation: {
        activeResidentCount: 0,
        digestReadyCount: 0,
        digestUpdatedCount: 0,
        topResidents: [],
      },
      memory: {
        privateMemoryCount: 3,
        sharedMemoryCount: 2,
        privateSummary: "",
        sharedSummary: "",
        recentMemorySnippets: [
          { scope: "private", sourcePath: "MEMORY.md", text: "这是一段非常长的长期记忆摘要，用来验证预算裁剪是否稳定，而且不应突破总字符限制。" },
        ],
      },
      experience: {
        usageLinkedCount: 1,
        topUsageResidents: [{
          agentId: "default",
          displayName: "Belldandy",
          usageCount: 9,
          headline: "Belldandy: usage=9, methods=5, skills=4, latest=extremely-long-latest-asset-key-for-budget-check",
        }],
      },
      profile: {
        headline: "Profile tree: 喜欢简明输出, evidence=1",
        summaryLines: ["USER.md: 喜欢简明输出。"],
        treeSummaryLines: ["Profile tree: 喜欢简明输出, evidence=1"],
      },
    } as any, {
      maxLines: 2,
      maxLineLength: 48,
      maxChars: 90,
    });

    expect(digest.summary.available).toBe(true);
    expect(digest.summary.lineCount).toBeLessThanOrEqual(2);
    expect(digest.summary.charCount).toBeLessThanOrEqual(90);
    expect(digest.lines.every((line) => line.length <= 48)).toBe(true);
  });
});
