import type { BelldandyRole } from "@belldandy/protocol";

import {
  getGatewayMethodPolicy,
  type GatewayCapability,
  type GatewayMethodPolicy,
} from "./gateway-method-registry.js";

export type GatewayRequestIdentity = {
  subjectId: string;
  role: BelldandyRole;
  authenticated: boolean;
  paired: boolean;
  capabilities: readonly GatewayCapability[];
};

export type AdmissionErrorCode =
  | "unknown_method"
  | "authentication_required"
  | "pairing_required"
  | "role_forbidden"
  | "capability_required";

export type AdmissionDecision =
  | { allowed: true }
  | {
    allowed: false;
    policy?: GatewayMethodPolicy;
    error: { code: AdmissionErrorCode; message: string };
  };

const PAIRED_GATEWAY_CAPABILITIES: readonly GatewayCapability[] = [
  "gateway.read",
  "gateway.write",
  "gateway.admin",
  "workflow.execute",
];

/**
 * 当前 pairing 仍与既有 Gateway 行为一样代表完整本机控制权；显式 capability
 * 集合为后续角色收敛、HTTP/WS 共享 admission 以及外部 Adapter 提供稳定入口。
 */
export function getPairedGatewayCapabilities(): readonly GatewayCapability[] {
  return PAIRED_GATEWAY_CAPABILITIES;
}

export function admitGatewayRequest(input: {
  method: string;
  identity: GatewayRequestIdentity;
}): AdmissionDecision {
  const policy = getGatewayMethodPolicy(input.method);
  if (!policy) {
    return reject("unknown_method", "Requested method is not available.");
  }
  if (!input.identity.authenticated) {
    return reject("authentication_required", "Authenticated connection required.", policy);
  }
  if (!policy.allowedRoles.includes(input.identity.role)) {
    return reject("role_forbidden", "Current role cannot call this method.", policy);
  }
  if (policy.requiresPairing && !input.identity.paired) {
    return reject("pairing_required", "Pairing approval required.", policy);
  }
  if (policy.requiredCapability && !input.identity.capabilities.includes(policy.requiredCapability)) {
    return reject("capability_required", "Current identity lacks the required capability.", policy);
  }
  return { allowed: true };
}

function reject(
  code: AdmissionErrorCode,
  message: string,
  policy?: GatewayMethodPolicy,
): AdmissionDecision {
  return {
    allowed: false,
    ...(policy ? { policy } : {}),
    error: { code, message },
  };
}
