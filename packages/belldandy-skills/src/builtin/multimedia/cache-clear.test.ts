import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolContext } from "../../types.js";
import { multimediaCacheClearTool } from "./cache-clear.js";
import {
  createMediaFingerprint,
  readCachedAudioTranscription,
  readCachedImageUnderstanding,
  writeCachedAudioTranscription,
  writeCachedImageUnderstanding,
} from "./understanding-cache.js";

function createContext(stateDir: string): ToolContext {
  return {
    conversationId: "conv-multimedia-cache-clear-test",
    workspaceRoot: stateDir,
    stateDir,
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 60000,
      maxResponseBytes: 1024 * 1024,
    },
  };
}

describe("multimedia_cache_clear", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-multimedia-cache-clear-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("clears only the requested cache scope", async () => {
    const audioFingerprint = createMediaFingerprint({
      buffer: Buffer.from("audio-cache"),
      mime: "audio/webm",
    });
    const imageFingerprint = createMediaFingerprint({
      buffer: Buffer.from("image-cache"),
      mime: "image/png",
    });

    await writeCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: audioFingerprint,
      mime: "audio/webm",
      result: {
        text: "缓存音频",
        provider: "dashscope",
        model: "paraformer-v2",
      },
    });
    await writeCachedImageUnderstanding({
      stateDir: tempDir,
      fingerprint: imageFingerprint,
      mime: "image/png",
      result: {
        summary: "缓存图片",
        tags: [],
        ocrText: "",
        content: "缓存图片",
        keyRegions: [],
        targetDetail: undefined,
        focusMode: "overview",
        focusTarget: undefined,
        provider: "openai",
        model: "qwen3.6-flash",
        mimeType: "image/png",
        sourcePath: "/tmp/photo.png",
      },
    });

    const result = await multimediaCacheClearTool.execute({
      scope: "image",
    }, createContext(tempDir));

    expect(result.success).toBe(true);
    expect(JSON.parse(String(result.output))).toMatchObject({
      scope: "image",
      clearedKinds: ["image-understanding"],
    });
    expect(await readCachedAudioTranscription({
      stateDir: tempDir,
      fingerprint: audioFingerprint,
    })).toBeTruthy();
    expect(await readCachedImageUnderstanding({
      stateDir: tempDir,
      fingerprint: imageFingerprint,
    })).toBeUndefined();
  });

  it("does not remove generated assets when clearing all understanding caches", async () => {
    const generatedPath = path.join(tempDir, "generated", "images", "kept.png");
    await fs.mkdir(path.dirname(generatedPath), { recursive: true });
    await fs.writeFile(generatedPath, "generated-asset");

    const result = await multimediaCacheClearTool.execute({ scope: "all" }, createContext(tempDir));

    expect(result.success).toBe(true);
    await expect(fs.readFile(generatedPath, "utf-8")).resolves.toBe("generated-asset");
  });
});
