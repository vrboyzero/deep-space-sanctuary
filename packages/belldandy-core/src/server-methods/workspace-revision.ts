import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import type { WorkspaceRevisionRuntime } from "../workspace-revision.js";

type WorkspaceRevisionMethodContext = {
  runtime?: WorkspaceRevisionRuntime;
};

function asParams(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readRevisionLookup(value: unknown):
  | { ok: true; value: { revisionId: string; workspaceId?: string } }
  | { ok: false; message: string } {
  const params = asParams(value);
  const revisionId = typeof params?.revisionId === "string" ? params.revisionId.trim() : "";
  const workspaceId = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
  if (!revisionId) return { ok: false, message: "revisionId must be a non-empty string" };
  if (params && Object.keys(params).some((key) => key !== "revisionId" && key !== "workspaceId" && key !== "apply")) {
    return { ok: false, message: "params contains unsupported fields" };
  }
  return { ok: true, value: { revisionId, ...(workspaceId ? { workspaceId } : {}) } };
}

export async function handleWorkspaceRevisionMethod(
  req: GatewayReqFrame,
  ctx: WorkspaceRevisionMethodContext,
): Promise<GatewayResFrame> {
  if (!ctx.runtime) {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "unsupported", message: "Workspace revision runtime is unavailable." },
    };
  }
  try {
    if (req.method === "workspace.revision.list") {
      if (req.params !== undefined && !asParams(req.params)) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "params must be an object" } };
      }
      return { type: "res", id: req.id, ok: true, payload: { checkpoints: await ctx.runtime.list() } };
    }

    const parsed = readRevisionLookup(req.params);
    if (!parsed.ok) {
      return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: parsed.message } };
    }
    if (req.method === "workspace.revision.preview") {
      return { type: "res", id: req.id, ok: true, payload: await ctx.runtime.previewRestore(parsed.value) };
    }
    if (req.method === "workspace.revision.restore") {
      const params = asParams(req.params);
      if (params && "apply" in params && params.apply !== true && params.apply !== false) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "apply must be a boolean" } };
      }
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: await ctx.runtime.restore({ ...parsed.value, apply: params?.apply === true }),
      };
    }
    return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: "Unknown workspace revision method." } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: {
        code: /not found/i.test(message) ? "not_found" : "workspace_revision_failed",
        message,
      },
    };
  }
}
