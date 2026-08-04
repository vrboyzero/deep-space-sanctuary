import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const RECEIPT_VERSION = 1;
const AUDIT_VERSION = 1;
const RECEIPT_TTL_MS = 5 * 60 * 1000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PR_TITLE_CHARS = 256;
const MAX_PR_BODY_CHARS = 64 * 1024;
const EXTERNAL_COMMAND_TIMEOUT_MS = 15_000;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;
const SAFE_BRANCH_PATTERN = /^(?![./])(?!.*(?:\.\.|\/\.|\.\/|\/\/|@\{|\\|[~^:?*\[]))(?!.*[/.]$)[a-zA-Z0-9._/-]{1,160}$/;
const SAFE_REPOSITORY_PATTERN = /^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/;

export type RemoteDeliveryOperation = "push" | "pull_request";

export type RemoteDeliveryTarget = {
  remote: string;
  url: string;
  pushBranches: string[];
  pullRequestBases?: string[];
  repository?: string;
};

export type PullRequestRecord = {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  repository: string;
  headBranch: string;
  baseBranch: string;
  headCommit: string;
};

export type PullRequestClient = {
  findOpen(input: {
    repository: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<PullRequestRecord | undefined>;
  create(input: {
    repository: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    headCommit: string;
  }): Promise<PullRequestRecord>;
  get(input: { repository: string; number: number }): Promise<PullRequestRecord | undefined>;
};

export type RemoteDeliveryReceipt = {
  receiptId: string;
  expiresAtMs: number;
};

export type RemoteDeliveryEvidence = {
  artifactId: string;
  capturedAtMs: number;
  reasonCodes: string[];
};

export type RemoteDeliveryAudit = {
  auditId: string;
  capturedAtMs: number;
  status: "started" | "succeeded" | "failed" | "uncertain";
  operation: RemoteDeliveryOperation;
  remote: string;
  targetBranch: string;
  localCommit: string;
  remoteExpectedOid: string | null;
  diffHash: string;
  reasonCodes?: string[];
  pullRequestNumber?: number;
};

export type RemoteDeliveryPreview = {
  operation: RemoteDeliveryOperation;
  canConfirm: boolean;
  blockers: string[];
  approval?: {
    mode: "user_interaction";
    delegable: false;
    rememberable: false;
  };
  source?: {
    repoRoot: string;
    branch: string;
    commit: string;
    upstream: string | null;
  };
  target?: {
    remote: string;
    url: string;
    branch: string;
    expectedOid: string | null;
  };
  diff?: {
    baseBranch?: string;
    baseOid: string;
    sha256: string;
    byteLength: number;
  };
  pullRequest?: {
    repository: string;
    headBranch: string;
    baseBranch: string;
    title: string;
  };
  receipt?: RemoteDeliveryReceipt;
  evidence?: RemoteDeliveryEvidence;
};

export type RemoteDeliveryResult = {
  operation: RemoteDeliveryOperation;
  outcome: "succeeded" | "failed" | "uncertain";
  applied: boolean;
  blockers: string[];
  postcondition?: {
    remoteOid: string;
    pullRequestNumber?: number;
    pullRequestState?: PullRequestRecord["state"];
  };
  audit?: RemoteDeliveryAudit;
};

type CommonReceiptRecord = {
  version: number;
  receiptId: string;
  operation: RemoteDeliveryOperation;
  createdAtMs: number;
  expiresAtMs: number;
  cwd: string;
  repoRoot: string;
  sourceBranch: string;
  localCommit: string;
  upstream: string | null;
  remote: string;
  remoteUrlHash: string;
  targetBranch: string;
  remoteExpectedOid: string | null;
  diffBaseBranch?: string;
  diffBaseOid: string;
  diffHash: string;
  diffByteLength: number;
};

type PushReceiptRecord = CommonReceiptRecord & {
  operation: "push";
};

type PullRequestReceiptRecord = CommonReceiptRecord & {
  operation: "pull_request";
  repository: string;
  baseBranch: string;
  baseExpectedOid: string;
  titleHash: string;
  bodyHash: string;
};

type ReceiptRecord = PushReceiptRecord | PullRequestReceiptRecord;

type GitInspection = {
  cwd: string;
  repoRoot: string;
  branch: string;
  commit: string;
  upstream: string | null;
  remoteUrl: string;
  remoteOid: string | null;
  diffBaseBranch?: string;
  diffBaseOid: string;
  diffHash: string;
  diffByteLength: number;
};

type RuntimeOptions = {
  stateDir: string;
  targets: readonly RemoteDeliveryTarget[];
  pullRequests?: PullRequestClient;
  now?: () => number;
  persistAudit?: (audit: RemoteDeliveryAudit) => Promise<void>;
  pushCommit?: (input: {
    repoRoot: string;
    remote: string;
    targetBranch: string;
    localCommit: string;
  }) => Promise<void>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function auditIdForReceipt(receiptId: string): string {
  return `remote-delivery-audit-${sha256(receiptId)}`;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
  };
}

async function runGitOutput(args: string[], cwd: string, maxBuffer = MAX_GIT_OUTPUT_BYTES): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    windowsHide: true,
    maxBuffer,
    timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
    killSignal: "SIGKILL",
    env: gitEnv(),
  });
  return String(stdout ?? "");
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return (await runGitOutput(args, cwd)).trim();
}

async function runGitOptional(args: string[], cwd: string): Promise<string | undefined> {
  try {
    return await runGit(args, cwd);
  } catch {
    return undefined;
  }
}

async function readRemoteOid(remote: string, branch: string, cwd: string): Promise<string | null> {
  try {
    const output = await runGit(["ls-remote", "--exit-code", remote, `refs/heads/${branch}`], cwd);
    const oid = output.split(/\s+/)[0];
    if (!oid || !/^[a-f0-9]{40,64}$/i.test(oid)) throw new Error("Remote ref response is invalid.");
    return oid.toLowerCase();
  } catch (error) {
    if (readProcessExitCode(error) === 2) return null;
    throw error;
  }
}

function readProcessExitCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

function isSafeBranch(value: unknown): value is string {
  return typeof value === "string" && SAFE_BRANCH_PATTERN.test(value);
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized
    && normalized.length <= MAX_PR_TITLE_CHARS
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function normalizeBody(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\r\n/g, "\n");
  return normalized.length <= MAX_PR_BODY_CHARS && !/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function hasEmbeddedHttpCredentials(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

function normalizeTarget(value: RemoteDeliveryTarget): RemoteDeliveryTarget | undefined {
  const githubRepository = typeof value.url === "string" ? deriveGithubRepository(value.url) : undefined;
  if (!SAFE_ID_PATTERN.test(value.remote)
    || typeof value.url !== "string" || !value.url.trim() || value.url !== value.url.trim()
    || value.url.length > 2048 || /[\u0000-\u001f\u007f]/.test(value.url)
    || hasEmbeddedHttpCredentials(value.url)
    || !Array.isArray(value.pushBranches) || value.pushBranches.length === 0
    || value.pushBranches.some((branch) => !isSafeBranch(branch))
    || (value.pullRequestBases !== undefined
      && (!Array.isArray(value.pullRequestBases) || value.pullRequestBases.some((branch) => !isSafeBranch(branch))))
    || (value.repository !== undefined && !SAFE_REPOSITORY_PATTERN.test(value.repository))
    || (githubRepository && value.repository !== undefined
      && githubRepository.toLowerCase() !== value.repository.toLowerCase())) {
    return undefined;
  }
  return {
    remote: value.remote,
    url: value.url,
    pushBranches: [...new Set(value.pushBranches)],
    ...(value.pullRequestBases ? { pullRequestBases: [...new Set(value.pullRequestBases)] } : {}),
    ...(value.repository ? { repository: value.repository } : {}),
  };
}

export function parseRemoteDeliveryTargets(raw: string | undefined): RemoteDeliveryTarget[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const targets: RemoteDeliveryTarget[] = [];
    const bindings = new Set<string>();
    for (const value of parsed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const candidate = value as Record<string, unknown>;
      if (Object.keys(candidate).some((key) => !["remote", "url", "pushBranches", "pullRequestBases", "repository"].includes(key))) {
        return [];
      }
      const normalized = normalizeTarget(candidate as RemoteDeliveryTarget);
      if (!normalized) return [];
      for (const branch of normalized.pushBranches) {
        const binding = `${normalized.remote}\u0000${branch}`;
        if (bindings.has(binding)) return [];
        bindings.add(binding);
      }
      targets.push(normalized);
    }
    return targets;
  } catch {
    return [];
  }
}

function readReceipt(value: unknown): ReceiptRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== RECEIPT_VERSION
    || typeof candidate.receiptId !== "string" || !SAFE_ID_PATTERN.test(candidate.receiptId)
    || (candidate.operation !== "push" && candidate.operation !== "pull_request")
    || typeof candidate.createdAtMs !== "number" || !Number.isSafeInteger(candidate.createdAtMs)
    || typeof candidate.expiresAtMs !== "number" || !Number.isSafeInteger(candidate.expiresAtMs)
    || typeof candidate.cwd !== "string" || typeof candidate.repoRoot !== "string"
    || typeof candidate.sourceBranch !== "string" || !isSafeBranch(candidate.sourceBranch)
    || typeof candidate.localCommit !== "string"
    || (candidate.upstream !== null && typeof candidate.upstream !== "string")
    || typeof candidate.remote !== "string" || !SAFE_ID_PATTERN.test(candidate.remote)
    || typeof candidate.remoteUrlHash !== "string"
    || typeof candidate.targetBranch !== "string" || !isSafeBranch(candidate.targetBranch)
    || (candidate.remoteExpectedOid !== null && typeof candidate.remoteExpectedOid !== "string")
    || (candidate.diffBaseBranch !== undefined && (typeof candidate.diffBaseBranch !== "string" || !isSafeBranch(candidate.diffBaseBranch)))
    || typeof candidate.diffBaseOid !== "string" || typeof candidate.diffHash !== "string"
    || typeof candidate.diffByteLength !== "number" || !Number.isSafeInteger(candidate.diffByteLength)) {
    return undefined;
  }
  if (candidate.operation === "pull_request"
    && (typeof candidate.repository !== "string" || !SAFE_REPOSITORY_PATTERN.test(candidate.repository)
      || typeof candidate.baseBranch !== "string" || !isSafeBranch(candidate.baseBranch)
      || typeof candidate.baseExpectedOid !== "string"
      || typeof candidate.titleHash !== "string" || typeof candidate.bodyHash !== "string")) {
    return undefined;
  }
  return candidate as ReceiptRecord;
}

/**
 * Owns immutable remote-delivery receipts, exact Git writes, PR calls, and redacted audit artifacts.
 * It never performs merge, force-push, tag, release, or production deployment operations.
 */
export class RemoteDeliveryRuntime {
  private readonly receiptsDir: string;
  private readonly auditDir: string;
  private readonly evidenceDir: string;
  private readonly targets: readonly RemoteDeliveryTarget[];
  private readonly pullRequests?: PullRequestClient;
  private readonly now: () => number;
  private readonly persistAudit?: (audit: RemoteDeliveryAudit) => Promise<void>;
  private readonly pushCommit: NonNullable<RuntimeOptions["pushCommit"]>;

  constructor(options: RuntimeOptions) {
    const stateRoot = path.join(path.resolve(options.stateDir), "remote-delivery");
    this.receiptsDir = path.join(stateRoot, "receipts");
    this.auditDir = path.join(stateRoot, "audit");
    this.evidenceDir = path.join(stateRoot, "evidence");
    const bindings = new Set<string>();
    this.targets = options.targets.map((target) => {
      const normalized = normalizeTarget(target);
      if (!normalized) throw new Error("Remote delivery target policy is invalid.");
      for (const branch of normalized.pushBranches) {
        const binding = `${normalized.remote}\u0000${branch}`;
        if (bindings.has(binding)) throw new Error("Remote delivery target policy contains an ambiguous remote/branch binding.");
        bindings.add(binding);
      }
      return normalized;
    });
    this.pullRequests = options.pullRequests;
    this.now = options.now ?? Date.now;
    this.persistAudit = options.persistAudit;
    this.pushCommit = options.pushCommit ?? (async (input) => {
      await runGit([
        "push",
        "--porcelain",
        "--no-verify",
        input.remote,
        `${input.localCommit}:refs/heads/${input.targetBranch}`,
      ], input.repoRoot);
    });
  }

  listTargets(): RemoteDeliveryTarget[] {
    return this.targets.map((target) => ({
      ...target,
      pushBranches: [...target.pushBranches],
      ...(target.pullRequestBases ? { pullRequestBases: [...target.pullRequestBases] } : {}),
    }));
  }

  async resolveRepositoryRoot(cwd: string): Promise<string> {
    const resolvedCwd = await fs.realpath(cwd);
    return fs.realpath(await runGit(["rev-parse", "--show-toplevel"], resolvedCwd));
  }

  async previewPush(input: {
    cwd: string;
    remote: string;
    targetBranch: string;
    baseBranch?: string;
  }): Promise<RemoteDeliveryPreview> {
    if (!path.isAbsolute(input.cwd) || !SAFE_ID_PATTERN.test(input.remote) || !isSafeBranch(input.targetBranch)
      || (input.baseBranch !== undefined && !isSafeBranch(input.baseBranch))) {
      return this.previewFailure("push", ["invalid_input"]);
    }
    const target = this.findTarget(input.remote, input.targetBranch);
    if (!target || (input.baseBranch && !target.pullRequestBases?.includes(input.baseBranch))) {
      return this.previewFailure("push", ["target_not_allowed"]);
    }
    let inspection: GitInspection;
    try {
      inspection = await this.inspectGit({
        cwd: input.cwd,
        target,
        targetBranch: input.targetBranch,
        baseBranch: input.baseBranch,
      });
    } catch {
      return this.previewFailure("push", ["git_inspection_failed"]);
    }
    const blockers = await this.pushBlockers(inspection, target, input.targetBranch);
    if (blockers.length > 0) return this.previewFailure("push", blockers);
    const receipt: PushReceiptRecord = {
      ...this.buildCommonReceipt("push", inspection, target, input.targetBranch),
      operation: "push",
    };
    await this.writeReceipt(receipt);
    return this.toPreview(receipt, target);
  }

  async previewPullRequest(input: {
    cwd: string;
    remote: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<RemoteDeliveryPreview> {
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.body);
    if (!path.isAbsolute(input.cwd) || !SAFE_ID_PATTERN.test(input.remote)
      || !isSafeBranch(input.headBranch) || !isSafeBranch(input.baseBranch) || !title || body === undefined) {
      return this.previewFailure("pull_request", ["invalid_input"]);
    }
    const target = this.findTarget(input.remote, input.headBranch);
    if (!target?.repository || !target.pullRequestBases?.includes(input.baseBranch) || !this.pullRequests) {
      return this.previewFailure("pull_request", [target && !this.pullRequests ? "pull_request_client_unavailable" : "target_not_allowed"]);
    }
    let inspection: GitInspection;
    let baseExpectedOid: string | null;
    try {
      inspection = await this.inspectGit({
        cwd: input.cwd,
        target,
        targetBranch: input.headBranch,
        baseBranch: input.baseBranch,
        preferBaseBranch: true,
      });
      baseExpectedOid = await readRemoteOid(target.remote, input.baseBranch, inspection.repoRoot);
    } catch {
      return this.previewFailure("pull_request", ["git_inspection_failed"]);
    }
    const blockers: string[] = [];
    if (inspection.branch !== input.headBranch) blockers.push("source_branch_changed");
    if (inspection.remoteOid !== inspection.commit) blockers.push("head_not_pushed");
    if (!baseExpectedOid) blockers.push("base_branch_missing");
    if (await this.isDirty(inspection.repoRoot)) blockers.push("uncommitted_changes");
    try {
      if (await this.pullRequests.findOpen({
        repository: target.repository,
        headBranch: input.headBranch,
        baseBranch: input.baseBranch,
      })) blockers.push("pull_request_already_exists");
    } catch {
      blockers.push("pull_request_inspection_failed");
    }
    if (blockers.length > 0 || !baseExpectedOid) return this.previewFailure("pull_request", blockers);

    const common = this.buildCommonReceipt("pull_request", inspection, target, input.headBranch);
    const receipt: PullRequestReceiptRecord = {
      ...common,
      operation: "pull_request",
      repository: target.repository,
      baseBranch: input.baseBranch,
      baseExpectedOid,
      titleHash: sha256(title),
      bodyHash: sha256(body),
    };
    await this.writeReceipt(receipt);
    return this.toPreview(receipt, target, title);
  }

  async confirm(input: {
    operation: RemoteDeliveryOperation;
    receiptId: string;
    confirm: true;
    title?: string;
    body?: string;
  }): Promise<RemoteDeliveryResult> {
    if (!SAFE_ID_PATTERN.test(input.receiptId) || input.confirm !== true) {
      return { operation: input.operation, outcome: "failed", applied: false, blockers: ["invalid_confirmation"] };
    }
    const receipt = await this.loadReceipt(input.receiptId);
    if (!receipt || receipt.operation !== input.operation) {
      return { operation: input.operation, outcome: "failed", applied: false, blockers: ["receipt_invalid"] };
    }
    if (!await this.claimReceipt(input.receiptId)) {
      const recovered = await this.loadReceiptAudit(receipt.receiptId);
      if (recovered && this.auditMatchesReceipt(recovered, receipt)) {
        return this.reconcileConsumedReceipt(receipt, recovered);
      }
      if (await this.hasReceiptClaim(receipt.receiptId)) {
        return {
          operation: receipt.operation,
          outcome: "uncertain",
          applied: false,
          blockers: ["operation_status_uncertain"],
          ...(recovered ? { audit: recovered } : {}),
        };
      }
      return { operation: input.operation, outcome: "failed", applied: false, blockers: ["receipt_consumed"] };
    }
    const audit = await this.startAudit(receipt);
    if (!audit) return { operation: input.operation, outcome: "failed", applied: false, blockers: ["audit_unavailable"] };
    if (this.now() > receipt.expiresAtMs) {
      return this.failed(receipt, audit, ["receipt_expired"]);
    }
    if (receipt.operation === "pull_request") {
      const title = normalizeTitle(input.title);
      const body = normalizeBody(input.body);
      if (!title || body === undefined || sha256(title) !== receipt.titleHash || sha256(body) !== receipt.bodyHash) {
        return this.failed(receipt, audit, ["confirmation_payload_changed"]);
      }
      return this.confirmPullRequest(receipt, audit, title, body);
    }
    return this.confirmPush(receipt, audit);
  }

  async listAudit(limit = 50): Promise<RemoteDeliveryAudit[]> {
    const boundedLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
    let entries: string[];
    try {
      entries = await fs.readdir(this.auditDir);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
    const audits = await Promise.all(entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          return readAudit(JSON.parse(await fs.readFile(path.join(this.auditDir, entry), "utf-8")));
        } catch {
          return undefined;
        }
      }));
    return audits
      .filter((audit): audit is RemoteDeliveryAudit => Boolean(audit))
      .sort((left, right) => right.capturedAtMs - left.capturedAtMs)
      .slice(0, boundedLimit);
  }

  private findTarget(remote: string, branch: string): RemoteDeliveryTarget | undefined {
    return this.targets.find((target) => target.remote === remote && target.pushBranches.includes(branch));
  }

  private async inspectGit(input: {
    cwd: string;
    target: RemoteDeliveryTarget;
    targetBranch: string;
    baseBranch?: string;
    preferBaseBranch?: boolean;
  }): Promise<GitInspection> {
    const cwd = await fs.realpath(input.cwd);
    const repoRoot = await fs.realpath(await runGit(["rev-parse", "--show-toplevel"], cwd));
    const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot);
    const commit = (await runGit(["rev-parse", "HEAD"], repoRoot)).toLowerCase();
    const upstream = await runGitOptional(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot) ?? null;
    const remoteUrl = await runGit(["remote", "get-url", "--push", input.target.remote], repoRoot);
    if (remoteUrl !== input.target.url || hasEmbeddedHttpCredentials(remoteUrl)) {
      throw new Error("Remote URL does not match policy.");
    }
    const remoteOid = await readRemoteOid(input.target.remote, input.targetBranch, repoRoot);
    let diffBaseOid = input.preferBaseBranch && input.baseBranch
      ? await readRemoteOid(input.target.remote, input.baseBranch, repoRoot)
      : remoteOid;
    let diffBaseBranch: string | undefined;
    if (input.preferBaseBranch && input.baseBranch) diffBaseBranch = input.baseBranch;
    if (!diffBaseOid && input.baseBranch) {
      diffBaseBranch = input.baseBranch;
      diffBaseOid = await readRemoteOid(input.target.remote, input.baseBranch, repoRoot);
    }
    if (!diffBaseOid) throw new Error("A remote diff base is required.");
    const diff = await runGitOutput([
      "diff",
      "--binary",
      "--full-index",
      "--find-renames",
      "--no-ext-diff",
      diffBaseOid,
      commit,
      "--",
    ], repoRoot);
    return {
      cwd,
      repoRoot,
      branch,
      commit,
      upstream,
      remoteUrl,
      remoteOid,
      ...(diffBaseBranch ? { diffBaseBranch } : {}),
      diffBaseOid,
      diffHash: sha256(diff),
      diffByteLength: Buffer.byteLength(diff),
    };
  }

  private async pushBlockers(
    inspection: GitInspection,
    target: RemoteDeliveryTarget,
    targetBranch: string,
  ): Promise<string[]> {
    const blockers: string[] = [];
    if (inspection.remoteUrl !== target.url) blockers.push("remote_url_changed");
    if (inspection.commit === inspection.remoteOid) blockers.push("nothing_to_push");
    if (await this.isDirty(inspection.repoRoot)) blockers.push("uncommitted_changes");
    if (blockers.length === 0) {
      try {
        await this.dryRunPush(inspection, target.remote, targetBranch);
      } catch {
        blockers.push("non_fast_forward_or_remote_rejected");
      }
    }
    return blockers;
  }

  private async isDirty(repoRoot: string): Promise<boolean> {
    return Boolean(await runGitOutput(["status", "--porcelain=v1", "-z", "--untracked-files=all"], repoRoot));
  }

  private async dryRunPush(inspection: GitInspection, remote: string, branch: string): Promise<void> {
    await runGit([
      "push",
      "--dry-run",
      "--porcelain",
      "--no-verify",
      remote,
      `${inspection.commit}:refs/heads/${branch}`,
    ], inspection.repoRoot);
  }

  private buildCommonReceipt(
    operation: RemoteDeliveryOperation,
    inspection: GitInspection,
    target: RemoteDeliveryTarget,
    targetBranch: string,
  ): CommonReceiptRecord {
    const createdAtMs = this.now();
    return {
      version: RECEIPT_VERSION,
      receiptId: `remote-delivery-${randomUUID()}`,
      operation,
      createdAtMs,
      expiresAtMs: createdAtMs + RECEIPT_TTL_MS,
      cwd: inspection.cwd,
      repoRoot: inspection.repoRoot,
      sourceBranch: inspection.branch,
      localCommit: inspection.commit,
      upstream: inspection.upstream,
      remote: target.remote,
      remoteUrlHash: sha256(inspection.remoteUrl),
      targetBranch,
      remoteExpectedOid: inspection.remoteOid,
      ...(inspection.diffBaseBranch ? { diffBaseBranch: inspection.diffBaseBranch } : {}),
      diffBaseOid: inspection.diffBaseOid,
      diffHash: inspection.diffHash,
      diffByteLength: inspection.diffByteLength,
    };
  }

  private toPreview(receipt: ReceiptRecord, target: RemoteDeliveryTarget, title?: string): RemoteDeliveryPreview {
    return {
      operation: receipt.operation,
      canConfirm: true,
      blockers: [],
      approval: {
        mode: "user_interaction",
        delegable: false,
        rememberable: false,
      },
      source: {
        repoRoot: receipt.repoRoot,
        branch: receipt.sourceBranch,
        commit: receipt.localCommit,
        upstream: receipt.upstream,
      },
      target: {
        remote: receipt.remote,
        url: target.url,
        branch: receipt.targetBranch,
        expectedOid: receipt.remoteExpectedOid,
      },
      diff: {
        ...(receipt.diffBaseBranch ? { baseBranch: receipt.diffBaseBranch } : {}),
        baseOid: receipt.diffBaseOid,
        sha256: receipt.diffHash,
        byteLength: receipt.diffByteLength,
      },
      ...(receipt.operation === "pull_request" ? {
        pullRequest: {
          repository: receipt.repository,
          headBranch: receipt.targetBranch,
          baseBranch: receipt.baseBranch,
          title: title ?? "",
        },
      } : {}),
      receipt: { receiptId: receipt.receiptId, expiresAtMs: receipt.expiresAtMs },
    };
  }

  private async previewFailure(operation: RemoteDeliveryOperation, blockers: string[]): Promise<RemoteDeliveryPreview> {
    const reasonCodes = [...new Set(blockers.length > 0 ? blockers : ["unavailable"])];
    return {
      operation,
      canConfirm: false,
      blockers: reasonCodes,
      evidence: await this.writeEvidence(operation, reasonCodes),
    };
  }

  private async confirmPush(receipt: PushReceiptRecord, audit: RemoteDeliveryAudit): Promise<RemoteDeliveryResult> {
    const final = await this.inspectReceipt(receipt);
    if (final.blockers.length > 0 || !final.inspection) return this.failed(receipt, audit, final.blockers);
    try {
      await this.pushCommit({
        repoRoot: receipt.repoRoot,
        remote: receipt.remote,
        targetBranch: receipt.targetBranch,
        localCommit: receipt.localCommit,
      });
    } catch {
      return this.reconcileConsumedReceipt(receipt, audit);
    }
    let remoteOid: string | null;
    try {
      remoteOid = await readRemoteOid(receipt.remote, receipt.targetBranch, receipt.repoRoot);
    } catch {
      return this.finishUncertain(receipt, audit, ["postcondition_unavailable"]);
    }
    if (remoteOid !== receipt.localCommit) {
      return this.finishUncertain(receipt, audit, ["operation_status_uncertain"]);
    }
    const completed = await this.finishAudit(audit, "succeeded", []);
    if (!completed) {
      return {
        operation: "push",
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: { remoteOid },
        audit,
      };
    }
    return {
      operation: "push",
      outcome: "succeeded",
      applied: true,
      blockers: [],
      postcondition: { remoteOid },
      audit: completed,
    };
  }

  private async confirmPullRequest(
    receipt: PullRequestReceiptRecord,
    audit: RemoteDeliveryAudit,
    title: string,
    body: string,
  ): Promise<RemoteDeliveryResult> {
    if (!this.pullRequests) return this.failed(receipt, audit, ["pull_request_client_unavailable"]);
    const final = await this.inspectReceipt(receipt);
    if (final.blockers.length > 0 || !final.inspection) return this.failed(receipt, audit, final.blockers);
    try {
      if (await this.pullRequests.findOpen({
        repository: receipt.repository,
        headBranch: receipt.targetBranch,
        baseBranch: receipt.baseBranch,
      })) return this.failed(receipt, audit, ["pull_request_already_exists"]);
    } catch {
      return this.failed(receipt, audit, ["pull_request_inspection_failed"]);
    }
    let created: PullRequestRecord;
    try {
      created = await this.pullRequests.create({
        repository: receipt.repository,
        headBranch: receipt.targetBranch,
        baseBranch: receipt.baseBranch,
        title,
        body,
        headCommit: receipt.localCommit,
      });
    } catch {
      return this.reconcileConsumedReceipt(receipt, audit);
    }
    let postcondition: PullRequestRecord | undefined;
    try {
      postcondition = await this.pullRequests.get({ repository: receipt.repository, number: created.number });
    } catch {
      return this.reconcileConsumedReceipt(receipt, audit);
    }
    if (!postcondition
      || postcondition.state !== "OPEN"
      || postcondition.repository !== receipt.repository
      || postcondition.headBranch !== receipt.targetBranch
      || postcondition.baseBranch !== receipt.baseBranch
      || postcondition.headCommit !== receipt.localCommit) {
      return this.reconcileConsumedReceipt(receipt, audit);
    }
    const completed = await this.finishAudit(audit, "succeeded", [], postcondition.number);
    const verifiedPostcondition: NonNullable<RemoteDeliveryResult["postcondition"]> = {
      remoteOid: receipt.localCommit,
      pullRequestNumber: postcondition.number,
      pullRequestState: postcondition.state,
    };
    if (!completed) {
      return {
        operation: "pull_request",
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: verifiedPostcondition,
        audit,
      };
    }
    return {
      operation: "pull_request",
      outcome: "succeeded",
      applied: true,
      blockers: [],
      postcondition: verifiedPostcondition,
      audit: completed,
    };
  }

  private async inspectReceipt(receipt: ReceiptRecord): Promise<{
    inspection?: GitInspection;
    blockers: string[];
  }> {
    const target = this.findTarget(receipt.remote, receipt.targetBranch);
    if (!target || sha256(target.url) !== receipt.remoteUrlHash) return { blockers: ["target_not_allowed"] };
    if (receipt.operation === "pull_request"
      && (target.repository !== receipt.repository || !target.pullRequestBases?.includes(receipt.baseBranch))) {
      return { blockers: ["target_not_allowed"] };
    }
    let inspection: GitInspection;
    try {
      inspection = await this.inspectGit({
        cwd: receipt.cwd,
        target,
        targetBranch: receipt.targetBranch,
        baseBranch: receipt.diffBaseBranch,
        preferBaseBranch: receipt.operation === "pull_request",
      });
    } catch {
      return { blockers: ["git_inspection_failed"] };
    }
    const blockers: string[] = [];
    if (inspection.repoRoot !== receipt.repoRoot) blockers.push("repository_changed");
    if (inspection.branch !== receipt.sourceBranch) blockers.push("source_branch_changed");
    if (inspection.commit !== receipt.localCommit) blockers.push("local_head_changed");
    if (inspection.upstream !== receipt.upstream) blockers.push("upstream_changed");
    if (sha256(inspection.remoteUrl) !== receipt.remoteUrlHash) blockers.push("remote_url_changed");
    if (inspection.remoteOid !== receipt.remoteExpectedOid) blockers.push("remote_ref_changed");
    if (inspection.diffBaseOid !== receipt.diffBaseOid
      || inspection.diffHash !== receipt.diffHash
      || inspection.diffByteLength !== receipt.diffByteLength) blockers.push("diff_changed");
    if (await this.isDirty(receipt.repoRoot)) blockers.push("uncommitted_changes");
    if (receipt.operation === "pull_request") {
      let baseOid: string | null = null;
      try {
        baseOid = await readRemoteOid(receipt.remote, receipt.baseBranch, receipt.repoRoot);
      } catch {
        blockers.push("base_ref_unavailable");
      }
      if (baseOid !== receipt.baseExpectedOid) blockers.push("base_ref_changed");
      if (inspection.remoteOid !== receipt.localCommit) blockers.push("head_not_pushed");
    } else if (blockers.length === 0) {
      try {
        await this.dryRunPush(inspection, receipt.remote, receipt.targetBranch);
      } catch {
        blockers.push("non_fast_forward_or_remote_rejected");
      }
    }
    return { inspection, blockers: [...new Set(blockers)] };
  }

  private async writeReceipt(receipt: ReceiptRecord): Promise<void> {
    await fs.mkdir(this.receiptsDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      this.receiptPath(receipt.receiptId),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { encoding: "utf-8", mode: 0o600, flag: "wx" },
    );
  }

  private async loadReceipt(receiptId: string): Promise<ReceiptRecord | undefined> {
    try {
      return readReceipt(JSON.parse(await fs.readFile(this.receiptPath(receiptId), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private async loadReceiptAudit(receiptId: string): Promise<RemoteDeliveryAudit | undefined> {
    try {
      return readAudit(JSON.parse(await fs.readFile(this.auditPath(auditIdForReceipt(receiptId)), "utf-8")));
    } catch {
      return undefined;
    }
  }

  private auditMatchesReceipt(audit: RemoteDeliveryAudit, receipt: ReceiptRecord): boolean {
    return audit.auditId === auditIdForReceipt(receipt.receiptId)
      && audit.operation === receipt.operation
      && audit.remote === receipt.remote
      && audit.targetBranch === receipt.targetBranch
      && audit.localCommit === receipt.localCommit
      && audit.remoteExpectedOid === receipt.remoteExpectedOid
      && audit.diffHash === receipt.diffHash;
  }

  private async reconcileConsumedReceipt(
    receipt: ReceiptRecord,
    audit: RemoteDeliveryAudit,
  ): Promise<RemoteDeliveryResult> {
    if (audit.status === "failed") {
      return {
        operation: receipt.operation,
        outcome: "failed",
        applied: false,
        blockers: audit.reasonCodes ?? ["operation_failed"],
        audit,
      };
    }
    if (audit.status === "succeeded") {
      if (receipt.operation === "pull_request" && !audit.pullRequestNumber) {
        return {
          operation: receipt.operation,
          outcome: "uncertain",
          applied: false,
          blockers: ["operation_status_uncertain"],
          audit,
        };
      }
      return {
        operation: receipt.operation,
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition: receipt.operation === "pull_request"
          ? {
            remoteOid: receipt.localCommit,
            pullRequestNumber: audit.pullRequestNumber,
            pullRequestState: "OPEN",
          }
          : { remoteOid: receipt.localCommit },
        audit,
      };
    }
    if (receipt.operation === "pull_request") {
      if (!this.pullRequests) {
        return this.finishUncertain(receipt, audit, ["pull_request_client_unavailable"]);
      }
      let pullRequest: PullRequestRecord | undefined;
      try {
        pullRequest = await this.pullRequests.findOpen({
          repository: receipt.repository,
          headBranch: receipt.targetBranch,
          baseBranch: receipt.baseBranch,
        });
      } catch {
        return this.finishUncertain(receipt, audit, ["postcondition_unavailable"]);
      }
      if (!pullRequest
        || pullRequest.state !== "OPEN"
        || pullRequest.repository !== receipt.repository
        || pullRequest.headBranch !== receipt.targetBranch
        || pullRequest.baseBranch !== receipt.baseBranch
        || pullRequest.headCommit !== receipt.localCommit) {
        return this.finishUncertain(receipt, audit, ["operation_status_uncertain"]);
      }
      const completed = await this.finishAudit(audit, "succeeded", [], pullRequest.number);
      const postcondition: NonNullable<RemoteDeliveryResult["postcondition"]> = {
        remoteOid: receipt.localCommit,
        pullRequestNumber: pullRequest.number,
        pullRequestState: pullRequest.state,
      };
      if (!completed) {
        return {
          operation: receipt.operation,
          outcome: "uncertain",
          applied: true,
          blockers: ["audit_persistence_failed"],
          postcondition,
          audit,
        };
      }
      return {
        operation: receipt.operation,
        outcome: "succeeded",
        applied: true,
        blockers: [],
        postcondition,
        audit: completed,
      };
    }
    let remoteOid: string | null;
    try {
      remoteOid = await readRemoteOid(receipt.remote, receipt.targetBranch, receipt.repoRoot);
    } catch {
      return this.finishUncertain(receipt, audit, ["postcondition_unavailable"]);
    }
    if (remoteOid !== receipt.localCommit) {
      return this.finishUncertain(receipt, audit, ["operation_status_uncertain"]);
    }
    const completed = await this.finishAudit(audit, "succeeded", []);
    if (!completed) {
      return {
        operation: receipt.operation,
        outcome: "uncertain",
        applied: true,
        blockers: ["audit_persistence_failed"],
        postcondition: { remoteOid },
        audit,
      };
    }
    return {
      operation: receipt.operation,
      outcome: "succeeded",
      applied: true,
      blockers: [],
      postcondition: { remoteOid },
      audit: completed,
    };
  }

  private async claimReceipt(receiptId: string): Promise<boolean> {
    try {
      await fs.mkdir(this.receiptsDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(`${this.receiptPath(receiptId)}.lock`, `${this.now()}\n`, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
      return true;
    } catch {
      return false;
    }
  }

  private async hasReceiptClaim(receiptId: string): Promise<boolean> {
    try {
      await fs.access(`${this.receiptPath(receiptId)}.lock`);
      return true;
    } catch {
      return false;
    }
  }

  private receiptPath(receiptId: string): string {
    if (!SAFE_ID_PATTERN.test(receiptId)) throw new Error("Remote delivery receipt id is invalid.");
    return path.join(this.receiptsDir, `${receiptId}.json`);
  }

  private async writeEvidence(
    operation: RemoteDeliveryOperation,
    reasonCodes: string[],
  ): Promise<RemoteDeliveryEvidence | undefined> {
    const artifactId = `remote-delivery-evidence-${randomUUID()}`;
    const capturedAtMs = this.now();
    try {
      await fs.mkdir(this.evidenceDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(this.evidenceDir, `${artifactId}.json`), `${JSON.stringify({
        version: 1,
        artifactId,
        capturedAtMs,
        operation,
        reasonCodes,
      }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      return { artifactId, capturedAtMs, reasonCodes };
    } catch {
      return undefined;
    }
  }

  private async startAudit(receipt: ReceiptRecord): Promise<RemoteDeliveryAudit | undefined> {
    const audit: RemoteDeliveryAudit = {
      auditId: auditIdForReceipt(receipt.receiptId),
      capturedAtMs: this.now(),
      status: "started",
      operation: receipt.operation,
      remote: receipt.remote,
      targetBranch: receipt.targetBranch,
      localCommit: receipt.localCommit,
      remoteExpectedOid: receipt.remoteExpectedOid,
      diffHash: receipt.diffHash,
    };
    try {
      if (this.persistAudit) {
        await this.persistAudit(audit);
        return audit;
      }
      await fs.mkdir(this.auditDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(this.auditPath(audit.auditId), `${JSON.stringify({
        version: AUDIT_VERSION,
        ...audit,
      }, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      return audit;
    } catch {
      return undefined;
    }
  }

  private async finishAudit(
    audit: RemoteDeliveryAudit,
    status: "succeeded" | "failed" | "uncertain",
    reasonCodes: string[],
    pullRequestNumber?: number,
  ): Promise<RemoteDeliveryAudit | undefined> {
    const completed: RemoteDeliveryAudit = {
      auditId: audit.auditId,
      capturedAtMs: audit.capturedAtMs,
      status,
      operation: audit.operation,
      remote: audit.remote,
      targetBranch: audit.targetBranch,
      localCommit: audit.localCommit,
      remoteExpectedOid: audit.remoteExpectedOid,
      diffHash: audit.diffHash,
      ...(reasonCodes.length > 0 ? { reasonCodes: [...new Set(reasonCodes)] } : {}),
      ...(pullRequestNumber ? { pullRequestNumber } : {}),
    };
    const targetPath = this.auditPath(audit.auditId);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      if (this.persistAudit) {
        await this.persistAudit(completed);
        return completed;
      }
      await fs.writeFile(temporaryPath, `${JSON.stringify({ version: AUDIT_VERSION, ...completed }, null, 2)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
      await fs.rename(temporaryPath, targetPath);
      await this.cleanupAuditTemps(audit.auditId);
      return completed;
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      return undefined;
    }
  }

  private async failed(
    receipt: ReceiptRecord,
    audit: RemoteDeliveryAudit,
    blockers: string[],
  ): Promise<RemoteDeliveryResult> {
    const reasonCodes = [...new Set(blockers.length > 0 ? blockers : ["unavailable"])];
    const completed = await this.finishAudit(audit, "failed", reasonCodes);
    return {
      operation: receipt.operation,
      outcome: "failed",
      applied: false,
      blockers: reasonCodes,
      ...(completed ? { audit: completed } : {}),
    };
  }

  private async finishUncertain(
    receipt: ReceiptRecord,
    audit: RemoteDeliveryAudit,
    blockers: string[],
  ): Promise<RemoteDeliveryResult> {
    const reasonCodes = [...new Set(blockers.length > 0 ? blockers : ["operation_status_uncertain"])];
    const completed = await this.finishAudit(audit, "uncertain", reasonCodes);
    return {
      operation: receipt.operation,
      outcome: "uncertain",
      applied: false,
      blockers: reasonCodes,
      audit: completed ?? audit,
    };
  }

  private auditPath(auditId: string): string {
    if (!SAFE_ID_PATTERN.test(auditId)) throw new Error("Remote delivery audit id is invalid.");
    return path.join(this.auditDir, `${auditId}.json`);
  }

  private async cleanupAuditTemps(auditId: string): Promise<void> {
    if (!SAFE_ID_PATTERN.test(auditId)) return;
    const prefix = `${auditId}.json.`;
    const entries = await fs.readdir(this.auditDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".tmp"))
      .map((entry) => fs.rm(path.join(this.auditDir, entry.name), { force: true }).catch(() => {})));
  }
}

function readAudit(value: unknown): RemoteDeliveryAudit | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== AUDIT_VERSION
    || typeof candidate.auditId !== "string" || !SAFE_ID_PATTERN.test(candidate.auditId)
    || typeof candidate.capturedAtMs !== "number" || !Number.isSafeInteger(candidate.capturedAtMs)
    || (candidate.status !== "started" && candidate.status !== "succeeded"
      && candidate.status !== "failed" && candidate.status !== "uncertain")
    || (candidate.operation !== "push" && candidate.operation !== "pull_request")
    || typeof candidate.remote !== "string" || typeof candidate.targetBranch !== "string"
    || typeof candidate.localCommit !== "string"
    || (candidate.remoteExpectedOid !== null && typeof candidate.remoteExpectedOid !== "string")
    || typeof candidate.diffHash !== "string"
    || (candidate.reasonCodes !== undefined
      && (!Array.isArray(candidate.reasonCodes) || candidate.reasonCodes.some((code) => typeof code !== "string")))
    || (candidate.pullRequestNumber !== undefined
      && (typeof candidate.pullRequestNumber !== "number" || !Number.isSafeInteger(candidate.pullRequestNumber)))) {
    return undefined;
  }
  return candidate as RemoteDeliveryAudit;
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

type GhPullRequestJson = {
  number?: unknown;
  url?: unknown;
  state?: unknown;
  headRefName?: unknown;
  headRefOid?: unknown;
  baseRefName?: unknown;
};

/** Production PR adapter. PR body is sent over stdin and never placed in argv. */
export class GhPullRequestClient implements PullRequestClient {
  async findOpen(input: {
    repository: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<PullRequestRecord | undefined> {
    const output = await runGh([
      "pr", "list",
      "--repo", input.repository,
      "--head", input.headBranch,
      "--base", input.baseBranch,
      "--state", "open",
      "--limit", "1",
      "--json", "number,url,state,headRefName,headRefOid,baseRefName",
    ]);
    const rows = JSON.parse(output) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const record = parseGhPullRequest(rows[0], input.repository);
    if (!record) throw new Error("GitHub CLI returned an invalid PR record.");
    return record;
  }

  async create(input: {
    repository: string;
    headBranch: string;
    baseBranch: string;
    title: string;
    body: string;
    headCommit: string;
  }): Promise<PullRequestRecord> {
    const url = (await runGh([
      "pr", "create",
      "--repo", input.repository,
      "--head", input.headBranch,
      "--base", input.baseBranch,
      "--title", input.title,
      "--body-file", "-",
    ], input.body)).trim();
    if (!/^https:\/\/github\.com\//i.test(url)) throw new Error("GitHub CLI did not return a trusted PR URL.");
    const output = await runGh([
      "pr", "view", url,
      "--repo", input.repository,
      "--json", "number,url,state,headRefName,headRefOid,baseRefName",
    ]);
    const record = parseGhPullRequest(JSON.parse(output), input.repository);
    if (!record || record.headCommit !== input.headCommit) throw new Error("Created PR does not match the expected head commit.");
    return record;
  }

  async get(input: { repository: string; number: number }): Promise<PullRequestRecord | undefined> {
    const output = await runGh([
      "pr", "view", String(input.number),
      "--repo", input.repository,
      "--json", "number,url,state,headRefName,headRefOid,baseRefName",
    ]);
    return parseGhPullRequest(JSON.parse(output), input.repository);
  }
}

function parseGhPullRequest(value: unknown, repository: string): PullRequestRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as GhPullRequestJson;
  if (typeof candidate.number !== "number" || !Number.isSafeInteger(candidate.number) || candidate.number <= 0
    || typeof candidate.url !== "string" || !/^https:\/\/github\.com\//i.test(candidate.url)
    || (candidate.state !== "OPEN" && candidate.state !== "CLOSED" && candidate.state !== "MERGED")
    || typeof candidate.headRefName !== "string" || !isSafeBranch(candidate.headRefName)
    || typeof candidate.baseRefName !== "string" || !isSafeBranch(candidate.baseRefName)
    || typeof candidate.headRefOid !== "string" || !/^[a-f0-9]{40,64}$/i.test(candidate.headRefOid)) {
    return undefined;
  }
  return {
    number: candidate.number,
    url: candidate.url,
    state: candidate.state,
    repository,
    headBranch: candidate.headRefName,
    baseBranch: candidate.baseRefName,
    headCommit: candidate.headRefOid.toLowerCase(),
  };
}

async function runGh(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stdout = "";
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, EXTERNAL_COMMAND_TIMEOUT_MS);
    child.stdout.setEncoding("utf-8");
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > 1024 * 1024) child.kill();
    });
    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > 1024 * 1024) child.kill();
      else stdout += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (!timedOut && code === 0 && stdoutBytes <= 1024 * 1024 && stderrBytes <= 1024 * 1024) resolve(stdout);
      else reject(new Error("GitHub CLI request failed."));
    });
    child.stdin.end(stdin ?? "");
  });
}

function deriveGithubRepository(value: string): string | undefined {
  const scp = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(value);
  if (scp?.[1] && SAFE_REPOSITORY_PATTERN.test(scp[1])) return scp[1];
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "github.com") return undefined;
    const repository = parsed.pathname.replace(/^\//, "").replace(/\.git$/i, "");
    return SAFE_REPOSITORY_PATTERN.test(repository) ? repository : undefined;
  } catch {
    return undefined;
  }
}
