import path from "node:path";
import { accessSync, constants as fsConstants } from "node:fs";

import {
  buildOciSandboxInvocation,
  buildSandboxRuntimeEnvironment,
  createOciSandboxEnvironmentFile,
  type OciCommandSandboxConfig,
  type OciSandboxInvocation,
  type OciSandboxReadOnlyMount,
} from "../command-sandbox.js";
import {
  createOciSandboxLease,
  type OciSandboxLease,
  type OciSandboxLeaseRelease,
} from "../command-sandbox-lease.js";
import type { GoplsCodeIntelHost } from "./gopls-provider.js";
import {
  LspProcessHost,
  type LspProcessHostDiagnostics,
  type LspProcessHostErrorCode,
  type LspProcessHostOptions,
  type LspProcessNotification,
  type LspProcessRequest,
  type LspServerProcessProfile,
} from "./lsp-process-host.js";

export const GOPLS_OCI_SANDBOX_CONTRACT_VERSION = "gopls-oci-sandbox/v1" as const;
const GOPLS_WORKSPACE_READINESS_QUERY = "BuildMessage";
const GOPLS_CROSS_MODULE_READINESS_MAX_ATTEMPTS = 8;
const GOPLS_CROSS_MODULE_READINESS_PROGRESS_SLICE_MS = 500;
const GOPLS_CROSS_MODULE_READINESS_SOURCE = {
  relativePath: "app/main.go",
  line: 7,
  character: 13,
} as const;
const GOPLS_CROSS_MODULE_READINESS_TARGET = "lib/service/api.go";
export const GOPLS_OCI_SANDBOX_RESOURCE_LIMITS = Object.freeze({
  memoryBytes: 128 * 1024 * 1024,
  cpus: 1,
  pidsLimit: 64,
  tmpfsBytes: 16 * 1024 * 1024,
});

export interface CreateGoplsOciSandboxHostOptions {
  config: OciCommandSandboxConfig;
  profile: LspServerProcessProfile;
  sandboxRoot: string;
  workspaceRoot: string;
  toolchainReadOnlyMounts: OciSandboxReadOnlyMount[];
  responseMaxBytes: number;
  shutdownTimeoutMs: number;
}

export interface GoplsOciSandboxDiagnostics {
  contractVersion: typeof GOPLS_OCI_SANDBOX_CONTRACT_VERSION;
  runtimeStarted: boolean;
  leaseCleanupStatus: OciSandboxLeaseRelease["status"] | "pending";
  cleanupErrorCount: number;
  resourceLimits: typeof GOPLS_OCI_SANDBOX_RESOURCE_LIMITS;
}

export interface GoplsOciSandboxHost extends GoplsCodeIntelHost {
  getRuntimeTarget(): { runtime: "docker" | "podman"; containerName: string };
  getSandboxDiagnostics(): GoplsOciSandboxDiagnostics;
  getLspDiagnostics(): LspProcessHostDiagnostics;
}

type GoplsOciSandboxLspHost = GoplsCodeIntelHost & {
  getDiagnostics(): LspProcessHostDiagnostics;
  waitForWorkDoneProgress(deadlineAtMs: number, signal?: AbortSignal): Promise<void>;
  recordTimelineMarker?: (
    kind: "readiness_started" | "readiness_completed" | "readiness_failed",
    errorCode?: LspProcessHostErrorCode,
  ) => void;
};

export interface GoplsOciSandboxHostDependencies {
  platform?: NodeJS.Platform;
  createLease?: typeof createOciSandboxLease;
  createEnvironmentFile?: typeof createOciSandboxEnvironmentFile;
  buildInvocation?: typeof buildOciSandboxInvocation;
  createHost?: (options: LspProcessHostOptions) => GoplsOciSandboxLspHost;
  buildRuntimeEnvironment?: typeof buildSandboxRuntimeEnvironment;
  resolveRuntimeExecutable?: (runtime: "docker" | "podman", environment: NodeJS.ProcessEnv) => string;
}

export async function createGoplsOciSandboxHost(
  options: CreateGoplsOciSandboxHostOptions,
  dependencies: GoplsOciSandboxHostDependencies = {},
): Promise<GoplsOciSandboxHost> {
  validateGoplsOciSandboxHostOptions(options, dependencies.platform ?? process.platform);
  const createEnvironmentFile = dependencies.createEnvironmentFile
    ?? createOciSandboxEnvironmentFile;
  const environmentFile = await createEnvironmentFile(buildContainerEnvironment(options.profile));
  let lease: OciSandboxLease | undefined;
  try {
    lease = await (dependencies.createLease ?? createOciSandboxLease)({ config: options.config });
    const invocation = (dependencies.buildInvocation ?? buildOciSandboxInvocation)({
      config: options.config,
      workspaceRoot: options.sandboxRoot,
      containerWorkspaceRoot: options.sandboxRoot,
      cwd: options.workspaceRoot,
      lease: lease.binding,
      ...(environmentFile.path ? { environmentFile: environmentFile.path } : {}),
      resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
      trustedReadOnlyMounts: options.toolchainReadOnlyMounts,
      plan: {
        executable: options.profile.command,
        argv: [...options.profile.args],
        env: buildContainerEnvironment(options.profile),
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pipe",
      },
    });
    const hostOptions = buildLspHostOptions(
      options,
      invocation,
      (dependencies.buildRuntimeEnvironment ?? buildSandboxRuntimeEnvironment)(),
      dependencies.resolveRuntimeExecutable,
    );
    const host = (dependencies.createHost ?? ((input) => new LspProcessHost(input)))(hostOptions);
    return new ManagedGoplsOciSandboxHost(
      options.config,
      host,
      lease,
      environmentFile.cleanup,
      options.workspaceRoot,
    );
  } catch (error) {
    await releaseProvisioningResources(lease, environmentFile.cleanup);
    throw error;
  }
}

class ManagedGoplsOciSandboxHost implements GoplsOciSandboxHost {
  private runtimeStarted = false;
  private leaseCleanupStatus: GoplsOciSandboxDiagnostics["leaseCleanupStatus"] = "pending";
  private cleanupErrorCount = 0;
  private disposePromise: Promise<void> | undefined;

  constructor(
    private readonly config: OciCommandSandboxConfig,
    private readonly host: GoplsOciSandboxLspHost,
    private readonly lease: OciSandboxLease,
    private readonly cleanupEnvironment: () => Promise<void>,
    private readonly workspaceRoot: string,
  ) {}

  request<Result = unknown>(request: LspProcessRequest): Promise<Result> {
    this.markRuntimeStarted();
    return this.host.request<Result>(request);
  }

  notify(notification: LspProcessNotification): Promise<void> {
    this.markRuntimeStarted();
    return this.host.notify(notification);
  }

  waitForWorkDoneProgress(deadlineAtMs: number, signal?: AbortSignal): Promise<void> {
    return this.host.waitForWorkDoneProgress(deadlineAtMs, signal);
  }

  async waitForWorkspaceReady(deadlineAtMs: number, signal?: AbortSignal): Promise<void> {
    this.markRuntimeStarted();
    this.host.recordTimelineMarker?.("readiness_started");
    try {
      await this.host.request({
        method: "workspace/symbol",
        params: { query: GOPLS_WORKSPACE_READINESS_QUERY },
        deadlineAtMs,
        signal,
      });
      const sourceUri = toPosixFileUri(path.posix.join(
        this.workspaceRoot,
        GOPLS_CROSS_MODULE_READINESS_SOURCE.relativePath,
      ));
      const targetUri = toPosixFileUri(path.posix.join(
        this.workspaceRoot,
        GOPLS_CROSS_MODULE_READINESS_TARGET,
      ));
      let definitionReady = false;
      for (let attempt = 0; attempt < GOPLS_CROSS_MODULE_READINESS_MAX_ATTEMPTS; attempt += 1) {
        await waitForReadinessProgressSlice(this.host, deadlineAtMs, signal);
        const response = await this.host.request<unknown>({
          method: "textDocument/definition",
          params: {
            textDocument: { uri: sourceUri },
            position: {
              line: GOPLS_CROSS_MODULE_READINESS_SOURCE.line,
              character: GOPLS_CROSS_MODULE_READINESS_SOURCE.character,
            },
          },
          deadlineAtMs,
          signal,
        });
        if (hasDefinitionTarget(response, targetUri)) {
          definitionReady = true;
          break;
        }
      }
      if (!definitionReady) {
        throw new Error("gopls OCI cross-module definition readiness probe did not resolve.");
      }
      if (this.host.getDiagnostics().workDoneProgress.activeCount > 0) {
        await this.host.waitForWorkDoneProgress(deadlineAtMs, signal);
      }
      this.host.recordTimelineMarker?.("readiness_completed");
    } catch (error) {
      this.host.recordTimelineMarker?.(
        "readiness_failed",
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code as LspProcessHostErrorCode
          : undefined,
      );
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = this.disposeInternal();
    }
    await this.disposePromise;
  }

  getRuntimeTarget(): { runtime: "docker" | "podman"; containerName: string } {
    return {
      runtime: this.config.runtime,
      containerName: this.lease.binding.containerName,
    };
  }

  getSandboxDiagnostics(): GoplsOciSandboxDiagnostics {
    return {
      contractVersion: GOPLS_OCI_SANDBOX_CONTRACT_VERSION,
      runtimeStarted: this.runtimeStarted,
      leaseCleanupStatus: this.leaseCleanupStatus,
      cleanupErrorCount: this.cleanupErrorCount,
      resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
    };
  }

  getLspDiagnostics(): LspProcessHostDiagnostics {
    return this.host.getDiagnostics();
  }

  private markRuntimeStarted(): void {
    if (this.runtimeStarted) return;
    this.runtimeStarted = true;
    this.lease.markRuntimeStarted();
  }

  private async disposeInternal(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.host.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      const release = await this.lease.release();
      this.leaseCleanupStatus = release.status;
      if (release.status === "cleanup_failed") {
        errors.push(new Error("gopls OCI sandbox lease cleanup failed."));
      }
    } catch (error) {
      this.leaseCleanupStatus = "cleanup_failed";
      errors.push(error);
    }
    try {
      await this.cleanupEnvironment();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.lease.cleanupArtifacts();
    } catch (error) {
      errors.push(error);
    }
    this.cleanupErrorCount = errors.length;
    if (errors.length > 0) {
      throw new Error("gopls OCI sandbox resources did not close cleanly.");
    }
  }
}

function hasDefinitionTarget(response: unknown, targetUri: string): boolean {
  const values = Array.isArray(response) ? response : [response];
  return values.some((value) => (
    isObjectRecord(value)
    && (value.uri === targetUri || value.targetUri === targetUri)
  ));
}

function toPosixFileUri(filePath: string): string {
  return `file://${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function waitForReadinessProgressSlice(
  host: GoplsOciSandboxLspHost,
  deadlineAtMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (host.getDiagnostics().workDoneProgress.activeCount > 0) {
    await host.waitForWorkDoneProgress(deadlineAtMs, signal);
    return;
  }
  const sliceDeadlineAtMs = Math.min(
    deadlineAtMs,
    Date.now() + GOPLS_CROSS_MODULE_READINESS_PROGRESS_SLICE_MS,
  );
  try {
    await host.waitForWorkDoneProgress(sliceDeadlineAtMs, signal);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "timeout") {
      throw error;
    }
  }
  if (host.getDiagnostics().workDoneProgress.activeCount > 0) {
    await host.waitForWorkDoneProgress(deadlineAtMs, signal);
  }
}

export function validateGoplsOciSandboxHostOptions(
  options: CreateGoplsOciSandboxHostOptions,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    throw new Error("gopls OCI same-path Host requires a native Linux process.");
  }
  const sandboxRoot = requireNormalizedAbsolutePosixPath(options.sandboxRoot, "sandbox root");
  const workspaceRoot = requireNormalizedAbsolutePosixPath(options.workspaceRoot, "workspace root");
  const goplsCommand = requireNormalizedAbsolutePosixPath(options.profile.command, "gopls command");
  const goPath = requireNormalizedAbsolutePosixPath(options.profile.environment.PATH, "Go PATH");
  if (!isPosixPathInside(sandboxRoot, workspaceRoot)) {
    throw new Error("gopls OCI workspace must stay inside the sandbox root.");
  }
  const toolchainRoots = validateToolchainReadOnlyMounts(
    options.toolchainReadOnlyMounts,
    sandboxRoot,
  );
  if (!toolchainRoots.some((root) => isPosixPathInside(root, goplsCommand))
    || !toolchainRoots.some((root) => isPosixPathInside(root, goPath))) {
    throw new Error("gopls OCI command and Go PATH must stay inside a declared read-only mount.");
  }
  if (options.profile.workspaceFolders?.some((folder) => (
    !isPosixPathInside(workspaceRoot, requireNormalizedAbsolutePosixPath(folder, "workspace folder"))
  ))) {
    throw new Error("gopls OCI workspace folders must stay inside the workspace root.");
  }
  if (options.profile.environment.GOPROXY !== "off"
    || options.profile.environment.GOSUMDB !== "off"
    || options.profile.environment.GOTOOLCHAIN !== "local"
    || options.profile.environment.GOENV !== "off"
    || options.profile.environment.GOTELEMETRY !== "off"
    || options.profile.environment.GOFLAGS !== "-mod=readonly"
    || options.profile.environment.CGO_ENABLED !== "0") {
    throw new Error("gopls OCI Host requires the pinned offline Go environment.");
  }
}

function validateToolchainReadOnlyMounts(
  mounts: OciSandboxReadOnlyMount[],
  sandboxRoot: string,
): string[] {
  if (mounts.length < 1 || mounts.length > 8) {
    throw new Error("gopls OCI toolchain requires between 1 and 8 read-only mounts.");
  }
  const roots = mounts.map((mount) => {
    const source = requireNormalizedAbsolutePosixPath(mount.source, "toolchain mount source");
    const target = requireNormalizedAbsolutePosixPath(mount.target, "toolchain mount target");
    if (source !== target) {
      throw new Error("gopls OCI toolchain mounts must preserve the same-path contract.");
    }
    if (isPosixPathInside(source, sandboxRoot) || isPosixPathInside(sandboxRoot, source)) {
      throw new Error("gopls OCI toolchain mounts must not overlap the sandbox root.");
    }
    return source;
  });
  if (new Set(roots).size !== roots.length) {
    throw new Error("gopls OCI toolchain mount roots must be unique.");
  }
  return roots;
}

function buildContainerEnvironment(profile: LspServerProcessProfile): Record<string, string> {
  return {
    PATH: profile.environment.PATH,
    GOCACHE: "/tmp/go-build",
    GOMODCACHE: "/tmp/go-mod",
    GOPATH: "/tmp/gopath",
    GOTMPDIR: "/tmp",
    TMP: "/tmp",
    TEMP: "/tmp",
    HOME: "/tmp/home",
    USERPROFILE: "/tmp/home",
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    // Go 1.24 不按容器 CPU 配额收敛并发；显式约束，避免耗尽固定 PID 限额。
    GOMAXPROCS: String(GOPLS_OCI_SANDBOX_RESOURCE_LIMITS.cpus),
    GOENV: "off",
    GOTELEMETRY: "off",
    GOFLAGS: "-mod=readonly",
    CGO_ENABLED: "0",
  };
}

function buildLspHostOptions(
  options: CreateGoplsOciSandboxHostOptions,
  invocation: OciSandboxInvocation,
  runtimeEnvironment: NodeJS.ProcessEnv,
  resolveRuntimeExecutable?: GoplsOciSandboxHostDependencies["resolveRuntimeExecutable"],
): LspProcessHostOptions {
  const runtimeExecutable = (resolveRuntimeExecutable ?? resolveOciRuntimeExecutable)(
    options.config.runtime,
    runtimeEnvironment,
  );
  return {
    profile: {
      ...options.profile,
      command: runtimeExecutable,
      args: [...invocation.args],
      environment: Object.fromEntries(
        Object.entries(runtimeEnvironment).filter((entry): entry is [string, string] => (
          entry[1] !== undefined
        )),
      ),
    },
    workspaceRoot: options.workspaceRoot,
    responseMaxBytes: options.responseMaxBytes,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  };
}

function resolveOciRuntimeExecutable(
  runtime: "docker" | "podman",
  environment: NodeJS.ProcessEnv,
): string {
  if (path.posix.isAbsolute(runtime)) return runtime;
  const pathValue = environment.PATH ?? process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory || !path.posix.isAbsolute(directory)) continue;
    const candidate = path.posix.join(directory, runtime);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the explicitly inherited runtime PATH.
    }
  }
  throw new Error(`gopls OCI runtime executable ${runtime} was not found in the runtime PATH.`);
}

async function releaseProvisioningResources(
  lease: OciSandboxLease | undefined,
  cleanupEnvironment: () => Promise<void>,
): Promise<void> {
  if (lease) {
    await lease.release().catch(() => undefined);
  }
  await cleanupEnvironment().catch(() => undefined);
  if (lease) {
    await lease.cleanupArtifacts().catch(() => undefined);
  }
}

function requireNormalizedAbsolutePosixPath(value: string | undefined, label: string): string {
  if (!value
    || value.length > 4_096
    || !path.posix.isAbsolute(value)
    || value === "/"
    || value.includes("\u0000")
    || value.includes("\\")
    || path.posix.normalize(value) !== value) {
    throw new Error(`gopls OCI ${label} must be a normalized absolute POSIX path.`);
  }
  return value;
}

function isPosixPathInside(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith("../") && relative !== ".." && !path.posix.isAbsolute(relative));
}
