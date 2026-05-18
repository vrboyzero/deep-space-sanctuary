import type { ModelProfile } from "@belldandy/agent";
import {
  inferModelMediaCapabilities,
  inferProviderId,
  inferProviderMediaCapabilities,
} from "./media-capability-registry.js";
import { buildDeepSeekVirtualRouteEntries } from "./deepseek-tier-routing.js";

export type PrimaryModelCatalogConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: string;
  wireApi?: string;
};

export type ProviderCatalogEntry = {
  id: string;
  label: string;
  onboardingScopes: string[];
  capabilities: string[];
};

export type ModelCatalogEntry = {
  id: string;
  displayName: string;
  model: string;
  providerId: string;
  providerLabel: string;
  source: "primary" | "named" | "virtual";
  authStatus: "ready" | "missing";
  protocol?: string;
  wireApi?: string;
  capabilities: string[];
  isDefault: boolean;
};

export type ProviderModelCatalogSnapshot = {
  providers: ProviderCatalogEntry[];
  models: ModelCatalogEntry[];
  currentDefault: string;
  preferredProviderIds: string[];
  manualEntrySupported: boolean;
};

type ProviderDescriptor = {
  label: string;
  onboardingScopes: string[];
  capabilities: string[];
};

const GENERIC_PROVIDER_SCOPES = ["api_key", "base_url", "model"];
const GENERIC_PROVIDER_CAPABILITIES = ["chat"];

const PROVIDER_REGISTRY: Record<string, ProviderDescriptor> = {
  mock: {
    label: "Mock",
    onboardingScopes: [],
    capabilities: ["development"],
  },
  openai: {
    label: "OpenAI",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  anthropic: {
    label: "Anthropic",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  moonshot: {
    label: "Moonshot",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  openrouter: {
    label: "OpenRouter",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  groq: {
    label: "Groq",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  dashscope: {
    label: "DashScope",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  deepseek: {
    label: "DeepSeek",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  ollama: {
    label: "Ollama",
    onboardingScopes: ["base_url", "model"],
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  azure: {
    label: "Azure OpenAI",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  xai: {
    label: "xAI",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  together: {
    label: "Together",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  "openai-compatible": {
    label: "OpenAI-Compatible",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
  custom: {
    label: "Custom Provider",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: GENERIC_PROVIDER_CAPABILITIES,
  },
};

function humanizeProviderId(value: string): string {
  return value
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeProtocol(value: string | undefined): "openai" | "anthropic" | undefined {
  if (value === "openai" || value === "anthropic") return value;
  return undefined;
}

function describeProvider(providerId: string): ProviderDescriptor {
  return PROVIDER_REGISTRY[providerId] ?? {
    label: humanizeProviderId(providerId) || "Custom Provider",
    onboardingScopes: GENERIC_PROVIDER_SCOPES,
    capabilities: uniqueStrings([
      ...GENERIC_PROVIDER_CAPABILITIES,
      ...inferProviderMediaCapabilities(providerId),
    ]),
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = value.trim();
    if (!normalized) continue;
    seen.add(normalized);
  }
  return [...seen];
}

export function normalizePreferredProviderIds(values: string[] | string | undefined): string[] {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(",")
      : [];
  const seen = new Set<string>();
  for (const value of rawValues) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    seen.add(normalized);
  }
  return [...seen];
}

function buildModelCapabilities(input: {
  providerId?: string;
  protocol?: string;
  wireApi?: string;
  model?: string;
}): string[] {
  return uniqueStrings([
    "chat",
    normalizeProtocol(input.protocol) === "anthropic" ? "anthropic_api" : undefined,
    input.wireApi === "responses" ? "responses_api" : undefined,
    ...inferModelMediaCapabilities({
      providerId: input.providerId,
      protocol: input.protocol,
      wireApi: input.wireApi,
      model: input.model,
    }),
  ]);
}

function buildModelCatalogEntry(input: {
  id: string;
  displayName: string;
  model: string;
  providerId: string;
  source: "primary" | "named";
  authStatus: "ready" | "missing";
  protocol?: string;
  wireApi?: string;
  isDefault: boolean;
}): ModelCatalogEntry {
  const provider = describeProvider(input.providerId);
  return {
    id: input.id,
    displayName: input.displayName,
    model: input.model,
    providerId: input.providerId,
    providerLabel: provider.label,
    source: input.source,
    authStatus: input.authStatus,
    ...(input.protocol ? { protocol: input.protocol } : {}),
    ...(input.wireApi ? { wireApi: input.wireApi } : {}),
    capabilities: buildModelCapabilities({
      providerId: input.providerId,
      protocol: input.protocol,
      wireApi: input.wireApi,
      model: input.model,
    }),
    isDefault: input.isDefault,
  };
}

export function buildProviderModelCatalog(input: {
  primaryModelConfig?: PrimaryModelCatalogConfig;
  modelFallbacks?: ModelProfile[];
  currentDefault?: string;
  preferredProviderIds?: string[];
  deepSeekRoutePolicyEnabled?: boolean;
}): ProviderModelCatalogSnapshot {
  const currentDefault = typeof input.currentDefault === "string" && input.currentDefault.trim()
    ? input.currentDefault.trim()
    : "primary";
  const preferredProviderIds = normalizePreferredProviderIds(input.preferredProviderIds);
  const providers = new Map<string, ProviderCatalogEntry>();
  const models: ModelCatalogEntry[] = [];

  const registerProvider = (providerId: string) => {
    if (providers.has(providerId)) return;
    const descriptor = describeProvider(providerId);
    providers.set(providerId, {
      id: providerId,
      label: descriptor.label,
      onboardingScopes: [...descriptor.onboardingScopes],
      capabilities: uniqueStrings([
        ...descriptor.capabilities,
        ...inferProviderMediaCapabilities(providerId),
      ]),
    });
  };

  const primary = input.primaryModelConfig;
  if (primary?.model) {
    const providerId = inferProviderId({
      baseUrl: primary.baseUrl,
      protocol: primary.protocol,
    });
    registerProvider(providerId);
    models.push(buildModelCatalogEntry({
      id: "primary",
      displayName: `${primary.model}${currentDefault === "primary" ? "（默认）" : ""}`,
      model: primary.model,
      providerId,
      source: "primary",
      authStatus: primary.apiKey && primary.baseUrl && primary.model ? "ready" : "missing",
      protocol: normalizeProtocol(primary.protocol),
      wireApi: primary.wireApi,
      isDefault: currentDefault === "primary",
    }));
  }

  for (const fallback of input.modelFallbacks ?? []) {
    const fallbackId = fallback.id ?? fallback.model;
    const providerId = inferProviderId({
      baseUrl: fallback.baseUrl,
      protocol: fallback.protocol,
    });
    registerProvider(providerId);
    models.push(buildModelCatalogEntry({
      id: fallbackId,
      displayName: `${fallback.displayName ?? fallback.model}${fallbackId === currentDefault ? "（默认）" : ""}`,
      model: fallback.model,
      providerId,
      source: "named",
      authStatus: fallback.apiKey && fallback.baseUrl && fallback.model ? "ready" : "missing",
      protocol: normalizeProtocol(fallback.protocol),
      wireApi: fallback.wireApi,
      isDefault: fallbackId === currentDefault,
    }));
  }

  models.push(...buildDeepSeekVirtualRouteEntries({
    primaryModelConfig: input.primaryModelConfig,
    modelFallbacks: input.modelFallbacks,
    policyEnabled: input.deepSeekRoutePolicyEnabled,
  }));

  return {
    providers: [...providers.values()],
    models,
    currentDefault,
    preferredProviderIds,
    manualEntrySupported: true,
  };
}
