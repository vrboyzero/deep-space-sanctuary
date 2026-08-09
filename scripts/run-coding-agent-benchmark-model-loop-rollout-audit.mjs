import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODEL_LOOP_COST_CONTAINMENT_LIMITS,
  MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
  ReActRunBudgetTracker,
} from "../packages/belldandy-agent/dist/react-run-budget.js";
import { ConversationSteerMailbox } from "../packages/belldandy-core/dist/coding-run/conversation-steer-mailbox.js";
import {
  createGatewayConversationEventAdapter,
} from "../packages/belldandy-core/dist/coding-run/gateway-conversation-event-adapter.js";

export const CODING_AGENT_BENCHMARK_MODEL_LOOP_ROLLOUT_AUDIT_VERSION =
  "coding-agent-benchmark-model-loop-rollout-audit/v1";

const P0_28_VERSION = "coding-agent-benchmark-model-loop-budget-termination/v1";
const P0_28_SHA256 = Object.freeze({
  "windows-native": "c31bc494f46fbf8c9bcbb3678dfbb152e2670f566ee58e911675951f0e74b4df",
  "wsl2-linux": "5404052627a007793679b15831ddda0a48e6cabb55ca15adb62010c6d7dd1724",
});
const P0_27_ANALYSIS_SHA256 = "cb3b746701c931a2d21b60f4dd0c74e4d2eb45cb120ed7b557815cf89df1d7cf";
const FROZEN_AGGREGATE_SHA256 = "f008259be7068ed53e27202b1f9b21c7649ebe7e410b4468cafc75db3f12a994";
const PLATFORMS = ["windows-native", "wsl2-linux"];
const RUNTIME_SOURCE_CONTRACTS = Object.freeze([
  {
    sourcePath: "packages/belldandy-agent/src/react-run-budget.ts",
    anchors: [
      "minimumOutputTokenReserve: 1_024",
      "checkModelCallPreflight(",
      "insufficient_remaining_tokens",
      "reserveToolCall(",
    ],
  },
  {
    sourcePath: "packages/belldandy-agent/src/index.ts",
    anchors: ["export interface AgentRunSteeringMailbox", "peekPending(): AgentRunSteerCommand[]"],
  },
  {
    sourcePath: "packages/belldandy-agent/src/tool-agent.ts",
    anchors: [
      "const runBudget = new ReActRunBudgetTracker({",
      "input.steering.peekPending()",
      "runBudget.reserveModelCall({",
      "input.steering.consumePending({ modelCallIndex: nextModelCallIndex })",
      "const minimumRepairCost = calculateUsageCostUsd({",
      "runBudget.checkModelCallPreflight({",
      "runBudget.reserveToolCall(request.name)",
    ],
  },
  {
    sourcePath: "packages/belldandy-core/src/coding-run/conversation-steer-mailbox.ts",
    anchors: ["peekPending(): AgentRunSteerCommand[]", "command.status = \"delivered\"", "close(error: string)"],
  },
  {
    sourcePath: "packages/belldandy-core/src/coding-run/gateway-conversation-event-adapter.ts",
    anchors: [
      "event === \"agent.budget_exhausted\"",
      "emit(\"run.budget_exhausted\"",
      "return emit(\"run.failed\"",
      "return emit(\"run.completed\"",
    ],
  },
]);
const RUNTIME_EXECUTABLE_CONTRACTS = Object.freeze([
  {
    sourcePath: "packages/belldandy-agent/dist/react-run-budget.js",
    anchors: ["minimumOutputTokenReserve: 1_024", "checkModelCallPreflight(input)", "reserveToolCall(toolName)"],
  },
  {
    sourcePath: "packages/belldandy-core/dist/coding-run/conversation-steer-mailbox.js",
    anchors: ["peekPending()", "command.status = \"delivered\"", "close(error)"],
  },
  {
    sourcePath: "packages/belldandy-core/dist/coding-run/gateway-conversation-event-adapter.js",
    anchors: [
      "event === \"agent.budget_exhausted\"",
      "emit(\"run.budget_exhausted\"",
      "return emit(\"run.failed\"",
      "return emit(\"run.completed\"",
    ],
  },
]);
const scriptPath = fileURLToPath(import.meta.url);

export async function buildModelLoopRolloutAuditArtifact(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const sourceArtifacts = validateP028Artifacts(input?.p028Artifacts);
  const aggregate = validateFrozenAggregate(input?.aggregate);
  const aggregateText = requireText(input?.aggregateText, "aggregateText");
  const runtimeSources = validateRuntimeSourceEntries(input?.runtimeSources);
  const runtimeExecutables = validateRuntimeExecutableEntries(input?.runtimeExecutables);

  const repairPreflight = replayRepairPreflight();
  const steering = await replaySteeringBoundaries();
  const toolBatchTermination = {
    fileRead: replayToolBatch("file_read"),
    textSearch: replayToolBatch("text_search"),
  };
  const followUpIsolation = replayFollowUpIsolation();
  const gatewayProjection = replayGatewayProjection();
  const ordinaryProfileCompatibility = replayOrdinaryProfile();

  return {
    schemaVersion: CODING_AGENT_BENCHMARK_MODEL_LOOP_ROLLOUT_AUDIT_VERSION,
    generatedAt,
    status: "completed",
    platform,
    policy: {
      id: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      scope: "explicit_opt_in",
      limits: { ...MODEL_LOOP_COST_CONTAINMENT_LIMITS },
    },
    rolloutDecision: {
      status: "hold_explicit_opt_in",
      defaultEnablementAllowed: false,
      realProviderCanaryAllowed: false,
      requiresFreshAuthorizationForProviderCanary: true,
      candidateCreated: false,
      candidateLineStatus: "stopped",
      budgetLimitRaised: false,
      totalTokenBudget: 24_000,
      aggregateExpansionAllowed: false,
      totalMatrixTasks: 144,
      taskUplift: { status: "not_measured" },
    },
    contracts: {
      repairPreflight,
      steering,
      toolBatchTermination,
      followUpIsolation,
      gatewayProjection,
      ordinaryProfileCompatibility,
    },
    execution: {
      mode: "offline-contract-replay",
      gatewayStarts: 0,
      modelCalls: 0,
      providerCalls: 0,
      providerCostCny: 0,
      networkCalls: 0,
      hostCommandToolCalls: 0,
      credentialsRead: false,
      manifestModified: false,
      v3AggregateModified: false,
    },
    source: {
      p028Artifacts: sourceArtifacts.map(({ platform: sourcePlatform, sha256 }) => ({
        platform: sourcePlatform,
        sha256,
      })),
      p027AnalysisSha256: P0_27_ANALYSIS_SHA256,
      frozenAggregateSha256: sha256(aggregateText),
      frozenAggregateRunCount: aggregate.summary.runCount,
      frozenAggregatePassedRunCount: aggregate.summary.passedRunCount,
      runtimeSources,
      runtimeExecutables,
    },
    diagnostics: [],
  };
}

export async function runModelLoopRolloutAudit(input) {
  const platform = requirePlatform(input?.platform);
  const sourceRoot = path.resolve(requireString(input?.sourceRoot, "sourceRoot"));
  const windowsBudgetArtifactRoot = path.resolve(requireString(
    input?.windowsBudgetArtifactRoot,
    "windowsBudgetArtifactRoot",
  ));
  const wslBudgetArtifactRoot = path.resolve(requireString(input?.wslBudgetArtifactRoot, "wslBudgetArtifactRoot"));
  const aggregateReport = path.resolve(requireString(input?.aggregateReport, "aggregateReport"));
  const outputRoot = path.resolve(requireString(input?.outputRoot, "outputRoot"));

  await Promise.all([
    assertDirectory(sourceRoot, "source root"),
    assertDirectory(windowsBudgetArtifactRoot, "Windows P0.28 artifact root"),
    assertDirectory(wslBudgetArtifactRoot, "WSL2 P0.28 artifact root"),
    assertFile(aggregateReport, "aggregate report"),
    assertPathAbsent(outputRoot, "output root"),
  ]);
  assertDisjointRoots(outputRoot, windowsBudgetArtifactRoot, "output root", "Windows P0.28 artifact root");
  assertDisjointRoots(outputRoot, wslBudgetArtifactRoot, "output root", "WSL2 P0.28 artifact root");

  const sourcePaths = [
    path.join(windowsBudgetArtifactRoot, "model-loop-budget-termination.json"),
    path.join(wslBudgetArtifactRoot, "model-loop-budget-termination.json"),
  ];
  const [windowsText, wslText, aggregateText, runtimeSources, runtimeExecutables] = await Promise.all([
    fs.readFile(sourcePaths[0], "utf8"),
    fs.readFile(sourcePaths[1], "utf8"),
    fs.readFile(aggregateReport, "utf8"),
    loadRuntimeSources(sourceRoot),
    loadRuntimeExecutables(sourceRoot),
  ]);
  assertSame(sha256(windowsText), P0_28_SHA256["windows-native"], "Windows P0.28 artifact SHA-256");
  assertSame(sha256(wslText), P0_28_SHA256["wsl2-linux"], "WSL2 P0.28 artifact SHA-256");
  assertSame(sha256(aggregateText), FROZEN_AGGREGATE_SHA256, "frozen aggregate SHA-256");

  const artifact = await buildModelLoopRolloutAuditArtifact({
    platform,
    generatedAt: input?.generatedAt,
    p028Artifacts: [
      { platform: "windows-native", artifact: JSON.parse(windowsText), text: windowsText },
      { platform: "wsl2-linux", artifact: JSON.parse(wslText), text: wslText },
    ],
    aggregate: JSON.parse(aggregateText),
    aggregateText,
    runtimeSources,
    runtimeExecutables,
  });
  await writeModelLoopRolloutAuditArtifact(outputRoot, artifact);
  return artifact;
}

export async function writeModelLoopRolloutAuditArtifact(outputRoot, artifact) {
  const target = path.resolve(requireString(outputRoot, "outputRoot"));
  await assertPathAbsent(target, "output root");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "model-loop-rollout-audit.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

export function parseModelLoopRolloutAuditCliArguments(argv) {
  const options = {};
  const allowed = new Set([
    "platform",
    "sourceRoot",
    "windowsBudgetArtifactRoot",
    "wslBudgetArtifactRoot",
    "aggregateReport",
    "outputRoot",
    "generatedAt",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid CLI argument near ${key ?? "<end>"}.`);
    }
    const name = key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (!allowed.has(name)) throw new Error(`Unknown CLI argument: ${key}`);
    options[name] = value;
  }
  return { ...options, sourceRoot: options.sourceRoot ?? process.cwd() };
}

function validateP028Artifacts(value) {
  const artifacts = requireArray(value, "P0.28 artifacts");
  if (artifacts.length !== PLATFORMS.length) {
    throw new Error("P0.29 requires both Windows and WSL2 P0.28 artifacts.");
  }
  return PLATFORMS.map((platform, index) => {
    const source = requireObject(artifacts[index], `P0.28 artifacts[${index}]`);
    assertSame(source.platform, platform, `P0.28 artifact ${index} platform`);
    const artifact = requireObject(source.artifact, `${platform} P0.28 artifact`);
    const text = requireText(source.text, `${platform} P0.28 artifact text`);
    assertSame(sha256(text), P0_28_SHA256[platform], `${platform} P0.28 artifact SHA-256`);
    assertSame(artifact.schemaVersion, P0_28_VERSION, `${platform} P0.28 artifact version`);
    assertSame(artifact.platform, platform, `${platform} P0.28 artifact platform`);
    if (artifact.status !== "completed" || artifact.policy?.id !== MODEL_LOOP_COST_CONTAINMENT_POLICY_ID
      || artifact.policy?.scope !== "explicit_opt_in"
      || JSON.stringify(artifact.policy?.limits) !== JSON.stringify(MODEL_LOOP_COST_CONTAINMENT_LIMITS)
      || artifact.policy?.taskUplift?.status !== "not_measured"
      || artifact.policy?.candidateCreated !== false || artifact.policy?.providerExpansionAllowed !== false) {
      throw new Error(`${platform} P0.28 policy boundary drifted.`);
    }
    if (artifact.decisionBoundary?.candidateLineStatus !== "stopped"
      || artifact.decisionBoundary?.budgetLimitRaised !== false
      || artifact.decisionBoundary?.totalTokenBudget !== 24_000
      || artifact.decisionBoundary?.aggregateExpansionAllowed !== false
      || artifact.decisionBoundary?.totalMatrixTasks !== 144) {
      throw new Error(`${platform} P0.28 decision boundary drifted.`);
    }
    if (artifact.execution?.modelCalls !== 0 || artifact.execution?.providerCalls !== 0
      || artifact.execution?.networkCalls !== 0 || artifact.execution?.hostCommandToolCalls !== 0
      || artifact.execution?.credentialsRead !== false || artifact.execution?.v3AggregateModified !== false) {
      throw new Error(`${platform} P0.28 offline execution boundary drifted.`);
    }
    assertSame(artifact.source?.analysisSha256, P0_27_ANALYSIS_SHA256, `${platform} P0.27 source SHA-256`);
    assertSame(artifact.source?.frozenAggregateSha256, FROZEN_AGGREGATE_SHA256, `${platform} aggregate SHA-256`);
    return { platform, sha256: sha256(text) };
  });
}

function validateFrozenAggregate(value) {
  const aggregate = requireObject(value, "frozen aggregate");
  if (aggregate.schemaVersion !== "coding-agent-benchmark-report/v3" || aggregate.status !== "partial") {
    throw new Error("Frozen aggregate identity or status drifted.");
  }
  if (aggregate.summary?.runCount !== 6 || aggregate.summary?.passedRunCount !== 2) {
    throw new Error("Frozen aggregate must retain 6 runs and 2 passed runs.");
  }
  return aggregate;
}

async function loadRuntimeSources(sourceRoot) {
  return Promise.all(RUNTIME_SOURCE_CONTRACTS.map(async (contract) => {
    const absolutePath = path.join(sourceRoot, ...contract.sourcePath.split("/"));
    const text = await fs.readFile(absolutePath, "utf8");
    for (const anchor of contract.anchors) {
      if (!text.includes(anchor)) throw new Error(`${contract.sourcePath} is missing contract anchor: ${anchor}`);
    }
    return { sourcePath: contract.sourcePath, sha256: sha256(text) };
  }));
}

async function loadRuntimeExecutables(sourceRoot) {
  return Promise.all(RUNTIME_EXECUTABLE_CONTRACTS.map(async (contract) => {
    const absolutePath = path.join(sourceRoot, ...contract.sourcePath.split("/"));
    const text = await fs.readFile(absolutePath, "utf8");
    for (const anchor of contract.anchors) {
      if (!text.includes(anchor)) throw new Error(`${contract.sourcePath} is missing executable anchor: ${anchor}`);
    }
    return { sourcePath: contract.sourcePath, sha256: sha256(text) };
  }));
}

function validateRuntimeSourceEntries(value) {
  const sources = requireArray(value, "runtimeSources");
  if (sources.length !== RUNTIME_SOURCE_CONTRACTS.length) {
    throw new Error(`Runtime source evidence must contain all ${RUNTIME_SOURCE_CONTRACTS.length} contract files.`);
  }
  return RUNTIME_SOURCE_CONTRACTS.map((contract, index) => {
    const source = requireObject(sources[index], `runtimeSources[${index}]`);
    assertSame(source.sourcePath, contract.sourcePath, `runtime source ${index} path`);
    if (!/^[a-f0-9]{64}$/u.test(source.sha256)) {
      throw new Error(`Runtime source ${contract.sourcePath} SHA-256 is invalid.`);
    }
    return { sourcePath: source.sourcePath, sha256: source.sha256 };
  });
}

function validateRuntimeExecutableEntries(value) {
  const executables = requireArray(value, "runtimeExecutables");
  if (executables.length !== RUNTIME_EXECUTABLE_CONTRACTS.length) {
    throw new Error(`Runtime executable evidence must contain all ${RUNTIME_EXECUTABLE_CONTRACTS.length} files.`);
  }
  return RUNTIME_EXECUTABLE_CONTRACTS.map((contract, index) => {
    const executable = requireObject(executables[index], `runtimeExecutables[${index}]`);
    assertSame(executable.sourcePath, contract.sourcePath, `runtime executable ${index} path`);
    if (!/^[a-f0-9]{64}$/u.test(executable.sha256)) {
      throw new Error(`Runtime executable ${contract.sourcePath} SHA-256 is invalid.`);
    }
    return { sourcePath: executable.sourcePath, sha256: executable.sha256 };
  });
}

function replayRepairPreflight() {
  const tracker = createPolicyTracker();
  tracker.recordModelUsage({
    providerUsageAvailable: true,
    inputTokens: 21_000,
    outputTokens: 1_000,
  });
  const minimumRepairInputTokens = 1_500;
  const termination = tracker.checkModelCallPreflight({ minimumInputTokens: minimumRepairInputTokens });
  return {
    preflightKind: "structured_output_repair",
    checkIsReadOnly: tracker.modelCalls === 0,
    consumedTokens: tracker.totalTokens,
    minimumRepairInputTokens,
    minimumOutputTokenReserve: MODEL_LOOP_COST_CONTAINMENT_LIMITS.minimumOutputTokenReserve,
    projectedTokens: 24_524,
    providerDispatchAllowed: false,
    termination: requireTermination(termination, "total_tokens", "insufficient_remaining_tokens"),
  };
}

async function replaySteeringBoundaries() {
  const blockedMailbox = createAuditMailbox("blocked");
  const blockedEnqueue = blockedMailbox.enqueue({ prompt: "narrow scope", idempotencyKey: "blocked-1" });
  if (!blockedEnqueue.ok) throw new Error("Blocked steer replay could not enqueue its command.");
  const blockedTracker = createPolicyTracker();
  for (let index = 0; index < MODEL_LOOP_COST_CONTAINMENT_LIMITS.maxModelCalls; index++) {
    if (blockedTracker.reserveModelCall({ minimumInputTokens: 1 })) {
      throw new Error("Blocked steer replay exhausted before the fifth model call.");
    }
  }
  const preview = blockedMailbox.peekPending();
  const blockedTermination = blockedTracker.reserveModelCall({ minimumInputTokens: 1 });
  const statusAfterPreflight = blockedMailbox.getStatus(blockedEnqueue.item.commandId)?.status;
  blockedMailbox.close("model loop budget exhausted");

  let deliveredCount = 0;
  const admittedMailbox = createAuditMailbox("admitted", () => { deliveredCount += 1; });
  const admittedEnqueue = admittedMailbox.enqueue({ prompt: "continue locally", idempotencyKey: "admitted-1" });
  if (!admittedEnqueue.ok) throw new Error("Admitted steer replay could not enqueue its command.");
  const admittedTracker = createPolicyTracker();
  const admittedPreview = admittedMailbox.peekPending();
  const admittedTermination = admittedTracker.reserveModelCall({ minimumInputTokens: 1 });
  if (admittedTermination) throw new Error("Admitted steer replay unexpectedly exhausted its first model call.");
  const consumed = await admittedMailbox.consumePending({ modelCallIndex: 1 });

  return {
    blockedPreflight: {
      previewedCommandCount: preview.length,
      statusBeforePreflight: blockedEnqueue.item.status,
      statusAfterPreflight,
      consumeCalled: false,
      providerDispatchAllowed: false,
      statusAfterRunClose: blockedMailbox.getStatus(blockedEnqueue.item.commandId)?.status,
      termination: requireTermination(blockedTermination, "model_calls", "model_call_limit"),
    },
    admittedPreflight: {
      previewedCommandCount: admittedPreview.length,
      statusBeforePreflight: admittedEnqueue.item.status,
      preflightPassed: true,
      consumeCalledAfterPreflight: true,
      consumedCommandCount: consumed.length,
      deliveredCount,
      statusAfterConsume: admittedMailbox.getStatus(admittedEnqueue.item.commandId)?.status,
      providerDispatchAllowed: true,
    },
  };
}

function replayToolBatch(toolName) {
  const tracker = createPolicyTracker();
  const requestedTools = [toolName, toolName, toolName, "file_glob"];
  const executedTools = [];
  let termination;
  let blockedRequestIndex = 0;
  for (let index = 0; index < requestedTools.length; index++) {
    const requested = requestedTools[index];
    termination = tracker.reserveToolCall(requested);
    if (termination) {
      blockedRequestIndex = index + 1;
      break;
    }
    executedTools.push(requested);
  }
  const budget = toolName === "file_read" ? "file_read_calls" : "text_search_calls";
  const reasonCode = toolName === "file_read" ? "file_read_call_limit" : "text_search_call_limit";
  return {
    requestedTools,
    executedTools,
    blockedRequestIndex,
    subsequentToolExecuted: executedTools.includes("file_glob"),
    termination: requireTermination(termination, budget, reasonCode),
  };
}

function replayFollowUpIsolation() {
  const firstRun = createPolicyTracker();
  let firstRunTermination;
  for (let index = 0; index < 5; index++) {
    firstRunTermination = firstRun.reserveModelCall({ minimumInputTokens: 1 });
    if (firstRunTermination) break;
  }
  const ordinaryFollowUp = createOrdinaryTracker();
  const ordinaryReservations = Array.from({ length: 5 }, () => ordinaryFollowUp.reserveModelCall({
    minimumInputTokens: 1,
  }));
  const selectedFollowUp = createPolicyTracker();
  const selectedTermination = selectedFollowUp.reserveModelCall({ minimumInputTokens: 1 });
  if (selectedTermination) throw new Error("Explicitly selected follow-up did not start with a fresh model budget.");
  return {
    firstRunTermination: requireTermination(firstRunTermination, "model_calls", "model_call_limit"),
    newBudgetTrackerPerRun: firstRun !== ordinaryFollowUp && ordinaryFollowUp !== selectedFollowUp,
    policyInheritedByOrdinaryFollowUp: ordinaryFollowUp.modelLoopBudgetPolicy !== undefined,
    explicitReselectionRequired: true,
    ordinaryFollowUpReservationsAdmitted: ordinaryReservations.filter((item) => item === undefined).length,
    selectedFollowUpPolicyId: selectedFollowUp.modelLoopBudgetPolicy,
    selectedFollowUpModelCallsAfterFirstAdmission: selectedFollowUp.modelCalls,
  };
}

function replayGatewayProjection() {
  const events = [];
  const binding = { agentRunId: "audit-run", conversationId: "audit-conversation" };
  const adapter = createGatewayConversationEventAdapter({ onEvent: (event) => events.push(event) });
  adapter.start(binding);
  adapter.consume({
    event: "agent.budget_exhausted",
    payload: {
      conversationId: binding.conversationId,
      runId: binding.agentRunId,
      budget: "model_calls",
      limit: 4,
      observed: 5,
      policyId: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
      stage: "before_model_call",
      reasonCode: "model_call_limit",
    },
  });
  adapter.consume({
    event: "agent.status",
    payload: { conversationId: binding.conversationId, runId: binding.agentRunId, status: "error" },
  });
  adapter.consume({
    event: "chat.final",
    payload: { conversationId: binding.conversationId, runId: binding.agentRunId, text: "budget exhausted" },
  });
  const terminal = adapter.getTerminalEvent();
  return {
    eventTypes: events.map((event) => event.type),
    budgetEventCount: events.filter((event) => event.type === "run.budget_exhausted").length,
    terminalType: terminal?.type,
    terminalErrorCode: terminal?.type === "run.failed" ? terminal.payload.error.code : undefined,
    runCompletedEmitted: events.some((event) => event.type === "run.completed"),
    structuredBudget: events.find((event) => event.type === "run.budget_exhausted")?.payload.budget,
  };
}

function replayOrdinaryProfile() {
  const tracker = createOrdinaryTracker();
  tracker.recordModelUsage({ providerUsageAvailable: true, inputTokens: 21_000, outputTokens: 1_000 });
  const repairPreflight = tracker.checkModelCallPreflight({ minimumInputTokens: 1_500 });
  const modelReservations = Array.from({ length: 5 }, () => tracker.reserveModelCall({ minimumInputTokens: 1 }));
  const requestedTools = ["file_read", "file_read", "file_read", "text_search", "text_search", "text_search"];
  const toolReservations = requestedTools.map((toolName) => tracker.reserveToolCall(toolName));
  return {
    policyEnabled: false,
    outputReserveApplied: false,
    repairPreflightAllowedWithoutPolicyReserve: repairPreflight === undefined,
    modelReservationsAttempted: modelReservations.length,
    modelReservationsAdmitted: modelReservations.filter((item) => item === undefined).length,
    toolReservationsAttempted: toolReservations.length,
    toolReservationsAdmitted: toolReservations.filter((item) => item === undefined).length,
    budgetBehavior: "post_usage_budget_semantics_preserved",
  };
}

function createPolicyTracker() {
  return new ReActRunBudgetTracker({
    maxTotalTokens: 24_000,
    maxHighRiskToolCalls: 4,
    modelLoopBudgetPolicy: MODEL_LOOP_COST_CONTAINMENT_POLICY_ID,
  });
}

function createOrdinaryTracker() {
  return new ReActRunBudgetTracker({ maxTotalTokens: 24_000, maxHighRiskToolCalls: 4 });
}

function createAuditMailbox(suffix, onDeliver) {
  return new ConversationSteerMailbox({
    binding: { conversationId: `audit-${suffix}`, agentRunId: `audit-${suffix}-run` },
    createId: () => `audit-${suffix}-steer`,
    now: () => 1,
    onDeliver,
  });
}

function requireTermination(value, budget, reasonCode) {
  if (!value || value.budget !== budget || value.policyId !== MODEL_LOOP_COST_CONTAINMENT_POLICY_ID
    || value.reasonCode !== reasonCode) {
    throw new Error(`Budget replay did not emit ${budget}/${reasonCode}.`);
  }
  return { ...value };
}

function requirePlatform(value) {
  if (!PLATFORMS.includes(value)) throw new Error("Platform must be windows-native or wsl2-linux.");
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new Error("generatedAt must be an ISO-8601 UTC timestamp.");
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be non-empty text.`);
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertSame(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} drifted: expected ${expected}, received ${actual}.`);
}

async function assertDirectory(target, label) {
  const stats = await fs.stat(target).catch(() => undefined);
  if (!stats?.isDirectory()) throw new Error(`${label} must be an existing directory.`);
}

async function assertFile(target, label) {
  const stats = await fs.stat(target).catch(() => undefined);
  if (!stats?.isFile()) throw new Error(`${label} must be an existing file.`);
}

async function assertPathAbsent(target, label) {
  const exists = await fs.stat(target).then(() => true, () => false);
  if (exists) throw new Error(`${label} already exists: ${target}`);
}

function assertDisjointRoots(left, right, leftLabel, rightLabel) {
  const relative = path.relative(right, left);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${leftLabel} must not be inside ${rightLabel}.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runModelLoopRolloutAudit(parseModelLoopRolloutAuditCliArguments(process.argv.slice(2)))
    .then((artifact) => console.log(`[model-loop-rollout-audit] ${artifact.platform} completed`))
    .catch((error) => {
      console.error(`[model-loop-rollout-audit] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
