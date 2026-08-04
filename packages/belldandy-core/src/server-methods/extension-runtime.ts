import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import type { ExtensionRuntimeSupervisor } from "../extension-runtime-supervisor.js";

type ExtensionRuntimeMethodContext = {
  runtime?: ExtensionRuntimeSupervisor;
};

type MarketplaceRuntimeMutation = "disable" | "update" | "uninstall";

const MARKETPLACE_REVOKE_REASONS: Record<MarketplaceRuntimeMutation, string> = {
  disable: "marketplace_disable",
  update: "marketplace_update",
  uninstall: "marketplace_uninstall",
};

function parseRevokeParams(value: unknown):
  | { ok: true; extensionId: string; operation: MarketplaceRuntimeMutation }
  | { ok: false } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const params = value as Record<string, unknown>;
  if (Object.keys(params).length !== 2 || !("extensionId" in params) || !("operation" in params)) {
    return { ok: false };
  }
  const extensionId = typeof params.extensionId === "string" ? params.extensionId.trim() : "";
  const operation = params.operation;
  if (!extensionId || (operation !== "disable" && operation !== "update" && operation !== "uninstall")) {
    return { ok: false };
  }
  return { ok: true, extensionId, operation };
}

/** Pairing-protected owner handoff from Marketplace CLI mutation to the live Supervisor. */
export async function handleExtensionRuntimeMethod(
  req: GatewayReqFrame,
  ctx: ExtensionRuntimeMethodContext,
): Promise<GatewayResFrame> {
  if (req.method !== "extension.runtime.revoke") {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "unsupported", message: "Extension runtime method is unsupported." },
    };
  }
  const parsed = parseRevokeParams(req.params);
  if (!parsed.ok) {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "invalid_params", message: "extensionId and a supported operation are required." },
    };
  }
  if (!ctx.runtime) {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "runtime_unavailable", message: "Extension runtime Supervisor is unavailable." },
    };
  }
  try {
    const revoked = await ctx.runtime.revoke(
      parsed.extensionId,
      MARKETPLACE_REVOKE_REASONS[parsed.operation],
    );
    if (!revoked) {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: { code: "runtime_not_active", message: "Extension runtime has no active owner." },
      };
    }
    return {
      type: "res",
      id: req.id,
      ok: true,
      payload: {
        revoked: true,
        extensionId: parsed.extensionId,
        operation: parsed.operation,
      },
    };
  } catch {
    return {
      type: "res",
      id: req.id,
      ok: false,
      error: { code: "runtime_revoke_failed", message: "Extension runtime revoke failed." },
    };
  }
}
