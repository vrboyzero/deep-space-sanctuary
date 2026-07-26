import { describe, expect, it } from "vitest";

import { withToolContract } from "./tool-contract.js";
import { buildToolContractV2Summary, getToolContractV2, listToolContractsV2 } from "./tool-contract-v2.js";
import type { Tool } from "./types.js";

const runCommandTool = withToolContract({
  definition: {
    name: "run_command",
    description: "run command",
    parameters: { type: "object", properties: {} },
  },
  async execute() {
    return {
      id: "run-command",
      name: "run_command",
      success: true,
      output: "ok",
      durationMs: 1,
    };
  },
} satisfies Tool, {
  family: "command-exec",
  isReadOnly: false,
  isConcurrencySafe: false,
  needsPermission: true,
  riskLevel: "high",
  channels: ["gateway"],
  safeScopes: ["local-safe"],
  activityDescription: "Execute host commands",
  resultSchema: {
    kind: "text",
    description: "Command output",
  },
  outputPersistencePolicy: "conversation",
});

const betaTool = withToolContract({
  definition: {
    name: "beta_builtin",
    description: "beta",
    parameters: { type: "object", properties: {} },
  },
  async execute() {
    return {
      id: "beta-builtin",
      name: "beta_builtin",
      success: true,
      output: "ok",
      durationMs: 1,
    };
  },
} satisfies Tool, {
  family: "other",
  isReadOnly: true,
  isConcurrencySafe: true,
  needsPermission: false,
  riskLevel: "low",
  channels: ["gateway"],
  safeScopes: ["local-safe"],
  activityDescription: "Read beta state",
  resultSchema: {
    kind: "text",
    description: "Beta output",
  },
  outputPersistencePolicy: "conversation",
});

describe("tool contract v2", () => {
  it("merges governance contract with behavior contract when available", () => {
    const contracts = listToolContractsV2([runCommandTool, betaTool]);
    const runCommand = contracts.find((contract) => contract.name === "run_command");
    const beta = contracts.find((contract) => contract.name === "beta_builtin");

    expect(runCommand).toMatchObject({
      family: "command-exec",
      riskLevel: "high",
      needsPermission: true,
      hasGovernanceContract: true,
      hasBehaviorContract: true,
    });
    expect(runCommand?.recommendedWhen.length).toBeGreaterThan(0);
    expect(runCommand?.confirmWhen.length).toBeGreaterThan(0);

    expect(beta).toMatchObject({
      family: "other",
      riskLevel: "low",
      hasGovernanceContract: true,
      hasBehaviorContract: false,
    });
  });

  it("builds a summary with missing v2 tools against the registered tool set", () => {
    const contracts = listToolContractsV2([runCommandTool]);
    const summary = buildToolContractV2Summary(contracts, {
      registeredToolNames: ["run_command", "beta_builtin"],
    });

    expect(summary).toMatchObject({
      totalCount: 1,
      missingV2Count: 1,
      highRiskCount: 1,
      confirmRequiredCount: 1,
      governedTools: ["run_command"],
      missingV2Tools: ["beta_builtin"],
    });
  });

  it("provides detailed defaults for high-value tool profiles without runtime governance input", () => {
    const runCommand = getToolContractV2("run_command");
    const commandJob = getToolContractV2("command_job");
    const applyPatch = getToolContractV2("apply_patch");
    const fileWrite = getToolContractV2("file_write");
    const fileDelete = getToolContractV2("file_delete");
    const delegateTask = getToolContractV2("delegate_task");
    const delegateParallel = getToolContractV2("delegate_parallel");
    const fileRead = getToolContractV2("file_read");
    const listFiles = getToolContractV2("list_files");
    const webFetch = getToolContractV2("web_fetch");
    const memorySearch = getToolContractV2("memory_search");
    const memoryRead = getToolContractV2("memory_read");
    const memoryGet = getToolContractV2("memory_get");
    const planCurrentGet = getToolContractV2("plan_current_get");
    const planCurrentUpdate = getToolContractV2("plan_current_update");
    const browserOpen = getToolContractV2("browser_open");
    const browserGetContent = getToolContractV2("browser_get_content");
    const browserSnapshot = getToolContractV2("browser_snapshot");

    expect(runCommand).toMatchObject({
      family: "command-exec",
      riskLevel: "critical",
      needsPermission: true,
      hasGovernanceContract: false,
      hasBehaviorContract: true,
    });
    expect(runCommand?.confirmWhen.join("\n")).toContain("executable, argv");
    expect(runCommand?.preflightChecks.join("\n")).toContain("stdout/stderr");
    expect(runCommand?.fallbackStrategy.join("\n")).toContain("head/tail");

    expect(commandJob).toMatchObject({
      family: "command-exec",
      riskLevel: "critical",
      needsPermission: true,
      hasGovernanceContract: false,
      hasBehaviorContract: false,
    });
    expect(commandJob?.preflightChecks.join("\n")).toContain("shell-free commandPlan");
    expect(commandJob?.preflightChecks.join("\n")).toContain("stdin as sensitive");
    expect(commandJob?.expectedOutput.join("\n")).toContain("stable job ID");

    expect(applyPatch?.preflightChecks.join("\n")).toContain("3000 lines");
    expect(applyPatch?.expectedOutput.join("\n")).toContain("added, modified, and deleted");

    expect(fileWrite?.expectedOutput.join("\n")).toContain("bytesWritten");
    expect(fileWrite?.preflightChecks.join("\n")).toContain("webchat");

    expect(fileDelete?.sideEffectSummary.join("\n")).toContain("least reversible");
    expect(fileDelete?.confirmWhen.join("\n")).toContain("clear recovery path");

    expect(delegateTask?.expectedOutput.join("\n")).toContain("task ID");
    expect(delegateTask?.sideEffectSummary.join("\n")).toContain("coordination cost");

    expect(delegateParallel?.expectedOutput.join("\n")).toContain("Aggregated status text");
    expect(delegateParallel?.confirmWhen.join("\n")).toContain("same files");

    expect(fileRead).toMatchObject({
      family: "workspace-read",
      riskLevel: "low",
      needsPermission: false,
    });
    expect(fileRead?.expectedOutput.join("\n")).toContain("bytesRead");

    expect(listFiles?.preflightChecks.join("\n")).toContain("narrowest possible path");
    expect(listFiles?.sideEffectSummary.join("\n")).toContain("context");

    expect(webFetch).toMatchObject({
      family: "network-read",
      riskLevel: "medium",
      needsPermission: false,
    });
    expect(webFetch?.confirmWhen.join("\n")).toContain("POST");

    expect(memorySearch).toMatchObject({
      family: "memory",
      riskLevel: "low",
      needsPermission: false,
    });
    expect(memorySearch?.preflightChecks.join("\n")).toContain("detail_level");

    expect(memoryRead?.expectedOutput.join("\n")).toContain("total line count");
    expect(memoryRead?.sideEffectSummary.join("\n")).toContain("mark the source memory as used");

    expect(memoryGet?.avoidWhen.join("\n")).toContain("memory_read");
    expect(memoryGet?.expectedOutput.join("\n")).toContain("Deprecated guidance text");

    expect(planCurrentGet).toMatchObject({
      family: "other",
      riskLevel: "low",
      needsPermission: false,
      isReadOnly: true,
    });
    expect(planCurrentGet?.avoidWhen.join("\n")).toContain("ordinary chat");
    expect(planCurrentGet?.preflightChecks.join("\n")).toContain("hasPlan=false");

    expect(planCurrentUpdate).toMatchObject({
      family: "other",
      riskLevel: "low",
      needsPermission: false,
      isReadOnly: false,
    });
    expect(planCurrentUpdate?.avoidWhen.join("\n")).toContain("tiny single-step fix");
    expect(planCurrentUpdate?.confirmWhen.join("\n")).toContain("replacing an existing current plan");
    expect(planCurrentUpdate?.preflightChecks.join("\n")).toContain("read-only bridge");

    expect(browserOpen).toMatchObject({
      family: "browser",
      riskLevel: "medium",
      needsPermission: true,
      isReadOnly: false,
    });
    expect(browserOpen?.sideEffectSummary.join("\n")).toContain("new live browser tab");

    expect(browserGetContent).toMatchObject({
      family: "browser",
      riskLevel: "low",
      needsPermission: true,
      isReadOnly: true,
    });
    expect(browserGetContent?.fallbackStrategy.join("\n")).toContain("browser_snapshot");

    expect(browserSnapshot?.expectedOutput.join("\n")).toContain("numeric IDs");
    expect(browserSnapshot?.userVisibleRiskNote).toContain("旧快照");
  });
});
