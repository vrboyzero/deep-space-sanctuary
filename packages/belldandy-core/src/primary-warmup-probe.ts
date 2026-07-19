import { OutboundRequestPolicy } from "@belldandy/protocol";

export const PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES = 64 * 1024;

export type PrimaryWarmupWireApi = "chat_completions" | "responses";

export type PrimaryWarmupProbeResult =
  | { ok: true }
  | { ok: false; status: number; responseBody: string };

export type PrimaryWarmupProbeOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: PrimaryWarmupWireApi;
  thinking?: unknown;
  reasoningEffort?: string;
  timeoutMs: number;
  outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
};

/**
 * Owns the configured primary-model probe transport boundary so the gateway entrypoint
 * only decides whether to probe and how to apply a failed probe's cooldown.
 */
export async function requestPrimaryModelWarmup(
  options: PrimaryWarmupProbeOptions,
): Promise<PrimaryWarmupProbeResult> {
  const trimmedBase = options.baseUrl.replace(/\/+$/, "");
  const base = /\/v\d+$/.test(trimmedBase) ? trimmedBase : `${trimmedBase}/v1`;
  const isResponsesWireApi = options.wireApi === "responses";
  const url = new URL(isResponsesWireApi ? `${base}/responses` : `${base}/chat/completions`);
  const body: Record<string, unknown> = isResponsesWireApi
    ? { model: options.model, input: "ping", max_output_tokens: 8 }
    : { model: options.model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 };
  if (options.thinking) body.thinking = options.thinking;
  if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;

  const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [url.hostname],
    maxRedirects: 0,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Primary model warmup timed out after ${options.timeoutMs}ms.`));
  }, options.timeoutMs);

  try {
    const { response } = await outboundRequestPolicy.request({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      maxRedirects: 0,
      idleTimeoutMs: options.timeoutMs,
    });

    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: true };
    }

    const responseBody = await readBoundedWarmupErrorBody(response, controller.signal);
    return { ok: false, status: response.status, responseBody };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedWarmupErrorBody(
  response: Pick<Response, "body" | "headers">,
  abortSignal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new Error("Primary model warmup response has invalid Content-Length.");
    }
    if (Number(declaredLength) > PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES) {
      await cancelResponseBody(response);
      throw new Error(
        `Primary model warmup response exceeds ${PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES} byte limit.`,
      );
    }
  }

  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      throwIfAborted(abortSignal);
      const next = await readWithAbort(reader, abortSignal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES) {
        throw new Error(
          `Primary model warmup response exceeds ${PRIMARY_WARMUP_MAX_ERROR_BODY_BYTES} byte limit.`,
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!completed) await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(abortSignal);
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function readWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Primary model warmup was aborted.");
  error.name = "AbortError";
  throw error;
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已决定拒绝正文，取消失败不得覆盖原始限界错误。
  }
}
