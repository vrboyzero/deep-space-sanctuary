/**
 * BUILTIN_WORKFLOWS — 内置工作流注册表
 *
 * P2 先搭好框架，P5 再填充具体 builtin 工作流（code-audit / parallel-research）。
 * 内置工作流是预编译的 JS 函数，不需要 esbuild 编译，直接从注册表查找。
 */

import type { WorkflowContext } from "@belldandy/agent";

// ─── Types ────────────────────────────────────────────────────────────────

export type BuiltinWorkflowEntry = {
  name: string;
  description?: string;
  workflowVersion?: string;
  /** 脚本内容 hash（用于 fingerprint 稳定性） */
  scriptHash: string;
  /** 工作流主函数 */
  default: (ctx: WorkflowContext) => Promise<string>;
};

// ─── Registry ─────────────────────────────────────────────────────────────

const registry = new Map<string, BuiltinWorkflowEntry>();

export function registerBuiltinWorkflow(entry: BuiltinWorkflowEntry): void {
  registry.set(entry.name, entry);
}

export function getBuiltinWorkflow(name: string): BuiltinWorkflowEntry | undefined {
  return registry.get(name);
}

export function listBuiltinWorkflows(): BuiltinWorkflowEntry[] {
  return [...registry.values()];
}

export function clearBuiltinWorkflows(): void {
  registry.clear();
}
