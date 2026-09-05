import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelGoOciPromotionGateReport,
  createFailFastCodeIntel,
  defaultRunRuntimeCommand,
  parseCodeIntelGoOciPromotionGateCliArguments,
  runCodeIntelGoOciPromotionGate,
  startContainerMonitor,
  stopContainerMonitors,
} from "./run-code-intel-go-oci-promotion-gate.mjs";

const workspaceRoot = path.resolve(".");
const reportSchemaPath = path.join(
  workspaceRoot,
  "benchmarks/code-intel/v1/go-oci-promotion-gate-report.schema.json",
);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

describe("Go CodeIntel OCI promotion Gate", () => {
  it("settles a hung runtime monitor command at its bounded timeout", async () => {
    const startedAt = Date.now();
    const result = await defaultRunRuntimeCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      50,
    );

    expect(result.exitCode).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("stops polling after one runtime monitor command times out", async () => {
    let runtimeCalls = 0;
    const monitor = startContainerMonitor({
      runtime: "docker",
      containerName: "belldandy-command-timeout",
      workspaceRoot: "/var/tmp/workspace",
      goArtifactRoot: "/var/tmp/go",
      goplsArtifactRoot: "/var/tmp/gopls",
      goplsCommand: "/var/tmp/gopls/bin/gopls",
      runRuntimeCommand: async () => {
        runtimeCalls += 1;
        return { exitCode: null, stdout: "", stderr: "timeout" };
      },
    });

    await expect(monitor.stop()).resolves.toMatchObject({
      inspect: { observed: false },
      sampleCount: 0,
    });
    expect(runtimeCalls).toBe(1);
  });

  it.each(["native", "mapped", "wrong-source", "writable", "duplicate", "wrong-type"])("verifies %s mount evidence without accepting path or access drift", async (mode) => {
    const roots = { workspaceRoot: "/mnt/e/task/workspace", goArtifactRoot: "/mnt/e/task/go", goplsArtifactRoot: "/mnt/e/task/gopls" };
    const mounts = Object.values(roots).map((root) => ({
      Type: "bind", Source: mode === "native" ? root : `E:${root.slice(6).replaceAll("/", "\\")}`,
      Destination: root, RW: false,
    }));
    if (mode === "wrong-source") mounts[0].Source = "E:\\other\\workspace";
    if (mode === "writable") mounts[0].RW = true;
    if (mode === "duplicate") mounts.push({ ...mounts[0] });
    if (mode === "wrong-type") mounts[0].Type = "volume";
    const monitor = startContainerMonitor({
      runtime: "docker", containerName: "belldandy-command-mount", ...roots,
      goplsCommand: `${roots.goplsArtifactRoot}/bin/gopls`,
      runRuntimeCommand: async (_runtime, args) => ({ exitCode: 0, stderr: "", stdout: args[0] === "inspect" ? JSON.stringify([{
        HostConfig: { Memory: 134217728, NanoCpus: 1000000000, PidsLimit: 64, NetworkMode: "none",
          ReadonlyRootfs: true, Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=16m" } },
        Mounts: mounts,
      }]) : "PID RSS COMMAND COMMAND\n" }),
    });
    const result = await monitor.stop();
    expect(result.inspect).toMatchObject({
      observed: true, workspaceReadOnly: mode === "native" || mode === "mapped",
      goArtifactReadOnly: true, goplsArtifactReadOnly: true,
    });
  });

  it("settles every owned Host monitor even when one stop fails", async () => {
    const stopped = [];
    await expect(stopContainerMonitors([
      { monitor: { async stop() { stopped.push("first"); } } },
      { monitor: { async stop() { stopped.push("second"); throw new Error("failed"); } } },
      { monitor: { async stop() { stopped.push("third"); } } },
    ])).resolves.toBeUndefined();
    expect(stopped).toEqual(["first", "second", "third"]);
  });

  it("does not call the Provider again after the first truth query failure", async () => {
    let providerCalls = 0;
    let disposed = false;
    const failure = {
      ok: false,
      error: { code: "provider_failure", message: "failed", retryable: true },
    };
    const codeIntel = createFailFastCodeIntel({
      async query() {
        providerCalls += 1;
        return failure;
      },
      async disposeAsync() {
        disposed = true;
      },
    });

    const first = await codeIntel.query({ operation: "symbols" });
    const second = await codeIntel.query({ operation: "definition" });
    expect(first).toEqual(failure);
    expect(second).toEqual(failure);
    expect(second).not.toBe(first);
    expect(providerCalls).toBe(1);
    await codeIntel.disposeAsync();
    expect(disposed).toBe(true);
  });

  it("publishes schema-valid OCI truth, RSS, and cleanup evidence without production promotion", async () => {
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf8"));
    const report = await buildCodeIntelGoOciPromotionGateReport({
      platform: currentPlatform(),
      generatedAt: "2026-08-11T08:00:00.000Z",
      runtimeFactory: async () => passingRuntimeResult(),
    });

    expect(validateAgainstSchema(schema, report)).toMatchObject({ ok: true });
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.promotion).toEqual({
      ociEligible: true,
      goCanaryEligible: false,
      providerAdmissionStatus: "passed",
      productionEligible: false,
    });
    expect(report.execution).toMatchObject({
      containerStarts: 1,
      providerCalls: 6,
      gatewayCalls: 0,
      modelCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    });
  });

  it("fails closed when gopls RSS or resource cleanup evidence is missing", async () => {
    const runtime = passingRuntimeResult();
    runtime.processMemory.goplsRssPeakBytes = 0;
    runtime.processMemory.sampleCount = 0;
    runtime.cleanup.residualContainerCount = 1;
    runtime.cleanup.stagingRootCleaned = false;

    const report = await buildCodeIntelGoOciPromotionGateReport({
      platform: currentPlatform(),
      generatedAt: "2026-08-11T08:00:00.000Z",
      runtimeFactory: async () => runtime,
    });

    expect(report.gate).toEqual({
      passed: false,
      failures: ["gopls_rss_unobserved", "residual_container_detected", "staging_cleanup_failed"],
    });
    expect(report.promotion.ociEligible).toBe(false);
  });

  it("fails closed when the Provider factory admission is not proven", async () => {
    const runtime = passingRuntimeResult();
    runtime.providerAdmissionStatus = "failed";

    const report = await buildCodeIntelGoOciPromotionGateReport({
      platform: currentPlatform(),
      generatedAt: "2026-08-11T08:00:00.000Z",
      runtimeFactory: async () => runtime,
    });

    expect(report.gate).toEqual({ passed: false, failures: ["provider_admission_failed"] });
    expect(report.promotion).toMatchObject({
      ociEligible: false,
      goCanaryEligible: false,
      providerAdmissionStatus: "failed",
      productionEligible: false,
    });
  });

  it("writes once and requires explicit pinned toolchain paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-oci-promotion-report-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "report.json");
    const input = {
      platform: currentPlatform(),
      outputPath,
      generatedAt: "2026-08-11T08:00:00.000Z",
      runtimeFactory: async () => passingRuntimeResult(),
    };

    await expect(runCodeIntelGoOciPromotionGate(input))
      .resolves.toMatchObject({ gate: { passed: true } });
    await expect(runCodeIntelGoOciPromotionGate(input)).rejects.toThrow(/already exists/u);

    const parsed = parseCodeIntelGoOciPromotionGateCliArguments([
      "--platform", currentPlatform(),
      "--output", outputPath,
      "--gopls-command", path.resolve(root, "gopls", "bin", "gopls"),
      "--go-command", path.resolve(root, "go", "bin", "go"),
      "--gopls-artifact-root", path.resolve(root, "gopls"),
      "--go-artifact-root", path.resolve(root, "go"),
    ]);
    expect(parsed).toMatchObject({ platform: currentPlatform(), outputPath });
    expect(() => parseCodeIntelGoOciPromotionGateCliArguments([
      "--platform", currentPlatform(), "--output", outputPath,
    ])).toThrow(/goplsCommand/u);
  });
});

function passingRuntimeResult() {
  return {
    providerAdmissionStatus: "passed",
    truthSet: {
      id: "p1-a2-go-canary-v1",
      manifestSha256: "a".repeat(64),
      sourceAggregateSha256: "b".repeat(64),
      metrics: {
        expected: 10,
        returned: 10,
        truePositive: 10,
        falsePositive: 0,
        falseNegative: 0,
        precision: 1,
        recall: 1,
        passed: true,
      },
      cases: [
        { id: "symbols", operation: "symbols", status: "passed" },
        { id: "definition-1", operation: "definition", status: "passed" },
        { id: "definition-2", operation: "definition", status: "passed" },
        { id: "references-1", operation: "references", status: "passed" },
        { id: "references-2", operation: "references", status: "passed" },
        { id: "implementation", operation: "implementation", status: "passed" },
      ],
      lifecycle: {
        hostCount: 1,
        stoppedHostCount: 1,
        processStartCount: 1,
        unexpectedExitCount: 0,
        requestCount: 6,
        forcedTerminationCount: 0,
        failureCount: 0,
        passed: true,
        timeline: {
          events: [
            { sequence: 1, atMs: 0, kind: "notification_sent", method: "textDocument/didOpen" },
            { sequence: 2, atMs: 1, kind: "request_completed", method: "workspace/symbol", resultCount: 0 },
            { sequence: 3, atMs: 2, kind: "request_completed", method: "textDocument/references", resultCount: 2 },
          ],
          truncated: false,
        },
      },
      passed: true,
    },
    toolchain: {
      go: {
        version: "go1.24.2",
        platform: "linux/amd64",
        command: "/var/tmp/go/bin/go",
        sha256: "c".repeat(64),
        artifactRoot: "/var/tmp/go",
      },
      gopls: {
        version: "v0.21.0",
        command: "/var/tmp/gopls/bin/gopls",
        sha256: "d".repeat(64),
        artifactRoot: "/var/tmp/gopls",
      },
    },
    sandbox: {
      backend: "oci",
      runtime: "docker",
      imageDigest: "sha256:" + "e".repeat(64),
      pullPolicy: "never",
      resourceLimits: {
        memoryBytes: 128 * 1024 * 1024,
        cpus: 1,
        pidsLimit: 64,
        tmpfsBytes: 16 * 1024 * 1024,
      },
      inspect: {
        observed: true,
        memoryBytes: 128 * 1024 * 1024,
        nanoCpus: 1_000_000_000,
        pidsLimit: 64,
        networkMode: "none",
        readOnlyRootFilesystem: true,
        workspaceReadOnly: true,
        temporaryFilesystemWritable: true,
        goArtifactReadOnly: true,
        goplsArtifactReadOnly: true,
      },
    },
    processMemory: {
      hardLimitBytes: 128 * 1024 * 1024,
      goplsRssPeakBytes: 42 * 1024 * 1024,
      sampleCount: 8,
    },
    cleanup: {
      leaseCleanupStatus: "removed",
      cleanupErrorCount: 0,
      residualContainerCount: 0,
      stateRootCleaned: true,
      stagingRootCleaned: true,
    },
    execution: { containerStarts: 1, providerCalls: 6 },
  };
}

function currentPlatform() {
  return process.platform === "win32" ? "windows-native" : "wsl2-linux";
}

function validateAgainstSchema(schema, value) {
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) return compiled;
  return compiled.validator.validateOutput(JSON.stringify(value));
}
