import { EventEmitter } from "node:events";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildWindowsChildEnvironment,
  buildWindowsBenchmarkInvocation,
  classifyGatewayReadinessFailure,
  loadWindowsProviderEnvironment,
  resolveWindowsBenchmarkSourceEnvironment,
  stopWindowsBenchmarkGateway,
} from "./run-coding-agent-benchmark-windows.mjs";

const workspaceRoot = "E:/project/star-sanctuary/.tmp/clean-harness";

describe("coding agent benchmark Windows launcher", () => {
  it("classifies readiness failures without retaining error content", () => {
    expect(classifyGatewayReadinessFailure(new Error("Windows benchmark Gateway readiness timed out.")))
      .toBe("gateway_readiness_timeout");
    expect(classifyGatewayReadinessFailure(new Error("Windows benchmark Gateway exited before readiness.")))
      .toBe("gateway_exited_before_readiness");
    expect(classifyGatewayReadinessFailure(new Error("Windows benchmark Gateway authentication probe timed out.")))
      .toBe("gateway_auth_probe_timeout");
    expect(classifyGatewayReadinessFailure(new Error("secret=must-not-persist")))
      .toBe("gateway_startup_failed");
  });

  it("reads only allowlisted OpenAI settings from an explicit provider env file", async () => {
    const readFile = vi.fn(async () => [
      "BELLDANDY_OPENAI_API_KEY=provider-key",
      "BELLDANDY_OPENAI_BASE_URL=https://api.deepseek.com",
      'BELLDANDY_OPENAI_WIRE_API="chat_completions"',
      "BELLDANDY_MODEL_INPUT_USD_PER_1M=999",
      "BELLDANDY_LOG_DIR=E:/user-state/logs",
      "DASHSCOPE_API_KEY=other-provider-key",
    ].join("\n"));

    await expect(loadWindowsProviderEnvironment("E:/control/.env.local", { readFile }))
      .resolves.toEqual({
        BELLDANDY_OPENAI_API_KEY: "provider-key",
        BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
        BELLDANDY_OPENAI_WIRE_API: "chat_completions",
      });
    expect(readFile).toHaveBeenCalledWith("E:/control/.env.local", "utf-8");
  });

  it("lets an explicit provider env file replace present-empty parent values", async () => {
    const loadProviderEnvironment = vi.fn(async () => ({
      BELLDANDY_OPENAI_API_KEY: "provider-key",
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
    }));

    await expect(resolveWindowsBenchmarkSourceEnvironment({
      providerEnvFile: "E:/control/.env.local",
    }, {
      baseEnv: {
        Path: "C:/Windows/System32",
        BELLDANDY_OPENAI_API_KEY: "",
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.375",
      },
      resolvePath: (value) => path.win32.resolve(value),
      loadProviderEnvironment,
    })).resolves.toMatchObject({
      Path: "C:/Windows/System32",
      BELLDANDY_OPENAI_API_KEY: "provider-key",
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.375",
    });
    expect(loadProviderEnvironment).toHaveBeenCalledWith(
      path.win32.resolve("E:/control/.env.local"),
    );
  });

  it("forwards only host, pricing, command sandbox, and allowlisted OpenAI configuration to children", () => {
    const childEnv = buildWindowsChildEnvironment({
      Path: "C:/Windows/System32",
      BELLDANDY_OPENAI_API_KEY: "sensitive-provider-key",
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_OPENAI_WIRE_API: "chat_completions",
      BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.0125",
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.375",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "1.125",
      BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
      BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
      BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: "node:22-bullseye@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      BELLDANDY_LOG_DIR: "",
      BELLDANDY_MODEL_CONFIG_FILE: "E:/user-state/models.json",
      BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/outside-scope",
      UNRELATED_PROJECT_SETTING: "must-not-cross-process-boundary",
    }, {
      credentialsConfigured: true,
      provider: "openai",
    });

    expect(childEnv).toMatchObject({
      Path: "C:/Windows/System32",
      BELLDANDY_OPENAI_API_KEY: "sensitive-provider-key",
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_OPENAI_WIRE_API: "chat_completions",
      BELLDANDY_MODEL_CACHE_READ_USD_PER_1M: "0.0125",
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.375",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "1.125",
      BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
      BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
      BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: "node:22-bullseye@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(childEnv).not.toHaveProperty("BELLDANDY_LOG_DIR");
    expect(childEnv).not.toHaveProperty("BELLDANDY_MODEL_CONFIG_FILE");
    expect(childEnv).not.toHaveProperty("BELLDANDY_EXTRA_WORKSPACE_ROOTS");
    expect(childEnv).not.toHaveProperty("UNRELATED_PROJECT_SETTING");
  });

  it("keeps non-secret OpenAI routing but drops the API key for zero-credential children", () => {
    const childEnv = buildWindowsChildEnvironment({
      BELLDANDY_OPENAI_API_KEY: "sensitive-provider-key",
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_OPENAI_WIRE_API: "chat_completions",
      BELLDANDY_MODEL_CONFIG_FILE: "E:/user-state/models.json",
    }, {
      credentialsConfigured: false,
      provider: "openai",
    });

    expect(childEnv).toMatchObject({
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_OPENAI_WIRE_API: "chat_completions",
    });
    expect(childEnv).not.toHaveProperty("BELLDANDY_OPENAI_API_KEY");
    expect(childEnv).not.toHaveProperty("BELLDANDY_MODEL_CONFIG_FILE");
  });

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
        BELLDANDY_STATE_DIR_WINDOWS: "H:/user-state",
        BELLDANDY_OPENAI_API_KEY: "sensitive-provider-key",
        BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
        BELLDANDY_OPENAI_WIRE_API: "chat_completions",
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
        BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
        BELLDANDY_LOG_DIR: "",
        BELLDANDY_EXTRA_WORKSPACE_ROOTS: "E:/outside-scope",
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
      BELLDANDY_STATE_DIR_WINDOWS: path.win32.resolve("E:/project/star-sanctuary/tmp/runtime"),
      BELLDANDY_AGENT_PROVIDER: "openai",
      BELLDANDY_OPENAI_MODEL: "deepseek-v4-flash",
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_OPENAI_WIRE_API: "chat_completions",
      BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.125",
      BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "0.25",
    });
    expect(invocation.gateway.env).not.toHaveProperty("BELLDANDY_LOG_DIR");
    expect(invocation.gateway.env).not.toHaveProperty("BELLDANDY_EXTRA_WORKSPACE_ROOTS");
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

  it("strips inherited Provider credentials from zero-credential dry-runs", () => {
    const invocation = buildWindowsBenchmarkInvocation({
      workspaceRoot,
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/windows-dry-run",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
    }, {
      baseEnv: {
        BELLDANDY_OPENAI_API_KEY: "sensitive-provider-key",
        BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
        BELLDANDY_OPENAI_WIRE_API: "chat_completions",
        BELLDANDY_MODEL_CONFIG_FILE: "E:/user-state/models.json",
        BELLDANDY_MODEL_PREFERRED_PROVIDERS: "fallback",
      },
      randomToken: () => "ephemeral-gateway-token",
      resolvePath: (value) => path.win32.resolve(value),
      nodePath: "node.exe",
    });

    expect(invocation.gateway.env).not.toHaveProperty("BELLDANDY_OPENAI_API_KEY");
    expect(invocation.gateway.env).toMatchObject({
      BELLDANDY_OPENAI_BASE_URL: "https://api.deepseek.com",
      BELLDANDY_OPENAI_WIRE_API: "chat_completions",
    });
    expect(invocation.gateway.env).not.toHaveProperty("BELLDANDY_MODEL_CONFIG_FILE");
    expect(invocation.gateway.env).not.toHaveProperty("BELLDANDY_MODEL_PREFERRED_PROVIDERS");
    expect(invocation.benchmark.env).toBe(invocation.gateway.env);
    expect(invocation.benchmark.args).toEqual(expect.arrayContaining([
      "--credentials-configured", "false",
    ]));
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

  it("forces zero Provider retry while keeping benchmark command tools available", () => {
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
        BELLDANDY_MODEL_INPUT_USD_PER_1M: "0.375",
        BELLDANDY_MODEL_OUTPUT_USD_PER_1M: "1.125",
        BELLDANDY_OPENAI_MAX_RETRIES: "9",
        BELLDANDY_DANGEROUS_TOOLS_ENABLED: "false",
      },
      resolvePath: (value) => path.win32.resolve(value),
    });

    expect(invocation.gateway.env).toMatchObject({
      BELLDANDY_OPENAI_MAX_RETRIES: "0",
      BELLDANDY_DANGEROUS_TOOLS_ENABLED: "true",
    });
    expect(invocation.benchmark.env).toBe(invocation.gateway.env);
  });

  it("disables unaccounted background runtime for controlled benchmark runs", () => {
    const disabledRuntimeKeys = [
      "AUTO_OPEN_BROWSER",
      "BELLDANDY_PRIMARY_WARMUP_ENABLED",
      "BELLDANDY_MEMORY_ENABLED",
      "BELLDANDY_EMBEDDING_ENABLED",
      "BELLDANDY_MEMORY_SUMMARY_ENABLED",
      "BELLDANDY_MEMORY_EVOLUTION_ENABLED",
      "BELLDANDY_TASK_MEMORY_ENABLED",
      "BELLDANDY_TASK_SUMMARY_ENABLED",
      "BELLDANDY_COMPACTION_ENABLED",
      "BELLDANDY_UPDATE_CHECK",
      "BELLDANDY_HEARTBEAT_ENABLED",
      "BELLDANDY_CRON_ENABLED",
      "BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED",
      "BELLDANDY_DREAM_AUTO_CRON_ENABLED",
      "BELLDANDY_BROWSER_RELAY_ENABLED",
      "BELLDANDY_MCP_ENABLED",
      "BELLDANDY_CHANNEL_ROUTER_ENABLED",
      "BELLDANDY_EMAIL_SMTP_ENABLED",
      "BELLDANDY_EMAIL_IMAP_ENABLED",
      "BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED",
      "BELLDANDY_DISCORD_ENABLED",
      "BELLDANDY_COMMUNITY_API_ENABLED",
      "BELLDANDY_AGENT_BRIDGE_ENABLED",
      "BELLDANDY_INJECT_MEMORY",
      "BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED",
      "BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED",
      "BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED",
      "BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED",
    ];
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
        ...Object.fromEntries(disabledRuntimeKeys.map((key) => [key, "true"])),
      },
      resolvePath: (value) => path.win32.resolve(value),
    });

    expect(invocation.gateway.env).toMatchObject(
      Object.fromEntries(disabledRuntimeKeys.map((key) => [key, "false"])),
    );
    expect(invocation.benchmark.env).toBe(invocation.gateway.env);
  });

  it("clears inherited channel credentials for controlled benchmark runs", () => {
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
        BELLDANDY_FEISHU_APP_ID: "inherited-feishu-id",
        BELLDANDY_FEISHU_APP_SECRET: "inherited-feishu-secret",
        BELLDANDY_FEISHU_AGENT_ID: "inherited-feishu-agent",
        BELLDANDY_QQ_APP_ID: "inherited-qq-id",
        BELLDANDY_QQ_APP_SECRET: "inherited-qq-secret",
        BELLDANDY_QQ_AGENT_ID: "inherited-qq-agent",
      },
      resolvePath: (value) => path.win32.resolve(value),
    });

    expect(invocation.gateway.env).toMatchObject({
      BELLDANDY_FEISHU_APP_ID: "",
      BELLDANDY_FEISHU_APP_SECRET: "",
      BELLDANDY_FEISHU_AGENT_ID: "",
      BELLDANDY_QQ_APP_ID: "",
      BELLDANDY_QQ_APP_SECRET: "",
      BELLDANDY_QQ_AGENT_ID: "",
    });
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

  it("binds an explicit WSL2 benchmark only to the local WSL virtual adapter", () => {
    const input = {
      workspaceRoot,
      gatewayStateRoot: "E:/project/star-sanctuary/tmp/runtime",
      fixtureRoot: "E:/project/star-sanctuary/tmp/fixtures",
      artifactRoot: "E:/project/star-sanctuary/artifacts/wsl-formal",
      stateRoot: "E:/project/star-sanctuary/tmp/runtime",
      provider: "openai",
      modelId: "deepseek-v4-flash",
      credentialsConfigured: false,
      host: "172.27.128.1",
      gatewayAccess: "wsl2",
      port: 28945,
    };
    const dependencies = {
      baseEnv: {},
      networkInterfaces: () => ({
        "vEthernet (WSL)": [{ address: "172.27.128.1", family: "IPv4", internal: false }],
        "WLAN 2": [{ address: "192.168.0.114", family: "IPv4", internal: false }],
      }),
      resolvePath: (value) => path.win32.resolve(value),
    };
    const invocation = buildWindowsBenchmarkInvocation(input, dependencies);

    expect(invocation.endpoint).toMatchObject({
      host: "172.27.128.1",
      port: 28945,
      origin: "http://172.27.128.1:28945",
    });
    expect(invocation.gateway.env).toMatchObject({
      BELLDANDY_HOST: "172.27.128.1",
      BELLDANDY_ALLOWED_ORIGINS: "http://172.27.128.1:28945",
    });
    expect(() => buildWindowsBenchmarkInvocation({
      ...input,
      host: "192.168.0.114",
    }, dependencies)).toThrow(/WSL virtual adapter/i);
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
