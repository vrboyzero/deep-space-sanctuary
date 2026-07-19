import { parseEmailThreadConversationId } from "./email-inbound-session-banner.js";

export function createEmailOutboundController({
  refs,
  isConnected,
  sendReq,
  makeId,
  clientId,
  escapeHtml,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    emailOutboundConfirmModal,
    emailOutboundConfirmPreviewEl,
    emailOutboundConfirmTargetEl,
    emailOutboundConfirmExpiryEl,
    emailOutboundConfirmApproveBtn,
    emailOutboundConfirmRejectBtn,
  } = refs;

  let pendingConfirm = null;
  let confirmTimer = null;
  let confirmRevision = 0;
  let timerStartCount = 0;
  let timerTickCount = 0;
  let disposed = false;

  function shouldHandlePayload(payload) {
    if (disposed || !payload || typeof payload !== "object") return false;
    const targetClientId = payload.targetClientId ? String(payload.targetClientId).trim() : "";
    return !targetClientId || targetClientId === clientId;
  }

  function normalizeList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const requestId = payload.requestId ? String(payload.requestId).trim() : "";
    const conversationId = payload.conversationId ? String(payload.conversationId).trim() : "";
    const providerId = payload.providerId ? String(payload.providerId).trim() : "";
    const accountId = payload.accountId ? String(payload.accountId).trim() : "";
    if (!requestId || !conversationId || !providerId) return null;
    return {
      requestId,
      conversationId,
      providerId,
      accountId,
      to: normalizeList(payload.to),
      cc: normalizeList(payload.cc),
      bcc: normalizeList(payload.bcc),
      subject: payload.subject ? String(payload.subject) : "",
      bodyPreview: payload.bodyPreview ? String(payload.bodyPreview) : "",
      attachmentCount: Number.isFinite(payload.attachmentCount) ? Math.max(0, Math.floor(Number(payload.attachmentCount))) : 0,
      threadId: payload.threadId ? String(payload.threadId) : "",
      replyToMessageId: payload.replyToMessageId ? String(payload.replyToMessageId) : "",
      expiresAt: Number(payload.expiresAt || 0),
    };
  }

  function setBusy(busy) {
    if (emailOutboundConfirmApproveBtn) emailOutboundConfirmApproveBtn.disabled = busy;
    if (emailOutboundConfirmRejectBtn) emailOutboundConfirmRejectBtn.disabled = busy;
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
      return t("emailOutbound.confirmExpired", {}, "此确认请求已过期，请重新触发发送。");
    }
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec < 60) {
      return t("emailOutbound.confirmInSeconds", { seconds: remainingSec }, `请在 ${remainingSec} 秒内完成确认。`);
    }
    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    return t(
      "emailOutbound.confirmInMinutes",
      { minutes, seconds: seconds.toString().padStart(2, "0") },
      `请在 ${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒内完成确认。`,
    );
  }

  function buildThreadGuidanceLines() {
    const context = parseEmailThreadConversationId(pendingConfirm?.conversationId);
    if (!context) return [];
    if (!pendingConfirm?.threadId) {
      return [
        `${t("emailOutbound.threadContextLabel", {}, "当前邮件线程")}: ${context.threadId}`,
        t(
          "emailOutbound.threadGuidanceMissingThread",
          { threadId: context.threadId },
          `当前会话属于邮件线程；如果你想继续原线程，建议补上 send_email.threadId=${context.threadId}。`,
        ),
      ];
    }
    if (pendingConfirm.threadId !== context.threadId) {
      return [
        `${t("emailOutbound.threadContextLabel", {}, "当前邮件线程")}: ${context.threadId}`,
        t(
          "emailOutbound.threadGuidanceMismatch",
          { currentThreadId: context.threadId, draftThreadId: pendingConfirm.threadId },
          `当前会话线程是 ${context.threadId}，但这次草稿使用的是 ${pendingConfirm.threadId}；请确认这是有意切到另一条线程。`,
        ),
      ];
    }
    if (!pendingConfirm.replyToMessageId) {
      return [
        `${t("emailOutbound.threadContextLabel", {}, "当前邮件线程")}: ${context.threadId}`,
        t(
          "emailOutbound.threadGuidanceMatchedWithoutReply",
          { threadId: context.threadId },
          "这次草稿会继续当前邮件线程，但还没有显式的 send_email.replyToMessageId；如果你要精确回复某封来信，建议补上。",
        ),
      ];
    }
    return [
      `${t("emailOutbound.threadContextLabel", {}, "当前邮件线程")}: ${context.threadId}`,
      t(
        "emailOutbound.threadGuidanceMatchedWithReply",
        { threadId: context.threadId, replyToMessageId: pendingConfirm.replyToMessageId },
        `这次草稿会继续当前邮件线程，并显式回复 ${pendingConfirm.replyToMessageId}。`,
      ),
    ];
  }

  function renderModal() {
    if (disposed || !pendingConfirm) return;
    if (emailOutboundConfirmPreviewEl) {
      emailOutboundConfirmPreviewEl.textContent = pendingConfirm.bodyPreview
        || t("emailOutbound.previewEmpty", {}, "(空文本)");
    }
    if (emailOutboundConfirmTargetEl) {
      const lines = [
        `${t("emailOutbound.providerLabel", {}, "Provider")}: ${pendingConfirm.providerId}`,
        pendingConfirm.accountId ? `${t("emailOutbound.accountLabel", {}, "账号")}: ${pendingConfirm.accountId}` : "",
        pendingConfirm.to.length > 0 ? `${t("emailOutbound.toLabel", {}, "To")}: ${pendingConfirm.to.join(", ")}` : "",
        pendingConfirm.cc.length > 0 ? `${t("emailOutbound.ccLabel", {}, "Cc")}: ${pendingConfirm.cc.join(", ")}` : "",
        pendingConfirm.bcc.length > 0 ? `${t("emailOutbound.bccLabel", {}, "Bcc")}: ${pendingConfirm.bcc.join(", ")}` : "",
        `${t("emailOutbound.subjectLabel", {}, "主题")}: ${pendingConfirm.subject || t("emailOutbound.subjectEmpty", {}, "(无主题)")}`,
        pendingConfirm.attachmentCount > 0 ? `${t("emailOutbound.attachmentsLabel", {}, "附件")}: ${pendingConfirm.attachmentCount}` : "",
        pendingConfirm.threadId ? `${t("emailOutbound.threadLabel", {}, "线程")}: ${pendingConfirm.threadId}` : "",
        pendingConfirm.replyToMessageId ? `${t("emailOutbound.replyToMessageIdLabel", {}, "回复消息 ID")}: ${pendingConfirm.replyToMessageId}` : "",
        ...buildThreadGuidanceLines(),
      ].filter(Boolean);
      emailOutboundConfirmTargetEl.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
    }
    if (emailOutboundConfirmExpiryEl) {
      emailOutboundConfirmExpiryEl.textContent = formatExpiry(pendingConfirm.expiresAt);
    }
  }

  function clearModal() {
    confirmRevision += 1;
    pendingConfirm = null;
    stopTimer();
    setBusy(false);
    if (emailOutboundConfirmModal) emailOutboundConfirmModal.classList.add("hidden");
  }

  function handleConfirmRequired(payload) {
    if (!shouldHandlePayload(payload)) return;
    const normalized = normalizePayload(payload);
    if (!normalized) return;
    confirmRevision += 1;
    pendingConfirm = normalized;
    setBusy(false);
    renderModal();
    if (emailOutboundConfirmModal) emailOutboundConfirmModal.classList.remove("hidden");
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
        ? t("emailOutbound.noticeConfirmedTitle", {}, "邮件已发送")
        : t("emailOutbound.noticeRejectedTitle", {}, "邮件已取消"),
      approved
        ? t("emailOutbound.noticeConfirmedMessage", {}, "邮件已通过当前 provider 发送。")
        : t("emailOutbound.noticeRejectedMessage", {}, "这次邮件发送请求已被取消。"),
      approved ? "success" : "info",
      2600,
    );
  }

  async function submit(decision) {
    if (disposed || !pendingConfirm) return;
    if (!isConnected()) {
      showNotice(
        t("emailOutbound.noticeHandleErrorTitle", {}, "无法处理确认"),
        t("emailOutbound.noticeNotConnected", {}, "当前未连接到服务器。"),
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
      method: "email_outbound.confirm",
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
          ? t("emailOutbound.approveFailedTitle", {}, "发送失败")
          : t("emailOutbound.rejectFailedTitle", {}, "拒绝失败"),
        res?.error?.message || t("emailOutbound.requestIncomplete", {}, "请求未完成。"),
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
        ? t("emailOutbound.noticeConfirmedTitle", {}, "邮件已发送")
        : t("emailOutbound.noticeRejectedTitle", {}, "邮件已取消"),
      decision === "approve"
        ? t("emailOutbound.noticeConfirmedMessage", {}, "邮件已通过当前 provider 发送。")
        : t("emailOutbound.noticeRejectedMessage", {}, "这次邮件发送请求已被取消。"),
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
  emailOutboundConfirmApproveBtn?.addEventListener("click", handleApproveClick);
  emailOutboundConfirmRejectBtn?.addEventListener("click", handleRejectClick);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearModal();
    emailOutboundConfirmApproveBtn?.removeEventListener("click", handleApproveClick);
    emailOutboundConfirmRejectBtn?.removeEventListener("click", handleRejectClick);
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
