import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveCodingAgentBenchmarkContract } from "./coding-agent-benchmark-contract.mjs";
import {
  createBenchmarkApprovalController,
  loadBenchmarkApprovalContract,
} from "./coding-agent-benchmark-approval.mjs";
import {
  buildNavigationCandidateProfile,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";
import {
  buildNavigationCandidateV2Profile,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
} from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";
import {
  buildNavigationCandidateV3Profile,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
} from "./run-coding-agent-benchmark-navigation-candidate-v3.mjs";
import {
  buildCodeIntelAgentUpliftCandidateProfile,
  CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
} from "./run-code-intel-agent-uplift-readiness.mjs";

export const CODING_CI_CONTRACT_VERSION = "coding-agent-ci/v1";
export const CODING_CI_AUTOMATION_PROFILE = "bare";
export const CODING_CI_LIMITS = Object.freeze({
  timeoutMs: 300_000,
  maxTurns: 12,
  maxTokens: 24_000,
});

const TERMINAL_EVENT_TYPES = new Set([
  "run.cancelled",
  "run.interrupted",
  "run.completed",
  "run.failed",
]);
const SENSITIVE_PATH_PATTERNS = [
  ".env",
  "credentials",
  "secret",
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  "id_rsa",
  "id_ed25519",
  ".ssh",
  "password",
  "token",
];
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const CANCELLATION_REQUEST_TIMEOUT_MS = 15_000;
const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");

export function resolveCodingCiProfile(value, manifestRevision = "v1", shadowCandidateId) {
  const mode = typeof value === "string" && value.trim() ? value.trim() : "plan";
  const contract = resolveCodingAgentBenchmarkContract(manifestRevision);
  const profile = contract.executionProfiles[mode];
  if (!profile) {
    throw new Error("--mode must be plan, navigation-read, workspace-write, command-control, safety-probe, recovery-control, or git-local.");
  }
  let selectedProfile = profile;
  let candidateId;
  if (shadowCandidateId !== undefined) {
    candidateId = String(shadowCandidateId).trim();
    if (candidateId === CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID) {
      if (manifestRevision !== "v3" || (mode !== "workspace-write" && mode !== "command-control")) {
        throw new Error("--shadow-candidate-id CodeIntel uplift only supports v3 workspace-write or command-control mode.");
      }
      selectedProfile = buildCodeIntelAgentUpliftCandidateProfile(profile, mode);
    } else {
      if (manifestRevision !== "v3"
        || mode !== "workspace-write"
        || ![CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_ID,
          CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
          CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID].includes(candidateId)) {
        throw new Error("--shadow-candidate-id only supports the v3 workspace-write navigation candidate.");
      }
      const candidate = candidateId === CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID
        ? buildNavigationCandidateV3Profile({ suite: { executionProfiles: contract.executionProfiles } })
        : candidateId === CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID
          ? buildNavigationCandidateV2Profile({ suite: { executionProfiles: contract.executionProfiles } })
          : buildNavigationCandidateProfile({ suite: { executionProfiles: contract.executionProfiles } });
      selectedProfile = {
        permissionMode: candidate.permissionMode,
        toolAllow: candidate.toolAllow,
        toolDeny: candidate.toolDeny,
        ...(candidate.toolArgumentPolicy ? { toolArgumentPolicy: candidate.toolArgumentPolicy } : {}),
      };
    }
  }
  const defaultToolDeny = selectedProfile.toolAllow.includes("run_command")
    ? ["spawn_subagent"]
    : ["run_command", "spawn_subagent"];
  return {
    mode,
    ...(candidateId ? { candidateId } : {}),
    ...(typeof selectedProfile.agentId === "string" && selectedProfile.agentId.trim()
      ? { agentId: selectedProfile.agentId.trim() }
      : {}),
    ...(Number.isInteger(selectedProfile.maxHighRiskToolCalls) && selectedProfile.maxHighRiskToolCalls >= 0
      ? { maxHighRiskToolCalls: selectedProfile.maxHighRiskToolCalls }
      : {}),
    permissionMode: selectedProfile.permissionMode,
    toolAllow: [...selectedProfile.toolAllow],
    ...(selectedProfile.toolArgumentPolicy
      ? { toolArgumentPolicy: selectedProfile.toolArgumentPolicy }
      : {}),
    ...(JSON.stringify(selectedProfile.toolDeny) === JSON.stringify(defaultToolDeny)
      ? {}
      : { toolDeny: [...selectedProfile.toolDeny] }),
  };
}

export function resolveCodingCiLimits(manifestRevision = "v1", taskId) {
  const contract = resolveCodingAgentBenchmarkContract(manifestRevision);
  if (contract.revision !== "v1" && (typeof taskId !== "string" || !taskId.trim())) {
    throw new Error("--task-id is required for corrected v2 and v3 CI runs.");
  }
  return {
    ...CODING_CI_LIMITS,
    ...(contract.taskBudgetOverrides?.[taskId] ?? {}),
  };
}

export function buildAgentRunArgs(input) {
  const limits = input.limits ?? CODING_CI_LIMITS;
  return [
    "agent", "run",
    "--jsonl",
    "--automation-profile", CODING_CI_AUTOMATION_PROFILE,
    "--cwd", input.gatewayWorkspace ?? path.resolve(input.workspace),
    "--state-dir", path.resolve(input.stateDir),
    ...(input.conversationId ? ["--conversation-id", input.conversationId] : []),
    ...(input.profile.agentId ? ["--agent-id", input.profile.agentId] : []),
    ...(input.modelId ? ["--model-id", input.modelId] : []),
    "--permission-mode", input.profile.permissionMode === "acceptEdits" ? "accept-edits" : input.profile.permissionMode,
    "--tool-allow", input.profile.toolAllow.join(","),
    "--tool-deny", (input.profile.toolDeny ?? (input.profile.toolAllow.includes("run_command")
      ? ["spawn_subagent"]
      : ["run_command", "spawn_subagent"])).join(","),
    ...(input.profile.toolArgumentPolicy
      ? ["--tool-argument-policy", input.profile.toolArgumentPolicy]
      : []),
    "--timeout", String(limits.timeoutMs),
    "--max-turns", String(limits.maxTurns),
    "--max-tokens", String(limits.maxTokens),
    ...(Number.isFinite(input.maxCostUsd) && input.maxCostUsd > 0
      ? ["--max-cost-usd", String(input.maxCostUsd)]
      : []),
    "--output-schema", path.resolve(input.outputSchemaPath),
  ];
}

export function validateAgentRunEvents(
  events,
  isAgentRunEventV1,
  validators = {},
  expectedAutomationProfile,
) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("Agent JSONL did not contain any v1 events.");
  }
  if (typeof isAgentRunEventV1 !== "function") {
    throw new Error("AgentRunEvent v1 validator is unavailable.");
  }
  if (typeof validators.isCodingRunCapabilitiesV1 !== "function"
    || typeof validators.isCodingRunUsageCompletenessV1 !== "function") {
    throw new Error("Coding run capability or usage completeness validator is unavailable.");
  }

  const firstBinding = events[0]?.binding;
  let terminalType;
  let terminalEvent;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isAgentRunEventV1(event)) {
      throw new Error(`Agent JSONL event ${index + 1} does not match AgentRunEvent v1.`);
    }
    if (event.seq !== index + 1) {
      throw new Error(`Agent JSONL sequence is not continuous at event ${index + 1}.`);
    }
    if (
      event.binding.agentRunId !== firstBinding.agentRunId
      || event.binding.conversationId !== firstBinding.conversationId
    ) {
      throw new Error(`Agent JSONL binding changed at event ${index + 1}.`);
    }
    if (TERMINAL_EVENT_TYPES.has(event.type)) {
      if (terminalType) {
        throw new Error("Agent JSONL contains more than one terminal event.");
      }
      if (index !== events.length - 1) {
        throw new Error("Agent JSONL contains events after its terminal event.");
      }
      terminalType = event.type;
      terminalEvent = event;
    }
  }
  if (!terminalType) {
    throw new Error("Agent JSONL is missing a terminal event.");
  }
  if (events[0]?.type !== "run.started"
    || !validators.isCodingRunCapabilitiesV1(events[0]?.payload?.capabilities)) {
    throw new Error("Agent JSONL is missing a valid run.started capability handshake.");
  }
  const advertisedTracePolicy = events[0]?.payload?.capabilities?.observability?.trace;
  if (validators.expectedTracePolicy !== undefined
    && (!advertisedTracePolicy
      || Object.keys(advertisedTracePolicy).length !== 3
      || advertisedTracePolicy.schemaVersion !== validators.expectedTracePolicy.schemaVersion
      || advertisedTracePolicy.contentMode !== validators.expectedTracePolicy.contentMode
      || !Array.isArray(advertisedTracePolicy.bodyFields)
      || JSON.stringify(advertisedTracePolicy.bodyFields)
        !== JSON.stringify(validators.expectedTracePolicy.bodyFields))) {
    throw new Error("Agent JSONL is missing the current trace capability declaration.");
  }
  const automationProfile = events[0]?.payload?.automationProfile;
  if (expectedAutomationProfile !== undefined && automationProfile !== expectedAutomationProfile) {
    throw new Error(`Agent JSONL automation profile mismatch: expected ${expectedAutomationProfile}.`);
  }
  if (!validators.isCodingRunUsageCompletenessV1(terminalEvent?.payload?.usage)) {
    throw new Error("Agent JSONL terminal event is missing a valid usage completeness declaration.");
  }
  return {
    binding: {
      agentRunId: firstBinding.agentRunId,
      conversationId: firstBinding.conversationId,
    },
    terminalType,
    ...(automationProfile === undefined ? {} : { automationProfile }),
    capabilities: events[0].payload.capabilities,
    usage: terminalEvent.payload.usage,
  };
}

export function sanitizeDiagnostic(value) {
  return String(value ?? "").replace(
    /\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)[\w-]*)\s*([:=])\s*(?:Bearer\s+)?[^\s,;]+/gi,
    "$1$2[REDACTED]",
  );
}

export function buildBenchmarkPermissionResponseParams(protocolVersion, request) {
  return {
    control: {
      version: protocolVersion,
      operation: "permission.respond",
      binding: request.binding,
      toolCallId: request.toolCallId,
      decision: request.decision,
    },
  };
}

export function collectWorkspaceArtifact(input) {
  const workspace = path.resolve(input.workspace);
  const trackedPaths = splitNull(runGit(workspace, ["diff", "--name-only", "-z", "HEAD", "--", "."]).stdout);
  const untrackedPaths = splitNull(runGit(workspace, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]).stdout);
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort((left, right) => left.localeCompare(right));

  if (input.mode !== "workspace-write" && input.mode !== "recovery-control" && changedPaths.length > 0) {
    throw new Error(`Read-only CI run changed ${changedPaths.length} workspace path(s).`);
  }
  const sensitivePaths = changedPaths.filter(isSensitivePath);
  if (sensitivePaths.length > 0) {
    throw new Error(`Sensitive paths cannot be persisted in CI artifacts: ${sensitivePaths.join(", ")}`);
  }

  const patchParts = [];
  const trackedPatch = runGit(workspace, ["diff", "--binary", "--no-ext-diff", "HEAD", "--", "."]).stdout;
  if (trackedPatch) patchParts.push(trackedPatch);
  for (const relativePath of untrackedPaths.sort((left, right) => left.localeCompare(right))) {
    const result = runGit(
      workspace,
      ["diff", "--no-index", "--binary", "--", "/dev/null", relativePath],
      { allowedStatuses: [0, 1] },
    );
    if (result.stdout) patchParts.push(result.stdout);
  }

  return {
    changedPaths,
    patch: patchParts.join(patchParts.length > 1 ? "\n" : ""),
  };
}

export function assertCleanWorkspace(workspace) {
  const status = runGit(path.resolve(workspace), ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  if (status.trim()) {
    throw new Error("CI workspace must have a clean Git baseline before the Agent starts.");
  }
}

async function main() {
  const options = resolveMainOptions(process.argv.slice(2));
  await fs.mkdir(options.artifactDir, { recursive: true });
  assertCleanWorkspace(options.workspace);

  const prompt = (await fs.readFile(options.promptFile, "utf-8")).trim();
  if (!prompt) throw new Error("--prompt-file must contain a non-empty prompt.");
  await fs.access(options.outputSchemaPath);
  await fs.access(options.bddEntry);

  const coreEntry = path.join(
    options.sourceRoot,
    "packages",
    "belldandy-core",
    "dist",
    "coding-run",
    "contracts.js",
  );
  const {
    CODING_RUN_TRACE_POLICY,
    CODING_RUN_PROTOCOL_VERSION,
    isAgentRunEventV1,
    isCodingRunCapabilitiesV1,
    isCodingRunUsageCompletenessV1,
  } = await import(pathToFileURL(coreEntry).href);
  const traceEntry = path.join(
    options.sourceRoot,
    "packages",
    "belldandy-core",
    "dist",
    "coding-run",
    "trace.js",
  );
  const {
    projectCodingRunTraceEvents,
    validateCodingRunTraceEvents,
  } = await import(pathToFileURL(traceEntry).href);
  let approvalController;
  if (options.approvalContractPath) {
    const { contract, contractSha256 } = await loadBenchmarkApprovalContract(options.approvalContractPath);
    const gatewayRpcEntry = path.join(
      options.sourceRoot,
      "packages",
      "belldandy-core",
      "dist",
      "cli",
      "shared",
      "gateway-rpc.js",
    );
    const { invokeGatewayMethod } = await import(pathToFileURL(gatewayRpcEntry).href);
    approvalController = createBenchmarkApprovalController({
      contract,
      contractSha256,
      respondPermission: async (request) => await invokeGatewayMethod({
        stateDir: options.stateDir,
        method: "coding.run.control",
        params: buildBenchmarkPermissionResponseParams(CODING_RUN_PROTOCOL_VERSION, request),
        requestIdPrefix: "coding-benchmark-permission",
        clientName: "coding benchmark fixture approval",
        parsePayload: (payload) => payload,
      }),
    });
  }
  const child = await runAgentProcess({
    bddEntry: options.bddEntry,
    args: buildAgentRunArgs(options),
    cwd: options.workspace,
    prompt,
    stateDir: options.stateDir,
    cancelOnRunStart: options.cancelOnRunStart,
    approvalController,
  });

  if (child.approvalEvidence) {
    await fs.writeFile(
      path.join(options.artifactDir, "approval-evidence.json"),
      `${JSON.stringify(child.approvalEvidence, null, 2)}\n`,
      "utf-8",
    );
  }

  const parsed = parseJsonl(child.stdout);
  const canonicalJsonl = parsed.events.map((event) => JSON.stringify(event)).join("\n");
  await fs.writeFile(
    path.join(options.artifactDir, "events.jsonl"),
    canonicalJsonl ? `${canonicalJsonl}\n` : "",
    "utf-8",
  );

  let eventContract;
  let eventContractError;
  try {
    eventContract = validateAgentRunEvents(parsed.events, isAgentRunEventV1, {
      isCodingRunCapabilitiesV1,
      isCodingRunUsageCompletenessV1,
      expectedTracePolicy: CODING_RUN_TRACE_POLICY,
    }, CODING_CI_AUTOMATION_PROFILE);
  } catch (error) {
    eventContractError = sanitizeDiagnostic(error instanceof Error ? error.message : error);
  }
  if (parsed.errors.length > 0) {
    eventContractError = `Agent stdout contained ${parsed.errors.length} invalid JSONL record(s).`;
  }

  let traceEvents = [];
  let traceContract;
  let traceContractError;
  try {
    if (eventContractError) {
      throw new Error("Coding run trace requires a valid AgentRunEvent stream.");
    }
    traceEvents = projectCodingRunTraceEvents(parsed.events);
    traceContract = validateCodingRunTraceEvents(traceEvents);
  } catch (error) {
    traceContractError = sanitizeDiagnostic(error instanceof Error ? error.message : error);
  }
  const canonicalTraceJsonl = traceEvents.map((event) => JSON.stringify(event)).join("\n");
  await fs.writeFile(
    path.join(options.artifactDir, "trace.jsonl"),
    canonicalTraceJsonl ? `${canonicalTraceJsonl}\n` : "",
    "utf-8",
  );

  const cancellationArtifact = options.cancelOnRunStart
    ? buildCancellationArtifact({
      cancellation: child.cancellation,
      events: parsed.events,
      eventContract,
    })
    : undefined;
  if (cancellationArtifact) {
    await fs.writeFile(
      path.join(options.artifactDir, "cancel-injection.json"),
      `${JSON.stringify(cancellationArtifact, null, 2)}\n`,
      "utf-8",
    );
  }

  const diagnostics = [
    sanitizeDiagnostic(child.stderr).trim(),
    child.cancellation?.stderr ? sanitizeDiagnostic(child.cancellation.stderr).trim() : "",
    cancellationArtifact && cancellationArtifact.status !== "confirmed"
      ? `Cancellation injection status: ${cancellationArtifact.status}.`
      : "",
    child.approvalEvidence && child.approvalEvidence.status !== "passed"
      ? `Benchmark fixture approval status: ${child.approvalEvidence.status}.`
      : "",
  ].filter(Boolean).join("\n");
  await fs.writeFile(path.join(options.artifactDir, "diagnostics.log"), diagnostics ? `${diagnostics}\n` : "", "utf-8");

  let workspaceArtifact = { changedPaths: [], patch: "" };
  let artifactPolicyError;
  try {
    workspaceArtifact = collectWorkspaceArtifact({
      workspace: options.workspace,
      mode: options.profile.mode,
    });
  } catch (error) {
    artifactPolicyError = sanitizeDiagnostic(error instanceof Error ? error.message : error);
  }
  await fs.writeFile(path.join(options.artifactDir, "changes.patch"), workspaceArtifact.patch, "utf-8");

  const finalOutput = extractCompletedOutput(parsed.events);
  if (finalOutput !== undefined) {
    await fs.writeFile(
      path.join(options.artifactDir, "result.json"),
      `${JSON.stringify(JSON.parse(finalOutput), null, 2)}\n`,
      "utf-8",
    );
  }

  const manifest = {
    schemaVersion: CODING_CI_CONTRACT_VERSION,
    protocolVersion: CODING_RUN_PROTOCOL_VERSION,
    mode: options.profile.mode,
    ...(options.profile.candidateId ? { profileCandidateId: options.profile.candidateId } : {}),
    automationProfile: eventContract?.automationProfile ?? null,
    limits: options.limits ?? CODING_CI_LIMITS,
    cliExitCode: child.exitCode,
    eventCount: parsed.events.length,
    terminalType: eventContract?.terminalType ?? null,
    binding: eventContract?.binding ?? null,
    capabilities: eventContract?.capabilities ?? null,
    usage: eventContract?.usage ?? null,
    trace: traceContract ?? null,
    changedPaths: workspaceArtifact.changedPaths,
    checks: {
      cleanBaseline: true,
      eventContract: !eventContractError,
      capabilityHandshake: Boolean(eventContract?.capabilities),
      automationProfile: eventContract?.automationProfile === CODING_CI_AUTOMATION_PROFILE,
      usageComplete: eventContract?.usage?.status === "complete",
      traceContract: !traceContractError,
      artifactPolicy: !artifactPolicyError,
      automaticPush: false,
      approvalPolicy: child.approvalEvidence ? child.approvalEvidence.status === "passed" : null,
    },
    ...(eventContractError ? { eventContractError } : {}),
    ...(traceContractError ? { traceContractError } : {}),
    ...(artifactPolicyError ? { artifactPolicyError } : {}),
  };
  await fs.writeFile(
    path.join(options.artifactDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(options.artifactDir, "status.txt"),
    [
      `mode=${manifest.mode}`,
      ...(manifest.profileCandidateId ? [`profile_candidate_id=${manifest.profileCandidateId}`] : []),
      `cli_exit_code=${manifest.cliExitCode}`,
      `terminal_type=${manifest.terminalType ?? "none"}`,
      `changed_paths=${manifest.changedPaths.length}`,
      `event_contract=${manifest.checks.eventContract}`,
      `capability_handshake=${manifest.checks.capabilityHandshake}`,
      `automation_profile=${manifest.automationProfile ?? "none"}`,
      `usage_complete=${manifest.checks.usageComplete}`,
      `trace_contract=${manifest.checks.traceContract}`,
      `artifact_policy=${manifest.checks.artifactPolicy}`,
      `approval_policy=${manifest.checks.approvalPolicy ?? "not_applicable"}`,
      "automatic_push=false",
      "",
    ].join("\n"),
    "utf-8",
  );

  if (eventContractError || traceContractError || artifactPolicyError) {
    throw new Error(eventContractError ?? traceContractError ?? artifactPolicyError);
  }
  if (child.exitCode !== 0) {
    process.exitCode = child.exitCode ?? 1;
  }
}

function resolveMainOptions(argv) {
  const values = parseNamedArgs(argv);
  const manifestRevision = values.get("manifest-revision") ?? "v1";
  const taskId = values.get("task-id");
  const workspace = path.resolve(requireValue(values, "workspace"));
  const artifactDir = path.resolve(requireValue(values, "artifact-dir"));
  assertOutsideWorkspace(workspace, artifactDir);
  return {
    workspace,
    gatewayWorkspace: resolveOptionalGatewayWorkspace(values),
    artifactDir,
    promptFile: path.resolve(requireValue(values, "prompt-file")),
    stateDir: path.resolve(requireValue(values, "state-dir")),
    conversationId: values.get("conversation-id"),
    modelId: values.get("model-id"),
    maxCostUsd: resolveOptionalPositiveNumber(values, "max-cost-usd"),
    outputSchemaPath: path.resolve(
      values.get("output-schema") ?? path.join(workspaceRoot, "examples", "ci", "review-output.schema.json"),
    ),
    bddEntry: path.resolve(
      values.get("bdd-entry") ?? path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js"),
    ),
    sourceRoot: path.resolve(values.get("source-root") ?? workspaceRoot),
    approvalContractPath: values.has("approval-contract")
      ? path.resolve(requireValue(values, "approval-contract"))
      : undefined,
    manifestRevision,
    taskId,
    limits: resolveCodingCiLimits(manifestRevision, taskId),
    profile: resolveCodingCiProfile(
      values.get("mode"),
      manifestRevision,
      values.get("shadow-candidate-id"),
    ),
    cancelOnRunStart: resolveOptionalBoolean(values, "cancel-on-run-start"),
  };
}

function parseNamedArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${flag ?? "<end>"}.`);
    }
    values.set(flag.slice(2), value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${key} is required.`);
  }
  return value.trim();
}

function resolveOptionalBoolean(values, key) {
  const value = values.get(key);
  if (value === undefined) return false;
  if (value !== "true" && value !== "false") {
    throw new Error(`--${key} must be true or false.`);
  }
  return value === "true";
}

function resolveOptionalGatewayWorkspace(values) {
  if (!values.has("gateway-workspace")) return undefined;
  const value = requireValue(values, "gateway-workspace");
  if (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)) {
    throw new Error("--gateway-workspace must be an absolute POSIX or Windows path.");
  }
  return value;
}

function resolveOptionalPositiveNumber(values, key) {
  const value = values.get(key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive finite number.`);
  }
  return parsed;
}

function assertOutsideWorkspace(workspace, artifactDir) {
  const relative = path.relative(workspace, artifactDir);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("--artifact-dir must be outside --workspace.");
  }
}

async function runAgentProcess(input) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [input.bddEntry, ...input.args], {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let stdoutRemainder = "";
    const cancellation = input.cancelOnRunStart
      ? {
        observedStartedSeq: null,
        binding: null,
        requestCount: 0,
        result: undefined,
        stderr: "",
      }
      : undefined;
    let cancellationPromise;
    let approvalChain = Promise.resolve();
    const capture = (target, chunk) => {
      const text = String(chunk);
      capturedBytes += Buffer.byteLength(text);
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        child.kill();
        reject(new Error("Agent output exceeded the 16 MiB CI capture limit."));
        return target;
      }
      return target + text;
    };
    const observeAgentEvent = (event) => {
      if (!cancellation || cancellationPromise || event?.type !== "run.started") return;
      const binding = getAgentRunBinding(event);
      if (!binding || !Number.isInteger(event.seq) || event.seq < 1) return;
      cancellation.observedStartedSeq = event.seq;
      cancellation.binding = binding;
      cancellation.requestCount = 1;
      cancellationPromise = runAgentCancellation({
        bddEntry: input.bddEntry,
        cwd: input.cwd,
        stateDir: input.stateDir,
        binding,
      }).then((result) => {
        cancellation.result = result;
        cancellation.stderr = result.stderr;
      });
    };
    const observeStdout = (chunk) => {
      if (!cancellation && !input.approvalController) return;
      stdoutRemainder += String(chunk);
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          observeAgentEvent(event);
          if (input.approvalController) {
            approvalChain = approvalChain.then(() => input.approvalController.observe(event));
          }
        } catch {
          // The canonical JSONL validator reports malformed Agent output after the process exits.
        }
      }
    };
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk);
      observeStdout(chunk);
    });
    child.stderr.on("data", (chunk) => { stderr = capture(stderr, chunk); });
    child.once("error", reject);
    child.once("close", async (exitCode) => {
      await cancellationPromise;
      await approvalChain;
      resolve({
        exitCode,
        stdout,
        stderr,
        cancellation,
        approvalEvidence: input.approvalController?.finalize(),
      });
    });
    child.stdin.end(input.prompt);
  });
}

function getAgentRunBinding(event) {
  const binding = event?.binding;
  if (!binding || typeof binding !== "object"
    || typeof binding.conversationId !== "string" || !binding.conversationId.trim()
    || typeof binding.agentRunId !== "string" || !binding.agentRunId.trim()) {
    return undefined;
  }
  return {
    conversationId: binding.conversationId,
    agentRunId: binding.agentRunId,
  };
}

function buildCancellationArtifact(input) {
  const terminal = input.events.at(-1);
  const cancellation = input.cancellation;
  const terminalMatchesBinding = Boolean(
    cancellation?.binding
      && terminal?.binding?.conversationId === cancellation.binding.conversationId
      && terminal?.binding?.agentRunId === cancellation.binding.agentRunId,
  );
  let status = "not_observed";
  if (cancellation?.binding) {
    if (cancellation.requestCount !== 1 || cancellation.result?.exitCode !== 0 || cancellation.result?.timedOut) {
      status = "failed";
    } else if (input.eventContract?.terminalType === "run.cancelled" && terminalMatchesBinding) {
      status = "confirmed";
    } else {
      status = "requested";
    }
  }
  return {
    schemaVersion: "coding-agent-cancel-injection/v1",
    trigger: "run.started",
    status,
    observedStartedSeq: cancellation?.observedStartedSeq ?? null,
    cancellationRequestCount: cancellation?.requestCount ?? 0,
    cancelExitCode: cancellation?.result?.exitCode ?? null,
    binding: cancellation?.binding ?? null,
    terminalType: typeof terminal?.type === "string" ? terminal.type : null,
    terminalSeq: Number.isInteger(terminal?.seq) ? terminal.seq : null,
  };
}

async function runAgentCancellation(input) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      input.bddEntry,
      "agent", "cancel",
      "--conversation-id", input.binding.conversationId,
      "--run-id", input.binding.agentRunId,
      "--state-dir", input.stateDir,
      "--reason", "Benchmark cancellation injected after run.started.",
    ], {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, CANCELLATION_REQUEST_TIMEOUT_MS);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: safeErrorMessage(error), timedOut });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? null, stdout, stderr, timedOut });
    });
  });
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function parseJsonl(stdout) {
  const events = [];
  const errors = [];
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      errors.push(index + 1);
    }
  }
  return { events, errors };
}

function extractCompletedOutput(events) {
  const terminal = events.at(-1);
  if (terminal?.type !== "run.completed") return undefined;
  const text = terminal.payload?.output?.text;
  return typeof text === "string" ? text : undefined;
}

function isSensitivePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return SENSITIVE_PATH_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function splitNull(value) {
  return value.split("\0").filter(Boolean).map((item) => item.replace(/\\/g, "/"));
}

function runGit(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const allowedStatuses = options.allowedStatuses ?? [0];
  if (!allowedStatuses.includes(result.status)) {
    throw new Error(sanitizeDiagnostic(result.stderr || `git ${args[0]} failed with status ${result.status}.`));
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-ci] ${sanitizeDiagnostic(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  });
}
