import type {
  GoalCheckpointRecord,
  GoalCapabilityPlanRecord,
  GoalHandoffRecord,
  GoalMethodCandidateRecord,
  GoalRetrospectiveRecord,
  GoalSkillCandidateRecord,
  GoalFlowPatternRecord,
  GoalCrossFlowPatternRecord,
  GoalExperienceSuggestRecord,
  GoalSuggestionReviewItemRecord,
  GoalSuggestionPublishRecord,
  GoalRecord,
  GoalTaskCheckpointStatus,
  GoalTaskGraphRecord,
  GoalTaskNodeRecord,
  ToolCallResult,
} from "../../types.js";

export function ok(name: string, output: string): ToolCallResult {
  return {
    id: name,
    name,
    success: true,
    output,
    durationMs: 0,
  };
}

export function fail(name: string, output: string, error?: string): ToolCallResult {
  return {
    id: name,
    name,
    success: false,
    output,
    error: error ?? output,
    durationMs: 0,
  };
}

export function formatGoal(goal: GoalRecord): string {
  return [
    `Goal ID: ${goal.id}`,
    `Title: ${goal.title}`,
    `Status: ${goal.status}`,
    `Path Source: ${goal.pathSource}`,
    `Goal Root: ${goal.goalRoot}`,
    `Doc Root: ${goal.docRoot}`,
    `Northstar: ${goal.northstarPath}`,
    `Tasks: ${goal.tasksPath}`,
    `Progress: ${goal.progressPath}`,
    `Handoff: ${goal.handoffPath ?? "(none)"}`,
    `Current Phase: ${goal.currentPhase ?? "(none)"}`,
    `Active Conversation: ${goal.activeConversationId ?? "(none)"}`,
    `Active Node: ${goal.activeNodeId ?? "(none)"}`,
    `Last Node: ${goal.lastNodeId ?? "(none)"}`,
    `Last Run: ${goal.lastRunId ?? "(none)"}`,
    `Objective: ${goal.objective ?? "(none)"}`,
    `Updated At: ${goal.updatedAt}`,
  ].join("\n");
}

export function inferGoalId(goalId: unknown, conversationId: string): string | undefined {
  const explicit = typeof goalId === "string" ? goalId.trim() : "";
  if (explicit) return explicit;
  const nodeMatch = /^goal:([^:]+):node:[^:]+:run:[^:]+$/.exec(conversationId);
  if (nodeMatch) return nodeMatch[1];
  const goalMatch = /^goal:([^:]+)$/.exec(conversationId);
  return goalMatch?.[1];
}

export function formatTaskNode(node: GoalTaskNodeRecord): string {
  return [
    `Node ID: ${node.id}`,
    `Title: ${node.title}`,
    `Status: ${node.status}`,
    `Phase: ${node.phase ?? "(none)"}`,
    `Owner: ${node.owner ?? "(none)"}`,
    `Depends On: ${node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "(none)"}`,
    `Acceptance: ${node.acceptance.length > 0 ? node.acceptance.join(" | ") : "(none)"}`,
    `Artifacts: ${node.artifacts.length > 0 ? node.artifacts.join(", ") : "(none)"}`,
    `Checkpoint: ${node.checkpointRequired ? "required" : "optional"} / ${node.checkpointStatus}`,
    `Block Reason: ${node.blockReason ?? "(none)"}`,
    `Summary: ${node.summary ?? "(none)"}`,
    `Last Run: ${node.lastRunId ?? "(none)"}`,
    `Updated At: ${node.updatedAt}`,
  ].join("\n");
}

export function formatTaskGraph(graph: GoalTaskGraphRecord): string {
  const lines = [
    `Goal ID: ${graph.goalId ?? "(none)"}`,
    `Version: ${graph.version}`,
    `Updated At: ${graph.updatedAt}`,
    `Node Count: ${graph.nodes.length}`,
    `Edge Count: ${graph.edges.length}`,
  ];
  if (graph.nodes.length > 0) {
    lines.push("");
    lines.push("Nodes:");
    for (const node of graph.nodes) {
      lines.push(`- [${node.status}] ${node.id} | ${node.title}`);
    }
  }
  return lines.join("\n");
}

export function formatCheckpoint(checkpoint: GoalCheckpointRecord): string {
  return [
    `Checkpoint ID: ${checkpoint.id}`,
    `Title: ${checkpoint.title}`,
    `Status: ${checkpoint.status}`,
    `Node ID: ${checkpoint.nodeId ?? "(none)"}`,
    `Run ID: ${checkpoint.runId ?? "(none)"}`,
    `Reviewer: ${checkpoint.reviewer ?? "(none)"}`,
    `Reviewer Role: ${checkpoint.reviewerRole ?? "(none)"}`,
    `Requested By: ${checkpoint.requestedBy ?? "(none)"}`,
    `Decided By: ${checkpoint.decidedBy ?? "(none)"}`,
    `SLA At: ${checkpoint.slaAt ?? "(none)"}`,
    `Policy: ${checkpoint.policy ? `${checkpoint.policy.approvalMode} | request=${checkpoint.policy.requiredRequestFields.join(", ") || "(none)"} | decision=${checkpoint.policy.requiredDecisionFields.join(", ") || "(none)"}` : "(none)"}`,
    `Summary: ${checkpoint.summary ?? "(none)"}`,
    `Note: ${checkpoint.note ?? "(none)"}`,
    `Requested At: ${checkpoint.requestedAt ?? "(none)"}`,
    `Decided At: ${checkpoint.decidedAt ?? "(none)"}`,
    `Updated At: ${checkpoint.updatedAt}`,
  ].join("\n");
}

export function formatCheckpointState(items: GoalCheckpointRecord[]): string {
  if (items.length === 0) return "当前没有 checkpoint。";
  return items
    .map((item, index) => `${index + 1}. [${item.status}] ${item.id} | ${item.nodeId ?? "(no-node)"} | ${item.title}`)
    .join("\n");
}

export function formatCapabilityPlan(plan: GoalCapabilityPlanRecord): string {
  const coordinationPlan = plan.orchestration?.coordinationPlan;
  const rolePolicy = coordinationPlan?.rolePolicy;
  const verifierHandoff = plan.orchestration?.verifierHandoff;
  const verifierResult = plan.orchestration?.verifierResult;
  const acceptanceGate = plan.orchestration?.acceptanceGate;
  const finalApprovalMode = plan.orchestration?.finalApprovalMode;
  const reworkRevisionCount = plan.orchestration?.reworkRevisionCount;
  const lastReworkReason = plan.orchestration?.lastReworkReason;
  const lastReworkAt = plan.orchestration?.lastReworkAt;
  const methodLines = plan.methods.length > 0
    ? plan.methods.map((item, index) => `${index + 1}. ${item.file}${item.title ? ` | ${item.title}` : ""}${item.reason ? ` | ${item.reason}` : ""}`)
    : ["(none)"];
  const skillLines = plan.skills.length > 0
    ? plan.skills.map((item, index) => `${index + 1}. ${item.name}${item.reason ? ` | ${item.reason}` : ""}`)
    : ["(none)"];
  const mcpLines = plan.mcpServers.length > 0
    ? plan.mcpServers.map((item, index) => `${index + 1}. ${item.serverId} [${item.status}]${item.reason ? ` | ${item.reason}` : ""}`)
    : ["(none)"];
  const subAgentLines = plan.subAgents.length > 0
    ? plan.subAgents.map((item, index) => (
      `${index + 1}. ${item.agentId}${item.role ? ` [${item.role}]` : ""} | ${item.objective}${item.deliverable ? ` | deliverable=${item.deliverable}` : ""}${item.handoffToVerifier ? " | handoff=verifier" : ""}${item.catalogDefault ? ` | launchDefault=${[
        item.catalogDefault.permissionMode ? `permission=${item.catalogDefault.permissionMode}` : "",
        item.catalogDefault.maxToolRiskLevel ? `risk=${item.catalogDefault.maxToolRiskLevel}` : "",
        item.catalogDefault.handoffStyle ? `handoff=${item.catalogDefault.handoffStyle}` : "",
        Array.isArray(item.catalogDefault.allowedToolFamilies) && item.catalogDefault.allowedToolFamilies.length > 0
          ? `tools=${item.catalogDefault.allowedToolFamilies.slice(0, 4).join("/")}${item.catalogDefault.allowedToolFamilies.length > 4 ? "+" : ""}`
          : "",
      ].filter(Boolean).join(",")}` : ""}${item.reason ? ` | ${item.reason}` : ""}`
    ))
    : ["(none)"];
  const delegationLines = plan.orchestration?.delegationResults && plan.orchestration.delegationResults.length > 0
    ? plan.orchestration.delegationResults.map((item, index) => `${index + 1}. ${item.agentId}${item.role ? ` [${item.role}]` : ""} | ${item.status} | ${item.summary}${item.taskId ? ` | task=${item.taskId}` : ""}${item.sessionId ? ` | session=${item.sessionId}` : ""}`)
    : ["(none)"];
  const fanInLines = verifierHandoff
    ? verifierHandoff.sourceAgentIds.length > 0
      ? verifierHandoff.sourceAgentIds.map((agentId, index) => {
        const match = plan.orchestration?.delegationResults?.find((item) => item.agentId === agentId);
        const sourceTaskId = verifierHandoff.sourceTaskIds?.[index] ?? match?.taskId ?? "(none)";
        return `${index + 1}. ${agentId} -> task=${sourceTaskId} -> verifier=${verifierHandoff.verifierTaskId ?? "(pending)"}`;
      })
      : [`1. (no-source) -> verifier=${verifierHandoff.verifierTaskId ?? "(pending)"}`]
    : ["(none)"];
  const verifierFindingLines = verifierResult?.findings && verifierResult.findings.length > 0
    ? verifierResult.findings.map((item, index) => `${index + 1}. [${item.severity}] ${item.summary}`)
    : ["(none)"];
  return [
    `Plan ID: ${plan.id}`,
    `Node ID: ${plan.nodeId}`,
    `Status: ${plan.status}`,
    `Execution Mode: ${plan.executionMode}`,
    `Governance Mode: ${plan.governanceMode}`,
    `Commander Agent: ${plan.commanderAgentId ?? "(none)"}`,
    `Preferred Agents: ${plan.preferredAgents.length > 0 ? plan.preferredAgents.join(", ") : "(none)"}`,
    `Risk Level: ${plan.riskLevel}`,
    `Objective: ${plan.objective}`,
    `Summary: ${plan.summary}`,
    `Query Hints: ${plan.queryHints.length > 0 ? plan.queryHints.join(" / ") : "(none)"}`,
    `Reasoning: ${plan.reasoning.length > 0 ? plan.reasoning.join(" | ") : "(none)"}`,
    `Coordinator Plan: ${coordinationPlan ? `${coordinationPlan.summary}${coordinationPlan.managerAgentId ? ` | manager=${coordinationPlan.managerAgentId}` : ""}` : "(none)"}`,
    `Role Policy: ${rolePolicy ? `roles=${rolePolicy.selectedRoles.join(", ") || "(none)"} | verifier=${rolePolicy.verifierRole ?? "(none)"} | fanIn=${rolePolicy.fanInStrategy}` : "(none)"}`,
    `Role Selection Reasons: ${rolePolicy?.selectionReasons && rolePolicy.selectionReasons.length > 0 ? rolePolicy.selectionReasons.join(" | ") : "(none)"}`,
    `Final Approval Default: ${finalApprovalMode ?? "(none)"}`,
    `Rework Revision: ${typeof reworkRevisionCount === "number" ? reworkRevisionCount : 0} | reason=${lastReworkReason ?? "(none)"} | at=${lastReworkAt ?? "(none)"}`,
    `Checkpoint Policy: ${plan.checkpoint.required ? "required" : "optional"} | mode=${plan.checkpoint.approvalMode}${plan.checkpoint.reasons.length > 0 ? ` | ${plan.checkpoint.reasons.join(" | ")}` : ""}`,
    `Checkpoint Requirements: request=${plan.checkpoint.requiredRequestFields.length > 0 ? plan.checkpoint.requiredRequestFields.join(", ") : "(none)"} | decision=${plan.checkpoint.requiredDecisionFields.length > 0 ? plan.checkpoint.requiredDecisionFields.join(", ") : "(none)"}`,
    `Checkpoint Routing: reviewer=${plan.checkpoint.suggestedReviewer ?? "(none)"} | reviewerRole=${plan.checkpoint.suggestedReviewerRole ?? "(none)"} | slaHours=${plan.checkpoint.suggestedSlaHours ?? "(none)"} | escalation=${plan.checkpoint.escalationMode ?? "none"}`,
    `Checkpoint Note: ${plan.checkpoint.suggestedNote ?? "(none)"}`,
    `Methods:\n${methodLines.join("\n")}`,
    `Skills:\n${skillLines.join("\n")}`,
    `MCP:\n${mcpLines.join("\n")}`,
    `Sub Agents:\n${subAgentLines.join("\n")}`,
    `Coordinator Results:\n${delegationLines.join("\n")}`,
    `Verifier Handoff: ${verifierHandoff ? `${verifierHandoff.status} | verifier=${verifierHandoff.verifierRole ?? "(none)"} | agent=${verifierHandoff.verifierAgentId ?? "(none)"} | task=${verifierHandoff.verifierTaskId ?? "(none)"} | ${verifierHandoff.summary}` : "(none)"}`,
    `Verifier Result: ${verifierResult ? `${verifierResult.status} | recommendation=${verifierResult.recommendation} | ${verifierResult.summary}` : "(none)"}`,
    `Acceptance Gate: ${acceptanceGate ? `${acceptanceGate.status} | ${acceptanceGate.summary}` : "(none)"}`,
    `Verifier Findings:\n${verifierFindingLines.join("\n")}`,
    `Source -> Verifier Fan-in:\n${fanInLines.join("\n")}`,
    `Gaps: ${plan.gaps.length > 0 ? plan.gaps.join(" | ") : "(none)"}`,
    `Actual Methods: ${plan.actualUsage.methods.length > 0 ? plan.actualUsage.methods.join(", ") : "(none)"}`,
    `Actual Skills: ${plan.actualUsage.skills.length > 0 ? plan.actualUsage.skills.join(", ") : "(none)"}`,
    `Actual MCP: ${plan.actualUsage.mcpServers.length > 0 ? plan.actualUsage.mcpServers.join(", ") : "(none)"}`,
    `Actual Tools: ${plan.actualUsage.toolNames.length > 0 ? plan.actualUsage.toolNames.join(", ") : "(none)"}`,
    `Alignment: ${plan.analysis.status} | ${plan.analysis.summary}`,
    `Deviations: ${plan.analysis.deviations.length > 0 ? plan.analysis.deviations.map((item) => `[${item.area}] ${item.summary}`).join(" | ") : "(none)"}`,
    `Recommendations: ${plan.analysis.recommendations.length > 0 ? plan.analysis.recommendations.join(" | ") : "(none)"}`,
    `Generated At: ${plan.generatedAt}`,
    `Updated At: ${plan.updatedAt}`,
    `Orchestrated At: ${plan.orchestratedAt ?? "(none)"}`,
  ].join("\n");
}

export function formatHandoff(handoff: GoalHandoffRecord): string {
  const checkpointLines = handoff.openCheckpoints.length > 0
    ? handoff.openCheckpoints.map((item, index) => `${index + 1}. [${item.status}] ${item.id}${item.nodeId ? ` | ${item.nodeId}` : ""} | ${item.title}`)
    : ["(none)"];
  const blockerLines = handoff.blockers.length > 0
    ? handoff.blockers.map((item, index) => `${index + 1}. [${item.kind}:${item.status}] ${item.id}${item.nodeId ? ` | ${item.nodeId}` : ""} | ${item.title}${item.reason ? ` | ${item.reason}` : ""}`)
    : ["(none)"];
  const progressLines = handoff.recentProgress.length > 0
    ? handoff.recentProgress.map((item, index) => `${index + 1}. ${item.at} | ${item.event}${item.nodeId ? ` | ${item.nodeId}` : ""}${item.summary ? ` | ${item.summary}` : ""}`)
    : ["(none)"];
  return [
    `Generated At: ${handoff.generatedAt}`,
    `Goal ID: ${handoff.goalId}`,
    `Goal Status: ${handoff.goalStatus}`,
    `Resume Mode: ${handoff.resumeMode}`,
    `Recommended Node: ${handoff.recommendedNodeId ?? "(none)"}`,
    `Active Node: ${handoff.activeNodeId ?? "(none)"}`,
    `Last Node: ${handoff.lastNodeId ?? "(none)"}`,
    `Last Run: ${handoff.lastRunId ?? "(none)"}`,
    `Summary: ${handoff.summary}`,
    `Next Action: ${handoff.nextAction}`,
    `Tracking: total=${handoff.tracking.totalNodes} | done=${handoff.tracking.completedNodes} | in_progress=${handoff.tracking.inProgressNodes} | blocked=${handoff.tracking.blockedNodes} | open_checkpoints=${handoff.tracking.openCheckpointCount}`,
    `Focus Capability: ${handoff.focusCapability ? `${handoff.focusCapability.planId} | ${handoff.focusCapability.executionMode} | risk=${handoff.focusCapability.riskLevel} | alignment=${handoff.focusCapability.alignment}` : "(none)"}`,
    `Open Checkpoints:\n${checkpointLines.join("\n")}`,
    `Blockers:\n${blockerLines.join("\n")}`,
    `Recent Progress:\n${progressLines.join("\n")}`,
  ].join("\n");
}

export function formatRetrospective(retrospective: GoalRetrospectiveRecord): string {
  const highlightedNodeLines = retrospective.highlightedNodes.length > 0
    ? retrospective.highlightedNodes.map((item, index) =>
      `${index + 1}. [${item.status}] ${item.id} | ${item.title}${item.summary ? ` | ${item.summary}` : ""}`,
    )
    : ["(none)"];
  const recommendationLines = retrospective.recommendations.length > 0
    ? retrospective.recommendations.map((item, index) => `${index + 1}. ${item}`)
    : ["(none)"];
  return [
    `Generated At: ${retrospective.generatedAt}`,
    `Goal ID: ${retrospective.goalId}`,
    `Goal Status: ${retrospective.goalStatus}`,
    `Outcome: ${retrospective.outcome}`,
    `Current Phase: ${retrospective.currentPhase ?? "(none)"}`,
    `Objective: ${retrospective.objective ?? "(none)"}`,
    `Summary: ${retrospective.summary}`,
    `Next Focus: ${retrospective.nextFocus}`,
    `Handoff Summary: ${retrospective.handoffSummary}`,
    `Task Summary: total=${retrospective.taskSummary.totalNodes} | done=${retrospective.taskSummary.completedNodes} | blocked=${retrospective.taskSummary.blockedNodes} | in_progress=${retrospective.taskSummary.inProgressNodes} | open_checkpoints=${retrospective.taskSummary.openCheckpointCount}`,
    `Checkpoint Summary: total=${retrospective.checkpointSummary.total} | waiting=${retrospective.checkpointSummary.waitingUserCount} | approved=${retrospective.checkpointSummary.approvedCount} | rejected=${retrospective.checkpointSummary.rejectedCount} | expired=${retrospective.checkpointSummary.expiredCount}`,
    `Capability Summary: plans=${retrospective.capabilitySummary.totalPlans} | orchestrated=${retrospective.capabilitySummary.orchestratedPlans} | high_risk=${retrospective.capabilitySummary.highRiskPlans} | diverged=${retrospective.capabilitySummary.divergedPlans}`,
    `Methods: ${retrospective.capabilitySummary.uniqueMethods.join(", ") || "(none)"}`,
    `Skills: ${retrospective.capabilitySummary.uniqueSkills.join(", ") || "(none)"}`,
    `MCP Servers: ${retrospective.capabilitySummary.uniqueMcpServers.join(", ") || "(none)"}`,
    `Top Gaps: ${retrospective.capabilitySummary.topGaps.join(" | ") || "(none)"}`,
    `Achievements: ${retrospective.achievements.join(" | ") || "(none)"}`,
    `Blockers: ${retrospective.blockers.join(" | ") || "(none)"}`,
    `Recommendations:\n${recommendationLines.join("\n")}`,
    `Highlighted Nodes:\n${highlightedNodeLines.join("\n")}`,
    `Markdown Path: ${retrospective.markdownPath}`,
    `JSON Path: ${retrospective.jsonPath}`,
  ].join("\n");
}

export function formatMethodCandidates(candidates: GoalMethodCandidateRecord[], paths: { markdownPath: string; jsonPath: string }): string {
  if (candidates.length === 0) {
    return [
      "Candidate Count: 0",
      `Markdown Path: ${paths.markdownPath}`,
      `JSON Path: ${paths.jsonPath}`,
      "当前没有达到阈值的 method candidate 建议。",
    ].join("\n");
  }
  return [
    `Candidate Count: ${candidates.length}`,
    `Markdown Path: ${paths.markdownPath}`,
    `JSON Path: ${paths.jsonPath}`,
    "",
    ...candidates.map((candidate, index) => [
      `${index + 1}. [score=${candidate.qualityScore}] ${candidate.id} | ${candidate.nodeId} | ${candidate.title}`,
      `   Summary: ${candidate.summary}`,
      `   Rationale: ${candidate.rationale.join(" | ") || "(none)"}`,
      `   Evidence: methods=${candidate.evidence.methodsUsed.join(", ") || "(none)"} | skills=${candidate.evidence.skillsUsed.join(", ") || "(none)"} | mcp=${candidate.evidence.mcpServersUsed.join(", ") || "(none)"}`,
      `   References: ${candidate.evidence.references.join(" | ") || "(none)"}`,
    ].join("\n")),
  ].join("\n");
}

export function formatSkillCandidates(candidates: GoalSkillCandidateRecord[], paths: { markdownPath: string; jsonPath: string }): string {
  if (candidates.length === 0) {
    return [
      "Candidate Count: 0",
      `Markdown Path: ${paths.markdownPath}`,
      `JSON Path: ${paths.jsonPath}`,
      "当前没有达到阈值的 skill candidate 建议。",
    ].join("\n");
  }
  return [
    `Candidate Count: ${candidates.length}`,
    `Markdown Path: ${paths.markdownPath}`,
    `JSON Path: ${paths.jsonPath}`,
    "",
    ...candidates.map((candidate, index) => [
      `${index + 1}. [score=${candidate.qualityScore}] ${candidate.id} | ${candidate.nodeId} | ${candidate.title}`,
      `   Summary: ${candidate.summary}`,
      `   Rationale: ${candidate.rationale.join(" | ") || "(none)"}`,
      `   Evidence: gaps=${candidate.evidence.gaps.join(", ") || "(none)"} | tools=${candidate.evidence.toolNamesUsed.join(", ") || "(none)"} | mcp=${candidate.evidence.mcpServersUsed.join(", ") || "(none)"}`,
      `   References: ${candidate.evidence.references.join(" | ") || "(none)"}`,
    ].join("\n")),
  ].join("\n");
}

export function formatFlowPatterns(patterns: GoalFlowPatternRecord[], paths: { markdownPath: string; jsonPath: string }): string {
  if (patterns.length === 0) {
    return [
      "Pattern Count: 0",
      `Markdown Path: ${paths.markdownPath}`,
      `JSON Path: ${paths.jsonPath}`,
      "当前没有可识别的 flow pattern。",
    ].join("\n");
  }
  return [
    `Pattern Count: ${patterns.length}`,
    `Markdown Path: ${paths.markdownPath}`,
    `JSON Path: ${paths.jsonPath}`,
    "",
    ...patterns.map((pattern, index) => [
      `${index + 1}. [count=${pattern.count}][confidence=${pattern.confidence}] ${pattern.id} | action=${pattern.action}`,
      `   Summary: ${pattern.summary}`,
      `   Events: ${pattern.eventSequence.join(" -> ") || "(none)"}`,
      `   Tools: ${pattern.toolNames.join(", ") || "(none)"}`,
      `   MCP: ${pattern.mcpServers.join(", ") || "(none)"}`,
      `   Gaps: ${pattern.gaps.join(", ") || "(none)"}`,
      `   Nodes: ${pattern.nodeRefs.map((item) => item.nodeId).join(", ") || "(none)"}`,
    ].join("\n")),
  ].join("\n");
}

export function formatCrossGoalFlowPatterns(patterns: GoalCrossFlowPatternRecord[], paths: { markdownPath: string; jsonPath: string; goalsScanned: number }): string {
  if (patterns.length === 0) {
    return [
      `Goals Scanned: ${paths.goalsScanned}`,
      "Pattern Count: 0",
      `Markdown Path: ${paths.markdownPath}`,
      `JSON Path: ${paths.jsonPath}`,
      "当前没有可识别的跨 goal flow pattern。",
    ].join("\n");
  }
  return [
    `Goals Scanned: ${paths.goalsScanned}`,
    `Pattern Count: ${patterns.length}`,
    `Markdown Path: ${paths.markdownPath}`,
    `JSON Path: ${paths.jsonPath}`,
    "",
    ...patterns.map((pattern, index) => [
      `${index + 1}. [goals=${pattern.goalCount}][occurrences=${pattern.occurrenceCount}][confidence=${pattern.confidence}] ${pattern.id} | action=${pattern.recommendedAction}`,
      `   Summary: ${pattern.summary}`,
      `   Events: ${pattern.eventSequence.join(" -> ") || "(none)"}`,
      `   Goals: ${pattern.goalRefs.map((item) => item.goalId).join(", ") || "(none)"}`,
      `   Tools: ${pattern.toolNames.join(", ") || "(none)"}`,
      `   Methods: ${pattern.methods.join(", ") || "(none)"}`,
      `   Skills: ${pattern.skills.join(", ") || "(none)"}`,
      `   Gaps: ${pattern.gaps.join(", ") || "(none)"}`,
    ].join("\n")),
  ].join("\n");
}

export function formatExperienceSuggestions(result: GoalExperienceSuggestRecord): string {
  const topMethod = result.methodCandidates.items[0];
  const topSkill = result.skillCandidates.items[0];
  const topFlow = result.flowPatterns.items[0];
  const recommendationLines = result.recommendations.length > 0
    ? result.recommendations.map((item, index) => `${index + 1}. ${item}`)
    : ["(none)"];
  return [
    `Generated At: ${result.generatedAt}`,
    `Summary: ${result.summary}`,
    `Retrospective: ${result.retrospective.markdownPath} | ${result.retrospective.jsonPath}`,
    `Method Candidates: ${result.methodCandidates.count}${topMethod ? ` | Top: ${topMethod.id} | ${topMethod.title}` : ""}`,
    `Method Paths: ${result.methodCandidates.markdownPath} | ${result.methodCandidates.jsonPath}`,
    `Skill Candidates: ${result.skillCandidates.count}${topSkill ? ` | Top: ${topSkill.id} | ${topSkill.title}` : ""}`,
    `Skill Paths: ${result.skillCandidates.markdownPath} | ${result.skillCandidates.jsonPath}`,
    `Flow Patterns: ${result.flowPatterns.count}${topFlow ? ` | Top: ${topFlow.id} | action=${topFlow.action}` : ""}`,
    `Flow Paths: ${result.flowPatterns.markdownPath} | ${result.flowPatterns.jsonPath}`,
    `Recommendations:\n${recommendationLines.join("\n")}`,
  ].join("\n");
}

export function formatSuggestionReviews(items: GoalSuggestionReviewItemRecord[]): string {
  if (items.length === 0) return "当前没有 suggestion reviews。";
  return items
    .map((item, index) => {
      const stage = item.workflow?.stages[item.workflow.currentStageIndex];
      const overdue = Boolean(stage?.slaAt && stage.status === "pending_review" && new Date().getTime() > new Date(stage.slaAt).getTime());
      return [
      `${index + 1}. [${item.status}] ${item.id} | ${item.suggestionType} | ${item.title}`,
      `   Suggestion: ${item.suggestionId}`,
      `   Summary: ${item.summary}`,
      `   Reviewer: ${item.reviewer ?? "(none)"} | Decided By: ${item.decidedBy ?? "(none)"} | Decided At: ${item.decidedAt ?? "(none)"}`,
      `   Workflow: ${item.workflow ? `${item.workflow.mode} | stage=${item.workflow.currentStageIndex + 1}/${item.workflow.stages.length} | status=${item.workflow.status}` : "(none)"}`,
      `   SLA: ${stage?.slaAt ?? "(none)"} | Overdue: ${overdue ? "yes" : "no"} | Escalation: ${stage?.escalation.count ?? 0}${stage?.escalation.defaultReviewer ? ` | default=${stage.escalation.defaultReviewer}` : ""}`,
      `   Source: ${item.sourcePath}`,
      `   Evidence: ${item.evidenceRefs.join(" | ") || "(none)"}`,
    ].join("\n");
    })
    .join("\n");
}

export function formatSuggestionPublishRecord(record: GoalSuggestionPublishRecord): string {
  return [
    `Publish ID: ${record.id}`,
    `Asset Type: ${record.assetType}`,
    `Suggestion: ${record.suggestionType} / ${record.suggestionId}`,
    `Title: ${record.title}`,
    `Published Path: ${record.publishedPath}`,
    `Asset Key: ${record.assetKey}`,
    `Experience Candidate: ${record.experienceCandidateId ?? "(none)"}`,
    `Reviewer: ${record.reviewer ?? "(none)"}`,
    `Decided By: ${record.decidedBy ?? "(none)"}`,
    `Published At: ${record.publishedAt}`,
    `Source: ${record.sourcePath}`,
    `Note: ${record.note ?? "(none)"}`,
  ].join("\n");
}

export function formatReviewGovernanceSummary(summary: import("../../types.js").GoalReviewGovernanceSummaryRecord): string {
  const reviewCounts = summary.reviewStatusCounts;
  const typeCounts = summary.reviewTypeCounts;
  const governanceConfig = summary.governanceConfig ?? { reviewers: [], templates: [] };
  const notifications = summary.notifications?.items ?? [];
  const dispatches = summary.notificationDispatches?.items ?? [];
  const dispatchCounts = summary.notificationDispatchCounts ?? { total: dispatches.length, byChannel: {}, byStatus: {} };
  const actionable = summary.actionableReviews.length > 0
    ? summary.actionableReviews.map((item, index) => `${index + 1}. [${item.status}] ${item.id} | ${item.suggestionType} | ${item.title}`).join("\n")
    : "(none)";
  const overdue = summary.overdueReviews.length > 0
    ? summary.overdueReviews.map((item, index) => `${index + 1}. [${item.status}] ${item.id} | ${item.suggestionType} | ${item.title}`).join("\n")
    : "(none)";
  const actionableCheckpoints = (summary.actionableCheckpoints ?? []).length > 0
    ? (summary.actionableCheckpoints ?? []).map((item, index) =>
      `${index + 1}. [${item.status}] ${item.id} | ${item.nodeId ?? "(no-node)"} | ${item.title}${item.reviewer ? ` | reviewer=${item.reviewer}` : ""}`,
    ).join("\n")
    : "(none)";
  const published = summary.publishRecords.items.length > 0
    ? summary.publishRecords.items
      .slice(-3)
      .reverse()
      .map((item, index) => `${index + 1}. ${item.id} | ${item.assetType} | ${item.assetKey}`)
      .join("\n")
    : "(none)";
  const recentNotifications = notifications.length > 0
    ? notifications
      .slice(-5)
      .reverse()
      .map((item, index) => `${index + 1}. [${item.kind}] ${item.targetType}:${item.targetId}${item.recipient ? ` | to=${item.recipient}` : ""} | ${item.message}`)
      .join("\n")
    : "(none)";
  const recentDispatches = dispatches.length > 0
    ? dispatches
      .slice(-5)
      .reverse()
      .map((item, index) =>
        `${index + 1}. [${item.channel}/${item.status}] ${item.targetType}:${item.targetId}${item.recipient ? ` | to=${item.recipient}` : ""}${item.routeKey ? ` | route=${item.routeKey}` : ""} | ${item.message}`)
      .join("\n")
    : "(none)";
  const templates = governanceConfig.templates.length > 0
    ? governanceConfig.templates
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.id} | ${item.target} | mode=${item.mode}${item.enabled ? "" : " | disabled"}`)
      .join("\n")
    : "(none)";
  const crossGoal = summary.crossGoal.items.length > 0
    ? summary.crossGoal.items
      .map((item, index) => `${index + 1}. [goals=${item.goalCount}][occurrences=${item.occurrenceCount}] ${item.id} | action=${item.recommendedAction}`)
      .join("\n")
    : "(none)";
  const recommendations = summary.recommendations.length > 0
    ? summary.recommendations.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(none)";
  return [
    `Generated At: ${summary.generatedAt}`,
    `Summary: ${summary.summary}`,
    `Review Counts: pending=${reviewCounts.pending_review} | accepted=${reviewCounts.accepted} | needs_revision=${reviewCounts.needs_revision} | rejected=${reviewCounts.rejected} | deferred=${reviewCounts.deferred}`,
    `Type Counts: method=${typeCounts.method_candidate} | skill=${typeCounts.skill_candidate} | flow=${typeCounts.flow_pattern}`,
    `Workflow Counts: pending=${summary.workflowPendingCount} | overdue=${summary.workflowOverdueCount}`,
    `Checkpoint Workflow Counts: pending=${summary.checkpointWorkflowPendingCount ?? 0} | overdue=${summary.checkpointWorkflowOverdueCount ?? 0}`,
    `Governance: reviewers=${governanceConfig.reviewers.length} | templates=${governanceConfig.templates.length}`,
    `Governance Paths: ${summary.governanceConfigPath ?? "(none)"} | ${summary.notificationsPath ?? "(none)"} | ${summary.notificationDispatchesPath ?? "(none)"}`,
    `Publish Count: ${summary.publishRecords.items.length}`,
    `Dispatch Count: total=${dispatchCounts.total} | channels=${Object.entries(dispatchCounts.byChannel ?? {}).map(([key, value]) => `${key}=${value}`).join(", ") || "(none)"} | status=${Object.entries(dispatchCounts.byStatus ?? {}).map(([key, value]) => `${key}=${value}`).join(", ") || "(none)"}`,
    `Cross Goal Matches: ${summary.crossGoal.items.length} / scanned=${summary.crossGoal.goalsScanned}`,
    `Cross Goal Paths: ${summary.crossGoal.markdownPath} | ${summary.crossGoal.jsonPath}`,
    `Actionable Reviews:\n${actionable}`,
    `Overdue Reviews:\n${overdue}`,
    `Actionable Checkpoints:\n${actionableCheckpoints}`,
    `Templates:\n${templates}`,
    `Recent Notifications:\n${recentNotifications}`,
    `Recent Dispatches:\n${recentDispatches}`,
    `Recent Publish Records:\n${published}`,
    `Cross Goal Focus:\n${crossGoal}`,
    `Recommendations:\n${recommendations}`,
  ].join("\n");
}

export function formatSuggestionReviewWorkflowScanResult(
  result: import("../../types.js").GoalSuggestionReviewWorkflowScanResultRecord,
): string {
  const items = result.items.length > 0
    ? result.items.map((item, index) =>
      `${index + 1}. [${item.action}] ${item.reviewId} | stage=${item.stageIndex + 1} | overdue=${item.overdue ? "yes" : "no"} | escalated=${item.escalated ? "yes" : "no"}${item.escalatedTo ? ` | to=${item.escalatedTo}` : ""}`,
    ).join("\n")
    : "(none)";
  const recommendations = result.recommendations.length > 0
    ? result.recommendations.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(none)";
  return [
    `Scanned At: ${result.scannedAt}`,
    `Summary: ${result.summary}`,
    `Workflow Count: scanned=${result.scannedCount} | overdue=${result.overdueCount} | escalated=${result.escalatedCount}`,
    `Items:\n${items}`,
    `Recommendations:\n${recommendations}`,
  ].join("\n");
}

export function formatApprovalWorkflowScanResult(
  result: import("../../types.js").GoalApprovalWorkflowScanResultRecord,
): string {
  const checkpointItems = result.checkpointItems.length > 0
    ? result.checkpointItems.map((item, index) =>
      `${index + 1}. [${item.action}] ${item.targetId} | stage=${item.stageIndex + 1} | overdue=${item.overdue ? "yes" : "no"} | escalated=${item.escalated ? "yes" : "no"}`,
    ).join("\n")
    : "(none)";
  const notifications = result.notifications.length > 0
    ? result.notifications.map((item, index) =>
      `${index + 1}. [${item.kind}] ${item.targetType}:${item.targetId}${item.recipient ? ` | to=${item.recipient}` : ""} | ${item.message}`,
    ).join("\n")
    : "(none)";
  const dispatches = result.dispatches.length > 0
    ? result.dispatches.map((item, index) =>
      `${index + 1}. [${item.channel}/${item.status}] ${item.targetType}:${item.targetId}${item.recipient ? ` | to=${item.recipient}` : ""}${item.routeKey ? ` | route=${item.routeKey}` : ""} | ${item.message}`,
    ).join("\n")
    : "(none)";
  const recommendations = result.recommendations.length > 0
    ? result.recommendations.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(none)";
  return [
    `Scanned At: ${result.scannedAt}`,
    `Summary: ${result.summary}`,
    `Review Scan: ${result.reviewResult.summary}`,
    `Checkpoint Items:\n${checkpointItems}`,
    `Notifications:\n${notifications}`,
    `Dispatches:\n${dispatches}`,
    `Recommendations:\n${recommendations}`,
  ].join("\n");
}

export function parseCheckpointStatus(value: unknown): GoalTaskCheckpointStatus | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "not_required":
    case "required":
    case "waiting_user":
    case "approved":
    case "rejected":
    case "expired":
      return normalized;
    default:
      return undefined;
  }
}

export function parseCreateStatus(value: unknown): "draft" | "ready" | "blocked" | "skipped" | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "draft":
    case "ready":
    case "blocked":
    case "skipped":
      return normalized;
    default:
      return undefined;
  }
}
