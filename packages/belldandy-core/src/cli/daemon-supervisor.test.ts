import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";
import type { WorkspacePackageBuildGuardResult } from "./workspace-build-guard.js";

const {
  createGatewaySupervisorLifecycleMock,
  forkMock,
  preflightGatewayCleanupMock,
  ensureFreshWorkspaceBuildsForDevRuntimeMock,
  supervisorLifecycleStartMock,
  writeForegroundPidMock,
} = vi.hoisted(() => ({
  createGatewaySupervisorLifecycleMock: vi.fn(),
  forkMock: vi.fn(),
  preflightGatewayCleanupMock: vi.fn(async () => {}),
  ensureFreshWorkspaceBuildsForDevRuntimeMock: vi.fn<() => WorkspacePackageBuildGuardResult>(() => ({ ok: true, mode: "verified", packageNames: [] })),
  supervisorLifecycleStartMock: vi.fn(async () => {}),
  writeForegroundPidMock: vi.fn(),
}));

createGatewaySupervisorLifecycleMock.mockImplementation(() => ({
  start: supervisorLifecycleStartMock,
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
    createGatewaySupervisorLifecycle: createGatewaySupervisorLifecycleMock,
    loadRuntimeEnvFiles: vi.fn((baseEnv: NodeJS.ProcessEnv) => ({ ...baseEnv })),
    readTrimmedEnv: vi.fn((env: NodeJS.ProcessEnv, key: string) => {
      const value = env[key];
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }),
    RESTART_DELAY_MS: 500,
    RESTART_EXIT_CODE: 100,
    resolveRuntimeEnvDir: vi.fn(({ fallbackEnvDir }: { fallbackEnvDir: string }) => fallbackEnvDir),
    preflightGatewayCleanup: preflightGatewayCleanupMock,
    removeForegroundPid: vi.fn(),
    writeForegroundPid: writeForegroundPidMock,
  };
});

vi.mock("./workspace-build-guard.js", () => ({
  ensureFreshWorkspaceBuildsForDevRuntime: ensureFreshWorkspaceBuildsForDevRuntimeMock,
}));

import { startDaemon, startForeground } from "./daemon.js";

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

test("startDaemon returns an error when dev runtime workspace build guard fails", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-daemon-build-guard-"));
  tempDirs.push(stateDir);

  ensureFreshWorkspaceBuildsForDevRuntimeMock.mockReturnValue({
    ok: false,
    mode: "failed",
    packageNames: ["@belldandy/agent"],
    reason: "Workspace package build guard failed while rebuilding: @belldandy/agent",
  });

  const result = await startDaemon(stateDir);

  expect(result).toEqual({
    success: false,
    error: "Workspace package build guard failed while rebuilding: @belldandy/agent",
  });
  expect(forkMock).not.toHaveBeenCalled();
});

test("startForeground delegates restart and signal ownership to the shared supervisor lifecycle", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-foreground-supervisor-"));
  tempDirs.push(stateDir);
  ensureFreshWorkspaceBuildsForDevRuntimeMock.mockReturnValue({ ok: true, mode: "verified", packageNames: [] });
  const child = { pid: 5432 };
  forkMock.mockReturnValue(child);

  await startForeground(stateDir);

  expect(preflightGatewayCleanupMock).toHaveBeenCalledTimes(1);
  expect(createGatewaySupervisorLifecycleMock).toHaveBeenCalledTimes(1);
  expect(supervisorLifecycleStartMock).toHaveBeenCalledTimes(1);

  const lifecycleOptions = createGatewaySupervisorLifecycleMock.mock.calls[0]?.[0];
  expect(lifecycleOptions).toMatchObject({
    label: "Launcher",
    restartExitCode: 100,
    restartDelayMs: 500,
    signalTarget: process,
  });
  await lifecycleOptions.launch();

  expect(forkMock).toHaveBeenCalledTimes(1);
  expect(writeForegroundPidMock).toHaveBeenCalledWith(stateDir, 5432);
});
