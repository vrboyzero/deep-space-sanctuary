import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HookRegistry } from "@belldandy/agent";
import { ToolExecutor } from "@belldandy/skills";

import { installMarketplaceExtension } from "./extension-marketplace-service.js";
import { bridgeLegacyPluginHooks, initializeExtensionHost } from "./extension-host.js";
import { ToolsConfigManager } from "./tools-config.js";

describe("initializeExtensionHost", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("unifies plugin loading, skill loading, registry registration, and enabled-skill selection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-"));
    const bundledSkillsDir = path.join(stateDir, "bundled-skills");
    const pluginDir = path.join(stateDir, "plugins");
    const pluginSkillRoot = path.join(stateDir, "plugin-skill-root");
    tempDirs.push(stateDir);

    await fs.mkdir(path.join(bundledSkillsDir, "always-skill"), { recursive: true });
    await fs.mkdir(path.join(bundledSkillsDir, "normal-skill"), { recursive: true });
    await fs.mkdir(path.join(pluginSkillRoot, "plugin-skill"), { recursive: true });
    await fs.mkdir(pluginDir, { recursive: true });

    await fs.writeFile(
      path.join(bundledSkillsDir, "always-skill", "SKILL.md"),
      [
        "---",
        "name: always-skill",
        "description: always skill",
        "priority: high",
        "---",
        "Always instructions",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(bundledSkillsDir, "normal-skill", "SKILL.md"),
      [
        "---",
        "name: normal-skill",
        "description: normal skill",
        "priority: normal",
        "---",
        "Normal instructions",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(pluginSkillRoot, "plugin-skill", "SKILL.md"),
      [
        "---",
        "name: plugin-skill",
        "description: plugin skill",
        "priority: normal",
        "---",
        "Plugin instructions",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(path.join(pluginDir, "broken-plugin.mjs"), "export default {};\n", "utf-8");
    await fs.writeFile(
      path.join(pluginDir, "good-plugin.mjs"),
      [
        `const skillDir = ${JSON.stringify(pluginSkillRoot)};`,
        "export default {",
        "  id: 'good-plugin',",
        "  name: 'Good Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: {",
        "        name: 'plugin_good_tool',",
        "        description: 'plugin tool',",
        "        parameters: { type: 'object', properties: {} },",
        "      },",
        "      async execute() {",
        "        return { id: '', name: 'plugin_good_tool', success: true, output: 'ok' };",
        "      },",
        "    });",
        "    context.registerSkillDir(skillDir);",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const toolsConfigManager = new ToolsConfigManager(stateDir);
    await toolsConfigManager.load();
    await toolsConfigManager.updateConfig({
      skills: ["always-skill"],
    });

    const toolExecutor = new ToolExecutor({
      tools: [],
      workspaceRoot: stateDir,
    });
    const logs: string[] = [];

    const result = await initializeExtensionHost({
      stateDir,
      bundledSkillsDir,
      workspaceRoot: stateDir,
      toolsEnabled: true,
      toolExecutor,
      toolsConfigManager,
      activeMcpServers: [],
      logger: {
        info: (scope, message) => logs.push(`info:${scope}:${message}`),
        warn: (scope, message) => logs.push(`warn:${scope}:${message}`),
      },
    });

    expect(result.extensionRuntime.summary).toEqual({
      pluginCount: 1,
      disabledPluginCount: 0,
      pluginToolCount: 1,
      pluginLoadErrorCount: 1,
      pluginHookMetricCount: 0,
      pluginHookFailureCount: 0,
      skillCount: 3,
      disabledSkillCount: 1,
      ineligibleSkillCount: 0,
      promptSkillCount: 0,
      searchableSkillCount: 2,
    });
    expect(result.extensionRuntime.registry).toEqual({
      pluginToolRegistrations: [
        {
          pluginId: "good-plugin",
          toolNames: ["plugin_good_tool"],
          disabled: false,
        },
      ],
      skillManagementTools: [
        { name: "skills_list", shouldRegister: true, reasonCode: "available" },
        { name: "skills_search", shouldRegister: true, reasonCode: "available" },
        { name: "skill_get", shouldRegister: true, reasonCode: "available" },
      ],
      promptSkillNames: [],
      searchableSkillNames: ["normal-skill", "plugin-skill"],
    });
    expect(result.promptSkills).toEqual([]);
    expect(result.searchableSkills.map((skill) => skill.name)).toEqual(["normal-skill", "plugin-skill"]);
    expect(toolExecutor.getRegisteredToolNames()).toEqual(expect.arrayContaining([
      "plugin_good_tool",
      "skills_list",
      "skills_search",
      "skill_get",
    ]));
    expect(toolExecutor.getRegistryInventory().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "plugin_good_tool",
        origin: "plugin",
        contractStatus: "governed",
      }),
    ]));
    expect(logs.some((line) => line.includes("eligible: 0 prompt-injected, 2 searchable"))).toBe(true);
  });

  it("fails startup when the required bundled skills directory is invalid", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-invalid-skills-"));
    tempDirs.push(stateDir);
    const toolsConfigManager = new ToolsConfigManager(stateDir);
    await toolsConfigManager.load();

    await expect(initializeExtensionHost({
      stateDir,
      bundledSkillsDir: path.join(stateDir, "missing-bundled-skills"),
      workspaceRoot: stateDir,
      toolsEnabled: true,
      toolExecutor: new ToolExecutor({ tools: [], workspaceRoot: stateDir }),
      toolsConfigManager,
      activeMcpServers: [],
      logger: {
        info() {},
        warn() {},
      },
    })).rejects.toThrow(/Invalid required skill directory/);
  });

  it("bridges legacy plugin hooks into HookRegistry and records lifecycle summary", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-hooks-"));
    const bundledSkillsDir = path.join(stateDir, "bundled-skills");
    const pluginDir = path.join(stateDir, "plugins");
    tempDirs.push(stateDir);

    await fs.mkdir(bundledSkillsDir, { recursive: true });
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, "hooks-plugin.mjs"),
      [
        "export default {",
        "  id: 'hooks-plugin',",
        "  name: 'Hooks Plugin',",
        "  async activate(context) {",
        "    context.registerHooks({",
        "      beforeRun() {},",
        "      beforeToolCall() {",
        "        return { approvedByHook: true };",
        "      },",
        "    });",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const toolsConfigManager = new ToolsConfigManager(stateDir);
    await toolsConfigManager.load();
    const toolExecutor = new ToolExecutor({
      tools: [],
      workspaceRoot: stateDir,
    });
    const logs: string[] = [];

    const extensionHost = await initializeExtensionHost({
      stateDir,
      bundledSkillsDir,
      workspaceRoot: stateDir,
      toolsEnabled: true,
      toolExecutor,
      toolsConfigManager,
      activeMcpServers: [],
      logger: {
        info: (scope, message) => logs.push(`info:${scope}:${message}`),
        warn: (scope, message) => logs.push(`warn:${scope}:${message}`),
      },
    });
    const hookRegistry = new HookRegistry();

    const hookBridge = bridgeLegacyPluginHooks({
      extensionHost,
      hookRegistry,
      logger: {
        info: (scope, message) => logs.push(`info:${scope}:${message}`),
        warn: (scope, message) => logs.push(`warn:${scope}:${message}`),
      },
    });

    expect(extensionHost.lifecycle.pluginToolsRegistered).toBe(0);
    expect(extensionHost.lifecycle.eligibilityRefreshed).toBe(true);
    expect(extensionHost.lifecycle.loadCompletedAt).toBeInstanceOf(Date);
    expect(hookBridge).toMatchObject({
      source: "plugin-bridge",
      availableHookCount: 2,
      bridgedHookCount: 2,
    });
    expect(hookBridge.registrations).toEqual([
      {
        legacyHookName: "beforeRun",
        hookName: "before_agent_start",
        available: true,
        bridged: true,
      },
      {
        legacyHookName: "afterRun",
        hookName: "agent_end",
        available: false,
        bridged: false,
      },
      {
        legacyHookName: "beforeToolCall",
        hookName: "before_tool_call",
        available: true,
        bridged: true,
      },
      {
        legacyHookName: "afterToolCall",
        hookName: "after_tool_call",
        available: false,
        bridged: false,
      },
    ]);
    expect(extensionHost.lifecycle.hookBridge).toEqual(hookBridge);
    expect(hookRegistry.getHookCount("before_agent_start")).toBe(1);
    expect(hookRegistry.getHookCount("before_tool_call")).toBe(1);
    expect(hookRegistry.getHookCount("agent_end")).toBe(0);
    expect(logs.some((line) => line.includes("legacy hooks bridged to HookRegistry (2/2)"))).toBe(true);
  });

  it("loads enabled marketplace-installed plugins and skill packs into the same extension host", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-marketplace-"));
    const bundledSkillsDir = path.join(stateDir, "bundled-skills");
    const pluginSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-plugin-source-"));
    const skillPackSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-skill-pack-source-"));
    tempDirs.push(stateDir, pluginSourceDir, skillPackSourceDir);

    await fs.mkdir(bundledSkillsDir, { recursive: true });
    await fs.mkdir(path.join(pluginSourceDir, "skills", "market-plugin-skill"), { recursive: true });
    await fs.mkdir(path.join(pluginSourceDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(pluginSourceDir, "belldandy-extension.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "market-demo-plugin",
        kind: "plugin",
        version: "1.0.0",
        entry: {
          pluginModule: "dist/plugin.mjs",
          skillDirs: ["skills"],
        },
      }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(pluginSourceDir, "dist", "plugin.mjs"),
      [
        "export default {",
        "  id: 'market-demo-plugin',",
        "  name: 'Market Demo Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: {",
        "        name: 'market_demo_tool',",
        "        description: 'market demo tool',",
        "        parameters: { type: 'object', properties: {} },",
        "      },",
        "      async execute() {",
        "        return { id: '', name: 'market_demo_tool', success: true, output: 'ok' };",
        "      },",
        "    });",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(pluginSourceDir, "skills", "market-plugin-skill", "SKILL.md"),
      [
        "---",
        "name: market-plugin-skill",
        "description: marketplace plugin skill",
        "priority: normal",
        "---",
        "Marketplace plugin skill instructions",
        "",
      ].join("\n"),
      "utf-8",
    );

    await fs.mkdir(path.join(skillPackSourceDir, "skills", "market-pack-skill"), { recursive: true });
    await fs.writeFile(
      path.join(skillPackSourceDir, "belldandy-extension.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "market-skill-pack",
        kind: "skill-pack",
        version: "0.1.0",
        entry: {
          skillDirs: ["skills"],
        },
      }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(skillPackSourceDir, "skills", "market-pack-skill", "SKILL.md"),
      [
        "---",
        "name: market-pack-skill",
        "description: marketplace skill pack skill",
        "priority: normal",
        "---",
        "Marketplace skill pack instructions",
        "",
      ].join("\n"),
      "utf-8",
    );

    await installMarketplaceExtension({
      stateDir,
      marketplace: "official-market",
      source: {
        source: "directory",
        path: pluginSourceDir,
      },
    });
    await installMarketplaceExtension({
      stateDir,
      marketplace: "official-market",
      source: {
        source: "directory",
        path: skillPackSourceDir,
      },
    });

    const toolsConfigManager = new ToolsConfigManager(stateDir);
    await toolsConfigManager.load();
    const toolExecutor = new ToolExecutor({
      tools: [],
      workspaceRoot: stateDir,
    });
    const logs: string[] = [];

    const result = await initializeExtensionHost({
      stateDir,
      bundledSkillsDir,
      workspaceRoot: stateDir,
      toolsEnabled: true,
      toolExecutor,
      toolsConfigManager,
      activeMcpServers: [],
      logger: {
        info: (scope, message) => logs.push(`info:${scope}:${message}`),
        warn: (scope, message) => logs.push(`warn:${scope}:${message}`),
      },
    });

    expect(result.extensionRuntime.summary).toEqual({
      pluginCount: 1,
      disabledPluginCount: 0,
      pluginToolCount: 1,
      pluginLoadErrorCount: 0,
      pluginHookMetricCount: 0,
      pluginHookFailureCount: 0,
      skillCount: 2,
      disabledSkillCount: 0,
      ineligibleSkillCount: 0,
      promptSkillCount: 0,
      searchableSkillCount: 2,
    });
    expect(result.extensionRuntime.plugins).toEqual([
      expect.objectContaining({
        id: "market-demo-plugin",
        toolNames: ["market_demo_tool"],
      }),
    ]);
    expect(result.searchableSkills.map((skill) => skill.name).sort()).toEqual([
      "market-pack-skill",
      "market-plugin-skill",
    ]);
    expect(result.lifecycle).toMatchObject({
      pluginToolsRegistered: 1,
      pluginSkillsLoaded: 2,
      installedMarketplaceExtensionsLoaded: 2,
      installedMarketplacePluginsLoaded: 1,
      installedMarketplaceSkillPacksLoaded: 1,
      eligibilityRefreshed: true,
    });
    expect(toolExecutor.getRegisteredToolNames()).toEqual(expect.arrayContaining([
      "market_demo_tool",
      "skills_list",
      "skills_search",
      "skill_get",
    ]));
    expect(logs.some((line) => line.includes("已加载 1 个插件"))).toBe(true);
  });

  it("skips a marketplace plugin whose approved materialized content has changed", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-integrity-"));
    const bundledSkillsDir = path.join(stateDir, "bundled-skills");
    const pluginSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-integrity-source-"));
    tempDirs.push(stateDir, pluginSourceDir);
    await fs.mkdir(bundledSkillsDir, { recursive: true });
    await fs.mkdir(path.join(pluginSourceDir, "dist"), { recursive: true });
    await fs.writeFile(path.join(pluginSourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "integrity-plugin",
      kind: "plugin",
      version: "1.0.0",
      entry: { pluginModule: "dist/plugin.mjs" },
    }, null, 2), "utf-8");
    await fs.writeFile(path.join(pluginSourceDir, "dist", "plugin.mjs"), "export default {};\n", "utf-8");
    const installed = await installMarketplaceExtension({
      stateDir,
      marketplace: "official-market",
      source: { source: "directory", path: pluginSourceDir },
    });
    await fs.writeFile(path.join(installed.installed.installPath, "dist", "plugin.mjs"), "throw new Error('must not import');\n", "utf-8");

    const toolsConfigManager = new ToolsConfigManager(stateDir);
    await toolsConfigManager.load();
    const logs: string[] = [];
    const result = await initializeExtensionHost({
      stateDir,
      bundledSkillsDir,
      workspaceRoot: stateDir,
      toolsEnabled: true,
      toolExecutor: new ToolExecutor({ tools: [], workspaceRoot: stateDir }),
      toolsConfigManager,
      activeMcpServers: [],
      logger: {
        info: (scope, message) => logs.push(`info:${scope}:${message}`),
        warn: (scope, message) => logs.push(`warn:${scope}:${message}`),
      },
    });

    expect(result.lifecycle).toMatchObject({
      installedMarketplaceExtensionsLoaded: 0,
      installedMarketplacePluginsLoaded: 0,
    });
    expect(result.extensionRuntime.summary.pluginCount).toBe(0);
    expect(logs.some((line) => line.includes("content integrity mismatch"))).toBe(true);
  });
});
