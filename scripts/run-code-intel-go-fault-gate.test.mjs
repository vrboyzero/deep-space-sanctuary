import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelGoFaultGateReport,
  parseCodeIntelGoFaultGateCliArguments,
  runCodeIntelGoFaultGate,
} from "./run-code-intel-go-fault-gate.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/go-truth-set.json");
const reportSchemaPath = path.join(
  workspaceRoot,
  "benchmarks/code-intel/v1/go-fault-gate-report.schema.json",
);
const fakeGoplsCommand = path.resolve("tools", process.platform === "win32" ? "gopls.exe" : "gopls");
const fakeGoCommand = path.resolve("tools", process.platform === "win32" ? "go.exe" : "go");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Go CodeIntel fault Gate", () => {
  it("publishes a closed passing report for crash, cancellation, and soak", async () => {
    const [schema, report] = await Promise.all([
      readJson(reportSchemaPath),
      buildPassingReport(),
    ]);

    expect(validateAgainstSchema(schema, report)).toMatchObject({ ok: true });
    expect(report.scenarios).toEqual(passingRuntimeResult().scenarios);
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.execution).toMatchObject({
      lspProcesses: 9,
      gatewayCalls: 0,
      modelCalls: 0,
      osNetworkIsolationVerified: false,
      stateRootCleaned: true,
    });
  });

  it("fails closed when a fault scenario or state cleanup fails", async () => {
    const runtime = passingRuntimeResult();
    runtime.scenarios.crashRestart.passed = false;
    runtime.scenarios.soak.passed = false;
    runtime.stateRootCleaned = false;

    const report = await buildCodeIntelGoFaultGateReport(passingInput({
      runtimeFactory: async () => runtime,
    }));

    expect(report.gate).toEqual({
      passed: false,
      failures: [
        "crash_restart_gate_failed",
        "soak_gate_failed",
        "state_cleanup_failed",
      ],
    });
  });

  it("writes once and parses only explicit absolute toolchain inputs", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-fault-report-"));
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const input = passingInput({ outputPath });

    await expect(runCodeIntelGoFaultGate(input)).resolves.toMatchObject({ gate: { passed: true } });
    await expect(runCodeIntelGoFaultGate(input)).rejects.toThrow(/already exists/u);
    expect(parseCodeIntelGoFaultGateCliArguments([
      "--platform", currentPlatform(),
      "--manifest", manifestPath,
      "--output", outputPath,
      "--gopls-command", fakeGoplsCommand,
      "--go-command", fakeGoCommand,
    ])).toEqual({
      platform: currentPlatform(),
      manifestPath,
      outputPath,
      goplsCommand: fakeGoplsCommand,
      goCommand: fakeGoCommand,
    });
    expect(() => parseCodeIntelGoFaultGateCliArguments(["--cycles", "6"]))
      .toThrow(/Unknown argument/u);
  });
});

function buildPassingReport() {
  return buildCodeIntelGoFaultGateReport(passingInput());
}

function passingInput(overrides = {}) {
  return {
    platform: currentPlatform(),
    manifestPath,
    goplsCommand: fakeGoplsCommand,
    goCommand: fakeGoCommand,
    generatedAt: "2026-08-11T03:20:00.000Z",
    runtimeFactory: async () => passingRuntimeResult(),
    ...overrides,
  };
}

function passingRuntimeResult() {
  return {
    provider: {
      id: "gopls",
      version: "v0.21.0",
      goVersion: "go1.24.2",
      platform: process.platform === "win32" ? "windows/amd64" : "linux/amd64",
    },
    resourceLimits: {
      decodedResponseMaxBytes: 4 * 1024 * 1024,
      maxConcurrentRequestsPerHost: 1,
      processMemoryHardLimitBytes: null,
      processMemoryStatus: "unverified",
    },
    scenarios: {
      crashRestart: {
        passed: true,
        recoveryQuerySucceeded: true,
        processStartCount: 2,
        unexpectedExitCount: 1,
        forcedTerminationCount: 0,
        responseRejectedCount: 0,
        concurrencyRejectedCount: 0,
        residualProcessCount: 0,
      },
      cancellation: {
        passed: true,
        cancellationCode: "cancelled",
        recoveryQuerySucceeded: true,
        processStartCount: 2,
        unexpectedExitCount: 0,
        forcedTerminationCount: 1,
        responseRejectedCount: 0,
        concurrencyRejectedCount: 0,
        residualProcessCount: 0,
      },
      soak: {
        passed: true,
        cycles: 5,
        queryCount: 15,
        hostCount: 5,
        stoppedHostCount: 5,
        processStartCount: 5,
        unexpectedExitCount: 0,
        forcedTerminationCount: 0,
        failureCount: 0,
        responsePeakBytes: 5_583,
        responseRejectedCount: 0,
        concurrencyRejectedCount: 0,
        residualProcessCount: 0,
      },
    },
    lspProcesses: 9,
    stateRootCleaned: true,
  };
}

function currentPlatform() {
  return process.platform === "win32" ? "windows-native" : "wsl2-linux";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

function validateAgainstSchema(schema, value) {
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) return compiled;
  return compiled.validator.validateOutput(JSON.stringify(value));
}
