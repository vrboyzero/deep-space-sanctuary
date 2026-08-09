import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_CANARY_VERSION =
  "coding-agent-benchmark-navigation-shadow-canary/v1";

const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const TASK_ID = "real-js.bug-fix";
const CANDIDATE_ID = "workspace-write-navigation-candidate-v1";
const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export function buildNavigationShadowCanaryPreflight(input) {
  const platform = requirePlatform(input?.platform);
  const provider = requireString(input?.provider, "provider");
  const modelId = requireString(input?.modelId, "modelId");
  const maxCostCny = requireCost(input?.maxCostCny);
  const navigationEvidence = requireObject(input?.navigationEvidence, "navigation evidence");
  if (navigationEvidence.status !== "eligible_for_canary") {
    throw new Error("Navigation evidence must be eligible_for_canary before shadow canary readiness.");
  }
  if (navigationEvidence?.profile?.id !== CANDIDATE_ID
    || navigationEvidence?.profile?.manifestModified !== false) {
    throw new Error("Navigation evidence candidate profile is not frozen and manifest-safe.");
  }
  if (navigationEvidence?.comparison?.tokenImpact?.status !== "not_measured"
    || navigationEvidence?.comparison?.tokenImpact?.reason !== "no_model_call") {
    throw new Error("Navigation evidence token impact must remain not_measured/no_model_call.");
  }
  const baselineCommit = requireSha1(input?.baselineCommit, "baselineCommit");
  const workspace = requireObject(input?.workspace, "workspace Git state");
  const workspaceHead = requireSha1(workspace.head, "workspace HEAD");
  if (workspaceHead !== baselineCommit || typeof workspace.status !== "string" || workspace.status) {
    throw new Error("Shadow canary workspace must match the baseline commit and remain clean.");
  }
  const manifestSha256 = requireSha256(input?.manifestSha256, "manifestSha256");
  return {
    status: "ready_for_authorization",
    taskId: TASK_ID,
    platform,
    candidateId: CANDIDATE_ID,
    frozen: {
      manifestModified: false,
      manifestSha256,
      baselineCommit,
    },
    authorization: {
      status: "pending_confirmation",
      provider,
      modelId,
      maxCostCny,
      credentialsRead: false,
      requiresExplicitUserConfirmation: true,
    },
    execution: {
      mode: "dry-run",
      modelCalls: 0,
      providerCostUsd: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      tokenImpact: {
        status: "not_measured",
        reason: "dry_run_no_model_call",
      },
    },
    workspace: {
      unchanged: true,
      dirty: false,
    },
    diagnostics: [],
  };
}

export async function runNavigationShadowCanaryDryRun(input, dependencies = {}) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const navigationEvidenceRoot = path.resolve(
    requireString(input?.navigationEvidenceRoot, "navigationEvidenceRoot"),
  );
  const workspaceRoot = path.resolve(requireString(input?.workspaceRoot, "workspaceRoot"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const provider = requireString(input?.provider, "provider");
  const modelId = requireString(input?.modelId, "modelId");
  const maxCostCny = requireCost(input?.maxCostCny);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  assertDisjointRoots(outputRoot, navigationEvidenceRoot, "outputRoot", "navigationEvidenceRoot");
  assertDisjointRoots(outputRoot, workspaceRoot, "outputRoot", "workspaceRoot");
  await Promise.all([
    assertDirectory(sourceRoot, "sourceRoot"),
    assertDirectory(navigationEvidenceRoot, "navigationEvidenceRoot"),
    assertDirectory(workspaceRoot, "workspaceRoot"),
    assertPathAbsent(outputRoot, "output root"),
  ]);

  const navigationPath = path.join(navigationEvidenceRoot, "navigation-efficiency.json");
  const manifestPath = path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json");
  const [navigationText, manifestText] = await Promise.all([
    fs.readFile(navigationPath, "utf-8"),
    fs.readFile(manifestPath, "utf-8"),
  ]);
  const navigationEvidence = JSON.parse(navigationText);
  const manifest = JSON.parse(manifestText);
  (dependencies.validateManifest ?? validateV3Manifest)(manifest);
  const manifestSha256 = sha256(manifestText);
  const readGitState = dependencies.readGitState ?? readWorkspaceGitState;
  const before = await readGitState(workspaceRoot);
  const preflight = buildNavigationShadowCanaryPreflight({
    platform,
    provider,
    modelId,
    maxCostCny,
    navigationEvidence,
    manifestSha256,
    workspace: before,
    baselineCommit: navigationEvidence?.source?.baselineCommit,
  });
  const after = await readGitState(workspaceRoot);
  if (before.head !== after.head || before.status !== after.status) {
    throw new Error("Shadow canary workspace changed during dry-run preflight.");
  }

  const artifact = {
    schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_CANARY_VERSION,
    generatedAt,
    ...preflight,
    source: {
      navigationEvidenceSha256: sha256(navigationText),
      baselineRunId: requireString(navigationEvidence?.source?.baselineRunId, "baselineRunId"),
      baselineTaskId: requireString(navigationEvidence?.source?.baselineTaskId, "baselineTaskId"),
      baselineCommit: requireSha1(navigationEvidence?.source?.baselineCommit, "baselineCommit"),
      manifestSha256,
    },
  };
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(outputRoot, "navigation-shadow-canary.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf-8", flag: "wx" },
  );
  return artifact;
}

export function parseNavigationShadowCanaryCliArguments(argv) {
  const options = {};
  const supportedFlags = new Set([
    "--platform",
    "--source-root",
    "--navigation-evidence-root",
    "--workspace-root",
    "--output-root",
    "--provider",
    "--model-id",
    "--max-cost-cny",
    "--generated-at",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!supportedFlags.has(flag)) {
      throw new Error(`Unknown coding benchmark navigation shadow canary argument: ${String(flag)}.`);
    }
    if (options[flag] !== undefined) throw new Error(`${flag} may only be provided once.`);
    options[flag] = requireString(argv[index + 1], flag);
    index += 1;
  }
  return {
    platform: requirePlatform(options["--platform"]),
    sourceRoot: options["--source-root"] ?? defaultSourceRoot,
    navigationEvidenceRoot: requireString(
      options["--navigation-evidence-root"],
      "--navigation-evidence-root",
    ),
    workspaceRoot: requireString(options["--workspace-root"], "--workspace-root"),
    outputRoot: requireString(options["--output-root"], "--output-root"),
    provider: requireString(options["--provider"], "--provider"),
    modelId: requireString(options["--model-id"], "--model-id"),
    maxCostCny: requireCost(options["--max-cost-cny"]),
    ...(options["--generated-at"] ? { generatedAt: options["--generated-at"] } : {}),
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

function validateV3Manifest(manifest) {
  if (manifest?.schemaVersion !== "coding-agent-benchmark-manifest/v3") {
    throw new Error("Navigation shadow canary requires the frozen v3 manifest.");
  }
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Coding benchmark navigation shadow canary ${label} must be a directory.`);
  }
}

async function assertPathAbsent(target, label) {
  const stats = await fs.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats) throw new Error(`Coding benchmark navigation shadow canary ${label} already exists.`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  const overlaps = !leftToRight
    || (!leftToRight.startsWith(`..${path.sep}`) && !path.isAbsolute(leftToRight))
    || (!rightToLeft.startsWith(`..${path.sep}`) && !path.isAbsolute(rightToLeft));
  if (overlaps) {
    throw new Error(`Coding benchmark navigation shadow canary ${leftLabel} and ${rightLabel} must be disjoint.`);
  }
}

function requirePlatform(value) {
  const platform = requireString(value, "platform");
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error("Coding benchmark navigation shadow canary platform must be windows-native or wsl2-linux.");
  }
  return platform;
}

function requireCost(value) {
  const cost = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(cost) || cost < 0 || cost > 30) {
    throw new Error("Coding benchmark navigation shadow canary maxCostCny must be between 0 and 30.");
  }
  return cost;
}

function requireIsoTimestamp(value) {
  const timestamp = requireString(value, "generatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Coding benchmark navigation shadow canary generatedAt must be an ISO timestamp.");
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

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark navigation shadow canary requires ${label}.`);
  }
  return value.trim();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Coding benchmark navigation shadow canary requires ${label}.`);
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
  const artifact = await runNavigationShadowCanaryDryRun(
    parseNavigationShadowCanaryCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[coding-agent-navigation-shadow-canary] ${artifact.platform} ${artifact.status}; authorization=${artifact.authorization.status}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-navigation-shadow-canary] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
