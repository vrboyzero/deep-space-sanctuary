import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  beginMarketplaceExtensionAudit,
  listMarketplaceExtensionAudits,
  reconcileMarketplaceExtensionAudits,
} from "./extension-marketplace-audit.js";
import {
  createEmptyInstalledExtensionLedger,
  saveInstalledExtensionLedger,
  upsertInstalledExtension,
} from "./extension-marketplace-state.js";

const PREVIOUS_CONTENT_SHA256 = "1".repeat(64);
const TARGET_CONTENT_SHA256 = "2".repeat(64);

describe("marketplace extension audit reconciliation", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("completes a confirmed update when the installed ledger proves the target state", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-audit-reconcile-"));
    tempDirs.push(stateDir);
    const audit = await beginMarketplaceExtensionAudit(stateDir, {
      operation: "update",
      extensionId: "demo-plugin@official-market",
      confirmationHash: "3".repeat(64),
      sourceKey: "directory:demo-plugin",
      contentSha256: TARGET_CONTENT_SHA256,
      previousContentSha256: PREVIOUS_CONTENT_SHA256,
      versionLabel: "2.0.0",
      hostApi: 1,
      permissions: [],
      enabled: true,
    });
    await upsertInstalledExtension(stateDir, {
      name: "demo-plugin",
      kind: "plugin",
      marketplace: "official-market",
      version: "2.0.0",
      installPath: path.join(stateDir, "extensions", "materialized", "official-market", "demo-plugin"),
      sourceKey: "directory:demo-plugin",
      contentSha256: TARGET_CONTENT_SHA256,
      approvedHostApi: 1,
      approvedPermissions: [],
      status: "installed",
      enabled: true,
    });

    const reconciled = await reconcileMarketplaceExtensionAudits(stateDir);

    expect(reconciled).toEqual([
      expect.objectContaining({ auditId: audit.auditId, status: "completed" }),
    ]);
    await expect(listMarketplaceExtensionAudits(stateDir)).resolves.toEqual([
      expect.objectContaining({ auditId: audit.auditId, status: "completed" }),
    ]);
  });

  it("marks a confirmed update uncertain when the installed ledger does not prove the target state", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-audit-uncertain-"));
    tempDirs.push(stateDir);
    const audit = await beginMarketplaceExtensionAudit(stateDir, {
      operation: "update",
      extensionId: "demo-plugin@official-market",
      confirmationHash: "4".repeat(64),
      sourceKey: "directory:demo-plugin",
      contentSha256: TARGET_CONTENT_SHA256,
      previousContentSha256: PREVIOUS_CONTENT_SHA256,
      versionLabel: "2.0.0",
      hostApi: 1,
      permissions: [],
      enabled: true,
    });
    await upsertInstalledExtension(stateDir, {
      name: "demo-plugin",
      kind: "plugin",
      marketplace: "official-market",
      version: "1.0.0",
      installPath: path.join(stateDir, "extensions", "materialized", "official-market", "demo-plugin"),
      sourceKey: "directory:demo-plugin",
      contentSha256: PREVIOUS_CONTENT_SHA256,
      approvedHostApi: 1,
      approvedPermissions: [],
      status: "installed",
      enabled: true,
    });

    const reconciled = await reconcileMarketplaceExtensionAudits(stateDir);

    expect(reconciled).toEqual([
      expect.objectContaining({ auditId: audit.auditId, status: "uncertain" }),
    ]);
    await expect(listMarketplaceExtensionAudits(stateDir)).resolves.toEqual([
      expect.objectContaining({ auditId: audit.auditId, status: "uncertain" }),
    ]);
  });

  it("completes a confirmed uninstall when the installed ledger proves the extension is absent", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-audit-uninstall-"));
    tempDirs.push(stateDir);
    await saveInstalledExtensionLedger(stateDir, createEmptyInstalledExtensionLedger());
    const audit = await beginMarketplaceExtensionAudit(stateDir, {
      operation: "uninstall",
      extensionId: "demo-plugin@official-market",
      confirmationHash: "5".repeat(64),
      sourceKey: "directory:demo-plugin",
      contentSha256: TARGET_CONTENT_SHA256,
      versionLabel: "2.0.0",
      hostApi: 1,
      permissions: [],
      enabled: true,
    });

    const reconciled = await reconcileMarketplaceExtensionAudits(stateDir);

    expect(reconciled).toEqual([
      expect.objectContaining({ auditId: audit.auditId, status: "completed" }),
    ]);
  });

  it("keeps a confirmed uninstall uncertain when the entire installed ledger is missing", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-audit-missing-ledger-"));
    tempDirs.push(stateDir);
    const audit = await beginMarketplaceExtensionAudit(stateDir, {
      operation: "uninstall",
      extensionId: "demo-plugin@official-market",
      confirmationHash: "8".repeat(64),
      sourceKey: "directory:demo-plugin",
      contentSha256: TARGET_CONTENT_SHA256,
      versionLabel: "2.0.0",
      hostApi: 1,
      permissions: [],
      enabled: true,
    });

    const reconciled = await reconcileMarketplaceExtensionAudits(stateDir);

    expect(reconciled).toEqual([
      expect.objectContaining({ auditId: audit.auditId, status: "uncertain" }),
    ]);
  });
});
