import type { BelldandyLogger } from "./logger/index.js";

import { OutboundRequestPolicy, OutboundRequestPolicyError } from "@belldandy/protocol";

const DEFAULT_RELEASES_API_URL = "https://api.github.com/repos/vrboyzero/star-sanctuary/releases/latest";
const DEFAULT_TIMEOUT_MS = 3000;
const UPDATE_CHECK_MAX_REDIRECTS = 0;
const UPDATE_CHECK_MAX_RESPONSE_BYTES = 256 * 1024;

type UpdateCheckOptions = {
  currentVersion: string;
  logger: BelldandyLogger;
  enabled?: boolean;
  timeoutMs?: number;
  releasesApiUrl?: string;
  outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
};

type ReleaseApiResponse = {
  tag_name?: unknown;
  html_url?: unknown;
};

type SemVerTuple = [major: number, minor: number, patch: number];

function parseSemVer(value: string): SemVerTuple | null {
  const normalized = value.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(normalized);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemVer(a: SemVerTuple, b: SemVerTuple): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function normalizeTagToVersion(tagName: string): string | null {
  const semver = parseSemVer(tagName);
  if (!semver) return null;
  return `${semver[0]}.${semver[1]}.${semver[2]}`;
}

export async function checkForUpdates(options: UpdateCheckOptions): Promise<void> {
  if (options.enabled === false) return;

  const current = parseSemVer(options.currentVersion);
  if (!current) {
    options.logger.warn("update", `Skip update check: invalid current version "${options.currentVersion}"`);
    return;
  }

  const releasesApiUrl = options.releasesApiUrl ?? DEFAULT_RELEASES_API_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestPolicy = options.outboundRequestPolicy ?? createUpdateRequestPolicy(releasesApiUrl);
    const { response } = await requestPolicy.request({
      url: releasesApiUrl,
      method: "GET",
      headers: {
        "Accept": "application/vnd.github+json",
        "Accept-Encoding": "identity",
        "User-Agent": "Belldandy-UpdateChecker",
      },
      signal: controller.signal,
      maxRedirects: UPDATE_CHECK_MAX_REDIRECTS,
      idleTimeoutMs: timeoutMs,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      options.logger.warn("update", `Update check failed: HTTP ${response.status}`);
      return;
    }

    const payload = await readBoundedReleaseJson(response, controller.signal) as ReleaseApiResponse;
    const tagName = typeof payload.tag_name === "string" ? payload.tag_name : "";
    const latestVersion = normalizeTagToVersion(tagName);
    if (!latestVersion) return;

    const latest = parseSemVer(latestVersion);
    if (!latest) return;

    if (compareSemVer(latest, current) > 0) {
      const releaseUrl = typeof payload.html_url === "string" && payload.html_url.trim()
        ? payload.html_url.trim()
        : `https://github.com/vrboyzero/star-sanctuary/releases/tag/v${latestVersion}`;
      options.logger.info("update", `New version available: v${latestVersion} (current: v${options.currentVersion})`);
      options.logger.info("update", `Upgrade: ${releaseUrl}`);
    }
  } catch (error) {
    if (controller.signal.aborted || (
      error instanceof OutboundRequestPolicyError && error.code === "idle_timeout"
    )) {
      options.logger.warn("update", `Update check timeout after ${timeoutMs}ms`);
      return;
    }
    options.logger.warn("update", `Update check error: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function createUpdateRequestPolicy(releasesApiUrl: string): OutboundRequestPolicy {
  const url = new URL(releasesApiUrl);
  return new OutboundRequestPolicy({
    allowedHosts: [url.hostname],
    maxRedirects: UPDATE_CHECK_MAX_REDIRECTS,
  });
}

async function readBoundedReleaseJson(
  response: Pick<Response, "body" | "headers">,
  abortSignal: AbortSignal,
): Promise<unknown> {
  const body = response.body;
  if (!body) throw new Error("Update check response has no readable body");

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      await cancelResponseBody(response);
      throw new Error("Update check response has invalid Content-Length");
    }
    if (Number(declaredLength) > UPDATE_CHECK_MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new Error(`Update check response exceeds ${UPDATE_CHECK_MAX_RESPONSE_BYTES} byte limit`);
    }
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let completed = false;
  try {
    while (true) {
      throwIfSignalAborted(abortSignal);
      const next = await readWithAbort(reader, abortSignal);
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.length;
      if (byteLength > UPDATE_CHECK_MAX_RESPONSE_BYTES) {
        throw new Error(`Update check response exceeds ${UPDATE_CHECK_MAX_RESPONSE_BYTES} byte limit`);
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

  throwIfSignalAborted(abortSignal);
  return JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8"));
}

function readWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<T>> {
  throwIfSignalAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError(signal.reason));
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

function throwIfSignalAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError(signal.reason);
}

function createAbortError(reason: unknown): Error {
  const error = reason instanceof Error ? reason : new Error("Update check aborted.");
  error.name = "AbortError";
  return error;
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 正文已决定不再消费，取消失败不得覆盖原始 policy、状态或字节限额结果。
  }
}


