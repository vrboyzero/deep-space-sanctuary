import type { FSWatcher } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startGatewayConfigWatcher } from "./gateway-watch-runtime.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startGatewayConfigWatcher", () => {
  it("debounces watched config changes and close cancels the watcher and pending restart", async () => {
    vi.useFakeTimers();
    let watchListener!: (eventType: string, fileName: string | Buffer | null) => void;
    const close = vi.fn();
    const watch = vi.fn((_path, listener) => {
      watchListener = listener as typeof watchListener;
      return { close } as unknown as FSWatcher;
    });
    const onRestartRequired = vi.fn();
    const handle = startGatewayConfigWatcher({
      envDir: "C:/state",
      envPath: "C:/state/.env",
      envLocalPath: "C:/state/.env.local",
      logger: { info: vi.fn() },
      onRestartRequired,
      debounceMs: 100,
      watch,
    });

    watchListener("change", ".env");
    await vi.advanceTimersByTimeAsync(50);
    watchListener("change", ".env.local");
    await vi.advanceTimersByTimeAsync(99);
    expect(onRestartRequired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onRestartRequired).toHaveBeenCalledTimes(1);
    expect(onRestartRequired).toHaveBeenCalledWith(".env.local");

    watchListener("change", ".env");
    handle.close();
    handle.close();
    await vi.runAllTimersAsync();
    expect(onRestartRequired).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
