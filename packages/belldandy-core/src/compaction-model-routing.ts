import { resolveModelConfig, type ModelProfile } from "@belldandy/agent";
import { findDeepSeekRouteCandidates } from "./deepseek-tier-routing.js";

type PrimaryModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: string;
  wireApi?: string;
};

export type CompactionModelRoute = {
  source: "primary" | "named" | "manual";
  enabled: boolean;
  reason?: "missing_model" | "missing_credentials" | "unsupported_protocol";
  routeRef: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: string;
  wireApi?: string;
  supportsOpenAICompat: boolean;
  auxSummaryVerdict?: {
    strategy: "deepseek_flash_preferred" | "configured_route" | "manual_override" | "default_primary";
    enabled: boolean;
    reason: string;
  };
};

export function resolveCompactionModelRoute(input: {
  enabled: boolean;
  routeRef?: string;
  explicitBaseUrl?: string;
  explicitApiKey?: string;
  explicitModel?: string;
  primaryModelConfig: PrimaryModelConfig;
  modelFallbacks: ModelProfile[];
  deepSeekRoutePolicyEnabled?: boolean;
}): CompactionModelRoute | undefined {
  if (!input.enabled) return undefined;

  const explicitBaseUrl = input.explicitBaseUrl?.trim() ?? "";
  const explicitApiKey = input.explicitApiKey?.trim() ?? "";
  const explicitModel = input.explicitModel?.trim() ?? "";
  const routeRef = input.routeRef?.trim() ?? "";
  const hasExplicitManualOverride = Boolean(explicitBaseUrl || explicitApiKey || explicitModel);
  const hasExplicitRouteRef = Boolean(routeRef);

  const deepSeekAuxFlashRoute = (() => {
    if (input.deepSeekRoutePolicyEnabled === false) {
      return undefined;
    }
    if (hasExplicitManualOverride || hasExplicitRouteRef) {
      return undefined;
    }
    const candidates = findDeepSeekRouteCandidates({
      primaryModelConfig: input.primaryModelConfig,
      modelFallbacks: input.modelFallbacks,
    });
    const primaryModel = input.primaryModelConfig.model.trim().toLowerCase();
    const primaryBaseUrl = input.primaryModelConfig.baseUrl.trim().toLowerCase();
    const primaryLooksDeepSeek = primaryModel.includes("deepseek") || primaryBaseUrl.includes("deepseek");
    if (!primaryLooksDeepSeek) {
      return undefined;
    }
    return candidates.flash;
  })();

  const resolved = hasExplicitManualOverride
    ? {
        baseUrl: explicitBaseUrl || input.primaryModelConfig.baseUrl,
        apiKey: explicitApiKey || input.primaryModelConfig.apiKey,
        model: explicitModel || input.primaryModelConfig.model,
        protocol: input.primaryModelConfig.protocol,
        wireApi: input.primaryModelConfig.wireApi,
        source: "manual" as const,
      }
    : deepSeekAuxFlashRoute
      ? resolveModelConfig(deepSeekAuxFlashRoute.id, input.primaryModelConfig, input.modelFallbacks)
    : resolveModelConfig(routeRef || "primary", input.primaryModelConfig, input.modelFallbacks);

  const protocol = resolved.protocol ?? "openai";
  const supportsOpenAICompat = protocol !== "anthropic";
  const normalizedRouteRef = hasExplicitManualOverride
    ? (routeRef || explicitModel || "manual")
    : deepSeekAuxFlashRoute
      ? deepSeekAuxFlashRoute.id
    : (routeRef || "primary");

  if (!resolved.baseUrl || !resolved.apiKey) {
    return {
      source: resolved.source,
      enabled: false,
      reason: "missing_credentials",
      routeRef: normalizedRouteRef,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      protocol: resolved.protocol,
      wireApi: resolved.wireApi,
      supportsOpenAICompat,
      auxSummaryVerdict: {
        strategy: hasExplicitManualOverride
          ? "manual_override"
          : hasExplicitRouteRef
            ? "configured_route"
            : deepSeekAuxFlashRoute
              ? "deepseek_flash_preferred"
              : "default_primary",
        enabled: Boolean(deepSeekAuxFlashRoute) || !hasExplicitManualOverride,
        reason: hasExplicitManualOverride
          ? "manual_compaction_override"
          : hasExplicitRouteRef
            ? "explicit_compaction_route"
            : deepSeekAuxFlashRoute
              ? "deepseek_primary_with_flash_candidate"
              : "default_compaction_route",
      },
    };
  }

  if (!resolved.model) {
    return {
      source: resolved.source,
      enabled: false,
      reason: "missing_model",
      routeRef: normalizedRouteRef,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      protocol: resolved.protocol,
      wireApi: resolved.wireApi,
      supportsOpenAICompat,
      auxSummaryVerdict: {
        strategy: hasExplicitManualOverride
          ? "manual_override"
          : hasExplicitRouteRef
            ? "configured_route"
            : deepSeekAuxFlashRoute
              ? "deepseek_flash_preferred"
              : "default_primary",
        enabled: Boolean(deepSeekAuxFlashRoute) || !hasExplicitManualOverride,
        reason: hasExplicitManualOverride
          ? "manual_compaction_override"
          : hasExplicitRouteRef
            ? "explicit_compaction_route"
            : deepSeekAuxFlashRoute
              ? "deepseek_primary_with_flash_candidate"
              : "default_compaction_route",
      },
    };
  }

  if (!supportsOpenAICompat) {
    return {
      source: resolved.source,
      enabled: false,
      reason: "unsupported_protocol",
      routeRef: normalizedRouteRef,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      protocol: resolved.protocol,
      wireApi: resolved.wireApi,
      supportsOpenAICompat,
      auxSummaryVerdict: {
        strategy: hasExplicitManualOverride
          ? "manual_override"
          : hasExplicitRouteRef
            ? "configured_route"
            : deepSeekAuxFlashRoute
              ? "deepseek_flash_preferred"
              : "default_primary",
        enabled: Boolean(deepSeekAuxFlashRoute) || !hasExplicitManualOverride,
        reason: hasExplicitManualOverride
          ? "manual_compaction_override"
          : hasExplicitRouteRef
            ? "explicit_compaction_route"
            : deepSeekAuxFlashRoute
              ? "deepseek_primary_with_flash_candidate"
              : "default_compaction_route",
      },
    };
  }

  return {
    source: resolved.source,
    enabled: true,
    routeRef: normalizedRouteRef,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    protocol: resolved.protocol,
    wireApi: resolved.wireApi,
    supportsOpenAICompat,
    auxSummaryVerdict: {
      strategy: hasExplicitManualOverride
        ? "manual_override"
        : hasExplicitRouteRef
          ? "configured_route"
          : deepSeekAuxFlashRoute
            ? "deepseek_flash_preferred"
            : "default_primary",
      enabled: Boolean(deepSeekAuxFlashRoute) || !hasExplicitManualOverride,
      reason: hasExplicitManualOverride
        ? "manual_compaction_override"
        : hasExplicitRouteRef
          ? "explicit_compaction_route"
          : deepSeekAuxFlashRoute
            ? "deepseek_primary_with_flash_candidate"
            : "default_compaction_route",
    },
  };
}
