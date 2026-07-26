import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import WebSocket, { WebSocketServer } from "ws";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gatewayFixturePath = path.join(scriptDir, "coding-agent-process-restart-gateway.mjs");
const MAX_CAPTURE_BYTES = 256 * 1024;
const GATEWAY_READY_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

export async function executeGatewayProcessRestartCodingCi(input) {
  const artifactPath = path.resolve(requireNonEmptyString(input?.artifactPath, "artifactPath"));
  const supervisor = await startGatewayProcessRestartSupervisor({
    stateDir: input?.stateDir,
    workspace: input?.workspace,
  });
  const proxy = await startGatewayProcessRestartProxy({ supervisor });
  let runner;
  let artifact = createRestartArtifact();

  try {
    runner = await input.executeCodingCi({
      ...input,
      childEnv: {
        ...input.childEnv,
        BELLDANDY_HOST: proxy.host,
        BELLDANDY_PORT: String(proxy.port),
        BELLDANDY_AUTH_MODE: "none",
      },
    });
    // The upstream response is already forwarded before the restart begins. Wait for that exact
    // send callback so a fast Headless close cannot race the injection evidence collection.
    const injection = await proxy.waitForInjection();
    const events = await readJsonl(path.join(input.artifactDir, "events.jsonl"));
    const started = events.find((event) => event?.type === "run.started");
    const binding = readBinding(started?.binding) ?? injection?.binding;
    artifact = {
      ...artifact,
      observedStartedSeq: Number.isSafeInteger(started?.seq) ? started.seq : null,
      messageSendRequestCount: injection?.messageSendRequestCount ?? 0,
      binding: binding ?? null,
      originalGateway: injection?.originalGateway ?? supervisor.getSnapshot().originalGateway,
      replacementGateway: injection?.replacementGateway ?? supervisor.getSnapshot().replacementGateway,
    };

    if (!injection || injection.status !== "injected" || !binding || !sameBinding(binding, injection.binding)) {
      artifact.status = "failed";
      return {
        ...runner,
        exitCode: runner.exitCode === 0 ? 4 : runner.exitCode,
        stderr: [runner.stderr, "Gateway restart fault was not injected after a complete run binding was observed."]
          .filter(Boolean).join("\n"),
      };
    }

    const target = supervisor.getTarget();
    const subscription = await runCodingRunSubscriptionProbe({
      bddEntry: input.bddEntry,
      cwd: input.workspace,
      stateDir: input.stateDir,
      binding,
      env: buildGatewayEnv(input.childEnv, target),
    });
    const cancellation = await runAgentCancelProbe({
      bddEntry: input.bddEntry,
      cwd: input.workspace,
      stateDir: input.stateDir,
      binding,
      env: buildGatewayEnv(input.childEnv, target),
    });
    artifact = {
      ...artifact,
      subscription,
      cancellation,
      status: started?.seq === 1
        && injection.messageSendRequestCount === 1
        && subscription.errorCode === "not_found"
        && cancellation.state === "not_found"
        && cancellation.accepted === false
        ? "confirmed"
        : "failed",
    };
    return runner;
  } catch (error) {
    artifact.status = "failed";
    return {
      exitCode: runner?.exitCode === 0 ? 4 : runner?.exitCode ?? 4,
      stdout: runner?.stdout ?? "",
      stderr: [runner?.stderr, `Gateway process restart harness failed: ${safeMessage(error)}`]
        .filter(Boolean).join("\n"),
    };
  } finally {
    await proxy.close();
    artifact.cleanup = await supervisor.close();
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  }
}

export async function startGatewayProcessRestartSupervisor(input) {
  const stateDir = path.resolve(requireNonEmptyString(input?.stateDir, "stateDir"));
  const workspace = path.resolve(requireNonEmptyString(input?.workspace, "workspace"));
  let active;
  let originalGateway = null;
  let replacementGateway = null;
  let restartPromise;
  let closed = false;

  active = await startFixtureGateway({ stateDir, workspace, port: 0 });
  originalGateway = active.snapshot();

  async function restart(binding) {
    if (closed) throw new Error("Gateway restart supervisor is closed.");
    if (!readBinding(binding)) throw new Error("Gateway restart requires a complete binding.");
    restartPromise ??= (async () => {
      const previous = active;
      await stopFixtureGateway(previous);
      originalGateway = previous.snapshot();
      active = await startFixtureGateway({ stateDir, workspace, port: previous.port });
      replacementGateway = active.snapshot();
      return {
        originalGateway: structuredClone(originalGateway),
        replacementGateway: structuredClone(replacementGateway),
      };
    })();
    return await restartPromise;
  }

  return {
    getTarget: () => ({ host: "127.0.0.1", port: active.port }),
    getSnapshot: () => ({
      originalGateway: originalGateway ? structuredClone(originalGateway) : null,
      replacementGateway: replacementGateway ? structuredClone(replacementGateway) : null,
    }),
    restart,
    close: async () => {
      closed = true;
      await restartPromise?.catch(() => undefined);
      if (active) await stopFixtureGateway(active);
      if (originalGateway?.pid === active?.pid) originalGateway = active.snapshot();
      if (replacementGateway?.pid === active?.pid) replacementGateway = active.snapshot();
      return {
        managedGatewayProcessCount: [originalGateway, replacementGateway]
          .filter((gateway) => gateway && gateway.exited !== true).length,
        originalGateway: originalGateway ? structuredClone(originalGateway) : null,
        replacementGateway: replacementGateway ? structuredClone(replacementGateway) : null,
      };
    },
  };
}

export async function startGatewayProcessRestartProxy(input) {
  const supervisor = input?.supervisor;
  if (!supervisor || typeof supervisor.getTarget !== "function" || typeof supervisor.restart !== "function") {
    throw new Error("A Gateway restart supervisor is required.");
  }
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Gateway restart proxy did not expose a TCP port.");

  const upstreamSockets = new Set();
  let injection;
  let injectionPromise;
  let closed = false;

  server.on("connection", (downstream, request) => {
    const target = supervisor.getTarget();
    const origin = `http://${target.host}:${target.port}`;
    const upstream = new WebSocket(`ws://${target.host}:${target.port}`, { origin });
    upstreamSockets.add(upstream);
    const pending = [];
    const messageSendRequestIds = new Set();
    const acceptedMessageSendRequestIds = new Set();

    const forwardUpstream = (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, isBinary });
    };
    upstream.on("open", () => {
      for (const item of pending.splice(0)) upstream.send(item.data, { binary: item.isBinary });
    });
    downstream.on("message", (data, isBinary) => {
      const frame = parseRecord(data);
      if (frame?.type === "req" && frame.method === "message.send" && typeof frame.id === "string") {
        messageSendRequestIds.add(frame.id);
      }
      forwardUpstream(data, isBinary);
    });
    upstream.on("message", (data, isBinary) => {
      const frame = parseRecord(data);
      const binding = frame?.type === "res" && frame.ok === true && typeof frame.id === "string"
        && messageSendRequestIds.has(frame.id)
        ? readBinding({
          conversationId: frame.payload?.conversationId,
          agentRunId: frame.payload?.runId,
        })
        : undefined;
      if (binding && typeof frame.id === "string") acceptedMessageSendRequestIds.add(frame.id);
      const shouldRestart = Boolean(binding && !injectionPromise);
      if (downstream.readyState !== WebSocket.OPEN) return;
      downstream.send(data, { binary: isBinary }, () => {
        if (!shouldRestart || !binding || injectionPromise) return;
        injectionPromise = supervisor.restart(binding).then((lifecycle) => {
          injection = {
            status: "injected",
            binding,
            messageSendRequestCount: acceptedMessageSendRequestIds.size,
            ...lifecycle,
          };
          if (downstream.readyState === WebSocket.OPEN) downstream.close(1012, "Injected Gateway process restart");
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(1012, "Injected Gateway process restart");
          return injection;
        }).catch((error) => {
          injection = {
            status: "failed",
            binding,
            messageSendRequestCount: acceptedMessageSendRequestIds.size,
            error: safeMessage(error),
            ...supervisor.getSnapshot(),
          };
          if (downstream.readyState === WebSocket.OPEN) downstream.close(1011, "Gateway process restart failed");
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(1011, "Gateway process restart failed");
          return injection;
        });
      });
    });
    upstream.on("error", () => {
      if (downstream.readyState === WebSocket.OPEN) downstream.close(1011, "Gateway restart proxy upstream failed");
    });
    upstream.on("close", () => {
      upstreamSockets.delete(upstream);
      if (downstream.readyState === WebSocket.OPEN) downstream.close(1012, "Gateway restart proxy upstream closed");
    });
    downstream.on("close", () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    });
  });

  return {
    host: "127.0.0.1",
    port: address.port,
    getInjection: () => injection ? structuredClone(injection) : undefined,
    waitForInjection: async () => injectionPromise ? structuredClone(await injectionPromise) : undefined,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const client of server.clients) client.terminate();
      for (const socket of upstreamSockets) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function startFixtureGateway(input) {
  const child = spawn(process.execPath, [
    "--import", "tsx",
    gatewayFixturePath,
    "--state-dir", path.resolve(input.stateDir),
    "--port", String(input.port),
  ], {
    // Resolve the tsx preloader from this repository, not from the regenerated fixture workspace.
    cwd: path.resolve(scriptDir, ".."),
    env: {
      ...process.env,
      BELLDANDY_HOST: "127.0.0.1",
      BELLDANDY_AUTH_MODE: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const record = createGatewayRecord(child);
  const ready = await waitForGatewayReady(record);
  record.port = ready.port;
  return record;
}

function createGatewayRecord(child) {
  const record = {
    child,
    pid: child.pid ?? null,
    port: null,
    stderr: "",
    stdoutRemainder: "",
    exited: false,
    exitCode: null,
    signal: null,
    close: undefined,
    snapshot() {
      return {
        pid: this.pid,
        port: this.port,
        exited: this.exited,
        exitCode: this.exitCode,
        signal: this.signal,
      };
    },
  };
  record.close = new Promise((resolve) => {
    child.once("close", (exitCode, signal) => {
      record.exited = true;
      record.exitCode = exitCode ?? null;
      record.signal = signal ?? null;
      resolve(record.snapshot());
    });
  });
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (chunk) => {
    record.stdoutRemainder = truncateCapture(record.stdoutRemainder + String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    record.stderr = truncateCapture(record.stderr + String(chunk));
  });
  return record;
}

async function waitForGatewayReady(record) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      finish(reject, new Error(`Gateway fixture did not become ready within ${GATEWAY_READY_TIMEOUT_MS} ms.`));
    }, GATEWAY_READY_TIMEOUT_MS);
    const consume = () => {
      const lines = record.stdoutRemainder.split(/\r?\n/);
      record.stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        const frame = parseRecord(line);
        if (frame?.type !== "coding-benchmark-gateway-ready") continue;
        if (!Number.isSafeInteger(frame.port) || frame.port < 1 || frame.port > 65_535) continue;
        finish(resolve, { port: frame.port });
        return;
      }
    };
    record.child.stdout.on("data", consume);
    record.child.once("error", (error) => finish(reject, error));
    record.child.once("close", () => {
      finish(reject, new Error(record.stderr.trim() || "Gateway fixture exited before becoming ready."));
    });
    consume();
  });
}

async function stopFixtureGateway(record) {
  if (record.exited) return await record.close;
  record.child.kill("SIGTERM");
  const timed = await Promise.race([
    record.close,
    new Promise((resolve) => setTimeout(() => resolve(undefined), STOP_TIMEOUT_MS)),
  ]);
  if (timed) return timed;
  record.child.kill("SIGKILL");
  return await record.close;
}

export async function runCodingRunSubscriptionProbe(input) {
  const requestId = "coding-benchmark-restart-subscription";
  const result = await runProcess({
    bddEntry: input.bddEntry,
    args: ["coding-run", "stdio", "--state-dir", input.stateDir],
    cwd: input.cwd,
    env: input.env,
    stdin: `${JSON.stringify({
      version: "v1",
      type: "subscription.request",
      id: requestId,
      subscription: {
        version: "v1",
        binding: input.binding,
        cursor: 1,
      },
    })}\n`,
    closeStdinOnFrame: (frame) => frame?.type === "subscription.response" && frame.id === requestId,
  });
  const response = parseJsonl(result.stdout).find((frame) => frame?.type === "subscription.response" && frame.id === requestId);
  const responseDiagnostic = typeof response?.error?.message === "string" ? response.error.message : "";
  return {
    exitCode: result.exitCode,
    errorCode: typeof response?.error?.code === "string" ? response.error.code : null,
    eventCount: parseJsonl(result.stdout).filter((frame) => frame?.type === "event").length,
    diagnostic: sanitizeProbeDiagnostic([result.stderr, responseDiagnostic].filter(Boolean).join("\n")),
  };
}

async function runAgentCancelProbe(input) {
  const result = await runProcess({
    bddEntry: input.bddEntry,
    args: [
      "agent", "cancel",
      "--conversation-id", input.binding.conversationId,
      "--run-id", input.binding.agentRunId,
      "--state-dir", input.stateDir,
      "--reason", "Probe old binding after Gateway process restart.",
      "--json",
    ],
    cwd: input.cwd,
    env: input.env,
  });
  const payload = parseJsonl(result.stdout).at(-1);
  return {
    exitCode: result.exitCode,
    accepted: payload?.result?.accepted === true ? true : payload?.result?.accepted === false ? false : null,
    state: typeof payload?.result?.state === "string" ? payload.result.state : null,
  };
}

async function runProcess(input) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [input.bddEntry, ...input.args], {
      cwd: path.resolve(input.cwd),
      env: { ...process.env, ...input.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stdoutFrameBuffer = "";
    let stderr = "";
    let timedOut = false;
    let stdinClosed = false;
    const closeStdin = () => {
      if (stdinClosed || child.stdin.destroyed) return;
      stdinClosed = true;
      child.stdin.end();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROBE_TIMEOUT_MS);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout = truncateCapture(stdout + text);
      if (typeof input.closeStdinOnFrame !== "function") return;
      stdoutFrameBuffer += text;
      const lines = stdoutFrameBuffer.split(/\r?\n/);
      stdoutFrameBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const frame = parseRecord(line);
        if (frame && input.closeStdinOnFrame(frame)) closeStdin();
      }
    });
    child.stderr.on("data", (chunk) => { stderr = truncateCapture(stderr + String(chunk)); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: `${stderr}${safeMessage(error)}`, timedOut });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? null, stdout, stderr, timedOut });
    });
    if (typeof input.stdin === "string") {
      child.stdin.write(input.stdin);
      if (typeof input.closeStdinOnFrame !== "function") closeStdin();
    } else {
      closeStdin();
    }
  });
}

function createRestartArtifact() {
  return {
    schemaVersion: "coding-agent-restart-injection/v1",
    taskId: "gateway.process-restart",
    trigger: "run.started",
    status: "not_injected",
    observedStartedSeq: null,
    messageSendRequestCount: 0,
    binding: null,
    originalGateway: null,
    replacementGateway: null,
    subscription: { exitCode: null, errorCode: null, eventCount: 0, diagnostic: null },
    cancellation: { exitCode: null, accepted: null, state: null },
    cleanup: { managedGatewayProcessCount: 0, originalGateway: null, replacementGateway: null },
  };
}

function buildGatewayEnv(childEnv, target) {
  return {
    ...childEnv,
    BELLDANDY_HOST: target.host,
    BELLDANDY_PORT: String(target.port),
    BELLDANDY_AUTH_MODE: "none",
  };
}

async function readJsonl(target) {
  const content = await fs.readFile(target, "utf-8").catch(() => "");
  return parseJsonl(content);
}

function parseJsonl(value) {
  const records = [];
  for (const line of String(value).split(/\r?\n/)) {
    if (!line.trim()) continue;
    records.push(parseRecord(line));
  }
  return records;
}

function readBinding(value) {
  if (!value || typeof value !== "object") return undefined;
  const conversationId = typeof value.conversationId === "string" ? value.conversationId.trim() : "";
  const agentRunId = typeof value.agentRunId === "string" ? value.agentRunId.trim() : "";
  return conversationId && agentRunId ? { conversationId, agentRunId } : undefined;
}

function sameBinding(left, right) {
  return left?.conversationId === right?.conversationId && left?.agentRunId === right?.agentRunId;
}

function parseRecord(value) {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf-8") : String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function truncateCapture(value) {
  return value.length <= MAX_CAPTURE_BYTES ? value : value.slice(-MAX_CAPTURE_BYTES);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function sanitizeProbeDiagnostic(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text
    .replace(/\b(?:api[_-]?key|access[_-]?token|token|secret|password|authorization|cookie|session)[\w-]*\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/\bpairing\s+required\.\s*code:\s*[^\s,;]+/gi, "Pairing required. Code: [REDACTED]")
    .replace(/\bpairing(?:[_\s-]+code)?\s*[:=]\s*[^\s,;]+/gi, "pairing=[REDACTED]")
    .slice(0, 500);
}
