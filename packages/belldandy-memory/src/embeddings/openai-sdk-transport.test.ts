import { OutboundRequestPolicy } from "@belldandy/protocol";
import { describe, expect, it, vi } from "vitest";

import { OpenAIEmbeddingProvider } from "./openai.js";

type OutboundRequestInput = Parameters<OutboundRequestPolicy["request"]>[0];

function encodeEmbedding(values: number[]): string {
  return Buffer.from(new Float32Array(values).buffer).toString("base64");
}

describe("OpenAI embedding SDK transport compatibility", () => {
  it("parses a bounded batch response through the real OpenAI SDK", async () => {
    const request = vi.fn(async (_input: OutboundRequestInput) => ({
      response: Response.json({
        data: [
          { embedding: encodeEmbedding([0.25, -0.5]), index: 0, object: "embedding" },
          { embedding: encodeEmbedding([0.75, 1]), index: 1, object: "embedding" },
        ],
        model: "embedding-model",
        object: "list",
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
      url: new URL("https://embedding.example.test/v1/embeddings"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const provider = new OpenAIEmbeddingProvider({
      apiKey: "embedding-secret",
      baseURL: "https://embedding.example.test/v1",
      model: "embedding-model",
      passagePrefix: "passage: ",
      outboundRequestPolicy: { request },
    });

    await expect(provider.embedBatch(["first", "second"])).resolves.toEqual([
      [0.25, -0.5],
      [0.75, 1],
    ]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]?.[0].body))).toEqual({
      model: "embedding-model",
      input: ["passage: first", "passage: second"],
      encoding_format: "base64",
    });
  });
});
