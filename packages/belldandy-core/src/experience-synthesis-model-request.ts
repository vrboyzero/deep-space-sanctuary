import { OutboundRequestPolicy } from "@belldandy/protocol";

export const EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES = 1024 * 1024;

export type ExperienceSynthesisModelResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string | null; type?: string | null }> | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
};

export type ExperienceSynthesisModelRequestOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  thinking?: Record<string, unknown>;
  reasoningEffort?: string;
  timeoutMs: number;
  outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
};

/**
 * Owns the credentialed experience-synthesis request boundary. Business parsing and
 * reduced-reasoning retry decisions remain in the memory/experience method owner.
 */
export async function requestExperienceSynthesisModel(
  options: ExperienceSynthesisModelRequestOptions,
): Promise<ExperienceSynthesisModelResponse> {
  const url = buildOpenAIChatCompletionsUrl(options.baseUrl);
  const payload: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
    temperature: 0.2,
    max_tokens: 8_000,
  };
  if (options.thinking) payload.thinking = options.thinking;
  if (options.reasoningEffort) payload.reasoning_effort = options.reasoningEffort;

  const outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [new URL(url).hostname],
    maxRedirects: 0,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Experience synthesis model call timed out after ${options.timeoutMs}ms.`));
  }, options.timeoutMs);

  try {
    const { response } = await outboundRequestPolicy.request({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      maxRedirects: 0,
      idleTimeoutMs: options.timeoutMs,
    });
    const responseText = await readBoundedResponseText(response, controller.signal);
    if (!response.ok) {
      const detail = truncateResponseText(responseText, 200);
      throw new Error(
        `Experience synthesis model call failed: ${response.status}${detail ? ` ${detail}` : ""}`,
      );
    }
    return JSON.parse(responseText) as ExperienceSynthesisModelResponse;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Experience synthesis model call timed out after ${options.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponseText(
  response: Pick<Response, "body" | "headers">,
  abortSignal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new Error("Experience synthesis model response has invalid Content-Length.");
    }
    if (Number(declaredLength) > EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new Error(
        `Experience synthesis model response exceeds ${EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES} byte limit.`,
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
      if (byteLength > EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES) {
        throw new Error(
          `Experience synthesis model response exceeds ${EXPERIENCE_SYNTHESIS_MODEL_MAX_RESPONSE_BYTES} byte limit.`,
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
  const error = new Error("Experience synthesis model call was aborted.");
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

function truncateResponseText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
}

function buildOpenAIChatCompletionsUrl(baseUrl: string): string {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return /\/v\d+$/.test(trimmed)
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}
