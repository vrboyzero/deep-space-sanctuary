import { buildLaunchExplainabilityLines } from "./agent-launch-explainability.js";
import { buildResidentStateBindingLines } from "./resident-state-binding-lines.js";
import { createToolSettingsBuiltinTabView } from "./tool-settings-builtin-tab-view.js";
import { createToolSettingsEmptyStateView } from "./tool-settings-empty-state.js";
import { createToolSettingsMethodsTabView } from "./tool-settings-methods-tab-view.js";
import { createToolSettingsMcpTabView } from "./tool-settings-mcp-tab-view.js";
import { createToolSettingsPluginsTabView } from "./tool-settings-plugins-tab-view.js";
import { createToolSettingsSkillsTabView } from "./tool-settings-skills-tab-view.js";

export function createToolSettingsController({
  refs,
  isConnected,
  sendReq,
  makeId,
  clientId,
  getSelectedAgentId,
  getActiveConversationId,
  getSelectedSubtaskId,
  isSubtasksViewActive,
  showNotice,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    toolSettingsConfirmModal,
    toolSettingsConfirmImpactEl,
    toolSettingsConfirmSummaryEl,
    toolSettingsConfirmExpiryEl,
    toolSettingsConfirmApproveBtn,
    toolSettingsConfirmRejectBtn,
    toolSettingsModal,
    openToolSettingsBtn,
    closeToolSettingsBtn,
    saveToolSettingsBtn,
    toolSettingsBody,
    toolTabButtons,
  } = refs;
  const toolSettingsBuiltinTabView = createToolSettingsBuiltinTabView({
    ownerDocument: toolSettingsBody?.ownerDocument ?? document,
    t,
  });
  const toolSettingsEmptyStateView = createToolSettingsEmptyStateView({
    ownerDocument: toolSettingsBody?.ownerDocument ?? document,
    t,
  });
  const toolSettingsMethodsTabView = createToolSettingsMethodsTabView({
    ownerDocument: toolSettingsBody?.ownerDocument ?? document,
    t,
  });
  const toolSettingsPluginsTabView = createToolSettingsPluginsTabView({
    ownerDocument: toolSettingsBody?.ownerDocument ?? document,
    t,
  });
  const toolSettingsMcpTabView = createToolSettingsMcpTabView({
    ownerDocument: toolSettingsBody?.ownerDocument ?? document,
    t,
  });
  const toolSettingsSkillsTabView = createToolSettingsSkillsTabView({
    ownerDocument: toolSettingsBody?.ownerDocument ?? document,
    t,
  });

  let toolSettingsData = null;
  let toolSettingsActiveTab = "builtin";
  let toolSettingsLoadSeq = 0;
  let pendingToolSettingsConfirm = null;
  let toolSettingsConfirmTimer = null;
  let toolSettingsConfirmRevision = 0;
  let toolSettingsConfirmTimerStartCount = 0;
  let toolSettingsConfirmTimerTickCount = 0;
  let toolSettingsConfirmationDisposed = false;
  let saveButtonState = "default";
  let saveFeedbackTimer = null;
  let saveRevision = 0;
  let toolSettingsDisposed = false;
  const toolTabClickHandlers = new Map();

  function normalizeToolSettingsTab(tab) {
    const normalized = typeof tab === "string" ? tab.trim() : "";
    if (normalized === "builtin" || normalized === "mcp" || normalized === "plugins" || normalized === "methods" || normalized === "skills") {
      return normalized;
    }
    return "builtin";
  }

  function setActiveToolSettingsTab(tab, options = {}) {
    const nextTab = normalizeToolSettingsTab(tab);
    toolSettingsActiveTab = nextTab;
    for (const item of toolTabButtons || []) {
      item.classList.toggle("active", item.dataset.tab === nextTab);
    }
    if (options.render !== false && toolSettingsData) {
      renderToolSettingsTab();
    }
  }

  function updateSaveButton() {
    if (!saveToolSettingsBtn) return;
    const map = {
      default: { key: "common.save", fallback: "Save" },
      saving: { key: "toolSettings.saveSaving", fallback: "Saving..." },
      saved: { key: "toolSettings.saveSaved", fallback: "Saved" },
      failed: { key: "toolSettings.saveFailedShort", fallback: "Failed" },
    };
    const entry = map[saveButtonState] || map.default;
    saveToolSettingsBtn.textContent = t(entry.key, {}, entry.fallback);
    updateSaveButtonAvailability();
  }

  function updateSaveButtonAvailability() {
    if (!saveToolSettingsBtn) return;
    const readOnlyTab = toolSettingsActiveTab === "methods";
    const saving = saveButtonState === "saving";
    saveToolSettingsBtn.disabled = saving || readOnlyTab;
    saveToolSettingsBtn.title = readOnlyTab
      ? t("toolSettings.saveReadonlyMethods", {}, "Methods is a read-only index. No save action is needed.")
      : "";
  }

  function renderEmpty(messageKey, fallback) {
    toolSettingsEmptyStateView.render(toolSettingsBody, messageKey, fallback);
  }

  function normalizeBuiltinContract(contract) {
    if (!contract || typeof contract !== "object") return null;
    const safeScopes = Array.isArray(contract.safeScopes)
      ? contract.safeScopes.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const channels = Array.isArray(contract.channels)
      ? contract.channels.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return {
      family: contract.family ? String(contract.family) : "",
      riskLevel: contract.riskLevel ? String(contract.riskLevel) : "",
      channels,
      safeScopes,
      needsPermission: contract.needsPermission === true,
      isReadOnly: contract.isReadOnly === true,
      isConcurrencySafe: contract.isConcurrencySafe === true,
      activityDescription: contract.activityDescription ? String(contract.activityDescription) : "",
      outputPersistencePolicy: contract.outputPersistencePolicy ? String(contract.outputPersistencePolicy) : "",
    };
  }

  function normalizeVisibility(entry) {
    if (!entry || typeof entry !== "object") return null;
    return {
      available: entry.available !== false,
      reasonCode: entry.reasonCode ? String(entry.reasonCode) : "available",
      reasonMessage: entry.reasonMessage ? String(entry.reasonMessage) : "",
      alwaysEnabled: entry.alwaysEnabled === true,
      contractReason: entry.contractReason ? String(entry.contractReason) : "",
    };
  }

  function normalizeToolControlState(entry) {
    if (!entry || typeof entry !== "object") return null;
    const pending = entry.pendingRequest && typeof entry.pendingRequest === "object"
      ? {
        requestId: entry.pendingRequest.requestId ? String(entry.pendingRequest.requestId) : "",
        conversationId: entry.pendingRequest.conversationId ? String(entry.pendingRequest.conversationId) : "",
        requestedByAgentId: entry.pendingRequest.requestedByAgentId ? String(entry.pendingRequest.requestedByAgentId) : "",
        expiresAt: Number(entry.pendingRequest.expiresAt || 0),
        summary: Array.isArray(entry.pendingRequest.summary)
          ? entry.pendingRequest.summary.map((item) => String(item || "").trim()).filter(Boolean)
          : [],
        passwordApproved: entry.pendingRequest.passwordApproved === true,
      }
      : null;
    return {
      mode: entry.mode ? String(entry.mode) : "disabled",
      requiresConfirmation: entry.requiresConfirmation === true,
      hasConfirmPassword: entry.hasConfirmPassword === true,
      pendingRequest: pending,
    };
  }

  function normalizeWorkflowCapability(entry) {
    if (!entry || typeof entry !== "object") return null;
    return {
      toolName: entry.toolName ? String(entry.toolName) : "run_workflow",
      runtimeAvailable: entry.runtimeAvailable === true,
      registered: entry.registered === true,
      reasonCode: entry.reasonCode ? String(entry.reasonCode) : "tool_system_unavailable",
    };
  }

  function formatContractFamilyLabel(family) {
    const labels = {
      "network-read": t("toolSettings.familyNetworkRead", {}, "Network Read"),
      "workspace-read": t("toolSettings.familyWorkspaceRead", {}, "Workspace Read"),
      "workspace-write": t("toolSettings.familyWorkspaceWrite", {}, "Workspace Write"),
      patch: t("toolSettings.familyPatch", {}, "Patch"),
      "command-exec": t("toolSettings.familyCommandExec", {}, "Command Exec"),
      "process-control": t("toolSettings.familyProcessControl", {}, "Process Control"),
      "session-orchestration": t("toolSettings.familySession", {}, "Session"),
      memory: t("toolSettings.familyMemory", {}, "Memory"),
      browser: t("toolSettings.familyBrowser", {}, "Browser"),
      "service-admin": t("toolSettings.familyServiceAdmin", {}, "Service Admin"),
      "goal-governance": t("toolSettings.familyGoal", {}, "Goal Governance"),
      other: t("toolSettings.familyOther", {}, "Other"),
    };
    return labels[family] || family || t("toolSettings.familyUnknown", {}, "Unknown");
  }

  function formatContractRiskLabel(riskLevel) {
    const labels = {
      low: t("toolSettings.riskLow", {}, "Low Risk"),
      medium: t("toolSettings.riskMedium", {}, "Medium Risk"),
      high: t("toolSettings.riskHigh", {}, "High Risk"),
      critical: t("toolSettings.riskCritical", {}, "Critical Risk"),
    };
    return labels[riskLevel] || riskLevel || t("toolSettings.riskUnknown", {}, "Unknown Risk");
  }

  function formatContractScopeLabel(scope) {
    const labels = {
      "local-safe": t("toolSettings.scopeLocalSafe", {}, "Local Safe"),
      "web-safe": t("toolSettings.scopeWebSafe", {}, "Web Safe"),
      "bridge-safe": t("toolSettings.scopeBridgeSafe", {}, "Bridge Safe"),
      "remote-safe": t("toolSettings.scopeRemoteSafe", {}, "Remote Safe"),
      privileged: t("toolSettings.scopePrivileged", {}, "Privileged"),
    };
    return labels[scope] || scope;
  }

  function formatContractChannelLabel(channel) {
    const labels = {
      gateway: t("toolSettings.channelGateway", {}, "Gateway"),
      web: t("toolSettings.channelWeb", {}, "Web"),
      cli: t("toolSettings.channelCli", {}, "CLI"),
      "browser-extension": t("toolSettings.channelBrowserExtension", {}, "Browser Extension"),
    };
    return labels[channel] || channel;
  }

  function formatVisibilityLabel(reasonCode) {
    const labels = {
      available: t("toolSettings.visibilityAvailable", {}, "Visible in Current Context"),
      "blocked-by-security-matrix": t("toolSettings.visibilityBlockedByMatrix", {}, "Blocked by Security Matrix"),
      "unsupported-channel": t("toolSettings.visibilityUnsupportedChannel", {}, "Blocked by Channel"),
      "outside-safe-scope": t("toolSettings.visibilityOutsideSafeScope", {}, "Blocked by Safe Scope"),
      "missing-contract": t("toolSettings.visibilityMissingContract", {}, "Missing Contract"),
      "disabled-by-settings": t("toolSettings.visibilityDisabledBySettings", {}, "Disabled by Settings"),
      "not-in-agent-whitelist": t("toolSettings.visibilityAgentWhitelist", {}, "Blocked by Agent Whitelist"),
      "conversation-restricted": t("toolSettings.visibilityConversationRestricted", {}, "Blocked by Conversation Scope"),
      "excluded-by-launch-toolset": t("toolSettings.visibilityExcludedByLaunchToolset", {}, "Excluded by Launch Toolset"),
      "blocked-by-launch-role-policy": t("toolSettings.visibilityBlockedByLaunchRolePolicy", {}, "Blocked by Launch Role Policy"),
      "blocked-by-launch-permission-mode": t("toolSettings.visibilityBlockedByLaunchPermission", {}, "Blocked by Launch Permission Mode"),
      "not-eligible": t("toolSettings.visibilityNotEligible", {}, "Not Eligible"),
    };
    return labels[reasonCode] || reasonCode || t("toolSettings.visibilityUnknown", {}, "Unknown Visibility");
  }

  function buildToolControlViewModel(toolControl, visibilityContext) {
    if (!toolControl) return "";
    const residentStateBinding = visibilityContext?.residentStateBinding && typeof visibilityContext.residentStateBinding === "object"
      ? visibilityContext.residentStateBinding
      : null;
    const contextParts = [
      `${t("toolSettings.contextAgent", {}, "Agent")}: ${visibilityContext?.agentId || "default"}`,
      `${t("toolSettings.contextConversation", {}, "Conversation")}: ${visibilityContext?.conversationId || t("toolSettings.contextConversationNone", {}, "None")}`,
    ];
    if (visibilityContext?.taskId) {
      contextParts.push(`${t("toolSettings.contextTask", {}, "Subtask")}: ${visibilityContext.taskId}`);
    }
    const modeText = toolControl.mode === "confirm"
      ? t("toolSettings.toolControlModeConfirm", {}, "Confirm")
      : toolControl.mode === "auto"
        ? t("toolSettings.toolControlModeAuto", {}, "Auto")
        : t("toolSettings.toolControlModeDisabled", {}, "Disabled");
    const details = [
      `${t("toolSettings.toolControlModeLabel", {}, "Tool Control")}: ${modeText}`,
      toolControl.requiresConfirmation
        ? (
          toolControl.hasConfirmPassword
            ? t("toolSettings.toolControlConfirmPassword", {}, "Confirmation is enabled and currently uses a password/approval secret.")
            : t("toolSettings.toolControlConfirmUi", {}, "Confirmation is enabled and current requests should be approved through the UI flow.")
        )
        : t("toolSettings.toolControlNoConfirm", {}, "Confirmation is not required for tool switch changes in the current mode."),
    ];
    const loadedDeferredTools = Array.isArray(visibilityContext?.loadedDeferredTools)
      ? visibilityContext.loadedDeferredTools.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    details.push(
      `${t("toolSettings.loadedDeferredToolsLabel", {}, "Loaded Deferred Tools")}: ${loadedDeferredTools.length > 0 ? loadedDeferredTools.join(", ") : t("toolSettings.loadedDeferredToolsEmpty", {}, "(none)")}`,
    );
    const scopeLines = buildResidentStateBindingLines(residentStateBinding, t);
    if (toolControl.pendingRequest?.requestId) {
      details.push(
        t(
          "toolSettings.toolControlPending",
          { requestId: toolControl.pendingRequest.requestId },
          `Pending confirmation request: ${toolControl.pendingRequest.requestId}`,
        ),
      );
      for (const line of toolControl.pendingRequest.summary || []) {
        details.push(line);
      }
    }
    const launchSpec = visibilityContext?.launchSpec && typeof visibilityContext.launchSpec === "object"
      ? visibilityContext.launchSpec
      : null;
    const launchExplainabilityLines = buildLaunchExplainabilityLines(visibilityContext?.launchExplainability, t);
    const runtimeLines = launchSpec
      ? [
        t("toolSettings.runtimeScoped", {}, "Visibility is currently evaluated using the selected subtask launch runtime."),
        `${t("toolSettings.runtimeIsolationMode", {}, "Isolation")}: ${launchSpec.isolationMode || "-"}`,
        `${t("toolSettings.runtimeLaunchCwd", {}, "Launch CWD")}: ${launchSpec.cwd || "-"}`,
        `${t("toolSettings.runtimeResolvedCwd", {}, "Resolved CWD")}: ${launchSpec.resolvedCwd || launchSpec.cwd || "-"}`,
        `${t("toolSettings.runtimeWorktreeStatus", {}, "Worktree")}: ${launchSpec.worktreeStatus || "-"}`,
        `${t("toolSettings.runtimeWorktreePath", {}, "Worktree Path")}: ${launchSpec.worktreePath || "-"}`,
        `${t("toolSettings.runtimeRole", {}, "Launch Role")}: ${launchSpec.role || "-"}`,
        `${t("toolSettings.runtimeRolePolicy", {}, "Role Policy")}: ${launchSpec.policySummary || "-"}`,
        `${t("toolSettings.runtimePermissionMode", {}, "Permission Mode")}: ${launchSpec.permissionMode || "-"}`,
        `${t("toolSettings.runtimeToolSet", {}, "Tool Set")}: ${Array.isArray(launchSpec.toolSet) && launchSpec.toolSet.length ? launchSpec.toolSet.join(", ") : "-"}`,
        `${t("toolSettings.runtimeAllowedFamilies", {}, "Allowed Families")}: ${Array.isArray(launchSpec.allowedToolFamilies) && launchSpec.allowedToolFamilies.length ? launchSpec.allowedToolFamilies.join(", ") : "-"}`,
        `${t("toolSettings.runtimeMaxRisk", {}, "Max Risk")}: ${launchSpec.maxToolRiskLevel || "-"}`,
      ]
      : [];
    return {
      context: contextParts.join(" · "),
      details,
      scopeLines,
      launchExplainabilityLines,
      runtimeLines,
    };
  }

  function buildBuiltinContractViewModel(contract) {
    if (!contract) return null;
    const scopeText = contract.safeScopes.length > 0
      ? contract.safeScopes.map(formatContractScopeLabel).join(", ")
      : t("toolSettings.scopeUnknown", {}, "Unknown");
    const channelText = contract.channels.length > 0
      ? contract.channels.map(formatContractChannelLabel).join(", ")
      : t("toolSettings.channelUnknown", {}, "Unknown");
    const concurrencyText = contract.isConcurrencySafe
      ? t("toolSettings.concurrentSafe", {}, "Concurrency Safe")
      : t("toolSettings.concurrentSerialized", {}, "Serialized Access");
    return {
      description: contract.activityDescription,
      badges: [
        { className: "family", label: formatContractFamilyLabel(contract.family) },
        { className: `risk-${contract.riskLevel || "unknown"}`, label: formatContractRiskLabel(contract.riskLevel) },
        {
          className: contract.isReadOnly ? "mode-read" : "mode-write",
          label: contract.isReadOnly
            ? t("toolSettings.modeReadOnly", {}, "Read-only")
            : t("toolSettings.modeWritesState", {}, "Writes State"),
        },
        {
          className: contract.needsPermission ? "permission-needed" : "permission-free",
          label: contract.needsPermission
            ? t("toolSettings.permissionRequired", {}, "Permission Required")
            : t("toolSettings.permissionNotRequired", {}, "No Extra Permission"),
        },
        {
          className: "",
          label: contract.outputPersistencePolicy
            ? `${t("toolSettings.outputLabel", {}, "Output")}: ${contract.outputPersistencePolicy}`
            : t("toolSettings.outputLabel", {}, "Output"),
        },
      ],
      meta: `${t("toolSettings.scopeLabel", {}, "Scopes")}: ${scopeText} · ${t("toolSettings.channelLabel", {}, "Channels")}: ${channelText} · ${concurrencyText}`,
    };
  }

  function handleOpenToolSettingsClick() {
    void toggle(true);
  }
  function handleCloseToolSettingsClick() {
    void toggle(false);
  }
  function handleSaveToolSettingsClick() {
    void saveToolSettings();
  }
  openToolSettingsBtn?.addEventListener("click", handleOpenToolSettingsClick);
  closeToolSettingsBtn?.addEventListener("click", handleCloseToolSettingsClick);
  saveToolSettingsBtn?.addEventListener("click", handleSaveToolSettingsClick);
  function handleToolSettingsConfirmApproveClick() {
    void submitToolSettingsConfirm("approve");
  }
  function handleToolSettingsConfirmRejectClick() {
    void submitToolSettingsConfirm("reject");
  }
  toolSettingsConfirmApproveBtn?.addEventListener("click", handleToolSettingsConfirmApproveClick);
  toolSettingsConfirmRejectBtn?.addEventListener("click", handleToolSettingsConfirmRejectClick);

  for (const tab of toolTabButtons || []) {
    const handleTabClick = () => {
      setActiveToolSettingsTab(tab.dataset.tab, { render: true });
    };
    toolTabClickHandlers.set(tab, handleTabClick);
    tab.addEventListener("click", handleTabClick);
  }

  async function toggle(show, options = {}) {
    if (toolSettingsDisposed || !toolSettingsModal) return;
    if (show) {
      setActiveToolSettingsTab(options.tab ?? toolSettingsActiveTab, { render: false });
      toolSettingsModal.classList.remove("hidden");
      toolSettingsData = null;
      await loadToolSettings();
      return;
    }
    toolSettingsModal.classList.add("hidden");
  }

  async function openTab(tab) {
    await toggle(true, { tab });
  }

  function shouldHandleToolSettingsConfirmPayload(payload) {
    if (toolSettingsConfirmationDisposed || !payload || typeof payload !== "object") return false;
    const targetClientId = payload.targetClientId ? String(payload.targetClientId).trim() : "";
    return !targetClientId || targetClientId === clientId;
  }

  function normalizeToolSettingsConfirmPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    const requestId = payload.requestId ? String(payload.requestId).trim() : "";
    const conversationId = payload.conversationId ? String(payload.conversationId).trim() : "";
    if (!requestId || !conversationId) return null;
    const summary = Array.isArray(payload.summary)
      ? payload.summary.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    return {
      requestId,
      conversationId,
      impact: payload.impact
        ? String(payload.impact)
        : t(
          "toolSettings.confirmImpactDefault",
          {},
          "This is a global tool settings change and will affect other sessions on the current Gateway.",
        ),
      summary,
      expiresAt: Number(payload.expiresAt || 0),
    };
  }

  function setToolSettingsConfirmBusy(busy) {
    if (toolSettingsConfirmApproveBtn) toolSettingsConfirmApproveBtn.disabled = busy;
    if (toolSettingsConfirmRejectBtn) toolSettingsConfirmRejectBtn.disabled = busy;
  }

  function stopToolSettingsConfirmTimer() {
    if (toolSettingsConfirmTimer !== null) {
      clearInterval(toolSettingsConfirmTimer);
      toolSettingsConfirmTimer = null;
    }
  }

  function formatToolSettingsConfirmExpiry(expiresAt) {
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return "";
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) return t("toolSettings.confirmExpired", {}, "This confirmation request has expired. Please trigger the tool switch change again.");
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec < 60) {
      return t("toolSettings.confirmInSeconds", { seconds: remainingSec }, `Please complete confirmation within ${remainingSec} seconds.`);
    }
    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    return t(
      "toolSettings.confirmInMinutes",
      { minutes, seconds: seconds.toString().padStart(2, "0") },
      `Please complete confirmation within ${minutes}m ${seconds.toString().padStart(2, "0")}s.`,
    );
  }

  function renderToolSettingsConfirmModal() {
    if (toolSettingsConfirmationDisposed || !pendingToolSettingsConfirm || !toolSettingsConfirmModal) return;
    if (toolSettingsConfirmImpactEl) {
      toolSettingsConfirmImpactEl.textContent = pendingToolSettingsConfirm.impact;
    }
    if (toolSettingsConfirmSummaryEl) {
      const lines = pendingToolSettingsConfirm.summary.length > 0
        ? pendingToolSettingsConfirm.summary
        : [t("toolSettings.confirmNoSummary", {}, "No displayable change summary was provided for this request.")];
      const ownerDocument = toolSettingsConfirmSummaryEl.ownerDocument ?? document;
      toolSettingsConfirmSummaryEl.replaceChildren(...lines.map((line) => {
        const item = ownerDocument.createElement("li");
        item.textContent = line;
        return item;
      }));
    }
    if (toolSettingsConfirmExpiryEl) {
      toolSettingsConfirmExpiryEl.textContent = formatToolSettingsConfirmExpiry(pendingToolSettingsConfirm.expiresAt);
    }
  }

  function clearToolSettingsConfirmModal() {
    toolSettingsConfirmRevision += 1;
    pendingToolSettingsConfirm = null;
    stopToolSettingsConfirmTimer();
    setToolSettingsConfirmBusy(false);
    if (toolSettingsConfirmModal) toolSettingsConfirmModal.classList.add("hidden");
  }

  function formatWorkflowCapabilityReason(capability) {
    if (!capability) return "";
    const toolName = capability.toolName || "run_workflow";
    const labels = {
      available: t(
        "toolSettings.workflowCapabilityAvailable",
        { toolName },
        `${toolName} is available in the current builtin tools list.`,
      ),
      runtime_unavailable: t(
        "toolSettings.workflowCapabilityRuntimeUnavailable",
        { toolName },
        `Dynamic Workflow runtime is unavailable, so ${toolName} is not registered in builtin tools.`,
      ),
      tool_not_registered: t(
        "toolSettings.workflowCapabilityToolNotRegistered",
        { toolName },
        `Dynamic Workflow runtime is ready, but ${toolName} is still not registered in builtin tools.`,
      ),
      tool_system_unavailable: t(
        "toolSettings.workflowCapabilityToolSystemUnavailable",
        { toolName },
        `Tool system is unavailable, so ${toolName} cannot be listed.`,
      ),
    };
    return labels[capability.reasonCode] || labels.tool_system_unavailable;
  }

  function buildWorkflowCapabilityViewModel(capability) {
    if (!capability) return "";
    const statusText = capability.registered
      ? t("toolSettings.workflowCapabilityStatusReady", {}, "Workflow tool ready")
      : t("toolSettings.workflowCapabilityStatusMissing", {}, "Workflow tool unavailable");
    return {
      title: t("toolSettings.workflowCapabilityTitle", {}, "Dynamic Workflow"),
      status: statusText,
      reason: formatWorkflowCapabilityReason(capability),
    };
  }

  function buildToolSettingsConfirmAgentNotice(request, decision) {
    const approved = decision === "approve";
    const summary = Array.isArray(request?.summary)
      ? request.summary.map((line) => String(line || "").trim()).filter(Boolean)
      : [];
    return [
      "【工具开关确认结果】",
      `requestId: ${request?.requestId || "-"}`,
      `decision: ${approved ? "approved / 用户已批准" : "rejected / 用户已拒绝"}`,
      approved
        ? "result: 全局工具开关变更已应用。"
        : "result: 用户拒绝了这次全局工具开关变更，配置未改变。",
      summary.length > 0 ? "变更摘要：" : "",
      ...summary.map((line) => `- ${line}`),
      "请基于这个确认结果继续当前任务；不要再次要求用户输入工具确认口令。",
    ].filter(Boolean).join("\n");
  }

  async function notifyAgentOfToolSettingsConfirm(request, decision, revision) {
    if (toolSettingsConfirmationDisposed) return;
    const conversationId = typeof request?.conversationId === "string" ? request.conversationId.trim() : "";
    if (!conversationId) return;
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "message.send",
      params: {
        conversationId,
        text: buildToolSettingsConfirmAgentNotice(request, decision),
        from: "web",
        roomContext: { environment: "local" },
        clientContext: {
          sentAtMs: Date.now(),
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
          locale: typeof navigator !== "undefined" ? navigator.language : undefined,
        },
      },
    });
    if (toolSettingsConfirmationDisposed || revision !== toolSettingsConfirmRevision) return;
    if (!res || res.ok === false) {
      showNotice(
        t("toolSettings.noticeAgentNotifyFailedTitle", {}, "Unable to notify Agent"),
        res?.error?.message || t("toolSettings.noticeAgentNotifyFailedMessage", {}, "The confirmation was processed, but the Agent follow-up message was not sent."),
        "error",
      );
    }
  }

  function handleConfirmRequired(payload) {
    if (!shouldHandleToolSettingsConfirmPayload(payload)) return;
    const normalized = normalizeToolSettingsConfirmPayload(payload);
    if (!normalized) return;
    toolSettingsConfirmRevision += 1;
    pendingToolSettingsConfirm = normalized;
    setToolSettingsConfirmBusy(false);
    renderToolSettingsConfirmModal();
    if (toolSettingsConfirmModal) toolSettingsConfirmModal.classList.remove("hidden");
    stopToolSettingsConfirmTimer();
    toolSettingsConfirmTimerStartCount += 1;
    toolSettingsConfirmTimer = setInterval(() => {
      if (toolSettingsConfirmationDisposed || !pendingToolSettingsConfirm) {
        stopToolSettingsConfirmTimer();
        return;
      }
      toolSettingsConfirmTimerTickCount += 1;
      renderToolSettingsConfirmModal();
    }, 1000);
  }

  function handleConfirmResolved(payload) {
    if (!shouldHandleToolSettingsConfirmPayload(payload)) return;
    const requestId = payload && payload.requestId ? String(payload.requestId).trim() : "";
    if (!pendingToolSettingsConfirm || pendingToolSettingsConfirm.requestId !== requestId) return;
    const approved = payload && payload.decision === "approved";
    clearToolSettingsConfirmModal();
    showNotice(
      approved
        ? t("toolSettings.noticeConfirmedTitle", {}, "Tool settings confirmed")
        : t("toolSettings.noticeRejectedTitle", {}, "Tool settings rejected"),
      approved
        ? t("toolSettings.noticeConfirmedMessage", {}, "Global tool switch changes have been applied.")
        : t("toolSettings.noticeRejectedMessage", {}, "This tool switch change was rejected."),
      approved ? "success" : "info",
      2600,
    );
  }

  async function submitToolSettingsConfirm(decision) {
    if (toolSettingsConfirmationDisposed || !pendingToolSettingsConfirm) return;
    if (!isConnected()) {
      showNotice(
        t("toolSettings.noticeHandleErrorTitle", {}, "Unable to process confirmation"),
        t("toolSettings.noticeNotConnected", {}, "Not connected to the server."),
        "error",
      );
      return;
    }
    setToolSettingsConfirmBusy(true);
    const currentRequest = pendingToolSettingsConfirm;
    const revision = toolSettingsConfirmRevision;
    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "tool_settings.confirm",
      params: {
        requestId: currentRequest.requestId,
        conversationId: currentRequest.conversationId,
        decision,
      },
    });
    if (toolSettingsConfirmationDisposed
      || revision !== toolSettingsConfirmRevision
      || pendingToolSettingsConfirm?.requestId !== currentRequest.requestId) {
      return;
    }
    if (!res || res.ok === false) {
      setToolSettingsConfirmBusy(false);
      showNotice(
        decision === "approve"
          ? t("toolSettings.approveFailedTitle", {}, "Approval failed")
          : t("toolSettings.rejectFailedTitle", {}, "Rejection failed"),
        res?.error?.message || t("toolSettings.requestIncomplete", {}, "Request was not completed."),
        "error",
      );
      if (res?.error?.code === "not_found") {
        clearToolSettingsConfirmModal();
      }
      return;
    }
    clearToolSettingsConfirmModal();
    showNotice(
      decision === "approve"
        ? t("toolSettings.noticeConfirmedTitle", {}, "Tool settings confirmed")
        : t("toolSettings.noticeRejectedTitle", {}, "Tool settings rejected"),
      decision === "approve"
        ? t("toolSettings.noticeConfirmedMessage", {}, "Global tool switch changes have been applied.")
        : t("toolSettings.noticeRejectedMessage", {}, "This tool switch change was rejected."),
      decision === "approve" ? "success" : "info",
      2600,
    );
    void notifyAgentOfToolSettingsConfirm(currentRequest, decision, toolSettingsConfirmRevision);
  }

  function disposeConfirmation() {
    if (toolSettingsConfirmationDisposed) return;
    toolSettingsConfirmationDisposed = true;
    clearToolSettingsConfirmModal();
    toolSettingsConfirmApproveBtn?.removeEventListener("click", handleToolSettingsConfirmApproveClick);
    toolSettingsConfirmRejectBtn?.removeEventListener("click", handleToolSettingsConfirmRejectClick);
  }

  function getConfirmationRuntimeSnapshot() {
    return {
      pendingConfirmationCount: pendingToolSettingsConfirm ? 1 : 0,
      timerActive: toolSettingsConfirmTimer !== null,
      timerStartCount: toolSettingsConfirmTimerStartCount,
      timerTickCount: toolSettingsConfirmTimerTickCount,
      disposed: toolSettingsConfirmationDisposed,
    };
  }

  async function loadToolSettings() {
    if (toolSettingsDisposed) return;
    const seq = ++toolSettingsLoadSeq;
    if (!isConnected()) {
      renderEmpty("toolSettings.emptyDisconnected", "Disconnected");
      return;
    }
    renderEmpty("toolSettings.emptyLoading", "Loading...");

    const agentId = typeof getSelectedAgentId === "function" ? String(getSelectedAgentId() || "").trim() : "";
    const conversationId = typeof getActiveConversationId === "function" ? String(getActiveConversationId() || "").trim() : "";
    const taskId = typeof getSelectedSubtaskId === "function" && isSubtasksViewActive?.()
      ? String(getSelectedSubtaskId() || "").trim()
      : "";
    const params = {};
    if (taskId) {
      params.taskId = taskId;
    } else {
      if (agentId) params.agentId = agentId;
      if (conversationId) params.conversationId = conversationId;
    }

    const res = await sendReq({ type: "req", id: makeId(), method: "tools.list", params });
    if (toolSettingsDisposed || seq !== toolSettingsLoadSeq) return;
    if (res && res.ok && res.payload) {
      toolSettingsData = res.payload;
      renderToolSettingsTab();
      return;
    }
    renderEmpty("toolSettings.emptyLoadFailed", "Load failed");
  }

  function renderToolSettingsTab() {
    if (!toolSettingsData) return;
    const {
      builtin,
      mcp,
      plugins,
      methods,
      skills,
      disabled,
      contracts,
      visibility,
      mcpVisibility,
      pluginVisibility,
      skillVisibility,
      visibilityContext,
      toolControl,
      runtimeCapabilities,
    } = toolSettingsData;

    if (toolSettingsActiveTab === "builtin") {
      renderBuiltinTab(
        builtin,
        disabled.builtin || [],
        contracts || {},
        visibility || {},
        visibilityContext || {},
        normalizeToolControlState(toolControl),
        normalizeWorkflowCapability(runtimeCapabilities?.workflow),
      );
    } else if (toolSettingsActiveTab === "mcp") {
      renderMCPTab(mcp, disabled.mcp_servers || [], mcpVisibility || {}, visibilityContext || {}, normalizeToolControlState(toolControl));
    } else if (toolSettingsActiveTab === "methods") {
      renderMethodsTab(methods || [], visibilityContext || {}, normalizeToolControlState(toolControl));
    } else if (toolSettingsActiveTab === "skills") {
      renderSkillsTab(skills || [], disabled.skills || [], skillVisibility || {}, visibilityContext || {}, normalizeToolControlState(toolControl));
    } else {
      renderPluginsTab(plugins, disabled.plugins || [], pluginVisibility || {}, visibilityContext || {}, normalizeToolControlState(toolControl));
    }
    updateSaveButtonAvailability();
  }

  function renderBuiltinTab(tools, disabledList, contractsByName, visibilityByName, visibilityContext, toolControl, workflowCapability) {
    if (!tools || tools.length === 0) {
      renderEmpty("toolSettings.emptyUnavailable", "Tool system is disabled (BELLDANDY_TOOLS_ENABLED=false)");
      return;
    }
    const disabledSet = new Set(disabledList);
    const enabledCount = tools.length - disabledSet.size;
    const builtinTools = tools.map((name) => {
      const checked = !disabledSet.has(name);
      const contract = normalizeBuiltinContract(contractsByName ? contractsByName[name] : null);
      const visibility = normalizeVisibility(visibilityByName ? visibilityByName[name] : null);
      return {
        name,
        checked,
        contract: buildBuiltinContractViewModel(contract),
        visibility: visibility
          ? {
            available: visibility.available,
            label: formatVisibilityLabel(visibility.reasonCode),
            alwaysEnabled: visibility.alwaysEnabled,
            alwaysEnabledLabel: visibility.alwaysEnabled
              ? t("toolSettings.visibilityAlwaysEnabled", {}, "Always Enabled")
              : "",
            reasonMessage: visibility.reasonMessage,
          }
          : null,
      };
    });
    toolSettingsBuiltinTabView.render(toolSettingsBody, {
      tools: builtinTools,
      enabledCount,
      toolControlView: buildToolControlViewModel(toolControl, visibilityContext),
      workflowCapabilityView: buildWorkflowCapabilityViewModel(workflowCapability),
    });
    bindToggleEvents();
  }

  function renderMCPTab(mcpServers, disabledList, visibilityByServer, visibilityContext, toolControl) {
    const serverIds = Object.keys(mcpServers || {});
    if (serverIds.length === 0) {
      renderEmpty("toolSettings.emptyNoMcp", "No MCP servers configured");
      return;
    }
    const disabledSet = new Set(disabledList);
    const enabledCount = serverIds.length - disabledSet.size;
    const servers = serverIds.map((serverId) => {
      const server = mcpServers[serverId];
      const checked = !disabledSet.has(serverId);
      const visibility = normalizeVisibility(visibilityByServer ? visibilityByServer[serverId] : null);
      return {
        id: serverId,
        tools: server.tools || [],
        checked,
        visibility: visibility
          ? {
            available: visibility.available,
            label: formatVisibilityLabel(visibility.reasonCode),
            alwaysEnabled: visibility.alwaysEnabled,
            alwaysEnabledLabel: visibility.alwaysEnabled
              ? t("toolSettings.visibilityAlwaysEnabled", {}, "Always Enabled")
              : "",
            reasonMessage: visibility.reasonMessage,
          }
          : null,
      };
    });
    toolSettingsMcpTabView.render(toolSettingsBody, {
      servers,
      enabledCount,
      toolControlView: buildToolControlViewModel(toolControl, visibilityContext),
    });
    bindToggleEvents();
  }

  function renderPluginsTab(pluginList, disabledList, visibilityByPlugin, visibilityContext, toolControl) {
    if (!pluginList || pluginList.length === 0) {
      renderEmpty("toolSettings.emptyNoPlugins", "No plugins loaded (put .js/.mjs files into ~/.star_sanctuary/plugins/)");
      return;
    }
    const disabledSet = new Set(disabledList);
    const enabledCount = pluginList.length - disabledSet.size;
    const plugins = pluginList.map((name) => {
      const checked = !disabledSet.has(name);
      const visibility = normalizeVisibility(visibilityByPlugin ? visibilityByPlugin[name] : null);
      return {
        name,
        checked,
        visibility: visibility
          ? {
            available: visibility.available,
            label: formatVisibilityLabel(visibility.reasonCode),
            alwaysEnabled: visibility.alwaysEnabled,
            alwaysEnabledLabel: visibility.alwaysEnabled
              ? t("toolSettings.visibilityAlwaysEnabled", {}, "Always Enabled")
              : "",
            reasonMessage: visibility.reasonMessage,
          }
          : null,
      };
    });
    toolSettingsPluginsTabView.render(toolSettingsBody, {
      plugins,
      enabledCount,
      toolControlView: buildToolControlViewModel(toolControl, visibilityContext),
    });
    bindToggleEvents();
  }

  function renderMethodsTab(methodList, visibilityContext, toolControl) {
    if (!methodList || methodList.length === 0) {
      renderEmpty("toolSettings.emptyNoMethods", "未发布方法（将 .md 放入 ~/.star_sanctuary/methods/ 目录）");
      return;
    }
    toolSettingsMethodsTabView.render(toolSettingsBody, {
      methods: methodList,
      toolControlView: buildToolControlViewModel(toolControl, visibilityContext),
    });
    bindMethodOpenEvents();
  }

  function renderSkillsTab(skillList, disabledList, visibilityBySkill, visibilityContext, toolControl) {
    if (!skillList || skillList.length === 0) {
      renderEmpty("toolSettings.emptyNoSkills", "No skills loaded (put SKILL.md into ~/.star_sanctuary/skills/)");
      return;
    }
    const disabledSet = new Set(disabledList);
    const enabledCount = skillList.length - disabledSet.size;
    const sourceLabel = {
      bundled: t("toolSettings.sourceBundled", {}, "Bundled"),
      user: t("toolSettings.sourceUser", {}, "User"),
      plugin: t("toolSettings.sourcePlugin", {}, "Plugin"),
    };
    const priorityLabel = {
      always: t("toolSettings.priorityAlways", {}, "Always Inject"),
      high: t("toolSettings.priorityHigh", {}, "High"),
      normal: t("toolSettings.priorityNormal", {}, "Normal"),
      low: t("toolSettings.priorityLow", {}, "Low"),
    };
    const skills = skillList.map((skill) => {
      const checked = !disabledSet.has(skill.name);
      const visibility = normalizeVisibility(visibilityBySkill ? visibilityBySkill[skill.name] : null);
      const src = sourceLabel[skill.source] || skill.source;
      const pri = priorityLabel[skill.priority] || skill.priority;
      return {
        name: skill.name,
        source: src,
        priority: pri,
        description: skill.description,
        tags: skill.tags || [],
        checked,
        visibility: visibility
          ? {
            available: visibility.available,
            label: formatVisibilityLabel(visibility.reasonCode),
            alwaysEnabled: visibility.alwaysEnabled,
            alwaysEnabledLabel: visibility.alwaysEnabled
              ? t("toolSettings.visibilityAlwaysEnabled", {}, "Always Enabled")
              : "",
            reasonMessage: visibility.reasonMessage,
          }
          : null,
      };
    });
    toolSettingsSkillsTabView.render(toolSettingsBody, {
      skills,
      enabledCount,
      toolControlView: buildToolControlViewModel(toolControl, visibilityContext),
    });
    bindToggleEvents();
  }

  function bindToggleEvents() {
    toolSettingsBody.querySelectorAll("input[type=checkbox]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const category = checkbox.dataset.category;
        const name = checkbox.dataset.name;
        if (!toolSettingsData || !category || !name) return;

        const list = toolSettingsData.disabled[category] || [];
        if (checkbox.checked) {
          toolSettingsData.disabled[category] = list.filter((item) => item !== name);
        } else {
          if (!list.includes(name)) list.push(name);
          toolSettingsData.disabled[category] = list;
        }

        const item = checkbox.closest(".tool-item");
        if (item) {
          item.classList.toggle("disabled", !checkbox.checked);
        }
        renderToolSettingsTab();
      });
    });
  }

  function bindMethodOpenEvents() {
    toolSettingsBody.querySelectorAll("[data-method-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const methodPath = button.getAttribute("data-method-path");
        if (!methodPath) return;
        if (typeof window !== "undefined" && typeof window._belldandyOpenFile === "function") {
          window._belldandyOpenFile(methodPath);
          return;
        }
        showNotice(
          t("toolSettings.methodOpenUnavailableTitle", {}, "无法打开文件"),
          t("toolSettings.methodOpenUnavailableMessage", {}, "当前没有可用的文件打开入口。"),
          "error",
        );
      });
    });
  }

  async function saveToolSettings() {
    if (toolSettingsDisposed || !isConnected() || !toolSettingsData) return;
    if (toolSettingsActiveTab === "methods") return;
    const revision = ++saveRevision;
    if (saveToolSettingsBtn) {
      saveButtonState = "saving";
      updateSaveButton();
      saveToolSettingsBtn.disabled = true;
    }

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "tools.update",
      params: { disabled: toolSettingsData.disabled },
    });
    if (toolSettingsDisposed || revision !== saveRevision) return;

    if (res && res.ok) {
      if (saveToolSettingsBtn) {
        saveButtonState = "saved";
        updateSaveButton();
      }
      if (saveFeedbackTimer !== null) clearTimeout(saveFeedbackTimer);
      saveFeedbackTimer = setTimeout(() => {
        saveFeedbackTimer = null;
        if (toolSettingsDisposed || revision !== saveRevision) return;
        if (saveToolSettingsBtn) {
          saveButtonState = "default";
          updateSaveButton();
          saveToolSettingsBtn.disabled = false;
        }
      }, 1500);
      return;
    }

    if (saveToolSettingsBtn) {
      saveButtonState = "failed";
      updateSaveButton();
      saveToolSettingsBtn.disabled = false;
    }
    alert(t("toolSettings.saveFailedAlert", { message: res?.error?.message || t("toolSettings.unknownError", {}, "Unknown error") }, "Save failed: {message}"));
  }

  function handleToolsConfigUpdated(payload) {
    if (toolSettingsDisposed) return;
    if (toolSettingsModal && !toolSettingsModal.classList.contains("hidden")) {
      void loadToolSettings();
      return;
    }
    if (payload && payload.disabled) {
      if (!toolSettingsData) {
        toolSettingsData = { builtin: [], mcp: {}, plugins: [], methods: [], skills: [], disabled: payload.disabled };
      } else {
        toolSettingsData.disabled = payload.disabled;
      }
    }
  }

  function dispose() {
    if (toolSettingsDisposed) return;
    toolSettingsDisposed = true;
    disposeConfirmation();
    toolSettingsLoadSeq += 1;
    saveRevision += 1;
    if (saveFeedbackTimer !== null) {
      clearTimeout(saveFeedbackTimer);
      saveFeedbackTimer = null;
    }
    openToolSettingsBtn?.removeEventListener("click", handleOpenToolSettingsClick);
    closeToolSettingsBtn?.removeEventListener("click", handleCloseToolSettingsClick);
    saveToolSettingsBtn?.removeEventListener("click", handleSaveToolSettingsClick);
    for (const [tab, handleTabClick] of toolTabClickHandlers) {
      tab.removeEventListener("click", handleTabClick);
    }
    toolTabClickHandlers.clear();
    toolSettingsData = null;
    toolSettingsModal?.classList.add("hidden");
  }

  function getRuntimeSnapshot() {
    return {
      loadedDataCount: toolSettingsData ? 1 : 0,
      saveFeedbackTimerActive: saveFeedbackTimer !== null,
      panelListenerCount: toolSettingsDisposed
        ? 0
        : Number(Boolean(openToolSettingsBtn))
          + Number(Boolean(closeToolSettingsBtn))
          + Number(Boolean(saveToolSettingsBtn))
          + toolTabClickHandlers.size,
      disposed: toolSettingsDisposed,
    };
  }

  return {
    dispose,
    disposeConfirmation,
    getConfirmationRuntimeSnapshot,
    getRuntimeSnapshot,
    refreshLocale() {
      if (toolSettingsDisposed) return;
      updateSaveButton();
      renderToolSettingsConfirmModal();
      if (toolSettingsData) {
        renderToolSettingsTab();
      }
    },
    openTab,
    toggle,
    handleConfirmRequired,
    handleConfirmResolved,
    handleToolsConfigUpdated,
  };
}
