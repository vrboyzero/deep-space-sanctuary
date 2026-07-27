import fs from "node:fs/promises";
import path from "node:path";

import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import type { ConversationRunRegistry } from "../conversation-run-registry.js";
import type { UserWorktreeOperation, UserWorktreeRuntime } from "../user-worktree-runtime.js";

type WorkspaceWorktreeMethodContext = {
  runtime?: UserWorktreeRuntime;
  conversationRunRegistry?: ConversationRunRegistry;
  additionalWorkspaceRoots?: string[];
};

function asParams(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readStatusLookup(value: unknown):
  | { ok: true; worktreeId?: string }
  | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  if (Object.keys(params).some((key) => key !== "worktreeId")) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  if (params.worktreeId === undefined) return { ok: true };
  const worktreeId = typeof params.worktreeId === "string" ? params.worktreeId.trim() : "";
  if (!worktreeId) return { ok: false, message: "worktreeId must be a non-empty string" };
  return { ok: true, worktreeId };
}

function readCreateInput(value: unknown):
  | { ok: true; value: { cwd: string; owner: { conversationId: string; runId: string } } }
  | { ok: false; message: string } {
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  if (Object.keys(params).some((key) => key !== "cwd" && key !== "conversationId" && key !== "runId")) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  const cwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
  const conversationId = typeof params.conversationId === "string" ? params.conversationId.trim() : "";
  const runId = typeof params.runId === "string" ? params.runId.trim() : "";
  if (!cwd || !path.isAbsolute(cwd)) return { ok: false, message: "cwd must be a non-empty absolute path" };
  if (!conversationId) return { ok: false, message: "conversationId must be a non-empty string" };
  if (!runId) return { ok: false, message: "runId must be a non-empty string" };
  return { ok: true, value: { cwd, owner: { conversationId, runId } } };
}

function readOperationPreviewInput(value: unknown, operation: UserWorktreeOperation):
  | { ok: true; value: { worktreeId: string; commitMessage?: string; branchName?: string } }
  | { ok: false; message: string } {
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  if (Object.keys(params).some((key) => key !== "worktreeId"
    && (operation !== "commit" || key !== "message")
    && (operation !== "branch" || key !== "branch"))) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  const worktreeId = typeof params.worktreeId === "string" ? params.worktreeId.trim() : "";
  if (!worktreeId) return { ok: false, message: "worktreeId must be a non-empty string" };
  if (operation === "commit") {
    const commitMessage = typeof params.message === "string" ? params.message : "";
    if (!commitMessage.trim()) return { ok: false, message: "message must be a non-empty string" };
    return { ok: true, value: { worktreeId, commitMessage } };
  }
  if (operation === "branch") {
    const branchName = typeof params.branch === "string" ? params.branch.trim() : "";
    if (!branchName) return { ok: false, message: "branch must be a non-empty string" };
    return { ok: true, value: { worktreeId, branchName } };
  }
  return { ok: true, value: { worktreeId } };
}

function readOperationConfirmInput(value: unknown):
  | { ok: true; value: { worktreeId: string; receiptId: string; confirm: true } }
  | { ok: false; message: string } {
  const params = asParams(value);
  if (!params) return { ok: false, message: "params must be an object" };
  if (Object.keys(params).some((key) => key !== "worktreeId" && key !== "receiptId" && key !== "confirm")) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  const worktreeId = typeof params.worktreeId === "string" ? params.worktreeId.trim() : "";
  const receiptId = typeof params.receiptId === "string" ? params.receiptId.trim() : "";
  if (!worktreeId) return { ok: false, message: "worktreeId must be a non-empty string" };
  if (!receiptId) return { ok: false, message: "receiptId must be a non-empty string" };
  if (params.confirm !== true) return { ok: false, message: "confirm must be true" };
  return { ok: true, value: { worktreeId, receiptId, confirm: true } };
}

function isUnderRoot(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function resolveAllowedSourceRoot(
  runtime: UserWorktreeRuntime,
  cwd: string,
  additionalWorkspaceRoots: string[],
): Promise<string | undefined> {
  let resolvedCwd: string;
  let repoRoot: string;
  try {
    resolvedCwd = await fs.realpath(cwd);
    repoRoot = await fs.realpath(await runtime.resolveSourceRepository(resolvedCwd));
  } catch {
    return undefined;
  }
  const roots = (await Promise.all(additionalWorkspaceRoots.map(async (root) => {
    try {
      return await fs.realpath(root);
    } catch {
      return undefined;
    }
  }))).filter((root): root is string => Boolean(root));
  return roots.some((root) => isUnderRoot(root, resolvedCwd) && isUnderRoot(root, repoRoot))
    ? resolvedCwd
    : undefined;
}

/** Gateway control plane for persisted user worktrees. Writes require a trusted preview receipt. */
export async function handleWorkspaceWorktreeMethod(
  req: GatewayReqFrame,
  ctx: WorkspaceWorktreeMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.runtime) {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "unsupported", message: "User worktree runtime is unavailable." },
    };
  }
  const operationMethod = new Map<string, { operation: UserWorktreeOperation; action: "preview" | "confirm" }>([
    ["workspace.worktree.apply.preview", { operation: "apply", action: "preview" }],
    ["workspace.worktree.apply.confirm", { operation: "apply", action: "confirm" }],
    ["workspace.worktree.remove.preview", { operation: "remove", action: "preview" }],
    ["workspace.worktree.remove.confirm", { operation: "remove", action: "confirm" }],
    ["workspace.worktree.stage.preview", { operation: "stage", action: "preview" }],
    ["workspace.worktree.stage.confirm", { operation: "stage", action: "confirm" }],
    ["workspace.worktree.commit.preview", { operation: "commit", action: "preview" }],
    ["workspace.worktree.commit.confirm", { operation: "commit", action: "confirm" }],
    ["workspace.worktree.branch.preview", { operation: "branch", action: "preview" }],
    ["workspace.worktree.branch.confirm", { operation: "branch", action: "confirm" }],
  ]).get(req.method);
  if (operationMethod) {
    if (operationMethod.action === "preview") {
      const previewInput = readOperationPreviewInput(req.params, operationMethod.operation);
      if (!previewInput.ok) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: previewInput.message } };
      }
      try {
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: await ctx.runtime.preview({ operation: operationMethod.operation, ...previewInput.value }),
        };
      } catch {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "preview_unavailable", message: "Failed to preview the managed user worktree operation." },
        };
      }
    }
    const confirmInput = readOperationConfirmInput(req.params);
    if (!confirmInput.ok) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: confirmInput.message } };
    }
    try {
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: await ctx.runtime.confirm({ operation: operationMethod.operation, ...confirmInput.value }),
      };
    } catch {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "confirmation_unavailable", message: "Failed to confirm the managed user worktree operation." },
      };
    }
  }
  if (req.method === "workspace.worktree.create") {
    const createInput = readCreateInput(req.params);
    if (!createInput.ok) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: createInput.message } };
    }
    const activeRun = ctx.conversationRunRegistry?.getRun(
      createInput.value.owner.conversationId,
      createInput.value.owner.runId,
    );
    if (!activeRun || activeRun.state !== "running") {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "owner_not_active", message: "User worktree creation requires an active exact conversation/run binding." },
      };
    }
    const cwd = await resolveAllowedSourceRoot(ctx.runtime, createInput.value.cwd, ctx.additionalWorkspaceRoots ?? []);
    if (!cwd) {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "workspace_not_allowed", message: "User worktree source must resolve inside an allowed workspace root." },
      };
    }
    try {
      const worktree = await ctx.runtime.create({ cwd, owner: createInput.value.owner });
      return { type: "res", id: req.id, ok: true, payload: { worktree } };
    } catch {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "create_failed", message: "Failed to create a managed user worktree." },
      };
    }
  }
  if (req.method === "workspace.worktree.diff") {
    const lookup = readStatusLookup(req.params);
    if (!lookup.ok) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: lookup.message } };
    }
    if (!lookup.worktreeId) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "worktreeId is required" } };
    }
    try {
      return { type: "res", id: req.id, ok: true, payload: await ctx.runtime.diff(lookup.worktreeId) };
    } catch {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "diff_unavailable", message: "Failed to create a managed user worktree diff." },
      };
    }
  }
  const lookup = readStatusLookup(req.params);
  if (!lookup.ok) {
    return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: lookup.message } };
  }
  try {
    if (lookup.worktreeId) {
      const worktree = await ctx.runtime.getStatus(lookup.worktreeId);
      if (!worktree) {
        return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: "Managed user worktree was not found." } };
      }
      return { type: "res", id: req.id, ok: true, payload: { worktrees: [worktree] } };
    }
    return { type: "res", id: req.id, ok: true, payload: { worktrees: await ctx.runtime.listStatus() } };
  } catch {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "unavailable", message: "Failed to inspect managed user worktrees." },
    };
  }
}
