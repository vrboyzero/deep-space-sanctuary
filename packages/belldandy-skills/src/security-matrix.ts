import type { Tool } from "./types.js";
import {
  getToolContract,
  type ToolContract,
  type ToolContractChannel,
  type ToolContractSafeScope,
} from "./tool-contract.js";

export type SecurityMatrixChannel = ToolContractChannel | "cli";
export type SecurityMatrixSafeScope = ToolContractSafeScope;

export interface SecurityMatrixSubject<
  C extends string = SecurityMatrixChannel,
  S extends string = SecurityMatrixSafeScope,
> {
  channels: readonly C[];
  safeScopes: readonly S[];
}

export interface SecurityMatrixFilter<
  C extends string = SecurityMatrixChannel,
  S extends string = SecurityMatrixSafeScope,
> {
  channel?: C;
  allowedSafeScopes?: Iterable<S>;
}

const DEFAULT_SAFE_SCOPES_BY_CHANNEL: Record<
  SecurityMatrixChannel,
  readonly ToolContractSafeScope[]
> = {
  cli: ["local-safe", "web-safe", "bridge-safe", "remote-safe", "privileged"],
  web: ["web-safe", "remote-safe"],
  "browser-extension": ["bridge-safe", "remote-safe"],
  gateway: ["local-safe", "web-safe", "bridge-safe", "remote-safe", "privileged"],
};

export function matchesSecurityMatrixSubject<
  C extends string,
  S extends string,
>(
  subject: SecurityMatrixSubject<C, S>,
  filter: SecurityMatrixFilter<C, S> = {},
): boolean {
  if (filter.channel && !subject.channels.includes(filter.channel)) {
    return false;
  }

  if (!filter.allowedSafeScopes) {
    return true;
  }

  const allowedScopes = new Set(filter.allowedSafeScopes);
  return subject.safeScopes.some((scope) => allowedScopes.has(scope));
}

export function resolveSafeScopesForChannel(
  channel: SecurityMatrixChannel,
  options: {
    include?: Iterable<ToolContractSafeScope>;
    exclude?: Iterable<ToolContractSafeScope>;
    allowPrivilegedForWeb?: boolean;
  } = {},
): ToolContractSafeScope[] {
  const resolved = new Set(DEFAULT_SAFE_SCOPES_BY_CHANNEL[channel]);
  const allowPrivilegedForWeb = options.allowPrivilegedForWeb
    ?? process.env.BELLDANDY_WEB_ALLOW_PRIVILEGED_SAFE_SCOPE === "true";

  if (channel === "web" && allowPrivilegedForWeb) {
    resolved.add("privileged");
  }

  if (options.include) {
    for (const scope of options.include) {
      resolved.add(scope);
    }
  }

  if (options.exclude) {
    for (const scope of options.exclude) {
      resolved.delete(scope);
    }
  }

  return [...resolved];
}

export interface ToolContractAccessPolicy
  extends SecurityMatrixFilter<ToolContractChannel, ToolContractSafeScope> {
  includeToolsWithoutContract?: boolean;
  blockedToolNames?: Iterable<string>;
}

export type ToolContractDenialReason =
  | "missing-contract"
  | "channel"
  | "safe-scope"
  | "blocked";

export interface ToolContractAccessDecision {
  allowed: boolean;
  contract?: ToolContract;
  reason?: ToolContractDenialReason;
}

export function evaluateToolContractAccess(
  tool: Tool,
  policy: ToolContractAccessPolicy = {},
): ToolContractAccessDecision {
  const blockedToolNames = policy.blockedToolNames
    ? new Set(policy.blockedToolNames)
    : undefined;
  if (blockedToolNames?.has(tool.definition.name)) {
    return { allowed: false, reason: "blocked" };
  }

  const contract = getToolContract(tool);
  if (!contract) {
    return {
      allowed: policy.includeToolsWithoutContract ?? true,
      reason: policy.includeToolsWithoutContract === false ? "missing-contract" : undefined,
    };
  }

  if (!matchesSecurityMatrixSubject(contract, policy)) {
    if (policy.channel && !contract.channels.includes(policy.channel)) {
      return { allowed: false, contract, reason: "channel" };
    }

    return { allowed: false, contract, reason: "safe-scope" };
  }

  return { allowed: true, contract };
}
