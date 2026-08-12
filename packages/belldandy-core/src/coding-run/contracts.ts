export const CODING_RUN_PROTOCOL_VERSION = "v1" as const;

export const CODING_RUN_TRACE_POLICY = {
  schemaVersion: "coding-run-trace/v1",
  contentMode: "none",
  bodyFields: [],
} as const;

export const CODING_RUN_CAPABILITIES = {
  schemaVersion: "coding-run-capabilities/v1",
  protocolVersion: CODING_RUN_PROTOCOL_VERSION,
  eventStream: {
    sequence: "continuous",
    terminal: "exactly_one",
    usageCompleteness: "terminal",
  },
  observability: {
    trace: CODING_RUN_TRACE_POLICY,
  },
} as const;

export type CodingRunCapabilities = Omit<typeof CODING_RUN_CAPABILITIES, "observability"> & {
  observability?: typeof CODING_RUN_CAPABILITIES.observability;
};

export type CodingRunUsageCompleteness = {
  status: "complete" | "incomplete";
  reason:
    | "provider_reported_all_model_calls"
    | "provider_usage_missing"
    | "reporting_count_unavailable"
    | "usage_not_reported";
  modelCalls?: number;
  providerReportedModelCalls?: number;
};

export type CodingRunSource = "conversation" | "goal" | "workflow" | "subtask";

export type GoalRunRef = {
  goalId: string;
  nodeId?: string;
};

export type WorkflowRunRef = {
  journalId: string;
  workflowRunId?: string;
};

export type SubtaskRunRef = {
  taskId: string;
};

export type WorkspaceRevisionCheckpointRef = {
  workspaceCheckpointId: string;
  recoveryGuarantee: "exact" | "managed_worktree" | "detect_only";
};

/**
 * 仅表达既有领域对象之间的关联，不保存第二套会话、任务或审批状态。
 */
export type CodingContextBinding = {
  agentRunId: string;
  conversationId?: string;
  goal?: GoalRunRef;
  workflow?: WorkflowRunRef;
  subtask?: SubtaskRunRef;
  worktreeId?: string;
  workspaceCheckpoint?: WorkspaceRevisionCheckpointRef;
};

export type WorkspaceRevisionCheckpoint = WorkspaceRevisionCheckpointRef & {
  workspaceId: string;
  createdAtMs: number;
  gitState: "clean" | "dirty" | "unavailable";
};

export type AgentRunEventType =
  | "run.started"
  | "run.status"
  | "message.delta"
  | "tool.started"
  | "tool.completed"
  | "permission.requested"
  | "run.usage"
  | "run.budget_exhausted"
  | "run.cancelled"
  | "run.interrupted"
  | "run.completed"
  | "run.failed";

export type AgentRunEvent = {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  seq: number;
  timestampMs: number;
  source: CodingRunSource;
  binding: CodingContextBinding;
  type: AgentRunEventType;
  payload: Record<string, unknown>;
};

/** 只读事件订阅；必须同时绑定 Conversation 与其单次 agent run。 */
export type CodingRunSubscription = {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  binding: {
    agentRunId: string;
    conversationId: string;
  };
  cursor?: number;
};

export type CodingRunStatusQuery = {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  source: CodingRunSource;
  binding: CodingContextBinding;
};

export type ConversationFollowUpStatusQuery = {
  version: typeof CODING_RUN_PROTOCOL_VERSION;
  binding: {
    agentRunId: string;
    conversationId: string;
  };
  commandId: string;
};

export type CodingRunErrorCode =
  | "invalid_request"
  | "not_found"
  | "run_mismatch"
  | "not_active"
  | "permission_required"
  | "permission_denied"
  | "policy_denied"
  | "budget_exhausted"
  | "cancelled"
  | "interrupted"
  | "output_schema_invalid"
  | "gateway_unavailable"
  | "invalid_limit"
  | "cursor_stale"
  | "cursor_future"
  | "cursor_out_of_range"
  | "internal";

export type CodingRunSubscriptionErrorCode = CodingRunErrorCode | "cursor_expired";

export type RunControl =
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "cancel";
    binding: {
      agentRunId: string;
      conversationId: string;
    };
    reason?: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "conversation.continue";
    binding: {
      conversationId: string;
    };
    prompt: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "conversation.follow_up";
    binding: {
      agentRunId: string;
      conversationId: string;
    };
    prompt: string;
    idempotencyKey: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "conversation.replace";
    binding: {
      agentRunId: string;
      conversationId: string;
    };
    prompt: string;
    idempotencyKey: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "conversation.steer";
    binding: {
      agentRunId: string;
      conversationId: string;
    };
    prompt: string;
    idempotencyKey: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "permission.respond";
    binding: Pick<CodingContextBinding, "agentRunId" | "worktreeId">;
    toolCallId: string;
    decision: "allow" | "deny";
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "goal.resume";
    binding: {
      agentRunId: string;
      goal: GoalRunRef;
    };
    checkpointId?: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "goal.pause";
    binding: {
      agentRunId: string;
      goal: GoalRunRef;
    };
    reason?: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "workflow.resume";
    binding: {
      agentRunId: string;
      workflow: WorkflowRunRef;
    };
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "workflow.cancel";
    binding: {
      agentRunId: string;
      workflow: WorkflowRunRef;
    };
    reason?: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "subtask.resume";
    binding: {
      agentRunId: string;
      subtask: SubtaskRunRef;
    };
    message?: string;
  }
  | {
    version: typeof CODING_RUN_PROTOCOL_VERSION;
    operation: "subtask.cancel";
    binding: {
      agentRunId: string;
      subtask: SubtaskRunRef;
    };
    reason?: string;
  };

export const CODING_RUN_EXIT_CODES = {
  success: 0,
  invalidInput: 2,
  permissionDenied: 3,
  executionFailed: 4,
  cancelled: 5,
  outputSchemaInvalid: 6,
  gatewayUnavailable: 7,
  interrupted: 8,
} as const;

/**
 * 供 JSONL/stdio 消费者使用的最小公开 JSON Schema；具体 payload 由 event type 逐步扩展。
 */
export const agentRunEventV1JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://star-sanctuary.dev/schemas/agent-run-event-v1.json",
  title: "Star Sanctuary AgentRunEvent v1",
  type: "object",
  additionalProperties: false,
  required: ["version", "seq", "timestampMs", "source", "binding", "type", "payload"],
  properties: {
    version: { const: CODING_RUN_PROTOCOL_VERSION },
    seq: { type: "integer", minimum: 1 },
    timestampMs: { type: "integer", minimum: 0 },
    source: { enum: ["conversation", "goal", "workflow", "subtask"] },
    binding: {
      type: "object",
      additionalProperties: false,
      required: ["agentRunId"],
      properties: {
        agentRunId: { type: "string", minLength: 1 },
        conversationId: { type: "string", minLength: 1 },
        goal: {
          type: "object",
          additionalProperties: false,
          required: ["goalId"],
          properties: {
            goalId: { type: "string", minLength: 1 },
            nodeId: { type: "string", minLength: 1 },
          },
        },
        workflow: {
          type: "object",
          additionalProperties: false,
          required: ["journalId"],
          properties: {
            journalId: { type: "string", minLength: 1 },
            workflowRunId: { type: "string", minLength: 1 },
          },
        },
        subtask: {
          type: "object",
          additionalProperties: false,
          required: ["taskId"],
          properties: {
            taskId: { type: "string", minLength: 1 },
          },
        },
        worktreeId: { type: "string", minLength: 1 },
        workspaceCheckpoint: {
          type: "object",
          additionalProperties: false,
          required: ["workspaceCheckpointId", "recoveryGuarantee"],
          properties: {
            workspaceCheckpointId: { type: "string", minLength: 1 },
            recoveryGuarantee: { enum: ["exact", "managed_worktree", "detect_only"] },
          },
        },
      },
    },
    type: {
      enum: [
        "run.started",
        "run.status",
        "message.delta",
        "tool.started",
        "tool.completed",
        "permission.requested",
        "run.usage",
        "run.budget_exhausted",
        "run.cancelled",
        "run.interrupted",
        "run.completed",
        "run.failed",
      ],
    },
    payload: { type: "object" },
  },
  allOf: [
    {
      if: { properties: { source: { const: "conversation" } } },
      then: { properties: { binding: { required: ["conversationId"] } } },
    },
    {
      if: { properties: { source: { const: "goal" } } },
      then: { properties: { binding: { required: ["goal"] } } },
    },
    {
      if: { properties: { source: { const: "workflow" } } },
      then: { properties: { binding: { required: ["workflow"] } } },
    },
    {
      if: { properties: { source: { const: "subtask" } } },
      then: { properties: { binding: { required: ["subtask"] } } },
    },
  ],
} as const;

const goalControlBindingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agentRunId", "goal"],
  properties: {
    agentRunId: { type: "string", minLength: 1 },
    goal: {
      type: "object",
      additionalProperties: false,
      required: ["goalId"],
      properties: {
        goalId: { type: "string", minLength: 1 },
        nodeId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

const workflowControlBindingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agentRunId", "workflow"],
  properties: {
    agentRunId: { type: "string", minLength: 1 },
    workflow: {
      type: "object",
      additionalProperties: false,
      required: ["journalId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        workflowRunId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

const subtaskControlBindingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["agentRunId", "subtask"],
  properties: {
    agentRunId: { type: "string", minLength: 1 },
    subtask: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

/**
 * 供双向 JSONL/stdio 消费者使用的控制请求 Schema。每个 operation 都约束到其来源域。
 */
export const runControlV1JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://star-sanctuary.dev/schemas/run-control-v1.json",
  title: "Star Sanctuary RunControl v1",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "cancel" },
        binding: {
          type: "object",
          additionalProperties: false,
          required: ["agentRunId", "conversationId"],
          properties: {
            agentRunId: { type: "string", minLength: 1 },
            conversationId: { type: "string", minLength: 1 },
          },
        },
        reason: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding", "prompt"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "conversation.continue" },
        binding: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", minLength: 1 },
          },
        },
        prompt: { type: "string", minLength: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding", "prompt", "idempotencyKey"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "conversation.follow_up" },
        binding: {
          type: "object",
          additionalProperties: false,
          required: ["agentRunId", "conversationId"],
          properties: {
            agentRunId: { type: "string", minLength: 1 },
            conversationId: { type: "string", minLength: 1 },
          },
        },
        prompt: { type: "string", minLength: 1, maxLength: 32768 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding", "prompt", "idempotencyKey"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "conversation.steer" },
        binding: {
          type: "object",
          additionalProperties: false,
          required: ["agentRunId", "conversationId"],
          properties: {
            agentRunId: { type: "string", minLength: 1 },
            conversationId: { type: "string", minLength: 1 },
          },
        },
        prompt: { type: "string", minLength: 1, maxLength: 32768 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding", "prompt", "idempotencyKey"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "conversation.replace" },
        binding: {
          type: "object",
          additionalProperties: false,
          required: ["agentRunId", "conversationId"],
          properties: {
            agentRunId: { type: "string", minLength: 1 },
            conversationId: { type: "string", minLength: 1 },
          },
        },
        prompt: { type: "string", minLength: 1, maxLength: 32768 },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding", "toolCallId", "decision"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "permission.respond" },
        binding: {
          type: "object",
          additionalProperties: false,
          required: ["agentRunId"],
          properties: {
            agentRunId: { type: "string", minLength: 1 },
            worktreeId: { type: "string", minLength: 1 },
          },
        },
        toolCallId: { type: "string", minLength: 1 },
        decision: { enum: ["allow", "deny"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "goal.resume" },
        binding: goalControlBindingSchema,
        checkpointId: { type: "string", minLength: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "goal.pause" },
        binding: goalControlBindingSchema,
        reason: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "workflow.resume" },
        binding: workflowControlBindingSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "workflow.cancel" },
        binding: workflowControlBindingSchema,
        reason: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "subtask.resume" },
        binding: subtaskControlBindingSchema,
        message: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["version", "operation", "binding"],
      properties: {
        version: { const: CODING_RUN_PROTOCOL_VERSION },
        operation: { const: "subtask.cancel" },
        binding: subtaskControlBindingSchema,
        reason: { type: "string" },
      },
    },
  ],
} as const;

const TERMINAL_EVENT_TYPES = new Set<AgentRunEventType>([
  "run.cancelled",
  "run.interrupted",
  "run.completed",
  "run.failed",
]);

const CODING_RUN_SOURCES = new Set<CodingRunSource>([
  "conversation",
  "goal",
  "workflow",
  "subtask",
]);

const AGENT_RUN_EVENT_TYPES = new Set<AgentRunEventType>([
  "run.started",
  "run.status",
  "message.delta",
  "tool.started",
  "tool.completed",
  "permission.requested",
  "run.usage",
  "run.budget_exhausted",
  "run.cancelled",
  "run.interrupted",
  "run.completed",
  "run.failed",
]);

export type AgentRunEventSequencer = {
  emit: (type: AgentRunEventType, payload: Record<string, unknown>) => AgentRunEvent | undefined;
  hasTerminated: () => boolean;
};

export function createAgentRunEventSequencer(input: {
  source: CodingRunSource;
  binding: CodingContextBinding;
  onEvent: (event: AgentRunEvent) => void;
  now?: () => number;
}): AgentRunEventSequencer {
  assertCodingContextBinding(input.source, input.binding);
  const now = input.now ?? Date.now;
  let sequence = 0;
  let terminated = false;

  return {
    emit: (type, payload) => {
      if (terminated) return undefined;
      const event: AgentRunEvent = {
        version: CODING_RUN_PROTOCOL_VERSION,
        seq: sequence += 1,
        timestampMs: Math.max(0, Math.floor(now())),
        source: input.source,
        binding: cloneBinding(input.binding),
        type,
        payload: sanitizeCodingRunData(payload) as Record<string, unknown>,
      };
      if (TERMINAL_EVENT_TYPES.has(type)) terminated = true;
      input.onEvent(event);
      return event;
    },
    hasTerminated: () => terminated,
  };
}

export function isAgentRunEventV1(value: unknown): value is AgentRunEvent {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "seq", "timestampMs", "source", "binding", "type", "payload"])) {
    return false;
  }
  if (value.version !== CODING_RUN_PROTOCOL_VERSION) return false;
  if (!isPositiveInteger(value.seq) || !isNonNegativeInteger(value.timestampMs)) return false;
  if (typeof value.source !== "string" || !CODING_RUN_SOURCES.has(value.source as CodingRunSource)) return false;
  if (typeof value.type !== "string" || !AGENT_RUN_EVENT_TYPES.has(value.type as AgentRunEventType)) return false;
  return isCodingContextBinding(value.source as CodingRunSource, value.binding)
    && isJsonRecord(value.payload);
}

export function isCodingRunCapabilitiesV1(value: unknown): value is CodingRunCapabilities {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "protocolVersion", "eventStream", "observability"])) {
    return false;
  }
  if (value.schemaVersion !== CODING_RUN_CAPABILITIES.schemaVersion
    || value.protocolVersion !== CODING_RUN_CAPABILITIES.protocolVersion
    || !isRecord(value.eventStream)
    || !hasOnlyKeys(value.eventStream, ["sequence", "terminal", "usageCompleteness"])) {
    return false;
  }
  if (value.observability !== undefined
    && (!isRecord(value.observability)
      || !hasOnlyKeys(value.observability, ["trace"])
      || !isRecord(value.observability.trace)
      || !hasOnlyKeys(value.observability.trace, ["schemaVersion", "contentMode", "bodyFields"])
      || value.observability.trace.schemaVersion !== CODING_RUN_TRACE_POLICY.schemaVersion
      || value.observability.trace.contentMode !== CODING_RUN_TRACE_POLICY.contentMode
      || !Array.isArray(value.observability.trace.bodyFields)
      || value.observability.trace.bodyFields.length !== 0)) {
    return false;
  }
  return value.eventStream.sequence === CODING_RUN_CAPABILITIES.eventStream.sequence
    && value.eventStream.terminal === CODING_RUN_CAPABILITIES.eventStream.terminal
    && value.eventStream.usageCompleteness === CODING_RUN_CAPABILITIES.eventStream.usageCompleteness;
}

export function isCodingRunUsageCompletenessV1(value: unknown): value is CodingRunUsageCompleteness {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["status", "reason", "modelCalls", "providerReportedModelCalls"])) {
    return false;
  }
  const modelCalls = value.modelCalls;
  const providerReportedModelCalls = value.providerReportedModelCalls;
  const countsAreValid = (modelCalls === undefined || isNonNegativeInteger(modelCalls))
    && (providerReportedModelCalls === undefined || isNonNegativeInteger(providerReportedModelCalls));
  if (!countsAreValid) return false;

  if (value.status === "complete") {
    return value.reason === "provider_reported_all_model_calls"
      && isPositiveInteger(modelCalls)
      && providerReportedModelCalls === modelCalls;
  }
  if (value.status !== "incomplete") return false;
  if (value.reason === "usage_not_reported") {
    return modelCalls === undefined && providerReportedModelCalls === undefined;
  }
  if (value.reason === "reporting_count_unavailable") {
    return modelCalls === undefined || providerReportedModelCalls === undefined;
  }
  return value.reason === "provider_usage_missing"
    && isPositiveInteger(modelCalls)
    && isNonNegativeInteger(providerReportedModelCalls)
    && providerReportedModelCalls < modelCalls;
}

export function isCodingRunSubscriptionV1(value: unknown): value is CodingRunSubscription {
  return isRecord(value)
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && hasOnlyKeys(value, ["version", "binding", "cursor"])
    && isExactStringBinding(value.binding, ["agentRunId", "conversationId"])
    && (!hasOwn(value, "cursor") || isNonNegativeInteger(value.cursor));
}

export function isCodingRunStatusQueryV1(value: unknown): value is CodingRunStatusQuery {
  return isRecord(value)
    && hasOnlyKeys(value, ["version", "source", "binding"])
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && typeof value.source === "string"
    && CODING_RUN_SOURCES.has(value.source as CodingRunSource)
    && isCodingContextBinding(value.source as CodingRunSource, value.binding);
}

export function isConversationFollowUpStatusQueryV1(
  value: unknown,
): value is ConversationFollowUpStatusQuery {
  return isRecord(value)
    && value.version === CODING_RUN_PROTOCOL_VERSION
    && hasOnlyKeys(value, ["version", "binding", "commandId"])
    && isExactStringBinding(value.binding, ["agentRunId", "conversationId"])
    && isNonEmptyString(value.commandId);
}

export function isRunControlV1(value: unknown): value is RunControl {
  if (!isRecord(value) || value.version !== CODING_RUN_PROTOCOL_VERSION || typeof value.operation !== "string") {
    return false;
  }

  if (value.operation === "cancel") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "reason"])
      && isExactStringBinding(value.binding, ["agentRunId", "conversationId"])
      && (!hasOwn(value, "reason") || typeof value.reason === "string");
  }
  if (value.operation === "conversation.continue") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "prompt"])
      && isExactStringBinding(value.binding, ["conversationId"])
      && isNonEmptyString(value.prompt);
  }
  if (value.operation === "conversation.follow_up") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "prompt", "idempotencyKey"])
      && isExactStringBinding(value.binding, ["agentRunId", "conversationId"])
      && isNonEmptyString(value.prompt)
      && value.prompt.length <= 32_768
      && isNonEmptyString(value.idempotencyKey)
      && value.idempotencyKey.length <= 128;
  }
  if (value.operation === "conversation.replace") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "prompt", "idempotencyKey"])
      && isExactStringBinding(value.binding, ["agentRunId", "conversationId"])
      && isNonEmptyString(value.prompt)
      && value.prompt.length <= 32_768
      && isNonEmptyString(value.idempotencyKey)
      && value.idempotencyKey.length <= 128;
  }
  if (value.operation === "conversation.steer") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "prompt", "idempotencyKey"])
      && isExactStringBinding(value.binding, ["agentRunId", "conversationId"])
      && isNonEmptyString(value.prompt)
      && value.prompt.length <= 32_768
      && isNonEmptyString(value.idempotencyKey)
      && value.idempotencyKey.length <= 128;
  }
  if (value.operation === "permission.respond") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "toolCallId", "decision"])
      && isPermissionBinding(value.binding)
      && isNonEmptyString(value.toolCallId)
      && (value.decision === "allow" || value.decision === "deny");
  }
  if (value.operation === "goal.resume") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "checkpointId"])
      && isGoalControlBinding(value.binding)
      && (!hasOwn(value, "checkpointId") || isNonEmptyString(value.checkpointId));
  }
  if (value.operation === "goal.pause") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "reason"])
      && isGoalControlBinding(value.binding)
      && (!hasOwn(value, "reason") || typeof value.reason === "string");
  }
  if (value.operation === "workflow.resume") {
    return hasOnlyKeys(value, ["version", "operation", "binding"])
      && isWorkflowControlBinding(value.binding);
  }
  if (value.operation === "workflow.cancel") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "reason"])
      && isWorkflowControlBinding(value.binding)
      && (!hasOwn(value, "reason") || typeof value.reason === "string");
  }
  if (value.operation === "subtask.resume") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "message"])
      && isSubtaskControlBinding(value.binding)
      && (!hasOwn(value, "message") || typeof value.message === "string");
  }
  if (value.operation === "subtask.cancel") {
    return hasOnlyKeys(value, ["version", "operation", "binding", "reason"])
      && isSubtaskControlBinding(value.binding)
      && (!hasOwn(value, "reason") || typeof value.reason === "string");
  }
  return false;
}

export function toSafeCodingRunErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown coding run error.");
  return message.replace(
    /\b((?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)[\w-]*)\s*([:=])\s*(?:Bearer\s+)?[^\s,;]+/gi,
    "$1$2[REDACTED]",
  );
}

export function sanitizeCodingRunData(value: unknown, depth = 0): unknown {
  if (depth >= 8) return "[TRUNCATED]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return "[UNSERIALIZABLE]";
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeCodingRunData(item, depth + 1));
  if (!isRecord(value)) return "[UNSERIALIZABLE]";

  const result: Record<string, unknown> = {};
  try {
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSensitiveField(key)
        ? "[REDACTED]"
        : key === "env" && isRecord(item)
        ? Object.fromEntries(Object.keys(item).map((environmentKey) => [environmentKey, "[REDACTED]"]))
        : sanitizeCodingRunData(item, depth + 1);
    }
  } catch {
    return "[UNSERIALIZABLE]";
  }
  return result;
}

function assertCodingContextBinding(source: CodingRunSource, binding: CodingContextBinding): void {
  if (!isRecord(binding) || !isNonEmptyString(binding.agentRunId)) {
    throw new Error("Coding run binding requires a non-empty agentRunId.");
  }
  if (source === "conversation" && !isNonEmptyString(binding.conversationId)) {
    throw new Error("Conversation coding run binding requires a non-empty conversationId.");
  }
  if (source === "goal" && !binding.goal?.goalId.trim()) {
    throw new Error("Goal coding run binding requires goal.goalId.");
  }
  if (source === "workflow" && !binding.workflow?.journalId.trim()) {
    throw new Error("Workflow coding run binding requires workflow.journalId.");
  }
  if (source === "subtask" && !binding.subtask?.taskId.trim()) {
    throw new Error("Subtask coding run binding requires subtask.taskId.");
  }
  if (!isCodingContextBinding(source, binding)) {
    throw new Error(`Invalid coding run binding for ${source}.`);
  }
}

function cloneBinding(binding: CodingContextBinding): CodingContextBinding {
  return {
    ...binding,
    ...(binding.goal ? { goal: { ...binding.goal } } : {}),
    ...(binding.workflow ? { workflow: { ...binding.workflow } } : {}),
    ...(binding.subtask ? { subtask: { ...binding.subtask } } : {}),
    ...(binding.workspaceCheckpoint ? { workspaceCheckpoint: { ...binding.workspaceCheckpoint } } : {}),
  };
}

function isSensitiveField(key: string): boolean {
  return /(?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)/i.test(key);
}

function isCodingContextBinding(source: CodingRunSource, value: unknown): value is CodingContextBinding {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "agentRunId",
    "conversationId",
    "goal",
    "workflow",
    "subtask",
    "worktreeId",
    "workspaceCheckpoint",
  ])) {
    return false;
  }
  if (!isNonEmptyString(value.agentRunId)) return false;
  if (hasOwn(value, "conversationId") && !isNonEmptyString(value.conversationId)) return false;
  if (hasOwn(value, "goal") && !isGoalRunRef(value.goal)) return false;
  if (hasOwn(value, "workflow") && !isWorkflowRunRef(value.workflow)) return false;
  if (hasOwn(value, "subtask") && !isSubtaskRunRef(value.subtask)) return false;
  if (hasOwn(value, "worktreeId") && !isNonEmptyString(value.worktreeId)) return false;
  if (hasOwn(value, "workspaceCheckpoint") && !isWorkspaceRevisionCheckpointRef(value.workspaceCheckpoint)) return false;

  if (source === "conversation") return isNonEmptyString(value.conversationId);
  if (source === "goal") return value.goal !== undefined;
  if (source === "workflow") return value.workflow !== undefined;
  return value.subtask !== undefined;
}

function isGoalRunRef(value: unknown): value is GoalRunRef {
  return isRecord(value)
    && hasOnlyKeys(value, ["goalId", "nodeId"])
    && isNonEmptyString(value.goalId)
    && (value.nodeId === undefined || isNonEmptyString(value.nodeId));
}

function isWorkflowRunRef(value: unknown): value is WorkflowRunRef {
  return isRecord(value)
    && hasOnlyKeys(value, ["journalId", "workflowRunId"])
    && isNonEmptyString(value.journalId)
    && (value.workflowRunId === undefined || isNonEmptyString(value.workflowRunId));
}

function isSubtaskRunRef(value: unknown): value is SubtaskRunRef {
  return isRecord(value) && hasOnlyKeys(value, ["taskId"]) && isNonEmptyString(value.taskId);
}

function isWorkspaceRevisionCheckpointRef(value: unknown): value is WorkspaceRevisionCheckpointRef {
  return isRecord(value)
    && hasOnlyKeys(value, ["workspaceCheckpointId", "recoveryGuarantee"])
    && isNonEmptyString(value.workspaceCheckpointId)
    && (value.recoveryGuarantee === "exact"
      || value.recoveryGuarantee === "managed_worktree"
      || value.recoveryGuarantee === "detect_only");
}

function isExactStringBinding(value: unknown, requiredKeys: string[]): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, requiredKeys)
    && requiredKeys.every((key) => isNonEmptyString(value[key]));
}

function isPermissionBinding(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["agentRunId", "worktreeId"]) || !isNonEmptyString(value.agentRunId)) {
    return false;
  }
  return !hasOwn(value, "worktreeId") || isNonEmptyString(value.worktreeId);
}

function isGoalControlBinding(value: unknown): value is { agentRunId: string; goal: GoalRunRef } {
  return isRecord(value)
    && hasOnlyKeys(value, ["agentRunId", "goal"])
    && isNonEmptyString(value.agentRunId)
    && isGoalRunRef(value.goal);
}

function isWorkflowControlBinding(value: unknown): value is { agentRunId: string; workflow: WorkflowRunRef } {
  return isRecord(value)
    && hasOnlyKeys(value, ["agentRunId", "workflow"])
    && isNonEmptyString(value.agentRunId)
    && isWorkflowRunRef(value.workflow);
}

function isSubtaskControlBinding(value: unknown): value is { agentRunId: string; subtask: SubtaskRunRef } {
  return isRecord(value)
    && hasOnlyKeys(value, ["agentRunId", "subtask"])
    && isNonEmptyString(value.agentRunId)
    && isSubtaskRunRef(value.subtask);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((item) => isJsonValue(item));
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  return isJsonRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
