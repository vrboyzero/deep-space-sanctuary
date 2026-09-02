import path from "node:path";
import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  buildWslBenchmarkInvocation,
  resolveWslGatewayHost,
  runWslBenchmark,
  verifyWslBenchmarkGatewayReachability,
} from "./run-coding-agent-benchmark-wsl.mjs";

describe("coding agent benchmark WSL launcher", () => {
  it("resolves the Windows host from the target WSL2 default route", () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: "default via 172.27.128.1 dev eth0 proto kernel\n",
      stderr: "",
    }));

    expect(resolveWslGatewayHost("Ubuntu-22.04", { spawnSync: run })).toBe("172.27.128.1");
    expect(run).toHaveBeenCalledWith(
      "wsl.exe",
      ["--distribution", "Ubuntu-22.04", "--exec", "ip", "-4", "route", "show", "default"],
      expect.objectContaining({ windowsHide: true, encoding: "utf-8" }),
    );
  });

  it("fails closed when the target WSL2 distribution cannot reach the Gateway", () => {
    const run = vi.fn(() => ({ status: 3, stdout: "", stderr: "" }));

    expect(() => verifyWslBenchmarkGatewayReachability({
      distribution: "Ubuntu-22.04",
      host: "172.27.128.1",
      port: 28945,
    }, { spawnSync: run })).toThrow(/cannot reach the Windows Gateway/i);
    expect(run).toHaveBeenCalledWith(
      "wsl.exe",
      expect.arrayContaining([
        "--distribution", "Ubuntu-22.04",
        "--exec", "node", "-e",
        "172.27.128.1", "28945",
      ]),
      expect.objectContaining({ windowsHide: true, timeout: 5_000 }),
    );
  });

  it("does not start the benchmark runner before the WSL2 Gateway probe passes", async () => {
    const start = vi.fn();
    const runWindowsBenchmark = vi.fn(async (_input, dependencies) => await dependencies.runBenchmark({
      endpoint: {
        host: "172.27.128.1",
        port: 28945,
        authMode: "token",
        authToken: "ephemeral-token",
      },
    }));

    await expect(runWslBenchmark({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
      host: "172.27.128.1",
      port: "28945",
    }, {
      baseEnv: {},
      resolvePath: (value) => path.win32.resolve(value),
      toWslPath(value) {
        return `/mnt/e/${path.win32.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
      spawn: start,
      spawnSync: () => ({ status: 3, stdout: "", stderr: "" }),
      runWindowsBenchmark,
    })).rejects.toThrow(/cannot reach the Windows Gateway/i);
    expect(runWindowsBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "172.27.128.1",
        gatewayAccess: "wsl2",
        workspaceRoot: "E:/project/star-sanctuary",
        sourceRoot: "E:/project/star-sanctuary",
      }),
      expect.objectContaining({ runBenchmark: expect.any(Function) }),
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("starts the Linux runner through the ready Windows Gateway lifecycle", async () => {
    const child = new EventEmitter();
    const start = vi.fn(() => child);
    const runWindowsBenchmark = vi.fn(async (_input, dependencies) => await dependencies.runBenchmark({
      endpoint: {
        host: "172.27.128.1",
        port: 28945,
        authMode: "token",
        authToken: "ephemeral-token",
      },
    }));
    queueMicrotask(() => child.emit("close", 0));

    await expect(runWslBenchmark({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
      host: "172.27.128.1",
      port: "28945",
    }, {
      baseEnv: {},
      resolvePath: (value) => path.win32.resolve(value),
      toWslPath(value) {
        return `/mnt/e/${path.win32.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
      spawn: start,
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      runWindowsBenchmark,
    })).resolves.toBe(0);

    expect(start).toHaveBeenCalledOnce();
    const invocation = start.mock.calls[0];
    expect(invocation[1]).toEqual(expect.arrayContaining([
      "BELLDANDY_HOST=172.27.128.1",
      "BELLDANDY_PORT=28945",
      "BELLDANDY_AUTH_MODE=token",
    ]));
    expect(invocation[1].join(" ")).not.toContain("ephemeral-token");
    expect(invocation[2].env).toMatchObject({
      BELLDANDY_AUTH_TOKEN: "ephemeral-token",
      WSLENV: "BELLDANDY_AUTH_TOKEN",
    });
  });

  it("builds one shell-free WSL2 invocation with translated paths and non-sensitive model identity", () => {
    const invocation = buildWslBenchmarkInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
      attempt: 2,
      infrastructureRetries: 1,
      taskId: "command.interactive-control",
      priorObservedCostUsd: 0.75,
      maxTotalCostUsd: 2.5,
      shadowCandidateId: "code-intel-semantic-live-v1",
      manifestRevision: "v2",
      sourceRoot: "E:/project/star-sanctuary-source-fd70990",
    }, {
      baseEnv: {},
      resolvePath: (value) => path.win32.resolve(value),
      toWslPath(value) {
        return `/mnt/e/${path.win32.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
    });

    expect(invocation.command).toBe("wsl.exe");
    expect(invocation.args).toEqual([
      "--distribution", "Ubuntu-22.04",
      "--exec", "env",
      "BELLDANDY_HOST=127.0.0.1",
      "BELLDANDY_PORT=28889",
      "BELLDANDY_AUTH_MODE=none",
      "BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT=2048",
      "node", "/mnt/e/project/star-sanctuary/scripts/run-coding-agent-benchmark.mjs",
      "--platform", "wsl2-linux",
      "--fixture-root", "/mnt/e/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      "--gateway-fixture-root", "E:\\project\\star-sanctuary\\.tmp\\coding-agent-fixtures-wsl",
      "--artifact-root", "/mnt/e/project/star-sanctuary/artifacts/coding-agent-wsl",
      "--state-root", "/mnt/e/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      "--provider", "openai",
      "--model-id", "deepseek-v4-flash",
      "--credentials-configured", "true",
      "--attempt", "2",
      "--infrastructure-retries", "1",
      "--task-id", "command.interactive-control",
      "--prior-observed-cost-usd", "0.75",
      "--max-total-cost-usd", "2.5",
      "--shadow-candidate-id", "code-intel-semantic-live-v1",
      "--manifest-revision", "v2",
      "--source-root", "/mnt/e/project/star-sanctuary-source-fd70990",
    ]);
    expect(invocation.args.join(" ")).not.toContain("api-key");
  });

  it("rejects infrastructure retry counts above the frozen manifest limit", () => {
    expect(() => buildWslBenchmarkInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
      infrastructureRetries: 2,
    }, windowsPathDependencies())).toThrow(/infrastructure retries.*0-1/i);
  });

  it("passes token auth through WSLENV without placing the token in command arguments", () => {
    const invocation = buildWslBenchmarkInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
      authMode: "token",
      authToken: "fixture-auth-token",
    }, {
      baseEnv: { WSLENV: "EXISTING/u" },
      resolvePath: (value) => path.win32.resolve(value),
      toWslPath(value) {
        return `/mnt/e/${path.win32.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
    });

    expect(invocation.args).toContain("BELLDANDY_AUTH_MODE=token");
    expect(invocation.args).not.toContain("BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT=2048");
    expect(invocation.args.join(" ")).not.toContain("fixture-auth-token");
    expect(invocation.env).toMatchObject({
      BELLDANDY_AUTH_TOKEN: "fixture-auth-token",
      WSLENV: "EXISTING/u:BELLDANDY_AUTH_TOKEN",
    });
  });

  it("forwards benchmark pricing to the WSL runner preflight", () => {
    const invocation = buildWslBenchmarkInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
    }, {
      baseEnv: {
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
        BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
        BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.0025",
      },
      resolvePath: (value) => path.win32.resolve(value),
      toWslPath(value) {
        return `/mnt/e/${path.win32.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
    });

    expect(invocation.args).toEqual(expect.arrayContaining([
      "BELLDANDY_MODEL_INPUT_USD_PER_1M=0.125",
      "BELLDANDY_MODEL_OUTPUT_USD_PER_1M=0.25",
      "BELLDANDY_MODEL_CACHE_READ_USD_PER_1M=0.0025",
    ]));
  });

  it("rejects a UNC fixture root before launching a Windows Gateway snapshot", () => {
    expect(() => buildWslBenchmarkInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "\\\\wsl.localhost\\Ubuntu-22.04\\var\\tmp\\coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
    }, windowsPathDependencies())).toThrow(/fixtureRoot must use a local Windows drive path/i);
  });

  it("prepends one explicit WSL toolchain bin without accepting PATH-list injection", () => {
    const baseInput = {
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
    };
    const invocation = buildWslBenchmarkInvocation({
      ...baseInput,
      toolchainBin: "/var/tmp/star-sanctuary/toolchains/go/bin/",
    }, windowsPathDependencies());

    expect(invocation.args).toContain(
      "PATH=/var/tmp/star-sanctuary/toolchains/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    expect(() => buildWslBenchmarkInvocation({
      ...baseInput,
      toolchainBin: "/trusted/bin:/untrusted/bin",
    }, windowsPathDependencies())).toThrow(/single absolute Linux directory/i);
    expect(() => buildWslBenchmarkInvocation({
      ...baseInput,
      toolchainBin: "relative/bin",
    }, windowsPathDependencies())).toThrow(/single absolute Linux directory/i);
  });

  it("translates and forwards a v3 repository config without requiring a source root", () => {
    const invocation = buildWslBenchmarkInvocation({
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-v3-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-v3-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-v3-wsl",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: true,
      taskId: "real-js.bug-fix",
      manifestRevision: "v3",
      v3RepositoryConfig: "E:/project/star-sanctuary/.tmp/v3-wsl/repository-inputs.json",
    }, windowsPathDependencies());

    expect(invocation.args).toEqual(expect.arrayContaining([
      "BELLDANDY_TOOL_RESULT_EVENT_OUTPUT_CHAR_LIMIT=2048",
      "--manifest-revision", "v3",
      "--v3-repository-config", "/mnt/e/project/star-sanctuary/.tmp/v3-wsl/repository-inputs.json",
    ]));
    expect(invocation.args).not.toContain("--source-root");
  });

  it("accepts v3 A-layer launches without repository input and rejects cross-revision config", () => {
    const baseInput = {
      distribution: "Ubuntu-22.04",
      workspaceRoot: "E:/project/star-sanctuary",
      fixtureRoot: "E:/project/star-sanctuary/.tmp/coding-agent-fixtures-v3-wsl",
      artifactRoot: "E:/project/star-sanctuary/artifacts/coding-agent-v3-wsl",
      stateRoot: "E:/project/star-sanctuary/artifacts/coding-agent-state-v3-wsl",
      provider: "fixture",
      modelId: "v3-a-layer-fixture",
      credentialsConfigured: false,
      taskId: "rules.nested-precedence",
    };
    const invocation = buildWslBenchmarkInvocation({
      ...baseInput,
      manifestRevision: "v3",
    }, windowsPathDependencies());
    expect(invocation.args).toEqual(expect.arrayContaining(["--manifest-revision", "v3"]));
    expect(invocation.args).not.toContain("--v3-repository-config");

    expect(() => buildWslBenchmarkInvocation({
      ...baseInput,
      manifestRevision: "v2",
      sourceRoot: "E:/project/star-sanctuary-source",
      v3RepositoryConfig: "E:/project/star-sanctuary/.tmp/v3-wsl/repository-inputs.json",
    }, windowsPathDependencies())).toThrow(/repository config requires manifestRevision v3/i);
    expect(() => buildWslBenchmarkInvocation({
      ...baseInput,
      manifestRevision: "v4",
    }, windowsPathDependencies())).toThrow(/v1, v2, or v3/i);
  });
});

function windowsPathDependencies() {
  return {
    baseEnv: {},
    resolvePath: (value) => path.win32.resolve(value),
    toWslPath(value) {
      return `/mnt/e/${path.win32.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
    },
  };
}
