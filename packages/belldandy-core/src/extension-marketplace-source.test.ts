import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getMaterializedExtensionPath,
  getMarketplaceSourceCachePath,
  materializeExtensionMarketplaceSource,
  prepareExtensionMarketplaceSource,
} from "./extension-marketplace-source.js";

describe("extension marketplace source service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("prepares cache metadata and materializes directory sources", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-source-"));
    tempDirs.push(stateDir, sourceDir);

    await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "demo-plugin",
      kind: "plugin",
      version: "1.2.3",
      entry: {
        pluginModule: "dist/plugin.mjs",
      },
    }, null, 2), "utf-8");
    await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "dist", "plugin.mjs"), "export default {};\n", "utf-8");

    const prepared = await prepareExtensionMarketplaceSource({
      stateDir,
      marketplace: "official-market",
      source: {
        source: "directory",
        path: sourceDir,
      },
    });

    expect(prepared.status).toBe("ready");
    expect(prepared.resolvedSourcePath).toBe(path.resolve(sourceDir));
    expect(prepared.cacheDir).toBe(getMarketplaceSourceCachePath(stateDir, "official-market", prepared.sourceKey));

    const metadata = JSON.parse(await fs.readFile(prepared.metadataPath, "utf-8"));
    expect(metadata).toMatchObject({
      version: 1,
      marketplace: "official-market",
      sourceKey: prepared.sourceKey,
      status: "ready",
      resolvedSourcePath: path.resolve(sourceDir),
    });

    const materialized = await materializeExtensionMarketplaceSource({
      stateDir,
      marketplace: "official-market",
      extensionName: "demo-plugin",
      sourceState: prepared,
    });

    expect(materialized.materializedPath).toBe(getMaterializedExtensionPath(stateDir, "official-market", "demo-plugin"));
    expect(materialized.manifestPath).toBe(path.join(materialized.materializedPath, "belldandy-extension.json"));
    expect(materialized.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await fs.readFile(path.join(materialized.materializedPath, "dist", "plugin.mjs"), "utf-8")).toContain("export default");
  });

  it("records deferred metadata for non-directory source adapters", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-state-"));
    tempDirs.push(stateDir);

    const prepared = await prepareExtensionMarketplaceSource({
      stateDir,
      marketplace: "official-market",
      source: {
        source: "github",
        repo: "star-sanctuary/official-market",
        ref: "main",
        manifestPath: "marketplace.json",
      },
    });

    expect(prepared.status).toBe("deferred");
    expect(prepared.note).toBe("Source adapter is not implemented yet for github.");

    await expect(materializeExtensionMarketplaceSource({
      stateDir,
      marketplace: "official-market",
      extensionName: "demo-plugin",
      sourceState: prepared,
    })).rejects.toThrow("is not ready to materialize");
  });
});

