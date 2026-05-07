import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import command, { configureStarweaverCentral } from "./bridge-starweaver-central.js";

const tempDirs = new Set<string>();

async function createTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("configureStarweaverCentral creates recommended local fallback and central SSE template", async () => {
  const stateDir = await createTempDir("belldandy-configure-starweaver-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-starweaver-workspace-");

  const result = await configureStarweaverCentral({
    stateDir,
    workspaceRoot,
    centralUrl: "http://127.0.0.1:28767/sse",
    authorizationHeader: "Bearer replace-with-your-sse-api-key",
    localServerId: "starweaver",
    centralServerId: "starweaver-central",
  });

  expect(result.changed).toBe(true);
  expect(result.createdFiles).toEqual([path.join(stateDir, "mcp.json")]);

  const mcpConfig = JSON.parse(await fs.readFile(path.join(stateDir, "mcp.json"), "utf-8"));
  expect(mcpConfig.mcpServers).toMatchObject({
    starweaver: {
      command: "node",
      autoConnect: false,
      type: "stdio",
    },
    "starweaver-central": {
      url: "http://127.0.0.1:28767/sse",
      autoConnect: true,
      headers: {
        Authorization: "Bearer replace-with-your-sse-api-key",
      },
    },
  });
  expect(mcpConfig.mcpServers.starweaver.args).toEqual([
    "--import",
    "tsx",
    path.join(workspaceRoot, "Star_Weaver_Engine", "host", "mcpSouthboundHost.ts"),
  ]);
});

test("configureStarweaverCentral preserves unrelated MCP entries while updating starweaver routing", async () => {
  const stateDir = await createTempDir("belldandy-configure-starweaver-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-starweaver-workspace-");

  await fs.writeFile(path.join(stateDir, "mcp.json"), `${JSON.stringify({
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
      },
      starweaver: {
        command: "node",
        args: ["old-entry.js"],
        autoConnect: true,
      },
    },
  }, null, 2)}\n`, "utf-8");

  const result = await configureStarweaverCentral({
    stateDir,
    workspaceRoot,
    centralUrl: "http://127.0.0.1:28767/sse",
    authorizationHeader: "Bearer test-key",
    localServerId: "starweaver",
    centralServerId: "starweaver-central",
  });

  expect(result.updatedFiles).toEqual([path.join(stateDir, "mcp.json")]);

  const mcpConfig = JSON.parse(await fs.readFile(path.join(stateDir, "mcp.json"), "utf-8"));
  expect(mcpConfig.mcpServers.filesystem).toMatchObject({
    command: "npx",
  });
  expect(mcpConfig.mcpServers.starweaver).toMatchObject({
    autoConnect: false,
    type: "stdio",
  });
  expect(mcpConfig.mcpServers["starweaver-central"]).toMatchObject({
    url: "http://127.0.0.1:28767/sse",
    autoConnect: true,
    headers: {
      Authorization: "Bearer test-key",
    },
  });
});

test("starweaver-central command prints json summary", async () => {
  const stateDir = await createTempDir("belldandy-configure-starweaver-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-starweaver-workspace-");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await command.run?.({
    args: {
      json: true,
      "state-dir": stateDir,
      "workspace-root": workspaceRoot,
      "central-url": "http://127.0.0.1:28767/sse",
      "authorization-header": "Bearer replace-with-your-sse-api-key",
    },
  } as never);

  const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
  const parsed = JSON.parse(output);
  expect(parsed).toMatchObject({
    changed: true,
    stateDir,
    workspaceRoot,
    localServerId: "starweaver",
    centralServerId: "starweaver-central",
    centralUrl: "http://127.0.0.1:28767/sse",
  });
  expect(parsed.nextSteps).toEqual(expect.any(Array));
});
