import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import type { MCPConfig, MCPServerConfig } from "./types.js";

let previousStateDir = process.env.BELLDANDY_STATE_DIR;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (previousStateDir === undefined) {
    delete process.env.BELLDANDY_STATE_DIR;
  } else {
    process.env.BELLDANDY_STATE_DIR = previousStateDir;
  }
});

function createServer(id: string): MCPServerConfig {
  return {
    id,
    name: `Test ${id}`,
    transport: {
      type: "stdio",
      command: "node",
      args: ["--version"],
    },
    autoConnect: false,
    enabled: true,
  };
}

function createConfig(servers: MCPServerConfig[], revision = 0): MCPConfig {
  return {
    version: "1.0.0",
    revision,
    servers,
    settings: {
      defaultTimeout: 30000,
      debug: false,
      toolPrefix: true,
    },
  };
}

test("external mcpServers format maps autoConnect=false into internal server config", async () => {
  previousStateDir = process.env.BELLDANDY_STATE_DIR;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-config-"));
  process.env.BELLDANDY_STATE_DIR = stateDir;

  try {
    await fs.writeFile(
      path.join(stateDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          starweaver: {
            command: "node",
            args: ["host/mcpSouthboundHost.ts"],
            autoConnect: false,
          },
          "starweaver-central": {
            url: "http://127.0.0.1:28767/sse",
            allowInsecureHttp: true,
            allowPrivateNetwork: true,
            headers: {
              Authorization: "Bearer test-key",
            },
          },
        },
      }, null, 2),
      "utf-8",
    );

    const configModule = await import("./config.js");
    const config = await configModule.loadConfig();
    expect(config.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "starweaver",
        enabled: true,
        autoConnect: false,
        transport: expect.objectContaining({
          type: "stdio",
          command: "node",
        }),
      }),
      expect.objectContaining({
        id: "starweaver-central",
        enabled: true,
        autoConnect: true,
        transport: expect.objectContaining({
          type: "sse",
          url: "http://127.0.0.1:28767/sse",
          allowInsecureHttp: true,
          allowPrivateNetwork: true,
        }),
      }),
    ]));

    const autoConnectServers = await configModule.getAutoConnectServers();
    expect(autoConnectServers.map((server) => server.id)).toEqual(["starweaver-central"]);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("serializes concurrent server mutations without losing config changes", async () => {
  previousStateDir = process.env.BELLDANDY_STATE_DIR;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-config-mutation-"));
  process.env.BELLDANDY_STATE_DIR = stateDir;

  try {
    await fs.writeFile(
      path.join(stateDir, "mcp.json"),
      JSON.stringify(createConfig([createServer("seed")]), null, 2),
      "utf-8",
    );
    const configModule = await import("./config.js");

    await Promise.all([
      configModule.addServer(createServer("alpha")),
      configModule.addServer(createServer("beta")),
      configModule.addServer(createServer("gamma")),
    ]);

    const config = await configModule.loadConfig();
    expect(config.servers.map((server) => server.id)).toEqual(["seed", "alpha", "beta", "gamma"]);
    expect(config.revision).toBe(3);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("keeps the last complete config when an atomic replacement fails", async () => {
  previousStateDir = process.env.BELLDANDY_STATE_DIR;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-config-atomic-"));
  process.env.BELLDANDY_STATE_DIR = stateDir;
  const configPath = path.join(stateDir, "mcp.json");
  const originalContent = `${JSON.stringify(createConfig([createServer("stable")]), null, 2)}\n`;

  try {
    await fs.writeFile(configPath, originalContent, "utf-8");
    const configModule = await import("./config.js");
    const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("locked"), {
      code: "EIO",
    }));

    await expect(configModule.saveConfig(createConfig([createServer("next")], 1))).rejects.toThrow();
    expect(renameSpy).toHaveBeenCalled();
    await expect(fs.readFile(configPath, "utf-8")).resolves.toBe(originalContent);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("uses a recoverable backup path when Windows blocks atomic replacement", async () => {
  previousStateDir = process.env.BELLDANDY_STATE_DIR;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-config-backup-"));
  process.env.BELLDANDY_STATE_DIR = stateDir;
  const configPath = path.join(stateDir, "mcp.json");
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  try {
    await fs.writeFile(configPath, `${JSON.stringify(createConfig([createServer("stable")]), null, 2)}\n`, "utf-8");
    const configModule = await import("./config.js");
    const originalRename = fs.rename.bind(fs);
    let blockedReplacements = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (sourcePath, targetPath) => {
      if (
        targetPath === configPath
        && typeof sourcePath === "string"
        && sourcePath.endsWith(".tmp")
        && blockedReplacements < 3
      ) {
        blockedReplacements += 1;
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      }
      return originalRename(sourcePath, targetPath);
    });
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

    await configModule.saveConfig(createConfig([createServer("next")], 1));

    expect(blockedReplacements).toBe(3);
    expect(renameSpy).toHaveBeenCalledTimes(5);
    await expect(configModule.loadConfig()).resolves.toMatchObject({
      revision: 1,
      servers: [expect.objectContaining({ id: "next" })],
    });
    expect((await fs.readdir(stateDir)).filter((name) => name.endsWith(".tmp") || name.endsWith(".bak"))).toEqual([]);
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("repairs private file mode before loading an existing config", async () => {
  previousStateDir = process.env.BELLDANDY_STATE_DIR;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-config-mode-"));
  process.env.BELLDANDY_STATE_DIR = stateDir;
  const configPath = path.join(stateDir, "mcp.json");

  try {
    await fs.writeFile(configPath, `${JSON.stringify(createConfig([createServer("existing")]), null, 2)}\n`, "utf-8");
    await fs.chmod(configPath, 0o644);
    const configModule = await import("./config.js");
    const chmodSpy = vi.spyOn(fs, "chmod");

    await expect(configModule.loadConfig()).resolves.toMatchObject({
      servers: [expect.objectContaining({ id: "existing" })],
    });
    expect(chmodSpy).toHaveBeenCalledWith(configPath, 0o600);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("writes private config files and rejects oversized server argument lists", async () => {
  previousStateDir = process.env.BELLDANDY_STATE_DIR;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-mcp-config-limits-"));
  process.env.BELLDANDY_STATE_DIR = stateDir;

  try {
    const configModule = await import("./config.js");
    const chmodSpy = vi.spyOn(fs, "chmod");
    await configModule.addServer(createServer("private-config"));

    if (process.platform === "win32") {
      expect(chmodSpy).toHaveBeenCalledWith(path.join(stateDir, "mcp.json"), 0o600);
    } else {
      expect((await fs.stat(path.join(stateDir, "mcp.json"))).mode & 0o777).toBe(0o600);
    }
    await expect(configModule.addServer({
      ...createServer("too-many-args"),
      transport: {
        type: "stdio",
        command: "node",
        args: Array.from({ length: 129 }, (_, index) => `arg-${index}`),
      },
    })).rejects.toThrow(/参数/);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
