import { describe, expect, it } from "vitest";

import {
  createPtyHostCommandJobProcess,
  type PtyHostAdapter,
  type PtyHostControl,
  type PtyHostEvent,
} from "./command-job-pty-host-runtime.js";
import type { CommandJobProcessExit } from "./command-job.js";

class FakePtyHost implements PtyHostAdapter {
  readonly pid = 4312;
  readonly sent: PtyHostControl[] = [];
  terminateCalls = 0;
  sendError?: Error;
  private readonly messageListeners = new Set<(message: PtyHostEvent) => void>();
  private readonly closeListeners = new Set<(event: CommandJobProcessExit) => void>();

  send(message: PtyHostControl): void {
    if (this.sendError) throw this.sendError;
    this.sent.push(message);
  }

  onMessage(listener: (message: PtyHostEvent) => void): void {
    this.messageListeners.add(listener);
  }

  onClose(listener: (event: CommandJobProcessExit) => void): void {
    this.closeListeners.add(listener);
  }

  async terminate() {
    this.terminateCalls += 1;
    return { method: "taskkill" as const, hardKillUsed: true, closeObserved: true };
  }

  emitMessage(message: PtyHostEvent): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitClose(event: CommandJobProcessExit): void {
    for (const listener of this.closeListeners) listener(event);
  }
}

const invocation = {
  executable: "docker",
  args: ["run", "--network", "none"],
  cwd: process.cwd(),
  env: { PATH: process.env.PATH },
  startupTimeoutMs: 100,
};

describe("createPtyHostCommandJobProcess", () => {
  it("hides IPC while replaying early output and forwarding PTY controls", async () => {
    const host = new FakePtyHost();
    const creating = createPtyHostCommandJobProcess(invocation, () => host);
    host.emitMessage({ type: "data", data: "ready> " });
    host.emitMessage({ type: "started" });
    const process = await creating;

    const output: string[] = [];
    process.onData((data) => output.push(data));
    process.write("answer\n");
    process.resize(120, 36);

    expect(process).toMatchObject({ pid: host.pid, supportsResize: true });
    expect(output).toEqual(["ready> "]);
    expect(host.sent).toEqual([
      { type: "start", invocation: { executable: "docker", args: invocation.args, cwd: invocation.cwd, env: invocation.env } },
      { type: "write", data: "answer\n" },
      { type: "resize", cols: 120, rows: 36 },
    ]);

    host.emitMessage({ type: "exit", exitCode: 0 });
    const exits: CommandJobProcessExit[] = [];
    process.onExit((event) => exits.push(event));
    expect(exits).toEqual([{ exitCode: 0 }]);
  });

  it("terminates the host process tree when native PTY startup misses its deadline", async () => {
    const host = new FakePtyHost();

    await expect(createPtyHostCommandJobProcess({
      ...invocation,
      startupTimeoutMs: 10,
    }, () => host)).rejects.toThrow("PTY host startup timed out after 10ms.");

    expect(host.terminateCalls).toBe(1);
  });

  it("fails closed when the host exits before reporting a started runtime", async () => {
    const host = new FakePtyHost();
    const creating = createPtyHostCommandJobProcess(invocation, () => host);
    host.emitClose({ exitCode: 1 });

    await expect(creating).rejects.toThrow("PTY host exited before the sandbox runtime started.");
  });

  it("terminates the host when its initial IPC request cannot be sent", async () => {
    const host = new FakePtyHost();
    host.sendError = new Error("IPC unavailable");

    await expect(createPtyHostCommandJobProcess(invocation, () => host)).rejects.toThrow("IPC unavailable");

    expect(host.terminateCalls).toBe(1);
  });
});
