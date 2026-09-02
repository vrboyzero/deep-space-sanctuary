import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { hashCodingAgentBenchmarkManifestText } from "./coding-agent-benchmark-contract.mjs";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");
export const CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-cli-tui-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_CLI_TUI_CLAIMS = Object.freeze([
  Object.freeze({ dimensionId: "cli_tui", contractId: "task_projection_cross_entry_conformance", owner: "candidateCliTuiReceipt", completion: "current_harness_task_projection_four_entry_conformance_passed" }),
  Object.freeze({ dimensionId: "cli_tui", contractId: "task_projection_terminal_action_consistency", owner: "candidateCliTuiReceipt", completion: "current_harness_task_projection_terminal_action_consistency_passed" }),
  Object.freeze({ dimensionId: "cli_tui", contractId: "task_efficiency_timeline", owner: "candidateCliTuiReceipt", completion: "current_harness_task_efficiency_timeline_complete" }),
  Object.freeze({ dimensionId: "cli_tui", contractId: "tui_accessibility_cross_platform", owner: "candidateCliTuiReceipt", completion: "current_harness_dual_platform_tui_accessibility_passed" }),
]);
const RECEIPT_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-cli-tui-evidence-receipt.schema.json");
const REFERENCE_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json");
const ARTIFACT_SCHEMA_PATHS = Object.freeze({
  taskProjection: path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/cli-tui-task-projection.schema.json"),
  efficiency: path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/cli-tui-task-efficiency.schema.json"),
  accessibility: path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/cli-tui-accessibility.schema.json"),
});
const PLATFORMS = Object.freeze(["windows-native", "wsl2-linux"]);
const EXPECTED_PATHS = Object.freeze({
  taskProjection: "candidate-evidence/cli-tui/task-projection-conformance.json",
  efficiency: "candidate-evidence/cli-tui/task-efficiency-evidence.json",
  accessibility: Object.freeze([
    "candidate-evidence/cli-tui/accessibility/windows-native.json",
    "candidate-evidence/cli-tui/accessibility/wsl2-linux.json",
  ]),
});

export async function resolveCandidateCliTuiReceiptOwner(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const expectedAggregateBinding = requireObject(input?.expectedAggregateBinding, "expectedAggregateBinding");
  const owner = requireObject(input?.owner, "owner");
  const receipt = await loadArtifact({ aggregateRoot, reference: owner.artifact, schemaPath: RECEIPT_SCHEMA_PATH, label: "candidate CLI/TUI receipt", expectedPath: "candidate-cli-tui-evidence-receipt.json" });
  const value = receipt.value;
  if (value.schemaVersion !== CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION || !jsonEqual(value.aggregate, expectedAggregateBinding) || !jsonEqual(value.sourceIdentity?.harness, expectedAggregateBinding.harness) || value.sourceIdentity?.aggregateSha256 !== sha256(JSON.stringify(value.sourceIdentity.files))) throw reject("candidate CLI/TUI receipt binding drifted");
  const projection = await loadArtifact({ aggregateRoot, reference: value.taskProjection, schemaPath: ARTIFACT_SCHEMA_PATHS.taskProjection, label: "TaskProjection conformance evidence", expectedPath: EXPECTED_PATHS.taskProjection });
  const efficiency = await loadArtifact({ aggregateRoot, reference: value.efficiency, schemaPath: ARTIFACT_SCHEMA_PATHS.efficiency, label: "Task efficiency evidence", expectedPath: EXPECTED_PATHS.efficiency });
  const accessibility = [];
  for (let index = 0; index < PLATFORMS.length; index += 1) accessibility.push(await loadArtifact({ aggregateRoot, reference: value.accessibility[index], schemaPath: ARTIFACT_SCHEMA_PATHS.accessibility, label: `TUI accessibility ${PLATFORMS[index]}`, expectedPath: EXPECTED_PATHS.accessibility[index], expectedPlatform: PLATFORMS[index] }));
  for (const artifact of [projection, efficiency, ...accessibility]) {
    if (!isSourceIdentityConsistent(artifact.value.sourceIdentity, value.sourceIdentity)) {
      throw reject("candidate CLI/TUI artifact source identity drifted");
    }
  }
  if (!hasExactSourceInventory({
    actual: collectSourceFiles({ taskProjection: projection, efficiency, accessibility }),
    expected: value.sourceIdentity.files,
  })) {
    throw reject("candidate CLI/TUI source inventory drifted");
  }
  const projectionConformance = isProjectionConformanceComplete(projection.value, expectedAggregateBinding);
  const terminalConsistency = projectionConformance && isProjectionTerminalActionConsistent(projection.value);
  const efficiencyComplete = isEfficiencyComplete(efficiency.value, expectedAggregateBinding);
  const accessibilityComplete = accessibility.every(({ value: item }) => isAccessibilityComplete(item)) && accessibility.every(({ value: item }) => jsonEqual(item.sourceIdentity?.harness, expectedAggregateBinding.harness));
  const summary = value.summary;
  if (!summary || summary.taskProjectionCrossEntryConformance !== projectionConformance || summary.taskProjectionTerminalActionConsistency !== terminalConsistency || summary.taskEfficiencyTimeline !== efficiencyComplete || summary.tuiAccessibilityCrossPlatform !== accessibilityComplete) throw reject("candidate CLI/TUI receipt summary drifted");
  return { task_projection_cross_entry_conformance: projectionConformance, task_projection_terminal_action_consistency: terminalConsistency, task_efficiency_timeline: efficiencyComplete, tui_accessibility_cross_platform: accessibilityComplete };
}

export async function runCodingAgentCandidateCliTuiReceipt(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  const outputPath = resolveInside(aggregateRoot, "candidate-cli-tui-evidence-receipt.json");
  const referencePath = resolveInside(aggregateRoot, "candidate-dimension-evidence-reference.json");
  if (await exists(outputPath)) throw reject("candidate CLI/TUI receipt owner already exists");
  const referenceText = await readBoundedRegularFile(referencePath, "candidate dimension evidence reference");
  const reference = JSON.parse(referenceText);
  await validateSchema(reference, REFERENCE_SCHEMA_PATH, "candidate dimension evidence reference");
  const aggregate = await loadCodingAgentCandidateCliTuiAggregateBinding(aggregateRoot);
  if (!jsonEqual(reference.aggregate, aggregate)) throw reject("candidate dimension evidence aggregate binding drifted");
  if (reference.owners?.candidateCliTuiReceipt !== undefined
    || reference.claims?.some(({ owner, contractId }) => owner === "candidateCliTuiReceipt" || CODING_AGENT_CANDIDATE_CLI_TUI_CLAIMS.some((claim) => claim.contractId === contractId))) {
    throw reject("candidate CLI/TUI receipt owner already exists");
  }
  const artifacts = await loadCliTuiArtifacts(aggregateRoot);
  const sourceFiles = collectSourceFiles(artifacts);
  const receipt = {
    schemaVersion: CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION,
    generatedAt,
    aggregate,
    sourceIdentity: { harness: aggregate.harness, files: sourceFiles, aggregateSha256: sha256(JSON.stringify(sourceFiles)) },
    taskProjection: artifacts.taskProjection.reference,
    efficiency: artifacts.efficiency.reference,
    accessibility: artifacts.accessibility.map(({ reference }) => reference),
    summary: {
      taskProjectionCrossEntryConformance: isProjectionConformanceComplete(artifacts.taskProjection.value, aggregate),
      taskProjectionTerminalActionConsistency: isProjectionTerminalActionConsistent(artifacts.taskProjection.value),
      taskEfficiencyTimeline: isEfficiencyComplete(artifacts.efficiency.value, aggregate),
      tuiAccessibilityCrossPlatform: artifacts.accessibility.every(({ value }) => isAccessibilityComplete(value)),
    },
  };
  await validateSchema(receipt, RECEIPT_SCHEMA_PATH, "candidate CLI/TUI receipt");
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  const updatedReference = structuredClone(reference);
  updatedReference.owners.candidateCliTuiReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: CODING_AGENT_CANDIDATE_CLI_TUI_RECEIPT_VERSION,
    artifact: { path: "candidate-cli-tui-evidence-receipt.json", sha256: sha256(receiptText) },
  };
  const insertAt = updatedReference.claims.findIndex(({ dimensionId }) => [
    "editing_testing", "session_long_running", "headless_ecosystem",
  ].includes(dimensionId));
  updatedReference.claims.splice(insertAt < 0 ? updatedReference.claims.length : insertAt, 0, ...CODING_AGENT_CANDIDATE_CLI_TUI_CLAIMS.map((claim) => ({ ...claim })));
  try {
    await fs.writeFile(outputPath, receiptText, { encoding: "utf8", flag: "wx" });
    await validateSchema(updatedReference, REFERENCE_SCHEMA_PATH, "candidate dimension evidence reference");
    await fs.writeFile(referencePath, `${JSON.stringify(updatedReference, null, 2)}\n`, "utf8");
    await resolveCandidateCliTuiReceiptOwner({ aggregateRoot, expectedAggregateBinding: aggregate, owner: updatedReference.owners.candidateCliTuiReceipt });
    return receipt;
  } catch (error) {
    await fs.writeFile(referencePath, referenceText, "utf8").catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function loadCliTuiArtifacts(aggregateRoot) {
  const taskProjection = await loadArtifact({ aggregateRoot, reference: { path: EXPECTED_PATHS.taskProjection, sha256: await hashFile(resolveInside(aggregateRoot, EXPECTED_PATHS.taskProjection)) }, schemaPath: ARTIFACT_SCHEMA_PATHS.taskProjection, label: "TaskProjection conformance evidence", expectedPath: EXPECTED_PATHS.taskProjection });
  const efficiency = await loadArtifact({ aggregateRoot, reference: { path: EXPECTED_PATHS.efficiency, sha256: await hashFile(resolveInside(aggregateRoot, EXPECTED_PATHS.efficiency)) }, schemaPath: ARTIFACT_SCHEMA_PATHS.efficiency, label: "Task efficiency evidence", expectedPath: EXPECTED_PATHS.efficiency });
  const accessibility = [];
  for (let index = 0; index < PLATFORMS.length; index += 1) accessibility.push(await loadArtifact({ aggregateRoot, reference: { path: EXPECTED_PATHS.accessibility[index], sha256: await hashFile(resolveInside(aggregateRoot, EXPECTED_PATHS.accessibility[index])) }, schemaPath: ARTIFACT_SCHEMA_PATHS.accessibility, label: `TUI accessibility ${PLATFORMS[index]}`, expectedPath: EXPECTED_PATHS.accessibility[index], expectedPlatform: PLATFORMS[index] }));
  return { taskProjection, efficiency, accessibility };
}

function collectSourceFiles(artifacts) {
  const files = new Map();
  for (const artifact of [artifacts.taskProjection, artifacts.efficiency, ...artifacts.accessibility]) {
    for (const file of artifact.value.sourceIdentity?.files ?? []) {
      if (!file || typeof file.path !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw reject("CLI/TUI source identity is invalid");
      if (files.has(file.path) && files.get(file.path) !== file.sha256) throw reject("CLI/TUI source identity collision drifted");
      files.set(file.path, file.sha256);
    }
  }
  if (files.size === 0) throw reject("CLI/TUI source identity is empty");
  return [...files.entries()].map(([filePath, digest]) => ({ path: filePath, sha256: digest })).sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadCodingAgentCandidateCliTuiAggregateBinding(root) {
  const reportText = await readBoundedRegularFile(resolveInside(root, "benchmark-report.json"), "benchmark report");
  const indexText = await readBoundedRegularFile(resolveInside(root, "baseline-index.json"), "baseline index");
  const manifestText = await readBoundedRegularFile(resolveInside(root, "task-manifest.json"), "task manifest");
  const report = JSON.parse(reportText); const index = JSON.parse(indexText); const manifest = JSON.parse(manifestText);
  if (report.schemaVersion !== "coding-agent-benchmark-report/v3" || report.status !== "completed" || index.schemaVersion !== "coding-agent-benchmark-baseline-index/v1" || manifest.schemaVersion !== "coding-agent-benchmark-manifest/v3") throw reject("current-candidate aggregate must be a completed v3 aggregate");
  const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText); const reportSha256 = sha256(reportText); const indexSha256 = sha256(indexText);
  if (report.suite?.manifestSha256 !== manifestSha256 || index.manifestSha256 !== manifestSha256 || index.report?.sha256 !== reportSha256) throw reject("current-candidate aggregate binding drifted");
  const source = requireIdentity(report.source, "source"); const harness = requireIdentity(report.harness, "harness");
  return { manifestSha256, reportSha256, indexSha256, source, harness };
}
function requireIdentity(value, label) { if (!value || typeof value !== "object" || value.workspaceDirty !== false || !/^[a-f0-9]{40}$/.test(value.commit) || !/^[a-f0-9]{64}$/.test(value.lockfileSha256) || !/^[a-f0-9]{64}$/.test(value.worktreeContentSha256)) throw reject(`${label} identity is invalid`); return value; }
async function validateSchema(value, schemaPath, label) { const compiled = compileOutputSchema(JSON.parse(await fs.readFile(schemaPath, "utf8"))); if (!compiled.ok || !compiled.validator.validateOutput(JSON.stringify(value)).ok) throw reject(`${label} schema validation failed`); }
async function hashFile(target) { return sha256(await readBoundedRegularFile(target, "candidate CLI/TUI artifact")); }
async function exists(target) { return fs.lstat(target).then(() => true, () => false); }

function isProjectionConformanceComplete(value, binding) {
  return value.schemaVersion === "task-projection-cross-entry-conformance/v1" && jsonEqual(value.aggregate, binding) && jsonEqual(value.sourceIdentity?.harness, binding.harness) && Array.isArray(value.entries) && value.entries.length === 4 && new Set(value.entries.map((entry) => entry.client)).size === 4 && value.entries.every((entry) => Array.isArray(entry.sequence) && entry.sequence.length >= 2 && entry.sequence.every((item) => typeof item.status === "string" && Array.isArray(item.allowedActions) && Number.isSafeInteger(item.observedAtMs)));
}
function isSourceIdentityConsistent(value, expected) {
  const expectedFiles = new Map((expected?.files ?? []).map((file) => [file.path, file.sha256]));
  return Boolean(value && expected)
    && jsonEqual(value.harness, expected.harness)
    && Array.isArray(value.files)
    && value.files.length > 0
    && value.aggregateSha256 === sha256(JSON.stringify(value.files))
    && value.files.every((file) => typeof file?.path === "string"
      && /^[a-f0-9]{64}$/.test(file.sha256)
      && expectedFiles.get(file.path) === file.sha256);
}
function hasExactSourceInventory(input) {
  const actual = new Map(input.actual.map((file) => [file.path, file.sha256]));
  return actual.size === input.expected.length
    && input.expected.every((file) => actual.get(file.path) === file.sha256);
}
function isProjectionTerminalActionConsistent(value) {
  const terminals = value.entries.map((entry) => entry.sequence.at(-1));
  return terminals.length === 4 && terminals.every((item) => item.status === terminals[0].status && JSON.stringify(item.allowedActions) === JSON.stringify(terminals[0].allowedActions));
}
function isEfficiencyComplete(value, binding) {
  const metrics = value.metrics;
  return value.schemaVersion === "task-efficiency-evidence/v1" && jsonEqual(value.aggregate, binding) && jsonEqual(value.sourceIdentity?.harness, binding.harness) && value.provenance?.evidenceKind === "deterministic_conformance_fixture" && value.provenance?.candidateRunEvidence === false && value.provenance?.providerCalls === 0 && value.status === "complete" && value.evidence?.status === "complete" && value.evidence.projectionTimeline?.coverage === "complete" && Array.isArray(value.evidence.projectionTimeline.items) && value.evidence.projectionTimeline.items.length >= 2 && metrics?.schemaVersion === "task-efficiency-metrics/v1" && metrics.status === "complete" && Array.isArray(metrics.missingMetrics) && metrics.missingMetrics.length === 0 && metrics.usageCompleteness?.status === "complete";
}
function isAccessibilityComplete(value) {
  return value.schemaVersion === "tui-accessibility-cross-platform/v1" && value.status === "complete" && value.observation?.schemaVersion === "tui-native-accessibility-observation/v1" && value.gate?.passed === true && value.gate.failures?.length === 0 && value.lifecycle?.residualProcessCount === 0 && value.lifecycle?.firstFrame === true && value.lifecycle?.narrowFallback === true && value.lifecycle?.wideLayoutRestored === true && value.lifecycle?.mouseTabNavigation === true && value.lifecycle?.inputReplayRendered === true && value.lifecycle?.ctrlCSent === true && value.lifecycle?.inputModesRestoredBeforeScreen === true && value.lifecycle?.stateDirRemoved === true && value.lifecycle?.exitCode === 0 && value.lifecycle?.timedOut === false && value.accessibility?.keyboardNavigation === true && value.accessibility?.focusVisible === true && value.accessibility?.labelsPresent === true;
}
async function loadArtifact(input) {
  const reference = requireObject(input.reference, `${input.label} reference`);
  if (reference.path !== input.expectedPath) throw reject(`${input.label} path binding drifted`);
  const text = await readBoundedRegularFile(resolveInside(input.aggregateRoot, reference.path), input.label);
  if (sha256(text) !== reference.sha256) throw reject(`${input.label} digest drifted`);
  const compiled = compileOutputSchema(JSON.parse(await fs.readFile(input.schemaPath, "utf8")));
  if (!compiled.ok || !compiled.validator.validateOutput(text).ok) throw reject(`${input.label} schema validation failed`);
  const value = JSON.parse(text);
  if (input.expectedPlatform !== undefined && value.platform !== input.expectedPlatform) throw reject(`${input.label} platform binding drifted`);
  return { value, text, reference };
}
async function readBoundedRegularFile(target, label) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw reject(`${label} is missing or unreadable`);
  return fs.readFile(target, "utf8");
}
function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")) throw reject("evidence path is invalid");
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw reject("evidence path escapes aggregate root");
  return target;
}
function requireObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw reject(`${label} is invalid`); return value; }
function requireString(value, label) { if (typeof value !== "string" || !value.trim()) throw reject(`${label} is required`); return value; }
function jsonEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function reject(message) { return new Error(`Coding benchmark candidate CLI/TUI receipt ${message}.`); }
