import path from "node:path";
import type { Tool, ToolContext, ToolRuntimeLaunchSpec } from "./types.js";
import { getToolContract, type ToolContractFamily, type ToolContractRiskLevel } from "./tool-contract.js";
import { getToolContractV2 } from "./tool-contract-v2.js";
import { buildLaunchPermissionDeniedReason, buildLaunchRolePolicyDeniedReason, renderToolContractV2Summary } from "./tool-contract-render.js";

export type LaunchPermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions"
  | "dontAsk"
  | "auto"
  | "confirm";

export type LaunchIsolationMode =
  | "workspace"
  | "cwd"
  | "worktree";

export type RuntimeLaunchPermissionDecision =
  | { allowed: true; mode?: LaunchPermissionMode }
  | { allowed: false; mode: LaunchPermissionMode; reasonMessage: string };

export type RuntimeLaunchRolePolicyDecision =
  | { allowed: true }
  | { allowed: false; reasonMessage: string };

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeLaunchPermissionMode(value: unknown): LaunchPermissionMode | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "default":
    case "plan":
    case "acceptEdits":
    case "bypassPermissions":
    case "dontAsk":
    case "auto":
    case "confirm":
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeLaunchIsolationMode(value: unknown): LaunchIsolationMode | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "workspace":
    case "cwd":
    case "worktree":
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeLaunchRole(value: unknown): ToolRuntimeLaunchSpec["role"] | undefined {
  switch (normalizeOptionalString(value)) {
    case "default":
    case "commander":
    case "coder":
    case "researcher":
    case "verifier":
      return normalizeOptionalString(value) as ToolRuntimeLaunchSpec["role"];
    default:
      return undefined;
  }
}

export function normalizeLaunchAllowedToolFamilies(value: unknown): ToolContractFamily[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is ToolContractFamily => (
      item === "network-read"
      || item === "workspace-read"
      || item === "workspace-write"
      || item === "patch"
      || item === "command-exec"
      || item === "process-control"
      || item === "session-orchestration"
      || item === "memory"
      || item === "browser"
      || item === "service-admin"
      || item === "goal-governance"
      || item === "other"
    ));
  return items.length > 0 ? [...new Set(items)] : undefined;
}

export function normalizeLaunchMaxToolRiskLevel(value: unknown): ToolContractRiskLevel | undefined {
  switch (normalizeOptionalString(value)) {
    case "low":
    case "medium":
    case "high":
    case "critical":
      return normalizeOptionalString(value) as ToolContractRiskLevel;
    default:
      return undefined;
  }
}

function compareRiskLevels(left: ToolContractRiskLevel, right: ToolContractRiskLevel): number {
  const order: ToolContractRiskLevel[] = ["low", "medium", "high", "critical"];
  return order.indexOf(left) - order.indexOf(right);
}

export function evaluateLaunchPermissionMode(
  tool: Tool,
  launchSpec?: ToolRuntimeLaunchSpec,
): RuntimeLaunchPermissionDecision {
  const mode = normalizeLaunchPermissionMode(launchSpec?.permissionMode);
  if (!mode || mode === "auto" || mode === "bypassPermissions" || mode === "dontAsk") {
    return { allowed: true, mode };
  }

  const contract = getToolContract(tool);
  if (!contract) {
    const contractV2 = getToolContractV2(tool);
    return {
      allowed: false,
      mode,
      reasonMessage: buildLaunchPermissionDeniedReason({
        toolName: tool.definition.name,
        mode,
        summary: contractV2 ? renderToolContractV2Summary(contractV2) : "缺少治理契约。",
        permissionRequired: true,
      }),
    };
  }

  if (mode === "plan") {
    if (contract.isReadOnly) {
      return { allowed: true, mode };
    }
    return {
      allowed: false,
      mode,
      reasonMessage: buildLaunchPermissionDeniedReason({
        toolName: tool.definition.name,
        mode,
        summary: renderToolContractV2Summary(getToolContractV2(tool) ?? {
          name: tool.definition.name,
          needsPermission: contract.needsPermission,
          isReadOnly: contract.isReadOnly,
          isConcurrencySafe: contract.isConcurrencySafe,
          recommendedWhen: [],
          avoidWhen: [],
          confirmWhen: [],
          preflightChecks: [],
          fallbackStrategy: [],
          expectedOutput: [],
          sideEffectSummary: [],
          hasGovernanceContract: true,
          hasBehaviorContract: false,
          family: contract.family,
          riskLevel: contract.riskLevel,
          activityDescription: contract.activityDescription,
          outputPersistencePolicy: contract.outputPersistencePolicy,
          channels: contract.channels,
          safeScopes: contract.safeScopes,
        }),
        permissionRequired: contract.needsPermission,
      }),
    };
  }

  if (mode === "acceptEdits") {
    if (!contract.needsPermission || contract.family === "workspace-write" || contract.family === "patch") {
      return { allowed: true, mode };
    }
    return {
      allowed: false,
      mode,
      reasonMessage: buildLaunchPermissionDeniedReason({
        toolName: tool.definition.name,
        mode,
        summary: getToolContractV2(tool) ? renderToolContractV2Summary(getToolContractV2(tool)!) : undefined,
        permissionRequired: true,
      }),
    };
  }

  if (!contract.needsPermission) {
    return { allowed: true, mode };
  }

  return {
    allowed: false,
    mode,
    reasonMessage: buildLaunchPermissionDeniedReason({
      toolName: tool.definition.name,
      mode,
      summary: getToolContractV2(tool) ? renderToolContractV2Summary(getToolContractV2(tool)!) : undefined,
      permissionRequired: true,
    }),
  };
}

export function evaluateLaunchRolePolicy(
  tool: Tool,
  launchSpec?: ToolRuntimeLaunchSpec,
): RuntimeLaunchRolePolicyDecision {
  const role = normalizeLaunchRole(launchSpec?.role);
  const allowedToolFamilies = normalizeLaunchAllowedToolFamilies(launchSpec?.allowedToolFamilies);
  const maxToolRiskLevel = normalizeLaunchMaxToolRiskLevel(launchSpec?.maxToolRiskLevel);
  if (!role && !allowedToolFamilies && !maxToolRiskLevel) {
    return { allowed: true };
  }

  const contract = getToolContract(tool);
  if (!contract) {
    const contractV2 = getToolContractV2(tool);
    return {
      allowed: false,
      reasonMessage: buildLaunchRolePolicyDeniedReason({
        toolName: tool.definition.name,
        role,
        summary: contractV2 ? renderToolContractV2Summary(contractV2) : "缺少治理契约。",
      }),
    };
  }

  if (allowedToolFamilies && !allowedToolFamilies.includes(contract.family)) {
    return {
      allowed: false,
      reasonMessage: buildLaunchRolePolicyDeniedReason({
        toolName: tool.definition.name,
        role,
        family: contract.family,
        summary: getToolContractV2(tool) ? renderToolContractV2Summary(getToolContractV2(tool)!) : undefined,
      }),
    };
  }

  if (maxToolRiskLevel && compareRiskLevels(contract.riskLevel, maxToolRiskLevel) > 0) {
    return {
      allowed: false,
      reasonMessage: buildLaunchRolePolicyDeniedReason({
        toolName: tool.definition.name,
        role,
        family: contract.family,
        riskLevel: contract.riskLevel,
        maxToolRiskLevel,
        summary: getToolContractV2(tool) ? renderToolContractV2Summary(getToolContractV2(tool)!) : undefined,
      }),
    };
  }

  return { allowed: true };
}

export function resolveRuntimeFilesystemScope(
  context: Pick<ToolContext, "workspaceRoot" | "extraWorkspaceRoots" | "defaultCwd" | "launchSpec">,
): {
  workspaceRoot: string;
  extraWorkspaceRoots?: string[];
} {
  const isolationMode = normalizeLaunchIsolationMode(context.launchSpec?.isolationMode);
  if ((isolationMode === "cwd" || isolationMode === "worktree") && context.defaultCwd) {
    return {
      workspaceRoot: path.resolve(context.defaultCwd),
      extraWorkspaceRoots: undefined,
    };
  }
  return {
    workspaceRoot: context.workspaceRoot,
    extraWorkspaceRoots: context.extraWorkspaceRoots,
  };
}
