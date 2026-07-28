import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { collectCodingAgentBenchmarkContractFailures } from "./verify-coding-agent-benchmark-contract.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");

describe("coding agent benchmark repository contract", () => {
  it("keeps the WSL2 host launcher wired into the public benchmark contract", async () => {
    const [packageJsonText, readme, projectMap] = await Promise.all([
      fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"),
      fs.readFile(path.join(workspaceRoot, "benchmarks/coding-agent/README.md"), "utf-8"),
      fs.readFile(path.join(workspaceRoot, "docs/project-map.md"), "utf-8"),
    ]);
    const packageJson = JSON.parse(packageJsonText);

    expect(packageJson.scripts["benchmark:coding-agent:stage0c:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:interactive:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id command.interactive-control",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:interactive:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id command.interactive-control",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:safety:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id safety.boundary-enforcement",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:safety:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id safety.boundary-enforcement",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:recovery:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.disconnect-recovery",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:recovery:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.disconnect-recovery",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:cancel:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.client-cancel",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:cancel:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.client-cancel",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:git:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id git.dirty-worktree,git.delivery-guard",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0c:git:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id git.dirty-worktree,git.delivery-guard",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0d:core:windows"]).toBe(
      "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository",
    );
    expect(packageJson.scripts["benchmark:coding-agent:stage0d:core:wsl"]).toBe(
      "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository",
    );
    expect(packageJson.scripts["aggregate:coding-agent:baseline"]).toBe(
      "node scripts/aggregate-coding-agent-benchmark.mjs",
    );
    expect(readme).toContain("benchmark:coding-agent:stage0c:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:interactive:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:interactive:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:safety:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:safety:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:recovery:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:recovery:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0c:cancel:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:cancel:wsl");
    expect(readme).toContain("gateway.client-cancel");
    expect(readme).toContain("benchmark:coding-agent:stage0c:git:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0c:git:wsl");
    expect(readme).toContain("benchmark:coding-agent:stage0d:core:windows");
    expect(readme).toContain("benchmark:coding-agent:stage0d:core:wsl");
    expect(readme).toContain("feature.cross-file");
    expect(readme).toContain("tests.failed-diagnosis");
    expect(readme).toContain("navigation.large-repository");
    expect(readme).toContain("aggregate:coding-agent:baseline");
    expect(readme).toContain("baseline-index.json");
    expect(readme).toContain("git.dirty-worktree");
    expect(readme).toContain("git.delivery-guard");
    expect(readme).toContain("回退到 primary");
    expect(readme).toContain("v2/agents.json");
    expect(readme).toContain("maxHighRiskToolCalls=5");
    expect(projectMap).toContain("scripts/run-coding-agent-benchmark-wsl.mjs");
    expect(projectMap).toContain("benchmarks/coding-agent/v2/agents.json");
    expect(projectMap).toContain("scripts/coding-agent-recovery-harness.mjs");
    expect(projectMap).toContain("scripts/aggregate-coding-agent-benchmark.mjs");
  });

  it("publishes a fail-closed Schema for the external Gateway fault artifact", async () => {
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v1/fault-injection.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const recovered = {
      schemaVersion: "coding-agent-fault-injection/v1",
      taskId: "gateway.disconnect-recovery",
      fault: "gateway_disconnect",
      status: "recovered",
      disconnectedAfterSeq: 4,
      resumedFromSeq: 4,
      disconnectCount: 1,
      reconnectCount: 1,
      binding: { conversationId: "conversation-recovery", agentRunId: "run-recovery" },
    };
    expect(compiled.validator.validateOutput(JSON.stringify(recovered))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...recovered,
      reconnectCount: 0,
    }))).toMatchObject({ ok: false });
  });

  it("publishes a fail-closed Schema for the external client cancellation artifact", async () => {
    const schema = JSON.parse(await fs.readFile(path.join(
      workspaceRoot,
      "benchmarks/coding-agent/v1/cancel-injection.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const confirmed = {
      schemaVersion: "coding-agent-cancel-injection/v1",
      trigger: "run.started",
      status: "confirmed",
      observedStartedSeq: 1,
      cancellationRequestCount: 1,
      cancelExitCode: 0,
      binding: { conversationId: "conversation-cancel", agentRunId: "run-cancel" },
      terminalType: "run.cancelled",
      terminalSeq: 2,
    };
    expect(compiled.validator.validateOutput(JSON.stringify(confirmed))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...confirmed,
      cancellationRequestCount: 0,
    }))).toMatchObject({ ok: false });
  });

  it("keeps the manifest, schemas, documentation, scripts, and cross-platform gate aligned", async () => {
    await expect(collectCodingAgentBenchmarkContractFailures({ workspaceRoot })).resolves.toEqual([]);
  });

  it("fails closed when the standalone run artifact Schema is missing", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-benchmark-contract-"));
    const fixturePaths = [
      "package.json",
      "benchmarks/coding-agent/v1/task-manifest.json",
      "benchmarks/coding-agent/v1/task-manifest.schema.json",
      "benchmarks/coding-agent/v1/benchmark-report.schema.json",
      "benchmarks/coding-agent/README.md",
      "docs/project-map.md",
      ".github/workflows/quality-gates.yml",
    ];
    try {
      for (const relativePath of fixturePaths) {
        const target = path.join(fixtureRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(workspaceRoot, relativePath), target);
      }

      const failures = await collectCodingAgentBenchmarkContractFailures({ workspaceRoot: fixtureRoot });
      expect(failures).toEqual(expect.arrayContaining([
        expect.stringMatching(/benchmark-run\.schema\.json is missing/i),
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
