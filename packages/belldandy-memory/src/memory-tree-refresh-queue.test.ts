import { describe, expect, it, vi } from "vitest";

import { MemoryTreeRefreshQueue } from "./memory-tree-refresh-queue.js";

describe("MemoryTreeRefreshQueue", () => {
  it("coalesces pending kinds and does not queue a kind already running", async () => {
    let releaseFirstRun!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const run = vi.fn(async () => {
      if (run.mock.calls.length === 1) {
        await firstRunGate;
      }
    });
    const queue = new MemoryTreeRefreshQueue({ run });

    queue.enqueue({ kinds: ["profile"], nodeLimit: 20, triggerSource: "first" });
    queue.enqueue({ kinds: ["profile", "global"], nodeLimit: 30, triggerSource: "second" });

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith({
      kinds: ["profile", "global"],
      nodeLimit: 30,
      triggerSource: "second",
    });

    queue.enqueue({ kinds: ["profile", "topic"], nodeLimit: 40, triggerSource: "third" });
    releaseFirstRun();

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run).toHaveBeenLastCalledWith({
      kinds: ["topic"],
      nodeLimit: 40,
      triggerSource: "third",
    });
    await queue.close();
  });

  it("drops a scheduled refresh when closed before the next event-loop turn", async () => {
    const run = vi.fn(async () => {});
    const queue = new MemoryTreeRefreshQueue({ run });

    queue.enqueue({ kinds: ["profile"], nodeLimit: 20, triggerSource: "close" });
    await queue.close();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(run).not.toHaveBeenCalled();
  });
});
