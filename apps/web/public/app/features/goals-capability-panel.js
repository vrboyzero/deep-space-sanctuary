import {
  buildGoalCheckpointExplainabilityEntry,
  buildGoalDelegationResultExplainabilityEntry,
  buildGoalSubAgentExplainabilityEntries,
  buildGoalVerifierExplainabilityEntry,
} from "./goal-launch-explainability.js";
import { createGoalsCapabilityPanelControlsFeature } from "./goals-capability-panel-controls.js";

function renderGoalCapabilityEmptyState(panel, message) {
  if (!panel) return;
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  empty.textContent = message;
  panel.replaceChildren(empty);
}

function renderGoalCapabilityNoPlanState(panel) {
  const ownerDocument = panel.ownerDocument ?? document;
  const empty = ownerDocument.createElement("div");
  empty.className = "memory-viewer-empty";
  const capabilityPlan = ownerDocument.createElement("code");
  capabilityPlan.textContent = "goal_capability_plan";
  const orchestrate = ownerDocument.createElement("code");
  orchestrate.textContent = "goal_orchestrate";
  empty.append(
    "capability-plans.json 中还没有计划记录。可先在长期任务通道中执行 ",
    capabilityPlan,
    " / ",
    orchestrate,
    "。",
  );
  panel.replaceChildren(empty);
}

function createCapabilityElement(ownerDocument, tagName, className = "", text) {
  const element = ownerDocument.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? "");
  return element;
}

function createCapabilityButton(ownerDocument, className, label, attributes = {}, disabled = false) {
  const button = createCapabilityElement(ownerDocument, "button", className, label);
  for (const [name, value] of Object.entries(attributes)) {
    button.setAttribute(name, String(value ?? ""));
  }
  button.disabled = disabled;
  return button;
}

function createCapabilitySelect(ownerDocument, field, values, selectedValue) {
  const select = createCapabilityElement(ownerDocument, "select", "input");
  select.setAttribute("data-goal-capability-field", field);
  for (const [value, label] of values) {
    const option = createCapabilityElement(ownerDocument, "option", "", label);
    option.value = value;
    select.append(option);
  }
  const normalizedValue = String(selectedValue ?? "");
  if (values.some(([value]) => value === normalizedValue)) {
    select.value = normalizedValue;
  }
  return select;
}

function createCapabilityInput(ownerDocument, field, value, { multiline = false } = {}) {
  const input = createCapabilityElement(ownerDocument, multiline ? "textarea" : "input", "input");
  input.setAttribute("data-goal-capability-field", field);
  if (multiline) input.rows = 5;
  input.value = String(value ?? "");
  return input;
}

function appendCapabilityMeta(ownerDocument, parent, values) {
  const meta = createCapabilityElement(ownerDocument, "div", "memory-list-item-meta");
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== "") {
      meta.append(createCapabilityElement(ownerDocument, "span", "", value));
    }
  }
  parent.append(meta);
  return meta;
}

function createCapabilityColumn(ownerDocument, label, attributes = {}) {
  const column = createCapabilityElement(ownerDocument, "div", "goal-capability-column");
  for (const [name, value] of Object.entries(attributes)) {
    column.setAttribute(name, String(value));
  }
  if (label) column.append(createCapabilityElement(ownerDocument, "div", "goal-summary-label", label));
  return column;
}

function createCapabilityColumns(ownerDocument, ...columns) {
  const row = createCapabilityElement(ownerDocument, "div", "goal-capability-columns");
  row.append(...columns);
  return row;
}

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
  const capabilityPanelControls = createGoalsCapabilityPanelControlsFeature({
    onOpenSourcePath,
    onOpenSubtask,
    onSaveGovernanceSettings,
    onCommanderDecision,
  });

  function renderCapabilityFreshnessSummary(ownerDocument, memoryFreshness) {
    const summary = memoryFreshness?.summary && typeof memoryFreshness.summary === "object"
      ? memoryFreshness.summary
      : null;
    if (!summary?.available || !summary.headline) {
      return null;
    }
    const note = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
    note.setAttribute("style", "margin-bottom:12px;");
    const headline = createCapabilityElement(ownerDocument, "div");
    headline.append(
      createCapabilityElement(ownerDocument, "strong", "", "治理 freshness："),
      createCapabilityElement(ownerDocument, "span", "", summary.headline),
    );
    note.append(headline, createCapabilityElement(
      ownerDocument,
      "div",
      "",
      `review_required=${summary.reviewRequiredCount || 0} / stale=${summary.staleCount || 0} / superseded=${summary.supersededCount || 0}`,
    ));
    return note;
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

  function renderCapabilityTagList(ownerDocument, items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return createCapabilityElement(ownerDocument, "div", "memory-viewer-empty", emptyText);
    }
    const list = createCapabilityElement(ownerDocument, "div", "goal-capability-tag-list");
    list.append(...items.map((item) => createCapabilityElement(ownerDocument, "span", "memory-badge", item)));
    return list;
  }

  function renderCapabilityMetaList(ownerDocument, items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return createCapabilityElement(ownerDocument, "div", "memory-viewer-empty", emptyText);
    }
    const list = createCapabilityElement(ownerDocument, "div", "memory-list-item-meta");
    list.append(...items.map((item) => createCapabilityElement(ownerDocument, "span", "", item)));
    return list;
  }

  function renderExplainabilityEntries(ownerDocument, entries, emptyText) {
    if (!Array.isArray(entries) || !entries.length) {
      return createCapabilityElement(ownerDocument, "div", "memory-viewer-empty", emptyText);
    }
    const list = createCapabilityElement(ownerDocument, "div", "goal-tracking-list");
    for (const entry of entries) {
      const item = createCapabilityElement(ownerDocument, "div", "goal-tracking-item");
      const head = createCapabilityElement(ownerDocument, "div", "goal-tracking-item-head");
      head.append(createCapabilityElement(ownerDocument, "span", "goal-tracking-item-title", entry.label || "launch"));
      const note = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
      note.append(...(Array.isArray(entry.lines) ? entry.lines : []).map((line) => createCapabilityElement(ownerDocument, "div", "", line)));
      item.append(head, note);
      list.append(item);
    }
    return list;
  }

  function renderCoordinatorResultList(ownerDocument, items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return createCapabilityElement(ownerDocument, "div", "memory-viewer-empty", emptyText);
    }
    const list = createCapabilityElement(ownerDocument, "div", "goal-tracking-list");
    for (const item of items) {
      const itemElement = createCapabilityElement(ownerDocument, "div", "goal-tracking-item");
      const head = createCapabilityElement(ownerDocument, "div", "goal-tracking-item-head");
      head.append(createCapabilityElement(
        ownerDocument,
        "span",
        "goal-tracking-item-title",
        `${item.agentId || "未知 Agent"}${item.role ? ` · ${item.role}` : ""}`,
      ));
      const status = createCapabilityElement(ownerDocument, "div", "goal-checkpoint-meta");
      status.append(createCapabilityElement(
        ownerDocument,
        "span",
        `memory-badge${item.status === "success" ? " memory-badge-shared" : item.status === "failed" ? " is-overdue" : ""}`,
        formatCapabilityStatus(item.status),
      ));
      head.append(status);
      itemElement.append(head);
      if (item.summary) itemElement.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", item.summary));
      if (item.error) itemElement.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", item.error));
      appendCapabilityMeta(ownerDocument, itemElement, [
        item.taskId ? `任务 ${item.taskId}` : "",
        item.sessionId ? `会话 ${item.sessionId}` : "",
        item.outputPath,
      ]);
      if (item.explainability?.lines?.length) {
        const note = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
        note.append(...item.explainability.lines.map((line) => createCapabilityElement(ownerDocument, "div", "", line)));
        itemElement.append(note);
      }
      const actions = createCapabilityElement(ownerDocument, "div", "memory-detail-badges");
      if (item.taskId) actions.append(createCapabilityButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开子任务",
        { "data-open-subtask-id": item.taskId },
      ));
      if (item.outputPath) actions.append(createCapabilityButton(
        ownerDocument,
        "button goal-inline-action-secondary",
        "打开输出",
        { "data-open-source": item.outputPath },
      ));
      itemElement.append(actions);
      list.append(itemElement);
    }
    return list;
  }

  function renderSimpleList(ownerDocument, items, emptyText) {
    if (!Array.isArray(items) || !items.length) {
      return createCapabilityElement(ownerDocument, "div", "memory-viewer-empty", emptyText);
    }
    const list = createCapabilityElement(ownerDocument, "div", "goal-tracking-list");
    for (const item of items) {
      const row = createCapabilityElement(ownerDocument, "div", "goal-tracking-item");
      row.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", item));
      list.append(row);
    }
    return list;
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
    if (!panel) {
      capabilityPanelControls.bind(null);
      return;
    }
    renderGoalCapabilityEmptyState(panel, "正在读取 capability-plans.json …");
    capabilityPanelControls.bind(panel);
  }

  function renderGoalCapabilityPanelError(message) {
    const panel = goalsDetailEl?.querySelector("#goalCapabilityPanel");
    if (!panel) {
      capabilityPanelControls.bind(null);
      return;
    }
    renderGoalCapabilityEmptyState(panel, message);
    capabilityPanelControls.bind(panel);
  }

  function bindCapabilityPanelActions(panel) {
    return capabilityPanelControls.bind(panel);
  }

  function renderGoalCapabilityPanel(goal, payload) {
    const panel = goalsDetailEl?.querySelector("#goalCapabilityPanel");
    if (!panel) {
      capabilityPanelControls.bind(null);
      return;
    }
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
      renderGoalCapabilityNoPlanState(panel);
      bindCapabilityPanelActions(panel);
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
    const ownerDocument = panel.ownerDocument ?? document;
    const fragment = ownerDocument.createDocumentFragment();
    const freshness = renderCapabilityFreshnessSummary(ownerDocument, payload?.memoryFreshness);
    if (freshness) fragment.append(freshness);

    const stats = createCapabilityElement(ownerDocument, "div", "goal-capability-stats");
    for (const [label, value] of [
      ["计划总数", planCount],
      ["已编排", orchestratedCount],
      ["高风险", highRiskCount],
      ["偏差计划", driftCount],
      ["实际方法", actualMethodCount],
      ["实际技能", actualSkillCount],
      ["实际 MCP", actualMcpCount],
    ]) {
      const item = createCapabilityElement(ownerDocument, "div", "goal-summary-item");
      item.append(
        createCapabilityElement(ownerDocument, "span", "goal-summary-label", label),
        createCapabilityElement(ownerDocument, "strong", "goal-summary-value", value),
      );
      stats.append(item);
    }
    fragment.append(stats);

    const focus = createCapabilityElement(ownerDocument, "div", "goal-capability-focus");
    focus.setAttribute("data-goal-continuation-focus", "node");
    focus.setAttribute("data-goal-node-id", String(focusPlan.nodeId || ""));
    const focusHead = createCapabilityElement(ownerDocument, "div", "goal-tracking-item-head");
    const focusCopy = createCapabilityElement(ownerDocument, "div");
    focusCopy.append(
      createCapabilityElement(ownerDocument, "div", "goal-summary-title", "当前重点计划"),
      createCapabilityElement(ownerDocument, "div", "goal-summary-text", `${focusNodeTitle} · ${focusPlan.nodeId || focusPlan.id}`),
    );
    const focusBadges = createCapabilityElement(ownerDocument, "div", "goal-checkpoint-meta");
    const analysisStatus = focusPlan.analysis?.status;
    focusBadges.append(
      createCapabilityElement(
        ownerDocument,
        "span",
        `memory-badge${focusPlan.status === "orchestrated" ? " memory-badge-shared" : ""}`,
        formatCapabilityStatus(focusPlan.status),
      ),
      createCapabilityElement(ownerDocument, "span", "memory-badge", formatCapabilityMode(focusPlan.executionMode)),
      createCapabilityElement(
        ownerDocument,
        "span",
        `memory-badge${focusPlan.riskLevel === "high" ? " is-overdue" : ""}`,
        formatCapabilityRisk(focusPlan.riskLevel),
      ),
      createCapabilityElement(
        ownerDocument,
        "span",
        `memory-badge${analysisStatus === "diverged" ? " is-overdue" : analysisStatus === "aligned" ? " memory-badge-shared" : ""}`,
        analysisStatus === "aligned" ? "已对齐" : analysisStatus === "diverged" ? "已偏离" : analysisStatus === "partial" ? "部分对齐" : "待分析",
      ),
    );
    focusHead.append(focusCopy, focusBadges);
    focus.append(focusHead);
    if (focusPlan.summary) focus.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", focusPlan.summary));
    if (focusPlan.objective) focus.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", focusPlan.objective));
    if (focusPlan.analysis?.summary) focus.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", focusPlan.analysis.summary));
    appendCapabilityMeta(ownerDocument, focus, [
      focusPlan.id,
      focusPlan.runId,
      formatDateTime(focusPlan.updatedAt || focusPlan.generatedAt),
      focusPlan.orchestratedAt ? `已编排 ${formatDateTime(focusPlan.orchestratedAt)}` : "",
    ]);

    const governanceColumn = createCapabilityColumn(ownerDocument, "治理设置");
    governanceColumn.append(renderCapabilityMetaList(ownerDocument, governanceMeta, "当前没有额外治理元数据。"));
    if (acceptanceGate?.summary) {
      governanceColumn.append(createCapabilityElement(
        ownerDocument,
        "div",
        "memory-list-item-snippet",
        `Acceptance Gate: ${acceptanceGate.status || "pending"} | ${acceptanceGate.summary}`,
      ));
    }
    if (Array.isArray(acceptanceGate?.reasons) && acceptanceGate.reasons.length) {
      const note = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
      note.append(...acceptanceGate.reasons.map((item) => createCapabilityElement(ownerDocument, "div", "", item)));
      governanceColumn.append(note);
    }
    if (reworkTargetAgentIds.length) {
      const title = createCapabilityElement(ownerDocument, "div", "goal-summary-title", "Rework Targets");
      title.setAttribute("style", "margin-top:12px;");
      const badges = createCapabilityElement(ownerDocument, "div", "memory-detail-badges");
      badges.append(...reworkTargetAgentIds.map((item) => createCapabilityElement(ownerDocument, "span", "memory-badge", item)));
      governanceColumn.append(title, badges);
    }

    const governanceForm = createCapabilityColumn(ownerDocument, "Node 级治理覆盖", { "data-goal-governance-form": "true" });
    const governanceFields = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
    governanceFields.append(
      createCapabilityElement(ownerDocument, "div", "", "Execution Mode"),
      createCapabilitySelect(ownerDocument, "executionMode", [
        ["single_agent", "single_agent"],
        ["multi_agent", "multi_agent"],
        ["multi_agent_parallel", "multi_agent_parallel"],
        ["multi_agent_sequential", "multi_agent_sequential"],
      ], focusPlan.executionMode),
      createCapabilityElement(ownerDocument, "div", "", "Governance Mode"),
      createCapabilitySelect(ownerDocument, "governanceMode", [
        ["direct", "direct"],
        ["commander", "commander"],
      ], focusPlan.governanceMode),
      createCapabilityElement(ownerDocument, "div", "", "Commander Agent ID"),
      createCapabilityInput(ownerDocument, "commanderAgentId", focusPlan.commanderAgentId || ""),
      createCapabilityElement(ownerDocument, "div", "", "Preferred Agents"),
      createCapabilityInput(ownerDocument, "preferredAgents", Array.isArray(focusPlan.preferredAgents) ? focusPlan.preferredAgents.join(", ") : ""),
      createCapabilityElement(ownerDocument, "div", "", "Final Approval Mode"),
      createCapabilitySelect(ownerDocument, "finalApprovalMode", [
        ["user_required", "user_required"],
        ["agent_auto_complete", "agent_auto_complete"],
      ], orchestration?.finalApprovalMode),
    );
    const saveActions = createCapabilityElement(ownerDocument, "div", "memory-detail-badges");
    saveActions.append(createCapabilityButton(ownerDocument, "button", "保存治理设置", {
      "data-goal-capability-save": "true",
      "data-goal-id": goal?.id || "",
      "data-node-id": focusPlan.nodeId || "",
    }));
    governanceForm.append(governanceFields, saveActions);
    focus.append(createCapabilityColumns(ownerDocument, governanceColumn, governanceForm));

    const commanderForm = createCapabilityColumn(ownerDocument, "Commander 最终决策", { "data-goal-commander-form": "true" });
    const commanderFields = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
    commanderFields.append(
      createCapabilityElement(ownerDocument, "div", "", "Summary"),
      createCapabilityInput(ownerDocument, "decisionSummary", reworkPrefill.summary || acceptanceGate?.summary || ""),
      createCapabilityElement(ownerDocument, "div", "", "Note"),
      createCapabilityInput(ownerDocument, "decisionNote", reworkPrefill.note || orchestration?.lastReworkReason || "", { multiline: true }),
      createCapabilityElement(ownerDocument, "div", "", "Escalate Approval Mode"),
      createCapabilitySelect(ownerDocument, "requireUserApproval", [
        ["", "follow plan default"],
        ["user_required", "user_required"],
        ["agent_auto_complete", "agent_auto_complete"],
      ], ""),
    );
    commanderForm.append(commanderFields);
    if (reworkPrefill.historyLines.length) {
      const note = createCapabilityElement(ownerDocument, "div", "tool-settings-policy-note");
      note.append(...reworkPrefill.historyLines.map((item) => createCapabilityElement(ownerDocument, "div", "", item)));
      commanderForm.append(note);
    }
    const commanderActions = createCapabilityElement(ownerDocument, "div", "memory-detail-badges");
    const prefillAttributes = {
      "data-prefill-history-summary": reworkPrefill.summary,
      "data-prefill-history-note": reworkPrefill.note,
      "data-prefill-gate-summary": reworkPrefill.gateOnlySummary,
    };
    commanderActions.append(
      createCapabilityButton(ownerDocument, "button goal-inline-action-secondary", "使用上轮返工上下文", {
        "data-goal-commander-prefill": "history",
        ...prefillAttributes,
      }, commanderActionDisabled),
      createCapabilityButton(ownerDocument, "button goal-inline-action-secondary", "使用 gate hint", {
        "data-goal-commander-prefill": "gate",
        ...prefillAttributes,
      }, commanderActionDisabled),
    );
    for (const [decision, label] of [["accept", "接受"], ["rework", "返工"], ["escalate", "升级"]]) {
      commanderActions.append(createCapabilityButton(ownerDocument, "button goal-inline-action-secondary", label, {
        "data-goal-commander-decision": decision,
        "data-goal-id": goal?.id || "",
        "data-node-id": focusPlan.nodeId || "",
      }, commanderActionDisabled));
    }
    commanderForm.append(commanderActions);
    if (commanderActionDisabled) {
      commanderForm.append(createCapabilityElement(
        ownerDocument,
        "div",
        "memory-viewer-empty",
        "当前节点不是 commander 治理模式，Commander 快捷操作不可用。",
      ));
    }
    focus.append(createCapabilityColumns(ownerDocument, commanderForm));

    const plannedColumn = createCapabilityColumn(ownerDocument, "计划能力编排");
    plannedColumn.append(renderCapabilityTagList(ownerDocument, [
      ...focusPlan.methods.map((item) => item.title || item.file),
      ...focusPlan.skills.map((item) => item.name),
      ...focusPlan.mcpServers.map((item) => item.serverId),
      ...focusPlan.subAgents.map((item) => `${item.agentId}: ${item.objective}`),
    ], "当前计划还没有明确列出方法、技能、MCP 或子 Agent。"));
    const actualColumn = createCapabilityColumn(ownerDocument, "实际使用");
    actualColumn.append(renderCapabilityTagList(ownerDocument, [
      ...focusPlan.actualUsage.methods.map((item) => `方法：${item}`),
      ...focusPlan.actualUsage.skills.map((item) => `技能：${item}`),
      ...focusPlan.actualUsage.mcpServers.map((item) => `MCP：${item}`),
    ], "当前还没有采集到实际使用情况。"));
    if (focusPlan.actualUsage.toolNames.length) {
      const tools = createCapabilityElement(ownerDocument, "div", "goal-capability-tool-list");
      tools.append(...focusPlan.actualUsage.toolNames.map((item) => createCapabilityElement(ownerDocument, "code", "", item)));
      actualColumn.append(tools);
    }
    if (focusPlan.actualUsage.updatedAt) {
      appendCapabilityMeta(ownerDocument, actualColumn, ["使用更新时间", formatDateTime(focusPlan.actualUsage.updatedAt)]);
    }
    focus.append(createCapabilityColumns(ownerDocument, plannedColumn, actualColumn));

    const reasoningColumn = createCapabilityColumn(ownerDocument, "推理 / 检索提示");
    reasoningColumn.append(renderCapabilityTagList(
      ownerDocument,
      [...focusPlan.reasoning, ...focusPlan.queryHints.map((item) => `提示：${item}`)],
      "当前计划没有额外的推理或检索提示。",
    ));
    const checkpointColumn = createCapabilityColumn(ownerDocument, "风险 / Checkpoint / 缺口");
    checkpointColumn.append(renderCapabilityTagList(ownerDocument, [
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
    ].filter(Boolean), "当前计划没有额外风险说明或能力缺口。"));
    checkpointColumn.append(
      createCapabilityElement(ownerDocument, "div", "goal-summary-label", "Checkpoint Routing Explainability"),
      renderExplainabilityEntries(
        ownerDocument,
        checkpointExplainabilityEntry ? [checkpointExplainabilityEntry] : [],
        "当前 checkpoint 还没有额外 explainability 摘要。",
      ),
    );
    focus.append(createCapabilityColumns(ownerDocument, reasoningColumn, checkpointColumn));

    const deviationsColumn = createCapabilityColumn(ownerDocument, "偏差分析");
    deviationsColumn.append(renderCapabilityTagList(
      ownerDocument,
      (focusPlan.analysis?.deviations || []).map((item) => `${item.area}:${item.summary}`),
      "当前没有检测到明显偏差。",
    ));
    const recommendationsColumn = createCapabilityColumn(ownerDocument, "建议");
    recommendationsColumn.append(renderCapabilityTagList(
      ownerDocument,
      focusPlan.analysis?.recommendations || [],
      "当前没有额外补充建议。",
    ));
    focus.append(createCapabilityColumns(ownerDocument, deviationsColumn, recommendationsColumn));

    const coordinatorColumn = createCapabilityColumn(ownerDocument, "协调器计划 / 策略");
    coordinatorColumn.append(
      renderCapabilityMetaList(ownerDocument, coordinatorMeta, "当前计划还没有协调器计划结果。"),
      renderCapabilityTagList(ownerDocument, rolePolicyTags, "当前没有额外角色策略或汇聚策略说明。"),
      renderSimpleList(ownerDocument, orchestrationNotes, "当前没有额外编排备注。"),
      createCapabilityElement(ownerDocument, "div", "goal-summary-label", "Sub-Agent Suggested Launch / Explainability"),
      renderExplainabilityEntries(ownerDocument, subAgentExplainabilityEntries, "当前子 Agent 计划还没有 launch explainability 摘要。"),
    );
    const verifierColumn = createCapabilityColumn(ownerDocument, "验证器运行态 / 结果");
    verifierColumn.append(renderCapabilityMetaList(ownerDocument, verifierMeta, "当前没有验证器运行态或结果元数据。"));
    if (verifierHandoff?.summary) verifierColumn.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", verifierHandoff.summary));
    if (verifierResult?.summary) verifierColumn.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", verifierResult.summary));
    const verifierActions = createCapabilityElement(ownerDocument, "div", "memory-detail-badges");
    if (verifierHandoff?.verifierTaskId) verifierActions.append(createCapabilityButton(
      ownerDocument,
      "button goal-inline-action-secondary",
      "打开验证子任务",
      { "data-open-subtask-id": verifierHandoff.verifierTaskId },
    ));
    const verifierOutputPath = verifierResult?.outputPath || verifierHandoff?.outputPath;
    if (verifierOutputPath) verifierActions.append(createCapabilityButton(
      ownerDocument,
      "button goal-inline-action-secondary",
      "打开验证输出",
      { "data-open-source": verifierOutputPath },
    ));
    verifierColumn.append(
      verifierActions,
      createCapabilityElement(ownerDocument, "div", "goal-summary-label", "Verifier Handoff / Suggested Launch"),
      renderExplainabilityEntries(
        ownerDocument,
        verifierExplainabilityEntry ? [verifierExplainabilityEntry] : [],
        "当前验证器链路还没有 explainability 摘要。",
      ),
    );
    focus.append(createCapabilityColumns(ownerDocument, coordinatorColumn, verifierColumn));

    const resultsColumn = createCapabilityColumn(ownerDocument, "协调结果");
    resultsColumn.append(renderCoordinatorResultList(
      ownerDocument,
      delegationResults.map((item) => ({
        ...item,
        explainability: buildGoalDelegationResultExplainabilityEntry(focusPlan, item, t),
      })),
      "当前还没有委派结果。",
    ));
    const fanInColumn = createCapabilityColumn(ownerDocument, "来源 -> 验证器汇聚");
    fanInColumn.append(
      renderSimpleList(ownerDocument, fanInRows, "当前没有来源到验证器的汇聚关系。"),
      createCapabilityElement(ownerDocument, "div", "goal-summary-label", "验证结论"),
      renderSimpleList(ownerDocument, verifierFindingRows, "当前还没有结构化验证结论。"),
    );
    focus.append(createCapabilityColumns(ownerDocument, resultsColumn, fanInColumn));
    fragment.append(focus);

    const recentColumn = createCapabilityElement(ownerDocument, "div", "goal-tracking-column");
    recentColumn.append(createCapabilityElement(ownerDocument, "div", "goal-summary-title", "最近能力计划"));
    const recentList = createCapabilityElement(ownerDocument, "div", "goal-tracking-list");
    for (const plan of recentPlans) {
      const item = createCapabilityElement(ownerDocument, "div", "goal-tracking-item");
      item.setAttribute("data-goal-continuation-focus", "node");
      item.setAttribute("data-goal-node-id", String(plan.nodeId || ""));
      const head = createCapabilityElement(ownerDocument, "div", "goal-tracking-item-head");
      const nodeTitle = plan.nodeId ? (nodeMap[plan.nodeId] || plan.nodeId) : plan.id;
      head.append(createCapabilityElement(ownerDocument, "span", "goal-tracking-item-title", nodeTitle));
      const badges = createCapabilityElement(ownerDocument, "div", "goal-checkpoint-meta");
      badges.append(
        createCapabilityElement(
          ownerDocument,
          "span",
          `memory-badge${plan.status === "orchestrated" ? " memory-badge-shared" : ""}`,
          formatCapabilityStatus(plan.status),
        ),
        createCapabilityElement(
          ownerDocument,
          "span",
          "memory-badge",
          plan.executionMode === "multi_agent" ? "多 Agent" : plan.executionMode === "single_agent" ? "单 Agent" : plan.executionMode,
        ),
        createCapabilityElement(
          ownerDocument,
          "span",
          `memory-badge${plan.riskLevel === "high" ? " is-overdue" : ""}`,
          plan.riskLevel === "high" ? "高风险" : plan.riskLevel === "medium" ? "中风险" : plan.riskLevel === "low" ? "低风险" : plan.riskLevel,
        ),
      );
      head.append(badges);
      item.append(head);
      if (plan.summary) item.append(createCapabilityElement(ownerDocument, "div", "memory-list-item-snippet", plan.summary));
      appendCapabilityMeta(ownerDocument, item, [plan.id, plan.nodeId, formatDateTime(plan.updatedAt || plan.generatedAt)]);
      const counts = createCapabilityElement(ownerDocument, "div", "goal-checkpoint-meta");
      counts.append(
        createCapabilityElement(ownerDocument, "span", "memory-badge", `方法 ${plan.methods.length}`),
        createCapabilityElement(ownerDocument, "span", "memory-badge", `技能 ${plan.skills.length}`),
        createCapabilityElement(ownerDocument, "span", "memory-badge", `MCP ${plan.mcpServers.length}`),
        createCapabilityElement(
          ownerDocument,
          "span",
          "memory-badge",
          `实际 ${plan.actualUsage.methods.length + plan.actualUsage.skills.length + plan.actualUsage.mcpServers.length}`,
        ),
      );
      item.append(counts);
      recentList.append(item);
    }
    recentColumn.append(recentList);
    fragment.append(recentColumn);
    panel.replaceChildren(fragment);

    bindCapabilityPanelActions(panel);
  }

  return {
    dispose: capabilityPanelControls.dispose,
    getRuntimeSnapshot: capabilityPanelControls.getRuntimeSnapshot,
    renderGoalCapabilityPanel,
    renderGoalCapabilityPanelError,
    renderGoalCapabilityPanelLoading,
  };
}
