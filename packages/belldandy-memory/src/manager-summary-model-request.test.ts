import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MemoryChunkSummaryModelRequestOptions,
  MemoryChunkSummaryModelResponse,
} from "./memory-chunk-summary-model-request.js";
import { MemoryManager } from "./manager.js";

const requestMemoryChunkSummaryModelMock = vi.hoisted(() => vi.fn<(
  options: MemoryChunkSummaryModelRequestOptions,
) => Promise<MemoryChunkSummaryModelResponse>>());

vi.mock("./memory-chunk-summary-model-request.js", () => ({
  requestMemoryChunkSummaryModel: requestMemoryChunkSummaryModelMock,
}));

describe("MemoryManager chunk summary model consumer", () => {
  let manager: MemoryManager | undefined;
  let rootDir: string | undefined;

  afterEach(async () => {
    requestMemoryChunkSummaryModelMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await manager?.close();
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("preserves the active chunk summary payload and writeback through the bounded owner", async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-manager-summary-owner-"));
    const stateDir = path.join(rootDir, "state");
    const workspaceRoot = path.join(rootDir, "workspace");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    requestMemoryChunkSummaryModelMock.mockResolvedValue({
      choices: [{ message: { content: "  bounded chunk summary  " } }],
    });
    manager = new MemoryManager({
      workspaceRoot,
      stateDir,
      storePath: path.join(stateDir, "memory.db"),
      embeddingEnabled: false,
      summaryEnabled: true,
      summaryModel: "summary-model",
      summaryBaseUrl: "https://summary.example.test/v1",
      summaryApiKey: "summary-secret",
      summaryBatchSize: 1,
      summaryMinContentLength: 1,
    });
    const store = (manager as unknown as { store: {
      upsertChunk(input: Record<string, unknown>): void;
    } }).store;
    store.upsertChunk({
      id: "summary-owner-chunk",
      sourcePath: path.join(workspaceRoot, "summary.md"),
      sourceType: "file",
      memoryType: "other",
      content: "summary source content",
    });

    await expect(manager.generateSummaries({ maxBatches: 1 })).resolves.toBe(1);

    expect(requestMemoryChunkSummaryModelMock).toHaveBeenCalledTimes(1);
    expect(requestMemoryChunkSummaryModelMock).toHaveBeenCalledWith({
      baseUrl: "https://summary.example.test/v1",
      apiKey: "summary-secret",
      timeoutMs: 120_000,
      payload: {
        model: "summary-model",
        messages: [
          { role: "system", content: expect.stringContaining("一到两句话") },
          { role: "user", content: "summary source content" },
        ],
        max_tokens: 150,
        temperature: 0.3,
      },
    });
    expect(manager.getMemory("summary-owner-chunk")?.summary).toBe("bounded chunk summary");
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("continues the summary batch after one bounded owner request fails", async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-manager-summary-failure-"));
    const stateDir = path.join(rootDir, "state");
    const workspaceRoot = path.join(rootDir, "workspace");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });
    requestMemoryChunkSummaryModelMock
      .mockRejectedValueOnce(new Error("bounded provider failure"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "healthy chunk summary" } }],
      });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    manager = new MemoryManager({
      workspaceRoot,
      stateDir,
      storePath: path.join(stateDir, "memory.db"),
      embeddingEnabled: false,
      summaryEnabled: true,
      summaryModel: "summary-model",
      summaryBaseUrl: "https://summary.example.test/v1",
      summaryApiKey: "summary-secret",
      summaryBatchSize: 2,
      summaryMinContentLength: 1,
    });
    const store = (manager as unknown as { store: {
      upsertChunk(input: Record<string, unknown>): void;
      getChunksNeedingSummary(minLength: number, limit: number): unknown[];
    } }).store;
    for (let index = 0; index < 2; index += 1) {
      store.upsertChunk({
        id: `summary-batch-chunk-${index}`,
        sourcePath: path.join(workspaceRoot, `summary-${index}.md`),
        sourceType: "file",
        memoryType: "other",
        content: `summary batch source ${index}`,
      });
    }

    await expect(manager.generateSummaries({ maxBatches: 1 })).resolves.toBe(1);

    expect(requestMemoryChunkSummaryModelMock).toHaveBeenCalledTimes(2);
    expect(store.getChunksNeedingSummary(1, 10)).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Failed to generate summary for chunk"),
      expect.objectContaining({ message: "bounded provider failure" }),
    );
  });
});
