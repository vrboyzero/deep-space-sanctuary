import {
  buildGoalCheckpointExplainabilityEntry,
  buildGoalDelegationResultExplainabilityEntry,
  buildGoalSubAgentExplainabilityEntries,
  buildGoalVerifierExplainabilityEntry,
} from "./goal-launch-explainability.js";

export function createGoalsCapabilityPanelFeature({
  refs,
  escapeHtml,
  formatDateTime,
  onOpenSourcePath,
  onOpenSubtask,
  onSaveGovernanceSettings,
  onCommanderDecision,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const { goalsDetailEl } = refs;

  function renderCapabilityFreshnessSummary(memoryFreshness) {
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

  function formatCapabilityMode(mode) {
    return mode === "multi_agent" ? "多 Agent" : "单 Agent";
  }

  function formatCapabilityRisk(level) {
    if (level === "high") return "高风险";
    if (level === "medium") return "中风险";
    return "低风险";
  }

  function formatGovernanceMode(mode) {
    if (mode === "commander") return "Commander";
    if (mode === "direct") return "Direct";
    return mode || "未设置";
  }

  function formatFinalApprovalMode(mode) {
    if (mode === "user_required") return "用户最终审批";
    if (mode === "agent_auto_complete") return "Agent 自动收口";
    return mode || "未设置";
  }

  function formatCapabilityStatus(status) {
    const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "planned") return "已计划";
    if (normalized === "orchestrated") return "已编排";
    if (normalized === "running" || normalized === "executing" || normalized === "in_progress") return "运行中";
    if (normalized === "success" || normalized === "completed" || normalized === "done") return "已完成";
    if (normalized === "failed" || normalized === "error") return "失败";
    if (normalized === "partial") return "部分完成";
    if (normalized === "pending") return "待处理";
    return status;
  }

  function formatCapabilityRecommendation(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized) return "未知";
    if (normalized === "approve" || normalized === "approved") return "建议通过";
    if (normalized === "reject" || normalized === "rejected") return "建议拒绝";
    if (normalized === "revise" || normalized === "needs_revision") return "建议修改";
    if (normalized === "retry") return "建议重试";
    return value;
  }

  function formatFindingSeverity(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized) return "低";
    if (normalized === "critical") return "严重";
    if (normalized === "high") return "高";
    if (normalized === "medium") return "中";
    if (normalized === "low") return "低";
    return value;
  }

  function renderCapabilityTagList(items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return `<div class="memory-viewer-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="goal-capability-tag-list">
        ${items.map((item) => `<span class="memory-badge">${escapeHtml(item)}</span>`).join("")}
      </div>
    `;
  }

  function renderCapabilityMetaList(items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return `<div class="memory-viewer-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="memory-list-item-meta">
        ${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    `;
  }

  function renderExplainabilityEntries(entries, emptyText) {
    if (!Array.isArray(entries) || !entries.length) {
      return `<div class="memory-viewer-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="goal-tracking-list">
        ${entries.map((entry) => `
          <div class="goal-tracking-item">
            <div class="goal-tracking-item-head">
              <span class="goal-tracking-item-title">${escapeHtml(entry.label || "launch")}</span>
            </div>
            <div class="tool-settings-policy-note">
              ${(Array.isArray(entry.lines) ? entry.lines : []).map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderCoordinatorResultList(items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return `<div class="memory-viewer-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="goal-tracking-list">
        ${items.map((item) => `
          <div class="goal-tracking-item">
            <div class="goal-tracking-item-head">
              <span class="goal-tracking-item-title">${escapeHtml(item.agentId || "未知 Agent")}${item.role ? ` · ${escapeHtml(item.role)}` : ""}</span>
              <div class="goal-checkpoint-meta">
                <span class="memory-badge ${item.status === "success" ? "memory-badge-shared" : item.status === "failed" ? "is-overdue" : ""}">${escapeHtml(formatCapabilityStatus(item.status))}</span>
              </div>
            </div>
            ${item.summary ? `<div class="memory-list-item-snippet">${escapeHtml(item.summary)}</div>` : ""}
            ${item.error ? `<div class="memory-list-item-snippet">${escapeHtml(item.error)}</div>` : ""}
            <div class="memory-list-item-meta">
              ${item.taskId ? `<span>任务 ${escapeHtml(item.taskId)}</span>` : ""}
              ${item.sessionId ? `<span>会话 ${escapeHtml(item.sessionId)}</span>` : ""}
              ${item.outputPath ? `<span>${escapeHtml(item.outputPath)}</span>` : ""}
            </div>
            ${item.explainability?.lines?.length ? `
              <div class="tool-settings-policy-note">
                ${item.explainability.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
              </div>
            ` : ""}
            <div class="memory-detail-badges">
              ${item.taskId ? `<button class="button goal-inline-action-secondary" data-open-subtask-id="${escapeHtml(item.taskId)}">打开子任务</button>` : ""}
              ${item.outputPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(item.outputPath)}">打开输出</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderSimpleList(items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return `<div class="memory-viewer-empty">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="goal-tracking-list">
        ${items.map((item) => `
          <div class="goal-tracking-item">
            <div class="memory-list-item-snippet">${escapeHtml(item)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function buildCommanderReworkPrefill(orchestration, acceptanceGate) {
    const revision = Number.isFinite(orchestration?.reworkRevisionCount) ? Number(orchestration.reworkRevisionCount) : 0;
    const lastReason = typeof orchestration?.lastReworkReason === "string" ? orchestration.lastReworkReason.trim() : "";
    const gateHint = typeof acceptanceGate?.managerActionHint === "string" ? acceptanceGate.managerActionHint.trim() : "";
    const gateSummary = typeof acceptanceGate?.summary === "string" ? acceptanceGate.summary.trim() : "";
    const gateReasons = Array.isArray(acceptanceGate?.reasons)
      ? acceptanceGate.reasons.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
      : [];
    const historyLines = [
      revision > 0 ? `上一轮返工次数：${revision}` : "",
      lastReason ? `上一轮返工原因：${lastReason}` : "",
      gateHint ? `当前 Gate Hint：${gateHint}` : "",
      gateSummary ? `当前 Gate Summary：${gateSummary}` : "",
      ...gateReasons.map((item) => `Gate Reason：${item}`),
    ].filter(Boolean);
    return {
      summary: gateHint || gateSummary || lastReason || "",
      note: historyLines.join("\n"),
      historyLines,
      gateOnlySummary: gateHint || gateSummary || "",
    };
  }

  function renderGoalCapabilityPanelLoading() {
    const panel = goalsDetailEl?.querySelector("#goalCapabilityPanel");
    if (!panel) return;
    panel.innerHTML = '<div class="memory-viewer-empty">正在读取 capability-plans.json …</div>';
  }

  function renderGoalCapabilityPanelError(message) {
    const panel = goalsDetailEl?.querySelector("#goalCapabilityPanel");
    if (!panel) return;
    panel.innerHTML = `<div class="memory-viewer-empty">${escapeHtml(message)}</div>`;
  }

  function bindCapabilityPanelActions(panel) {
    if (!panel) return;
    panel.querySelectorAll("[data-open-source]").forEach((node) => {
      node.addEventListener("click", () => {
        const sourcePath = node.getAttribute("data-open-source");
        if (!sourcePath) return;
        void onOpenSourcePath?.(sourcePath);
      });
    });
    panel.querySelectorAll("[data-open-subtask-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const taskId = node.getAttribute("data-open-subtask-id");
        if (!taskId) return;
        void onOpenSubtask?.(taskId);
      });
    });
    panel.querySelectorAll("[data-goal-capability-save]").forEach((node) => {
      node.addEventListener("click", async () => {
        const goalId = node.getAttribute("data-goal-id");
        const nodeId = node.getAttribute("data-node-id");
        if (!goalId || !nodeId) return;
        const scope = node.closest("[data-goal-governance-form]") || panel;
        const executionMode = scope.querySelector("[data-goal-capability-field='executionMode']")?.value || "";
        const governanceMode = scope.querySelector("[data-goal-capability-field='governanceMode']")?.value || "";
        const commanderAgentId = scope.querySelector("[data-goal-capability-field='commanderAgentId']")?.value || "";
        const preferredAgentsRaw = scope.querySelector("[data-goal-capability-field='preferredAgents']")?.value || "";
        const finalApprovalMode = scope.querySelector("[data-goal-capability-field='finalApprovalMode']")?.value || "";
        await onSaveGovernanceSettings?.(goalId, nodeId, {
          executionMode,
          governanceMode,
          commanderAgentId,
          preferredAgents: preferredAgentsRaw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          finalApprovalMode,
        });
      });
    });
    panel.querySelectorAll("[data-goal-commander-decision]").forEach((node) => {
      node.addEventListener("click", async () => {
        const goalId = node.getAttribute("data-goal-id");
        const nodeId = node.getAttribute("data-node-id");
        const decision = node.getAttribute("data-goal-commander-decision");
        if (!goalId || !nodeId || !decision) return;
        const scope = node.closest("[data-goal-commander-form]") || panel;
        const summary = scope.querySelector("[data-goal-capability-field='decisionSummary']")?.value || "";
        const note = scope.querySelector("[data-goal-capability-field='decisionNote']")?.value || "";
        const requireUserApproval = scope.querySelector("[data-goal-capability-field='requireUserApproval']")?.value || "";
        await onCommanderDecision?.(goalId, nodeId, {
          decision,
          summary,
          note,
          requireUserApproval: requireUserApproval === "agent_auto_complete"
            ? false
            : requireUserApproval === "user_required"
              ? true
              : undefined,
        });
      });
    });
    panel.querySelectorAll("[data-goal-commander-prefill]").forEach((node) => {
      node.addEventListener("click", () => {
        const mode = node.getAttribute("data-goal-commander-prefill");
        const scope = node.closest("[data-goal-commander-form]") || panel;
        const summaryEl = scope.querySelector("[data-goal-capability-field='decisionSummary']");
        const noteEl = scope.querySelector("[data-goal-capability-field='decisionNote']");
        if (!summaryEl || !noteEl) return;
        const historySummary = node.getAttribute("data-prefill-history-summary") || "";
        const historyNote = node.getAttribute("data-prefill-history-note") || "";
        const gateSummary = node.getAttribute("data-prefill-gate-summary") || "";
        if (mode === "history") {
          if (historySummary) summaryEl.value = historySummary;
          if (historyNote) noteEl.value = historyNote;
          return;
        }
        if (mode === "gate") {
          if (gateSummary) summaryEl.value = gateSummary;
        }
      });
    });
  }

  function renderGoalCapabilityPanel(goal, payload) {
    const panel = goalsDetailEl?.querySelector("#goalCapabilityPanel");
    if (!panel) return;
    const plans = Array.isArray(payload?.plans) ? payload.plans : [];
    const nodeMap = payload?.nodeMap && typeof payload.nodeMap === "object" ? payload.nodeMap : {};
    const planCount = plans.length;
    const orchestratedCount = plans.filter((plan) => plan.status === "orchestrated").length;
    const highRiskCount = plans.filter((plan) => plan.riskLevel === "high").length;
    const driftCount = plans.filter((plan) => plan.analysis?.status === "partial" || plan.analysis?.status === "diverged").length;
    const actualMethodCount = new Set(plans.flatMap((plan) => plan.actualUsage.methods)).size;
    const actualSkillCount = new Set(plans.flatMap((plan) => plan.actualUsage.skills)).size;
    const actualMcpCount = new Set(plans.flatMap((plan) => plan.actualUsage.mcpServers)).size;
    const preferredNodeIds = [goal?.activeNodeId, goal?.lastNodeId]
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean);
    const focusPlan = preferredNodeIds.map((nodeId) => plans.find((plan) => plan.nodeId === nodeId)).find(Boolean) || plans[0] || null;
    const recentPlans = plans.slice(0, 6);

    if (!planCount) {
      panel.innerHTML = `
        <div class="memory-viewer-empty">
          capability-plans.json 中还没有计划记录。可先在长期任务通道中执行
          <code>goal_capability_plan</code> / <code>goal_orchestrate</code>。
        </div>
      `;
      return;
    }

    const focusNodeTitle = focusPlan?.nodeId ? (nodeMap[focusPlan.nodeId] || focusPlan.nodeId) : "当前节点";
    const orchestration = focusPlan?.orchestration || {};
    const coordinationPlan = orchestration?.coordinationPlan || null;
    const rolePolicy = coordinationPlan?.rolePolicy || null;
    const acceptanceGate = orchestration?.acceptanceGate || null;
    const delegationResults = Array.isArray(orchestration?.delegationResults) ? orchestration.delegationResults : [];
    const verifierHandoff = orchestration?.verifierHandoff || null;
    const verifierResult = orchestration?.verifierResult || null;
    const coordinatorMeta = [
      coordinationPlan?.summary ? `计划：${coordinationPlan.summary}` : "",
      typeof orchestration?.claimed === "boolean" ? `已认领：${orchestration.claimed ? "是" : "否"}` : "",
      typeof orchestration?.delegated === "boolean" ? `已委派：${orchestration.delegated ? "是" : "否"}` : "",
      Number.isFinite(orchestration?.delegationCount) ? `委派数：${orchestration.delegationCount}` : "",
      Number.isFinite(coordinationPlan?.plannedDelegationCount) ? `计划委派：${coordinationPlan.plannedDelegationCount}` : "",
    ].filter(Boolean);
    const rolePolicyTags = rolePolicy ? [
      ...(Array.isArray(rolePolicy.selectedRoles) ? rolePolicy.selectedRoles.map((item) => `角色：${item}`) : []),
      rolePolicy.verifierRole ? `验证角色：${rolePolicy.verifierRole}` : "",
      rolePolicy.fanInStrategy ? `汇聚策略：${rolePolicy.fanInStrategy}` : "",
      ...(Array.isArray(rolePolicy.selectionReasons) ? rolePolicy.selectionReasons : []),
    ].filter(Boolean) : [];
    const fanInRows = verifierHandoff ? (
      Array.isArray(verifierHandoff.sourceAgentIds) && verifierHandoff.sourceAgentIds.length
        ? verifierHandoff.sourceAgentIds.map((agentId, index) => {
          const matchedResult = delegationResults.find((item) => item.agentId === agentId);
          const sourceTaskId = verifierHandoff.sourceTaskIds?.[index] || matchedResult?.taskId || "-";
          const verifierTaskId = verifierHandoff.verifierTaskId || "-";
          return `${agentId} -> ${sourceTaskId} -> ${verifierTaskId}`;
        })
        : [`主 Agent -> - -> ${verifierHandoff.verifierTaskId || "-"}`]
    ) : [];
    const verifierMeta = [
      verifierHandoff?.status ? `交接：${formatCapabilityStatus(verifierHandoff.status)}` : "",
      verifierHandoff?.verifierAgentId ? `Agent：${verifierHandoff.verifierAgentId}` : "",
      verifierHandoff?.verifierTaskId ? `任务：${verifierHandoff.verifierTaskId}` : "",
      verifierHandoff?.verifierSessionId ? `会话：${verifierHandoff.verifierSessionId}` : "",
      verifierResult?.status ? `结果：${formatCapabilityStatus(verifierResult.status)}` : "",
      verifierResult?.recommendation ? `建议：${formatCapabilityRecommendation(verifierResult.recommendation)}` : "",
      verifierResult?.generatedAt ? `生成于：${formatDateTime(verifierResult.generatedAt)}` : "",
    ].filter(Boolean);
    const verifierFindingRows = Array.isArray(verifierResult?.findings)
      ? verifierResult.findings.map((item) => `[${formatFindingSeverity(item.severity)}] ${item.summary || ""}`).filter(Boolean)
      : [];
    const orchestrationNotes = Array.isArray(orchestration?.notes) ? orchestration.notes : [];
    const reworkTargetAgentIds = Array.isArray(orchestration?.reworkTargetAgentIds) ? orchestration.reworkTargetAgentIds : [];
    const subAgentExplainabilityEntries = buildGoalSubAgentExplainabilityEntries(focusPlan, t);
    const verifierExplainabilityEntry = buildGoalVerifierExplainabilityEntry(focusPlan, t);
    const checkpointExplainabilityEntry = buildGoalCheckpointExplainabilityEntry(focusPlan, t);
    const governanceMeta = [
      `执行模式：${formatCapabilityMode(focusPlan.executionMode)}`,
      `治理模式：${formatGovernanceMode(focusPlan.governanceMode)}`,
      `Commander：${focusPlan.commanderAgentId || coordinationPlan?.managerAgentId || "(none)"}`,
      `Preferred Agents：${Array.isArray(focusPlan.preferredAgents) && focusPlan.preferredAgents.length ? focusPlan.preferredAgents.join(", ") : "(none)"}`,
      `Final Approval：${formatFinalApprovalMode(orchestration?.finalApprovalMode)}`,
      `Rework Revision：${typeof orchestration?.reworkRevisionCount === "number" ? orchestration.reworkRevisionCount : 0}`,
      orchestration?.lastReworkReason ? `Last Rework：${orchestration.lastReworkReason}` : "",
      orchestration?.lastReworkAt ? `Rework At：${formatDateTime(orchestration.lastReworkAt)}` : "",
    ].filter(Boolean);
    const commanderActionDisabled = focusPlan.governanceMode !== "commander";
    const reworkPrefill = buildCommanderReworkPrefill(orchestration, acceptanceGate);
    const freshnessSummaryHtml = renderCapabilityFreshnessSummary(payload?.memoryFreshness);

    panel.innerHTML = `
      ${freshnessSummaryHtml}
      <div class="goal-capability-stats">
        <div class="goal-summary-item">
          <span class="goal-summary-label">计划总数</span>
          <strong class="goal-summary-value">${escapeHtml(String(planCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">已编排</span>
          <strong class="goal-summary-value">${escapeHtml(String(orchestratedCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">高风险</span>
          <strong class="goal-summary-value">${escapeHtml(String(highRiskCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">偏差计划</span>
          <strong class="goal-summary-value">${escapeHtml(String(driftCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">实际方法</span>
          <strong class="goal-summary-value">${escapeHtml(String(actualMethodCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">实际技能</span>
          <strong class="goal-summary-value">${escapeHtml(String(actualSkillCount))}</strong>
        </div>
        <div class="goal-summary-item">
          <span class="goal-summary-label">实际 MCP</span>
          <strong class="goal-summary-value">${escapeHtml(String(actualMcpCount))}</strong>
        </div>
      </div>

      ${focusPlan ? `
        <div class="goal-capability-focus" data-goal-continuation-focus="node" data-goal-node-id="${escapeHtml(focusPlan.nodeId || "")}">
          <div class="goal-tracking-item-head">
            <div>
              <div class="goal-summary-title">当前重点计划</div>
              <div class="goal-summary-text">${escapeHtml(focusNodeTitle)} · ${escapeHtml(focusPlan.nodeId || focusPlan.id)}</div>
            </div>
            <div class="goal-checkpoint-meta">
              <span class="memory-badge ${focusPlan.status === "orchestrated" ? "memory-badge-shared" : ""}">${escapeHtml(formatCapabilityStatus(focusPlan.status))}</span>
              <span class="memory-badge">${escapeHtml(formatCapabilityMode(focusPlan.executionMode))}</span>
              <span class="memory-badge ${focusPlan.riskLevel === "high" ? "is-overdue" : ""}">${escapeHtml(formatCapabilityRisk(focusPlan.riskLevel))}</span>
              <span class="memory-badge ${focusPlan.analysis?.status === "diverged" ? "is-overdue" : focusPlan.analysis?.status === "aligned" ? "memory-badge-shared" : ""}">${escapeHtml(focusPlan.analysis?.status === "aligned" ? "已对齐" : focusPlan.analysis?.status === "diverged" ? "已偏离" : focusPlan.analysis?.status === "partial" ? "部分对齐" : "待分析")}</span>
            </div>
          </div>
          ${focusPlan.summary ? `<div class="memory-list-item-snippet">${escapeHtml(focusPlan.summary)}</div>` : ""}
          ${focusPlan.objective ? `<div class="memory-list-item-snippet">${escapeHtml(focusPlan.objective)}</div>` : ""}
          ${focusPlan.analysis?.summary ? `<div class="memory-list-item-snippet">${escapeHtml(focusPlan.analysis.summary)}</div>` : ""}
          <div class="memory-list-item-meta">
            <span>${escapeHtml(focusPlan.id)}</span>
            ${focusPlan.runId ? `<span>${escapeHtml(focusPlan.runId)}</span>` : ""}
            <span>${escapeHtml(formatDateTime(focusPlan.updatedAt || focusPlan.generatedAt))}</span>
            ${focusPlan.orchestratedAt ? `<span>已编排 ${escapeHtml(formatDateTime(focusPlan.orchestratedAt))}</span>` : ""}
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column">
              <div class="goal-summary-label">治理设置</div>
              ${renderCapabilityMetaList(
                governanceMeta,
                "当前没有额外治理元数据。",
              )}
              ${acceptanceGate?.summary ? `<div class="memory-list-item-snippet">${escapeHtml(`Acceptance Gate: ${acceptanceGate.status || "pending"} | ${acceptanceGate.summary}`)}</div>` : ""}
              ${Array.isArray(acceptanceGate?.reasons) && acceptanceGate.reasons.length ? `
                <div class="tool-settings-policy-note">
                  ${acceptanceGate.reasons.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
                </div>
              ` : ""}
              ${reworkTargetAgentIds.length ? `
                <div class="goal-summary-title" style="margin-top:12px;">Rework Targets</div>
                <div class="memory-detail-badges">
                  ${reworkTargetAgentIds.map((item) => `<span class="memory-badge">${escapeHtml(item)}</span>`).join("")}
                </div>
              ` : ""}
            </div>
            <div class="goal-capability-column" data-goal-governance-form="true">
              <div class="goal-summary-label">Node 级治理覆盖</div>
              <div class="tool-settings-policy-note">
                <div>Execution Mode</div>
                <select class="input" data-goal-capability-field="executionMode">
                  <option value="single_agent" ${focusPlan.executionMode === "single_agent" ? "selected" : ""}>single_agent</option>
                  <option value="multi_agent" ${focusPlan.executionMode === "multi_agent" ? "selected" : ""}>multi_agent</option>
                  <option value="multi_agent_parallel" ${focusPlan.executionMode === "multi_agent_parallel" ? "selected" : ""}>multi_agent_parallel</option>
                  <option value="multi_agent_sequential" ${focusPlan.executionMode === "multi_agent_sequential" ? "selected" : ""}>multi_agent_sequential</option>
                </select>
                <div>Governance Mode</div>
                <select class="input" data-goal-capability-field="governanceMode">
                  <option value="direct" ${focusPlan.governanceMode === "direct" ? "selected" : ""}>direct</option>
                  <option value="commander" ${focusPlan.governanceMode === "commander" ? "selected" : ""}>commander</option>
                </select>
                <div>Commander Agent ID</div>
                <input class="input" data-goal-capability-field="commanderAgentId" value="${escapeHtml(focusPlan.commanderAgentId || "")}" />
                <div>Preferred Agents</div>
                <input class="input" data-goal-capability-field="preferredAgents" value="${escapeHtml(Array.isArray(focusPlan.preferredAgents) ? focusPlan.preferredAgents.join(", ") : "")}" />
                <div>Final Approval Mode</div>
                <select class="input" data-goal-capability-field="finalApprovalMode">
                  <option value="user_required" ${orchestration?.finalApprovalMode === "user_required" ? "selected" : ""}>user_required</option>
                  <option value="agent_auto_complete" ${orchestration?.finalApprovalMode === "agent_auto_complete" ? "selected" : ""}>agent_auto_complete</option>
                </select>
              </div>
              <div class="memory-detail-badges">
                <button class="button" data-goal-capability-save="true" data-goal-id="${escapeHtml(goal?.id || "")}" data-node-id="${escapeHtml(focusPlan.nodeId || "")}">保存治理设置</button>
              </div>
            </div>
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column" data-goal-commander-form="true">
              <div class="goal-summary-label">Commander 最终决策</div>
              <div class="tool-settings-policy-note">
                <div>Summary</div>
                <input class="input" data-goal-capability-field="decisionSummary" value="${escapeHtml(reworkPrefill.summary || acceptanceGate?.summary || "")}" />
                <div>Note</div>
                <textarea class="input" rows="5" data-goal-capability-field="decisionNote">${escapeHtml(reworkPrefill.note || orchestration?.lastReworkReason || "")}</textarea>
                <div>Escalate Approval Mode</div>
                <select class="input" data-goal-capability-field="requireUserApproval">
                  <option value="">follow plan default</option>
                  <option value="user_required">user_required</option>
                  <option value="agent_auto_complete">agent_auto_complete</option>
                </select>
              </div>
              ${reworkPrefill.historyLines.length ? `
                <div class="tool-settings-policy-note">
                  ${reworkPrefill.historyLines.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
                </div>
              ` : ""}
              <div class="memory-detail-badges">
                <button
                  class="button goal-inline-action-secondary"
                  ${commanderActionDisabled ? "disabled" : ""}
                  data-goal-commander-prefill="history"
                  data-prefill-history-summary="${escapeHtml(reworkPrefill.summary)}"
                  data-prefill-history-note="${escapeHtml(reworkPrefill.note)}"
                  data-prefill-gate-summary="${escapeHtml(reworkPrefill.gateOnlySummary)}"
                >使用上轮返工上下文</button>
                <button
                  class="button goal-inline-action-secondary"
                  ${commanderActionDisabled ? "disabled" : ""}
                  data-goal-commander-prefill="gate"
                  data-prefill-history-summary="${escapeHtml(reworkPrefill.summary)}"
                  data-prefill-history-note="${escapeHtml(reworkPrefill.note)}"
                  data-prefill-gate-summary="${escapeHtml(reworkPrefill.gateOnlySummary)}"
                >使用 gate hint</button>
                <button class="button goal-inline-action-secondary" ${commanderActionDisabled ? "disabled" : ""} data-goal-commander-decision="accept" data-goal-id="${escapeHtml(goal?.id || "")}" data-node-id="${escapeHtml(focusPlan.nodeId || "")}">接受</button>
                <button class="button goal-inline-action-secondary" ${commanderActionDisabled ? "disabled" : ""} data-goal-commander-decision="rework" data-goal-id="${escapeHtml(goal?.id || "")}" data-node-id="${escapeHtml(focusPlan.nodeId || "")}">返工</button>
                <button class="button goal-inline-action-secondary" ${commanderActionDisabled ? "disabled" : ""} data-goal-commander-decision="escalate" data-goal-id="${escapeHtml(goal?.id || "")}" data-node-id="${escapeHtml(focusPlan.nodeId || "")}">升级</button>
              </div>
              ${commanderActionDisabled ? `<div class="memory-viewer-empty">当前节点不是 commander 治理模式，Commander 快捷操作不可用。</div>` : ""}
            </div>
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column">
              <div class="goal-summary-label">计划能力编排</div>
              ${renderCapabilityTagList(
                [
                  ...focusPlan.methods.map((item) => item.title || item.file),
                  ...focusPlan.skills.map((item) => item.name),
                  ...focusPlan.mcpServers.map((item) => item.serverId),
                  ...focusPlan.subAgents.map((item) => `${item.agentId}: ${item.objective}`),
                ],
                "当前计划还没有明确列出方法、技能、MCP 或子 Agent。",
              )}
            </div>
            <div class="goal-capability-column">
              <div class="goal-summary-label">实际使用</div>
              ${renderCapabilityTagList(
                [
                  ...focusPlan.actualUsage.methods.map((item) => `方法：${item}`),
                  ...focusPlan.actualUsage.skills.map((item) => `技能：${item}`),
                  ...focusPlan.actualUsage.mcpServers.map((item) => `MCP：${item}`),
                ],
                "当前还没有采集到实际使用情况。",
              )}
              ${focusPlan.actualUsage.toolNames.length ? `
                <div class="goal-capability-tool-list">
                  ${focusPlan.actualUsage.toolNames.map((item) => `<code>${escapeHtml(item)}</code>`).join("")}
                </div>
              ` : ""}
              ${focusPlan.actualUsage.updatedAt ? `
                <div class="memory-list-item-meta">
                  <span>使用更新时间</span>
                  <span>${escapeHtml(formatDateTime(focusPlan.actualUsage.updatedAt))}</span>
                </div>
              ` : ""}
            </div>
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column">
              <div class="goal-summary-label">推理 / 检索提示</div>
              ${renderCapabilityTagList(
                [...focusPlan.reasoning, ...focusPlan.queryHints.map((item) => `提示：${item}`)],
                "当前计划没有额外的推理或检索提示。",
              )}
            </div>
            <div class="goal-capability-column">
              <div class="goal-summary-label">风险 / Checkpoint / 缺口</div>
              ${renderCapabilityTagList(
                [
                  focusPlan.checkpoint.required ? "需要 Checkpoint" : "可选 Checkpoint",
                  `审批模式：${focusPlan.checkpoint.approvalMode || "none"}`,
                  ...focusPlan.checkpoint.requiredRequestFields.map((item) => `请求字段：${item}`),
                  ...focusPlan.checkpoint.requiredDecisionFields.map((item) => `决策字段：${item}`),
                  focusPlan.checkpoint.suggestedReviewer ? `建议评审人：${focusPlan.checkpoint.suggestedReviewer}` : "",
                  focusPlan.checkpoint.suggestedReviewerRole ? `建议角色：${focusPlan.checkpoint.suggestedReviewerRole}` : "",
                  focusPlan.checkpoint.suggestedSlaHours ? `SLA：${focusPlan.checkpoint.suggestedSlaHours}h` : "",
                  focusPlan.checkpoint.suggestedNote ? `审批备注：${focusPlan.checkpoint.suggestedNote}` : "",
                  focusPlan.checkpoint.escalationMode && focusPlan.checkpoint.escalationMode !== "none" ? `升级：${focusPlan.checkpoint.escalationMode}` : "",
                  ...focusPlan.checkpoint.reasons,
                  ...focusPlan.gaps.map((item) => `缺口：${item}`),
                ].filter(Boolean),
                "当前计划没有额外风险说明或能力缺口。",
              )}
              <div class="goal-summary-label">Checkpoint Routing Explainability</div>
              ${renderExplainabilityEntries(
                checkpointExplainabilityEntry ? [checkpointExplainabilityEntry] : [],
                "当前 checkpoint 还没有额外 explainability 摘要。",
              )}
            </div>
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column">
              <div class="goal-summary-label">偏差分析</div>
              ${renderCapabilityTagList(
                (focusPlan.analysis?.deviations || []).map((item) => `${item.area}:${item.summary}`),
                "当前没有检测到明显偏差。",
              )}
            </div>
            <div class="goal-capability-column">
              <div class="goal-summary-label">建议</div>
              ${renderCapabilityTagList(
                focusPlan.analysis?.recommendations || [],
                "当前没有额外补充建议。",
              )}
            </div>
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column">
              <div class="goal-summary-label">协调器计划 / 策略</div>
              ${renderCapabilityMetaList(
                coordinatorMeta,
                "当前计划还没有协调器计划结果。",
              )}
              ${renderCapabilityTagList(
                rolePolicyTags,
                "当前没有额外角色策略或汇聚策略说明。",
              )}
              ${renderSimpleList(
                orchestrationNotes,
                "当前没有额外编排备注。",
              )}
              <div class="goal-summary-label">Sub-Agent Suggested Launch / Explainability</div>
              ${renderExplainabilityEntries(
                subAgentExplainabilityEntries,
                "当前子 Agent 计划还没有 launch explainability 摘要。",
              )}
            </div>
            <div class="goal-capability-column">
              <div class="goal-summary-label">验证器运行态 / 结果</div>
              ${renderCapabilityMetaList(
                verifierMeta,
                "当前没有验证器运行态或结果元数据。",
              )}
              ${verifierHandoff?.summary ? `<div class="memory-list-item-snippet">${escapeHtml(verifierHandoff.summary)}</div>` : ""}
              ${verifierResult?.summary ? `<div class="memory-list-item-snippet">${escapeHtml(verifierResult.summary)}</div>` : ""}
              <div class="memory-detail-badges">
                ${verifierHandoff?.verifierTaskId ? `<button class="button goal-inline-action-secondary" data-open-subtask-id="${escapeHtml(verifierHandoff.verifierTaskId)}">打开验证子任务</button>` : ""}
                ${verifierResult?.outputPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(verifierResult.outputPath)}">打开验证输出</button>` : verifierHandoff?.outputPath ? `<button class="button goal-inline-action-secondary" data-open-source="${escapeHtml(verifierHandoff.outputPath)}">打开验证输出</button>` : ""}
              </div>
              <div class="goal-summary-label">Verifier Handoff / Suggested Launch</div>
              ${renderExplainabilityEntries(
                verifierExplainabilityEntry ? [verifierExplainabilityEntry] : [],
                "当前验证器链路还没有 explainability 摘要。",
              )}
            </div>
          </div>

          <div class="goal-capability-columns">
            <div class="goal-capability-column">
              <div class="goal-summary-label">协调结果</div>
              ${renderCoordinatorResultList(
                delegationResults.map((item) => ({
                  ...item,
                  explainability: buildGoalDelegationResultExplainabilityEntry(focusPlan, item, t),
                })),
                "当前还没有委派结果。",
              )}
            </div>
            <div class="goal-capability-column">
              <div class="goal-summary-label">来源 -> 验证器汇聚</div>
              ${renderSimpleList(
                fanInRows,
                "当前没有来源到验证器的汇聚关系。",
              )}
              <div class="goal-summary-label">验证结论</div>
              ${renderSimpleList(
                verifierFindingRows,
                "当前还没有结构化验证结论。",
              )}
            </div>
          </div>
        </div>
      ` : ""}

      <div class="goal-tracking-column">
        <div class="goal-summary-title">最近能力计划</div>
        <div class="goal-tracking-list">
          ${recentPlans.map((plan) => {
            const nodeTitle = plan.nodeId ? (nodeMap[plan.nodeId] || plan.nodeId) : plan.id;
            return `
              <div class="goal-tracking-item" data-goal-continuation-focus="node" data-goal-node-id="${escapeHtml(plan.nodeId || "")}">
                <div class="goal-tracking-item-head">
                  <span class="goal-tracking-item-title">${escapeHtml(nodeTitle)}</span>
                  <div class="goal-checkpoint-meta">
                    <span class="memory-badge ${plan.status === "orchestrated" ? "memory-badge-shared" : ""}">${escapeHtml(formatCapabilityStatus(plan.status))}</span>
                  <span class="memory-badge">${escapeHtml(plan.executionMode === "multi_agent" ? "多 Agent" : plan.executionMode === "single_agent" ? "单 Agent" : plan.executionMode)}</span>
                  <span class="memory-badge ${plan.riskLevel === "high" ? "is-overdue" : ""}">${escapeHtml(plan.riskLevel === "high" ? "高风险" : plan.riskLevel === "medium" ? "中风险" : plan.riskLevel === "low" ? "低风险" : plan.riskLevel)}</span>
                  </div>
                </div>
                ${plan.summary ? `<div class="memory-list-item-snippet">${escapeHtml(plan.summary)}</div>` : ""}
                <div class="memory-list-item-meta">
                  <span>${escapeHtml(plan.id)}</span>
                  ${plan.nodeId ? `<span>${escapeHtml(plan.nodeId)}</span>` : ""}
                  <span>${escapeHtml(formatDateTime(plan.updatedAt || plan.generatedAt))}</span>
                </div>
                <div class="goal-checkpoint-meta">
                  <span class="memory-badge">方法 ${escapeHtml(String(plan.methods.length))}</span>
                  <span class="memory-badge">技能 ${escapeHtml(String(plan.skills.length))}</span>
                  <span class="memory-badge">MCP ${escapeHtml(String(plan.mcpServers.length))}</span>
                  <span class="memory-badge">实际 ${escapeHtml(String(
                    plan.actualUsage.methods.length + plan.actualUsage.skills.length + plan.actualUsage.mcpServers.length,
                  ))}</span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;

    bindCapabilityPanelActions(panel);
  }

  return {
    renderGoalCapabilityPanel,
    renderGoalCapabilityPanelError,
    renderGoalCapabilityPanelLoading,
  };
}
