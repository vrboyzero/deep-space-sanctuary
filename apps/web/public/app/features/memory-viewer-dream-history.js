function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDreamStatusLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "queued") return t("memory.dreamStatusQueued", {}, "排队中");
  if (normalized === "running") return t("memory.dreamStatusRunning", {}, "运行中");
  if (normalized === "completed") return t("memory.dreamStatusCompleted", {}, "最近成功");
  if (normalized === "failed") return t("memory.dreamStatusFailed", {}, "最近失败");
  return t("memory.dreamStatusIdle", {}, "空闲");
}

function formatDreamGenerationModeLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  if (value === "fallback") return t("memory.dreamGenerationFallback", {}, "Fallback");
  if (value === "llm") return t("memory.dreamGenerationLlm", {}, "LLM");
  return t("memory.dreamGenerationUnknown", {}, "未知");
}

function formatDreamFallbackReasonLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  if (value === "missing_model_config") {
    return t("memory.dreamFallbackReasonMissingModelConfig", {}, "缺少模型配置");
  }
  if (value === "llm_call_failed") {
    return t("memory.dreamFallbackReasonLlmCallFailed", {}, "LLM 调用失败");
  }
  return t("memory.dreamFallbackReasonUnknown", {}, "未知原因");
}

function formatDreamTriggerModeLabel(value, t = (_key, _params, fallback) => fallback ?? "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "manual") return t("memory.dreamTriggerManual", {}, "手动");
  if (normalized === "heartbeat") return t("memory.dreamTriggerHeartbeat", {}, "heartbeat");
  if (normalized === "cron") return t("memory.dreamTriggerCron", {}, "cron");
  return normalizeText(value) || t("memory.dreamTriggerUnknown", {}, "未知");
}

function buildDreamHistorySnippet(item, t) {
  const consolidation = item?.consolidation;
  const profilePatchCount = Array.isArray(consolidation?.profilePatchCandidates) ? consolidation.profilePatchCandidates.length : 0;
  const staleCount = Array.isArray(consolidation?.staleCandidates) ? consolidation.staleCandidates.length : 0;
  const contradictionCount = Array.isArray(consolidation?.contradictionCandidates) ? consolidation.contradictionCandidates.length : 0;
  if (profilePatchCount + staleCount + contradictionCount > 0) {
    return `整理建议 profile_patch=${profilePatchCount} / stale=${staleCount} / contradiction=${contradictionCount}`;
  }
  const error = normalizeText(item?.error);
  if (error) return error;

  const reason = normalizeText(item?.reason);
  const generationMode = normalizeText(item?.generationMode);
  const fallbackReason = normalizeText(item?.fallbackReason);
  if (generationMode) {
    const generationText = fallbackReason
      ? `${formatDreamGenerationModeLabel(generationMode, t)} (${formatDreamFallbackReasonLabel(fallbackReason, t)})`
      : formatDreamGenerationModeLabel(generationMode, t);
    return reason ? `生成 ${generationText} · ${reason}` : `生成 ${generationText}`;
  }

  if (reason) return reason;
  return normalizeText(item?.id) || t("memory.dreamHistoryItemUntitled", {}, "未命名 Dream");
}

function buildDreamConsolidationGovernanceSummary(item, t) {
  const review = item?.consolidation?.review;
  const apply = item?.consolidation?.apply;
  const reviewStatus = normalizeText(review?.status) || "pending";
  const applyStatus = normalizeText(apply?.status) || "not_applied";
  const approvedCount = Array.isArray(review?.approvedCandidatePaths) ? review.approvedCandidatePaths.length : 0;
  const appliedCount = Number(apply?.appliedPatchCount) || 0;
  return t(
    "memory.dreamHistoryConsolidationGovernance",
    {
      reviewStatus,
      applyStatus,
      approvedCount: String(approvedCount),
      appliedCount: String(appliedCount),
    },
    `review=${reviewStatus} / approved_patch=${approvedCount} / apply=${applyStatus} / applied_patch=${appliedCount}`,
  );
}

export function buildDreamHistoryPanelView(input, options = {}) {
  const connected = input?.connected !== false;
  const open = input?.open === true;
  const loading = input?.loading === true;
  const error = normalizeText(input?.error);
  const items = Array.isArray(input?.items) ? input.items.filter((item) => item && typeof item === "object") : [];
  const selectedId = normalizeText(input?.selectedId);
  const selectedItem = input?.selectedItem && typeof input.selectedItem === "object"
    ? input.selectedItem
    : items.find((item) => normalizeText(item?.id) === selectedId) || null;
  const detailLoading = input?.detailLoading === true;
  const detailError = normalizeText(input?.detailError);
  const selectedContent = typeof input?.selectedContent === "string" ? input.selectedContent : "";
  const t = typeof options.t === "function" ? options.t : (_key, _params, fallback) => fallback ?? "";
  const formatDateTime = typeof options.formatDateTime === "function" ? options.formatDateTime : (value) => normalizeText(value) || "-";

  const historyStatusLine = !connected
    ? t("memory.dreamHistoryDisconnected", {}, "Dream 历史：未连接")
    : loading
      ? t("memory.dreamHistoryLoading", {}, "Dream 历史：加载中…")
      : error
        ? t("memory.dreamHistoryLoadFailed", { error }, `Dream 历史：${error}`)
        : t("memory.dreamHistoryReady", { count: String(items.length) }, `Dream 历史：${items.length} 条`);

  const entries = items.map((item) => {
    const itemId = normalizeText(item?.id);
    const summary = normalizeText(item?.summary);
    const title = summary || itemId || t("memory.dreamHistoryItemUntitled", {}, "未命名 Dream");
    const generationMode = normalizeText(item?.generationMode);
    const fallbackReason = normalizeText(item?.fallbackReason);
    const generationText = generationMode
      ? (fallbackReason
        ? `${formatDreamGenerationModeLabel(generationMode, t)} (${formatDreamFallbackReasonLabel(fallbackReason, t)})`
        : formatDreamGenerationModeLabel(generationMode, t))
      : t("memory.dreamGenerationSummaryEmpty", {}, "生成：暂无");
    return {
      id: itemId,
      isActive: itemId === selectedId,
      title,
      meta: [
        formatDreamStatusLabel(item?.status, t),
        formatDreamTriggerModeLabel(item?.triggerMode, t),
        generationText,
        formatDateTime(item?.finishedAt || item?.requestedAt),
      ].filter(Boolean),
      snippet: buildDreamHistorySnippet(item, t),
    };
  });

  const detailCards = selectedItem ? [
    {
      label: t("memory.detailStatus", {}, "状态"),
      value: formatDreamStatusLabel(selectedItem.status, t),
    },
    {
      label: t("memory.detailTriggerMode", {}, "触发方式"),
      value: formatDreamTriggerModeLabel(selectedItem.triggerMode, t),
    },
    {
      label: t("memory.dreamGenerationSummaryLabel", {}, "生成"),
      value: selectedItem.generationMode
        ? `${formatDreamGenerationModeLabel(selectedItem.generationMode, t)}${selectedItem.fallbackReason ? ` (${formatDreamFallbackReasonLabel(selectedItem.fallbackReason, t)})` : ""}`
        : "-",
    },
    {
      label: t("memory.detailFinishedAt", {}, "完成时间"),
      value: formatDateTime(selectedItem.finishedAt || selectedItem.requestedAt),
    },
    {
      label: t("memory.detailConversationId", {}, "会话"),
      value: normalizeText(selectedItem.conversationId) || "-",
    },
    {
      label: t("memory.detailSourcePath", {}, "Dream 文件"),
      value: normalizeText(selectedItem.dreamPath) || "-",
    },
    {
      label: t("memory.dreamHistoryObsidianSync", {}, "Obsidian"),
      value: selectedItem?.obsidianSync?.stage
        ? `${normalizeText(selectedItem.obsidianSync.stage)}${normalizeText(selectedItem.obsidianSync.targetPath) ? ` · ${normalizeText(selectedItem.obsidianSync.targetPath)}` : ""}`
        : "-",
    },
    {
      label: t("memory.dreamHistoryConsolidation", {}, "整理建议"),
      value: buildDreamHistorySnippet(selectedItem, t),
    },
    {
      label: t("memory.dreamHistoryConsolidationGovernanceLabel", {}, "整理治理"),
      value: buildDreamConsolidationGovernanceSummary(selectedItem, t),
    },
  ] : [];

  const canReviewApprove = Array.isArray(selectedItem?.consolidation?.profilePatchCandidates)
    && selectedItem.consolidation.profilePatchCandidates.some((candidate) => normalizeText(candidate?.profilePath));
  const reviewStatus = normalizeText(selectedItem?.consolidation?.review?.status) || "pending";
  const applyStatus = normalizeText(selectedItem?.consolidation?.apply?.status) || "not_applied";

  return {
    open,
    toggleLabel: open
      ? t("memory.dreamHistoryHide", {}, "收起 Dream 历史")
      : t("memory.dreamHistoryShow", {}, "Dream 历史"),
    toggleTitle: open
      ? t("memory.dreamHistoryHideTitle", {}, "收起最近的 Dream 历史")
      : t("memory.dreamHistoryShowTitle", {}, "查看最近的 Dream 历史"),
    historyStatusLine,
    refreshDisabled: !connected || loading || detailLoading,
    entries,
    listEmptyText: !connected
      ? t("memory.dreamHistoryDisconnectedList", {}, "连接建立后可查看 Dream 历史。")
      : loading
        ? t("memory.dreamHistoryLoadingList", {}, "正在加载 Dream 历史…")
        : error || t("memory.dreamHistoryEmpty", {}, "当前还没有 Dream 历史记录。"),
    detail: {
      loading: detailLoading,
      error: detailError,
      title: normalizeText(selectedItem?.summary) || normalizeText(selectedItem?.id) || t("memory.dreamHistoryDetailEmptyTitle", {}, "Dream 详情"),
      cards: detailCards,
      actions: selectedItem ? {
        canApprove: canReviewApprove && reviewStatus !== "approved",
        canReject: reviewStatus !== "rejected",
        canApply: reviewStatus === "approved" && applyStatus !== "applied" && canReviewApprove,
      } : {
        canApprove: false,
        canReject: false,
        canApply: false,
      },
      summary: normalizeText(selectedItem?.summary) || "",
      reason: normalizeText(selectedItem?.reason) || "",
      content: selectedContent,
      emptyText: !connected
        ? t("memory.dreamHistoryDisconnectedDetail", {}, "连接建立后可查看 Dream 正文。")
        : detailLoading
          ? t("memory.dreamHistoryDetailLoading", {}, "正在加载 Dream 正文…")
          : detailError
            ? detailError
            : selectedItem
              ? t("memory.dreamHistoryDetailNoContent", {}, "当前 Dream 记录没有可显示的正文。")
              : t("memory.dreamHistoryDetailEmpty", {}, "请选择一条 Dream 历史记录。"),
    },
  };
}
