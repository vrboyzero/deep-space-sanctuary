import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  OpenAIEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingRequestContext,
} from "./index.js";
import type { LegacyEmbeddingProvider } from "./embeddings/types.js";

describe("package-root EmbeddingProvider contract", () => {
  it("accepts the package-root OpenAI class and a custom runtime provider", async () => {
    expectTypeOf<OpenAIEmbeddingProvider>().toMatchTypeOf<EmbeddingProvider>();

    const embed = vi.fn(async (_text: string, _context?: EmbeddingRequestContext) => [0.25, -0.5]);
    const provider: EmbeddingProvider = {
      modelName: "custom-test-model",
      dimension: 2,
      embed,
      embedBatch: async (texts, context) => Promise.all(texts.map((text) => embed(text, context))),
    };
    const context: EmbeddingRequestContext = {
      signal: new AbortController().signal,
      deadlineMs: Date.now() + 1_000,
    };

    await expect(provider.embedBatch(["first", "second"], context)).resolves.toEqual([
      [0.25, -0.5],
      [0.25, -0.5],
    ]);
    expect(embed).toHaveBeenCalledWith("first", context);
  });

  it("keeps the old structured-response shape behind an explicit legacy name", () => {
    const legacy: LegacyEmbeddingProvider = {
      name: "legacy-adapter",
      defaultModel: "legacy-model",
      dimensions: 2,
      embed: async (text) => ({ text, embedding: [0.1, 0.2], dimensions: 2, model: "legacy-model" }),
      embedBatch: async ({ texts }) => ({
        embeddings: texts.map((text) => ({ text, embedding: [0.1, 0.2], dimensions: 2, model: "legacy-model" })),
        provider: "legacy-adapter",
        model: "legacy-model",
      }),
      cosineSimilarity: () => 1,
    };

    expect(legacy.name).toBe("legacy-adapter");
  });
});
