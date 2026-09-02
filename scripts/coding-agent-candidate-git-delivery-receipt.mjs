import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { hashCodingAgentBenchmarkManifestText } from "./coding-agent-benchmark-contract.mjs";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-git-delivery-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS = Object.freeze([
  Object.freeze({ dimensionId: "git_delivery", contractId: "multi_repository_worktree_soak", owner: "candidateGitDeliveryReceipt", completion: "current_harness_multi_repository_worktree_soak_passed" }),
  Object.freeze({ dimensionId: "git_delivery", contractId: "review_remediation_loop", owner: "candidateGitDeliveryReceipt", completion: "current_harness_review_remediation_loop_passed" }),
  Object.freeze({ dimensionId: "git_delivery", contractId: "remote_delivery_authority_separation", owner: "candidateGitDeliveryReceipt", completion: "current_harness_remote_delivery_authority_separation_passed" }),
  Object.freeze({ dimensionId: "git_delivery", contractId: "delivery_recovery_audit_matrix", owner: "candidateGitDeliveryReceipt", completion: "current_harness_delivery_recovery_audit_matrix_passed" }),
]);

const RECEIPT_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-git-delivery-evidence-receipt.schema.json");
const ARTIFACT_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/git-delivery-evidence.schema.json");
const SYSTEM_EVIDENCE_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/system-evidence.schema.json");
const REFERENCE_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json");
const EXPECTED_ARTIFACTS = Object.freeze({
  worktreeSoak: "candidate-evidence/git-delivery/multi-repository-worktree-soak.json",
  reviewRemediation: "candidate-evidence/git-delivery/review-remediation-loop.json",
  remoteAuthority: "candidate-evidence/git-delivery/remote-delivery-authority-separation.json",
  recoveryAudit: "candidate-evidence/git-delivery/delivery-recovery-audit-matrix.json",
});
const EXPECTED_KINDS = Object.freeze({
  worktreeSoak: "multi_repository_worktree_soak",
  reviewRemediation: "review_remediation_loop",
  remoteAuthority: "remote_delivery_authority_separation",
  recoveryAudit: "delivery_recovery_audit_matrix",
});
const EXPECTED_REPOSITORIES = Object.freeze(["star-sanctuary", "reference-repository"]);
const EXPECTED_PLATFORMS = Object.freeze(["windows-native", "wsl2-linux"]);

export async function resolveCandidateGitDeliveryReceiptOwner(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const expectedAggregateBinding = requireObject(input?.expectedAggregateBinding, "expectedAggregateBinding");
  const owner = requireObject(input?.owner, "owner");
  const receipt = await loadArtifact({
    aggregateRoot,
    reference: owner.artifact,
    schemaPath: RECEIPT_SCHEMA_PATH,
    label: "candidate Git delivery receipt",
    expectedPath: "candidate-git-delivery-evidence-receipt.json",
  });
  const value = receipt.value;
  if (value.schemaVersion !== CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION
    || !jsonEqual(value.aggregate, expectedAggregateBinding)
    || !isSourceIdentityConsistent(value.sourceIdentity, expectedAggregateBinding.harness)
    || value.sourceIdentity.aggregateSha256 !== sha256(JSON.stringify(value.sourceIdentity.files))) {
    throw reject("candidate Git delivery receipt binding drifted");
  }
  const artifacts = {};
  for (const [key, expectedKind] of Object.entries(EXPECTED_KINDS)) {
    artifacts[key] = await loadArtifact({
      aggregateRoot,
      reference: value[key],
      schemaPath: ARTIFACT_SCHEMA_PATH,
      label: `candidate Git delivery ${key}`,
      expectedPath: EXPECTED_ARTIFACTS[key],
    });
    const artifact = artifacts[key].value;
    if (artifact.artifactKind !== expectedKind
      || !jsonEqual(artifact.aggregate, expectedAggregateBinding)
      || !isSourceIdentityConsistent(artifact.sourceIdentity, expectedAggregateBinding.harness)
      || !jsonEqual(artifact.sourceIdentity.harness, value.sourceIdentity.harness)) {
      throw reject("candidate Git delivery artifact binding drifted");
    }
  }
  const sourceFiles = collectSourceFiles(Object.values(artifacts));
  if (!hasExactSourceInventory(sourceFiles, value.sourceIdentity.files)) {
    throw reject("candidate Git delivery source inventory drifted");
  }
  await validateRecoveryAudit({ aggregateRoot, artifact: artifacts.recoveryAudit.value, expectedAggregateBinding });
  const summary = value.summary;
  const completion = {
    multi_repository_worktree_soak: isWorktreeSoakComplete(artifacts.worktreeSoak.value),
    review_remediation_loop: isReviewRemediationComplete(artifacts.reviewRemediation.value),
    remote_delivery_authority_separation: isRemoteAuthorityComplete(artifacts.remoteAuthority.value),
    delivery_recovery_audit_matrix: isRecoveryAuditComplete(artifacts.recoveryAudit.value),
  };
  if (!summary || summary.multiRepositoryWorktreeSoak !== completion.multi_repository_worktree_soak
    || summary.reviewRemediationLoop !== completion.review_remediation_loop
    || summary.remoteDeliveryAuthoritySeparation !== completion.remote_delivery_authority_separation
    || summary.deliveryRecoveryAuditMatrix !== completion.delivery_recovery_audit_matrix) {
    throw reject("candidate Git delivery receipt summary drifted");
  }
  return completion;
}

export async function runCodingAgentCandidateGitDeliveryReceipt(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  const outputPath = resolveInside(aggregateRoot, "candidate-git-delivery-evidence-receipt.json");
  const referencePath = resolveInside(aggregateRoot, "candidate-dimension-evidence-reference.json");
  if (await exists(outputPath)) throw reject("candidate Git delivery receipt owner already exists");
  const referenceText = await readBoundedRegularFile(referencePath, "candidate dimension evidence reference");
  const reference = JSON.parse(referenceText);
  await validateSchema(reference, REFERENCE_SCHEMA_PATH, "candidate dimension evidence reference");
  const aggregate = await loadAggregateBinding(aggregateRoot);
  if (!jsonEqual(reference.aggregate, aggregate)) throw reject("candidate dimension evidence aggregate binding drifted");
  if (reference.owners?.candidateGitDeliveryReceipt !== undefined
    || reference.claims?.some(({ owner, contractId }) => owner === "candidateGitDeliveryReceipt" || CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS.some((claim) => claim.contractId === contractId))) {
    throw reject("candidate Git delivery receipt owner already exists");
  }
  const artifacts = await loadGitDeliveryArtifacts(aggregateRoot, aggregate);
  const sourceFiles = collectSourceFiles(Object.values(artifacts));
  const receipt = {
    schemaVersion: CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION,
    generatedAt,
    aggregate,
    sourceIdentity: { harness: aggregate.harness, files: sourceFiles, aggregateSha256: sha256(JSON.stringify(sourceFiles)) },
    worktreeSoak: artifacts.worktreeSoak.reference,
    reviewRemediation: artifacts.reviewRemediation.reference,
    remoteAuthority: artifacts.remoteAuthority.reference,
    recoveryAudit: artifacts.recoveryAudit.reference,
    summary: {
      multiRepositoryWorktreeSoak: isWorktreeSoakComplete(artifacts.worktreeSoak.value),
      reviewRemediationLoop: isReviewRemediationComplete(artifacts.reviewRemediation.value),
      remoteDeliveryAuthoritySeparation: isRemoteAuthorityComplete(artifacts.remoteAuthority.value),
      deliveryRecoveryAuditMatrix: isRecoveryAuditComplete(artifacts.recoveryAudit.value),
    },
  };
  await validateSchema(receipt, RECEIPT_SCHEMA_PATH, "candidate Git delivery receipt");
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  const updatedReference = structuredClone(reference);
  updatedReference.owners.candidateGitDeliveryReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION,
    artifact: { path: "candidate-git-delivery-evidence-receipt.json", sha256: sha256(receiptText) },
  };
  const insertAt = updatedReference.claims.findIndex(({ dimensionId }) => [
    "editing_testing", "session_long_running", "headless_ecosystem",
  ].includes(dimensionId));
  updatedReference.claims.splice(insertAt < 0 ? updatedReference.claims.length : insertAt, 0,
    ...CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS.map((claim) => ({ ...claim })));
  try {
    await fs.writeFile(outputPath, receiptText, { encoding: "utf8", flag: "wx" });
    await validateSchema(updatedReference, REFERENCE_SCHEMA_PATH, "candidate dimension evidence reference");
    await fs.writeFile(referencePath, `${JSON.stringify(updatedReference, null, 2)}\n`, "utf8");
    await resolveCandidateGitDeliveryReceiptOwner({ aggregateRoot, expectedAggregateBinding: aggregate, owner: updatedReference.owners.candidateGitDeliveryReceipt });
    return receipt;
  } catch (error) {
    await fs.writeFile(referencePath, referenceText, "utf8").catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function loadGitDeliveryArtifacts(aggregateRoot, aggregate) {
  const result = {};
  for (const [key, relativePath] of Object.entries(EXPECTED_ARTIFACTS)) {
    const target = resolveInside(aggregateRoot, relativePath);
    const text = await readBoundedRegularFile(target, `candidate Git delivery ${key}`);
    const value = JSON.parse(text);
    await validateSchema(value, ARTIFACT_SCHEMA_PATH, `candidate Git delivery ${key}`);
    if (!jsonEqual(value.aggregate, aggregate)) throw reject("candidate Git delivery artifact aggregate drifted");
    result[key] = { value, text, reference: { path: relativePath, sha256: sha256(text) } };
  }
  return result;
}

function collectSourceFiles(artifacts) {
  const files = new Map();
  for (const artifact of artifacts) {
    for (const file of artifact.value.sourceIdentity?.files ?? []) {
      if (!file || typeof file.path !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw reject("Git delivery source identity is invalid");
      if (files.has(file.path) && files.get(file.path) !== file.sha256) throw reject("Git delivery source identity collision drifted");
      files.set(file.path, file.sha256);
    }
  }
  if (files.size === 0) throw reject("Git delivery source identity is empty");
  return [...files.entries()].map(([filePath, digest]) => ({ path: filePath, sha256: digest })).sort((a, b) => a.path.localeCompare(b.path));
}

function isSourceIdentityConsistent(identity, harness) {
  return Boolean(identity && jsonEqual(identity.harness, harness) && Array.isArray(identity.files) && identity.files.length > 0)
    && identity.aggregateSha256 === sha256(JSON.stringify(identity.files))
    && identity.files.every((file) => isSafeRelativePath(file?.path) && /^[a-f0-9]{64}$/.test(file.sha256));
}
function hasExactSourceInventory(actual, expected) {
  return actual.length === expected.length && actual.every((file, index) => file.path === expected[index].path && file.sha256 === expected[index].sha256);
}
function isWorktreeSoakComplete(value) {
  return value.status === "complete" && value.gate?.passed === true && value.gate.failures?.length === 0
    && jsonEqual(value.repositories, EXPECTED_REPOSITORIES) && hasPlatformPasses(value.platforms)
    && hasExactPlatformObservations(value.observations)
    && value.observations.every(({ dirty, residualWorktreeCount, mutationCount }) => dirty === false && residualWorktreeCount === 0 && mutationCount === 0);
}
function isReviewRemediationComplete(value) {
  return value.status === "complete" && value.gate?.passed === true && value.gate.failures?.length === 0
    && hasPlatformPasses(value.platforms) && hasExactPlatformObservations(value.observations)
    && value.observations.every(({ reviewVerdict, remediationApplied, recheckVerdict, diffHashStable }) => reviewVerdict === "needs_changes" && remediationApplied === true && recheckVerdict === "approved" && diffHashStable === true);
}
function isRemoteAuthorityComplete(value) {
  return value.status === "complete" && value.gate?.passed === true && value.gate.failures?.length === 0
    && jsonEqual(value.repositories, EXPECTED_REPOSITORIES) && hasPlatformPasses(value.platforms)
    && value.authority?.delegable === false && value.authority?.rememberable === false && value.authority?.userApprovalRequired === true
    && value.authority?.remoteWritePerformed === false && value.authority?.credentialsRead === false
    && Array.isArray(value.targets) && value.targets.length === EXPECTED_REPOSITORIES.length
    && value.targets.every(({ remoteUrlHash, branch, baseBranch }) => /^[a-f0-9]{64}$/.test(remoteUrlHash) && branch === "main" && baseBranch === "main");
}
function isRecoveryAuditComplete(value) {
  return value.status === "complete" && value.gate?.passed === true && value.gate.failures?.length === 0
    && hasPlatformPasses(value.platforms) && hasExactPlatformObservations(value.observations)
    && value.observations.every(({ parallelWrite, restartDelivery }) => parallelWrite?.fanInConfirmed === true && parallelWrite?.mainWorkspaceChangedBeforeFanIn === false && parallelWrite?.conflictDetected === true && restartDelivery?.reattached === true && restartDelivery?.replayedSideEffectCount === 0 && restartDelivery?.remoteWriteCount === 0 && restartDelivery?.terminalStatus === "completed");
}
function hasPlatformPasses(platforms) {
  return Array.isArray(platforms) && platforms.length === 2
    && JSON.stringify(platforms.map(({ platform }) => platform).sort()) === JSON.stringify([...EXPECTED_PLATFORMS].sort())
    && platforms.every(({ platform, passed }) => EXPECTED_PLATFORMS.includes(platform) && passed === true);
}
function hasExactPlatformObservations(observations) {
  return Array.isArray(observations) && observations.length === EXPECTED_PLATFORMS.length
    && JSON.stringify(observations.map(({ platform }) => platform).sort()) === JSON.stringify([...EXPECTED_PLATFORMS].sort());
}

async function validateRecoveryAudit(input) {
  const refs = input.artifact.systemEvidence;
  if (!Array.isArray(refs) || refs.length !== 4) throw reject("delivery recovery system evidence references are incomplete");
  const reportText = await readBoundedRegularFile(resolveInside(input.aggregateRoot, "benchmark-report.json"), "benchmark report");
  if (sha256(reportText) !== input.expectedAggregateBinding.reportSha256) throw reject("delivery recovery aggregate report drifted");
  const report = JSON.parse(reportText);
  const observedKeys = new Set();
  for (const reference of refs) {
    const text = await readBoundedRegularFile(resolveInside(input.aggregateRoot, reference.path), "delivery recovery system evidence");
    if (sha256(text) !== reference.sha256) throw reject("delivery recovery system evidence digest drifted");
    const compiled = compileOutputSchema(JSON.parse(await fs.readFile(SYSTEM_EVIDENCE_SCHEMA_PATH, "utf8")));
    if (!compiled.ok || !compiled.validator.validateOutput(text).ok) throw reject("delivery recovery system evidence schema drifted");
    const value = JSON.parse(text);
    if (value.schemaVersion !== "coding-agent-benchmark-system-evidence/v1" || value.status !== "passed") {
      throw reject("delivery recovery system evidence schema or status drifted");
    }
    if (!["system.parallel-write-fan-in", "system.restart-delivery-reconciliation"].includes(value.taskId)
      || !EXPECTED_PLATFORMS.includes(value.platform)) throw reject("delivery recovery system evidence binding drifted");
    const run = report.runs?.find(({ runId }) => runId === value.runId);
    if (!run || run.taskId !== value.taskId || run.platform !== value.platform
      || run.artifacts?.systemEvidence !== reference.path) throw reject("delivery recovery system evidence run binding drifted");
    observedKeys.add(`${value.taskId}:${value.platform}`);
  }
  const expectedKeys = ["system.parallel-write-fan-in", "system.restart-delivery-reconciliation"]
    .flatMap((taskId) => EXPECTED_PLATFORMS.map((platform) => `${taskId}:${platform}`));
  if (observedKeys.size !== expectedKeys.length || expectedKeys.some((key) => !observedKeys.has(key))) throw reject("delivery recovery system evidence pair drifted");
}

async function loadAggregateBinding(root) {
  const reportText = await readBoundedRegularFile(resolveInside(root, "benchmark-report.json"), "benchmark report");
  const indexText = await readBoundedRegularFile(resolveInside(root, "baseline-index.json"), "baseline index");
  const manifestText = await readBoundedRegularFile(resolveInside(root, "task-manifest.json"), "task manifest");
  const report = JSON.parse(reportText); const index = JSON.parse(indexText); const manifest = JSON.parse(manifestText);
  const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
  if (report.schemaVersion !== "coding-agent-benchmark-report/v3" || report.status !== "completed" || index.schemaVersion !== "coding-agent-benchmark-baseline-index/v1" || manifest.schemaVersion !== "coding-agent-benchmark-manifest/v3" || report.suite?.manifestSha256 !== manifestSha256 || index.manifestSha256 !== manifestSha256 || index.report?.sha256 !== sha256(reportText)) throw reject("current-candidate aggregate binding drifted");
  requireIdentity(report.source, "source"); requireIdentity(report.harness, "harness");
  return { manifestSha256, reportSha256: sha256(reportText), indexSha256: sha256(indexText), source: report.source, harness: report.harness };
}
function requireIdentity(value, label) { if (!value || value.workspaceDirty !== false || !/^[a-f0-9]{40}$/.test(value.commit) || !/^[a-f0-9]{64}$/.test(value.lockfileSha256) || !/^[a-f0-9]{64}$/.test(value.worktreeContentSha256)) throw reject(`${label} identity is invalid`); }
async function validateSchema(value, schemaPath, label) { const compiled = compileOutputSchema(JSON.parse(await fs.readFile(schemaPath, "utf8"))); const result = compiled.ok ? compiled.validator.validateOutput(JSON.stringify(value)) : { ok: false }; if (!compiled.ok || !result.ok) throw reject(`${label} schema validation failed`); }
async function loadArtifact(input) { const reference = requireObject(input.reference, `${input.label} reference`); if (reference.path !== input.expectedPath) throw reject(`${input.label} path binding drifted`); const text = await readBoundedRegularFile(resolveInside(input.aggregateRoot, reference.path), input.label); if (sha256(text) !== reference.sha256) throw reject(`${input.label} digest drifted`); const value = JSON.parse(text); await validateSchema(value, input.schemaPath, input.label); return { value, text, reference }; }
async function readBoundedRegularFile(target, label) { const stat = await fs.lstat(target).catch(() => null); if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw reject(`${label} is missing or unreadable`); return fs.readFile(target, "utf8"); }
function resolveInside(root, relativePath) { if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")) throw reject("evidence path is invalid"); const target = path.resolve(root, ...relativePath.split("/")); const relative = path.relative(root, target); if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw reject("evidence path escapes aggregate root"); return target; }
function requireObject(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw reject(`${label} is invalid`); return value; }
function requireString(value, label) { if (typeof value !== "string" || !value.trim()) throw reject(`${label} is required`); return value; }
function jsonEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function isSafeRelativePath(value) { return typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:\//.test(value) && !value.split("/").some((part) => !part || part === ".."); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function exists(target) { return fs.lstat(target).then(() => true, () => false); }
function reject(message) { return new Error(`Coding benchmark candidate Git delivery receipt ${message}.`); }
