import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CodeIntel,
  GOPLS_OCI_SANDBOX_RESOURCE_LIMITS,
  createGoplsOciCanaryProvider,
  createGoplsOciSandboxHost,
  createGoplsProcessProfile,
  probeGoplsToolchain,
  summarizeLspReadinessTimeline,
} from "../packages/belldandy-skills/dist/code-intel/index.js";
import {
  buildSandboxRuntimeEnvironment,
  probeOciCommandSandboxRuntime,
  resolveOciCommandSandboxConfig,
} from "../packages/belldandy-skills/dist/command-sandbox.js";
import {
  buildCodeIntelGoTruthSetReport,
  validateGoTruthSetManifest,
} from "./run-code-intel-go-truth-set.mjs";

export const CODE_INTEL_GO_OCI_PROMOTION_GATE_REPORT_VERSION =
  "code-intel-go-oci-promotion-gate-report/v1";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const defaultManifestPath = path.join(repositoryRoot, "benchmarks/code-intel/v1/go-truth-set.json");
const MAX_RUNTIME_OUTPUT_CHARS = 256 * 1024;
const MONITOR_INTERVAL_MS = 20;
const RUNTIME_COMMAND_TIMEOUT_MS = 5_000;
const runtimeContractPaths = [
  "packages/belldandy-skills/src/command-sandbox.ts",
  "packages/belldandy-skills/src/command-sandbox-lease.ts",
  "packages/belldandy-skills/src/code-intel/types.ts",
  "packages/belldandy-skills/src/code-intel/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/lsp-process-host.ts",
  "packages/belldandy-skills/src/code-intel/gopls-profile.ts",
  "packages/belldandy-skills/src/code-intel/gopls-oci-host.ts",
  "packages/belldandy-skills/src/code-intel/gopls-oci-admission.ts",
  "packages/belldandy-skills/src/code-intel/gopls-provider.ts",
  "packages/belldandy-skills/dist/command-sandbox.js",
  "packages/belldandy-skills/dist/command-sandbox-lease.js",
  "packages/belldandy-skills/dist/code-intel/types.js",
  "packages/belldandy-skills/dist/code-intel/code-intel.js",
  "packages/belldandy-skills/dist/code-intel/lsp-process-host.js",
  "packages/belldandy-skills/dist/code-intel/gopls-profile.js",
  "packages/belldandy-skills/dist/code-intel/gopls-oci-host.js",
  "packages/belldandy-skills/dist/code-intel/gopls-oci-admission.js",
  "packages/belldandy-skills/dist/code-intel/gopls-provider.js",
  "scripts/run-code-intel-go-truth-set.mjs",
  "scripts/run-code-intel-go-oci-promotion-gate.mjs",
];

export async function buildCodeIntelGoOciPromotionGateReport(input = {}) {
  const platform = requirePlatform(input.platform);
  const generatedAt = requireIsoTimestamp(input.generatedAt ?? new Date().toISOString());
  const startedAt = Date.now();
  const runtimeFiles = await Promise.all(runtimeContractPaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: await hashFile(path.join(repositoryRoot, relativePath)),
  })));
  const runtime = input.runtimeFactory
    ? await input.runtimeFactory()
    : await runRealPromotionGate({
      platform,
      manifestPath: path.resolve(input.manifestPath ?? defaultManifestPath),
      goplsCommand: requireAbsolutePath(input.goplsCommand, "goplsCommand"),
      goCommand: requireAbsolutePath(input.goCommand, "goCommand"),
      goplsArtifactRoot: requireAbsolutePath(input.goplsArtifactRoot, "goplsArtifactRoot"),
      goArtifactRoot: requireAbsolutePath(input.goArtifactRoot, "goArtifactRoot"),
      config: requireOciConfig(input),
      probeOciRuntime: input.probeOciRuntime,
      runRuntimeCommand: input.runRuntimeCommand,
    });
  const failures = collectGateFailures(runtime);
  const providerAdmissionStatus = runtime.providerAdmissionStatus === "passed"
    ? "passed"
    : "failed";
  const memoryStatus = runtime.processMemory.sampleCount === 0
    ? "unverified"
    : runtime.processMemory.goplsRssPeakBytes > runtime.processMemory.hardLimitBytes
      ? "limit_exceeded"
      : "observed_below_hard_limit";

  return {
    schemaVersion: CODE_INTEL_GO_OCI_PROMOTION_GATE_REPORT_VERSION,
    generatedAt,
    platform,
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(runtimeFiles)),
      files: runtimeFiles,
    },
    truthSet: structuredClone(runtime.truthSet),
    toolchain: structuredClone(runtime.toolchain),
    sandbox: structuredClone(runtime.sandbox),
    processMemory: {
      ...structuredClone(runtime.processMemory),
      status: memoryStatus,
    },
    cleanup: structuredClone(runtime.cleanup),
    gate: {
      passed: failures.length === 0,
      failures,
    },
    promotion: {
      ociEligible: failures.length === 0,
      goCanaryEligible: false,
      providerAdmissionStatus,
      productionEligible: false,
    },
    execution: {
      durationMs: Date.now() - startedAt,
      containerStarts: runtime.execution.containerStarts,
      providerCalls: runtime.execution.providerCalls,
      gatewayCalls: 0,
      modelCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
      osNetworkIsolationVerified: runtime.sandbox.inspect.networkMode === "none",
    },
  };
}

export async function runCodeIntelGoOciPromotionGate(input) {
  const outputPath = path.resolve(requireText(input?.outputPath, "outputPath"));
  if (await pathExists(outputPath)) {
    throw new Error(`Go CodeIntel OCI promotion Gate output already exists: ${outputPath}`);
  }
  const report = await buildCodeIntelGoOciPromotionGateReport(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return report;
}

export function parseCodeIntelGoOciPromotionGateCliArguments(argv) {
  const values = {};
  const names = new Map([
    ["--platform", "platform"],
    ["--manifest", "manifestPath"],
    ["--output", "outputPath"],
    ["--gopls-command", "goplsCommand"],
    ["--go-command", "goCommand"],
    ["--gopls-artifact-root", "goplsArtifactRoot"],
    ["--go-artifact-root", "goArtifactRoot"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = names.get(argument);
    if (!name) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[name] = value;
    index += 1;
  }
  return {
    platform: requirePlatform(values.platform),
    manifestPath: path.resolve(values.manifestPath ?? defaultManifestPath),
    outputPath: path.resolve(requireText(values.outputPath, "outputPath")),
    goplsCommand: requireAbsolutePath(values.goplsCommand, "goplsCommand"),
    goCommand: requireAbsolutePath(values.goCommand, "goCommand"),
    goplsArtifactRoot: requireAbsolutePath(values.goplsArtifactRoot, "goplsArtifactRoot"),
    goArtifactRoot: requireAbsolutePath(values.goArtifactRoot, "goArtifactRoot"),
  };
}

async function runRealPromotionGate(input) {
  if (process.platform !== "linux" || input.platform !== "wsl2-linux") {
    throw new Error("Go CodeIntel OCI promotion Gate requires native WSL2/Linux execution.");
  }
  requirePathInside(input.goplsArtifactRoot, input.goplsCommand, "goplsCommand");
  requirePathInside(input.goArtifactRoot, input.goCommand, "goCommand");
  const runtimeProbe = input.probeOciRuntime ?? probeOciCommandSandboxRuntime;
  const availability = await runtimeProbe(input.config);
  if (!availability.available) {
    throw new Error("Go CodeIntel OCI promotion Gate requires a reachable local OCI runtime.");
  }

  const manifestText = await fs.readFile(input.manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  validateGoTruthSetManifest(manifest);
  const sourceFixtureRoot = path.resolve(path.dirname(input.manifestPath), manifest.workspace.root);
  const probe = await probeGoplsToolchain({
    goplsCommand: input.goplsCommand,
    goCommand: input.goCommand,
    environment: {},
  });
  if (probe.status !== "available"
    || probe.gopls.version !== manifest.provider.version
    || probe.go.version !== manifest.provider.goVersion
    || probe.go.platform !== "linux/amd64") {
    throw new Error("Pinned Linux Go/gopls artifacts are unavailable or incompatible.");
  }

  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-oci-promotion-"));
  const stagedManifestPath = path.join(stagingRoot, "go-truth-set.json");
  const stagedFixtureRoot = path.resolve(stagingRoot, manifest.workspace.root);
  if (!isPathInside(stagingRoot, stagedFixtureRoot)) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    throw new Error("Go truth set fixture root escapes OCI staging.");
  }

  const monitors = [];
  let monitorSnapshot;
  let stateRootCleaned = false;
  let stagingRootCleaned = false;
  let hosts = [];
  let hostCreationError;
  let providerAdmissionStatus = "failed";
  let providerCalls = 0;
  let result;
  try {
    await fs.mkdir(path.dirname(stagedFixtureRoot), { recursive: true });
    await fs.copyFile(input.manifestPath, stagedManifestPath);
    await fs.cp(sourceFixtureRoot, stagedFixtureRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const stateRoot = path.join(stagingRoot, ".gopls-state");
    const truthReport = await buildCodeIntelGoTruthSetReport({
      platform: input.platform,
      manifestPath: stagedManifestPath,
      goplsCommand: input.goplsCommand,
      goCommand: input.goCommand,
      runtimeFactory: async ({ fixtureRoot, manifest: stagedManifest }) => {
        const profile = createGoplsProcessProfile({
          probe,
          workspaceRoot: fixtureRoot,
          workspaceFolders: stagedManifest.workspace.folders.map((folder) => (
            path.resolve(fixtureRoot, folder)
          )),
          stateRoot,
          buildTags: stagedManifest.provider.buildTags,
          platformEnvironment: {},
        });
        const created = await createGoplsOciCanaryProvider({
          config: input.config,
          profile,
          sandboxRoot: stagingRoot,
          artifacts: {
            go: {
              artifactRoot: input.goArtifactRoot,
              command: input.goCommand,
              version: probe.go.version,
              platform: probe.go.platform,
              sha256: await hashFile(input.goCommand),
            },
            gopls: {
              artifactRoot: input.goplsArtifactRoot,
              command: input.goplsCommand,
              version: probe.gopls.version,
              sha256: await hashFile(input.goplsCommand),
            },
          },
        }, {
          ...(input.probeOciRuntime ? { probeRuntime: input.probeOciRuntime } : {}),
          createHost: async (options) => {
            let host;
            try {
              host = await createGoplsOciSandboxHost(options);
            } catch (error) {
              hostCreationError = error;
              throw error;
            }
            hosts.push(host);
            const runtimeTarget = host.getRuntimeTarget();
            const monitor = startContainerMonitor({
              ...runtimeTarget,
              workspaceRoot: stagingRoot,
              goArtifactRoot: input.goArtifactRoot,
              goplsArtifactRoot: input.goplsArtifactRoot,
              goplsCommand: input.goplsCommand,
              runRuntimeCommand: input.runRuntimeCommand,
            });
            monitors.push({ monitor, runtimeTarget });
            return host;
          },
        });
        providerAdmissionStatus = created.admission.status;
        const provider = created.provider;
        const codeIntel = createFailFastCodeIntel(
          new CodeIntel({ providers: [provider] }),
          () => {
            providerCalls += 1;
          },
        );
        return {
          codeIntel,
          provider: provider.profile,
          toolchain: {
            goVersion: profile.toolchain.goVersion,
            platform: profile.toolchain.platform,
          },
          governance: profile.governance,
          resourceLimits: profile.resourceLimits,
          execution: { probeCommands: 4 },
          getLifecycleDiagnostics: () => hosts.map((host) => host.getLspDiagnostics()),
          cleanup: async () => {
            await fs.rm(stateRoot, { recursive: true, force: true });
            stateRootCleaned = !(await pathExists(stateRoot));
            if (!stateRootCleaned) throw new Error("gopls OCI state root cleanup failed.");
          },
        };
      },
    });
    if (monitors.length !== 1 || hosts.length !== 1) {
      const reason = hostCreationError instanceof Error ? ` ${hostCreationError.message}` : "";
      throw new Error(`gopls OCI truth set did not create exactly one monitored Host.${reason}`);
    }
    const [{ monitor, runtimeTarget }] = monitors;
    monitorSnapshot = await monitor.stop();
    const sandboxDiagnostics = hosts[0].getSandboxDiagnostics();
    const residualContainerCount = await countNamedContainers(
      runtimeTarget.runtime,
      runtimeTarget.containerName,
      input.runRuntimeCommand,
    );
    result = {
      providerAdmissionStatus,
      truthSet: summarizeTruthReport(truthReport, hosts[0].getLspDiagnostics()),
      toolchain: {
        go: {
          version: probe.go.version,
          platform: probe.go.platform,
          command: input.goCommand,
          sha256: await hashFile(input.goCommand),
          artifactRoot: input.goArtifactRoot,
        },
        gopls: {
          version: probe.gopls.version,
          command: input.goplsCommand,
          sha256: await hashFile(input.goplsCommand),
          artifactRoot: input.goplsArtifactRoot,
        },
      },
      sandbox: {
        backend: "oci",
        runtime: input.config.runtime,
        imageDigest: requireImageDigest(input.config.image),
        pullPolicy: "never",
        resourceLimits: { ...GOPLS_OCI_SANDBOX_RESOURCE_LIMITS },
        inspect: monitorSnapshot.inspect,
      },
      processMemory: {
        hardLimitBytes: GOPLS_OCI_SANDBOX_RESOURCE_LIMITS.memoryBytes,
        goplsRssPeakBytes: monitorSnapshot.goplsRssPeakBytes,
        sampleCount: monitorSnapshot.sampleCount,
      },
      cleanup: {
        leaseCleanupStatus: sandboxDiagnostics.leaseCleanupStatus,
        cleanupErrorCount: sandboxDiagnostics.cleanupErrorCount,
        residualContainerCount,
        stateRootCleaned,
        stagingRootCleaned: false,
      },
      execution: {
        containerStarts: hosts.filter((host) => host.getSandboxDiagnostics().runtimeStarted).length,
        providerCalls,
      },
    };
  } finally {
    await stopContainerMonitors(monitors);
    await fs.rm(stagingRoot, { recursive: true, force: true });
    stagingRootCleaned = !(await pathExists(stagingRoot));
  }
  if (!result) throw new Error("Go CodeIntel OCI promotion Gate did not produce a result.");
  result.cleanup.stagingRootCleaned = stagingRootCleaned;
  return result;
}

function summarizeTruthReport(report, diagnostics) {
  return {
    id: report.truthSet.id,
    manifestSha256: report.truthSet.manifestSha256,
    sourceAggregateSha256: report.sourceIdentity.aggregateSha256,
    metrics: {
      expected: report.metrics.expected,
      returned: report.metrics.returned,
      truePositive: report.metrics.truePositive,
      falsePositive: report.metrics.falsePositive,
      falseNegative: report.metrics.falseNegative,
      precision: report.metrics.precision,
      recall: report.metrics.recall,
      passed: report.metrics.passed,
    },
    cases: report.cases.map((entry) => ({
      id: entry.id,
      operation: entry.operation,
      status: entry.status,
      expected: entry.expected,
      returned: entry.returned,
      truePositive: entry.truePositive,
      falsePositive: entry.falsePositive,
      falseNegative: entry.falseNegative,
      errorCode: entry.errorCode,
    })),
    lifecycle: {
      hostCount: report.lifecycle.hostCount,
      stoppedHostCount: report.lifecycle.stoppedHostCount,
      processStartCount: report.lifecycle.processStartCount,
      unexpectedExitCount: report.lifecycle.unexpectedExitCount,
      requestCount: report.lifecycle.requestCount,
      forcedTerminationCount: report.lifecycle.forcedTerminationCount,
      failureCount: report.lifecycle.failureCount,
      passed: report.lifecycle.passed,
      ...(diagnostics ? {
        stderr: {
          text: diagnostics.stderr.text,
          totalBytes: diagnostics.stderr.totalBytes,
          truncatedBytes: diagnostics.stderr.truncatedBytes,
        },
        workDoneProgress: structuredClone(diagnostics.workDoneProgress),
        timeline: structuredClone(diagnostics.timeline),
        readinessTimeline: summarizeLspReadinessTimeline(diagnostics.timeline),
      } : {}),
    },
    passed: report.gate.passed,
  };
}

export function startContainerMonitor(input) {
  let stopRequested = false;
  const snapshot = {
    inspect: emptyInspectEvidence(),
    goplsRssPeakBytes: 0,
    sampleCount: 0,
  };
  const operation = (async () => {
    while (!stopRequested) {
      if (!snapshot.inspect.observed) {
        const inspectResult = await runMonitorCommand(
          input,
          ["inspect", "--type", "container", input.containerName],
        );
        if (inspectResult.exitCode === null) break;
        if (inspectResult.exitCode === 0) {
          snapshot.inspect = parseInspectEvidence(inspectResult.stdout, input);
        }
      }
      if (snapshot.inspect.observed) {
        const topResult = await runMonitorCommand(
          input,
          ["top", input.containerName, "-eo", "pid,rss,comm,args"],
        );
        if (topResult.exitCode === null) break;
        if (topResult.exitCode === 0) {
          const rssValues = parseGoplsRssBytes(topResult.stdout, input.goplsCommand);
          if (rssValues.length > 0) {
            snapshot.sampleCount += 1;
            snapshot.goplsRssPeakBytes = Math.max(
              snapshot.goplsRssPeakBytes,
              ...rssValues,
            );
          }
        }
      }
      if (!stopRequested) await delay(MONITOR_INTERVAL_MS);
    }
  })();
  return {
    async stop() {
      stopRequested = true;
      await operation;
      return structuredClone(snapshot);
    },
  };
}

export async function stopContainerMonitors(monitors) {
  await Promise.allSettled(monitors.map(({ monitor }) => monitor.stop()));
}

export function createFailFastCodeIntel(codeIntel, onProviderCall = () => {}) {
  let failure;
  return {
    async query(request) {
      if (failure) return structuredClone(failure);
      onProviderCall();
      const outcome = await codeIntel.query(request);
      if (!outcome.ok) failure = structuredClone(outcome);
      return outcome;
    },
    async disposeAsync() {
      await codeIntel.disposeAsync();
    },
  };
}

async function runMonitorCommand(input, args) {
  const runCommand = input.runRuntimeCommand ?? defaultRunRuntimeCommand;
  return await runCommand(input.runtime, args);
}

function parseInspectEvidence(stdout, input) {
  const values = JSON.parse(stdout);
  const inspected = Array.isArray(values) ? values[0] : undefined;
  if (!inspected?.HostConfig || !Array.isArray(inspected.Mounts)) {
    throw new Error("OCI promotion Gate received invalid container inspect output.");
  }
  const findMount = (source, destination) => inspected.Mounts.find((mount) => (
    mount.Source === source && mount.Destination === destination
  ));
  const workspaceMount = findMount(input.workspaceRoot, input.workspaceRoot);
  const goMount = findMount(input.goArtifactRoot, input.goArtifactRoot);
  const goplsMount = findMount(input.goplsArtifactRoot, input.goplsArtifactRoot);
  const tmpfs = inspected.HostConfig.Tmpfs?.["/tmp"];
  return {
    observed: true,
    memoryBytes: Number(inspected.HostConfig.Memory ?? 0),
    nanoCpus: Number(inspected.HostConfig.NanoCpus ?? 0),
    pidsLimit: Number(inspected.HostConfig.PidsLimit ?? 0),
    networkMode: String(inspected.HostConfig.NetworkMode ?? ""),
    readOnlyRootFilesystem: inspected.HostConfig.ReadonlyRootfs === true,
    workspaceReadOnly: workspaceMount?.RW === false,
    temporaryFilesystemWritable: typeof tmpfs === "string"
      && /(?:^|,)rw(?:,|$)/u.test(tmpfs)
      && !/(?:^|,)ro(?:,|$)/u.test(tmpfs),
    goArtifactReadOnly: goMount?.RW === false,
    goplsArtifactReadOnly: goplsMount?.RW === false,
  };
}

function parseGoplsRssBytes(stdout, goplsCommand) {
  const values = [];
  for (const line of stdout.split(/\r?\n/u).slice(1)) {
    const match = /^\s*\d+\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const command = match[2];
    const args = match[3];
    if (command !== "gopls" && !args.includes(goplsCommand)) continue;
    const rssKiB = Number(match[1]);
    if (Number.isSafeInteger(rssKiB) && rssKiB > 0) values.push(rssKiB * 1024);
  }
  return values;
}

async function countNamedContainers(runtime, containerName, runRuntimeCommand) {
  const runCommand = runRuntimeCommand ?? defaultRunRuntimeCommand;
  const result = await runCommand(runtime, [
    "ps", "--all", "--filter", `name=^/${containerName}$`, "--format", "{{.ID}}",
  ]);
  if (result.exitCode !== 0) throw new Error("OCI residual container probe failed.");
  return result.stdout.split(/\r?\n/u).filter((value) => value.trim()).length;
}

export function defaultRunRuntimeCommand(executable, args, timeoutMs = RUNTIME_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: buildSandboxRuntimeEnvironment(),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (value, chunk) => (
      value + chunk.toString("utf8")
    ).slice(-MAX_RUNTIME_OUTPUT_CHARS);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The runtime child may already have exited while the control plane is hung.
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      finish({ exitCode: null, stdout, stderr });
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });
  });
}

function collectGateFailures(runtime) {
  const inspect = runtime.sandbox.inspect;
  const limits = runtime.sandbox.resourceLimits;
  return [
    ...(runtime.providerAdmissionStatus === "passed" ? [] : ["provider_admission_failed"]),
    ...(runtime.truthSet.passed ? [] : ["truth_set_failed"]),
    ...(runtime.truthSet.lifecycle.passed ? [] : ["lsp_lifecycle_failed"]),
    ...(inspect.observed ? [] : ["container_inspect_failed"]),
    ...(inspect.memoryBytes === limits.memoryBytes ? [] : ["memory_limit_unverified"]),
    ...(inspect.nanoCpus === limits.cpus * 1_000_000_000 ? [] : ["cpu_limit_unverified"]),
    ...(inspect.pidsLimit === limits.pidsLimit ? [] : ["pids_limit_unverified"]),
    ...(inspect.networkMode === "none" ? [] : ["network_isolation_failed"]),
    ...(inspect.readOnlyRootFilesystem ? [] : ["root_filesystem_not_readonly"]),
    ...(inspect.workspaceReadOnly ? [] : ["workspace_not_readonly"]),
    ...(inspect.temporaryFilesystemWritable ? [] : ["temporary_filesystem_not_writable"]),
    ...(inspect.goArtifactReadOnly && inspect.goplsArtifactReadOnly
      ? [] : ["toolchain_mount_not_readonly"]),
    ...(runtime.processMemory.sampleCount > 0
      && runtime.processMemory.goplsRssPeakBytes > 0 ? [] : ["gopls_rss_unobserved"]),
    ...(runtime.processMemory.goplsRssPeakBytes <= runtime.processMemory.hardLimitBytes
      ? [] : ["gopls_rss_limit_exceeded"]),
    ...(runtime.cleanup.leaseCleanupStatus === "removed" ? [] : ["lease_cleanup_failed"]),
    ...(runtime.cleanup.cleanupErrorCount === 0 ? [] : ["cleanup_error_detected"]),
    ...(runtime.cleanup.residualContainerCount === 0 ? [] : ["residual_container_detected"]),
    ...(runtime.cleanup.stateRootCleaned ? [] : ["state_cleanup_failed"]),
    ...(runtime.cleanup.stagingRootCleaned ? [] : ["staging_cleanup_failed"]),
  ];
}

function emptyInspectEvidence() {
  return {
    observed: false,
    memoryBytes: 0,
    nanoCpus: 0,
    pidsLimit: 0,
    networkMode: "",
    readOnlyRootFilesystem: false,
    workspaceReadOnly: false,
    temporaryFilesystemWritable: false,
    goArtifactReadOnly: false,
    goplsArtifactReadOnly: false,
  };
}

function requireOciConfig(input) {
  const config = input.config ?? resolveOciCommandSandboxConfig({ readEnv: input.readEnv });
  if (!config) {
    throw new Error(
      "Go CodeIntel OCI promotion Gate requires an OCI backend, runtime, and digest-pinned image.",
    );
  }
  return config;
}

function requireImageDigest(image) {
  const match = /@(sha256:[a-f0-9]{64})$/u.exec(image);
  if (!match) throw new Error("OCI sandbox image must be digest-pinned.");
  return match[1];
}

function requirePathInside(root, candidate, label) {
  if (!isPathInside(root, candidate)) {
    throw new Error(`${label} must stay inside its declared artifact root.`);
  }
}

function requireAbsolutePath(value, name) {
  const text = requireText(value, name);
  if (!path.isAbsolute(text)) throw new Error(`${name} must be absolute.`);
  return path.resolve(text);
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("Go CodeIntel OCI promotion Gate platform must be windows-native or wsl2-linux.");
  }
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (value !== actual) {
    throw new Error(`Go CodeIntel OCI promotion Gate platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Go CodeIntel OCI promotion Gate generatedAt must be an ISO timestamp.");
  }
  return value;
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  try {
    const args = parseCodeIntelGoOciPromotionGateCliArguments(process.argv.slice(2));
    const report = await runCodeIntelGoOciPromotionGate(args);
    process.stdout.write(`${JSON.stringify({
      outputPath: args.outputPath,
      truthSet: report.truthSet.metrics,
      processMemory: report.processMemory,
      cleanup: report.cleanup,
      gate: report.gate,
      promotion: report.promotion,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
