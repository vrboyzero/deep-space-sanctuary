import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginRegistry } from "./registry.js";

describe("PluginRegistry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("records load errors and continues scanning remaining plugin files", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-"));
    tempDirs.push(dir);

    await fs.writeFile(path.join(dir, "broken-plugin.mjs"), "export default {};\n", "utf-8");
    await fs.writeFile(
      path.join(dir, "good-plugin.mjs"),
      [
        "export default {",
        "  id: 'good-plugin',",
        "  name: 'Good Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: {",
        "        name: 'good_tool',",
        "        description: 'good',",
        "        parameters: { type: 'object', properties: {} },",
        "      },",
        "      async execute() {",
        "        return { id: '', name: 'good_tool', success: true, output: 'ok' };",
        "      },",
        "    });",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    await registry.loadPluginDirectory(dir);

    expect(registry.getPluginIds()).toEqual(["good-plugin"]);
    expect(registry.listPlugins()).toEqual([
      expect.objectContaining({
        id: "good-plugin",
        name: "Good Plugin",
        toolNames: ["good_tool"],
      }),
    ]);
    expect(registry.getDiagnostics()).toEqual(expect.objectContaining({
      pluginCount: 1,
      toolCount: 1,
      loadErrors: [
        expect.objectContaining({
          phase: "load_plugin",
          target: expect.stringContaining("broken-plugin.mjs"),
        }),
      ],
    }));
  });

  it("reuses cached inventory views until registry content changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-cache-"));
    tempDirs.push(dir);

    await fs.writeFile(
      path.join(dir, "good-plugin.mjs"),
      [
        "export default {",
        "  id: 'cache-plugin',",
        "  name: 'Cache Plugin',",
        "  async activate(context) {",
        "    context.registerHooks({ beforeRun: async () => {} });",
        "    context.registerTool({",
        "      definition: {",
        "        name: 'cache_tool',",
        "        description: 'cache',",
        "        parameters: { type: 'object', properties: {} },",
        "      },",
        "      async execute() {",
        "        return { id: '', name: 'cache_tool', success: true, output: 'ok' };",
        "      },",
        "    });",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    const rebuildSpy = vi.spyOn(registry as any, "rebuildInventoryCache");

    await registry.loadPluginDirectory(dir);
    rebuildSpy.mockClear();

    expect(registry.listPlugins()).toEqual([
      expect.objectContaining({
        id: "cache-plugin",
        toolNames: ["cache_tool"],
      }),
    ]);
    expect(registry.getDiagnostics()).toEqual(expect.objectContaining({
      pluginCount: 1,
      toolCount: 1,
      hookCount: 1,
    }));
    expect(registry.getLegacyHookAvailability()).toEqual({
      beforeRun: true,
      afterRun: false,
      beforeToolCall: false,
      afterToolCall: false,
    });
    expect(registry.listPlugins()).toHaveLength(1);
    expect(registry.getDiagnostics().pluginCount).toBe(1);
    expect(rebuildSpy).toHaveBeenCalledTimes(1);

    await registry.loadPluginDirectory(path.join(dir, "missing-dir"));
    expect(registry.getDiagnostics().loadErrors).toHaveLength(1);
    expect(rebuildSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate tool names without replacing the first plugin tool", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-duplicate-"));
    tempDirs.push(dir);

    for (const [fileName, pluginId] of [["first.mjs", "first-plugin"], ["second.mjs", "second-plugin"]] as const) {
      await fs.writeFile(
        path.join(dir, fileName),
        [
          "export default {",
          `  id: '${pluginId}',`,
          `  name: '${pluginId}',`,
          "  async activate(context) {",
          "    context.registerTool({",
          "      definition: { name: 'shared_tool', description: 'shared', parameters: { type: 'object', properties: {} } },",
          "      async execute() { return { id: '', name: 'shared_tool', success: true, output: 'ok', durationMs: 0 }; },",
          "    });",
          "  },",
          "};",
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    const registry = new PluginRegistry();
    await registry.loadPlugin(path.join(dir, "first.mjs"));

    await expect(registry.loadPlugin(path.join(dir, "second.mjs")))
      .rejects.toThrow(/Duplicate plugin tool registration: shared_tool/);
    expect(registry.getPluginIds()).toEqual(["first-plugin"]);
    expect(registry.getAllTools()).toHaveLength(1);
  });
});
