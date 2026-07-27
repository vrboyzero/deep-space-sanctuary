import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { JsonObject } from "@belldandy/protocol";
import type { BelldandyPlugin, PluginDisposer, PluginHookName } from "@belldandy/plugins";
import type { Tool, ToolCallResult } from "@belldandy/skills";

import {
  EXTENSION_RUNTIME_MAX_FRAME_BYTES,
  EXTENSION_RUNTIME_PROTOCOL_VERSION,
  parseExtensionRuntimeRequestLine,
  serializeExtensionRuntimeFrame,
  type ExtensionRuntimeHostResponse,
} from "./extension-runtime-contract.js";
import type {
  ExtensionRuntimeInvocation,
  ExtensionRuntimeRegistrations,
} from "./extension-runtime-supervisor.js";

type HostHookSet = Partial<Record<PluginHookName, (...args: unknown[]) => unknown | Promise<unknown>>>;

type ActiveHostPlugin = {
  plugin: BelldandyPlugin;
  tools: Map<string, Tool>;
  hooks: HostHookSet[];
  disposers: PluginDisposer[];
};

export type RunExtensionRuntimeHostProcessOptions = {
  extensionRoot: string;
  input: AsyncIterable<string | Buffer>;
  writeStdout: (line: string) => void;
  writeStderr: (line: string) => void;
};

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1024);
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (!serialized) return undefined;
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extension runtime result must be a JSON object.");
  }
  return parsed as JsonObject;
}

async function resolvePluginModule(extensionRoot: string, relativePath: string): Promise<string> {
  const canonicalRoot = await fs.realpath(extensionRoot);
  const candidate = await fs.realpath(path.join(canonicalRoot, ...relativePath.split("/")));
  const relative = path.relative(canonicalRoot, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Extension runtime plugin module escapes the extension root.");
  }
  if (!(await fs.stat(candidate)).isFile()) {
    throw new Error("Extension runtime plugin module must be a file.");
  }
  return candidate;
}

function normalizeWindowsFileUrlPath(value: string): string {
  return process.platform === "win32" && /^\/[A-Za-z]:\//.test(value) ? value.slice(1) : value;
}

async function toExtensionRelativeDirectory(extensionRoot: string, value: string): Promise<string> {
  const canonicalRoot = await fs.realpath(extensionRoot);
  const canonicalDir = await fs.realpath(normalizeWindowsFileUrlPath(value));
  const relative = path.relative(canonicalRoot, canonicalDir);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Extension runtime skill directory escapes the extension root.");
  }
  if (!(await fs.stat(canonicalDir)).isDirectory()) {
    throw new Error("Extension runtime skill directory must be a directory.");
  }
  return relative.split(path.sep).join("/");
}

async function runDisposers(disposers: PluginDisposer[]): Promise<void> {
  const errors: unknown[] = [];
  for (const disposer of [...disposers].reverse()) {
    try {
      await disposer();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Extension runtime disposers failed.");
}

async function activatePlugin(extensionRoot: string, pluginModuleRelativePath: string): Promise<{
  active: ActiveHostPlugin;
  registrations: ExtensionRuntimeRegistrations;
}> {
  const pluginModule = await resolvePluginModule(extensionRoot, pluginModuleRelativePath);
  const imported = await import(pathToFileURL(pluginModule).href);
  const plugin = imported.default as BelldandyPlugin;
  if (!plugin || typeof plugin.id !== "string" || typeof plugin.name !== "string" || typeof plugin.activate !== "function") {
    throw new Error("Extension module does not export a valid plugin.");
  }

  const tools = new Map<string, Tool>();
  const hooks: HostHookSet[] = [];
  const skillDirs: string[] = [];
  const disposers: PluginDisposer[] = [];
  try {
    await plugin.activate({
      registerTool: (tool) => {
        if (!tool?.definition?.name || typeof tool.execute !== "function") {
          throw new Error("Extension runtime tool registration is invalid.");
        }
        if (tools.has(tool.definition.name)) {
          throw new Error(`Duplicate extension runtime tool registration: ${tool.definition.name}`);
        }
        tools.set(tool.definition.name, tool);
      },
      registerHooks: (registration) => {
        hooks.push(registration as HostHookSet);
      },
      registerSkillDir: (dir) => {
        skillDirs.push(dir);
      },
      onDispose: (disposer) => {
        if (typeof disposer !== "function") throw new Error("Extension runtime disposer must be a function.");
        disposers.push(disposer);
      },
    });

    const hookNames = (["beforeRun", "afterRun", "beforeToolCall", "afterToolCall"] as PluginHookName[])
      .filter((hookName) => hooks.some((registration) => typeof registration[hookName] === "function"));
    const relativeSkillDirs: string[] = [];
    for (const dir of skillDirs) {
      const relative = await toExtensionRelativeDirectory(extensionRoot, dir);
      if (!relativeSkillDirs.includes(relative)) relativeSkillDirs.push(relative);
    }
    const registrations: ExtensionRuntimeRegistrations = {
      plugin: {
        id: plugin.id,
        name: plugin.name,
        ...(plugin.version ? { version: plugin.version } : {}),
        ...(plugin.description ? { description: plugin.description } : {}),
      },
      tools: [...tools.values()].map((tool) => ({
        definition: tool.definition,
        ...(tool.contract ? { contract: tool.contract } : {}),
      })),
      hooks: hookNames,
      skillDirs: relativeSkillDirs,
    };
    toJsonObject(registrations);
    return { active: { plugin, tools, hooks, disposers }, registrations };
  } catch (error) {
    await runDisposers(disposers).catch(() => {});
    throw error;
  }
}

async function invokeHost(active: ActiveHostPlugin, invocation: ExtensionRuntimeInvocation): Promise<JsonObject | undefined> {
  if (invocation.kind === "tool") {
    const tool = active.tools.get(invocation.toolName);
    if (!tool) throw new Error(`Extension runtime tool is not registered: ${invocation.toolName}`);
    const controller = new AbortController();
    const result = await tool.execute(invocation.arguments, {
      conversationId: invocation.context.conversationId,
      ...(invocation.context.agentId ? { agentId: invocation.context.agentId } : {}),
      abortSignal: controller.signal,
    } as never) as ToolCallResult;
    return toJsonObject(result);
  }

  let result: unknown;
  for (const hooks of active.hooks) {
    const hook = hooks[invocation.hookName];
    if (!hook) continue;
    result = await hook(invocation.event, invocation.context);
    if (invocation.hookName === "beforeToolCall" && result === false) {
      return { block: true, blockReason: "blocked by extension hook" };
    }
    if (invocation.hookName === "beforeToolCall" && result && typeof result === "object") {
      return { params: toJsonObject(result)! };
    }
  }
  return toJsonObject(result);
}

async function disposePlugin(active: ActiveHostPlugin): Promise<void> {
  let deactivateError: unknown;
  try {
    await active.plugin.deactivate?.();
  } catch (error) {
    deactivateError = error;
  }
  let disposerError: unknown;
  try {
    await runDisposers(active.disposers);
  } catch (error) {
    disposerError = error;
  }
  if (deactivateError) throw deactivateError;
  if (disposerError) throw disposerError;
}

export async function runExtensionRuntimeHostProcess(options: RunExtensionRuntimeHostProcessOptions): Promise<number> {
  let active: ActiveHostPlugin | undefined;
  let buffer = "";
  const write = (response: ExtensionRuntimeHostResponse) => options.writeStdout(serializeExtensionRuntimeFrame(response));

  const processLine = async (line: string): Promise<boolean> => {
    let request;
    try {
      request = parseExtensionRuntimeRequestLine(line);
    } catch (error) {
      write({
        version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
        type: "error",
        id: "protocol",
        ok: false,
        error: { code: "protocol_error", message: errorMessage(error) },
      });
      return false;
    }

    try {
      if (request.type === "activate") {
        if (active) throw new Error("Extension runtime is already activated.");
        const activated = await activatePlugin(options.extensionRoot, request.pluginModuleRelativePath);
        active = activated.active;
        write({
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "activated",
          id: request.id,
          ok: true,
          registrations: activated.registrations,
        });
        return true;
      }
      if (request.type === "invoke") {
        if (!active) throw new Error("Extension runtime is not activated.");
        const result = await invokeHost(active, request.invocation);
        write({
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "result",
          id: request.id,
          ok: true,
          ...(result ? { result } : {}),
        });
        return true;
      }
      if (!active) throw new Error("Extension runtime is not activated.");
      await disposePlugin(active);
      active = undefined;
      write({
        version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
        type: "disposed",
        id: request.id,
        ok: true,
      });
      return false;
    } catch (error) {
      write({
        version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
        type: "error",
        id: request.id,
        ok: false,
        error: {
          code: request.type === "activate"
            ? "activation_failed"
            : request.type === "invoke"
              ? "invocation_failed"
              : "dispose_failed",
          message: errorMessage(error),
        },
      });
      return request.type === "invoke";
    }
  };

  for await (const chunk of options.input) {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer, "utf8") > EXTENSION_RUNTIME_MAX_FRAME_BYTES && !buffer.includes("\n")) {
      options.writeStderr("Extension runtime input exceeded the frame size limit.\n");
      return 2;
    }
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line && !await processLine(line)) return 0;
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim() && !await processLine(buffer.trim())) return 0;
  if (active) {
    await disposePlugin(active).catch(() => {});
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const extensionRoot = process.argv[2];
  if (!extensionRoot) {
    process.stderr.write("Extension root argument is required.\n");
    process.exitCode = 2;
  } else {
    process.exitCode = await runExtensionRuntimeHostProcess({
      extensionRoot,
      input: process.stdin,
      writeStdout: (line) => process.stdout.write(line),
      writeStderr: (line) => process.stderr.write(line),
    });
  }
}
