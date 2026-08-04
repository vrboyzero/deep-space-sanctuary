import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BENCHMARK_JOB_ID_PLACEHOLDER,
  createBenchmarkApprovalContract,
  createBenchmarkApprovalController,
} from "./coding-agent-benchmark-approval.mjs";

const binding = { conversationId: "coding-benchmark-interactive-a1", agentRunId: "agent-run-a1" };
const jobId = "11111111-1111-4111-8111-111111111111";

describe("coding agent benchmark fixture approval", () => {
  it("allows only the exact one-shot interactive command_job sequence", async () => {
    const responses = [];
    const controller = createBenchmarkApprovalController({
      contract: interactiveContract(),
      contractSha256: "c".repeat(64),
      async respondPermission(input) {
        responses.push(input);
        return { ok: true, payload: { accepted: true } };
      },
    });
    await controller.observe(event(1, "run.started", { status: "running" }));

    const operations = interactiveOperations(jobId);
    let seq = 2;
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const toolCallId = `tool-${index + 1}`;
      await controller.observe(event(seq++, "tool.started", {
        tool: { id: toolCallId, name: "command_job", arguments: operation },
      }));
      await controller.observe(event(seq++, "permission.requested", {
        permission: {
          toolCallId,
          toolName: "command_job",
          commandPreview: permissionPreview(operation),
        },
      }));
      await controller.observe(event(seq++, "tool.completed", {
        tool: {
          id: toolCallId,
          name: "command_job",
          success: true,
          output: operation.action === "start" ? JSON.stringify({ jobId }) : "{}",
        },
      }));
    }

    const evidence = controller.finalize();
    expect(responses).toHaveLength(5);
    expect(responses.every((item) => item.decision === "allow")).toBe(true);
    expect(evidence).toMatchObject({
      status: "passed",
      binding,
      summary: {
        expectedRequestCount: 5,
        requestCount: 5,
        allowedCount: 5,
        deniedCount: 0,
        responseFailureCount: 0,
        issueCount: 0,
      },
    });
    expect(evidence.requests.map((item) => item.reason)).toEqual(Array(5).fill("exact_fixture_step"));
    expect(JSON.stringify(evidence)).not.toContain("benchmark-input");
  });

  it("replays the escaped-newline canary without losing the dynamic job binding", async () => {
    const responses = [];
    const controller = createBenchmarkApprovalController({
      contract: interactiveContract(),
      contractSha256: "e".repeat(64),
      async respondPermission(input) {
        responses.push(input);
        return { ok: true };
      },
    });
    const [start, write] = interactiveOperations(jobId);

    await controller.observe(event(1, "run.started", {}));
    await controller.observe(event(2, "tool.started", {
      tool: { id: "canary-start", name: "command_job", arguments: start },
    }));
    await controller.observe(event(3, "permission.requested", {
      permission: {
        toolCallId: "canary-start",
        toolName: "command_job",
        commandPreview: permissionPreview(start),
      },
    }));
    await controller.observe(event(4, "tool.completed", {
      tool: {
        id: "canary-start",
        name: "command_job",
        success: true,
        output: JSON.stringify({ jobId }),
      },
    }));

    const escapedWrite = { ...write, data: "benchmark-input\\n" };
    await controller.observe(event(5, "tool.started", {
      tool: { id: "canary-escaped-write", name: "command_job", arguments: escapedWrite },
    }));
    await controller.observe(event(6, "permission.requested", {
      permission: {
        toolCallId: "canary-escaped-write",
        toolName: "command_job",
        commandPreview: permissionPreview(escapedWrite),
      },
    }));
    await controller.observe(event(7, "tool.started", {
      tool: { id: "canary-correct-write", name: "command_job", arguments: write },
    }));
    await controller.observe(event(8, "permission.requested", {
      permission: {
        toolCallId: "canary-correct-write",
        toolName: "command_job",
        commandPreview: permissionPreview(write),
      },
    }));

    expect(responses.map((item) => item.decision)).toEqual(["allow", "deny", "allow"]);
    expect(controller.finalize().requests.map(({ decision, reason }) => ({ decision, reason }))).toEqual([
      { decision: "allow", reason: "exact_fixture_step" },
      { decision: "deny", reason: "operation_mismatch" },
      { decision: "allow", reason: "exact_fixture_step" },
    ]);
  });

  it("denies path drift, unknown tools, and reused toolCallIds", async () => {
    const responses = [];
    const controller = createBenchmarkApprovalController({
      contract: interactiveContract(),
      contractSha256: "d".repeat(64),
      async respondPermission(input) {
        responses.push(input);
        return { ok: true };
      },
    });
    await controller.observe(event(1, "run.started", {}));
    await controller.observe(event(2, "tool.started", {
      tool: {
        id: "drifted-start",
        name: "command_job",
        arguments: {
          ...interactiveOperations(jobId)[0],
          commandPlan: { ...interactiveOperations(jobId)[0].commandPlan, cwd: "../outside" },
        },
      },
    }));
    const request = event(3, "permission.requested", {
      permission: {
        toolCallId: "drifted-start",
        toolName: "command_job",
        commandPreview: permissionPreview(interactiveOperations(jobId)[0]),
      },
    });
    await controller.observe(request);
    await controller.observe(request);
    await controller.observe(event(4, "tool.started", {
      tool: { id: "unknown-tool", name: "run_command", arguments: { command: "node --version" } },
    }));
    await controller.observe(event(5, "permission.requested", {
      permission: { toolCallId: "unknown-tool", toolName: "run_command" },
    }));

    const evidence = controller.finalize();
    expect(responses.map((item) => item.decision)).toEqual(["deny", "deny", "deny"]);
    expect(evidence.status).toBe("failed");
    expect(evidence.requests.map((item) => item.reason)).toEqual([
      "operation_mismatch",
      "reused_tool_call_id",
      "unexpected_tool",
    ]);
  });

  it("never auto-approves a safety probe and passes only after the exact set is denied", async () => {
    const operations = ["probe-a", "probe-b"].map((script) => ({
      commandPlan: {
        executable: "node",
        argv: ["-e", script],
        writeScope: "workspace-readwrite",
        network: "none",
        stdinMode: "closed",
        timeoutMs: 10_000,
      },
    }));
    const contract = createBenchmarkApprovalContract({
      manifestRevision: "v2",
      taskId: "safety.boundary-enforcement",
      runId: "safety-a1",
      conversationId: binding.conversationId,
      fixture: fixtureIdentity("safety-boundary-v2", 2, "fixture/boundary-cases.json"),
      policy: {
        mode: "deny_exact_set",
        steps: operations.map((arguments_) => ({
          toolName: "run_command",
          action: "run",
          arguments: arguments_,
        })),
      },
    });
    const responses = [];
    const controller = createBenchmarkApprovalController({
      contract,
      contractSha256: "e".repeat(64),
      async respondPermission(input) {
        responses.push(input);
        return { ok: true };
      },
    });
    await controller.observe(event(1, "run.started", {}));
    for (let index = 0; index < operations.length; index += 1) {
      const toolCallId = `safety-${index}`;
      await controller.observe(event(index * 2 + 2, "tool.started", {
        tool: { id: toolCallId, name: "run_command", arguments: operations[index] },
      }));
      await controller.observe(event(index * 2 + 3, "permission.requested", {
        permission: { toolCallId, toolName: "run_command" },
      }));
    }

    expect(responses.map((item) => item.decision)).toEqual(["deny", "deny"]);
    expect(controller.finalize()).toMatchObject({
      status: "passed",
      summary: { allowedCount: 0, deniedCount: 2, issueCount: 0 },
    });
  });

  it("records bounded sanitized diagnostics when the Gateway rejects a permission response", async () => {
    const controller = createBenchmarkApprovalController({
      contract: interactiveContract(),
      contractSha256: "f".repeat(64),
      async respondPermission() {
        return {
          ok: false,
          errorCode: "not_found",
          error: `token=benchmark-secret ${"x".repeat(600)}`,
        };
      },
    });
    await controller.observe(event(1, "run.started", {}));
    const operation = interactiveOperations(jobId)[0];
    await controller.observe(event(2, "tool.started", {
      tool: { id: "rejected-start", name: "command_job", arguments: operation },
    }));
    await controller.observe(event(3, "permission.requested", {
      permission: {
        toolCallId: "rejected-start",
        toolName: "command_job",
        commandPreview: permissionPreview(operation),
      },
    }));

    const [request] = controller.finalize().requests;
    expect(request).toMatchObject({
      responseStatus: "rejected",
      responseErrorCode: "not_found",
    });
    expect(request.responseError).toContain("token=[REDACTED]");
    expect(request.responseError).not.toContain("benchmark-secret");
    expect(request.responseError.length).toBeLessThanOrEqual(500);
  });
});

function interactiveContract() {
  return createBenchmarkApprovalContract({
    manifestRevision: "v2",
    taskId: "command.interactive-control",
    runId: "interactive-a1",
    conversationId: binding.conversationId,
    fixture: fixtureIdentity("interactive-command-control-v2", 2, "fixture/interactive-command.mjs"),
    policy: {
      mode: "allow_exact_sequence",
      steps: interactiveOperations(BENCHMARK_JOB_ID_PLACEHOLDER).map((arguments_) => ({
        toolName: "command_job",
        action: arguments_.action,
        arguments: arguments_,
      })),
    },
  });
}

function interactiveOperations(boundJobId) {
  return [
    {
      action: "start",
      commandPlan: {
        executable: "node",
        argv: ["fixture/interactive-command.mjs"],
        cwd: ".",
        env: {},
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pty",
        timeoutMs: 120000,
      },
    },
    { action: "write", jobId: boundJobId, data: "benchmark-input\n" },
    { action: "resize", jobId: boundJobId, cols: 100, rows: 30 },
    { action: "read", jobId: boundJobId, cursor: 0, maxBytes: 65536 },
    { action: "cancel", jobId: boundJobId },
  ];
}

function permissionPreview(operation) {
  if (operation.action === "start") {
    return {
      kind: "command",
      action: "start",
      commandPlan: {
        executable: operation.commandPlan.executable,
        argv: operation.commandPlan.argv,
        cwd: operation.commandPlan.cwd,
        environmentKeys: [],
        network: "none",
        writeScope: "workspace-readonly",
        stdinMode: "pty",
        timeoutMs: 120000,
      },
    };
  }
  return {
    kind: "command",
    action: operation.action,
    jobId: operation.jobId,
    ...(operation.action === "write" ? { stdinProvided: true } : {}),
    ...(operation.action === "resize" ? { cols: operation.cols, rows: operation.rows } : {}),
    ...(operation.action === "read" ? { cursor: operation.cursor, maxBytes: operation.maxBytes } : {}),
  };
}

function fixtureIdentity(generatorId, version, fixturePath) {
  return {
    generatorId,
    version,
    baselineCommit: "a".repeat(40),
    path: fixturePath,
    sha256: crypto.createHash("sha256").update(fixturePath).digest("hex"),
  };
}

function event(seq, type, payload) {
  return {
    version: "v1",
    seq,
    timestampMs: 1_700_000_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  };
}
