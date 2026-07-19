import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  assertRuntimeBuildScriptPolicy,
  createRuntimeBuildScriptPolicy,
  resolveRuntimeBuildScriptPolicy,
} from "./runtime-build-script-policy.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const workspacePolicy = {
  onlyBuiltDependencies: ["better-sqlite3", "esbuild"],
  ignoredBuiltDependencies: ["node-pty", "onnxruntime-node", "protobufjs"],
};

describe("runtime build script policy", () => {
  it("rejects full mode when required native backends are ignored", () => {
    expect(() => assertRuntimeBuildScriptPolicy({
      mode: "full",
      ...workspacePolicy,
    })).toThrow(/required allow.*node-pty.*onnxruntime-node.*forbidden ignore.*node-pty.*onnxruntime-node/i);
  });

  it("accepts the same decisions for slim fallback mode", () => {
    expect(assertRuntimeBuildScriptPolicy({
      mode: "slim",
      ...workspacePolicy,
    })).toEqual(expect.objectContaining({
      mode: "slim",
      onlyBuiltDependencies: ["better-sqlite3", "esbuild"],
      ignoredBuiltDependencies: ["node-pty", "onnxruntime-node", "protobufjs"],
    }));
  });

  it("rejects allow and ignore overlap", () => {
    expect(() => assertRuntimeBuildScriptPolicy({
      mode: "slim",
      onlyBuiltDependencies: ["better-sqlite3", "esbuild", "protobufjs"],
      ignoredBuiltDependencies: ["node-pty", "onnxruntime-node", "protobufjs"],
    })).toThrow(/allow\/ignore overlap.*protobufjs/i);
  });

  it("records an explicit reason for every full allow or ignore decision", () => {
    const policy = createRuntimeBuildScriptPolicy("full");

    expect(policy.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ dependency: "node-pty", action: "allow" }),
      expect.objectContaining({ dependency: "onnxruntime-node", action: "allow" }),
      expect.objectContaining({ dependency: "protobufjs", action: "ignore" }),
    ]));
    for (const decision of policy.decisions) {
      expect(decision.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("reads the current workspace policy through pnpm's structured config output", () => {
    expect(resolveRuntimeBuildScriptPolicy({ cwd: workspaceRoot, mode: "slim" })).toEqual(
      expect.objectContaining({ mode: "slim" }),
    );
    expect(() => resolveRuntimeBuildScriptPolicy({ cwd: workspaceRoot, mode: "full" })).toThrow(
      /required allow.*node-pty.*onnxruntime-node/i,
    );
  });
});
