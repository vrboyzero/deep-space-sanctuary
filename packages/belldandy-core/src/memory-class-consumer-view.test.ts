import { describe, expect, it } from "vitest";

import { buildMemoryClassConsumerView } from "./memory-class-consumer-view.js";

describe("memory class consumer view", () => {
  it("builds coverage and optional registry for consumer payloads", () => {
    const view = buildMemoryClassConsumerView({
      presentClasses: ["profile_semantic", "governance"],
      partialClasses: ["project_semantic"],
      noteByClass: {
        project_semantic: "Project semantic is not explicitly attached yet.",
      },
      includeRegistry: true,
      registryClasses: ["profile_semantic", "project_semantic", "governance"],
    });

    expect(view.memoryClassCoverage).toMatchObject({
      availableCount: 2,
      partialCount: 1,
      missingCount: 2,
    });
    expect(view.memoryClassCoverage.headline).toContain("profile=available");
    expect(view.memoryClassSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryClass: "project_semantic",
        status: "partial",
      }),
    ]));
    expect(view.memoryClassRegistry?.summary.classCount).toBe(3);
  });
});
