/**
 * Phase 3 测试：budget protect 策略
 */

import { describe, expect, it } from "vitest";

import {
  resolveBudgetProtectOptions,
  computeProtectedIndices,
  isCompressibleHistoryMessage,
  isDeletableHistoryMessage,
  createEmptyBudgetProtectDiagnostics,
  DEFAULT_BUDGET_PROTECT_OPTIONS,
  type BudgetProtectOptions,
} from "./budget-protect.js";

describe("Phase 3: resolveBudgetProtectOptions", () => {
  it("returns defaults when no opts provided", () => {
    const opts = resolveBudgetProtectOptions();
    expect(opts.mode).toBe("protect_memory_capability");
    expect(opts.keepRecentRounds).toBe(3);
    expect(opts.compressBeforeDelete).toBe(true);
    expect(opts.compressThresholdChars).toBe(500);
  });

  it("merges user overrides", () => {
    const opts = resolveBudgetProtectOptions({
      mode: "history_first",
      keepRecentRounds: 5,
    });
    expect(opts.mode).toBe("history_first");
    expect(opts.keepRecentRounds).toBe(5);
    expect(opts.compressBeforeDelete).toBe(true);
  });
});

describe("Phase 3: computeProtectedIndices", () => {
  it("protects last N rounds", () => {
    const messages = [
      { role: "system" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" }, // current
    ];
    const protected_ = computeProtectedIndices(messages, 3);
    // 最后 3 个 user 在 index 2,4,6 → 从 index 4 开始保护
    expect(protected_.has(0)).toBe(false); // system
    expect(protected_.has(1)).toBe(false); // old user
    expect(protected_.has(2)).toBe(false); // old assistant
    expect(protected_.has(4)).toBe(true); // protected user
    expect(protected_.has(5)).toBe(true); // protected assistant
    expect(protected_.has(6)).toBe(true); // protected user
    expect(protected_.has(7)).toBe(true); // current user
  });

  it("protects all non-system when fewer than N rounds", () => {
    const messages = [
      { role: "system" },
      { role: "user" },
      { role: "assistant" },
    ];
    const protected_ = computeProtectedIndices(messages, 3);
    expect(protected_.has(0)).toBe(false); // system
    expect(protected_.has(1)).toBe(true); // user
    expect(protected_.has(2)).toBe(true); // assistant
  });

  it("returns empty set for keepRecentRounds=0", () => {
    const messages = [
      { role: "system" },
      { role: "user" },
    ];
    const protected_ = computeProtectedIndices(messages, 0);
    expect(protected_.size).toBe(0);
  });
});

describe("Phase 3: isCompressibleHistoryMessage", () => {
  it("returns true for long user/assistant messages", () => {
    expect(isCompressibleHistoryMessage({ role: "user", content: "x".repeat(600) }, 500)).toBe(true);
    expect(isCompressibleHistoryMessage({ role: "assistant", content: "x".repeat(600) }, 500)).toBe(true);
  });

  it("returns false for short messages", () => {
    expect(isCompressibleHistoryMessage({ role: "user", content: "short" }, 500)).toBe(false);
  });

  it("returns false for tool/system messages", () => {
    expect(isCompressibleHistoryMessage({ role: "tool", content: "x".repeat(600) }, 500)).toBe(false);
    expect(isCompressibleHistoryMessage({ role: "system", content: "x".repeat(600) }, 500)).toBe(false);
  });

  it("returns false for non-string content", () => {
    expect(isCompressibleHistoryMessage({ role: "user", content: null }, 500)).toBe(false);
    expect(isCompressibleHistoryMessage({ role: "user", content: undefined }, 500)).toBe(false);
  });
});

describe("Phase 3: isDeletableHistoryMessage", () => {
  it("returns false for system messages", () => {
    expect(isDeletableHistoryMessage({ role: "system" }, 0, new Set())).toBe(false);
  });

  it("returns false for protected indices", () => {
    const protected_ = new Set([2, 3]);
    expect(isDeletableHistoryMessage({ role: "user" }, 2, protected_)).toBe(false);
    expect(isDeletableHistoryMessage({ role: "assistant" }, 3, protected_)).toBe(false);
  });

  it("returns true for non-protected history messages", () => {
    const protected_ = new Set([5]);
    expect(isDeletableHistoryMessage({ role: "user" }, 1, protected_)).toBe(true);
    expect(isDeletableHistoryMessage({ role: "assistant" }, 2, protected_)).toBe(true);
  });
});

describe("Phase 3: createEmptyBudgetProtectDiagnostics", () => {
  it("creates empty diagnostics with mode", () => {
    const diag = createEmptyBudgetProtectDiagnostics("protect_memory_capability");
    expect(diag.mode).toBe("protect_memory_capability");
    expect(diag.compressedHistoryCount).toBe(0);
    expect(diag.deletedHistoryCount).toBe(0);
    expect(diag.protectionActivated).toBe(false);
  });
});

describe("Phase 3: DEFAULT_BUDGET_PROTECT_OPTIONS", () => {
  it("has protect_memory_capability as default mode", () => {
    expect(DEFAULT_BUDGET_PROTECT_OPTIONS.mode).toBe("protect_memory_capability");
  });
});
