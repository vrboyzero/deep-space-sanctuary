import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runTuiCommand } from "./tui.js";

describe("bdd tui", () => {
  it("fails closed outside an interactive terminal", async () => {
    const runTui = vi.fn(async () => 0);
    const writeStderr = vi.fn();

    await expect(runTuiCommand({
      stateDir: "E:\\state",
      cwd: "E:\\workspace",
      stdinIsTTY: false,
      stdoutIsTTY: true,
      runTui,
      writeStderr,
    })).resolves.toBe(2);

    expect(runTui).not.toHaveBeenCalled();
    expect(writeStderr).toHaveBeenCalledWith("bdd tui requires an interactive stdin and stdout.\n");
  });

  it("passes resolved local paths to the full-screen runtime", async () => {
    const runTui = vi.fn(async () => 0);

    await expect(runTuiCommand({
      stateDir: "E:\\state",
      cwd: ".",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      runTui,
      writeStderr: vi.fn(),
    })).resolves.toBe(0);

    expect(runTui).toHaveBeenCalledWith(expect.objectContaining({
      stateDir: path.resolve("E:\\state"),
      cwd: process.cwd(),
    }));
  });
});
