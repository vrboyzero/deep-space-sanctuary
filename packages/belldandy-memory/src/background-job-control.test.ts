import { describe, expect, it } from "vitest";

import { BackgroundAbortRegistry, BackgroundPauseGate } from "./background-job-control.js";

describe("background job control", () => {
  it("removes only the cancelled pause waiter and resumes the remaining waiters", async () => {
    const gate = new BackgroundPauseGate();
    const cancelled = new AbortController();
    gate.pause();
    const cancelledWait = gate.wait(cancelled.signal);
    const resumedWait = gate.wait();

    cancelled.abort(new Error("cancel one waiter"));
    await expect(cancelledWait).rejects.toThrow("cancel one waiter");

    gate.resume();
    await expect(resumedWait).resolves.toBeUndefined();
  });

  it("uses the parent signal as the terminal reason even when the operation ignores it", async () => {
    const registry = new BackgroundAbortRegistry();
    const controller = new AbortController();
    const run = registry.run({
      timeoutMs: 60_000,
      fallbackTimeoutMs: 60_000,
      timeoutMessage: () => "unexpected timeout",
      signal: controller.signal,
      operation: async () => await new Promise<never>(() => {}),
    });

    controller.abort(new Error("owner stopped"));

    await expect(run).rejects.toThrow("owner stopped");
  });
});
