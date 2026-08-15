import { describe, expect, it } from "vitest";

import {
  buildLaunchSpecPromptDeltas,
  buildToolResultPromptDeltas,
  buildToolFailureRecoveryPromptDelta,
  buildToolPostVerificationPromptDelta,
  collectSystemPromptDeltaTexts,
} from "./runtime-prompt-deltas.js";

describe("buildLaunchSpecPromptDeltas", () => {
  it("builds role and tool-selection deltas from a launch spec", () => {
    const deltas = buildLaunchSpecPromptDeltas({
      profileId: "coder",
      role: "verifier",
      permissionMode: "confirm",
      allowedToolFamilies: ["workspace-read", "command-exec"],
      maxToolRiskLevel: "high",
      toolSet: ["file_read", "terminal", "log_read"],
      policySummary: "Verification-first run.",
      delegationProtocol: {
        source: "goal_verifier",
        intent: {
          kind: "verifier_handoff",
          summary: "Review delegated results",
          role: "verifier",
        },
        contextPolicy: {
          includeParentConversation: true,
          includeStructuredContext: true,
          contextKeys: ["goalId"],
        },
        expectedDeliverable: {
          format: "verification_report",
          summary: "Verification report with findings.",
        },
        aggregationPolicy: {
          mode: "verifier_fan_in",
          summarizeFailures: true,
        },
      launchDefaults: {
        permissionMode: "confirm",
        allowedToolFamilies: ["workspace-read", "command-exec"],
        maxToolRiskLevel: "high",
      },
      ownership: {
        scopeSummary: "Review delegated verifier output only.",
        outOfScope: ["Implement fixes"],
      },
      acceptance: {
        doneDefinition: "State whether the verifier output is ready for handoff.",
        verificationHints: ["Check findings", "Check evidence"],
      },
        deliverableContract: {
          format: "verification_report",
          requiredSections: ["Findings", "Evidence"],
        },
        team: {
          id: "team-1",
          mode: "verify_swarm",
          sharedGoal: "Verify delegated lanes before manager fan-in.",
          managerAgentId: "default",
          currentLaneId: "lane_verifier",
          memberRoster: [
            {
              laneId: "lane_coder",
              agentId: "coder",
              role: "coder",
              scopeSummary: "Implement the patch lane.",
              handoffTo: ["lane_verifier"],
            },
            {
              laneId: "lane_verifier",
              agentId: "verifier",
              role: "verifier",
              scopeSummary: "Review delegated results before closure.",
              dependsOn: ["lane_coder"],
            },
          ],
        },
      },
    });

    expect(deltas.map((delta) => delta.deltaType)).toEqual([
      "role-execution-policy",
      "tool-selection-policy",
      "team-topology-and-ownership",
    ]);
    expect(deltas[0]?.text).toContain("operate as `verifier`");
    expect(deltas[1]?.text).toContain("Allowed tool families: workspace-read, command-exec");
    expect(deltas[1]?.text).toContain("Expected deliverable: verification_report | Verification report with findings.");
    expect(deltas[1]?.text).toContain("Owned scope: Review delegated verifier output only.");
    expect(deltas[1]?.text).toContain("Done definition: State whether the verifier output is ready for handoff.");
    expect(deltas[1]?.text).toContain("Deliverable required sections: Findings, Evidence");
    expect(deltas[1]?.text).toContain("Verifier handoff rule: stay inside verification scope");
    expect(deltas[2]?.text).toContain("## Team Topology and Ownership");
    expect(deltas[2]?.text).toContain("Team mode: verify_swarm");
    expect(deltas[2]?.text).toContain("Current lane: lane_verifier");
    expect(deltas[2]?.text).toContain("lane_coder | agent=coder | role=coder | owns=Implement the patch lane. | handoff_to=lane_verifier");

    expect(collectSystemPromptDeltaTexts(deltas)).toEqual([
      expect.stringContaining("Run Role Override"),
      expect.stringContaining("Run Tool Selection Constraints"),
      expect.stringContaining("Team Topology and Ownership"),
    ]);
  });
});

describe("tool result prompt deltas", () => {
  it("builds a failure recovery delta with classified guidance", () => {
    const delta = buildToolFailureRecoveryPromptDelta({
      toolCallId: "call-1",
      toolName: "echo",
      error: "Permission denied by launch policy",
    });

    expect(delta).toBeDefined();
    expect(delta?.deltaType).toBe("tool-failure-recovery");
    expect(delta?.text).toContain("## Tool Failure Recovery");
    expect(delta?.text).toContain("Failure class: permission_or_policy");
    expect(delta?.text).toContain("Do not work around policy or permission failures");
  });

  it("prefers structured failureKind over error-text fallback", () => {
    const delta = buildToolFailureRecoveryPromptDelta({
      toolCallId: "call-1b",
      toolName: "file_read",
      error: "unexpected opaque failure",
      failureKind: "input_error",
    });

    expect(delta).toBeDefined();
    expect(delta?.text).toContain("Failure class: input_error");
  });

  it("surfaces machine-readable argument correction hints in failure recovery guidance", () => {
    const deltas = buildToolResultPromptDeltas({
      result: {
        id: "call-1c",
        name: "tool_search",
        success: false,
        output: "",
        error: "工具参数未通过预检：缺少必填参数 `query`。",
        failureKind: "input_error",
        metadata: {
          repairAction: "tool_arguments_invalid",
          argumentValidation: {
            correctionHints: [
              "补上必填字段 `query`。",
              "把 `select` 改成字符串数组，例如 `{\"select\":[\"...\"]}`。",
            ],
          },
        },
      },
    });

    expect(deltas[0]).toBeDefined();
    expect(deltas[0]?.text).toContain("Failure class: input_error");
    expect(deltas[0]?.text).toContain("补上必填字段 `query`");
    expect(deltas[0]?.text).toContain("select");
  });

  it("directs an invalid apply_patch retry to a real hunk instead of another unchanged read", () => {
    const delta = buildToolFailureRecoveryPromptDelta({
      toolCallId: "call-empty-patch",
      toolName: "apply_patch",
      error: "Invalid patch hunk: Update file hunk for path 'source.ts' is empty",
      failureKind: "input_error",
      metadata: {
        repairAction: "apply_patch_input_invalid",
        argumentValidation: {
          blocked: true,
          correctionHints: [
            "Retry with at least one non-empty change hunk containing context and actual + or - lines.",
          ],
        },
      },
    });

    expect(delta).toBeDefined();
    expect(delta?.metadata).toMatchObject({
      toolName: "apply_patch",
      failureClass: "input_error",
      repairAction: "apply_patch_input_invalid",
    });
    expect(delta?.text).toContain("The patch parser rejected the request before any workspace mutation");
    expect(delta?.text).toContain("correct the patch syntax directly");
    expect(delta?.text).toContain("non-empty change hunk");
    expect(delta?.text).not.toContain("A read-only inspection step is usually safer");
  });

  it("builds a post-verification delta for write-like tools", () => {
    const delta = buildToolPostVerificationPromptDelta({
      toolCallId: "call-2",
      toolName: "file_write",
    });

    expect(delta).toBeDefined();
    expect(delta?.deltaType).toBe("tool-post-verification");
    expect(delta?.text).toContain("## Tool Post-Action Verification");
    expect(delta?.text).toContain("Tool: `file_write`");
    expect(delta?.text).toContain("Verify the effect before claiming success");
  });

  it("builds a short follow-up delta after successful tool_search loads exact deferred schemas", () => {
    const deltas = buildToolResultPromptDeltas({
      result: {
        id: "call-tool-search-1",
        name: "tool_search",
        success: true,
        output: [
          "Loaded deferred tools for this conversation:",
          "- mcp_starweaver_central_starweaver_runtime_describe",
          "- mcp_starweaver_central_starweaver_wake_signals_peek",
          "",
          "Currently loaded deferred tools in this conversation:",
          "- mcp_starweaver_central_starweaver_runtime_describe",
          "- mcp_starweaver_central_starweaver_wake_signals_peek",
        ].join("\n"),
      },
    });

    const followUpDelta = deltas.find((delta) => delta.deltaType === "tool-search-follow-up");
    expect(followUpDelta).toBeDefined();
    expect(followUpDelta?.text).toContain("exact deferred schemas are already loaded");
    expect(followUpDelta?.text).toContain("mcp_starweaver_central_starweaver_runtime_describe");
    expect(followUpDelta?.text).toContain("Do not repeat a broad `tool_search`");
    expect(followUpDelta?.text).toContain("If the latest user request still needs them");
    expect(followUpDelta?.text).toContain("not a standalone instruction to replay an older plan");
  });

  it("does not build tool_search follow-up delta when no deferred schemas are loaded", () => {
    const deltas = buildToolResultPromptDeltas({
      result: {
        id: "call-tool-search-2",
        name: "tool_search",
        success: true,
        output: [
          "Currently loaded deferred tools in this conversation:",
          "- (none)",
        ].join("\n"),
      },
    });

    expect(deltas.find((delta) => delta.deltaType === "tool-search-follow-up")).toBeUndefined();
  });

  it("builds a delegation result review delta from structured delegation arguments", () => {
    const delta = buildToolPostVerificationPromptDelta({
      toolCallId: "call-3",
      toolName: "delegate_task",
      requestArguments: {
        ownership: {
          scope_summary: "Review the runtime prompt delta patch only.",
          out_of_scope: ["Implement fixes"],
        },
        acceptance: {
          done_definition: "Returned result states whether the patch is acceptable.",
          verification_hints: ["Check findings", "Check missing tests"],
        },
        deliverable_contract: {
          format: "verification_report",
          required_sections: ["Findings", "Recommendation"],
        },
      },
    });

    expect(delta).toBeDefined();
    expect(delta?.text).toContain("## Delegation Result Review");
    expect(delta?.text).toContain("Owned scope: Review the runtime prompt delta patch only.");
    expect(delta?.text).toContain("Done definition: Returned result states whether the patch is acceptable.");
    expect(delta?.text).toContain("Deliverable contract: verification_report | sections: Findings | Recommendation");
  });

  it("adds delegation review guidance when a delegated result is rejected by the acceptance gate", () => {
    const deltas = buildToolResultPromptDeltas({
      result: {
        id: "call-4",
        name: "delegate_task",
        success: false,
        output: "worker finished",
        error: "Delegation acceptance gate rejected the sub-agent result. Missing required sections: Recommendation",
        metadata: {
          delegationResults: [{
            label: "Agent verifier",
            workerSuccess: true,
            accepted: false,
            acceptanceGate: {
              enforced: true,
              accepted: false,
              summary: "Delegated result failed the structured acceptance gate: Missing required sections: Recommendation",
              reasons: ["Missing required sections: Recommendation"],
              deliverableFormat: "verification_report",
              requiredSections: ["Findings", "Recommendation"],
              missingRequiredSections: ["Recommendation"],
              acceptanceCheckStatus: "missing",
              rejectionConfidence: "high",
              managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
              contractSpecificChecks: [
                { id: "verification_report_findings", label: "Verification report is missing a findings section.", status: "passed", enforced: true, evidence: "Findings" },
                { id: "verification_report_recommendation", label: "Verification report is missing a recommendation or verdict section.", status: "failed", enforced: true },
              ],
            },
          }],
          acceptedCount: 0,
          gateRejectedCount: 1,
          workerSuccessCount: 1,
          followUpStrategy: {
            mode: "single",
            summary: "Suggested next step: retry with follow-up delegation: Agent verifier.",
            recommendedRuntimeAction: "retry_delegation",
            retryLabels: ["Agent verifier"],
            highPriorityLabels: ["Agent verifier"],
            verifierHandoffLabels: ["Agent verifier"],
            items: [
              {
                label: "Agent verifier",
                action: "retry",
                reason: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
                recommendedRuntimeAction: "retry_delegation",
                priority: "high",
                verificationHints: ["Check findings", "Check missing tests"],
                template: {
                  toolName: "delegate_task",
                  agentId: "verifier",
                  instruction: "Review the runtime prompt delta patch only.\n\nFollow-up requirement: Delegated result failed the structured acceptance gate: Missing required sections: Recommendation",
                  acceptance: {
                    doneDefinition: "Returned result states whether the patch is acceptable.",
                    verificationHints: ["Check findings", "Check missing tests"],
                  },
                  deliverableContract: {
                    format: "verification_report",
                    requiredSections: ["Findings", "Recommendation"],
                  },
                },
                verifierTemplate: {
                  toolName: "delegate_task",
                  agentId: "verifier",
                  instruction: "Verify whether the delegated runtime prompt delta review is safe to accept.",
                  acceptance: {
                    doneDefinition: "Returned result states whether the patch is acceptable.",
                    verificationHints: ["Check findings", "Check missing tests"],
                  },
                  deliverableContract: {
                    format: "verification_report",
                    requiredSections: ["Findings", "Recommendation", "Done Definition Check", "Required Sections Audit"],
                  },
                },
              },
            ],
          },
        },
      },
      requestArguments: {
        ownership: {
          scope_summary: "Review the runtime prompt delta patch only.",
        },
        acceptance: {
          done_definition: "Returned result states whether the patch is acceptable.",
          verification_hints: ["Check findings", "Check missing tests"],
        },
        deliverable_contract: {
          format: "verification_report",
          required_sections: ["Findings", "Recommendation"],
        },
      },
    });

    expect(deltas.map((delta) => delta.deltaType)).toEqual([
      "tool-failure-recovery",
      "tool-post-verification",
    ]);
    expect(deltas[0]?.text).toContain("## Tool Failure Recovery");
    expect(deltas[0]?.text).toContain("Delegation gate confidence: high");
    expect(deltas[0]?.text).toContain("Suggested follow-up: Suggested next step: retry with follow-up delegation: Agent verifier.");
    expect(deltas[0]?.text).toContain("Suggested runtime action: retry_delegation");
    expect(deltas[0]?.text).toContain("High-priority follow-up items: Agent verifier");
    expect(deltas[0]?.metadata).toMatchObject({
      delegationResult: {
        resultCount: 1,
        acceptedCount: 0,
        gateRejectedCount: 1,
        primaryResult: {
          accepted: false,
          acceptanceGate: {
            accepted: false,
            rejectionConfidence: "high",
          },
        },
      },
    });
    expect(deltas[1]?.text).toContain("## Delegation Result Review");
    expect(deltas[1]?.text).toContain("Done definition: Returned result states whether the patch is acceptable.");
    expect(deltas[1]?.text).toContain("Manager action: reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.");
    expect(deltas[1]?.text).toContain("## Suggested Follow-Up Strategy");
    expect(deltas[1]?.text).toContain("Recommended runtime action: retry_delegation");
    expect(deltas[1]?.text).toContain("Retry with follow-up delegation: Agent verifier");
    expect(deltas[1]?.text).toContain("High-priority follow-up: Agent verifier");
    expect(deltas[1]?.text).toContain("Verifier handoff available: Agent verifier");
    expect(deltas[1]?.text).toContain("Runtime action: retry_delegation [high]");
    expect(deltas[1]?.text).toContain("Optional verifier handoff: delegate_task; agent_id=verifier");
    expect(deltas[1]?.metadata).toMatchObject({
      delegationResult: {
        resultCount: 1,
        primaryResult: {
          acceptanceGate: {
            deliverableFormat: "verification_report",
            accepted: false,
          },
        },
        followUpStrategy: {
          mode: "single",
          recommendedRuntimeAction: "retry_delegation",
          itemCount: 1,
          retryLabels: ["Agent verifier"],
          highPriorityLabels: ["Agent verifier"],
          verifierHandoffLabels: ["Agent verifier"],
        },
      },
    });
  });

  it("adds parallel fan-in follow-up guidance for mixed delegation outcomes", () => {
    const delta = buildToolPostVerificationPromptDelta({
      toolCallId: "call-5",
      toolName: "delegate_parallel",
      requestArguments: {
        tasks: [
          {
            instruction: "Review patch A",
            acceptance: {
              verification_hints: ["Check readiness note"],
            },
          },
          {
            instruction: "Review patch B",
            acceptance: {
              verification_hints: ["Check recommendation"],
            },
            deliverable_contract: {
              format: "verification_report",
              required_sections: ["Findings", "Recommendation"],
            },
          },
        ],
      },
      resultMetadata: {
        delegationResults: [
          {
            label: "Task 1 / default",
            workerSuccess: true,
            accepted: true,
            acceptanceGate: {
              enforced: true,
              accepted: true,
              summary: "Delegated result passed the structured acceptance gate.",
              reasons: [],
              acceptanceCheckStatus: "not_requested",
            },
          },
          {
            label: "Task 2 / default",
            workerSuccess: true,
            accepted: false,
            acceptanceGate: {
              enforced: true,
              accepted: false,
              summary: "Delegated result failed the structured acceptance gate: Missing required sections: Recommendation",
              reasons: ["Missing required sections: Recommendation"],
              acceptanceCheckStatus: "missing",
              rejectionConfidence: "high",
              managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
            },
          },
        ],
        followUpStrategy: {
          mode: "parallel",
          summary: "Parallel fan-in strategy: accept now: Task 1 / default; retry with follow-up delegation: Task 2 / default.",
          recommendedRuntimeAction: "retry_delegation",
          acceptedLabels: ["Task 1 / default"],
          retryLabels: ["Task 2 / default"],
          verifierHandoffLabels: ["Task 2 / default"],
          items: [
            {
              label: "Task 1 / default",
              action: "accept",
              reason: "Delegated result passed the acceptance gate.",
              recommendedRuntimeAction: "accept_result",
              priority: "normal",
            },
            {
              label: "Task 2 / default",
              action: "retry",
              reason: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
              recommendedRuntimeAction: "retry_delegation",
              priority: "high",
              verificationHints: ["Check recommendation"],
              template: {
                toolName: "delegate_task",
                instruction: "Review patch B\n\nFollow-up requirement: Delegated result failed the structured acceptance gate: Missing required sections: Recommendation",
                acceptance: {
                  verificationHints: ["Check recommendation"],
                },
                deliverableContract: {
                  format: "verification_report",
                  requiredSections: ["Findings", "Recommendation"],
                },
              },
              verifierTemplate: {
                toolName: "delegate_task",
                agentId: "verifier",
                instruction: "Verify whether Task 2 / default is safe to accept.",
                acceptance: {
                  verificationHints: ["Check recommendation"],
                },
                deliverableContract: {
                  format: "verification_report",
                  requiredSections: ["Findings", "Recommendation"],
                },
              },
            },
          ],
        },
      },
    });

    expect(delta).toBeDefined();
    expect(delta?.text).toContain("Summary: Parallel fan-in strategy: accept now: Task 1 / default; retry with follow-up delegation: Task 2 / default.");
    expect(delta?.text).toContain("Recommended runtime action: retry_delegation");
    expect(delta?.text).toContain("Accept now: Task 1 / default");
    expect(delta?.text).toContain("Retry with follow-up delegation: Task 2 / default");
    expect(delta?.text).toContain("Verifier handoff available: Task 2 / default");
    expect(delta?.text).toContain("Task 2 / default: retry");
    expect(delta?.text).toContain("Runtime action: retry_delegation [high]");
  });

  it("adds team handoff and fan-in deltas for parallel team results", () => {
    const deltas = buildToolResultPromptDeltas({
      result: {
        id: "call-6",
        name: "delegate_parallel",
        success: true,
        output: "parallel done",
        metadata: {
          delegationResults: [
            {
              label: "Task 1 / coder",
              laneId: "lane_1",
              scopeSummary: "Own lane A implementation only.",
              handoffTo: ["lane_2"],
              workerSuccess: true,
              accepted: true,
              acceptanceGate: {
                enforced: false,
                accepted: true,
                summary: "Delegated result passed the structured acceptance gate.",
                reasons: [],
                acceptanceCheckStatus: "not_requested",
              },
            },
            {
              label: "Task 2 / verifier",
              laneId: "lane_2",
              dependsOn: ["lane_1"],
              workerSuccess: true,
              accepted: false,
              acceptanceGate: {
                enforced: true,
                accepted: false,
                summary: "Delegated result failed the structured acceptance gate: Missing required sections: Recommendation",
                reasons: ["Missing required sections: Recommendation"],
                acceptanceCheckStatus: "missing",
                rejectionConfidence: "high",
                managerActionHint: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
              },
            },
          ],
          followUpStrategy: {
            mode: "parallel",
            summary: "Parallel fan-in strategy: accept now: Task 1 / coder; retry with follow-up delegation: Task 2 / verifier.",
            recommendedRuntimeAction: "retry_delegation",
            acceptedLabels: ["Task 1 / coder"],
            retryLabels: ["Task 2 / verifier"],
            verifierHandoffLabels: ["Task 2 / verifier"],
            items: [
              {
                label: "Task 1 / coder",
                action: "accept",
                reason: "Delegated result passed the acceptance gate.",
                recommendedRuntimeAction: "accept_result",
                priority: "normal",
              },
              {
                label: "Task 2 / verifier",
                action: "retry",
                reason: "reject this handoff and re-delegate with explicit section requirements or a clearer deliverable contract.",
                recommendedRuntimeAction: "retry_delegation",
                priority: "high",
              },
            ],
          },
          team: {
            id: "team-12",
            mode: "parallel_subtasks",
            sharedGoal: "Implement lane A and verify it before manager fan-in.",
            managerAgentId: "default",
            memberRoster: [
              {
                laneId: "lane_1",
                agentId: "coder",
                role: "coder",
                scopeSummary: "Own lane A implementation only.",
                handoffTo: ["lane_2"],
              },
              {
                laneId: "lane_2",
                agentId: "verifier",
                role: "verifier",
                dependsOn: ["lane_1"],
              },
            ],
          },
        },
      },
      requestArguments: {
        tasks: [
          { instruction: "Implement lane A" },
          { instruction: "Verify lane A" },
        ],
      },
    });

    expect(deltas.map((delta) => delta.deltaType)).toEqual([
      "tool-post-verification",
      "team-handoff-review",
      "team-fan-in-triage",
      "team-completion-gate",
    ]);
    expect(deltas[0]?.text).toContain("## Team Result Context");
    expect(deltas[0]?.text).toContain("Team roster: lane_1 | role=coder | owns=Own lane A implementation only. | handoff_to=lane_2");
    expect(deltas[1]?.text).toContain("## Team Handoff Review");
    expect(deltas[1]?.text).toContain("Active handoff lanes: Task 1 / coder -> lane_2");
    expect(deltas[1]?.text).toContain("Declared dependencies: Task 2 / verifier <= lane_1");
    expect(deltas[2]?.text).toContain("## Team Fan-In Triage");
    expect(deltas[2]?.text).toContain("Safe to integrate now: Task 1 / coder");
    expect(deltas[2]?.text).toContain("Needs retry or re-delegation: Task 2 / verifier");
    expect(deltas[2]?.text).toContain("Verifier handoff candidates: Task 2 / verifier");
    expect(deltas[3]?.text).toContain("## Team Completion Gate");
    expect(deltas[3]?.text).toContain("Status: pending");
    expect(deltas[3]?.text).toContain("Final fan-in verdict: hold_fan_in");
    expect(deltas[3]?.text).toContain("Retry lanes: lane_2");
    expect(deltas[3]?.metadata).toMatchObject({
      teamId: "team-12",
      completionGate: {
        status: "pending",
        finalFanInVerdict: "hold_fan_in",
        retryLaneIds: ["lane_2"],
      },
    });
  });

  it("mechanically trims oversized delegation arguments and follow-up templates before injecting review deltas", () => {
    const hugeInstruction = `Review patch ${"A".repeat(900)}`;
    const hugeReason = `Missing evidence ${"B".repeat(900)}`;
    const hugeSection = `Section-${"C".repeat(180)}`;

    const delta = buildToolPostVerificationPromptDelta({
      toolCallId: "call-7",
      toolName: "delegate_task",
      requestArguments: {
        ownership: {
          scope_summary: `Scope ${"D".repeat(700)}`,
          out_of_scope: [
            `Out ${"E".repeat(260)}`,
            `Also out ${"F".repeat(260)}`,
            `Third out ${"G".repeat(260)}`,
            `Fourth out ${"H".repeat(260)}`,
          ],
        },
        acceptance: {
          done_definition: `Done ${"I".repeat(700)}`,
          verification_hints: [
            `Hint ${"J".repeat(220)}`,
            `Hint ${"K".repeat(220)}`,
            `Hint ${"L".repeat(220)}`,
            `Hint ${"M".repeat(220)}`,
          ],
        },
        deliverable_contract: {
          format: "verification_report",
          required_sections: [hugeSection, `${hugeSection}-2`, `${hugeSection}-3`, `${hugeSection}-4`, `${hugeSection}-5`],
        },
      },
      resultMetadata: {
        delegationResults: [{
          label: "Agent verifier",
          workerSuccess: true,
          accepted: false,
          acceptanceGate: {
            enforced: true,
            accepted: false,
            summary: hugeReason,
            reasons: [hugeReason, `${hugeReason}-2`, `${hugeReason}-3`, `${hugeReason}-4`],
            acceptanceCheckStatus: "missing",
            rejectionConfidence: "high",
            managerActionHint: hugeReason,
          },
        }],
        followUpStrategy: {
          mode: "single",
          summary: hugeReason,
          recommendedRuntimeAction: "retry_delegation",
          retryLabels: ["Agent verifier"],
          highPriorityLabels: ["Agent verifier"],
          verifierHandoffLabels: ["Agent verifier"],
          items: [{
            label: "Agent verifier",
            action: "retry",
            reason: hugeReason,
            recommendedRuntimeAction: "retry_delegation",
            priority: "high",
            template: {
              toolName: "delegate_task",
              agentId: "verifier",
              instruction: hugeInstruction,
              acceptance: {
                verificationHints: [
                  `Template hint ${"N".repeat(240)}`,
                  `Template hint ${"O".repeat(240)}`,
                  `Template hint ${"P".repeat(240)}`,
                  `Template hint ${"Q".repeat(240)}`,
                ],
              },
              deliverableContract: {
                format: "verification_report",
                requiredSections: [hugeSection, `${hugeSection}-2`, `${hugeSection}-3`, `${hugeSection}-4`, `${hugeSection}-5`],
              },
            },
            verifierTemplate: {
              toolName: "delegate_task",
              agentId: "verifier",
              instruction: hugeInstruction,
              acceptance: {
                verificationHints: [
                  `Verifier hint ${"R".repeat(240)}`,
                  `Verifier hint ${"S".repeat(240)}`,
                  `Verifier hint ${"T".repeat(240)}`,
                  `Verifier hint ${"U".repeat(240)}`,
                ],
              },
              deliverableContract: {
                format: "verification_report",
                requiredSections: [hugeSection, `${hugeSection}-2`, `${hugeSection}-3`, `${hugeSection}-4`, `${hugeSection}-5`],
              },
            },
          }],
        },
      },
    });

    expect(delta).toBeDefined();
    expect(delta?.text).toContain("## Delegation Result Review");
    expect(delta?.text).toContain("(+1 more)");
    expect(delta?.text).toContain("...");
    expect(delta?.text.length).toBeLessThan(4500);
    expect(delta?.text).not.toContain("A".repeat(500));
    expect(delta?.text).not.toContain("B".repeat(500));
    expect(delta?.text).not.toContain("C".repeat(500));
  });
});
