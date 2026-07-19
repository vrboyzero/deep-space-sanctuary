function tr(t, key, params, fallback) {
  return typeof t === "function" ? t(key, params ?? {}, fallback) : fallback;
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

export function buildWebchatLifecycleCard(payload, t) {
  const summary = payload?.webchatLifecycle;
  if (!summary || typeof summary !== "object") return undefined;
  const badges = [
    tr(t, "settings.doctorWebchatLifecycleTimers", { count: formatNumber(summary.activeTimerCount) }, `${formatNumber(summary.activeTimerCount)} timers`),
    tr(t, "settings.doctorWebchatLifecycleListeners", { count: formatNumber(summary.activeListenerCount) }, `${formatNumber(summary.activeListenerCount)} listeners`),
    tr(t, "settings.doctorWebchatLifecyclePending", { count: formatNumber(summary.pendingOperationCount) }, `${formatNumber(summary.pendingOperationCount)} pending`),
    tr(
      t,
      "settings.doctorWebchatLifecycleRetained",
      {
        count: formatNumber(summary.retainedItemCount),
        bytes: formatNumber(summary.retainedByteCount),
      },
      `${formatNumber(summary.retainedItemCount)} retained items / ${formatNumber(summary.retainedByteCount)} bytes`,
    ),
  ];
  const notes = [
    tr(
      t,
      "settings.doctorWebchatLifecycleCoverage",
      {
        captures: formatNumber(summary.captureSequence),
        providers: formatNumber(summary.providerCount),
        failures: formatNumber(summary.failedProviderCount),
      },
      `captures ${formatNumber(summary.captureSequence)} / providers ${formatNumber(summary.providerCount)} / failures ${formatNumber(summary.failedProviderCount)}`,
    ),
    tr(
      t,
      "settings.doctorWebchatLifecycleTriggers",
      {
        replacement: formatNumber(summary.replacementSettlementCaptureCount),
        dispose: formatNumber(summary.featureDisposeCaptureCount),
        pagehide: formatNumber(summary.pagehideCaptureCount),
        explicit: formatNumber(summary.explicitSnapshotCaptureCount),
      },
      `replacement ${formatNumber(summary.replacementSettlementCaptureCount)} / dispose ${formatNumber(summary.featureDisposeCaptureCount)} / pagehide ${formatNumber(summary.pagehideCaptureCount)} / explicit ${formatNumber(summary.explicitSnapshotCaptureCount)}`,
    ),
  ];
  return {
    title: tr(t, "settings.doctorWebchatLifecycleTitle", {}, "WebChat Lifecycle"),
    badges,
    notes,
    status: Number(summary.failedProviderCount) > 0 ? "warn" : "pass",
  };
}
