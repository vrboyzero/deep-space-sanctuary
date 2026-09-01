import fs from "node:fs/promises";
import path from "node:path";

import {
  readEvidenceReference,
  serializeJson,
  sha256,
  writeEvidenceReference,
  writeRelativeFile,
} from "./coding-agent-candidate-dimension-evidence-fixtures.mjs";

const RECEIPT_VERSION = "coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1";
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

const ARTIFACT_PATHS = Object.freeze({
  truthSet: [
    "candidate-evidence/code-intel/truth-set/windows-native-report.json",
    "candidate-evidence/code-intel/truth-set/wsl2-linux-report.json",
  ],
  contextInspector: "candidate-evidence/code-intel/context-inspector-audit-report.json",
  resourceSoak: [
    "candidate-evidence/code-intel/resource-soak/windows-native-report.json",
    "candidate-evidence/code-intel/resource-soak/wsl2-linux-report.json",
  ],
  uplift: {
    aggregate: "candidate-evidence/code-intel/agent-uplift/aggregate-report.json",
    platform: [
      "candidate-evidence/code-intel/agent-uplift/windows-native-report.json",
      "candidate-evidence/code-intel/agent-uplift/wsl2-linux-report.json",
    ],
  },
  go: {
    comparator: "candidate-evidence/code-intel/go-canary/comparator-report.json",
    windowsNative: "candidate-evidence/code-intel/go-canary/windows-native-report.json",
    wsl2Oci: "candidate-evidence/code-intel/go-canary/wsl2-oci-report.json",
  },
});

const TS_SOURCE_PATHS = Object.freeze([
  "packages/belldandy-skills/src/code-intel/typescript-provider.ts",
  "packages/belldandy-skills/src/code-intel/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/types.ts",
  "scripts/run-code-intel-truth-set.mjs",
]);
const CONTEXT_SOURCE_PATHS = Object.freeze([
  ["packages/belldandy-skills/src/code-intel/projection.ts", "packages/belldandy-skills/dist/code-intel/projection.js"],
  ["packages/belldandy-skills/src/code-intel/types.ts", "packages/belldandy-skills/dist/code-intel/types.js"],
]);
const RESOURCE_SOURCE_PATHS = Object.freeze([
  ["packages/belldandy-skills/src/code-intel/typescript-provider.ts", "packages/belldandy-skills/dist/code-intel/typescript-provider.js"],
  ["packages/belldandy-skills/src/code-intel/code-intel.ts", "packages/belldandy-skills/dist/code-intel/code-intel.js"],
  ["packages/belldandy-skills/src/code-intel/types.ts", "packages/belldandy-skills/dist/code-intel/types.js"],
  ["scripts/run-code-intel-resource-soak.mjs", "scripts/run-code-intel-resource-soak.mjs"],
]);
const GO_RUNTIME_PATHS = Object.freeze([
  "packages/belldandy-skills/src/code-intel/types.ts",
  "packages/belldandy-skills/src/code-intel/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/lsp-process-host.ts",
  "packages/belldandy-skills/src/code-intel/gopls-profile.ts",
  "packages/belldandy-skills/src/code-intel/gopls-provider.ts",
  "packages/belldandy-skills/dist/code-intel/code-intel.js",
  "packages/belldandy-skills/dist/code-intel/lsp-process-host.js",
  "packages/belldandy-skills/dist/code-intel/gopls-profile.js",
  "packages/belldandy-skills/dist/code-intel/gopls-provider.js",
]);
const GO_SOURCE_PATHS = Object.freeze([
  "app/go.mod",
  "app/main.go",
  "go.work",
  "lib/go.mod",
  "lib/service/api.go",
  "lib/service/tagged_canary.go",
]);
const UPLIFT_TASKS = Object.freeze([
  Object.freeze({ id: "real-ts.api-migration", repositoryId: "vscode-languageserver-node", executionProfile: "workspace-write" }),
  Object.freeze({ id: "real-ts.cross-package-refactor", repositoryId: "vscode-languageserver-node", executionProfile: "workspace-write" }),
  Object.freeze({ id: "real-js.bug-fix", repositoryId: "express", executionProfile: "workspace-write" }),
  Object.freeze({ id: "real-js.failed-test-fix", repositoryId: "express", executionProfile: "command-control" }),
]);

export async function addCandidateCodeIntelEvidence(aggregateRoot, options = {}) {
  const reference = await readEvidenceReference(aggregateRoot);
  const manifestSha256 = await hashWorkspaceFile("benchmarks/code-intel/v1/truth-set.json");
  const resourceConfigText = await fs.readFile(
    path.resolve(import.meta.dirname, "..", "benchmarks/code-intel/v1/resource-soak.json"),
    "utf8",
  );
  const resourceConfig = JSON.parse(resourceConfigText);
  const resourceConfigSha256 = sha256(resourceConfigText);
  const goManifestSha256 = await hashWorkspaceFile("benchmarks/code-intel/v1/go-truth-set.json");
  const aggregate = reference.aggregate;

  const truthReports = [
    createTsTruthReport("windows-native", manifestSha256),
    createTsTruthReport("wsl2-linux", manifestSha256),
  ];
  const contextInspector = createContextInspectorReport(aggregate.harness);
  const resourceReports = [
    createResourceSoakReport("windows-native", resourceConfig, resourceConfigSha256),
    createResourceSoakReport("wsl2-linux", resourceConfig, resourceConfigSha256),
  ];
  const uplift = createUpliftReports(aggregate);
  const go = createGoReports(goManifestSha256);

  const artifacts = {
    truthSet: [],
    contextInspector: undefined,
    resourceSoak: [],
    agentUplift: { aggregate: undefined, platformReports: [] },
    goCanary: { comparator: undefined, windowsNative: undefined, wsl2Oci: undefined },
  };
  for (const [index, report] of truthReports.entries()) {
    artifacts.truthSet.push(await materializeArtifact(
      aggregateRoot,
      ARTIFACT_PATHS.truthSet[index],
      report,
      report.schemaVersion,
      report.platform,
    ));
  }
  artifacts.contextInspector = await materializeArtifact(
    aggregateRoot,
    ARTIFACT_PATHS.contextInspector,
    contextInspector,
    contextInspector.schemaVersion,
  );
  for (const [index, report] of resourceReports.entries()) {
    artifacts.resourceSoak.push(await materializeArtifact(
      aggregateRoot,
      ARTIFACT_PATHS.resourceSoak[index],
      report,
      report.schemaVersion,
      report.platform,
    ));
  }
  for (const [index, report] of uplift.platformReports.entries()) {
    artifacts.agentUplift.platformReports.push(await materializeArtifact(
      aggregateRoot,
      ARTIFACT_PATHS.uplift.platform[index],
      report,
      report.schemaVersion,
      report.platform,
    ));
  }
  artifacts.agentUplift.aggregate = await materializeArtifact(
    aggregateRoot,
    ARTIFACT_PATHS.uplift.aggregate,
    {
      ...uplift.aggregate,
      platforms: {
        windowsNative: {
          ...uplift.aggregate.platforms.windowsNative,
          reportSha256: artifacts.agentUplift.platformReports[0].sha256,
        },
        wsl2Linux: {
          ...uplift.aggregate.platforms.wsl2Linux,
          reportSha256: artifacts.agentUplift.platformReports[1].sha256,
        },
      },
    },
    uplift.aggregate.schemaVersion,
  );
  artifacts.goCanary.windowsNative = await materializeArtifact(
    aggregateRoot,
    ARTIFACT_PATHS.go.windowsNative,
    go.windowsNative,
    go.windowsNative.schemaVersion,
  );
  artifacts.goCanary.wsl2Oci = await materializeArtifact(
    aggregateRoot,
    ARTIFACT_PATHS.go.wsl2Oci,
    go.wsl2Oci,
    go.wsl2Oci.schemaVersion,
  );
  const comparator = createGoComparator(
    go.windowsNative,
    go.wsl2Oci,
    artifacts.goCanary.windowsNative.sha256,
    artifacts.goCanary.wsl2Oci.sha256,
  );
  artifacts.goCanary.comparator = await materializeArtifact(
    aggregateRoot,
    ARTIFACT_PATHS.go.comparator,
    comparator,
    comparator.schemaVersion,
  );

  const receipt = {
    schemaVersion: RECEIPT_VERSION,
    generatedAt: "2026-09-02T09:00:00.000Z",
    aggregate,
    sourceIdentity: {
      harness: aggregate.harness,
      files: collectCanonicalSourceInventory({
        truthReports,
        contextInspector,
        resourceReports,
        uplift: {
          aggregate: uplift.aggregate,
          platformReports: uplift.platformReports,
        },
        go: { windowsNative: go.windowsNative, wsl2Oci: go.wsl2Oci },
      }),
    },
    selection: {
      truthSet: {
        id: "p1-a1-ts-js-core-v1",
        manifestSha256,
        platforms: ["windows-native", "wsl2-linux"],
      },
      contextInspector: {
        contractVersion: "code-intel/v1",
        projection: "projectCodeIntelQueryResult",
        coordinateSystem: "zero-based-line-column",
        mutationAuthority: "none",
      },
      resourceSoak: {
        id: "p1-a1-typescript-provider-resource-soak-v1",
        configSha256: resourceConfigSha256,
        platforms: ["windows-native", "wsl2-linux"],
      },
      agentUplift: {
        candidateId: "code-intel-semantic-live-v1",
        attempt: 1,
        taskIds: UPLIFT_TASKS.map(({ id }) => id),
        platforms: ["windows-native", "wsl2-linux"],
      },
      goCanary: {
        truthSetId: "p1-a2-go-canary-v1",
        manifestSha256: goManifestSha256,
        sharedRuntimeFileCount: GO_RUNTIME_PATHS.length,
      },
    },
    summary: {
      truthSet: { platformCount: 2, caseCount: 7, expected: 14, passed: true },
      contextInspector: { scenarioCount: 3, passed: true },
      resourceSoak: {
        platformCount: 2,
        attemptsPerPlatform: 23,
        expectedRejectedPerPlatform: 1,
        passed: true,
      },
      agentUplift: {
        pairCount: 8,
        semanticSuccessfulRuns: 8,
        binaryOutcomeRegressionCount: 0,
        contextWasteNoRegression: true,
        contextWasteImprovementAlternativePassed: true,
      },
      goCanary: {
        caseCount: 6,
        positionCount: 10,
        goCanaryEligible: true,
        productionEligible: false,
      },
    },
    truthSet: artifacts.truthSet,
    contextInspector: artifacts.contextInspector,
    resourceSoak: artifacts.resourceSoak,
    agentUplift: {
      aggregate: artifacts.agentUplift.aggregate,
      platformReports: artifacts.agentUplift.platformReports,
    },
    goCanary: artifacts.goCanary,
  };
  receipt.sourceIdentity.aggregateSha256 = sha256(JSON.stringify(receipt.sourceIdentity.files));
  const receiptPath = "candidate-code-intel-evidence-receipt.json";
  const receiptText = serializeJson(receipt);
  await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
  reference.owners.candidateCodeIntelReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: RECEIPT_VERSION,
    artifact: { path: receiptPath, sha256: sha256(receiptText) },
  };
  reference.claims.splice(3, 0, ...CONTEXT_RETRIEVAL_CLAIMS.map((claim) => ({ ...claim })));
  await writeEvidenceReference(aggregateRoot, reference);
  if (typeof options.inspect === "function") {
    await options.inspect({ aggregateRoot, receipt, artifacts });
  }
}

async function materializeArtifact(root, relativePath, value, artifactSchemaVersion, platform) {
  const text = serializeJson(value);
  await writeRelativeFile(root, relativePath, text);
  return {
    ...(platform === undefined ? {} : { platform }),
    artifactSchemaVersion,
    path: relativePath,
    sha256: sha256(text),
  };
}

function createTsTruthReport(platform, manifestSha256) {
  const expectedCounts = [1, 1, 1, 2, 5, 3, 1];
  const operations = ["symbols", "definition", "definition", "definition", "references", "references", "implementation"];
  const cases = expectedCounts.map((expected, index) => ({
    id: `fixture-ts-case-${index + 1}`,
    operation: operations[index],
    status: "passed",
    expected,
    returned: expected,
    truePositive: expected,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    errorCode: null,
    items: Array.from({ length: expected }, (_, itemIndex) => ({
      location: {
        scope: "workspace",
        path: `src/fixture-${index + 1}.ts`,
        range: {
          start: { line: itemIndex, column: 0 },
          end: { line: itemIndex, column: 8 },
        },
      },
      symbolKind: "function",
      documentRevision: `sha256:${digestForPath(`ts-revision-${platform}-${index}-${itemIndex}`)}`,
      matched: true,
    })),
  }));
  const sourceFiles = TS_SOURCE_PATHS.map((filePath) => ({
    path: filePath,
    sha256: digestForPath(filePath),
  }));
  return {
    schemaVersion: "code-intel-truth-set-report/v1",
    generatedAt: "2026-09-02T09:01:00.000Z",
    platform,
    truthSet: {
      id: "p1-a1-ts-js-core-v1",
      manifestPath: "benchmarks/code-intel/v1/truth-set.json",
      manifestSha256,
      contractVersion: "code-intel/v1",
      workspaceRevision: "p1-a1-ts-js-core-v1",
    },
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
      files: sourceFiles,
      runtimeSourceSha256: digestForPath("packages/belldandy-skills/src/code-intel/typescript-provider.ts"),
      runtimeExecutableSha256: digestForPath("packages/belldandy-skills/dist/code-intel/typescript-provider.js"),
    },
    provider: {
      id: "typescript-language-service",
      version: "5.7.3",
      capability: "semantic-live",
    },
    metrics: {
      expected: 14,
      returned: 14,
      truePositive: 14,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
      precisionThreshold: 0.95,
      recallThreshold: 0.95,
      passed: true,
    },
    cases,
    execution: {
      durationMs: 120,
      gatewayCalls: 0,
      modelCalls: 0,
      providerNetworkCalls: 0,
      hostCommands: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    },
  };
}

function createContextInspectorReport(harness) {
  const scenarios = [
    ["fresh-completed", "completed", { status: "fresh" }],
    ["stale-partial", "partial", { status: "stale", reason: "workspace_revision_changed" }],
    ["unknown-partial", "partial", { status: "unknown", reason: "provider_refresh_pending" }],
  ].map(([id, status, freshness]) => {
    const input = {
      contractVersion: "code-intel/v1",
      operation: "references",
      status,
      items: [{
        location: {
          scope: "workspace",
          path: "packages/example/src/index.ts",
          range: { start: { line: 4, column: 2 }, end: { line: 4, column: 15 } },
        },
        symbolKind: "function",
        documentRevision: `sha256:${digestForPath(`context-document-${id}`)}`,
      }],
      page: { returned: 1, truncated: false },
      freshness,
      provenance: {
        providerId: "context-inspector-fixture",
        providerVersion: "1.0.0",
        capability: "semantic-live",
        workspaceRevision: "context-inspector-fixture-v1",
        observedAtMs: 1_788_315_200_000,
      },
      diagnostics: [],
    };
    const projection = { ...input, coordinateSystem: "zero-based-line-column" };
    return {
      id,
      inputSha256: sha256(JSON.stringify(input)),
      projectionSha256: sha256(JSON.stringify(projection)),
      input,
      projection,
    };
  });
  const files = CONTEXT_SOURCE_PATHS.map(([filePath, runtimePath]) => ({
    path: filePath,
    sha256: digestForPath(filePath),
    runtimePath,
    runtimeSha256: digestForPath(runtimePath),
  }));
  return {
    schemaVersion: "code-intel-context-inspector-audit-report/v1",
    generatedAt: "2026-09-02T09:02:00.000Z",
    harness,
    sourceIdentity: { aggregateSha256: sha256(JSON.stringify(files)), files },
    contract: {
      version: "code-intel/v1",
      projection: "projectCodeIntelQueryResult",
      coordinateSystem: "zero-based-line-column",
      mutationAuthority: "none",
    },
    scenarios,
    execution: {
      mode: "read-only",
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      networkCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    },
    gate: { passed: true, failures: [] },
  };
}

function createResourceSoakReport(platform, config, configSha256) {
  const files = config.sourceIdentity.files.map((entry) => ({
    path: entry.path,
    // Fixture reports use one deterministic current-candidate inventory.  The
    // frozen config remains bound by configSha256; its historical source
    // digests are not copied into this synthetic receipt.
    sha256: digestForPath(entry.path),
    runtimePath: entry.runtimePath,
    runtimeSha256: digestForPath(entry.runtimePath),
  }));
  const eventSequence = [
    { type: "session_created", platform },
    { type: "session_reused", platform },
    { type: "session_evicted", platform },
    { type: "session_disposed", platform },
  ];
  return {
    schemaVersion: "code-intel-resource-soak-report/v1",
    generatedAt: "2026-09-02T09:03:00.000Z",
    platform,
    contractVersion: "code-intel/v1",
    soak: {
      id: "p1-a1-typescript-provider-resource-soak-v1",
      configPath: "benchmarks/code-intel/v1/resource-soak.json",
      configSha256,
    },
    sourceIdentity: { files },
    provider: {
      id: "typescript-language-service",
      version: "5.7.3",
      capability: "semantic-live",
    },
    workload: { workspaceCount: 5, maxWorkspaceSessions: 3, rounds: 3, queryLimit: 1 },
    limits: {
      maxDurationMs: 60000,
      maxQueryDurationMs: 10000,
      maxPeakHeapIncreaseBytes: 268435456,
      maxRetainedHeapIncreaseBytes: 134217728,
    },
    queries: {
      attempts: 23,
      successful: 22,
      expectedRejected: 1,
      providerFailures: 0,
      maxDurationMs: 120,
      expectedSuccessful: 22,
    },
    lifecycle: {
      createdSessions: 5,
      reusedSessions: 1,
      lruEvictions: 12,
      revisionReloads: 1,
      providerDisposeSessions: 3,
      maxActiveSessions: 3,
      activeSessionsAfterDispose: 0,
      eventCount: eventSequence.length,
      eventSequenceSha256: sha256(JSON.stringify(eventSequence)),
    },
    revision: {
      staleCursorRejected: true,
      staleCursorErrorCode: "invalid_request",
      beforeDocumentRevision: `sha256:${digestForPath("soak-before-revision")}`,
      afterDocumentRevision: `sha256:${digestForPath("soak-after-revision")}`,
      documentRevisionChanged: true,
    },
    timing: { durationMs: 1800, maxQueryDurationMs: 120 },
    memory: {
      baselineHeapUsedBytes: 10_000_000,
      peakHeapUsedBytes: 12_000_000,
      rawPeakHeapUsedBytes: 12_500_000,
      afterDisposeHeapUsedBytes: 10_500_000,
      peakHeapIncreaseBytes: 2_500_000,
      retainedHeapIncreaseBytes: 500_000,
      baselineRssBytes: 40_000_000,
      peakRssBytes: 45_000_000,
      rawPeakRssBytes: 46_000_000,
      afterDisposeRssBytes: 41_000_000,
    },
    cleanup: { temporaryRootRemoved: true, residualPaths: 0 },
    execution: {
      gatewayCalls: 0,
      modelCalls: 0,
      paidProviderCalls: 0,
      providerNetworkCalls: 0,
      hostCommands: 0,
      credentialsRead: false,
      productionWorkspaceMutations: 0,
      temporaryWorkspaceWrites: 11,
    },
    gates: { passed: true, failures: [] },
  };
}

function createUpliftReports(aggregate) {
  const sourceIdentity = fileIdentity(["packages/belldandy-skills/src/code-intel/typescript-provider.ts"]);
  const runtimeIdentity = fileIdentity(["packages/belldandy-skills/dist/code-intel/typescript-provider.js"]);
  const platformReports = ["windows-native", "wsl2-linux"].map((platform) => ({
    schemaVersion: "code-intel-agent-uplift-platform/v1",
    generatedAt: "2026-09-02T09:04:00.000Z",
    status: "completed",
    platform,
    attempt: 1,
    candidateId: "code-intel-semantic-live-v1",
    gate: {
      id: "p1-a1-ts-js-agent-uplift-v1",
      sha256: digestForPath("benchmarks/code-intel/v1/agent-uplift-gate.json"),
    },
    readiness: {
      reportSha256: digestForPath(`uplift-readiness-${platform}`),
      sourceIdentity,
      runtimeIdentity,
    },
    authorization: {
      provider: "fixture-provider",
      modelId: "deepseek-v4-flash",
      maxTotalCostCny: 10,
      priorObservedCostCny: platform === "windows-native" ? 0 : 1,
      runCostCny: 1,
      remainingCostCny: platform === "windows-native" ? 9 : 8,
      exchangeRateCnyPerUsd: 8,
    },
    execution: {
      selectedPairCount: 4,
      selectedCellCount: 8,
      executedCellCount: 8,
      retryCount: 0,
    },
    pairs: UPLIFT_TASKS.map((task, index) => ({
      pairId: `${task.id}:${platform}:a1`,
      taskId: task.id,
      repositoryId: task.repositoryId,
      executionProfile: task.executionProfile,
      baseline: createUpliftCell("baseline", task, platform, index, aggregate),
      candidate: createUpliftCell("candidate", task, platform, index, aggregate),
    })),
    blockingFailures: [],
  }));
  const aggregatePairs = platformReports.flatMap(({ pairs }) => pairs);
  return {
    platformReports,
    aggregate: {
      schemaVersion: "code-intel-agent-uplift-report/v1",
      generatedAt: "2026-09-02T09:05:00.000Z",
      status: "passed",
      attempt: 1,
      candidateId: "code-intel-semantic-live-v1",
      authorization: {
        provider: "fixture-provider",
        modelId: "deepseek-v4-flash",
        maxTotalCostCny: 10,
        priorObservedCostCny: 0,
        runCostCny: 2,
        totalObservedCostCny: 2,
        remainingCostCny: 8,
        exchangeRateCnyPerUsd: 8,
      },
      platforms: {
        windowsNative: { status: "completed", reportSha256: digestForPath("uplift-platform-windows"), pairCount: 4, executedCellCount: 8, runCostCny: 1 },
        wsl2Linux: { status: "completed", reportSha256: digestForPath("uplift-platform-wsl2"), pairCount: 4, executedCellCount: 8, runCostCny: 1 },
      },
      gate: {
        passed: true,
        failures: [],
        pairCount: 8,
        regressionCount: 0,
        providerFailureCount: 0,
        semanticSuccessfulRuns: 8,
        semanticSuccessfulRunsByPlatform: { "windows-native": 4, "wsl2-linux": 4 },
        contextWaste: {
          modelVisibleNavigationBytes: { baseline: 8000, candidate: 6000, relativeReduction: 0.25 },
          nonTargetWholeFileReadCalls: { baseline: 64, candidate: 32, relativeReduction: 0.5, absoluteReduction: 32 },
          noRegression: true,
          improvementAlternativePassed: true,
        },
      },
      pairs: aggregatePairs,
    },
  };
}

function createUpliftCell(variant, task, platform, index, aggregate) {
  const baseline = variant === "baseline";
  const artifactBase = `candidate-evidence/code-intel/uplift/${platform}/${task.id.replaceAll(".", "-")}/${variant}`;
  const source = aggregate.source;
  const harness = aggregate.harness;
  const artifacts = Object.fromEntries([
    ["report", "report.json"],
    ["events", "events.jsonl"],
    ["codingCiManifest", "coding-ci-manifest.json"],
    ["patch", "changes.patch"],
    ["result", "result.json"],
    ["repositorySnapshotReceipt", "repository-snapshot-receipt.json"],
  ].map(([name, file]) => [name, {
    path: `${artifactBase}/${file}`,
    sha256: digestForPath(`${artifactBase}/${file}`),
  }]));
  return {
    cellId: `${task.id}:${platform}:a1:${variant}`,
    variant,
    taskId: task.id,
    runId: `${task.id.replaceAll(".", "-")}-${platform}-a1-${variant}`,
    status: "passed",
    failureCategory: null,
    identity: {
      promptSha256: digestForPath(`prompt-${task.id}`),
      fixtureBaselineCommit: "a".repeat(40),
      repositoryReceiptSha256: digestForPath(`repository-receipt-${task.id}-${platform}`),
      source,
      harness,
      model: { provider: "fixture-provider", id: "deepseek-v4-flash" },
      executionProfile: task.executionProfile,
      maxTokens: 4096,
    },
    outcomes: { taskSuccess: true, patchAcceptance: true, testSuccess: true, regressionCount: 0 },
    provider: {
      usageStatus: "provider_reported",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      failure: false,
      terminalErrorCode: null,
    },
    semantic: {
      successfulRun: true,
      successfulCallCount: 2,
      failedCallCount: 0,
      capabilities: ["semantic-live"],
    },
    contextWaste: {
      modelVisibleNavigationBytes: baseline ? 1000 : 700,
      nonTargetWholeFileReadCalls: baseline ? 8 : 4,
      firstMutationTool: "apply_patch",
    },
    artifacts,
  };
}

function fileIdentity(paths) {
  const files = paths.map((filePath) => ({ path: filePath, sha256: digestForPath(filePath) }));
  return { files, aggregateSha256: sha256(JSON.stringify(files)) };
}

function createGoReports(manifestSha256) {
  const sourceFiles = GO_SOURCE_PATHS.map((filePath) => ({ path: filePath, sha256: digestForPath(filePath) }));
  const runtimeFiles = GO_RUNTIME_PATHS.map((filePath) => ({ path: filePath, sha256: digestForPath(filePath) }));
  const sourceAggregateSha256 = sha256(JSON.stringify(sourceFiles));
  const nativeCases = createGoCases(true);
  const ociCases = nativeCases.map(({ id, operation, status, expected, returned, truePositive, falsePositive, falseNegative, errorCode }) => ({
    id, operation, status, expected, returned, truePositive, falsePositive, falseNegative, errorCode,
  }));
  const nativeLifecycle = createGoLifecycle(true);
  const ociLifecycle = createGoOciLifecycle(true);
  return {
    windowsNative: {
      schemaVersion: "code-intel-go-truth-set-report/v1",
      generatedAt: "2026-09-02T09:06:00.000Z",
      platform: "windows-native",
      truthSet: {
        id: "p1-a2-go-canary-v1",
        manifestPath: "benchmarks/code-intel/v1/go-truth-set.json",
        manifestSha256,
        contractVersion: "code-intel/v1",
        workspaceRevision: "p1-a2-go-canary-v1",
      },
      sourceIdentity: { aggregateSha256: sourceAggregateSha256, files: sourceFiles, runtimeFiles },
      provider: {
        id: "gopls",
        version: "v0.21.0",
        capability: "semantic-live",
        buildTags: ["canary"],
        toolchain: { goVersion: "go1.24.2", platform: "windows/amd64" },
      },
      governance: {
        capabilities: ["symbols", "definition", "references", "implementation"],
        dependencyRestore: "denied",
        networkPolicy: "environment-deny",
        sandboxStatus: "unverified",
        productionEligible: false,
      },
      metrics: goMetrics(true),
      cases: nativeCases,
      lifecycle: nativeLifecycle,
      gate: { passed: true, failures: [] },
      execution: {
        durationMs: 200,
        probeCommands: 2,
        lspProcesses: 1,
        gatewayCalls: 0,
        modelCalls: 0,
        providerNetworkCalls: "not_observable",
        networkPolicy: "environment-deny",
        osNetworkIsolationVerified: false,
        processMemory: { hardLimitBytes: null, peakBytes: "not_observable", status: "unverified" },
        credentialsRead: false,
        workspaceMutations: 0,
        stateRootCleaned: true,
      },
    },
    wsl2Oci: {
      schemaVersion: "code-intel-go-oci-promotion-gate-report/v1",
      generatedAt: "2026-09-02T09:07:00.000Z",
      platform: "wsl2-linux",
      sourceIdentity: {
        aggregateSha256: sha256(JSON.stringify(runtimeFiles)),
        files: runtimeFiles,
      },
      truthSet: {
        id: "p1-a2-go-canary-v1",
        manifestSha256,
        sourceAggregateSha256,
        metrics: goMetrics(false),
        cases: ociCases,
        lifecycle: ociLifecycle,
        passed: true,
      },
      toolchain: {
        go: { version: "go1.24.2", platform: "linux/amd64", command: "/fixture/go/bin/go", sha256: digestForPath("go-toolchain"), artifactRoot: "/fixture/go" },
        gopls: { version: "v0.21.0", platform: "linux/amd64", command: "/fixture/gopls/bin/gopls", sha256: digestForPath("gopls-toolchain"), artifactRoot: "/fixture/gopls" },
      },
      sandbox: {
        backend: "oci",
        runtime: "docker",
        imageDigest: `sha256:${digestForPath("go-canary-image")}`,
        pullPolicy: "never",
        resourceLimits: { memoryBytes: 134217728, cpus: 1, pidsLimit: 64, tmpfsBytes: 16777216 },
        inspect: {
          observed: true,
          memoryBytes: 134217728,
          nanoCpus: 1000000000,
          pidsLimit: 64,
          networkMode: "none",
          readOnlyRootFilesystem: true,
          workspaceReadOnly: true,
          temporaryFilesystemWritable: true,
          goArtifactReadOnly: true,
          goplsArtifactReadOnly: true,
        },
      },
      processMemory: {
        hardLimitBytes: 134217728,
        goplsRssPeakBytes: 42 * 1024 * 1024,
        sampleCount: 8,
        status: "observed_below_hard_limit",
      },
      cleanup: {
        leaseCleanupStatus: "removed",
        cleanupErrorCount: 0,
        residualContainerCount: 0,
        stateRootCleaned: true,
        stagingRootCleaned: true,
      },
      gate: { passed: true, failures: [] },
      promotion: {
        ociEligible: true,
        goCanaryEligible: false,
        providerAdmissionStatus: "passed",
        productionEligible: false,
      },
      execution: {
        durationMs: 300,
        containerStarts: 1,
        providerCalls: 6,
        gatewayCalls: 0,
        modelCalls: 0,
        credentialsRead: false,
        workspaceMutations: 0,
        osNetworkIsolationVerified: true,
      },
    },
    sourceAggregateSha256,
    runtimeFiles,
  };
}

function createGoCases(includeItems) {
  const entries = [
    ["symbols.build-tagged-feature", "symbols", 1],
    ["definition.cross-module-build-message", "definition", 1],
    ["definition.build-tagged-feature", "definition", 1],
    ["references.cross-module-build-message", "references", 4],
    ["references.go-work-interface", "references", 2],
    ["implementation.go-work-interface-method", "implementation", 1],
  ];
  return entries.map(([id, operation, expected], index) => ({
    id,
    operation,
    status: "passed",
    expected,
    returned: expected,
    truePositive: expected,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    errorCode: null,
    items: includeItems ? Array.from({ length: expected }, (_, itemIndex) => ({
      location: {
        scope: "workspace",
        path: `fixture/go-${index}.go`,
        range: { start: { line: itemIndex, column: 0 }, end: { line: itemIndex, column: 4 } },
      },
      symbolKind: "function",
      documentRevision: `sha256:${digestForPath(`go-document-${index}-${itemIndex}`)}`,
      matched: true,
    })) : [],
  }));
}

function goMetrics(withThresholds) {
  return {
    expected: 10,
    returned: 10,
    truePositive: 10,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    ...(withThresholds ? { precisionThreshold: 0.95, recallThreshold: 0.95 } : {}),
    passed: true,
  };
}

function createGoLifecycle(passed) {
  return {
    hostCount: 1,
    stoppedHostCount: 1,
    processStartCount: 1,
    unexpectedExitCount: 0,
    requestCount: 6,
    forcedTerminationCount: 0,
    failureCount: 0,
    responses: { maxBytes: 4 * 1024 * 1024, peakBytes: 5000, rejectedCount: 0, passed },
    concurrency: { maxRequestsPerHost: 1, peakActiveRequests: 1, rejectedCount: 0, passed },
    timeline: {
      events: [
        { sequence: 1, atMs: 0, kind: "notification_sent", method: "textDocument/didOpen" },
        { sequence: 2, atMs: 1, kind: "request_completed", method: "workspace/symbol", resultCount: 1 },
      ],
      truncated: false,
    },
    readinessTimeline: {
      firstDidOpenStartedSequence: 1,
      firstDidOpenSentSequence: 1,
      readinessStartedSequence: 1,
      readinessCompletedSequence: 2,
      firstProgressCreatedSequence: null,
      firstProgressCompletedSequence: null,
      firstReferencesStartedSequence: 2,
      firstReferencesCompletedSequence: 2,
      firstReferencesActiveProgressCount: 0,
      lateProgressCreatedCount: 0,
      referencesAfterReadiness: true,
      didOpenBeforeReadiness: true,
      progressClosedBeforeFirstReferences: true,
      readinessDurationMs: 1,
    },
    serverRequests: { handledCount: 6, rejectedCount: 0, registeredCapabilityMethods: ["workspace/symbol"] },
    passed,
  };
}

function createGoOciLifecycle(passed) {
  return {
    hostCount: 1,
    stoppedHostCount: 1,
    processStartCount: 1,
    unexpectedExitCount: 0,
    requestCount: 6,
    forcedTerminationCount: 0,
    failureCount: 0,
    timeline: {
      events: [
        { sequence: 1, atMs: 0, kind: "notification_sent", method: "textDocument/didOpen" },
        { sequence: 2, atMs: 1, kind: "readiness_started" },
        { sequence: 3, atMs: 2, kind: "work_done_progress_created", activeProgressCount: 0 },
        { sequence: 4, atMs: 3, kind: "work_done_progress_end", activeProgressCount: 0 },
        { sequence: 5, atMs: 4, kind: "readiness_completed" },
        { sequence: 6, atMs: 5, kind: "request_started", method: "textDocument/references", activeProgressCount: 0 },
        { sequence: 7, atMs: 6, kind: "request_completed", method: "textDocument/references", resultCount: 4 },
      ],
      truncated: false,
    },
    readinessTimeline: {
      firstDidOpenStartedSequence: 1,
      firstDidOpenSentSequence: 1,
      readinessStartedSequence: 2,
      readinessCompletedSequence: 5,
      firstProgressCreatedSequence: 3,
      firstProgressCompletedSequence: 4,
      firstReferencesStartedSequence: 6,
      firstReferencesCompletedSequence: 7,
      firstReferencesActiveProgressCount: 0,
      lateProgressCreatedCount: 0,
      referencesAfterReadiness: true,
      didOpenBeforeReadiness: true,
      progressClosedBeforeFirstReferences: true,
      readinessDurationMs: 3,
    },
    passed,
  };
}

function createGoComparator(windows, oci, windowsSha256, ociSha256) {
  return {
    schemaVersion: "code-intel-go-canary-comparator-report/v1",
    generatedAt: "2026-09-02T09:08:00.000Z",
    inputs: {
      windowsNative: { reportSha256: windowsSha256 },
      wsl2Oci: { reportSha256: ociSha256 },
    },
    identity: {
      truthSetId: "p1-a2-go-canary-v1",
      manifestSha256: windows.truthSet.manifestSha256,
      fixtureAggregateSha256: windows.sourceIdentity.aggregateSha256,
      matchedSharedRuntimeFileCount: GO_RUNTIME_PATHS.length,
    },
    toolchain: {
      goVersion: "go1.24.2",
      goplsVersion: "v0.21.0",
      windowsPlatform: "windows/amd64",
      ociPlatform: "linux/amd64",
    },
    truth: { caseCount: 6, positionCount: 10, matched: true },
    evidence: {
      windowsNative: {
        gatePassed: true,
        lifecyclePassed: true,
        responsePassed: true,
        concurrencyPassed: true,
        stateCleanupPassed: true,
      },
      wsl2Oci: {
        gatePassed: true,
        providerAdmissionPassed: true,
        inspectPassed: true,
        rssPassed: true,
        cleanupPassed: true,
        readinessTimelinePassed: true,
      },
    },
    gate: { passed: true, failures: [] },
    governance: { comparatorPassed: true, productionEligible: false },
    execution: {
      mode: "read-only",
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      containerStarts: 0,
      networkCalls: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    },
  };
}

function collectCanonicalSourceInventory(input) {
  const entries = new Map();
  const add = (filePath, digest) => {
    if (typeof filePath !== "string" || typeof digest !== "string") return;
    const normalized = filePath.replaceAll("\\", "/");
    const existing = entries.get(normalized);
    if (existing !== undefined && existing !== digest) {
      throw new Error(`Fixture source identity collision for ${normalized}.`);
    }
    entries.set(normalized, digest);
  };
  const addIdentityFiles = (identity) => {
    for (const file of identity?.files ?? []) {
      add(file.path, file.sha256);
      add(file.runtimePath, file.runtimeSha256);
    }
  };
  for (const report of input.truthReports ?? []) addIdentityFiles(report.sourceIdentity);
  addIdentityFiles(input.contextInspector?.sourceIdentity);
  for (const report of input.resourceReports ?? []) addIdentityFiles(report.sourceIdentity);
  addIdentityFiles(input.uplift?.aggregate?.readiness?.sourceIdentity);
  addIdentityFiles(input.uplift?.aggregate?.readiness?.runtimeIdentity);
  for (const report of input.uplift?.platformReports ?? []) {
    addIdentityFiles(report.readiness?.sourceIdentity);
    addIdentityFiles(report.readiness?.runtimeIdentity);
  }
  addIdentityFiles(input.go?.windowsNative?.sourceIdentity);
  addIdentityFiles(input.go?.wsl2Oci?.sourceIdentity);
  return [...entries.entries()]
    .filter(([filePath]) => filePath)
    .map(([filePath, digest]) => ({ path: filePath, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function hashWorkspaceFile(relativePath) {
  const target = path.resolve(import.meta.dirname, "..", ...relativePath.split("/"));
  return sha256(await fs.readFile(target));
}

function digestForPath(value) {
  return sha256(String(value));
}
