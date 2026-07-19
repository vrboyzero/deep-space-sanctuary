import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestModelTransportMock } = vi.hoisted(() => ({
  requestModelTransportMock: vi.fn(),
}));

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: requestModelTransportMock,
}));

import { FailoverClient, loadModelFallbacks, type ModelProfile } from "./failover-client.js";

function createProfile(overrides?: Partial<ModelProfile>): ModelProfile {
  return {
    id: "primary",
    baseUrl: "https://api.openai.com",
    apiKey: "test-key",
    model: "test-model",
    ...overrides,
  };
}

describe("FailoverClient", () => {
  beforeEach(() => {
    requestModelTransportMock.mockReset();
    requestModelTransportMock.mockImplementation(async (options: { url: string | URL; init: RequestInit }) => (
      fetch(options.url, options.init)
    ));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stops immediately when caller signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
    });
    const controller = new AbortController();
    controller.abort("cancelled before request");

    await expect(
      client.fetchWithFailover({
        signal: controller.signal,
        buildRequest: () => ({
          url: "https://api.openai.com/chat/completions",
          init: {
            method: "POST",
          },
        }),
      }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "cancelled before request",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delegates the active request to the model transport owner without consuming its stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: active\n\n"));
        controller.close();
      },
    });
    const activeResponse = new Response(stream, { status: 200 });
    const legacyFetch = vi.fn(async () => activeResponse);
    vi.stubGlobal("fetch", legacyFetch);
    requestModelTransportMock.mockResolvedValueOnce(activeResponse);
    const client = new FailoverClient({
      primary: createProfile({
        requestTimeoutMs: 45_000,
        proxyUrl: "http://proxy.example.test:8080",
      }),
    });

    const result = await client.fetchWithFailover({
      buildRequest: () => ({
        url: "https://api.openai.com/v1/chat/completions",
        init: {
          method: "POST",
          headers: { Authorization: "Bearer model-secret" },
          body: JSON.stringify({ prompt: "active prompt" }),
        },
      }),
    });

    expect(result.response).toBe(activeResponse);
    expect(result.response.bodyUsed).toBe(false);
    expect(requestModelTransportMock).toHaveBeenCalledWith({
      url: "https://api.openai.com/v1/chat/completions",
      init: expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
      idleTimeoutMs: 45_000,
      proxyUrl: "http://proxy.example.test:8080",
    });
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("forwards caller abort to the active model transport without retrying", async () => {
    requestModelTransportMock.mockImplementationOnce((options: { init: RequestInit }) => (
      new Promise<Response>((_resolve, reject) => {
        const signal = options.init.signal;
        if (!signal) throw new Error("Active transport fixture requires a signal.");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    ));
    const client = new FailoverClient({ primary: createProfile() });
    const controller = new AbortController();
    const pending = client.fetchWithFailover({
      signal: controller.signal,
      maxRetries: 2,
      buildRequest: () => ({
        url: "https://api.openai.com/v1/chat/completions",
        init: { method: "POST" },
      }),
    });

    await Promise.resolve();
    controller.abort("cancelled active model request");

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "cancelled active model request",
    });
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an internal attempt deadline classified as timeout", async () => {
    vi.useFakeTimers();
    requestModelTransportMock.mockImplementationOnce((options: { init: RequestInit }) => (
      new Promise<Response>((_resolve, reject) => {
        const signal = options.init.signal;
        if (!signal) throw new Error("Attempt deadline fixture requires a signal.");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    ));
    const client = new FailoverClient({ primary: createProfile() });
    const pending = client.fetchWithFailover({
      timeoutMs: 25,
      buildRequest: () => ({
        url: "https://api.openai.com/v1/chat/completions",
        init: { method: "POST" },
      }),
    });
    const result = expect(pending).rejects.toMatchObject({
      name: "FailoverExhaustedError",
      attempts: [expect.objectContaining({ reason: "timeout", timeoutMs: 25 })],
      summary: expect.objectContaining({
        finalStatus: "exhausted",
        finalReason: "timeout",
      }),
    });

    await vi.advanceTimersByTimeAsync(25);

    await result;
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
  });

  it("does not continue retry backoff after caller abort", async () => {
    const fetchMock = vi.fn(async () => new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
    });
    const controller = new AbortController();

    const pending = client.fetchWithFailover({
      signal: controller.signal,
      maxRetries: 1,
      retryBackoffMs: 100,
      buildRequest: () => ({
        url: "https://api.openai.com/chat/completions",
        init: {
          method: "POST",
        },
      }),
    });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort("cancelled during retry wait");

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "cancelled during retry wait",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps timeout retries on the same profile when failure is internal timeout", async () => {
    const timeoutError = new Error("request timed out");
    timeoutError.name = "AbortError";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
    });

    const result = await client.fetchWithFailover({
      maxRetries: 1,
      retryBackoffMs: 100,
      buildRequest: () => ({
        url: "https://api.openai.com/chat/completions",
        init: {
          method: "POST",
        },
      }),
    });

    expect(result.profile.id).toBe("primary");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      reason: "timeout",
      attempt: 1,
      maxAttempts: 2,
    });
    expect(result.summary).toMatchObject({
      finalStatus: "success",
      finalProfileId: "primary",
      degraded: true,
      requestCount: 2,
      stepCounts: {
        sameProfileRetries: 1,
        crossProfileFallbacks: 0,
        cooldownSkips: 0,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records cross-profile fallback when primary fails and backup succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
      fallbacks: [createProfile({
        id: "backup",
        baseUrl: "https://backup.example.com",
        model: "backup-model",
      })],
    });

    const result = await client.fetchWithFailover({
      buildRequest: () => ({
        url: "https://api.openai.com/chat/completions",
        init: {
          method: "POST",
        },
      }),
    });

    expect(result.profile.id).toBe("backup");
    expect(result.summary).toMatchObject({
      finalStatus: "success",
      finalProfileId: "backup",
      degraded: true,
      requestCount: 2,
      stepCounts: {
        sameProfileRetries: 0,
        crossProfileFallbacks: 1,
        cooldownSkips: 0,
        terminalFailures: 0,
      },
    });
  });

  it("deduplicates fallback profiles that point to the same effective route as primary", () => {
    const client = new FailoverClient({
      primary: createProfile({
        id: "deepseek-pro-main",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-deepseek",
        model: "deepseek-v4-pro",
        wireApi: "chat_completions",
      }),
      fallbacks: [
        createProfile({
          id: "deepseek-pro-duplicate",
          baseUrl: "https://api.deepseek.com/v1/",
          apiKey: "sk-deepseek",
          model: "deepseek-v4-pro",
          wireApi: "chat_completions",
        }),
        createProfile({
          id: "deepseek-flash-main",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "sk-deepseek",
          model: "deepseek-v4-flash",
          wireApi: "chat_completions",
        }),
      ],
    });

    expect(client.getProfiles().map((item) => item.id)).toEqual([
      "deepseek-pro-main",
      "deepseek-flash-main",
    ]);
  });

  it("treats unsupported-model errors as cross-profile fallback without same-profile retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "your current token plan not support model, MiniMax-M2.7-highspeed (2061)",
        },
      }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile({
        model: "MiniMax-M2.7-highspeed",
      }),
      fallbacks: [createProfile({
        id: "backup",
        baseUrl: "https://backup.example.com",
        model: "backup-model",
      })],
    });

    const result = await client.fetchWithFailover({
      maxRetries: 1,
      retryBackoffMs: 100,
      buildRequest: () => ({
        url: "https://api.openai.com/chat/completions",
        init: {
          method: "POST",
        },
      }),
    });

    expect(result.profile.id).toBe("backup");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      profileId: "primary",
      reason: "unsupported_model",
      attempt: 1,
      maxAttempts: 2,
      status: 500,
    });
    expect(result.summary).toMatchObject({
      finalStatus: "success",
      finalProfileId: "backup",
      requestCount: 2,
      stepCounts: {
        sameProfileRetries: 0,
        crossProfileFallbacks: 1,
      },
      reasonCounts: {
        unsupported_model: 1,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("records cooldown skips before using a fallback profile", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
      fallbacks: [createProfile({
        id: "backup",
        baseUrl: "https://backup.example.com",
        model: "backup-model",
      })],
      bootstrapCooldowns: {
        primary: 60_000,
      },
    });

    const result = await client.fetchWithFailover({
      buildRequest: () => ({
        url: "https://backup.example.com/chat/completions",
        init: {
          method: "POST",
        },
      }),
    });

    expect(result.profile.id).toBe("backup");
    expect(result.summary).toMatchObject({
      finalStatus: "success",
      finalProfileId: "backup",
      requestCount: 1,
      stepCounts: {
        cooldownSkips: 1,
        sameProfileRetries: 0,
        crossProfileFallbacks: 0,
      },
    });
  });

  it("deduplicates repeated cooldown skip logs within the same cooldown window", async () => {
    const info = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
      fallbacks: [createProfile({
        id: "backup",
        baseUrl: "https://backup.example.com",
        model: "backup-model",
      })],
      bootstrapCooldowns: {
        primary: 60_000,
      },
      logger: {
        info,
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const run = () => client.fetchWithFailover({
      buildRequest: () => ({
        url: "https://backup.example.com/chat/completions",
        init: {
          method: "POST",
        },
      }),
    });

    await run();
    await run();

    const cooldownSkipLogs = info.mock.calls
      .filter((call) => call[0] === "failover" && String(call[1]).includes("跳过冷却中的 Profile"));
    expect(cooldownSkipLogs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loads UTF-8 BOM fallback config files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-fallback-bom-"));
    const configPath = path.join(tempDir, "models.json");
    await fs.writeFile(configPath, "\uFEFF" + JSON.stringify({
      fallbacks: [
        {
          id: "backup",
          baseUrl: "https://backup.example.com",
          apiKey: "sk-backup",
          model: "backup-model",
        },
      ],
    }), "utf-8");

    await expect(loadModelFallbacks(configPath)).resolves.toEqual([
      {
        id: "backup",
        displayName: undefined,
        baseUrl: "https://backup.example.com",
        apiKey: "sk-backup",
        model: "backup-model",
        protocol: undefined,
        wireApi: undefined,
        requestTimeoutMs: undefined,
        maxRetries: undefined,
        retryBackoffMs: undefined,
        proxyUrl: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
        options: undefined,
        requestBodyExtras: undefined,
      },
    ]);
  });

  it("loads provider-specific options from fallback config files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-fallback-options-"));
    const configPath = path.join(tempDir, "models.json");
    await fs.writeFile(configPath, JSON.stringify({
      fallbacks: [
        {
          id: "ollama-gemma",
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "ollama",
          model: "gemma4:e4b",
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
    }), "utf-8");

    await expect(loadModelFallbacks(configPath)).resolves.toEqual([
      {
        id: "ollama-gemma",
        displayName: undefined,
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "ollama",
        model: "gemma4:e4b",
        protocol: undefined,
        wireApi: undefined,
        requestTimeoutMs: undefined,
        maxRetries: undefined,
        retryBackoffMs: undefined,
        proxyUrl: undefined,
        thinking: undefined,
        reasoningEffort: undefined,
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
  });

  it("surfaces exhausted summaries when all profiles fail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FailoverClient({
      primary: createProfile(),
      fallbacks: [createProfile({
        id: "backup",
        baseUrl: "https://backup.example.com",
        model: "backup-model",
      })],
    });

    await expect(
      client.fetchWithFailover({
        buildRequest: () => ({
          url: "https://api.openai.com/chat/completions",
          init: {
            method: "POST",
          },
        }),
      }),
    ).rejects.toMatchObject({
      name: "FailoverExhaustedError",
      summary: {
        finalStatus: "exhausted",
        stepCounts: {
          crossProfileFallbacks: 1,
          terminalFailures: 1,
        },
      },
    });
  });
});
