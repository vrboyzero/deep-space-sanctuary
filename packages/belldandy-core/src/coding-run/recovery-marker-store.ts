import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CODING_RUN_PROTOCOL_VERSION,
  isCodingRunStatusQueryV1,
  type CodingContextBinding,
} from "./contracts.js";

const STATE_VERSION = 1 as const;
const STATE_FILENAME = "coding-run-recovery-markers.json";
const MAX_MARKERS = 256;

export type RecoverableCodingRunSource = "conversation" | "workflow";

export type CodingRunRecoveryMarker = {
  source: RecoverableCodingRunSource;
  binding: CodingContextBinding;
  state: "active" | "settled";
  ownerInstanceId: string;
  ownerProcessId: number;
  startedAtMs: number;
  updatedAtMs: number;
};

export type CodingRunRecoveryLookup =
  | { state: "lost"; marker: CodingRunRecoveryMarker }
  | { state: "current_owner" | "live_owner" | "settled" | "not_found" | "unavailable" };

type PersistedState = {
  version: typeof STATE_VERSION;
  markers: CodingRunRecoveryMarker[];
};

type MarkerIdentity = {
  source: RecoverableCodingRunSource;
  binding: CodingContextBinding;
};

type RecoveryMarkerStoreOptions = {
  ownerInstanceId?: string;
  ownerProcessId?: number;
  isProcessAlive?: (processId: number) => boolean;
  now?: () => number;
};

/**
 * 只持久化崩溃识别所需的 active/settled marker，不接管任何领域运行状态。
 */
export class CodingRunRecoveryMarkerStore {
  private readonly filePath: string;
  private readonly ownerInstanceId: string;
  private readonly ownerProcessId: number;
  private readonly isProcessAlive: (processId: number) => boolean;
  private readonly now: () => number;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(stateDir: string, options: RecoveryMarkerStoreOptions = {}) {
    this.filePath = path.join(path.resolve(stateDir), STATE_FILENAME);
    this.ownerInstanceId = normalizeIdentifier(options.ownerInstanceId) ?? randomUUID();
    this.ownerProcessId = normalizeProcessId(options.ownerProcessId) ?? process.pid;
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.now = options.now ?? Date.now;
  }

  async markActive(input: MarkerIdentity & { startedAtMs: number }): Promise<void> {
    assertMarkerIdentity(input);
    const timestamp = normalizeTimestamp(this.now());
    const marker: CodingRunRecoveryMarker = {
      source: input.source,
      binding: cloneBinding(input.binding),
      state: "active",
      ownerInstanceId: this.ownerInstanceId,
      ownerProcessId: this.ownerProcessId,
      startedAtMs: normalizeTimestamp(input.startedAtMs),
      updatedAtMs: timestamp,
    };
    await this.mutate((state) => {
      const index = state.markers.findIndex((item) => matchesIdentity(item, input));
      if (index >= 0) state.markers[index] = marker;
      else state.markers.push(marker);
      state.markers = trimMarkers(state.markers);
    });
  }

  async markSettled(input: MarkerIdentity): Promise<boolean> {
    assertMarkerIdentity(input);
    let settled = false;
    await this.mutate((state) => {
      const index = state.markers.findIndex((item) => matchesIdentity(item, input));
      const current = index >= 0 ? state.markers[index] : undefined;
      if (!current || current.ownerInstanceId !== this.ownerInstanceId) return;
      state.markers[index] = {
        ...current,
        state: "settled",
        updatedAtMs: normalizeTimestamp(this.now()),
      };
      state.markers = trimMarkers(state.markers);
      settled = true;
    });
    return settled;
  }

  async lookup(input: MarkerIdentity): Promise<CodingRunRecoveryLookup> {
    if (!isMarkerIdentity(input)) return { state: "unavailable" };
    await this.writeQueue.catch(() => undefined);
    let state: PersistedState;
    try {
      state = await this.readState(false);
    } catch {
      return { state: "unavailable" };
    }
    const marker = state.markers.find((item) => matchesIdentity(item, input));
    if (!marker) return { state: "not_found" };
    if (marker.state === "settled") return { state: "settled" };
    if (marker.ownerInstanceId === this.ownerInstanceId) return { state: "current_owner" };
    if (this.isProcessAlive(marker.ownerProcessId)) return { state: "live_owner" };
    return { state: "lost", marker: cloneMarker(marker) };
  }

  private async mutate(mutator: (state: PersistedState) => void): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const state = await this.readState(true);
      mutator(state);
      await atomicWriteState(this.filePath, state);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async readState(allowMissing: boolean): Promise<PersistedState> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf-8");
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return { version: STATE_VERSION, markers: [] };
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("coding run recovery marker state is invalid.");
    }
    if (!isPersistedState(parsed)) {
      throw new Error("coding run recovery marker state is invalid.");
    }
    return {
      version: STATE_VERSION,
      markers: parsed.markers.map(cloneMarker),
    };
  }
}

async function atomicWriteState(filePath: string, state: PersistedState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "markers"])) return false;
  if (value.version !== STATE_VERSION || !Array.isArray(value.markers)) return false;
  const identities = new Set<string>();
  for (const marker of value.markers) {
    if (!isRecoveryMarker(marker)) return false;
    const key = markerKey(marker);
    if (identities.has(key)) return false;
    identities.add(key);
  }
  return true;
}

function isRecoveryMarker(value: unknown): value is CodingRunRecoveryMarker {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "source",
    "binding",
    "state",
    "ownerInstanceId",
    "ownerProcessId",
    "startedAtMs",
    "updatedAtMs",
  ])) return false;
  return isMarkerIdentity({ source: value.source, binding: value.binding })
    && (value.state === "active" || value.state === "settled")
    && Boolean(normalizeIdentifier(value.ownerInstanceId))
    && normalizeProcessId(value.ownerProcessId) !== undefined
    && isTimestamp(value.startedAtMs)
    && isTimestamp(value.updatedAtMs);
}

function assertMarkerIdentity(value: MarkerIdentity): void {
  if (!isMarkerIdentity(value)) {
    throw new Error("coding run recovery marker binding is invalid.");
  }
}

function isMarkerIdentity(value: unknown): value is MarkerIdentity {
  if (!isRecord(value) || (value.source !== "conversation" && value.source !== "workflow")) return false;
  return isCodingRunStatusQueryV1({
    version: CODING_RUN_PROTOCOL_VERSION,
    source: value.source,
    binding: value.binding,
  });
}

function matchesIdentity(marker: CodingRunRecoveryMarker, identity: MarkerIdentity): boolean {
  if (marker.source !== identity.source || marker.binding.agentRunId !== identity.binding.agentRunId) {
    return false;
  }
  if (marker.source === "conversation") {
    return marker.binding.conversationId === identity.binding.conversationId;
  }
  return marker.binding.workflow?.journalId === identity.binding.workflow?.journalId
    && marker.binding.workflow?.workflowRunId === identity.binding.workflow?.workflowRunId;
}

function markerKey(marker: CodingRunRecoveryMarker): string {
  return marker.source === "conversation"
    ? `conversation:${marker.binding.conversationId}:${marker.binding.agentRunId}`
    : `workflow:${marker.binding.workflow?.journalId}:${marker.binding.workflow?.workflowRunId}:${marker.binding.agentRunId}`;
}

function trimMarkers(markers: CodingRunRecoveryMarker[]): CodingRunRecoveryMarker[] {
  const compare = (left: CodingRunRecoveryMarker, right: CodingRunRecoveryMarker): number =>
    right.updatedAtMs - left.updatedAtMs || markerKey(left).localeCompare(markerKey(right));
  const active = markers.filter((marker) => marker.state === "active").sort(compare);
  if (active.length > MAX_MARKERS) {
    throw new Error("coding run recovery marker capacity is exhausted by active runs.");
  }
  const settled = markers.filter((marker) => marker.state === "settled").sort(compare);
  return [...active, ...settled.slice(0, MAX_MARKERS - active.length)];
}

function cloneMarker(marker: CodingRunRecoveryMarker): CodingRunRecoveryMarker {
  return {
    ...marker,
    binding: cloneBinding(marker.binding),
  };
}

function cloneBinding(binding: CodingContextBinding): CodingContextBinding {
  return {
    agentRunId: binding.agentRunId,
    ...(binding.conversationId ? { conversationId: binding.conversationId } : {}),
    ...(binding.workflow ? { workflow: { ...binding.workflow } } : {}),
  };
}

function defaultIsProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function normalizeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeProcessId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}
