import { describe, expect, it } from "vitest";

import { resolveMemoryRuntimeSwitches } from "./memory-runtime-switches.js";

function createEnv(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

describe("memory runtime switches", () => {
  it("keeps runtime memory features enabled when master switch is enabled", () => {
    const switches = resolveMemoryRuntimeSwitches(createEnv({
      BELLDANDY_MEMORY_ENABLED: "true",
      BELLDANDY_CONTEXT_INJECTION: "true",
      BELLDANDY_AUTO_RECALL_ENABLED: "true",
      BELLDANDY_EMBEDDING_ENABLED: "true",
      BELLDANDY_MEMORY_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
      BELLDANDY_TASK_MEMORY_ENABLED: "true",
      BELLDANDY_TASK_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_DEEP_RETRIEVAL: "true",
    }));

    expect(switches).toEqual({
      masterEnabled: true,
      taskStatsCarveOutEnabled: false,
      contextInjectionEnabled: true,
      autoRecallEnabled: true,
      embeddingEnabled: true,
      summaryEnabled: true,
      evolutionEnabled: true,
      taskMemoryEnabled: true,
      taskSummaryEnabled: true,
      deepRetrievalEnabled: true,
    });
  });

  it("forces runtime memory features off when master switch is disabled", () => {
    const switches = resolveMemoryRuntimeSwitches(createEnv({
      BELLDANDY_MEMORY_ENABLED: "false",
      BELLDANDY_CONTEXT_INJECTION: "true",
      BELLDANDY_AUTO_RECALL_ENABLED: "true",
      BELLDANDY_EMBEDDING_ENABLED: "true",
      BELLDANDY_MEMORY_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
      BELLDANDY_TASK_MEMORY_ENABLED: "true",
      BELLDANDY_TASK_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_DEEP_RETRIEVAL: "true",
    }));

    expect(switches).toEqual({
      masterEnabled: false,
      taskStatsCarveOutEnabled: false,
      contextInjectionEnabled: false,
      autoRecallEnabled: false,
      embeddingEnabled: false,
      summaryEnabled: false,
      evolutionEnabled: false,
      taskMemoryEnabled: false,
      taskSummaryEnabled: false,
      deepRetrievalEnabled: false,
    });
  });

  it("keeps task stats enabled as an explicit carve-out when memory master switch is disabled", () => {
    const switches = resolveMemoryRuntimeSwitches(createEnv({
      BELLDANDY_MEMORY_ENABLED: "false",
      BELLDANDY_TASK_MEMORY_ENABLED: "true",
      BELLDANDY_TASK_STATS_WHEN_MEMORY_DISABLED: "true",
      BELLDANDY_TASK_SUMMARY_ENABLED: "true",
      BELLDANDY_CONTEXT_INJECTION: "true",
      BELLDANDY_AUTO_RECALL_ENABLED: "true",
      BELLDANDY_EMBEDDING_ENABLED: "true",
      BELLDANDY_MEMORY_SUMMARY_ENABLED: "true",
      BELLDANDY_MEMORY_EVOLUTION_ENABLED: "true",
      BELLDANDY_MEMORY_DEEP_RETRIEVAL: "true",
    }));

    expect(switches).toEqual({
      masterEnabled: false,
      taskStatsCarveOutEnabled: true,
      contextInjectionEnabled: false,
      autoRecallEnabled: false,
      embeddingEnabled: false,
      summaryEnabled: false,
      evolutionEnabled: false,
      taskMemoryEnabled: true,
      taskSummaryEnabled: false,
      deepRetrievalEnabled: false,
    });
  });
});
