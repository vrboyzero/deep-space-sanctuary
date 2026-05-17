import type {
  GoalCapabilityExecutionMode,
  GoalCapabilityGovernanceMode,
  GoalCapabilityPlanFinalApprovalMode,
  GoalCapabilityPlanCoordinationPlan,
  GoalCapabilityPlanMethod,
  GoalCapabilityPlanMcpServer,
  GoalCapabilityPlanRolePolicy,
  GoalCapabilityPlanSaveInput,
  GoalCapabilityPlanSkill,
  GoalCapabilityPlanSubAgent,
  GoalCapabilityRiskLevel,
} from "./types.js";

export type CapabilityPlannerMethodCandidate = GoalCapabilityPlanMethod;
export type CapabilityPlannerSkillCandidate = GoalCapabilityPlanSkill;
export type CapabilityPlannerMcpCandidate = GoalCapabilityPlanMcpServer;
export type CapabilityPlannerAgentCandidate = {
  id: string;
  kind?: "resident" | "worker";
  catalog?: {
    whenToUse?: string[];
    defaultRole?: GoalCapabilityPlanSubAgent["role"];
    defaultPermissionMode?: "plan" | "acceptEdits" | "confirm";
    defaultAllowedToolFamilies?: string[];
    defaultMaxToolRiskLevel?: "low" | "medium" | "high" | "critical";
    skills?: string[];
    handoffStyle?: "summary" | "structured";
  };
};

export type CapabilityPlannerInput = {
  goalTitle: string;
  goalObjective?: string;
  nodeId: string;
  nodeTitle: string;
  nodeDescription?: string;
  nodePhase?: string;
  nodeOwner?: string;
  queryHints?: string[];
  methods?: CapabilityPlannerMethodCandidate[];
  skills?: CapabilityPlannerSkillCandidate[];
  mcpServers?: CapabilityPlannerMcpCandidate[];
  availableAgentIds?: string[];
  availableAgents?: CapabilityPlannerAgentCandidate[];
  forceMode?: GoalCapabilityExecutionMode;
  forceGovernanceMode?: GoalCapabilityGovernanceMode;
  preferredAgents?: string[];
  commanderAgentId?: string;
  runId?: string;
};

function compactText(parts: Array<string | undefined>): string {
  return parts
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .join(" ")
    .trim();
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeAgentCandidates(input: CapabilityPlannerInput): CapabilityPlannerAgentCandidate[] {
  const fromCatalog = Array.isArray(input.availableAgents)
    ? input.availableAgents
      .filter((item): item is CapabilityPlannerAgentCandidate => Boolean(item?.id && item.id.trim()))
      .map((item) => ({
        id: item.id.trim(),
        kind: item.kind,
        catalog: item.catalog
          ? {
            whenToUse: uniqueStrings(item.catalog.whenToUse ?? []),
            defaultRole: item.catalog.defaultRole,
            defaultPermissionMode: item.catalog.defaultPermissionMode,
            defaultAllowedToolFamilies: uniqueStrings(item.catalog.defaultAllowedToolFamilies ?? []),
            defaultMaxToolRiskLevel: item.catalog.defaultMaxToolRiskLevel,
            skills: uniqueStrings(item.catalog.skills ?? []),
            handoffStyle: item.catalog.handoffStyle,
          }
          : undefined,
      }))
    : [];
  if (fromCatalog.length > 0) {
    return fromCatalog;
  }
  return uniqueStrings(input.availableAgentIds ?? []).map((id) => ({ id }));
}

function buildTextTokens(value: string): string[] {
  return uniqueStrings(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
}

function scoreWhenToUseMatch(textTokens: string[], hints: string[] | undefined): number {
  if (!Array.isArray(hints) || hints.length === 0 || textTokens.length === 0) return 0;
  let score = 0;
  for (const hint of hints) {
    const hintTokens = buildTextTokens(hint);
    const overlap = hintTokens.filter((token) => textTokens.includes(token)).length;
    if (overlap > 0) {
      score += overlap * 2;
    }
  }
  return score;
}

function scoreAgentCandidate(
  candidate: CapabilityPlannerAgentCandidate,
  role: GoalCapabilityPlanSubAgent["role"],
  preferredIds: string[],
  textTokens: string[],
): number {
  let score = 0;
  const preferredIndex = preferredIds.indexOf(candidate.id);
  if (preferredIndex >= 0) {
    score += Math.max(0, 8 - preferredIndex * 2);
  }
  if (candidate.catalog?.defaultRole === role) {
    score += 12;
  }
  if (role === "verifier" && candidate.catalog?.handoffStyle === "structured") {
    score += 4;
  }
  if (role === "researcher" && candidate.catalog?.defaultPermissionMode === "plan") {
    score += 2;
  }
  if (role === "coder" && (candidate.catalog?.defaultAllowedToolFamilies ?? []).some((item) => item === "workspace-write" || item === "patch")) {
    score += 2;
  }
  if (candidate.kind === "worker" && role && role !== "default") {
    score += 1;
  }
  score += scoreWhenToUseMatch(textTokens, candidate.catalog?.whenToUse);
  return score;
}

function buildCatalogDefault(candidate: CapabilityPlannerAgentCandidate): GoalCapabilityPlanSubAgent["catalogDefault"] | undefined {
  if (!candidate.catalog) return undefined;
  return {
    permissionMode: candidate.catalog.defaultPermissionMode,
    allowedToolFamilies: candidate.catalog.defaultAllowedToolFamilies,
    maxToolRiskLevel: candidate.catalog.defaultMaxToolRiskLevel,
    handoffStyle: candidate.catalog.handoffStyle,
    whenToUse: candidate.catalog.whenToUse,
    skills: candidate.catalog.skills,
  };
}

function formatCatalogDefaultFragments(
  catalogDefault: GoalCapabilityPlanSubAgent["catalogDefault"] | undefined,
): string[] {
  if (!catalogDefault) return [];
  return uniqueStrings([
    catalogDefault.permissionMode ? `permission=${catalogDefault.permissionMode}` : undefined,
    catalogDefault.maxToolRiskLevel ? `risk=${catalogDefault.maxToolRiskLevel}` : undefined,
    catalogDefault.handoffStyle ? `handoff=${catalogDefault.handoffStyle}` : undefined,
    Array.isArray(catalogDefault.allowedToolFamilies) && catalogDefault.allowedToolFamilies.length > 0
      ? `tools=${catalogDefault.allowedToolFamilies.slice(0, 4).join("/")}${catalogDefault.allowedToolFamilies.length > 4 ? "+" : ""}`
      : undefined,
    Array.isArray(catalogDefault.whenToUse) && catalogDefault.whenToUse.length > 0
      ? `when=${catalogDefault.whenToUse[0]}`
      : undefined,
    Array.isArray(catalogDefault.skills) && catalogDefault.skills.length > 0
      ? `skills=${catalogDefault.skills.length}`
      : undefined,
  ]);
}

function resolveAgentCandidate(
  availableAgents: CapabilityPlannerAgentCandidate[],
  preferredIds: string[],
  role: GoalCapabilityPlanSubAgent["role"],
  text: string,
): {
  agentId: string;
  matchedCatalog: boolean;
  reasonFragments: string[];
  catalogDefault?: GoalCapabilityPlanSubAgent["catalogDefault"];
} {
  if (availableAgents.length <= 0) {
    return {
      agentId: preferredIds[0] ?? "default",
      matchedCatalog: false,
      reasonFragments: [],
      catalogDefault: undefined,
    };
  }

  const textTokens = buildTextTokens(text);
  const ranked = availableAgents
    .map((candidate) => ({
      candidate,
      score: scoreAgentCandidate(candidate, role, preferredIds, textTokens),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftPreferredIndex = preferredIds.indexOf(left.candidate.id);
      const rightPreferredIndex = preferredIds.indexOf(right.candidate.id);
      if (leftPreferredIndex !== rightPreferredIndex) {
        return (leftPreferredIndex < 0 ? Number.MAX_SAFE_INTEGER : leftPreferredIndex)
          - (rightPreferredIndex < 0 ? Number.MAX_SAFE_INTEGER : rightPreferredIndex);
      }
      return left.candidate.id.localeCompare(right.candidate.id);
    });
  const selected = ranked[0]?.candidate ?? { id: preferredIds[0] ?? "default" };
  const matchedCatalog = ranked[0]?.score ? ranked[0].score > 0 && Boolean(selected.catalog) : false;
  const catalogDefault = buildCatalogDefault(selected);
  const reasonFragments = [
    selected.catalog?.defaultRole === role ? `catalog defaultRole=${role}` : undefined,
    role === "verifier" && selected.catalog?.handoffStyle === "structured" ? "catalog handoff=structured" : undefined,
    role === "researcher" && selected.catalog?.defaultPermissionMode === "plan" ? "catalog permission=plan" : undefined,
    (selected.catalog?.skills?.length ?? 0) > 0 ? `catalog skills=${selected.catalog?.skills?.length ?? 0}` : undefined,
    Array.isArray(selected.catalog?.whenToUse) && selected.catalog.whenToUse.length > 0
      ? `catalog when=${selected.catalog.whenToUse[0]}`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    agentId: selected.id,
    matchedCatalog,
    reasonFragments,
    catalogDefault,
  };
}

function pickExecutionMode(text: string, forceMode?: GoalCapabilityExecutionMode): GoalCapabilityExecutionMode {
  if (forceMode) return forceMode;
  if (/(并行|多代理|multi-agent|sub-agent|delegate|delegat|拆分|批量|大规模|跨模块|跨文件|research|调研)/i.test(text)) {
    return "multi_agent_parallel";
  }
  return "single_agent";
}

function isMultiAgentMode(mode: GoalCapabilityExecutionMode): boolean {
  return mode === "multi_agent" || mode === "multi_agent_parallel" || mode === "multi_agent_sequential";
}

function inferRisk(text: string): {
  riskLevel: "low" | "medium" | "high";
  checkpoint: {
    required: boolean;
    reasons: string[];
    approvalMode: "none" | "single" | "strict";
    requiredRequestFields: Array<"reviewer" | "reviewerRole" | "requestedBy" | "slaAt" | "summary" | "note" | "decidedBy">;
    requiredDecisionFields: Array<"reviewer" | "reviewerRole" | "requestedBy" | "slaAt" | "summary" | "note" | "decidedBy">;
    suggestedTitle?: string;
    suggestedNote?: string;
    suggestedReviewer?: string;
    suggestedReviewerRole?: string;
    suggestedSlaHours?: number;
    escalationMode?: "none" | "manual";
  };
} {
  const reasons: string[] = [];
  const addReason = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (/(部署|上线|release|deploy|production|publish)/i.test(text)) addReason("涉及部署/上线/发布。");
  if (/(迁移|migration|schema|数据库|db|sql)/i.test(text)) addReason("涉及数据库或数据迁移。");
  if (/(删除|remove|rm |清理|覆盖|overwrite|replace all|大范围修改)/i.test(text)) addReason("涉及删除、覆盖或大范围修改。");
  if (/(依赖升级|major|breaking|版本升级|upgrade dependency|upgrade package)/i.test(text)) addReason("涉及依赖升级或兼容性变化。");
  if (/(外部系统|api|支付|写入|同步|webhook|browser|网页自动化)/i.test(text)) addReason("涉及外部系统调用或对外写入。");
  if (/(安全|权限|auth|token|secret|credential)/i.test(text)) addReason("涉及权限、安全或敏感配置。");

  const riskLevel = reasons.length >= 2 ? "high" : reasons.length === 1 ? "medium" : "low";
  return {
    riskLevel,
    checkpoint: {
      required: riskLevel === "medium" || riskLevel === "high",
      reasons,
      approvalMode: riskLevel === "high" ? "strict" : riskLevel === "medium" ? "single" : "none",
      requiredRequestFields: riskLevel === "high"
        ? ["reviewerRole", "slaAt", "note"]
        : riskLevel === "medium"
          ? ["reviewerRole"]
          : [],
      requiredDecisionFields: riskLevel === "high"
        ? ["summary", "note", "decidedBy"]
        : riskLevel === "medium"
          ? ["summary", "decidedBy"]
          : [],
      suggestedTitle: riskLevel === "high"
        ? "High-risk execution checkpoint"
        : riskLevel === "medium"
          ? "Risk review checkpoint"
          : undefined,
      suggestedNote: riskLevel === "high"
        ? `该节点命中高风险信号：${reasons.join(" ")}执行前建议先审批影响范围、回滚方案与验证方式。`
        : riskLevel === "medium"
          ? `该节点存在风险信号：${reasons.join(" ")}执行前建议确认审批责任人与验收口径。`
          : undefined,
      suggestedReviewerRole: riskLevel === "high" ? "producer" : riskLevel === "medium" ? "reviewer" : undefined,
      suggestedReviewer: undefined,
      suggestedSlaHours: riskLevel === "high" ? 12 : riskLevel === "medium" ? 24 : undefined,
      escalationMode: riskLevel === "high" ? "manual" : "none",
    },
  };
}

function buildSubAgents(
  text: string,
  preferredAgentIds: string[],
  availableAgents: CapabilityPlannerAgentCandidate[],
  executionMode: GoalCapabilityExecutionMode,
): GoalCapabilityPlanSubAgent[] {
  if (!isMultiAgentMode(executionMode)) return [];
  const plans: GoalCapabilityPlanSubAgent[] = [];

  const pushUnique = (
    resolved: ReturnType<typeof resolveAgentCandidate>,
    role: GoalCapabilityPlanSubAgent["role"],
    objective: string,
    reason: string,
    deliverable: string,
  ) => {
    if (plans.some((item) => item.agentId === resolved.agentId && item.objective === objective)) return;
    plans.push({
      agentId: resolved.agentId,
      role,
      objective,
      reason: resolved.reasonFragments.length > 0 ? `${reason} (${resolved.reasonFragments.join("; ")})` : reason,
      deliverable,
      catalogDefault: resolved.catalogDefault,
    });
  };

  if (/(实现|编码|开发|重构|修复|code|refactor|implement|build)/i.test(text)) {
    const resolved = resolveAgentCandidate(availableAgents, uniqueStrings(["coder", ...preferredAgentIds, "default"]), "coder", text);
    pushUnique(
      resolved,
      "coder",
      "负责主实现与代码改动",
      "节点文本包含实现/重构信号，适合由编码型子代理并行处理。",
      "代码改动、实现说明与关键影响点",
    );
  }
  if (/(调研|文档|方案|research|docs|api|网页|browser|外部)/i.test(text)) {
    const resolved = resolveAgentCandidate(availableAgents, uniqueStrings(["researcher", ...preferredAgentIds, "default"]), "researcher", text);
    pushUnique(
      resolved,
      "researcher",
      "负责补充资料、接口或外部上下文",
      "节点涉及资料检索/文档/外部系统，需要信息侧分工。",
      "资料摘要、接口约束与外部上下文清单",
    );
  }
  if (/(验证|测试|回归|qa|test|review|验收)/i.test(text)) {
    const resolved = resolveAgentCandidate(availableAgents, uniqueStrings(["qa", "verifier", ...preferredAgentIds, "default"]), "verifier", text);
    pushUnique(
      resolved,
      "verifier",
      "负责验证、回归或验收检查",
      "节点文本包含验证/回归信号，适合独立验证子代理。",
      "验证结论、风险清单与验收建议",
    );
  }

  if (plans.length === 0) {
    const resolved = resolveAgentCandidate(availableAgents, uniqueStrings(["default", ...preferredAgentIds]), "default", text);
    pushUnique(
      resolved,
      "default",
      "拆分并推进该节点的独立子任务",
      "节点被判定为 multi_agent，但未匹配到更具体的专用子代理。",
      "子任务执行摘要与产出清单",
    );
  }

  return plans.slice(0, 3);
}

function pickGovernanceMode(input: {
  forceGovernanceMode?: GoalCapabilityGovernanceMode;
  executionMode: GoalCapabilityExecutionMode;
  riskLevel: GoalCapabilityRiskLevel;
  subAgents: GoalCapabilityPlanSubAgent[];
}): GoalCapabilityGovernanceMode {
  if (input.forceGovernanceMode && input.forceGovernanceMode !== "auto") {
    return input.forceGovernanceMode;
  }
  if (
    input.subAgents.length >= 2
    || input.riskLevel !== "low"
    || input.executionMode === "multi_agent_parallel"
    || input.executionMode === "multi_agent_sequential"
  ) {
    return "commander";
  }
  return "direct";
}

function buildRolePolicy(
  text: string,
  executionMode: GoalCapabilityExecutionMode,
  governanceMode: GoalCapabilityGovernanceMode,
  riskLevel: GoalCapabilityRiskLevel,
  subAgents: GoalCapabilityPlanSubAgent[],
): GoalCapabilityPlanRolePolicy {
  const selectedRoles: GoalCapabilityPlanRolePolicy["selectedRoles"] = [];
  const pushRole = (role: GoalCapabilityPlanSubAgent["role"]) => {
    if (!role || selectedRoles.includes(role)) return;
    selectedRoles.push(role);
  };

  if (isMultiAgentMode(executionMode) && subAgents.length > 0) {
    for (const item of subAgents) {
      pushRole(item.role ?? "default");
    }
  } else {
    pushRole("default");
  }

  const verifierRole = selectedRoles.includes("verifier") || riskLevel !== "low" ? "verifier" : undefined;
  return {
    selectedRoles,
    selectionReasons: uniqueStrings([
      selectedRoles.includes("coder") ? "节点包含实现/重构信号，纳入 coder 负责主代码改动。" : undefined,
      selectedRoles.includes("researcher") ? "节点包含文档/API/外部上下文信号，纳入 researcher 补资料与约束。" : undefined,
      selectedRoles.includes("verifier") ? "节点包含验证/回归信号，纳入 verifier 做独立验收。" : undefined,
      selectedRoles.length === 1 && selectedRoles[0] === "default"
        ? "当前仅需要默认分工槽位，由主 Agent 或通用子代理承接。"
        : undefined,
      governanceMode === "commander"
        ? "该节点采用 commander 治理，由统一管理位负责派发、收口与验收闭环。"
        : undefined,
      riskLevel === "medium" || riskLevel === "high"
        ? `节点风险为 ${riskLevel}，结果收口需要显式治理与验收。`
        : undefined,
      /(合并|收口|汇总|验收|review|qa|test)/i.test(text)
        ? "节点文本包含收口/验收信号，编排结果需要保留明确 fan-in 记录。"
        : undefined,
    ]),
    verifierRole,
    fanInStrategy: governanceMode === "commander"
      ? "commander_review"
      : verifierRole
        ? "verifier_handoff"
        : "main_agent_summary",
  };
}

function buildCatalogGuidance(subAgents: GoalCapabilityPlanSubAgent[]): string[] {
  return subAgents
    .map((item) => {
      const fragments = formatCatalogDefaultFragments(item.catalogDefault);
      if (fragments.length <= 0) return undefined;
      return `${item.agentId}${item.role ? `(${item.role})` : ""}: ${fragments.join(", ")}`;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
}

function enrichCheckpointNote(
  checkpoint: ReturnType<typeof inferRisk>["checkpoint"],
  subAgents: GoalCapabilityPlanSubAgent[],
): ReturnType<typeof inferRisk>["checkpoint"] {
  if (!checkpoint.required) return checkpoint;
  const guidance = buildCatalogGuidance(subAgents);
  if (guidance.length <= 0) return checkpoint;
  return {
    ...checkpoint,
    suggestedNote: [
      checkpoint.suggestedNote ?? "",
      `建议审批时同时确认 catalog default：${guidance.join(" ; ")}。`,
    ].filter(Boolean).join(" "),
  };
}

function applyVerifierHandoff(
  subAgents: GoalCapabilityPlanSubAgent[],
  rolePolicy: GoalCapabilityPlanRolePolicy,
): GoalCapabilityPlanSubAgent[] {
  return subAgents.map((item) => ({
    ...item,
    handoffToVerifier: rolePolicy.verifierRole === "verifier" ? item.role !== "verifier" : undefined,
  }));
}

function buildCoordinationPlan(
  executionMode: GoalCapabilityExecutionMode,
  governanceMode: GoalCapabilityGovernanceMode,
  commanderAgentId: string | undefined,
  subAgents: GoalCapabilityPlanSubAgent[],
  rolePolicy: GoalCapabilityPlanRolePolicy,
): GoalCapabilityPlanCoordinationPlan {
  const catalogBackedCount = subAgents.filter((item) => item.catalogDefault).length;
  return {
    summary: isMultiAgentMode(executionMode)
      ? `按 ${subAgents.length || 1} 路分工推进，并以 ${rolePolicy.fanInStrategy} 收口${governanceMode === "commander" && commanderAgentId ? `；manager=${commanderAgentId}` : ""}${catalogBackedCount > 0 ? `；其中 ${catalogBackedCount} 路已并入 catalog 默认 launch 建议` : ""}。`
      : `由主 Agent 直接推进，并以 ${rolePolicy.fanInStrategy} 收口${governanceMode === "commander" && commanderAgentId ? `；manager=${commanderAgentId}` : ""}。`,
    plannedDelegationCount: isMultiAgentMode(executionMode) ? subAgents.length : 0,
    managerAgentId: governanceMode === "commander" ? commanderAgentId : undefined,
    rolePolicy,
  };
}

function inferCommanderFinalApprovalMode(
  governanceMode: GoalCapabilityGovernanceMode,
  riskLevel: GoalCapabilityRiskLevel,
  checkpointRequired: boolean,
): GoalCapabilityPlanFinalApprovalMode | undefined {
  if (governanceMode !== "commander") return undefined;
  return riskLevel === "low" && !checkpointRequired ? "agent_auto_complete" : "user_required";
}

export function buildGoalCapabilityPlan(input: CapabilityPlannerInput): GoalCapabilityPlanSaveInput {
  const text = compactText([
    input.goalTitle,
    input.goalObjective,
    input.nodeTitle,
    input.nodeDescription,
    input.nodePhase,
    input.nodeOwner,
    ...(input.queryHints ?? []),
  ]);
  const executionMode = pickExecutionMode(text, input.forceMode);
  const risk = inferRisk(text);
  const methods = (input.methods ?? []).slice(0, 3);
  const skills = (input.skills ?? []).slice(0, 4);
  const mcpServers = (input.mcpServers ?? []).slice(0, 3);
  const availableAgents = normalizeAgentCandidates(input);
  const preferredAgents = uniqueStrings([...(input.preferredAgents ?? []), ...(input.availableAgentIds ?? [])]);
  const draftSubAgents = buildSubAgents(text, preferredAgents, availableAgents, executionMode);
  const governanceMode = pickGovernanceMode({
    forceGovernanceMode: input.forceGovernanceMode,
    executionMode,
    riskLevel: risk.riskLevel,
    subAgents: draftSubAgents,
  });
  const commanderAgentId = governanceMode === "commander"
    ? input.commanderAgentId?.trim() || preferredAgents[0] || draftSubAgents[0]?.agentId || "default"
    : undefined;
  const rolePolicy = buildRolePolicy(text, executionMode, governanceMode, risk.riskLevel, draftSubAgents);
  const subAgents = applyVerifierHandoff(draftSubAgents, rolePolicy);
  const checkpoint = enrichCheckpointNote(risk.checkpoint, subAgents);
  const coordinationPlan = buildCoordinationPlan(executionMode, governanceMode, commanderAgentId, subAgents, rolePolicy);
  const finalApprovalMode = inferCommanderFinalApprovalMode(governanceMode, risk.riskLevel, checkpoint.required);
  const catalogMatchedSubAgents = subAgents.filter((item) => /catalog /.test(item.reason ?? ""));
  const catalogGuidance = buildCatalogGuidance(subAgents);
  const reasoning = uniqueStrings([
    isMultiAgentMode(executionMode)
      ? `节点包含并行/拆分信号，优先采用 ${executionMode} 规划。`
      : "节点范围较集中，优先由单主 Agent 推进。",
    governanceMode === "commander"
      ? `治理模式采用 commander，由 ${commanderAgentId ?? "default"} 负责统一派发与收口。`
      : "治理模式采用 direct，由当前主 Agent 直接收口。",
    methods.length > 0 ? `找到 ${methods.length} 个可复用 method，可先按既有流程执行。` : "未找到明显匹配的 method，需要边执行边沉淀。",
    skills.length > 0 ? `找到 ${skills.length} 个相关 skill，可按需加载具体操作指南。` : "未找到明显匹配的 skill，可在执行后补充沉淀。",
    mcpServers.length > 0 ? `检测到 ${mcpServers.length} 个相关 MCP 能力候选。` : "当前没有明显匹配的 MCP 候选，默认优先本地工具链。",
    subAgents.length > 0 && isMultiAgentMode(executionMode)
      ? `建议拆成 ${subAgents.length} 个子代理分工。`
      : undefined,
    catalogMatchedSubAgents.length > 0
      ? `子代理选择已参考 agent catalog 默认角色/使用建议：${catalogMatchedSubAgents.map((item) => item.agentId).join(", ")}。`
      : undefined,
    catalogGuidance.length > 0
      ? `已将 catalog 默认 launch 建议带入 orchestration / checkpoint 语义：${catalogGuidance.join(" ; ")}。`
      : undefined,
  ]);

  const gaps = uniqueStrings([
    methods.length === 0 ? "缺少直接匹配的 method，建议在该节点收尾后补沉淀方法论。" : undefined,
    skills.length === 0 ? "缺少直接匹配的 skill，执行中若形成稳定流程可产出 skill 草案。" : undefined,
    /(网页|browser|api|外部|文档|research|调研)/i.test(text) && mcpServers.length === 0
      ? "节点可能需要外部上下文或远程能力，但当前未匹配到可用 MCP 入口。"
      : undefined,
    isMultiAgentMode(executionMode) && subAgents.every((item) => item.agentId === "default")
      ? "当前缺少更专用的子代理 profile，暂时只能用 default 子代理承接分工。"
      : undefined,
    isMultiAgentMode(executionMode) && subAgents.length > 0 && catalogMatchedSubAgents.length === 0
      ? "当前 multi_agent 规划尚未命中明确的 agent catalog 指引，后续可补充 whenToUse/defaultRole。"
      : undefined,
  ]);

  const summary = isMultiAgentMode(executionMode)
    ? `采用 ${executionMode} + ${governanceMode} 规划，建议 ${subAgents.length || 1} 路推进；methods=${methods.length}，skills=${skills.length}，mcp=${mcpServers.length}。`
    : `采用 ${executionMode} + ${governanceMode} 规划，主 Agent 先按现有 methods/skills 推进；methods=${methods.length}，skills=${skills.length}，mcp=${mcpServers.length}。`;

  return {
    runId: input.runId,
    status: "planned",
    executionMode,
    governanceMode,
    commanderAgentId,
    preferredAgents,
    riskLevel: risk.riskLevel,
    objective: compactText([input.nodeTitle, input.nodeDescription]) || input.nodeTitle,
    summary,
    queryHints: uniqueStrings([
      input.nodeTitle,
      input.nodePhase,
      input.goalTitle,
      input.goalObjective,
      ...(input.queryHints ?? []),
    ]).slice(0, 6),
    reasoning,
    methods,
    skills,
    mcpServers,
    subAgents,
    gaps,
    checkpoint,
    actualUsage: {
      methods: [],
      skills: [],
      mcpServers: [],
      toolNames: [],
    },
    orchestration: {
      finalApprovalMode,
      coordinationPlan,
    },
  };
}
