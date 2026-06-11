import { describe, expect, it } from "vitest";

import {
  buildMemoryClassRegistryView,
  buildMemoryClassSignalViews,
  buildPresentMemoryClassSignals,
  formatMemoryClassSignalCoverage,
} from "./memory-class-registry-view.js";

describe("memory class registry view", () => {
  it("builds a consumer-facing registry summary from memory bindings", () => {
    const view = buildMemoryClassRegistryView();
    expect(view.summary.classCount).toBe(5);
    expect(view.summary.bindingCount).toBeGreaterThanOrEqual(5);
    expect(view.summary.runtimeConsumerCount).toBeGreaterThan(0);
    expect(view.summary.headline).toContain("classes");
    expect(view.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "profile_semantic",
        label: "Profile Semantic",
      }),
      expect.objectContaining({
        memoryClass: "governance",
        roles: expect.arrayContaining([
          expect.objectContaining({
            role: "observability_consumer",
          }),
        ]),
      }),
    ]));
  });

  it("builds classed signal views with present, partial, and missing status", () => {
    const signals = buildMemoryClassSignalViews({
      presentClasses: ["profile_semantic", "episodic_task"],
      partialClasses: ["procedural_experience"],
      noteByClass: {
        project_semantic: "Current consumer does not attach project semantic input yet.",
      },
    });
    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "profile_semantic",
        status: "available",
      }),
      expect.objectContaining({
        memoryClass: "procedural_experience",
        status: "partial",
      }),
      expect.objectContaining({
        memoryClass: "project_semantic",
        status: "missing",
        note: "Current consumer does not attach project semantic input yet.",
      }),
    ]));
    expect(formatMemoryClassSignalCoverage(signals)).toContain("profile=available");
    expect(formatMemoryClassSignalCoverage(signals)).toContain("project=missing");
  });

  it("can emit present-only signals for runtime payloads", () => {
    const signals = buildPresentMemoryClassSignals(
      ["episodic_task", "governance"],
      {
        episodic_task: "Current payload is backed by task detail and derived task surfaces.",
      },
    );
    expect(signals).toEqual([
      expect.objectContaining({
        memoryClass: "episodic_task",
        status: "available",
      }),
      expect.objectContaining({
        memoryClass: "governance",
        status: "available",
      }),
    ]);
  });
});
