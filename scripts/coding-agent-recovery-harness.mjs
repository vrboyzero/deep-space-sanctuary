import { once } from "node:events";
import { spawn } from "node:child_process";
import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import WebSocket, { WebSocketServer } from "ws";

const TERMINAL_EVENT_TYPES = new Set([
  "run.cancelled",
  "run.interrupted",
  "run.completed",
  "run.failed",
]);
const WRITE_TOOL_NAMES = new Set(["apply_patch", "file_write"]);

export async function runCodingRunCursorContinuation(input) {
  const bddEntry = path.resolve(requireNonEmptyString(input?.bddEntry, "bddEntry"));
  const stateDir = path.resolve(requireNonEmptyString(input?.stateDir, "stateDir"));
  const binding = input?.binding;
  if (!isRecord(binding)
    || !readNonEmptyString(binding.conversationId)
    || !readNonEmptyString(binding.agentRunId)) {
    throw new Error("A complete recovery binding is required.");
  }
  const cursor = input?.cursor;
  if (!Number.isSafeInteger(cursor) || cursor < 1) throw new Error("Recovery cursor must be a positive safe integer.");
  const timeoutMs = input?.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("Recovery timeout must be at least 1000 ms.");
  const requestId = `coding-benchmark-recovery-${randomUUID()}`;

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bddEntry, "coding-run", "stdio", "--state-dir", stateDir], {
      cwd: input?.cwd ? path.resolve(input.cwd) : process.cwd(),
      env: { ...process.env, ...input?.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const events = [];
    let stdoutBuffer = "";
    let stderr = "";
    let terminalSeen = false;
    let subscriptionAccepted = false;
    let failure;
    let settled = false;
    const timeout = setTimeout(() => {
      failure = new Error("Coding run cursor continuation timed out before a terminal event.");
      child.kill();
    }, timeoutMs);

    const consumeLine = (line) => {
      if (!line.trim()) return;
      const frame = parseRecord(line);
      if (!frame) {
        failure ??= new Error("Coding run stdio emitted invalid NDJSON.");
        child.stdin.end();
        return;
      }
      if (frame.type === "subscription.response" && frame.id === requestId) {
        if (frame.ok !== true) {
          const message = isRecord(frame.error) && typeof frame.error.message === "string"
            ? frame.error.message
            : "Coding run subscription was rejected.";
          failure ??= new Error(message);
          child.stdin.end();
          return;
        }
        subscriptionAccepted = true;
        return;
      }
      if (frame.type === "subscription.error") {
        failure ??= new Error(typeof frame.message === "string" ? frame.message : "Coding run subscription was interrupted.");
        child.stdin.end();
        return;
      }
      if (frame.type !== "event" || !isRecord(frame.event)) return;
      events.push(frame.event);
      if (TERMINAL_EVENT_TYPES.has(frame.event.type)) {
        terminalSeen = true;
        child.stdin.end();
      }
    };

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
      if (failure) {
        reject(failure);
        return;
      }
      if (!subscriptionAccepted || !terminalSeen) {
        reject(new Error(stderr.trim() || "Coding run cursor continuation ended without a completed subscription."));
        return;
      }
      resolve({ exitCode: exitCode ?? 1, events, stderr });
    });
    child.stdin.write(`${JSON.stringify({
      version: "v1",
      type: "subscription.request",
      id: requestId,
      subscription: {
        version: "v1",
        binding: {
          conversationId: binding.conversationId,
          agentRunId: binding.agentRunId,
        },
        cursor,
      },
    })}\n`);
  });
}

export async function startGatewayDisconnectProxy(input) {
  const upstreamHost = requireNonEmptyString(input?.upstreamHost, "upstreamHost");
  const upstreamPort = requirePort(input?.upstreamPort, "upstreamPort");
  const targetPath = requireNonEmptyString(input?.targetPath, "targetPath").replaceAll("\\", "/");
  const requireCompletedMutation = input?.requireCompletedMutation === true;
  const mutationTarget = requireCompletedMutation
    ? resolveWorkspaceTarget(input?.workspace, targetPath)
    : undefined;
  const initialTargetSha256 = mutationTarget ? await hashFile(mutationTarget) : undefined;
  const upstreamOrigin = input?.upstreamOrigin === undefined
    ? undefined
    : requireNonEmptyString(input.upstreamOrigin, "upstreamOrigin");
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("Gateway fault proxy did not expose a TCP port.");

  let closed = false;
  let fault;
  let resolveFault;
  const faultPromise = new Promise((resolve) => { resolveFault = resolve; });
  const upstreamSockets = new Set();
  const trace = [];

  server.on("connection", (downstream, request) => {
    const origin = upstreamOrigin ?? readNonEmptyString(request.headers.origin);
    const upstream = new WebSocket(
      `ws://${upstreamHost}:${upstreamPort}`,
      origin ? { origin } : undefined,
    );
    upstreamSockets.add(upstream);
    const pending = [];
    const runRequestIds = new Set();
    const writeToolCalls = new Map();
    let binding;
    let projectedSeq = 0;

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
        runRequestIds.add(frame.id);
      }
      forwardUpstream(data, isBinary);
    });
    upstream.on("message", (data, isBinary) => {
      const frame = parseRecord(data);
      if (trace.length < 64) {
        trace.push({
          type: typeof frame?.type === "string" ? frame.type : "invalid",
          ...(typeof frame?.event === "string" ? { event: frame.event } : {}),
          ...(frame?.type === "res" && typeof frame.id === "string" && runRequestIds.has(frame.id)
            ? { messageSendResponse: true }
            : {}),
        });
      }
      if (!binding && frame?.type === "event") {
        const eventBinding = readGatewayBinding(frame.payload);
        if (eventBinding) {
          binding = eventBinding;
          projectedSeq = 1;
        }
      }
      if (frame?.type === "res" && typeof frame.id === "string" && runRequestIds.has(frame.id) && frame.ok === true) {
        const payload = isRecord(frame.payload) ? frame.payload : {};
        const conversationId = readNonEmptyString(payload.conversationId);
        const agentRunId = readNonEmptyString(payload.runId);
        if (!binding && conversationId && agentRunId) {
          binding = { conversationId, agentRunId };
          projectedSeq = 1;
        }
      } else if (binding && isProjectedGatewayEvent(frame, binding)) {
        projectedSeq += 1;
      }

      if (requireCompletedMutation && binding && isRecoveryWriteToolCall(frame, binding, targetPath)) {
        writeToolCalls.set(frame.payload.id, {
          id: frame.payload.id,
          name: frame.payload.name,
        });
      }

      const completedMutation = requireCompletedMutation && binding
        ? readSuccessfulRecoveryMutation(frame, binding, writeToolCalls)
        : undefined;
      const shouldDisconnect = !requireCompletedMutation && !fault
        && binding
        && isRecoveryWriteToolEvent(frame, binding, targetPath);
      if (downstream.readyState !== WebSocket.OPEN) return;
      downstream.send(data, { binary: isBinary }, async () => {
        if ((!shouldDisconnect && !completedMutation) || fault) return;
        let mutation;
        if (completedMutation && mutationTarget && initialTargetSha256) {
          const completedTargetSha256 = await hashFile(mutationTarget).catch(() => undefined);
          if (!completedTargetSha256 || completedTargetSha256 === initialTargetSha256 || fault) return;
          mutation = {
            trigger: "successful_tool_result_after_content_change",
            toolCallId: completedMutation.id,
            toolName: completedMutation.name,
            targetPath,
            resultSuccess: true,
            beforeSha256: initialTargetSha256,
            afterSha256: completedTargetSha256,
          };
        }
        fault = {
          schemaVersion: "coding-agent-fault-injection/v1",
          taskId: "gateway.disconnect-recovery",
          fault: "gateway_disconnect",
          status: "injected",
          disconnectedAfterSeq: projectedSeq,
          resumedFromSeq: null,
          disconnectCount: 1,
          reconnectCount: 0,
          binding: { ...binding },
          ...(mutation ? { mutation } : {}),
        };
        resolveFault(fault);
        setTimeout(() => {
          if (downstream.readyState === WebSocket.OPEN) downstream.close(1012, "Injected benchmark disconnect");
          if (upstream.readyState === WebSocket.OPEN) upstream.close(1012, "Injected benchmark disconnect");
        }, 20);
      });
    });
    upstream.on("error", () => {
      if (downstream.readyState === WebSocket.OPEN) downstream.close(1011, "Gateway fault proxy upstream failed");
    });
    upstream.on("close", () => {
      upstreamSockets.delete(upstream);
      if (!fault && downstream.readyState === WebSocket.OPEN) downstream.close(1011, "Gateway fault proxy upstream closed");
    });
    downstream.on("close", () => {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    });
  });

  return {
    host: "127.0.0.1",
    port: address.port,
    waitForFault: async () => await faultPromise,
    getFault: () => fault ? structuredClone(fault) : undefined,
    getTrace: () => structuredClone(trace),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const client of server.clients) client.terminate();
      for (const socket of upstreamSockets) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
      if (!fault) {
        fault = {
          schemaVersion: "coding-agent-fault-injection/v1",
          taskId: "gateway.disconnect-recovery",
          fault: "gateway_disconnect",
          status: "not_injected",
          disconnectedAfterSeq: null,
          resumedFromSeq: null,
          disconnectCount: 0,
          reconnectCount: 0,
          binding: null,
        };
        resolveFault(fault);
      }
    },
  };
}

export function buildRecoveredCodingCiArtifacts(input) {
  const initialManifest = input?.initialManifest;
  const workspaceArtifact = input?.workspaceArtifact;
  const fault = input?.fault;
  if (!isRecord(initialManifest) || !isRecord(initialManifest.checks)) {
    throw new Error("Recovery requires the initial Coding CI manifest.");
  }
  if (!isRecord(workspaceArtifact)
    || !Array.isArray(workspaceArtifact.changedPaths)
    || typeof workspaceArtifact.patch !== "string") {
    throw new Error("Recovery requires a complete workspace artifact.");
  }
  if (!isRecord(fault)
    || fault.status !== "injected"
    || !Number.isSafeInteger(fault.disconnectedAfterSeq)
    || fault.disconnectCount !== 1) {
    throw new Error("Recovery requires one externally injected Gateway disconnect.");
  }
  const events = mergeRecoveredAgentEvents({
    initial: input.initialEvents,
    resumed: input.resumedEvents,
    cursor: fault.disconnectedAfterSeq,
  });
  const terminal = events.at(-1);
  const capabilities = events[0]?.payload?.capabilities ?? null;
  const usage = terminal?.payload?.usage ?? null;
  const outputText = terminal?.payload?.output?.text;
  let result = null;
  if (typeof outputText === "string") {
    try {
      const parsed = JSON.parse(outputText);
      if (isRecord(parsed)) result = parsed;
    } catch {
      // Output-schema failures are model evidence; the evaluator classifies them after recovery is preserved.
    }
  }

  if (typeof input.projectCodingRunTraceEvents !== "function"
    || typeof input.validateCodingRunTraceEvents !== "function") {
    throw new Error("Recovery requires the Core coding run trace owner.");
  }
  const trace = input.projectCodingRunTraceEvents(events);
  const traceContract = input.validateCodingRunTraceEvents(trace);

  const {
    eventContractError: _eventContractError,
    artifactPolicyError: _artifactPolicyError,
    traceContractError: _traceContractError,
    trace: _trace,
    ...manifestBase
  } = initialManifest;
  return {
    events,
    trace,
    result,
    patch: workspaceArtifact.patch,
    manifest: {
      ...manifestBase,
      cliExitCode: 0,
      eventCount: events.length,
      terminalType: "run.completed",
      binding: { ...events[0].binding },
      capabilities,
      usage,
      trace: traceContract,
      changedPaths: [...workspaceArtifact.changedPaths],
      checks: {
        ...initialManifest.checks,
        eventContract: true,
        capabilityHandshake: isRecord(capabilities),
        usageComplete: isRecord(usage) && usage.status === "complete",
        traceContract: true,
        artifactPolicy: true,
      },
    },
    fault: {
      ...fault,
      status: "recovered",
      resumedFromSeq: fault.disconnectedAfterSeq,
      reconnectCount: 1,
    },
  };
}

export function mergeRecoveredAgentEvents(input) {
  const cursor = input?.cursor;
  if (!Number.isSafeInteger(cursor) || cursor < 1) throw new Error("Recovery cursor must be a positive safe integer.");
  const initial = Array.isArray(input?.initial) ? input.initial : [];
  const resumed = Array.isArray(input?.resumed) ? input.resumed : [];
  const prefix = initial.filter((event) => Number.isSafeInteger(event?.seq) && event.seq <= cursor);
  const combined = [...prefix, ...resumed];
  if (prefix.length !== cursor || resumed.length === 0) {
    throw new Error("Recovery event sequence does not cover the confirmed cursor and continuation.");
  }

  const binding = combined[0]?.binding;
  for (let index = 0; index < combined.length; index += 1) {
    const event = combined[index];
    if (event?.seq !== index + 1) throw new Error("Recovery event sequence contains a gap or duplicate cursor.");
    if (!sameBinding(event?.binding, binding)) throw new Error("Recovery event binding changed across the continuation.");
  }
  const terminals = combined.filter((event) => TERMINAL_EVENT_TYPES.has(event?.type));
  if (terminals.length !== 1 || terminals[0] !== combined.at(-1) || terminals[0]?.type !== "run.completed") {
    throw new Error("Recovery continuation must end in exactly one completed terminal event.");
  }
  const writeToolsById = new Map();
  let successfulWriteCount = 0;
  for (const event of combined) {
    const tool = event?.payload?.tool;
    const toolId = readNonEmptyString(tool?.id);
    const toolName = readNonEmptyString(tool?.name);
    if (event?.type === "tool.started" && toolId && toolName && WRITE_TOOL_NAMES.has(toolName)) {
      writeToolsById.set(toolId, toolName);
      continue;
    }
    if (event?.type === "tool.completed"
      && tool?.success === true
      && toolId
      && toolName
      && writeToolsById.get(toolId) === toolName) {
      successfulWriteCount += 1;
    }
  }
  if (successfulWriteCount !== 1) {
    throw new Error("Recovery continuation must contain exactly one successful workspace mutation.");
  }
  return combined.map((event) => ({
    ...event,
    binding: {
      conversationId: binding.conversationId,
      agentRunId: binding.agentRunId,
    },
  }));
}

function isProjectedGatewayEvent(frame, binding) {
  if (frame?.type !== "event" || typeof frame.event !== "string" || !matchesGatewayBinding(frame.payload, binding)) {
    return false;
  }
  const payload = frame.payload;
  if (frame.event === "agent.status") return true;
  if (frame.event === "chat.delta") return typeof payload.delta === "string";
  if (frame.event === "tool_call") return Boolean(readNonEmptyString(payload.id) && readNonEmptyString(payload.name));
  if (frame.event === "tool_result") {
    return Boolean(readNonEmptyString(payload.id) && readNonEmptyString(payload.name) && typeof payload.success === "boolean");
  }
  if (frame.event === "tool_event") {
    return payload.kind === "coding_run_permission_requested"
      && Boolean(readNonEmptyString(payload.toolCallId) && readNonEmptyString(payload.toolName));
  }
  return frame.event === "token.usage"
    || frame.event === "agent.budget_exhausted"
    || frame.event === "conversation.run.stopped"
    || frame.event === "conversation.run.interrupted"
    || frame.event === "chat.final";
}

function isRecoveryWriteToolEvent(frame, binding, targetPath) {
  if (frame?.type !== "event" || frame.event !== "tool_call" || !matchesGatewayBinding(frame.payload, binding)) return false;
  const payload = frame.payload;
  const name = readNonEmptyString(payload.name);
  if (!name || !WRITE_TOOL_NAMES.has(name)) return false;
  // Fixture/evaluator verify the concrete target path from the canonical event and Git diff.
  // The proxy must not depend on a provider-specific tool argument representation to inject the fault.
  void targetPath;
  return true;
}

function isRecoveryWriteToolCall(frame, binding, targetPath) {
  if (frame?.type !== "event" || frame.event !== "tool_call" || !matchesGatewayBinding(frame.payload, binding)) {
    return false;
  }
  const payload = frame.payload;
  const name = readNonEmptyString(payload.name);
  const id = readNonEmptyString(payload.id);
  if (!id || !name || !WRITE_TOOL_NAMES.has(name)) return false;
  return JSON.stringify(payload.arguments ?? {}).replaceAll("\\", "/").includes(targetPath);
}

function readSuccessfulRecoveryMutation(frame, binding, writeToolCalls) {
  if (frame?.type !== "event" || frame.event !== "tool_result" || !matchesGatewayBinding(frame.payload, binding)) {
    return undefined;
  }
  const payload = frame.payload;
  if (payload.success !== true) return undefined;
  const id = readNonEmptyString(payload.id);
  const known = id ? writeToolCalls.get(id) : undefined;
  if (!known || payload.name !== known.name) return undefined;
  return known;
}

function resolveWorkspaceTarget(workspace, targetPath) {
  const root = path.resolve(requireNonEmptyString(workspace, "workspace"));
  const target = path.resolve(root, ...targetPath.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Recovery mutation target must stay inside the fixture workspace.");
  }
  return target;
}

async function hashFile(target) {
  return crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex");
}

function matchesGatewayBinding(value, binding) {
  return isRecord(value)
    && value.conversationId === binding.conversationId
    && value.runId === binding.agentRunId;
}

function readGatewayBinding(value) {
  if (!isRecord(value)) return undefined;
  const conversationId = readNonEmptyString(value.conversationId);
  const agentRunId = readNonEmptyString(value.runId);
  return conversationId && agentRunId ? { conversationId, agentRunId } : undefined;
}

function parseRecord(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value).toString("utf-8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sameBinding(left, right) {
  return isRecord(left) && isRecord(right)
    && left.conversationId === right.conversationId
    && left.agentRunId === right.agentRunId;
}

function requireNonEmptyString(value, label) {
  const resolved = readNonEmptyString(value);
  if (!resolved) throw new Error(`${label} is required.`);
  return resolved;
}

function requirePort(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error(`${label} must be a valid TCP port.`);
  return value;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
