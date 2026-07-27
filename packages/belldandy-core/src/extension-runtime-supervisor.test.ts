import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HookRegistry } from "@belldandy/agent";
import { SkillRegistry, ToolExecutor } from "@belldandy/skills";

import {
  ExtensionRuntimeSupervisor,
  InMemoryExtensionRuntimeAdapter,
} from "./extension-runtime-supervisor.js";

describe("ExtensionRuntimeSupervisor", () => {
  const tempDirs: string[] = [];
  const supervisors: ExtensionRuntimeSupervisor[] = [];

  afterEach(async () => {
    await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.dispose()));
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("activates an approved pure tool through the isolated runtime interface", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-runtime-"));
    tempDirs.push(stateDir);
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const adapter = new InMemoryExtensionRuntimeAdapter({
      registrations: {
        plugin: { id: "pure-plugin", name: "Pure Plugin", version: "1.0.0" },
        tools: [{
          definition: {
            name: "pure_echo",
            description: "Echo a value",
            parameters: {
              type: "object",
              properties: { value: { type: "string", description: "Value to echo" } },
              required: ["value"],
            },
          },
        }],
        hooks: [],
        skillDirs: [],
      },
      invoke: async (invocation) => ({
        id: invocation.invocationId,
        name: invocation.kind === "tool" ? invocation.toolName : invocation.hookName,
        success: true,
        output: invocation.kind === "tool" ? String(invocation.arguments.value) : "",
        durationMs: 0,
      }),
    });
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter,
      toolExecutor,
      hookRegistry: new HookRegistry(),
    });
    supervisors.push(supervisor);

    await supervisor.activateVerifiedExtension({
      extensionId: "pure-plugin@official-market",
      extensionName: "pure-plugin",
      installPath: path.join(stateDir, "extensions", "materialized", "official-market", "pure-plugin"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "a".repeat(64),
      hostApi: 2,
      permissions: ["tool:pure_echo"],
      runtimeCapabilities: [],
      skillDirs: [],
    });

    const result = await toolExecutor.execute({
      id: "call-1",
      name: "pure_echo",
      arguments: { value: "isolated" },
    }, "conversation-1");

    expect(result).toMatchObject({
      id: "call-1",
      name: "pure_echo",
      success: true,
      output: "isolated",
    });
    expect(supervisor.getSnapshot()).toMatchObject({
      activeExtensionCount: 1,
      sessions: [{
        extensionId: "pure-plugin@official-market",
        extensionName: "pure-plugin",
        generation: 1,
        toolNames: ["pure_echo"],
        hookNames: [],
      }],
    });
  });

  it("runs an approved tool hook through a minimal serializable context", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-hook-runtime-"));
    tempDirs.push(stateDir);
    const observedInvocations: unknown[] = [];
    const hookRegistry = new HookRegistry();
    const adapter = new InMemoryExtensionRuntimeAdapter({
      registrations: {
        plugin: { id: "hook-plugin", name: "Hook Plugin" },
        tools: [],
        hooks: ["beforeToolCall"],
        skillDirs: [],
      },
      invoke: async (invocation) => {
        observedInvocations.push(invocation);
        return invocation.kind === "hook"
          ? { params: { approvedByIsolatedHook: true } }
          : undefined;
      },
    });
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter,
      toolExecutor: new ToolExecutor({ tools: [], workspaceRoot: stateDir }),
      hookRegistry,
    });
    supervisors.push(supervisor);

    await supervisor.activateVerifiedExtension({
      extensionId: "hook-plugin@official-market",
      extensionName: "hook-plugin",
      installPath: path.join(stateDir, "extensions", "materialized", "official-market", "hook-plugin"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "b".repeat(64),
      hostApi: 2,
      permissions: ["hook:beforeToolCall"],
      runtimeCapabilities: [],
      skillDirs: [],
    });

    const registrations = hookRegistry.getHooks("before_tool_call");
    const result = await registrations[0]?.handler(
      { toolName: "file_write", params: { path: "README.md" } },
      { agentId: "agent-1", sessionKey: "conversation-1", toolName: "file_write" },
    );

    expect(registrations).toHaveLength(1);
    expect(result).toEqual({ params: { approvedByIsolatedHook: true } });
    expect(observedInvocations).toEqual([
      expect.objectContaining({
        kind: "hook",
        generation: 1,
        hookName: "beforeToolCall",
        event: { toolName: "file_write", params: { path: "README.md" } },
        context: { agentId: "agent-1", sessionKey: "conversation-1", toolName: "file_write" },
      }),
    ]);
    expect(JSON.stringify(observedInvocations)).not.toContain("workspaceRoot");
    expect(JSON.stringify(observedInvocations)).not.toContain("stateDir");
  });

  it("revokes tool, hook, and skill ownership before closing the runtime session", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-revoke-runtime-"));
    const skillRoot = path.join(stateDir, "materialized", "skills");
    tempDirs.push(stateDir);
    await fs.mkdir(path.join(skillRoot, "hosted-skill"), { recursive: true });
    await fs.writeFile(path.join(skillRoot, "hosted-skill", "SKILL.md"), [
      "---",
      "name: hosted-skill",
      "description: hosted skill",
      "priority: normal",
      "---",
      "Hosted skill instructions",
      "",
    ].join("\n"), "utf-8");
    const closeReasons: string[] = [];
    const hookRegistry = new HookRegistry();
    const skillRegistry = new SkillRegistry();
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const adapter = new InMemoryExtensionRuntimeAdapter({
      registrations: {
        plugin: { id: "owned-plugin", name: "Owned Plugin" },
        tools: [{
          definition: {
            name: "owned_tool",
            description: "Owned tool",
            parameters: { type: "object", properties: {} },
          },
        }],
        hooks: ["beforeToolCall"],
        skillDirs: ["skills"],
      },
      invoke: async () => undefined,
      close: async (reason) => {
        closeReasons.push(reason);
      },
    });
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter,
      toolExecutor,
      hookRegistry,
      skillRegistry,
    });
    supervisors.push(supervisor);

    await supervisor.activateVerifiedExtension({
      extensionId: "owned-plugin@official-market",
      extensionName: "owned-plugin",
      installPath: path.join(stateDir, "materialized"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "c".repeat(64),
      hostApi: 2,
      permissions: ["tool:owned_tool", "hook:beforeToolCall", "skill:skills"],
      runtimeCapabilities: [],
      skillDirs: [{ relativePath: "skills", absolutePath: skillRoot }],
    });

    expect(toolExecutor.hasTool("owned_tool")).toBe(true);
    expect(hookRegistry.getHookCount("before_tool_call")).toBe(1);
    expect(skillRegistry.getSkill("hosted-skill")?.source).toEqual({
      type: "plugin",
      pluginId: "owned-plugin@official-market",
    });

    await expect(supervisor.revoke("owned-plugin@official-market", "disabled")).resolves.toBe(true);

    expect(toolExecutor.hasTool("owned_tool")).toBe(false);
    expect(hookRegistry.getHookCount("before_tool_call")).toBe(0);
    expect(skillRegistry.getSkill("hosted-skill")).toBeUndefined();
    expect(closeReasons).toEqual(["disabled"]);
    expect(supervisor.getSnapshot().activeExtensionCount).toBe(0);
  });

  it("rejects unapproved registrations without leaving visible ownership", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-denied-runtime-"));
    tempDirs.push(stateDir);
    const close = vi.fn();
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const hookRegistry = new HookRegistry();
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter: new InMemoryExtensionRuntimeAdapter({
        registrations: {
          plugin: { id: "denied-plugin", name: "Denied Plugin" },
          tools: [{
            definition: {
              name: "unapproved_tool",
              description: "Must never become visible",
              parameters: { type: "object", properties: {} },
            },
          }],
          hooks: ["beforeToolCall"],
          skillDirs: [],
        },
        invoke: async () => undefined,
        close,
      }),
      toolExecutor,
      hookRegistry,
    });
    supervisors.push(supervisor);

    await expect(supervisor.activateVerifiedExtension({
      extensionId: "denied-plugin@official-market",
      extensionName: "denied-plugin",
      installPath: path.join(stateDir, "materialized"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "d".repeat(64),
      hostApi: 2,
      permissions: ["hook:beforeToolCall"],
      runtimeCapabilities: [],
      skillDirs: [],
    })).rejects.toThrow(/tool registration is not approved/);

    expect(toolExecutor.hasTool("unapproved_tool")).toBe(false);
    expect(hookRegistry.getHookCount("before_tool_call")).toBe(0);
    expect(supervisor.getSnapshot().activeExtensionCount).toBe(0);
    expect(close).toHaveBeenCalledWith("activation_failed");
  });

  it("discards an in-flight result after its generation is revoked", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-stale-runtime-"));
    tempDirs.push(stateDir);
    let resolveInvocation: ((value: {
      id: string;
      name: string;
      success: true;
      output: string;
      durationMs: number;
    }) => void) | undefined;
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter: new InMemoryExtensionRuntimeAdapter({
        registrations: {
          plugin: { id: "stale-plugin", name: "Stale Plugin" },
          tools: [{
            definition: {
              name: "stale_tool",
              description: "Returns after revoke",
              parameters: { type: "object", properties: {} },
            },
          }],
          hooks: [],
          skillDirs: [],
        },
        invoke: async (invocation) => await new Promise((resolve) => {
          resolveInvocation = resolve;
        }),
      }),
      toolExecutor,
      hookRegistry: new HookRegistry(),
    });
    supervisors.push(supervisor);
    await supervisor.activateVerifiedExtension({
      extensionId: "stale-plugin@official-market",
      extensionName: "stale-plugin",
      installPath: path.join(stateDir, "materialized"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "e".repeat(64),
      hostApi: 2,
      permissions: ["tool:stale_tool"],
      runtimeCapabilities: [],
      skillDirs: [],
    });

    const invocation = toolExecutor.execute({
      id: "stale-call",
      name: "stale_tool",
      arguments: {},
    }, "conversation-stale");
    await vi.waitFor(() => expect(resolveInvocation).toBeTypeOf("function"));
    await supervisor.revoke("stale-plugin@official-market", "updated");
    resolveInvocation!({
      id: "host-call",
      name: "stale_tool",
      success: true,
      output: "must-not-escape",
      durationMs: 0,
    });

    await expect(invocation).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/generation is no longer active/i),
    });
  });

  it("fails closed and revokes ownership when an invocation exceeds its deadline", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-timeout-runtime-"));
    tempDirs.push(stateDir);
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      invocationTimeoutMs: 20,
      adapter: new InMemoryExtensionRuntimeAdapter({
        registrations: {
          plugin: { id: "timeout-plugin", name: "Timeout Plugin" },
          tools: [{
            definition: {
              name: "timeout_tool",
              description: "Never returns",
              parameters: { type: "object", properties: {} },
            },
          }],
          hooks: [],
          skillDirs: [],
        },
        invoke: async () => await new Promise(() => {}),
      }),
      toolExecutor,
      hookRegistry: new HookRegistry(),
    });
    supervisors.push(supervisor);
    await supervisor.activateVerifiedExtension({
      extensionId: "timeout-plugin@official-market",
      extensionName: "timeout-plugin",
      installPath: path.join(stateDir, "materialized"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "f".repeat(64),
      hostApi: 2,
      permissions: ["tool:timeout_tool"],
      runtimeCapabilities: [],
      skillDirs: [],
    });

    await expect(toolExecutor.execute({
      id: "timeout-call",
      name: "timeout_tool",
      arguments: {},
    }, "conversation-timeout")).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/deadline/i),
    });
    expect(toolExecutor.hasTool("timeout_tool")).toBe(false);
    expect(supervisor.getSnapshot().activeExtensionCount).toBe(0);
  });

  it("revokes visible ownership when the external Host reports a fatal failure", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-fatal-runtime-"));
    tempDirs.push(stateDir);
    let fatalListener: ((error: Error) => void) | undefined;
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const hookRegistry = new HookRegistry();
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter: {
        activate: async () => ({
          registrations: {
            plugin: { id: "fatal-plugin", name: "Fatal Plugin" },
            tools: [{
              definition: {
                name: "fatal_tool",
                description: "Removed after host failure",
                parameters: { type: "object", properties: {} },
              },
            }],
            hooks: ["beforeToolCall"],
            skillDirs: [],
          },
          invoke: async () => undefined,
          onFatal: (listener) => {
            fatalListener = listener;
            return () => { fatalListener = undefined; };
          },
          close: async () => undefined,
        }),
      },
      toolExecutor,
      hookRegistry,
    });
    supervisors.push(supervisor);
    await supervisor.activateVerifiedExtension({
      extensionId: "fatal-plugin@official-market",
      extensionName: "fatal-plugin",
      installPath: path.join(stateDir, "materialized"),
      pluginModuleRelativePath: "dist/plugin.mjs",
      contentSha256: "1".repeat(64),
      hostApi: 2,
      permissions: ["tool:fatal_tool", "hook:beforeToolCall"],
      runtimeCapabilities: [],
      skillDirs: [],
    });
    expect(toolExecutor.hasTool("fatal_tool")).toBe(true);
    expect(hookRegistry.getHookCount("before_tool_call")).toBe(1);

    fatalListener!(new Error("host exited"));
    await vi.waitFor(() => expect(supervisor.getSnapshot().activeExtensionCount).toBe(0));

    expect(toolExecutor.hasTool("fatal_tool")).toBe(false);
    expect(hookRegistry.getHookCount("before_tool_call")).toBe(0);
  });

  it("disposes sessions in reverse order and keeps cleaning after one close failure", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-dispose-runtime-"));
    tempDirs.push(stateDir);
    const closeOrder: string[] = [];
    let activation = 0;
    const toolExecutor = new ToolExecutor({ tools: [], workspaceRoot: stateDir });
    const supervisor = new ExtensionRuntimeSupervisor({
      stateDir,
      adapter: {
        activate: async () => {
          activation += 1;
          const current = activation;
          return {
            registrations: {
              plugin: { id: `dispose-plugin-${current}`, name: `Dispose Plugin ${current}` },
              tools: [{
                definition: {
                  name: `dispose_tool_${current}`,
                  description: "Disposed tool",
                  parameters: { type: "object", properties: {} },
                },
              }],
              hooks: [],
              skillDirs: [],
            },
            invoke: async () => undefined,
            close: async () => {
              closeOrder.push(`dispose-plugin-${current}`);
              if (current === 2) throw new Error("close failed");
            },
          };
        },
      },
      toolExecutor,
      hookRegistry: new HookRegistry(),
    });
    supervisors.push(supervisor);
    for (const index of [1, 2, 3]) {
      await supervisor.activateVerifiedExtension({
        extensionId: `dispose-plugin-${index}@official-market`,
        extensionName: `dispose-plugin-${index}`,
        installPath: path.join(stateDir, `materialized-${index}`),
        pluginModuleRelativePath: "dist/plugin.mjs",
        contentSha256: String(index).repeat(64),
        hostApi: 2,
        permissions: [`tool:dispose_tool_${index}`],
        runtimeCapabilities: [],
        skillDirs: [],
      });
    }

    await expect(supervisor.dispose()).rejects.toThrow(/close failed/);

    expect(closeOrder).toEqual(["dispose-plugin-3", "dispose-plugin-2", "dispose-plugin-1"]);
    expect(toolExecutor.hasTool("dispose_tool_1")).toBe(false);
    expect(toolExecutor.hasTool("dispose_tool_2")).toBe(false);
    expect(toolExecutor.hasTool("dispose_tool_3")).toBe(false);
    expect(supervisor.getSnapshot().activeExtensionCount).toBe(0);
    supervisors.splice(supervisors.indexOf(supervisor), 1);
  });
});
