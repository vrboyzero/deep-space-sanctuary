import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import {
  CODING_AGENT_CANDIDATE_CODE_INTEL_RECEIPT_VERSION,
  resolveCandidateCodeIntelReceiptOwner,
} from "./coding-agent-candidate-code-intel-receipt.mjs";

export { CODING_AGENT_CANDIDATE_CODE_INTEL_RECEIPT_VERSION };

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const OUTPUT_NAME = "candidate-code-intel-evidence-receipt.json";
const REFERENCE_NAME = "candidate-dimension-evidence-reference.json";
const EXPECTED_MANIFEST_VERSION = "coding-agent-benchmark-manifest/v3";
const EXPECTED_REPORT_VERSION = "coding-agent-benchmark-report/v3";
const EXPECTED_INDEX_VERSION = "coding-agent-benchmark-baseline-index/v1";
const EXPECTED_PLATFORMS = Object.freeze(["windows-native", "wsl2-linux"]);
const EXPECTED_TRUTH_PATHS = Object.freeze([
  "candidate-evidence/code-intel/truth-set/windows-native-report.json",
  "candidate-evidence/code-intel/truth-set/wsl2-linux-report.json",
]);
const EXPECTED_RESOURCE_PATHS = Object.freeze([
  "candidate-evidence/code-intel/resource-soak/windows-native-report.json",
  "candidate-evidence/code-intel/resource-soak/wsl2-linux-report.json",
]);
const EXPECTED_UPLIFT_PATHS = Object.freeze([
  "candidate-evidence/code-intel/agent-uplift/windows-native-report.json",
  "candidate-evidence/code-intel/agent-uplift/wsl2-linux-report.json",
]);
const EXPECTED_GO_PATHS = Object.freeze({
  comparator: "candidate-evidence/code-intel/go-canary/comparator-report.json",
  windowsNative: "candidate-evidence/code-intel/go-canary/windows-native-report.json",
  wsl2Oci: "candidate-evidence/code-intel/go-canary/wsl2-oci-report.json",
});
const EXPECTED_UPLIFT_TASKS = Object.freeze([
  Object.freeze({
    id: "real-ts.api-migration",
    repositoryId: "vscode-languageserver-node",
    executionProfile: "workspace-write",
  }),
  Object.freeze({
    id: "real-ts.cross-package-refactor",
    repositoryId: "vscode-languageserver-node",
    executionProfile: "workspace-write",
  }),
  Object.freeze({
    id: "real-js.bug-fix",
    repositoryId: "express",
    executionProfile: "workspace-write",
  }),
  Object.freeze({
    id: "real-js.failed-test-fix",
    repositoryId: "express",
    executionProfile: "command-control",
  }),
]);
const EXPECTED_CONTEXT_CONTRACT = Object.freeze({
  contractVersion: "code-intel/v1",
  projection: "projectCodeIntelQueryResult",
  coordinateSystem: "zero-based-line-column",
  mutationAuthority: "none",
});
const EXPECTED_CONTEXT_SELECTION = Object.freeze({
  contractVersion: "code-intel/v1",
  projection: "projectCodeIntelQueryResult",
  coordinateSystem: "zero-based-line-column",
  mutationAuthority: "none",
});
const EXPECTED_TRUTH_ID = "p1-a1-ts-js-core-v1";
const EXPECTED_RESOURCE_ID = "p1-a1-typescript-provider-resource-soak-v1";
const EXPECTED_GO_TRUTH_ID = "p1-a2-go-canary-v1";
const EXPECTED_GO_RUNTIME_FILE_COUNT = 9;
const CONTEXT_RETRIEVAL_CLAIMS = Object.freeze([
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "code_intel_truth_freshness",
    owner: "candidateCodeIntelReceipt",
    completion: "current_source_dual_platform_truth_and_freshness_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "context_inspector",
    owner: "candidateCodeIntelReceipt",
    completion: "current_harness_read_only_projection_audit_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "code_intel_resource_soak",
    owner: "candidateCodeIntelReceipt",
    completion: "current_source_dual_platform_resource_soak_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "semantic_adoption_context_waste",
    owner: "candidateCodeIntelReceipt",
    completion: "current_harness_semantic_adoption_and_context_waste_gate_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "code_intel_no_binary_fallback",
    owner: "candidateCodeIntelReceipt",
    completion: "current_harness_binary_outcome_no_regression_passed",
  }),
  Object.freeze({
    dimensionId: "context_retrieval",
    contractId: "go_canary_eligibility",
    owner: "candidateCodeIntelReceipt",
    completion: "current_source_go_canary_eligibility_proven",
  }),
]);
const CONTEXT_RETRIEVAL_CONTRACT_IDS = new Set(
  CONTEXT_RETRIEVAL_CLAIMS.map(({ contractId }) => contractId),
);

const PRODUCER_SCHEMA_PATHS = Object.freeze({
  truthSet: "benchmarks/code-intel/v1/report.schema.json",
  contextInspector: "benchmarks/code-intel/v1/context-inspector-audit-report.schema.json",
  resourceSoak: "benchmarks/code-intel/v1/resource-soak-report.schema.json",
  upliftPlatform: "benchmarks/code-intel/v1/agent-uplift-platform.schema.json",
  upliftAggregate: "benchmarks/code-intel/v1/agent-uplift-report.schema.json",
  goNative: "benchmarks/code-intel/v1/go-truth-set-report.schema.json",
  goOci: "benchmarks/code-intel/v1/go-oci-promotion-gate-report.schema.json",
  goComparator: "benchmarks/code-intel/v1/go-canary-comparator-report.schema.json",
});

const ARTIFACT_SCHEMA_VERSIONS = Object.freeze({
  truthSet: "code-intel-truth-set-report/v1",
  contextInspector: "code-intel-context-inspector-audit-report/v1",
  resourceSoak: "code-intel-resource-soak-report/v1",
  upliftPlatform: "code-intel-agent-uplift-platform/v1",
  upliftAggregate: "code-intel-agent-uplift-report/v1",
  goNative: "code-intel-go-truth-set-report/v1",
  goOci: "code-intel-go-oci-promotion-gate-report/v1",
  goComparator: "code-intel-go-canary-comparator-report/v1",
});

/**
 * Builds one candidate-bound CodeIntel receipt from retained current-candidate
 * bytes.  This runner is intentionally an adapter: it never starts a
 * provider, Gateway, model, or external consumer.
 */
export async function runCodingAgentCandidateCodeIntelReceipt(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const generatedAt = input?.generatedAt ?? new Date().toISOString();
  requireTimestamp(generatedAt, "generatedAt");

  const outputPath = resolveInside(aggregateRoot, OUTPUT_NAME);
  const referencePath = resolveInside(aggregateRoot, REFERENCE_NAME);
  await requireMissing(outputPath, OUTPUT_NAME);

  const originalReferenceText = await readBoundedRegularFile(
    referencePath,
    MAX_REFERENCE_BYTES,
    REFERENCE_NAME,
  );
  const reference = parseJson(originalReferenceText, REFERENCE_NAME);
  await validateJsonAgainstSchema({
    value: reference,
    schemaPath: path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json"),
    label: REFERENCE_NAME,
  });

  const aggregate = await loadCurrentCandidateAggregate(aggregateRoot);
  if (jsonEqual(reference.aggregate, aggregate.binding) === false) {
    throw producerError("candidate dimension evidence aggregate binding drifted");
  }
  assertReferenceOpen(reference);

  const artifacts = await loadCodeIntelArtifacts(aggregateRoot);
  const receipt = buildReceipt({
    generatedAt,
    aggregate: aggregate.binding,
    artifacts,
  });
  await validateJsonAgainstSchema({
    value: receipt,
    schemaPath: path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-code-intel-evidence-receipt.schema.json"),
    label: "candidate CodeIntel receipt",
  });

  const receiptText = serializeJson(receipt);
  let receiptCreated = false;
  let referenceWritten = false;
  try {
    await fs.writeFile(outputPath, receiptText, { encoding: "utf8", flag: "wx" });
    receiptCreated = true;

    const updatedReference = updateEvidenceReference({
      reference,
      aggregate: aggregate.binding,
      receiptText,
    });
    await validateJsonAgainstSchema({
      value: updatedReference,
      schemaPath: path.join(WORKSPACE_ROOT, "benchmarks/coding-agent/v3/candidate-dimension-evidence-reference.schema.json"),
      label: REFERENCE_NAME,
    });
    await fs.writeFile(referencePath, serializeJson(updatedReference), "utf8");
    referenceWritten = true;

    await resolveCandidateCodeIntelReceiptOwner({
      aggregateRoot,
      expectedAggregateBinding: aggregate.binding,
      owner: updatedReference.owners.candidateCodeIntelReceipt,
    });
    return receipt;
  } catch (error) {
    if (referenceWritten) {
      await fs.writeFile(referencePath, originalReferenceText, "utf8").catch(() => {});
    }
    if (receiptCreated) {
      await fs.rm(outputPath, { force: true }).catch(() => {});
    }
    throw error;
  }
}

export function parseCodingAgentCandidateCodeIntelReceiptCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--aggregate-root") {
      if (options.aggregateRoot !== undefined) {
        throw producerError("--aggregate-root may only be provided once");
      }
      options.aggregateRoot = path.resolve(requireCliValue(argv[index + 1], "--aggregate-root"));
      index += 1;
    } else if (flag === "--generated-at") {
      if (options.generatedAt !== undefined) {
        throw producerError("--generated-at may only be provided once");
      }
      options.generatedAt = requireCliValue(argv[index + 1], "--generated-at");
      requireTimestamp(options.generatedAt, "generatedAt");
      index += 1;
    } else {
      throw producerError(`unknown argument ${String(flag)}`);
    }
  }
  if (options.aggregateRoot === undefined) {
    throw producerError("--aggregate-root is required");
  }
  return options;
}

async function loadCurrentCandidateAggregate(aggregateRoot) {
  const manifestPath = resolveInside(aggregateRoot, "task-manifest.json");
  const reportPath = resolveInside(aggregateRoot, "benchmark-report.json");
  const indexPath = resolveInside(aggregateRoot, "baseline-index.json");
  const [manifestText, reportText, indexText] = await Promise.all([
    readBoundedRegularFile(manifestPath, MAX_RECEIPT_BYTES, "task-manifest.json"),
    readBoundedRegularFile(reportPath, 64 * 1024 * 1024, "benchmark-report.json"),
    readBoundedRegularFile(indexPath, MAX_ARTIFACT_BYTES, "baseline-index.json"),
  ]);
  const manifest = await loadCodingAgentBenchmarkManifest(manifestPath);
  const report = parseJson(reportText, "benchmark-report.json");
  const baselineIndex = parseJson(indexText, "baseline-index.json");
  const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
  const reportSha256 = sha256(reportText);
  const indexSha256 = sha256(indexText);

  if (manifest.schemaVersion !== EXPECTED_MANIFEST_VERSION
    || report.schemaVersion !== EXPECTED_REPORT_VERSION
    || baselineIndex.schemaVersion !== EXPECTED_INDEX_VERSION
    || report.status !== "completed") {
    throw producerError("current-candidate aggregate must be a completed v3 aggregate");
  }
  if (report.suite?.manifestSchemaVersion !== EXPECTED_MANIFEST_VERSION
    || report.suite?.manifestSha256 !== manifestSha256
    || report.suite?.sampleRuns !== 3
    || !jsonEqual(report.suite.requiredPlatforms, EXPECTED_PLATFORMS)) {
    throw producerError("current-candidate report manifest binding drifted");
  }
  if (report.benchmark !== undefined
    && (report.benchmark.id !== "ss-project-coding-v3"
      || report.benchmark.mode !== "report_only"
      || report.benchmark.thresholdApplied !== false)) {
    throw producerError("current-candidate report benchmark metadata drifted");
  }
  if (baselineIndex.manifestSha256 !== manifestSha256
    || baselineIndex.report?.path !== "benchmark-report.json"
    || baselineIndex.report?.sha256 !== reportSha256) {
    throw producerError("current-candidate baseline index binding drifted");
  }
  assertCompleteCoverage(manifest, report, baselineIndex);
  const source = validateRepositoryIdentity(report.source, "current-candidate source");
  const harness = validateRepositoryIdentity(report.harness, "current-candidate harness");
  if (baselineIndex.source !== undefined && !jsonEqual(baselineIndex.source, source)) {
    throw producerError("current-candidate baseline source identity drifted");
  }
  if (baselineIndex.harness !== undefined && !jsonEqual(baselineIndex.harness, harness)) {
    throw producerError("current-candidate baseline harness identity drifted");
  }
  return {
    binding: { manifestSha256, reportSha256, indexSha256, source, harness },
  };
}

function assertCompleteCoverage(manifest, report, baselineIndex) {
  const expectedRunCount = manifest.tasks.reduce(
    (count, task) => count + task.platforms.length * manifest.suite.sampleRuns,
    0,
  );
  const coverage = baselineIndex.coverage;
  if (!coverage
    || coverage.expectedRunCount !== expectedRunCount
    || coverage.collectedRunCount !== expectedRunCount
    || !Array.isArray(coverage.missingRunKeys)
    || coverage.missingRunKeys.length !== 0
    || !Array.isArray(report.runs)
    || report.runs.length !== expectedRunCount) {
    throw producerError("current-candidate aggregate coverage is incomplete");
  }
  const taskIds = new Set(manifest.tasks.map(({ id }) => id));
  const expectedKeys = new Set();
  for (const task of manifest.tasks) {
    for (const platform of task.platforms) {
      for (let attempt = 1; attempt <= manifest.suite.sampleRuns; attempt += 1) {
        expectedKeys.add(`${task.id}\0${platform}\0${attempt}`);
      }
    }
  }
  const seenKeys = new Set();
  const seenRunIds = new Set();
  for (const run of report.runs) {
    const attempt = resolveRunAttempt(run);
    if (!run || typeof run !== "object"
      || !taskIds.has(run.taskId)
      || !EXPECTED_PLATFORMS.includes(run.platform)
      || !Number.isInteger(attempt)
      || attempt < 1
      || attempt > manifest.suite.sampleRuns
      || typeof run.runId !== "string"
      || !run.runId) {
      throw producerError("current-candidate aggregate run coverage is invalid");
    }
    const key = `${run.taskId}\0${run.platform}\0${attempt}`;
    if (seenKeys.has(key) || seenRunIds.has(run.runId)) {
      throw producerError("current-candidate aggregate run coverage is duplicated");
    }
    seenKeys.add(key);
    seenRunIds.add(run.runId);
  }
  if (seenKeys.size !== expectedKeys.size
    || [...expectedKeys].some((key) => !seenKeys.has(key))) {
    throw producerError("current-candidate aggregate run coverage is incomplete");
  }
}

function resolveRunAttempt(run) {
  if (Number.isInteger(run?.attempt)) return run.attempt;
  // The local fixture helper predates the v3 attempt field.  Accept that
  // compatibility shape only when the run id carries an unambiguous frozen
  // task/platform/attempt suffix; real v3 reports use the explicit field.
  const match = typeof run?.runId === "string"
    ? /-(?:windows-native|wsl2-linux)-([1-9]\d*)$/.exec(run.runId)
    : null;
  return match ? Number(match[1]) : undefined;
}

async function loadCodeIntelArtifacts(aggregateRoot) {
  const validators = await loadProducerValidators();
  const truthSet = await Promise.all(EXPECTED_PLATFORMS.map((platform, index) => loadArtifact({
    aggregateRoot,
    relativePath: EXPECTED_TRUTH_PATHS[index],
    schemaPath: validators.truthSet.schemaPath,
    validator: validators.truthSet.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.truthSet,
    platform,
    label: `CodeIntel truth-set report ${platform}`,
  })));
  const contextInspector = await loadArtifact({
    aggregateRoot,
    relativePath: "candidate-evidence/code-intel/context-inspector-audit-report.json",
    schemaPath: validators.contextInspector.schemaPath,
    validator: validators.contextInspector.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.contextInspector,
    label: "CodeIntel Context Inspector report",
  });
  const resourceSoak = await Promise.all(EXPECTED_PLATFORMS.map((platform, index) => loadArtifact({
    aggregateRoot,
    relativePath: EXPECTED_RESOURCE_PATHS[index],
    schemaPath: validators.resourceSoak.schemaPath,
    validator: validators.resourceSoak.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.resourceSoak,
    platform,
    label: `CodeIntel resource-soak report ${platform}`,
  })));
  const upliftAggregate = await loadArtifact({
    aggregateRoot,
    relativePath: "candidate-evidence/code-intel/agent-uplift/aggregate-report.json",
    schemaPath: validators.upliftAggregate.schemaPath,
    validator: validators.upliftAggregate.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.upliftAggregate,
    label: "CodeIntel uplift aggregate report",
  });
  const upliftPlatform = await Promise.all(EXPECTED_PLATFORMS.map((platform, index) => loadArtifact({
    aggregateRoot,
    relativePath: EXPECTED_UPLIFT_PATHS[index],
    schemaPath: validators.upliftPlatform.schemaPath,
    validator: validators.upliftPlatform.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.upliftPlatform,
    platform,
    label: `CodeIntel uplift platform report ${platform}`,
  })));
  const goComparator = await loadArtifact({
    aggregateRoot,
    relativePath: EXPECTED_GO_PATHS.comparator,
    schemaPath: validators.goComparator.schemaPath,
    validator: validators.goComparator.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.goComparator,
    label: "CodeIntel Go comparator report",
  });
  const goNative = await loadArtifact({
    aggregateRoot,
    relativePath: EXPECTED_GO_PATHS.windowsNative,
    schemaPath: validators.goNative.schemaPath,
    validator: validators.goNative.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.goNative,
    platform: "windows-native",
    referencePlatform: false,
    label: "CodeIntel Go Windows report",
  });
  const goOci = await loadArtifact({
    aggregateRoot,
    relativePath: EXPECTED_GO_PATHS.wsl2Oci,
    schemaPath: validators.goOci.schemaPath,
    validator: validators.goOci.validator,
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.goOci,
    platform: "wsl2-linux",
    referencePlatform: false,
    label: "CodeIntel Go OCI report",
  });
  return {
    truthSet,
    contextInspector,
    resourceSoak,
    upliftAggregate,
    upliftPlatform,
    goComparator,
    goNative,
    goOci,
  };
}

async function loadProducerValidators() {
  const entries = await Promise.all(Object.entries(PRODUCER_SCHEMA_PATHS).map(async ([key, relativePath]) => {
    const schemaPath = path.join(WORKSPACE_ROOT, relativePath);
    const schemaText = await readBoundedRegularFile(schemaPath, MAX_RECEIPT_BYTES, `${key} schema`);
    const schema = parseJson(schemaText, `${key} schema`);
    const compiled = compileOutputSchema(schema);
    if (!compiled.ok) throw producerError(`${key} schema is invalid`);
    return [key, { schemaPath, validator: compiled.validator }];
  }));
  return Object.fromEntries(entries);
}

async function loadArtifact(input) {
  const artifactPath = resolveInside(input.aggregateRoot, input.relativePath);
  const text = await readBoundedRegularFile(artifactPath, MAX_ARTIFACT_BYTES, input.label);
  if (!input.validator.validateOutput(text).ok) {
    throw producerError(`${input.label} does not match ${input.schemaPath}`);
  }
  const value = parseJson(text, input.label);
  if (value.schemaVersion !== input.schemaVersion) {
    throw producerError(`${input.label} schema version drifted`);
  }
  if (input.platform !== undefined && value.platform !== input.platform) {
    throw producerError(`${input.label} platform binding drifted`);
  }
  return {
    value,
    text,
    sha256: sha256(text),
    reference: {
      ...(input.platform !== undefined && input.referencePlatform !== false
        ? { platform: input.platform }
        : {}),
      artifactSchemaVersion: input.schemaVersion,
      path: input.relativePath,
      sha256: sha256(text),
    },
  };
}

function buildReceipt(input) {
  const { artifacts, aggregate, generatedAt } = input;
  const truthReports = artifacts.truthSet.map(({ value }) => value);
  const resourceReports = artifacts.resourceSoak.map(({ value }) => value);
  const uplift = artifacts.upliftAggregate.value;
  const upliftPlatforms = artifacts.upliftPlatform.map(({ value }) => value);
  const goComparator = artifacts.goComparator.value;
  const goNative = artifacts.goNative.value;
  const goOci = artifacts.goOci.value;
  const manifestSha256 = hashWorkspaceFile("benchmarks/code-intel/v1/truth-set.json");
  const resourceConfigSha256 = hashWorkspaceFile("benchmarks/code-intel/v1/resource-soak.json");
  const goManifestSha256 = hashWorkspaceFile("benchmarks/code-intel/v1/go-truth-set.json");
  const attempt = requireUpliftAttempt(uplift, upliftPlatforms);
  const sourceFiles = collectCanonicalSourceInventory(artifacts);

  const receipt = {
    schemaVersion: CODING_AGENT_CANDIDATE_CODE_INTEL_RECEIPT_VERSION,
    generatedAt,
    aggregate,
    sourceIdentity: {
      harness: aggregate.harness,
      files: sourceFiles,
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
    },
    selection: {
      truthSet: {
        id: EXPECTED_TRUTH_ID,
        manifestSha256,
        platforms: [...EXPECTED_PLATFORMS],
      },
      contextInspector: { ...EXPECTED_CONTEXT_SELECTION },
      resourceSoak: {
        id: EXPECTED_RESOURCE_ID,
        configSha256: resourceConfigSha256,
        platforms: [...EXPECTED_PLATFORMS],
      },
      agentUplift: {
        candidateId: "code-intel-semantic-live-v1",
        attempt,
        taskIds: EXPECTED_UPLIFT_TASKS.map(({ id }) => id),
        platforms: [...EXPECTED_PLATFORMS],
      },
      goCanary: {
        truthSetId: EXPECTED_GO_TRUTH_ID,
        manifestSha256: goManifestSha256,
        sharedRuntimeFileCount: EXPECTED_GO_RUNTIME_FILE_COUNT,
      },
    },
    summary: {
      truthSet: {
        platformCount: truthReports.length,
        caseCount: truthReports[0]?.cases?.length ?? 0,
        expected: truthReports[0]?.metrics?.expected ?? 0,
        passed: truthReports.every(isTruthReportPassed),
      },
      contextInspector: {
        scenarioCount: artifacts.contextInspector.value.scenarios?.length ?? 0,
        passed: isContextInspectorPassed(artifacts.contextInspector.value),
      },
      resourceSoak: {
        platformCount: resourceReports.length,
        attemptsPerPlatform: resourceReports[0]?.queries?.attempts ?? 0,
        expectedRejectedPerPlatform: resourceReports[0]?.queries?.expectedRejected ?? 0,
        passed: resourceReports.every(isResourceSoakPassed),
      },
      agentUplift: {
        pairCount: uplift.gate?.pairCount ?? 0,
        semanticSuccessfulRuns: uplift.gate?.semanticSuccessfulRuns ?? 0,
        binaryOutcomeRegressionCount: uplift.gate?.regressionCount ?? 0,
        contextWasteNoRegression: uplift.gate?.contextWaste?.noRegression ?? false,
        contextWasteImprovementAlternativePassed:
          uplift.gate?.contextWaste?.improvementAlternativePassed ?? false,
      },
      goCanary: {
        caseCount: goComparator.truth?.caseCount ?? 0,
        positionCount: goComparator.truth?.positionCount ?? 0,
        goCanaryEligible: isGoCanaryEligible(goComparator),
        productionEligible: false,
      },
    },
    truthSet: truthReports.map((_, index) => artifacts.truthSet[index].reference),
    contextInspector: artifacts.contextInspector.reference,
    resourceSoak: resourceReports.map((_, index) => artifacts.resourceSoak[index].reference),
    agentUplift: {
      aggregate: artifacts.upliftAggregate.reference,
      platformReports: upliftPlatforms.map((_, index) => artifacts.upliftPlatform[index].reference),
    },
    goCanary: {
      comparator: artifacts.goComparator.reference,
      windowsNative: artifacts.goNative.reference,
      wsl2Oci: artifacts.goOci.reference,
    },
  };

  // Keep these checks close to construction so malformed retained evidence
  // fails before any candidate reference is changed.
  if (truthReports.length !== 2
    || resourceReports.length !== 2
    || upliftPlatforms.length !== 2
    || goNative.sourceIdentity?.runtimeFiles?.length !== EXPECTED_GO_RUNTIME_FILE_COUNT
    || !jsonEqual(artifacts.contextInspector.value.contract, {
      version: "code-intel/v1",
      projection: "projectCodeIntelQueryResult",
      coordinateSystem: "zero-based-line-column",
      mutationAuthority: "none",
    })
    || truthReports.some((report) => report.truthSet?.id !== EXPECTED_TRUTH_ID)
    || resourceReports.some((report) => report.soak?.id !== EXPECTED_RESOURCE_ID)
    || goNative.truthSet?.id !== EXPECTED_GO_TRUTH_ID
    || goOci.truthSet?.id !== EXPECTED_GO_TRUTH_ID) {
    throw producerError("CodeIntel selection inputs drifted");
  }
  return receipt;
}

function requireUpliftAttempt(aggregate, platformReports) {
  const attempts = [aggregate.attempt, ...platformReports.map(({ attempt }) => attempt)];
  if (!attempts.every((attempt) => Number.isInteger(attempt) && attempt >= 1)
    || attempts.some((attempt) => attempt !== attempts[0])) {
    throw producerError("CodeIntel uplift attempt binding drifted");
  }
  if (aggregate.candidateId !== "code-intel-semantic-live-v1"
    || platformReports.some(({ candidateId }) => candidateId !== aggregate.candidateId)) {
    throw producerError("CodeIntel uplift candidate binding drifted");
  }
  return attempts[0];
}

function collectCanonicalSourceInventory(artifacts) {
  const entries = new Map();
  const add = (file, label) => {
    if (!file || typeof file !== "object") {
      throw producerError(`${label} source identity is invalid`);
    }
    const normalizedPath = normalizeSourcePath(file.path, label);
    const digest = requireSha256(file.sha256, `${label} ${normalizedPath}`);
    const existing = entries.get(normalizedPath);
    if (existing !== undefined && existing !== digest) {
      throw producerError(`${label} source identity collision drifted`);
    }
    entries.set(normalizedPath, digest);
    if (file.runtimePath !== undefined) {
      add({ path: file.runtimePath, sha256: file.runtimeSha256 }, `${label} runtime`);
    }
  };
  const addIdentity = (identity, label) => {
    if (!identity || typeof identity !== "object" || !Array.isArray(identity.files)) {
      throw producerError(`${label} source identity is invalid`);
    }
    for (const file of identity.files) add(file, label);
    if (identity.runtimeFiles !== undefined) {
      if (!Array.isArray(identity.runtimeFiles)) {
        throw producerError(`${label} runtime identity is invalid`);
      }
      for (const file of identity.runtimeFiles) add(file, `${label} runtime`);
    }
  };
  for (const { value } of artifacts.truthSet) addIdentity(value.sourceIdentity, "CodeIntel truth-set");
  addIdentity(artifacts.contextInspector.value.sourceIdentity, "CodeIntel Context Inspector");
  for (const { value } of artifacts.resourceSoak) addIdentity(value.sourceIdentity, "CodeIntel resource-soak");
  for (const { value } of artifacts.upliftPlatform) {
    addIdentity(value.readiness?.sourceIdentity, "CodeIntel uplift source");
    addIdentity(value.readiness?.runtimeIdentity, "CodeIntel uplift runtime");
  }
  addIdentity(artifacts.goNative.value.sourceIdentity, "CodeIntel Go native");
  addIdentity(artifacts.goOci.value.sourceIdentity, "CodeIntel Go OCI");
  return [...entries.entries()]
    .map(([filePath, digest]) => ({ path: filePath, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function updateEvidenceReference(input) {
  const reference = structuredClone(input.reference);
  reference.aggregate = structuredClone(input.aggregate);
  reference.owners.candidateCodeIntelReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: CODING_AGENT_CANDIDATE_CODE_INTEL_RECEIPT_VERSION,
    artifact: {
      path: OUTPUT_NAME,
      sha256: sha256(input.receiptText),
    },
  };
  const insertionIndex = reference.claims.findIndex(
    ({ dimensionId }) => dimensionId !== "safety_recovery",
  );
  const index = insertionIndex < 0 ? reference.claims.length : insertionIndex;
  reference.claims.splice(
    index,
    0,
    ...CONTEXT_RETRIEVAL_CLAIMS.map((claim) => ({ ...claim })),
  );
  return reference;
}

function assertReferenceOpen(reference) {
  if (reference.owners?.candidateCodeIntelReceipt !== undefined) {
    throw producerError("candidate CodeIntel receipt owner already exists");
  }
  if (reference.claims.some(({ owner, contractId }) => (
    owner === "candidateCodeIntelReceipt" || CONTEXT_RETRIEVAL_CONTRACT_IDS.has(contractId)
  ))) {
    throw producerError("candidate CodeIntel claims already exist");
  }
}

function isTruthReportPassed(report) {
  return report.metrics?.passed === true
    && report.cases?.every(({ status }) => status === "passed")
    && report.execution?.gatewayCalls === 0
    && report.execution?.modelCalls === 0
    && report.execution?.providerNetworkCalls === 0
    && report.execution?.hostCommands === 0
    && report.execution?.credentialsRead === false
    && report.execution?.workspaceMutations === 0;
}

function isContextInspectorPassed(report) {
  return report.gate?.passed === true && report.gate?.failures?.length === 0;
}

function isResourceSoakPassed(report) {
  return report.gates?.passed === true && report.gates?.failures?.length === 0;
}

function isGoCanaryEligible(comparator) {
  return comparator.gate?.passed === true
    && comparator.governance?.comparatorPassed === true
    && comparator.governance?.productionEligible === false;
}

function validateRepositoryIdentity(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !/^[a-f0-9]{40}$/.test(value.commit)
    || value.workspaceDirty !== false
    || !/^[a-f0-9]{64}$/.test(value.lockfileSha256)
    || !/^[a-f0-9]{64}$/.test(value.worktreeContentSha256)) {
    throw producerError(`${label} identity is invalid or dirty`);
  }
  return structuredClone(value);
}

function normalizeSourcePath(value, label) {
  if (typeof value !== "string") throw producerError(`${label} source path is invalid`);
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw producerError(`${label} source path is invalid`);
  }
  return normalized;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw producerError(`${label} must be a SHA-256 digest`);
  }
  return value;
}

async function validateJsonAgainstSchema(input) {
  const schemaText = await readBoundedRegularFile(input.schemaPath, MAX_RECEIPT_BYTES, `${input.label} schema`);
  const schema = parseJson(schemaText, `${input.label} schema`);
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) throw producerError(`${input.label} schema is invalid`);
  const validation = compiled.validator.validateOutput(JSON.stringify(input.value));
  if (!validation.ok) {
    throw producerError(`${input.label} does not match its schema: ${JSON.stringify(validation)}`);
  }
}

async function requireMissing(target, label) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw producerError(`${label} cannot be inspected`);
  }
  throw producerError(`${label} already exists; producer output is immutable`);
}

async function readBoundedRegularFile(target, maxBytes, label) {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch {
    throw producerError(`${label} is missing or unreadable`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maxBytes) {
    throw producerError(`${label} must be a bounded regular file`);
  }
  return await fs.readFile(target, "utf8");
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) {
    throw producerError("candidate CodeIntel evidence path is invalid");
  }
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw producerError("candidate CodeIntel evidence path escapes its aggregate root");
  }
  return target;
}

function hashWorkspaceFile(relativePath) {
  const target = path.resolve(WORKSPACE_ROOT, ...relativePath.split("/"));
  // Checked-in contract files are small and are read only after artifact
  // loading; synchronous hashing keeps receipt construction deterministic.
  // eslint-disable-next-line no-sync
  return sha256(fsSync.readFileSync(target));
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw producerError(`${label} is invalid JSON`);
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw producerError(`${label} is required`);
  return value;
}

function requireCliValue(value, label) {
  const normalized = requireString(value, label);
  if (normalized.startsWith("--")) throw producerError(`${label} requires a value`);
  return normalized;
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw producerError(`${label} must be a valid timestamp`);
  }
}

function producerError(message) {
  return new Error(`Coding benchmark candidate CodeIntel receipt ${message}.`);
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const options = parseCodingAgentCandidateCodeIntelReceiptCliArguments(process.argv.slice(2));
  const receipt = await runCodingAgentCandidateCodeIntelReceipt(options);
  console.log(`[coding-agent-candidate-code-intel] wrote ${receipt.schemaVersion}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[coding-agent-candidate-code-intel] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
