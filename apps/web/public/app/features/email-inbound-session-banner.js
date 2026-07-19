function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

const EMAIL_INBOUND_SESSION_BANNER_SELECTOR = "[data-email-inbound-session-banner]";

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseEmailThreadConversationId(conversationId) {
  const normalized = normalizeString(conversationId);
  if (!normalized.startsWith("channel=email:")) {
    return null;
  }
  const parts = normalized.split(":");
  const values = {};
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!key || !rawValue) continue;
    values[key] = safeDecodeURIComponent(rawValue);
  }
  if (values.scope !== "per-account-thread") {
    return null;
  }
  const providerId = normalizeString(values.provider);
  const accountId = normalizeString(values.account);
  const threadId = normalizeString(values.thread);
  if (!providerId || !accountId || !threadId) {
    return null;
  }
  return {
    providerId,
    accountId,
    threadId,
    sessionKey: normalized,
    conversationId: normalized,
  };
}

export function selectLatestEmailInboundAuditForConversation(items, conversationId) {
  const parsed = parseEmailThreadConversationId(conversationId);
  if (!parsed || !Array.isArray(items)) return null;
  const normalizedItems = items.filter((item) => item && typeof item === "object");
  return normalizedItems.find((item) => normalizeString(item.conversationId) === parsed.conversationId)
    || normalizedItems.find((item) => normalizeString(item.sessionKey) === parsed.sessionKey)
    || normalizedItems.find((item) => (
      normalizeString(item.providerId) === parsed.providerId
      && normalizeString(item.accountId) === parsed.accountId
      && normalizeString(item.threadId) === parsed.threadId
    ))
    || null;
}

function resolveReplyModeLabel(auditItem, t) {
  const hasThreadHistory = normalizeString(auditItem?.inReplyToMessageId)
    || normalizeStringList(auditItem?.references).length > 0;
  return hasThreadHistory
    ? t("chat.emailInboundBannerReplyModeReply", {}, "回复既有线程")
    : t("chat.emailInboundBannerReplyModeNew", {}, "新线程首封");
}

function resolveIntroLine(auditItem, t) {
  if (!auditItem) {
    return t("chat.emailInboundBannerIntro", {}, "当前会话绑定到一条外部邮件线程。");
  }
  if (auditItem.status === "failed" && auditItem.retryScheduled === true) {
    return t("chat.emailInboundBannerIntroRetryScheduled", {}, "当前会话绑定到一条外部邮件线程。最近一封来信触发的自动处理失败，已排入重试。");
  }
  if (auditItem.status === "failed" && auditItem.retryExhausted === true) {
    return t("chat.emailInboundBannerIntroRetryExhausted", {}, "当前会话绑定到一条外部邮件线程。最近一封来信触发的自动处理失败，且已耗尽重试预算。");
  }
  if (auditItem.status === "processed") {
    return t("chat.emailInboundBannerIntroProcessed", {}, "当前会话绑定到一条外部邮件线程。最近一封来信已经触发了一轮自动处理。");
  }
  return t("chat.emailInboundBannerIntro", {}, "当前会话绑定到一条外部邮件线程。");
}

function resolveTriageLabel(auditItem, t) {
  const category = normalizeString(auditItem?.triageCategory);
  if (!category) return "";
  const priority = normalizeString(auditItem?.triagePriority);
  const disposition = normalizeString(auditItem?.triageDisposition);
  return [
    t("chat.emailInboundBannerTriage", {}, "整理建议"),
    category,
    priority,
    disposition,
  ].filter(Boolean).join(": ").replace(": ", " ");
}

export function buildEmailInboundSessionBanner(input) {
  const t = typeof input?.t === "function"
    ? input.t
    : (_key, _params, fallback) => fallback || "";
  const parsed = parseEmailThreadConversationId(input?.conversationId);
  if (!parsed) return "";
  const auditItem = input?.auditItem && typeof input.auditItem === "object"
    ? input.auditItem
    : null;
  const threadId = normalizeString(auditItem?.threadId) || parsed.threadId;
  const latestMessageId = normalizeString(auditItem?.messageId);
  const lines = [
    resolveIntroLine(auditItem, t),
    `${t("chat.emailInboundBannerProvider", {}, "Provider")}: ${parsed.providerId} · ${t("chat.emailInboundBannerAccount", {}, "Account")}: ${parsed.accountId} · ${t("chat.emailInboundBannerThread", {}, "线程")}: ${threadId}`,
    normalizeString(auditItem?.triageSummary) ? `${t("chat.emailInboundBannerTriage", {}, "整理建议")}: ${auditItem.triageSummary}` : resolveTriageLabel(auditItem, t),
    normalizeString(auditItem?.suggestedReplyQuality)
      ? `${t("chat.emailInboundBannerReplyQuality", {}, "回复建议质量")}: ${normalizeString(auditItem.suggestedReplyQuality)} · ${normalizeString(auditItem?.suggestedReplyConfidence) || "unknown"}`
      : "",
    Array.isArray(auditItem?.suggestedReplyWarnings) && auditItem.suggestedReplyWarnings.length > 0
      ? `${t("chat.emailInboundBannerReplyWarning", {}, "回复建议注意")}: ${normalizeString(auditItem.suggestedReplyWarnings[0])}`
      : "",
    `${t("chat.emailInboundBannerReplyMode", {}, "线程语义")}: ${resolveReplyModeLabel(auditItem, t)}`,
    `${t("chat.emailInboundBannerSuggestedThread", {}, "建议回复参数")}: send_email.threadId=${threadId}`,
    latestMessageId
      ? `${t("chat.emailInboundBannerSuggestedReply", {}, "建议回复目标")}: send_email.replyToMessageId=${latestMessageId}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function renderEmailInboundSessionBanner(container, text) {
  if (!(container instanceof Element)) return null;
  const existing = container.querySelector(EMAIL_INBOUND_SESSION_BANNER_SELECTOR);
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    existing?.remove();
    return null;
  }
  const bannerEl = existing || document.createElement("div");
  bannerEl.className = "system-msg";
  bannerEl.setAttribute("data-email-inbound-session-banner", "true");
  bannerEl.textContent = normalizedText;
  if (!existing) {
    container.insertBefore(bannerEl, container.firstChild);
  }
  return bannerEl;
}

export function createEmailInboundSessionBannerFeature({
  sendReq,
  t,
}) {
  const pendingReads = new Set();
  const retainedBanners = new Set();
  let generation = 0;
  let disposed = false;

  function isCurrent(expectedGeneration) {
    return !disposed && generation === expectedGeneration;
  }

  async function loadBannerText(conversationId) {
    if (disposed) return "";
    const parsed = parseEmailThreadConversationId(conversationId);
    if (!parsed || typeof sendReq !== "function") {
      return "";
    }
    const readGeneration = ++generation;
    const token = Symbol("email-inbound-banner-read");
    pendingReads.add(token);
    let auditItem = null;
    try {
      try {
        const res = await sendReq({
          type: "req",
          id: `email-inbound-banner-${Date.now()}`,
          method: "email_inbound.audit.list",
          params: { limit: 50 },
        });
        if (!isCurrent(readGeneration)) return "";
        const items = Array.isArray(res?.payload?.items) ? res.payload.items : [];
        auditItem = selectLatestEmailInboundAuditForConversation(items, conversationId);
      } catch {
        // Active failure keeps the basic thread banner; stale failure only settles physically.
        if (!isCurrent(readGeneration)) return "";
        auditItem = null;
      }
      return isCurrent(readGeneration)
        ? buildEmailInboundSessionBanner({ conversationId, auditItem, t })
        : "";
    } finally {
      pendingReads.delete(token);
    }
  }

  function renderBanner(container, text) {
    if (disposed) return null;
    const existing = container instanceof Element
      ? container.querySelector(EMAIL_INBOUND_SESSION_BANNER_SELECTOR)
      : null;
    const banner = renderEmailInboundSessionBanner(container, text);
    if (existing && !existing.parentNode) retainedBanners.delete(existing);
    if (banner) retainedBanners.add(banner);
    return banner;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    for (const banner of retainedBanners) banner.remove();
    retainedBanners.clear();
  }

  function getRuntimeSnapshot() {
    return {
      disposed,
      emailInboundBannerGeneration: generation,
      pendingEmailInboundBannerReadCount: pendingReads.size,
      retainedEmailInboundBannerCount: retainedBanners.size,
    };
  }

  return {
    dispose,
    getRuntimeSnapshot,
    loadBannerText,
    renderBanner,
  };
}
