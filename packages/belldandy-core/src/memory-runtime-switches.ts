export type MemoryRuntimeSwitches = {
  masterEnabled: boolean;
  taskStatsCarveOutEnabled: boolean;
  contextInjectionEnabled: boolean;
  autoRecallEnabled: boolean;
  embeddingEnabled: boolean;
  summaryEnabled: boolean;
  evolutionEnabled: boolean;
  taskMemoryEnabled: boolean;
  taskSummaryEnabled: boolean;
  deepRetrievalEnabled: boolean;
};

export type EnvReader = (name: string) => string | undefined;

function isEnabledByDefault(raw: string | undefined): boolean {
  return raw !== "false";
}

function isExplicitlyEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

export function resolveMemoryRuntimeSwitches(readEnv: EnvReader): MemoryRuntimeSwitches {
  const masterEnabled = isEnabledByDefault(readEnv("BELLDANDY_MEMORY_ENABLED"));
  const taskMemoryRequested = isExplicitlyEnabled(readEnv("BELLDANDY_TASK_MEMORY_ENABLED"));
  const taskStatsCarveOutEnabled = !masterEnabled
    && taskMemoryRequested
    && isExplicitlyEnabled(readEnv("BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED"));

  return {
    masterEnabled,
    taskStatsCarveOutEnabled,
    contextInjectionEnabled: masterEnabled && isEnabledByDefault(readEnv("BELLDANDY_CONTEXT_INJECTION")),
    autoRecallEnabled: masterEnabled && isExplicitlyEnabled(readEnv("BELLDANDY_AUTO_RECALL_ENABLED")),
    embeddingEnabled: masterEnabled && isExplicitlyEnabled(readEnv("BELLDANDY_EMBEDDING_ENABLED")),
    summaryEnabled: masterEnabled && isExplicitlyEnabled(readEnv("BELLDANDY_MEMORY_SUMMARY_ENABLED")),
    evolutionEnabled: masterEnabled && isExplicitlyEnabled(readEnv("BELLDANDY_MEMORY_EVOLUTION_ENABLED")),
    taskMemoryEnabled: (masterEnabled && taskMemoryRequested) || taskStatsCarveOutEnabled,
    taskSummaryEnabled: masterEnabled && isExplicitlyEnabled(readEnv("BELLDANDY_TASK_SUMMARY_ENABLED")),
    deepRetrievalEnabled: masterEnabled && isExplicitlyEnabled(readEnv("BELLDANDY_MEMORY_DEEP_RETRIEVAL")),
  };
}
