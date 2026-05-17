import type {
  AgentCapabilities,
  GoalCapabilityPlanCoordinationPlanRecord,
  GoalCapabilityPlanDelegationResultRecord,
  GoalCapabilityPlanRecord,
  GoalCapabilityPlanRolePolicyRecord,
  GoalCapabilityPlanVerifierFindingRecord,
  GoalCapabilityPlanVerifierHandoffRecord,
  GoalCapabilityPlanVerifierResultRecord,
  JsonObject,
  Tool,
  ToolContext,
} from "../../types.js";
import { fail, formatCapabilityPlan, formatTaskNode, inferGoalId, ok } from "./shared.js";
import { buildCapabilityPlanSaveInput, collectCapabilityPlanActualUsage } from "./capability-plan-utils.js";
import { buildSubAgentLaunchSpec } from "../../subagent-launch.js";

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function isMultiAgentExecutionMode(mode: GoalCapabilityPlanRecord["executionMode"] | undefined): boolean {
  return mode === "multi_agent" || mode === "multi_agent_parallel" || mode === "multi_agent_sequential";
}

function buildCheckpointSlaAt(hours: number | undefined): string | undefined {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return undefined;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function buildDelegationInstruction(plan: GoalCapabilityPlanRecord, nodeTitle: string, subAgent: GoalCapabilityPlanRecord["subAgents"][number]): string {
  const lines = [
    `长期任务节点: ${nodeTitle} (${plan.nodeId})`,
    `角色: ${subAgent.role ?? "default"}`,
    `分工目标: ${subAgent.objective}`,
    `执行摘要: ${plan.summary}`,
  ];
  if (subAgent.deliverable) {
    lines.push(`交付物: ${subAgent.deliverable}`);
  }
  if (subAgent.catalogDefault) {
    const defaultFragments = [
      subAgent.catalogDefault.permissionMode ? `permission=${subAgent.catalogDefault.permissionMode}` : "",
      subAgent.catalogDefault.maxToolRiskLevel ? `risk=${subAgent.catalogDefault.maxToolRiskLevel}` : "",
      subAgent.catalogDefault.handoffStyle ? `handoff=${subAgent.catalogDefault.handoffStyle}` : "",
      Array.isArray(subAgent.catalogDefault.allowedToolFamilies) && subAgent.catalogDefault.allowedToolFamilies.length > 0
        ? `tools=${subAgent.catalogDefault.allowedToolFamilies.slice(0, 4).join("/")}${subAgent.catalogDefault.allowedToolFamilies.length > 4 ? "+" : ""}`
        : "",
      Array.isArray(subAgent.catalogDefault.whenToUse) && subAgent.catalogDefault.whenToUse.length > 0
        ? `when=${subAgent.catalogDefault.whenToUse[0]}`
        : "",
    ].filter(Boolean);
    if (defaultFragments.length > 0) {
      lines.push(`catalog default: ${defaultFragments.join(", ")}`);
    }
  }
  if (plan.methods.length > 0) {
    lines.push(`参考 Methods: ${plan.methods.map((item) => item.file).join(", ")}`);
  }
  if (plan.skills.length > 0) {
    lines.push(`参考 Skills: ${plan.skills.map((item) => item.name).join(", ")}`);
  }
  if (plan.mcpServers.length > 0) {
    lines.push(`优先检查 MCP: ${plan.mcpServers.map((item) => item.serverId).join(", ")}`);
  }
  if (subAgent.reason) {
    lines.push(`分工原因: ${subAgent.reason}`);
  }
  if (subAgent.handoffToVerifier) {
    lines.push("完成后请保留可供 verifier 收口的摘要、验证信息与风险点。");
  }
  if (plan.gaps.length > 0) {
    lines.push(`已知能力缺口: ${plan.gaps.join(" | ")}`);
  }
  return lines.join("\n");
}

function buildLaunchDefaultSummary(subAgent: GoalCapabilityPlanRecord["subAgents"][number] | undefined): string | undefined {
  if (!subAgent?.catalogDefault) return undefined;
  const fragments = [
    subAgent.catalogDefault.permissionMode ? `permission=${subAgent.catalogDefault.permissionMode}` : "",
    subAgent.catalogDefault.maxToolRiskLevel ? `risk=${subAgent.catalogDefault.maxToolRiskLevel}` : "",
    subAgent.catalogDefault.handoffStyle ? `handoff=${subAgent.catalogDefault.handoffStyle}` : "",
    Array.isArray(subAgent.catalogDefault.allowedToolFamilies) && subAgent.catalogDefault.allowedToolFamilies.length > 0
      ? `tools=${subAgent.catalogDefault.allowedToolFamilies.slice(0, 4).join("/")}${subAgent.catalogDefault.allowedToolFamilies.length > 4 ? "+" : ""}`
      : "",
  ].filter(Boolean);
  return fragments.length > 0 ? fragments.join("; ") : undefined;
}

function buildSuggestedLaunchSummary(subAgent: GoalCapabilityPlanRecord["subAgents"][number] | undefined): string | undefined {
  if (!subAgent) return undefined;
  const launchDefaults = buildLaunchDefaultSummary(subAgent);
  const fragments = [
    subAgent.role ? `role=${subAgent.role}` : "",
    launchDefaults,
    subAgent.reason ? `policy=${subAgent.reason}` : "",
  ].filter(Boolean);
  return fragments.length > 0 ? fragments.join("; ") : undefined;
}

function buildPolicySummary(
  coordinationPlan: GoalCapabilityPlanCoordinationPlanRecord,
  subAgent: GoalCapabilityPlanRecord["subAgents"][number] | undefined,
): string {
  const launchDefaults = buildLaunchDefaultSummary(subAgent);
  return launchDefaults
    ? `${coordinationPlan.summary} [role=${subAgent?.role ?? "default"}; ${launchDefaults}]`
    : `${coordinationPlan.summary} [role=${subAgent?.role ?? "default"}]`;
}

function buildOrchestrationExplainabilityNotes(
  plan: GoalCapabilityPlanRecord,
  coordinationPlan: GoalCapabilityPlanCoordinationPlanRecord,
): string[] {
  const lines = [
    `delegation reason: ${coordinationPlan.summary}`,
  ];
  for (const item of plan.subAgents) {
    const launchDefaults = buildLaunchDefaultSummary(item);
    const suggestedLaunch = buildSuggestedLaunchSummary(item);
    if (launchDefaults) {
      lines.push(`catalog default -> ${item.agentId}${item.role ? `(${item.role})` : ""}: ${launchDefaults}`);
    }
    if (suggestedLaunch) {
      lines.push(`suggested launch -> ${item.agentId}${item.role ? `(${item.role})` : ""}: ${suggestedLaunch}`);
    }
    if (item.reason) {
      lines.push(`delegation reason -> ${item.agentId}: ${item.reason}`);
    }
  }
  return lines;
}

function buildCheckpointRequestNote(plan: GoalCapabilityPlanRecord): string {
  const guidance = plan.subAgents
    .map((item) => {
      const launchDefaults = buildLaunchDefaultSummary(item);
      return launchDefaults ? `${item.agentId}${item.role ? `(${item.role})` : ""}: ${launchDefaults}` : undefined;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
  const note = plan.checkpoint.suggestedNote || plan.checkpoint.reasons.join(" ");
  if (guidance.length <= 0) return note;
  return [note, `建议审批时同时确认 catalog default：${guidance.join(" ; ")}。`].filter(Boolean).join(" ");
}

function inferRolePolicy(plan: GoalCapabilityPlanRecord): GoalCapabilityPlanRolePolicyRecord {
  const selectedRoles: GoalCapabilityPlanRolePolicyRecord["selectedRoles"] = [];
  for (const item of plan.subAgents) {
    const role = item.role ?? "default";
    if (!selectedRoles.includes(role)) {
      selectedRoles.push(role);
    }
  }
  if (selectedRoles.length === 0) {
    selectedRoles.push("default");
  }
  const verifierRole = selectedRoles.includes("verifier") || plan.riskLevel !== "low" ? "verifier" : undefined;
  return {
    selectedRoles,
    selectionReasons: ["由现有 capability plan 的 subAgents 自动推断 coordinator role policy。"],
    verifierRole,
    fanInStrategy: plan.governanceMode === "commander"
      ? "commander_review"
      : verifierRole
        ? "verifier_handoff"
        : "main_agent_summary",
  };
}

function getCoordinationPlan(plan: GoalCapabilityPlanRecord): GoalCapabilityPlanCoordinationPlanRecord {
  if (plan.orchestration?.coordinationPlan) {
    return plan.orchestration.coordinationPlan;
  }
  const rolePolicy = inferRolePolicy(plan);
  return {
    summary: (plan.executionMode === "multi_agent" || plan.executionMode === "multi_agent_parallel" || plan.executionMode === "multi_agent_sequential")
      ? `按 ${plan.subAgents.length || 1} 路分工推进，并以 ${rolePolicy.fanInStrategy} 收口${plan.governanceMode === "commander" && plan.commanderAgentId ? `；manager=${plan.commanderAgentId}` : ""}。`
      : `由主 Agent 直接推进，并以 ${rolePolicy.fanInStrategy} 收口${plan.governanceMode === "commander" && plan.commanderAgentId ? `；manager=${plan.commanderAgentId}` : ""}。`,
    plannedDelegationCount: (plan.executionMode === "multi_agent" || plan.executionMode === "multi_agent_parallel" || plan.executionMode === "multi_agent_sequential")
      ? plan.subAgents.length
      : 0,
    managerAgentId: plan.governanceMode === "commander" ? plan.commanderAgentId : undefined,
    rolePolicy,
  };
}

function getExecutionSubAgents(plan: GoalCapabilityPlanRecord): GoalCapabilityPlanRecord["subAgents"] {
  return plan.subAgents.filter((item) => item.role !== "verifier");
}

function getVerifierSubAgent(plan: GoalCapabilityPlanRecord): GoalCapabilityPlanRecord["subAgents"][number] | undefined {
  return plan.subAgents.find((item) => item.role === "verifier");
}

function createSkippedDelegationResults(
  plan: GoalCapabilityPlanRecord,
  summary: string,
): GoalCapabilityPlanDelegationResultRecord[] {
  return getExecutionSubAgents(plan).map((item) => ({
    agentId: item.agentId,
    role: item.role,
    status: "skipped",
    summary,
  }));
}

async function delegatePlanSubAgents(
  agentCapabilities: AgentCapabilities | undefined,
  context: ToolContext,
  plan: GoalCapabilityPlanRecord,
  coordinationPlan: GoalCapabilityPlanCoordinationPlanRecord,
  nodeTitle: string,
): Promise<{
  delegated: boolean;
  outputs: string[];
  delegationCount: number;
  results: GoalCapabilityPlanDelegationResultRecord[];
}> {
  const executionSubAgents = getExecutionSubAgents(plan);
  if (!agentCapabilities) {
    const summary = "未提供 agentCapabilities，跳过子代理委托。";
    return {
      delegated: false,
      outputs: [summary],
      delegationCount: 0,
      results: createSkippedDelegationResults(plan, summary),
    };
  }
  if (executionSubAgents.length === 0) {
    return { delegated: false, outputs: ["plan 中未定义子代理分工。"], delegationCount: 0, results: [] };
  }

  if (agentCapabilities.spawnParallel) {
    const results = await agentCapabilities.spawnParallel(
      executionSubAgents.map((item) => buildSubAgentLaunchSpec(context, {
        instruction: buildDelegationInstruction(plan, nodeTitle, item),
        agentId: item.agentId === "default" ? undefined : item.agentId,
        context: {
          goalId: plan.goalId,
          nodeId: plan.nodeId,
          planId: plan.id,
          objective: item.objective,
        },
        channel: "goal",
        role: item.role,
        policySummary: buildPolicySummary(coordinationPlan, item),
        delegationSource: "goal_subtask",
        expectedDeliverableSummary: item.deliverable ?? item.objective,
        aggregationMode: coordinationPlan.rolePolicy.fanInStrategy === "verifier_handoff"
          ? "verifier_fan_in"
          : "main_agent_summary",
        goalId: plan.goalId,
        nodeId: plan.nodeId,
        planId: plan.id,
      })),
    );
    return {
      delegated: true,
      delegationCount: results.length,
      results: results.map((result, index) => {
        const subAgent = executionSubAgents[index];
        return {
          agentId: subAgent?.agentId ?? "unknown",
          role: subAgent?.role,
          status: result.success ? "success" : "failed",
          summary: result.success ? "子代理已成功接手该分工。" : `子代理启动失败: ${result.error ?? "unknown error"}`,
          error: result.success ? undefined : result.error ?? "unknown error",
          sessionId: result.sessionId,
          taskId: result.taskId,
          outputPath: result.outputPath,
        };
      }),
      outputs: results.map((result, index) => {
        const subAgent = executionSubAgents[index];
        return result.success
          ? `- ${subAgent.agentId}: success`
          : `- ${subAgent.agentId}: failed (${result.error ?? "unknown error"})`;
      }),
    };
  }

  if (agentCapabilities.spawnSubAgent) {
    const outputs: string[] = [];
    let delegationCount = 0;
    const results: GoalCapabilityPlanDelegationResultRecord[] = [];
    for (const item of executionSubAgents) {
      const launchSpec = buildSubAgentLaunchSpec(context, {
        instruction: buildDelegationInstruction(plan, nodeTitle, item),
        agentId: item.agentId === "default" ? undefined : item.agentId,
        context: {
          goalId: plan.goalId,
          nodeId: plan.nodeId,
          planId: plan.id,
          objective: item.objective,
        },
        channel: "goal",
        role: item.role,
        policySummary: buildPolicySummary(coordinationPlan, item),
        delegationSource: "goal_subtask",
        expectedDeliverableSummary: item.deliverable ?? item.objective,
        aggregationMode: coordinationPlan.rolePolicy.fanInStrategy === "verifier_handoff"
          ? "verifier_fan_in"
          : "main_agent_summary",
        goalId: plan.goalId,
        nodeId: plan.nodeId,
        planId: plan.id,
      });
      const result = await agentCapabilities.spawnSubAgent(launchSpec);
      delegationCount += 1;
      results.push({
        agentId: item.agentId,
        role: item.role,
        status: result.success ? "success" : "failed",
        summary: result.success ? "子代理已成功接手该分工。" : `子代理启动失败: ${result.error ?? "unknown error"}`,
        error: result.success ? undefined : result.error ?? "unknown error",
        sessionId: result.sessionId,
        taskId: result.taskId,
        outputPath: result.outputPath,
      });
      outputs.push(result.success ? `- ${item.agentId}: success` : `- ${item.agentId}: failed (${result.error ?? "unknown error"})`);
    }
    return { delegated: true, outputs, delegationCount, results };
  }

  const summary = "当前运行时不支持子代理编排。";
  return {
    delegated: false,
    outputs: [summary],
    delegationCount: 0,
    results: createSkippedDelegationResults(plan, summary),
  };
}

function buildVerifierHandoff(
  plan: GoalCapabilityPlanRecord,
  coordinationPlan: GoalCapabilityPlanCoordinationPlanRecord,
  delegationResults: GoalCapabilityPlanDelegationResultRecord[],
  checkpointRequested: boolean,
): GoalCapabilityPlanVerifierHandoffRecord {
  const sourceAgentIds = getExecutionSubAgents(plan)
    .filter((item) => item.handoffToVerifier)
    .map((item) => item.agentId);
  if (coordinationPlan.rolePolicy.fanInStrategy !== "verifier_handoff") {
    return {
      status: "not_required",
      summary: coordinationPlan.rolePolicy.fanInStrategy === "commander_review"
        ? "当前协调计划改由 commander_review 收口，不要求 verifier handoff。"
        : "当前协调计划不要求 verifier 收口。",
      sourceAgentIds,
    };
  }

  const sourceResults = delegationResults.filter((item) => sourceAgentIds.includes(item.agentId));
  const completedSources = sourceResults
    .filter((item) => item.status === "success")
    .map((item) => item.agentId);
  const failedSources = sourceResults
    .filter((item) => item.status === "failed")
    .map((item) => item.agentId);
  const pendingSources = sourceAgentIds.filter((item) => !completedSources.includes(item));
  const sourceTaskIds = sourceResults
    .map((item) => item.taskId)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const notes: string[] = [];

  if (checkpointRequested) {
    notes.push("checkpoint 尚未通过，handoff 暂不进入执行。");
  }
  if (failedSources.length > 0) {
    notes.push(`存在失败分工: ${failedSources.join(", ")}`);
  }

  if (checkpointRequested) {
    return {
      status: "pending",
      verifierRole: coordinationPlan.rolePolicy.verifierRole,
      summary: sourceAgentIds.length > 0
        ? `等待 checkpoint 通过后再移交 verifier；来源分工=${sourceAgentIds.join(", ")}。`
        : "等待 checkpoint 通过后再进入 verifier 收口。",
      sourceAgentIds,
      sourceTaskIds: sourceTaskIds.length > 0 ? sourceTaskIds : undefined,
      notes,
    };
  }
  if (sourceAgentIds.length === 0) {
    return {
      status: "pending",
      verifierRole: coordinationPlan.rolePolicy.verifierRole,
      summary: "当前还没有可供 verifier 收口的子代理来源，需等待主 Agent 或后续分工产出 handoff。",
      sourceAgentIds,
      sourceTaskIds: sourceTaskIds.length > 0 ? sourceTaskIds : undefined,
      notes: notes.length > 0 ? notes : undefined,
    };
  }
  if (pendingSources.length === 0 && failedSources.length === 0) {
    return {
      status: "ready",
      verifierRole: coordinationPlan.rolePolicy.verifierRole,
      summary: `来源分工结果已齐备，可移交 verifier 收口；来源=${sourceAgentIds.join(", ")}。`,
      sourceAgentIds,
      sourceTaskIds: sourceTaskIds.length > 0 ? sourceTaskIds : undefined,
      notes: notes.length > 0 ? notes : undefined,
    };
  }
  return {
    status: "pending",
    verifierRole: coordinationPlan.rolePolicy.verifierRole,
    summary: `已记录 verifier handoff，待补齐来源结果；待补齐=${pendingSources.join(", ") || failedSources.join(", ")}。`,
    sourceAgentIds,
    sourceTaskIds: sourceTaskIds.length > 0 ? sourceTaskIds : undefined,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildVerifierInstruction(
  plan: GoalCapabilityPlanRecord,
  nodeTitle: string,
  handoff: GoalCapabilityPlanVerifierHandoffRecord,
  delegationResults: GoalCapabilityPlanDelegationResultRecord[],
): string {
  const sourceLines = delegationResults
    .filter((item) => handoff.sourceAgentIds.includes(item.agentId))
    .map((item) => [
      `- ${item.agentId}${item.role ? ` [${item.role}]` : ""}`,
      item.summary,
      item.taskId ? `task=${item.taskId}` : undefined,
      item.outputPath ? `output=${item.outputPath}` : undefined,
    ].filter(Boolean).join(" | "));
  const lines = [
    `长期任务节点: ${nodeTitle} (${plan.nodeId})`,
    "角色: verifier",
    `收口摘要: ${handoff.summary}`,
    "请基于以下来源分工结果做验证、风险检查与验收结论。",
    `Sources:\n${sourceLines.length > 0 ? sourceLines.join("\n") : "- (none)"}`,
  ];
  if (plan.methods.length > 0) {
    lines.push(`参考 Methods: ${plan.methods.map((item) => item.file).join(", ")}`);
  }
  if (plan.skills.length > 0) {
    lines.push(`参考 Skills: ${plan.skills.map((item) => item.name).join(", ")}`);
  }
  if (plan.checkpoint.required) {
    lines.push(`Checkpoint Policy: ${plan.checkpoint.approvalMode} | ${plan.checkpoint.reasons.join(" | ") || "(none)"}`);
  }
  return lines.join("\n");
}

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

function extractVerifierSummary(output: string | undefined, fallback: string): string {
  const lines = String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] ?? fallback;
}

function inferVerifierFindingSeverity(line: string): GoalCapabilityPlanVerifierFindingRecord["severity"] {
  const normalized = line.toLowerCase();
  if (
    /blocked|blocker|reject|rejected|fail|failure|error|critical/.test(normalized)
    || /阻塞|拒绝|失败|错误|严重/.test(line)
  ) {
    return "high";
  }
  if (
    /warn|warning|risk|issue|problem|todo|fix|revise/.test(normalized)
    || /风险|问题|告警|警告|待办|修复|修正|调整/.test(line)
  ) {
    return "medium";
  }
  return "low";
}

function extractVerifierFindings(output: string | undefined): GoalCapabilityPlanVerifierFindingRecord[] {
  const lines = uniqueStrings(
    String(output ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) return true;
        return /risk|issue|problem|warn|warning|todo|fix|failed|failure|error|blocked|blocker/i.test(line)
          || /风险|问题|告警|警告|待办|修复|失败|错误|阻塞/.test(line);
      }),
  ).slice(0, 8);
  return lines.map((summary) => ({
    severity: inferVerifierFindingSeverity(summary),
    summary,
  }));
}

function inferVerifierRecommendation(
  output: string | undefined,
  status: GoalCapabilityPlanVerifierResultRecord["status"],
): GoalCapabilityPlanVerifierResultRecord["recommendation"] {
  if (status === "failed") return "blocked";
  const normalized = String(output ?? "").toLowerCase();
  if (
    /blocked|blocker|reject|rejected|fail|failure|error|critical/.test(normalized)
    || /阻塞|拒绝|失败|错误|严重/.test(String(output ?? ""))
  ) {
    return "blocked";
  }
  if (
    /revise|fix|todo|warn|warning|issue|problem|risk|needs?\s+change/.test(normalized)
    || /修复|修正|调整|待办|告警|警告|风险|问题|需改/.test(String(output ?? ""))
  ) {
    return "revise";
  }
  if (
    /approve|approved|pass|passed|success|verified|looks good/.test(normalized)
    || /通过|批准|成功|已验证|验收通过/.test(String(output ?? ""))
  ) {
    return "approve";
  }
  return "unknown";
}

function buildVerifierResultFromHandoff(
  handoff: GoalCapabilityPlanVerifierHandoffRecord,
): GoalCapabilityPlanVerifierResultRecord | undefined {
  if (handoff.status === "not_required" || handoff.status === "skipped") return undefined;
  return {
    status: handoff.status === "failed" ? "failed" : "pending",
    summary: handoff.summary,
    findings: Array.isArray(handoff.notes)
      ? handoff.notes.slice(0, 5).map((summary) => ({ severity: "medium", summary }))
      : [],
    recommendation: handoff.status === "failed" ? "blocked" : "unknown",
    evidenceTaskIds: handoff.sourceTaskIds && handoff.sourceTaskIds.length > 0 ? handoff.sourceTaskIds : undefined,
    outputPath: handoff.outputPath,
    generatedAt: new Date().toISOString(),
  };
}

function buildVerifierResultAsset(
  handoff: GoalCapabilityPlanVerifierHandoffRecord,
  result: {
    output?: string;
    error?: string;
    taskId?: string;
    outputPath?: string;
  } | undefined,
  status: GoalCapabilityPlanVerifierResultRecord["status"],
): GoalCapabilityPlanVerifierResultRecord {
  const rawOutput = result?.output || result?.error || handoff.error || handoff.summary;
  const findings = extractVerifierFindings(rawOutput);
  if (findings.length === 0 && status === "failed") {
    findings.push({
      severity: "high",
      summary: result?.error || handoff.error || handoff.summary,
    });
  }
  return {
    status,
    summary: extractVerifierSummary(rawOutput, handoff.summary),
    findings,
    recommendation: inferVerifierRecommendation(rawOutput, status),
    evidenceTaskIds: uniqueStrings([...(handoff.sourceTaskIds ?? []), result?.taskId]),
    outputPath: result?.outputPath ?? handoff.outputPath,
    generatedAt: new Date().toISOString(),
  };
}

async function launchVerifierHandoff(
  agentCapabilities: AgentCapabilities | undefined,
  context: ToolContext,
  plan: GoalCapabilityPlanRecord,
  coordinationPlan: GoalCapabilityPlanCoordinationPlanRecord,
  handoff: GoalCapabilityPlanVerifierHandoffRecord,
  delegationResults: GoalCapabilityPlanDelegationResultRecord[],
  nodeTitle: string,
): Promise<{
  handoff: GoalCapabilityPlanVerifierHandoffRecord;
  outputs: string[];
  verifierResult?: GoalCapabilityPlanVerifierResultRecord;
}> {
  if (handoff.status !== "ready") {
    return {
      handoff,
      outputs: [],
      verifierResult: buildVerifierResultFromHandoff(handoff),
    };
  }
  if (!agentCapabilities?.spawnSubAgent) {
    const failedHandoff: GoalCapabilityPlanVerifierHandoffRecord = {
      ...handoff,
      status: "failed",
      error: "当前运行时不支持 verifier 子任务。",
      notes: [...(handoff.notes ?? []), "未提供 spawnSubAgent，无法启动 verifier runtime。"],
    };
    return {
      handoff: failedHandoff,
      outputs: ["verifier runtime 启动失败：当前运行时不支持 verifier 子任务。"],
      verifierResult: buildVerifierResultAsset(failedHandoff, {
        error: "当前运行时不支持 verifier 子任务。",
      }, "failed"),
    };
  }

  const verifierSubAgent = getVerifierSubAgent(plan);
  const launchSpec = buildSubAgentLaunchSpec(context, {
    instruction: buildVerifierInstruction(plan, nodeTitle, handoff, delegationResults),
    agentId: verifierSubAgent?.agentId && verifierSubAgent.agentId !== "default" ? verifierSubAgent.agentId : undefined,
    context: {
      goalId: plan.goalId,
      nodeId: plan.nodeId,
      planId: plan.id,
      handoff: "verifier",
      sourceTaskIds: handoff.sourceTaskIds ?? [],
    },
    channel: "goal",
    role: "verifier",
    policySummary: buildPolicySummary(coordinationPlan, verifierSubAgent),
    delegationSource: "goal_verifier",
    expectedDeliverableSummary: "Produce verifier fan-in summary, findings, and final acceptance decision.",
    aggregationMode: "verifier_fan_in",
    goalId: plan.goalId,
    nodeId: plan.nodeId,
    planId: plan.id,
    sourceAgentIds: handoff.sourceAgentIds,
  });
  const runningHandoff: GoalCapabilityPlanVerifierHandoffRecord = {
    ...handoff,
    status: "running",
    verifierAgentId: launchSpec.agentId ?? verifierSubAgent?.agentId ?? "default",
  };
  const result = await agentCapabilities.spawnSubAgent(launchSpec);
  if (result.success) {
    const completedHandoff: GoalCapabilityPlanVerifierHandoffRecord = {
      ...runningHandoff,
      status: "completed",
      summary: "verifier runtime 已完成收口，请查看输出中的验证结论。",
      verifierTaskId: result.taskId,
      verifierSessionId: result.sessionId,
      outputPath: result.outputPath,
    };
    return {
      handoff: completedHandoff,
      outputs: [`- verifier: success${result.taskId ? ` (task=${result.taskId})` : ""}`],
      verifierResult: buildVerifierResultAsset(completedHandoff, result, "completed"),
    };
  }
  const failedHandoff: GoalCapabilityPlanVerifierHandoffRecord = {
    ...runningHandoff,
    status: "failed",
    summary: `verifier runtime 启动失败: ${result.error ?? "unknown error"}`,
    verifierTaskId: result.taskId,
    verifierSessionId: result.sessionId,
    outputPath: result.outputPath,
    error: result.error ?? "unknown error",
  };
  return {
    handoff: failedHandoff,
    outputs: [`- verifier: failed (${result.error ?? "unknown error"})`],
    verifierResult: buildVerifierResultAsset(failedHandoff, result, "failed"),
  };
}

async function ensureRiskCheckpoint(
  goalId: string,
  nodeId: string,
  nodeTitle: string,
  plan: GoalCapabilityPlanRecord,
  runId: string | undefined,
  context: ToolContext,
): Promise<{ requested: boolean; notes: string[]; latestNodeStatus?: string }> {
  if (!plan.checkpoint.required) {
    return { requested: false, notes: ["当前 plan 未要求自动 checkpoint。"] };
  }
  if (!context.goalCapabilities?.listCheckpoints || !context.goalCapabilities?.requestCheckpoint || !context.goalCapabilities?.updateTaskNode) {
    return {
      requested: false,
      notes: ["plan 判断该节点为高风险，但当前运行时缺少 checkpoint/update 能力，无法自动创建断点。"],
    };
  }

  const checkpoints = await context.goalCapabilities.listCheckpoints(goalId);
  const existing = checkpoints.items.find((item) => item.nodeId === nodeId && (item.status === "required" || item.status === "waiting_user"));
  if (existing) {
    return {
      requested: true,
      latestNodeStatus: existing.status,
      notes: [`已存在待处理 checkpoint: ${existing.id}`],
    };
  }

  await context.goalCapabilities.updateTaskNode(goalId, nodeId, {
    checkpointRequired: true,
    checkpointStatus: "required",
  });
  const requested = await context.goalCapabilities.requestCheckpoint(goalId, nodeId, {
    title: plan.checkpoint.suggestedTitle || `${nodeTitle} checkpoint`,
    summary: `Auto checkpoint before executing ${plan.riskLevel}-risk node`,
    note: buildCheckpointRequestNote(plan),
    reviewer: plan.checkpoint.suggestedReviewer,
    reviewerRole: plan.checkpoint.suggestedReviewerRole,
    requestedBy: context.agentId || "main-agent",
    slaAt: buildCheckpointSlaAt(plan.checkpoint.suggestedSlaHours),
    runId,
  });
  return {
    requested: true,
    latestNodeStatus: requested.node.status,
    notes: [`已自动发起高风险 checkpoint: ${requested.checkpoint.id}`],
  };
}

export const goalOrchestrateTool: Tool = {
  definition: {
    name: "goal_orchestrate",
    description: "在长期任务节点执行前生成 capabilityPlan，并将计划落到 claim / 最小子代理编排。",
    parameters: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "可选，目标 ID；默认从当前 goal 会话推断。" },
        node_id: { type: "string", description: "节点 ID。" },
        objective: { type: "string", description: "可选，覆盖/补充该节点 objective。" },
        query_hints: { type: "array", description: "可选，额外检索 hints。", items: { type: "string" } },
        force_mode: {
          type: "string",
          description: "可选，强制规划模式。",
          enum: ["single_agent", "multi_agent", "multi_agent_parallel", "multi_agent_sequential", "auto"],
        },
        owner: { type: "string", description: "可选，claim 节点时写入的 owner。" },
        auto_delegate: { type: "boolean", description: "可选，若 plan 判断为 multi_agent，则自动触发最小子代理委托。" },
        force_regenerate: { type: "boolean", description: "可选，忽略已有 plan，重新生成。" },
        run_id: { type: "string", description: "可选，绑定 runId。" },
      },
      required: ["node_id"],
    },
  },
  async execute(args: JsonObject, context: ToolContext) {
    const name = "goal_orchestrate";
    if (!context.goalCapabilities?.readTaskGraph || !context.goalCapabilities?.claimTaskNode) {
      return fail(name, "Goal orchestration capabilities are not available in the current runtime.");
    }
    const goalId = inferGoalId(args.goal_id, context.conversationId);
    if (!goalId) return fail(name, "缺少参数: goal_id，且当前会话无法推断所属 goal。");
    const nodeId = String(args.node_id ?? "").trim();
    if (!nodeId) return fail(name, "缺少参数: node_id");

    try {
      let plan = args.force_regenerate === true || !context.goalCapabilities?.getCapabilityPlan
        ? null
        : await context.goalCapabilities.getCapabilityPlan(goalId, nodeId);

      if (!plan) {
        if (!context.goalCapabilities?.generateCapabilityPlan) {
          return fail(name, "缺少 capabilityPlan 生成能力，且当前没有现成 plan。");
        }
        const generated = await context.goalCapabilities.generateCapabilityPlan(goalId, nodeId, {
          objective: String(args.objective ?? "").trim() || undefined,
          queryHints: parseStringArray(args.query_hints),
          forceMode: args.force_mode === "multi_agent"
            || args.force_mode === "multi_agent_parallel"
            || args.force_mode === "multi_agent_sequential"
            || args.force_mode === "auto"
            ? args.force_mode
            : args.force_mode === "single_agent"
              ? "single_agent"
              : undefined,
          runId: String(args.run_id ?? "").trim() || undefined,
        });
        plan = generated.plan;
      }

      const graph = await context.goalCapabilities.readTaskGraph(goalId);
      const node = graph.nodes.find((item) => item.id === nodeId);
      if (!node) {
        return fail(name, `节点不存在: ${nodeId}`);
      }

      let claimed = false;
      let latestNode = node;
      const owner = String(args.owner ?? "").trim() || context.agentId || "main-agent";
      const runId = String(args.run_id ?? "").trim() || plan.runId || node.lastRunId;
      if (node.status === "ready") {
        const claimedResult = await context.goalCapabilities.claimTaskNode(goalId, nodeId, {
          owner,
          summary: `Capability plan ready. ${plan.summary}`,
          runId: runId || undefined,
        });
        claimed = true;
        latestNode = claimedResult.node;
      } else if (!["in_progress", "pending_review", "validating"].includes(node.status)) {
        return fail(name, `当前节点状态不适合 orchestration: ${node.status}`);
      }

      const checkpointOutcome = await ensureRiskCheckpoint(goalId, nodeId, latestNode.title, plan, runId || undefined, context);
      if (checkpointOutcome.latestNodeStatus) {
        latestNode = {
          ...latestNode,
          status: checkpointOutcome.latestNodeStatus as typeof latestNode.status,
        };
      }

      const coordinationPlan = getCoordinationPlan(plan);
      const autoDelegate = args.auto_delegate === true;
      const delegation = autoDelegate && isMultiAgentExecutionMode(plan.executionMode) && !checkpointOutcome.requested
        ? await delegatePlanSubAgents(context.agentCapabilities, context, plan, coordinationPlan, latestNode.title)
        : {
          delegated: false,
          outputs: checkpointOutcome.requested
            ? ["已进入 checkpoint 审批阶段，暂不触发子代理委托。"]
            : [autoDelegate ? "当前 plan 未进入 multi_agent 或无子代理分工，跳过委托。" : "未启用 auto_delegate，跳过子代理委托。"],
          delegationCount: 0,
          results: autoDelegate
            ? createSkippedDelegationResults(
              plan,
              checkpointOutcome.requested ? "已进入 checkpoint 审批阶段，暂不触发子代理委托。" : "当前 plan 未进入 multi_agent 或无子代理分工，跳过委托。",
            )
            : createSkippedDelegationResults(plan, "未启用 auto_delegate，跳过子代理委托。"),
        };

      const actualUsage = collectCapabilityPlanActualUsage(context);
      const handoffDraft = buildVerifierHandoff(plan, coordinationPlan, delegation.results, checkpointOutcome.requested);
      const explainabilityNotes = buildOrchestrationExplainabilityNotes(plan, coordinationPlan);
      const verifierRuntime = autoDelegate
        ? await launchVerifierHandoff(
          context.agentCapabilities,
          context,
          plan,
          coordinationPlan,
          handoffDraft,
          delegation.results,
          latestNode.title,
        )
        : {
          handoff: handoffDraft,
          outputs: [],
          verifierResult: buildVerifierResultFromHandoff(handoffDraft),
        };
      const verifierHandoff = verifierRuntime.handoff;
      const verifierResult = verifierRuntime.verifierResult;

      if (context.goalCapabilities.saveCapabilityPlan) {
        plan = await context.goalCapabilities.saveCapabilityPlan(goalId, nodeId, {
          ...buildCapabilityPlanSaveInput(plan, {
            runId: runId || plan.runId,
            status: "orchestrated",
            actualUsage,
          }),
          orchestratedAt: new Date().toISOString(),
          orchestration: {
            ...plan.orchestration,
            claimed,
            delegated: delegation.delegated,
            delegationCount: delegation.delegationCount,
            coordinationPlan,
            delegationResults: delegation.results,
            verifierHandoff,
            verifierResult,
            notes: [...explainabilityNotes, ...checkpointOutcome.notes, ...delegation.outputs, ...verifierRuntime.outputs],
          },
        });
      }

      const lines = [
        claimed ? "节点已 claim 并进入执行态。" : `节点保持当前状态: ${latestNode.status}`,
        ...explainabilityNotes,
        ...checkpointOutcome.notes,
        ...delegation.outputs,
        ...verifierRuntime.outputs,
        "",
        formatCapabilityPlan(plan),
        "",
        formatTaskNode(latestNode),
      ];
      return ok(name, lines.join("\n"));
    } catch (err) {
      return fail(name, `goal orchestration 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
