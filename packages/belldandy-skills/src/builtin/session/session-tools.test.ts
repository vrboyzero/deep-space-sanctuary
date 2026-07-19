import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";
import { sessionsSpawnTool } from "./spawn.js";
import { delegateTaskTool } from "./delegate.js";
import { delegateParallelTool } from "./delegate-parallel.js";

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: "conv-session",
    workspaceRoot: "/tmp/workspace",
    defaultCwd: "/tmp/workspace/apps/web",
    launchSpec: {
      cwd: "/tmp/workspace/apps/web",
      toolSet: ["file_read", "run_command"],
      permissionMode: "confirm",
      isolationMode: "workspace",
      parentTaskId: "task_parent",
    },
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 30_000,
      maxResponseBytes: 512_000,
    },
    ...overrides,
  };
}

describe("session tools launchSpec wiring", () => {
  it("sessions_spawn should build an explicit launchSpec with inherited runtime defaults", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: "spawned",
      sessionId: "sub_1",
      taskId: "task_1",
    }));
    const context = createContext({
      agentCapabilities: {
        spawnSubAgent,
      },
    });

    const result = await sessionsSpawnTool.execute({
      instruction: "Inspect the current module",
      agent_id: "coder",
      context: { file: "apps/web/public/app.js" },
    }, context);

    expect(result.success).toBe(true);
    expect(spawnSubAgent).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.stringContaining("Inspect the current module"),
      agentId: "coder",
      parentConversationId: "conv-session",
      channel: "subtask",
      cwd: "/tmp/workspace/apps/web",
      toolSet: ["file_read", "run_command"],
      permissionMode: "confirm",
      isolationMode: "workspace",
      parentTaskId: "task_parent",
      context: { file: "apps/web/public/app.js" },
    }));
  });

  it("delegate_task should build an explicit launchSpec before orchestration", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: "done",
      sessionId: "sub_2",
      taskId: "task_2",
    }));
    const context = createContext({
      agentCapabilities: {
        spawnSubAgent,
      },
    });

    const result = await delegateTaskTool.execute({
      instruction: "Write the integration patch",
      agent_id: "coder",
      context: { target: "packages/belldandy-core/src/server.ts" },
    }, context);

    expect(result.success).toBe(true);
    expect(spawnSubAgent).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.stringContaining("Write the integration patch"),
      agentId: "coder",
      parentConversationId: "conv-session",
      channel: "subtask",
      cwd: "/tmp/workspace/apps/web",
      toolSet: ["file_read", "run_command"],
      permissionMode: "confirm",
      isolationMode: "workspace",
      parentTaskId: "task_parent",
      context: { target: "packages/belldandy-core/src/server.ts" },
    }));
  });

  it("delegate_task should pass structured delegation contracts into the sub-agent launch spec", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: [
        "## Findings",
        "",
        "The gateway patch review is complete.",
        "",
        "## Evidence",
        "",
        "Checked the patched files and current tests.",
        "",
        "## Merge recommendation",
        "",
        "Ready after the requested review.",
        "",
        "## Done Definition Check",
        "",
        "Satisfied: the result explicitly states whether the patch is ready to merge.",
      ].join("\n"),
      sessionId: "sub_structured",
      taskId: "task_structured",
    }));
    const context = createContext({
      agentCapabilities: {
        spawnSubAgent,
      },
    });

    const result = await delegateTaskTool.execute({
      instruction: "Review the gateway patch and report remaining risks",
      agent_id: "verifier",
      ownership: {
        scope_summary: "Own only the gateway patch review.",
        out_of_scope: ["Implement fixes", "UI changes"],
      },
      acceptance: {
        done_definition: "Returned result explicitly states whether the patch is ready to merge.",
        verification_hints: ["Check changed files", "Call out missing tests"],
      },
      deliverable_contract: {
        format: "verification_report",
        required_sections: ["Findings", "Evidence", "Merge recommendation"],
      },
    }, context);

    expect(result.success).toBe(true);
    expect(spawnSubAgent).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.stringContaining("Review the gateway patch and report remaining risks"),
      delegationProtocol: expect.objectContaining({
        ownership: {
          scopeSummary: "Own only the gateway patch review.",
          outOfScope: ["Implement fixes", "UI changes"],
        },
        acceptance: {
          doneDefinition: "Returned result explicitly states whether the patch is ready to merge.",
          verificationHints: ["Check changed files", "Call out missing tests"],
        },
        deliverableContract: expect.objectContaining({
          format: "verification_report",
          requiredSections: ["Findings", "Evidence", "Merge recommendation"],
        }),
      }),
    }));
  });

  it("delegate_parallel should build explicit launchSpec entries for every task", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map((_task: unknown, index: number) => ({
      success: true,
      output: `done-${index + 1}`,
      sessionId: `sub_${index + 1}`,
      taskId: `task_${index + 1}`,
    })));
    const context = createContext({
      agentCapabilities: {
        spawnParallel,
      },
    });

    const result = await delegateParallelTool.execute({
      tasks: [
        { instruction: "Review A", agent_id: "researcher", context: { file: "a.ts" } },
        { instruction: "Review B", context: { file: "b.ts" } },
      ],
    }, context);

    expect(result.success).toBe(true);
    expect(spawnParallel).toHaveBeenCalledWith([
      expect.objectContaining({
        instruction: expect.stringContaining("Review A"),
        agentId: "researcher",
        parentConversationId: "conv-session",
        channel: "subtask",
        cwd: "/tmp/workspace/apps/web",
        parentTaskId: "task_parent",
      }),
      expect.objectContaining({
        instruction: expect.stringContaining("Review B"),
        agentId: undefined,
        parentConversationId: "conv-session",
        channel: "subtask",
        cwd: "/tmp/workspace/apps/web",
        parentTaskId: "task_parent",
      }),
    ]);
  });

  it("delegate_parallel should reject oversized batches before spawning any sub-agent", async () => {
    const spawnParallel = vi.fn(async () => []);
    const context = createContext({
      agentCapabilities: { spawnParallel },
    });

    const result = await delegateParallelTool.execute({
      tasks: Array.from({ length: 9 }, (_, index) => ({ instruction: `Task ${index + 1}` })),
    }, context);

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("permission_or_policy");
    expect(result.error).toContain("at most 8 tasks");
    expect(spawnParallel).not.toHaveBeenCalled();
  });

  it("delegate_parallel should launch at most four tasks per ordered batch", async () => {
    const controller = new AbortController();
    let resultIndex = 0;
    const spawnParallel = vi.fn(async (tasks) => tasks.map(() => {
      resultIndex += 1;
      return {
        success: true,
        output: `done-${resultIndex}`,
        sessionId: `sub_${resultIndex}`,
        taskId: `task_${resultIndex}`,
      };
    }));
    const context = createContext({
      abortSignal: controller.signal,
      agentCapabilities: { spawnParallel },
    });

    const result = await delegateParallelTool.execute({
      tasks: Array.from({ length: 6 }, (_, index) => ({ instruction: `Task ${index + 1}` })),
    }, context);

    expect(result.success).toBe(true);
    expect(spawnParallel).toHaveBeenCalledTimes(2);
    expect(spawnParallel.mock.calls[0][0]).toHaveLength(4);
    expect(spawnParallel.mock.calls[1][0]).toHaveLength(2);
    expect(spawnParallel.mock.calls[0][0][0]).toMatchObject({ abortSignal: controller.signal });
    expect(result.output.indexOf("done-1")).toBeLessThan(result.output.indexOf("done-6"));
  });

  it("delegate_parallel should bound aggregate output and retain result references in metadata", async () => {
    const spawnParallel = vi.fn(async () => ([
      {
        success: true,
        output: "a".repeat(1_000),
        sessionId: "sub_large_1",
        taskId: "task_large_1",
        outputPath: "/tmp/task_large_1/result.md",
      },
      {
        success: true,
        output: "b".repeat(1_000),
        sessionId: "sub_large_2",
        taskId: "task_large_2",
        outputPath: "/tmp/task_large_2/result.md",
      },
    ]));
    const context = createContext({
      policy: {
        ...createContext().policy,
        maxResponseBytes: 512,
      },
      agentCapabilities: { spawnParallel },
    });

    const result = await delegateParallelTool.execute({
      tasks: [
        { instruction: "Large task A" },
        { instruction: "Large task B" },
      ],
    }, context);

    expect(result.success).toBe(true);
    expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(512);
    expect(result.output).toContain("delegate_parallel output truncated");
    expect(result.metadata).toMatchObject({
      delegationBudget: {
        maxTasks: 8,
        maxConcurrent: 4,
        maxAggregateBytes: 512,
        taskCount: 2,
        truncated: true,
      },
      delegationResults: [
        expect.objectContaining({
          taskId: "task_large_1",
          sessionId: "sub_large_1",
          outputPath: "/tmp/task_large_1/result.md",
        }),
        expect.objectContaining({
          taskId: "task_large_2",
          sessionId: "sub_large_2",
          outputPath: "/tmp/task_large_2/result.md",
        }),
      ],
    });
  });

  it("delegate_parallel should reject an already aborted call without spawning", async () => {
    const controller = new AbortController();
    controller.abort("Stopped delegation.");
    const spawnParallel = vi.fn(async () => []);
    const context = createContext({
      abortSignal: controller.signal,
      agentCapabilities: { spawnParallel },
    });

    const result = await delegateParallelTool.execute({
      tasks: [{ instruction: "Should not start" }],
    }, context);

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("environment_error");
    expect(result.error).toBe("Stopped delegation.");
    expect(spawnParallel).not.toHaveBeenCalled();
  });

  it("delegate_parallel should preserve per-task structured delegation contracts", async () => {
    const spawnParallel = vi.fn(async () => ([
      {
        success: true,
        output: [
          "## Findings",
          "",
          "The delta behavior looks acceptable.",
          "",
          "## Recommendation",
          "",
          "Accept the current behavior.",
          "",
          "## Done Definition Check",
          "",
          "Satisfied: the delta behavior is acceptable.",
        ].join("\n"),
        sessionId: "sub_1",
        taskId: "task_1",
      },
    ]));
    const context = createContext({
      agentCapabilities: {
        spawnParallel,
      },
    });

    const result = await delegateParallelTool.execute({
      tasks: [
        {
          instruction: "Review runtime prompt deltas",
          agent_id: "verifier",
          ownership: {
            scope_summary: "Review prompt delta behavior only.",
          },
          acceptance: {
            done_definition: "State whether the delta behavior is acceptable.",
          },
          deliverable_contract: {
            format: "verification_report",
            required_sections: ["Findings", "Recommendation"],
          },
        },
      ],
    }, context);

    expect(result.success).toBe(true);
    expect(spawnParallel).toHaveBeenCalledWith([
      expect.objectContaining({
        instruction: expect.stringContaining("Review runtime prompt deltas"),
        delegationProtocol: expect.objectContaining({
          team: expect.objectContaining({
            mode: "verify_swarm",
            currentLaneId: "lane_1",
            memberRoster: [
              expect.objectContaining({
                laneId: "lane_1",
                agentId: "verifier",
                scopeSummary: "Review prompt delta behavior only.",
              }),
            ],
          }),
          ownership: {
            scopeSummary: "Review prompt delta behavior only.",
          },
          acceptance: {
            doneDefinition: "State whether the delta behavior is acceptable.",
          },
          deliverableContract: expect.objectContaining({
            format: "verification_report",
            requiredSections: ["Findings", "Recommendation"],
          }),
        }),
      }),
    ]);
  });

  it("delegate_parallel should auto-generate team metadata for parallel lanes", async () => {
    const spawnParallel = vi.fn(async (tasks) => tasks.map((_task: unknown, index: number) => ({
      success: true,
      output: `done-${index + 1}`,
      sessionId: `sub_${index + 1}`,
      taskId: `task_${index + 1}`,
    })));
    const context = createContext({
      agentId: "default",
      agentCapabilities: {
        spawnParallel,
      },
    });

    const result = await delegateParallelTool.execute({
      tasks: [
        {
          instruction: "Patch lane A",
          agent_id: "coder",
          ownership: {
            scope_summary: "Own lane A only.",
          },
        },
        {
          instruction: "Patch lane B",
          agent_id: "coder",
          ownership: {
            scope_summary: "Own lane B only.",
          },
        },
      ],
    }, context);

    expect(result.success).toBe(true);
    expect(spawnParallel).toHaveBeenCalledWith([
      expect.objectContaining({
        delegationProtocol: expect.objectContaining({
          team: expect.objectContaining({
            mode: "parallel_patch",
            managerAgentId: "default",
            currentLaneId: "lane_1",
            memberRoster: [
              expect.objectContaining({
                laneId: "lane_1",
                agentId: "coder",
                scopeSummary: "Own lane A only.",
              }),
              expect.objectContaining({
                laneId: "lane_2",
                agentId: "coder",
                scopeSummary: "Own lane B only.",
              }),
            ],
          }),
        }),
      }),
      expect.objectContaining({
        delegationProtocol: expect.objectContaining({
          team: expect.objectContaining({
            mode: "parallel_patch",
            managerAgentId: "default",
            currentLaneId: "lane_2",
          }),
        }),
      }),
    ]);
  });

  it("delegate_parallel should return lane-aware team metadata for manager fan-in", async () => {
    const spawnParallel = vi.fn(async () => ([
      {
        success: true,
        output: "patched lane",
        sessionId: "sub_impl",
        taskId: "task_impl",
      },
      {
        success: true,
        output: [
          "## Findings",
          "",
          "Verifier lane reviewed the patch lane.",
          "",
          "## Recommendation",
          "",
          "Accept after manager fan-in.",
        ].join("\n"),
        sessionId: "sub_verify",
        taskId: "task_verify",
      },
    ]));
    const context = createContext({
      agentId: "default",
      agentCapabilities: {
        spawnParallel,
      },
    });

    const result = await delegateParallelTool.execute({
      tasks: [
        {
          instruction: "Implement lane A",
          agent_id: "coder",
          ownership: {
            scope_summary: "Own lane A implementation only.",
          },
        },
        {
          instruction: "Verify lane A",
          agent_id: "verifier",
          acceptance: {
            done_definition: "State whether lane A is ready for manager fan-in.",
          },
          deliverable_contract: {
            format: "verification_report",
            required_sections: ["Findings", "Recommendation"],
          },
        },
      ],
    }, context);

    expect(result.metadata).toMatchObject({
      team: {
        managerAgentId: "default",
        memberRoster: [
          {
            laneId: "lane_1",
            agentId: "coder",
            role: "coder",
            scopeSummary: "Own lane A implementation only.",
            handoffTo: ["lane_2"],
          },
          {
            laneId: "lane_2",
            agentId: "verifier",
            role: "verifier",
            dependsOn: ["lane_1"],
          },
        ],
      },
      delegationResults: [
        {
          laneId: "lane_1",
          scopeSummary: "Own lane A implementation only.",
          handoffTo: ["lane_2"],
        },
        {
          laneId: "lane_2",
          dependsOn: ["lane_1"],
        },
      ],
    });
  });

  it("sessions_spawn should reject delegated results that miss the acceptance gate", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: [
        "## Findings",
        "",
        "Prompt delta behavior looks mostly correct.",
      ].join("\n"),
      sessionId: "sub_gate_fail",
      taskId: "task_gate_fail",
    }));
    const context = createContext({
      agentCapabilities: {
        spawnSubAgent,
      },
    });

    const result = await sessionsSpawnTool.execute({
      instruction: "Review the runtime prompt changes",
      acceptance: {
        done_definition: "State whether the runtime prompt changes are ready to ship.",
      },
      deliverable_contract: {
        format: "verification_report",
        required_sections: ["Findings", "Recommendation"],
      },
    }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Delegation acceptance gate rejected the sub-agent result.");
    expect(result.failureKind).toBe("business_logic_error");
    expect(result.output).toContain("## Delegation Acceptance Gate");
    expect(result.output).toContain("Status: REJECTED");
    expect(result.output).toContain("Missing required sections: Recommendation");
    expect(result.output).toContain("Done definition check: MISSING");
    expect(result.metadata).toMatchObject({
      delegationResults: [
        {
          workerSuccess: true,
          accepted: false,
          acceptanceGate: {
            accepted: false,
            rejectionConfidence: "high",
            missingRequiredSections: ["Recommendation"],
          },
        },
      ],
      acceptedCount: 0,
      gateRejectedCount: 1,
      workerSuccessCount: 1,
      followUpStrategy: {
        mode: "single",
        recommendedRuntimeAction: "retry_delegation",
        retryLabels: ["Spawned task / default"],
        highPriorityLabels: ["Spawned task / default"],
        items: [
          {
            action: "retry",
            recommendedRuntimeAction: "retry_delegation",
            priority: "high",
          },
        ],
      },
    });
  });

  it("delegate_task should accept delegated results that satisfy required sections and done-definition verdict", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: [
        "## Findings",
        "",
        "The runtime prompt changes are coherent.",
        "",
        "## Recommendation",
        "",
        "Ship with targeted regression coverage.",
        "",
        "## Done Definition Check",
        "",
        "Satisfied: the delegated review includes a clear readiness recommendation.",
      ].join("\n"),
      sessionId: "sub_gate_ok",
      taskId: "task_gate_ok",
    }));
    const context = createContext({
      agentCapabilities: {
        spawnSubAgent,
      },
    });

    const result = await delegateTaskTool.execute({
      instruction: "Review the runtime prompt changes",
      agent_id: "verifier",
      acceptance: {
        done_definition: "State whether the runtime prompt changes are ready to ship.",
      },
      deliverable_contract: {
        format: "verification_report",
        required_sections: ["Findings", "Recommendation"],
      },
    }, context);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("## Delegation Acceptance Gate");
    expect(result.output).toContain("Status: ACCEPTED");
    expect(result.output).toContain("Done definition check: PASSED");
    expect(result.metadata).toMatchObject({
      delegationResults: [
        {
          workerSuccess: true,
          accepted: true,
          acceptanceGate: {
            accepted: true,
            deliverableFormat: "verification_report",
            contractSpecificChecks: [
              { id: "verification_report_findings", status: "passed" },
              { id: "verification_report_recommendation", status: "passed" },
            ],
          },
        },
      ],
    });
  });

  it("delegate_task should reject under the verification-report contract-specific gate even without explicit required sections", async () => {
    const spawnSubAgent = vi.fn(async () => ({
      success: true,
      output: [
        "## Findings",
        "",
        "The runtime prompt changes are coherent, but the worker omitted a merge recommendation.",
      ].join("\n"),
      sessionId: "sub_gate_contract_specific",
      taskId: "task_gate_contract_specific",
    }));
    const context = createContext({
      agentCapabilities: {
        spawnSubAgent,
      },
    });

    const result = await delegateTaskTool.execute({
      instruction: "Review the runtime prompt changes",
      agent_id: "verifier",
      deliverable_contract: {
        format: "verification_report",
      },
    }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Delegation acceptance gate rejected the sub-agent result.");
    expect(result.output).toContain("Verification report is missing a recommendation or verdict section.");
    expect(result.output).toContain("Deliverable format: verification_report");
    expect(result.output).toContain("Contract checks: verification_report_findings=PASSED | verification_report_recommendation=FAILED");
    expect(result.metadata).toMatchObject({
      delegationResults: [
        {
          workerSuccess: true,
          accepted: false,
          acceptanceGate: {
            accepted: false,
            deliverableFormat: "verification_report",
            rejectionConfidence: "high",
            contractSpecificChecks: [
              { id: "verification_report_findings", status: "passed" },
              { id: "verification_report_recommendation", status: "failed" },
            ],
          },
        },
      ],
      acceptedCount: 0,
      gateRejectedCount: 1,
      workerSuccessCount: 1,
      followUpStrategy: {
        mode: "single",
        recommendedRuntimeAction: "retry_delegation",
        retryLabels: ["Agent verifier"],
        highPriorityLabels: ["Agent verifier"],
        items: [
          {
            action: "retry",
            recommendedRuntimeAction: "retry_delegation",
            priority: "high",
          },
        ],
      },
    });
  });

  it("delegate_parallel should aggregate acceptance-gate rejections across tasks", async () => {
    const spawnParallel = vi.fn(async () => ([
      {
        success: true,
        output: [
          "## Findings",
          "",
          "Worker one reviewed the patch.",
          "",
          "## Recommendation",
          "",
          "Ready for merge.",
          "",
          "## Done Definition Check",
          "",
          "Satisfied: the delegated review includes a readiness verdict.",
        ].join("\n"),
        sessionId: "sub_1",
        taskId: "task_1",
      },
      {
        success: true,
        output: [
          "## Findings",
          "",
          "Worker two reviewed the patch but did not provide the recommendation section.",
        ].join("\n"),
        sessionId: "sub_2",
        taskId: "task_2",
      },
    ]));
    const context = createContext({
      agentCapabilities: {
        spawnParallel,
      },
    });

    const result = await delegateParallelTool.execute({
      tasks: [
        {
          instruction: "Review patch A",
          deliverable_contract: {
            format: "verification_report",
            required_sections: ["Findings", "Recommendation"],
          },
          acceptance: {
            done_definition: "State whether patch A is ready for merge.",
          },
        },
        {
          instruction: "Review patch B",
          deliverable_contract: {
            format: "verification_report",
            required_sections: ["Findings", "Recommendation"],
          },
          acceptance: {
            done_definition: "State whether patch B is ready for merge.",
          },
        },
      ],
    }, context);

    expect(result.success).toBe(false);
    expect(result.failureKind).toBe("business_logic_error");
    expect(result.output).toContain("[delegate_parallel] 2 tasks completed (2 worker succeeded, 1 accepted, 1 rejected by acceptance gate).");
    expect(result.output).toContain("[Task 2 / default] REJECTED");
    expect(result.output).toContain("Status: REJECTED");
    expect(result.metadata).toMatchObject({
      followUpStrategy: {
        mode: "parallel",
        recommendedRuntimeAction: "retry_delegation",
        acceptedLabels: ["Task 1 / default"],
        retryLabels: ["Task 2 / default"],
        highPriorityLabels: ["Task 2 / default"],
        items: [
          {
            label: "Task 1 / default",
            action: "accept",
            recommendedRuntimeAction: "accept_result",
            priority: "normal",
          },
          {
            label: "Task 2 / default",
            action: "retry",
            recommendedRuntimeAction: "retry_delegation",
            priority: "high",
          },
        ],
      },
    });
  });
});
