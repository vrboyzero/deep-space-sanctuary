import type { Tool } from "@belldandy/skills";
import type { AgentHooks } from "@belldandy/agent";

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

export interface PluginRegistryDiagnostics {
    pluginCount: number;
    toolCount: number;
    hookCount: number;
    skillDirCount: number;
    loadErrors: PluginLoadErrorRecord[];
}
