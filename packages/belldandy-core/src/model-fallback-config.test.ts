import { describe, expect, it } from "vitest";

import {
  mergeModelFallbackConfigSecrets,
  parseModelFallbackConfigContent,
  REDACTED_MODEL_SECRET_PLACEHOLDER,
  stringifyModelFallbackConfig,
} from "./model-fallback-config.js";

describe("model fallback config", () => {
  it("normalizes fallback ids and stringifies redacted content", () => {
    const config = parseModelFallbackConfigContent(JSON.stringify({
      fallbacks: [
        {
          displayName: " OpenRouter Main ",
          baseUrl: " https://openrouter.ai/api/v1 ",
          apiKey: " sk-or-test ",
          model: " openai/gpt-4o-mini ",
          protocol: " openai ",
          wireApi: " responses ",
          requestTimeoutMs: 9000,
          maxRetries: 2,
          thinking: {
            type: " enabled ",
            budget_tokens: 2048,
          },
          reasoningEffort: " max ",
          options: {
            num_ctx: 32768,
          },
          requestBodyExtras: {
            chat_template_kwargs: {
              enable_thinking: true,
            },
          },
        },
      ],
    }));

    expect(config.fallbacks).toEqual([
      {
        id: "fallback-0",
        displayName: "OpenRouter Main",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-test",
        model: "openai/gpt-4o-mini",
        protocol: "openai",
        wireApi: "responses",
        requestTimeoutMs: 9000,
        maxRetries: 2,
        retryBackoffMs: undefined,
        proxyUrl: undefined,
        thinking: {
          type: "enabled",
          budget_tokens: 2048,
        },
        reasoningEffort: "max",
        options: {
          num_ctx: 32768,
        },
        requestBodyExtras: {
          chat_template_kwargs: {
            enable_thinking: true,
          },
        },
      },
    ]);

    const redacted = stringifyModelFallbackConfig(config, { redactApiKeys: true });
    expect(redacted).toContain('"id": "fallback-0"');
    expect(redacted).toContain(`"apiKey": "${REDACTED_MODEL_SECRET_PLACEHOLDER}"`);
    expect(redacted).toContain('"thinking"');
    expect(redacted).toContain('"reasoningEffort": "max"');
    expect(redacted).toContain('"options"');
    expect(redacted).toContain('"num_ctx": 32768');
    expect(redacted).toContain('"requestBodyExtras"');
    expect(redacted).toContain('"chat_template_kwargs"');
    expect(redacted).not.toContain("sk-or-test");
  });

  it("preserves existing secrets when update payload keeps [REDACTED]", () => {
    const existing = parseModelFallbackConfigContent(JSON.stringify({
      fallbacks: [
        {
          id: "openrouter-main",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-existing",
          model: "openai/gpt-4o-mini",
        },
      ],
    }));
    const edited = parseModelFallbackConfigContent(JSON.stringify({
      fallbacks: [
        {
          id: "openrouter-main",
          displayName: "OpenRouter Main",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: REDACTED_MODEL_SECRET_PLACEHOLDER,
          model: "openai/gpt-4o",
        },
        {
          id: "anthropic-alt",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-new",
          model: "claude-sonnet-4",
        },
      ],
    }));

    const merged = mergeModelFallbackConfigSecrets(existing, edited);
    expect(merged.fallbacks[0]?.apiKey).toBe("sk-existing");
    expect(merged.fallbacks[0]?.model).toBe("openai/gpt-4o");
    expect(merged.fallbacks[1]?.apiKey).toBe("sk-new");
  });

  it("rejects [REDACTED] for a brand-new fallback", () => {
    const existing = parseModelFallbackConfigContent(JSON.stringify({ fallbacks: [] }));
    const edited = parseModelFallbackConfigContent(JSON.stringify({
      fallbacks: [
        {
          id: "new-fallback",
          baseUrl: "https://example.com/v1",
          apiKey: REDACTED_MODEL_SECRET_PLACEHOLDER,
          model: "gpt-4.1-mini",
        },
      ],
    }));

    expect(() => mergeModelFallbackConfigSecrets(existing, edited)).toThrow(
      'fallback "new-fallback" uses [REDACTED] but no existing apiKey was found',
    );
  });
});
