import type { HookName } from "./hooks.js";

export type HookFailurePolicy = "fail_open" | "fail_closed";

export type HookExecutionMode = "parallel" | "sequential" | "synchronous";

export interface HookFailurePolicyDescriptor {
  hookName: HookName;
  executionMode: HookExecutionMode;
  failurePolicy: HookFailurePolicy;
}

/**
 * Hook 的失败策略必须在单一表中显式列全，避免新增 Hook 静默继承错误的安全行为。
 * 只有工具调用前置 Gate 能在异常时阻止外部副作用，其余通知/修饰 Hook 保持故障隔离。
 */
export const HOOK_FAILURE_POLICIES = Object.freeze({
  before_agent_start: "fail_open",
  agent_end: "fail_open",
  before_compaction: "fail_open",
  after_compaction: "fail_open",
  message_received: "fail_open",
  message_sending: "fail_open",
  message_sent: "fail_open",
  before_tool_call: "fail_closed",
  after_tool_call: "fail_open",
  tool_result_persist: "fail_open",
  session_start: "fail_open",
  session_end: "fail_open",
  gateway_start: "fail_open",
  gateway_stop: "fail_open",
} satisfies Record<HookName, HookFailurePolicy>);

const HOOK_EXECUTION_MODES = Object.freeze({
  before_agent_start: "sequential",
  agent_end: "parallel",
  before_compaction: "parallel",
  after_compaction: "parallel",
  message_received: "parallel",
  message_sending: "sequential",
  message_sent: "parallel",
  before_tool_call: "sequential",
  after_tool_call: "parallel",
  tool_result_persist: "synchronous",
  session_start: "parallel",
  session_end: "parallel",
  gateway_start: "parallel",
  gateway_stop: "parallel",
} satisfies Record<HookName, HookExecutionMode>);

export function listHookFailurePolicies(): HookFailurePolicyDescriptor[] {
  return (Object.keys(HOOK_FAILURE_POLICIES) as HookName[]).map((hookName) => ({
    hookName,
    executionMode: HOOK_EXECUTION_MODES[hookName],
    failurePolicy: HOOK_FAILURE_POLICIES[hookName],
  }));
}
