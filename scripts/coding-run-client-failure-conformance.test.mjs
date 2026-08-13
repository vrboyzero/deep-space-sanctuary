import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  CodingRunClient,
  CodingRunClientRequestError,
} from "../packages/belldandy-core/src/coding-run-client.ts";

const require = createRequire(import.meta.url);
const {
  CodingRunStdioClient,
  CodingRunStdioClientError,
} = require("../apps/vscode-extension/src/stdio-client.cjs");

const GATEWAY_ERROR_CODES = [
  "invalid_request", "not_found", "run_mismatch", "not_active", "permission_required",
  "permission_denied", "policy_denied", "budget_exhausted", "cancelled", "interrupted",
  "output_schema_invalid", "gateway_unavailable", "invalid_limit", "cursor_stale",
  "cursor_future", "cursor_out_of_range", "internal",
];

describe("coding-run client v1 failure conformance", () => {
  it("rejects unknown envelope fields and invalid or oversized frames without settling pending requests", async () => {
    const core = createCoreHarness({ maxFrameBytes: 128 });
    const corePending = core.client.cancel(binding());
    core.client.consume(`${JSON.stringify(successFrame(core.requests[0], { extra: true }))}\n`);
    core.client.consume("not-json\n");
    core.client.consume(`${"x".repeat(129)}\n`);
    expect(core.protocolErrors.map((error) => error.code)).toEqual([
      "invalid_frame", "invalid_frame", "frame_too_large",
    ]);
    core.client.close();
    await expect(corePending).rejects.toMatchObject({ code: "client_closed" });

    const vscode = createVsCodeHarness({ maxFrameBytes: 128 });
    const vscodePending = vscode.client.cancelConversation(binding());
    await nextTurn();
    vscode.child.stdout.write(`${JSON.stringify(successFrame(vscode.requests[0], { extra: true }))}\n`);
    vscode.child.stdout.write("not-json\n");
    vscode.child.stdout.write(`${"x".repeat(129)}\n`);
    await nextTurn();
    expect(vscode.protocolErrors.map((error) => error.code)).toEqual([
      "invalid_frame", "invalid_frame", "frame_too_large",
    ]);
    vscode.client.stop();
    await expect(vscodePending).rejects.toMatchObject({ code: "client_closed" });
  });

  it("preserves every declared Gateway code and redacts bounded error messages", async () => {
    const core = createCoreHarness();
    const vscode = createVsCodeHarness();
    for (const [index, code] of GATEWAY_ERROR_CODES.entries()) {
      const corePending = core.client.cancel(binding());
      core.client.consume(`${JSON.stringify(errorFrame(core.requests[index], code))}\n`);
      await expect(corePending).rejects.toMatchObject({
        name: "CodingRunClientRequestError",
        code,
        message: "token=[REDACTED]",
      });

      const vscodePending = vscode.client.cancelConversation(binding());
      await waitForRequests(vscode.requests, index + 1);
      vscode.child.stdout.write(`${JSON.stringify(errorFrame(vscode.requests[index], code))}\n`);
      await expect(vscodePending).resolves.toEqual({
        ok: false,
        error: { code, message: "token=[REDACTED]" },
      });
    }
    core.client.close();
    vscode.client.stop();
  });

  it("keeps subscription and projection cursor failures distinct", async () => {
    const coreInterruptions = [];
    const core = createCoreHarness({ onSubscriptionError: (error) => coreInterruptions.push(error) });
    const vscodeInterruptions = [];
    const vscode = createVsCodeHarness({ onSubscriptionError: (error) => vscodeInterruptions.push(error) });
    await vscode.client.start();

    core.client.consume(`${JSON.stringify(subscriptionErrorFrame())}\n`);
    vscode.child.stdout.write(`${JSON.stringify(subscriptionErrorFrame())}\n`);
    await nextTurn();
    expect(coreInterruptions).toEqual([expect.objectContaining({ code: "cursor_expired", message: "token=[REDACTED]" })]);
    expect(vscodeInterruptions).toEqual([expect.objectContaining({ code: "cursor_expired", message: "token=[REDACTED]" })]);

    for (const [index, code] of ["cursor_stale", "cursor_future", "cursor_out_of_range"].entries()) {
      const corePending = core.client.listTaskProjections();
      core.client.consume(`${JSON.stringify(errorFrame(core.requests[index], code))}\n`);
      await expect(corePending).rejects.toMatchObject({ code });

      const vscodePending = vscode.client.listTaskProjections();
      await waitForRequests(vscode.requests, index + 1);
      vscode.child.stdout.write(`${JSON.stringify(errorFrame(vscode.requests[index], code))}\n`);
      await expect(vscodePending).resolves.toMatchObject({ ok: false, error: { code } });
    }
    core.client.close();
    vscode.client.stop();
  });

  it("uses stable local codes for backpressure, abort, timeout, transport failure, and close", async () => {
    const core = createCoreHarness({ maxPendingRequests: 1, requestTimeoutMs: 25 });
      const corePending = core.client.cancel(binding());
      await expect(core.client.readArtifact({ agentRunId: "run-1" })).rejects.toMatchObject({ code: "backpressure" });
      const coreAbort = new AbortController();
      coreAbort.abort();
      core.client.close();
      await expect(corePending).rejects.toMatchObject({ code: "client_closed" });
      await expect(new CodingRunClient({ write: () => undefined }).cancel(binding(), { signal: coreAbort.signal }))
        .rejects.toMatchObject({ code: "request_aborted" });

      const coreTimeout = new CodingRunClient({ write: () => undefined, requestTimeoutMs: 25 });
      const coreTimed = coreTimeout.cancel(binding());
      await expect(coreTimed).rejects.toMatchObject({ code: "request_timeout" });
      const coreTransport = new CodingRunClient({ write: () => { throw new Error("token=core-private"); } });
      await expect(coreTransport.cancel(binding())).rejects.toMatchObject({ code: "transport_error", message: "token=[REDACTED]" });

      const vscode = createVsCodeHarness({ maxPendingRequests: 1, requestTimeoutMs: 25 });
      const vscodePending = vscode.client.cancelConversation(binding());
      await nextTurn();
      await expect(vscode.client.readArtifact({ agentRunId: "run-1" })).rejects.toMatchObject({ code: "backpressure" });
      vscode.client.stop();
      await expect(vscodePending).rejects.toMatchObject({ code: "client_closed" });
      const vscodeAbort = new AbortController();
      vscodeAbort.abort();
      await expect(vscode.client.cancelConversation(binding(), { signal: vscodeAbort.signal }))
        .rejects.toMatchObject({ code: "request_aborted" });

      const vscodeTimeout = createVsCodeHarness({ requestTimeoutMs: 25 });
      const vscodeTimed = vscodeTimeout.client.cancelConversation(binding());
      await nextTurn();
      await expect(vscodeTimed).rejects.toMatchObject({ code: "request_timeout" });
      const vscodeTransport = createVsCodeHarness();
      const vscodeTransportPending = vscodeTransport.client.cancelConversation(binding());
      await nextTurn();
      vscodeTransport.child.emit("error", new Error("token=vscode-private"));
      await expect(vscodeTransportPending).rejects.toMatchObject({
        code: "transport_error",
        message: "Belldandy coding-run bridge failed: token=[REDACTED]",
      });
      expect(CodingRunClientRequestError).toBeTypeOf("function");
      expect(CodingRunStdioClientError).toBeTypeOf("function");
  });

  it("rejects unknown projection input fields before transport start", async () => {
    const core = createCoreHarness();
    await expect(core.client.listTaskProjections({ prompt: "forbidden" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(core.requests).toHaveLength(0);

    const vscode = createVsCodeHarness();
    await expect(vscode.client.listTaskProjections({ prompt: "forbidden" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(vscode.spawn).not.toHaveBeenCalled();
  });
});

function createCoreHarness(options = {}) {
  const requests = [];
  const protocolErrors = [];
  const client = new CodingRunClient({
    maxFrameBytes: options.maxFrameBytes,
    maxPendingRequests: options.maxPendingRequests,
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    createRequestId: () => `core-failure-${requests.length + 1}`,
    write: (line) => { requests.push(JSON.parse(line)); },
    onProtocolError: (error) => protocolErrors.push(error),
    onSubscriptionError: options.onSubscriptionError,
  });
  return { client, requests, protocolErrors };
}

function createVsCodeHarness(options = {}) {
  const requests = [];
  let child;
  const spawn = vi.fn(() => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => { child.emit("exit", null, "SIGTERM"); return true; });
    child.stdin.on("data", (chunk) => {
      for (const line of String(chunk).trim().split("\n")) requests.push(JSON.parse(line));
    });
    return child;
  });
  const protocolErrors = [];
  const client = new CodingRunStdioClient({
    command: "bdd",
    spawn,
    maxFrameBytes: options.maxFrameBytes,
    maxPendingRequests: options.maxPendingRequests,
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    createRequestId: () => `vscode-failure-${requests.length + 1}`,
    onProtocolError: (error) => protocolErrors.push(error),
    onSubscriptionError: options.onSubscriptionError,
  });
  return {
    client,
    spawn,
    protocolErrors,
    requests,
    get child() {
      if (!child) throw new Error("Expected VS Code harness child to exist.");
      return child;
    },
  };
}

function binding() {
  return { conversationId: "conversation-1", agentRunId: "run-1" };
}

function successFrame(request, extra = {}) {
  return { version: "v1", type: request.type.replace("request", "response"), id: request.id, ok: true, result: {}, ...extra };
}

function errorFrame(request, code) {
  return {
    version: "v1",
    type: request.type.replace("request", "response"),
    id: request.id,
    ok: false,
    error: { code, message: "token=private-value" },
  };
}

function subscriptionErrorFrame() {
  return {
    version: "v1",
    type: "subscription.error",
    code: "cursor_expired",
    message: "token=private-value",
    binding: binding(),
  };
}

async function waitForRequests(requests, count) {
  for (let attempt = 0; attempt < 10 && requests.length < count; attempt += 1) await nextTurn();
  expect(requests).toHaveLength(count);
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}
