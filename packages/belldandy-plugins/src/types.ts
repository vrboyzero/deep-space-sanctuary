import type { Tool } from "@belldandy/skills";
import type { AgentHooks, HookFailurePolicy, HookName } from "@belldandy/agent";

/** Plugin 在卸载或 activate 回滚时需要释放的本机资源。 */
export type PluginDisposer = () => void | Promise<void>;

export interface PluginContext {
    /** Register a tool provided by this plugin */
    registerTool(tool: Tool): void;
    /** Register hooks provided by this plugin */
    registerHooks(hooks: AgentHooks): void;
    /** Register a directory containing SKILL.md sub-directories */
    registerSkillDir(dir: string): void;
    /** Register cleanup for resources created during activation. */
    onDispose(disposer: PluginDisposer): void;
}

export interface BelldandyPlugin {
    id: string;
    name: string;
    version?: string;
    description?: string;
    /**
     * Activation hook called when the plugin is loaded.
     * Use this to register tools and hooks.
    */
    activate(context: PluginContext): void | Promise<void>;
    /** Optional teardown hook invoked before registry ownership is removed. */
    deactivate?(): void | Promise<void>;
}

export interface PluginRuntimeDescriptor {
    id: string;
    name: string;
    version?: string;
    description?: string;
    toolNames: string[];
    skillDirs: string[];
}

export interface PluginLoadErrorRecord {
    at: Date;
    phase: "load_plugin" | "scan_directory" | "activate_rollback" | "deactivate" | "dispose";
    target: string;
    message: string;
}

/** Legacy Plugin Hook 的可观测阶段；不包含输入、参数或结果内容。 */
export type PluginHookName = "beforeRun" | "afterRun" | "beforeToolCall" | "afterToolCall";

/** Hook 返回 false 时保留阻断语义；异常由 canonical Hook failure policy 决定隔离或阻断。 */
export type PluginHookOutcome = "succeeded" | "blocked" | "failed";

/** Legacy Plugin Hook 到 HookRegistry 的显式执行与失败策略。 */
export interface PluginHookPolicy {
    pluginHookName: PluginHookName;
    hookName: HookName;
    executionMode: "sequential";
    failurePolicy: HookFailurePolicy;
}

/** 单个 Plugin Hook 的有界运行聚合，用于定位慢 Hook 且不保留调用内容。 */
export interface PluginHookMetric {
    pluginId: string;
    hookName: PluginHookName;
    failurePolicy: HookFailurePolicy;
    invocationCount: number;
    succeededCount: number;
    blockedCount: number;
    failedCount: number;
    totalDurationMs: number;
    maxDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    latestDurationMs: number;
    latestOutcome: PluginHookOutcome;
    latestAt: Date;
}

export interface PluginRegistryDiagnostics {
    pluginCount: number;
    toolCount: number;
    hookCount: number;
    skillDirCount: number;
    loadErrors: PluginLoadErrorRecord[];
    hookMetrics: PluginHookMetric[];
    hookPolicies: PluginHookPolicy[];
    hookMetricEvictionCount: number;
}
