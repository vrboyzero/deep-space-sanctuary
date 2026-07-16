import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RESTART_EXIT_CODE,
  RESTART_DELAY_MS,
  createGatewaySupervisorLifecycle,
  type GatewaySupervisorChild,
  type GatewaySupervisorSignal,
  type GatewaySupervisorSignalTarget,
} from "./gateway-supervisor-lifecycle.js";

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
type ErrorListener = (error: Error) => void;

class FakeChild implements GatewaySupervisorChild {
  readonly exitListeners = new Set<ExitListener>();
  readonly errorListeners = new Set<ErrorListener>();
  readonly kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killed = true;
    return Boolean(signal);
  });
  killed = false;

  constructor(readonly pid?: number) {}

  once(event: "exit", listener: ExitListener): this;
  once(event: "error", listener: ErrorListener): this;
  once(event: "exit" | "error", listener: ExitListener | ErrorListener): this {
    if (event === "exit") {
      this.exitListeners.add(listener as ExitListener);
    } else {
      this.errorListeners.add(listener as ErrorListener);
    }
    return this;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    for (const listener of this.exitListeners) {
      this.exitListeners.delete(listener);
      listener(code, signal);
    }
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      this.errorListeners.delete(listener);
      listener(error);
    }
  }
}

class FakeSignalTarget implements GatewaySupervisorSignalTarget {
  readonly listeners = new Map<GatewaySupervisorSignal, Set<() => void>>();

  on(signal: GatewaySupervisorSignal, listener: () => void): this {
    const listeners = this.listeners.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
    return this;
  }

  off(signal: GatewaySupervisorSignal, listener: () => void): this {
    this.listeners.get(signal)?.delete(listener);
    return this;
  }

  emit(signal: GatewaySupervisorSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) {
      listener();
    }
  }

  listenerCount(signal: GatewaySupervisorSignal): number {
    return this.listeners.get(signal)?.size ?? 0;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Gateway supervisor lifecycle", () => {
  it("keeps one signal listener pair across restart cycles and settles a child once", async () => {
    vi.useFakeTimers();
    const signalTarget = new FakeSignalTarget();
    const firstChild = new FakeChild(101);
    const secondChild = new FakeChild(102);
    const launch = vi.fn<() => Promise<GatewaySupervisorChild>>()
      .mockResolvedValueOnce(firstChild)
      .mockResolvedValueOnce(secondChild);
    const removeForegroundPid = vi.fn();
    const onExit = vi.fn();
    const lifecycle = createGatewaySupervisorLifecycle({
      label: "Test Gateway",
      launch,
      removeForegroundPid,
      onExit,
      signalTarget,
    });

    await lifecycle.start();
    expect(signalTarget.listenerCount("SIGINT")).toBe(1);
    expect(signalTarget.listenerCount("SIGTERM")).toBe(1);

    firstChild.emitExit(RESTART_EXIT_CODE);
    firstChild.emitError(new Error("late spawn error"));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);

    expect(launch).toHaveBeenCalledTimes(2);
    expect(removeForegroundPid).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(signalTarget.listenerCount("SIGINT")).toBe(1);
    expect(signalTarget.listenerCount("SIGTERM")).toBe(1);
  });

  it("handles spawn errors once and detaches the parent signal listeners", async () => {
    const signalTarget = new FakeSignalTarget();
    const child = new FakeChild();
    const removeForegroundPid = vi.fn();
    const onExit = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const lifecycle = createGatewaySupervisorLifecycle({
      label: "Test Gateway",
      launch: vi.fn().mockResolvedValue(child),
      removeForegroundPid,
      onExit,
      signalTarget,
      logger,
    });

    await lifecycle.start();
    child.emitError(new Error("spawn ENOENT"));
    child.emitExit(RESTART_EXIT_CODE);

    expect(removeForegroundPid).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith("[Test Gateway] Failed to start gateway: spawn ENOENT");
    expect(signalTarget.listenerCount("SIGINT")).toBe(0);
    expect(signalTarget.listenerCount("SIGTERM")).toBe(0);
  });

  it("cancels a pending restart when shutdown arrives between child generations", async () => {
    vi.useFakeTimers();
    const signalTarget = new FakeSignalTarget();
    const child = new FakeChild(101);
    const launch = vi.fn<() => Promise<GatewaySupervisorChild>>().mockResolvedValue(child);
    const removeForegroundPid = vi.fn();
    const onExit = vi.fn();
    const lifecycle = createGatewaySupervisorLifecycle({
      label: "Test Gateway",
      launch,
      removeForegroundPid,
      onExit,
      signalTarget,
    });

    await lifecycle.start();
    child.emitExit(RESTART_EXIT_CODE);
    signalTarget.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(RESTART_DELAY_MS);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(removeForegroundPid).toHaveBeenCalledTimes(2);
    expect(onExit).toHaveBeenCalledWith(0);
    expect(signalTarget.listenerCount("SIGINT")).toBe(0);
    expect(signalTarget.listenerCount("SIGTERM")).toBe(0);
  });

  it("forwards only the first shutdown signal to the active child", async () => {
    const signalTarget = new FakeSignalTarget();
    const child = new FakeChild(101);
    const onExit = vi.fn();
    const lifecycle = createGatewaySupervisorLifecycle({
      label: "Test Gateway",
      launch: vi.fn().mockResolvedValue(child),
      removeForegroundPid: vi.fn(),
      onExit,
      signalTarget,
    });

    await lifecycle.start();
    signalTarget.emit("SIGINT");
    signalTarget.emit("SIGTERM");
    child.emitExit(null, "SIGINT");

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    expect(onExit).toHaveBeenCalledWith(1);
  });
});
