import {
  formatResidentSourceAuditSummary,
  formatResidentSourceConflictSummary,
  formatResidentSourceExplainability,
  formatResidentSourceScopeLabel,
  formatResidentSourceSummary,
  getResidentSourceBadgeClass,
} from "./memory-source-view.js";
import { buildExternalOutboundDiagnosis } from "./external-outbound-diagnosis.js";
import {
  buildEmailThreadOrganizerEntries,
  buildEmailThreadOrganizerStats,
  mergeEmailThreadOrganizerReminders,
  matchesEmailThreadOrganizerQuery,
  normalizeOutboundAuditFocus,
} from "./email-thread-organizer-view.js";
import { buildDreamHistoryPanelView } from "./memory-viewer-dream-history.js";
import { renderSkillFreshnessDetail } from "./skill-freshness-view.js";
import { isCompactGovernanceDetailMode, renderGovernanceFullOnly } from "./governance-detail-mode.js";

function normalizeSharedReviewFocus(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "actionable" || normalized === "mine") {
    return normalized;
  }
  return "";
}

function normalizeEmailThreadOpenNoteText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeDreamRuntimeView(payload, fallbackAgentId = "default") {
  const agentId = typeof payload?.agentId === "string" && payload.agentId.trim()
    ? payload.agentId.trim()
    : fallbackAgentId;
  const state = payload?.state && typeof payload.state === "object" ? payload.state : null;
  const latestRun = payload?.record && typeof payload.record === "object"
    ? payload.record
    : Array.isArray(state?.recentRuns)
      ? state.recentRuns[0] ?? null
      : null;
  const defaultConversationId = typeof payload?.defaultConversationId === "string" && payload.defaultConversationId.trim()
    ? payload.defaultConversationId.trim()
    : null;
  return {
    requested: {
      agentId,
      defaultConversationId,
    },
    availability: payload?.availability && typeof payload.availability === "object"
      ? payload.availability
      : {
        enabled: false,
        available: false,
        reason: "not_loaded",
      },
    autoSummary: payload?.autoSummary && typeof payload.autoSummary === "object"
      ? payload.autoSummary
      : null,
    state,
    latestRun,
  };
}

function normalizeDreamCommonsView(payload) {
  return {
    availability: payload?.availability && typeof payload.availability === "object"
      ? payload.availability
      : {
        enabled: false,
        available: false,
        reason: "not_loaded",
      },
    state: payload?.state && typeof payload.state === "object" ? payload.state : null,
    headline: typeof payload?.headline === "string" ? payload.headline.trim() : "",
  };
}

function formatDreamCommonsSummary(dreamCommons, t = (_key, _params, fallback) => fallback ?? "", formatDateTime = (value) => String(value ?? "-"), formatCount = (value) => String(value ?? 0)) {
  if (!dreamCommons || typeof dreamCommons !== "object") {
    return t("memory.dreamCommonsSummaryEmpty", {}, "Commons：暂无");
  }
  const availability = dreamCommons.availability ?? {};
  const state = dreamCommons.state ?? {};
  if (!availability.enabled) {
    return t(
      "memory.dreamCommonsDisabled",
      { reason: availability.reason || "-" },
      `Commons：未启用 (${availability.reason || "-"})`,
    );
  }
  if (!availability.available) {
    return t(
      "memory.dreamCommonsBlocked",
      { reason: availability.reason || "-" },
      `Commons：不可用 (${availability.reason || "-"})`,
    );
  }
  return t(
    "memory.dreamCommonsSummary",
    {
      status: state.status || "idle",
      approved: formatCount(Number(state.approvedCount) || 0),
      revoked: formatCount(Number(state.revokedCount) || 0),
      notes: formatCount(Number(state.noteCount) || 0),
      at: formatDateTime(state.lastSuccessAt || state.lastAttemptAt),
    },
    `Commons：${state.status || "idle"} · approved ${formatCount(Number(state.approvedCount) || 0)} / revoked ${formatCount(Number(state.revokedCount) || 0)} / notes ${formatCount(Number(state.noteCount) || 0)} · ${formatDateTime(state.lastSuccessAt || state.lastAttemptAt)}`,
  );
}

function formatDreamObsidianSummary(dreamRuntime, t = (_key, _params, fallback) => fallback ?? "", formatDateTime = (value) => String(value ?? "-")) {
  const sync = dreamRuntime?.state?.lastObsidianSync ?? dreamRuntime?.latestRun?.obsidianSync ?? null;
  if (!sync || typeof sync !== "object") {
    return t("memory.dreamObsidianSummaryEmpty", {}, "Obsidian：暂无");
  }
  const stage = typeof sync.stage === "string" && sync.stage.trim() ? sync.stage.trim() : "unknown";
  const targetPath = typeof sync.targetPath === "string" && sync.targetPath.trim() ? sync.targetPath.trim() : "";
  const updatedAt = typeof sync.updatedAt === "string" && sync.updatedAt.trim() ? sync.updatedAt.trim() : "";
  return t(
    "memory.dreamObsidianSummary",
    {
      stage,
      targetPath: targetPath || "-",
      updatedAt: formatDateTime(updatedAt),
    },
    `Obsidian：${stage}${targetPath ? ` · ${targetPath}` : ""}${updatedAt ? ` · ${formatDateTime(updatedAt)}` : ""}`,
  );
}

export function formatDreamGenerationModeLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  if (value === "fallback") return t("memory.dreamGenerationFallback", {}, "Fallback");
  if (value === "llm") return t("memory.dreamGenerationLlm", {}, "LLM");
  return t("memory.dreamGenerationUnknown", {}, "未知");
}

export function formatDreamFallbackReasonLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  if (value === "missing_model_config") {
    return t("memory.dreamFallbackReasonMissingModelConfig", {}, "缺少模型配置");
  }
  if (value === "llm_call_failed") {
    return t("memory.dreamFallbackReasonLlmCallFailed", {}, "LLM 调用失败");
  }
  return t("memory.dreamFallbackReasonUnknown", {}, "未知原因");
}

function formatDreamStatusLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "queued") return t("memory.dreamStatusQueued", {}, "排队中");
  if (normalized === "running") return t("memory.dreamStatusRunning", {}, "运行中");
  if (normalized === "completed") return t("memory.dreamStatusCompleted", {}, "最近成功");
  if (normalized === "failed") return t("memory.dreamStatusFailed", {}, "最近失败");
  return t("memory.dreamStatusIdle", {}, "空闲");
}

function formatDreamAutoTriggerModeLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  return value === "cron"
    ? t("memory.dreamAutoTriggerCron", {}, "cron")
    : t("memory.dreamAutoTriggerHeartbeat", {}, "heartbeat");
}

function formatDreamSignalSummary(signal, t = (_key, _params, fallback) => fallback ?? "", countFormatter = (value) => String(value ?? 0)) {
  if (!signal || typeof signal !== "object") {
    return t("memory.dreamSignalSummaryEmpty", {}, "信号：暂无");
  }
  return t(
    "memory.dreamSignalSummary",
    {
      digestDelta: countFormatter(Number(signal.digestGenerationDelta) || 0),
      sessionRevisionDelta: countFormatter(Number(signal.sessionMemoryRevisionDelta) || 0),
      taskDelta: countFormatter(Number(signal.taskChangeSeqDelta) || 0),
      memoryDelta: countFormatter(Number(signal.memoryChangeSeqDelta) || 0),
      budget: countFormatter(Number(signal.changeBudget) || 0),
    },
    `信号：digestΔ ${countFormatter(Number(signal.digestGenerationDelta) || 0)} / sessionRevΔ ${countFormatter(Number(signal.sessionMemoryRevisionDelta) || 0)} / taskΔ ${countFormatter(Number(signal.taskChangeSeqDelta) || 0)} / memoryΔ ${countFormatter(Number(signal.memoryChangeSeqDelta) || 0)} / budget ${countFormatter(Number(signal.changeBudget) || 0)}`,
  );
}

function formatDreamAutoStatsSummary(autoStats, t = (_key, _params, fallback) => fallback ?? "", countFormatter = (value) => String(value ?? 0)) {
  if (!autoStats || typeof autoStats !== "object") {
    return t("memory.dreamAutoStatsEmpty", {}, "统计：暂无");
  }
  const skipCodeCounts = autoStats.skipCodeCounts && typeof autoStats.skipCodeCounts === "object"
    ? Object.entries(autoStats.skipCodeCounts).filter(([, count]) => Number.isFinite(count) && Number(count) > 0)
    : [];
  const signalGateCounts = autoStats.signalGateCounts && typeof autoStats.signalGateCounts === "object"
    ? Object.entries(autoStats.signalGateCounts).filter(([, count]) => Number.isFinite(count) && Number(count) > 0)
    : [];
  const skipText = skipCodeCounts.length > 0
    ? skipCodeCounts.map(([key, count]) => `${key}:${countFormatter(Number(count) || 0)}`).join(", ")
    : "-";
  const gateText = signalGateCounts.length > 0
    ? signalGateCounts.map(([key, count]) => `${key}:${countFormatter(Number(count) || 0)}`).join(", ")
    : "-";
  const triggerModeEntries = autoStats.byTriggerMode && typeof autoStats.byTriggerMode === "object"
    ? Object.entries(autoStats.byTriggerMode).filter(([, stats]) => stats && typeof stats === "object")
    : [];
  const triggerModeText = triggerModeEntries.length > 0
    ? triggerModeEntries.map(([key, stats]) => `${key}[a:${countFormatter(Number(stats.attemptedCount) || 0)}, e:${countFormatter(Number(stats.executedCount) || 0)}, s:${countFormatter(Number(stats.skippedCount) || 0)}]`).join(", ")
    : "-";
  return t(
    "memory.dreamAutoStatsSummary",
    {
      attempted: countFormatter(Number(autoStats.attemptedCount) || 0),
      executed: countFormatter(Number(autoStats.executedCount) || 0),
      skipped: countFormatter(Number(autoStats.skippedCount) || 0),
      skipText,
      gateText,
      triggerModeText,
    },
    `统计：attempted ${countFormatter(Number(autoStats.attemptedCount) || 0)} / executed ${countFormatter(Number(autoStats.executedCount) || 0)} / skipped ${countFormatter(Number(autoStats.skippedCount) || 0)} · mode ${triggerModeText} · skip ${skipText} · gate ${gateText}`,
  );
}

export function buildDreamRuntimeBarView(input, options = {}) {
  const dreamRuntime = input?.dreamRuntime ?? null;
  const dreamCommons = input?.dreamCommons ?? null;
  const connected = input?.connected !== false;
  const dreamBusy = input?.dreamBusy === true;
  const t = typeof options.t === "function" ? options.t : (_key, _params, fallback) => fallback ?? "";
  const formatDateTime = typeof options.formatDateTime === "function" ? options.formatDateTime : (value) => {
    if (typeof value !== "string" || !value.trim()) return "-";
    return value;
  };
  const formatCount = typeof options.formatCount === "function" ? options.formatCount : (value) => String(value ?? 0);
  const autoSummary = dreamRuntime?.autoSummary
    ?? (dreamRuntime?.state?.lastAutoTrigger
      ? {
          ...dreamRuntime.state.lastAutoTrigger,
          cooldownUntil: dreamRuntime?.state?.cooldownUntil,
          failureBackoffUntil: dreamRuntime?.state?.failureBackoffUntil,
        }
      : null);
  const latestRun = dreamRuntime?.latestRun
    ?? (Array.isArray(dreamRuntime?.state?.recentRuns) ? dreamRuntime.state.recentRuns[0] : null);
  const latestTimestamp = latestRun?.finishedAt || latestRun?.requestedAt || dreamRuntime?.state?.lastDreamAt || dreamRuntime?.state?.updatedAt;
  const availability = dreamRuntime?.availability;
  const lastInput = dreamRuntime?.state?.lastInput ?? latestRun?.input ?? null;
  const sourceCounts = lastInput?.sourceCounts ?? {};
  const fallbackReady = availability?.enabled === true;
  const availabilityText = availability?.available
    ? (availability.model || t("memory.dreamAvailable", {}, "可用"))
    : fallbackReady
      ? t(
        "memory.dreamFallbackReady",
        { reason: availability?.reason || t("memory.dreamUnavailable", {}, "未就绪") },
        `fallback 就绪 (${availability?.reason || t("memory.dreamUnavailable", {}, "未就绪")})`,
      )
      : (availability?.reason || t("memory.dreamUnavailable", {}, "未就绪"));
  const cooldownUntil = autoSummary?.cooldownUntil || dreamRuntime?.state?.cooldownUntil;
  const failureBackoffUntil = autoSummary?.failureBackoffUntil || dreamRuntime?.state?.failureBackoffUntil;
  const autoText = autoSummary?.attemptedAt
    ? t(
      "memory.dreamAutoSummary",
      {
        triggerMode: formatDreamAutoTriggerModeLabel(autoSummary.triggerMode, t),
        attemptedAt: formatDateTime(autoSummary.attemptedAt),
        outcome: autoSummary.executed
          ? formatDreamStatusLabel(autoSummary.status, t)
          : `skip ${autoSummary.skipCode || "-"}`,
      },
      `自动触发：${formatDreamAutoTriggerModeLabel(autoSummary.triggerMode, t)} @ ${formatDateTime(autoSummary.attemptedAt)} · ${autoSummary.executed ? formatDreamStatusLabel(autoSummary.status, t) : `skip ${autoSummary.skipCode || "-"}`}`,
    )
    : t("memory.dreamAutoSummaryEmpty", {}, "自动触发：暂无");
  const gateText = cooldownUntil || failureBackoffUntil
    ? t(
      "memory.dreamGateSummary",
      {
        cooldownUntil: formatDateTime(cooldownUntil),
        failureBackoffUntil: formatDateTime(failureBackoffUntil),
      },
      `冷却至：${formatDateTime(cooldownUntil)} · 回退至：${formatDateTime(failureBackoffUntil)}`,
    )
    : t("memory.dreamGateSummaryEmpty", {}, "冷却 / 回退：无");
  const signalText = formatDreamSignalSummary(autoSummary?.signal, t, formatCount);
  const autoStatsText = formatDreamAutoStatsSummary(dreamRuntime?.state?.autoStats, t, formatCount);
  const commonsText = formatDreamCommonsSummary(dreamCommons, t, formatDateTime, formatCount);
  const obsidianText = formatDreamObsidianSummary(dreamRuntime, t, formatDateTime);
  const generationText = latestRun?.generationMode
    ? t(
      "memory.dreamGenerationSummary",
      {
        mode: formatDreamGenerationModeLabel(latestRun.generationMode, t),
        reason: latestRun.fallbackReason ? formatDreamFallbackReasonLabel(latestRun.fallbackReason, t) : "",
      },
      `生成：${formatDreamGenerationModeLabel(latestRun.generationMode, t)}${latestRun.fallbackReason ? ` (${formatDreamFallbackReasonLabel(latestRun.fallbackReason, t)})` : ""}`,
    )
    : t("memory.dreamGenerationSummaryEmpty", {}, "生成：暂无");
  const summaryText = latestRun?.summary
    || latestRun?.error
    || (lastInput
      ? t(
        "memory.dreamInputSummary",
        {
          tasks: formatCount(Number(sourceCounts.recentTaskCount) || 0),
          memories: formatCount(Number(sourceCounts.recentDurableMemoryCount) || 0),
          usages: formatCount(Number(sourceCounts.recentExperienceUsageCount) || 0),
        },
        `最近输入：任务 ${formatCount(Number(sourceCounts.recentTaskCount) || 0)} / 记忆 ${formatCount(Number(sourceCounts.recentDurableMemoryCount) || 0)} / 经验 ${formatCount(Number(sourceCounts.recentExperienceUsageCount) || 0)}`,
      )
      : t("memory.dreamSummaryEmpty", {}, "最近还没有 dream 记录"));

  return {
    statusLine: connected
      ? t(
        "memory.dreamStatusLine",
        {
          status: formatDreamStatusLabel(dreamRuntime?.state?.status, t),
          availability: availabilityText,
        },
        `Dream 状态：${formatDreamStatusLabel(dreamRuntime?.state?.status, t)} · ${availabilityText}`,
      )
      : t("memory.dreamDisconnected", {}, "Dream 状态：未连接"),
    metaLine: t(
      "memory.dreamMetaLine",
      {
        conversationId: dreamRuntime?.requested?.defaultConversationId || "-",
        lastRunAt: formatDateTime(latestTimestamp),
        autoSummary: autoText,
      },
      `默认会话：${dreamRuntime?.requested?.defaultConversationId || "-"} · 最近一次：${formatDateTime(latestTimestamp)} · ${autoText}`,
    ),
    obsidianLine: obsidianText,
    summaryLine: t(
      "memory.dreamSummaryLine",
      { summary: summaryText, generation: generationText, commons: commonsText, gates: gateText, signal: signalText, stats: autoStatsText },
      `最近摘要：${summaryText} · ${generationText} · ${commonsText} · ${signalText} · ${autoStatsText} · ${gateText}`,
    ),
    refreshDisabled: !connected || dreamBusy,
    runDisabled: !connected || dreamBusy || !fallbackReady,
    runTitle: fallbackReady
      ? ""
      : availability?.reason || t("memory.dreamRunDisabled", {}, "当前 Dream runtime 不可用"),
  };
}

function truncateEmailThreadOpenNoteText(value, { maxLines = 6, maxChars = 480 } = {}) {
  const normalized = normalizeEmailThreadOpenNoteText(value);
  if (!normalized) return "";
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const limitedLines = lines.slice(0, maxLines);
  let joined = limitedLines.join("\n");
  if (joined.length > maxChars) {
    joined = `${joined.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  } else if (lines.length > limitedLines.length || normalized.length > joined.length) {
    joined = `${joined}\n…`;
  }
  return joined;
}

export function buildEmailThreadConversationOpenNote(item, t = (_key, _params, fallback) => fallback ?? "") {
  if (!item || typeof item !== "object") return "";
  const triageSummary = normalizeEmailThreadOpenNoteText(item.latestTriageSummary);
  const replySubject = normalizeEmailThreadOpenNoteText(item.latestSuggestedReplySubject);
  const replyStarter = normalizeEmailThreadOpenNoteText(item.latestSuggestedReplyStarter);
  const replyQuality = normalizeEmailThreadOpenNoteText(item.latestSuggestedReplyQuality);
  const replyConfidence = normalizeEmailThreadOpenNoteText(item.latestSuggestedReplyConfidence);
  const firstWarning = Array.isArray(item.latestSuggestedReplyWarnings)
    ? normalizeEmailThreadOpenNoteText(item.latestSuggestedReplyWarnings[0])
    : "";
  const draftExcerpt = truncateEmailThreadOpenNoteText(item.latestSuggestedReplyDraft, {
    maxLines: 8,
    maxChars: 640,
  });
  const lines = [
    triageSummary ? `${t("memory.emailThreadOrganizerOpenNoteSummary", {}, "线程整理摘要")}: ${triageSummary}` : "",
    replySubject ? `${t("memory.emailThreadOrganizerOpenNoteSubject", {}, "建议回复主题")}: ${replySubject}` : "",
    replyStarter ? `${t("memory.emailThreadOrganizerOpenNoteStarter", {}, "建议回复 starter")}: ${replyStarter}` : "",
    replyQuality
      ? `${t("memory.emailThreadOrganizerOpenNoteQuality", {}, "回复建议质量")}: ${replyQuality}${replyConfidence ? ` · ${replyConfidence}` : ""}`
      : "",
    firstWarning ? `${t("memory.emailThreadOrganizerOpenNoteWarning", {}, "回复建议注意")}: ${firstWarning}` : "",
    draftExcerpt ? `${t("memory.emailThreadOrganizerOpenNoteDraft", {}, "建议回复草稿摘录")}:\n${draftExcerpt}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildEmailThreadConversationAdvicePrompt(item, t = (_key, _params, fallback) => fallback ?? "") {
  if (!item || typeof item !== "object") {
    return t(
      "memory.emailThreadOrganizerAdvicePromptDefault",
      {},
      "我刚从邮件线程整理打开了这个线程。请基于当前邮件线程，给出处理建议，并在需要时提供一版可直接发送的回复草稿。",
    );
  }
  const subject = normalizeEmailThreadOpenNoteText(item.latestSubject);
  const triageSummary = normalizeEmailThreadOpenNoteText(item.latestTriageSummary);
  const replyStarter = normalizeEmailThreadOpenNoteText(item.latestSuggestedReplyStarter);
  const replyQuality = normalizeEmailThreadOpenNoteText(item.latestSuggestedReplyQuality);
  const lines = [
    t(
      "memory.emailThreadOrganizerAdvicePromptDefault",
      {},
      "我刚从邮件线程整理打开了这个线程。请基于当前邮件线程，给出处理建议，并在需要时提供一版可直接发送的回复草稿。",
    ),
    subject ? `${t("memory.emailThreadOrganizerOpenNoteSubject", {}, "建议回复主题")}: ${subject}` : "",
    triageSummary ? `${t("memory.emailThreadOrganizerOpenNoteSummary", {}, "线程整理摘要")}: ${triageSummary}` : "",
    replyStarter ? `${t("memory.emailThreadOrganizerOpenNoteStarter", {}, "建议回复 starter")}: ${replyStarter}` : "",
    replyQuality ? `${t("memory.emailThreadOrganizerOpenNoteQuality", {}, "回复建议质量")}: ${replyQuality}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildSharedReviewQueueParams({
  reviewerAgentId,
  limit = 50,
  query = "",
  governanceStatus = "pending",
  sharedReviewFilters = {},
} = {}) {
  const activeReviewerAgentId = typeof reviewerAgentId === "string" && reviewerAgentId.trim()
    ? reviewerAgentId.trim()
    : "default";
  const focus = normalizeSharedReviewFocus(sharedReviewFilters?.focus);
  const targetAgentId = typeof sharedReviewFilters?.targetAgentId === "string"
    ? sharedReviewFilters.targetAgentId.trim()
    : "";
  const claimedByAgentId = typeof sharedReviewFilters?.claimedByAgentId === "string"
    ? sharedReviewFilters.claimedByAgentId.trim()
    : "";
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  const filter = {};
  filter.sharedPromotionStatus = governanceStatus || "pending";
  if (focus === "actionable") {
    filter.actionableOnly = true;
  } else if (focus === "mine") {
    filter.claimedByAgentId = activeReviewerAgentId;
  } else if (claimedByAgentId) {
    filter.claimedByAgentId = claimedByAgentId;
  }
  if (targetAgentId) {
    filter.targetAgentId = targetAgentId;
  }

  const params = {
    limit,
    reviewerAgentId: activeReviewerAgentId,
  };
  if (Object.keys(filter).length > 0) {
    params.filter = filter;
  }
  if (normalizedQuery) {
    params.query = normalizedQuery;
  }
  return params;
}

function normalizeSharedReviewBatchStatus(item) {
  const reviewStatus = typeof item?.reviewStatus === "string" ? item.reviewStatus.trim().toLowerCase() : "";
  if (reviewStatus === "pending" || reviewStatus === "approved" || reviewStatus === "active" || reviewStatus === "rejected" || reviewStatus === "revoked") {
    return reviewStatus;
  }
  const metadataStatus = typeof item?.metadata?.sharedPromotion?.status === "string"
    ? item.metadata.sharedPromotion.status.trim().toLowerCase()
    : "";
  if (metadataStatus === "pending" || metadataStatus === "approved" || metadataStatus === "active" || metadataStatus === "rejected" || metadataStatus === "revoked") {
    return metadataStatus;
  }
  return "";
}

function getSharedReviewBatchClaimOwner(item) {
  if (typeof item?.claimOwner === "string" && item.claimOwner.trim()) {
    return item.claimOwner.trim();
  }
  const metadataOwner = item?.metadata?.sharedPromotion?.claimedByAgentId;
  return typeof metadataOwner === "string" ? metadataOwner.trim() : "";
}

export function buildSharedReviewBatchActionState(items, selectedIds, activeAgentId) {
  const itemMap = new Map((Array.isArray(items) ? items : []).map((item) => [String(item?.id || "").trim(), item]));
  const selectedItems = [];
  for (const rawId of Array.isArray(selectedIds) ? selectedIds : []) {
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) continue;
    const item = itemMap.get(id);
    if (item) {
      selectedItems.push(item);
    }
  }

  const actions = {
    claim: [],
    release: [],
    approved: [],
    rejected: [],
    revoked: [],
  };

  for (const item of selectedItems) {
    const status = normalizeSharedReviewBatchStatus(item);
    const claimOwner = getSharedReviewBatchClaimOwner(item);
    const claimTimedOut = item?.claimTimedOut === true;
    const actionableByReviewer = item?.actionableByReviewer === true;
    const canClaimNow = status === "pending" && (!claimOwner || claimTimedOut);
    const canReleaseNow = status === "pending" && claimOwner === activeAgentId && !claimTimedOut;
    const canReviewNow = status === "pending" && (actionableByReviewer || !claimOwner || claimOwner === activeAgentId || claimTimedOut);
    const canRevokeNow = status === "approved" || status === "active";

    if (canClaimNow) actions.claim.push(item);
    if (canReleaseNow) actions.release.push(item);
    if (canReviewNow) {
      actions.approved.push(item);
      actions.rejected.push(item);
    }
    if (canRevokeNow) actions.revoked.push(item);
  }

  return {
    totalVisible: itemMap.size,
    selectedItems,
    selectedCount: selectedItems.length,
    actions,
  };
}

export function collectActionableSharedReviewIds(items, activeAgentId) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const batchState = buildSharedReviewBatchActionState(
    normalizedItems,
    normalizedItems.map((item) => String(item?.id || "").trim()).filter(Boolean),
    activeAgentId,
  );
  const selectedIds = new Set();
  for (const item of [
    ...batchState.actions.claim,
    ...batchState.actions.release,
    ...batchState.actions.approved,
    ...batchState.actions.revoked,
  ]) {
    const id = String(item?.id || "").trim();
    if (id) selectedIds.add(id);
  }
  return [...selectedIds];
}

function collectUniqueNonEmptyStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter(Boolean),
  )];
}

function normalizeMemoryViewerTab(value, fallback = "tasks") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "tasks" || normalized === "memories" || normalized === "sharedReview" || normalized === "outboundAudit") {
    return normalized;
  }
  return fallback;
}

function normalizeMemoryViewerTextFilter(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMemoryViewerGoalId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

const MEMORY_DETAIL_COLLAPSE_MAX_LINES = 14;
const MEMORY_DETAIL_COLLAPSE_MAX_CHARS = 1200;

export function buildMemoryDetailCollapsedPreview(value, options = {}) {
  const text = typeof value === "string" ? value : String(value ?? "");
  const maxLines = Math.max(1, Number(options.maxLines) || MEMORY_DETAIL_COLLAPSE_MAX_LINES);
  const maxChars = Math.max(1, Number(options.maxChars) || MEMORY_DETAIL_COLLAPSE_MAX_CHARS);
  const lines = text.split(/\r?\n/);
  let preview = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;
  if (preview.length > maxChars) {
    preview = preview.slice(0, Math.max(0, maxChars - 1)).trimEnd();
    truncated = true;
  }
  if (truncated) {
    preview = `${preview.trimEnd()}\n…`;
  }
  return {
    preview,
    truncated,
    lineCount: lines.length,
    charCount: text.length,
  };
}

export function getMemoryViewerListPageSize(tab = "tasks") {
  const normalizedTab = normalizeMemoryViewerTab(tab);
  if (normalizedTab === "sharedReview" || normalizedTab === "outboundAudit") {
    return 25;
  }
  return 20;
}

function normalizeMemoryViewerListPage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.floor(numeric);
}

export function paginateMemoryViewerItems(items, options = {}) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const pageSize = Math.max(1, normalizeMemoryViewerListPage(options.pageSize) || 20);
  const totalItems = normalizedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(normalizeMemoryViewerListPage(options.page), totalPages - 1);
  const startIndex = totalItems > 0 ? currentPage * pageSize : 0;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  return {
    pageSize,
    totalItems,
    totalPages,
    currentPage,
    startIndex,
    endIndex,
    visibleStart: totalItems > 0 ? startIndex + 1 : 0,
    visibleEnd: endIndex,
    hasPagination: totalItems > pageSize,
    visibleItems: normalizedItems.slice(startIndex, endIndex),
  };
}

export function createDefaultMemoryViewerAgentViewState(tab = "tasks") {
  return {
    tab: normalizeMemoryViewerTab(tab),
    outboundAuditFocus: "all",
    searchQuery: "",
    taskStatus: "",
    taskSource: "",
    memoryType: "",
    memoryVisibility: "",
    memoryGovernance: "",
    sharedReviewGovernance: "pending",
    memoryCategory: "",
    sharedReviewFilters: {
      focus: "",
      targetAgentId: "",
      claimedByAgentId: "",
    },
    goalIdFilter: null,
  };
}

export function normalizeMemoryViewerAgentViewState(value, fallbackTab = "tasks") {
  const fallback = createDefaultMemoryViewerAgentViewState(fallbackTab);
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const sharedReviewFilters = value.sharedReviewFilters && typeof value.sharedReviewFilters === "object"
    ? value.sharedReviewFilters
    : {};
  return {
    tab: normalizeMemoryViewerTab(value.tab, fallback.tab),
    outboundAuditFocus: normalizeOutboundAuditFocus(value.outboundAuditFocus),
    searchQuery: normalizeMemoryViewerTextFilter(value.searchQuery),
    taskStatus: normalizeMemoryViewerTextFilter(value.taskStatus),
    taskSource: normalizeMemoryViewerTextFilter(value.taskSource),
    memoryType: normalizeMemoryViewerTextFilter(value.memoryType),
    memoryVisibility: normalizeMemoryViewerTextFilter(value.memoryVisibility),
    memoryGovernance: normalizeMemoryViewerTextFilter(value.memoryGovernance),
    sharedReviewGovernance: normalizeMemoryViewerTextFilter(value.sharedReviewGovernance) || fallback.sharedReviewGovernance,
    memoryCategory: normalizeMemoryViewerTextFilter(value.memoryCategory),
    sharedReviewFilters: {
      focus: normalizeSharedReviewFocus(sharedReviewFilters.focus),
      targetAgentId: normalizeMemoryViewerTextFilter(sharedReviewFilters.targetAgentId),
      claimedByAgentId: normalizeMemoryViewerTextFilter(sharedReviewFilters.claimedByAgentId),
    },
    goalIdFilter: normalizeMemoryViewerGoalId(value.goalIdFilter),
  };
}

export function extractTaskContextTargets(task) {
  const memoryIds = collectUniqueNonEmptyStrings(
    (Array.isArray(task?.memoryLinks) ? task.memoryLinks : []).map((item) => item?.chunkId),
  );
  const artifactPaths = collectUniqueNonEmptyStrings(task?.artifactPaths);
  const candidateIds = collectUniqueNonEmptyStrings([
    ...(Array.isArray(task?.usedMethods) ? task.usedMethods : []).map((item) => item?.sourceCandidateId),
    ...(Array.isArray(task?.usedSkills) ? task.usedSkills : []).map((item) => item?.sourceCandidateId),
  ]);
  return {
    firstMemoryId: memoryIds[0] || "",
    memoryCount: memoryIds.length,
    firstArtifactPath: artifactPaths[0] || "",
    artifactCount: artifactPaths.length,
    firstCandidateId: candidateIds[0] || "",
    candidateCount: candidateIds.length,
  };
}

export function extractCandidateContextTargets(candidate) {
  const snapshot = candidate?.sourceTaskSnapshot || {};
  const memoryIds = collectUniqueNonEmptyStrings(
    (Array.isArray(snapshot.memoryLinks) ? snapshot.memoryLinks : []).map((item) => item?.chunkId),
  );
  const artifactPaths = collectUniqueNonEmptyStrings(snapshot.artifactPaths);
  return {
    sourceTaskId: typeof candidate?.taskId === "string" ? candidate.taskId.trim() : "",
    sourceConversationId: typeof snapshot?.conversationId === "string" ? snapshot.conversationId.trim() : "",
    firstMemoryId: memoryIds[0] || "",
    memoryCount: memoryIds.length,
    firstArtifactPath: artifactPaths[0] || "",
    artifactCount: artifactPaths.length,
    publishedPath: typeof candidate?.publishedPath === "string" ? candidate.publishedPath.trim() : "",
  };
}

export function createMemoryViewerFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getMemoryViewerState,
  getSelectedAgentId,
  getSelectedAgentLabel,
  getAvailableAgents,
  syncMemoryTaskGoalFilterUi,
  renderMemoryViewerListEmpty,
  renderMemoryViewerDetailEmpty,
  loadTaskDetail,
  loadMemoryDetail,
  escapeHtml,
  formatCount,
  formatDateTime,
  formatDuration,
  formatLineRange,
  formatScore,
  formatMemoryCategory,
  normalizeMemoryVisibility,
  getVisibilityBadgeClass,
  summarizeSourcePath,
  getTaskGoalId,
  getGoalDisplayName,
  getLatestExperienceUsageTimestamp,
  getActiveMemoryCategoryLabel,
  renderMemoryCategoryDistribution,
  renderTaskUsageOverviewCard,
  bindStatsAuditJumpLinks,
  bindMemoryPathLinks,
  bindTaskAuditJumpLinks,
  openConversationSession,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    memoryViewerSection,
    memoryViewerTitleEl,
    memoryViewerStatsEl,
    memoryViewerListEl,
    memoryViewerDetailEl,
    memoryDreamModalTriggerBtn,
    memoryDreamModalEl,
    memoryDreamModalTitleEl,
    memoryDreamModalCloseBtn,
    memoryDreamBarEl,
    memoryDreamStatusEl,
    memoryDreamMetaEl,
    memoryDreamObsidianEl,
    memoryDreamSummaryEl,
    memoryDreamRefreshBtn,
    memoryDreamRunBtn,
    memoryDreamHistoryToggleBtn,
    memoryDreamHistoryEl,
    memoryDreamHistoryStatusEl,
    memoryDreamHistoryRefreshBtn,
    memoryDreamHistoryListEl,
    memoryDreamHistoryDetailEl,
    memoryTabTasksBtn,
    memoryTabMemoriesBtn,
    memoryTabSharedReviewBtn,
    memoryTabOutboundAuditBtn,
    memoryOutboundAuditFiltersEl,
    memoryOutboundAuditFocusAllBtn,
    memoryOutboundAuditFocusThreadsBtn,
    memorySharedReviewBatchBarEl,
    memoryTaskFiltersEl,
    memoryChunkFiltersEl,
    memorySearchInputEl,
    memoryDedupPreviewBtn,
    memoryTaskStatusFilterEl,
    memoryTaskSourceFilterEl,
    memoryChunkTypeFilterEl,
    memoryChunkVisibilityFilterEl,
    memoryChunkGovernanceFilterEl,
    memoryChunkCategoryFilterEl,
    memorySharedReviewFiltersEl,
    memorySharedReviewFocusFilterEl,
    memorySharedReviewTargetFilterEl,
    memorySharedReviewClaimedByFilterEl,
    memoryDedupModalEl,
    memoryDedupModalTitleEl,
    memoryDedupModalSummaryEl,
    memoryDedupModalStatusEl,
    memoryDedupModalWarningEl,
    memoryDedupModalListEl,
    memoryDedupModalCloseBtn,
    memoryDedupModalCancelBtn,
    memoryDedupModalSubmitBtn,
  } = refs;
  const autoRequestedEmailThreadAdvice = new Set();
  let dreamModalOpen = false;

  function getActiveAgentId() {
    const agentId = typeof getSelectedAgentId === "function" ? String(getSelectedAgentId() || "").trim() : "";
    return agentId || "default";
  }

  function getDedupModalState() {
    const memoryViewerState = getMemoryViewerState();
    if (!memoryViewerState.dedupModal || typeof memoryViewerState.dedupModal !== "object") {
      memoryViewerState.dedupModal = {
        open: false,
        loading: false,
        applying: false,
        error: "",
        report: null,
        result: null,
      };
    }
    return memoryViewerState.dedupModal;
  }

  function buildCurrentMemoryDedupFilter() {
    if (getMemoryViewerState().tab !== "memories") {
      return undefined;
    }
    const filter = {};
    const type = typeof memoryChunkTypeFilterEl?.value === "string" ? memoryChunkTypeFilterEl.value.trim() : "";
    const governance = typeof memoryChunkGovernanceFilterEl?.value === "string" ? memoryChunkGovernanceFilterEl.value.trim() : "";
    const category = typeof memoryChunkCategoryFilterEl?.value === "string" ? memoryChunkCategoryFilterEl.value.trim() : "";
    if (type) filter.memoryType = type;
    if (governance) filter.sharedPromotionStatus = governance;
    if (category === "uncategorized") {
      filter.uncategorized = true;
    } else if (category) {
      filter.category = category;
    }
    return Object.keys(filter).length ? filter : undefined;
  }

  function closeDedupModal() {
    const modalState = getDedupModalState();
    if (modalState.applying) return;
    modalState.open = false;
    renderDedupModal();
  }

  function formatDedupPreviewItem(item) {
    if (!item || typeof item !== "object") return "-";
    const sourcePath = typeof item.sourcePath === "string" && item.sourcePath.trim()
      ? summarizeSourcePath(item.sourcePath.trim())
      : "-";
    const taskLinkCount = Number.isFinite(Number(item.taskLinkCount)) ? Number(item.taskLinkCount) : 0;
    const lines = formatLineRange(item.startLine, item.endLine);
    return `${sourcePath} · ${formatMemoryTypeLabel(item.memoryType)} · ${lines} · links ${formatCount(taskLinkCount)}`;
  }

  function renderDedupModal() {
    if (
      !memoryDedupModalEl
      || !memoryDedupModalTitleEl
      || !memoryDedupModalSummaryEl
      || !memoryDedupModalStatusEl
      || !memoryDedupModalWarningEl
      || !memoryDedupModalListEl
      || !memoryDedupModalSubmitBtn
      || !memoryDedupModalCancelBtn
      || !memoryDedupModalCloseBtn
    ) {
      return;
    }

    const modalState = getDedupModalState();
    const report = modalState.report && typeof modalState.report === "object" ? modalState.report : null;
    const result = modalState.result && typeof modalState.result === "object" ? modalState.result : null;
    const totals = report?.totals && typeof report.totals === "object" ? report.totals : null;
    const applyTotals = result?.totals && typeof result.totals === "object" ? result.totals : null;
    const statusText = modalState.loading
      ? t("memory.dedupScanning", {}, "正在扫描重复记忆…")
      : modalState.applying
        ? t("memory.dedupApplying", {}, "正在执行清理并生成备份…")
        : modalState.error
          ? modalState.error
          : result
            ? t(
              "memory.dedupAppliedStatus",
              {
                removed: formatCount(applyTotals?.removedChunks),
                relinked: formatCount(applyTotals?.relinkedTaskMemoryLinks),
              },
              `已完成清理：删除 ${formatCount(applyTotals?.removedChunks)} 条重复 chunk，迁移 ${formatCount(applyTotals?.relinkedTaskMemoryLinks)} 条 task link。`,
            )
            : report
              ? t(
                "memory.dedupPreviewStatus",
                {
                  groups: formatCount(totals?.duplicateGroups),
                  removable: formatCount(totals?.removableChunks),
                },
                `预检完成：发现 ${formatCount(totals?.duplicateGroups)} 个重复组，可移除 ${formatCount(totals?.removableChunks)} 条重复 chunk。`,
              )
              : "";
    const warningText = result?.backupPath
      ? `已生成备份：${result.backupPath}`
      : t(
        "memory.dedupBackupHint",
        {},
        "确认清理后会先备份 memory.sqlite，再执行删除。当前确认只影响筛选范围内的 exact duplicate。",
      );

    memoryDedupModalEl.classList.toggle("hidden", !modalState.open);
    memoryDedupModalTitleEl.textContent = result
      ? t("memory.dedupModalResultTitle", {}, "记忆重复清理结果")
      : t("memory.dedupModalTitle", {}, "记忆重复预检");
    memoryDedupModalSummaryEl.innerHTML = `
      <div class="memory-detail-card">
        <span class="memory-detail-label">扫描范围</span>
        <div class="memory-detail-text">${escapeHtml(report?.filter ? "当前记忆筛选结果" : "全部记忆条目")}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">扫描 chunk</span>
        <div class="memory-detail-text">${escapeHtml(formatCount(result ? applyTotals?.scannedChunks : totals?.scannedChunks))}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">重复组</span>
        <div class="memory-detail-text">${escapeHtml(formatCount(result ? applyTotals?.duplicateGroups : totals?.duplicateGroups))}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">可移除 chunk</span>
        <div class="memory-detail-text">${escapeHtml(formatCount(result ? applyTotals?.removedChunks : totals?.removableChunks))}</div>
      </div>
      <div class="memory-detail-card">
        <span class="memory-detail-label">受影响 task links</span>
        <div class="memory-detail-text">${escapeHtml(formatCount(result ? applyTotals?.relinkedTaskMemoryLinks : totals?.affectedTaskLinkCount))}</div>
      </div>
    `;
    memoryDedupModalStatusEl.classList.toggle("hidden", !statusText);
    memoryDedupModalStatusEl.textContent = statusText;
    memoryDedupModalWarningEl.classList.toggle("hidden", !warningText);
    memoryDedupModalWarningEl.innerHTML = warningText ? `<div>${escapeHtml(warningText)}</div>` : "";

    if (modalState.loading) {
      memoryDedupModalListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("memory.dedupPreviewLoading", {}, "正在生成 dry-run 报告…"))}</div>`;
    } else if (result && Array.isArray(result.groups) && result.groups.length) {
      memoryDedupModalListEl.innerHTML = result.groups.map((group) => `
        <div class="experience-synthesis-row">
          <div class="experience-synthesis-row-main">
            <div class="experience-synthesis-row-title">keeper ${escapeHtml(group.keepChunkId || "-")}</div>
            <div class="experience-synthesis-row-meta">
              <span>删除 ${escapeHtml(formatCount(Array.isArray(group.removedChunkIds) ? group.removedChunkIds.length : 0))}</span>
              <span>迁移 links ${escapeHtml(formatCount(group.relinkedTaskMemoryLinks))}</span>
            </div>
            <div class="memory-list-item-snippet">${escapeHtml((group.removedChunkIds || []).join(", ") || "-")}</div>
          </div>
        </div>
      `).join("");
    } else if (report && Array.isArray(report.groups) && report.groups.length) {
      memoryDedupModalListEl.innerHTML = report.groups.map((group) => `
        <div class="experience-synthesis-row">
          <div class="experience-synthesis-row-main">
            <div class="experience-synthesis-row-title">${escapeHtml(group.preview || group.normalizedHash || "-")}</div>
            <div class="experience-synthesis-row-meta">
              <span>keeper</span>
              <span>${escapeHtml(formatDedupPreviewItem(group.keep))}</span>
            </div>
            <div class="memory-list-item-snippet">${escapeHtml((group.remove || []).map((item) => formatDedupPreviewItem(item)).join(" | "))}</div>
          </div>
        </div>
      `).join("");
    } else if (report) {
      memoryDedupModalListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("memory.dedupPreviewEmpty", {}, "当前筛选范围内没有发现 exact duplicate。"))}</div>`;
    } else {
      memoryDedupModalListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("memory.dedupPreviewIdle", {}, "尚未生成预检报告。"))}</div>`;
    }

    memoryDedupModalSubmitBtn.textContent = result
      ? t("memory.dedupModalApplied", {}, "清理已完成")
      : t("memory.dedupModalApply", {}, "确认清理");
    memoryDedupModalSubmitBtn.disabled = modalState.loading || modalState.applying || !report || (Array.isArray(report?.groups) ? report.groups.length <= 0 : true) || Boolean(result);
    memoryDedupModalCancelBtn.disabled = modalState.applying;
    memoryDedupModalCloseBtn.disabled = modalState.applying;
  }

  if (memoryDedupModalCloseBtn) {
    memoryDedupModalCloseBtn.addEventListener("click", () => {
      closeDedupModal();
    });
  }
  if (memoryDedupModalCancelBtn) {
    memoryDedupModalCancelBtn.addEventListener("click", () => {
      closeDedupModal();
    });
  }
  if (memoryDedupModalSubmitBtn) {
    memoryDedupModalSubmitBtn.addEventListener("click", () => {
      void applyDedupFromModal();
    });
  }
  if (memoryDedupModalEl) {
    memoryDedupModalEl.addEventListener("click", (event) => {
      if (event.target === memoryDedupModalEl) {
        closeDedupModal();
      }
    });
  }

  async function openDedupModal() {
    const modalState = getDedupModalState();
    modalState.open = true;
    modalState.loading = true;
    modalState.applying = false;
    modalState.error = "";
    modalState.report = null;
    modalState.result = null;
    renderDedupModal();

    if (!isConnected()) {
      modalState.loading = false;
      modalState.error = t("memory.dedupPreviewDisconnected", {}, "当前未连接到服务器，无法执行重复预检。");
      renderDedupModal();
      return null;
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.dedup.preview",
      params: {
        agentId: getActiveAgentId(),
        filter: buildCurrentMemoryDedupFilter(),
      },
    });
    modalState.loading = false;
    if (!res?.ok) {
      modalState.error = res?.error?.message || t("memory.dedupPreviewFailed", {}, "重复预检失败。");
      renderDedupModal();
      return null;
    }
    modalState.report = res.payload?.report ?? null;
    renderDedupModal();
    return modalState.report;
  }

  async function applyDedupFromModal() {
    const modalState = getDedupModalState();
    const report = modalState.report && typeof modalState.report === "object" ? modalState.report : null;
    if (!report || modalState.loading || modalState.applying || modalState.result) {
      return null;
    }
    if (!Array.isArray(report.groups) || report.groups.length <= 0) {
      modalState.error = t("memory.dedupApplyNothing", {}, "当前没有可清理的重复组。");
      renderDedupModal();
      return null;
    }
    modalState.applying = true;
    modalState.error = "";
    renderDedupModal();
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.dedup.apply",
      params: {
        agentId: getActiveAgentId(),
        filter: buildCurrentMemoryDedupFilter(),
        confirmed: true,
      },
    });
    modalState.applying = false;
    if (!res?.ok) {
      modalState.error = res?.error?.message || t("memory.dedupApplyFailed", {}, "重复清理失败。");
      renderDedupModal();
      return null;
    }
    modalState.result = res.payload?.result ?? null;
    renderDedupModal();
    showNotice?.(
      t("memory.dedupNoticeTitle", {}, "记忆重复清理已完成"),
      modalState.result?.backupPath || "已生成备份并完成清理。",
      "success",
      3200,
    );
    await loadMemoryViewer(true);
    return modalState.result;
  }

  function ensureListPageByTab() {
    const memoryViewerState = getMemoryViewerState();
    if (!memoryViewerState.listPageByTab || typeof memoryViewerState.listPageByTab !== "object") {
      memoryViewerState.listPageByTab = {};
    }
    return memoryViewerState.listPageByTab;
  }

  function getStoredListPage(tab = getMemoryViewerState().tab) {
    return normalizeMemoryViewerListPage(ensureListPageByTab()[normalizeMemoryViewerTab(tab)]);
  }

  function setStoredListPage(page, tab = getMemoryViewerState().tab) {
    ensureListPageByTab()[normalizeMemoryViewerTab(tab)] = normalizeMemoryViewerListPage(page);
  }

  function resetStoredListPage(tab = getMemoryViewerState().tab) {
    setStoredListPage(0, tab);
  }

  function resolveMemoryViewerPagination(items, resolveItemId, options = {}) {
    const memoryViewerState = getMemoryViewerState();
    const tab = normalizeMemoryViewerTab(memoryViewerState.tab);
    let page = getStoredListPage(tab);
    const pageSize = getMemoryViewerListPageSize(tab);
    if (options.alignToSelected === true) {
      const selectedId = typeof memoryViewerState.selectedId === "string" ? memoryViewerState.selectedId.trim() : "";
      if (selectedId) {
        const selectedIndex = (Array.isArray(items) ? items : []).findIndex((item, index) => resolveItemId(item, index) === selectedId);
        if (selectedIndex >= 0) {
          page = Math.floor(selectedIndex / pageSize);
        }
      }
    }
    const pagination = paginateMemoryViewerItems(items, { page, pageSize });
    setStoredListPage(pagination.currentPage, tab);
    return pagination;
  }

  function renderMemoryViewerPaginationFooter(pagination) {
    if (!pagination?.hasPagination) {
      return "";
    }
    return `
      <div class="memory-list-pagination">
        <div class="memory-list-pagination-summary">${escapeHtml(t(
          "memory.paginationSummary",
          {
            start: formatCount(pagination.visibleStart),
            end: formatCount(pagination.visibleEnd),
            total: formatCount(pagination.totalItems),
            page: formatCount(pagination.currentPage + 1),
            pages: formatCount(pagination.totalPages),
          },
          `Showing ${formatCount(pagination.visibleStart)}-${formatCount(pagination.visibleEnd)} / ${formatCount(pagination.totalItems)} · Page ${formatCount(pagination.currentPage + 1)} of ${formatCount(pagination.totalPages)}`,
        ))}</div>
        <div class="memory-list-pagination-actions">
          <button
            class="memory-usage-action-btn"
            data-memory-list-page-action="prev"
            ${pagination.currentPage <= 0 ? "disabled" : ""}
          >${escapeHtml(t("memory.paginationPrev", {}, "Prev"))}</button>
          <button
            class="memory-usage-action-btn"
            data-memory-list-page-action="next"
            ${pagination.currentPage >= pagination.totalPages - 1 ? "disabled" : ""}
          >${escapeHtml(t("memory.paginationNext", {}, "Next"))}</button>
        </div>
      </div>
    `;
  }

  function bindMemoryViewerPaginationControls({
    items,
    pagination,
    renderList,
    resolveItemId,
    onPageSelected,
  }) {
    if (!memoryViewerListEl || !pagination?.hasPagination) return;
    memoryViewerListEl.querySelectorAll("[data-memory-list-page-action]").forEach((node) => {
      node.addEventListener("click", async () => {
        const action = node.getAttribute("data-memory-list-page-action");
        const delta = action === "prev" ? -1 : action === "next" ? 1 : 0;
        if (!delta) return;
        const nextPage = pagination.currentPage + delta;
        if (nextPage < 0 || nextPage >= pagination.totalPages) return;
        setStoredListPage(nextPage);
        const nextPagination = resolveMemoryViewerPagination(items, resolveItemId, { alignToSelected: false });
        const nextSelectedItem = nextPagination.visibleItems[0] ?? null;
        if (nextSelectedItem) {
          const nextSelectedId = resolveItemId(nextSelectedItem, nextPagination.startIndex);
          getMemoryViewerState().selectedId = nextSelectedId || null;
        }
        renderList(items);
        if (nextSelectedItem && typeof onPageSelected === "function") {
          await onPageSelected(nextSelectedItem, resolveItemId(nextSelectedItem, nextPagination.startIndex), nextPagination);
        }
      });
    });
  }

  function getCurrentVisibleSharedReviewItems(items) {
    return resolveMemoryViewerPagination(
      items,
      (item) => String(item?.id || "").trim(),
      { alignToSelected: false },
    ).visibleItems;
  }

  async function requestEmailThreadConversationAdvice(conversationId, item) {
    const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!normalizedConversationId || autoRequestedEmailThreadAdvice.has(normalizedConversationId)) {
      return;
    }
    if (typeof isConnected === "function" && !isConnected()) {
      showNotice?.(
        t("memory.emailThreadOrganizerAdviceRequestOfflineTitle", {}, "未连接到服务器"),
        t("memory.emailThreadOrganizerAdviceRequestOfflineMessage", {}, "已打开线程会话，但当前没有自动请求新的处理建议。请先连接后重试。"),
        "error",
      );
      return;
    }
    autoRequestedEmailThreadAdvice.add(normalizedConversationId);
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "message.send",
        params: {
          conversationId: normalizedConversationId,
          text: buildEmailThreadConversationAdvicePrompt(item, t),
          from: "web",
          clientContext: {
            sentAtMs: Date.now(),
            timezoneOffsetMinutes: new Date().getTimezoneOffset(),
            locale: typeof navigator !== "undefined" ? navigator.language : undefined,
          },
          roomContext: { environment: "local" },
          agentId: getActiveAgentId(),
          attachments: [],
        },
      });
      if (res?.ok === false) {
        autoRequestedEmailThreadAdvice.delete(normalizedConversationId);
        showNotice?.(
          t("memory.emailThreadOrganizerAdviceRequestFailedTitle", {}, "线程建议请求失败"),
          res?.error?.message || t("memory.emailThreadOrganizerAdviceRequestFailedMessage", {}, "message.send 调用失败。"),
          "error",
        );
      }
    } catch (error) {
      autoRequestedEmailThreadAdvice.delete(normalizedConversationId);
      showNotice?.(
        t("memory.emailThreadOrganizerAdviceRequestFailedTitle", {}, "线程建议请求失败"),
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  function ensureAgentViewStates() {
    const memoryViewerState = getMemoryViewerState();
    if (!memoryViewerState.agentViewStates || typeof memoryViewerState.agentViewStates !== "object") {
      memoryViewerState.agentViewStates = {};
    }
    return memoryViewerState.agentViewStates;
  }

  function captureAgentViewState(agentId = getMemoryViewerState().activeAgentId || getActiveAgentId()) {
    const normalizedAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
    const memoryViewerState = getMemoryViewerState();
    const existingView = normalizeMemoryViewerAgentViewState(
      ensureAgentViewStates()[normalizedAgentId],
      memoryViewerState.tab,
    );
    const nextView = {
      ...existingView,
      tab: memoryViewerState.tab,
      outboundAuditFocus: normalizeOutboundAuditFocus(memoryViewerState.outboundAuditFocus),
      searchQuery: memorySearchInputEl?.value,
      taskStatus: memoryTaskStatusFilterEl?.value,
      taskSource: memoryTaskSourceFilterEl?.value,
      memoryType: memoryChunkTypeFilterEl?.value,
      memoryVisibility: memoryChunkVisibilityFilterEl?.value,
      memoryCategory: memoryChunkCategoryFilterEl?.value,
      sharedReviewFilters: getSharedReviewFilters(),
      goalIdFilter: memoryViewerState.goalIdFilter,
    };
    if (memoryViewerState.tab === "sharedReview") {
      nextView.sharedReviewGovernance = memoryChunkGovernanceFilterEl?.value;
    } else {
      nextView.memoryGovernance = memoryChunkGovernanceFilterEl?.value;
    }
    ensureAgentViewStates()[normalizedAgentId] = normalizeMemoryViewerAgentViewState(nextView, memoryViewerState.tab);
  }

  function applyAgentViewState(agentId = getActiveAgentId(), fallbackTab = getMemoryViewerState().tab) {
    const normalizedAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
    const memoryViewerState = getMemoryViewerState();
    const nextView = normalizeMemoryViewerAgentViewState(
      ensureAgentViewStates()[normalizedAgentId],
      fallbackTab,
    );

    memoryViewerState.tab = nextView.tab;
    memoryViewerState.outboundAuditFocus = nextView.outboundAuditFocus;
    memoryViewerState.goalIdFilter = nextView.goalIdFilter;
    memoryViewerState.sharedReviewFilters = { ...nextView.sharedReviewFilters };

    if (memorySearchInputEl) memorySearchInputEl.value = nextView.searchQuery;
    if (memoryTaskStatusFilterEl) memoryTaskStatusFilterEl.value = nextView.taskStatus;
    if (memoryTaskSourceFilterEl) memoryTaskSourceFilterEl.value = nextView.taskSource;
    if (memoryChunkTypeFilterEl) memoryChunkTypeFilterEl.value = nextView.memoryType;
    if (memoryChunkVisibilityFilterEl) memoryChunkVisibilityFilterEl.value = nextView.memoryVisibility;
    if (memoryChunkGovernanceFilterEl) {
      memoryChunkGovernanceFilterEl.value = nextView.tab === "sharedReview"
        ? (nextView.sharedReviewGovernance || "pending")
        : nextView.memoryGovernance;
    }
    if (memoryChunkCategoryFilterEl) memoryChunkCategoryFilterEl.value = nextView.memoryCategory;
    syncSharedReviewFilterUi();
  }

  function getOutboundAuditFocus() {
    return normalizeOutboundAuditFocus(getMemoryViewerState().outboundAuditFocus);
  }

  function buildScopedParams(params = {}, agentId = getActiveAgentId()) {
    return {
      ...params,
      agentId,
    };
  }

  function getSharedReviewFilters() {
    const memoryViewerState = getMemoryViewerState();
    const existing = memoryViewerState.sharedReviewFilters;
    if (existing && typeof existing === "object") {
      return {
        focus: normalizeSharedReviewFocus(existing.focus),
        targetAgentId: typeof existing.targetAgentId === "string" ? existing.targetAgentId.trim() : "",
        claimedByAgentId: typeof existing.claimedByAgentId === "string" ? existing.claimedByAgentId.trim() : "",
      };
    }
    const fallback = { focus: "", targetAgentId: "", claimedByAgentId: "" };
    memoryViewerState.sharedReviewFilters = fallback;
    return fallback;
  }

  function getSharedReviewAgentOptions() {
    const stateFilters = getSharedReviewFilters();
    const map = new Map();
    const availableAgents = typeof getAvailableAgents === "function" ? getAvailableAgents() : [];
    for (const agent of Array.isArray(availableAgents) ? availableAgents : []) {
      if (!agent || typeof agent !== "object") continue;
      const id = typeof agent.id === "string" ? agent.id.trim() : "";
      if (!id) continue;
      const label = typeof agent.displayName === "string" && agent.displayName.trim()
        ? agent.displayName.trim()
        : typeof agent.name === "string" && agent.name.trim()
          ? agent.name.trim()
          : id;
      map.set(id, label);
    }

    for (const id of [getActiveAgentId(), stateFilters.targetAgentId, stateFilters.claimedByAgentId]) {
      if (typeof id === "string" && id.trim() && !map.has(id.trim())) {
        map.set(id.trim(), id.trim());
      }
    }

    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }

  function buildSelectOptionsHtml(options, fallbackLabel) {
    return options.map((option) => {
      const value = typeof option?.value === "string" ? option.value : "";
      const label = typeof option?.label === "string" && option.label.trim() ? option.label.trim() : fallbackLabel;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join("");
  }

  function getSelectedSharedReviewIds() {
    const memoryViewerState = getMemoryViewerState();
    return Array.isArray(memoryViewerState.selectedSharedReviewIds)
      ? memoryViewerState.selectedSharedReviewIds.filter((item) => typeof item === "string" && item.trim())
      : [];
  }

  function setSelectedSharedReviewIds(nextIds) {
    const memoryViewerState = getMemoryViewerState();
    const deduped = [];
    const seen = new Set();
    for (const id of Array.isArray(nextIds) ? nextIds : []) {
      const normalized = typeof id === "string" ? id.trim() : "";
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
    }
    memoryViewerState.selectedSharedReviewIds = deduped;
  }

  function syncSelectedSharedReviewIds(items = []) {
    const validIds = new Set((Array.isArray(items) ? items : []).map((item) => String(item?.id || "").trim()).filter(Boolean));
    setSelectedSharedReviewIds(getSelectedSharedReviewIds().filter((id) => validIds.has(id)));
  }

  function toggleSharedReviewSelection(chunkId, checked) {
    const targetId = typeof chunkId === "string" ? chunkId.trim() : "";
    if (!targetId) return;
    const selectedIds = new Set(getSelectedSharedReviewIds());
    if (checked) {
      selectedIds.add(targetId);
    } else {
      selectedIds.delete(targetId);
    }
    setSelectedSharedReviewIds([...selectedIds]);
  }

  function selectAllVisibleSharedReviewItems() {
    const memoryViewerState = getMemoryViewerState();
    const itemIds = getCurrentVisibleSharedReviewItems(Array.isArray(memoryViewerState.items) ? memoryViewerState.items : [])
      .map((item) => String(item?.id || "").trim())
      .filter(Boolean);
    setSelectedSharedReviewIds(itemIds);
  }

  function selectActionableSharedReviewItems() {
    const memoryViewerState = getMemoryViewerState();
    const items = getCurrentVisibleSharedReviewItems(Array.isArray(memoryViewerState.items) ? memoryViewerState.items : []);
    setSelectedSharedReviewIds(collectActionableSharedReviewIds(items, getActiveAgentId()));
  }

  function clearSharedReviewSelection() {
    setSelectedSharedReviewIds([]);
  }

  function syncSharedReviewFilterUi() {
    const stateFilters = getSharedReviewFilters();
    if (memorySharedReviewFocusFilterEl) {
      memorySharedReviewFocusFilterEl.value = stateFilters.focus;
    }

    const agentOptions = getSharedReviewAgentOptions();
    if (memorySharedReviewTargetFilterEl) {
      const options = [
        { value: "", label: t("memory.sharedReviewTargetAll", {}, "All Target Agents") },
        ...agentOptions.map((agent) => ({ value: agent.id, label: agent.label })),
      ];
      memorySharedReviewTargetFilterEl.innerHTML = buildSelectOptionsHtml(options, "-");
      memorySharedReviewTargetFilterEl.value = stateFilters.targetAgentId;
    }
    if (memorySharedReviewClaimedByFilterEl) {
      const options = [
        { value: "", label: t("memory.sharedReviewClaimedByAll", {}, "All Claim Owners") },
        ...agentOptions.map((agent) => ({ value: agent.id, label: agent.label })),
      ];
      memorySharedReviewClaimedByFilterEl.innerHTML = buildSelectOptionsHtml(options, "-");
      memorySharedReviewClaimedByFilterEl.value = stateFilters.claimedByAgentId;
    }
  }

  function renderSharedReviewBatchBar() {
    if (!memorySharedReviewBatchBarEl) return;
    const memoryViewerState = getMemoryViewerState();
    const isSharedReview = memoryViewerState.tab === "sharedReview";
    const items = getCurrentVisibleSharedReviewItems(Array.isArray(memoryViewerState.items) ? memoryViewerState.items : []);
    if (!isSharedReview || !items.length) {
      memorySharedReviewBatchBarEl.classList.add("hidden");
      memorySharedReviewBatchBarEl.innerHTML = "";
      return;
    }

    const batchState = buildSharedReviewBatchActionState(items, getSelectedSharedReviewIds(), getActiveAgentId());
    const busy = memoryViewerState.sharedReviewBatchBusy === true;
    const actionButtons = [
      {
        key: "claim",
        label: t("memory.shareClaimAction", {}, "Claim"),
        count: batchState.actions.claim.length,
      },
      {
        key: "release",
        label: t("memory.shareReleaseAction", {}, "Release"),
        count: batchState.actions.release.length,
      },
      {
        key: "approved",
        label: t("memory.shareReviewApproveAction", {}, "Approve"),
        count: batchState.actions.approved.length,
      },
      {
        key: "rejected",
        label: t("memory.shareReviewRejectAction", {}, "Reject"),
        count: batchState.actions.rejected.length,
      },
      {
        key: "revoked",
        label: t("memory.shareReviewRevokeAction", {}, "Revoke Shared"),
        count: batchState.actions.revoked.length,
      },
    ];

    memorySharedReviewBatchBarEl.classList.remove("hidden");
    memorySharedReviewBatchBarEl.innerHTML = `
      <div class="memory-shared-review-batch-summary">
        ${escapeHtml(t(
          "memory.sharedReviewBatchSummary",
          {
            selected: formatCount(batchState.selectedCount),
            total: formatCount(batchState.totalVisible),
          },
          `Selected ${formatCount(batchState.selectedCount)} / ${formatCount(batchState.totalVisible)}`,
        ))}
      </div>
      <div class="memory-shared-review-batch-actions">
        <button class="memory-usage-action-btn" data-shared-review-batch-select="all" ${busy ? "disabled" : ""}>${escapeHtml(t("memory.sharedReviewSelectAllVisible", {}, "Select Visible"))}</button>
        <button class="memory-usage-action-btn" data-shared-review-batch-select="actionable" ${busy ? "disabled" : ""}>${escapeHtml(t("memory.sharedReviewSelectActionable", {}, "Select Actionable"))}</button>
        <button class="memory-usage-action-btn" data-shared-review-batch-select="clear" ${(busy || batchState.selectedCount <= 0) ? "disabled" : ""}>${escapeHtml(t("memory.sharedReviewClearSelection", {}, "Clear Selection"))}</button>
        ${actionButtons.map((action) => `
          <button
            class="memory-usage-action-btn"
            data-shared-review-batch-action="${escapeHtml(action.key)}"
            ${(busy || action.count <= 0) ? "disabled" : ""}
          >${escapeHtml(`${action.label} (${formatCount(action.count)})`)}</button>
        `).join("")}
      </div>
    `;

    memorySharedReviewBatchBarEl.querySelectorAll("[data-shared-review-batch-select]").forEach((node) => {
      node.addEventListener("click", () => {
        const mode = node.getAttribute("data-shared-review-batch-select");
        if (mode === "all") {
          selectAllVisibleSharedReviewItems();
        } else if (mode === "actionable") {
          selectActionableSharedReviewItems();
        } else {
          clearSharedReviewSelection();
        }
        renderSharedReviewList(items);
        renderSharedReviewBatchBar();
      });
    });

    memorySharedReviewBatchBarEl.querySelectorAll("[data-shared-review-batch-action]").forEach((node) => {
      node.addEventListener("click", () => {
        const action = node.getAttribute("data-shared-review-batch-action") || "";
        if (!action) return;
        void runSharedReviewBatchAction(action);
      });
    });
  }

  function createMemoryViewerRequestContext(existingContext = null) {
    if (
      existingContext
      && Number.isFinite(Number(existingContext.requestToken))
      && typeof existingContext.agentId === "string"
      && existingContext.agentId.trim()
    ) {
      return {
        requestToken: Number(existingContext.requestToken),
        agentId: existingContext.agentId.trim(),
      };
    }

    const memoryViewerState = getMemoryViewerState();
    const requestToken = Number(memoryViewerState.requestToken || 0) + 1;
    const agentId = getActiveAgentId();
    memoryViewerState.requestToken = requestToken;
    memoryViewerState.activeAgentId = agentId;
    return { requestToken, agentId };
  }

  function isMemoryViewerRequestCurrent(requestContext) {
    if (!requestContext) return false;
    const memoryViewerState = getMemoryViewerState();
    const activeAgentId = String(memoryViewerState.activeAgentId || getActiveAgentId()).trim() || "default";
    return Number(memoryViewerState.requestToken || 0) === Number(requestContext.requestToken)
      && activeAgentId === requestContext.agentId;
  }

  function renderSourceViewBadge(sourceView) {
    const label = formatResidentSourceScopeLabel(sourceView);
    return `<span class="memory-badge ${getResidentSourceBadgeClass(sourceView)}">${escapeHtml(label)}</span>`;
  }

  function getMemorySharePromotionMetadata(item) {
    const metadata = item?.metadata;
    if (!metadata || typeof metadata !== "object") return null;
    const promotion = metadata.sharedPromotion;
    return promotion && typeof promotion === "object" ? promotion : null;
  }

  function normalizeMemorySharePromotionStatus(item) {
    const promotion = getMemorySharePromotionMetadata(item);
    const status = typeof promotion?.status === "string" ? promotion.status.trim().toLowerCase() : "";
    if (status === "pending" || status === "approved" || status === "rejected" || status === "revoked" || status === "active") {
      return status;
    }
    return "";
  }

  function formatMemorySharePromotionStatusLabel(status) {
    if (status === "pending") return t("memory.shareStatusPending", {}, "pending");
    if (status === "approved" || status === "active") return t("memory.shareStatusApproved", {}, "approved");
    if (status === "rejected") return t("memory.shareStatusRejected", {}, "rejected");
    if (status === "revoked") return t("memory.shareStatusRevoked", {}, "revoked");
    return "-";
  }

  function formatSharedReviewBatchActionLabel(action) {
    if (action === "claim") return t("memory.shareClaimAction", {}, "Claim");
    if (action === "release") return t("memory.shareReleaseAction", {}, "Release");
    if (action === "approved") return t("memory.shareReviewApproveAction", {}, "Approve");
    if (action === "rejected") return t("memory.shareReviewRejectAction", {}, "Reject");
    if (action === "revoked") return t("memory.shareReviewRevokeAction", {}, "Revoke Shared");
    return action || "-";
  }

  function getMemoryShareActionMode(item) {
    const status = normalizeMemorySharePromotionStatus(item);
    if (!status || status === "rejected" || status === "revoked") return "request";
    if (status === "pending") return "pending";
    if (status === "approved" || status === "active") return "approved";
    return "request";
  }

  function formatSharedGovernanceSummary(item) {
    const promotion = getMemorySharePromotionMetadata(item);
    if (!promotion) {
      return t("memory.detailSharedGovernanceNone", {}, "This memory has not entered the shared review flow yet.");
    }
    const parts = [];
    const status = formatMemorySharePromotionStatusLabel(normalizeMemorySharePromotionStatus(item));
    if (status && status !== "-") {
      parts.push(`status=${status}`);
    }
    if (typeof promotion.sourceAgentId === "string" && promotion.sourceAgentId.trim()) {
      parts.push(`sourceAgent=${promotion.sourceAgentId.trim()}`);
    }
    const requestedAt = typeof promotion.requestedAt === "string" && promotion.requestedAt.trim()
      ? promotion.requestedAt.trim()
      : typeof promotion.promotedAt === "string" && promotion.promotedAt.trim()
        ? promotion.promotedAt.trim()
        : "";
    if (requestedAt) {
      parts.push(`requestedAt=${requestedAt}`);
    }
    if (typeof promotion.reason === "string" && promotion.reason.trim()) {
      parts.push(`reason=${promotion.reason.trim()}`);
    }
    if (typeof promotion.reviewerAgentId === "string" && promotion.reviewerAgentId.trim()) {
      parts.push(`reviewer=${promotion.reviewerAgentId.trim()}`);
    }
    if (typeof promotion.reviewedAt === "string" && promotion.reviewedAt.trim()) {
      parts.push(`reviewedAt=${promotion.reviewedAt.trim()}`);
    }
    if (typeof promotion.claimedByAgentId === "string" && promotion.claimedByAgentId.trim()) {
      parts.push(`claimedBy=${promotion.claimedByAgentId.trim()}`);
    }
    if (typeof promotion.claimedAt === "string" && promotion.claimedAt.trim()) {
      parts.push(`claimedAt=${promotion.claimedAt.trim()}`);
    }
    const claimState = getMemoryShareClaimState(item);
    if (claimState.claimTimedOut) {
      parts.push("claim=timed_out");
    }
    if (claimState.claimExpiresAt) {
      parts.push(`claimExpiresAt=${claimState.claimExpiresAt}`);
    }
    if (typeof promotion.decisionNote === "string" && promotion.decisionNote.trim()) {
      parts.push(`note=${promotion.decisionNote.trim()}`);
    }
    return parts.join(" | ");
  }

  function getMemoryShareScopeSourcePath(item) {
    const promotion = getMemorySharePromotionMetadata(item);
    if (typeof promotion?.sourcePath === "string" && promotion.sourcePath.trim()) {
      return promotion.sourcePath.trim();
    }
    return typeof item?.sourcePath === "string" ? item.sourcePath.trim() : "";
  }

  function getMemoryShareClaimOwner(item) {
    if (typeof item?.claimOwner === "string" && item.claimOwner.trim()) {
      return item.claimOwner.trim();
    }
    const promotion = getMemorySharePromotionMetadata(item);
    return typeof promotion?.claimedByAgentId === "string" ? promotion.claimedByAgentId.trim() : "";
  }

  function getMemoryShareClaimState(item) {
    const promotion = getMemorySharePromotionMetadata(item);
    return {
      claimOwner: getMemoryShareClaimOwner(item),
      claimedAt: typeof promotion?.claimedAt === "string" && promotion.claimedAt.trim()
        ? promotion.claimedAt.trim()
        : "",
      claimAgeMs: Number.isFinite(Number(item?.claimAgeMs)) ? Number(item.claimAgeMs) : null,
      claimExpiresAt: typeof item?.claimExpiresAt === "string" && item.claimExpiresAt.trim()
        ? item.claimExpiresAt.trim()
        : "",
      claimTimedOut: item?.claimTimedOut === true,
      actionableByReviewer: item?.actionableByReviewer === true,
      blockedByOtherReviewer: item?.blockedByOtherReviewer === true,
    };
  }

  function getMemoryShareTargetAgentId(item) {
    const promotion = getMemorySharePromotionMetadata(item);
    if (typeof item?.targetAgentId === "string" && item.targetAgentId.trim()) {
      return item.targetAgentId.trim();
    }
    if (typeof promotion?.sourceAgentId === "string" && promotion.sourceAgentId.trim()) {
      return promotion.sourceAgentId.trim();
    }
    return getActiveAgentId();
  }

  function normalizeResidentQueryMode(queryView) {
    const mode = typeof queryView?.mode === "string" ? queryView.mode.trim().toLowerCase() : "";
    if (mode === "isolated" || mode === "shared" || mode === "hybrid") {
      return mode;
    }
    const scope = typeof queryView?.scope === "string" ? queryView.scope.trim().toLowerCase() : "";
    if (scope === "shared" || scope === "hybrid") {
      return scope;
    }
    return "isolated";
  }

  function formatResidentQueryModeLabel(queryView) {
    return normalizeResidentQueryMode(queryView);
  }

  function formatGovernanceFilterLabel(value) {
    switch (String(value || "").trim()) {
      case "pending":
        return t("memory.filters.governancePending", {}, "Pending");
      case "approved":
        return t("memory.filters.governanceApproved", {}, "Approved");
      case "rejected":
        return t("memory.filters.governanceRejected", {}, "Rejected");
      case "revoked":
        return t("memory.filters.governanceRevoked", {}, "Revoked");
      case "none":
        return t("memory.filters.governanceNone", {}, "No Review");
      default:
        return t("memory.filters.governanceAll", {}, "All Governance States");
    }
  }

  function formatResidentQueryModeSummary(queryView) {
    const mode = normalizeResidentQueryMode(queryView);
    if (mode === "shared") {
      return t(
        "memory.queryModeSummaryShared",
        {},
        "Read from and write to the shared team memory layer.",
      );
    }
    if (mode === "hybrid") {
      return t(
        "memory.queryModeSummaryHybrid",
        {},
        "Write to private memory, then read from both private and shared layers.",
      );
    }
    return t(
      "memory.queryModeSummaryIsolated",
      {},
      "Read from and write to the active agent's private memory only.",
    );
  }

  function syncMemoryViewerHeaderTitle() {
    if (!memoryViewerTitleEl) return;
    const agentName = typeof getSelectedAgentLabel === "function"
      ? String(getSelectedAgentLabel() || "").trim()
      : "";
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.tab === "outboundAudit") {
      memoryViewerTitleEl.textContent = getOutboundAuditFocus() === "threads"
        ? t("memory.emailThreadOrganizerTitle", {}, "邮件线程整理")
        : t("memory.outboundAuditTitle", {}, "消息审计");
      return;
    }
    if (memoryViewerState.tab === "sharedReview") {
      memoryViewerTitleEl.textContent = agentName
        ? t("memory.sharedReviewTitleWithAgent", { agentName }, `${agentName} Shared Review Inbox`)
        : t("memory.sharedReviewTitle", {}, "Shared Review Inbox");
      return;
    }
    memoryViewerTitleEl.textContent = agentName
      ? t("memory.titleWithAgent", { agentName }, `${agentName} Memory Viewer`)
      : t("memory.title", {}, "Memory Viewer");
  }

  function renderDreamModal() {
    const triggerLabel = t("memory.dreamModalTrigger", {}, "梦境");
    const closeLabel = t("memory.dreamModalClose", {}, "关闭");
    if (memoryDreamModalTriggerBtn) {
      memoryDreamModalTriggerBtn.textContent = triggerLabel;
      memoryDreamModalTriggerBtn.title = t("memory.dreamModalOpenTitle", {}, "查看 Dream 运行状态与历史");
      memoryDreamModalTriggerBtn.setAttribute("aria-expanded", dreamModalOpen ? "true" : "false");
      memoryDreamModalTriggerBtn.setAttribute("aria-haspopup", "dialog");
    }
    if (memoryDreamModalTitleEl) {
      memoryDreamModalTitleEl.textContent = t("memory.dreamModalTitle", {}, "梦境");
    }
    if (memoryDreamModalCloseBtn) {
      memoryDreamModalCloseBtn.title = closeLabel;
      memoryDreamModalCloseBtn.setAttribute("aria-label", closeLabel);
    }
    if (memoryDreamModalEl) {
      memoryDreamModalEl.classList.toggle("hidden", !dreamModalOpen);
    }
  }

  function closeDreamModal() {
    if (!dreamModalOpen) return;
    dreamModalOpen = false;
    renderDreamModal();
  }

  function openDreamModal() {
    dreamModalOpen = true;
    renderDreamModal();
  }

  function renderDreamRuntimeBar() {
    if (!memoryDreamBarEl) return;
    const memoryViewerState = getMemoryViewerState();
    const barView = buildDreamRuntimeBarView({
      dreamRuntime: memoryViewerState.dreamRuntime,
      dreamCommons: memoryViewerState.dreamCommons,
      connected: typeof isConnected === "function" ? isConnected() : true,
      dreamBusy: memoryViewerState.dreamBusy === true,
    }, {
      t,
      formatDateTime,
      formatCount,
    });

    if (memoryDreamStatusEl) {
      memoryDreamStatusEl.textContent = barView.statusLine;
    }
    if (memoryDreamMetaEl) {
      memoryDreamMetaEl.textContent = barView.metaLine;
    }
    if (memoryDreamObsidianEl) {
      memoryDreamObsidianEl.textContent = barView.obsidianLine;
    }
    if (memoryDreamSummaryEl) {
      memoryDreamSummaryEl.textContent = barView.summaryLine;
    }
    if (memoryDreamRefreshBtn) {
      memoryDreamRefreshBtn.disabled = barView.refreshDisabled;
    }
    if (memoryDreamRunBtn) {
      memoryDreamRunBtn.disabled = barView.runDisabled;
      memoryDreamRunBtn.title = barView.runTitle;
    }
    renderDreamHistoryPanel();
  }

  function createDreamHistoryRequestContext(kind = "list", agentId = getActiveAgentId()) {
    const memoryViewerState = getMemoryViewerState();
    const normalizedKind = kind === "detail" ? "detail" : "list";
    const key = normalizedKind === "detail" ? "dreamHistoryDetailSeq" : "dreamHistorySeq";
    const nextSeq = Number(memoryViewerState[key] || 0) + 1;
    memoryViewerState[key] = nextSeq;
    return {
      kind: normalizedKind,
      seq: nextSeq,
      agentId,
    };
  }

  function isDreamHistoryRequestCurrent(requestContext) {
    const memoryViewerState = getMemoryViewerState();
    const key = requestContext?.kind === "detail" ? "dreamHistoryDetailSeq" : "dreamHistorySeq";
    const activeAgentId = String(memoryViewerState.activeAgentId || getActiveAgentId()).trim() || "default";
    return Number(memoryViewerState[key] || 0) === Number(requestContext?.seq || 0)
      && activeAgentId === requestContext?.agentId;
  }

  function clearDreamHistoryState({ preserveOpen = true } = {}) {
    const memoryViewerState = getMemoryViewerState();
    memoryViewerState.dreamHistoryOpen = preserveOpen ? memoryViewerState.dreamHistoryOpen === true : false;
    memoryViewerState.dreamHistoryLoading = false;
    memoryViewerState.dreamHistoryError = "";
    memoryViewerState.dreamHistoryItems = [];
    memoryViewerState.selectedDreamHistoryId = null;
    memoryViewerState.selectedDreamHistoryItem = null;
    memoryViewerState.selectedDreamHistoryContent = "";
    memoryViewerState.dreamHistoryDetailLoading = false;
    memoryViewerState.dreamHistoryDetailError = "";
    memoryViewerState.dreamHistorySeq = Number(memoryViewerState.dreamHistorySeq || 0) + 1;
    memoryViewerState.dreamHistoryDetailSeq = Number(memoryViewerState.dreamHistoryDetailSeq || 0) + 1;
  }

  function renderDreamHistoryPanel() {
    const memoryViewerState = getMemoryViewerState();
    const panelView = buildDreamHistoryPanelView({
      connected: typeof isConnected === "function" ? isConnected() : true,
      open: memoryViewerState.dreamHistoryOpen === true,
      loading: memoryViewerState.dreamHistoryLoading === true,
      error: memoryViewerState.dreamHistoryError,
      items: memoryViewerState.dreamHistoryItems,
      selectedId: memoryViewerState.selectedDreamHistoryId,
      selectedItem: memoryViewerState.selectedDreamHistoryItem,
      selectedContent: memoryViewerState.selectedDreamHistoryContent,
      detailLoading: memoryViewerState.dreamHistoryDetailLoading === true,
      detailError: memoryViewerState.dreamHistoryDetailError,
    }, {
      t,
      formatDateTime,
    });

    if (memoryDreamHistoryToggleBtn) {
      memoryDreamHistoryToggleBtn.textContent = panelView.toggleLabel;
      memoryDreamHistoryToggleBtn.title = panelView.toggleTitle;
      memoryDreamHistoryToggleBtn.setAttribute("aria-expanded", panelView.open ? "true" : "false");
    }
    if (!memoryDreamHistoryEl) return;
    memoryDreamHistoryEl.hidden = !panelView.open;
    memoryDreamHistoryEl.classList.toggle("hidden", !panelView.open);
    if (!panelView.open) return;

    if (memoryDreamHistoryStatusEl) {
      memoryDreamHistoryStatusEl.textContent = panelView.historyStatusLine;
    }
    if (memoryDreamHistoryRefreshBtn) {
      memoryDreamHistoryRefreshBtn.disabled = panelView.refreshDisabled;
    }
    if (memoryDreamHistoryListEl) {
      if (panelView.entries.length <= 0) {
        memoryDreamHistoryListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(panelView.listEmptyText)}</div>`;
      } else {
        memoryDreamHistoryListEl.innerHTML = panelView.entries.map((entry) => `
          <div class="memory-list-item ${entry.isActive ? "active" : ""}" data-dream-history-id="${escapeHtml(entry.id)}">
            <div class="memory-list-item-title">${escapeHtml(entry.title)}</div>
            <div class="memory-list-item-meta">
              ${entry.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
            </div>
            <div class="memory-list-item-snippet">${escapeHtml(entry.snippet)}</div>
          </div>
        `).join("");
      }
    }
    if (memoryDreamHistoryDetailEl) {
      if (panelView.detail.loading || (!panelView.detail.content && panelView.detail.error) || panelView.detail.cards.length <= 0) {
        memoryDreamHistoryDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(panelView.detail.emptyText)}</div>`;
      } else {
        memoryDreamHistoryDetailEl.innerHTML = `
          <div class="memory-detail-shell">
            <div class="memory-detail-header">
              <div>
                <div class="memory-detail-title">${escapeHtml(panelView.detail.title)}</div>
                ${panelView.detail.summary ? `<div class="memory-detail-text">${escapeHtml(panelView.detail.summary)}</div>` : ""}
              </div>
            </div>
            <div class="memory-detail-grid">
              ${panelView.detail.cards.map((card) => `
                <div class="memory-detail-card">
                  <span class="memory-detail-label">${escapeHtml(card.label)}</span>
                  <div class="memory-detail-text">${escapeHtml(card.value)}</div>
                </div>
              `).join("")}
            </div>
            ${panelView.detail.reason ? `
              <div class="memory-detail-card">
                <span class="memory-detail-label">${escapeHtml(t("memory.dreamHistoryReason", {}, "触发原因"))}</span>
                <div class="memory-detail-text">${escapeHtml(panelView.detail.reason)}</div>
              </div>
            ` : ""}
            <div class="memory-detail-card">
              <span class="memory-detail-label">${escapeHtml(t("memory.dreamHistoryContent", {}, "Dream 正文"))}</span>
              ${panelView.detail.content
                ? `<pre class="memory-detail-pre">${escapeHtml(panelView.detail.content)}</pre>`
                : `<div class="memory-detail-text">${escapeHtml(panelView.detail.emptyText)}</div>`}
            </div>
          </div>
        `;
      }
    }
  }

  async function loadDreamHistoryDetail(dreamId, agentId = getActiveAgentId()) {
    const normalizedDreamId = typeof dreamId === "string" ? dreamId.trim() : "";
    const memoryViewerState = getMemoryViewerState();
    if (!normalizedDreamId || !isConnected()) {
      memoryViewerState.selectedDreamHistoryId = normalizedDreamId || null;
      memoryViewerState.selectedDreamHistoryItem = null;
      memoryViewerState.selectedDreamHistoryContent = "";
      memoryViewerState.dreamHistoryDetailLoading = false;
      memoryViewerState.dreamHistoryDetailError = normalizedDreamId
        ? t("memory.dreamHistoryDisconnectedDetail", {}, "连接建立后可查看 Dream 正文。")
        : "";
      renderDreamHistoryPanel();
      return null;
    }

    const requestContext = createDreamHistoryRequestContext("detail", agentId);
    memoryViewerState.selectedDreamHistoryId = normalizedDreamId;
    memoryViewerState.selectedDreamHistoryItem = Array.isArray(memoryViewerState.dreamHistoryItems)
      ? memoryViewerState.dreamHistoryItems.find((item) => item?.id === normalizedDreamId) || null
      : null;
    memoryViewerState.selectedDreamHistoryContent = "";
    memoryViewerState.dreamHistoryDetailLoading = true;
    memoryViewerState.dreamHistoryDetailError = "";
    renderDreamHistoryPanel();

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "dream.get",
      params: {
        agentId,
        dreamId: normalizedDreamId,
      },
    });

    if (!isDreamHistoryRequestCurrent(requestContext)) {
      return null;
    }

    memoryViewerState.dreamHistoryDetailLoading = false;
    if (!res?.ok) {
      memoryViewerState.selectedDreamHistoryContent = "";
      memoryViewerState.dreamHistoryDetailError = res?.error?.message || t("memory.dreamHistoryDetailLoadFailed", {}, "Dream 正文加载失败。");
      renderDreamHistoryPanel();
      return null;
    }

    memoryViewerState.selectedDreamHistoryItem = res.payload?.item && typeof res.payload.item === "object"
      ? res.payload.item
      : memoryViewerState.selectedDreamHistoryItem;
    memoryViewerState.selectedDreamHistoryContent = typeof res.payload?.content === "string" ? res.payload.content : "";
    memoryViewerState.dreamHistoryDetailError = "";
    renderDreamHistoryPanel();
    return res.payload;
  }

  async function loadDreamHistory(forceSelectFirst = false, agentId = getActiveAgentId()) {
    const memoryViewerState = getMemoryViewerState();
    memoryViewerState.dreamHistoryOpen = true;
    if (!isConnected()) {
      memoryViewerState.dreamHistoryLoading = false;
      memoryViewerState.dreamHistoryError = t("memory.dreamHistoryDisconnectedList", {}, "连接建立后可查看 Dream 历史。");
      memoryViewerState.dreamHistoryItems = [];
      memoryViewerState.selectedDreamHistoryId = null;
      memoryViewerState.selectedDreamHistoryItem = null;
      memoryViewerState.selectedDreamHistoryContent = "";
      memoryViewerState.dreamHistoryDetailLoading = false;
      memoryViewerState.dreamHistoryDetailError = "";
      renderDreamHistoryPanel();
      return null;
    }

    const requestContext = createDreamHistoryRequestContext("list", agentId);
    memoryViewerState.dreamHistoryLoading = true;
    memoryViewerState.dreamHistoryError = "";
    renderDreamHistoryPanel();

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "dream.history.list",
      params: {
        agentId,
        limit: 12,
      },
    });

    if (!isDreamHistoryRequestCurrent(requestContext)) {
      return null;
    }

    memoryViewerState.dreamHistoryLoading = false;
    if (!res?.ok) {
      memoryViewerState.dreamHistoryItems = [];
      memoryViewerState.selectedDreamHistoryId = null;
      memoryViewerState.selectedDreamHistoryItem = null;
      memoryViewerState.selectedDreamHistoryContent = "";
      memoryViewerState.dreamHistoryError = res?.error?.message || t("memory.dreamHistoryLoadFailedMessage", {}, "Dream 历史加载失败。");
      renderDreamHistoryPanel();
      return null;
    }

    const items = Array.isArray(res.payload?.items)
      ? res.payload.items.filter((item) => item && typeof item === "object")
      : [];
    memoryViewerState.dreamHistoryItems = items;
    memoryViewerState.dreamHistoryError = "";

    const preferredDreamId = forceSelectFirst
      ? (typeof items[0]?.id === "string" ? items[0].id.trim() : "")
      : (typeof memoryViewerState.selectedDreamHistoryId === "string" ? memoryViewerState.selectedDreamHistoryId.trim() : "");
    const selectedExists = items.some((item) => item?.id === preferredDreamId);
    const nextSelectedId = selectedExists
      ? preferredDreamId
      : (typeof items[0]?.id === "string" ? items[0].id.trim() : "");

    memoryViewerState.selectedDreamHistoryId = nextSelectedId || null;
    memoryViewerState.selectedDreamHistoryItem = nextSelectedId
      ? items.find((item) => item?.id === nextSelectedId) || null
      : null;
    memoryViewerState.selectedDreamHistoryContent = "";
    memoryViewerState.dreamHistoryDetailError = "";
    renderDreamHistoryPanel();

    if (nextSelectedId) {
      await loadDreamHistoryDetail(nextSelectedId, agentId);
    }
    return items;
  }

  function toggleDreamHistory() {
    const memoryViewerState = getMemoryViewerState();
    memoryViewerState.dreamHistoryOpen = memoryViewerState.dreamHistoryOpen !== true;
    renderDreamHistoryPanel();
    if (memoryViewerState.dreamHistoryOpen) {
      void loadDreamHistory(false);
    }
  }

  if (memoryDreamHistoryListEl) {
    memoryDreamHistoryListEl.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-dream-history-id]")
        : null;
      const dreamId = target?.getAttribute("data-dream-history-id");
      if (!dreamId) return;
      void loadDreamHistoryDetail(dreamId);
    });
  }

  if (memoryDreamModalTriggerBtn) {
    memoryDreamModalTriggerBtn.addEventListener("click", () => {
      openDreamModal();
    });
  }

  if (memoryDreamModalCloseBtn) {
    memoryDreamModalCloseBtn.addEventListener("click", () => {
      closeDreamModal();
    });
  }

  if (memoryDreamModalEl) {
    memoryDreamModalEl.addEventListener("click", (event) => {
      if (event.target === memoryDreamModalEl) {
        closeDreamModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !dreamModalOpen) return;
    closeDreamModal();
  });

  function formatTaskStatusLabel(status) {
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!normalized) return t("memory.taskStatusUnknown", {}, "Unknown");
    if (normalized === "running" || normalized === "executing" || normalized === "in_progress") return t("memory.taskStatusRunning", {}, "Running");
    if (normalized === "success" || normalized === "completed" || normalized === "done") return t("memory.taskStatusSuccess", {}, "Success");
    if (normalized === "failed" || normalized === "error") return t("memory.taskStatusFailed", {}, "Failed");
    if (normalized === "partial") return t("memory.taskStatusPartial", {}, "Partial");
    if (normalized === "pending") return t("memory.taskStatusPending", {}, "Pending");
    return status;
  }

  function formatTaskSourceLabel(source) {
    const normalized = typeof source === "string" ? source.trim().toLowerCase() : "";
    if (!normalized) return t("memory.taskSourceUnknown", {}, "Unknown source");
    if (normalized === "chat") return t("memory.taskSourceChat", {}, "Chat");
    if (normalized === "sub_agent") return t("memory.taskSourceSubAgent", {}, "Sub Agent");
    if (normalized === "cron") return t("memory.taskSourceCron", {}, "Cron");
    if (normalized === "heartbeat") return t("memory.taskSourceHeartbeat", {}, "Heartbeat");
    if (normalized === "manual") return t("memory.taskSourceManual", {}, "Manual");
    return source;
  }

  function formatMemoryTypeLabel(memoryType) {
    const normalized = typeof memoryType === "string" ? memoryType.trim().toLowerCase() : "";
    if (!normalized) return t("memory.memoryTypeOther", {}, "Other");
    if (normalized === "core") return t("memory.memoryTypeCore", {}, "Core");
    if (normalized === "daily") return t("memory.memoryTypeDaily", {}, "Daily");
    if (normalized === "session") return t("memory.memoryTypeSession", {}, "Session");
    if (normalized === "other") return t("memory.memoryTypeOther", {}, "Other");
    return memoryType;
  }

  function formatMemorySourceTypeLabel(sourceType) {
    const normalized = typeof sourceType === "string" ? sourceType.trim().toLowerCase() : "";
    if (!normalized) return t("memory.memorySourceTypeUnknown", {}, "Unknown source");
    if (normalized === "task") return t("memory.memorySourceTypeTask", {}, "Task");
    if (normalized === "conversation") return t("memory.memorySourceTypeConversation", {}, "Conversation");
    if (normalized === "file") return t("memory.memorySourceTypeFile", {}, "File");
    if (normalized === "experience") return t("memory.memorySourceTypeExperience", {}, "Experience");
    if (normalized === "manual") return t("memory.memorySourceTypeManual", {}, "Manual");
    return sourceType;
  }

  function syncMemoryViewerUi() {
    syncMemoryViewerHeaderTitle();
    const memoryViewerState = getMemoryViewerState();
    const isTasks = memoryViewerState.tab === "tasks";
    const isMemories = memoryViewerState.tab === "memories";
    const isSharedReview = memoryViewerState.tab === "sharedReview";
    const isOutboundAudit = memoryViewerState.tab === "outboundAudit";
    const isOutboundAuditThreads = isOutboundAudit && getOutboundAuditFocus() === "threads";
    if (memoryViewerSection) memoryViewerSection.classList.toggle("tasks-mode", isTasks);
    if (memoryTabTasksBtn) memoryTabTasksBtn.classList.toggle("active", isTasks);
    if (memoryTabMemoriesBtn) memoryTabMemoriesBtn.classList.toggle("active", isMemories);
    if (memoryTabSharedReviewBtn) memoryTabSharedReviewBtn.classList.toggle("active", isSharedReview);
    if (memoryTabOutboundAuditBtn) memoryTabOutboundAuditBtn.classList.toggle("active", isOutboundAudit);
    if (memoryTaskFiltersEl) memoryTaskFiltersEl.classList.toggle("hidden", !isTasks);
    if (memoryChunkFiltersEl) memoryChunkFiltersEl.classList.toggle("hidden", isTasks || isOutboundAudit);
    if (memoryChunkTypeFilterEl) memoryChunkTypeFilterEl.classList.toggle("hidden", !isMemories);
    if (memoryChunkVisibilityFilterEl) memoryChunkVisibilityFilterEl.classList.toggle("hidden", !isMemories);
    if (memoryChunkGovernanceFilterEl) memoryChunkGovernanceFilterEl.classList.toggle("hidden", !(isMemories || isSharedReview));
    if (memoryChunkCategoryFilterEl) memoryChunkCategoryFilterEl.classList.toggle("hidden", !isMemories);
    if (memorySharedReviewFiltersEl) memorySharedReviewFiltersEl.classList.toggle("hidden", !isSharedReview);
    if (memoryOutboundAuditFiltersEl) memoryOutboundAuditFiltersEl.classList.toggle("hidden", !isOutboundAudit);
    if (memoryOutboundAuditFocusAllBtn) memoryOutboundAuditFocusAllBtn.classList.toggle("active", isOutboundAudit && !isOutboundAuditThreads);
    if (memoryOutboundAuditFocusThreadsBtn) memoryOutboundAuditFocusThreadsBtn.classList.toggle("active", isOutboundAuditThreads);
    if (memorySearchInputEl) {
      memorySearchInputEl.placeholder = isOutboundAuditThreads
        ? t("memory.emailThreadOrganizerSearchPlaceholder", {}, "搜索主题、发件人、线程、会话、整理摘要或建议回复")
        : isOutboundAudit
          ? t("memory.outboundAuditSearchPlaceholder", {}, "搜索渠道、requestId、messageId、thread、会话、Agent 或消息预览")
        : t("memory.searchPlaceholder", {}, "搜索任务标题、总结或记忆内容");
    }
    if (memoryDedupPreviewBtn) {
      memoryDedupPreviewBtn.classList.toggle("hidden", !isMemories);
      memoryDedupPreviewBtn.disabled = !isMemories;
      memoryDedupPreviewBtn.textContent = t("memory.dedupPreview", {}, "重复预检");
    }
    syncSharedReviewFilterUi();
    renderSharedReviewBatchBar();
    renderDreamRuntimeBar();
    renderDreamModal();
    renderDedupModal();
    syncMemoryTaskGoalFilterUi();
  }

  function switchMemoryViewerTab(tab) {
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.tab === tab) return;
    captureAgentViewState();
    const normalizedAgentId = String(memoryViewerState.activeAgentId || getActiveAgentId()).trim() || "default";
    const nextView = normalizeMemoryViewerAgentViewState(
      ensureAgentViewStates()[normalizedAgentId],
      tab,
    );
    nextView.tab = tab;
    ensureAgentViewStates()[normalizedAgentId] = nextView;
    memoryViewerState.tab = tab;
    memoryViewerState.outboundAuditFocus = nextView.outboundAuditFocus || "all";
    resetStoredListPage(tab);
    memoryViewerState.items = [];
    memoryViewerState.selectedId = null;
    memoryViewerState.selectedTask = null;
    memoryViewerState.selectedCandidate = null;
    memoryViewerState.sharedReviewSummary = null;
    memoryViewerState.selectedSharedReviewIds = [];
    memoryViewerState.sharedReviewBatchBusy = false;
    if (tab !== "tasks") {
      memoryViewerState.goalIdFilter = null;
    }
    if (memoryChunkGovernanceFilterEl) {
      memoryChunkGovernanceFilterEl.value = tab === "sharedReview"
        ? (nextView.sharedReviewGovernance || "pending")
        : nextView.memoryGovernance;
    }
    syncMemoryViewerUi();
    void loadMemoryViewer(true);
  }

  function switchOutboundAuditFocus(focus) {
    const normalizedFocus = normalizeOutboundAuditFocus(focus);
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.tab !== "outboundAudit" || getOutboundAuditFocus() === normalizedFocus) return;
    captureAgentViewState();
    const normalizedAgentId = String(memoryViewerState.activeAgentId || getActiveAgentId()).trim() || "default";
    const nextView = normalizeMemoryViewerAgentViewState(
      ensureAgentViewStates()[normalizedAgentId],
      memoryViewerState.tab,
    );
    nextView.outboundAuditFocus = normalizedFocus;
    ensureAgentViewStates()[normalizedAgentId] = nextView;
    memoryViewerState.outboundAuditFocus = normalizedFocus;
    resetStoredListPage("outboundAudit");
    memoryViewerState.items = [];
    memoryViewerState.selectedId = null;
    syncMemoryViewerUi();
    void loadMemoryViewer(true);
  }

  async function loadMemoryViewer(forceSelectFirst = false) {
    if (!memoryViewerSection) return;
    syncMemoryViewerUi();
    const requestContext = createMemoryViewerRequestContext();

    if (!isConnected()) {
      const memoryViewerState = getMemoryViewerState();
      memoryViewerState.dreamRuntime = null;
      memoryViewerState.dreamCommons = null;
      memoryViewerState.dreamBusy = false;
      memoryViewerState.dreamHistoryLoading = false;
      memoryViewerState.dreamHistoryError = "";
      memoryViewerState.dreamHistoryItems = [];
      memoryViewerState.selectedDreamHistoryId = null;
      memoryViewerState.selectedDreamHistoryItem = null;
      memoryViewerState.selectedDreamHistoryContent = "";
      memoryViewerState.dreamHistoryDetailLoading = false;
      memoryViewerState.dreamHistoryDetailError = "";
      renderDreamRuntimeBar();
      renderMemoryViewerStats(null);
      renderMemoryViewerListEmpty(t("memory.disconnectedList", {}, "Not connected to the server."));
      renderMemoryViewerDetailEmpty(t("memory.disconnectedDetail", {}, "Tasks and memories will be available after connection is ready."));
      return;
    }

    const memoryViewerState = getMemoryViewerState();
    const dreamLoadPromise = Promise.all([
      loadDreamRuntimeStatus(requestContext),
      loadDreamCommonsStatus(),
    ]);
    if (memoryViewerState.tab === "tasks") {
      await Promise.all([
        dreamLoadPromise,
        loadMemoryViewerStats(requestContext),
        loadTaskUsageOverview(requestContext),
      ]);
      if (!isMemoryViewerRequestCurrent(requestContext)) return;
      await loadTaskViewer(forceSelectFirst, requestContext);
    } else if (memoryViewerState.tab === "sharedReview") {
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
      await dreamLoadPromise;
      await loadSharedReviewQueue(forceSelectFirst, requestContext);
    } else if (memoryViewerState.tab === "outboundAudit") {
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
      await dreamLoadPromise;
      await loadExternalOutboundAuditViewer(forceSelectFirst, requestContext);
    } else {
      memoryViewerState.selectedTask = null;
      memoryViewerState.selectedCandidate = null;
      await Promise.all([
        dreamLoadPromise,
        loadMemoryViewerStats(requestContext),
      ]);
      if (!isMemoryViewerRequestCurrent(requestContext)) return;
      await loadMemoryChunkViewer(forceSelectFirst, requestContext);
    }
  }

  async function loadDreamRuntimeStatus(requestContext = null) {
    const activeRequest = createMemoryViewerRequestContext(requestContext);
    const memoryViewerState = getMemoryViewerState();
    const agentId = activeRequest.agentId;
    if (!isConnected()) {
      memoryViewerState.dreamRuntime = null;
      memoryViewerState.dreamBusy = false;
      renderDreamRuntimeBar();
      return null;
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "dream.status.get",
      params: {
        agentId,
      },
    });
    if (!isMemoryViewerRequestCurrent(activeRequest)) {
      return null;
    }
    if (res?.ok) {
      memoryViewerState.dreamRuntime = normalizeDreamRuntimeView(res.payload, agentId);
    } else {
      memoryViewerState.dreamRuntime = normalizeDreamRuntimeView({
        agentId,
        availability: {
          enabled: false,
          available: false,
          reason: res?.error?.message || t("memory.dreamLoadFailed", {}, "Failed to load dream status."),
        },
      }, agentId);
    }
    renderDreamRuntimeBar();
    if (memoryViewerState.dreamHistoryOpen) {
      void loadDreamHistory(false, agentId);
    }
    return memoryViewerState.dreamRuntime;
  }

  async function loadDreamCommonsStatus() {
    const memoryViewerState = getMemoryViewerState();
    if (!isConnected()) {
      memoryViewerState.dreamCommons = null;
      renderDreamRuntimeBar();
      return null;
    }
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "dream.commons.status.get",
      params: {},
    });
    if (res?.ok) {
      memoryViewerState.dreamCommons = normalizeDreamCommonsView(res.payload);
    } else {
      memoryViewerState.dreamCommons = normalizeDreamCommonsView({
        availability: {
          enabled: false,
          available: false,
          reason: res?.error?.message || t("memory.dreamCommonsLoadFailed", {}, "Failed to load Commons export status."),
        },
      });
    }
    renderDreamRuntimeBar();
    return memoryViewerState.dreamCommons;
  }

  async function runDream() {
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.dreamBusy) {
      return null;
    }
    if (!isConnected()) {
      showNotice?.(
        t("memory.dreamRunDisconnectedTitle", {}, "Dream 运行失败"),
        t("memory.dreamRunDisconnectedMessage", {}, "当前未连接到服务器，无法触发 dream.run。"),
        "error",
      );
      return null;
    }

    const agentId = getActiveAgentId();
    memoryViewerState.dreamBusy = true;
    renderDreamRuntimeBar();
    try {
      const res = await sendReq({
        type: "req",
        id: makeId(),
        method: "dream.run",
        params: {
          agentId,
        },
      });
      if (!res?.ok) {
        showNotice?.(
          t("memory.dreamRunFailedTitle", {}, "Dream 运行失败"),
          res?.error?.message || t("memory.dreamRunFailedMessage", {}, "dream.run 调用失败。"),
          "error",
        );
        return null;
      }
      const previousConversationId = memoryViewerState.dreamRuntime?.requested?.defaultConversationId ?? null;
      memoryViewerState.dreamRuntime = {
        ...normalizeDreamRuntimeView(res.payload, agentId),
        requested: {
          agentId,
          defaultConversationId: previousConversationId,
        },
      };
      renderDreamRuntimeBar();
      showNotice?.(
        t("memory.dreamRunSuccessTitle", {}, "Dream 已运行"),
        res.payload?.record?.summary || t("memory.dreamRunSuccessMessage", {}, "已生成新的 dream 记录。"),
        res.payload?.record?.status === "failed" ? "warn" : "success",
        2600,
      );
      if (memoryViewerState.dreamHistoryOpen) {
        void loadDreamHistory(true, agentId);
      }
      void loadDreamRuntimeStatus({
        requestToken: Number(memoryViewerState.requestToken || 0),
        agentId,
      });
      return res.payload;
    } finally {
      memoryViewerState.dreamBusy = false;
      renderDreamRuntimeBar();
    }
  }

  function getExternalOutboundAuditItemId(item, index = 0) {
    const requestId = typeof item?.requestId === "string" ? item.requestId.trim() : "";
    const auditKind = typeof item?.auditKind === "string" && item.auditKind.trim() ? item.auditKind.trim() : "channel";
    if (auditKind === "email_thread_organizer") {
      const organizerId = typeof item?.id === "string" ? item.id.trim() : "";
      if (organizerId) return `${auditKind}:${organizerId}`;
    }
    if (requestId) return `${auditKind}:${requestId}`;
    const timestamp = Number.isFinite(Number(item?.timestamp)) ? Number(item.timestamp) : 0;
    const channel = typeof item?.targetChannel === "string" ? item.targetChannel.trim() : "unknown";
    const chatId = typeof item?.targetChatId === "string" ? item.targetChatId.trim() : "";
    const preview = typeof item?.contentPreview === "string"
      ? item.contentPreview.trim()
      : typeof item?.bodyPreview === "string"
        ? item.bodyPreview.trim()
        : "";
    return `${auditKind}:${timestamp}:${channel}:${chatId}:${preview}:${index}`;
  }

  function formatExternalOutboundDecisionLabel(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "confirmed") return t("memory.outboundAuditDecisionConfirmed", {}, "确认通过");
    if (normalized === "rejected") return t("memory.outboundAuditDecisionRejected", {}, "已拒绝");
    if (normalized === "auto_approved") return t("memory.outboundAuditDecisionAutoApproved", {}, "自动放行");
    return value || "-";
  }

  function formatExternalOutboundDeliveryLabel(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "sent") return t("memory.outboundAuditDeliverySent", {}, "已发送");
    if (normalized === "failed") return t("memory.outboundAuditDeliveryFailed", {}, "发送失败");
    if (normalized === "rejected") return t("memory.outboundAuditDeliveryRejected", {}, "未发送");
    return value || "-";
  }

  function formatEmailInboundStatusLabel(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "processed") return t("memory.outboundAuditInboundProcessed", {}, "已处理");
    if (normalized === "failed") return t("memory.outboundAuditInboundFailed", {}, "处理失败");
    if (normalized === "invalid_event") return t("memory.outboundAuditInboundInvalid", {}, "事件无效");
    if (normalized === "skipped_duplicate") return t("memory.outboundAuditInboundDuplicate", {}, "重复跳过");
    return value || "-";
  }

  function formatExternalOutboundResolutionLabel(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || "-";
  }

  function formatEmailOutboundDiagnosis(item) {
    if (item?.delivery !== "failed" && !item?.errorCode && !item?.error) {
      return "-";
    }
    const providerId = typeof item?.providerId === "string" && item.providerId.trim() ? item.providerId.trim() : "email";
    const errorCode = typeof item?.errorCode === "string" && item.errorCode.trim() ? item.errorCode.trim() : "";
    const error = typeof item?.error === "string" && item.error.trim() ? item.error.trim() : "";
    const headline = errorCode ? `${providerId} / ${errorCode}` : providerId;
    return error ? `${headline} · ${error}` : headline;
  }

  function formatEmailInboundDiagnosis(item) {
    if (item?.status !== "failed" && item?.status !== "invalid_event" && !item?.errorCode && !item?.error) {
      return "-";
    }
    const providerId = typeof item?.providerId === "string" && item.providerId.trim() ? item.providerId.trim() : "imap";
    const errorCode = typeof item?.errorCode === "string" && item.errorCode.trim() ? item.errorCode.trim() : "";
    const error = typeof item?.error === "string" && item.error.trim() ? item.error.trim() : "";
    const headline = errorCode ? `${providerId} / ${errorCode}` : providerId;
    return error ? `${headline} · ${error}` : headline;
  }

  function formatOutboundAuditChannelLabel(item) {
    if (item?.auditKind === "email") {
      const providerId = typeof item?.providerId === "string" && item.providerId.trim() ? item.providerId.trim() : "email";
      return `email/${providerId}`;
    }
    if (item?.auditKind === "email_inbound") {
      const providerId = typeof item?.providerId === "string" && item.providerId.trim() ? item.providerId.trim() : "email-inbound";
      return `email-inbound/${providerId}`;
    }
    return typeof item?.targetChannel === "string" && item.targetChannel.trim() ? item.targetChannel.trim() : "-";
  }

  function formatOutboundAuditPreview(item) {
    if (item?.auditKind === "email" || item?.auditKind === "email_inbound") {
      const subject = typeof item?.subject === "string" && item.subject.trim() ? item.subject.trim() : "";
      const bodyPreview = typeof item?.bodyPreview === "string" && item.bodyPreview.trim()
        ? item.bodyPreview.trim()
        : t("memory.outboundAuditPreviewEmpty", {}, "(空文本)");
      return subject ? `${subject} · ${bodyPreview}` : bodyPreview;
    }
    return item?.contentPreview || t("memory.outboundAuditPreviewEmpty", {}, "(空文本)");
  }

  function normalizeEmailOutboundAuditItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    return {
      ...item,
      auditKind: "email",
      targetChannel: "email",
      targetAccountId: item.accountId,
      contentPreview: item.bodyPreview,
    };
  }

  function normalizeEmailInboundAuditItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    return {
      ...item,
      auditKind: "email_inbound",
      targetChannel: "email-inbound",
      targetAccountId: item.accountId,
      contentPreview: item.bodyPreview,
    };
  }

  function matchesExternalOutboundAuditQuery(item, query) {
    const normalized = typeof query === "string" ? query.trim().toLowerCase() : "";
    if (!normalized) return true;
    const diagnosis = item?.auditKind === "email"
      ? {
        failureStage: "delivery",
        stageLabel: t("memory.outboundAuditEmailFailureStage", {}, "邮件投递"),
        codeLabel: item?.errorCode || "",
        summary: formatEmailOutboundDiagnosis(item),
      }
      : item?.auditKind === "email_inbound"
        ? {
          failureStage: "ingress",
          stageLabel: t("memory.outboundAuditEmailInboundFailureStage", {}, "邮件收信"),
          codeLabel: item?.errorCode || "",
          summary: formatEmailInboundDiagnosis(item),
        }
      : buildExternalOutboundDiagnosis({
        errorCode: item?.errorCode,
        error: item?.error,
        targetSessionKey: item?.targetSessionKey,
        delivery: item?.delivery,
      }, t);
    const haystack = [
      item?.contentPreview,
      item?.bodyPreview,
      item?.targetChannel,
      item?.providerId,
      item?.accountId,
      item?.subject,
      Array.isArray(item?.to) ? item.to.join(", ") : "",
      Array.isArray(item?.cc) ? item.cc.join(", ") : "",
      Array.isArray(item?.bcc) ? item.bcc.join(", ") : "",
      item?.providerMessageId,
      item?.providerThreadId,
      item?.threadId,
      item?.inReplyToMessageId,
      Array.isArray(item?.references) ? item.references.join(", ") : "",
      item?.replyToMessageId,
      item?.messageId,
      item?.mailbox,
      item?.sessionKey,
      item?.checkpointUid ? String(item.checkpointUid) : "",
      item?.retryAttempt ? String(item.retryAttempt) : "",
      item?.retryScheduled === true ? "retry_scheduled" : "",
      item?.retryExhausted === true ? "retry_exhausted" : "",
      item?.triageCategory,
      item?.triagePriority,
      item?.triageDisposition,
      item?.triageSummary,
      Array.isArray(item?.triageRationale) ? item.triageRationale.join(", ") : "",
      item?.triageNeedsReply === true ? "needs_reply" : "",
      item?.triageNeedsFollowUp === true ? "needs_follow_up" : "",
      item?.triageFollowUpWindowHours ? String(item.triageFollowUpWindowHours) : "",
      item?.suggestedReplyStarter,
      Array.isArray(item?.from) ? item.from.join(", ") : "",
      item?.targetSessionKey,
      item?.requestedSessionKey,
      item?.conversationId,
      item?.sourceConversationId,
      item?.requestId,
      item?.requestedByAgentId,
      item?.requestedAgentId,
      item?.targetChatId,
      item?.targetAccountId,
      item?.resolution,
      item?.decision,
      item?.delivery,
      item?.status,
      item?.errorCode,
      item?.error,
      diagnosis.failureStage,
      diagnosis.stageLabel,
      diagnosis.codeLabel,
      diagnosis.summary,
    ]
      .map((value) => typeof value === "string" ? value.toLowerCase() : "")
      .join("\n");
    return haystack.includes(normalized);
  }

  async function loadExternalOutboundAuditViewer(forceSelectFirst = false, existingContext = null) {
    const requestContext = createMemoryViewerRequestContext(existingContext);
    renderMemoryViewerListEmpty(t("memory.outboundAuditLoading", {}, "消息审计加载中…"));
    renderMemoryViewerDetailEmpty(t("memory.outboundAuditDetailLoading", {}, "正在加载消息审计详情…"));

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "external_outbound.audit.list",
      params: { limit: 50 },
    });
    const emailRes = await sendReq({
      type: "req",
      id: makeId(),
      method: "email_outbound.audit.list",
      params: { limit: 50 },
    });
    const inboundRes = await sendReq({
      type: "req",
      id: makeId(),
      method: "email_inbound.audit.list",
      params: { limit: 50 },
    });
    const reminderRes = await sendReq({
      type: "req",
      id: makeId(),
      method: "email_followup.list",
      params: { limit: 50 },
    });
    const memoryViewerState = getMemoryViewerState();
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    if ((!res || !res.ok) && (!emailRes || !emailRes.ok) && (!inboundRes || !inboundRes.ok)) {
      memoryViewerState.items = [];
      memoryViewerState.selectedId = null;
      renderMemoryViewerStats({});
      renderMemoryViewerListEmpty(t("memory.outboundAuditLoadFailed", {}, "消息审计列表加载失败。"));
      renderMemoryViewerDetailEmpty(
        res?.error?.message || emailRes?.error?.message || inboundRes?.error?.message || t("memory.outboundAuditDetailLoadFailed", {}, "无法读取消息审计数据。"),
      );
      return;
    }

    const query = memorySearchInputEl ? memorySearchInputEl.value.trim() : "";
    const allItems = [
      ...(Array.isArray(res?.payload?.items) ? res.payload.items.map((item) => ({ ...item, auditKind: "channel" })) : []),
      ...(Array.isArray(emailRes?.payload?.items)
        ? emailRes.payload.items.map(normalizeEmailOutboundAuditItem).filter((item) => Boolean(item))
        : []),
      ...(Array.isArray(inboundRes?.payload?.items)
        ? inboundRes.payload.items.map(normalizeEmailInboundAuditItem).filter((item) => Boolean(item))
        : []),
    ].sort((left, right) => (Number(right?.timestamp) || 0) - (Number(left?.timestamp) || 0));
    const items = getOutboundAuditFocus() === "threads"
      ? mergeEmailThreadOrganizerReminders(
        buildEmailThreadOrganizerEntries(allItems),
        Array.isArray(reminderRes?.payload?.items) ? reminderRes.payload.items : [],
      ).filter((item) => matchesEmailThreadOrganizerQuery(item, query))
      : allItems.filter((item) => matchesExternalOutboundAuditQuery(item, query));
    memoryViewerState.items = items;
    resetStoredListPage("outboundAudit");
    renderMemoryViewerStats({});

    if (!items.length) {
      memoryViewerState.selectedId = null;
      renderExternalOutboundAuditList(items);
      renderMemoryViewerDetailEmpty(t("memory.outboundAuditEmpty", {}, "当前还没有匹配的消息审计记录。"));
      return;
    }

    const selectedExists = items.some((item, index) => getExternalOutboundAuditItemId(item, index) === memoryViewerState.selectedId);
    if (forceSelectFirst || !selectedExists) {
      memoryViewerState.selectedId = getExternalOutboundAuditItemId(items[0], 0);
    }

    renderExternalOutboundAuditList(items);
    const selected = items.find((item, index) => getExternalOutboundAuditItemId(item, index) === memoryViewerState.selectedId) || items[0];
    renderExternalOutboundAuditDetail(selected);
  }

  async function loadMemoryViewerStats(existingContext = null) {
    const requestContext = createMemoryViewerRequestContext(existingContext);
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.stats",
      params: buildScopedParams({}, requestContext.agentId),
    });
    const memoryViewerState = getMemoryViewerState();
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    if (!res || !res.ok) {
      memoryViewerState.sharedGovernance = null;
      renderMemoryViewerStats(null);
      return;
    }
    memoryViewerState.stats = res.payload?.status ?? null;
    memoryViewerState.memoryQueryView = res.payload?.queryView ?? null;
    memoryViewerState.sharedGovernance = res.payload?.sharedGovernance ?? null;
    renderMemoryViewerStats(memoryViewerState.stats);
  }

  async function promoteSelectedMemoryToShared(item) {
    if (!item?.id) return;
    const reason = window.prompt(
      t("memory.sharePromotePrompt", {}, "Enter the reason for promoting this memory to the shared layer."),
      t("memory.sharePromotePromptDefault", {}, "Manual promotion from memory viewer"),
    );
    if (reason === null) return;

    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      showNotice?.(
        t("memory.sharePromoteFailedTitle", {}, "Shared Promotion Failed"),
        t("memory.sharePromotePrompt", {}, "Enter the reason for promoting this memory to the shared layer."),
        "error",
      );
      return;
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.share.promote",
      params: buildScopedParams({
        chunkId: item.id,
        reason: trimmedReason,
      }),
    });
    if (!res || !res.ok) {
      showNotice?.(
        t("memory.sharePromoteFailedTitle", {}, "Shared Promotion Failed"),
        res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."),
        "error",
        4200,
      );
      return;
    }

    showNotice?.(
      t("memory.sharePromoteSuccessTitle", {}, "Shared Promotion Complete"),
      t("memory.sharePromoteSuccessMessage", { count: Number(res.payload?.promotedCount) || 0 }, "The shared copy has been written and the private copy is kept."),
      "success",
      2600,
    );

    await loadMemoryViewer(false);
    if (getMemoryViewerState().selectedId) {
      await loadMemoryDetail(getMemoryViewerState().selectedId);
    }
  }

  async function sendMemoryShareReviewRequest(item, decision, note = "", scope = "chunk") {
    const reviewerAgentId = getActiveAgentId();
    const targetAgentId = getMemoryShareTargetAgentId(item);
    return sendReq({
      type: "req",
      id: makeId(),
      method: "memory.share.review",
      params: {
        ...(scope === "source"
          ? { sourcePath: getMemoryShareScopeSourcePath(item) }
          : { chunkId: item.id }),
        targetAgentId,
        reviewerAgentId,
        decision,
        note: String(note || "").trim(),
      },
    });
  }

  async function sendMemoryShareClaimRequest(item, action, scope = "chunk") {
    const reviewerAgentId = getActiveAgentId();
    const targetAgentId = getMemoryShareTargetAgentId(item);
    return sendReq({
      type: "req",
      id: makeId(),
      method: "memory.share.claim",
      params: {
        action,
        ...(scope === "source"
          ? { sourcePath: getMemoryShareScopeSourcePath(item) }
          : { chunkId: item.id }),
        targetAgentId,
        reviewerAgentId,
      },
    });
  }

  async function runSharedReviewBatchAction(action) {
    const memoryViewerState = getMemoryViewerState();
    if (memoryViewerState.sharedReviewBatchBusy === true) return;
    const batchState = buildSharedReviewBatchActionState(
      memoryViewerState.items,
      getSelectedSharedReviewIds(),
      getActiveAgentId(),
    );
    const eligibleItems = batchState.actions[action] || [];
    if (!eligibleItems.length) return;

    let note = "";
    if (action === "approved" || action === "rejected" || action === "revoked") {
      const promptKey = action === "approved"
        ? "memory.shareReviewPromptApprove"
        : action === "rejected"
          ? "memory.shareReviewPromptReject"
          : "memory.shareReviewPromptRevoke";
      const promptValue = window.prompt(
        t(promptKey, {}, "Optional note"),
        "",
      );
      if (promptValue === null) return;
      note = String(promptValue || "").trim();
    }

    memoryViewerState.sharedReviewBatchBusy = true;
    renderSharedReviewBatchBar();

    let successCount = 0;
    const errors = [];
    for (const item of eligibleItems) {
      let res;
      if (action === "claim" || action === "release") {
        res = await sendMemoryShareClaimRequest(item, action, "chunk");
      } else {
        res = await sendMemoryShareReviewRequest(item, action, note, "chunk");
      }
      if (res?.ok) {
        successCount += 1;
        continue;
      }
      errors.push(res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."));
    }

    memoryViewerState.sharedReviewBatchBusy = false;
    if (successCount > 0) {
      const successTitle = action === "claim" || action === "release"
        ? t("memory.shareClaimSuccessTitle", {}, "Shared Claim Updated")
        : t("memory.shareReviewSuccessTitle", {}, "Shared Review Updated");
      showNotice?.(
        successTitle,
        t(
          "memory.sharedReviewBatchSuccessMessage",
          {
            action: formatSharedReviewBatchActionLabel(action),
            count: formatCount(successCount),
            skipped: formatCount(batchState.selectedCount - successCount),
          },
          `${action} applied to ${formatCount(successCount)} selected item(s).`,
        ),
        errors.length ? "info" : "success",
        3200,
      );
    }
    if (!successCount && errors.length) {
      showNotice?.(
        t("memory.sharedReviewBatchFailedTitle", {}, "Batch Shared Review Failed"),
        errors[0],
        "error",
        4200,
      );
    }

    await loadMemoryViewer(false);
    if (getMemoryViewerState().selectedId) {
      await loadMemoryDetail(getMemoryViewerState().selectedId);
    }
  }

  async function reviewSelectedMemoryShare(item, decision, scope = "chunk") {
    if (!item?.id) return;
    const promptKey = decision === "approved"
      ? "memory.shareReviewPromptApprove"
      : decision === "rejected"
        ? "memory.shareReviewPromptReject"
        : "memory.shareReviewPromptRevoke";
    const note = window.prompt(
      t(promptKey, {}, "Optional note"),
      "",
    );
    if (note === null) return;
    const res = await sendMemoryShareReviewRequest(item, decision, note, scope);
    if (!res || !res.ok) {
      showNotice?.(
        t("memory.shareReviewFailedTitle", {}, "Failed to Update Shared Review"),
        res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."),
        "error",
        4200,
      );
      return;
    }

    showNotice?.(
      t("memory.shareReviewSuccessTitle", {}, "Shared Review Updated"),
      t(
        "memory.shareReviewSuccessMessage",
        {
          decision,
          count: Number(res.payload?.reviewedCount) || 0,
          scope: res.payload?.mode || scope,
        },
        "Shared status has been updated.",
      ),
      "success",
      2600,
    );

    await loadMemoryViewer(false);
    if (getMemoryViewerState().selectedId) {
      await loadMemoryDetail(getMemoryViewerState().selectedId);
    }
  }

  async function claimSelectedMemoryShare(item, action, scope = "chunk") {
    if (!item?.id) return;
    const res = await sendMemoryShareClaimRequest(item, action, scope);
    if (!res || !res.ok) {
      showNotice?.(
        t("memory.shareClaimFailedTitle", {}, "Failed to Update Shared Claim"),
        res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."),
        "error",
        4200,
      );
      return;
    }

    showNotice?.(
      t("memory.shareClaimSuccessTitle", {}, "Shared Claim Updated"),
      t(
        "memory.shareClaimSuccessMessage",
        {
          action,
          count: Number(res.payload?.claimedCount) || 0,
          scope: res.payload?.mode || scope,
        },
        "Shared review claim has been updated.",
      ),
      "success",
      2600,
    );

    await loadMemoryViewer(false);
    if (getMemoryViewerState().selectedId) {
      await loadMemoryDetail(getMemoryViewerState().selectedId);
    }
  }

  function bindMemoryDetailActions(item) {
    if (!memoryViewerDetailEl || !item?.id) return;
    memoryViewerDetailEl.querySelectorAll("[data-memory-detail-toggle]").forEach((node) => {
      node.addEventListener("click", () => {
        const section = node.getAttribute("data-memory-detail-toggle") || "";
        if (!section) return;
        const body = memoryViewerDetailEl.querySelector(`[data-memory-detail-body="${section}"]`);
        const card = body?.closest("[data-memory-detail-collapsible]");
        if (!(body instanceof HTMLElement) || !(card instanceof HTMLElement)) return;

        const fullText = section === "metadata"
          ? JSON.stringify(item.metadata ?? {}, null, 2)
          : String(item.content || item.snippet || t("memory.noContent", {}, "No content"));
        const preview = buildMemoryDetailCollapsedPreview(fullText);
        const expanded = node.getAttribute("data-memory-detail-expanded") === "true";

        if (expanded) {
          body.textContent = preview.preview;
          body.classList.add("is-collapsed");
          node.setAttribute("data-memory-detail-expanded", "false");
          node.textContent = t("memory.detailExpand", {}, "Expand");
          card.classList.remove("is-expanded");
          return;
        }

        body.textContent = fullText;
        body.classList.remove("is-collapsed");
        node.setAttribute("data-memory-detail-expanded", "true");
        node.textContent = t("memory.detailCollapse", {}, "Collapse");
        card.classList.add("is-expanded");
      });
    });
    memoryViewerDetailEl.querySelectorAll("[data-memory-open-shared-review-context]").forEach((node) => {
      node.addEventListener("click", () => {
        void openSharedReviewContextForItem(item);
      });
    });
    memoryViewerDetailEl.querySelectorAll("[data-memory-share-promote]").forEach((node) => {
      node.addEventListener("click", () => {
        void promoteSelectedMemoryToShared(item);
      });
    });
    memoryViewerDetailEl.querySelectorAll("[data-memory-share-decision]").forEach((node) => {
      node.addEventListener("click", () => {
        const decision = node.getAttribute("data-memory-share-decision") || "";
        if (!decision) return;
        const scope = node.getAttribute("data-memory-share-decision-scope") || "chunk";
        void reviewSelectedMemoryShare(item, decision, scope);
      });
    });
    memoryViewerDetailEl.querySelectorAll("[data-memory-share-claim]").forEach((node) => {
      node.addEventListener("click", () => {
        const action = node.getAttribute("data-memory-share-claim") || "";
        if (!action) return;
        const scope = node.getAttribute("data-memory-share-claim-scope") || "chunk";
        void claimSelectedMemoryShare(item, action, scope);
      });
    });
  }

  async function openSharedReviewContextForItem(item) {
    const targetAgentId = getMemoryShareTargetAgentId(item);
    const queueStatus = normalizeMemorySharePromotionStatus(item);
    const memoryViewerState = getMemoryViewerState();
    const filters = getSharedReviewFilters();
    filters.targetAgentId = targetAgentId || "";
    filters.claimedByAgentId = filters.focus === "mine" ? getActiveAgentId() : filters.claimedByAgentId;
    memoryViewerState.tab = "sharedReview";
    resetStoredListPage("sharedReview");
    memoryViewerState.items = [];
    memoryViewerState.selectedId = typeof item?.id === "string" ? item.id.trim() : null;
    memoryViewerState.selectedTask = null;
    memoryViewerState.selectedCandidate = null;
    memoryViewerState.sharedReviewSummary = null;
    memoryViewerState.selectedSharedReviewIds = [];
    memoryViewerState.sharedReviewBatchBusy = false;
    if (memoryChunkGovernanceFilterEl && queueStatus && queueStatus !== "none") {
      memoryChunkGovernanceFilterEl.value = queueStatus === "active" ? "approved" : queueStatus;
    } else if (memoryChunkGovernanceFilterEl && !memoryChunkGovernanceFilterEl.value) {
      memoryChunkGovernanceFilterEl.value = "pending";
    }
    captureAgentViewState();
    syncMemoryViewerUi();
    await loadSharedReviewQueue(false);
    if (memoryViewerState.selectedId && Array.isArray(memoryViewerState.items) && memoryViewerState.items.some((entry) => entry?.id === memoryViewerState.selectedId)) {
      await loadMemoryDetail(memoryViewerState.selectedId, null, { targetAgentId });
    }
  }

  async function loadTaskUsageOverview(existingContext = null) {
    const requestContext = createMemoryViewerRequestContext(existingContext);
    const memoryViewerState = getMemoryViewerState();
    const seq = memoryViewerState.usageOverviewSeq + 1;
    memoryViewerState.usageOverviewSeq = seq;
    memoryViewerState.usageOverview = {
      ...memoryViewerState.usageOverview,
      loading: true,
    };
    renderMemoryViewerStats(memoryViewerState.stats);

    const [methodsRes, skillsRes] = await Promise.all([
      sendReq({
        type: "req",
        id: makeId(),
        method: "experience.usage.stats",
        params: buildScopedParams({ limit: 6, filter: { assetType: "method" } }, requestContext.agentId),
      }),
      sendReq({
        type: "req",
        id: makeId(),
        method: "experience.usage.stats",
        params: buildScopedParams({ limit: 6, filter: { assetType: "skill" } }, requestContext.agentId),
      }),
    ]);

    if (
      memoryViewerState.tab !== "tasks"
      || memoryViewerState.usageOverviewSeq !== seq
      || !isMemoryViewerRequestCurrent(requestContext)
    ) {
      return;
    }

    memoryViewerState.usageOverview = {
      loading: false,
      methods: methodsRes?.ok && Array.isArray(methodsRes.payload?.items) ? methodsRes.payload.items : [],
      skills: skillsRes?.ok && Array.isArray(skillsRes.payload?.items) ? skillsRes.payload.items : [],
    };
    memoryViewerState.experienceQueryView = methodsRes?.payload?.queryView ?? skillsRes?.payload?.queryView ?? null;
    renderMemoryViewerStats(memoryViewerState.stats);
  }

  async function loadTaskViewer(forceSelectFirst = false, existingContext = null) {
    const requestContext = createMemoryViewerRequestContext(existingContext);
    renderMemoryViewerListEmpty(t("memory.tasksLoading", {}, "Loading tasks..."));
    renderMemoryViewerDetailEmpty(t("memory.taskDetailLoading", {}, "Loading task details..."));

    const memoryViewerState = getMemoryViewerState();
    memoryViewerState.selectedTask = null;
    renderMemoryViewerStats(memoryViewerState.stats);

    const params = { limit: 20, summaryOnly: true };
    const query = memorySearchInputEl ? memorySearchInputEl.value.trim() : "";
    if (query) params.query = query;

    const filter = {};
    if (memoryTaskStatusFilterEl?.value) filter.status = memoryTaskStatusFilterEl.value;
    if (memoryTaskSourceFilterEl?.value) filter.source = memoryTaskSourceFilterEl.value;
    if (memoryViewerState.goalIdFilter) filter.goalId = memoryViewerState.goalIdFilter;
    if (Object.keys(filter).length > 0) params.filter = filter;

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.task.list",
      params: buildScopedParams(params, requestContext.agentId),
    });
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    if (!res || !res.ok) {
      memoryViewerState.selectedTask = null;
      renderMemoryViewerListEmpty(t("memory.taskListLoadFailed", {}, "Failed to load task list."));
      renderMemoryViewerDetailEmpty(res?.error?.message || t("memory.taskReadFailed", {}, "Failed to read task data."));
      renderMemoryViewerStats(memoryViewerState.stats);
      return;
    }

    const items = Array.isArray(res.payload?.items) ? res.payload.items : [];
    memoryViewerState.items = items;
    resetStoredListPage("tasks");
    renderMemoryViewerStats(memoryViewerState.stats);

    if (!items.length) {
      memoryViewerState.selectedId = null;
      memoryViewerState.selectedTask = null;
      renderTaskList(items);
      renderMemoryViewerDetailEmpty(t("memory.noMatchingTasks", {}, "No matching tasks."));
      renderMemoryViewerStats(memoryViewerState.stats);
      return;
    }

    const selectedExists = items.some((item) => item.id === memoryViewerState.selectedId);
    if (forceSelectFirst || !selectedExists) {
      memoryViewerState.selectedId = items[0].id;
    }

    renderTaskList(items);
    await loadTaskDetail(memoryViewerState.selectedId, requestContext);
  }

  async function loadMemoryChunkViewer(forceSelectFirst = false, existingContext = null) {
    const requestContext = createMemoryViewerRequestContext(existingContext);
    renderMemoryViewerListEmpty(t("memory.memoriesLoading", {}, "Loading memories..."));
    renderMemoryViewerDetailEmpty(t("memory.memoryDetailLoading", {}, "Loading memory details..."));

    const query = memorySearchInputEl ? memorySearchInputEl.value.trim() : "";
    const filter = {};
    if (memoryChunkTypeFilterEl?.value) filter.memoryType = memoryChunkTypeFilterEl.value;
    if (memoryChunkVisibilityFilterEl?.value) filter.scope = memoryChunkVisibilityFilterEl.value;
    if (memoryChunkGovernanceFilterEl?.value) filter.sharedPromotionStatus = memoryChunkGovernanceFilterEl.value;
    if (memoryChunkCategoryFilterEl?.value) {
      if (memoryChunkCategoryFilterEl.value === "uncategorized") {
        filter.uncategorized = true;
      } else {
        filter.category = memoryChunkCategoryFilterEl.value;
      }
    }

    const params = { limit: 20, includeContent: false };
    if (Object.keys(filter).length > 0) params.filter = filter;
    if (query) params.query = query;

    const method = query ? "memory.search" : "memory.recent";
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method,
      params: buildScopedParams(params, requestContext.agentId),
    });
    const memoryViewerState = getMemoryViewerState();
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    if (!res || !res.ok) {
      renderMemoryViewerListEmpty(t("memory.memoryListLoadFailed", {}, "Failed to load memory list."));
      renderMemoryViewerDetailEmpty(res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."));
      return;
    }

    const items = Array.isArray(res.payload?.items) ? res.payload.items : [];
    memoryViewerState.items = items;
    memoryViewerState.memoryQueryView = res.payload?.queryView ?? memoryViewerState.memoryQueryView ?? null;
    resetStoredListPage("memories");
    renderMemoryViewerStats(memoryViewerState.stats);

    if (!items.length) {
      memoryViewerState.selectedId = null;
      renderMemoryList(items);
      renderMemoryViewerDetailEmpty(t("memory.noMatchingMemories", {}, "No matching memories."));
      return;
    }

    const selectedExists = items.some((item) => item.id === memoryViewerState.selectedId);
    if (forceSelectFirst || !selectedExists) {
      memoryViewerState.selectedId = items[0].id;
    }

    renderMemoryList(items);
    await loadMemoryDetail(memoryViewerState.selectedId, requestContext);
  }

  async function loadSharedReviewQueue(forceSelectFirst = false, existingContext = null) {
    const requestContext = createMemoryViewerRequestContext(existingContext);
    renderMemoryViewerListEmpty(t("memory.sharedReviewLoading", {}, "Loading shared review inbox..."));
    renderMemoryViewerDetailEmpty(t("memory.sharedReviewDetailLoading", {}, "Loading shared review details..."));

    const query = memorySearchInputEl ? memorySearchInputEl.value.trim() : "";
    const params = buildSharedReviewQueueParams({
      reviewerAgentId: requestContext.agentId,
      limit: 50,
      query,
      governanceStatus: memoryChunkGovernanceFilterEl?.value || "pending",
      sharedReviewFilters: getSharedReviewFilters(),
    });

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "memory.share.queue",
      params,
    });
    const memoryViewerState = getMemoryViewerState();
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    if (!res || !res.ok) {
      memoryViewerState.sharedReviewSummary = null;
      memoryViewerState.items = [];
      clearSharedReviewSelection();
      renderMemoryViewerStats(null);
      renderSharedReviewBatchBar();
      renderMemoryViewerListEmpty(t("memory.sharedReviewLoadFailed", {}, "Failed to load shared review inbox."));
      renderMemoryViewerDetailEmpty(res?.error?.message || t("memory.sharedReviewDetailLoadFailed", {}, "Failed to read shared review data."));
      return;
    }

    const items = Array.isArray(res.payload?.items) ? res.payload.items : [];
    memoryViewerState.items = items;
    memoryViewerState.sharedReviewSummary = res.payload?.summary ?? null;
    resetStoredListPage("sharedReview");
    syncSelectedSharedReviewIds(items);
    renderMemoryViewerStats(memoryViewerState.stats);
    renderSharedReviewBatchBar();

    if (!items.length) {
      memoryViewerState.selectedId = null;
      renderSharedReviewList(items);
      renderMemoryViewerDetailEmpty(t("memory.sharedReviewEmpty", {}, "There are no shared review items right now."));
      return;
    }

    const selectedExists = items.some((item) => item.id === memoryViewerState.selectedId);
    if (forceSelectFirst || !selectedExists) {
      memoryViewerState.selectedId = items[0].id;
    }

    renderSharedReviewList(items);
    const selected = items.find((item) => item.id === memoryViewerState.selectedId);
    await loadMemoryDetail(memoryViewerState.selectedId, requestContext, {
      targetAgentId: selected?.targetAgentId,
    });
  }

  function renderMemoryViewerStats(stats) {
    if (!memoryViewerStatsEl) return;
    const memoryViewerState = getMemoryViewerState();
    if (!stats) {
      if (memoryViewerState.tab === "sharedReview" && memoryViewerState.sharedReviewSummary) {
        stats = {};
      } else if (memoryViewerState.tab === "outboundAudit") {
        stats = {};
      } else {
        memoryViewerStatsEl.innerHTML = `
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statFiles", {}, "Memory Files"))}</span><strong class="memory-stat-value">--</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statChunks", {}, "Memory Chunks"))}</span><strong class="memory-stat-value">--</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statVectors", {}, "Vector Index"))}</span><strong class="memory-stat-value">--</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSummaries", {}, "Summaries Ready"))}</span><strong class="memory-stat-value">--</strong></div>
        `;
        return;
      }
    }

    if (memoryViewerState.tab === "outboundAudit") {
      const items = Array.isArray(memoryViewerState.items) ? memoryViewerState.items : [];
      if (getOutboundAuditFocus() === "threads") {
        const summary = buildEmailThreadOrganizerStats(items);
        memoryViewerStatsEl.innerHTML = `
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statCurrentResults", {}, "Current Results"))}</span><strong class="memory-stat-value">${formatCount(summary.threadCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatNeedsReply", {}, "待回复线程"))}</span><strong class="memory-stat-value">${formatCount(summary.needsReplyCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatNeedsFollowUp", {}, "待跟进线程"))}</span><strong class="memory-stat-value">${formatCount(summary.needsFollowUpCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatReminderPending", {}, "待提醒线程"))}</span><strong class="memory-stat-value">${formatCount(summary.reminderPendingCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatReminderDelivered", {}, "已提醒线程"))}</span><strong class="memory-stat-value">${formatCount(summary.reminderDeliveredCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatReplyReview", {}, "回复待复核"))}</span><strong class="memory-stat-value">${formatCount(summary.replyReviewRequiredCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatFailed", {}, "有失败记录"))}</span><strong class="memory-stat-value">${formatCount(summary.failedThreadCount)}</strong></div>
          <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.emailThreadOrganizerStatRetry", {}, "待重试线程"))}</span><strong class="memory-stat-value">${formatCount(summary.retryScheduledCount)}</strong></div>
        `;
        return;
      }
      const outboundSentCount = items.filter((item) => item?.auditKind !== "email_inbound" && item?.delivery === "sent").length;
      const outboundFailedCount = items.filter((item) => item?.auditKind !== "email_inbound" && item?.delivery === "failed").length;
      const inboundProcessedCount = items.filter((item) => item?.auditKind === "email_inbound" && item?.status === "processed").length;
      const inboundFailedCount = items.filter((item) => item?.auditKind === "email_inbound" && item?.status === "failed").length;
      const inboundDuplicateCount = items.filter((item) => item?.auditKind === "email_inbound" && item?.status === "skipped_duplicate").length;
      memoryViewerStatsEl.innerHTML = `
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statCurrentResults", {}, "Current Results"))}</span><strong class="memory-stat-value">${formatCount(items.length)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.outboundAuditStatSent", {}, "外发已发送"))}</span><strong class="memory-stat-value">${formatCount(outboundSentCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.outboundAuditStatFailed", {}, "外发失败"))}</span><strong class="memory-stat-value">${formatCount(outboundFailedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.outboundAuditStatInboundProcessed", {}, "收信已处理"))}</span><strong class="memory-stat-value">${formatCount(inboundProcessedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.outboundAuditStatInboundFailed", {}, "收信失败"))}</span><strong class="memory-stat-value">${formatCount(inboundFailedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.outboundAuditStatInboundDuplicate", {}, "收信重复跳过"))}</span><strong class="memory-stat-value">${formatCount(inboundDuplicateCount)}</strong></div>
      `;
      return;
    }

    if (memoryViewerState.tab === "sharedReview") {
      const summary = memoryViewerState.sharedReviewSummary || {};
      const byAgent = Array.isArray(summary.byAgent) ? summary.byAgent.slice(0, 3) : [];
      const byReviewer = Array.isArray(summary.byReviewer) ? summary.byReviewer.slice(0, 3) : [];
      const agentSummary = byAgent.length
        ? byAgent.map((item) => `${item.displayName || item.agentId} ${formatCount(item.totalCount)}`).join(" · ")
        : t("memory.sharedReviewAgentSummaryEmpty", {}, "No resident backlog.");
      const reviewerSummary = byReviewer.length
        ? byReviewer.map((item) => `${item.agentId} ${formatCount(item.count)}`).join(" · ")
        : t("memory.sharedReviewReviewerSummaryEmpty", {}, "No claimed owner.");
      memoryViewerStatsEl.innerHTML = `
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewActingAs", {}, "Acting Reviewer"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(summary.reviewerAgentId || getActiveAgentId())}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSharedPendingQueue", {}, "Pending Shared Queue"))}</span><strong class="memory-stat-value">${formatCount(summary.pendingCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewActionableCount", {}, "Actionable Now"))}</span><strong class="memory-stat-value">${formatCount(summary.reviewerActionableCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewMyClaims", {}, "My Claims"))}</span><strong class="memory-stat-value">${formatCount(summary.reviewerClaimedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewOverdueCount", {}, "Timed-out Claims"))}</span><strong class="memory-stat-value">${formatCount(summary.overdueCount)}</strong><div class="memory-stat-caption">${escapeHtml(t("memory.sharedReviewOverdueHint", { duration: formatDuration(summary.claimTimeoutMs) }, `Timeout after ${formatDuration(summary.claimTimeoutMs)}`))}</div></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewBlockedCount", {}, "Blocked by Others"))}</span><strong class="memory-stat-value">${formatCount(summary.blockedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewAgentBacklog", {}, "Backlog by Agent"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(agentSummary)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewReviewerBacklog", {}, "Backlog by Reviewer"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(reviewerSummary)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.sharedReviewCompletedCount", {}, "Reviewed History"))}</span><strong class="memory-stat-value">${formatCount((Number(summary.approvedCount) || 0) + (Number(summary.rejectedCount) || 0) + (Number(summary.revokedCount) || 0))}</strong></div>
      `;
      return;
    }

    if (memoryViewerState.tab === "memories") {
      const items = Array.isArray(memoryViewerState.items) ? memoryViewerState.items : [];
      const currentCategorized = items.filter((item) => Boolean(item?.category)).length;
      const currentUncategorized = items.length - currentCategorized;
      const activeCategoryLabel = getActiveMemoryCategoryLabel();
      const distributionCard = renderMemoryCategoryDistribution(stats);
      const queryView = memoryViewerState.memoryQueryView;
      const sharedGovernance = memoryViewerState.sharedGovernance;
      const governanceFilterLabel = formatGovernanceFilterLabel(memoryChunkGovernanceFilterEl?.value);

      memoryViewerStatsEl.innerHTML = `
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statCurrentResults", {}, "Current Results"))}</span><strong class="memory-stat-value">${formatCount(items.length)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statQueryStrategy", {}, "Current Query Strategy"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(formatResidentQueryModeLabel(queryView))}</strong><div class="memory-stat-caption">${escapeHtml(formatResidentQueryModeSummary(queryView))}</div></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statGovernanceFilter", {}, "Current Governance Filter"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(governanceFilterLabel)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSharedPendingQueue", {}, "Pending Shared Queue"))}</span><strong class="memory-stat-value">${formatCount(sharedGovernance?.pendingCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSharedClaimed", {}, "Claimed Pending"))}</span><strong class="memory-stat-value">${formatCount(sharedGovernance?.claimedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSharedApproved", {}, "Approved Shared"))}</span><strong class="memory-stat-value">${formatCount(sharedGovernance?.approvedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSharedRejected", {}, "Rejected Shared"))}</span><strong class="memory-stat-value">${formatCount(sharedGovernance?.rejectedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statSharedRevoked", {}, "Revoked Shared"))}</span><strong class="memory-stat-value">${formatCount(sharedGovernance?.revokedCount)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statFilteredCategory", {}, "Filtered Category"))}</span><strong class="memory-stat-value">${escapeHtml(activeCategoryLabel)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statCurrentCategorized", {}, "Currently Categorized"))}</span><strong class="memory-stat-value">${formatCount(currentCategorized)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statCurrentUncategorized", {}, "Currently Uncategorized"))}</span><strong class="memory-stat-value">${formatCount(currentUncategorized)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statLibraryCategorized", {}, "Library Categorized"))}</span><strong class="memory-stat-value">${formatCount(stats.categorized)}</strong></div>
        <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statLibraryUncategorized", {}, "Library Uncategorized"))}</span><strong class="memory-stat-value">${formatCount(stats.uncategorized)}</strong></div>
        ${distributionCard}
      `;
      return;
    }

    const selectedTask = memoryViewerState.selectedTask;
    const usedMethods = Array.isArray(selectedTask?.usedMethods) ? selectedTask.usedMethods : [];
    const usedSkills = Array.isArray(selectedTask?.usedSkills) ? selectedTask.usedSkills : [];
    const lastUsedAt = getLatestExperienceUsageTimestamp(usedMethods, usedSkills);
    const activeGoalId = memoryViewerState.goalIdFilter;
    const activeGoalLabel = activeGoalId ? getGoalDisplayName(activeGoalId) : "-";
    const queryView = memoryViewerState.experienceQueryView || memoryViewerState.memoryQueryView;

    memoryViewerStatsEl.innerHTML = `
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statCurrentTaskResults", {}, "Current Task Results"))}</span><strong class="memory-stat-value">${formatCount(Array.isArray(memoryViewerState.items) ? memoryViewerState.items.length : 0)}</strong></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statExperienceQueryStrategy", {}, "Current Experience Query Strategy"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(formatResidentQueryModeLabel(queryView))}</strong><div class="memory-stat-caption">${escapeHtml(formatResidentQueryModeSummary(queryView))}</div></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statUsedMethods", {}, "Methods Used"))}</span><strong class="memory-stat-value">${formatCount(usedMethods.length)}</strong></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statUsedSkills", {}, "Skills Used"))}</span><strong class="memory-stat-value">${formatCount(usedSkills.length)}</strong></div>
      <div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statLastUsedAt", {}, "Last Used At"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(formatDateTime(lastUsedAt))}</strong></div>
      ${activeGoalId ? `<div class="memory-stat-card"><span class="memory-stat-label">${escapeHtml(t("memory.statGoalFilter", {}, "Goal Filter"))}</span><strong class="memory-stat-value memory-stat-value-compact">${escapeHtml(activeGoalLabel)}</strong><div class="memory-stat-caption">${escapeHtml(activeGoalId)}</div></div>` : ""}
    `;
    bindStatsAuditJumpLinks();
  }

  function renderTaskList(items) {
    if (!memoryViewerListEl) return;
    if (!items.length) {
      resetStoredListPage("tasks");
      renderMemoryViewerListEmpty(t("memory.emptyNoTasks", {}, "No tasks to display."));
      return;
    }

    const memoryViewerState = getMemoryViewerState();
    const resolveTaskId = (item) => String(item?.id || "").trim();
    const pagination = resolveMemoryViewerPagination(items, resolveTaskId, { alignToSelected: true });
    memoryViewerListEl.innerHTML = pagination.visibleItems.map((item) => {
      const title = item.title || item.objective || item.summary || item.conversationId || item.id;
      const snippet = item.summary || item.outcome || item.objective || t("memory.emptyNoSummary", {}, "No summary");
      const isActive = item.id === memoryViewerState.selectedId;
      const goalId = getTaskGoalId(item);
      return `
        <div class="memory-list-item ${isActive ? "active" : ""}" data-task-id="${escapeHtml(item.id)}">
          <div class="memory-list-item-title">${escapeHtml(title)}</div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(formatTaskStatusLabel(item.status))}</span>
            <span>${escapeHtml(formatTaskSourceLabel(item.source))}</span>
            ${goalId ? `<span class="memory-badge memory-badge-shared">${escapeHtml(getGoalDisplayName(goalId))}</span>` : ""}
            <span>${escapeHtml(formatDateTime(item.finishedAt || item.startedAt || item.createdAt))}</span>
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(snippet)}</div>
        </div>
      `;
    }).join("") + renderMemoryViewerPaginationFooter(pagination);

    memoryViewerListEl.querySelectorAll("[data-task-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const taskId = node.getAttribute("data-task-id");
        if (!taskId) return;
        memoryViewerState.selectedId = taskId;
        setActiveMemoryViewerListItem(node);
        await loadTaskDetail(taskId);
      });
    });
    bindMemoryViewerPaginationControls({
      items,
      pagination,
      renderList: renderTaskList,
      resolveItemId: resolveTaskId,
      onPageSelected: async (_item, taskId) => {
        if (!taskId) return;
        await loadTaskDetail(taskId);
      },
    });
  }

  function setActiveMemoryViewerListItem(node) {
    if (!memoryViewerListEl || !node) return;
    const activeNode = memoryViewerListEl.querySelector(".memory-list-item.active");
    if (activeNode && activeNode !== node) {
      activeNode.classList.remove("active");
    }
    if (!node.classList.contains("active")) {
      node.classList.add("active");
    }
  }

  function renderMemoryList(items) {
    if (!memoryViewerListEl) return;
    if (!items.length) {
      resetStoredListPage("memories");
      renderMemoryViewerListEmpty(t("memory.emptyNoMemories", {}, "No memories to display."));
      return;
    }

    const memoryViewerState = getMemoryViewerState();
    const resolveMemoryId = (item) => String(item?.id || "").trim();
    const pagination = resolveMemoryViewerPagination(items, resolveMemoryId, { alignToSelected: true });
    memoryViewerListEl.innerHTML = pagination.visibleItems.map((item) => {
      const title = summarizeSourcePath(item.sourcePath);
      const summary = item.summary || item.snippet || t("memory.emptyNoSummary", {}, "No summary");
      const isActive = item.id === memoryViewerState.selectedId;
      const visibility = normalizeMemoryVisibility(item.visibility);
      const category = formatMemoryCategory(item.category);
      const sourceView = item.sourceView || { scope: visibility };
      return `
        <div class="memory-list-item ${isActive ? "active" : ""}" data-memory-id="${escapeHtml(item.id)}">
          <div class="memory-list-item-title">${escapeHtml(title)}</div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(formatMemoryTypeLabel(item.memoryType))}</span>
            <span>${escapeHtml(formatMemorySourceTypeLabel(item.sourceType))}</span>
            <span class="memory-badge ${getVisibilityBadgeClass(visibility)}">${escapeHtml(visibility)}</span>
            ${renderSourceViewBadge(sourceView)}
            <span class="memory-badge">${escapeHtml(category)}</span>
            <span>score ${formatScore(item.score)}</span>
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(summary)}</div>
        </div>
      `;
    }).join("") + renderMemoryViewerPaginationFooter(pagination);

    memoryViewerListEl.querySelectorAll("[data-memory-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const chunkId = node.getAttribute("data-memory-id");
        if (!chunkId) return;
        memoryViewerState.selectedId = chunkId;
        setActiveMemoryViewerListItem(node);
        await loadMemoryDetail(chunkId);
      });
    });
    bindMemoryViewerPaginationControls({
      items,
      pagination,
      renderList: renderMemoryList,
      resolveItemId: resolveMemoryId,
      onPageSelected: async (_item, chunkId) => {
        if (!chunkId) return;
        await loadMemoryDetail(chunkId);
      },
    });
  }

  function renderSharedReviewList(items) {
    if (!memoryViewerListEl) return;
    if (!items.length) {
      resetStoredListPage("sharedReview");
      renderMemoryViewerListEmpty(t("memory.sharedReviewEmpty", {}, "There are no shared review items right now."));
      renderSharedReviewBatchBar();
      return;
    }

    const memoryViewerState = getMemoryViewerState();
    const selectedIds = new Set(getSelectedSharedReviewIds());
    const resolveSharedReviewId = (item) => String(item?.id || "").trim();
    const pagination = resolveMemoryViewerPagination(items, resolveSharedReviewId, { alignToSelected: true });
    memoryViewerListEl.innerHTML = pagination.visibleItems.map((item) => {
      const title = summarizeSourcePath(item.sourcePath);
      const summary = item.summary || item.snippet || t("memory.emptyNoSummary", {}, "No summary");
      const isActive = item.id === memoryViewerState.selectedId;
      const isSelected = selectedIds.has(item.id);
      const visibility = normalizeMemoryVisibility(item.visibility);
      const category = formatMemoryCategory(item.category);
      const sourceView = item.sourceView || { scope: visibility };
      const promotion = getMemorySharePromotionMetadata(item);
      const claimState = getMemoryShareClaimState(item);
      const claimOwner = claimState.claimOwner;
      const targetLabel = item.targetDisplayName || item.targetAgentId || promotion?.sourceAgentId || "-";
      const statusLabel = formatMemorySharePromotionStatusLabel(item.reviewStatus || normalizeMemorySharePromotionStatus(item));
      const requestedAt = promotion?.requestedAt || item.updatedAt || "";
      const currentAgentId = getActiveAgentId();
      const claimBadge = claimState.claimTimedOut
        ? `<span class="memory-badge memory-badge-shared">${escapeHtml(t("memory.sharedReviewOverdueBadge", {}, "Claim Timed Out"))}</span>`
        : claimOwner
          ? `<span class="memory-badge ${claimOwner === currentAgentId ? "memory-badge-shared" : "memory-badge-hybrid"}">${escapeHtml(`${t("memory.detailSharedClaim", {}, "Review Claim")}: ${claimOwner}`)}</span>`
          : "";
      const queueStateBadge = claimState.blockedByOtherReviewer
        ? `<span class="memory-badge memory-badge-hybrid">${escapeHtml(t("memory.sharedReviewBlockedBadge", {}, "Blocked"))}</span>`
        : claimState.actionableByReviewer
          ? `<span class="memory-badge memory-badge-private">${escapeHtml(t("memory.sharedReviewActionableBadge", {}, "Actionable"))}</span>`
          : "";
      const claimDeadline = claimState.claimExpiresAt
        ? `<span>${escapeHtml(
          claimState.claimTimedOut
            ? t("memory.sharedReviewExpiredAt", { time: formatDateTime(claimState.claimExpiresAt) }, `Expired ${formatDateTime(claimState.claimExpiresAt)}`)
            : t("memory.sharedReviewExpiresAt", { time: formatDateTime(claimState.claimExpiresAt) }, `Expires ${formatDateTime(claimState.claimExpiresAt)}`),
        )}</span>`
        : "";
      return `
        <div class="memory-list-item ${isActive ? "active" : ""}" data-shared-review-memory-id="${escapeHtml(item.id)}" data-shared-review-target-agent-id="${escapeHtml(item.targetAgentId || "")}">
          <div class="memory-list-item-head">
            <label class="memory-list-selector">
              <input type="checkbox" data-shared-review-select="${escapeHtml(item.id)}" ${isSelected ? "checked" : ""}>
            </label>
            <div class="memory-list-item-title">${escapeHtml(title)}</div>
          </div>
          <div class="memory-list-item-meta">
            <span class="memory-badge">${escapeHtml(targetLabel)}</span>
            <span class="memory-badge">${escapeHtml(statusLabel)}</span>
            ${claimBadge}
            ${queueStateBadge}
            ${renderSourceViewBadge(sourceView)}
            <span class="memory-badge">${escapeHtml(category)}</span>
            ${claimDeadline}
            <span>${escapeHtml(formatDateTime(requestedAt))}</span>
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(summary)}</div>
        </div>
      `;
    }).join("") + renderMemoryViewerPaginationFooter(pagination);

    memoryViewerListEl.querySelectorAll("[data-shared-review-select]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      node.addEventListener("change", () => {
        const chunkId = node.getAttribute("data-shared-review-select");
        toggleSharedReviewSelection(chunkId, node.checked);
        renderSharedReviewBatchBar();
      });
    });

    memoryViewerListEl.querySelectorAll("[data-shared-review-memory-id]").forEach((node) => {
      node.addEventListener("click", async () => {
        const chunkId = node.getAttribute("data-shared-review-memory-id");
        const targetAgentId = node.getAttribute("data-shared-review-target-agent-id");
        if (!chunkId) return;
        memoryViewerState.selectedId = chunkId;
        setActiveMemoryViewerListItem(node);
        await loadMemoryDetail(chunkId, null, { targetAgentId });
      });
    });
    bindMemoryViewerPaginationControls({
      items,
      pagination,
      renderList: renderSharedReviewList,
      resolveItemId: resolveSharedReviewId,
      onPageSelected: async (item, chunkId) => {
        if (!chunkId) return;
        await loadMemoryDetail(chunkId, null, { targetAgentId: item?.targetAgentId });
      },
    });
    renderSharedReviewBatchBar();
  }

  function renderExternalOutboundAuditList(items) {
    if (!memoryViewerListEl) return;
    if (!items.length) {
      resetStoredListPage("outboundAudit");
      renderMemoryViewerListEmpty(t("memory.outboundAuditEmpty", {}, "当前还没有匹配的消息审计记录。"));
      return;
    }

    const memoryViewerState = getMemoryViewerState();
    const resolveAuditItemId = (item, index) => getExternalOutboundAuditItemId(item, index);
    const pagination = resolveMemoryViewerPagination(items, resolveAuditItemId, { alignToSelected: true });
    memoryViewerListEl.innerHTML = pagination.visibleItems.map((item, index) => {
      const absoluteIndex = pagination.startIndex + index;
      const itemId = resolveAuditItemId(item, absoluteIndex);
      const isActive = itemId === memoryViewerState.selectedId;
      if (item?.auditKind === "email_thread_organizer") {
        const title = item?.latestSubject || item?.threadId || item?.conversationId || t("memory.emailThreadOrganizerUntitled", {}, "未命名邮件线程");
        const stateParts = [
          item?.latestTriageCategory,
          item?.needsReply ? t("memory.emailThreadOrganizerNeedsReplyBadge", {}, "待回复") : "",
          item?.needsFollowUp ? t("memory.emailThreadOrganizerNeedsFollowUpBadge", {}, "待跟进") : "",
          item?.reminderStatus === "pending" ? t("memory.emailThreadOrganizerReminderPendingBadge", {}, "待提醒") : "",
          item?.reminderStatus === "delivered" ? t("memory.emailThreadOrganizerReminderDeliveredBadge", {}, "已提醒") : "",
        ].filter(Boolean);
        const snippet = item?.latestTriageSummary || item?.latestPreview || t("memory.outboundAuditPreviewEmpty", {}, "(空文本)");
        return `
          <div class="memory-list-item ${isActive ? "active" : ""}" data-outbound-audit-id="${escapeHtml(itemId)}">
            <div class="memory-list-item-title">${escapeHtml(title)}</div>
            <div class="memory-list-item-meta">
              <span>${escapeHtml(formatDateTime(item?.latestTimestamp))}</span>
              <span>${escapeHtml(item?.latestSender || item?.targetAccountId || "-")}</span>
              <span>${escapeHtml(stateParts.join(" / ") || t("memory.emailThreadOrganizerStateNeutral", {}, "线程整理"))}</span>
            </div>
            <div class="memory-list-item-snippet">${escapeHtml(snippet)}</div>
          </div>
        `;
      }
      const channel = formatOutboundAuditChannelLabel(item);
      const preview = formatOutboundAuditPreview(item);
      const stateSummary = item?.auditKind === "email_inbound"
        ? formatEmailInboundStatusLabel(item?.status)
        : `${formatExternalOutboundDecisionLabel(item?.decision)} / ${formatExternalOutboundDeliveryLabel(item?.delivery)}`;
      return `
        <div class="memory-list-item ${isActive ? "active" : ""}" data-outbound-audit-id="${escapeHtml(itemId)}">
          <div class="memory-list-item-title">${escapeHtml(`${channel} · ${stateSummary}`)}</div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(formatDateTime(item?.timestamp))}</span>
            <span>${escapeHtml(item?.requestId || item?.messageId || "-")}</span>
            <span>${escapeHtml(item?.requestedByAgentId || item?.requestedAgentId || "-")}</span>
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(preview)}</div>
        </div>
      `;
    }).join("") + renderMemoryViewerPaginationFooter(pagination);

    memoryViewerListEl.querySelectorAll("[data-outbound-audit-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const itemId = node.getAttribute("data-outbound-audit-id");
        if (!itemId) return;
        memoryViewerState.selectedId = itemId;
        renderExternalOutboundAuditList(memoryViewerState.items);
        const selected = (Array.isArray(memoryViewerState.items) ? memoryViewerState.items : [])
          .find((item, index) => getExternalOutboundAuditItemId(item, index) === itemId);
        renderExternalOutboundAuditDetail(selected || null);
      });
    });
    bindMemoryViewerPaginationControls({
      items,
      pagination,
      renderList: renderExternalOutboundAuditList,
      resolveItemId: resolveAuditItemId,
      onPageSelected: (item) => {
        renderExternalOutboundAuditDetail(item || null);
      },
    });
  }

  function renderExternalOutboundAuditDetail(item) {
    if (!memoryViewerDetailEl) return;
    if (!item) {
      renderMemoryViewerDetailEmpty(t("memory.outboundAuditNoSelection", {}, "请选择一条消息审计记录。"));
      return;
    }

    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();

    if (item?.auditKind === "email_thread_organizer") {
      const badges = [
        item?.providerId ? `<span class="memory-badge">${escapeHtml(`email-inbound/${item.providerId}`)}</span>` : "",
        item?.latestTriageCategory ? `<span class="memory-badge">${escapeHtml(item.latestTriageCategory)}</span>` : "",
        item?.latestTriagePriority ? `<span class="memory-badge">${escapeHtml(item.latestTriagePriority)}</span>` : "",
        item?.needsReply ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerNeedsReplyBadge", {}, "待回复"))}</span>` : "",
        item?.needsFollowUp ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerNeedsFollowUpBadge", {}, "待跟进"))}</span>` : "",
        item?.latestSuggestedReplyQuality === "review_required" ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerReplyReviewBadge", {}, "回复待复核"))}</span>` : "",
        item?.reminderStatus === "pending" ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerReminderPendingBadge", {}, "待提醒"))}</span>` : "",
        item?.reminderStatus === "delivered" ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerReminderDeliveredBadge", {}, "已提醒"))}</span>` : "",
        item?.reminderStatus === "resolved" ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerReminderResolvedBadge", {}, "提醒已解除"))}</span>` : "",
      ].filter(Boolean).join("");
      const retryState = item?.retryExhaustedCount
        ? t("memory.outboundAuditInboundRetryExhausted", { count: item.retryExhaustedCount }, "已耗尽（{count} 次）")
        : item?.retryScheduledCount
          ? t("memory.outboundAuditInboundRetryScheduled", { count: item.retryScheduledCount }, "待重试（第 {count} 次）")
          : "-";
      const preview = item?.latestPreview || t("memory.outboundAuditPreviewEmpty", {}, "(空文本)");
      memoryViewerDetailEl.innerHTML = `
        <div class="memory-detail-shell">
          <div class="memory-detail-card">
            <div class="memory-detail-title">${escapeHtml(t("memory.emailThreadOrganizerTitle", {}, "邮件线程整理"))}</div>
            <div class="memory-detail-badges">${badges}</div>
            <div class="memory-detail-actions">
              <button class="button" data-open-email-thread-conversation="${escapeHtml(item?.conversationId || "")}" ${item?.conversationId ? "" : "disabled"}>${escapeHtml(t("memory.emailThreadOrganizerOpenConversation", {}, "打开线程会话"))}</button>
            </div>
          </div>
          <div class="memory-detail-grid">
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundConversation", {}, "会话"))}</span><div class="memory-detail-text">${escapeHtml(item?.conversationId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditProvider", {}, "Provider"))}</span><div class="memory-detail-text">${escapeHtml(item?.providerId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditTargetAccountId", {}, "目标 Account ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.targetAccountId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundAgent", {}, "处理 Agent"))}</span><div class="memory-detail-text">${escapeHtml(item?.requestedAgentId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditSubject", {}, "主题"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestSubject || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSender", {}, "发件人"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestSender || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerMessageCount", {}, "线程消息数"))}</span><div class="memory-detail-text">${escapeHtml(String(Number(item?.messageCount) || 0))}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundStatus", {}, "处理状态"))}</span><div class="memory-detail-text">${escapeHtml(formatEmailInboundStatusLabel(item?.latestStatus))}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriageCategory", {}, "整理分类"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestTriageCategory || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriagePriority", {}, "整理优先级"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestTriagePriority || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriageDisposition", {}, "建议动作"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestTriageDisposition || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriageSummary", {}, "整理摘要"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestTriageSummary || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyQuality", {}, "回复建议质量"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestSuggestedReplyQuality || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundRetryState", {}, "重试状态"))}</span><div class="memory-detail-text">${escapeHtml(retryState)}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerReminderStatus", {}, "提醒状态"))}</span><div class="memory-detail-text">${escapeHtml(item?.reminderStatus || "-")}</div></div>
            ${compactGovernanceDetailMode ? "" : `
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditThreadId", {}, "线程 ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.threadId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundMessageId", {}, "Message ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestMessageId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundFollowUpWindow", {}, "建议跟进窗口"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestTriageFollowUpWindowHours ? `${item.latestTriageFollowUpWindowHours}h` : "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyStarter", {}, "建议回复 starter"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestSuggestedReplyStarter || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyConfidence", {}, "回复建议置信度"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestSuggestedReplyConfidence || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplySubject", {}, "建议回复主题"))}</span><div class="memory-detail-text">${escapeHtml(item?.latestSuggestedReplySubject || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerProcessedCount", {}, "已处理消息"))}</span><div class="memory-detail-text">${escapeHtml(String(Number(item?.processedCount) || 0))}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerFailedCount", {}, "失败消息"))}</span><div class="memory-detail-text">${escapeHtml(String(Number(item?.failedCount) || 0))}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerReminderDueAt", {}, "提醒时间"))}</span><div class="memory-detail-text">${escapeHtml(item?.reminderDueAt ? formatDateTime(item.reminderDueAt) : "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerReminderDeliveredAt", {}, "最近提醒"))}</span><div class="memory-detail-text">${escapeHtml(item?.reminderLastDeliveredAt ? formatDateTime(item.reminderLastDeliveredAt) : "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.emailThreadOrganizerReminderResolution", {}, "提醒解除"))}</span><div class="memory-detail-text">${escapeHtml(item?.reminderResolvedAt ? formatDateTime(item.reminderResolvedAt) : (item?.reminderResolutionSource || "-"))}</div></div>
            `}
          </div>
          ${!compactGovernanceDetailMode && Array.isArray(item?.latestSuggestedReplyWarnings) && item.latestSuggestedReplyWarnings.length > 0 ? `
            <div class="memory-detail-card">
              <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyWarnings", {}, "回复建议风险"))}</span>
              <pre class="memory-detail-pre">${escapeHtml(item.latestSuggestedReplyWarnings.join("\n"))}</pre>
            </div>
          ` : ""}
          ${!compactGovernanceDetailMode && Array.isArray(item?.latestSuggestedReplyChecklist) && item.latestSuggestedReplyChecklist.length > 0 ? `
            <div class="memory-detail-card">
              <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyChecklist", {}, "回复建议检查清单"))}</span>
              <pre class="memory-detail-pre">${escapeHtml(item.latestSuggestedReplyChecklist.join("\n"))}</pre>
            </div>
          ` : ""}
          ${!compactGovernanceDetailMode && item?.latestSuggestedReplyDraft ? `
            <div class="memory-detail-card">
              <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyDraft", {}, "建议回复草稿"))}</span>
              <pre class="memory-detail-pre">${escapeHtml(item.latestSuggestedReplyDraft)}</pre>
            </div>
          ` : ""}
          <div class="memory-detail-card">
            <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditContentPreview", {}, "消息预览"))}</span>
            <pre class="memory-detail-pre">${escapeHtml(preview)}</pre>
          </div>
        </div>
      `;
      memoryViewerDetailEl.querySelectorAll("[data-open-email-thread-conversation]").forEach((node) => {
        node.addEventListener("click", () => {
          const conversationId = node.getAttribute("data-open-email-thread-conversation");
          if (!conversationId) return;
          openConversationSession?.(
            conversationId,
            t("memory.emailThreadOrganizerSwitchedConversation", { conversationId }, `Switched to email thread conversation: ${conversationId}`),
            {
              systemNoticeText: buildEmailThreadConversationOpenNote(item, t),
            },
          );
          void requestEmailThreadConversationAdvice(conversationId, item);
        });
      });
      return;
    }

    const preview = formatOutboundAuditPreview(item);
    const isEmailOutboundAudit = item?.auditKind === "email";
    const isEmailInboundAudit = item?.auditKind === "email_inbound";
    const isEmailAudit = isEmailOutboundAudit || isEmailInboundAudit;
    const diagnosis = isEmailOutboundAudit ? {
      stageLabel: t("memory.outboundAuditEmailFailureStage", {}, "邮件投递"),
      summary: formatEmailOutboundDiagnosis(item),
    } : isEmailInboundAudit ? {
      stageLabel: t("memory.outboundAuditEmailInboundFailureStage", {}, "邮件收信"),
      summary: formatEmailInboundDiagnosis(item),
    } : buildExternalOutboundDiagnosis({
      errorCode: item?.errorCode,
      error: item?.error,
      targetSessionKey: item?.targetSessionKey,
      delivery: item?.delivery,
    }, t);
    const senderSummary = Array.isArray(item?.from) ? item.from.join(", ") : "";
    const recipientSummary = [
      ...(Array.isArray(item?.to) ? item.to : []),
      ...(Array.isArray(item?.cc) ? item.cc : []),
      ...(Array.isArray(item?.bcc) ? item.bcc : []),
    ].join(", ");
    const badgeMarkup = isEmailInboundAudit
      ? `
            <span class="memory-badge">${escapeHtml(formatOutboundAuditChannelLabel(item))}</span>
            <span class="memory-badge">${escapeHtml(formatEmailInboundStatusLabel(item?.status))}</span>
            <span class="memory-badge">${escapeHtml(item?.createdBinding ? t("memory.outboundAuditInboundThreadBindingNew", {}, "新建线程会话") : t("memory.outboundAuditInboundThreadBindingExisting", {}, "复用线程会话"))}</span>
            ${item?.triageCategory ? `<span class="memory-badge">${escapeHtml(item.triageCategory)}</span>` : ""}
            ${item?.triagePriority ? `<span class="memory-badge">${escapeHtml(item.triagePriority)}</span>` : ""}
            ${item?.suggestedReplyQuality === "review_required" ? `<span class="memory-badge">${escapeHtml(t("memory.emailThreadOrganizerReplyReviewBadge", {}, "回复待复核"))}</span>` : ""}
      `
      : `
            <span class="memory-badge">${escapeHtml(formatOutboundAuditChannelLabel(item))}</span>
            <span class="memory-badge">${escapeHtml(formatExternalOutboundDecisionLabel(item?.decision))}</span>
            <span class="memory-badge">${escapeHtml(formatExternalOutboundDeliveryLabel(item?.delivery))}</span>
      `;
    const detailGrid = isEmailInboundAudit ? `
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditTime", {}, "时间"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(item?.timestamp))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundConversation", {}, "会话"))}</span><div class="memory-detail-text">${escapeHtml(item?.conversationId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundAgent", {}, "处理 Agent"))}</span><div class="memory-detail-text">${escapeHtml(item?.requestedAgentId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditProvider", {}, "Provider"))}</span><div class="memory-detail-text">${escapeHtml(item?.providerId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditTargetAccountId", {}, "目标 Account ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.targetAccountId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSender", {}, "发件人"))}</span><div class="memory-detail-text">${escapeHtml(senderSummary || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditSubject", {}, "主题"))}</span><div class="memory-detail-text">${escapeHtml(item?.subject || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundStatus", {}, "处理状态"))}</span><div class="memory-detail-text">${escapeHtml(formatEmailInboundStatusLabel(item?.status))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriageCategory", {}, "整理分类"))}</span><div class="memory-detail-text">${escapeHtml(item?.triageCategory || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriagePriority", {}, "整理优先级"))}</span><div class="memory-detail-text">${escapeHtml(item?.triagePriority || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriageDisposition", {}, "建议动作"))}</span><div class="memory-detail-text">${escapeHtml(item?.triageDisposition || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundTriageSummary", {}, "整理摘要"))}</span><div class="memory-detail-text">${escapeHtml(item?.triageSummary || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyQuality", {}, "回复建议质量"))}</span><div class="memory-detail-text">${escapeHtml(item?.suggestedReplyQuality || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditDiagnosis", {}, "诊断"))}</span><div class="memory-detail-text">${escapeHtml(item?.status === "failed" || item?.status === "invalid_event" || item?.errorCode || item?.error ? diagnosis.summary : "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundRetryState", {}, "重试状态"))}</span><div class="memory-detail-text">${escapeHtml(item?.retryExhausted ? t("memory.outboundAuditInboundRetryExhausted", { count: item?.retryAttempt || 0 }, "已耗尽（{count} 次）") : item?.retryScheduled ? t("memory.outboundAuditInboundRetryScheduled", { count: item?.retryAttempt || 0 }, "待重试（第 {count} 次）") : "-")}</div></div>
          ${compactGovernanceDetailMode ? "" : `
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundMessageId", {}, "Message ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.messageId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditThreadId", {}, "线程 ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.threadId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundReplyMode", {}, "线程语义"))}</span><div class="memory-detail-text">${escapeHtml(item?.inReplyToMessageId || (Array.isArray(item?.references) && item.references.length > 0) ? t("memory.outboundAuditInboundReplyModeReply", {}, "回复既有线程") : t("memory.outboundAuditInboundReplyModeNew", {}, "新线程首封"))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundThreadBinding", {}, "会话绑定"))}</span><div class="memory-detail-text">${escapeHtml(item?.createdBinding ? t("memory.outboundAuditInboundThreadBindingNew", {}, "新建线程会话") : t("memory.outboundAuditInboundThreadBindingExisting", {}, "复用线程会话"))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundInReplyTo", {}, "In-Reply-To"))}</span><div class="memory-detail-text">${escapeHtml(item?.inReplyToMessageId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundReferences", {}, "References"))}</span><div class="memory-detail-text">${escapeHtml(Array.isArray(item?.references) && item.references.length > 0 ? item.references.join(" | ") : "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundFollowUpWindow", {}, "建议跟进窗口"))}</span><div class="memory-detail-text">${escapeHtml(item?.triageFollowUpWindowHours ? `${item.triageFollowUpWindowHours}h` : "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyStarter", {}, "建议回复 starter"))}</span><div class="memory-detail-text">${escapeHtml(item?.suggestedReplyStarter || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyConfidence", {}, "回复建议置信度"))}</span><div class="memory-detail-text">${escapeHtml(item?.suggestedReplyConfidence || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplySubject", {}, "建议回复主题"))}</span><div class="memory-detail-text">${escapeHtml(item?.suggestedReplySubject || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditErrorCode", {}, "错误码"))}</span><div class="memory-detail-text">${escapeHtml(item?.errorCode || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditAttachmentCount", {}, "附件数"))}</span><div class="memory-detail-text">${escapeHtml(String(Number(item?.attachmentCount) || 0))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundInlineAttachmentCount", {}, "内联附件数"))}</span><div class="memory-detail-text">${escapeHtml(String(Number(item?.inlineAttachmentCount) || 0))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundMailbox", {}, "Mailbox"))}</span><div class="memory-detail-text">${escapeHtml(item?.mailbox || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSessionKey", {}, "Session Key"))}</span><div class="memory-detail-text">${escapeHtml(item?.sessionKey || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundCheckpointUid", {}, "Checkpoint UID"))}</span><div class="memory-detail-text">${escapeHtml(item?.checkpointUid ? String(item.checkpointUid) : "-")}</div></div>
          `}
    ` : `
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditTime", {}, "时间"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(item?.timestamp))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditSourceConversation", {}, "来源会话"))}</span><div class="memory-detail-text">${escapeHtml(item?.sourceConversationId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditRequestedByAgent", {}, "请求 Agent"))}</span><div class="memory-detail-text">${escapeHtml(item?.requestedByAgentId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(isEmailOutboundAudit ? t("memory.outboundAuditProvider", {}, "Provider") : t("memory.outboundAuditTargetChatId", {}, "目标 Chat ID"))}</span><div class="memory-detail-text">${escapeHtml(isEmailOutboundAudit ? (item?.providerId || "-") : (item?.targetChatId || "-"))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditTargetAccountId", {}, "目标 Account ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.targetAccountId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(isEmailOutboundAudit ? t("memory.outboundAuditRecipients", {}, "收件人") : t("memory.outboundAuditRequestedSessionKey", {}, "请求 Session Key"))}</span><div class="memory-detail-text">${escapeHtml(isEmailOutboundAudit ? (recipientSummary || "-") : (item?.requestedSessionKey || "-"))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(isEmailOutboundAudit ? t("memory.outboundAuditSubject", {}, "主题") : t("memory.outboundAuditTargetSessionKey", {}, "目标 Session Key"))}</span><div class="memory-detail-text">${escapeHtml(isEmailOutboundAudit ? (item?.subject || "-") : (item?.targetSessionKey || "-"))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditDiagnosis", {}, "诊断"))}</span><div class="memory-detail-text">${escapeHtml(item?.delivery === "failed" || item?.errorCode || item?.error ? diagnosis.summary : "-")}</div></div>
          ${compactGovernanceDetailMode ? "" : `
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditRequestId", {}, "Request ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.requestId || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(isEmailOutboundAudit ? t("memory.outboundAuditThreadId", {}, "线程 ID") : t("memory.outboundAuditResolution", {}, "目标解析"))}</span><div class="memory-detail-text">${escapeHtml(isEmailOutboundAudit ? (item?.threadId || item?.providerThreadId || "-") : formatExternalOutboundResolutionLabel(item?.resolution))}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditFailureStage", {}, "失败阶段"))}</span><div class="memory-detail-text">${escapeHtml(item?.delivery === "failed" ? diagnosis.stageLabel : "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditErrorCode", {}, "错误码"))}</span><div class="memory-detail-text">${escapeHtml(item?.errorCode || "-")}</div></div>
          ${isEmailAudit ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditAttachmentCount", {}, "附件数"))}</span><div class="memory-detail-text">${escapeHtml(String(Number(item?.attachmentCount) || 0))}</div></div>` : ""}
          ${isEmailOutboundAudit ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditReplyToMessageId", {}, "回复消息 ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.replyToMessageId || "-")}</div></div>` : ""}
          ${isEmailOutboundAudit ? `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditProviderMessageId", {}, "Provider Message ID"))}</span><div class="memory-detail-text">${escapeHtml(item?.providerMessageId || "-")}</div></div>` : ""}
          `}
    `;
    memoryViewerDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        <div class="memory-detail-card">
          <div class="memory-detail-title">${escapeHtml(t("memory.outboundAuditTitle", {}, "消息审计"))}</div>
          <div class="memory-detail-badges">
            ${badgeMarkup}
          </div>
        </div>
        <div class="memory-detail-grid">
          ${detailGrid}
        </div>
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditContentPreview", {}, "消息预览"))}</span>
          <pre class="memory-detail-pre">${escapeHtml(preview)}</pre>
        </div>
        ${!compactGovernanceDetailMode && isEmailInboundAudit && Array.isArray(item?.suggestedReplyWarnings) && item.suggestedReplyWarnings.length > 0 ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyWarnings", {}, "回复建议风险"))}</span>
            <pre class="memory-detail-pre">${escapeHtml(item.suggestedReplyWarnings.join("\n"))}</pre>
          </div>
        ` : ""}
        ${!compactGovernanceDetailMode && isEmailInboundAudit && Array.isArray(item?.suggestedReplyChecklist) && item.suggestedReplyChecklist.length > 0 ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyChecklist", {}, "回复建议检查清单"))}</span>
            <pre class="memory-detail-pre">${escapeHtml(item.suggestedReplyChecklist.join("\n"))}</pre>
          </div>
        ` : ""}
        ${!compactGovernanceDetailMode && isEmailInboundAudit && item?.suggestedReplyDraft ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditInboundSuggestedReplyDraft", {}, "建议回复草稿"))}</span>
            <pre class="memory-detail-pre">${escapeHtml(item.suggestedReplyDraft)}</pre>
          </div>
        ` : ""}
        ${!compactGovernanceDetailMode && item?.error ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">${escapeHtml(t("memory.outboundAuditError", {}, "错误信息"))}</span>
            <pre class="memory-detail-pre">${escapeHtml(item.error)}</pre>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderCandidateDetailPanel(candidate) {
    if (!candidate) return "";
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();
    const memoryViewerState = getMemoryViewerState();
    const snapshot = candidate.sourceTaskSnapshot || {};
    const memoryLinks = Array.isArray(snapshot.memoryLinks) ? snapshot.memoryLinks : [];
    const artifactPaths = Array.isArray(snapshot.artifactPaths) ? snapshot.artifactPaths : [];
    const toolCalls = Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls : [];
    const learningReviewInput = candidate.learningReviewInput && typeof candidate.learningReviewInput === "object"
      ? candidate.learningReviewInput
      : null;
    const skillFreshness = candidate.skillFreshness && typeof candidate.skillFreshness === "object"
      ? candidate.skillFreshness
      : null;
    const candidateSourceView = candidate.sourceView || null;
    const candidateSourceExplanation = candidateSourceView ? formatResidentSourceExplainability(candidateSourceView) : "-";
    const candidateSourceConflict = candidateSourceView ? formatResidentSourceConflictSummary(candidateSourceView) : "-";
    const contextTargets = extractCandidateContextTargets(candidate);
    const pendingActionKey = typeof memoryViewerState.pendingExperienceActionKey === "string"
      ? memoryViewerState.pendingExperienceActionKey
      : "";
    const acceptBusy = pendingActionKey === `candidate:${candidate.id}:accept`;
    const rejectBusy = pendingActionKey === `candidate:${candidate.id}:reject`;
    const skillFreshnessStaleTarget = skillFreshness?.sourceCandidateId || skillFreshness?.skillKey || (candidate.type === "skill" ? candidate.id : "");
    const skillFreshnessStaleBusy = pendingActionKey === `skill-freshness:${skillFreshnessStaleTarget}:${skillFreshness?.manualStaleMark ? "active" : "stale"}`;

    return `
      <div class="memory-detail-card">
        <div class="memory-inline-item-head">
          <span class="memory-detail-label">${escapeHtml(t("memory.candidatePanelTitle", {}, "Candidate Detail Panel"))}</span>
          <div class="memory-detail-badges">
            <span class="memory-badge">${escapeHtml(candidate.type || "未知类型")}</span>
            <span class="memory-badge">${escapeHtml(formatTaskStatusLabel(candidate.status))}</span>
            ${candidateSourceView ? renderSourceViewBadge(candidateSourceView) : ""}
            ${candidate?.id ? `<button class="memory-usage-action-btn" data-open-experience-candidate-id="${escapeHtml(candidate.id)}">${escapeHtml(t("memory.openCandidateWorkbench", {}, "经验能力"))}</button>` : ""}
            <button class="memory-usage-action-btn" data-close-candidate-panel="1">${escapeHtml(t("memory.close", {}, "Close"))}</button>
          </div>
        </div>
        <div class="memory-detail-text"><strong>${escapeHtml(candidate.title || candidate.id || t("memory.candidateUntitled", {}, "Untitled Candidate"))}</strong></div>
        <div class="memory-detail-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("memory.contextSummaryTitle", {}, "上下文链"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("memory.contextSummaryCandidateText", {}, "把来源任务、源记忆与产物入口压缩到一处，方便继续追溯。"))}</div>
            </div>
          </div>
          <div class="memory-detail-badges">
            ${contextTargets.sourceConversationId ? `<span class="memory-badge">${escapeHtml(t("memory.contextConversation", {}, "会话"))} ${escapeHtml(summarizeSourcePath(contextTargets.sourceConversationId))}</span>` : ""}
            <span class="memory-badge">${escapeHtml(t("memory.contextLinkedMemories", {}, "关联记忆"))} ${escapeHtml(String(contextTargets.memoryCount))}</span>
            <span class="memory-badge">${escapeHtml(t("memory.contextArtifacts", {}, "产物"))} ${escapeHtml(String(contextTargets.artifactCount))}</span>
          </div>
          <div class="goal-detail-actions">
            ${contextTargets.sourceTaskId ? `<button class="button goal-inline-action-secondary" data-open-task-id="${escapeHtml(contextTargets.sourceTaskId)}">${escapeHtml(t("memory.contextOpenSourceTask", {}, "打开来源任务"))}</button>` : ""}
            ${contextTargets.firstMemoryId ? `<button class="button goal-inline-action-secondary" data-open-memory-id="${escapeHtml(contextTargets.firstMemoryId)}">${escapeHtml(t("memory.contextOpenFirstMemory", {}, "打开关联记忆"))}</button>` : ""}
            ${contextTargets.firstArtifactPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(contextTargets.firstArtifactPath)}">${escapeHtml(t("memory.contextOpenFirstArtifact", {}, "打开相关产物"))}</button>` : ""}
            ${contextTargets.publishedPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(contextTargets.publishedPath)}">${escapeHtml(t("memory.contextOpenPublishedArtifact", {}, "打开发布产物"))}</button>` : ""}
          </div>
        </div>
        <div class="memory-detail-grid">
          <div class="memory-detail-card"><span class="memory-detail-label">来源任务</span><div class="memory-detail-text">${candidate.taskId ? `<button class="memory-path-link" data-open-task-id="${escapeHtml(candidate.taskId)}">${escapeHtml(candidate.taskId)}</button>` : "-"}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">标识</span><div class="memory-detail-text">${escapeHtml(candidate.slug || "-")}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">发布路径</span><div class="memory-detail-text">${candidate.publishedPath ? `<button class="memory-path-link" data-open-source="${escapeHtml(candidate.publishedPath)}">${escapeHtml(candidate.publishedPath)}</button>` : "-"}</div></div>
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">候选 ID</span><div class="memory-detail-text">${escapeHtml(candidate.id || "-")}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">来源视角</span><div class="memory-detail-text">${escapeHtml(formatResidentSourceSummary(candidateSourceView))}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">来源解释</span><div class="memory-detail-text">${escapeHtml(candidateSourceExplanation)}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">冲突说明</span><div class="memory-detail-text">${escapeHtml(candidateSourceConflict)}</div></div>`}
        </div>
        ${candidate.summary ? `<div class="memory-detail-text">${escapeHtml(candidate.summary)}</div>` : ""}
        ${candidate.status === "draft" ? `
          <div class="goal-detail-actions">
            <button
              class="memory-usage-action-btn"
              data-review-candidate-action="accept"
              data-review-candidate-id="${escapeHtml(candidate.id || "")}"
              data-review-candidate-task-id="${escapeHtml(candidate.taskId || "")}"
              ${acceptBusy ? "disabled" : ""}
            >${escapeHtml(acceptBusy
              ? t("memory.candidateReviewAccepting", {}, "接受中…")
              : t("memory.candidateAcceptAndPublish", {}, "接受并发布"))}</button>
            <button
              class="memory-usage-action-btn"
              data-review-candidate-action="reject"
              data-review-candidate-id="${escapeHtml(candidate.id || "")}"
              data-review-candidate-task-id="${escapeHtml(candidate.taskId || "")}"
              ${rejectBusy ? "disabled" : ""}
            >${escapeHtml(rejectBusy
              ? t("memory.candidateReviewRejecting", {}, "拒绝中…")
              : t("memory.candidateReject", {}, "拒绝"))}</button>
          </div>
        ` : ""}
        ${!compactGovernanceDetailMode && skillFreshness ? renderSkillFreshnessDetail(skillFreshness, {
          escapeHtml,
          t,
          maxSignals: 3,
          actions: {
            sourceCandidateId: skillFreshness.sourceCandidateId || (candidate.type === "skill" ? candidate.id : ""),
            skillKey: skillFreshness.skillKey || "",
            taskId: candidate.taskId || "",
            candidateId: candidate.id || "",
            staleBusy: skillFreshnessStaleBusy,
          },
        }) : ""}
        ${!compactGovernanceDetailMode && learningReviewInput ? `
          <div class="memory-detail-card">
            <span class="memory-detail-label">Learning / Review Input</span>
            <div class="memory-detail-badges">
              <span class="memory-badge">${escapeHtml(learningReviewInput.summary?.headline || "-")}</span>
            </div>
            ${(Array.isArray(learningReviewInput.summaryLines) ? learningReviewInput.summaryLines : []).slice(0, 4).map((line) => `
              <div class="memory-detail-text">${escapeHtml(line)}</div>
            `).join("")}
            ${(Array.isArray(learningReviewInput.nudges) ? learningReviewInput.nudges : []).slice(0, 4).map((line) => `
              <div class="memory-detail-text">Nudge: ${escapeHtml(line)}</div>
            `).join("")}
          </div>
        ` : ""}
        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.snapshotTitle", {}, "Source Snapshot"))}</span>
          <div class="memory-detail-grid">
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailConversationId", {}, "Conversation"))}</span><div class="memory-detail-text">${escapeHtml(snapshot.conversationId || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.snapshotStatus", {}, "Status"))}</span><div class="memory-detail-text">${escapeHtml(formatTaskStatusLabel(snapshot.status) || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.snapshotSource", {}, "Source"))}</span><div class="memory-detail-text">${escapeHtml(formatTaskSourceLabel(snapshot.source) || "-")}</div></div>
            <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.snapshotStartedAt", {}, "Started At"))}</span><div class="memory-detail-text">${escapeHtml(formatDateTime(snapshot.startedAt))}</div></div>
          </div>
          ${snapshot.objective ? `<div class="memory-detail-text"><strong>${escapeHtml(t("memory.snapshotObjective", {}, "Objective"))}：</strong>${escapeHtml(snapshot.objective)}</div>` : ""}
          ${snapshot.summary ? `<div class="memory-detail-text"><strong>${escapeHtml(t("memory.snapshotSummary", {}, "Summary"))}：</strong>${escapeHtml(snapshot.summary)}</div>` : ""}
        </div>
        `)}
        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.linkedSourceMemories", {}, "Source Memories"))} (${memoryLinks.length})</span>
          ${memoryLinks.length ? `
            <div class="memory-inline-list">
              ${memoryLinks.map((link) => `
                <div class="memory-inline-item">
                  <div class="memory-inline-item-head">
                    <span class="memory-badge">${escapeHtml(link.relation || t("memory.memoryLinkUsed", {}, "Used"))}</span>
                    ${link.memoryType ? `<span class="memory-badge">${escapeHtml(formatMemoryTypeLabel(link.memoryType))}</span>` : ""}
                    ${link.sourceView ? renderSourceViewBadge(link.sourceView) : ""}
                    <button class="memory-path-link" data-open-memory-id="${escapeHtml(link.chunkId || "")}">${escapeHtml(link.chunkId || t("memory.openMemory", {}, "Open Memory"))}</button>
                  </div>
                  ${link.sourcePath ? `<button class="memory-path-link" data-open-source="${escapeHtml(link.sourcePath)}">${escapeHtml(link.sourcePath)}</button>` : ""}
                  ${link.snippet ? `<div class="memory-detail-text">${escapeHtml(link.snippet)}</div>` : ""}
                  ${link.sourceView ? `<div class="memory-detail-text">${escapeHtml(formatResidentSourceExplainability(link.sourceView))}</div>` : ""}
                  ${link.sourceView ? `<div class="memory-detail-text">${escapeHtml(formatResidentSourceConflictSummary(link.sourceView))}</div>` : ""}
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">${escapeHtml(t("memory.noSourceMemoryLinks", {}, "No source memory links."))}</div>`}
        </div>
        `)}
        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.sourceArtifacts", {}, "Source Artifacts"))} (${artifactPaths.length})</span>
          ${artifactPaths.length ? `
            <div class="memory-inline-list">
              ${artifactPaths.map((artifactPath) => `
                <div class="memory-inline-item">
                  <button class="memory-path-link" data-open-source="${escapeHtml(artifactPath)}">${escapeHtml(artifactPath)}</button>
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">${escapeHtml(t("memory.noSourceArtifacts", {}, "No source artifacts."))}</div>`}
        </div>
        `)}
        ${renderGovernanceFullOnly(`
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.toolCallsTitle", { count: String(toolCalls.length) }, `Tool Calls (${toolCalls.length})`))}</span>
          ${toolCalls.length ? `
            <div class="memory-inline-list">
              ${toolCalls.map((call) => `
                <div class="memory-inline-item">
                  <div class="memory-inline-item-head">
                    <span class="memory-badge">${escapeHtml(call.toolName || t("memory.unknownTool", {}, "Unknown Tool"))}</span>
                    <span class="memory-badge">${escapeHtml(call.success ? t("memory.toolCallSuccess", {}, "Success") : t("memory.toolCallFailed", {}, "Failed"))}</span>
                    <span class="memory-badge">${escapeHtml(formatDuration(call.durationMs))}</span>
                  </div>
                  ${call.note ? `<div class="memory-detail-text">${escapeHtml(call.note)}</div>` : ""}
                </div>
              `).join("")}
            </div>
          ` : `<div class="memory-detail-text">${escapeHtml(t("memory.noToolCalls", {}, "No tool call records."))}</div>`}
        </div>
        `)}
        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.candidateContent", {}, "Candidate Content"))}</span>
          <pre class="memory-detail-pre">${escapeHtml(candidate.content || t("memory.noContent", {}, "No content"))}</pre>
        </div>
      </div>
    `;
  }

  function renderCandidateOnlyDetail(candidate) {
    if (!memoryViewerDetailEl) return;
    if (!candidate) {
      renderMemoryViewerDetailEmpty(t("memory.candidateMissing", {}, "Candidate not found."));
      return;
    }
    memoryViewerDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        ${renderCandidateDetailPanel(candidate)}
      </div>
    `;
    bindMemoryPathLinks();
    bindTaskAuditJumpLinks();
  }

  function renderMemoryDetail(item) {
    if (!memoryViewerDetailEl) return;
    if (!item) {
      renderMemoryViewerDetailEmpty(t("memory.memoryMissing", {}, "Memory not found."));
      return;
    }
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();

    const visibility = normalizeMemoryVisibility(item.visibility);
    const category = formatMemoryCategory(item.category);
    const sourceView = item.sourceView || { scope: visibility };
    const promotion = getMemorySharePromotionMetadata(item);
    const shareStatus = formatMemorySharePromotionStatusLabel(normalizeMemorySharePromotionStatus(item));
    const shareActionMode = getMemoryShareActionMode(item);
    const governanceSummary = formatSharedGovernanceSummary(item);
    const sourceExplanation = formatResidentSourceExplainability(sourceView);
    const sourceConflictSummary = formatResidentSourceConflictSummary(sourceView);
    const sourceAuditSummary = formatResidentSourceAuditSummary(sourceView);
    const shareScopeSourcePath = getMemoryShareScopeSourcePath(item);
    const shareActionScope = shareScopeSourcePath ? "source" : "chunk";
    const claimState = getMemoryShareClaimState(item);
    const claimOwner = claimState.claimOwner;
    const claimTimedOut = claimState.claimTimedOut;
    const targetAgentId = getMemoryShareTargetAgentId(item);
    const targetDisplayName = item.targetDisplayName || targetAgentId;
    const activeAgentId = getActiveAgentId();
    const canClaimNow = !claimOwner || claimTimedOut;
    const canReviewNow = shareActionMode === "pending"
      && (claimState.actionableByReviewer || !claimOwner || claimOwner === activeAgentId || claimTimedOut);
    const shareActionButtons = [];
    if (shareActionMode === "request" && sourceView.scope !== "shared") {
      shareActionButtons.push(
        `<button class="memory-usage-action-btn" data-memory-share-promote="${escapeHtml(item.id)}">${escapeHtml(t("memory.sharePromoteAction", {}, "Submit Shared Review"))}</button>`,
      );
    }
    if (shareActionMode === "pending") {
      if (claimOwner === activeAgentId && !claimTimedOut) {
        shareActionButtons.push(
          `<button class="memory-usage-action-btn" data-memory-share-claim="release" data-memory-share-claim-scope="${escapeHtml(shareActionScope)}">${escapeHtml(t("memory.shareReleaseAction", {}, "Release"))}</button>`,
        );
      }
      if (canClaimNow) {
        shareActionButtons.push(
          `<button class="memory-usage-action-btn" data-memory-share-claim="claim" data-memory-share-claim-scope="${escapeHtml(shareActionScope)}">${escapeHtml(t("memory.shareClaimAction", {}, "Claim"))}</button>`,
        );
      }
      if (canReviewNow) {
        shareActionButtons.push(
          `<button class="memory-usage-action-btn" data-memory-share-decision="approved">${escapeHtml(t("memory.shareReviewApproveAction", {}, "Approve"))}</button>`,
        );
        shareActionButtons.push(
          `<button class="memory-usage-action-btn" data-memory-share-decision="rejected">${escapeHtml(t("memory.shareReviewRejectAction", {}, "Reject"))}</button>`,
        );
        if (shareActionScope === "source") {
          shareActionButtons.push(
            `<button class="memory-usage-action-btn" data-memory-share-decision="approved" data-memory-share-decision-scope="source">${escapeHtml(t("memory.shareReviewApproveBatchAction", {}, "Approve Source Group"))}</button>`,
          );
          shareActionButtons.push(
            `<button class="memory-usage-action-btn" data-memory-share-decision="rejected" data-memory-share-decision-scope="source">${escapeHtml(t("memory.shareReviewRejectBatchAction", {}, "Reject Source Group"))}</button>`,
          );
        }
      }
    }
    if (shareActionMode === "approved") {
      shareActionButtons.push(
        `<button class="memory-usage-action-btn" data-memory-share-decision="revoked">${escapeHtml(t("memory.shareReviewRevokeAction", {}, "Revoke Shared"))}</button>`,
      );
    }
    const claimStatusText = claimOwner
      ? claimTimedOut
        ? t(
          "memory.detailSharedClaimTimedOut",
          { owner: claimOwner, time: formatDateTime(claimState.claimExpiresAt) },
          `${claimOwner} (timed out ${formatDateTime(claimState.claimExpiresAt)})`,
        )
        : t("memory.detailSharedClaimActive", { owner: claimOwner }, `${claimOwner} (active)`)
      : t("memory.detailSharedClaimNone", {}, "Unclaimed");
    const reviewerStateText = claimState.blockedByOtherReviewer
      ? t("memory.detailSharedReviewerBlocked", { owner: claimOwner }, `Blocked by ${claimOwner} until release or timeout.`)
      : claimTimedOut
        ? t("memory.detailSharedReviewerTimedOut", {}, "Previous claim timed out. You can claim again or review directly.")
        : claimOwner === activeAgentId
          ? t("memory.detailSharedReviewerMine", {}, "Currently claimed by you. You can review or release it.")
          : canReviewNow
            ? t("memory.detailSharedReviewerActionable", {}, "This review item is actionable for the current reviewer.")
            : t("memory.detailSharedReviewerIdle", {}, "This review item is waiting for a reviewer.");
    const canOpenSharedReviewContext = normalizeMemorySharePromotionStatus(item) && normalizeMemorySharePromotionStatus(item) !== "none";
    const contentText = String(item.content || item.snippet || t("memory.noContent", {}, "No content"));
    const contentPreview = buildMemoryDetailCollapsedPreview(contentText);
    const metadataText = item.metadata ? JSON.stringify(item.metadata, null, 2) : "";
    const metadataPreview = metadataText ? buildMemoryDetailCollapsedPreview(metadataText) : null;
    memoryViewerDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        <div class="memory-detail-header memory-detail-header-memory-entry">
          <div class="memory-detail-header-main">
            <div class="memory-detail-title">${escapeHtml(summarizeSourcePath(item.sourcePath))}</div>
            ${compactGovernanceDetailMode ? "" : `<div class="memory-list-item-meta">
              <span>${escapeHtml(item.id)}</span>
            </div>`}
          </div>
          <div class="memory-detail-header-side">
            <div class="memory-detail-badges memory-detail-badges-memory-entry">
              <span class="memory-badge">${escapeHtml(formatMemoryTypeLabel(item.memoryType))}</span>
              <span class="memory-badge">${escapeHtml(formatMemorySourceTypeLabel(item.sourceType))}</span>
              <span class="memory-badge ${getVisibilityBadgeClass(visibility)}">${escapeHtml(visibility)}</span>
              ${renderSourceViewBadge(sourceView)}
              <span class="memory-badge">${escapeHtml(category)}</span>
              <span class="memory-badge">分数 ${formatScore(item.score)}</span>
            </div>
            ${shareActionButtons.length ? `
              <div class="memory-detail-actions memory-detail-actions-memory-entry">
                ${shareActionButtons.join("")}
              </div>
            ` : ""}
          </div>
        </div>

        <div class="memory-detail-card">
          <div class="goal-summary-header">
            <div>
              <div class="goal-summary-title">${escapeHtml(t("memory.contextSummaryTitle", {}, "上下文链"))}</div>
              <div class="goal-summary-text">${escapeHtml(t("memory.contextSummaryMemoryText", {}, "把来源范围、shared 治理状态与继续下钻入口收拢到一处。"))}</div>
            </div>
          </div>
          <div class="memory-detail-badges">
            <span class="memory-badge ${getVisibilityBadgeClass(visibility)}">${escapeHtml(visibility)}</span>
            ${renderSourceViewBadge(sourceView)}
            <span class="memory-badge">${escapeHtml(shareStatus)}</span>
            ${targetDisplayName ? `<span class="memory-badge">${escapeHtml(targetDisplayName)}</span>` : ""}
            ${claimOwner ? `<span class="memory-badge">${escapeHtml(claimTimedOut ? t("memory.contextClaimTimedOut", {}, "claim 超时") : t("memory.contextClaimActive", {}, "claim 生效中"))}</span>` : ""}
          </div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(sourceExplanation)}</span>
          </div>
          <div class="goal-detail-actions">
            ${item.sourcePath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(item.sourcePath)}" data-open-line="${typeof item.startLine === "number" ? item.startLine : ""}">${escapeHtml(t("memory.contextOpenSource", {}, "打开来源文件"))}</button>` : ""}
            ${canOpenSharedReviewContext ? `<button class="button goal-inline-action-secondary" data-memory-open-shared-review-context="1">${escapeHtml(t("memory.contextOpenSharedReview", {}, "打开 Shared Review"))}</button>` : ""}
          </div>
        </div>

        <div class="memory-detail-grid">
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailVisibility", {}, "Visibility"))}</span><div class="memory-detail-text">${escapeHtml(visibility)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.sharedReviewTargetAgent", {}, "Target Agent"))}</span><div class="memory-detail-text">${escapeHtml(targetDisplayName)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailSharedStatus", {}, "Shared Status"))}</span><div class="memory-detail-text">${escapeHtml(shareStatus)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailSharedClaim", {}, "Shared Claim"))}</span><div class="memory-detail-text">${escapeHtml(claimStatusText)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailSharedReviewerState", {}, "Reviewer State"))}</span><div class="memory-detail-text">${escapeHtml(reviewerStateText)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailCategory", {}, "Category"))}</span><div class="memory-detail-text">${escapeHtml(category)}</div></div>
          <div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailSummary", {}, "Summary"))}</span><div class="memory-detail-text">${escapeHtml(item.summary || t("memory.emptyNoSummary", {}, "No summary"))}</div></div>
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailSourcePath", {}, "Source Path"))}</span><div class="memory-detail-text">${item.sourcePath ? `<button class="memory-path-link" data-open-source="${escapeHtml(item.sourcePath)}" data-open-line="${typeof item.startLine === "number" ? item.startLine : ""}">${escapeHtml(item.sourcePath)}</button>` : "-"}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailLines", {}, "Lines"))}</span><div class="memory-detail-text">${escapeHtml(formatLineRange(item.startLine, item.endLine))}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">来源视角</span><div class="memory-detail-text">${escapeHtml(formatResidentSourceSummary(sourceView))}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">来源解释</span><div class="memory-detail-text">${escapeHtml(sourceExplanation)}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">冲突说明</span><div class="memory-detail-text">${escapeHtml(sourceConflictSummary)}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">来源审计</span><div class="memory-detail-text">${escapeHtml(sourceAuditSummary)}</div></div>`}
          ${compactGovernanceDetailMode ? "" : `<div class="memory-detail-card"><span class="memory-detail-label">${escapeHtml(t("memory.detailSharedGovernance", {}, "Shared Governance"))}</span><div class="memory-detail-text">${escapeHtml(governanceSummary)}</div></div>`}
        </div>

        <div class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("memory.detailSnippet", {}, "Snippet"))}</span>
          <div class="memory-detail-text">${escapeHtml(item.snippet || t("memory.noContent", {}, "No content"))}</div>
        </div>

        <div class="memory-detail-card${contentPreview.truncated ? " is-collapsible" : ""}" data-memory-detail-collapsible="content">
          <div class="memory-detail-card-head">
            <span class="memory-detail-label">${escapeHtml(t("memory.detailContent", {}, "Content"))}</span>
            ${contentPreview.truncated ? `
              <button class="memory-usage-action-btn" data-memory-detail-toggle="content" data-memory-detail-expanded="false">${escapeHtml(t("memory.detailExpand", {}, "Expand"))}</button>
            ` : ""}
          </div>
          ${contentPreview.truncated ? `
            <div class="memory-detail-caption">${escapeHtml(t(
              "memory.detailCollapsedHint",
              {
                chars: formatCount(contentPreview.charCount),
                lines: formatCount(contentPreview.lineCount),
              },
              `Previewing ${formatCount(contentPreview.charCount)} chars / ${formatCount(contentPreview.lineCount)} lines`,
            ))}</div>
          ` : ""}
          <pre class="memory-detail-pre${contentPreview.truncated ? " is-collapsed" : ""}" data-memory-detail-body="content">${escapeHtml(contentPreview.truncated ? contentPreview.preview : contentText)}</pre>
        </div>

        ${!compactGovernanceDetailMode && metadataPreview ? `
          <div class="memory-detail-card${metadataPreview.truncated ? " is-collapsible" : ""}" data-memory-detail-collapsible="metadata">
            <div class="memory-detail-card-head">
              <span class="memory-detail-label">元数据</span>
              ${metadataPreview.truncated ? `
                <button class="memory-usage-action-btn" data-memory-detail-toggle="metadata" data-memory-detail-expanded="false">${escapeHtml(t("memory.detailExpand", {}, "Expand"))}</button>
              ` : ""}
            </div>
            ${metadataPreview.truncated ? `
              <div class="memory-detail-caption">${escapeHtml(t(
                "memory.detailCollapsedHint",
                {
                  chars: formatCount(metadataPreview.charCount),
                  lines: formatCount(metadataPreview.lineCount),
                },
                `Previewing ${formatCount(metadataPreview.charCount)} chars / ${formatCount(metadataPreview.lineCount)} lines`,
              ))}</div>
            ` : ""}
            <pre class="memory-detail-pre${metadataPreview.truncated ? " is-collapsed" : ""}" data-memory-detail-body="metadata">${escapeHtml(metadataPreview.truncated ? metadataPreview.preview : metadataText)}</pre>
          </div>
        ` : ""}
      </div>
    `;
    bindMemoryPathLinks();
    bindMemoryDetailActions(item);
  }

  return {
    applyAgentViewState,
    captureAgentViewState,
    clearDreamHistoryState,
    closeDreamModal,
    loadDreamCommonsStatus,
    loadDreamHistory,
    loadDreamHistoryDetail,
    loadDreamRuntimeStatus,
    loadExternalOutboundAuditViewer,
    loadMemoryChunkViewer,
    loadMemoryViewer,
    loadMemoryViewerStats,
    loadSharedReviewQueue,
    loadTaskUsageOverview,
    loadTaskViewer,
    renderCandidateDetailPanel,
    renderCandidateOnlyDetail,
    renderExternalOutboundAuditDetail,
    renderExternalOutboundAuditList,
    renderDreamHistoryPanel,
    renderDreamModal,
    renderDreamRuntimeBar,
    renderDedupModal,
    renderMemoryList,
    renderSharedReviewList,
    renderMemoryDetail,
    renderMemoryViewerStats,
    renderTaskList,
    openDedupModal,
    applyDedupFromModal,
    closeDedupModal,
    runDream,
    syncSharedReviewFilterUi,
    syncMemoryViewerHeaderTitle,
    toggleDreamHistory,
    openDreamModal,
    switchOutboundAuditFocus,
    switchMemoryViewerTab,
    syncMemoryViewerUi,
  };
}
