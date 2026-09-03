import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import { resolveBenchmarkRepositoryIdentity } from "./coding-agent-benchmark-preflight.mjs";

export const CODING_AGENT_CANDIDATE_EXPECTED_REPORT_PLAN_VERSION =
  "coding-agent-benchmark-expected-report-plan/v1";

const REQUIRED_CANDIDATE_REPORT_COUNT = 144;
const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveCodingAgentBenchmarkCandidateReportId(input) {
  const taskId = requireTaskId(input?.taskId);
  const platform = requirePlatform(input?.platform);
  const attempt = requireAttempt(input?.attempt);
  return `${taskId}.${platform}.a${attempt}`;
}

export function resolveCodingAgentBenchmarkCandidateReportPath(input) {
  const reportRoot = path.resolve(requireString(input?.reportRoot, "reportRoot"));
  const taskId = requireTaskId(input?.taskId);
  const platform = requirePlatform(input?.platform);
  const attempt = requireAttempt(input?.attempt);
  return path.join(reportRoot, platform, `attempt-${attempt}`, taskId, "benchmark-report.json");
}

export function createCodingAgentBenchmarkCandidateExpectedReportPlan(input) {
  const candidateId = requireCandidateId(input?.candidateId);
  const manifest = requireCandidateManifest(input?.manifest);
  const manifestSha256 = requireSha256(input?.manifestSha256, "manifestSha256");
  const reportRoot = path.resolve(requireString(input?.reportRoot, "reportRoot"));
  const source = requireRepositoryIdentity(input?.source, "source");
  const harness = requireRepositoryIdentity(input?.harness, "harness");
  const reports = manifest.tasks.flatMap((task) => (
    manifest.suite.requiredPlatforms.flatMap((platform) => (
      Array.from({ length: manifest.suite.sampleRuns }, (_, index) => {
        const attempt = index + 1;
        return {
          reportId: resolveCodingAgentBenchmarkCandidateReportId({ taskId: task.id, platform, attempt }),
          taskId: task.id,
          platform,
          attempt,
          path: resolveCodingAgentBenchmarkCandidateReportPath({
            reportRoot,
            taskId: task.id,
            platform,
            attempt,
          }),
        };
      })
    ))
  )).sort((left, right) => left.reportId.localeCompare(right.reportId));

  if (reports.length !== REQUIRED_CANDIDATE_REPORT_COUNT) {
    throw new Error(
      `Coding benchmark candidate expected report plan requires exactly ${REQUIRED_CANDIDATE_REPORT_COUNT} reports.`,
    );
  }
  assertUniqueReports(reports);

  return {
    schemaVersion: CODING_AGENT_CANDIDATE_EXPECTED_REPORT_PLAN_VERSION,
    manifestSha256,
    candidate: { id: candidateId, source, harness },
    reports,
  };
}

export function validateCodingAgentBenchmarkCandidateExpectedReportRun(input) {
  const plan = requireCandidatePlan(input?.plan);
  const candidateId = requireCandidateId(input?.candidateId);
  if (plan.candidate.id !== candidateId) {
    throw new Error("Coding benchmark candidate identity drifted from the expected report plan.");
  }

  const manifest = requireCandidateManifest(input?.manifest);
  const manifestSha256 = requireSha256(input?.manifestSha256, "manifestSha256");
  if (plan.manifestSha256 !== manifestSha256) {
    throw new Error("Coding benchmark candidate expected report plan manifest hash drifted.");
  }
  assertSameRepositoryIdentity(plan.candidate.source, input?.source, "source");
  assertSameRepositoryIdentity(plan.candidate.harness, input?.harness, "harness");

  const taskId = requireTaskId(input?.taskId);
  const task = manifest.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Coding benchmark candidate task is not declared by the manifest: ${taskId}.`);
  }
  const platform = requirePlatform(input?.platform);
  if (!task.platforms.includes(platform)) {
    throw new Error(`Coding benchmark candidate platform is not declared for task ${taskId}: ${platform}.`);
  }
  const attempt = requireAttempt(input?.attempt);
  if (attempt > manifest.suite.sampleRuns) {
    throw new Error(
      `Coding benchmark candidate attempt must be within 1-${manifest.suite.sampleRuns}.`,
    );
  }
  const reportPath = path.resolve(requireString(input?.reportPath, "reportPath"));
  const reportId = resolveCodingAgentBenchmarkCandidateReportId({ taskId, platform, attempt });
  const expected = plan.reports.find((report) => report.reportId === reportId);
  if (!expected || pathIdentity(expected.path) !== pathIdentity(reportPath)) {
    throw new Error("Coding benchmark candidate report path is not declared by the expected report plan.");
  }
  if (expected.taskId !== taskId
    || expected.platform !== platform
    || expected.attempt !== attempt) {
    throw new Error("Coding benchmark candidate expected report metadata drifted.");
  }
  return structuredClone(expected);
}

export async function writeCodingAgentBenchmarkExpectedReportPlanFile(input) {
  const plan = requireCandidatePlan(input?.plan);
  const outputPath = path.resolve(requireString(input?.outputPath, "outputPath"));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
  });
  return outputPath;
}

export async function loadCodingAgentBenchmarkCandidateExpectedReportPlanFile(planPathInput) {
  const planPath = path.resolve(requireString(planPathInput, "expected report plan path"));
  const stats = await fs.lstat(planPath).catch(() => null);
  if (!stats?.isFile() || stats.size > 1024 * 1024) {
    throw new Error("Coding benchmark candidate expected report plan must be a regular file no larger than 1 MiB.");
  }
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(planPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Coding benchmark candidate expected report plan JSON is invalid: ${safeMessage(error)}`,
    );
  }
  return requireCandidatePlan(parsed, path.dirname(planPath));
}

export async function validateCodingAgentBenchmarkCandidateExpectedReportLaunch(input, dependencies = {}) {
  const hasCandidateId = input?.candidateId !== undefined;
  const hasPlanPath = input?.expectedReportPlanPath !== undefined;
  if (!hasCandidateId && !hasPlanPath) return undefined;
  if (!hasCandidateId || !hasPlanPath) {
    throw new Error(
      "Coding benchmark candidate launch requires --candidate-id and --expected-report-plan together.",
    );
  }
  if (input?.manifestRevision !== "v3") {
    throw new Error("Coding benchmark candidate expected report plan requires manifestRevision v3.");
  }

  const resolvePath = dependencies.resolvePath ?? path.resolve;
  const workspaceRoot = resolvePath(requireString(input?.workspaceRoot, "workspaceRoot"));
  const sourceRoot = input?.sourceRoot === undefined
    ? workspaceRoot
    : resolvePath(requireString(input.sourceRoot, "sourceRoot"));
  const artifactRoot = resolvePath(requireString(input?.artifactRoot, "artifactRoot"));
  const manifestPath = path.join(
    workspaceRoot,
    "benchmarks",
    "coding-agent",
    "v3",
    "task-manifest.json",
  );
  const loadPlan = dependencies.loadExpectedReportPlan
    ?? loadCodingAgentBenchmarkCandidateExpectedReportPlanFile;
  const readFile = dependencies.readFile ?? fs.readFile;
  const loadManifest = dependencies.loadManifest ?? loadCodingAgentBenchmarkManifest;
  const [plan, manifestText, manifest] = await Promise.all([
    loadPlan(requireString(input.expectedReportPlanPath, "expectedReportPlanPath")),
    readFile(manifestPath, "utf-8"),
    loadManifest(manifestPath),
  ]);
  const resolveIdentity = dependencies.resolveRepositoryIdentity
    ?? resolveBenchmarkRepositoryIdentity;
  const harness = await resolveIdentity(workspaceRoot);
  const source = pathIdentity(sourceRoot) === pathIdentity(workspaceRoot)
    ? harness
    : await resolveIdentity(sourceRoot);
  const taskId = requireTaskId(input?.taskId);
  const platform = requirePlatform(input?.platform);
  const attempt = requireAttempt(input?.attempt);
  const reportPath = path.join(artifactRoot, "benchmark-report.json");
  const expectedReport = validateCodingAgentBenchmarkCandidateExpectedReportRun({
    plan,
    candidateId: input.candidateId,
    manifest,
    manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
    source,
    harness,
    taskId,
    platform,
    attempt,
    reportPath,
  });
  return {
    candidateId: plan.candidate.id,
    plan,
    manifest,
    manifestPath,
    source,
    harness,
    report: expectedReport,
  };
}

export async function prepareCodingAgentBenchmarkCandidateExpectedReportPlan(input, dependencies = {}) {
  const resolvePath = dependencies.resolvePath ?? path.resolve;
  const harnessRoot = resolvePath(input?.harnessRoot ?? defaultWorkspaceRoot);
  const sourceRoot = resolvePath(input?.sourceRoot ?? harnessRoot);
  const manifestPath = resolvePath(input?.manifestPath ?? path.join(
    harnessRoot,
    "benchmarks",
    "coding-agent",
    "v3",
    "task-manifest.json",
  ));
  const reportRoot = resolvePath(requireString(input?.reportRoot, "reportRoot"));
  const outputPath = resolvePath(requireString(input?.outputPath, "outputPath"));
  const readFile = dependencies.readFile ?? fs.readFile;
  const loadManifest = dependencies.loadManifest ?? loadCodingAgentBenchmarkManifest;
  const resolveIdentity = dependencies.resolveRepositoryIdentity
    ?? resolveBenchmarkRepositoryIdentity;
  const [manifestText, manifest, harness] = await Promise.all([
    readFile(manifestPath, "utf-8"),
    loadManifest(manifestPath),
    resolveIdentity(harnessRoot),
  ]);
  const source = pathIdentity(sourceRoot) === pathIdentity(harnessRoot)
    ? harness
    : await resolveIdentity(sourceRoot);
  const plan = createCodingAgentBenchmarkCandidateExpectedReportPlan({
    candidateId: input?.candidateId,
    manifest,
    manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
    reportRoot,
    source,
    harness,
  });
  const writePlan = dependencies.writePlan
    ?? writeCodingAgentBenchmarkExpectedReportPlanFile;
  await writePlan({ plan, outputPath });
  return { plan, outputPath };
}

export function parseCodingAgentBenchmarkExpectedReportPlanCliArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid expected-report plan argument near ${flag ?? "<end>"}.`);
    }
    const key = flag.slice(2);
    if (![
      "candidate-id",
      "report-root",
      "output",
      "harness-root",
      "source-root",
      "manifest",
    ].includes(key)) {
      throw new Error(`Unknown expected-report plan argument: ${flag}.`);
    }
    if (values.has(key)) {
      throw new Error(`Expected-report plan argument may only be provided once: ${flag}.`);
    }
    values.set(key, value);
  }
  return {
    candidateId: requireString(values.get("candidate-id"), "--candidate-id"),
    reportRoot: requireString(values.get("report-root"), "--report-root"),
    outputPath: requireString(values.get("output"), "--output"),
    ...(values.has("harness-root") ? {
      harnessRoot: requireString(values.get("harness-root"), "--harness-root"),
    } : {}),
    ...(values.has("source-root") ? {
      sourceRoot: requireString(values.get("source-root"), "--source-root"),
    } : {}),
    ...(values.has("manifest") ? {
      manifestPath: requireString(values.get("manifest"), "--manifest"),
    } : {}),
  };
}

function requireCandidatePlan(value, planRoot) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schemaVersion !== CODING_AGENT_CANDIDATE_EXPECTED_REPORT_PLAN_VERSION
    || Object.keys(value).some((key) => (
      key !== "schemaVersion"
      && key !== "manifestSha256"
      && key !== "candidate"
      && key !== "reports"
    ))) {
    throw new Error("Coding benchmark candidate expected report plan does not match its versioned contract.");
  }
  const candidateKeys = Object.keys(value.candidate ?? {});
  if (candidateKeys.length !== 3
    || !candidateKeys.includes("id")
    || !candidateKeys.includes("source")
    || !candidateKeys.includes("harness")) {
    throw new Error("Coding benchmark candidate expected report plan candidate binding is invalid.");
  }
  if (!Array.isArray(value.reports) || value.reports.length !== REQUIRED_CANDIDATE_REPORT_COUNT) {
    throw new Error(
      `Coding benchmark candidate expected report plan requires exactly ${REQUIRED_CANDIDATE_REPORT_COUNT} reports.`,
    );
  }
  const reports = value.reports.map((report) => {
    if (!report || typeof report !== "object" || Array.isArray(report)
      || Object.keys(report).length !== 5) {
      throw new Error("Coding benchmark candidate expected report entry is invalid.");
    }
    const taskId = requireTaskId(report.taskId);
    const platform = requirePlatform(report.platform);
    const attempt = requireAttempt(report.attempt);
    const reportId = resolveCodingAgentBenchmarkCandidateReportId({ taskId, platform, attempt });
    if (report.reportId !== reportId) {
      throw new Error("Coding benchmark candidate expected report ID drifted from its metadata.");
    }
    return {
      reportId,
      taskId,
      platform,
      attempt,
      path: path.resolve(planRoot ?? "", requireString(report.path, "expected report path")),
    };
  });
  assertUniqueReports(reports);
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_EXPECTED_REPORT_PLAN_VERSION,
    manifestSha256: requireSha256(value.manifestSha256, "manifestSha256"),
    candidate: {
      id: requireCandidateId(value.candidate.id),
      source: requireRepositoryIdentity(value.candidate.source, "source"),
      harness: requireRepositoryIdentity(value.candidate.harness, "harness"),
    },
    reports,
  };
}

function requireCandidateManifest(value) {
  if (!value || typeof value !== "object"
    || value.schemaVersion !== "coding-agent-benchmark-manifest/v3"
    || !Array.isArray(value.tasks)
    || value.tasks.length !== 24
    || !Array.isArray(value.suite?.requiredPlatforms)
    || value.suite.requiredPlatforms.length !== 2
    || value.suite.sampleRuns !== 3) {
    throw new Error("Coding benchmark candidate expected report plan requires the frozen v3 manifest matrix.");
  }
  const platforms = value.suite.requiredPlatforms.map(requirePlatform);
  if (new Set(platforms).size !== platforms.length) {
    throw new Error("Coding benchmark candidate manifest platforms must be unique.");
  }
  const taskIds = new Set();
  for (const task of value.tasks) {
    const taskId = requireTaskId(task?.id);
    if (taskIds.has(taskId)) {
      throw new Error("Coding benchmark candidate manifest task IDs must be unique.");
    }
    taskIds.add(taskId);
    if (JSON.stringify(task.platforms) !== JSON.stringify(platforms)) {
      throw new Error(`Coding benchmark candidate task platform matrix drifted for ${taskId}.`);
    }
  }
  return value;
}

function requireRepositoryIdentity(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 4
    || typeof value.workspaceDirty !== "boolean"
    || value.workspaceDirty) {
    throw new Error(`Coding benchmark candidate expected report plan requires a clean ${label} identity.`);
  }
  return {
    commit: requireHex(value.commit, 40, `${label}.commit`),
    workspaceDirty: false,
    lockfileSha256: requireSha256(value.lockfileSha256, `${label}.lockfileSha256`),
    worktreeContentSha256: requireSha256(
      value.worktreeContentSha256,
      `${label}.worktreeContentSha256`,
    ),
  };
}

function assertSameRepositoryIdentity(expected, actual, label) {
  const normalized = requireRepositoryIdentity(actual, label);
  if (JSON.stringify(expected) !== JSON.stringify(normalized)) {
    throw new Error(`Coding benchmark candidate ${label} identity drifted from the expected report plan.`);
  }
}

function assertUniqueReports(reports) {
  if (new Set(reports.map((report) => report.reportId)).size !== reports.length) {
    throw new Error("Coding benchmark candidate expected report IDs must be unique.");
  }
  if (new Set(reports.map((report) => pathIdentity(report.path))).size !== reports.length) {
    throw new Error("Coding benchmark candidate expected report paths must be unique.");
  }
}

function requireCandidateId(value) {
  const candidateId = requireString(value, "candidateId");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(candidateId)) {
    throw new Error("Coding benchmark candidate ID must be stable and path-safe.");
  }
  return candidateId;
}

function requireTaskId(value) {
  const taskId = requireString(value, "taskId");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(taskId)) {
    throw new Error("Coding benchmark candidate task ID must be stable and path-safe.");
  }
  return taskId;
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("Coding benchmark candidate platform must be windows-native or wsl2-linux.");
  }
  return value;
}

function requireAttempt(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Coding benchmark candidate attempt must be a positive integer.");
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark candidate expected report plan requires ${label}.`);
  }
  return value.trim();
}

function requireSha256(value, label) {
  return requireHex(value, 64, label);
}

function requireHex(value, length, label) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw new Error(`Coding benchmark candidate expected report plan requires ${label}.`);
  }
  return value;
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const input = parseCodingAgentBenchmarkExpectedReportPlanCliArguments(process.argv.slice(2));
  const result = await prepareCodingAgentBenchmarkCandidateExpectedReportPlan(input);
  console.log(
    `[coding-agent-expected-report-plan] wrote ${result.plan.reports.length} report slot(s) to ${result.outputPath}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-expected-report-plan] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
