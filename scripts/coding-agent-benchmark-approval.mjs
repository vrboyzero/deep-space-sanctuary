import crypto from "node:crypto";
import fs from "node:fs/promises";

export const BENCHMARK_APPROVAL_CONTRACT_VERSION = "coding-agent-benchmark-approval-contract/v1";
export const BENCHMARK_APPROVAL_EVIDENCE_VERSION = "coding-agent-benchmark-approval-evidence/v1";
export const BENCHMARK_JOB_ID_PLACEHOLDER = "$BENCHMARK_JOB_ID";

const JOB_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_RESPONSE_DIAGNOSTIC_LENGTH = 500;

export function createBenchmarkApprovalContract(input) {
  const policy = normalizePolicy(input.policy);
  if (!policy) throw new Error("Benchmark approval policy is invalid.");
  const fixture = normalizeFixture(input.fixture);
  if (!fixture) throw new Error("Benchmark approval fixture identity is invalid.");
  for (const [label, value] of [
    ["taskId", input.taskId],
    ["runId", input.runId],
    ["conversationId", input.conversationId],
  ]) {
    if (!isNonEmptyString(value)) throw new Error(`Benchmark approval ${label} is required.`);
  }
  if (input.manifestRevision !== "v2") {
    throw new Error("Benchmark fixture approval is available only for manifest revision v2.");
  }
  return {
    schemaVersion: BENCHMARK_APPROVAL_CONTRACT_VERSION,
    manifestRevision: "v2",
    taskId: input.taskId.trim(),
    runId: input.runId.trim(),
    conversationId: input.conversationId.trim(),
    fixture,
    policy,
  };
}

export async function loadBenchmarkApprovalContract(contractPath) {
  const text = await fs.readFile(contractPath, "utf-8");
  const parsed = JSON.parse(text);
  const contract = createBenchmarkApprovalContract(parsed);
  if (parsed.schemaVersion !== BENCHMARK_APPROVAL_CONTRACT_VERSION) {
    throw new Error("Benchmark approval contract version is invalid.");
  }
  return { contract, contractSha256: sha256(text) };
}

export function createBenchmarkApprovalController(input) {
  if (typeof input.respondPermission !== "function") {
    throw new Error("Benchmark approval controller requires a permission responder.");
  }
  const contract = createBenchmarkApprovalContract(input.contract);
  const contractSha256 = normalizeSha256(input.contractSha256);
  if (!contractSha256) throw new Error("Benchmark approval contract hash is invalid.");

  const started = new Map();
  const seenStartedIds = new Set();
  const seenPermissionIds = new Set();
  const matchedStepIndexes = new Set();
  const requests = [];
  const issues = [];
  let binding = null;
  let nextStepIndex = 0;
  let jobId;

  const observe = async (event) => {
    if (!isRecord(event) || !isRecord(event.binding)) return;
    if (event.type === "run.started") {
      const candidate = readBinding(event.binding);
      if (!candidate || candidate.conversationId !== contract.conversationId) {
        issues.push("run_binding_mismatch");
        return;
      }
      if (binding && !sameBinding(binding, candidate)) issues.push("run_binding_changed");
      binding = candidate;
      return;
    }
    if (event.type === "tool.started") {
      observeToolStarted(event);
      return;
    }
    if (event.type === "tool.completed") {
      observeToolCompleted(event);
      return;
    }
    if (event.type === "permission.requested") {
      await resolvePermission(event);
    }
  };

  const observeToolStarted = (event) => {
    const tool = isRecord(event.payload) && isRecord(event.payload.tool) ? event.payload.tool : undefined;
    const toolCallId = isNonEmptyString(tool?.id) ? tool.id.trim() : "";
    if (!bindingMatches(event.binding) || !toolCallId || !isNonEmptyString(tool?.name) || !isRecord(tool?.arguments)) {
      issues.push("invalid_tool_started");
      return;
    }
    if (seenStartedIds.has(toolCallId)) {
      issues.push("reused_tool_call_id");
      return;
    }
    seenStartedIds.add(toolCallId);
    started.set(toolCallId, {
      toolName: tool.name.trim(),
      arguments: structuredClone(tool.arguments),
    });
  };

  const observeToolCompleted = (event) => {
    const tool = isRecord(event.payload) && isRecord(event.payload.tool) ? event.payload.tool : undefined;
    const toolCallId = isNonEmptyString(tool?.id) ? tool.id.trim() : "";
    const call = started.get(toolCallId);
    if (!bindingMatches(event.binding) || !call || call.toolName !== "command_job"
      || call.arguments.action !== "start" || tool?.success !== true || typeof tool.output !== "string") return;
    try {
      const parsed = JSON.parse(tool.output);
      if (!isRecord(parsed) || !isNonEmptyString(parsed.jobId) || !JOB_ID_PATTERN.test(parsed.jobId.trim())) {
        issues.push("invalid_started_job_id");
        return;
      }
      jobId = parsed.jobId.trim();
    } catch {
      issues.push("invalid_started_job_output");
    }
  };

  const resolvePermission = async (event) => {
    const permission = isRecord(event.payload) && isRecord(event.payload.permission)
      ? event.payload.permission
      : undefined;
    const eventBinding = readBinding(event.binding);
    const toolCallId = isNonEmptyString(permission?.toolCallId) ? permission.toolCallId.trim() : "";
    const toolName = isNonEmptyString(permission?.toolName) ? permission.toolName.trim() : "";
    const action = isRecord(permission?.commandPreview) && isNonEmptyString(permission.commandPreview.action)
      ? permission.commandPreview.action.trim()
      : null;
    const call = toolCallId ? started.get(toolCallId) : undefined;
    let decision = "deny";
    let reason = "invalid_request";
    let matchedStepIndex = -1;

    if (!eventBinding || !binding || !sameBinding(eventBinding, binding)) {
      reason = "run_binding_mismatch";
    } else if (!toolCallId || !toolName || !call) {
      reason = "missing_started_tool";
    } else if (seenPermissionIds.has(toolCallId)) {
      reason = "reused_tool_call_id";
    } else if (call.toolName !== toolName) {
      reason = "tool_name_mismatch";
    } else if (contract.policy.mode === "allow_exact_sequence") {
      const step = contract.policy.steps[nextStepIndex];
      const expectedArguments = step ? substituteJobId(step.arguments, jobId) : undefined;
      if (!step || step.toolName !== toolName) {
        reason = "unexpected_tool";
      } else if (!expectedArguments || stableStringify(call.arguments) !== stableStringify(expectedArguments)) {
        reason = "operation_mismatch";
      } else if (!matchesPermissionPreview(permission, step, expectedArguments)) {
        reason = "permission_preview_mismatch";
      } else {
        decision = "allow";
        reason = "exact_fixture_step";
        matchedStepIndex = nextStepIndex;
      }
    } else {
      matchedStepIndex = contract.policy.steps.findIndex((step, index) => (
        !matchedStepIndexes.has(index)
          && step.toolName === toolName
          && stableStringify(call.arguments) === stableStringify(substituteJobId(step.arguments, jobId))
      ));
      reason = matchedStepIndex >= 0 ? "safety_probe_deny" : "undeclared_safety_probe";
    }

    if (toolCallId) seenPermissionIds.add(toolCallId);
    let responseStatus = "not_sent";
    let responseErrorCode;
    let responseError;
    try {
      if (!eventBinding || !toolCallId) throw new Error("Permission binding is incomplete.");
      const response = await input.respondPermission({
        binding: {
          agentRunId: eventBinding.agentRunId,
          ...(isNonEmptyString(permission?.worktreeId) ? { worktreeId: permission.worktreeId.trim() } : {}),
        },
        toolCallId,
        decision,
      });
      responseStatus = response?.ok === true ? "accepted" : "rejected";
      if (responseStatus === "rejected") {
        responseErrorCode = sanitizeResponseDiagnostic(response?.errorCode, 100);
        responseError = sanitizeResponseDiagnostic(response?.error, MAX_RESPONSE_DIAGNOSTIC_LENGTH);
      }
    } catch (error) {
      responseStatus = "error";
      responseError = sanitizeResponseDiagnostic(
        error instanceof Error ? error.message : error,
        MAX_RESPONSE_DIAGNOSTIC_LENGTH,
      );
    }

    requests.push({
      seq: Number.isSafeInteger(event.seq) && event.seq > 0 ? event.seq : 0,
      binding: eventBinding ?? { conversationId: "invalid", agentRunId: "invalid" },
      toolCallId: toolCallId || "invalid",
      toolName: toolName || "invalid",
      action,
      operationSha256: call ? sha256(stableStringify(call.arguments)) : null,
      decision,
      reason,
      responseStatus,
      ...(responseErrorCode ? { responseErrorCode } : {}),
      ...(responseError ? { responseError } : {}),
    });

    if (responseStatus !== "accepted") issues.push("permission_response_failed");
    if (decision === "allow" && responseStatus === "accepted") {
      matchedStepIndexes.add(matchedStepIndex);
      nextStepIndex += 1;
    } else if (contract.policy.mode === "allow_exact_sequence") {
      issues.push(reason);
    } else if (matchedStepIndex >= 0 && responseStatus === "accepted") {
      matchedStepIndexes.add(matchedStepIndex);
    } else if (matchedStepIndex < 0) {
      issues.push(reason);
    }
  };

  const bindingMatches = (candidate) => {
    const parsed = readBinding(candidate);
    return Boolean(binding && parsed && sameBinding(binding, parsed));
  };

  const finalize = () => {
    const expectedCount = contract.policy.steps.length;
    const complete = Boolean(binding)
      && issues.length === 0
      && matchedStepIndexes.size === expectedCount
      && requests.length === expectedCount
      && (contract.policy.mode !== "allow_exact_sequence" || nextStepIndex === expectedCount);
    return {
      schemaVersion: BENCHMARK_APPROVAL_EVIDENCE_VERSION,
      manifestRevision: "v2",
      taskId: contract.taskId,
      runId: contract.runId,
      contractSha256,
      fixture: structuredClone(contract.fixture),
      policyMode: contract.policy.mode,
      status: complete ? "passed" : "failed",
      binding,
      requests: structuredClone(requests),
      summary: {
        expectedRequestCount: expectedCount,
        requestCount: requests.length,
        allowedCount: requests.filter((item) => item.decision === "allow").length,
        deniedCount: requests.filter((item) => item.decision === "deny").length,
        responseFailureCount: requests.filter((item) => item.responseStatus !== "accepted").length,
        issueCount: issues.length,
      },
    };
  };

  return { observe, finalize };
}

export function createNotRunApprovalEvidence(input) {
  return {
    schemaVersion: BENCHMARK_APPROVAL_EVIDENCE_VERSION,
    manifestRevision: "v2",
    taskId: input.taskId,
    runId: input.runId,
    contractSha256: input.contractSha256,
    fixture: structuredClone(input.fixture),
    policyMode: input.policyMode,
    status: "not_run",
    binding: null,
    requests: [],
    summary: {
      expectedRequestCount: input.expectedRequestCount,
      requestCount: 0,
      allowedCount: 0,
      deniedCount: 0,
      responseFailureCount: 0,
      issueCount: 0,
    },
  };
}

export function serializeBenchmarkApprovalContract(contract) {
  return `${JSON.stringify(createBenchmarkApprovalContract(contract), null, 2)}\n`;
}

function normalizePolicy(value) {
  if (!isRecord(value)
    || (value.mode !== "allow_exact_sequence" && value.mode !== "deny_exact_set")
    || !Array.isArray(value.steps) || value.steps.length < 1) return undefined;
  const steps = [];
  for (const step of value.steps) {
    if (!isRecord(step) || !isNonEmptyString(step.toolName)
      || !isNonEmptyString(step.action) || !isRecord(step.arguments)) return undefined;
    if (step.toolName === "command_job" && step.arguments.action !== step.action) return undefined;
    if (step.toolName === "run_command" && step.action !== "run") return undefined;
    steps.push({
      toolName: step.toolName.trim(),
      action: step.action.trim(),
      arguments: structuredClone(step.arguments),
    });
  }
  return { mode: value.mode, steps };
}

function normalizeFixture(value) {
  if (!isRecord(value) || !isNonEmptyString(value.generatorId)
    || !Number.isSafeInteger(value.version) || value.version < 1
    || !normalizeGitCommit(value.baselineCommit) || !isNonEmptyString(value.path)
    || !normalizeSha256(value.sha256)) return undefined;
  return {
    generatorId: value.generatorId.trim(),
    version: value.version,
    baselineCommit: value.baselineCommit.toLowerCase(),
    path: value.path.replace(/\\/g, "/"),
    sha256: value.sha256.toLowerCase(),
  };
}

function matchesPermissionPreview(permission, step, expectedArguments) {
  if (step.toolName !== "command_job") return true;
  const preview = isRecord(permission.commandPreview) ? permission.commandPreview : undefined;
  if (!preview || preview.action !== step.action) return false;
  if (step.action === "start") {
    const plan = expectedArguments.commandPlan;
    const previewPlan = isRecord(preview.commandPlan) ? preview.commandPlan : undefined;
    if (!isRecord(plan) || !previewPlan) return false;
    return stableStringify(previewPlan) === stableStringify({
      executable: plan.executable,
      argv: plan.argv ?? [],
      cwd: plan.cwd ?? ".",
      environmentKeys: Object.keys(isRecord(plan.env) ? plan.env : {}).sort(),
      network: plan.network ?? "none",
      writeScope: plan.writeScope ?? "workspace-readonly",
      stdinMode: plan.stdinMode ?? "closed",
      ...(plan.timeoutMs === undefined ? {} : { timeoutMs: plan.timeoutMs }),
    });
  }
  if (preview.jobId !== expectedArguments.jobId) return false;
  if (step.action === "write") return preview.stdinProvided === true;
  if (step.action === "resize") return preview.cols === expectedArguments.cols && preview.rows === expectedArguments.rows;
  if (step.action === "read") {
    return preview.cursor === expectedArguments.cursor && preview.maxBytes === expectedArguments.maxBytes;
  }
  return true;
}

function substituteJobId(value, jobId) {
  if (value === BENCHMARK_JOB_ID_PLACEHOLDER) return jobId;
  if (Array.isArray(value)) return value.map((item) => substituteJobId(item, jobId));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteJobId(item, jobId)]));
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function readBinding(value) {
  if (!isRecord(value) || !isNonEmptyString(value.conversationId) || !isNonEmptyString(value.agentRunId)) return undefined;
  return { conversationId: value.conversationId.trim(), agentRunId: value.agentRunId.trim() };
}

function sameBinding(left, right) {
  return left.conversationId === right.conversationId && left.agentRunId === right.agentRunId;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function normalizeGitCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined;
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function sanitizeResponseDiagnostic(value, maxLength) {
  if (!isNonEmptyString(value)) return undefined;
  return value
    .trim()
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)[\w-]*)\s*([:=])\s*(?:Bearer\s+)?[^\s,;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .slice(0, maxLength);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
