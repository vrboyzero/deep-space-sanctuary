import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  RemoteDeliveryRuntime,
  parseRemoteDeliveryTargets,
  type PullRequestClient,
  type PullRequestRecord,
} from "./remote-delivery-runtime.js";

const execFile = promisify(execFileCallback);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  });
  return String(stdout ?? "").trim();
}

async function createFixture(prefix: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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
  return { rootDir, repoDir, remoteDir, stateDir, initialCommit };
}

function createRuntime(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  pullRequests?: PullRequestClient,
  persistAudit?: (audit: { status: string }) => Promise<void>,
  pushCommit?: (input: {
    repoRoot: string;
    remote: string;
    targetBranch: string;
    localCommit: string;
  }) => Promise<void>,
) {
  return new RemoteDeliveryRuntime({
    stateDir: fixture.stateDir,
    targets: [{
      remote: "private",
      url: fixture.remoteDir,
      pushBranches: ["main", "feature/exact"],
      pullRequestBases: ["main"],
      repository: "vrboyzero/deep-space-sanctuary",
    }],
    pullRequests,
    persistAudit,
    pushCommit,
  });
}

async function commitReadme(repoDir: string, value: string, message: string): Promise<string> {
  await fs.writeFile(path.join(repoDir, "README.md"), `${value}\n`, "utf-8");
  await runGit(["add", "README.md"], repoDir);
  await runGit(["commit", "-m", message], repoDir);
  return runGit(["rev-parse", "HEAD"], repoDir);
}

class MemoryPullRequestClient implements PullRequestClient {
  readonly created: Array<{
    repository: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }> = [];

  private record?: PullRequestRecord;

  async findOpen(): Promise<PullRequestRecord | undefined> {
    return this.record;
  }

  async create(input: {
    repository: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    headCommit: string;
  }): Promise<PullRequestRecord> {
    this.created.push(input);
    this.record = {
      number: 17,
      url: "https://github.com/vrboyzero/deep-space-sanctuary/pull/17",
      state: "OPEN",
      repository: input.repository,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
      headCommit: input.headCommit,
    };
    return this.record;
  }

  async get(): Promise<PullRequestRecord | undefined> {
    return this.record;
  }
}

class CreateThenThrowPullRequestClient extends MemoryPullRequestClient {
  override async create(input: Parameters<PullRequestClient["create"]>[0]): Promise<PullRequestRecord> {
    await super.create(input);
    throw new Error("response lost after create");
  }
}

describe("RemoteDeliveryRuntime", () => {
  it("fails closed for credentialed, ambiguous, or cross-repository target policy", () => {
    expect(parseRemoteDeliveryTargets(JSON.stringify([{
      remote: "private",
      url: "https://user:secret@github.com/example/private.git",
      pushBranches: ["main"],
    }]))).toEqual([]);
    expect(parseRemoteDeliveryTargets(JSON.stringify([{
      remote: "private",
      url: "https://github.com/example/private.git",
      pushBranches: ["main"],
      repository: "example/other",
    }]))).toEqual([]);
    expect(parseRemoteDeliveryTargets(JSON.stringify([{
      remote: "private",
      url: "https://github.com/example/private.git",
      pushBranches: ["main"],
    }, {
      remote: "private",
      url: "https://github.com/example/private.git",
      pushBranches: ["main"],
    }]))).toEqual([]);
  });

  it("pushes only the previewed commit to the exact allowlisted ref and verifies the remote postcondition", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-push-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "changed", "change");
      const runtime = createRuntime(fixture);

      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });
      expect(preview).toMatchObject({
        operation: "push",
        canConfirm: true,
        approval: { mode: "user_interaction", delegable: false, rememberable: false },
        source: { branch: "main", commit: localCommit, upstream: null },
        target: {
          remote: "private",
          branch: "main",
          expectedOid: fixture.initialCommit,
        },
        diff: { sha256: expect.any(String), byteLength: expect.any(Number) },
        receipt: { receiptId: expect.any(String), expiresAtMs: expect.any(Number) },
      });
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(fixture.initialCommit);

      const result = await runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(result).toMatchObject({
        applied: true,
        postcondition: { remoteOid: localCommit },
        audit: { status: "succeeded", targetBranch: "main" },
      });
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(localCommit);
      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: { remoteOid: localCommit },
        audit: { status: "succeeded" },
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("never executes a repository pre-push hook during an approved remote write", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-hook-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "changed", "change");
      const hookPath = path.join(fixture.repoDir, ".git", "hooks", "pre-push");
      const hookMarkerPath = path.join(fixture.repoDir, "hook-invoked.txt");
      await fs.writeFile(hookPath, "#!/bin/sh\nprintf invoked > hook-invoked.txt\nexit 42\n", { mode: 0o755 });
      const runtime = createRuntime(fixture);

      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });
      expect(preview.canConfirm).toBe(true);

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        applied: true,
        postcondition: { remoteOid: localCommit },
        audit: { status: "succeeded" },
      });
      await expect(fs.stat(hookMarkerPath)).rejects.toThrow();
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(localCommit);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("does not attempt a push when the started audit hits ENOSPC", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-start-audit-enospc-");
    try {
      await commitReadme(fixture.repoDir, "changed", "change");
      const pushCommit = vi.fn(async () => {});
      const runtime = createRuntime(fixture, undefined, undefined, pushCommit);
      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });
      const originalWriteFile = fs.writeFile.bind(fs);
      const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
        if (String(file).includes(path.join("remote-delivery", "audit"))) {
          throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
        }
        await originalWriteFile(file, data, options);
      });
      try {
        await expect(runtime.confirm({
          operation: "push",
          receiptId: preview.receipt?.receiptId ?? "",
          confirm: true,
        })).resolves.toEqual({
          operation: "push",
          outcome: "failed",
          applied: false,
          blockers: ["audit_unavailable"],
        });
      } finally {
        writeFileSpy.mockRestore();
      }

      expect(pushCommit).not.toHaveBeenCalled();
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(fixture.initialCommit);
      await expect(runtime.listAudit()).resolves.toEqual([]);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("reports an applied push as uncertain when the completion audit cannot be persisted", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-push-audit-failure-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "changed", "change");
      const persistedStatuses: string[] = [];
      const runtime = createRuntime(fixture, undefined, async (audit) => {
        persistedStatuses.push(audit.status);
        if (audit.status !== "started") throw new Error("audit sink unavailable");
      });
      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        operation: "push",
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: { remoteOid: localCommit },
        audit: { status: "started" },
      });
      expect(persistedStatuses).toEqual(["started", "succeeded"]);
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(localCommit);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("reconciles an applied push after restart without replaying the remote write", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-push-restart-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "changed", "change");
      const runtime = createRuntime(fixture);
      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });
      const originalRename = fs.rename.bind(fs);
      const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
        if (String(newPath).includes(path.join("remote-delivery", "audit"))) {
          throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
        }
        await originalRename(oldPath, newPath);
      });
      try {
        await expect(runtime.confirm({
          operation: "push",
          receiptId: preview.receipt?.receiptId ?? "",
          confirm: true,
        })).resolves.toMatchObject({
          outcome: "uncertain",
          applied: true,
          blockers: ["audit_persistence_failed"],
          audit: { status: "started" },
        });
      } finally {
        renameSpy.mockRestore();
      }
      const replayMarker = await installRejectingReceiveHook(fixture);

      const restarted = createRuntime(fixture);
      await expect(restarted.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        operation: "push",
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: { remoteOid: localCommit },
        audit: { status: "succeeded" },
      });
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(localCommit);
      await expect(fs.access(replayMarker)).rejects.toThrow();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("reconciles a push when the Git response is lost after the remote ref update", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-push-response-lost-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "changed", "change");
      let pushAttempts = 0;
      const runtime = createRuntime(fixture, undefined, undefined, async (input) => {
        pushAttempts += 1;
        await runGit([
          "push",
          "--porcelain",
          "--no-verify",
          input.remote,
          `${input.localCommit}:refs/heads/${input.targetBranch}`,
        ], input.repoRoot);
        throw new Error("response lost after push");
      });
      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        operation: "push",
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: { remoteOid: localCommit },
        audit: { status: "succeeded" },
      });
      expect(pushAttempts).toBe(1);
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(localCommit);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("keeps a push uncertain when Git fails before the remote ref update", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-push-failed-before-write-");
    try {
      await commitReadme(fixture.repoDir, "changed", "change");
      let pushAttempts = 0;
      const runtime = createRuntime(fixture, undefined, undefined, async () => {
        pushAttempts += 1;
        throw new Error("push transport unavailable");
      });
      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        operation: "push",
        outcome: "uncertain",
        applied: false,
        blockers: ["operation_status_uncertain"],
        audit: { status: "uncertain", reasonCodes: ["operation_status_uncertain"] },
      });
      expect(pushAttempts).toBe(1);
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(fixture.initialCommit);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("keeps a started push uncertain when the remote postcondition drifted before restart", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-push-restart-drift-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "changed", "change");
      const runtime = createRuntime(fixture);
      const preview = await runtime.previewPush({
        cwd: fixture.repoDir,
        remote: "private",
        targetBranch: "main",
      });
      const originalRename = fs.rename.bind(fs);
      const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
        if (String(newPath).includes(path.join("remote-delivery", "audit"))) {
          throw new Error("audit sink unavailable");
        }
        await originalRename(oldPath, newPath);
      });
      try {
        await runtime.confirm({
          operation: "push",
          receiptId: preview.receipt?.receiptId ?? "",
          confirm: true,
        });
      } finally {
        renameSpy.mockRestore();
      }
      await runGit([
        "push",
        "--force",
        "private",
        `${fixture.initialCommit}:refs/heads/main`,
      ], fixture.repoDir);

      const restarted = createRuntime(fixture);
      await expect(restarted.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        operation: "push",
        outcome: "uncertain",
        applied: false,
        blockers: ["operation_status_uncertain"],
        audit: { status: "uncertain", reasonCodes: ["operation_status_uncertain"] },
      });
      await expect(restarted.listAudit()).resolves.toEqual([
        expect.objectContaining({ status: "uncertain", reasonCodes: ["operation_status_uncertain"] }),
      ]);
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(fixture.initialCommit);

      await runGit(["push", "private", "main"], fixture.repoDir);
      const reconciled = await restarted.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      });
      expect(reconciled).toMatchObject({
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: { remoteOid: localCommit },
        audit: { status: "succeeded" },
      });
      expect(reconciled.audit?.reasonCodes).toBeUndefined();
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("consumes the receipt and refuses a push when local HEAD changes after preview", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-head-drift-");
    try {
      await commitReadme(fixture.repoDir, "previewed", "previewed");
      const runtime = createRuntime(fixture);
      const preview = await runtime.previewPush({ cwd: fixture.repoDir, remote: "private", targetBranch: "main" });
      await commitReadme(fixture.repoDir, "drifted", "drifted");

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        applied: false,
        blockers: expect.arrayContaining(["local_head_changed"]),
        audit: { status: "failed" },
      });
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(fixture.initialCommit);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("refuses a push when the remote ref changes after preview", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-remote-drift-");
    try {
      const localCommit = await commitReadme(fixture.repoDir, "previewed", "previewed");
      const runtime = createRuntime(fixture);
      const preview = await runtime.previewPush({ cwd: fixture.repoDir, remote: "private", targetBranch: "main" });
      await runGit(["push", "private", `${localCommit}:refs/heads/main`], fixture.repoDir);

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        applied: false,
        blockers: expect.arrayContaining(["remote_ref_changed"]),
        audit: { status: "failed" },
      });
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("creates a PR only for an already-pushed exact head and never persists title or body plaintext", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-pr-");
    try {
      await runGit(["checkout", "-b", "feature/exact"], fixture.repoDir);
      const localCommit = await commitReadme(fixture.repoDir, "feature", "feature");
      await runGit(["push", "private", "feature/exact"], fixture.repoDir);
      const pullRequests = new MemoryPullRequestClient();
      const runtime = createRuntime(fixture, pullRequests);
      const title = "feat: exact delivery";
      const body = "private body sentinel 9c814b";

      const preview = await runtime.previewPullRequest({
        cwd: fixture.repoDir,
        remote: "private",
        headBranch: "feature/exact",
        baseBranch: "main",
        title,
        body,
      });
      expect(preview).toMatchObject({
        operation: "pull_request",
        canConfirm: true,
        source: { branch: "feature/exact", commit: localCommit },
        pullRequest: {
          repository: "vrboyzero/deep-space-sanctuary",
          headBranch: "feature/exact",
          baseBranch: "main",
          title,
        },
        diff: { baseBranch: "main", baseOid: fixture.initialCommit, byteLength: expect.any(Number) },
        receipt: { receiptId: expect.any(String) },
      });
      expect(preview.diff?.byteLength).toBeGreaterThan(0);

      const result = await runtime.confirm({
        operation: "pull_request",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
        title,
        body,
      });
      expect(result).toMatchObject({
        applied: true,
        postcondition: { pullRequestNumber: 17, pullRequestState: "OPEN", remoteOid: localCommit },
        audit: { status: "succeeded", pullRequestNumber: 17 },
      });
      expect(pullRequests.created).toEqual([expect.objectContaining({ title, body, headCommit: localCommit })]);

      const persistedFiles = await listFilesRecursively(fixture.stateDir);
      const persisted = (await Promise.all(persistedFiles.map((file) => fs.readFile(file, "utf-8")))).join("\n");
      expect(persisted).not.toContain(title);
      expect(persisted).not.toContain(body);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("reports an applied pull request as uncertain when the completion audit cannot be persisted", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-pr-audit-failure-");
    try {
      await runGit(["checkout", "-b", "feature/exact"], fixture.repoDir);
      const localCommit = await commitReadme(fixture.repoDir, "feature", "feature");
      await runGit(["push", "private", "feature/exact"], fixture.repoDir);
      const pullRequests = new MemoryPullRequestClient();
      const persistedStatuses: string[] = [];
      const runtime = createRuntime(fixture, pullRequests, async (audit) => {
        persistedStatuses.push(audit.status);
        if (audit.status !== "started") throw new Error("audit sink unavailable");
      });
      const title = "feat: exact delivery";
      const body = "private body";
      const preview = await runtime.previewPullRequest({
        cwd: fixture.repoDir,
        remote: "private",
        headBranch: "feature/exact",
        baseBranch: "main",
        title,
        body,
      });

      await expect(runtime.confirm({
        operation: "pull_request",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
        title,
        body,
      })).resolves.toMatchObject({
        operation: "pull_request",
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: {
          remoteOid: localCommit,
          pullRequestNumber: 17,
          pullRequestState: "OPEN",
        },
        audit: { status: "started" },
      });
      expect(persistedStatuses).toEqual(["started", "succeeded"]);
      expect(pullRequests.created).toHaveLength(1);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("reconciles an applied pull request after restart without creating a duplicate", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-pr-restart-");
    try {
      await runGit(["checkout", "-b", "feature/exact"], fixture.repoDir);
      const localCommit = await commitReadme(fixture.repoDir, "feature", "feature");
      await runGit(["push", "private", "feature/exact"], fixture.repoDir);
      const pullRequests = new MemoryPullRequestClient();
      const runtime = createRuntime(fixture, pullRequests);
      const title = "feat: exact delivery";
      const body = "private body";
      const preview = await runtime.previewPullRequest({
        cwd: fixture.repoDir,
        remote: "private",
        headBranch: "feature/exact",
        baseBranch: "main",
        title,
        body,
      });
      const originalRename = fs.rename.bind(fs);
      const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
        if (String(newPath).includes(path.join("remote-delivery", "audit"))) {
          throw new Error("audit sink unavailable");
        }
        await originalRename(oldPath, newPath);
      });
      try {
        await expect(runtime.confirm({
          operation: "pull_request",
          receiptId: preview.receipt?.receiptId ?? "",
          confirm: true,
          title,
          body,
        })).resolves.toMatchObject({
          outcome: "uncertain",
          applied: true,
          blockers: ["audit_persistence_failed"],
          audit: { status: "started" },
        });
      } finally {
        renameSpy.mockRestore();
      }

      const restarted = createRuntime(fixture, pullRequests);
      await expect(restarted.confirm({
        operation: "pull_request",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
        title,
        body,
      })).resolves.toMatchObject({
        operation: "pull_request",
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: {
          remoteOid: localCommit,
          pullRequestNumber: 17,
          pullRequestState: "OPEN",
        },
        audit: { status: "succeeded", pullRequestNumber: 17 },
      });
      expect(pullRequests.created).toHaveLength(1);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("reconciles a pull request when the create response is lost after the remote write", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-pr-response-lost-");
    try {
      await runGit(["checkout", "-b", "feature/exact"], fixture.repoDir);
      const localCommit = await commitReadme(fixture.repoDir, "feature", "feature");
      await runGit(["push", "private", "feature/exact"], fixture.repoDir);
      const pullRequests = new CreateThenThrowPullRequestClient();
      const runtime = createRuntime(fixture, pullRequests);
      const title = "feat: exact delivery";
      const body = "private body";
      const preview = await runtime.previewPullRequest({
        cwd: fixture.repoDir,
        remote: "private",
        headBranch: "feature/exact",
        baseBranch: "main",
        title,
        body,
      });

      await expect(runtime.confirm({
        operation: "pull_request",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
        title,
        body,
      })).resolves.toMatchObject({
        operation: "pull_request",
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: {
          remoteOid: localCommit,
          pullRequestNumber: 17,
          pullRequestState: "OPEN",
        },
        audit: { status: "succeeded", pullRequestNumber: 17 },
      });
      expect(pullRequests.created).toHaveLength(1);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);

  it("expires a one-time receipt before any remote write and records the failed audit", async () => {
    const fixture = await createFixture("belldandy-remote-delivery-expired-");
    try {
      await commitReadme(fixture.repoDir, "previewed", "previewed");
      let now = 1_000;
      const runtime = new RemoteDeliveryRuntime({
        stateDir: fixture.stateDir,
        targets: [{ remote: "private", url: fixture.remoteDir, pushBranches: ["main"] }],
        now: () => now,
      });
      const preview = await runtime.previewPush({ cwd: fixture.repoDir, remote: "private", targetBranch: "main" });
      now = (preview.receipt?.expiresAtMs ?? 0) + 1;

      await expect(runtime.confirm({
        operation: "push",
        receiptId: preview.receipt?.receiptId ?? "",
        confirm: true,
      })).resolves.toMatchObject({
        applied: false,
        blockers: ["receipt_expired"],
        audit: { status: "failed", reasonCodes: ["receipt_expired"] },
      });
      expect(await runGit(["rev-parse", "refs/heads/main"], fixture.remoteDir)).toBe(fixture.initialCommit);
    } finally {
      await fs.rm(fixture.rootDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 20_000);
});

async function listFilesRecursively(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else result.push(fullPath);
    }
  };
  await visit(root);
  return result;
}

async function installRejectingReceiveHook(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<string> {
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
