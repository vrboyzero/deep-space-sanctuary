import { describe, expect, it } from "vitest";

import { buildGoalCapabilityPlan } from "./capability-planner.js";

describe("buildGoalCapabilityPlan", () => {
  it("prefers agent catalog defaults when selecting sub-agents", () => {
    const plan = buildGoalCapabilityPlan({
      goalTitle: "Release guardrails",
      nodeId: "node-1",
      nodeTitle: "实现上线前校验并补回归验收",
      nodeDescription: "需要编码实现、补充验证，并在上线前收口风险。",
      availableAgents: [
        {
          id: "ops-coder",
          kind: "resident",
          catalog: {
            defaultRole: "coder",
            defaultPermissionMode: "confirm",
            defaultAllowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
            defaultMaxToolRiskLevel: "high",
            whenToUse: ["实现上线前校验", "需要改代码"],
            skills: ["repo-map"],
            handoffStyle: "summary",
          },
        },
        {
          id: "audit-verifier",
          kind: "worker",
          catalog: {
            defaultRole: "verifier",
            defaultPermissionMode: "confirm",
            whenToUse: ["补回归验收", "风险收口"],
            skills: ["review-checklist"],
            handoffStyle: "structured",
          },
        },
      ],
      forceMode: "multi_agent_parallel",
    });

    expect(plan.executionMode).toBe("multi_agent_parallel");
    expect(plan.governanceMode).toBe("commander");
    expect(plan.orchestration?.coordinationPlan?.rolePolicy.fanInStrategy).toBe("commander_review");
    expect(plan.commanderAgentId).toBe("ops-coder");
    expect(plan.preferredAgents).toEqual([]);
    expect(plan.orchestration?.finalApprovalMode).toBe("user_required");
    expect(plan.subAgents ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: "ops-coder",
        role: "coder",
      }),
      expect.objectContaining({
        agentId: "audit-verifier",
        role: "verifier",
      }),
    ]));
    expect(plan.reasoning).toEqual(expect.arrayContaining([
      expect.stringContaining("agent catalog"),
      expect.stringContaining("checkpoint"),
    ]));
    expect((plan.subAgents ?? []).find((item) => item.agentId === "ops-coder")?.reason).toContain("catalog defaultRole=coder");
    expect((plan.subAgents ?? []).find((item) => item.agentId === "audit-verifier")?.reason).toContain("catalog handoff=structured");
    expect((plan.subAgents ?? []).find((item) => item.agentId === "ops-coder")?.catalogDefault).toMatchObject({
      permissionMode: "confirm",
      allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
      maxToolRiskLevel: "high",
      handoffStyle: "summary",
    });
    expect(plan.checkpoint?.suggestedNote).toContain("catalog default");
    expect(plan.checkpoint?.suggestedNote).toContain("ops-coder(coder)");
  });

  it("respects preferredAgents and direct governance for low-risk focused work", () => {
    const plan = buildGoalCapabilityPlan({
      goalTitle: "Small patch",
      nodeId: "node-2",
      nodeTitle: "修复单点文案",
      nodeDescription: "局部调整，不需要额外收口。",
      availableAgentIds: ["preferred-main", "backup-main"],
      preferredAgents: ["preferred-main"],
      forceMode: "single_agent",
    });

    expect(plan.executionMode).toBe("single_agent");
    expect(plan.governanceMode).toBe("direct");
    expect(plan.commanderAgentId).toBeUndefined();
    expect(plan.preferredAgents).toEqual(["preferred-main", "backup-main"]);
    expect(plan.orchestration?.coordinationPlan?.rolePolicy.fanInStrategy).toBe("main_agent_summary");
  });

  it("defaults low-risk commander plans to agent auto completion", () => {
    const plan = buildGoalCapabilityPlan({
      goalTitle: "Lightweight commander node",
      nodeId: "node-3",
      nodeTitle: "拆成两路做低风险整理",
      nodeDescription: "需要简单分工，但不需要额外人工验收。",
      availableAgentIds: ["commander", "coder"],
      forceMode: "multi_agent_parallel",
    });

    expect(plan.governanceMode).toBe("commander");
    expect(plan.riskLevel).toBe("low");
    expect(plan.checkpoint?.required).toBe(false);
    expect(plan.orchestration?.finalApprovalMode).toBe("agent_auto_complete");
  });
});
