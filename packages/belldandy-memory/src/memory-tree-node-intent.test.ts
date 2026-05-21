import { describe, expect, it } from "vitest";

import {
  applyMemoryTreeNodeRoutingBoost,
  resolveMemoryTreeNodeRoutingPlan,
} from "./memory-tree-node-intent.js";

describe("memory tree node intent", () => {
  it("builds an explicit global overview routing plan for high-level queries", () => {
    const hint = resolveMemoryTreeNodeRoutingPlan("global focus and profile preferences");

    expect(hint.includeKinds).toEqual(expect.arrayContaining([
      "global",
      "profile",
      "project",
      "agent",
    ]));
    expect(hint.routeClass).toBe("global_overview");
    expect(hint.routeReasons).toEqual(expect.arrayContaining(["term:global", "term:profile"]));
    expect(hint.scoreBoostByKind).toMatchObject({
      global: 7,
      profile: 3,
      project: 3,
    });
  });

  it("boosts matching node kinds and appends routing reasons", () => {
    const hint = resolveMemoryTreeNodeRoutingPlan("global focus");
    const boosted = applyMemoryTreeNodeRoutingBoost({
      id: "global:workspace",
      level: 3,
      kind: "global",
      scope: "private",
      summary: "Global workspace focus",
    }, 4, ["摘要"], hint);

    expect(boosted.score).toBe(11);
    expect(boosted.matchReasons).toEqual(expect.arrayContaining(["摘要", "intent:global"]));
  });

  it("routes topic filtered queries to topic lookup", () => {
    const plan = resolveMemoryTreeNodeRoutingPlan("viewer audit details", {
      topic: "viewer-audit",
    } as any);

    expect(plan.routeClass).toBe("topic_lookup");
    expect(plan.chunkLimitPerNode).toBe(3);
    expect(plan.includeKinds[0]).toBe("topic");
    expect(plan.routeReasons).toEqual(expect.arrayContaining(["filter:topic"]));
  });
});
