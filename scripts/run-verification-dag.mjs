import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERIFICATION_DAG_SCHEMA_VERSION = "verification-dag/v1";
const NODE_KINDS = new Set(["acceptance", "build", "typecheck", "lint", "browser", "manual"]);
const NODE_SCOPES = new Set(["targeted", "module", "full", "browser"]);
const NODE_STATUSES = new Set(["planned", "passed", "failed", "skipped", "timed_out", "cancelled", "not_run"]);
const FAILURE_KINDS = new Set(["test", "build", "typecheck", "lint", "browser", "manual", "infrastructure"]);
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SENSITIVE_COMMAND_PATTERN = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
} = {}) {
  const normalizedPaths = sortedUnique(changedPaths.map((entry, index) => normalizeRelativePath(entry, `changedPaths[${index}]`)));
  const commands = verificationCommands.map(normalizeCommand);
  assert(new Set(commands.map((command) => command.id)).size === commands.length, "Verification command ids must be unique.");
  assertAcyclic(commands);
  const scopeAvailable = normalizedPaths.length > 0;
  const affectedCommands = commands.filter((command) => {
    if (!scopeAvailable || command.affectedPaths.length === 0) return true;
    return command.affectedPaths.some((pattern) => normalizedPaths.some((changedPath) => pathMatches(pattern, changedPath)));
  });
  const selected = closeCommandDependencies(commands, affectedCommands);
  const normalizedBrowser = normalizeBrowser(browser);
  if (normalizedBrowser?.required && (
    !scopeAvailable
    || normalizedBrowser.affectedPaths.length === 0
    || normalizedBrowser.affectedPaths.some((pattern) => normalizedPaths.some((changedPath) => pathMatches(pattern, changedPath)))
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
  const expanded = !scopeAvailable;
  const scope = normalizedBrowser?.required && selected.some((node) => node.kind === "browser")
    ? "browser"
    : expanded ? "expanded" : "targeted";
  const reason = selected.length === 0
    ? "no-nodes"
    : normalizedBrowser?.required && selected.some((node) => node.kind === "browser")
      ? "browser-required"
      : !scopeAvailable ? "scope-unavailable" : "affected-paths";
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
    selection: { strategy: "changed-paths-v1", scope, expanded, reason },
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
  const selection = selectVerificationNodes({ changedPaths, verificationCommands, browser });
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
      retryPolicy: { maxAttempts: 1, preserveFirstFailure: true },
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
    const failed = result.status === "failed" || result.status === "timed_out" || result.status === "cancelled";
    if (failed && result.kind !== undefined) {
      assert(FAILURE_KINDS.has(result.kind), `${node.id}.kind is unsupported.`);
    }
    const firstFailure = failed
      ? { status: result.status, kind: result.kind ?? (node.kind === "acceptance" ? "test" : node.kind), messageHash: sha256(result.message ?? "") }
      : null;
    return { ...node, status: result.status, attempts: [attempt], firstFailure };
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
  await writeVerificationDagArtifact(plan, args.output);
  console.log(JSON.stringify({ output: path.resolve(args.output), taskStatus: plan.outcome.taskStatus, nodeCount: plan.nodes.length }));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`[verification-dag] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
