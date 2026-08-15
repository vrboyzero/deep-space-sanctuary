import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { startGatewayServer } from "../packages/belldandy-core/src/server.ts";
import {
  cleanupGlobalMemoryManagersForTest,
  resolveWebRoot,
} from "../packages/belldandy-core/src/server-testkit.ts";

import {
  buildAgentRunArgs,
  buildBenchmarkPermissionResponseParams,
  collectWorkspaceArtifact,
  resolveCodingCiLimits,
  resolveCodingCiProfile,
  sanitizeDiagnostic,
  validateAgentRunEvents,
} from "./run-coding-agent-ci.mjs";
import {
  CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
} from "./run-code-intel-agent-uplift-readiness.mjs";

const tempRoots = [];

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent CI runner", () => {
  it("wraps benchmark permission responses in the Gateway RunControl envelope", () => {
    expect(buildBenchmarkPermissionResponseParams("v1", {
      binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
      toolCallId: "tool-1",
      decision: "allow",
    })).toEqual({
      control: {
        version: "v1",
        operation: "permission.respond",
        binding: { agentRunId: "run-1", worktreeId: "worktree-1" },
        toolCallId: "tool-1",
        decision: "allow",
      },
    });
  });

  it("defaults to a bounded read-only profile and requires explicit workspace-write opt-in", () => {
    expect(resolveCodingCiProfile(undefined)).toEqual({
      mode: "plan",
      permissionMode: "plan",
      toolAllow: ["file_read", "list_files"],
    });
    expect(resolveCodingCiProfile("workspace-write")).toEqual({
      mode: "workspace-write",
      permissionMode: "acceptEdits",
      toolAllow: ["file_read", "list_files", "apply_patch", "file_write", "file_delete"],
    });
    expect(() => resolveCodingCiProfile("confirm")).toThrow(/mode/i);
  });

  it("projects navigation-read as an immutable read-only navigation profile", () => {
    const profile = resolveCodingCiProfile("navigation-read");
    expect(profile).toEqual({
      mode: "navigation-read",
      permissionMode: "plan",
      toolAllow: ["file_read", "list_files", "text_search", "file_glob"],
    });

    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--permission-mode", "plan",
      "--tool-allow", "file_read,list_files,text_search,file_glob",
      "--tool-deny", "run_command,spawn_subagent",
    ]));
    expect(args.join(" ")).not.toMatch(/apply_patch|file_write|file_delete|accept-edits/);
  });

  it("allows only the exact v3 workspace-write navigation shadow candidate", () => {
    expect(resolveCodingCiProfile(
      "workspace-write",
      "v3",
      "workspace-write-navigation-candidate-v1",
    )).toEqual({
      mode: "workspace-write",
      candidateId: "workspace-write-navigation-candidate-v1",
      permissionMode: "acceptEdits",
      toolAllow: [
        "file_read",
        "list_files",
        "text_search",
        "file_glob",
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ],
    });
    expect(() => resolveCodingCiProfile(
      "workspace-write",
      "v2",
      "workspace-write-navigation-candidate-v1",
    )).toThrow(/only supports the v3 workspace-write/i);
    expect(() => resolveCodingCiProfile("plan", "v3", "unknown"))
      .toThrow(/only supports the v3 workspace-write/i);
  });

  it("projects candidate v2 with the exact candidate v1 tool set and no runtime guard", () => {
    expect(resolveCodingCiProfile(
      "workspace-write",
      "v3",
      "workspace-write-navigation-candidate-v2",
    )).toEqual({
      mode: "workspace-write",
      candidateId: "workspace-write-navigation-candidate-v2",
      permissionMode: "acceptEdits",
      toolAllow: [
        "file_read",
        "list_files",
        "text_search",
        "file_glob",
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ],
    });
  });

  it("projects candidate v3 with the isolated bounded navigation runtime policy", () => {
    const profile = resolveCodingCiProfile(
      "workspace-write",
      "v3",
      "workspace-write-navigation-candidate-v3",
    );
    expect(profile).toEqual({
      mode: "workspace-write",
      candidateId: "workspace-write-navigation-candidate-v3",
      permissionMode: "acceptEdits",
      toolAllow: [
        "file_read",
        "list_files",
        "text_search",
        "file_glob",
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ],
      toolArgumentPolicy: "bounded-navigation-v1",
    });

    expect(buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    })).toEqual(expect.arrayContaining([
      "--tool-argument-policy",
      "bounded-navigation-v1",
    ]));
    expect(buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile: resolveCodingCiProfile("workspace-write", "v3"),
    })).not.toContain("--tool-argument-policy");
  });

  it("appends code_intel as the only v3 uplift candidate profile difference", () => {
    for (const mode of ["workspace-write", "command-control"]) {
      const baseline = resolveCodingCiProfile(mode, "v3");
      const candidate = resolveCodingCiProfile(
        mode,
        "v3",
        CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
      );
      const { candidateId, toolAllow, ...candidateRest } = candidate;
      const { toolAllow: baselineToolAllow, ...baselineRest } = baseline;

      expect(candidateId).toBe(CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID);
      expect(candidateRest).toEqual(baselineRest);
      expect(toolAllow).toEqual([...baselineToolAllow, "code_intel"]);
      expect(toolAllow.filter((tool) => tool === "code_intel")).toHaveLength(1);
    }

    expect(() => resolveCodingCiProfile(
      "workspace-write",
      "v2",
      CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
    )).toThrow(/v3 workspace-write or command-control/i);
    expect(() => resolveCodingCiProfile(
      "plan",
      "v3",
      CODE_INTEL_AGENT_UPLIFT_CANDIDATE_ID,
    )).toThrow(/v3 workspace-write or command-control/i);
    expect(() => resolveCodingCiProfile("workspace-write", "v3", "unknown"))
      .toThrow(/navigation candidate/i);
  });

  it("builds one fixed-budget JSONL invocation without shell or push tools", () => {
    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/review-output.schema.json",
      profile: resolveCodingCiProfile("workspace-write", "v3"),
      conversationId: "coding-ci-fixture-run",
      modelId: "deepseek-v4-flash",
      maxCostUsd: 3,
      manifestRevision: "v3",
      taskId: "real-js.bug-fix",
    });

    expect(args).toEqual([
      "agent", "run",
      "--jsonl",
      "--automation-profile", "bare",
      "--cwd", path.resolve("C:/fixture/workspace"),
      "--state-dir", path.resolve("C:/fixture/state"),
      "--conversation-id", "coding-ci-fixture-run",
      "--model-id", "deepseek-v4-flash",
      "--expected-resolved-model-id", "deepseek-v4-flash",
      "--require-workspace-mutation",
      "--permission-mode", "accept-edits",
      "--tool-allow", "file_read,list_files,file_edit,apply_patch,file_write,file_delete",
      "--tool-deny", "run_command,spawn_subagent",
      "--timeout", "300000",
      "--max-turns", "12",
      "--max-tokens", "24000",
      "--max-cost-usd", "3",
      "--output-schema", path.resolve("C:/fixture/review-output.schema.json"),
    ]);
    expect(args.join(" ")).not.toMatch(/\b(?:push|merge|apply)\b/);
  });

  it("delegates v3 parallel-write workspace mutation to the native system harness", () => {
    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile: resolveCodingCiProfile("workspace-write", "v3"),
      manifestRevision: "v3",
      taskId: "system.parallel-write-fan-in",
    });

    expect(args).not.toContain("--require-workspace-mutation");
  });

  it("uses the Gateway-visible workspace only for the remote coding run cwd", () => {
    const workspace = "/var/tmp/coding-agent-fixtures/run-1/workspace";
    const gatewayWorkspace = "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures\\run-1\\workspace";
    const args = buildAgentRunArgs({
      workspace,
      gatewayWorkspace,
      stateDir: "/mnt/e/project/star-sanctuary/tmp/gateway-state",
      outputSchemaPath: "/var/tmp/coding-agent-artifacts/run-1/output.schema.json",
      profile: resolveCodingCiProfile("workspace-write"),
    });

    expect(args.slice(args.indexOf("--cwd"), args.indexOf("--cwd") + 2)).toEqual([
      "--cwd",
      gatewayWorkspace,
    ]);
    expect(args).not.toContain(path.resolve(workspace));
  });

  it("projects the frozen command-control profile without auto-approving host commands", () => {
    const profile = resolveCodingCiProfile("command-control");
    expect(profile).toEqual({
      mode: "command-control",
      permissionMode: "confirm",
      toolAllow: ["file_read", "list_files", "run_command"],
    });

    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--permission-mode", "confirm",
      "--tool-allow", "file_read,list_files,run_command",
      "--tool-deny", "spawn_subagent",
    ]));
    expect(args.join(" ")).not.toContain("accept-edits");
  });

  it("routes only corrected v2 command-control through its isolated high-risk budget profile", () => {
    const profile = resolveCodingCiProfile("command-control", "v2");
    expect(profile).toEqual({
      mode: "command-control",
      agentId: "coding-benchmark-command-control-v2",
      maxHighRiskToolCalls: 5,
      permissionMode: "confirm",
      toolAllow: ["file_read", "list_files", "run_command", "command_job"],
    });

    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--agent-id", "coding-benchmark-command-control-v2",
      "--permission-mode", "confirm",
      "--tool-allow", "file_read,list_files,run_command,command_job",
    ]));

    for (const mode of ["plan", "navigation-read", "workspace-write", "safety-probe", "recovery-control", "git-local"]) {
      expect(resolveCodingCiProfile(mode, "v2")).not.toHaveProperty("agentId");
      expect(resolveCodingCiProfile(mode, "v2")).not.toHaveProperty("maxHighRiskToolCalls");
    }
  });

  it("raises the CLI token limit only for the corrected v2 interactive task", () => {
    const profile = resolveCodingCiProfile("command-control", "v2");
    const interactiveLimits = resolveCodingCiLimits("v2", "command.interactive-control");
    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
      limits: interactiveLimits,
    });

    expect(interactiveLimits).toEqual({ timeoutMs: 300_000, maxTurns: 12, maxTokens: 36_000 });
    expect(args).toEqual(expect.arrayContaining(["--max-tokens", "36000"]));
    expect(resolveCodingCiLimits("v2", "tests.failed-diagnosis").maxTokens).toBe(24_000);
    expect(resolveCodingCiLimits("v1", "command.interactive-control").maxTokens).toBe(24_000);
    expect(() => resolveCodingCiLimits("v2")).toThrow(/task-id.*required/i);
  });

  it("projects the frozen safety-probe profile without auto-approving host commands", () => {
    const profile = resolveCodingCiProfile("safety-probe");
    expect(profile).toEqual({
      mode: "safety-probe",
      permissionMode: "confirm",
      toolAllow: ["file_read", "list_files", "run_command"],
    });

    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--permission-mode", "confirm",
      "--tool-allow", "file_read,list_files,run_command",
      "--tool-deny", "spawn_subagent",
    ]));
    expect(args.join(" ")).not.toContain("accept-edits");
  });

  it("projects the frozen git-local profile without mutation tools or auto-approval", () => {
    const profile = resolveCodingCiProfile("git-local");
    expect(profile).toEqual({
      mode: "git-local",
      permissionMode: "confirm",
      toolAllow: ["file_read", "list_files", "run_command"],
      toolDeny: ["spawn_subagent", "apply_patch", "file_write", "file_delete"],
    });

    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--permission-mode", "confirm",
      "--tool-allow", "file_read,list_files,run_command",
      "--tool-deny", "spawn_subagent,apply_patch,file_write,file_delete",
    ]));
    expect(args.join(" ")).not.toContain("accept-edits");
  });

  it("projects the frozen recovery-control profile with bounded workspace writes", async () => {
    const profile = resolveCodingCiProfile("recovery-control");
    expect(profile).toEqual({
      mode: "recovery-control",
      permissionMode: "acceptEdits",
      toolAllow: ["file_read", "list_files", "apply_patch", "file_write"],
      toolDeny: ["run_command", "spawn_subagent", "file_delete"],
    });

    const args = buildAgentRunArgs({
      workspace: "C:/fixture/workspace",
      stateDir: "C:/fixture/state",
      outputSchemaPath: "C:/fixture/output.schema.json",
      profile,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--require-workspace-mutation",
      "--permission-mode", "accept-edits",
      "--tool-allow", "file_read,list_files,apply_patch,file_write",
      "--tool-deny", "run_command,spawn_subagent,file_delete",
    ]));

    const root = await createGitFixture();
    await fs.writeFile(path.join(root, "tracked.txt"), "recovered\n", "utf-8");
    expect(collectWorkspaceArtifact({ workspace: root, mode: "recovery-control" })).toMatchObject({
      changedPaths: ["tracked.txt"],
    });
  });

  it("accepts one continuous v1 event stream with a unique terminal event", () => {
    const binding = { agentRunId: "run-ci", conversationId: "conv-ci" };
    const events = [
      event(1, "run.started", binding, {
        status: "running",
        automationProfile: "bare",
        modelRoute: {
          declaredModelId: "deepseek-v4-flash",
          resolvedModelId: "deepseek-v4-flash",
          source: "primary",
        },
        capabilities: fixtureCapabilities(),
      }),
      event(2, "message.delta", binding, { delta: "ok" }),
      event(3, "run.completed", binding, {
        output: { text: "{\"summary\":\"ok\",\"findings\":[]}" },
        usage: fixtureCompleteUsage(),
      }),
    ];

    expect(validateAgentRunEvents(events, isFixtureEvent, {
      isCodingRunCapabilitiesV1: isFixtureCapabilities,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
    }, "bare", "deepseek-v4-flash")).toEqual({
      binding,
      terminalType: "run.completed",
      automationProfile: "bare",
      modelRoute: {
        declaredModelId: "deepseek-v4-flash",
        resolvedModelId: "deepseek-v4-flash",
        source: "primary",
      },
      capabilities: fixtureCapabilities(),
      usage: fixtureCompleteUsage(),
    });
    expect(() => validateAgentRunEvents([
      {
        ...events[0],
        payload: {
          ...events[0].payload,
          modelRoute: {
            declaredModelId: "deepseek-v4-flash",
            resolvedModelId: "deepseek-v4-pro",
            source: "primary",
          },
        },
      },
      ...events.slice(1),
    ], isFixtureEvent, {
      isCodingRunCapabilitiesV1: isFixtureCapabilities,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
    }, "bare", "deepseek-v4-flash")).toThrow(/resolved model/i);
    expect(() => validateAgentRunEvents([
      events[0],
      event(3, "run.completed", binding, { usage: fixtureCompleteUsage() }),
    ], isFixtureEvent, {
      isCodingRunCapabilitiesV1: isFixtureCapabilities,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
    })).toThrow(/sequence/i);
    expect(() => validateAgentRunEvents([
      event(1, "run.started", binding, { status: "running" }),
      event(2, "run.completed", binding, {
        output: { text: "{\"summary\":\"ok\",\"findings\":[]}" },
        usage: fixtureCompleteUsage(),
      }),
    ], isFixtureEvent, {
      isCodingRunCapabilitiesV1: isFixtureCapabilities,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
    })).toThrow(/capability/i);
    expect(() => validateAgentRunEvents([
      events[0],
      event(2, "run.completed", binding, { usage: { status: "complete" } }),
    ], isFixtureEvent, {
      isCodingRunCapabilitiesV1: isFixtureCapabilities,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
    })).toThrow(/usage completeness/i);
    expect(() => validateAgentRunEvents(events, isFixtureEvent, {
      isCodingRunCapabilitiesV1: isFixtureCapabilities,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
    }, "managed")).toThrow(/automation profile/i);

    const legacyCapabilities = fixtureCapabilities();
    delete legacyCapabilities.observability;
    expect(() => validateAgentRunEvents([
      event(1, "run.started", binding, {
        status: "running",
        automationProfile: "bare",
        capabilities: legacyCapabilities,
      }),
      event(2, "run.completed", binding, {
        output: { text: "{\"summary\":\"ok\",\"findings\":[]}" },
        usage: fixtureCompleteUsage(),
      }),
    ], isFixtureEvent, {
      isCodingRunCapabilitiesV1: () => true,
      isCodingRunUsageCompletenessV1: isFixtureUsageCompleteness,
      expectedTracePolicy: fixtureCapabilities().observability.trace,
    }, "bare")).toThrow(/trace capability/i);
  });

  it("collects tracked and untracked changes into one reviewable patch", async () => {
    const root = await createGitFixture();
    await fs.writeFile(path.join(root, "tracked.txt"), "changed\n", "utf-8");
    await fs.writeFile(path.join(root, "new file.txt"), "new\n", "utf-8");

    const artifact = collectWorkspaceArtifact({ workspace: root, mode: "workspace-write" });

    expect(artifact.changedPaths).toEqual(["new file.txt", "tracked.txt"]);
    expect(artifact.patch).toContain("tracked.txt");
    expect(artifact.patch).toContain("new file.txt");
    expect(artifact.patch).toContain("+changed");
    expect(artifact.patch).toContain("+new");
  });

  it("fails closed for unexpected read-only writes and sensitive artifact paths", async () => {
    const planRoot = await createGitFixture();
    await fs.writeFile(path.join(planRoot, "tracked.txt"), "changed\n", "utf-8");
    expect(() => collectWorkspaceArtifact({ workspace: planRoot, mode: "plan" })).toThrow(/read-only/i);
    expect(() => collectWorkspaceArtifact({ workspace: planRoot, mode: "navigation-read" })).toThrow(/read-only/i);
    expect(() => collectWorkspaceArtifact({ workspace: planRoot, mode: "command-control" })).toThrow(/read-only/i);
    expect(() => collectWorkspaceArtifact({ workspace: planRoot, mode: "safety-probe" })).toThrow(/read-only/i);

    const sensitiveRoot = await createGitFixture();
    await fs.writeFile(path.join(sensitiveRoot, "credentials.json"), "{}\n", "utf-8");
    expect(() => collectWorkspaceArtifact({ workspace: sensitiveRoot, mode: "workspace-write" })).toThrow(/sensitive/i);
  });

  it("redacts secret-shaped diagnostics before persistence", () => {
    expect(sanitizeDiagnostic("apiKey=abc token: Bearer xyz ordinary=value"))
      .toBe("apiKey=[REDACTED] token:[REDACTED] ordinary=value");
  });

  it("runs the built Headless CLI through a real Gateway and emits review artifacts", async () => {
    const workspace = await createGitFixture();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-ci-state-"));
    tempRoots.push(stateDir);
    const artifactDir = path.join(stateDir, "artifacts");
    const promptPath = path.join(stateDir, "prompt.md");
    const outputSchemaPath = path.join(stateDir, "output.schema.json");
    await fs.writeFile(promptPath, "Review the fixture and return JSON.", "utf-8");
    await fs.writeFile(outputSchemaPath, JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["summary", "findings"],
      properties: {
        summary: { type: "string" },
        findings: { type: "array" },
      },
    }), "utf-8");
    const agent = {
      async *run() {
        yield { type: "final", text: JSON.stringify({ summary: "clean fixture", findings: [] }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      const result = await runNode([
        path.resolve("scripts/run-coding-agent-ci.mjs"),
        "--workspace", workspace,
        "--state-dir", stateDir,
        "--artifact-dir", artifactDir,
        "--prompt-file", promptPath,
        "--output-schema", outputSchemaPath,
        "--mode", "plan",
      ], workspace, {
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      });

      const diagnostics = await fs.readFile(path.join(artifactDir, "diagnostics.log"), "utf-8").catch(() => "");
      expect(result.exitCode, `${result.stderr}\n${diagnostics}`).toBe(0);
      const manifest = JSON.parse(await fs.readFile(path.join(artifactDir, "manifest.json"), "utf-8"));
      const output = JSON.parse(await fs.readFile(path.join(artifactDir, "result.json"), "utf-8"));
      const traceText = await fs.readFile(path.join(artifactDir, "trace.jsonl"), "utf-8");
      const trace = traceText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      expect(manifest).toMatchObject({
        schemaVersion: "coding-agent-ci/v1",
        protocolVersion: "v1",
        mode: "plan",
        automationProfile: "bare",
        cliExitCode: 0,
        terminalType: "run.completed",
        capabilities: fixtureCapabilities(),
        usage: {
          status: "incomplete",
          reason: "usage_not_reported",
        },
        trace: {
          schemaVersion: "coding-run-trace/v1",
          contentMode: "none",
          binding: manifest.binding,
          sourceEventCount: manifest.eventCount,
          terminal: "run.completed",
        },
        changedPaths: [],
        checks: {
          cleanBaseline: true,
          eventContract: true,
          capabilityHandshake: true,
          usageComplete: false,
          traceContract: true,
          artifactPolicy: true,
          automaticPush: false,
        },
      });
      expect(output).toEqual({ summary: "clean fixture", findings: [] });
      expect(trace.map((item) => item.seq)).toEqual(trace.map((_, index) => index + 1));
      expect(new Set(trace.map((item) => item.domain))).toEqual(new Set(["run", "prompt", "agent"]));
      expect(trace.every((item) => item.content?.mode === "none")).toBe(true);
      expect(traceText).not.toContain("Review the fixture and return JSON.");
      expect(traceText).not.toContain("clean fixture");
      await expect(fs.readFile(path.join(artifactDir, "changes.patch"), "utf-8")).resolves.toBe("");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("injects one exact cancellation after run.started and leaves no tool or workspace side effect", async () => {
    const workspace = await createGitFixture();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-ci-cancel-state-"));
    tempRoots.push(stateDir);
    const artifactDir = path.join(stateDir, "artifacts");
    const promptPath = path.join(stateDir, "prompt.md");
    const outputSchemaPath = path.join(stateDir, "output.schema.json");
    await fs.writeFile(promptPath, "Wait for benchmark cancellation.", "utf-8");
    await fs.writeFile(outputSchemaPath, JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string" } },
    }), "utf-8");

    let modelCallCount = 0;
    let abortSignalCount = 0;
    const agent = {
      async *run(input) {
        modelCallCount += 1;
        await new Promise((resolve) => {
          if (input.abortSignal?.aborted) {
            abortSignalCount += 1;
            resolve();
            return;
          }
          input.abortSignal?.addEventListener("abort", () => {
            abortSignalCount += 1;
            resolve();
          }, { once: true });
        });
        yield { type: "final", text: JSON.stringify({ summary: "must not be delivered" }) };
      },
    };
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      const result = await runNode([
        path.resolve("scripts/run-coding-agent-ci.mjs"),
        "--workspace", workspace,
        "--state-dir", stateDir,
        "--artifact-dir", artifactDir,
        "--prompt-file", promptPath,
        "--output-schema", outputSchemaPath,
        "--mode", "plan",
        "--cancel-on-run-start", "true",
      ], workspace, {
        BELLDANDY_HOST: "127.0.0.1",
        BELLDANDY_PORT: String(server.port),
        BELLDANDY_AUTH_MODE: "none",
      });

      const manifest = JSON.parse(await fs.readFile(path.join(artifactDir, "manifest.json"), "utf-8"));
      const cancellation = JSON.parse(await fs.readFile(path.join(artifactDir, "cancel-injection.json"), "utf-8"));
      const events = (await fs.readFile(path.join(artifactDir, "events.jsonl"), "utf-8"))
        .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

      expect(result.exitCode).not.toBe(0);
      expect(manifest).toMatchObject({
        terminalType: "run.cancelled",
        usage: { status: "incomplete", reason: "usage_not_reported" },
        changedPaths: [],
        checks: {
          eventContract: true,
          capabilityHandshake: true,
          usageComplete: false,
          artifactPolicy: true,
        },
      });
      expect(cancellation).toMatchObject({
        schemaVersion: "coding-agent-cancel-injection/v1",
        trigger: "run.started",
        status: "confirmed",
        observedStartedSeq: 1,
        cancellationRequestCount: 1,
        cancelExitCode: 0,
        binding: manifest.binding,
        terminalType: "run.cancelled",
      });
      expect(cancellation.terminalSeq).toBe(events.at(-1).seq);
      expect(events.filter((event) => event.type === "run.cancelled")).toHaveLength(1);
      expect(events.filter((event) => event.type.startsWith("tool.") || event.type === "permission.requested"))
        .toHaveLength(0);
      expect(modelCallCount).toBe(1);
      expect(abortSignalCount).toBe(1);
      await expect(fs.readFile(path.join(artifactDir, "changes.patch"), "utf-8")).resolves.toBe("");
    } finally {
      await server.close();
    }
  }, 20_000);
});

function event(seq, type, binding, payload) {
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

function isFixtureEvent(value) {
  return Boolean(
    value
      && value.version === "v1"
      && Number.isInteger(value.seq)
      && value.seq > 0
      && value.source === "conversation"
      && typeof value.binding?.agentRunId === "string"
      && typeof value.binding?.conversationId === "string"
      && typeof value.type === "string"
      && value.payload
      && typeof value.payload === "object",
  );
}

function fixtureCapabilities() {
  return {
    schemaVersion: "coding-run-capabilities/v1",
    protocolVersion: "v1",
    eventStream: {
      sequence: "continuous",
      terminal: "exactly_one",
      usageCompleteness: "terminal",
    },
    observability: {
      trace: {
        schemaVersion: "coding-run-trace/v1",
        contentMode: "none",
        bodyFields: [],
      },
    },
  };
}

function fixtureCompleteUsage() {
  return {
    status: "complete",
    reason: "provider_reported_all_model_calls",
    modelCalls: 1,
    providerReportedModelCalls: 1,
  };
}

function isFixtureCapabilities(value) {
  return JSON.stringify(value) === JSON.stringify(fixtureCapabilities());
}

function isFixtureUsageCompleteness(value) {
  return Boolean(
    value
      && (value.status === "complete" || value.status === "incomplete")
      && typeof value.reason === "string",
  );
}

async function createGitFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-ci-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CI Fixture"], { cwd: root });
  await fs.writeFile(path.join(root, "tracked.txt"), "baseline\n", "utf-8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
}

async function runNode(args, cwd, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
