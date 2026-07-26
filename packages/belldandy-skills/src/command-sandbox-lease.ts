import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  buildSandboxRuntimeEnvironment,
  type OciCommandSandboxConfig,
  type OciSandboxLeaseBinding,
} from "./command-sandbox.js";

const OCI_CLEANUP_TIMEOUT_MS = 5_000;
const OCI_CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;
const OCI_CONTAINER_NAME_PATTERN = /^belldandy-command-[a-f0-9]{32}$/i;

export type OciRuntimeCommandInvocation = {
  executable: "docker" | "podman";
  args: string[];
  cwd: string;
};

export type OciRuntimeCommandRunner = (
  invocation: OciRuntimeCommandInvocation,
) => Promise<{ success: boolean }>;

export type OciSandboxLeaseRelease = {
  status: "not_started" | "removed" | "cleanup_failed";
  containerId?: string;
};

export type OciSandboxLease = {
  binding: OciSandboxLeaseBinding;
  markRuntimeStarted(): void;
  release(): Promise<OciSandboxLeaseRelease>;
  cleanupArtifacts(): Promise<void>;
  metadata(release?: OciSandboxLeaseRelease): Record<string, string>;
};

export type PersistedOciSandboxLease = {
  runtime: "docker" | "podman";
  containerName: string;
};

function terminateRuntimeChild(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
    return;
  } catch {
    // The cleanup helper may already be gone.
  }
  try {
    child.kill();
  } catch {
    // The cleanup helper may already be gone.
  }
}

/** Runs the OCI control-plane cleanup command without a shell and with a bounded wait. */
export const runOciRuntimeCommand: OciRuntimeCommandRunner = async (invocation) => {
  return await new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        env: buildSandboxRuntimeEnvironment(),
      });
    } catch {
      resolve({ success: false });
      return;
    }

    let settled = false;
    const finish = (result: { success: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      terminateRuntimeChild(child);
      finish({ success: false });
    }, OCI_CLEANUP_TIMEOUT_MS);

    child.once("error", () => finish({ success: false }));
    child.once("close", (code) => finish({ success: code === 0 }));
  });
};

/**
 * Reconciles a generated container name after a Gateway restart. The input is validated
 * before reaching a local OCI CLI, so persisted state cannot become a host command channel.
 */
export async function cleanupPersistedOciSandboxLease(input: {
  lease: PersistedOciSandboxLease;
  runRuntimeCommand?: OciRuntimeCommandRunner;
}): Promise<boolean> {
  if (!OCI_CONTAINER_NAME_PATTERN.test(input.lease.containerName)) {
    return false;
  }
  const result = await (input.runRuntimeCommand ?? runOciRuntimeCommand)({
    executable: input.lease.runtime,
    args: ["rm", "--force", input.lease.containerName],
    cwd: process.cwd(),
  });
  return result.success;
}

class ManagedOciSandboxLease implements OciSandboxLease {
  readonly binding: OciSandboxLeaseBinding;

  private runtimeStarted = false;
  private containerId: string | undefined;
  private releasePromise: Promise<OciSandboxLeaseRelease> | undefined;
  private artifactCleanupPromise: Promise<void> | undefined;

  constructor(
    private readonly config: OciCommandSandboxConfig,
    private readonly artifactDirectory: string,
    private readonly runRuntimeCommand: OciRuntimeCommandRunner,
  ) {
    const leaseId = randomUUID();
    this.binding = {
      leaseId,
      containerName: `belldandy-command-${leaseId.replaceAll("-", "")}`,
      cidFile: path.join(artifactDirectory, "container.cid"),
    };
  }

  markRuntimeStarted(): void {
    this.runtimeStarted = true;
  }

  async release(): Promise<OciSandboxLeaseRelease> {
    if (!this.releasePromise) {
      this.releasePromise = this.releaseInternal();
    }
    return await this.releasePromise;
  }

  cleanupArtifacts(): Promise<void> {
    if (!this.artifactCleanupPromise) {
      this.artifactCleanupPromise = rm(this.artifactDirectory, { recursive: true, force: true });
    }
    return this.artifactCleanupPromise;
  }

  metadata(release?: OciSandboxLeaseRelease): Record<string, string> {
    const containerId = release?.containerId ?? this.containerId;
    return {
      commandSandboxLeaseId: this.binding.leaseId,
      commandSandboxContainerName: this.binding.containerName,
      ...(containerId ? { commandSandboxContainerId: containerId } : {}),
      ...(release ? { commandSandboxLeaseCleanupStatus: release.status } : {}),
    };
  }

  private async releaseInternal(): Promise<OciSandboxLeaseRelease> {
    if (!this.runtimeStarted) {
      return { status: "not_started" };
    }

    const containerId = await this.readContainerId();
    const target = containerId ?? this.binding.containerName;
    const result = await this.runRuntimeCommand({
      executable: this.config.runtime,
      args: ["rm", "--force", target],
      cwd: process.cwd(),
    });
    return result.success
      ? { status: "removed", ...(containerId ? { containerId } : {}) }
      : { status: "cleanup_failed", ...(containerId ? { containerId } : {}) };
  }

  private async readContainerId(): Promise<string | undefined> {
    if (this.containerId) return this.containerId;
    try {
      const value = (await readFile(this.binding.cidFile, "utf8")).trim();
      if (OCI_CONTAINER_ID_PATTERN.test(value)) {
        this.containerId = value;
      }
    } catch {
      // The runtime has not yet created the cidfile, so cleanup falls back to its generated name.
    }
    return this.containerId;
  }
}

/**
 * Creates artifacts outside the mounted workspace. The caller owns both explicit
 * container removal and artifact cleanup on every terminal execution path.
 */
export async function createOciSandboxLease(input: {
  config: OciCommandSandboxConfig;
  runRuntimeCommand?: OciRuntimeCommandRunner;
}): Promise<OciSandboxLease> {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), "belldandy-command-sandbox-lease-"));
  return new ManagedOciSandboxLease(
    input.config,
    artifactDirectory,
    input.runRuntimeCommand ?? runOciRuntimeCommand,
  );
}
