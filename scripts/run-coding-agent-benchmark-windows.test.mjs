import { EventEmitter } from "node:events";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildWindowsBenchmarkInvocation,
  stopWindowsBenchmarkGateway,
} from "./run-coding-agent-benchmark-windows.mjs";

const workspaceRoot = "E:/project/star-sanctuary/.tmp/clean-harness";

describe("coding agent benchmark Windows launcher", () => {
  it("binds the Gateway allowlist and ephemeral token to the actual benchmark endpoint", () => {
    const invocation = buildWindowsBenchmarkInvocation({
      workspaceRoot,
      gatewayStateRoot: "E:/project/star-sanctuary/tmp/runtime",
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-formal",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
      attempt: 1,
      taskId: "real-ts.api-migration",
      manifestRevision: "v3",
      sourceRoot: workspaceRoot,
      v3RepositoryConfig: "E:/project/star-sanctuary/tmp/repository-inputs.json",
      maxTotalCostUsd: 0.1,
      host: "127.0.0.1",
      port: 28895,
      authMode: "token",
    }, {
      baseEnv: {
        BELLDANDY_ALLOWED_ORIGINS: "http://127.0.0.1:28889",
        BELLDANDY_OPENAI_API_KEY: "sensitive-provider-key",
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
        BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
      },
      randomToken: () => "ephemeral-gateway-token",
      resolvePath: (value) => path.win32.resolve(value),
      nodePath: "C:/Program Files/nodejs/node.exe",
    });

    expect(invocation.gateway).toMatchObject({
      command: "C:/Program Files/nodejs/node.exe",
      args: ["packages/belldandy-core/dist/bin/gateway.js"],
      cwd: path.win32.resolve(workspaceRoot),
    });
    expect(invocation.gateway.env).toMatchObject({
      BELLDANDY_HOST: "127.0.0.1",
      BELLDANDY_PORT: "28895",
      BELLDANDY_AUTH_MODE: "token",
      BELLDANDY_AUTH_TOKEN: "ephemeral-gateway-token",
      BELLDANDY_ALLOWED_ORIGINS: "http://127.0.0.1:28895",
      BELLDANDY_AGENT_PROVIDER: "openai",
      BELLDANDY_OPENAI_MODEL: "deepseek-v4-flash",
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
    });
    expect(invocation.benchmark.env).toBe(invocation.gateway.env);
    expect(invocation.benchmark.args).toEqual(expect.arrayContaining([
      "--platform", "windows-native",
      "--model-id", "deepseek-v4-flash",
      "--credentials-configured", "true",
      "--manifest-revision", "v3",
      "--task-id", "real-ts.api-migration",
      "--max-total-cost-usd", "0.1",
    ]));
    expect(invocation.benchmark.args.join(" ")).not.toContain("ephemeral-gateway-token");
    expect(invocation.benchmark.args.join(" ")).not.toContain("sensitive-provider-key");
  });

  it("uses no auth secret for an explicit auth-none diagnostic run", () => {
    const invocation = buildWindowsBenchmarkInvocation({
      workspaceRoot,
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-dry-run",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
      authMode: "none",
    }, {
      baseEnv: {},
      randomToken: () => {
        throw new Error("must not generate token");
      },
      resolvePath: (value) => path.win32.resolve(value),
      nodePath: "node.exe",
    });

    expect(invocation.gateway.env).toMatchObject({
      BELLDANDY_AUTH_MODE: "none",
      BELLDANDY_ALLOWED_ORIGINS: "http://127.0.0.1:28889",
      BELLDANDY_STATE_DIR: path.win32.resolve("E:/project/star-sanctuary/tmp/runtime"),
      BELLDANDY_ENV_DIR: path.win32.resolve("E:/project/star-sanctuary/tmp/runtime"),
    });
    expect(invocation.paths.gatewayStateRoot).toBe(path.win32.resolve("E:/project/star-sanctuary/tmp/runtime"));
    expect(invocation.gateway.env).not.toHaveProperty("BELLDANDY_AUTH_TOKEN");
  });

  it("rejects split Gateway and Coding CI state roots before spawning", () => {
    expect(() => buildWindowsBenchmarkInvocation({
      workspaceRoot,
      gatewayStateRoot: "E:/project/star-sanctuary/tmp/runtime/gateway-state",
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-formal",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
    }, {
      resolvePath: (value) => path.win32.resolve(value),
    })).toThrow(/share the same state root.*pairing/i);
  });

  it("rejects formal runs without complete model pricing before spawning", () => {
    expect(() => buildWindowsBenchmarkInvocation({
      workspaceRoot,
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-formal",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
    }, {
      baseEnv: {
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
      },
      resolvePath: (value) => path.win32.resolve(value),
    })).toThrow(/BELLDANDY_MODEL_OUTPUT_USD_PER_1M.*pricing/i);
  });

  it("disables unaccounted primary warmup calls for controlled benchmark runs", () => {
    const invocation = buildWindowsBenchmarkInvocation({
      workspaceRoot,
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-formal",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
    }, {
      baseEnv: {
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
        BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
      },
      resolvePath: (value) => path.win32.resolve(value),
    });

    expect(invocation.gateway.env.BELLDANDY_PRIMARY_WARMUP_ENABLED).toBe("false");
    expect(invocation.benchmark.env).toBe(invocation.gateway.env);
  });

  it("rejects non-loopback Gateway endpoints", () => {
    expect(() => buildWindowsBenchmarkInvocation({
      workspaceRoot,
      gatewayStateRoot: "E:/project/star-sanctuary/tmp/runtime",
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-formal",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
      host: "0.0.0.0",
    })).toThrow(/loopback/i);
  });

  it("terminates the exact Gateway child and escalates only after the grace period", async () => {
    const child = new EventEmitter();
    child.pid = 43210;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => true);
    const taskkill = vi.fn(() => ({ status: 0, stderr: "" }));

    await stopWindowsBenchmarkGateway(child, {
      platform: "win32",
      gracePeriodMs: 1,
      spawnSync: taskkill,
    });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(taskkill).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "43210", "/T", "/F"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("does not run taskkill after the Gateway confirms exit", async () => {
    const child = new EventEmitter();
    child.pid = 43211;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      queueMicrotask(() => child.emit("close", 0, null));
      return true;
    });
    const taskkill = vi.fn();

    await stopWindowsBenchmarkGateway(child, {
      platform: "win32",
      gracePeriodMs: 50,
      spawnSync: taskkill,
    });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(taskkill).not.toHaveBeenCalled();
  });
});
