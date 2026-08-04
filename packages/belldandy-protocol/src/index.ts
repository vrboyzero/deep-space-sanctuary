export type JsonObject = Record<string, unknown>;

export { OutboundRequestPolicy, OutboundRequestPolicyError } from "./outbound-request-policy.js";
export type {
  OutboundAddress,
  OutboundDnsLookup,
  OutboundRequestAdapter,
  OutboundRequestAdapterInput,
  OutboundRequestInit,
  OutboundRequestPolicyErrorCode,
  OutboundRequestPolicyOptions,
  OutboundRequestResult,
} from "./outbound-request-policy.js";

export {
  REDACTED_VALUE,
  createPublicFailureEnvelope,
  readResponseTextBounded,
  redactSensitiveText,
  redactSensitiveUrl,
  redactSensitiveValue,
} from "./safe-output.js";
export type {
  PublicFailureCode,
  PublicFailureEnvelope,
  BoundedResponseText,
  ReadResponseTextBoundedOptions,
  RedactSensitiveValueOptions,
} from "./safe-output.js";

export {
  STATE_DIR_ENV_KEY,
  STATE_DIR_WINDOWS_ENV_KEY,
  STATE_DIR_WSL_ENV_KEY,
  LEGACY_STATE_DIR_BASENAME,
  DEFAULT_STATE_DIR_BASENAME,
  LEGACY_STATE_DIR_DISPLAY,
  DEFAULT_STATE_DIR_DISPLAY,
  resolveNamedCompatDir,
  resolveDefaultStateDir,
  resolveStateDir,
  resolveWorkspaceStateDir,
} from "./state-dir.js";
export {
  FilesystemCapability,
  assertSafeFilesystemBasename,
  assertSafeFilesystemRelativePath,
} from "./filesystem-capability.js";
export type {
  FilesystemCapabilityOptions,
  FilesystemCapabilityPathOptions,
} from "./filesystem-capability.js";

export type {
  TokenUsageUploadConfig,
  TokenUsageUploadInput,
  TokenUsageUploadLogger,
  TokenUsageUploadRequest,
  TokenUsageUploadRequestInput,
  TokenUsageUploadRuntimeSnapshot,
  TokenUsageUploadScheduler,
  TokenUsageUploadSchedulerOptions,
} from "./token-usage-upload.js";
export {
  createTokenUsageUploadScheduler,
  drainTokenUsageUploads,
  getTokenUsageUploadRuntimeSnapshot,
  uploadTokenUsage,
} from "./token-usage-upload.js";
export {
  buildIdentityAuthorityMayDirect,
  buildIdentityAuthorityReportsTo,
  deriveAuthorityRelationToManager,
  evaluateRuntimeIdentityAuthority,
  extractOwnerUuid,
  loadIdentityAuthorityProfile,
  parseIdentityAuthorityProfile,
} from "./identity.js";
export type {
  IdentityAuthorityAction,
  IdentityAuthorityActorRelation,
  IdentityAuthorityProfile,
  IdentityAuthorityRelationToManager,
  RuntimeIdentityAuthorityEvaluation,
} from "./identity.js";

export type BelldandyRole = "web" | "cli" | "node";

export type GatewayAuth =
  | { mode: "token"; token: string }
  | { mode: "password"; password: string }
  | { mode: "none" };

export type ConnectChallengeFrame = {
  type: "connect.challenge";
  nonce: string;
};

export type ConnectRequestFrame = {
  type: "connect";
  role: BelldandyRole;
  clientId?: string;
  auth?: GatewayAuth;
  clientName?: string;
  clientVersion?: string;
  /** 用户UUID（可选，用于身份权力验证） */
  userUuid?: string;
};

export type HelloOkFrame = {
  type: "hello-ok";
  sessionId: string;
  role: BelldandyRole;
  methods: string[];
  events: string[];
  version?: string;
  agentName?: string;      // Agent 名称（从 IDENTITY.md 提取）
  agentAvatar?: string;    // Agent 头像（Emoji 或 URL）
  userName?: string;       // 用户名称（从 USER.md 提取）
  userAvatar?: string;     // 用户头像（Emoji 或 URL）
  /** 是否支持UUID验证（告知客户端当前环境是否支持UUID） */
  supportsUuid?: boolean;
  /** false 表示 AI 模型尚未配置（无 API Key），前端应自动弹出设置面板引导用户 */
  configOk?: boolean;
};

export type GatewayReqFrame = {
  type: "req";
  id: string;
  method: string;
  params?: JsonObject;
};

export type GatewayResFrame =
  | { type: "res"; id: string; ok: true; payload?: JsonObject }
  | { type: "res"; id: string; ok: false; error: { code: string; message: string } };

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: JsonObject;
};

export type GatewayFrame =
  | ConnectChallengeFrame
  | ConnectRequestFrame
  | HelloOkFrame
  | GatewayReqFrame
  | GatewayResFrame
  | GatewayEventFrame;

/**
 * Headless coding-run 对一次 Conversation 运行施加的收紧型限制。
 * 这些字段不会创建新的领域运行状态；Gateway 仅将它们映射为本次 Agent launch 的运行时约束。
 */
export type CodingRunOptions = {
  cwd?: string;
  toolAllow?: string[];
  toolDeny?: string[];
  permissionMode?: "plan" | "acceptEdits" | "confirm";
  maxWallTimeMs?: number;
  maxTurns?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  /** Headless structured-output contract; Gateway validates it before trusted Agent injection. */
  outputSchema?: unknown;
};

export type MessageSendParams = {
  conversationId?: string;
  text: string;
  /** 新消息发送前自动停止同会话上一轮运行 */
  autoStopPreviousRun?: boolean;
  from?: string;
  clientContext?: {
    sentAtMs?: number;
    timezoneOffsetMinutes?: number;
    locale?: string;
  };
  /** 指定使用的 Agent Profile ID（可选，缺省使用 "default"） */
  agentId?: string;
  /** 指定使用的模型 ID（可选，缺省使用默认模型） */
  modelId?: string;
  /** 仅供 Headless coding-run 使用的单次运行限制。 */
  codingRun?: CodingRunOptions;
  /** 用户UUID（可选，用于身份权力验证） */
  userUuid?: string;
  /** 消息发送者信息（用于身份上下文） */
  senderInfo?: {
    type: "user" | "agent";
    id: string;
    name?: string;
    identity?: string; // Agent的身份标签（如：舰长、CEO）
  };
  /** 房间上下文信息（用于多人聊天场景） */
  roomContext?: {
    roomId?: string;
    environment: "local" | "community"; // 本地WebChat vs office.goddess.ai社区
    sessionKey?: string;
    clientId?: string;
    members?: Array<{
      type: "user" | "agent";
      id: string;
      name?: string;
      identity?: string; // Agent的身份标签
    }>;
  };
  attachments?: Array<{
    name: string;
    type: string;
    base64: string;
  }>;
};

export type ConversationRunStopParams = {
  conversationId: string;
  runId?: string;
  reason?: string;
};

export type ToolSettingsConfirmDecision = "approve" | "reject";

export type ToolSettingsConfirmParams = {
  requestId: string;
  decision: ToolSettingsConfirmDecision;
  conversationId?: string;
};

export type ToolSettingsConfirmRequiredEvent = {
  source: string;
  mode: "confirm";
  conversationId: string;
  requestId: string;
  requestedByAgentId?: string;
  summary: string[];
  impact: string;
  expiresAt: number;
  targetClientId?: string;
};

export type ToolSettingsConfirmResolvedEvent = {
  source: string;
  conversationId: string;
  requestId: string;
  decision: "approved" | "rejected";
  summary: string[];
  resolvedAt: number;
  targetClientId?: string;
};

export type ChatDeltaEvent = {
  conversationId: string;
  delta: string;
};

export type ChatMessageMeta = {
  timestampMs: number;
  displayTimeText: string;
  isLatest?: boolean;
};

export type ChatFinalEvent = {
  conversationId: string;
  text: string;
  role?: "user" | "assistant";
  messageMeta?: ChatMessageMeta;
};

export type ConversationMetaMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestampMs: number;
  displayTimeText: string;
  isLatest: boolean;
  agentId?: string;
  clientContext?: {
    sentAtMs?: number;
    timezoneOffsetMinutes?: number;
    locale?: string;
  };
};

export type AgentStatusEvent = {
  conversationId: string;
  runId?: string;
  agentId?: string;
  status: "running" | "done" | "error" | "stopped";
};

export type ConversationRunStoppedEvent = {
  conversationId: string;
  runId: string;
  agentId?: string;
  reason?: string;
  hadPartialResponse?: boolean;
};


export type PairingRequiredEvent = {
  clientId: string;
  code: string;
  message: string;
};

export type ConfigUpdateParams = {
  updates: Record<string, string>;
};

// Result payload for config.read (Response payload)
export type ConfigReadResult = {
  config: Record<string, string>;
};

// Result payload for system.doctor (Response payload)
export type SystemDoctorResult = {
  checks: Array<{
    id: string;
    name: string;
    status: "pass" | "fail" | "warn";
    message?: string;
  }>;
  cronRuntime?: {
    scheduler: {
      enabled: boolean;
      running: boolean;
      activeRuns: number;
      lastTickAtMs?: number;
    };
    totals: {
      totalJobs: number;
      enabledJobs: number;
      disabledJobs: number;
      staggeredJobs: number;
      invalidNextRunJobs: number;
    };
    sessionTargetCounts: {
      main: number;
      isolated: number;
    };
    deliveryModeCounts: {
      user: number;
      none: number;
    };
    failureDestinationModeCounts: {
      user: number;
      none: number;
    };
    recentJobs: Array<{
      id: string;
      name: string;
      enabled: boolean;
      scheduleSummary: string;
      sessionTarget: "main" | "isolated";
      deliveryMode: "user" | "none";
      failureDestinationMode: "user" | "none";
      staggerMs?: number;
      nextRunAtMs?: number;
      lastRunAtMs?: number;
      lastStatus?: string;
    }>;
    headline: string;
  };
  conversationDebug?: {
    conversationId: string;
    available: boolean;
    messageCount: number;
    updatedAt?: number;
    requested: {
      includeTranscript: boolean;
      includeTimeline: boolean;
      transcriptEventTypes?: string[];
      transcriptEventLimit?: number;
      transcriptRestoreView?: string;
      timelineKinds?: string[];
      timelineLimit?: number;
      timelinePreviewChars?: number;
    };
    transcriptExport?: Record<string, unknown>;
    timeline?: Record<string, unknown>;
  };
  conversationCatalog?: {
    items: Array<Record<string, unknown>>;
    filter: {
      conversationIdPrefix?: string;
      limit?: number;
    };
  };
  recentConversationExports?: {
    items: Array<Record<string, unknown>>;
    filter: {
      conversationIdPrefix?: string;
      limit?: number;
    };
  };
  memoryRuntime?: {
    sharedMemory?: {
      enabled: boolean;
      available: boolean;
      reasonCodes: string[];
      reasonMessages: string[];
      scope: {
        relativeRoot: string;
        rootPath: string;
        mainMemoryPath: string;
        dailyMemoryDirPath: string;
        fileCount: number;
        hasMainMemory: boolean;
        dailyCount: number;
      };
      secretGuard: {
        enabled: boolean;
        scanner: string;
        ruleCount: number;
        summary: string;
      };
      syncPolicy: {
        status: string;
        scope: string;
        deltaSync: {
          enabled: boolean;
          mode: string;
          summary: string;
        };
        conflictPolicy: {
          mode: string;
          maxConflictRetries: number;
          summary: string;
        };
        deletionPolicy: {
          propagatesDeletes: boolean;
          summary: string;
        };
        suppressionPolicy: {
          enabled: boolean;
          summary: string;
        };
      };
    };
    mainThreadToolSurface?: {
      id: string;
      runtime: string;
      mode: string;
      summary: string;
      allowedCapabilities: string[];
      blockedCapabilities: string[];
    };
    sessionDigest?: {
      availability: {
        enabled: boolean;
        available: boolean;
        reasonCodes: string[];
        reasonMessages: string[];
      };
      permissionSurface: {
        id: string;
        runtime: string;
        mode: string;
        summary: string;
        allowedCapabilities: string[];
        blockedCapabilities: string[];
      };
      rateLimit: {
        status: "unlimited" | "ok" | "limited";
        configured: boolean;
        observedRuns: number;
        maxRuns?: number;
        windowMs?: number;
        retryAfterMs?: number;
        reasonCode?: string;
        reasonMessage?: string;
      };
    };
    durableExtraction?: {
      availability: {
        enabled: boolean;
        available: boolean;
        reasonCodes: string[];
        reasonMessages: string[];
        model?: string;
        minMessages?: number;
        hasBaseUrl?: boolean;
        hasApiKey?: boolean;
      };
      guidance?: {
        policyVersion: string;
        acceptedCandidateTypes: string[];
        rejectedContentTypes: Array<{
          code: string;
          message: string;
        }>;
        summary: string;
      };
      permissionSurface: {
        id: string;
        runtime: string;
        mode: string;
        summary: string;
        allowedCapabilities: string[];
        blockedCapabilities: string[];
      };
      rateLimit: {
        request: {
          status: "unlimited" | "ok" | "limited";
          configured: boolean;
          observedRuns: number;
          maxRuns?: number;
          windowMs?: number;
          retryAfterMs?: number;
          reasonCode?: string;
          reasonMessage?: string;
        };
        run: {
          status: "unlimited" | "ok" | "limited";
          configured: boolean;
          observedRuns: number;
          maxRuns?: number;
          windowMs?: number;
          retryAfterMs?: number;
          reasonCode?: string;
          reasonMessage?: string;
        };
      };
    };
  };
  queryRuntime?: {
    observerEnabled: boolean;
    totalObservedEvents: number;
    activeTraceCount: number;
    traces: Array<{
      traceId: string;
      method: string;
      status: "running" | "completed" | "failed";
      conversationId?: string;
      startedAt: number;
      updatedAt: number;
      latestStage: string;
      stageCount: number;
      stages: Array<{
        stage: string;
        timestamp: number;
        detail?: Record<string, unknown>;
      }>;
    }>;
  };
  promptObservability?: {
    requested: {
      agentId?: string;
      conversationId?: string;
      runId?: string;
    };
    launchExplainability?: Record<string, unknown>;
    summary: {
      scope?: "agent" | "run";
      agentId: string;
      displayName?: string;
      model?: string;
      conversationId?: string;
      runId?: string;
      createdAt?: number;
      counts: {
        sectionCount: number;
        droppedSectionCount: number;
        deltaCount: number;
        providerNativeSystemBlockCount: number;
      };
      promptSizes: {
        totalChars: number;
        finalChars: number;
      };
      tokenBreakdown: {
        systemPromptEstimatedChars: number;
        systemPromptEstimatedTokens: number;
        sectionEstimatedChars: number;
        sectionEstimatedTokens: number;
        droppedSectionEstimatedChars: number;
        droppedSectionEstimatedTokens: number;
        deltaEstimatedChars: number;
        deltaEstimatedTokens: number;
        providerNativeSystemBlockEstimatedChars: number;
        providerNativeSystemBlockEstimatedTokens: number;
      };
      cacheSupport?: string;
      capabilitySource?: string;
      providerCacheEligible?: boolean;
      systemPromptFingerprint?: string;
      structureSignature?: string;
      prefixDrift?: {
        status?: "first_snapshot" | "stable" | "drifted";
        changed?: boolean;
        reasons?: string[];
        previousFingerprint?: string;
        currentFingerprint?: string;
      };
      prefixWarmState?: {
        eligible?: boolean;
        status?: "cold" | "warming" | "warm_candidate" | "drifted" | "unsupported";
        samePrefixAsPrevious?: boolean;
        previousAgeMs?: number;
        reason?: string;
      };
      orderingGuard?: {
        status?: "stable" | "risk";
        reasons?: string[];
      };
      truncationReason?: {
        code: string;
        maxChars?: number;
        droppedSectionCount?: number;
        droppedSectionIds?: string[];
        droppedSectionLabels?: string[];
        message?: string;
      };
      experiments?: Record<string, unknown>;
    };
  };
  toolBehaviorObservability?: {
    requested: {
      agentId?: string;
      conversationId?: string;
      taskId?: string;
    };
    visibilityContext: {
      agentId: string;
      conversationId: string | null;
      taskId?: string;
      launchExplainability?: Record<string, unknown>;
      launchSpec?: Record<string, unknown>;
    };
    counts: {
      visibleToolContractCount: number;
      includedContractCount: number;
      behaviorContractCount: number;
    };
    included: string[];
    contracts: Record<string, {
      useWhen: string[];
      avoidWhen: string[];
      preflightChecks: string[];
      fallbackStrategy: string[];
    }>;
    summary?: string;
    experiment?: {
      disabledContractNamesConfigured: string[];
      disabledContractNamesApplied: string[];
    };
  };
  toolContractV2Observability?: {
    requested: {
      agentId?: string;
      conversationId?: string;
      taskId?: string;
    };
    visibilityContext: {
      agentId: string;
      conversationId: string | null;
      taskId?: string;
      launchExplainability?: Record<string, unknown>;
      launchSpec?: Record<string, unknown>;
    };
    summary: {
      totalCount: number;
      missingV2Count: number;
      highRiskCount: number;
      confirmRequiredCount: number;
      governedTools: string[];
      missingV2Tools: string[];
    };
    contracts: Record<string, {
      family?: string;
      riskLevel?: string;
      needsPermission: boolean;
      isReadOnly: boolean;
      isConcurrencySafe: boolean;
      activityDescription?: string;
      recommendedWhen: string[];
      avoidWhen: string[];
      confirmWhen: string[];
      preflightChecks: string[];
      fallbackStrategy: string[];
      expectedOutput: string[];
      sideEffectSummary: string[];
      userVisibleRiskNote?: string;
      hasGovernanceContract: boolean;
      hasBehaviorContract: boolean;
    }>;
  };
  runtimeResilience?: {
    version: 1;
    updatedAt: number;
    routing: {
      primary: {
        profileId: string;
        provider: string;
        model: string;
        protocol?: string;
        wireApi?: string;
      };
      fallbacks: Array<{
        profileId: string;
        provider: string;
        model: string;
        protocol?: string;
        wireApi?: string;
      }>;
      compaction?: {
        configured: boolean;
        sharesPrimaryRoute: boolean;
        route?: {
          profileId: string;
          provider: string;
          model: string;
          protocol?: string;
          wireApi?: string;
        };
      };
    };
    totals: {
      observedRuns: number;
      degradedRuns: number;
      failedRuns: number;
      sameProfileRetries: number;
      crossProfileFallbacks: number;
      cooldownSkips: number;
      terminalFailures: number;
    };
    summary: {
      available: boolean;
      configuredFallbackCount: number;
      lastOutcome: "idle" | "success" | "non_retryable" | "exhausted" | "aborted";
      headline: string;
    };
    reasonCounts: Record<string, number>;
    latest?: {
      source: "openai_chat" | "tool_agent" | "compaction";
      phase: string;
      agentId?: string;
      conversationId?: string;
      finalStatus: "success" | "non_retryable" | "exhausted" | "aborted";
      finalProfileId?: string;
      finalProvider?: string;
      finalModel?: string;
      finalReason?: string;
      requestCount: number;
      failedStageCount: number;
      degraded: boolean;
      stepCounts: {
        cooldownSkips: number;
        sameProfileRetries: number;
        crossProfileFallbacks: number;
        terminalFailures: number;
      };
      reasonCounts: Record<string, number>;
      updatedAt: number;
      headline: string;
    };
  };
};

// Result payload for agents.list (Response payload)
export type AgentsListResult = {
  agents: Array<{
    id: string;
    displayName: string;
    name?: string;
    avatar?: string;
    model: string; // 引用名，不暴露 apiKey
  }>;
};

// Result payload for models.list (Response payload)
export type ModelsListResult = {
  models: Array<{
    id: string;
    displayName: string;
    model: string;
  }>;
  currentDefault: string;
};
