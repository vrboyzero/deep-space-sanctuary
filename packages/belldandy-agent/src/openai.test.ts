import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: (options: { url: string | URL; init: RequestInit }) => (
    fetch(options.url, options.init)
  ),
}));

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
  it("uses the unified stream contract and emits text before Provider completion", async () => {
    let providerCompletedAt = 0;
    let requestPayload: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requestPayload = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : undefined;
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
          ));
          setTimeout(() => {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: " world" }, finish_reason: "stop" }] })}\n\n`,
            ));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            providerCompletedAt = Date.now();
          }, 30);
        },
      }), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const agent = new OpenAIChatAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      stream: true,
    });
    const items: any[] = [];
    let firstDeltaAt = 0;

    for await (const item of agent.run({ conversationId: "conv-openai-stream", text: "hello" })) {
      items.push(item);
      if (item.type === "delta" && firstDeltaAt === 0) firstDeltaAt = Date.now();
    }

    expect(requestPayload?.stream).toBe(true);
    expect(firstDeltaAt).toBeGreaterThan(0);
    expect(firstDeltaAt).toBeLessThan(providerCompletedAt);
    expect(items.filter((item) => item.type === "delta").map((item) => item.delta).join(""))
      .toBe("Hello world");
    expect(items).toContainEqual({ type: "final", text: "Hello world" });
  });

  it("removes a non-streamed provider control-frame suffix without tools", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{ message: {
        content: '{"status":"ok"}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
      } }],
    }));
    const agent = new OpenAIChatAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      stream: false,
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-openai-control-frame",
      text: "return status",
    })) as any[];

    expect(items.filter((item) => item.type === "delta").map((item) => item.delta).join(""))
      .toBe('{"status":"ok"}');
    expect(items).toContainEqual({ type: "final", text: '{"status":"ok"}' });
  });

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

  it("uses a trusted per-run prompt override instead of the resident prompt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(createJsonResponse({
      choices: [{
        message: {
          content: "done",
        },
      }],
    }));

    const snapshots: any[] = [];
    const agent = new OpenAIChatAgent({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-test",
      stream: false,
      systemPrompt: "resident-system-prompt",
      systemPromptSections: [{
        id: "workspace-soul",
        label: "SOUL.md",
        source: "workspace",
        priority: 20,
        text: "resident-system-prompt",
      }],
      onPromptSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-openai-run-prompt-override",
      text: "hello",
      promptOverride: {
        text: "coding-run-system-prompt",
        sections: [{
          id: "coding-run-base",
          label: "coding-run-base",
          source: "core",
          priority: 0,
          text: "coding-run-system-prompt",
        }],
        metadata: {
          codingRunPromptMode: "bounded-coding-run-v1",
        },
      },
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      systemPrompt: "coding-run-system-prompt",
      providerNativeSystemBlocks: [
        expect.objectContaining({
          blockType: "static-capability",
          sourceSectionIds: ["coding-run-base"],
        }),
      ],
      inputMeta: {
        codingRunPromptMode: "bounded-coding-run-v1",
      },
    });
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
        requestBodyExtras: {
          chat_template_kwargs: {
            enable_thinking: true,
          },
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
      chat_template_kwargs: {
        enable_thinking: true,
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
      requestBodyExtras: {
        chat_template_kwargs: {
          enable_thinking: true,
        },
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
      chat_template_kwargs: {
        enable_thinking: true,
      },
    });
  });

  it("merges requestBodyExtras without overriding reserved chat completion fields", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      requestBodies.push(body);
      return createJsonResponse({
        choices: [{
          message: {
            content: "done",
          },
        }],
      });
    });

    const agent = new OpenAIChatAgent({
      baseUrl: "https://apihub.agnes-ai.com/v1",
      apiKey: "test-key",
      model: "agnes-2.0-flash",
      stream: false,
      requestBodyExtras: {
        model: "should-not-win",
        messages: [{ role: "user", content: "should-not-win" }],
        stream: true,
        max_tokens: 1,
        chat_template_kwargs: {
          enable_thinking: true,
        },
      },
    });

    const items = await collectItems(agent.run({
      conversationId: "conv-openai-request-body-extras-protected",
      text: "hello",
    }));

    expect(items).toContainEqual({ type: "final", text: "done" });
    expect(requestBodies[0]).toMatchObject({
      model: "agnes-2.0-flash",
      stream: false,
      max_tokens: 4096,
      chat_template_kwargs: {
        enable_thinking: true,
      },
    });
    expect(requestBodies[0]?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
  });
});

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
