import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelGoOciSandboxGateReport,
  GO_OCI_SANDBOX_RESOURCE_LIMITS,
  parseCodeIntelGoOciSandboxGateCliArguments,
  runCodeIntelGoOciSandboxGate,
} from "./run-code-intel-go-oci-sandbox-gate.mjs";

const workspaceRoot = path.resolve(".");
const reportSchemaPath = path.join(
  workspaceRoot,
  "benchmarks/code-intel/v1/go-oci-sandbox-gate-report.schema.json",
);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

describe("Go CodeIntel OCI sandbox Gate", () => {
  it("publishes a schema-valid passing isolation report without Go or gateway calls", async () => {
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf8"));
    const report = await buildCodeIntelGoOciSandboxGateReport({
      platform: currentPlatform(),
      generatedAt: "2026-08-11T05:00:00.000Z",
      runtimeFactory: async () => passingRuntimeResult(),
    });

    expect(validateAgainstSchema(schema, report)).toMatchObject({ ok: true });
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.promotion).toEqual({
      goToolchainArtifactStatus: "unavailable",
      goCanaryEligible: false,
      productionEligible: false,
    });
    expect(report.execution).toMatchObject({
      containerStarts: 2,
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
      osNetworkIsolationVerified: true,
    });
  });

  it("fails closed when a resource or cleanup probe is not satisfied", async () => {
    const runtime = passingRuntimeResult();
    runtime.probes.memoryCgroup.matchesConfiguredLimit = false;
    runtime.probes.processTree.residualContainerCount = 1;
    runtime.temporaryRootCleaned = false;

    const report = await buildCodeIntelGoOciSandboxGateReport({
      platform: currentPlatform(),
      generatedAt: "2026-08-11T05:00:00.000Z",
      runtimeFactory: async () => runtime,
    });

    expect(report.gate).toEqual({
      passed: false,
      failures: ["memory_limit_unverified", "residual_container_detected", "temporary_root_cleanup_failed"],
    });
  });

  it("writes once and only accepts the host platform with explicit output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-oci-gate-report-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "report.json");
    const input = {
      platform: currentPlatform(),
      outputPath,
      generatedAt: "2026-08-11T05:00:00.000Z",
      runtimeFactory: async () => passingRuntimeResult(),
    };

    await expect(runCodeIntelGoOciSandboxGate(input)).resolves.toMatchObject({ gate: { passed: true } });
    await expect(runCodeIntelGoOciSandboxGate(input)).rejects.toThrow(/already exists/u);
    expect(parseCodeIntelGoOciSandboxGateCliArguments([
      "--platform", currentPlatform(),
      "--output", outputPath,
    ])).toEqual({ platform: currentPlatform(), outputPath });
    expect(() => parseCodeIntelGoOciSandboxGateCliArguments(["--image", "node"]))
      .toThrow(/Unknown argument/u);
  });
});

function passingRuntimeResult() {
  return {
    sandbox: {
      backend: "oci",
      runtime: "docker",
      imageDigest: "sha256:" + "a".repeat(64),
      pullPolicy: "never",
    },
    resourceLimits: { ...GO_OCI_SANDBOX_RESOURCE_LIMITS },
    probes: {
      rootFilesystem: { readOnly: true, writeErrorCode: "EROFS" },
      workspace: { readOnly: true, writeErrorCode: "EROFS" },
      temporaryFilesystem: { writable: true },
      outboundNetwork: { blocked: true, loopbackOnly: true, errorCode: "ENETUNREACH" },
      memoryCgroup: {
        configuredBytes: GO_OCI_SANDBOX_RESOURCE_LIMITS.memoryBytes,
        observedBytes: GO_OCI_SANDBOX_RESOURCE_LIMITS.memoryBytes,
        matchesConfiguredLimit: true,
      },
      processTree: {
        containerStarted: true,
        closeObserved: true,
        leaseCleanupStatus: "removed",
        residualContainerCount: 0,
      },
    },
    temporaryRootCleaned: true,
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
