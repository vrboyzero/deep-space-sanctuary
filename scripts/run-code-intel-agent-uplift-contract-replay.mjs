import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ReActRunBudgetTracker } from "../packages/belldandy-agent/src/react-run-budget.ts";
import { hashCanonicalText } from "./coding-agent-benchmark-contract.mjs";

export const CODE_INTEL_AGENT_UPLIFT_CONTRACT_REPLAY_VERSION =
  "code-intel-agent-uplift-contract-replay/v1";

const CANDIDATE_ID = "code-intel-semantic-live-v1";
const SOURCE_GATE_FAILURES = [
  "binary_outcome_regression",
  "semantic_adoption_below_gate",
];
const SUPPORTED_PLATFORMS = new Set(["windows-native", "wsl2-linux"]);
const RUNTIME_SOURCE_PATHS = [
  "scripts/run-code-intel-agent-uplift-contract-replay.mjs",
  "scripts/run-code-intel-agent-uplift.mjs",
  "packages/belldandy-agent/src/react-run-budget.ts",
  "packages/belldandy-skills/src/builtin/code-intel.ts",
  "packages/belldandy-skills/src/code-intel/typescript-provider.ts",
];
const scriptPath = fileURLToPath(import.meta.url);
const defaultSourceRoot = path.resolve(path.dirname(scriptPath), "..");

export async function runCodeIntelCandidateContractReplay(input) {
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const upliftReportPath = path.resolve(requireString(
    input?.upliftReportPath,
    "upliftReportPath",
  ));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));
  const expectedUpliftReportSha256 = requireSha256(
    input?.expectedUpliftReportSha256,
    "expectedUpliftReportSha256",
  );
  const [upliftReportText, runtimeSources] = await Promise.all([
    fs.readFile(upliftReportPath, "utf8"),
    Promise.all(RUNTIME_SOURCE_PATHS.map(async (relativePath) => ({
      path: relativePath,
      sha256: hashCanonicalText(await fs.readFile(path.join(sourceRoot, relativePath), "utf-8")),
    }))),
  ]);
  const actualUpliftReportSha256 = sha256(upliftReportText);
  if (actualUpliftReportSha256 !== expectedUpliftReportSha256) {
    throw new Error("uplift report SHA-256 does not match the expected digest.");
  }
  const artifact = buildCodeIntelCandidateContractReplayArtifact({
    platform: input?.platform,
    generatedAt: input?.generatedAt,
    upliftReport: JSON.parse(upliftReportText),
    upliftReportText,
    runtimeSources,
  });

  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  try {
    await fs.mkdir(outputRoot);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`output root already exists: ${outputRoot}`);
    }
    throw error;
  }
  await fs.writeFile(
    path.join(outputRoot, "candidate-contract-replay.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return artifact;
}

export function parseCodeIntelCandidateContractReplayCliArguments(argv) {
  const values = new Map();
  const supported = new Set([
    "--platform",
    "--source-root",
    "--uplift-report",
    "--expected-uplift-report-sha256",
    "--output-root",
    "--generated-at",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!supported.has(flag) || !value || value.startsWith("--") || values.has(flag)) {
      throw new Error(`Invalid CodeIntel candidate contract replay argument near ${String(flag)}.`);
    }
    values.set(flag, value);
  }
  return {
    platform: requireString(values.get("--platform"), "--platform"),
    sourceRoot: path.resolve(values.get("--source-root") ?? defaultSourceRoot),
    upliftReportPath: path.resolve(requireString(values.get("--uplift-report"), "--uplift-report")),
    expectedUpliftReportSha256: requireSha256(
      values.get("--expected-uplift-report-sha256"),
      "--expected-uplift-report-sha256",
    ),
    outputRoot: path.resolve(requireString(values.get("--output-root"), "--output-root")),
    ...(values.has("--generated-at") ? { generatedAt: values.get("--generated-at") } : {}),
  };
}

export function buildCodeIntelCandidateContractReplayArtifact(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const upliftReport = validateUpliftReport(input?.upliftReport);
  const upliftReportText = requireText(input?.upliftReportText, "upliftReportText");
  const runtimeSources = validateRuntimeSources(input?.runtimeSources);
  const observedOutcomes = upliftReport.pairs.map((pair) =>
    evaluateCodeIntelCandidateToolOutcome({
      scenarioId: requireString(pair?.pairId, "pair.pairId"),
      ...requireObject(pair?.candidate, "pair.candidate"),
    }));
  const observedCoverage = {
    candidateCount: observedOutcomes.length,
    toolNotInvokedCount: observedOutcomes.filter((item) => !item.observations.toolInvoked).length,
    toolFailedCount: observedOutcomes.filter((item) => item.observations.toolFailed).length,
    toolSucceededWithoutMutationCount: observedOutcomes.filter((item) =>
      item.observations.semanticLiveSucceeded && !item.observations.mutationObserved).length,
    budgetExhaustedCount: observedOutcomes.filter((item) => item.observations.budgetExhausted).length,
  };
  observedCoverage.allRequiredOutcomesCovered = [
    observedCoverage.toolNotInvokedCount,
    observedCoverage.toolFailedCount,
    observedCoverage.toolSucceededWithoutMutationCount,
    observedCoverage.budgetExhaustedCount,
  ].every((count) => count > 0);

  return {
    schemaVersion: CODE_INTEL_AGENT_UPLIFT_CONTRACT_REPLAY_VERSION,
    generatedAt,
    status: "completed",
    platform,
    candidateId: CANDIDATE_ID,
    contract: {
      id: "code-intel-candidate-tool-contract-v1",
      requiredTool: "code_intel",
      requiredCapability: "semantic-live",
      mutationEvidence: "contextWaste.firstMutationTool",
      terminalEvidence: "provider.terminalErrorCode",
      budgetOwner: "ReActRunBudgetTracker",
    },
    source: {
      upliftReportSha256: sha256(upliftReportText),
      upliftReportStatus: upliftReport.status,
      attempt: upliftReport.attempt,
      gateFailures: [...upliftReport.gate.failures],
      runtimeSources,
    },
    observedCoverage,
    observedOutcomes,
    fixtures: replayCodeIntelCandidateContractFixtures(),
    decision: {
      status: "blocked",
      taskUplift: "not_measured",
      candidatePromotionEligible: false,
      newAttemptEligible: false,
      nextAction: "fix_candidate_tool_and_budget_contract",
    },
    execution: {
      mode: "offline-replay",
      gatewayCalls: 0,
      modelCalls: 0,
      providerCalls: 0,
      providerCostCny: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      workspaceMutations: 0,
      credentialsRead: false,
      upliftReportModified: false,
    },
    diagnostics: [],
  };
}

export function replayCandidateBudgetTermination() {
  const maxTotalTokens = 24_000;
  const tracker = new ReActRunBudgetTracker({
    maxTotalTokens,
    maxHighRiskToolCalls: 4,
  });
  const termination = tracker.recordModelUsage({
    providerUsageAvailable: true,
    inputTokens: 23_000,
    outputTokens: 1_001,
  });
  if (!termination || termination.budget !== "total_tokens") {
    throw new Error("Candidate budget replay did not exhaust the ordinary token budget.");
  }
  return {
    policyEnabled: false,
    maxTotalTokens,
    recordedTokens: tracker.totalTokens,
    termination: { ...termination },
    providerDispatchAllowedAfterTermination: false,
    taskUplift: "not_measured",
  };
}

export function replayCodeIntelCandidateContractFixtures() {
  const fixtures = [
    {
      scenarioId: "tool-not-invoked",
      semantic: { successfulCallCount: 0, failedCallCount: 0, capabilities: [] },
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    },
    {
      scenarioId: "tool-failed",
      semantic: { successfulCallCount: 0, failedCallCount: 1, capabilities: [] },
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    },
    {
      scenarioId: "tool-succeeded-without-mutation",
      semantic: {
        successfulCallCount: 1,
        failedCallCount: 0,
        capabilities: ["semantic-live"],
      },
      contextWaste: { firstMutationTool: null },
      provider: { terminalErrorCode: null },
    },
    {
      scenarioId: "budget-exhausted",
      semantic: {
        successfulCallCount: 1,
        failedCallCount: 0,
        capabilities: ["semantic-live"],
      },
      contextWaste: { firstMutationTool: "file_edit" },
      provider: { terminalErrorCode: "budget_exhausted" },
    },
  ];
  const budgetReplay = replayCandidateBudgetTermination();
  return fixtures.map((fixture) => ({
    scenarioId: fixture.scenarioId,
    input: structuredClone(fixture),
    outcome: evaluateCodeIntelCandidateToolOutcome(fixture),
    ...(fixture.scenarioId === "budget-exhausted" ? { budgetReplay } : {}),
  }));
}

export function evaluateCodeIntelCandidateToolOutcome(input) {
  const scenarioId = requireString(input?.scenarioId, "scenarioId");
  const semantic = requireObject(input?.semantic, "semantic");
  const contextWaste = requireObject(input?.contextWaste, "contextWaste");
  const provider = requireObject(input?.provider, "provider");
  const successfulCallCount = requireNonNegativeInteger(
    semantic.successfulCallCount,
    "semantic.successfulCallCount",
  );
  const failedCallCount = requireNonNegativeInteger(
    semantic.failedCallCount,
    "semantic.failedCallCount",
  );
  const capabilities = requireArray(semantic.capabilities, "semantic.capabilities");
  const toolInvoked = successfulCallCount + failedCallCount > 0;
  const budgetExhausted = provider.terminalErrorCode === "budget_exhausted";

  if (budgetExhausted) {
    return {
      scenarioId,
      observations: {
        toolInvoked,
        semanticLiveSucceeded: capabilities.includes("semantic-live"),
        toolFailed: failedCallCount > 0,
        mutationObserved: contextWaste.firstMutationTool !== null,
        budgetExhausted: true,
      },
      decision: {
        status: "blocked",
        primaryReason: "budget_exhausted",
        taskUplift: "not_measured",
        nextAction: "terminate_without_task_uplift_claim",
        newAttemptEligible: false,
      },
    };
  }

  if (!toolInvoked) {
    return {
      scenarioId,
      observations: {
        toolInvoked: false,
        semanticLiveSucceeded: false,
        toolFailed: false,
        mutationObserved: contextWaste.firstMutationTool !== null,
        budgetExhausted,
      },
      decision: {
        status: "blocked",
        primaryReason: "tool_not_invoked",
        taskUplift: "not_measured",
        nextAction: "require_semantic_tool_adoption",
        newAttemptEligible: false,
      },
    };
  }

  if (successfulCallCount === 0 && failedCallCount > 0) {
    return {
      scenarioId,
      observations: {
        toolInvoked: true,
        semanticLiveSucceeded: false,
        toolFailed: true,
        mutationObserved: contextWaste.firstMutationTool !== null,
        budgetExhausted,
      },
      decision: {
        status: "blocked",
        primaryReason: "tool_failed",
        taskUplift: "not_measured",
        nextAction: "diagnose_semantic_tool_failure",
        newAttemptEligible: false,
      },
    };
  }

  if (successfulCallCount > 0 && contextWaste.firstMutationTool === null) {
    return {
      scenarioId,
      observations: {
        toolInvoked: true,
        semanticLiveSucceeded: capabilities.includes("semantic-live"),
        toolFailed: failedCallCount > 0,
        mutationObserved: false,
        budgetExhausted,
      },
      decision: {
        status: "blocked",
        primaryReason: "tool_succeeded_without_mutation",
        taskUplift: "not_measured",
        nextAction: "require_post_tool_progress_or_safe_diagnosis",
        newAttemptEligible: false,
      },
    };
  }

  throw new Error("CodeIntel candidate/tool outcome is not implemented for invoked tools.");
}

function validateUpliftReport(value) {
  const report = requireObject(value, "upliftReport");
  const gate = requireObject(report.gate, "upliftReport.gate");
  const failures = requireArray(gate.failures, "upliftReport.gate.failures");
  const pairs = requireArray(report.pairs, "upliftReport.pairs");
  if (report.schemaVersion !== "code-intel-agent-uplift-report/v1"
    || report.status !== "blocked"
    || report.candidateId !== CANDIDATE_ID
    || !Number.isInteger(report.attempt)
    || report.attempt < 1) {
    throw new Error("CodeIntel uplift source report identity is invalid.");
  }
  if (gate.pairCount !== 8 || pairs.length !== 8) {
    throw new Error("CodeIntel uplift source report must contain eight pairs.");
  }
  if (JSON.stringify(failures) !== JSON.stringify(SOURCE_GATE_FAILURES)) {
    throw new Error("CodeIntel uplift source report failures drifted from the a8 Gate.");
  }
  return report;
}

function validateRuntimeSources(value) {
  const sources = requireArray(value, "runtimeSources");
  if (sources.length !== RUNTIME_SOURCE_PATHS.length) {
    throw new Error("runtimeSources must contain all contract files.");
  }
  return RUNTIME_SOURCE_PATHS.map((expectedPath, index) => {
    const source = requireObject(sources[index], `runtimeSources[${index}]`);
    if (source.path !== expectedPath) {
      throw new Error(`runtime source path drifted at index ${index}.`);
    }
    return { path: source.path, sha256: requireSha256(source.sha256, `${source.path} SHA-256`) };
  });
}

function requirePlatform(value) {
  if (!SUPPORTED_PLATFORMS.has(value)) {
    throw new Error("platform must be windows-native or wsl2-linux.");
  }
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new Error("generatedAt must be an ISO timestamp.");
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a string.`);
  return value.trim();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

async function main() {
  const artifact = await runCodeIntelCandidateContractReplay(
    parseCodeIntelCandidateContractReplayCliArguments(process.argv.slice(2)),
  );
  console.log(
    `[code-intel-agent-uplift-contract-replay] ${artifact.platform} ${artifact.status}; fixtures=${artifact.fixtures.length}; providerCalls=${artifact.execution.providerCalls}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(
      `[code-intel-agent-uplift-contract-replay] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
