import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXTENSION_RUNTIME_PROTOCOL_VERSION } from "./extension-runtime-contract.js";
import { runExtensionRuntimeHostProcess } from "./extension-runtime-host-process.js";

async function* lines(frames: unknown[]): AsyncIterable<string> {
  for (const frame of frames) yield `${JSON.stringify(frame)}\n`;
}

describe("extension runtime host process", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("imports, activates, invokes, and disposes a plugin entirely inside the host", async () => {
    const extensionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-host-process-"));
    tempDirs.push(extensionRoot);
    await fs.mkdir(path.join(extensionRoot, "dist"), { recursive: true });
    await fs.mkdir(path.join(extensionRoot, "skills"), { recursive: true });
    await fs.writeFile(path.join(extensionRoot, "dist", "plugin.mjs"), `
      export default {
        id: "hosted-plugin",
        name: "Hosted Plugin",
        version: "1.0.0",
        async activate(context) {
          context.registerTool({
            definition: {
              name: "hosted_echo",
              description: "Echo through host",
              parameters: { type: "object", properties: { value: { type: "string", description: "value" } } }
            },
            contract: {
              name: "hosted_echo",
              family: "other",
              isReadOnly: true,
              isConcurrencySafe: true,
              needsPermission: false,
              riskLevel: "low",
              channels: ["gateway"],
              safeScopes: ["remote-safe"],
              activityDescription: "Echo",
              resultSchema: { kind: "text", description: "Echo" },
              outputPersistencePolicy: "none"
            },
            async execute(args, toolContext) {
              return {
                id: "host-result",
                name: "hosted_echo",
                success: true,
                output: JSON.stringify({ value: args.value, contextKeys: Object.keys(toolContext).sort() }),
                durationMs: 0
              };
            }
          });
          context.registerHooks({
            beforeToolCall: async (event, hookContext) => ({
              ...event.params,
              hookContextKeys: Object.keys(hookContext).sort()
            })
          });
          context.registerSkillDir(new URL("../skills", import.meta.url).pathname);
          context.onDispose(() => { globalThis.__hostedPluginDisposed = true; });
        }
      };
    `, "utf8");

    const output: string[] = [];
    const exitCode = await runExtensionRuntimeHostProcess({
      extensionRoot,
      input: lines([
        {
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "activate",
          id: "activate-1",
          pluginModuleRelativePath: "dist/plugin.mjs",
        },
        {
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "invoke",
          id: "invoke-tool-1",
          invocation: {
            kind: "tool",
            invocationId: "tool-1",
            generation: 7,
            toolName: "hosted_echo",
            arguments: { value: "isolated" },
            context: { conversationId: "conversation-1", agentId: "agent-1" },
          },
        },
        {
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "invoke",
          id: "invoke-hook-1",
          invocation: {
            kind: "hook",
            invocationId: "hook-1",
            generation: 7,
            hookName: "beforeToolCall",
            event: { toolName: "file_read", params: { path: "README.md" } },
            context: { agentId: "agent-1", sessionKey: "conversation-1" },
          },
        },
        {
          version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
          type: "dispose",
          id: "dispose-1",
          reason: "test_complete",
        },
      ]),
      writeStdout: (line) => output.push(line),
      writeStderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    const responses = output.map((line) => JSON.parse(line));
    expect(responses[0]).toMatchObject({
      type: "activated",
      id: "activate-1",
      ok: true,
      registrations: {
        plugin: { id: "hosted-plugin", name: "Hosted Plugin", version: "1.0.0" },
        tools: [{ definition: { name: "hosted_echo" } }],
        hooks: ["beforeToolCall"],
        skillDirs: ["skills"],
      },
    });
    expect(JSON.parse(responses[1].result.output)).toEqual({
      value: "isolated",
      contextKeys: ["abortSignal", "agentId", "conversationId"],
    });
    expect(responses[2]).toMatchObject({
      type: "result",
      ok: true,
      result: {
        params: { path: "README.md", hookContextKeys: ["agentId", "sessionKey"] },
      },
    });
    expect(responses[3]).toMatchObject({ type: "disposed", id: "dispose-1", ok: true });
    expect((globalThis as Record<string, unknown>).__hostedPluginDisposed).toBe(true);
    delete (globalThis as Record<string, unknown>).__hostedPluginDisposed;
  });
});
