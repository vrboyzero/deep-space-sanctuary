// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createGoalsGovernancePanelFeature } from "./goals-governance-panel.js";

let previousWebConfig;

beforeEach(() => {
  previousWebConfig = globalThis.BELLDANDY_WEB_CONFIG;
  globalThis.BELLDANDY_WEB_CONFIG = { governanceDetailMode: "full" };
});

afterEach(() => {
  document.body.replaceChildren();
  if (previousWebConfig === undefined) {
    delete globalThis.BELLDANDY_WEB_CONFIG;
  } else {
    globalThis.BELLDANDY_WEB_CONFIG = previousWebConfig;
  }
});

describe("Goal Governance full panel DOM rendering", () => {
  it("renders branches, actions, truncated activity, and replacement without using the HTML parser", () => {
    document.body.innerHTML = '<div id="goalsDetail"><div id="goalGovernancePanel"></div></div>';
    const panel = document.getElementById("goalGovernancePanel");
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    Object.defineProperty(panel, "innerHTML", {
      configurable: true,
      get() {
        return innerHtmlDescriptor.get.call(this);
      },
      set(value) {
        if (value) {
          throw new Error("Goal Governance panel must not use innerHTML");
        }
        innerHtmlDescriptor.set.call(this, value);
      },
    });

    const malicious = {
      freshness: '<img src=x onerror="alert(1)">freshness',
      bridgeTitle: "<script>alert(2)</script>Bridge title",
      commanderTitle: "<style>bad</style>Commander node",
      learningLine: "<iframe>learning</iframe>Learning line",
      reviewTitle: '<svg onload="alert(3)">Review title</svg>',
      checkpointTitle: "<b>Checkpoint title</b>",
      notification: "<i>Notification body</i>",
      dispatch: "<template>Dispatch body</template>",
    };
    const feature = createGoalsGovernancePanelFeature({
      refs: { goalsDetailEl: document.getElementById("goalsDetail") },
      escapeHtml: (value) => String(value ?? ""),
      formatDateTime: (value) => `<time>${value ?? "-"}</time>`,
      goalRuntimeFilePath: (_goal, fileName) => `runtime/${fileName}`,
      t: (_key, _params, fallback) => fallback ?? "",
    });
    const goal = { id: 'goal:"<&' };
    const notifications = Array.from({ length: 7 }, (_, index) => ({
      kind: `notification-${index}`,
      targetType: "checkpoint",
      targetId: `target-${index}`,
      recipient: `recipient-${index}`,
      message: index === 6 ? malicious.notification : `message-${index}`,
      createdAt: `notification-time-${index}`,
    }));
    const dispatches = Array.from({ length: 9 }, (_, index) => ({
      channel: `channel-${index}`,
      status: index === 8 ? "failed" : "sent",
      targetType: "suggestion_review",
      targetId: `dispatch-target-${index}`,
      recipient: `dispatch-recipient-${index}`,
      routeKey: `route-${index}`,
      message: index === 8 ? malicious.dispatch : `dispatch-${index}`,
      createdAt: `dispatch-time-${index}`,
    }));
    const payload = {
      workflowPendingCount: 1,
      workflowOverdueCount: 2,
      checkpointWorkflowPendingCount: 3,
      checkpointWorkflowOverdueCount: 4,
      reviewers: [{ id: "reviewer-1" }],
      templates: [{ id: "template:<&", title: "<img src=x>Template", mode: "required", target: "goal" }],
      notifications,
      notificationDispatches: dispatches,
      notificationDispatchCounts: {
        total: dispatches.length,
        byChannel: { email: 4, webhook: 5 },
        byStatus: { sent: 8, failed: 1 },
      },
      memoryFreshness: {
        summary: {
          available: true,
          headline: malicious.freshness,
          reviewRequiredCount: 2,
          staleCount: 1,
          supersededCount: 1,
        },
      },
      bridgeGovernanceSummary: {
        bridgeNodeCount: 1,
        activeCount: 0,
        runtimeLostCount: 1,
        orphanedCount: 0,
        blockedCount: 1,
        artifactCount: 1,
        transcriptCount: 1,
        items: [{
          nodeId: "node:<&",
          title: malicious.bridgeTitle,
          taskId: "task:<&",
          runtimeState: "runtime-lost",
          closeReason: "runtime-lost",
          summaryLines: ["<img src=x>Bridge summary"],
          blockReason: "<svg>Bridge block</svg>",
          artifactPath: "artifact:<&",
          transcriptPath: "transcript:<&",
        }],
      },
      commanderFocus: {
        nodeId: "node-commander",
        nodeTitle: malicious.commanderTitle,
        governanceMode: "commander",
        executionMode: "multi_agent_parallel",
        reviewStatus: "accepted",
        finalApprovalMode: "user_required",
        reworkRevisionCount: 1,
        commanderAgentId: "<img src=x>commander",
        planId: "plan:<&",
        runId: "run:<&",
        fanInSummary: "<script>fan-in</script>",
        nextAction: "<style>next</style>",
        managerActionHint: "<iframe>hint</iframe>",
        lastReworkReason: "<b>rework</b>",
        lastReworkAt: "rework-time",
        reworkContext: { quickSummary: "<i>quick</i>", historySummary: "<svg>history</svg>" },
        reworkTargetAgentIds: ["<img src=x>target"],
        reasons: ["<script>reason</script>"],
        checkLines: ["<style>check</style>"],
        delegationResults: [{
          agentId: "agent:<&",
          role: "reviewer",
          status: "success",
          summary: "<template>lane</template>",
          taskId: "lane-task:<&",
          outputPath: "lane-output:<&",
        }],
        reviewPath: "review:<&",
        commanderPlanPath: "commander-plan:<&",
        workOrderPaths: ["work-order:<&"],
      },
      learningReviewInput: {
        summary: { headline: "<img src=x>Learning headline" },
        summaryLines: [malicious.learningLine, "summary-2", "summary-3", "summary-4", "summary-truncated"],
        nudges: ["<script>Nudge</script>", "nudge-2", "nudge-3", "nudge-4", "nudge-truncated"],
      },
      actionableReviews: [{
        id: "review:<&",
        title: malicious.reviewTitle,
        suggestionType: "method_candidate",
        suggestionId: "suggestion:<&",
        experienceType: "method",
        experienceCandidateId: "candidate:<&",
        reviewer: "<img src=x>reviewer",
        status: "pending",
      }],
      actionableCheckpoints: [{
        id: "checkpoint:<&",
        nodeId: "node:<&",
        title: malicious.checkpointTitle,
        reviewer: "<svg>checkpoint reviewer</svg>",
        status: "approved",
        slaAt: "checkpoint-sla",
      }],
      governanceConfigPath: "governance-config:<&",
      notificationsPath: "notifications:<&",
      notificationDispatchesPath: "dispatches:<&",
    };

    expect(() => feature.renderGoalReviewGovernancePanel(goal, payload)).not.toThrow();
    expect(panel.querySelectorAll(":scope > .goal-summary-header")).toHaveLength(1);
    expect(panel.querySelectorAll(":scope > .goal-summary-grid > .goal-summary-item")).toHaveLength(7);
    expect(panel.textContent).toContain(malicious.freshness);
    expect(panel.textContent).toContain(malicious.bridgeTitle);
    expect(panel.textContent).toContain(malicious.commanderTitle);
    expect(panel.textContent).toContain(malicious.learningLine);
    expect(panel.textContent).toContain(malicious.reviewTitle);
    expect(panel.textContent).toContain(malicious.checkpointTitle);
    expect(panel.textContent).toContain(malicious.notification);
    expect(panel.textContent).toContain(malicious.dispatch);
    expect(panel.textContent).not.toContain("summary-truncated");
    expect(panel.textContent).not.toContain("nudge-truncated");
    expect(panel.textContent).not.toContain("notification-0");
    expect(panel.textContent).not.toContain("channel-0");
    expect(panel.querySelector('[data-goal-approval-scan]')?.getAttribute("data-goal-approval-scan")).toBe(goal.id);
    expect(panel.querySelector('[data-goal-open-experience="true"]')?.getAttribute("data-goal-open-experience-candidate-id")).toBe("candidate:<&");
    expect(panel.querySelector('[data-goal-suggestion-decision="accepted"]')?.getAttribute("data-goal-suggestion-review-id")).toBe("review:<&");
    expect(panel.querySelector('[data-goal-checkpoint-action="approve"]')?.getAttribute("data-goal-checkpoint-id")).toBe("checkpoint:<&");
    expect([...panel.querySelectorAll("[data-open-task-id]")].some((item) => item.getAttribute("data-open-task-id") === "task:<&")).toBe(true);
    expect([...panel.querySelectorAll("[data-open-source]")].some((item) => item.getAttribute("data-open-source") === "artifact:<&")).toBe(true);
    expect(panel.querySelector("img, svg, script, style, iframe, b, i, template, time, [onerror], [onload]")).toBeNull();

    globalThis.BELLDANDY_WEB_CONFIG = { governanceDetailMode: "compact" };
    feature.renderGoalReviewGovernancePanel(goal, payload);
    expect(panel.textContent).not.toContain("Commander Review / Fan-in");
    expect(panel.textContent).not.toContain("Bridge 治理摘要");
    expect(panel.textContent).not.toContain("Learning / Review Input");
    expect(panel.textContent).not.toContain("最近通知");
    expect(panel.textContent).toContain(malicious.reviewTitle);
    expect(panel.textContent).toContain(malicious.checkpointTitle);

    feature.renderGoalReviewGovernancePanelError('<img src=x>governance error');
    expect(panel.children).toHaveLength(1);
    expect(panel.firstElementChild.textContent).toBe('<img src=x>governance error');
  });
});
