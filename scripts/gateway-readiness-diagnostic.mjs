import fs from "node:fs/promises";

export const GATEWAY_READINESS_DIAGNOSTIC_VERSION = "coding-agent-gateway-readiness/v1";
const MAX_EVENTS = 32;
const BOOTSTRAP_PHASES = ["entry", "build_guard_complete", "module_body", "server_listening"];

export class GatewayReadinessDiagnostic {
  constructor({ host, port, startedAtMs = Date.now() }) {
    this.startedAtMs = startedAtMs;
    this.endpoint = { host, port };
    this.status = "starting";
    this.failureCode = null;
    this.events = [];
    this.nextBootstrapPhase = 0;
    this.child = {
      pid: null,
      spawnObserved: false,
      errorCode: null,
      exited: false,
      exitedBeforeStop: false,
      exitCode: null,
      signal: null,
    };
    this.outputState = {
      stdoutBytes: 0,
      stderrBytes: 0,
      firstStdoutAtMs: null,
      firstStderrAtMs: null,
    };
    this.readiness = {
      portConnectedAtMs: null,
      authProbeStartedAtMs: null,
      authReadyAtMs: null,
    };
    this.cleanup = {
      stopRequestedAtMs: null,
      stopCompletedAtMs: null,
    };
    this.finishedAtMs = null;
  }

  event(phase, atMs = Date.now()) {
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push({ phase, atMs: Math.max(0, atMs - this.startedAtMs) });
  }

  childSpawned(pid, atMs = Date.now()) {
    this.child.pid = Number.isSafeInteger(pid) ? pid : null;
    this.child.spawnObserved = true;
    this.event("child_spawned", atMs);
  }

  bootstrapMessage(message, atMs = Date.now()) {
    if (this.status !== "starting"
      || this.cleanup.stopRequestedAtMs !== null
      || !message || typeof message !== "object" || Array.isArray(message)
      || Object.keys(message).length !== 2
      || message.type !== "gateway.startup/v1"
      || typeof message.phase !== "string"
      || message.phase !== BOOTSTRAP_PHASES[this.nextBootstrapPhase]) return;
    this.nextBootstrapPhase += 1;
    this.event(`bootstrap_${message.phase}`, atMs);
  }

  childError(code, atMs = Date.now()) {
    this.child.errorCode = typeof code === "string" && code ? code : "unknown";
    this.event("child_error", atMs);
  }

  childExited(exitCode, signal, atMs = Date.now()) {
    this.child.exited = true;
    this.child.exitedBeforeStop = this.cleanup.stopRequestedAtMs === null;
    this.child.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    this.child.signal = typeof signal === "string" && signal ? signal : null;
    this.event("child_exited", atMs);
  }

  output(stream, bytes, atMs = Date.now()) {
    const size = Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : 0;
    const key = stream === "stderr" ? "stderrBytes" : "stdoutBytes";
    const firstKey = stream === "stderr" ? "firstStderrAtMs" : "firstStdoutAtMs";
    this.outputState[key] = Math.max(this.outputState[key], size);
    if (size > 0 && this.outputState[firstKey] === null) {
      this.outputState[firstKey] = Math.max(0, atMs - this.startedAtMs);
    }
  }

  portConnected(atMs = Date.now()) {
    this.readiness.portConnectedAtMs ??= Math.max(0, atMs - this.startedAtMs);
    this.event("port_connected", atMs);
  }

  authProbeStarted(atMs = Date.now()) {
    this.readiness.authProbeStartedAtMs ??= Math.max(0, atMs - this.startedAtMs);
    this.event("auth_probe_started", atMs);
  }

  authReady(atMs = Date.now()) {
    this.readiness.authReadyAtMs ??= Math.max(0, atMs - this.startedAtMs);
    this.event("auth_ready", atMs);
  }

  stopRequested(atMs = Date.now()) {
    this.cleanup.stopRequestedAtMs ??= Math.max(0, atMs - this.startedAtMs);
    this.event("gateway_stop_requested", atMs);
  }

  stopCompleted(atMs = Date.now()) {
    this.cleanup.stopCompletedAtMs ??= Math.max(0, atMs - this.startedAtMs);
    this.event("gateway_stop_completed", atMs);
  }

  fail(failureCode, atMs = Date.now()) {
    this.status = "failed";
    this.failureCode = failureCode;
    this.finishedAtMs = Math.max(0, atMs - this.startedAtMs);
  }

  ready(atMs = Date.now()) {
    this.status = "ready";
    this.failureCode = null;
    this.finishedAtMs = Math.max(0, atMs - this.startedAtMs);
  }

  toJSON() {
    return {
      schemaVersion: GATEWAY_READINESS_DIAGNOSTIC_VERSION,
      endpoint: { ...this.endpoint },
      status: this.status,
      failureCode: this.failureCode,
      events: this.events.map((event) => ({ ...event })),
      child: { ...this.child },
      output: { ...this.outputState },
      readiness: { ...this.readiness },
      cleanup: { ...this.cleanup },
      finishedAtMs: this.finishedAtMs,
    };
  }
}

export async function writeGatewayReadinessDiagnostic(filePath, diagnostic, dependencies = {}) {
  const writeFile = dependencies.writeFile ?? fs.writeFile;
  await writeFile(
    filePath,
    `${JSON.stringify(diagnostic.toJSON(), null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}
