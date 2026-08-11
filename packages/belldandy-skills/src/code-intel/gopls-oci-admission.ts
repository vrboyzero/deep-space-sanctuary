import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import {
  buildSandboxRuntimeEnvironment,
  probeOciCommandSandboxRuntime,
  type OciCommandSandboxConfig,
  type OciRuntimeProbe,
  type OciRuntimeProbeResult,
} from "../command-sandbox.js";
import {
  GOPLS_OCI_SANDBOX_CONTRACT_VERSION,
  GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
  createGoplsOciSandboxHost,
  validateGoplsOciSandboxHostOptions,
  type CreateGoplsOciSandboxHostOptions,
  type GoplsOciSandboxHost,
} from "./gopls-oci-host.js";
import {
  GoplsCodeIntelProvider,
  type GoplsCodeIntelProviderOptions,
} from "./gopls-provider.js";
import {
  PINNED_GOPLS_VERSION,
  probeGoplsToolchain,
  type GoplsProcessProfile,
  type GoplsToolchainProbe,
  type ProbeGoplsToolchainOptions,
} from "./gopls-profile.js";

export const GOPLS_OCI_ADMISSION_CONTRACT_VERSION = "gopls-oci-admission/v1" as const;

const OCI_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?@sha256:[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OCI_PROBE_TIMEOUT_MS = 3_000;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const GOPLS_SHUTDOWN_TIMEOUT_MS = 5_000;

export type GoplsOciAdmissionErrorCode =
  | "platform_unsupported"
  | "sandbox_config_invalid"
  | "profile_incompatible"
  | "runtime_unavailable"
  | "image_unavailable"
  | "toolchain_incompatible"
  | "artifact_invalid"
  | "artifact_hash_mismatch";

export class GoplsOciAdmissionError extends Error {
  readonly code: GoplsOciAdmissionErrorCode;

  constructor(code: GoplsOciAdmissionErrorCode, message: string) {
    super(message);
    this.name = "GoplsOciAdmissionError";
    this.code = code;
  }
}

export interface GoplsOciGoArtifactIdentity {
  artifactRoot: string;
  command: string;
  version: string;
  platform: string;
  sha256: string;
}

export interface GoplsOciGoplsArtifactIdentity {
  artifactRoot: string;
  command: string;
  version: typeof PINNED_GOPLS_VERSION;
  sha256: string;
}

export interface CreateGoplsOciCanaryProviderOptions {
  config: OciCommandSandboxConfig;
  profile: GoplsProcessProfile;
  sandboxRoot: string;
  artifacts: {
    go: GoplsOciGoArtifactIdentity;
    gopls: GoplsOciGoplsArtifactIdentity;
  };
  readFile?: GoplsCodeIntelProviderOptions["readFile"];
}

export interface GoplsOciAdmission {
  contractVersion: typeof GOPLS_OCI_ADMISSION_CONTRACT_VERSION;
  status: "passed";
  platform: "linux";
  sandbox: {
    contractVersion: typeof GOPLS_OCI_SANDBOX_CONTRACT_VERSION;
    backend: "oci";
    runtime: "docker" | "podman";
    image: string;
    pullPolicy: "never";
    resourceLimits: typeof GOPLS_OCI_SANDBOX_RESOURCE_LIMITS;
  };
  artifacts: {
    go: GoplsOciGoArtifactIdentity;
    gopls: GoplsOciGoplsArtifactIdentity;
  };
}

export interface GoplsOciAdmissionDependencies {
  platform?: NodeJS.Platform;
  probeRuntime?: OciRuntimeProbe;
  probeLocalImage?: (config: OciCommandSandboxConfig) => Promise<OciRuntimeProbeResult>;
  probeToolchain?: (options: ProbeGoplsToolchainOptions) => Promise<GoplsToolchainProbe>;
  inspectArtifact?: (input: { artifactRoot: string; command: string }) => Promise<{ sha256: string }>;
  createHost?: (options: CreateGoplsOciSandboxHostOptions) => Promise<GoplsOciSandboxHost>;
}

export interface GoplsOciCanaryProviderResult {
  admission: GoplsOciAdmission;
  provider: GoplsCodeIntelProvider;
}

export async function admitGoplsOciCanary(
  options: CreateGoplsOciCanaryProviderOptions,
  dependencies: GoplsOciAdmissionDependencies = {},
): Promise<GoplsOciAdmission> {
  const platform = dependencies.platform ?? process.platform;
  validateAdmissionOptions(options, platform);

  const inspectArtifact = dependencies.inspectArtifact ?? inspectLocalArtifact;
  const actualGo = await inspectArtifact(options.artifacts.go);
  assertArtifactHash("Go", options.artifacts.go.sha256, actualGo.sha256);
  const actualGopls = await inspectArtifact(options.artifacts.gopls);
  assertArtifactHash("gopls", options.artifacts.gopls.sha256, actualGopls.sha256);

  const runtime = await (dependencies.probeRuntime ?? probeOciCommandSandboxRuntime)(options.config);
  if (!runtime.available) {
    throw new GoplsOciAdmissionError(
      "runtime_unavailable",
      "gopls OCI admission requires a reachable local OCI runtime.",
    );
  }

  const image = await (dependencies.probeLocalImage ?? probeLocalOciImage)(options.config);
  if (!image.available) {
    throw new GoplsOciAdmissionError(
      "image_unavailable",
      "gopls OCI admission requires the digest-pinned image to exist locally.",
    );
  }

  const probe = await (dependencies.probeToolchain ?? probeGoplsToolchain)({
    goplsCommand: options.artifacts.gopls.command,
    goCommand: options.artifacts.go.command,
    environment: {},
  });
  if (probe.status !== "available"
    || probe.gopls.version !== options.artifacts.gopls.version
    || probe.go.version !== options.artifacts.go.version
    || probe.go.platform !== options.artifacts.go.platform) {
    throw new GoplsOciAdmissionError(
      "toolchain_incompatible",
      "gopls OCI admission rejected an incompatible pinned toolchain.",
    );
  }

  return {
    contractVersion: GOPLS_OCI_ADMISSION_CONTRACT_VERSION,
    status: "passed",
    platform: "linux",
    sandbox: {
      contractVersion: GOPLS_OCI_SANDBOX_CONTRACT_VERSION,
      backend: "oci",
      runtime: options.config.runtime,
      image: options.config.image,
      pullPolicy: "never",
      resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
    },
    artifacts: {
      go: { ...options.artifacts.go },
      gopls: { ...options.artifacts.gopls },
    },
  };
}

export async function createGoplsOciCanaryProvider(
  options: CreateGoplsOciCanaryProviderOptions,
  dependencies: GoplsOciAdmissionDependencies = {},
): Promise<GoplsOciCanaryProviderResult> {
  const admission = await admitGoplsOciCanary(options, dependencies);
  const createHost = dependencies.createHost ?? createGoplsOciSandboxHost;
  const provider = new GoplsCodeIntelProvider({
    profile: options.profile,
    ...(options.readFile ? { readFile: options.readFile } : {}),
    hostFactory: async (input) => await createHost({
      config: options.config,
      profile: input.profile,
      sandboxRoot: options.sandboxRoot,
      workspaceRoot: input.workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: admission.artifacts.go.artifactRoot, target: admission.artifacts.go.artifactRoot },
        { source: admission.artifacts.gopls.artifactRoot, target: admission.artifacts.gopls.artifactRoot },
      ],
      responseMaxBytes: input.responseMaxBytes,
      shutdownTimeoutMs: input.shutdownTimeoutMs,
    }),
  });
  return { admission, provider };
}

function validateAdmissionOptions(
  options: CreateGoplsOciCanaryProviderOptions,
  platform: NodeJS.Platform,
): void {
  if (platform !== "linux") {
    throw new GoplsOciAdmissionError(
      "platform_unsupported",
      "gopls OCI admission requires native Linux execution.",
    );
  }
  if (options.config.backend !== "oci"
    || (options.config.runtime !== "docker" && options.config.runtime !== "podman")
    || !OCI_IMAGE_PATTERN.test(options.config.image)) {
    throw new GoplsOciAdmissionError(
      "sandbox_config_invalid",
      "gopls OCI admission requires a digest-pinned OCI sandbox configuration.",
    );
  }
  if (options.profile.profile.id !== "gopls"
    || options.profile.profile.version !== PINNED_GOPLS_VERSION
    || options.profile.profile.command !== options.artifacts.gopls.command
    || options.profile.toolchain.goCommand !== options.artifacts.go.command
    || options.profile.toolchain.goVersion !== options.artifacts.go.version
    || options.profile.toolchain.platform !== options.artifacts.go.platform
    || options.artifacts.gopls.version !== PINNED_GOPLS_VERSION
    || !options.artifacts.go.platform.startsWith("linux/")
    || !SHA256_PATTERN.test(options.artifacts.go.sha256)
    || !SHA256_PATTERN.test(options.artifacts.gopls.sha256)) {
    throw new GoplsOciAdmissionError(
      "profile_incompatible",
      "gopls OCI admission profile and artifact identities do not match.",
    );
  }
  try {
    validateGoplsOciSandboxHostOptions({
      config: options.config,
      profile: options.profile.profile,
      sandboxRoot: options.sandboxRoot,
      workspaceRoot: options.profile.workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: options.artifacts.go.artifactRoot, target: options.artifacts.go.artifactRoot },
        { source: options.artifacts.gopls.artifactRoot, target: options.artifacts.gopls.artifactRoot },
      ],
      responseMaxBytes: options.profile.resourceLimits.decodedResponseMaxBytes,
      shutdownTimeoutMs: GOPLS_SHUTDOWN_TIMEOUT_MS,
    }, platform);
  } catch {
    throw new GoplsOciAdmissionError(
      "profile_incompatible",
      "gopls OCI admission rejected a profile outside the fixed sandbox contract.",
    );
  }
}

async function inspectLocalArtifact(input: {
  artifactRoot: string;
  command: string;
}): Promise<{ sha256: string }> {
  try {
    const [rootStat, commandStat, resolvedRoot, resolvedCommand] = await Promise.all([
      lstat(input.artifactRoot),
      lstat(input.command),
      realpath(input.artifactRoot),
      realpath(input.command),
      access(input.command, fsConstants.R_OK | fsConstants.X_OK),
    ]);
    if (!rootStat.isDirectory()
      || !commandStat.isFile()
      || commandStat.size < 1
      || commandStat.size > MAX_ARTIFACT_BYTES
      || resolvedRoot !== input.artifactRoot
      || resolvedCommand !== input.command
      || !isPosixPathInside(resolvedRoot, resolvedCommand)) {
      throw new Error("invalid artifact");
    }
    const content = await readFile(input.command);
    return { sha256: createHash("sha256").update(content).digest("hex") };
  } catch {
    throw new GoplsOciAdmissionError(
      "artifact_invalid",
      "gopls OCI admission could not verify a regular executable artifact.",
    );
  }
}

function assertArtifactHash(label: string, expected: string, actual: string): void {
  if (!SHA256_PATTERN.test(actual) || actual !== expected) {
    throw new GoplsOciAdmissionError(
      "artifact_hash_mismatch",
      `${label} artifact SHA-256 does not match its pinned identity.`,
    );
  }
}

/** Probes only local image metadata; it never starts a container or pulls an image. */
export async function probeLocalOciImage(
  config: OciCommandSandboxConfig,
): Promise<OciRuntimeProbeResult> {
  return await probeOciCli(config.runtime, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    config.image,
  ]);
}

function probeOciCli(
  executable: "docker" | "podman",
  args: string[],
): Promise<OciRuntimeProbeResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
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
    }, OCI_PROBE_TIMEOUT_MS);
    child.once("error", () => finish({ available: false }));
    child.once("close", (code) => finish({ available: code === 0 }));
  });
}

function isPosixPathInside(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith("../") && relative !== ".." && !path.posix.isAbsolute(relative));
}
