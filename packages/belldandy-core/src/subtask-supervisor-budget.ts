import type { AgentLaunchSpec } from "@belldandy/agent";

export type SubTaskSupervisorRiskLevel = "low" | "medium" | "high" | "critical";

export type SubTaskSupervisorBudgetLimits = {
  maxActiveChildren: number;
  maxVerifierChildren: number;
  maxRunWallTimeMs: number;
  toolLoopIterationBudget: number;
  maxTotalTokens: number;
  maxCostUsd?: number;
  maxHighRiskToolCalls: number;
  maxToolRiskLevel: SubTaskSupervisorRiskLevel;
};

export type SubTaskSupervisorBudgetSnapshot = SubTaskSupervisorBudgetLimits & {
  activeChildren: number;
  activeVerifiers: number;
};

const RISK_LEVELS: readonly SubTaskSupervisorRiskLevel[] = ["low", "medium", "high", "critical"];

export function resolveSubTaskSupervisorBudgetLimits(input: {
  maxActiveChildren: number;
  maxVerifierChildren?: number;
  maxRunWallTimeMs: number;
  toolLoopIterationBudget?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  maxHighRiskToolCalls?: number;
  maxToolRiskLevel?: SubTaskSupervisorRiskLevel;
}): SubTaskSupervisorBudgetLimits {
  return {
    maxActiveChildren: positiveInteger(input.maxActiveChildren, 1),
    maxVerifierChildren: positiveInteger(input.maxVerifierChildren, 1),
    maxRunWallTimeMs: positiveInteger(input.maxRunWallTimeMs, 120_000),
    toolLoopIterationBudget: positiveInteger(input.toolLoopIterationBudget, 8),
    maxTotalTokens: positiveInteger(input.maxTotalTokens, 128_000),
    ...(positiveNumber(input.maxCostUsd) === undefined ? {} : { maxCostUsd: positiveNumber(input.maxCostUsd) }),
    maxHighRiskToolCalls: positiveInteger(input.maxHighRiskToolCalls, 4),
    maxToolRiskLevel: normalizeRiskLevel(input.maxToolRiskLevel) ?? "high",
  };
}

export function tightenSubTaskLaunchBudgets(
  launchSpec: AgentLaunchSpec,
  limits: SubTaskSupervisorBudgetLimits,
): AgentLaunchSpec {
  return {
    ...launchSpec,
    maxRunWallTimeMs: Math.min(
      launchSpec.timeoutMs,
      positiveInteger(launchSpec.maxRunWallTimeMs, limits.maxRunWallTimeMs),
      limits.maxRunWallTimeMs,
    ),
    toolLoopIterationBudget: restrictUnlimitedLimit(
      launchSpec.toolLoopIterationBudget,
      limits.toolLoopIterationBudget,
    ),
    maxTotalTokens: Math.min(
      positiveInteger(launchSpec.maxTotalTokens, limits.maxTotalTokens),
      limits.maxTotalTokens,
    ),
    ...resolveCostLimit(launchSpec.maxCostUsd, limits.maxCostUsd),
    maxHighRiskToolCalls: restrictUnlimitedLimit(
      launchSpec.maxHighRiskToolCalls,
      limits.maxHighRiskToolCalls,
    ),
    maxToolRiskLevel: restrictRiskLevel(launchSpec.maxToolRiskLevel, limits.maxToolRiskLevel),
  };
}

function resolveCostLimit(
  requested: number | undefined,
  configured: number | undefined,
): Pick<AgentLaunchSpec, "maxCostUsd"> {
  const requestedLimit = positiveNumber(requested);
  const configuredLimit = positiveNumber(configured);
  if (requestedLimit === undefined && configuredLimit === undefined) return {};
  if (requestedLimit === undefined) return { maxCostUsd: configuredLimit };
  if (configuredLimit === undefined) return { maxCostUsd: requestedLimit };
  return { maxCostUsd: Math.min(requestedLimit, configuredLimit) };
}

function restrictUnlimitedLimit(requested: number | undefined, configured: number): number {
  if (requested === 0) return configured;
  return Math.min(positiveInteger(requested, configured), configured);
}

function restrictRiskLevel(
  requested: AgentLaunchSpec["maxToolRiskLevel"],
  configured: SubTaskSupervisorRiskLevel,
): SubTaskSupervisorRiskLevel {
  const requestedLevel = normalizeRiskLevel(requested);
  if (!requestedLevel) return configured;
  return RISK_LEVELS.indexOf(requestedLevel) <= RISK_LEVELS.indexOf(configured)
    ? requestedLevel
    : configured;
}

function normalizeRiskLevel(value: unknown): SubTaskSupervisorRiskLevel | undefined {
  return RISK_LEVELS.includes(value as SubTaskSupervisorRiskLevel)
    ? value as SubTaskSupervisorRiskLevel
    : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}
