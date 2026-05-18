import { describe, expect, it } from "vitest";

import { buildProviderModelCatalog } from "./provider-model-catalog.js";

describe("provider model catalog", () => {
  it("builds provider and model metadata without leaking secrets", () => {
    const snapshot = buildProviderModelCatalog({
      currentDefault: "claude-opus",
      preferredProviderIds: ["openrouter", "anthropic", "openrouter"],
      primaryModelConfig: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-5",
        protocol: "openai",
        wireApi: "responses",
      },
      modelFallbacks: [
        {
          id: "claude-opus",
          displayName: "Claude Opus 4.5",
          baseUrl: "https://api.anthropic.com",
          apiKey: "sk-claude",
          model: "claude-opus-4-5",
          protocol: "anthropic",
        },
      ],
    });

    expect(snapshot.currentDefault).toBe("claude-opus");
    expect(snapshot.preferredProviderIds).toEqual(["openrouter", "anthropic"]);
    expect(snapshot.manualEntrySupported).toBe(true);
    expect(snapshot.providers).toEqual([
      {
        id: "openai",
        label: "OpenAI",
        onboardingScopes: ["api_key", "base_url", "model"],
        capabilities: ["chat", "audio_transcription", "tts_output", "image_generation"],
      },
      {
        id: "anthropic",
        label: "Anthropic",
        onboardingScopes: ["api_key", "base_url", "model"],
        capabilities: ["chat"],
      },
    ]);
    expect(snapshot.models).toEqual([
      expect.objectContaining({
        id: "primary",
        model: "gpt-5",
        providerId: "openai",
        providerLabel: "OpenAI",
        source: "primary",
        authStatus: "missing",
        wireApi: "responses",
        capabilities: expect.arrayContaining(["chat", "responses_api", "image_input", "text_inline"]),
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-opus",
        displayName: "Claude Opus 4.5（默认）",
        model: "claude-opus-4-5",
        providerId: "anthropic",
        providerLabel: "Anthropic",
        source: "named",
        authStatus: "ready",
        protocol: "anthropic",
        capabilities: expect.arrayContaining(["chat", "anthropic_api", "image_input", "text_inline"]),
        isDefault: true,
      }),
    ]);
    expect((snapshot.models[0] as Record<string, unknown>).apiKey).toBeUndefined();
    expect((snapshot.models[1] as Record<string, unknown>).baseUrl).toBeUndefined();
  });

  it("adds deepseek virtual tier routes only when both flash and pro are available", () => {
    const snapshot = buildProviderModelCatalog({
      primaryModelConfig: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-primary",
        model: "gpt-5",
      },
      modelFallbacks: [
        {
          id: "deepseek-flash-main",
          displayName: "DeepSeek Flash",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-flash",
          model: "deepseek-v4-flash",
        },
        {
          id: "deepseek-pro-main",
          displayName: "DeepSeek Pro",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-pro",
          model: "deepseek-v4-pro",
        },
      ],
    });

    expect(snapshot.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "deepseek:auto",
        providerId: "deepseek",
        source: "virtual",
      }),
      expect.objectContaining({
        id: "deepseek:flash",
        providerId: "deepseek",
        source: "virtual",
      }),
      expect.objectContaining({
        id: "deepseek:pro",
        providerId: "deepseek",
        source: "virtual",
      }),
    ]));
  });

  it("does not add deepseek virtual tier routes when one tier is missing", () => {
    const snapshot = buildProviderModelCatalog({
      modelFallbacks: [
        {
          id: "deepseek-flash-main",
          displayName: "DeepSeek Flash",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-flash",
          model: "deepseek-v4-flash",
        },
      ],
    });

    expect(snapshot.models.some((item) => item.id === "deepseek:auto")).toBe(false);
    expect(snapshot.models.some((item) => item.id === "deepseek:flash")).toBe(false);
    expect(snapshot.models.some((item) => item.id === "deepseek:pro")).toBe(false);
  });

  it("does not add deepseek virtual tier routes when policy is disabled", () => {
    const snapshot = buildProviderModelCatalog({
      deepSeekRoutePolicyEnabled: false,
      modelFallbacks: [
        {
          id: "deepseek-flash-main",
          displayName: "DeepSeek Flash",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-flash",
          model: "deepseek-v4-flash",
        },
        {
          id: "deepseek-pro-main",
          displayName: "DeepSeek Pro",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-pro",
          model: "deepseek-v4-pro",
        },
      ],
    });

    expect(snapshot.models.some((item) => item.id === "deepseek:auto")).toBe(false);
    expect(snapshot.models.some((item) => item.id === "deepseek:flash")).toBe(false);
    expect(snapshot.models.some((item) => item.id === "deepseek:pro")).toBe(false);
  });
});
