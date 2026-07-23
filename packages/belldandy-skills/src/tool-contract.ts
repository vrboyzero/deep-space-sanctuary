import type { Tool, ToolParameterSchema } from "./types.js";

export type ToolContractRiskLevel = "low" | "medium" | "high" | "critical";

export type ToolContractChannel =
  | "cli"
  | "web"
  | "browser-extension"
  | "gateway";

export type ToolContractSafeScope =
  | "local-safe"
  | "web-safe"
  | "bridge-safe"
  | "remote-safe"
  | "privileged";

export type ToolOutputPersistencePolicy =
  | "none"
  | "conversation"
  | "artifact"
  | "external-state";

/**
 * 仅供已完成独立审计的 Tool 显式接入 Executor admission；未声明时保持既有执行语义。
 * `utf8-text-policy` 只适用于文本结果，避免截断 JSON 等结构化输出。
 */
export type ToolExecutionAdmission = {
  deadline?: "policy";
  output?: "utf8-text-policy";
};

export type ToolContractFamily =
  | "network-read"
  | "workspace-read"
  | "workspace-write"
  | "patch"
  | "command-exec"
  | "process-control"
  | "session-orchestration"
  | "memory"
  | "browser"
  | "service-admin"
  | "goal-governance"
  | "other";

export interface ToolResultSchema {
  kind: "text" | "json";
  description: string;
  jsonShape?: ToolParameterSchema;
}

export interface ToolContract {
  name: string;
  family: ToolContractFamily;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  needsPermission: boolean;
  riskLevel: ToolContractRiskLevel;
  channels: readonly ToolContractChannel[];
  safeScopes: readonly ToolContractSafeScope[];
  activityDescription: string;
  resultSchema: ToolResultSchema;
  outputPersistencePolicy: ToolOutputPersistencePolicy;
  executionAdmission?: ToolExecutionAdmission;
}

export type ToolWithContract<T extends Tool = Tool> = T & {
  contract: ToolContract;
};

export function withToolContract<T extends Tool>(
  tool: T,
  contract: Omit<ToolContract, "name"> & { name?: string },
): ToolWithContract<T> {
  const normalizedContract: ToolContract = {
    ...contract,
    name: contract.name ?? tool.definition.name,
  };

  return Object.assign(tool, { contract: normalizedContract });
}

export function hasToolContract(tool: Tool): tool is ToolWithContract {
  return typeof (tool as ToolWithContract).contract !== "undefined";
}

export function getToolContract(tool: Tool): ToolContract | undefined {
  return hasToolContract(tool) ? tool.contract : undefined;
}

export function listToolContracts(tools: readonly Tool[]): ToolContract[] {
  return tools.flatMap((tool) => {
    const contract = getToolContract(tool);
    return contract ? [contract] : [];
  });
}
