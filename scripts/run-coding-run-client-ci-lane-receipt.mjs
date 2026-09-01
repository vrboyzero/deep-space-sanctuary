import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { projectStructuredTestReport } from "./verification-test-report-adapter.mjs";

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
export const CODING_RUN_CLIENT_CI_LANE_EVIDENCE_VERSION =
  "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1";
const REPORT_FORMAT = "vitest-json/v3.2.7";
const RUNNER_VERSION = "3.2.7";
const EXPECTED_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);
const PLATFORM_RUNNERS = Object.freeze({
  "ubuntu-latest": "Linux",
  "windows-latest": "Windows",
});
const schemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "coding-run-client-ci-lane-evidence.schema.json",
);

export async function writeCodingRunClientCiLaneReceipt(input) {
  const reportPath = path.resolve(requireString(input?.reportPath, "reportPath"));
  const outputPath = path.resolve(requireString(input?.outputPath, "outputPath"));
  if (path.basename(reportPath) !== "vitest-report.json"
    || path.basename(outputPath) !== "lane-receipt.json"
    || reportPath === outputPath) {
    throw new Error("Coding-run client CI lane evidence paths drifted.");
  }
  const platform = requireEnum(
    input?.platform,
    Object.keys(PLATFORM_RUNNERS),
    "platform",
  );
  const testOutcome = requireEnum(input?.testOutcome, ["success", "failure"], "testOutcome");
  const environment = requireObject(input?.environment, "environment");
  const github = readGithubEnvironment(environment);
  const runner = readRunnerEnvironment(environment, platform);
  const reportBytes = await readBoundedRegularFile(reportPath, MAX_REPORT_BYTES, "Vitest report");
  const reportText = decodeUtf8(reportBytes, "Vitest report");
  const reportSha256 = sha256(reportBytes);
  const projected = projectStructuredTestReport({
    framework: "vitest",
    format: REPORT_FORMAT,
    runnerVersion: RUNNER_VERSION,
    artifact: { path: "vitest-report.json", sha256: reportSha256 },
    content: reportText,
  });
  const expectedStatus = testOutcome === "success" ? "passed" : "failed";
  if (projected.status !== expectedStatus) {
    throw new Error("Coding-run client CI test outcome and native report drifted.");
  }
  const report = parseJson(reportText, "Vitest report");
  requireExactTestSelection(report);

  const receipt = {
    schemaVersion: CODING_RUN_CLIENT_CI_LANE_EVIDENCE_VERSION,
    generatedAt: new Date().toISOString(),
    command: "corepack pnpm verify:coding-run-client",
    github,
    runner,
    report: {
      status: projected.status,
      framework: "vitest",
      format: REPORT_FORMAT,
      runnerVersion: RUNNER_VERSION,
      path: "vitest-report.json",
      sha256: reportSha256,
      testFiles: [...EXPECTED_TEST_FILES],
    },
  };
  await validateReceipt(receipt);
  await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
  });
  return receipt;
}

function readGithubEnvironment(environment) {
  if (environment.GITHUB_ACTIONS !== "true") {
    throw new Error("Coding-run client CI lane evidence requires GitHub Actions.");
  }
  const repositoryId = requirePositiveInteger(environment.GITHUB_REPOSITORY_ID, "GITHUB_REPOSITORY_ID");
  const repository = requirePattern(
    environment.GITHUB_REPOSITORY,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    "GITHUB_REPOSITORY",
  );
  const ref = requirePattern(environment.GITHUB_REF, /^refs\/(?:heads|tags)\/\S+$/, "GITHUB_REF");
  const workflowRef = `${repository}/.github/workflows/quality-gates.yml@${ref}`;
  if (environment.GITHUB_WORKFLOW !== "Quality Gates"
    || environment.GITHUB_WORKFLOW_REF !== workflowRef
    || environment.GITHUB_JOB !== "coding-ci-contract") {
    throw new Error("Coding-run client CI workflow identity drifted.");
  }
  return {
    repositoryId,
    repository,
    workflow: environment.GITHUB_WORKFLOW,
    workflowRef,
    job: environment.GITHUB_JOB,
    runId: requirePositiveInteger(environment.GITHUB_RUN_ID, "GITHUB_RUN_ID"),
    runAttempt: requirePositiveInteger(environment.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT"),
    sha: requirePattern(environment.GITHUB_SHA, /^[a-f0-9]{40}$/, "GITHUB_SHA"),
    ref,
  };
}

function readRunnerEnvironment(environment, platform) {
  const expectedOs = PLATFORM_RUNNERS[platform];
  if (environment.RUNNER_OS !== expectedOs || environment.RUNNER_ARCH !== "X64") {
    throw new Error("Coding-run client CI runner identity drifted.");
  }
  return { platform, os: expectedOs, arch: "X64" };
}

function requireExactTestSelection(report) {
  if (!Array.isArray(report.testResults)
    || report.testResults.length !== EXPECTED_TEST_FILES.length) {
    throw new Error("Coding-run client CI native test selection drifted.");
  }
  const selected = report.testResults.map((result) => {
    const normalized = typeof result?.name === "string" ? result.name.replaceAll("\\", "/") : "";
    return EXPECTED_TEST_FILES.find((testFile) => {
      return normalized === testFile || normalized.endsWith(`/${testFile}`);
    }) ?? null;
  });
  if (selected.some((testFile) => testFile === null)
    || new Set(selected).size !== EXPECTED_TEST_FILES.length) {
    throw new Error("Coding-run client CI native test selection drifted.");
  }
}

async function validateReceipt(receipt) {
  const schemaText = decodeUtf8(
    await readBoundedRegularFile(schemaPath, 1024 * 1024, "lane evidence schema"),
    "lane evidence schema",
  );
  const compiled = compileOutputSchema(parseJson(schemaText, "lane evidence schema"));
  if (!compiled.ok || !compiled.validator.validateOutput(JSON.stringify(receipt)).ok) {
    throw new Error("Coding-run client CI lane evidence does not match its schema.");
  }
}

async function readBoundedRegularFile(target, maxBytes, label) {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch {
    throw new Error(`Unable to read ${label}.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maxBytes) {
    throw new Error(`${label} must be a bounded regular file.`);
  }
  return await fs.readFile(target);
}

function parseJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    return requireObject(parsed, label);
  } catch (error) {
    if (error?.message?.startsWith("Coding-run client CI")) throw error;
    throw new Error(`${label} is invalid JSON.`);
  }
}

function decodeUtf8(value, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error(`${label} is not UTF-8.`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length < 1) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireEnum(value, allowed, label) {
  const normalized = requireString(value, label);
  if (!allowed.includes(normalized)) throw new Error(`${label} is unsupported.`);
  return normalized;
}

function requirePositiveInteger(value, label) {
  const normalized = requirePattern(value, /^[1-9][0-9]*$/, label);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is not a safe integer.`);
  return parsed;
}

function requirePattern(value, pattern, label) {
  const normalized = requireString(value, label);
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--report", "--output", "--platform", "--test-outcome"].includes(flag)
      || typeof value !== "string") {
      throw new Error("Usage: run-coding-run-client-ci-lane-receipt --report <vitest-report.json> --output <lane-receipt.json> --platform <runner> --test-outcome <success|failure>.");
    }
    if (values.has(flag)) throw new Error(`Duplicate argument ${flag}.`);
    values.set(flag, value);
  }
  return {
    reportPath: values.get("--report"),
    outputPath: values.get("--output"),
    platform: values.get("--platform"),
    testOutcome: values.get("--test-outcome"),
  };
}

async function main() {
  await writeCodingRunClientCiLaneReceipt({
    ...parseArgs(process.argv.slice(2)),
    environment: process.env,
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
