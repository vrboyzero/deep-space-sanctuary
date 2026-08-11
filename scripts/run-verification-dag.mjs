import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadVerificationBrowserArtifacts } from "./verification-browser-artifact-loader.mjs";
import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";
import { projectStructuredTestReport } from "./verification-test-report-adapter.mjs";
import { normalizeVerificationImpactEvidence } from "./verification-impact-evidence.mjs";

export const VERIFICATION_DAG_SCHEMA_VERSION = "verification-dag/v1";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_KINDS = new Set(["acceptance", "build", "typecheck", "lint", "browser", "manual"]);
const NODE_SCOPES = new Set(["targeted", "module", "full", "browser"]);
const NODE_STATUSES = new Set(["planned", "passed", "failed", "skipped", "timed_out", "cancelled", "not_run"]);
const FAILURE_KINDS = new Set(["test", "build", "typecheck", "lint", "browser", "manual", "infrastructure"]);
const COMMAND_JOB_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "lost"]);
const COMMAND_JOB_TERMINATION_REASONS = new Set(["cancelled", "timed_out"]);
const COMMAND_JOB_EXIT_TAXONOMY = new Set([
  "zero_exit",
  "non_zero_exit",
  "signal",
  "runtime_error",
  "timed_out",
  "cancelled",
  "cancellation_failed",
  "owner_lost",
]);
const COMMAND_JOB_RECOVERY_LIFECYCLES = new Set(["settled", "lost"]);
const COMMAND_JOB_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FAILURE_REPLAY_STATUSES = new Set(["passed", "failed", "skipped", "timed_out", "cancelled", "not_run"]);
const FAILURE_REPLAY_MAX_ATTEMPTS = 3;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENSITIVE_COMMAND_PATTERN = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowedKeys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function normalizeId(value, label) {
  assert(
    typeof value === "string"
      && value.length <= 160
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value),
    `${label} must be a safe id.`,
  );
  return value;
}

function normalizeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a safe relative path.`);
  assert(!value.includes("\\") && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), `${label} must be a safe relative path.`);
  const segments = value.split("/");
  assert(segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."), `${label} must be a safe relative path.`);
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeOptionalSafeInteger(value, label, { positive = false } = {}) {
  if (value === undefined || value === null) return null;
  assert(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), `${label} must be a safe integer.`);
  return value;
}

function normalizeOptionalSignal(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    assert(Number.isSafeInteger(value), `${label} must be a safe signal value.`);
    return value;
  }
  assert(
    typeof value === "string" && value.length > 0 && value.length <= 64 && !/[\r\n\0]/.test(value),
    `${label} must be a bounded signal value.`,
  );
  return value;
}

function normalizeCommandText(value, label) {
  assert(
    typeof value === "string"
      && value.trim().length > 0
      && value.length <= 1000
      && !/[\r\n\0]/.test(value),
    `${label} must be a single non-empty command.`,
  );
  assert(!SENSITIVE_COMMAND_PATTERN.test(value), `${label} contains a credential-shaped literal.`);
  return value.trim();
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function pathMatches(pattern, changedPath) {
  const normalizedPattern = normalizeRelativePath(pattern, "affectedPath");
  if (normalizedPattern === changedPath) return true;
  if (normalizedPattern.endsWith("/**")) {
    return changedPath.startsWith(`${normalizedPattern.slice(0, -3)}/`);
  }
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -2);
    return changedPath.startsWith(`${prefix}/`) && !changedPath.slice(prefix.length + 1).includes("/");
  }
  return false;
}

function normalizeCommand(command, index) {
  assert(command && typeof command === "object", `verificationCommands[${index}] must be an object.`);
  const id = normalizeId(command.id, `verificationCommands[${index}].id`);
  assert(NODE_KINDS.has(command.kind), `${id} has an unsupported verification kind.`);
  const commandText = normalizeCommandText(command.command, `${id}.command`);
  const affectedPaths = Array.isArray(command.affectedPaths)
    ? sortedUnique(command.affectedPaths.map((entry, pathIndex) => normalizeRelativePath(entry, `${id}.affectedPaths[${pathIndex}]`)))
    : [];
  const dependsOn = Array.isArray(command.dependsOn) ? sortedUnique(command.dependsOn.map((entry) => normalizeId(entry, `${id}.dependsOn`))) : [];
  const scope = command.scope ?? (command.kind === "browser" ? "browser" : "targeted");
  assert(NODE_SCOPES.has(scope), `${id}.scope is unsupported.`);
  return {
    id,
    kind: command.kind,
    command: commandText,
    affectedPaths,
    dependsOn,
    required: command.required !== false,
    scope,
  };
}

function normalizeBrowser(browser) {
  if (browser === undefined || browser === null) return null;
  assert(browser === true || typeof browser === "object", "browser must be a boolean or object.");
  if (browser === true) return { required: true, command: null, affectedPaths: [] };
  const affectedPaths = Array.isArray(browser.affectedPaths)
    ? sortedUnique(browser.affectedPaths.map((entry, index) => normalizeRelativePath(entry, `browser.affectedPaths[${index}]`)))
    : [];
  return {
    required: browser.required !== false,
    command: browser.command == null ? null : normalizeCommandText(String(browser.command), "browser.command"),
    affectedPaths,
  };
}

function closeCommandDependencies(commands, initiallySelected) {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const selectedIds = new Set();
  const visiting = new Set();
  const visit = (nodeId) => {
    const node = byId.get(nodeId);
    assert(node, `Verification node dependency ${nodeId} does not exist.`);
    assert(!visiting.has(nodeId), `Verification DAG contains a cycle at ${nodeId}.`);
    if (selectedIds.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(nodeId);
    selectedIds.add(nodeId);
  };
  for (const command of initiallySelected) visit(command.id);
  return commands.filter((command) => selectedIds.has(command.id));
}

function assertAcyclic(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    assert(byId.has(nodeId), `Verification node dependency ${nodeId} does not exist.`);
    if (visited.has(nodeId)) return;
    assert(!visiting.has(nodeId), `Verification DAG contains a cycle at ${nodeId}.`);
    visiting.add(nodeId);
    for (const dependency of byId.get(nodeId).dependsOn) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visit(node.id);
}

export function selectVerificationNodes({
  changedPaths = [],
  verificationCommands = [],
  browser = null,
  impactEvidence = null,
  revision = null,
} = {}) {
  const normalizedPaths = sortedUnique(changedPaths.map((entry, index) => normalizeRelativePath(entry, `changedPaths[${index}]`)));
  const commands = verificationCommands.map(normalizeCommand);
  assert(new Set(commands.map((command) => command.id)).size === commands.length, "Verification command ids must be unique.");
  assertAcyclic(commands);
  const scopeAvailable = normalizedPaths.length > 0;
  const normalizedBrowser = normalizeBrowser(browser);
  const impact = normalizeVerificationImpactEvidence(impactEvidence, { changedPaths: normalizedPaths, revision });
  const impactPatterns = [
    ...commands.flatMap((command) => command.affectedPaths),
    ...(normalizedBrowser?.affectedPaths ?? []),
  ];
  const effectivePaths = sortedUnique([...normalizedPaths, ...impact.impactedPaths]);
  const impactUnknown = scopeAvailable && (
    impact.hasPartial
    || normalizedPaths.some((changedPath) => (
      !impactPatterns.some((pattern) => pathMatches(pattern, changedPath))
      && !impact.completeChangedPaths.includes(changedPath)
    ))
    || impact.impactedPaths.some((impactedPath) => !impactPatterns.some((pattern) => pathMatches(pattern, impactedPath)))
  );
  const affectedCommands = (impactUnknown ? commands : commands.filter((command) => {
    if (!scopeAvailable || command.affectedPaths.length === 0) return true;
    return command.affectedPaths.some((pattern) => effectivePaths.some((changedPath) => pathMatches(pattern, changedPath)));
  }));
  const selected = closeCommandDependencies(commands, affectedCommands);
  if (normalizedBrowser?.required && (
    !scopeAvailable
    || normalizedBrowser.affectedPaths.length === 0
    || normalizedBrowser.affectedPaths.some((pattern) => effectivePaths.some((changedPath) => pathMatches(pattern, changedPath)))
  )) {
    selected.push({
      id: "browser.relay",
      kind: "browser",
      command: normalizedBrowser.command,
      affectedPaths: normalizedBrowser.affectedPaths,
      dependsOn: sortedUnique(selected.map((command) => command.id)),
      required: true,
      scope: "browser",
    });
  }
  assert(new Set(selected.map((command) => command.id)).size === selected.length, "Selected verification node ids must be unique.");
  const expanded = !scopeAvailable || impactUnknown;
  const scope = normalizedBrowser?.required && selected.some((node) => node.kind === "browser")
    ? "browser"
    : expanded ? "expanded" : "targeted";
  const reason = selected.length === 0
    ? "no-nodes"
    : impactUnknown
      ? "impact-unknown"
      : normalizedBrowser?.required && selected.some((node) => node.kind === "browser")
      ? "browser-required"
      : !scopeAvailable ? "scope-unavailable"
        : impact.impactedPaths.length > 0 ? "impact-evidence" : "affected-paths";
  return {
    normalizedPaths,
    nodes: selected.sort((left, right) => left.id.localeCompare(right.id)).map((command) => ({
      id: command.id,
      kind: command.kind,
      scope: command.scope,
      required: command.required,
      dependsOn: [...command.dependsOn],
      command: command.command,
      status: "planned",
      attempts: [],
      firstFailure: null,
    })),
    selection: {
      strategy: "changed-paths-v1",
      scope,
      expanded,
      reason,
      ...(impact.projection === null ? {} : { impactEvidence: impact.projection }),
    },
  };
}

export function createVerificationDagPlan({
  runId,
  taskId,
  generatedAt = new Date().toISOString(),
  commit,
  workspaceHash,
  changedPaths = [],
  diffHash = null,
  verificationCommands = [],
  browser = null,
  impactEvidence = null,
} = {}) {
  normalizeId(runId, "runId");
  normalizeId(taskId, "taskId");
  const generatedDate = typeof generatedAt === "string" && ISO_DATE_TIME_PATTERN.test(generatedAt)
    ? new Date(generatedAt)
    : null;
  assert(
    generatedDate !== null
      && Number.isFinite(generatedDate.getTime())
      && generatedDate.toISOString() === generatedAt,
    "generatedAt must be an ISO UTC timestamp.",
  );
  assert(typeof commit === "string" && /^[0-9a-f]{7,64}$/.test(commit), "commit must identify the source revision.");
  assert(typeof workspaceHash === "string" && /^[0-9a-f]{64}$/.test(workspaceHash), "workspaceHash must be a SHA-256.");
  assert(diffHash === null || /^[0-9a-f]{64}$/.test(diffHash), "diffHash must be null or a SHA-256.");
  const selection = selectVerificationNodes({
    changedPaths,
    verificationCommands,
    browser,
    impactEvidence,
    revision: { commit, workspaceHash },
  });
  assertAcyclic(selection.nodes);
  return {
    schemaVersion: VERIFICATION_DAG_SCHEMA_VERSION,
    runId,
    taskId,
    generatedAt,
    revision: { source: "git", commit, workspaceHash },
    implementation: {
      status: "completed",
      changedPaths: selection.normalizedPaths,
      ...(diffHash === null ? {} : { diffHash }),
    },
    selection: selection.selection,
    nodes: selection.nodes,
    execution: {
      mode: "plan-and-replay",
      commandsExecuted: false,
      providerCalls: 0,
      mutationCount: 0,
      retryPolicy: { maxAttempts: FAILURE_REPLAY_MAX_ATTEMPTS, preserveFirstFailure: true },
    },
    outcome: {
      taskStatus: "verification_incomplete",
      verificationStatus: "not_started",
      reason: selection.nodes.length === 0 ? "no_nodes" : "not_executed",
      firstFailureNodeId: null,
    },
  };
}

export function finalizeVerificationDag(plan, results) {
  assert(plan && plan.schemaVersion === VERIFICATION_DAG_SCHEMA_VERSION, "plan must be a verification-dag/v1 plan.");
  assert(plan.implementation?.status === "completed", "implementation must be completed before verification.");
  assert(Array.isArray(results), "results must be an array.");
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  assert(results.length === byId.size, "results must contain exactly one result for each selected node.");
  if (plan.nodes.length === 0) {
    return {
      ...plan,
      outcome: {
        taskStatus: "implementation_completed",
        verificationStatus: "not_started",
        reason: "no_nodes",
        firstFailureNodeId: null,
      },
    };
  }
  const resultById = new Map();
  for (const result of results) {
    const resultId = normalizeId(result?.id, "result.id");
    assert(byId.has(resultId), `Result ${resultId} does not map to a selected node.`);
    assert(!resultById.has(resultId), `Duplicate result for ${resultId}.`);
    resultById.set(resultId, result);
  }
  const finalizedNodes = plan.nodes.map((node) => {
    const result = resultById.get(node.id);
    assert(result, `Missing result for ${node.id}.`);
    assert(NODE_STATUSES.has(result.status) && result.status !== "planned", `${node.id} has an invalid final status.`);
    const attempt = { attempt: 1, status: result.status };
    if (result.evidence !== undefined) {
      assert(result.evidence && typeof result.evidence.path === "string", `${node.id}.evidence.path is required.`);
      normalizeRelativePath(result.evidence.path, `${node.id}.evidence.path`);
      assert(typeof result.evidence.sha256 === "string" && /^[0-9a-f]{64}$/.test(result.evidence.sha256), `${node.id}.evidence.sha256 must be a SHA-256.`);
      attempt.evidence = { path: result.evidence.path.replaceAll("\\", "/"), sha256: result.evidence.sha256 };
    }
    if (result.commandJob !== undefined) {
      attempt.commandJob = normalizeCommandJobReplayEvidence(result.commandJob, `${node.id}.commandJob`);
    }
    if (result.testReport !== undefined) {
      attempt.testReport = normalizeTestReportEvidence(result.testReport, `${node.id}.testReport`);
    }
    if (result.browserReport !== undefined) {
      assert(node.kind === "browser", `${node.id}.browserReport is only supported for browser nodes.`);
      assertExactKeys(result.browserReport, ["artifact", "content", "screenshotContent"], `${node.id}.browserReport`);
      const browserReport = projectVerificationBrowserReport({
        ...result.browserReport,
        expectedRevision: {
          commit: plan.revision.commit,
          workspaceHash: plan.revision.workspaceHash,
        },
      });
      const statusCompatible = (browserReport.status === "passed" && result.status === "passed")
        || (browserReport.status === "failed" && result.status === "failed")
        || (browserReport.status === "incomplete" && ["not_run", "skipped"].includes(result.status));
      assert(statusCompatible, `${node.id}.browserReport ${browserReport.status} disagrees with DAG status ${result.status}.`);
      attempt.browserReport = browserReport;
    }
    const failed = result.status === "failed" || result.status === "timed_out" || result.status === "cancelled";
    if (failed && result.kind !== undefined) {
      assert(FAILURE_KINDS.has(result.kind), `${node.id}.kind is unsupported.`);
    }
    const firstFailure = failed
      ? { status: result.status, kind: result.kind ?? (node.kind === "acceptance" ? "test" : node.kind), messageHash: sha256(result.message ?? "") }
      : null;
    const replay = normalizeFailureReplay(result, `${node.id}.replays`);
    const replayAttempts = replay === null
      ? []
      : replay.entries.map((entry, index) => ({
        attempt: index + 2,
        status: entry.status,
        replayEvidence: {
          binding: entry.binding,
          failureFingerprint: entry.failureFingerprint,
        },
      }));
    return {
      ...node,
      status: result.status,
      attempts: [attempt, ...replayAttempts],
      firstFailure,
      ...(replay === null ? {} : { replay: replay.summary }),
    };
  });
  const requiredNotRun = finalizedNodes.find((node) => node.required && ["skipped", "not_run"].includes(node.status));
  const requiredFailed = finalizedNodes.find((node) => node.required && node.firstFailure !== null);
  const verificationStatus = requiredFailed ? "failed" : requiredNotRun ? "incomplete" : "passed";
  const taskStatus = requiredFailed ? "verification_failed" : requiredNotRun ? "verification_incomplete" : "completed";
  return {
    ...plan,
    nodes: finalizedNodes,
    outcome: {
      taskStatus,
      verificationStatus,
      reason: requiredFailed ? "required_failure" : requiredNotRun ? "required_not_run" : "all_required_passed",
      firstFailureNodeId: requiredFailed?.id ?? null,
    },
  };
}

function normalizeFailureReplay(result, label) {
  const hasReplayFields = result.replays !== undefined
    || result.replayBinding !== undefined
    || result.failureFingerprint !== undefined;
  if (!hasReplayFields) return null;
  assert(result.status === "failed", `${label} requires an initial failed result.`);
  assert(Array.isArray(result.replays), `${label} must be an array.`);
  assert(result.replays.length <= FAILURE_REPLAY_MAX_ATTEMPTS - 1, `${label} allows at most 2 replay attempts.`);
  assertExactKeys(result.replayBinding, ["environmentHash", "inputHash"], `${label}.initialBinding`);
  const initialBinding = normalizeReplayBinding(result.replayBinding, `${label}.initialBinding`);
  assert(typeof result.failureFingerprint === "string" && /^[0-9a-f]{64}$/.test(result.failureFingerprint), `${label}.initialFailureFingerprint must be a SHA-256.`);
  const entries = result.replays.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    assertExactKeys(entry, ["status", "kind", "replayBinding", "failureFingerprint"], entryLabel);
    assert(FAILURE_REPLAY_STATUSES.has(entry.status), `${entryLabel}.status is unsupported.`);
    if (entry.kind !== undefined) assert(FAILURE_KINDS.has(entry.kind), `${entryLabel}.kind is unsupported.`);
    assertExactKeys(entry.replayBinding, ["environmentHash", "inputHash"], `${entryLabel}.replayBinding`);
    const binding = normalizeReplayBinding(entry.replayBinding, `${entryLabel}.replayBinding`);
    assert(binding.environmentHash === initialBinding.environmentHash && binding.inputHash === initialBinding.inputHash, `${entryLabel} binding does not match the initial failure.`);
    const failureFingerprint = entry.failureFingerprint ?? null;
    if (entry.status === "failed") {
      assert(typeof failureFingerprint === "string" && /^[0-9a-f]{64}$/.test(failureFingerprint), `${entryLabel}.failureFingerprint must be a SHA-256 for failed replays.`);
    } else {
      assert(failureFingerprint === null, `${entryLabel}.failureFingerprint must be null for non-failed replays.`);
    }
    return { status: entry.status, binding, failureFingerprint };
  });
  const classification = entries.length === 0
    ? "not_requested"
    : entries.some((entry) => entry.status === "passed")
      ? "flaky"
      : entries.some((entry) => entry.status !== "failed")
        ? "incomplete"
        : entries.every((entry) => entry.failureFingerprint === result.failureFingerprint)
          ? "reproducible_failure"
          : "non_reproducible";
  return {
    entries,
    summary: {
      maxAttempts: FAILURE_REPLAY_MAX_ATTEMPTS,
      replayCount: entries.length,
      classification,
      binding: initialBinding,
      failureFingerprint: classification === "reproducible_failure" ? result.failureFingerprint : null,
    },
  };
}

function normalizeReplayBinding(value, label) {
  assert(typeof value.environmentHash === "string" && /^[0-9a-f]{64}$/.test(value.environmentHash), `${label}.environmentHash must be a SHA-256.`);
  assert(typeof value.inputHash === "string" && /^[0-9a-f]{64}$/.test(value.inputHash), `${label}.inputHash must be a SHA-256.`);
  return { environmentHash: value.environmentHash, inputHash: value.inputHash };
}

function normalizeCommandJobReplayEvidence(value, label) {
  assertExactKeys(
    value,
    ["jobId", "status", "terminationReason", "exit", "timing", "recoveryLifecycle"],
    label,
  );
  assert(typeof value.jobId === "string" && COMMAND_JOB_ID_PATTERN.test(value.jobId), `${label}.jobId must be a UUID.`);
  assert(COMMAND_JOB_TERMINAL_STATUSES.has(value.status), `${label}.status must be terminal.`);
  assert(
    value.terminationReason === null || COMMAND_JOB_TERMINATION_REASONS.has(value.terminationReason),
    `${label}.terminationReason is unsupported.`,
  );
  assertExactKeys(value.exit, ["taxonomy", "exitCode", "signal"], `${label}.exit`);
  assert(COMMAND_JOB_EXIT_TAXONOMY.has(value.exit.taxonomy), `${label}.exit.taxonomy is unsupported.`);
  const exitCode = normalizeOptionalSafeInteger(value.exit.exitCode, `${label}.exit.exitCode`);
  const signal = normalizeOptionalSignal(value.exit.signal, `${label}.exit.signal`);
  assertExactKeys(value.timing, ["timeoutMs", "deadlineAt", "endedAt", "budgetExhausted"], `${label}.timing`);
  const timeoutMs = normalizeOptionalSafeInteger(value.timing.timeoutMs, `${label}.timing.timeoutMs`, { positive: true });
  const deadlineAt = normalizeOptionalSafeInteger(value.timing.deadlineAt, `${label}.timing.deadlineAt`, { positive: true });
  const endedAt = normalizeOptionalSafeInteger(value.timing.endedAt, `${label}.timing.endedAt`, { positive: true });
  assert(typeof value.timing.budgetExhausted === "boolean", `${label}.timing.budgetExhausted must be boolean.`);
  const classification = classifyCommandJobTerminal(
    { status: value.status, terminationReason: value.terminationReason, exitCode, signal },
    label,
  );
  assert(value.exit.taxonomy === classification.taxonomy, `${label}.exit.taxonomy is inconsistent with the command-job terminal state.`);
  assert(value.timing.budgetExhausted === (classification.taxonomy === "timed_out"), `${label}.timing.budgetExhausted is inconsistent.`);
  assert(
    value.recoveryLifecycle === (value.status === "lost" ? "lost" : "settled"),
    `${label}.recoveryLifecycle is inconsistent with the command-job terminal state.`,
  );
  return {
    jobId: value.jobId,
    status: value.status,
    terminationReason: value.terminationReason,
    exit: { taxonomy: value.exit.taxonomy, exitCode, signal },
    timing: { timeoutMs, deadlineAt, endedAt, budgetExhausted: value.timing.budgetExhausted },
    recoveryLifecycle: value.recoveryLifecycle,
  };
}

function normalizeTestReportEvidence(value, label) {
  assertExactKeys(
    value,
    ["framework", "format", "runnerVersion", "artifact", "status", "reason", "groupKind", "groups", "tests", "failedBuilds"],
    label,
  );
  const isVitest = value.framework === "vitest";
  const isGoTest = value.framework === "go-test";
  assert(isVitest || isGoTest, `${label}.framework is unsupported.`);
  if (isVitest) {
    assert(value.format === "vitest-json/v3.2.7" && value.runnerVersion === "3.2.7" && value.groupKind === "suite", `${label} has an inconsistent Vitest identity.`);
  } else {
    assert(value.format === "go-test-json/v1" && typeof value.runnerVersion === "string" && /^go1\.(?:2[0-9]|[3-9][0-9])(?:\.\d+)?$/.test(value.runnerVersion) && value.groupKind === "package", `${label} has an inconsistent Go test identity.`);
  }
  assertExactKeys(value.artifact, ["path", "sha256"], `${label}.artifact`);
  const artifactPath = normalizeRelativePath(value.artifact.path, `${label}.artifact.path`);
  assert(typeof value.artifact.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.artifact.sha256), `${label}.artifact.sha256 must be a SHA-256.`);
  assert(["passed", "failed", "incomplete"].includes(value.status), `${label}.status is unsupported.`);
  assert(["all_tests_passed", "test_failures", "no_tests_executed", "runner_incomplete"].includes(value.reason), `${label}.reason is unsupported.`);
  assert(
    (value.status === "passed" && value.reason === "all_tests_passed")
      || (value.status === "failed" && value.reason === "test_failures")
      || (value.status === "incomplete" && (value.reason === "no_tests_executed" || value.reason === "runner_incomplete")),
    `${label}.status and reason are inconsistent.`,
  );
  assertExactKeys(value.groups, ["total", "passed", "failed", "skipped"], `${label}.groups`);
  const groups = {
    total: normalizeOptionalSafeInteger(value.groups.total, `${label}.groups.total`),
    passed: normalizeOptionalSafeInteger(value.groups.passed, `${label}.groups.passed`),
    failed: normalizeOptionalSafeInteger(value.groups.failed, `${label}.groups.failed`),
    skipped: normalizeOptionalSafeInteger(value.groups.skipped, `${label}.groups.skipped`),
  };
  assert(Object.values(groups).every((entry) => entry !== null), `${label}.groups must be complete.`);
  assert(groups.passed + groups.failed + groups.skipped === groups.total, `${label}.group counts are inconsistent.`);
  assertExactKeys(value.tests, ["total", "passed", "failed", "skipped", "todo"], `${label}.tests`);
  const tests = {
    total: normalizeOptionalSafeInteger(value.tests.total, `${label}.tests.total`),
    passed: normalizeOptionalSafeInteger(value.tests.passed, `${label}.tests.passed`),
    failed: normalizeOptionalSafeInteger(value.tests.failed, `${label}.tests.failed`),
    skipped: normalizeOptionalSafeInteger(value.tests.skipped, `${label}.tests.skipped`),
    todo: normalizeOptionalSafeInteger(value.tests.todo, `${label}.tests.todo`),
  };
  assert(Object.values(tests).every((entry) => entry !== null), `${label}.tests must be complete.`);
  assert(tests.passed + tests.failed + tests.skipped + tests.todo === tests.total, `${label}.test counts are inconsistent.`);
  const failedBuilds = normalizeOptionalSafeInteger(value.failedBuilds, `${label}.failedBuilds`);
  assert(failedBuilds !== null && (!isVitest || failedBuilds === 0) && (!isGoTest || failedBuilds <= groups.failed), `${label}.failedBuilds is inconsistent.`);
  return {
    framework: value.framework,
    format: value.format,
    runnerVersion: value.runnerVersion,
    artifact: { path: artifactPath, sha256: value.artifact.sha256 },
    status: value.status,
    reason: value.reason,
    groupKind: value.groupKind,
    groups,
    tests,
    failedBuilds,
  };
}

function classifyCommandJobTerminal({ status, terminationReason, exitCode, signal }, label) {
  assert(status !== "completed" || exitCode === null || exitCode === 0, `${label} completed command-job has a non-zero exit code.`);
  assert(status !== "completed" || signal === null, `${label} completed command-job cannot have an exit signal.`);
  assert(status !== "completed" || terminationReason === null, `${label} completed command-job cannot have a termination reason.`);
  assert(status !== "cancelled" || terminationReason !== "timed_out", `${label} cancelled command-job cannot be timed out.`);
  assert(status !== "cancelled" || (exitCode === null && signal === null), `${label} cancelled command-job cannot have process exit data.`);
  assert(status !== "lost" || terminationReason === null, `${label} lost command-job cannot have a termination reason.`);
  assert(status !== "lost" || (exitCode === null && signal === null), `${label} lost command-job cannot have process exit data.`);

  if (status === "completed") return { status: "passed", taxonomy: "zero_exit" };
  if (status === "cancelled") return { status: "cancelled", taxonomy: "cancelled" };
  if (status === "lost") return { status: "not_run", taxonomy: "owner_lost" };
  if (terminationReason === "timed_out") return { status: "timed_out", taxonomy: "timed_out" };
  if (terminationReason === "cancelled") return { status: "failed", taxonomy: "cancellation_failed" };
  if (signal !== null) return { status: "failed", taxonomy: "signal" };
  if (exitCode !== null && exitCode !== 0) return { status: "failed", taxonomy: "non_zero_exit" };
  return { status: "failed", taxonomy: "runtime_error" };
}

function projectCommandJobSnapshot(binding, index) {
  assertExactKeys(binding, ["id", "snapshot", "testReport"], `commandJobSnapshots[${index}]`);
  const id = normalizeId(binding.id, `commandJobSnapshots[${index}].id`);
  const snapshot = binding.snapshot;
  assert(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot), `${id} requires a command-job snapshot.`);
  assert(typeof snapshot.jobId === "string" && COMMAND_JOB_ID_PATTERN.test(snapshot.jobId), `${id} command-job ID must be a UUID.`);
  assert(COMMAND_JOB_TERMINAL_STATUSES.has(snapshot.status), `${id} requires a terminal snapshot.`);
  const terminationReason = snapshot.terminationReason ?? null;
  assert(
    terminationReason === null || COMMAND_JOB_TERMINATION_REASONS.has(terminationReason),
    `${id} command-job termination reason is unsupported.`,
  );
  const exitCode = normalizeOptionalSafeInteger(snapshot.exitCode, `${id} command-job exitCode`);
  const signal = normalizeOptionalSignal(snapshot.signal, `${id} command-job signal`);
  const timeoutMs = normalizeOptionalSafeInteger(snapshot.timeoutMs, `${id} command-job timeoutMs`, { positive: true });
  const deadlineAt = normalizeOptionalSafeInteger(snapshot.deadlineAt, `${id} command-job deadlineAt`, { positive: true });
  const endedAt = normalizeOptionalSafeInteger(snapshot.endedAt, `${id} command-job endedAt`, { positive: true });
  const recoveryLifecycle = snapshot.recovery?.lifecycle;
  assert(COMMAND_JOB_RECOVERY_LIFECYCLES.has(recoveryLifecycle), `${id} command-job recovery lifecycle is unsupported.`);
  assert(snapshot.status !== "lost" || recoveryLifecycle === "lost", `${id} lost command-job must have lost recovery lifecycle.`);
  assert(snapshot.status === "lost" || recoveryLifecycle === "settled", `${id} terminal command-job must have settled recovery lifecycle.`);
  const { status, taxonomy } = classifyCommandJobTerminal(
    { status: snapshot.status, terminationReason, exitCode, signal },
    `${id} command-job snapshot`,
  );

  let replayStatus = status;
  let message = `command-job:${taxonomy}`;
  let testReport;
  if (binding.testReport !== undefined) {
    const projectedReport = projectStructuredTestReport(binding.testReport);
    const reportCompatible = (projectedReport.status === "passed" && status === "passed" && taxonomy === "zero_exit")
      || (projectedReport.status === "failed" && status === "failed" && taxonomy === "non_zero_exit")
      || (projectedReport.status === "not_run" && (taxonomy === "zero_exit" || taxonomy === "non_zero_exit"));
    assert(reportCompatible, `${id} structured test report disagrees with command-job exit state.`);
    replayStatus = projectedReport.status;
    message = `test-report:${projectedReport.evidence.framework}:${projectedReport.reason}`;
    testReport = projectedReport.evidence;
  }

  return {
    id,
    status: replayStatus,
    message,
    commandJob: {
      jobId: snapshot.jobId,
      status: snapshot.status,
      terminationReason,
      exit: { taxonomy, exitCode, signal },
      timing: {
        timeoutMs,
        deadlineAt,
        endedAt,
        budgetExhausted: taxonomy === "timed_out",
      },
      recoveryLifecycle,
    },
    ...(testReport ? { testReport } : {}),
  };
}

function attachCommandJobReplayMetadata(finalized, results) {
  const testReportCount = results.filter((result) => result.testReport !== undefined).length;
  return {
    ...finalized,
    execution: {
      ...finalized.execution,
      replay: {
        authority: "command-job",
        source: "terminal-snapshot",
        snapshotCount: results.length,
        terminalOnly: true,
        ...(testReportCount > 0 ? { testReportCount } : {}),
      },
    },
  };
}

/** Projects already-settled command jobs into the DAG without reading output or executing commands. */
export function replayCommandJobSnapshots(plan, bindings) {
  assert(plan && plan.schemaVersion === VERIFICATION_DAG_SCHEMA_VERSION, "plan must be a verification-dag/v1 plan.");
  assert(Array.isArray(bindings), "commandJobSnapshots must be an array.");
  const results = bindings.map(projectCommandJobSnapshot);
  const finalized = finalizeVerificationDag(plan, results);
  return attachCommandJobReplayMetadata(finalized, results);
}

async function hydrateCliVerificationResults(plan, request) {
  const hasCommandJobs = request.commandJobSnapshots !== undefined;
  const hasBrowserArtifacts = request.browserArtifacts !== undefined;
  if (!hasCommandJobs && !hasBrowserArtifacts) return plan;
  if (hasCommandJobs) assert(Array.isArray(request.commandJobSnapshots), "commandJobSnapshots must be an array.");
  const commandResults = hasCommandJobs
    ? request.commandJobSnapshots.map(projectCommandJobSnapshot)
    : [];
  const results = [...commandResults];
  if (hasBrowserArtifacts) {
    const browserNodes = plan.nodes.filter((node) => node.kind === "browser");
    assert(browserNodes.length === 1, "browserArtifacts requires exactly one selected browser node.");
    const browserResult = await loadVerificationBrowserArtifacts({
      browserArtifacts: request.browserArtifacts,
      expectedRevision: {
        commit: plan.revision.commit,
        workspaceHash: plan.revision.workspaceHash,
      },
      workspaceRoot,
    });
    results.push({ id: browserNodes[0].id, ...browserResult });
  }
  const finalized = finalizeVerificationDag(plan, results);
  return hasCommandJobs ? attachCommandJobReplayMetadata(finalized, commandResults) : finalized;
}

export async function writeVerificationDagArtifact(plan, outputPath) {
  assert(plan?.schemaVersion === VERIFICATION_DAG_SCHEMA_VERSION, "Artifact must use verification-dag/v1.");
  assert(plan.execution?.commandsExecuted === false && plan.execution?.providerCalls === 0 && plan.execution?.mutationCount === 0, "Artifact execution boundary must remain zero-execution.");
  const target = path.resolve(outputPath);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  let handle;
  try {
    handle = await fs.open(target, "wx");
    await handle.writeFile(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Verification DAG artifact already exists: ${target}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return target;
}

function parseArgs(argv) {
  const args = { help: false, input: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") { args.help = true; continue; }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    if (argument === "--input") args.input = value;
    else if (argument === "--output") args.output = value;
    else throw new Error(`Unsupported argument ${argument}.`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/run-verification-dag.mjs --input request.json --output artifact.json");
    return;
  }
  assert(args.input && args.output, "--input and --output are required.");
  const request = JSON.parse(await fs.readFile(path.resolve(args.input), "utf8"));
  const plan = createVerificationDagPlan(request);
  const artifact = await hydrateCliVerificationResults(plan, request);
  await writeVerificationDagArtifact(artifact, args.output);
  console.log(JSON.stringify({ output: path.resolve(args.output), taskStatus: artifact.outcome.taskStatus, nodeCount: artifact.nodes.length }));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`[verification-dag] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
