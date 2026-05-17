import type { AgentProfileDefaultRole, SystemPromptSection } from "@belldandy/agent";
import type { IdentityAuthorityProfile } from "@belldandy/protocol";
import {
  buildToolContractV2CompactPromptSummary,
  type ToolContractV2,
} from "@belldandy/skills";

import { createGatewaySystemPromptSection } from "./gateway-prompt-runtime.js";

export type BuildAgentRuntimePromptSectionsOptions = {
  hasAvailableTools: boolean;
  visibleContracts: readonly ToolContractV2[];
  canDelegate: boolean;
  role?: AgentProfileDefaultRole;
  profileId?: string;
  recommendedSkillNames?: readonly string[];
  methodAssets?: readonly RuntimeMethodAssetSummary[];
  promptSkillAssets?: readonly RuntimeSkillAssetSummary[];
  searchableSkillAssets?: readonly RuntimeSkillAssetSummary[];
  identityAuthorityProfile?: IdentityAuthorityProfile;
};

export type RuntimeMethodAssetSummary = {
  fileName: string;
  title?: string;
  summary?: string;
  status?: string;
};

export type RuntimeSkillAssetSummary = {
  name: string;
  description: string;
  priority: "low" | "normal" | "high" | "always";
  source: string;
  tags: string[];
};

export function buildAgentRuntimePromptSections(
  options: BuildAgentRuntimePromptSectionsOptions,
): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [];

  if (options.hasAvailableTools) {
    sections.push(buildToolUsePolicySection());
  }

  const toolGovernanceSection = buildToolContractGovernanceSection(options.visibleContracts);
  if (toolGovernanceSection) {
    sections.push(toolGovernanceSection);
  }

  const teamOperatingModelSection = buildTeamOperatingModelSection({
    canDelegate: options.canDelegate,
  });
  if (teamOperatingModelSection) {
    sections.push(teamOperatingModelSection);
  }

  const teamTopologySection = buildTeamTopologyAndOwnershipSection({
    canDelegate: options.canDelegate,
  });
  if (teamTopologySection) {
    sections.push(teamTopologySection);
  }

  const teamIdentityGovernanceSection = buildTeamIdentityGovernancePolicySection({
    canDelegate: options.canDelegate,
    identityAuthorityProfile: options.identityAuthorityProfile,
  });
  if (teamIdentityGovernanceSection) {
    sections.push(teamIdentityGovernanceSection);
  }

  const delegationSection = buildDelegationOperatingPolicySection({
    canDelegate: options.canDelegate,
  });
  if (delegationSection) {
    sections.push(delegationSection);
  }

  const managerFanoutSection = buildManagerFanoutFaninPolicySection({
    canDelegate: options.canDelegate,
  });
  if (managerFanoutSection) {
    sections.push(managerFanoutSection);
  }

  const teamSharedStateSection = buildTeamSharedStatePolicySection({
    canDelegate: options.canDelegate,
  });
  if (teamSharedStateSection) {
    sections.push(teamSharedStateSection);
  }

  const methodSkillAssetSection = buildMethodSkillAssetSummarySection({
    recommendedSkillNames: options.recommendedSkillNames,
    methodAssets: options.methodAssets,
    promptSkillAssets: options.promptSkillAssets,
    searchableSkillAssets: options.searchableSkillAssets,
  });
  if (methodSkillAssetSection) {
    sections.push(methodSkillAssetSection);
  }

  const profileSection = buildProfileExecutionPolicySection({
    profileId: options.profileId,
  });
  if (profileSection) {
    sections.push(profileSection);
  }

  const roleSection = buildRoleExecutionPolicySection({
    role: options.role,
  });
  if (roleSection) {
    sections.push(roleSection);
  }

  return sections;
}

export function buildMethodSkillAssetSummarySection(input: {
  recommendedSkillNames?: readonly string[];
  methodAssets?: readonly RuntimeMethodAssetSummary[];
  promptSkillAssets?: readonly RuntimeSkillAssetSummary[];
  searchableSkillAssets?: readonly RuntimeSkillAssetSummary[];
}): SystemPromptSection | undefined {
  const recommendedSkillNames = (input.recommendedSkillNames ?? []).filter(Boolean);
  const methodAssets = input.methodAssets ?? [];
  const promptSkillAssets = input.promptSkillAssets ?? [];
  const searchableSkillAssets = input.searchableSkillAssets ?? [];

  if (
    recommendedSkillNames.length === 0
    && methodAssets.length === 0
    && promptSkillAssets.length === 0
    && searchableSkillAssets.length === 0
  ) {
    return undefined;
  }

  const lines = [
    "## Method / Skill Asset Summary",
    "",
    "Before inventing a new workflow, check whether an existing method or skill already matches the task.",
    "Use this section as a compact index; open full assets with `method_search` / `method_read` / `skills_search` / `skill_get` only when the summary looks relevant.",
  ];

  if (recommendedSkillNames.length > 0) {
    lines.push(`- Profile-preferred skills: ${recommendedSkillNames.join(" | ")}`);
  }

  if (methodAssets.length > 0) {
    lines.push("- Method assets:");
    for (const method of methodAssets) {
      const parts = [
        `file=${method.fileName}`,
        method.title ? `title=${method.title}` : undefined,
        method.status ? `status=${method.status}` : undefined,
        method.summary ? `summary=${method.summary}` : undefined,
      ].filter((part): part is string => Boolean(part));
      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  if (promptSkillAssets.length > 0) {
    lines.push("- Prompt-injected skills already active:");
    for (const skill of promptSkillAssets) {
      lines.push(`- ${skill.name} | ${skill.description}`);
    }
  }

  if (searchableSkillAssets.length > 0) {
    lines.push("- Searchable skills worth checking on demand:");
    for (const skill of searchableSkillAssets) {
      lines.push(`- ${skill.name} | ${skill.description}`);
    }
  }

  return createGatewaySystemPromptSection({
    id: "method-skill-asset-summary",
    label: "method-skill-asset-summary",
    source: "runtime",
    priority: 58,
    text: lines.join("\n"),
  });
}

export function buildToolUsePolicySection(): SystemPromptSection {
  return createGatewaySystemPromptSection({
    id: "tool-use-policy",
    label: "tool-use-policy",
    source: "runtime",
    priority: 55,
    text: [
      "## Tool Use Operating Policy",
      "",
      "Use tools only when they reduce uncertainty or complete the task more safely than pure reasoning.",
      "1. Confirm the exact subproblem before calling a tool.",
      "2. Prefer the smallest, lowest-risk tool that can answer it.",
      "3. Search/read before write, inspect before patch, verify before delivery.",
      "4. Before any write, command, external action, or broad change, confirm the target and likely impact.",
      "5. If a tool fails, classify the failure before retrying; do not repeat the same failing call blindly.",
      "6. After a change, run the smallest useful verification before claiming success.",
      "6.1 If the user asks about the contents of an uploaded image or video, prefer `image_understand` or `video_understand` instead of guessing from filenames, paths, or partial prompt text.",
      "6.2 If the user asks what happens at a specific video moment, prefer `video_understand` with `focus_mode=timestamp_query` and pass the referenced time via `target_timestamp`.",
      "6.3 If the user only needs the overall video or image content, prefer `focus_mode=overview`; if they ask for key moments in a video, prefer `focus_mode=timeline`.",
      "7. If the task mentions dream / 梦境 / dream runtime / dream memory, do not infer canvas or board storage. Inspect dream-specific artifacts first: `dream-runtime.json`, `DREAM.md`, and `dreams/**/*.md` under the agent state scope. Treat `canvas/*.json` as unrelated board storage unless the user explicitly asks about canvas / boards / nodes / edges.",
    ].join("\n"),
  });
}

export function buildToolContractGovernanceSection(
  contracts: readonly ToolContractV2[],
): SystemPromptSection | undefined {
  const text = buildToolContractV2CompactPromptSummary(contracts, {
    maxTools: 8,
    maxBulletsPerField: 1,
  });
  if (!text) {
    return undefined;
  }
  return createGatewaySystemPromptSection({
    id: "tool-contract-governance",
    label: "tool-contract-governance",
    source: "runtime",
    priority: 56,
    text,
  });
}

export function buildTeamOperatingModelSection(input: {
  canDelegate: boolean;
}): SystemPromptSection | undefined {
  if (!input.canDelegate) {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "team-operating-model",
    label: "team-operating-model",
    source: "runtime",
    priority: 57,
    text: [
      "## Team Operating Model",
      "",
      "When you delegate multiple bounded subtasks, switch into a manager-mediated team mode instead of treating each worker as an isolated one-off call.",
      "- Define a shared goal before fan-out.",
      "- Maintain an explicit team roster with lane ownership, dependencies, and handoff targets.",
      "- Keep the manager responsible for orchestration, sequencing, and final integration.",
      "- Workers execute their lanes; the manager decides when to accept, retry, or escalate results.",
      "- Prefer manager-mediated handoff and fan-in before inventing ad-hoc peer-to-peer coordination.",
    ].join("\n"),
  });
}

export function buildTeamTopologyAndOwnershipSection(input: {
  canDelegate: boolean;
}): SystemPromptSection | undefined {
  if (!input.canDelegate) {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "team-topology-and-ownership",
    label: "team-topology-and-ownership",
    source: "runtime",
    priority: 57,
    text: [
      "## Team Topology and Ownership",
      "",
      "In team mode, make the topology explicit before you fan out work.",
      "- Name the manager lane and every worker lane.",
      "- For each lane, record the owned scope, expected handoff target, and any upstream dependencies.",
      "- Avoid overlapping write ownership across lanes unless the manager explicitly plans the merge.",
      "- If a lane depends on another lane, preserve that dependency instead of pretending they can complete independently.",
      "- Treat missing ownership or handoff information as a planning gap to fix before broad delegation.",
    ].join("\n"),
  });
}

export function buildTeamIdentityGovernancePolicySection(input: {
  canDelegate: boolean;
  identityAuthorityProfile?: IdentityAuthorityProfile;
}): SystemPromptSection | undefined {
  if (!input.canDelegate || !input.identityAuthorityProfile) {
    return undefined;
  }

  const profile = input.identityAuthorityProfile;
  const lines = [
    "## Team Identity Governance Policy",
    "",
    "When identity authority is configured, apply it as a governance rule for team orchestration rather than as free-form persona text.",
    `- Authority mode: ${profile.authorityMode}`,
    `- Current identity label: ${profile.currentLabel || "unknown"}`,
  ];
  if (profile.ownerUuids.length > 0) {
    lines.push(`- Owner UUIDs: ${profile.ownerUuids.join(" | ")}`);
  }
  if (profile.superiorLabels.length > 0) {
    lines.push(`- Superior labels: ${profile.superiorLabels.join(" | ")}`);
  }
  if (profile.subordinateLabels.length > 0) {
    lines.push(`- Subordinate labels: ${profile.subordinateLabels.join(" | ")}`);
  }
  lines.push(
    "- Only owner or superior-approved instructions may reprioritize the team, reassign lane ownership, or override fan-out sequencing.",
    "- Subordinate requests should receive guidance, manager drafts, or escalation instead of direct ownership changes.",
    "- Peer or unrelated actors should not override another lane's scope without manager approval.",
    "- If authority cannot be verified in the current environment, treat identity labels as persona text only and keep the team contract unchanged.",
  );

  return createGatewaySystemPromptSection({
    id: "team-identity-governance-policy",
    label: "team-identity-governance-policy",
    source: "runtime",
    priority: 57,
    text: lines.join("\n"),
  });
}

export function buildDelegationOperatingPolicySection(input: {
  canDelegate: boolean;
}): SystemPromptSection | undefined {
  if (!input.canDelegate) {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "delegation-operating-policy",
    label: "delegation-operating-policy",
    source: "runtime",
    priority: 58,
    text: [
      "## Delegation Operating Policy",
      "",
      "Delegate only when the subtask is concrete, bounded, and can be handed off without blocking the immediate next local step.",
      "- Keep the first critical-path step local when you need its result right away.",
      "- When a delegated subtask is meaningful, include a structured contract: `ownership.scope_summary`, `ownership.out_of_scope`, `acceptance.done_definition`, and `deliverable_contract.format/required_sections`.",
      "- Give each worker a clear role, scope, expected output, and stop condition.",
      "- Avoid overlapping write ownership across parallel workers.",
      "- Wait immediately only when the next safe local step is blocked on the delegated result or the result is needed to prove safety/completion.",
      "- While workers run, keep progressing on non-overlapping local work.",
      "- Reject or follow up on delegated results that exceed owned scope, violate out-of-scope limits, miss required sections, or fail the done definition.",
      "- When a delegated result is rejected, make the next step explicit: classify it as accept, retry with a follow-up delegation, or report blocker.",
      "- If you hand the work to a verifier, inherit the existing `acceptance.verification_hints` into the verifier handoff instead of dropping them.",
      "- In parallel fan-in, summarize which results are safe to accept now, which need retry, and which are hard blockers before you continue.",
      "- Review and integrate delegated results instead of copying them blindly.",
    ].join("\n"),
  });
}

export function buildManagerFanoutFaninPolicySection(input: {
  canDelegate: boolean;
}): SystemPromptSection | undefined {
  if (!input.canDelegate) {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "manager-fanout-fanin-policy",
    label: "manager-fanout-fanin-policy",
    source: "runtime",
    priority: 58,
    text: [
      "## Manager Fan-Out / Fan-In Policy",
      "",
      "When you are operating as the manager of a team run, follow an explicit loop: plan fan-out, keep local progress moving, then perform selective fan-in.",
      "- Split work into concrete lanes before spawning workers.",
      "- Ask each worker for a lane-scoped handoff that names completed scope, open blockers, and the next manager-facing handoff target.",
      "- After fan-out, continue non-overlapping local work instead of waiting reflexively.",
      "- Wait only for the lanes that block the next safe local step or the final acceptance decision.",
      "- In fan-in, classify each lane as accept, retry, or blocker before integrating results.",
      "- If a lane feeds another lane or verifier, preserve that manager-mediated handoff instead of collapsing it into an early final answer.",
      "- Do not merge team output blindly; reconcile conflicts, unresolved dependencies, and overlapping conclusions first.",
    ].join("\n"),
  });
}

export function buildTeamSharedStatePolicySection(input: {
  canDelegate: boolean;
}): SystemPromptSection | undefined {
  if (!input.canDelegate) {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "team-shared-state-policy",
    label: "team-shared-state-policy",
    source: "runtime",
    priority: 58,
    text: [
      "## Team Shared State Policy",
      "",
      "In team mode, keep a compact shared state for the manager instead of treating each lane result as isolated text.",
      "- Track the shared goal, accepted lanes, pending retries, blockers, and the latest fan-in verdict.",
      "- Prefer a compact team summary over a free-form transcript of every worker step.",
      "- If dependencies remain unresolved, keep that state explicit and hold fan-in instead of implying completion.",
      "- If write ownership overlaps across lanes, surface it as a merge risk before accepting the team output.",
      "- Use the team completion gate as the final manager check before claiming that the team run is done.",
    ].join("\n"),
  });
}

export function buildProfileExecutionPolicySection(input: {
  profileId?: string;
}): SystemPromptSection | undefined {
  if (input.profileId !== "commander") {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "profile-execution-policy",
    label: "profile-execution-policy",
    source: "profile",
    priority: 59,
    text: [
      "## Profile Execution Policy (commander)",
      "",
      "You are responsible for scope control, delegation, and fan-in acceptance rather than direct implementation.",
      "- Prefer decomposition, worker selection, acceptance criteria, and result integration over hands-on editing.",
      "- Reuse method / skill assets before inventing a new execution pattern.",
      "- If code changes, shell commands, or write actions are needed, delegate them to the appropriate worker lane instead of doing them yourself.",
      "- If a proposed optimization would weaken memory recall, memory writes, or long-term context quality, adjust the plan or defer it.",
    ].join("\n"),
  });
}

export function buildRoleExecutionPolicySection(input: {
  role?: AgentProfileDefaultRole;
}): SystemPromptSection | undefined {
  const role = input.role;
  if (!role || role === "default") {
    return undefined;
  }

  const text = ROLE_EXECUTION_POLICY_TEXT[role];
  if (!text) {
    return undefined;
  }

  return createGatewaySystemPromptSection({
    id: "role-execution-policy",
    label: "role-execution-policy",
    source: "profile",
    priority: 59,
    text,
  });
}

const ROLE_EXECUTION_POLICY_TEXT: Partial<Record<Exclude<AgentProfileDefaultRole, "default">, string>> = {
  coder: [
    "## Role Execution Policy (coder)",
    "",
    "Prefer code-aware tools and local repository evidence over general assumptions.",
    "- Inspect the current implementation before editing.",
    "- Favor minimal diffs and keep changes inside existing module boundaries when possible.",
    "- After edits, run the smallest useful validation for the touched path.",
  ].join("\n"),
  researcher: [
    "## Role Execution Policy (researcher)",
    "",
    "Prefer read/search/browser workflows and gather evidence before proposing conclusions.",
    "- Search local context first, then external sources only when needed.",
    "- Avoid mutating the workspace unless the task explicitly requires it.",
    "- Report uncertainty and keep source-backed findings separate from inference.",
  ].join("\n"),
  verifier: [
    "## Role Execution Policy (verifier)",
    "",
    "Your primary job is validation, not implementation momentum.",
    "- Prefer read, diff, test, and browser checks over write actions.",
    "- Look for regressions, missing verification, and unsupported claims.",
    "- Do not declare success from implementation alone; require evidence from checks or observable behavior.",
  ].join("\n"),
};
