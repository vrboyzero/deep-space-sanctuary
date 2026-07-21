import { describe, expect, it } from "vitest";

import { claimSubTaskCommand } from "./subtask-command-claim.js";

describe("claimSubTaskCommand revision contract", () => {
  it("replays the active idempotency key before checking a stale expected revision", () => {
    const target = {
      status: "running",
      sessionId: "session-1",
      commandGeneration: 3,
    };
    const first = claimSubTaskCommand(target, {
      kind: "steering",
      commandId: "command-1",
      idempotencyKey: "request-1",
      ownerInstanceId: "runtime-1",
      requestedAt: 100,
      expectedSessionId: "session-1",
      expectedRevision: 3,
    });

    expect(first).toMatchObject({
      status: "claimed",
      claim: { generation: 4 },
    });

    const replay = claimSubTaskCommand(target, {
      kind: "steering",
      commandId: "command-retry",
      idempotencyKey: "request-1",
      ownerInstanceId: "runtime-2",
      requestedAt: 200,
      expectedSessionId: "session-1",
      expectedRevision: 3,
    });

    expect(replay).toEqual({
      status: "replayed",
      claim: first.status === "claimed" ? first.claim : undefined,
    });
  });

  it("rejects a different command with a stale revision without mutating the target", () => {
    const target = {
      status: "done",
      sessionId: "session-1",
      commandGeneration: 4,
    };

    const result = claimSubTaskCommand(target, {
      kind: "resume",
      commandId: "command-2",
      idempotencyKey: "request-2",
      ownerInstanceId: "runtime-1",
      requestedAt: 300,
      expectedSessionId: "session-1",
      expectedRevision: 3,
    });

    expect(result).toEqual({
      status: "rejected",
      code: "revision_conflict",
      reason: "Subtask command revision conflict. Expected 3, current 4.",
    });
    expect(target).toEqual({
      status: "done",
      sessionId: "session-1",
      commandGeneration: 4,
    });
  });

  it("reserves the next generation when expected revision matches", () => {
    const target = {
      status: "done",
      sessionId: "session-1",
      commandGeneration: 4,
    };

    const result = claimSubTaskCommand(target, {
      kind: "takeover",
      commandId: "command-3",
      idempotencyKey: "request-3",
      ownerInstanceId: "runtime-1",
      requestedAt: 400,
      expectedSessionId: "session-1",
      expectedRevision: 4,
    });

    expect(result).toMatchObject({
      status: "claimed",
      claim: { generation: 5 },
    });
    expect(target.commandGeneration).toBe(5);
  });

  it("claims stop once and replays the same request without replacing its owner", () => {
    const target = {
      status: "running",
      sessionId: "session-stop-1",
      commandGeneration: 0,
    };

    const first = claimSubTaskCommand(target, {
      kind: "stop",
      commandId: "stop-command-1",
      idempotencyKey: "stop-request-1",
      ownerInstanceId: "runtime-1",
      requestedAt: 500,
      expectedSessionId: "session-stop-1",
      expectedRevision: 0,
    });
    const replay = claimSubTaskCommand(target, {
      kind: "stop",
      commandId: "stop-command-retry",
      idempotencyKey: "stop-request-1",
      ownerInstanceId: "runtime-2",
      requestedAt: 600,
      expectedSessionId: "session-stop-1",
      expectedRevision: 0,
    });

    expect(first).toMatchObject({
      status: "claimed",
      claim: {
        kind: "stop",
        commandId: "stop-command-1",
        generation: 1,
        ownerInstanceId: "runtime-1",
      },
    });
    expect(replay).toEqual({
      status: "replayed",
      claim: first.status === "claimed" ? first.claim : undefined,
    });
  });
});
