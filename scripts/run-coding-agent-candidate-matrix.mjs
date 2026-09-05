import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { candidateRunPaths, loadCandidateMaterials, readCandidateRunObservation } from "./coding-agent-candidate-materials.mjs";
import { evaluateCodingAgentCandidateProgress } from "./coding-agent-candidate-progress.mjs";
import { assertCandidateCostGuard, claimCandidateSlot, closeCandidateSession, completeCandidateSlot, inspectCandidateSlotJournal } from "./coding-agent-candidate-session.mjs";
import { checkCandidateResources, executeCandidateRuntime, prepareCandidateRuntime, recordCandidatePostRunResources, recycleCandidateRuntimeEnv } from "./coding-agent-candidate-runtime.mjs";

export async function runCodingAgentCandidateMatrix(input, dependencies = {}) {
  if (!Number.isSafeInteger(input?.maxNewRuns) || input.maxNewRuns < 0 || input.maxNewRuns > 144) {
    throw new Error("Candidate maxNewRuns must be an integer from 0 to 144.");
  }
  const load = dependencies.loadMaterials ?? loadCandidateMaterials;
  const context = await load(input.configPath);
  const readObservation = dependencies.readObservation ?? readCandidateRunObservation;
  const checkResources = dependencies.checkResources ?? checkCandidateResources;
  const prepareRuntime = dependencies.prepareRuntime ?? prepareCandidateRuntime;
  const execute = dependencies.execute ?? executeCandidateRuntime;
  const recycle = dependencies.recycle ?? recycleCandidateRuntimeEnv;
  const postRun = dependencies.postRun ?? recordCandidatePostRunResources;
  let newlyExecuted = 0;

  async function inspect() {
    const journal = await inspectCandidateSlotJournal(context.journal);
    const observations = [];
    for (const entry of journal.entries) {
      if (!entry.terminal || entry.terminal.result.status !== "reported") continue;
      const verified = await readObservation(context, entry.slot, entry.terminal.result);
      assert.deepEqual(verified.terminal, entry.terminal.result, "Candidate terminal usage or artifacts drifted.");
      observations.push(verified.observation);
    }
    const progress = evaluateCodingAgentCandidateProgress({
      manifest: context.manifest, scorecard: context.scorecard, mapping: context.mapping,
      mode: context.config.mode, lifecycle: journal.closure?.lifecycle === "frozen" ? "frozen" : "active", observations,
      unreportedCount: journal.pending + journal.unreported,
    });
    if (progress.status === "continue" && context.config.mode === "exploration" && journal.unexecuted.length === 0) {
      progress.status = "complete";
      progress.remaining = 0;
    }
    return { journal, progress };
  }

  let state = await inspect();
  while (newlyExecuted < input.maxNewRuns && state.progress.status === "continue" && state.journal.unexecuted.length > 0) {
    const slot = state.journal.unexecuted[0];
    const paths = candidateRunPaths(context.config, slot);
    for (const target of [paths.stateRoot, paths.fixtureRoot, paths.artifactRoot, paths.bindingPath]) {
      const stats = await fs.lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (stats) throw new Error("Candidate run output already exists; it cannot be dispatched again.");
    }
    await checkResources(input.configPath);
    assertCandidateCostGuard(state.journal);
    await claimCandidateSlot(context.journal, slot);
    const sensitiveValues = new Set();
    let runnerExit = 1;
    let failureCode = null;
    let resourcesClosed = false;
    try {
      await prepareRuntime(context, paths, slot);
      runnerExit = await execute(context, slot, paths, state.journal, sensitiveValues);
    } catch {
      failureCode = "runner_failed";
    }
    try {
      await recycle(paths);
      await postRun(context, input.configPath, paths, sensitiveValues);
      resourcesClosed = true;
    } catch {
      failureCode = "cleanup_or_resource_failed";
    }
    sensitiveValues.clear();
    let terminal;
    try {
      if (failureCode) throw new Error("Candidate execution or resources remain uncertain.");
      const verified = await readObservation(context, slot);
      terminal = { ...verified.terminal, runnerExit };
      if (runnerExit !== 0 && verified.observation.run.status === "passed") {
        failureCode = "runner_exit_inconsistent";
        throw new Error("Candidate passed report conflicts with the runner exit.");
      }
    } catch {
      failureCode ??= "report_unverified";
      terminal = { status: "unreported", reportSha256: null, artifactHashes: {},
        providerReportedCostUsd: 0, reservedUnknownCostUsd: 0.1, runnerExit, resourcesClosed };
    }
    await completeCandidateSlot(context.journal, slot, terminal);
    newlyExecuted += 1;
    if (dependencies.onProgress) await dependencies.onProgress({ slot, status: terminal.status, failureCode });
    state = await inspect();
    if (failureCode) break;
  }
  if (input.maxNewRuns > 0 && state.journal.entries.length > 0 && ["stop", "complete"].includes(state.progress.status)) {
    if (!state.journal.closure) {
      await closeCandidateSession(context.journal, {
        lifecycle: state.progress.status === "complete" ? "complete" : "frozen", reasons: state.progress.reasons,
      });
      state = await inspect();
    }
  }
  const costs = {
    schemaVersion: "coding-agent-candidate-cost-ledger/v1",
    configSha256: context.configSha256,
    mode: context.config.mode,
    processed: state.journal.processed,
    pending: state.journal.pending,
    unreported: state.journal.unreported,
    providerReportedCostUsd: state.journal.providerReportedCostUsd,
    reservedUnknownCostUsd: state.journal.reservedUnknownCostUsd,
    candidateProviderReportedCostUsd: state.journal.candidateProviderReportedCostUsd,
  };
  const ledgerPath = state.journal.closure ? path.join(context.config.roots.ledger, "cost-ledger-final.json") : null;
  return {
    mode: context.config.mode, configSha256: context.configSha256,
    progress: state.progress, selected: context.config.selection.length,
    remainingSelected: state.journal.unexecuted.length, newlyExecuted,
    costs, ledgerPath,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--max-new-runs") {
    throw new Error("Usage: node --import tsx scripts/run-coding-agent-candidate-matrix.mjs --config <json> --max-new-runs <0-144>");
  }
  const result = await runCodingAgentCandidateMatrix({ configPath: args[1], maxNewRuns: Number(args[3]) }, {
    onProgress: (event) => console.log(JSON.stringify({ event: "candidate_slot_terminal", ...event })),
  });
  console.log(JSON.stringify(result));
  if (["pause", "stop"].includes(result.progress.status)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Candidate runner stopped; inspect the retained configuration, journal and run diagnostics."); process.exitCode = 1; });
}
