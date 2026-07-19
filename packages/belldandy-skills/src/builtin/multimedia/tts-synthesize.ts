import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import {
  OutboundRequestPolicy,
  OutboundRequestPolicyError,
} from "@belldandy/protocol";
import {
  isAbortError,
  raceWithAbort,
  sleepWithAbort,
  throwIfAborted,
  toAbortError,
} from "../../abort-utils.js";
import {
  BoundedResponseLimitError,
  parsePositiveByteLimit,
  persistBoundedResponseToFile,
} from "../remote-response-file.js";

const DEFAULT_TTS_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const DASHSCOPE_REST_MAX_REDIRECTS = 0;
const DASHSCOPE_REST_IDLE_TIMEOUT_MS = 15_000;
const DASHSCOPE_REST_MAX_RESPONSE_BYTES = 1024 * 1024;
const DASHSCOPE_ASSET_MAX_REDIRECTS = 3;
const DASHSCOPE_ASSET_IDLE_TIMEOUT_MS = 15_000;

export type SynthesizeResult = {
  webPath: string;
  htmlAudio: string;
};

export type SynthesizeOptions = {
  text: string;
  stateDir: string;
  provider?: string;
  voice?: string;
  model?: string;
  abortSignal?: AbortSignal;
  /** DashScope 固定 submit API 使用的零 redirect pinned outbound capability。 */
  dashScopeRestOutboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
  /** DashScope 返回音频 URL 使用的独立 pinned outbound capability。 */
  dashScopeAssetOutboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
};

/**
 * Standalone TTS synthesis function (no Tool interface dependency).
 * Returns { webPath, htmlAudio } on success, null on failure.
 */
export async function synthesizeSpeech(opts: SynthesizeOptions): Promise<SynthesizeResult | null> {
  const { text, stateDir } = opts;
  if (!text?.trim()) return null;
  throwIfAborted(opts.abortSignal);

  const envProvider = process.env.BELLDANDY_TTS_PROVIDER?.trim().toLowerCase();
  const provider = (opts.provider?.trim() || envProvider || "edge").toLowerCase();
  const shouldUseEnvVoice = !opts.provider || envProvider === provider;
  const model = resolveTtsModel(provider, opts.model);
  const maxOutputBytes = parsePositiveByteLimit(
    process.env.BELLDANDY_TTS_MAX_OUTPUT_BYTES,
    DEFAULT_TTS_MAX_OUTPUT_BYTES,
  );

  let voice = opts.voice;
  if (!voice) {
    const envVoice = shouldUseEnvVoice ? process.env.BELLDANDY_TTS_VOICE : undefined;
    if (envVoice?.trim()) {
      voice = envVoice.trim();
    } else if (provider === "openai") {
      voice = "alloy";
    } else if (provider === "dashscope") {
      voice = "Cherry";
    } else {
      voice = "zh-CN-XiaoxiaoNeural";
    }
  }

  try {
    const generatedDir = path.join(stateDir, "generated");
    await fs.mkdir(generatedDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `speech-${timestamp}.mp3`;
    const filepath = path.join(generatedDir, filename);

    if (provider === "openai") {
      await synthesizeOpenAI(filepath, text, voice!, model, maxOutputBytes, opts.abortSignal);
    } else if (provider === "dashscope") {
      await synthesizeDashScope(
        filepath,
        text,
        voice!,
        model,
        maxOutputBytes,
        opts.abortSignal,
        opts.dashScopeRestOutboundRequestPolicy,
        opts.dashScopeAssetOutboundRequestPolicy,
      );
    } else {
      await synthesizeEdge(filepath, text, voice!, opts.abortSignal);
    }

    const webPath = `/generated/${filename}`;
    const htmlAudio = `<audio controls autoplay src="${webPath}" preload="auto"></audio>`;
    return { webPath, htmlAudio };
  } catch (err) {
    if (isAbortError(err) || opts.abortSignal?.aborted) {
      throw toAbortError(opts.abortSignal?.reason);
    }
    console.error(`[TTS-Auto] synthesizeSpeech failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function synthesizeOpenAI(
  filepath: string,
  text: string,
  voice: string,
  model: string,
  maxOutputBytes: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  const apiKey = readOptionalEnv(
    "BELLDANDY_TTS_OPENAI_API_KEY",
    "BELLDANDY_OPENAI_API_KEY",
    "OPENAI_API_KEY",
  );
  const baseURL = readOptionalEnv(
    "BELLDANDY_TTS_OPENAI_BASE_URL",
    "BELLDANDY_OPENAI_BASE_URL",
    "OPENAI_BASE_URL",
  );
  if (!apiKey) {
    throw new Error("BELLDANDY_TTS_OPENAI_API_KEY, BELLDANDY_OPENAI_API_KEY, or OPENAI_API_KEY required for OpenAI provider.");
  }

  throwIfAborted(abortSignal);
  const openai = new OpenAI({ apiKey, baseURL });
  const mp3 = await raceWithAbort(
    (openai.audio.speech.create as any)({
      model: model as any,
      voice: voice as any,
      input: text,
    }, {
      signal: abortSignal,
    }),
    abortSignal,
  );
  await persistBoundedResponseToFile({
    response: requireReadableResponse(mp3, "OpenAI TTS"),
    targetPath: filepath,
    maxBytes: maxOutputBytes,
    label: "OpenAI TTS audio",
    abortSignal,
    overwrite: true,
  });
}

async function synthesizeDashScope(
  filepath: string,
  text: string,
  voice: string,
  model: string,
  maxOutputBytes: number,
  abortSignal?: AbortSignal,
  restOutboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">,
  assetOutboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">,
): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY required for DashScope provider.");

  const endpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
  const restPolicy = restOutboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: ["dashscope.aliyuncs.com"],
    maxRedirects: DASHSCOPE_REST_MAX_REDIRECTS,
  });
  const assetPolicy = assetOutboundRequestPolicy ?? new OutboundRequestPolicy({
    // DashScope signed result URLs use Alibaba Cloud service hosts; no API credential is sent on this GET.
    allowedHosts: ["aliyuncs.com"],
    maxRedirects: DASHSCOPE_ASSET_MAX_REDIRECTS,
  });
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      throwIfAborted(abortSignal);
      const { response } = await restPolicy.request({
        url: endpoint,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "identity",
        },
        body: JSON.stringify({
          model,
          input: { text, voice },
          parameters: { format: "mp3" },
        }),
        signal: abortSignal,
        maxRedirects: DASHSCOPE_REST_MAX_REDIRECTS,
        idleTimeoutMs: DASHSCOPE_REST_IDLE_TIMEOUT_MS,
      });

      if (!response.ok) {
        const errText = await readBoundedDashScopeResponseText(
          response,
          DASHSCOPE_REST_MAX_RESPONSE_BYTES,
          abortSignal,
        );
        throw new Error(`DashScope API failed (${response.status}): ${errText}`);
      }

      const data = JSON.parse(await readBoundedDashScopeResponseText(
        response,
        DASHSCOPE_REST_MAX_RESPONSE_BYTES,
        abortSignal,
      ));
      const audioUrl =
        data?.output?.audio?.url ||
        data?.output?.choices?.[0]?.message?.content?.[0]?.audio;

      if (typeof audioUrl !== "string" || !audioUrl.trim()) {
        throw new Error(`DashScope response missing audio URL. keys: ${Object.keys(data?.output || {}).join(",")}`);
      }

      const { response: audioRes } = await assetPolicy.request({
        url: audioUrl,
        signal: abortSignal,
        maxRedirects: DASHSCOPE_ASSET_MAX_REDIRECTS,
        idleTimeoutMs: DASHSCOPE_ASSET_IDLE_TIMEOUT_MS,
      });
      if (!audioRes.ok) throw new Error(`Failed to download audio (${audioRes.status})`);

      await persistBoundedResponseToFile({
        response: audioRes,
        targetPath: filepath,
        maxBytes: maxOutputBytes,
        label: "DashScope TTS audio",
        abortSignal,
        overwrite: true,
        validate: ({ byteLength }) => {
          if (byteLength < 100) {
            throw new Error(`Audio too small (${byteLength} bytes)`);
          }
        },
      });
      return; // success
    } catch (err) {
      if (isAbortError(err) || abortSignal?.aborted) {
        throw toAbortError(abortSignal?.reason);
      }
      if (err instanceof BoundedResponseLimitError || isDashScopeNonRetryablePolicyError(err)) {
        throw err;
      }
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause ? ` | cause: ${(err.cause as Error).message ?? err.cause}` : "";
      console.warn(`[TTS-Auto] DashScope attempt ${attempt}/${maxRetries} failed: ${msg}${cause}`);
      if (attempt < maxRetries) {
        await sleepWithAbort(attempt === 1 ? 3000 : 8000, abortSignal);
      }
    }
  }
  throw new Error(`DashScope failed after ${maxRetries} attempts. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function isDashScopeNonRetryablePolicyError(error: unknown): boolean {
  if (!(error instanceof OutboundRequestPolicyError)) return false;
  return error.code !== "dns_unavailable" && error.code !== "idle_timeout";
}

async function readBoundedDashScopeResponseText(
  response: Pick<Response, "body" | "headers">,
  maxBytes: number,
  abortSignal?: AbortSignal,
): Promise<string> {
  const body = response.body;
  if (!body) throw new Error("DashScope API response has no readable body");

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new BoundedResponseLimitError("DashScope API response has invalid Content-Length");
    }
    if (Number(declaredLength) > maxBytes) {
      await cancelResponseBody(response);
      throw new BoundedResponseLimitError(`DashScope API response exceeds ${maxBytes} byte limit`);
    }
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      throwIfAborted(abortSignal);
      const next = await raceWithAbort(reader.read(), abortSignal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        throw new BoundedResponseLimitError(`DashScope API response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (!completed) {
      await reader.cancel(error).catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(abortSignal);
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 正文已决定不再消费，取消失败不得覆盖原始 policy 或字节限额错误。
  }
}

async function synthesizeEdge(filepath: string, text: string, voice: string, abortSignal?: AbortSignal): Promise<void> {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      throwIfAborted(abortSignal);
      const tts = new EdgeTTS({ voice });
      if (!text?.trim()) throw new Error("Input text is empty");
      await raceWithAbort(tts.ttsPromise(text, filepath), abortSignal);

      throwIfAborted(abortSignal);
      const stats = await fs.stat(filepath);
      if (stats.size === 0) throw new Error("Generated audio file is empty (0 bytes)");
      return; // success
    } catch (err) {
      if (isAbortError(err) || abortSignal?.aborted) {
        throw toAbortError(abortSignal?.reason);
      }
      lastError = err;
      console.warn(`[TTS-Auto] EdgeTTS attempt ${attempt}/${maxRetries} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < maxRetries) {
        await sleepWithAbort(500 * Math.pow(2, attempt - 1), abortSignal);
      }
    }
  }
  throw new Error(`EdgeTTS failed after ${maxRetries} attempts. Last: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function requireReadableResponse(value: unknown, label: string): Pick<Response, "body" | "headers"> {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} response has no readable body.`);
  }
  const candidate = value as Partial<Pick<Response, "body" | "headers">>;
  if (!candidate.body
    || typeof candidate.body.getReader !== "function"
    || !candidate.headers
    || typeof candidate.headers.get !== "function") {
    throw new Error(`${label} response has no readable body.`);
  }
  return {
    body: candidate.body,
    headers: candidate.headers,
  };
}

function readOptionalEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveTtsModel(provider: string, explicitModel?: string): string {
  const configuredModel = explicitModel?.trim() || process.env.BELLDANDY_TTS_MODEL?.trim();
  if (configuredModel) {
    return configuredModel;
  }
  if (provider === "dashscope") {
    return "qwen3-tts-flash";
  }
  if (provider === "openai") {
    return "tts-1";
  }
  return "";
}
