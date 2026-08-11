import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(workspaceRoot, "benchmarks", "verification", "v1", "verification-dag.schema.json");
const impactEvidenceSchemaPath = path.join(workspaceRoot, "benchmarks", "verification", "v1", "impact-evidence.schema.json");
const modulePath = pathToFileURL(path.join(workspaceRoot, "scripts", "run-verification-dag.mjs")).href;
const execFile = promisify(execFileCallback);
const browserScreenshotContent = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const fixedRequest = {
  runId: "verify-run-001",
  taskId: "feature.cross-file",
  generatedAt: "2026-08-09T15:00:00.000Z",
  commit: "b32004a8ae6eeed9fa29b8c837bbc95fdee3566e",
  workspaceHash: crypto.createHash("sha256").update("workspace").digest("hex"),
  changedPaths: ["src/feature.ts", "src/feature.test.ts"],
  verificationCommands: [
    { id: "test.feature", kind: "acceptance", command: "pnpm vitest run src/feature.test.ts", affectedPaths: ["src/feature.ts", "src/feature.test.ts"] },
    { id: "test.unrelated", kind: "acceptance", command: "pnpm vitest run src/unrelated.test.ts", affectedPaths: ["src/unrelated.ts"] },
    { id: "typecheck", kind: "typecheck", command: "pnpm exec tsc --noEmit", affectedPaths: ["src/**"] },
  ],
};

function structuredReport(framework, content) {
  return {
    framework,
    format: framework === "vitest" ? "vitest-json/v3.2.7" : "go-test-json/v1",
    runnerVersion: framework === "vitest" ? "3.2.7" : "go1.26.5",
    artifact: {
      path: framework === "vitest" ? "artifacts/vitest-report.json" : "artifacts/go-test-report.jsonl",
      sha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
    },
    content,
  };
}

function browserReport(reportOverrides = {}, {
  reportPath = "artifacts/verification/browser-report.json",
  screenshotPath = "artifacts/verification/browser-screenshot.png",
} = {}) {
  const beforeSha256 = crypto.createHash("sha256").update("<div data-state=idle>").digest("hex");
  const afterSha256 = crypto.createHash("sha256").update("<div data-state=verified>").digest("hex");
  const report = {
    schemaVersion: "browser-relay-verification/v1",
    runnerVersion: "browser-relay/v1",
    revision: fixedRevision(),
    observedAt: "2026-08-11T12:00:00.000Z",
    route: "/fixture.html",
    viewport: { width: 960, height: 640, deviceScaleFactor: 1 },
    page: { loaded: true, finalRoute: "/fixture.html" },
    dom: { changed: true, beforeSha256, afterSha256, assertions: { total: 2, failed: 0 } },
    console: { errorCount: 0, warningCount: 0 },
    requests: {
      observedCount: 1,
      failedCount: 0,
      blockedExternalCount: 0,
      assertions: { total: 1, failed: 0 },
      outcomes: [{ method: "POST", route: "/probe", status: 200, count: 1 }],
    },
    screenshot: {
      artifact: {
        path: screenshotPath,
        sha256: crypto.createHash("sha256").update(browserScreenshotContent).digest("hex"),
      },
      bytes: browserScreenshotContent.length,
      width: 1,
      height: 1,
    },
    lifecycle: { status: "settled", pageClosed: true, browserClosed: true, pendingRequestCount: 0, orphanResourceCount: 0 },
    ...reportOverrides,
  };
  const content = JSON.stringify(report);
  return {
    artifact: {
      path: reportPath,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    },
    content,
    screenshotContent: browserScreenshotContent,
  };
}

async function writeBrowserArtifactTriplet(relativeDir) {
  const reportPath = path.posix.join(relativeDir, "browser-report.json");
  const screenshotPath = path.posix.join(relativeDir, "browser-screenshot.png");
  const evidencePath = path.posix.join(relativeDir, "browser-evidence.json");
  const report = browserReport({}, { reportPath, screenshotPath });
  const evidence = projectVerificationBrowserReport({
    ...report,
    expectedRevision: fixedRevision(),
  });
  const targetDir = path.join(workspaceRoot, ...relativeDir.split("/"));
  await fs.mkdir(targetDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(workspaceRoot, ...reportPath.split("/")), report.content, "utf8"),
    fs.writeFile(path.join(workspaceRoot, ...screenshotPath.split("/")), browserScreenshotContent),
    fs.writeFile(path.join(workspaceRoot, ...evidencePath.split("/")), `${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
  ]);
  return { reportPath, screenshotPath, evidencePath, report, evidence };
}

function fixedRevision() {
  return { commit: fixedRequest.commit, workspaceHash: fixedRequest.workspaceHash };
}

function replayBinding() {
  return {
    environmentHash: crypto.createHash("sha256").update("environment-v1").digest("hex"),
    inputHash: crypto.createHash("sha256").update("input-v1").digest("hex"),
  };
}

function failureFingerprint(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function completeImpactEvidence({
  source: sourceOverrides = {},
  status = "complete",
  changedPath,
  impactedPaths,
}) {
  const source = {
    id: "codeintel.references",
    kind: "code-intel-reference",
    contractVersion: "code-intel/v1",
    status,
    artifact: {
      path: "artifacts/verification/impact-evidence.json",
      sha256: crypto.createHash("sha256").update("impact-evidence").digest("hex"),
    },
    ...sourceOverrides,
    status,
  };
  return {
    schemaVersion: "verification-impact-evidence/v1",
    revision: fixedRevision(),
    sources: [source],
    coverage: [{
      changedPath,
      status,
      sourceIds: [source.id],
      impactedPaths,
    }],
  };
}

async function loadModule() {
  return import(modulePath);
}

describe("verification DAG contract", () => {
  it("selects affected tests and records plan-and-replay as zero execution", async () => {
    const { createVerificationDagPlan } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);

    expect(plan.selection).toMatchObject({ strategy: "changed-paths-v1", scope: "targeted", expanded: false, reason: "affected-paths" });
    expect(plan.nodes.map((node) => node.id)).toEqual(["test.feature", "typecheck"]);
    expect(plan.execution).toMatchObject({ mode: "plan-and-replay", commandsExecuted: false, providerCalls: 0, mutationCount: 0 });
    expect(plan.outcome).toMatchObject({ taskStatus: "verification_incomplete", verificationStatus: "not_started", reason: "not_executed" });
  });

  it("expands to all commands when changed-path scope is unavailable", async () => {
    const { selectVerificationNodes } = await loadModule();
    const selection = selectVerificationNodes({ verificationCommands: fixedRequest.verificationCommands });

    expect(selection.selection).toMatchObject({ scope: "expanded", expanded: true, reason: "scope-unavailable" });
    expect(selection.nodes.map((node) => node.id)).toEqual(["test.feature", "test.unrelated", "typecheck"]);
  });

  it("expands to all commands when any changed path lacks explicit impact coverage", async () => {
    const { selectVerificationNodes } = await loadModule();
    const selection = selectVerificationNodes({
      changedPaths: ["src/feature.ts", "config/unknown.toml"],
      verificationCommands: fixedRequest.verificationCommands,
    });

    expect(selection.selection).toMatchObject({
      scope: "expanded",
      expanded: true,
      reason: "impact-unknown",
    });
    expect(selection.nodes.map((node) => node.id)).toEqual(["test.feature", "test.unrelated", "typecheck"]);
  });

  it("adds a Browser Relay node only when the browser condition is affected", async () => {
    const { createVerificationDagPlan } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      browser: { required: true, affectedPaths: ["apps/web/**"], command: null },
      changedPaths: ["apps/web/src/app.js"],
      verificationCommands: [],
    });

    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]).toMatchObject({ id: "browser.relay", kind: "browser", scope: "browser", command: null });
    expect(plan.selection.reason).toBe("browser-required");
  });

  it("projects a revision-bound passed Browser Relay report into a Schema-valid attempt", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      browser: true,
      changedPaths: ["apps/web/public/app.js"],
      verificationCommands: [],
    });
    const finalized = finalizeVerificationDag(plan, [
      { id: "browser.relay", status: "passed", browserReport: browserReport() },
    ]);

    expect(finalized.nodes[0]).toMatchObject({
      status: "passed",
      attempts: [{
        browserReport: {
          schemaVersion: "verification-browser-evidence/v1",
          status: "passed",
          reason: "all_checks_passed",
          revision: fixedRevision(),
          lifecycle: { status: "settled", pageClosed: true, browserClosed: true },
        },
      }],
    });
    expect(finalized.outcome).toMatchObject({ taskStatus: "completed", verificationStatus: "passed" });
    expect(JSON.stringify(finalized)).not.toContain(browserScreenshotContent.toString("base64"));
    expect(compiled.validator.validateOutput(JSON.stringify(finalized))).toMatchObject({ ok: true });
  });

  it("keeps console and request Browser Relay evidence as failed DAG results", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      browser: true,
      changedPaths: ["apps/web/public/app.js"],
      verificationCommands: [],
    });
    const consoleFailure = finalizeVerificationDag(plan, [{
      id: "browser.relay",
      status: "failed",
      kind: "browser",
      browserReport: browserReport({ console: { errorCount: 1, warningCount: 0 } }),
    }]);
    const baseRequests = JSON.parse(browserReport().content).requests;
    const requestFailure = finalizeVerificationDag(plan, [{
      id: "browser.relay",
      status: "failed",
      kind: "browser",
      browserReport: browserReport({
        requests: { ...baseRequests, failedCount: 1, assertions: { total: 1, failed: 1 } },
      }),
    }]);

    expect(consoleFailure.nodes[0].attempts[0].browserReport).toMatchObject({ status: "failed", reason: "console_error" });
    expect(requestFailure.nodes[0].attempts[0].browserReport).toMatchObject({ status: "failed", reason: "request_failure" });
    expect(consoleFailure.outcome).toMatchObject({ taskStatus: "verification_failed", firstFailureNodeId: "browser.relay" });
    expect(requestFailure.outcome).toMatchObject({ taskStatus: "verification_failed", firstFailureNodeId: "browser.relay" });
  });

  it("maps an unsettled Browser Relay lifecycle only to incomplete DAG states", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      browser: true,
      changedPaths: ["apps/web/public/app.js"],
      verificationCommands: [],
    });
    const incompleteReport = browserReport({
      lifecycle: { status: "incomplete", pageClosed: true, browserClosed: false, pendingRequestCount: 1, orphanResourceCount: 0 },
    });
    const finalized = finalizeVerificationDag(plan, [
      { id: "browser.relay", status: "not_run", browserReport: incompleteReport },
    ]);

    expect(finalized.nodes[0].attempts[0].browserReport).toMatchObject({ status: "incomplete", reason: "lifecycle_incomplete" });
    expect(finalized.outcome).toMatchObject({ taskStatus: "verification_incomplete", verificationStatus: "incomplete" });
    expect(() => finalizeVerificationDag(plan, [
      { id: "browser.relay", status: "passed", browserReport: incompleteReport },
    ])).toThrow(/disagrees with DAG status/u);
  });

  it("rejects Browser Relay evidence on a non-browser verification node", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);

    expect(() => finalizeVerificationDag(plan, [
      { id: "test.feature", status: "passed", browserReport: browserReport() },
      { id: "typecheck", status: "passed" },
    ])).toThrow(/only supported for browser nodes/u);
  });

  it("uses complete CodeIntel reference evidence to close a cross-file impact path", async () => {
    const { selectVerificationNodes } = await loadModule();
    const evidence = completeImpactEvidence({
      source: {
        id: "codeintel.references",
        kind: "code-intel-reference",
        contractVersion: "code-intel/v1",
      },
      changedPath: "src/feature.ts",
      impactedPaths: ["src/unrelated.ts"],
    });
    const selection = selectVerificationNodes({
      changedPaths: ["src/feature.ts"],
      verificationCommands: fixedRequest.verificationCommands,
      impactEvidence: evidence,
      revision: fixedRevision(),
    });

    expect(selection.selection).toMatchObject({ scope: "targeted", expanded: false, reason: "impact-evidence" });
    expect(selection.nodes.map((node) => node.id)).toEqual(["test.feature", "test.unrelated", "typecheck"]);
    expect(selection.selection.impactEvidence).toMatchObject({
      schemaVersion: "verification-impact-evidence/v1",
      sources: [{ kind: "code-intel-reference", contractVersion: "code-intel/v1", status: "complete" }],
    });
  });

  it("uses complete project dependency evidence to cover an otherwise unknown path", async () => {
    const { selectVerificationNodes } = await loadModule();
    const evidence = completeImpactEvidence({
      source: {
        id: "project.tsconfig",
        kind: "project-dependency",
        contractVersion: "project-dependency/v1",
      },
      changedPath: "config/project.toml",
      impactedPaths: ["src/feature.ts"],
    });
    const selection = selectVerificationNodes({
      changedPaths: ["config/project.toml"],
      verificationCommands: fixedRequest.verificationCommands,
      impactEvidence: evidence,
      revision: fixedRevision(),
    });

    expect(selection.selection).toMatchObject({ scope: "targeted", expanded: false, reason: "impact-evidence" });
    expect(selection.nodes.map((node) => node.id)).toEqual(["test.feature", "typecheck"]);
  });

  it("expands conservatively for partial evidence and rejects revision drift", async () => {
    const { selectVerificationNodes } = await loadModule();
    const partialEvidence = completeImpactEvidence({
      status: "partial",
      changedPath: "config/project.toml",
      impactedPaths: ["src/feature.ts"],
    });
    const expanded = selectVerificationNodes({
      changedPaths: ["config/project.toml"],
      verificationCommands: fixedRequest.verificationCommands,
      impactEvidence: partialEvidence,
      revision: fixedRevision(),
    });

    expect(expanded.selection).toMatchObject({ scope: "expanded", expanded: true, reason: "impact-unknown" });
    expect(expanded.nodes.map((node) => node.id)).toEqual(["test.feature", "test.unrelated", "typecheck"]);
    expect(() => selectVerificationNodes({
      changedPaths: ["config/project.toml"],
      verificationCommands: fixedRequest.verificationCommands,
      impactEvidence: completeImpactEvidence({ changedPath: "config/project.toml", impactedPaths: ["src/feature.ts"] }),
      revision: { ...fixedRevision(), commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    })).toThrow(/revision does not match/u);
  });

  it("closes selected command dependencies before validating the DAG", async () => {
    const { createVerificationDagPlan } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: ["src/feature.ts"],
      verificationCommands: [
        { id: "build", kind: "build", command: "pnpm build", affectedPaths: ["build/**"] },
        { id: "test.feature", kind: "acceptance", command: "pnpm test", affectedPaths: ["src/**"], dependsOn: ["build"] },
      ],
    });

    expect(plan.nodes.map((node) => node.id)).toEqual(["build", "test.feature"]);
  });

  it("classifies a required failure and preserves its first failure", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);
    const finalized = finalizeVerificationDag(plan, [
      { id: "test.feature", status: "failed", kind: "test", message: "assertion failed" },
      { id: "typecheck", status: "passed" },
    ]);

    expect(finalized.outcome).toMatchObject({ taskStatus: "verification_failed", verificationStatus: "failed", reason: "required_failure", firstFailureNodeId: "test.feature" });
    expect(finalized.nodes[0].attempts).toEqual([{ attempt: 1, status: "failed" }]);
    expect(finalized.nodes[0].firstFailure).toMatchObject({ status: "failed", kind: "test" });
    expect(finalized.nodes[0].firstFailure.messageHash).toHaveLength(64);
  });

  it("retains the first failure and classifies a bounded reproducible replay", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);
    const binding = replayBinding();
    const fingerprint = failureFingerprint("stable-test-failure");
    const finalized = finalizeVerificationDag(plan, [
      {
        id: "test.feature",
        status: "failed",
        kind: "test",
        message: "first failure text is not persisted",
        replayBinding: binding,
        failureFingerprint: fingerprint,
        replays: [
          { status: "failed", kind: "test", replayBinding: binding, failureFingerprint: fingerprint },
          { status: "failed", kind: "test", replayBinding: binding, failureFingerprint: fingerprint },
        ],
      },
      { id: "typecheck", status: "passed" },
    ]);

    expect(finalized.outcome).toMatchObject({ taskStatus: "verification_failed", verificationStatus: "failed", firstFailureNodeId: "test.feature" });
    expect(finalized.nodes[0].attempts.map((attempt) => attempt.status)).toEqual(["failed", "failed", "failed"]);
    expect(finalized.nodes[0].attempts[1].replayEvidence).toMatchObject({ binding, failureFingerprint: fingerprint });
    expect(finalized.nodes[0].firstFailure.messageHash).toBe(crypto.createHash("sha256").update("first failure text is not persisted", "utf8").digest("hex"));
    expect(finalized.nodes[0].replay).toEqual({
      maxAttempts: 3,
      replayCount: 2,
      classification: "reproducible_failure",
      binding,
      failureFingerprint: fingerprint,
    });
    expect(compiled.validator.validateOutput(JSON.stringify(finalized))).toMatchObject({ ok: true });
  });

  it("keeps a flaky failure failed and rejects replay binding drift or unbounded retries", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);
    const binding = replayBinding();
    const fingerprint = failureFingerprint("flaky-test-failure");
    const flaky = finalizeVerificationDag(plan, [
      {
        id: "test.feature",
        status: "failed",
        kind: "test",
        replayBinding: binding,
        failureFingerprint: fingerprint,
        replays: [{ status: "passed", replayBinding: binding }],
      },
      { id: "typecheck", status: "passed" },
    ]);
    expect(flaky.outcome).toMatchObject({ taskStatus: "verification_failed", verificationStatus: "failed" });
    expect(flaky.nodes[0].replay).toMatchObject({ classification: "flaky", replayCount: 1, failureFingerprint: null });

    expect(() => finalizeVerificationDag(plan, [
      {
        id: "test.feature",
        status: "failed",
        kind: "test",
        replayBinding: binding,
        failureFingerprint: fingerprint,
        replays: [
          { status: "failed", replayBinding: binding, failureFingerprint: fingerprint },
          { status: "failed", replayBinding: binding, failureFingerprint: fingerprint },
          { status: "failed", replayBinding: binding, failureFingerprint: fingerprint },
        ],
      },
      { id: "typecheck", status: "passed" },
    ])).toThrow(/at most 2 replay/u);

    expect(() => finalizeVerificationDag(plan, [
      {
        id: "test.feature",
        status: "failed",
        kind: "test",
        replayBinding: binding,
        failureFingerprint: fingerprint,
        replays: [{
          status: "failed",
          replayBinding: { ...binding, inputHash: failureFingerprint("different-input") },
          failureFingerprint: fingerprint,
        }],
      },
      { id: "typecheck", status: "passed" },
    ])).toThrow(/binding does not match/u);
  });

  it("classifies skipped required verification as incomplete", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);
    const finalized = finalizeVerificationDag(plan, [
      { id: "test.feature", status: "passed" },
      { id: "typecheck", status: "not_run" },
    ]);

    expect(finalized.outcome).toMatchObject({ taskStatus: "verification_incomplete", verificationStatus: "incomplete", reason: "required_not_run", firstFailureNodeId: null });
  });

  it("produces a schema-valid completed artifact when every required node passes", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);
    const finalized = finalizeVerificationDag(plan, [
      { id: "test.feature", status: "passed" },
      { id: "typecheck", status: "passed" },
    ]);

    expect(finalized.outcome).toEqual({
      taskStatus: "completed",
      verificationStatus: "passed",
      reason: "all_required_passed",
      firstFailureNodeId: null,
    });
    expect(compiled.validator.validateOutput(JSON.stringify(finalized))).toMatchObject({ ok: true });
  });

  it("rejects duplicate results instead of hiding a first failure behind a retry", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);

    expect(() => finalizeVerificationDag(plan, [
      { id: "test.feature", status: "failed", kind: "test" },
      { id: "test.feature", status: "passed" },
    ])).toThrow(/exactly one result|duplicate/i);
  });

  it("keeps implementation completed when there are no applicable verification nodes", async () => {
    const { createVerificationDagPlan, finalizeVerificationDag } = await loadModule();
    const plan = createVerificationDagPlan({ ...fixedRequest, verificationCommands: [], changedPaths: [] });
    const finalized = finalizeVerificationDag(plan, []);

    expect(finalized.outcome).toEqual({
      taskStatus: "implementation_completed",
      verificationStatus: "not_started",
      reason: "no_nodes",
      firstFailureNodeId: null,
    });
  });

  it("rejects absolute, parent, and backslash paths", async () => {
    const { createVerificationDagPlan } = await loadModule();
    for (const changedPath of ["C:/secret.txt", "/etc/passwd", "../outside", "src\\file.ts"]) {
      expect(() => createVerificationDagPlan({ ...fixedRequest, changedPaths: [changedPath] })).toThrow(/safe relative path/i);
    }
  });

  it("rejects invalid timestamps, scopes, commits, and credential-shaped commands", async () => {
    const { createVerificationDagPlan } = await loadModule();
    const credentialShapedLiteral = ["sk", "abcdefghijklmnopqrstuv"].join("-");
    expect(() => createVerificationDagPlan({ ...fixedRequest, generatedAt: "yesterday" })).toThrow(/ISO UTC timestamp/i);
    expect(() => createVerificationDagPlan({ ...fixedRequest, generatedAt: "2026-02-30T00:00:00.000Z" })).toThrow(/ISO UTC timestamp/i);
    expect(() => createVerificationDagPlan({ ...fixedRequest, commit: "not-a-commit" })).toThrow(/source revision/i);
    expect(() => createVerificationDagPlan({
      ...fixedRequest,
      verificationCommands: [{ id: "test", kind: "acceptance", scope: "remote", command: "pnpm test" }],
    })).toThrow(/scope is unsupported/i);
    expect(() => createVerificationDagPlan({
      ...fixedRequest,
      verificationCommands: [{ id: "test", kind: "acceptance", command: `curl -H 'Authorization: ${credentialShapedLiteral}'` }],
    })).toThrow(/credential-shaped/i);
  });

  it("rejects unknown dependencies and dependency cycles", async () => {
    const { createVerificationDagPlan } = await loadModule();
    expect(() => createVerificationDagPlan({
      ...fixedRequest,
      verificationCommands: [{ id: "test", kind: "acceptance", command: "pnpm test", dependsOn: ["missing"] }],
    })).toThrow(/dependency missing/i);
    expect(() => createVerificationDagPlan({
      ...fixedRequest,
      verificationCommands: [
        { id: "a", kind: "build", command: "pnpm build", affectedPaths: ["unselected/**"], dependsOn: ["b"] },
        { id: "b", kind: "acceptance", command: "pnpm test", affectedPaths: ["unselected/**"], dependsOn: ["a"] },
      ],
    })).toThrow(/cycle/i);
  });

  it("rejects a Browser Relay id collision", async () => {
    const { createVerificationDagPlan } = await loadModule();
    expect(() => createVerificationDagPlan({
      ...fixedRequest,
      verificationCommands: [{ id: "browser.relay", kind: "browser", command: "pnpm browser" }],
      browser: true,
    })).toThrow(/node ids must be unique/i);
  });

  it("writes an artifact once and refuses to overwrite it", async () => {
    const { createVerificationDagPlan, writeVerificationDagArtifact } = await loadModule();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-test-"));
    const outputPath = path.join(root, "report.json");
    try {
      const plan = createVerificationDagPlan(fixedRequest);
      await expect(writeVerificationDagArtifact(plan, outputPath)).resolves.toBe(outputPath);
      await expect(writeVerificationDagArtifact(plan, outputPath)).rejects.toThrow(/already exists/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("exposes the planner through the root package script", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"));
    expect(packageJson.scripts?.["verification:dag"]).toBe("node scripts/run-verification-dag.mjs");
  });

  it("publishes a closed schema that rejects command execution and credential-shaped fields", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { createVerificationDagPlan } = await loadModule();
    const plan = createVerificationDagPlan(fixedRequest);
    expect(compiled.validator.validateOutput(JSON.stringify(plan))).toMatchObject({ ok: true });

    const executed = structuredClone(plan);
    executed.execution.commandsExecuted = true;
    expect(compiled.validator.validateOutput(JSON.stringify(executed))).toMatchObject({ ok: false });

    const credential = structuredClone(plan);
    credential.execution.apiKey = "must-not-persist";
    expect(compiled.validator.validateOutput(JSON.stringify(credential))).toMatchObject({ ok: false });
  });

  it("publishes a closed impact-evidence schema and binds it into the DAG artifact", async () => {
    const evidenceSchema = JSON.parse(await fs.readFile(impactEvidenceSchemaPath, "utf8"));
    const evidenceCompiled = compileOutputSchema(evidenceSchema);
    expect(evidenceCompiled.ok).toBe(true);
    if (!evidenceCompiled.ok) return;
    const evidence = completeImpactEvidence({ changedPath: "src/feature.ts", impactedPaths: ["src/unrelated.ts"] });
    expect(evidenceCompiled.validator.validateOutput(JSON.stringify(evidence))).toMatchObject({ ok: true });
    expect(evidenceCompiled.validator.validateOutput(JSON.stringify({ ...evidence, extra: true }))).toMatchObject({ ok: false });

    const dagSchema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const dagCompiled = compileOutputSchema(dagSchema);
    expect(dagCompiled.ok).toBe(true);
    if (!dagCompiled.ok) return;
    const { createVerificationDagPlan } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: ["src/feature.ts"],
      impactEvidence: evidence,
    });
    expect(dagCompiled.validator.validateOutput(JSON.stringify(plan))).toMatchObject({ ok: true });
  });

  it("replays authoritative command-job terminal snapshots without parsing command or error text", async () => {
    const { createVerificationDagPlan, replayCommandJobSnapshots } = await loadModule();
    const verificationCommands = [
      { id: "cancelled", kind: "acceptance", command: "node verify-cancelled.mjs" },
      { id: "completed", kind: "acceptance", command: "node output-timed-out-text.mjs" },
      { id: "failed", kind: "build", command: "node verify-failed.mjs" },
      { id: "lost", kind: "typecheck", command: "node verify-lost.mjs" },
      { id: "timed-out", kind: "acceptance", command: "node verify-timeout.mjs" },
    ];
    const plan = createVerificationDagPlan({ ...fixedRequest, changedPaths: [], verificationCommands });
    const base = {
      stdinMode: "closed",
      createdAt: 1_000,
      updatedAt: 1_500,
      endedAt: 1_500,
      supportsResize: false,
      timeoutMs: 500,
      deadlineAt: 1_500,
      oldestCursor: 0,
      nextCursor: 0,
      recovery: {
        lifecycle: "settled",
        process: "not_applicable",
        output: "memory_only",
        stdin: "closed",
        mutationReplay: "forbidden",
      },
    };
    const replayed = replayCommandJobSnapshots(plan, [
      {
        id: "completed",
        snapshot: {
          ...base,
          jobId: "11111111-1111-4111-8111-111111111111",
          status: "completed",
          exitCode: 0,
          error: "this text says timed out but must never be parsed",
        },
      },
      {
        id: "failed",
        snapshot: {
          ...base,
          jobId: "22222222-2222-4222-8222-222222222222",
          status: "failed",
          exitCode: 2,
          error: "compiler output must not enter the replay artifact",
        },
      },
      {
        id: "cancelled",
        snapshot: {
          ...base,
          jobId: "33333333-3333-4333-8333-333333333333",
          status: "cancelled",
          terminationReason: "cancelled",
        },
      },
      {
        id: "lost",
        snapshot: {
          ...base,
          jobId: "44444444-4444-4444-8444-444444444444",
          status: "lost",
          recovery: { ...base.recovery, lifecycle: "lost", process: "not_reattachable", output: "unavailable" },
        },
      },
      {
        id: "timed-out",
        snapshot: {
          ...base,
          jobId: "55555555-5555-4555-8555-555555555555",
          status: "failed",
          terminationReason: "timed_out",
        },
      },
    ]);

    const byId = new Map(replayed.nodes.map((node) => [node.id, node]));
    expect(byId.get("completed")).toMatchObject({ status: "passed", attempts: [{ commandJob: { exit: { taxonomy: "zero_exit" } } }] });
    expect(byId.get("failed")).toMatchObject({ status: "failed", attempts: [{ commandJob: { exit: { taxonomy: "non_zero_exit", exitCode: 2 } } }] });
    expect(byId.get("cancelled")).toMatchObject({ status: "cancelled", attempts: [{ commandJob: { terminationReason: "cancelled", exit: { taxonomy: "cancelled" } } }] });
    expect(byId.get("lost")).toMatchObject({ status: "not_run", attempts: [{ commandJob: { exit: { taxonomy: "owner_lost" }, recoveryLifecycle: "lost" } }] });
    expect(byId.get("timed-out")).toMatchObject({
      status: "timed_out",
      attempts: [{ commandJob: { terminationReason: "timed_out", exit: { taxonomy: "timed_out" }, timing: { budgetExhausted: true } } }],
    });
    expect(replayed.execution.replay).toEqual({
      authority: "command-job",
      source: "terminal-snapshot",
      snapshotCount: 5,
      terminalOnly: true,
    });
    expect(JSON.stringify(replayed)).not.toContain("compiler output must not enter");
  });

  it("keeps failed cancellation cleanup distinct from a settled cancellation", async () => {
    const { createVerificationDagPlan, replayCommandJobSnapshots } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: [],
      verificationCommands: [{ id: "test", kind: "acceptance", command: "pnpm test" }],
    });
    const replayed = replayCommandJobSnapshots(plan, [{
      id: "test",
      snapshot: {
        jobId: "66666666-6666-4666-8666-666666666666",
        status: "failed",
        stdinMode: "closed",
        createdAt: 1_000,
        updatedAt: 1_200,
        endedAt: 1_200,
        supportsResize: false,
        timeoutMs: 500,
        deadlineAt: 1_500,
        terminationReason: "cancelled",
        oldestCursor: 0,
        nextCursor: 0,
        recovery: { lifecycle: "settled", process: "not_applicable", output: "memory_only", stdin: "closed", mutationReplay: "forbidden" },
      },
    }]);

    expect(replayed.nodes[0]).toMatchObject({
      status: "failed",
      attempts: [{ commandJob: { exit: { taxonomy: "cancellation_failed" } } }],
    });
  });

  it("rejects non-terminal or inconsistent command-job snapshots", async () => {
    const { createVerificationDagPlan, replayCommandJobSnapshots } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: [],
      verificationCommands: [{ id: "test", kind: "acceptance", command: "pnpm test" }],
    });
    const base = {
      jobId: "77777777-7777-4777-8777-777777777777",
      stdinMode: "closed",
      createdAt: 1_000,
      updatedAt: 1_200,
      supportsResize: false,
      oldestCursor: 0,
      nextCursor: 0,
      recovery: { lifecycle: "active", process: "attached", output: "memory_only", stdin: "closed", mutationReplay: "forbidden" },
    };

    expect(() => replayCommandJobSnapshots(plan, [{ id: "test", snapshot: { ...base, status: "running" } }])).toThrow(/terminal snapshot/i);
    expect(() => replayCommandJobSnapshots(plan, [{
      id: "test",
      snapshot: { ...base, status: "completed", exitCode: 3, endedAt: 1_200, recovery: { ...base.recovery, lifecycle: "settled", process: "not_applicable" } },
    }])).toThrow(/completed.*exit code/i);
  });

  it("keeps command-job replay artifacts inside the closed verification DAG schema", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { createVerificationDagPlan, replayCommandJobSnapshots } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: [],
      verificationCommands: [{ id: "test", kind: "acceptance", command: "pnpm test" }],
    });
    const replayed = replayCommandJobSnapshots(plan, [{
      id: "test",
      snapshot: {
        jobId: "88888888-8888-4888-8888-888888888888",
        status: "completed",
        stdinMode: "closed",
        createdAt: 1_000,
        updatedAt: 1_100,
        endedAt: 1_100,
        supportsResize: false,
        oldestCursor: 0,
        nextCursor: 0,
        recovery: { lifecycle: "settled", process: "not_applicable", output: "memory_only", stdin: "closed", mutationReplay: "forbidden" },
      },
    }]);

    expect(compiled.validator.validateOutput(JSON.stringify(replayed))).toMatchObject({ ok: true });
  });

  it("writes a command-job replay artifact through the CLI without executing the planned command", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-replay-cli-"));
    const inputPath = path.join(root, "request.json");
    const outputPath = path.join(root, "report.json");
    const markerPath = path.join(root, "must-not-exist.txt");
    try {
      await fs.writeFile(inputPath, JSON.stringify({
        ...fixedRequest,
        changedPaths: [],
        verificationCommands: [{
          id: "test",
          kind: "acceptance",
          command: `node -e require('node:fs').writeFileSync('${markerPath.replaceAll("\\", "/")}','executed')`,
        }],
        commandJobSnapshots: [{
          id: "test",
          snapshot: {
            jobId: "99999999-9999-4999-8999-999999999999",
            status: "completed",
            exitCode: 0,
            recovery: { lifecycle: "settled" },
          },
        }],
      }), "utf8");

      await execFile(process.execPath, [
        path.join(workspaceRoot, "scripts", "run-verification-dag.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], { cwd: workspaceRoot });

      const artifact = JSON.parse(await fs.readFile(outputPath, "utf8"));
      expect(artifact).toMatchObject({
        execution: { commandsExecuted: false, replay: { authority: "command-job", snapshotCount: 1 } },
        nodes: [{ id: "test", status: "passed" }],
        outcome: { taskStatus: "completed" },
      });
      await expect(fs.access(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("hydrates Browser Relay artifacts through the CLI and binds the projected evidence", async () => {
    const ioRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-browser-cli-"));
    const artifactRoot = await fs.mkdtemp(path.join(workspaceRoot, ".tmp-verification-dag-browser-"));
    const relativeDir = path.relative(workspaceRoot, artifactRoot).replaceAll("\\", "/");
    const inputPath = path.join(ioRoot, "request.json");
    const outputPath = path.join(ioRoot, "dag.json");
    try {
      const browserArtifacts = await writeBrowserArtifactTriplet(relativeDir);
      await fs.writeFile(inputPath, JSON.stringify({
        ...fixedRequest,
        changedPaths: ["apps/web/public/app.js"],
        verificationCommands: [],
        browser: true,
        browserArtifacts: {
          reportPath: browserArtifacts.reportPath,
          screenshotPath: browserArtifacts.screenshotPath,
          evidencePath: browserArtifacts.evidencePath,
        },
      }), "utf8");

      await execFile(process.execPath, [
        path.join(workspaceRoot, "scripts", "run-verification-dag.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], { cwd: workspaceRoot });

      const artifact = JSON.parse(await fs.readFile(outputPath, "utf8"));
      expect(artifact).toMatchObject({
        nodes: [{
          id: "browser.relay",
          status: "passed",
          attempts: [{
            status: "passed",
            evidence: { path: browserArtifacts.evidencePath },
            browserReport: {
              schemaVersion: "verification-browser-evidence/v1",
              status: "passed",
              source: { path: browserArtifacts.reportPath },
              screenshot: { artifact: { path: browserArtifacts.screenshotPath } },
            },
          }],
        }],
        outcome: { taskStatus: "completed", verificationStatus: "passed" },
      });
      const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
      const compiled = compileOutputSchema(schema);
      expect(compiled.ok).toBe(true);
      if (compiled.ok) {
        expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
      }
    } finally {
      await fs.rm(ioRoot, { recursive: true, force: true });
      await fs.rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("combines command-job snapshots and Browser Relay artifacts through the CLI", async () => {
    const ioRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-mixed-cli-"));
    const artifactRoot = await fs.mkdtemp(path.join(workspaceRoot, ".tmp-verification-dag-browser-"));
    const relativeDir = path.relative(workspaceRoot, artifactRoot).replaceAll("\\", "/");
    const inputPath = path.join(ioRoot, "request.json");
    const outputPath = path.join(ioRoot, "dag.json");
    try {
      const browserArtifacts = await writeBrowserArtifactTriplet(relativeDir);
      await fs.writeFile(inputPath, JSON.stringify({
        ...fixedRequest,
        changedPaths: [],
        verificationCommands: [{ id: "test", kind: "acceptance", command: "pnpm vitest run" }],
        browser: true,
        commandJobSnapshots: [{
          id: "test",
          snapshot: {
            jobId: "99999999-9999-4999-8999-999999999999",
            status: "completed",
            exitCode: 0,
            recovery: { lifecycle: "settled" },
          },
        }],
        browserArtifacts: {
          reportPath: browserArtifacts.reportPath,
          screenshotPath: browserArtifacts.screenshotPath,
          evidencePath: browserArtifacts.evidencePath,
        },
      }), "utf8");

      await execFile(process.execPath, [
        path.join(workspaceRoot, "scripts", "run-verification-dag.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], { cwd: workspaceRoot });

      const artifact = JSON.parse(await fs.readFile(outputPath, "utf8"));
      expect(artifact.nodes).toMatchObject([
        { id: "browser.relay", status: "passed" },
        { id: "test", status: "passed" },
      ]);
      expect(artifact.execution.replay).toMatchObject({
        authority: "command-job",
        snapshotCount: 1,
        terminalOnly: true,
      });
      expect(artifact.outcome).toMatchObject({ taskStatus: "completed", verificationStatus: "passed" });
    } finally {
      await fs.rm(ioRoot, { recursive: true, force: true });
      await fs.rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["parent", "../browser-report.json"],
    ["absolute", "C:/browser-report.json"],
    ["backslash", "artifacts\\browser-report.json"],
  ])("rejects a Browser Relay %s artifact path that escapes the workspace contract", async (_kind, invalidPath) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-browser-path-"));
    const inputPath = path.join(root, "request.json");
    const outputPath = path.join(root, "dag.json");
    try {
      await fs.writeFile(inputPath, JSON.stringify({
        ...fixedRequest,
        changedPaths: ["apps/web/public/app.js"],
        verificationCommands: [],
        browser: true,
        browserArtifacts: {
          reportPath: invalidPath,
          screenshotPath: "artifacts/browser-screenshot.png",
          evidencePath: "artifacts/browser-evidence.json",
        },
      }), "utf8");

      await expect(execFile(process.execPath, [
        path.join(workspaceRoot, "scripts", "run-verification-dag.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], { cwd: workspaceRoot })).rejects.toMatchObject({
        stderr: expect.stringMatching(/browserArtifacts\.reportPath must be a safe workspace-relative path/u),
      });
      await expect(fs.access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects Browser Relay evidence before reading beyond its one MiB limit", async () => {
    const ioRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-browser-size-"));
    const artifactRoot = await fs.mkdtemp(path.join(workspaceRoot, ".tmp-verification-dag-browser-"));
    const relativeDir = path.relative(workspaceRoot, artifactRoot).replaceAll("\\", "/");
    const inputPath = path.join(ioRoot, "request.json");
    const outputPath = path.join(ioRoot, "dag.json");
    try {
      const browserArtifacts = await writeBrowserArtifactTriplet(relativeDir);
      await fs.appendFile(
        path.join(workspaceRoot, ...browserArtifacts.evidencePath.split("/")),
        Buffer.alloc(1024 * 1024, 0x20),
      );
      await fs.writeFile(inputPath, JSON.stringify({
        ...fixedRequest,
        changedPaths: ["apps/web/public/app.js"],
        verificationCommands: [],
        browser: true,
        browserArtifacts: {
          reportPath: browserArtifacts.reportPath,
          screenshotPath: browserArtifacts.screenshotPath,
          evidencePath: browserArtifacts.evidencePath,
        },
      }), "utf8");

      await expect(execFile(process.execPath, [
        path.join(workspaceRoot, "scripts", "run-verification-dag.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], { cwd: workspaceRoot })).rejects.toMatchObject({
        stderr: expect.stringMatching(/browserArtifacts\.evidencePath must be between 1 and 1048576 bytes/u),
      });
      await expect(fs.access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(ioRoot, { recursive: true, force: true });
      await fs.rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "report revision drift",
      mutate: async ({ reportPath }) => {
        const target = path.join(workspaceRoot, ...reportPath.split("/"));
        const report = JSON.parse(await fs.readFile(target, "utf8"));
        report.revision.commit = "abcdef0123456789";
        await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      },
      error: /revision does not match|artifact hash does not match/u,
    },
    {
      name: "screenshot hash drift",
      mutate: async ({ screenshotPath }) => {
        await fs.appendFile(path.join(workspaceRoot, ...screenshotPath.split("/")), Buffer.from([0]));
      },
      error: /screenshot byte count drifted|artifact hash does not match/u,
    },
    {
      name: "projected evidence drift",
      mutate: async ({ evidencePath }) => {
        const target = path.join(workspaceRoot, ...evidencePath.split("/"));
        const evidence = JSON.parse(await fs.readFile(target, "utf8"));
        evidence.reason = "console_error";
        await fs.writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      },
      error: /evidence does not match the projected Browser report/u,
    },
  ])("rejects Browser Relay $name in CLI hydration", async ({ mutate, error }) => {
    const ioRoot = await fs.mkdtemp(path.join(os.tmpdir(), "verification-dag-browser-drift-"));
    const artifactRoot = await fs.mkdtemp(path.join(workspaceRoot, ".tmp-verification-dag-browser-"));
    const relativeDir = path.relative(workspaceRoot, artifactRoot).replaceAll("\\", "/");
    const inputPath = path.join(ioRoot, "request.json");
    const outputPath = path.join(ioRoot, "dag.json");
    try {
      const browserArtifacts = await writeBrowserArtifactTriplet(relativeDir);
      await mutate(browserArtifacts);
      await fs.writeFile(inputPath, JSON.stringify({
        ...fixedRequest,
        changedPaths: ["apps/web/public/app.js"],
        verificationCommands: [],
        browser: true,
        browserArtifacts: {
          reportPath: browserArtifacts.reportPath,
          screenshotPath: browserArtifacts.screenshotPath,
          evidencePath: browserArtifacts.evidencePath,
        },
      }), "utf8");

      await expect(execFile(process.execPath, [
        path.join(workspaceRoot, "scripts", "run-verification-dag.mjs"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ], { cwd: workspaceRoot })).rejects.toMatchObject({ stderr: expect.stringMatching(error) });
      await expect(fs.access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(ioRoot, { recursive: true, force: true });
      await fs.rm(artifactRoot, { recursive: true, force: true });
    }
  });

  it("binds native Vitest and Go test reports to compatible command-job results", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const { createVerificationDagPlan, replayCommandJobSnapshots } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: [],
      verificationCommands: [
        { id: "go", kind: "acceptance", command: "go test -json ./..." },
        { id: "vitest", kind: "acceptance", command: "pnpm vitest --reporter=json" },
      ],
    });
    const vitestContent = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTestSuites: 1,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [{ assertionResults: [{ status: "passed", title: "private title" }] }],
    });
    const goContent = [
      { Action: "start", Package: "example/failing" },
      { Action: "run", Package: "example/failing", Test: "TestFailure" },
      { Action: "output", Package: "example/failing", Test: "TestFailure", Output: "private failure body" },
      { Action: "fail", Package: "example/failing", Test: "TestFailure", Elapsed: 0.01 },
      { Action: "fail", Package: "example/failing", Elapsed: 0.02 },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";
    const settled = { lifecycle: "settled" };
    const replayed = replayCommandJobSnapshots(plan, [
      {
        id: "vitest",
        snapshot: {
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          status: "completed",
          exitCode: 0,
          recovery: settled,
        },
        testReport: structuredReport("vitest", vitestContent),
      },
      {
        id: "go",
        snapshot: {
          jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "failed",
          exitCode: 1,
          recovery: settled,
        },
        testReport: structuredReport("go-test", goContent),
      },
    ]);

    const byId = new Map(replayed.nodes.map((node) => [node.id, node]));
    expect(byId.get("vitest")).toMatchObject({
      status: "passed",
      attempts: [{ testReport: { framework: "vitest", status: "passed", tests: { passed: 1, failed: 0 } } }],
    });
    expect(byId.get("go")).toMatchObject({
      status: "failed",
      attempts: [{ testReport: { framework: "go-test", status: "failed", tests: { passed: 0, failed: 1 } } }],
    });
    expect(replayed.execution.replay.testReportCount).toBe(2);
    expect(replayed.outcome).toMatchObject({ taskStatus: "verification_failed", firstFailureNodeId: "go" });
    expect(JSON.stringify(replayed)).not.toMatch(/private title|private failure body|example\/failing/i);
    expect(compiled.validator.validateOutput(JSON.stringify(replayed))).toMatchObject({ ok: true });
  });

  it("rejects structured test reports that disagree with command-job exit state", async () => {
    const { createVerificationDagPlan, replayCommandJobSnapshots } = await loadModule();
    const plan = createVerificationDagPlan({
      ...fixedRequest,
      changedPaths: [],
      verificationCommands: [{ id: "test", kind: "acceptance", command: "pnpm test" }],
    });
    const passedContent = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTestSuites: 1,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [{ assertionResults: [{ status: "passed" }] }],
    });

    expect(() => replayCommandJobSnapshots(plan, [{
      id: "test",
      snapshot: {
        jobId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "failed",
        exitCode: 1,
        recovery: { lifecycle: "settled" },
      },
      testReport: structuredReport("vitest", passedContent),
    }])).toThrow(/disagrees with command-job/i);
  });
});
