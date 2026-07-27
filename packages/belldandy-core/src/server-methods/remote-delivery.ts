import fs from "node:fs/promises";
import path from "node:path";

import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import type { RemoteDeliveryOperation, RemoteDeliveryRuntime } from "../remote-delivery-runtime.js";
import type { UserWorktreeRuntime } from "../user-worktree-runtime.js";

type RemoteDeliveryMethodContext = {
  runtime?: RemoteDeliveryRuntime;
  userWorktreeRuntime?: UserWorktreeRuntime;
  additionalWorkspaceRoots?: string[];
};

type WorkspaceInput = {
  cwd: string;
  worktreeId?: string;
};

function asParams(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readRequiredString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readWorkspaceInput(params: Record<string, unknown>): WorkspaceInput | undefined {
  const cwd = readRequiredString(params, "cwd")?.trim();
  const worktreeId = params.worktreeId === undefined ? undefined : readRequiredString(params, "worktreeId")?.trim();
  if (!cwd || !path.isAbsolute(cwd) || (params.worktreeId !== undefined && !worktreeId)) return undefined;
  return { cwd, ...(worktreeId ? { worktreeId } : {}) };
}

function readPushPreview(value: unknown):
  | { ok: true; value: WorkspaceInput & { remote: string; targetBranch: string; baseBranch?: string } }
  | { ok: false; message: string } {
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  if (Object.keys(params).some((key) => !["cwd", "worktreeId", "remote", "targetBranch", "baseBranch"].includes(key))) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  const workspace = readWorkspaceInput(params);
  const remote = readRequiredString(params, "remote")?.trim();
  const targetBranch = readRequiredString(params, "targetBranch")?.trim();
  const baseBranch = params.baseBranch === undefined ? undefined : readRequiredString(params, "baseBranch")?.trim();
  if (!workspace || !remote || !targetBranch || (params.baseBranch !== undefined && !baseBranch)) {
    return { ok: false, message: "cwd, remote, and targetBranch must be non-empty; cwd must be absolute" };
  }
  return { ok: true, value: { ...workspace, remote, targetBranch, ...(baseBranch ? { baseBranch } : {}) } };
}

function readPullRequestPreview(value: unknown):
  | {
    ok: true;
    value: WorkspaceInput & {
      remote: string;
      headBranch: string;
      baseBranch: string;
      title: string;
      body: string;
    };
  }
  | { ok: false; message: string } {
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  if (Object.keys(params).some((key) => ![
    "cwd", "worktreeId", "remote", "headBranch", "baseBranch", "title", "body",
  ].includes(key))) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  const workspace = readWorkspaceInput(params);
  const remote = readRequiredString(params, "remote")?.trim();
  const headBranch = readRequiredString(params, "headBranch")?.trim();
  const baseBranch = readRequiredString(params, "baseBranch")?.trim();
  const title = typeof params.title === "string" ? params.title : undefined;
  const body = typeof params.body === "string" ? params.body : undefined;
  if (!workspace || !remote || !headBranch || !baseBranch || title === undefined || body === undefined) {
    return { ok: false, message: "cwd, remote, headBranch, baseBranch, title, and body are required; cwd must be absolute" };
  }
  return { ok: true, value: { ...workspace, remote, headBranch, baseBranch, title, body } };
}

function readConfirm(value: unknown, operation: RemoteDeliveryOperation):
  | { ok: true; value: { receiptId: string; confirm: true; title?: string; body?: string } }
  | { ok: false; message: string } {
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  const allowed = operation === "pull_request"
    ? ["receiptId", "confirm", "title", "body"]
    : ["receiptId", "confirm"];
  if (Object.keys(params).some((key) => !allowed.includes(key))) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  const receiptId = readRequiredString(params, "receiptId")?.trim();
  if (!receiptId || params.confirm !== true) {
    return { ok: false, message: "receiptId is required and confirm must be true" };
  }
  if (operation === "pull_request") {
    if (typeof params.title !== "string" || typeof params.body !== "string") {
      return { ok: false, message: "pull request confirmation requires title and body" };
    }
    return { ok: true, value: { receiptId, confirm: true, title: params.title, body: params.body } };
  }
  return { ok: true, value: { receiptId, confirm: true } };
}

function readAuditLimit(value: unknown):
  | { ok: true; limit: number }
  | { ok: false; message: string } {
  if (value === undefined) return { ok: true, limit: 50 };
  const params = asParams(value);
  if (!params || Object.keys(params).some((key) => key !== "limit")) {
    return { ok: false, message: "params must contain only limit" };
  }
  if (params.limit === undefined) return { ok: true, limit: 50 };
  if (typeof params.limit !== "number" || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 100) {
    return { ok: false, message: "limit must be an integer between 1 and 100" };
  }
  return { ok: true, limit: params.limit };
}

function isUnderRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function resolveAllowedWorkspace(
  runtime: RemoteDeliveryRuntime,
  input: WorkspaceInput,
  ctx: RemoteDeliveryMethodContext,
): Promise<string | undefined> {
  let cwd: string;
  try {
    cwd = await fs.realpath(input.cwd);
  } catch {
    return undefined;
  }
  if (input.worktreeId && ctx.userWorktreeRuntime) {
    const status = await ctx.userWorktreeRuntime.getStatus(input.worktreeId).catch(() => undefined);
    if (status && status.status !== "unavailable") {
      const worktreePath = await fs.realpath(status.worktreePath).catch(() => undefined);
      if (worktreePath && path.resolve(worktreePath) === path.resolve(cwd)) return cwd;
    }
    return undefined;
  }
  let repoRoot: string;
  try {
    repoRoot = await fs.realpath(await runtime.resolveRepositoryRoot(cwd));
  } catch {
    return undefined;
  }
  const roots = (await Promise.all((ctx.additionalWorkspaceRoots ?? []).map(async (root) => {
    try {
      return await fs.realpath(root);
    } catch {
      return undefined;
    }
  }))).filter((root): root is string => Boolean(root));
  return roots.some((root) => isUnderRoot(root, cwd) && isUnderRoot(root, repoRoot)) ? cwd : undefined;
}

/** Pairing-protected control plane for exact, receipt-bound remote Git delivery. */
export async function handleRemoteDeliveryMethod(
  req: GatewayReqFrame,
  ctx: RemoteDeliveryMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.runtime) {
    return { type: "res", id: req.id, ok: false, error: { code: "unsupported", message: "Remote delivery is unavailable." } };
  }
  if (req.method === "workspace.remote_delivery.audit.list") {
    const parsed = readAuditLimit(req.params);
    if (!parsed.ok) return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
    try {
      return { type: "res", id: req.id, ok: true, payload: { audits: await ctx.runtime.listAudit(parsed.limit) } };
    } catch {
      return { type: "res", id: req.id, ok: false, error: { code: "unavailable", message: "Remote delivery audit is unavailable." } };
    }
  }
  if (req.method === "workspace.remote_delivery.targets") {
    const params = asParams(req.params);
    if (!params || Object.keys(params).some((key) => key !== "cwd" && key !== "worktreeId")) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "cwd is required" } };
    }
    const workspace = readWorkspaceInput(params);
    if (!workspace || !await resolveAllowedWorkspace(ctx.runtime, workspace, ctx)) {
      return { type: "res", id: req.id, ok: false, error: { code: "workspace_not_allowed", message: "Remote delivery requires an exact allowed workspace." } };
    }
    return { type: "res", id: req.id, ok: true, payload: { targets: ctx.runtime.listTargets() } };
  }

  const operation: RemoteDeliveryOperation | undefined = req.method.includes("pull_request")
    ? "pull_request"
    : req.method.includes("push") ? "push" : undefined;
  if (!operation) {
    return { type: "res", id: req.id, ok: false, error: { code: "unsupported", message: "Remote delivery method is unsupported." } };
  }
  if (req.method.endsWith(".confirm")) {
    const parsed = readConfirm(req.params, operation);
    if (!parsed.ok) return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
    try {
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: await ctx.runtime.confirm({ operation, ...parsed.value }),
      };
    } catch {
      return { type: "res", id: req.id, ok: false, error: { code: "confirmation_unavailable", message: "Remote delivery confirmation failed." } };
    }
  }
  if (operation === "push") {
    const parsed = readPushPreview(req.params);
    if (!parsed.ok) return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
    const { worktreeId: _worktreeId, ...previewInput } = parsed.value;
    const cwd = await resolveAllowedWorkspace(ctx.runtime, parsed.value, ctx);
    if (!cwd) return { type: "res", id: req.id, ok: false, error: { code: "workspace_not_allowed", message: "Remote delivery requires an exact allowed workspace." } };
    try {
      return { type: "res", id: req.id, ok: true, payload: await ctx.runtime.previewPush({ ...previewInput, cwd }) };
    } catch {
      return { type: "res", id: req.id, ok: false, error: { code: "preview_unavailable", message: "Remote push preview failed." } };
    }
  }
  const parsed = readPullRequestPreview(req.params);
  if (!parsed.ok) return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
  const { worktreeId: _worktreeId, ...previewInput } = parsed.value;
  const cwd = await resolveAllowedWorkspace(ctx.runtime, parsed.value, ctx);
  if (!cwd) return { type: "res", id: req.id, ok: false, error: { code: "workspace_not_allowed", message: "Remote delivery requires an exact allowed workspace." } };
  try {
    return { type: "res", id: req.id, ok: true, payload: await ctx.runtime.previewPullRequest({ ...previewInput, cwd }) };
  } catch {
    return { type: "res", id: req.id, ok: false, error: { code: "preview_unavailable", message: "Pull request preview failed." } };
  }
}
