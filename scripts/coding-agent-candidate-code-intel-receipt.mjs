import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const CODING_AGENT_CANDIDATE_CODE_INTEL_RECEIPT_VERSION =
  "coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1";
const RECEIPT_SCHEMA_VERSION = CODING_AGENT_CANDIDATE_CODE_INTEL_RECEIPT_VERSION;
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..");

const RECEIPT_SCHEMA_PATH = path.join(
  WORKSPACE_ROOT,
  "benchmarks/coding-agent/v3/candidate-code-intel-evidence-receipt.schema.json",
);
const PRODUCER_SCHEMA_PATHS = Object.freeze({
  truthSet: path.join(WORKSPACE_ROOT, "benchmarks/code-intel/v1/report.schema.json"),
  contextInspector: path.join(
    WORKSPACE_ROOT,
    "benchmarks/code-intel/v1/context-inspector-audit-report.schema.json",
  ),
  resourceSoak: path.join(
    WORKSPACE_ROOT,
    "benchmarks/code-intel/v1/resource-soak-report.schema.json",
  ),
  upliftPlatform: path.join(
    WORKSPACE_ROOT,
    "benchmarks/code-intel/v1/agent-uplift-platform.schema.json",
  ),
  upliftAggregate: path.join(
    WORKSPACE_ROOT,
    "benchmarks/code-intel/v1/agent-uplift-report.schema.json",
  ),
  goNative: path.join(WORKSPACE_ROOT, "benchmarks/code-intel/v1/go-truth-set-report.schema.json"),
  goOci: path.join(
    WORKSPACE_ROOT,
    "benchmarks/code-intel/v1/go-oci-promotion-gate-report.schema.json",
  ),
  goComparator: path.join(
    WORKSPACE_ROOT,
    "benchmarks/code-intel/v1/go-canary-comparator-report.schema.json",
  ),
});

const TRUTH_MANIFEST_PATH = path.join(WORKSPACE_ROOT, "benchmarks/code-intel/v1/truth-set.json");
const RESOURCE_CONFIG_PATH = path.join(WORKSPACE_ROOT, "benchmarks/code-intel/v1/resource-soak.json");
const GO_MANIFEST_PATH = path.join(WORKSPACE_ROOT, "benchmarks/code-intel/v1/go-truth-set.json");

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
const EXPECTED_GO_PATHS = Object.freeze({
  comparator: "candidate-evidence/code-intel/go-canary/comparator-report.json",
  windowsNative: "candidate-evidence/code-intel/go-canary/windows-native-report.json",
  wsl2Oci: "candidate-evidence/code-intel/go-canary/wsl2-oci-report.json",
});
const EXPECTED_CONTEXT_CONTRACT = Object.freeze({
  version: "code-intel/v1",
  projection: "projectCodeIntelQueryResult",
  coordinateSystem: "zero-based-line-column",
  mutationAuthority: "none",
});
const EXPECTED_RESOURCE_WORKLOAD = Object.freeze({
  workspaceCount: 5,
  maxWorkspaceSessions: 3,
  rounds: 3,
  queryLimit: 1,
});
const EXPECTED_RESOURCE_LIMITS = Object.freeze({
  maxDurationMs: 60_000,
  maxQueryDurationMs: 10_000,
  maxPeakHeapIncreaseBytes: 268_435_456,
  maxRetainedHeapIncreaseBytes: 134_217_728,
});
const EXPECTED_CODE_INTEL_PROVIDER = Object.freeze({
  id: "typescript-language-service",
  capability: "semantic-live",
});
const EXPECTED_GO_PROVIDER = Object.freeze({
  id: "gopls",
  version: "v0.21.0",
  capability: "semantic-live",
  goVersion: "go1.24.2",
});
const EXPECTED_GO_RUNTIME_FILE_COUNT = 9;

/**
 * Resolves the candidate-bound CodeIntel receipt at the public dimension seam.
 *
 * The resolver deliberately treats damaged or cross-boundary evidence as a
 * rejection, while a schema-valid report whose own Gate is not satisfied only
 * completes=false for the affected contract.  Source hashes in synthetic
 * fixtures are compared across artifacts, not against this workspace; a real
 * producer is responsible for supplying the current-candidate inventory.
 */
export async function resolveCandidateCodeIntelReceiptOwner(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const expectedAggregateBinding = requireObject(
    input?.expectedAggregateBinding,
    "expectedAggregateBinding",
  );
  const owner = requireObject(input?.owner, "owner");
  const artifactReference = requireObject(owner.artifact, "owner.artifact");

  const receiptArtifact = await loadJsonArtifact({
    aggregateRoot,
    reference: artifactReference,
    schemaPath: RECEIPT_SCHEMA_PATH,
    label: "candidate CodeIntel receipt",
    maxBytes: MAX_RECEIPT_BYTES,
    expectedSchemaVersion: RECEIPT_SCHEMA_VERSION,
  });
  const receipt = receiptArtifact.value;
  requireReceiptBinding(receiptArtifact, expectedAggregateBinding);

  const artifactValidators = await loadProducerValidators();
  const loaded = {
    truthSet: await loadPlatformArtifacts({
      aggregateRoot,
      references: receipt.truthSet,
      expectedPlatforms: EXPECTED_PLATFORMS,
      expectedPaths: EXPECTED_TRUTH_PATHS,
      validator: artifactValidators.truthSet,
      label: "CodeIntel truth-set report",
    }),
    contextInspector: await loadSingleArtifact({
      aggregateRoot,
      reference: receipt.contextInspector,
      validator: artifactValidators.contextInspector,
      label: "CodeIntel Context Inspector report",
      expectedPath: "candidate-evidence/code-intel/context-inspector-audit-report.json",
    }),
    resourceSoak: await loadPlatformArtifacts({
      aggregateRoot,
      references: receipt.resourceSoak,
      expectedPlatforms: EXPECTED_PLATFORMS,
      expectedPaths: EXPECTED_RESOURCE_PATHS,
      validator: artifactValidators.resourceSoak,
      label: "CodeIntel resource-soak report",
    }),
    upliftAggregate: await loadSingleArtifact({
      aggregateRoot,
      reference: receipt.agentUplift.aggregate,
      validator: artifactValidators.upliftAggregate,
      label: "CodeIntel uplift aggregate report",
      expectedPath: "candidate-evidence/code-intel/agent-uplift/aggregate-report.json",
    }),
    upliftPlatform: await loadPlatformArtifacts({
      aggregateRoot,
      references: receipt.agentUplift.platformReports,
      expectedPlatforms: EXPECTED_PLATFORMS,
      expectedPaths: EXPECTED_UPLIFT_PATHS,
      validator: artifactValidators.upliftPlatform,
      label: "CodeIntel uplift platform report",
    }),
    goComparator: await loadSingleArtifact({
      aggregateRoot,
      reference: receipt.goCanary.comparator,
      validator: artifactValidators.goComparator,
      label: "CodeIntel Go comparator report",
      expectedPath: EXPECTED_GO_PATHS.comparator,
    }),
    goNative: await loadSingleArtifact({
      aggregateRoot,
      reference: receipt.goCanary.windowsNative,
      validator: artifactValidators.goNative,
      label: "CodeIntel Go Windows report",
      expectedPath: EXPECTED_GO_PATHS.windowsNative,
    }),
    goOci: await loadSingleArtifact({
      aggregateRoot,
      reference: receipt.goCanary.wsl2Oci,
      validator: artifactValidators.goOci,
      label: "CodeIntel Go OCI report",
      expectedPath: EXPECTED_GO_PATHS.wsl2Oci,
    }),
  };

  requireReceiptSourceInventory({ receipt: receiptArtifact, loaded });
  requireReceiptSelections(receiptArtifact);
  requireReceiptSelectionArtifactBindings(receiptArtifact);
  requireCrossReportBindings({
    receipt: receiptArtifact,
    loaded,
    expectedAggregateBinding,
  });
  requireReceiptSummaryBindings({ receipt: receiptArtifact, loaded });

  const truthComplete = resolveTruthFreshness({
    receipt: receiptArtifact,
    reports: loaded.truthSet,
    expectedAggregateBinding,
  });
  const contextComplete = resolveContextInspector({
    receipt: receiptArtifact,
    report: loaded.contextInspector.value,
    expectedAggregateBinding,
  });
  const resourceComplete = resolveResourceSoak({
    receipt: receiptArtifact,
    reports: loaded.resourceSoak,
    expectedAggregateBinding,
  });
  const upliftCompletions = resolveUplift({
    receipt: receiptArtifact,
    aggregate: loaded.upliftAggregate.value,
    platformReports: loaded.upliftPlatform,
    expectedAggregateBinding,
  });
  const goComplete = resolveGoCanary({
    receipt: receiptArtifact,
    comparator: loaded.goComparator.value,
    windowsNative: loaded.goNative.value,
    wsl2Oci: loaded.goOci.value,
    windowsNativeSha256: loaded.goNative.sha256,
    wsl2OciSha256: loaded.goOci.sha256,
    expectedAggregateBinding,
  });

  return {
    code_intel_truth_freshness: truthComplete,
    context_inspector: contextComplete,
    code_intel_resource_soak: resourceComplete,
    semantic_adoption_context_waste: upliftCompletions.semanticAdoption,
    code_intel_no_binary_fallback: upliftCompletions.noBinaryFallback,
    go_canary_eligibility: goComplete,
  };
}

async function loadProducerValidators() {
  const entries = await Promise.all(Object.entries(PRODUCER_SCHEMA_PATHS).map(async ([key, schemaPath]) => {
    const schemaText = await readBoundedRegularFile(schemaPath, MAX_RECEIPT_BYTES, `${key} schema`);
    const schema = parseJson(schemaText, `${key} schema`);
    const compiled = compileOutputSchema(schema);
    if (!compiled.ok) throw rejection(`${key} schema is invalid`);
    return [key, compiled.validator];
  }));
  return Object.fromEntries(entries);
}

async function loadPlatformArtifacts(input) {
  if (!Array.isArray(input.references) || input.references.length !== input.expectedPlatforms.length) {
    throw rejection(`${input.label} platform coverage drifted`);
  }
  const values = [];
  for (let index = 0; index < input.references.length; index += 1) {
    const reference = input.references[index];
    if (reference?.platform !== input.expectedPlatforms[index]
      || reference?.path !== input.expectedPaths[index]) {
      throw rejection(`${input.label} reference binding drifted`);
    }
    values.push(await loadSingleArtifact({
      aggregateRoot: input.aggregateRoot,
      reference,
      validator: input.validator,
      label: `${input.label} ${reference.platform}`,
      expectedPath: input.expectedPaths[index],
      expectedPlatform: input.expectedPlatforms[index],
    }));
  }
  return values;
}

async function loadSingleArtifact(input) {
  const reference = requireObject(input.reference, `${input.label} reference`);
  if (input.expectedPath !== undefined && reference.path !== input.expectedPath) {
    throw rejection(`${input.label} path binding drifted`);
  }
  const artifactText = await readBoundedRegularFile(
    resolveInside(input.aggregateRoot, reference.path),
    input.maxBytes ?? MAX_ARTIFACT_BYTES,
    input.label,
  );
  const digest = sha256(artifactText);
  if (digest !== reference.sha256) throw rejection(`${input.label} digest drifted`);
  if (!input.validator.validateOutput(artifactText).ok) {
    throw rejection(`${input.label} does not match its schema`);
  }
  const value = parseJson(artifactText, input.label);
  if (input.expectedSchemaVersion !== undefined
    && value.schemaVersion !== input.expectedSchemaVersion) {
    throw rejection(`${input.label} schema version drifted`);
  }
  if (input.expectedPlatform !== undefined && value.platform !== input.expectedPlatform) {
    throw rejection(`${input.label} platform binding drifted`);
  }
  return { value, text: artifactText, sha256: digest, reference };
}

async function loadJsonArtifact(input) {
  const validator = await loadSchemaValidator(input.schemaPath, input.label);
  return loadSingleArtifact({
    ...input,
    validator,
  });
}

async function loadSchemaValidator(schemaPath, label) {
  const schemaText = await readBoundedRegularFile(schemaPath, MAX_RECEIPT_BYTES, `${label} schema`);
  const schema = parseJson(schemaText, `${label} schema`);
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) throw rejection(`${label} schema is invalid`);
  return compiled.validator;
}

function requireReceiptBinding(receiptArtifact, expectedAggregateBinding) {
  const receipt = receiptArtifact.value;
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw rejection("candidate CodeIntel receipt schema version drifted");
  }
  if (JSON.stringify(receipt.aggregate) !== JSON.stringify(expectedAggregateBinding)) {
    throw rejection("candidate CodeIntel receipt aggregate binding drifted");
  }
  if (JSON.stringify(receipt.sourceIdentity.harness)
    !== JSON.stringify(expectedAggregateBinding.harness)) {
    throw rejection("candidate CodeIntel receipt source harness binding drifted");
  }
  const files = requireSourceFiles(receipt.sourceIdentity.files, "candidate CodeIntel receipt source");
  if (receipt.sourceIdentity.aggregateSha256 !== sha256(JSON.stringify(files))) {
    throw rejection("candidate CodeIntel receipt source aggregate drifted");
  }
}

function requireReceiptSelections(receiptArtifact) {
  const receipt = receiptArtifact.value;
  const selection = receipt.selection;
  if (selection.truthSet.id !== "p1-a1-ts-js-core-v1"
    || JSON.stringify(selection.truthSet.platforms) !== JSON.stringify(EXPECTED_PLATFORMS)
    || selection.contextInspector.contractVersion !== EXPECTED_CONTEXT_CONTRACT.version
    || selection.contextInspector.projection !== EXPECTED_CONTEXT_CONTRACT.projection
    || selection.contextInspector.coordinateSystem !== EXPECTED_CONTEXT_CONTRACT.coordinateSystem
    || selection.contextInspector.mutationAuthority !== EXPECTED_CONTEXT_CONTRACT.mutationAuthority
    || selection.resourceSoak.id !== "p1-a1-typescript-provider-resource-soak-v1"
    || JSON.stringify(selection.resourceSoak.platforms) !== JSON.stringify(EXPECTED_PLATFORMS)
    || selection.agentUplift.candidateId !== "code-intel-semantic-live-v1"
    || !Number.isInteger(selection.agentUplift.attempt)
    || selection.agentUplift.attempt < 1
    || JSON.stringify(selection.agentUplift.platforms) !== JSON.stringify(EXPECTED_PLATFORMS)
    || JSON.stringify(selection.agentUplift.taskIds)
      !== JSON.stringify(EXPECTED_UPLIFT_TASKS.map(({ id }) => id))
    || selection.goCanary.truthSetId !== "p1-a2-go-canary-v1"
    || selection.goCanary.sharedRuntimeFileCount !== EXPECTED_GO_RUNTIME_FILE_COUNT) {
    throw rejection("candidate CodeIntel receipt selection binding drifted");
  }
}

function requireReceiptSelectionArtifactBindings(receiptArtifact) {
  const selection = receiptArtifact.value.selection;
  const truthManifestSha256 = hashWorkspaceFileIfPresent(TRUTH_MANIFEST_PATH);
  if (truthManifestSha256 === null
    || selection.truthSet.manifestSha256 !== truthManifestSha256) {
    throw rejection("candidate CodeIntel receipt truth-set manifest binding drifted");
  }

  const resourceConfigSha256 = hashWorkspaceFileIfPresent(RESOURCE_CONFIG_PATH);
  if (resourceConfigSha256 === null
    || selection.resourceSoak.configSha256 !== resourceConfigSha256) {
    throw rejection("candidate CodeIntel receipt resource-soak config binding drifted");
  }

  const goManifestSha256 = hashWorkspaceFileIfPresent(GO_MANIFEST_PATH);
  if (goManifestSha256 === null
    || selection.goCanary.manifestSha256 !== goManifestSha256) {
    throw rejection("candidate CodeIntel receipt Go manifest binding drifted");
  }
}

function requireCrossReportBindings(input) {
  requireGoSharedRuntimeBinding({
    native: input.loaded.goNative.value,
    oci: input.loaded.goOci.value,
  });
  requireUpliftCrossReportBindings({
    receipt: input.receipt.value,
    aggregate: input.loaded.upliftAggregate.value,
    platformReports: input.loaded.upliftPlatform,
    expectedAggregateBinding: input.expectedAggregateBinding,
  });
}

function requireGoSharedRuntimeBinding(input) {
  const nativeRuntime = requireSourceFiles(
    input.native.sourceIdentity?.runtimeFiles,
    "CodeIntel Go native runtime",
  );
  const ociRuntime = requireSourceFiles(
    input.oci.sourceIdentity?.files,
    "CodeIntel Go OCI runtime",
  );
  if (JSON.stringify(nativeRuntime) !== JSON.stringify(ociRuntime)
    || nativeRuntime.length !== EXPECTED_GO_RUNTIME_FILE_COUNT) {
    throw rejection("CodeIntel Go shared runtime identity drifted");
  }
}

function requireUpliftCrossReportBindings(input) {
  const selection = input.receipt.selection.agentUplift;
  const platformReports = input.platformReports.map(({ value }) => value);
  if (platformReports.length !== EXPECTED_PLATFORMS.length
    || input.aggregate.attempt !== selection.attempt
    || input.aggregate.candidateId !== selection.candidateId) {
    throw rejection("CodeIntel uplift cross-report identity drifted");
  }

  for (let platformIndex = 0; platformIndex < platformReports.length; platformIndex += 1) {
    const report = platformReports[platformIndex];
    const platform = EXPECTED_PLATFORMS[platformIndex];
    if (report.platform !== platform
      || report.attempt !== selection.attempt
      || report.candidateId !== selection.candidateId
      || !Array.isArray(report.pairs)
      || report.pairs.length !== EXPECTED_UPLIFT_TASKS.length) {
      throw rejection("CodeIntel uplift cross-report identity drifted");
    }
    for (let taskIndex = 0; taskIndex < EXPECTED_UPLIFT_TASKS.length; taskIndex += 1) {
      requireUpliftPairBinding({
        pair: report.pairs[taskIndex],
        task: EXPECTED_UPLIFT_TASKS[taskIndex],
        platform,
        attempt: selection.attempt,
        expectedAggregateBinding: input.expectedAggregateBinding,
      });
    }
  }

  if (!Array.isArray(input.aggregate.pairs)
    || input.aggregate.pairs.length !== EXPECTED_PLATFORMS.length * EXPECTED_UPLIFT_TASKS.length) {
    throw rejection("CodeIntel uplift cross-report identity drifted");
  }
  for (let index = 0; index < input.aggregate.pairs.length; index += 1) {
    requireUpliftPairBinding({
      pair: input.aggregate.pairs[index],
      task: EXPECTED_UPLIFT_TASKS[index % EXPECTED_UPLIFT_TASKS.length],
      platform: EXPECTED_PLATFORMS[Math.floor(index / EXPECTED_UPLIFT_TASKS.length)],
      attempt: selection.attempt,
      expectedAggregateBinding: input.expectedAggregateBinding,
    });
  }

  if (input.aggregate.platforms?.windowsNative?.reportSha256
      !== input.platformReports[0]?.sha256
    || input.aggregate.platforms?.wsl2Linux?.reportSha256
      !== input.platformReports[1]?.sha256) {
    throw rejection("CodeIntel uplift cross-report artifact binding drifted");
  }
}

function requireUpliftPairBinding(input) {
  const pair = input.pair;
  const task = input.task;
  const attempt = input.attempt;
  if (!pair
    || !Number.isInteger(attempt)
    || attempt < 1
    || pair.pairId !== `${task.id}:${input.platform}:a${attempt}`
    || pair.taskId !== task.id
    || pair.repositoryId !== task.repositoryId
    || pair.executionProfile !== task.executionProfile
    || !pair.baseline
    || !pair.candidate) {
    throw rejection("CodeIntel uplift pair/task/platform identity drifted");
  }
  for (const cell of [pair.baseline, pair.candidate]) {
    if (cell.variant !== "baseline" && cell.variant !== "candidate") {
      throw rejection("CodeIntel uplift pair/task/platform identity drifted");
    }
    if (cell.taskId !== task.id
      || cell.cellId !== `${task.id}:${input.platform}:a${attempt}:${cell.variant}`
      || cell.identity?.executionProfile !== task.executionProfile
      || JSON.stringify(cell.identity?.source)
        !== JSON.stringify(input.expectedAggregateBinding.source)
      || JSON.stringify(cell.identity?.harness)
        !== JSON.stringify(input.expectedAggregateBinding.harness)) {
      throw rejection("CodeIntel uplift pair/task/platform identity drifted");
    }
  }
}

function requireReceiptSummaryBindings(input) {
  const receipt = input.receipt.value;
  const truthReports = input.loaded.truthSet.map(({ value }) => value);
  const truthSummary = receipt.summary.truthSet;
  const truthPassed = truthReports.every((report) => {
    return report.metrics?.passed === true
      && report.cases?.every(({ status }) => status === "passed")
      && report.execution?.gatewayCalls === 0
      && report.execution?.modelCalls === 0
      && report.execution?.providerNetworkCalls === 0
      && report.execution?.hostCommands === 0
      && report.execution?.credentialsRead === false
      && report.execution?.workspaceMutations === 0;
  });
  if (truthSummary.platformCount !== truthReports.length
    || truthSummary.caseCount !== truthReports[0]?.cases?.length
    || truthSummary.expected !== truthReports[0]?.metrics?.expected
    || truthSummary.passed !== truthPassed) {
    throw rejection("candidate CodeIntel receipt summary drifted");
  }

  const contextReport = input.loaded.contextInspector.value;
  const contextSummary = receipt.summary.contextInspector;
  const contextPassed = contextReport.gate?.passed === true
    && contextReport.gate?.failures?.length === 0;
  if (contextSummary.scenarioCount !== contextReport.scenarios?.length
    || contextSummary.passed !== contextPassed) {
    throw rejection("candidate CodeIntel receipt summary drifted");
  }

  const resourceReports = input.loaded.resourceSoak.map(({ value }) => value);
  const resourceSummary = receipt.summary.resourceSoak;
  const resourcePassed = resourceReports.every((report) => {
    return report.gates?.passed === true && report.gates?.failures?.length === 0;
  });
  if (resourceSummary.platformCount !== resourceReports.length
    || resourceSummary.attemptsPerPlatform !== resourceReports[0]?.queries?.attempts
    || resourceSummary.expectedRejectedPerPlatform !== resourceReports[0]?.queries?.expectedRejected
    || resourceSummary.passed !== resourcePassed) {
    throw rejection("candidate CodeIntel receipt summary drifted");
  }

  const uplift = input.loaded.upliftAggregate.value;
  const upliftGate = uplift.gate;
  const upliftSummary = receipt.summary.agentUplift;
  if (upliftSummary.pairCount !== upliftGate?.pairCount
    || upliftSummary.semanticSuccessfulRuns !== upliftGate?.semanticSuccessfulRuns
    || upliftSummary.binaryOutcomeRegressionCount !== upliftGate?.regressionCount
    || upliftSummary.contextWasteNoRegression !== upliftGate?.contextWaste?.noRegression
    || upliftSummary.contextWasteImprovementAlternativePassed
      !== upliftGate?.contextWaste?.improvementAlternativePassed) {
    throw rejection("candidate CodeIntel receipt summary drifted");
  }

  const comparator = input.loaded.goComparator.value;
  const goSummary = receipt.summary.goCanary;
  if (goSummary.caseCount !== comparator.truth?.caseCount
    || goSummary.positionCount !== comparator.truth?.positionCount
    || goSummary.goCanaryEligible !== (
      comparator.gate?.passed === true
      && comparator.governance?.comparatorPassed === true
      && comparator.governance?.productionEligible === false
    )
    || goSummary.productionEligible !== false) {
    throw rejection("candidate CodeIntel receipt summary drifted");
  }
}

function resolveTruthFreshness(input) {
  const receipt = input.receipt.value;
  const selection = receipt.selection.truthSet;
  const manifestSha256 = hashWorkspaceFileIfPresent(TRUTH_MANIFEST_PATH);
  const reports = input.reports.map(({ value }) => value);
  const sourceIdentity = requireMatchingSourceIdentities(
    reports.map((report) => report.sourceIdentity),
    "CodeIntel truth-set source",
  );
  const reportBindings = reports.every((report) => {
    return report.platform !== undefined
      && report.truthSet?.id === selection.id
      && report.truthSet.manifestPath === "benchmarks/code-intel/v1/truth-set.json"
      && report.truthSet.manifestSha256 === selection.manifestSha256
      && report.truthSet.contractVersion === "code-intel/v1"
      && report.truthSet.workspaceRevision === selection.id
      && report.provider?.id === EXPECTED_CODE_INTEL_PROVIDER.id
      && report.provider?.capability === EXPECTED_CODE_INTEL_PROVIDER.capability
      && report.metrics?.expected === 14
      && report.metrics?.returned === 14
      && report.metrics?.truePositive === 14
      && report.metrics?.falsePositive === 0
      && report.metrics?.falseNegative === 0
      && report.metrics?.precision >= 0.95
      && report.metrics?.recall >= 0.95
      && report.cases?.length === 7
      && report.cases.every((testCase) => testCase.status === "passed")
      && report.execution?.gatewayCalls === 0
      && report.execution?.modelCalls === 0
      && report.execution?.providerNetworkCalls === 0
      && report.execution?.hostCommands === 0
      && report.execution?.credentialsRead === false
      && report.execution?.workspaceMutations === 0;
  });
  const independentBindings = reports[0]?.truthSet?.manifestSha256 === manifestSha256
    && reports.every((report) => report.platform === EXPECTED_PLATFORMS[reports.indexOf(report)]);
  const summary = receipt.summary.truthSet;
  return reportBindings
    && independentBindings
    && sourceIdentity !== null
    && summary.platformCount === 2
    && summary.caseCount === 7
    && summary.expected === 14
    && summary.passed === true;
}

function resolveContextInspector(input) {
  const receipt = input.receipt.value;
  const report = input.report;
  const scenarios = report.scenarios;
  const sourceIdentity = requireSourceIdentity(report.sourceIdentity, "Context Inspector source");
  const harnessMatches = JSON.stringify(report.harness) === JSON.stringify(input.expectedAggregateBinding.harness);
  const contractMatches = JSON.stringify(report.contract) === JSON.stringify(EXPECTED_CONTEXT_CONTRACT);
  const scenariosValid = Array.isArray(scenarios)
    && scenarios.length === 3
    && scenarios.every((scenario, index) => isContextScenarioValid(scenario, index));
  const executionReadOnly = JSON.stringify(report.execution) === JSON.stringify({
    mode: "read-only",
    gatewayCalls: 0,
    modelCalls: 0,
    providerCalls: 0,
    networkCalls: 0,
    credentialsRead: false,
    workspaceMutations: 0,
  });
  const gatePassed = report.gate?.passed === true && report.gate?.failures?.length === 0;
  const summary = receipt.summary.contextInspector;
  return sourceIdentity
    && harnessMatches
    && contractMatches
    && scenariosValid
    && executionReadOnly
    && gatePassed
    && summary.scenarioCount === 3
    && summary.passed === true;
}

function isContextScenarioValid(scenario, index) {
  const expected = [
    ["fresh-completed", "completed", { status: "fresh" }],
    ["stale-partial", "partial", { status: "stale", reason: "workspace_revision_changed" }],
    ["unknown-partial", "partial", { status: "unknown", reason: "provider_refresh_pending" }],
  ][index];
  if (!expected || scenario.id !== expected[0]
    || scenario.input?.status !== expected[1]
    || JSON.stringify(scenario.input?.freshness) !== JSON.stringify(expected[2])) return false;
  if (scenario.inputSha256 !== sha256(JSON.stringify(scenario.input))
    || scenario.projectionSha256 !== sha256(JSON.stringify(scenario.projection))) return false;
  if (!scenario.projection || scenario.projection.coordinateSystem !== "zero-based-line-column") return false;
  const { coordinateSystem: _ignored, ...projectedWithoutCoordinateSystem } = scenario.projection;
  return JSON.stringify(projectedWithoutCoordinateSystem) === JSON.stringify(scenario.input)
    && !containsMutationAuthority(scenario.projection);
}

function resolveResourceSoak(input) {
  const receipt = input.receipt.value;
  const selection = receipt.selection.resourceSoak;
  const reports = input.reports.map(({ value }) => value);
  const configSha256 = hashWorkspaceFileIfPresent(RESOURCE_CONFIG_PATH);
  const sourceIdentity = requireMatchingSourceIdentities(
    reports.map((report) => report.sourceIdentity),
    "CodeIntel resource-soak source",
  );
  const reportBindings = reports.every((report) => {
    return report.platform !== undefined
      && report.contractVersion === "code-intel/v1"
      && report.soak?.id === selection.id
      && report.soak.configPath === "benchmarks/code-intel/v1/resource-soak.json"
      && report.soak.configSha256 === selection.configSha256
      && report.provider?.id === EXPECTED_CODE_INTEL_PROVIDER.id
      && report.provider?.capability === EXPECTED_CODE_INTEL_PROVIDER.capability
      && JSON.stringify(report.workload) === JSON.stringify(EXPECTED_RESOURCE_WORKLOAD)
      && JSON.stringify(report.limits) === JSON.stringify(EXPECTED_RESOURCE_LIMITS)
      && report.queries?.attempts === 23
      && report.queries?.successful === 22
      && report.queries?.expectedRejected === 1
      && report.queries?.expectedSuccessful === 22
      && report.queries?.providerFailures === 0
      && report.lifecycle?.activeSessionsAfterDispose === 0
      && report.revision?.staleCursorRejected === true
      && report.revision?.staleCursorErrorCode === "invalid_request"
      && report.revision?.documentRevisionChanged === true
      && report.cleanup?.temporaryRootRemoved === true
      && report.cleanup?.residualPaths === 0
      && report.execution?.gatewayCalls === 0
      && report.execution?.modelCalls === 0
      && report.execution?.paidProviderCalls === 0
      && report.execution?.providerNetworkCalls === 0
      && report.execution?.hostCommands === 0
      && report.execution?.credentialsRead === false
      && report.execution?.productionWorkspaceMutations === 0
      && report.gates?.passed === true
      && report.gates?.failures?.length === 0;
  });
  // The checked-in soak config freezes workload/limits and the source file
  // selection, but its historical digests are not necessarily the digests of
  // a synthetic or remote current-candidate report.  Bind the config by its
  // exact bytes (and let each report prove its own source identity) rather
  // than comparing unrelated digest inventories.
  const configBinding = configSha256 === selection.configSha256;
  const summary = receipt.summary.resourceSoak;
  return sourceIdentity
    && reportBindings
    && configBinding
    && summary.platformCount === 2
    && summary.attemptsPerPlatform === 23
    && summary.expectedRejectedPerPlatform === 1
    && summary.passed === true;
}

function resolveUplift(input) {
  const receipt = input.receipt.value;
  const aggregate = input.aggregate;
  const platforms = input.platformReports.map(({ value }) => value);
  const aggregateSource = requireFileIdentity(aggregate.pairs, "CodeIntel uplift aggregate pairs");
  const platformBindings = platforms.every((report, index) => {
    const expectedPlatform = EXPECTED_PLATFORMS[index];
    return report.status === "completed"
      && report.platform === expectedPlatform
      && report.attempt === receipt.selection.agentUplift.attempt
      && report.candidateId === receipt.selection.agentUplift.candidateId
      && report.gate?.id === "p1-a1-ts-js-agent-uplift-v1"
      && report.execution?.selectedPairCount === 4
      && report.execution?.selectedCellCount === 8
      && report.execution?.retryCount === 0
      && report.pairs?.length === 4
      && report.blockingFailures?.length === 0
      && report.pairs.every((pair, pairIndex) => isUpliftPairValid(
        pair,
        EXPECTED_UPLIFT_TASKS[pairIndex],
        expectedPlatform,
        receipt.selection.agentUplift.attempt,
        input.expectedAggregateBinding,
      ));
  });
  const aggregateBindings = aggregate.status === "passed"
    && aggregate.attempt === receipt.selection.agentUplift.attempt
    && aggregate.candidateId === receipt.selection.agentUplift.candidateId
    && aggregate.pairs?.length === 8
    && aggregate.pairs.every((pair, index) => {
      const platform = EXPECTED_PLATFORMS[Math.floor(index / 4)];
      const task = EXPECTED_UPLIFT_TASKS[index % 4];
      return isUpliftPairValid(
        pair,
        task,
        platform,
        receipt.selection.agentUplift.attempt,
        input.expectedAggregateBinding,
      );
    })
    && aggregate.platforms?.windowsNative?.reportSha256 === input.platformReports[0].sha256
    && aggregate.platforms?.wsl2Linux?.reportSha256 === input.platformReports[1].sha256;
  const pairIdentity = aggregateSource !== null && platformBindings && aggregateBindings;
  const gate = aggregate.gate;
  const semanticAdoption = pairIdentity
    && gate?.passed === true
    && gate.pairCount === 8
    && gate.semanticSuccessfulRuns === 8
    && gate.semanticSuccessfulRunsByPlatform?.["windows-native"] === 4
    && gate.semanticSuccessfulRunsByPlatform?.["wsl2-linux"] === 4
    && gate.contextWaste?.noRegression === true
    && gate.contextWaste?.improvementAlternativePassed === true
    && receipt.summary.agentUplift.pairCount === 8
    && receipt.summary.agentUplift.semanticSuccessfulRuns === 8
    && receipt.summary.agentUplift.contextWasteNoRegression === true
    && receipt.summary.agentUplift.contextWasteImprovementAlternativePassed === true;
  const noBinaryFallback = semanticAdoption
    && gate.regressionCount === 0
    && gate.providerFailureCount === 0
    && aggregate.pairs.every(({ candidate }) => {
      return candidate?.provider?.failure === false
        && candidate?.semantic?.successfulRun === true
        && candidate.semantic.capabilities?.includes("semantic-live")
        && candidate?.status === "passed";
    })
    && receipt.summary.agentUplift.binaryOutcomeRegressionCount === 0;
  return { semanticAdoption, noBinaryFallback };
}

function isUpliftPairValid(pair, task, platform, attempt, expectedAggregateBinding) {
  if (!pair || pair.taskId !== task.id
    || pair.repositoryId !== task.repositoryId
    || pair.executionProfile !== task.executionProfile
    || !pair.baseline || !pair.candidate) return false;
  const expectedPairId = `${task.id}:${platform}:a${attempt}`;
  if (pair.pairId !== expectedPairId) return false;
  return [pair.baseline, pair.candidate].every((cell) => {
    return cell.taskId === task.id
      && cell.cellId.startsWith(`${task.id}:${platform}:a${attempt}:`)
      && cell.identity?.source
      && cell.identity?.harness
      && JSON.stringify(cell.identity.source) === JSON.stringify(expectedAggregateBinding.source)
      && JSON.stringify(cell.identity.harness) === JSON.stringify(expectedAggregateBinding.harness)
      && cell.identity.model?.id === "deepseek-v4-flash"
      && cell.identity.executionProfile === task.executionProfile;
  });
}

function resolveGoCanary(input) {
  const receipt = input.receipt.value;
  const native = input.windowsNative;
  const oci = input.wsl2Oci;
  const comparator = input.comparator;
  const manifestSha256 = hashWorkspaceFileIfPresent(GO_MANIFEST_PATH);
  const nativeSource = requireGoSourceIdentity(native.sourceIdentity, "Go native source");
  const ociSource = requireGoSourceIdentity(oci.sourceIdentity, "Go OCI source");
  const sharedRuntime = JSON.stringify(native.sourceIdentity.runtimeFiles)
    === JSON.stringify(oci.sourceIdentity.files);
  const commonTruth = native.truthSet?.id === receipt.selection.goCanary.truthSetId
    && oci.truthSet?.id === receipt.selection.goCanary.truthSetId
    && native.truthSet.manifestSha256 === receipt.selection.goCanary.manifestSha256
    && oci.truthSet.manifestSha256 === receipt.selection.goCanary.manifestSha256
    && native.truthSet.manifestSha256 === manifestSha256
    && native.provider?.id === EXPECTED_GO_PROVIDER.id
    && native.provider?.version === EXPECTED_GO_PROVIDER.version
    && native.provider?.capability === EXPECTED_GO_PROVIDER.capability
    && native.provider?.toolchain?.goVersion === EXPECTED_GO_PROVIDER.goVersion
    && oci.toolchain?.go?.version === EXPECTED_GO_PROVIDER.goVersion
    && oci.toolchain?.gopls?.version === EXPECTED_GO_PROVIDER.version
    && native.platform === "windows-native"
    && oci.platform === "wsl2-linux";
  const comparatorInputs = comparator.inputs?.windowsNative?.reportSha256 === input.windowsNativeSha256
    && comparator.inputs?.wsl2Oci?.reportSha256 === input.wsl2OciSha256;
  const nativePassed = native.gate?.passed === true
    && native.metrics?.expected === 10
    && native.metrics?.returned === 10
    && native.metrics?.truePositive === 10
    && native.metrics?.falsePositive === 0
    && native.metrics?.falseNegative === 0
    && native.metrics?.precision === 1
    && native.metrics?.recall === 1
    && native.cases?.length === 6
    && native.cases.every(({ status }) => status === "passed")
    && native.lifecycle?.passed === true
    && native.lifecycle?.responses?.passed === true
    && native.lifecycle?.concurrency?.passed === true
    && native.governance?.productionEligible === false
    && native.execution?.gatewayCalls === 0
    && native.execution?.modelCalls === 0
    && native.execution?.credentialsRead === false
    && native.execution?.workspaceMutations === 0;
  const ociPassed = oci.gate?.passed === true
    && oci.truthSet?.passed === true
    && oci.truthSet?.metrics?.expected === 10
    && oci.truthSet?.metrics?.returned === 10
    && oci.truthSet?.metrics?.truePositive === 10
    && oci.truthSet?.metrics?.falsePositive === 0
    && oci.truthSet?.metrics?.falseNegative === 0
    && oci.truthSet?.cases?.length === 6
    && oci.truthSet.cases.every(({ status }) => status === "passed")
    && oci.truthSet.lifecycle?.passed === true
    && oci.promotion?.ociEligible === true
    && oci.promotion?.goCanaryEligible === false
    && oci.promotion?.providerAdmissionStatus === "passed"
    && oci.promotion?.productionEligible === false
    && oci.cleanup?.leaseCleanupStatus === "removed"
    && oci.cleanup?.cleanupErrorCount === 0
    && oci.cleanup?.residualContainerCount === 0
    && oci.cleanup?.stateRootCleaned === true
    && oci.cleanup?.stagingRootCleaned === true
    && oci.processMemory?.status === "observed_below_hard_limit"
    && oci.execution?.gatewayCalls === 0
    && oci.execution?.modelCalls === 0
    && oci.execution?.credentialsRead === false
    && oci.execution?.workspaceMutations === 0
    && oci.execution?.osNetworkIsolationVerified === true;
  const comparatorPassed = comparator.gate?.passed === true
    && comparator.governance?.comparatorPassed === true
    && comparator.governance?.productionEligible === false
    && comparator.truth?.caseCount === 6
    && comparator.truth?.positionCount === 10
    && comparator.truth?.matched === true
    && comparator.evidence?.windowsNative
    && Object.values(comparator.evidence.windowsNative).every(Boolean)
    && comparator.evidence?.wsl2Oci
    && Object.values(comparator.evidence.wsl2Oci).every(Boolean)
    && comparator.execution?.mode === "read-only"
    && comparator.execution?.gatewayCalls === 0
    && comparator.execution?.modelCalls === 0
    && comparator.execution?.providerCalls === 0
    && comparator.execution?.containerStarts === 0
    && comparator.execution?.networkCalls === 0
    && comparator.execution?.credentialsRead === false
    && comparator.execution?.workspaceMutations === 0;
  const comparatorIdentity = comparator.identity?.truthSetId === receipt.selection.goCanary.truthSetId
    && comparator.identity?.manifestSha256 === receipt.selection.goCanary.manifestSha256
    && comparator.identity?.fixtureAggregateSha256 === native.sourceIdentity.aggregateSha256
    && comparator.identity?.matchedSharedRuntimeFileCount === EXPECTED_GO_RUNTIME_FILE_COUNT
    && comparator.toolchain?.goVersion === EXPECTED_GO_PROVIDER.goVersion
    && comparator.toolchain?.goplsVersion === EXPECTED_GO_PROVIDER.version
    && comparator.toolchain?.windowsPlatform === "windows/amd64"
    && comparator.toolchain?.ociPlatform === "linux/amd64";
  return nativeSource
    && ociSource
    && sharedRuntime
    && commonTruth
    && comparatorInputs
    && comparatorIdentity
    && nativePassed
    && ociPassed
    && comparatorPassed
    && receipt.summary.goCanary.caseCount === 6
    && receipt.summary.goCanary.positionCount === 10
    && receipt.summary.goCanary.goCanaryEligible === true
    && receipt.summary.goCanary.productionEligible === false;
}

function requireReceiptSourceInventory(input) {
  const receiptFiles = requireSourceFiles(
    input.receipt.value.sourceIdentity.files,
    "candidate CodeIntel receipt source",
  );
  const artifactFiles = new Map();
  const add = (entry, label) => {
    if (!entry || typeof entry !== "object") return;
    const files = [];
    if (Array.isArray(entry.files)) files.push(...entry.files);
    if (Array.isArray(entry.runtimeFiles)) files.push(...entry.runtimeFiles);
    for (const file of files) {
      addSourceFile(artifactFiles, file, label);
      if (file.runtimePath !== undefined) {
        addSourceFile(artifactFiles, {
          path: file.runtimePath,
          sha256: file.runtimeSha256,
        }, label);
      }
    }
    if (entry.sourceIdentity) add(entry.sourceIdentity, label);
    if (entry.runtimeIdentity) add(entry.runtimeIdentity, label);
  };
  for (const item of input.loaded.truthSet) add(item.value.sourceIdentity, "truth-set source");
  add(input.loaded.contextInspector.value.sourceIdentity, "Context Inspector source");
  for (const item of input.loaded.resourceSoak) add(item.value.sourceIdentity, "resource-soak source");
  add(input.loaded.upliftAggregate.value, "uplift aggregate");
  for (const item of input.loaded.upliftPlatform) {
    const report = item.value;
    add(report.readiness?.sourceIdentity, "uplift platform source");
    add(report.readiness?.runtimeIdentity, "uplift platform runtime");
  }
  add(input.loaded.goNative.value.sourceIdentity, "Go native source");
  add(input.loaded.goOci.value.sourceIdentity, "Go OCI source");
  const canonicalArtifacts = [...artifactFiles.entries()]
    .map(([filePath, digest]) => ({ path: filePath, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(receiptFiles) !== JSON.stringify(canonicalArtifacts)) {
    throw rejection("candidate CodeIntel receipt source inventory drifted");
  }
}

function addSourceFile(target, file, label) {
  if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string") {
    throw rejection(`${label} source identity is invalid`);
  }
  const normalized = normalizeSourcePath(file.path, label);
  const existing = target.get(normalized);
  if (existing !== undefined && existing !== file.sha256) {
    throw rejection(`${label} source identity collision drifted`);
  }
  target.set(normalized, file.sha256);
}

function requireSourceFiles(files, label) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 64) {
    throw rejection(`${label} identity is invalid`);
  }
  const target = new Map();
  for (const file of files) addSourceFile(target, file, label);
  return [...target.entries()]
    .map(([filePath, digest]) => ({ path: filePath, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function requireSourceIdentity(identity, label) {
  if (!identity || typeof identity !== "object") return false;
  const files = requireSourceFiles(identity.files, label);
  // Producers use two valid identity shapes: a plain file list (whose
  // aggregate covers that list) and a runtime-file list where each source
  // entry also carries runtimePath/runtimeSha256 (the aggregate covers the
  // complete serialized entries).  Validate the producer's declared form
  // without forcing all owners into one representation.
  if (identity.aggregateSha256 === undefined) return true;
  const declaredFiles = identity.files;
  const declaredAggregate = sha256(JSON.stringify(declaredFiles));
  if (identity.aggregateSha256 === declaredAggregate) return true;
  return identity.aggregateSha256 === sha256(JSON.stringify(files));
}

function requireMatchingSourceIdentities(identities, label) {
  if (!identities.every((identity) => requireSourceIdentity(identity, label))) return null;
  const canonical = JSON.stringify(expandSourceFiles(identities[0].files, label));
  return identities.every((identity) => JSON.stringify(expandSourceFiles(identity.files, label)) === canonical)
    ? canonical
    : null;
}

function expandSourceFiles(files, label) {
  const expanded = [];
  for (const file of files ?? []) {
    const normalized = normalizeSourcePath(file.path, label);
    expanded.push({ path: normalized, sha256: file.sha256 });
    if (file.runtimePath !== undefined) {
      if (typeof file.runtimeSha256 !== "string") {
        throw rejection(`${label} runtime identity is invalid`);
      }
      expanded.push({
        path: normalizeSourcePath(file.runtimePath, label),
        sha256: file.runtimeSha256,
      });
    }
  }
  return expanded.sort((left, right) => left.path.localeCompare(right.path));
}

function requireGoSourceIdentity(identity, label) {
  if (!identity || !Array.isArray(identity.files)) return false;
  const files = requireSourceFiles(identity.files, label);
  // Go producers seal the aggregate over their declared (runtime/source)
  // order.  Validate that exact byte-level declaration first; accepting the
  // canonical sorted form as a compatibility fallback keeps older producers
  // readable without weakening the per-file/path checks above.
  if (identity.aggregateSha256 !== sha256(JSON.stringify(identity.files))
    && identity.aggregateSha256 !== sha256(JSON.stringify(files))) return false;
  if (identity.runtimeFiles !== undefined) {
    const runtimeFiles = requireSourceFiles(identity.runtimeFiles, `${label} runtime`);
    return runtimeFiles.length === EXPECTED_GO_RUNTIME_FILE_COUNT;
  }
  return identity.files.length === EXPECTED_GO_RUNTIME_FILE_COUNT;
}

function requireFileIdentity(value, label) {
  if (!Array.isArray(value)) return null;
  for (const pair of value) {
    for (const cell of [pair?.baseline, pair?.candidate]) {
      for (const identity of [cell?.identity?.source, cell?.identity?.harness]) {
        if (!identity || identity.workspaceDirty !== false) return null;
      }
    }
  }
  return value;
}

function containsMutationAuthority(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsMutationAuthority);
  return Object.entries(value).some(([key, child]) => {
    if (key.toLowerCase().includes("mutation") || key.toLowerCase().includes("writeauthority")) {
      return child !== "none" && child !== false && child !== 0 && child !== null;
    }
    return containsMutationAuthority(child);
  });
}

function hashWorkspaceFileIfPresent(filePath) {
  try {
    return sha256(requireFileSync(filePath));
  } catch {
    return null;
  }
}

function requireFileSync(filePath) {
  // The workspace manifests are small checked-in contracts.  This synchronous
  // read keeps the resolver's completion functions pure after artifact I/O.
  // eslint-disable-next-line no-sync
  return fsSync.readFileSync(filePath);
}

async function readBoundedRegularFile(target, maxBytes, label) {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch {
    throw rejection(`${label} is missing or unreadable`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maxBytes) {
    throw rejection(`${label} must be a bounded regular file`);
  }
  return await fs.readFile(target, "utf8");
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) {
    throw rejection("candidate CodeIntel evidence path is invalid");
  }
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw rejection("candidate CodeIntel evidence path escapes its aggregate root");
  }
  return target;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw rejection(`${label} is invalid JSON`);
  }
}

function normalizeSourcePath(value, label) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw rejection(`${label} source path is invalid`);
  }
  return normalized;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw rejection(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw rejection(`${label} must be a string`);
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rejection(message) {
  return new Error(`Coding benchmark candidate CodeIntel evidence ${message}.`);
}
