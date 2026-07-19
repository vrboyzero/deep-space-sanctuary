import OpenAI from "openai";
import { OutboundRequestPolicy } from "@belldandy/protocol";
import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";
import { createMultipartFileUpload } from "./media-file-stream.js";

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_SDK_TIMEOUT_MS = 2_147_483_647;
const OPENAI_COMPATIBLE_UPLOAD_MAX_RESPONSE_BYTES = 1024 * 1024;
const OPENAI_COMPATIBLE_UPLOAD_IDLE_TIMEOUT_MS = 15_000;

export type OpenAICompatibleUploadOutboundRequestPolicy = Pick<OutboundRequestPolicy, "request">;

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseTimeoutMs(value: string | undefined, fallback = DEFAULT_TIMEOUT_MS): number {
  if ((value ?? "").trim() === "0") {
    return 0;
  }
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function stripMarkdownCodeFences(value: string): string {
  return value.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
}

export function createOpenAIClient(input: {
  apiKey: string;
  baseURL: string;
  timeoutMs: number;
}): OpenAI {
  return new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    timeout: input.timeoutMs > 0 ? input.timeoutMs : MAX_SDK_TIMEOUT_MS,
  });
}

export function guessImageMimeFromFilePath(filePath: string): string {
  const lower = filePath.trim().toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}

export function guessVideoMimeFromFilePath(filePath: string): string {
  const lower = filePath.trim().toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "application/octet-stream";
}

export function buildVersionedApiUrl(baseUrl: string, endpoint: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  const base = /\/v\d+$/u.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${base}${endpoint}`;
}

export async function uploadFileToOpenAICompatible(input: {
  filePath: string;
  apiKey: string;
  baseURL: string;
  purpose: string;
  maxBytes: number;
  abortSignal?: AbortSignal;
  outboundRequestPolicy?: OpenAICompatibleUploadOutboundRequestPolicy;
}): Promise<string> {
  const upload = await createMultipartFileUpload({
    filePath: input.filePath,
    purpose: input.purpose,
    maxBytes: input.maxBytes,
    abortSignal: input.abortSignal,
  });

  const uploadUrl = buildVersionedApiUrl(input.baseURL, "/files");
  const outboundRequestPolicy = input.outboundRequestPolicy ?? new OutboundRequestPolicy({
    allowedHosts: [new URL(uploadUrl).hostname],
    maxRedirects: 0,
  });
  let response: Response;
  try {
    ({ response } = await outboundRequestPolicy.request({
      url: uploadUrl,
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": upload.contentType,
        "Content-Length": String(upload.contentLength),
      },
      body: upload.body,
      signal: input.abortSignal,
      maxRedirects: 0,
      idleTimeoutMs: OPENAI_COMPATIBLE_UPLOAD_IDLE_TIMEOUT_MS,
    }));
  } finally {
    // Admission、transport 或 early response 结束后都释放文件流，避免拒绝路径保留句柄。
    if (!upload.body.destroyed) upload.body.destroy();
  }

  const responseText = await readBoundedUploadResponseText({
    response,
    maxBytes: OPENAI_COMPATIBLE_UPLOAD_MAX_RESPONSE_BYTES,
    abortSignal: input.abortSignal,
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${responseText}`.trim());
  }

  const payload = JSON.parse(responseText) as { id?: unknown };
  const fileId = normalizeOptionalString(payload?.id);
  if (!fileId) {
    throw new Error("Upload response did not include a file id.");
  }
  return fileId;
}

async function readBoundedUploadResponseText(input: {
  response: Pick<Response, "body" | "headers">;
  maxBytes: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { response, maxBytes, abortSignal } = input;
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelUploadResponseBody(response);
      throw new Error("Upload response has invalid Content-Length.");
    }
    if (Number(declaredLength) > maxBytes) {
      await cancelUploadResponseBody(response);
      throw new Error(`Upload response exceeds ${maxBytes} byte limit.`);
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
      const next = await raceWithAbort(reader.read(), abortSignal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        throw new Error(`Upload response exceeds ${maxBytes} byte limit.`);
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

async function cancelUploadResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 已决定拒绝正文，取消失败不得覆盖原始长度错误。
  }
}
