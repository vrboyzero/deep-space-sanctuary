import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMediaUnderstandingCache,
  createMediaFingerprint,
  createMediaFingerprintFromFile,
  readCachedAudioTranscription,
  readCachedImageUnderstanding,
  readCachedVideoUnderstanding,
  resolveMediaUnderstandingCacheDir,
  runMediaUnderstandingCacheSingleFlight,
  writeCachedAudioTranscription,
  writeCachedImageUnderstanding,
  writeCachedVideoUnderstanding,
} from "./understanding-cache.js";

describe("shared media understanding cache", () => {
  let tempDir: string;
  let originalCacheEnv: Record<string, string | undefined>;
  const cacheEnvKeys = [
    "BELLDANDY_UNDERSTANDING_CACHE_TTL_MS",
    "BELLDANDY_UNDERSTANDING_CACHE_MAX_ENTRIES",
    "BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES",
  ] as const;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-understanding-cache-"));
    originalCacheEnv = Object.fromEntries(cacheEnvKeys.map((key) => [key, process.env[key]]));
    for (const key of cacheEnvKeys) delete process.env[key];
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const key of cacheEnvKeys) {
      const value = originalCacheEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("generates the same fingerprint from a buffer and a file with the same content", async () => {
    const filePath = path.join(tempDir, "same.png");
    const buffer = Buffer.from("same-image");
    await fs.writeFile(filePath, buffer);
    const readFileSpy = vi.spyOn(fs, "readFile");

    try {
      const fromBuffer = createMediaFingerprint({
        buffer,
        mime: "image/png",
      });
      const fromFile = await createMediaFingerprintFromFile({
        filePath,
        mime: "image/png",
      });

      expect(fromFile).toBe(fromBuffer);
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("writes and reads cached image understanding records", async () => {
    const fingerprint = createMediaFingerprint({
      buffer: Buffer.from("image-cache"),
      mime: "image/png",
    });

    await writeCachedImageUnderstanding({
      stateDir: tempDir,
      fingerprint,
      mime: "image/png",
      result: {
        summary: "一张终端截图。",
        tags: ["terminal"],
        ocrText: "hello",
        content: "一张终端截图。",
        keyRegions: [],
        targetDetail: undefined,
        focusMode: "overview",
        focusTarget: undefined,
        provider: "openai",
        model: "gpt-4.1-mini",
        mimeType: "image/png",
        sourcePath: "/tmp/same.png",
      },
    });

    const cached = await readCachedImageUnderstanding({
      stateDir: tempDir,
      fingerprint,
    });

    expect(cached?.fingerprint).toBe(fingerprint);
    expect(cached?.result.summary).toBe("一张终端截图。");
    expect(cached).toMatchObject({
      version: 2,
      bytes: expect.any(Number),
      accessedAt: expect.any(String),
    });
  });

  it("writes and reads cached audio transcription records", async () => {
    const fingerprint = createMediaFingerprint({
      buffer: Buffer.from("audio-cache"),
      mime: "audio/webm",
    });

    await writeCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint,
      mime: "audio/webm",
      result: {
        text: "这是一段缓存的音频转写。",
        provider: "openai",
        model: "whisper-1",
        durationSec: 3.2,
      },
    });

    const cached = await readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint,
    });

    expect(cached?.fingerprint).toBe(fingerprint);
    expect(cached?.result.text).toBe("这是一段缓存的音频转写。");
    expect(cached?.result.model).toBe("whisper-1");
  });

  it("writes and reads cached video understanding records", async () => {
    const fingerprint = createMediaFingerprint({
      buffer: Buffer.from("video-cache"),
      mime: "video/mp4",
    });

    await writeCachedVideoUnderstanding({
      stateDir: tempDir,
      fingerprint,
      mime: "video/mp4",
      result: {
        summary: "一段演示视频。",
        tags: ["demo"],
        ocrText: "START",
        content: "一段演示视频。",
        durationText: "约 8 秒",
        timeline: [],
        targetMoment: undefined,
        focusMode: "overview",
        targetTimestamp: undefined,
        provider: "openai",
        model: "kimi-k2.5",
        mimeType: "video/mp4",
        sourcePath: "/tmp/demo.mp4",
      },
    });

    const cached = await readCachedVideoUnderstanding({
      stateDir: tempDir,
      fingerprint,
    });

    expect(cached?.fingerprint).toBe(fingerprint);
    expect(cached?.result.summary).toBe("一段演示视频。");
  });

  it("clears only the selected multimedia cache kinds", async () => {
    const imageFingerprint = createMediaFingerprint({
      buffer: Buffer.from("image-cache-clear"),
      mime: "image/png",
    });
    const videoFingerprint = createMediaFingerprint({
      buffer: Buffer.from("video-cache-clear"),
      mime: "video/mp4",
    });

    await writeCachedImageUnderstanding({
      stateDir: tempDir,
      fingerprint: imageFingerprint,
      mime: "image/png",
      result: {
        summary: "图像缓存",
        tags: [],
        ocrText: "",
        content: "图像缓存",
        keyRegions: [],
        targetDetail: undefined,
        focusMode: "overview",
        focusTarget: undefined,
        provider: "openai",
        model: "gpt-4.1-mini",
        mimeType: "image/png",
        sourcePath: "/tmp/image.png",
      },
    });
    await writeCachedVideoUnderstanding({
      stateDir: tempDir,
      fingerprint: videoFingerprint,
      mime: "video/mp4",
      result: {
        summary: "视频缓存",
        tags: [],
        ocrText: "",
        content: "视频缓存",
        durationText: undefined,
        timeline: [],
        targetMoment: undefined,
        focusMode: "overview",
        targetTimestamp: undefined,
        provider: "openai",
        model: "kimi-k2.5",
        mimeType: "video/mp4",
        sourcePath: "/tmp/video.mp4",
      },
    });

    const cleared = await clearMediaUnderstandingCache({
      stateDir: tempDir,
      kinds: ["video-understanding"],
    });

    expect(cleared.clearedKinds).toEqual(["video-understanding"]);
    expect(await readCachedImageUnderstanding({
      stateDir: tempDir,
      fingerprint: imageFingerprint,
    })).toBeTruthy();
    expect(await readCachedVideoUnderstanding({
      stateDir: tempDir,
      fingerprint: videoFingerprint,
    })).toBeUndefined();
  });

  it("migrates a valid v1 record on read without losing the cached result", async () => {
    const fingerprint = createMediaFingerprint({
      buffer: Buffer.from("legacy-audio-cache"),
      mime: "audio/webm",
    });
    const cacheDir = resolveMediaUnderstandingCacheDir(tempDir, "audio-transcription");
    const cachePath = path.join(cacheDir, `${fingerprint}.json`);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({
      version: 1,
      fingerprint,
      mime: "audio/webm",
      createdAt: new Date().toISOString(),
      result: {
        text: "旧缓存仍可复用。",
        provider: "openai",
        model: "whisper-1",
      },
    }, null, 2));

    const cached = await readCachedAudioTranscription({ stateDir: tempDir, fingerprint });
    const migrated = JSON.parse(await fs.readFile(cachePath, "utf-8"));

    expect(cached?.result.text).toBe("旧缓存仍可复用。");
    expect(migrated).toMatchObject({
      version: 2,
      fingerprint,
      bytes: expect.any(Number),
      accessedAt: expect.any(String),
    });
  });

  it("expires an entry after TTL and removes it from disk", async () => {
    process.env.BELLDANDY_UNDERSTANDING_CACHE_TTL_MS = "1000";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    const fingerprint = createMediaFingerprint({
      buffer: Buffer.from("ttl-audio-cache"),
      mime: "audio/webm",
    });
    await writeCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint,
      result: { text: "即将过期", provider: "mock", model: "mock" },
    });

    vi.setSystemTime(new Date("2026-07-17T00:00:01.001Z"));
    await expect(readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint,
    })).resolves.toBeUndefined();
    await expect(fs.access(path.join(
      resolveMediaUnderstandingCacheDir(tempDir, "audio-transcription"),
      `${fingerprint}.json`,
    ))).rejects.toThrow();
  });

  it("evicts the least recently accessed entry when the global entry limit is exceeded", async () => {
    process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_ENTRIES = "2";
    process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES = "1048576";
    process.env.BELLDANDY_UNDERSTANDING_CACHE_TTL_MS = "86400000";
    vi.useFakeTimers();
    const fingerprints = ["a", "b", "c"].map((value) => createMediaFingerprint({
      buffer: Buffer.from(`lru-${value}`),
      mime: "audio/webm",
    }));
    const writeAt = async (index: number, iso: string) => {
      vi.setSystemTime(new Date(iso));
      await writeCachedAudioTranscription({
        stateDir: tempDir,
        fingerprint: fingerprints[index],
        result: { text: `entry-${index}`, provider: "mock", model: "mock" },
      });
    };
    await writeAt(0, "2026-07-17T00:00:00.000Z");
    await writeAt(1, "2026-07-17T00:00:01.000Z");
    vi.setSystemTime(new Date("2026-07-17T00:00:02.000Z"));
    await readCachedAudioTranscription({ stateDir: tempDir, fingerprint: fingerprints[0] });
    await writeAt(2, "2026-07-17T00:00:03.000Z");

    await expect(readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: fingerprints[0],
    })).resolves.toBeTruthy();
    await expect(readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: fingerprints[1],
    })).resolves.toBeUndefined();
    await expect(readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: fingerprints[2],
    })).resolves.toBeTruthy();
  });

  it("keeps total cache bytes bounded across entries", async () => {
    process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_ENTRIES = "10";
    process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES = "1048576";
    const firstFingerprint = createMediaFingerprint({
      buffer: Buffer.from("byte-entry-a"),
      mime: "audio/webm",
    });
    const secondFingerprint = createMediaFingerprint({
      buffer: Buffer.from("byte-entry-b"),
      mime: "audio/webm",
    });
    await writeCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: firstFingerprint,
      result: { text: "same-size", provider: "mock", model: "mock" },
    });
    const cacheDir = resolveMediaUnderstandingCacheDir(tempDir, "audio-transcription");
    const firstPath = path.join(cacheDir, `${firstFingerprint}.json`);
    const firstBytes = (await fs.stat(firstPath)).size;
    process.env.BELLDANDY_UNDERSTANDING_CACHE_MAX_BYTES = String(firstBytes + 1);

    await writeCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: secondFingerprint,
      result: { text: "same-size", provider: "mock", model: "mock" },
    });

    await expect(fs.access(firstPath)).rejects.toThrow();
    await expect(readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: secondFingerprint,
    })).resolves.toBeTruthy();
    const totalBytes = (await Promise.all((await fs.readdir(cacheDir)).map(async (entry) => (
      await fs.stat(path.join(cacheDir, entry))
    ).size))).reduce((sum, value) => sum + value, 0);
    expect(totalBytes).toBeLessThanOrEqual(firstBytes + 1);
  });

  it("removes the staging file when atomic cache commit fails", async () => {
    const fingerprint = createMediaFingerprint({
      buffer: Buffer.from("atomic-cache-failure"),
      mime: "audio/webm",
    });
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("fixture rename failed"));

    await expect(writeCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint,
      result: { text: "not committed", provider: "mock", model: "mock" },
    })).rejects.toThrow("fixture rename failed");

    const cacheDir = resolveMediaUnderstandingCacheDir(tempDir, "audio-transcription");
    await expect(fs.readdir(cacheDir)).resolves.toEqual([]);
  });

  it("single-flights one fingerprint and releases the lane after success or failure", async () => {
    let release: ((value: string) => void) | undefined;
    const operation = vi.fn(() => new Promise<string>((resolve) => {
      release = resolve;
    }));
    const first = runMediaUnderstandingCacheSingleFlight({
      stateDir: tempDir,
      kind: "image-understanding",
      fingerprint: "same-fingerprint",
      operation,
    });
    const second = runMediaUnderstandingCacheSingleFlight({
      stateDir: tempDir,
      kind: "image-understanding",
      fingerprint: "same-fingerprint",
      operation,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    release?.("shared-result");
    await expect(first).resolves.toEqual({ value: "shared-result", joined: false });
    await expect(second).resolves.toEqual({ value: "shared-result", joined: true });

    await expect(runMediaUnderstandingCacheSingleFlight({
      stateDir: tempDir,
      kind: "image-understanding",
      fingerprint: "failed-fingerprint",
      operation: async () => {
        throw new Error("fixture provider failed");
      },
    })).rejects.toThrow("fixture provider failed");
    await expect(runMediaUnderstandingCacheSingleFlight({
      stateDir: tempDir,
      kind: "image-understanding",
      fingerprint: "failed-fingerprint",
      operation: async () => "retry-result",
    })).resolves.toEqual({ value: "retry-result", joined: false });
  });
});
