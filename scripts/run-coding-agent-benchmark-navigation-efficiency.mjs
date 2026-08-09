import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION =
  "coding-agent-benchmark-navigation-efficiency/v1";

export const CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID =
  "workspace-write-navigation-candidate-v1";
const CANDIDATE_ID = CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID;
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const MINIMUM_MODEL_VISIBLE_RESPONSE_REDUCTION_RATIO = 0.5;
const REGRESSION_TEST_PATH = "test/benchmark-v3/real-js-bug-fix.js";
const TARGET_PATH = "lib/request.js";
const BUG_SIGNATURE = "return subdomains.slice(offset + 1);";
const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function analyzeNavigationEfficiencyBaseline(input) {
  const manifest = requireObject(input?.manifest, "baseline manifest");
  const events = requireArray(input?.events, "baseline events");
  const startedCalls = new Map();
  const calls = [];
  let usage;
  let budget;
  let changedFileCount = 0;

  for (const event of events) {
    const type = event?.type;
    const tool = event?.payload?.tool;
    if (type === "tool.started" && typeof tool?.id === "string") {
      startedCalls.set(tool.id, tool);
    } else if (type === "tool.completed" && typeof tool?.id === "string") {
      const started = startedCalls.get(tool.id) ?? {};
      calls.push(summarizeToolCall({ ...tool, arguments: started.arguments ?? {} }));
    } else if (type === "run.usage") {
      usage = event?.payload?.usage;
    } else if (type === "run.budget_exhausted") {
      budget = event?.payload?.budget;
    } else if (type === "run.completed" || type === "run.failed" || type === "run.cancelled") {
      changedFileCount = normalizeNonNegativeInteger(event?.payload?.changes?.changedFileCount, 0);
    }
  }

  const inputTokens = normalizeNonNegativeInteger(usage?.input, 0);
  const outputTokens = normalizeNonNegativeInteger(usage?.output, 0);
  const totalTokens = inputTokens + outputTokens;
  const tokenLimit = normalizeNonNegativeInteger(
    budget?.limit,
    normalizeNonNegativeInteger(manifest?.execution?.budgets?.maxTokens, 0),
  );
  return {
    runId: requireString(manifest.runId, "baseline manifest runId"),
    taskId: requireString(manifest.taskId, "baseline manifest taskId"),
    baselineCommit: requireString(manifest?.fixture?.baselineCommit, "baseline commit"),
    modelCalls: normalizeNonNegativeInteger(usage?.modelCalls, 0),
    inputTokens,
    outputTokens,
    totalTokens,
    tokenLimit,
    budgetExhausted: Boolean(budget) || (tokenLimit > 0 && totalTokens > tokenLimit),
    changedFileCount,
    toolCallCount: calls.length,
    modelVisibleResponseBytes: sum(calls.map((call) => call.responseBytes)),
    fileContentBytesExposed: sum(calls.map((call) => call.fileContentBytes)),
    irrelevantFullFileReadBytes: sum(calls
      .filter((call) => call.fullFileRead && ![REGRESSION_TEST_PATH, TARGET_PATH].includes(call.relativePath))
      .map((call) => call.fileContentBytes)),
    calls,
  };
}

export function buildNavigationCandidateProfile(manifest) {
  const profiles = requireObject(manifest?.suite?.executionProfiles, "v3 execution profiles");
  const base = requireObject(profiles["workspace-write"], "workspace-write profile");
  const navigation = requireObject(profiles["navigation-read"], "navigation-read profile");
  for (const toolName of ["text_search", "file_glob"]) {
    if (!navigation.toolAllow?.includes(toolName)) {
      throw new Error(`Navigation-read profile does not expose ${toolName}.`);
    }
  }
  const baseTools = requireArray(base.toolAllow, "workspace-write toolAllow");
  const insertAt = baseTools.findIndex((name) => name === "file_edit");
  const toolAllow = insertAt < 0
    ? [...baseTools, "text_search", "file_glob"]
    : [
      ...baseTools.slice(0, insertAt),
      "text_search",
      "file_glob",
      ...baseTools.slice(insertAt),
    ];
  return {
    id: CANDIDATE_ID,
    baseProfile: "workspace-write",
    permissionMode: base.permissionMode,
    toolAllow,
    toolDeny: [...requireArray(base.toolDeny, "workspace-write toolDeny")],
    manifestModified: false,
  };
}

export function evaluateNavigationEfficiencyCandidate(input) {
  const baseline = requireObject(input?.baseline, "navigation baseline");
  const candidate = requireObject(input?.candidate, "navigation candidate");
  const security = requireObject(input?.security, "navigation security evidence");
  const modelVisibleResponseReductionRatio = reductionRatio(
    baseline.modelVisibleResponseBytes,
    candidate.modelVisibleResponseBytes,
  );
  const fileContentExposureReductionRatio = reductionRatio(
    baseline.fileContentBytesExposed,
    candidate.fileContentBytesExposed,
  );
  const diagnostics = [];
  if (modelVisibleResponseReductionRatio < MINIMUM_MODEL_VISIBLE_RESPONSE_REDUCTION_RATIO) {
    diagnostics.push("model_visible_response_reduction_below_threshold");
  }
  if (candidate.irrelevantFullFileReadBytes !== 0) {
    diagnostics.push("irrelevant_full_file_read_observed");
  }
  if (candidate.targetLocalized !== true) diagnostics.push("target_not_localized");
  if (candidate.bugSignatureObserved !== true) diagnostics.push("bug_signature_not_observed");
  if (security.textSearchTraversalRejected !== true) {
    diagnostics.push("text_search_traversal_not_rejected");
  }
  if (security.fileGlobTraversalRejected !== true) {
    diagnostics.push("file_glob_traversal_not_rejected");
  }
  if (security.workspaceUnchanged !== true) diagnostics.push("workspace_changed");

  return {
    status: diagnostics.length === 0 ? "eligible_for_canary" : "insufficient",
    comparison: {
      modelVisibleResponseReductionRatio,
      fileContentExposureReductionRatio,
      thresholds: {
        minimumModelVisibleResponseReductionRatio:
          MINIMUM_MODEL_VISIBLE_RESPONSE_REDUCTION_RATIO,
        maximumIrrelevantFullFileReadBytes: 0,
      },
      tokenImpact: {
        status: "not_measured",
        reason: "no_model_call",
      },
    },
    diagnostics,
  };
}

export async function runNavigationEfficiencyProbe(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const baselineRunRoot = path.resolve(requireString(input?.baselineRunRoot, "baselineRunRoot"));
  const workspaceRoot = path.resolve(requireString(input?.workspaceRoot, "workspaceRoot"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  assertDisjointRoots(outputRoot, workspaceRoot, "outputRoot", "workspaceRoot");
  assertDisjointRoots(outputRoot, baselineRunRoot, "outputRoot", "baselineRunRoot");
  await Promise.all([
    assertDirectory(sourceRoot, "sourceRoot"),
    assertDirectory(baselineRunRoot, "baselineRunRoot"),
    assertDirectory(workspaceRoot, "workspaceRoot"),
    assertPathAbsent(outputRoot, "output root"),
  ]);

  const [manifest, baselineManifestText, baselineEventsText] = await Promise.all([
    dependencies.manifest
      ? structuredClone(dependencies.manifest)
      : readJson(path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json")),
    fs.readFile(path.join(baselineRunRoot, "manifest.json"), "utf-8"),
    fs.readFile(path.join(baselineRunRoot, "events.jsonl"), "utf-8"),
  ]);
  const baselineManifest = JSON.parse(baselineManifestText);
  const baselineEvents = parseJsonLines(baselineEventsText);
  const baseline = analyzeNavigationEfficiencyBaseline({
    manifest: baselineManifest,
    events: baselineEvents,
  });
  const profile = buildNavigationCandidateProfile(manifest);
  const readGitState = dependencies.readGitState ?? readWorkspaceGitState;
  const executeCandidate = dependencies.executeCandidate ?? executeNavigationCandidate;
  const before = await readGitState(workspaceRoot);
  if (before.head !== baseline.baselineCommit) {
    throw new Error(
      `Workspace HEAD ${before.head} does not match baseline commit ${baseline.baselineCommit}.`,
    );
  }
  const executed = await executeCandidate({ sourceRoot, workspaceRoot, profile });
  const after = await readGitState(workspaceRoot);
  const calls = requireArray(executed?.calls, "candidate calls");
  const candidate = {
    toolCallCount: calls.length,
    calls,
    modelVisibleResponseBytes: sum(calls.map((call) => call.responseBytes)),
    fileContentBytesExposed: sum(calls.map((call) => call.fileContentBytes)),
    irrelevantFullFileReadBytes: sum(calls
      .filter((call) => call.fullFileRead && call.relativePath !== REGRESSION_TEST_PATH)
      .map((call) => call.fileContentBytes)),
    targetLocalized: executed.targetLocalized === true,
    bugSignatureObserved: executed.bugSignatureObserved === true,
    observation: {
      regressionTestPath: REGRESSION_TEST_PATH,
      targetPath: TARGET_PATH,
      bugSignature: BUG_SIGNATURE,
    },
  };
  const security = {
    textSearchTraversalRejected: executed.textSearchTraversalRejected === true,
    fileGlobTraversalRejected: executed.fileGlobTraversalRejected === true,
    workspaceUnchanged: before.head === after.head && before.status === after.status,
    before: summarizeGitState(before),
    after: summarizeGitState(after),
  };
  const evaluation = evaluateNavigationEfficiencyCandidate({ baseline, candidate, security });
  const artifact = {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION,
    generatedAt,
    platform,
    status: evaluation.status,
    modelCalls: 0,
    providerCostUsd: 0,
    networkCalls: 0,
    hostCommandToolCalls: 0,
    source: {
      baselineRunId: baseline.runId,
      baselineTaskId: baseline.taskId,
      baselineCommit: baseline.baselineCommit,
      baselineManifestSha256: sha256(baselineManifestText),
      baselineEventsSha256: sha256(baselineEventsText),
    },
    profile,
    baseline,
    candidate,
    security,
    comparison: evaluation.comparison,
    diagnostics: evaluation.diagnostics,
  };
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(outputRoot, "navigation-efficiency.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return artifact;
}

export function parseNavigationEfficiencyCliArguments(argv) {
  const options = {};
  const supportedFlags = new Set([
    "--platform",
    "--source-root",
    "--baseline-run-root",
    "--workspace-root",
    "--output-root",
    "--generated-at",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!supportedFlags.has(flag)) {
      throw new Error(`Unknown coding benchmark navigation efficiency argument: ${String(flag)}.`);
    }
    if (options[flag] !== undefined) throw new Error(`${flag} may only be provided once.`);
    options[flag] = requireString(argv[index + 1], flag);
    index += 1;
  }
  return {
    platform: requirePlatform(options["--platform"]),
    sourceRoot: options["--source-root"] ?? defaultSourceRoot,
    baselineRunRoot: requireString(options["--baseline-run-root"], "--baseline-run-root"),
    workspaceRoot: requireString(options["--workspace-root"], "--workspace-root"),
    outputRoot: requireString(options["--output-root"], "--output-root"),
    ...(options["--generated-at"] ? { generatedAt: options["--generated-at"] } : {}),
  };
}

export async function executeNavigationCandidate(input) {
  const builtinRoot = path.join(input.sourceRoot, "packages/belldandy-skills/dist/builtin");
  const [{ fileGlobTool }, { fileReadTool }, { textSearchTool }] = await Promise.all([
    import(pathToFileURL(path.join(builtinRoot, "file-glob.js")).href),
    import(pathToFileURL(path.join(builtinRoot, "file.js")).href),
    import(pathToFileURL(path.join(builtinRoot, "text-search.js")).href),
  ]);
  const context = {
    conversationId: `navigation-efficiency-${crypto.randomUUID()}`,
    workspaceRoot: input.workspaceRoot,
    policy: {
      allowedPaths: [],
      deniedPaths: [".git", "node_modules"],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 30_000,
      maxResponseBytes: 32 * 1024,
    },
  };
  const candidateResults = [];
  candidateResults.push(await executeMeasuredTool(fileGlobTool, {
    include: [REGRESSION_TEST_PATH, "lib/**/*.js"],
    maxResults: 20,
  }, context));
  candidateResults.push(await executeMeasuredTool(fileReadTool, {
    path: REGRESSION_TEST_PATH,
  }, context));
  candidateResults.push(await executeMeasuredTool(textSearchTool, {
    query: "this.app.get('subdomain offset')",
    mode: "fixed",
    path: "lib",
    glob: "**/*.js",
    maxResults: 4,
    contextLines: 5,
  }, context));
  for (const call of candidateResults) {
    if (!call.result.success) {
      throw new Error(`${call.name} candidate call failed: ${call.result.error ?? "unknown error"}`);
    }
  }

  const globPayload = JSON.parse(candidateResults[0].result.output);
  const searchPayload = JSON.parse(candidateResults[2].result.output);
  const textSearchTraversal = await textSearchTool.execute({
    query: "subdomain",
    path: "../",
  }, context);
  const fileGlobTraversal = await fileGlobTool.execute({ path: "../" }, context);
  return {
    calls: candidateResults.map(({ result, ...call }) => ({
      ...call,
      success: result.success,
      responseBytes: Buffer.byteLength(result.output, "utf-8"),
      outputSha256: sha256(result.output),
    })),
    targetLocalized: globPayload.results?.includes(TARGET_PATH)
      && searchPayload.results?.some((match) => match.path === TARGET_PATH),
    bugSignatureObserved: searchPayload.results?.some((match) => (
      match.text === BUG_SIGNATURE
      || match.before?.some((line) => line.text.includes(BUG_SIGNATURE))
      || match.after?.some((line) => line.text.includes(BUG_SIGNATURE))
    )),
    textSearchTraversalRejected: isTraversalRejection(textSearchTraversal),
    fileGlobTraversalRejected: isTraversalRejection(fileGlobTraversal),
  };
}

async function executeMeasuredTool(tool, argumentsValue, context) {
  const result = await tool.execute(argumentsValue, context);
  let fileContentBytes = 0;
  let fullFileRead = false;
  let relativePath = null;
  if (tool.definition.name === "file_read" && result.success) {
    const payload = JSON.parse(result.output);
    fileContentBytes = normalizeNonNegativeInteger(payload.bytesRead, 0);
    fullFileRead = payload.truncated === false;
    relativePath = payload.path;
  }
  return {
    name: tool.definition.name,
    arguments: structuredClone(argumentsValue),
    fileContentBytes,
    fullFileRead,
    relativePath,
    result,
  };
}

function summarizeToolCall(tool) {
  const output = typeof tool.output === "string" ? tool.output : "";
  const fileContentBytes = tool.name === "file_read" ? extractJsonInteger(output, "bytesRead") : 0;
  return {
    name: requireString(tool.name, "baseline tool name"),
    arguments: structuredClone(tool.arguments ?? {}),
    success: tool.success === true,
    responseBytes: Buffer.byteLength(output, "utf-8"),
    fileContentBytes,
    fullFileRead: tool.name === "file_read" && extractJsonBoolean(output, "truncated") === false,
    relativePath: tool.name === "file_read" && typeof tool.arguments?.path === "string"
      ? normalizeRelativePath(tool.arguments.path)
      : null,
    outputSha256: sha256(output),
  };
}

async function readWorkspaceGitState(workspaceRoot) {
  const options = { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 };
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], options),
    execFileAsync("git", ["-C", workspaceRoot, "status", "--porcelain=v1", "--untracked-files=all"], options),
  ]);
  return { head: head.trim(), status: status.replace(/\r\n/gu, "\n").trimEnd() };
}

function summarizeGitState(value) {
  return {
    head: requireString(value?.head, "workspace Git HEAD"),
    dirty: Boolean(value?.status),
    statusSha256: sha256(value?.status ?? ""),
  };
}

function isTraversalRejection(result) {
  return result?.success === false
    && (result.failureKind === "permission_or_policy" || result.failureKind === "input_error")
    && /越界|工作区边界/u.test(result.error ?? result.output ?? "");
}

function extractJsonInteger(value, field) {
  try {
    const parsed = JSON.parse(value);
    return normalizeNonNegativeInteger(parsed?.[field], 0);
  } catch {
    const match = new RegExp(`"${field}"\\s*:\\s*(\\d+)`, "u").exec(value);
    return match ? Number(match[1]) : 0;
  }
}

function extractJsonBoolean(value, field) {
  try {
    return JSON.parse(value)?.[field];
  } catch {
    const match = new RegExp(`"${field}"\\s*:\\s*(true|false)`, "u").exec(value);
    return match ? match[1] === "true" : undefined;
  }
}

function parseJsonLines(value) {
  return value.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf-8"));
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Coding benchmark navigation efficiency ${label} must be a directory.`);
  }
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Coding benchmark navigation efficiency ${label} already exists.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  const overlaps = !leftToRight
    || (!leftToRight.startsWith(`..${path.sep}`) && !path.isAbsolute(leftToRight))
    || (!rightToLeft.startsWith(`..${path.sep}`) && !path.isAbsolute(rightToLeft));
  if (overlaps) {
    throw new Error(
      `Coding benchmark navigation efficiency ${leftLabel} and ${rightLabel} must be disjoint.`,
    );
  }
}

function reductionRatio(baseline, candidate) {
  if (!Number.isFinite(baseline) || baseline <= 0) return 0;
  return roundSix((baseline - candidate) / baseline);
}

function roundSix(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizeRelativePath(value) {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function sum(values) {
  return values.reduce((total, value) => total + normalizeNonNegativeInteger(value, 0), 0);
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Coding benchmark navigation efficiency platform must be windows-native or wsl2-linux.");
  }
  return platform;
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Coding benchmark navigation efficiency generatedAt must be an ISO timestamp.");
  }
  return timestamp;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark navigation efficiency requires ${label}.`);
  }
  return value.trim();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Coding benchmark navigation efficiency requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Coding benchmark navigation efficiency requires ${label}.`);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const artifact = await runNavigationEfficiencyProbe(
    parseNavigationEfficiencyCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-efficiency] ${artifact.platform} ${artifact.status}; response reduction=${artifact.comparison.modelVisibleResponseReductionRatio}`,
  );
  if (artifact.status !== "eligible_for_canary") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-efficiency] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
