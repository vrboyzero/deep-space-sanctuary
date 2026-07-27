import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { RemoteDeliveryRuntime } from "../remote-delivery-runtime.js";
import { handleRemoteDeliveryMethod } from "./remote-delivery.js";

function createRuntimeStub() {
  return {
    listTargets: vi.fn(() => [{
      remote: "private",
      url: "https://github.com/example/private.git",
      pushBranches: ["main"],
      pullRequestBases: ["main"],
      repository: "example/private",
    }]),
    resolveRepositoryRoot: vi.fn(async (cwd: string) => cwd),
    previewPush: vi.fn(async () => ({ operation: "push", canConfirm: true, blockers: [] })),
    previewPullRequest: vi.fn(async () => ({ operation: "pull_request", canConfirm: true, blockers: [] })),
    confirm: vi.fn(async (input: { operation: string }) => ({ operation: input.operation, applied: true, blockers: [] })),
    listAudit: vi.fn(async () => []),
  } as unknown as RemoteDeliveryRuntime;
}

describe("remote delivery Gateway methods", () => {
  it("allows preview only for an exact workspace root and rejects forged fields", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-remote-method-"));
    try {
      const workspace = path.join(rootDir, "workspace");
      const outside = path.join(rootDir, "outside");
      await fs.mkdir(workspace);
      await fs.mkdir(outside);
      const runtime = createRuntimeStub();

      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "preview",
        method: "workspace.remote_delivery.push.preview",
        params: { cwd: workspace, remote: "private", targetBranch: "main" },
      }, { runtime, additionalWorkspaceRoots: [workspace] })).resolves.toMatchObject({
        ok: true,
        payload: { operation: "push", canConfirm: true },
      });
      expect(runtime.previewPush).toHaveBeenCalledWith({
        cwd: workspace,
        remote: "private",
        targetBranch: "main",
      });

      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "outside",
        method: "workspace.remote_delivery.push.preview",
        params: { cwd: outside, remote: "private", targetBranch: "main" },
      }, { runtime, additionalWorkspaceRoots: [workspace] })).resolves.toMatchObject({
        ok: false,
        error: { code: "workspace_not_allowed" },
      });
      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "forged",
        method: "workspace.remote_delivery.push.preview",
        params: { cwd: workspace, remote: "private", targetBranch: "main", force: true },
      }, { runtime, additionalWorkspaceRoots: [workspace] })).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_params" },
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("accepts only explicit receipt confirmation and never accepts a refspec or remote override", async () => {
    const runtime = createRuntimeStub();
    await expect(handleRemoteDeliveryMethod({
      type: "req",
      id: "confirm",
      method: "workspace.remote_delivery.push.confirm",
      params: { receiptId: "remote-delivery-receipt", confirm: true },
    }, { runtime })).resolves.toMatchObject({ ok: true, payload: { operation: "push", applied: true } });
    expect(runtime.confirm).toHaveBeenCalledWith({
      operation: "push",
      receiptId: "remote-delivery-receipt",
      confirm: true,
    });

    await expect(handleRemoteDeliveryMethod({
      type: "req",
      id: "forged-confirm",
      method: "workspace.remote_delivery.push.confirm",
      params: {
        receiptId: "remote-delivery-receipt",
        confirm: true,
        remote: "origin",
        refspec: "+HEAD:main",
      },
    }, { runtime })).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
    await expect(handleRemoteDeliveryMethod({
      type: "req",
      id: "not-confirmed",
      method: "workspace.remote_delivery.push.confirm",
      params: { receiptId: "remote-delivery-receipt", confirm: false },
    }, { runtime })).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
  });

  it("keeps PR payload in preview/confirm only and validates audit limits", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-remote-pr-method-"));
    try {
      const runtime = createRuntimeStub();
      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "pr-preview",
        method: "workspace.remote_delivery.pull_request.preview",
        params: {
          cwd: rootDir,
          remote: "private",
          headBranch: "feature/exact",
          baseBranch: "main",
          title: "feat: exact",
          body: "body",
        },
      }, { runtime, additionalWorkspaceRoots: [rootDir] })).resolves.toMatchObject({ ok: true });
      expect(runtime.previewPullRequest).toHaveBeenCalledWith(expect.objectContaining({ title: "feat: exact", body: "body" }));

      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "pr-confirm",
        method: "workspace.remote_delivery.pull_request.confirm",
        params: { receiptId: "remote-delivery-receipt", confirm: true, title: "feat: exact", body: "body" },
      }, { runtime })).resolves.toMatchObject({ ok: true });
      expect(runtime.confirm).toHaveBeenCalledWith(expect.objectContaining({
        operation: "pull_request",
        title: "feat: exact",
        body: "body",
      }));

      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "audit",
        method: "workspace.remote_delivery.audit.list",
        params: { limit: 25 },
      }, { runtime })).resolves.toMatchObject({ ok: true, payload: { audits: [] } });
      expect(runtime.listAudit).toHaveBeenCalledWith(25);
      await expect(handleRemoteDeliveryMethod({
        type: "req",
        id: "audit-invalid",
        method: "workspace.remote_delivery.audit.list",
        params: { limit: 0 },
      }, { runtime })).resolves.toMatchObject({ ok: false, error: { code: "invalid_params" } });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
