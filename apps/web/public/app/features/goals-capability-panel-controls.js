import { createGoalsSpecialistPanelControlsFeature } from "./goals-specialist-panel-controls.js";

const CAPABILITY_GROUP = "capability";

export function createGoalsCapabilityPanelControlsFeature({
  onOpenSourcePath,
  onOpenSubtask,
  onSaveGovernanceSettings,
  onCommanderDecision,
} = {}) {
  const controls = createGoalsSpecialistPanelControlsFeature();

  function bind(panel) {
    // 动态 panel 由同一 group 接管，replacement 和 pagehide 都能释放旧 DOM listener。
    return controls.replaceGroup(CAPABILITY_GROUP, panel, [
      {
        selector: "[data-open-source]",
        onClick: (node) => {
          const sourcePath = node.getAttribute("data-open-source");
          if (!sourcePath) return;
          void onOpenSourcePath?.(sourcePath);
        },
      },
      {
        selector: "[data-open-subtask-id]",
        onClick: (node) => {
          const taskId = node.getAttribute("data-open-subtask-id");
          if (!taskId) return;
          void onOpenSubtask?.(taskId);
        },
      },
      {
        selector: "[data-goal-capability-save]",
        onClick: async (node) => {
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
        },
      },
      {
        selector: "[data-goal-commander-decision]",
        onClick: async (node) => {
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
        },
      },
      {
        selector: "[data-goal-commander-prefill]",
        onClick: (node) => {
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
          if (mode === "gate" && gateSummary) summaryEl.value = gateSummary;
        },
      },
    ]);
  }

  return {
    bind,
    dispose: controls.dispose,
    getRuntimeSnapshot: controls.getRuntimeSnapshot,
  };
}
