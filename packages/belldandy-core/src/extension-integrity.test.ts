import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installMarketplaceExtension } from "./extension-marketplace-service.js";
import { upsertInstalledExtension } from "./extension-marketplace-state.js";
import { computeMaterializedExtensionContentSha256 } from "./extension-marketplace-source.js";
import { verifyInstalledMarketplaceExtension } from "./extension-integrity.js";

async function createInstalledPluginFixture(tempDirs: string[]): Promise<{
  stateDir: string;
  installed: Awaited<ReturnType<typeof installMarketplaceExtension>>["installed"];
}> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-integrity-state-"));
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-integrity-source-"));
  tempDirs.push(stateDir, sourceDir);
  await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
    schemaVersion: 1,
    name: "trusted-plugin",
    kind: "plugin",
    version: "1.0.0",
    entry: { pluginModule: "dist/plugin.mjs" },
  }, null, 2), "utf-8");
  await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default {};\n", "utf-8");
  const result = await installMarketplaceExtension({
    stateDir,
    marketplace: "official-market",
    source: { source: "directory", path: sourceDir },
  });
  return { stateDir, installed: result.installed };
}

describe("Marketplace extension integrity", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("only exposes verified manifest, plugin entry, and install root", async () => {
    const { stateDir, installed } = await createInstalledPluginFixture(tempDirs);

    await expect(verifyInstalledMarketplaceExtension({ stateDir, extension: installed })).resolves.toMatchObject({
      manifest: { name: "trusted-plugin", kind: "plugin", version: "1.0.0" },
      pluginModulePath: path.join(installed.installPath, "dist", "plugin.mjs"),
    });
  });

  it("rejects changed installed content before plugin activation", async () => {
    const { stateDir, installed } = await createInstalledPluginFixture(tempDirs);
    await fs.writeFile(path.join(installed.installPath, "dist", "plugin.mjs"), "export default { changed: true };\n", "utf-8");

    await expect(verifyInstalledMarketplaceExtension({ stateDir, extension: installed }))
      .rejects.toThrow("content integrity mismatch");
  });

  it("rejects a ledger path replacement outside the materialized identity", async () => {
    const { stateDir, installed } = await createInstalledPluginFixture(tempDirs);
    const replaced = { ...installed, installPath: path.join(stateDir, "outside-extension") };

    await expect(verifyInstalledMarketplaceExtension({ stateDir, extension: replaced }))
      .rejects.toThrow("install path does not match its approved identity");
  });

  it("rejects a symlink or junction replacement before resolving the plugin entry", async () => {
    const { stateDir, installed } = await createInstalledPluginFixture(tempDirs);
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-extension-integrity-outside-"));
    tempDirs.push(outsideDir);
    await fs.rm(installed.installPath, { recursive: true, force: true });
    await fs.symlink(
      outsideDir,
      installed.installPath,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(verifyInstalledMarketplaceExtension({ stateDir, extension: installed }))
      .rejects.toThrow("escapes the approved materialized root");
  });

  it("rejects a manifest identity changed after recomputing the content hash", async () => {
    const { stateDir, installed } = await createInstalledPluginFixture(tempDirs);
    const manifestPath = path.join(installed.installPath, "belldandy-extension.json");
    await fs.writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      name: "other-plugin",
      kind: "plugin",
      version: "1.0.0",
      entry: { pluginModule: "dist/plugin.mjs" },
    }, null, 2), "utf-8");
    const updatedLedger = await upsertInstalledExtension(stateDir, {
      ...installed,
      contentSha256: await computeMaterializedExtensionContentSha256(installed.installPath),
    });
    const updated = updatedLedger.extensions[installed.id];

    await expect(verifyInstalledMarketplaceExtension({ stateDir, extension: updated }))
      .rejects.toThrow("manifest does not match its approved identity");
  });
});
