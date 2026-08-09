import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildNavigationCandidateProfile,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
  CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION,
  executeNavigationCandidate,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";

export const CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID =
  "workspace-write-navigation-candidate-v2";
export const CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION =
  "coding-agent-benchmark-navigation-candidate-v2/v1";

const TASK_ID = "real-js.bug-fix";
const STRATEGY_ID = "bounded-localize-before-read/v1";
const NAVIGATION_SHADOW_ANALYSIS_VERSION =
  "coding-agent-benchmark-navigation-shadow-analysis/v1";
const NAVIGATION_SHADOW_REAL_VERSION =
  "coding-agent-benchmark-navigation-shadow-real/v1";
const REGRESSION_TEST_PATH = "test/benchmark-v3/real-js-bug-fix.js";
const TARGET_PATH = "lib/request.js";
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const PROMPT_HEADING = "## Navigation Budget Contract";
const PROMPT_CONTRACT = [
  PROMPT_HEADING,
  "Candidate: workspace-write-navigation-candidate-v2",
  "",
  "For this shadow candidate, localize the defect before reading source files:",
  `1. Locate the regression test and JavaScript source candidates with file_glob; include ${REGRESSION_TEST_PATH} and lib/**/*.js.`,
  `2. Read ${REGRESSION_TEST_PATH} before inspecting implementation files.`,
  "3. Search source only with text_search using path=lib, glob=**/*.js, maxResults=4, and contextLines=5.",
  `4. Do not read the complete ${TARGET_PATH} before text_search localizes the relevant lines.`,
  "5. Avoid repeated complete-file reads; use the localized context before editing.",
].join("\n");
const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function buildNavigationCandidateV2Profile(manifest) {
  const base = buildNavigationCandidateProfile(manifest);
  return {
    ...base,
    id: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
    strategy: {
      id: STRATEGY_ID,
      enforcement: "prompt_contract",
      runtimeToolGuard: false,
    },
  };
}

export function buildNavigationCandidateV2Prompt(basePrompt) {
  const prompt = requireText(basePrompt, "base prompt").trimEnd();
  if (prompt.includes(PROMPT_HEADING)) {
    throw new Error("Navigation candidate v2 prompt already contains the navigation contract.");
  }
  return `${prompt}\n\n${PROMPT_CONTRACT}`;
}

export function buildNavigationCandidateV2Evidence(input) {
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const platform = requirePlatform(input?.platform);
  const manifest = requireObject(input?.manifest, "manifest");
  const manifestText = requireText(input?.manifestText, "manifestText");
  const analysis = requireObject(input?.analysis, "analysis");
  const analysisText = requireText(input?.analysisText, "analysisText");
  const shadow = requireObject(input?.shadowArtifact, "shadowArtifact");
  const shadowText = requireText(input?.shadowArtifactText, "shadowArtifactText");
  const navigation = requireObject(input?.navigationEvidence, "navigationEvidence");
  const navigationText = requireText(input?.navigationEvidenceText, "navigationEvidenceText");
  const basePrompt = requireText(input?.basePrompt, "basePrompt");
  const gitBefore = normalizeGitState(input?.gitBefore, "gitBefore");
  const gitAfter = normalizeGitState(input?.gitAfter, "gitAfter");
  const replay = validateBoundedReplay(input?.replay);
  const manifestSha256 = sha256(manifestText);
  const analysisSha256 = sha256(analysisText);
  const shadowArtifactSha256 = sha256(shadowText);
  const navigationEvidenceSha256 = sha256(navigationText);

  assertParsedTextMatches(manifest, manifestText, "manifest");
  validateManifest(manifest);
  validatePriorEvidence({
    platform,
    analysis,
    shadow,
    navigation,
    manifestSha256,
    shadowArtifactSha256,
    navigationEvidenceSha256,
  });
  assertParsedTextMatches(analysis, analysisText, "analysis");
  assertParsedTextMatches(shadow, shadowText, "shadow artifact");
  assertParsedTextMatches(navigation, navigationText, "navigation evidence");
  const candidate = buildNavigationCandidateV2Profile(manifest);
  const prompt = buildNavigationCandidateV2Prompt(basePrompt);
  const expectedWorkspaceHead = requireSha1(
    shadow?.source?.candidateFixtureBaselineCommit,
    "candidate fixture baseline commit",
  );
  if (gitBefore.head !== expectedWorkspaceHead || gitAfter.head !== expectedWorkspaceHead
    || gitBefore.status || gitAfter.status) {
    throw new Error("Navigation candidate v2 workspace must remain clean at the bound fixture commit.");
  }

  const calls = replay.calls.map((call) => structuredClone(call));
  const modelVisibleResponseBytes = sum(calls.map((call) => call.responseBytes));
  const fileContentBytesExposed = sum(calls.map((call) => call.fileContentBytes));
  const fullTargetReadCount = calls.filter((call) =>
    call.name === "file_read" && call.fullFileRead && call.relativePath === TARGET_PATH).length;
  const platformAnalysis = requireObject(
    analysis.platforms.find((item) => item?.platform === platform),
    "analysis platform evidence",
  );

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION,
    generatedAt,
    platform,
    status: "eligible_for_shadow_readiness",
    taskId: TASK_ID,
    candidate,
    prompt: {
      strategyId: STRATEGY_ID,
      enforcement: "prompt_contract",
      runtimeToolGuard: false,
      basePromptSha256: sha256(basePrompt),
      contractSha256: sha256(PROMPT_CONTRACT),
      renderedPromptSha256: sha256(prompt),
    },
    execution: {
      mode: "offline-replay",
      modelCalls: 0,
      providerCostUsd: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      manifestModified: false,
      v3AggregateModified: false,
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
      baselineModelVisibleResponseBytes: requireNonNegativeInteger(
        analysis?.baseline?.modelVisibleResponseBytes
          ?? navigation?.baseline?.modelVisibleResponseBytes,
        "analysis baseline modelVisibleResponseBytes",
      ),
      candidateV1ActualModelVisibleResponseBytes: requireNonNegativeInteger(
        platformAnalysis?.tools?.modelVisibleResponseBytes,
        "candidate v1 actual modelVisibleResponseBytes",
      ),
      candidateV2ReplayModelVisibleResponseBytes: modelVisibleResponseBytes,
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
      shadowArtifactSha256,
      navigationEvidenceSha256,
      manifestSha256,
      basePromptSha256: sha256(basePrompt),
      baselineCommit: requireSha1(
        shadow?.source?.baselineCommit ?? platformAnalysis?.source?.baselineCommit,
        "baseline commit",
      ),
      candidateFixtureBaselineCommit: expectedWorkspaceHead,
      repositorySnapshotIdentitySha256: requireSha256(
        shadow?.source?.repositorySnapshotIdentitySha256,
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

export async function runNavigationCandidateV2Preflight(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const analysisRoot = path.resolve(requireString(input?.analysisRoot, "analysisRoot"));
  const shadowRoot = path.resolve(requireString(input?.shadowRoot, "shadowRoot"));
  const navigationRoot = path.resolve(requireString(input?.navigationRoot, "navigationRoot"));
  const workspaceRoot = path.resolve(requireString(input?.workspaceRoot, "workspaceRoot"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  for (const [root, label] of [
    [sourceRoot, "sourceRoot"],
    [analysisRoot, "analysisRoot"],
    [shadowRoot, "shadowRoot"],
    [navigationRoot, "navigationRoot"],
    [workspaceRoot, "workspaceRoot"],
  ]) {
    await assertDirectory(root, label);
    if (label !== "sourceRoot") {
      assertDisjointRoots(outputRoot, root, "outputRoot", label);
    }
  }
  await assertPathAbsent(outputRoot, "output root");

  const shadowArtifactText = await fs.readFile(
    path.join(shadowRoot, "navigation-shadow-real.json"),
    "utf-8",
  );
  const shadowArtifact = JSON.parse(shadowArtifactText);
  const runId = requireString(shadowArtifact?.outcome?.runId, "shadow runId");
  const [manifestText, analysisText, navigationEvidenceText, basePrompt] = await Promise.all([
    fs.readFile(path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json"), "utf-8"),
    fs.readFile(path.join(analysisRoot, "navigation-shadow-analysis.json"), "utf-8"),
    fs.readFile(path.join(navigationRoot, "navigation-efficiency.json"), "utf-8"),
    fs.readFile(path.join(shadowRoot, "execution", runId, "prompt.md"), "utf-8"),
  ]);
  const readGitState = dependencies.readGitState ?? readWorkspaceGitState;
  const executeReplay = dependencies.executeReplay ?? executeNavigationCandidate;
  const gitBefore = await readGitState(workspaceRoot);
  const replay = await executeReplay({ sourceRoot, workspaceRoot });
  const gitAfter = await readGitState(workspaceRoot);
  const artifact = buildNavigationCandidateV2Evidence({
    generatedAt,
    platform,
    manifest: JSON.parse(manifestText),
    manifestText,
    analysis: JSON.parse(analysisText),
    analysisText,
    shadowArtifact,
    shadowArtifactText,
    navigationEvidence: JSON.parse(navigationEvidenceText),
    navigationEvidenceText,
    basePrompt,
    gitBefore,
    gitAfter,
    replay,
  });
  await writeNavigationCandidateV2Artifact(outputRoot, artifact);
  return artifact;
}

export function parseNavigationCandidateV2CliArguments(argv) {
  const supported = new Set([
    "platform",
    "source-root",
    "analysis-root",
    "shadow-root",
    "navigation-root",
    "workspace-root",
    "output-root",
    "generated-at",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid navigation candidate v2 argument near ${String(flag ?? "<end>")}.`);
    }
    const name = flag.slice(2);
    if (!supported.has(name)) throw new Error(`Unknown navigation candidate v2 argument: ${flag}.`);
    if (values.has(name)) throw new Error(`${flag} may only be provided once.`);
    values.set(name, value);
  }
  return {
    platform: requirePlatform(values.get("platform")),
    sourceRoot: values.get("source-root") ?? defaultSourceRoot,
    analysisRoot: requireString(values.get("analysis-root"), "--analysis-root"),
    shadowRoot: requireString(values.get("shadow-root"), "--shadow-root"),
    navigationRoot: requireString(values.get("navigation-root"), "--navigation-root"),
    workspaceRoot: requireString(values.get("workspace-root"), "--workspace-root"),
    outputRoot: requireString(values.get("output-root"), "--output-root"),
    ...(values.has("generated-at")
      ? { generatedAt: requireIsoTimestamp(values.get("generated-at")) }
      : {}),
  };
}

export async function writeNavigationCandidateV2Artifact(outputRoot, artifact) {
  const resolved = path.resolve(requireString(outputRoot, "outputRoot"));
  await assertPathAbsent(resolved, "output root");
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.mkdir(resolved);
  await fs.writeFile(
    path.join(resolved, "navigation-candidate-v2.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== "coding-agent-benchmark-manifest/v3") {
    throw new Error("Navigation candidate v2 requires the frozen v3 manifest.");
  }
}

function validatePriorEvidence(input) {
  const { platform, analysis, shadow, navigation } = input;
  if (analysis.schemaVersion !== NAVIGATION_SHADOW_ANALYSIS_VERSION
    || analysis.status !== "completed"
    || analysis.candidateId !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || analysis.decision?.status !== "do_not_promote"
    || analysis.decision?.nextCandidate !== "navigation-candidate-v2-required"
    || analysis.decision?.requiresNewProviderAuthorization !== true) {
    throw new Error("Navigation candidate v2 analysis decision does not authorize offline v2 preflight.");
  }
  const analysisPlatform = analysis.platforms?.find((item) => item?.platform === platform);
  if (!analysisPlatform
    || analysisPlatform.source?.shadowArtifactSha256 !== input.shadowArtifactSha256
    || analysisPlatform.source?.navigationEvidenceSha256 !== input.navigationEvidenceSha256
    || analysisPlatform.source?.manifestSha256 !== input.manifestSha256) {
    throw new Error("Navigation candidate v2 analysis source binding drifted.");
  }
  if (shadow.schemaVersion !== NAVIGATION_SHADOW_REAL_VERSION
    || shadow.status !== "completed"
    || shadow.taskId !== TASK_ID
    || shadow.platform !== platform
    || shadow.candidate?.id !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || shadow.candidate?.manifestModified !== false
    || shadow.execution?.v3AggregateEligible !== false
    || shadow.execution?.hostCommandToolCalls !== 0
    || shadow.source?.navigationEvidenceSha256 !== input.navigationEvidenceSha256
    || shadow.source?.manifestSha256 !== input.manifestSha256
    || (shadow.source?.baselineCommit !== undefined
      && shadow.source?.baselineCommit !== analysisPlatform.source?.baselineCommit)
    || shadow.source?.repositorySnapshotIdentitySha256
      !== analysisPlatform.source?.repositorySnapshotIdentitySha256) {
    throw new Error("Navigation candidate v2 shadow evidence binding drifted.");
  }
  if (navigation.schemaVersion !== CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION
    || navigation.platform !== platform
    || navigation.status !== "eligible_for_canary"
    || navigation.profile?.id !== CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID
    || navigation.profile?.manifestModified !== false
    || navigation.candidate?.toolCallCount !== 3
    || navigation.comparison?.tokenImpact?.status !== "not_measured") {
    throw new Error("Navigation candidate v2 offline navigation evidence drifted.");
  }
}

function validateBoundedReplay(value) {
  const replay = requireObject(value, "replay");
  const calls = requireArray(replay.calls, "replay calls");
  const expectedArguments = [
    {
      include: [REGRESSION_TEST_PATH, "lib/**/*.js"],
      maxResults: 20,
    },
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
  const expectedNames = ["file_glob", "file_read", "text_search"];
  const validRoute = calls.length === expectedNames.length && calls.every((call, index) =>
    call?.name === expectedNames[index]
    && JSON.stringify(call.arguments) === JSON.stringify(expectedArguments[index])
    && call.success === true
    && Number.isInteger(call.responseBytes) && call.responseBytes >= 0
    && Number.isInteger(call.fileContentBytes) && call.fileContentBytes >= 0
    && typeof call.fullFileRead === "boolean"
    && (call.relativePath === null || typeof call.relativePath === "string")
    && /^[a-f0-9]{64}$/u.test(call.outputSha256 ?? ""));
  if (!validRoute
    || replay.targetLocalized !== true
    || replay.bugSignatureObserved !== true
    || replay.textSearchTraversalRejected !== true
    || replay.fileGlobTraversalRejected !== true) {
    throw new Error("Navigation candidate v2 bounded navigation route drifted.");
  }
  const fileRead = calls[1];
  if (!fileRead.fullFileRead || fileRead.relativePath !== REGRESSION_TEST_PATH
    || fileRead.fileContentBytes <= 0
    || calls.some((call) => call.name === "file_read" && call.relativePath === TARGET_PATH)) {
    throw new Error("Navigation candidate v2 bounded navigation route exposed unexpected files.");
  }
  return { calls };
}

function assertParsedTextMatches(value, text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Navigation candidate v2 ${label} text is not JSON.`);
  }
  if (JSON.stringify(parsed) !== JSON.stringify(value)) {
    throw new Error(`Navigation candidate v2 ${label} object does not match its text.`);
  }
}

async function readWorkspaceGitState(workspaceRoot) {
  const options = { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 };
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "HEAD"], options),
    execFileAsync("git", ["-C", workspaceRoot, "status", "--porcelain=v1", "--untracked-files=all"], options),
  ]);
  return { head: head.trim(), status: status.replace(/\r\n/gu, "\n").trimEnd() };
}

function normalizeGitState(value, label) {
  const state = requireObject(value, label);
  return {
    head: requireSha1(state.head, `${label} head`),
    status: typeof state.status === "string" ? state.status.replace(/\r\n/gu, "\n").trimEnd() : "",
  };
}

function summarizeGitState(value) {
  return {
    head: value.head,
    dirty: Boolean(value.status),
    statusSha256: sha256(value.status),
  };
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`Navigation candidate v2 ${label} must be a directory.`);
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Navigation candidate v2 ${label} already exists.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  if (!relative || !reverse || (!relative.startsWith("..") && !path.isAbsolute(relative))
    || (!reverse.startsWith("..") && !path.isAbsolute(reverse))) {
    throw new Error(`Navigation candidate v2 ${leftLabel} must be disjoint from ${rightLabel}.`);
  }
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Navigation candidate v2 platform must be windows-native or wsl2-linux.");
  }
  return platform;
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Navigation candidate v2 generatedAt must be an ISO timestamp.");
  }
  return timestamp;
}

function requireSha1(value, label) {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{40}$/u.test(hash)) throw new Error(`${label} must be a SHA-1.`);
  return hash;
}

function requireSha256(value, label) {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error(`${label} must be a SHA-256.`);
  return hash;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation candidate v2 requires ${label}.`);
  }
  return value.trim();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Navigation candidate v2 requires ${label}.`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Navigation candidate v2 requires ${label}.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Navigation candidate v2 requires ${label}.`);
  return value;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const artifact = await runNavigationCandidateV2Preflight(
    parseNavigationCandidateV2CliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-candidate-v2] ${artifact.platform} ${artifact.status}; `
    + `responseBytes=${artifact.replay.modelVisibleResponseBytes}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-candidate-v2] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
