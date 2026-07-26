import { writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanupPersistedOciSandboxLease,
  createOciSandboxLease,
  type OciRuntimeCommandRunner,
  type OciSandboxLease,
} from "./command-sandbox-lease.js";
import type { OciCommandSandboxConfig } from "./command-sandbox.js";

const ociConfig: OciCommandSandboxConfig = {
  backend: "oci",
  runtime: "docker",
  image: "ghcr.io/example/command-sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const leases: OciSandboxLease[] = [];

afterEach(async () => {
  await Promise.all(leases.splice(0).map((lease) => lease.cleanupArtifacts()));
});

async function createLease(runner?: OciRuntimeCommandRunner): Promise<OciSandboxLease> {
  const lease = await createOciSandboxLease({
    config: ociConfig,
    ...(runner ? { runRuntimeCommand: runner } : {}),
  });
  leases.push(lease);
  return lease;
}

describe("OciSandboxLease", () => {
  it("does not issue a cleanup command before the OCI run process starts", async () => {
    const runner = vi.fn<OciRuntimeCommandRunner>(async () => ({ success: true }));
    const lease = await createLease(runner);

    expect(lease.binding.containerName).toMatch(/^belldandy-command-[a-f0-9]{32}$/);
    expect(lease.binding.leaseId).toMatch(/^[a-f0-9-]{36}$/);

    await expect(lease.release()).resolves.toMatchObject({ status: "not_started" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("removes the started container by its cidfile identity", async () => {
    const runner = vi.fn<OciRuntimeCommandRunner>(async () => ({ success: true }));
    const lease = await createLease(runner);
    const containerId = "e".repeat(64);
    await writeFile(lease.binding.cidFile, containerId, "utf8");
    lease.markRuntimeStarted();

    await expect(lease.release()).resolves.toMatchObject({
      status: "removed",
      containerId,
    });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      executable: "docker",
      args: ["rm", "--force", containerId],
    }));
  });

  it("records a cleanup failure instead of treating an unreconciled container as released", async () => {
    const runner = vi.fn<OciRuntimeCommandRunner>(async () => ({ success: false }));
    const lease = await createLease(runner);
    lease.markRuntimeStarted();

    const release = await lease.release();

    expect(release).toMatchObject({ status: "cleanup_failed" });
    expect(lease.metadata(release)).toMatchObject({
      commandSandboxLeaseCleanupStatus: "cleanup_failed",
      commandSandboxContainerName: lease.binding.containerName,
    });
  });

  it("reconciles only a generated persisted container name after restart", async () => {
    const runner = vi.fn<OciRuntimeCommandRunner>(async () => ({ success: true }));
    const containerName = "belldandy-command-11111111111141118111111111111111";

    await expect(cleanupPersistedOciSandboxLease({
      lease: {
        runtime: "docker",
        containerName,
      },
      runRuntimeCommand: runner,
    })).resolves.toBe(true);
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      executable: "docker",
      args: ["rm", "--force", containerName],
    }));
    await expect(cleanupPersistedOciSandboxLease({
      lease: { runtime: "docker", containerName: "untrusted-name" },
      runRuntimeCommand: runner,
    })).resolves.toBe(false);
  });
});
