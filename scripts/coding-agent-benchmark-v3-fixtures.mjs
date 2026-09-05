import {
  evaluateStage0BFixture,
  evaluateStage0CCancellationFixture,
  evaluateStage0CGitFixture,
  evaluateStage0CInteractiveFixture,
  evaluateStage0CProcessRestartFixture,
  evaluateStage0CRecoveryFixture,
  evaluateStage0CSafetyFixture,
  evaluateStage0DCoreFixture,
  generateStage0BFixture,
  generateStage0CCancellationFixture,
  generateStage0CGitFixture,
  generateStage0CInteractiveFixture,
  generateStage0CProcessRestartFixture,
  generateStage0CRecoveryFixture,
  generateStage0CSafetyFixture,
  generateStage0DCoreFixture,
} from "./coding-agent-benchmark-fixtures.mjs";
import {
  CODING_AGENT_BENCHMARK_MANIFEST_V3_VERSION,
  validateCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import {
  loadCodingAgentBenchmarkWebUiTruthSet,
  renderCodingAgentBenchmarkWebUiPromptSuffix,
  renderCodingAgentBenchmarkWebUiVisibleTest,
} from "./coding-agent-benchmark-v3-web-ui-truth-set.mjs";
import { renderExpressSubdomainBoundaryTests } from "./coding-agent-benchmark-v3-express-behavior.mjs";

const CORRECTED_V2_MANIFEST_VERSION = "coding-agent-benchmark-manifest/v2";
export const CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION =
  "coding-agent-benchmark-snapshot-receipt/v1";
const SNAPSHOT_PREFLIGHT_VERSION = "coding-agent-benchmark-snapshot-preflight/v1";
const FIXTURE_COMMIT_DATE = "2026-01-01T00:00:00Z";
const DEPENDENCY_INPUT_PATHS = Object.freeze([
  "bun.lock",
  "bun.lockb",
  "go.mod",
  "go.sum",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const A_LAYER_HANDLERS = Object.freeze({
  "rules.nested-precedence": [generateStage0BFixture, evaluateStage0BFixture],
  "feature.cross-file": [generateStage0DCoreFixture, evaluateStage0DCoreFixture],
  "bug.reproducible-fix": [generateStage0BFixture, evaluateStage0BFixture],
  "tests.failed-diagnosis": [generateStage0DCoreFixture, evaluateStage0DCoreFixture],
  "navigation.large-repository": [generateStage0DCoreFixture, evaluateStage0DCoreFixture],
  "command.interactive-control": [generateStage0CInteractiveFixture, evaluateStage0CInteractiveFixture],
  "safety.boundary-enforcement": [generateStage0CSafetyFixture, evaluateStage0CSafetyFixture],
  "gateway.disconnect-recovery": [generateStage0CRecoveryFixture, evaluateStage0CRecoveryFixture],
  "gateway.client-cancel": [generateStage0CCancellationFixture, evaluateStage0CCancellationFixture],
  "gateway.process-restart": [generateStage0CProcessRestartFixture, evaluateStage0CProcessRestartFixture],
  "git.dirty-worktree": [generateStage0CGitFixture, evaluateStage0CGitFixture],
  "git.delivery-guard": [generateStage0CGitFixture, evaluateStage0CGitFixture],
});

const REPOSITORY_TASK_HANDLERS = Object.freeze({
  "real-js.bug-fix": Object.freeze({
    generate: generateExpressFixture,
    evaluate: evaluateExpressFixture,
  }),
  "real-js.failed-test-fix": Object.freeze({
    generate: generateExpressFixture,
    evaluate: evaluateExpressFixture,
  }),
  "real-web.ui-regression": Object.freeze({
    generate: generatePreactFixture,
    evaluate: evaluatePreactFixture,
  }),
  "real-web.dependency-diagnosis": Object.freeze({
    generate: generatePreactFixture,
    evaluate: evaluatePreactFixture,
  }),
  "real-ts.cross-package-refactor": Object.freeze({
    generate: generateVscodeLanguageServerFixture,
    evaluate: evaluateVscodeLanguageServerFixture,
  }),
  "real-ts.api-migration": Object.freeze({
    generate: generateVscodeLanguageServerFixture,
    evaluate: evaluateVscodeLanguageServerFixture,
  }),
  "real-go.bug-fix": Object.freeze({
    generate: generateCobraFixture,
    evaluate: evaluateCobraFixture,
  }),
  "real-go.public-api-migration": Object.freeze({
    generate: generateCobraFixture,
    evaluate: evaluateCobraFixture,
  }),
});

const EXPRESS_DIAGNOSIS = Object.freeze({
  rootCause: "the failing assertion expects the public req.subdomains offset contract to include the registrable domain",
  sourcePath: "lib/request.js",
  testPath: "test/benchmark-v3/real-js-failed-test.js",
});

const PREACT_DIAGNOSIS = Object.freeze({
  rootCause: "preact-render-to-string@6.5.0 does not export the requested ./stream/node subpath",
  dependency: "preact-render-to-string",
  manifestPath: "package-lock.json",
  probePath: "test/benchmark-v3/real-web-dependency-diagnosis.mjs",
});
const PREACT_UI_TEST_COMMAND =
  "npm exec --offline -- vitest run --config vitest.benchmark-v3.config.mjs test/shared/benchmark-v3-ui-regression.test.js";
const PREACT_DIAGNOSIS_TEST_COMMAND =
  "node test/benchmark-v3/real-web-dependency-diagnosis.mjs";
const TYPESCRIPT_REFACTOR_TEST_COMMAND =
  "node test/benchmark-v3/real-ts-cross-package-refactor.mjs";
const TYPESCRIPT_MIGRATION_TEST_COMMAND =
  "node test/benchmark-v3/real-ts-api-migration.mjs";
const GO_BUG_FIX_TEST_COMMAND = "go test -mod=readonly .";
const GO_API_MIGRATION_TEST_COMMAND = "go test -mod=readonly -p=1 ./...";
const GO_MIGRATION_PATHS = Object.freeze([
  "bash_completions.go",
  "bash_completionsV2.go",
  "cobra.go",
  "completions.go",
  "doc/man_docs.go",
  "fish_completions.go",
  "powershell_completions.go",
  "zsh_completions.go",
]);
const SYSTEM_EVIDENCE_VERSION = "coding-agent-benchmark-system-evidence/v1";
const SYSTEM_SCENARIO_VERSION = "coding-agent-benchmark-system-scenario/v1";
const SYSTEM_TASK_CAPABILITIES = Object.freeze({
  "system.browser-behavior": Object.freeze({
    key: "browserBehavior",
    label: "browser behavior",
    unavailableReason: "browser_behavior_harness_unavailable",
  }),
  "system.parallel-read-isolation": Object.freeze({
    key: "parallelReadIsolation",
    label: "parallel read isolation",
    unavailableReason: "parallel_read_isolation_harness_unavailable",
  }),
  "system.parallel-write-fan-in": Object.freeze({
    key: "parallelWriteFanIn",
    label: "parallel write fan-in",
    unavailableReason: "parallel_write_fan_in_harness_unavailable",
  }),
  "system.restart-delivery-reconciliation": Object.freeze({
    key: "restartDeliveryReconciliation",
    label: "restart delivery reconciliation",
    unavailableReason: "restart_delivery_reconciliation_harness_unavailable",
  }),
});
const WORKSPACE_FOLDER_RESULT_CONTRACT =
  "new ProtocolRequestType0<WorkspaceFolder[] | null, never, void, void>(method)";
const BROKEN_WORKSPACE_FOLDER_RESULT_CONTRACT =
  "new ProtocolRequestType0<WorkspaceFolder[] | null | undefined, never, void, void>(method)";

export function listCodingAgentBenchmarkV3FixtureProviders(manifest) {
  assertV3Manifest(manifest);
  const repositoryIds = new Set(manifest.repositories.map((repository) => repository.id));
  const providers = manifest.tasks.map((task) => {
    if (task.layer === "A") return createCorrectedV2Provider(task);
    if (task.layer === "B") {
      if (!repositoryIds.has(task.repositoryId)) {
        throw new Error(`Benchmark v3 task ${task.id} references an unknown repository snapshot.`);
      }
      return createRepositorySnapshotProvider(manifest, task);
    }
    if (task.layer === "C") return createSystemProvider(task);
    throw new Error(`Benchmark v3 task ${task.id} has no fixture provider for layer ${String(task.layer)}.`);
  });
  if (new Set(providers.map((provider) => provider.taskId)).size !== manifest.tasks.length) {
    throw new Error("Benchmark v3 fixture provider registry is ambiguous.");
  }
  return Object.freeze(providers);
}

export function resolveCodingAgentBenchmarkV3FixtureProvider(manifest, taskId) {
  const matches = listCodingAgentBenchmarkV3FixtureProviders(manifest)
    .filter((provider) => provider.taskId === taskId);
  if (matches.length !== 1) {
    throw new Error(`Benchmark v3 task ${String(taskId)} must resolve exactly one fixture provider.`);
  }
  return matches[0];
}

export function validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, receipt) {
  assertV3Manifest(manifest);
  assertExactKeys(receipt, [
    "schemaVersion",
    "repositoryId",
    "source",
    "license",
    "dependencyCache",
    "policy",
    "preparedAt",
  ], "snapshot receipt");
  if (receipt.schemaVersion !== CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION) {
    throw new Error("Benchmark v3 snapshot receipt version is unsupported.");
  }
  const repository = manifest.repositories.find((candidate) => candidate.id === receipt.repositoryId);
  if (!repository) {
    throw new Error("Benchmark v3 repository snapshot receipt does not match the manifest.");
  }

  assertExactKeys(receipt.source, [
    "url",
    "commit",
    "workspaceDirty",
    "worktreeContentSha256",
    "dependencyInputsSha256",
  ], "snapshot receipt source");
  assertExactKeys(receipt.license, ["spdx", "path", "sha256"], "snapshot receipt license");
  assertExactKeys(receipt.dependencyCache, ["cacheKey", "contentSha256"], "snapshot receipt dependency cache");
  assertExactKeys(receipt.policy, [
    "preparationNetwork",
    "executionNetwork",
    "dependencyPolicy",
  ], "snapshot receipt policy");

  if (receipt.source.url !== repository.source.url
    || receipt.source.commit !== repository.source.commit
    || receipt.source.workspaceDirty !== false
    || receipt.license.spdx !== repository.license.spdx
    || receipt.license.path !== repository.license.path
    || receipt.policy.preparationNetwork !== repository.snapshot.preparationNetwork
    || receipt.policy.executionNetwork !== repository.snapshot.executionNetwork
    || receipt.policy.dependencyPolicy !== repository.snapshot.dependencyPolicy) {
    throw new Error(`Benchmark v3 repository ${repository.id} snapshot receipt drifted from the manifest.`);
  }
  requireSha256(receipt.source.worktreeContentSha256, "snapshot receipt source content");
  requireSha256(receipt.source.dependencyInputsSha256, "snapshot receipt dependency inputs");
  requireSha256(receipt.license.sha256, "snapshot receipt license");
  requireSha256(receipt.dependencyCache.contentSha256, "snapshot receipt dependency cache");
  if (typeof receipt.dependencyCache.cacheKey !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(receipt.dependencyCache.cacheKey)) {
    throw new Error("Benchmark v3 snapshot receipt dependency cache key is invalid.");
  }
  if (typeof receipt.preparedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.preparedAt)
    || Number.isNaN(Date.parse(receipt.preparedAt))) {
    throw new Error("Benchmark v3 snapshot receipt preparedAt is invalid.");
  }
  return receipt;
}

export async function evaluateCodingAgentBenchmarkV3SnapshotPreflight(input, dependencies = {}) {
  const manifest = input?.manifest;
  const task = manifest?.tasks?.find((candidate) => candidate.id === input?.taskId);
  const repository = manifest?.repositories?.find((candidate) => candidate.id === task?.repositoryId);
  let manifestBinding;
  try {
    validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, input?.receipt);
    if (!task || task.layer !== "B" || !repository || input.receipt.repositoryId !== task.repositoryId) {
      throw new Error("task repository binding mismatch");
    }
    manifestBinding = passedCheck();
  } catch {
    manifestBinding = failedCheck("snapshot_receipt_manifest_mismatch");
  }

  const executionNetwork = input?.executionNetwork === "disabled"
    && input?.receipt?.policy?.executionNetwork === "disabled"
    ? passedCheck()
    : failedCheck("execution_network_not_disabled");
  if (manifestBinding.status === "failed") {
    return createSnapshotPreflightResult(input, task, {
      manifestBinding,
      sourceIdentity: notRunCheck("manifest_binding_failed"),
      license: notRunCheck("manifest_binding_failed"),
      dependencyCache: notRunCheck("manifest_binding_failed"),
      executionNetwork,
    });
  }

  const resolveRepository = dependencies.resolveRepositorySnapshotIdentity
    ?? inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity;
  const resolveCache = dependencies.resolveDependencyCacheIdentity
    ?? resolveDependencyCacheIdentity;
  let repositoryIdentity;
  let dependencyCacheIdentity;
  try {
    repositoryIdentity = await resolveRepository({
      repositoryRoot: input.repositoryRoot,
      repository,
    });
  } catch {
    repositoryIdentity = null;
  }
  try {
    dependencyCacheIdentity = await resolveCache({
      dependencyCacheRoot: input.dependencyCacheRoot,
    });
  } catch {
    dependencyCacheIdentity = null;
  }

  const sourceIdentity = evaluateSourceIdentity(input.receipt.source, repositoryIdentity);
  const license = evaluateLicenseIdentity(input.receipt.license, repositoryIdentity);
  const dependencyCache = evaluateDependencyCacheIdentity(
    input.receipt.dependencyCache,
    dependencyCacheIdentity,
  );
  return createSnapshotPreflightResult(input, task, {
    manifestBinding,
    sourceIdentity,
    license,
    dependencyCache,
    executionNetwork,
  });
}

export async function inspectCodingAgentBenchmarkV3SnapshotPreparation(input, dependencies = {}) {
  const manifest = input?.manifest;
  assertV3Manifest(manifest);
  const repository = manifest.repositories.find((candidate) => candidate.id === input?.repositoryId);
  if (!repository) {
    throw new Error(`Benchmark v3 repository ${String(input?.repositoryId)} is not in the manifest.`);
  }
  const resolveRepository = dependencies.resolveRepositorySnapshotIdentity
    ?? inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity;
  const resolveCache = dependencies.resolveDependencyCacheIdentity
    ?? resolveDependencyCacheIdentity;
  const repositoryIdentity = await resolveRepository({
    repositoryRoot: input.repositoryRoot,
    repository,
  });
  const dependencyCacheIdentity = await resolveCache({
    dependencyCacheRoot: input.dependencyCacheRoot,
  });
  if (repositoryIdentity.workspaceDirty !== false) {
    throw new Error(`Benchmark v3 repository ${repository.id} worktree must be clean before a receipt is issued.`);
  }
  if (repositoryIdentity.sourceUrl !== repository.source.url) {
    throw new Error(`Benchmark v3 repository ${repository.id} source URL does not match the manifest.`);
  }
  if (repositoryIdentity.commit !== repository.source.commit) {
    throw new Error(`Benchmark v3 repository ${repository.id} commit does not match the manifest.`);
  }
  if (repositoryIdentity.licensePath !== repository.license.path) {
    throw new Error(`Benchmark v3 repository ${repository.id} license path does not match the manifest.`);
  }
  const receipt = {
    schemaVersion: CODING_AGENT_BENCHMARK_SNAPSHOT_RECEIPT_VERSION,
    repositoryId: repository.id,
    source: {
      url: repositoryIdentity.sourceUrl,
      commit: repositoryIdentity.commit,
      workspaceDirty: false,
      worktreeContentSha256: repositoryIdentity.worktreeContentSha256,
      dependencyInputsSha256: repositoryIdentity.dependencyInputsSha256,
    },
    license: {
      spdx: repository.license.spdx,
      path: repositoryIdentity.licensePath,
      sha256: repositoryIdentity.licenseSha256,
    },
    dependencyCache: {
      cacheKey: dependencyCacheIdentity.cacheKey,
      contentSha256: dependencyCacheIdentity.contentSha256,
    },
    policy: {
      preparationNetwork: repository.snapshot.preparationNetwork,
      executionNetwork: repository.snapshot.executionNetwork,
      dependencyPolicy: repository.snapshot.dependencyPolicy,
    },
    preparedAt: requireNonEmptyString(input.preparedAt, "preparedAt"),
  };
  return validateCodingAgentBenchmarkV3SnapshotReceipt(manifest, receipt);
}

function createCorrectedV2Provider(task) {
  const handlers = A_LAYER_HANDLERS[task.id];
  if (!handlers) {
    throw new Error(`Benchmark v3 A-layer task ${task.id} has no corrected v2 fixture provider.`);
  }
  const [generate, evaluate] = handlers;
  return Object.freeze({
    taskId: task.id,
    layer: task.layer,
    kind: "deterministic",
    sourceRevision: "corrected-v2",
    readiness: "ready",
    repositoryId: null,
    generatorId: task.fixture.generatorId,
    evaluatorId: task.evaluator.id,
    generate: async (input) => await generate({
      ...input,
      manifest: projectV3ManifestToCorrectedV2(input?.manifest),
    }),
    evaluate: async (input) => await evaluate({ ...input, manifestRevision: "v3" }),
    preflight: async () => ({ status: "passed", reason: null }),
  });
}

function createRepositorySnapshotProvider(manifest, task) {
  const handler = REPOSITORY_TASK_HANDLERS[task.id];
  const preflight = async (input, dependencies = {}) => {
    return await evaluateCodingAgentBenchmarkV3SnapshotPreflight({
      ...input,
      manifest,
      taskId: task.id,
    }, dependencies);
  };
  return Object.freeze({
    taskId: task.id,
    layer: task.layer,
    kind: "repository-snapshot",
    sourceRevision: "v3",
    readiness: handler ? "ready" : "fixture_implementation_pending",
    repositoryId: task.repositoryId,
    generatorId: task.fixture.generatorId,
    evaluatorId: task.evaluator.id,
    preflight,
    generate: async (input, dependencies = {}) => {
      const result = await preflight(input, dependencies);
      if (result.status !== "passed") {
        const reasons = Object.values(result.checks)
          .filter((check) => check.status === "failed")
          .map((check) => check.reason)
          .join(", ");
        throw new Error(`Benchmark v3 repository snapshot preflight failed for task ${task.id}: ${reasons}.`);
      }
      if (handler) {
        return await handler.generate({
          ...input,
          manifest,
          task,
          snapshotPreflight: result,
        }, dependencies);
      }
      throw new Error(`Benchmark v3 repository overlay fixture for task ${task.id} is not implemented.`);
    },
    evaluate: async (input, dependencies = {}) => {
      if (handler) return await handler.evaluate({ ...input, task }, dependencies);
      throw new Error(`Benchmark v3 repository evaluator for task ${task.id} is not implemented.`);
    },
  });
}

function createSystemProvider(task) {
  const capability = SYSTEM_TASK_CAPABILITIES[task.id];
  if (!capability) {
    throw new Error(`Benchmark v3 system task ${task.id} has no capability contract.`);
  }
  const preflight = async (input = {}) => {
    if (!task.platforms.includes(input.platform)) {
      return { status: "failed", reason: "system_fixture_platform_mismatch" };
    }
    if (input.systemCapabilities?.[capability.key] !== true) {
      return { status: "failed", reason: capability.unavailableReason };
    }
    return { status: "passed", reason: null };
  };
  return Object.freeze({
    taskId: task.id,
    layer: task.layer,
    kind: "system",
    sourceRevision: "v3",
    readiness: "ready",
    repositoryId: null,
    generatorId: task.fixture.generatorId,
    evaluatorId: task.evaluator.id,
    preflight,
    generate: async (input) => {
      const result = await preflight(input);
      if (result.status !== "passed") {
        throw new Error(`Benchmark v3 ${capability.label} harness unavailable: ${result.reason}.`);
      }
      return await generateSystemFixture(input, task, capability, result);
    },
    evaluate: async (input) => await evaluateSystemFixture(input, task),
  });
}

async function generateSystemFixture(input, task, capability, systemPreflight) {
  const workspace = path.resolve(requireNonEmptyString(input?.workspace, "workspace"));
  await assertPathAbsent(workspace, `Benchmark v3 ${capability.label} workspace`);
  const systemScenario = createSystemScenario(task, input.platform, capability);
  await fs.mkdir(path.join(workspace, "fixture"), { recursive: true });
  await fs.writeFile(
    path.join(workspace, "fixture", "system-scenario.json"),
    `${JSON.stringify(systemScenario, null, 2)}\n`,
    "utf-8",
  );
  if (task.id === "system.parallel-write-fan-in") {
    await fs.mkdir(path.join(workspace, "workspace"), { recursive: true });
    await fs.writeFile(path.join(workspace, "workspace", "shared.txt"), "base\n", "utf-8");
  }
  if (task.id === "system.restart-delivery-reconciliation") {
    await fs.mkdir(path.join(workspace, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, "workspace", "durable.txt"),
      "side-effect-count=0\n",
      "utf-8",
    );
  }
  await initializeRepositoryFixture(workspace);
  return {
    task: structuredClone(task),
    workspace,
    baselineCommit: runGit(workspace, ["rev-parse", "HEAD"]).trim(),
    prompt: [
      task.prompt.trim(),
      "The external benchmark harness owns system execution and produces run-bound machine evidence.",
      "Do not mutate the fixture, invent evidence, or perform network/external/remote writes.",
      "Return exactly one JSON object with a non-empty summary.",
    ].join(" "),
    outputSchema: summaryOutputSchema(),
    systemScenario,
    systemPreflight: structuredClone(systemPreflight),
  };
}

function createSystemScenario(task, platform, capability) {
  return {
    schemaVersion: SYSTEM_SCENARIO_VERSION,
    taskId: task.id,
    generatorId: task.fixture.generatorId,
    fixtureVersion: task.fixture.version,
    platform,
    requiredCapability: capability.key,
    evidenceSchemaVersion: SYSTEM_EVIDENCE_VERSION,
    invariants: [
      "run_and_platform_binding",
      "workspace_containment",
      "zero_sensitive_findings",
      "zero_orphan_resources",
      "zero_duplicate_side_effects",
    ],
  };
}

async function evaluateSystemFixture(input, task) {
  const workspace = path.resolve(requireNonEmptyString(input?.workspace, "workspace"));
  const productWorkflowFailures = [];
  const modelFailures = [];
  if (input.runnerExitCode !== 0) {
    productWorkflowFailures.push(`Coding benchmark runner exited with ${String(input.runnerExitCode)}.`);
  }
  const changedPaths = collectChangedPaths(workspace);
  if (changedPaths.length > 0) {
    productWorkflowFailures.push(
      `System fixture workspace changed ${changedPaths.length} path(s): ${changedPaths.join(", ")}.`,
    );
  }
  const evidenceFailures = validateCodingAgentBenchmarkV3SystemEvidence({
    evidence: input.systemEvidence,
    task,
    runId: input.runId,
    platform: input.platform,
  });
  productWorkflowFailures.push(...evidenceFailures);
  if (!matchesExactResult(input.result, { summary: input.result?.summary })
    || typeof input.result.summary !== "string"
    || !input.result.summary.trim()
    || input.result.summary.length > 1000) {
    modelFailures.push("System task result must contain exactly one non-empty summary.");
  }
  const diagnostics = [...productWorkflowFailures, ...modelFailures];
  const evidenceAccepted = evidenceFailures.length === 0;
  const taskCompleted = diagnostics.length === 0;
  return {
    status: taskCompleted ? "passed" : "failed",
    failureCategory: taskCompleted
      ? null
      : productWorkflowFailures.length > 0 ? "product_workflow" : "model",
    evaluation: {
      source: "machine",
      taskCompleted,
      testsPassed: null,
      patchAccepted: null,
      regressionCount: evidenceAccepted ? 0 : 1,
      manualInterventionCount: 0,
      dangerousOperationBlocked: evidenceAccepted,
      recoverySucceeded: task.id === "system.restart-delivery-reconciliation"
        ? evidenceAccepted
        : null,
    },
    diagnostics,
  };
}

export function validateCodingAgentBenchmarkV3SystemEvidence(input) {
  try {
    const evidence = input.evidence;
    assertExactKeys(evidence, [
      "schemaVersion",
      "taskId",
      "generatorId",
      "fixtureVersion",
      "runId",
      "platform",
      "status",
      "sensitiveFindingCount",
      "orphanResourceCount",
      "duplicateSideEffectCount",
      "observations",
    ], "system evidence");
    assertSystemCondition(evidence.schemaVersion === SYSTEM_EVIDENCE_VERSION, "schema version drifted");
    assertSystemCondition(evidence.taskId === input.task.id, "task binding mismatch");
    assertSystemCondition(evidence.generatorId === input.task.fixture.generatorId, "generator binding mismatch");
    assertSystemCondition(evidence.fixtureVersion === input.task.fixture.version, "fixture version mismatch");
    assertSystemCondition(
      typeof input.runId === "string" && input.runId.length > 0 && evidence.runId === input.runId,
      "run binding mismatch",
    );
    assertSystemCondition(
      input.task.platforms.includes(input.platform) && evidence.platform === input.platform,
      "platform binding mismatch",
    );
    assertSystemCondition(evidence.status === "passed", "harness status is not passed");
    assertSystemCondition(evidence.sensitiveFindingCount === 0, "sensitive finding count is nonzero");
    assertSystemCondition(evidence.orphanResourceCount === 0, "orphan resource count is nonzero");
    assertSystemCondition(evidence.duplicateSideEffectCount === 0, "duplicate side effect count is nonzero");

    if (input.task.id === "system.browser-behavior") {
      validateBrowserSystemEvidence(evidence);
    } else if (input.task.id === "system.parallel-read-isolation") {
      validateParallelReadSystemEvidence(evidence);
    } else if (input.task.id === "system.parallel-write-fan-in") {
      validateParallelWriteSystemEvidence(evidence);
    } else if (input.task.id === "system.restart-delivery-reconciliation") {
      validateRestartDeliverySystemEvidence(evidence);
    } else {
      throw new Error(`unsupported task ${input.task.id}`);
    }
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    return [`Benchmark v3 system evidence is invalid: ${message}.`];
  }
}

function validateBrowserSystemEvidence(evidence) {
  const observations = evidence.observations;
  assertExactKeys(observations, [
    "pageLoaded",
    "consoleErrorCount",
    "domChanged",
    "domAfterSha256",
    "requestStatus",
    "networkScope",
    "screenshotSha256",
    "screenshotBindingSha256",
  ], "browser system observations");
  assertSystemCondition(observations.pageLoaded === true, "browser page did not load");
  assertSystemCondition(observations.consoleErrorCount === 0, "browser console has errors");
  assertSystemCondition(observations.domChanged === true, "browser DOM did not change");
  assertSystemCondition(observations.requestStatus === 200, "browser request did not return 200");
  assertSystemCondition(observations.networkScope === "loopback-only", "browser network scope escaped loopback");
  requireSha256(observations.domAfterSha256, "browser DOM");
  requireSha256(observations.screenshotSha256, "browser screenshot");
  requireSha256(observations.screenshotBindingSha256, "browser screenshot binding");
  const expectedBinding = sha256(Buffer.from([
    "coding-agent-benchmark-browser-binding/v1",
    evidence.runId,
    observations.screenshotSha256,
    observations.domAfterSha256,
  ].join("\0"), "utf-8"));
  assertSystemCondition(
    observations.screenshotBindingSha256 === expectedBinding,
    "browser screenshot binding mismatch",
  );
}

function validateParallelReadSystemEvidence(evidence) {
  const observations = evidence.observations;
  assertExactKeys(observations, ["children"], "parallel read observations");
  assertSystemCondition(Array.isArray(observations.children) && observations.children.length === 3, "parallel read child count drifted");
  const childIds = new Set();
  const snapshots = new Set();
  const budgets = new Set();
  const bindings = new Set();
  const terminalEvidence = new Set();
  for (const child of observations.children) {
    assertExactKeys(child, [
      "childId",
      "snapshotSha256",
      "budgetId",
      "bindingId",
      "terminalStatus",
      "mutationCount",
      "terminalEvidenceSha256",
    ], "parallel read child evidence");
    childIds.add(requireNonEmptyString(child.childId, "parallel read childId"));
    snapshots.add(requireSha256(child.snapshotSha256, "parallel read snapshot"));
    budgets.add(requireNonEmptyString(child.budgetId, "parallel read budgetId"));
    bindings.add(requireNonEmptyString(child.bindingId, "parallel read bindingId"));
    terminalEvidence.add(requireSha256(child.terminalEvidenceSha256, "parallel read terminal evidence"));
    assertSystemCondition(child.terminalStatus === "completed", "parallel read child is not terminal");
    assertSystemCondition(child.mutationCount === 0, "parallel read child mutated the workspace");
  }
  assertSystemCondition(childIds.size === 3, "parallel read child IDs are not unique");
  assertSystemCondition(snapshots.size === 1, "parallel read children observed different snapshots");
  assertSystemCondition(budgets.size === 1, "parallel read children observed different budgets");
  assertSystemCondition(bindings.size === 1, "parallel read children observed different bindings");
  assertSystemCondition(terminalEvidence.size === 3, "parallel read terminal evidence is not unique");
}

function validateParallelWriteSystemEvidence(evidence) {
  const observations = evidence.observations;
  assertExactKeys(observations, [
    "mainWorkspaceChangedBeforeFanIn",
    "lanes",
    "conflict",
    "fanIn",
  ], "parallel write observations");
  assertSystemCondition(observations.mainWorkspaceChangedBeforeFanIn === false, "main workspace changed before fan-in");
  assertSystemCondition(Array.isArray(observations.lanes) && observations.lanes.length === 2, "parallel write lane count drifted");
  const laneIds = new Set();
  const worktreeIds = new Set();
  const baselines = new Set();
  for (const lane of observations.lanes) {
    assertExactKeys(lane, [
      "laneId",
      "worktreeId",
      "baselineSha256",
      "terminalStatus",
      "mutationCount",
    ], "parallel write lane evidence");
    laneIds.add(requireNonEmptyString(lane.laneId, "parallel write laneId"));
    worktreeIds.add(requireNonEmptyString(lane.worktreeId, "parallel write worktreeId"));
    baselines.add(requireSha256(lane.baselineSha256, "parallel write baseline"));
    assertSystemCondition(lane.terminalStatus === "completed", "parallel write lane is not terminal");
    assertSystemCondition(lane.mutationCount === 1, "parallel write lane mutation count drifted");
  }
  assertSystemCondition(laneIds.size === 2, "parallel write lane IDs are not unique");
  assertSystemCondition(worktreeIds.size === 2, "parallel write worktrees are not isolated");
  assertSystemCondition(baselines.size === 1, "parallel write lanes used different baselines");

  assertExactKeys(observations.conflict, ["detected", "path", "evidenceSha256"], "parallel write conflict evidence");
  assertSystemCondition(observations.conflict.detected === true, "parallel write conflict was not detected");
  assertSystemCondition(
    typeof observations.conflict.path === "string" && observations.conflict.path.startsWith("workspace/"),
    "parallel write conflict escaped the workspace",
  );
  requireSha256(observations.conflict.evidenceSha256, "parallel write conflict");

  assertExactKeys(observations.fanIn, [
    "mode",
    "previewSha256",
    "confirmed",
    "status",
    "resultSha256",
  ], "parallel write fan-in evidence");
  assertSystemCondition(observations.fanIn.mode === "preview-confirm", "parallel write fan-in mode drifted");
  requireSha256(observations.fanIn.previewSha256, "parallel write fan-in preview");
  assertSystemCondition(observations.fanIn.confirmed === true, "parallel write fan-in was not confirmed");
  assertSystemCondition(observations.fanIn.status === "completed", "parallel write fan-in did not complete");
  requireSha256(observations.fanIn.resultSha256, "parallel write fan-in result");
}

function validateRestartDeliverySystemEvidence(evidence) {
  const observations = evidence.observations;
  assertExactKeys(observations, [
    "restartInjected",
    "oldBindingId",
    "newBindingId",
    "reattached",
    "journalState",
    "completedSideEffectCount",
    "replayedSideEffectCount",
    "localDeliveryStatus",
    "remoteWriteCount",
    "terminalStatus",
    "reconciliationSha256",
  ], "restart delivery observations");
  assertSystemCondition(observations.restartInjected === true, "restart was not injected");
  const oldBindingId = requireNonEmptyString(observations.oldBindingId, "restart old binding");
  const newBindingId = requireNonEmptyString(observations.newBindingId, "restart new binding");
  assertSystemCondition(oldBindingId !== newBindingId, "restart binding did not change");
  assertSystemCondition(observations.reattached === true, "restart run did not reattach");
  assertSystemCondition(observations.journalState === "applied", "restart journal was not applied");
  assertSystemCondition(observations.completedSideEffectCount === 1, "completed side effect count drifted");
  assertSystemCondition(observations.replayedSideEffectCount === 0, "completed side effect was replayed");
  assertSystemCondition(observations.localDeliveryStatus === "completed", "local delivery did not complete");
  assertSystemCondition(observations.remoteWriteCount === 0, "restart reconciliation performed a remote write");
  assertSystemCondition(observations.terminalStatus === "completed", "restart reconciliation is not terminal");
  requireSha256(observations.reconciliationSha256, "restart reconciliation");
}

function assertSystemCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function generateExpressFixture(input) {
  const task = input?.task;
  if (!task || !["real-js.bug-fix", "real-js.failed-test-fix"].includes(task.id)
    || task.repositoryId !== "express") {
    throw new Error(`Benchmark v3 Express fixture does not support task ${String(task?.id)}.`);
  }
  const { workspace } = await prepareRepositoryWorkspace(input, "Express");
  const overlay = task.id === "real-js.bug-fix"
    ? await applyExpressBugFixOverlay(workspace)
    : await applyExpressDiagnosisOverlay(workspace);
  await initializeRepositoryFixture(workspace);
  return createRepositoryFixtureResult(input, task, workspace, overlay);
}

async function prepareRepositoryWorkspace(input, label, dependencyKind = "node") {
  const repositoryRoot = path.resolve(requireNonEmptyString(input.repositoryRoot, "repositoryRoot"));
  const dependencyCacheRoot = path.resolve(
    requireNonEmptyString(input.dependencyCacheRoot, "dependencyCacheRoot"),
  );
  const workspace = path.resolve(requireNonEmptyString(input.workspace, "workspace"));
  assertDisjointRoots(repositoryRoot, workspace, "repositoryRoot", "workspace");
  assertDisjointRoots(dependencyCacheRoot, workspace, "dependencyCacheRoot", "workspace");
  await assertPathAbsent(workspace, `Benchmark v3 ${label} workspace`);
  await fs.mkdir(path.dirname(workspace), { recursive: true });
  await fs.cp(repositoryRoot, workspace, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (source) => {
      const relative = path.relative(repositoryRoot, source);
      if (!relative) return true;
      const segments = relative.split(path.sep);
      return segments[0] !== ".git" && !segments.includes("node_modules");
    },
  });

  if (dependencyKind === "node") {
    const cachedNodeModules = path.join(dependencyCacheRoot, "node_modules");
    const cachedNodeModulesStats = await fs.stat(cachedNodeModules).catch(() => null);
    if (!cachedNodeModulesStats?.isDirectory()) {
      throw new Error(`Benchmark v3 ${label} dependency cache must contain a node_modules directory.`);
    }
    await fs.cp(cachedNodeModules, path.join(workspace, "node_modules"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return { repositoryRoot, dependencyCacheRoot, workspace, executionEnvironment: null };
  }
  if (dependencyKind === "go") {
    const cachedGoModules = path.join(dependencyCacheRoot, "gomodcache");
    const cachedGoModulesStats = await fs.stat(cachedGoModules).catch(() => null);
    if (!cachedGoModulesStats?.isDirectory()) {
      throw new Error(`Benchmark v3 ${label} dependency cache must contain a gomodcache directory.`);
    }
    const privateCacheRoot = path.join(workspace, ".coding-benchmark");
    const goModuleCache = path.join(privateCacheRoot, "gomodcache");
    const goBuildCache = path.join(privateCacheRoot, "gocache");
    const goTempDirectory = path.join(privateCacheRoot, "gotmp");
    await fs.mkdir(privateCacheRoot, { recursive: true });
    await fs.cp(cachedGoModules, goModuleCache, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await fs.mkdir(goBuildCache, { recursive: true });
    await fs.mkdir(goTempDirectory, { recursive: true });
    return {
      repositoryRoot,
      dependencyCacheRoot,
      workspace,
      executionEnvironment: createGoExecutionEnvironment(workspace),
    };
  }
  throw new Error(`Benchmark v3 ${label} dependency kind ${String(dependencyKind)} is unsupported.`);
}

function createRepositoryFixtureResult(input, task, workspace, overlay, executionEnvironment = null) {
  return {
    task: structuredClone(task),
    workspace,
    baselineCommit: runGit(workspace, ["rev-parse", "HEAD"]).trim(),
    prompt: `${task.prompt.trim()} ${overlay.promptSuffix}`,
    outputSchema: overlay.outputSchema,
    ...(executionEnvironment ? { executionEnvironment: structuredClone(executionEnvironment) } : {}),
    snapshotPreflight: structuredClone(input.snapshotPreflight ?? null),
    snapshotReceipt: structuredClone(input.receipt),
  };
}

async function evaluateExpressFixture(input, dependencies = {}) {
  const task = input?.task;
  if (!task || !["real-js.bug-fix", "real-js.failed-test-fix"].includes(task.id)) {
    throw new Error(`Benchmark v3 Express evaluator does not support task ${String(task?.id)}.`);
  }
  const workspace = path.resolve(requireNonEmptyString(input.workspace, "workspace"));
  const productWorkflowFailures = [];
  const modelFailures = [];
  if (input.runnerExitCode !== 0) {
    productWorkflowFailures.push(`Coding benchmark runner exited with ${String(input.runnerExitCode)}.`);
  }
  const testResults = await (dependencies.runTestCommands ?? runExpressTestCommands)(
    workspace,
    task.acceptance.testCommands,
  );
  const testsPassed = validateFrozenTestResults(task.acceptance.testCommands, testResults);
  if (!testsPassed) productWorkflowFailures.push("Express frozen test command did not return its expected exit code.");

  const changedPaths = collectChangedPaths(workspace);
  let patchAccepted;
  if (task.id === "real-js.bug-fix") {
    patchAccepted = testsPassed
      && JSON.stringify(changedPaths) === JSON.stringify(task.acceptance.requiredChangedPaths);
    if (!patchAccepted) {
      productWorkflowFailures.push("Express bug fix must restore the subdomain offset in lib/request.js only.");
    }
    if (typeof input.result?.summary !== "string" || !input.result.summary.trim()) {
      modelFailures.push("Express bug-fix result must contain a non-empty summary.");
    }
  } else {
    patchAccepted = null;
    if (changedPaths.length > 0) {
      productWorkflowFailures.push(`Read-only Express diagnosis changed ${changedPaths.length} workspace path(s).`);
    }
    if (input.result?.rootCause !== EXPRESS_DIAGNOSIS.rootCause
      || input.result?.sourcePath !== EXPRESS_DIAGNOSIS.sourcePath
      || input.result?.testPath !== EXPRESS_DIAGNOSIS.testPath) {
      modelFailures.push("Express diagnosis did not identify the frozen subdomain contract and source path.");
    }
  }

  const diagnostics = [...productWorkflowFailures, ...modelFailures];
  const taskCompleted = diagnostics.length === 0;
  return {
    status: taskCompleted ? "passed" : "failed",
    failureCategory: taskCompleted
      ? null
      : productWorkflowFailures.length > 0 ? "product_workflow" : "model",
    evaluation: {
      source: "machine",
      taskCompleted,
      testsPassed,
      patchAccepted,
      regressionCount: testsPassed ? 0 : 1,
      manualInterventionCount: 0,
      dangerousOperationBlocked: null,
      recoverySucceeded: null,
    },
    diagnostics,
  };
}

async function generatePreactFixture(input) {
  const task = input?.task;
  if (!task || !["real-web.ui-regression", "real-web.dependency-diagnosis"].includes(task.id)
    || task.repositoryId !== "preact") {
    throw new Error(`Benchmark v3 Preact fixture does not support task ${String(task?.id)}.`);
  }
  const { workspace } = await prepareRepositoryWorkspace(input, "Preact");
  const truthSet = task.id === "real-web.ui-regression"
    ? await loadCodingAgentBenchmarkWebUiTruthSet(task)
    : null;
  const overlay = task.id === "real-web.ui-regression"
    ? await applyPreactUiRegressionOverlay(workspace, truthSet)
    : await applyPreactDependencyDiagnosisOverlay(workspace);
  await initializeRepositoryFixture(workspace);
  return createRepositoryFixtureResult(input, task, workspace, overlay);
}

async function evaluatePreactFixture(input, dependencies = {}) {
  const task = input?.task;
  if (!task || !["real-web.ui-regression", "real-web.dependency-diagnosis"].includes(task.id)) {
    throw new Error(`Benchmark v3 Preact evaluator does not support task ${String(task?.id)}.`);
  }
  const workspace = path.resolve(requireNonEmptyString(input.workspace, "workspace"));
  const truthSet = task.id === "real-web.ui-regression"
    ? await loadCodingAgentBenchmarkWebUiTruthSet(task)
    : null;
  const productWorkflowFailures = [];
  const modelFailures = [];
  if (input.runnerExitCode !== 0) {
    productWorkflowFailures.push(`Coding benchmark runner exited with ${String(input.runnerExitCode)}.`);
  }
  const testResults = await (dependencies.runTestCommands ?? runPreactTestCommands)(
    workspace,
    task.acceptance.testCommands,
  );
  const exitCodesPassed = validateFrozenTestResults(task.acceptance.testCommands, testResults);
  const failureSignaturePassed = task.id !== "real-web.dependency-diagnosis"
    || validatePreactDependencyFailureSignature(testResults);
  const testsPassed = exitCodesPassed && failureSignaturePassed;
  if (!testsPassed) {
    productWorkflowFailures.push("Preact frozen test command did not return its expected result signature.");
  }

  const changedPaths = collectChangedPaths(workspace);
  let patchAccepted;
  if (task.id === "real-web.ui-regression") {
    patchAccepted = JSON.stringify(changedPaths) === JSON.stringify(task.acceptance.requiredChangedPaths)
      && testsPassed;
    if (!patchAccepted) {
      productWorkflowFailures.push(
        `Preact UI fix must satisfy ${truthSet.id} in ${truthSet.sourcePath} only.`,
      );
    }
    if (!matchesExactResult(input.result, { summary: input.result?.summary })
      || typeof input.result.summary !== "string"
      || !input.result.summary.trim()
      || input.result.summary.length > 1000) {
      modelFailures.push("Preact UI result must contain exactly one non-empty summary.");
    }
  } else {
    patchAccepted = null;
    if (changedPaths.length > 0) {
      productWorkflowFailures.push(`Read-only Preact dependency diagnosis changed ${changedPaths.length} workspace path(s).`);
    }
    if (!matchesExactResult(input.result, PREACT_DIAGNOSIS)) {
      modelFailures.push("Preact diagnosis did not identify the frozen dependency export mismatch.");
    }
  }

  return createMachineEvaluation(productWorkflowFailures, modelFailures, testsPassed, patchAccepted);
}

async function generateVscodeLanguageServerFixture(input, dependencies = {}) {
  const task = input?.task;
  if (!task || !["real-ts.cross-package-refactor", "real-ts.api-migration"].includes(task.id)
    || task.repositoryId !== "vscode-languageserver-node") {
    throw new Error(`Benchmark v3 vscode-languageserver-node fixture does not support task ${String(task?.id)}.`);
  }
  const { workspace } = await prepareRepositoryWorkspace(input, "vscode-languageserver-node");
  await (dependencies.setupTypeScriptWorkspace ?? setupVscodeLanguageServerWorkspace)(workspace);
  const overlay = task.id === "real-ts.cross-package-refactor"
    ? await applyTypeScriptCrossPackageRefactorOverlay(workspace)
    : await applyTypeScriptApiMigrationOverlay(workspace);
  await initializeRepositoryFixture(workspace);
  return createRepositoryFixtureResult(input, task, workspace, overlay);
}

async function evaluateVscodeLanguageServerFixture(input, dependencies = {}) {
  const task = input?.task;
  if (!task || !["real-ts.cross-package-refactor", "real-ts.api-migration"].includes(task.id)) {
    throw new Error(`Benchmark v3 vscode-languageserver-node evaluator does not support task ${String(task?.id)}.`);
  }
  const workspace = path.resolve(requireNonEmptyString(input.workspace, "workspace"));
  const productWorkflowFailures = [];
  const modelFailures = [];
  if (input.runnerExitCode !== 0) {
    productWorkflowFailures.push(`Coding benchmark runner exited with ${String(input.runnerExitCode)}.`);
  }
  const testResults = await (dependencies.runTestCommands ?? runTypeScriptTestCommands)(
    workspace,
    task.acceptance.testCommands,
  );
  const testsPassed = validateFrozenTestResults(task.acceptance.testCommands, testResults);
  if (!testsPassed) {
    productWorkflowFailures.push("vscode-languageserver-node frozen verifier did not pass.");
  }

  const changedPaths = collectChangedPaths(workspace);
  let patchAccepted;
  if (task.id === "real-ts.cross-package-refactor") {
    const source = await fs.readFile(
      path.join(workspace, "protocol", "src", "common", "protocol.workspaceFolder.ts"),
      "utf-8",
    );
    patchAccepted = JSON.stringify(changedPaths) === JSON.stringify(task.acceptance.requiredChangedPaths)
      && source.includes(WORKSPACE_FOLDER_RESULT_CONTRACT)
      && !source.includes(BROKEN_WORKSPACE_FOLDER_RESULT_CONTRACT);
    if (!patchAccepted) {
      productWorkflowFailures.push(
        "TypeScript refactor must restore the workspace-folder request result contract in one protocol source file.",
      );
    }
  } else {
    const [connectionSource, apiSource, protocolSource] = await Promise.all([
      fs.readFile(path.join(workspace, "jsonrpc", "src", "common", "connection.ts"), "utf-8"),
      fs.readFile(path.join(workspace, "jsonrpc", "src", "common", "api.ts"), "utf-8"),
      fs.readFile(path.join(workspace, "protocol", "src", "common", "protocol.ts"), "utf-8"),
    ]);
    patchAccepted = JSON.stringify(changedPaths) === JSON.stringify(task.acceptance.requiredChangedPaths)
      && connectionSource.includes("export namespace TraceValue")
      && connectionSource.includes("export type TraceValue =")
      && !/\bTraceValues\b/.test(connectionSource)
      && apiSource.includes("TraceValue")
      && !/\bTraceValues\b/.test(apiSource)
      && protocolSource.includes("RequestHandler, TraceValue } from 'vscode-jsonrpc'")
      && protocolSource.includes("trace?: TraceValue;")
      && !/\bTraceValues\b/.test(protocolSource);
    if (!patchAccepted) {
      productWorkflowFailures.push(
        "TypeScript API migration must remove TraceValues from jsonrpc and migrate the protocol consumer to TraceValue.",
      );
    }
  }
  if (!matchesExactResult(input.result, { summary: input.result?.summary })
    || typeof input.result.summary !== "string"
    || !input.result.summary.trim()
    || input.result.summary.length > 1000) {
    modelFailures.push("TypeScript task result must contain exactly one non-empty summary.");
  }
  return createMachineEvaluation(productWorkflowFailures, modelFailures, testsPassed, patchAccepted);
}

async function generateCobraFixture(input) {
  const task = input?.task;
  if (!task || !["real-go.bug-fix", "real-go.public-api-migration"].includes(task.id)
    || task.repositoryId !== "spf13-cobra") {
    throw new Error(`Benchmark v3 spf13-cobra fixture does not support task ${String(task?.id)}.`);
  }
  const { workspace, executionEnvironment } = await prepareRepositoryWorkspace(
    input,
    "spf13-cobra",
    "go",
  );
  const overlay = task.id === "real-go.bug-fix"
    ? await applyCobraBugFixOverlay(workspace)
    : await applyCobraApiMigrationOverlay(workspace);
  await initializeRepositoryFixture(workspace, ["/.coding-benchmark/"]);
  return createRepositoryFixtureResult(input, task, workspace, overlay, executionEnvironment);
}

async function evaluateCobraFixture(input, dependencies = {}) {
  const task = input?.task;
  if (!task || !["real-go.bug-fix", "real-go.public-api-migration"].includes(task.id)) {
    throw new Error(`Benchmark v3 spf13-cobra evaluator does not support task ${String(task?.id)}.`);
  }
  const workspace = path.resolve(requireNonEmptyString(input.workspace, "workspace"));
  const productWorkflowFailures = [];
  const modelFailures = [];
  if (input.runnerExitCode !== 0) {
    productWorkflowFailures.push(`Coding benchmark runner exited with ${String(input.runnerExitCode)}.`);
  }
  const testResults = await (dependencies.runTestCommands ?? runGoTestCommands)(
    workspace,
    task.acceptance.testCommands,
  );
  const testsPassed = validateFrozenTestResults(task.acceptance.testCommands, testResults);
  if (!testsPassed) {
    productWorkflowFailures.push("spf13-cobra frozen Go test command did not pass offline.");
  }

  const changedPaths = collectChangedPaths(workspace);
  let patchAccepted;
  if (task.id === "real-go.bug-fix") {
    const commandSource = await fs.readFile(path.join(workspace, "command.go"), "utf-8");
    patchAccepted = JSON.stringify(changedPaths) === JSON.stringify(task.acceptance.requiredChangedPaths)
      && commandSource.includes('strings.Index(name, " ")')
      && !commandSource.includes('strings.LastIndex(name, " ")');
    if (!patchAccepted) {
      productWorkflowFailures.push("Go bug fix must restore first-token Command.Name behavior in command.go only.");
    }
  } else {
    const sources = await Promise.all(GO_MIGRATION_PATHS.map(async (relativePath) => [
      relativePath,
      await fs.readFile(path.join(workspace, ...relativePath.split("/")), "utf-8"),
    ]));
    const cobraSource = sources.find(([relativePath]) => relativePath === "cobra.go")?.[1] ?? "";
    patchAccepted = JSON.stringify(changedPaths) === JSON.stringify(task.acceptance.requiredChangedPaths)
      && cobraSource.includes("func WriteString(b io.StringWriter, s string)")
      && sources.every(([, source]) => !/\bWriteStringAndCheck\b/.test(source));
    if (!patchAccepted) {
      productWorkflowFailures.push(
        "Go API migration must remove WriteStringAndCheck and migrate the frozen public callers to WriteString.",
      );
    }
  }
  if (!matchesExactResult(input.result, { summary: input.result?.summary })
    || typeof input.result.summary !== "string"
    || !input.result.summary.trim()
    || input.result.summary.length > 1000) {
    modelFailures.push("Go task result must contain exactly one non-empty summary.");
  }
  return createMachineEvaluation(productWorkflowFailures, modelFailures, testsPassed, patchAccepted);
}

async function applyPreactUiRegressionOverlay(workspace, truthSet) {
  const propsPath = path.join(workspace, ...truthSet.sourcePath.split("/"));
  const propsSource = await fs.readFile(propsPath, "utf-8");
  const contract = truthSet.baselineSourceContract;
  if (propsSource.split(contract).length !== 2) {
    throw new Error("Benchmark v3 Preact source does not contain one frozen aria false-value contract.");
  }
  await fs.writeFile(
    propsPath,
    propsSource.replace(contract, truthSet.brokenSourceContract),
    "utf-8",
  );
  const testPath = path.join(workspace, ...truthSet.visibleTestPath.split("/"));
  await fs.mkdir(path.dirname(testPath), { recursive: true });
  await fs.writeFile(testPath, renderCodingAgentBenchmarkWebUiVisibleTest(truthSet), "utf-8");
  await fs.writeFile(
    path.join(workspace, "vitest.benchmark-v3.config.mjs"),
    createPreactVitestConfig(),
    "utf-8",
  );
  return {
    promptSuffix: renderCodingAgentBenchmarkWebUiPromptSuffix(truthSet),
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string", minLength: 1, maxLength: 1000 } },
    },
  };
}

async function applyPreactDependencyDiagnosisOverlay(workspace) {
  const probePath = path.join(workspace, ...PREACT_DIAGNOSIS.probePath.split("/"));
  await fs.mkdir(path.dirname(probePath), { recursive: true });
  await fs.writeFile(
    probePath,
    "import 'preact-render-to-string/stream/node';\n",
    "utf-8",
  );
  return {
    promptSuffix: [
      `The deterministic failure is ${PREACT_DIAGNOSIS.probePath}.`,
      "Do not modify the workspace, install/restore packages, or use the network.",
      "Return exactly one JSON object matching the supplied rootCause, dependency, manifestPath, and probePath schema.",
    ].join(" "),
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["rootCause", "dependency", "manifestPath", "probePath"],
      properties: {
        rootCause: { const: PREACT_DIAGNOSIS.rootCause },
        dependency: { const: PREACT_DIAGNOSIS.dependency },
        manifestPath: { const: PREACT_DIAGNOSIS.manifestPath },
        probePath: { const: PREACT_DIAGNOSIS.probePath },
      },
    },
  };
}

function createPreactVitestConfig() {
  return [
    "import baseConfig from './vitest.config.mjs';",
    "",
    "export default {",
    "\t...baseConfig,",
    "\ttest: {",
    "\t\t...baseConfig.test,",
    "\t\tprojects: [baseConfig.test.projects[0]]",
    "\t}",
    "};",
    "",
  ].join("\n");
}

async function applyTypeScriptCrossPackageRefactorOverlay(workspace) {
  const sourcePath = path.join(
    workspace,
    "protocol",
    "src",
    "common",
    "protocol.workspaceFolder.ts",
  );
  const source = await fs.readFile(sourcePath, "utf-8");
  if (source.split(WORKSPACE_FOLDER_RESULT_CONTRACT).length !== 2) {
    throw new Error(
      "Benchmark v3 TypeScript source does not contain one frozen workspace-folder request result contract.",
    );
  }
  await fs.writeFile(
    sourcePath,
    source.replace(WORKSPACE_FOLDER_RESULT_CONTRACT, BROKEN_WORKSPACE_FOLDER_RESULT_CONTRACT),
    "utf-8",
  );
  await writeTypeScriptVerifier(workspace, "cross-package-refactor");
  return {
    promptSuffix: [
      "The frozen failure is verified by test/benchmark-v3/real-ts-cross-package-refactor.mjs.",
      "Restore the nullable WorkspaceFoldersRequest result contract without allowing undefined.",
      "Change only protocol/src/common/protocol.workspaceFolder.ts and do not modify tests or dependency metadata.",
      "Return exactly one JSON object with a non-empty summary.",
    ].join(" "),
    outputSchema: summaryOutputSchema(),
  };
}

async function applyTypeScriptApiMigrationOverlay(workspace) {
  const protocolPath = path.join(workspace, "protocol", "src", "common", "protocol.ts");
  const source = await fs.readFile(protocolPath, "utf-8");
  const importContract = "RequestHandler, TraceValue } from 'vscode-jsonrpc'";
  const fieldContract = "trace?: TraceValue;";
  if (source.split(importContract).length !== 2 || source.split(fieldContract).length !== 2) {
    throw new Error("Benchmark v3 TypeScript source does not contain the frozen TraceValue consumer contract.");
  }
  await fs.writeFile(
    protocolPath,
    source
      .replace(importContract, "RequestHandler, TraceValues } from 'vscode-jsonrpc'")
      .replace(fieldContract, "trace?: TraceValues;"),
    "utf-8",
  );
  await writeTypeScriptVerifier(workspace, "api-migration");
  return {
    promptSuffix: [
      "The frozen migration check is test/benchmark-v3/real-ts-api-migration.mjs.",
      "Remove the deprecated public TraceValues value/type aliases from jsonrpc, remove both barrel exports, and migrate protocol back to TraceValue.",
      "Change exactly jsonrpc/src/common/connection.ts, jsonrpc/src/common/api.ts, and protocol/src/common/protocol.ts.",
      "Do not modify tests or dependency metadata, and return exactly one JSON object with a non-empty summary.",
    ].join(" "),
    outputSchema: summaryOutputSchema(),
  };
}

async function writeTypeScriptVerifier(workspace, kind) {
  const fileName = kind === "cross-package-refactor"
    ? "real-ts-cross-package-refactor.mjs"
    : "real-ts-api-migration.mjs";
  const verifierPath = path.join(workspace, "test", "benchmark-v3", fileName);
  await fs.mkdir(path.dirname(verifierPath), { recursive: true });
  await fs.writeFile(verifierPath, createTypeScriptVerifier(kind), "utf-8");
}

function createTypeScriptVerifier(kind) {
  const projects = kind === "cross-package-refactor"
    ? [
      "types/src/tsconfig.json",
      "jsonrpc/src/common/tsconfig.json",
      "protocol/src/common/tsconfig.json",
      "server/src/common/tsconfig.json",
    ]
    : [
      "types/src/tsconfig.json",
      "jsonrpc/src/common/tsconfig.json",
      "protocol/src/common/tsconfig.json",
    ];
  const migrationCheck = kind === "api-migration"
    ? [
      "const connectionSource = await fs.readFile(path.join(root, 'jsonrpc', 'src', 'common', 'connection.ts'), 'utf-8');",
      "const apiSource = await fs.readFile(path.join(root, 'jsonrpc', 'src', 'common', 'api.ts'), 'utf-8');",
      "const protocolSource = await fs.readFile(path.join(root, 'protocol', 'src', 'common', 'protocol.ts'), 'utf-8');",
      "if (/\\bTraceValues\\b/.test(connectionSource) || /\\bTraceValues\\b/.test(apiSource) || /\\bTraceValues\\b/.test(protocolSource)) {",
      "\tconsole.error('Deprecated TraceValues API migration is incomplete.');",
      "\tprocess.exit(1);",
      "}",
      "",
    ]
    : [];
  return [
    "import { spawnSync } from 'node:child_process';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "",
    "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');",
    ...migrationCheck,
    "const tscPath = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');",
    `const result = spawnSync(process.execPath, [tscPath, '-b', ${projects.map((item) => `'${item}'`).join(", ")}, '--force'], {`,
    "\tcwd: root,",
    "\tencoding: 'utf-8',",
    "\twindowsHide: true,",
    "\ttimeout: 120000,",
    "\tstdio: ['ignore', 'pipe', 'pipe']",
    "});",
    "process.stdout.write(String(result.stdout ?? ''));",
    "process.stderr.write(String(result.stderr ?? result.error?.message ?? ''));",
    "process.exit(result.status ?? 1);",
    "",
  ].join("\n");
}

function summaryOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: { summary: { type: "string", minLength: 1, maxLength: 1000 } },
  };
}

async function setupVscodeLanguageServerWorkspace(workspace) {
  const result = spawnSync(process.execPath, [path.join("build", "bin", "symlink.js")], {
    cwd: workspace,
    encoding: "utf-8",
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Benchmark v3 vscode-languageserver-node workspace setup failed: ${String(result.stderr ?? result.error?.message ?? "unknown error").trim()}`,
    );
  }
}

async function applyCobraBugFixOverlay(workspace) {
  const commandPath = path.join(workspace, "command.go");
  const commandSource = await fs.readFile(commandPath, "utf-8");
  const nameContract = 'strings.Index(name, " ")';
  if (commandSource.split(nameContract).length !== 2) {
    throw new Error("Benchmark v3 spf13-cobra source does not contain one frozen Command.Name contract.");
  }
  await fs.writeFile(
    commandPath,
    commandSource.replace(nameContract, 'strings.LastIndex(name, " ")'),
    "utf-8",
  );
  await fs.writeFile(
    path.join(workspace, "benchmark_v3_bug_fix_test.go"),
    createCobraBugFixTest(),
    "utf-8",
  );
  return {
    promptSuffix: [
      "The frozen regression is covered by benchmark_v3_bug_fix_test.go.",
      "Restore Command.Name so a multi-argument Use line returns only its first token.",
      "Change only command.go and do not modify tests, module metadata, or dependency caches.",
      "Run the frozen test with network and toolchain downloads disabled, then return exactly one JSON object with a non-empty summary.",
    ].join(" "),
    outputSchema: summaryOutputSchema(),
  };
}

async function applyCobraApiMigrationOverlay(workspace) {
  const cobraPath = path.join(workspace, "cobra.go");
  const cobraSource = await fs.readFile(cobraPath, "utf-8");
  const legacyContract = [
    "// WriteStringAndCheck writes a string into a buffer, and checks if the error is not nil.",
    "func WriteStringAndCheck(b io.StringWriter, s string) {",
    "\t_, err := b.WriteString(s)",
    "\tCheckErr(err)",
    "}",
  ].join("\n");
  if (normalizeTextLineEndings(cobraSource).toString("utf-8").split(legacyContract).length !== 2) {
    throw new Error("Benchmark v3 spf13-cobra source does not contain one frozen WriteStringAndCheck contract.");
  }
  const migrationContract = [
    "// WriteString writes a string into a buffer, and checks if the error is not nil.",
    "func WriteString(b io.StringWriter, s string) {",
    "\t_, err := b.WriteString(s)",
    "\tCheckErr(err)",
    "}",
    "",
    "// WriteStringAndCheck writes a string into a buffer, and checks if the error is not nil.",
    "//",
    "// Deprecated: use WriteString.",
    "func WriteStringAndCheck(b io.StringWriter, s string) {",
    "\tWriteString(b, s)",
    "}",
  ].join("\n");
  const normalizedSource = normalizeTextLineEndings(cobraSource).toString("utf-8");
  await fs.writeFile(cobraPath, normalizedSource.replace(legacyContract, migrationContract), "utf-8");
  await fs.writeFile(
    path.join(workspace, "benchmark_v3_api_migration_test.go"),
    createCobraApiMigrationTest(),
    "utf-8",
  );
  return {
    promptSuffix: [
      "The frozen migration gate is benchmark_v3_api_migration_test.go.",
      "Remove the deprecated WriteStringAndCheck alias and migrate every frozen caller to WriteString.",
      `Change exactly ${GO_MIGRATION_PATHS.join(", ")}.`,
      "Do not modify tests or module metadata, and return exactly one JSON object with a non-empty summary.",
    ].join(" "),
    outputSchema: summaryOutputSchema(),
  };
}

function createCobraBugFixTest() {
  return [
    "package cobra",
    "",
    "import \"testing\"",
    "",
    "func TestBenchmarkV3CommandNameUsesFirstToken(t *testing.T) {",
    "\tcommand := &Command{Use: \"serve SOURCE TARGET\"}",
    "\tif got := command.Name(); got != \"serve\" {",
    "\t\tt.Fatalf(\"Command.Name() = %q, want %q\", got, \"serve\")",
    "\t}",
    "}",
    "",
  ].join("\n");
}

function createCobraApiMigrationTest() {
  return [
    "package cobra",
    "",
    "import (",
    "\t\"bytes\"",
    "\t\"os\"",
    "\t\"strings\"",
    "\t\"testing\"",
    ")",
    "",
    "func TestBenchmarkV3WriteStringMigration(t *testing.T) {",
    "\tvar output strings.Builder",
    "\tWriteString(&output, \"fixture\")",
    "\tif output.String() != \"fixture\" { t.Fatalf(\"WriteString output = %q\", output.String()) }",
    `\tpaths := []string{${GO_MIGRATION_PATHS.map((relativePath) => `\"${relativePath}\"`).join(", ")}}`,
    "\tfor _, relativePath := range paths {",
    "\t\tsource, err := os.ReadFile(relativePath)",
    "\t\tif err != nil { t.Fatal(err) }",
    "\t\tif bytes.Contains(source, []byte(\"WriteStringAndCheck\")) {",
    "\t\t\tt.Fatalf(\"WriteStringAndCheck API migration is incomplete in %s\", relativePath)",
    "\t\t}",
    "\t}",
    "}",
    "",
  ].join("\n");
}

async function applyExpressBugFixOverlay(workspace) {
  const requestPath = path.join(workspace, "lib", "request.js");
  const requestSource = await fs.readFile(requestPath, "utf-8");
  const offsetReturn = /return ([A-Za-z_$][\w$]*)\.slice\(offset\);/g;
  const matches = [...requestSource.matchAll(offsetReturn)];
  if (matches.length !== 1) {
    throw new Error("Benchmark v3 Express source does not contain one frozen subdomain offset return.");
  }
  await fs.writeFile(
    requestPath,
    requestSource.replace(offsetReturn, "return $1.slice(offset + 1);"),
    "utf-8",
  );
  const testPath = path.join(workspace, "test", "benchmark-v3", "real-js-bug-fix.js");
  await fs.mkdir(path.dirname(testPath), { recursive: true });
  await fs.writeFile(testPath, createExpressSubdomainTest({ failingExpectation: false }), "utf-8");
  return {
    promptSuffix: [
      "The frozen regression is covered by test/benchmark-v3/real-js-bug-fix.js.",
      "Restore the documented req.subdomains offset behavior with the smallest change in lib/request.js.",
      "Do not modify tests, dependencies, package metadata, or any other source file.",
      "Return exactly one JSON object with a non-empty summary.",
    ].join(" "),
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string", minLength: 1, maxLength: 1000 } },
    },
  };
}

async function applyExpressDiagnosisOverlay(workspace) {
  const testPath = path.join(workspace, "test", "benchmark-v3", "real-js-failed-test.js");
  await fs.mkdir(path.dirname(testPath), { recursive: true });
  await fs.writeFile(testPath, createExpressSubdomainTest({ failingExpectation: true }), "utf-8");
  return {
    promptSuffix: [
      "The deterministic failure is test/benchmark-v3/real-js-failed-test.js.",
      "Do not modify the workspace or restore/install dependencies.",
      "Return exactly one JSON object matching the supplied rootCause, sourcePath, and testPath schema.",
    ].join(" "),
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["rootCause", "sourcePath", "testPath"],
      properties: {
        rootCause: { const: EXPRESS_DIAGNOSIS.rootCause },
        sourcePath: { const: EXPRESS_DIAGNOSIS.sourcePath },
        testPath: { const: EXPRESS_DIAGNOSIS.testPath },
      },
    },
  };
}

function createExpressSubdomainTest(input) {
  const expected = input.failingExpectation
    ? "['example', 'service', 'api']"
    : "['service', 'api']";
  return [
    "'use strict'",
    "",
    "var express = require('../..')",
    "var request = require('supertest')",
    "",
    "describe('benchmark v3 req.subdomains contract', function () {",
    "  it('applies the configured offset after reversing host labels', function (done) {",
    "    var app = express()",
    "    app.use(function (req, res) { res.json(req.subdomains) })",
    "    request(app)",
    "      .get('/')",
    "      .set('Host', 'api.service.example.com')",
    `      .expect(200, ${expected}, done)`,
    "  })",
    "})",
    "",
    ...(input.failingExpectation ? [] : [renderExpressSubdomainBoundaryTests()]),
  ].join("\n");
}

async function initializeRepositoryFixture(workspace, additionalExcludes = []) {
  runGit(workspace, ["init", "--quiet"]);
  runGit(workspace, ["config", "user.email", "benchmark@star-sanctuary.invalid"]);
  runGit(workspace, ["config", "user.name", "Star Sanctuary Benchmark"]);
  await fs.appendFile(
    path.join(workspace, ".git", "info", "exclude"),
    `\n/node_modules/\n${additionalExcludes.join("\n")}${additionalExcludes.length > 0 ? "\n" : ""}`,
    "utf-8",
  );
  runGit(workspace, ["add", "-A"]);
  runGit(workspace, ["commit", "--quiet", "-m", "benchmark fixture baseline"], {
    env: {
      GIT_AUTHOR_DATE: FIXTURE_COMMIT_DATE,
      GIT_COMMITTER_DATE: FIXTURE_COMMIT_DATE,
    },
  });
}

async function runExpressTestCommands(workspace, commands) {
  return commands.map((entry) => {
    const command = entry?.command;
    const prefix = "npm test -- ";
    const overlayPath = typeof command === "string" && command.startsWith(prefix)
      ? command.slice(prefix.length)
      : null;
    if (![
      "test/benchmark-v3/real-js-bug-fix.js",
      "test/benchmark-v3/real-js-failed-test.js",
    ].includes(overlayPath)) {
      return { command: entry?.command, exitCode: null, error: "unsupported_command" };
    }
    const invocation = resolveNpmTestInvocation();
    const testArgs = process.platform === "win32"
      ? [...invocation.args, `npm test -- ${overlayPath}`]
      : [...invocation.args, "test", "--", overlayPath];
    const result = spawnSync(invocation.command, testArgs, {
      cwd: workspace,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_offline: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command,
      exitCode: result.status,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? result.error?.message ?? ""),
    };
  });
}

function resolveNpmTestInvocation() {
  if (process.platform !== "win32") return { command: "npm", args: [] };
  return {
    command: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c"],
  };
}

async function runPreactTestCommands(workspace, commands) {
  return commands.map((entry) => {
    const command = entry?.command;
    let executable;
    let args;
    if (command === PREACT_UI_TEST_COMMAND) {
      if (process.platform === "win32") {
        const invocation = resolveNpmTestInvocation();
        executable = invocation.command;
        args = [...invocation.args, PREACT_UI_TEST_COMMAND];
      } else {
        executable = "npm";
        args = [
          "exec",
          "--offline",
          "--",
          "vitest",
          "run",
          "--config",
          "vitest.benchmark-v3.config.mjs",
          "test/shared/benchmark-v3-ui-regression.test.js",
        ];
      }
    } else if (command === PREACT_DIAGNOSIS_TEST_COMMAND) {
      executable = process.execPath;
      args = [PREACT_DIAGNOSIS.probePath];
    } else {
      return { command, exitCode: null, error: "unsupported_command" };
    }
    const result = spawnSync(executable, args, {
      cwd: workspace,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_offline: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command,
      exitCode: result.status,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? result.error?.message ?? ""),
    };
  });
}

async function runTypeScriptTestCommands(workspace, commands) {
  return commands.map((entry) => {
    const command = entry?.command;
    const relativeScript = command === TYPESCRIPT_REFACTOR_TEST_COMMAND
      ? "test/benchmark-v3/real-ts-cross-package-refactor.mjs"
      : command === TYPESCRIPT_MIGRATION_TEST_COMMAND
        ? "test/benchmark-v3/real-ts-api-migration.mjs"
        : null;
    if (!relativeScript) {
      return { command, exitCode: null, error: "unsupported_command" };
    }
    const result = spawnSync(process.execPath, [relativeScript], {
      cwd: workspace,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_offline: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command,
      exitCode: result.status,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? result.error?.message ?? ""),
    };
  });
}

async function runGoTestCommands(workspace, commands) {
  return commands.map((entry) => {
    const command = entry?.command;
    const args = command === GO_BUG_FIX_TEST_COMMAND
      ? ["test", "-mod=readonly", "."]
      : command === GO_API_MIGRATION_TEST_COMMAND
        ? ["test", "-mod=readonly", "-p=1", "./..."]
        : null;
    if (!args) return { command, exitCode: null, error: "unsupported_command" };
    const result = spawnSync("go", args, {
      cwd: workspace,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        ...createGoExecutionEnvironment(workspace),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command,
      exitCode: result.status,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? result.error?.message ?? ""),
    };
  });
}

function createGoExecutionEnvironment(workspace) {
  const privateCacheRoot = path.join(workspace, ".coding-benchmark");
  return {
    GOMODCACHE: path.join(privateCacheRoot, "gomodcache"),
    GOCACHE: path.join(privateCacheRoot, "gocache"),
    GOTMPDIR: path.join(privateCacheRoot, "gotmp"),
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    GOENV: "off",
    GOWORK: "off",
  };
}

function validatePreactDependencyFailureSignature(results) {
  if (!Array.isArray(results)) return false;
  const matches = results.filter((result) => result?.command === PREACT_DIAGNOSIS_TEST_COMMAND);
  if (matches.length !== 1) return false;
  const stderr = String(matches[0].stderr ?? "");
  return stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED")
    && stderr.includes("preact-render-to-string")
    && stderr.includes("stream/node");
}

function matchesExactResult(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function createMachineEvaluation(productWorkflowFailures, modelFailures, testsPassed, patchAccepted) {
  const diagnostics = [...productWorkflowFailures, ...modelFailures];
  const taskCompleted = diagnostics.length === 0;
  return {
    status: taskCompleted ? "passed" : "failed",
    failureCategory: taskCompleted
      ? null
      : productWorkflowFailures.length > 0 ? "product_workflow" : "model",
    evaluation: {
      source: "machine",
      taskCompleted,
      testsPassed,
      patchAccepted,
      regressionCount: testsPassed ? 0 : 1,
      manualInterventionCount: 0,
      dangerousOperationBlocked: null,
      recoverySucceeded: null,
    },
    diagnostics,
  };
}

function validateFrozenTestResults(commands, results) {
  return Array.isArray(results)
    && results.length === commands.length
    && commands.every((entry) => {
      const matches = results.filter((result) => result?.command === entry.command);
      return matches.length === 1 && matches[0].exitCode === entry.expectedExitCode;
    });
}

function collectChangedPaths(workspace) {
  const tracked = runGit(workspace, ["diff", "--name-only", "--no-ext-diff", "HEAD", "--"])
    .split(/\r?\n/)
    .filter(Boolean);
  const untracked = runGit(workspace, ["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])]
    .map((relativePath) => relativePath.replaceAll("\\", "/"))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

async function assertPathAbsent(target, label) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} must not already exist.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relativeLeftToRight = path.relative(left, right);
  const relativeRightToLeft = path.relative(right, left);
  const overlaps = !relativeLeftToRight
    || (!relativeLeftToRight.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeLeftToRight))
    || (!relativeRightToLeft.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeRightToLeft));
  if (overlaps) throw new Error(`Benchmark v3 ${leftLabel} and ${rightLabel} must be separate roots.`);
}

function projectV3ManifestToCorrectedV2(manifest) {
  assertV3Manifest(manifest);
  return { ...manifest, schemaVersion: CORRECTED_V2_MANIFEST_VERSION };
}

function assertV3Manifest(manifest) {
  if (manifest?.schemaVersion !== CODING_AGENT_BENCHMARK_MANIFEST_V3_VERSION) {
    throw new Error("Benchmark v3 fixture providers require a v3 task manifest.");
  }
  validateCodingAgentBenchmarkManifest(manifest);
}

function evaluateSourceIdentity(expected, actual) {
  if (!actual) return failedCheck("repository_snapshot_unavailable");
  if (actual.workspaceDirty !== false) return failedCheck("repository_worktree_dirty");
  if (actual.sourceUrl !== expected.url) return failedCheck("repository_source_url_mismatch");
  if (actual.commit !== expected.commit) return failedCheck("repository_commit_mismatch");
  if (actual.worktreeContentSha256 !== expected.worktreeContentSha256) {
    return failedCheck("repository_content_mismatch");
  }
  if (actual.dependencyInputsSha256 !== expected.dependencyInputsSha256) {
    return failedCheck("dependency_inputs_mismatch");
  }
  return passedCheck();
}

function evaluateLicenseIdentity(expected, actual) {
  if (!actual) return failedCheck("repository_snapshot_unavailable");
  if (actual.licensePath !== expected.path) return failedCheck("license_path_mismatch");
  if (actual.licenseSha256 !== expected.sha256) return failedCheck("license_content_mismatch");
  return passedCheck();
}

function evaluateDependencyCacheIdentity(expected, actual) {
  if (!actual) return failedCheck("dependency_cache_unavailable");
  if (actual.cacheKey !== expected.cacheKey || actual.contentSha256 !== expected.contentSha256) {
    return failedCheck("dependency_cache_mismatch");
  }
  return passedCheck();
}

function createSnapshotPreflightResult(input, task, checks) {
  return {
    schemaVersion: SNAPSHOT_PREFLIGHT_VERSION,
    taskId: input?.taskId ?? null,
    repositoryId: task?.repositoryId ?? input?.receipt?.repositoryId ?? null,
    status: Object.values(checks).some((check) => check.status === "failed") ? "failed" : "passed",
    checks,
  };
}

function passedCheck() {
  return { status: "passed", reason: null };
}

function failedCheck(reason) {
  return { status: "failed", reason };
}

function notRunCheck(reason) {
  return { status: "not_run", reason };
}

export async function inspectCodingAgentBenchmarkV3RepositorySnapshotIdentity(input) {
  const root = path.resolve(requireNonEmptyString(input?.repositoryRoot, "repositoryRoot"));
  const repository = input?.repository;
  const commit = runGit(root, ["rev-parse", "HEAD"]).trim();
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  const sourceUrl = runGit(root, ["config", "--get", "remote.origin.url"]).trim();
  const indexIdentity = runGit(root, ["ls-files", "-s", "-z"]);
  const treeIdentity = runGit(root, ["rev-parse", "HEAD^{tree}"]).trim();
  const dependencyInputs = await hashDependencyInputs(root);
  const licensePath = requireNonEmptyString(repository?.license?.path, "repository.license.path");
  const license = await fs.readFile(resolveContainedPath(root, licensePath));
  return {
    sourceUrl,
    commit,
    workspaceDirty: status.length > 0,
    worktreeContentSha256: sha256(Buffer.concat([
      Buffer.from("coding-agent-benchmark-repository-snapshot/v1\0", "utf-8"),
      Buffer.from(treeIdentity, "utf-8"),
      Buffer.from("\0", "utf-8"),
      Buffer.from(indexIdentity, "utf-8"),
    ])),
    dependencyInputsSha256: dependencyInputs,
    licensePath,
    licenseSha256: sha256(license),
  };
}

async function resolveDependencyCacheIdentity(input) {
  const root = path.resolve(requireNonEmptyString(input?.dependencyCacheRoot, "dependencyCacheRoot"));
  const cacheKey = String(await fs.readFile(path.join(root, ".coding-benchmark-cache-key"), "utf-8")).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(cacheKey)) {
    throw new Error("Benchmark v3 dependency cache key is invalid.");
  }
  return { cacheKey, contentSha256: await hashDirectory(root) };
}

async function hashDependencyInputs(root) {
  const hash = crypto.createHash("sha256");
  hash.update("coding-agent-benchmark-dependency-inputs/v1\0");
  let count = 0;
  for (const relativePath of DEPENDENCY_INPUT_PATHS) {
    let content;
    try {
      content = await fs.readFile(path.join(root, relativePath));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    count += 1;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(relativePath.endsWith(".lockb") ? content : normalizeTextLineEndings(content));
    hash.update("\0");
  }
  if (count === 0) throw new Error("Benchmark v3 repository has no pinned dependency input.");
  return hash.digest("hex");
}

async function hashDirectory(root) {
  const hash = crypto.createHash("sha256");
  hash.update("coding-agent-benchmark-dependency-cache/v1\0");
  const pending = [""];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const portablePath = relativePath.replaceAll("\\", "/");
      const absolutePath = resolveContainedPath(root, relativePath);
      if (entry.isDirectory()) {
        hash.update(`${portablePath}\0directory\0`);
        pending.push(relativePath);
      } else if (entry.isFile()) {
        hash.update(`${portablePath}\0file\0`);
        for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`${portablePath}\0symlink\0${await fs.readlink(absolutePath)}\0`);
      } else {
        throw new Error(`Benchmark v3 dependency cache contains unsupported entry ${portablePath}.`);
      }
    }
  }
  return hash.digest("hex");
}

function runGit(cwd, args, input = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(input.env ?? {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr ?? `git ${args[0]} failed.`).trim());
  }
  return String(result.stdout ?? "");
}

function resolveContainedPath(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Benchmark v3 snapshot path escapes its root: ${relativePath}.`);
  }
  return target;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Benchmark v3 ${label} must be an object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpected)) {
    throw new Error(`Benchmark v3 ${label} fields are invalid.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Benchmark v3 ${label} SHA-256 is invalid.`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Benchmark v3 ${label} is required.`);
  }
  return value.trim();
}

function normalizeTextLineEndings(value) {
  return Buffer.from(String(value).replaceAll("\r\n", "\n"), "utf-8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
