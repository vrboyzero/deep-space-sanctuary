import type { ModelProfile } from "@belldandy/agent";
import type { ConversationPromptSnapshotArtifact } from "./conversation-prompt-snapshot.js";
import type { PrimaryModelCatalogConfig } from "./provider-model-catalog.js";

export const DEEPSEEK_ROUTE_AUTO = "deepseek:auto";
export const DEEPSEEK_ROUTE_FLASH = "deepseek:flash";
export const DEEPSEEK_ROUTE_PRO = "deepseek:pro";

export type DeepSeekVirtualRouteId =
  | typeof DEEPSEEK_ROUTE_AUTO
  | typeof DEEPSEEK_ROUTE_FLASH
  | typeof DEEPSEEK_ROUTE_PRO;

export type DeepSeekTierRouteDecision = {
  requestedRoute: string;
  resolvedModelId?: string;
  selectedTier?: "flash" | "pro";
  routeMode: "passthrough" | "deepseek_virtual";
  degraded: boolean;
  reason: string;
  evidence: string[];
  available: {
    flash?: string;
    pro?: string;
  };
  /** Phase 4 步骤 3：tier pinning 信息 */
  tierPinning?: {
    pinned: boolean;
    previousTier?: "flash" | "pro";
    reason?: string;
  };
};

type DeepSeekRouteCandidate = {
  id: string;
  tier: "flash" | "pro";
  model: string;
};

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isDeepSeekRouteId(value: string | undefined): value is DeepSeekVirtualRouteId {
  return value === DEEPSEEK_ROUTE_AUTO || value === DEEPSEEK_ROUTE_FLASH || value === DEEPSEEK_ROUTE_PRO;
}

function includesDeepSeek(value: string | undefined): boolean {
  return typeof value === "string" && value.toLowerCase().includes("deepseek");
}

function inferDeepSeekTier(model: string | undefined): "flash" | "pro" | undefined {
  const normalized = normalizeOptionalString(model)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("flash")) return "flash";
  if (normalized.includes("pro")) return "pro";
  return undefined;
}

function getStructureSignature(snapshot?: ConversationPromptSnapshotArtifact): string | undefined {
  const value = snapshot?.snapshot?.inputMeta?.structureSignature;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getOrderingGuardStatus(snapshot?: ConversationPromptSnapshotArtifact): string | undefined {
  const value = snapshot?.snapshot?.inputMeta?.orderingGuard;
  if (!value || typeof value !== "object") return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" && status.trim() ? status.trim() : undefined;
}

function getWarmupCoordination(snapshot?: ConversationPromptSnapshotArtifact): {
  eligible?: boolean;
  status?: string;
  recommendation?: string;
  reason?: string;
} | undefined {
  const value = snapshot?.snapshot?.inputMeta?.warmupCoordination;
  return value && typeof value === "object"
    ? {
      ...(typeof (value as { eligible?: unknown }).eligible === "boolean"
        ? { eligible: (value as { eligible?: boolean }).eligible }
        : {}),
      ...(typeof (value as { status?: unknown }).status === "string"
        ? { status: (value as { status?: string }).status }
        : {}),
      ...(typeof (value as { recommendation?: unknown }).recommendation === "string"
        ? { recommendation: (value as { recommendation?: string }).recommendation }
        : {}),
      ...(typeof (value as { reason?: unknown }).reason === "string"
        ? { reason: (value as { reason?: string }).reason }
        : {}),
    }
    : undefined;
}

function getCacheFamilyAffinity(snapshot?: ConversationPromptSnapshotArtifact): {
  status?: string;
  reason?: string;
} | undefined {
  const value = snapshot?.snapshot?.inputMeta?.cacheFamilyAffinity;
  return value && typeof value === "object"
    ? {
      ...(typeof (value as { status?: unknown }).status === "string"
        ? { status: (value as { status?: string }).status }
        : {}),
      ...(typeof (value as { reason?: unknown }).reason === "string"
        ? { reason: (value as { reason?: string }).reason }
        : {}),
    }
    : undefined;
}

/** Phase 4 步骤 3：从 prompt snapshot 中读取前一次请求的 tier */
function getPreviousTier(snapshot?: ConversationPromptSnapshotArtifact): "flash" | "pro" | undefined {
  const route = snapshot?.snapshot?.inputMeta?.deepseekRoute;
  if (!route || typeof route !== "object") return undefined;
  const selectedTier = (route as { selectedTier?: unknown }).selectedTier;
  if (selectedTier === "flash" || selectedTier === "pro") return selectedTier;
  return undefined;
}

export function findDeepSeekRouteCandidates(input: {
  primaryModelConfig?: PrimaryModelCatalogConfig;
  modelFallbacks?: ModelProfile[];
}): {
  flash?: DeepSeekRouteCandidate;
  pro?: DeepSeekRouteCandidate;
} {
  const candidates: DeepSeekRouteCandidate[] = [];
  const primaryTier = inferDeepSeekTier(input.primaryModelConfig?.model);
  if (primaryTier && includesDeepSeek(input.primaryModelConfig?.baseUrl)) {
    candidates.push({
      id: "primary",
      tier: primaryTier,
      model: input.primaryModelConfig?.model ?? "",
    });
  }

  for (const fallback of input.modelFallbacks ?? []) {
    const tier = inferDeepSeekTier(fallback.model);
    if (!tier) continue;
    if (!includesDeepSeek(fallback.baseUrl) && !includesDeepSeek(fallback.model) && !includesDeepSeek(fallback.id)) {
      continue;
    }
    candidates.push({
      id: fallback.id ?? fallback.model,
      tier,
      model: fallback.model,
    });
  }

  return {
    flash: candidates.find((item) => item.tier === "flash"),
    pro: candidates.find((item) => item.tier === "pro"),
  };
}

export function buildDeepSeekVirtualRouteEntries(input: {
  primaryModelConfig?: PrimaryModelCatalogConfig;
  modelFallbacks?: ModelProfile[];
  policyEnabled?: boolean;
}): Array<{
  id: DeepSeekVirtualRouteId;
  displayName: string;
  model: string;
  providerId: "deepseek";
  providerLabel: "DeepSeek";
  source: "virtual";
  authStatus: "ready";
  capabilities: string[];
  isDefault: boolean;
}> {
  if (input.policyEnabled === false) {
    return [];
  }
  const candidates = findDeepSeekRouteCandidates(input);
  if (!candidates.flash || !candidates.pro) {
    return [];
  }
  return [
    {
      id: DEEPSEEK_ROUTE_AUTO,
      displayName: "DeepSeek Auto",
      model: "deepseek:auto",
      providerId: "deepseek",
      providerLabel: "DeepSeek",
      source: "virtual",
      authStatus: "ready",
      capabilities: ["chat", "tier_routing", "deepseek_auto"],
      isDefault: false,
    },
    {
      id: DEEPSEEK_ROUTE_FLASH,
      displayName: "DeepSeek Flash",
      model: candidates.flash.model,
      providerId: "deepseek",
      providerLabel: "DeepSeek",
      source: "virtual",
      authStatus: "ready",
      capabilities: ["chat", "tier_routing", "deepseek_flash"],
      isDefault: false,
    },
    {
      id: DEEPSEEK_ROUTE_PRO,
      displayName: "DeepSeek Pro",
      model: candidates.pro.model,
      providerId: "deepseek",
      providerLabel: "DeepSeek",
      source: "virtual",
      authStatus: "ready",
      capabilities: ["chat", "tier_routing", "deepseek_pro"],
      isDefault: false,
    },
  ];
}

export function resolveDeepSeekTierRoute(input: {
  requestedModelId?: string;
  primaryModelConfig?: PrimaryModelCatalogConfig;
  modelFallbacks?: ModelProfile[];
  previousPromptSnapshot?: ConversationPromptSnapshotArtifact;
  policyEnabled?: boolean;
}): DeepSeekTierRouteDecision {
  const requestedRoute = normalizeOptionalString(input.requestedModelId) ?? "default";
  if (input.policyEnabled === false) {
    return {
      requestedRoute,
      routeMode: "passthrough",
      degraded: false,
      reason: "deepseek_route_policy_disabled",
      evidence: ["policy_disabled"],
      available: {},
    };
  }
  const candidates = findDeepSeekRouteCandidates(input);
  const available = {
    ...(candidates.flash ? { flash: candidates.flash.id } : {}),
    ...(candidates.pro ? { pro: candidates.pro.id } : {}),
  };

  if (!isDeepSeekRouteId(requestedRoute)) {
    return {
      requestedRoute,
      routeMode: "passthrough",
      degraded: false,
      reason: "non_deepseek_virtual_route",
      evidence: [],
      available,
    };
  }

  if (requestedRoute === DEEPSEEK_ROUTE_FLASH) {
    return {
      requestedRoute,
      resolvedModelId: candidates.flash?.id,
      selectedTier: candidates.flash ? "flash" : undefined,
      routeMode: "deepseek_virtual",
      degraded: !candidates.flash,
      reason: candidates.flash ? "explicit_flash_route" : "flash_candidate_missing",
      evidence: candidates.flash ? ["explicit_flash"] : ["missing_flash_candidate"],
      available,
    };
  }

  if (requestedRoute === DEEPSEEK_ROUTE_PRO) {
    return {
      requestedRoute,
      resolvedModelId: candidates.pro?.id ?? candidates.flash?.id,
      selectedTier: candidates.pro ? "pro" : candidates.flash ? "flash" : undefined,
      routeMode: "deepseek_virtual",
      degraded: !candidates.pro,
      reason: candidates.pro ? "explicit_pro_route" : "pro_candidate_missing_fallback_flash",
      evidence: candidates.pro ? ["explicit_pro"] : ["missing_pro_candidate", "fallback_flash"],
      available,
    };
  }

  if (!candidates.flash || !candidates.pro) {
    return {
      requestedRoute,
      resolvedModelId: candidates.flash?.id ?? candidates.pro?.id,
      selectedTier: candidates.flash ? "flash" : candidates.pro ? "pro" : undefined,
      routeMode: "deepseek_virtual",
      degraded: true,
      reason: "deepseek_tier_candidates_incomplete",
      evidence: [
        candidates.flash ? "flash_available" : "flash_missing",
        candidates.pro ? "pro_available" : "pro_missing",
      ],
      available,
    };
  }

  const previous = input.previousPromptSnapshot;
  const evidence: string[] = [];
  const warmup = getWarmupCoordination(previous);
  const affinity = getCacheFamilyAffinity(previous);
  const orderingStatus = getOrderingGuardStatus(previous);
  const structureSignature = getStructureSignature(previous);
  // Phase 4 步骤 3：读取前一次 tier 用于 soft pinning
  const previousTier = getPreviousTier(previous);

  if (structureSignature) {
    evidence.push("previous_structure_signature_present");
  } else {
    evidence.push("previous_structure_signature_missing");
  }
  if (warmup?.status) {
    evidence.push(`warmup:${warmup.status}`);
  }
  if (warmup?.recommendation) {
    evidence.push(`warmup_recommendation:${warmup.recommendation}`);
  }
  if (affinity?.status) {
    evidence.push(`affinity:${affinity.status}`);
  }
  if (orderingStatus) {
    evidence.push(`ordering:${orderingStatus}`);
  }
  if (previousTier) {
    evidence.push(`previous_tier:${previousTier}`);
  }

  // Phase 4 步骤 3：soft tier pinning
  // 如果前一次使用了 pro 且没有降级理由（ordering risk / affinity misaligned），保持 pro
  if (previousTier === "pro" && candidates.pro) {
    const shouldDowngrade = orderingStatus === "risk" || affinity?.status === "misaligned";
    if (!shouldDowngrade) {
      evidence.push("tier_pinning:kept_pro");
      return {
        requestedRoute,
        resolvedModelId: candidates.pro.id,
        selectedTier: "pro",
        routeMode: "deepseek_virtual",
        degraded: false,
        reason: "auto_pinned_to_pro",
        evidence,
        available,
        tierPinning: { pinned: true, previousTier: "pro", reason: "no_downgrade_signal" },
      };
    } else {
      evidence.push("tier_pinning:downgraded_from_pro");
    }
  }

  // 如果前一次使用了 flash 且没有升级理由，保持 flash
  if (previousTier === "flash" && candidates.flash) {
    const shouldUpgrade = Boolean(
      structureSignature
      && warmup?.eligible === true
      && warmup.status === "warm_candidate"
      && warmup.recommendation === "proceed"
      && affinity?.status === "aligned"
      && orderingStatus !== "risk"
    );
    if (!shouldUpgrade) {
      evidence.push("tier_pinning:kept_flash");
      return {
        requestedRoute,
        resolvedModelId: candidates.flash.id,
        selectedTier: "flash",
        routeMode: "deepseek_virtual",
        degraded: false,
        reason: "auto_pinned_to_flash",
        evidence,
        available,
        tierPinning: { pinned: true, previousTier: "flash", reason: "no_upgrade_signal" },
      };
    } else {
      evidence.push("tier_pinning:upgraded_from_flash");
    }
  }

  const shouldUsePro = Boolean(
    structureSignature
    && warmup?.eligible === true
    && warmup.status === "warm_candidate"
    && warmup.recommendation === "proceed"
    && affinity?.status === "aligned"
    && orderingStatus !== "risk",
  );

  if (shouldUsePro) {
    return {
      requestedRoute,
      resolvedModelId: candidates.pro.id,
      selectedTier: "pro",
      routeMode: "deepseek_virtual",
      degraded: false,
      reason: "auto_promoted_to_pro",
      evidence,
      available,
    };
  }

  return {
    requestedRoute,
    resolvedModelId: candidates.flash.id,
    selectedTier: "flash",
    routeMode: "deepseek_virtual",
    degraded: false,
    reason: "auto_kept_on_flash",
    evidence,
    available,
  };
}
