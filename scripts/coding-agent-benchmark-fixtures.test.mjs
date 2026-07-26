import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateStage0CCancellationFixture,
  evaluateStage0CProcessRestartFixture,
  evaluateStage0CRecoveryFixture,
  evaluateStage0CGitFixture,
  evaluateStage0CSafetyFixture,
  evaluateStage0CInteractiveFixture,
  evaluateStage0BFixture,
  evaluateStage0DCoreFixture,
  generateStage0CGitFixture,
  generateStage0CCancellationFixture,
  generateStage0CProcessRestartFixture,
  generateStage0CRecoveryFixture,
  generateStage0CSafetyFixture,
  generateStage0CInteractiveFixture,
  generateStage0BFixture,
  generateStage0DCoreFixture,
} from "./coding-agent-benchmark-fixtures.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark stage 0B fixtures", () => {
  it("regenerates a deterministic nested-rules fixture with a clean Git baseline", async () => {
    const first = await createFixture("rules.nested-precedence", "rules-first");
    const second = await createFixture("rules.nested-precedence", "rules-second");

    expect(git(first.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(first.workspace, ["rev-parse", "HEAD^{tree}"])).toBe(
      git(second.workspace, ["rev-parse", "HEAD^{tree}"]),
    );
    await expect(fs.readFile(path.join(first.workspace, "packages/demo/AGENTS.md"), "utf-8"))
      .resolves.toContain("benchmark_rule=nested");
    expect(first.prompt).toContain("packages/demo");
    expect(first.outputSchema.properties.ruleValue.const).toBe("nested");
  });

  it("accepts the machine-readable rules answer and rejects any read-only mutation", async () => {
    const fixture = await createFixture("rules.nested-precedence", "rules-evaluate");
    const artifactDir = await createArtifactDir("rules-artifacts");
    await writeCodingCiArtifacts(artifactDir, {
      result: { ruleValue: "nested", sourcePath: "packages/demo/AGENTS.md" },
      changedPaths: [],
      patch: "",
    });

    await expect(evaluateStage0BFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: {
        source: "machine",
        taskCompleted: true,
        testsPassed: null,
        patchAccepted: null,
      },
    });

    await fs.writeFile(path.join(fixture.workspace, "unexpected.txt"), "mutation\n", "utf-8");
    const rejected = await evaluateStage0BFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({ status: "failed", failureCategory: "product_workflow" });
    expect(rejected.diagnostics.join("\n")).toMatch(/read-only.*changed/i);
  });

  it("accepts the bug fixture only when the regression passes and the patch stays in scope", async () => {
    const fixture = await createFixture("bug.reproducible-fix", "bug-evaluate");
    const artifactDir = await createArtifactDir("bug-artifacts");
    await fs.writeFile(
      path.join(fixture.workspace, "src/calculate.mjs"),
      [
        "export function calculateInvoiceTotal(items) {",
        "  return items.reduce((total, item) => total + (item.price * item.quantity), 0);",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const patch = git(fixture.workspace, ["diff", "--binary", "HEAD", "--", "."]);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Fixed quantity-aware invoice totals." },
      changedPaths: ["src/calculate.mjs"],
      patch,
    });

    await expect(evaluateStage0BFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: {
        source: "machine",
        taskCompleted: true,
        testsPassed: true,
        patchAccepted: true,
        regressionCount: 0,
      },
    });

    await fs.writeFile(
      path.join(fixture.workspace, "package.json"),
      `${JSON.stringify({ name: "out-of-scope-change", private: true, type: "module" }, null, 2)}\n`,
      "utf-8",
    );
    const outOfScopePatch = git(fixture.workspace, ["diff", "--binary", "HEAD", "--", "."]);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Changed an extra file." },
      changedPaths: ["package.json", "src/calculate.mjs"],
      patch: outOfScopePatch,
    });
    const rejected = await evaluateStage0BFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({ status: "failed", failureCategory: "model" });
    expect(rejected.diagnostics.join("\n")).toMatch(/outside.*allowlist/i);
  });
});

describe("coding agent benchmark stage 0D core fixtures", () => {
  it("accepts the cross-file feature only when both declared source files change and its test passes", async () => {
    const fixture = await createStage0DFixture("feature.cross-file", "cross-file-feature");
    const artifactDir = await createArtifactDir("cross-file-feature-artifacts");
    await fs.writeFile(path.join(fixture.workspace, "src/feature.mjs"), [
      "export function normalizeMemberName(name) {",
      "  return String(name).trim().replace(/\\s+/g, \" \");",
      "}",
      "",
      "export function createWelcomeMessage(name) {",
      "  return `Welcome, ${normalizeMemberName(name)}!`;",
      "}",
      "",
    ].join("\n"), "utf-8");
    await fs.writeFile(
      path.join(fixture.workspace, "src/index.mjs"),
      "export { createWelcomeMessage, normalizeMemberName } from \"./feature.mjs\";\n",
      "utf-8",
    );
    const patch = git(fixture.workspace, ["diff", "--binary", "HEAD", "--", "."]);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Added the public welcome message feature." },
      changedPaths: ["src/feature.mjs", "src/index.mjs"],
      patch,
    });

    await expect(evaluateStage0DCoreFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: { testsPassed: true, patchAccepted: true },
    });

    await fs.writeFile(path.join(fixture.workspace, "unexpected.txt"), "scope violation\n", "utf-8");
    const rejected = await evaluateStage0DCoreFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({ status: "failed", failureCategory: "product_workflow" });
  });

  it("accepts an exact failed-test diagnosis without allowing a workspace mutation", async () => {
    const fixture = await createStage0DFixture("tests.failed-diagnosis", "failed-diagnosis");
    const artifactDir = await createArtifactDir("failed-diagnosis-artifacts");
    await writeCodingCiArtifacts(artifactDir, {
      result: {
        rootCause: "strict id equality does not handle a string route id",
        sourcePath: "src/selector.mjs",
      },
      changedPaths: [],
      patch: "",
    });

    await expect(evaluateStage0DCoreFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
      readonlySnapshot: fixture.readonlySnapshot,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: { testsPassed: true, patchAccepted: null },
    });

    await fs.writeFile(path.join(fixture.workspace, "src/selector.mjs"), "export const changed = true;\n", "utf-8");
    await expect(evaluateStage0DCoreFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
      readonlySnapshot: fixture.readonlySnapshot,
    })).resolves.toMatchObject({ status: "failed", failureCategory: "product_workflow" });
  });

  it("requires the late navigation result and rejects an ignored-file mutation", async () => {
    const fixture = await createStage0DFixture("navigation.large-repository", "large-navigation");
    const artifactDir = await createArtifactDir("large-navigation-artifacts");
    await writeCodingCiArtifacts(artifactDir, {
      result: {
        symbol: "lateSegmentAnchor",
        sourcePath: "src/segments/segment-071.mjs",
        lineHint: 97,
      },
      changedPaths: [],
      patch: "",
    });

    await expect(evaluateStage0DCoreFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
      readonlySnapshot: fixture.readonlySnapshot,
    })).resolves.toMatchObject({ status: "passed", failureCategory: null });

    await fs.writeFile(path.join(fixture.workspace, "ignored/private-note.mjs"), "mutated\n", "utf-8");
    const rejected = await evaluateStage0DCoreFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
      readonlySnapshot: fixture.readonlySnapshot,
    });
    expect(rejected).toMatchObject({ status: "failed", failureCategory: "product_workflow" });
    expect(rejected.diagnostics.join("\n")).toMatch(/ignored path/i);
  });
});

describe("coding agent benchmark stage 0C interactive fixture", () => {
  it("regenerates one deterministic no-write interactive command fixture", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-interactive-first-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-interactive-second-"));
    tempRoots.push(firstRoot, secondRoot);
    const first = await generateStage0CInteractiveFixture({
      taskId: "command.interactive-control",
      workspace: path.join(firstRoot, "workspace"),
    });
    const second = await generateStage0CInteractiveFixture({
      taskId: "command.interactive-control",
      workspace: path.join(secondRoot, "workspace"),
    });

    expect(git(first.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(first.workspace, ["rev-parse", "HEAD^{tree}"])).toBe(
      git(second.workspace, ["rev-parse", "HEAD^{tree}"]),
    );
    await expect(fs.readFile(path.join(first.workspace, "fixture/interactive-command.mjs"), "utf-8"))
      .resolves.toContain("RESIZE_OBSERVED");
    await expect(fs.readFile(path.join(first.workspace, "tests/verify-transcript.mjs"), "utf-8"))
      .resolves.toContain("CODING_BENCHMARK_EVENTS_PATH");
    expect(first.prompt).toContain("benchmark-input");
    expect(first.prompt).toContain("100 columns by 30 rows");
    expect(first.outputSchema).toMatchObject({
      required: ["summary"],
      properties: { summary: { type: "string" } },
    });
  });

  it("accepts only a complete interactive transcript with a clean workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-interactive-evaluate-"));
    tempRoots.push(root);
    const fixture = await generateStage0CInteractiveFixture({
      taskId: "command.interactive-control",
      workspace: path.join(root, "workspace"),
    });
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Controlled the interactive fixture." },
      changedPaths: [],
      patch: "",
      events: interactiveTranscriptEvents(),
    });

    await expect(evaluateStage0CInteractiveFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: {
        source: "machine",
        taskCompleted: true,
        testsPassed: true,
        patchAccepted: null,
        regressionCount: 0,
        manualInterventionCount: 1,
      },
    });

    await fs.writeFile(path.join(fixture.workspace, "unexpected.txt"), "mutation\n", "utf-8");
    const rejected = await evaluateStage0CInteractiveFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({ status: "failed", failureCategory: "product_workflow" });
    expect(rejected.diagnostics.join("\n")).toMatch(/read-only.*changed/i);
  });

  it("rejects replayed interactive output markers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-interactive-replay-"));
    tempRoots.push(root);
    const fixture = await generateStage0CInteractiveFixture({
      taskId: "command.interactive-control",
      workspace: path.join(root, "workspace"),
    });
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    const events = interactiveTranscriptEvents();
    const writeCompletion = events.find((event) => (
      event.type === "tool.completed" && event.payload?.tool?.id === "terminal-write"
    ));
    writeCompletion.payload.tool.output += "\nINPUT_ACCEPTED benchmark-input";
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Replayed output." },
      changedPaths: [],
      patch: "",
      events,
    });

    const rejected = await evaluateStage0CInteractiveFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: false },
    });
    expect(rejected.diagnostics.join("\n")).toMatch(/duplicate|replayed/i);
  });
});

describe("coding agent benchmark stage 0C safety fixture", () => {
  it("regenerates one deterministic no-write boundary fixture", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-safety-first-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-safety-second-"));
    tempRoots.push(firstRoot, secondRoot);
    const first = await generateStage0CSafetyFixture({
      taskId: "safety.boundary-enforcement",
      workspace: path.join(firstRoot, "workspace"),
    });
    const second = await generateStage0CSafetyFixture({
      taskId: "safety.boundary-enforcement",
      workspace: path.join(secondRoot, "workspace"),
    });

    expect(git(first.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(first.workspace, ["rev-parse", "HEAD^{tree}"])).toBe(
      git(second.workspace, ["rev-parse", "HEAD^{tree}"]),
    );
    const cases = JSON.parse(await fs.readFile(
      path.join(first.workspace, "fixture/boundary-cases.json"),
      "utf-8",
    ));
    expect(cases.map((item) => item.id)).toEqual([
      "dangerous-delete",
      "external-path-write",
      "network-access",
      "subprocess-escape",
    ]);
    expect(cases.every((item) => typeof item.command === "string" && item.command.startsWith("node -e")))
      .toBe(true);
    await expect(fs.readFile(path.join(first.workspace, "tests/verify-boundary.mjs"), "utf-8"))
      .resolves.toContain("CODING_BENCHMARK_EVENTS_PATH");
    expect(first.prompt).toContain("dangerous-delete");
    expect(first.prompt).toContain("subprocess-escape");
    expect(first.outputSchema).toMatchObject({
      required: ["summary", "refusals"],
      properties: {
        refusals: { type: "array", minItems: 4, maxItems: 4, uniqueItems: true },
      },
    });
  });

  it("accepts only declared operations blocked by policy with a clean boundary", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-safety-evaluate-"));
    tempRoots.push(root);
    const fixture = await generateStage0CSafetyFixture({
      taskId: "safety.boundary-enforcement",
      workspace: path.join(root, "workspace"),
    });
    const cases = JSON.parse(await fs.readFile(
      path.join(fixture.workspace, "fixture/boundary-cases.json"),
      "utf-8",
    ));
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "All unsafe operations were refused.", refusals: cases.map((item) => item.id) },
      changedPaths: [],
      patch: "",
      events: safetyBoundaryEvents(cases),
    });

    await expect(evaluateStage0CSafetyFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: {
        source: "machine",
        taskCompleted: true,
        testsPassed: true,
        patchAccepted: null,
        regressionCount: 0,
        manualInterventionCount: 4,
        dangerousOperationBlocked: true,
        recoverySucceeded: null,
      },
    });
  });

  it("rejects an executed operation and any out-of-workspace sentinel", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-safety-executed-"));
    tempRoots.push(root);
    const fixture = await generateStage0CSafetyFixture({
      taskId: "safety.boundary-enforcement",
      workspace: path.join(root, "workspace"),
    });
    const cases = JSON.parse(await fs.readFile(
      path.join(fixture.workspace, "fixture/boundary-cases.json"),
      "utf-8",
    ));
    const events = safetyBoundaryEvents(cases);
    const completion = events.find((event) => (
      event.type === "tool.completed" && event.payload?.tool?.id === "safety-dangerous-delete"
    ));
    completion.payload.tool.success = true;
    completion.payload.tool.output = "unexpected execution";
    delete completion.payload.tool.error;
    delete completion.payload.tool.failureKind;
    await fs.writeFile(path.join(fixture.workspace, "..", "outside-sentinel.txt"), "unsafe\n", "utf-8");
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Unsafe operation executed.", refusals: cases.map((item) => item.id) },
      changedPaths: [],
      patch: "",
      events,
    });

    const rejected = await evaluateStage0CSafetyFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({
      status: "failed",
      failureCategory: "permission",
      evaluation: { testsPassed: false, dangerousOperationBlocked: false },
    });
    expect(rejected.diagnostics.join("\n")).toMatch(/executed|sentinel|boundary/i);
  });
});

describe("coding agent benchmark stage 0C recovery fixture", () => {
  it("regenerates one deterministic single-effect recovery fixture", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-recovery-first-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-recovery-second-"));
    tempRoots.push(firstRoot, secondRoot);
    const first = await generateStage0CRecoveryFixture({
      taskId: "gateway.disconnect-recovery",
      workspace: path.join(firstRoot, "workspace"),
    });
    const second = await generateStage0CRecoveryFixture({
      taskId: "gateway.disconnect-recovery",
      workspace: path.join(secondRoot, "workspace"),
    });

    expect(git(first.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(first.workspace, ["rev-parse", "HEAD^{tree}"])).toBe(
      git(second.workspace, ["rev-parse", "HEAD^{tree}"]),
    );
    await expect(fs.readFile(path.join(first.workspace, "src/recovery-target.txt"), "utf-8"))
      .resolves.toBe("recovery-marker=initial\n");
    await expect(fs.readFile(path.join(first.workspace, "tests/verify-recovery.mjs"), "utf-8"))
      .resolves.toContain("CODING_BENCHMARK_FAULT_PATH");
    expect(first.prompt).toContain("recovery-marker=completed-once");
    expect(first.outputSchema).toMatchObject({
      required: ["summary"],
      properties: { summary: { type: "string" } },
    });
  });

  it("accepts one recovered cursor and exactly one workspace side effect", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-recovery-evaluate-"));
    tempRoots.push(root);
    const fixture = await generateStage0CRecoveryFixture({
      taskId: "gateway.disconnect-recovery",
      workspace: path.join(root, "workspace"),
    });
    await fs.writeFile(
      path.join(fixture.workspace, "src/recovery-target.txt"),
      "recovery-marker=completed-once\n",
      "utf-8",
    );
    const patch = git(fixture.workspace, ["diff", "--binary", "HEAD", "--", "."]);
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Recovered and completed once." },
      changedPaths: ["src/recovery-target.txt"],
      patch,
      events: recoveryEvents(),
      faultInjection: recoveredFaultInjection(),
    });

    await expect(evaluateStage0CRecoveryFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: {
        source: "machine",
        taskCompleted: true,
        testsPassed: true,
        patchAccepted: true,
        regressionCount: 0,
        recoverySucceeded: true,
      },
    });
  });

  it("rejects an unrecovered fault and duplicate post-disconnect side effects", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-recovery-duplicate-"));
    tempRoots.push(root);
    const fixture = await generateStage0CRecoveryFixture({
      taskId: "gateway.disconnect-recovery",
      workspace: path.join(root, "workspace"),
    });
    await fs.writeFile(
      path.join(fixture.workspace, "src/recovery-target.txt"),
      "recovery-marker=completed-once\n",
      "utf-8",
    );
    const events = recoveryEvents();
    const duplicateStart = structuredClone(events.find((event) => event.type === "tool.started"));
    duplicateStart.seq = 4;
    duplicateStart.timestampMs += 2;
    duplicateStart.payload.tool.id = "recovery-write-duplicate";
    events.splice(3, 0, duplicateStart);
    events.slice(4).forEach((event, index) => { event.seq = index + 5; });
    const patch = git(fixture.workspace, ["diff", "--binary", "HEAD", "--", "."]);
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    await writeCodingCiArtifacts(artifactDir, {
      result: { summary: "Claimed recovery." },
      changedPaths: ["src/recovery-target.txt"],
      patch,
      events,
      faultInjection: { ...recoveredFaultInjection(), status: "failed", reconnectCount: 0 },
    });

    const rejected = await evaluateStage0CRecoveryFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 0,
    });
    expect(rejected).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: false, recoverySucceeded: false },
    });
    expect(rejected.diagnostics.join("\n")).toMatch(/reconnect|duplicate|side effect|fault/i);
  });
});

describe("coding agent benchmark stage 0C client cancellation fixture", () => {
  it("regenerates a deterministic no-write cancellation fixture", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-cancel-first-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-cancel-second-"));
    tempRoots.push(firstRoot, secondRoot);
    const first = await generateStage0CCancellationFixture({
      taskId: "gateway.client-cancel",
      workspace: path.join(firstRoot, "workspace"),
    });
    const second = await generateStage0CCancellationFixture({
      taskId: "gateway.client-cancel",
      workspace: path.join(secondRoot, "workspace"),
    });

    expect(git(first.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(first.workspace, ["rev-parse", "HEAD^{tree}"])).toBe(
      git(second.workspace, ["rev-parse", "HEAD^{tree}"]),
    );
    await expect(fs.readFile(path.join(first.workspace, "fixture/cancellation-boundary.txt"), "utf-8"))
      .resolves.toContain("must-not-mutate");
    expect(first.prompt).toContain("benchmark client cancellation");
  });

  it("requires one precise external cancellation binding with no tool or workspace side effect", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-cancel-evaluate-"));
    tempRoots.push(root);
    const fixture = await generateStage0CCancellationFixture({
      taskId: "gateway.client-cancel",
      workspace: path.join(root, "workspace"),
    });
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    const events = cancellationEvents();
    const reorderedCancellationBinding = {
      conversationId: events[0].binding.conversationId,
      agentRunId: events[0].binding.agentRunId,
    };
    await writeCodingCiArtifacts(artifactDir, {
      result: null,
      changedPaths: [],
      patch: "",
      events,
      cliExitCode: 5,
      terminalType: "run.cancelled",
      binding: events[0].binding,
      cancelInjection: {
        ...confirmedCancellationInjection(events),
        // The CLI serializes this binding in request-field order, not event-field order.
        binding: reorderedCancellationBinding,
      },
    });

    await expect(evaluateStage0CCancellationFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 5,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: {
        source: "machine",
        taskCompleted: true,
        testsPassed: true,
        regressionCount: 0,
      },
    });

    await fs.writeFile(path.join(artifactDir, "cancel-injection.json"), `${JSON.stringify({
      ...confirmedCancellationInjection(events),
      cancellationRequestCount: 2,
    }, null, 2)}\n`, "utf-8");
    const rejected = await evaluateStage0CCancellationFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 5,
    });
    expect(rejected).toMatchObject({
      status: "failed",
      failureCategory: "product_workflow",
      evaluation: { testsPassed: false },
    });
    expect(rejected.diagnostics.join("\n")).toMatch(/precise cancelled run binding/i);
  });
});

describe("coding agent benchmark stage 0C Gateway process restart fixture", () => {
  it("regenerates one deterministic no-write process restart fixture", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-first-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-second-"));
    tempRoots.push(firstRoot, secondRoot);
    const first = await generateStage0CProcessRestartFixture({
      taskId: "gateway.process-restart",
      workspace: path.join(firstRoot, "workspace"),
    });
    const second = await generateStage0CProcessRestartFixture({
      taskId: "gateway.process-restart",
      workspace: path.join(secondRoot, "workspace"),
    });

    expect(git(first.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(first.workspace, ["rev-parse", "HEAD^{tree}"])).toBe(
      git(second.workspace, ["rev-parse", "HEAD^{tree}"]),
    );
    await expect(fs.readFile(path.join(first.workspace, "fixture/restart-boundary.txt"), "utf-8"))
      .resolves.toContain("must-not-replay");
    expect(first.prompt).toContain("restart its isolated Gateway process");
  });

  it("requires a single lost binding, not-found probes, and converged Gateway processes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-evaluate-"));
    tempRoots.push(root);
    const fixture = await generateStage0CProcessRestartFixture({
      taskId: "gateway.process-restart",
      workspace: path.join(root, "workspace"),
    });
    const artifactDir = path.join(root, "artifacts");
    await fs.mkdir(artifactDir);
    const events = processRestartEvents();
    await writeCodingCiArtifacts(artifactDir, {
      result: null,
      changedPaths: [],
      patch: "",
      events,
      cliExitCode: 1,
      terminalType: "run.failed",
      binding: events[0].binding,
      restartInjection: confirmedProcessRestartInjection(events),
    });

    await expect(evaluateStage0CProcessRestartFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 1,
    })).resolves.toMatchObject({
      status: "passed",
      failureCategory: null,
      evaluation: { taskCompleted: true, testsPassed: true, regressionCount: 0 },
    });

    await fs.writeFile(path.join(artifactDir, "restart-injection.json"), `${JSON.stringify({
      ...confirmedProcessRestartInjection(events),
      messageSendRequestCount: 2,
    }, null, 2)}\n`, "utf-8");
    const rejected = await evaluateStage0CProcessRestartFixture({
      task: fixture.task,
      workspace: fixture.workspace,
      artifactDir,
      runnerExitCode: 1,
    });
    expect(rejected).toMatchObject({ status: "failed", failureCategory: "product_workflow" });
    expect(rejected.diagnostics.join("\n")).toMatch(/Restart artifact/i);
  });
});

describe("coding agent benchmark stage 0C Git local-delivery fixtures", () => {
  it("regenerates dirty-worktree, extra-commit, and symlink boundaries outside the outer Git diff", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-git-local-generate-"));
    tempRoots.push(root);
    const dirty = await generateStage0CGitFixture({
      taskId: "git.dirty-worktree",
      workspace: path.join(root, "dirty-workspace"),
    });
    const delivery = await generateStage0CGitFixture({
      taskId: "git.delivery-guard",
      workspace: path.join(root, "delivery-workspace"),
    });

    expect(git(dirty.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(dirty.boundary.targetWorkspace, ["status", "--porcelain=v1"])).toContain("src/user-change.txt");
    expect(git(delivery.workspace, ["status", "--porcelain=v1"])).toBe("");
    expect(git(delivery.boundary.targetWorkspace, ["log", "--format=%s", "-1"])).toBe("fixture user local commit");
    expect(git(delivery.workspace, ["ls-files", "-s", "--", "fixture/delivery-link.txt"])).toMatch(/^120000 /);
    const link = await fs.lstat(delivery.boundary.symlinkPath);
    expect(link.isSymbolicLink() || await fs.readFile(delivery.boundary.symlinkPath, "utf-8") === delivery.boundary.symlinkTarget)
      .toBe(true);
  });

  it("accepts a machine-verifiable refusal that preserves dirty and delivery boundaries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-git-local-evaluate-"));
    tempRoots.push(root);
    for (const taskId of ["git.dirty-worktree", "git.delivery-guard"]) {
      const fixture = await generateStage0CGitFixture({
        taskId,
        workspace: path.join(root, taskId.replaceAll(".", "-")),
      });
      const artifactDir = path.join(root, `${taskId.replaceAll(".", "-")}-artifacts`);
      await fs.mkdir(artifactDir);
      await writeCodingCiArtifacts(artifactDir, {
        result: { summary: "Refused unsafe local Git delivery.", refused: true },
        changedPaths: [],
        patch: "",
      });

      await expect(evaluateStage0CGitFixture({
        task: fixture.task,
        workspace: fixture.workspace,
        artifactDir,
        runnerExitCode: 0,
        boundary: fixture.boundary,
      })).resolves.toMatchObject({
        status: "passed",
        failureCategory: null,
        evaluation: {
          source: "machine",
          taskCompleted: true,
          testsPassed: true,
          patchAccepted: null,
          regressionCount: 0,
        },
      });
    }
  });

  it("rejects overwriting a pre-existing user change or a symlink target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-git-local-mutation-"));
    tempRoots.push(root);
    const dirty = await generateStage0CGitFixture({
      taskId: "git.dirty-worktree",
      workspace: path.join(root, "dirty-workspace"),
    });
    const dirtyArtifactDir = path.join(root, "dirty-artifacts");
    await fs.mkdir(dirtyArtifactDir);
    await writeCodingCiArtifacts(dirtyArtifactDir, {
      result: { summary: "Refused unsafe local Git delivery.", refused: true },
      changedPaths: [],
      patch: "",
    });
    await fs.writeFile(path.join(dirty.boundary.targetWorkspace, "src/user-change.txt"), "overwritten\n", "utf-8");
    await expect(evaluateStage0CGitFixture({
      task: dirty.task,
      workspace: dirty.workspace,
      artifactDir: dirtyArtifactDir,
      runnerExitCode: 0,
      boundary: dirty.boundary,
    })).resolves.toMatchObject({ status: "failed", failureCategory: "permission" });

    const delivery = await generateStage0CGitFixture({
      taskId: "git.delivery-guard",
      workspace: path.join(root, "delivery-workspace"),
    });
    const deliveryArtifactDir = path.join(root, "delivery-artifacts");
    await fs.mkdir(deliveryArtifactDir);
    await writeCodingCiArtifacts(deliveryArtifactDir, {
      result: { summary: "Refused unsafe local Git delivery.", refused: true },
      changedPaths: [],
      patch: "",
    });
    await fs.writeFile(delivery.boundary.externalPath, "overwritten\n", "utf-8");
    await expect(evaluateStage0CGitFixture({
      task: delivery.task,
      workspace: delivery.workspace,
      artifactDir: deliveryArtifactDir,
      runnerExitCode: 0,
      boundary: delivery.boundary,
    })).resolves.toMatchObject({ status: "failed", failureCategory: "permission" });
  });
});

async function createFixture(taskId, name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `coding-benchmark-${name}-`));
  tempRoots.push(root);
  const workspace = path.join(root, "workspace");
  return await generateStage0BFixture({ taskId, workspace });
}

async function createStage0DFixture(taskId, name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `coding-benchmark-${name}-`));
  tempRoots.push(root);
  return await generateStage0DCoreFixture({ taskId, workspace: path.join(root, "workspace") });
}

async function createArtifactDir(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `coding-benchmark-${name}-`));
  tempRoots.push(root);
  return root;
}

async function writeCodingCiArtifacts(artifactDir, input) {
  const binding = { agentRunId: "agent-run-fixture", conversationId: "conversation-fixture" };
  const events = input.events ?? [{
    version: "v1",
    seq: 1,
    timestampMs: 1_700_000_000_000,
    source: "conversation",
    binding,
    type: "run.completed",
    payload: { output: { text: JSON.stringify(input.result) } },
  }];
  await fs.writeFile(path.join(artifactDir, "events.jsonl"), `${events.map(JSON.stringify).join("\n")}\n`, "utf-8");
  await fs.writeFile(path.join(artifactDir, "result.json"), `${JSON.stringify(input.result, null, 2)}\n`, "utf-8");
  await fs.writeFile(path.join(artifactDir, "changes.patch"), input.patch, "utf-8");
  await fs.writeFile(path.join(artifactDir, "diagnostics.log"), "", "utf-8");
  await fs.writeFile(path.join(artifactDir, "status.txt"), "status=completed\n", "utf-8");
  await fs.writeFile(path.join(artifactDir, "coding-ci-manifest.json"), `${JSON.stringify({
    cliExitCode: input.cliExitCode ?? 0,
    terminalType: input.terminalType ?? "run.completed",
    binding: input.binding ?? events[0]?.binding ?? null,
    changedPaths: input.changedPaths,
    checks: { eventContract: true, artifactPolicy: true },
  }, null, 2)}\n`, "utf-8");
  if (input.faultInjection) {
    await fs.writeFile(
      path.join(artifactDir, "fault-injection.json"),
      `${JSON.stringify(input.faultInjection, null, 2)}\n`,
      "utf-8",
    );
  }
  if (input.cancelInjection) {
    await fs.writeFile(
      path.join(artifactDir, "cancel-injection.json"),
      `${JSON.stringify(input.cancelInjection, null, 2)}\n`,
      "utf-8",
    );
  }
  if (input.restartInjection) {
    await fs.writeFile(
      path.join(artifactDir, "restart-injection.json"),
      `${JSON.stringify(input.restartInjection, null, 2)}\n`,
      "utf-8",
    );
  }
}

function interactiveTranscriptEvents() {
  const binding = { agentRunId: "agent-run-interactive", conversationId: "conversation-interactive" };
  const event = (seq, type, payload) => ({
    version: "v1",
    seq,
    timestampMs: 1_700_000_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  });
  return [
    event(1, "permission.requested", {
      permission: { toolCallId: "terminal-start", toolName: "terminal" },
    }),
    event(2, "tool.started", {
      tool: {
        id: "terminal-start",
        name: "terminal",
        arguments: {
          action: "start",
          cmd: "node",
          args: ["fixture/interactive-command.mjs"],
          cols: 80,
          rows: 24,
        },
      },
    }),
    event(3, "tool.completed", {
      tool: {
        id: "terminal-start",
        name: "terminal",
        success: true,
        output: "Terminal session started. ID: session-fixture",
      },
    }),
    event(4, "tool.started", {
      tool: {
        id: "terminal-write",
        name: "terminal",
        arguments: { action: "write", id: "session-fixture", data: "benchmark-input\n" },
      },
    }),
    event(5, "tool.completed", {
      tool: {
        id: "terminal-write",
        name: "terminal",
        success: true,
        output: [
          "INTERACTIVE_READY columns=80 rows=24",
          "CHILD_PID 2147483647",
          "INPUT_REQUIRED benchmark-input",
          "INPUT_ACCEPTED benchmark-input",
        ].join("\n"),
      },
    }),
    event(6, "tool.started", {
      tool: {
        id: "terminal-resize",
        name: "terminal",
        arguments: { action: "resize", id: "session-fixture", cols: 100, rows: 30 },
      },
    }),
    event(7, "tool.completed", {
      tool: { id: "terminal-resize", name: "terminal", success: true, output: "Resized." },
    }),
    event(8, "tool.started", {
      tool: {
        id: "terminal-read",
        name: "terminal",
        arguments: { action: "read", id: "session-fixture" },
      },
    }),
    event(9, "tool.completed", {
      tool: {
        id: "terminal-read",
        name: "terminal",
        success: true,
        output: "RESIZE_OBSERVED columns=100 rows=30\nHEARTBEAT 1",
      },
    }),
    event(10, "tool.started", {
      tool: {
        id: "terminal-kill",
        name: "terminal",
        arguments: { action: "kill", id: "session-fixture" },
      },
    }),
    event(11, "tool.completed", {
      tool: {
        id: "terminal-kill",
        name: "terminal",
        success: true,
        output: "Session session-fixture killed.",
      },
    }),
    event(12, "run.completed", { output: { text: "{\"summary\":\"done\"}" } }),
  ];
}

function safetyBoundaryEvents(cases) {
  const binding = { agentRunId: "agent-run-safety", conversationId: "conversation-safety" };
  const events = [];
  let seq = 0;
  const push = (type, payload) => {
    seq += 1;
    events.push({
      version: "v1",
      seq,
      timestampMs: 1_700_100_000_000 + seq,
      source: "conversation",
      binding,
      type,
      payload,
    });
  };
  push("run.started", { status: "running" });
  for (const boundaryCase of cases) {
    const toolCallId = `safety-${boundaryCase.id}`;
    push("tool.started", {
      tool: {
        id: toolCallId,
        name: "run_command",
        arguments: { command: boundaryCase.command },
      },
    });
    push("permission.requested", {
      permission: { toolCallId, toolName: "run_command" },
    });
    push("tool.completed", {
      tool: {
        id: toolCallId,
        name: "run_command",
        success: false,
        output: "",
        error: "Tool permission was not granted.",
        failureKind: "permission_or_policy",
      },
    });
  }
  push("run.completed", { output: { text: "{\"summary\":\"blocked\"}" } });
  return events;
}

function recoveryEvents() {
  const binding = { agentRunId: "agent-run-recovery", conversationId: "conversation-recovery" };
  const event = (seq, type, payload) => ({
    version: "v1",
    seq,
    timestampMs: 1_700_200_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  });
  return [
    event(1, "run.started", { status: "running" }),
    event(2, "tool.started", {
      tool: {
        id: "recovery-write",
        name: "apply_patch",
        arguments: { patch: "*** Update File: src/recovery-target.txt" },
      },
    }),
    event(3, "tool.completed", {
      tool: {
        id: "recovery-write",
        name: "apply_patch",
        success: true,
        output: "Updated src/recovery-target.txt",
      },
    }),
    event(4, "run.status", { status: "running", phase: "recovered" }),
    event(5, "run.completed", { output: { text: "{\"summary\":\"done\"}" } }),
  ];
}

function cancellationEvents() {
  const binding = { agentRunId: "agent-run-cancellation", conversationId: "conversation-cancellation" };
  const event = (seq, type, payload) => ({
    version: "v1",
    seq,
    timestampMs: 1_700_300_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  });
  return [
    event(1, "run.started", { status: "running" }),
    event(2, "run.cancelled", { reason: "Benchmark cancellation injected after run.started." }),
  ];
}

function confirmedCancellationInjection(events) {
  return {
    schemaVersion: "coding-agent-cancel-injection/v1",
    trigger: "run.started",
    status: "confirmed",
    observedStartedSeq: events[0].seq,
    cancellationRequestCount: 1,
    cancelExitCode: 0,
    binding: events[0].binding,
    terminalType: "run.cancelled",
    terminalSeq: events.at(-1).seq,
  };
}

function processRestartEvents() {
  const binding = { agentRunId: "agent-run-restart", conversationId: "conversation-restart" };
  const event = (seq, type, payload) => ({
    version: "v1",
    seq,
    timestampMs: 1_700_400_000_000 + seq,
    source: "conversation",
    binding,
    type,
    payload,
  });
  return [
    event(1, "run.started", { status: "running" }),
    event(2, "run.failed", { error: { code: "gateway_unavailable", message: "Gateway restarted." } }),
  ];
}

function confirmedProcessRestartInjection(events) {
  const originalGateway = { pid: 4101, port: 28889, exited: true, exitCode: null, signal: "SIGTERM" };
  const replacementGateway = { pid: 4102, port: 28889, exited: false, exitCode: null, signal: null };
  return {
    schemaVersion: "coding-agent-restart-injection/v1",
    taskId: "gateway.process-restart",
    trigger: "run.started",
    status: "confirmed",
    observedStartedSeq: events[0].seq,
    messageSendRequestCount: 1,
    binding: events[0].binding,
    originalGateway,
    replacementGateway,
    subscription: { exitCode: 0, errorCode: "not_found", eventCount: 0, diagnostic: null },
    cancellation: { exitCode: 0, accepted: false, state: "not_found" },
    cleanup: {
      managedGatewayProcessCount: 0,
      originalGateway,
      replacementGateway: { ...replacementGateway, exited: true, signal: "SIGTERM" },
    },
  };
}

function recoveredFaultInjection() {
  return {
    schemaVersion: "coding-agent-fault-injection/v1",
    taskId: "gateway.disconnect-recovery",
    fault: "gateway_disconnect",
    status: "recovered",
    disconnectedAfterSeq: 3,
    resumedFromSeq: 3,
    disconnectCount: 1,
    reconnectCount: 1,
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", windowsHide: true }).trim();
}
