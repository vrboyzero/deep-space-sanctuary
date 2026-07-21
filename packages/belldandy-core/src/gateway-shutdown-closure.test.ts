import fs from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { GatewayShutdownCoordinator } from "./gateway-shutdown-coordinator.js";
import { createGatewayShutdownRequestOwner } from "./gateway-shutdown-request-owner.js";
import { registerGatewayShutdownResources } from "./gateway-shutdown-resources.js";
import { registerGatewayServerShutdownResources } from "./gateway-server-shutdown.js";

describe("Gateway shutdown closure", () => {
  it("continues the full shutdown chain and exits once when core and external owners fail", async () => {
    const events: string[] = [];
    const coordinator = new GatewayShutdownCoordinator();
    const owner = createGatewayShutdownRequestOwner({
      requestShutdown: (request) => coordinator.requestShutdown(request),
      exit: (exitCode) => {
        events.push(`exit:${exitCode}`);
      },
    });

    // 注册顺序与生产装配一致：server 先拥有 Core phases，Gateway Main 随后挂接外部 owner。
    registerGatewayServerShutdownResources(coordinator, {
      stopIntake: () => { events.push("gateway.intake.stop"); },
      abortActiveRuns: () => { events.push("runs.abort"); },
      drainActiveRuns: () => { events.push("runs.drain"); },
      disposeTopLevelConversations: () => { events.push("conversations.dispose"); },
      closeDurableExtraction: () => { events.push("extraction.close"); },
      flushConversationState: () => {
        events.push("conversations.flush");
        throw new Error("conversation fixture detail must not escape");
      },
      flushSubTaskState: () => { events.push("subtasks.flush"); },
      flushMemoryUsage: () => { events.push("memory.flush"); },
      detachRuntimeHooks: () => { events.push("hooks.detach"); },
      closeTransport: () => { events.push("transport.close"); },
    });
    registerGatewayShutdownResources(coordinator, {
      shutdownRequests: owner,
      configWatcher: { close: () => { events.push("config-watcher.close"); } },
      cron: {
        stop: () => { events.push("cron.stop"); },
        stopAndDrain: async () => { events.push("cron.drain"); },
      },
      heartbeat: {
        stop: () => { events.push("heartbeat.stop"); },
        stopAndDrain: async () => { events.push("heartbeat.drain"); },
      },
      emailInbound: {
        stop: async () => { events.push("email.stop"); },
      },
      activeNotify: {
        close: () => { events.push("active-notify.close"); },
      },
      channels: {
        stopChannels: async () => { events.push("channels.stop"); },
      },
      shutdownAgentBridge: async () => { events.push("agent-bridge.abort"); },
      shutdownMcp: async () => {
        events.push("mcp.close");
        throw new Error("mcp fixture detail must not escape");
      },
      browserRelay: {
        stop: async () => { events.push("relay.close"); },
      },
    });

    const first = owner.requestSystemRestart("closure fixture", {
      countdownSeconds: 0,
      graceMs: 0,
      broadcast: false,
    });
    const duplicate = owner.requestConfigRestart(".env.local");
    expect(duplicate).toBe(first);

    const result = await first;

    expect(result).toMatchObject({
      generation: 1,
      request: { kind: "system_restart", exitCode: 100 },
      outcome: "completed_with_failures",
      failures: [
        { stepId: "conversation-state", phase: "flush_state", kind: "step_error" },
        { stepId: "mcp", phase: "close_external", kind: "step_error" },
      ],
    });
    expect(events).toEqual([
      "gateway.intake.stop",
      "config-watcher.close",
      "cron.stop",
      "heartbeat.stop",
      "email.stop",
      "active-notify.close",
      "channels.stop",
      "runs.abort",
      "agent-bridge.abort",
      "runs.drain",
      "conversations.dispose",
      "extraction.close",
      "cron.drain",
      "heartbeat.drain",
      "conversations.flush",
      "subtasks.flush",
      "memory.flush",
      "mcp.close",
      "relay.close",
      "hooks.detach",
      "transport.close",
      "exit:100",
    ]);
    expect(owner.getRuntimeSnapshot()).toMatchObject({
      state: "completed",
      requestKind: "system_restart",
      requestCount: 2,
      ignoredRequestCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("fixture detail");
  });

  it("keeps Gateway Main as the unique runtime shutdown wiring owner", () => {
    const source = fs.readFileSync(new URL("./bin/gateway-main.ts", import.meta.url), "utf8");

    expect(source.match(/createGatewayShutdownRequestOwner\(/g)).toHaveLength(1);
    expect(source.match(/startGatewayConfigWatcher\(/g)).toHaveLength(1);
    expect(source.match(/server\.registerShutdownResources\(/g)).toHaveLength(1);
    expect(source.match(/shutdownRequestOwner\.installSignalHandlers\(/g)).toHaveLength(1);

    for (const registration of [
      "shutdownRequests: shutdownRequestOwner",
      "configWatcher",
      "cron: cronSchedulerHandle",
      "heartbeat: heartbeatRunner",
      "memoryIdleSummary: memoryIdleSummaryRuntime",
      "dreamAutomation: dreamAutomationRuntime",
      "backgroundRuns: backgroundRunCoordinator",
      "emailInbound: emailInboundRuntimeHandle",
      "activeNotify: starweaverActiveNotifyRuntimeHandle",
      "channels: channelRuntime",
      "shutdownMcp: shutdownMCPIntegration",
      "browserRelay: browserRelayRuntimeHandle",
      "shutdownAgentBridge: agentBridgeEnabled ? shutdownBridgeSessions : undefined",
    ]) {
      expect(source).toContain(registration);
    }

    expect(source).toContain("requestSystemRestart: (reason) => requestGatewaySystemRestart(reason)");
    expect(source).toContain("shutdownRequestOwner.requestConfigRestart(fileName)");
    expect(source).not.toContain("process.exit(100)");
    expect(source).not.toContain("process.once(\"exit\"");
    expect(source).not.toContain("new GatewayShutdownCoordinator");
  });
});
