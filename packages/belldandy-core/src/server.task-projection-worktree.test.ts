import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { ConversationRunRegistry } from "./conversation-run-registry.js";
import { ManagedWorktreeRuntime } from "./managed-worktree.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  pairWebSocketClient,
  resolveWebRoot,
  waitFor,
} from "./server-testkit.js";
import { UserWorktreeRuntime } from "./user-worktree-runtime.js";

const execFile = promisify(execFileCallback);

beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = "test-placeholder-key";
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
});

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}

test("task.projection.list projects production keep/discard lifecycle without worktree internals", async () => {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-task-projection-worktree-"));
  const repoDir = path.join(rootDir, "private-source-repo");
  const stateDir = path.join(rootDir, "state");
  await fs.promises.mkdir(repoDir, { recursive: true });
  await fs.promises.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Test"], repoDir);
  await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "init"], repoDir);

  const managed = new ManagedWorktreeRuntime(stateDir);
  const keepWorktree = await managed.prepare({ id: "projection-keep", ownerKind: "user_session", cwd: repoDir });
  const discardWorktree = await managed.prepare({ id: "projection-discard", ownerKind: "user_session", cwd: repoDir });
  const worktrees = new UserWorktreeRuntime(stateDir);
  await worktrees.register(keepWorktree, { conversationId: "conversation-keep", runId: "run-shared" });
  await worktrees.register(discardWorktree, { conversationId: "conversation-discard", runId: "run-shared" });
  await fs.promises.writeFile(path.join(keepWorktree.worktreePath, "README.md"), "kept private change\n", "utf-8");

  const keepPreview = await worktrees.preview({ operation: "keep", worktreeId: keepWorktree.id });
  await expect(worktrees.confirm({
    operation: "keep",
    worktreeId: keepWorktree.id,
    receiptId: keepPreview.receipt?.receiptId ?? "",
    confirm: true,
  })).resolves.toMatchObject({ outcome: "succeeded", applied: true });
  const discardPreview = await worktrees.preview({ operation: "discard", worktreeId: discardWorktree.id });
  await expect(worktrees.confirm({
    operation: "discard",
    worktreeId: discardWorktree.id,
    receiptId: discardPreview.receipt?.receiptId ?? "",
    confirm: true,
  })).resolves.toMatchObject({ outcome: "succeeded", applied: true });

  const runs = new ConversationRunRegistry();
  for (const conversationId of ["conversation-keep", "conversation-discard"]) {
    runs.register({
      conversationId,
      runId: "run-shared",
      startedAt: Date.now(),
      state: "running",
      stop: () => true,
    });
  }

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    conversationRunRegistry: runs,
    userWorktreeRuntime: worktrees,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const frames: any[] = [];
  const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

  try {
    await pairWebSocketClient(ws, frames, stateDir);
    frames.length = 0;
    ws.send(JSON.stringify({
      type: "req",
      id: "task-projection-worktree-lifecycle",
      method: "task.projection.list",
      params: {},
    }));
    await waitFor(() => frames.some((frame) =>
      frame.type === "res" && frame.id === "task-projection-worktree-lifecycle"));

    const response = frames.find((frame) =>
      frame.type === "res" && frame.id === "task-projection-worktree-lifecycle");
    expect(response).toMatchObject({ ok: true, payload: { totalCount: 2 } });
    const items = response.payload.items as Array<Record<string, any>>;
    expect(items.find((item) => item.taskId === "conversation:conversation-keep:run-shared")).toMatchObject({
      status: "running",
      supportingEvidence: { worktree: { status: "dirty", lifecycle: "kept", observedAtMs: expect.any(Number) } },
    });
    expect(items.find((item) => item.taskId === "conversation:conversation-discard:run-shared")).toMatchObject({
      status: "running",
      supportingEvidence: { worktree: { status: "missing", lifecycle: "discarded", observedAtMs: expect.any(Number) } },
    });
    expect(JSON.stringify(response)).not.toMatch(
      /ownerBindingHash|receiptId|private-source-repo|projection-keep|projection-discard|belldandy-projection|kept private change/,
    );
  } finally {
    ws.close();
    await closeP;
    runs.markStopped("conversation-keep", "run-shared", "test_complete");
    runs.markStopped("conversation-discard", "run-shared", "test_complete");
    await server.close();
    await fs.promises.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}, 20_000);
