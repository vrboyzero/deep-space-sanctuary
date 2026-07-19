import type { JsonObject } from "@belldandy/protocol";
import type { ToolContractFamily, ToolContractRiskLevel } from "./tool-contract.js";
import {
  buildDelegationProtocol,
  type DelegationAcceptance,
  type DelegationAggregationMode,
  type DelegationDeliverableContract,
  type DelegationOwnership,
  type DelegationProtocol,
  type DelegationSource,
  type DelegationTeamMetadata,
} from "./delegation-protocol.js";
import type { SpawnSubAgentOptions, ToolContext } from "./types.js";

type BuildSubAgentLaunchSpecOptions = {
  instruction: string;
  agentId?: string;
  profileId?: string;
  background?: boolean;
  timeoutMs?: number;
  channel: string;
  context?: JsonObject;
  cwd?: string;
  toolSet?: string[];
  permissionMode?: string;
  isolationMode?: string;
  parentTaskId?: string;
  role?: "default" | "commander" | "coder" | "researcher" | "verifier";
  policySummary?: string;
  delegationSource?: DelegationSource;
  expectedDeliverableSummary?: string;
  aggregationMode?: DelegationAggregationMode;
  goalId?: string;
  nodeId?: string;
  planId?: string;
  sourceAgentIds?: string[];
  ownership?: Partial<DelegationOwnership>;
  acceptance?: Partial<DelegationAcceptance>;
  deliverableContract?: Partial<DelegationDeliverableContract>;
  team?: Partial<DelegationTeamMetadata>;
};

type WorkerInstructionEnvelopeInput = {
  role?: BuildSubAgentLaunchSpecOptions["role"];
  instruction: string;
  allowedToolFamilies?: string[];
  permissionMode?: string;
  maxToolRiskLevel?: string;
  cwd?: string;
  timeoutMs?: number;
  expectedDeliverableSummary?: string;
  policySummary?: string;
  delegationProtocol?: DelegationProtocol;
};

function cloneJsonObject(value: JsonObject | undefined): JsonObject | undefined {
  if (!value) return undefined;
  return { ...value };
}

function cloneStringArray(value: string[] | undefined): string[] | undefined {
  return value ? [...value] : undefined;
}

function isGenericRoleProfileId(
  value: string | undefined,
  role: BuildSubAgentLaunchSpecOptions["role"],
): boolean {
  if (!value || !role) return false;
  const normalized = value.trim();
  return normalized === role;
}

const ROLE_TOOL_FAMILIES: Partial<Record<
  NonNullable<BuildSubAgentLaunchSpecOptions["role"]>,
  ToolContractFamily[]
>> = {
  commander: ["workspace-read", "browser", "memory", "goal-governance", "session-orchestration"],
  coder: ["workspace-read", "workspace-write", "patch", "command-exec", "memory", "goal-governance"],
  researcher: ["network-read", "workspace-read", "browser", "memory", "goal-governance"],
  verifier: ["workspace-read", "command-exec", "browser", "memory", "goal-governance"],
};

const ROLE_PERMISSION_MODE: Partial<Record<
  NonNullable<BuildSubAgentLaunchSpecOptions["role"]>,
  NonNullable<SpawnSubAgentOptions["permissionMode"]>
>> = {
  commander: "confirm",
  researcher: "plan",
  coder: "confirm",
  verifier: "confirm",
};

const ROLE_MAX_RISK_LEVEL: Partial<Record<
  NonNullable<BuildSubAgentLaunchSpecOptions["role"]>,
  ToolContractRiskLevel
>> = {
  commander: "high",
  researcher: "medium",
  coder: "high",
  verifier: "high",
};

function buildWorkerBasePrompt(): string {
  return [
    "## Worker Base",
    "",
    "You are a delegated worker agent operating inside a larger multi-agent task.",
    "Focus only on the assigned subtask, do not expand scope, and do not take over manager responsibilities.",
    "If blocked, report the blocker clearly instead of improvising broad or unrelated changes.",
  ].join("\n");
}

function buildWorkerRolePrompt(
  role: BuildSubAgentLaunchSpecOptions["role"],
): string | undefined {
  switch (role) {
    case "coder":
      return [
        "## Worker Role (coder)",
        "",
        "Inspect current code before editing, keep diffs minimal, and validate the touched path before you finish.",
      ].join("\n");
    case "researcher":
      return [
        "## Worker Role (researcher)",
        "",
        "Prioritize reading, searching, and evidence gathering. Avoid modifying the workspace unless the task explicitly requires it.",
      ].join("\n");
    case "verifier":
      return [
        "## Worker Role (verifier)",
        "",
        "Your job is to verify and surface issues. Prefer checks, tests, diffs, and observations over implementation.",
      ].join("\n");
    default:
      return undefined;
  }
}

function buildWorkerTaskEnvelope(input: WorkerInstructionEnvelopeInput): string {
  const lines = [
    "## Task Envelope",
    "",
    input.instruction.trim(),
  ];

  if (input.expectedDeliverableSummary?.trim()) {
    lines.push("", `Expected deliverable: ${input.expectedDeliverableSummary.trim()}`);
  }

  const ownership = input.delegationProtocol?.ownership;
  if (ownership?.scopeSummary?.trim()) {
    lines.push("", `Owned scope: ${ownership.scopeSummary.trim()}`);
  }
  if (ownership?.writeScope && ownership.writeScope.length > 0) {
    lines.push(`Write scope: ${ownership.writeScope.join(", ")}`);
  }
  if (ownership?.outOfScope && ownership.outOfScope.length > 0) {
    lines.push(`Out of scope: ${ownership.outOfScope.join(", ")}`);
  }

  const acceptance = input.delegationProtocol?.acceptance;
  if (acceptance?.doneDefinition?.trim()) {
    lines.push("", `Done definition: ${acceptance.doneDefinition.trim()}`);
    lines.push("Final handoff must include a `Done Definition Check` section that states whether the done definition is satisfied and why.");
  }
  if (acceptance?.verificationHints && acceptance.verificationHints.length > 0) {
    lines.push(`Verification hints: ${acceptance.verificationHints.join(" | ")}`);
  }

  const deliverableContract = input.delegationProtocol?.deliverableContract;
  if (deliverableContract) {
    lines.push("", `Deliverable format: ${deliverableContract.format}`);
    if (deliverableContract.summary?.trim()) {
      lines.push(`Deliverable summary: ${deliverableContract.summary.trim()}`);
    }
    if (deliverableContract.requiredSections && deliverableContract.requiredSections.length > 0) {
      lines.push(`Required sections: ${deliverableContract.requiredSections.join(" | ")}`);
      lines.push("Use the required section names verbatim in the final handoff whenever practical so the manager can validate the result.");
    }
  }

  return lines.join("\n");
}

function buildWorkerTeamTopology(input: WorkerInstructionEnvelopeInput): string | undefined {
  const team = input.delegationProtocol?.team;
  if (!team || !Array.isArray(team.memberRoster) || team.memberRoster.length === 0) {
    return undefined;
  }

  const currentLane = team.currentLaneId
    ? team.memberRoster.find((member) => member.laneId === team.currentLaneId)
    : undefined;
  const teammateLines = team.memberRoster
    .map((member) => {
      const scope = member.scopeSummary?.trim() ? ` | owns=${member.scopeSummary.trim()}` : "";
      const role = member.role ? ` | role=${member.role}` : "";
      const agent = member.agentId?.trim() ? ` | agent=${member.agentId.trim()}` : "";
      const identity = member.identityLabel?.trim() ? ` | identity=${member.identityLabel.trim()}` : "";
      const relation = member.authorityRelationToManager ? ` | relation=${member.authorityRelationToManager}` : "";
      const dependsOn = member.dependsOn && member.dependsOn.length > 0
        ? ` | depends_on=${member.dependsOn.join(", ")}`
        : "";
      const handoffTo = member.handoffTo && member.handoffTo.length > 0
        ? ` | handoff_to=${member.handoffTo.join(", ")}`
        : "";
      const currentMarker = currentLane?.laneId === member.laneId ? " (current lane)" : "";
      return `- ${member.laneId}${currentMarker}${agent}${role}${identity}${relation}${scope}${dependsOn}${handoffTo}`;
    });

  const lines = [
    "## Team Topology and Ownership",
    "",
    `Team mode: ${team.mode}`,
    `Team ID: ${team.id}`,
  ];
  if (team.sharedGoal?.trim()) {
    lines.push(`Shared goal: ${team.sharedGoal.trim()}`);
  }
  if (team.managerAgentId?.trim()) {
    lines.push(`Manager agent: ${team.managerAgentId.trim()}`);
  }
  if (team.managerIdentityLabel?.trim()) {
    lines.push(`Manager identity: ${team.managerIdentityLabel.trim()}`);
  }
  if (currentLane) {
    lines.push("");
    lines.push(`Current lane: ${currentLane.laneId}`);
    if (currentLane.identityLabel?.trim()) {
      lines.push(`Current lane identity: ${currentLane.identityLabel.trim()}`);
    }
    if (currentLane.authorityRelationToManager) {
      lines.push(`Authority relation to manager: ${currentLane.authorityRelationToManager}`);
    }
    if (currentLane.scopeSummary?.trim()) {
      lines.push(`Current lane ownership: ${currentLane.scopeSummary.trim()}`);
    }
    if (currentLane.dependsOn && currentLane.dependsOn.length > 0) {
      lines.push(`Current lane depends on: ${currentLane.dependsOn.join(", ")}`);
    }
    if (currentLane.handoffTo && currentLane.handoffTo.length > 0) {
      lines.push(`Current lane handoff target: ${currentLane.handoffTo.join(", ")}`);
    }
  }
  lines.push("", "Roster:", ...teammateLines);

  return lines.join("\n");
}

function buildWorkerAuthorityChain(input: WorkerInstructionEnvelopeInput): string | undefined {
  const team = input.delegationProtocol?.team;
  if (!team || !Array.isArray(team.memberRoster) || team.memberRoster.length === 0) {
    return undefined;
  }

  const currentLane = team.currentLaneId
    ? team.memberRoster.find((member) => member.laneId === team.currentLaneId)
    : undefined;
  if (!currentLane) {
    return undefined;
  }

  const lines = [
    "## Authority Chain",
    "",
    `Your lane: ${currentLane.laneId}`,
    `Your identity label: ${currentLane.identityLabel?.trim() || "unknown"}`,
    `Authority relation to manager: ${currentLane.authorityRelationToManager || "unknown"}`,
    `Reports to: ${currentLane.reportsTo && currentLane.reportsTo.length > 0 ? currentLane.reportsTo.join(" | ") : "unknown"}`,
    `May direct: ${currentLane.mayDirect && currentLane.mayDirect.length > 0 ? currentLane.mayDirect.join(" | ") : "none"}`,
    "- Owner or superior-approved contract changes may override lane sequencing or ownership.",
    "- Requests from subordinate actors should get guidance or escalation, not uncontrolled scope changes.",
    "- Peer or unrelated actors should not redirect your lane without manager approval.",
    "- If authority conflicts with the task contract, escalate to the manager instead of silently changing course.",
  ];
  if (team.managerIdentityLabel?.trim()) {
    lines.splice(3, 0, `Manager identity label: ${team.managerIdentityLabel.trim()}`);
  }

  return lines.join("\n");
}

function buildWorkerTeammateHandoff(input: WorkerInstructionEnvelopeInput): string | undefined {
  const team = input.delegationProtocol?.team;
  if (!team || !Array.isArray(team.memberRoster) || team.memberRoster.length === 0) {
    return undefined;
  }

  const currentLane = team.currentLaneId
    ? team.memberRoster.find((member) => member.laneId === team.currentLaneId)
    : undefined;
  if (!currentLane) {
    return undefined;
  }

  const lines = [
    "## Teammate Handoff",
    "",
    "Treat your output as a lane-scoped handoff for the manager, not as a final merged team conclusion.",
    "- Route cross-lane coordination back through the manager unless the launch contract explicitly says otherwise.",
  ];
  if (currentLane.dependsOn && currentLane.dependsOn.length > 0) {
    lines.push(`- Upstream dependencies to acknowledge: ${currentLane.dependsOn.join(", ")}`);
  }
  if (currentLane.handoffTo && currentLane.handoffTo.length > 0) {
    lines.push(`- Intended downstream lane(s): ${currentLane.handoffTo.join(", ")}`);
    lines.push("- Make the next handoff target explicit in your final report so the manager can route fan-in safely.");
  }
  lines.push("- If a dependency is missing or stale, report that blocker clearly instead of guessing across lanes.");

  return lines.join("\n");
}

function buildWorkerReportingExpectations(input: WorkerInstructionEnvelopeInput): string | undefined {
  const team = input.delegationProtocol?.team;
  if (!team || !Array.isArray(team.memberRoster) || team.memberRoster.length === 0) {
    return undefined;
  }

  const currentLane = team.currentLaneId
    ? team.memberRoster.find((member) => member.laneId === team.currentLaneId)
    : undefined;
  const lines = [
    "## Reporting Expectations",
    "",
    "- Keep the final handoff scoped to your lane ownership only.",
    currentLane?.laneId ? `- Name the lane you covered: ${currentLane.laneId}.` : "- Name the lane you covered.",
    "- Separate completed work, unresolved blockers, and the manager-facing next step.",
    "- If you relied on upstream lane output, cite the dependency by lane ID instead of describing it vaguely.",
  ];
  if (currentLane?.handoffTo && currentLane.handoffTo.length > 0) {
    lines.push(`- If the work should flow to another lane next, name that handoff target explicitly: ${currentLane.handoffTo.join(", ")}.`);
  }
  lines.push("- Do not claim team-wide completion from a single lane result.");

  return lines.join("\n");
}

function buildWorkerLaunchConstraintSummary(input: WorkerInstructionEnvelopeInput): string {
  const constraintLines: string[] = [];

  if (input.allowedToolFamilies && input.allowedToolFamilies.length > 0) {
    constraintLines.push(`- Allowed tool families: ${input.allowedToolFamilies.join(", ")}`);
  }
  if (input.permissionMode?.trim()) {
    constraintLines.push(`- Permission mode: ${input.permissionMode.trim()}`);
  }
  if (input.maxToolRiskLevel?.trim()) {
    constraintLines.push(`- Max tool risk level: ${input.maxToolRiskLevel.trim()}`);
  }
  if (input.cwd?.trim()) {
    constraintLines.push(`- Working directory: ${input.cwd.trim()}`);
  }
  if (typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0) {
    constraintLines.push(`- Timeout ms: ${input.timeoutMs}`);
  }
  if (input.policySummary?.trim()) {
    constraintLines.push(`- Policy summary: ${input.policySummary.trim()}`);
  }

  if (constraintLines.length === 0) {
    return [
      "## Launch Constraints",
      "",
      "- Use the current runtime constraints even if they are not restated here.",
    ].join("\n");
  }

  return [
    "## Launch Constraints",
    "",
    ...constraintLines,
  ].join("\n");
}

export function buildWorkerInstructionEnvelope(input: WorkerInstructionEnvelopeInput): string {
  const parts = [
    buildWorkerBasePrompt(),
    buildWorkerRolePrompt(input.role),
    buildWorkerTaskEnvelope(input),
    buildWorkerTeamTopology(input),
    buildWorkerAuthorityChain(input),
    buildWorkerTeammateHandoff(input),
    buildWorkerReportingExpectations(input),
    buildWorkerLaunchConstraintSummary(input),
  ].filter(Boolean);

  return parts.join("\n\n").trim();
}

export function buildSubAgentLaunchSpec(
  context: ToolContext,
  options: BuildSubAgentLaunchSpecOptions,
): SpawnSubAgentOptions {
  const inherited = context.launchSpec;
  const role = options.role;
  const requestedProfileId = options.profileId ?? options.agentId;
  const preferCatalogDefaults = Boolean(requestedProfileId && !isGenericRoleProfileId(requestedProfileId, role));
  const inheritedAllowedToolFamilies = Array.isArray(inherited?.allowedToolFamilies) && inherited.allowedToolFamilies.length > 0
    ? inherited.allowedToolFamilies as ToolContractFamily[]
    : undefined;
  const roleAllowedToolFamilies = role ? ROLE_TOOL_FAMILIES[role] : undefined;
  const fallbackPermissionMode = inherited?.permissionMode ?? (!preferCatalogDefaults && role ? ROLE_PERMISSION_MODE[role] : undefined);
  const fallbackAllowedToolFamilies = inheritedAllowedToolFamilies ?? (!preferCatalogDefaults ? roleAllowedToolFamilies : undefined);
  const fallbackMaxRiskLevel = inherited?.maxToolRiskLevel ?? (!preferCatalogDefaults && role ? ROLE_MAX_RISK_LEVEL[role] : undefined);
  const resolvedTimeoutMs = options.timeoutMs ?? inherited?.timeoutMs;
  const resolvedCwd = options.cwd ?? context.defaultCwd ?? inherited?.cwd;
  const delegationProtocol = buildDelegationProtocol({
    source: options.delegationSource ?? "session_spawn",
    instruction: options.instruction,
    role,
    context: options.context,
    expectedDeliverableSummary: options.expectedDeliverableSummary,
    aggregationMode: options.aggregationMode,
    goalId: options.goalId,
    nodeId: options.nodeId,
    planId: options.planId,
    sourceAgentIds: options.sourceAgentIds,
    permissionMode: options.permissionMode ?? fallbackPermissionMode,
    allowedToolFamilies: fallbackAllowedToolFamilies,
    maxToolRiskLevel: fallbackMaxRiskLevel,
    ownership: options.ownership,
    acceptance: options.acceptance,
    deliverableContract: options.deliverableContract,
    team: options.team,
  });
  const instruction = buildWorkerInstructionEnvelope({
    role,
    instruction: options.instruction,
    allowedToolFamilies: fallbackAllowedToolFamilies,
    permissionMode: options.permissionMode ?? fallbackPermissionMode,
    maxToolRiskLevel: fallbackMaxRiskLevel,
    cwd: resolvedCwd,
    timeoutMs: resolvedTimeoutMs,
    expectedDeliverableSummary: delegationProtocol.expectedDeliverable.summary,
    policySummary: options.policySummary ?? inherited?.policySummary,
    delegationProtocol,
  });
  return {
    instruction,
    ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    agentId: options.agentId,
    profileId: options.profileId,
    background: options.background ?? inherited?.background,
    timeoutMs: resolvedTimeoutMs,
    channel: options.channel,
    context: cloneJsonObject(options.context),
    cwd: resolvedCwd,
    toolSet: cloneStringArray(options.toolSet ?? inherited?.toolSet),
    permissionMode: options.permissionMode ?? fallbackPermissionMode,
    isolationMode: options.isolationMode ?? inherited?.isolationMode,
    parentTaskId: options.parentTaskId ?? inherited?.parentTaskId,
    parentConversationId: context.conversationId,
    role,
    allowedToolFamilies: cloneStringArray(fallbackAllowedToolFamilies),
    maxToolRiskLevel: fallbackMaxRiskLevel,
    policySummary: options.policySummary ?? inherited?.policySummary,
    delegationProtocol,
  };
}
