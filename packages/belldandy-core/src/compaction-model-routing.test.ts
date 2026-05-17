import { describe, expect, it } from "vitest";

import { resolveCompactionModelRoute } from "./compaction-model-routing.js";

const primaryModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-primary",
  model: "gpt-5",
  protocol: "openai" as const,
  wireApi: "chat_completions" as const,
};

describe("resolveCompactionModelRoute", () => {
  it("falls back to primary route by default", () => {
    expect(resolveCompactionModelRoute({
      enabled: true,
      primaryModelConfig,
      modelFallbacks: [],
    })).toMatchObject({
      enabled: true,
      source: "primary",
      routeRef: "primary",
      model: "gpt-5",
      baseUrl: "https://api.openai.com/v1",
      supportsOpenAICompat: true,
    });
  });

  it("resolves named fallback route when configured", () => {
    expect(resolveCompactionModelRoute({
      enabled: true,
      routeRef: "openrouter-mini",
      primaryModelConfig,
      modelFallbacks: [{
        id: "openrouter-mini",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-openrouter",
        model: "openai/gpt-4.1-mini",
        wireApi: "responses",
      }],
    })).toMatchObject({
      enabled: true,
      source: "named",
      routeRef: "openrouter-mini",
      model: "openai/gpt-4.1-mini",
      baseUrl: "https://openrouter.ai/api/v1",
      wireApi: "responses",
    });
  });

  it("prefers explicit compaction override fields over routeRef", () => {
    expect(resolveCompactionModelRoute({
      enabled: true,
      routeRef: "primary",
      explicitBaseUrl: "https://compaction.example.com/v1",
      explicitApiKey: "sk-compaction",
      explicitModel: "gpt-4.1-mini",
      primaryModelConfig,
      modelFallbacks: [],
    })).toMatchObject({
      enabled: true,
      source: "manual",
      routeRef: "primary",
      model: "gpt-4.1-mini",
      baseUrl: "https://compaction.example.com/v1",
    });
  });

  it("disables non openai-compatible anthropic routes in the first version", () => {
    expect(resolveCompactionModelRoute({
      enabled: true,
      routeRef: "claude-fast",
      primaryModelConfig,
      modelFallbacks: [{
        id: "claude-fast",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-claude",
        model: "claude-sonnet-4",
        protocol: "anthropic",
      }],
    })).toMatchObject({
      enabled: false,
      source: "named",
      routeRef: "claude-fast",
      reason: "unsupported_protocol",
      protocol: "anthropic",
    });
  });
});
