import { randomUUID } from "node:crypto";

import type { JsonObject } from "@belldandy/protocol";
import type { HookRegistry } from "@belldandy/agent";
import {
  type Tool,
  type ToolCallResult,
  type ToolContract,
  type ToolDefinition,
  type ToolExecutor,
  type SkillRegistry,
} from "@belldandy/skills";

import type { ExtensionPermission, PluginHookName } from "@belldandy/plugins";

export const ISOLATED_EXTENSION_HOST_API_VERSION = 2;

export type ExtensionRuntimeGrant = {
  extensionId: string;
  extensionName: string;
  installPath: string;
  pluginModuleRelativePath: string;
  contentSha256: string;
  hostApi: number;
  permissions: ExtensionPermission[];
  runtimeCapabilities: string[];
  skillDirs: Array<{
    relativePath: string;
    absolutePath: string;
  }>;
};

export type ExtensionRuntimeToolRegistration = {
  definition: ToolDefinition;
  contract?: ToolContract;
};

export type ExtensionRuntimeRegistrations = {
  plugin: {
    id: string;
    name: string;
    version?: string;
    description?: string;
  };
  tools: ExtensionRuntimeToolRegistration[];
  hooks: PluginHookName[];
  skillDirs: string[];
};

export type ExtensionRuntimeInvocation =
  | {
    kind: "tool";
    invocationId: string;
    generation: number;
    toolName: string;
    arguments: JsonObject;
    context: {
      conversationId: string;
      agentId?: string;
    };
  }
  | {
    kind: "hook";
    invocationId: string;
    generation: number;
    hookName: PluginHookName;
    event: JsonObject;
    context: JsonObject;
  };

export interface ExtensionRuntimeSession {
  registrations: ExtensionRuntimeRegistrations;
  invoke(invocation: ExtensionRuntimeInvocation, signal?: AbortSignal): Promise<ToolCallResult | JsonObject | undefined>;
  onFatal?(listener: (error: Error) => void): () => void;
  close(reason: string): Promise<void>;
}

export interface ExtensionRuntimeAdapter {
  activate(grant: ExtensionRuntimeGrant, signal?: AbortSignal): Promise<ExtensionRuntimeSession>;
}

export type InMemoryExtensionRuntimeAdapterOptions = {
  registrations: ExtensionRuntimeRegistrations;
  invoke: (
    invocation: ExtensionRuntimeInvocation,
    signal?: AbortSignal,
  ) => Promise<ToolCallResult | JsonObject | undefined>;
  close?: (reason: string) => void | Promise<void>;
};

export class InMemoryExtensionRuntimeAdapter implements ExtensionRuntimeAdapter {
  constructor(private readonly options: InMemoryExtensionRuntimeAdapterOptions) {}

  async activate(): Promise<ExtensionRuntimeSession> {
    let closed = false;
    return {
      registrations: structuredClone(this.options.registrations),
      invoke: async (invocation, signal) => {
        if (closed) {
          throw new Error("Extension runtime session is closed.");
        }
        return this.options.invoke(invocation, signal);
      },
      close: async (reason) => {
        if (closed) return;
        closed = true;
        await this.options.close?.(reason);
      },
    };
  }
}

type ActiveExtensionRuntime = {
  extensionId: string;
  extensionName: string;
  generation: number;
  toolNames: string[];
  hookNames: PluginHookName[];
  skillCount: number;
  invocations: Map<string, AbortController>;
  unsubscribeFatal?: () => void;
  session: ExtensionRuntimeSession;
};

export type ExtensionRuntimeSupervisorSnapshot = {
  activeExtensionCount: number;
  sessions: Array<{
    extensionId: string;
    extensionName: string;
    generation: number;
    toolNames: string[];
    hookNames: PluginHookName[];
    skillCount: number;
    activeInvocationCount: number;
  }>;
};

export type ExtensionRuntimeSupervisorOptions = {
  stateDir: string;
  adapter: ExtensionRuntimeAdapter;
  toolExecutor: ToolExecutor;
  hookRegistry: HookRegistry;
  skillRegistry?: SkillRegistry;
  activationTimeoutMs?: number;
  invocationTimeoutMs?: number;
};

const DEFAULT_EXTENSION_ACTIVATION_TIMEOUT_MS = 15_000;
const DEFAULT_EXTENSION_INVOCATION_TIMEOUT_MS = 30_000;

class ExtensionRuntimeDeadlineError extends Error {
  constructor(phase: "activation" | "invocation") {
    super(`Extension runtime ${phase} exceeded its deadline.`);
    this.name = "ExtensionRuntimeDeadlineError";
  }
}

function assertPositiveTimeout(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

async function withDeadline<T>(input: {
  task: Promise<T>;
  timeoutMs: number;
  phase: "activation" | "invocation";
  onTimeout?: () => void;
}): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      input.task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          input.onTimeout?.();
          reject(new ExtensionRuntimeDeadlineError(input.phase));
        }, input.timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildHostedToolContract(registration: ExtensionRuntimeToolRegistration): ToolContract {
  return registration.contract ?? {
    name: registration.definition.name,
    family: "other",
    isReadOnly: false,
    isConcurrencySafe: false,
    needsPermission: true,
    riskLevel: "high",
    channels: ["gateway"],
    safeScopes: ["remote-safe"],
    activityDescription: `Invoke isolated extension tool ${registration.definition.name}`,
    resultSchema: { kind: "text", description: "Isolated extension tool response." },
    outputPersistencePolicy: "external-state",
  };
}

function assertGrant(grant: ExtensionRuntimeGrant): void {
  if (grant.hostApi !== ISOLATED_EXTENSION_HOST_API_VERSION) {
    throw new Error(`Marketplace plugin requires isolated Extension Host API ${ISOLATED_EXTENSION_HOST_API_VERSION}.`);
  }
  if (!/^[a-f0-9]{64}$/i.test(grant.contentSha256)) {
    throw new Error("Extension runtime grant content SHA-256 is invalid.");
  }
  if (grant.runtimeCapabilities.length > 0) {
    throw new Error("Extension runtime broker capabilities are not supported in this host version.");
  }
}

function toJsonObject(value: unknown): JsonObject {
  const serialized = JSON.stringify(value);
  if (!serialized) return {};
  const parsed = JSON.parse(serialized) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as JsonObject
    : {};
}

export class ExtensionRuntimeSupervisor {
  private readonly adapter: ExtensionRuntimeAdapter;
  private readonly toolExecutor: ToolExecutor;
  private readonly hookRegistry: HookRegistry;
  private readonly skillRegistry?: SkillRegistry;
  private readonly activationTimeoutMs: number;
  private readonly invocationTimeoutMs: number;
  private readonly active = new Map<string, ActiveExtensionRuntime>();
  private nextGeneration = 1;

  constructor(options: ExtensionRuntimeSupervisorOptions) {
    if (!options.stateDir.trim()) {
      throw new Error("Extension runtime state directory is required.");
    }
    this.adapter = options.adapter;
    this.toolExecutor = options.toolExecutor;
    this.hookRegistry = options.hookRegistry;
    this.skillRegistry = options.skillRegistry;
    this.activationTimeoutMs = assertPositiveTimeout(
      options.activationTimeoutMs ?? DEFAULT_EXTENSION_ACTIVATION_TIMEOUT_MS,
      "Extension runtime activation timeout",
    );
    this.invocationTimeoutMs = assertPositiveTimeout(
      options.invocationTimeoutMs ?? DEFAULT_EXTENSION_INVOCATION_TIMEOUT_MS,
      "Extension runtime invocation timeout",
    );
  }

  async activateVerifiedExtension(grant: ExtensionRuntimeGrant): Promise<void> {
    assertGrant(grant);
    if (this.active.has(grant.extensionId)) {
      throw new Error(`Extension runtime is already active: ${grant.extensionId}`);
    }

    const generation = this.nextGeneration++;
    const activationController = new AbortController();
    const session = await withDeadline({
      task: this.adapter.activate(structuredClone(grant), activationController.signal),
      timeoutMs: this.activationTimeoutMs,
      phase: "activation",
      onTimeout: () => activationController.abort(),
    });
    try {
      const registrations = session.registrations;
      if (registrations.plugin.id !== grant.extensionName) {
        throw new Error("Extension runtime plugin identity does not match the verified grant.");
      }
      const allowedTools = new Set(
        grant.permissions
          .filter((permission) => permission.startsWith("tool:"))
          .map((permission) => permission.slice("tool:".length)),
      );
      const allowedHooks = new Set(
        grant.permissions
          .filter((permission) => permission.startsWith("hook:"))
          .map((permission) => permission.slice("hook:".length)),
      );
      const toolNames = registrations.tools.map((registration) => registration.definition.name);
      if (new Set(toolNames).size !== toolNames.length) {
        throw new Error("Extension runtime returned duplicate tool registrations.");
      }
      for (const toolName of toolNames) {
        if (!allowedTools.has(toolName)) {
          throw new Error(`Extension runtime tool registration is not approved: ${toolName}`);
        }
        if (this.toolExecutor.hasTool(toolName)) {
          throw new Error(`Duplicate tool registration: ${toolName}`);
        }
      }
      if (new Set(registrations.hooks).size !== registrations.hooks.length) {
        throw new Error("Extension runtime returned duplicate hook registrations.");
      }
      for (const hookName of registrations.hooks) {
        if (!allowedHooks.has(hookName)) {
          throw new Error(`Extension runtime hook registration is not approved: ${hookName}`);
        }
      }
      const approvedSkillDirs = new Map(grant.skillDirs.map((item) => [item.relativePath, item.absolutePath]));
      const allowedSkillDirs = new Set(
        grant.permissions
          .filter((permission) => permission.startsWith("skill:"))
          .map((permission) => permission.slice("skill:".length)),
      );
      for (const skillDir of grant.skillDirs) {
        if (!allowedSkillDirs.has(skillDir.relativePath)) {
          throw new Error(`Extension runtime skill grant is not approved: ${skillDir.relativePath}`);
        }
      }
      for (const skillDir of registrations.skillDirs) {
        if (!approvedSkillDirs.has(skillDir)) {
          throw new Error(`Extension runtime skill directory registration is not approved: ${skillDir}`);
        }
      }
      if (grant.skillDirs.length > 0 && !this.skillRegistry) {
        throw new Error("Extension runtime skill registry is unavailable.");
      }

      const registeredToolNames: string[] = [];
      const hookSource = `extension:${grant.extensionId}:${generation}`;
      let skillCount = 0;
      try {
        if (grant.skillDirs.length > 0) {
          const registeredSkillDirs = registrations.skillDirs.map((relativePath) => approvedSkillDirs.get(relativePath)!);
          skillCount = await this.skillRegistry!.loadPluginSkills(new Map([
            [grant.extensionId, registeredSkillDirs],
          ]));
        }
        for (const registration of registrations.tools) {
          const tool: Tool = {
            definition: structuredClone(registration.definition),
            contract: buildHostedToolContract(registration),
            execute: async (arguments_, context) => {
              const result = await this.invokeActive(grant.extensionId, generation, {
                kind: "tool",
                invocationId: randomUUID(),
                generation,
                toolName: registration.definition.name,
                arguments: arguments_,
                context: {
                  conversationId: context.conversationId,
                  ...(context.agentId ? { agentId: context.agentId } : {}),
                },
              }, context.abortSignal);
              if (!result || !("success" in result)) {
                throw new Error("Extension runtime returned an invalid tool result.");
              }
              return result as ToolCallResult;
            },
          };
          this.toolExecutor.registerTool(tool, {
            origin: "plugin",
            originId: grant.extensionId,
          });
          registeredToolNames.push(registration.definition.name);
        }
        for (const hookName of registrations.hooks) {
          const invokeHook = async (event: unknown, context: unknown) => {
            return this.invokeActive(grant.extensionId, generation, {
              kind: "hook",
              invocationId: randomUUID(),
              generation,
              hookName,
              event: toJsonObject(event),
              context: toJsonObject(context),
            });
          };
          if (hookName === "beforeRun") {
            this.hookRegistry.register({
              source: hookSource,
              hookName: "before_agent_start",
              handler: async (event, context) => await invokeHook(event, context) as never,
            });
          } else if (hookName === "afterRun") {
            this.hookRegistry.register({
              source: hookSource,
              hookName: "agent_end",
              handler: async (event, context) => {
                await invokeHook(event, context);
              },
            });
          } else if (hookName === "beforeToolCall") {
            this.hookRegistry.register({
              source: hookSource,
              hookName: "before_tool_call",
              handler: async (event, context) => await invokeHook(event, context) as never,
            });
          } else if (hookName === "afterToolCall") {
            this.hookRegistry.register({
              source: hookSource,
              hookName: "after_tool_call",
              handler: async (event, context) => {
                await invokeHook(event, context);
              },
            });
          }
        }
      } catch (error) {
        for (const toolName of registeredToolNames) {
          this.toolExecutor.unregisterTool(toolName);
        }
        this.hookRegistry.unregister(hookSource);
        this.skillRegistry?.unloadPluginSkills(grant.extensionId);
        throw error;
      }

      const active: ActiveExtensionRuntime = {
        extensionId: grant.extensionId,
        extensionName: grant.extensionName,
        generation,
        toolNames,
        hookNames: [...registrations.hooks],
        skillCount,
        invocations: new Map(),
        session,
      };
      this.active.set(grant.extensionId, active);
      active.unsubscribeFatal = session.onFatal?.(() => {
        void this.revoke(grant.extensionId, "runtime_fatal").catch(() => {});
      });
    } catch (error) {
      await session.close("activation_failed").catch(() => {});
      throw error;
    }
  }

  async revoke(extensionId: string, reason = "revoked"): Promise<boolean> {
    const active = this.active.get(extensionId);
    if (!active) return false;
    this.active.delete(extensionId);
    active.unsubscribeFatal?.();
    for (const toolName of active.toolNames) {
      this.toolExecutor.unregisterTool(toolName);
    }
    this.hookRegistry.unregister(`extension:${extensionId}:${active.generation}`);
    this.skillRegistry?.unloadPluginSkills(extensionId);
    for (const controller of active.invocations.values()) {
      controller.abort();
    }
    active.invocations.clear();
    await active.session.close(reason);
    return true;
  }

  async dispose(): Promise<void> {
    const extensionIds = [...this.active.keys()].reverse();
    const errors: unknown[] = [];
    for (const extensionId of extensionIds) {
      try {
        await this.revoke(extensionId, "gateway_shutdown");
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Multiple extension runtime sessions failed to close.");
    }
  }

  private async invokeActive(
    extensionId: string,
    generation: number,
    invocation: ExtensionRuntimeInvocation,
    callerSignal?: AbortSignal,
  ): Promise<ToolCallResult | JsonObject | undefined> {
    const active = this.active.get(extensionId);
    if (!active || active.generation !== generation) {
      throw new Error("Extension runtime generation is no longer active.");
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    active.invocations.set(invocation.invocationId, controller);
    try {
      const result = await withDeadline({
        task: active.session.invoke(invocation, controller.signal),
        timeoutMs: this.invocationTimeoutMs,
        phase: "invocation",
        onTimeout: () => controller.abort(),
      });
      const current = this.active.get(extensionId);
      if (!current || current.generation !== generation) {
        throw new Error("Extension runtime generation is no longer active.");
      }
      return result;
    } catch (error) {
      if (error instanceof ExtensionRuntimeDeadlineError) {
        await this.revoke(extensionId, "invocation_deadline_exceeded").catch(() => {});
      }
      throw error;
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
      active.invocations.delete(invocation.invocationId);
    }
  }

  getSnapshot(): ExtensionRuntimeSupervisorSnapshot {
    const sessions = [...this.active.values()]
      .map((active) => ({
        extensionId: active.extensionId,
        extensionName: active.extensionName,
        generation: active.generation,
        toolNames: [...active.toolNames],
        hookNames: [...active.hookNames],
        skillCount: active.skillCount,
        activeInvocationCount: active.invocations.size,
      }))
      .sort((left, right) => left.extensionId.localeCompare(right.extensionId));
    return {
      activeExtensionCount: sessions.length,
      sessions,
    };
  }
}
