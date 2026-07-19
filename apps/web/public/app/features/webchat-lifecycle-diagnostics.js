const ZERO_RESOURCE_COUNTS = Object.freeze({
  activeTimerCount: 0,
  activeListenerCount: 0,
  pendingOperationCount: 0,
  retainedItemCount: 0,
  retainedByteCount: 0,
});

function normalizeCount(value) {
  if (!Number.isFinite(value) || Number(value) <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value)));
}

function addSnapshotCounts(target, snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
  for (const [key, value] of Object.entries(snapshot)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      addSnapshotCounts(target, value);
      continue;
    }
    if (/^(?:active.*timer.*count|timerCount)$/i.test(key)) {
      target.activeTimerCount += normalizeCount(value);
    } else if (/(?:Timer|AnimationFrame|Raf)Active$/i.test(key)) {
      target.activeTimerCount += value === true ? 1 : 0;
    } else if (/listenerCount$/i.test(key)) {
      target.activeListenerCount += normalizeCount(value);
    } else if (/^pending.*Count$/i.test(key)) {
      target.pendingOperationCount += normalizeCount(value);
    } else if (/^pending/i.test(key) && value === true) {
      target.pendingOperationCount += 1;
    } else if (/^(?:retained|cached).*Count$/i.test(key)) {
      target.retainedItemCount += normalizeCount(value);
    } else if (/KeyCount$/i.test(key)) {
      target.retainedItemCount += normalizeCount(value);
    } else if (/^(?:retained|cached|approximate).*Bytes$/i.test(key)) {
      target.retainedByteCount += normalizeCount(value);
    }
  }
}

function cloneSummary(summary) {
  return { ...summary };
}

/**
 * 聚合器只读取固定命名的资源计数，不复制 provider 名称、ID、正文或原始 snapshot。
 */
export function createWebchatLifecycleDiagnostics() {
  const providers = new Set();
  const captureCounts = {
    replacementSettlementCaptureCount: 0,
    featureDisposeCaptureCount: 0,
    pagehideCaptureCount: 0,
    explicitSnapshotCaptureCount: 0,
  };
  let captureSequence = 0;
  let pagehideCaptured = false;
  let lastSummary = {
    captureSequence,
    providerCount: 0,
    failedProviderCount: 0,
    ...ZERO_RESOURCE_COUNTS,
    ...captureCounts,
  };

  function registerProvider(provider) {
    if (pagehideCaptured || typeof provider !== "function") return () => {};
    providers.add(provider);
    return () => providers.delete(provider);
  }

  function capture(triggerKey) {
    if (pagehideCaptured) return cloneSummary(lastSummary);
    captureCounts[triggerKey] += 1;
    captureSequence += 1;
    const resourceCounts = { ...ZERO_RESOURCE_COUNTS };
    let failedProviderCount = 0;
    for (const provider of providers) {
      try {
        addSnapshotCounts(resourceCounts, provider());
      } catch {
        failedProviderCount += 1;
      }
    }
    lastSummary = {
      captureSequence,
      providerCount: providers.size,
      failedProviderCount,
      ...resourceCounts,
      ...captureCounts,
    };
    return cloneSummary(lastSummary);
  }

  function captureReplacementSettlement() {
    return capture("replacementSettlementCaptureCount");
  }

  function captureFeatureDispose() {
    return capture("featureDisposeCaptureCount");
  }

  function capturePagehide() {
    if (pagehideCaptured) return cloneSummary(lastSummary);
    const summary = capture("pagehideCaptureCount");
    pagehideCaptured = true;
    providers.clear();
    return summary;
  }

  function getSummary() {
    return capture("explicitSnapshotCaptureCount");
  }

  function peekSummary() {
    return cloneSummary(lastSummary);
  }

  return {
    registerProvider,
    captureReplacementSettlement,
    captureFeatureDispose,
    capturePagehide,
    getSummary,
    peekSummary,
  };
}
