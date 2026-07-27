import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { JsonObject } from "@belldandy/protocol";
import type { ToolCallResult } from "@belldandy/skills";

import {
  EXTENSION_RUNTIME_MAX_FRAME_BYTES,
  EXTENSION_RUNTIME_PROTOCOL_VERSION,
  parseExtensionRuntimeHostResponseLine,
  serializeExtensionRuntimeFrame,
  type ExtensionRuntimeHostRequest,
  type ExtensionRuntimeHostResponse,
} from "./extension-runtime-contract.js";
import type {
  ExtensionRuntimeAdapter,
  ExtensionRuntimeGrant,
  ExtensionRuntimeInvocation,
  ExtensionRuntimeSession,
} from "./extension-runtime-supervisor.js";
import {
  listExtensionRuntimeLeases,
  writeExtensionRuntimeLease,
} from "./extension-runtime-lease.js";

const OCI_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?@sha256:[a-f0-9]{64}$/;
const LEASE_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const CONTAINER_NAME_PATTERN = /^belldandy-extension-[a-f0-9]{32}$/i;
const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;
const OCI_CONTROL_TIMEOUT_MS = 5_000;
const COMPLETED_RESPONSE_ID_LIMIT = 256;

export type OciExtensionRuntimeConfig = {
  backend: "oci";
  runtime: "docker" | "podman";
  image: string;
};

export type OciExtensionRuntimeLeaseBinding = {
  leaseId: string;
  containerName: string;
  cidFile: string;
};

export type OciExtensionRuntimeInvocation = {
  executable: "docker" | "podman";
  args: string[];
  cwd: string;
};

export interface ExtensionRuntimeTransport {
  write(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  onExit(listener: (error: Error) => void): () => void;
  terminate(): void;
}

export type ExtensionRuntimeLaunchResult = {
  transport: ExtensionRuntimeTransport;
  release: () => Promise<void>;
};

export type ExtensionRuntimeLauncher = (
  invocation: OciExtensionRuntimeInvocation,
  lease: OciExtensionRuntimeLeaseBinding,
  grant: ExtensionRuntimeGrant,
) => Promise<ExtensionRuntimeLaunchResult>;

export type OciExtensionRuntimeAdapterOptions = {
  config: OciExtensionRuntimeConfig;
  stateDir: string;
  hostRoot: string;
  launch?: ExtensionRuntimeLauncher;
};

export type OciExtensionRuntimeAdmission =
  | { available: true; adapter: OciExtensionRuntimeAdapter }
  | { available: false; reason: "not_configured" | "invalid_configuration" | "runtime_unavailable" | "image_unavailable" | "stale_lease_cleanup_failed" };

type PendingResponse = {
  expectedType: ExtensionRuntimeHostResponse["type"];
  resolve: (response: ExtensionRuntimeHostResponse) => void;
  reject: (error: Error) => void;
};

function normalizeOptional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function resolveOciExtensionRuntimeConfig(
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): OciExtensionRuntimeConfig | undefined {
  if (normalizeOptional(readEnv("BELLDANDY_EXTENSION_HOST_BACKEND")) !== "oci") return undefined;
  const runtime = normalizeOptional(readEnv("BELLDANDY_EXTENSION_HOST_OCI_RUNTIME")) ?? "docker";
  if (runtime !== "docker" && runtime !== "podman") return undefined;
  const image = normalizeOptional(readEnv("BELLDANDY_EXTENSION_HOST_OCI_IMAGE"));
  if (!image || !OCI_IMAGE_PATTERN.test(image)) return undefined;
  return { backend: "oci", runtime, image };
}

function assertMountPath(value: string, label: string): string {
  const resolved = path.resolve(value);
  if (!resolved || resolved.includes("\u0000") || resolved.includes(",")) {
    throw new Error(`${label} cannot be represented safely as an OCI mount.`);
  }
  return resolved;
}

function assertLease(lease: OciExtensionRuntimeLeaseBinding): void {
  if (!LEASE_ID_PATTERN.test(lease.leaseId) || !CONTAINER_NAME_PATTERN.test(lease.containerName)) {
    throw new Error("Extension runtime lease identity is invalid.");
  }
  if (!path.isAbsolute(lease.cidFile) || lease.cidFile.includes("\u0000")) {
    throw new Error("Extension runtime cidfile path is invalid.");
  }
}

function readOnlyMount(source: string, destination: string): string {
  return ["type=bind", `src=${source}`, `dst=${destination}`, "readonly"].join(",");
}

export function buildOciExtensionRuntimeInvocation(input: {
  config: OciExtensionRuntimeConfig;
  extensionRoot: string;
  hostRoot: string;
  lease: OciExtensionRuntimeLeaseBinding;
}): OciExtensionRuntimeInvocation {
  const extensionRoot = assertMountPath(input.extensionRoot, "Extension root");
  const hostRoot = assertMountPath(input.hostRoot, "Extension host root");
  assertLease(input.lease);
  return {
    executable: input.config.runtime,
    cwd: extensionRoot,
    args: [
      "run",
      "--interactive",
      "--init",
      "--pull=never",
      "--name", input.lease.containerName,
      "--cidfile", input.lease.cidFile,
      "--label", `com.star-sanctuary.extension-runtime.lease=${input.lease.leaseId}`,
      "--network", "none",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", "64",
      "--memory", "256m",
      "--cpus", "1",
      "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m",
      "--mount", readOnlyMount(extensionRoot, "/extension"),
      "--mount", readOnlyMount(hostRoot, "/belldandy-host"),
      "--workdir", "/extension",
      "--entrypoint", "node",
      input.config.image,
      "/belldandy-host/extension-runtime-host-process.js",
      "/extension",
    ],
  };
}

function buildOciControlEnvironment(): NodeJS.ProcessEnv {
  const allowed = process.platform === "win32"
    ? ["APPDATA", "HOME", "LOCALAPPDATA", "PATH", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR"]
    : ["HOME", "PATH", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"];
  const env: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

async function runOciControl(input: OciExtensionRuntimeInvocation): Promise<boolean> {
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(input.executable, input.args, {
        cwd: input.cwd,
        env: buildOciControlEnvironment(),
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish(false);
    }, OCI_CONTROL_TIMEOUT_MS);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

class ChildProcessExtensionRuntimeTransport implements ExtensionRuntimeTransport {
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly exitListeners = new Set<(error: Error) => void>();
  private buffer = "";
  private exited = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleChunk(chunk));
    child.stderr.resume();
    child.once("error", (error) => this.emitExit(error));
    child.once("close", (code, signal) => {
      this.emitExit(new Error(`Extension runtime host exited (code=${code ?? "none"}, signal=${signal ?? "none"}).`));
    });
  }

  write(line: string): void {
    if (this.exited || !this.child.stdin.writable) throw new Error("Extension runtime transport is closed.");
    this.child.stdin.write(line);
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  terminate(): void {
    if (this.exited) return;
    this.exited = true;
    try { this.child.stdin.destroy(); } catch { /* already closed */ }
    try { this.child.kill("SIGKILL"); } catch { /* already closed */ }
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > EXTENSION_RUNTIME_MAX_FRAME_BYTES && !this.buffer.includes("\n")) {
      this.emitExit(new Error("Extension runtime response exceeds the frame size limit."));
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        for (const listener of this.lineListeners) listener(line);
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  private emitExit(error: Error): void {
    if (this.exited) return;
    this.exited = true;
    for (const listener of this.exitListeners) listener(error);
  }
}

async function readContainerTarget(lease: OciExtensionRuntimeLeaseBinding): Promise<string> {
  try {
    const containerId = (await fs.readFile(lease.cidFile, "utf8")).trim();
    if (CONTAINER_ID_PATTERN.test(containerId)) return containerId;
  } catch {
    // The runtime may have failed before writing its cidfile.
  }
  return lease.containerName;
}

function createDefaultLauncher(input: {
  config: OciExtensionRuntimeConfig;
  stateDir: string;
}): ExtensionRuntimeLauncher {
  return async (invocation, lease, grant) => {
    const leaseDirectory = path.dirname(lease.cidFile);
    await writeExtensionRuntimeLease(input.stateDir, {
      version: 1,
      runtime: input.config.runtime,
      leaseId: lease.leaseId,
      containerName: lease.containerName,
      extensionId: grant.extensionId,
      contentSha256: grant.contentSha256,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: buildOciControlEnvironment(),
        shell: false,
        stdio: "pipe",
        windowsHide: true,
      });
    } catch (error) {
      await fs.rm(leaseDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const transport = new ChildProcessExtensionRuntimeTransport(child);
    let releasePromise: Promise<void> | undefined;
    const release = () => {
      releasePromise ??= (async () => {
        transport.terminate();
        const target = await readContainerTarget(lease);
        const removed = await runOciControl({
          executable: input.config.runtime,
          args: ["rm", "--force", target],
          cwd: input.stateDir,
        });
        if (!removed) {
          throw new Error(`Extension runtime container cleanup failed: ${lease.containerName}`);
        }
        await fs.rm(leaseDirectory, { recursive: true, force: true });
      })();
      return releasePromise;
    };
    return { transport, release };
  };
}

class ExtensionRuntimeProtocolClient {
  private readonly pending = new Map<string, PendingResponse>();
  private readonly completedIds = new Set<string>();
  private readonly completedOrder: string[] = [];
  private readonly fatalListeners = new Set<(error: Error) => void>();
  private readonly unsubscribeLine: () => void;
  private readonly unsubscribeExit: () => void;
  private fatalError: Error | undefined;
  private releasePromise: Promise<void> | undefined;

  constructor(
    private readonly transport: ExtensionRuntimeTransport,
    private readonly release: () => Promise<void>,
  ) {
    this.unsubscribeLine = transport.onLine((line) => this.handleLine(line));
    this.unsubscribeExit = transport.onExit((error) => this.failFatal(error));
  }

  onFatal(listener: (error: Error) => void): () => void {
    this.fatalListeners.add(listener);
    if (this.fatalError) listener(this.fatalError);
    return () => this.fatalListeners.delete(listener);
  }

  async request(
    request: ExtensionRuntimeHostRequest,
    expectedType: PendingResponse["expectedType"],
    signal?: AbortSignal,
  ): Promise<ExtensionRuntimeHostResponse> {
    if (this.fatalError) throw new Error(`Extension runtime session is closed: ${this.fatalError.message}`);
    if (this.pending.has(request.id) || this.completedIds.has(request.id)) {
      throw new Error(`Duplicate extension runtime request ID: ${request.id}`);
    }
    if (signal?.aborted) {
      this.failFatal(new Error("Extension runtime request was aborted."));
      throw this.fatalError!;
    }
    let removeAbortListener = () => {};
    const response = new Promise<ExtensionRuntimeHostResponse>((resolve, reject) => {
      const onAbort = () => this.failFatal(new Error("Extension runtime request was aborted."));
      signal?.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal?.removeEventListener("abort", onAbort);
      this.pending.set(request.id, { expectedType, resolve, reject });
    });
    if (this.fatalError) {
      removeAbortListener();
      throw this.fatalError;
    }
    try {
      this.transport.write(serializeExtensionRuntimeFrame(request));
      return await response;
    } catch (error) {
      this.pending.delete(request.id);
      throw error;
    } finally {
      removeAbortListener();
    }
  }

  async close(reason: string): Promise<void> {
    if (!this.fatalError) {
      const id = randomUUID();
      try {
        await this.request({
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "dispose",
          id,
          reason,
        }, "disposed");
      } catch {
        // Cleanup below remains mandatory even if the Host cannot acknowledge dispose.
      }
    }
    await this.finishRelease();
  }

  private handleLine(line: string): void {
    let response: ExtensionRuntimeHostResponse;
    try {
      response = parseExtensionRuntimeHostResponseLine(line);
    } catch (error) {
      this.failFatal(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      const kind = this.completedIds.has(response.id) ? "Duplicate" : "Unknown";
      this.failFatal(new Error(`${kind} extension runtime response ID: ${response.id}`));
      return;
    }
    this.pending.delete(response.id);
    this.rememberCompleted(response.id);
    if (response.type === "error") {
      pending.reject(new Error(`Extension runtime ${response.error.code}: ${response.error.message}`));
      return;
    }
    if (response.type !== pending.expectedType) {
      const error = new Error(`Extension runtime response type mismatch: expected ${pending.expectedType}, received ${response.type}.`);
      pending.reject(error);
      this.failFatal(error);
      return;
    }
    pending.resolve(response);
  }

  private rememberCompleted(id: string): void {
    this.completedIds.add(id);
    this.completedOrder.push(id);
    if (this.completedOrder.length > COMPLETED_RESPONSE_ID_LIMIT) {
      this.completedIds.delete(this.completedOrder.shift()!);
    }
  }

  private failFatal(error: Error): void {
    if (this.fatalError) return;
    this.fatalError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.transport.terminate();
    void this.finishRelease().catch(() => {});
    for (const listener of this.fatalListeners) listener(error);
  }

  private finishRelease(): Promise<void> {
    if (!this.releasePromise) {
      this.unsubscribeLine();
      this.unsubscribeExit();
      this.transport.terminate();
      this.releasePromise = this.release();
    }
    return this.releasePromise;
  }
}

export class OciExtensionRuntimeAdapter implements ExtensionRuntimeAdapter {
  private readonly launch: ExtensionRuntimeLauncher;

  constructor(private readonly options: OciExtensionRuntimeAdapterOptions) {
    this.launch = options.launch ?? createDefaultLauncher(options);
  }

  async activate(grant: ExtensionRuntimeGrant, signal?: AbortSignal): Promise<ExtensionRuntimeSession> {
    const leaseId = randomUUID();
    const leaseDirectory = path.join(
      this.options.stateDir,
      "extensions",
      "runtime",
      "leases",
      leaseId,
    );
    const lease: OciExtensionRuntimeLeaseBinding = {
      leaseId,
      containerName: `belldandy-extension-${leaseId.replaceAll("-", "")}`,
      cidFile: path.join(leaseDirectory, "container.cid"),
    };
    const invocation = buildOciExtensionRuntimeInvocation({
      config: this.options.config,
      extensionRoot: grant.installPath,
      hostRoot: this.options.hostRoot,
      lease,
    });
    const launched = await this.launch(invocation, lease, grant);
    const client = new ExtensionRuntimeProtocolClient(launched.transport, launched.release);
    try {
      const response = await client.request({
        version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
        type: "activate",
        id: randomUUID(),
        pluginModuleRelativePath: grant.pluginModuleRelativePath,
      }, "activated", signal);
      if (response.type !== "activated") throw new Error("Extension runtime activation response is invalid.");
      return {
        registrations: response.registrations,
        invoke: async (runtimeInvocation: ExtensionRuntimeInvocation, invocationSignal?: AbortSignal) => {
          const result = await client.request({
            version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
            type: "invoke",
            id: runtimeInvocation.invocationId,
            invocation: runtimeInvocation,
          }, "result", invocationSignal);
          if (result.type !== "result") throw new Error("Extension runtime invocation response is invalid.");
          return result.result as ToolCallResult | JsonObject | undefined;
        },
        onFatal: (listener) => client.onFatal(listener),
        close: (reason) => client.close(reason),
      };
    } catch (error) {
      await client.close("activation_failed").catch(() => {});
      throw error;
    }
  }
}

async function probeOciRuntime(config: OciExtensionRuntimeConfig): Promise<"available" | "runtime_unavailable" | "image_unavailable"> {
  const versionAvailable = await runOciControl({
    executable: config.runtime,
    args: ["version", "--format", "{{.Server.Version}}"],
    cwd: process.cwd(),
  });
  if (!versionAvailable) return "runtime_unavailable";
  const imageAvailable = await runOciControl({
    executable: config.runtime,
    args: ["image", "inspect", config.image],
    cwd: process.cwd(),
  });
  return imageAvailable ? "available" : "image_unavailable";
}

async function cleanupStaleExtensionRuntimeLeases(
  stateDir: string,
  config: OciExtensionRuntimeConfig,
): Promise<boolean> {
  let leases;
  try {
    leases = await listExtensionRuntimeLeases(stateDir);
  } catch {
    return false;
  }
  for (const lease of leases) {
    if (lease.runtime !== config.runtime) return false;
    const removed = await runOciControl({
      executable: config.runtime,
      args: ["rm", "--force", lease.containerName],
      cwd: stateDir,
    });
    if (!removed) return false;
    await fs.rm(lease.directory, { recursive: true, force: true });
  }
  return true;
}

export async function createOciExtensionRuntimeAdapter(input: {
  stateDir: string;
  hostRoot: string;
  readEnv?: (name: string) => string | undefined;
  probe?: (config: OciExtensionRuntimeConfig) => Promise<"available" | "runtime_unavailable" | "image_unavailable">;
}): Promise<OciExtensionRuntimeAdmission> {
  const backend = normalizeOptional((input.readEnv ?? ((name) => process.env[name]))("BELLDANDY_EXTENSION_HOST_BACKEND"));
  if (!backend) return { available: false, reason: "not_configured" };
  const config = resolveOciExtensionRuntimeConfig(input.readEnv);
  if (!config) return { available: false, reason: "invalid_configuration" };
  const probe = await (input.probe ?? probeOciRuntime)(config);
  if (probe !== "available") return { available: false, reason: probe };
  if (!await cleanupStaleExtensionRuntimeLeases(input.stateDir, config)) {
    return { available: false, reason: "stale_lease_cleanup_failed" };
  }
  return {
    available: true,
    adapter: new OciExtensionRuntimeAdapter({
      config,
      stateDir: input.stateDir,
      hostRoot: input.hostRoot,
    }),
  };
}
