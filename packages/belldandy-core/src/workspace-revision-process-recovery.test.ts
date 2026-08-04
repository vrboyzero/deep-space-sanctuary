import crypto from "node:crypto";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodingRunReconciliationJournal } from "./coding-run/reconciliation-journal.js";
import { WorkspaceRevisionRuntime } from "./workspace-revision.js";

const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("workspace mutation process crash recovery", () => {
  it("reopens a prepared file mutation as uncertain without replaying it", async () => {
    const fixture = await createFixture();
    const operationId = createOperationId(fixture);
    const child = startCrashChild(fixture, "prepared");

    await waitForPhase(child, "prepared");
    await forceTerminate(child);

    const { evidence, reconciliation } = await reopen(fixture, operationId);
    expect(evidence).toMatchObject({
      operationId,
      state: "prepared",
      workspaceCount: 1,
      targetCount: 1,
      committedTargetCount: 0,
    });
    expect(reconciliation).toMatchObject({
      state: "uncertain",
      appliedOperationCount: 0,
      uncertainOperationCount: 1,
      operations: [{
        operationId,
        toolName: "file_write",
        state: "uncertain",
        evidence: "workspace_mutation_incomplete",
      }],
    });
    await expect(fs.access(path.join(fixture.workspaceRoot, "durable.txt"))).rejects.toThrow();
    await expectReplayRejected(fixture);
  });

  it("reopens a committed file mutation as applied when journal completion was lost", async () => {
    const fixture = await createFixture();
    const operationId = createOperationId(fixture);
    const child = startCrashChild(fixture, "committed");

    await waitForPhase(child, "committed");
    await forceTerminate(child);

    const { evidence, reconciliation } = await reopen(fixture, operationId);
    expect(evidence).toMatchObject({
      operationId,
      state: "committed",
      workspaceCount: 1,
      targetCount: 1,
      committedTargetCount: 1,
    });
    expect(reconciliation).toMatchObject({
      state: "applied",
      appliedOperationCount: 1,
      uncertainOperationCount: 0,
      operations: [{
        operationId,
        toolName: "file_write",
        state: "applied",
        startedSeq: 2,
        evidence: "workspace_mutation_committed",
      }],
    });
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "durable.txt"), "utf-8"))
      .resolves.toBe("written-once");
    await expectReplayRejected(fixture);
    await expect(fs.readFile(path.join(fixture.workspaceRoot, "durable.txt"), "utf-8"))
      .resolves.toBe("written-once");
  });
});

type CrashPhase = "prepared" | "committed";

type Fixture = {
  rootDir: string;
  stateDir: string;
  workspaceRoot: string;
  conversationId: string;
  agentRunId: string;
  toolCallId: string;
};

async function createFixture(): Promise<Fixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-workspace-crash-"));
  const stateDir = path.join(rootDir, "state");
  const workspaceRoot = path.join(rootDir, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  temporaryDirectories.push(rootDir);
  return {
    rootDir,
    stateDir,
    workspaceRoot,
    conversationId: "conversation-workspace-crash",
    agentRunId: `run-workspace-crash-${crypto.randomUUID()}`,
    toolCallId: "tool-call-workspace-crash",
  };
}

function createOperationId(fixture: Fixture): string {
  return `op_${crypto.createHash("sha256")
    .update(`conversation\0${fixture.conversationId}\0${fixture.agentRunId}\0${fixture.toolCallId}`)
    .digest("hex")}`;
}

function startCrashChild(fixture: Fixture, phase: CrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/workspace-revision-crash-child.mjs", import.meta.url)),
    [
      fixture.stateDir,
      fixture.workspaceRoot,
      phase,
      fixture.conversationId,
      fixture.agentRunId,
      fixture.toolCallId,
    ],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: CrashPhase): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Workspace crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 10_000);
    timer.unref?.();

    const onMessage = (message: { type?: string; message?: string }) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Workspace crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
        return;
      }
      if (message?.type !== phase) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Workspace crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function forceTerminate(child: ChildProcess): Promise<void> {
  if (!children.delete(child) || child.exitCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32" && typeof child.pid === "number") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await once(killer, "exit");
  } else {
    child.kill("SIGKILL");
  }
  await exited;
}

async function reopen(fixture: Fixture, operationId: string) {
  const workspaceRevisionRuntime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
  const journal = new CodingRunReconciliationJournal(fixture.stateDir, {
    workspaceMutationEvidenceStore: workspaceRevisionRuntime,
  });
  const evidence = await workspaceRevisionRuntime.getOperationEvidence({
    revisionId: fixture.agentRunId,
    operationId,
  });
  const reconciliation = await journal.reconcile({
    conversationId: fixture.conversationId,
    agentRunId: fixture.agentRunId,
  });
  return { evidence, reconciliation };
}

async function expectReplayRejected(fixture: Fixture): Promise<void> {
  const runtime = new WorkspaceRevisionRuntime({ stateDir: fixture.stateDir });
  await expect(runtime.prepareMutations({
    revisionId: fixture.agentRunId,
    workspaceRoot: fixture.workspaceRoot,
    toolName: "file_write",
    targets: [{
      absolutePath: path.join(fixture.workspaceRoot, "durable.txt"),
      relativePath: "durable.txt",
    }],
    operation: {
      conversationId: fixture.conversationId,
      agentRunId: fixture.agentRunId,
      toolCallId: fixture.toolCallId,
    },
  })).rejects.toThrow("automatic replay is forbidden");
}
