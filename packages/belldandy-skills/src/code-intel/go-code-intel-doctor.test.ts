import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildGoCodeIntelDoctorReport,
  type GoplsCommandRunner,
} from "./go-code-intel-doctor.js";

const goplsCommand = path.resolve("C:\\tools\\gopls.exe");
const goCommand = path.resolve("C:\\tools\\go\\bin\\go.exe");

describe("buildGoCodeIntelDoctorReport", () => {
  it("stays inactive and does not probe when the canary is not enabled", async () => {
    const runCommand = vi.fn<GoplsCommandRunner>();

    const report = await buildGoCodeIntelDoctorReport({
      environment: {
        BELLDANDY_CODE_INTEL_GO_ENABLED: "false",
        BELLDANDY_CODE_INTEL_GOPLS_COMMAND: goplsCommand,
        BELLDANDY_CODE_INTEL_GO_COMMAND: goCommand,
      },
      runCommand,
    });

    expect(report).toMatchObject({
      summary: {
        status: "inactive",
        active: false,
        canaryReady: false,
        productionEligible: false,
      },
      configuration: {
        goplsCommandConfigured: true,
        goCommandConfigured: true,
      },
      diagnostics: [],
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("fails closed as unavailable when enabled configuration is incomplete", async () => {
    const runCommand = vi.fn<GoplsCommandRunner>();

    const report = await buildGoCodeIntelDoctorReport({
      environment: {
        BELLDANDY_CODE_INTEL_GO_ENABLED: "true",
        BELLDANDY_CODE_INTEL_GOPLS_COMMAND: goplsCommand,
      },
      runCommand,
    });

    expect(report).toMatchObject({
      summary: {
        status: "unavailable",
        active: true,
        canaryReady: false,
        productionEligible: false,
      },
      configuration: {
        goplsCommandConfigured: true,
        goCommandConfigured: false,
      },
      diagnostics: [expect.objectContaining({ code: "configuration_missing" })],
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reports unavailable commands without leaking configured paths or runner errors", async () => {
    const secret = "doctor-secret-value";
    const internalError = `ENOENT at ${goplsCommand}`;
    const report = await buildGoCodeIntelDoctorReport({
      environment: {
        BELLDANDY_CODE_INTEL_GO_ENABLED: "true",
        BELLDANDY_CODE_INTEL_GOPLS_COMMAND: goplsCommand,
        BELLDANDY_CODE_INTEL_GO_COMMAND: goCommand,
        SS_INTERNAL_SECRET: secret,
        SystemRoot: "C:\\Windows",
      },
      runCommand: async () => {
        throw new Error(internalError);
      },
    });

    expect(report.summary.status).toBe("unavailable");
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ code: "gopls_unavailable" }),
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(goplsCommand);
    expect(serialized).not.toContain(goCommand);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(internalError);
  });

  it("reports incompatible when the gopls version drifts from the pin", async () => {
    const report = await buildGoCodeIntelDoctorReport({
      environment: enabledEnvironment(),
      runCommand: async (command) => command === goplsCommand
        ? { stdout: "golang.org/x/tools/gopls v0.20.0\n", stderr: "" }
        : { stdout: "go version go1.24.2 windows/amd64\n", stderr: "" },
    });

    expect(report).toMatchObject({
      summary: {
        status: "incompatible",
        active: true,
        canaryReady: false,
        productionEligible: false,
      },
      toolchain: {
        pinnedGoplsVersion: "v0.21.0",
        goplsVersion: "v0.20.0",
      },
      diagnostics: [expect.objectContaining({ code: "gopls_version_mismatch" })],
    });
  });

  it("reports canary-ready for the pinned toolchain while production gates remain closed", async () => {
    const observedEnvironments: Record<string, string>[] = [];
    const report = await buildGoCodeIntelDoctorReport({
      environment: enabledEnvironment({ SS_INTERNAL_SECRET: "do-not-forward" }),
      runCommand: async (command, _args, options) => {
        observedEnvironments.push(options.environment);
        return command === goplsCommand
          ? { stdout: "golang.org/x/tools/gopls v0.21.0\n", stderr: "" }
          : { stdout: "go version go1.24.2 windows/amd64\n", stderr: "" };
      },
    });

    expect(report).toMatchObject({
      summary: {
        status: "canary-ready",
        active: true,
        canaryReady: true,
        productionEligible: false,
      },
      toolchain: {
        pinnedGoplsVersion: "v0.21.0",
        goplsVersion: "v0.21.0",
        goVersion: "go1.24.2",
        platform: "windows/amd64",
      },
      governance: {
        dependencyRestore: "denied",
        networkPolicy: "environment-deny",
        sandboxStatus: "unverified",
        productionEligible: false,
      },
      diagnostics: [],
    });
    expect(observedEnvironments).toEqual([
      { SystemRoot: "C:\\Windows" },
      { SystemRoot: "C:\\Windows" },
    ]);
  });

  it("fails closed when enabled command paths are not absolute", async () => {
    const runCommand = vi.fn<GoplsCommandRunner>();
    const report = await buildGoCodeIntelDoctorReport({
      environment: {
        BELLDANDY_CODE_INTEL_GO_ENABLED: "true",
        BELLDANDY_CODE_INTEL_GOPLS_COMMAND: "gopls",
        BELLDANDY_CODE_INTEL_GO_COMMAND: "go",
      },
      runCommand,
    });

    expect(report).toMatchObject({
      summary: { status: "incompatible", canaryReady: false },
      diagnostics: [expect.objectContaining({ code: "command_path_invalid" })],
    });
    expect(runCommand).not.toHaveBeenCalled();
  });
});

function enabledEnvironment(
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    BELLDANDY_CODE_INTEL_GO_ENABLED: "true",
    BELLDANDY_CODE_INTEL_GOPLS_COMMAND: goplsCommand,
    BELLDANDY_CODE_INTEL_GO_COMMAND: goCommand,
    SystemRoot: "C:\\Windows",
    ...extra,
  };
}
