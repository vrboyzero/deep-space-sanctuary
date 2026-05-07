import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

let previousStateDir = process.env.BELLDANDY_STATE_DIR;

afterEach(async () => {
  vi.resetModules();
  if (previousStateDir === undefined) {
    delete process.env.BELLDANDY_STATE_DIR;
  } else {
    process.env.BELLDANDY_STATE_DIR = previousStateDir;
  }
});

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
        }),
      }),
    ]));

    const autoConnectServers = await configModule.getAutoConnectServers();
    expect(autoConnectServers.map((server) => server.id)).toEqual(["starweaver-central"]);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});
