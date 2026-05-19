import { describe, expect, it } from "vitest";

import type { ToolContractV2 } from "@belldandy/skills";

import { buildAgentRuntimePromptSections } from "./gateway-prompt-sections.js";

function createContract(overrides: Partial<ToolContractV2> & Pick<ToolContractV2, "name">): ToolContractV2 {
  return {
    name: overrides.name,
    family: overrides.family,
    riskLevel: overrides.riskLevel,
    needsPermission: overrides.needsPermission ?? false,
    isReadOnly: overrides.isReadOnly ?? true,
    isConcurrencySafe: overrides.isConcurrencySafe ?? true,
    activityDescription: overrides.activityDescription,
    outputPersistencePolicy: overrides.outputPersistencePolicy,
    channels: overrides.channels,
    safeScopes: overrides.safeScopes,
    recommendedWhen: overrides.recommendedWhen ?? [],
    avoidWhen: overrides.avoidWhen ?? [],
    confirmWhen: overrides.confirmWhen ?? [],
    preflightChecks: overrides.preflightChecks ?? [],
    fallbackStrategy: overrides.fallbackStrategy ?? [],
    expectedOutput: overrides.expectedOutput ?? [],
    sideEffectSummary: overrides.sideEffectSummary ?? [],
    userVisibleRiskNote: overrides.userVisibleRiskNote,
    hasGovernanceContract: overrides.hasGovernanceContract ?? true,
    hasBehaviorContract: overrides.hasBehaviorContract ?? true,
  };
}

describe("buildAgentRuntimePromptSections", () => {
  it("builds tool, delegation, and role sections for coder profiles", () => {
    const sections = buildAgentRuntimePromptSections({
      hasAvailableTools: true,
      visibleContracts: [
        createContract({
          name: "file_write",
          family: "workspace-write",
          riskLevel: "high",
          isReadOnly: false,
          needsPermission: true,
          preflightChecks: ["confirm the target file"],
        }),
      ],
      canDelegate: true,
      role: "coder",
      identityAuthorityProfile: {
        currentLabel: "首席执行官 (CEO)",
        superiorLabels: ["董事会成员"],
        subordinateLabels: ["CTO", "项目经理"],
        ownerUuids: ["vr777"],
        authorityMode: "verifiable_only",
        responsePolicy: {
          ownerOrSuperior: "execute",
          subordinate: "guide",
          other: "refuse_or_inform",
        },
        source: "identity_md",
      },
    });

    expect(sections.map((section) => section.id)).toEqual([
      "tool-use-policy",
      "tool-contract-governance",
      "team-operating-model",
      "team-topology-and-ownership",
      "team-identity-governance-policy",
      "delegation-operating-policy",
      "manager-fanout-fanin-policy",
      "team-shared-state-policy",
      "role-execution-policy",
    ]);
    expect(sections.find((section) => section.id === "team-operating-model")?.text)
      .toContain("manager-mediated team mode");
    expect(sections.find((section) => section.id === "team-topology-and-ownership")?.text)
      .toContain("make the topology explicit");
    expect(sections.find((section) => section.id === "team-identity-governance-policy")?.text)
      .toContain("Only owner or superior-approved instructions");
    expect(sections.find((section) => section.id === "delegation-operating-policy")?.text)
      .toContain("ownership.scope_summary");
    expect(sections.find((section) => section.id === "delegation-operating-policy")?.text)
      .toContain("done definition");
    expect(sections.find((section) => section.id === "delegation-operating-policy")?.text)
      .toContain("classify it as accept, retry with a follow-up delegation, or report blocker");
    expect(sections.find((section) => section.id === "delegation-operating-policy")?.text)
      .toContain("inherit the existing `acceptance.verification_hints`");
    expect(sections.find((section) => section.id === "manager-fanout-fanin-policy")?.text)
      .toContain("plan fan-out, keep local progress moving, then perform selective fan-in");
    expect(sections.find((section) => section.id === "manager-fanout-fanin-policy")?.text)
      .toContain("lane-scoped handoff");
    expect(sections.find((section) => section.id === "manager-fanout-fanin-policy")?.text)
      .toContain("manager-mediated handoff");
    expect(sections.find((section) => section.id === "team-shared-state-policy")?.text)
      .toContain("team completion gate");
    expect(sections.find((section) => section.id === "role-execution-policy")?.text)
      .toContain("Role Execution Policy (coder)");
    expect(sections.find((section) => section.id === "tool-use-policy")?.text)
      .toContain("do not infer canvas or board storage");
    expect(sections.find((section) => section.id === "tool-use-policy")?.text)
      .toContain("dream-runtime.json");
    expect(sections.find((section) => section.id === "tool-use-policy")?.text)
      .toContain("prefer `video_understand` with `focus_mode=timestamp_query`");
  });

  it("injects method / skill summary and commander execution policy when available", () => {
    const sections = buildAgentRuntimePromptSections({
      hasAvailableTools: true,
      visibleContracts: [],
      canDelegate: true,
      role: "default",
      profileId: "commander",
      recommendedMethodNames: ["multi-agent-review.md"],
      recommendedSkillNames: ["orchestration-playbook"],
      methodAssets: [
        {
          fileName: "multi-agent-review.md",
          path: "methods/multi-agent-review.md",
          title: "多 Agent 审查流程",
          status: "active",
          summary: "适合需要 coder + verifier 收口的复杂任务。",
        },
      ],
      methodAssetTotalCount: 48,
      promptSkillAssets: [
        {
          name: "team-fan-in",
          description: "帮助 manager 组织 fan-in 验收。",
          priority: "high",
          source: "bundled",
          path: "bundled:team-fan-in",
          tags: ["team"],
        },
      ],
      promptSkillAssetTotalCount: 3,
      searchableSkillAssets: [
        {
          name: "memory-guard",
          description: "在优化方案里检查记忆能力是否退化。",
          priority: "normal",
          source: "user",
          path: "skills/memory-guard/SKILL.md",
          tags: ["memory"],
        },
      ],
      searchableSkillAssetTotalCount: 37,
    });

    expect(sections.map((section) => section.id)).toContain("method-skill-asset-summary");
    expect(sections.map((section) => section.id)).toContain("profile-execution-policy");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Profile-preferred methods: multi-agent-review.md");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Profile-preferred skills: orchestration-playbook");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("SOPs / reusable workflows: use `method_search`");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Skills / domain instructions: use `skills_search`");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Heavy builtin tools or MCP tools not currently visible: use `tool_search` first");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Method candidates (showing 1/48): `multi-agent-review.md` - 多 Agent 审查流程 [active]");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Active prompt skills (showing 1/3): `team-fan-in` - 帮助 manager 组织 fan-in 验收。");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Searchable skill candidates (showing 1/37): `memory-guard` - 在优化方案里检查记忆能力是否退化。");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("On demand: use `method_search` -> `method_read`, `skills_search` -> `skill_get`.");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Inventory counts: methods=48 | prompt_skills=3 | searchable_skills=37");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .toContain("Grouped lists below are samples, not exhaustive.");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .not.toContain("path=methods/multi-agent-review.md");
    expect(sections.find((section) => section.id === "method-skill-asset-summary")?.text)
      .not.toContain("path=skills/memory-guard/SKILL.md");
    expect(sections.find((section) => section.id === "profile-execution-policy")?.text)
      .toContain("scope control, delegation, and fan-in acceptance");
    expect(sections.find((section) => section.id === "profile-execution-policy")?.text)
      .toContain("adjust the plan or defer it");
  });

  it("skips delegation and role sections when they do not apply", () => {
    const sections = buildAgentRuntimePromptSections({
      hasAvailableTools: true,
      visibleContracts: [],
      canDelegate: false,
      role: "default",
    });

    expect(sections.map((section) => section.id)).toEqual([
      "tool-use-policy",
    ]);
  });
});
