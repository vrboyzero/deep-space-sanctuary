import { describe, expect, it } from "vitest";

import { normalizeAgentLaunchSpec, normalizeAgentLaunchSpecWithCatalog } from "./launch-spec.js";

describe("normalizeAgentLaunchSpec", () => {
  it("normalizes per-run resource budgets for the canonical launch contract", () => {
    const spec = normalizeAgentLaunchSpec({
      instruction: "Run the bounded verification lane.",
      parentConversationId: "conv-budget",
      maxRunWallTimeMs: 12_345.9,
      toolLoopIterationBudget: 7.8,
      maxTotalTokens: 9_000.7,
      maxCostUsd: 0.42,
      maxHighRiskToolCalls: 0,
    });

    expect(spec).toMatchObject({
      maxRunWallTimeMs: 12_345,
      toolLoopIterationBudget: 7,
      maxTotalTokens: 9_000,
      maxCostUsd: 0.42,
      maxHighRiskToolCalls: 0,
    });
  });

  it("preserves the commander runtime role for a custom agent id", () => {
    const spec = normalizeAgentLaunchSpec({
      instruction: "Coordinate the delegated work and prepare the final decision.",
      parentConversationId: "conv-commander",
      agentId: "ops-coordinator",
      profileId: "ops-coordinator",
      role: "commander",
    });

    expect(spec.agentId).toBe("ops-coordinator");
    expect(spec.profileId).toBe("ops-coordinator");
    expect(spec.role).toBe("commander");
  });

  it("applies commander catalog defaults to a custom profile id", () => {
    const spec = normalizeAgentLaunchSpecWithCatalog({
      instruction: "Coordinate the delegated work and prepare the final decision.",
      parentConversationId: "conv-commander-catalog",
      agentId: "ops-coordinator",
      profileId: "ops-coordinator",
    }, {
      agentRegistry: {
        getProfile: (id: string) => id === "ops-coordinator"
          ? {
            id,
            defaultRole: "commander",
          } as any
          : undefined,
      },
    });

    expect(spec.role).toBe("commander");
    expect(spec.permissionMode).toBe("confirm");
    expect(spec.allowedToolFamilies).toEqual([
      "workspace-read",
      "browser",
      "memory",
      "goal-governance",
      "session-orchestration",
    ]);
  });

  it("normalizes structured delegation constraints for launch spec runtime visibility", () => {
    const spec = normalizeAgentLaunchSpec({
      instruction: "  Patch the failing bootstrap path.  ",
      parentConversationId: "  conv-1  ",
      agentId: "coder",
      delegationProtocol: {
        source: "delegate_task",
        intent: {
          kind: "ad_hoc",
          summary: "  Patch the failing bootstrap path.  ",
          role: "coder",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: [" goalId ", "goalId", " file "],
        },
        expectedDeliverable: {
          format: "patch",
          summary: "  Patch summary with proof.  ",
        },
        aggregationPolicy: {
          mode: "single",
          summarizeFailures: true,
          sourceAgentIds: [" coder ", "coder", " verifier "],
        },
        launchDefaults: {
          permissionMode: " confirm ",
          allowedToolFamilies: [" workspace-read ", "patch", "patch"] as any,
          maxToolRiskLevel: "high",
        },
        ownership: {
          scopeSummary: "  Gateway bootstrap only.  ",
          outOfScope: [" docs ", "docs", " ui "],
          writeScope: [" packages/belldandy-core/src/bin/gateway.ts ", "packages/belldandy-core/src/bin/gateway.ts"],
        },
        acceptance: {
          doneDefinition: "  Build stays green.  ",
          verificationHints: [" run targeted tests ", "run targeted tests", " inspect diff "],
        },
        deliverableContract: {
          format: "patch",
          summary: "  Patch plus verification notes.  ",
          requiredSections: [" Changes ", "Verification", "Changes"],
        },
        team: {
          id: " team-1 ",
          mode: "parallel_patch",
          sharedGoal: "  Coordinate the patch lanes.  ",
          managerAgentId: " default ",
          managerIdentityLabel: " 首席执行官 (CEO) ",
          currentLaneId: " lane_b ",
          memberRoster: [
            {
              laneId: " lane_a ",
              agentId: " coder ",
              role: "coder",
              identityLabel: " CTO ",
              authorityRelationToManager: " subordinate " as any,
              reportsTo: [" 首席执行官 (CEO) ", "首席执行官 (CEO)"],
              mayDirect: [" 员工 ", "员工"],
              scopeSummary: "  Own lane A  ",
              handoffTo: [" lane_b ", "lane_b"],
            },
            {
              laneId: " lane_b ",
              agentId: " verifier ",
              role: "verifier",
              identityLabel: " 项目经理 ",
              authorityRelationToManager: " subordinate " as any,
              scopeSummary: "  Review patch lanes  ",
              dependsOn: [" lane_a ", "lane_a"],
            },
          ],
        },
      },
    });

    expect(spec.instruction).toBe("Patch the failing bootstrap path.");
    expect(spec.parentConversationId).toBe("conv-1");
    expect(spec.delegationProtocol).toMatchObject({
      intent: {
        summary: "Patch the failing bootstrap path.",
      },
      contextPolicy: {
        contextKeys: ["goalId", "file"],
      },
      aggregationPolicy: {
        sourceAgentIds: ["coder", "verifier"],
      },
      launchDefaults: {
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "patch"],
        maxToolRiskLevel: "high",
      },
      ownership: {
        scopeSummary: "Gateway bootstrap only.",
        outOfScope: ["docs", "ui"],
        writeScope: ["packages/belldandy-core/src/bin/gateway.ts"],
      },
      acceptance: {
        doneDefinition: "Build stays green.",
        verificationHints: ["run targeted tests", "inspect diff"],
      },
      deliverableContract: {
        format: "patch",
        summary: "Patch plus verification notes.",
        requiredSections: ["Changes", "Verification"],
      },
      team: {
        id: "team-1",
        mode: "parallel_patch",
        sharedGoal: "Coordinate the patch lanes.",
        managerAgentId: "default",
        managerIdentityLabel: "首席执行官 (CEO)",
        currentLaneId: "lane_b",
        memberRoster: [
          {
            laneId: "lane_a",
            agentId: "coder",
            role: "coder",
            identityLabel: "CTO",
            authorityRelationToManager: "subordinate",
            reportsTo: ["首席执行官 (CEO)"],
            mayDirect: ["员工"],
            scopeSummary: "Own lane A",
            handoffTo: ["lane_b"],
          },
          {
            laneId: "lane_b",
            agentId: "verifier",
            role: "verifier",
            identityLabel: "项目经理",
            authorityRelationToManager: "subordinate",
            scopeSummary: "Review patch lanes",
            dependsOn: ["lane_a"],
          },
        ],
      },
    });
  });

  it("patches catalog launch defaults while preserving structured delegation constraints", () => {
    const spec = normalizeAgentLaunchSpecWithCatalog({
      instruction: "Verify the delegated patch.",
      parentConversationId: "conv-2",
      agentId: "verifier",
      delegationProtocol: {
        source: "goal_verifier",
        intent: {
          kind: "verifier_handoff",
          summary: "Verify the delegated patch.",
          role: "verifier",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: false,
          contextKeys: [],
        },
        expectedDeliverable: {
          format: "verification_report",
          summary: "Verifier summary.",
        },
        aggregationPolicy: {
          mode: "verifier_fan_in",
          summarizeFailures: true,
        },
        launchDefaults: {},
        ownership: {
          scopeSummary: "Verification only.",
        },
        acceptance: {
          doneDefinition: "Findings and release recommendation are explicit.",
        },
        deliverableContract: {
          format: "verification_report",
          requiredSections: ["Findings", "Evidence"],
        },
      },
    }, {
      agentRegistry: {
        getProfile: (id: string) => id === "verifier"
          ? {
            id: "verifier",
            defaultRole: "verifier",
            defaultPermissionMode: "confirm",
            defaultAllowedToolFamilies: ["workspace-read", "command-exec"],
            defaultMaxToolRiskLevel: "high",
          } as any
          : undefined,
      },
    });

    expect(spec.delegationProtocol?.launchDefaults).toEqual({
      permissionMode: "confirm",
      allowedToolFamilies: ["workspace-read", "command-exec"],
      maxToolRiskLevel: "high",
    });
    expect(spec.delegationProtocol?.ownership).toEqual({
      scopeSummary: "Verification only.",
    });
    expect(spec.delegationProtocol?.acceptance).toEqual({
      doneDefinition: "Findings and release recommendation are explicit.",
    });
    expect(spec.delegationProtocol?.deliverableContract).toEqual({
      format: "verification_report",
      summary: "Verifier summary.",
      requiredSections: ["Findings", "Evidence"],
    });
  });
});
