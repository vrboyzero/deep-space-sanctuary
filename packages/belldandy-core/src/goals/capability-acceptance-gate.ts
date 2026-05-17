import type {
  GoalCapabilityExecutionMode,
  GoalCapabilityPlanAcceptanceGate,
  GoalCapabilityPlanAcceptanceGateCheck,
  GoalCapabilityPlanOrchestration,
  GoalCapabilityPlanStatus,
  GoalCapabilityPlanSubAgent,
} from "./types.js";

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function difference(left: string[], right: string[]): string[] {
  if (left.length === 0) return [];
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function buildCheck(input: {
  id: string;
  label: string;
  enforced: boolean;
  passed: boolean;
  evidence?: string;
}): GoalCapabilityPlanAcceptanceGateCheck {
  return {
    id: input.id,
    label: input.label,
    enforced: input.enforced,
    status: input.passed ? "passed" : "failed",
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

function summarizeList(values: string[]): string | undefined {
  return values.length > 0 ? values.join(", ") : undefined;
}

function classifyGateRejectionConfidence(input: {
  handoffFailed: boolean;
  resultFailed: boolean;
  missingSourceTaskIds: string[];
  missingEvidenceTaskIds: string[];
  approvalWithHighSeverityFindings: boolean;
  missingSourceAgentIds: string[];
  completedHandoffWithoutCompletedResult: boolean;
  unknownRecommendation: boolean;
  missingSupportingFindings: boolean;
}): GoalCapabilityPlanAcceptanceGate["rejectionConfidence"] {
  if (
    input.handoffFailed
    || input.resultFailed
    || input.missingSourceTaskIds.length > 0
    || input.missingEvidenceTaskIds.length > 0
    || input.approvalWithHighSeverityFindings
  ) {
    return "high";
  }
  if (
    input.missingSourceAgentIds.length > 0
    || input.completedHandoffWithoutCompletedResult
    || input.unknownRecommendation
    || input.missingSupportingFindings
  ) {
    return "medium";
  }
  return "low";
}

function buildRejectedManagerActionHint(input: {
  missingSourceTaskIds: string[];
  missingEvidenceTaskIds: string[];
  handoffFailed: boolean;
  resultFailed: boolean;
  approvalWithHighSeverityFindings: boolean;
  completedHandoffWithoutCompletedResult: boolean;
}): string {
  if (input.missingSourceTaskIds.length > 0 || input.missingEvidenceTaskIds.length > 0) {
    return "Do not close the goals fan-in yet. First reconcile sourceTaskIds and evidenceTaskIds so the verifier result can be traced back to every delegated source task.";
  }
  if (input.handoffFailed || input.resultFailed) {
    return "Treat the verifier path as blocked. Re-run or repair the verifier handoff before integrating this capability plan as complete.";
  }
  if (input.approvalWithHighSeverityFindings) {
    return "Keep the plan blocked until the verifier recommendation and finding severities are consistent.";
  }
  if (input.completedHandoffWithoutCompletedResult) {
    return "Record a completed verifier result before treating the fan-in as accepted.";
  }
  return "Keep this capability plan out of the final fan-in until the verifier contract issues are corrected.";
}

export function evaluateGoalCapabilityPlanAcceptanceGate(input: {
  status: GoalCapabilityPlanStatus;
  executionMode: GoalCapabilityExecutionMode;
  subAgents: GoalCapabilityPlanSubAgent[];
  orchestration?: GoalCapabilityPlanOrchestration;
}): GoalCapabilityPlanAcceptanceGate | undefined {
  const orchestration = input.orchestration;
  if (!orchestration) {
    return undefined;
  }
  const rolePolicy = orchestration.coordinationPlan?.rolePolicy;
  const verifierHandoff = orchestration.verifierHandoff;
  const verifierResult = orchestration.verifierResult;
  if (rolePolicy?.fanInStrategy === "commander_review") {
    const successfulDelegationResults = (orchestration.delegationResults ?? []).filter((item) => item.status === "success");
    const failedDelegationResults = (orchestration.delegationResults ?? []).filter((item) => item.status === "failed");
    const pendingDelegationResults = (orchestration.delegationResults ?? []).filter((item) => item.status !== "success" && item.status !== "failed");
    const requiredSourceAgentIds = uniqueStrings(successfulDelegationResults.map((item) => item.agentId));
    const rejectedReasons = uniqueStrings([
      failedDelegationResults.length > 0
        ? `Commander review detected failed delegated work: ${failedDelegationResults.map((item) => item.agentId).join(", ")}.`
        : undefined,
      orchestration.notes?.find((item) => /rework|返工/i.test(item))
        ? "Commander review notes already marked this run as requiring rework."
        : undefined,
    ]);
    const checks: GoalCapabilityPlanAcceptanceGateCheck[] = [
      buildCheck({
        id: "commander_successful_delegations",
        label: "Commander review sees at least one successful delegated source",
        enforced: input.executionMode !== "single_agent",
        passed: input.executionMode === "single_agent" || successfulDelegationResults.length > 0,
        evidence: successfulDelegationResults.length > 0
          ? `sources=${successfulDelegationResults.map((item) => item.agentId).join(", ")}`
          : "sources=0",
      }),
      buildCheck({
        id: "commander_no_failed_delegations",
        label: "Commander review has no failed delegated source",
        enforced: true,
        passed: failedDelegationResults.length === 0,
        evidence: failedDelegationResults.length > 0
          ? `failed=${failedDelegationResults.map((item) => item.agentId).join(", ")}`
          : "failed=0",
      }),
      buildCheck({
        id: "commander_no_pending_delegations",
        label: "Commander review is not waiting on pending delegated source",
        enforced: true,
        passed: pendingDelegationResults.length === 0,
        evidence: pendingDelegationResults.length > 0
          ? `pending=${pendingDelegationResults.map((item) => item.agentId).join(", ")}`
          : "pending=0",
      }),
    ];
    if (rejectedReasons.length > 0) {
      return {
        status: "rejected",
        summary: `Commander review rejected this capability plan: ${rejectedReasons.join(" | ")}`,
        reasons: rejectedReasons,
        ...(requiredSourceAgentIds.length > 0 ? { requiredSourceAgentIds } : {}),
        contractSpecificChecks: checks,
        rejectionConfidence: failedDelegationResults.length > 0 ? "high" : "medium",
        managerActionHint: "Issue a rework order or replace the failed lane before closing the commander fan-in.",
      };
    }
    if (pendingDelegationResults.length > 0 || (input.executionMode !== "single_agent" && successfulDelegationResults.length === 0)) {
      const pendingReasons = uniqueStrings([
        pendingDelegationResults.length > 0
          ? `Commander review is still waiting on delegated lanes: ${pendingDelegationResults.map((item) => item.agentId).join(", ")}.`
          : undefined,
        input.executionMode !== "single_agent" && successfulDelegationResults.length === 0
          ? "Commander review has no successful delegated source yet."
          : undefined,
      ]);
      return {
        status: "pending",
        summary: `Commander review is still pending: ${pendingReasons.join(" | ")}`,
        reasons: pendingReasons,
        contractSpecificChecks: checks,
        managerActionHint: "Wait for all delegated lanes to report back before closing the commander fan-in.",
      };
    }
    return {
      status: "accepted",
      summary: "Commander review fan-in is complete and can be used as the acceptance signal for this capability plan.",
      reasons: [],
      ...(requiredSourceAgentIds.length > 0 ? { requiredSourceAgentIds } : {}),
      contractSpecificChecks: checks,
      managerActionHint: "Commander review is complete enough to approve this capability plan or move the node into validating/done.",
    };
  }
  const requiresVerifierGate = rolePolicy?.fanInStrategy === "verifier_handoff"
    || Boolean(verifierHandoff)
    || Boolean(verifierResult);
  if (!requiresVerifierGate) {
    return undefined;
  }

  const successfulDelegationResults = (orchestration.delegationResults ?? []).filter((item) => item.status === "success");
  const requiredSourceAgentIds = uniqueStrings(successfulDelegationResults.map((item) => item.role === "verifier" ? undefined : item.agentId));
  const observedSourceAgentIds = uniqueStrings(verifierHandoff?.sourceAgentIds ?? []);
  const missingSourceAgentIds = difference(requiredSourceAgentIds, observedSourceAgentIds);

  const requiredSourceTaskIds = uniqueStrings(successfulDelegationResults.map((item) => item.role === "verifier" ? undefined : item.taskId));
  const observedSourceTaskIds = uniqueStrings(verifierHandoff?.sourceTaskIds ?? []);
  const missingSourceTaskIds = difference(requiredSourceTaskIds, observedSourceTaskIds);

  const requiredEvidenceTaskIds = uniqueStrings(requiredSourceTaskIds.length > 0 ? requiredSourceTaskIds : observedSourceTaskIds);
  const observedEvidenceTaskIds = uniqueStrings(verifierResult?.evidenceTaskIds ?? []);
  const missingEvidenceTaskIds = difference(requiredEvidenceTaskIds, observedEvidenceTaskIds);

  const findings = verifierResult?.findings ?? [];
  const highSeverityFindings = findings.filter((item) => item.severity === "high");
  const approvalWithHighSeverityFindings = verifierResult?.status === "completed"
    && verifierResult.recommendation === "approve"
    && highSeverityFindings.length > 0;
  const unknownRecommendation = verifierResult?.status === "completed" && verifierResult.recommendation === "unknown";
  const missingSupportingFindings = verifierResult?.status === "completed"
    && (verifierResult.recommendation === "revise" || verifierResult.recommendation === "blocked")
    && findings.length <= 0;
  const handoffFailed = verifierHandoff?.status === "failed" || verifierHandoff?.status === "skipped";
  const resultFailed = verifierResult?.status === "failed";
  const completedHandoffWithoutCompletedResult = verifierHandoff?.status === "completed"
    && verifierResult?.status !== "completed";
  const completedResultWithIncompleteHandoff = verifierResult?.status === "completed"
    && Boolean(verifierHandoff)
    && verifierHandoff?.status !== "completed";

  const checks: GoalCapabilityPlanAcceptanceGateCheck[] = [];
  const reasons: string[] = [];

  if (requiredSourceAgentIds.length > 0 && verifierHandoff) {
    checks.push(buildCheck({
      id: "fan_in_source_agents",
      label: "Verifier handoff covers every successful delegated source agent",
      enforced: true,
      passed: missingSourceAgentIds.length === 0,
      evidence: missingSourceAgentIds.length > 0
        ? `missing=${missingSourceAgentIds.join(", ")}`
        : `covered=${requiredSourceAgentIds.join(", ")}`,
    }));
    if (missingSourceAgentIds.length > 0) {
      reasons.push(`Verifier handoff is missing source agents: ${missingSourceAgentIds.join(", ")}`);
    }
  }

  if (requiredSourceTaskIds.length > 0 && verifierHandoff) {
    checks.push(buildCheck({
      id: "fan_in_source_tasks",
      label: "Verifier handoff references every successful delegated source task",
      enforced: true,
      passed: missingSourceTaskIds.length === 0,
      evidence: missingSourceTaskIds.length > 0
        ? `missing=${missingSourceTaskIds.join(", ")}`
        : `covered=${requiredSourceTaskIds.join(", ")}`,
    }));
    if (missingSourceTaskIds.length > 0) {
      reasons.push(`Verifier handoff is missing source tasks: ${missingSourceTaskIds.join(", ")}`);
    }
  }

  if (verifierHandoff) {
    checks.push(buildCheck({
      id: "verifier_handoff_state",
      label: "Verifier handoff is not failed or skipped",
      enforced: true,
      passed: !handoffFailed,
      evidence: `status=${verifierHandoff.status}`,
    }));
    if (handoffFailed) {
      reasons.push(`Verifier handoff status is ${verifierHandoff.status}.`);
    }
  }

  if (verifierResult) {
    checks.push(buildCheck({
      id: "verifier_result_state",
      label: "Verifier result is not failed",
      enforced: true,
      passed: !resultFailed,
      evidence: `status=${verifierResult.status}`,
    }));
    if (resultFailed) {
      reasons.push("Verifier result finished in a failed state.");
    }
  }

  if (completedHandoffWithoutCompletedResult) {
    checks.push(buildCheck({
      id: "verifier_result_recorded",
      label: "A completed verifier handoff records a completed verifier result",
      enforced: true,
      passed: false,
      evidence: verifierResult ? `result_status=${verifierResult.status}` : "result=missing",
    }));
    reasons.push("Verifier handoff is marked completed, but no completed verifier result was recorded.");
  }

  if (completedResultWithIncompleteHandoff && verifierHandoff) {
    checks.push(buildCheck({
      id: "verifier_handoff_alignment",
      label: "Completed verifier results align with a completed verifier handoff state",
      enforced: true,
      passed: false,
      evidence: `handoff_status=${verifierHandoff.status}`,
    }));
    reasons.push(`Verifier result is completed, but verifier handoff is still ${verifierHandoff.status}.`);
  }

  if (verifierResult?.status === "completed") {
    checks.push(buildCheck({
      id: "verifier_recommendation_known",
      label: "Completed verifier results provide a concrete recommendation",
      enforced: true,
      passed: !unknownRecommendation,
      evidence: `recommendation=${verifierResult.recommendation}`,
    }));
    if (unknownRecommendation) {
      reasons.push("Verifier result is completed but recommendation is still unknown.");
    }

    checks.push(buildCheck({
      id: "verifier_findings_support",
      label: "Revise or blocked recommendations include supporting findings",
      enforced: verifierResult.recommendation === "revise" || verifierResult.recommendation === "blocked",
      passed: !missingSupportingFindings,
      evidence: `findings=${findings.length}`,
    }));
    if (missingSupportingFindings) {
      reasons.push("Verifier result recommends revise/blocked without any supporting findings.");
    }

    checks.push(buildCheck({
      id: "verifier_approval_severity",
      label: "Approve recommendations do not carry high-severity findings",
      enforced: verifierResult.recommendation === "approve",
      passed: !approvalWithHighSeverityFindings,
      evidence: highSeverityFindings.length > 0
        ? `high=${highSeverityFindings.map((item) => item.summary).join(" | ")}`
        : "high=0",
    }));
    if (approvalWithHighSeverityFindings) {
      reasons.push("Verifier result recommends approve while still carrying high-severity findings.");
    }

    if (requiredEvidenceTaskIds.length > 0) {
      checks.push(buildCheck({
        id: "verifier_evidence_coverage",
        label: "Verifier result evidence covers every required source task",
        enforced: true,
        passed: missingEvidenceTaskIds.length === 0,
        evidence: missingEvidenceTaskIds.length > 0
          ? `missing=${missingEvidenceTaskIds.join(", ")}`
          : `covered=${requiredEvidenceTaskIds.join(", ")}`,
      }));
      if (missingEvidenceTaskIds.length > 0) {
        reasons.push(`Verifier result is missing evidenceTaskIds for: ${missingEvidenceTaskIds.join(", ")}`);
      }
    }
  }

  if (reasons.length > 0) {
    const rejectionConfidence = classifyGateRejectionConfidence({
      handoffFailed,
      resultFailed,
      missingSourceTaskIds,
      missingEvidenceTaskIds,
      approvalWithHighSeverityFindings,
      missingSourceAgentIds,
      completedHandoffWithoutCompletedResult,
      unknownRecommendation,
      missingSupportingFindings,
    });
    return {
      status: "rejected",
      summary: `Verifier / goals fan-in contract gate rejected this capability plan: ${reasons.join(" | ")}`,
      reasons,
      ...(requiredSourceAgentIds.length > 0 ? { requiredSourceAgentIds } : {}),
      ...(missingSourceAgentIds.length > 0 ? { missingSourceAgentIds } : {}),
      ...(requiredSourceTaskIds.length > 0 ? { requiredSourceTaskIds } : {}),
      ...(missingSourceTaskIds.length > 0 ? { missingSourceTaskIds } : {}),
      ...(requiredEvidenceTaskIds.length > 0 ? { requiredEvidenceTaskIds } : {}),
      ...(missingEvidenceTaskIds.length > 0 ? { missingEvidenceTaskIds } : {}),
      ...(checks.length > 0 ? { contractSpecificChecks: checks } : {}),
      rejectionConfidence,
      managerActionHint: buildRejectedManagerActionHint({
        missingSourceTaskIds,
        missingEvidenceTaskIds,
        handoffFailed,
        resultFailed,
        approvalWithHighSeverityFindings,
        completedHandoffWithoutCompletedResult,
      }),
    };
  }

  if (verifierResult?.status === "completed") {
    return {
      status: "accepted",
      summary: "Verifier / goals fan-in contract gate passed for this capability plan.",
      reasons: [],
      ...(requiredSourceAgentIds.length > 0 ? { requiredSourceAgentIds } : {}),
      ...(requiredSourceTaskIds.length > 0 ? { requiredSourceTaskIds } : {}),
      ...(requiredEvidenceTaskIds.length > 0 ? { requiredEvidenceTaskIds } : {}),
      ...(checks.length > 0 ? { contractSpecificChecks: checks } : {}),
      managerActionHint: "The verifier handoff is structurally complete enough to use as the fan-in acceptance signal for this capability plan.",
    };
  }

  const pendingReasons = uniqueStrings([
    !verifierHandoff && !verifierResult
      ? "Verifier handoff is required before this capability plan can be closed."
      : undefined,
    verifierHandoff && verifierHandoff.status !== "completed" && verifierHandoff.status !== "failed" && verifierHandoff.status !== "skipped"
      ? `Verifier handoff is still ${verifierHandoff.status}.`
      : undefined,
    verifierResult?.status === "pending"
      ? "Verifier result is still pending."
      : undefined,
    verifierHandoff?.status === "completed" && !verifierResult
      ? "Awaiting the persisted verifier result after handoff completion."
      : undefined,
  ]);

  return {
    status: "pending",
    summary: pendingReasons.length > 0
      ? `Verifier / goals fan-in contract gate is still pending: ${pendingReasons.join(" | ")}`
      : "Verifier / goals fan-in contract gate is waiting for a completed verifier result.",
    reasons: pendingReasons,
    ...(requiredSourceAgentIds.length > 0 ? { requiredSourceAgentIds } : {}),
    ...(requiredSourceTaskIds.length > 0 ? { requiredSourceTaskIds } : {}),
    ...(requiredEvidenceTaskIds.length > 0 ? { requiredEvidenceTaskIds } : {}),
    ...(checks.length > 0 ? { contractSpecificChecks: checks } : {}),
    managerActionHint: !verifierHandoff && !verifierResult
      ? "Record a verifier handoff or verifier result before treating the capability plan as fully accepted."
      : "Wait for the verifier path to finish, and only then use it as the goals fan-in acceptance signal.",
  };
}

export function enrichGoalCapabilityPlanOrchestration(input: {
  status: GoalCapabilityPlanStatus;
  executionMode: GoalCapabilityExecutionMode;
  subAgents: GoalCapabilityPlanSubAgent[];
  orchestration?: GoalCapabilityPlanOrchestration;
}): GoalCapabilityPlanOrchestration | undefined {
  if (!input.orchestration) {
    return undefined;
  }
  const acceptanceGate = evaluateGoalCapabilityPlanAcceptanceGate(input);
  if (!acceptanceGate) {
    const { acceptanceGate: _unused, ...rest } = input.orchestration;
    return rest;
  }
  return {
    ...input.orchestration,
    acceptanceGate,
  };
}
