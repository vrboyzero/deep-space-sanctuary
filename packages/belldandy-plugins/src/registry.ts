import type { Tool } from "@belldandy/skills";
import type { AgentHooks, AgentHookContext, BeforeRunEvent, AfterRunEvent, BeforeToolCallEvent, AfterToolCallEvent } from "@belldandy/agent";
import type {
    BelldandyPlugin,
    PluginContext,
    PluginDisposer,
    PluginLoadErrorRecord,
    PluginRegistryDiagnostics,
    PluginRuntimeDescriptor,
} from "./types.js";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_LOAD_ERRORS = 32;

type PluginHookRegistration = {
    pluginId: string;
    hooks: AgentHooks;
};

export class PluginRegistryRegistrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PluginRegistryRegistrationError";
    }
}

export class PluginRegistryDirectoryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PluginRegistryDirectoryError";
    }
}

export class PluginRegistryLifecycleError extends Error {
    constructor(pluginId: string) {
        super(`Plugin ${pluginId} cleanup failed after its registry ownership was removed.`);
        this.name = "PluginRegistryLifecycleError";
    }
}

export class PluginRegistry {
    private plugins: Map<string, BelldandyPlugin> = new Map();
    private tools: Map<string, Tool> = new Map();
    private hooksList: PluginHookRegistration[] = [];
    /** pluginId → 该插件注册的工具名列表 */
    private pluginToolMap: Map<string, string[]> = new Map();
    /** pluginId → 该插件声明的 skill 目录列表 */
    private pluginSkillDirs: Map<string, string[]> = new Map();
    /** pluginId → activate 中注册的资源释放回调 */
    private pluginDisposers: Map<string, PluginDisposer[]> = new Map();
    /** 保持 dispose 时的逆加载顺序，避免 Hook/资源释放漂移。 */
    private pluginLoadOrder: string[] = [];
    /** 同一 plugin 的并发卸载共用一个 lifecycle，避免重复调用 disposer。 */
    private unloadOperations: Map<string, Promise<boolean>> = new Map();
    /**
     * activate 阶段允许异步注册。串行化整段 staging/publish，才能让跨插件的 Tool
     * 唯一性检查看到前一个已完成的所有权，而不是两个私有 staging 的竞态。
     */
    private pluginLoadQueue: Promise<void> = Promise.resolve();
    /** 最近一次插件扫描/加载错误 */
    private loadErrors: PluginLoadErrorRecord[] = [];
    /** inventory 缓存代次 */
    private inventoryGeneration = 0;
    private cachedInventoryGeneration = -1;
    private cachedPluginDescriptors: PluginRuntimeDescriptor[] = [];
    private cachedDiagnostics: PluginRegistryDiagnostics = {
        pluginCount: 0,
        toolCount: 0,
        hookCount: 0,
        skillDirCount: 0,
        loadErrors: [],
    };
    private cachedLegacyHookAvailability = {
        beforeRun: false,
        afterRun: false,
        beforeToolCall: false,
        afterToolCall: false,
    };

    /**
     * Load a plugin from a file path.
     * The file must default export an object implementing BelldandyPlugin.
     */
    async loadPlugin(filePath: string): Promise<void> {
        const previousLoad = this.pluginLoadQueue;
        let releaseLoadQueue!: () => void;
        this.pluginLoadQueue = new Promise<void>((resolve) => {
            releaseLoadQueue = resolve;
        });

        await previousLoad;
        try {
            await this.loadPluginInOrder(filePath);
        } finally {
            // 无论动态 import 或 activate 是否失败，后续插件都必须能继续加载。
            releaseLoadQueue();
        }
    }

    private async loadPluginInOrder(filePath: string): Promise<void> {
        try {
            // Dynamic import requires file URL
            const fileUrl = pathToFileURL(path.resolve(filePath)).href;
            const mod = await import(fileUrl);
            const plugin = mod.default as BelldandyPlugin;

            if (!plugin || typeof plugin.activate !== "function") {
                throw new Error(`Plugin at ${filePath} does not export a valid BelldandyPlugin (missing activate function)`);
            }

            if (this.plugins.has(plugin.id)) {
                console.warn(`Plugin ${plugin.id} is already loaded. Skipping ${filePath}.`);
                return;
            }

            console.log(`Loading plugin: ${plugin.name} (${plugin.id})`);

            // Stage plugin registrations so a rejected duplicate cannot leave a partial runtime.
            const stagedTools = new Map<string, Tool>();
            const stagedHooks: AgentHooks[] = [];
            const stagedSkillDirs = new Set<string>();
            const stagedDisposers: PluginDisposer[] = [];
            const context: PluginContext = {
                registerTool: (tool: Tool) => {
                    const toolName = tool.definition.name;
                    if (this.tools.has(toolName) || stagedTools.has(toolName)) {
                        throw new PluginRegistryRegistrationError(`Duplicate plugin tool registration: ${toolName}`);
                    }
                    stagedTools.set(toolName, tool);
                },
                registerHooks: (hooks: AgentHooks) => {
                    stagedHooks.push(hooks);
                },
                registerSkillDir: (dir: string) => {
                    stagedSkillDirs.add(dir);
                },
                onDispose: (disposer: PluginDisposer) => {
                    if (typeof disposer !== "function") {
                        throw new PluginRegistryRegistrationError("Plugin disposer must be a function.");
                    }
                    stagedDisposers.push(disposer);
                }
            };

            try {
                await plugin.activate(context);
            } catch (error) {
                // 注册表状态尚未 publish，但插件已创建的 timer/socket 等资源必须对称释放。
                await this.runDisposers(plugin.id, stagedDisposers, "activate_rollback");
                throw error;
            }
            this.plugins.set(plugin.id, plugin);
            for (const [toolName, tool] of stagedTools) {
                this.tools.set(toolName, tool);
            }
            this.hooksList.push(...stagedHooks.map((hooks) => ({ pluginId: plugin.id, hooks })));
            this.pluginToolMap.set(plugin.id, [...stagedTools.keys()]);
            this.pluginSkillDirs.set(plugin.id, [...stagedSkillDirs]);
            this.pluginDisposers.set(plugin.id, stagedDisposers);
            this.pluginLoadOrder.push(plugin.id);
            this.invalidateInventoryCache();

        } catch (err) {
            this.recordLoadError("load_plugin", filePath, err);
            console.error(`Failed to load plugin from ${filePath}:`, err);
            throw err;
        }
    }

    /**
     * Load all plugins from a directory (non-recursive)
     */
    async loadPluginDirectory(
        dirPath: string,
        options: { requireDirectory?: boolean; failOnRegistrationError?: boolean } = {},
    ): Promise<void> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
                    try {
                        await this.loadPlugin(path.join(dirPath, entry.name));
                    } catch (error) {
                        if (options.failOnRegistrationError && error instanceof PluginRegistryRegistrationError) {
                            throw error;
                        }
                        // 记录错误后继续扫描其它插件，避免单个坏插件阻断整批加载。
                    }
                }
            }
        } catch (err) {
            if (err instanceof PluginRegistryRegistrationError) {
                throw err;
            }
            this.recordLoadError("scan_directory", dirPath, err);
            console.error(`Failed to load plugins from directory ${dirPath}:`, err);
            if (options.requireDirectory) {
                throw new PluginRegistryDirectoryError(
                    `Invalid required plugin directory: ${dirPath} (${err instanceof Error ? err.message : String(err)}).`,
                );
            }
        }
    }

    /**
     * 卸载单个插件。即使 deactivate/disposer 抛错，也会移除其所有 Registry 可见所有权。
     */
    async unloadPlugin(pluginId: string): Promise<boolean> {
        const existingOperation = this.unloadOperations.get(pluginId);
        if (existingOperation) {
            return existingOperation;
        }

        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            return false;
        }

        let operation!: Promise<boolean>;
        operation = this.unloadPluginOwnership(pluginId, plugin).finally(() => {
            if (this.unloadOperations.get(pluginId) === operation) {
                this.unloadOperations.delete(pluginId);
            }
        });
        this.unloadOperations.set(pluginId, operation);
        return operation;
    }

    private async unloadPluginOwnership(pluginId: string, plugin: BelldandyPlugin): Promise<boolean> {
        let cleanupFailed = false;
        try {
            await plugin.deactivate?.();
        } catch (error) {
            cleanupFailed = true;
            this.recordLoadError("deactivate", pluginId, error);
        }

        const disposerFailures = await this.runDisposers(
            pluginId,
            this.pluginDisposers.get(pluginId) ?? [],
            "dispose",
        );
        cleanupFailed ||= disposerFailures > 0;

        // 无论 Plugin 自己的 cleanup 成功与否，都不能留下幽灵 Tool/Hook/Skill dir。
        this.removePluginOwnership(pluginId);
        if (cleanupFailed) {
            throw new PluginRegistryLifecycleError(pluginId);
        }
        return true;
    }

    /**
     * 按逆加载顺序卸载全部插件，确保后注册的依赖先释放。
     */
    async dispose(): Promise<void> {
        const orderedIds = [...this.pluginLoadOrder].reverse();
        const fallbackIds = Array.from(this.plugins.keys())
            .filter((pluginId) => !orderedIds.includes(pluginId))
            .reverse();
        let firstError: unknown;
        for (const pluginId of [...orderedIds, ...fallbackIds]) {
            try {
                await this.unloadPlugin(pluginId);
            } catch (error) {
                firstError ??= error;
            }
        }
        if (firstError) {
            throw firstError;
        }
    }

    /**
     * Get all registered tools
     */
    getAllTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get all loaded plugin IDs
     */
    getPluginIds(): string[] {
        return Array.from(this.plugins.keys());
    }

    /**
     * Get plugin descriptors for diagnostics / inventory output
     */
    listPlugins(): PluginRuntimeDescriptor[] {
        this.ensureInventoryCache();
        return this.cachedPluginDescriptors.map((plugin) => ({
            ...plugin,
            toolNames: [...plugin.toolNames],
            skillDirs: [...plugin.skillDirs],
        }));
    }

    getDiagnostics(): PluginRegistryDiagnostics {
        this.ensureInventoryCache();
        return {
            ...this.cachedDiagnostics,
            loadErrors: this.cachedDiagnostics.loadErrors.map((item) => ({ ...item })),
        };
    }

    getLegacyHookAvailability(): {
        beforeRun: boolean;
        afterRun: boolean;
        beforeToolCall: boolean;
        afterToolCall: boolean;
    } {
        this.ensureInventoryCache();
        return { ...this.cachedLegacyHookAvailability };
    }

    /**
     * Get plugin → tool names mapping (for tools-config integration)
     */
    getPluginToolMap(): Map<string, string[]> {
        return new Map(Array.from(this.pluginToolMap, ([pluginId, names]) => [pluginId, [...names]]));
    }

    /**
     * Get plugin → skill directory mapping (for SkillRegistry integration)
     */
    getPluginSkillDirs(): Map<string, string[]> {
        return new Map(Array.from(this.pluginSkillDirs, ([pluginId, dirs]) => [pluginId, [...dirs]]));
    }

    /**
     * Get aggregated hooks to pass to the Agent
     */
    getAggregatedHooks(): AgentHooks {
        return {
            beforeRun: async (evt, ctx) => {
                for (const { hooks: h } of this.hooksList) {
                    if (h.beforeRun) {
                        const res = await h.beforeRun(evt, ctx);
                        if (res && typeof res === "object") {
                            evt.input = { ...evt.input, ...res };
                        }
                    }
                }
            },
            afterRun: async (evt, ctx) => {
                for (const { hooks: h } of this.hooksList) {
                    if (h.afterRun) await h.afterRun(evt, ctx);
                }
            },
            beforeToolCall: async (evt, ctx) => {
                for (const { hooks: h } of this.hooksList) {
                    if (h.beforeToolCall) {
                        const result = await h.beforeToolCall(evt, ctx);
                        if (result === false) return false; // Block execution
                        if (typeof result === "object") {
                            // Merge argument overrides
                            evt.arguments = { ...evt.arguments, ...result };
                        }
                    }
                }
            },
            afterToolCall: async (evt, ctx) => {
                for (const { hooks: h } of this.hooksList) {
                    if (h.afterToolCall) await h.afterToolCall(evt, ctx);
                }
            }
        };
    }

    private recordLoadError(
        phase: PluginLoadErrorRecord["phase"],
        target: string,
        error: unknown,
    ): void {
        const message = error instanceof Error ? error.message : String(error);
        this.loadErrors.push({
            at: new Date(),
            phase,
            target,
            message,
        });
        if (this.loadErrors.length > MAX_LOAD_ERRORS) {
            this.loadErrors.splice(0, this.loadErrors.length - MAX_LOAD_ERRORS);
        }
        this.invalidateInventoryCache();
    }

    /** Execute cleanup callbacks in reverse registration order and retain every failure in diagnostics. */
    private async runDisposers(
        pluginId: string,
        disposers: PluginDisposer[],
        phase: Extract<PluginLoadErrorRecord["phase"], "activate_rollback" | "dispose">,
    ): Promise<number> {
        let failures = 0;
        for (const disposer of [...disposers].reverse()) {
            try {
                await disposer();
            } catch (error) {
                failures += 1;
                this.recordLoadError(phase, pluginId, error);
            }
        }
        return failures;
    }

    private removePluginOwnership(pluginId: string): void {
        for (const toolName of this.pluginToolMap.get(pluginId) ?? []) {
            this.tools.delete(toolName);
        }
        this.hooksList = this.hooksList.filter((entry) => entry.pluginId !== pluginId);
        this.plugins.delete(pluginId);
        this.pluginToolMap.delete(pluginId);
        this.pluginSkillDirs.delete(pluginId);
        this.pluginDisposers.delete(pluginId);
        this.pluginLoadOrder = this.pluginLoadOrder.filter((id) => id !== pluginId);
        this.invalidateInventoryCache();
    }

    private ensureInventoryCache(): void {
        if (this.cachedInventoryGeneration === this.inventoryGeneration) {
            return;
        }
        this.rebuildInventoryCache();
    }

    private rebuildInventoryCache(): void {
        this.cachedPluginDescriptors = Array.from(this.plugins.values())
            .map((plugin) => ({
                id: plugin.id,
                name: plugin.name,
                version: plugin.version,
                description: plugin.description,
                toolNames: [...(this.pluginToolMap.get(plugin.id) ?? [])],
                skillDirs: [...(this.pluginSkillDirs.get(plugin.id) ?? [])],
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
        this.cachedDiagnostics = {
            pluginCount: this.plugins.size,
            toolCount: this.tools.size,
            hookCount: this.hooksList.length,
            skillDirCount: this.pluginSkillDirs.size,
            loadErrors: this.loadErrors.map((item) => ({ ...item })),
        };
        this.cachedLegacyHookAvailability = {
            beforeRun: this.hooksList.some(({ hooks }) => typeof hooks.beforeRun === "function"),
            afterRun: this.hooksList.some(({ hooks }) => typeof hooks.afterRun === "function"),
            beforeToolCall: this.hooksList.some(({ hooks }) => typeof hooks.beforeToolCall === "function"),
            afterToolCall: this.hooksList.some(({ hooks }) => typeof hooks.afterToolCall === "function"),
        };
        this.cachedInventoryGeneration = this.inventoryGeneration;
    }

    private invalidateInventoryCache(): void {
        this.inventoryGeneration += 1;
        this.cachedInventoryGeneration = -1;
    }
}
