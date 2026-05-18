import { describe, expect, it } from "vitest";

import { createCostBudgetTracker, readCostBudgetConfig } from "./cost-budget.js";

describe("cost budget config", () => {
  it("parses enabled budget config with default warn fraction", () => {
    const config = readCostBudgetConfig({
      BELLDANDY_WEBCHAT_COST_BUDGET_USD: "0.05",
    });
    expect(config).toMatchObject({
      budgetUsd: 0.05,
      warnFraction: 0.8,
      enabled: true,
    });
    expect(config.warningThresholdUsd).toBeCloseTo(0.04, 10);
  });

  it("disables budget when value is missing or invalid", () => {
    expect(readCostBudgetConfig({
      BELLDANDY_WEBCHAT_COST_BUDGET_USD: "",
      BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION: "0.7",
    })).toEqual({
      budgetUsd: null,
      warnFraction: 0.7,
      warningThresholdUsd: null,
      enabled: false,
    });
  });
});

describe("cost budget tracker", () => {
  it("accumulates session total and warns only once", () => {
    const tracker = createCostBudgetTracker();
    const config = readCostBudgetConfig({
      BELLDANDY_WEBCHAT_COST_BUDGET_USD: "0.05",
      BELLDANDY_WEBCHAT_COST_BUDGET_WARN_FRACTION: "0.7",
    });

    tracker.consumeUsage({ totalCostUsd: 0.01 });
    expect(tracker.evaluateWarning(config)).toMatchObject({
      shouldWarn: false,
      sessionTotalCostUsd: 0.01,
    });

    tracker.consumeUsage({ totalCostUsd: 0.03 });
    expect(tracker.evaluateWarning(config)).toMatchObject({
      shouldWarn: true,
      sessionTotalCostUsd: 0.04,
      budgetUsd: 0.05,
    });

    tracker.consumeUsage({ totalCostUsd: 0.01 });
    expect(tracker.evaluateWarning(config)).toMatchObject({
      shouldWarn: false,
      sessionTotalCostUsd: 0.05,
    });
  });

  it("resets session state", () => {
    const tracker = createCostBudgetTracker();
    tracker.consumeUsage({ totalCostUsd: 0.02 });
    tracker.reset();
    expect(tracker.getSessionTotalCostUsd()).toBe(0);
  });
});
