const ACTION_ATTRIBUTES = new Set([
  "data-open-task-id",
  "data-open-source",
  "data-open-candidate-id",
  "data-open-tool-settings-tab",
]);

function createElement(ownerDocument, tagName, className = "", text = undefined) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (typeof text !== "undefined") element.textContent = String(text ?? "");
  return element;
}

function createBadge(ownerDocument, badge) {
  const tone = badge?.tone === "synthesized"
    ? " experience-synthesized-badge"
    : badge?.tone === "published"
      ? " memory-badge-shared"
      : "";
  return createElement(ownerDocument, "span", `memory-badge${tone}`, badge?.text ?? "");
}

function createActionButton(ownerDocument, action, className) {
  if (!action || !ACTION_ATTRIBUTES.has(action.attribute) || !action.value) return null;
  const button = createElement(ownerDocument, "button", className, action.text ?? "");
  button.type = "button";
  button.setAttribute(action.attribute, String(action.value));
  return button;
}

function createAggregatePanel(ownerDocument, aggregate) {
  const panel = createElement(ownerDocument, "div", "memory-detail-card experience-candidate-aggregate");
  const header = createElement(ownerDocument, "div", "goal-summary-header");
  const headerText = createElement(ownerDocument, "div");
  headerText.append(
    createElement(ownerDocument, "div", "goal-summary-title", aggregate?.title ?? ""),
    createElement(ownerDocument, "div", "goal-summary-text", aggregate?.summary ?? ""),
  );
  const badges = createElement(ownerDocument, "div", "memory-detail-badges");
  for (const badge of Array.isArray(aggregate?.badges) ? aggregate.badges : []) {
    badges.append(createBadge(ownerDocument, badge));
  }
  header.append(headerText, badges);
  panel.append(header);

  if (aggregate?.freshness?.headline) {
    const freshness = createElement(
      ownerDocument,
      "div",
      "tool-settings-policy-note memory-candidate-memory-freshness",
    );
    const headline = createElement(ownerDocument, "div");
    headline.append(
      createElement(ownerDocument, "strong", "", "Memory Freshness："),
      ownerDocument.createTextNode(String(aggregate.freshness.headline)),
    );
    freshness.append(
      headline,
      createElement(ownerDocument, "div", "", aggregate.freshness.counts ?? ""),
    );
    panel.append(freshness);
  }

  const grid = createElement(ownerDocument, "div", "memory-detail-grid");
  for (const card of Array.isArray(aggregate?.cards) ? aggregate.cards : []) {
    const cardElement = createElement(ownerDocument, "div", "memory-detail-card");
    cardElement.append(createElement(ownerDocument, "span", "memory-detail-label", card?.label ?? ""));
    const content = createElement(ownerDocument, "div", "memory-detail-text");
    const action = createActionButton(ownerDocument, {
      ...card?.action,
      text: card?.text ?? "",
    }, "memory-path-link");
    if (action) {
      content.append(action);
    } else {
      content.textContent = String(card?.text ?? "");
    }
    cardElement.append(content);
    grid.append(cardElement);
  }
  panel.append(grid);

  const actions = createElement(ownerDocument, "div", "goal-detail-actions");
  for (const action of Array.isArray(aggregate?.actions) ? aggregate.actions : []) {
    const button = createActionButton(ownerDocument, action, "button goal-inline-action-secondary");
    if (button) actions.append(button);
  }
  panel.append(actions);
  return panel;
}

export function createExperienceWorkbenchCandidateDetailView({
  t = (_key, _params, fallback) => fallback ?? "",
  formatDateTime = (value) => String(value ?? ""),
  formatCandidateTypeLabel = (value) => String(value ?? ""),
  formatCandidateStatusLabel = (value) => String(value ?? ""),
  extractCandidateContextTargets = () => ({}),
  resolveExperienceDisplayTaskId = (candidate) => String(candidate?.taskId ?? ""),
  summarizePathLabel = (value) => String(value ?? ""),
  isSynthesizedCandidate = () => false,
  getSynthesisSourceCount = () => 0,
  getSynthesisConsumedInfo = () => null,
} = {}) {
  function buildAggregate(candidate, compact = false) {
    if (!candidate || typeof candidate !== "object") return null;
    const snapshot = candidate.sourceTaskSnapshot && typeof candidate.sourceTaskSnapshot === "object"
      ? candidate.sourceTaskSnapshot
      : {};
    const contextTargets = extractCandidateContextTargets(candidate);
    const memoryLinks = Array.isArray(snapshot.memoryLinks) ? snapshot.memoryLinks : [];
    const artifactPaths = Array.isArray(snapshot.artifactPaths) ? snapshot.artifactPaths : [];
    const toolCalls = Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls : [];
    const learningReviewInput = candidate.learningReviewInput && typeof candidate.learningReviewInput === "object"
      ? candidate.learningReviewInput
      : null;
    const memoryFreshness = candidate.memoryFreshness && typeof candidate.memoryFreshness === "object"
      ? candidate.memoryFreshness
      : null;
    const skillFreshness = candidate.skillFreshness && typeof candidate.skillFreshness === "object"
      ? candidate.skillFreshness
      : null;
    const normalizedType = String(candidate.type ?? "").trim().toLowerCase() === "skill" ? "skill" : "method";
    const indexTab = normalizedType === "skill" ? "skills" : "methods";
    const indexLabel = normalizedType === "skill"
      ? t("experience.openSkillsTab", {}, "进入技能列表")
      : t("experience.openMethodsTab", {}, "进入方法列表");
    const displayTaskId = resolveExperienceDisplayTaskId(candidate);
    const publishedLabel = candidate.publishedPath
      ? summarizePathLabel(candidate.publishedPath)
      : t("experience.aggregateNotPublished", {}, "未发布");
    const learningHeadline = learningReviewInput?.summary?.headline
      || learningReviewInput?.summaryLines?.[0]
      || "-";
    const synthesized = isSynthesizedCandidate(candidate);
    const synthesisSourceCount = getSynthesisSourceCount(candidate);
    const synthesisConsumedInfo = getSynthesisConsumedInfo(candidate);
    const synthesisLabel = t(
      "experience.synthesizedBadge",
      { count: String(synthesisSourceCount || 0) },
      synthesisSourceCount > 0 ? `合成稿 · ${synthesisSourceCount}` : "合成稿",
    );
    const freshnessSummary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
      ? memoryFreshness.summary
      : null;
    const badges = [
      { text: formatCandidateTypeLabel(candidate.type) },
      { text: formatCandidateStatusLabel(candidate.status) },
    ];
    if (synthesized) badges.push({ text: synthesisLabel, tone: "synthesized" });
    if (candidate.publishedPath) {
      badges.push({ text: t("experience.listPublishedBadge", {}, "Published"), tone: "published" });
    }
    if (skillFreshness?.summary || skillFreshness?.status) {
      badges.push({ text: String(skillFreshness.summary || skillFreshness.status) });
    }

    const cards = [
      {
        label: t("experience.aggregateTaskLabel", {}, "来源任务"),
        text: displayTaskId || "-",
        action: displayTaskId ? { attribute: "data-open-task-id", value: displayTaskId } : null,
      },
      { label: t("experience.aggregateSlugLabel", {}, "标识"), text: candidate.slug || "-" },
      {
        label: t("experience.aggregatePublishedLabel", {}, "发布资产"),
        text: publishedLabel,
        action: candidate.publishedPath
          ? { attribute: "data-open-source", value: candidate.publishedPath }
          : null,
      },
      {
        label: t("experience.aggregateUpdatedLabel", {}, "最近更新时间"),
        text: formatDateTime(candidate.updatedAt || candidate.createdAt),
      },
      {
        label: t("experience.aggregateMemoriesLabel", {}, "来源记忆"),
        text: String(memoryLinks.length || contextTargets.memoryCount || 0),
      },
      {
        label: t("experience.aggregateArtifactsLabel", {}, "来源产物"),
        text: String(artifactPaths.length || contextTargets.artifactCount || 0),
      },
      { label: t("experience.aggregateToolCallsLabel", {}, "工具调用"), text: String(toolCalls.length) },
      { label: t("experience.aggregateLearningLabel", {}, "Learning / Review"), text: learningHeadline },
    ];
    if (!compact && synthesized) {
      cards.push(
        { label: t("experience.aggregateSynthesizedLabel", {}, "草稿来源"), text: synthesisLabel },
        { label: t("experience.aggregateSynthesisSourcesLabel", {}, "合成来源数"), text: String(synthesisSourceCount || 0) },
      );
    }
    if (!compact && synthesisConsumedInfo) {
      cards.push(
        {
          label: t("experience.aggregateConsumedLabel", {}, "已消化状态"),
          text: synthesisConsumedInfo.consumedByCandidateId
            ? t(
              "experience.aggregateConsumedValue",
              { id: synthesisConsumedInfo.consumedByCandidateId },
              `已被合成稿 ${synthesisConsumedInfo.consumedByCandidateId} 消化`,
            )
            : t("experience.aggregateConsumedFallback", {}, "已被后续合成消化"),
          action: synthesisConsumedInfo.consumedByCandidateId
            ? { attribute: "data-open-candidate-id", value: synthesisConsumedInfo.consumedByCandidateId }
            : null,
        },
        {
          label: t("experience.aggregateConsumedAtLabel", {}, "消化时间"),
          text: synthesisConsumedInfo.consumedAt ? formatDateTime(synthesisConsumedInfo.consumedAt) : "-",
        },
      );
    }

    const actions = [];
    if (contextTargets.sourceTaskId) {
      actions.push({
        text: t("memory.contextOpenSourceTask", {}, "打开来源任务"),
        attribute: "data-open-task-id",
        value: contextTargets.sourceTaskId,
      });
    }
    if (contextTargets.publishedPath) {
      actions.push({
        text: t("memory.contextOpenPublishedArtifact", {}, "打开发布产物"),
        attribute: "data-open-source",
        value: contextTargets.publishedPath,
      });
    }
    actions.push({ text: indexLabel, attribute: "data-open-tool-settings-tab", value: indexTab });

    return {
      title: t("experience.aggregateTitle", {}, "候选聚合视图"),
      summary: t("experience.aggregateSummary", {}, "把候选状态、来源上下文和已发布资产入口压缩到一处，便于快速决策。"),
      badges,
      freshness: freshnessSummary?.available && freshnessSummary.headline
        ? {
          headline: freshnessSummary.headline,
          counts: `review_required=${freshnessSummary.reviewRequiredCount || 0} / stale=${freshnessSummary.staleCount || 0} / superseded=${freshnessSummary.supersededCount || 0}`,
        }
        : null,
      cards,
      actions,
    };
  }

  return {
    render({ container, aggregate, candidate, compact = false, candidatePanel } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const resolvedAggregate = aggregate ?? buildAggregate(candidate, compact);
      if (!resolvedAggregate || !candidatePanel || typeof candidatePanel.nodeType !== "number") {
        container.replaceChildren();
        return;
      }
      const shell = createElement(ownerDocument, "div", "memory-detail-shell");
      shell.append(createAggregatePanel(ownerDocument, resolvedAggregate), candidatePanel);
      container.replaceChildren(shell);
    },
  };
}
