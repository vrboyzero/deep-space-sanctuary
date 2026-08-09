import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildNavigationCandidateV2Prompt,
  buildNavigationCandidateV2Profile,
} from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";

export const CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID =
  "workspace-write-navigation-candidate-v3";
export const CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION =
  "coding-agent-benchmark-navigation-candidate-v3/v1";

const STRATEGY_ID = "bounded-navigation-runtime-contract/v1";
const TASK_ID = "real-js.bug-fix";
const POLICY_ID = "bounded-navigation-v1";
const REGRESSION_TEST_PATH = "test/benchmark-v3/real-js-bug-fix.js";
const TARGET_PATH = "lib/request.js";
const REQUIRED_RUNTIME_SOURCE_PATHS = [
  "packages/belldandy-protocol/src/index.ts",
  "packages/belldandy-core/src/server.ts",
  "packages/belldandy-core/src/query-runtime-message-send.ts",
  "packages/belldandy-core/src/cli/commands/agent/run.ts",
  "packages/belldandy-skills/src/types.ts",
  "packages/belldandy-skills/src/executor.ts",
];
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");
const execFileAsync = promisify(execFile);
const PROMPT_HEADING = "## Runtime-Bounded Navigation Contract";
const PROMPT_CONTRACT = [
  PROMPT_HEADING,
  `Candidate: ${CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID}`,
  "",
  "Localize the defect before reading implementation files:",
  "1. Each file_glob include must be one non-empty string; use one call for test/benchmark-v3/real-js-bug-fix.js and one for lib/**/*.js.",
  "2. Read test/benchmark-v3/real-js-bug-fix.js before inspecting implementation files.",
  "3. Search source with text_search using path=lib, glob=**/*.js, maxResults=4, and contextLines=5.",
  "4. Do not read the complete lib/request.js before text_search localizes the relevant lines.",
  "5. The runtime rejects missing, array, or root-wide file_glob include values and caps maxResults at 20.",
].join("\n");

export function buildNavigationCandidateV3Profile(manifest) {
  const base = buildNavigationCandidateV2Profile(manifest);
  return {
    ...base,
    id: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
    toolArgumentPolicy: "bounded-navigation-v1",
    strategy: {
      id: STRATEGY_ID,
      enforcement: "runtime_contract",
      runtimeToolGuard: true,
    },
  };
}

export function buildNavigationCandidateV3Prompt(basePrompt) {
  if (typeof basePrompt !== "string" || !basePrompt.trim()) {
    throw new Error("Navigation candidate v3 requires a base prompt.");
  }
  const prompt = basePrompt.trimEnd();
  if (prompt.includes(PROMPT_HEADING)) {
    throw new Error("Navigation candidate v3 prompt already contains the runtime contract.");
  }
  return `${prompt}\n\n${PROMPT_CONTRACT}`;
}

export function buildNavigationCandidateV3Evidence(input) {
  const generatedAt = requireIsoTimestamp(input?.generatedAt);
  const platform = requirePlatform(input?.platform);
  const manifest = requireObject(input?.manifest, "manifest");
  const manifestText = requireText(input?.manifestText, "manifest text");
  const analysis = requireObject(input?.analysis, "analysis");
  const analysisText = requireText(input?.analysisText, "analysis text");
  const candidateV2 = requireObject(input?.candidateV2, "candidate v2 evidence");
  const candidateV2Text = requireText(input?.candidateV2Text, "candidate v2 evidence text");
  const shadowV2 = requireObject(input?.shadowV2, "shadow v2 evidence");
  const shadowV2Text = requireText(input?.shadowV2Text, "shadow v2 evidence text");
  const basePrompt = requireText(input?.basePrompt, "base prompt");
  const gitBefore = normalizeGitState(input?.gitBefore, "git before");
  const gitAfter = normalizeGitState(input?.gitAfter, "git after");
  const runtimeSourceFiles = validateRuntimeSourceFiles(input?.runtimeSourceFiles);
  const replay = validateRuntimeReplay(input?.replay);

  assertParsedTextMatches(manifest, manifestText, "manifest");
  assertParsedTextMatches(analysis, analysisText, "analysis");
  assertParsedTextMatches(candidateV2, candidateV2Text, "candidate v2 evidence");
  assertParsedTextMatches(shadowV2, shadowV2Text, "shadow v2 evidence");
  if (manifest.schemaVersion !== "coding-agent-benchmark-manifest/v3") {
    throw new Error("Navigation candidate v3 requires the frozen v3 manifest.");
  }

  const manifestSha256 = sha256(manifestText);
  const analysisSha256 = sha256(analysisText);
  const candidateV2EvidenceSha256 = sha256(candidateV2Text);
  const shadowV2ArtifactSha256 = sha256(shadowV2Text);
  const analysisPlatform = analysis.platforms?.find((item) => item?.platform === platform);
  if (analysis.schemaVersion !== "coding-agent-benchmark-navigation-shadow-v2-analysis/v1"
    || analysis.status !== "completed"
    || analysis.taskId !== TASK_ID
    || analysis.candidateId !== "workspace-write-navigation-candidate-v2"
    || analysis.decision?.status !== "do_not_promote"
    || analysis.decision?.technicalDebtDecision !== "split_task"
    || analysis.decision?.nextCandidate !== "navigation-candidate-v3-runtime-contract-required"
    || analysis.decision?.requiresNewProviderAuthorization !== true
    || analysis.execution?.mode !== "offline-analysis"
    || analysis.execution?.modelCalls !== 0
    || analysis.execution?.providerCostUsd !== 0
    || analysisPlatform?.source?.shadowArtifactSha256 !== shadowV2ArtifactSha256
    || analysisPlatform?.source?.candidateEvidenceSha256 !== candidateV2EvidenceSha256
    || analysisPlatform?.source?.manifestSha256 !== manifestSha256) {
    throw new Error("Navigation candidate v3 analysis decision or source binding drifted.");
  }
  if (candidateV2.schemaVersion !== "coding-agent-benchmark-navigation-candidate-v2/v1"
    || candidateV2.platform !== platform
    || candidateV2.status !== "eligible_for_shadow_readiness"
    || candidateV2.candidate?.id !== "workspace-write-navigation-candidate-v2"
    || candidateV2.candidate?.manifestModified !== false
    || candidateV2.source?.manifestSha256 !== manifestSha256
    || candidateV2.prompt?.basePromptSha256 !== candidateV2.source?.basePromptSha256
    || candidateV2.prompt?.renderedPromptSha256
      !== sha256(buildNavigationCandidateV2Prompt(basePrompt))) {
    throw new Error("Navigation candidate v3 candidate v2 evidence binding drifted.");
  }
  if (shadowV2.schemaVersion !== "coding-agent-benchmark-navigation-shadow-real-v2/v1"
    || shadowV2.platform !== platform
    || shadowV2.status !== "completed"
    || shadowV2.taskId !== TASK_ID
    || shadowV2.candidate?.id !== "workspace-write-navigation-candidate-v2"
    || shadowV2.candidate?.manifestModified !== false
    || shadowV2.execution?.v3AggregateEligible !== false
    || shadowV2.execution?.hostCommandToolCalls !== 0
    || shadowV2.source?.candidateEvidenceSha256 !== candidateV2EvidenceSha256
    || shadowV2.source?.manifestSha256 !== manifestSha256
    || shadowV2.source?.baselineCommit !== analysisPlatform.source?.baselineCommit
    || shadowV2.source?.repositorySnapshotIdentitySha256
      !== analysisPlatform.source?.repositorySnapshotIdentitySha256) {
    throw new Error("Navigation candidate v3 shadow v2 evidence binding drifted.");
  }

  const expectedWorkspaceHead = requireSha1(
    shadowV2.source?.candidateFixtureBaselineCommit,
    "candidate fixture baseline commit",
  );
  if (gitBefore.head !== expectedWorkspaceHead || gitAfter.head !== expectedWorkspaceHead
    || gitBefore.status || gitAfter.status) {
    throw new Error("Navigation candidate v3 workspace must remain clean at the bound fixture commit.");
  }

  const candidate = buildNavigationCandidateV3Profile(manifest);
  const renderedPrompt = buildNavigationCandidateV3Prompt(basePrompt);
  const calls = replay.calls.map((call) => structuredClone(call));
  const modelVisibleResponseBytes = sum(calls.map((call) => call.responseBytes));
  const fileContentBytesExposed = sum(calls.map((call) => call.fileContentBytes));
  const fullTargetReadCount = calls.filter((call) =>
    call.name === "file_read" && call.fullFileRead && call.relativePath === TARGET_PATH).length;

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION,
    generatedAt,
    platform,
    status: "eligible_for_shadow_readiness",
    taskId: TASK_ID,
    candidate,
    prompt: {
      strategyId: STRATEGY_ID,
      enforcement: "runtime_contract",
      runtimeToolGuard: true,
      toolArgumentPolicy: POLICY_ID,
      basePromptSha256: sha256(basePrompt),
      contractSha256: sha256(PROMPT_CONTRACT),
      renderedPromptSha256: sha256(renderedPrompt),
    },
    execution: {
      mode: "offline-runtime-replay",
      modelCalls: 0,
      providerCostUsd: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      manifestModified: false,
      v3AggregateModified: false,
    },
    runtimeContract: {
      policyId: POLICY_ID,
      runtimeToolGuard: true,
      missingIncludeBlocked: true,
      arrayIncludeBlocked: true,
      rootWideIncludeBlocked: true,
      missingMaxResultsCappedTo: replay.calls[0].effectiveMaxResults,
      oversizedMaxResultsCappedTo: replay.calls[1].effectiveMaxResults,
      policyMetadataObserved: true,
      sourceFiles: runtimeSourceFiles,
      sourceAggregateSha256: sha256(JSON.stringify(runtimeSourceFiles)),
    },
    replay: {
      toolCallCount: calls.length,
      sequence: calls.map((call) => call.name),
      calls,
      modelVisibleResponseBytes,
      fileContentBytesExposed,
      fullTargetReadCount,
      targetLocalized: true,
      bugSignatureObserved: true,
    },
    comparison: {
      candidateV2ReplayModelVisibleResponseBytes: requireNonNegativeInteger(
        candidateV2.replay?.modelVisibleResponseBytes,
        "candidate v2 replay response bytes",
      ),
      candidateV3ReplayModelVisibleResponseBytes: modelVisibleResponseBytes,
      tokenImpact: { status: "not_measured", reason: "no_model_call" },
    },
    security: {
      workspaceUnchanged: true,
      textSearchTraversalRejected: true,
      fileGlobTraversalRejected: true,
      before: summarizeGitState(gitBefore),
      after: summarizeGitState(gitAfter),
    },
    source: {
      analysisSha256,
      candidateV2EvidenceSha256,
      shadowV2ArtifactSha256,
      manifestSha256,
      baselineCommit: requireSha1(analysisPlatform.source?.baselineCommit, "baseline commit"),
      candidateFixtureBaselineCommit: expectedWorkspaceHead,
      repositorySnapshotIdentitySha256: requireSha256(
        analysisPlatform.source?.repositorySnapshotIdentitySha256,
        "repository snapshot identity",
      ),
    },
    decision: {
      status: "eligible_for_shadow_readiness",
      requiresNewProviderAuthorization: true,
      tokenUpliftClaimed: false,
    },
    diagnostics: [],
  };
}

export function parseNavigationCandidateV3CliArguments(argv) {
  const supported = new Set([
    "platform",
    "source-root",
    "analysis-root",
    "candidate-v2-root",
    "shadow-v2-root",
    "workspace-root",
    "output-root",
    "generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid navigation candidate v3 argument near ${String(flag ?? "<end>")}.`);
    }
    const name = flag.slice(2);
    if (!supported.has(name)) {
      throw new Error(`Unknown navigation candidate v3 argument: ${flag}.`);
    }
    values.set(name, value);
  }
  return {
    platform: requireText(values.get("platform"), "--platform"),
    sourceRoot: values.get("source-root") ?? defaultSourceRoot,
    analysisRoot: requireText(values.get("analysis-root"), "--analysis-root"),
    candidateV2Root: requireText(values.get("candidate-v2-root"), "--candidate-v2-root"),
    shadowV2Root: requireText(values.get("shadow-v2-root"), "--shadow-v2-root"),
    workspaceRoot: requireText(values.get("workspace-root"), "--workspace-root"),
    outputRoot: requireText(values.get("output-root"), "--output-root"),
    ...(values.has("generated-at") ? { generatedAt: values.get("generated-at") } : {}),
  };
}

export async function writeNavigationCandidateV3Artifact(outputRoot, artifact) {
  const resolved = path.resolve(requireText(outputRoot, "output root"));
  const existing = await fs.lstat(resolved).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) throw new Error("Navigation candidate v3 output root already exists.");
  await fs.mkdir(resolved);
  await fs.writeFile(
    path.join(resolved, "navigation-candidate-v3.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
}

export async function runNavigationCandidateV3Preflight(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireText(input?.sourceRoot, "source root"));
  const analysisRoot = path.resolve(requireText(input?.analysisRoot, "analysis root"));
  const candidateV2Root = path.resolve(requireText(input?.candidateV2Root, "candidate v2 root"));
  const shadowV2Root = path.resolve(requireText(input?.shadowV2Root, "shadow v2 root"));
  const workspaceRoot = path.resolve(requireText(input?.workspaceRoot, "workspace root"));
  const outputRoot = path.resolve(requireText(input?.outputRoot, "output root"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  for (const [root, label] of [
    [sourceRoot, "source root"],
    [analysisRoot, "analysis root"],
    [candidateV2Root, "candidate v2 root"],
    [shadowV2Root, "shadow v2 root"],
    [workspaceRoot, "workspace root"],
  ]) {
    await assertDirectory(root, label);
    if (root !== sourceRoot) assertDisjointRoots(outputRoot, root, "output root", label);
  }
  await assertPathAbsent(outputRoot, "output root");

  const [manifestText, analysisText, candidateV2Text, shadowV2Text, runtimeSourceFiles] = await Promise.all([
    fs.readFile(path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json"), "utf-8"),
    fs.readFile(path.join(analysisRoot, "navigation-shadow-v2-analysis.json"), "utf-8"),
    fs.readFile(path.join(candidateV2Root, "navigation-candidate-v2.json"), "utf-8"),
    fs.readFile(path.join(shadowV2Root, "navigation-shadow-real-v2.json"), "utf-8"),
    readRuntimeSourceFiles(sourceRoot),
  ]);
  const shadowV2 = JSON.parse(shadowV2Text);
  const candidateV2 = JSON.parse(candidateV2Text);
  const shadowRunId = requireText(shadowV2?.outcome?.runId, "shadow v2 run id");
  const priorPrompt = await fs.readFile(
    path.join(shadowV2Root, "execution", shadowRunId, "prompt.md"),
    "utf-8",
  );
  if (sha256(normalizePromptText(priorPrompt)) !== candidateV2.prompt?.renderedPromptSha256) {
    throw new Error("Navigation candidate v3 rendered prompt hash drifted.");
  }
  const basePrompt = recoverBasePromptFromCandidateV2(priorPrompt);
  const readGitState = dependencies.readGitState ?? readWorkspaceGitState;
  const executeReplay = dependencies.executeReplay ?? executeNavigationCandidateV3;
  const gitBefore = await readGitState(workspaceRoot);
  const replay = await executeReplay({ sourceRoot, workspaceRoot });
  const gitAfter = await readGitState(workspaceRoot);
  const artifact = buildNavigationCandidateV3Evidence({
    generatedAt,
    platform,
    manifest: JSON.parse(manifestText),
    manifestText,
    analysis: JSON.parse(analysisText),
    analysisText,
    candidateV2,
    candidateV2Text,
    shadowV2,
    shadowV2Text,
    basePrompt,
    gitBefore,
    gitAfter,
    runtimeSourceFiles,
    replay,
  });
  await writeNavigationCandidateV3Artifact(outputRoot, artifact);
  return artifact;
}

export async function executeNavigationCandidateV3(input) {
  const distRoot = path.join(input.sourceRoot, "packages/belldandy-skills/dist");
  const [{ ToolExecutor }, { fileGlobTool }, { fileReadTool }, { textSearchTool }] = await Promise.all([
    import(pathToFileURL(path.join(distRoot, "executor.js")).href),
    import(pathToFileURL(path.join(distRoot, "builtin/file-glob.js")).href),
    import(pathToFileURL(path.join(distRoot, "builtin/file.js")).href),
    import(pathToFileURL(path.join(distRoot, "builtin/text-search.js")).href),
  ]);
  const executor = new ToolExecutor({
    tools: [fileGlobTool, fileReadTool, textSearchTool],
    workspaceRoot: input.workspaceRoot,
    policy: {
      deniedPaths: [".git", "node_modules"],
      maxTimeoutMs: 30_000,
      maxResponseBytes: 32 * 1024,
    },
  });
  const conversationId = `navigation-candidate-v3-${crypto.randomUUID()}`;
  const runtimeContext = { launchSpec: { toolArgumentPolicy: POLICY_ID } };
  const requestedCalls = [
    ["file_glob", { include: REGRESSION_TEST_PATH }],
    ["file_glob", { include: "lib/**/*.js", maxResults: 200 }],
    ["file_read", { path: REGRESSION_TEST_PATH }],
    ["text_search", {
      query: "this.app.get('subdomain offset')",
      mode: "fixed",
      path: "lib",
      glob: "**/*.js",
      maxResults: 4,
      contextLines: 5,
    }],
  ];
  const calls = [];
  for (let index = 0; index < requestedCalls.length; index += 1) {
    const [name, argumentsValue] = requestedCalls[index];
    const result = await executeThroughRuntime(
      executor,
      conversationId,
      `${name}-${index + 1}`,
      name,
      argumentsValue,
      runtimeContext,
    );
    if (!result.success) {
      throw new Error(`Navigation candidate v3 ${name} replay failed: ${result.error ?? "unknown error"}`);
    }
    calls.push(summarizeRuntimeCall(name, argumentsValue, result));
  }

  const probeInputs = [
    ["missing-include", {}],
    ["array-include", { include: ["lib/**/*.js"] }],
    ["root-wide-include", { include: "**/*" }],
  ];
  const policyProbes = [];
  for (const [id, argumentsValue] of probeInputs) {
    const result = await executeThroughRuntime(
      executor,
      conversationId,
      `probe-${id}`,
      "file_glob",
      argumentsValue,
      runtimeContext,
    );
    policyProbes.push({
      id,
      arguments: structuredClone(argumentsValue),
      success: result.success,
      failureKind: result.failureKind ?? null,
      metadata: structuredClone(result.metadata ?? {}),
    });
  }

  const textSearchTraversal = await executeThroughRuntime(
    executor,
    conversationId,
    "probe-text-search-traversal",
    "text_search",
    { query: "subdomain", path: "../" },
    runtimeContext,
  );
  const fileGlobTraversal = await executeThroughRuntime(
    executor,
    conversationId,
    "probe-file-glob-traversal",
    "file_glob",
    { path: "../", include: "lib/**/*.js" },
    runtimeContext,
  );
  const testGlobPayload = JSON.parse(calls[0].rawOutput);
  const sourceGlobPayload = JSON.parse(calls[1].rawOutput);
  const searchPayload = JSON.parse(calls[3].rawOutput);
  return {
    calls: calls.map(({ rawOutput, ...call }) => call),
    policyProbes,
    targetLocalized: testGlobPayload.results?.includes(REGRESSION_TEST_PATH)
      && sourceGlobPayload.results?.includes(TARGET_PATH)
      && searchPayload.results?.some((match) => match.path === TARGET_PATH),
    bugSignatureObserved: searchPayload.results?.some((match) =>
      match.text?.includes("this.app.get('subdomain offset')")
      || match.before?.some((line) => line.text?.includes("this.app.get('subdomain offset')"))
      || match.after?.some((line) => line.text?.includes("this.app.get('subdomain offset')"))),
    textSearchTraversalRejected: isTraversalRejection(textSearchTraversal),
    fileGlobTraversalRejected: isTraversalRejection(fileGlobTraversal),
  };
}

async function executeThroughRuntime(
  executor,
  conversationId,
  id,
  name,
  argumentsValue,
  runtimeContext,
) {
  return executor.execute(
    { id, name, arguments: argumentsValue },
    conversationId,
    undefined,
    undefined,
    undefined,
    undefined,
    runtimeContext,
  );
}

function summarizeRuntimeCall(name, argumentsValue, result) {
  const output = typeof result.output === "string" ? result.output : "";
  let fileContentBytes = 0;
  let fullFileRead = false;
  let relativePath = null;
  let effectiveMaxResults;
  if (name === "file_read") {
    const payload = JSON.parse(output);
    fileContentBytes = Number.isInteger(payload.bytesRead) ? payload.bytesRead : 0;
    fullFileRead = payload.truncated === false;
    relativePath = payload.path ?? null;
  } else if (name === "file_glob") {
    const payload = JSON.parse(output);
    effectiveMaxResults = payload.limits?.maxResults;
  }
  return {
    name,
    arguments: structuredClone(argumentsValue),
    ...(effectiveMaxResults === undefined ? {} : { effectiveMaxResults }),
    success: result.success,
    responseBytes: Buffer.byteLength(output, "utf-8"),
    outputSha256: sha256(output),
    fileContentBytes,
    fullFileRead,
    relativePath,
    ...(result.metadata ? { metadata: structuredClone(result.metadata) } : {}),
    rawOutput: output,
  };
}

function recoverBasePromptFromCandidateV2(value) {
  const prompt = normalizePromptText(value);
  const marker = "\n\n## Navigation Budget Contract";
  const markerIndex = prompt.lastIndexOf(marker);
  if (markerIndex <= 0) {
    throw new Error("Navigation candidate v3 shadow v2 prompt is missing its v2 contract.");
  }
  return prompt.slice(0, markerIndex).trimEnd();
}

function normalizePromptText(value) {
  return requireText(value, "shadow v2 prompt").replace(/\r\n/gu, "\n").trimEnd();
}

async function readRuntimeSourceFiles(sourceRoot) {
  return Promise.all(REQUIRED_RUNTIME_SOURCE_PATHS.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256(await fs.readFile(path.join(sourceRoot, relativePath))),
  })));
}

async function readWorkspaceGitState(workspaceRoot) {
  const options = { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 };
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], options),
    execFileAsync("git", ["-C", workspaceRoot, "status", "--porcelain=v1", "--untracked-files=all"], options),
  ]);
  return { head: head.trim(), status: status.replace(/\r\n/gu, "\n").trimEnd() };
}

function isTraversalRejection(result) {
  return result?.success === false
    && (result.failureKind === "permission_or_policy" || result.failureKind === "input_error")
    && /越界|工作区边界/u.test(result.error ?? result.output ?? "");
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`Navigation candidate v3 ${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Navigation candidate v3 ${label} already exists.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  if (!relative || !reverse || (!relative.startsWith("..") && !path.isAbsolute(relative))
    || (!reverse.startsWith("..") && !path.isAbsolute(reverse))) {
    throw new Error(`Navigation candidate v3 ${leftLabel} must be disjoint from ${rightLabel}.`);
  }
}

function validateRuntimeReplay(value) {
  const replay = requireObject(value, "runtime replay");
  const calls = requireArray(replay.calls, "runtime replay calls");
  const expectedNames = ["file_glob", "file_glob", "file_read", "text_search"];
  const expectedArguments = [
    { include: REGRESSION_TEST_PATH },
    { include: "lib/**/*.js", maxResults: 200 },
    { path: REGRESSION_TEST_PATH },
    {
      query: "this.app.get('subdomain offset')",
      mode: "fixed",
      path: "lib",
      glob: "**/*.js",
      maxResults: 4,
      contextLines: 5,
    },
  ];
  const validCalls = calls.length === 4 && calls.every((call, index) =>
    call?.name === expectedNames[index]
    && JSON.stringify(call.arguments) === JSON.stringify(expectedArguments[index])
    && call.success === true
    && Number.isInteger(call.responseBytes) && call.responseBytes >= 0
    && Number.isInteger(call.fileContentBytes) && call.fileContentBytes >= 0
    && typeof call.fullFileRead === "boolean"
    && (call.relativePath === null || typeof call.relativePath === "string")
    && /^[a-f0-9]{64}$/u.test(call.outputSha256 ?? ""));
  const globMetadataValid = calls.slice(0, 2).every((call) =>
    call.effectiveMaxResults === 20
    && call.metadata?.repairAction === "tool_arguments_corrected"
    && call.metadata?.argumentValidation?.corrected === true
    && call.metadata?.argumentValidation?.blocked === false
    && call.metadata?.argumentValidation?.toolArgumentPolicy === POLICY_ID);
  const probes = requireArray(replay.policyProbes, "runtime policy probes");
  const expectedProbeIds = ["missing-include", "array-include", "root-wide-include"];
  const probesValid = probes.length === 3 && probes.every((probe, index) =>
    probe?.id === expectedProbeIds[index]
    && probe.success === false
    && probe.failureKind === "input_error"
    && probe.metadata?.repairAction === "tool_arguments_invalid"
    && probe.metadata?.argumentValidation?.blocked === true
    && probe.metadata?.argumentValidation?.toolArgumentPolicy === POLICY_ID);
  if (!validCalls || !globMetadataValid || !probesValid
    || replay.targetLocalized !== true
    || replay.bugSignatureObserved !== true
    || replay.textSearchTraversalRejected !== true
    || replay.fileGlobTraversalRejected !== true) {
    throw new Error("Navigation candidate v3 runtime contract replay drifted.");
  }
  const testRead = calls[2];
  if (!testRead.fullFileRead || testRead.relativePath !== REGRESSION_TEST_PATH
    || testRead.fileContentBytes <= 0
    || calls.some((call) => call.name === "file_read" && call.relativePath === TARGET_PATH)) {
    throw new Error("Navigation candidate v3 runtime contract exposed unexpected files.");
  }
  return { calls, policyProbes: probes };
}

function validateRuntimeSourceFiles(value) {
  const files = requireArray(value, "runtime source files");
  if (files.length !== REQUIRED_RUNTIME_SOURCE_PATHS.length
    || files.some((file, index) => file?.path !== REQUIRED_RUNTIME_SOURCE_PATHS[index]
      || !/^[a-f0-9]{64}$/u.test(file?.sha256 ?? ""))) {
    throw new Error("Navigation candidate v3 runtime source binding drifted.");
  }
  return files.map((file) => ({ path: file.path, sha256: file.sha256 }));
}

function assertParsedTextMatches(value, text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Navigation candidate v3 ${label} is not JSON.`);
  }
  if (JSON.stringify(parsed) !== JSON.stringify(value)) {
    throw new Error(`Navigation candidate v3 ${label} object does not match its text.`);
  }
}

function normalizeGitState(value, label) {
  const state = requireObject(value, label);
  return {
    head: requireSha1(state.head, `${label} HEAD`),
    status: typeof state.status === "string" ? state.status.replace(/\r\n/gu, "\n").trimEnd() : "",
  };
}

function summarizeGitState(value) {
  return { head: value.head, dirty: Boolean(value.status), statusSha256: sha256(value.status) };
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("Navigation candidate v3 platform must be windows-native or wsl2-linux.");
  }
  return value;
}

function requireIsoTimestamp(value) {
  const timestamp = requireText(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Navigation candidate v3 generatedAt must be an ISO timestamp.");
  }
  return timestamp;
}

function requireSha1(value, label) {
  const hash = requireText(value, label);
  if (!/^[a-f0-9]{40}$/u.test(hash)) throw new Error(`Navigation candidate v3 requires ${label}.`);
  return hash;
}

function requireSha256(value, label) {
  const hash = requireText(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error(`Navigation candidate v3 requires ${label}.`);
  return hash;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Navigation candidate v3 requires ${label}.`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation candidate v3 requires ${label}.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Navigation candidate v3 requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Navigation candidate v3 requires ${label}.`);
  return value;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function main() {
  const artifact = await runNavigationCandidateV3Preflight(
    parseNavigationCandidateV3CliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-candidate-v3] ${artifact.platform} ${artifact.status}; `
    + `responseBytes=${artifact.replay.modelVisibleResponseBytes}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === scriptPath) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-candidate-v3] failed: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  });
}
