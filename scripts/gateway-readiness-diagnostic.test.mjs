import { describe, expect, it } from "vitest";

import {
  GatewayReadinessDiagnostic,
  writeGatewayReadinessDiagnostic,
} from "./gateway-readiness-diagnostic.mjs";

describe("Gateway readiness diagnostic", () => {
  it("retains bootstrap progress on timeout without promoting progress to readiness", () => {
    const diagnostic = new GatewayReadinessDiagnostic({ host: "127.0.0.1", port: 1, startedAtMs: 1_000 });
    diagnostic.bootstrapMessage({ type: "gateway.startup/v1", phase: "entry" }, 1_010);
    diagnostic.bootstrapMessage({ type: "gateway.startup/v1", phase: "build_guard_complete" }, 1_020);
    diagnostic.fail("gateway_readiness_timeout", 61_000);

    expect(diagnostic.toJSON()).toMatchObject({
      status: "failed",
      failureCode: "gateway_readiness_timeout",
      events: [
        { phase: "bootstrap_entry", atMs: 10 },
        { phase: "bootstrap_build_guard_complete", atMs: 20 },
      ],
      readiness: { portConnectedAtMs: null, authReadyAtMs: null },
    });
  });

  it("rejects malformed, duplicate, out-of-order and late bootstrap frames", () => {
    const diagnostic = new GatewayReadinessDiagnostic({ host: "127.0.0.1", port: 1, startedAtMs: 0 });
    for (const message of [null, [], "secret", { type: "other", phase: "entry" },
      { type: "gateway.startup/v1", phase: "secret" },
      { type: "gateway.startup/v1", phase: "entry", token: "must-not-retain" },
      { type: "gateway.startup/v1", phase: "module_body" }]) {
      diagnostic.bootstrapMessage(message, 10);
    }
    diagnostic.bootstrapMessage({ type: "gateway.startup/v1", phase: "entry" }, 20);
    for (let index = 0; index < 100; index += 1) {
      diagnostic.bootstrapMessage({ type: "gateway.startup/v1", phase: "entry" }, 30);
    }
    diagnostic.ready(40);
    diagnostic.bootstrapMessage({ type: "gateway.startup/v1", phase: "build_guard_complete" }, 50);
    expect(diagnostic.toJSON().events).toEqual([{ phase: "bootstrap_entry", atMs: 20 }]);
    expect(JSON.stringify(diagnostic.toJSON())).not.toMatch(/secret|token|must-not-retain/);
  });

  it("records bounded child, output, readiness, and failure evidence without content", () => {
    const diagnostic = new GatewayReadinessDiagnostic({
      host: "127.0.0.1",
      port: 28999,
      startedAtMs: 1_000,
    });

    diagnostic.event("invocation_ready", 1_002);
    diagnostic.childSpawned(42, 1_010);
    diagnostic.output("stdout", 12, 1_500);
    diagnostic.output("stderr", 3, 1_600);
    diagnostic.event("port_probe_started", 1_700);
    diagnostic.portConnected(2_200);
    diagnostic.authProbeStarted(2_201);
    diagnostic.fail("gateway_auth_probe_timeout", 2_700);

    expect(diagnostic.toJSON()).toEqual({
      schemaVersion: "coding-agent-gateway-readiness/v1",
      endpoint: { host: "127.0.0.1", port: 28999 },
      status: "failed",
      failureCode: "gateway_auth_probe_timeout",
      events: [
        { phase: "invocation_ready", atMs: 2 },
        { phase: "child_spawned", atMs: 10 },
        { phase: "port_probe_started", atMs: 700 },
        { phase: "port_connected", atMs: 1_200 },
        { phase: "auth_probe_started", atMs: 1_201 },
      ],
      child: {
        pid: 42,
        spawnObserved: true,
        errorCode: null,
        exited: false,
        exitedBeforeStop: false,
        exitCode: null,
        signal: null,
      },
      output: {
        stdoutBytes: 12,
        stderrBytes: 3,
        firstStdoutAtMs: 500,
        firstStderrAtMs: 600,
      },
      readiness: {
        portConnectedAtMs: 1_200,
        authProbeStartedAtMs: 1_201,
        authReadyAtMs: null,
      },
      cleanup: {
        stopRequestedAtMs: null,
        stopCompletedAtMs: null,
      },
      finishedAtMs: 1_700,
    });
  });

  it("writes a non-overwriting report through the provided filesystem seam", async () => {
    const writes = [];
    const diagnostic = new GatewayReadinessDiagnostic({ host: "127.0.0.1", port: 1, startedAtMs: 10 });
    diagnostic.fail("gateway_readiness_timeout", 20);

    await writeGatewayReadinessDiagnostic("E:/runtime/gateway-readiness.json", diagnostic, {
      writeFile: async (filePath, content, options) => {
        writes.push({ filePath, content, options });
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].filePath).toBe("E:/runtime/gateway-readiness.json");
    expect(writes[0].options).toEqual({ encoding: "utf8", flag: "wx" });
    expect(JSON.parse(writes[0].content)).toMatchObject({
      schemaVersion: "coding-agent-gateway-readiness/v1",
      status: "failed",
      failureCode: "gateway_readiness_timeout",
    });
    expect(writes[0].content).not.toMatch(/diagnostic-placeholder|provider-key|password=|token=|api-key=/i);
  });

  it("distinguishes natural child exit from cleanup termination", () => {
    const naturalExit = new GatewayReadinessDiagnostic({ host: "127.0.0.1", port: 1, startedAtMs: 10 });
    naturalExit.childExited(1, null, 20);
    expect(naturalExit.toJSON().child.exitedBeforeStop).toBe(true);

    const cleanupExit = new GatewayReadinessDiagnostic({ host: "127.0.0.1", port: 1, startedAtMs: 10 });
    cleanupExit.stopRequested(20);
    cleanupExit.childExited(null, "SIGTERM", 30);
    expect(cleanupExit.toJSON().child.exitedBeforeStop).toBe(false);
  });
});
