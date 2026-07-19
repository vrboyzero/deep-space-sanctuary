import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import {
  isAbortError,
  raceWithAbort,
  sleepWithAbort,
  throwIfAborted,
  toAbortError,
} from "../../abort-utils.js";
import {
  parsePositiveByteLimit,
  persistBoundedResponseToFile,
} from "../remote-response-file.js";

const DEFAULT_TTS_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

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
      await synthesizeDashScope(filepath, text, voice!, model, maxOutputBytes, opts.abortSignal);
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
): Promise<void> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY required for DashScope provider.");

  const endpoint = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      throwIfAborted(abortSignal);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: { text, voice },
          parameters: { format: "mp3" },
        }),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DashScope API failed (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const audioUrl =
        data?.output?.audio?.url ||
        data?.output?.choices?.[0]?.message?.content?.[0]?.audio;

      if (!audioUrl) {
        throw new Error(`DashScope response missing audio URL. keys: ${Object.keys(data?.output || {}).join(",")}`);
      }

      const audioRes = await fetch(audioUrl, { signal: abortSignal });
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
