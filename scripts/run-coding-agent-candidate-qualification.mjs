import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { qualifyCodingAgentBenchmarkCandidate } from "./coding-agent-candidate-qualification.mjs";
import { resolveCodingAgentBenchmarkScorecardV3Path } from "./coding-agent-benchmark-v3-contract.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const OUTPUT_NAME = "candidate-qualification.json";

export const CODING_AGENT_CANDIDATE_QUALIFICATION_REPORT_VERSION =
  "coding-agent-benchmark-candidate-qualification-report/v1";
export const CODING_AGENT_QUALIFICATION_EVIDENCE_DIGEST_VERSION =
  "coding-agent-benchmark-qualification-evidence-digest/v1";

export function parseCodingAgentCandidateQualificationCliArguments(argv) {
  const options = { verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--aggregate-root") {
      if (options.aggregateRoot !== undefined) {
        throw new Error("--aggregate-root may only be provided once.");
      }
      options.aggregateRoot = path.resolve(requireCliValue(argv[index + 1], "--aggregate-root"));
      index += 1;
    } else if (value === "--scorecard-path") {
      if (options.scorecardPath !== undefined) {
        throw new Error("--scorecard-path may only be provided once.");
      }
      options.scorecardPath = path.resolve(requireCliValue(argv[index + 1], "--scorecard-path"));
      index += 1;
    } else if (value === "--verify") {
      if (options.verify) {
        throw new Error("--verify may only be provided once.");
      }
      options.verify = true;
    } else {
      throw new Error(`Unknown coding benchmark candidate qualification argument: ${String(value)}.`);
    }
  }
  if (options.aggregateRoot === undefined) {
    throw new Error("Coding benchmark candidate qualification requires --aggregate-root.");
  }
  return options;
}

export async function runCodingAgentCandidateQualificationCommand(input) {
  const operationInput = {
    aggregateRoot: input?.aggregateRoot,
    ...(input?.scorecardPath ? { scorecardPath: input.scorecardPath } : {}),
  };
  return input?.verify === true
    ? await verifyCodingAgentCandidateQualificationReport(operationInput)
    : await writeCodingAgentCandidateQualificationReport(operationInput);
}

export async function writeCodingAgentCandidateQualificationReport(input) {
  const aggregateRoot = path.resolve(requireInput(input?.aggregateRoot, "aggregateRoot"));
  const scorecardPath = path.resolve(
    input?.scorecardPath ?? resolveCodingAgentBenchmarkScorecardV3Path(),
  );
  const report = await createCodingAgentCandidateQualificationReport({
    aggregateRoot,
    scorecardPath,
  });
  await validateCandidateQualificationReport(report);
  await fs.writeFile(
    path.join(aggregateRoot, OUTPUT_NAME),
    serializeJson(report),
    { encoding: "utf-8", flag: "wx" },
  );
  return report;
}

export async function verifyCodingAgentCandidateQualificationReport(input) {
  const aggregateRoot = path.resolve(requireInput(input?.aggregateRoot, "aggregateRoot"));
  const scorecardPath = path.resolve(
    input?.scorecardPath ?? resolveCodingAgentBenchmarkScorecardV3Path(),
  );
  const reportPath = path.join(aggregateRoot, OUTPUT_NAME);
  const reportText = await readBoundedRegularFile(reportPath, 4 * 1024 * 1024, OUTPUT_NAME);
  const report = parseJson(reportText, OUTPUT_NAME);
  await validateCandidateQualificationReport(report);
  const expected = await createCodingAgentCandidateQualificationReport({
    aggregateRoot,
    scorecardPath,
  });
  if (serializeJson(expected) !== reportText) {
    throw new Error("Coding benchmark candidate qualification report cannot be reconstructed from retained evidence.");
  }
  return report;
}

async function createCodingAgentCandidateQualificationReport(input) {
  const before = await captureQualificationSource(input);
  const decision = await qualifyCodingAgentBenchmarkCandidate(input);
  const after = await captureQualificationSource(input);
  if (serializeJson(before) !== serializeJson(after)) {
    throw new Error("Coding benchmark qualification evidence changed while the decision was being evaluated.");
  }
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_QUALIFICATION_REPORT_VERSION,
    generatedAt: decision.generatedAt,
    source: after,
    decision,
  };
}

async function captureQualificationSource(input) {
  const manifestPath = path.join(input.aggregateRoot, "task-manifest.json");
  const reportPath = path.join(input.aggregateRoot, "benchmark-report.json");
  const indexPath = path.join(input.aggregateRoot, "baseline-index.json");
  const [manifestText, reportText, indexText, scorecardText] = await Promise.all([
    readBoundedRegularFile(manifestPath, 4 * 1024 * 1024, "task-manifest.json"),
    readBoundedRegularFile(reportPath, 64 * 1024 * 1024, "benchmark-report.json"),
    readBoundedRegularFile(indexPath, 16 * 1024 * 1024, "baseline-index.json"),
    readBoundedRegularFile(input.scorecardPath, 1024 * 1024, "scorecard.json"),
  ]);
  const report = parseJson(reportText, "benchmark-report.json");
  const index = parseJson(indexText, "baseline-index.json");
  const scorecard = parseJson(scorecardText, "scorecard.json");
  return {
    manifestSha256: requireSha256(index?.manifestSha256, "baseline index manifestSha256"),
    reportSha256: sha256(reportText),
    indexSha256: sha256(indexText),
    scorecardSha256: sha256(scorecardText),
    evidence: await createQualificationEvidenceDigest({
      aggregateRoot: input.aggregateRoot,
      report,
      index,
      scorecard,
    }),
  };
}

async function createQualificationEvidenceDigest(input) {
  const paths = new Set();
  for (const sourceReport of input.index?.inputs ?? []) {
    paths.add(requireSafeRelativePath(sourceReport?.path, "source report"));
  }
  for (const run of input.report?.runs ?? []) {
    for (const artifactPath of Object.values(run?.artifacts ?? {})) {
      paths.add(requireSafeRelativePath(artifactPath, `${run?.runId ?? "run"} artifact`));
    }
  }
  paths.add(requireSafeRelativePath(
    input.index?.expectedReports?.plan?.path ?? "expected-reports.json",
    "expected reports",
  ));
  paths.add(requireSafeRelativePath(
    input.scorecard?.qualificationEvidence?.sources?.candidateGlobalReceipt?.path
      ?? "candidate-global-receipt.json",
    "candidate-global receipt",
  ));

  const entries = [];
  for (const relativePath of [...paths].sort()) {
    const target = resolveInside(input.aggregateRoot, relativePath);
    const stats = await fs.lstat(target).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (!stats) {
      entries.push({ path: relativePath, state: "missing" });
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      entries.push({ path: relativePath, state: "non_regular" });
      continue;
    }
    entries.push({
      path: relativePath,
      state: "file",
      size: stats.size,
      sha256: await sha256File(target),
    });
  }
  return {
    schemaVersion: CODING_AGENT_QUALIFICATION_EVIDENCE_DIGEST_VERSION,
    entryCount: entries.length,
    sha256: sha256(serializeJson(entries)),
  };
}

async function validateCandidateQualificationReport(report) {
  const validator = await loadCandidateQualificationReportValidator();
  if (!validator.validateOutput(JSON.stringify(report)).ok) {
    throw new Error("Coding benchmark candidate qualification report does not match its schema.");
  }
}

async function loadCandidateQualificationReportValidator() {
  const schemaPath = path.resolve(
    import.meta.dirname,
    "..",
    "benchmarks",
    "coding-agent",
    "v3",
    "candidate-qualification-report.schema.json",
  );
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    throw new Error("Coding benchmark candidate qualification report schema is invalid.");
  }
  return compiled.validator;
}

async function readBoundedRegularFile(target, maxBytes, label) {
  const stats = await fs.lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) {
    throw new Error(`${label} must be a regular file no larger than ${maxBytes} bytes.`);
  }
  return await fs.readFile(target, "utf-8");
}

async function sha256File(target) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Coding benchmark qualification evidence escapes its aggregate root: ${relativePath}.`);
  }
  return target;
}

function requireSafeRelativePath(value, label) {
  if (typeof value !== "string"
    || !value
    || path.isAbsolute(value)
    || value.includes("\\")
    || value.split("/").includes("..")) {
    throw new Error(`Coding benchmark qualification ${label} path is invalid.`);
  }
  return value;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Coding benchmark qualification JSON is invalid at ${label}.`);
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireInput(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark candidate qualification report requires ${label}.`);
  }
  return value;
}

function requireCliValue(value, label) {
  const normalized = requireInput(value, label);
  if (normalized.startsWith("--")) {
    throw new Error(`Coding benchmark candidate qualification requires a value for ${label}.`);
  }
  return normalized;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Coding benchmark candidate qualification report requires ${label}.`);
  }
  return value;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const options = parseCodingAgentCandidateQualificationCliArguments(process.argv.slice(2));
  const report = await runCodingAgentCandidateQualificationCommand(options);
  const action = options.verify ? "verified" : "wrote";
  console.log(
    `[coding-agent-candidate-qualification] ${action} ${report.schemaVersion} ${report.decision.status}.`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-candidate-qualification] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
