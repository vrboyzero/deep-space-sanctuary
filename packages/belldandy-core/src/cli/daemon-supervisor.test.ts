import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

const { forkMock, preflightGatewayCleanupMock } = vi.hoisted(() => ({
  forkMock: vi.fn(),
  preflightGatewayCleanupMock: vi.fn(async () => {}),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: forkMock,
  };
});

vi.mock("@star-sanctuary/distribution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@star-sanctuary/distribution")>();
  return {
    ...actual,
    ensureDefaultEnvFiles: vi.fn(),
    loadRuntimeEnvFiles: vi.fn((baseEnv: NodeJS.ProcessEnv) => ({ ...baseEnv })),
    readTrimmedEnv: vi.fn((env: NodeJS.ProcessEnv, key: string) => {
      const value = env[key];
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }),
    resolveRuntimeEnvDir: vi.fn(({ fallbackEnvDir }: { fallbackEnvDir: string }) => fallbackEnvDir),
    preflightGatewayCleanup: preflightGatewayCleanupMock,
    removeForegroundPid: vi.fn(),
    writeForegroundPid: vi.fn(),
  };
});

import { startDaemon } from "./daemon.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("startDaemon launches the bdd supervisor instead of the gateway entry directly", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-daemon-supervisor-"));
  tempDirs.push(stateDir);

  const child = {
    pid: 4321,
    unref: vi.fn(),
  };
  forkMock.mockReturnValue(child);

  const result = await startDaemon(stateDir);

  expect(result).toEqual({ success: true, pid: 4321 });
  expect(preflightGatewayCleanupMock).toHaveBeenCalledTimes(1);
  expect(forkMock).toHaveBeenCalledTimes(1);

  const [scriptPath, args, options] = forkMock.mock.calls[0];
  expect(String(scriptPath).replaceAll("\\", "/")).toMatch(/\/bin\/bdd\.(ts|js)$/);
  expect(args).toEqual(["start", "--state-dir", stateDir]);
  expect(options).toMatchObject({
    detached: true,
    execArgv: expect.any(Array),
  });
  expect(child.unref).toHaveBeenCalledTimes(1);

  const pidContent = await fs.readFile(path.join(stateDir, "gateway.pid"), "utf-8");
  expect(pidContent.trim()).toBe("4321");
});
