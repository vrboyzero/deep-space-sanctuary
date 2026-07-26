import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ToolContractFamily } from "./tool-contract.js";
import type { ToolRuntimeLaunchSpec } from "./types.js";
import type { CommandPlan } from "./command-plan.js";

const SANDBOX_PROBE_TIMEOUT_MS = 3_000;
const OCI_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?@sha256:[a-f0-9]{64}$/;

export type CommandSandboxRequirement = "required";

export type OciCommandSandboxConfig = {
  backend: "oci";
  runtime: "docker" | "podman";
  image: string;
};

export type OciRuntimeProbeResult = {
  available: boolean;
};

export type OciRuntimeProbe = (config: OciCommandSandboxConfig) => Promise<OciRuntimeProbeResult>;

type CommandSandboxUnavailableReason = "not_configured" | "invalid_configuration" | "runtime_unavailable";

export type CommandSandboxAdmission =
  | { allowed: true; sandbox?: OciCommandSandboxConfig }
  | {
    allowed: false;
    code: "sandbox_unavailable";
    message: string;
    metadata: {
      commandSandboxRequirement: CommandSandboxRequirement;
      commandSandboxStatus: "unavailable";
      commandSandboxPlatform: NodeJS.Platform;
      commandSandboxReason: CommandSandboxUnavailableReason;
    };
  };

export type OciSandboxInvocation = {
  executable: "docker" | "podman";
  args: string[];
  cwd: string;
};

/** Stable, generated identifiers owned by one sandbox execution lease. */
export type OciSandboxLeaseBinding = {
  leaseId: string;
  containerName: string;
  cidFile: string;
};

const SANDBOX_UNAVAILABLE_MESSAGE =
  "Command execution is unavailable because this coding run requires an OS sandbox, but no usable sandbox backend is configured.";

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function unavailable(reason: CommandSandboxUnavailableReason): CommandSandboxAdmission {
  return {
    allowed: false,
    code: "sandbox_unavailable",
    message: SANDBOX_UNAVAILABLE_MESSAGE,
    metadata: {
      commandSandboxRequirement: "required",
      commandSandboxStatus: "unavailable",
      commandSandboxPlatform: process.platform,
      commandSandboxReason: reason,
    },
  };
}

export function normalizeCommandSandboxRequirement(value: unknown): CommandSandboxRequirement | undefined {
  return value === "required" ? value : undefined;
}

export function resolveOciCommandSandboxConfig(input: {
  readEnv?: (name: string) => string | undefined;
}): OciCommandSandboxConfig | undefined {
  const readEnv = input.readEnv ?? ((name: string) => process.env[name]);
  if (normalizeOptionalString(readEnv("BELLDANDY_COMMAND_SANDBOX_BACKEND")) !== "oci") {
    return undefined;
  }

  const runtime = normalizeOptionalString(readEnv("BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME")) ?? "docker";
  if (runtime !== "docker" && runtime !== "podman") {
    return undefined;
  }

  const image = normalizeOptionalString(readEnv("BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE"));
  if (!image || !OCI_IMAGE_PATTERN.test(image)) {
    return undefined;
  }

  return { backend: "oci", runtime, image };
}

export function buildSandboxRuntimeEnvironment(): NodeJS.ProcessEnv {
  const keys = process.platform === "win32"
    ? ["APPDATA", "HOME", "LOCALAPPDATA", "PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR"]
    : ["HOME", "PATH", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

/** Probes only the local OCI runtime control plane; it never pulls an image or starts a container. */
export async function probeOciCommandSandboxRuntime(config: OciCommandSandboxConfig): Promise<OciRuntimeProbeResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(config.runtime, ["version", "--format", "{{.Server.Version}}"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
        env: buildSandboxRuntimeEnvironment(),
      });
    } catch {
      resolve({ available: false });
      return;
    }

    let settled = false;
    const finish = (result: OciRuntimeProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Probe process may already be gone.
      }
      finish({ available: false });
    }, SANDBOX_PROBE_TIMEOUT_MS);

    child.once("error", () => finish({ available: false }));
    child.once("close", (code) => finish({ available: code === 0 }));
  });
}

/**
 * Coding runs must never fall back from a required sandbox to host execution.
 * The executor invokes this before requesting permission, and run_command repeats it
 * defensively when called outside the executor.
 */
export async function evaluateCommandSandboxAdmission(input: {
  family?: ToolContractFamily;
  launchSpec?: Pick<ToolRuntimeLaunchSpec, "commandSandbox">;
  readEnv?: (name: string) => string | undefined;
  probeOciRuntime?: OciRuntimeProbe;
}): Promise<CommandSandboxAdmission> {
  const requirement = normalizeCommandSandboxRequirement(input.launchSpec?.commandSandbox);
  if (requirement !== "required" || input.family !== "command-exec") {
    return { allowed: true };
  }

  const backendSetting = normalizeOptionalString((input.readEnv ?? ((name) => process.env[name]))("BELLDANDY_COMMAND_SANDBOX_BACKEND"));
  if (!backendSetting) {
    return unavailable("not_configured");
  }
  const config = resolveOciCommandSandboxConfig({ readEnv: input.readEnv });
  if (!config) {
    return unavailable("invalid_configuration");
  }

  const probe = input.probeOciRuntime ?? probeOciCommandSandboxRuntime;
  const runtime = await probe(config);
  if (!runtime.available) {
    return unavailable("runtime_unavailable");
  }

  return { allowed: true, sandbox: config };
}

function assertMountPath(value: string, label: string): void {
  if (!value || value.includes("\u0000") || value.includes(",")) {
    throw new Error(`${label} cannot be represented safely as an OCI bind mount.`);
  }
}

function assertOciSandboxLeaseBinding(value: OciSandboxLeaseBinding): void {
  if (!/^[a-f0-9-]{36}$/i.test(value.leaseId)) {
    throw new Error("Sandbox lease ID is invalid.");
  }
  if (!/^belldandy-command-[a-f0-9]{32}$/i.test(value.containerName)) {
    throw new Error("Sandbox container name is invalid.");
  }
  if (!path.isAbsolute(value.cidFile) || value.cidFile.includes("\u0000")) {
    throw new Error("Sandbox cidfile path is invalid.");
  }
}

function resolveContainerCwd(workspaceRoot: string, cwd: string): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedCwd = path.resolve(cwd);
  const relative = path.relative(normalizedRoot, normalizedCwd);
  if (relative === "") return "/workspace";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Sandbox cwd escapes the selected workspace root.");
  }
  return path.posix.join("/workspace", ...relative.split(path.sep));
}

/**
 * Builds argv for a local OCI CLI. `--entrypoint` and argument-array spawning ensure
 * no host or container shell interprets model-supplied command text.
 */
export function buildOciSandboxInvocation(input: {
  config: OciCommandSandboxConfig;
  workspaceRoot: string;
  cwd: string;
  plan: CommandPlan;
  lease: OciSandboxLeaseBinding;
  environmentFile?: string;
}): OciSandboxInvocation {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  assertMountPath(workspaceRoot, "Sandbox workspace root");
  assertOciSandboxLeaseBinding(input.lease);
  const mount = [
    "type=bind",
    `src=${workspaceRoot}`,
    "dst=/workspace",
    ...(input.plan.writeScope === "workspace-readonly" ? ["readonly"] : []),
  ].join(",");

  const args = [
    "run",
    ...(input.plan.stdinMode !== "closed" ? ["--interactive"] : []),
    ...(input.plan.stdinMode === "pty" ? ["--tty"] : []),
    "--init",
    "--pull=never",
    "--name",
    input.lease.containerName,
    "--cidfile",
    input.lease.cidFile,
    "--label",
    `com.star-sanctuary.command-sandbox.lease=${input.lease.leaseId}`,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "1024m",
    "--cpus",
    "2",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=64m",
    "--mount",
    mount,
    "--workdir",
    resolveContainerCwd(workspaceRoot, input.cwd),
    ...(input.environmentFile ? ["--env-file", input.environmentFile] : []),
    "--entrypoint",
    input.plan.executable,
    input.config.image,
    ...input.plan.argv,
  ];

  return {
    executable: input.config.runtime,
    args,
    cwd: workspaceRoot,
  };
}

/**
 * Docker/Podman receive command env through a short-lived file rather than host argv.
 * The file is outside the workspace and is removed on both normal and failed execution paths.
 */
export async function createOciSandboxEnvironmentFile(env: Record<string, string>): Promise<{
  path?: string;
  cleanup: () => Promise<void>;
}> {
  if (Object.keys(env).length === 0) {
    return { cleanup: async () => {} };
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "belldandy-command-sandbox-"));
  const environmentPath = path.join(directory, "environment");
  try {
    await writeFile(
      environmentPath,
      Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    path: environmentPath,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
