import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildWslBenchmarkInvocation } from "./run-coding-agent-benchmark-wsl.mjs";

describe("coding agent benchmark WSL launcher", () => {
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
      taskId: "command.interactive-control",
      priorObservedCostUsd: 0.75,
    }, {
      toWslPath(value) {
        return `/mnt/e/${path.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
    });

    expect(invocation.command).toBe("wsl.exe");
    expect(invocation.args).toEqual([
      "--distribution", "Ubuntu-22.04",
      "--exec", "env",
      "BELLDANDY_HOST=127.0.0.1",
      "BELLDANDY_PORT=28889",
      "BELLDANDY_AUTH_MODE=none",
      "node", "/mnt/e/project/star-sanctuary/scripts/run-coding-agent-benchmark.mjs",
      "--platform", "wsl2-linux",
      "--fixture-root", "/mnt/e/project/star-sanctuary/.tmp/coding-agent-fixtures-wsl",
      "--artifact-root", "/mnt/e/project/star-sanctuary/artifacts/coding-agent-wsl",
      "--state-root", "/mnt/e/project/star-sanctuary/artifacts/coding-agent-state-wsl",
      "--provider", "openai",
      "--model-id", "deepseek-v4-flash",
      "--credentials-configured", "true",
      "--attempt", "2",
      "--task-id", "command.interactive-control",
      "--prior-observed-cost-usd", "0.75",
    ]);
    expect(invocation.args.join(" ")).not.toContain("api-key");
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
      toWslPath(value) {
        return `/mnt/e/${path.resolve(value).replace(/^E:[\\/]/i, "").replaceAll("\\", "/")}`;
      },
    });

    expect(invocation.args).toContain("BELLDANDY_AUTH_MODE=token");
    expect(invocation.args.join(" ")).not.toContain("fixture-auth-token");
    expect(invocation.env).toMatchObject({
      BELLDANDY_AUTH_TOKEN: "fixture-auth-token",
      WSLENV: "EXISTING/u:BELLDANDY_AUTH_TOKEN",
    });
  });
});
