import { describe, expect, it, vi } from "vitest";

import { createConversationTaskCapabilityClosureBinding } from "./task-capability-closure.js";
import { createProductionTaskCapabilityClosureOwner } from "./production-task-capability-owner.js";

const binding = createConversationTaskCapabilityClosureBinding({
  conversationId: "conversation-1",
  agentRunId: "run-1",
});

function evaluationInput(requirements: {
  capabilities?: Array<"tools" | "languageToolchain" | "sandbox" | "approvalChannel" | "worktree" | "journal" | "trace" | "verifier" | "mcp" | "plugin" | "skill">;
  tools?: string[];
  mcpServers?: string[];
  plugins?: string[];
  skills?: string[];
}) {
  return {
    binding,
    requirements: { schemaVersion: 1 as const, ...requirements },
    context: {
      conversationId: "conversation-1",
      agentId: "default",
      permissionMode: "confirm" as const,
    },
  };
}

describe("production task capability closure owner", () => {
  it("satisfies an exact required tool without probing an unrelated command sandbox", async () => {
    const probeCommandSandbox = vi.fn(async () => ({ available: false, reasonCode: "not_configured" }));
    const owner = createProductionTaskCapabilityClosureOwner({
      now: () => 100,
      readTool: ({ name }) => name === "file_read"
        ? { available: true, reasonCode: "available", family: "workspace-read", needsPermission: false }
        : undefined,
      probeCommandSandbox,
    });

    const closure = await owner.evaluateForStart!(evaluationInput({ tools: ["file_read"] }));

    expect(closure).toMatchObject({
      evaluatedAtMs: 100,
      status: "satisfied",
      capabilities: {
        tools: { required: true, state: "available" },
        sandbox: { required: false, state: "degraded", reasonCode: "not_requested" },
        verifier: { required: false, state: "degraded", reasonCode: "not_requested" },
      },
    });
    expect(probeCommandSandbox).not.toHaveBeenCalled();
  });

  it("blocks unavailable tools and command tools whose sandbox control plane is unavailable", async () => {
    const missingToolOwner = createProductionTaskCapabilityClosureOwner({ readTool: () => undefined });
    await expect(missingToolOwner.evaluateForStart!(evaluationInput({ tools: ["missing"] }))).resolves.toMatchObject({
      status: "blocked",
      capabilities: { tools: { required: true, state: "unavailable", reasonCode: "tool_not_found" } },
    });

    const commandOwner = createProductionTaskCapabilityClosureOwner({
      readTool: () => ({
        available: true,
        reasonCode: "available",
        family: "command-exec",
        needsPermission: true,
      }),
      probeCommandSandbox: async () => ({ available: false, reasonCode: "runtime_unavailable" }),
      hasApprovalChannel: () => true,
    });
    await expect(commandOwner.evaluateForStart!(evaluationInput({ tools: ["run_command"] }))).resolves.toMatchObject({
      status: "blocked",
      capabilities: {
        tools: { required: true, state: "available" },
        sandbox: { required: true, state: "unavailable", reasonCode: "runtime_unavailable" },
        approvalChannel: { required: true, state: "available" },
      },
    });
  });

  it("requires exact connected MCP, loaded plugin, and eligible skill ids", async () => {
    const owner = createProductionTaskCapabilityClosureOwner({
      readMcpDiagnostics: () => ({
        initialized: true,
        servers: [
          { id: "repo-index", name: "Repository Index", status: "connected" },
          { id: "offline", name: "Offline", status: "disconnected" },
        ],
      }),
      listPluginIds: () => ["review-plugin"],
      readSkill: (name) => name === "review" ? { exists: true, eligible: true } : { exists: false },
    });

    await expect(owner.evaluateForStart!(evaluationInput({
      mcpServers: ["repo-index"],
      plugins: ["review-plugin"],
      skills: ["review"],
    }))).resolves.toMatchObject({
      status: "satisfied",
      capabilities: {
        mcp: { required: true, state: "available" },
        plugin: { required: true, state: "available" },
        skill: { required: true, state: "available" },
      },
    });

    await expect(owner.evaluateForStart!(evaluationInput({
      mcpServers: ["Repository Index", "offline"],
      plugins: ["missing-plugin"],
      skills: ["missing-skill"],
    }))).resolves.toMatchObject({
      status: "blocked",
      capabilities: {
        mcp: { required: true, state: "unavailable" },
        plugin: { required: true, state: "unavailable" },
        skill: { required: true, state: "unavailable" },
      },
    });

    await expect(owner.evaluateForStart!(evaluationInput({
      mcpServers: ["Repository Index"],
    }))).resolves.toMatchObject({
      status: "blocked",
      capabilities: {
        mcp: { required: true, state: "unavailable", reasonCode: "mcp_server_unavailable" },
      },
    });
  });

  it("fails closed when a loaded skill has no authoritative eligibility result", async () => {
    const owner = createProductionTaskCapabilityClosureOwner({
      readSkill: () => ({ exists: true }),
    });

    await expect(owner.evaluateForStart!(evaluationInput({
      skills: ["eligibility-pending"],
    }))).resolves.toMatchObject({
      status: "blocked",
      capabilities: {
        skill: { required: true, state: "unavailable", reasonCode: "skill_eligibility_unknown" },
      },
    });
  });

  it("fails closed for unsupported authoritative readers and sanitizes reader exceptions", async () => {
    const owner = createProductionTaskCapabilityClosureOwner({
      readJournal: () => { throw new Error("private journal path"); },
    });
    const closure = await owner.evaluateForStart!(evaluationInput({
      capabilities: ["languageToolchain", "worktree", "journal", "verifier"],
    }));

    expect(closure).toMatchObject({
      status: "blocked",
      capabilities: {
        languageToolchain: { required: true, state: "unavailable", reasonCode: "reader_unavailable" },
        worktree: { required: true, state: "unavailable", reasonCode: "reader_unavailable" },
        journal: { required: true, state: "unknown", reasonCode: "reader_error" },
        verifier: { required: true, state: "unavailable", reasonCode: "reader_unavailable" },
      },
    });
    expect(JSON.stringify(closure)).not.toContain("private journal path");
  });

  it("stores immutable exact-binding snapshots and releases them at run completion", async () => {
    const owner = createProductionTaskCapabilityClosureOwner({
      readTrace: () => ({ available: true, reasonCode: "available" }),
    });
    const evaluated = await owner.evaluateForStart!(evaluationInput({ capabilities: ["trace"] }));
    const first = owner.resolve(binding)!;
    first.capabilities.trace.state = "unavailable";

    expect(owner.resolve(binding)).toMatchObject({
      status: "satisfied",
      capabilities: { trace: { state: "available" } },
    });
    expect(owner.resolve({ ...binding, agentRunId: "run-drift" })).toMatchObject({ status: "unknown" });
    expect(evaluated).not.toBe(first);

    owner.release?.(binding);
    expect(owner.resolve(binding)).toMatchObject({
      status: "unknown",
      capabilities: { tools: { reasonCode: "not_evaluated" } },
    });
  });
});
