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
import { createEmailThreadAdviceRetention } from "./email-thread-advice-retention.js";
import { createMemoryViewerRequestLifecycle } from "./memory-viewer-request-lifecycle.js";
import { createMemoryViewerRetainedStateLifecycle } from "./memory-viewer-retained-state.js";
import { createMemoryViewerModalControls } from "./memory-viewer-modal-controls.js";
import { createMemoryViewerDedupActions } from "./memory-viewer-dedup-actions.js";
import { createMemoryViewerDedupWarningView } from "./memory-viewer-dedup-warning-view.js";
import { createMemoryViewerDedupSummaryView } from "./memory-viewer-dedup-summary-view.js";
import { createMemoryViewerDedupListView } from "./memory-viewer-dedup-list-view.js";
import { createMemoryViewerSharedReviewTargetFilterView } from "./memory-viewer-shared-review-target-filter-view.js";
import { createMemoryViewerSharedReviewClaimedByFilterView } from "./memory-viewer-shared-review-claimed-by-filter-view.js";
import { createMemoryViewerSharedReviewBatchBarView } from "./memory-viewer-shared-review-batch-bar-view.js";
import { createMemoryViewerDreamHistoryListView } from "./memory-viewer-dream-history-list-view.js";
import { createMemoryViewerDreamHistoryDetailEmptyView } from "./memory-viewer-dream-history-detail-empty-view.js";
import { createMemoryViewerDreamHistoryDetailView } from "./memory-viewer-dream-history-detail-view.js";
import { createMemoryViewerStatsFallbackView } from "./memory-viewer-stats-fallback-view.js";
import { createMemoryViewerOutboundThreadStatsView } from "./memory-viewer-outbound-thread-stats-view.js";
import { createMemoryViewerOutboundAuditStatsView } from "./memory-viewer-outbound-audit-stats-view.js";
import { createMemoryViewerSharedReviewStatsView } from "./memory-viewer-shared-review-stats-view.js";
import { createMemoryViewerTaskStatsView } from "./memory-viewer-task-stats-view.js";
import { createMemoryViewerMemoryStatsView } from "./memory-viewer-memory-stats-view.js";
import { createMemoryViewerTaskListView } from "./memory-viewer-task-list-view.js";
import { createMemoryViewerMemoryListView } from "./memory-viewer-memory-list-view.js";
import { createMemoryViewerOutboundAuditListView } from "./memory-viewer-outbound-audit-list-view.js";
import { createMemoryViewerOutboundAuditDetailView } from "./memory-viewer-outbound-audit-detail-view.js";
import { createMemoryViewerMemoryDetailView } from "./memory-viewer-memory-detail-view.js";
import { createMemoryViewerSharedReviewListView } from "./memory-viewer-shared-review-list-view.js";
import { createMemoryViewerCandidateDetailView } from "./memory-viewer-candidate-detail-view.js";
import { createMemoryViewerDreamHistoryLifecycle } from "./memory-viewer-dream-history-lifecycle.js";
import { createMemoryViewerDreamConsolidationActions } from "./memory-viewer-dream-consolidation-actions.js";
import { createMemoryViewerDreamRuntimeLifecycle } from "./memory-viewer-dream-runtime-lifecycle.js";
import { createMemoryViewerDreamRunAction } from "./memory-viewer-dream-run-action.js";
import { createMemoryViewerSharePromoteAction } from "./memory-viewer-share-promote-action.js";
import { createMemoryViewerShareClaimAction } from "./memory-viewer-share-claim-action.js";
import { createMemoryViewerShareReviewAction } from "./memory-viewer-share-review-action.js";
import { createMemoryViewerShareBatchAction } from "./memory-viewer-share-batch-action.js";
import { createMemoryViewerIngressLifecycle } from "./memory-viewer-ingress-lifecycle.js";
import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

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

function formatDreamConsolidationSummary(consolidation, t = (_key, _params, fallback) => fallback ?? "") {
  if (!consolidation || typeof consolidation !== "object") {
    return "";
  }
  const profilePatchCount = Array.isArray(consolidation.profilePatchCandidates) ? consolidation.profilePatchCandidates.length : 0;
  const staleCount = Array.isArray(consolidation.staleCandidates) ? consolidation.staleCandidates.length : 0;
  const contradictionCount = Array.isArray(consolidation.contradictionCandidates) ? consolidation.contradictionCandidates.length : 0;
  if (profilePatchCount + staleCount + contradictionCount <= 0) {
    return "";
  }
  return t(
    "memory.dreamConsolidationSummary",
    {
      profilePatchCount: String(profilePatchCount),
      staleCount: String(staleCount),
      contradictionCount: String(contradictionCount),
    },
    `整理建议：profile_patch ${profilePatchCount} / stale ${staleCount} / contradiction ${contradictionCount}`,
  );
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
  const consolidationText = formatDreamConsolidationSummary(latestRun?.consolidation, t);

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
      { summary: summaryText, generation: generationText, commons: commonsText, consolidation: consolidationText, gates: gateText, signal: signalText, stats: autoStatsText },
      `最近摘要：${summaryText} · ${generationText} · ${commonsText}${consolidationText ? ` · ${consolidationText}` : ""} · ${signalText} · ${autoStatsText} · ${gateText}`,
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
  getMemoryCategoryDistributionViewModel,
  bindStatsAuditJumpLinks,
  bindMemoryPathLinks,
  bindTaskAuditJumpLinks,
  openConversationSession,
  emailThreadAdviceRetention = createEmailThreadAdviceRetention(),
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
  const dedupWarningView = createMemoryViewerDedupWarningView();
  const dedupSummaryView = createMemoryViewerDedupSummaryView();
  const dedupListView = createMemoryViewerDedupListView();
  const sharedReviewTargetFilterView = createMemoryViewerSharedReviewTargetFilterView();
  const sharedReviewClaimedByFilterView = createMemoryViewerSharedReviewClaimedByFilterView();
  const sharedReviewBatchBarView = createMemoryViewerSharedReviewBatchBarView();
  const dreamHistoryListView = createMemoryViewerDreamHistoryListView();
  const dreamHistoryDetailEmptyView = createMemoryViewerDreamHistoryDetailEmptyView();
  const dreamHistoryDetailView = createMemoryViewerDreamHistoryDetailView();
  const statsFallbackView = createMemoryViewerStatsFallbackView();
  const outboundThreadStatsView = createMemoryViewerOutboundThreadStatsView();
  const outboundAuditStatsView = createMemoryViewerOutboundAuditStatsView();
  const sharedReviewStatsView = createMemoryViewerSharedReviewStatsView();
  const taskStatsView = createMemoryViewerTaskStatsView();
  const memoryStatsView = createMemoryViewerMemoryStatsView();
  const candidateDetailView = createMemoryViewerCandidateDetailView({
    t,
    formatTaskStatusLabel,
    formatTaskSourceLabel,
    formatMemoryTypeLabel,
    formatDateTime,
    formatDuration,
    summarizeSourcePath,
  });
  const taskListView = createMemoryViewerTaskListView();
  const memoryListView = createMemoryViewerMemoryListView();
  const outboundAuditListView = createMemoryViewerOutboundAuditListView();
  const outboundAuditDetailView = createMemoryViewerOutboundAuditDetailView({
    t,
    formatDateTime,
    formatExternalOutboundDecisionLabel,
    formatExternalOutboundDeliveryLabel,
    formatEmailInboundStatusLabel,
    formatExternalOutboundResolutionLabel,
    formatEmailOutboundDiagnosis,
    formatEmailInboundDiagnosis,
    formatOutboundAuditChannelLabel,
    formatOutboundAuditPreview,
    buildExternalOutboundDiagnosis,
  });
  const memoryDetailView = createMemoryViewerMemoryDetailView({
    t,
    formatCount,
    formatLineRange,
    formatScore,
    formatMemoryTypeLabel,
    formatMemorySourceTypeLabel,
    getVisibilityBadgeClass,
    summarizeSourcePath,
  });
  const sharedReviewListView = createMemoryViewerSharedReviewListView();
  let dreamModalOpen = false;
  const ingressLifecycle = createMemoryViewerIngressLifecycle();
  const requestLifecycle = createMemoryViewerRequestLifecycle({
    invalidateRequestContext: () => {
      const memoryViewerState = getMemoryViewerState();
      memoryViewerState.requestToken = Number(memoryViewerState.requestToken || 0) + 1;
    },
  });
  const retainedStateLifecycle = createMemoryViewerRetainedStateLifecycle({
    getState: getMemoryViewerState,
    refs: {
      memoryViewerTitleEl,
      memoryViewerStatsEl,
      memoryViewerListEl,
      memoryViewerDetailEl,
      memorySharedReviewBatchBarEl,
      memoryDreamModalEl,
      memoryDreamModalTitleEl,
      memoryDreamBarEl,
      memoryDreamStatusEl,
      memoryDreamMetaEl,
      memoryDreamObsidianEl,
      memoryDreamSummaryEl,
      memoryDreamHistoryStatusEl,
      memoryDreamHistoryListEl,
      memoryDreamHistoryDetailEl,
      memoryDedupModalEl,
      memoryDedupModalTitleEl,
      memoryDedupModalSummaryEl,
      memoryDedupModalStatusEl,
      memoryDedupModalWarningEl,
      memoryDedupModalListEl,
    },
  });
  const dedupActions = createMemoryViewerDedupActions({
    getModalState: getDedupModalState,
    isConnected,
    sendReq,
    makeId,
    getActiveAgentId,
    buildFilter: buildCurrentMemoryDedupFilter,
    render: renderDedupModal,
    showNotice,
    loadMemoryViewer,
    t,
  });
  const sharePromoteAction = createMemoryViewerSharePromoteAction({
    getState: getMemoryViewerState,
    sendReq,
    makeId,
    getActiveAgentId,
    promptAction: (message, initialValue) => window.prompt(message, initialValue),
    showNotice,
    loadMemoryViewer,
    loadMemoryDetail,
    t,
  });
  const shareClaimAction = createMemoryViewerShareClaimAction({
    getState: getMemoryViewerState,
    sendRequest: sendMemoryShareClaimRequest,
    showNotice,
    loadMemoryViewer,
    loadMemoryDetail,
    t,
  });
  const shareReviewAction = createMemoryViewerShareReviewAction({
    getState: getMemoryViewerState,
    sendRequest: sendMemoryShareReviewRequest,
    promptAction: (message, initialValue) => window.prompt(message, initialValue),
    showNotice,
    loadMemoryViewer,
    loadMemoryDetail,
    t,
  });
  const shareBatchAction = createMemoryViewerShareBatchAction({
    getState: getMemoryViewerState,
    getSelectedIds: getSelectedSharedReviewIds,
    getActiveAgentId,
    buildBatchState: buildSharedReviewBatchActionState,
    promptAction: (message, initialValue) => window.prompt(message, initialValue),
    sendClaimRequest: sendMemoryShareClaimRequest,
    sendReviewRequest: sendMemoryShareReviewRequest,
    render: renderSharedReviewBatchBar,
    formatActionLabel: formatSharedReviewBatchActionLabel,
    formatCount,
    showNotice,
    loadMemoryViewer,
    loadMemoryDetail,
    t,
  });
  const dreamHistoryLifecycle = createMemoryViewerDreamHistoryLifecycle();
  const dreamRuntimeLifecycle = createMemoryViewerDreamRuntimeLifecycle();
  const dreamRunAction = createMemoryViewerDreamRunAction({
    getState: getMemoryViewerState,
    isConnected,
    sendReq,
    makeId,
    getActiveAgentId,
    normalizeRuntime: normalizeDreamRuntimeView,
    render: renderDreamRuntimeBar,
    showNotice,
    loadDreamHistory,
    loadDreamRuntimeStatus,
    t,
  });
  const dreamConsolidationActions = createMemoryViewerDreamConsolidationActions({
    getState: getMemoryViewerState,
    sendReq,
    makeId,
    getActiveAgentId,
    promptAction: (message, initialValue) => window.prompt(message, initialValue),
    confirmAction: (message) => window.confirm(message),
    showNotice,
    loadDreamHistory,
    loadDreamHistoryDetail,
    loadDreamRuntimeStatus,
    t,
  });
  const modalControls = createMemoryViewerModalControls({
    refs: {
      memoryDedupModalEl,
      memoryDedupModalCloseBtn,
      memoryDedupModalCancelBtn,
      memoryDedupModalSubmitBtn,
      memoryDreamHistoryListEl,
      memoryDreamHistoryDetailEl,
      memoryDreamModalTriggerBtn,
      memoryDreamModalCloseBtn,
      memoryDreamModalEl,
    },
    documentTarget: document,
    getDreamModalOpen: () => dreamModalOpen,
    closeDedupModal,
    applyDedupFromModal,
    loadDreamHistoryDetail,
    reviewDreamConsolidation,
    applyDreamConsolidation,
    openDreamModal,
    closeDreamModal,
  });

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
    const sourceIndexingLabel = formatDedupSourceIndexingLabel(item.sourceIndexing);
    return `${sourcePath} · ${formatMemoryTypeLabel(item.memoryType)} · ${lines} · links ${formatCount(taskLinkCount)} · ${sourceIndexingLabel}`;
  }

  function formatDedupSourceIndexingLabel(sourceIndexing) {
    const scope = typeof sourceIndexing?.scope === "string" ? sourceIndexing.scope.trim() : "";
    if (sourceIndexing?.reindexable !== true) {
      return t("memory.dedupSourceExternal", {}, "非默认索引源");
    }
    switch (scope) {
      case "workspace_sessions":
        return t("memory.dedupSourceSessions", {}, "可索引源：sessions/");
      case "state_memory_root":
        return t("memory.dedupSourceMemoryRoot", {}, "可索引源：memory/");
      case "state_memory_file":
        return t("memory.dedupSourceMemoryFile", {}, "可索引源：MEMORY.md");
      case "team_memory_root":
        return t("memory.dedupSourceTeamMemoryRoot", {}, "可索引源：team-memory/memory/");
      case "team_memory_file":
        return t("memory.dedupSourceTeamMemoryFile", {}, "可索引源：team-memory/MEMORY.md");
      case "additional_root":
        return t("memory.dedupSourceAdditionalRoot", {}, "可索引源：额外目录");
      case "additional_file":
        return t("memory.dedupSourceAdditionalFile", {}, "可索引源：额外文件");
      default:
        return t("memory.dedupSourceIndexed", {}, "可索引源");
    }
  }

  function formatDedupSourceIndexingSummary(summary) {
    if (!summary || typeof summary !== "object") {
      return t("memory.dedupSourceSummaryEmpty", {}, "暂无来源风险摘要");
    }
    return t(
      "memory.dedupSourceSummary",
      {
        reindexable: formatCount(summary.reindexableSourcePathCount),
        external: formatCount(summary.nonReindexableSourcePathCount),
      },
      `${formatCount(summary.reindexableSourcePathCount)} 个可索引源文件 / ${formatCount(summary.nonReindexableSourcePathCount)} 个旁路源`,
    );
  }

  function formatDedupCountTransition(beforeValue, afterValue, { estimated = false } = {}) {
    const beforeText = formatCount(beforeValue);
    const afterText = formatCount(afterValue);
    return estimated
      ? `${beforeText} -> ${afterText} (${t("memory.dedupEstimated", {}, "估计")})`
      : `${beforeText} -> ${afterText}`;
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
    const previewObservability = report?.observability && typeof report.observability === "object" ? report.observability : null;
    const applyObservability = result?.observability && typeof result.observability === "object" ? result.observability : null;
    const sourceIndexingSummary = report?.sourceIndexingSummary && typeof report.sourceIndexingSummary === "object"
      ? report.sourceIndexingSummary
      : null;
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
    const warningLines = result?.backupPath
      ? [
          `已生成备份：${result.backupPath}`,
          t(
            "memory.dedupFileSizeHint",
            {},
            "说明：SQLite 在 DELETE 后不会立即缩小文件体积，优先观察 chunk / page_count / freelist_count。",
          ),
        ]
      : [
          t(
            "memory.dedupBackupHint",
            {},
            "确认清理后会先备份 memory.sqlite，再执行删除。当前确认只影响筛选范围内的 exact duplicate。",
          ),
          t(
            "memory.dedupFileSizeHint",
            {},
            "说明：SQLite 在 DELETE 后不会立即缩小文件体积，优先观察 chunk / page_count / freelist_count。",
          ),
        ];

    memoryDedupModalEl.classList.toggle("hidden", !modalState.open);
    memoryDedupModalTitleEl.textContent = result
      ? t("memory.dedupModalResultTitle", {}, "记忆重复清理结果")
      : t("memory.dedupModalTitle", {}, "记忆重复预检");
    dedupSummaryView.render({
      container: memoryDedupModalSummaryEl,
      cards: [
        { label: "扫描范围", value: report?.filter ? "当前记忆筛选结果" : "全部记忆条目" },
        {
          label: "chunk 变化",
          value: result
            ? formatDedupCountTransition(applyObservability?.beforeChunkCount, applyObservability?.afterChunkCount)
            : formatDedupCountTransition(previewObservability?.beforeChunkCount, previewObservability?.estimatedAfterChunkCount, { estimated: true }),
        },
        { label: "重复组", value: formatCount(result ? applyTotals?.duplicateGroups : totals?.duplicateGroups) },
        { label: "可移除 chunk", value: formatCount(result ? applyTotals?.removedChunks : totals?.removableChunks) },
        { label: "受影响 task links", value: formatCount(result ? applyTotals?.relinkedTaskMemoryLinks : totals?.affectedTaskLinkCount) },
        {
          label: "page_count",
          value: result
            ? formatDedupCountTransition(applyObservability?.beforePageCount, applyObservability?.afterPageCount)
            : formatCount(previewObservability?.pageCount),
        },
        {
          label: "freelist_count",
          value: result
            ? formatDedupCountTransition(applyObservability?.beforeFreelistCount, applyObservability?.afterFreelistCount)
            : formatCount(previewObservability?.freelistCount),
        },
        { label: "来源风险", value: formatDedupSourceIndexingSummary(sourceIndexingSummary) },
      ],
    });
    memoryDedupModalStatusEl.classList.toggle("hidden", !statusText);
    memoryDedupModalStatusEl.textContent = statusText;
    const visibleWarningLines = warningLines
      .filter((item) => typeof item === "string" && item.trim());
    memoryDedupModalWarningEl.classList.toggle("hidden", visibleWarningLines.length <= 0);
    dedupWarningView.render({
      container: memoryDedupModalWarningEl,
      lines: visibleWarningLines,
    });

    let dedupRows = [];
    let dedupEmptyText = "";
    if (modalState.loading) {
      dedupEmptyText = t("memory.dedupPreviewLoading", {}, "正在生成 dry-run 报告…");
    } else if (result && Array.isArray(result.groups) && result.groups.length) {
      dedupRows = result.groups.map((group) => ({
        title: `keeper ${group.keepChunkId || "-"}`,
        meta: [
          `删除 ${formatCount(Array.isArray(group.removedChunkIds) ? group.removedChunkIds.length : 0)}`,
          `迁移 links ${formatCount(group.relinkedTaskMemoryLinks)}`,
        ],
        snippet: (group.removedChunkIds || []).join(", ") || "-",
      }));
    } else if (report && Array.isArray(report.groups) && report.groups.length) {
      dedupRows = report.groups.map((group) => ({
        title: group.preview || group.normalizedHash || "-",
        meta: [
          "keeper",
          formatDedupPreviewItem(group.keep),
          formatDedupSourceIndexingSummary(group.sourceIndexing),
        ],
        snippet: (group.remove || []).map((item) => formatDedupPreviewItem(item)).join(" | "),
      }));
    } else if (report) {
      dedupEmptyText = t("memory.dedupPreviewEmpty", {}, "当前筛选范围内没有发现 exact duplicate。");
    } else {
      dedupEmptyText = t("memory.dedupPreviewIdle", {}, "尚未生成预检报告。");
    }
    dedupListView.render({
      container: memoryDedupModalListEl,
      rows: dedupRows,
      emptyText: dedupEmptyText,
    });

    memoryDedupModalSubmitBtn.textContent = result
      ? t("memory.dedupModalApplied", {}, "清理已完成")
      : t("memory.dedupModalApply", {}, "确认清理");
    memoryDedupModalSubmitBtn.disabled = modalState.loading || modalState.applying || !report || (Array.isArray(report?.groups) ? report.groups.length <= 0 : true) || Boolean(result);
    memoryDedupModalCancelBtn.disabled = modalState.applying;
    memoryDedupModalCloseBtn.disabled = modalState.applying;
  }

  function openDedupModal() {
    return dedupActions.openPreview();
  }

  function applyDedupFromModal() {
    return dedupActions.apply();
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
    return requestLifecycle.run(({ isCurrent }) => (
      requestEmailThreadConversationAdviceCurrent(conversationId, item, isCurrent)
    ));
  }

  async function requestEmailThreadConversationAdviceCurrent(conversationId, item, isCurrent) {
    const normalizedConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
    if (!normalizedConversationId) return;
    if (typeof isConnected === "function" && !isConnected()) {
      showNotice?.(
        t("memory.emailThreadOrganizerAdviceRequestOfflineTitle", {}, "未连接到服务器"),
        t("memory.emailThreadOrganizerAdviceRequestOfflineMessage", {}, "已打开线程会话，但当前没有自动请求新的处理建议。请先连接后重试。"),
        "error",
      );
      return;
    }
    const adviceRequest = emailThreadAdviceRetention.begin(normalizedConversationId);
    if (!adviceRequest) return;
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
      if (!isCurrent()) return;
      if (res?.ok === false) {
        emailThreadAdviceRetention.fail(adviceRequest);
        showNotice?.(
          t("memory.emailThreadOrganizerAdviceRequestFailedTitle", {}, "线程建议请求失败"),
          res?.error?.message || t("memory.emailThreadOrganizerAdviceRequestFailedMessage", {}, "message.send 调用失败。"),
          "error",
        );
        return;
      }
      emailThreadAdviceRetention.succeed(adviceRequest);
    } catch (error) {
      if (!isCurrent()) return;
      emailThreadAdviceRetention.fail(adviceRequest);
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

  function formatMemoryEvaluationStatusLabel(summary) {
    if (!summary?.available) {
      return t("memory.memoryEvaluationUnavailable", {}, "未评估");
    }
    return summary.status === "warn"
      ? t("memory.memoryEvaluationWarn", {}, "需处理")
      : t("memory.memoryEvaluationPass", {}, "稳定");
  }

  function buildMemoryEvaluationStatCards(summary) {
    if (!summary?.available) {
      return [];
    }
    const signals = Array.isArray(summary.signals)
      ? summary.signals.filter((item) => typeof item === "string" && item.trim()).slice(0, 1)
      : [];
    const primarySignal = signals[0] || "";
    return [
      {
        label: t("memory.memoryEvaluationTitle", {}, "Memory Evaluation"),
        value: formatMemoryEvaluationStatusLabel(summary),
        compact: true,
        caption: summary.headline || "-",
      },
      {
        label: t("memory.memoryEvaluationProfileCoverage", {}, "Profile Coverage"),
        value: formatCount(summary.profileStateFieldCount),
        caption: `freshness review ${formatCount(summary.freshnessReviewRequiredCount)} / stale ${formatCount(summary.freshnessStaleCount)}`,
      },
      {
        label: t("memory.memoryEvaluationGovernance", {}, "Governance Pressure"),
        value: `shared pending ${formatCount(summary.governancePendingCount)} / claimed ${formatCount(summary.governanceClaimedCount)}`,
        compact: true,
        caption: primarySignal || t("memory.memoryEvaluationGovernanceCaption", {}, "同一摘要已从 doctor 前推到 memory viewer。"),
      },
      {
        label: t("memory.memoryEvaluationDreamBacklog", {}, "Dream Backlog"),
        value: `patch ${formatCount(summary.dreamProfilePatchBacklogCount)} / stale ${formatCount(summary.dreamStaleBacklogCount)} / contradiction ${formatCount(summary.dreamContradictionBacklogCount)}`,
        compact: true,
        caption: `experience-linked residents ${formatCount(summary.experienceUsageLinkedResidentCount)}`,
      },
    ];
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
      sharedReviewTargetFilterView.render({
        select: memorySharedReviewTargetFilterEl,
        options,
        selectedValue: stateFilters.targetAgentId,
        fallbackLabel: "-",
      });
    }
    if (memorySharedReviewClaimedByFilterEl) {
      const options = [
        { value: "", label: t("memory.sharedReviewClaimedByAll", {}, "All Claim Owners") },
        ...agentOptions.map((agent) => ({ value: agent.id, label: agent.label })),
      ];
      sharedReviewClaimedByFilterView.render({
        select: memorySharedReviewClaimedByFilterEl,
        options,
        selectedValue: stateFilters.claimedByAgentId,
        fallbackLabel: "-",
      });
    }
  }

  function renderSharedReviewBatchBar() {
    if (!memorySharedReviewBatchBarEl) return;
    const memoryViewerState = getMemoryViewerState();
    const isSharedReview = memoryViewerState.tab === "sharedReview";
    const items = getCurrentVisibleSharedReviewItems(Array.isArray(memoryViewerState.items) ? memoryViewerState.items : []);
    if (!isSharedReview || !items.length) {
      memorySharedReviewBatchBarEl.classList.add("hidden");
      sharedReviewBatchBarView.clear({ container: memorySharedReviewBatchBarEl });
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
    sharedReviewBatchBarView.render({
      container: memorySharedReviewBatchBarEl,
      summary: t(
        "memory.sharedReviewBatchSummary",
        {
          selected: formatCount(batchState.selectedCount),
          total: formatCount(batchState.totalVisible),
        },
        `Selected ${formatCount(batchState.selectedCount)} / ${formatCount(batchState.totalVisible)}`,
      ),
      selectionButtons: [
        {
          key: "all",
          label: t("memory.sharedReviewSelectAllVisible", {}, "Select Visible"),
          disabled: busy,
        },
        {
          key: "actionable",
          label: t("memory.sharedReviewSelectActionable", {}, "Select Actionable"),
          disabled: busy,
        },
        {
          key: "clear",
          label: t("memory.sharedReviewClearSelection", {}, "Clear Selection"),
          disabled: busy || batchState.selectedCount <= 0,
        },
      ],
      actionButtons: actionButtons.map((action) => ({
        key: action.key,
        label: `${action.label} (${formatCount(action.count)})`,
        disabled: busy || action.count <= 0,
      })),
      onSelect: (mode) => {
        if (mode === "all") {
          selectAllVisibleSharedReviewItems();
        } else if (mode === "actionable") {
          selectActionableSharedReviewItems();
        } else {
          clearSharedReviewSelection();
        }
        renderSharedReviewList(items);
        renderSharedReviewBatchBar();
      },
      onAction: (action) => {
        if (!action) return;
        void runSharedReviewBatchAction(action);
      },
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
    if (!requestLifecycle.isActive() || !requestContext) return false;
    const memoryViewerState = getMemoryViewerState();
    const activeAgentId = String(memoryViewerState.activeAgentId || getActiveAgentId()).trim() || "default";
    return Number(memoryViewerState.requestToken || 0) === Number(requestContext.requestToken)
      && activeAgentId === requestContext.agentId;
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

  function formatMemorySearchSourceMix(sourceClassMix) {
    const entries = Object.entries(sourceClassMix || {}).filter(([, count]) => Number.isFinite(count) && Number(count) > 0);
    if (!entries.length) {
      return "-";
    }
    return entries.map(([key, count]) => `${key}:${formatCount(Number(count) || 0)}`).join(", ");
  }

  function formatMemorySearchStageCount(stage) {
    const count = typeof stage?.count === "number" && Number.isFinite(stage.count)
      ? Math.max(0, Math.trunc(stage.count))
      : 0;
    return formatCount(count);
  }

  function formatMemorySearchTopHits(stage) {
    const hits = Array.isArray(stage?.topHits) ? stage.topHits : [];
    if (!hits.length) {
      return "-";
    }
    return hits
      .map((item) => {
        const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : "";
        const sourceClass = typeof item?.sourceClass === "string" && item.sourceClass.trim() ? item.sourceClass.trim() : "";
        if (!id) return "";
        return sourceClass ? `${id} (${sourceClass})` : id;
      })
      .filter(Boolean)
      .join(", ") || "-";
  }

  function buildMemorySearchDiagnosticsSummaryView(diagnostics) {
    if (!diagnostics || typeof diagnostics !== "object") {
      return null;
    }
    const retrievalMode = typeof diagnostics.retrievalMode === "string" && diagnostics.retrievalMode.trim()
      ? diagnostics.retrievalMode.trim()
      : "-";
    const summaryText = t(
      "memory.searchDiagnosticsSummary",
      {
        mode: retrievalMode,
        raw: formatMemorySearchStageCount(diagnostics.stages?.raw),
        scoreAware: formatMemorySearchStageCount(diagnostics.stages?.scoreAware),
        reranked: formatMemorySearchStageCount(diagnostics.stages?.reranked),
        returned: formatMemorySearchStageCount(diagnostics.stages?.returned),
      },
      `mode=${retrievalMode} · raw ${formatMemorySearchStageCount(diagnostics.stages?.raw)} -> score ${formatMemorySearchStageCount(diagnostics.stages?.scoreAware)} -> rerank ${formatMemorySearchStageCount(diagnostics.stages?.reranked)} -> final ${formatMemorySearchStageCount(diagnostics.stages?.returned)}`,
    );
    const sourceMixText = t(
      "memory.searchDiagnosticsSourceMix",
      { value: formatMemorySearchSourceMix(diagnostics.sourceClassMix) },
      `source mix: ${formatMemorySearchSourceMix(diagnostics.sourceClassMix)}`,
    );
    const topHitsText = t(
      "memory.searchDiagnosticsTopHits",
      { value: formatMemorySearchTopHits(diagnostics.stages?.returned) },
      `top hits: ${formatMemorySearchTopHits(diagnostics.stages?.returned)}`,
    );
    return {
      title: t("memory.searchDiagnosticsTitle", {}, "Search Diagnostics"),
      badges: [
        `raw ${formatMemorySearchStageCount(diagnostics.stages?.raw)}`,
        `score ${formatMemorySearchStageCount(diagnostics.stages?.scoreAware)}`,
        `rerank ${formatMemorySearchStageCount(diagnostics.stages?.reranked)}`,
        `final ${formatMemorySearchStageCount(diagnostics.stages?.returned)}`,
      ],
      lines: [summaryText, sourceMixText, topHitsText],
    };
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
      dreamHistoryListView.render({
        container: memoryDreamHistoryListEl,
        entries: panelView.entries,
        emptyText: panelView.listEmptyText,
      });
    }
    if (memoryDreamHistoryDetailEl) {
      if (panelView.detail.loading || (!panelView.detail.content && panelView.detail.error) || panelView.detail.cards.length <= 0) {
        dreamHistoryDetailEmptyView.render({
          container: memoryDreamHistoryDetailEl,
          text: panelView.detail.emptyText,
        });
      } else {
        dreamHistoryDetailView.render({
          container: memoryDreamHistoryDetailEl,
          detail: panelView.detail,
          labels: {
            approve: t("memory.dreamConsolidationApprove", {}, "批准低风险画像 patch"),
            reject: t("memory.dreamConsolidationReject", {}, "驳回本次整理建议"),
            apply: t("memory.dreamConsolidationApply", {}, "应用已批准 patch"),
            reason: t("memory.dreamHistoryReason", {}, "触发原因"),
            content: t("memory.dreamHistoryContent", {}, "Dream 正文"),
          },
        });
      }
    }
  }

  async function loadDreamHistoryDetailInternal(dreamId, agentId = getActiveAgentId()) {
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

  function loadDreamHistoryDetail(dreamId, agentId = getActiveAgentId()) {
    return dreamHistoryLifecycle.run("detail", () => loadDreamHistoryDetailInternal(dreamId, agentId));
  }

  async function loadDreamHistoryInternal(forceSelectFirst = false, agentId = getActiveAgentId()) {
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

  function loadDreamHistory(forceSelectFirst = false, agentId = getActiveAgentId()) {
    return dreamHistoryLifecycle.run("list", () => loadDreamHistoryInternal(forceSelectFirst, agentId));
  }

  function reviewDreamConsolidation(decision) {
    return dreamConsolidationActions.review(decision);
  }

  function applyDreamConsolidation() {
    return dreamConsolidationActions.apply();
  }

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

  async function loadMemoryViewerInternal(forceSelectFirst = false) {
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
      memoryViewerState.memoryEvaluation = null;
      renderDreamRuntimeBar();
      renderMemoryViewerStats(null);
      renderMemoryViewerListEmpty(t("memory.disconnectedList", {}, "Not connected to the server."));
      renderMemoryViewerDetailEmpty(t("memory.disconnectedDetail", {}, "Tasks and memories will be available after connection is ready."));
      return;
    }

    const memoryViewerState = getMemoryViewerState();
    const dreamLoadPromise = Promise.all([
      loadDreamRuntimeStatus(requestContext),
      loadDreamCommonsStatus(requestContext),
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
    return (await dreamRuntimeLifecycle.run("status", ({ isCurrent }) => (
      loadDreamRuntimeStatusCurrent(requestContext, isCurrent)
    ))) ?? null;
  }

  async function loadDreamRuntimeStatusCurrent(requestContext, isLifecycleCurrent) {
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
    if (!isLifecycleCurrent() || !isMemoryViewerRequestCurrent(activeRequest)) {
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

  async function loadDreamCommonsStatus(requestContext = null) {
    return (await dreamRuntimeLifecycle.run("commons", ({ isCurrent }) => (
      loadDreamCommonsStatusCurrent(requestContext, isCurrent)
    ))) ?? null;
  }

  async function loadDreamCommonsStatusCurrent(requestContext, isLifecycleCurrent) {
    const activeRequest = createMemoryViewerRequestContext(requestContext);
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
    if (!isLifecycleCurrent() || !isMemoryViewerRequestCurrent(activeRequest)) {
      return null;
    }
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
    return dreamRunAction.run();
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
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    const emailRes = await sendReq({
      type: "req",
      id: makeId(),
      method: "email_outbound.audit.list",
      params: { limit: 50 },
    });
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    const inboundRes = await sendReq({
      type: "req",
      id: makeId(),
      method: "email_inbound.audit.list",
      params: { limit: 50 },
    });
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
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
    const shouldLoadMemoryEvaluation = getMemoryViewerState().tab === "memories";
    const [res, doctorRes] = await Promise.all([
      sendReq({
        type: "req",
        id: makeId(),
        method: "memory.stats",
        params: buildScopedParams({}, requestContext.agentId),
      }),
      shouldLoadMemoryEvaluation
        ? sendReq({
          type: "req",
          id: makeId(),
          method: "system.doctor",
          params: buildScopedParams({ surface: "summary" }, requestContext.agentId),
        })
        : Promise.resolve(null),
    ]);
    const memoryViewerState = getMemoryViewerState();
    if (!isMemoryViewerRequestCurrent(requestContext)) return;
    if (!res || !res.ok) {
      memoryViewerState.sharedGovernance = null;
      memoryViewerState.memoryEvaluation = null;
      renderMemoryViewerStats(null);
      return;
    }
    memoryViewerState.stats = res.payload?.status ?? null;
    memoryViewerState.memoryQueryView = res.payload?.queryView ?? null;
    memoryViewerState.sharedGovernance = res.payload?.sharedGovernance ?? null;
    memoryViewerState.memoryEvaluation = doctorRes?.ok
      ? (doctorRes.payload?.memoryEvaluation ?? null)
      : null;
    renderMemoryViewerStats(memoryViewerState.stats);
  }

  async function loadMemoryViewer(forceSelectFirst = false) {
    return requestLifecycle.run(() => loadMemoryViewerInternal(forceSelectFirst));
  }

  async function promoteSelectedMemoryToShared(item) {
    return sharePromoteAction.promote(item);
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
    return shareBatchAction.run(action);
  }

  async function reviewSelectedMemoryShare(item, decision, scope = "chunk") {
    return shareReviewAction.review(item, decision, scope);
  }

  async function claimSelectedMemoryShare(item, action, scope = "chunk") {
    return shareClaimAction.claim(item, action, scope);
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
    return requestLifecycle.run(() => openSharedReviewContextForItemCurrent(item));
  }

  async function openSharedReviewContextForItemCurrent(item) {
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
      memoryViewerState.memorySearchDiagnostics = null;
      renderMemoryViewerListEmpty(t("memory.memoryListLoadFailed", {}, "Failed to load memory list."));
      renderMemoryViewerDetailEmpty(res?.error?.message || t("memory.memoryReadFailed", {}, "Failed to read memory data."));
      return;
    }

    const items = Array.isArray(res.payload?.items) ? res.payload.items : [];
    memoryViewerState.items = items;
    memoryViewerState.memoryQueryView = res.payload?.queryView ?? memoryViewerState.memoryQueryView ?? null;
    memoryViewerState.memorySearchDiagnostics = query ? (res.payload?.diagnostics ?? null) : null;
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
        statsFallbackView.render({
          container: memoryViewerStatsEl,
          labels: [
            t("memory.statFiles", {}, "Memory Files"),
            t("memory.statChunks", {}, "Memory Chunks"),
            t("memory.statVectors", {}, "Vector Index"),
            t("memory.statSummaries", {}, "Summaries Ready"),
          ],
        });
        return;
      }
    }

    if (memoryViewerState.tab === "outboundAudit") {
      const items = Array.isArray(memoryViewerState.items) ? memoryViewerState.items : [];
      if (getOutboundAuditFocus() === "threads") {
        const summary = buildEmailThreadOrganizerStats(items);
        outboundThreadStatsView.render({
          container: memoryViewerStatsEl,
          cards: [
            { label: t("memory.statCurrentResults", {}, "Current Results"), value: formatCount(summary.threadCount) },
            { label: t("memory.emailThreadOrganizerStatNeedsReply", {}, "待回复线程"), value: formatCount(summary.needsReplyCount) },
            { label: t("memory.emailThreadOrganizerStatNeedsFollowUp", {}, "待跟进线程"), value: formatCount(summary.needsFollowUpCount) },
            { label: t("memory.emailThreadOrganizerStatReminderPending", {}, "待提醒线程"), value: formatCount(summary.reminderPendingCount) },
            { label: t("memory.emailThreadOrganizerStatReminderDelivered", {}, "已提醒线程"), value: formatCount(summary.reminderDeliveredCount) },
            { label: t("memory.emailThreadOrganizerStatReplyReview", {}, "回复待复核"), value: formatCount(summary.replyReviewRequiredCount) },
            { label: t("memory.emailThreadOrganizerStatFailed", {}, "有失败记录"), value: formatCount(summary.failedThreadCount) },
            { label: t("memory.emailThreadOrganizerStatRetry", {}, "待重试线程"), value: formatCount(summary.retryScheduledCount) },
          ],
        });
        return;
      }
      const outboundSentCount = items.filter((item) => item?.auditKind !== "email_inbound" && item?.delivery === "sent").length;
      const outboundFailedCount = items.filter((item) => item?.auditKind !== "email_inbound" && item?.delivery === "failed").length;
      const inboundProcessedCount = items.filter((item) => item?.auditKind === "email_inbound" && item?.status === "processed").length;
      const inboundFailedCount = items.filter((item) => item?.auditKind === "email_inbound" && item?.status === "failed").length;
      const inboundDuplicateCount = items.filter((item) => item?.auditKind === "email_inbound" && item?.status === "skipped_duplicate").length;
      outboundAuditStatsView.render({
        container: memoryViewerStatsEl,
        cards: [
          { label: t("memory.statCurrentResults", {}, "Current Results"), value: formatCount(items.length) },
          { label: t("memory.outboundAuditStatSent", {}, "外发已发送"), value: formatCount(outboundSentCount) },
          { label: t("memory.outboundAuditStatFailed", {}, "外发失败"), value: formatCount(outboundFailedCount) },
          { label: t("memory.outboundAuditStatInboundProcessed", {}, "收信已处理"), value: formatCount(inboundProcessedCount) },
          { label: t("memory.outboundAuditStatInboundFailed", {}, "收信失败"), value: formatCount(inboundFailedCount) },
          { label: t("memory.outboundAuditStatInboundDuplicate", {}, "收信重复跳过"), value: formatCount(inboundDuplicateCount) },
        ],
      });
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
      sharedReviewStatsView.render({
        container: memoryViewerStatsEl,
        cards: [
          { label: t("memory.sharedReviewActingAs", {}, "Acting Reviewer"), value: summary.reviewerAgentId || getActiveAgentId(), compact: true },
          { label: t("memory.statSharedPendingQueue", {}, "Pending Shared Queue"), value: formatCount(summary.pendingCount) },
          { label: t("memory.sharedReviewActionableCount", {}, "Actionable Now"), value: formatCount(summary.reviewerActionableCount) },
          { label: t("memory.sharedReviewMyClaims", {}, "My Claims"), value: formatCount(summary.reviewerClaimedCount) },
          {
            label: t("memory.sharedReviewOverdueCount", {}, "Timed-out Claims"),
            value: formatCount(summary.overdueCount),
            caption: t(
              "memory.sharedReviewOverdueHint",
              { duration: formatDuration(summary.claimTimeoutMs) },
              `Timeout after ${formatDuration(summary.claimTimeoutMs)}`,
            ),
          },
          { label: t("memory.sharedReviewBlockedCount", {}, "Blocked by Others"), value: formatCount(summary.blockedCount) },
          { label: t("memory.sharedReviewAgentBacklog", {}, "Backlog by Agent"), value: agentSummary, compact: true },
          { label: t("memory.sharedReviewReviewerBacklog", {}, "Backlog by Reviewer"), value: reviewerSummary, compact: true },
          {
            label: t("memory.sharedReviewCompletedCount", {}, "Reviewed History"),
            value: formatCount((Number(summary.approvedCount) || 0) + (Number(summary.rejectedCount) || 0) + (Number(summary.revokedCount) || 0)),
          },
        ],
      });
      return;
    }

    if (memoryViewerState.tab === "memories") {
      const items = Array.isArray(memoryViewerState.items) ? memoryViewerState.items : [];
      const currentCategorized = items.filter((item) => Boolean(item?.category)).length;
      const currentUncategorized = items.length - currentCategorized;
      const activeCategoryLabel = getActiveMemoryCategoryLabel();
      const distribution = getMemoryCategoryDistributionViewModel(stats);
      const queryView = memoryViewerState.memoryQueryView;
      const searchDiagnostics = memoryViewerState.memorySearchDiagnostics;
      const sharedGovernance = memoryViewerState.sharedGovernance;
      const memoryEvaluation = memoryViewerState.memoryEvaluation;
      const governanceFilterLabel = formatGovernanceFilterLabel(memoryChunkGovernanceFilterEl?.value);

      memoryStatsView.render({
        container: memoryViewerStatsEl,
        cards: [
          { label: t("memory.statCurrentResults", {}, "Current Results"), value: formatCount(items.length) },
          {
            label: t("memory.statQueryStrategy", {}, "Current Query Strategy"),
            value: formatResidentQueryModeLabel(queryView),
            compact: true,
            caption: formatResidentQueryModeSummary(queryView),
          },
          ...(searchDiagnostics ? [
            {
              label: t("memory.statSearchReturned", {}, "Search Returned"),
              value: formatMemorySearchStageCount(searchDiagnostics.stages?.returned),
              caption: formatMemorySearchSourceMix(searchDiagnostics.sourceClassMix),
            },
            {
              label: t("memory.statSearchPipeline", {}, "Search Pipeline"),
              value: `${formatMemorySearchStageCount(searchDiagnostics.stages?.raw)} → ${formatMemorySearchStageCount(searchDiagnostics.stages?.scoreAware)} → ${formatMemorySearchStageCount(searchDiagnostics.stages?.reranked)} → ${formatMemorySearchStageCount(searchDiagnostics.stages?.returned)}`,
              compact: true,
              caption: searchDiagnostics.retrievalMode || "-",
            },
            {
              label: t("memory.statSearchTopHits", {}, "Search Top Hits"),
              value: formatMemorySearchTopHits(searchDiagnostics.stages?.returned),
              compact: true,
            },
          ] : []),
          ...buildMemoryEvaluationStatCards(memoryEvaluation),
          { label: t("memory.statGovernanceFilter", {}, "Current Governance Filter"), value: governanceFilterLabel, compact: true },
          { label: t("memory.statSharedPendingQueue", {}, "Pending Shared Queue"), value: formatCount(sharedGovernance?.pendingCount) },
          { label: t("memory.statSharedClaimed", {}, "Claimed Pending"), value: formatCount(sharedGovernance?.claimedCount) },
          { label: t("memory.statSharedApproved", {}, "Approved Shared"), value: formatCount(sharedGovernance?.approvedCount) },
          { label: t("memory.statSharedRejected", {}, "Rejected Shared"), value: formatCount(sharedGovernance?.rejectedCount) },
          { label: t("memory.statSharedRevoked", {}, "Revoked Shared"), value: formatCount(sharedGovernance?.revokedCount) },
          { label: t("memory.statFilteredCategory", {}, "Filtered Category"), value: activeCategoryLabel },
          { label: t("memory.statCurrentCategorized", {}, "Currently Categorized"), value: formatCount(currentCategorized) },
          { label: t("memory.statCurrentUncategorized", {}, "Currently Uncategorized"), value: formatCount(currentUncategorized) },
          { label: t("memory.statLibraryCategorized", {}, "Library Categorized"), value: formatCount(stats.categorized) },
          { label: t("memory.statLibraryUncategorized", {}, "Library Uncategorized"), value: formatCount(stats.uncategorized) },
        ],
        distribution,
      });
      return;
    }

    const selectedTask = memoryViewerState.selectedTask;
    const usedMethods = Array.isArray(selectedTask?.usedMethods) ? selectedTask.usedMethods : [];
    const usedSkills = Array.isArray(selectedTask?.usedSkills) ? selectedTask.usedSkills : [];
    const lastUsedAt = getLatestExperienceUsageTimestamp(usedMethods, usedSkills);
    const activeGoalId = memoryViewerState.goalIdFilter;
    const activeGoalLabel = activeGoalId ? getGoalDisplayName(activeGoalId) : "-";
    const queryView = memoryViewerState.experienceQueryView || memoryViewerState.memoryQueryView;

    taskStatsView.render({
      container: memoryViewerStatsEl,
      cards: [
        {
          label: t("memory.statCurrentTaskResults", {}, "Current Task Results"),
          value: formatCount(Array.isArray(memoryViewerState.items) ? memoryViewerState.items.length : 0),
        },
        {
          label: t("memory.statExperienceQueryStrategy", {}, "Current Experience Query Strategy"),
          value: formatResidentQueryModeLabel(queryView),
          compact: true,
          caption: formatResidentQueryModeSummary(queryView),
        },
        { label: t("memory.statUsedMethods", {}, "Methods Used"), value: formatCount(usedMethods.length) },
        { label: t("memory.statUsedSkills", {}, "Skills Used"), value: formatCount(usedSkills.length) },
        {
          label: t("memory.statLastUsedAt", {}, "Last Used At"),
          value: formatDateTime(lastUsedAt),
          compact: true,
        },
        ...(activeGoalId ? [{
          label: t("memory.statGoalFilter", {}, "Goal Filter"),
          value: activeGoalLabel,
          compact: true,
          caption: activeGoalId,
        }] : []),
      ],
    });
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
    taskListView.render({
      container: memoryViewerListEl,
      rows: pagination.visibleItems.map((item) => {
        const title = item.title || item.objective || item.summary || item.conversationId || item.id;
        const snippet = item.summary || item.outcome || item.objective || t("memory.emptyNoSummary", {}, "No summary");
        const isActive = item.id === memoryViewerState.selectedId;
        const goalId = getTaskGoalId(item);
        return {
          id: String(item?.id ?? ""),
          isActive,
          title: String(title ?? ""),
          meta: [
            { text: String(formatTaskStatusLabel(item.status) ?? "") },
            { text: String(formatTaskSourceLabel(item.source) ?? "") },
            ...(goalId ? [{ text: String(getGoalDisplayName(goalId) ?? ""), kind: "shared" }] : []),
            { text: String(formatDateTime(item.finishedAt || item.startedAt || item.createdAt) ?? "") },
          ],
          snippet: String(snippet ?? ""),
        };
      }),
      pagination: pagination.hasPagination ? {
        summary: t(
          "memory.paginationSummary",
          {
            start: formatCount(pagination.visibleStart),
            end: formatCount(pagination.visibleEnd),
            total: formatCount(pagination.totalItems),
            page: formatCount(pagination.currentPage + 1),
            pages: formatCount(pagination.totalPages),
          },
          `Showing ${formatCount(pagination.visibleStart)}-${formatCount(pagination.visibleEnd)} / ${formatCount(pagination.totalItems)} · Page ${formatCount(pagination.currentPage + 1)} of ${formatCount(pagination.totalPages)}`,
        ),
        previousLabel: t("memory.paginationPrev", {}, "Prev"),
        nextLabel: t("memory.paginationNext", {}, "Next"),
        previousDisabled: pagination.currentPage <= 0,
        nextDisabled: pagination.currentPage >= pagination.totalPages - 1,
      } : null,
    });

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
    memoryListView.render({
      container: memoryViewerListEl,
      diagnostics: buildMemorySearchDiagnosticsSummaryView(memoryViewerState.memorySearchDiagnostics),
      rows: pagination.visibleItems.map((item) => {
        const title = summarizeSourcePath(item.sourcePath);
        const summary = item.summary || item.snippet || t("memory.emptyNoSummary", {}, "No summary");
        const isActive = item.id === memoryViewerState.selectedId;
        const visibility = normalizeMemoryVisibility(item.visibility);
        const category = formatMemoryCategory(item.category);
        const sourceView = item.sourceView || { scope: visibility };
        const sourceScope = formatResidentSourceScopeLabel(sourceView);
        const visibilityBadgeClass = getVisibilityBadgeClass(visibility);
        return {
          id: String(item?.id ?? ""),
          isActive,
          title: String(title ?? ""),
          meta: [
            { text: String(formatMemoryTypeLabel(item.memoryType) ?? "") },
            { text: String(formatMemorySourceTypeLabel(item.sourceType) ?? "") },
            {
              text: String(visibility ?? ""),
              kind: visibilityBadgeClass === "memory-badge-shared"
                ? "shared"
                : visibilityBadgeClass === "memory-badge-hybrid" ? "hybrid" : "private",
            },
            {
              text: String(sourceScope ?? ""),
              kind: sourceScope,
            },
            { text: String(category ?? ""), kind: "badge" },
            { text: `score ${formatScore(item.score)}` },
          ],
          snippet: String(summary ?? ""),
        };
      }),
      pagination: pagination.hasPagination ? {
        summary: t(
          "memory.paginationSummary",
          {
            start: formatCount(pagination.visibleStart),
            end: formatCount(pagination.visibleEnd),
            total: formatCount(pagination.totalItems),
            page: formatCount(pagination.currentPage + 1),
            pages: formatCount(pagination.totalPages),
          },
          `Showing ${formatCount(pagination.visibleStart)}-${formatCount(pagination.visibleEnd)} / ${formatCount(pagination.totalItems)} · Page ${formatCount(pagination.currentPage + 1)} of ${formatCount(pagination.totalPages)}`,
        ),
        previousLabel: t("memory.paginationPrev", {}, "Prev"),
        nextLabel: t("memory.paginationNext", {}, "Next"),
        previousDisabled: pagination.currentPage <= 0,
        nextDisabled: pagination.currentPage >= pagination.totalPages - 1,
      } : null,
    });

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
    sharedReviewListView.render({
      container: memoryViewerListEl,
      rows: pagination.visibleItems.map((item) => {
        const title = summarizeSourcePath(item.sourcePath);
        const summary = item.summary || item.snippet || t("memory.emptyNoSummary", {}, "No summary");
        const isActive = item.id === memoryViewerState.selectedId;
        const isSelected = selectedIds.has(item.id);
        const visibility = normalizeMemoryVisibility(item.visibility);
        const category = formatMemoryCategory(item.category);
        const sourceView = item.sourceView || { scope: visibility };
        const sourceBadgeClass = getResidentSourceBadgeClass(sourceView);
        const sourceKind = sourceBadgeClass === "memory-badge-shared"
          ? "shared"
          : sourceBadgeClass === "memory-badge-hybrid" ? "hybrid" : "private";
        const promotion = getMemorySharePromotionMetadata(item);
        const claimState = getMemoryShareClaimState(item);
        const claimOwner = claimState.claimOwner;
        const targetLabel = item.targetDisplayName || item.targetAgentId || promotion?.sourceAgentId || "-";
        const statusLabel = formatMemorySharePromotionStatusLabel(item.reviewStatus || normalizeMemorySharePromotionStatus(item));
        const requestedAt = promotion?.requestedAt || item.updatedAt || "";
        const currentAgentId = getActiveAgentId();
        const claimMeta = claimState.claimTimedOut
          ? [{ text: String(t("memory.sharedReviewOverdueBadge", {}, "Claim Timed Out") ?? ""), kind: "shared" }]
          : claimOwner
            ? [{
                text: String(`${t("memory.detailSharedClaim", {}, "Review Claim")}: ${claimOwner}`),
                kind: claimOwner === currentAgentId ? "shared" : "hybrid",
              }]
            : [];
        const queueStateMeta = claimState.blockedByOtherReviewer
          ? [{ text: String(t("memory.sharedReviewBlockedBadge", {}, "Blocked") ?? ""), kind: "hybrid" }]
          : claimState.actionableByReviewer
            ? [{ text: String(t("memory.sharedReviewActionableBadge", {}, "Actionable") ?? ""), kind: "private" }]
            : [];
        const claimDeadlineMeta = claimState.claimExpiresAt
          ? [{
              text: String(claimState.claimTimedOut
                ? t("memory.sharedReviewExpiredAt", { time: formatDateTime(claimState.claimExpiresAt) }, `Expired ${formatDateTime(claimState.claimExpiresAt)}`)
                : t("memory.sharedReviewExpiresAt", { time: formatDateTime(claimState.claimExpiresAt) }, `Expires ${formatDateTime(claimState.claimExpiresAt)}`)),
            }]
          : [];
        return {
          id: String(item?.id ?? ""),
          targetAgentId: String(item?.targetAgentId ?? ""),
          isActive,
          isSelected,
          title: String(title ?? ""),
          meta: [
            { text: String(targetLabel ?? ""), kind: "badge" },
            { text: String(statusLabel ?? ""), kind: "badge" },
            ...claimMeta,
            ...queueStateMeta,
            { text: String(formatResidentSourceScopeLabel(sourceView) ?? ""), kind: sourceKind },
            { text: String(category ?? ""), kind: "badge" },
            ...claimDeadlineMeta,
            { text: String(formatDateTime(requestedAt) ?? "") },
          ],
          snippet: String(summary ?? ""),
        };
      }),
      pagination: pagination.hasPagination ? {
        summary: t(
          "memory.paginationSummary",
          {
            start: formatCount(pagination.visibleStart),
            end: formatCount(pagination.visibleEnd),
            total: formatCount(pagination.totalItems),
            page: formatCount(pagination.currentPage + 1),
            pages: formatCount(pagination.totalPages),
          },
          `Showing ${formatCount(pagination.visibleStart)}-${formatCount(pagination.visibleEnd)} / ${formatCount(pagination.totalItems)} · Page ${formatCount(pagination.currentPage + 1)} of ${formatCount(pagination.totalPages)}`,
        ),
        previousLabel: t("memory.paginationPrev", {}, "Prev"),
        nextLabel: t("memory.paginationNext", {}, "Next"),
        previousDisabled: pagination.currentPage <= 0,
        nextDisabled: pagination.currentPage >= pagination.totalPages - 1,
      } : null,
    });

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
    outboundAuditListView.render({
      container: memoryViewerListEl,
      rows: pagination.visibleItems.map((item, index) => {
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
          return {
            id: String(itemId ?? ""),
            isActive,
            title: String(title ?? ""),
            meta: [
              String(formatDateTime(item?.latestTimestamp) ?? ""),
              String(item?.latestSender || item?.targetAccountId || "-"),
              String(stateParts.join(" / ") || t("memory.emailThreadOrganizerStateNeutral", {}, "线程整理")),
            ],
            snippet: String(snippet ?? ""),
          };
        }
        const channel = formatOutboundAuditChannelLabel(item);
        const preview = formatOutboundAuditPreview(item);
        const stateSummary = item?.auditKind === "email_inbound"
          ? formatEmailInboundStatusLabel(item?.status)
          : `${formatExternalOutboundDecisionLabel(item?.decision)} / ${formatExternalOutboundDeliveryLabel(item?.delivery)}`;
        return {
          id: String(itemId ?? ""),
          isActive,
          title: String(`${channel} · ${stateSummary}`),
          meta: [
            String(formatDateTime(item?.timestamp) ?? ""),
            String(item?.requestId || item?.messageId || "-"),
            String(item?.requestedByAgentId || item?.requestedAgentId || "-"),
          ],
          snippet: String(preview ?? ""),
        };
      }),
      pagination: pagination.hasPagination ? {
        summary: t(
          "memory.paginationSummary",
          {
            start: formatCount(pagination.visibleStart),
            end: formatCount(pagination.visibleEnd),
            total: formatCount(pagination.totalItems),
            page: formatCount(pagination.currentPage + 1),
            pages: formatCount(pagination.totalPages),
          },
          `Showing ${formatCount(pagination.visibleStart)}-${formatCount(pagination.visibleEnd)} / ${formatCount(pagination.totalItems)} · Page ${formatCount(pagination.currentPage + 1)} of ${formatCount(pagination.totalPages)}`,
        ),
        previousLabel: t("memory.paginationPrev", {}, "Prev"),
        nextLabel: t("memory.paginationNext", {}, "Next"),
        previousDisabled: pagination.currentPage <= 0,
        nextDisabled: pagination.currentPage >= pagination.totalPages - 1,
      } : null,
    });

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

    outboundAuditDetailView.render({
      container: memoryViewerDetailEl,
      item,
      compact: isCompactGovernanceDetailMode(),
    });
    if (item?.auditKind !== "email_thread_organizer") return;

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
  }

  function getCandidateDetailViewInput(candidate) {
    const memoryViewerState = getMemoryViewerState();
    return {
      candidate,
      contextTargets: extractCandidateContextTargets(candidate),
      pendingActionKey: typeof memoryViewerState.pendingExperienceActionKey === "string"
        ? memoryViewerState.pendingExperienceActionKey
        : "",
      compact: isCompactGovernanceDetailMode(),
    };
  }

  function createCandidateDetailPanel(candidate, ownerDocument = memoryViewerDetailEl?.ownerDocument) {
    if (!candidate || !ownerDocument) return null;
    return candidateDetailView.createPanel({
      ownerDocument,
      ...getCandidateDetailViewInput(candidate),
    });
  }

  function renderCandidateOnlyDetail(candidate) {
    if (!memoryViewerDetailEl) return;
    if (!candidate) {
      renderMemoryViewerDetailEmpty(t("memory.candidateMissing", {}, "Candidate not found."));
      return;
    }
    candidateDetailView.render({
      container: memoryViewerDetailEl,
      ...getCandidateDetailViewInput(candidate),
    });
    bindMemoryPathLinks();
    bindTaskAuditJumpLinks();
  }
  function renderMemoryDetail(item) {
    if (!memoryViewerDetailEl) return;
    if (!item) {
      renderMemoryViewerDetailEmpty(t("memory.memoryMissing", {}, "Memory not found."));
      return;
    }

    const visibility = normalizeMemoryVisibility(item.visibility);
    const category = formatMemoryCategory(item.category);
    const sourceView = item.sourceView || { scope: visibility };
    const promotionStatus = normalizeMemorySharePromotionStatus(item);
    const shareStatus = formatMemorySharePromotionStatusLabel(promotionStatus);
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
    const shareActions = [];

    if (shareActionMode === "request" && sourceView.scope !== "shared") {
      shareActions.push({
        kind: "promote",
        value: item.id,
        label: t("memory.sharePromoteAction", {}, "Submit Shared Review"),
      });
    }
    if (shareActionMode === "pending") {
      if (claimOwner === activeAgentId && !claimTimedOut) {
        shareActions.push({
          kind: "claim",
          action: "release",
          scope: shareActionScope,
          label: t("memory.shareReleaseAction", {}, "Release"),
        });
      }
      if (canClaimNow) {
        shareActions.push({
          kind: "claim",
          action: "claim",
          scope: shareActionScope,
          label: t("memory.shareClaimAction", {}, "Claim"),
        });
      }
      if (canReviewNow) {
        shareActions.push(
          {
            kind: "decision",
            decision: "approved",
            label: t("memory.shareReviewApproveAction", {}, "Approve"),
          },
          {
            kind: "decision",
            decision: "rejected",
            label: t("memory.shareReviewRejectAction", {}, "Reject"),
          },
        );
        if (shareActionScope === "source") {
          shareActions.push(
            {
              kind: "decision",
              decision: "approved",
              scope: "source",
              label: t("memory.shareReviewApproveBatchAction", {}, "Approve Source Group"),
            },
            {
              kind: "decision",
              decision: "rejected",
              scope: "source",
              label: t("memory.shareReviewRejectBatchAction", {}, "Reject Source Group"),
            },
          );
        }
      }
    }
    if (shareActionMode === "approved") {
      shareActions.push({
        kind: "decision",
        decision: "revoked",
        label: t("memory.shareReviewRevokeAction", {}, "Revoke Shared"),
      });
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
    const contentText = String(item.content || item.snippet || t("memory.noContent", {}, "No content"));
    const contentPreview = buildMemoryDetailCollapsedPreview(contentText);
    const metadataText = item.metadata ? JSON.stringify(item.metadata, null, 2) : "";
    const metadataPreview = metadataText ? buildMemoryDetailCollapsedPreview(metadataText) : null;

    memoryDetailView.render({
      container: memoryViewerDetailEl,
      view: {
        item,
        compact: isCompactGovernanceDetailMode(),
        visibility,
        category,
        sourceBadge: {
          label: formatResidentSourceScopeLabel(sourceView),
          className: getResidentSourceBadgeClass(sourceView),
        },
        sourceSummary: formatResidentSourceSummary(sourceView),
        sourceExplanation,
        sourceConflictSummary,
        sourceAuditSummary,
        shareStatus,
        shareActions,
        governanceSummary,
        claimOwner,
        claimTimedOut,
        claimStatusText,
        reviewerStateText,
        targetDisplayName,
        canOpenSharedReviewContext: Boolean(promotionStatus && promotionStatus !== "none"),
        contentText,
        contentPreview,
        metadataText,
        metadataPreview,
      },
    });
    bindMemoryPathLinks();
    bindMemoryDetailActions(item);
  }

  function dispose() {
    ingressLifecycle.dispose();
    dreamModalOpen = false;
    modalControls.dispose();
    dedupActions.dispose();
    dreamHistoryLifecycle.dispose();
    dreamConsolidationActions.dispose();
    dreamRuntimeLifecycle.dispose();
    dreamRunAction.dispose();
    sharePromoteAction.dispose();
    shareClaimAction.dispose();
    shareReviewAction.dispose();
    shareBatchAction.dispose();
    requestLifecycle.dispose();
    retainedStateLifecycle.dispose();
  }

  function getRuntimeSnapshot() {
    return {
      ...requestLifecycle.getRuntimeSnapshot(),
      ...retainedStateLifecycle.getRuntimeSnapshot(),
      ...modalControls.getRuntimeSnapshot(),
      ...dedupActions.getRuntimeSnapshot(),
      ...dreamHistoryLifecycle.getRuntimeSnapshot(),
      ...dreamConsolidationActions.getRuntimeSnapshot(),
      ...dreamRuntimeLifecycle.getRuntimeSnapshot(),
      ...dreamRunAction.getRuntimeSnapshot(),
      ...sharePromoteAction.getRuntimeSnapshot(),
      ...shareClaimAction.getRuntimeSnapshot(),
      ...shareReviewAction.getRuntimeSnapshot(),
      ...shareBatchAction.getRuntimeSnapshot(),
      ...ingressLifecycle.getRuntimeSnapshot(),
    };
  }

  return {
    applyAgentViewState: ingressLifecycle.guard(applyAgentViewState),
    captureAgentViewState: ingressLifecycle.guard(captureAgentViewState),
    clearDreamHistoryState: ingressLifecycle.guard(clearDreamHistoryState),
    closeDreamModal: ingressLifecycle.guard(closeDreamModal),
    loadDreamCommonsStatus: ingressLifecycle.guardAsync(loadDreamCommonsStatus),
    loadDreamHistory: ingressLifecycle.guardAsync(loadDreamHistory),
    loadDreamHistoryDetail: ingressLifecycle.guardAsync(loadDreamHistoryDetail),
    loadDreamRuntimeStatus: ingressLifecycle.guardAsync(loadDreamRuntimeStatus),
    loadExternalOutboundAuditViewer: ingressLifecycle.guardAsync((...args) => (
      requestLifecycle.run(() => loadExternalOutboundAuditViewer(...args))
    )),
    loadMemoryChunkViewer: ingressLifecycle.guardAsync((...args) => (
      requestLifecycle.run(() => loadMemoryChunkViewer(...args))
    )),
    loadMemoryViewer: ingressLifecycle.guardAsync(loadMemoryViewer),
    loadMemoryViewerStats: ingressLifecycle.guardAsync((...args) => (
      requestLifecycle.run(() => loadMemoryViewerStats(...args))
    )),
    loadSharedReviewQueue: ingressLifecycle.guardAsync((...args) => (
      requestLifecycle.run(() => loadSharedReviewQueue(...args))
    )),
    loadTaskUsageOverview: ingressLifecycle.guardAsync((...args) => (
      requestLifecycle.run(() => loadTaskUsageOverview(...args))
    )),
    loadTaskViewer: ingressLifecycle.guardAsync((...args) => (
      requestLifecycle.run(() => loadTaskViewer(...args))
    )),
    createCandidateDetailPanel: ingressLifecycle.guard(createCandidateDetailPanel, null),
    renderCandidateOnlyDetail: ingressLifecycle.guard(renderCandidateOnlyDetail),
    renderExternalOutboundAuditDetail: ingressLifecycle.guard(renderExternalOutboundAuditDetail),
    renderExternalOutboundAuditList: ingressLifecycle.guard(renderExternalOutboundAuditList),
    renderDreamHistoryPanel: ingressLifecycle.guard(renderDreamHistoryPanel),
    renderDreamModal: ingressLifecycle.guard(renderDreamModal),
    renderDreamRuntimeBar: ingressLifecycle.guard(renderDreamRuntimeBar),
    renderDedupModal: ingressLifecycle.guard(renderDedupModal),
    renderMemoryList: ingressLifecycle.guard(renderMemoryList),
    renderSharedReviewList: ingressLifecycle.guard(renderSharedReviewList),
    renderMemoryDetail: ingressLifecycle.guard(renderMemoryDetail),
    renderMemoryViewerStats: ingressLifecycle.guard(renderMemoryViewerStats),
    renderTaskList: ingressLifecycle.guard(renderTaskList),
    openDedupModal: ingressLifecycle.guardAsync(openDedupModal),
    applyDedupFromModal: ingressLifecycle.guardAsync(applyDedupFromModal),
    closeDedupModal: ingressLifecycle.guard(closeDedupModal),
    runDream: ingressLifecycle.guardAsync(runDream),
    syncSharedReviewFilterUi: ingressLifecycle.guard(syncSharedReviewFilterUi),
    syncMemoryViewerHeaderTitle: ingressLifecycle.guard(syncMemoryViewerHeaderTitle),
    toggleDreamHistory: ingressLifecycle.guard(toggleDreamHistory),
    openDreamModal: ingressLifecycle.guard(openDreamModal),
    switchOutboundAuditFocus: ingressLifecycle.guard(switchOutboundAuditFocus),
    switchMemoryViewerTab: ingressLifecycle.guard(switchMemoryViewerTab),
    syncMemoryViewerUi: ingressLifecycle.guard(syncMemoryViewerUi),
    dispose,
    getRuntimeSnapshot,
  };
}
