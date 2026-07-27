import { describe, expect, it, vi } from "vitest";

import {
  BackgroundRunCoordinator,
  type BackgroundRunClaimResult,
} from "./background-run-coordinator.js";
import { GatewayShutdownCoordinator } from "./gateway-shutdown-coordinator.js";
import { registerGatewayShutdownResources } from "./gateway-shutdown-resources.js";

function requireClaim(result: BackgroundRunClaimResult) {
  if ("reason" in result) {
    throw new Error(`Expected claim to be accepted: ${result.reason}`);
  }
  return result;
}

describe("registerGatewayShutdownResources", () => {
  it("stops intake before awaiting drains and closes every configured owner exactly once", async () => {
    const events: string[] = [];
    let releaseEmail!: () => void;
    let releaseChannels!: () => void;
    const emailDrain = new Promise<void>((resolve) => {
      releaseEmail = resolve;
    });
    const channelDrain = new Promise<void>((resolve) => {
      releaseChannels = resolve;
    });
    const resources = {
      cron: {
        stop: vi.fn(() => {
          events.push("cron.stop");
        }),
        stopAndDrain: vi.fn(async () => {
          events.push("cron.drain");
        }),
      },
      heartbeat: {
        stop: vi.fn(() => {
          events.push("heartbeat.stop");
        }),
        stopAndDrain: vi.fn(async () => {
          events.push("heartbeat.drain");
        }),
      },
      emailInbound: {
        stop: vi.fn(() => {
          events.push("email.stop");
          return emailDrain;
        }),
      },
      activeNotify: {
        close: vi.fn(() => {
          events.push("active-notify.close");
        }),
      },
      channels: {
        stopChannels: vi.fn(() => {
          events.push("channels.stop");
          return channelDrain;
        }),
      },
      shutdownMcp: vi.fn(async () => {
        events.push("mcp.close");
      }),
      browserRelay: {
        stop: vi.fn(async () => {
          events.push("relay.close");
        }),
      },
      shutdownAgentBridge: vi.fn(async () => {
        events.push("agent-bridge.abort");
      }),
      shutdownCommandJobs: vi.fn(async () => {
        events.push("command-jobs.abort");
      }),
    };
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayShutdownResources(coordinator, resources);

    const shutdown = coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    await vi.waitFor(() => {
      expect(events).toContain("channels.stop");
    });
    expect(events).toEqual([
      "cron.stop",
      "heartbeat.stop",
      "email.stop",
      "active-notify.close",
      "channels.stop",
      "agent-bridge.abort",
      "command-jobs.abort",
      "cron.drain",
      "heartbeat.drain",
    ]);

    releaseEmail();
    releaseChannels();
    await expect(shutdown).resolves.toMatchObject({ outcome: "completed" });
    expect(events).toEqual([
      "cron.stop",
      "heartbeat.stop",
      "email.stop",
      "active-notify.close",
      "channels.stop",
      "agent-bridge.abort",
      "command-jobs.abort",
      "cron.drain",
      "heartbeat.drain",
      "mcp.close",
      "relay.close",
    ]);
    expect(resources.emailInbound.stop).toHaveBeenCalledTimes(1);
    expect(resources.channels.stopChannels).toHaveBeenCalledTimes(1);
    expect(resources.browserRelay.stop).toHaveBeenCalledTimes(1);
  });

  it("accepts an empty resource set and lets later close owners run after a failure", async () => {
    const emptyCoordinator = new GatewayShutdownCoordinator();
    registerGatewayShutdownResources(emptyCoordinator, {});
    await expect(emptyCoordinator.requestShutdown({ kind: "manual", exitCode: 0 })).resolves.toMatchObject({
      outcome: "completed",
      completedStepCount: 0,
    });

    const relayStop = vi.fn(async () => undefined);
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayShutdownResources(coordinator, {
      shutdownMcp: async () => {
        throw new Error("sensitive MCP failure");
      },
      browserRelay: { stop: relayStop },
    });

    const result = await coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    expect(result).toMatchObject({
      outcome: "completed_with_failures",
      failures: [
        { stepId: "mcp", phase: "close_external", kind: "step_error" },
      ],
    });
    expect(relayStop).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("sensitive MCP failure");
  });

  it("disposes isolated extension runtimes in the close_external phase", async () => {
    const dispose = vi.fn(async () => {
      throw new Error("extension cleanup detail");
    });
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayShutdownResources(coordinator, {
      extensionRuntime: { dispose },
    });

    const result = await coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    expect(result).toMatchObject({
      outcome: "completed_with_failures",
      failures: [{ stepId: "extension-runtime", phase: "close_external", kind: "step_error" }],
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("cleanup detail");
  });

  it("stops memory and dream intake before draining the shared background coordinator", async () => {
    const events: string[] = [];
    let releaseCoordinator!: () => void;
    const coordinatorDrain = new Promise<void>((resolve) => {
      releaseCoordinator = resolve;
    });
    const resources = {
      memoryIdleSummary: {
        stop: vi.fn(() => {
          events.push("memory.stop");
        }),
        stopAndDrain: vi.fn(async () => {
          events.push("memory.drain");
        }),
      },
      dreamAutomation: {
        stop: vi.fn(() => {
          events.push("dream.stop");
        }),
        stopAndDrain: vi.fn(async () => {
          events.push("dream.drain");
        }),
      },
      backgroundRuns: {
        stopAndDrain: vi.fn(() => {
          events.push("background.stop-and-drain");
          return coordinatorDrain;
        }),
      },
    };
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayShutdownResources(coordinator, resources);

    const shutdown = coordinator.requestShutdown({ kind: "manual", exitCode: 0 });
    await vi.waitFor(() => {
      expect(events).toContain("dream.drain");
    });
    expect(events).toEqual([
      "memory.stop",
      "dream.stop",
      "background.stop-and-drain",
      "memory.drain",
      "dream.drain",
    ]);

    releaseCoordinator();
    await expect(shutdown).resolves.toMatchObject({ outcome: "completed" });
    expect(resources.backgroundRuns.stopAndDrain).toHaveBeenCalledTimes(1);
  });

  it("reaches zero shared activity even when one background owner drain fails", async () => {
    const backgroundRuns = new BackgroundRunCoordinator({ maxConcurrentRuns: 1 });
    const memoryClaim = requireClaim(backgroundRuns.tryClaim({ kind: "memory", key: "summary" }));
    const queuedDream = backgroundRuns.acquire({ kind: "dream", key: "automatic" });
    await vi.waitFor(() => {
      expect(backgroundRuns.getRuntimeSnapshot()).toMatchObject({
        activeCount: 1,
        queuedCount: 1,
      });
    });
    const coordinator = new GatewayShutdownCoordinator();
    registerGatewayShutdownResources(coordinator, {
      memoryIdleSummary: {
        stop: vi.fn(),
        stopAndDrain: async () => {
          await memoryClaim.complete(() => undefined);
        },
      },
      dreamAutomation: {
        stop: vi.fn(),
        stopAndDrain: async () => {
          throw new Error("dream drain fixture detail");
        },
      },
      backgroundRuns,
    });

    const result = await coordinator.requestShutdown({ kind: "manual", exitCode: 0 });

    expect(result).toMatchObject({
      outcome: "completed_with_failures",
      failures: [
        { stepId: "dream-automation-drain", phase: "drain", kind: "step_error" },
      ],
    });
    await expect(queuedDream).resolves.toEqual({
      reason: "Background run coordinator is stopped.",
    });
    expect(backgroundRuns.getRuntimeSnapshot()).toMatchObject({
      activeCount: 0,
      queuedCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain("fixture detail");
  });
});
