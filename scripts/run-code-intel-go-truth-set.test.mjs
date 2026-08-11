import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelGoTruthSetReport,
  parseCodeIntelGoTruthSetCliArguments,
  runCodeIntelGoTruthSet,
  validateGoTruthSetManifest,
} from "./run-code-intel-go-truth-set.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/go-truth-set.json");
const manifestSchemaPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/go-truth-set.schema.json");
const reportSchemaPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/go-truth-set-report.schema.json");
const fakeGoplsCommand = path.resolve("tools", process.platform === "win32" ? "gopls.exe" : "gopls");
const fakeGoCommand = path.resolve("tools", process.platform === "win32" ? "go.exe" : "go");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Go CodeIntel truth set", () => {
  it("publishes closed schemas for the frozen manifest and report", async () => {
    const [manifest, manifestSchema, reportSchema] = await Promise.all([
      readJson(manifestPath),
      readJson(manifestSchemaPath),
      readJson(reportSchemaPath),
    ]);
    const report = await buildPassingReport();

    expect(validateAgainstSchema(manifestSchema, manifest)).toMatchObject({ ok: true });
    expect(validateAgainstSchema(reportSchema, report)).toMatchObject({ ok: true });
  });

  it("meets the frozen Gate with exact fake-runtime evidence independent of gopls installation", async () => {
    const report = await buildPassingReport();

    expect(report.truthSet).toMatchObject({
      id: "p1-a2-go-canary-v1",
      contractVersion: "code-intel/v1",
      workspaceRevision: "p1-a2-go-canary-v1",
    });
    expect(report.provider).toMatchObject({
      id: "gopls",
      version: "v0.21.0",
      buildTags: ["canary"],
      toolchain: { goVersion: "go1.24.2" },
    });
    expect(report.metrics).toMatchObject({
      expected: 10,
      returned: 10,
      truePositive: 10,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
      passed: true,
    });
    expect(report.cases).toHaveLength(6);
    expect(report.lifecycle).toMatchObject({
      hostCount: 1,
      stoppedHostCount: 1,
      processStartCount: 1,
      unexpectedExitCount: 0,
      forcedTerminationCount: 0,
      failureCount: 0,
      responses: {
        maxBytes: 4 * 1024 * 1024,
        peakBytes: 2_048,
        rejectedCount: 0,
        passed: true,
      },
      concurrency: {
        maxRequestsPerHost: 1,
        peakActiveRequests: 1,
        rejectedCount: 0,
        passed: true,
      },
      passed: true,
    });
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.execution).toMatchObject({
      providerNetworkCalls: "not_observable",
      osNetworkIsolationVerified: false,
      processMemory: {
        hardLimitBytes: null,
        peakBytes: "not_observable",
        status: "unverified",
      },
      workspaceMutations: 0,
      stateRootCleaned: true,
    });
  });

  it("writes a report once and refuses to overwrite an existing artifact", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-go-code-intel-report-"));
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const input = passingInput({ outputPath });

    await expect(runCodeIntelGoTruthSet(input)).resolves.toMatchObject({ gate: { passed: true } });
    await expect(runCodeIntelGoTruthSet(input)).rejects.toThrow(/already exists/u);
  });

  it("fails the lifecycle Gate when response or concurrency limits are breached", async () => {
    const report = await buildCodeIntelGoTruthSetReport(passingInput({
      runtimeFactory: async (input) => {
        const runtime = await createPassingRuntime(input);
        const [diagnostics] = runtime.getLifecycleDiagnostics();
        return {
          ...runtime,
          getLifecycleDiagnostics: () => [{
            ...diagnostics,
            responses: { ...diagnostics.responses, rejectedCount: 1 },
            concurrency: { ...diagnostics.concurrency, rejectedCount: 1 },
          }],
        };
      },
    }));

    expect(report.lifecycle).toMatchObject({
      responses: { rejectedCount: 1, passed: false },
      concurrency: { rejectedCount: 1, passed: false },
      passed: false,
    });
    expect(report.gate).toEqual({
      passed: false,
      failures: ["lifecycle_gate_failed"],
    });
  });

  it("rejects duplicate cases and parses only explicit runner arguments", async () => {
    const manifest = await readJson(manifestPath);
    expect(() => validateGoTruthSetManifest({
      ...manifest,
      cases: [...manifest.cases, manifest.cases[0]],
    })).toThrow(/duplicate/u);

    expect(parseCodeIntelGoTruthSetCliArguments([
      "--platform", currentPlatform(),
      "--manifest", manifestPath,
      "--output", "artifacts/go-code-intel/report.json",
      "--gopls-command", fakeGoplsCommand,
      "--go-command", fakeGoCommand,
    ])).toEqual({
      platform: currentPlatform(),
      manifestPath,
      outputPath: path.resolve("artifacts/go-code-intel/report.json"),
      goplsCommand: fakeGoplsCommand,
      goCommand: fakeGoCommand,
    });
    expect(() => parseCodeIntelGoTruthSetCliArguments(["--unknown", "value"]))
      .toThrow(/Unknown argument/u);
  });
});

function buildPassingReport() {
  return buildCodeIntelGoTruthSetReport(passingInput());
}

function passingInput(overrides = {}) {
  return {
    platform: currentPlatform(),
    manifestPath,
    goplsCommand: fakeGoplsCommand,
    goCommand: fakeGoCommand,
    generatedAt: "2026-08-10T16:18:28.804Z",
    runtimeFactory: createPassingRuntime,
    ...overrides,
  };
}

async function createPassingRuntime({ fixtureRoot, manifest }) {
  let caseIndex = 0;
  return {
    codeIntel: {
      async query() {
        const testCase = manifest.cases[caseIndex++];
        const items = await Promise.all(testCase.expected.map(async (expected) => {
          const filePath = path.join(fixtureRoot, expected.path);
          const source = await fs.readFile(filePath, "utf-8");
          return {
            location: {
              scope: expected.scope,
              path: expected.path,
              range: resolveAnchor(source, expected.anchor),
            },
            symbolKind: "unknown",
            documentRevision: `sha256:${sha256(source)}`,
          };
        }));
        return { ok: true, result: { items } };
      },
      async disposeAsync() {},
    },
    provider: { id: "gopls", version: "v0.21.0" },
    toolchain: {
      goVersion: "go1.24.2",
      platform: process.platform === "win32" ? "windows/amd64" : "linux/amd64",
    },
    governance: {
      capabilities: ["symbols", "definition", "references", "implementation"],
      dependencyRestore: "denied",
      networkPolicy: "environment-deny",
      sandboxStatus: "unverified",
      productionEligible: false,
    },
    resourceLimits: {
      decodedResponseMaxBytes: 4 * 1024 * 1024,
      maxConcurrentRequestsPerHost: 1,
      processMemoryHardLimitBytes: null,
      processMemoryStatus: "unverified",
    },
    execution: { probeCommands: 0 },
    getLifecycleDiagnostics: () => [{
      state: "stopped",
      processStartCount: 1,
      unexpectedExitCount: 0,
      requestCount: manifest.cases.length,
      forcedTerminationCount: 0,
      responses: {
        maxBytes: 4 * 1024 * 1024,
        lastBytes: 1_024,
        peakBytes: 2_048,
        rejectedCount: 0,
      },
      concurrency: {
        maxRequests: 1,
        activeRequests: 0,
        peakActiveRequests: 1,
        rejectedCount: 0,
      },
      serverRequests: {
        handledCount: 0,
        rejectedCount: 0,
        registeredCapabilityMethods: [],
      },
    }],
    async cleanup() {},
  };
}

function resolveAnchor(source, anchor) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(anchor.text)}(?![A-Za-z0-9_$])`, "gu");
  const offsets = [...source.matchAll(pattern)].map((match) => match.index);
  const offset = offsets[anchor.occurrence - 1];
  if (offset === undefined) throw new Error("anchor missing");
  return {
    start: offsetToPosition(source, offset),
    end: offsetToPosition(source, offset + anchor.text.length),
  };
}

function offsetToPosition(source, offset) {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, column: lines.at(-1)?.length ?? 0 };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function currentPlatform() {
  return process.platform === "win32" ? "windows-native" : "wsl2-linux";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

function validateAgainstSchema(schema, value) {
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) return compiled;
  return compiled.validator.validateOutput(JSON.stringify(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
