import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import command, { configureClaudeCodeExecMcp } from "./bridge-claude-code-exec-mcp.js";

const tempDirs = new Set<string>();
const EXTRA_WORKSPACE_ROOTS = [
  path.resolve("E:/other-project"),
  path.resolve("D:/shared-workspace"),
];
const EXTRA_WORKSPACE_ROOT = EXTRA_WORKSPACE_ROOTS[0];

async function createTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

async function createFakeRepoRoot() {
  const repoRoot = await createTempDir("belldandy-configure-claude-bridge-repo-");
  const scriptPath = path.join(repoRoot, "packages", "belldandy-mcp", "scripts", "claude-bridge-server.mjs");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, "#!/usr/bin/env node\n", "utf-8");
  return { repoRoot, scriptPath };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("configureClaudeCodeExecMcp creates minimal mcp and bridge config from empty state dir", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-bridge-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-bridge-workspace-");
  const { repoRoot, scriptPath } = await createFakeRepoRoot();

  const result = await configureClaudeCodeExecMcp({
    stateDir,
    repoRoot,
    workspaceRoot,
    extraWorkspaceRoots: ["E:/other-project", "D:/shared-workspace"],
    claudeCommand: "claude",
    gitBashPath: "C:/Program Files/Git/bin/bash.exe",
    serverId: "claude-bridge",
    targetId: "claude_code_exec",
    fallbackTargetId: "claude_code_exec_cli",
  });

  expect(result.changed).toBe(true);
  expect(result.wrapperScriptPath).toBe(scriptPath);
  expect(result.extraWorkspaceRoots).toEqual(EXTRA_WORKSPACE_ROOTS);
  expect(result.createdFiles).toEqual([
    path.join(stateDir, "mcp.json"),
    path.join(stateDir, "agent-bridge.json"),
  ]);

  const mcpConfig = JSON.parse(await fs.readFile(path.join(stateDir, "mcp.json"), "utf-8"));
  expect(mcpConfig.servers).toEqual([
    expect.objectContaining({
      id: "claude-bridge",
      transport: expect.objectContaining({
        command: "node",
        args: expect.arrayContaining([
          scriptPath,
          "--workspace-root",
          workspaceRoot,
          "--default-cwd",
          workspaceRoot,
          "--claude-command",
          "claude",
          "--extra-workspace-root",
          EXTRA_WORKSPACE_ROOTS[0],
          "--extra-workspace-root",
          EXTRA_WORKSPACE_ROOTS[1],
          "--git-bash-path",
          "C:/Program Files/Git/bin/bash.exe",
        ]),
      }),
    }),
  ]);

  const bridgeConfig = JSON.parse(await fs.readFile(path.join(stateDir, "agent-bridge.json"), "utf-8"));
  expect(bridgeConfig.workspaceRoots).toEqual([workspaceRoot, ...EXTRA_WORKSPACE_ROOTS]);
  expect(bridgeConfig.extraWorkspaceRoots).toEqual(EXTRA_WORKSPACE_ROOTS);
  expect(bridgeConfig.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "claude_code_exec",
      transport: "mcp",
      entry: {
        mcp: {
          serverId: "claude-bridge",
          toolName: "task_once",
        },
      },
      actions: expect.objectContaining({
        analyze: expect.objectContaining({
          mcpToolName: "analyze_once",
          allowStructuredArgs: [
            "objective",
            "scope",
            "constraints",
            "expectedOutput",
            "model",
            "cwd",
          ],
        }),
        review: expect.objectContaining({
          mcpToolName: "review_once",
        }),
        patch: expect.objectContaining({
          mcpToolName: "patch_once",
        }),
        exec: expect.objectContaining({
          mcpToolName: "task_once",
          allowStructuredArgs: [
            "mode",
            "objective",
            "scope",
            "constraints",
            "expectedOutput",
            "model",
            "cwd",
          ],
        }),
      }),
    }),
    expect.objectContaining({
      id: "claude_code_exec_cli",
      transport: "exec",
      entry: {
        binary: "claude",
      },
    }),
  ]));
});

test("configureClaudeCodeExecMcp preserves unrelated servers and targets while updating claude entries", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-bridge-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-bridge-workspace-");
  const { repoRoot } = await createFakeRepoRoot();

  await fs.writeFile(path.join(stateDir, "mcp.json"), `${JSON.stringify({
    version: "1.0.0",
    servers: [
      {
        id: "existing-server",
        transport: { type: "stdio", command: "node", args: ["existing.mjs"] },
      },
      {
        id: "claude-bridge",
        transport: { type: "stdio", command: "node", args: ["old.mjs"] },
      },
    ],
    settings: {
      defaultTimeout: 30000,
      debug: false,
      toolPrefix: true,
    },
  }, null, 2)}\n`, "utf-8");
  await fs.writeFile(path.join(stateDir, "agent-bridge.json"), `${JSON.stringify({
    version: "1.0.0",
    targets: [
      {
        id: "keep-me",
        category: "agent-cli",
        transport: "exec",
        enabled: true,
        entry: { binary: "echo" },
        cwdPolicy: "workspace-only",
        sessionMode: "oneshot",
        actions: { exec: { template: ["hello"] } },
      },
      {
        id: "claude_code_exec",
        category: "agent-cli",
        transport: "exec",
        enabled: true,
        entry: { binary: "claude" },
        cwdPolicy: "workspace-only",
        sessionMode: "oneshot",
        actions: { exec: { template: ["old"] } },
      },
    ],
  }, null, 2)}\n`, "utf-8");

  const result = await configureClaudeCodeExecMcp({
    stateDir,
    repoRoot,
    workspaceRoot,
    claudeCommand: "claude.cmd",
    serverId: "claude-bridge",
    targetId: "claude_code_exec",
    fallbackTargetId: "claude_code_exec_cli",
  });

  expect(result.updatedFiles).toEqual([
    path.join(stateDir, "mcp.json"),
    path.join(stateDir, "agent-bridge.json"),
  ]);

  const mcpConfig = JSON.parse(await fs.readFile(path.join(stateDir, "mcp.json"), "utf-8"));
  expect(mcpConfig.servers).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "existing-server" }),
    expect.objectContaining({
      id: "claude-bridge",
      transport: expect.objectContaining({
        args: expect.arrayContaining(["--claude-command", "claude.cmd"]),
      }),
    }),
  ]));

  const bridgeConfig = JSON.parse(await fs.readFile(path.join(stateDir, "agent-bridge.json"), "utf-8"));
  expect(bridgeConfig.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "keep-me" }),
    expect.objectContaining({ id: "claude_code_exec", transport: "mcp" }),
    expect.objectContaining({ id: "claude_code_exec_cli", transport: "exec" }),
  ]));
});

test("configureClaudeCodeExecMcp preserves external mcpServers format", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-bridge-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-bridge-workspace-");
  const { repoRoot, scriptPath } = await createFakeRepoRoot();

  await fs.writeFile(path.join(stateDir, "mcp.json"), `${JSON.stringify({
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        autoConnect: false,
      },
      "claude-bridge": {
        command: "node",
        args: ["old-bridge.mjs"],
        autoConnect: true,
      },
    },
  }, null, 2)}\n`, "utf-8");

  const result = await configureClaudeCodeExecMcp({
    stateDir,
    repoRoot,
    workspaceRoot,
    extraWorkspaceRoots: ["E:/other-project"],
    claudeCommand: "claude.cmd",
    serverId: "claude-bridge",
    targetId: "claude_code_exec",
    fallbackTargetId: "claude_code_exec_cli",
  });

  expect(result.updatedFiles).toContain(path.join(stateDir, "mcp.json"));

  const mcpConfig = JSON.parse(await fs.readFile(path.join(stateDir, "mcp.json"), "utf-8"));
  expect(mcpConfig.mcpServers).toMatchObject({
    filesystem: {
      command: "npx",
      autoConnect: false,
    },
    "claude-bridge": {
      command: "node",
      autoConnect: true,
      args: expect.arrayContaining([
        scriptPath,
        "--workspace-root",
        workspaceRoot,
        "--default-cwd",
        workspaceRoot,
        "--extra-workspace-root",
        EXTRA_WORKSPACE_ROOT,
        "--claude-command",
        "claude.cmd",
      ]),
    },
  });
  expect(mcpConfig.servers).toBeUndefined();
});

test("claude-code-exec-mcp command prints json summary", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-bridge-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-bridge-workspace-");
  const { repoRoot } = await createFakeRepoRoot();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await command.run?.({
    args: {
      json: true,
      "state-dir": stateDir,
      "repo-root": repoRoot,
      "workspace-root": workspaceRoot,
      "claude-command": "claude",
      "git-bash-path": "C:/Program Files/Git/bin/bash.exe",
    },
  } as never);

  const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
  const parsed = JSON.parse(output);
  expect(parsed).toMatchObject({
    changed: true,
    stateDir,
    repoRoot,
    workspaceRoot,
    serverId: "claude-bridge",
    targetId: "claude_code_exec",
    fallbackTargetId: "claude_code_exec_cli",
    gitBashPath: expect.stringMatching(/Git[\\/]bin[\\/]bash\.exe$/),
  });
  expect(parsed.nextSteps).toEqual(expect.any(Array));
});
