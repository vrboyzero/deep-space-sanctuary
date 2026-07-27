import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listMarketplaceExtensionAudits } from "./extension-marketplace-audit.js";
import {
  disableMarketplaceExtension,
  enableMarketplaceExtension,
  installMarketplaceExtension,
  previewMarketplaceExtensionInstall,
  previewMarketplaceExtensionUninstall,
  previewMarketplaceExtensionUpdate,
  uninstallMarketplaceExtension,
  updateMarketplaceExtension,
} from "./extension-marketplace-service.js";
import {
  getInstalledExtension,
  getKnownMarketplace,
  loadExtensionMarketplaceState,
  upsertInstalledExtension,
} from "./extension-marketplace-state.js";
import { writeExtensionRuntimeLease } from "./extension-runtime-lease.js";

async function createPluginSourceDir(version: string): Promise<string> {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-plugin-"));
  await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
    schemaVersion: 1,
    name: "demo-plugin",
    kind: "plugin",
    version,
    compatibility: { hostApi: 1 },
    permissions: [],
    entry: {
      pluginModule: "dist/plugin.mjs",
    },
  }, null, 2), "utf-8");
  await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), `export default { version: "${version}" };\n`, "utf-8");
  return sourceDir;
}

describe("extension marketplace service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("rejects installing an extension without explicit host compatibility", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-undeclared-"));
    tempDirs.push(stateDir, sourceDir);
    await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "undeclared-plugin",
      kind: "plugin",
      version: "1.0.0",
      entry: { pluginModule: "dist/plugin.mjs" },
      permissions: [],
    }, null, 2), "utf-8");
    await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default {};\n", "utf-8");

    await expect(installMarketplaceExtension({
      stateDir,
      marketplace: "official-market",
      source: { source: "directory", path: sourceDir },
    })).rejects.toThrow("must declare compatibility.hostApi");
  });

  it("reports every supported Host API when rejecting an incompatible extension", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-incompatible-"));
    tempDirs.push(stateDir, sourceDir);
    await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "future-plugin",
      kind: "plugin",
      version: "1.0.0",
      compatibility: { hostApi: 3 },
      permissions: [],
      runtime: { capabilities: [] },
      entry: { pluginModule: "dist/plugin.mjs" },
    }, null, 2), "utf-8");
    await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default {};\n", "utf-8");

    await expect(previewMarketplaceExtensionInstall({
      stateDir,
      marketplace: "official-market",
      source: { source: "directory", path: sourceDir },
    })).rejects.toThrow("supported APIs 1 and 2");
  });

  it("rejects skill directories that are not explicitly approved", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-skill-policy-"));
    tempDirs.push(stateDir, sourceDir);
    await fs.mkdir(path.join(sourceDir, "skills"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "undeclared-skills",
      kind: "skill-pack",
      version: "1.0.0",
      compatibility: { hostApi: 1 },
      permissions: [],
      entry: { skillDirs: ["skills"] },
    }, null, 2), "utf-8");

    await expect(installMarketplaceExtension({
      stateDir,
      marketplace: "official-market",
      source: { source: "directory", path: sourceDir },
    })).rejects.toThrow("skill permissions must match entry.skillDirs");
  });

  it("requires Host API v2 plugins to declare an empty broker capability set", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-v2-state-"));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-v2-source-"));
    tempDirs.push(stateDir, sourceDir);
    await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
    const manifestPath = path.join(sourceDir, "belldandy-extension.json");
    const manifest = {
      schemaVersion: 1,
      name: "isolated-plugin",
      kind: "plugin",
      version: "1.0.0",
      compatibility: { hostApi: 2 },
      permissions: [],
      entry: { pluginModule: "dist/plugin.mjs" },
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default {};\n", "utf8");

    await expect(previewMarketplaceExtensionInstall({
      stateDir,
      marketplace: "official-market",
      source: { source: "directory", path: sourceDir },
    })).rejects.toThrow(/must declare runtime\.capabilities/i);

    await fs.writeFile(manifestPath, JSON.stringify({
      ...manifest,
      runtime: { capabilities: ["workspace:read"] },
    }), "utf8");
    await expect(previewMarketplaceExtensionInstall({
      stateDir,
      marketplace: "official-market",
      source: { source: "directory", path: sourceDir },
    })).rejects.toThrow(/broker capabilities are not supported/i);
  });

  it("requires an exact trust preview confirmation before installation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await createPluginSourceDir("1.2.3");
    tempDirs.push(stateDir, sourceDir);
    const input = {
      stateDir,
      marketplace: "official-market",
      source: { source: "directory" as const, path: sourceDir },
      autoUpdate: true,
    };

    const preview = await previewMarketplaceExtensionInstall(input);
    expect(preview).toMatchObject({
      version: 1,
      operation: "install",
      extensionId: "demo-plugin@official-market",
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      permissions: [],
      hostApi: 1,
      enabled: true,
      autoUpdate: true,
      confirmationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(installMarketplaceExtension(input)).rejects.toThrow("requires an exact trust preview confirmation");
    await expect(installMarketplaceExtension({
      ...input,
      confirmationHash: preview.confirmationHash,
    })).resolves.toMatchObject({
      installed: { id: "demo-plugin@official-market" },
    });
  });

  it("rejects uninstall when the ledger target is outside the managed materialized root", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await createPluginSourceDir("1.2.3");
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-outside-"));
    tempDirs.push(stateDir, sourceDir, outsideDir);
    const sentinelPath = path.join(outsideDir, "keep.txt");
    await fs.writeFile(sentinelPath, "must remain\n", "utf-8");

    const installInput = {
      stateDir,
      marketplace: "official-market",
      source: { source: "directory" as const, path: sourceDir },
    };
    const installPreview = await previewMarketplaceExtensionInstall(installInput);
    const installed = await installMarketplaceExtension({
      ...installInput,
      confirmationHash: installPreview.confirmationHash,
    });
    await upsertInstalledExtension(stateDir, {
      ...installed.installed,
      installPath: outsideDir,
    });

    const uninstallInput = {
      stateDir,
      extensionId: installed.installed.id,
    };
    const uninstallPreview = await previewMarketplaceExtensionUninstall(uninstallInput);
    await expect(uninstallMarketplaceExtension({
      ...uninstallInput,
      confirmationHash: uninstallPreview.confirmationHash,
    })).rejects.toThrow("managed materialized root");

    await expect(fs.readFile(sentinelPath, "utf-8")).resolves.toBe("must remain\n");
    await expect(getInstalledExtension(stateDir, installed.installed.id)).resolves.toBeDefined();
  });

  it("installs, toggles, updates, and uninstalls a directory marketplace extension", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await createPluginSourceDir("1.2.3");
    tempDirs.push(stateDir, sourceDir);

    const installInput = {
      stateDir,
      marketplace: "official-market",
      source: {
        source: "directory" as const,
        path: sourceDir,
      },
      autoUpdate: true,
    };
    const installPreview = await previewMarketplaceExtensionInstall(installInput);
    const installed = await installMarketplaceExtension({
      ...installInput,
      confirmationHash: installPreview.confirmationHash,
    });

    expect(installed.manifest.version).toBe("1.2.3");
    expect(installed.installed.enabled).toBe(true);
    expect(installed.installed.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.installed.approvedAt).toBe(installed.materialized.materializedAt);
    expect(installed.installed.approvedHostApi).toBe(1);
    expect(installed.installed.approvedPermissions).toEqual([]);
    expect(installed.audit).toMatchObject({ operation: "install", status: "completed" });
    expect(await fs.readFile(path.join(installed.installed.installPath, "dist", "plugin.mjs"), "utf-8")).toContain("1.2.3");

    const knownMarketplace = await getKnownMarketplace(stateDir, "official-market");
    expect(knownMarketplace).toMatchObject({
      name: "official-market",
      autoUpdate: true,
      source: {
        source: "directory",
        path: sourceDir,
      },
    });

    const disabled = await disableMarketplaceExtension(stateDir, installed.installed.id);
    expect(disabled.enabled).toBe(false);
    const reenabled = await enableMarketplaceExtension(stateDir, installed.installed.id);
    expect(reenabled.enabled).toBe(true);

    await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "demo-plugin",
      kind: "plugin",
      version: "1.2.4",
      compatibility: { hostApi: 1 },
      permissions: [],
      entry: {
        pluginModule: "dist/plugin.mjs",
      },
    }, null, 2), "utf-8");
    await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default { version: \"1.2.4\" };\n", "utf-8");

    const updateInput = {
      stateDir,
      extensionId: installed.installed.id,
    };
    const updatePreview = await previewMarketplaceExtensionUpdate(updateInput);
    expect(updatePreview).toMatchObject({
      operation: "update",
      extensionId: installed.installed.id,
      currentContentSha256: installed.installed.contentSha256,
      versionLabel: "1.2.4",
    });
    await expect(updateMarketplaceExtension(updateInput))
      .rejects.toThrow("requires an exact trust preview confirmation");
    const updated = await updateMarketplaceExtension({
      ...updateInput,
      confirmationHash: updatePreview.confirmationHash,
    });
    expect(updated.installed.version).toBe("1.2.4");
    expect(updated.audit).toMatchObject({ operation: "update", status: "completed" });
    expect(updated.installed.installedAt).toBe(installed.installed.installedAt);
    expect(await fs.readFile(path.join(updated.installed.installPath, "dist", "plugin.mjs"), "utf-8")).toContain("1.2.4");

    const snapshot = await loadExtensionMarketplaceState(stateDir);
    expect(snapshot.summary).toMatchObject({
      installedExtensionCount: 1,
      disabledExtensionCount: 0,
    });

    const uninstallInput = {
      stateDir,
      extensionId: installed.installed.id,
    };
    const uninstallPreview = await previewMarketplaceExtensionUninstall(uninstallInput);
    expect(uninstallPreview).toMatchObject({
      operation: "uninstall",
      extensionId: installed.installed.id,
      contentSha256: updated.installed.contentSha256,
      permissions: [],
    });
    await expect(uninstallMarketplaceExtension(uninstallInput))
      .rejects.toThrow("requires an exact trust preview confirmation");
    const removed = await uninstallMarketplaceExtension({
      ...uninstallInput,
      confirmationHash: uninstallPreview.confirmationHash,
    });
    expect(removed.removed.id).toBe(installed.installed.id);
    expect(removed.audit).toMatchObject({ operation: "uninstall", status: "completed" });
    await expect(fs.stat(installed.installed.installPath)).rejects.toThrow();
    expect(await getInstalledExtension(stateDir, installed.installed.id)).toBeUndefined();
    expect((await listMarketplaceExtensionAudits(stateDir)).map((audit) => audit.operation)).toEqual([
      "install",
      "update",
      "uninstall",
    ]);
  });

  it("blocks disable, update, and uninstall while an isolated runtime lease is active", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-active-runtime-"));
    const sourceDir = await createPluginSourceDir("1.0.0");
    tempDirs.push(stateDir, sourceDir);
    const installInput = {
      stateDir,
      marketplace: "official-market",
      source: { source: "directory" as const, path: sourceDir },
    };
    const installPreview = await previewMarketplaceExtensionInstall(installInput);
    const installed = await installMarketplaceExtension({
      ...installInput,
      confirmationHash: installPreview.confirmationHash,
    });
    const updateInput = { stateDir, extensionId: installed.installed.id };
    const updatePreview = await previewMarketplaceExtensionUpdate(updateInput);
    const uninstallPreview = await previewMarketplaceExtensionUninstall(updateInput);
    await writeExtensionRuntimeLease(stateDir, {
      version: 1,
      runtime: "docker",
      leaseId: "12345678-1234-4234-8234-123456789abc",
      containerName: "belldandy-extension-12345678123442348234123456789abc",
      extensionId: installed.installed.id,
      contentSha256: installed.installed.contentSha256!,
    });

    await expect(disableMarketplaceExtension(stateDir, installed.installed.id))
      .rejects.toThrow(/runtime is active/i);
    await expect(updateMarketplaceExtension({
      ...updateInput,
      confirmationHash: updatePreview.confirmationHash,
    })).rejects.toThrow(/runtime is active/i);
    await expect(uninstallMarketplaceExtension({
      ...updateInput,
      confirmationHash: uninstallPreview.confirmationHash,
    })).rejects.toThrow(/runtime is active/i);

    expect((await getInstalledExtension(stateDir, installed.installed.id))?.enabled).toBe(true);
    await expect(fs.stat(installed.installed.installPath)).resolves.toBeDefined();
  });
});

