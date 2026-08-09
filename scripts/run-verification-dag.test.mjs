import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(workspaceRoot, "benchmarks", "verification", "v1", "verification-dag.schema.json");
const modulePath = pathToFileURL(path.join(workspaceRoot, "scripts", "run-verification-dag.mjs")).href;
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
});
