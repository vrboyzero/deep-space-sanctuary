function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(num)));
}

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `$${num.toFixed(6)}`;
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${Math.max(0, Math.round(num * 100))}%`;
}

function formatSignedPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const rounded = Math.round(num * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function trimFingerprint(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
}

const TOKEN_USAGE_OBSERVABILITY_SHIFT_VAR = "--token-usage-observability-shift";
const TOKEN_USAGE_OBSERVABILITY_VIEWPORT_PADDING = 16;

function writePopoverShift(container, shift) {
  if (!container?.style) return;
  container.style.setProperty(TOKEN_USAGE_OBSERVABILITY_SHIFT_VAR, `${Math.round(shift)}px`);
}

export function syncTokenUsageObservabilityPopover(container, target = container?.querySelector?.(".token-usage-observability")) {
  if (!container || !target || typeof window === "undefined") return;
  writePopoverShift(container, 0);
  if (container.classList.contains("is-collapsed")) {
    return;
  }
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  let shift = 0;
  if (rect.left < TOKEN_USAGE_OBSERVABILITY_VIEWPORT_PADDING) {
    shift += TOKEN_USAGE_OBSERVABILITY_VIEWPORT_PADDING - rect.left;
  }
  const maxRight = window.innerWidth - TOKEN_USAGE_OBSERVABILITY_VIEWPORT_PADDING;
  if (rect.right + shift > maxRight) {
    shift -= rect.right + shift - maxRight;
  }
  writePopoverShift(container, shift);
}

export function scheduleTokenUsageObservabilityPopoverSync(container, target = container?.querySelector?.(".token-usage-observability")) {
  if (!container || !target) return;
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    syncTokenUsageObservabilityPopover(container, target);
    return;
  }
  if (typeof container.__tokenUsageObservabilityFrame === "number" && container.__tokenUsageObservabilityFrame) {
    window.cancelAnimationFrame(container.__tokenUsageObservabilityFrame);
  }
  container.__tokenUsageObservabilityFrame = window.requestAnimationFrame(() => {
    container.__tokenUsageObservabilityFrame = 0;
    syncTokenUsageObservabilityPopover(container, target);
  });
}

export function buildTokenUsageObservabilitySegments(
  payload,
  t = (_key, _params, fallback) => fallback ?? "",
  options = {},
) {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const { includeCostBudget = true } = options;
  const segments = [];
  if (typeof payload.cacheSupport === "string" && payload.cacheSupport.trim()) {
    segments.push(t(
      "header.tokenCacheSupport",
      { value: payload.cacheSupport },
      `CACHE ${payload.cacheSupport}`,
    ));
  }
  if (typeof payload.cacheHitTokens === "number" || typeof payload.cacheMissTokens === "number") {
    segments.push(t(
      "header.tokenCacheHitMiss",
      {
        hit: formatNumber(payload.cacheHitTokens ?? 0),
        miss: formatNumber(payload.cacheMissTokens ?? 0),
      },
      `HIT ${formatNumber(payload.cacheHitTokens ?? 0)} / MISS ${formatNumber(payload.cacheMissTokens ?? 0)}`,
    ));
  }
  if (typeof payload.cacheSavingsUsd === "number") {
    segments.push(t(
      "header.tokenCacheSavings",
      { value: formatUsd(payload.cacheSavingsUsd) },
      `SAVE ${formatUsd(payload.cacheSavingsUsd)}`,
    ));
  }
  const fingerprint = trimFingerprint(payload.systemPromptFingerprint);
  if (fingerprint) {
    segments.push(t(
      "header.tokenPromptFingerprint",
      { value: fingerprint },
      `FP ${fingerprint}`,
    ));
  }
  if (payload.warmupCoordination && typeof payload.warmupCoordination === "object") {
    segments.push(t(
      "header.tokenWarmupCoordination",
      {
        status: payload.warmupCoordination.status || "-",
        recommendation: payload.warmupCoordination.recommendation || "-",
      },
      `WARM ${payload.warmupCoordination.status || "-"} / ${payload.warmupCoordination.recommendation || "-"}`,
    ));
  }
  if (payload.cacheFamilyAffinity && typeof payload.cacheFamilyAffinity === "object") {
    segments.push(t(
      "header.tokenCacheFamilyAffinity",
      { status: payload.cacheFamilyAffinity.status || "-" },
      `AFF ${payload.cacheFamilyAffinity.status || "-"}`,
    ));
  }
  if (payload.deepseekRoute && typeof payload.deepseekRoute === "object") {
    const selectedTier = typeof payload.deepseekRoute.selectedTier === "string"
      ? payload.deepseekRoute.selectedTier
      : "-";
    const reason = typeof payload.deepseekRoute.reason === "string" && payload.deepseekRoute.reason.trim()
      ? payload.deepseekRoute.reason.trim()
      : "-";
    segments.push(t(
      "header.tokenDeepSeekRoute",
      { tier: selectedTier, reason },
      `ROUTE ${selectedTier} / ${reason}`,
    ));
  }
  if (payload.auxSummaryVerdict && typeof payload.auxSummaryVerdict === "object") {
    const strategy = typeof payload.auxSummaryVerdict.strategy === "string" && payload.auxSummaryVerdict.strategy.trim()
      ? payload.auxSummaryVerdict.strategy.trim()
      : "-";
    const reason = typeof payload.auxSummaryVerdict.reason === "string" && payload.auxSummaryVerdict.reason.trim()
      ? payload.auxSummaryVerdict.reason.trim()
      : "-";
    const enabled = payload.auxSummaryVerdict.enabled === true ? "yes" : "no";
    segments.push(t(
      "header.tokenAuxSummaryVerdict",
      { strategy, reason, enabled },
      `AUX ${strategy} / ${reason} / enabled=${enabled}`,
    ));
  }
  if (payload.usageCalibration && typeof payload.usageCalibration === "object") {
    segments.push(t(
      "header.tokenUsageCalibration",
      {
        estimated: formatNumber(payload.usageCalibration.estimatedPromptTokens),
        actual: formatNumber(payload.usageCalibration.averageInputTokensPerCall),
        delta: formatSignedPercent(payload.usageCalibration.deltaRatio),
        status: payload.usageCalibration.status || "-",
      },
      `CAL ${formatNumber(payload.usageCalibration.estimatedPromptTokens)} -> ${formatNumber(payload.usageCalibration.averageInputTokensPerCall)} (${formatSignedPercent(payload.usageCalibration.deltaRatio)}, ${payload.usageCalibration.status || "-"})`,
    ));
  }
  if (includeCostBudget && typeof payload.sessionTotalCostUsd === "number") {
    const budgetUsd = typeof payload.costBudgetUsd === "number" ? payload.costBudgetUsd : null;
    const ratio = budgetUsd && budgetUsd > 0
      ? payload.sessionTotalCostUsd / budgetUsd
      : payload.costBudgetRatio;
    segments.push(t(
      "header.tokenCostBudget",
      {
        cost: formatUsd(payload.sessionTotalCostUsd),
        budget: budgetUsd ? formatUsd(budgetUsd) : "--",
        ratio: formatPercent(ratio),
      },
      `COST ${formatUsd(payload.sessionTotalCostUsd)} / ${budgetUsd ? formatUsd(budgetUsd) : "--"} (${formatPercent(ratio)})`,
    ));
  }
  return segments;
}

export function buildTokenUsageObservabilityText(payload, t = (_key, _params, fallback) => fallback ?? "") {
  return buildTokenUsageObservabilitySegments(payload, t).join(" | ");
}

export function updateTokenUsageObservability(target, payload, t) {
  if (!target) return;
  const segments = buildTokenUsageObservabilitySegments(payload, t, {
    includeCostBudget: false,
  });
  target.replaceChildren();
  if (segments.length > 0) {
    for (const segment of segments) {
      const segmentEl = document.createElement("span");
      segmentEl.className = "token-usage-observability-segment";
      segmentEl.textContent = segment;
      target.append(segmentEl);
    }
  } else {
    const emptyEl = document.createElement("span");
    emptyEl.className = "token-usage-observability-empty";
    emptyEl.textContent = t?.("header.tokenObservabilityEmpty", {}, "No cache observability yet") || "No cache observability yet";
    target.append(emptyEl);
  }
  target.classList.toggle("is-empty", segments.length === 0);
  scheduleTokenUsageObservabilityPopoverSync(target.parentElement, target);
}
