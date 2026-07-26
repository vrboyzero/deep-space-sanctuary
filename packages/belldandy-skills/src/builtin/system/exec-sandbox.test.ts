import { beforeEach, describe, expect, it, vi } from "vitest";

const sandboxMocks = vi.hoisted(() => ({
  buildInvocation: vi.fn(),
  createEnvironmentFile: vi.fn(),
  createLease: vi.fn(),
  evaluateAdmission: vi.fn(),
}));

vi.mock("../../command-sandbox.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../command-sandbox.js")>();
  return {
    ...actual,
    buildOciSandboxInvocation: sandboxMocks.buildInvocation,
    buildSandboxRuntimeEnvironment: () => process.env,
    createOciSandboxEnvironmentFile: sandboxMocks.createEnvironmentFile,
    evaluateCommandSandboxAdmission: sandboxMocks.evaluateAdmission,
  };
});

vi.mock("../../command-sandbox-lease.js", () => ({
  createOciSandboxLease: sandboxMocks.createLease,
}));

import { runCommandTool } from "./exec.js";

const sandboxConfig = {
  backend: "oci" as const,
  runtime: "docker" as const,
  image: "ghcr.io/example/command-sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const leaseBinding = {
  leaseId: "1f99f6f4-6d6e-4bdf-9d3d-56e4b305ef4c",
  containerName: "belldandy-command-1f99f6f46d6e4bdf9d3d56e4b305ef4c",
  cidFile: "C:\\temp\\belldandy-command-sandbox.cid",
};

describe("run_command sandbox lease cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sandboxMocks.evaluateAdmission.mockResolvedValue({
      allowed: true,
      sandbox: sandboxConfig,
    });
    sandboxMocks.buildInvocation.mockReturnValue({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('sandbox-ok')"],
      cwd: process.cwd(),
    });
  });

  it("cleans the temporary environment file even when the OCI container cleanup fails", async () => {
    const environmentCleanup = vi.fn().mockResolvedValue(undefined);
    const lease = {
      binding: leaseBinding,
      markRuntimeStarted: vi.fn(),
      release: vi.fn().mockResolvedValue({ status: "cleanup_failed" }),
      cleanupArtifacts: vi.fn(),
      metadata: vi.fn(() => ({
        commandSandboxLeaseId: leaseBinding.leaseId,
        commandSandboxContainerName: leaseBinding.containerName,
        commandSandboxLeaseCleanupStatus: "cleanup_failed",
      })),
    };
    sandboxMocks.createEnvironmentFile.mockResolvedValue({ cleanup: environmentCleanup });
    sandboxMocks.createLease.mockResolvedValue(lease);

    const result = await runCommandTool.execute({
      commandPlan: {
        executable: "node",
        argv: ["--version"],
        env: { PRIVATE_TOKEN: "opaque-value" },
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    }, {
      conversationId: "sandbox-cleanup-test",
      workspaceRoot: process.cwd(),
      policy: {
        allowedPaths: [],
        deniedPaths: [],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5_000,
        maxResponseBytes: 4_096,
      },
      launchSpec: { commandSandbox: "required" },
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(environmentCleanup).toHaveBeenCalledOnce();
    expect(lease.cleanupArtifacts).toHaveBeenCalledOnce();
    expect(sandboxMocks.buildInvocation).toHaveBeenCalledWith(expect.objectContaining({
      lease: leaseBinding,
    }));
    expect(result).toMatchObject({
      success: false,
      failureKind: "environment_error",
      metadata: {
        commandSandboxLeaseCleanupStatus: "cleanup_failed",
      },
    });
    expect(result.error).toContain("container cleanup failed");
  });
});
