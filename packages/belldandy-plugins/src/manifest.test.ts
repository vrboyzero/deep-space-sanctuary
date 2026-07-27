import { describe, expect, it } from "vitest";

import {
  formatExtensionId,
  parseExtensionManifest,
  parseMarketplaceManifest,
} from "./manifest.js";

describe("manifest parsing", () => {
  it("parses the Host API v2 runtime declaration separately from registration permissions", () => {
    const manifest = parseExtensionManifest({
      schemaVersion: 1,
      name: "isolated-plugin",
      kind: "plugin",
      version: "1.0.0",
      compatibility: { hostApi: 2 },
      permissions: ["tool:pure_echo"],
      runtime: { capabilities: [] },
      entry: { pluginModule: "dist/plugin.mjs" },
    });

    expect(manifest.permissions).toEqual(["tool:pure_echo"]);
    expect(manifest.runtime).toEqual({ capabilities: [] });
  });

  it("parses host compatibility and fine-grained activation permissions", () => {
    const manifest = parseExtensionManifest({
      schemaVersion: 1,
      name: "trusted-plugin",
      kind: "plugin",
      version: "1.0.0",
      compatibility: {
        hostApi: 1,
      },
      permissions: [
        "tool:trusted_search",
        "hook:beforeToolCall",
        "skill:skills\\common",
      ],
      entry: {
        pluginModule: "dist/plugin.mjs",
        skillDirs: ["skills/common"],
      },
    });

    expect(manifest.compatibility).toEqual({ hostApi: 1 });
    expect(manifest.permissions).toEqual([
      "tool:trusted_search",
      "hook:beforeToolCall",
      "skill:skills/common",
    ]);
  });

  it("parses minimal plugin extension manifest", () => {
    const manifest = parseExtensionManifest({
      schemaVersion: 1,
      name: "demo-plugin",
      kind: "plugin",
      version: "1.2.3",
      description: "demo",
      entry: {
        pluginModule: "dist/plugin.mjs",
        skillDirs: ["skills/common"],
      },
      capabilities: {
        tools: true,
        hooks: true,
      },
      dependencies: ["base-kit"],
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      name: "demo-plugin",
      kind: "plugin",
      version: "1.2.3",
      description: "demo",
      author: undefined,
      entry: {
        pluginModule: "dist/plugin.mjs",
        skillDirs: ["skills/common"],
      },
      capabilities: {
        tools: true,
        hooks: true,
        skills: undefined,
      },
      dependencies: ["base-kit"],
    });
    expect(formatExtensionId(manifest.name, "builtin")).toBe("demo-plugin@builtin");
  });

  it("rejects plugin manifest with invalid relative path", () => {
    expect(() =>
      parseExtensionManifest({
        schemaVersion: 1,
        name: "demo-plugin",
        kind: "plugin",
        version: "1.2.3",
        entry: {
          pluginModule: "../escape.mjs",
        },
      }),
    ).toThrow("parent directory traversal");
  });

  it("parses marketplace manifest entries with heterogeneous sources", () => {
    const manifest = parseMarketplaceManifest({
      schemaVersion: 1,
      name: "official-market",
      extensions: [
        {
          name: "demo-plugin",
          kind: "plugin",
          version: "1.2.3",
          manifestPath: "packages/demo/belldandy-extension.json",
          source: {
            source: "github",
            repo: "star-sanctuary/demo-plugin",
            ref: "main",
          },
        },
        {
          name: "ops-skills",
          kind: "skill-pack",
          source: {
            source: "directory",
            path: "E:/marketplace/ops-skills",
          },
        },
      ],
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      name: "official-market",
      description: undefined,
      extensions: [
        {
          name: "demo-plugin",
          kind: "plugin",
          version: "1.2.3",
          description: undefined,
          manifestPath: "packages/demo/belldandy-extension.json",
          source: {
            source: "github",
            repo: "star-sanctuary/demo-plugin",
            ref: "main",
            manifestPath: undefined,
          },
        },
        {
          name: "ops-skills",
          kind: "skill-pack",
          version: undefined,
          description: undefined,
          manifestPath: undefined,
          source: {
            source: "directory",
            path: "E:/marketplace/ops-skills",
          },
        },
      ],
    });
  });
});
