import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";

const memoryManager = {
  getTaskByConversation: vi.fn(),
  listExperienceUsages: vi.fn(),
};

vi.mock("@belldandy/memory", () => ({
  getGlobalMemoryManager: () => memoryManager,
}));

const { buildCapabilityPlanSaveInput, collectCapabilityPlanActualUsage } = await import("./capability-plan-utils.js");

describe("capability-plan-utils", () => {
  it("collectCapabilityPlanActualUsage should aggregate methods, skills, mcp and tool names", () => {
    memoryManager.getTaskByConversation.mockReturnValue({
      id: "task_1",
      updatedAt: "2026-03-20T12:00:00.000Z",
      toolCalls: [
        { toolName: "mcp_docs_search" },
        { toolName: "skill_execute" },
        { toolName: "mcp_docs_lookup" },
        { toolName: "mcp_canvas_open" },
      ],
    });
    memoryManager.listExperienceUsages.mockReturnValue([
      { assetType: "method", assetKey: "Refactor-Plan.md" },
      { assetType: "skill", assetKey: "find-skills" },
      { assetType: "skill", assetKey: "find-skills" },
      { assetType: "method", assetKey: "Deploy-Checklist.md" },
    ]);

    const context = {
      conversationId: "goal:goal_alpha",
      workspaceRoot: "E:/project/star-sanctuary",
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 30_000,
        maxResponseBytes: 512_000,
      },
    } satisfies ToolContext;

    expect(collectCapabilityPlanActualUsage(context)).toEqual({
      methods: ["Refactor-Plan.md", "Deploy-Checklist.md"],
      skills: ["find-skills"],
      mcpServers: ["docs", "canvas"],
      toolNames: ["mcp_docs_search", "skill_execute", "mcp_docs_lookup", "mcp_canvas_open"],
      updatedAt: "2026-03-20T12:00:00.000Z",
    });
  });

  it("buildCapabilityPlanSaveInput should preserve plan and apply patches", () => {
    const input = buildCapabilityPlanSaveInput({
      id: "plan_1",
      goalId: "goal_alpha",
      nodeId: "node_root",
      runId: "run_1",
      status: "planned",
      executionMode: "multi_agent",
      governanceMode: "commander",
      commanderAgentId: "commander-1",
      preferredAgents: ["commander-1", "coder"],
      riskLevel: "high",
      objective: "Deploy Root Node",
      summary: "Need gated execution",
      queryHints: ["deploy"],
      reasoning: ["Deployment requires approval"],
      methods: [{ file: "Deploy-Checklist.md", title: "Deploy Checklist", score: 30 }],
      skills: [{ name: "find-skills", score: 10 }],
      mcpServers: [{ serverId: "docs", status: "connected", toolCount: 3 }],
      subAgents: [{ agentId: "coder", role: "coder", objective: "Implement Root Node", deliverable: "code patch", handoffToVerifier: true }],
      gaps: [],
      checkpoint: {
        required: true,
        reasons: ["涉及部署/上线/发布。"],
        approvalMode: "strict",
        requiredRequestFields: ["reviewerRole", "slaAt", "note"],
        requiredDecisionFields: ["summary", "note", "decidedBy"],
        suggestedTitle: "High-risk execution checkpoint",
        suggestedReviewerRole: "producer",
        suggestedSlaHours: 12,
        escalationMode: "manual",
      },
      actualUsage: { methods: [], skills: [], mcpServers: [], toolNames: [] },
      analysis: {
        status: "pending",
        summary: "尚未记录实际 usage，待执行后再比较计划与实际偏差。",
        deviations: [],
        recommendations: [],
      },
      generatedAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    }, {
      status: "orchestrated",
      runId: "run_2",
      actualUsage: {
        methods: ["Deploy-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["mcp_docs_search"],
        updatedAt: "2026-03-20T12:00:00.000Z",
      },
      orchestration: {
        claimed: true,
        delegated: false,
        delegationCount: 0,
        finalApprovalMode: "user_required",
        reworkRevisionCount: 2,
        lastReworkReason: "Need fix before close",
        lastReworkAt: "2026-03-20T12:00:00.000Z",
        coordinationPlan: {
          summary: "按 1 路分工推进，并以 verifier_handoff 收口。",
          plannedDelegationCount: 1,
          rolePolicy: {
            selectedRoles: ["coder"],
            selectionReasons: ["test"],
            verifierRole: "verifier",
            fanInStrategy: "verifier_handoff",
          },
        },
        delegationResults: [{
          agentId: "coder",
          role: "coder",
          status: "skipped",
          summary: "checkpoint requested",
        }],
        verifierHandoff: {
          status: "pending",
          verifierRole: "verifier",
          summary: "等待 checkpoint 通过后再进入 verifier 收口。",
          sourceAgentIds: ["coder"],
        },
        verifierResult: {
          status: "pending",
          summary: "等待 checkpoint 通过后再进入 verifier 收口。",
          findings: [],
          recommendation: "unknown",
          evidenceTaskIds: ["task_coder_1"],
          generatedAt: "2026-03-20T12:00:01.000Z",
        },
        notes: ["checkpoint requested"],
      },
      orchestratedAt: "2026-03-20T12:00:01.000Z",
    });

    expect(input).toMatchObject({
      id: "plan_1",
      runId: "run_2",
      status: "orchestrated",
      executionMode: "multi_agent",
      governanceMode: "commander",
      commanderAgentId: "commander-1",
      preferredAgents: ["commander-1", "coder"],
      riskLevel: "high",
      checkpoint: {
        required: true,
        reasons: ["涉及部署/上线/发布。"],
      },
      actualUsage: {
        methods: ["Deploy-Checklist.md"],
        skills: ["find-skills"],
        mcpServers: ["docs"],
        toolNames: ["mcp_docs_search"],
      },
      orchestration: {
        claimed: true,
        delegated: false,
        delegationCount: 0,
        finalApprovalMode: "user_required",
        reworkRevisionCount: 2,
        lastReworkReason: "Need fix before close",
        lastReworkAt: "2026-03-20T12:00:00.000Z",
        coordinationPlan: {
          rolePolicy: {
            fanInStrategy: "verifier_handoff",
          },
        },
        verifierHandoff: {
          status: "pending",
        },
        verifierResult: {
          status: "pending",
          recommendation: "unknown",
        },
      },
      orchestratedAt: "2026-03-20T12:00:01.000Z",
    });
  });
});
