import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import doctorCommand from "./doctor.js";
import { RuntimeResilienceTracker } from "../../runtime-resilience.js";
import { withEnv } from "../../server-testkit.js";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

const CLI_DOCTOR_TEST_TIMEOUT_MS = 15_000;

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  execFileSyncMock.mockReset();
});

async function createFakeCameraDoctorHelperScript(): Promise<string> {
  const helperDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-camera-doctor-helper-"));
  const helperPath = path.join(helperDir, "fake-camera-helper.mjs");
  await fs.writeFile(helperPath, `
import readline from "node:readline";

const protocol = "camera-native-desktop/v1";
const capabilities = {
  diagnose: true,
  list: true,
  snapshot: true,
  clip: false,
  audio: false,
  hotplug: true,
  background: true,
  stillFormats: ["png"],
  clipFormats: [],
  selectionByStableKey: true,
  deviceChangeEvents: true,
};

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (!request || request.kind !== "request") {
    return;
  }
  let result;
  switch (request.method) {
    case "hello":
      result = {
        protocol,
        helperVersion: "cli-doctor-helper",
        platform: "windows",
        transport: "stdio",
        helperStatus: "ready",
        capabilities,
      };
      break;
    case "diagnose":
      result = {
        status: "degraded",
        helperStatus: "ready",
        permissionState: "granted",
        observedAt: "2026-04-17T10:20:00.000Z",
        issues: [
          {
            code: "device_busy",
            severity: "warning",
            message: "OBSBOT Tiny 2 StreamCamera is currently busy.",
            retryable: true,
          },
        ],
        devices: [
          {
            deviceId: "obspot-main",
            stableKey: "usb-3564-fef8-453a4b75",
            label: "OBSBOT Tiny 2 StreamCamera",
            source: "external",
            transport: "native",
            external: true,
            available: true,
            kind: "videoinput",
            busy: true,
          },
        ],
        capabilities,
        helperVersion: "cli-doctor-helper",
      };
      break;
    default:
      process.stdout.write(JSON.stringify({
        kind: "response",
        protocol,
        id: request.id,
        method: request.method,
        ok: false,
        error: {
          code: "unsupported_method",
          message: "unsupported",
        },
      }) + "\\n");
      return;
  }
  process.stdout.write(JSON.stringify({
    kind: "response",
    protocol,
    id: request.id,
    method: request.method,
    ok: true,
    result,
  }) + "\\n");
});
`, "utf-8");
  return helperPath;
}

test("bdd doctor json output includes tool behavior observability", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-doctor-"));
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const previous = process.env.BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS;
  process.env.BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS = "apply_patch";

  try {
    await doctorCommand.run?.({
      args: {
        json: true,
        "state-dir": stateDir,
      },
    } as never);

    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(output);
    expect(parsed.configSource).toMatchObject({
      stateDir: stateDir,
      envDir: stateDir,
      stateDirSource: "process_env",
    });
    expect(parsed.toolBehaviorObservability).toMatchObject({
      counts: {
        includedContractCount: expect.any(Number),
      },
      included: expect.arrayContaining([
        "run_command",
        "apply_patch",
        "delegate_task",
      ]),
      experiment: {
        disabledContractNamesConfigured: ["apply_patch"],
        disabledContractNamesApplied: ["apply_patch"],
      },
    });
    expect(parsed.toolBehaviorObservability.contracts.run_command).toMatchObject({
      useWhen: expect.any(Array),
      preflightChecks: expect.any(Array),
    });
    expect(parsed.optionalCapabilities).toMatchObject({
      summary: {
        totalCount: 3,
        headline: expect.any(String),
      },
      items: expect.arrayContaining([
        expect.objectContaining({ id: "pty" }),
        expect.objectContaining({ id: "local_embedding" }),
        expect.objectContaining({ id: "build_scripts" }),
      ]),
    });
    expect(parsed.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Optional Capabilities",
        message: expect.any(String),
      }),
    ]));
    expect(parsed.toolContractV2Observability).toMatchObject({
      summary: {
        totalCount: expect.any(Number),
        highRiskCount: expect.any(Number),
        confirmRequiredCount: expect.any(Number),
      },
    });
    expect(parsed.toolContractV2Observability.summary.totalCount).toBeGreaterThanOrEqual(6);
    expect(parsed.toolContractV2Observability.summary.highRiskCount).toBeGreaterThanOrEqual(4);
    expect(parsed.toolContractV2Observability.summary.confirmRequiredCount).toBeGreaterThanOrEqual(4);
    expect(parsed.residentAgents).toMatchObject({
      summary: {
        totalCount: 1,
        idleCount: 1,
        runningCount: 0,
        digestMissingCount: 0,
        memoryModeCounts: {
          hybrid: 1,
        },
      },
      agents: [
        expect.objectContaining({
          id: "default",
          memoryMode: "hybrid",
          observabilityHeadline: expect.stringContaining("write=private"),
        }),
      ],
    });
  } finally {
    if (previous === undefined) {
      delete process.env.BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS;
    } else {
      process.env.BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS = previous;
    }
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, CLI_DOCTOR_TEST_TIMEOUT_MS);

test("bdd doctor accepts pnpm resolved via corepack", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-doctor-corepack-"));
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  execFileSyncMock.mockImplementation((file: string, args: string[]) => {
    if ((file === "pnpm.cmd" || file === "pnpm") && Array.isArray(args) && args.join(" ") === "--version") {
      throw new Error("pnpm not found");
    }
    if ((file === "corepack.cmd" || file === "corepack") && Array.isArray(args) && args.join(" ") === "pnpm --version") {
      return "10.11.1\n";
    }
    throw new Error(`unexpected command: ${file} ${Array.isArray(args) ? args.join(" ") : ""}`);
  });

  try {
    await doctorCommand.run?.({
      args: {
        json: true,
        "state-dir": stateDir,
      },
    } as never);

    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(output);
    const pnpmCheck = parsed.checks.find((item: { name: string }) => item.name === "pnpm");
    expect(pnpmCheck).toMatchObject({
      status: "pass",
      message: "v10.11.1 (via corepack)",
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, CLI_DOCTOR_TEST_TIMEOUT_MS);

test("bdd doctor json output includes deployment backend summary", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-doctor-deployment-"));
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await fs.writeFile(path.join(stateDir, "deployment-backends.json"), `${JSON.stringify({
    version: 1,
    selectedProfileId: "docker-main",
    profiles: [
      {
        id: "local-default",
        backend: "local",
        enabled: true,
        workspace: {
          mode: "direct",
        },
        credentials: {
          mode: "inherit_env",
        },
        observability: {
          logMode: "local",
        },
      },
      {
        id: "docker-main",
        backend: "docker",
        enabled: true,
        runtime: {
          service: "belldandy-gateway",
        },
        workspace: {
          mode: "mount",
          remotePath: "/workspace",
        },
        credentials: {
          mode: "env_file",
          ref: ".env.deploy",
        },
        observability: {
          logMode: "docker",
        },
      },
    ],
  }, null, 2)}\n`);

  try {
    await doctorCommand.run?.({
      args: {
        json: true,
        "state-dir": stateDir,
      },
    } as never);

    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(output);
    expect(parsed.deploymentBackends).toMatchObject({
      configExists: true,
      summary: {
        profileCount: 2,
        enabledCount: 2,
        warningCount: 0,
        selectedProfileId: "docker-main",
        selectedResolved: true,
        selectedBackend: "docker",
        backendCounts: {
          local: 1,
          docker: 1,
          ssh: 0,
        },
      },
    });
    const deploymentCheck = parsed.checks.find((item: { name: string }) => item.name === "Deployment Backends");
    expect(deploymentCheck).toMatchObject({
      status: "pass",
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, CLI_DOCTOR_TEST_TIMEOUT_MS);

test("bdd doctor json output includes camera runtime summary when native_desktop helper is configured", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-doctor-camera-"));
  const helperPath = await createFakeCameraDoctorHelperScript();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  try {
    await withEnv({
      BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND: process.execPath,
      BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON: JSON.stringify([helperPath]),
    }, async () => {
      await doctorCommand.run?.({
        args: {
          json: true,
          "state-dir": stateDir,
        },
      } as never);
    });

    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(output);
    expect(parsed.cameraRuntime).toMatchObject({
      summary: {
        defaultProviderId: "native_desktop",
        defaultSelection: {
          policy: "prefer_native_desktop",
          selectedProvider: "native_desktop",
          reason: "policy_preferred_provider",
          fallbackApplied: false,
          configuredDefaultProvider: "browser_loopback",
        },
        governance: {
          blockedProviderCount: 1,
          permissionBlockedProviderCount: 0,
          permissionPromptProviderCount: 0,
          fallbackActiveProviderCount: 0,
          dominantFailureCode: "device_busy",
          recommendedAction: "关闭正在占用摄像头的会议或录制软件后重试。",
        },
        warningCount: 1,
        errorCount: 0,
      },
      providers: expect.arrayContaining([
        expect.objectContaining({
          id: "native_desktop",
          status: "degraded",
          healthCheck: expect.objectContaining({
            status: "warn",
            source: "diagnostic",
            primaryReasonCode: "device_busy",
            recoveryActions: expect.arrayContaining([
              expect.objectContaining({
                kind: "close_competing_app",
              }),
            ]),
          }),
          runtimeHealth: expect.objectContaining({
            status: "degraded",
            historyWindow: expect.objectContaining({
              eventCount: 1,
              successCount: 1,
              failureCount: 0,
            }),
          }),
          runtimeHealthFreshness: expect.objectContaining({
            source: "memory+snapshot",
            snapshotPath: expect.stringContaining("native_desktop-runtime-health.json"),
          }),
          sampleDevices: expect.arrayContaining([
            "OBSBOT Tiny 2 StreamCamera [available, external, busy, stable=usb-3564-fef8-453a4b75]",
          ]),
        }),
      ]),
    });
    expect(parsed.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Camera Runtime",
        status: "warn",
      }),
    ]));
  } finally {
    await fs.rm(path.dirname(helperPath), { recursive: true, force: true }).catch(() => {});
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, CLI_DOCTOR_TEST_TIMEOUT_MS);

test("bdd doctor json output includes runtime resilience summary when available", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-cli-doctor-runtime-"));
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const tracker = new RuntimeResilienceTracker({
    stateDir,
    routing: {
      primary: {
        profileId: "primary",
        provider: "openai.com",
        model: "gpt-4.1",
      },
      fallbacks: [
        {
          profileId: "backup",
          provider: "moonshot.ai",
          model: "kimi-k2",
        },
      ],
      compaction: {
        configured: true,
        sharesPrimaryRoute: false,
        route: {
          profileId: "compaction",
          provider: "openai.com",
          model: "gpt-4.1-mini",
        },
      },
    },
  });
  tracker.record({
    source: "openai_chat",
    phase: "primary_chat",
    conversationId: "conv-runtime-doctor",
    summary: {
      configuredProfiles: [
        { profileId: "primary", provider: "openai.com", model: "gpt-4.1" },
        { profileId: "backup", provider: "moonshot.ai", model: "kimi-k2" },
      ],
      finalStatus: "success",
      finalProfileId: "backup",
      finalProvider: "moonshot.ai",
      finalModel: "kimi-k2",
      requestCount: 2,
      failedStageCount: 1,
      degraded: true,
      stepCounts: {
        cooldownSkips: 0,
        sameProfileRetries: 1,
        crossProfileFallbacks: 1,
        terminalFailures: 0,
      },
      reasonCounts: {
        server_error: 1,
      },
      steps: [],
      startedAt: Date.now() - 500,
      updatedAt: Date.now(),
      durationMs: 500,
    },
  });
  await tracker.waitForPendingWrite();

  try {
    await doctorCommand.run?.({
      args: {
        json: true,
        "state-dir": stateDir,
      },
    } as never);

    const output = String(logSpy.mock.calls.at(-1)?.[0] ?? "");
    const parsed = JSON.parse(output);
    const runtimeCheck = parsed.checks.find((item: { name: string }) => item.name === "Runtime Resilience");
    expect(parsed.runtimeResilience).toMatchObject({
      routing: {
        primary: {
          provider: "openai.com",
          model: "gpt-4.1",
        },
      },
      latest: {
        finalStatus: "success",
        finalProfileId: "backup",
        degraded: true,
      },
    });
    expect(parsed.runtimeResilienceDiagnostics).toMatchObject({
      alertLevel: "warn",
      alertCode: "recent_degrade",
      alertMessage: "Latest runtime required retry/fallback to recover.",
      dominantReason: "server_error",
      reasonClusterSummary: "server_error",
      mixedSignalHint: null,
      recoveryHint: "5xx instability dominates; keep fallback ready and verify provider health before trusting the primary route.",
      latestRouteBehavior: "switched primary/gpt-4.1 -> backup/kimi-k2",
      latestReasonSummary: "server_error=1",
      totalsSummary: "observed=1, degraded=1, failed=0, retry=1, switch=1, cooldown=0",
    });
    expect(runtimeCheck).toMatchObject({
      status: "warn",
      message: "recent_degrade: Latest runtime required retry/fallback to recover.",
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
}, CLI_DOCTOR_TEST_TIMEOUT_MS);
