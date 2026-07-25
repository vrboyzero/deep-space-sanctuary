import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./command-registry.js";
import type { CommandDescriptor } from "./command-types.js";
import { getRootCLICommands } from "./builtin-command-registry.js";

function createDescriptor(
  overrides: Partial<CommandDescriptor> & Pick<CommandDescriptor, "name">,
): CommandDescriptor {
  return {
    name: overrides.name,
    type: overrides.type ?? "command",
    source: overrides.source ?? "builtin",
    visibility: overrides.visibility ?? "public",
    channels: overrides.channels ?? ["cli"],
    safeScopes: overrides.safeScopes ?? ["local-safe"],
    featureFlag: overrides.featureFlag,
    isSensitive: overrides.isSensitive,
    description: overrides.description,
    aliases: overrides.aliases,
    handler: overrides.handler ?? (() =>
      defineCommand({
        meta: {
          name: overrides.name,
          description: `${overrides.name} command`,
        },
      })),
  };
}

describe("CommandRegistry", () => {
  it("filters commands by channel, visibility and feature flag", () => {
    const registry = new CommandRegistry([
      createDescriptor({ name: "status" }),
      createDescriptor({ name: "web-sync", channels: ["web"] }),
      createDescriptor({ name: "internal-audit", visibility: "internal" }),
      createDescriptor({ name: "preview", featureFlag: "preview-mode" }),
    ]);

    const visibleCLICommands = registry.list({
      channel: "cli",
      visibility: "public",
      enabledFeatureFlags: ["preview-mode"],
    });

    expect(visibleCLICommands.map((command) => command.name)).toEqual([
      "status",
      "preview",
    ]);
  });

  it("excludes sensitive commands when requested", () => {
    const registry = new CommandRegistry([
      createDescriptor({ name: "status" }),
      createDescriptor({ name: "token-dump", isSensitive: true }),
    ]);

    const commands = registry.list({
      channel: "cli",
      visibility: "public",
      includeSensitive: false,
    });

    expect(commands.map((command) => command.name)).toEqual(["status"]);
  });

  it("creates citty subCommands from matching descriptors", async () => {
    const registry = new CommandRegistry([
      createDescriptor({
        name: "doctor",
        handler: async () => ({
          default: defineCommand({
            meta: {
              name: "doctor",
              description: "Run diagnostics",
            },
          }),
        }),
      }),
      createDescriptor({
        name: "web-sync",
        channels: ["web"],
      }),
    ]);

    const subCommands = registry.toSubCommands({
      channel: "cli",
      visibility: "public",
    });
    const doctorLoader = subCommands.doctor as () => Promise<ReturnType<typeof defineCommand>>;
    const loadedDoctorCommand = await doctorLoader();
    const meta = typeof loadedDoctorCommand.meta === "function"
      ? await loadedDoctorCommand.meta()
      : await loadedDoctorCommand.meta;

    expect(Object.keys(subCommands)).toEqual(["doctor"]);
    expect(meta?.name).toBe("doctor");
    expect(meta?.description).toBe("Run diagnostics");
  });

  it("exposes builtin conversation command group", async () => {
    const subCommands = getRootCLICommands();
    const conversationLoader = subCommands.conversation as () => Promise<ReturnType<typeof defineCommand>>;
    const loadedConversationCommand = await conversationLoader();
    const meta = typeof loadedConversationCommand.meta === "function"
      ? await loadedConversationCommand.meta()
      : await loadedConversationCommand.meta;

    expect(Object.keys(subCommands)).toContain("conversation");
    expect(meta?.name).toBe("conversation");
  });

  it("exposes builtin console command", async () => {
    const subCommands = getRootCLICommands();
    const consoleLoader = subCommands.console as () => Promise<ReturnType<typeof defineCommand>>;
    const loadedConsoleCommand = await consoleLoader();
    const meta = typeof loadedConsoleCommand.meta === "function"
      ? await loadedConsoleCommand.meta()
      : await loadedConsoleCommand.meta;

    expect(Object.keys(subCommands)).toContain("console");
    expect(meta?.name).toBe("console");
  });

  it("exposes builtin tui command", async () => {
    const subCommands = getRootCLICommands();
    const tuiLoader = subCommands.tui as () => Promise<ReturnType<typeof defineCommand>>;
    const loadedTuiCommand = await tuiLoader();
    const meta = typeof loadedTuiCommand.meta === "function"
      ? await loadedTuiCommand.meta()
      : await loadedTuiCommand.meta;

    expect(Object.keys(subCommands)).toContain("tui");
    expect(meta?.name).toBe("tui");
  });
});
