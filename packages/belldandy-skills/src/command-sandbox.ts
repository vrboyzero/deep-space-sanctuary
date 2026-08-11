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

export type OciSandboxResourceLimits = {
  memoryBytes?: number;
  cpus?: number;
  pidsLimit?: number;
  tmpfsBytes?: number;
};

export type OciSandboxReadOnlyMount = {
  source: string;
  target: string;
};

/** Stable, generated identifiers owned by one sandbox execution lease. */
export type OciSandboxLeaseBinding = {
  leaseId: string;
  containerName: string;
  cidFile: string;
};

export function resolveOciSandboxContainerUser(input: {
  platform: NodeJS.Platform;
  getUid?: () => number;
  getGid?: () => number;
}): string | undefined {
  if (input.platform === "win32") return undefined;

  const uid = input.getUid?.();
  const gid = input.getGid?.();
  if (
    typeof uid !== "number"
    || !Number.isSafeInteger(uid)
    || uid < 0
    || typeof gid !== "number"
    || !Number.isSafeInteger(gid)
    || gid < 0
  ) {
    return undefined;
  }

  return `${uid}:${gid}`;
}

function resolveCurrentOciSandboxContainerUser(): string | undefined {
  const getUid = process.getuid;
  const getGid = process.getgid;
  return resolveOciSandboxContainerUser({
    platform: process.platform,
    getUid: typeof getUid === "function" ? getUid : undefined,
    getGid: typeof getGid === "function" ? getGid : undefined,
  });
}

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

function resolveContainerMountTarget(value: string, label: string): string {
  if (value.length > 4_096
    || !path.posix.isAbsolute(value)
    || value === "/"
    || value.includes("\u0000")
    || value.includes(",")
    || value.includes("\\")
    || path.posix.normalize(value) !== value) {
    throw new Error(`${label} must be a normalized absolute POSIX path.`);
  }
  return value;
}

function resolveContainerWorkspaceRoot(value: string | undefined): string {
  return resolveContainerMountTarget(
    value ?? "/workspace",
    "Sandbox container workspace root",
  );
}

function resolveTrustedReadOnlyMounts(
  mounts: OciSandboxReadOnlyMount[] | undefined,
  containerWorkspaceRoot: string,
): OciSandboxReadOnlyMount[] {
  if (!mounts) return [];
  if (mounts.length > 8) {
    throw new Error("Sandbox trusted read-only mounts exceed the supported limit.");
  }
  const sources = new Set<string>();
  const targets = new Set<string>([containerWorkspaceRoot]);
  return mounts.map((mount) => {
    const source = path.resolve(mount.source);
    assertMountPath(source, "Sandbox trusted read-only mount source");
    const target = resolveContainerMountTarget(
      mount.target,
      "Sandbox trusted read-only mount target",
    );
    const sourceKey = process.platform === "win32" ? source.toLowerCase() : source;
    if (sources.has(sourceKey) || targets.has(target)) {
      throw new Error("Sandbox trusted read-only mounts must use unique sources and targets.");
    }
    sources.add(sourceKey);
    targets.add(target);
    return { source, target };
  });
}

function resolveContainerCwd(
  workspaceRoot: string,
  cwd: string,
  containerWorkspaceRoot: string,
): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const normalizedCwd = path.resolve(cwd);
  const relative = path.relative(normalizedRoot, normalizedCwd);
  if (relative === "") return containerWorkspaceRoot;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Sandbox cwd escapes the selected workspace root.");
  }
  return path.posix.join(containerWorkspaceRoot, ...relative.split(path.sep));
}

/**
 * Builds argv for a local OCI CLI. `--entrypoint` and argument-array spawning ensure
 * no host or container shell interprets model-supplied command text.
 */
export function buildOciSandboxInvocation(input: {
  config: OciCommandSandboxConfig;
  workspaceRoot: string;
  containerWorkspaceRoot?: string;
  cwd: string;
  plan: CommandPlan;
  lease: OciSandboxLeaseBinding;
  environmentFile?: string;
  resourceLimits?: OciSandboxResourceLimits;
  trustedReadOnlyMounts?: OciSandboxReadOnlyMount[];
}): OciSandboxInvocation {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  assertMountPath(workspaceRoot, "Sandbox workspace root");
  const containerWorkspaceRoot = resolveContainerWorkspaceRoot(input.containerWorkspaceRoot);
  const trustedReadOnlyMounts = resolveTrustedReadOnlyMounts(
    input.trustedReadOnlyMounts,
    containerWorkspaceRoot,
  );
  assertOciSandboxLeaseBinding(input.lease);
  const resourceLimits = resolveOciSandboxResourceLimits(input.resourceLimits);
  const containerUser = resolveCurrentOciSandboxContainerUser();
  const mount = [
    "type=bind",
    `src=${workspaceRoot}`,
    `dst=${containerWorkspaceRoot}`,
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
    String(resourceLimits.pidsLimit),
    "--memory",
    formatDockerBytes(resourceLimits.memoryBytes),
    "--cpus",
    String(resourceLimits.cpus),
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,noexec,size=${formatDockerBytes(resourceLimits.tmpfsBytes)}`,
    "--mount",
    mount,
    ...trustedReadOnlyMounts.flatMap((trustedMount) => [
      "--mount",
      [
        "type=bind",
        `src=${trustedMount.source}`,
        `dst=${trustedMount.target}`,
        "readonly",
      ].join(","),
    ]),
    "--workdir",
    resolveContainerCwd(workspaceRoot, input.cwd, containerWorkspaceRoot),
    // Keep Unix bind-mount writes scoped to the identity that owns the selected workspace.
    ...(containerUser ? ["--user", containerUser] : []),
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

function resolveOciSandboxResourceLimits(
  input: OciSandboxResourceLimits | undefined,
): Required<OciSandboxResourceLimits> {
  const limits = {
    memoryBytes: input?.memoryBytes ?? 1024 * 1024 * 1024,
    cpus: input?.cpus ?? 2,
    pidsLimit: input?.pidsLimit ?? 256,
    tmpfsBytes: input?.tmpfsBytes ?? 64 * 1024 * 1024,
  };
  const mebibyte = 1024 * 1024;
  if (!Number.isSafeInteger(limits.memoryBytes)
    || limits.memoryBytes < 16 * mebibyte
    || !Number.isInteger(limits.memoryBytes / mebibyte)) {
    throw new Error("Sandbox memory limit must be a safe integer in whole MiB of at least 16 MiB.");
  }
  if (!Number.isFinite(limits.cpus) || limits.cpus <= 0 || limits.cpus > 64) {
    throw new Error("Sandbox CPU limit must be greater than 0 and at most 64.");
  }
  if (!Number.isSafeInteger(limits.pidsLimit) || limits.pidsLimit < 1 || limits.pidsLimit > 32768) {
    throw new Error("Sandbox PID limit must be an integer between 1 and 32768.");
  }
  if (!Number.isSafeInteger(limits.tmpfsBytes)
    || limits.tmpfsBytes < mebibyte
    || !Number.isInteger(limits.tmpfsBytes / mebibyte)) {
    throw new Error("Sandbox tmpfs limit must be a safe integer in whole MiB of at least 1 MiB.");
  }
  return limits;
}

function formatDockerBytes(bytes: number): string {
  const mebibyte = 1024 * 1024;
  return `${bytes / mebibyte}m`;
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
