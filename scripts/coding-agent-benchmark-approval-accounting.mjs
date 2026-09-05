import assert from "node:assert/strict";
import crypto from "node:crypto";

import { BENCHMARK_APPROVAL_ACCOUNTING_VERSION, createBenchmarkApprovalContract,
  createBenchmarkApprovalController } from "./coding-agent-benchmark-approval.mjs";

export async function verifyBenchmarkApprovalAccounting({ contractText, evidence, events, expected }) {
  const permissionRequestCount = events.filter((event) => event?.type === "permission.requested").length;
  const result = (status, verifiedAutomaticResponseCount = 0) => ({ status,
    permissionRequestCount, verifiedAutomaticResponseCount,
    manualInterventionCount: permissionRequestCount - verifiedAutomaticResponseCount });
  try {
    const parsed = JSON.parse(contractText);
    const contract = createBenchmarkApprovalContract(parsed);
    assert.deepEqual(parsed, contract);
    if (!contract.accountingVersion) {
      assert.equal(evidence?.accounting, undefined);
      return result("legacy");
    }
    assert.equal(contract.accountingVersion, BENCHMARK_APPROVAL_ACCOUNTING_VERSION);
    assert.equal(contract.manifestRevision, expected.manifestRevision);
    assert.equal(contract.taskId, expected.taskId);
    assert.equal(contract.runId, expected.runId);
    assert.ok(expected.binding?.conversationId && expected.binding?.agentRunId);
    assert.equal(contract.conversationId, expected.binding.conversationId);
    assert.deepEqual(contract.fixture, expected.fixture);
    assert.deepEqual(contract.policy, expected.policy);
    assert.equal(evidence?.status, "passed");
    assert.ok(Array.isArray(evidence.requests));
    assert.equal(evidence.requests.length, permissionRequestCount);
    assert.equal(permissionRequestCount, contract.policy.steps.length);
    const contractSha256 = crypto.createHash("sha256").update(contractText).digest("hex");
    let responseIndex = 0;
    let permission;
    const replay = createBenchmarkApprovalController({ contract, contractSha256,
      // 只回放已记录的响应；验真过程没有 Gateway 或权限写入。
      respondPermission: async (request) => {
        const recorded = evidence.requests[responseIndex++];
        assert.equal(recorded?.responder, "benchmark_controller");
        assert.equal(recorded.responseStatus, "accepted");
        assert.equal(recorded.responseFreshlyAccepted, true);
        assert.equal(recorded.responseErrorCode, undefined);
        assert.equal(recorded.responseError, undefined);
        assert.equal(recorded.seq, permission.seq);
        assert.equal(recorded.toolCallId, request.toolCallId);
        assert.equal(recorded.decision, request.decision);
        assert.deepEqual(recorded.binding, expected.binding);
        return { ok: true, payload: { accepted: true, operation: "permission.respond", binding: request.binding } };
      },
    });
    let previousSeq = 0;
    let running = false;
    const lifecycle = [];
    for (const event of events) {
      assert.ok(Number.isSafeInteger(event?.seq) && event.seq > previousSeq);
      previousSeq = event.seq;
      if (["run.started", "tool.started", "tool.completed", "permission.requested", "run.completed"].includes(event.type)) {
        assert.equal(event.binding?.conversationId, expected.binding.conversationId);
        assert.equal(event.binding?.agentRunId, expected.binding.agentRunId);
      }
      if (event.type === "run.started") running = true;
      if (["tool.started", "tool.completed", "permission.requested"].includes(event.type)) assert.equal(running, true);
      if (["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.type)) running = false;
      if (["run.started", "run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.type)) {
        lifecycle.push(event.type);
      }
      if (event.type === "permission.requested") permission = event;
      await replay.observe(event);
    }
    assert.deepEqual(lifecycle, ["run.started", "run.completed"]);
    const rebuilt = replay.finalize();
    assert.equal(rebuilt.status, "passed");
    assert.equal(responseIndex, permissionRequestCount);
    assert.deepEqual(rebuilt, evidence);
    return result("verified", permissionRequestCount);
  } catch {
    return result("failed");
  }
}
