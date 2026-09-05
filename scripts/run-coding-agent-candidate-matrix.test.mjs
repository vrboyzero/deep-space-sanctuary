import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { loadCodingAgentBenchmarkManifest, resolveCodingAgentBenchmarkManifestPath } from "./coding-agent-benchmark-contract.mjs";
import { loadCodingAgentBenchmarkScorecardV3 } from "./coding-agent-benchmark-v3-contract.mjs";
import { loadCodingAgentCandidateDimensionMapping } from "./coding-agent-candidate-score.mjs";
import { claimCandidateSlot, inspectCandidateSlotJournal } from "./coding-agent-candidate-session.mjs";
import { runCodingAgentCandidateMatrix } from "./run-coding-agent-candidate-matrix.mjs";

let manifest;
let scorecard;
let mapping;
const roots = [];
beforeAll(async () => {
  manifest = await loadCodingAgentBenchmarkManifest(resolveCodingAgentBenchmarkManifestPath("v3"));
  scorecard = await loadCodingAgentBenchmarkScorecardV3();
  mapping = await loadCodingAgentCandidateDimensionMapping({ manifest, scorecard });
});
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture({ mode = "formal", failTask = null, exit = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-matrix-test-"));
  roots.push(root);
  const tasks = [...manifest.tasks].sort((a, b) => Number(b.id === "real-ts.api-migration") - Number(a.id === "real-ts.api-migration"));
  const allSlots = tasks.flatMap((task) => task.platforms.flatMap((platform) => [1, 2, 3].map((attempt) => ({ taskId: task.id, platform, attempt }))));
  const selection = mode === "formal" ? allSlots : allSlots.slice(0, 2);
  const config = {
    workspaceRoot: root, mode, selection,
    roots: Object.fromEntries(["artifacts", "fixtures", "state", "ledger"].map((name) => [name, path.join(root, name)])),
  };
  const context = {
    config, configSha256: "a".repeat(64), manifest, scorecard, mapping,
    journal: {
      workspaceRoot: root, ledgerRoot: config.roots.ledger, configSha256: "a".repeat(64), slots: selection,
      costBaseline: { path: path.join(root, "baseline.json"), sha256: "b".repeat(64) },
      baseline: { providerReportedCostUsd: 2, reservedUnknownCostUsd: 1 },
    },
  };
  const executed = new Set();
  const dependencies = {
    loadMaterials: async () => context,
    checkResources: vi.fn(async () => {}), prepareRuntime: vi.fn(async () => {}),
    execute: vi.fn(async (_context, slot) => {
      expect((await inspectCandidateSlotJournal(context.journal)).pending).toBe(1);
      executed.add(JSON.stringify(slot)); return exit;
    }),
    recycle: vi.fn(async () => {}), postRun: vi.fn(async () => {}),
    readObservation: vi.fn(async (_context, slot, expected) => {
      if (!executed.has(JSON.stringify(slot))) throw new Error("missing report");
      const failed = slot.taskId === failTask;
      return {
        observation: {
          run: {
            ...slot, status: failed ? "failed" : "passed", failureCategory: failed ? "product_workflow" : null,
            execution: { infrastructureRetries: 0 },
            evaluation: { taskCompleted: !failed, testsPassed: true, patchAccepted: true, regressionCount: 0,
              dangerousOperationBlocked: true, recoverySucceeded: true, manualInterventionCount: 0 },
          },
          checks: { traceComplete: true, usageComplete: true, sensitiveFindingCount: 0, orphanResourceCount: 0,
            systemCriticalPassed: slot.taskId.startsWith("system.") ? true : null },
        },
        terminal: { status: "reported", reportSha256: "c".repeat(64), artifactHashes: { events: "d".repeat(64) },
          providerReportedCostUsd: 0.001, reservedUnknownCostUsd: 0, runnerExit: expected?.runnerExit ?? 0, resourcesClosed: true },
      };
    }),
  };
  return { context, dependencies, run: (count) => runCodingAgentCandidateMatrix({ configPath: path.join(root, "config.json"), maxNewRuns: count }, dependencies) };
}

describe("shared candidate matrix orchestration", () => {
  it("keeps an ordinary failed slot and resumes at the next slot without charging twice", async () => {
    const f = await fixture({ failTask: "real-ts.api-migration" });
    expect(await f.run(1)).toMatchObject({ progress: { status: "continue" }, newlyExecuted: 1 });
    const intentPath = path.join(f.context.config.roots.ledger, "slots", "real-ts.api-migration.windows-native.a1", "terminal.json");
    const original = await fs.readFile(intentPath, "utf8");
    const next = await f.run(1);
    expect(next.costs).toMatchObject({ processed: 2, providerReportedCostUsd: 2.002 });
    expect(f.dependencies.execute.mock.calls.map((call) => call[1].attempt)).toEqual([1, 2]);
    expect(await fs.readFile(intentPath, "utf8")).toBe(original);
  });

  it("makes maxNewRuns zero read-only even when a pending dispatch exists", async () => {
    const f = await fixture();
    await claimCandidateSlot(f.context.journal, f.context.config.selection[0]);
    const before = await fs.readdir(f.context.config.roots.ledger, { recursive: true });
    expect(await f.run(0)).toMatchObject({ newlyExecuted: 0, ledgerPath: null });
    expect(await fs.readdir(f.context.config.roots.ledger, { recursive: true })).toEqual(before);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });

  it("closes a fixed exploration cohort and never promotes or replays its observations", async () => {
    const f = await fixture({ mode: "exploration" });
    expect(await f.run(2)).toMatchObject({ progress: { status: "complete", qualification: "unscored" }, remainingSelected: 0 });
    expect((await inspectCandidateSlotJournal(f.context.journal)).closure?.lifecycle).toBe("complete");
    expect(await f.run(2)).toMatchObject({ newlyExecuted: 0, progress: { status: "complete" } });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(2);
  });

  it("retains a no-report reservation and freezes the session before another launch", async () => {
    const f = await fixture();
    f.dependencies.readObservation.mockRejectedValue(new Error("missing evidence"));
    expect(await f.run(3)).toMatchObject({ newlyExecuted: 1, progress: { status: "stop" }, costs: { unreported: 1, reservedUnknownCostUsd: 1.1 } });
    expect((await inspectCandidateSlotJournal(f.context.journal)).closure?.lifecycle).toBe("frozen");
    expect(await f.run(3)).toMatchObject({ newlyExecuted: 0 });
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps a nonzero runner exit with a passed report uncertain without inventing verified usage", async () => {
    const f = await fixture({ exit: 1 });
    expect(await f.run(2)).toMatchObject({ newlyExecuted: 1, progress: { status: "stop" }, costs: { unreported: 1, reservedUnknownCostUsd: 1.1 } });
    expect(await f.run(1)).toMatchObject({ newlyExecuted: 0 });
  });

  it("rejects artifact drift on resume before any new dispatch", async () => {
    const f = await fixture();
    await f.run(1);
    f.dependencies.readObservation.mockRejectedValue(new Error("artifact drift"));
    await expect(f.run(1)).rejects.toThrow(/artifact drift/);
    expect(f.dependencies.execute).toHaveBeenCalledTimes(1);
  });

  it("does not reserve cost when the resource gate fails before dispatch", async () => {
    const f = await fixture();
    f.dependencies.checkResources.mockRejectedValue(new Error("resource busy"));
    await expect(f.run(1)).rejects.toThrow(/resource busy/);
    expect((await inspectCandidateSlotJournal(f.context.journal)).entries).toHaveLength(0);
    expect(f.dependencies.execute).not.toHaveBeenCalled();
  });
});
