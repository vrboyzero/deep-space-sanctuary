import { describe, expect, it } from "vitest";

import type { ToolContext } from "./types.js";
import { buildSubAgentLaunchSpec } from "./subagent-launch.js";

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: "conv-main",
    workspaceRoot: "/tmp/workspace",
    defaultCwd: "/tmp/workspace",
    launchSpec: {
      cwd: "/tmp/workspace",
      permissionMode: "confirm",
      parentTaskId: "task-parent",
    },
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 30_000,
      maxResponseBytes: 512_000,
    },
    ...overrides,
  };
}

describe("buildSubAgentLaunchSpec delegation protocol", () => {
  it("threads the parent tool operation into the child launch without changing task content", () => {
    const spec = buildSubAgentLaunchSpec(createContext({
      agentRunId: "run-parent-1",
      toolCallId: "tool-parent-1",
    }), {
      instruction: "Inspect the child runtime binding.",
      channel: "subtask",
      delegationSource: "delegate_task",
    });

    expect(spec.parentOperation).toEqual({
      agentRunId: "run-parent-1",
      toolCallId: "tool-parent-1",
    });
  });

  it("builds ad-hoc protocol for delegate_task", () => {
    const spec = buildSubAgentLaunchSpec(createContext(), {
      instruction: "Patch the failing integration test and explain the fix",
      agentId: "coder",
      channel: "subtask",
      role: "coder",
      delegationSource: "delegate_task",
      context: { file: "packages/belldandy-core/src/server.ts" },
    });

    expect(spec.delegationProtocol).toMatchObject({
      source: "delegate_task",
      intent: {
        kind: "ad_hoc",
        role: "coder",
      },
      expectedDeliverable: {
        format: "patch",
      },
      aggregationPolicy: {
        mode: "single",
      },
      launchDefaults: {
        permissionMode: "confirm",
        maxToolRiskLevel: "high",
      },
    });
    expect(spec.delegationProtocol?.contextPolicy.contextKeys).toEqual(["file"]);
  });

  it("builds verifier fan-in protocol for goal verifier handoff", () => {
    const spec = buildSubAgentLaunchSpec(createContext(), {
      instruction: "Verify the delegated results and decide whether the node is ready to close",
      agentId: "verifier",
      channel: "goal",
      role: "verifier",
      delegationSource: "goal_verifier",
      goalId: "goal-1",
      nodeId: "node-2",
      planId: "plan-3",
      sourceAgentIds: ["coder", "researcher", "coder"],
      aggregationMode: "verifier_fan_in",
      expectedDeliverableSummary: "Verifier summary with findings and final decision.",
      context: {
        goalId: "goal-1",
        nodeId: "node-2",
        sourceTaskIds: ["task-1", "task-2"],
      },
    });

    expect(spec.delegationProtocol).toMatchObject({
      source: "goal_verifier",
      intent: {
        kind: "verifier_handoff",
        role: "verifier",
        goalId: "goal-1",
        nodeId: "node-2",
        planId: "plan-3",
      },
      expectedDeliverable: {
        format: "verification_report",
        summary: "Verifier summary with findings and final decision.",
      },
      aggregationPolicy: {
        mode: "verifier_fan_in",
        sourceAgentIds: ["coder", "researcher"],
      },
    });
  });

  it("keeps custom profile launches open for catalog defaults instead of forcing role defaults", () => {
    const spec = buildSubAgentLaunchSpec(createContext({ launchSpec: undefined }), {
      instruction: "Implement rollout guardrails",
      agentId: "ops-coder",
      channel: "goal",
      role: "coder",
      delegationSource: "goal_subtask",
    });

    expect(spec.permissionMode).toBeUndefined();
    expect(spec.allowedToolFamilies).toBeUndefined();
    expect(spec.maxToolRiskLevel).toBeUndefined();
    expect(spec.delegationProtocol?.launchDefaults).toEqual({
      permissionMode: undefined,
      allowedToolFamilies: undefined,
      maxToolRiskLevel: undefined,
    });
  });

  it("applies the commander capability envelope by runtime role", () => {
    const spec = buildSubAgentLaunchSpec(createContext({ launchSpec: undefined }), {
      instruction: "Coordinate the workers and return a consolidated decision.",
      agentId: "commander",
      channel: "goal",
      role: "commander",
    });

    expect(spec.permissionMode).toBe("confirm");
    expect(spec.allowedToolFamilies).toEqual([
      "workspace-read",
      "browser",
      "memory",
      "goal-governance",
      "session-orchestration",
    ]);
    expect(spec.maxToolRiskLevel).toBe("high");
  });

  it("wraps worker instructions with role and launch constraints", () => {
    const spec = buildSubAgentLaunchSpec(createContext(), {
      instruction: "Review the changed files and report the top risks.",
      agentId: "verifier",
      channel: "subtask",
      role: "verifier",
      expectedDeliverableSummary: "A short finding list with validation notes.",
      policySummary: "Prefer read-only checks.",
    });

    expect(spec.instruction).toContain("## Worker Base");
    expect(spec.instruction).toContain("## Worker Role (verifier)");
    expect(spec.instruction).toContain("## Task Envelope");
    expect(spec.instruction).toContain("Review the changed files and report the top risks.");
    expect(spec.instruction).toContain("Expected deliverable: A short finding list with validation notes.");
    expect(spec.instruction).toContain("## Launch Constraints");
    expect(spec.instruction).toContain("Permission mode: confirm");
    expect(spec.instruction).toContain("Policy summary: Prefer read-only checks.");
  });

  it("threads structured ownership, acceptance, and deliverable constraints into protocol and worker envelope", () => {
    const spec = buildSubAgentLaunchSpec(createContext(), {
      instruction: "Patch the server bootstrap and report what changed.",
      agentId: "coder",
      channel: "subtask",
      role: "coder",
      expectedDeliverableSummary: "Patch summary with verification notes.",
      ownership: {
        scopeSummary: "Own the gateway bootstrap wiring only.",
        outOfScope: ["UI polish", "database migrations"],
        writeScope: ["packages/belldandy-core/src/bin/gateway.ts"],
      },
      acceptance: {
        doneDefinition: "Gateway bootstrap change is implemented and build remains green.",
        verificationHints: ["Run targeted tests", "Run workspace build"],
      },
      deliverableContract: {
        format: "patch",
        requiredSections: ["Changes made", "Verification", "Residual risk"],
      },
    });

    expect(spec.delegationProtocol).toMatchObject({
      ownership: {
        scopeSummary: "Own the gateway bootstrap wiring only.",
        outOfScope: ["UI polish", "database migrations"],
        writeScope: ["packages/belldandy-core/src/bin/gateway.ts"],
      },
      acceptance: {
        doneDefinition: "Gateway bootstrap change is implemented and build remains green.",
        verificationHints: ["Run targeted tests", "Run workspace build"],
      },
      deliverableContract: {
        format: "patch",
        requiredSections: ["Changes made", "Verification", "Residual risk"],
      },
    });
    expect(spec.instruction).toContain("Owned scope: Own the gateway bootstrap wiring only.");
    expect(spec.instruction).toContain("Write scope: packages/belldandy-core/src/bin/gateway.ts");
    expect(spec.instruction).toContain("Out of scope: UI polish, database migrations");
    expect(spec.instruction).toContain("Done definition: Gateway bootstrap change is implemented and build remains green.");
    expect(spec.instruction).toContain("Final handoff must include a `Done Definition Check` section");
    expect(spec.instruction).toContain("Verification hints: Run targeted tests | Run workspace build");
    expect(spec.instruction).toContain("Deliverable format: patch");
    expect(spec.instruction).toContain("Required sections: Changes made | Verification | Residual risk");
    expect(spec.instruction).toContain("Use the required section names verbatim in the final handoff whenever practical");
  });

  it("threads team metadata into the worker envelope and delegation protocol", () => {
    const spec = buildSubAgentLaunchSpec(createContext(), {
      instruction: "Patch lane A and hand the result back to the verifier lane.",
      agentId: "coder",
      channel: "subtask",
      role: "coder",
      ownership: {
        scopeSummary: "Own patch lane A only.",
      },
      team: {
        id: "team-42",
        mode: "parallel_patch",
        sharedGoal: "Split the patch work and fan in through the verifier.",
        managerAgentId: "default",
        managerIdentityLabel: "首席执行官 (CEO)",
        currentLaneId: "lane_a",
        memberRoster: [
          {
            laneId: "lane_a",
            agentId: "coder",
            role: "coder",
            identityLabel: "CTO",
            authorityRelationToManager: "subordinate",
            reportsTo: ["首席执行官 (CEO)"],
            mayDirect: ["员工"],
            scopeSummary: "Own patch lane A only.",
            handoffTo: ["lane_verify"],
          },
          {
            laneId: "lane_verify",
            agentId: "verifier",
            role: "verifier",
            identityLabel: "审计",
            authorityRelationToManager: "peer",
            scopeSummary: "Review accepted patch lanes.",
            dependsOn: ["lane_a"],
          },
        ],
      },
    });

    expect(spec.delegationProtocol?.team).toMatchObject({
      id: "team-42",
      mode: "parallel_patch",
      sharedGoal: "Split the patch work and fan in through the verifier.",
      managerAgentId: "default",
      managerIdentityLabel: "首席执行官 (CEO)",
      currentLaneId: "lane_a",
      memberRoster: [
        {
          laneId: "lane_a",
          agentId: "coder",
          role: "coder",
          identityLabel: "CTO",
          authorityRelationToManager: "subordinate",
          reportsTo: ["首席执行官 (CEO)"],
          mayDirect: ["员工"],
          scopeSummary: "Own patch lane A only.",
          handoffTo: ["lane_verify"],
        },
        {
          laneId: "lane_verify",
          agentId: "verifier",
          role: "verifier",
          identityLabel: "审计",
          authorityRelationToManager: "peer",
          scopeSummary: "Review accepted patch lanes.",
          dependsOn: ["lane_a"],
        },
      ],
    });
    expect(spec.instruction).toContain("## Team Topology and Ownership");
    expect(spec.instruction).toContain("## Authority Chain");
    expect(spec.instruction).toContain("## Teammate Handoff");
    expect(spec.instruction).toContain("## Reporting Expectations");
    expect(spec.instruction).toContain("Team mode: parallel_patch");
    expect(spec.instruction).toContain("Team ID: team-42");
    expect(spec.instruction).toContain("Manager identity: 首席执行官 (CEO)");
    expect(spec.instruction).toContain("Current lane: lane_a");
    expect(spec.instruction).toContain("Current lane identity: CTO");
    expect(spec.instruction).toContain("Authority relation to manager: subordinate");
    expect(spec.instruction).toContain("Reports to: 首席执行官 (CEO)");
    expect(spec.instruction).toContain("May direct: 员工");
    expect(spec.instruction).toContain("Current lane handoff target: lane_verify");
    expect(spec.instruction).toContain("Intended downstream lane(s): lane_verify");
    expect(spec.instruction).toContain("Name the lane you covered: lane_a.");
    expect(spec.instruction).toContain("lane_verify | agent=verifier | role=verifier | identity=审计 | relation=peer | owns=Review accepted patch lanes. | depends_on=lane_a");
  });
});
