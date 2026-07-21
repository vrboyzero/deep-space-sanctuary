function createElement(ownerDocument, tagName, className = "", text = undefined) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (typeof text !== "undefined") element.textContent = String(text ?? "");
  return element;
}

function createBadge(ownerDocument, text) {
  return createElement(ownerDocument, "span", "memory-badge", text);
}

function createDetailCard(ownerDocument, label, value, { preformatted = false } = {}) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(
    createElement(ownerDocument, "span", "memory-detail-label", label),
    createElement(
      ownerDocument,
      preformatted ? "pre" : "div",
      preformatted ? "memory-detail-pre" : "memory-detail-text",
      value,
    ),
  );
  return card;
}

function appendDetailCards(ownerDocument, container, rows) {
  for (const [label, value] of rows) {
    container.append(createDetailCard(ownerDocument, label, value));
  }
}

export function createMemoryViewerOutboundAuditDetailView({
  t = (_key, _params, fallback) => fallback ?? "",
  formatDateTime = (value) => String(value ?? ""),
  formatExternalOutboundDecisionLabel = (value) => String(value ?? "-"),
  formatExternalOutboundDeliveryLabel = (value) => String(value ?? "-"),
  formatEmailInboundStatusLabel = (value) => String(value ?? "-"),
  formatExternalOutboundResolutionLabel = (value) => String(value ?? "-"),
  formatEmailOutboundDiagnosis = () => "-",
  formatEmailInboundDiagnosis = () => "-",
  formatOutboundAuditChannelLabel = () => "-",
  formatOutboundAuditPreview = () => "-",
  buildExternalOutboundDiagnosis = () => ({ stageLabel: "-", summary: "-" }),
} = {}) {
  function createShell(ownerDocument, title, badges) {
    const shell = createElement(ownerDocument, "div", "memory-detail-shell");
    const header = createElement(ownerDocument, "div", "memory-detail-card");
    header.append(createElement(ownerDocument, "div", "memory-detail-title", title));
    const badgeContainer = createElement(ownerDocument, "div", "memory-detail-badges");
    badgeContainer.append(...badges.map((badge) => createBadge(ownerDocument, badge)));
    header.append(badgeContainer);
    shell.append(header);
    return { shell, header };
  }

  function renderOrganizer(ownerDocument, item, compact) {
    const badgeValues = [
      item?.providerId ? `email-inbound/${item.providerId}` : "",
      item?.latestTriageCategory,
      item?.latestTriagePriority,
      item?.needsReply ? t("memory.emailThreadOrganizerNeedsReplyBadge", {}, "待回复") : "",
      item?.needsFollowUp ? t("memory.emailThreadOrganizerNeedsFollowUpBadge", {}, "待跟进") : "",
      item?.latestSuggestedReplyQuality === "review_required"
        ? t("memory.emailThreadOrganizerReplyReviewBadge", {}, "回复待复核")
        : "",
      item?.reminderStatus === "pending" ? t("memory.emailThreadOrganizerReminderPendingBadge", {}, "待提醒") : "",
      item?.reminderStatus === "delivered" ? t("memory.emailThreadOrganizerReminderDeliveredBadge", {}, "已提醒") : "",
      item?.reminderStatus === "resolved" ? t("memory.emailThreadOrganizerReminderResolvedBadge", {}, "提醒已解除") : "",
    ].filter(Boolean);
    const { shell, header } = createShell(
      ownerDocument,
      t("memory.emailThreadOrganizerTitle", {}, "邮件线程整理"),
      badgeValues,
    );
    const actions = createElement(ownerDocument, "div", "memory-detail-actions");
    const openButton = createElement(
      ownerDocument,
      "button",
      "button",
      t("memory.emailThreadOrganizerOpenConversation", {}, "打开线程会话"),
    );
    openButton.type = "button";
    openButton.setAttribute("data-open-email-thread-conversation", String(item?.conversationId || ""));
    openButton.disabled = !item?.conversationId;
    actions.append(openButton);
    header.append(actions);

    const retryState = item?.retryExhaustedCount
      ? t("memory.outboundAuditInboundRetryExhausted", { count: item.retryExhaustedCount }, "已耗尽（{count} 次）")
      : item?.retryScheduledCount
        ? t("memory.outboundAuditInboundRetryScheduled", { count: item.retryScheduledCount }, "待重试（第 {count} 次）")
        : "-";
    const grid = createElement(ownerDocument, "div", "memory-detail-grid");
    appendDetailCards(ownerDocument, grid, [
      [t("memory.outboundAuditInboundConversation", {}, "会话"), item?.conversationId || "-"],
      [t("memory.outboundAuditProvider", {}, "Provider"), item?.providerId || "-"],
      [t("memory.outboundAuditTargetAccountId", {}, "目标 Account ID"), item?.targetAccountId || "-"],
      [t("memory.outboundAuditInboundAgent", {}, "处理 Agent"), item?.requestedAgentId || "-"],
      [t("memory.outboundAuditSubject", {}, "主题"), item?.latestSubject || "-"],
      [t("memory.outboundAuditInboundSender", {}, "发件人"), item?.latestSender || "-"],
      [t("memory.emailThreadOrganizerMessageCount", {}, "线程消息数"), String(Number(item?.messageCount) || 0)],
      [t("memory.outboundAuditInboundStatus", {}, "处理状态"), formatEmailInboundStatusLabel(item?.latestStatus)],
      [t("memory.outboundAuditInboundTriageCategory", {}, "整理分类"), item?.latestTriageCategory || "-"],
      [t("memory.outboundAuditInboundTriagePriority", {}, "整理优先级"), item?.latestTriagePriority || "-"],
      [t("memory.outboundAuditInboundTriageDisposition", {}, "建议动作"), item?.latestTriageDisposition || "-"],
      [t("memory.outboundAuditInboundTriageSummary", {}, "整理摘要"), item?.latestTriageSummary || "-"],
      [t("memory.outboundAuditInboundSuggestedReplyQuality", {}, "回复建议质量"), item?.latestSuggestedReplyQuality || "-"],
      [t("memory.outboundAuditInboundRetryState", {}, "重试状态"), retryState],
      [t("memory.emailThreadOrganizerReminderStatus", {}, "提醒状态"), item?.reminderStatus || "-"],
    ]);
    if (!compact) {
      appendDetailCards(ownerDocument, grid, [
        [t("memory.outboundAuditThreadId", {}, "线程 ID"), item?.threadId || "-"],
        [t("memory.outboundAuditInboundMessageId", {}, "Message ID"), item?.latestMessageId || "-"],
        [
          t("memory.outboundAuditInboundFollowUpWindow", {}, "建议跟进窗口"),
          item?.latestTriageFollowUpWindowHours ? `${item.latestTriageFollowUpWindowHours}h` : "-",
        ],
        [t("memory.outboundAuditInboundSuggestedReplyStarter", {}, "建议回复 starter"), item?.latestSuggestedReplyStarter || "-"],
        [t("memory.outboundAuditInboundSuggestedReplyConfidence", {}, "回复建议置信度"), item?.latestSuggestedReplyConfidence || "-"],
        [t("memory.outboundAuditInboundSuggestedReplySubject", {}, "建议回复主题"), item?.latestSuggestedReplySubject || "-"],
        [t("memory.emailThreadOrganizerProcessedCount", {}, "已处理消息"), String(Number(item?.processedCount) || 0)],
        [t("memory.emailThreadOrganizerFailedCount", {}, "失败消息"), String(Number(item?.failedCount) || 0)],
        [
          t("memory.emailThreadOrganizerReminderDueAt", {}, "提醒时间"),
          item?.reminderDueAt ? formatDateTime(item.reminderDueAt) : "-",
        ],
        [
          t("memory.emailThreadOrganizerReminderDeliveredAt", {}, "最近提醒"),
          item?.reminderLastDeliveredAt ? formatDateTime(item.reminderLastDeliveredAt) : "-",
        ],
        [
          t("memory.emailThreadOrganizerReminderResolution", {}, "提醒解除"),
          item?.reminderResolvedAt ? formatDateTime(item.reminderResolvedAt) : (item?.reminderResolutionSource || "-"),
        ],
      ]);
    }
    shell.append(grid);

    if (!compact && Array.isArray(item?.latestSuggestedReplyWarnings) && item.latestSuggestedReplyWarnings.length > 0) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditInboundSuggestedReplyWarnings", {}, "回复建议风险"),
        item.latestSuggestedReplyWarnings.join("\n"),
        { preformatted: true },
      ));
    }
    if (!compact && Array.isArray(item?.latestSuggestedReplyChecklist) && item.latestSuggestedReplyChecklist.length > 0) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditInboundSuggestedReplyChecklist", {}, "回复建议检查清单"),
        item.latestSuggestedReplyChecklist.join("\n"),
        { preformatted: true },
      ));
    }
    if (!compact && item?.latestSuggestedReplyDraft) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditInboundSuggestedReplyDraft", {}, "建议回复草稿"),
        item.latestSuggestedReplyDraft,
        { preformatted: true },
      ));
    }
    shell.append(createDetailCard(
      ownerDocument,
      t("memory.outboundAuditContentPreview", {}, "消息预览"),
      item?.latestPreview || t("memory.outboundAuditPreviewEmpty", {}, "(空文本)"),
      { preformatted: true },
    ));
    return shell;
  }

  function renderAudit(ownerDocument, item, compact) {
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
    const badges = isEmailInboundAudit
      ? [
          formatOutboundAuditChannelLabel(item),
          formatEmailInboundStatusLabel(item?.status),
          item?.createdBinding
            ? t("memory.outboundAuditInboundThreadBindingNew", {}, "新建线程会话")
            : t("memory.outboundAuditInboundThreadBindingExisting", {}, "复用线程会话"),
          item?.triageCategory,
          item?.triagePriority,
          item?.suggestedReplyQuality === "review_required"
            ? t("memory.emailThreadOrganizerReplyReviewBadge", {}, "回复待复核")
            : "",
        ].filter(Boolean)
      : [
          formatOutboundAuditChannelLabel(item),
          formatExternalOutboundDecisionLabel(item?.decision),
          formatExternalOutboundDeliveryLabel(item?.delivery),
        ];
    const { shell } = createShell(
      ownerDocument,
      t("memory.outboundAuditTitle", {}, "消息审计"),
      badges,
    );
    const grid = createElement(ownerDocument, "div", "memory-detail-grid");

    if (isEmailInboundAudit) {
      appendDetailCards(ownerDocument, grid, [
        [t("memory.outboundAuditTime", {}, "时间"), formatDateTime(item?.timestamp)],
        [t("memory.outboundAuditInboundConversation", {}, "会话"), item?.conversationId || "-"],
        [t("memory.outboundAuditInboundAgent", {}, "处理 Agent"), item?.requestedAgentId || "-"],
        [t("memory.outboundAuditProvider", {}, "Provider"), item?.providerId || "-"],
        [t("memory.outboundAuditTargetAccountId", {}, "目标 Account ID"), item?.targetAccountId || "-"],
        [t("memory.outboundAuditInboundSender", {}, "发件人"), senderSummary || "-"],
        [t("memory.outboundAuditSubject", {}, "主题"), item?.subject || "-"],
        [t("memory.outboundAuditInboundStatus", {}, "处理状态"), formatEmailInboundStatusLabel(item?.status)],
        [t("memory.outboundAuditInboundTriageCategory", {}, "整理分类"), item?.triageCategory || "-"],
        [t("memory.outboundAuditInboundTriagePriority", {}, "整理优先级"), item?.triagePriority || "-"],
        [t("memory.outboundAuditInboundTriageDisposition", {}, "建议动作"), item?.triageDisposition || "-"],
        [t("memory.outboundAuditInboundTriageSummary", {}, "整理摘要"), item?.triageSummary || "-"],
        [t("memory.outboundAuditInboundSuggestedReplyQuality", {}, "回复建议质量"), item?.suggestedReplyQuality || "-"],
        [
          t("memory.outboundAuditDiagnosis", {}, "诊断"),
          item?.status === "failed" || item?.status === "invalid_event" || item?.errorCode || item?.error
            ? diagnosis.summary
            : "-",
        ],
        [
          t("memory.outboundAuditInboundRetryState", {}, "重试状态"),
          item?.retryExhausted
            ? t("memory.outboundAuditInboundRetryExhausted", { count: item?.retryAttempt || 0 }, "已耗尽（{count} 次）")
            : item?.retryScheduled
              ? t("memory.outboundAuditInboundRetryScheduled", { count: item?.retryAttempt || 0 }, "待重试（第 {count} 次）")
              : "-",
        ],
      ]);
      if (!compact) {
        appendDetailCards(ownerDocument, grid, [
          [t("memory.outboundAuditInboundMessageId", {}, "Message ID"), item?.messageId || "-"],
          [t("memory.outboundAuditThreadId", {}, "线程 ID"), item?.threadId || "-"],
          [
            t("memory.outboundAuditInboundReplyMode", {}, "线程语义"),
            item?.inReplyToMessageId || (Array.isArray(item?.references) && item.references.length > 0)
              ? t("memory.outboundAuditInboundReplyModeReply", {}, "回复既有线程")
              : t("memory.outboundAuditInboundReplyModeNew", {}, "新线程首封"),
          ],
          [
            t("memory.outboundAuditInboundThreadBinding", {}, "会话绑定"),
            item?.createdBinding
              ? t("memory.outboundAuditInboundThreadBindingNew", {}, "新建线程会话")
              : t("memory.outboundAuditInboundThreadBindingExisting", {}, "复用线程会话"),
          ],
          [t("memory.outboundAuditInboundInReplyTo", {}, "In-Reply-To"), item?.inReplyToMessageId || "-"],
          [
            t("memory.outboundAuditInboundReferences", {}, "References"),
            Array.isArray(item?.references) && item.references.length > 0 ? item.references.join(" | ") : "-",
          ],
          [
            t("memory.outboundAuditInboundFollowUpWindow", {}, "建议跟进窗口"),
            item?.triageFollowUpWindowHours ? `${item.triageFollowUpWindowHours}h` : "-",
          ],
          [t("memory.outboundAuditInboundSuggestedReplyStarter", {}, "建议回复 starter"), item?.suggestedReplyStarter || "-"],
          [t("memory.outboundAuditInboundSuggestedReplyConfidence", {}, "回复建议置信度"), item?.suggestedReplyConfidence || "-"],
          [t("memory.outboundAuditInboundSuggestedReplySubject", {}, "建议回复主题"), item?.suggestedReplySubject || "-"],
          [t("memory.outboundAuditErrorCode", {}, "错误码"), item?.errorCode || "-"],
          [t("memory.outboundAuditAttachmentCount", {}, "附件数"), String(Number(item?.attachmentCount) || 0)],
          [t("memory.outboundAuditInboundInlineAttachmentCount", {}, "内联附件数"), String(Number(item?.inlineAttachmentCount) || 0)],
          [t("memory.outboundAuditInboundMailbox", {}, "Mailbox"), item?.mailbox || "-"],
          [t("memory.outboundAuditInboundSessionKey", {}, "Session Key"), item?.sessionKey || "-"],
          [t("memory.outboundAuditInboundCheckpointUid", {}, "Checkpoint UID"), item?.checkpointUid ? String(item.checkpointUid) : "-"],
        ]);
      }
    } else {
      appendDetailCards(ownerDocument, grid, [
        [t("memory.outboundAuditTime", {}, "时间"), formatDateTime(item?.timestamp)],
        [t("memory.outboundAuditSourceConversation", {}, "来源会话"), item?.sourceConversationId || "-"],
        [t("memory.outboundAuditRequestedByAgent", {}, "请求 Agent"), item?.requestedByAgentId || "-"],
        [
          isEmailOutboundAudit
            ? t("memory.outboundAuditProvider", {}, "Provider")
            : t("memory.outboundAuditTargetChatId", {}, "目标 Chat ID"),
          isEmailOutboundAudit ? (item?.providerId || "-") : (item?.targetChatId || "-"),
        ],
        [t("memory.outboundAuditTargetAccountId", {}, "目标 Account ID"), item?.targetAccountId || "-"],
        [
          isEmailOutboundAudit
            ? t("memory.outboundAuditRecipients", {}, "收件人")
            : t("memory.outboundAuditRequestedSessionKey", {}, "请求 Session Key"),
          isEmailOutboundAudit ? (recipientSummary || "-") : (item?.requestedSessionKey || "-"),
        ],
        [
          isEmailOutboundAudit
            ? t("memory.outboundAuditSubject", {}, "主题")
            : t("memory.outboundAuditTargetSessionKey", {}, "目标 Session Key"),
          isEmailOutboundAudit ? (item?.subject || "-") : (item?.targetSessionKey || "-"),
        ],
        [
          t("memory.outboundAuditDiagnosis", {}, "诊断"),
          item?.delivery === "failed" || item?.errorCode || item?.error ? diagnosis.summary : "-",
        ],
      ]);
      if (!compact) {
        appendDetailCards(ownerDocument, grid, [
          [t("memory.outboundAuditRequestId", {}, "Request ID"), item?.requestId || "-"],
          [
            isEmailOutboundAudit
              ? t("memory.outboundAuditThreadId", {}, "线程 ID")
              : t("memory.outboundAuditResolution", {}, "目标解析"),
            isEmailOutboundAudit
              ? (item?.threadId || item?.providerThreadId || "-")
              : formatExternalOutboundResolutionLabel(item?.resolution),
          ],
          [t("memory.outboundAuditFailureStage", {}, "失败阶段"), item?.delivery === "failed" ? diagnosis.stageLabel : "-"],
          [t("memory.outboundAuditErrorCode", {}, "错误码"), item?.errorCode || "-"],
        ]);
        if (isEmailAudit) {
          grid.append(createDetailCard(
            ownerDocument,
            t("memory.outboundAuditAttachmentCount", {}, "附件数"),
            String(Number(item?.attachmentCount) || 0),
          ));
        }
        if (isEmailOutboundAudit) {
          grid.append(
            createDetailCard(
              ownerDocument,
              t("memory.outboundAuditReplyToMessageId", {}, "回复消息 ID"),
              item?.replyToMessageId || "-",
            ),
            createDetailCard(
              ownerDocument,
              t("memory.outboundAuditProviderMessageId", {}, "Provider Message ID"),
              item?.providerMessageId || "-",
            ),
          );
        }
      }
    }
    shell.append(grid);
    shell.append(createDetailCard(
      ownerDocument,
      t("memory.outboundAuditContentPreview", {}, "消息预览"),
      formatOutboundAuditPreview(item),
      { preformatted: true },
    ));
    if (!compact && isEmailInboundAudit && Array.isArray(item?.suggestedReplyWarnings) && item.suggestedReplyWarnings.length > 0) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditInboundSuggestedReplyWarnings", {}, "回复建议风险"),
        item.suggestedReplyWarnings.join("\n"),
        { preformatted: true },
      ));
    }
    if (!compact && isEmailInboundAudit && Array.isArray(item?.suggestedReplyChecklist) && item.suggestedReplyChecklist.length > 0) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditInboundSuggestedReplyChecklist", {}, "回复建议检查清单"),
        item.suggestedReplyChecklist.join("\n"),
        { preformatted: true },
      ));
    }
    if (!compact && isEmailInboundAudit && item?.suggestedReplyDraft) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditInboundSuggestedReplyDraft", {}, "建议回复草稿"),
        item.suggestedReplyDraft,
        { preformatted: true },
      ));
    }
    if (!compact && item?.error) {
      shell.append(createDetailCard(
        ownerDocument,
        t("memory.outboundAuditError", {}, "错误信息"),
        item.error,
        { preformatted: true },
      ));
    }
    return shell;
  }

  return {
    render({ container, item, compact = false } = {}) {
      if (!container || !item) return;
      const ownerDocument = container.ownerDocument;
      const shell = item?.auditKind === "email_thread_organizer"
        ? renderOrganizer(ownerDocument, item, compact)
        : renderAudit(ownerDocument, item, compact);
      container.replaceChildren(shell);
    },
  };
}
