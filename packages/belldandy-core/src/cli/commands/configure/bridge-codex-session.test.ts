import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import command, { configureCodexSession } from "./bridge-codex-session.js";

const tempDirs = new Set<string>();
const EXTRA_WORKSPACE_ROOTS = [
  path.resolve("E:/other-project"),
  path.resolve("D:/shared-workspace"),
];

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

test("configureCodexSession creates a persistent codex bridge session target", async () => {
  const stateDir = await createTempDir("belldandy-configure-codex-session-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-codex-session-workspace-");

  const result = await configureCodexSession({
    stateDir,
    workspaceRoot,
    extraWorkspaceRoots: ["E:/other-project", "D:/shared-workspace"],
    codexCommand: "codex.cmd",
    targetId: "codex_session",
  });

  expect(result.changed).toBe(true);
  expect(result.extraWorkspaceRoots).toEqual(EXTRA_WORKSPACE_ROOTS);
  expect(result.createdFiles).toEqual([
    path.join(stateDir, "agent-bridge.json"),
  ]);

  const bridgeConfig = JSON.parse(await fs.readFile(path.join(stateDir, "agent-bridge.json"), "utf-8"));
  expect(bridgeConfig.workspaceRoots).toEqual([workspaceRoot, ...EXTRA_WORKSPACE_ROOTS]);
  expect(bridgeConfig.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "codex_session",
      transport: "pty",
      sessionMode: "persistent",
      entry: {
        binary: "codex.cmd",
      },
      defaultCwd: workspaceRoot,
      actions: {
        interactive: expect.objectContaining({
          allowStructuredArgs: ["prompt"],
          firstTurnStrategy: "start-args-prompt",
          recommendedReadWaitMs: 10_000,
          template: [
            "--sandbox",
            "workspace-write",
            "--add-dir",
            EXTRA_WORKSPACE_ROOTS[0],
            "--add-dir",
            EXTRA_WORKSPACE_ROOTS[1],
          ],
        }),
      },
    }),
  ]));
});

test("configureCodexSession preserves unrelated bridge targets", async () => {
  const stateDir = await createTempDir("belldandy-configure-codex-session-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-codex-session-workspace-");

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
        id: "codex_session",
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

  const result = await configureCodexSession({
    stateDir,
    workspaceRoot,
    codexCommand: "codex",
    targetId: "codex_session",
  });

  expect(result.updatedFiles).toEqual([
    path.join(stateDir, "agent-bridge.json"),
  ]);

  const bridgeConfig = JSON.parse(await fs.readFile(path.join(stateDir, "agent-bridge.json"), "utf-8"));
  expect(bridgeConfig.targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "keep-me" }),
    expect.objectContaining({ id: "codex_session", transport: "pty" }),
  ]));
});

test("codex-session command prints json summary", async () => {
  const stateDir = await createTempDir("belldandy-configure-codex-session-state-");
  const workspaceRoot = await createTempDir("belldandy-configure-codex-session-workspace-");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await command.run?.({
    args: {
      json: true,
      "state-dir": stateDir,
      "workspace-root": workspaceRoot,
      "codex-command": "codex",
    },
  } as never);

  const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
  const parsed = JSON.parse(output);
  expect(parsed).toMatchObject({
    changed: true,
    stateDir,
    workspaceRoot,
    targetId: "codex_session",
  });
  expect(parsed.nextSteps).toEqual(expect.any(Array));
});
