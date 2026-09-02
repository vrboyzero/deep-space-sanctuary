import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkManifestPath,
} from "./coding-agent-benchmark-contract.mjs";

const CODING_RUN_CLIENT_CI_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);

const CODING_RUN_CLIENT_CI = Object.freeze({
  repositoryId: 1_182_285_910,
  repository: "vrboyzero/deep-space-sanctuary",
  workflowId: 314_160_461,
  workflowName: "Quality Gates",
  workflowPath: ".github/workflows/quality-gates.yml",
  runId: 33_415_964_382,
  runAttempt: 1,
  headBranch: "main",
  createdAt: "2026-09-01T13:00:00.000Z",
  updatedAt: "2026-09-01T13:20:00.000Z",
});

export async function withSafetyEvidenceFixture(callback) {
  const aggregateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "belldandy-candidate-dimension-evidence-"),
  );
  try {
    const manifestPath = resolveCodingAgentBenchmarkManifestPath("v3");
    const manifestText = await fs.readFile(manifestPath, "utf-8");
    const manifest = await loadCodingAgentBenchmarkManifest(manifestPath);
    const manifestSha256 = hashCodingAgentBenchmarkManifestText(manifestText);
    const source = versionedIdentity("a");
    const harness = versionedIdentity("b");
    const systemReferences = [];
    const runs = [];

    for (const task of manifest.tasks) {
      for (const platform of task.platforms) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const runId = `${task.id}-${platform}-${attempt}`;
          const artifacts = {};
          if (task.layer === "C") {
            const relativePath = `runs/${runId}/system-evidence.json`;
            const evidenceText = serializeJson(createSystemEvidence(task, runId, platform));
            await writeRelativeFile(aggregateRoot, relativePath, evidenceText);
            artifacts.systemEvidence = relativePath;
            systemReferences.push({
              runId,
              taskId: task.id,
              platform,
              path: relativePath,
              sha256: sha256(evidenceText),
            });
          }
          runs.push({ runId, taskId: task.id, platform, artifacts });
        }
      }
    }

    const report = {
      schemaVersion: "coding-agent-benchmark-report/v3",
      status: "completed",
      generatedAt: "2026-09-01T00:00:00.000Z",
      suite: {
        manifestSchemaVersion: "coding-agent-benchmark-manifest/v3",
        manifestSha256,
        sampleRuns: 3,
        requiredPlatforms: ["windows-native", "wsl2-linux"],
      },
      source,
      harness,
      runs,
    };
    const reportText = serializeJson(report);
    const baselineIndex = {
      schemaVersion: "coding-agent-benchmark-baseline-index/v1",
      manifestSha256,
      report: { path: "benchmark-report.json", sha256: sha256(reportText) },
      coverage: {
        expectedRunCount: 144,
        collectedRunCount: 144,
        missingRunKeys: [],
      },
    };
    const indexText = serializeJson(baselineIndex);
    const aggregateBinding = {
      manifestSha256,
      reportSha256: baselineIndex.report.sha256,
      indexSha256: sha256(indexText),
      source,
      harness,
    };
    const receipt = createCandidateGlobalReceipt(aggregateBinding);
    const receiptText = serializeJson(receipt);
    const reference = {
      schemaVersion: "coding-agent-benchmark-candidate-dimension-evidence-reference/v1",
      generatedAt: "2026-09-01T02:00:00.000Z",
      aggregate: aggregateBinding,
      failureSemantics: {
        missingReference: "incomplete",
        missingArtifact: "reject",
        digestMismatch: "reject",
        schemaOrBindingMismatch: "reject",
        unmetCompletion: "failed",
      },
      owners: {
        systemEvidence: {
          kind: "retained_run_artifacts",
          artifactKey: "systemEvidence",
          scope: "layer_c_runs",
          artifactSchemaVersion: "coding-agent-benchmark-system-evidence/v1",
          artifacts: systemReferences.sort((left, right) => left.runId.localeCompare(right.runId)),
        },
        candidateGlobalReceipt: {
          kind: "candidate_artifact",
          scope: "candidate",
          artifactSchemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
          artifact: {
            path: "candidate-global-receipt.json",
            sha256: sha256(receiptText),
          },
        },
      },
      claims: [
        {
          dimensionId: "safety_recovery",
          contractId: "system_evidence_critical_rate",
          owner: "systemEvidence",
          completion: "all_layer_c_runs_valid",
        },
        {
          dimensionId: "safety_recovery",
          contractId: "candidate_sensitive_scan",
          owner: "candidateGlobalReceipt",
          completion: "completed_zero_findings",
        },
        {
          dimensionId: "safety_recovery",
          contractId: "candidate_resource_sweeps",
          owner: "candidateGlobalReceipt",
          completion: "required_platforms_completed_zero_orphans",
        },
      ],
    };

    await Promise.all([
      fs.writeFile(path.join(aggregateRoot, "task-manifest.json"), manifestText, "utf-8"),
      fs.writeFile(path.join(aggregateRoot, "benchmark-report.json"), reportText, "utf-8"),
      fs.writeFile(path.join(aggregateRoot, "baseline-index.json"), indexText, "utf-8"),
      fs.writeFile(path.join(aggregateRoot, "candidate-global-receipt.json"), receiptText, "utf-8"),
      fs.writeFile(
        path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"),
        serializeJson(reference),
        "utf-8",
      ),
    ]);
    await callback({ aggregateRoot, report, baselineIndex });
  } finally {
    await fs.rm(aggregateRoot, { recursive: true, force: true });
  }
}

export async function addCandidateCodingRunClientCiEvidence(aggregateRoot, options = {}) {
  const reference = await readEvidenceReference(aggregateRoot);
  const lanes = [
    createCodingRunClientCiLaneFixture({
      aggregateRoot,
      aggregate: reference.aggregate,
      platform: "ubuntu-latest",
      runnerOs: "Linux",
      jobId: 99_566_546_813,
      artifactId: 9_768_000_001,
      laneGeneratedAt: options.laneGeneratedAtByPlatform?.["ubuntu-latest"],
      laneStatus: options.laneStatusByPlatform?.["ubuntu-latest"],
    }),
    createCodingRunClientCiLaneFixture({
      aggregateRoot,
      aggregate: reference.aggregate,
      platform: "windows-latest",
      runnerOs: "Windows",
      jobId: 99_566_547_216,
      artifactId: 9_768_000_002,
      laneGeneratedAt: options.laneGeneratedAtByPlatform?.["windows-latest"],
      laneStatus: options.laneStatusByPlatform?.["windows-latest"],
    }),
  ];
  const materializedLanes = [];
  for (const lanePromise of lanes) {
    materializedLanes.push(await lanePromise);
  }

  const runApi = {
    id: CODING_RUN_CLIENT_CI.runId,
    run_attempt: CODING_RUN_CLIENT_CI.runAttempt,
    event: "push",
    head_branch: CODING_RUN_CLIENT_CI.headBranch,
    head_sha: reference.aggregate.harness.commit,
    status: "completed",
    conclusion: "failure",
    created_at: CODING_RUN_CLIENT_CI.createdAt,
    updated_at: CODING_RUN_CLIENT_CI.updatedAt,
    html_url:
      `https://github.com/${CODING_RUN_CLIENT_CI.repository}/actions/runs/${CODING_RUN_CLIENT_CI.runId}`,
    workflow_id: CODING_RUN_CLIENT_CI.workflowId,
    name: CODING_RUN_CLIENT_CI.workflowName,
    path: CODING_RUN_CLIENT_CI.workflowPath,
    repository: {
      id: CODING_RUN_CLIENT_CI.repositoryId,
      full_name: CODING_RUN_CLIENT_CI.repository,
      private: true,
    },
  };
  const jobsApi = {
    total_count: materializedLanes.length,
    jobs: materializedLanes.map(({ apiJob }) => apiJob),
  };
  const artifactsApi = {
    total_count: materializedLanes.length,
    artifacts: materializedLanes.map(({ apiArtifact }) => apiArtifact),
  };
  const apiArtifacts = [
    ["candidate-evidence/coding-run-client/ci/github-run.json", runApi],
    ["candidate-evidence/coding-run-client/ci/github-jobs.json", jobsApi],
    ["candidate-evidence/coding-run-client/ci/github-artifacts.json", artifactsApi],
  ];
  const apiReferences = {};
  for (const [relativePath, value] of apiArtifacts) {
    const valueText = serializeJson(value);
    await writeRelativeFile(aggregateRoot, relativePath, valueText);
    apiReferences[path.basename(relativePath, ".json").replace("github-", "")] = {
      format: "github-rest-json/2022-11-28",
      path: relativePath,
      sha256: sha256(valueText),
    };
  }

  const receipt = {
    schemaVersion:
      "coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1",
    generatedAt: "2026-09-01T13:30:00.000Z",
    aggregate: reference.aggregate,
    provider: "github-actions",
    github: {
      repository: {
        id: CODING_RUN_CLIENT_CI.repositoryId,
        fullName: CODING_RUN_CLIENT_CI.repository,
        private: true,
      },
      workflow: {
        id: CODING_RUN_CLIENT_CI.workflowId,
        name: CODING_RUN_CLIENT_CI.workflowName,
        path: CODING_RUN_CLIENT_CI.workflowPath,
      },
      run: {
        id: CODING_RUN_CLIENT_CI.runId,
        attempt: CODING_RUN_CLIENT_CI.runAttempt,
        event: "push",
        headBranch: CODING_RUN_CLIENT_CI.headBranch,
        headSha: reference.aggregate.harness.commit,
        status: "completed",
        conclusion: "failure",
        createdAt: CODING_RUN_CLIENT_CI.createdAt,
        updatedAt: CODING_RUN_CLIENT_CI.updatedAt,
        htmlUrl:
          `https://github.com/${CODING_RUN_CLIENT_CI.repository}/actions/runs/${CODING_RUN_CLIENT_CI.runId}`,
      },
      apiEvidence: apiReferences,
    },
    lanes: materializedLanes.map(({ receiptLane }) => receiptLane),
  };
  const receiptText = serializeJson(receipt);
  const receiptPath = "candidate-coding-run-client-ci-evidence-receipt.json";
  await writeRelativeFile(aggregateRoot, receiptPath, receiptText);
  reference.owners.candidateCodingRunClientCiReceipt = {
    kind: "candidate_artifact",
    scope: "candidate_harness",
    artifactSchemaVersion: receipt.schemaVersion,
    artifact: { path: receiptPath, sha256: sha256(receiptText) },
  };
  const protocolClaimIndex = reference.claims.findIndex(
    ({ contractId }) => contractId === "protocol_version_conformance",
  );
  const ciClaimIndex = protocolClaimIndex === -1
    ? reference.claims.length
    : protocolClaimIndex;
  reference.claims.splice(ciClaimIndex, 0, {
    dimensionId: "headless_ecosystem",
    contractId: "real_ci_consumer_binding",
    owner: "candidateCodingRunClientCiReceipt",
    completion: "current_harness_dual_platform_github_actions_coding_run_client_passed",
  });
  await writeEvidenceReference(aggregateRoot, reference);
}

export async function addCandidateCliTuiEvidence(aggregateRoot, options = {}) {
  const reference = await readEvidenceReference(aggregateRoot);
  const aggregate = reference.aggregate;
  const sourceIdentity = {
    harness: aggregate.harness,
    files: [
      { path: "packages/belldandy-core/src/coding-run/task-projection.ts", sha256: "1".repeat(64) },
      { path: "packages/belldandy-core/src/coding-run/task-efficiency-metrics.ts", sha256: "2".repeat(64) },
      { path: "packages/belldandy-core/src/tui/runtime.ts", sha256: "3".repeat(64) },
    ],
  };
  sourceIdentity.aggregateSha256 = sha256(JSON.stringify(sourceIdentity.files));
  const clients = ["cli", "tui", "webchat", "vscode"];
  const projection = {
    schemaVersion: "task-projection-cross-entry-conformance/v1",
    aggregate,
    sourceIdentity,
    entries: clients.map((client) => ({
      client,
      sequence: [
        { status: "running", allowedActions: ["observe", "cancel"], observedAtMs: 1000 },
        { status: "completed", allowedActions: ["observe", "verify"], observedAtMs: 2000 },
      ],
    })),
  };
  const efficiency = {
    schemaVersion: "task-efficiency-evidence/v1",
    aggregate,
    sourceIdentity,
    status: "complete",
    evidence: {
      status: "complete",
      projectionTimeline: {
        coverage: "complete",
        items: [{ status: "running", observedAtMs: 1000 }, { status: "completed", observedAtMs: 2000 }],
      },
    },
    metrics: {
      schemaVersion: "task-efficiency-metrics/v1",
      status: "complete",
      missingMetrics: [],
      usageCompleteness: { status: "complete", reason: "provider_reported", modelCalls: 0, providerReportedModelCalls: 0 },
    },
  };
  const files = [
    ["candidate-evidence/cli-tui/task-projection-conformance.json", projection],
    ["candidate-evidence/cli-tui/task-efficiency-evidence.json", efficiency],
  ];
  for (const platform of ["windows-native", "wsl2-linux"]) {
    files.push([`candidate-evidence/cli-tui/accessibility/${platform}.json`, {
      schemaVersion: "tui-accessibility-cross-platform/v1",
      platform,
      sourceIdentity,
      status: options.accessibilityStatusByPlatform?.[platform] ?? "complete",
      accessibility: { keyboardNavigation: true, focusVisible: true, labelsPresent: true },
      lifecycle: { firstFrame: true, narrowFallback: true, wideLayoutRestored: true, mouseTabNavigation: true, inputReplayRendered: true, residualProcessCount: 0 },
      gate: { passed: options.accessibilityStatusByPlatform?.[platform] !== "failed", failures: options.accessibilityStatusByPlatform?.[platform] === "failed" ? ["fixture failure"] : [] },
    }]);
  }
  const refs = {};
  for (const [relativePath, value] of files) {
    const text = serializeJson(value);
    await writeRelativeFile(aggregateRoot, relativePath, text);
    refs[relativePath] = { path: relativePath, sha256: sha256(text) };
  }
  const receipt = {
    schemaVersion: "coding-agent-benchmark-candidate-cli-tui-evidence-receipt/v1",
    generatedAt: "2026-09-02T14:00:00.000Z",
    aggregate,
    sourceIdentity,
    taskProjection: refs["candidate-evidence/cli-tui/task-projection-conformance.json"],
    efficiency: refs["candidate-evidence/cli-tui/task-efficiency-evidence.json"],
    accessibility: [refs["candidate-evidence/cli-tui/accessibility/windows-native.json"], refs["candidate-evidence/cli-tui/accessibility/wsl2-linux.json"]],
    summary: {
      taskProjectionCrossEntryConformance: true,
      taskProjectionTerminalActionConsistency: true,
      taskEfficiencyTimeline: true,
      tuiAccessibilityCrossPlatform: ["windows-native", "wsl2-linux"].every(
        (platform) => (options.accessibilityStatusByPlatform?.[platform] ?? "complete") === "complete",
      ),
    },
  };
  if (options.writeReceipt !== false) {
    const receiptText = serializeJson(receipt);
    await writeRelativeFile(aggregateRoot, "candidate-cli-tui-evidence-receipt.json", receiptText);
    reference.owners.candidateCliTuiReceipt = {
      kind: "candidate_artifact", scope: "candidate_harness",
      artifactSchemaVersion: receipt.schemaVersion,
      artifact: { path: "candidate-cli-tui-evidence-receipt.json", sha256: sha256(receiptText) },
    };
    const insertAt = reference.claims.findIndex(({ dimensionId }) => [
      "editing_testing", "session_long_running", "headless_ecosystem",
    ].includes(dimensionId));
    reference.claims.splice(insertAt < 0 ? reference.claims.length : insertAt, 0,
      ...[
        { dimensionId: "cli_tui", contractId: "task_projection_cross_entry_conformance", owner: "candidateCliTuiReceipt", completion: "current_harness_task_projection_four_entry_conformance_passed" },
        { dimensionId: "cli_tui", contractId: "task_projection_terminal_action_consistency", owner: "candidateCliTuiReceipt", completion: "current_harness_task_projection_terminal_action_consistency_passed" },
        { dimensionId: "cli_tui", contractId: "task_efficiency_timeline", owner: "candidateCliTuiReceipt", completion: "current_harness_task_efficiency_timeline_complete" },
        { dimensionId: "cli_tui", contractId: "tui_accessibility_cross_platform", owner: "candidateCliTuiReceipt", completion: "current_harness_dual_platform_tui_accessibility_passed" },
      ]);
  }
  await writeEvidenceReference(aggregateRoot, reference);
}

export async function writeRelativeFile(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value, "utf-8");
}

export async function readEvidenceReference(aggregateRoot) {
  return JSON.parse(await fs.readFile(
    path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"),
    "utf-8",
  ));
}

export async function writeEvidenceReference(aggregateRoot, reference) {
  await fs.writeFile(
    path.join(aggregateRoot, "candidate-dimension-evidence-reference.json"),
    serializeJson(reference),
    "utf-8",
  );
}

export function versionedIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createSystemEvidence(task, runId, platform) {
  const common = {
    schemaVersion: "coding-agent-benchmark-system-evidence/v1",
    taskId: task.id,
    generatorId: task.fixture.generatorId,
    fixtureVersion: task.fixture.version,
    runId,
    platform,
    status: "passed",
    sensitiveFindingCount: 0,
    orphanResourceCount: 0,
    duplicateSideEffectCount: 0,
  };
  if (task.id === "system.browser-behavior") {
    const screenshotSha256 = "1".repeat(64);
    const domAfterSha256 = "2".repeat(64);
    return {
      ...common,
      observations: {
        pageLoaded: true,
        consoleErrorCount: 0,
        domChanged: true,
        domAfterSha256,
        requestStatus: 200,
        networkScope: "loopback-only",
        screenshotSha256,
        screenshotBindingSha256: sha256([
          "coding-agent-benchmark-browser-binding/v1",
          runId,
          screenshotSha256,
          domAfterSha256,
        ].join("\0")),
      },
    };
  }
  if (task.id === "system.parallel-read-isolation") {
    return {
      ...common,
      observations: {
        children: ["read-a", "read-b", "read-c"].map((childId, index) => ({
          childId,
          snapshotSha256: "3".repeat(64),
          budgetId: "budget-read-v1",
          bindingId: "binding-read-v1",
          terminalStatus: "completed",
          mutationCount: 0,
          terminalEvidenceSha256: String(index + 4).repeat(64),
        })),
      },
    };
  }
  if (task.id === "system.parallel-write-fan-in") {
    return {
      ...common,
      observations: {
        mainWorkspaceChangedBeforeFanIn: false,
        lanes: ["write-a", "write-b"].map((laneId, index) => ({
          laneId,
          worktreeId: `worktree-${index + 1}`,
          baselineSha256: "7".repeat(64),
          terminalStatus: "completed",
          mutationCount: 1,
        })),
        conflict: {
          detected: true,
          path: "workspace/shared.txt",
          evidenceSha256: "8".repeat(64),
        },
        fanIn: {
          mode: "preview-confirm",
          previewSha256: "9".repeat(64),
          confirmed: true,
          status: "completed",
          resultSha256: "a".repeat(64),
        },
      },
    };
  }
  return {
    ...common,
    observations: {
      restartInjected: true,
      oldBindingId: "binding-before-restart",
      newBindingId: "binding-after-restart",
      reattached: true,
      journalState: "applied",
      completedSideEffectCount: 1,
      replayedSideEffectCount: 0,
      localDeliveryStatus: "completed",
      remoteWriteCount: 0,
      terminalStatus: "completed",
      reconciliationSha256: "b".repeat(64),
    },
  };
}

function createCandidateGlobalReceipt(aggregate) {
  return {
    schemaVersion: "coding-agent-benchmark-candidate-global-receipt/v1",
    generatedAt: "2026-09-01T01:00:00.000Z",
    aggregate,
    sensitiveScan: {
      status: "completed",
      scope: "candidate_declared_roots",
      linkPolicy: "count_do_not_follow",
      contentPolicy: "exact_values_non_echoing",
      rootCount: 4,
      regularFileCount: 128,
      unreadableFileCount: 0,
      symlinkOrReparsePointCount: 0,
      findingCount: 0,
    },
    resourceSweeps: ["windows-native", "wsl2-linux"].map((platform) => ({
      platform,
      status: "completed",
      scope: "candidate_owned_resources",
      remainingListenerCount: 0,
      remainingOwnedProcessCount: 0,
      remainingRuntimeMarkerCount: 0,
      remainingRuntimeEnvFileCount: 0,
      orphanResourceCount: 0,
    })),
  };
}

async function createCodingRunClientCiLaneFixture(input) {
  const laneStatus = input.laneStatus ?? "passed";
  const expectedConclusion = laneStatus === "passed" ? "success" : "failure";
  const report = createCodingRunClientCiVitestReport(input.platform, laneStatus);
  const reportText = serializeJson(report);
  const reportBuffer = Buffer.from(reportText, "utf-8");
  const reportSha256 = sha256(reportBuffer);
  const laneReceipt = {
    schemaVersion: "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1",
    generatedAt: input.laneGeneratedAt ?? "2026-09-01T13:04:00.000Z",
    command: "corepack pnpm verify:coding-run-client",
    github: {
      repositoryId: CODING_RUN_CLIENT_CI.repositoryId,
      repository: CODING_RUN_CLIENT_CI.repository,
      workflow: CODING_RUN_CLIENT_CI.workflowName,
      workflowRef:
        `${CODING_RUN_CLIENT_CI.repository}/${CODING_RUN_CLIENT_CI.workflowPath}@refs/heads/main`,
      job: "coding-ci-contract",
      runId: CODING_RUN_CLIENT_CI.runId,
      runAttempt: CODING_RUN_CLIENT_CI.runAttempt,
      sha: input.aggregate.harness.commit,
      ref: "refs/heads/main",
    },
    runner: {
      platform: input.platform,
      os: input.runnerOs,
      arch: "X64",
    },
    report: {
      status: laneStatus,
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      path: "vitest-report.json",
      sha256: reportSha256,
      testFiles: [...CODING_RUN_CLIENT_CI_TEST_FILES],
    },
  };
  const laneReceiptText = serializeJson(laneReceipt);
  const laneReceiptBuffer = Buffer.from(laneReceiptText, "utf-8");
  const archive = createStoredZip([
    { name: "lane-receipt.json", content: laneReceiptBuffer },
    { name: "vitest-report.json", content: reportBuffer },
  ]);
  const archivePath =
    `candidate-evidence/coding-run-client/ci/${input.platform}/artifact.zip`;
  await writeRelativeFile(input.aggregateRoot, archivePath, archive);
  const archiveSha256 = sha256(archive);
  const artifactName = `coding-run-client-ci-${input.platform}`;
  const apiArtifact = {
    id: input.artifactId,
    name: artifactName,
    size_in_bytes: archive.length,
    expired: false,
    created_at: "2026-09-01T13:04:10.000Z",
    expires_at: "2026-09-15T13:04:10.000Z",
    updated_at: "2026-09-01T13:04:10.000Z",
    digest: `sha256:${archiveSha256}`,
    workflow_run: {
      id: CODING_RUN_CLIENT_CI.runId,
      repository_id: CODING_RUN_CLIENT_CI.repositoryId,
      head_repository_id: CODING_RUN_CLIENT_CI.repositoryId,
      head_branch: CODING_RUN_CLIENT_CI.headBranch,
      head_sha: input.aggregate.harness.commit,
    },
  };
  const steps = [
    {
      name: "Verify coding-run client conformance",
      status: "completed",
      conclusion: expectedConclusion,
      number: 8,
      started_at: "2026-09-01T13:03:00.000Z",
      completed_at: "2026-09-01T13:04:00.000Z",
    },
    {
      name: "Upload coding-run client CI evidence",
      status: "completed",
      conclusion: "success",
      number: 9,
      started_at: "2026-09-01T13:04:00.000Z",
      completed_at: "2026-09-01T13:04:10.000Z",
    },
  ];
  const apiJob = {
    id: input.jobId,
    run_id: CODING_RUN_CLIENT_CI.runId,
    run_attempt: CODING_RUN_CLIENT_CI.runAttempt,
    workflow_name: CODING_RUN_CLIENT_CI.workflowName,
    head_branch: CODING_RUN_CLIENT_CI.headBranch,
    head_sha: input.aggregate.harness.commit,
    status: "completed",
    conclusion: expectedConclusion,
    started_at: "2026-09-01T13:00:10.000Z",
    completed_at: "2026-09-01T13:05:00.000Z",
    name: `Coding CI contract (${input.platform})`,
    labels: [input.platform],
    steps,
  };
  return {
    apiArtifact,
    apiJob,
    receiptLane: {
      platform: input.platform,
      runnerOs: input.runnerOs,
      job: {
        id: input.jobId,
        name: apiJob.name,
        headSha: apiJob.head_sha,
        status: apiJob.status,
        conclusion: apiJob.conclusion,
        startedAt: apiJob.started_at,
        completedAt: apiJob.completed_at,
      },
      verificationStep: githubApiStepToReceiptStep(steps[0]),
      uploadStep: githubApiStepToReceiptStep(steps[1]),
      artifact: {
        id: apiArtifact.id,
        name: apiArtifact.name,
        digest: apiArtifact.digest,
        sizeInBytes: apiArtifact.size_in_bytes,
        expired: apiArtifact.expired,
        createdAt: apiArtifact.created_at,
        expiresAt: apiArtifact.expires_at,
        workflowRun: {
          id: apiArtifact.workflow_run.id,
          repositoryId: apiArtifact.workflow_run.repository_id,
          headRepositoryId: apiArtifact.workflow_run.head_repository_id,
          headBranch: apiArtifact.workflow_run.head_branch,
          headSha: apiArtifact.workflow_run.head_sha,
        },
      },
      archive: { format: "zip", path: archivePath, sha256: archiveSha256 },
      laneReceipt: {
        artifactSchemaVersion: laneReceipt.schemaVersion,
        entry: "lane-receipt.json",
        sha256: sha256(laneReceiptBuffer),
      },
      nativeTestReport: {
        framework: "vitest",
        format: "vitest-json/v3.2.7",
        runnerVersion: "3.2.7",
        entry: "vitest-report.json",
        sha256: reportSha256,
      },
      testFiles: [...CODING_RUN_CLIENT_CI_TEST_FILES],
    },
  };
}

function createCodingRunClientCiVitestReport(platform, status) {
  const root = platform === "windows-latest"
    ? "E:/project/star-sanctuary"
    : "/home/runner/work/deep-space-sanctuary/deep-space-sanctuary";
  const testResults = CODING_RUN_CLIENT_CI_TEST_FILES.map((relativePath, index) => {
    const testStatus = status === "failed" && index === 0 ? "failed" : "passed";
    return {
      name: `${root}/${relativePath}`,
      status: testStatus,
      message: testStatus === "failed" ? "deterministic CI fixture failure" : "",
      assertionResults: [{
        ancestorTitles: [],
        fullName: `coding-run client CI ${index}`,
        status: testStatus,
        title: `coding-run client CI ${index}`,
        duration: 1,
        failureMessages: testStatus === "failed"
          ? ["deterministic CI fixture failure"]
          : [],
      }],
    };
  });
  const failedCount = status === "failed" ? 1 : 0;
  const passedCount = testResults.length - failedCount;
  return {
    numTotalTestSuites: testResults.length,
    numPassedTestSuites: passedCount,
    numFailedTestSuites: failedCount,
    numPendingTestSuites: 0,
    numTotalTests: testResults.length,
    numPassedTests: passedCount,
    numFailedTests: failedCount,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1,
    success: status === "passed",
    testResults,
  };
}

function githubApiStepToReceiptStep(step) {
  return {
    number: step.number,
    name: step.name,
    status: step.status,
    conclusion: step.conclusion,
    startedAt: step.started_at,
    completedAt: step.completed_at,
  };
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const content = Buffer.from(entry.content);
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(value) {
  let checksum = 0xffffffff;
  for (const byte of value) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
