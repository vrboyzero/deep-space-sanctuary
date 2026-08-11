import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelGoOciPromotionGateReport,
  parseCodeIntelGoOciPromotionGateCliArguments,
  runCodeIntelGoOciPromotionGate,
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
