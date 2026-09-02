import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCodingAgentCandidateCodeIntelReceipt } from "./run-coding-agent-candidate-code-intel-receipt.mjs";
import {
  bootstrapCodingAgentCandidateEvidence,
  collectCandidateCliTuiEvidence,
  collectCandidateCodingRunClientEvidence,
  collectCandidateGitDeliveryEvidence,
  collectCandidateSupervisorEvidence,
  collectCandidateVerificationEvidence,
  normalizeCandidateWslWorkspaceRoot,
} from "./coding-agent-candidate-local-evidence.mjs";
import { loadCodingAgentCandidateDimensionEvidence } from "./coding-agent-candidate-score.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const REFERENCE_NAME = "candidate-dimension-evidence-reference.json";
const WSL_WORKSPACE_OWNERS = Object.freeze([
  "candidateSupervisorReceipt",
  "candidateGitDeliveryReceipt",
]);
const LOCAL_STAGES = Object.freeze([
  Object.freeze({
    id: "code_intel",
    owner: "candidateCodeIntelReceipt",
    dependency: "collectCodeIntelEvidence",
  }),
  Object.freeze({
    id: "coding_run_client",
    owner: "candidateCodingRunClientReceipt",
    dependency: "collectCodingRunClientEvidence",
  }),
  Object.freeze({
    id: "verification",
    owner: "candidateVerificationReceipt",
    dependency: "collectVerificationEvidence",
  }),
  Object.freeze({
    id: "supervisor",
    owner: "candidateSupervisorReceipt",
    dependency: "collectSupervisorEvidence",
  }),
  Object.freeze({
    id: "cli_tui",
    owner: "candidateCliTuiReceipt",
    dependency: "collectCliTuiEvidence",
  }),
  Object.freeze({
    id: "git_delivery",
    owner: "candidateGitDeliveryReceipt",
    dependency: "collectGitDeliveryEvidence",
  }),
]);

export const CODING_AGENT_CANDIDATE_LOCAL_EVIDENCE_RUN_VERSION =
  "coding-agent-benchmark-candidate-local-evidence-run/v1";

export function parseCodingAgentCandidateLocalEvidenceArguments(argv) {
  const options = { startupTimeoutSeconds: 30 };
  const valueFlags = new Set([
    "--aggregate-root",
    "--generated-at",
    "--wsl-distribution",
    "--wsl-workspace-root",
    "--chrome-path",
    "--extension-path",
    "--startup-timeout-seconds",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!valueFlags.has(flag)) throw runnerError(`unknown argument ${String(flag)}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw runnerError(`${flag} requires a value`);
    const key = {
      "--aggregate-root": "aggregateRoot",
      "--generated-at": "generatedAt",
      "--wsl-distribution": "wslDistribution",
      "--wsl-workspace-root": "wslWorkspaceRoot",
      "--chrome-path": "chromePath",
      "--extension-path": "extensionPath",
      "--startup-timeout-seconds": "startupTimeoutSeconds",
    }[flag];
    if (key !== "startupTimeoutSeconds" && options[key] !== undefined) {
      throw runnerError(`${flag} may only be provided once`);
    }
    if (key === "aggregateRoot" || key === "chromePath" || key === "extensionPath") {
      options[key] = path.resolve(value);
    } else if (key === "wslWorkspaceRoot") {
      options[key] = normalizeCandidateWslWorkspaceRoot(value);
    } else if (key === "startupTimeoutSeconds") {
      const seconds = Number(value);
      if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 120) {
        throw runnerError("--startup-timeout-seconds must be an integer from 30 to 120");
      }
      options[key] = seconds;
    } else {
      options[key] = value;
    }
    index += 1;
  }
  if (!options.aggregateRoot) throw runnerError("--aggregate-root is required");
  if (options.generatedAt !== undefined) requireIsoTimestamp(options.generatedAt);
  return options;
}

export async function runCodingAgentCandidateLocalEvidence(input, dependencies = {}) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const startupTimeoutSeconds = requireStartupTimeoutSeconds(
    input?.startupTimeoutSeconds ?? 30,
  );
  const wslWorkspaceRoot = normalizeCandidateWslWorkspaceRoot(input?.wslWorkspaceRoot);
  const operations = {
    bootstrap: dependencies.bootstrap ?? bootstrapCodingAgentCandidateEvidence,
    collectCodeIntelEvidence:
      dependencies.collectCodeIntelEvidence ?? runCodingAgentCandidateCodeIntelReceipt,
    collectCodingRunClientEvidence:
      dependencies.collectCodingRunClientEvidence ?? collectCandidateCodingRunClientEvidence,
    collectVerificationEvidence:
      dependencies.collectVerificationEvidence ?? collectCandidateVerificationEvidence,
    collectSupervisorEvidence:
      dependencies.collectSupervisorEvidence ?? collectCandidateSupervisorEvidence,
    collectCliTuiEvidence:
      dependencies.collectCliTuiEvidence ?? collectCandidateCliTuiEvidence,
    collectGitDeliveryEvidence:
      dependencies.collectGitDeliveryEvidence ?? collectCandidateGitDeliveryEvidence,
    loadState: dependencies.loadState ?? loadCandidateLocalEvidenceState,
    referenceExists: dependencies.referenceExists ?? exists,
  };
  const operationInput = {
    aggregateRoot,
    generatedAt,
    wslDistribution: input?.wslDistribution ?? "Ubuntu-22.04",
    startupTimeoutSeconds,
    ...(wslWorkspaceRoot ? { wslWorkspaceRoot } : {}),
    ...(input?.chromePath ? { chromePath: path.resolve(input.chromePath) } : {}),
    ...(input?.extensionPath ? { extensionPath: path.resolve(input.extensionPath) } : {}),
  };
  const stageResults = [];
  const referencePath = path.join(aggregateRoot, REFERENCE_NAME);
  const referencePresent = await operations.referenceExists(referencePath);
  if (!referencePresent && !wslWorkspaceRoot) {
    throw runnerError("--wsl-workspace-root is required before candidate bootstrap");
  }
  let currentState;
  if (referencePresent) {
    currentState = await operations.loadState(aggregateRoot);
    stageResults.push({ id: "bootstrap", status: "resumed" });
  } else {
    await operations.bootstrap(operationInput, dependencies);
    currentState = await operations.loadState(aggregateRoot);
    stageResults.push({ id: "bootstrap", status: "completed" });
  }
  if (!wslWorkspaceRoot && WSL_WORKSPACE_OWNERS.some(
    (owner) => currentState.reference.owners?.[owner] === undefined,
  )) {
    throw runnerError(
      "--wsl-workspace-root is required while Supervisor or Git delivery evidence is incomplete",
    );
  }

  for (const stage of LOCAL_STAGES) {
    const before = await operations.loadState(aggregateRoot);
    if (before.reference.owners?.[stage.owner] !== undefined) {
      stageResults.push({ id: stage.id, status: "resumed" });
      continue;
    }
    await operations[stage.dependency](operationInput, dependencies);
    const after = await operations.loadState(aggregateRoot);
    if (after.reference.owners?.[stage.owner] === undefined) {
      throw runnerError(`${stage.id} producer returned without binding ${stage.owner}`);
    }
    stageResults.push({ id: stage.id, status: "completed" });
  }

  const finalState = await operations.loadState(aggregateRoot);
  const privateCiBound = finalState.reference.owners?.candidateCodingRunClientCiReceipt
    !== undefined;
  return {
    schemaVersion: CODING_AGENT_CANDIDATE_LOCAL_EVIDENCE_RUN_VERSION,
    generatedAt,
    aggregate: finalState.reference.aggregate,
    stages: stageResults,
    localEvidenceStatus: "complete",
    externalRequirements: [{
      id: "private_ci",
      owner: "candidateCodingRunClientCiReceipt",
      required: true,
      status: privateCiBound ? "bound_existing_evidence" : "external_required",
      executedByRunner: false,
    }],
    providerCalls: 0,
  };
}

async function loadCandidateLocalEvidenceState(aggregateRoot) {
  const [referenceText, reportText, indexText] = await Promise.all([
    readBoundedRegularFile(path.join(aggregateRoot, REFERENCE_NAME), 4 * 1024 * 1024),
    readBoundedRegularFile(path.join(aggregateRoot, "benchmark-report.json"), 64 * 1024 * 1024),
    readBoundedRegularFile(path.join(aggregateRoot, "baseline-index.json"), 16 * 1024 * 1024),
  ]);
  const reference = parseJson(referenceText, REFERENCE_NAME);
  const report = parseJson(reportText, "benchmark-report.json");
  const baselineIndex = parseJson(indexText, "baseline-index.json");
  const resolution = await loadCodingAgentCandidateDimensionEvidence({
    aggregateRoot,
    verifiedAggregate: { report, baselineIndex },
  });
  return { reference, resolution };
}

async function readBoundedRegularFile(target, maxBytes) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()
    || stat.size < 1 || stat.size > maxBytes) {
    throw runnerError(`${path.basename(target)} is missing or unreadable`);
  }
  return fs.readFile(target, "utf8");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw runnerError(`${label} is invalid JSON`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw runnerError(`${label} is required`);
  return value;
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) throw runnerError("generatedAt is invalid");
  return timestamp;
}

function requireStartupTimeoutSeconds(value) {
  if (!Number.isSafeInteger(value) || value < 30 || value > 120) {
    throw runnerError("startupTimeoutSeconds must be an integer from 30 to 120");
  }
  return value;
}

function exists(target) {
  return fs.lstat(target).then(() => true, () => false);
}

function runnerError(message) {
  return new Error(`Coding benchmark candidate local evidence runner ${message}.`);
}

async function main() {
  const result = await runCodingAgentCandidateLocalEvidence(
    parseCodingAgentCandidateLocalEvidenceArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  main().catch((error) => {
    process.stderr.write(`[coding-agent-candidate-local-evidence] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
