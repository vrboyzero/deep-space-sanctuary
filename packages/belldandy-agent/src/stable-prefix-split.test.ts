/**
 * Phase 4 测试：stable prefix / transient tail 拆层
 */

import { describe, expect, it } from "vitest";

import {
  splitDeltasByStability,
  buildTransientTailText,
  injectTransientTail,
  buildIndependentBlockText,
  injectIndependentBlock,
  isTransientSafeDelta,
  isStableDelta,
  isIndependentBlockDelta,
  DEFAULT_STABLE_PREFIX_SPLIT_OPTIONS,
} from "./stable-prefix-split.js";

import type { AgentPromptDelta as AgentDelta } from "./prompt-snapshot.js";

function buildDelta(deltaType: string, text: string): AgentDelta {
  return { id: `test-${deltaType}`, deltaType: deltaType as any, role: "system", text };
}

describe("Phase 4: isTransientSafeDelta / isStableDelta", () => {
  it("identifies transient-safe delta types", () => {
    expect(isTransientSafeDelta(buildDelta("tool-failure-recovery", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("tool-search-follow-up", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("tool-post-verification", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("delegation-result-review", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("team-topology-and-ownership", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("team-handoff-review", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("team-fan-in-triage", "x"))).toBe(true);
    expect(isTransientSafeDelta(buildDelta("team-completion-gate", "x"))).toBe(true);
  });

  it("identifies stable delta types", () => {
    expect(isStableDelta(buildDelta("user-prelude", "x"))).toBe(true);
    expect(isStableDelta(buildDelta("launch-spec", "x"))).toBe(true);
    expect(isStableDelta(buildDelta("runtime-identity-authority", "x"))).toBe(false);
  });

  it("returns false for unknown types", () => {
    expect(isTransientSafeDelta(buildDelta("unknown-type", "x"))).toBe(false);
    expect(isStableDelta(buildDelta("unknown-type", "x"))).toBe(false);
  });
});

describe("Phase 4: splitDeltasByStability", () => {
  it("returns all deltas as stable when disabled", () => {
    const deltas = [
      buildDelta("tool-failure-recovery", "recovery"),
      buildDelta("user-prelude", "prelude"),
    ];
    const result = splitDeltasByStability(deltas, { enabled: false });
    expect(result.splitActivated).toBe(false);
    expect(result.stableDeltas).toHaveLength(2);
    expect(result.transientDeltas).toHaveLength(0);
    expect(result.splitCount).toBe(0);
  });

  it("splits deltas when enabled", () => {
    const deltas = [
      buildDelta("user-prelude", "prelude"),
      buildDelta("tool-failure-recovery", "recovery"),
      buildDelta("team-handoff-review", "handoff"),
      buildDelta("runtime-identity-authority", "authority"),
    ];
    const result = splitDeltasByStability(deltas, { enabled: true });
    expect(result.splitActivated).toBe(true);
    expect(result.stableDeltas).toHaveLength(1);
    expect(result.transientDeltas).toHaveLength(2);
    expect(result.independentBlockDeltas).toHaveLength(1);
    expect(result.splitCount).toBe(2);
    expect(result.splitTokensEstimate).toBeGreaterThan(0);
    // stable: user-prelude
    expect(result.stableDeltas.map(d => d.deltaType)).toEqual(["user-prelude"]);
    // transient: tool-failure-recovery + team-handoff-review
    expect(result.transientDeltas.map(d => d.deltaType)).toEqual(expect.arrayContaining(["tool-failure-recovery", "team-handoff-review"]));
    // independent block: runtime-identity-authority
    expect(result.independentBlockDeltas.map(d => d.deltaType)).toEqual(["runtime-identity-authority"]);
  });

  it("returns no split when no transient or independent deltas present", () => {
    const deltas = [
      buildDelta("user-prelude", "prelude"),
    ];
    const result = splitDeltasByStability(deltas, { enabled: true });
    expect(result.splitActivated).toBe(false);
    expect(result.stableDeltas).toHaveLength(1);
    expect(result.transientDeltas).toHaveLength(0);
    expect(result.independentBlockDeltas).toHaveLength(0);
  });

  it("defaults to disabled", () => {
    const deltas = [buildDelta("tool-failure-recovery", "x")];
    const result = splitDeltasByStability(deltas);
    expect(result.splitActivated).toBe(false);
  });
});

describe("Phase 4: buildTransientTailText", () => {
  it("builds text from transient deltas", () => {
    const deltas = [
      buildDelta("tool-failure-recovery", "工具失败恢复指导"),
      buildDelta("team-handoff-review", "团队交接指导"),
    ];
    const text = buildTransientTailText(deltas);
    expect(text).toContain("<transient-context");
    expect(text).toContain("工具失败恢复指导");
    expect(text).toContain("团队交接指导");
    expect(text).toContain("</transient-context>");
  });

  it("returns empty string for no deltas", () => {
    expect(buildTransientTailText([])).toBe("");
  });

  it("filters empty text deltas", () => {
    const deltas = [
      buildDelta("tool-failure-recovery", "real content"),
      buildDelta("team-handoff-review", "  "),
    ];
    const text = buildTransientTailText(deltas);
    expect(text).toContain("real content");
    expect(text).not.toContain("  ");
  });
});

describe("Phase 4: injectTransientTail", () => {
  it("injects before last user message", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "continue" },
    ];
    const result = injectTransientTail(messages, "transient text");
    expect(result.injected).toBe(true);
    expect(result.insertIndex).toBe(3);
    expect(messages[3]).toEqual({ role: "system", content: "transient text" });
    expect(messages[4]).toEqual({ role: "user", content: "continue" });
  });

  it("appends to end if no user message", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "hi" },
    ];
    const result = injectTransientTail(messages, "transient text");
    expect(result.injected).toBe(true);
    expect(messages[messages.length - 1]).toEqual({ role: "system", content: "transient text" });
  });

  it("does nothing for empty text", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = injectTransientTail(messages, "");
    expect(result.injected).toBe(false);
    expect(messages).toHaveLength(1);
  });
});

describe("Phase 4: DEFAULT_STABLE_PREFIX_SPLIT_OPTIONS", () => {
  it("defaults to disabled", () => {
    expect(DEFAULT_STABLE_PREFIX_SPLIT_OPTIONS.enabled).toBe(false);
  });
});

describe("Phase 4 step 2: independent block (identity-authority)", () => {
  it("isIndependentBlockDelta identifies identity-authority", () => {
    expect(isIndependentBlockDelta(buildDelta("runtime-identity-authority", "x"))).toBe(true);
    expect(isIndependentBlockDelta(buildDelta("user-prelude", "x"))).toBe(false);
    expect(isIndependentBlockDelta(buildDelta("tool-failure-recovery", "x"))).toBe(false);
  });

  it("buildIndependentBlockText wraps with identity-authority tag", () => {
    const deltas = [buildDelta("runtime-identity-authority", "Authority mode: owner")];
    const text = buildIndependentBlockText(deltas);
    expect(text).toContain("<identity-authority");
    expect(text).toContain("Authority mode: owner");
    expect(text).toContain("</identity-authority>");
  });

  it("buildIndependentBlockText returns empty for no deltas", () => {
    expect(buildIndependentBlockText([])).toBe("");
  });

  it("injectIndependentBlock inserts after system prompt", () => {
    const messages = [
      { role: "system", content: "sys prompt" },
      { role: "user", content: "hello" },
    ];
    const result = injectIndependentBlock(messages, "identity block");
    expect(result.injected).toBe(true);
    expect(result.insertIndex).toBe(1);
    expect(messages[0]).toEqual({ role: "system", content: "sys prompt" });
    expect(messages[1]).toEqual({ role: "system", content: "identity block" });
    expect(messages[2]).toEqual({ role: "user", content: "hello" });
  });

  it("injectIndependentBlock inserts at front if no system prompt", () => {
    const messages = [
      { role: "user", content: "hello" },
    ];
    const result = injectIndependentBlock(messages, "identity block");
    expect(result.injected).toBe(true);
    expect(result.insertIndex).toBe(0);
    expect(messages[0]).toEqual({ role: "system", content: "identity block" });
  });

  it("injectIndependentBlock does nothing for empty text", () => {
    const messages = [{ role: "system", content: "sys" }];
    const result = injectIndependentBlock(messages, "");
    expect(result.injected).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it("splitDeltasByStability separates identity-authority into independent block", () => {
    const deltas = [
      buildDelta("user-prelude", "prelude"),
      buildDelta("runtime-identity-authority", "authority"),
      buildDelta("tool-failure-recovery", "recovery"),
    ];
    const result = splitDeltasByStability(deltas, { enabled: true });
    expect(result.stableDeltas.map(d => d.deltaType)).toEqual(["user-prelude"]);
    expect(result.transientDeltas.map(d => d.deltaType)).toEqual(["tool-failure-recovery"]);
    expect(result.independentBlockDeltas.map(d => d.deltaType)).toEqual(["runtime-identity-authority"]);
    expect(result.splitActivated).toBe(true);
  });
});
