import {
  buildContinuationAction,
  decodeContinuationAction,
  encodeContinuationAction,
  formatContinuationTargetLabel,
} from "./continuation-targets.js";
import { createPanelTaskScope } from "./panel-task-scope.js";

function formatDigestStatus(status, t) {
  switch (status) {
    case "ready":
      return t("panel.sessionDigestStatusReady", {}, "ready");
    case "updated":
      return t("panel.sessionDigestStatusUpdated", {}, "updated");
    default:
      return t("panel.sessionDigestStatusIdle", {}, "idle");
  }
}

function buildDigestBadgeItems(digest, state, t) {
  const items = [
    {
      label: formatDigestStatus(digest?.status, t),
      title: formatDigestStatus(digest?.status, t),
      className: "",
    },
    {
      label: t("panel.sessionDigestMessagesCompact", { count: String(digest?.messageCount || 0) }, `msg ${digest?.messageCount || 0}`),
      title: t("panel.sessionDigestMessages", { count: String(digest?.messageCount || 0) }, `messages ${digest?.messageCount || 0}`),
      className: "",
    },
    {
      label: t(
        "panel.sessionDigestPendingCompact",
        {
          count: String(digest?.pendingMessageCount || 0),
          threshold: String(digest?.threshold || 0),
        },
        `pend ${digest?.pendingMessageCount || 0}/${digest?.threshold || 0}`,
      ),
      title: t(
        "panel.sessionDigestPending",
        {
          count: String(digest?.pendingMessageCount || 0),
          threshold: String(digest?.threshold || 0),
        },
        `pending ${digest?.pendingMessageCount || 0}/${digest?.threshold || 0}`,
      ),
      className: "",
    },
    {
      label: t("panel.sessionDigestDigestedCompact", { count: String(digest?.digestedMessageCount || 0) }, `dig ${digest?.digestedMessageCount || 0}`),
      title: t("panel.sessionDigestDigested", { count: String(digest?.digestedMessageCount || 0) }, `digested ${digest?.digestedMessageCount || 0}`),
      className: "",
    },
  ];

  if (state.lastCompacted) {
    items.push({
      label: t("panel.sessionDigestCompactedCompact", {}, "cmp"),
      title: t("panel.sessionDigestCompacted", {}, "compacted"),
      className: "memory-badge-shared",
    });
  }

  if (state.lastUpdated) {
    items.push({
      label: t("panel.sessionDigestRefreshedCompact", {}, "ref"),
      title: t("panel.sessionDigestRefreshed", {}, "refreshed"),
      className: "memory-badge-private",
    });
  }

  return items;
}

function buildDigestSummaryText(digest, t) {
  const primary = typeof digest?.rollingSummary === "string" && digest.rollingSummary.trim()
    ? digest.rollingSummary.trim()
    : typeof digest?.archivalSummary === "string" && digest.archivalSummary.trim()
      ? digest.archivalSummary.trim()
      : "";
  if (primary) {
    return primary;
  }
  if (digest?.status === "updated") {
    return t("panel.sessionDigestUpdatedHint", {}, "Pending messages have crossed the refresh threshold. Refresh is recommended.");
  }
  return t("panel.sessionDigestNoSummary", {}, "No digest summary yet.");
}

function formatDigestTimestamp(value, formatDateTime, t) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return t("panel.sessionDigestNever", {}, "Never");
  }
  return formatDateTime(value);
}

export function createSessionDigestFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getActiveConversationId,
  onSendHistoryAction,
  onOpenContinuationAction,
  escapeHtml,
  formatDateTime,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    sessionDigestSummaryEl,
    sessionContinuationSummaryEl,
    sessionDigestRefreshBtn,
    sessionDigestModalEl,
    sessionDigestModalTitleEl,
    sessionDigestModalMetaEl,
    sessionDigestModalActionsEl,
    sessionDigestModalContentEl,
    sessionDigestModalCloseBtn,
  } = refs;

  const state = {
    conversationId: null,
    digest: null,
    continuationState: null,
    loading: false,
    refreshing: false,
    loadSeq: 0,
    lastSource: "",
    lastUpdated: false,
    lastCompacted: false,
    modalOpen: false,
  };
  const taskScope = createPanelTaskScope();

  function addOwnedListener(target, type, handler) {
    taskScope.addEventListener(target, type, handler);
  }

  function setRefreshButtonState() {
    if (!taskScope.isActive() || !sessionDigestRefreshBtn) return;
    const conversationId = getActiveConversationId();
    sessionDigestRefreshBtn.disabled = !isConnected() || !conversationId || state.loading || state.refreshing;
    sessionDigestRefreshBtn.textContent = state.refreshing
      ? t("panel.sessionDigestRefreshing", {}, "Refreshing...")
      : t("panel.sessionDigestRefresh", {}, "Refresh Digest");
  }

  function canOpenModal() {
    return Boolean(state.digest && getActiveConversationId() && isConnected());
  }

  function buildContinuationModalMarkup() {
    const continuation = state.continuationState;
    if (!continuation || typeof continuation !== "object") {
      return "";
    }

    const checkpoints = continuation.checkpoints && typeof continuation.checkpoints === "object"
      ? continuation.checkpoints
      : {};
    const progress = continuation.progress && typeof continuation.progress === "object"
      ? continuation.progress
      : {};
    const recent = Array.isArray(progress.recent)
      ? progress.recent.filter((item) => typeof item === "string" && item.trim()).slice(0, 3)
      : [];
    const labels = Array.isArray(checkpoints.labels)
      ? checkpoints.labels.filter((item) => typeof item === "string" && item.trim()).slice(0, 4)
      : [];
    const targetText = formatContinuationTargetLabel(continuation);
    const targetAction = buildContinuationAction(continuation);
    const encodedTargetAction = encodeContinuationAction(targetAction);
    const targetMarkup = continuation.recommendedTargetId && encodedTargetAction
      ? `
        <button
          type="button"
          class="button button-muted session-digest-inline-action"
          data-continuation-action="${escapeHtml(encodedTargetAction)}"
        >${escapeHtml(targetText)}</button>
      `
      : escapeHtml(targetText);

    return `
      <section class="session-digest-modal-section">
        <div class="session-digest-modal-section-head">
          <div class="session-digest-modal-section-title">${escapeHtml(t("panel.sessionContinuationLabel", {}, "Continuation"))}</div>
          <div class="session-digest-modal-chip-row">
            <span class="memory-badge">${escapeHtml(continuation.resumeMode || "-")}</span>
            <span class="memory-badge">${escapeHtml(t("panel.sessionContinuationMessages", { count: String(progress.current || "-") }, String(progress.current || "-")))}</span>
            <span class="memory-badge">${escapeHtml(t("panel.sessionContinuationBoundaries", { count: String(Number(checkpoints.openCount || 0)) }, `Boundaries ${Number(checkpoints.openCount || 0)}`))}</span>
            <span class="memory-badge">${escapeHtml(t("panel.sessionContinuationBlockers", { count: String(Number(checkpoints.blockerCount || 0)) }, `Blockers ${Number(checkpoints.blockerCount || 0)}`))}</span>
          </div>
        </div>
        <div class="session-digest-modal-grid">
          <div class="session-digest-modal-card">
            <span class="session-digest-modal-card-label">${escapeHtml(t("panel.sessionContinuationTargetLabel", {}, "Target"))}</span>
            <div class="session-digest-modal-card-value">${targetMarkup}</div>
          </div>
          <div class="session-digest-modal-card">
            <span class="session-digest-modal-card-label">${escapeHtml(t("panel.sessionContinuationNextAction", {}, "Next Action"))}</span>
            <div class="session-digest-modal-card-value">${escapeHtml(continuation.nextAction || "-")}</div>
          </div>
        </div>
        <div class="session-digest-modal-card">
          <span class="session-digest-modal-card-label">${escapeHtml(t("panel.sessionContinuationSummaryLabel", {}, "Continuation Summary"))}</span>
          <div class="session-digest-modal-card-value">${escapeHtml(continuation.summary || t("panel.sessionContinuationEmpty", {}, "No continuation summary yet."))}</div>
        </div>
        ${labels.length ? `
          <div class="session-digest-modal-chip-row">
            ${labels.map((item) => `<span class="memory-badge">${escapeHtml(item)}</span>`).join("")}
          </div>
        ` : ""}
        ${recent.length ? `
          <div class="session-digest-modal-note-list">
            ${recent.map((item) => `<div class="session-digest-modal-note">${escapeHtml(item)}</div>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderModal() {
    if (!taskScope.isActive() || !sessionDigestModalEl) return;

    const shouldOpen = state.modalOpen && canOpenModal();
    sessionDigestModalEl.classList.toggle("hidden", !shouldOpen);
    if (!shouldOpen) return;

    const digest = state.digest;
    const summaryText = buildDigestSummaryText(digest, t);
    const lastDigestAt = formatDigestTimestamp(digest?.lastDigestAt, formatDateTime, t);
    const lastEventText = state.lastSource
      ? t("panel.sessionDigestLastSource", { source: state.lastSource }, `Updated via ${state.lastSource}`)
      : t("panel.sessionDigestLastSourceUnknown", {}, "Waiting for runtime updates");
    const metaParts = [
      formatDigestStatus(digest?.status, t),
      t("panel.sessionDigestMessages", { count: String(digest?.messageCount || 0) }, `messages ${digest?.messageCount || 0}`),
      t(
        "panel.sessionDigestPending",
        {
          count: String(digest?.pendingMessageCount || 0),
          threshold: String(digest?.threshold || 0),
        },
        `pending ${digest?.pendingMessageCount || 0}/${digest?.threshold || 0}`,
      ),
      t("panel.sessionDigestDigested", { count: String(digest?.digestedMessageCount || 0) }, `digested ${digest?.digestedMessageCount || 0}`),
      t("panel.sessionDigestLastDigest", { time: lastDigestAt }, `Last digest ${lastDigestAt}`),
      lastEventText,
    ];

    if (state.lastCompacted) {
      metaParts.push(t("panel.sessionDigestCompacted", {}, "compacted"));
    }
    if (state.lastUpdated) {
      metaParts.push(t("panel.sessionDigestRefreshed", {}, "refreshed"));
    }

    if (sessionDigestModalTitleEl) {
      sessionDigestModalTitleEl.textContent = t("panel.sessionDigestFullTitle", {}, "Session Digest Full Text");
    }
    if (sessionDigestModalCloseBtn) {
      const closeText = t("panel.sessionDigestClose", {}, "Close");
      sessionDigestModalCloseBtn.title = closeText;
      sessionDigestModalCloseBtn.setAttribute("aria-label", closeText);
    }
    if (sessionDigestModalMetaEl) {
      sessionDigestModalMetaEl.textContent = metaParts.join(" · ");
    }
    if (sessionDigestModalActionsEl) {
      const actions = typeof onSendHistoryAction === "function"
        ? [
          {
            id: "list_main",
            label: t("panel.sessionHistoryListMain", {}, "列出主会话"),
          },
          {
            id: "list_all_allowed",
            label: t("panel.sessionHistoryListAllAllowed", {}, "列出全部允许会话"),
          },
          {
            id: "read_timeline",
            label: t("panel.sessionHistoryReadTimeline", {}, "读取当前时间线"),
          },
          {
            id: "read_restore",
            label: t("panel.sessionHistoryReadRestore", {}, "读取当前 restore"),
          },
        ]
        : [];
      sessionDigestModalActionsEl.innerHTML = actions.map((action) => `
        <button
          type="button"
          class="button button-muted session-digest-action-btn"
          data-history-action="${escapeHtml(action.id)}"
        >${escapeHtml(action.label)}</button>
      `).join("");
      sessionDigestModalActionsEl.classList.toggle("hidden", actions.length === 0);
    }
    if (sessionDigestModalContentEl) {
      sessionDigestModalContentEl.innerHTML = `
        <div class="session-digest-modal-copy">${escapeHtml(summaryText)}</div>
        ${buildContinuationModalMarkup()}
      `;
    }
  }

  function closeModal() {
    if (!taskScope.isActive()) return;
    state.modalOpen = false;
    renderModal();
  }

  function openModal() {
    if (!taskScope.isActive()) return;
    if (!canOpenModal()) return;
    state.modalOpen = true;
    renderModal();
  }

  function renderEmpty(message) {
    if (!taskScope.isActive() || !sessionDigestSummaryEl) return;
    closeModal();
    const empty = document.createElement("div");
    empty.className = "task-token-history-empty";
    empty.textContent = message;
    sessionDigestSummaryEl.replaceChildren(empty);
    if (sessionContinuationSummaryEl) {
      sessionContinuationSummaryEl.replaceChildren();
    }
    setRefreshButtonState();
  }

  function renderContinuationSummary() {
    if (!taskScope.isActive() || !sessionContinuationSummaryEl) return;
    sessionContinuationSummaryEl.replaceChildren();
  }

  function renderDigest() {
    if (!taskScope.isActive() || !sessionDigestSummaryEl) return;

    if (!isConnected()) {
      renderEmpty(t("panel.sessionDigestDisconnected", {}, "Disconnected"));
      return;
    }

    const conversationId = getActiveConversationId();
    if (!conversationId) {
      renderEmpty(t("panel.sessionDigestNoConversation", {}, "No active conversation yet."));
      return;
    }

    if (state.loading && !state.digest) {
      renderEmpty(t("panel.sessionDigestLoading", {}, "Loading session digest..."));
      return;
    }

    if (!state.digest) {
      renderEmpty(t("panel.sessionDigestEmpty", {}, "No session digest available yet."));
      return;
    }

    const digest = state.digest;
    const summaryText = buildDigestSummaryText(digest, t);
    const lastDigestAt = formatDigestTimestamp(digest.lastDigestAt, formatDateTime, t);
    const lastEventText = state.lastSource
      ? t("panel.sessionDigestLastSource", { source: state.lastSource }, `Updated via ${state.lastSource}`)
      : t("panel.sessionDigestLastSourceUnknown", {}, "Waiting for runtime updates");
    const openFullTextTitle = t("panel.sessionDigestOpenFull", {}, "Click to view the full digest");
    const badgeItems = buildDigestBadgeItems(digest, state, t);

    sessionDigestSummaryEl.innerHTML = `
      <div class="session-digest-card is-interactive" role="button" tabindex="0" title="${escapeHtml(openFullTextTitle)}" aria-label="${escapeHtml(openFullTextTitle)}">
        <div class="session-digest-head">
          <div class="session-digest-badges">
            ${badgeItems.map((item) => `
              <span class="memory-badge ${item.className}" title="${escapeHtml(item.title)}">${escapeHtml(item.label)}</span>
            `).join("")}
          </div>
          <div class="session-digest-meta">
            <span>${escapeHtml(t("panel.sessionDigestLastDigest", { time: lastDigestAt }, `Last digest ${lastDigestAt}`))}</span>
            <span>${escapeHtml(lastEventText)}</span>
          </div>
        </div>
        <div class="session-digest-summary-text">${escapeHtml(summaryText)}</div>
      </div>
    `;
    setRefreshButtonState();
    renderContinuationSummary();
    renderModal();
  }

  async function loadSessionDigest(conversationId = getActiveConversationId(), options = {}) {
    if (!taskScope.isActive()) return null;
    const force = options.force === true;
    const notify = options.notify === true;

    state.conversationId = conversationId || null;
    if (!isConnected()) {
      state.loading = false;
      state.refreshing = false;
      state.digest = null;
      renderDigest();
      return null;
    }

    if (!conversationId) {
      state.loading = false;
      state.refreshing = false;
      state.digest = null;
      renderDigest();
      return null;
    }

    state.loadSeq += 1;
    state.loading = !force;
    state.refreshing = force;
    renderDigest();

    const requestTask = taskScope.beginTask();
    if (!requestTask) return null;
    try {
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: force ? "conversation.digest.refresh" : "conversation.digest.get",
      params: force ? { conversationId, force: true } : { conversationId },
    });

    if (!requestTask.isCurrent()) return null;

    state.loading = false;
    state.refreshing = false;

    if (!res || !res.ok) {
      state.digest = null;
      renderEmpty(res?.error?.message || t("panel.sessionDigestLoadFailed", {}, "Failed to load session digest."));
      if (notify) {
        showNotice?.(
          t("panel.sessionDigestRefreshFailedTitle", {}, "Digest refresh failed"),
          res?.error?.message || t("panel.sessionDigestRefreshFailed", {}, "Failed to refresh session digest."),
          "error",
        );
      }
      return null;
    }

    state.digest = force ? res.payload?.digest || null : res.payload?.digest || null;
    state.lastSource = force ? "manual" : "load";
    state.lastUpdated = force ? res.payload?.updated === true : false;
    state.lastCompacted = force ? res.payload?.compacted === true : false;
    renderDigest();

    if (notify) {
      showNotice?.(
        t("panel.sessionDigestRefreshSuccessTitle", {}, "Digest refreshed"),
        state.lastUpdated
          ? t("panel.sessionDigestRefreshSuccess", {}, "Session digest has been refreshed.")
          : t("panel.sessionDigestRefreshSkipped", {}, "Session digest is already up to date."),
        "info",
      );
    }

    return state.digest;
    } finally {
      requestTask.settle();
    }
  }

  function handleDigestUpdated(payload) {
    if (!taskScope.isActive()) return;
    const conversationId = typeof payload?.conversationId === "string" ? payload.conversationId : "";
    if (!conversationId || conversationId !== getActiveConversationId()) return;
    state.conversationId = conversationId;
    state.loading = false;
    state.refreshing = false;
    state.digest = payload?.digest && typeof payload.digest === "object" ? payload.digest : state.digest;
    state.lastSource = typeof payload?.source === "string" ? payload.source : "";
    state.lastUpdated = payload?.updated === true;
    state.lastCompacted = payload?.compacted === true;
    renderDigest();
  }

  function clear() {
    if (!taskScope.isActive()) return;
    state.conversationId = null;
    state.digest = null;
    state.continuationState = null;
    state.loading = false;
    state.refreshing = false;
    state.lastSource = "";
    state.lastUpdated = false;
    state.lastCompacted = false;
    state.modalOpen = false;
    renderDigest();
  }

  function setContinuationState(payload, options = {}) {
    if (!taskScope.isActive()) return;
    const conversationId = options.conversationId || getActiveConversationId();
    if (conversationId && conversationId !== getActiveConversationId()) return;
    state.continuationState = payload && typeof payload === "object" ? payload : null;
    renderContinuationSummary();
    renderModal();
  }

  function handleContinuationActionEvent(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest("[data-continuation-action]") : null;
    if (!trigger || typeof onOpenContinuationAction !== "function") return;
    const action = decodeContinuationAction(trigger.getAttribute("data-continuation-action") || "");
    if (!action) return;
    void onOpenContinuationAction(action);
  }

  function handleRefreshClick() {
    if (!taskScope.isActive()) return;
    const conversationId = getActiveConversationId();
    if (!conversationId) return;
    void loadSessionDigest(conversationId, { force: true, notify: true });
  }

  function handleSummaryClick(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest(".session-digest-card.is-interactive") : null;
    if (!trigger) return;
    openModal();
  }

  function handleSummaryKeydown(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest(".session-digest-card.is-interactive") : null;
    if (!trigger || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openModal();
  }

  function handleModalCloseClick() {
    closeModal();
  }

  function handleModalBackdropClick(event) {
    if (!taskScope.isActive() || event.target !== sessionDigestModalEl) return;
    closeModal();
  }

  function handleModalActionsClick(event) {
    if (!taskScope.isActive()) return;
    const trigger = event.target instanceof Element ? event.target.closest("[data-history-action]") : null;
    if (!trigger || typeof onSendHistoryAction !== "function") return;
    const actionId = trigger.getAttribute("data-history-action") || "";
    if (!actionId) return;
    closeModal();
    onSendHistoryAction({
      actionId,
      conversationId: getActiveConversationId?.() || "",
    });
  }

  function handleDocumentKeydown(event) {
    if (!taskScope.isActive() || event.key !== "Escape" || !state.modalOpen) return;
    closeModal();
  }

  function activate() {
    if (!taskScope.activate()) return false;
    addOwnedListener(sessionDigestRefreshBtn, "click", handleRefreshClick);
    addOwnedListener(sessionDigestSummaryEl, "click", handleSummaryClick);
    addOwnedListener(sessionDigestSummaryEl, "keydown", handleSummaryKeydown);
    addOwnedListener(sessionContinuationSummaryEl, "click", handleContinuationActionEvent);
    addOwnedListener(sessionDigestModalContentEl, "click", handleContinuationActionEvent);
    addOwnedListener(sessionDigestModalCloseBtn, "click", handleModalCloseClick);
    addOwnedListener(sessionDigestModalEl, "click", handleModalBackdropClick);
    addOwnedListener(sessionDigestModalActionsEl, "click", handleModalActionsClick);
    addOwnedListener(document, "keydown", handleDocumentKeydown);
    renderDigest();
    return true;
  }

  function deactivate() {
    if (!taskScope.deactivate()) return false;
    state.loadSeq += 1;
    state.conversationId = null;
    state.digest = null;
    state.continuationState = null;
    state.loading = false;
    state.refreshing = false;
    state.lastSource = "";
    state.lastUpdated = false;
    state.lastCompacted = false;
    state.modalOpen = false;
    sessionDigestSummaryEl?.replaceChildren();
    sessionContinuationSummaryEl?.replaceChildren();
    sessionDigestModalTitleEl?.replaceChildren();
    sessionDigestModalMetaEl?.replaceChildren();
    sessionDigestModalActionsEl?.replaceChildren();
    sessionDigestModalContentEl?.replaceChildren();
    sessionDigestModalEl?.classList.add("hidden");
    return true;
  }

  function dispose() {
    if (taskScope.getRuntimeSnapshot().disposed) return false;
    deactivate();
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      pendingRequestCount: snapshot.pendingTaskCount,
      loadSeq: state.loadSeq,
      modalOpen: state.modalOpen,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
    loadSessionDigest,
    handleDigestUpdated,
    setContinuationState,
    clear,
    refreshLocale() {
      if (!taskScope.isActive()) return;
      renderDigest();
      renderContinuationSummary();
      renderModal();
    },
  };
}
