export type TaskMemoryCarveOutEffectsInput = {
  taskStatsCarveOutEnabled: boolean;
  taskDedupGuardEnabled: boolean;
  experienceAutoPromotionEnabled: boolean;
  experienceAutoMethodEnabled: boolean;
  experienceAutoSkillEnabled: boolean;
};

export type TaskMemoryCarveOutEffects = {
  taskStatsCarveOutEnabled: boolean;
  taskDedupGuardEnabled: boolean;
  experienceAutoPromotionEnabled: boolean;
  experienceAutoMethodEnabled: boolean;
  experienceAutoSkillEnabled: boolean;
};

export function resolveTaskMemoryCarveOutEffects(
  input: TaskMemoryCarveOutEffectsInput,
): TaskMemoryCarveOutEffects {
  const experienceAutoPromotionEnabled = input.taskStatsCarveOutEnabled
    ? false
    : input.experienceAutoPromotionEnabled;

  return {
    taskStatsCarveOutEnabled: input.taskStatsCarveOutEnabled,
    taskDedupGuardEnabled: input.taskStatsCarveOutEnabled ? false : input.taskDedupGuardEnabled,
    experienceAutoPromotionEnabled,
    experienceAutoMethodEnabled: experienceAutoPromotionEnabled && input.experienceAutoMethodEnabled,
    experienceAutoSkillEnabled: experienceAutoPromotionEnabled && input.experienceAutoSkillEnabled,
  };
}
