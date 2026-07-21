function createElement(ownerDocument, tagName, className = "", text = undefined) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (typeof text !== "undefined") element.textContent = String(text ?? "");
  return element;
}

function createBadge(ownerDocument, text, className = "memory-badge") {
  return createElement(ownerDocument, "span", className, text);
}

function createButton(ownerDocument, className, text, attributes = {}) {
  const button = createElement(ownerDocument, "button", className, text);
  button.type = "button";
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, String(value ?? ""));
  }
  return button;
}

function createDetailText(ownerDocument, text) {
  return createElement(ownerDocument, "div", "memory-detail-text", text);
}

function createDetailCard(ownerDocument, label, content) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", label));
  if (content && typeof content === "object" && typeof content.nodeType === "number") {
    card.append(content);
  } else {
    card.append(createDetailText(ownerDocument, content));
  }
  return card;
}

function createSourceBadge(ownerDocument, sourceBadge) {
  return createBadge(
    ownerDocument,
    sourceBadge?.label || "",
    `memory-badge ${sourceBadge?.className || ""}`.trim(),
  );
}

function createShareAction(ownerDocument, action) {
  if (action?.kind === "promote") {
    return createButton(
      ownerDocument,
      "memory-usage-action-btn",
      action.label,
      { "data-memory-share-promote": action.value },
    );
  }
  if (action?.kind === "claim") {
    return createButton(
      ownerDocument,
      "memory-usage-action-btn",
      action.label,
      {
        "data-memory-share-claim": action.action,
        "data-memory-share-claim-scope": action.scope,
      },
    );
  }
  return createButton(
    ownerDocument,
    "memory-usage-action-btn",
    action?.label || "",
    {
      "data-memory-share-decision": action?.decision || "",
      ...(action?.scope ? { "data-memory-share-decision-scope": action.scope } : {}),
    },
  );
}

function createCollapsedSection(ownerDocument, section, label, text, preview, options) {
  const { t, formatCount } = options;
  const card = createElement(
    ownerDocument,
    "div",
    `memory-detail-card${preview?.truncated ? " is-collapsible" : ""}`,
  );
  card.setAttribute("data-memory-detail-collapsible", section);
  const head = createElement(ownerDocument, "div", "memory-detail-card-head");
  head.append(createElement(ownerDocument, "span", "memory-detail-label", label));
  if (preview?.truncated) {
    head.append(createButton(
      ownerDocument,
      "memory-usage-action-btn",
      t("memory.detailExpand", {}, "Expand"),
      {
        "data-memory-detail-toggle": section,
        "data-memory-detail-expanded": "false",
      },
    ));
  }
  card.append(head);
  if (preview?.truncated) {
    card.append(createElement(
      ownerDocument,
      "div",
      "memory-detail-caption",
      t(
        "memory.detailCollapsedHint",
        {
          chars: formatCount(preview.charCount),
          lines: formatCount(preview.lineCount),
        },
        `Previewing ${formatCount(preview.charCount)} chars / ${formatCount(preview.lineCount)} lines`,
      ),
    ));
  }
  const body = createElement(
    ownerDocument,
    "pre",
    `memory-detail-pre${preview?.truncated ? " is-collapsed" : ""}`,
    preview?.truncated ? preview.preview : text,
  );
  body.setAttribute("data-memory-detail-body", section);
  card.append(body);
  return card;
}

export function createMemoryViewerMemoryDetailView({
  t = (_key, _params, fallback) => fallback ?? "",
  formatCount = (value) => String(value ?? 0),
  formatLineRange = (start, end) => `${start ?? ""}-${end ?? ""}`,
  formatScore = (value) => String(value ?? ""),
  formatMemoryTypeLabel = (value) => String(value ?? ""),
  formatMemorySourceTypeLabel = (value) => String(value ?? ""),
  getVisibilityBadgeClass = () => "",
  summarizeSourcePath = (value) => String(value ?? ""),
} = {}) {
  return {
    render({ container, view } = {}) {
      if (!container || !view?.item) return;
      const ownerDocument = container.ownerDocument;
      const { item } = view;
      const shell = createElement(ownerDocument, "div", "memory-detail-shell");

      const header = createElement(ownerDocument, "div", "memory-detail-header memory-detail-header-memory-entry");
      const headerMain = createElement(ownerDocument, "div", "memory-detail-header-main");
      headerMain.append(createElement(ownerDocument, "div", "memory-detail-title", summarizeSourcePath(item.sourcePath)));
      if (!view.compact) {
        const meta = createElement(ownerDocument, "div", "memory-list-item-meta");
        meta.append(createElement(ownerDocument, "span", "", item.id));
        headerMain.append(meta);
      }
      const headerSide = createElement(ownerDocument, "div", "memory-detail-header-side");
      const headerBadges = createElement(ownerDocument, "div", "memory-detail-badges memory-detail-badges-memory-entry");
      headerBadges.append(
        createBadge(ownerDocument, formatMemoryTypeLabel(item.memoryType)),
        createBadge(ownerDocument, formatMemorySourceTypeLabel(item.sourceType)),
        createBadge(
          ownerDocument,
          view.visibility,
          `memory-badge ${getVisibilityBadgeClass(view.visibility)}`,
        ),
        createSourceBadge(ownerDocument, view.sourceBadge),
        createBadge(ownerDocument, view.category),
        createBadge(ownerDocument, `分数 ${formatScore(item.score)}`),
      );
      headerSide.append(headerBadges);
      if (view.shareActions.length > 0) {
        const actions = createElement(ownerDocument, "div", "memory-detail-actions memory-detail-actions-memory-entry");
        actions.append(...view.shareActions.map((action) => createShareAction(ownerDocument, action)));
        headerSide.append(actions);
      }
      header.append(headerMain, headerSide);
      shell.append(header);

      const context = createElement(ownerDocument, "div", "memory-detail-card");
      const contextHeader = createElement(ownerDocument, "div", "goal-summary-header");
      const contextHeaderText = createElement(ownerDocument, "div");
      contextHeaderText.append(
        createElement(ownerDocument, "div", "goal-summary-title", t("memory.contextSummaryTitle", {}, "上下文链")),
        createElement(
          ownerDocument,
          "div",
          "goal-summary-text",
          t("memory.contextSummaryMemoryText", {}, "把来源范围、shared 治理状态与继续下钻入口收拢到一处。"),
        ),
      );
      contextHeader.append(contextHeaderText);
      const contextBadges = createElement(ownerDocument, "div", "memory-detail-badges");
      contextBadges.append(
        createBadge(
          ownerDocument,
          view.visibility,
          `memory-badge ${getVisibilityBadgeClass(view.visibility)}`,
        ),
        createSourceBadge(ownerDocument, view.sourceBadge),
        createBadge(ownerDocument, view.shareStatus),
      );
      if (view.targetDisplayName) contextBadges.append(createBadge(ownerDocument, view.targetDisplayName));
      if (view.claimOwner) {
        contextBadges.append(createBadge(
          ownerDocument,
          view.claimTimedOut
            ? t("memory.contextClaimTimedOut", {}, "claim 超时")
            : t("memory.contextClaimActive", {}, "claim 生效中"),
        ));
      }
      const contextMeta = createElement(ownerDocument, "div", "memory-list-item-meta");
      contextMeta.append(createElement(ownerDocument, "span", "", view.sourceExplanation));
      const contextActions = createElement(ownerDocument, "div", "goal-detail-actions");
      if (item.sourcePath) {
        contextActions.append(createButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          t("memory.contextOpenSource", {}, "打开来源文件"),
          {
            "data-open-source": item.sourcePath,
            "data-open-line": typeof item.startLine === "number" ? item.startLine : "",
          },
        ));
      }
      if (view.canOpenSharedReviewContext) {
        contextActions.append(createButton(
          ownerDocument,
          "button goal-inline-action-secondary",
          t("memory.contextOpenSharedReview", {}, "打开 Shared Review"),
          { "data-memory-open-shared-review-context": "1" },
        ));
      }
      context.append(contextHeader, contextBadges, contextMeta, contextActions);
      shell.append(context);

      const grid = createElement(ownerDocument, "div", "memory-detail-grid");
      grid.append(
        createDetailCard(ownerDocument, t("memory.detailVisibility", {}, "Visibility"), view.visibility),
        createDetailCard(ownerDocument, t("memory.sharedReviewTargetAgent", {}, "Target Agent"), view.targetDisplayName),
        createDetailCard(ownerDocument, t("memory.detailSharedStatus", {}, "Shared Status"), view.shareStatus),
        createDetailCard(ownerDocument, t("memory.detailSharedClaim", {}, "Shared Claim"), view.claimStatusText),
        createDetailCard(ownerDocument, t("memory.detailSharedReviewerState", {}, "Reviewer State"), view.reviewerStateText),
        createDetailCard(ownerDocument, t("memory.detailCategory", {}, "Category"), view.category),
        createDetailCard(ownerDocument, t("memory.detailSummary", {}, "Summary"), item.summary || t("memory.emptyNoSummary", {}, "No summary")),
      );
      if (!view.compact) {
        let sourcePathContent = "-";
        if (item.sourcePath) {
          const wrapper = createDetailText(ownerDocument, "");
          wrapper.append(createButton(
            ownerDocument,
            "memory-path-link",
            item.sourcePath,
            {
              "data-open-source": item.sourcePath,
              "data-open-line": typeof item.startLine === "number" ? item.startLine : "",
            },
          ));
          sourcePathContent = wrapper;
        }
        grid.append(
          createDetailCard(ownerDocument, t("memory.detailSourcePath", {}, "Source Path"), sourcePathContent),
          createDetailCard(ownerDocument, t("memory.detailLines", {}, "Lines"), formatLineRange(item.startLine, item.endLine)),
          createDetailCard(ownerDocument, "来源视角", view.sourceSummary),
          createDetailCard(ownerDocument, "来源解释", view.sourceExplanation),
          createDetailCard(ownerDocument, "冲突说明", view.sourceConflictSummary),
          createDetailCard(ownerDocument, "来源审计", view.sourceAuditSummary),
          createDetailCard(ownerDocument, t("memory.detailSharedGovernance", {}, "Shared Governance"), view.governanceSummary),
        );
      }
      shell.append(grid);

      shell.append(createDetailCard(
        ownerDocument,
        t("memory.detailSnippet", {}, "Snippet"),
        item.snippet || t("memory.noContent", {}, "No content"),
      ));
      shell.append(createCollapsedSection(
        ownerDocument,
        "content",
        t("memory.detailContent", {}, "Content"),
        view.contentText,
        view.contentPreview,
        { t, formatCount },
      ));
      if (!view.compact && view.metadataPreview) {
        shell.append(createCollapsedSection(
          ownerDocument,
          "metadata",
          "元数据",
          view.metadataText,
          view.metadataPreview,
          { t, formatCount },
        ));
      }
      container.replaceChildren(shell);
    },
  };
}
