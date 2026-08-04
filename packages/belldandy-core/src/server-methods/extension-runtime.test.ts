import { describe, expect, it, vi } from "vitest";

import type { ExtensionRuntimeSupervisor } from "../extension-runtime-supervisor.js";
import { handleExtensionRuntimeMethod } from "./extension-runtime.js";

function createRuntime(revoke: ExtensionRuntimeSupervisor["revoke"]): ExtensionRuntimeSupervisor {
  return { revoke } as ExtensionRuntimeSupervisor;
}

describe("extension runtime Gateway methods", () => {
  it("revokes the exact extension with an operation-bound reason", async () => {
    const revoke = vi.fn(async () => true);

    await expect(handleExtensionRuntimeMethod({
      type: "req",
      id: "revoke-update",
      method: "extension.runtime.revoke",
      params: {
        extensionId: "demo-plugin@official-market",
        operation: "update",
      },
    }, { runtime: createRuntime(revoke) })).resolves.toMatchObject({
      type: "res",
      id: "revoke-update",
      ok: true,
      payload: {
        revoked: true,
        extensionId: "demo-plugin@official-market",
        operation: "update",
      },
    });
    expect(revoke).toHaveBeenCalledWith("demo-plugin@official-market", "marketplace_update");
  });

  it("rejects unsupported fields, operations, and unavailable runtimes", async () => {
    const runtime = createRuntime(vi.fn(async () => true));
    await expect(handleExtensionRuntimeMethod({
      type: "req",
      id: "forged",
      method: "extension.runtime.revoke",
      params: { extensionId: "demo-plugin@official-market", operation: "disable", force: true },
    }, { runtime })).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
    await expect(handleExtensionRuntimeMethod({
      type: "req",
      id: "invalid-operation",
      method: "extension.runtime.revoke",
      params: { extensionId: "demo-plugin@official-market", operation: "install" },
    }, { runtime })).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
    await expect(handleExtensionRuntimeMethod({
      type: "req",
      id: "unavailable",
      method: "extension.runtime.revoke",
      params: { extensionId: "demo-plugin@official-market", operation: "uninstall" },
    }, {})).resolves.toMatchObject({ ok: false, error: { code: "runtime_unavailable" } });
  });

  it("fails closed when the Supervisor cannot revoke or reports no active owner", async () => {
    await expect(handleExtensionRuntimeMethod({
      type: "req",
      id: "not-active",
      method: "extension.runtime.revoke",
      params: { extensionId: "demo-plugin@official-market", operation: "disable" },
    }, { runtime: createRuntime(vi.fn(async () => false)) })).resolves.toMatchObject({
      ok: false,
      error: { code: "runtime_not_active" },
    });
    await expect(handleExtensionRuntimeMethod({
      type: "req",
      id: "revoke-failed",
      method: "extension.runtime.revoke",
      params: { extensionId: "demo-plugin@official-market", operation: "uninstall" },
    }, { runtime: createRuntime(vi.fn(async () => { throw new Error("close failed"); })) })).resolves.toMatchObject({
      ok: false,
      error: { code: "runtime_revoke_failed" },
    });
  });
});
