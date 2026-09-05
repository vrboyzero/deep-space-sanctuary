import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimCandidateSlot, completeCandidateSlot, inspectCandidateSlotJournal,
  assertCandidateCostGuard,
  closeCandidateSession,
} from "./coding-agent-candidate-session.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-journal-test-"));
  roots.push(root);
  return {
    workspaceRoot: root, ledgerRoot: path.join(root, "session-a"), configSha256: "a".repeat(64),
    costBaseline: { path: path.join(root, "baseline.json"), sha256: "e".repeat(64) },
    slots: [
      { taskId: "real-ts.api-migration", platform: "windows-native", attempt: 1 },
      { taskId: "bug.reproducible-fix", platform: "windows-native", attempt: 1 },
    ],
    baseline: { providerReportedCostUsd: 2, reservedUnknownCostUsd: 1 },
  };
}

const terminal = () => ({
  status: "reported", reportSha256: "b".repeat(64), artifactHashes: { events: "c".repeat(64) },
  providerReportedCostUsd: 0.001, reservedUnknownCostUsd: 0,
  runnerExit: 0, resourcesClosed: true,
});

describe("candidate slot journal", () => {
  it("reserves the full run cost durably before dispatch and blocks an interrupted slot", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    const state = await inspectCandidateSlotJournal(context);
    expect(state).toMatchObject({
      processed: 0, pending: 1, providerReportedCostUsd: 2, reservedUnknownCostUsd: 1.1,
    });
    expect(state.unexecuted).toEqual([context.slots[1]]);
    await expect(claimCandidateSlot(context, context.slots[0])).rejects.toThrow(/EEXIST/);
  });

  it("keeps completed failed or passed reports immutable and charges them exactly once on resume", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    await completeCandidateSlot(context, context.slots[0], terminal());
    const first = await inspectCandidateSlotJournal(context);
    expect(first).toMatchObject({ processed: 1, pending: 0, providerReportedCostUsd: 2.001, reservedUnknownCostUsd: 1 });
    expect(await inspectCandidateSlotJournal(context)).toEqual(first);
    await expect(completeCandidateSlot(context, context.slots[0], terminal())).rejects.toThrow(/EEXIST/);
  });

  it("prevents two launchers from claiming the same slot", async () => {
    const context = await fixture();
    const results = await Promise.allSettled([
      claimCandidateSlot(context, context.slots[0]), claimCandidateSlot(context, context.slots[0]),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect((await inspectCandidateSlotJournal(context)).pending).toBe(1);
  });

  it("prevents another session from spending against the same inherited ledger", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    await completeCandidateSlot(context, context.slots[0], terminal());
    const other = { ...context, ledgerRoot: path.join(context.workspaceRoot, "session-b"), configSha256: "f".repeat(64) };
    await expect(claimCandidateSlot(other, other.slots[0])).rejects.toThrow(/authority|active session|baseline/);
    expect((await inspectCandidateSlotJournal(other)).entries).toHaveLength(0);
  });

  it("chains the next session to final costs and prevents reopening its predecessor", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    await completeCandidateSlot(context, context.slots[0], terminal());
    await expect(closeCandidateSession(context, { lifecycle: "complete", reasons: [] })).rejects.toThrow(/incomplete/);
    const costBaseline = await closeCandidateSession(context, { lifecycle: "frozen", reasons: ["hard_gate"] });
    await expect(claimCandidateSlot(context, context.slots[1])).rejects.toThrow(/closed/);
    const state = await inspectCandidateSlotJournal(context);
    const other = {
      ...context, ledgerRoot: path.join(context.workspaceRoot, "session-b"), configSha256: "f".repeat(64),
      costBaseline, baseline: { providerReportedCostUsd: state.providerReportedCostUsd, reservedUnknownCostUsd: state.reservedUnknownCostUsd },
    };
    await expect(claimCandidateSlot({ ...other, costBaseline: context.costBaseline }, other.slots[0])).rejects.toThrow(/baseline/);
    await claimCandidateSlot(other, other.slots[0]);
    expect(await inspectCandidateSlotJournal(other)).toMatchObject({ providerReportedCostUsd: 2.001, reservedUnknownCostUsd: 1.1 });
    await expect(claimCandidateSlot(context, context.slots[1])).rejects.toThrow(/active session|baseline/);
  });

  it("rejects configuration drift, unknown slots and report completion without an intent", async () => {
    const context = await fixture();
    await expect(completeCandidateSlot(context, context.slots[0], terminal())).rejects.toThrow(/ENOENT/);
    await expect(claimCandidateSlot(context, { ...context.slots[0], attempt: 2 })).rejects.toThrow(/selected/);
    await claimCandidateSlot(context, context.slots[0]);
    await expect(inspectCandidateSlotJournal({ ...context, configSha256: "d".repeat(64) })).rejects.toThrow(/binding/);
  });

  it("does not release cost ownership when a frozen session has uncertain resources", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    await completeCandidateSlot(context, context.slots[0], {
      status: "unreported", reportSha256: null, artifactHashes: {}, providerReportedCostUsd: 0,
      reservedUnknownCostUsd: 0.1, runnerExit: 1, resourcesClosed: false,
    });
    const costBaseline = await closeCandidateSession(context, { lifecycle: "frozen", reasons: ["resources_uncertain"] });
    const other = { ...context, ledgerRoot: path.join(context.workspaceRoot, "session-b"), configSha256: "f".repeat(64),
      costBaseline, baseline: { providerReportedCostUsd: 2, reservedUnknownCostUsd: 1.1 } };
    await expect(claimCandidateSlot(other, other.slots[0])).rejects.toThrow(/resource cleanup/);
  });

  it("retains unknown cost for a no-report terminal", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    await completeCandidateSlot(context, context.slots[0], {
      status: "unreported", reportSha256: null, artifactHashes: {}, providerReportedCostUsd: 0,
      reservedUnknownCostUsd: 0.1, runnerExit: 1, resourcesClosed: true,
    });
    expect(await inspectCandidateSlotJournal(context)).toMatchObject({ processed: 1, pending: 0, unreported: 1, reservedUnknownCostUsd: 1.1 });
  });

  it("rejects changing the selection or inherited costs after the first dispatch", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    await expect(inspectCandidateSlotJournal({ ...context, slots: [context.slots[1]] })).rejects.toThrow(/binding/);
    await expect(inspectCandidateSlotJournal({ ...context, baseline: { providerReportedCostUsd: 0, reservedUnknownCostUsd: 0 } })).rejects.toThrow(/binding/);
  });

  it("rejects nonfinite or out-of-budget usage without releasing the existing reservation", async () => {
    const context = await fixture();
    await claimCandidateSlot(context, context.slots[0]);
    for (const cost of [-1, NaN, 0.1001]) {
      await expect(completeCandidateSlot(context, context.slots[0], { ...terminal(), providerReportedCostUsd: cost })).rejects.toThrow(/cost/);
    }
    expect((await inspectCandidateSlotJournal(context)).reservedUnknownCostUsd).toBe(1.1);
  });

  it("stops before the next request can reach either the global or candidate limit", () => {
    expect(assertCandidateCostGuard({ providerReportedCostUsd: 2.43983027, reservedUnknownCostUsd: 2.24221, candidateProviderReportedCostUsd: 0 })).toMatchObject({ nextWorstRmb: 38.25632216 });
    expect(() => assertCandidateCostGuard({ providerReportedCostUsd: 9.9, reservedUnknownCostUsd: 0, candidateProviderReportedCostUsd: 0 })).toThrow(/80 RMB/);
    expect(() => assertCandidateCostGuard({ providerReportedCostUsd: 4.9, reservedUnknownCostUsd: 0, candidateProviderReportedCostUsd: 4.9 })).toThrow(/runner/);
    expect(() => assertCandidateCostGuard({ providerReportedCostUsd: NaN, reservedUnknownCostUsd: 0, candidateProviderReportedCostUsd: 0 })).toThrow(/cost/);
  });
});
