import { resolveModelConfig, type ModelProfile } from "@belldandy/agent";

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
};

export function resolveCompactionModelRoute(input: {
  enabled: boolean;
  routeRef?: string;
  explicitBaseUrl?: string;
  explicitApiKey?: string;
  explicitModel?: string;
  primaryModelConfig: PrimaryModelConfig;
  modelFallbacks: ModelProfile[];
}): CompactionModelRoute | undefined {
  if (!input.enabled) return undefined;

  const explicitBaseUrl = input.explicitBaseUrl?.trim() ?? "";
  const explicitApiKey = input.explicitApiKey?.trim() ?? "";
  const explicitModel = input.explicitModel?.trim() ?? "";
  const routeRef = input.routeRef?.trim() ?? "";

  const resolved = explicitBaseUrl || explicitApiKey || explicitModel
    ? {
        baseUrl: explicitBaseUrl || input.primaryModelConfig.baseUrl,
        apiKey: explicitApiKey || input.primaryModelConfig.apiKey,
        model: explicitModel || input.primaryModelConfig.model,
        protocol: input.primaryModelConfig.protocol,
        wireApi: input.primaryModelConfig.wireApi,
        source: "manual" as const,
      }
    : resolveModelConfig(routeRef || "primary", input.primaryModelConfig, input.modelFallbacks);

  const protocol = resolved.protocol ?? "openai";
  const supportsOpenAICompat = protocol !== "anthropic";
  const normalizedRouteRef = explicitBaseUrl || explicitApiKey || explicitModel
    ? (routeRef || explicitModel || "manual")
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
  };
}
