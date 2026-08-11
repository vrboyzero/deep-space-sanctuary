import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildOciSandboxInvocation,
  createOciSandboxEnvironmentFile,
  evaluateCommandSandboxAdmission,
  resolveOciSandboxContainerUser,
  type OciSandboxLeaseBinding,
  type OciCommandSandboxConfig,
} from "./command-sandbox.js";

const ociConfig: OciCommandSandboxConfig = {
  backend: "oci",
  runtime: "docker",
  image: "ghcr.io/example/command-sandbox@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const sandboxLease: OciSandboxLeaseBinding = {
  leaseId: "1f99f6f4-6d6e-4bdf-9d3d-56e4b305ef4c",
  containerName: "belldandy-command-1f99f6f46d6e4bdf9d3d56e4b305ef4c",
  cidFile: path.join(process.cwd(), ".tmp-command-sandbox-container-id"),
};

describe("evaluateCommandSandboxAdmission", () => {
  it("fails closed for command execution when a coding run requires an unavailable sandbox", async () => {
    await expect(evaluateCommandSandboxAdmission({
      family: "command-exec",
      launchSpec: { commandSandbox: "required" },
      readEnv: () => undefined,
    })).resolves.toMatchObject({
      allowed: false,
      code: "sandbox_unavailable",
      metadata: {
        commandSandboxRequirement: "required",
        commandSandboxStatus: "unavailable",
        commandSandboxPlatform: process.platform,
      },
    });
  });

  it("does not affect non-command tool families", async () => {
    await expect(evaluateCommandSandboxAdmission({
      family: "workspace-read",
      launchSpec: { commandSandbox: "required" },
    })).resolves.toEqual({ allowed: true });
  });

  it("admits a reachable configured OCI backend before a command permission request", async () => {
    await expect(evaluateCommandSandboxAdmission({
      family: "command-exec",
      launchSpec: { commandSandbox: "required" },
      readEnv: (name) => ({
        BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
        BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
        BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: ociConfig.image,
      })[name],
      probeOciRuntime: async () => ({ available: true }),
    })).resolves.toMatchObject({
      allowed: true,
      sandbox: ociConfig,
    });
  });

  it("fails closed when the configured OCI image is not digest-pinned", async () => {
    await expect(evaluateCommandSandboxAdmission({
      family: "command-exec",
      launchSpec: { commandSandbox: "required" },
      readEnv: (name) => ({
        BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
        BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: "node:22-bookworm-slim",
      })[name],
    })).resolves.toMatchObject({
      allowed: false,
      metadata: { commandSandboxReason: "invalid_configuration" },
    });
  });
});

describe("resolveOciSandboxContainerUser", () => {
  it("uses the invoking Unix user's numeric identity and disables the projection on Windows", () => {
    expect(resolveOciSandboxContainerUser({
      platform: "linux",
      getUid: () => 1000,
      getGid: () => 1000,
    })).toBe("1000:1000");
    expect(resolveOciSandboxContainerUser({
      platform: "win32",
      getUid: () => {
        throw new Error("must not read Windows uid");
      },
      getGid: () => {
        throw new Error("must not read Windows gid");
      },
    })).toBeUndefined();
  });

  it("fails closed when a Unix identity is unavailable or invalid", () => {
    expect(resolveOciSandboxContainerUser({
      platform: "linux",
      getUid: () => -1,
      getGid: () => 1000,
    })).toBeUndefined();
    expect(resolveOciSandboxContainerUser({
      platform: "linux",
      getUid: () => 1000,
    })).toBeUndefined();
  });
});

describe("buildOciSandboxInvocation", () => {
  it("uses a no-shell OCI invocation with isolated network, scoped mount, and no image pull", () => {
    const workspaceRoot = path.join(process.cwd(), ".tmp-command-sandbox-workspace");
    const cwd = path.join(workspaceRoot, "packages", "core");
    const invocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      cwd,
      lease: sandboxLease,
      plan: {
        executable: "node",
        argv: ["--version"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    });

    expect(invocation).toMatchObject({ executable: "docker", cwd: workspaceRoot });
    expect(invocation.args).toEqual(expect.arrayContaining([
      "run",
      "--pull=never",
      "--name",
      sandboxLease.containerName,
      "--cidfile",
      sandboxLease.cidFile,
      "--label",
      `com.star-sanctuary.command-sandbox.lease=${sandboxLease.leaseId}`,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--entrypoint",
      "node",
      ociConfig.image,
      "--version",
    ]));
    expect(invocation.args.find((value) => value.startsWith("type=bind,"))).toContain("dst=/workspace,readonly");
    expect(invocation.args).not.toContain("--rm");
    expect(invocation.args).not.toContain("sh");
    if (process.platform === "win32") {
      expect(invocation.args).not.toContain("--user");
    } else {
      expect(invocation.args).toEqual(expect.arrayContaining([
        "--user",
        `${process.getuid()}:${process.getgid()}`,
      ]));
    }
  });

  it("limits a writable plan to the selected workspace bind mount", () => {
    const workspaceRoot = path.join(process.cwd(), ".tmp-command-sandbox-writable-workspace");
    const invocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      cwd: workspaceRoot,
      lease: sandboxLease,
      plan: {
        executable: "node",
        argv: ["--version"],
        env: {},
        network: "none",
        writeScope: "workspace-readwrite",
        stdinMode: "closed",
      },
    });

    const mounts = invocation.args.filter((value) => value.startsWith("type=bind,"));
    expect(mounts).toEqual([`type=bind,src=${path.resolve(workspaceRoot)},dst=/workspace`]);
    expect(invocation.args).toContain("--read-only");
    expect(invocation.args).not.toContain("--volume");
  });

  it("can preserve a trusted absolute workspace path inside a Linux container", () => {
    const workspaceRoot = path.join(process.cwd(), ".tmp-command-sandbox-same-path-root");
    const cwd = path.join(workspaceRoot, "fixtures", "go-canary");
    const containerWorkspaceRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const invocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      containerWorkspaceRoot,
      cwd,
      lease: sandboxLease,
      plan: {
        executable: "/var/tmp/star-sanctuary-go-sandbox/toolchain/gopls",
        argv: ["serve"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pipe",
      },
    });

    expect(invocation.args.find((value) => value.startsWith("type=bind,"))).toBe(
      `type=bind,src=${path.resolve(workspaceRoot)},dst=${containerWorkspaceRoot},readonly`,
    );
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--workdir",
      `${containerWorkspaceRoot}/fixtures/go-canary`,
    ]));
  });

  it("mounts pinned toolchain artifacts through explicit read-only binds", () => {
    const workspaceRoot = path.join(process.cwd(), ".tmp-command-sandbox-toolchain-workspace");
    const goRoot = path.join(process.cwd(), ".tmp-command-sandbox-go");
    const goplsRoot = path.join(process.cwd(), ".tmp-command-sandbox-gopls");
    const invocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      cwd: workspaceRoot,
      lease: sandboxLease,
      trustedReadOnlyMounts: [
        { source: goRoot, target: "/opt/star-sanctuary/go" },
        { source: goplsRoot, target: "/opt/star-sanctuary/gopls" },
      ],
      plan: {
        executable: "/opt/star-sanctuary/gopls/bin/gopls",
        argv: ["serve"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pipe",
      },
    });

    expect(invocation.args.filter((value) => value.startsWith("type=bind,"))).toEqual([
      `type=bind,src=${path.resolve(workspaceRoot)},dst=/workspace,readonly`,
      `type=bind,src=${path.resolve(goRoot)},dst=/opt/star-sanctuary/go,readonly`,
      `type=bind,src=${path.resolve(goplsRoot)},dst=/opt/star-sanctuary/gopls,readonly`,
    ]);
  });

  it("opens stdin only for a sandbox job and allocates a TTY only when explicitly requested", () => {
    const workspaceRoot = path.join(process.cwd(), ".tmp-command-sandbox-pty-workspace");
    const pipeInvocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      cwd: workspaceRoot,
      lease: sandboxLease,
      plan: {
        executable: "node",
        argv: ["--version"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pipe",
      },
    });
    const ptyInvocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      cwd: workspaceRoot,
      lease: sandboxLease,
      plan: {
        executable: "node",
        argv: ["--version"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pty",
      },
    });

    expect(pipeInvocation.args).toContain("--interactive");
    expect(pipeInvocation.args).not.toContain("--tty");
    expect(ptyInvocation.args).toEqual(expect.arrayContaining(["--interactive", "--tty"]));
  });

  it("accepts explicit bounded resource limits without changing the mount or network contract", () => {
    const workspaceRoot = path.join(process.cwd(), ".tmp-command-sandbox-resource-workspace");
    const invocation = buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot,
      cwd: workspaceRoot,
      lease: sandboxLease,
      resourceLimits: {
        memoryBytes: 128 * 1024 * 1024,
        cpus: 1,
        pidsLimit: 64,
        tmpfsBytes: 16 * 1024 * 1024,
      },
      plan: {
        executable: "node",
        argv: ["--version"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    });

    expect(invocation.args).toEqual(expect.arrayContaining([
      "--pids-limit", "64",
      "--memory", "128m",
      "--cpus", "1",
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
      "--network", "none",
      "--read-only",
    ]));
  });

  it("rejects resource limits outside the bounded OCI contract", () => {
    expect(() => buildOciSandboxInvocation({
      config: ociConfig,
      workspaceRoot: process.cwd(),
      cwd: process.cwd(),
      lease: sandboxLease,
      resourceLimits: { memoryBytes: 8 * 1024 * 1024 },
      plan: {
        executable: "node",
        argv: ["--version"],
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "closed",
      },
    })).toThrow(/memory limit/u);
  });

  it("writes command environment values outside argv and removes the temporary file", async () => {
    const environmentFile = await createOciSandboxEnvironmentFile({ PRIVATE_TOKEN: "opaque-value" });
    if (!environmentFile.path) throw new Error("expected temporary environment file");

    await expect(readFile(environmentFile.path, "utf8")).resolves.toBe("PRIVATE_TOKEN=opaque-value");
    await environmentFile.cleanup();
    await expect(readFile(environmentFile.path, "utf8")).rejects.toThrow();
  });
});
