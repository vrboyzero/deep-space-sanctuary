import { buildResidentDoctorNote } from "./resident-observability-summary.js";
import { buildLaunchExplainabilityLines } from "./agent-launch-explainability.js";
import { buildResidentStateBindingLines } from "./resident-state-binding-lines.js";
import { buildContinuationAction } from "./continuation-targets.js";
import { buildExternalOutboundDiagnosis } from "./external-outbound-diagnosis.js";
import { buildAgentWorkSummary } from "./agent-work-summary.js";

function tr(t, key, params, fallback) {
  return typeof t === "function" ? t(key, params ?? {}, fallback) : fallback;
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

function formatTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : "-";
}

function formatDateValue(value) {
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
  }
  return formatTimestamp(value);
}

function formatDreamStatusLabel(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "queued") return "queued";
  if (normalized === "running") return "running";
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  return "idle";
}

function formatDreamAutoTriggerMode(value) {
  return value === "cron" ? "cron" : "heartbeat";
}

function formatDreamGenerationMode(value) {
  return value === "fallback" ? "fallback" : value === "llm" ? "llm" : "-";
}

function formatDreamFallbackReason(value) {
  if (value === "missing_model_config") return "missing_model_config";
  if (value === "llm_call_failed") return "llm_call_failed";
  return "-";
}

function formatDreamCursorValue(cursor) {
  if (!cursor || typeof cursor !== "object") {
    return "";
  }
  return [
    `digest=${formatNumber(Number(cursor.digestGeneration) || 0)}`,
    `msg=${formatNumber(Number(cursor.sessionMemoryMessageCount) || 0)}`,
    `tool=${formatNumber(Number(cursor.sessionMemoryToolCursor) || 0)}`,
    `task=${formatNumber(Number(cursor.taskChangeSeq) || 0)}`,
    `memory=${formatNumber(Number(cursor.memoryChangeSeq) || 0)}`,
  ].join(", ");
}

function formatDreamSignalDelta(signal) {
  if (!signal || typeof signal !== "object") {
    return "";
  }
  const parts = [
    `digestΔ=${formatNumber(Number(signal.digestGenerationDelta) || 0)}`,
    `sessionMsgΔ=${formatNumber(Number(signal.sessionMemoryMessageDelta) || 0)}`,
    `sessionToolΔ=${formatNumber(Number(signal.sessionMemoryToolDelta) || 0)}`,
    `sessionRevΔ=${formatNumber(Number(signal.sessionMemoryRevisionDelta) || 0)}`,
    `taskΔ=${formatNumber(Number(signal.taskChangeSeqDelta) || 0)}`,
    `memoryΔ=${formatNumber(Number(signal.memoryChangeSeqDelta) || 0)}`,
    `budget=${formatNumber(Number(signal.changeBudget) || 0)}`,
  ];
  return parts.join(", ");
}

function formatKeyCountSummary(value) {
  const entries = Object.entries(value || {}).filter(([, count]) => Number.isFinite(count) && Number(count) > 0);
  if (entries.length === 0) {
    return "-";
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

function formatDreamTriggerModeStats(value) {
  const entries = Object.entries(value || {}).filter(([, stats]) => stats && typeof stats === "object");
  if (entries.length === 0) {
    return "-";
  }
  return entries.map(([key, stats]) => {
    const attempted = formatNumber(Number(stats.attemptedCount) || 0);
    const executed = formatNumber(Number(stats.executedCount) || 0);
    const skipped = formatNumber(Number(stats.skippedCount) || 0);
    return `${key}[attempted:${attempted}, executed:${executed}, skipped:${skipped}]`;
  }).join(", ");
}

function joinDroppedSections(reason) {
  const labels = Array.isArray(reason?.droppedSectionLabels) ? reason.droppedSectionLabels.filter(Boolean) : [];
  if (labels.length > 0) {
    return labels.join(", ");
  }
  const ids = Array.isArray(reason?.droppedSectionIds) ? reason.droppedSectionIds.filter(Boolean) : [];
  return ids.join(", ");
}

function buildPromptObservabilityCard(payload, t) {
  const summary = payload?.promptObservability?.summary;
  if (!summary) {
    return undefined;
  }
  const launchExplainabilityLines = buildLaunchExplainabilityLines(payload?.promptObservability?.launchExplainability, t);
  const residentStateBindingLines = buildResidentStateBindingLines(payload?.promptObservability?.residentStateBinding, t);

  const scopeText = summary.scope === "run"
    ? tr(
      t,
      "settings.doctorPromptScopeRun",
      { conversationId: summary.conversationId ?? "-" },
      summary.conversationId
        ? `当前会话 ${summary.conversationId} 最近一次实际发送的 prompt`
        : "最近一次实际发送的 prompt",
    )
    : tr(
      t,
      "settings.doctorPromptScopeAgent",
      { agentId: summary.agentId },
      `当前 Agent（${summary.agentId}）的装配基线`,
    );

  const badges = [
    tr(
      t,
      "settings.doctorPromptTokens",
      { tokens: formatNumber(summary.tokenBreakdown?.systemPromptEstimatedTokens) },
      `约 ${formatNumber(summary.tokenBreakdown?.systemPromptEstimatedTokens)} tokens`,
    ),
    tr(
      t,
      "settings.doctorPromptChars",
      { chars: formatNumber(summary.promptSizes?.finalChars) },
      `${formatNumber(summary.promptSizes?.finalChars)} chars`,
    ),
    tr(
      t,
      "settings.doctorPromptSections",
      { count: formatNumber(summary.counts?.sectionCount) },
      `${formatNumber(summary.counts?.sectionCount)} 段规则`,
    ),
    tr(
      t,
      "settings.doctorPromptDeltas",
      { count: formatNumber(summary.counts?.deltaCount) },
      `${formatNumber(summary.counts?.deltaCount)} 段动态补充`,
    ),
    tr(
      t,
      "settings.doctorPromptBlocks",
      { count: formatNumber(summary.counts?.providerNativeSystemBlockCount) },
      `${formatNumber(summary.counts?.providerNativeSystemBlockCount)} 个 provider block`,
    ),
  ];

  if (typeof summary.cacheSupport === "string" && summary.cacheSupport.trim()) {
    badges.push(tr(
      t,
      "settings.doctorPromptCacheSupport",
      { value: summary.cacheSupport },
      `cache ${summary.cacheSupport}`,
    ));
  }
  if (typeof summary.providerCacheEligible === "boolean") {
    badges.push(tr(
      t,
      "settings.doctorPromptCacheEligible",
      { value: summary.providerCacheEligible ? "yes" : "no" },
      `cache eligible ${summary.providerCacheEligible ? "yes" : "no"}`,
    ));
  }

  const notes = [scopeText];
  if (summary.truncationReason?.code) {
    notes.push(tr(
      t,
      "settings.doctorPromptTruncation",
      {
        count: formatNumber(summary.truncationReason.droppedSectionCount),
        sections: joinDroppedSections(summary.truncationReason) || "-",
        maxChars: formatNumber(summary.truncationReason.maxChars),
      },
      `因长度限制，已省略 ${formatNumber(summary.truncationReason.droppedSectionCount)} 段：${joinDroppedSections(summary.truncationReason) || "-"}。当前上限 ${formatNumber(summary.truncationReason.maxChars)} chars。`,
    ));
  } else {
    notes.push(tr(
      t,
      "settings.doctorPromptStable",
      {},
      "当前 prompt 没有因为长度限制而裁剪。",
    ));
  }
  if (typeof summary.systemPromptFingerprint === "string" && summary.systemPromptFingerprint.trim()) {
    notes.push(tr(
      t,
      "settings.doctorPromptFingerprint",
      { value: summary.systemPromptFingerprint },
      `Prompt fingerprint: ${summary.systemPromptFingerprint}`,
    ));
  }
  if (typeof summary.structureSignature === "string" && summary.structureSignature.trim()) {
    notes.push(tr(
      t,
      "settings.doctorPromptStructureSignature",
      { value: summary.structureSignature },
      `Structure signature: ${summary.structureSignature}`,
    ));
  }
  if (summary.prefixDrift && typeof summary.prefixDrift === "object") {
    notes.push(tr(
      t,
      "settings.doctorPromptPrefixDrift",
      {
        status: summary.prefixDrift.status || "-",
        reasons: Array.isArray(summary.prefixDrift.reasons) && summary.prefixDrift.reasons.length > 0
          ? summary.prefixDrift.reasons.join(", ")
          : "-",
      },
      `Prefix drift: ${summary.prefixDrift.status || "-"} (${Array.isArray(summary.prefixDrift.reasons) && summary.prefixDrift.reasons.length > 0 ? summary.prefixDrift.reasons.join(", ") : "-"})`,
    ));
  }
  if (summary.prefixWarmState && typeof summary.prefixWarmState === "object") {
    notes.push(tr(
      t,
      "settings.doctorPromptPrefixWarmState",
      {
        status: summary.prefixWarmState.status || "-",
        reason: summary.prefixWarmState.reason || "-",
        ageMs: formatNumber(summary.prefixWarmState.previousAgeMs),
      },
      `Prefix warm state: ${summary.prefixWarmState.status || "-"}; reason=${summary.prefixWarmState.reason || "-"}; ageMs=${formatNumber(summary.prefixWarmState.previousAgeMs)}`,
    ));
  }
  if (summary.orderingGuard && typeof summary.orderingGuard === "object") {
    notes.push(tr(
      t,
      "settings.doctorPromptOrderingGuard",
      {
        status: summary.orderingGuard.status || "-",
        reasons: Array.isArray(summary.orderingGuard.reasons) && summary.orderingGuard.reasons.length > 0
          ? summary.orderingGuard.reasons.join(", ")
          : "-",
      },
      `Ordering guard: ${summary.orderingGuard.status || "-"} (${Array.isArray(summary.orderingGuard.reasons) && summary.orderingGuard.reasons.length > 0 ? summary.orderingGuard.reasons.join(", ") : "-"})`,
    ));
  }
  if (summary.warmupCoordination && typeof summary.warmupCoordination === "object") {
    notes.push(tr(
      t,
      "settings.doctorPromptWarmupCoordination",
      {
        status: summary.warmupCoordination.status || "-",
        recommendation: summary.warmupCoordination.recommendation || "-",
        reason: summary.warmupCoordination.reason || "-",
      },
      `Warm-up coordination: ${summary.warmupCoordination.status || "-"}; recommendation=${summary.warmupCoordination.recommendation || "-"}; reason=${summary.warmupCoordination.reason || "-"}`,
    ));
  }
  if (summary.cacheFamilyAffinity && typeof summary.cacheFamilyAffinity === "object") {
    notes.push(tr(
      t,
      "settings.doctorPromptCacheFamilyAffinity",
      {
        status: summary.cacheFamilyAffinity.status || "-",
        reason: summary.cacheFamilyAffinity.reason || "-",
      },
      `Cache family affinity: ${summary.cacheFamilyAffinity.status || "-"}; reason=${summary.cacheFamilyAffinity.reason || "-"}`,
    ));
  }
  notes.push(...residentStateBindingLines);
  notes.push(...launchExplainabilityLines);

  return {
    title: tr(t, "settings.doctorPromptTitle", {}, "Prompt 摘要"),
    badges,
    notes,
    status: summary.truncationReason?.code ? "warn" : "pass",
  };
}

function buildToolBehaviorCard(payload, t) {
  const observability = payload?.toolBehaviorObservability;
  if (!observability) {
    return undefined;
  }
  const residentStateBinding = observability?.visibilityContext?.residentStateBinding
    && typeof observability.visibilityContext.residentStateBinding === "object"
    ? observability.visibilityContext.residentStateBinding
    : null;
  const residentStateBindingLines = buildResidentStateBindingLines(residentStateBinding, t);
  const launchExplainabilityLines = buildLaunchExplainabilityLines(
    observability?.visibilityContext?.launchExplainability,
    t,
  );

  const disabledCount = Array.isArray(observability.experiment?.disabledContractNamesApplied)
    ? observability.experiment.disabledContractNamesApplied.length
    : 0;

  const badges = [
    tr(
      t,
      "settings.doctorToolContractsIncluded",
      { count: formatNumber(observability.counts?.includedContractCount) },
      `${formatNumber(observability.counts?.includedContractCount)} 条工具规则生效`,
    ),
    tr(
      t,
      "settings.doctorToolContractsVisible",
      { count: formatNumber(observability.counts?.visibleToolContractCount) },
      `${formatNumber(observability.counts?.visibleToolContractCount)} 条可见`,
    ),
  ];

  if (disabledCount > 0) {
    badges.push(tr(
      t,
      "settings.doctorToolContractsDisabled",
      { count: formatNumber(disabledCount) },
      `${formatNumber(disabledCount)} 条被实验开关关闭`,
    ));
  }

  const notes = [
    tr(
      t,
      "settings.doctorToolContractsHelp",
      {},
      "这些规则会告诉模型什么时候该调用工具、什么时候先别乱用。",
    ),
  ];
  if (residentStateBinding) {
    notes.push(tr(
      t,
      "settings.doctorToolContractsScopeHelp",
      {},
      "当前工具可见性与审批判断，会复用 resident 的 workspace / state scope 绑定。",
    ));
    notes.push(...residentStateBindingLines);
  }
  notes.push(...launchExplainabilityLines);

  if (Array.isArray(observability.included) && observability.included.length > 0) {
    notes.push(tr(
      t,
      "settings.doctorToolContractsList",
      { names: observability.included.join(", ") },
      `当前生效：${observability.included.join(", ")}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorToolContractsTitle", {}, "工具使用规则"),
    badges,
    notes,
    status: disabledCount > 0 ? "warn" : "pass",
  };
}

function buildToolContractV2Card(payload, t) {
  const observability = payload?.toolContractV2Observability;
  if (!observability?.summary) {
    return undefined;
  }

  const summary = observability.summary;
  const badges = [
    tr(
      t,
      "settings.doctorToolContractV2Total",
      { count: formatNumber(summary.totalCount) },
      `${formatNumber(summary.totalCount)} 条 V2 契约`,
    ),
    tr(
      t,
      "settings.doctorToolContractV2HighRisk",
      { count: formatNumber(summary.highRiskCount) },
      `${formatNumber(summary.highRiskCount)} 条高风险`,
    ),
    tr(
      t,
      "settings.doctorToolContractV2Confirm",
      { count: formatNumber(summary.confirmRequiredCount) },
      `${formatNumber(summary.confirmRequiredCount)} 条需确认`,
    ),
  ];

  const notes = [];
  notes.push(tr(
    t,
    "settings.doctorToolContractV2Help",
    {},
    "这组摘要把治理契约和行为契约统一成一份可执行、可解释的工具规则视图。",
  ));
  notes.push(
    summary.missingV2Tools?.length
      ? tr(
        t,
        "settings.doctorToolContractV2Missing",
        { names: summary.missingV2Tools.join(", ") },
        `尚未补齐 V2 契约：${summary.missingV2Tools.join(", ")}`,
      )
      : tr(
        t,
        "settings.doctorToolContractV2Complete",
        {},
        "当前可见工具都已有 V2 契约摘要。",
      ),
  );

  return {
    title: tr(t, "settings.doctorToolContractV2Title", {}, "Tool Contract V2"),
    badges,
    notes,
    status: summary.missingV2Count > 0 ? "warn" : "pass",
  };
}

function buildResidentAgentsCard(payload, t) {
  const resident = payload?.residentAgents;
  if (!resident?.summary) {
    return undefined;
  }

  const summary = resident.summary;
  const badges = [
    tr(
      t,
      "settings.doctorResidentAgentsTotal",
      { count: formatNumber(summary.totalCount) },
      `${formatNumber(summary.totalCount)} 个 resident`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsActive",
      { count: formatNumber(summary.activeCount) },
      `${formatNumber(summary.activeCount)} 个活跃中`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsModes",
      {
        isolated: formatNumber(summary.memoryModeCounts?.isolated),
        shared: formatNumber(summary.memoryModeCounts?.shared),
        hybrid: formatNumber(summary.memoryModeCounts?.hybrid),
      },
      `isolated ${formatNumber(summary.memoryModeCounts?.isolated)} / shared ${formatNumber(summary.memoryModeCounts?.shared)} / hybrid ${formatNumber(summary.memoryModeCounts?.hybrid)}`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsRuntime",
      {
        running: formatNumber(summary.runningCount),
        background: formatNumber(summary.backgroundCount),
        idle: formatNumber(summary.idleCount),
        error: formatNumber(summary.errorCount),
      },
      `running ${formatNumber(summary.runningCount)} / background ${formatNumber(summary.backgroundCount)} / idle ${formatNumber(summary.idleCount)} / error ${formatNumber(summary.errorCount)}`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsDigest",
      {
        ready: formatNumber(summary.digestReadyCount),
        updated: formatNumber(summary.digestUpdatedCount),
        idle: formatNumber(summary.digestIdleCount),
        missing: formatNumber(summary.digestMissingCount),
      },
      `digest ready ${formatNumber(summary.digestReadyCount)} / updated ${formatNumber(summary.digestUpdatedCount)} / idle ${formatNumber(summary.digestIdleCount)} / missing ${formatNumber(summary.digestMissingCount)}`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsTasks",
      { count: formatNumber(summary.recentTaskLinkedCount) },
      `${formatNumber(summary.recentTaskLinkedCount)} resident(s) with recent task context`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsSubtasks",
      { count: formatNumber(summary.recentSubtaskLinkedCount) },
      `${formatNumber(summary.recentSubtaskLinkedCount)} resident(s) with recent subtask context`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsUsage",
      { count: formatNumber(summary.experienceUsageLinkedCount) },
      `${formatNumber(summary.experienceUsageLinkedCount)} resident(s) with experience usage context`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsCatalog",
      { count: formatNumber(summary.catalogAnnotatedCount) },
      `${formatNumber(summary.catalogAnnotatedCount)} resident(s) with catalog guidance`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsHandoff",
      { count: formatNumber(summary.structuredHandoffCount) },
      `${formatNumber(summary.structuredHandoffCount)} resident(s) with structured handoff`,
    ),
    tr(
      t,
      "settings.doctorResidentAgentsSkillHints",
      { count: formatNumber(summary.skillHintedCount) },
      `${formatNumber(summary.skillHintedCount)} resident(s) with skill hints`,
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorResidentAgentsHeadline",
      { headline: summary.headline },
      summary.headline,
    ),
  ];

  const agents = Array.isArray(resident.agents) ? resident.agents : [];
  for (const agent of agents.slice(0, 6)) {
    notes.push(buildResidentDoctorNote(agent, t));
  }

  return {
    title: tr(t, "settings.doctorResidentAgentsTitle", {}, "Resident Agents"),
    badges,
    notes,
    status: summary.totalCount > 0 ? "pass" : "warn",
  };
}

function buildMindProfileSnapshotCard(payload, t) {
  const snapshot = payload?.mindProfileSnapshot;
  const summary = snapshot?.summary;
  if (!summary) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorMindProfileUser",
      { status: summary.hasUserProfile ? "ready" : "missing" },
      `user ${summary.hasUserProfile ? "ready" : "missing"}`,
    ),
    tr(
      t,
      "settings.doctorMindProfileMemory",
      {
        private: formatNumber(summary.privateMemoryCount),
        shared: formatNumber(summary.sharedMemoryCount),
      },
      `private ${formatNumber(summary.privateMemoryCount)} / shared ${formatNumber(summary.sharedMemoryCount)}`,
    ),
    tr(
      t,
      "settings.doctorMindProfileDigest",
      {
        active: formatNumber(summary.activeResidentCount),
        ready: formatNumber(summary.digestReadyCount),
        updated: formatNumber(summary.digestUpdatedCount),
      },
      `active ${formatNumber(summary.activeResidentCount)} / digest ${formatNumber(summary.digestReadyCount)} ready ${formatNumber(summary.digestUpdatedCount)} updated`,
    ),
    tr(
      t,
      "settings.doctorMindProfileUsage",
      { count: formatNumber(summary.usageLinkedCount) },
      `${formatNumber(summary.usageLinkedCount)} usage-linked resident(s)`,
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorMindProfileHeadline",
      { headline: summary.headline },
      summary.headline,
    ),
  ];

  const profileLines = Array.isArray(snapshot?.profile?.summaryLines) ? snapshot.profile.summaryLines : [];
  notes.push(...profileLines.slice(0, 6));

  const topResidents = Array.isArray(snapshot?.conversation?.topResidents) ? snapshot.conversation.topResidents : [];
  for (const item of topResidents.slice(0, 3)) {
    notes.push(`Resident: ${item.headline}`);
  }

  const snippets = Array.isArray(snapshot?.memory?.recentMemorySnippets) ? snapshot.memory.recentMemorySnippets : [];
  for (const item of snippets.slice(0, 3)) {
    notes.push(`${item.scope === "shared" ? "Shared" : "Private"} recent: ${item.text}`);
  }

  return {
    title: tr(t, "settings.doctorMindProfileTitle", {}, "Mind / Profile Snapshot"),
    badges,
    notes,
    status: summary.available ? "pass" : "warn",
  };
}

function buildLearningReviewInputCard(payload, t) {
  const input = payload?.learningReviewInput;
  const summary = input?.summary;
  const runtime = payload?.learningReviewNudgeRuntime?.summary;
  if (!summary && !runtime) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorLearningReviewSignals",
      {
        memory: formatNumber(summary?.memorySignalCount),
        candidate: formatNumber(summary?.candidateSignalCount),
        review: formatNumber(summary?.reviewSignalCount),
      },
      `memory ${formatNumber(summary?.memorySignalCount)} / candidate ${formatNumber(summary?.candidateSignalCount)} / review ${formatNumber(summary?.reviewSignalCount)}`,
    ),
    tr(
      t,
      "settings.doctorLearningReviewNudges",
      { count: formatNumber(summary?.nudgeCount) },
      `${formatNumber(summary?.nudgeCount)} nudges`,
    ),
  ];
  if (runtime) {
    badges.push(
      tr(
        t,
        "settings.doctorLearningReviewRuntime",
        { state: runtime.triggered ? "triggered" : "idle" },
        `runtime ${runtime.triggered ? "triggered" : "idle"}`,
      ),
    );
    badges.push(
      tr(
        t,
        "settings.doctorLearningReviewSession",
        { kind: runtime.sessionKind || "main" },
        `session ${runtime.sessionKind || "main"}`,
      ),
    );
  }

  const notes = [];
  if (summary) {
    notes.push(tr(
      t,
      "settings.doctorLearningReviewHeadline",
      { headline: summary.headline },
      summary.headline,
    ));
  }
  if (runtime) {
    notes.push(tr(
      t,
      "settings.doctorLearningReviewRuntimeHeadline",
      { headline: runtime.headline },
      runtime.headline,
    ));
    if (Array.isArray(runtime.triggerSources) && runtime.triggerSources.length > 0) {
      notes.push(tr(
        t,
        "settings.doctorLearningReviewTriggerSources",
        { summary: runtime.triggerSources.join(", ") },
        `sources: ${runtime.triggerSources.join(", ")}`,
      ));
    }
    if (Array.isArray(runtime.signalKinds) && runtime.signalKinds.length > 0) {
      notes.push(tr(
        t,
        "settings.doctorLearningReviewSignalKinds",
        { summary: runtime.signalKinds.join(", ") },
        `signals: ${runtime.signalKinds.join(", ")}`,
      ));
    }
    if (payload?.learningReviewNudgeRuntime?.latest?.currentTurnPreview) {
      notes.push(`Latest turn: ${payload.learningReviewNudgeRuntime.latest.currentTurnPreview}`);
    }
  }

  const summaryLines = Array.isArray(input?.summaryLines) ? input.summaryLines : [];
  notes.push(...summaryLines.slice(0, 4));

  const nudges = Array.isArray(input?.nudges) ? input.nudges : [];
  for (const item of nudges.slice(0, 4)) {
    notes.push(`Nudge: ${item}`);
  }

  return {
    title: tr(t, "settings.doctorLearningReviewTitle", {}, "Learning / Review Input"),
    badges,
    notes,
    status: runtime?.available || summary?.available ? "pass" : "warn",
  };
}

function buildDreamRuntimeCard(payload, t) {
  const dreamRuntime = payload?.dreamRuntime;
  if (!dreamRuntime) {
    return undefined;
  }
  const requested = dreamRuntime?.requested ?? {};
  const availability = dreamRuntime?.availability ?? {};
  const state = dreamRuntime?.state ?? {};
  const autoSummary = dreamRuntime?.autoSummary
    ?? (state?.lastAutoTrigger
      ? {
          ...state.lastAutoTrigger,
          cooldownUntil: state?.cooldownUntil,
          failureBackoffUntil: state?.failureBackoffUntil,
        }
      : null);
  const latestRun = dreamRuntime?.latestRun
    ?? (Array.isArray(state?.recentRuns) ? state.recentRuns[0] : null);
  const lastInput = state?.lastInput ?? latestRun?.input ?? null;
  const sourceCounts = lastInput?.sourceCounts ?? {};
  const badges = [
    tr(
      t,
      "settings.doctorDreamRuntimeAgent",
      { agentId: requested.agentId || "default" },
      `agent ${requested.agentId || "default"}`,
    ),
    tr(
      t,
      "settings.doctorDreamRuntimeAvailability",
      {
        model: availability.model || "-",
        reason: availability.reason || "-",
      },
      availability.available
        ? `model ${availability.model || "-"}`
        : `blocked: ${availability.reason || "unknown"}`,
    ),
    tr(
      t,
      "settings.doctorDreamRuntimeStatus",
      { status: formatDreamStatusLabel(state?.status) },
      `status ${formatDreamStatusLabel(state?.status)}`,
    ),
  ];

  if (latestRun?.requestedAt) {
  badges.push(tr(
      t,
      "settings.doctorDreamRuntimeLatest",
      { at: formatDateValue(latestRun.finishedAt || latestRun.requestedAt) },
      `latest ${formatDateValue(latestRun.finishedAt || latestRun.requestedAt)}`,
    ));
  }
  if (latestRun?.generationMode) {
    badges.push(tr(
      t,
      "settings.doctorDreamRuntimeGenerationMode",
      { mode: formatDreamGenerationMode(latestRun.generationMode) },
      `generation ${formatDreamGenerationMode(latestRun.generationMode)}`,
    ));
  }

  const notes = [
    dreamRuntime.headline || "Dream runtime summary is not available.",
    tr(
      t,
      "settings.doctorDreamRuntimeConversation",
      { conversationId: requested.defaultConversationId || "-" },
      `default conversation: ${requested.defaultConversationId || "-"}`,
    ),
  ];

  if (latestRun?.summary) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeSummary",
      { summary: latestRun.summary },
      `latest summary: ${latestRun.summary}`,
    ));
  }
  if (latestRun?.generationMode) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeGenerationModeNote",
      {
        mode: formatDreamGenerationMode(latestRun.generationMode),
        fallbackReason: formatDreamFallbackReason(latestRun.fallbackReason),
      },
      `latest generation: ${formatDreamGenerationMode(latestRun.generationMode)}${latestRun.fallbackReason ? ` (${formatDreamFallbackReason(latestRun.fallbackReason)})` : ""}`,
    ));
  }
  if (latestRun?.error) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeError",
      { error: latestRun.error },
      `latest error: ${latestRun.error}`,
    ));
  }
  if (!availability.available && availability.enabled) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeFallbackReady",
      {
        reason: availability.reason || "-",
      },
      `LLM unavailable but fallback remains ready: ${availability.reason || "-"}`,
    ));
  }
  if (lastInput) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeInput",
      {
        tasks: formatNumber(Number(sourceCounts.recentTaskCount) || 0),
        memories: formatNumber(Number(sourceCounts.recentDurableMemoryCount) || 0),
        usages: formatNumber(Number(sourceCounts.recentExperienceUsageCount) || 0),
      },
      `latest input: tasks=${formatNumber(Number(sourceCounts.recentTaskCount) || 0)}, memories=${formatNumber(Number(sourceCounts.recentDurableMemoryCount) || 0)}, usages=${formatNumber(Number(sourceCounts.recentExperienceUsageCount) || 0)}`,
    ));
  }
  if (state?.lastObsidianSync?.stage) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeObsidian",
      {
        stage: state.lastObsidianSync.stage,
        targetPath: state.lastObsidianSync.targetPath || "-",
      },
      `obsidian: ${state.lastObsidianSync.stage} (${state.lastObsidianSync.targetPath || "-"})`,
    ));
  }
  if (autoSummary?.attemptedAt) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoTrigger",
      {
        triggerMode: formatDreamAutoTriggerMode(autoSummary.triggerMode),
        attemptedAt: formatDateValue(autoSummary.attemptedAt),
        outcome: autoSummary.executed
          ? formatDreamStatusLabel(autoSummary.status)
          : `skip ${autoSummary.skipCode || "unknown"}`,
      },
      `auto trigger: ${formatDreamAutoTriggerMode(autoSummary.triggerMode)} at ${formatDateValue(autoSummary.attemptedAt)} -> ${autoSummary.executed ? formatDreamStatusLabel(autoSummary.status) : `skip ${autoSummary.skipCode || "unknown"}`}`,
    ));
  }
  if (state?.autoStats) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoStats",
      {
        attempted: formatNumber(Number(state.autoStats.attemptedCount) || 0),
        executed: formatNumber(Number(state.autoStats.executedCount) || 0),
        skipped: formatNumber(Number(state.autoStats.skippedCount) || 0),
      },
      `auto stats: attempted=${formatNumber(Number(state.autoStats.attemptedCount) || 0)}, executed=${formatNumber(Number(state.autoStats.executedCount) || 0)}, skipped=${formatNumber(Number(state.autoStats.skippedCount) || 0)}`,
    ));
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoSkipStats",
      {
        summary: formatKeyCountSummary(state.autoStats.skipCodeCounts),
      },
      `auto skip stats: ${formatKeyCountSummary(state.autoStats.skipCodeCounts)}`,
    ));
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoGateStats",
      {
        summary: formatKeyCountSummary(state.autoStats.signalGateCounts),
      },
      `auto gate stats: ${formatKeyCountSummary(state.autoStats.signalGateCounts)}`,
    ));
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoModeStats",
      {
        summary: formatDreamTriggerModeStats(state.autoStats.byTriggerMode),
      },
      `auto mode stats: ${formatDreamTriggerModeStats(state.autoStats.byTriggerMode)}`,
    ));
  }
  if (autoSummary?.skipReason) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoSkipReason",
      {
        reason: autoSummary.skipReason,
      },
      `auto note: ${autoSummary.skipReason}`,
    ));
  }
  if (autoSummary?.signal) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoSignal",
      {
        summary: formatDreamSignalDelta(autoSummary.signal),
      },
      `auto signal: ${formatDreamSignalDelta(autoSummary.signal)}`,
    ));
    const lastCursor = formatDreamCursorValue(autoSummary.signal.lastDreamCursor);
    const currentCursor = formatDreamCursorValue(autoSummary.signal.currentCursor);
    if (lastCursor || currentCursor) {
      notes.push(tr(
        t,
        "settings.doctorDreamRuntimeAutoCursor",
        {
          lastCursor: lastCursor || "-",
          currentCursor: currentCursor || "-",
        },
        `auto cursor: last[${lastCursor || "-"}] -> current[${currentCursor || "-"}]`,
      ));
    }
  }
  if (autoSummary?.cooldownUntil || autoSummary?.failureBackoffUntil) {
    notes.push(tr(
      t,
      "settings.doctorDreamRuntimeAutoGates",
      {
        cooldownUntil: formatDateValue(autoSummary.cooldownUntil),
        failureBackoffUntil: formatDateValue(autoSummary.failureBackoffUntil),
      },
      `auto gates: cooldown=${formatDateValue(autoSummary.cooldownUntil)}; backoff=${formatDateValue(autoSummary.failureBackoffUntil)}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorDreamRuntimeTitle", {}, "Dream Runtime"),
    badges,
    notes,
    status: !availability.enabled || !availability.available || latestRun?.status === "failed" || latestRun?.generationMode === "fallback" ? "warn" : "pass",
  };
}

function buildDreamCommonsCard(payload, t) {
  const dreamCommons = payload?.dreamCommons;
  if (!dreamCommons) {
    return undefined;
  }

  const availability = dreamCommons?.availability ?? {};
  const state = dreamCommons?.state ?? {};
  const badges = [
    tr(
      t,
      "settings.doctorDreamCommonsAvailability",
      {
        vaultPath: availability.vaultPath || "-",
        reason: availability.reason || "-",
      },
      availability.available
        ? `vault ${availability.vaultPath || "-"}`
        : `blocked: ${availability.reason || "unknown"}`,
    ),
    tr(
      t,
      "settings.doctorDreamCommonsStatus",
      { status: state?.status || "idle" },
      `status ${state?.status || "idle"}`,
    ),
  ];

  if (state?.lastSuccessAt || state?.lastAttemptAt) {
    badges.push(tr(
      t,
      "settings.doctorDreamCommonsLatest",
      { at: formatDateValue(state?.lastSuccessAt || state?.lastAttemptAt) },
      `latest ${formatDateValue(state?.lastSuccessAt || state?.lastAttemptAt)}`,
    ));
  }

  const notes = [
    dreamCommons.headline || "Commons export summary is not available.",
  ];

  if (availability.sharedStateDir) {
    notes.push(tr(
      t,
      "settings.doctorDreamCommonsSharedStateDir",
      { sharedStateDir: availability.sharedStateDir },
      `shared state dir: ${availability.sharedStateDir}`,
    ));
  }
  if (typeof state?.approvedCount === "number" || typeof state?.revokedCount === "number" || typeof state?.noteCount === "number") {
    notes.push(tr(
      t,
      "settings.doctorDreamCommonsCounts",
      {
        approved: formatNumber(Number(state?.approvedCount) || 0),
        revoked: formatNumber(Number(state?.revokedCount) || 0),
        notes: formatNumber(Number(state?.noteCount) || 0),
        agentPages: formatNumber(Number(state?.agentPageCount) || 0),
      },
      `counts: approved=${formatNumber(Number(state?.approvedCount) || 0)}, revoked=${formatNumber(Number(state?.revokedCount) || 0)}, notes=${formatNumber(Number(state?.noteCount) || 0)}, agent-pages=${formatNumber(Number(state?.agentPageCount) || 0)}`,
    ));
  }
  if (state?.targetPath) {
    notes.push(tr(
      t,
      "settings.doctorDreamCommonsTargetPath",
      { targetPath: state.targetPath },
      `commons path: ${state.targetPath}`,
    ));
  }
  if (state?.indexPath) {
    notes.push(tr(
      t,
      "settings.doctorDreamCommonsIndexPath",
      { indexPath: state.indexPath },
      `index path: ${state.indexPath}`,
    ));
  }
  if (state?.lastSuccessAt || state?.lastAttemptAt || state?.lastFailureAt) {
    notes.push(tr(
      t,
      "settings.doctorDreamCommonsTimeline",
      {
        lastAttemptAt: formatDateValue(state?.lastAttemptAt),
        lastSuccessAt: formatDateValue(state?.lastSuccessAt),
        lastFailureAt: formatDateValue(state?.lastFailureAt),
      },
      `timeline: attempt=${formatDateValue(state?.lastAttemptAt)}, success=${formatDateValue(state?.lastSuccessAt)}, failure=${formatDateValue(state?.lastFailureAt)}`,
    ));
  }
  if (state?.error) {
    notes.push(tr(
      t,
      "settings.doctorDreamCommonsError",
      { error: state.error },
      `latest error: ${state.error}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorDreamCommonsTitle", {}, "Dream Commons"),
    badges,
    notes,
    status: !availability.enabled || !availability.available || state?.status === "failed" ? "warn" : "pass",
  };
}

function buildSkillFreshnessCard(payload, t) {
  const summary = payload?.skillFreshness?.summary;
  if (!summary) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorSkillFreshnessCounts",
      {
        healthy: formatNumber(summary.healthyCount),
        warn: formatNumber(summary.warnCount),
        patch: formatNumber(summary.needsPatchCount),
        fresh: formatNumber(summary.needsNewSkillCount),
      },
      `healthy ${formatNumber(summary.healthyCount)} / warn ${formatNumber(summary.warnCount)} / patch ${formatNumber(summary.needsPatchCount)} / new ${formatNumber(summary.needsNewSkillCount)}`,
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorSkillFreshnessHeadline",
      { headline: summary.headline || "-" },
      summary.headline || "-",
    ),
  ];
  const topItems = Array.isArray(summary.topItems) ? summary.topItems.slice(0, 4) : [];
  if (!topItems.length) {
    notes.push(tr(t, "settings.doctorSkillFreshnessEmpty", {}, "当前没有需要处理的 skill freshness 风险。"));
  }
  for (const item of topItems) {
    notes.push(tr(
      t,
      "settings.doctorSkillFreshnessTopItem",
      {
        name: item.displayName || item.skillKey || "-",
        status: item.status || "healthy",
        summary: item.summary || "-",
      },
      `${item.displayName || item.skillKey || "-"} [${item.status || "healthy"}]: ${item.summary || "-"}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorSkillFreshnessTitle", {}, "Skill Freshness"),
    badges,
    notes,
    status: (Number(summary.warnCount) || 0) + (Number(summary.needsPatchCount) || 0) + (Number(summary.needsNewSkillCount) || 0) > 0
      ? "warn"
      : summary.available
        ? "pass"
        : "warn",
  };
}

function buildSharedGovernanceCard(payload, t) {
  const sharedMemory = payload?.memoryRuntime?.sharedMemory;
  const residentSummary = payload?.residentAgents?.summary;
  if (!sharedMemory && !residentSummary) {
    return undefined;
  }

  const enabled = sharedMemory?.enabled === true;
  const available = sharedMemory?.available === true;
  const badges = [
    tr(
      t,
      "settings.doctorSharedGovernanceReaders",
      { count: formatNumber(residentSummary?.sharedReadEnabledCount) },
      `${formatNumber(residentSummary?.sharedReadEnabledCount)} 个 shared reader`,
    ),
    tr(
      t,
      "settings.doctorSharedGovernanceWriters",
      { count: formatNumber(residentSummary?.writeTargetCounts?.shared) },
      `${formatNumber(residentSummary?.writeTargetCounts?.shared)} 个 shared writer`,
    ),
    tr(
      t,
      "settings.doctorSharedGovernanceGuard",
      { status: sharedMemory?.secretGuard?.enabled === true ? "on" : "off" },
      `secret guard ${sharedMemory?.secretGuard?.enabled === true ? "on" : "off"}`,
    ),
    tr(
      t,
      "settings.doctorSharedGovernancePending",
      { count: formatNumber(residentSummary?.sharedGovernanceCounts?.pendingCount) },
      `${formatNumber(residentSummary?.sharedGovernanceCounts?.pendingCount)} pending approval(s)`,
    ),
    tr(
      t,
      "settings.doctorSharedGovernanceClaimed",
      { count: formatNumber(residentSummary?.sharedGovernanceCounts?.claimedCount) },
      `${formatNumber(residentSummary?.sharedGovernanceCounts?.claimedCount)} claimed pending item(s)`,
    ),
  ];

  const notes = [];
  notes.push(tr(
    t,
    "settings.doctorSharedGovernanceAvailability",
    { status: enabled ? (available ? "available" : "blocked") : "disabled" },
    enabled ? (available ? "shared layer 可用" : "shared layer 已启用但当前不可用") : "shared layer 未启用",
  ));
  if (sharedMemory?.secretGuard?.summary) {
    notes.push(tr(
      t,
      "settings.doctorSharedGovernanceGuardNote",
      { summary: sharedMemory.secretGuard.summary },
      `secret guard: ${sharedMemory.secretGuard.summary}`,
    ));
  }
  if (sharedMemory?.syncPolicy?.conflictPolicy?.summary) {
    notes.push(tr(
      t,
      "settings.doctorSharedGovernanceConflict",
      { summary: sharedMemory.syncPolicy.conflictPolicy.summary },
      `conflict policy: ${sharedMemory.syncPolicy.conflictPolicy.summary}`,
    ));
  }
  if (Array.isArray(sharedMemory?.reasonMessages) && sharedMemory.reasonMessages.length > 0 && !available) {
    notes.push(tr(
      t,
      "settings.doctorSharedGovernanceBlockedReasons",
      { reasons: sharedMemory.reasonMessages.join(" | ") },
      `blocked reasons: ${sharedMemory.reasonMessages.join(" | ")}`,
    ));
  }
  const residentAgents = Array.isArray(payload?.residentAgents?.agents) ? payload.residentAgents.agents : [];
  for (const agent of residentAgents.slice(0, 6)) {
    const pendingCount = Number(agent?.sharedGovernance?.pendingCount) || 0;
    const claimedCount = Number(agent?.sharedGovernance?.claimedCount) || 0;
    const approvedCount = Number(agent?.sharedGovernance?.approvedCount) || 0;
    const rejectedCount = Number(agent?.sharedGovernance?.rejectedCount) || 0;
    const revokedCount = Number(agent?.sharedGovernance?.revokedCount) || 0;
    if (pendingCount + claimedCount + approvedCount + rejectedCount + revokedCount <= 0) continue;
    notes.push(
      `${agent.displayName || agent.id}: pending=${pendingCount}, claimed=${claimedCount}, approved=${approvedCount}, rejected=${rejectedCount}, revoked=${revokedCount}`,
    );
  }

  return {
    title: tr(t, "settings.doctorSharedGovernanceTitle", {}, "Shared Governance"),
    badges,
    notes,
    status: available ? "pass" : enabled ? "warn" : "warn",
  };
}

function buildCompactionRuntimeCard(payload, t) {
  const runtime = payload?.memoryRuntime?.compactionRuntime;
  const compactionRouting = payload?.runtimeResilience?.routing?.compaction;
  if (!runtime?.totals) {
    return undefined;
  }

  const last = runtime.lastResult;
  const obs = last?.summarizerObservability;
  const badges = [
    tr(
      t,
      "settings.doctorCompactionRuntimeAttempts",
      {
        attempts: formatNumber(runtime.totals.attempts),
        fallbacks: formatNumber(runtime.totals.fallbacks),
        failures: formatNumber(runtime.totals.failures),
      },
      `${formatNumber(runtime.totals.attempts)} attempts / fallback ${formatNumber(runtime.totals.fallbacks)} / failures ${formatNumber(runtime.totals.failures)}`,
    ),
    tr(
      t,
      "settings.doctorCompactionRuntimeRetries",
      {
        retries: formatNumber(runtime.totals.promptTooLongRetries),
        warnings: formatNumber(runtime.totals.warningHits),
        blocking: formatNumber(runtime.totals.blockingHits),
      },
      `PTL retries ${formatNumber(runtime.totals.promptTooLongRetries)} / warnings ${formatNumber(runtime.totals.warningHits)} / blocking ${formatNumber(runtime.totals.blockingHits)}`,
    ),
  ];

  const notes = [];
  if (runtime.circuitBreaker?.open) {
    notes.push(tr(
      t,
      "settings.doctorCompactionRuntimeCircuit",
      { count: formatNumber(runtime.circuitBreaker.remainingSkips) },
      `Circuit open, remaining skips ${formatNumber(runtime.circuitBreaker.remainingSkips)}`,
    ));
  }
  if (compactionRouting?.auxSummaryVerdict) {
    notes.push(tr(
      t,
      "settings.doctorCompactionRuntimeAuxVerdict",
      {
        strategy: compactionRouting.auxSummaryVerdict.strategy || "-",
        reason: compactionRouting.auxSummaryVerdict.reason || "-",
        enabled: compactionRouting.auxSummaryVerdict.enabled ? "yes" : "no",
      },
      `aux summary verdict: ${compactionRouting.auxSummaryVerdict.strategy || "-"} / ${compactionRouting.auxSummaryVerdict.reason || "-"} / enabled=${compactionRouting.auxSummaryVerdict.enabled ? "yes" : "no"}`,
    ));
  }
  if (obs) {
    notes.push(tr(
      t,
      "settings.doctorCompactionRuntimeSummaryMode",
      { value: obs.mode || "-" },
      `summary mode: ${obs.mode || "-"}`,
    ));
    notes.push(tr(
      t,
      "settings.doctorCompactionRuntimeCacheAligned",
      { value: obs.cacheAlignedRequested ? "yes" : "no" },
      `cache aligned: ${obs.cacheAlignedRequested ? "yes" : "no"}`,
    ));
    if (typeof obs.cacheSupport === "string" && obs.cacheSupport.trim()) {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeCacheSupport",
        { value: obs.cacheSupport },
        `cache support: ${obs.cacheSupport}`,
      ));
    }
    if (typeof obs.cacheHitTokens === "number" || typeof obs.cacheMissTokens === "number") {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeCacheUsage",
        {
          hit: formatNumber(obs.cacheHitTokens),
          miss: formatNumber(obs.cacheMissTokens),
        },
        `cache usage: hit=${formatNumber(obs.cacheHitTokens)}, miss=${formatNumber(obs.cacheMissTokens)}`,
      ));
    }
    if (typeof obs.cacheSavingsUsd === "number") {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeCacheSavings",
        { value: obs.cacheSavingsUsd.toFixed(6) },
        `cache savings: $${obs.cacheSavingsUsd.toFixed(6)}`,
      ));
    }
    if (typeof obs.usedWireApi === "string" && obs.usedWireApi.trim()) {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeWireApi",
        { value: obs.usedWireApi },
        `wire api: ${obs.usedWireApi}`,
      ));
    }
    if (obs.strategy && typeof obs.strategy === "object") {
      if (typeof obs.strategy.kind === "string" && obs.strategy.kind.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeStrategy",
          { value: obs.strategy.kind },
          `provider strategy: ${obs.strategy.kind}`,
        ));
      }
      if (typeof obs.strategy.providerCacheMode === "string" && obs.strategy.providerCacheMode.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeProviderMode",
          { value: obs.strategy.providerCacheMode },
          `provider cache mode: ${obs.strategy.providerCacheMode}`,
        ));
      }
      if (typeof obs.strategy.selectionReason === "string" && obs.strategy.selectionReason.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeSelectionReason",
          { value: obs.strategy.selectionReason },
          `selection reason: ${obs.strategy.selectionReason}`,
        ));
      }
      if (typeof obs.strategy.degradePath === "string" && obs.strategy.degradePath.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeDegradePath",
          { value: obs.strategy.degradePath },
          `degrade path: ${obs.strategy.degradePath}`,
        ));
      }
      if (typeof obs.strategy.fallbackPolicy === "string" && obs.strategy.fallbackPolicy.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeFallbackPolicy",
          { value: obs.strategy.fallbackPolicy },
          `fallback policy: ${obs.strategy.fallbackPolicy}`,
        ));
      }
      if (typeof obs.strategy.fallbackTriggered === "boolean") {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeFallbackTriggered",
          { value: obs.strategy.fallbackTriggered ? "yes" : "no" },
          `fallback triggered: ${obs.strategy.fallbackTriggered ? "yes" : "no"}`,
        ));
      }
      if (typeof obs.strategy.fallbackSummary === "string" && obs.strategy.fallbackSummary.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeFallbackSummary",
          { value: obs.strategy.fallbackSummary },
          `fallback summary: ${obs.strategy.fallbackSummary}`,
        ));
      }
      if (typeof obs.strategy.providerModelNotes === "string" && obs.strategy.providerModelNotes.trim()) {
        notes.push(tr(
          t,
          "settings.doctorCompactionRuntimeProviderNotes",
          { value: obs.strategy.providerModelNotes },
          `provider notes: ${obs.strategy.providerModelNotes}`,
        ));
      }
    }
    if (typeof obs.compareAvailable === "boolean") {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeComparisonAvailable",
        { value: obs.compareAvailable ? "yes" : "no" },
        `comparison available: ${obs.compareAvailable ? "yes" : "no"}`,
      ));
    }
    if (obs.comparison && typeof obs.comparison === "object") {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeComparison",
        {
          plainChars: formatNumber(obs.comparison.plainPromptCharsEstimate),
          replayChars: formatNumber(obs.comparison.cacheAlignedReplayCharsEstimate),
          instructionChars: formatNumber(obs.comparison.cacheAlignedInstructionChars),
          overheadChars: formatNumber(obs.comparison.replayOverheadChars),
        },
        `comparison: plain≈${formatNumber(obs.comparison.plainPromptCharsEstimate)} chars, replay≈${formatNumber(obs.comparison.cacheAlignedReplayCharsEstimate)} chars, instruction≈${formatNumber(obs.comparison.cacheAlignedInstructionChars)} chars, overhead≈${formatNumber(obs.comparison.replayOverheadChars)} chars`,
      ));
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeComparisonMessages",
        {
          plainCount: formatNumber(obs.comparison.plainRequestMessageCount),
          cacheAlignedCount: formatNumber(obs.comparison.cacheAlignedRequestMessageCount),
        },
        `comparison messages: plain=${formatNumber(obs.comparison.plainRequestMessageCount)}, cache-aligned=${formatNumber(obs.comparison.cacheAlignedRequestMessageCount)}`,
      ));
    }
    if (typeof obs.fallbackStage === "string" && obs.fallbackStage.trim()) {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeFallbackStage",
        { value: obs.fallbackStage },
        `fallback stage: ${obs.fallbackStage}`,
      ));
    }
    if (typeof obs.failureReason === "string" && obs.failureReason.trim()) {
      notes.push(tr(
        t,
        "settings.doctorCompactionRuntimeFailureReason",
        { value: obs.failureReason },
        `failure reason: ${obs.failureReason}`,
      ));
    }
  } else if (typeof last?.failureReason === "string" && last.failureReason.trim()) {
    notes.push(tr(
      t,
      "settings.doctorCompactionRuntimeFailureReason",
      { value: last.failureReason },
      `failure reason: ${last.failureReason}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorCompactionRuntimeTitle", {}, "Compaction Runtime"),
    badges,
    notes,
    status: runtime.circuitBreaker?.open || runtime.totals.failures > 0 ? "warn" : "pass",
  };
}

function buildDelegationCard(payload, t) {
  const observability = payload?.delegationObservability;
  const summary = observability?.summary;
  if (!summary) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorDelegationProtocolBacked",
      { count: formatNumber(summary.protocolBackedCount), total: formatNumber(summary.totalCount) },
      `${formatNumber(summary.protocolBackedCount)}/${formatNumber(summary.totalCount)} protocol-backed`,
    ),
    tr(
      t,
      "settings.doctorDelegationActive",
      { count: formatNumber(summary.activeCount) },
      `${formatNumber(summary.activeCount)} active`,
    ),
    tr(
      t,
      "settings.doctorDelegationCompleted",
      { count: formatNumber(summary.completedCount) },
      `${formatNumber(summary.completedCount)} completed`,
    ),
  ];

  const sourcePairs = Object.entries(summary.sourceCounts || {});
  if (sourcePairs.length > 0) {
    badges.push(tr(
      t,
      "settings.doctorDelegationSources",
      { summary: sourcePairs.map(([key, count]) => `${key}:${count}`).join(", ") },
      `sources ${sourcePairs.map(([key, count]) => `${key}:${count}`).join(", ")}`,
    ));
  }

  const aggregationPairs = Object.entries(summary.aggregationModeCounts || {});
  if (aggregationPairs.length > 0) {
    badges.push(tr(
      t,
      "settings.doctorDelegationAggregations",
      { summary: aggregationPairs.map(([key, count]) => `${key}:${count}`).join(", ") },
      `aggregation ${aggregationPairs.map(([key, count]) => `${key}:${count}`).join(", ")}`,
    ));
  }

  const notes = [
    tr(
      t,
      "settings.doctorDelegationHeadline",
      { headline: summary.headline },
      summary.headline,
    ),
  ];

  const items = Array.isArray(observability.items) ? observability.items : [];
  for (const item of items.slice(0, 6)) {
    const parts = [
      item.status ? `status=${item.status}` : "",
      item.source ? `source=${item.source}` : "",
      item.aggregationMode ? `aggregation=${item.aggregationMode}` : "",
      item.expectedDeliverableFormat ? `deliverable=${item.expectedDeliverableFormat}` : "",
      item.expectedDeliverableSummary ? `deliverable-summary=${item.expectedDeliverableSummary}` : "",
      item.intentSummary ? `intent=${item.intentSummary}` : "",
    ].filter(Boolean);
    notes.push(
      `${item.taskId}: ${parts.join(", ")}`,
    );
  }

  return {
    title: tr(t, "settings.doctorDelegationTitle", {}, "Delegation Protocol"),
    badges,
    notes,
    status: summary.activeCount > summary.protocolBackedCount ? "warn" : "pass",
  };
}

function buildCronRuntimeCard(payload, t) {
  const cronRuntime = payload?.cronRuntime;
  if (!cronRuntime?.scheduler || !cronRuntime?.totals) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorCronJobs",
      {
        enabled: formatNumber(cronRuntime.totals.enabledJobs),
        total: formatNumber(cronRuntime.totals.totalJobs),
      },
      `${formatNumber(cronRuntime.totals.enabledJobs)}/${formatNumber(cronRuntime.totals.totalJobs)} jobs enabled`,
    ),
    tr(
      t,
      "settings.doctorCronSessions",
      {
        main: formatNumber(cronRuntime.sessionTargetCounts?.main),
        isolated: formatNumber(cronRuntime.sessionTargetCounts?.isolated),
      },
      `main ${formatNumber(cronRuntime.sessionTargetCounts?.main)} / isolated ${formatNumber(cronRuntime.sessionTargetCounts?.isolated)}`,
    ),
    tr(
      t,
      "settings.doctorCronDelivery",
      {
        user: formatNumber(cronRuntime.deliveryModeCounts?.user),
        none: formatNumber(cronRuntime.deliveryModeCounts?.none),
      },
      `delivery user ${formatNumber(cronRuntime.deliveryModeCounts?.user)} / none ${formatNumber(cronRuntime.deliveryModeCounts?.none)}`,
    ),
    tr(
      t,
      "settings.doctorCronFailure",
      {
        user: formatNumber(cronRuntime.failureDestinationModeCounts?.user),
        none: formatNumber(cronRuntime.failureDestinationModeCounts?.none),
      },
      `failure user ${formatNumber(cronRuntime.failureDestinationModeCounts?.user)} / none ${formatNumber(cronRuntime.failureDestinationModeCounts?.none)}`,
    ),
    tr(
      t,
      "settings.doctorCronStagger",
      { count: formatNumber(cronRuntime.totals.staggeredJobs) },
      `${formatNumber(cronRuntime.totals.staggeredJobs)} staggered`,
    ),
    tr(
      t,
      "settings.doctorCronScheduler",
      {
        state: cronRuntime.scheduler.enabled
          ? (cronRuntime.scheduler.running ? "running" : "stopped")
          : "disabled",
        active: formatNumber(cronRuntime.scheduler.activeRuns),
      },
      `${cronRuntime.scheduler.enabled ? (cronRuntime.scheduler.running ? "running" : "stopped") : "disabled"} / active ${formatNumber(cronRuntime.scheduler.activeRuns)}`,
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorCronHeadline",
      { headline: cronRuntime.headline || "-" },
      cronRuntime.headline || "-",
    ),
  ];

  if (typeof cronRuntime.scheduler.lastTickAtMs === "number") {
    notes.push(`last tick: ${formatTimestamp(cronRuntime.scheduler.lastTickAtMs)}`);
  }
  if (Number(cronRuntime.totals.invalidNextRunJobs) > 0) {
    notes.push(tr(
      t,
      "settings.doctorCronInvalidNextRun",
      { count: formatNumber(cronRuntime.totals.invalidNextRunJobs) },
      `${formatNumber(cronRuntime.totals.invalidNextRunJobs)} enabled job(s) currently have no nextRunAtMs`,
    ));
  }

  const recentJobs = Array.isArray(cronRuntime.recentJobs) ? cronRuntime.recentJobs : [];
  for (const job of recentJobs.slice(0, 4)) {
    const parts = [
      job.scheduleSummary || "unknown schedule",
      job.enabled ? "enabled" : "disabled",
      `session=${job.sessionTarget || "-"}`,
      `delivery=${job.deliveryMode || "-"}`,
      `failure=${job.failureDestinationMode || "-"}`,
      typeof job.staggerMs === "number" ? `stagger=${job.staggerMs}` : "",
      `next=${formatTimestamp(job.nextRunAtMs)}`,
      `last=${job.lastStatus || "never"}`,
    ].filter(Boolean);
    notes.push(`${job.name || job.id}: ${parts.join(", ")}`);
  }

  const status = !cronRuntime.scheduler.enabled
    ? cronRuntime.totals.totalJobs > 0 ? "warn" : "pass"
    : cronRuntime.scheduler.running && Number(cronRuntime.totals.invalidNextRunJobs) === 0
      ? "pass"
      : "warn";

  return {
    title: tr(t, "settings.doctorCronTitle", {}, "Cron Runtime"),
    badges,
    notes,
    status,
  };
}

function buildBackgroundContinuationRuntimeCard(payload, t) {
  const runtime = payload?.backgroundContinuationRuntime;
  if (!runtime?.totals || !Array.isArray(runtime?.recentEntries)) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorBackgroundContinuationRuns",
      {
        total: formatNumber(runtime.totals.totalRuns),
        running: formatNumber(runtime.totals.runningRuns),
      },
      `${formatNumber(runtime.totals.totalRuns)} runs / running ${formatNumber(runtime.totals.runningRuns)}`,
    ),
    tr(
      t,
      "settings.doctorBackgroundContinuationKinds",
      {
        cron: formatNumber(runtime.kindCounts?.cron),
        heartbeat: formatNumber(runtime.kindCounts?.heartbeat),
        subtask: formatNumber(runtime.kindCounts?.subtask),
      },
      `cron ${formatNumber(runtime.kindCounts?.cron)} / heartbeat ${formatNumber(runtime.kindCounts?.heartbeat)} / subtask ${formatNumber(runtime.kindCounts?.subtask)}`,
    ),
    tr(
      t,
      "settings.doctorBackgroundContinuationSessions",
      {
        main: formatNumber(runtime.sessionTargetCounts?.main),
        isolated: formatNumber(runtime.sessionTargetCounts?.isolated),
      },
      `main ${formatNumber(runtime.sessionTargetCounts?.main)} / isolated ${formatNumber(runtime.sessionTargetCounts?.isolated)}`,
    ),
    tr(
      t,
      "settings.doctorBackgroundContinuationStatus",
      {
        failed: formatNumber(runtime.totals.failedRuns),
        skipped: formatNumber(runtime.totals.skippedRuns),
        linked: formatNumber(runtime.totals.conversationLinkedRuns),
      },
      `failed ${formatNumber(runtime.totals.failedRuns)} / skipped ${formatNumber(runtime.totals.skippedRuns)} / linked ${formatNumber(runtime.totals.conversationLinkedRuns)}`,
    ),
    tr(
      t,
      "settings.doctorBackgroundContinuationRecovery",
      {
        attempted: formatNumber(runtime.totals.recoveryAttemptedRuns),
        succeeded: formatNumber(runtime.totals.recoverySucceededRuns),
        recoverable: formatNumber(runtime.totals.recoverableFailedRuns),
      },
      `recovery ${formatNumber(runtime.totals.recoverySucceededRuns)}/${formatNumber(runtime.totals.recoveryAttemptedRuns)} / recoverable ${formatNumber(runtime.totals.recoverableFailedRuns)}`,
    ),
  ];

  const notes = [{
    text: tr(
      t,
      "settings.doctorBackgroundContinuationHeadline",
      { headline: runtime.headline || "-" },
      runtime.headline || "-",
    ),
  }];

  for (const entry of runtime.recentEntries.slice(0, 6)) {
    const continuation = entry?.continuationState;
    const targetId = typeof continuation?.recommendedTargetId === "string"
      ? continuation.recommendedTargetId.trim()
      : "";
    const targetType = typeof continuation?.targetType === "string"
      ? continuation.targetType.trim()
      : "";
    const parts = [
      entry.status || "unknown",
      entry.kind || "background",
      entry.sessionTarget ? `session=${entry.sessionTarget}` : "",
      targetId ? `target=${targetType || "conversation"}:${targetId}` : "",
      entry.summary ? `summary=${entry.summary}` : "",
      entry.reason ? `reason=${entry.reason}` : "",
      entry.latestRecoveryOutcome ? `recovery=${entry.latestRecoveryOutcome}` : "",
      entry.latestRecoveryRunId ? `recoveryRun=${entry.latestRecoveryRunId}` : "",
      entry.recoveredFromRunId ? `recoveredFrom=${entry.recoveredFromRunId}` : "",
      entry.latestRecoveryReason ? `recoveryReason=${entry.latestRecoveryReason}` : "",
      `started=${formatTimestamp(entry.startedAt)}`,
      typeof entry.finishedAt === "number" ? `finished=${formatTimestamp(entry.finishedAt)}` : "",
      typeof entry.nextRunAtMs === "number" ? `next=${formatTimestamp(entry.nextRunAtMs)}` : "",
    ].filter(Boolean);
    const text = `${entry.label || entry.sourceId}: ${parts.join(", ")}`;
    const action = continuation?.recommendedTargetId ? buildContinuationAction(continuation) : null;
    notes.push(action ? { text, action } : { text });
  }

  return {
    title: tr(t, "settings.doctorBackgroundContinuationTitle", {}, "Background Continuation Runtime"),
    badges,
    notes,
    status: Number(runtime.totals.failedRuns) > 0 ? "warn" : "pass",
  };
}

function buildAssistantModeRuntimeCard(payload, t) {
  const runtime = payload?.assistantModeRuntime;
  if (!runtime?.controls || !runtime?.sources || !runtime?.delivery) {
    return undefined;
  }

  const statusLabel = runtime.status || "unknown";
  const masterSource = runtime.controls.assistantModeSource || "derived";
  const notifySummary = Array.isArray(runtime.delivery.externalDeliveryPreference) && runtime.delivery.externalDeliveryPreference.length > 0
    ? `resident + ${runtime.delivery.externalDeliveryPreference.join(" > ")}`
    : "resident only";
  const badges = [
    tr(
      t,
      "settings.doctorAssistantModeMaster",
      {
        enabled: runtime.controls.assistantModeEnabled ? "on" : "off",
        source: masterSource,
      },
      `mode ${runtime.controls.assistantModeEnabled ? "on" : "off"} / ${masterSource}`,
    ),
    tr(
      t,
      "settings.doctorAssistantModeStatus",
      { status: statusLabel },
      `status ${statusLabel}`,
    ),
    tr(
      t,
      "settings.doctorAssistantModeHeartbeat",
      {
        enabled: runtime.controls.heartbeatEnabled ? "on" : "off",
        interval: runtime.controls.heartbeatInterval || "-",
      },
      `heartbeat ${runtime.controls.heartbeatEnabled ? "on" : "off"} / ${runtime.controls.heartbeatInterval || "-"}`,
    ),
    tr(
      t,
      "settings.doctorAssistantModeCron",
      {
        enabled: runtime.controls.cronEnabled ? "on" : "off",
        jobs: formatNumber(runtime.sources.cron?.enabledJobs),
        total: formatNumber(runtime.sources.cron?.totalJobs),
      },
      `cron ${runtime.controls.cronEnabled ? "on" : "off"} / jobs ${formatNumber(runtime.sources.cron?.enabledJobs)}/${formatNumber(runtime.sources.cron?.totalJobs)}`,
    ),
    tr(
      t,
      "settings.doctorAssistantModeNotify",
      { summary: notifySummary },
      `notify ${notifySummary}`,
    ),
    tr(
      t,
      "settings.doctorAssistantModeConfirm",
      { mode: runtime.delivery.confirmationRequired ? "required" : "disabled" },
      runtime.delivery.confirmationRequired ? "confirm required" : "confirm disabled",
    ),
  ];
  if (runtime.resident?.totalCount > 0) {
    badges.push(
      tr(
        t,
        "settings.doctorAssistantModeResident",
        {
          running: formatNumber(runtime.resident.runningCount),
          idle: formatNumber(runtime.resident.idleCount),
          total: formatNumber(runtime.resident.totalCount),
        },
        `resident running ${formatNumber(runtime.resident.runningCount)} / idle ${formatNumber(runtime.resident.idleCount)} / total ${formatNumber(runtime.resident.totalCount)}`,
      ),
    );
  }

  const notes = [{
    text: tr(
      t,
      "settings.doctorAssistantModeHeadline",
      { headline: runtime.headline || "-" },
      runtime.headline || "-",
    ),
  }];

  notes.push({
    text: tr(
      t,
      "settings.doctorAssistantModeStrategy",
      {
        heartbeat: runtime.sources.heartbeat?.lastStatus || (runtime.controls.heartbeatEnabled ? "idle" : "off"),
        cron: runtime.sources.cron?.lastStatus || (runtime.controls.cronEnabled ? "idle" : "off"),
        activeHours: runtime.controls.activeHours || "all day",
      },
      `strategy: heartbeat=${runtime.sources.heartbeat?.lastStatus || (runtime.controls.heartbeatEnabled ? "idle" : "off")}, cron=${runtime.sources.cron?.lastStatus || (runtime.controls.cronEnabled ? "idle" : "off")}, activeHours=${runtime.controls.activeHours || "all day"}`,
    ),
  });
  notes.push({
    text: tr(
      t,
      "settings.doctorAssistantModeDriverPolicy",
      {
        drivers: [
          runtime.controls.heartbeatEnabled ? "heartbeat" : "",
          runtime.controls.cronEnabled ? "cron" : "",
        ].filter(Boolean).join(" + ") || "none",
        source: masterSource,
      },
      `driver policy: ${
        [
          runtime.controls.heartbeatEnabled ? "heartbeat" : "",
          runtime.controls.cronEnabled ? "cron" : "",
        ].filter(Boolean).join(" + ") || "none"
      } / source ${masterSource}`,
    ),
  });
  notes.push({
    text: tr(
      t,
      "settings.doctorAssistantModeSchedulePolicy",
      {
        interval: runtime.controls.heartbeatInterval || "-",
        activeHours: runtime.controls.activeHours || "all day",
        jobs: formatNumber(runtime.sources.cron?.enabledJobs),
        total: formatNumber(runtime.sources.cron?.totalJobs),
      },
      `schedule policy: heartbeat ${runtime.controls.heartbeatInterval || "-"} / ${runtime.controls.activeHours || "all day"} / cron jobs ${formatNumber(runtime.sources.cron?.enabledJobs)}/${formatNumber(runtime.sources.cron?.totalJobs)}`,
    ),
  });
  notes.push({
    text: tr(
      t,
      "settings.doctorAssistantModeDelivery",
      {
        resident: "resident",
        external: notifySummary,
      },
      `delivery: resident channel always available; external preference ${notifySummary}`,
    ),
  });
  notes.push({
    text: tr(
      t,
      "settings.doctorAssistantModeOutboundPolicy",
      {
        summary: notifySummary,
        confirm: runtime.delivery.confirmationRequired ? "required" : "disabled",
      },
      `outbound policy: ${notifySummary}, confirm ${runtime.delivery.confirmationRequired ? "required" : "disabled"}`,
    ),
  });
  if (runtime.resident?.headline) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeResidentHeadline",
        { headline: runtime.resident.headline },
        `resident summary: ${runtime.resident.headline}`,
      ),
    });
  }
  if (runtime.resident?.primary?.displayName) {
    const primary = runtime.resident.primary;
    const residentParts = [
      primary.displayName,
      primary.status ? `status=${primary.status}` : "",
      primary.digestStatus
        ? `digest=${primary.digestStatus}${Number(primary.pendingMessageCount) > 0 ? `/${Number(primary.pendingMessageCount)}` : ""}`
        : "",
      primary.nextAction ? `continue=${primary.nextAction}` : "",
    ].filter(Boolean);
    const action = primary.recommendedTargetId
      ? buildContinuationAction({
        recommendedTargetId: primary.recommendedTargetId,
        targetType: primary.targetType || "conversation",
      })
      : null;
    const text = tr(
      t,
      "settings.doctorAssistantModeResidentPrimary",
      { summary: residentParts.join(", ") },
      `resident focus: ${residentParts.join(", ")}`,
    );
    notes.push(action ? { text, action } : { text });
  }
  if (runtime.longTasks?.headline) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeLongTasksHeadline",
        { headline: runtime.longTasks.headline },
        `long task summary: ${runtime.longTasks.headline}`,
      ),
    });
  }
  if (runtime.longTasks?.primary?.taskId) {
    const primary = runtime.longTasks.primary;
    const parts = [
      primary.taskId,
      primary.status ? `status=${primary.status}` : "",
      primary.agentId ? `agent=${primary.agentId}` : "",
      primary.intentSummary ? `intent=${primary.intentSummary}` : "",
      primary.expectedDeliverableSummary ? `deliverable=${primary.expectedDeliverableSummary}` : "",
    ].filter(Boolean);
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeLongTasksPrimary",
        { summary: parts.join(", ") },
        `long task focus: ${parts.join(", ")}`,
      ),
    });
  }
  if (runtime.goals?.headline) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeGoalsHeadline",
        { headline: runtime.goals.headline },
        `goal summary: ${runtime.goals.headline}`,
      ),
    });
  }
  if (runtime.goals?.primary?.goalId) {
    const primary = runtime.goals.primary;
    const parts = [
      primary.title || primary.goalId,
      primary.status ? `status=${primary.status}` : "",
      primary.nextAction ? `next=${primary.nextAction}` : "",
      primary.blockerSummary ? `blocked=${primary.blockerSummary}` : "",
      primary.checkpointSummary ? `checkpoint=${primary.checkpointSummary}` : "",
    ].filter(Boolean);
    const action = primary.targetId
      ? buildContinuationAction({
        recommendedTargetId: primary.targetId,
        targetType: primary.targetType || "conversation",
      })
      : null;
    const text = tr(
      t,
      "settings.doctorAssistantModeGoalsPrimary",
      { summary: parts.join(", ") },
      `goal focus: ${parts.join(", ")}`,
    );
    notes.push(action ? { text, action } : { text });
  }
  if (runtime.explanation?.nextAction?.summary) {
    const nextAction = runtime.explanation.nextAction;
    const nextTargetId = typeof nextAction?.targetId === "string" ? nextAction.targetId.trim() : "";
    const nextTargetType = typeof nextAction?.targetType === "string" ? nextAction.targetType.trim() : "";
    const nextParts = [
      nextAction.summary,
      nextTargetId ? `target=${nextTargetType || "conversation"}:${nextTargetId}` : "",
      typeof nextAction?.nextRunAtMs === "number" ? `at=${formatTimestamp(nextAction.nextRunAtMs)}` : "",
    ].filter(Boolean);
    const action = nextTargetId
      ? buildContinuationAction({
        recommendedTargetId: nextTargetId,
        targetType: nextTargetType || "conversation",
      })
      : null;
    const text = tr(
      t,
      "settings.doctorAssistantModeNextAction",
      { summary: nextParts.join(", ") },
      `next action: ${nextParts.join(", ")}`,
    );
    notes.push(action ? { text, action } : { text });
  }
  if (runtime.focus?.summary) {
    const focus = runtime.focus;
    const focusTargetId = typeof focus?.targetId === "string" ? focus.targetId.trim() : "";
    const focusTargetType = typeof focus?.targetType === "string" ? focus.targetType.trim() : "";
    const focusParts = [
      focus.summary,
      focusTargetId ? `target=${focusTargetType || "conversation"}:${focusTargetId}` : "",
    ].filter(Boolean);
    const action = focusTargetId
      ? buildContinuationAction({
        recommendedTargetId: focusTargetId,
        targetType: focusTargetType || "conversation",
      })
      : null;
    const text = tr(
      t,
      "settings.doctorAssistantModeFocus",
      { summary: focusParts.join(", ") },
      `focus: ${focusParts.join(", ")}`,
    );
    notes.push(action ? { text, action } : { text });
  }
  if (runtime.explanation?.blockedReason) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeBlockedReason",
        { reason: runtime.explanation.blockedReason },
        `blocked reason: ${runtime.explanation.blockedReason}`,
      ),
    });
  }
  if (runtime.explanation?.attentionReason) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeAttentionReason",
        { reason: runtime.explanation.attentionReason },
        `attention reason: ${runtime.explanation.attentionReason}`,
      ),
    });
  }
  if (runtime.controls.assistantModeMismatch) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeMismatch",
        {},
        "assistant mode 主开关与当前 heartbeat / cron 实际组合不一致；下次保存配置时会按主开关语义重新收口。",
      ),
    });
  }
  const attentionItems = Array.isArray(runtime.attentionItems) ? runtime.attentionItems : [];
  for (const item of attentionItems.slice(0, 4)) {
    const targetId = typeof item?.targetId === "string" ? item.targetId.trim() : "";
    const targetType = typeof item?.targetType === "string" ? item.targetType.trim() : "";
    const parts = [
      item.summary || "-",
      targetId ? `target=${targetType || "conversation"}:${targetId}` : "",
    ].filter(Boolean);
    const action = targetId
      ? buildContinuationAction({
        recommendedTargetId: targetId,
        targetType: targetType || "conversation",
      })
      : null;
    const text = tr(
      t,
      "settings.doctorAssistantModeAttentionItem",
      { summary: parts.join(", ") },
      `attention item: ${parts.join(", ")}`,
    );
    notes.push(action ? { text, action } : { text });
  }

  const recentActions = Array.isArray(runtime.recentActions) ? runtime.recentActions : [];
  for (const item of recentActions.slice(0, 4)) {
    const targetId = typeof item?.recommendedTargetId === "string" ? item.recommendedTargetId.trim() : "";
    const targetType = typeof item?.targetType === "string" ? item.targetType.trim() : "";
    const parts = [
      item.status || "unknown",
      item.kind || "assistant",
      item.sessionTarget ? `session=${item.sessionTarget}` : "",
      targetId ? `target=${targetType || "conversation"}:${targetId}` : "",
      item.summary ? `summary=${item.summary}` : "",
      item.reason ? `reason=${item.reason}` : "",
      item.latestRecoveryOutcome ? `recovery=${item.latestRecoveryOutcome}` : "",
      `started=${formatTimestamp(item.startedAt)}`,
      typeof item.finishedAt === "number" ? `finished=${formatTimestamp(item.finishedAt)}` : "",
      typeof item.nextRunAtMs === "number" ? `next=${formatTimestamp(item.nextRunAtMs)}` : "",
    ].filter(Boolean);
    const text = `${item.label || item.sourceId}: ${parts.join(", ")}`;
    const action = targetId
      ? buildContinuationAction({
        recommendedTargetId: targetId,
        targetType: targetType || "conversation",
      })
      : null;
    notes.push(action ? { text, action } : { text });
  }

  const residentAgents = Array.isArray(payload?.residentAgents?.agents) ? payload.residentAgents.agents : [];
  if (residentAgents.length > 0) {
    notes.push({
      text: tr(
        t,
        "settings.doctorAssistantModeAgentSnapshots",
        {},
        "agent snapshots:",
      ),
    });
    for (const agent of residentAgents.slice(0, 4)) {
      const summary = buildAgentWorkSummary(agent, t);
      const status = summary.lines.find((line) => line.key === "status")?.value || "-";
      const focus = summary.lines.find((line) => line.key === "focus")?.value || "-";
      const text = tr(
        t,
        "settings.doctorAssistantModeAgentSnapshotItem",
        {
          agent: agent.displayName || agent.id || "-",
          status,
          focus,
          attention: formatNumber(summary.attentionCount),
        },
        `${agent.displayName || agent.id || "-"} · ${status} · ${focus} · attention ${formatNumber(summary.attentionCount)}`,
      );
      notes.push(summary.action ? { text, action: summary.action } : { text });
    }
  }

  return {
    title: tr(t, "settings.doctorAssistantModeTitle", {}, "Assistant Mode"),
    badges,
    notes,
    status: runtime.status === "attention" || runtime.status === "disabled" ? "warn" : "pass",
  };
}

function buildConfigSourceCard(payload, t) {
  const summary = payload?.configSource;
  if (!summary?.source || !summary?.stateDir) {
    return undefined;
  }

  const sourceLabel = summary.sourceLabel || summary.source;
  const badges = [
    tr(
      t,
      "settings.doctorConfigSourceCurrent",
      { source: sourceLabel },
      `current ${sourceLabel}`,
    ),
    tr(
      t,
      "settings.doctorConfigSourceStateDir",
      { mode: summary.stateDirActive ? "active" : "inactive" },
      `state-dir ${summary.stateDirActive ? "active" : "inactive"}`,
    ),
  ];

  const notes = [
    {
      text: tr(
        t,
        "settings.doctorConfigSourceHeadline",
        { headline: summary.headline || "-" },
        summary.headline || "-",
      ),
    },
    {
      text: tr(
        t,
        "settings.doctorConfigSourceStateDirPath",
        { path: summary.stateDir },
        `stateDir: ${summary.stateDir}`,
      ),
    },
  ];

  const resolutionOrder = Array.isArray(summary.resolutionOrder)
    ? summary.resolutionOrder.filter((item) => typeof item === "string" && item.trim())
    : [];
  if (resolutionOrder.length > 0) {
    notes.push({
      text: tr(
        t,
        "settings.doctorConfigSourceResolutionOrder",
        { summary: resolutionOrder.join(" -> ") },
        `resolution order: ${resolutionOrder.join(" -> ")}`,
      ),
    });
  }
  if (summary.migrationHint) {
    notes.push({
      text: tr(
        t,
        "settings.doctorConfigSourceMigrationHint",
        { hint: summary.migrationHint },
        summary.migrationHint,
      ),
    });
  }

  return {
    title: tr(t, "settings.doctorConfigSourceTitle", {}, "Config Source"),
    badges,
    notes,
    status: "pass",
  };
}

function buildExternalOutboundRuntimeCard(payload, t) {
  const runtime = payload?.externalOutboundRuntime;
  if (!runtime?.totals) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorExternalOutboundTotal",
      {
        total: formatNumber(runtime.totals.totalRecords),
        sent: formatNumber(runtime.totals.sentCount),
        failed: formatNumber(runtime.totals.failedCount),
      },
      `${formatNumber(runtime.totals.totalRecords)} records / sent ${formatNumber(runtime.totals.sentCount)} / failed ${formatNumber(runtime.totals.failedCount)}`,
    ),
    tr(
      t,
      "settings.doctorExternalOutboundFailures",
      {
        resolve: formatNumber(runtime.failureStageCounts?.resolve),
        delivery: formatNumber(runtime.failureStageCounts?.delivery),
        confirmation: formatNumber(runtime.failureStageCounts?.confirmation),
      },
      `resolve ${formatNumber(runtime.failureStageCounts?.resolve)} / delivery ${formatNumber(runtime.failureStageCounts?.delivery)} / confirmation ${formatNumber(runtime.failureStageCounts?.confirmation)}`,
    ),
    tr(
      t,
      "settings.doctorExternalOutboundDecision",
      {
        confirmed: formatNumber(runtime.totals.confirmedCount),
        autoApproved: formatNumber(runtime.totals.autoApprovedCount),
        rejected: formatNumber(runtime.totals.rejectedCount),
      },
      `confirmed ${formatNumber(runtime.totals.confirmedCount)} / auto ${formatNumber(runtime.totals.autoApprovedCount)} / rejected ${formatNumber(runtime.totals.rejectedCount)}`,
    ),
    tr(
      t,
      "settings.doctorExternalOutboundConfirmMode",
      { mode: runtime.requireConfirmation ? "required" : "disabled" },
      runtime.requireConfirmation ? "confirm required" : "confirm disabled",
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorExternalOutboundHeadline",
      { headline: runtime.headline || "-" },
      runtime.headline || "-",
    ),
    tr(
      t,
      "settings.doctorExternalOutboundChannels",
      { summary: formatKeyCountSummary(runtime.channelCounts) },
      `channels ${formatKeyCountSummary(runtime.channelCounts)}`,
    ),
    tr(
      t,
      "settings.doctorExternalOutboundErrorCodes",
      { summary: formatKeyCountSummary(runtime.errorCodeCounts) },
      `error codes ${formatKeyCountSummary(runtime.errorCodeCounts)}`,
    ),
  ];

  const recentFailures = Array.isArray(runtime.recentFailures) ? runtime.recentFailures : [];
  for (const item of recentFailures.slice(0, 4)) {
    const diagnosis = buildExternalOutboundDiagnosis({
      errorCode: item?.errorCode,
      error: item?.error,
      targetSessionKey: item?.targetSessionKey,
      delivery: item?.delivery,
    }, t);
    const parts = [
      item.targetChannel || "unknown",
      diagnosis.summary,
      item.resolution ? `resolution=${item.resolution}` : "",
      item.requestedSessionKey ? `requested=${item.requestedSessionKey}` : "",
      item.targetSessionKey ? `target=${item.targetSessionKey}` : "",
      item.contentPreview ? `preview=${item.contentPreview}` : "",
      `time=${formatTimestamp(item.timestamp)}`,
    ].filter(Boolean);
    notes.push(parts.join(", "));
  }

  notes.push(tr(
    t,
    "settings.doctorExternalOutboundAuditHint",
    {},
    "详细逐条记录仍可在 记忆查看 -> 消息审计 中查看。",
  ));

  return {
    title: tr(t, "settings.doctorExternalOutboundTitle", {}, "External Outbound Runtime"),
    badges,
    notes,
    status: runtime.health?.status || (Number(runtime.totals.failedCount) > 0 || runtime.requireConfirmation !== true ? "warn" : "pass"),
  };
}

function buildEmailOutboundRuntimeCard(payload, t) {
  const runtime = payload?.emailOutboundRuntime;
  if (!runtime?.totals) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorEmailOutboundTotal",
      {
        total: formatNumber(runtime.totals.totalRecords),
        sent: formatNumber(runtime.totals.sentCount),
        failed: formatNumber(runtime.totals.failedCount),
      },
      `${formatNumber(runtime.totals.totalRecords)} records / sent ${formatNumber(runtime.totals.sentCount)} / failed ${formatNumber(runtime.totals.failedCount)}`,
    ),
    tr(
      t,
      "settings.doctorEmailOutboundDecision",
      {
        confirmed: formatNumber(runtime.totals.confirmedCount),
        autoApproved: formatNumber(runtime.totals.autoApprovedCount),
        rejected: formatNumber(runtime.totals.rejectedCount),
      },
      `confirmed ${formatNumber(runtime.totals.confirmedCount)} / auto ${formatNumber(runtime.totals.autoApprovedCount)} / rejected ${formatNumber(runtime.totals.rejectedCount)}`,
    ),
    tr(
      t,
      "settings.doctorEmailOutboundAttachments",
      {
        records: formatNumber(runtime.totals.attachmentRecordCount),
      },
      `attachments ${formatNumber(runtime.totals.attachmentRecordCount)}`,
    ),
    tr(
      t,
      "settings.doctorEmailOutboundConfirmMode",
      { mode: runtime.requireConfirmation ? "required" : "disabled" },
      runtime.requireConfirmation ? "confirm required" : "confirm disabled",
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorEmailOutboundHeadline",
      { headline: runtime.headline || "-" },
      runtime.headline || "-",
    ),
    tr(
      t,
      "settings.doctorEmailOutboundProviders",
      { summary: formatKeyCountSummary(runtime.providerCounts) },
      `providers ${formatKeyCountSummary(runtime.providerCounts)}`,
    ),
    tr(
      t,
      "settings.doctorEmailOutboundAccounts",
      { summary: formatKeyCountSummary(runtime.accountCounts) },
      `accounts ${formatKeyCountSummary(runtime.accountCounts)}`,
    ),
    tr(
      t,
      "settings.doctorEmailOutboundErrorCodes",
      { summary: formatKeyCountSummary(runtime.errorCodeCounts) },
      `error codes ${formatKeyCountSummary(runtime.errorCodeCounts)}`,
    ),
  ];

  const recentFailures = Array.isArray(runtime.recentFailures) ? runtime.recentFailures : [];
  for (const item of recentFailures.slice(0, 4)) {
    const parts = [
      item.providerId || "email",
      item.accountId ? `account=${item.accountId}` : "",
      item.subject ? `subject=${item.subject}` : "",
      item.errorCode ? `code=${item.errorCode}` : "",
      item.replyToMessageId ? `reply=${item.replyToMessageId}` : "",
      item.threadId ? `thread=${item.threadId}` : "",
      item.bodyPreview ? `preview=${item.bodyPreview}` : "",
      `time=${formatTimestamp(item.timestamp)}`,
    ].filter(Boolean);
    notes.push(parts.join(", "));
    if (item.error) {
      notes.push(`error=${item.error}`);
    }
  }

  notes.push(tr(
    t,
    "settings.doctorEmailOutboundAuditHint",
    {},
    "详细逐条记录仍可在 记忆查看 -> 消息审计 中查看。",
  ));

  return {
    title: tr(t, "settings.doctorEmailOutboundTitle", {}, "Email Outbound Runtime"),
    badges,
    notes,
    status: Number(runtime.totals.failedCount) > 0 || runtime.requireConfirmation !== true ? "warn" : "pass",
  };
}

function buildEmailInboundRuntimeCard(payload, t) {
  const runtime = payload?.emailInboundRuntime;
  if (!runtime?.totals) {
    return undefined;
  }
  const setup = runtime?.setup && typeof runtime.setup === "object" ? runtime.setup : {};
  const runtimeMode = setup.runtimeExpected
    ? "running"
    : runtime.enabled
      ? "blocked"
      : "disabled";
  const missingFields = Array.isArray(setup.missingFields) ? setup.missingFields.filter(Boolean) : [];

  const badges = [
    tr(
      t,
      "settings.doctorEmailInboundTotal",
      {
        total: formatNumber(runtime.totals.totalRecords),
        processed: formatNumber(runtime.totals.processedCount),
        failed: formatNumber(runtime.totals.failedCount),
      },
      `${formatNumber(runtime.totals.totalRecords)} records / processed ${formatNumber(runtime.totals.processedCount)} / failed ${formatNumber(runtime.totals.failedCount)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundQuality",
      {
        invalid: formatNumber(runtime.totals.invalidEventCount),
        duplicate: formatNumber(runtime.totals.duplicateCount),
      },
      `invalid ${formatNumber(runtime.totals.invalidEventCount)} / duplicates ${formatNumber(runtime.totals.duplicateCount)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundAttachments",
      {
        records: formatNumber(runtime.totals.attachmentRecordCount),
        bindings: formatNumber(runtime.totals.createdBindingCount),
      },
      `attachments ${formatNumber(runtime.totals.attachmentRecordCount)} / new threads ${formatNumber(runtime.totals.createdBindingCount)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundRuntimeMode",
      { mode: runtimeMode },
      runtimeMode === "running" ? "polling running" : runtimeMode === "blocked" ? "polling blocked" : "polling disabled",
    ),
    tr(
      t,
      "settings.doctorEmailInboundSetupStatus",
      { state: setup.configured ? "configured" : "incomplete" },
      setup.configured ? "setup configured" : "setup incomplete",
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorEmailInboundSetupHeadline",
      { headline: setup.headline || "-" },
      setup.headline || "-",
    ),
    tr(
      t,
      "settings.doctorEmailInboundSetupTarget",
      {
        accountId: setup.accountId || "default",
        host: setup.host || "-",
        port: formatNumber(setup.port),
        secure: setup.secure === false ? "false" : "true",
        mailbox: setup.mailbox || "INBOX",
        agentId: setup.requestedAgentId || "default",
        intervalMs: formatNumber(setup.pollIntervalMs),
        bootstrapMode: setup.bootstrapMode || "latest",
        recentWindowLimit: formatNumber(setup.recentWindowLimit),
      },
      `account ${setup.accountId || "default"} / ${setup.host || "-"}:${formatNumber(setup.port)} / secure=${setup.secure === false ? "false" : "true"} / mailbox ${setup.mailbox || "INBOX"} / agent ${setup.requestedAgentId || "default"} / interval ${formatNumber(setup.pollIntervalMs)}ms / bootstrap ${setup.bootstrapMode || "latest"} / recent window ${formatNumber(setup.recentWindowLimit)}`,
    ),
    missingFields.length > 0
      ? tr(
        t,
        "settings.doctorEmailInboundSetupMissing",
        { fields: missingFields.join(", ") },
        `missing ${missingFields.join(", ")}`,
      )
      : tr(
        t,
        "settings.doctorEmailInboundSetupMissing",
        { fields: "-" },
        "missing -",
      ),
    tr(
      t,
      "settings.doctorEmailInboundSetupNext",
      { hint: setup.nextStep || "-" },
      setup.nextStep || "-",
    ),
    tr(
      t,
      "settings.doctorEmailInboundConfigSourceHint",
      {},
      "如果你刚改过 .env/.env.local 但这里没变化，先去看 Config Source 卡片确认当前生效目录。",
    ),
    tr(
      t,
      "settings.doctorEmailInboundHeadline",
      { headline: runtime.headline || "-" },
      runtime.headline || "-",
    ),
    tr(
      t,
      "settings.doctorEmailInboundProviders",
      { summary: formatKeyCountSummary(runtime.providerCounts) },
      `providers ${formatKeyCountSummary(runtime.providerCounts)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundAccounts",
      { summary: formatKeyCountSummary(runtime.accountCounts) },
      `accounts ${formatKeyCountSummary(runtime.accountCounts)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundMailboxes",
      { summary: formatKeyCountSummary(runtime.mailboxCounts) },
      `mailboxes ${formatKeyCountSummary(runtime.mailboxCounts)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundStatuses",
      { summary: formatKeyCountSummary(runtime.statusCounts) },
      `statuses ${formatKeyCountSummary(runtime.statusCounts)}`,
    ),
    tr(
      t,
      "settings.doctorEmailInboundErrorCodes",
      { summary: formatKeyCountSummary(runtime.errorCodeCounts) },
      `error codes ${formatKeyCountSummary(runtime.errorCodeCounts)}`,
    ),
  ];

  const recentFailures = Array.isArray(runtime.recentFailures) ? runtime.recentFailures : [];
  for (const item of recentFailures.slice(0, 4)) {
    const parts = [
      item.providerId || "imap",
      item.accountId ? `account=${item.accountId}` : "",
      item.mailbox ? `mailbox=${item.mailbox}` : "",
      item.subject ? `subject=${item.subject}` : "",
      item.errorCode ? `code=${item.errorCode}` : "",
      item.messageId ? `message=${item.messageId}` : "",
      item.threadId ? `thread=${item.threadId}` : "",
      item.bodyPreview ? `preview=${item.bodyPreview}` : "",
      `time=${formatTimestamp(item.timestamp)}`,
    ].filter(Boolean);
    notes.push(parts.join(", "));
    if (item.error) {
      notes.push(`error=${item.error}`);
    }
  }

  notes.push(tr(
    t,
    "settings.doctorEmailInboundAuditHint",
    {},
    "详细逐条记录仍可在 记忆查看 -> 消息审计 中查看。",
  ));

  return {
    title: tr(t, "settings.doctorEmailInboundTitle", {}, "Email Inbound Runtime"),
    badges,
    notes,
    status: Number(runtime.totals.failedCount) > 0 || runtime.enabled !== true ? "warn" : "pass",
  };
}

function buildCameraRuntimeCard(payload, t) {
  const runtime = payload?.cameraRuntime;
  const summary = runtime?.summary;
  if (!summary) {
    return undefined;
  }

  const providerCount = Array.isArray(summary.registeredProviderIds) ? summary.registeredProviderIds.length : 0;
  const badges = [
    tr(
      t,
      "settings.doctorCameraProviders",
      { count: formatNumber(providerCount) },
      `${formatNumber(providerCount)} provider(s)`,
    ),
    tr(
      t,
      "settings.doctorCameraWarnings",
      {
        warn: formatNumber(summary.warningCount),
        error: formatNumber(summary.errorCount),
      },
      `warn ${formatNumber(summary.warningCount)} / error ${formatNumber(summary.errorCount)}`,
    ),
  ];
  if (summary.defaultProviderId) {
    badges.push(tr(
      t,
      "settings.doctorCameraDefaultProvider",
      { provider: summary.defaultProviderId },
      `default ${summary.defaultProviderId}`,
    ));
  }

  const notes = [
    tr(
      t,
      "settings.doctorCameraHeadline",
      { headline: summary.headline || "-" },
      summary.headline || "-",
    ),
  ];
  if (summary.defaultSelection) {
    notes.push(
      `default selection: policy=${summary.defaultSelection.policy}, selected=${summary.defaultSelection.selectedProvider}, reason=${summary.defaultSelection.reason}, fallback=${summary.defaultSelection.fallbackApplied ? "yes" : "no"}`,
    );
    notes.push(`provider order: ${summary.defaultSelection.preferredOrder.join(" -> ")}`);
    notes.push(`registered providers: ${summary.defaultSelection.registeredProviders.join(", ") || "(none)"}`);
    notes.push(`fallback ready: ${summary.defaultSelection.availableFallbackProviders.join(", ") || "(none)"}`);
    notes.push(`missing fallbacks: ${summary.defaultSelection.missingFallbackProviders.join(", ") || "(none)"}`);
    if (Array.isArray(summary.defaultSelection.skippedPreferredProviders) && summary.defaultSelection.skippedPreferredProviders.length) {
      notes.push(`skipped preferred: ${summary.defaultSelection.skippedPreferredProviders.join(", ")}`);
    }
    if (summary.defaultSelection.configuredDefaultProvider) {
      notes.push(`configured default: ${summary.defaultSelection.configuredDefaultProvider}`);
    }
    const attempts = Array.isArray(summary.defaultSelection.attempts) ? summary.defaultSelection.attempts : [];
    if (attempts.length) {
      notes.push(`selection trace: ${attempts.map((attempt) => {
        const bits = [attempt.provider, attempt.outcome, attempt.reason];
        if (attempt.detail) {
          bits.push(attempt.detail);
        }
        return bits.join(":");
      }).join(" -> ")}`);
    }
  }
  if (summary.governance) {
    notes.push(`governance: ${summary.governance.headline}`);
    notes.push(
      `governance counts: blocked=${formatNumber(summary.governance.blockedProviderCount)}, permission_blocked=${formatNumber(summary.governance.permissionBlockedProviderCount)}, permission_prompt=${formatNumber(summary.governance.permissionPromptProviderCount)}, fallback_active=${formatNumber(summary.governance.fallbackActiveProviderCount)}`,
    );
    notes.push(
      `recent trend: failures=${formatNumber(summary.governance.recentFailureCount)}, recovered=${formatNumber(summary.governance.recentRecoveredCount)}, failureProviders=${formatNumber(summary.governance.failureProviderCount)}, repeatedFallback=${summary.governance.repeatedFallback ? "yes" : "no"}, dominant=${summary.governance.dominantFailureCode || "-"}`,
    );
    if (summary.governance.whyUnhealthy) {
      notes.push(`why unhealthy: ${summary.governance.whyUnhealthy}`);
    }
    if (summary.governance.whyFallback) {
      notes.push(`why fallback: ${summary.governance.whyFallback}`);
    }
    if (summary.governance.recommendedAction) {
      notes.push(`next action: ${summary.governance.recommendedAction}`);
    }
  }

  const providers = Array.isArray(runtime?.providers) ? runtime.providers : [];
  for (const provider of providers.slice(0, 3)) {
    notes.push(`${provider.id}: ${provider.headline}`);
    if (provider.launchConfig?.command) {
      const launchBits = [
        `command=${provider.launchConfig.command}`,
        provider.launchConfig.resolvedCommand ? `resolvedCommand=${provider.launchConfig.resolvedCommand}` : "",
        provider.launchConfig.helperEntry ? `entry=${provider.launchConfig.helperEntry}` : "",
        provider.launchConfig.resolvedHelperEntry ? `resolvedEntry=${provider.launchConfig.resolvedHelperEntry}` : "",
        provider.launchConfig.cwd ? `cwd=${provider.launchConfig.cwd}` : "",
        provider.launchConfig.runtimeDir ? `runtimeDir=${provider.launchConfig.runtimeDir}` : "",
      ].filter(Boolean);
      if (launchBits.length) {
        notes.push(`launch: ${launchBits.join(", ")}`);
      }
    }
    const sampleDevices = Array.isArray(provider.sampleDevices) ? provider.sampleDevices : [];
    for (const device of sampleDevices.slice(0, 3)) {
      notes.push(`device: ${device}`);
    }
    const aliasMemory = provider.metadata && typeof provider.metadata === "object"
      ? provider.metadata.aliasMemory
      : undefined;
    if (aliasMemory && typeof aliasMemory === "object") {
      notes.push(
        `alias memory: entries=${formatNumber(aliasMemory.entryCount)}, observed=${formatNumber(aliasMemory.observedCount)}`
        + `, manual=${formatNumber(aliasMemory.manualAliasCount)}, favorite=${formatNumber(aliasMemory.favoriteCount)}`
        + (typeof aliasMemory.snapshotPath === "string" ? `, snapshot=${aliasMemory.snapshotPath}` : ""),
      );
    }
    if (provider.runtimeHealth) {
      const historyWindow = provider.runtimeHealth.historyWindow;
      notes.push(
        `runtime health: status=${provider.runtimeHealth.status}, failures=${formatNumber(provider.runtimeHealth.consecutiveFailures)}, lastSuccess=${provider.runtimeHealth.lastSuccessAt || "-"}`,
      );
      if (historyWindow) {
        const failureCodes = formatKeyCountSummary(historyWindow.failureCodeCounts || {});
        notes.push(
          `runtime window: events=${formatNumber(historyWindow.eventCount)}, success=${formatNumber(historyWindow.successCount)}, failure=${formatNumber(historyWindow.failureCount)}, recovered=${formatNumber(historyWindow.recoveredSuccessCount)}, codes=${failureCodes}`,
        );
        const lastEvents = Array.isArray(historyWindow.lastEvents) ? historyWindow.lastEvents.slice(-3) : [];
        if (lastEvents.length) {
          notes.push(`recent events: ${lastEvents.map((event) => {
            const outcomeBits = [event.outcome];
            if (event.code) {
              outcomeBits.push(event.code);
            }
            if (event.recovered) {
              outcomeBits.push("recovered");
            }
            return `${event.operation}/${outcomeBits.join(":")}`;
          }).join(" -> ")}`);
        }
      }
      if (provider.runtimeHealth.lastFailure) {
        notes.push(
          `last failure: ${provider.runtimeHealth.lastFailure.code || "unknown"} @ ${provider.runtimeHealth.lastFailure.at} (${provider.runtimeHealth.lastFailure.operation}) ${provider.runtimeHealth.lastFailure.message}`,
        );
        if (provider.runtimeHealth.lastFailure.recoveryHint) {
          notes.push(`recent recovery hint: ${provider.runtimeHealth.lastFailure.recoveryHint}`);
        }
      }
      if (provider.runtimeHealth.lastRecoveryAt) {
        notes.push(`recovered at: ${provider.runtimeHealth.lastRecoveryAt}`);
      }
    }
    if (provider.healthCheck) {
      notes.push(
        `health check: status=${provider.healthCheck.status}, source=${provider.healthCheck.source}, sources=${provider.healthCheck.sources.join(", ") || "(none)"}, actionable=${provider.healthCheck.actionable ? "yes" : "no"}, codes=${provider.healthCheck.reasonCodes.join(", ") || "(none)"}`,
      );
      notes.push(`governance: ${provider.healthCheck.headline}`);
      notes.push(
        `permission: state=${provider.healthCheck.permission.state}, gating=${provider.healthCheck.permission.gating}, actionable=${provider.healthCheck.permission.actionable ? "yes" : "no"}`,
      );
      notes.push(
        `failure stats: total=${formatNumber(provider.healthCheck.failureStats.issueCounts.total)}, info=${formatNumber(provider.healthCheck.failureStats.issueCounts.info)}, warning=${formatNumber(provider.healthCheck.failureStats.issueCounts.warning)}, error=${formatNumber(provider.healthCheck.failureStats.issueCounts.error)}, retryable=${formatNumber(provider.healthCheck.failureStats.issueCounts.retryable)}, dominant=${provider.healthCheck.failureStats.dominantReasonCode || "-"}`,
      );
      if (provider.healthCheck.failureStats.runtimeWindow) {
        notes.push(
          `failure window: events=${formatNumber(provider.healthCheck.failureStats.runtimeWindow.eventCount)}, success=${formatNumber(provider.healthCheck.failureStats.runtimeWindow.successCount)}, failure=${formatNumber(provider.healthCheck.failureStats.runtimeWindow.failureCount)}, recovered=${formatNumber(provider.healthCheck.failureStats.runtimeWindow.recoveredSuccessCount)}, dominant=${provider.healthCheck.failureStats.runtimeWindow.dominantFailureCode || "-"}, last=${provider.healthCheck.failureStats.runtimeWindow.lastFailureCode || "-"}`,
        );
      }
      if (provider.healthCheck.failureStats.reasonCodeCounts && Object.keys(provider.healthCheck.failureStats.reasonCodeCounts).length) {
        notes.push(`failure codes: ${formatKeyCountSummary(provider.healthCheck.failureStats.reasonCodeCounts)}`);
      }
      if (Array.isArray(provider.healthCheck.recoveryActions) && provider.healthCheck.recoveryActions.length) {
        notes.push(
          `recovery actions: ${provider.healthCheck.recoveryActions.slice(0, 3).map((action) => `${action.priority}/${action.kind}:${action.label}`).join(" | ")}`,
        );
      }
    }
    if (provider.runtimeHealthFreshness) {
      notes.push(
        `runtime freshness: source=${provider.runtimeHealthFreshness.source}, level=${provider.runtimeHealthFreshness.level}, stale=${provider.runtimeHealthFreshness.stale ? "yes" : "no"}, ageMs=${typeof provider.runtimeHealthFreshness.ageMs === "number" ? provider.runtimeHealthFreshness.ageMs : "-"}, ref=${provider.runtimeHealthFreshness.referenceAt || "-"}`,
      );
      if (provider.runtimeHealthFreshness.retention) {
        notes.push(
          `runtime retention: events<=${formatNumber(provider.runtimeHealthFreshness.retention.eventLimit)}, horizonMs=${formatNumber(provider.runtimeHealthFreshness.retention.horizonMs)}`,
        );
      }
      if (provider.runtimeHealthFreshness.snapshotIssue) {
        notes.push(
          `runtime snapshot issue: ${provider.runtimeHealthFreshness.snapshotIssue.code} ${provider.runtimeHealthFreshness.snapshotIssue.message}`,
        );
      }
    }
    const hints = Array.isArray(provider.recoveryHints) ? provider.recoveryHints : [];
    for (const hint of hints.slice(0, 2)) {
      notes.push(`recovery: ${hint}`);
    }
  }

  if (!providers.length) {
    notes.push(tr(
      t,
      "settings.doctorCameraNoProviders",
      {},
      "当前没有可展示的摄像头 provider 诊断。",
    ));
  }

  return {
    title: tr(t, "settings.doctorCameraRuntimeTitle", {}, "Camera Runtime"),
    badges,
    notes,
    status: summary.errorCount > 0 || summary.warningCount > 0 ? "warn" : "pass",
  };
}

function resolveNativeDesktopHelperProvider(payload) {
  const providers = Array.isArray(payload?.cameraRuntime?.providers) ? payload.cameraRuntime.providers : [];
  return providers.find((provider) => provider && provider.id === "native_desktop");
}

function formatDoctorBinaryState(value, labels = {}) {
  if (value === true) {
    return labels.trueText || "yes";
  }
  if (value === false) {
    return labels.falseText || "no";
  }
  return labels.unknownText || "-";
}

function buildNativeDesktopHelperCard(payload, t) {
  const provider = resolveNativeDesktopHelperProvider(payload);
  if (!provider) {
    return undefined;
  }

  const metadata = provider.metadata && typeof provider.metadata === "object"
    ? provider.metadata
    : {};
  const launchConfig = provider.launchConfig && typeof provider.launchConfig === "object"
    ? provider.launchConfig
    : {};
  const capabilities = provider.capabilities && typeof provider.capabilities === "object"
    ? provider.capabilities
    : {};
  const issues = Array.isArray(provider.issues) ? provider.issues : [];
  const recoveryHints = Array.isArray(provider.recoveryHints) ? provider.recoveryHints : [];
  const healthCheck = provider.healthCheck && typeof provider.healthCheck === "object"
    ? provider.healthCheck
    : undefined;
  const runtimeHealth = provider.runtimeHealth && typeof provider.runtimeHealth === "object"
    ? provider.runtimeHealth
    : undefined;
  const helperStatus = provider.helperStatus
    || (typeof metadata.helperStatus === "string" ? metadata.helperStatus : "")
    || provider.status
    || "-";
  const helperVersion = typeof metadata.helperVersion === "string" ? metadata.helperVersion : "";
  const permissionState = provider.permissionState || healthCheck?.permission?.state || "-";
  const powershellReady = capabilities.screenTargetList === true || capabilities.list === true;
  const ffmpegReady = capabilities.screenCapture === true || capabilities.snapshot === true;
  const cardStatus = provider.issueCounts?.error > 0
    || provider.issueCounts?.warning > 0
    || healthCheck?.status === "fail"
    || healthCheck?.status === "warn"
    || provider.status === "degraded"
    || provider.status === "unavailable"
    || provider.configured === false
    ? "warn"
    : "pass";
  const latestIssue = issues[0];
  const lastFailure = runtimeHealth?.lastFailure;
  const nextAction = healthCheck?.recoveryActions?.[0]?.label || recoveryHints[0] || provider.fix;

  const badges = [
    tr(
      t,
      "settings.doctorNativeDesktopHelperConfigured",
      { state: provider.configured === false ? "no" : "yes" },
      `configured ${provider.configured === false ? "no" : "yes"}`,
    ),
    tr(
      t,
      "settings.doctorNativeDesktopHelperStatus",
      { status: helperStatus },
      `helper ${helperStatus}`,
    ),
    tr(
      t,
      "settings.doctorNativeDesktopHelperPowerShell",
      { status: formatDoctorBinaryState(powershellReady, { trueText: "ready", falseText: "missing" }) },
      `PowerShell ${formatDoctorBinaryState(powershellReady, { trueText: "ready", falseText: "missing" })}`,
    ),
    tr(
      t,
      "settings.doctorNativeDesktopHelperFfmpeg",
      { status: formatDoctorBinaryState(ffmpegReady, { trueText: "ready", falseText: "missing" }) },
      `FFmpeg ${formatDoctorBinaryState(ffmpegReady, { trueText: "ready", falseText: "missing" })}`,
    ),
  ];
  if (helperVersion) {
    badges.push(tr(
      t,
      "settings.doctorNativeDesktopHelperVersion",
      { version: helperVersion },
      `version ${helperVersion}`,
    ));
  }

  const notes = [
    tr(
      t,
      "settings.doctorNativeDesktopHelperHeadline",
      { headline: provider.headline || "-" },
      provider.headline || "-",
    ),
    `status: provider=${provider.status || "-"}, helper=${helperStatus}, permission=${permissionState}, registered=${provider.registered === false ? "no" : "yes"}, configured=${provider.configured === false ? "no" : "yes"}`,
  ];

  const launchBits = [
    launchConfig.transport ? `transport=${launchConfig.transport}` : "",
    launchConfig.command ? `command=${launchConfig.command}` : "",
    launchConfig.resolvedCommand ? `resolvedCommand=${launchConfig.resolvedCommand}` : "",
    launchConfig.helperEntry ? `entry=${launchConfig.helperEntry}` : "",
    launchConfig.resolvedHelperEntry ? `resolvedEntry=${launchConfig.resolvedHelperEntry}` : "",
    launchConfig.cwd ? `cwd=${launchConfig.cwd}` : "",
    launchConfig.runtimeDir ? `runtimeDir=${launchConfig.runtimeDir}` : "",
  ].filter(Boolean);
  if (launchBits.length) {
    notes.push(`launch: ${launchBits.join(", ")}`);
  }

  const toolchainBits = [
    `powershell=${launchConfig.powershellCommand || "powershell.exe"} (${formatDoctorBinaryState(powershellReady, { trueText: "ready", falseText: "missing" })})`,
    `ffmpeg=${launchConfig.ffmpegCommand || "ffmpeg"} (${formatDoctorBinaryState(ffmpegReady, { trueText: "ready", falseText: "missing" })})`,
  ];
  notes.push(`toolchain: ${toolchainBits.join(", ")}`);

  notes.push(
    `capabilities: camera_list=${formatDoctorBinaryState(capabilities.list)}, camera_snapshot=${formatDoctorBinaryState(capabilities.snapshot)}, screen_targets=${formatDoctorBinaryState(capabilities.screenTargetList)}, screen_capture=${formatDoctorBinaryState(capabilities.screenCapture)}, display_capture=${formatDoctorBinaryState(capabilities.displayCapture)}, window_capture=${formatDoctorBinaryState(capabilities.windowCapture)}, region_capture=${formatDoctorBinaryState(capabilities.regionCapture)}`,
  );

  if (latestIssue) {
    notes.push(`latest issue: ${latestIssue.code || "unknown"} / ${latestIssue.message || "-"}`);
  }
  if (lastFailure) {
    notes.push(
      `last failure: ${lastFailure.code || "unknown"} @ ${lastFailure.at || "-"} (${lastFailure.operation || "-"}) ${lastFailure.message || "-"}`,
    );
  }
  if (nextAction) {
    notes.push(`next action: ${nextAction}`);
  }

  return {
    title: tr(t, "settings.doctorNativeDesktopHelperTitle", {}, "Native Desktop Helper"),
    badges,
    notes,
    status: cardStatus,
  };
}

function buildDeploymentBackendsCard(payload, t) {
  const runtime = payload?.deploymentBackends;
  if (!runtime?.summary || !Array.isArray(runtime?.items)) {
    return undefined;
  }

  const selectedLabel = runtime.summary.selectedProfileId || "-";
  const badges = [
    tr(
      t,
      "settings.doctorDeploymentBackendsProfiles",
      {
        enabled: formatNumber(runtime.summary.enabledCount),
        total: formatNumber(runtime.summary.profileCount),
      },
      `${formatNumber(runtime.summary.enabledCount)}/${formatNumber(runtime.summary.profileCount)} profiles enabled`,
    ),
    tr(
      t,
      "settings.doctorDeploymentBackendsKinds",
      {
        local: formatNumber(runtime.summary.backendCounts?.local),
        docker: formatNumber(runtime.summary.backendCounts?.docker),
        ssh: formatNumber(runtime.summary.backendCounts?.ssh),
      },
      `local ${formatNumber(runtime.summary.backendCounts?.local)} / docker ${formatNumber(runtime.summary.backendCounts?.docker)} / ssh ${formatNumber(runtime.summary.backendCounts?.ssh)}`,
    ),
    tr(
      t,
      "settings.doctorDeploymentBackendsSelected",
      {
        profile: selectedLabel,
        backend: runtime.summary.selectedBackend || "-",
      },
      `selected ${selectedLabel} (${runtime.summary.selectedBackend || "-"})`,
    ),
    tr(
      t,
      "settings.doctorDeploymentBackendsWarnings",
      { count: formatNumber(runtime.summary.warningCount) },
      `${formatNumber(runtime.summary.warningCount)} warning profiles`,
    ),
  ];

  const notes = [
    tr(
      t,
      "settings.doctorDeploymentBackendsHeadline",
      { headline: runtime.headline || "-" },
      runtime.headline || "-",
    ),
    `config: ${runtime.configPath || "-"}`,
  ];

  if (runtime.summary.selectedProfileId && runtime.summary.selectedResolved === false) {
    notes.push(`selected profile not found: ${runtime.summary.selectedProfileId}`);
  }

  for (const item of runtime.items.slice(0, 6)) {
    notes.push(`${item.label}: ${item.message}`);
  }

  return {
    title: tr(t, "settings.doctorDeploymentBackendsTitle", {}, "Deployment Backends"),
    badges,
    notes,
    status: runtime.summary.warningCount > 0 || runtime.summary.selectedResolved === false ? "warn" : "pass",
  };
}

function buildRuntimeResilienceCard(payload, t) {
  const runtime = payload?.runtimeResilience;
  if (!runtime?.routing?.primary || !runtime?.summary) {
    return undefined;
  }

  const latest = runtime.latest;
  const diagnostics = resolveRuntimeResilienceDiagnostics(payload, runtime);
  const badges = [
    tr(
      t,
      "settings.doctorRuntimeResiliencePrimary",
      { route: `${runtime.routing.primary.provider}/${runtime.routing.primary.model}` },
      `primary ${runtime.routing.primary.provider}/${runtime.routing.primary.model}`,
    ),
    tr(
      t,
      "settings.doctorRuntimeResilienceFallbacks",
      { count: formatNumber(runtime.routing.fallbacks?.length) },
      `${formatNumber(runtime.routing.fallbacks?.length)} fallbacks`,
    ),
    tr(
      t,
      "settings.doctorRuntimeResilienceAlert",
      { level: diagnostics.alertLevel, code: diagnostics.alertCode },
      `alert ${diagnostics.alertLevel}/${diagnostics.alertCode}`,
    ),
  ];
  if (latest) {
    badges.push(tr(
      t,
      "settings.doctorRuntimeResilienceLatest",
      { status: latest.finalStatus || "idle" },
      `latest ${latest.finalStatus || "idle"}`,
    ));
    badges.push(tr(
      t,
      "settings.doctorRuntimeResilienceSignals",
      {
        retry: formatNumber(latest.stepCounts?.sameProfileRetries),
        switch: formatNumber(latest.stepCounts?.crossProfileFallbacks),
        cooldown: formatNumber(latest.stepCounts?.cooldownSkips),
      },
      `retry ${formatNumber(latest.stepCounts?.sameProfileRetries)} / switch ${formatNumber(latest.stepCounts?.crossProfileFallbacks)} / cooldown ${formatNumber(latest.stepCounts?.cooldownSkips)}`,
    ));
  }

  const notes = [
    tr(
      t,
      "settings.doctorRuntimeResilienceAlertMessage",
      { message: diagnostics.alertMessage },
      diagnostics.alertMessage,
    ),
    tr(
      t,
      "settings.doctorRuntimeResilienceHeadline",
      { headline: runtime.summary.headline || "-" },
      runtime.summary.headline || "-",
    ),
  ];
  if (runtime.routing.compaction?.configured) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceCompaction",
      {
        route: runtime.routing.compaction.route
          ? `${runtime.routing.compaction.route.provider}/${runtime.routing.compaction.route.model}`
          : "-",
      },
      `compaction route ${runtime.routing.compaction.route ? `${runtime.routing.compaction.route.provider}/${runtime.routing.compaction.route.model}` : "-"}`,
    ));
    if (runtime.routing.compaction.auxSummaryVerdict) {
      notes.push(tr(
        t,
        "settings.doctorRuntimeResilienceCompactionVerdict",
        {
          strategy: runtime.routing.compaction.auxSummaryVerdict.strategy || "-",
          reason: runtime.routing.compaction.auxSummaryVerdict.reason || "-",
          enabled: runtime.routing.compaction.auxSummaryVerdict.enabled ? "yes" : "no",
        },
        `compaction aux verdict ${runtime.routing.compaction.auxSummaryVerdict.strategy || "-"} / ${runtime.routing.compaction.auxSummaryVerdict.reason || "-"} / enabled=${runtime.routing.compaction.auxSummaryVerdict.enabled ? "yes" : "no"}`,
      ));
    }
  }
  if (latest?.headline) {
    notes.push(latest.headline);
  }
  if (diagnostics.overallReasonSummary) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceOverallReasons",
      { summary: diagnostics.overallReasonSummary },
      `reasons: ${diagnostics.overallReasonSummary}`,
    ));
  }
  if (diagnostics.dominantReason) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceReasonFocus",
      { reason: diagnostics.dominantReason },
      `reason focus: ${diagnostics.dominantReason}`,
    ));
  }
  if (diagnostics.reasonClusterSummary) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceReasonCluster",
      { summary: diagnostics.reasonClusterSummary },
      `reason cluster: ${diagnostics.reasonClusterSummary}`,
    ));
  }
  if (diagnostics.latestSignal) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceLatestSignal",
      { summary: diagnostics.latestSignal },
      `latest signal: ${diagnostics.latestSignal}`,
    ));
  }
  if (diagnostics.latestRouteBehavior) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceRouteBehavior",
      { summary: diagnostics.latestRouteBehavior },
      `route: ${diagnostics.latestRouteBehavior}`,
    ));
  }
  notes.push(tr(
    t,
    "settings.doctorRuntimeResilienceTotals",
    {
      summary: diagnostics.totalsSummary,
    },
    `totals: ${diagnostics.totalsSummary}`,
  ));
  if (diagnostics.latestReasonSummary) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceLatestReasons",
      { summary: diagnostics.latestReasonSummary },
      `latest reasons: ${diagnostics.latestReasonSummary}`,
    ));
  }
  if (diagnostics.recoveryHint) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceRecoveryHint",
      { hint: diagnostics.recoveryHint },
      `recovery hint: ${diagnostics.recoveryHint}`,
    ));
  }
  if (diagnostics.mixedSignalHint) {
    notes.push(tr(
      t,
      "settings.doctorRuntimeResilienceMixedSignal",
      { hint: diagnostics.mixedSignalHint },
      `mixed signal: ${diagnostics.mixedSignalHint}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorRuntimeResilienceTitle", {}, "Runtime Resilience"),
    badges,
    notes,
    status: diagnostics.alertLevel,
  };
}

function buildAgentStopRuntimeCard(payload, t) {
  const diagnostics = payload?.queryRuntime?.stopDiagnostics;
  if (!diagnostics?.available) {
    return undefined;
  }

  const badges = [
    tr(
      t,
      "settings.doctorAgentStopRequests",
      { count: formatNumber(diagnostics.totalRequests) },
      `${formatNumber(diagnostics.totalRequests)} stop requests`,
    ),
    tr(
      t,
      "settings.doctorAgentStopAccepted",
      { count: formatNumber(diagnostics.acceptedRequests) },
      `${formatNumber(diagnostics.acceptedRequests)} accepted`,
    ),
    tr(
      t,
      "settings.doctorAgentStopStopped",
      { count: formatNumber(diagnostics.stoppedRuns) },
      `${formatNumber(diagnostics.stoppedRuns)} stopped`,
    ),
  ];

  if (
    Number(diagnostics.runningAfterStopCount) > 0
    || Number(diagnostics.completedAfterStopCount) > 0
    || Number(diagnostics.failedAfterStopCount) > 0
  ) {
    badges.push(tr(
      t,
      "settings.doctorAgentStopRunning",
      { count: formatNumber(diagnostics.runningAfterStopCount) },
      `${formatNumber(diagnostics.runningAfterStopCount)} still running after stop`,
    ));
  }

  const notes = [
    tr(
      t,
      "settings.doctorAgentStopHeadline",
      {
        running: formatNumber(diagnostics.runningAfterStopCount),
        completed: formatNumber(diagnostics.completedAfterStopCount),
        failed: formatNumber(diagnostics.failedAfterStopCount),
        missing: formatNumber(diagnostics.notFoundCount),
        mismatch: formatNumber(diagnostics.runMismatchCount),
      },
      `running_after_stop ${formatNumber(diagnostics.runningAfterStopCount)} / completed_after_stop ${formatNumber(diagnostics.completedAfterStopCount)} / failed_after_stop ${formatNumber(diagnostics.failedAfterStopCount)} / not_found ${formatNumber(diagnostics.notFoundCount)} / run_mismatch ${formatNumber(diagnostics.runMismatchCount)}`,
    ),
  ];

  const recent = Array.isArray(diagnostics.recent) ? diagnostics.recent : [];
  for (const item of recent.slice(0, 4)) {
    const conversationId = item?.conversationId || "-";
    const runId = item?.runId || "-";
    const stage = item?.messageLatestStage || "-";
    const messageState = item?.messageStatus
      ? `${item.messageStatus}/${stage}`
      : stage;
    const response = item?.messageResponse ? ` / response=${item.messageResponse}` : "";
    notes.push(tr(
      t,
      "settings.doctorAgentStopLatest",
      {
        timestamp: formatTimestamp(item?.requestedAt),
        conversationId,
        runId,
        outcome: item?.outcome || "stop_requested",
        reason: item?.reason || "-",
        message: `${messageState}${response}`,
      },
      `${formatTimestamp(item?.requestedAt)} · ${conversationId} / ${runId}: outcome=${item?.outcome || "stop_requested"}, reason=${item?.reason || "-"}, message=${messageState}${response}`,
    ));
  }

  return {
    title: tr(t, "settings.doctorAgentStopTitle", {}, "Agent Stop Runtime"),
    badges,
    notes,
    status:
      Number(diagnostics.runningAfterStopCount) > 0
      || Number(diagnostics.completedAfterStopCount) > 0
      || Number(diagnostics.failedAfterStopCount) > 0
      || Number(diagnostics.notFoundCount) > 0
      || Number(diagnostics.runMismatchCount) > 0
        ? "warn"
        : "pass",
  };
}

function resolveRuntimeResilienceDiagnostics(payload, runtime) {
  const launchView = payload?.promptObservability?.launchExplainability?.runtimeResilience;
  if (
    payload?.runtimeResilienceDiagnostics?.alertLevel
    && payload?.runtimeResilienceDiagnostics?.alertCode
    && payload?.runtimeResilienceDiagnostics?.alertMessage
  ) {
    return payload.runtimeResilienceDiagnostics;
  }
  if (
    launchView?.alertLevel
    && launchView?.alertCode
    && launchView?.alertMessage
    && launchView?.totalsSummary
  ) {
    return {
      alertLevel: launchView.alertLevel,
      alertCode: launchView.alertCode,
      alertMessage: launchView.alertMessage,
      dominantReason: launchView.dominantReason || null,
      reasonClusterSummary: launchView.reasonClusterSummary || null,
      mixedSignalHint: launchView.mixedSignalHint || null,
      recoveryHint: launchView.recoveryHint || null,
      latestSignal: launchView.latestSignal || null,
      latestRouteBehavior: launchView.latestRouteBehavior || null,
      latestReasonSummary: launchView.latestReasonSummary || null,
      overallReasonSummary: launchView.overallReasonSummary || null,
      totalsSummary: launchView.totalsSummary,
    };
  }
  return buildLegacyRuntimeResilienceDiagnostics(runtime);
}

function buildLegacyRuntimeResilienceDiagnostics(runtime) {
  const latest = runtime?.latest;
  const observedRuns = Number(runtime?.totals?.observedRuns) || 0;
  const degradedRuns = Number(runtime?.totals?.degradedRuns) || 0;
  const failedRuns = Number(runtime?.totals?.failedRuns) || 0;
  const updatedAt = Number(runtime?.updatedAt) || 0;
  const ageMs = Math.max(0, Date.now() - updatedAt);
  const staleAfterMs = 6 * 60 * 60 * 1000;
  const failureRate = observedRuns > 0 ? failedRuns / observedRuns : 0;
  const degradeRate = observedRuns > 0 ? degradedRuns / observedRuns : 0;
  const summary = buildLegacyRuntimeResilienceSummary(runtime, latest);
  const reasonSignal = buildLegacyRuntimeResilienceReasonSignal(summary);

  if (!latest || observedRuns <= 0) {
    return {
      ...summary,
      alertLevel: "warn",
      alertCode: "no_signal",
      alertMessage: "No runtime resilience signal has been observed yet.",
      dominantReason: null,
      reasonClusterSummary: null,
      mixedSignalHint: null,
      recoveryHint: "Run one real chat/tool request first so runtime resilience can capture a signal.",
      latestSignal: null,
      latestRouteBehavior: null,
    };
  }
  if (ageMs >= staleAfterMs) {
    return {
      ...summary,
      alertLevel: "warn",
      alertCode: "stale",
      alertMessage: `Latest runtime resilience signal is stale (${formatRuntimeAge(ageMs)} old).`,
      dominantReason: reasonSignal.dominantReason,
      reasonClusterSummary: reasonSignal.reasonClusterSummary,
      mixedSignalHint: null,
      recoveryHint: "Exercise the runtime again before trusting this signal; current diagnostics are too old.",
    };
  }
  if (failedRuns >= 2 && failureRate >= 0.5) {
    return {
      ...summary,
      alertLevel: "fail",
      alertCode: "repeated_failure",
      alertMessage: `Repeated runtime failures observed (${failedRuns}/${observedRuns} runs failed).`,
      dominantReason: reasonSignal.dominantReason,
      reasonClusterSummary: reasonSignal.reasonClusterSummary,
      mixedSignalHint: buildLegacyRuntimeResilienceMixedSignalHint("repeated_failure", reasonSignal.clusterReasons),
      recoveryHint: buildLegacyRuntimeResilienceRecoveryHint("repeated_failure", reasonSignal.clusterReasons),
    };
  }
  if (latest.finalStatus !== "success") {
    return {
      ...summary,
      alertLevel: "warn",
      alertCode: "recent_failure",
      alertMessage: `Latest runtime ended as ${latest.finalStatus || "unknown"}.`,
      dominantReason: reasonSignal.dominantReason,
      reasonClusterSummary: reasonSignal.reasonClusterSummary,
      mixedSignalHint: buildLegacyRuntimeResilienceMixedSignalHint("recent_failure", reasonSignal.clusterReasons),
      recoveryHint: buildLegacyRuntimeResilienceRecoveryHint("recent_failure", reasonSignal.clusterReasons),
    };
  }
  if (degradedRuns >= 3 && degradeRate >= 0.5) {
    return {
      ...summary,
      alertLevel: "warn",
      alertCode: "repeated_degrade",
      alertMessage: `Repeated runtime degrade observed (${degradedRuns}/${observedRuns} runs degraded).`,
      dominantReason: reasonSignal.dominantReason,
      reasonClusterSummary: reasonSignal.reasonClusterSummary,
      mixedSignalHint: buildLegacyRuntimeResilienceMixedSignalHint("repeated_degrade", reasonSignal.clusterReasons),
      recoveryHint: buildLegacyRuntimeResilienceRecoveryHint("repeated_degrade", reasonSignal.clusterReasons),
    };
  }
  if (latest.degraded) {
    return {
      ...summary,
      alertLevel: "warn",
      alertCode: "recent_degrade",
      alertMessage: "Latest runtime required retry/fallback to recover.",
      dominantReason: reasonSignal.dominantReason,
      reasonClusterSummary: reasonSignal.reasonClusterSummary,
      mixedSignalHint: buildLegacyRuntimeResilienceMixedSignalHint("recent_degrade", reasonSignal.clusterReasons),
      recoveryHint: buildLegacyRuntimeResilienceRecoveryHint("recent_degrade", reasonSignal.clusterReasons),
    };
  }
  return {
    ...summary,
    alertLevel: "pass",
    alertCode: "healthy",
    alertMessage: "Runtime resilience looks healthy.",
    dominantReason: reasonSignal.dominantReason,
    reasonClusterSummary: reasonSignal.reasonClusterSummary,
    mixedSignalHint: null,
    recoveryHint: null,
  };
}

function buildLegacyRuntimeResilienceSummary(runtime, latest) {
  return {
    latestSignal: buildRuntimeResilienceSignalSummary(latest),
    latestRouteBehavior: buildRuntimeResilienceRouteBehavior(runtime, latest),
    latestReasonSummary: formatKeyCountSummary(latest?.reasonCounts),
    overallReasonSummary: formatKeyCountSummary(runtime?.reasonCounts),
    totalsSummary: buildRuntimeResilienceTotalsSummary(runtime),
  };
}

function buildLegacyRuntimeResilienceReasonSignal(summary) {
  const entries = buildLegacyReasonEntries(summary.latestReasonSummary || summary.overallReasonSummary || "");
  if (entries.length === 0) {
    return {
      dominantReason: null,
      reasonClusterSummary: null,
      clusterReasons: [],
    };
  }
  const primary = entries[0];
  const cluster = [primary];
  for (const entry of entries.slice(1, 3)) {
    if (entry.count >= Math.max(1, Math.ceil(primary.count * 0.5))) {
      cluster.push(entry);
    }
  }
  return {
    dominantReason: cluster[0]?.reason ?? null,
    reasonClusterSummary: cluster.length <= 1
      ? cluster[0]?.reason ?? null
      : cluster.map((entry) => entry.reason).join(" + "),
    clusterReasons: cluster.map((entry) => entry.reason),
  };
}

function buildLegacyReasonEntries(summary) {
  return String(summary)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [reason, count] = item.split("=");
      return {
        reason: reason?.trim() || "",
        count: Number(count) || 0,
      };
    })
    .filter((entry) => entry.reason && entry.count > 0);
}

function buildLegacyRuntimeResilienceRecoveryHint(alertCode, clusterReasons) {
  if (alertCode === "healthy") {
    return null;
  }
  const dominantReason = clusterReasons[0] || null;
  switch (dominantReason) {
    case "rate_limit":
      return "Rate limits dominate; lower concurrency or move quota-sensitive traffic to a preferred fallback/provider.";
    case "timeout":
      return "Timeouts dominate; check baseUrl/proxy latency and raise requestTimeoutMs for the affected profiles if needed.";
    case "server_error":
      return "5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.";
    case "auth":
      return "Auth failures dominate; verify API keys, token scopes, and profile selection for primary/fallback routes.";
    case "billing":
      return "Billing/quota failures dominate; verify provider balance or quota before retrying this route.";
    case "format":
      return "Request format mismatches dominate; verify protocol, wireApi, and model pairing instead of retrying.";
    case "unknown":
      return "Unclassified failures dominate; inspect the latest provider error payload before widening retries.";
    default:
      return alertCode === "recent_failure" || alertCode === "repeated_failure"
        ? "Recent runtime failures need manual inspection; review the latest provider response before retrying."
        : "Repeated degrade suggests this route is unstable; review provider health and fallback ordering.";
  }
}

function buildLegacyRuntimeResilienceMixedSignalHint(alertCode, clusterReasons) {
  if (alertCode === "healthy" || clusterReasons.length < 2) {
    return null;
  }
  const key = [...clusterReasons.slice(0, 2)].sort().join("+");
  switch (key) {
    case "rate_limit+timeout":
      return "Mixed rate-limit + timeout signals suggest both quota pressure and latency; reduce burstiness and check network/proxy latency together.";
    case "rate_limit+server_error":
      return "Mixed rate-limit + 5xx signals suggest provider saturation; shift traffic to fallback routes and reduce bursty retry patterns.";
    case "server_error+timeout":
      return "Mixed 5xx + timeout signals suggest upstream instability; verify provider health and network latency before widening retries.";
    case "auth+billing":
      return "Mixed auth + billing signals suggest the route may be both under-scoped and out of quota; verify keys, scopes, and provider balance together.";
    default:
      return `Mixed signals (${clusterReasons.slice(0, 2).join(" + ")}) detected; inspect the latest provider errors before tuning retry/fallback policy.`;
  }
}

function buildRuntimeResilienceSignalSummary(latest) {
  if (!latest?.source && !latest?.phase && !latest?.agentId && !latest?.conversationId) {
    return null;
  }
  return [
    latest?.source && latest?.phase ? `${latest.source}/${latest.phase}` : latest?.source || latest?.phase || "",
    latest?.agentId ? `agent=${latest.agentId}` : "",
    latest?.conversationId ? `conv=${latest.conversationId}` : "",
  ].filter(Boolean).join(" | ");
}

function buildRuntimeResilienceRouteBehavior(runtime, latest) {
  if (!latest) return null;
  const primaryRoute = `${runtime?.routing?.primary?.profileId || "-"}/${runtime?.routing?.primary?.model || "-"}`;
  const finalRoute = latest.finalProfileId
    ? `${latest.finalProfileId}/${latest.finalModel || "-"}`
    : "";
  if (latest.degraded && finalRoute && latest.finalProfileId !== runtime?.routing?.primary?.profileId) {
    return `switched ${primaryRoute} -> ${finalRoute}`;
  }
  if (latest.degraded && finalRoute) {
    return `stayed on ${finalRoute} after retry`;
  }
  if (latest.finalStatus !== "success" && finalRoute) {
    return `stopped on ${finalRoute}`;
  }
  if (latest.finalStatus !== "success") {
    return `ended without a usable route after ${primaryRoute}`;
  }
  if (finalRoute) {
    return `stayed on ${finalRoute}`;
  }
  return null;
}

function buildRuntimeResilienceTotalsSummary(runtime) {
  return `observed=${formatNumber(runtime?.totals?.observedRuns)}, degraded=${formatNumber(runtime?.totals?.degradedRuns)}, failed=${formatNumber(runtime?.totals?.failedRuns)}, retry=${formatNumber(runtime?.totals?.sameProfileRetries)}, switch=${formatNumber(runtime?.totals?.crossProfileFallbacks)}, cooldown=${formatNumber(runtime?.totals?.cooldownSkips)}`;
}

function formatRuntimeAge(ageMs) {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function createDoctorCard(card, handlers = {}) {
  const panel = document.createElement("div");
  panel.className = "doctor-observability-card";
  panel.style.width = "100%";
  panel.style.padding = "10px 12px";
  panel.style.border = "1px solid var(--border-color, rgba(127,127,127,0.2))";
  panel.style.borderRadius = "10px";
  panel.style.background = "var(--bg-secondary, rgba(127,127,127,0.06))";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.gap = "8px";
  panel.style.boxSizing = "border-box";
  panel.style.maxWidth = "100%";
  panel.style.minWidth = "0";

  const title = document.createElement("div");
  title.className = "doctor-observability-card-title";
  title.style.fontWeight = "600";
  title.textContent = card.title;
  panel.appendChild(title);

  const badgesRow = document.createElement("div");
  badgesRow.className = "doctor-observability-card-badges";
  badgesRow.style.display = "flex";
  badgesRow.style.flexWrap = "wrap";
  badgesRow.style.gap = "8px";
  for (const text of card.badges) {
    const badge = document.createElement("span");
    badge.className = `badge doctor-observability-card-badge ${card.status === "warn" ? "warn" : "pass"}`;
    badge.textContent = text;
    badgesRow.appendChild(badge);
  }
  panel.appendChild(badgesRow);

  const notes = document.createElement("div");
  notes.className = "doctor-observability-card-notes";
  notes.style.display = "flex";
  notes.style.flexDirection = "column";
  notes.style.gap = "4px";
  notes.style.fontSize = "0.92em";
  for (const line of card.notes) {
    const noteText = typeof line === "string" ? line : line?.text || "";
    const action = line && typeof line === "object" ? line.action : null;
    if (action && typeof handlers.onOpenContinuationAction === "function") {
      const note = document.createElement("button");
      note.type = "button";
      note.className = "button goal-inline-action-secondary doctor-observability-card-action";
      note.style.textAlign = "left";
      note.textContent = noteText;
      note.addEventListener("click", () => {
        void handlers.onOpenContinuationAction(action);
      });
      notes.appendChild(note);
      continue;
    }
    const note = document.createElement("div");
    note.className = "doctor-observability-card-note";
    note.textContent = noteText;
    notes.appendChild(note);
  }
  panel.appendChild(notes);

  return panel;
}

const DOCTOR_CARD_SYNC_BATCH_SIZE = 4;
const DOCTOR_CARD_ASYNC_BATCH_SIZE = 4;
const pendingDoctorCardRenderJobs = new WeakMap();

function createDoctorCardRenderScheduler(container) {
  const view = container?.ownerDocument?.defaultView;
  if (view && typeof view.requestAnimationFrame === "function" && typeof view.cancelAnimationFrame === "function") {
    return {
      schedule(callback) {
        return view.requestAnimationFrame(callback);
      },
      cancel(handle) {
        view.cancelAnimationFrame(handle);
      },
    };
  }
  return {
    schedule(callback) {
      return setTimeout(callback, 0);
    },
    cancel(handle) {
      clearTimeout(handle);
    },
  };
}

export function renderDoctorObservabilityCards(container, payload, t, handlers = {}) {
  if (!container) {
    return;
  }
  const previousJob = pendingDoctorCardRenderJobs.get(container);
  if (previousJob) {
    previousJob.cancelled = true;
    previousJob.cancel();
  }
  const cards = [
    buildAssistantModeRuntimeCard(payload, t),
    buildConfigSourceCard(payload, t),
    buildPromptObservabilityCard(payload, t),
    buildToolBehaviorCard(payload, t),
    buildToolContractV2Card(payload, t),
    buildResidentAgentsCard(payload, t),
    buildMindProfileSnapshotCard(payload, t),
    buildLearningReviewInputCard(payload, t),
    buildDreamRuntimeCard(payload, t),
    buildDreamCommonsCard(payload, t),
    buildSkillFreshnessCard(payload, t),
    buildSharedGovernanceCard(payload, t),
    buildCompactionRuntimeCard(payload, t),
    buildDelegationCard(payload, t),
    buildCronRuntimeCard(payload, t),
    buildBackgroundContinuationRuntimeCard(payload, t),
    buildExternalOutboundRuntimeCard(payload, t),
    buildEmailOutboundRuntimeCard(payload, t),
    buildEmailInboundRuntimeCard(payload, t),
    buildCameraRuntimeCard(payload, t),
    buildNativeDesktopHelperCard(payload, t),
    buildDeploymentBackendsCard(payload, t),
    buildAgentStopRuntimeCard(payload, t),
    buildRuntimeResilienceCard(payload, t),
  ].filter(Boolean);
  if (cards.length === 0) {
    pendingDoctorCardRenderJobs.delete(container);
    return;
  }

  const scheduler = createDoctorCardRenderScheduler(container);
  const job = {
    cancelled: false,
    handle: null,
    cancel() {
      if (this.handle !== null) {
        scheduler.cancel(this.handle);
        this.handle = null;
      }
    },
  };
  pendingDoctorCardRenderJobs.set(container, job);

  const appendBatch = (startIndex, batchSize) => {
    if (job.cancelled || pendingDoctorCardRenderJobs.get(container) !== job) {
      return;
    }
    const endIndex = Math.min(startIndex + batchSize, cards.length);
    for (let index = startIndex; index < endIndex; index += 1) {
      container.appendChild(createDoctorCard(cards[index], handlers));
    }
    if (endIndex >= cards.length) {
      pendingDoctorCardRenderJobs.delete(container);
      job.handle = null;
      return;
    }
    job.handle = scheduler.schedule(() => {
      appendBatch(endIndex, DOCTOR_CARD_ASYNC_BATCH_SIZE);
    });
  };

  appendBatch(0, DOCTOR_CARD_SYNC_BATCH_SIZE);
}

export function buildDoctorChatSummary(payload, t) {
  const formatNote = (note) => typeof note === "string" ? note : note?.text || "";
  const lines = [];
  const promptCard = buildPromptObservabilityCard(payload, t);
  if (promptCard) {
    lines.push(``);
    lines.push(`${promptCard.title}:`);
    lines.push(...promptCard.badges.map((badge) => `- ${badge}`));
    lines.push(...promptCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const toolCard = buildToolBehaviorCard(payload, t);
  if (toolCard) {
    lines.push(``);
    lines.push(`${toolCard.title}:`);
    lines.push(...toolCard.badges.map((badge) => `- ${badge}`));
    lines.push(...toolCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const toolContractV2Card = buildToolContractV2Card(payload, t);
  if (toolContractV2Card) {
    lines.push(``);
    lines.push(`${toolContractV2Card.title}:`);
    lines.push(...toolContractV2Card.badges.map((badge) => `- ${badge}`));
    lines.push(...toolContractV2Card.notes.map((note) => `- ${formatNote(note)}`));
  }

  const residentAgentsCard = buildResidentAgentsCard(payload, t);
  if (residentAgentsCard) {
    lines.push(``);
    lines.push(`${residentAgentsCard.title}:`);
    lines.push(...residentAgentsCard.badges.map((badge) => `- ${badge}`));
    lines.push(...residentAgentsCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const mindProfileSnapshotCard = buildMindProfileSnapshotCard(payload, t);
  if (mindProfileSnapshotCard) {
    lines.push(``);
    lines.push(`${mindProfileSnapshotCard.title}:`);
    lines.push(...mindProfileSnapshotCard.badges.map((badge) => `- ${badge}`));
    lines.push(...mindProfileSnapshotCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const learningReviewInputCard = buildLearningReviewInputCard(payload, t);
  if (learningReviewInputCard) {
    lines.push(``);
    lines.push(`${learningReviewInputCard.title}:`);
    lines.push(...learningReviewInputCard.badges.map((badge) => `- ${badge}`));
    lines.push(...learningReviewInputCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const dreamRuntimeCard = buildDreamRuntimeCard(payload, t);
  if (dreamRuntimeCard) {
    lines.push(``);
    lines.push(`${dreamRuntimeCard.title}:`);
    lines.push(...dreamRuntimeCard.badges.map((badge) => `- ${badge}`));
    lines.push(...dreamRuntimeCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const dreamCommonsCard = buildDreamCommonsCard(payload, t);
  if (dreamCommonsCard) {
    lines.push(``);
    lines.push(`${dreamCommonsCard.title}:`);
    lines.push(...dreamCommonsCard.badges.map((badge) => `- ${badge}`));
    lines.push(...dreamCommonsCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const skillFreshnessCard = buildSkillFreshnessCard(payload, t);
  if (skillFreshnessCard) {
    lines.push(``);
    lines.push(`${skillFreshnessCard.title}:`);
    lines.push(...skillFreshnessCard.badges.map((badge) => `- ${badge}`));
    lines.push(...skillFreshnessCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const sharedGovernanceCard = buildSharedGovernanceCard(payload, t);
  if (sharedGovernanceCard) {
    lines.push(``);
    lines.push(`${sharedGovernanceCard.title}:`);
    lines.push(...sharedGovernanceCard.badges.map((badge) => `- ${badge}`));
    lines.push(...sharedGovernanceCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const compactionRuntimeCard = buildCompactionRuntimeCard(payload, t);
  if (compactionRuntimeCard) {
    lines.push(``);
    lines.push(`${compactionRuntimeCard.title}:`);
    lines.push(...compactionRuntimeCard.badges.map((badge) => `- ${badge}`));
    lines.push(...compactionRuntimeCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const delegationCard = buildDelegationCard(payload, t);
  if (delegationCard) {
    lines.push(``);
    lines.push(`${delegationCard.title}:`);
    lines.push(...delegationCard.badges.map((badge) => `- ${badge}`));
    lines.push(...delegationCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const assistantModeCard = buildAssistantModeRuntimeCard(payload, t);
  if (assistantModeCard) {
    lines.push(``);
    lines.push(`${assistantModeCard.title}:`);
    lines.push(...assistantModeCard.badges.map((badge) => `- ${badge}`));
    lines.push(...assistantModeCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const configSourceCard = buildConfigSourceCard(payload, t);
  if (configSourceCard) {
    lines.push(``);
    lines.push(`${configSourceCard.title}:`);
    lines.push(...configSourceCard.badges.map((badge) => `- ${badge}`));
    lines.push(...configSourceCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const cronCard = buildCronRuntimeCard(payload, t);
  if (cronCard) {
    lines.push(``);
    lines.push(`${cronCard.title}:`);
    lines.push(...cronCard.badges.map((badge) => `- ${badge}`));
    lines.push(...cronCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const backgroundContinuationCard = buildBackgroundContinuationRuntimeCard(payload, t);
  if (backgroundContinuationCard) {
    lines.push(``);
    lines.push(`${backgroundContinuationCard.title}:`);
    lines.push(...backgroundContinuationCard.badges.map((badge) => `- ${badge}`));
    lines.push(...backgroundContinuationCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const externalOutboundCard = buildExternalOutboundRuntimeCard(payload, t);
  if (externalOutboundCard) {
    lines.push(``);
    lines.push(`${externalOutboundCard.title}:`);
    lines.push(...externalOutboundCard.badges.map((badge) => `- ${badge}`));
    lines.push(...externalOutboundCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const emailOutboundCard = buildEmailOutboundRuntimeCard(payload, t);
  if (emailOutboundCard) {
    lines.push(``);
    lines.push(`${emailOutboundCard.title}:`);
    lines.push(...emailOutboundCard.badges.map((badge) => `- ${badge}`));
    lines.push(...emailOutboundCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const emailInboundCard = buildEmailInboundRuntimeCard(payload, t);
  if (emailInboundCard) {
    lines.push(``);
    lines.push(`${emailInboundCard.title}:`);
    lines.push(...emailInboundCard.badges.map((badge) => `- ${badge}`));
    lines.push(...emailInboundCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const cameraRuntimeCard = buildCameraRuntimeCard(payload, t);
  if (cameraRuntimeCard) {
    lines.push(``);
    lines.push(`${cameraRuntimeCard.title}:`);
    lines.push(...cameraRuntimeCard.badges.map((badge) => `- ${badge}`));
    lines.push(...cameraRuntimeCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const nativeDesktopHelperCard = buildNativeDesktopHelperCard(payload, t);
  if (nativeDesktopHelperCard) {
    lines.push(``);
    lines.push(`${nativeDesktopHelperCard.title}:`);
    lines.push(...nativeDesktopHelperCard.badges.map((badge) => `- ${badge}`));
    lines.push(...nativeDesktopHelperCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const deploymentBackendsCard = buildDeploymentBackendsCard(payload, t);
  if (deploymentBackendsCard) {
    lines.push(``);
    lines.push(`${deploymentBackendsCard.title}:`);
    lines.push(...deploymentBackendsCard.badges.map((badge) => `- ${badge}`));
    lines.push(...deploymentBackendsCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const agentStopRuntimeCard = buildAgentStopRuntimeCard(payload, t);
  if (agentStopRuntimeCard) {
    lines.push(``);
    lines.push(`${agentStopRuntimeCard.title}:`);
    lines.push(...agentStopRuntimeCard.badges.map((badge) => `- ${badge}`));
    lines.push(...agentStopRuntimeCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  const runtimeResilienceCard = buildRuntimeResilienceCard(payload, t);
  if (runtimeResilienceCard) {
    lines.push(``);
    lines.push(`${runtimeResilienceCard.title}:`);
    lines.push(...runtimeResilienceCard.badges.map((badge) => `- ${badge}`));
    lines.push(...runtimeResilienceCard.notes.map((note) => `- ${formatNote(note)}`));
  }

  return lines;
}
