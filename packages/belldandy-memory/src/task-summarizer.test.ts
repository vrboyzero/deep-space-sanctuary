import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskSummarizer } from "./task-summarizer.js";
import type { TaskRecord } from "./task-types.js";

describe("TaskSummarizer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves active fenced-JSON summary mapping through the bounded model owner", async () => {
    const legacyFetch = vi.fn(async () => {
      throw new Error("legacy fetch must not run");
    });
    vi.stubGlobal("fetch", legacyFetch);
    const request = vi.fn(async () => ({
      response: new Response(JSON.stringify({
        choices: [{
          message: {
            content: "```json\n{\"title\":\"任务总结\",\"summary\":\"已完成\",\"reflection\":\"保留回归\",\"outcome\":\"success\",\"artifact_paths\":[\"packages/a.ts\"]}\n```",
          },
        }],
      }), { status: 200 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const summarizer = new TaskSummarizer({
      enabled: true,
      model: "summary-model",
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      timeoutMs: 5_000,
      outboundRequestPolicy: { request },
    });

    await expect(summarizer.summarizeTask({
      task: createTaskRecord(),
      history: [
        { role: "user", content: "请完成任务" },
        { role: "assistant", content: "已完成任务" },
      ],
      toolCalls: [{ toolName: "apply_patch", success: true, artifactPaths: ["packages/a.ts"] }],
    })).resolves.toEqual({
      title: "任务总结",
      summary: "已完成",
      reflection: "保留回归",
      outcome: "success",
      artifactPaths: ["packages/a.ts"],
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("returns null without a model request when task summary is disabled", async () => {
    const request = vi.fn();
    const summarizer = new TaskSummarizer({
      enabled: false,
      model: "summary-model",
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      outboundRequestPolicy: { request },
    });

    await expect(summarizer.summarizeTask({
      task: createTaskRecord(),
      history: [],
      toolCalls: [],
    })).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("returns null when an active model response has no summary content", async () => {
    const request = vi.fn(async () => ({
      response: new Response(JSON.stringify({
        choices: [{ message: { content: "   " } }],
      }), { status: 200 }),
      url: new URL("https://summary.example.test/v1/chat/completions"),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const summarizer = new TaskSummarizer({
      enabled: true,
      model: "summary-model",
      baseUrl: "https://summary.example.test/v1",
      apiKey: "task-summary-secret",
      outboundRequestPolicy: { request },
    });

    await expect(summarizer.summarizeTask({
      task: createTaskRecord(),
      history: [],
      toolCalls: [],
    })).resolves.toBeNull();
  });
});

function createTaskRecord(): TaskRecord {
  return {
    id: "task-summary-1",
    conversationId: "conversation-summary-1",
    sessionKey: "conversation-summary-1",
    source: "chat",
    objective: "完成任务总结",
    status: "success",
    startedAt: "2026-07-19T00:00:00.000Z",
    finishedAt: "2026-07-19T00:01:00.000Z",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:01:00.000Z",
  };
}
