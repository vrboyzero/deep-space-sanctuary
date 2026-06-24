/**
 * WorkflowFingerprint — 稳定指纹计算
 *
 * 每次 ctx.agent() 调用计算一个稳定 fingerprint，用于 WorkflowJournal 缓存命中。
 * 指纹必须使用稳定序列化（递归排序对象 key），禁止依赖对象枚举顺序。
 *
 * fingerprint = sha256(stableCanonicalize({
 *   schemaVersion, workflowName, workflowVersion, scriptHash, callKey,
 *   prompt, model, agentProfileId, systemPromptHash, toolPolicyHash,
 *   role, allowedToolFamilies (sorted), maxToolRiskLevel,
 *   delegationHash, workflowArgs (stable canonicalize)
 * }))
 *
 * 当 scriptHash / workflowVersion / callKey / prompt / model / tool policy / args
 * 任一变化时，fingerprint 必然不同；这是断点续传正确性的基础。
 */

import { createHash } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────

export type WorkflowFingerprintInput = {
  schemaVersion: number;
  workflowName: string;
  workflowVersion?: string;
  scriptHash: string;
  callKey: string;
  prompt: string;
  model?: string;
  agentProfileId?: string;
  systemPromptHash?: string;
  toolPolicyHash?: string;
  role?: string;
  allowedToolFamilies?: string[];
  maxToolRiskLevel?: string;
  delegationHash?: string;
  workflowArgs?: Record<string, unknown>;
};

// ─── 稳定序列化 ──────────────────────────────────────────────────────────

/**
 * 递归排序对象 key，返回稳定 JSON 字符串。
 * - 对象 key 按字典序排序
 * - 数组保持原顺序（数组顺序是语义的一部分）
 * - undefined 字段被忽略（与 JSON.stringify 一致）
 * - NaN / Infinity / function / symbol 被忽略
 */
export function stableCanonicalize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const result: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      const canon = canonicalize(val);
      if (canon !== undefined) {
        result[key] = canon;
      }
    }
    return result;
  }
  // function / symbol / undefined → 忽略
  return undefined;
}

// ─── 指纹计算 ─────────────────────────────────────────────────────────────

/**
 * 计算工作流节点指纹。
 *
 * allowedToolFamilies 会被排序后再序列化，保证顺序无关。
 * workflowArgs 会被稳定序列化（递归排序 key）。
 */
export function computeWorkflowFingerprint(input: WorkflowFingerprintInput): string {
  const payload = {
    schemaVersion: input.schemaVersion,
    workflowName: input.workflowName,
    workflowVersion: input.workflowVersion ?? "",
    scriptHash: input.scriptHash,
    callKey: input.callKey,
    prompt: input.prompt,
    model: input.model ?? "",
    agentProfileId: input.agentProfileId ?? "",
    systemPromptHash: input.systemPromptHash ?? "",
    toolPolicyHash: input.toolPolicyHash ?? "",
    role: input.role ?? "",
    allowedToolFamilies: [...(input.allowedToolFamilies ?? [])].sort(),
    maxToolRiskLevel: input.maxToolRiskLevel ?? "",
    delegationHash: input.delegationHash ?? "",
    workflowArgs: input.workflowArgs ?? {},
  };
  const canonical = stableCanonicalize(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * 计算任意值的稳定 hash（用于 delegationProtocol 等复杂对象的 hash）。
 * undefined / function / symbol 被视为 null 以保证 hash 可计算。
 */
export function computeStableHash(value: unknown): string {
  const canonical = stableCanonicalize(value);
  return createHash("sha256").update(canonical ?? "null").digest("hex");
}

// ─── 跨版本 migration 指纹 ─────────────────────────────────────────────────
//
// migration 场景下，旧记录的完整 AgentCallOptions 可能无法精确还原，
// 但 callKey + prompt + optsJson 是 journal 中保存的确定性字段。
// 用新 scriptHash + 旧 callKey/prompt/optsJson + 当前 workflowVersion/args
// 重新计算 fingerprint，使预填充的记录能被 agent() 实际执行时的
// computeWorkflowFingerprint 命中。
//
// 关键：参数必须与 createWorkflowContext 中 agent() 计算指纹时完全一致，
// 否则 fingerprint 不匹配，migration 预填充的记录不会被 lookup() 命中。

export function computeMigrationFingerprint(
  scriptHash: string,
  callKey: string,
  prompt: string,
  optsJson: string,
  workflowName: string,
  workflowVersion: string,
  workflowArgs: Record<string, unknown>,
): string {
  // 从 optsJson 解析回 opts 对象（可能失败，降级为空对象）
  let opts: Record<string, unknown> = {};
  try {
    opts = JSON.parse(optsJson);
  } catch {
    opts = {};
  }

  return computeWorkflowFingerprint({
    schemaVersion: 1,
    workflowName,
    workflowVersion,
    scriptHash,
    callKey,
    prompt,
    model: typeof opts.model === "string" ? opts.model : undefined,
    role: typeof opts.role === "string" ? opts.role : undefined,
    allowedToolFamilies: Array.isArray(opts.allowedToolFamilies) ? opts.allowedToolFamilies : undefined,
    maxToolRiskLevel: typeof opts.maxToolRiskLevel === "string" ? opts.maxToolRiskLevel : undefined,
    workflowArgs,
  });
}
