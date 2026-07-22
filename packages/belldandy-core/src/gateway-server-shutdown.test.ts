import { describe, expect, it, vi } from "vitest";

import { GatewayShutdownCoordinator } from "./gateway-shutdown-coordinator.js";
import {
  GatewayServerCloseError,
  createGatewayServerIntakeGate,
  registerGatewayServerShutdownResources,
  throwOnGatewayServerShutdownFailure,
} from "./gateway-server-shutdown.js";
import { registerGatewayShutdownResources } from "./gateway-shutdown-resources.js";

describe("Gateway server shutdown resources", () => {
  it("drains token usage after external channels and before transport close", async () => {
    const events: string[] = [];
    let releaseChannels!: () => void;
    const channelsClosed = new Promise<void>((resolve) => {
      releaseChannels = resolve;
    });
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayServerShutdownResources(coordinator, {
      stopIntake: () => {
        events.push("gateway.intake");
      },
      drainTokenUsage: async (signal) => {
        expect(signal.aborted).toBe(false);
        events.push("token-usage.drain");
      },
      closeTransport: () => {
        events.push("transport.close");
      },
    });
    registerGatewayShutdownResources(coordinator, {
      channels: {
        stopChannels: () => {
          events.push("channels.stop");
          return channelsClosed;
        },
      },
    });

    const shutdown = coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    await vi.waitFor(() => expect(events).toContain("channels.stop"));
    expect(events).toEqual(["gateway.intake", "channels.stop"]);

    releaseChannels();
    await expect(shutdown).resolves.toMatchObject({ outcome: "completed" });
    expect(events).toEqual([
      "gateway.intake",
      "channels.stop",
      "token-usage.drain",
      "transport.close",
    ]);
  });

  it("stops intake, aborts and drains active work, flushes state, then closes transport once", async () => {
    const events: string[] = [];
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayServerShutdownResources(coordinator, {
      stopIntake: () => { events.push("intake.stop"); },
      abortActiveRuns: async () => { events.push("runs.abort"); },
      drainActiveRuns: async () => { events.push("runs.drain"); },
      disposeTopLevelConversations: async () => { events.push("conversations.dispose"); },
      closeDurableExtraction: async () => { events.push("extraction.close"); },
      flushConversationState: async () => { events.push("conversations.flush"); },
      flushSubTaskState: async () => { events.push("subtasks.flush"); },
      flushMemoryUsage: async () => { events.push("memory.flush"); },
      detachRuntimeHooks: () => { events.push("hooks.detach"); },
      closeTransport: async () => { events.push("transport.close"); },
    });

    const first = coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    const second = coordinator.requestShutdown({ kind: "signal", exitCode: 1 });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(firstResult.outcome).toBe("completed");
    expect(events).toEqual([
      "intake.stop",
      "runs.abort",
      "runs.drain",
      "conversations.dispose",
      "extraction.close",
      "conversations.flush",
      "subtasks.flush",
      "memory.flush",
      "hooks.detach",
      "transport.close",
    ]);
  });

  it("continues remaining flushes and transport close after one flush fails", async () => {
    const events: string[] = [];
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayServerShutdownResources(coordinator, {
      stopIntake: vi.fn(),
      flushConversationState: async () => {
        events.push("conversations.flush");
        throw new Error("fixture secret must not escape");
      },
      flushSubTaskState: async () => { events.push("subtasks.flush"); },
      flushMemoryUsage: async () => { events.push("memory.flush"); },
      closeTransport: async () => { events.push("transport.close"); },
    });

    const result = await coordinator.requestShutdown({ kind: "manual", exitCode: 0 });

    expect(result.outcome).toBe("completed_with_failures");
    expect(result.failures).toEqual([
      { stepId: "conversation-state", phase: "flush_state", kind: "step_error" },
    ]);
    expect(events).toEqual([
      "conversations.flush",
      "subtasks.flush",
      "memory.flush",
      "transport.close",
    ]);
    expect(() => throwOnGatewayServerShutdownFailure(result)).toThrow(GatewayServerCloseError);
    expect(() => throwOnGatewayServerShutdownFailure(result)).toThrow(
      "Gateway shutdown failed (1 step failure).",
    );
  });
});

describe("Gateway server intake gate", () => {
  it("rejects new HTTP and WebSocket work with a stable shutdown error after stop", () => {
    const gate = createGatewayServerIntakeGate();

    expect(gate.getHttpRejection()).toBeNull();
    expect(gate.getGatewayRejection("request-1")).toBeNull();

    gate.stop();
    gate.stop();

    expect(gate.getHttpRejection()).toEqual({
      statusCode: 503,
      body: {
        ok: false,
        error: {
          code: "gateway_shutting_down",
          message: "Gateway is shutting down.",
        },
      },
    });
    expect(gate.getGatewayRejection("request-1")).toEqual({
      type: "res",
      id: "request-1",
      ok: false,
      error: {
        code: "gateway_shutting_down",
        message: "Gateway is shutting down.",
      },
    });
  });
});
