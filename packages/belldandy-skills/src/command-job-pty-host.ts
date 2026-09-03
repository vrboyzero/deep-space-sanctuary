import type { PtyHostControl, PtyHostEvent } from "./command-job-pty-host-runtime.js";
import { createPtyTerminalResponseFilter } from "./command-job-pty-terminal.js";

type NodePtyProcess = {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
};

type NodePtyModule = {
  spawn(command: string, args: string[], options: Record<string, unknown>): NodePtyProcess;
};

let ptyProcess: NodePtyProcess | undefined;
let startReceived = false;

function send(message: PtyHostEvent): void {
  process.send?.(message);
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  send({ type: "error", error: message.slice(0, 512) });
  setImmediate(() => process.exit(1));
}

async function start(message: Extract<PtyHostControl, { type: "start" }>): Promise<void> {
  if (startReceived) throw new Error("PTY host accepts exactly one start request.");
  startReceived = true;
  const imported = await import("node-pty");
  const nodePty = (imported.default ?? imported) as NodePtyModule;
  if (typeof nodePty.spawn !== "function") throw new Error("node-pty does not expose spawn().");

  const startedProcess = nodePty.spawn(message.invocation.executable, message.invocation.args, {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: message.invocation.cwd,
    env: message.invocation.env,
  });
  ptyProcess = startedProcess;
  const terminalFilter = createPtyTerminalResponseFilter();
  startedProcess.onData((data) => {
    const filtered = terminalFilter.consume(data);
    try {
      for (const response of filtered.responses) startedProcess.write(response);
    } catch (error) {
      fail(error);
      return;
    }
    if (filtered.output) send({ type: "data", data: filtered.output });
  });
  startedProcess.onExit((event) => {
    const trailingOutput = terminalFilter.flush();
    if (trailingOutput) send({ type: "data", data: trailingOutput });
    send({ type: "exit", exitCode: event.exitCode, ...(event.signal !== undefined ? { signal: event.signal } : {}) });
    setImmediate(() => process.exit(0));
  });
  send({ type: "started" });
}

process.on("message", (message: PtyHostControl) => {
  try {
    if (message.type === "start") {
      void start(message).catch(fail);
      return;
    }
    if (!ptyProcess) throw new Error("PTY host has not started a runtime process.");
    if (message.type === "write") ptyProcess.write(message.data);
    else if (message.type === "resize") ptyProcess.resize(message.cols, message.rows);
  } catch (error) {
    fail(error);
  }
});

process.on("disconnect", () => {
  try {
    ptyProcess?.kill("SIGKILL");
  } catch {
    // The PTY may already have exited with its host process.
  }
  process.exit(0);
});
