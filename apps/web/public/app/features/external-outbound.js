import { buildExternalOutboundDiagnosis } from "./external-outbound-diagnosis.js";

export function createExternalOutboundController({
  refs,
  isConnected,
  sendReq,
  makeId,
  clientId,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    externalOutboundConfirmModal,
    externalOutboundConfirmPreviewEl,
    externalOutboundConfirmTargetEl,
    externalOutboundConfirmExpiryEl,
    externalOutboundConfirmApproveBtn,
    externalOutboundConfirmRejectBtn,
  } = refs;

  let pendingConfirm = null;
  let confirmTimer = null;
  let confirmRevision = 0;
  let timerStartCount = 0;
  let timerTickCount = 0;
  let disposed = false;

  function formatErrorMessage(error) {
    if (!error || typeof error !== "object") {
      return t("externalOutbound.requestIncomplete", {}, "请求未完成。");
    }
    const code = error.code ? String(error.code).trim() : "";
    const message = error.message ? String(error.message).trim() : "";
    if (!code && !message) {
      return t("externalOutbound.requestIncomplete", {}, "请求未完成。");
    }
    return buildExternalOutboundDiagnosis({
      errorCode: code,
      error: message,
    }, t).summary;
  }

  function shouldHandlePayload(payload) {
    if (disposed || !payload || typeof payload !== "object") return false;
    const targetClientId = payload.targetClientId ? String(payload.targetClientId).trim() : "";
    return !targetClientId || targetClientId === clientId;
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const requestId = payload.requestId ? String(payload.requestId).trim() : "";
    const conversationId = payload.conversationId ? String(payload.conversationId).trim() : "";
    const channel = payload.channel ? String(payload.channel).trim() : "";
    if (!requestId || !conversationId || !channel) return null;
    return {
      requestId,
      conversationId,
      channel,
      contentPreview: payload.contentPreview ? String(payload.contentPreview) : "",
      targetSessionKey: payload.targetSessionKey ? String(payload.targetSessionKey) : "",
      targetChatId: payload.targetChatId ? String(payload.targetChatId) : "",
      targetAccountId: payload.targetAccountId ? String(payload.targetAccountId) : "",
      resolution: payload.resolution ? String(payload.resolution) : "",
      expiresAt: Number(payload.expiresAt || 0),
    };
  }

  function setBusy(busy) {
    if (externalOutboundConfirmApproveBtn) externalOutboundConfirmApproveBtn.disabled = busy;
    if (externalOutboundConfirmRejectBtn) externalOutboundConfirmRejectBtn.disabled = busy;
  }

  function stopTimer() {
    if (confirmTimer !== null) {
      clearInterval(confirmTimer);
      confirmTimer = null;
    }
  }

  function formatExpiry(expiresAt) {
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return "";
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      return t("externalOutbound.confirmExpired", {}, "此确认请求已过期，请重新触发发送。");
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec < 60) {
      return t("externalOutbound.confirmInSeconds", { seconds: remainingSec }, `请在 ${remainingSec} 秒内完成确认。`);
    }
    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    return t(
      "externalOutbound.confirmInMinutes",
      { minutes, seconds: seconds.toString().padStart(2, "0") },
      `请在 ${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒内完成确认。`,
    );
  }

  function renderModal() {
    if (disposed || !pendingConfirm) return;
    if (externalOutboundConfirmPreviewEl) {
      externalOutboundConfirmPreviewEl.textContent = pendingConfirm.contentPreview
        || t("externalOutbound.previewEmpty", {}, "(空文本)");
    }
    if (externalOutboundConfirmTargetEl) {
      const lines = [
        `${t("externalOutbound.targetChannel", {}, "目标渠道")}: ${pendingConfirm.channel}`,
        pendingConfirm.targetSessionKey
          ? `${t("externalOutbound.targetSessionKey", {}, "目标 Session")}: ${pendingConfirm.targetSessionKey}`
          : "",
        pendingConfirm.targetChatId
          ? `${t("externalOutbound.targetChatId", {}, "目标 Chat")}: ${pendingConfirm.targetChatId}`
          : "",
        pendingConfirm.targetAccountId
          ? `${t("externalOutbound.targetAccountId", {}, "目标账号")}: ${pendingConfirm.targetAccountId}`
          : "",
        pendingConfirm.resolution
          ? `${t("externalOutbound.targetResolution", {}, "目标解析")}: ${pendingConfirm.resolution}`
          : "",
      ].filter(Boolean);
      const ownerDocument = externalOutboundConfirmTargetEl.ownerDocument ?? document;
      externalOutboundConfirmTargetEl.replaceChildren(...lines.map((line) => {
        const row = ownerDocument.createElement("div");
        row.textContent = line;
        return row;
      }));
    }
    if (externalOutboundConfirmExpiryEl) {
      externalOutboundConfirmExpiryEl.textContent = formatExpiry(pendingConfirm.expiresAt);
    }
  }

  function clearModal() {
    confirmRevision += 1;
    pendingConfirm = null;
    stopTimer();
    setBusy(false);
    if (externalOutboundConfirmModal) externalOutboundConfirmModal.classList.add("hidden");
  }

  function handleConfirmRequired(payload) {
    if (!shouldHandlePayload(payload)) return;
    const normalized = normalizePayload(payload);
    if (!normalized) return;
    confirmRevision += 1;
    pendingConfirm = normalized;
    setBusy(false);
    renderModal();
    if (externalOutboundConfirmModal) externalOutboundConfirmModal.classList.remove("hidden");
    stopTimer();
    timerStartCount += 1;
    confirmTimer = setInterval(() => {
      if (disposed || !pendingConfirm) {
        stopTimer();
        return;
      }
      timerTickCount += 1;
      renderModal();
    }, 1000);
  }

  function handleConfirmResolved(payload) {
    if (!shouldHandlePayload(payload)) return;
    const requestId = payload && payload.requestId ? String(payload.requestId).trim() : "";
    if (!pendingConfirm || pendingConfirm.requestId !== requestId) return;
    const approved = payload && payload.decision === "approved";
    clearModal();
    showNotice(
      approved
        ? t("externalOutbound.noticeConfirmedTitle", {}, "外部消息已发送")
        : t("externalOutbound.noticeRejectedTitle", {}, "外部消息已取消"),
      approved
        ? t("externalOutbound.noticeConfirmedMessage", {}, "目标渠道已收到这条文本消息。")
        : t("externalOutbound.noticeRejectedMessage", {}, "这次外发请求已被取消。"),
      approved ? "success" : "info",
      2600,
    );
  }

  async function submit(decision) {
    if (disposed || !pendingConfirm) return;
    if (!isConnected()) {
      showNotice(
        t("externalOutbound.noticeHandleErrorTitle", {}, "无法处理确认"),
        t("externalOutbound.noticeNotConnected", {}, "当前未连接到服务器。"),
        "error",
      );
      return;
    }
    setBusy(true);
    const currentRequest = pendingConfirm;
    const revision = confirmRevision;
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "external_outbound.confirm",
      params: {
        requestId: currentRequest.requestId,
        conversationId: currentRequest.conversationId,
        decision,
      },
    });
    if (disposed || revision !== confirmRevision || pendingConfirm?.requestId !== currentRequest.requestId) {
      return;
    }
    if (!res || res.ok === false) {
      setBusy(false);
      showNotice(
        decision === "approve"
          ? t("externalOutbound.approveFailedTitle", {}, "发送失败")
          : t("externalOutbound.rejectFailedTitle", {}, "拒绝失败"),
        formatErrorMessage(res?.error),
        "error",
      );
      if (res?.error?.code === "not_found") {
        clearModal();
      }
      return;
    }
    clearModal();
    showNotice(
      decision === "approve"
        ? t("externalOutbound.noticeConfirmedTitle", {}, "外部消息已发送")
        : t("externalOutbound.noticeRejectedTitle", {}, "外部消息已取消"),
      decision === "approve"
        ? t("externalOutbound.noticeConfirmedMessage", {}, "目标渠道已收到这条文本消息。")
        : t("externalOutbound.noticeRejectedMessage", {}, "这次外发请求已被取消。"),
      decision === "approve" ? "success" : "info",
      2600,
    );
  }

  const handleApproveClick = () => {
    void submit("approve");
  };
  const handleRejectClick = () => {
    void submit("reject");
  };
  externalOutboundConfirmApproveBtn?.addEventListener("click", handleApproveClick);
  externalOutboundConfirmRejectBtn?.addEventListener("click", handleRejectClick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearModal();
    externalOutboundConfirmApproveBtn?.removeEventListener("click", handleApproveClick);
    externalOutboundConfirmRejectBtn?.removeEventListener("click", handleRejectClick);
  }

  function getRuntimeSnapshot() {
    return {
      pendingConfirmationCount: pendingConfirm ? 1 : 0,
      timerActive: confirmTimer !== null,
      timerStartCount,
      timerTickCount,
      disposed,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    handleConfirmRequired,
    handleConfirmResolved,
  };
}
