import { describe, expect, it } from "vitest";

import { resolveTaskMemoryCarveOutEffects } from "./task-memory-carve-out.js";

describe("task memory carve-out effects", () => {
  it("forces dedup guard and experience auto promotion off in task-stats carve-out mode", () => {
    expect(resolveTaskMemoryCarveOutEffects({
      taskStatsCarveOutEnabled: true,
      taskDedupGuardEnabled: true,
      experienceAutoPromotionEnabled: true,
      experienceAutoMethodEnabled: true,
      experienceAutoSkillEnabled: true,
    })).toEqual({
      taskStatsCarveOutEnabled: true,
      taskDedupGuardEnabled: false,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
  });

  it("keeps normal runtime semantics when carve-out mode is inactive", () => {
    expect(resolveTaskMemoryCarveOutEffects({
      taskStatsCarveOutEnabled: false,
      taskDedupGuardEnabled: true,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: true,
      experienceAutoSkillEnabled: true,
    })).toEqual({
      taskStatsCarveOutEnabled: false,
      taskDedupGuardEnabled: true,
      experienceAutoPromotionEnabled: false,
      experienceAutoMethodEnabled: false,
      experienceAutoSkillEnabled: false,
    });
  });
});
