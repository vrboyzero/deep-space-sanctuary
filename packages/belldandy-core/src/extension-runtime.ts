import type { PluginRegistry } from "@belldandy/plugins";
import type { PluginHookMetric } from "@belldandy/plugins";
import type { PluginLoadErrorRecord } from "@belldandy/plugins";
import type { SkillDefinition, SkillRegistry } from "@belldandy/skills";

import type { ToolsConfigManager } from "./tools-config.js";

export const SKILL_MANAGEMENT_TOOL_NAMES = ["skills_list", "skills_search", "skill_get"] as const;

type ExtensionSkillRuntimeItem = {
  name: string;
  description: string;
  source: SkillDefinition["source"]["type"];
  pluginId?: string;
  priority: SkillDefinition["priority"];
  tags: string[];
  disabled: boolean;
  eligible: boolean;
  eligibilityReasons: string[];
};

type ExtensionPluginRuntimeItem = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  toolNames: string[];
  skillDirs: string[];
  disabled: boolean;
};

type ExtensionRegistryPlan = {
  pluginToolRegistrations: Array<{
    pluginId: string;
    toolNames: string[];
    disabled: boolean;
  }>;
  skillManagementTools: Array<{
    name: (typeof SKILL_MANAGEMENT_TOOL_NAMES)[number];
    shouldRegister: boolean;
    reasonCode: "available" | "no-skills-loaded";
  }>;
  promptSkillNames: string[];
  searchableSkillNames: string[];
};

export type ExtensionRuntimeReport = {
  summary: {
    pluginCount: number;
    disabledPluginCount: number;
    pluginToolCount: number;
    pluginLoadErrorCount: number;
    pluginHookMetricCount: number;
    pluginHookFailureCount: number;
    skillCount: number;
    disabledSkillCount: number;
    ineligibleSkillCount: number;
    promptSkillCount: number;
    searchableSkillCount: number;
  };
  plugins: ExtensionPluginRuntimeItem[];
  skills: ExtensionSkillRuntimeItem[];
  registry: ExtensionRegistryPlan;
  diagnostics: {
    pluginLoadErrors: PluginLoadErrorRecord[];
    pluginHookMetrics: PluginHookMetric[];
    hookMetricEvictionCount: number;
  };
};

function getDisabledConfig(toolsConfigManager?: ToolsConfigManager) {
  return toolsConfigManager?.getConfig().disabled ?? {
    builtin: [],
    mcp_servers: [],
    plugins: [],
    skills: [],
  };
}

function isSkillDisabled(toolsConfigManager: ToolsConfigManager | undefined, skillName: string): boolean {
  return getDisabledConfig(toolsConfigManager).skills.includes(skillName);
}

export function listEnabledPromptSkills(input: {
  skillRegistry?: SkillRegistry;
  toolsConfigManager?: ToolsConfigManager;
}): SkillDefinition[] {
  return (input.skillRegistry?.getPromptSkills() ?? []).filter((skill) =>
    !isSkillDisabled(input.toolsConfigManager, skill.name),
  );
}

export function listEnabledSearchableSkills(input: {
  skillRegistry?: SkillRegistry;
  toolsConfigManager?: ToolsConfigManager;
}): SkillDefinition[] {
  return (input.skillRegistry?.getSearchableSkills() ?? []).filter((skill) =>
    !isSkillDisabled(input.toolsConfigManager, skill.name),
  );
}

export function searchEnabledSkills(input: {
  skillRegistry?: SkillRegistry;
  toolsConfigManager?: ToolsConfigManager;
}, query: string): SkillDefinition[] {
  return (input.skillRegistry?.searchSkills(query) ?? []).filter((skill) =>
    !isSkillDisabled(input.toolsConfigManager, skill.name),
  );
}

export function buildExtensionRuntimeReport(input: {
  pluginRegistry?: PluginRegistry;
  skillRegistry?: SkillRegistry;
  toolsConfigManager?: ToolsConfigManager;
}): ExtensionRuntimeReport {
  const disabled = getDisabledConfig(input.toolsConfigManager);

  const pluginDiagnostics = input.pluginRegistry?.getDiagnostics();
  const pluginHookMetrics = pluginDiagnostics?.hookMetrics ?? [];
  const plugins = (input.pluginRegistry?.listPlugins() ?? []).map((plugin) => ({
    ...plugin,
    toolNames: [...plugin.toolNames].sort((a, b) => a.localeCompare(b)),
    disabled: disabled.plugins.includes(plugin.id),
  }));

  const skills = (input.skillRegistry?.listSkills() ?? [])
    .map((skill) => {
      const eligibility = input.skillRegistry?.getEligibilityResult(skill.name);
      const eligible = eligibility ? eligibility.eligible : true;
      return {
        name: skill.name,
        description: skill.description,
        source: skill.source.type,
        pluginId: skill.source.type === "plugin" ? skill.source.pluginId : undefined,
        priority: skill.priority,
        tags: [...(skill.tags ?? [])],
        disabled: disabled.skills.includes(skill.name),
        eligible,
        eligibilityReasons: eligibility?.reasons ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const promptSkills = listEnabledPromptSkills(input);
  const searchableSkills = listEnabledSearchableSkills(input);
  const registry: ExtensionRegistryPlan = {
    pluginToolRegistrations: plugins.map((plugin) => ({
      pluginId: plugin.id,
      toolNames: [...plugin.toolNames],
      disabled: plugin.disabled,
    })),
    skillManagementTools: SKILL_MANAGEMENT_TOOL_NAMES.map((name) => ({
      name,
      shouldRegister: skills.length > 0,
      reasonCode: skills.length > 0 ? "available" : "no-skills-loaded",
    })),
    promptSkillNames: promptSkills.map((skill) => skill.name),
    searchableSkillNames: searchableSkills.map((skill) => skill.name),
  };

  return {
    summary: {
      pluginCount: plugins.length,
      disabledPluginCount: plugins.filter((plugin) => plugin.disabled).length,
      pluginToolCount: plugins.reduce((sum, plugin) => sum + plugin.toolNames.length, 0),
      pluginLoadErrorCount: pluginDiagnostics?.loadErrors.length ?? 0,
      pluginHookMetricCount: pluginHookMetrics.length,
      pluginHookFailureCount: pluginHookMetrics.reduce((sum, metric) => sum + metric.failedCount, 0),
      skillCount: skills.length,
      disabledSkillCount: skills.filter((skill) => skill.disabled).length,
      ineligibleSkillCount: skills.filter((skill) => !skill.eligible).length,
      promptSkillCount: promptSkills.length,
      searchableSkillCount: searchableSkills.length,
    },
    plugins,
    skills,
    registry,
    diagnostics: {
      pluginLoadErrors: (pluginDiagnostics?.loadErrors ?? []).map((item) => ({ ...item })),
      pluginHookMetrics: pluginHookMetrics.map((item) => ({ ...item })),
      hookMetricEvictionCount: pluginDiagnostics?.hookMetricEvictionCount ?? 0,
    },
  };
}
