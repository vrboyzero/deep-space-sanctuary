import { createHash, randomUUID } from "node:crypto";

import {
  createTaskProjectionCollectionSnapshot,
  readTaskProjectionCollectionSnapshot,
  type TaskProjectionCollectionCursor,
  type TaskProjectionCollectionPage,
  type TaskProjectionCollectionReadFailure,
  type TaskProjectionCollectionSnapshot,
  type TaskProjectionCollectionSource,
} from "./task-projection-collection.js";

export class TaskProjectionCollectionRuntime {
  private readonly epoch: string;
  private revision = 0;
  private fingerprint = "";
  private snapshot?: TaskProjectionCollectionSnapshot;

  constructor(input: { epoch?: string } = {}) {
    this.epoch = input.epoch?.trim() || randomUUID();
  }

  refresh(input: {
    observedAtMs: number;
    sources: readonly Omit<TaskProjectionCollectionSource, "sourceRevision">[];
  }): TaskProjectionCollectionSnapshot {
    const fingerprint = createFingerprint(input.sources);
    if (this.snapshot && fingerprint === this.fingerprint) return this.snapshot;

    const revision = this.revision + 1;
    const snapshot = createTaskProjectionCollectionSnapshot({
      epoch: this.epoch,
      revision,
      observedAtMs: input.observedAtMs,
      sources: input.sources.map((source) => ({ ...source, sourceRevision: revision })),
    });
    this.revision = revision;
    this.fingerprint = fingerprint;
    this.snapshot = snapshot;
    return snapshot;
  }

  read(input: {
    cursor?: TaskProjectionCollectionCursor;
    limit?: number;
  } = {}): TaskProjectionCollectionPage | TaskProjectionCollectionReadFailure {
    const snapshot = this.snapshot ?? createTaskProjectionCollectionSnapshot({
      epoch: this.epoch,
      revision: 0,
      observedAtMs: 0,
      sources: [],
    });
    return readTaskProjectionCollectionSnapshot(snapshot, input);
  }
}

function createFingerprint(sources: readonly Omit<TaskProjectionCollectionSource, "sourceRevision">[]): string {
  const normalized = [...sources]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((source) => ({
      ...source,
      observedAtMs: 0,
      capabilityClosure: { ...source.capabilityClosure, evaluatedAtMs: 0 },
      ...(source.supportingEvidence
        ? {
            supportingEvidence: Object.fromEntries(
              Object.entries(source.supportingEvidence).map(([name, evidence]) => [
                name,
                { ...evidence, observedAtMs: 0 },
              ]),
            ),
          }
        : {}),
    }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
