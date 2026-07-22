import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestModelTransportMock } = vi.hoisted(() => ({
  requestModelTransportMock: vi.fn(),
}));

vi.mock("./model-request-transport.js", () => ({
  requestModelTransport: requestModelTransportMock,
}));

import {
  FailoverAttemptError,
  FailoverClient,
  type FailoverExecutionSummary,
  type ModelProfile,
} from "./failover-client.js";
import { consumeModelResponseStreamWithFailover } from "./model-response-stream-failover.js";

const encoder = new TextEncoder();

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "primary",
    baseUrl: "https://primary.example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    ...overrides,
  };
}

function completedResponse(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\n`,
      ));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function failingResponse(firstEvent?: Record<string, unknown>): Response {
  let pullCount = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pullCount === 0 && firstEvent) {
        pullCount += 1;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(firstEvent)}\n\n`));
        return;
      }
      controller.error(new Error("stream reset"));
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function runStream(input: {
  client: FailoverClient;
  signal?: AbortSignal;
  timeoutMs?: number;
  onSummary?: (summary: FailoverExecutionSummary) => void;
  onTextDelta?: (delta: string, control: { commit: () => void }) => void | Promise<void>;
}) {
  return consumeModelResponseStreamWithFailover({
    failoverClient: input.client,
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? 5_000,
    onSummary: input.onSummary,
    buildRequest: (selected) => ({
      url: `${selected.baseUrl}/chat/completions`,
      init: { method: "POST" },
    }),
    resolveProtocol: () => ({ protocol: "openai", wireApi: "chat_completions" }),
    onTextDelta: input.onTextDelta ?? ((_delta, control) => control.commit()),
  });
}

describe("consumeModelResponseStreamWithFailover", () => {
  beforeEach(() => {
    requestModelTransportMock.mockReset();
  });

  it("falls back when the first response body fails before any commit", async () => {
    requestModelTransportMock
      .mockResolvedValueOnce(failingResponse())
      .mockResolvedValueOnce(completedResponse("backup answer"));
    const client = new FailoverClient({
      primary: profile(),
      fallbacks: [profile({
        id: "backup",
        baseUrl: "https://backup.example.test/v1",
        model: "backup-model",
      })],
    });
    const deltas: string[] = [];

    const result = await runStream({
      client,
      onTextDelta: (delta, control) => {
        deltas.push(delta);
        control.commit();
      },
    });

    expect(deltas).toEqual(["backup answer"]);
    expect(result.profile.id).toBe("backup");
    expect(result.response.content).toBe("backup answer");
    expect(result.summary).toMatchObject({
      finalStatus: "success",
      requestCount: 2,
      stepCounts: { crossProfileFallbacks: 1 },
    });
  });

  it("does not retry or fall back after visible text is committed", async () => {
    requestModelTransportMock.mockResolvedValueOnce(failingResponse({
      choices: [{ delta: { content: "partial" } }],
    }));
    const client = new FailoverClient({
      primary: profile(),
      fallbacks: [profile({ id: "backup", baseUrl: "https://backup.example.test/v1" })],
    });
    const deltas: string[] = [];
    const onSummary = vi.fn();

    const pending = runStream({
      client,
      onSummary,
      onTextDelta: (delta, control) => {
        deltas.push(delta);
        control.commit();
      },
    });

    await expect(pending).rejects.toMatchObject({
      name: "FailoverAttemptError",
      committed: true,
      summary: { finalStatus: "committed_failure", requestCount: 1 },
    });
    expect(deltas).toEqual(["partial"]);
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
    expect(onSummary).toHaveBeenCalledOnce();
    expect(onSummary).toHaveBeenCalledWith(expect.objectContaining({
      finalStatus: "committed_failure",
      requestCount: 1,
    }));
  });

  it("fails closed on a pre-commit protocol format error", async () => {
    requestModelTransportMock.mockResolvedValueOnce(new Response(
      `data: {invalid json}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    const client = new FailoverClient({
      primary: profile(),
      fallbacks: [profile({ id: "backup", baseUrl: "https://backup.example.test/v1" })],
    });

    await expect(runStream({ client })).rejects.toMatchObject({
      name: "FailoverAttemptError",
      reason: "format",
      committed: false,
      summary: { finalStatus: "non_retryable", requestCount: 1 },
    });
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
  });

  it("commits on the first tool fragment even when no text is visible", async () => {
    requestModelTransportMock.mockResolvedValueOnce(failingResponse({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            function: { name: "read", arguments: "{\"path\":" },
          }],
        },
      }],
    }));
    const client = new FailoverClient({
      primary: profile(),
      fallbacks: [profile({ id: "backup", baseUrl: "https://backup.example.test/v1" })],
    });

    await expect(runStream({ client })).rejects.toMatchObject({
      name: "FailoverAttemptError",
      committed: true,
    });
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
  });

  it("keeps caller abort linked while the response body is pending", async () => {
    const onCancel = vi.fn();
    requestModelTransportMock.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      cancel: onCancel,
    }), { status: 200 }));
    const client = new FailoverClient({ primary: profile() });
    const controller = new AbortController();
    const pending = runStream({ client, signal: controller.signal });

    await vi.waitFor(() => expect(requestModelTransportMock).toHaveBeenCalledOnce());
    controller.abort("cancelled after headers");

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "cancelled after headers",
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the attempt deadline active while the response body is pending", async () => {
    const onCancel = vi.fn();
    const onSummary = vi.fn();
    requestModelTransportMock.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      cancel: onCancel,
    }), { status: 200 }));
    const client = new FailoverClient({ primary: profile() });

    await expect(runStream({ client, timeoutMs: 50, onSummary })).rejects.toMatchObject({
      name: "FailoverExhaustedError",
      summary: { finalStatus: "exhausted", finalReason: "timeout", requestCount: 1 },
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSummary).toHaveBeenCalledOnce();
    expect(requestModelTransportMock).toHaveBeenCalledTimes(1);
  });

  it("exposes committed failures as the dedicated failover error type", () => {
    const error = new FailoverAttemptError({
      message: "stream failed",
      reason: "unknown",
      committed: true,
    });
    expect(error).toMatchObject({
      name: "FailoverAttemptError",
      reason: "unknown",
      committed: true,
    });
  });
});
