import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildP2ASubTaskSupervisorSoakReport,
  compareP2ASubTaskSupervisorSoakReports,
  createWorkspaceResourceDelta,
  parseP2ASubTaskSupervisorSoakCliArguments,
  readP2ASubTaskSupervisorSourceIdentity,
  writeP2ASubTaskSupervisorSoakReport,
} from "./run-subtask-supervisor-soak.mjs";

const temporaryRoots = [];
const reportSchemaPath = path.resolve(
  "benchmarks/supervisor/v1/p2a-subtask-supervisor-soak-report.schema.json",
);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("P2-A SubTask Supervisor soak", () => {
  it("accepts a 60 minute 4-write/8-read run with exact run-owned cleanup", async () => {
    const platform = currentPlatform();
    const report = await buildP2ASubTaskSupervisorSoakReport({
      platform,
      durationMs: 60 * 60 * 1000,
      cycleIntervalMs: 120_000,
      generatedAt: "2026-08-13T16:00:00.000Z",
      runtimeFactory: async () => passingRuntimeEvidence(),
    });

    expect(report.schemaVersion).toBe("p2a-subtask-supervisor-soak-report/v1");
    expect(report.workload).toMatchObject({
      writeLanesPerCycle: 4,
      readLanesPerCycle: 8,
      laneAttempts: 360,
      laneSucceeded: 360,
      successRate: 1,
      firstFailureCode: null,
    });
    expect(report.resources).toMatchObject({
      preExisting: {
        worktreeCount: 9,
        managedBranchCount: 0,
        relevantProcessCount: 8,
      },
      differential: {
        addedWorktreeCount: 0,
        addedManagedBranchCount: 0,
        addedRelevantProcessCount: 0,
      },
      runOwned: {
        activeSupervisorChildren: 0,
        worktreeCount: 0,
        managedBranchCount: 0,
        processCount: 0,
        receiptCount: 0,
        lockCount: 0,
        temporaryFileCount: 0,
        stateRootExists: false,
        temporaryRootExists: false,
      },
    });
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(JSON.stringify(report)).not.toContain("E:\\private");
    expect(validateAgainstSchema(await readJson(reportSchemaPath), report)).toMatchObject({ ok: true });

    const counterpart = structuredClone(report);
    counterpart.platform = platform === "windows-native" ? "wsl2-linux" : "windows-native";
    expect(compareP2ASubTaskSupervisorSoakReports(report, counterpart)).toEqual({
      passed: true,
      failures: [],
    });
    counterpart.sourceIdentity.aggregateSha256 = "f".repeat(64);
    expect(compareP2ASubTaskSupervisorSoakReports(report, counterpart)).toEqual({
      passed: false,
      failures: ["source_identity_mismatch"],
    });
  });

  it("fails closed for a short run, uncertain disposal, or newly-added residue", async () => {
    const evidence = passingRuntimeEvidence();
    evidence.durationMs = 59 * 60 * 1000;
    evidence.disposal.uncertainCount = 1;
    evidence.workspaceAfter = {
      ...evidence.workspaceAfter,
      worktrees: ["main", "historical-1", "new-run-worktree"],
    };
    evidence.runOwned.stateRootExists = true;

    const report = await buildP2ASubTaskSupervisorSoakReport({
      platform: currentPlatform(),
      durationMs: 60 * 60 * 1000,
      cycleIntervalMs: 120_000,
      runtimeFactory: async () => evidence,
    });

    expect(report.gate).toEqual({
      passed: false,
      failures: [
        "duration_gate_failed",
        "disposal_uncertain",
        "workspace_worktree_residue",
        "run_state_residue",
      ],
    });
  });

  it("compares resource identity without treating a pre-existing baseline as run residue", () => {
    expect(createWorkspaceResourceDelta(
      {
        worktrees: ["main", "historical"],
        managedBranches: ["belldandy-existing"],
        relevantProcesses: ["process-existing"],
      },
      {
        worktrees: ["main", "historical", "new-worktree"],
        managedBranches: ["belldandy-existing"],
        relevantProcesses: ["process-existing", "process-new"],
      },
    )).toEqual({
      addedWorktreeCount: 1,
      addedManagedBranchCount: 0,
      addedRelevantProcessCount: 1,
    });
  });

  it("binds both source and executed dist runtime files into the report identity", async () => {
    const identity = await readP2ASubTaskSupervisorSourceIdentity();
    const paths = identity.files.map((item) => item.path);
    expect(paths).toContain("packages/belldandy-core/src/subtask-supervisor-runtime.ts");
    expect(paths).toContain("packages/belldandy-core/dist/subtask-supervisor-runtime.js");
    expect(paths).toContain("scripts/subtask-supervisor-soak-cleanup-watchdog.mjs");
    expect(identity.aggregateSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("parses bounded explicit inputs and writes a report only once", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-p2a-soak-report-"));
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const platform = currentPlatform();
    expect(parseP2ASubTaskSupervisorSoakCliArguments([
      "--platform", platform,
      "--duration-minutes", "60",
      "--cycle-interval-seconds", "120",
      "--output", outputPath,
    ])).toEqual({
      platform,
      durationMs: 60 * 60 * 1000,
      cycleIntervalMs: 120_000,
      outputPath,
    });
    expect(() => parseP2ASubTaskSupervisorSoakCliArguments(["--duration-minutes", "1"]))
      .toThrow(/platform/u);
    expect(() => parseP2ASubTaskSupervisorSoakCliArguments([
      "--platform", platform,
      "--output", outputPath,
      "--cycle-interval-seconds", "0",
    ])).toThrow(/cycle-interval-seconds/u);

    const report = await buildP2ASubTaskSupervisorSoakReport({
      platform,
      durationMs: 60 * 60 * 1000,
      cycleIntervalMs: 120_000,
      runtimeFactory: async () => passingRuntimeEvidence(),
    });
    await writeP2ASubTaskSupervisorSoakReport(report, outputPath);
    await expect(writeP2ASubTaskSupervisorSoakReport(report, outputPath)).rejects.toThrow(/already exists/u);
  });
});

function passingRuntimeEvidence() {
  return {
    durationMs: 60 * 60 * 1000,
    cycles: 30,
    laneAttempts: 360,
    laneSucceeded: 360,
    laneFailed: 0,
    writeLaneAttempts: 120,
    readLaneAttempts: 240,
    activeSupervisorChildren: 0,
    interruption: {
      attempted: 30,
      recovered: 30,
    },
    disposal: {
      completedCount: 30,
      uncertainCount: 0,
      duplicateSideEffectCount: 0,
    },
    workspaceBefore: {
      worktrees: ["main", ...Array.from({ length: 8 }, (_, index) => `historical-${index + 1}`)],
      managedBranches: [],
      relevantProcesses: Array.from({ length: 8 }, (_, index) => `process-${index + 1}`),
    },
    workspaceAfter: {
      worktrees: ["main", ...Array.from({ length: 8 }, (_, index) => `historical-${index + 1}`)],
      managedBranches: [],
      relevantProcesses: Array.from({ length: 8 }, (_, index) => `process-${index + 1}`),
    },
    runOwned: {
      worktreeCount: 0,
      managedBranchCount: 0,
      processCount: 0,
      receiptCount: 0,
      lockCount: 0,
      temporaryFileCount: 0,
      stateRootExists: false,
      temporaryRootExists: false,
    },
    firstFailureCode: null,
  };
}

function currentPlatform() {
  return process.platform === "win32" ? "windows-native" : "wsl2-linux";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

function validateAgainstSchema(schema, value) {
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) return compiled;
  return compiled.validator.validateOutput(JSON.stringify(value));
}
