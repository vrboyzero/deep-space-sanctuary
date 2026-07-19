const POLL_INTERVAL_MS = 1500;

function renderStatCard(label, value) {
  return `
    <div class="memory-stat-card">
      <span class="memory-stat-label">${label}</span>
      <strong class="memory-stat-value">${value}</strong>
    </div>
  `;
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

function renderDetailCard(label, value, escapeHtml) {
  return `
    <div class="memory-detail-card">
      <span class="memory-detail-label">${escapeHtml(label)}</span>
      <div class="memory-detail-text">${escapeHtml(value || "-")}</div>
    </div>
  `;
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
      bridgeSummaryEl.innerHTML = renderStatCard(
        escapeHtml(t("bridge.statSessions", {}, "桥接会话")),
        "--",
      );
    }
    if (bridgeListEl) {
      bridgeListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
    if (bridgeDetailEl) {
      bridgeDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
    }
  }

  function renderBridgeDetailEmpty(message) {
    if (!bridgeDetailEl) return;
    bridgeDetailEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function renderBridgeSummary(state) {
    if (!bridgeSummaryEl) return;
    bridgeSummaryEl.innerHTML = [
      renderStatCard(
        escapeHtml(t("bridge.statSessions", {}, "桥接会话")),
        escapeHtml(String(state.totalCount || 0)),
      ),
      renderStatCard(
        escapeHtml(t("bridge.statActive", {}, "运行中")),
        escapeHtml(String(state.activeCount || 0)),
      ),
      renderStatCard(
        escapeHtml(t("bridge.statClosed", {}, "已关闭")),
        escapeHtml(String(state.closedCount || 0)),
      ),
    ].join("");
  }

  function renderBridgeList(state) {
    if (!bridgeListEl) return;
    if (!Array.isArray(state.items) || state.items.length === 0) {
      bridgeListEl.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(t("bridge.empty", {}, "当前没有 bridge session。"))}</div>`;
      return;
    }

    bridgeListEl.innerHTML = state.items.map((item) => {
      const active = item?.sessionId === state.selectedSessionId;
      const runtimeBadge = formatBridgeStatus(item?.status, t);
      const bufferedBadge = item?.hasBufferedOutput
        ? `<span class="memory-badge">${escapeHtml(t("bridge.bufferedBadge", {}, "有新输出"))}</span>`
        : "";
      const taskBadge = item?.taskId
        ? `<span class="memory-badge">${escapeHtml(`task:${item.taskId}`)}</span>`
        : "";
      return `
        <button type="button" class="memory-list-item ${active ? "active" : ""}" data-bridge-session-id="${escapeHtml(item.sessionId)}">
          <div class="memory-list-item-head">
            <span class="memory-list-item-title">${escapeHtml(`${item.targetId}.${item.action}`)}</span>
            <span class="memory-badge">${escapeHtml(runtimeBadge)}</span>
          </div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(item.cwd || "-")}</span>
            ${taskBadge}
            ${bufferedBadge}
          </div>
          <div class="memory-list-item-snippet">${escapeHtml(item.latestOutputPreview || item.commandPreview || "-")}</div>
        </button>
      `;
    }).join("");

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
    const actions = [
      session.taskId
        ? `<button type="button" class="button" data-bridge-open-task="${escapeHtml(session.taskId)}">${escapeHtml(t("bridge.openTask", {}, "打开子任务"))}</button>`
        : "",
      session.transcriptPath
        ? `<button type="button" class="button goal-inline-action-secondary" data-open-source="${escapeHtml(session.transcriptPath)}">${escapeHtml(t("bridge.openTranscript", {}, "打开 transcript"))}</button>`
        : "",
      session.artifactPath
        ? `<button type="button" class="button goal-inline-action-secondary" data-open-source="${escapeHtml(session.artifactPath)}">${escapeHtml(t("bridge.openArtifact", {}, "打开 artifact"))}</button>`
        : "",
      `<button type="button" class="button goal-inline-action-secondary" data-bridge-refresh-session="${escapeHtml(session.sessionId)}">${escapeHtml(t("bridge.refreshSession", {}, "刷新输出"))}</button>`,
    ].filter(Boolean).join("");

    bridgeDetailEl.innerHTML = `
      <div class="memory-detail-shell">
        <section class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("bridge.detailTitle", {}, "Bridge Session"))}</span>
          <div class="memory-detail-grid">
            ${renderDetailCard(t("bridge.detailTarget", {}, "Target"), `${session.targetId}.${session.action}`, escapeHtml)}
            ${renderDetailCard(t("bridge.detailStatus", {}, "Status"), formatBridgeStatus(session.status, t), escapeHtml)}
            ${renderDetailCard(t("bridge.detailCloseReason", {}, "Close Reason"), formatCloseReason(session.closeReason, t), escapeHtml)}
            ${renderDetailCard(t("bridge.detailTaskId", {}, "Task ID"), session.taskId || "-", escapeHtml)}
            ${renderDetailCard(t("bridge.detailCwd", {}, "CWD"), session.cwd || "-", escapeHtml)}
            ${renderDetailCard(t("bridge.detailBuffered", {}, "Buffered Output"), String(session.bufferedOutputChars || 0), escapeHtml)}
          </div>
          <div class="memory-list-item-meta">
            <span>${escapeHtml(t("bridge.detailUpdatedAt", {}, "Updated"))}</span>
            <span>${escapeHtml(formatDateTime(session.updatedAt))}</span>
          </div>
          <div class="memory-detail-text bridge-command-preview">${escapeHtml(session.commandPreview || "-")}</div>
          ${session.firstTurnHint ? `<div class="tool-settings-policy-note">${escapeHtml(session.firstTurnHint)}</div>` : ""}
          ${actions ? `<div class="subtask-detail-actions">${actions}</div>` : ""}
        </section>
        <section class="memory-detail-card">
          <span class="memory-detail-label">${escapeHtml(t("bridge.detailOutput", {}, "Live Tail"))}</span>
          <pre class="bridge-live-output">${escapeHtml(transcriptText || t("bridge.noOutput", {}, "当前还没有可显示的输出。"))}</pre>
        </section>
      </div>
    `;

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
