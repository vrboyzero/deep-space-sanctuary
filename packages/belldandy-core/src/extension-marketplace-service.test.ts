import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  disableMarketplaceExtension,
  enableMarketplaceExtension,
  installMarketplaceExtension,
  uninstallMarketplaceExtension,
  updateMarketplaceExtension,
} from "./extension-marketplace-service.js";
import { getInstalledExtension, getKnownMarketplace, loadExtensionMarketplaceState } from "./extension-marketplace-state.js";

async function createPluginSourceDir(version: string): Promise<string> {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-plugin-"));
  await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
    schemaVersion: 1,
    name: "demo-plugin",
    kind: "plugin",
    version,
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

  it("installs, toggles, updates, and uninstalls a directory marketplace extension", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await createPluginSourceDir("1.2.3");
    tempDirs.push(stateDir, sourceDir);

    const installed = await installMarketplaceExtension({
      stateDir,
      marketplace: "official-market",
      source: {
        source: "directory",
        path: sourceDir,
      },
      autoUpdate: true,
    });

    expect(installed.manifest.version).toBe("1.2.3");
    expect(installed.installed.enabled).toBe(true);
    expect(installed.installed.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(installed.installed.approvedAt).toBe(installed.materialized.materializedAt);
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
      entry: {
        pluginModule: "dist/plugin.mjs",
      },
    }, null, 2), "utf-8");
    await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default { version: \"1.2.4\" };\n", "utf-8");

    const updated = await updateMarketplaceExtension({
      stateDir,
      extensionId: installed.installed.id,
    });
    expect(updated.installed.version).toBe("1.2.4");
    expect(updated.installed.installedAt).toBe(installed.installed.installedAt);
    expect(await fs.readFile(path.join(updated.installed.installPath, "dist", "plugin.mjs"), "utf-8")).toContain("1.2.4");

    const snapshot = await loadExtensionMarketplaceState(stateDir);
    expect(snapshot.summary).toMatchObject({
      installedExtensionCount: 1,
      disabledExtensionCount: 0,
    });

    const removed = await uninstallMarketplaceExtension({
      stateDir,
      extensionId: installed.installed.id,
    });
    expect(removed.removed.id).toBe(installed.installed.id);
    await expect(fs.stat(installed.installed.installPath)).rejects.toThrow();
    expect(await getInstalledExtension(stateDir, installed.installed.id)).toBeUndefined();
  });
});

