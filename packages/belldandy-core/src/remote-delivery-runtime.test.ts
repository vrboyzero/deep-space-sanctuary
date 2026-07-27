import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

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
      })).resolves.toMatchObject({ applied: false, blockers: ["receipt_consumed"] });
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
