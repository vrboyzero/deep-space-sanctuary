import { describe, expect, it } from "vitest";

import {
  calculateUsageCostUsd,
  resolveCompactionThreshold,
  resolveProviderCapabilityFromEnv,
} from "./provider-capability.js";

function createEnv(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

describe("provider capability", () => {
  it("reads capability overrides from env", () => {
    const capability = resolveProviderCapabilityFromEnv(createEnv({
      BELLDANDY_MODEL_CONTEXT_WINDOW: "128000",
      BELLDANDY_MODEL_CACHE_ENABLED: "true",
      BELLDANDY_MODEL_JSON_RELIABILITY: "high",
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "2.5",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "10",
      BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.5",
      BELLDANDY_MODEL_CACHE_CREATION_USD_PER_1M: "1.25",
    }));

    expect(capability).toEqual({
      cache: "supported",
      contextWindow: 128000,
      pricing: {
        inputUsdPer1M: 2.5,
        outputUsdPer1M: 10,
        cacheReadUsdPer1M: 0.5,
        cacheCreationUsdPer1M: 1.25,
        source: "env",
      },
      jsonReliability: "high",
      source: "env",
    });
  });

  it("derives compaction threshold from context window when available", () => {
    expect(resolveCompactionThreshold({
      fallbackThreshold: 12000,
      contextWindow: 128000,
      contextWindowFraction: 0.1,
    })).toEqual({
      tokenThreshold: 12800,
      derivedFromContextWindow: true,
    });
  });

  it("falls back to fixed compaction threshold when context window is unknown", () => {
    expect(resolveCompactionThreshold({
      fallbackThreshold: 12000,
      contextWindowFraction: 0.1,
    })).toEqual({
      tokenThreshold: 12000,
      derivedFromContextWindow: false,
    });
  });

  it("calculates usage cost with cache token pricing", () => {
    expect(calculateUsageCostUsd({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 250,
      cache_creation_input_tokens: 400,
      prompt_cache_hit_tokens: 800,
    }, {
      inputUsdPer1M: 2,
      outputUsdPer1M: 8,
      cacheReadUsdPer1M: 0.5,
      cacheCreationUsdPer1M: 1,
      source: "env",
    })).toEqual({
      inputUsd: 0.002,
      outputUsd: 0.004,
      cacheReadUsd: 0.000125,
      cacheCreationUsd: 0.0004,
      cacheSavingsUsd: 0.0012,
      totalUsd: 0.006525,
    });
  });
});
