import { describe, expect, it } from "vitest";

import type { OciSandboxInvocation } from "../command-sandbox.js";
import type { OciSandboxLease } from "../command-sandbox-lease.js";
import type { GoplsCodeIntelHost } from "./gopls-provider.js";
import type {
  LspProcessHostDiagnostics,
  LspProcessHostOptions,
  LspServerProcessProfile,
} from "./lsp-process-host.js";
import {
  GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
  createGoplsOciSandboxHost,
  type GoplsOciSandboxHostDependencies,
} from "./gopls-oci-host.js";

describe("createGoplsOciSandboxHost", () => {
  it("admits one same-path OCI Host and releases every owned resource", async () => {
    const events: string[] = [];
    const timelineMarkers: string[] = [];
    const requests: Array<{ method: string; params?: unknown }> = [];
    let progressWaitCount = 0;
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const goArtifactRoot = "/var/tmp/star-sanctuary-go1.24.2-linux";
    const goplsArtifactRoot = "/var/tmp/star-sanctuary-gopls-v0.21.0-linux";
    const profile = createProfile(goArtifactRoot, goplsArtifactRoot, workspaceRoot);
    const readinessDefinition = [{
      uri: `file://${workspaceRoot}/lib/service/api.go`,
      range: {
        start: { line: 8, character: 5 },
        end: { line: 8, character: 17 },
      },
    }];
    let invocationInput: Parameters<NonNullable<GoplsOciSandboxHostDependencies["buildInvocation"]>>[0] | undefined;
    let lspOptions: LspProcessHostOptions | undefined;
    const delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics } = {
      async request<Result>(request): Promise<Result> {
        events.push("request");
        requests.push({ method: request.method, params: request.params });
        return (request.method === "textDocument/definition"
          ? readinessDefinition
          : []) as Result;
      },
      async notify(): Promise<void> {
        events.push("notify");
      },
      async dispose(): Promise<void> {
        events.push("host-dispose");
      },
      getDiagnostics(): LspProcessHostDiagnostics {
        return createLspDiagnosticsFixture();
      },
      async waitForWorkDoneProgress(): Promise<void> {
        progressWaitCount += 1;
        if (progressWaitCount === 1) {
          throw Object.assign(new Error("progress slice elapsed"), { code: "timeout" });
        }
      },
      recordTimelineMarker(kind: "readiness_started" | "readiness_completed" | "readiness_failed"): void {
        timelineMarkers.push(kind);
      },
    };
    const lease = createLease(events);

    const host = await createGoplsOciSandboxHost({
      config: {
        backend: "oci",
        runtime: "docker",
        image: `node:22-bullseye@sha256:${"a".repeat(64)}`,
      },
      profile,
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: goArtifactRoot, target: goArtifactRoot },
        { source: goplsArtifactRoot, target: goplsArtifactRoot },
      ],
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    }, {
      platform: "linux",
      createLease: async () => lease,
      createEnvironmentFile: async (environment) => {
        expect(environment).toMatchObject({
          GOPROXY: "off",
          GOSUMDB: "off",
          GOTOOLCHAIN: "local",
          GOMAXPROCS: "1",
          PATH: `${goArtifactRoot}/bin`,
          GOCACHE: "/tmp/go-build",
          GOMODCACHE: "/tmp/go-mod",
          GOPATH: "/tmp/gopath",
          GOTMPDIR: "/tmp",
          HOME: "/tmp/home",
        });
        expect(environment).not.toHaveProperty("GOWORK");
        return {
          path: "/tmp/private-gopls-environment",
          cleanup: async () => {
            events.push("environment-cleanup");
          },
        };
      },
      buildInvocation: (input) => {
        invocationInput = input;
        return {
          executable: "docker",
          args: ["run", "sandboxed-gopls"],
          cwd: sandboxRoot,
        } satisfies OciSandboxInvocation;
      },
      createHost: (options) => {
        lspOptions = options;
        return delegatedHost;
      },
      buildRuntimeEnvironment: () => ({ PATH: "/usr/bin" }),
      resolveRuntimeExecutable: () => "/usr/bin/docker",
    });

    expect(invocationInput).toMatchObject({
      workspaceRoot: sandboxRoot,
      containerWorkspaceRoot: sandboxRoot,
      cwd: workspaceRoot,
      resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
      trustedReadOnlyMounts: [
        { source: goArtifactRoot, target: goArtifactRoot },
        { source: goplsArtifactRoot, target: goplsArtifactRoot },
      ],
      plan: {
        executable: `${goplsArtifactRoot}/bin/gopls`,
        argv: ["serve"],
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pipe",
      },
    });
    expect(lspOptions).toMatchObject({
      profile: {
        id: "gopls",
        version: "v0.21.0",
        command: "/usr/bin/docker",
        args: ["run", "sandboxed-gopls"],
        environment: { PATH: "/usr/bin" },
        workspaceFolders: [`${workspaceRoot}/app`, `${workspaceRoot}/lib`],
      },
      workspaceRoot,
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    });
    expect(host.getRuntimeTarget()).toEqual({ runtime: "docker", containerName: lease.binding.containerName });

    await host.notify({ method: "textDocument/didOpen", deadlineAtMs: Date.now() + 1_000 });
    await host.request({ method: "workspace/symbol", deadlineAtMs: Date.now() + 1_000 });
    await host.waitForWorkspaceReady(Date.now() + 1_000);
    await host.dispose();

    expect(events).toEqual([
      "runtime-started",
      "notify",
      "request",
      "request",
      "request",
      "host-dispose",
      "lease-release",
      "environment-cleanup",
      "lease-artifacts-cleanup",
    ]);
    expect(host.getSandboxDiagnostics()).toMatchObject({
      contractVersion: "gopls-oci-sandbox/v1",
      runtimeStarted: true,
      leaseCleanupStatus: "removed",
      cleanupErrorCount: 0,
      resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
    });
    expect(timelineMarkers).toEqual(["readiness_started", "readiness_completed"]);
    expect(progressWaitCount).toBe(1);
    expect(requests).toEqual([
      { method: "workspace/symbol", params: undefined },
      { method: "workspace/symbol", params: { query: "BuildMessage" } },
      {
        method: "textDocument/definition",
        params: {
          textDocument: { uri: `file://${workspaceRoot}/app/main.go` },
          position: { line: 7, character: 13 },
        },
      },
    ]);
    expect(host.getLspDiagnostics()).toMatchObject({ state: "stopped", requestCount: 1 });
  });

  it("fails readiness after bounded cross-module definition probes stay empty", async () => {
    const events: string[] = [];
    const timelineMarkers: string[] = [];
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const goArtifactRoot = "/var/tmp/star-sanctuary-go1.24.2-linux";
    const goplsArtifactRoot = "/var/tmp/star-sanctuary-gopls-v0.21.0-linux";
    let definitionRequestCount = 0;
    const delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics } = {
      async request<Result>(request): Promise<Result> {
        if (request.method === "textDocument/definition") definitionRequestCount += 1;
        return [] as Result;
      },
      async notify(): Promise<void> {},
      async dispose(): Promise<void> {
        events.push("host-dispose");
      },
      getDiagnostics: createLspDiagnosticsFixture,
      async waitForWorkDoneProgress(): Promise<void> {},
      recordTimelineMarker(kind: "readiness_started" | "readiness_completed" | "readiness_failed"): void {
        timelineMarkers.push(kind);
      },
    };
    const host = await createGoplsOciSandboxHost({
      config: {
        backend: "oci",
        runtime: "docker",
        image: `node:22-bullseye@sha256:${"a".repeat(64)}`,
      },
      profile: createProfile(goArtifactRoot, goplsArtifactRoot, workspaceRoot),
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: goArtifactRoot, target: goArtifactRoot },
        { source: goplsArtifactRoot, target: goplsArtifactRoot },
      ],
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    }, {
      platform: "linux",
      createLease: async () => createLease(events),
      createEnvironmentFile: async () => ({
        path: "/tmp/private-gopls-environment",
        cleanup: async () => {
          events.push("environment-cleanup");
        },
      }),
      buildInvocation: () => ({
        executable: "docker",
        args: ["run", "sandboxed-gopls"],
        cwd: sandboxRoot,
      }),
      createHost: () => delegatedHost,
      buildRuntimeEnvironment: () => ({ PATH: "/usr/bin" }),
      resolveRuntimeExecutable: () => "/usr/bin/docker",
    });

    await expect(host.waitForWorkspaceReady(Date.now() + 1_000)).rejects.toThrow(
      /cross-module definition readiness/i,
    );
    expect(definitionRequestCount).toBe(8);
    expect(timelineMarkers).toEqual(["readiness_started", "readiness_failed"]);
    await host.dispose();
    expect(host.getSandboxDiagnostics()).toMatchObject({
      leaseCleanupStatus: "removed",
      cleanupErrorCount: 0,
    });
  });

  it("accepts a single Location definition result from gopls", async () => {
    const timelineMarkers: string[] = [];
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics } = {
      async request<Result>(request): Promise<Result> {
        if (request.method === "textDocument/definition") {
          return { uri: `file://${workspaceRoot}/lib/service/api.go` } as Result;
        }
        return [] as Result;
      },
      async notify(): Promise<void> {},
      async dispose(): Promise<void> {},
      getDiagnostics: createLspDiagnosticsFixture,
      async waitForWorkDoneProgress(): Promise<void> {},
      recordTimelineMarker(kind: "readiness_started" | "readiness_completed" | "readiness_failed"): void {
        timelineMarkers.push(kind);
      },
    };
    const host = await createGoplsOciSandboxHost({
      config: {
        backend: "oci",
        runtime: "docker",
        image: `node:22-bullseye@sha256:${"a".repeat(64)}`,
      },
      profile: createProfile("/var/tmp/go", "/var/tmp/gopls", workspaceRoot),
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: "/var/tmp/go", target: "/var/tmp/go" },
        { source: "/var/tmp/gopls", target: "/var/tmp/gopls" },
      ],
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    }, createHostDependencies(delegatedHost));

    await expect(host.waitForWorkspaceReady(Date.now() + 1_000)).resolves.toBeUndefined();
    expect(timelineMarkers).toEqual(["readiness_started", "readiness_completed"]);
    await host.dispose();
  });

  it("waits for an active progress token before probing definition again", async () => {
    const timelineMarkers: string[] = [];
    let progressWaitCount = 0;
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics } = {
      async request<Result>(request): Promise<Result> {
        if (request.method === "textDocument/definition") return [] as Result;
        return [] as Result;
      },
      async notify(): Promise<void> {},
      async dispose(): Promise<void> {},
      getDiagnostics: () => createLspDiagnosticsFixture(progressWaitCount === 0 ? 0 : 1),
      async waitForWorkDoneProgress(): Promise<void> {
        progressWaitCount += 1;
        if (progressWaitCount === 1) throw Object.assign(new Error("slice elapsed"), { code: "timeout" });
        throw Object.assign(new Error("active token did not close"), { code: "timeout" });
      },
      recordTimelineMarker(kind: "readiness_started" | "readiness_completed" | "readiness_failed"): void {
        timelineMarkers.push(kind);
      },
    };
    const host = await createGoplsOciSandboxHost({
      config: { backend: "oci", runtime: "docker", image: `node:22-bullseye@sha256:${"a".repeat(64)}` },
      profile: createProfile("/var/tmp/go", "/var/tmp/gopls", workspaceRoot),
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: "/var/tmp/go", target: "/var/tmp/go" },
        { source: "/var/tmp/gopls", target: "/var/tmp/gopls" },
      ],
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    }, createHostDependencies(delegatedHost));

    await expect(host.waitForWorkspaceReady(Date.now() + 50)).rejects.toMatchObject({ code: "timeout" });
    expect(progressWaitCount).toBe(2);
    expect(timelineMarkers).toEqual(["readiness_started", "readiness_failed"]);
    await host.dispose();
  });

  it("waits when a token begins during the bounded probe slice", async () => {
    const timelineMarkers: string[] = [];
    let progressWaitCount = 0;
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics } = {
      async request<Result>(request): Promise<Result> {
        if (request.method === "textDocument/definition") {
          return { uri: `file://${workspaceRoot}/lib/service/api.go` } as Result;
        }
        return [] as Result;
      },
      async notify(): Promise<void> {},
      async dispose(): Promise<void> {},
      getDiagnostics: () => createLspDiagnosticsFixture(progressWaitCount === 1 ? 1 : 0),
      async waitForWorkDoneProgress(): Promise<void> {
        progressWaitCount += 1;
        if (progressWaitCount === 1) throw Object.assign(new Error("slice elapsed"), { code: "timeout" });
      },
      recordTimelineMarker(kind: "readiness_started" | "readiness_completed" | "readiness_failed"): void {
        timelineMarkers.push(kind);
      },
    };
    const host = await createGoplsOciSandboxHost({
      config: { backend: "oci", runtime: "docker", image: `node:22-bullseye@sha256:${"a".repeat(64)}` },
      profile: createProfile("/var/tmp/go", "/var/tmp/gopls", workspaceRoot),
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: "/var/tmp/go", target: "/var/tmp/go" },
        { source: "/var/tmp/gopls", target: "/var/tmp/gopls" },
      ],
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    }, createHostDependencies(delegatedHost));

    await expect(host.waitForWorkspaceReady(Date.now() + 1_000)).resolves.toBeUndefined();
    expect(progressWaitCount).toBe(2);
    expect(timelineMarkers).toEqual(["readiness_started", "readiness_completed"]);
    await host.dispose();
  });

  it("does not complete readiness while a progress token is already active", async () => {
    const timelineMarkers: string[] = [];
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const goArtifactRoot = "/var/tmp/star-sanctuary-go1.24.2-linux";
    const goplsArtifactRoot = "/var/tmp/star-sanctuary-gopls-v0.21.0-linux";
    const delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics } = {
      async request<Result>(request): Promise<Result> {
        if (request.method === "textDocument/definition") {
          return [{ uri: `file://${workspaceRoot}/lib/service/api.go` }] as Result;
        }
        return [] as Result;
      },
      async notify(): Promise<void> {},
      async dispose(): Promise<void> {},
      getDiagnostics: () => createLspDiagnosticsFixture(1),
      async waitForWorkDoneProgress(): Promise<void> {
        throw Object.assign(new Error("progress did not close"), { code: "timeout" });
      },
      recordTimelineMarker(kind: "readiness_started" | "readiness_completed" | "readiness_failed"): void {
        timelineMarkers.push(kind);
      },
    };
    const host = await createGoplsOciSandboxHost({
      config: {
        backend: "oci",
        runtime: "docker",
        image: `node:22-bullseye@sha256:${"a".repeat(64)}`,
      },
      profile: createProfile(goArtifactRoot, goplsArtifactRoot, workspaceRoot),
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: goArtifactRoot, target: goArtifactRoot },
        { source: goplsArtifactRoot, target: goplsArtifactRoot },
      ],
      responseMaxBytes: 4 * 1024 * 1024,
      shutdownTimeoutMs: 5_000,
    }, createHostDependencies(delegatedHost));

    await expect(host.waitForWorkspaceReady(Date.now() + 50)).rejects.toMatchObject({ code: "timeout" });
    expect(timelineMarkers).toEqual(["readiness_started", "readiness_failed"]);
    await host.dispose();
  });

  it("fails closed before acquiring resources outside native Linux same-path execution", async () => {
    const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
    const workspaceRoot = `${sandboxRoot}/workspace`;
    const goArtifactRoot = "/var/tmp/star-sanctuary-go1.24.2-linux";
    const goplsArtifactRoot = "/var/tmp/star-sanctuary-gopls-v0.21.0-linux";
    const toolchainReadOnlyMounts = [
      { source: goArtifactRoot, target: goArtifactRoot },
      { source: goplsArtifactRoot, target: goplsArtifactRoot },
    ];
    const profile = createProfile(goArtifactRoot, goplsArtifactRoot, workspaceRoot);
    let leaseCalls = 0;
    const createLease = async () => {
      leaseCalls += 1;
      return createLeaseFixture();
    };

    await expect(createGoplsOciSandboxHost({
      config: { backend: "oci", runtime: "docker", image: `node@sha256:${"a".repeat(64)}` },
      profile,
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts,
      responseMaxBytes: 1,
      shutdownTimeoutMs: 1,
    }, { platform: "win32", createLease })).rejects.toThrow(/Linux/u);

    await expect(createGoplsOciSandboxHost({
      config: { backend: "oci", runtime: "docker", image: `node@sha256:${"a".repeat(64)}` },
      profile: { ...profile, command: "/opt/unbound-gopls" },
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts,
      responseMaxBytes: 1,
      shutdownTimeoutMs: 1,
    }, { platform: "linux", createLease })).rejects.toThrow(/declared read-only mount/u);

    await expect(createGoplsOciSandboxHost({
      config: { backend: "oci", runtime: "docker", image: `node@sha256:${"a".repeat(64)}` },
      profile,
      sandboxRoot,
      workspaceRoot,
      toolchainReadOnlyMounts: [
        { source: goArtifactRoot, target: "/opt/go" },
        { source: goplsArtifactRoot, target: goplsArtifactRoot },
      ],
      responseMaxBytes: 1,
      shutdownTimeoutMs: 1,
    }, { platform: "linux", createLease })).rejects.toThrow(/same-path/u);
    expect(leaseCalls).toBe(0);
  });
});

function createLspDiagnosticsFixture(activeProgressCount = 0): LspProcessHostDiagnostics {
  return {
    state: "stopped",
    serverId: "gopls",
    serverVersion: "v0.21.0",
    processStartCount: 1,
    unexpectedExitCount: 0,
    requestCount: 1,
    notificationCount: 1,
    forcedTerminationCount: 0,
    stderr: { text: "", retainedBytes: 0, truncatedBytes: 0, totalBytes: 0 },
    responses: { maxBytes: 4 * 1024 * 1024, lastBytes: 2, peakBytes: 2, rejectedCount: 0 },
    concurrency: { maxRequests: 1, activeRequests: 0, peakActiveRequests: 1, rejectedCount: 0 },
    serverRequests: { handledCount: 0, rejectedCount: 0, registeredCapabilityMethods: [] },
    workDoneProgress: {
      createdCount: 0,
      begunCount: 0,
      completedCount: 0,
      activeCount: activeProgressCount,
      peakActiveCount: activeProgressCount,
    },
    timeline: { events: [], truncated: false },
  };
}

function createProfile(
  goArtifactRoot: string,
  goplsArtifactRoot: string,
  workspaceRoot: string,
): LspServerProcessProfile {
  return {
    id: "gopls",
    version: "v0.21.0",
    command: `${goplsArtifactRoot}/bin/gopls`,
    args: ["serve"],
    environment: {
      PATH: `${goArtifactRoot}/bin`,
      GOCACHE: "/host/state/go-build",
      GOMODCACHE: "/host/state/go-mod",
      GOPATH: "/host/state/gopath",
      GOTMPDIR: "/host/state/tmp",
      TMP: "/host/state/tmp",
      TEMP: "/host/state/tmp",
      HOME: "/host/state/home",
      USERPROFILE: "/host/state/home",
      GOPROXY: "off",
      GOSUMDB: "off",
      GOTOOLCHAIN: "local",
      GOENV: "off",
      GOTELEMETRY: "off",
      GOFLAGS: "-mod=readonly",
      CGO_ENABLED: "0",
      GOWORK: "auto",
    },
    workspaceFolders: [`${workspaceRoot}/app`, `${workspaceRoot}/lib`],
    clientNotificationMethods: ["textDocument/didOpen"],
    initializationOptions: { settings: { gopls: { buildFlags: ["-tags=canary"] } } },
    serverRequests: {
      workspaceConfiguration: { gopls: { buildFlags: ["-tags=canary"] } },
      dynamicRegistrationMethods: ["workspace/didChangeConfiguration"],
      workDoneProgress: true,
    },
  };
}

function createLease(events: string[]): OciSandboxLease {
  const lease = createLeaseFixture();
  return {
    ...lease,
    markRuntimeStarted() {
      events.push("runtime-started");
      lease.markRuntimeStarted();
    },
    async release() {
      events.push("lease-release");
      return await lease.release();
    },
    async cleanupArtifacts() {
      events.push("lease-artifacts-cleanup");
      await lease.cleanupArtifacts();
    },
  };
}

function createLeaseFixture(): OciSandboxLease {
  let started = false;
  return {
    binding: {
      leaseId: "12345678-1234-4234-8234-123456789abc",
      containerName: "belldandy-command-12345678123442348234123456789abc",
      cidFile: "/tmp/container.cid",
    },
    markRuntimeStarted() {
      started = true;
    },
    async release() {
      return { status: started ? "removed" : "not_started" };
    },
    async cleanupArtifacts() {},
    metadata() {
      return {};
    },
  };
}

function createHostDependencies(
  delegatedHost: GoplsCodeIntelHost & { getDiagnostics(): LspProcessHostDiagnostics },
): GoplsOciSandboxHostDependencies {
  return {
    platform: "linux",
    createLease: async () => createLeaseFixture(),
    createEnvironmentFile: async () => ({
      path: "/tmp/private-gopls-environment",
      cleanup: async () => {},
    }),
    buildInvocation: () => ({
      executable: "docker",
      args: ["run", "sandboxed-gopls"],
      cwd: "/var/tmp/star-sanctuary-go-sandbox",
    }),
    createHost: () => delegatedHost,
    buildRuntimeEnvironment: () => ({ PATH: "/usr/bin" }),
    resolveRuntimeExecutable: () => "/usr/bin/docker",
  };
}
