import { describe, expect, it } from "vitest";

import {
  assertFrozenOfflineInstallArgs,
  createRuntimeDependencyInstallArgs,
  createRuntimeDependencyPrefetchArgs,
  createRuntimeRootPackageJson,
  sanitizeRuntimeWorkspacePackageJson,
} from "./runtime-dependency-assembler-policy.mjs";

const commandOptions = {
  includeOptionalNative: false,
  storeDir: "C:\\cache\\portable-store",
};

describe("runtime dependency assembler policy", () => {
  it("rejects an install command that can fall back to the registry or rewrite the lockfile", () => {
    const registryCapableArgs = [
      "pnpm",
      "install",
      "--prod",
      "--prefer-offline",
      "--no-frozen-lockfile",
    ];

    expect(() => assertFrozenOfflineInstallArgs(registryCapableArgs)).toThrow(
      /offline.*frozen-lockfile.*prefer-offline.*no-frozen-lockfile/i,
    );
  });

  it("creates a frozen offline install for slim and full modes", () => {
    const slimArgs = createRuntimeDependencyInstallArgs(commandOptions);
    const fullArgs = createRuntimeDependencyInstallArgs({
      ...commandOptions,
      includeOptionalNative: true,
    });

    expect(slimArgs).toContain("--offline");
    expect(slimArgs).toContain("--frozen-lockfile");
    expect(slimArgs).toContain("--no-optional");
    expect(slimArgs).not.toContain("--prefer-offline");
    expect(slimArgs).not.toContain("--no-frozen-lockfile");
    expect(fullArgs).not.toContain("--no-optional");
    expect(assertFrozenOfflineInstallArgs(slimArgs)).toBe(slimArgs);
    expect(assertFrozenOfflineInstallArgs(fullArgs)).toBe(fullArgs);
  });

  it("keeps network-capable lockfile resolution and fetch outside the assembler install", () => {
    const { lockfileArgs, fetchArgs } = createRuntimeDependencyPrefetchArgs(commandOptions);

    expect(lockfileArgs).toEqual(expect.arrayContaining([
      "pnpm",
      "install",
      "--lockfile-only",
      "--no-frozen-lockfile",
      "--no-optional",
    ]));
    expect(fetchArgs).toEqual(expect.arrayContaining([
      "pnpm",
      "fetch",
      "--frozen-lockfile",
      "--prefer-offline",
      "--no-optional",
    ]));
    expect(lockfileArgs).not.toContain("--offline");
    expect(fetchArgs).not.toContain("--offline");
  });

  it("creates deterministic runtime manifests for lockfile generation and assembly", () => {
    const rootManifest = createRuntimeRootPackageJson({
      packageManager: "pnpm@10.23.0",
      engines: { node: ">=22.12.0" },
      pnpm: {
        overrides: { vite: "6.4.3" },
        patchedDependencies: { "fastembed@2.1.0": "patches/fastembed.patch" },
      },
      sqliteVecVersion: "0.1.7-alpha.2",
    });
    const sourcePackage = {
      name: "@belldandy/example",
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      scripts: { build: "tsc -b" },
      dependencies: { zod: "^3.24.0" },
      devDependencies: { typescript: "^5.7.3" },
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
    };

    expect(rootManifest).toEqual({
      name: "star-sanctuary-portable-runtime",
      private: true,
      type: "module",
      packageManager: "pnpm@10.23.0",
      engines: { node: ">=22.12.0" },
      pnpm: {
        overrides: { vite: "6.4.3" },
        patchedDependencies: { "fastembed@2.1.0": "patches/fastembed.patch" },
      },
      dependencies: {
        "sqlite-vec-windows-x64": "0.1.7-alpha.2",
      },
    });
    expect(sanitizeRuntimeWorkspacePackageJson(sourcePackage)).toEqual({
      name: "@belldandy/example",
      type: "module",
      main: "./dist/index.js",
      dependencies: { zod: "^3.24.0" },
      exports: {
        ".": {
          import: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
    });
  });
});
