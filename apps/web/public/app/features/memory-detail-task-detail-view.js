import {
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
  button.disabled = Boolean(disabled);
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
  const body = createDetailText(ownerDocument, "");
  if (content && typeof content.nodeType === "number") body.append(content);
  else body.textContent = String(content ?? "");
  card.append(body);
  return card;
}

function appendSummaryHeader(ownerDocument, container, title, summary, badges = []) {
  const header = createElement(ownerDocument, "div", "goal-summary-header");
  const copy = createElement(ownerDocument, "div");
  copy.append(
    createElement(ownerDocument, "div", "goal-summary-title", title),
    createElement(ownerDocument, "div", "goal-summary-text", summary),
  );
  header.append(copy);
  if (badges.length) {
    const badgeList = createElement(ownerDocument, "div", "memory-detail-badges");
    badgeList.append(...badges);
    header.append(badgeList);
  }
  container.append(header);
}

function appendStringList(ownerDocument, container, values) {
  const safeValues = Array.isArray(values) ? values : [];
  if (!safeValues.length) return;
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const value of safeValues) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    item.append(createDetailText(ownerDocument, value));
    list.append(item);
  }
  container.append(list);
}

function appendSimpleCard(ownerDocument, container, label, value) {
  if (!value) return;
  container.append(createDetailCard(ownerDocument, label, value));
}

function appendTaskHeader(ownerDocument, shell, input) {
  const { task, goalId, goalDisplayName } = input;
  const header = createElement(ownerDocument, "div", "memory-detail-header");
  const copy = createElement(ownerDocument, "div");
  copy.append(createElement(
    ownerDocument,
    "div",
    "memory-detail-title",
    task.title || task.objective || task.summary || task.id,
  ));
  const meta = createElement(ownerDocument, "div", "memory-list-item-meta");
  meta.append(
    createElement(ownerDocument, "span", "", task.id),
    createElement(ownerDocument, "span", "", task.conversationId || "-"),
  );
  copy.append(meta);
  const badges = createElement(ownerDocument, "div", "memory-detail-badges");
  badges.append(
    createBadge(ownerDocument, task.status || "unknown"),
    createBadge(ownerDocument, task.source || "unknown"),
  );
  if (task.agentId) badges.append(createBadge(ownerDocument, task.agentId));
  if (goalId) badges.append(createBadge(ownerDocument, goalDisplayName, "memory-badge memory-badge-shared"));
  header.append(copy, badges);
  shell.append(header);
}

function appendContext(ownerDocument, shell, input, options) {
  const { task, goalId, goalDisplayName, contextTargets = {} } = input;
  const { t, summarizeSourcePath } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  appendSummaryHeader(
    ownerDocument,
    card,
    t("memory.contextSummaryTitle", {}, "上下文链"),
    t("memory.contextSummaryTaskText", {}, "把长期任务、会话、关联记忆与经验候选入口压缩到一处。"),
  );
  const badges = createElement(ownerDocument, "div", "memory-detail-badges");
  if (goalId) badges.append(createBadge(ownerDocument, goalDisplayName, "memory-badge memory-badge-shared"));
  if (task.conversationId) {
    badges.append(createBadge(
      ownerDocument,
      `${t("memory.contextConversation", {}, "会话")} ${summarizeSourcePath(task.conversationId)}`,
    ));
  }
  badges.append(
    createBadge(ownerDocument, `${t("memory.contextLinkedMemories", {}, "关联记忆")} ${Number(contextTargets.memoryCount) || 0}`),
    createBadge(ownerDocument, `${t("memory.contextCandidates", {}, "经验候选")} ${Number(contextTargets.candidateCount) || 0}`),
    createBadge(ownerDocument, `${t("memory.contextArtifacts", {}, "产物")} ${Number(contextTargets.artifactCount) || 0}`),
  );
  card.append(badges);

  const actions = createElement(ownerDocument, "div", "goal-detail-actions");
  if (goalId) {
    actions.append(
      createButton(ownerDocument, "button", t("memory.openGoal", {}, "Open Long Task"), { "data-open-goal-id": goalId }),
      createButton(ownerDocument, "button goal-inline-action-secondary", t("memory.filterTasksByGoal", {}, "Filter Tasks by Goal"), { "data-open-goal-tasks": goalId }),
    );
  }
  if (contextTargets.firstMemoryId) {
    actions.append(createButton(ownerDocument, "button goal-inline-action-secondary", t("memory.contextOpenFirstMemory", {}, "打开关联记忆"), { "data-open-memory-id": contextTargets.firstMemoryId }));
  }
  if (contextTargets.firstCandidateId) {
    actions.append(
      createButton(ownerDocument, "button goal-inline-action-secondary", t("memory.contextOpenFirstCandidate", {}, "打开经验候选"), { "data-open-candidate-id": contextTargets.firstCandidateId }),
      createButton(ownerDocument, "button goal-inline-action-secondary", t("memory.contextOpenFirstCandidateWorkbench", {}, "在经验能力中打开"), { "data-open-experience-candidate-id": contextTargets.firstCandidateId }),
    );
  }
  if (contextTargets.firstArtifactPath) {
    actions.append(createButton(ownerDocument, "button goal-inline-action-secondary", t("memory.contextOpenFirstArtifact", {}, "打开相关产物"), { "data-open-source": contextTargets.firstArtifactPath }));
  }
  card.append(actions);
  shell.append(card);
}

function appendTaskMetrics(ownerDocument, shell, input, options) {
  const { task, goalId, goalDisplayName, lastUsageAt } = input;
  const { t, formatDateTime, formatDuration, formatCount } = options;
  const metrics = createElement(ownerDocument, "div", "memory-detail-grid");
  metrics.append(
    createDetailCard(ownerDocument, t("memory.taskStartTime", {}, "Started At"), formatDateTime(task.startedAt)),
    createDetailCard(ownerDocument, t("memory.taskEndTime", {}, "Finished At"), formatDateTime(task.finishedAt)),
    createDetailCard(ownerDocument, t("memory.taskDuration", {}, "Duration"), formatDuration(task.durationMs)),
    createDetailCard(ownerDocument, "Token", formatCount(task.tokenTotal)),
  );
  if (goalId) metrics.append(createDetailCard(ownerDocument, "Goal", goalDisplayName));
  shell.append(metrics);

  const usedMethods = Array.isArray(task.usedMethods) ? task.usedMethods : [];
  const usedSkills = Array.isArray(task.usedSkills) ? task.usedSkills : [];
  const usage = createElement(ownerDocument, "div", "memory-detail-grid memory-detail-grid-usage");
  usage.append(
    createDetailCard(ownerDocument, t("memory.methodUsageCount", {}, "Method Usage Count"), formatCount(usedMethods.length)),
    createDetailCard(ownerDocument, t("memory.skillUsageCount", {}, "Skill Usage Count"), formatCount(usedSkills.length)),
    createDetailCard(ownerDocument, t("memory.statLastUsedAt", {}, "Last Used At"), formatDateTime(lastUsageAt)),
  );
  shell.append(usage);
}

function appendExperienceActions(ownerDocument, shell, task, pendingActionKey, t) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  appendSummaryHeader(
    ownerDocument,
    card,
    t("memory.experienceActionsTitle", {}, "经验候选操作"),
    t("memory.experienceActionsHint", {}, "从当前任务直接生成 method / skill candidate，并在右侧继续审核。"),
  );
  const actions = createElement(ownerDocument, "div", "goal-detail-actions");
  for (const type of ["method", "skill"]) {
    const busy = pendingActionKey === `generate:${type}:${task.id}`;
    actions.append(createButton(
      ownerDocument,
      "memory-usage-action-btn",
      busy
        ? t(type === "method" ? "memory.generateMethodCandidateBusy" : "memory.generateSkillCandidateBusy", {}, `生成 ${type} 中…`)
        : t(type === "method" ? "memory.generateMethodCandidate" : "memory.generateSkillCandidate", {}, `生成 ${type} candidate`),
      {
        "data-generate-experience-type": type,
        "data-generate-experience-task-id": task.id || "",
      },
      busy,
    ));
  }
  card.append(actions);
  shell.append(card);
}

function appendWorkRecap(ownerDocument, shell, workRecap) {
  if (!workRecap) return;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(
    createElement(ownerDocument, "span", "memory-detail-label", "Work Recap"),
    createDetailText(ownerDocument, workRecap.headline || "-"),
  );
  appendStringList(ownerDocument, card, workRecap.confirmedFacts);
  if (Array.isArray(workRecap.pendingActions) && workRecap.pendingActions.length) {
    card.append(createElement(ownerDocument, "div", "memory-detail-label", "待继续 / 下一步"));
    appendStringList(ownerDocument, card, workRecap.pendingActions);
  }
  if (Array.isArray(workRecap.blockers) && workRecap.blockers.length) {
    card.append(createElement(ownerDocument, "div", "memory-detail-label", "Blockers"));
    appendStringList(ownerDocument, card, workRecap.blockers);
  }
  shell.append(card);
}

function appendResumeContext(ownerDocument, shell, resumeContext) {
  if (!resumeContext) return;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", "Resume Context"));
  if (resumeContext.currentStopPoint) card.append(createDetailText(ownerDocument, `当前停点：${resumeContext.currentStopPoint}`));
  if (resumeContext.nextStep) card.append(createDetailText(ownerDocument, `下一步：${resumeContext.nextStep}`));
  appendStringList(ownerDocument, card, resumeContext.blockers);
  shell.append(card);
}

function appendSourceExplanation(ownerDocument, shell, input, t) {
  const {
    task,
    sourceExplanationItems = [],
    sourceExplanationLoading,
    sourceExplanationError,
    sourceExplanationUpdatedAt,
    hasLoadedSourceExplanation,
  } = input;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  const badges = [];
  if (hasLoadedSourceExplanation) {
    badges.push(createBadge(ownerDocument, t(
      "memory.taskSourceExplanationSourceCount",
      { count: String(sourceExplanationItems.length) },
      `来源 ${sourceExplanationItems.length}`,
    )));
  }
  if (sourceExplanationUpdatedAt) {
    badges.push(createBadge(ownerDocument, t(
      "memory.taskSourceExplanationUpdatedAt",
      { time: sourceExplanationUpdatedAt },
      `更新于 ${sourceExplanationUpdatedAt}`,
    )));
  }
  appendSummaryHeader(
    ownerDocument,
    card,
    t("memory.taskSourceExplanationTitle", {}, "来源解释"),
    t("memory.taskSourceExplanationHint", {}, "按需查看当前 stop / recap / recent activity 分别来自哪一层任务记忆。"),
    badges,
  );
  const actions = createElement(ownerDocument, "div", "goal-detail-actions");
  actions.append(createButton(
    ownerDocument,
    "button goal-inline-action-secondary",
    sourceExplanationLoading
      ? t("memory.taskSourceExplanationLoadingShort", {}, "正在读取来源…")
      : hasLoadedSourceExplanation
        ? t("memory.taskSourceExplanationReload", {}, "刷新来源解释")
        : t("memory.taskSourceExplanationLoad", {}, "查看来源解释"),
    {
      "data-load-task-source-explanation": task.id || "",
      "data-load-task-conversation-id": task.conversationId || "",
    },
    sourceExplanationLoading,
  ));
  card.append(actions);
  if (sourceExplanationError) card.append(createDetailText(ownerDocument, sourceExplanationError));
  if (sourceExplanationItems.length) {
    const list = createElement(ownerDocument, "div", "memory-inline-list");
    for (const item of sourceExplanationItems) {
      const row = createElement(ownerDocument, "div", "memory-inline-item");
      const head = createElement(ownerDocument, "div", "memory-inline-item-head");
      if (item?.label) head.append(createBadge(ownerDocument, item.label));
      if (item?.activityReference) {
        const badge = createBadge(ownerDocument, item.activityReference.badgeLabel);
        badge.title = String(item.activityReference.title ?? "");
        head.append(badge);
      }
      row.append(head);
      for (const preview of Array.isArray(item?.previews) ? item.previews : []) {
        row.append(createDetailText(ownerDocument, preview));
      }
      list.append(row);
    }
    card.append(list);
  } else {
    card.append(createDetailText(
      ownerDocument,
      sourceExplanationLoading
        ? t("memory.taskSourceExplanationLoading", {}, "正在读取 stop / recap 的来源…")
        : hasLoadedSourceExplanation
          ? t("memory.taskSourceExplanationEmpty", {}, "当前没有可展示的来源解释。")
          : t("memory.taskSourceExplanationEmptyIdle", {}, "需要时再点击查看来源解释。"),
    ));
  }
  shell.append(card);
}

function appendActivities(ownerDocument, shell, activities, options) {
  const { formatDateTime } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", `Activity / Worklog (${activities.length})`));
  if (!activities.length) {
    card.append(createDetailText(ownerDocument, "No activity records."));
    shell.append(card);
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const activity of activities) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    const head = createElement(ownerDocument, "div", "memory-inline-item-head");
    head.append(
      createBadge(ownerDocument, activity?.state || "completed"),
      createBadge(ownerDocument, activity?.kind || "activity"),
      createBadge(ownerDocument, formatDateTime(activity?.happenedAt || activity?.recordedAt)),
    );
    item.append(head, createDetailText(ownerDocument, activity?.title || "-"));
    if (activity?.summary) item.append(createDetailText(ownerDocument, activity.summary));
    for (const [values, attribute] of [
      [activity?.files, "data-open-source"],
      [activity?.artifactPaths, "data-open-source"],
      [activity?.memoryChunkIds, "data-open-memory-id"],
    ]) {
      if (!Array.isArray(values) || !values.length) continue;
      const actions = createDetailText(ownerDocument, "");
      for (const value of values) {
        actions.append(createButton(ownerDocument, "memory-path-link", value, { [attribute]: value }));
      }
      item.append(actions);
    }
    if (activity?.error) item.append(createDetailText(ownerDocument, activity.error));
    list.append(item);
  }
  card.append(list);
  shell.append(card);
}

function appendSkillFreshness(ownerDocument, container, skillFreshness, actionInput, options) {
  if (!skillFreshness) return;
  const { t } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", t("memory.skillFreshnessTitle", {}, "Skill Freshness")));
  const badges = createElement(ownerDocument, "div", "memory-detail-badges");
  badges.append(createBadge(
    ownerDocument,
    formatSkillFreshnessStatusLabel(skillFreshness.status, t),
    `memory-badge ${getSkillFreshnessBadgeClass(skillFreshness.status)}`,
  ));
  if (skillFreshness.manualStaleMark) badges.append(createBadge(ownerDocument, t("memory.skillFreshnessManual", {}, "人工标记")));
  if (skillFreshness?.suggestion?.kind === "review_patch_candidate") badges.append(createBadge(ownerDocument, t("memory.skillFreshnessPatchHint", {}, "待补丁")));
  if (skillFreshness?.suggestion?.kind === "review_new_skill_candidate") badges.append(createBadge(ownerDocument, t("memory.skillFreshnessNewHint", {}, "待新增")));
  card.append(badges, createDetailText(ownerDocument, skillFreshness.summary || "-"));
  for (const signal of (Array.isArray(skillFreshness.signals) ? skillFreshness.signals : []).slice(0, 2)) {
    card.append(createDetailText(ownerDocument, signal?.summary || "-"));
  }
  if (skillFreshness?.suggestion?.summary) card.append(createDetailText(ownerDocument, skillFreshness.suggestion.summary));

  const sourceCandidateId = String(actionInput.sourceCandidateId || "").trim();
  const skillKey = String(actionInput.skillKey || "").trim();
  const patchCandidateId = skillFreshness?.suggestion?.kind === "review_patch_candidate"
    ? String(skillFreshness.suggestion.candidateId || "").trim()
    : "";
  if (sourceCandidateId || skillKey || patchCandidateId) {
    const actions = createElement(ownerDocument, "div", "goal-detail-actions");
    if (sourceCandidateId || skillKey) {
      const manualStale = Boolean(skillFreshness.manualStaleMark);
      actions.append(createButton(
        ownerDocument,
        "memory-usage-action-btn",
        actionInput.staleBusy
          ? t("memory.skillFreshnessUpdating", {}, "更新中…")
          : manualStale
            ? t("memory.skillFreshnessClearStale", {}, "取消 stale")
            : t("memory.skillFreshnessMarkStale", {}, "标记 stale"),
        {
          "data-skill-freshness-stale-action": manualStale ? "clear" : "mark",
          "data-skill-freshness-source-candidate-id": sourceCandidateId,
          "data-skill-freshness-skill-key": skillKey,
          "data-skill-freshness-task-id": actionInput.taskId || "",
          "data-skill-freshness-candidate-id": actionInput.candidateId || "",
        },
        actionInput.staleBusy,
      ));
    }
    if (patchCandidateId) {
      actions.append(createButton(ownerDocument, "memory-usage-action-btn", t("memory.skillFreshnessOpenPatchCandidate", {}, "打开 patch candidate"), { "data-open-candidate-id": patchCandidateId }));
    }
    card.append(actions);
  }
  container.append(card);
}

function appendUsageItems(ownerDocument, card, items, assetType, input, options) {
  const { t, formatDateTime, formatCount, formatUsageVia } = options;
  if (!items.length) {
    card.append(createDetailText(ownerDocument, t("memory.noUsageRecords", { assetType }, `No ${assetType} usage records.`)));
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-usage-list");
  for (const item of items) {
    const sourceView = item?.sourceView || null;
    const skillFreshness = assetType === "skill" ? item?.skillFreshness || null : null;
    const freshnessTarget = skillFreshness?.sourceCandidateId || skillFreshness?.skillKey || "";
    const staleBusy = input.pendingActionKey === `skill-freshness:${freshnessTarget}:${skillFreshness?.manualStaleMark ? "active" : "stale"}`;
    const row = createElement(ownerDocument, "div", "memory-usage-item");
    const head = createElement(ownerDocument, "div", "memory-usage-item-head");
    head.append(createElement(ownerDocument, "div", "memory-usage-item-key", item?.assetKey || "-"));
    const actions = createElement(ownerDocument, "div", "memory-usage-item-actions");
    const sourceBadges = createElement(ownerDocument, "div", "memory-detail-badges");
    if (skillFreshness) {
      sourceBadges.append(createBadge(ownerDocument, formatSkillFreshnessStatusLabel(skillFreshness.status, t), `memory-badge ${getSkillFreshnessBadgeClass(skillFreshness.status)}`));
    }
    if (item?.sourceCandidateStatus) sourceBadges.append(createBadge(ownerDocument, item.sourceCandidateStatus));
    if (item?.sourceCandidateId) sourceBadges.append(createBadge(ownerDocument, `candidate ${item.sourceCandidateId}`));
    if (sourceView) sourceBadges.append(createBadge(ownerDocument, formatResidentSourceScopeLabel(sourceView), `memory-badge ${getResidentSourceBadgeClass(sourceView)}`));
    const usageBadges = createElement(ownerDocument, "div", "memory-detail-badges");
    usageBadges.append(
      createBadge(ownerDocument, formatUsageVia(item?.usedVia)),
      createBadge(ownerDocument, `${t("memory.usageCountTotal", {}, "Total")} ${formatCount(item?.usageCount)}`),
    );
    actions.append(sourceBadges, usageBadges);
    if (item?.sourceCandidateId) actions.append(createButton(ownerDocument, "memory-usage-action-btn", t("memory.openCandidate", {}, "Candidate"), { "data-open-candidate-id": item.sourceCandidateId }));
    if (item?.sourceCandidateTaskId) actions.append(createButton(ownerDocument, "memory-usage-action-btn", t("memory.usageSourceTask", {}, "Source Task"), { "data-open-task-id": item.sourceCandidateTaskId }));
    if (item?.sourceCandidatePublishedPath) actions.append(createButton(ownerDocument, "memory-usage-action-btn", t("memory.openArtifact", {}, "Open Artifact"), { "data-open-source": item.sourceCandidatePublishedPath }));
    if (item?.lastUsedTaskId && item.lastUsedTaskId !== item.taskId) actions.append(createButton(ownerDocument, "memory-usage-action-btn", t("memory.usageRecentTask", {}, "Recent Task"), { "data-open-task-id": item.lastUsedTaskId }));
    actions.append(createButton(
      ownerDocument,
      "memory-usage-action-btn",
      input.pendingUsageRevokeId === item?.usageId
        ? t("memory.usageRevoking", {}, "Revoking…")
        : t("memory.usageRevoke", {}, "Revoke"),
      {
        "data-revoke-usage-id": item?.usageId || "",
        "data-revoke-task-id": item?.taskId || "",
        "data-revoke-asset-key": item?.assetKey || "",
      },
      input.pendingUsageRevokeId === item?.usageId,
    ));
    head.append(actions);
    row.append(head);

    const meta = createElement(ownerDocument, "div", "memory-usage-item-meta");
    const metaValues = [
      `usage ${item?.usageId || "-"}`,
      `${t("memory.usageUsedAtTask", {}, "Used in task")} ${formatDateTime(item?.createdAt)}`,
      `${t("memory.usageRecentGlobal", {}, "Global recent")} ${formatDateTime(item?.lastUsedAt || item?.createdAt)}`,
      skillFreshness?.summary || "",
      item?.sourceCandidateId ? `candidate ${item.sourceCandidateId}` : "",
      item?.sourceCandidateTitle || "",
      sourceView ? formatResidentSourceSummary(sourceView) : "",
      item?.sourceCandidateTaskId ? `${t("memory.usageSourceTask", {}, "Source Task")} ${item.sourceCandidateTaskId}` : "",
      item?.lastUsedTaskId ? `${t("memory.usageRecentTask", {}, "Recent Task")} ${item.lastUsedTaskId}` : "",
    ].filter(Boolean);
    meta.append(...metaValues.map((value) => createElement(ownerDocument, "span", "", value)));
    row.append(meta);
    if (skillFreshness) {
      appendSkillFreshness(ownerDocument, row, skillFreshness, {
        sourceCandidateId: skillFreshness.sourceCandidateId || item?.sourceCandidateId || "",
        skillKey: skillFreshness.skillKey || item?.assetKey || "",
        taskId: item?.taskId || "",
        candidateId: input.selectedCandidate?.taskId === item?.taskId
          ? input.selectedCandidate?.id || ""
          : item?.sourceCandidateId || "",
        staleBusy,
      }, options);
    }
    list.append(row);
  }
  card.append(list);
}

function appendUsageSection(ownerDocument, shell, items, assetType, input, options) {
  const { t } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(
    ownerDocument,
    "span",
    "memory-detail-label",
    `${t(assetType === "skill" ? "memory.skillUsageTitle" : "memory.methodUsageTitle", {}, assetType === "skill" ? "Skill Usage" : "Method Usage")} (${items.length})`,
  ));
  appendUsageItems(ownerDocument, card, items, assetType, input, options);
  shell.append(card);
}

function appendToolCalls(ownerDocument, shell, toolCalls, options) {
  const { t, formatDuration } = options;
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", `工具调用（${toolCalls.length}）`));
  if (!toolCalls.length) {
    card.append(createDetailText(ownerDocument, t("memory.noToolCalls", {}, "No tool call records.")));
    shell.append(card);
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const call of toolCalls) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    const head = createElement(ownerDocument, "div", "memory-inline-item-head");
    head.append(
      createBadge(ownerDocument, call?.toolName || "unknown"),
      createBadge(ownerDocument, call?.success ? "成功" : "失败"),
      createBadge(ownerDocument, formatDuration(call?.durationMs)),
    );
    item.append(head);
    if (call?.note) item.append(createDetailText(ownerDocument, call.note));
    list.append(item);
  }
  card.append(list);
  shell.append(card);
}

function appendMemoryLinks(ownerDocument, shell, memoryLinks, t) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", `${t("memory.linkedMemoriesTitle", {}, "Linked Memories")} (${memoryLinks.length})`));
  if (!memoryLinks.length) {
    card.append(createDetailText(ownerDocument, t("memory.noLinkedMemories", {}, "No linked memories.")));
    shell.append(card);
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const link of memoryLinks) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    const head = createElement(ownerDocument, "div", "memory-inline-item-head");
    head.append(createBadge(ownerDocument, link?.relation || "used"));
    if (link?.memoryType) head.append(createBadge(ownerDocument, link.memoryType));
    if (link?.sourceView) head.append(createBadge(ownerDocument, formatResidentSourceScopeLabel(link.sourceView), `memory-badge ${getResidentSourceBadgeClass(link.sourceView)}`));
    head.append(createButton(ownerDocument, "memory-path-link", link?.chunkId || "打开记忆", { "data-open-memory-id": link?.chunkId || "" }));
    item.append(head);
    if (link?.sourcePath) item.append(createButton(ownerDocument, "memory-path-link", link.sourcePath, { "data-open-source": link.sourcePath }));
    if (link?.snippet) item.append(createDetailText(ownerDocument, link.snippet));
    list.append(item);
  }
  card.append(list);
  shell.append(card);
}

function appendArtifacts(ownerDocument, shell, artifactPaths, t) {
  const card = createElement(ownerDocument, "div", "memory-detail-card");
  card.append(createElement(ownerDocument, "span", "memory-detail-label", `${t("memory.artifactsTitle", {}, "Artifacts")} (${artifactPaths.length})`));
  if (!artifactPaths.length) {
    card.append(createDetailText(ownerDocument, t("memory.noArtifacts", {}, "No artifact paths.")));
    shell.append(card);
    return;
  }
  const list = createElement(ownerDocument, "div", "memory-inline-list");
  for (const path of artifactPaths) {
    const item = createElement(ownerDocument, "div", "memory-inline-item");
    item.append(createButton(ownerDocument, "memory-path-link", path, { "data-open-source": path }));
    list.append(item);
  }
  card.append(list);
  shell.append(card);
}

export function createMemoryDetailTaskDetailView({
  t = (_key, _params, fallback) => fallback ?? "",
  formatDateTime = (value) => String(value ?? ""),
  formatDuration = (value) => String(value ?? ""),
  formatCount = (value) => String(value ?? ""),
  formatUsageVia = (value) => String(value ?? "manual"),
  summarizeSourcePath = (value) => String(value ?? ""),
} = {}) {
  const options = { t, formatDateTime, formatDuration, formatCount, formatUsageVia, summarizeSourcePath };

  return {
    render(input = {}) {
      const { container, task, compact = false, candidatePanel } = input;
      if (!container) return;
      if (!task) {
        container.replaceChildren();
        return;
      }
      const ownerDocument = container.ownerDocument ?? document;
      const shell = createElement(ownerDocument, "div", "memory-detail-shell");
      if (!compact && candidatePanel && typeof candidatePanel.nodeType === "number") shell.append(candidatePanel);
      appendTaskHeader(ownerDocument, shell, input);
      appendContext(ownerDocument, shell, input, options);
      appendTaskMetrics(ownerDocument, shell, input, options);
      appendExperienceActions(ownerDocument, shell, task, input.pendingActionKey || "", t);
      appendSimpleCard(ownerDocument, shell, "目标说明", task.objective);
      appendSimpleCard(ownerDocument, shell, "摘要", task.summary);
      appendSimpleCard(ownerDocument, shell, "结果", task.outcome);
      if (!compact) {
        appendWorkRecap(ownerDocument, shell, task.workRecap || null);
        appendResumeContext(ownerDocument, shell, task.resumeContext || null);
        appendSourceExplanation(ownerDocument, shell, input, t);
        appendSimpleCard(ownerDocument, shell, "复盘", task.reflection);
        appendActivities(ownerDocument, shell, Array.isArray(task.activities) ? task.activities : [], options);
        appendUsageSection(ownerDocument, shell, Array.isArray(task.usedMethods) ? task.usedMethods : [], "method", input, options);
        appendUsageSection(ownerDocument, shell, Array.isArray(task.usedSkills) ? task.usedSkills : [], "skill", input, options);
        appendToolCalls(ownerDocument, shell, Array.isArray(task.toolCalls) ? task.toolCalls : [], options);
        appendMemoryLinks(ownerDocument, shell, Array.isArray(task.memoryLinks) ? task.memoryLinks : [], t);
        appendArtifacts(ownerDocument, shell, Array.isArray(task.artifactPaths) ? task.artifactPaths : [], t);
      }
      container.replaceChildren(shell);
    },
  };
}
