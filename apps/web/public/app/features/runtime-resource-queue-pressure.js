function tr(t, key, params, fallback) {
  return typeof t === "function" ? t(key, params ?? {}, fallback) : fallback;
}

/** Render queue pressure only when it carries a non-zero diagnostic signal. */
export function buildRuntimeResourceQueuePressure(t, queue, formatNumber, formatDelay) {
  const oldestWaitMs = Number(queue?.oldestWaitMs);
  const rejectedCount = Number(queue?.rejectedCount);
  const hasOldestWait = Number.isFinite(oldestWaitMs) && oldestWaitMs > 0;
  const hasRejected = Number.isFinite(rejectedCount) && rejectedCount > 0;
  if (!hasOldestWait && !hasRejected) {
    return "";
  }
  return tr(
    t,
    "settings.doctorRuntimeResourcesQueuePressure",
    {
      oldestWaitMs: hasOldestWait ? formatDelay(oldestWaitMs) : formatDelay(0),
      rejected: hasRejected ? formatNumber(rejectedCount) : formatNumber(0),
    },
    `, oldest wait=${hasOldestWait ? formatDelay(oldestWaitMs) : formatDelay(0)}, rejected=${hasRejected ? formatNumber(rejectedCount) : formatNumber(0)}`,
  );
}
