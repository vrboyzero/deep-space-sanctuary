import { describe, expect, it } from "vitest";

import { buildAgentLaunchExplainability } from "./agent-launch-explainability.js";

describe("agent launch explainability", () => {
  it("projects catalog defaults into effective launch when no runtime launch exists", () => {
    const explainability = buildAgentLaunchExplainability({
      agentId: "coder",
      profileId: "coder",
      catalog: {
        defaultRole: "coder",
        defaultPermissionMode: "confirm",
        defaultAllowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        defaultMaxToolRiskLevel: "high",
        handoffStyle: "structured",
        methods: ["Review-Checklist.md"],
        skills: ["repo-map"],
        whenToUse: ["需要改代码"],
      },
    });

    expect(explainability).toMatchObject({
      catalogDefault: {
        role: "coder",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        maxToolRiskLevel: "high",
        handoffStyle: "structured",
        methods: ["Review-Checklist.md"],
        skills: ["repo-map"],
        whenToUse: ["需要改代码"],
      },
      effectiveLaunch: {
        source: "catalog_default",
        agentId: "coder",
        profileId: "coder",
        role: "coder",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "workspace-write", "patch"],
        maxToolRiskLevel: "high",
        handoffStyle: "structured",
        policySummary: null,
      },
      delegationReason: null,
    });
  });

  it("keeps runtime launch and delegation reason separate from catalog defaults", () => {
    const explainability = buildAgentLaunchExplainability({
      agentId: "researcher",
      profileId: "researcher",
      catalog: {
        defaultRole: "researcher",
        defaultPermissionMode: "plan",
        defaultAllowedToolFamilies: ["network-read", "workspace-read"],
        defaultMaxToolRiskLevel: "medium",
        handoffStyle: "summary",
        methods: [],
        skills: [],
        whenToUse: [],
      },
      launchSpec: {
        agentId: "researcher",
        profileId: "researcher",
        role: "researcher",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "browser"],
        maxToolRiskLevel: "high",
        policySummary: "permission=confirm, browser enabled",
        delegation: {
          source: "delegate_parallel",
          intentKind: "parallel_subtasks",
          intentSummary: "Collect references",
          expectedDeliverableSummary: "Return notes",
          aggregationMode: "parallel_collect",
          contextKeys: ["goalId", "topic"],
          sourceAgentIds: ["planner", "resident-a"],
        },
      },
    });

    expect(explainability).toMatchObject({
      catalogDefault: {
        role: "researcher",
        permissionMode: "plan",
        allowedToolFamilies: ["network-read", "workspace-read"],
        maxToolRiskLevel: "medium",
      },
      effectiveLaunch: {
        source: "runtime_launch_spec",
        agentId: "researcher",
        profileId: "researcher",
        role: "researcher",
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "browser"],
        maxToolRiskLevel: "high",
        policySummary: "permission=confirm, browser enabled",
      },
      delegationReason: {
        source: "delegate_parallel",
        intentKind: "parallel_subtasks",
        intentSummary: "Collect references",
        expectedDeliverableSummary: "Return notes",
        aggregationMode: "parallel_collect",
        contextKeys: ["goalId", "topic"],
        sourceAgentIds: ["planner", "resident-a"],
      },
    });
  });
});
