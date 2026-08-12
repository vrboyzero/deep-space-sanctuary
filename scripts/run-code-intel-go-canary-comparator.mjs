import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/dist/coding-run/output-schema.js";

export const CODE_INTEL_GO_CANARY_COMPARATOR_REPORT_VERSION =
  "code-intel-go-canary-comparator-report/v1";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const windowsReportSchemaPath = path.join(
  repositoryRoot,
  "benchmarks/code-intel/v1/go-truth-set-report.schema.json",
);
const ociReportSchemaPath = path.join(
  repositoryRoot,
  "benchmarks/code-intel/v1/go-oci-promotion-gate-report.schema.json",
);
const comparatorSchemaPath = path.join(
  repositoryRoot,
  "benchmarks/code-intel/v1/go-canary-comparator-report.schema.json",
);
const MAX_READINESS_DURATION_MS = 30_000;
const sharedRuntimePaths = Object.freeze([
  "packages/belldandy-skills/src/code-intel/types.ts",
  "packages/belldandy-skills/src/code-intel/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/lsp-process-host.ts",
  "packages/belldandy-skills/src/code-intel/gopls-profile.ts",
  "packages/belldandy-skills/src/code-intel/gopls-provider.ts",
  "packages/belldandy-skills/dist/code-intel/code-intel.js",
  "packages/belldandy-skills/dist/code-intel/lsp-process-host.js",
  "packages/belldandy-skills/dist/code-intel/gopls-profile.js",
  "packages/belldandy-skills/dist/code-intel/gopls-provider.js",
]);

export async function loadCodeIntelGoCanaryComparatorInput(filePath, role) {
  const resolvedPath = path.resolve(requireText(filePath, `${role}ReportPath`));
  const text = await fs.readFile(resolvedPath, "utf8");
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error(`${role} report JSON is invalid.`);
  }
  const schemaPath = role === "windows-native" ? windowsReportSchemaPath : ociReportSchemaPath;
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
  const validation = compileOutputSchema(schema);
  if (!validation.ok || !validation.validator.validateOutput(JSON.stringify(report)).ok) {
    throw new Error(`${role} report Schema validation failed.`);
  }
  return {
    report,
    text,
    sha256: sha256(text),
    path: toReportPath(resolvedPath),
  };
}

export async function buildCodeIntelGoCanaryComparatorReport(input = {}) {
  const generatedAt = requireIsoTimestamp(input.generatedAt ?? new Date().toISOString());
  const windows = requireLoadedInput(input.windowsNative, "windows-native");
  const oci = requireLoadedInput(input.wsl2Oci, "wsl2-linux");
  const windowsReport = windows.report;
  const ociReport = oci.report;
  const failures = [];

  if (windowsReport.platform !== "windows-native" || ociReport.platform !== "wsl2-linux") {
    failures.push("platform_pair_mismatch");
  }
  if (windowsReport.truthSet?.id !== "p1-a2-go-canary-v1"
    || ociReport.truthSet?.id !== "p1-a2-go-canary-v1") {
    failures.push("truth_set_id_mismatch");
  }
  if (windowsReport.truthSet?.manifestSha256 !== ociReport.truthSet?.manifestSha256) {
    failures.push("manifest_identity_mismatch");
  }
  if (windowsReport.sourceIdentity?.aggregateSha256
    !== ociReport.truthSet?.sourceAggregateSha256) {
    failures.push("fixture_identity_mismatch");
  }
  if (windowsReport.provider?.version !== "v0.21.0"
    || ociReport.toolchain?.gopls?.version !== "v0.21.0"
    || windowsReport.provider?.toolchain?.goVersion !== "go1.24.2"
    || ociReport.toolchain?.go?.version !== "go1.24.2") {
    failures.push("toolchain_version_mismatch");
  }
  if (windowsReport.provider?.toolchain?.platform !== "windows/amd64"
    || ociReport.toolchain?.go?.platform !== "linux/amd64") {
    failures.push("toolchain_platform_mismatch");
  }
  if (!sameSharedRuntimeIdentity(windowsReport, ociReport)) {
    failures.push("shared_runtime_identity_mismatch");
  }
  if (!sameTruthCases(windowsReport.cases, ociReport.truthSet?.cases)) {
    failures.push("truth_case_mismatch");
  }
  if (!windowsReport.metrics?.passed || !windowsReport.gate?.passed) {
    failures.push("windows_truth_gate_failed");
  }
  if (!ociReport.truthSet?.metrics?.passed || !ociReport.truthSet?.passed) {
    failures.push("oci_truth_gate_failed");
  }

  if (!windowsReport.lifecycle?.passed) failures.push("windows_lifecycle_gate_failed");
  if (!windowsReport.lifecycle?.responses?.passed) failures.push("windows_response_gate_failed");
  if (!windowsReport.lifecycle?.concurrency?.passed) failures.push("windows_concurrency_gate_failed");
  if (!windowsReport.execution?.stateRootCleaned) failures.push("windows_state_cleanup_failed");

  const providerAdmissionPassed = ociReport.promotion?.providerAdmissionStatus === "passed";
  if (!providerAdmissionPassed) failures.push("oci_provider_admission_failed");
  if (!ociReport.gate?.passed || !ociReport.truthSet?.lifecycle?.passed) {
    failures.push("oci_truth_or_lifecycle_gate_failed");
  }
  if (!ociInspectPassed(ociReport)) failures.push("oci_inspect_failed");
  if (!ociRssPassed(ociReport)) failures.push("oci_rss_failed");
  if (!ociCleanupPassed(ociReport)) failures.push("oci_cleanup_failed");
  if (!readinessTimelinePassed(
    ociReport.truthSet?.lifecycle?.readinessTimeline,
    ociReport.truthSet?.lifecycle?.timeline,
  )) {
    failures.push("oci_readiness_timeline_failed");
  }

  const uniqueFailures = [...new Set(failures)];
  const windowsCases = summarizeCases(windowsReport.cases);
  const ociCases = summarizeCases(ociReport.truthSet?.cases);
  const matchedSharedRuntimeFileCount = countSharedRuntimeFiles(windowsReport, ociReport);
  const comparatorPassed = uniqueFailures.length === 0;
  return {
    schemaVersion: CODE_INTEL_GO_CANARY_COMPARATOR_REPORT_VERSION,
    generatedAt,
    inputs: {
      windowsNative: { reportSha256: windows.sha256 },
      wsl2Oci: { reportSha256: oci.sha256 },
    },
    identity: {
      truthSetId: windowsReport.truthSet?.id ?? "",
      manifestSha256: windowsReport.truthSet?.manifestSha256 ?? "",
      fixtureAggregateSha256: windowsReport.sourceIdentity?.aggregateSha256 ?? "",
      matchedSharedRuntimeFileCount,
    },
    toolchain: {
      goVersion: windowsReport.provider?.toolchain?.goVersion ?? "",
      goplsVersion: windowsReport.provider?.version ?? "",
      windowsPlatform: windowsReport.provider?.toolchain?.platform ?? "",
      ociPlatform: ociReport.toolchain?.go?.platform ?? "",
    },
    truth: {
      caseCount: windowsCases.length,
      positionCount: windowsCases.reduce((sum, item) => sum + item.expected, 0),
      matched: sameTruthCases(windowsReport.cases, ociReport.truthSet?.cases),
    },
    evidence: {
      windowsNative: {
        gatePassed: Boolean(windowsReport.gate?.passed && windowsReport.metrics?.passed),
        lifecyclePassed: Boolean(windowsReport.lifecycle?.passed),
        responsePassed: Boolean(windowsReport.lifecycle?.responses?.passed),
        concurrencyPassed: Boolean(windowsReport.lifecycle?.concurrency?.passed),
        stateCleanupPassed: Boolean(windowsReport.execution?.stateRootCleaned),
      },
      wsl2Oci: {
        gatePassed: Boolean(ociReport.gate?.passed && ociReport.truthSet?.passed),
        providerAdmissionPassed,
        inspectPassed: ociInspectPassed(ociReport),
        rssPassed: ociRssPassed(ociReport),
        cleanupPassed: ociCleanupPassed(ociReport),
        readinessTimelinePassed: readinessTimelinePassed(
          ociReport.truthSet?.lifecycle?.readinessTimeline,
          ociReport.truthSet?.lifecycle?.timeline,
        ),
      },
    },
    gate: { passed: comparatorPassed, failures: uniqueFailures },
    governance: { comparatorPassed, productionEligible: false },
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
  };
}

function readinessTimelinePassed(timeline, rawTimeline) {
  return Boolean(
    rawTimeline?.truncated === false
      && Array.isArray(rawTimeline.events)
      && timeline?.firstDidOpenSentSequence !== null
      && timeline?.firstDidOpenSentSequence < timeline?.readinessStartedSequence
      && timeline?.firstProgressCreatedSequence !== null
      && timeline?.firstProgressCompletedSequence !== null
      && timeline?.firstProgressCompletedSequence < timeline?.firstReferencesStartedSequence
      && timeline?.firstReferencesActiveProgressCount === 0
      && timeline?.referencesAfterReadiness === true
      && timeline?.didOpenBeforeReadiness === true
      && timeline?.progressClosedBeforeFirstReferences === true
      && Number.isSafeInteger(timeline?.readinessDurationMs)
      && timeline.readinessDurationMs >= 0
      && timeline.readinessDurationMs <= MAX_READINESS_DURATION_MS,
  );
}

export async function runCodeIntelGoCanaryComparator(input, dependencies = {}) {
  const outputPath = path.resolve(requireText(input?.outputPath, "outputPath"));
  if (await pathExists(outputPath)) {
    throw new Error(`Go CodeIntel canary comparator output already exists: ${outputPath}`);
  }
  const loadInput = dependencies.loadInput ?? loadCodeIntelGoCanaryComparatorInput;
  const [windowsNative, wsl2Oci] = await Promise.all([
    loadInput(input?.windowsReportPath, "windows-native"),
    loadInput(input?.ociReportPath, "wsl2-linux"),
  ]);
  const report = await buildCodeIntelGoCanaryComparatorReport({
    generatedAt: input?.generatedAt,
    windowsNative,
    wsl2Oci,
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return report;
}

export function parseCodeIntelGoCanaryComparatorCliArguments(argv) {
  const values = {};
  const names = new Map([
    ["--windows-report", "windowsReportPath"],
    ["--oci-report", "ociReportPath"],
    ["--output", "outputPath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = names.get(argument);
    if (!name) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[name] = path.resolve(value);
    index += 1;
  }
  for (const name of ["windowsReportPath", "ociReportPath", "outputPath"]) {
    requireText(values[name], name);
  }
  return values;
}

function requireLoadedInput(value, role) {
  if (!value?.report || typeof value.sha256 !== "string") {
    throw new Error(`${role} comparator input is invalid.`);
  }
  return value;
}

function summarizeCases(cases) {
  return Array.isArray(cases) ? cases.map((item) => ({
    id: item?.id ?? "",
    operation: item?.operation ?? "",
    status: item?.status ?? "",
    expected: item?.expected ?? 0,
    returned: item?.returned ?? 0,
    truePositive: item?.truePositive ?? 0,
    falsePositive: item?.falsePositive ?? 0,
    falseNegative: item?.falseNegative ?? 0,
  })) : [];
}

function sameTruthCases(left, right) {
  return JSON.stringify(summarizeCases(left)) === JSON.stringify(summarizeCases(right))
    && summarizeCases(left).length === 6;
}

function sameSharedRuntimeIdentity(windows, oci) {
  const windowsFiles = new Map((windows.sourceIdentity?.runtimeFiles ?? [])
    .map((file) => [file.path, file.sha256]));
  const ociFiles = new Map((oci.sourceIdentity?.files ?? [])
    .map((file) => [file.path, file.sha256]));
  return sharedRuntimePaths.every((filePath) => windowsFiles.get(filePath) === ociFiles.get(filePath));
}

function countSharedRuntimeFiles(windows, oci) {
  const windowsFiles = new Map((windows.sourceIdentity?.runtimeFiles ?? [])
    .map((file) => [file.path, file.sha256]));
  const ociFiles = new Map((oci.sourceIdentity?.files ?? [])
    .map((file) => [file.path, file.sha256]));
  return sharedRuntimePaths.filter((filePath) => windowsFiles.get(filePath) === ociFiles.get(filePath)).length;
}

function ociInspectPassed(report) {
  const inspect = report.sandbox?.inspect;
  const limits = report.sandbox?.resourceLimits;
  return Boolean(
    inspect?.observed
      && inspect.memoryBytes === limits?.memoryBytes
      && inspect.nanoCpus === limits?.cpus * 1_000_000_000
      && inspect.pidsLimit === limits?.pidsLimit
      && inspect.networkMode === "none"
      && inspect.readOnlyRootFilesystem
      && inspect.workspaceReadOnly
      && inspect.temporaryFilesystemWritable
      && inspect.goArtifactReadOnly
      && inspect.goplsArtifactReadOnly,
  );
}

function ociRssPassed(report) {
  return report.processMemory?.status === "observed_below_hard_limit"
    && report.processMemory.sampleCount > 0
    && report.processMemory.goplsRssPeakBytes > 0
    && report.processMemory.goplsRssPeakBytes <= report.processMemory.hardLimitBytes;
}

function ociCleanupPassed(report) {
  const cleanup = report.cleanup;
  return Boolean(cleanup?.leaseCleanupStatus === "removed"
    && cleanup.cleanupErrorCount === 0
    && cleanup.residualContainerCount === 0
    && cleanup.stateRootCleaned
    && cleanup.stagingRootCleaned);
}

function toReportPath(filePath) {
  const relative = path.relative(repositoryRoot, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    ? relative.split(path.sep).join("/")
    : filePath;
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("Go CodeIntel comparator generatedAt must be an ISO timestamp.");
  }
  return value;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required.`);
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  try {
    const args = parseCodeIntelGoCanaryComparatorCliArguments(process.argv.slice(2));
    const report = await runCodeIntelGoCanaryComparator(args);
    process.stdout.write(`${JSON.stringify({
      outputPath: args.outputPath,
      gate: report.gate,
      governance: report.governance,
    })}\n`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
