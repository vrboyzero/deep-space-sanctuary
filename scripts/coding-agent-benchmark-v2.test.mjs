import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startGatewayServer } from "../packages/belldandy-core/src/server.ts";
import { resolveWebRoot } from "../packages/belldandy-core/src/server-testkit.ts";

import {
  CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
  CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
  createCodingAgentBenchmarkReport,
  hashCodingAgentBenchmarkManifestText,
  loadCodingAgentBenchmarkManifest,
  resolveCodingAgentBenchmarkTaskBudgets,
  resolveCodingAgentBenchmarkManifestPath,
  validateCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import {
  createBenchmarkPreflightArtifact,
  evaluateBenchmarkAgentProfilePreflight,
  evaluateBenchmarkEventProjectionPreflight,
  evaluateBenchmarkOciPreflight,
  evaluateBenchmarkPricingPreflight,
  evaluateBenchmarkWorkspaceWriteClosurePreflight,
  resolveBenchmarkRepositoryIdentity,
} from "./coding-agent-benchmark-preflight.mjs";
import { generateStage0CInteractiveFixture } from "./coding-agent-benchmark-fixtures.mjs";
import { resolveCodingCiProfile } from "./run-coding-agent-ci.mjs";
import { runStage0BSuite } from "./run-coding-agent-benchmark.mjs";
import { aggregateCodingAgentBenchmarkReports } from "./aggregate-coding-agent-benchmark.mjs";

const tempRoots = [];
const workspaceRoot = path.resolve(import.meta.dirname, "..");

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark corrected v2 contract", () => {
  it("uses bounded v2 token overrides only for corrected interactive and safety tasks", async () => {
    const [v1Manifest, v2Manifest] = await Promise.all([
      loadCodingAgentBenchmarkManifest(),
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2")),
    ]);

    expect(v2Manifest.suite.taskBudgetOverrides).toEqual({
      "command.interactive-control": { maxTokens: 36_000 },
      "safety.boundary-enforcement": { maxTokens: 32_000 },
    });
    expect(resolveCodingAgentBenchmarkTaskBudgets(v2Manifest, "command.interactive-control")).toEqual({
      timeoutMs: 300_000,
      maxTurns: 12,
      maxTokens: 36_000,
    });
    expect(resolveCodingAgentBenchmarkTaskBudgets(v2Manifest, "safety.boundary-enforcement")).toEqual({
      timeoutMs: 300_000,
      maxTurns: 12,
      maxTokens: 32_000,
    });
    expect(resolveCodingAgentBenchmarkTaskBudgets(v2Manifest, "tests.failed-diagnosis").maxTokens).toBe(24_000);
    expect(resolveCodingAgentBenchmarkTaskBudgets(v1Manifest, "command.interactive-control").maxTokens).toBe(24_000);

    const drifted = structuredClone(v2Manifest);
    drifted.suite.taskBudgetOverrides["safety.boundary-enforcement"].maxTokens = 32_001;
    expect(() => validateCodingAgentBenchmarkManifest(drifted)).toThrow(/task budget overrides.*v2 contract/i);
  });

  it("keeps v1 as the default and freezes corrected command, safety, and recovery contracts in v2", async () => {
    const [defaultManifest, v2Manifest] = await Promise.all([
      loadCodingAgentBenchmarkManifest(),
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2")),
    ]);

    expect(defaultManifest.schemaVersion).toBe("coding-agent-benchmark-manifest/v1");
    expect(defaultManifest.suite.executionProfiles["command-control"].toolAllow).toEqual([
      "file_read",
      "list_files",
      "run_command",
    ]);
    expect(defaultManifest.suite.executionProfiles["recovery-control"]).toMatchObject({
      toolAllow: ["file_read", "list_files", "apply_patch", "file_write"],
      toolDeny: ["run_command", "spawn_subagent", "file_delete"],
    });
    expect(v2Manifest).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION,
      suite: {
        id: "ss-project-coding-v2",
        artifactSchemaVersion: CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
        reportSchemaVersion: CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
      },
    });
    expect(v2Manifest.suite.executionProfiles["command-control"].toolAllow).toEqual([
      "file_read",
      "list_files",
      "run_command",
      "command_job",
    ]);
    expect(v2Manifest.suite.executionProfiles["command-control"]).toMatchObject({
      agentId: "coding-benchmark-command-control-v2",
      maxHighRiskToolCalls: 5,
    });
    expect(v2Manifest.suite.executionProfiles["recovery-control"]).toEqual({
      permissionMode: "acceptEdits",
      toolAllow: ["file_read", "list_files", "file_write"],
      toolDeny: ["run_command", "spawn_subagent", "file_delete", "apply_patch"],
    });
    expect(v2Manifest.tasks.find((task) => task.id === "gateway.disconnect-recovery")?.fixture).toEqual({
      generatorId: "gateway-recovery-v2",
      version: 2,
      resetStrategy: "regenerate",
    });
    expect(v2Manifest.tasks.find((task) => task.id === "safety.boundary-enforcement")).toMatchObject({
      fixture: {
        generatorId: "safety-boundary-v2",
        version: 2,
        resetStrategy: "regenerate",
      },
      evaluator: { kind: "machine", id: "safety-boundary-v2" },
    });
    for (const [name, profile] of Object.entries(v2Manifest.suite.executionProfiles)) {
      if (name === "command-control") continue;
      expect(profile).not.toHaveProperty("agentId");
      expect(profile).not.toHaveProperty("maxHighRiskToolCalls");
    }
    expect(resolveCodingCiProfile("command-control").toolAllow).not.toContain("command_job");
    expect(resolveCodingCiProfile("command-control", "v2").toolAllow).toContain("command_job");
    expect(resolveCodingCiProfile("recovery-control").toolAllow).toContain("apply_patch");
    expect(resolveCodingCiProfile("recovery-control", "v2").toolAllow).toEqual([
      "file_read",
      "list_files",
      "file_write",
    ]);
  });

  it("adds exact edit only to the corrected v2 workspace-write profile", async () => {
    const [v1Manifest, v2Manifest] = await Promise.all([
      loadCodingAgentBenchmarkManifest(),
      loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2")),
    ]);

    expect(v1Manifest.suite.executionProfiles["workspace-write"].toolAllow).toEqual([
      "file_read",
      "list_files",
      "apply_patch",
      "file_write",
      "file_delete",
    ]);
    expect(v2Manifest.suite.executionProfiles["workspace-write"].toolAllow).toEqual([
      "file_read",
      "list_files",
      "file_edit",
      "apply_patch",
      "file_write",
      "file_delete",
    ]);
    expect(resolveCodingCiProfile("workspace-write").toolAllow).not.toContain("file_edit");
    expect(resolveCodingCiProfile("workspace-write", "v2").toolAllow).toEqual([
      "file_read",
      "list_files",
      "file_edit",
      "apply_patch",
      "file_write",
      "file_delete",
    ]);
  });

  it("generates the v2 interactive fixture with its command_job verifier and exact approval sequence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-interactive-"));
    tempRoots.push(root);
    const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2"));
    const fixture = await generateStage0CInteractiveFixture({
      taskId: "command.interactive-control",
      workspace: path.join(root, "workspace"),
      manifest,
    });
    const verifier = await fs.readFile(
      path.join(fixture.workspace, "tests/verify-transcript.mjs"),
      "utf-8",
    );
    const commandSource = await fs.readFile(
      path.join(fixture.workspace, "fixture/interactive-command.mjs"),
      "utf-8",
    );

    expect(fixture.task.fixture).toEqual({
      generatorId: "interactive-command-control-v2",
      version: 2,
      resetStrategy: "regenerate",
    });
    expect(fixture.approvalPolicy?.mode).toBe("allow_exact_sequence");
    expect(fixture.approvalPolicy?.steps.map((step) => step.action)).toEqual([
      "start",
      "write",
      "resize",
      "read",
      "cancel",
    ]);
    expect(fixture.approvalPolicy?.steps[1].arguments.data).toBe("benchmark-input");
    expect(fixture.prompt).toContain("15-character string benchmark-input");
    expect(commandSource).toContain("process.stdin.setRawMode?.(true)");
    expect(commandSource).toContain('console.log("HEARTBEAT 1")');
    expect(commandSource).not.toContain("heartbeat +=");
    expect(commandSource.match(/HEARTBEAT 1/g)).toHaveLength(1);
    expect(verifier).toContain('payload?.tool?.name === "command_job"');
    expect(verifier).toContain('args.data !== "benchmark-input"');
    expect(verifier).toContain("stripVTControlCharacters(transcript)");
    expect(verifier).toContain("lines.lastIndexOf(marker)");
    expect(verifier).toContain('cancelMetadata?.commandSandboxLeaseCleanupStatus !== "removed"');
    expect(verifier).toContain('startMetadata?.commandSandboxBackend !== "oci"');
    expect(verifier).not.toContain("terminal.open");
  });

  it("requires the bounded 2048-character event projection for the v2 interactive fixture", () => {
    expect(evaluateBenchmarkEventProjectionPreflight({ required: false })).toEqual({
      status: "not_applicable",
      reason: "task_does_not_require_extended_event_output",
    });
    expect(evaluateBenchmarkEventProjectionPreflight({
      required: true,
      readEnv: () => undefined,
    })).toEqual({
      status: "failed",
      reason: "event_output_limit_mismatch",
    });
    expect(evaluateBenchmarkEventProjectionPreflight({
      required: true,
      readEnv: () => "2048",
    })).toEqual({ status: "passed", reason: null, limit: 2_048 });
    expect(evaluateBenchmarkEventProjectionPreflight({
      required: true,
      readEnv: () => "2049",
    })).toEqual({
      status: "failed",
      reason: "event_output_limit_mismatch",
    });
  });

  it("verifies a ConPTY redraw and truncated cancel result from structured metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-truncated-cancel-"));
    tempRoots.push(root);
    const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2"));
    const fixture = await generateStage0CInteractiveFixture({
      taskId: "command.interactive-control",
      workspace: path.join(root, "workspace"),
      manifest,
    });
    const eventsPath = path.join(root, "events.jsonl");
    const jobId = "11111111-1111-4111-8111-111111111111";
    const digest = "a".repeat(64);
    const renderedScreen = [
      "INTERACTIVE_READY columns=80 rows=24",
      "INPUT_REQUIRED benchmark-input",
      "CHILD_PID 1234",
      "INPUT_ACCEPTED benchmark-input",
      "HEARTBEAT 1",
    ];
    const transcript = [
      `\u001b[2J\u001b[m\u001b[H${renderedScreen[0]}`,
      renderedScreen[1],
      `\u001b]0;docker.exe\u0007\u001b[?25h${renderedScreen[2]}\u001b[18X`,
      renderedScreen[3],
      `${renderedScreen[4]}\u001b[19X`,
      `\u001b[25l\u001b[H${renderedScreen[0]}\u001b[K`,
      ...renderedScreen.slice(1).map((line) => `${line}\u001b[K`),
      "\u001b[K\u001b[6;1H\u001b[?25hRESIZE_OBSERVED columns=100 rows=30",
      "",
    ].join("\r\n");
    const actions = [
      {
        action: "start",
        arguments: {
          action: "start",
          commandPlan: {
            executable: "node",
            argv: ["fixture/interactive-command.mjs"],
            cwd: ".",
            env: {},
            network: "none",
            writeScope: "workspace-readonly",
            stdinMode: "pty",
            timeoutMs: 120_000,
          },
        },
        output: JSON.stringify({ jobId, supportsResize: true }),
        metadata: {
          commandJobId: jobId,
          commandJobStatus: "running",
          commandSandboxBackend: "oci",
          commandSandboxRuntime: "docker",
          commandSandboxImage: `node:22-bookworm-slim@sha256:${digest}`,
        },
      },
      {
        action: "write",
        arguments: { action: "write", jobId, data: "benchmark-input" },
        output: "{}",
        metadata: { commandJobId: jobId, commandJobStatus: "running" },
      },
      {
        action: "resize",
        arguments: { action: "resize", jobId, cols: 100, rows: 30 },
        output: "{}",
        metadata: { commandJobId: jobId, commandJobStatus: "running" },
      },
      {
        action: "read",
        arguments: { action: "read", jobId, cursor: 0, maxBytes: 65_536 },
        output: JSON.stringify({ output: transcript }),
        metadata: { commandJobId: jobId, commandJobStatus: "running" },
      },
      {
        action: "cancel",
        arguments: { action: "cancel", jobId },
        output: `${"x".repeat(500)}\u2026`,
        metadata: {
          commandJobId: jobId,
          commandJobStatus: "cancelled",
          processCloseObserved: true,
          commandSandboxLeaseId: jobId,
          commandSandboxLeaseCleanupStatus: "removed",
        },
      },
    ];
    const events = [];
    let seq = 1;
    for (const [index, action] of actions.entries()) {
      const toolCallId = `call-${index + 1}`;
      events.push({
        seq: seq++,
        type: "tool.started",
        payload: { tool: { id: toolCallId, name: "command_job", arguments: action.arguments } },
      });
      events.push({
        seq: seq++,
        type: "permission.requested",
        payload: { permission: { toolCallId, toolName: "command_job" } },
      });
      events.push({
        seq: seq++,
        type: "tool.completed",
        payload: {
          tool: {
            id: toolCallId,
            name: "command_job",
            success: true,
            output: action.output,
            metadata: action.metadata,
          },
        },
      });
    }
    await fs.writeFile(eventsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

    const output = execFileSync(
      process.execPath,
      [path.join(fixture.workspace, "tests", "verify-transcript.mjs")],
      {
        cwd: fixture.workspace,
        env: { ...process.env, CODING_BENCHMARK_EVENTS_PATH: eventsPath },
        encoding: "utf-8",
      },
    );
    expect(output).toContain("interactive command_job transcript verified");
  });

  it("excludes infrastructure errors from product metrics without making them eligible or passed", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2"));
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");
    const identity = repositoryIdentity("a");
    const report = createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-28T00:00:00.000Z",
      manifest,
      manifestSha256: "b".repeat(64),
      harness: identity,
      source: repositoryIdentity("c"),
      runs: [
        v2Run(task, { runId: "rules-windows-a1", attempt: 1, status: "passed" }),
        v2Run(task, {
          runId: "rules-windows-a2",
          attempt: 2,
          status: "infrastructure_error",
          failureCategory: "infrastructure",
        }),
      ],
    });

    expect(report).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
      harness: identity,
      summary: {
        runCount: 2,
        productRunCount: 1,
        infrastructureErrorRunCount: 1,
        passedRunCount: 1,
        eligibleForProductComparison: false,
        metrics: {
          task_completion_rate: { numerator: 1, denominator: 1, value: 1 },
        },
      },
    });
  });

  it("requires v2 infrastructure failures to use the infrastructure_error status", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2"));
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");

    expect(() => createCodingAgentBenchmarkReport({
      status: "partial",
      generatedAt: "2026-07-28T00:00:00.000Z",
      manifest,
      manifestSha256: "b".repeat(64),
      harness: repositoryIdentity("a"),
      source: repositoryIdentity("c"),
      runs: [v2Run(task, {
        runId: "rules-windows-a1",
        attempt: 1,
        status: "failed",
        failureCategory: "infrastructure",
      })],
    })).toThrow(/infrastructure_error/i);
  });
});

describe("coding agent benchmark v2 preflight", () => {
  it("fails closed when the workspace-write edit/test/review closure is incomplete", async () => {
    const manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v2"));
    const task = manifest.tasks.find((item) => item.id === "feature.cross-file");
    const profile = manifest.suite.executionProfiles[task.executionProfile];

    for (const missingTool of ["file_read", "file_edit", "apply_patch"]) {
      expect(evaluateBenchmarkWorkspaceWriteClosurePreflight({
        task,
        profile: {
          ...profile,
          toolAllow: profile.toolAllow.filter((toolName) => toolName !== missingTool),
        },
      })).toEqual({
        status: "failed",
        reason: "profile_capability_missing",
        missingTools: [missingTool],
      });
    }

    expect(evaluateBenchmarkWorkspaceWriteClosurePreflight({
      task: {
        ...task,
        acceptance: { ...task.acceptance, testCommands: [] },
      },
      profile,
    })).toEqual({
      status: "failed",
      reason: "acceptance_test_commands_missing",
    });

    expect(evaluateBenchmarkWorkspaceWriteClosurePreflight({ task, profile })).toEqual({
      status: "passed",
      reason: null,
      toolAllow: profile.toolAllow,
      testCommandCount: 1,
    });
    expect(evaluateBenchmarkWorkspaceWriteClosurePreflight({
      task: { executionProfile: "read-only" },
      profile: manifest.suite.executionProfiles["read-only"],
    })).toEqual({
      status: "not_applicable",
      reason: "task_does_not_require_workspace_write_closure",
    });

    const driftedManifest = structuredClone(manifest);
    driftedManifest.suite.executionProfiles["workspace-write"].toolAllow = ["file_read", "apply_patch"];
    const artifact = await createBenchmarkPreflightArtifact({
      manifest: driftedManifest,
      manifestRevision: "v2",
      task: driftedManifest.tasks.find((item) => item.id === "feature.cross-file"),
      runId: "workspace-closure-v2-windows-a1",
      sourceRoot: workspaceRoot,
      stateDir: workspaceRoot,
      pricingRequired: false,
    }, {
      async readFile(target) {
        return String(target).endsWith("package.json")
          ? JSON.stringify({ packageManager: "pnpm@10.10.0" })
          : "fixture entrypoint";
      },
    });
    expect(artifact).toMatchObject({
      status: "failed",
      checks: {
        workspaceWriteClosure: {
          status: "failed",
          reason: "profile_capability_missing",
          missingTools: ["file_edit"],
        },
      },
    });
  });

  it("requires the exact isolated command-control Agent budget without changing other profiles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-agent-profile-"));
    tempRoots.push(root);
    const agentsPath = path.join(root, "agents.json");
    const commandProfile = {
      agentId: "coding-benchmark-command-control-v2",
      maxHighRiskToolCalls: 5,
    };

    await fs.writeFile(agentsPath, JSON.stringify({
      agents: [{
        id: commandProfile.agentId,
        displayName: "Coding Benchmark Command Control v2",
        model: "primary",
        kind: "resident",
        maxHighRiskToolCalls: 4,
      }],
    }), "utf-8");
    await expect(evaluateBenchmarkAgentProfilePreflight({
      stateDir: root,
      profile: commandProfile,
    })).resolves.toEqual({ status: "failed", reason: "agent_profile_budget_mismatch" });

    await fs.writeFile(agentsPath, JSON.stringify({
      agents: [{
        id: commandProfile.agentId,
        displayName: "Coding Benchmark Command Control v2",
        model: "primary",
        kind: "resident",
        maxHighRiskToolCalls: 5,
      }],
    }), "utf-8");
    await expect(evaluateBenchmarkAgentProfilePreflight({
      stateDir: root,
      profile: commandProfile,
    })).resolves.toMatchObject({
      status: "passed",
      reason: null,
      agentId: commandProfile.agentId,
      maxHighRiskToolCalls: 5,
      configSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    await expect(evaluateBenchmarkAgentProfilePreflight({
      stateDir: root,
      profile: { permissionMode: "plan" },
    })).resolves.toEqual({ status: "not_applicable", reason: "profile_uses_runtime_default" });
  });

  it("fails pricing before Provider execution unless both finite USD rates are present", () => {
    expect(evaluateBenchmarkPricingPreflight({
      required: true,
      readEnv: () => undefined,
    })).toMatchObject({ status: "failed", reason: "pricing_unavailable" });

    const values = new Map([
      ["BELLDANDY_MODEL_INPUT_USD_PER_1M", "0.125"],
      ["BELLDANDY_MODEL_OUTPUT_USD_PER_1M", "0.25"],
    ]);
    expect(evaluateBenchmarkPricingPreflight({
      required: true,
      readEnv: (name) => values.get(name),
    })).toEqual({ status: "passed", reason: null });
    expect(evaluateBenchmarkPricingPreflight({ required: false })).toEqual({
      status: "not_applicable",
      reason: "fixture_provider",
    });
  });

  it("binds an explicit source root and persists a v2 preflight before execution", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-runner-"));
    tempRoots.push(root);
    const invocations = [];
    const harness = repositoryIdentity("a");
    const source = repositoryIdentity("c");
    let identityCallCount = 0;
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v2",
      sourceRoot: workspaceRoot,
      taskIds: ["rules.nested-precedence"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "rules.nested-precedence": "rules-v2-windows-a1" },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-28T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      async resolveRepositoryIdentity() {
        identityCallCount += 1;
        return structuredClone(identityCallCount === 1 ? source : harness);
      },
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "fixture runner stopped" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      manifestRevision: "v2",
      sourceRoot: workspaceRoot,
      bddEntry: path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js"),
    });
    expect(report).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
      harness,
      source,
      runs: [{
        schemaVersion: CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
        artifacts: { preflight: "rules-v2-windows-a1/preflight.json" },
      }],
    });
    await expect(readJson(path.join(root, "artifacts", "rules-v2-windows-a1", "preflight.json")))
      .resolves.toMatchObject({ status: "passed", checks: { contractSource: { status: "passed" } } });
  });

  it("binds the corrected interactive budget through preflight, runner, and run artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-interactive-budget-"));
    tempRoots.push(root);
    const stateRoot = path.join(root, "state");
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.copyFile(
      path.join(workspaceRoot, "benchmarks", "coding-agent", "v2", "agents.json"),
      path.join(stateRoot, "agents.json"),
    );
    const invocations = [];
    const digest = "a".repeat(64);
    const image = `node:22-bookworm-slim@sha256:${digest}`;
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v2",
      sourceRoot: workspaceRoot,
      taskIds: ["command.interactive-control"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot,
      attempt: 1,
      runIds: { "command.interactive-control": "interactive-budget-v2-windows-a1" },
      childEnv: {
        BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
        BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
        BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: image,
        BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT: "2048",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-28T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      async resolveRepositoryIdentity() { return repositoryIdentity("a"); },
      async probeOciImage() { return { available: true, repoDigests: [image] }; },
      async executeCodingCi(input) {
        invocations.push(input);
        return { exitCode: 4, stdout: "", stderr: "fixture runner stopped" };
      },
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      manifestRevision: "v2",
      taskId: "command.interactive-control",
    });
    expect(report.runs[0].execution.budgets).toEqual({
      timeoutMs: 300_000,
      maxTurns: 12,
      maxTokens: 36_000,
    });
    await expect(readJson(path.join(
      root,
      "artifacts",
      "interactive-budget-v2-windows-a1",
      "preflight.json",
    ))).resolves.toMatchObject({
      status: "passed",
      checks: {
        executionBudget: {
          status: "passed",
          taskId: "command.interactive-control",
          maxTokens: 36_000,
        },
      },
    });
  });

  it("fails closed before Agent execution when a required OCI boundary is unavailable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-oci-fail-"));
    tempRoots.push(root);
    let executionCount = 0;
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v2",
      sourceRoot: workspaceRoot,
      taskIds: ["command.interactive-control"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "command.interactive-control": "interactive-v2-windows-a1" },
      childEnv: {
        BELLDANDY_COMMAND_SANDBOX_BACKEND: "disabled",
        BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "",
        BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: "",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
      generatedAt: "2026-07-28T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      async resolveRepositoryIdentity() { return repositoryIdentity("a"); },
      async executeCodingCi() {
        executionCount += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(executionCount).toBe(0);
    expect(report).toMatchObject({
      runs: [{ status: "infrastructure_error", failureCategory: "infrastructure" }],
      summary: {
        productRunCount: 0,
        infrastructureErrorRunCount: 1,
        passedRunCount: 0,
        eligibleForProductComparison: false,
        metrics: { task_completion_rate: { denominator: 0, value: null } },
      },
    });
    await expect(readJson(path.join(root, "artifacts", "interactive-v2-windows-a1", "preflight.json")))
      .resolves.toMatchObject({ status: "failed", checks: { oci: { reason: "invalid_configuration" } } });
  });

  it("aggregates v2 only when manifest, harness, source, and artifacts stay bound", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-aggregate-"));
    tempRoots.push(root);
    const manifestPath = resolveCodingAgentBenchmarkManifestPath("v2");
    const manifestText = await fs.readFile(manifestPath, "utf-8");
    const manifest = await loadCodingAgentBenchmarkManifest(manifestPath);
    const task = manifest.tasks.find((item) => item.id === "rules.nested-precedence");
    const harness = repositoryIdentity("a");
    const source = repositoryIdentity("c");
    const first = await writeV2SourceReport(path.join(root, "first"), {
      manifest,
      manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
      harness,
      source,
      run: v2Run(task, { runId: "rules-v2-windows-a1", attempt: 1, status: "passed" }),
    });
    const second = await writeV2SourceReport(path.join(root, "second"), {
      manifest,
      manifestSha256: hashCodingAgentBenchmarkManifestText(manifestText),
      harness,
      source,
      run: v2Run(task, { runId: "rules-v2-windows-a2", attempt: 2, status: "passed" }),
    });

    await expect(aggregateCodingAgentBenchmarkReports({
      manifestPath,
      reportPaths: [first, second],
      writeOutput: false,
      generatedAt: "2026-07-28T00:00:00.000Z",
    })).resolves.toMatchObject({
      report: { schemaVersion: CODING_AGENT_BENCHMARK_REPORT_V2_VERSION, harness, source },
    });

    const drifted = await readJson(second);
    drifted.harness.worktreeContentSha256 = "f".repeat(64);
    await fs.writeFile(second, `${JSON.stringify(drifted, null, 2)}\n`, "utf-8");
    await expect(aggregateCodingAgentBenchmarkReports({
      manifestPath,
      reportPaths: [first, second],
      writeOutput: false,
    })).rejects.toThrow(/harness identity drifted/i);
  });

  it("runs process restart from the source build without applying the real Provider cost cap to its fixture Agent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-restart-"));
    tempRoots.push(root);
    const report = await runStage0BSuite({
      platform: "windows-native",
      manifestRevision: "v2",
      sourceRoot: workspaceRoot,
      taskIds: ["gateway.process-restart"],
      fixtureRoot: path.join(root, "fixtures"),
      artifactRoot: path.join(root, "artifacts"),
      stateRoot: path.join(root, "state"),
      attempt: 1,
      runIds: { "gateway.process-restart": "restart-v2-windows-a1" },
      childEnv: {
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
        BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
      },
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: true },
      generatedAt: "2026-07-28T00:00:00.000Z",
    }, {
      runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
      async resolveRepositoryIdentity() { return repositoryIdentity("a"); },
    });

    expect(report.runs[0]).toMatchObject({
      status: "passed",
      failureCategory: null,
      execution: { profile: "plan" },
    });
    expect(report.runs[0].execution).not.toHaveProperty("maxCostUsd");
    const restart = await readJson(path.join(root, "artifacts", "restart-v2-windows-a1", "restart-injection.json"));
    expect(restart).toMatchObject({
      trigger: "message.send.accepted",
      status: "confirmed",
      messageSendRequestCount: 1,
      originalGateway: { entrypoint: { path: "packages/belldandy-core/dist/server.js" } },
      replacementGateway: { entrypoint: { path: "packages/belldandy-core/dist/server.js" } },
      cleanup: { managedGatewayProcessCount: 0 },
    });
    await expect(readJson(path.join(root, "artifacts", "restart-v2-windows-a1", "preflight.json")))
      .resolves.toMatchObject({
        status: "passed",
        checks: {
          pricing: { status: "not_applicable", reason: "fixture_provider" },
          fault: { status: "passed", reason: null },
        },
      });
  }, 30_000);

  it("injects v2 disconnect only after one successful content-changing mutation and resumes without replay", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-v2-recovery-"));
    tempRoots.push(root);
    const fixtureRoot = path.join(root, "fixtures");
    const artifactRoot = path.join(root, "artifacts");
    const stateRoot = path.join(root, "state");
    const runId = "recovery-v2-windows-a1";
    let writeCount = 0;
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir: stateRoot,
      agentFactory: () => ({
        async *run() {
          yield { type: "status", status: "running" };
          yield {
            type: "tool_call",
            id: "recovery-write-v2",
            name: "file_write",
            arguments: { path: "src/recovery-target.txt", content: "recovery-marker=completed-once\n" },
          };
          writeCount += 1;
          await fs.writeFile(
            path.join(fixtureRoot, runId, "workspace", "src", "recovery-target.txt"),
            "recovery-marker=completed-once\n",
            "utf-8",
          );
          yield {
            type: "tool_result",
            id: "recovery-write-v2",
            name: "file_write",
            success: true,
            output: "updated",
          };
          yield { type: "final", text: JSON.stringify({ summary: "Recovered once." }) };
        },
      }),
    });

    try {
      const report = await runStage0BSuite({
        platform: "windows-native",
        manifestRevision: "v2",
        sourceRoot: workspaceRoot,
        taskIds: ["gateway.disconnect-recovery"],
        fixtureRoot,
        artifactRoot,
        stateRoot,
        attempt: 1,
        runIds: { "gateway.disconnect-recovery": runId },
        model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
        generatedAt: "2026-07-28T00:00:00.000Z",
        childEnv: {
          BELLDANDY_HOST: "127.0.0.1",
          BELLDANDY_PORT: String(server.port),
          BELLDANDY_AUTH_MODE: "none",
        },
      }, {
        runtime: { platform: "win32", osRelease: "Windows fixture", env: {} },
        async resolveRepositoryIdentity() { return repositoryIdentity("a"); },
      });

      expect(writeCount).toBe(1);
      expect(report.runs[0]).toMatchObject({
        status: "passed",
        failureCategory: null,
        evaluation: { recoverySucceeded: true },
      });
      const fault = await readJson(path.join(artifactRoot, runId, "fault-injection.json"));
      expect(fault).toMatchObject({
        status: "recovered",
        disconnectCount: 1,
        reconnectCount: 1,
        mutation: {
          trigger: "successful_tool_result_after_content_change",
          toolCallId: "recovery-write-v2",
          resultSuccess: true,
        },
      });
      expect(fault.mutation.afterSha256).not.toBe(fault.mutation.beforeSha256);
      await expect(readJson(path.join(artifactRoot, runId, "preflight.json")))
        .resolves.toMatchObject({ status: "passed", checks: { fault: { status: "passed" } } });
    } finally {
      await server.close();
    }
  }, 30_000);

  it("requires a locally present digest-pinned OCI image without pulling it", async () => {
    const env = new Map([
      ["BELLDANDY_COMMAND_SANDBOX_BACKEND", "oci"],
      ["BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME", "docker"],
      ["BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE", `node@sha256:${"d".repeat(64)}`],
    ]);
    const probe = [];
    const passed = await evaluateBenchmarkOciPreflight({
      required: true,
      readEnv: (name) => env.get(name),
      probeImage: async (input) => {
        probe.push(input);
        return { available: true, repoDigests: [input.image] };
      },
    });

    expect(passed).toMatchObject({
      status: "passed",
      reason: null,
      runtime: "docker",
      image: `node@sha256:${"d".repeat(64)}`,
    });
    expect(probe).toEqual([{ runtime: "docker", image: `node@sha256:${"d".repeat(64)}` }]);
    await expect(evaluateBenchmarkOciPreflight({
      required: true,
      readEnv: (name) => new Map([
        ["BELLDANDY_COMMAND_SANDBOX_BACKEND", "oci"],
        ["BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME", "docker"],
        ["BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE", `node:22-bookworm-slim@sha256:${"d".repeat(64)}`],
      ]).get(name),
      probeImage: async () => ({
        available: true,
        repoDigests: [`node@sha256:${"d".repeat(64)}`],
      }),
    })).resolves.toMatchObject({ status: "passed", reason: null });
    await expect(evaluateBenchmarkOciPreflight({
      required: true,
      readEnv: (name) => new Map([
        ["BELLDANDY_COMMAND_SANDBOX_BACKEND", "oci"],
        ["BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME", "docker"],
        ["BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE", `node:22-bookworm-slim@sha256:${"d".repeat(64)}`],
      ]).get(name),
      probeImage: async () => ({
        available: true,
        repoDigests: [`other@sha256:${"d".repeat(64)}`],
      }),
    })).resolves.toMatchObject({ status: "failed", reason: "image_digest_mismatch" });
    await expect(evaluateBenchmarkOciPreflight({
      required: true,
      readEnv: (name) => name === "BELLDANDY_COMMAND_SANDBOX_BACKEND" ? "oci" : undefined,
      probeImage: async () => ({ available: true, repoDigests: [] }),
    })).resolves.toMatchObject({ status: "failed", reason: "invalid_configuration" });
  });

  it("produces a content identity that changes for an uncommitted source without changing HEAD", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-identity-"));
    tempRoots.push(root);
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "benchmark@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Benchmark Fixture"], { cwd: root });
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
    await fs.writeFile(path.join(root, "tracked.txt"), "before\n", "utf-8");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });

    const before = await resolveBenchmarkRepositoryIdentity(root);
    await fs.writeFile(path.join(root, "tracked.txt"), "after\n", "utf-8");
    await fs.writeFile(path.join(root, "untracked.txt"), "new\n", "utf-8");
    const after = await resolveBenchmarkRepositoryIdentity(root);

    expect(after.commit).toBe(before.commit);
    expect(before.workspaceDirty).toBe(false);
    expect(after.workspaceDirty).toBe(true);
    expect(after.worktreeContentSha256).not.toBe(before.worktreeContentSha256);
  });

  it("keeps repository identity stable across autocrlf checkout policies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-identity-eol-"));
    tempRoots.push(root);
    const origin = path.join(root, "origin");
    const crlfCheckout = path.join(root, "crlf");
    const lfCheckout = path.join(root, "lf");
    await fs.mkdir(origin);
    execFileSync("git", ["init", "--quiet"], { cwd: origin });
    execFileSync("git", ["config", "user.email", "benchmark@example.invalid"], { cwd: origin });
    execFileSync("git", ["config", "user.name", "Benchmark Fixture"], { cwd: origin });
    await fs.writeFile(path.join(origin, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
    await fs.writeFile(path.join(origin, "tracked.txt"), "stable\ncontent\n", "utf-8");
    await fs.mkdir(path.join(origin, "unicode"));
    await fs.writeFile(path.join(origin, "unicode", "路径.txt"), "same\n", "utf-8");
    execFileSync("git", ["add", "."], { cwd: origin });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: origin });
    execFileSync("git", ["clone", "--quiet", "-c", "core.autocrlf=true", origin, crlfCheckout]);
    execFileSync("git", ["clone", "--quiet", "-c", "core.autocrlf=false", origin, lfCheckout]);

    const crlfIdentity = await resolveBenchmarkRepositoryIdentity(crlfCheckout);
    const lfIdentity = await resolveBenchmarkRepositoryIdentity(lfCheckout);

    expect(crlfIdentity.workspaceDirty).toBe(false);
    expect(lfIdentity.workspaceDirty).toBe(false);
    expect(crlfIdentity.lockfileSha256).toBe(lfIdentity.lockfileSha256);
    expect(crlfIdentity.worktreeContentSha256).toBe(lfIdentity.worktreeContentSha256);
  });
});

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}

function v2Run(task, input) {
  return {
    schemaVersion: CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
    runId: input.runId,
    taskId: task.id,
    attempt: input.attempt,
    platform: "windows-native",
    fixture: {
      generatorId: task.fixture.generatorId,
      version: task.fixture.version,
      resetStrategy: task.fixture.resetStrategy,
      baselineCommit: "e".repeat(40),
    },
    status: input.status,
    failureCategory: input.failureCategory ?? null,
    execution: {
      profile: task.executionProfile,
      budgets: structuredClone(task.__manifestBudgets ?? {
        timeoutMs: 300_000,
        maxTurns: 12,
        maxTokens: 24_000,
      }),
      infrastructureRetries: 0,
    },
    environment: {
      osRelease: "Windows fixture",
      arch: "x64",
      nodeVersion: "v22.12.0",
      packageManager: "pnpm@10.23.0",
      wsl: null,
      model: { provider: "fixture", id: "fixture-model", credentialsConfigured: false },
    },
    evaluation: {
      source: "machine",
      taskCompleted: input.status === "passed",
      testsPassed: null,
      patchAccepted: null,
      dangerousOperationBlocked: null,
      recoverySucceeded: null,
      regressionCount: 0,
      manualInterventionCount: 0,
    },
    usage: { durationMs: 1, inputTokens: null, outputTokens: null },
    artifacts: {
      manifest: `${input.runId}/manifest.json`,
      events: `${input.runId}/events.jsonl`,
      result: `${input.runId}/result.json`,
      patch: `${input.runId}/changes.patch`,
      diagnostics: `${input.runId}/diagnostics.log`,
      status: `${input.runId}/status.txt`,
      preflight: `${input.runId}/preflight.json`,
    },
  };
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf-8"));
}

async function writeV2SourceReport(root, input) {
  await fs.mkdir(root, { recursive: true });
  for (const artifactPath of Object.values(input.run.artifacts)) {
    const target = path.join(root, artifactPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "fixture artifact\n", "utf-8");
  }
  const report = createCodingAgentBenchmarkReport({
    status: "partial",
    generatedAt: "2026-07-28T00:00:00.000Z",
    manifest: input.manifest,
    manifestSha256: input.manifestSha256,
    harness: input.harness,
    source: input.source,
    runs: [input.run],
  });
  const reportPath = path.join(root, "benchmark-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return reportPath;
}
