import { describe, expect, it } from "vitest";

import {
  findMemoryClassBindingsByModulePath,
  getMemoryClassBindingEntry,
  listMemoryClassBindingEntries,
  listMemoryClassBindings,
  normalizeMemoryClassModulePath,
} from "./memory-class-bindings.js";

describe("memory class bindings", () => {
  it("groups bindings by class and keeps profile runtime consumers derived from canonical state", () => {
    const profile = getMemoryClassBindingEntry("profile_semantic");
    expect(profile.contract.memoryClass).toBe("profile_semantic");
    expect(profile.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modulePath: "packages/belldandy-memory/src/profile-state.ts",
          role: "canonical_source",
          truthMode: "canonical",
        }),
        expect.objectContaining({
          modulePath: "packages/belldandy-core/src/mind-profile-runtime-prelude.ts",
          role: "runtime_consumer",
          truthMode: "runtime_projection",
        }),
      ]),
    );
  });

  it("resolves module path lookups across slash styles", () => {
    expect(normalizeMemoryClassModulePath("packages\\belldandy-memory\\src\\memory-tree-layer-builders.ts"))
      .toBe("packages/belldandy-memory/src/memory-tree-layer-builders.ts");

    const bindings = findMemoryClassBindingsByModulePath("packages\\belldandy-memory\\src\\memory-tree-layer-builders.ts");
    expect(bindings).toEqual([
      expect.objectContaining({
        memoryClass: "project_semantic",
        role: "primary_read_model",
        truthMode: "derived",
      }),
    ]);
  });

  it("supports role and tag filters for review and observability surfaces", () => {
    const reviewConsumers = listMemoryClassBindings({ role: "review_consumer" });
    expect(reviewConsumers).toEqual([
      expect.objectContaining({
        memoryClass: "governance",
        modulePath: "packages/belldandy-core/src/learning-review-input.ts",
      }),
    ]);

    const experienceFreshness = listMemoryClassBindings({
      memoryClass: "procedural_experience",
      tag: "freshness",
    });
    expect(experienceFreshness).toEqual([
      expect.objectContaining({
        modulePath: "packages/belldandy-core/src/skill-freshness.ts",
        role: "observability_consumer",
      }),
    ]);

    expect(listMemoryClassBindingEntries().map((entry) => entry.contract.memoryClass)).toEqual([
      "profile_semantic",
      "project_semantic",
      "episodic_task",
      "procedural_experience",
      "governance",
    ]);
  });
});
