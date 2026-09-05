import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODE_INTEL_GO_CANARY_COMPARATOR_REPORT_VERSION,
  buildCodeIntelGoCanaryComparatorReport,
  loadCodeIntelGoCanaryComparatorInput,
  parseCodeIntelGoCanaryComparatorCliArguments,
  runCodeIntelGoCanaryComparator,
} from "./run-code-intel-go-canary-comparator.mjs";

const workspaceRoot = path.resolve(".");
const reportSchemaPath = path.join(
  workspaceRoot,
  "benchmarks/code-intel/v1/go-canary-comparator-report.schema.json",
);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

describe("Go CodeIntel canary comparator", () => {
  it("publishes a schema-valid safe summary when native and OCI evidence agree", async () => {
    const reports = passingReports();
    const report = await buildCodeIntelGoCanaryComparatorReport({
      generatedAt: "2026-08-12T10:00:00.000Z",
      windowsNative: source(reports.windowsNative),
      wsl2Oci: source(reports.wsl2Oci),
    });
    const schema = JSON.parse(await fs.readFile(reportSchemaPath, "utf8"));

    expect(validateAgainstSchema(schema, report)).toMatchObject({ ok: true });
    expect(report).toMatchObject({
      schemaVersion: CODE_INTEL_GO_CANARY_COMPARATOR_REPORT_VERSION,
      identity: {
        truthSetId: "p1-a2-go-canary-v1",
        matchedSharedRuntimeFileCount: 9,
      },
      toolchain: {
        goVersion: "go1.24.2",
        goplsVersion: "v0.21.0",
        windowsPlatform: "windows/amd64",
        ociPlatform: "linux/amd64",
      },
      truth: {
        caseCount: 6,
        positionCount: 10,
        matched: true,
      },
      evidence: {
        windowsNative: {
          gatePassed: true,
          lifecyclePassed: true,
          responsePassed: true,
          concurrencyPassed: true,
          stateCleanupPassed: true,
        },
        wsl2Oci: {
          gatePassed: true,
          providerAdmissionPassed: true,
          inspectPassed: true,
          rssPassed: true,
          cleanupPassed: true,
          readinessTimelinePassed: true,
        },
      },
      gate: { passed: true, failures: [] },
      governance: {
        comparatorPassed: true,
        productionEligible: false,
      },
      execution: {
        mode: "read-only",
        gatewayCalls: 0,
        modelCalls: 0,
        providerCalls: 0,
        containerStarts: 0,
        networkCalls: 0,
        credentialsRead: false,
        workspaceMutations: 0,
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("command");
    expect(serialized).not.toContain("timeline");
    expect(serialized).not.toContain("source text");
  });

  it("fails closed on platform, identity, truth, lifecycle, OCI, and readiness drift", async () => {
    const reports = passingReports();
    reports.windowsNative.platform = "wsl2-linux";
    reports.windowsNative.gate.passed = false;
    reports.windowsNative.lifecycle.responses.passed = false;
    reports.windowsNative.lifecycle.concurrency.passed = false;
    reports.windowsNative.execution.stateRootCleaned = false;
    reports.wsl2Oci.truthSet.manifestSha256 = "9".repeat(64);
    reports.wsl2Oci.truthSet.sourceAggregateSha256 = "8".repeat(64);
    reports.wsl2Oci.truthSet.cases[0].returned = 0;
    reports.wsl2Oci.toolchain.go.version = "go1.24.1";
    reports.wsl2Oci.sourceIdentity.files.find(
      (file) => file.path.endsWith("gopls-provider.js"),
    ).sha256 = "7".repeat(64);
    reports.wsl2Oci.promotion.providerAdmissionStatus = "failed";
    reports.wsl2Oci.sandbox.inspect.networkMode = "bridge";
    reports.wsl2Oci.processMemory.status = "unverified";
    reports.wsl2Oci.cleanup.residualContainerCount = 1;
    reports.wsl2Oci.truthSet.lifecycle.readinessTimeline.referencesAfterReadiness = false;
    reports.wsl2Oci.truthSet.lifecycle.readinessTimeline.progressClosedBeforeFirstReferences = false;

    const report = await buildCodeIntelGoCanaryComparatorReport({
      generatedAt: "2026-08-12T10:00:00.000Z",
      windowsNative: source(reports.windowsNative),
      wsl2Oci: source(reports.wsl2Oci),
    });

    expect(report.gate.passed).toBe(false);
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "platform_pair_mismatch",
      "windows_truth_gate_failed",
      "windows_response_gate_failed",
      "windows_concurrency_gate_failed",
      "windows_state_cleanup_failed",
      "manifest_identity_mismatch",
      "fixture_identity_mismatch",
      "truth_case_mismatch",
      "toolchain_version_mismatch",
      "shared_runtime_identity_mismatch",
      "oci_provider_admission_failed",
      "oci_inspect_failed",
      "oci_rss_failed",
      "oci_cleanup_failed",
      "oci_readiness_timeline_failed",
    ]));
    expect(report.governance).toEqual({
      comparatorPassed: false,
      productionEligible: false,
    });
  });

  it("fails closed when both platforms omit the same shared runtime file", async () => {
    const reports = passingReports();
    reports.windowsNative.sourceIdentity.runtimeFiles.pop();
    reports.wsl2Oci.sourceIdentity.files.pop();
    const report = await buildCodeIntelGoCanaryComparatorReport({
      windowsNative: source(reports.windowsNative),
      wsl2Oci: source(reports.wsl2Oci),
    });

    expect(report.gate.passed).toBe(false);
    expect(report.gate.failures).toContain("shared_runtime_identity_mismatch");
    expect(report.identity.matchedSharedRuntimeFileCount).toBe(8);
  });

  it("fails closed when readiness duration exceeds the bounded query window", async () => {
    const reports = passingReports();
    reports.wsl2Oci.truthSet.lifecycle.readinessTimeline.readinessDurationMs = 30_001;
    const report = await buildCodeIntelGoCanaryComparatorReport({
      generatedAt: "2026-08-12T10:00:00.000Z",
      windowsNative: source(reports.windowsNative),
      wsl2Oci: source(reports.wsl2Oci),
    });
    expect(report.gate.passed).toBe(false);
    expect(report.gate.failures).toContain("oci_readiness_timeline_failed");
  });

  it("fails closed when the bounded timeline was truncated", async () => {
    const reports = passingReports();
    reports.wsl2Oci.truthSet.lifecycle.timeline.truncated = true;
    const report = await buildCodeIntelGoCanaryComparatorReport({
      generatedAt: "2026-08-12T10:00:00.000Z",
      windowsNative: source(reports.windowsNative),
      wsl2Oci: source(reports.wsl2Oci),
    });
    expect(report.gate.passed).toBe(false);
    expect(report.gate.failures).toContain("oci_readiness_timeline_failed");
  });

  it("writes once, binds exact input bytes, and rejects input Schema violations", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-canary-comparator-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "comparator.json");
    const reports = passingReports();
    const windowsSource = source(reports.windowsNative);
    const ociSource = source(reports.wsl2Oci);
    const loadInput = async (_filePath, role) => role === "windows-native"
      ? windowsSource
      : ociSource;

    const report = await runCodeIntelGoCanaryComparator({
      windowsReportPath: path.join(root, "windows.json"),
      ociReportPath: path.join(root, "oci.json"),
      outputPath,
      generatedAt: "2026-08-12T10:00:00.000Z",
    }, { loadInput });

    expect(report.inputs.windowsNative.reportSha256).toBe(windowsSource.sha256);
    expect(report.inputs.wsl2Oci.reportSha256).toBe(ociSource.sha256);
    expect(JSON.parse(await fs.readFile(outputPath, "utf8"))).toMatchObject({
      schemaVersion: CODE_INTEL_GO_CANARY_COMPARATOR_REPORT_VERSION,
      gate: { passed: true },
    });
    await expect(runCodeIntelGoCanaryComparator({
      windowsReportPath: path.join(root, "windows.json"),
      ociReportPath: path.join(root, "oci.json"),
      outputPath,
    }, { loadInput })).rejects.toThrow(/already exists/u);

    const invalidPath = path.join(root, "invalid.json");
    await fs.writeFile(invalidPath, "{}\n", "utf8");
    await expect(loadCodeIntelGoCanaryComparatorInput(invalidPath, "windows-native"))
      .rejects.toThrow(/Schema validation failed/u);
  });

  it("parses only explicit input and output paths", () => {
    expect(parseCodeIntelGoCanaryComparatorCliArguments([
      "--windows-report", "windows.json",
      "--oci-report", "oci.json",
      "--output", "comparator.json",
    ])).toEqual({
      windowsReportPath: path.resolve("windows.json"),
      ociReportPath: path.resolve("oci.json"),
      outputPath: path.resolve("comparator.json"),
    });
    expect(() => parseCodeIntelGoCanaryComparatorCliArguments(["--unknown", "value"]))
      .toThrow(/Unknown argument/u);
    expect(() => parseCodeIntelGoCanaryComparatorCliArguments([
      "--windows-report", "windows.json",
      "--output", "comparator.json",
    ])).toThrow(/ociReportPath/u);
  });
});

function passingReports() {
  const sharedRuntimeFiles = sharedRuntimePaths().map((filePath, index) => ({
    path: filePath,
    sha256: String(index + 1).repeat(64),
  }));
  const cases = [
    caseSummary("symbols.build-tagged-feature", "symbols", 1),
    caseSummary("definition.cross-module-build-message", "definition", 1),
    caseSummary("definition.build-tagged-feature", "definition", 1),
    caseSummary("references.cross-module-build-message", "references", 4),
    caseSummary("references.go-work-interface", "references", 2),
    caseSummary("implementation.go-work-interface-method", "implementation", 1),
  ];
  const lifecycle = {
    hostCount: 1,
    stoppedHostCount: 1,
    processStartCount: 1,
    unexpectedExitCount: 0,
    requestCount: 6,
    forcedTerminationCount: 0,
    failureCount: 0,
    responses: {
      maxBytes: 4 * 1024 * 1024,
      peakBytes: 5_583,
      rejectedCount: 0,
      passed: true,
    },
    concurrency: {
      maxRequestsPerHost: 1,
      peakActiveRequests: 1,
      rejectedCount: 0,
      passed: true,
    },
    passed: true,
  };
  return {
    windowsNative: {
      schemaVersion: "code-intel-go-truth-set-report/v1",
      platform: "windows-native",
      truthSet: {
        id: "p1-a2-go-canary-v1",
        manifestSha256: "a".repeat(64),
      },
      sourceIdentity: {
        aggregateSha256: "b".repeat(64),
        runtimeFiles: sharedRuntimeFiles.map((file) => ({ ...file })),
      },
      provider: {
        id: "gopls",
        version: "v0.21.0",
        toolchain: { goVersion: "go1.24.2", platform: "windows/amd64" },
      },
      governance: { productionEligible: false },
      metrics: metrics(),
      cases: cases.map((item) => ({ ...item, precision: 1, recall: 1, items: [] })),
      lifecycle,
      gate: { passed: true, failures: [] },
      execution: {
        gatewayCalls: 0,
        modelCalls: 0,
        credentialsRead: false,
        workspaceMutations: 0,
        stateRootCleaned: true,
      },
    },
    wsl2Oci: {
      schemaVersion: "code-intel-go-oci-promotion-gate-report/v1",
      platform: "wsl2-linux",
      sourceIdentity: { files: sharedRuntimeFiles.map((file) => ({ ...file })) },
      truthSet: {
        id: "p1-a2-go-canary-v1",
        manifestSha256: "a".repeat(64),
        sourceAggregateSha256: "b".repeat(64),
        metrics: metrics(),
        cases,
        lifecycle: {
          ...lifecycle,
          requestCount: 7,
          timeline: {
            truncated: false,
            events: [
              { sequence: 1, atMs: 1, kind: "notification_started", method: "textDocument/didOpen" },
              { sequence: 2, atMs: 2, kind: "notification_sent", method: "textDocument/didOpen" },
              { sequence: 3, atMs: 3, kind: "readiness_started" },
              { sequence: 4, atMs: 4, kind: "work_done_progress_created", activeProgressCount: 0 },
              { sequence: 5, atMs: 5, kind: "work_done_progress_end", activeProgressCount: 0 },
              { sequence: 6, atMs: 6, kind: "readiness_completed" },
              { sequence: 7, atMs: 7, kind: "request_started", method: "textDocument/references", activeProgressCount: 0 },
              { sequence: 8, atMs: 8, kind: "request_completed", method: "textDocument/references", resultCount: 4 },
            ],
          },
          readinessTimeline: {
            firstDidOpenStartedSequence: 1,
            firstDidOpenSentSequence: 2,
            readinessStartedSequence: 3,
            readinessCompletedSequence: 6,
            firstProgressCreatedSequence: 4,
            firstProgressCompletedSequence: 5,
            firstReferencesStartedSequence: 7,
            firstReferencesCompletedSequence: 8,
            firstReferencesActiveProgressCount: 0,
            lateProgressCreatedCount: 1,
            referencesAfterReadiness: true,
            didOpenBeforeReadiness: true,
            progressClosedBeforeFirstReferences: true,
            readinessDurationMs: 3,
          },
        },
        passed: true,
      },
      toolchain: {
        go: { version: "go1.24.2", platform: "linux/amd64", sha256: "c".repeat(64) },
        gopls: { version: "v0.21.0", sha256: "d".repeat(64) },
      },
      sandbox: {
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
        goplsRssPeakBytes: 124_932_096,
        sampleCount: 45,
        status: "observed_below_hard_limit",
      },
      cleanup: {
        leaseCleanupStatus: "removed",
        cleanupErrorCount: 0,
        residualContainerCount: 0,
        stateRootCleaned: true,
        stagingRootCleaned: true,
      },
      gate: { passed: true, failures: [] },
      promotion: {
        ociEligible: true,
        goCanaryEligible: false,
        providerAdmissionStatus: "passed",
        productionEligible: false,
      },
      execution: {
        gatewayCalls: 0,
        modelCalls: 0,
        credentialsRead: false,
        workspaceMutations: 0,
        osNetworkIsolationVerified: true,
      },
    },
  };
}

function sharedRuntimePaths() {
  return [
    "packages/belldandy-skills/src/code-intel/types.ts",
    "packages/belldandy-skills/src/code-intel/code-intel.ts",
    "packages/belldandy-skills/src/code-intel/lsp-process-host.ts",
    "packages/belldandy-skills/src/code-intel/gopls-profile.ts",
    "packages/belldandy-skills/src/code-intel/gopls-provider.ts",
    "packages/belldandy-skills/dist/code-intel/code-intel.js",
    "packages/belldandy-skills/dist/code-intel/lsp-process-host.js",
    "packages/belldandy-skills/dist/code-intel/gopls-profile.js",
    "packages/belldandy-skills/dist/code-intel/gopls-provider.js",
  ];
}

function caseSummary(id, operation, expected) {
  return {
    id,
    operation,
    status: "passed",
    expected,
    returned: expected,
    truePositive: expected,
    falsePositive: 0,
    falseNegative: 0,
    errorCode: null,
  };
}

function metrics() {
  return {
    expected: 10,
    returned: 10,
    truePositive: 10,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    passed: true,
  };
}

function source(report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  return { report, text, sha256: crypto.createHash("sha256").update(text).digest("hex") };
}

function validateAgainstSchema(schema, value) {
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) return compiled;
  return compiled.validator.validateOutput(JSON.stringify(value));
}
