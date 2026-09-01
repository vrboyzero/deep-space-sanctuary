import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCodingAgentBenchmarkReport,
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export const CODING_AGENT_BASELINE_INDEX_VERSION = "coding-agent-benchmark-baseline-index/v1";
export const CODING_AGENT_EXPECTED_REPORT_PLAN_VERSION =
  "coding-agent-benchmark-expected-report-plan/v1";
export const CODING_AGENT_EXPECTED_REPORT_EVIDENCE_VERSION =
  "coding-agent-benchmark-expected-reports/v1";
export const CODING_AGENT_EXPECTED_REPORT_PROJECTION_VERSION =
  "coding-agent-benchmark-expected-report-projection/v1";
const CODING_AGENT_EXPECTED_REPORT_PLAN_PATH = "expected-reports.json";

export async function aggregateCodingAgentBenchmarkReports(input) {
  const manifestPath = resolveCodingAgentBenchmarkAggregationManifestPath(input);
  const reportPaths = normalizeReportPaths(input?.reportPaths);
  const outputRoot = input?.outputRoot ? path.resolve(input.outputRoot) : null;
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  const writeOutput = input?.writeOutput !== false;

  if (writeOutput && !outputRoot) {
    throw new Error("Coding benchmark aggregation requires outputRoot unless writeOutput is false.");
  }
  if (writeOutput) await assertMissingOutputRoot(outputRoot);

  const [manifestText, manifest] = await Promise.all([
    fs.readFile(manifestPath, "utf-8"),
    loadCodingAgentBenchmarkManifest(manifestPath),
  ]);
  const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
  const expectedReportPlan = input?.expectedReportPlan === undefined
    ? undefined
    : validateExpectedReportPlan(input.expectedReportPlan, manifestSha256, reportPaths);
  const expectedReportIdByPath = new Map(
    expectedReportPlan?.reports.map((report) => [pathIdentity(report.path), report.reportId]),
  );
  const inputReports = [];
  for (const reportPath of reportPaths) {
    inputReports.push({
      ...await readInputReport({ reportPath, manifest, manifestSha256 }),
      ...(expectedReportPlan
        ? { reportId: expectedReportIdByPath.get(pathIdentity(reportPath)) }
        : {}),
    });
  }

  const source = inputReports[0].report.source;
  const harness = inputReports[0].report.harness;
  for (const inputReport of inputReports.slice(1)) {
    assertSameIdentity(source, inputReport.report.source, inputReport.reportPath, "source");
    if (requiresHarnessIdentity(manifest)) {
      assertSameIdentity(harness, inputReport.report.harness, inputReport.reportPath, "harness");
    }
  }

  const runs = sortRuns(inputReports.flatMap((inputReport) => inputReport.report.runs), manifest);
  assertUniqueRunAttempts(runs);
  const coverage = createCoverage(manifest, runs);
  const report = createCodingAgentBenchmarkReport({
    status: coverage.missingRunKeys.length === 0 ? "completed" : "partial",
    generatedAt,
    manifest,
    manifestSha256,
    ...(harness ? { harness } : {}),
    source,
    runs,
  });
  const reportText = serializeJson(report);
  const retainedExpectedReportPlan = expectedReportPlan
    ? createRetainedExpectedReportPlan(expectedReportPlan)
    : undefined;
  const expectedReportPlanText = retainedExpectedReportPlan
    ? serializeJson(retainedExpectedReportPlan)
    : undefined;
  const baselineIndex = createBaselineIndex({
    manifest,
    manifestSha256,
    report,
    reportText,
    coverage,
    ...(retainedExpectedReportPlan ? {
      expectedReports: createExpectedReportProjection({
        plan: retainedExpectedReportPlan,
        collectedReportIds: inputReports.map((inputReport) => inputReport.reportId),
        planText: expectedReportPlanText,
      }),
    } : {}),
    inputReports,
  });

  if (writeOutput) {
    await writeBaselineOutput({
      outputRoot,
      manifestText,
      reportText,
      baselineIndex,
      expectedReportPlanText,
      inputReports,
    });
  }

  return { report, baselineIndex };
}

export function resolveCodingAgentBenchmarkAggregationManifestPath(input = {}) {
  if (input?.manifestPath !== undefined && input?.manifestRevision !== undefined) {
    throw new Error("Coding benchmark aggregation cannot combine manifestPath with manifestRevision.");
  }
  if (input?.manifestPath !== undefined) {
    return path.resolve(requireInput(input.manifestPath, "manifestPath"));
  }
  return path.resolve(resolveCodingAgentBenchmarkManifestPath(input?.manifestRevision ?? "v1"));
}

export function createCodingAgentBenchmarkExpectedReportPlan(input) {
  const manifestSha256 = requireSha256(input?.manifestSha256, "expected report manifestSha256");
  if (!Array.isArray(input?.reports) || input.reports.length === 0 || input.reports.length > 256) {
    throw new Error("Coding benchmark expected report plan requires 1 to 256 reports.");
  }
  const reports = input.reports.map((report) => ({
    reportId: requireReportId(report?.reportId),
    path: path.resolve(requireInput(report?.path, "expected report path")),
  })).sort((left, right) => left.reportId.localeCompare(right.reportId));
  if (new Set(reports.map((report) => report.reportId)).size !== reports.length) {
    throw new Error("Coding benchmark expected report plan reportId values must be unique.");
  }
  if (new Set(reports.map((report) => pathIdentity(report.path))).size !== reports.length) {
    throw new Error("Coding benchmark expected report plan paths must be unique.");
  }
  return {
    schemaVersion: CODING_AGENT_EXPECTED_REPORT_PLAN_VERSION,
    manifestSha256,
    reports,
  };
}

export async function loadCodingAgentBenchmarkExpectedReportPlanFile(planPathInput) {
  const planPath = path.resolve(requireInput(planPathInput, "expected report plan path"));
  const stats = await fs.lstat(planPath).catch(() => null);
  if (!stats?.isFile() || stats.size > 1024 * 1024) {
    throw new Error("Coding benchmark expected report plan must be a regular file no larger than 1 MiB.");
  }
  const parsed = parseJson(await fs.readFile(planPath, "utf-8"), planPath);
  if (parsed?.schemaVersion !== CODING_AGENT_EXPECTED_REPORT_PLAN_VERSION
    || Object.keys(parsed).some((key) => {
      return key !== "schemaVersion" && key !== "manifestSha256" && key !== "reports";
    })
    || !Array.isArray(parsed.reports)
    || parsed.reports.some((report) => {
      return !report || typeof report !== "object" || Object.keys(report).some((key) => {
        return key !== "reportId" && key !== "path";
      });
    })) {
    throw new Error("Coding benchmark expected report plan file does not match its versioned contract.");
  }
  const planRoot = path.dirname(planPath);
  return createCodingAgentBenchmarkExpectedReportPlan({
    ...parsed,
    reports: parsed.reports.map((report) => ({
      ...report,
      path: path.resolve(planRoot, requireInput(report.path, "expected report path")),
    })),
  });
}

export async function verifyCodingAgentBaselineArtifact(input) {
  const outputRoot = path.resolve(requireInput(input?.outputRoot, "outputRoot"));
  const manifestPath = path.join(outputRoot, "task-manifest.json");
  const reportPath = path.join(outputRoot, "benchmark-report.json");
  const indexPath = path.join(outputRoot, "baseline-index.json");
  const [manifestText, manifest, reportText, indexText] = await Promise.all([
    fs.readFile(manifestPath, "utf-8"),
    loadCodingAgentBenchmarkManifest(manifestPath),
    fs.readFile(reportPath, "utf-8"),
    fs.readFile(indexPath, "utf-8"),
  ]);
  const report = parseJson(reportText, reportPath);
  const baselineIndex = parseJson(indexText, indexPath);
  const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);

  if (baselineIndex?.schemaVersion !== CODING_AGENT_BASELINE_INDEX_VERSION) {
    throw new Error("Coding benchmark baseline index has an unsupported schema version.");
  }
  if (baselineIndex?.manifestSha256 !== manifestSha256) {
    throw new Error("Coding benchmark baseline index manifest hash does not match task-manifest.json.");
  }
  if (baselineIndex?.report?.path !== "benchmark-report.json" || baselineIndex.report.sha256 !== sha256(reportText)) {
    throw new Error("Coding benchmark baseline index report hash does not match benchmark-report.json.");
  }
  if (!Array.isArray(baselineIndex?.inputs) || baselineIndex.inputs.length === 0) {
    throw new Error("Coding benchmark baseline index must retain at least one source report.");
  }
  const inputReports = [];
  for (const item of baselineIndex.inputs) {
    if (!isSafeRelativePath(item?.path) || typeof item?.sha256 !== "string") {
      throw new Error("Coding benchmark baseline index contains an invalid source report reference.");
    }
    const sourcePath = resolveInside(outputRoot, item.path);
    const sourceText = await fs.readFile(sourcePath, "utf-8");
    if (sha256(sourceText) !== item.sha256) {
      throw new Error(`Coding benchmark source report hash drifted: ${item.path}.`);
    }
    const sourceReport = parseJson(sourceText, sourcePath);
    assertInputReportMetadata({
      report: sourceReport,
      reportPath: sourcePath,
      manifest,
      manifestSha256,
    });
    inputReports.push({
      report: sourceReport,
      reportPath: sourcePath,
      ...(item.reportId ? { reportId: item.reportId } : {}),
    });
  }

  const source = inputReports[0].report.source;
  const harness = inputReports[0].report.harness;
  for (const inputReport of inputReports.slice(1)) {
    assertSameIdentity(source, inputReport.report.source, inputReport.reportPath, "source");
    if (requiresHarnessIdentity(manifest)) {
      assertSameIdentity(harness, inputReport.report.harness, inputReport.reportPath, "harness");
    }
  }
  const runs = sortRuns(inputReports.flatMap((inputReport) => inputReport.report.runs), manifest);
  assertUniqueRunAttempts(runs);
  const coverage = createCoverage(manifest, runs);
  const expectedReport = createCodingAgentBenchmarkReport({
    status: coverage.missingRunKeys.length === 0 ? "completed" : "partial",
    generatedAt: report.generatedAt,
    manifest,
    manifestSha256,
    ...(harness ? { harness } : {}),
    source,
    runs,
  });
  const expectedReportText = serializeJson(expectedReport);
  if (expectedReportText !== reportText) {
    throw new Error("Coding benchmark report cannot be reconstructed from its retained source reports.");
  }

  const verifiedInputReports = [];
  for (const inputReport of inputReports) {
    verifiedInputReports.push({
      ...inputReport,
      serialized: await fs.readFile(inputReport.reportPath, "utf-8"),
    });
  }
  const expectedReports = await validateExpectedReportProjection({
    value: baselineIndex.expectedReports,
    inputs: baselineIndex.inputs,
    outputRoot,
    manifestSha256,
  });
  const expectedIndex = createBaselineIndex({
    manifest,
    manifestSha256,
    report: expectedReport,
    reportText: expectedReportText,
    coverage,
    ...(expectedReports ? { expectedReports } : {}),
    inputReports: verifiedInputReports,
  });
  if (serializeJson(expectedIndex) !== indexText) {
    throw new Error("Coding benchmark baseline index cannot be reconstructed from retained evidence.");
  }

  for (const run of report.runs) {
    for (const artifactPath of Object.values(run.artifacts)) {
      const target = resolveInside(outputRoot, artifactPath);
      const stats = await fs.lstat(target).catch(() => null);
      if (!stats?.isFile()) {
        throw new Error(`Coding benchmark artifact is not a regular file: ${artifactPath}.`);
      }
    }
  }

  return { report, baselineIndex };
}

function normalizeReportPaths(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Coding benchmark aggregation requires at least one --report path.");
  }
  const resolved = value.map((item) => path.resolve(requireInput(item, "reportPath")));
  if (new Set(resolved).size !== resolved.length) {
    throw new Error("Coding benchmark aggregation received a duplicate report path.");
  }
  return resolved;
}

async function readInputReport(input) {
  const serialized = await fs.readFile(input.reportPath, "utf-8");
  const report = parseJson(serialized, input.reportPath);
  assertInputReportMetadata({ ...input, report });
  if (!Array.isArray(report.runs) || report.runs.length === 0) {
    throw new Error(`Coding benchmark source report has no runs: ${input.reportPath}.`);
  }
  const reportRoot = path.dirname(input.reportPath);
  for (const run of report.runs) {
    if (!run?.artifacts || typeof run.artifacts !== "object") {
      throw new Error(`Coding benchmark source report has an invalid run artifact map: ${input.reportPath}.`);
    }
    for (const artifactPath of Object.values(run.artifacts)) {
      const sourcePath = resolveInside(reportRoot, artifactPath);
      const stats = await fs.lstat(sourcePath).catch(() => null);
      if (!stats?.isFile()) {
        throw new Error(`Coding benchmark source artifact is not a regular file: ${sourcePath}.`);
      }
    }
  }
  return { report, reportPath: input.reportPath, reportRoot, serialized };
}

function assertInputReportMetadata(input) {
  const { report, reportPath, manifest, manifestSha256 } = input;
  if (report?.schemaVersion !== manifest.suite.reportSchemaVersion) {
    throw new Error(`Coding benchmark source report has an unsupported schema version: ${reportPath}.`);
  }
  if (report?.benchmark?.id !== manifest.suite.id
    || report.benchmark.mode !== "report_only"
    || report.benchmark.thresholdApplied !== false) {
    throw new Error(`Coding benchmark source report benchmark metadata drifted: ${reportPath}.`);
  }
  if (report?.suite?.manifestSchemaVersion !== manifest.schemaVersion
    || report.suite.manifestSha256 !== manifestSha256
    || report.suite.sampleRuns !== manifest.suite.sampleRuns
    || JSON.stringify(report.suite.requiredPlatforms) !== JSON.stringify(manifest.suite.requiredPlatforms)) {
    throw new Error(`Coding benchmark source report manifest metadata drifted: ${reportPath}.`);
  }
}

function assertSameIdentity(expected, actual, reportPath, label) {
  const equal = expected?.commit === actual?.commit
    && expected?.workspaceDirty === actual?.workspaceDirty
    && expected?.lockfileSha256 === actual?.lockfileSha256
    && expected?.worktreeContentSha256 === actual?.worktreeContentSha256;
  if (!equal) {
    throw new Error(`Coding benchmark ${label} identity drifted: ${reportPath}.`);
  }
}

function requiresHarnessIdentity(manifest) {
  return manifest?.schemaVersion === "coding-agent-benchmark-manifest/v2"
    || manifest?.schemaVersion === "coding-agent-benchmark-manifest/v3";
}

function assertUniqueRunAttempts(runs) {
  const seenAttempts = new Set();
  const seenRunIds = new Set();
  for (const run of runs) {
    const attemptKey = `${run.taskId}\0${run.platform}\0${run.attempt}`;
    if (seenAttempts.has(attemptKey)) {
      throw new Error(`Coding benchmark aggregation has duplicate run attempt: ${run.taskId}/${run.platform}/${run.attempt}.`);
    }
    if (seenRunIds.has(run.runId)) {
      throw new Error(`Coding benchmark aggregation has duplicate runId: ${run.runId}.`);
    }
    seenAttempts.add(attemptKey);
    seenRunIds.add(run.runId);
  }
}

function createCoverage(manifest, runs) {
  const runsByKey = new Map(runs.map((run) => [runKey(run), run]));
  const missingRunKeys = [];
  const tasks = manifest.tasks.map((task) => ({
    taskId: task.id,
    platforms: task.platforms.map((platform) => ({
      platform,
      attempts: Array.from({ length: manifest.suite.sampleRuns }, (_, index) => {
        const attempt = index + 1;
        const run = runsByKey.get(runKey({ taskId: task.id, platform, attempt }));
        if (!run) {
          missingRunKeys.push(`${task.id}/${platform}/${attempt}`);
          return { attempt, state: "missing", runId: null };
        }
        return { attempt, state: "present", runId: run.runId };
      }),
    })),
  }));
  return {
    expectedRunCount: manifest.tasks.reduce(
      (count, task) => count + (task.platforms.length * manifest.suite.sampleRuns),
      0,
    ),
    collectedRunCount: runs.length,
    missingRunKeys,
    tasks,
  };
}

function createBaselineIndex(input) {
  const {
    manifest,
    manifestSha256,
    report,
    reportText,
    coverage,
    expectedReports,
    inputReports,
  } = input;
  return {
    schemaVersion: CODING_AGENT_BASELINE_INDEX_VERSION,
    status: report.status,
    generatedAt: report.generatedAt,
    manifestSha256,
    ...(report.harness ? { harness: structuredClone(report.harness) } : {}),
    source: structuredClone(report.source),
    report: {
      path: "benchmark-report.json",
      sha256: sha256(reportText),
    },
    inputs: inputReports.map((inputReport) => ({
      ...(inputReport.reportId ? { reportId: inputReport.reportId } : {}),
      path: `source-reports/${sha256(inputReport.serialized)}.json`,
      sha256: sha256(inputReport.serialized),
      runIds: inputReport.report.runs.map((run) => run.runId).sort(),
    })).sort((left, right) => left.path.localeCompare(right.path)),
    coverage,
    ...(expectedReports ? { expectedReports } : {}),
    aggregates: {
      byTask: manifest.tasks.map((task) => summarizeGroup(report.runs.filter((run) => run.taskId === task.id), {
        taskId: task.id,
      })),
      byPlatform: manifest.suite.requiredPlatforms.map((platform) => summarizeGroup(
        report.runs.filter((run) => run.platform === platform),
        { platform },
      )),
      failuresByCategory: structuredClone(report.summary.failuresByCategory),
      metrics: structuredClone(report.summary.metrics),
    },
  };
}

function validateExpectedReportPlan(value, manifestSha256, reportPaths) {
  if (value?.schemaVersion !== CODING_AGENT_EXPECTED_REPORT_PLAN_VERSION) {
    throw new Error("Coding benchmark expected report plan has an unsupported schema version.");
  }
  const plan = createCodingAgentBenchmarkExpectedReportPlan(value);
  if (plan.manifestSha256 !== manifestSha256) {
    throw new Error("Coding benchmark expected report plan manifest hash drifted.");
  }
  const plannedPaths = new Set(plan.reports.map((report) => pathIdentity(report.path)));
  const unexpectedPath = reportPaths.find((reportPath) => !plannedPaths.has(pathIdentity(reportPath)));
  if (unexpectedPath) {
    throw new Error("Coding benchmark selected report is not declared by the expected report plan.");
  }
  return plan;
}

function createRetainedExpectedReportPlan(plan) {
  return {
    schemaVersion: CODING_AGENT_EXPECTED_REPORT_EVIDENCE_VERSION,
    manifestSha256: plan.manifestSha256,
    reports: plan.reports.map((report) => ({ reportId: report.reportId })),
  };
}

function createExpectedReportProjection(input) {
  const collectedReportIds = new Set(input.collectedReportIds);
  const reports = input.plan.reports.map((report) => ({
    reportId: report.reportId,
    state: collectedReportIds.has(report.reportId) ? "collected" : "missing",
  }));
  const collectedReportCount = reports.filter((report) => report.state === "collected").length;
  return {
    schemaVersion: CODING_AGENT_EXPECTED_REPORT_PROJECTION_VERSION,
    expectedReportCount: reports.length,
    collectedReportCount,
    missingReportCount: reports.length - collectedReportCount,
    reports,
    plan: {
      path: CODING_AGENT_EXPECTED_REPORT_PLAN_PATH,
      sha256: sha256(input.planText),
    },
  };
}

async function validateExpectedReportProjection(input) {
  const { value, inputs, outputRoot, manifestSha256 } = input;
  if (value === undefined) {
    if (inputs.some((item) => item?.reportId !== undefined)) {
      throw new Error("Coding benchmark baseline index report identity requires expectedReports.");
    }
    return undefined;
  }
  if (value?.schemaVersion !== CODING_AGENT_EXPECTED_REPORT_PROJECTION_VERSION
    || value?.plan?.path !== CODING_AGENT_EXPECTED_REPORT_PLAN_PATH
    || !/^[a-f0-9]{64}$/.test(value?.plan?.sha256 ?? "")) {
    throw new Error("Coding benchmark baseline index has invalid expected report evidence.");
  }
  const planPath = resolveInside(outputRoot, value.plan.path);
  const planStats = await fs.lstat(planPath).catch(() => null);
  if (!planStats?.isFile() || planStats.size > 1024 * 1024) {
    throw new Error("Coding benchmark expected report plan is missing or invalid.");
  }
  const planText = await fs.readFile(planPath, "utf-8");
  if (sha256(planText) !== value.plan.sha256) {
    throw new Error("Coding benchmark expected report plan hash drifted.");
  }
  const parsedPlan = parseJson(planText, planPath);
  if (parsedPlan?.schemaVersion !== CODING_AGENT_EXPECTED_REPORT_EVIDENCE_VERSION
    || parsedPlan?.manifestSha256 !== manifestSha256
    || !Array.isArray(parsedPlan.reports)
    || parsedPlan.reports.length === 0
    || parsedPlan.reports.length > 256
    || parsedPlan.reports.some((report) => {
      return !isReportId(report?.reportId)
        || Object.keys(report).length !== 1;
    })) {
    throw new Error("Coding benchmark expected report plan evidence is invalid.");
  }
  const canonicalPlan = {
    schemaVersion: CODING_AGENT_EXPECTED_REPORT_EVIDENCE_VERSION,
    manifestSha256,
    reports: parsedPlan.reports
      .map((report) => ({ reportId: report.reportId }))
      .sort((left, right) => left.reportId.localeCompare(right.reportId)),
  };
  const reportIds = canonicalPlan.reports.map((report) => report.reportId);
  const inputReportIds = inputs.map((item) => item?.reportId);
  if (new Set(reportIds).size !== reportIds.length
    || inputReportIds.some((reportId) => !isReportId(reportId))
    || new Set(inputReportIds).size !== inputReportIds.length
    || inputReportIds.some((reportId) => !reportIds.includes(reportId))
    || serializeJson(canonicalPlan) !== planText) {
    throw new Error("Coding benchmark baseline index expected report counts cannot be reconstructed.");
  }
  const expected = createExpectedReportProjection({
    plan: canonicalPlan,
    collectedReportIds: inputReportIds,
    planText,
  });
  if (serializeJson(expected) !== serializeJson(value)) {
    throw new Error("Coding benchmark baseline index expected report projection cannot be reconstructed.");
  }
  return expected;
}

function requireReportId(value) {
  if (!isReportId(value)) {
    throw new Error("Coding benchmark expected report plan requires a stable reportId.");
  }
  return value;
}

function isReportId(value) {
  return typeof value === "string"
    && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Coding benchmark aggregation requires ${label}.`);
  }
  return value;
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function summarizeGroup(runs, identity) {
  const failuresByCategory = {};
  for (const run of runs) {
    if (run.failureCategory) {
      failuresByCategory[run.failureCategory] = (failuresByCategory[run.failureCategory] ?? 0) + 1;
    }
  }
  return {
    ...identity,
    runCount: runs.length,
    passedRunCount: runs.filter((run) => run.status === "passed").length,
    failuresByCategory,
  };
}

async function writeBaselineOutput(input) {
  await fs.mkdir(input.outputRoot, { recursive: false });
  try {
    await Promise.all([
      fs.writeFile(path.join(input.outputRoot, "task-manifest.json"), input.manifestText, "utf-8"),
      fs.writeFile(path.join(input.outputRoot, "benchmark-report.json"), input.reportText, "utf-8"),
      fs.writeFile(path.join(input.outputRoot, "baseline-index.json"), serializeJson(input.baselineIndex), "utf-8"),
      ...(input.expectedReportPlanText
        ? [fs.writeFile(
            path.join(input.outputRoot, CODING_AGENT_EXPECTED_REPORT_PLAN_PATH),
            input.expectedReportPlanText,
            "utf-8",
          )]
        : []),
    ]);
    for (const inputReport of input.inputReports) {
      const sourceReportPath = path.join(
        input.outputRoot,
        "source-reports",
        `${sha256(inputReport.serialized)}.json`,
      );
      await fs.mkdir(path.dirname(sourceReportPath), { recursive: true });
      await fs.writeFile(sourceReportPath, inputReport.serialized, "utf-8");
      for (const run of inputReport.report.runs) {
        for (const artifactPath of Object.values(run.artifacts)) {
          await copyDeclaredArtifact({
            sourceRoot: inputReport.reportRoot,
            targetRoot: input.outputRoot,
            artifactPath,
          });
        }
      }
    }
  } catch (error) {
    throw new Error(`Coding benchmark aggregation output is incomplete at ${input.outputRoot}: ${safeMessage(error)}`);
  }
}

async function copyDeclaredArtifact(input) {
  const sourcePath = resolveInside(input.sourceRoot, input.artifactPath);
  const targetPath = resolveInside(input.targetRoot, input.artifactPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
}

function sortRuns(runs, manifest) {
  const taskOrder = new Map(manifest.tasks.map((task, index) => [task.id, index]));
  const platformOrder = new Map(manifest.suite.requiredPlatforms.map((platform, index) => [platform, index]));
  return runs.map((run) => structuredClone(run)).sort((left, right) => {
    return (taskOrder.get(left.taskId) ?? Number.MAX_SAFE_INTEGER) - (taskOrder.get(right.taskId) ?? Number.MAX_SAFE_INTEGER)
      || (platformOrder.get(left.platform) ?? Number.MAX_SAFE_INTEGER) - (platformOrder.get(right.platform) ?? Number.MAX_SAFE_INTEGER)
      || left.attempt - right.attempt
      || left.runId.localeCompare(right.runId);
  });
}

async function assertMissingOutputRoot(outputRoot) {
  try {
    await fs.lstat(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Coding benchmark aggregation refuses to overwrite existing outputRoot: ${outputRoot}.`);
}

function resolveInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Coding benchmark artifact path escapes its root: ${String(relativePath)}.`);
  }
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Coding benchmark artifact path escapes its root: ${relativePath}.`);
  }
  return target;
}

function isSafeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && !value.split("/").includes("..");
}

function runKey(run) {
  return `${run.taskId}\0${run.platform}\0${run.attempt}`;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Coding benchmark JSON is invalid at ${label}: ${safeMessage(error)}`);
  }
}

function requireInput(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark aggregation requires ${label}.`);
  }
  return value;
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

export function parseCodingAgentBenchmarkAggregationCliArguments(argv) {
  const options = { reportPaths: [], writeOutput: true, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--report") {
      options.reportPaths.push(requireInput(argv[index + 1], "--report"));
      index += 1;
    } else if (value === "--output-root") {
      options.outputRoot = requireInput(argv[index + 1], "--output-root");
      index += 1;
    } else if (value === "--generated-at") {
      options.generatedAt = requireInput(argv[index + 1], "--generated-at");
      index += 1;
    } else if (value === "--expected-report-plan") {
      if (options.expectedReportPlanPath !== undefined) {
        throw new Error("--expected-report-plan may only be provided once.");
      }
      options.expectedReportPlanPath = requireInput(argv[index + 1], "--expected-report-plan");
      index += 1;
    } else if (value === "--manifest-revision") {
      if (options.manifestRevision !== undefined) {
        throw new Error("--manifest-revision may only be provided once.");
      }
      const manifestRevision = requireInput(argv[index + 1], "--manifest-revision");
      if (manifestRevision !== "v1" && manifestRevision !== "v2" && manifestRevision !== "v3") {
        throw new Error("Coding benchmark aggregation manifest revision must be v1, v2, or v3.");
      }
      resolveCodingAgentBenchmarkManifestPath(manifestRevision);
      options.manifestRevision = manifestRevision;
      index += 1;
    } else if (value === "--dry-run") {
      options.writeOutput = false;
    } else if (value === "--verify") {
      options.verify = true;
    } else {
      throw new Error(`Unknown coding benchmark aggregation argument: ${value}.`);
    }
  }
  return options;
}

async function main() {
  const options = parseCodingAgentBenchmarkAggregationCliArguments(process.argv.slice(2));
  if (options.verify) {
    if (options.reportPaths.length > 0
      || options.manifestRevision !== undefined
      || options.expectedReportPlanPath !== undefined
      || !options.outputRoot
      || !options.writeOutput) {
      throw new Error("--verify requires only --output-root.");
    }
    const verified = await verifyCodingAgentBaselineArtifact({ outputRoot: options.outputRoot });
    console.log(
      `[coding-agent-baseline] verified ${verified.report.status} ${verified.report.summary.runCount} run(s)`,
    );
    return;
  }
  if (options.expectedReportPlanPath !== undefined) {
    options.expectedReportPlan = await loadCodingAgentBenchmarkExpectedReportPlanFile(
      options.expectedReportPlanPath,
    );
    delete options.expectedReportPlanPath;
  }
  const result = await aggregateCodingAgentBenchmarkReports(options);
  console.log(
    `[coding-agent-baseline] ${result.report.status} ${result.report.summary.runCount}/${result.baselineIndex.coverage.expectedRunCount} run(s); missing=${result.baselineIndex.coverage.missingRunKeys.length}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-baseline] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
