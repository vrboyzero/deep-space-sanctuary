function parseNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampFraction(value, fallback = 0.8) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 1);
}

export function readCostBudgetConfig(config) {
  if (!config || typeof config !== "object") {
    return {
      budgetUsd: null,
      warnFraction: 0.8,
      warningThresholdUsd: null,
      enabled: false,
    };
  }

  const budgetUsd = parseNumber(config.BELLDANDY_WEBCHAT_COST_BUDGET_USD);
  const warnFraction = clampFraction(config.BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION, 0.8);
  const enabled = Number.isFinite(budgetUsd) && budgetUsd > 0;

  return {
    budgetUsd: enabled ? budgetUsd : null,
    warnFraction,
    warningThresholdUsd: enabled ? budgetUsd * warnFraction : null,
    enabled,
  };
}

export function createCostBudgetTracker() {
  let sessionTotalCostUsd = 0;
  let warned = false;

  function reset() {
    sessionTotalCostUsd = 0;
    warned = false;
  }

  function getSessionTotalCostUsd() {
    return sessionTotalCostUsd;
  }

  function consumeUsage(payload) {
    const totalCostUsd = parseNumber(payload?.totalCostUsd);
    if (Number.isFinite(totalCostUsd) && totalCostUsd > 0) {
      sessionTotalCostUsd += totalCostUsd;
    }
    return sessionTotalCostUsd;
  }

  function evaluateWarning(config) {
    if (!config?.enabled || warned) {
      return {
        shouldWarn: false,
        sessionTotalCostUsd,
        budgetUsd: config?.budgetUsd ?? null,
        warnFraction: config?.warnFraction ?? 0.8,
        ratio: null,
      };
    }

    const budgetUsd = config.budgetUsd;
    const ratio = budgetUsd > 0 ? sessionTotalCostUsd / budgetUsd : null;
    const threshold = config.warningThresholdUsd;
    const shouldWarn = Number.isFinite(threshold) && sessionTotalCostUsd >= threshold;

    if (shouldWarn) warned = true;

    return {
      shouldWarn,
      sessionTotalCostUsd,
      budgetUsd,
      warnFraction: config.warnFraction,
      ratio,
    };
  }

  return {
    reset,
    consumeUsage,
    evaluateWarning,
    getSessionTotalCostUsd,
  };
}
