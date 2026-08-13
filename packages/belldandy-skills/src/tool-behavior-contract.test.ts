import { describe, expect, it } from "vitest";

import {
  buildToolBehaviorContractSummary,
  getToolBehaviorContract,
  listToolBehaviorContracts,
} from "./tool-behavior-contract.js";

describe("tool behavior contract registry", () => {
  it("returns known contracts by name", () => {
    expect(getToolBehaviorContract("run_command")).toMatchObject({
      name: "run_command",
    });
    expect(getToolBehaviorContract("unknown_tool")).toBeUndefined();
  });

  it("filters the registry by visible tool names", () => {
    expect(listToolBehaviorContracts([
      "delegate_task",
      "apply_patch",
      "file_write",
      "delegate_parallel",
      "subtask_fan_in",
      "subtask_supervisor",
      "subtask_worktree_dispose",
      "not_registered",
    ]).map((contract) => contract.name)).toEqual([
      "apply_patch",
      "delegate_task",
      "file_write",
      "delegate_parallel",
      "subtask_fan_in",
      "subtask_supervisor",
      "subtask_worktree_dispose",
    ]);
  });

  it("builds a prompt-friendly summary for included contracts", () => {
    const summary = buildToolBehaviorContractSummary(listToolBehaviorContracts([
      "run_command",
      "apply_patch",
      "file_delete",
      "delegate_parallel",
    ]));

    expect(summary).toContain("# Tool Behavior Contracts");
    expect(summary).toContain("## run_command");
    expect(summary).toContain("## apply_patch");
    expect(summary).toContain("## file_delete");
    expect(summary).toContain("## delegate_parallel");
    expect(summary).toContain("Preflight:");
    expect(summary).toContain("Fallback:");
    expect(summary).toContain("stdout/stderr");
    expect(summary).toContain("head/tail");
  });
});
