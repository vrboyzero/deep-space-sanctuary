import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  CODING_RUN_CLIENT_COMPATIBILITY,
  CodingRunClient,
} from "../packages/belldandy-core/src/coding-run-client.ts";
import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const require = createRequire(import.meta.url);
const { CodingRunStdioClient } = require("../apps/vscode-extension/src/stdio-client.cjs");
const conformanceRoot = path.resolve("benchmarks/coding-run-client");

describe("coding-run client conformance", () => {
  it("publishes a Schema-valid protocol chain with an explicit N-1 gate", async () => {
    const [versions, packageJson] = await Promise.all([
      readConformanceVersions(),
      readJson(path.resolve("packages/belldandy-core/package.json")),
    ]);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      const compiled = compileOutputSchema(version.schema);
      expect(compiled.ok, `${version.directory} conformance Schema`).toBe(true);
      if (!compiled.ok) continue;
      expect(
        compiled.validator.validateOutput(JSON.stringify(version.manifest)),
        `${version.directory} conformance manifest`,
      ).toMatchObject({ ok: true });
    }
    expect(validateCompatibilityChain(versions)).toEqual([]);

    const current = versions.at(-1).manifest;
    expect(CODING_RUN_CLIENT_COMPATIBILITY).toEqual({
      currentProtocolVersion: current.protocolVersion,
      previousProtocolVersion: current.previousProtocolVersion,
      previousVersionGate: current.previousVersionGate,
    });
    expect(packageJson.exports["./coding-run-client"]).toEqual({
      types: "./dist/coding-run-client.d.ts",
      import: "./dist/coding-run-client.js",
      default: "./dist/coding-run-client.js",
    });
  });

  it("requires a successor protocol to retain the immediately previous fixture", () => {
    const initial = {
      directory: "v1",
      manifest: {
        protocolVersion: "v1",
        previousProtocolVersion: null,
        previousVersionGate: "not_applicable_initial_version",
      },
    };
    const successor = {
      directory: "v2",
      manifest: {
        protocolVersion: "v2",
        previousProtocolVersion: "v1",
        previousVersionGate: "required_previous_version_fixture",
      },
    };

    expect(validateCompatibilityChain([initial])).toEqual([]);
    expect(validateCompatibilityChain([initial, successor])).toEqual([]);
    expect(validateCompatibilityChain([initial, {
      ...successor,
      manifest: {
        ...successor.manifest,
        previousProtocolVersion: null,
        previousVersionGate: "not_applicable_initial_version",
      },
    }])).toEqual([
      "v2 must reference v1 as previousProtocolVersion",
      "v2 must require the previous-version fixture",
    ]);
  });

  it("runs the same v1 lifecycle through the Core reference client and VS Code adapter", async () => {
    await expect(runLifecycle(createCoreAdapter())).resolves.toEqual(expectedLifecycle("core-reference"));
    await expect(runLifecycle(createVsCodeAdapter())).resolves.toEqual(expectedLifecycle("vscode-stdio"));
  });

  it("fails both adapters closed when their pending-request budget is exhausted", async () => {
    const core = createCoreAdapter({ maxPendingRequests: 1, autoRespond: false });
    const corePending = core.start();
    await expect(core.readArtifact()).rejects.toMatchObject({ code: "backpressure" });
    core.close();
    await expect(corePending).rejects.toMatchObject({ code: "client_closed" });

    const vscode = createVsCodeAdapter({ maxPendingRequests: 1, autoRespond: false });
    const vscodePending = vscode.start();
    await expect(vscode.readArtifact()).rejects.toThrow(/backpressure/u);
    vscode.close();
    await expect(vscodePending).rejects.toThrow(/stopped/u);
  });
});

function createCoreAdapter(options = {}) {
  let requestCount = 0;
  let closed = false;
  const client = new CodingRunClient({
    maxPendingRequests: options.maxPendingRequests,
    requestTimeoutMs: 50,
    createRequestId: () => `core-${++requestCount}`,
    write: async (line) => {
      if (options.autoRespond === false) return;
      const request = JSON.parse(line);
      queueMicrotask(() => client.consume(`${JSON.stringify(responseFor(request))}\n`));
    },
  });
  return {
    name: "core-reference",
    start: () => client.start({ prompt: "Inspect the workspace.", cwd: process.cwd() }),
    subscribe: () => client.subscribeRun({ conversationId: "conversation-1", agentRunId: "run-1", cursor: 0 }),
    respond: (decision) => client.respondPermission({ agentRunId: "run-1", toolCallId: `tool-${decision}`, decision }),
    cancel: () => client.cancel({ conversationId: "conversation-1", agentRunId: "run-1", reason: "conformance" }),
    readArtifact: () => client.readArtifact({ agentRunId: "run-1" }),
    close: () => { closed = true; client.close(); },
    isClosed: () => closed,
  };
}

function createVsCodeAdapter(options = {}) {
  const harness = createChildHarness(options.autoRespond !== false);
  let requestCount = 0;
  const client = new CodingRunStdioClient({
    command: "bdd",
    spawn: harness.spawn,
    maxPendingRequests: options.maxPendingRequests,
    requestTimeoutMs: 50,
    createRequestId: () => `vscode-${++requestCount}`,
  });
  return {
    name: "vscode-stdio",
    start: async () => unwrap(await client.requestConversation({ text: "Inspect the workspace.", cwd: process.cwd() })),
    subscribe: async () => unwrap(await client.subscribeConversation({ conversationId: "conversation-1", agentRunId: "run-1", cursor: 0 })),
    respond: async (decision) => unwrap(await client.respondPermission({ agentRunId: "run-1", toolCallId: `tool-${decision}`, decision })),
    cancel: async () => unwrap(await client.cancelConversation({ conversationId: "conversation-1", agentRunId: "run-1", reason: "conformance" })),
    readArtifact: async () => unwrap(await client.readArtifact({ agentRunId: "run-1" })),
    close: () => client.stop(),
    isClosed: () => client.state === "stopped",
  };
}

async function runLifecycle(adapter) {
  const operations = [];
  await adapter.start(); operations.push("start");
  await adapter.subscribe(); operations.push("subscribe");
  await adapter.respond("allow"); operations.push("respond_allow");
  await adapter.respond("deny"); operations.push("respond_deny");
  await adapter.cancel(); operations.push("cancel");
  await adapter.readArtifact(); operations.push("read_artifact");
  adapter.close(); operations.push("close");
  return { adapter: adapter.name, protocolVersion: "v1", contentMode: "none", operations, closed: adapter.isClosed() };
}

function expectedLifecycle(adapter) {
  return {
    adapter,
    protocolVersion: "v1",
    contentMode: "none",
    operations: ["start", "subscribe", "respond_allow", "respond_deny", "cancel", "read_artifact", "close"],
    closed: true,
  };
}

function responseFor(request) {
  const type = request.type.replace("request", "response");
  if (request.type === "conversation.request") {
    return { version: "v1", type, id: request.id, ok: true, result: { binding: { conversationId: "conversation-1", agentRunId: "run-1" } } };
  }
  if (request.type === "artifact.request") {
    return { version: "v1", type, id: request.id, ok: true, result: { revisionId: "run-1", contentMode: "none" } };
  }
  return { version: "v1", type, id: request.id, ok: true, result: { accepted: true } };
}

function createChildHarness(autoRespond) {
  let child;
  const spawn = vi.fn(() => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => { child.emit("exit", null, "SIGTERM"); return true; });
    if (autoRespond) {
      child.stdin.on("data", (chunk) => {
        for (const line of String(chunk).trim().split("\n")) {
          queueMicrotask(() => child.stdout.write(`${JSON.stringify(responseFor(JSON.parse(line)))}\n`));
        }
      });
    }
    return child;
  });
  return { spawn };
}

function unwrap(response) {
  if (response.ok) return response.result;
  throw new Error(`${response.error.code}: ${response.error.message}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readConformanceVersions() {
  const entries = await fs.readdir(conformanceRoot, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && /^v[1-9]\d*$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
  return await Promise.all(directories.map(async (directory) => ({
    directory,
    manifest: await readJson(path.join(conformanceRoot, directory, "conformance.json")),
    schema: await readJson(path.join(conformanceRoot, directory, "conformance.schema.json")),
  })));
}

function validateCompatibilityChain(versions) {
  const errors = [];
  for (let index = 0; index < versions.length; index += 1) {
    const version = versions[index];
    const expectedDirectory = `v${index + 1}`;
    if (version.directory !== expectedDirectory) {
      errors.push(`${version.directory} must be the contiguous protocol directory ${expectedDirectory}`);
    }
    if (version.manifest.protocolVersion !== version.directory) {
      errors.push(`${version.directory} manifest protocolVersion must match its directory`);
    }
    if (index === 0) {
      if (version.manifest.previousProtocolVersion !== null) {
        errors.push("v1 previousProtocolVersion must be null");
      }
      if (version.manifest.previousVersionGate !== "not_applicable_initial_version") {
        errors.push("v1 must mark the previous-version gate as not applicable");
      }
      continue;
    }

    const previous = versions[index - 1].manifest.protocolVersion;
    if (version.manifest.previousProtocolVersion !== previous) {
      errors.push(`${version.directory} must reference ${previous} as previousProtocolVersion`);
    }
    if (version.manifest.previousVersionGate !== "required_previous_version_fixture") {
      errors.push(`${version.directory} must require the previous-version fixture`);
    }
  }
  return errors;
}
