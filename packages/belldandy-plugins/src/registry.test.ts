import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PluginRegistry,
  PluginRegistryLifecycleError,
  PluginRegistryRegistrationError,
} from "./registry.js";

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

  it("serializes concurrent plugin loads to preserve unique tool ownership", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-concurrent-load-"));
    tempDirs.push(dir);
    const markerPath = path.join(dir, "concurrent-load.log");

    await fs.writeFile(
      path.join(dir, "first.mjs"),
      [
        "export default {",
        "  id: 'first-plugin',",
        "  name: 'First Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: { name: 'shared_tool', description: 'first', parameters: { type: 'object', properties: {} } },",
        "      async execute() { return { id: '', name: 'shared_tool', success: true, output: 'first', durationMs: 0 }; },",
        "    });",
        "    await new Promise((resolve) => setTimeout(resolve, 20));",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(
      path.join(dir, "second.mjs"),
      [
        'import { appendFile } from "node:fs/promises";',
        `const markerPath = ${JSON.stringify(markerPath)};`,
        "export default {",
        "  id: 'second-plugin',",
        "  name: 'Second Plugin',",
        "  async activate(context) {",
        "    context.onDispose(() => appendFile(markerPath, 'second:rollback\\n'));",
        "    context.registerTool({",
        "      definition: { name: 'shared_tool', description: 'second', parameters: { type: 'object', properties: {} } },",
        "      async execute() { return { id: '', name: 'shared_tool', success: true, output: 'second', durationMs: 0 }; },",
        "    });",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    const [firstResult, secondResult] = await Promise.allSettled([
      registry.loadPlugin(path.join(dir, "first.mjs")),
      registry.loadPlugin(path.join(dir, "second.mjs")),
    ]);

    expect(firstResult.status).toBe("fulfilled");
    expect(secondResult).toMatchObject({
      status: "rejected",
      reason: expect.any(PluginRegistryRegistrationError),
    });
    expect(registry.getPluginIds()).toEqual(["first-plugin"]);
    await expect(fs.readFile(markerPath, "utf-8")).resolves.toBe("second:rollback\n");
  });

  it("rolls back staged registrations and registered disposers when activate fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-rollback-"));
    tempDirs.push(dir);
    const markerPath = path.join(dir, "rollback.log");
    const pluginPath = path.join(dir, "rollback-plugin.mjs");

    await fs.writeFile(
      pluginPath,
      [
        'import { appendFile } from "node:fs/promises";',
        `const markerPath = ${JSON.stringify(markerPath)};`,
        "export default {",
        "  id: 'rollback-plugin',",
        "  name: 'Rollback Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: { name: 'rollback_tool', description: 'rollback', parameters: { type: 'object', properties: {} } },",
        "      async execute() { return { id: '', name: 'rollback_tool', success: true, output: 'ok', durationMs: 0 }; },",
        "    });",
        "    context.registerHooks({ beforeRun: async () => {} });",
        "    context.registerSkillDir('/plugin-skills');",
        "    context.onDispose(() => appendFile(markerPath, 'rollback\\n'));",
        "    throw new Error('activate failed');",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    await expect(registry.loadPlugin(pluginPath)).rejects.toThrow("activate failed");

    expect(registry.getPluginIds()).toEqual([]);
    expect(registry.getAllTools()).toEqual([]);
    expect(registry.getPluginToolMap().size).toBe(0);
    expect(registry.getPluginSkillDirs().size).toBe(0);
    await expect(fs.readFile(markerPath, "utf-8")).resolves.toBe("rollback\n");
  });

  it("unloads plugin ownership after running deactivate and disposers in reverse order", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-unload-"));
    tempDirs.push(dir);
    const markerPath = path.join(dir, "unload.log");
    const pluginPath = path.join(dir, "unload-plugin.mjs");

    await fs.writeFile(
      pluginPath,
      [
        'import { appendFile } from "node:fs/promises";',
        `const markerPath = ${JSON.stringify(markerPath)};`,
        "export default {",
        "  id: 'unload-plugin',",
        "  name: 'Unload Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: { name: 'unload_tool', description: 'unload', parameters: { type: 'object', properties: {} } },",
        "      async execute() { return { id: '', name: 'unload_tool', success: true, output: 'ok', durationMs: 0 }; },",
        "    });",
        "    context.registerHooks({ beforeRun: async () => {} });",
        "    context.registerSkillDir('/plugin-skills');",
        "    context.onDispose(() => appendFile(markerPath, 'first\\n'));",
        "    context.onDispose(() => appendFile(markerPath, 'second\\n'));",
        "  },",
        "  async deactivate() { await appendFile(markerPath, 'deactivate\\n'); },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    await registry.loadPlugin(pluginPath);
    expect(registry.getAllTools()).toHaveLength(1);
    expect(registry.getLegacyHookAvailability().beforeRun).toBe(true);
    expect(registry.getPluginSkillDirs().get("unload-plugin")).toEqual(["/plugin-skills"]);

    await expect(registry.unloadPlugin("unload-plugin")).resolves.toBe(true);

    expect(await fs.readFile(markerPath, "utf-8")).toBe("deactivate\nsecond\nfirst\n");
    expect(registry.getPluginIds()).toEqual([]);
    expect(registry.getAllTools()).toEqual([]);
    expect(registry.getLegacyHookAvailability().beforeRun).toBe(false);
    expect(registry.getPluginSkillDirs().size).toBe(0);
  });

  it("disposes loaded plugins in reverse load order", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-dispose-"));
    tempDirs.push(dir);
    const markerPath = path.join(dir, "dispose.log");

    for (const pluginId of ["first-plugin", "second-plugin"]) {
      await fs.writeFile(
        path.join(dir, `${pluginId}.mjs`),
        [
          'import { appendFile } from "node:fs/promises";',
          `const markerPath = ${JSON.stringify(markerPath)};`,
          "export default {",
          `  id: '${pluginId}',`,
          `  name: '${pluginId}',`,
          "  async activate(context) {",
          `    context.onDispose(() => appendFile(markerPath, '${pluginId}:dispose\\n'));`,
          "  },",
          `  async deactivate() { await appendFile(markerPath, '${pluginId}:deactivate\\n'); },`,
          "};",
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    const registry = new PluginRegistry();
    await registry.loadPlugin(path.join(dir, "first-plugin.mjs"));
    await registry.loadPlugin(path.join(dir, "second-plugin.mjs"));

    await registry.dispose();

    expect(await fs.readFile(markerPath, "utf-8")).toBe(
      "second-plugin:deactivate\nsecond-plugin:dispose\nfirst-plugin:deactivate\nfirst-plugin:dispose\n",
    );
    expect(registry.getPluginIds()).toEqual([]);
  });

  it("removes ownership even when deactivate and disposer cleanup fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-cleanup-error-"));
    tempDirs.push(dir);
    const pluginPath = path.join(dir, "cleanup-error-plugin.mjs");

    await fs.writeFile(
      pluginPath,
      [
        "export default {",
        "  id: 'cleanup-error-plugin',",
        "  name: 'Cleanup Error Plugin',",
        "  async activate(context) {",
        "    context.registerTool({",
        "      definition: { name: 'cleanup_error_tool', description: 'cleanup', parameters: { type: 'object', properties: {} } },",
        "      async execute() { return { id: '', name: 'cleanup_error_tool', success: true, output: 'ok', durationMs: 0 }; },",
        "    });",
        "    context.onDispose(() => { throw new Error('dispose failed'); });",
        "  },",
        "  async deactivate() { throw new Error('deactivate failed'); },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    await registry.loadPlugin(pluginPath);

    await expect(registry.unloadPlugin("cleanup-error-plugin"))
      .rejects
      .toBeInstanceOf(PluginRegistryLifecycleError);

    expect(registry.getPluginIds()).toEqual([]);
    expect(registry.getAllTools()).toEqual([]);
    expect(registry.getDiagnostics().loadErrors.map((item) => item.phase)).toEqual(
      expect.arrayContaining(["deactivate", "dispose"]),
    );
  });

  it("shares one unload lifecycle when callers unload the same plugin concurrently", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-concurrent-unload-"));
    tempDirs.push(dir);
    const markerPath = path.join(dir, "concurrent-unload.log");
    const pluginPath = path.join(dir, "concurrent-unload-plugin.mjs");

    await fs.writeFile(
      pluginPath,
      [
        'import { appendFile } from "node:fs/promises";',
        `const markerPath = ${JSON.stringify(markerPath)};`,
        "export default {",
        "  id: 'concurrent-unload-plugin',",
        "  name: 'Concurrent Unload Plugin',",
        "  async activate(context) {",
        "    context.onDispose(() => appendFile(markerPath, 'dispose\\n'));",
        "  },",
        "  async deactivate() {",
        "    await new Promise((resolve) => setTimeout(resolve, 20));",
        "    await appendFile(markerPath, 'deactivate\\n');",
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf-8",
    );

    const registry = new PluginRegistry();
    await registry.loadPlugin(pluginPath);

    await expect(Promise.all([
      registry.unloadPlugin("concurrent-unload-plugin"),
      registry.unloadPlugin("concurrent-unload-plugin"),
    ])).resolves.toEqual([true, true]);

    expect(await fs.readFile(markerPath, "utf-8")).toBe("deactivate\ndispose\n");
    expect(registry.getPluginIds()).toEqual([]);
  });

  it("keeps a bounded load-error ledger", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-plugin-registry-errors-"));
    tempDirs.push(dir);
    const registry = new PluginRegistry();

    for (let index = 0; index < 36; index += 1) {
      const pluginPath = path.join(dir, `broken-${index}.mjs`);
      await fs.writeFile(pluginPath, "export default {};\n", "utf-8");
      await expect(registry.loadPlugin(pluginPath)).rejects.toThrow("missing activate function");
    }

    const errors = registry.getDiagnostics().loadErrors;
    expect(errors).toHaveLength(32);
    expect(errors[0]?.target).toContain("broken-4.mjs");
    expect(errors.at(-1)?.target).toContain("broken-35.mjs");
  });
});
