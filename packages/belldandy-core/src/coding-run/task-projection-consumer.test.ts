import { describe, expect, it } from "vitest";

import { parseTaskProjectionCollectionPage } from "./task-projection-consumer.js";

function projection(status: "uncertain" | "verifying" | "blocked") {
  const capabilities = Object.fromEntries([
    "tools", "languageToolchain", "sandbox", "approvalChannel", "worktree", "journal",
    "trace", "verifier", "mcp", "plugin", "skill",
  ].map((name) => [name, { required: false, state: "available" }]));
  return {
    schemaVersion: "task-projection/v1",
    taskId: `task-${status}`,
    status,
    owner: { source: "conversation", binding: { conversationId: "conversation-1", agentRunId: "run-1" } },
    evidence: {
      observedAtMs: 1,
      reasonCategory: status === "verifying" ? "verification" : status === "blocked" ? "blocked_by_capability" : "evidence_conflict",
      reasonCode: status === "verifying" ? "validation_in_progress" : status === "blocked" ? "required_capability_unavailable" : "owner_binding_drift",
    },
    allowedActions: status === "verifying" ? ["observe", "cancel"] : ["observe"],
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

describe("TaskProjection consumer conformance", () => {
  it("preserves bounded page identity and stable terminal/intermediate states", () => {
    const page = parseTaskProjectionCollectionPage({
      epoch: "gateway-1",
      revision: 7,
      totalCount: 3,
      items: [projection("uncertain"), projection("verifying"), projection("blocked")],
    });
    expect(page).toMatchObject({
      epoch: "gateway-1",
      revision: 7,
      totalCount: 3,
      items: [
        { status: "uncertain", supportingEvidence: { worktree: { lifecycle: "discarded" } } },
        { status: "verifying", supportingEvidence: { worktree: { lifecycle: "discarded" } } },
        { status: "blocked", supportingEvidence: { worktree: { lifecycle: "discarded" } } },
      ],
    });
  });

  it("accepts only an in-revision next cursor and rejects content-bearing or inconsistent pages", () => {
    expect(parseTaskProjectionCollectionPage({
      epoch: "gateway-1",
      revision: 7,
      totalCount: 3,
      items: [projection("uncertain")],
      nextCursor: { epoch: "gateway-1", revision: 7, offset: 1 },
    }).nextCursor).toEqual({ epoch: "gateway-1", revision: 7, offset: 1 });

    expect(() => parseTaskProjectionCollectionPage({
      epoch: "gateway-1",
      revision: 7,
      totalCount: 1,
      items: [{ ...projection("blocked"), prompt: "secret" }],
    })).toThrow(/invalid TaskProjection collection page/i);

    expect(() => parseTaskProjectionCollectionPage({
      epoch: "gateway-1",
      revision: 7,
      totalCount: 0,
      items: [projection("blocked")],
    })).toThrow(/inconsistent TaskProjection collection count/i);
  });
});
