import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import command, { configureClaudeCodeSession } from "./bridge-claude-code-session.js";

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

test("configureClaudeCodeSession creates a persistent claude bridge session target", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-session-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-session-workspace-");

  const result = await configureClaudeCodeSession({
    stateDir,
    workspaceRoot,
    extraWorkspaceRoots: ["E:/other-project", "D:/shared-workspace"],
    claudeCommand: "claude.cmd",
    gitBashPath: "C:/Program Files/Git/bin/bash.exe",
    targetId: "claude_code_session",
  });

  expect(result.changed).toBe(true);
  expect(result.extraWorkspaceRoots).toEqual([
    "E:\\other-project",
    "D:\\shared-workspace",
  ]);
  expect(result.createdFiles).toEqual([
    path.join(stateDir, "agent-bridge.json"),
  ]);

  const bridgeConfig = JSON.parse(await fs.readFile(path.join(stateDir, "agent-bridge.json"), "utf-8"));
  expect(bridgeConfig.workspaceRoots).toEqual([
    workspaceRoot,
    "E:\\other-project",
    "D:\\shared-workspace",
  ]);
  expect(bridgeConfig.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "claude_code_session",
      transport: "pty",
      sessionMode: "persistent",
      entry: {
        binary: "claude.cmd",
        env: {
          CLAUDE_CODE_GIT_BASH_PATH: expect.stringMatching(/Git[\\/]bin[\\/]bash\.exe$/),
        },
      },
      defaultCwd: workspaceRoot,
      actions: {
        interactive: expect.objectContaining({
          allowStructuredArgs: ["prompt"],
          firstTurnStrategy: "start-args-prompt",
          recommendedReadWaitMs: 2200,
          template: [
            "--dangerously-skip-permissions",
            "-p",
            "{{prompt}}",
            "--add-dir",
            "E:\\other-project",
            "--add-dir",
            "D:\\shared-workspace",
          ],
        }),
      },
    }),
  ]));
});

test("configureClaudeCodeSession preserves unrelated bridge targets", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-session-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-session-workspace-");

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
        id: "claude_code_session",
        category: "agent-cli",
        transport: "exec",
        enabled: true,
        entry: { binary: "old" },
        cwdPolicy: "workspace-only",
        sessionMode: "oneshot",
        actions: { exec: { template: ["old"] } },
      },
    ],
  }, null, 2)}\n`, "utf-8");

  const result = await configureClaudeCodeSession({
    stateDir,
    workspaceRoot,
    claudeCommand: "claude",
    targetId: "claude_code_session",
  });

  expect(result.updatedFiles).toEqual([
    path.join(stateDir, "agent-bridge.json"),
  ]);

  const bridgeConfig = JSON.parse(await fs.readFile(path.join(stateDir, "agent-bridge.json"), "utf-8"));
  expect(bridgeConfig.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "keep-me" }),
    expect.objectContaining({ id: "claude_code_session", transport: "pty" }),
  ]));
});

test("claude-code-session command prints json summary", async () => {
  const stateDir = await createTempDir("belldandy-configure-claude-session-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-claude-session-workspace-");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await command.run?.({
    args: {
      json: true,
      "state-dir": stateDir,
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
    workspaceRoot,
    targetId: "claude_code_session",
    gitBashPath: expect.stringMatching(/Git[\\/]bin[\\/]bash\.exe$/),
  });
  expect(parsed.nextSteps).toEqual(expect.any(Array));
});
