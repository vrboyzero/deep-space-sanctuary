import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeGatewayMethodMock = vi.hoisted(() => vi.fn());

vi.mock("../../shared/gateway-rpc.js", () => ({
  invokeGatewayMethod: invokeGatewayMethodMock,
}));

import { CODING_RUN_EXIT_CODES } from "../../../coding-run/contracts.js";
import { parseTaskProjectionCollectionPage } from "../../../coding-run/task-projection-consumer.js";
import { listAgentTaskProjectionsCommand } from "./task-projections.js";

const taskProjectionConformanceFixture = JSON.parse(fs.readFileSync(path.resolve(
  "benchmarks/task-projection/v1/consumer-conformance.json",
), "utf8")) as {
  sequence: Array<{
    page: Record<string, unknown>;
    expected: {
      status: string;
      reasonCategory: string;
      reasonCode: string;
      allowedActions: string[];
    };
  }>;
  contentBearingPage: Record<string, unknown>;
};

function projection() {
  const capabilities = Object.fromEntries([
    "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal",
    "trace", "verifier", "mcp", "plugin", "skill",
  ].map((name) => [name, { required: false, state: "available" }]));
  return {
    schemaVersion: "task-projection/v1",
    taskId: "task-1",
    status: "blocked",
    owner: { source: "conversation", binding: { conversationId: "conversation-1", agentRunId: "run-1" } },
    evidence: { observedAtMs: 1, reasonCategory: "owner_blocked", reasonCode: "owner_reported_blocked" },
    allowedActions: ["observe"],
    capabilityClosure: {
      schemaVersion: "task-capability-closure/v1",
      evaluatedAtMs: 1,
      status: "satisfied",
      capabilities,
    },
    supportingEvidence: {
      worktree: { status: "missing", lifecycle: "discarded", observedAtMs: 2 },
    },
  };
}

describe("bdd agent task-projections", () => {
  beforeEach(() => invokeGatewayMethodMock.mockReset());

  it("prints the validated page as JSON and forwards only bounded read params", async () => {
    invokeGatewayMethodMock.mockResolvedValue({
      ok: true,
      payload: {
        epoch: "gateway-1",
        revision: 2,
        totalCount: 1,
        items: [projection()],
      },
      paired: true,
      wsUrl: "ws://127.0.0.1:28889",
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(listAgentTaskProjectionsCommand({
      stateDir: "E:\\state",
      limit: "10",
      cursor: JSON.stringify({ epoch: "gateway-1", revision: 2, offset: 0 }),
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    })).resolves.toBe(CODING_RUN_EXIT_CODES.success);

    expect(JSON.parse(stdout.join(""))).toMatchObject({
      epoch: "gateway-1",
      revision: 2,
      items: [{
        taskId: "task-1",
        status: "blocked",
        supportingEvidence: { worktree: { status: "missing", lifecycle: "discarded", observedAtMs: 2 } },
      }],
    });
    expect(stderr).toEqual([]);
    expect(invokeGatewayMethodMock).toHaveBeenCalledWith(expect.objectContaining({
      method: "task.projection.list",
      params: { limit: 10, cursor: { epoch: "gateway-1", revision: 2, offset: 0 } },
    }));
    const invocation = invokeGatewayMethodMock.mock.calls[0]?.[0] as {
      parsePayload: (payload: Record<string, unknown>) => unknown;
    };
    expect(() => invocation.parsePayload({ epoch: "gateway-1", revision: 1, totalCount: 1, items: [{ prompt: "secret" }] }))
      .toThrow(/invalid TaskProjection collection page/i);
  });

  it("rejects invalid limits and cursors before opening a Gateway request", async () => {
    const stderr: string[] = [];
    await expect(listAgentTaskProjectionsCommand({
      stateDir: "E:\\state",
      limit: "101",
      writeStderr: (text) => stderr.push(text),
    })).resolves.toBe(CODING_RUN_EXIT_CODES.invalidInput);
    await expect(listAgentTaskProjectionsCommand({
      stateDir: "E:\\state",
      cursor: "{not-json}",
      writeStderr: (text) => stderr.push(text),
    })).resolves.toBe(CODING_RUN_EXIT_CODES.invalidInput);
    expect(invokeGatewayMethodMock).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(/limit|cursor/);
  });

  it("preserves the fixed TaskProjection event sequence and rejects content in the Headless consumer", async () => {
    for (const step of taskProjectionConformanceFixture.sequence) {
      invokeGatewayMethodMock.mockResolvedValueOnce({
        ok: true,
        payload: parseTaskProjectionCollectionPage(step.page),
        paired: true,
        wsUrl: "ws://127.0.0.1:28889",
      });
      const stdout: string[] = [];
      await expect(listAgentTaskProjectionsCommand({
        stateDir: "E:\\state",
        writeStdout: (text) => stdout.push(text),
      })).resolves.toBe(CODING_RUN_EXIT_CODES.success);
      const item = JSON.parse(stdout.join("")).items[0];
      expect({
        status: item.status,
        reasonCategory: item.evidence.reasonCategory,
        reasonCode: item.evidence.reasonCode,
        allowedActions: item.allowedActions,
      }).toEqual(step.expected);
    }

    expect(() => parseTaskProjectionCollectionPage(taskProjectionConformanceFixture.contentBearingPage))
      .toThrow(/invalid TaskProjection collection page/i);
  });
});
