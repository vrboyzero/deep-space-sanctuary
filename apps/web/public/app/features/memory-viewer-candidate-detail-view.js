import {
  formatResidentSourceConflictSummary,
  formatResidentSourceExplainability,
  formatResidentSourceScopeLabel,
  formatResidentSourceSummary,
  getResidentSourceBadgeClass,
} from "./memory-source-view.js";
import {
  formatSkillFreshnessStatusLabel,
  getSkillFreshnessBadgeClass,
} from "./skill-freshness-view.js";

function createElement(ownerDocument, tagName, className = "", text = undefined) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (typeof text !== "undefined") element.textContent = String(text ?? "");
  return element;
}

function createButton(ownerDocument, className, text, attributes = {}, disabled = false) {
  const button = createElement(ownerDocument, "button", className, text);
  button.type = "button";
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, String(value ?? ""));
  }
  button.disabled = disabled;
  return button;
}

function createBadge(ownerDocument, text, className = "memory-badge") {
  return createElement(ownerDocument, "span", className, text);
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

function createStrongText(ownerDocument, label, text) {
  const row = createDetailText(ownerDocument, "");
  row.append(createElement(ownerDocument, "strong", "", label), ownerDocument.createTextNode(text));
  return row;
}

function createSourceViewBadge(ownerDocument, sourceView) {
  return createBadge(
    ownerDocument,
    formatResidentSourceScopeLabel(sourceView),
    `memory-badge ${getResidentSourceBadgeClass(sourceView)}`,
  );
}

function appendContextAction(ownerDocument, container, text, attribute, value) {
  if (!value) return;
  container.append(createButton(
    ownerDocument,
    "button goal-inline-action-secondary",
    text,
    { [attribute]: value },
  ));
}

function appendMemoryLinks(ownerDocument, container, links, options) {
  const {
    t,
    formatMemoryTypeLabel,
  } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(
    ownerDocument,
    "span",
    "memory-detail-label",
    `${t("memory.linkedSourceMemories", { count: String(links.length) }, "Source Memories")} (${links.length})`,
  ));
  if (!links.length) {
    card.append(createDetailText(ownerDocument, t("memory.noSourceMemoryLinks", {}, "No source memory links.")));
    container.append(card);
    return;
  }

  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const link of links) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    const head = createElement(ownerDocument, "div", "memory-inline-item-head");
    head.append(createBadge(ownerDocument, link?.relation || t("memory.memoryLinkUsed", {}, "Used")));
    if (link?.memoryType) head.append(createBadge(ownerDocument, formatMemoryTypeLabel(link.memoryType)));
    if (link?.sourceView) head.append(createSourceViewBadge(ownerDocument, link.sourceView));
    head.append(createButton(
      ownerDocument,
      "memory-path-link",
      link?.chunkId || t("memory.openMemory", {}, "Open Memory"),
      { "data-open-memory-id": link?.chunkId || "" },
    ));
    item.append(head);
    if (link?.sourcePath) {
      item.append(createButton(
        ownerDocument,
        "memory-path-link",
        link.sourcePath,
        { "data-open-source": link.sourcePath },
      ));
    }
    if (link?.snippet) item.append(createDetailText(ownerDocument, link.snippet));
    if (link?.sourceView) {
      item.append(
        createDetailText(ownerDocument, formatResidentSourceExplainability(link.sourceView)),
        createDetailText(ownerDocument, formatResidentSourceConflictSummary(link.sourceView)),
      );
    }
    list.append(item);
  }
  card.append(list);
  container.append(card);
}

function appendArtifactPaths(ownerDocument, container, artifactPaths, t) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(
    ownerDocument,
    "span",
    "memory-detail-label",
    `${t("memory.sourceArtifacts", { count: String(artifactPaths.length) }, "Source Artifacts")} (${artifactPaths.length})`,
  ));
  if (!artifactPaths.length) {
    card.append(createDetailText(ownerDocument, t("memory.noSourceArtifacts", {}, "No source artifacts.")));
    container.append(card);
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const artifactPath of artifactPaths) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    item.append(createButton(
      ownerDocument,
      "memory-path-link",
      artifactPath,
      { "data-open-source": artifactPath },
    ));
    list.append(item);
  }
  card.append(list);
  container.append(card);
}

function appendToolCalls(ownerDocument, container, toolCalls, options) {
  const { t, formatDuration } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(
    ownerDocument,
    "span",
    "memory-detail-label",
    t("memory.toolCallsTitle", { count: String(toolCalls.length) }, `Tool Calls (${toolCalls.length})`),
  ));
  if (!toolCalls.length) {
    card.append(createDetailText(ownerDocument, t("memory.noToolCalls", {}, "No tool call records.")));
    container.append(card);
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const call of toolCalls) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    const head = createElement(ownerDocument, "div", "memory-inline-item-head");
    head.append(
      createBadge(ownerDocument, call?.toolName || t("memory.unknownTool", {}, "Unknown Tool")),
      createBadge(ownerDocument, call?.success
        ? t("memory.toolCallSuccess", {}, "Success")
        : t("memory.toolCallFailed", {}, "Failed")),
      createBadge(ownerDocument, formatDuration(call?.durationMs)),
    );
    item.append(head);
    if (call?.note) item.append(createDetailText(ownerDocument, call.note));
    list.append(item);
  }
  card.append(list);
  container.append(card);
}

function appendSkillFreshness(ownerDocument, container, candidate, pendingActionKey, t) {
  const skillFreshness = candidate?.skillFreshness;
  if (!skillFreshness || typeof skillFreshness !== "object") return;
  const card = createElement(ownerDocument, "div", "memory-detail-card memory-candidate-skill-freshness");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", t("memory.skillFreshnessTitle", {}, "Skill Freshness")));
  const badges = createElement(ownerDocument, "div", "memory-detail-badges");
  badges.append(createBadge(
    ownerDocument,
    formatSkillFreshnessStatusLabel(skillFreshness.status, t),
    `memory-badge ${getSkillFreshnessBadgeClass(skillFreshness.status)}`,
  ));
  if (skillFreshness.manualStaleMark) {
    badges.append(createBadge(ownerDocument, t("memory.skillFreshnessManual", {}, "人工标记")));
  }
  if (skillFreshness?.suggestion?.kind === "review_patch_candidate") {
    badges.append(createBadge(ownerDocument, t("memory.skillFreshnessPatchHint", {}, "待补丁")));
  }
  if (skillFreshness?.suggestion?.kind === "review_new_skill_candidate") {
    badges.append(createBadge(ownerDocument, t("memory.skillFreshnessNewHint", {}, "待新增")));
  }
  card.append(badges, createDetailText(ownerDocument, skillFreshness.summary || "-"));
  for (const signal of (Array.isArray(skillFreshness.signals) ? skillFreshness.signals : []).slice(0, 3)) {
    card.append(createElement(ownerDocument, "div", "memory-detail-text memory-candidate-skill-signal", signal?.summary || "-"));
  }
  if (skillFreshness?.suggestion?.summary) {
    card.append(createDetailText(ownerDocument, skillFreshness.suggestion.summary));
  }

  const sourceCandidateId = typeof skillFreshness.sourceCandidateId === "string"
    ? skillFreshness.sourceCandidateId.trim()
    : candidate.type === "skill"
      ? String(candidate.id || "").trim()
      : "";
  const skillKey = typeof skillFreshness.skillKey === "string" ? skillFreshness.skillKey.trim() : "";
  const patchCandidateId = skillFreshness?.suggestion?.kind === "review_patch_candidate"
    && typeof skillFreshness.suggestion.candidateId === "string"
    ? skillFreshness.suggestion.candidateId.trim()
    : "";
  if (sourceCandidateId || skillKey || patchCandidateId) {
    const actions = createElement(ownerDocument, "div", "goal-detail-actions");
    if (sourceCandidateId || skillKey) {
      const target = sourceCandidateId || skillKey;
      const manualStale = Boolean(skillFreshness.manualStaleMark);
      const staleBusy = pendingActionKey === `skill-freshness:${target}:${manualStale ? "active" : "stale"}`;
      actions.append(createButton(
        ownerDocument,
        "memory-usage-action-btn",
        staleBusy
          ? t("memory.skillFreshnessUpdating", {}, "更新中…")
          : manualStale
            ? t("memory.skillFreshnessClearStale", {}, "取消 stale")
            : t("memory.skillFreshnessMarkStale", {}, "标记 stale"),
        {
          "data-skill-freshness-stale-action": manualStale ? "clear" : "mark",
          "data-skill-freshness-source-candidate-id": sourceCandidateId,
          "data-skill-freshness-skill-key": skillKey,
          "data-skill-freshness-task-id": candidate.taskId || "",
          "data-skill-freshness-candidate-id": candidate.id || "",
        },
        staleBusy,
      ));
    }
    if (patchCandidateId) {
      actions.append(createButton(
        ownerDocument,
        "memory-usage-action-btn",
        t("memory.skillFreshnessOpenPatchCandidate", {}, "打开 patch candidate"),
        { "data-open-candidate-id": patchCandidateId },
      ));
    }
    card.append(actions);
  }
  container.append(card);
}

function appendMemoryFreshness(ownerDocument, container, memoryFreshness) {
  const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
    ? memoryFreshness.summary
    : null;
  if (!summary?.available || !summary.headline) return;
  const note = createElement(ownerDocument, "div", "tool-settings-policy-note memory-candidate-memory-freshness");
  const headline = createElement(ownerDocument, "div");
  headline.append(
    createElement(ownerDocument, "strong", "", "Memory Freshness："),
    ownerDocument.createTextNode(String(summary.headline)),
  );
  note.append(
    headline,
    createElement(
      ownerDocument,
      "div",
      "",
      `review_required=${Number(summary.reviewRequiredCount) || 0} / stale=${Number(summary.staleCount) || 0} / superseded=${Number(summary.supersededCount) || 0}`,
    ),
  );
  container.append(note);
}

function appendLearningReview(ownerDocument, container, learningReviewInput) {
  if (!learningReviewInput || typeof learningReviewInput !== "object") return;
  const card = createElement(ownerDocument, "div", "memory-detail-card memory-candidate-learning-review");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", "Learning / Review Input"));
  const badges = createElement(ownerDocument, "div", "memory-detail-badges");
  badges.append(createBadge(ownerDocument, learningReviewInput.summary?.headline || "-"));
  card.append(badges);
  for (const line of (Array.isArray(learningReviewInput.summaryLines) ? learningReviewInput.summaryLines : []).slice(0, 4)) {
    card.append(createElement(ownerDocument, "div", "memory-detail-text memory-candidate-learning-summary", line));
  }
  for (const line of (Array.isArray(learningReviewInput.nudges) ? learningReviewInput.nudges : []).slice(0, 4)) {
    card.append(createElement(ownerDocument, "div", "memory-detail-text memory-candidate-learning-nudge", `Nudge: ${line}`));
  }
  container.append(card);
}

export function createMemoryViewerCandidateDetailView({
  t = (_key, _params, fallback) => fallback ?? "",
  formatTaskStatusLabel = (value) => String(value ?? ""),
  formatTaskSourceLabel = (value) => String(value ?? ""),
  formatMemoryTypeLabel = (value) => String(value ?? ""),
  formatDateTime = (value) => String(value ?? "-"),
  formatDuration = (value) => String(value ?? "-"),
  summarizeSourcePath = (value) => String(value ?? ""),
} = {}) {
  function createPanel({
    ownerDocument,
    candidate,
    contextTargets = {},
    pendingActionKey = "",
    compact = false,
  } = {}) {
    if (!ownerDocument || !candidate) return null;
    const snapshot = candidate.sourceTaskSnapshot || {};
    const memoryLinks = Array.isArray(snapshot.memoryLinks) ? snapshot.memoryLinks : [];
    const artifactPaths = Array.isArray(snapshot.artifactPaths) ? snapshot.artifactPaths : [];
    const toolCalls = Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls : [];
    const sourceView = candidate.sourceView || null;
    const panel = createElement(ownerDocument, "div", "memory-detail-card");

    const head = createElement(ownerDocument, "div", "memory-inline-item-head");
    head.append(createElement(
      ownerDocument,
      "span",
      "memory-detail-label",
      t("memory.candidatePanelTitle", {}, "Candidate Detail Panel"),
    ));
    const badges = createElement(ownerDocument, "div", "memory-detail-badges");
    badges.append(
      createBadge(ownerDocument, candidate.type || "未知类型"),
      createBadge(ownerDocument, formatTaskStatusLabel(candidate.status)),
    );
    if (sourceView) badges.append(createSourceViewBadge(ownerDocument, sourceView));
    if (candidate.id) {
      badges.append(createButton(
        ownerDocument,
        "memory-usage-action-btn",
        t("memory.openCandidateWorkbench", {}, "经验能力"),
        { "data-open-experience-candidate-id": candidate.id },
      ));
    }
    badges.append(createButton(
      ownerDocument,
      "memory-usage-action-btn",
      t("memory.close", {}, "Close"),
      { "data-close-candidate-panel": "1" },
    ));
    head.append(badges);
    panel.append(head);

    const title = createDetailText(ownerDocument, "");
    title.append(createElement(
      ownerDocument,
      "strong",
      "",
      candidate.title || candidate.id || t("memory.candidateUntitled", {}, "Untitled Candidate"),
    ));
    panel.append(title);

    const contextCard = createElement(ownerDocument, "div", "memory-detail-card");
    const contextHeader = createElement(ownerDocument, "div", "goal-summary-header");
    const contextHeaderText = createElement(ownerDocument, "div");
    contextHeaderText.append(
      createElement(ownerDocument, "div", "goal-summary-title", t("memory.contextSummaryTitle", {}, "上下文链")),
      createElement(ownerDocument, "div", "goal-summary-text", t("memory.contextSummaryCandidateText", {}, "把来源任务、源记忆与产物入口压缩到一处，方便继续追溯。")),
    );
    contextHeader.append(contextHeaderText);
    contextCard.append(contextHeader);
    const contextBadges = createElement(ownerDocument, "div", "memory-detail-badges");
    if (contextTargets.sourceConversationId) {
      contextBadges.append(createBadge(
        ownerDocument,
        `${t("memory.contextConversation", {}, "会话")} ${summarizeSourcePath(contextTargets.sourceConversationId)}`,
      ));
    }
    contextBadges.append(
      createBadge(ownerDocument, `${t("memory.contextLinkedMemories", {}, "关联记忆")} ${Number(contextTargets.memoryCount) || 0}`),
      createBadge(ownerDocument, `${t("memory.contextArtifacts", {}, "产物")} ${Number(contextTargets.artifactCount) || 0}`),
    );
    contextCard.append(contextBadges);
    const contextActions = createElement(ownerDocument, "div", "goal-detail-actions");
    appendContextAction(ownerDocument, contextActions, t("memory.contextOpenSourceTask", {}, "打开来源任务"), "data-open-task-id", contextTargets.sourceTaskId);
    appendContextAction(ownerDocument, contextActions, t("memory.contextOpenFirstMemory", {}, "打开关联记忆"), "data-open-memory-id", contextTargets.firstMemoryId);
    appendContextAction(ownerDocument, contextActions, t("memory.contextOpenFirstArtifact", {}, "打开相关产物"), "data-open-source", contextTargets.firstArtifactPath);
    appendContextAction(ownerDocument, contextActions, t("memory.contextOpenPublishedArtifact", {}, "打开发布产物"), "data-open-source", contextTargets.publishedPath);
    contextCard.append(contextActions);
    panel.append(contextCard);

    const detailGrid = createElement(ownerDocument, "div", "memory-detail-grid");
    const taskContent = candidate.taskId
      ? createButton(ownerDocument, "memory-path-link", candidate.taskId, { "data-open-task-id": candidate.taskId })
      : "-";
    const publishedContent = candidate.publishedPath
      ? createButton(ownerDocument, "memory-path-link", candidate.publishedPath, { "data-open-source": candidate.publishedPath })
      : "-";
    detailGrid.append(
      createDetailCard(ownerDocument, "来源任务", taskContent),
      createDetailCard(ownerDocument, "标识", candidate.slug || "-"),
      createDetailCard(ownerDocument, "发布路径", publishedContent),
    );
    if (!compact) {
      detailGrid.append(
        createDetailCard(ownerDocument, "候选 ID", candidate.id || "-"),
        createDetailCard(ownerDocument, "来源视角", formatResidentSourceSummary(sourceView)),
        createDetailCard(ownerDocument, "来源解释", sourceView ? formatResidentSourceExplainability(sourceView) : "-"),
        createDetailCard(ownerDocument, "冲突说明", sourceView ? formatResidentSourceConflictSummary(sourceView) : "-"),
      );
    }
    panel.append(detailGrid);

    if (candidate.summary) panel.append(createDetailText(ownerDocument, candidate.summary));
    if (candidate.status === "draft") {
      const actions = createElement(ownerDocument, "div", "goal-detail-actions");
      const acceptBusy = pendingActionKey === `candidate:${candidate.id}:accept`;
      const rejectBusy = pendingActionKey === `candidate:${candidate.id}:reject`;
      actions.append(
        createButton(
          ownerDocument,
          "memory-usage-action-btn",
          acceptBusy
            ? t("memory.candidateReviewAccepting", {}, "接受中…")
            : t("memory.candidateAcceptAndPublish", {}, "接受并发布"),
          {
            "data-review-candidate-action": "accept",
            "data-review-candidate-id": candidate.id || "",
            "data-review-candidate-task-id": candidate.taskId || "",
          },
          acceptBusy,
        ),
        createButton(
          ownerDocument,
          "memory-usage-action-btn",
          rejectBusy
            ? t("memory.candidateReviewRejecting", {}, "拒绝中…")
            : t("memory.candidateReject", {}, "拒绝"),
          {
            "data-review-candidate-action": "reject",
            "data-review-candidate-id": candidate.id || "",
            "data-review-candidate-task-id": candidate.taskId || "",
          },
          rejectBusy,
        ),
      );
      panel.append(actions);
    }

    if (!compact) {
      appendSkillFreshness(ownerDocument, panel, candidate, pendingActionKey, t);
      appendMemoryFreshness(ownerDocument, panel, candidate.memoryFreshness);
      appendLearningReview(ownerDocument, panel, candidate.learningReviewInput);
      const snapshotCard = createElement(ownerDocument, "div", "memory-detail-card");
      snapshotCard.append(createElement(ownerDocument, "span", "memory-detail-label", t("memory.snapshotTitle", {}, "Source Snapshot")));
      const snapshotGrid = createElement(ownerDocument, "div", "memory-detail-grid");
      snapshotGrid.append(
        createDetailCard(ownerDocument, t("memory.detailConversationId", {}, "Conversation"), snapshot.conversationId || "-"),
        createDetailCard(ownerDocument, t("memory.snapshotStatus", {}, "Status"), formatTaskStatusLabel(snapshot.status) || "-"),
        createDetailCard(ownerDocument, t("memory.snapshotSource", {}, "Source"), formatTaskSourceLabel(snapshot.source) || "-"),
        createDetailCard(ownerDocument, t("memory.snapshotStartedAt", {}, "Started At"), formatDateTime(snapshot.startedAt)),
      );
      snapshotCard.append(snapshotGrid);
      if (snapshot.objective) snapshotCard.append(createStrongText(ownerDocument, `${t("memory.snapshotObjective", {}, "Objective")}：`, snapshot.objective));
      if (snapshot.summary) snapshotCard.append(createStrongText(ownerDocument, `${t("memory.snapshotSummary", {}, "Summary")}：`, snapshot.summary));
      panel.append(snapshotCard);
      appendMemoryLinks(ownerDocument, panel, memoryLinks, { t, formatMemoryTypeLabel });
      appendArtifactPaths(ownerDocument, panel, artifactPaths, t);
      appendToolCalls(ownerDocument, panel, toolCalls, { t, formatDuration });
    }

    const contentCard = createElement(ownerDocument, "div", "memory-detail-card");
    contentCard.append(
      createElement(ownerDocument, "span", "memory-detail-label", t("memory.candidateContent", {}, "Candidate Content")),
      createElement(ownerDocument, "pre", "memory-detail-pre", candidate.content || t("memory.noContent", {}, "No content")),
    );
    panel.append(contentCard);
    return panel;
  }

  return {
    createPanel,
    render({ container, ...input } = {}) {
      if (!container) return;
      const ownerDocument = container.ownerDocument ?? document;
      const panel = createPanel({ ownerDocument, ...input });
      if (!panel) {
        container.replaceChildren();
        return;
      }
      const shell = createElement(ownerDocument, "div", "memory-detail-shell");
      shell.append(panel);
      container.replaceChildren(shell);
    },
  };
}
