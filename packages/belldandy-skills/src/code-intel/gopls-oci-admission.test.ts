import { describe, expect, it } from "vitest";

import type { OciCommandSandboxConfig } from "../command-sandbox.js";
import {
  GOPLS_OCI_SANDBOX_CONTRACT_VERSION,
  GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
  type CreateGoplsOciSandboxHostOptions,
  type GoplsOciSandboxHost,
} from "./gopls-oci-host.js";
import {
  createGoplsOciCanaryProvider,
  type CreateGoplsOciCanaryProviderOptions,
  type GoplsOciAdmissionDependencies,
} from "./gopls-oci-admission.js";
import { PINNED_GOPLS_VERSION, type GoplsProcessProfile } from "./gopls-profile.js";

const config: OciCommandSandboxConfig = {
  backend: "oci",
  runtime: "docker",
  image: `node:22-bullseye@sha256:${"a".repeat(64)}`,
};

describe("createGoplsOciCanaryProvider", () => {
  it("admits the pinned local OCI and artifact contract before exposing a Host factory", async () => {
    const events: string[] = [];
    let hostFactoryCalls = 0;
    const options = createOptions();

    const result = await createGoplsOciCanaryProvider(options, {
      ...passingDependencies(events),
      createHost: async (_input: CreateGoplsOciSandboxHostOptions) => {
        hostFactoryCalls += 1;
        return createHostFixture();
      },
    });

    expect(events).toEqual([
      `artifact:${options.artifacts.go.command}`,
      `artifact:${options.artifacts.gopls.command}`,
      "runtime",
      "image",
      "toolchain",
    ]);
    expect(hostFactoryCalls).toBe(0);
    expect(result.admission).toMatchObject({
      status: "passed",
      platform: "linux",
      sandbox: {
        contractVersion: GOPLS_OCI_SANDBOX_CONTRACT_VERSION,
        image: config.image,
        pullPolicy: "never",
        resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
      },
      artifacts: {
        go: { sha256: "b".repeat(64), version: "go1.24.2", platform: "linux/amd64" },
        gopls: { sha256: "c".repeat(64), version: PINNED_GOPLS_VERSION },
      },
    });
    expect(result.provider.profile).toMatchObject({ id: "gopls", status: "available" });
    await result.provider.disposeAsync();
  });

  it("fails closed before Host creation when admission rejects the runtime", async () => {
    let hostFactoryCalls = 0;
    const dependencies = passingDependencies([]);
    dependencies.probeRuntime = async () => ({ available: false });
    dependencies.createHost = async () => {
      hostFactoryCalls += 1;
      return createHostFixture();
    };

    await expect(createGoplsOciCanaryProvider(createOptions(), dependencies))
      .rejects.toMatchObject({ code: "runtime_unavailable" });
    expect(hostFactoryCalls).toBe(0);
  });

  it("rejects artifact drift without falling back to a native LSP Host", async () => {
    let hostFactoryCalls = 0;
    const dependencies = passingDependencies([]);
    dependencies.inspectArtifact = async ({ command }) => ({
      sha256: command.endsWith("/go") ? "d".repeat(64) : "c".repeat(64),
    });
    dependencies.createHost = async () => {
      hostFactoryCalls += 1;
      return createHostFixture();
    };

    await expect(createGoplsOciCanaryProvider(createOptions(), dependencies))
      .rejects.toMatchObject({ code: "artifact_hash_mismatch" });
    expect(hostFactoryCalls).toBe(0);
  });
});

function createOptions(): CreateGoplsOciCanaryProviderOptions {
  const sandboxRoot = "/var/tmp/star-sanctuary-go-sandbox";
  const workspaceRoot = `${sandboxRoot}/workspace`;
  const goRoot = "/var/tmp/star-sanctuary-go1.24.2-linux";
  const goplsRoot = "/var/tmp/star-sanctuary-gopls-v0.21.0-linux";
  return {
    config,
    profile: createProfile(workspaceRoot, goRoot, goplsRoot),
    sandboxRoot,
    artifacts: {
      go: {
        artifactRoot: goRoot,
        command: `${goRoot}/bin/go`,
        version: "go1.24.2",
        platform: "linux/amd64",
        sha256: "b".repeat(64),
      },
      gopls: {
        artifactRoot: goplsRoot,
        command: `${goplsRoot}/bin/gopls`,
        version: PINNED_GOPLS_VERSION,
        sha256: "c".repeat(64),
      },
    },
  };
}

function passingDependencies(events: string[]): GoplsOciAdmissionDependencies {
  return {
    platform: "linux",
    probeRuntime: async () => {
      events.push("runtime");
      return { available: true };
    },
    probeLocalImage: async () => {
      events.push("image");
      return { available: true };
    },
    probeToolchain: async (input) => {
      events.push("toolchain");
      return {
        status: "available",
        pinnedGoplsVersion: PINNED_GOPLS_VERSION,
        gopls: { command: input.goplsCommand, version: PINNED_GOPLS_VERSION },
        go: { command: input.goCommand, version: "go1.24.2", platform: "linux/amd64" },
        diagnostics: [],
      };
    },
    inspectArtifact: async ({ command }) => {
      events.push(`artifact:${command}`);
      return { sha256: command.endsWith("/go") ? "b".repeat(64) : "c".repeat(64) };
    },
  };
}

function createProfile(
  workspaceRoot: string,
  goRoot: string,
  goplsRoot: string,
): GoplsProcessProfile {
  const stateRoot = "/var/tmp/star-sanctuary-go-state";
  return {
    contractVersion: "gopls-profile/v1",
    profile: {
      id: "gopls",
      version: PINNED_GOPLS_VERSION,
      command: `${goplsRoot}/bin/gopls`,
      args: ["serve"],
      environment: {
        PATH: `${goRoot}/bin`,
        GOCACHE: `${stateRoot}/go-build`,
        GOMODCACHE: `${stateRoot}/go-mod`,
        GOPATH: `${stateRoot}/gopath`,
        GOTMPDIR: `${stateRoot}/tmp`,
        TMP: `${stateRoot}/tmp`,
        TEMP: `${stateRoot}/tmp`,
        HOME: `${stateRoot}/home`,
        USERPROFILE: `${stateRoot}/home`,
        GOPROXY: "off",
        GOSUMDB: "off",
        GOTOOLCHAIN: "local",
        GOENV: "off",
        GOTELEMETRY: "off",
        GOFLAGS: "-mod=readonly",
        GOWORK: "auto",
        CGO_ENABLED: "0",
      },
      clientNotificationMethods: ["textDocument/didOpen"],
      serverRequests: {
        workspaceConfiguration: { gopls: {} },
        dynamicRegistrationMethods: ["workspace/didChangeConfiguration"],
        workDoneProgress: true,
      },
    },
    workspaceRoot,
    externalEvidenceRoots: [],
    stateRoot,
    statePaths: {
      goCache: `${stateRoot}/go-build`,
      goModCache: `${stateRoot}/go-mod`,
      goPath: `${stateRoot}/gopath`,
      temp: `${stateRoot}/tmp`,
      home: `${stateRoot}/home`,
    },
    toolchain: {
      goCommand: `${goRoot}/bin/go`,
      goVersion: "go1.24.2",
      platform: "linux/amd64",
    },
    resourceLimits: {
      decodedResponseMaxBytes: 4 * 1024 * 1024,
      maxConcurrentRequestsPerHost: 1,
      processMemoryHardLimitBytes: null,
      processMemoryStatus: "unverified",
    },
    governance: {
      capabilities: ["symbols", "definition", "references", "implementation"],
      dependencyRestore: "denied",
      networkPolicy: "environment-deny",
      sandboxStatus: "unverified",
      productionEligible: false,
    },
  };
}

function createHostFixture(): GoplsOciSandboxHost {
  return {
    async request<Result>(): Promise<Result> {
      return [] as Result;
    },
    async notify(): Promise<void> {},
    async dispose(): Promise<void> {},
    getRuntimeTarget: () => ({ runtime: "docker", containerName: "fixture" }),
    getSandboxDiagnostics: () => ({
      contractVersion: GOPLS_OCI_SANDBOX_CONTRACT_VERSION,
      runtimeStarted: false,
      leaseCleanupStatus: "pending",
      cleanupErrorCount: 0,
      resourceLimits: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
    }),
    getLspDiagnostics: () => ({
      state: "idle",
      serverId: "gopls",
      serverVersion: PINNED_GOPLS_VERSION,
      processStartCount: 0,
      unexpectedExitCount: 0,
      requestCount: 0,
      notificationCount: 0,
      forcedTerminationCount: 0,
      stderr: { text: "", retainedBytes: 0, truncatedBytes: 0, totalBytes: 0 },
      responses: { maxBytes: 1, lastBytes: 0, peakBytes: 0, rejectedCount: 0 },
      concurrency: { maxRequests: 1, activeRequests: 0, peakActiveRequests: 0, rejectedCount: 0 },
      serverRequests: { handledCount: 0, rejectedCount: 0, registeredCapabilityMethods: [] },
      workDoneProgress: {
        createdCount: 0,
        begunCount: 0,
        completedCount: 0,
        activeCount: 0,
        peakActiveCount: 0,
      },
    }),
  };
}
