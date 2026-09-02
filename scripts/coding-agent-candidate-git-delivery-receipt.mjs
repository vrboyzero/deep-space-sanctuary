import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { hashCodingAgentBenchmarkManifestText } from "./coding-agent-benchmark-contract.mjs";
import { projectStructuredTestReport } from "./verification-test-report-adapter.mjs";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-git-delivery-evidence-receipt/v1";
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_COMMAND =
  "corepack pnpm verify:p2c-git-delivery-audit";
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/managed-worktree.test.ts",
  "packages/belldandy-core/src/user-worktree-runtime.test.ts",
  "packages/belldandy-core/src/workspace-change-review.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts",
  "packages/belldandy-core/src/server-methods/remote-delivery.test.ts",
  "packages/belldandy-core/src/remote-delivery-runtime.test.ts",
  "packages/belldandy-core/src/remote-delivery-process-recovery.test.ts",
  "packages/belldandy-core/src/user-worktree-process-recovery.test.ts",
]);
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_GROUPS = Object.freeze({
  worktreeSoak: Object.freeze(CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.slice(0, 2)),
  reviewRemediation: Object.freeze(CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.slice(2, 5)),
  remoteAuthority: Object.freeze(CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.slice(5, 7)),
  recoveryAudit: Object.freeze(CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.slice(7, 9)),
});
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_SOURCE_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/reconciliation-journal.ts",
  "packages/belldandy-core/src/managed-worktree.test.ts",
  "packages/belldandy-core/src/managed-worktree.ts",
  "packages/belldandy-core/src/remote-delivery-process-recovery.test.ts",
  "packages/belldandy-core/src/remote-delivery-runtime.test.ts",
  "packages/belldandy-core/src/remote-delivery-runtime.ts",
  "packages/belldandy-core/src/server-methods/remote-delivery.test.ts",
  "packages/belldandy-core/src/server-methods/remote-delivery.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-resolution-runtime.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.test.ts",
  "packages/belldandy-core/src/subtask-supervisor-fan-in-runtime.ts",
  "packages/belldandy-core/src/user-worktree-process-recovery.test.ts",
  "packages/belldandy-core/src/user-worktree-runtime.test.ts",
  "packages/belldandy-core/src/user-worktree-runtime.ts",
  "packages/belldandy-core/src/workspace-change-review.test.ts",
  "packages/belldandy-core/src/workspace-change-review.ts",
  "scripts/coding-agent-candidate-git-delivery-receipt.mjs",
  "scripts/coding-agent-candidate-local-evidence.mjs",
]);
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_ARTIFACT_PATHS = Object.freeze({
  worktreeSoak: "candidate-evidence/git-delivery/multi-repository-worktree-soak.json",
  reviewRemediation: "candidate-evidence/git-delivery/review-remediation-loop.json",
  remoteAuthority: "candidate-evidence/git-delivery/remote-delivery-authority-separation.json",
  recoveryAudit: "candidate-evidence/git-delivery/delivery-recovery-audit-matrix.json",
});
export const CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_PATHS = Object.freeze({
  "windows-native": Object.freeze({
    report: "candidate-evidence/git-delivery/audit-windows-native-vitest-report.json",
    dag: "candidate-evidence/git-delivery/audit-windows-native-verification-dag.json",
  }),
  "wsl2-linux": Object.freeze({
    report: "candidate-evidence/git-delivery/audit-wsl2-linux-vitest-report.json",
    dag: "candidate-evidence/git-delivery/audit-wsl2-linux-verification-dag.json",
  }),
});
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
const VERIFICATION_DAG_SCHEMA_PATH = path.join(WORKSPACE_ROOT, "benchmarks/verification/v1/verification-dag.schema.json");
const EXPECTED_KINDS = Object.freeze({
  worktreeSoak: "multi_repository_worktree_soak",
  reviewRemediation: "review_remediation_loop",
  remoteAuthority: "remote_delivery_authority_separation",
  recoveryAudit: "delivery_recovery_audit_matrix",
});
const EXPECTED_REPOSITORIES = Object.freeze(["star-sanctuary", "reference-repository"]);
const EXPECTED_PLATFORMS = Object.freeze(["windows-native", "wsl2-linux"]);

export function createCandidateGitDeliveryRemoteTargets(harness) {
  return EXPECTED_REPOSITORIES.map((repository) => ({
    remoteUrlHash: sha256([
      "coding-agent-candidate-git-delivery-local-fixture-target/v1",
      harness.commit,
      repository,
    ].join("\0")),
    branch: "main",
    baseBranch: "main",
  }));
}

export function projectCandidateGitDeliveryPlatformResults(report) {
  requireExactAuditSelection(report);
  return Object.fromEntries(Object.entries(CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_GROUPS)
    .map(([key, files]) => [key, areAuditFilesComplete(report, files)]));
}

export async function projectCandidateGitDeliveryRecoveryObservations(input) {
  return validateRecoveryAudit({
    aggregateRoot: path.resolve(requireString(input?.aggregateRoot, "aggregateRoot")),
    artifact: { systemEvidence: input?.systemEvidence },
    expectedAggregateBinding: requireObject(input?.aggregate, "aggregate"),
  });
}

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
    || !hasExactSourcePaths(value.sourceIdentity.files)) {
    throw reject("candidate Git delivery receipt binding drifted");
  }
  const artifacts = await loadGitDeliveryArtifacts(aggregateRoot, expectedAggregateBinding);
  const sourceFiles = collectSourceFiles(Object.values(artifacts));
  if (!hasExactSourceInventory(sourceFiles, value.sourceIdentity.files)) {
    throw reject("candidate Git delivery source inventory drifted");
  }
  const completion = await resolveGitDeliveryCompletion({
    aggregateRoot,
    aggregate: expectedAggregateBinding,
    artifacts,
  });
  const summary = value.summary;
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
  const reference = parseJson(referenceText, "candidate dimension evidence reference");
  await validateSchema(reference, REFERENCE_SCHEMA_PATH, "candidate dimension evidence reference");
  const aggregate = await loadAggregateBinding(aggregateRoot);
  if (!jsonEqual(reference.aggregate, aggregate)) throw reject("candidate dimension evidence aggregate binding drifted");
  if (reference.owners?.candidateGitDeliveryReceipt !== undefined
    || reference.claims?.some(({ owner, contractId }) => owner === "candidateGitDeliveryReceipt" || CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS.some((claim) => claim.contractId === contractId))) {
    throw reject("candidate Git delivery receipt owner already exists");
  }
  const artifacts = await loadGitDeliveryArtifacts(aggregateRoot, aggregate);
  const completion = await resolveGitDeliveryCompletion({ aggregateRoot, aggregate, artifacts });
  const sourceFiles = collectSourceFiles(Object.values(artifacts));
  const receipt = {
    schemaVersion: CODING_AGENT_CANDIDATE_GIT_DELIVERY_RECEIPT_VERSION,
    generatedAt,
    aggregate,
    sourceIdentity: {
      harness: aggregate.harness,
      files: sourceFiles,
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
    },
    worktreeSoak: artifacts.worktreeSoak.reference,
    reviewRemediation: artifacts.reviewRemediation.reference,
    remoteAuthority: artifacts.remoteAuthority.reference,
    recoveryAudit: artifacts.recoveryAudit.reference,
    summary: {
      multiRepositoryWorktreeSoak: completion.multi_repository_worktree_soak,
      reviewRemediationLoop: completion.review_remediation_loop,
      remoteDeliveryAuthoritySeparation: completion.remote_delivery_authority_separation,
      deliveryRecoveryAuditMatrix: completion.delivery_recovery_audit_matrix,
    },
  };
  await validateSchema(receipt, RECEIPT_SCHEMA_PATH, "candidate Git delivery receipt");
  const receiptText = serializeJson(receipt);
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
  updatedReference.claims.splice(
    insertAt < 0 ? updatedReference.claims.length : insertAt,
    0,
    ...CODING_AGENT_CANDIDATE_GIT_DELIVERY_CLAIMS.map((claim) => ({ ...claim })),
  );
  await validateSchema(updatedReference, REFERENCE_SCHEMA_PATH, "candidate dimension evidence reference");
  const updatedReferenceText = serializeJson(updatedReference);
  let receiptWritten = false;
  let referenceWritten = false;
  try {
    await requireReferenceUnchanged(referencePath, referenceText);
    await fs.writeFile(outputPath, receiptText, { encoding: "utf8", flag: "wx" });
    receiptWritten = true;
    await requireReferenceUnchanged(referencePath, referenceText);
    await fs.writeFile(referencePath, updatedReferenceText, "utf8");
    referenceWritten = true;
    await resolveCandidateGitDeliveryReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding: aggregate,
      owner: updatedReference.owners.candidateGitDeliveryReceipt,
    });
    return receipt;
  } catch (error) {
    if (referenceWritten) {
      const currentText = await fs.readFile(referencePath, "utf8").catch(() => null);
      if (currentText === updatedReferenceText) {
        await fs.writeFile(referencePath, referenceText, "utf8").catch(() => {});
      }
    }
    if (receiptWritten) await fs.rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function loadGitDeliveryArtifacts(aggregateRoot, aggregate) {
  const result = {};
  for (const [key, relativePath] of Object.entries(CODING_AGENT_CANDIDATE_GIT_DELIVERY_ARTIFACT_PATHS)) {
    const target = resolveInside(aggregateRoot, relativePath);
    const text = await readBoundedRegularFile(target, `candidate Git delivery ${key}`);
    const value = parseJson(text, `candidate Git delivery ${key}`);
    await validateSchema(value, ARTIFACT_SCHEMA_PATH, `candidate Git delivery ${key}`);
    if (value.artifactKind !== EXPECTED_KINDS[key]
      || !jsonEqual(value.aggregate, aggregate)
      || !isSourceIdentityConsistent(value.sourceIdentity, aggregate.harness)
      || !hasExactSourcePaths(value.sourceIdentity.files)) {
      throw reject("candidate Git delivery artifact binding drifted");
    }
    result[key] = { value, text, reference: { path: relativePath, sha256: sha256(text) } };
  }
  return result;
}

async function resolveGitDeliveryCompletion(input) {
  const artifactValues = Object.fromEntries(Object.entries(input.artifacts).map(
    ([key, artifact]) => [key, artifact.value],
  ));
  const canonicalAudit = artifactValues.worktreeSoak.audit;
  if (Object.values(artifactValues).some((artifact) => !jsonEqual(artifact.audit, canonicalAudit))) {
    throw reject("candidate Git delivery native audit references drifted");
  }
  const audit = await resolveGitDeliveryAudit({
    aggregateRoot: input.aggregateRoot,
    harness: input.aggregate.harness,
    audit: canonicalAudit,
  });
  for (const [key, artifact] of Object.entries(artifactValues)) {
    requireArtifactResultBinding(key, artifact, audit.groups[key]);
  }
  const recoveryObservations = await validateRecoveryAudit({
    aggregateRoot: input.aggregateRoot,
    artifact: artifactValues.recoveryAudit,
    expectedAggregateBinding: input.aggregate,
  });
  if (!jsonEqual(artifactValues.recoveryAudit.observations, recoveryObservations)) {
    throw reject("delivery recovery observations drifted from system evidence");
  }
  return {
    multi_repository_worktree_soak:
      isWorktreeSoakComplete(artifactValues.worktreeSoak, audit.groups.worktreeSoak),
    review_remediation_loop:
      isReviewRemediationComplete(artifactValues.reviewRemediation, audit.groups.reviewRemediation),
    remote_delivery_authority_separation:
      isRemoteAuthorityComplete(artifactValues.remoteAuthority, audit.groups.remoteAuthority, input.aggregate.harness),
    delivery_recovery_audit_matrix:
      isRecoveryAuditComplete(artifactValues.recoveryAudit, audit.groups.recoveryAudit),
  };
}

async function resolveGitDeliveryAudit(input) {
  const audit = requireObject(input.audit, "candidate Git delivery native audit");
  if (audit.command !== CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_COMMAND
    || !jsonEqual(audit.testFiles, CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES)
    || !Array.isArray(audit.runs) || audit.runs.length !== EXPECTED_PLATFORMS.length) {
    throw reject("candidate Git delivery native audit binding drifted");
  }
  const groups = Object.fromEntries(Object.keys(CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_GROUPS)
    .map((key) => [key, []]));
  for (let index = 0; index < EXPECTED_PLATFORMS.length; index += 1) {
    const platform = EXPECTED_PLATFORMS[index];
    const run = audit.runs[index];
    const expectedPaths = CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_PATHS[platform];
    if (run?.platform !== platform
      || run.verificationDag?.artifactSchemaVersion !== "verification-dag/v1"
      || run.verificationDag?.path !== expectedPaths.dag
      || run.nativeTestReport?.framework !== "vitest"
      || run.nativeTestReport?.format !== "vitest-json/v3.2.7"
      || run.nativeTestReport?.runnerVersion !== "3.2.7"
      || run.nativeTestReport?.path !== expectedPaths.report) {
      throw reject("candidate Git delivery native audit platform binding drifted");
    }
    const [dagText, reportText] = await Promise.all([
      readBoundedRegularFile(
        resolveInside(input.aggregateRoot, run.verificationDag.path),
        `candidate Git delivery ${platform} Verification DAG`,
      ),
      readBoundedRegularFile(
        resolveInside(input.aggregateRoot, run.nativeTestReport.path),
        `candidate Git delivery ${platform} native test report`,
      ),
    ]);
    if (sha256(dagText) !== run.verificationDag.sha256
      || sha256(reportText) !== run.nativeTestReport.sha256) {
      throw reject("candidate Git delivery native audit digest drifted");
    }
    const dag = parseJson(dagText, `candidate Git delivery ${platform} Verification DAG`);
    await validateSchema(
      dag,
      VERIFICATION_DAG_SCHEMA_PATH,
      `candidate Git delivery ${platform} Verification DAG`,
    );
    const report = parseJson(reportText, `candidate Git delivery ${platform} native test report`);
    const projectedReport = projectStructuredTestReport({
      framework: run.nativeTestReport.framework,
      format: run.nativeTestReport.format,
      runnerVersion: run.nativeTestReport.runnerVersion,
      artifact: {
        path: run.nativeTestReport.path,
        sha256: run.nativeTestReport.sha256,
      },
      content: reportText,
    });
    requireExactAuditSelection(report);
    requireAuditDagBinding({ dag, harness: input.harness, platform, projectedReport });
    const groupResults = projectCandidateGitDeliveryPlatformResults(report);
    for (const [key, passed] of Object.entries(groupResults)) {
      groups[key].push({ platform, passed });
    }
    if ((projectedReport.status === "passed") !== Object.values(groupResults).every(Boolean)) {
      throw reject("candidate Git delivery native audit terminal summary drifted");
    }
  }
  return { groups };
}

function requireExactAuditSelection(report) {
  if (!Array.isArray(report?.testResults)
    || report.testResults.length !== CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.length) {
    throw reject("candidate Git delivery native audit test selection drifted");
  }
  const selected = report.testResults.map((result) => {
    const normalized = typeof result?.name === "string" ? result.name.replaceAll("\\", "/") : "";
    return CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    ) ?? null;
  });
  if (selected.some((testFile) => testFile === null)
    || new Set(selected).size !== CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.length
    || !jsonEqual([...selected].sort(), [...CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES].sort())) {
    throw reject("candidate Git delivery native audit test selection drifted");
  }
}

function requireAuditDagBinding(input) {
  const [node] = input.dag.nodes ?? [];
  const [attempt] = node?.attempts ?? [];
  if (input.dag.runId !== `candidate-git-delivery-${input.platform}-audit`
    || input.dag.taskId !== "p2c-git-delivery-audit"
    || input.dag.revision?.commit !== input.harness.commit
    || input.dag.revision?.workspaceHash !== input.harness.worktreeContentSha256
    || input.dag.nodes.length !== 1
    || node.id !== "git-delivery.audit"
    || node.kind !== "acceptance"
    || node.scope !== "full"
    || node.required !== true
    || node.command !== CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_COMMAND
    || node.dependsOn.length !== 0
    || node.attempts.length !== 1
    || !jsonEqual(attempt?.testReport, input.projectedReport.evidence)
    || input.dag.execution?.commandsExecuted !== false
    || input.dag.execution?.providerCalls !== 0
    || input.dag.execution?.mutationCount !== 0
    || input.dag.execution?.replay?.authority !== "command-job"
    || input.dag.execution?.replay?.source !== "terminal-snapshot"
    || input.dag.execution?.replay?.snapshotCount !== 1
    || input.dag.execution?.replay?.terminalOnly !== true
    || input.dag.execution?.replay?.testReportCount !== 1) {
    throw reject("candidate Git delivery native audit DAG binding drifted");
  }
  const commandJob = attempt.commandJob;
  const outcome = input.dag.outcome;
  const passed = input.projectedReport.status === "passed"
    && node.status === "passed"
    && attempt.status === "passed"
    && commandJob?.status === "completed"
    && commandJob?.exit?.taxonomy === "zero_exit"
    && commandJob?.exit?.exitCode === 0
    && commandJob?.exit?.signal === null
    && commandJob?.recoveryLifecycle === "settled"
    && outcome?.taskStatus === "completed"
    && outcome?.verificationStatus === "passed"
    && outcome?.reason === "all_required_passed"
    && outcome?.firstFailureNodeId === null;
  const failed = input.projectedReport.status === "failed"
    && node.status === "failed"
    && attempt.status === "failed"
    && commandJob?.status === "failed"
    && commandJob?.exit?.taxonomy === "non_zero_exit"
    && Number.isSafeInteger(commandJob?.exit?.exitCode)
    && commandJob.exit.exitCode > 0
    && commandJob?.exit?.signal === null
    && commandJob?.recoveryLifecycle === "settled"
    && outcome?.taskStatus === "verification_failed"
    && outcome?.verificationStatus === "failed"
    && outcome?.reason === "required_failure"
    && outcome?.firstFailureNodeId === node.id;
  if (!passed && !failed) throw reject("candidate Git delivery native audit terminal binding drifted");
}

function areAuditFilesComplete(report, expectedFiles) {
  const byFile = new Map(report.testResults.map((result) => {
    const normalized = typeof result?.name === "string" ? result.name.replaceAll("\\", "/") : "";
    const relativePath = CODING_AGENT_CANDIDATE_GIT_DELIVERY_AUDIT_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    );
    return [relativePath, result];
  }));
  return expectedFiles.every((testFile) => {
    const result = byFile.get(testFile);
    return result?.status === "passed"
      && Array.isArray(result.assertionResults)
      && result.assertionResults.length > 0
      && result.assertionResults.every(({ status }) => status === "passed");
  });
}

function requireArtifactResultBinding(key, artifact, platformResults) {
  if (!jsonEqual(artifact.platforms, platformResults)) {
    throw reject(`candidate Git delivery ${key} platform result drifted`);
  }
  const passed = platformResults.every(({ passed: platformPassed }) => platformPassed);
  const failures = platformResults
    .filter(({ passed: platformPassed }) => !platformPassed)
    .map(({ platform }) => `${platform}:${EXPECTED_KINDS[key]}:native_audit_failed`);
  if (artifact.status !== (passed ? "complete" : "failed")
    || artifact.gate?.passed !== passed
    || !jsonEqual(artifact.gate?.failures, failures)) {
    throw reject(`candidate Git delivery ${key} Gate drifted`);
  }
}

function collectSourceFiles(artifacts) {
  const files = new Map();
  for (const artifact of artifacts) {
    for (const file of artifact.value.sourceIdentity?.files ?? []) {
      if (!file || !isSafeRelativePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw reject("Git delivery source identity is invalid");
      }
      if (files.has(file.path) && files.get(file.path) !== file.sha256) {
        throw reject("Git delivery source identity collision drifted");
      }
      files.set(file.path, file.sha256);
    }
  }
  if (files.size === 0) throw reject("Git delivery source identity is empty");
  return [...files.entries()]
    .map(([filePath, digest]) => ({ path: filePath, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isSourceIdentityConsistent(identity, harness) {
  return Boolean(identity && jsonEqual(identity.harness, harness)
      && Array.isArray(identity.files) && identity.files.length > 0)
    && identity.aggregateSha256 === sha256(JSON.stringify(identity.files))
    && identity.files.every((file) => isSafeRelativePath(file?.path) && /^[a-f0-9]{64}$/.test(file.sha256));
}

function hasExactSourcePaths(files) {
  return Array.isArray(files)
    && jsonEqual(files.map(({ path: filePath }) => filePath), CODING_AGENT_CANDIDATE_GIT_DELIVERY_SOURCE_FILES);
}

function hasExactSourceInventory(actual, expected) {
  return actual.length === expected.length
    && actual.every((file, index) => file.path === expected[index].path && file.sha256 === expected[index].sha256);
}

function isWorktreeSoakComplete(value, platformResults) {
  return platformResults.every(({ passed }) => passed)
    && jsonEqual(value.repositories, EXPECTED_REPOSITORIES)
    && hasExactPlatformObservations(value.observations)
    && value.observations.every(({ dirty, residualWorktreeCount, mutationCount }) => (
      dirty === false && residualWorktreeCount === 0 && mutationCount === 0
    ));
}

function isReviewRemediationComplete(value, platformResults) {
  return platformResults.every(({ passed }) => passed)
    && hasExactPlatformObservations(value.observations)
    && value.observations.every(({ reviewVerdict, remediationApplied, recheckVerdict, diffHashStable }) => (
      reviewVerdict === "needs_changes"
        && remediationApplied === true
        && recheckVerdict === "approved"
        && diffHashStable === true
    ));
}

function isRemoteAuthorityComplete(value, platformResults, harness) {
  return platformResults.every(({ passed }) => passed)
    && jsonEqual(value.repositories, EXPECTED_REPOSITORIES)
    && value.authority?.delegable === false
    && value.authority?.rememberable === false
    && value.authority?.userApprovalRequired === true
    && value.authority?.remoteWritePerformed === false
    && value.authority?.credentialsRead === false
    && jsonEqual(value.targets, createCandidateGitDeliveryRemoteTargets(harness));
}

function isRecoveryAuditComplete(value, platformResults) {
  return platformResults.every(({ passed }) => passed)
    && hasExactPlatformObservations(value.observations)
    && value.observations.every(({ parallelWrite, restartDelivery }) => (
      parallelWrite?.fanInConfirmed === true
        && parallelWrite?.mainWorkspaceChangedBeforeFanIn === false
        && parallelWrite?.conflictDetected === true
        && restartDelivery?.reattached === true
        && restartDelivery?.replayedSideEffectCount === 0
        && restartDelivery?.remoteWriteCount === 0
        && restartDelivery?.terminalStatus === "completed"
    ));
}

function hasExactPlatformObservations(observations) {
  return Array.isArray(observations)
    && observations.length === EXPECTED_PLATFORMS.length
    && jsonEqual(observations.map(({ platform }) => platform), EXPECTED_PLATFORMS);
}

async function validateRecoveryAudit(input) {
  const refs = input.artifact.systemEvidence;
  if (!Array.isArray(refs) || refs.length !== 4) {
    throw reject("delivery recovery system evidence references are incomplete");
  }
  const reportText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, "benchmark-report.json"),
    "benchmark report",
  );
  if (sha256(reportText) !== input.expectedAggregateBinding.reportSha256) {
    throw reject("delivery recovery aggregate report drifted");
  }
  const report = parseJson(reportText, "benchmark report");
  const evidenceByKey = new Map();
  for (const reference of refs) {
    const text = await readBoundedRegularFile(
      resolveInside(input.aggregateRoot, reference.path),
      "delivery recovery system evidence",
    );
    if (sha256(text) !== reference.sha256) {
      throw reject("delivery recovery system evidence digest drifted");
    }
    const value = parseJson(text, "delivery recovery system evidence");
    await validateSchema(value, SYSTEM_EVIDENCE_SCHEMA_PATH, "delivery recovery system evidence");
    if (value.schemaVersion !== "coding-agent-benchmark-system-evidence/v1" || value.status !== "passed") {
      throw reject("delivery recovery system evidence schema or status drifted");
    }
    if (!["system.parallel-write-fan-in", "system.restart-delivery-reconciliation"].includes(value.taskId)
      || !EXPECTED_PLATFORMS.includes(value.platform)) {
      throw reject("delivery recovery system evidence binding drifted");
    }
    const run = report.runs?.find(({ runId }) => runId === value.runId);
    if (!run || run.taskId !== value.taskId || run.platform !== value.platform
      || run.artifacts?.systemEvidence !== reference.path) {
      throw reject("delivery recovery system evidence run binding drifted");
    }
    const key = `${value.taskId}:${value.platform}`;
    if (evidenceByKey.has(key)) throw reject("delivery recovery system evidence pair drifted");
    evidenceByKey.set(key, value);
  }
  const expectedKeys = ["system.parallel-write-fan-in", "system.restart-delivery-reconciliation"]
    .flatMap((taskId) => EXPECTED_PLATFORMS.map((platform) => `${taskId}:${platform}`));
  if (evidenceByKey.size !== expectedKeys.length
    || expectedKeys.some((key) => !evidenceByKey.has(key))) {
    throw reject("delivery recovery system evidence pair drifted");
  }
  return EXPECTED_PLATFORMS.map((platform) => {
    const parallel = evidenceByKey.get(`system.parallel-write-fan-in:${platform}`).observations;
    const restart = evidenceByKey.get(`system.restart-delivery-reconciliation:${platform}`).observations;
    return {
      platform,
      parallelWrite: {
        fanInConfirmed: parallel.fanIn.confirmed,
        mainWorkspaceChangedBeforeFanIn: parallel.mainWorkspaceChangedBeforeFanIn,
        conflictDetected: parallel.conflict.detected,
      },
      restartDelivery: {
        reattached: restart.reattached,
        replayedSideEffectCount: restart.replayedSideEffectCount,
        remoteWriteCount: restart.remoteWriteCount,
        terminalStatus: restart.terminalStatus,
      },
    };
  });
}

async function loadAggregateBinding(root) {
  const reportText = await readBoundedRegularFile(resolveInside(root, "benchmark-report.json"), "benchmark report");
  const indexText = await readBoundedRegularFile(resolveInside(root, "baseline-index.json"), "baseline index");
  const manifestText = await readBoundedRegularFile(resolveInside(root, "task-manifest.json"), "task manifest");
  const report = parseJson(reportText, "benchmark report");
  const index = parseJson(indexText, "baseline index");
  const manifest = parseJson(manifestText, "task manifest");
  const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
  if (report.schemaVersion !== "coding-agent-benchmark-report/v3"
    || report.status !== "completed"
    || index.schemaVersion !== "coding-agent-benchmark-baseline-index/v1"
    || manifest.schemaVersion !== "coding-agent-benchmark-manifest/v3"
    || report.suite?.manifestSha256 !== manifestSha256
    || index.manifestSha256 !== manifestSha256
    || index.report?.sha256 !== sha256(reportText)) {
    throw reject("current-candidate aggregate binding drifted");
  }
  requireIdentity(report.source, "source");
  requireIdentity(report.harness, "harness");
  return {
    manifestSha256,
    reportSha256: sha256(reportText),
    indexSha256: sha256(indexText),
    source: report.source,
    harness: report.harness,
  };
}

function requireIdentity(value, label) {
  if (!value || value.workspaceDirty !== false
    || !/^[a-f0-9]{40}$/.test(value.commit)
    || !/^[a-f0-9]{64}$/.test(value.lockfileSha256)
    || !/^[a-f0-9]{64}$/.test(value.worktreeContentSha256)) {
    throw reject(`${label} identity is invalid`);
  }
}

async function validateSchema(value, schemaPath, label) {
  const compiled = compileOutputSchema(parseJson(await fs.readFile(schemaPath, "utf8"), `${label} schema`));
  const result = compiled.ok ? compiled.validator.validateOutput(JSON.stringify(value)) : { ok: false };
  if (!compiled.ok || !result.ok) throw reject(`${label} schema validation failed`);
}

async function loadArtifact(input) {
  const reference = requireObject(input.reference, `${input.label} reference`);
  if (reference.path !== input.expectedPath) throw reject(`${input.label} path binding drifted`);
  const text = await readBoundedRegularFile(resolveInside(input.aggregateRoot, reference.path), input.label);
  if (sha256(text) !== reference.sha256) throw reject(`${input.label} digest drifted`);
  const value = parseJson(text, input.label);
  await validateSchema(value, input.schemaPath, input.label);
  return { value, text, reference };
}

async function readBoundedRegularFile(target, label) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16 * 1024 * 1024) {
    throw reject(`${label} is missing or unreadable`);
  }
  return fs.readFile(target, "utf8");
}

async function requireReferenceUnchanged(referencePath, expectedText) {
  const currentText = await readBoundedRegularFile(
    referencePath,
    "candidate dimension evidence reference",
  );
  if (currentText !== expectedText) {
    throw reject("candidate dimension evidence reference changed during collection");
  }
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")) {
    throw reject("evidence path is invalid");
  }
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw reject("evidence path escapes aggregate root");
  }
  return target;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw reject(`${label} is invalid`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw reject(`${label} is required`);
  return value;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw reject(`${label} is invalid JSON`);
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0
    && !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:\//.test(value)
    && !value.split("/").some((part) => !part || part === "..");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exists(target) {
  return fs.lstat(target).then(() => true, () => false);
}

function reject(message) {
  return new Error(`Coding benchmark candidate Git delivery receipt ${message}.`);
}
