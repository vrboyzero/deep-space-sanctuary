import { execFile as execFileCallback, fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RemoteDeliveryRuntime,
  type PullRequestClient,
  type PullRequestRecord,
} from "./remote-delivery-runtime.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("remote delivery push process crash recovery", () => {
  it("reopens a started push as uncertain without mutating the remote ref", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "started");

    await waitForPhase(child, "started");
    await forceTerminate(child);
    expect(await remoteMain(fixture)).toBe(fixture.initialCommit);
    const replayMarker = await installRejectingReceiveHook(fixture);

    const restarted = createRuntime(fixture);
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      operation: "push",
      outcome: "uncertain",
      applied: false,
      blockers: ["operation_status_uncertain"],
      audit: { status: "uncertain", reasonCodes: ["operation_status_uncertain"] },
    });
    expect(await remoteMain(fixture)).toBe(fixture.initialCommit);
    await expect(fs.access(replayMarker)).rejects.toThrow();
  }, 20_000);

  it("reconciles an exact remote ref without replaying push when completion audit was lost", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "pushed");

    await waitForPhase(child, "pushed");
    await forceTerminate(child);
    expect(await remoteMain(fixture)).toBe(fixture.localCommit);
    const replayMarker = await installRejectingReceiveHook(fixture);

    const restarted = createRuntime(fixture);
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      operation: "push",
      outcome: "succeeded",
      applied: true,
      blockers: [],
      postcondition: { remoteOid: fixture.localCommit },
      audit: { status: "succeeded" },
    });
    await expect(restarted.confirm(confirmInput(fixture))).resolves.toMatchObject({
      outcome: "succeeded",
      applied: true,
      postcondition: { remoteOid: fixture.localCommit },
      audit: { status: "succeeded" },
    });
    expect(await remoteMain(fixture)).toBe(fixture.localCommit);
    await expect(fs.access(replayMarker)).rejects.toThrow();
    const auditEntries = await fs.readdir(path.join(fixture.stateDir, "remote-delivery", "audit"));
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatch(/\.json$/);
  }, 20_000);
});

describe("remote delivery pull request process crash recovery", () => {
  it("reopens a started pull request as uncertain without creating it", async () => {
    const fixture = await createPullRequestFixture();
    const child = startPullRequestCrashChild(fixture, "started");

    await waitForPhase(child, "started");
    await forceTerminate(child);
    expect(await readPullRequest(fixture)).toBeUndefined();

    const restarted = createPullRequestRuntime(fixture);
    await expect(restarted.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
      operation: "pull_request",
      outcome: "uncertain",
      applied: false,
      blockers: ["operation_status_uncertain"],
      audit: { status: "uncertain", reasonCodes: ["operation_status_uncertain"] },
    });
    expect(await readPullRequest(fixture)).toBeUndefined();
    expect(await readPullRequestCreateCount(fixture)).toBe(0);
  }, 20_000);

  it("reconciles an exact open pull request without creating a duplicate when completion audit was lost", async () => {
    const fixture = await createPullRequestFixture();
    const child = startPullRequestCrashChild(fixture, "created");

    await waitForPhase(child, "created");
    await forceTerminate(child);
    expect(await readPullRequest(fixture)).toMatchObject({
      number: 41,
      state: "OPEN",
      headCommit: fixture.localCommit,
    });
    expect(await readPullRequestCreateCount(fixture)).toBe(1);

    const restarted = createPullRequestRuntime(fixture);
    await expect(restarted.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
      operation: "pull_request",
      outcome: "succeeded",
      applied: true,
      blockers: [],
      postcondition: {
        remoteOid: fixture.localCommit,
        pullRequestNumber: 41,
        pullRequestState: "OPEN",
      },
      audit: { status: "succeeded", pullRequestNumber: 41 },
    });
    await expect(restarted.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
      outcome: "succeeded",
      applied: true,
      postcondition: { pullRequestNumber: 41, pullRequestState: "OPEN" },
      audit: { status: "succeeded", pullRequestNumber: 41 },
    });
    expect(await readPullRequestCreateCount(fixture)).toBe(1);
    const auditEntries = await fs.readdir(path.join(fixture.stateDir, "remote-delivery", "audit"));
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatch(/\.json$/);
  }, 20_000);

  it("recovers a PR completion audit ENOSPC only from an exact open record without creating twice", async () => {
    const fixture = await createPullRequestFixture();
    const runtime = createPullRequestRuntime(fixture);
    const originalRename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      if (String(newPath).includes(path.join("remote-delivery", "audit"))) {
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      }
      await originalRename(oldPath, newPath);
    });
    try {
      await expect(runtime.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
        operation: "pull_request",
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: {
          remoteOid: fixture.localCommit,
          pullRequestNumber: 41,
          pullRequestState: "OPEN",
        },
        audit: { status: "started" },
      });
    } finally {
      renameSpy.mockRestore();
    }
    const exactPullRequest = await readPullRequest(fixture);
    expect(exactPullRequest).toMatchObject({ headCommit: fixture.localCommit });
    expect(await readPullRequestCreateCount(fixture)).toBe(1);

    await fs.writeFile(fixture.pullRequestPath, `${JSON.stringify({
      ...exactPullRequest,
      headCommit: fixture.initialCommit,
    })}\n`, "utf-8");
    const restarted = createPullRequestRuntime(fixture);
    await expect(restarted.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
      operation: "pull_request",
      outcome: "uncertain",
      applied: false,
      blockers: ["operation_status_uncertain"],
      audit: { status: "uncertain", reasonCodes: ["operation_status_uncertain"] },
    });
    expect(await readPullRequestCreateCount(fixture)).toBe(1);

    await fs.writeFile(fixture.pullRequestPath, `${JSON.stringify(exactPullRequest)}\n`, "utf-8");
    await expect(restarted.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
      operation: "pull_request",
      outcome: "succeeded",
      applied: true,
      blockers: [],
      postcondition: {
        remoteOid: fixture.localCommit,
        pullRequestNumber: 41,
        pullRequestState: "OPEN",
      },
      audit: { status: "succeeded", pullRequestNumber: 41 },
    });
    await expect(restarted.confirm(pullRequestConfirmInput(fixture))).resolves.toMatchObject({
      outcome: "succeeded",
      applied: true,
      audit: { status: "succeeded", pullRequestNumber: 41 },
    });
    expect(await readPullRequestCreateCount(fixture)).toBe(1);
    const auditEntries = await fs.readdir(path.join(fixture.stateDir, "remote-delivery", "audit"));
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatch(/\.json$/);
  }, 20_000);
});

type CrashPhase = "started" | "pushed";

type Fixture = {
  rootDir: string;
  stateDir: string;
  repoDir: string;
  remoteDir: string;
  receiptId: string;
  initialCommit: string;
  localCommit: string;
};

type PullRequestCrashPhase = "started" | "created";

type PullRequestFixture = Fixture & {
  pullRequestPath: string;
  createLogPath: string;
  title: string;
  body: string;
};

async function createFixture(): Promise<Fixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-remote-push-crash-"));
  const repoDir = path.join(rootDir, "repo");
  const remoteDir = path.join(rootDir, "remote.git");
  const stateDir = path.join(rootDir, "state");
  await fs.mkdir(repoDir, { recursive: true });
  await runGit(["init", "--bare", remoteDir], rootDir);
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Test"], repoDir);
  await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
  await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "initial"], repoDir);
  await runGit(["branch", "-M", "main"], repoDir);
  await runGit(["remote", "add", "private", remoteDir], repoDir);
  await runGit(["push", "private", "main"], repoDir);
  const initialCommit = await runGit(["rev-parse", "HEAD"], repoDir);
  await fs.writeFile(path.join(repoDir, "README.md"), "changed\n", "utf-8");
  await runGit(["add", "README.md"], repoDir);
  await runGit(["commit", "-m", "change"], repoDir);
  const localCommit = await runGit(["rev-parse", "HEAD"], repoDir);

  const fixture = { rootDir, stateDir, repoDir, remoteDir, receiptId: "", initialCommit, localCommit };
  const preview = await createRuntime(fixture).previewPush({
    cwd: repoDir,
    remote: "private",
    targetBranch: "main",
  });
  if (!preview.receipt) throw new Error(`Remote push preview failed: ${preview.blockers.join(",")}`);
  temporaryDirectories.push(rootDir);
  return { ...fixture, receiptId: preview.receipt.receiptId };
}

async function createPullRequestFixture(): Promise<PullRequestFixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-remote-pr-crash-"));
  const repoDir = path.join(rootDir, "repo");
  const remoteDir = path.join(rootDir, "remote.git");
  const stateDir = path.join(rootDir, "state");
  const pullRequestPath = path.join(rootDir, "pull-request.json");
  const createLogPath = path.join(rootDir, "pull-request-create.log");
  const title = "feat: process crash recovery";
  const body = "private process crash body";
  await fs.mkdir(repoDir, { recursive: true });
  await runGit(["init", "--bare", remoteDir], rootDir);
  await runGit(["init"], repoDir);
  await runGit(["config", "user.name", "Belldandy Test"], repoDir);
  await runGit(["config", "user.email", "belldandy@example.com"], repoDir);
  await fs.writeFile(path.join(repoDir, "README.md"), "initial\n", "utf-8");
  await runGit(["add", "."], repoDir);
  await runGit(["commit", "-m", "initial"], repoDir);
  await runGit(["branch", "-M", "main"], repoDir);
  await runGit(["remote", "add", "private", remoteDir], repoDir);
  await runGit(["push", "private", "main"], repoDir);
  const initialCommit = await runGit(["rev-parse", "HEAD"], repoDir);
  await runGit(["checkout", "-b", "feature/process-crash"], repoDir);
  await fs.writeFile(path.join(repoDir, "README.md"), "pull request\n", "utf-8");
  await runGit(["add", "README.md"], repoDir);
  await runGit(["commit", "-m", "pull request"], repoDir);
  const localCommit = await runGit(["rev-parse", "HEAD"], repoDir);
  await runGit(["push", "private", "feature/process-crash"], repoDir);

  const fixture: PullRequestFixture = {
    rootDir,
    stateDir,
    repoDir,
    remoteDir,
    receiptId: "",
    initialCommit,
    localCommit,
    pullRequestPath,
    createLogPath,
    title,
    body,
  };
  const preview = await createPullRequestRuntime(fixture).previewPullRequest({
    cwd: repoDir,
    remote: "private",
    headBranch: "feature/process-crash",
    baseBranch: "main",
    title,
    body,
  });
  if (!preview.receipt) throw new Error(`Remote pull request preview failed: ${preview.blockers.join(",")}`);
  temporaryDirectories.push(rootDir);
  return { ...fixture, receiptId: preview.receipt.receiptId };
}

function createRuntime(fixture: Pick<Fixture, "stateDir" | "remoteDir">): RemoteDeliveryRuntime {
  return new RemoteDeliveryRuntime({
    stateDir: fixture.stateDir,
    targets: [{ remote: "private", url: fixture.remoteDir, pushBranches: ["main"] }],
  });
}

function createPullRequestRuntime(fixture: PullRequestFixture): RemoteDeliveryRuntime {
  return new RemoteDeliveryRuntime({
    stateDir: fixture.stateDir,
    targets: [{
      remote: "private",
      url: fixture.remoteDir,
      pushBranches: ["feature/process-crash"],
      pullRequestBases: ["main"],
      repository: "vrboyzero/deep-space-sanctuary",
    }],
    pullRequests: new FilePullRequestClient(fixture.pullRequestPath, fixture.createLogPath),
  });
}

function confirmInput(fixture: Fixture) {
  return {
    operation: "push" as const,
    receiptId: fixture.receiptId,
    confirm: true as const,
  };
}

function pullRequestConfirmInput(fixture: PullRequestFixture) {
  return {
    operation: "pull_request" as const,
    receiptId: fixture.receiptId,
    confirm: true as const,
    title: fixture.title,
    body: fixture.body,
  };
}

function startCrashChild(fixture: Fixture, phase: CrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/remote-delivery-push-crash-child.mjs", import.meta.url)),
    [fixture.stateDir, fixture.remoteDir, fixture.receiptId, phase],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function startPullRequestCrashChild(fixture: PullRequestFixture, phase: PullRequestCrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/remote-delivery-pr-crash-child.mjs", import.meta.url)),
    [
      fixture.stateDir,
      fixture.remoteDir,
      fixture.receiptId,
      fixture.pullRequestPath,
      fixture.createLogPath,
      fixture.title,
      fixture.body,
      phase,
    ],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: CrashPhase | PullRequestCrashPhase): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Remote delivery crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 10_000);
    timer.unref?.();

    const onMessage = (message: { type?: string; message?: string }) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Remote delivery crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
        return;
      }
      if (message?.type !== phase) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Remote delivery crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
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

async function installRejectingReceiveHook(fixture: Fixture): Promise<string> {
  const markerPath = path.join(fixture.remoteDir, "push-replayed.txt");
  const hookPath = path.join(fixture.remoteDir, "hooks", "pre-receive");
  const markerForShell = markerPath.replace(/\\/g, "/").replace(/'/g, "'\\''");
  await fs.writeFile(
    hookPath,
    `#!/bin/sh\nprintf replayed > '${markerForShell}'\nexit 73\n`,
    { encoding: "utf-8", mode: 0o755 },
  );
  return markerPath;
}

async function remoteMain(fixture: Fixture): Promise<string> {
  return runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir);
}

class FilePullRequestClient implements PullRequestClient {
  constructor(
    private readonly pullRequestPath: string,
    private readonly createLogPath: string,
  ) {}

  async findOpen(input: Parameters<PullRequestClient["findOpen"]>[0]): Promise<PullRequestRecord | undefined> {
    const record = await this.read();
    return record?.state === "OPEN"
      && record.repository === input.repository
      && record.headBranch === input.headBranch
      && record.baseBranch === input.baseBranch
      ? record
      : undefined;
  }

  async create(input: Parameters<PullRequestClient["create"]>[0]): Promise<PullRequestRecord> {
    await fs.appendFile(this.createLogPath, "create\n", "utf-8");
    const record: PullRequestRecord = {
      number: 41,
      url: "https://github.com/vrboyzero/deep-space-sanctuary/pull/41",
      state: "OPEN",
      repository: input.repository,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      headCommit: input.headCommit,
    };
    await fs.writeFile(this.pullRequestPath, `${JSON.stringify(record)}\n`, { encoding: "utf-8", flag: "wx" });
    return record;
  }

  async get(input: Parameters<PullRequestClient["get"]>[0]): Promise<PullRequestRecord | undefined> {
    const record = await this.read();
    return record?.repository === input.repository && record.number === input.number ? record : undefined;
  }

  private async read(): Promise<PullRequestRecord | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.pullRequestPath, "utf-8")) as PullRequestRecord;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    }
  }
}

async function readPullRequest(fixture: PullRequestFixture): Promise<PullRequestRecord | undefined> {
  return new FilePullRequestClient(fixture.pullRequestPath, fixture.createLogPath).findOpen({
    repository: "vrboyzero/deep-space-sanctuary",
    headBranch: "feature/process-crash",
    baseBranch: "main",
  });
}

async function readPullRequestCreateCount(fixture: PullRequestFixture): Promise<number> {
  try {
    return (await fs.readFile(fixture.createLogPath, "utf-8")).split("\n").filter(Boolean).length;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return 0;
    throw error;
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
    },
  });
  return String(stdout ?? "").trim();
}
