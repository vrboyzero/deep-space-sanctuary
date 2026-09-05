import fs from "node:fs/promises";
import path from "node:path";

import { assertCandidateOrdinaryPath, assertCandidatePathWithin, candidateSha256, candidateSlotKey, readCandidateFile } from "./coding-agent-candidate-config.mjs";
import { verifyCandidateResourceRecovery } from "./coding-agent-candidate-resource-recovery.mjs";

const VERSION = "coding-agent-candidate-slot-journal/v1";
const SINGLE_RUN_USD = 0.1;

export function assertCandidateCostGuard(cost) {
  for (const field of ["providerReportedCostUsd", "reservedUnknownCostUsd", "candidateProviderReportedCostUsd"]) {
    if (!Number.isFinite(cost[field]) || cost[field] < 0) throw new Error("Candidate cost is invalid.");
  }
  const nextWorstUsd = cost.providerReportedCostUsd + cost.reservedUnknownCostUsd + SINGLE_RUN_USD;
  if (nextWorstUsd >= 10 - 1e-12) throw new Error("The next request could reach the 80 RMB guard.");
  if (cost.candidateProviderReportedCostUsd + SINGLE_RUN_USD >= 5 - 1e-12) {
    throw new Error("The next request could reach the benchmark runner guard.");
  }
  return { nextWorstUsd, nextWorstRmb: Math.round(nextWorstUsd * 8 * 1e8) / 1e8, singleRunMaxUsd: SINGLE_RUN_USD };
}

export async function inspectCandidateSlotJournal(context) {
  assertContext(context);
  const binding = await readOptional(path.join(context.ledgerRoot, "session-binding.json"));
  if (binding && JSON.stringify(binding) !== JSON.stringify(contextBinding(context))) {
    throw new Error("Candidate journal session binding drifted.");
  }
  const entries = [];
  const unexecuted = [];
  let pending = 0;
  let unreported = 0;
  let candidateProviderReportedCostUsd = 0;
  let newlyReservedCostUsd = 0;
  for (const slot of context.slots) {
    const paths = slotPaths(context, slot);
    const intent = await readOptional(paths.intent);
    const terminal = await readOptional(paths.terminal);
    if (!intent) {
      if (terminal) throw new Error("Candidate terminal has no dispatch intent.");
      unexecuted.push(slot);
      continue;
    }
    if (!binding) throw new Error("Candidate journal session binding is missing.");
    assertBinding(context, slot, intent, "intent");
    if (intent.reservedUnknownCostUsd !== SINGLE_RUN_USD) throw new Error("Candidate intent cost reservation drifted.");
    if (!terminal) {
      pending += 1;
      newlyReservedCostUsd += SINGLE_RUN_USD;
    } else {
      assertBinding(context, slot, terminal, "terminal");
      validateTerminal(terminal.result);
      candidateProviderReportedCostUsd += terminal.result.providerReportedCostUsd;
      newlyReservedCostUsd += terminal.result.reservedUnknownCostUsd;
      if (terminal.result.status === "unreported") unreported += 1;
    }
    entries.push({ slot, intent, terminal });
  }
  const state = {
    processed: entries.length - pending, pending, unreported, entries, unexecuted,
    candidateProviderReportedCostUsd,
    providerReportedCostUsd: context.baseline.providerReportedCostUsd + candidateProviderReportedCostUsd,
    reservedUnknownCostUsd: context.baseline.reservedUnknownCostUsd + newlyReservedCostUsd,
  };
  const closure = await readOptional(path.join(context.ledgerRoot, "cost-ledger-final.json"));
  if (closure && (closure.configSha256 !== context.configSha256
    || !["complete", "frozen"].includes(closure.lifecycle)
    || closure.journalSha256 !== candidateSha256(JSON.stringify(entries))
    || closure.providerReportedCostUsd !== state.providerReportedCostUsd
    || closure.reservedUnknownCostUsd !== state.reservedUnknownCostUsd)) {
    throw new Error("Candidate closed session or journal drifted.");
  }
  return { ...state, closure };
}

export async function claimCandidateSlot(context, slot, dependencies = {}) {
  assertContext(context);
  const paths = slotPaths(context, slot);
  return withCostAuthorityLock(context, async (authorityRoot) => {
    await bindCostAuthority(context, authorityRoot, dependencies);
    await assertCandidateOrdinaryPath(context.ledgerRoot, true);
    await fs.mkdir(context.ledgerRoot, { recursive: true });
    // 先独占整个候选的费用检查，再持久化槽位预留；崩溃留下锁或 intent 都会阻止重发。
    const bindingPath = path.join(context.ledgerRoot, "session-binding.json");
    if (!await readOptional(bindingPath)) {
      await fs.writeFile(bindingPath, `${JSON.stringify(contextBinding(context), null, 2)}\n`, { flag: "wx" });
    }
    if (await readOptional(paths.intent)) throw Object.assign(new Error("EEXIST: candidate slot was already dispatched."), { code: "EEXIST" });
    const state = await inspectCandidateSlotJournal(context);
    if (state.closure) throw new Error("Candidate session is closed; further dispatch is forbidden.");
    if (state.pending > 0) throw new Error("Candidate has a pending dispatch; parallel launches are forbidden.");
    if (state.unreported > 0) throw new Error("Candidate has an unreported execution; further dispatch is forbidden.");
    assertCandidateCostGuard(state);
    await assertCandidateOrdinaryPath(paths.root, true);
    await fs.mkdir(paths.root, { recursive: true });
    const handle = await fs.open(paths.intent, "wx");
    try {
      await handle.writeFile(`${JSON.stringify({
        schemaVersion: VERSION, kind: "intent", configSha256: context.configSha256,
        slot, reservedUnknownCostUsd: SINGLE_RUN_USD,
      }, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
  });
}

export async function completeCandidateSlot(context, slot, result) {
  assertContext(context);
  validateTerminal(result);
  return withCostAuthorityLock(context, async (authorityRoot) => {
    const paths = slotPaths(context, slot);
    const intent = JSON.parse(await readCandidateFile(paths.intent));
    assertBinding(context, slot, intent, "intent");
    await bindCostAuthority(context, authorityRoot);
    if (await readOptional(path.join(context.ledgerRoot, "cost-ledger-final.json"))) throw new Error("Candidate session is closed.");
    await writeNewDurable(paths.terminal, {
      schemaVersion: VERSION, kind: "terminal", configSha256: context.configSha256, slot, result,
    });
  });
}

export async function closeCandidateSession(context, { lifecycle, reasons }) {
  assertContext(context);
  if (!["complete", "frozen"].includes(lifecycle) || !Array.isArray(reasons)
    || reasons.some((reason) => typeof reason !== "string" || !/^[a-zA-Z0-9_:./-]{1,200}$/.test(reason))) {
    throw new Error("Candidate session closure is invalid.");
  }
  return withCostAuthorityLock(context, async (authorityRoot) => {
    await bindCostAuthority(context, authorityRoot);
    const state = await inspectCandidateSlotJournal(context);
    if (lifecycle === "complete" && (state.pending || state.unreported || state.unexecuted.length)) {
      throw new Error("An incomplete candidate session cannot be closed as complete.");
    }
    const ledgerPath = path.join(context.ledgerRoot, "cost-ledger-final.json");
    if (!state.closure) {
      const record = {
        schemaVersion: "coding-agent-candidate-cost-ledger/v1",
        configSha256: context.configSha256, lifecycle, reasons,
        predecessor: context.costBaseline,
        journalSha256: candidateSha256(JSON.stringify(state.entries)),
        processed: state.processed, pending: state.pending, unreported: state.unreported,
        providerReportedCostUsd: state.providerReportedCostUsd,
        reservedUnknownCostUsd: state.reservedUnknownCostUsd,
        candidateProviderReportedCostUsd: state.candidateProviderReportedCostUsd,
        resourceCleanupComplete: state.entries.every((entry) => entry.terminal?.result.resourcesClosed === true),
      };
      await writeNewDurable(ledgerPath, record);
    }
    return { path: ledgerPath, sha256: candidateSha256(await readCandidateFile(ledgerPath)) };
  });
}

async function withCostAuthorityLock(context, operation) {
  const root = path.join(context.workspaceRoot, "tmp", "coding-agent-cost-authority");
  await assertCandidateOrdinaryPath(root, true);
  await fs.mkdir(root, { recursive: true });
  const lockPath = path.join(root, "dispatch.lock");
  const lock = await fs.open(lockPath, "wx");
  try { return await operation(root); }
  finally { await lock.close(); await fs.unlink(lockPath); }
}

async function bindCostAuthority(context, root, dependencies = {}) {
  const names = (await fs.readdir(root)).filter((name) => name !== "dispatch.lock").sort();
  if (names.some((name, index) => name !== `${String(index + 1).padStart(6, "0")}.json`)) {
    throw new Error("Candidate cost authority sequence is invalid.");
  }
  if (names.length) {
    const latest = await readOptional(path.join(root, names.at(-1)));
    if (latest.configSha256 === context.configSha256 && latest.ledgerRoot === context.ledgerRoot) {
      if (JSON.stringify(latest.costBaseline) !== JSON.stringify(context.costBaseline)) throw new Error("Candidate authority baseline drifted.");
      return;
    }
    if (!path.isAbsolute(latest.ledgerRoot ?? "")) throw new Error("Candidate authority binding is invalid.");
    assertCandidatePathWithin(context.workspaceRoot, latest.ledgerRoot);
    const finalPath = path.join(latest.ledgerRoot, "cost-ledger-final.json");
    const final = await readOptional(finalPath);
    if (!final) throw new Error("Candidate cost authority has another active session.");
    if (final.resourceCleanupComplete !== true) {
      try {
        const recovery = await (dependencies.verifyResourceRecovery ?? verifyCandidateResourceRecovery)({
          ledgerRoot: latest.ledgerRoot, configSha256: latest.configSha256,
          ledgerSha256: candidateSha256(await readCandidateFile(finalPath)),
        });
        if (recovery.status !== "verified") throw new Error("Unverified recovery.");
      } catch {
        throw new Error("Previous candidate resource cleanup is still uncertain.");
      }
    }
    if (final.configSha256 !== latest.configSha256 || !["complete", "frozen"].includes(final.lifecycle)
      || context.costBaseline.path !== finalPath
      || context.costBaseline.sha256 !== candidateSha256(await readCandidateFile(finalPath))
      || context.baseline.providerReportedCostUsd !== final.providerReportedCostUsd
      || context.baseline.reservedUnknownCostUsd !== final.reservedUnknownCostUsd) {
      throw new Error("Candidate cost authority requires the latest closed baseline.");
    }
  }
  await writeNewDurable(path.join(root, `${String(names.length + 1).padStart(6, "0")}.json`), {
    schemaVersion: "coding-agent-candidate-cost-authority/v1",
    configSha256: context.configSha256, ledgerRoot: context.ledgerRoot, costBaseline: context.costBaseline,
  });
}

async function writeNewDurable(filePath, value) {
  const handle = await fs.open(filePath, "wx");
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

function slotPaths(context, slot) {
  const key = candidateSlotKey(slot);
  if (!context.slots.some((selected) => candidateSlotKey(selected) === key)) throw new Error("Candidate slot is not selected.");
  const root = path.join(context.ledgerRoot, "slots", key);
  return { root, intent: path.join(root, "intent.json"), terminal: path.join(root, "terminal.json") };
}

function contextBinding(context) {
  return {
    schemaVersion: VERSION, kind: "session", configSha256: context.configSha256,
    slots: context.slots, baseline: context.baseline, costBaseline: context.costBaseline,
  };
}

async function readOptional(filePath) {
  try { return JSON.parse(await readCandidateFile(filePath, 1024 * 1024)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function assertContext(context) {
  if (!context || !path.isAbsolute(context.workspaceRoot ?? "") || !path.isAbsolute(context.ledgerRoot ?? "")
    || !path.isAbsolute(context.costBaseline?.path ?? "") || !/^[a-f0-9]{64}$/.test(context.costBaseline?.sha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(context.configSha256 ?? "")
    || !Array.isArray(context.slots) || context.slots.length === 0 || context.slots.length > 144
    || new Set(context.slots.map(candidateSlotKey)).size !== context.slots.length
    || context.slots.some((slot) => !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(slot.taskId)
      || !["windows-native", "wsl2-linux"].includes(slot.platform) || !Number.isInteger(slot.attempt) || slot.attempt < 1 || slot.attempt > 3)
    || !Number.isFinite(context.baseline?.providerReportedCostUsd) || context.baseline.providerReportedCostUsd < 0
    || !Number.isFinite(context.baseline?.reservedUnknownCostUsd) || context.baseline.reservedUnknownCostUsd < 0) {
    throw new Error("Candidate journal context is invalid.");
  }
  assertCandidatePathWithin(context.workspaceRoot, context.ledgerRoot);
}

function assertBinding(context, slot, record, kind) {
  if (record?.schemaVersion !== VERSION || record.kind !== kind || record.configSha256 !== context.configSha256
    || JSON.stringify(record.slot) !== JSON.stringify(slot)) throw new Error("Candidate journal binding drifted.");
}

function validateTerminal(result) {
  if (!result || !["reported", "unreported"].includes(result.status)
    || !Number.isInteger(result.runnerExit)
    || typeof result.resourcesClosed !== "boolean" || (result.status === "reported" && !result.resourcesClosed)
    || !result.artifactHashes || typeof result.artifactHashes !== "object" || Array.isArray(result.artifactHashes)
    || Object.values(result.artifactHashes).some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Candidate terminal is invalid.");
  }
  if (![result.providerReportedCostUsd, result.reservedUnknownCostUsd].every((value) => Number.isFinite(value) && value >= 0 && value <= SINGLE_RUN_USD)
    || ![0, SINGLE_RUN_USD].includes(result.reservedUnknownCostUsd)) throw new Error("Candidate terminal cost is invalid.");
  if (result.status === "reported" ? !/^[a-f0-9]{64}$/.test(result.reportSha256) :
    result.reportSha256 !== null || result.providerReportedCostUsd !== 0 || result.reservedUnknownCostUsd !== SINGLE_RUN_USD) {
    throw new Error("Candidate terminal report or reserved cost is invalid.");
  }
}
