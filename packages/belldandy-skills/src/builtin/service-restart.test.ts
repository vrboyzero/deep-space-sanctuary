import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import { createServiceRestartTool } from "./service-restart.js";

const stateDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(stateDirs.splice(0).map((stateDir) => fs.rm(stateDir, { recursive: true, force: true })));
});

describe("createServiceRestartTool", () => {
  it("keeps the abortable countdown but delegates final restart instead of exiting directly", async () => {
    vi.useFakeTimers();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-service-restart-"));
    stateDirs.push(stateDir);
    const broadcast = vi.fn();
    const requestRestart = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined as never) as typeof process.exit);
    const tool = createServiceRestartTool(broadcast, requestRestart);
    const context: ToolContext = {
      conversationId: "conversation-restart",
      workspaceRoot: stateDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 30_000,
        maxResponseBytes: 512_000,
      },
    };

    const execution = tool.execute({ reason: "apply settings" }, context);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await execution;

    expect(result.success).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(4);
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(requestRestart).toHaveBeenCalledWith("apply settings");
    expect(exit).not.toHaveBeenCalled();
  });
});
