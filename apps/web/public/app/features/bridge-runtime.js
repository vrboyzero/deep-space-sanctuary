const POLL_INTERVAL_MS = 1500;

function createStatCardElement(ownerDocument, label, value) {
  const card = ownerDocument.createElement("div");
  card.className = "memory-stat-card";
  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-stat-label";
  labelElement.textContent = String(label ?? "");
  const valueElement = ownerDocument.createElement("strong");
  valueElement.className = "memory-stat-value";
  valueElement.textContent = String(value ?? "");
  card.append(labelElement, valueElement);
  return card;
}

function renderStatCards(target, stats) {
  const ownerDocument = target.ownerDocument ?? document;
  target.replaceChildren(
    ...stats.map(([label, value]) => createStatCardElement(ownerDocument, label, value)),
  );
}

function formatBridgeStatus(status, t) {
  return status === "active"
    ? t("bridge.statusActive", {}, "运行中")
    : t("bridge.statusClosed", {}, "已关闭");
}

function formatCloseReason(reason, t) {
  switch (reason) {
    case "manual":
      return t("bridge.closeReasonManual", {}, "manual");
    case "idle-timeout":
      return t("bridge.closeReasonIdleTimeout", {}, "idle-timeout");
    case "runtime-lost":
      return t("bridge.closeReasonRuntimeLost", {}, "runtime-lost");
    case "orphan":
      return t("bridge.closeReasonOrphan", {}, "orphan");
    default:
      return reason || "-";
  }
}

function createBridgeDetailCardElement(ownerDocument, label, value) {
  const card = ownerDocument.createElement("div");
  card.className = "memory-detail-card";
  const labelElement = ownerDocument.createElement("span");
  labelElement.className = "memory-detail-label";
  labelElement.textContent = String(label ?? "");
  const valueElement = ownerDocument.createElement("div");
  valueElement.className = "memory-detail-text";
  valueElement.textContent = String(value || "-");
  card.append(labelElement, valueElement);
  return card;
}

function createBridgeActionButtonElement(
  ownerDocument,
  { className, label, attribute, value },
) {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = String(label ?? "");
  button.setAttribute(attribute, String(value ?? ""));
  return button;
}

function renderBridgeEmptyState(target, message) {
  if (!target) return;
  const ownerDocument = target.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = message;
  target.replaceChildren(empty);
}

function createBridgeListItemElement(ownerDocument, item, state, t) {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = "memory-list-item";
  button.classList.toggle("active", item?.sessionId === state.selectedSessionId);
  button.setAttribute("data-bridge-session-id", String(item?.sessionId ?? ""));

  const head = ownerDocument.createElement("div");
  head.className = "memory-list-item-head";
  const title = ownerDocument.createElement("span");
  title.className = "memory-list-item-title";
  title.textContent = `${item.targetId}.${item.action}`;
  const statusBadge = ownerDocument.createElement("span");
  statusBadge.className = "memory-badge";
  statusBadge.textContent = formatBridgeStatus(item?.status, t);
  head.append(title, statusBadge);

  const meta = ownerDocument.createElement("div");
  meta.className = "memory-list-item-meta";
  const cwd = ownerDocument.createElement("span");
  cwd.textContent = String(item.cwd || "-");
  meta.append(cwd);
  if (item?.taskId) {
    const taskBadge = ownerDocument.createElement("span");
    taskBadge.className = "memory-badge";
    taskBadge.textContent = `task:${item.taskId}`;
    meta.append(taskBadge);
  }
  if (item?.hasBufferedOutput) {
    const bufferedBadge = ownerDocument.createElement("span");
    bufferedBadge.className = "memory-badge";
    bufferedBadge.textContent = t("bridge.bufferedBadge", {}, "有新输出");
    meta.append(bufferedBadge);
  }

  const snippet = ownerDocument.createElement("div");
  snippet.className = "memory-list-item-snippet";
  snippet.textContent = String(item.latestOutputPreview || item.commandPreview || "-");
  button.append(head, meta, snippet);
  return button;
}

function formatTranscriptTail(transcriptTail, liveOutput, formatDateTime, t) {
  const lines = Array.isArray(transcriptTail)
    ? transcriptTail.map((event) => {
        const direction = event?.direction === "input"
          ? t("bridge.directionInput", {}, "INPUT")
          : event?.direction === "system"
            ? t("bridge.directionSystem", {}, "SYSTEM")
            : t("bridge.directionOutput", {}, "OUTPUT");
        const timestamp = typeof event?.timestamp === "number"
          ? formatDateTime(event.timestamp)
          : "-";
        return `[${timestamp}] ${direction}\n${String(event?.content || "").trimEnd()}`;
      })
    : [];
  const normalizedLiveOutput = typeof liveOutput === "string" ? liveOutput.trimEnd() : "";
  if (normalizedLiveOutput) {
    lines.push(`[${t("bridge.liveBufferLabel", {}, "LIVE BUFFER")}]\n${normalizedLiveOutput}`);
  }
  return lines.join("\n\n");
}

export function createBridgeRuntimeFeature({
  refs,
  isConnected,
  sendReq,
  makeId,
  getBridgeRuntimeState,
  escapeHtml,
  formatDateTime,
  onOpenSourcePath,
  onOpenTask,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
} = {}) {
  const {
    bridgeSection,
    bridgeSummaryEl,
    bridgeListEl,
    bridgeDetailEl,
    bridgeRefreshBtn,
  } = refs ?? {};

  let pollTimer = null;
  let pollStartCount = 0;
  let pollTickCount = 0;
  let disposed = false;

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    if (disposed) return;
    stopPolling();
    pollStartCount += 1;
    pollTimer = setInterval(() => {
      if (disposed) return;
      pollTickCount += 1;
      const state = getBridgeRuntimeState();
      if (!state?.viewActive || !isConnected?.()) {
        return;
      }
      void loadBridgeSessions(false);
    }, POLL_INTERVAL_MS);
  }

  function renderBridgeLoading(message) {
    if (bridgeSummaryEl) {
      renderStatCards(
        bridgeSummaryEl,
        [[t("bridge.statSessions", {}, "桥接会话"), "--"]],
      );
    }
    if (bridgeListEl) {
      renderBridgeEmptyState(bridgeListEl, message);
    }
    if (bridgeDetailEl) {
      renderBridgeEmptyState(bridgeDetailEl, message);
    }
  }

  function renderBridgeDetailEmpty(message) {
    renderBridgeEmptyState(bridgeDetailEl, message);
  }

  function renderBridgeSummary(state) {
    if (!bridgeSummaryEl) return;
    renderStatCards(bridgeSummaryEl, [
      [t("bridge.statSessions", {}, "桥接会话"), String(state.totalCount || 0)],
      [t("bridge.statActive", {}, "运行中"), String(state.activeCount || 0)],
      [t("bridge.statClosed", {}, "已关闭"), String(state.closedCount || 0)],
    ]);
  }

  function renderBridgeList(state) {
    if (!bridgeListEl) return;
    if (!Array.isArray(state.items) || state.items.length === 0) {
      renderBridgeEmptyState(bridgeListEl, t("bridge.empty", {}, "当前没有 bridge session。"));
      return;
    }

    const ownerDocument = bridgeListEl.ownerDocument ?? document;
    bridgeListEl.replaceChildren(
      ...state.items.map((item) => createBridgeListItemElement(ownerDocument, item, state, t)),
    );

    bridgeListEl.querySelectorAll("[data-bridge-session-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const sessionId = button.getAttribute("data-bridge-session-id") || "";
        if (!sessionId) return;
        void openBridgeSession(sessionId);
      });
    });
  }

  function renderBridgeDetail(state) {
    if (!bridgeDetailEl) return;
    const peek = state.selectedPeek;
    const session = peek?.session || state.selectedSession;
    if (!session) {
      renderBridgeDetailEmpty(t("bridge.detailSelect", {}, "选择左侧桥接会话查看详情。"));
      return;
    }

    const transcriptText = formatTranscriptTail(
      peek?.transcriptTail,
      peek?.liveOutput,
      formatDateTime,
      t,
    );
    const ownerDocument = bridgeDetailEl.ownerDocument ?? document;
    const shell = ownerDocument.createElement("div");
    shell.className = "memory-detail-shell";

    const overviewCard = ownerDocument.createElement("section");
    overviewCard.className = "memory-detail-card";
    const title = ownerDocument.createElement("span");
    title.className = "memory-detail-label";
    title.textContent = t("bridge.detailTitle", {}, "Bridge Session");
    const grid = ownerDocument.createElement("div");
    grid.className = "memory-detail-grid";
    grid.append(
      createBridgeDetailCardElement(
        ownerDocument,
        t("bridge.detailTarget", {}, "Target"),
        `${session.targetId}.${session.action}`,
      ),
      createBridgeDetailCardElement(
        ownerDocument,
        t("bridge.detailStatus", {}, "Status"),
        formatBridgeStatus(session.status, t),
      ),
      createBridgeDetailCardElement(
        ownerDocument,
        t("bridge.detailCloseReason", {}, "Close Reason"),
        formatCloseReason(session.closeReason, t),
      ),
      createBridgeDetailCardElement(
        ownerDocument,
        t("bridge.detailTaskId", {}, "Task ID"),
        session.taskId || "-",
      ),
      createBridgeDetailCardElement(
        ownerDocument,
        t("bridge.detailCwd", {}, "CWD"),
        session.cwd || "-",
      ),
      createBridgeDetailCardElement(
        ownerDocument,
        t("bridge.detailBuffered", {}, "Buffered Output"),
        String(session.bufferedOutputChars || 0),
      ),
    );

    const updatedMeta = ownerDocument.createElement("div");
    updatedMeta.className = "memory-list-item-meta";
    const updatedLabel = ownerDocument.createElement("span");
    updatedLabel.textContent = t("bridge.detailUpdatedAt", {}, "Updated");
    const updatedValue = ownerDocument.createElement("span");
    updatedValue.textContent = String(formatDateTime(session.updatedAt) ?? "");
    updatedMeta.append(updatedLabel, updatedValue);

    const commandPreview = ownerDocument.createElement("div");
    commandPreview.className = "memory-detail-text bridge-command-preview";
    commandPreview.textContent = String(session.commandPreview || "-");
    overviewCard.append(title, grid, updatedMeta, commandPreview);

    if (session.firstTurnHint) {
      const hint = ownerDocument.createElement("div");
      hint.className = "tool-settings-policy-note";
      hint.textContent = String(session.firstTurnHint);
      overviewCard.append(hint);
    }

    const actionDefinitions = [
      session.taskId
        ? {
            className: "button",
            label: t("bridge.openTask", {}, "打开子任务"),
            attribute: "data-bridge-open-task",
            value: session.taskId,
          }
        : null,
      session.transcriptPath
        ? {
            className: "button goal-inline-action-secondary",
            label: t("bridge.openTranscript", {}, "打开 transcript"),
            attribute: "data-open-source",
            value: session.transcriptPath,
          }
        : null,
      session.artifactPath
        ? {
            className: "button goal-inline-action-secondary",
            label: t("bridge.openArtifact", {}, "打开 artifact"),
            attribute: "data-open-source",
            value: session.artifactPath,
          }
        : null,
      {
        className: "button goal-inline-action-secondary",
        label: t("bridge.refreshSession", {}, "刷新输出"),
        attribute: "data-bridge-refresh-session",
        value: session.sessionId,
      },
    ].filter(Boolean);
    const actions = ownerDocument.createElement("div");
    actions.className = "subtask-detail-actions";
    actions.append(
      ...actionDefinitions.map((definition) => (
        createBridgeActionButtonElement(ownerDocument, definition)
      )),
    );
    overviewCard.append(actions);

    const outputCard = ownerDocument.createElement("section");
    outputCard.className = "memory-detail-card";
    const outputLabel = ownerDocument.createElement("span");
    outputLabel.className = "memory-detail-label";
    outputLabel.textContent = t("bridge.detailOutput", {}, "Live Tail");
    const output = ownerDocument.createElement("pre");
    output.className = "bridge-live-output";
    output.textContent = String(
      transcriptText || t("bridge.noOutput", {}, "当前还没有可显示的输出。"),
    );
    outputCard.append(outputLabel, output);

    shell.append(overviewCard, outputCard);
    bridgeDetailEl.replaceChildren(shell);

    bridgeDetailEl.querySelectorAll("[data-open-source]").forEach((button) => {
      button.addEventListener("click", () => {
        const sourcePath = button.getAttribute("data-open-source") || "";
        if (!sourcePath) return;
        onOpenSourcePath?.(sourcePath);
      });
    });
    bridgeDetailEl.querySelectorAll("[data-bridge-open-task]").forEach((button) => {
      button.addEventListener("click", () => {
        const taskId = button.getAttribute("data-bridge-open-task") || "";
        if (!taskId) return;
        void onOpenTask?.(taskId);
      });
    });
    bridgeDetailEl.querySelectorAll("[data-bridge-refresh-session]").forEach((button) => {
      button.addEventListener("click", () => {
        const sessionId = button.getAttribute("data-bridge-refresh-session") || "";
        if (!sessionId) return;
        void loadBridgeSessionDetail(sessionId, { quiet: false });
      });
    });
  }

  async function loadBridgeSessionDetail(sessionId, { quiet = false } = {}) {
    if (disposed) return;
    const state = getBridgeRuntimeState();
    if (!sessionId) {
      renderBridgeDetailEmpty(t("bridge.detailSelect", {}, "选择左侧桥接会话查看详情。"));
      return;
    }
    if (!quiet) {
      state.detailLoading = true;
      renderBridgeDetailEmpty(t("bridge.detailLoading", {}, "正在读取 bridge session 输出..."));
    }
    const seq = state.detailSeq + 1;
    state.detailSeq = seq;

    const res = await sendReq?.({
      type: "req",
      id: makeId?.(),
      method: "bridge.session.peek",
      params: {
        sessionId,
        transcriptLimit: 80,
      },
    });

    if (disposed || seq !== state.detailSeq) return;
    state.detailLoading = false;

    if (!res || !res.ok || !res.payload?.session) {
      if (!quiet) {
        renderBridgeDetailEmpty(res?.error?.message || t("bridge.detailLoadFailed", {}, "读取 bridge session 失败。"));
      }
      return;
    }

    state.selectedSessionId = sessionId;
    state.selectedPeek = res.payload;
    state.selectedSession = res.payload.session;
    renderBridgeDetail(state);
  }

  async function loadBridgeSessions(forceSelectFirst = false) {
    if (disposed || !bridgeSection) return;
    const state = getBridgeRuntimeState();
    if (!isConnected?.()) {
      state.loading = false;
      state.detailLoading = false;
      renderBridgeLoading(t("bridge.loadingDisconnected", {}, "未连接"));
      return;
    }

    state.loading = true;
    const seq = state.loadSeq + 1;
    state.loadSeq = seq;
    renderBridgeLoading(t("bridge.loading", {}, "加载中..."));

    const res = await sendReq?.({
      type: "req",
      id: makeId?.(),
      method: "bridge.session.list",
      params: {},
    });

    if (disposed || seq !== state.loadSeq) return;
    state.loading = false;

    if (!res || !res.ok || !Array.isArray(res.payload?.items)) {
      state.items = [];
      state.totalCount = 0;
      state.activeCount = 0;
      state.closedCount = 0;
      state.selectedSessionId = null;
      state.selectedSession = null;
      state.selectedPeek = null;
      renderBridgeLoading(res?.error?.message || t("bridge.listLoadFailed", {}, "读取 bridge session 列表失败。"));
      return;
    }

    state.items = res.payload.items;
    state.totalCount = Number(res.payload.totalCount || 0);
    state.activeCount = Number(res.payload.activeCount || 0);
    state.closedCount = Number(res.payload.closedCount || 0);

    if (!state.items.length) {
      state.selectedSessionId = null;
      state.selectedSession = null;
      state.selectedPeek = null;
      renderBridgeSummary(state);
      renderBridgeList(state);
      renderBridgeDetailEmpty(t("bridge.empty", {}, "当前没有 bridge session。"));
      return;
    }

    const selectedExists = state.items.some((item) => item?.sessionId === state.selectedSessionId);
    if (forceSelectFirst || !selectedExists) {
      state.selectedSessionId = state.items[0].sessionId;
    }
    state.selectedSession = state.items.find((item) => item?.sessionId === state.selectedSessionId) || null;

    renderBridgeSummary(state);
    renderBridgeList(state);
    await loadBridgeSessionDetail(state.selectedSessionId, { quiet: true });
  }

  async function openBridgeSession(sessionId) {
    if (disposed) return;
    const state = getBridgeRuntimeState();
    state.selectedSessionId = sessionId;
    state.selectedSession = state.items.find((item) => item?.sessionId === sessionId) || null;
    state.selectedPeek = null;
    renderBridgeList(state);
    await loadBridgeSessionDetail(sessionId, { quiet: false });
  }

  function refreshLocale() {
    if (disposed) return;
    const state = getBridgeRuntimeState();
    if (!bridgeSection) return;
    if (!isConnected?.()) {
      renderBridgeLoading(t("bridge.loadingDisconnected", {}, "未连接"));
      return;
    }
    renderBridgeSummary(state);
    renderBridgeList(state);
    renderBridgeDetail(state);
  }

  function setViewActive(active) {
    if (disposed) return;
    const state = getBridgeRuntimeState();
    state.viewActive = active === true;
    if (!state.viewActive) {
      stopPolling();
      return;
    }
    if (!state.items.length && isConnected?.()) {
      void loadBridgeSessions(false);
    }
    startPolling();
  }

  const handleRefreshClick = () => {
    if (disposed) return;
    void loadBridgeSessions(true);
  };
  bridgeRefreshBtn?.addEventListener("click", handleRefreshClick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopPolling();
    bridgeRefreshBtn?.removeEventListener("click", handleRefreshClick);
    const state = getBridgeRuntimeState();
    state.viewActive = false;
    state.loading = false;
    state.detailLoading = false;
    state.loadSeq = Number(state.loadSeq || 0) + 1;
    state.detailSeq = Number(state.detailSeq || 0) + 1;
  }

  function getRuntimeSnapshot() {
    return {
      viewActive: !disposed && getBridgeRuntimeState()?.viewActive === true,
      polling: pollTimer !== null,
      pollStartCount,
      pollTickCount,
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    loadBridgeSessions,
    openBridgeSession,
    refreshLocale,
    setViewActive,
  };
}
