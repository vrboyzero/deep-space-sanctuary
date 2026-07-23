import { createLinkedAbortController } from "./abort-utils.js";
import { getToolContract } from "./tool-contract.js";
import type { Tool, ToolCallResult, ToolPolicy } from "./types.js";

export type ToolExecutionDeadlineAdmission = {
  abortSignal: AbortSignal;
  deadlineMs: number;
  wasTimedOut(): boolean;
  cleanup(): void;
};

/**
 * 将已审计 Tool 的 deadline 接到现有 policy，未显式 opt-in 的 Tool 保持原有 owner。
 */
export function createToolExecutionDeadlineAdmission(
  tool: Tool,
  policy: ToolPolicy,
  parentAbortSignal?: AbortSignal,
): ToolExecutionDeadlineAdmission | undefined {
  if (getToolContract(tool)?.executionAdmission?.deadline !== "policy") {
    return undefined;
  }

  const linked = createLinkedAbortController({
    signal: parentAbortSignal,
    timeoutMs: policy.maxTimeoutMs,
    timeoutReason: `Tool execution timed out after ${policy.maxTimeoutMs}ms.`,
  });
  return {
    abortSignal: linked.controller.signal,
    deadlineMs: policy.maxTimeoutMs,
    wasTimedOut: linked.wasTimedOut,
    cleanup: linked.cleanup,
  };
}

/**
 * 文本结果在进入 conversation/audit 前按 policy 的 UTF-8 字节预算投影。
 * 结构化结果必须由其自身 owner 维持可解析格式，因此不在这里做通用字符串截断。
 */
export function applyToolResultOutputAdmission(
  tool: Tool,
  result: ToolCallResult,
  policy: ToolPolicy,
): ToolCallResult {
  const contract = getToolContract(tool);
  if (!result.success
    || contract?.executionAdmission?.output !== "utf8-text-policy"
    || contract.resultSchema.kind !== "text") {
    return result;
  }

  const outputOriginalBytes = Buffer.byteLength(result.output, "utf8");
  if (outputOriginalBytes <= policy.maxResponseBytes) {
    return result;
  }

  const output = truncateUtf8(result.output, policy.maxResponseBytes);
  return {
    ...result,
    output,
    metadata: {
      ...(result.metadata ?? {}),
      outputTruncated: true,
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputOriginalBytes,
      outputLimitBytes: policy.maxResponseBytes,
    },
  };
}

function truncateUtf8(value: string, limitBytes: number): string {
  if (limitBytes <= 0) {
    return "";
  }

  let output = "";
  let outputBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (outputBytes + characterBytes > limitBytes) {
      break;
    }
    output += character;
    outputBytes += characterBytes;
  }
  return output;
}
