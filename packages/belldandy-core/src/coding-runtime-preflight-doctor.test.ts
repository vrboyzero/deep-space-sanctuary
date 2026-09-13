import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCodingRuntimePreflightDoctorReport } from "./coding-runtime-preflight-doctor.js";

const tempDirs: string[] = [];
const PINNED_IMAGE = `ghcr.io/example/coding-runtime@sha256:${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

async function createStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-coding-preflight-"));
  tempDirs.push(directory);
  return directory;
}

function optionalCapabilities(ptyMode: "ready" | "fallback") {
  return {
    items: [{
      id: "pty" as const,
      mode: ptyMode,
      status: ptyMode === "ready" ? "pass" as const : "warn" as const,
    }],
  };
}

function goDoctor(active: boolean, status: "inactive" | "canary-ready" | "unavailable" = "inactive") {
  return {
    summary: {
      active,
      status,
      canaryReady: status === "canary-ready",
    },
  };
}

describe("buildCodingRuntimePreflightDoctorReport", () => {
  it("keeps inactive capabilities side-effect free", async () => {
    const stateDir = await createStateDir();
    const probeRuntime = vi.fn();
    const probeImage = vi.fn();

    const report = await buildCodingRuntimePreflightDoctorReport({
      stateDir,
      environment: {
        BELLDANDY_TOOLS_ENABLED: "false",
        BELLDANDY_CODE_INTEL_GO_ENABLED: "false",
      },
      optionalCapabilities: optionalCapabilities("fallback"),
      goCodeIntel: goDoctor(false),
      probeRuntime,
      probeImage,
    });

    expect(report).toMatchObject({
      schemaVersion: "coding-runtime-preflight-doctor/v1",
      summary: {
        startupReady: true,
        activeCount: 0,
        requiredCount: 0,
        blockingCount: 0,
      },
      languages: {
        enabled: [],
      },
    });
    expect(report.items.every((item) => item.status === "inactive")).toBe(true);
    expect(probeRuntime).not.toHaveBeenCalled();
    expect(probeImage).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(stateDir, "command-jobs"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports an available active runtime without exposing configured paths", async () => {
    const stateDir = await createStateDir();
    const probeRuntime = vi.fn(async () => ({ available: true }));
    const probeImage = vi.fn(async () => ({ available: true }));

    const report = await buildCodingRuntimePreflightDoctorReport({
      stateDir,
      environment: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
        BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
        BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: PINNED_IMAGE,
        BELLDANDY_CODE_INTEL_GO_ENABLED: "true",
        BELLDANDY_CODE_INTEL_GOPLS_COMMAND: "C:\\private\\gopls.exe",
      },
      optionalCapabilities: optionalCapabilities("ready"),
      goCodeIntel: goDoctor(true, "canary-ready"),
      probeRuntime,
      probeImage,
      probeProcessTreeCleanup: async () => ({ available: true }),
      probeTypeScriptToolchain: () => ({ available: true, version: "5.7.3" }),
    });

    expect(report.summary).toMatchObject({
      startupReady: true,
      activeCount: 8,
      requiredCount: 8,
      availableCount: 8,
      blockingCount: 0,
    });
    expect(report.languages).toEqual({
      enabled: ["typescript/javascript", "go"],
      available: ["typescript/javascript", "go"],
      unavailable: [],
    });
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "oci_configuration", status: "available" }),
      expect.objectContaining({ id: "oci_runtime", status: "available" }),
      expect.objectContaining({ id: "oci_local_image", status: "available" }),
      expect.objectContaining({ id: "typescript_javascript", status: "available" }),
      expect.objectContaining({ id: "go_gopls", status: "available" }),
    ]));
    expect(probeRuntime).toHaveBeenCalledTimes(1);
    expect(probeImage).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(PINNED_IMAGE);
    expect(serialized).not.toContain("C:\\private");
  });

  it("blocks the coding runtime when tools are enabled without a configured sandbox", async () => {
    const stateDir = await createStateDir();
    const probeRuntime = vi.fn();
    const probeImage = vi.fn();

    // 官方默认配置：只开工具、三个沙箱变量保持注释（见 .env.example）。
    // 该组合下编码运行的命令执行按 fail-closed 处理，因此预检必须明确报出一条阻塞项，
    // 供 Doctor 与设置页定位；这里锁定该口径，防止被误改成可降级的 warn。
    const report = await buildCodingRuntimePreflightDoctorReport({
      stateDir,
      environment: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_CODE_INTEL_GO_ENABLED: "false",
      },
      optionalCapabilities: optionalCapabilities("ready"),
      goCodeIntel: goDoctor(false),
      probeRuntime,
      probeImage,
      probeProcessTreeCleanup: async () => ({ available: true }),
      probeTypeScriptToolchain: () => ({ available: true, version: "5.7.3" }),
    });

    expect(report.summary).toMatchObject({
      startupReady: false,
      activeCount: 7,
      requiredCount: 7,
      availableCount: 4,
      blockingCount: 1,
      headline: "1 coding runtime prerequisite(s) block a fully capable startup.",
    });
    expect(report.languages).toEqual({
      enabled: ["typescript/javascript"],
      available: ["typescript/javascript"],
      unavailable: [],
    });
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "oci_configuration",
        status: "unavailable",
        reasonCode: "not_configured",
        required: true,
        blocking: true,
        setup: expect.objectContaining({
          action: "Configure a digest-pinned OCI sandbox backend before starting coding tasks.",
        }),
      }),
      expect.objectContaining({ id: "oci_runtime", status: "unknown", blocking: false }),
      expect.objectContaining({ id: "oci_local_image", status: "unknown", blocking: false }),
      expect.objectContaining({ id: "native_pty", status: "available", blocking: false }),
      expect.objectContaining({ id: "typescript_javascript", status: "available", blocking: false }),
    ]));
    // 未配置沙箱时不应触发任何运行时/镜像探测。
    expect(probeRuntime).not.toHaveBeenCalled();
    expect(probeImage).not.toHaveBeenCalled();
  });

  it("fails closed when the enabled Go toolchain is unavailable", async () => {
    const stateDir = await createStateDir();

    const report = await buildCodingRuntimePreflightDoctorReport({
      stateDir,
      environment: {
        BELLDANDY_TOOLS_ENABLED: "false",
        BELLDANDY_CODE_INTEL_GO_ENABLED: "true",
      },
      optionalCapabilities: optionalCapabilities("fallback"),
      goCodeIntel: goDoctor(true, "unavailable"),
    });

    expect(report.summary).toMatchObject({
      startupReady: false,
      activeCount: 1,
      requiredCount: 1,
      blockingCount: 1,
    });
    expect(report.languages).toEqual({
      enabled: ["go"],
      available: [],
      unavailable: ["go"],
    });
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "go_gopls",
        active: true,
        required: true,
        status: "unavailable",
        blocking: true,
      }),
    ]));
  });

  it("fails closed on an unavailable runtime and only counts persisted leases", async () => {
    const stateDir = await createStateDir();
    const commandJobsDir = path.join(stateDir, "command-jobs");
    await fs.mkdir(commandJobsDir);
    await fs.writeFile(path.join(commandJobsDir, "active.json"), JSON.stringify({
      version: 1,
      jobId: "11111111-1111-4111-8111-111111111111",
      status: "running",
      stdinMode: "pipe",
      createdAt: 1,
      updatedAt: 1,
      supportsResize: false,
      persistedSandbox: {
        runtime: "docker",
        containerName: `belldandy-command-${"1".repeat(32)}`,
      },
      error: "secret-value",
    }));
    await fs.writeFile(path.join(commandJobsDir, "invalid.json"), "{not-json");
    const probeImage = vi.fn();

    const report = await buildCodingRuntimePreflightDoctorReport({
      stateDir,
      environment: {
        BELLDANDY_TOOLS_ENABLED: "true",
        BELLDANDY_COMMAND_SANDBOX_BACKEND: "oci",
        BELLDANDY_COMMAND_SANDBOX_OCI_RUNTIME: "docker",
        BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: PINNED_IMAGE,
      },
      optionalCapabilities: optionalCapabilities("fallback"),
      goCodeIntel: goDoctor(false),
      probeRuntime: async () => ({ available: false }),
      probeImage,
      probeProcessTreeCleanup: async () => ({ available: true }),
      probeTypeScriptToolchain: () => ({ available: true, version: "5.7.3" }),
    });

    expect(report.summary).toMatchObject({
      startupReady: false,
      blockingCount: 1,
    });
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "oci_runtime",
        status: "unavailable",
        reasonCode: "runtime_unavailable",
      }),
      expect.objectContaining({
        id: "oci_local_image",
        status: "unknown",
        reasonCode: "runtime_probe_failed",
      }),
      expect.objectContaining({
        id: "native_pty",
        status: "degraded",
        reasonCode: "native_pty_unavailable",
      }),
      expect.objectContaining({
        id: "persisted_sandbox_leases",
        status: "degraded",
        reasonCode: "lease_reconciliation_required",
        details: {
          recordCount: 2,
          activeLeaseCount: 1,
          invalidRecordCount: 1,
        },
      }),
    ]));
    expect(probeImage).not.toHaveBeenCalled();
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("active.json");
    expect(serialized).not.toContain(`belldandy-command-${"1".repeat(32)}`);
    expect(serialized).not.toContain(PINNED_IMAGE);
  });
});
