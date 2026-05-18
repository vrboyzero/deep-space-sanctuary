import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAIChatAgent } from "./openai.js";
import type { SystemPromptSection } from "./system-prompt.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function collectItems(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("OpenAIChatAgent prompt snapshot", () => {
  it("captures provider-native system blocks for single-text provider inspection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
    }));

    const snapshots: any[] = [];
    const sections: SystemPromptSection[] = [
      {
        id: "core",
        label: "core",
        source: "core",
        priority: 0,
        text: "You are Belldandy.",
      },
      {
        id: "methodology",
        label: "methodology",
        source: "methodology",
        priority: 100,
        text: "# Methodology",
      },
    ];

    const agent = new OpenAIChatAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      stream: false,
      systemPrompt: "You are Belldandy.\n# Methodology",
      systemPromptSections: sections,
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-openai-snapshot",
      text: "hello",
      meta: {
        runId: "run-openai-snapshot",
        promptDeltas: [
          {
            id: "attachment-1",
            deltaType: "attachment",
            role: "attachment",
            text: "[Attachment]",
          },
        ],
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      conversationId: "conv-openai-snapshot",
      runId: "run-openai-snapshot",
      providerNativeSystemBlocks: [
        {
          blockType: "static-persona",
          sourceSectionIds: ["core"],
          sourceDeltaIds: [],
          cacheControlEligible: true,
        },
        {
          blockType: "static-capability",
          sourceSectionIds: ["methodology"],
          sourceDeltaIds: [],
          cacheControlEligible: true,
        },
      ],
      deltas: [
        {
          id: "attachment-1",
          deltaType: "attachment",
          role: "attachment",
          text: "[Attachment]",
        },
      ],
    });
    expect(snapshots[0].inputMeta).toMatchObject({
      runId: "run-openai-snapshot",
    });
    expect((snapshots[0].inputMeta as any)?.promptDeltas).toBeUndefined();
  });

  it("maps caller aborts to stopped without emitting a final message", async () => {
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        markFetchStarted();
        if (signal?.aborted) {
          reject(createAbortError("Stopped by user."));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(createAbortError("Stopped by user."));
        }, { once: true });
      });
    });

    const controller = new AbortController();
    const agent = new OpenAIChatAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      stream: false,
    });

    const itemsPromise = collectItems(agent.run({
      conversationId: "conv-openai-stop",
      text: "hello",
      abortSignal: controller.signal,
    }));

    await fetchStarted;
    controller.abort("Stopped by user.");

    const items = await itemsPromise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(items).toEqual([
      { type: "status", status: "running" },
      { type: "status", status: "stopped" },
    ]);
  });

  it("passes thinking and reasoning_effort from fallback profiles to chat completions", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      if (String(url).includes("primary.example.com")) {
        return new Response(JSON.stringify({ error: "primary unavailable" }), { status: 500 });
      }
      return createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
      });
    });

    const agent = new OpenAIChatAgent({
      baseUrl: "https://primary.example.com/v1",
      apiKey: "primary-key",
      model: "primary-model",
      stream: false,
      fallbacks: [{
        id: "deepseek-fallback",
        baseUrl: "https://api.deepseek.com",
        apiKey: "fallback-key",
        model: "deepseek-v4-pro",
        thinking: {
          type: "enabled",
          budget_tokens: 2048,
        },
        reasoningEffort: "max",
        options: {
          num_ctx: 32768,
        },
      }],
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-openai-thinking",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).not.toHaveProperty("thinking");
    expect(requestBodies[1]).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: {
        type: "enabled",
        budget_tokens: 2048,
      },
      reasoning_effort: "max",
      options: {
        num_ctx: 32768,
      },
    });
  });

  it("passes thinking and reasoning_effort to responses payloads", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "done" }],
        }],
      });
    });

    const agent = new OpenAIChatAgent({
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      stream: false,
      wireApi: "responses",
      thinking: {
        type: "enabled",
      },
      reasoningEffort: "high",
      options: {
        num_ctx: 16384,
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-openai-responses-thinking",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(requestBodies[0]).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: {
        type: "enabled",
      },
      reasoning_effort: "high",
      options: {
        num_ctx: 16384,
      },
    });
  });
});

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
