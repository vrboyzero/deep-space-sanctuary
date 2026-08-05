import crypto from "node:crypto";

import type {
  AgentRunEvent,
  AgentRunEventType,
  CodingRunErrorCode,
  CodingRunUsageCompleteness,
} from "./contracts.js";
import { CODING_RUN_TRACE_POLICY } from "./contracts.js";

export { CODING_RUN_TRACE_POLICY } from "./contracts.js";

export type CodingRunTraceDomain = "run" | "prompt" | "agent" | "tool" | "policy" | "recovery";

export type CodingRunTraceEventName =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.interrupted"
  | "prompt.accepted"
  | "agent.started"
  | "agent.status_observed"
  | "agent.output_delta_observed"
  | "agent.usage_observed"
  | "tool.started"
  | "tool.completed"
  | "policy.approval_requested"
  | "policy.enforced"
  | "policy.budget_exhausted"
  | "recovery.checkpoint_observed"
  | "recovery.interrupted"
  | "recovery.gateway_unavailable";

export type CodingRunTraceOutcome =
  | "started"
  | "observed"
  | "requested"
  | "succeeded"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled"
  | "interrupted";

export type CodingRunTraceCorrelation = {
  agentRunId: string;
  conversationId?: string;
  promptId: string;
  agentId: string;
  toolCallId?: string;
  policyId?: string;
  recoveryId?: string;
  worktreeId?: string;
  workspaceCheckpointId?: string;
};

export type CodingRunTraceAttributes = {
  toolName?: string;
  toolSuccess?: boolean;
  failureKind?: "input_error" | "permission_or_policy" | "environment_error" | "business_logic_error" | "unknown";
  outputBytes?: number;
  usageStatus?: CodingRunUsageCompleteness["status"];
  usageReason?: CodingRunUsageCompleteness["reason"];
  modelCalls?: number;
  providerReportedModelCalls?: number;
  errorCode?: CodingRunErrorCode;
  hadPartialResponse?: boolean;
  recoveryGuarantee?: "exact" | "managed_worktree" | "detect_only";
};

export type CodingRunTraceEvent = {
  schemaVersion: typeof CODING_RUN_TRACE_POLICY.schemaVersion;
  seq: number;
  sourceSeq: number;
  timestampMs: number;
  domain: CodingRunTraceDomain;
  event: CodingRunTraceEventName;
  outcome: CodingRunTraceOutcome;
  correlation: CodingRunTraceCorrelation;
  attributes?: CodingRunTraceAttributes;
  content: {
    mode: typeof CODING_RUN_TRACE_POLICY.contentMode;
  };
};

export type CodingRunTraceValidation = {
  schemaVersion: typeof CODING_RUN_TRACE_POLICY.schemaVersion;
  contentMode: typeof CODING_RUN_TRACE_POLICY.contentMode;
  binding: {
    agentRunId: string;
    conversationId?: string;
  };
  sourceEventCount: number;
  traceEventCount: number;
  terminal: Extract<AgentRunEventType, "run.completed" | "run.failed" | "run.cancelled" | "run.interrupted">;
};

export const codingRunTraceEventV1JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://star-sanctuary.dev/schemas/coding-run-trace-v1.json",
  title: "Star Sanctuary CodingRunTraceEvent v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "seq",
    "sourceSeq",
    "timestampMs",
    "domain",
    "event",
    "outcome",
    "correlation",
    "content",
  ],
  properties: {
    schemaVersion: { const: CODING_RUN_TRACE_POLICY.schemaVersion },
    seq: { type: "integer", minimum: 1 },
    sourceSeq: { type: "integer", minimum: 1 },
    timestampMs: { type: "integer", minimum: 0 },
    domain: { enum: ["run", "prompt", "agent", "tool", "policy", "recovery"] },
    event: {
      enum: [
        "run.started",
        "run.completed",
        "run.failed",
        "run.cancelled",
        "run.interrupted",
        "prompt.accepted",
        "agent.started",
        "agent.status_observed",
        "agent.output_delta_observed",
        "agent.usage_observed",
        "tool.started",
        "tool.completed",
        "policy.approval_requested",
        "policy.enforced",
        "policy.budget_exhausted",
        "recovery.checkpoint_observed",
        "recovery.interrupted",
        "recovery.gateway_unavailable",
      ],
    },
    outcome: {
      enum: [
        "started",
        "observed",
        "requested",
        "succeeded",
        "completed",
        "failed",
        "denied",
        "cancelled",
        "interrupted",
      ],
    },
    correlation: {
      type: "object",
      additionalProperties: false,
      required: ["agentRunId", "promptId", "agentId"],
      properties: {
        agentRunId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        conversationId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        promptId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        agentId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        toolCallId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        policyId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        recoveryId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        worktreeId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
        workspaceCheckpointId: { type: "string", pattern: "^[A-Za-z0-9._:/-]{1,256}$" },
      },
    },
    attributes: {
      type: "object",
      additionalProperties: false,
      properties: {
        toolName: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        toolSuccess: { type: "boolean" },
        failureKind: {
          enum: ["input_error", "permission_or_policy", "environment_error", "business_logic_error", "unknown"],
        },
        outputBytes: { type: "integer", minimum: 0 },
        usageStatus: { enum: ["complete", "incomplete"] },
        usageReason: {
          enum: [
            "provider_reported_all_model_calls",
            "provider_usage_missing",
            "reporting_count_unavailable",
            "usage_not_reported",
          ],
        },
        modelCalls: { type: "integer", minimum: 0 },
        providerReportedModelCalls: { type: "integer", minimum: 0 },
        errorCode: {
          enum: [
            "invalid_request",
            "not_found",
            "run_mismatch",
            "not_active",
            "permission_required",
            "permission_denied",
            "policy_denied",
            "budget_exhausted",
            "cancelled",
            "interrupted",
            "output_schema_invalid",
            "gateway_unavailable",
            "internal",
          ],
        },
        hadPartialResponse: { type: "boolean" },
        recoveryGuarantee: { enum: ["exact", "managed_worktree", "detect_only"] },
      },
    },
    content: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { const: CODING_RUN_TRACE_POLICY.contentMode },
      },
    },
  },
} as const;

const TRACE_DOMAINS = new Set<CodingRunTraceDomain>(["run", "prompt", "agent", "tool", "policy", "recovery"]);
const TRACE_EVENTS = new Set<CodingRunTraceEventName>([
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
  "prompt.accepted",
  "agent.started",
  "agent.status_observed",
  "agent.output_delta_observed",
  "agent.usage_observed",
  "tool.started",
  "tool.completed",
  "policy.approval_requested",
  "policy.enforced",
  "policy.budget_exhausted",
  "recovery.checkpoint_observed",
  "recovery.interrupted",
  "recovery.gateway_unavailable",
]);
const TRACE_OUTCOMES = new Set<CodingRunTraceOutcome>([
  "started",
  "observed",
  "requested",
  "succeeded",
  "completed",
  "failed",
  "denied",
  "cancelled",
  "interrupted",
]);
const TERMINAL_TRACE_EVENTS = new Set<CodingRunTraceEventName>([
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
]);
const TRACE_EVENT_DOMAINS: Record<CodingRunTraceEventName, CodingRunTraceDomain> = {
  "run.started": "run",
  "run.completed": "run",
  "run.failed": "run",
  "run.cancelled": "run",
  "run.interrupted": "run",
  "prompt.accepted": "prompt",
  "agent.started": "agent",
  "agent.status_observed": "agent",
  "agent.output_delta_observed": "agent",
  "agent.usage_observed": "agent",
  "tool.started": "tool",
  "tool.completed": "tool",
  "policy.approval_requested": "policy",
  "policy.enforced": "policy",
  "policy.budget_exhausted": "policy",
  "recovery.checkpoint_observed": "recovery",
  "recovery.interrupted": "recovery",
  "recovery.gateway_unavailable": "recovery",
};
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:/-]{1,256}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const FAILURE_KINDS = new Set<NonNullable<CodingRunTraceAttributes["failureKind"]>>([
  "input_error",
  "permission_or_policy",
  "environment_error",
  "business_logic_error",
  "unknown",
]);
const USAGE_REASONS = new Set<CodingRunUsageCompleteness["reason"]>([
  "provider_reported_all_model_calls",
  "provider_usage_missing",
  "reporting_count_unavailable",
  "usage_not_reported",
]);
const ERROR_CODES = new Set<CodingRunErrorCode>([
  "invalid_request",
  "not_found",
  "run_mismatch",
  "not_active",
  "permission_required",
  "permission_denied",
  "policy_denied",
  "budget_exhausted",
  "cancelled",
  "interrupted",
  "output_schema_invalid",
  "gateway_unavailable",
  "internal",
]);
const TRACE_ATTRIBUTE_KEYS = new Set([
  "toolName",
  "toolSuccess",
  "failureKind",
  "outputBytes",
  "usageStatus",
  "usageReason",
  "modelCalls",
  "providerReportedModelCalls",
  "errorCode",
  "hadPartialResponse",
  "recoveryGuarantee",
]);
const TRACE_CORRELATION_KEYS = new Set([
  "agentRunId",
  "conversationId",
  "promptId",
  "agentId",
  "toolCallId",
  "policyId",
  "recoveryId",
  "worktreeId",
  "workspaceCheckpointId",
]);

export function projectCodingRunTraceEvents(events: AgentRunEvent[]): CodingRunTraceEvent[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("Coding run trace requires at least one AgentRunEvent.");
  }
  const started = events[0];
  if (!started || started.type !== "run.started") {
    throw new Error("Coding run trace requires run.started as the first source event.");
  }
  const traceContext = readRecord(started.payload.traceContext);
  const baseCorrelation: CodingRunTraceCorrelation = {
    agentRunId: requireIdentifier(started.binding.agentRunId, "agentRunId"),
    ...(readIdentifier(started.binding.conversationId) ? { conversationId: readIdentifier(started.binding.conversationId) } : {}),
    promptId: readIdentifier(traceContext?.promptId)
      ?? createTraceLocalId("prompt", requireIdentifier(started.binding.agentRunId, "agentRunId")),
    agentId: readIdentifier(traceContext?.agentId) ?? "unknown",
    ...(readIdentifier(started.binding.worktreeId) ? { worktreeId: readIdentifier(started.binding.worktreeId) } : {}),
    ...(readIdentifier(started.binding.workspaceCheckpoint?.workspaceCheckpointId)
      ? { workspaceCheckpointId: readIdentifier(started.binding.workspaceCheckpoint?.workspaceCheckpointId) }
      : {}),
  };
  const result: CodingRunTraceEvent[] = [];
  const append = (
    source: AgentRunEvent,
    domain: CodingRunTraceDomain,
    event: CodingRunTraceEventName,
    outcome: CodingRunTraceOutcome,
    options: {
      correlation?: Partial<CodingRunTraceCorrelation>;
      attributes?: CodingRunTraceAttributes;
    } = {},
  ) => {
    result.push({
      schemaVersion: CODING_RUN_TRACE_POLICY.schemaVersion,
      seq: result.length + 1,
      sourceSeq: source.seq,
      timestampMs: source.timestampMs,
      domain,
      event,
      outcome,
      correlation: {
        ...baseCorrelation,
        ...options.correlation,
      },
      ...(options.attributes && Object.keys(options.attributes).length > 0
        ? { attributes: options.attributes }
        : {}),
      content: { mode: CODING_RUN_TRACE_POLICY.contentMode },
    });
  };

  for (const source of events) {
    assertMatchingSourceEvent(source, started);
    projectSourceEvent({ source, baseCorrelation, append });
  }
  return result;
}

export function validateCodingRunTraceEvents(events: CodingRunTraceEvent[]): CodingRunTraceValidation {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("Coding run trace is empty.");
  }
  const first = events[0];
  if (!first || first.event !== "run.started") {
    throw new Error("Coding run trace must start with run.started.");
  }
  const sourceSequences = new Set<number>();
  let previousSourceSeq = 0;
  let terminalSourceSeq: number | undefined;
  let terminal: CodingRunTraceValidation["terminal"] | undefined;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isCodingRunTraceEventV1(event)) {
      throw new Error(`Coding run trace event ${index + 1} is invalid.`);
    }
    if (event.seq !== index + 1) {
      throw new Error(`Coding run trace sequence is not continuous at event ${index + 1}.`);
    }
    if (event.sourceSeq < previousSourceSeq) {
      throw new Error(`Coding run trace source sequence moved backwards at event ${index + 1}.`);
    }
    if (event.correlation.agentRunId !== first.correlation.agentRunId
      || event.correlation.conversationId !== first.correlation.conversationId
      || event.correlation.promptId !== first.correlation.promptId
      || event.correlation.agentId !== first.correlation.agentId) {
      throw new Error(`Coding run trace correlation changed at event ${index + 1}.`);
    }
    sourceSequences.add(event.sourceSeq);
    previousSourceSeq = event.sourceSeq;
    if (TERMINAL_TRACE_EVENTS.has(event.event)) {
      if (terminal) throw new Error("Coding run trace contains more than one run terminal event.");
      terminal = event.event as CodingRunTraceValidation["terminal"];
      terminalSourceSeq = event.sourceSeq;
    }
  }
  if (!terminal) throw new Error("Coding run trace is missing a run terminal event.");
  for (let sourceSeq = 1; sourceSeq <= sourceSequences.size; sourceSeq += 1) {
    if (!sourceSequences.has(sourceSeq)) {
      throw new Error(`Coding run trace source sequence is not continuous at source event ${sourceSeq}.`);
    }
  }
  if (terminalSourceSeq !== previousSourceSeq) {
    throw new Error("Coding run trace contains source events after its run terminal event.");
  }
  if (!events.some((event) => event.event === "prompt.accepted")
    || !events.some((event) => event.event === "agent.started")) {
    throw new Error("Coding run trace is missing prompt or agent correlation records.");
  }
  return {
    schemaVersion: CODING_RUN_TRACE_POLICY.schemaVersion,
    contentMode: CODING_RUN_TRACE_POLICY.contentMode,
    binding: {
      agentRunId: first.correlation.agentRunId,
      ...(first.correlation.conversationId ? { conversationId: first.correlation.conversationId } : {}),
    },
    sourceEventCount: sourceSequences.size,
    traceEventCount: events.length,
    terminal,
  };
}

export function isCodingRunTraceEventV1(value: unknown): value is CodingRunTraceEvent {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion",
    "seq",
    "sourceSeq",
    "timestampMs",
    "domain",
    "event",
    "outcome",
    "correlation",
    "attributes",
    "content",
  ])) return false;
  if (value.schemaVersion !== CODING_RUN_TRACE_POLICY.schemaVersion
    || !isPositiveInteger(value.seq)
    || !isPositiveInteger(value.sourceSeq)
    || !isNonNegativeInteger(value.timestampMs)
    || typeof value.domain !== "string"
    || !TRACE_DOMAINS.has(value.domain as CodingRunTraceDomain)
    || typeof value.event !== "string"
    || !TRACE_EVENTS.has(value.event as CodingRunTraceEventName)
    || TRACE_EVENT_DOMAINS[value.event as CodingRunTraceEventName] !== value.domain
    || typeof value.outcome !== "string"
    || !TRACE_OUTCOMES.has(value.outcome as CodingRunTraceOutcome)
    || !isTraceCorrelation(value.correlation)
    || !isRecord(value.content)
    || !hasOnlyKeys(value.content, ["mode"])
    || value.content.mode !== CODING_RUN_TRACE_POLICY.contentMode) {
    return false;
  }
  return value.attributes === undefined || isTraceAttributes(value.attributes);
}

function projectSourceEvent(input: {
  source: AgentRunEvent;
  baseCorrelation: CodingRunTraceCorrelation;
  append: (
    source: AgentRunEvent,
    domain: CodingRunTraceDomain,
    event: CodingRunTraceEventName,
    outcome: CodingRunTraceOutcome,
    options?: { correlation?: Partial<CodingRunTraceCorrelation>; attributes?: CodingRunTraceAttributes },
  ) => void;
}): void {
  const { source, append } = input;
  if (source.type === "run.started") {
    append(source, "run", "run.started", "started");
    append(source, "prompt", "prompt.accepted", "observed");
    append(source, "agent", "agent.started", "started");
    if (input.baseCorrelation.workspaceCheckpointId && source.binding.workspaceCheckpoint) {
      append(source, "recovery", "recovery.checkpoint_observed", "observed", {
        correlation: { recoveryId: input.baseCorrelation.workspaceCheckpointId },
        attributes: { recoveryGuarantee: source.binding.workspaceCheckpoint.recoveryGuarantee },
      });
    }
    return;
  }
  if (source.type === "run.status") {
    append(source, "agent", "agent.status_observed", "observed");
    return;
  }
  if (source.type === "message.delta") {
    const delta = typeof source.payload.delta === "string" ? source.payload.delta : "";
    append(source, "agent", "agent.output_delta_observed", "observed", {
      attributes: { outputBytes: new TextEncoder().encode(delta).byteLength },
    });
    return;
  }
  if (source.type === "run.usage") {
    append(source, "agent", "agent.usage_observed", "observed", {
      attributes: readUsageAttributes(source.payload.usage),
    });
    return;
  }
  if (source.type === "tool.started") {
    const tool = readRecord(source.payload.tool);
    const toolCallId = readIdentifier(tool?.id);
    append(source, "tool", "tool.started", "started", {
      ...(toolCallId ? { correlation: { toolCallId } } : {}),
      attributes: readToolAttributes(tool),
    });
    return;
  }
  if (source.type === "tool.completed") {
    const tool = readRecord(source.payload.tool);
    const toolCallId = readIdentifier(tool?.id);
    const toolAttributes = readToolAttributes(tool);
    const success = tool?.success === true;
    append(source, "tool", "tool.completed", success ? "succeeded" : "failed", {
      ...(toolCallId ? { correlation: { toolCallId } } : {}),
      attributes: toolAttributes,
    });
    if (!success && toolAttributes.failureKind === "permission_or_policy" && toolCallId) {
      append(source, "policy", "policy.enforced", "denied", {
        correlation: {
          toolCallId,
          policyId: createPolicyId(input.baseCorrelation.agentRunId, toolCallId),
        },
        attributes: toolAttributes,
      });
    }
    return;
  }
  if (source.type === "permission.requested") {
    const permission = readRecord(source.payload.permission);
    const toolCallId = readIdentifier(permission?.toolCallId);
    append(source, "policy", "policy.approval_requested", "requested", {
      ...(toolCallId
        ? {
          correlation: {
            toolCallId,
            policyId: createPolicyId(input.baseCorrelation.agentRunId, toolCallId),
          },
        }
        : {}),
      attributes: readPermissionAttributes(permission),
    });
    return;
  }
  if (source.type === "run.budget_exhausted") {
    append(source, "policy", "policy.budget_exhausted", "denied");
    return;
  }
  if (source.type === "run.completed") {
    append(source, "run", "run.completed", "completed", {
      attributes: readUsageAttributes(source.payload.usage),
    });
    return;
  }
  if (source.type === "run.cancelled") {
    append(source, "run", "run.cancelled", "cancelled", {
      attributes: readPartialResponseAttributes(source.payload),
    });
    return;
  }
  if (source.type === "run.interrupted") {
    const recoveryId = input.baseCorrelation.workspaceCheckpointId
      ?? createTraceLocalId("recovery", input.baseCorrelation.agentRunId);
    append(source, "run", "run.interrupted", "interrupted", {
      attributes: {
        ...readErrorAttributes(source.payload),
        ...readPartialResponseAttributes(readRecord(source.payload.interrupted)),
        ...readUsageAttributes(source.payload.usage),
      },
    });
    append(source, "recovery", "recovery.interrupted", "interrupted", {
      correlation: { recoveryId },
      attributes: {
        ...readErrorAttributes(source.payload),
        ...readPartialResponseAttributes(readRecord(source.payload.interrupted)),
      },
    });
    return;
  }
  if (source.type === "run.failed") {
    const errorAttributes = readErrorAttributes(source.payload);
    append(source, "run", "run.failed", "failed", {
      attributes: {
        ...errorAttributes,
        ...readUsageAttributes(source.payload.usage),
      },
    });
    if (errorAttributes.errorCode === "gateway_unavailable") {
      append(source, "recovery", "recovery.gateway_unavailable", "failed", {
        correlation: {
          recoveryId: input.baseCorrelation.workspaceCheckpointId
            ?? createTraceLocalId("recovery", input.baseCorrelation.agentRunId),
        },
        attributes: errorAttributes,
      });
    }
  }
}

function assertMatchingSourceEvent(event: AgentRunEvent, started: AgentRunEvent): void {
  if (!isPositiveInteger(event.seq) || !isNonNegativeInteger(event.timestampMs)) {
    throw new Error("Coding run trace source event sequence or timestamp is invalid.");
  }
  if (event.binding.agentRunId !== started.binding.agentRunId
    || event.binding.conversationId !== started.binding.conversationId) {
    throw new Error("Coding run trace source binding changed.");
  }
}

function readToolAttributes(tool: Record<string, unknown> | undefined): CodingRunTraceAttributes {
  const attributes: CodingRunTraceAttributes = {};
  const toolName = readToolName(tool?.name);
  if (toolName) attributes.toolName = toolName;
  if (typeof tool?.success === "boolean") attributes.toolSuccess = tool.success;
  if (typeof tool?.failureKind === "string" && FAILURE_KINDS.has(tool.failureKind as NonNullable<CodingRunTraceAttributes["failureKind"]>)) {
    attributes.failureKind = tool.failureKind as NonNullable<CodingRunTraceAttributes["failureKind"]>;
  }
  return attributes;
}

function readPermissionAttributes(permission: Record<string, unknown> | undefined): CodingRunTraceAttributes {
  const toolName = readToolName(permission?.toolName);
  return toolName ? { toolName } : {};
}

function readUsageAttributes(value: unknown): CodingRunTraceAttributes {
  const usage = readRecord(value);
  if (!usage) return {};
  const attributes: CodingRunTraceAttributes = {};
  if (usage.status === "complete" || usage.status === "incomplete") attributes.usageStatus = usage.status;
  if (typeof usage.reason === "string" && USAGE_REASONS.has(usage.reason as CodingRunUsageCompleteness["reason"])) {
    attributes.usageReason = usage.reason as CodingRunUsageCompleteness["reason"];
  }
  if (isNonNegativeInteger(usage.modelCalls)) attributes.modelCalls = usage.modelCalls;
  if (isNonNegativeInteger(usage.providerReportedModelCalls)) {
    attributes.providerReportedModelCalls = usage.providerReportedModelCalls;
  }
  const completeness = readRecord(usage.completeness);
  if (completeness) return { ...attributes, ...readUsageAttributes(completeness) };
  return attributes;
}

function readErrorAttributes(payload: Record<string, unknown>): CodingRunTraceAttributes {
  const error = readRecord(payload.error);
  return typeof error?.code === "string" && ERROR_CODES.has(error.code as CodingRunErrorCode)
    ? { errorCode: error.code as CodingRunErrorCode }
    : {};
}

function readPartialResponseAttributes(value: unknown): CodingRunTraceAttributes {
  const record = readRecord(value);
  return typeof record?.hadPartialResponse === "boolean"
    ? { hadPartialResponse: record.hadPartialResponse }
    : {};
}

function isTraceCorrelation(value: unknown): value is CodingRunTraceCorrelation {
  if (!isRecord(value) || !hasOnlyKeys(value, [...TRACE_CORRELATION_KEYS])) return false;
  if (!readIdentifier(value.agentRunId) || !readIdentifier(value.promptId) || !readIdentifier(value.agentId)) return false;
  return [
    "conversationId",
    "toolCallId",
    "policyId",
    "recoveryId",
    "worktreeId",
    "workspaceCheckpointId",
  ].every((key) => value[key] === undefined || Boolean(readIdentifier(value[key])));
}

function isTraceAttributes(value: unknown): value is CodingRunTraceAttributes {
  if (!isRecord(value) || !hasOnlyKeys(value, [...TRACE_ATTRIBUTE_KEYS])) return false;
  if (value.toolName !== undefined && !readToolName(value.toolName)) return false;
  if (value.toolSuccess !== undefined && typeof value.toolSuccess !== "boolean") return false;
  if (value.failureKind !== undefined
    && (typeof value.failureKind !== "string"
      || !FAILURE_KINDS.has(value.failureKind as NonNullable<CodingRunTraceAttributes["failureKind"]>))) return false;
  if (value.outputBytes !== undefined && !isNonNegativeInteger(value.outputBytes)) return false;
  if (value.usageStatus !== undefined && value.usageStatus !== "complete" && value.usageStatus !== "incomplete") return false;
  if (value.usageReason !== undefined
    && (typeof value.usageReason !== "string"
      || !USAGE_REASONS.has(value.usageReason as CodingRunUsageCompleteness["reason"]))) return false;
  if (value.modelCalls !== undefined && !isNonNegativeInteger(value.modelCalls)) return false;
  if (value.providerReportedModelCalls !== undefined && !isNonNegativeInteger(value.providerReportedModelCalls)) return false;
  if (value.errorCode !== undefined
    && (typeof value.errorCode !== "string" || !ERROR_CODES.has(value.errorCode as CodingRunErrorCode))) return false;
  if (value.hadPartialResponse !== undefined && typeof value.hadPartialResponse !== "boolean") return false;
  return value.recoveryGuarantee === undefined
    || value.recoveryGuarantee === "exact"
    || value.recoveryGuarantee === "managed_worktree"
    || value.recoveryGuarantee === "detect_only";
}

function createPolicyId(agentRunId: string, toolCallId: string): string {
  return createTraceLocalId("policy", agentRunId, toolCallId);
}

function createTraceLocalId(prefix: "prompt" | "policy" | "recovery", ...parts: string[]): string {
  const readable = `${prefix}:${parts.join(":")}`;
  if (IDENTIFIER_PATTERN.test(readable)) return readable;
  const digest = crypto.createHash("sha256")
    .update(`coding-run-trace-id/v1\0${prefix}\0${parts.join("\0")}`)
    .digest("hex");
  return `${prefix}:sha256:${digest}`;
}

function requireIdentifier(value: unknown, label: string): string {
  const identifier = readIdentifier(value);
  if (!identifier) throw new Error(`Coding run trace ${label} is invalid.`);
  return identifier;
}

function readIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value.trim()) ? value.trim() : undefined;
}

function readToolName(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_NAME_PATTERN.test(value.trim()) ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
