import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { loadCodingAgentBenchmarkManifest, resolveCodingAgentBenchmarkManifestPath } from "./coding-agent-benchmark-contract.mjs";
import { getBenchmarkFixtureApprovalDefinition } from "./coding-agent-benchmark-fixtures.mjs";
import { BENCHMARK_APPROVAL_ACCOUNTING_VERSION, createBenchmarkApprovalContract,
  createBenchmarkApprovalController, serializeBenchmarkApprovalContract } from "./coding-agent-benchmark-approval.mjs";
import { verifyBenchmarkApprovalAccounting } from "./coding-agent-benchmark-approval-accounting.mjs";
import { resolveCodingAgentBenchmarkV3FixtureProvider } from "./coding-agent-benchmark-v3-fixtures.mjs";

let manifest;
const validators = {};
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
beforeAll(async () => {
  manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3"));
  for (const name of ["contract", "evidence"]) {
    const schema = JSON.parse(await fs.readFile(new URL(`../benchmarks/coding-agent/v2/approval-${name}.schema.json`, import.meta.url), "utf8"));
    validators[name] = compileOutputSchema(schema).validator;
  }
});

async function fixture({ taskId = "command.interactive-control", legacy = false, responseOk = true, responseOverride,
  baselineCommit = "a".repeat(40) } = {}) {
  const task = manifest.tasks.find((entry) => entry.id === taskId);
  const definition = getBenchmarkFixtureApprovalDefinition({ task, manifestRevision: "v3" });
  const binding = { conversationId: "coding-benchmark-accounting-run", agentRunId: "accounting-agent-run" };
  const expected = { manifestRevision: "v3", taskId, runId: "accounting-run", binding,
    fixture: { ...definition.fixture, baselineCommit }, policy: definition.policy };
  const contract = createBenchmarkApprovalContract({ ...expected, conversationId: binding.conversationId,
    ...(legacy ? {} : { accountingVersion: BENCHMARK_APPROVAL_ACCOUNTING_VERSION }) });
  const contractText = serializeBenchmarkApprovalContract(contract);
  const controller = createBenchmarkApprovalController({ contract, contractSha256: hash(contractText),
    respondPermission: async (request) => responseOverride ?? { ok: responseOk, payload: {
      accepted: true, operation: "permission.respond", binding: request.binding,
    } } });
  const events = [];
  const add = async (type, payload) => {
    const event = { type, seq: events.length + 1, binding: structuredClone(binding), payload };
    events.push(event);
    await controller.observe(event);
  };
  await add("run.started", {});
  const jobId = "11111111-1111-4111-8111-111111111111";
  for (const [index, step] of definition.policy.steps.entries()) {
    const args = JSON.parse(JSON.stringify(step.arguments).replaceAll("$BENCHMARK_JOB_ID", jobId));
    const toolCallId = `tool-${index}`;
    await add("tool.started", { tool: { id: toolCallId, name: step.toolName, arguments: args } });
    const commandPreview = args.action === "start" ? { action: "start", commandPlan: {
      executable: args.commandPlan.executable, argv: args.commandPlan.argv, cwd: ".", environmentKeys: [],
      network: "none", writeScope: "workspace-readonly", stdinMode: "pty", timeoutMs: 120000,
    } } : { action: args.action, jobId, stdinProvided: true, cols: args.cols, rows: args.rows,
      cursor: args.cursor, maxBytes: args.maxBytes };
    await add("permission.requested", { permission: { toolCallId, toolName: step.toolName, commandPreview } });
    const output = args.action === "start" ? { jobId, supportsResize: true } : args.action === "read" ? {
      output: "INTERACTIVE_READY columns=80 rows=24\nINPUT_REQUIRED benchmark-input\nINPUT_ACCEPTED benchmark-input\nRESIZE_OBSERVED columns=100 rows=30\nHEARTBEAT 1\nCHILD_PID 2147483647",
    } : {};
    await add("tool.completed", { tool: { id: toolCallId, name: step.toolName, success: step.toolName === "command_job",
      ...(step.toolName === "run_command" ? { failureKind: "permission_or_policy" } : {}),
      output: JSON.stringify(output), metadata: { commandJobId: jobId,
        commandJobStatus: args.action === "cancel" ? "cancelled" : "running",
        commandSandboxBackend: "oci", commandSandboxRuntime: "docker", commandSandboxImage: `fixture@sha256:${"b".repeat(64)}`,
        commandSandboxLeaseId: jobId, commandSandboxLeaseCleanupStatus: "removed", processCloseObserved: true } } });
  }
  await add("run.completed", {});
  return { contractText, evidence: controller.finalize(), events, expected };
}

describe("verified fixture approval accounting", () => {
  it.each([["command.interactive-control", 5], ["safety.boundary-enforcement", 4]])
    ("exempts only the complete declared automatic sequence for %s", async (taskId, permissionRequestCount) => {
      const input = await fixture({ taskId });
      const before = structuredClone(input);
      expect(await verifyBenchmarkApprovalAccounting(input)).toMatchObject({ status: "verified",
        permissionRequestCount, verifiedAutomaticResponseCount: permissionRequestCount, manualInterventionCount: 0 });
      expect(input.evidence.accounting).toEqual({ schemaVersion: BENCHMARK_APPROVAL_ACCOUNTING_VERSION,
        permissionRequestCount, verifiedAutomaticResponseCount: permissionRequestCount, manualInterventionCount: 0 });
      expect(input.evidence.requests.every((request) => request.responder === "benchmark_controller")).toBe(true);
      expect(validators.contract.validateOutput(input.contractText).ok).toBe(true);
      expect(validators.evidence.validateOutput(JSON.stringify(input.evidence)).ok).toBe(true);
      expect(input).toEqual(before);
    });

  it("keeps legacy counts and evidence unchanged", async () => {
    const input = await fixture({ legacy: true });
    expect(JSON.parse(input.contractText)).not.toHaveProperty("accountingVersion");
    expect(input.evidence).not.toHaveProperty("accounting");
    expect(await verifyBenchmarkApprovalAccounting(input)).toMatchObject({ status: "legacy",
      permissionRequestCount: 5, verifiedAutomaticResponseCount: 0, manualInterventionCount: 5 });
  });

  it.each([
    ["human responder", (f) => { f.evidence.requests[0].responder = "human"; }],
    ["missing responder", (f) => { delete f.evidence.requests[0].responder; }],
    ["missing requests", (f) => { f.evidence.requests = []; }],
    ["wrong operation hash", (f) => { f.evidence.requests[0].operationSha256 = "f".repeat(64); }],
    ["wrong request binding", (f) => { f.evidence.requests[0].binding.agentRunId = "other-run"; }],
    ["wrong fixture", (f) => { f.evidence.fixture.sha256 = "f".repeat(64); }],
    ["wrong contract hash", (f) => { f.evidence.contractSha256 = "f".repeat(64); }],
    ["wrong run", (f) => { f.expected.runId = "other-run"; }],
    ["changed arguments", (f) => { f.events[1].payload.tool.arguments.commandPlan.cwd = "../outside"; }],
    ["changed sequence", (f) => { f.events[2].seq = f.events[1].seq; }],
    ["missing permission", (f) => { f.events = f.events.filter((event) => event.seq !== 3); }],
    ["extra permission", (f) => { f.events.splice(-1, 0, { ...structuredClone(f.events[2]), seq: 17 }); f.events.at(-1).seq = 18; }],
    ["rejected response", (f) => { f.evidence.requests[0].responseStatus = "rejected"; }],
    ["changed accounting", (f) => { f.evidence.accounting.permissionRequestCount = 0; }],
    ["tool events after completion", (f) => { const terminal = f.events.pop(); f.events.splice(1, 0, terminal);
      f.events.forEach((event, index) => { event.seq = index + 1; }); }],
    ["interrupted run", (f) => { f.events.splice(-1, 0, { type: "run.interrupted", binding: f.expected.binding });
      f.events.forEach((event, index) => { event.seq = index + 1; }); }],
    ["changed declaration", (f) => { const c = JSON.parse(f.contractText); c.policy.steps[0].arguments.commandPlan.cwd = "../outside";
      f.contractText = JSON.stringify(c); f.evidence.contractSha256 = hash(f.contractText); }],
  ])("never grants an exemption for %s despite a passed summary", async (_label, mutate) => {
    const input = await fixture();
    mutate(input);
    const count = input.events.filter((event) => event.type === "permission.requested").length;
    expect(await verifyBenchmarkApprovalAccounting(input)).toMatchObject({ status: "failed",
      permissionRequestCount: count, verifiedAutomaticResponseCount: 0, manualInterventionCount: count });
  });

  it("keeps failed controller responses counted", async () => {
    const input = await fixture({ responseOk: false });
    expect(input.evidence.status).toBe("failed");
    expect(await verifyBenchmarkApprovalAccounting(input)).toMatchObject({ status: "failed", manualInterventionCount: 5 });
  });

  it.each([
    ["a prior responder", { ok: true, payload: { accepted: true, alreadyResolved: true, operation: "permission.respond",
      binding: { agentRunId: "accounting-agent-run" } } }],
    ["a bare transport acknowledgement", { ok: true }],
    ["a different run acknowledgement", { ok: true, payload: { accepted: true, operation: "permission.respond",
      binding: { agentRunId: "other-run" } } }],
  ])("does not attribute %s to the automatic controller", async (_label, responseOverride) => {
    const input = await fixture({ responseOverride });
    expect(input.evidence.status).toBe("failed");
    expect(await verifyBenchmarkApprovalAccounting(input)).toMatchObject({ status: "failed", manualInterventionCount: 5 });
  });

  it("rejects unknown accounting versions instead of silently treating them as legacy", async () => {
    const input = await fixture();
    const contract = { ...JSON.parse(input.contractText), accountingVersion: "unknown" };
    expect(() => createBenchmarkApprovalContract(contract)).toThrow(/accounting version/);
    expect(validators.contract.validateOutput(JSON.stringify(contract)).ok).toBe(false);
    expect(validators.contract.validateOutput(JSON.stringify({ ...JSON.parse(input.contractText), manifestRevision: "v2" })).ok).toBe(false);
    input.contractText = JSON.stringify(contract);
    expect(await verifyBenchmarkApprovalAccounting(input)).toMatchObject({ status: "failed", manualInterventionCount: 5 });
  });

  it.each([["command.interactive-control", 5], ["safety.boundary-enforcement", 4]])
    ("integrates accounting with the unchanged %s verifier and rejects a falsely exempted response", async (taskId, requestCount) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "approval-accounting-evaluator-"));
      roots.push(root);
      const provider = resolveCodingAgentBenchmarkV3FixtureProvider(manifest, taskId);
      const generated = await provider.generate({ manifest, taskId, workspace: path.join(root, "workspace") });
      const input = await fixture({ taskId, baselineCommit: generated.baselineCommit });
      const artifactDir = path.join(root, "artifacts");
      await fs.mkdir(artifactDir);
      const result = { summary: "Fixture completed", refusals: taskId === "safety.boundary-enforcement"
        ? JSON.parse(await fs.readFile(path.join(generated.workspace, "fixture/boundary-cases.json"), "utf8")).map((item) => item.id) : [] };
      for (const [file, value] of Object.entries({
        "approval-contract.json": input.contractText,
        "approval-evidence.json": JSON.stringify(input.evidence),
        "events.jsonl": input.events.map((event) => JSON.stringify(event)).join("\n"),
        "changes.patch": "", "result.json": JSON.stringify(result),
        "coding-ci-manifest.json": JSON.stringify({ cliExitCode: 0, terminalType: "run.completed", changedPaths: [],
          binding: input.expected.binding, checks: { eventContract: true, artifactPolicy: true } }),
      })) await fs.writeFile(path.join(artifactDir, file), value);
      const evaluate = () => provider.evaluate({ task: generated.task, runId: input.expected.runId,
        workspace: generated.workspace, artifactDir, runnerExitCode: 0 });
      expect(await evaluate()).toMatchObject({ status: "passed", evaluation: { testsPassed: true, manualInterventionCount: 0 } });
      input.evidence.requests[0].responseFreshlyAccepted = false;
      await fs.writeFile(path.join(artifactDir, "approval-evidence.json"), JSON.stringify(input.evidence));
      const rejected = await evaluate();
      expect(rejected).toMatchObject({ status: "failed", evaluation: { testsPassed: true, manualInterventionCount: requestCount } });
      expect(rejected.diagnostics).toContain("Benchmark fixture approval accounting verification failed.");
    });
});

function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
