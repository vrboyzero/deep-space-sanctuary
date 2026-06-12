import { isCompactGovernanceDetailMode } from "./governance-detail-mode.js";

export function createGoalsGovernancePanelFeature({
  refs,
  escapeHtml,
  formatDateTime,
  goalRuntimeFilePath,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function formatGovernanceStatus(status) {
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "pending" || normalized === "required" || normalized === "waiting_user") return "待处理";
    if (normalized === "approved" || normalized === "accepted") return "已通过";
    if (normalized === "rejected") return "已拒绝";
    if (normalized === "expired") return "已过期";
    if (normalized === "overdue") return "已逾期";
    if (normalized === "escalated") return "已升级";
    if (normalized === "sent") return "已发送";
    if (normalized === "failed" || normalized === "error") return "失败";
    return status;
  }

  function formatGovernanceTargetType(targetType) {
    const normalized = typeof targetType === "string" ? targetType.trim().toLowerCase() : "";
    if (!normalized) return "未知对象";
    if (normalized === "checkpoint") return "Checkpoint";
    if (normalized === "suggestion_review") return "建议评审";
    if (normalized === "template") return "模板";
    return targetType;
  }

  function isExperienceSuggestionType(suggestionType) {
    return suggestionType === "method_candidate" || suggestionType === "skill_candidate";
  }

  function renderGoalGovernanceFreshnessSummary(memoryFreshness) {
    const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
      ? memoryFreshness.summary
      : null;
    if (!summary?.available || !summary.headline) {
      return "";
    }
    return `
      <div class="tool-settings-policy-note" style="margin-bottom:12px;">
        <div><strong>治理 freshness：</strong>${escapeHtml(summary.headline)}</div>
        <div>review_required=${escapeHtml(String(summary.reviewRequiredCount || 0))} / stale=${escapeHtml(String(summary.staleCount || 0))} / superseded=${escapeHtml(String(summary.supersededCount || 0))}</div>
      </div>
    `;
  }

  function formatBridgeRuntimeState(runtimeState) {
    const normalized = typeof runtimeState === "string" ? runtimeState.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "active") return "活跃";
    if (normalized === "runtime-lost") return "运行态丢失";
    if (normalized === "orphaned") return "孤儿清理";
    if (normalized === "closed") return "已关闭";
    return runtimeState;
  }

  function formatBridgeCloseReason(closeReason) {
    const normalized = typeof closeReason === "string" ? closeReason.trim().toLowerCase() : "";
    if (!normalized) return "未记录";
    if (normalized === "manual") return "手动关闭";
    if (normalized === "idle-timeout") return "空闲超时";
    if (normalized === "runtime-lost") return "运行态丢失";
    if (normalized === "orphan") return "孤儿清理";
    return closeReason;
  }

  function renderGoalBridgeGovernanceSection(summary) {
    if (!summary || typeof summary !== "object") return "";
    const items = Array.isArray(summary.items) ? summary.items : [];
    return `
      <div class="memory-detail-card" style="margin-bottom:12px;">
        <div class="goal-summary-title">Bridge 治理摘要</div>
        <div class="goal-summary-text">汇总最近 bridge 运行任务的运行态归因、阻塞原因与产物入口，便于在 Goal 治理层直接判断是否需要恢复或重拉起。</div>
        <div class="goal-summary-grid" style="margin-top:10px;">
          <div class="goal-summary-item"><span class="goal-summary-label">Bridge 节点</span><strong class="goal-summary-value">${escapeHtml(String(summary.bridgeNodeCount || 0))}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">活跃会话</span><strong class="goal-summary-value">${escapeHtml(String(summary.activeCount || 0))}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">运行态丢失</span><strong class="goal-summary-value">${escapeHtml(String(summary.runtimeLostCount || 0))}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">孤儿清理</span><strong class="goal-summary-value">${escapeHtml(String(summary.orphanedCount || 0))}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">结构化阻塞</span><strong class="goal-summary-value">${escapeHtml(String(summary.blockedCount || 0))}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">产物 / 转录</span><strong class="goal-summary-value">${escapeHtml(`${summary.artifactCount || 0} / ${summary.transcriptCount || 0}`)}</strong></div>
        </div>
        ${items.length ? `
          <div class="goal-tracking-list" style="margin-top:12px;">
            ${items.map((item) => `
              <div class="goal-tracking-item">
                <div class="goal-tracking-item-head">
                  <span class="goal-tracking-item-title">${escapeHtml(item.title || item.nodeId || "-")}</span>
                  ${item.runtimeState ? `<span class="memory-badge ${item.runtimeState === "active" ? "memory-badge-shared" : ""}">${escapeHtml(formatBridgeRuntimeState(item.runtimeState))}</span>` : ""}
                </div>
                <div class="memory-list-item-meta">
                  <span>${escapeHtml(item.nodeId || "-")}</span>
                  ${item.taskId ? `<span>${escapeHtml(item.taskId)}</span>` : ""}
                  ${item.closeReason ? `<span>${escapeHtml(formatBridgeCloseReason(item.closeReason))}</span>` : ""}
                </div>
                ${(Array.isArray(item.summaryLines) ? item.summaryLines : []).length || item.blockReason ? `
                  <div class="tool-settings-policy-note">
                    ${(Array.isArray(item.summaryLines) ? item.summaryLines : []).map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
                    ${item.blockReason ? `<div>阻塞归因: ${escapeHtml(item.blockReason)}</div>` : ""}
                  </div>
                ` : ""}
                ${item.artifactPath ? `<div class="memory-list-item-meta"><span>Bridge 产物</span><span>${escapeHtml(item.artifactPath)}</span></div>` : ""}
                ${item.transcriptPath ? `<div class="memory-list-item-meta"><span>Bridge Transcript</span><span>${escapeHtml(item.transcriptPath)}</span></div>` : ""}
                <div class="goal-detail-actions">
                  ${item.taskId ? `<button class="button goal-inline-action-secondary" data-open-task-id="${escapeHtml(item.taskId)}">打开运行任务</button>` : ""}
                  ${item.artifactPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(item.artifactPath)}">打开 bridge 产物</button>` : ""}
                  ${item.transcriptPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(item.transcriptPath)}">打开 bridge transcript</button>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        ` : '<div class="memory-viewer-empty" style="margin-top:12px;">当前没有 bridge 治理摘要项。</div>'}
      </div>
    `;
  }

  function renderCommanderFocusSection(summary) {
    if (!summary || typeof summary !== "object") return "";
    const delegationResults = Array.isArray(summary.delegationResults) ? summary.delegationResults : [];
    const checkLines = Array.isArray(summary.checkLines) ? summary.checkLines : [];
    const reasons = Array.isArray(summary.reasons) ? summary.reasons : [];
    const workOrderPaths = Array.isArray(summary.workOrderPaths) ? summary.workOrderPaths : [];
    const reworkTargetAgentIds = Array.isArray(summary.reworkTargetAgentIds) ? summary.reworkTargetAgentIds : [];
    return `
      <div class="memory-detail-card" style="margin-bottom:12px;">
        <div class="goal-summary-title">Commander Review / Fan-in</div>
        <div class="goal-summary-text">聚合当前 focus commander 节点的 fan-in 摘要、收口建议、delegation lane 结果与 review/work-order 入口。</div>
        <div class="goal-summary-grid" style="margin-top:10px;">
          <div class="goal-summary-item"><span class="goal-summary-label">当前节点</span><strong class="goal-summary-value">${escapeHtml(summary.nodeTitle || summary.nodeId || "-")}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">治理模式</span><strong class="goal-summary-value">${escapeHtml(summary.governanceMode || "-")}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">执行模式</span><strong class="goal-summary-value">${escapeHtml(summary.executionMode || "-")}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">Review 状态</span><strong class="goal-summary-value">${escapeHtml(formatGovernanceStatus(summary.reviewStatus || "-"))}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">Final Approval</span><strong class="goal-summary-value">${escapeHtml(summary.finalApprovalMode || "-")}</strong></div>
          <div class="goal-summary-item"><span class="goal-summary-label">返工次数</span><strong class="goal-summary-value">${escapeHtml(String(summary.reworkRevisionCount || 0))}</strong></div>
        </div>
        <div class="memory-detail-badges" style="margin-top:10px;">
          ${summary.commanderAgentId ? `<span class="memory-badge">Commander: ${escapeHtml(summary.commanderAgentId)}</span>` : ""}
          ${summary.planId ? `<span class="memory-badge">Plan: ${escapeHtml(summary.planId)}</span>` : ""}
          ${summary.runId ? `<span class="memory-badge">Run: ${escapeHtml(summary.runId)}</span>` : ""}
        </div>
        ${summary.fanInSummary ? `<div class="memory-detail-text">${escapeHtml(summary.fanInSummary)}</div>` : ""}
        ${summary.nextAction ? `<div class="memory-detail-text">Next: ${escapeHtml(summary.nextAction)}</div>` : ""}
        ${summary.managerActionHint ? `<div class="memory-detail-text">Hint: ${escapeHtml(summary.managerActionHint)}</div>` : ""}
        ${summary.lastReworkReason ? `<div class="memory-detail-text">Last Rework: ${escapeHtml(summary.lastReworkReason)}</div>` : ""}
        ${summary.lastReworkAt ? `<div class="memory-list-item-meta"><span>Rework At</span><span>${escapeHtml(formatDateTime(summary.lastReworkAt))}</span></div>` : ""}
        ${summary.reworkContext?.quickSummary || summary.reworkContext?.historySummary ? `
          <div class="goal-summary-title" style="margin-top:12px;">Rework Context</div>
          ${summary.reworkContext?.quickSummary ? `<div class="memory-detail-text">Quick: ${escapeHtml(summary.reworkContext.quickSummary)}</div>` : ""}
          ${summary.reworkContext?.historySummary ? `<div class="memory-detail-text">${escapeHtml(summary.reworkContext.historySummary)}</div>` : ""}
        ` : ""}
        ${reworkTargetAgentIds.length ? `
          <div class="goal-summary-title" style="margin-top:12px;">Rework Targets</div>
          <div class="memory-detail-badges">
            ${reworkTargetAgentIds.map((item) => `<span class="memory-badge">${escapeHtml(item)}</span>`).join("")}
          </div>
        ` : ""}
        ${reasons.length ? `
          <div class="tool-settings-policy-note">
            ${reasons.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
          </div>
        ` : ""}
        ${checkLines.length ? `
          <div class="goal-summary-title" style="margin-top:12px;">Acceptance Checks</div>
          <div class="tool-settings-policy-note">
            ${checkLines.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
          </div>
        ` : ""}
        ${delegationResults.length ? `
          <div class="goal-summary-title" style="margin-top:12px;">Delegation Lanes</div>
          <div class="goal-tracking-list">
            ${delegationResults.map((item) => `
              <div class="goal-tracking-item">
                <div class="goal-tracking-item-head">
                  <span class="goal-tracking-item-title">${escapeHtml(item.agentId || "-")}${item.role ? ` · ${escapeHtml(item.role)}` : ""}</span>
                  ${item.status ? `<span class="memory-badge">${escapeHtml(item.status)}</span>` : ""}
                </div>
                ${item.summary ? `<div class="memory-list-item-snippet">${escapeHtml(item.summary)}</div>` : ""}
                <div class="memory-list-item-meta">
                  ${item.taskId ? `<span>${escapeHtml(item.taskId)}</span>` : ""}
                  ${item.outputPath ? `<span>${escapeHtml(item.outputPath)}</span>` : ""}
                </div>
                <div class="goal-detail-actions">
                  ${item.taskId ? `<button class="button goal-inline-action-secondary" data-open-task-id="${escapeHtml(item.taskId)}">打开运行任务</button>` : ""}
                  ${item.outputPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(item.outputPath)}">打开产物</button>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        ` : '<div class="memory-viewer-empty" style="margin-top:12px;">当前还没有可展示的 delegation lane 结果。</div>'}
        <div class="goal-detail-actions" style="margin-top:12px;">
          ${summary.reviewPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(summary.reviewPath)}">打开 review</button>` : ""}
          ${summary.commanderPlanPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(summary.commanderPlanPath)}">打开 commander plan</button>` : ""}
          ${workOrderPaths.map((item) => `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(item)}">打开 work-order</button>`).join("")}
        </div>
      </div>
    `;
  }

  function renderGoalReviewGovernancePanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    if (!panel) return;
    panel.innerHTML = '<div class="memory-viewer-empty">正在汇总 review governance / approval workflow …</div>';
  }

  function renderGoalReviewGovernancePanelError(message) {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    if (!panel) return;
    panel.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function renderGoalReviewGovernancePanel(goal, data) {
    const panel = goalsDetailEl?.querySelector("#goalGovernancePanel");
    if (!panel || !goal) return;
    if (!data) {
      panel.innerHTML = '<div class="memory-viewer-empty">当前还没有评审治理汇总。</div>';
      return;
    }
    const compactGovernanceDetailMode = isCompactGovernanceDetailMode();
    panel.innerHTML = `
      <div class="goal-summary-header">
        <div>
          <div class="goal-summary-title">评审治理 / 统一审批</div>
          <div class="goal-summary-text">在当前长期任务详情中汇总评审人、模板、建议评审、checkpoint 工作流与提醒状态。</div>
        </div>
        <div class="goal-detail-actions">
          <button class="button" data-goal-approval-scan="${escapeHtml(goal.id)}">执行审批扫描</button>
          <button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(data.notificationsPath || goalRuntimeFilePath(goal, "review-notifications.json"))}">打开通知记录</button>
          ${compactGovernanceDetailMode ? "" : `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(data.notificationDispatchesPath || goalRuntimeFilePath(goal, "review-notification-dispatches.json"))}">打开分发队列</button>`}
          ${compactGovernanceDetailMode ? "" : data.governanceConfigPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(data.governanceConfigPath)}">打开治理配置</button>` : ""}
        </div>
      </div>
      <div class="goal-summary-grid">
        <div class="goal-summary-item"><span class="goal-summary-label">待评审</span><strong class="goal-summary-value">${escapeHtml(String(data.workflowPendingCount))}</strong></div>
        <div class="goal-summary-item"><span class="goal-summary-label">评审逾期</span><strong class="goal-summary-value">${escapeHtml(String(data.workflowOverdueCount))}</strong></div>
        <div class="goal-summary-item"><span class="goal-summary-label">待处理 Checkpoint</span><strong class="goal-summary-value">${escapeHtml(String(data.checkpointWorkflowPendingCount))}</strong></div>
        <div class="goal-summary-item"><span class="goal-summary-label">Checkpoint 逾期</span><strong class="goal-summary-value">${escapeHtml(String(data.checkpointWorkflowOverdueCount))}</strong></div>
        ${compactGovernanceDetailMode ? "" : `<div class="goal-summary-item"><span class="goal-summary-label">评审人</span><strong class="goal-summary-value">${escapeHtml(String(data.reviewers.length))}</strong></div>`}
        ${compactGovernanceDetailMode ? "" : `<div class="goal-summary-item"><span class="goal-summary-label">模板</span><strong class="goal-summary-value">${escapeHtml(String(data.templates.length))}</strong></div>`}
        ${compactGovernanceDetailMode ? "" : `<div class="goal-summary-item"><span class="goal-summary-label">分发记录</span><strong class="goal-summary-value">${escapeHtml(String(data.notificationDispatchCounts?.total || data.notificationDispatches.length || 0))}</strong></div>`}
      </div>
      ${renderGoalGovernanceFreshnessSummary(data.memoryFreshness)}
      ${compactGovernanceDetailMode ? "" : renderCommanderFocusSection(data.commanderFocus)}
      ${compactGovernanceDetailMode ? "" : renderGoalBridgeGovernanceSection(data.bridgeGovernanceSummary)}
      ${!compactGovernanceDetailMode && data.learningReviewInput ? `
        <div class="memory-detail-card" style="margin-bottom:12px;">
          <div class="goal-summary-title">Learning / Review Input</div>
          <div class="memory-detail-badges">
            <span class="memory-badge">${escapeHtml(data.learningReviewInput.summary?.headline || "-")}</span>
          </div>
          ${(Array.isArray(data.learningReviewInput.summaryLines) ? data.learningReviewInput.summaryLines : []).slice(0, 4).map((line) => `
            <div class="memory-detail-text">${escapeHtml(line)}</div>
          `).join("")}
          ${(Array.isArray(data.learningReviewInput.nudges) ? data.learningReviewInput.nudges : []).slice(0, 4).map((line) => `
            <div class="memory-detail-text">Nudge: ${escapeHtml(line)}</div>
          `).join("")}
        </div>
      ` : ""}
      <div class="goal-tracking-columns">
        <div class="goal-tracking-column">
          <div class="goal-summary-title">待处理建议评审</div>
          ${data.actionableReviews.length ? `
            <div class="goal-tracking-list">
              ${data.actionableReviews.map((item) => `
                <div class="goal-tracking-item">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(item.title)}</span>
                    <span class="memory-badge">${escapeHtml(formatGovernanceStatus(item.status))}</span>
                  </div>
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(item.id)}</span>
                    <span>${escapeHtml(item.suggestionType)}</span>
                    ${item.reviewer ? `<span>${escapeHtml(item.reviewer)}</span>` : ""}
                  </div>
                  <div class="goal-detail-actions">
                    ${isExperienceSuggestionType(item.suggestionType) ? `<button class="button goal-inline-action-secondary" data-goal-open-experience="true" data-goal-open-experience-candidate-id="${escapeHtml(item.experienceCandidateId || "")}" data-goal-open-experience-type="${escapeHtml(item.experienceType || "")}" data-goal-open-experience-query="${escapeHtml(item.title || item.suggestionId || item.id || "")}">${escapeHtml(t("goals.openExperienceWorkbench", {}, "在经验能力中打开"))}</button>` : ""}
                    <button class="button goal-inline-action" data-goal-suggestion-decision="accepted" data-goal-suggestion-goal-id="${escapeHtml(goal.id)}" data-goal-suggestion-review-id="${escapeHtml(item.id)}" data-goal-suggestion-type="${escapeHtml(item.suggestionType)}" data-goal-suggestion-id="${escapeHtml(item.suggestionId)}">通过</button>
                    <button class="button goal-inline-action-secondary" data-goal-suggestion-decision="rejected" data-goal-suggestion-goal-id="${escapeHtml(goal.id)}" data-goal-suggestion-review-id="${escapeHtml(item.id)}" data-goal-suggestion-type="${escapeHtml(item.suggestionType)}" data-goal-suggestion-id="${escapeHtml(item.suggestionId)}">拒绝</button>
                    <button class="button goal-inline-action-secondary" data-goal-suggestion-escalate="true" data-goal-suggestion-goal-id="${escapeHtml(goal.id)}" data-goal-suggestion-review-id="${escapeHtml(item.id)}" data-goal-suggestion-type="${escapeHtml(item.suggestionType)}" data-goal-suggestion-id="${escapeHtml(item.suggestionId)}">升级</button>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : '<div class="memory-viewer-empty">当前没有待处理的建议评审。</div>'}
          ${compactGovernanceDetailMode ? "" : `<div class="goal-summary-title">模板</div>`}
          ${compactGovernanceDetailMode ? "" : data.templates.length ? `
            <div class="goal-tracking-list">
              ${data.templates.map((item) => `
                <div class="goal-tracking-item">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(item.title)}</span>
                    <span class="memory-badge">${escapeHtml(item.mode)}</span>
                  </div>
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(item.id)}</span>
                    <span>${escapeHtml(item.target)}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : '<div class="memory-viewer-empty">当前组织治理还没有配置模板。</div>'}
        </div>
        <div class="goal-tracking-column">
          <div class="goal-summary-title">待处理 Checkpoint</div>
          ${data.actionableCheckpoints.length ? `
            <div class="goal-tracking-list">
              ${data.actionableCheckpoints.map((item) => `
                <div class="goal-tracking-item">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(item.title)}</span>
                    <span class="memory-badge ${item.status === "approved" ? "memory-badge-shared" : ""}">${escapeHtml(formatGovernanceStatus(item.status))}</span>
                  </div>
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(item.id)}</span>
                    ${item.nodeId ? `<span>${escapeHtml(item.nodeId)}</span>` : ""}
                    ${item.reviewer ? `<span>${escapeHtml(item.reviewer)}</span>` : ""}
                    ${item.slaAt ? `<span>${escapeHtml(formatDateTime(item.slaAt))}</span>` : ""}
                  </div>
                  <div class="goal-detail-actions">
                    <button class="button goal-inline-action" data-goal-checkpoint-action="approve" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">批准</button>
                    <button class="button goal-inline-action-secondary" data-goal-checkpoint-action="reject" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">拒绝</button>
                    <button class="button goal-inline-action-secondary" data-goal-checkpoint-escalate="true" data-goal-checkpoint-goal-id="${escapeHtml(goal.id)}" data-goal-checkpoint-node-id="${escapeHtml(item.nodeId || "")}" data-goal-checkpoint-id="${escapeHtml(item.id)}">升级</button>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : '<div class="memory-viewer-empty">当前没有待处理的 checkpoint 工作流。</div>'}
          ${compactGovernanceDetailMode ? "" : `<div class="goal-summary-title">最近通知</div>`}
          ${compactGovernanceDetailMode ? "" : data.notifications.length ? `
            <div class="goal-tracking-list">
              ${data.notifications.slice().reverse().slice(0, 6).map((item) => `
                <div class="goal-tracking-item">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(item.kind || "通知")}</span>
                    <span class="memory-badge">${escapeHtml(formatGovernanceTargetType(item.targetType))}</span>
                  </div>
                  <div class="memory-list-item-snippet">${escapeHtml(item.message || "")}</div>
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(item.targetId || "")}</span>
                    ${item.recipient ? `<span>${escapeHtml(item.recipient)}</span>` : ""}
                    ${item.createdAt ? `<span>${escapeHtml(formatDateTime(item.createdAt))}</span>` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          ` : '<div class="memory-viewer-empty">当前还没有提醒或升级通知。</div>'}
          ${compactGovernanceDetailMode ? "" : `<div class="goal-summary-title">分发渠道 / 队列</div>`}
          ${compactGovernanceDetailMode ? "" : data.notificationDispatches.length ? `
            <div class="memory-list-item-meta" style="margin-bottom:10px;">
              <span>按渠道：${escapeHtml(Object.entries(data.notificationDispatchCounts?.byChannel || {}).map(([key, value]) => `${key}=${value}`).join(" | ") || "无")}</span>
              <span>按状态：${escapeHtml(Object.entries(data.notificationDispatchCounts?.byStatus || {}).map(([key, value]) => `${formatGovernanceStatus(key)}=${value}`).join(" | ") || "无")}</span>
            </div>
            <div class="goal-tracking-list">
              ${data.notificationDispatches.slice().reverse().slice(0, 8).map((item) => `
                <div class="goal-tracking-item">
                  <div class="goal-tracking-item-head">
                    <span class="goal-tracking-item-title">${escapeHtml(item.channel)}</span>
                    <span class="memory-badge">${escapeHtml(formatGovernanceStatus(item.status))}</span>
                  </div>
                  <div class="memory-list-item-snippet">${escapeHtml(item.message || "")}</div>
                  <div class="memory-list-item-meta">
                    <span>${escapeHtml(item.targetType || "")}:${escapeHtml(item.targetId || "")}</span>
                    ${item.recipient ? `<span>${escapeHtml(item.recipient)}</span>` : ""}
                    ${item.routeKey ? `<span>${escapeHtml(item.routeKey)}</span>` : ""}
                    ${item.createdAt ? `<span>${escapeHtml(formatDateTime(item.createdAt))}</span>` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          ` : '<div class="memory-viewer-empty">当前还没有实际分发或队列记录。</div>'}
        </div>
      </div>
    `;
  }

  return {
    renderGoalReviewGovernancePanel,
    renderGoalReviewGovernancePanelError,
    renderGoalReviewGovernancePanelLoading,
  };
}
