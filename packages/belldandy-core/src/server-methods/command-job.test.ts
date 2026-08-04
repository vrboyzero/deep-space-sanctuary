import { describe, expect, it } from "vitest";

import type { CommandJobReadResult, CommandJobRuntime, CommandJobSnapshot } from "@belldandy/skills";

import { handleCommandJobMethod } from "./command-job.js";

function snapshot(jobId: string, status: CommandJobSnapshot["status"] = "running"): CommandJobSnapshot {
  return {
    jobId,
    status,
    stdinMode: "closed",
    createdAt: 1_000,
    updatedAt: 1_000,
    supportsResize: false,
    oldestCursor: 0,
    nextCursor: 23,
    recovery: status === "running"
      ? {
        lifecycle: "active",
        process: "attached",
        output: "memory_only",
        stdin: "closed",
        mutationReplay: "forbidden",
      }
      : status === "lost"
        ? {
          lifecycle: "lost",
          process: "not_reattachable",
          output: "unavailable",
          stdin: "closed",
          mutationReplay: "forbidden",
        }
        : {
          lifecycle: "settled",
          process: "not_applicable",
          output: "memory_only",
          stdin: "closed",
          mutationReplay: "forbidden",
        },
  };
}

function runtime(input: Partial<CommandJobRuntime> = {}): CommandJobRuntime {
  return {
    list: () => [],
    read: () => { throw new Error("Command job was not found."); },
    cancel: async () => { throw new Error("Command job was not found."); },
    ...input,
  };
}

describe("command job Gateway methods", () => {
  it("lists live jobs without exposing buffered output", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const owner = runtime({ list: () => [snapshot(jobId)] });

    const response = await handleCommandJobMethod(
      { type: "req", id: "list", method: "command.job.list", params: {} },
      { runtime: owner },
    );

    expect(response).toMatchObject({
      type: "res",
      id: "list",
      ok: true,
      payload: {
        jobs: [{
          jobId,
          status: "running",
          nextCursor: 23,
        }],
      },
    });
    expect(JSON.stringify(response)).not.toContain("private terminal output");
  });

  it("reads one bounded output page from the exact live job", async () => {
    const jobId = "22222222-2222-4222-8222-222222222222";
    let readInput: { jobId: string; maxBytes?: number } | undefined;
    const owner = runtime({
      read: (requestedJobId, input): CommandJobReadResult => {
        const options = input ?? {};
        readInput = { jobId: requestedJobId, maxBytes: options.maxBytes };
        return {
          ...snapshot(requestedJobId),
          output: "x".repeat(options.maxBytes ?? 0),
          startCursor: options.cursor ?? 0,
          nextCursor: options.maxBytes ?? 0,
          hasMore: true,
          cursorExpired: false,
          cursorAdjusted: false,
        };
      },
    });

    const response = await handleCommandJobMethod(
      {
        type: "req",
        id: "read",
        method: "command.job.read",
        params: {
          jobId,
          cursor: 0,
          maxBytes: 999_999,
        },
      },
      { runtime: owner },
    );

    expect(response).toMatchObject({
      ok: true,
      payload: {
        jobId,
        output: "x".repeat(16 * 1024),
        startCursor: 0,
        nextCursor: 16 * 1024,
        hasMore: true,
      },
    });
    expect(readInput).toEqual({ jobId, maxBytes: 16 * 1024 });
  });

  it("cancels only the exact requested live job", async () => {
    const selectedJobId = "33333333-3333-4333-8333-333333333333";
    const otherJobId = "44444444-4444-4444-8444-444444444444";
    const cancelled: string[] = [];
    const owner = runtime({
      list: () => [snapshot(selectedJobId), snapshot(otherJobId)],
      cancel: async (jobId) => {
        cancelled.push(jobId);
        return snapshot(jobId, "cancelled");
      },
    });

    const response = await handleCommandJobMethod(
      { type: "req", id: "cancel", method: "command.job.cancel", params: { jobId: selectedJobId } },
      { runtime: owner },
    );

    expect(response).toMatchObject({ ok: true, payload: { jobId: selectedJobId, status: "cancelled" } });
    expect(cancelled).toEqual([selectedJobId]);
    expect(owner.list().find((job) => job.jobId === otherJobId)?.status).toBe("running");
  });

  it("rejects unsupported params and redacts owner cursor errors", async () => {
    const jobId = "66666666-6666-4666-8666-666666666666";
    let readCalls = 0;
    const owner = runtime({
      read: () => {
        readCalls += 1;
        throw new Error(`Command job ${jobId} cursor is ahead of available output.`);
      },
    });

    await expect(handleCommandJobMethod(
      { type: "req", id: "invalid", method: "command.job.read", params: { jobId, secret: "no" } },
      { runtime: owner },
    )).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
    expect(readCalls).toBe(0);

    const cursorFailure = await handleCommandJobMethod(
      { type: "req", id: "cursor", method: "command.job.read", params: { jobId, cursor: 24 } },
      { runtime: owner },
    );
    expect(cursorFailure).toMatchObject({
      ok: false,
      error: { code: "invalid_cursor", message: "Command job output cursor is unavailable." },
    });
    expect(JSON.stringify(cursorFailure)).not.toContain(jobId);
  });
});
