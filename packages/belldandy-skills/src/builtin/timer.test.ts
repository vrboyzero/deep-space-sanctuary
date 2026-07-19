import { describe, expect, it } from "vitest";

import { ToolExecutor } from "../executor.js";
import type { ToolContext } from "../types.js";
import {
  getTimerConversationResourceSnapshot,
  MAX_LAPS_PER_TIMER,
  MAX_TIMERS_PER_NAMESPACE,
  timerTool,
} from "./timer.js";

const TEST_POLICY = {
  allowedPaths: [],
  deniedPaths: [],
  allowedDomains: [],
  deniedDomains: [],
  maxTimeoutMs: 60_000,
  maxResponseBytes: 1024 * 1024,
};

function createContext(conversationId: string, agentId?: string): ToolContext {
  return {
    conversationId,
    agentId,
    workspaceRoot: "/tmp/timer-test",
    policy: TEST_POLICY,
  };
}

async function executeTimer(
  context: ToolContext,
  action: "start" | "stop" | "lap" | "reset" | "list",
  name?: string,
) {
  return timerTool.execute({ action, ...(name ? { name } : {}) }, context);
}

describe("timerTool", () => {
  it("releases only the target conversation through ToolExecutor and clears its registry", async () => {
    const executor = new ToolExecutor({
      tools: [timerTool],
      workspaceRoot: "/tmp/timer-test",
    });

    await executor.execute({ id: "timer-release-a", name: "timer", arguments: { action: "start", name: "shared" } }, "timer-release-a", "agent-a");
    await executor.execute({ id: "timer-release-b", name: "timer", arguments: { action: "start", name: "shared" } }, "timer-release-b", "agent-a");

    expect(getTimerConversationResourceSnapshot("timer-release-a")).toEqual({
      namespaces: 1,
      timers: 1,
      laps: 0,
    });
    executor.releaseConversation("timer-release-a");
    executor.releaseConversation("timer-release-a");

    expect(getTimerConversationResourceSnapshot("timer-release-a")).toEqual({
      namespaces: 0,
      timers: 0,
      laps: 0,
    });
    expect(getTimerConversationResourceSnapshot("timer-release-b").timers).toBe(1);
    expect((await executor.execute({ id: "timer-list-a", name: "timer", arguments: { action: "list" } }, "timer-release-a", "agent-a")).output)
      .toBe("当前没有活动的计时器");
    expect((await executor.execute({ id: "timer-list-b", name: "timer", arguments: { action: "list" } }, "timer-release-b", "agent-a")).output)
      .toContain("shared");

    executor.releaseConversation("timer-release-b");
  });

  it("isolates same-name timers by conversation and agent namespace", async () => {
    const firstConversation = createContext("timer-isolation-a", "agent-a");
    const secondConversation = createContext("timer-isolation-b", "agent-a");
    const secondAgent = createContext("timer-isolation-a", "agent-b");

    expect((await executeTimer(firstConversation, "start", "shared")).success).toBe(true);
    expect((await executeTimer(secondConversation, "list")).output).toBe("当前没有活动的计时器");
    expect((await executeTimer(secondAgent, "stop", "shared")).error).toContain("不存在");

    expect((await executeTimer(secondConversation, "start", "shared")).success).toBe(true);
    expect((await executeTimer(secondAgent, "start", "shared")).success).toBe(true);

    await executeTimer(firstConversation, "reset", "shared");
    await executeTimer(secondConversation, "reset", "shared");
    await executeTimer(secondAgent, "reset", "shared");
  });

  it("rejects new timers after the namespace limit without changing existing timers", async () => {
    const context = createContext("timer-capacity", "agent-a");
    const names = Array.from({ length: MAX_TIMERS_PER_NAMESPACE }, (_, index) => `timer-${index}`);

    for (const name of names) {
      expect((await executeTimer(context, "start", name)).success).toBe(true);
    }

    const rejected = await executeTimer(context, "start", "timer-over-limit");
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain(`最多 ${MAX_TIMERS_PER_NAMESPACE} 个`);

    const listed = await executeTimer(context, "list");
    expect(listed.output).not.toContain("timer-over-limit");
    for (const name of names) {
      await executeTimer(context, "reset", name);
    }
  });

  it("bounds lap history while still allowing the timer to stop", async () => {
    const context = createContext("timer-lap-capacity", "agent-a");
    await executeTimer(context, "start", "bounded-laps");

    for (let index = 0; index < MAX_LAPS_PER_TIMER; index += 1) {
      expect((await executeTimer(context, "lap", "bounded-laps")).success).toBe(true);
    }

    const rejected = await executeTimer(context, "lap", "bounded-laps");
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain(`最多 ${MAX_LAPS_PER_TIMER} 个`);
    expect((await executeTimer(context, "stop", "bounded-laps")).success).toBe(true);

    await executeTimer(context, "reset", "bounded-laps");
  });
});
