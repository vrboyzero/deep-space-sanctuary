import { describe, expect, it, vi } from "vitest";

import {
  createConversationTaskCapabilityClosureBinding,
  createTaskCapabilityClosureResolver,
  createUnknownTaskCapabilityClosure,
  evaluateTaskCapabilityClosureForStart,
} from "./task-capability-closure.js";

const satisfied = createUnknownTaskCapabilityClosure(10);

describe("task capability closure resolver", () => {
  it("returns a cloned closure only for the exact binding", () => {
    const resolve = vi.fn((binding: { taskId: string }) => binding.taskId === "task-1"
      ? { ...satisfied, status: "satisfied" as const }
      : undefined);
    const resolver = createTaskCapabilityClosureResolver({ resolve, now: () => 20 });

    const result = resolver.resolve({ taskId: "task-1", source: "conversation", agentRunId: "run-1" });
    expect(result).toMatchObject({ status: "satisfied", evaluatedAtMs: 10 });
    expect(result).not.toBe(satisfied);
    expect(result?.capabilities).not.toBe(satisfied.capabilities);
    expect(resolve).toHaveBeenCalledWith({ taskId: "task-1", source: "conversation", agentRunId: "run-1" });
  });

  it("returns unknown for a missing exact owner result", () => {
    const resolver = createTaskCapabilityClosureResolver({ resolve: () => undefined, now: () => 21 });
    expect(resolver.resolve({ taskId: "task-2", source: "goal", agentRunId: "run-2" })).toMatchObject({
      status: "unknown",
      evaluatedAtMs: 21,
      capabilities: { tools: { reasonCode: "not_evaluated" } },
    });
  });

  it("fails closed for invalid, throwing, or malformed bindings without exposing owner details", () => {
    const resolver = createTaskCapabilityClosureResolver({
      resolve: (binding) => {
        if (binding.taskId === "throw") throw new Error("private owner detail");
        if (binding.taskId === "invalid") return { secret: "leak" } as never;
        return undefined;
      },
      now: () => 22,
    });

    expect(resolver.resolve({ taskId: "throw", source: "workflow", agentRunId: "run-3" })).toMatchObject({
      status: "unknown",
      capabilities: { tools: { reasonCode: "resolver_error" } },
    });
    expect(resolver.resolve({ taskId: "invalid", source: "subtask", agentRunId: "run-4" })).toMatchObject({
      status: "unknown",
      capabilities: { tools: { reasonCode: "invalid_owner_result" } },
    });
    expect(JSON.stringify(resolver.resolve({ taskId: "throw", source: "workflow", agentRunId: "run-3" }))).not.toMatch(/private|secret|leak/i);
    expect(resolver.resolve({ taskId: "", source: "conversation", agentRunId: "run-5" })).toMatchObject({
      status: "unknown",
      capabilities: { tools: { reasonCode: "invalid_binding" } },
    });
  });

  it("builds the same exact Conversation binding used by TaskProjection collection", () => {
    expect(createConversationTaskCapabilityClosureBinding({
      conversationId: "conversation-1",
      agentRunId: "run-1",
    })).toEqual({
      taskId: "conversation:conversation-1:run-1",
      source: "conversation",
      agentRunId: "run-1",
    });
  });

  it("allows only evaluated closures whose required capabilities are available", () => {
    expect(evaluateTaskCapabilityClosureForStart(satisfied)).toEqual({
      ok: false,
      reasonCode: "capability_closure_unknown",
      unavailable: [],
    });
    const blocked = {
      ...satisfied,
      status: "blocked" as const,
      capabilities: {
        ...satisfied.capabilities,
        verifier: { required: true, state: "unavailable" as const, reasonCode: "not_configured" },
        sandbox: { required: true, state: "degraded" as const, reasonCode: "not_isolated" },
      },
    };
    expect(evaluateTaskCapabilityClosureForStart(blocked)).toEqual({
      ok: false,
      reasonCode: "required_capability_unavailable",
      unavailable: ["sandbox", "verifier"],
    });
    expect(evaluateTaskCapabilityClosureForStart({
      ...satisfied,
      status: "satisfied",
      capabilities: Object.fromEntries(Object.entries(satisfied.capabilities).map(([name, capability]) => [
        name,
        { ...capability, state: "available" },
      ])) as typeof satisfied.capabilities,
    })).toEqual({ ok: true });
  });
});
