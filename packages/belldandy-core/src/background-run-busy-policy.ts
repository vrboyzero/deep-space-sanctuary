import type {
  BackgroundRunKind,
  BackgroundRunRuntimeSnapshot,
} from "./background-run-coordinator.js";

export type BackgroundRunBusyContext = {
  ownClaimKind?: BackgroundRunKind;
  relatedClaimKind?: BackgroundRunKind;
};

export type BackgroundRunBusySnapshot = {
  busy: boolean;
  foregroundActiveCount: number;
  backgroundActiveCount: number;
  queuedCount: number;
  availableSlots: number;
};

export function evaluateBackgroundRunBusy(
  snapshot: BackgroundRunRuntimeSnapshot,
  context: BackgroundRunBusyContext = {},
): BackgroundRunBusySnapshot {
  const excludedKinds = new Set([
    context.ownClaimKind,
    context.relatedClaimKind,
  ].filter((kind): kind is BackgroundRunKind => Boolean(kind)));
  const ownClaimCount = [...excludedKinds].reduce((count, kind) => (
    count + (snapshot.activeByKind[kind] > 0 ? 1 : 0)
  ), 0);
  const backgroundActiveCount = Math.max(0, snapshot.activeCount - ownClaimCount);
  const availableSlots = Math.min(
    snapshot.capacity,
    snapshot.availableSlots + ownClaimCount,
  );
  return {
    busy: snapshot.foregroundActiveCount > 0
      || backgroundActiveCount > 0
      || snapshot.queuedCount > 0
      || availableSlots <= 0,
    foregroundActiveCount: snapshot.foregroundActiveCount,
    backgroundActiveCount,
    queuedCount: snapshot.queuedCount,
    availableSlots,
  };
}
