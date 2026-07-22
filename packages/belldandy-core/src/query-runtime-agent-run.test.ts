import { describe, expect, it, vi } from "vitest";

import type { BelldandyAgent } from "@belldandy/agent";
import { runAgentWithLifecycle } from "./query-runtime-agent-run.js";

describe("runAgentWithLifecycle interrupted contract", () => {
  it("keeps accumulated partial text without manufacturing a final item", async () => {
    const onInterrupted = vi.fn();
    const onDelta = vi.fn();
    const onFinal = vi.fn();
    const onToolCall = vi.fn();
    const agent: BelldandyAgent = {
      async *run() {
        yield { type: "status" as const, status: "running" as const };
        yield { type: "delta" as const, delta: "partial answer" };
        yield {
          type: "interrupted",
          reason: "provider_stream_error",
          error: "stream reset",
          committed: true,
        };
        yield { type: "delta" as const, delta: " late delta" };
        yield { type: "tool_call" as const, id: "late-call", name: "read", arguments: {} };
        yield { type: "final" as const, text: "late final" };
        yield { type: "status" as const, status: "error" as const };
      },
    };

    const result = await runAgentWithLifecycle(agent, {
      conversationId: "conv-interrupted",
      runInput: { conversationId: "conv-interrupted", text: "hello" },
      onInterrupted,
      onDelta,
      onFinal,
      onToolCall,
    });

    expect(result).toMatchObject({
      receivedFinal: false,
      fullText: "partial answer",
      finalText: "",
      latestStatus: "error",
      interrupted: {
        reason: "provider_stream_error",
        error: "stream reset",
        committed: true,
        partialText: "partial answer",
      },
    });
    expect(onInterrupted).toHaveBeenCalledWith(expect.objectContaining({
      partialText: "partial answer",
    }));
    expect(onDelta).toHaveBeenCalledOnce();
    expect(onDelta).toHaveBeenCalledWith({ delta: "partial answer" });
    expect(onFinal).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });
});
