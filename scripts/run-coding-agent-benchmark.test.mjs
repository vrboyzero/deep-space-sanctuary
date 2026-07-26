import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startGatewayServer } from "../packages/belldandy-core/src/server.ts";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
} from "../packages/belldandy-core/src/server-testkit.ts";
import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

import {
  extractBenchmarkTokenUsage,
  resolveBenchmarkRuntimePlatform,
  runStage0BSuite,
} from "./run-coding-agent-benchmark.mjs";
import { runCodingRunSubscriptionProbe } from "./coding-agent-process-restart-harness.mjs";

const tempRoots = [];
const windowsIt = process.platform === "win32" ? it : it.skip;

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark stage 0B runner", () => {
  it("keeps the subscription probe stdin open until its matching response arrives", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-subscription-probe-"));
    tempRoots.push(root);
    const bddEntry = path.join(root, "delayed-bdd.mjs");
    await fs.writeFile(bddEntry, [
      "let ended = false;",
      "let responded = false;",
      "process.stdin.on('end', () => { ended = true; if (!responded) { process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: 'coding-benchmark-restart-subscription', ok: false, error: { code: 'gateway_unavailable' } }) + '\\n'); } });",
      "process.stdin.once('data', () => { setTimeout(() => { if (ended) return; responded = true; process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: 'coding-benchmark-restart-subscription', ok: false, error: { code: 'not_found' } }) + '\\n'); }, 50); });",
    ].join("\n"), "utf-8");

    await expect(runCodingRunSubscriptionProbe({
      bddEntry,
      cwd: root,
      stateDir: root,
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      env: {},
    })).resolves.toMatchObject({ exitCode: 0, errorCode: "not_found", eventCount: 0 });
  });

  it("redacts pairing codes from subscription probe diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-restart-subscription-redaction-"));
    tempRoots.push(root);
    const bddEntry = path.join(root, "pairing-bdd.mjs");
    await fs.writeFile(bddEntry, [
      "process.stdin.once('data', () => { process.stdout.write(JSON.stringify({ version: 'v1', type: 'subscription.response', id: 'coding-benchmark-restart-subscription', ok: false, error: { code: 'pairing_required', message: 'Pairing required. Code: PAIR1234' } }) + '\\n'); });",
    ].join("\n"), "utf-8");

    await expect(runCodingRunSubscriptionProbe({
      bddEntry,
      cwd: root,
      stateDir: root,
      binding: { conversationId: "conversation-1", agentRunId: "run-1" },
      env: {},
    })).resolves.toMatchObject({
      errorCode: "pairing_required",
      diagnostic: "Pairing required. Code: [REDACTED]",
    });
  });

  it("accepts only a matching Windows native or WSL2 runtime fingerprint", () => {
    expect(resolveBenchmarkRuntimePlatform({ platform: "windows-native" }, {
      platform: "win32",
      osRelease: "10.0.26100",
      env: {},
    })).toEqual({ id: "windows-native", wsl: null });
    expect(resolveBenchmarkRuntimePlatform({ platform: "wsl2-linux" }, {
      platform: "linux",
      osRelease: "6.6.87.2-microsoft-standard-WSL2",
      env: { WSL_DISTRO_NAME: "Ubuntu-22.04" },
    })).toEqual({
      id: "wsl2-linux",
      wsl: { distribution: "Ubuntu-22.04", version: 2 },
    });
    expect(() => resolveBenchmarkRuntimePlatform({ platform: "wsl2-linux" }, {
      platform: "linux",
      osRelease: "6.8.0-generic",
      env: {},
    })).toThrow(/WSL2/i);
    expect(() => resolveBenchmarkRuntimePlatform({ platform: "windows-native" }, {
      platform: "linux",
      osRelease: "6.8.0-generic",
      env: {},
    })).toThrow(/Windows native/i);
  });

  it("uses the last cumulative usage event and preserves unavailable tokens as null", () => {
    expect(extractBenchmarkTokenUsage([
      { type: "run.usage", payload: { usage: { inputTokens: 10, outputTokens: 4 } } },
      { type: "run.usage", payload: { usage: { inputTokens: 25, outputTokens: 9 } } },
    ])).toEqual({ inputTokens: 25, outputTokens: 9 });
    expect(extractBenchmarkTokenUsage([])).toEqual({ inputTokens: null, outputTokens: null });
  });

  windowsIt("runs the three explicit stage 0D core tasks through their frozen profiles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0d-core-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["feature.cross-file", "tests.failed-diagnosis", "navigation.large-repository"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: {
        "feature.cross-file": "cross-file-windows-a1-test",
        "tests.failed-diagnosis": "failed-diagnosis-windows-a1-test",
        "navigation.large-repository": "large-navigation-windows-a1-test",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "stage 0D core unavailable" };
      },
    });

    expect(invocations.map((input) => input.mode)).toEqual([
      "workspace-write",
      "command-control",
      "plan",
    ]);
    expect(report.runs.map((run) => [run.taskId, run.execution.profile, run.failureCategory])).toEqual([
      ["feature.cross-file", "workspace-write", "product_workflow"],
      ["tests.failed-diagnosis", "command-control", "product_workflow"],
      ["navigation.large-repository", "plan", "product_workflow"],
    ]);
  });

  windowsIt("runs one explicitly selected stage 0C interactive task through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-interactive-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["command.interactive-control"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "command.interactive-control": "interactive-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "interactive control unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "command-control" });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "command.interactive-control",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "command-control" },
      evaluation: { testsPassed: false, patchAccepted: null },
    });
  });

  windowsIt("runs one explicitly selected stage 0C safety task through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-safety-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["safety.boundary-enforcement"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "safety.boundary-enforcement": "safety-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "safety boundary unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "safety-probe" });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "safety.boundary-enforcement",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "safety-probe" },
      evaluation: {
        testsPassed: false,
        patchAccepted: null,
        dangerousOperationBlocked: false,
      },
    });
  });

  windowsIt("runs one explicitly selected stage 0C recovery task through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-recovery-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.disconnect-recovery"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.disconnect-recovery": "recovery-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeRecoveryCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "recovery control unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "recovery-control" });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "gateway.disconnect-recovery",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "recovery-control" },
      evaluation: {
        testsPassed: false,
        patchAccepted: false,
        dangerousOperationBlocked: null,
        recoverySucceeded: false,
      },
    });
  });

  windowsIt("runs one explicitly selected stage 0C client cancellation task with exact cancel injection enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-cancel-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.client-cancel"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.client-cancel": "cancel-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 5, stdout: "", stderr: "cancellation artifact unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "plan", cancelOnRunStart: true });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({
      taskId: "gateway.client-cancel",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "plan" },
      evaluation: { testsPassed: false, patchAccepted: null },
      artifacts: { cancelInjection: "cancel-windows-a1-test/cancel-injection.json" },
    });
    await expect(fs.readFile(
      path.join(root, "artifacts", "cancel-windows-a1-test", "cancel-injection.json"),
      "utf-8",
    )).resolves.toContain('"status": "not_observed"');
  });

  windowsIt("runs one explicitly selected stage 0C process restart task through the restart artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-restart-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.process-restart"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.process-restart": "restart-windows-a1-test" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeProcessRestartCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "restart artifact unavailable" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({ mode: "plan" });
    expect(report.runs[0]).toMatchObject({
      taskId: "gateway.process-restart",
      status: "failed",
      failureCategory: "product_workflow",
      execution: { profile: "plan" },
      evaluation: { testsPassed: false, patchAccepted: null },
      artifacts: { restartInjection: "restart-windows-a1-test/restart-injection.json" },
    });
    await expect(fs.readFile(
      path.join(root, "artifacts", "restart-windows-a1-test", "restart-injection.json"),
      "utf-8",
    )).resolves.toContain('"status": "not_injected"');
  });

  windowsIt("records a lost old binding after a real controlled Gateway process restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-process-restart-integration-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const runId = "process-restart-windows-integration";

    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["gateway.process-restart"],
      fixtureRoot,
      artifactRoot,
      stateRoot,
      attempt: 1,
      runIds: { "gateway.process-restart": runId },
      model: { provider: "fixture", id: "gateway-restart-fixture", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    });

    const runDir = path.join(artifactRoot, runId);
    const diagnostics = await fs.readFile(path.join(runDir, "diagnostics.log"), "utf-8");
    const restartDiagnostic = await fs.readFile(path.join(runDir, "restart-injection.json"), "utf-8");
    expect(report.runs, `${diagnostics}\n${restartDiagnostic}`).toEqual([expect.objectContaining({
      taskId: "gateway.process-restart",
      status: "passed",
      failureCategory: null,
      evaluation: expect.objectContaining({
        taskCompleted: true,
        testsPassed: true,
        regressionCount: 0,
      }),
    })]);
    const restart = JSON.parse(await fs.readFile(path.join(runDir, "restart-injection.json"), "utf-8"));
    const events = (await fs.readFile(path.join(runDir, "events.jsonl"), "utf-8"))
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    expect(restart).toMatchObject({
      status: "confirmed",
      observedStartedSeq: 1,
      messageSendRequestCount: 1,
      subscription: { errorCode: "not_found", eventCount: 0 },
      cancellation: { accepted: false, state: "not_found" },
      cleanup: {
        managedGatewayProcessCount: 0,
        originalGateway: { exited: true },
        replacementGateway: { exited: true },
      },
    });
    expect(restart.originalGateway.pid).not.toBe(restart.replacementGateway.pid);
    expect(events.map((event) => event.type)).toEqual(["run.started", "run.failed"]);
    expect(events.at(-1)).toMatchObject({ payload: { error: { code: "gateway_unavailable" } } });
    await expect(fs.readFile(path.join(runDir, "changes.patch"), "utf-8")).resolves.toBe("");
  }, 30_000);

  windowsIt("runs both explicitly selected stage 0C Git local-delivery tasks through the shared artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-git-local-"));
    tempRoots.push(root);
    const invocations = [];
    const report = await runStage0BSuite({
      platform: "windows-native",
      taskIds: ["git.dirty-worktree", "git.delivery-guard"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: {
        "git.dirty-worktree": "git-dirty-windows-a1-test",
        "git.delivery-guard": "git-delivery-windows-a1-test",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-26T00:00:00.000Z",
    }, {
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "git local delivery unavailable" };
      },
    });

    expect(invocations).toHaveLength(2);
    expect(invocations.map((input) => input.mode)).toEqual(["git-local", "git-local"]);
    expect(report.runs).toHaveLength(2);
    expect(report.runs.map((run) => run.taskId)).toEqual(["git.dirty-worktree", "git.delivery-guard"]);
    expect(report.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "failed",
        failureCategory: "product_workflow",
        execution: expect.objectContaining({ profile: "git-local" }),
        evaluation: expect.objectContaining({ testsPassed: true, patchAccepted: null }),
      }),
    ]));
  });

  windowsIt("recovers a real Gateway run from the injected Headless disconnect without replaying the write", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0c-recovery-integration-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const runId = "recovery-windows-integration";
    let writeCount = 0;
    const agent = {
      async *run(input) {
        expect(input.meta?._agentLaunchSpec).toMatchObject({
          permissionMode: "acceptEdits",
          toolDeny: ["run_command", "spawn_subagent", "file_delete"],
        });
        yield { type: "status", status: "running" };
        yield {
          type: "tool_call",
          id: "recovery-write-1",
          name: "file_write",
          arguments: { path: "src/recovery-target.txt", content: "recovery-marker=completed-once\n" },
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
        writeCount += 1;
        await fs.writeFile(
          path.join(fixtureRoot, runId, "workspace", "src/recovery-target.txt"),
          "recovery-marker=completed-once\n",
          "utf-8",
        );
        yield {
          type: "tool_result",
          id: "recovery-write-1",
          name: "file_write",
          success: true,
          output: "updated",
        };
        yield { type: "final", text: JSON.stringify({ summary: "Recovered once." }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir: stateRoot,
      agentFactory: () => agent,
    });

    try {
      const report = await runStage0BSuite({
        platform: "windows-native",
        taskIds: ["gateway.disconnect-recovery"],
        fixtureRoot,
        artifactRoot,
        stateRoot,
        attempt: 1,
        runIds: { "gateway.disconnect-recovery": runId },
        model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
        generatedAt: "2026-07-26T00:00:00.000Z",
        childEnv: {
          BELLDANDY_HOST: "127.0.0.1",
          BELLDANDY_PORT: String(server.port),
          BELLDANDY_AUTH_MODE: "none",
        },
      });

      expect(writeCount).toBe(1);
      const diagnostics = await fs.readFile(path.join(artifactRoot, runId, "diagnostics.log"), "utf-8");
      expect(diagnostics).toBe("");
      expect(report.runs[0]).toMatchObject({
        taskId: "gateway.disconnect-recovery",
        status: "passed",
        failureCategory: null,
        evaluation: {
          taskCompleted: true,
          testsPassed: true,
          patchAccepted: true,
          recoverySucceeded: true,
        },
      });
      const fault = JSON.parse(await fs.readFile(
        path.join(artifactRoot, runId, "fault-injection.json"),
        "utf-8",
      ));
      expect(fault).toMatchObject({
        status: "recovered",
        disconnectCount: 1,
        reconnectCount: 1,
      });
    } finally {
      await server.close();
    }
  }, 30_000);

  windowsIt("runs both Windows tracer bullets through the real Gateway and Coding CI artifact chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-stage0b-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const gatewayState = path.join(root, "gateway-state");
    const runIds = {
      "rules.nested-precedence": "rules-windows-a1-test",
      "bug.reproducible-fix": "bug-windows-a1-test",
    };
    const invocationPrompts = [];
    const agent = {
      async *run(input) {
        invocationPrompts.push({
          conversationId: input?.conversationId ?? null,
          text: input?.text ?? null,
        });
        if (input?.text?.includes("nested workspace")) {
          yield {
            type: "final",
            text: JSON.stringify({
              ruleValue: "nested",
              sourcePath: "packages/demo/AGENTS.md",
            }),
          };
          return;
        }
        if (!input?.text?.includes("reported logic bug")) {
          throw new Error("Unexpected benchmark fixture prompt.");
        }
        await fs.writeFile(
          path.join(fixtureRoot, runIds["bug.reproducible-fix"], "workspace", "src/calculate.mjs"),
          [
            "export function calculateInvoiceTotal(items) {",
            "  return items.reduce((total, item) => total + (item.price * item.quantity), 0);",
            "}",
            "",
          ].join("\n"),
          "utf-8",
        );
        yield {
          type: "final",
          text: JSON.stringify({ summary: "Fixed quantity-aware invoice totals." }),
        };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir: gatewayState,
      agentFactory: () => agent,
    });

    try {
      const report = await runStage0BSuite({
        fixtureRoot,
        artifactRoot,
        stateRoot: gatewayState,
        runIds,
        generatedAt: "2026-07-25T16:30:00.000Z",
        model: {
          provider: "fixture-provider",
          id: "fixture-model",
          credentialsConfigured: false,
        },
        childEnv: {
          BELLDANDY_HOST: "127.0.0.1",
          BELLDANDY_PORT: String(server.port),
          BELLDANDY_AUTH_MODE: "none",
        },
      });

      const integrationDiagnostics = await Promise.all(Object.values(runIds).map(async (runId) => {
        return await fs.readFile(path.join(artifactRoot, runId, "diagnostics.log"), "utf-8");
      }));
      expect(
        invocationPrompts.some((item) => item.text?.includes("nested workspace")),
        integrationDiagnostics.join("\n---\n"),
      ).toBe(true);
      expect(
        invocationPrompts.some((item) => item.text?.includes("reported logic bug")),
        integrationDiagnostics.join("\n---\n"),
      ).toBe(true);
      expect(report).toMatchObject({
        schemaVersion: "coding-agent-benchmark-report/v1",
        status: "partial",
        summary: {
          runCount: 2,
          passedRunCount: 2,
          failuresByCategory: {},
        },
      });
      expect(report.runs.map((run) => [run.taskId, run.status])).toEqual([
        ["rules.nested-precedence", "passed"],
        ["bug.reproducible-fix", "passed"],
      ]);
      for (const run of report.runs) {
        expect(run.fixture).toMatchObject({
          version: 1,
          resetStrategy: "regenerate",
          baselineCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
        });
      }

      const reportSchema = JSON.parse(await fs.readFile(
        path.resolve("benchmarks/coding-agent/v1/benchmark-report.schema.json"),
        "utf-8",
      ));
      const runSchema = JSON.parse(await fs.readFile(
        path.resolve("benchmarks/coding-agent/v1/benchmark-run.schema.json"),
        "utf-8",
      ));
      const compiledReport = compileOutputSchema(reportSchema);
      const compiledRun = compileOutputSchema(runSchema);
      expect(compiledReport.ok).toBe(true);
      expect(compiledRun.ok).toBe(true);
      if (!compiledReport.ok || !compiledRun.ok) return;
      expect(compiledReport.validator.validateOutput(JSON.stringify(report))).toEqual({ ok: true });

      for (const run of report.runs) {
        expect(compiledRun.validator.validateOutput(JSON.stringify(run))).toEqual({ ok: true });
        const runDir = path.join(artifactRoot, run.runId);
        const codingCiManifest = JSON.parse(await fs.readFile(
          path.join(runDir, "coding-ci-manifest.json"),
          "utf-8",
        ));
        expect(codingCiManifest.binding?.conversationId).toBe(`coding-benchmark-${run.runId}`);
        for (const artifact of [
          "manifest.json",
          "events.jsonl",
          "result.json",
          "changes.patch",
          "diagnostics.log",
          "status.txt",
        ]) {
          await expect(fs.stat(path.join(runDir, artifact))).resolves.toMatchObject({ isFile: expect.any(Function) });
        }
      }
      await expect(fs.readFile(path.join(artifactRoot, "benchmark-report.json"), "utf-8"))
        .resolves.toContain("coding-agent-benchmark-report/v1");
    } finally {
      await server.close();
    }
  }, 30_000);
});
