import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import { logReadTool, logSearchTool } from "./log.js";

describe("log tools", () => {
  let workspaceRoot: string;
  let baseContext: ToolContext;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-log-tool-"));
    await fs.mkdir(path.join(workspaceRoot, "logs"), { recursive: true });
    baseContext = {
      conversationId: "conv-log-tool-test",
      workspaceRoot,
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5000,
        maxResponseBytes: 1024 * 1024,
      },
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("log_read keeps the caller date in local calendar format instead of shifting to the previous UTC day", async () => {
    await fs.writeFile(
      path.join(workspaceRoot, "logs", "2026-06-26.log"),
      "[ERROR][gateway] logHint=close-inherited-handles-before-spawning-vitest-child\n",
      "utf-8",
    );

    const result = await logReadTool.execute({
      date: "2026-06-26",
      keyword: "logHint",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("logHint=close-inherited-handles-before-spawning-vitest-child");
    expect(result.output).not.toContain("指定日期 2026-06-25");
  });

  it("log_search defaults to the local calendar day when building the date range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 26, 0, 30, 0));

    await fs.writeFile(
      path.join(workspaceRoot, "logs", "2026-06-26.log"),
      "[ERROR][gateway] spawn EPERM while launching pnpm test\n",
      "utf-8",
    );

    const result = await logSearchTool.execute({
      query: "spawn EPERM",
    }, baseContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("spawn EPERM");
    expect(result.output).not.toContain("2026-06-25");
  });
});
