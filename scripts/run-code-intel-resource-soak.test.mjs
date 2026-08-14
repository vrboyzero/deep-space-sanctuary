import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildCodeIntelResourceSoakReport,
  compareCodeIntelResourceSoakReports,
  parseCodeIntelResourceSoakCliArguments,
  writeCodeIntelResourceSoakReport,
} from "./run-code-intel-resource-soak.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/resource-soak.json");
const temporaryRoots = [];
const RESOURCE_SOAK_TEST_TIMEOUT_MS = 30_000;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CodeIntel resource soak", () => {
  it("publishes schemas that accept the frozen config and a real bounded lifecycle report", async () => {
    const [config, configSchema, reportSchema] = await Promise.all([
      readJson(configPath),
      readJson(path.join(workspaceRoot, "benchmarks/code-intel/v1/resource-soak.schema.json")),
      readJson(path.join(workspaceRoot, "benchmarks/code-intel/v1/resource-soak-report.schema.json")),
    ]);
    const report = await buildCodeIntelResourceSoakReport({
      platform: currentPlatform(),
      configPath,
      generatedAt: "2026-08-09T09:00:00.000Z",
      forceGc: () => {},
      memoryUsage: stableMemoryUsage,
    });

    expect(validateAgainstSchema(configSchema, config)).toMatchObject({ ok: true });
    expect(validateAgainstSchema(reportSchema, report)).toMatchObject({ ok: true });
    const failedReport = structuredClone(report);
    failedReport.timing.durationMs = config.limits.maxDurationMs + 1;
    failedReport.gates = { passed: false, failures: ["duration_limit_exceeded"] };
    expect(validateAgainstSchema(reportSchema, failedReport)).toMatchObject({ ok: true });
    expect(report.gates).toMatchObject({ passed: true });
    expect(report.lifecycle.maxActiveSessions).toBe(config.workload.maxWorkspaceSessions);
    expect(report.lifecycle.lruEvictions).toBeGreaterThanOrEqual(config.expectations.minimumLruEvictions);
    expect(report.lifecycle.revisionReloads).toBe(config.expectations.revisionReloads);
    expect(report.lifecycle.activeSessionsAfterDispose).toBe(0);
    expect(report.revision).toMatchObject({ staleCursorRejected: true, documentRevisionChanged: true });
    expect(report.cleanup).toMatchObject({ temporaryRootRemoved: true, residualPaths: 0 });
    expect(report.execution).toMatchObject({
      gatewayCalls: 0,
      modelCalls: 0,
      paidProviderCalls: 0,
      providerNetworkCalls: 0,
      hostCommands: 0,
      credentialsRead: false,
      productionWorkspaceMutations: 0,
    });

    const otherPlatformReport = {
      ...structuredClone(report),
      platform: report.platform === "windows-native" ? "wsl2-linux" : "windows-native",
    };
    expect(compareCodeIntelResourceSoakReports(report, otherPlatformReport)).toEqual({
      passed: true,
      failures: [],
    });
    otherPlatformReport.sourceIdentity.files[0].runtimeSha256 = "f".repeat(64);
    expect(compareCodeIntelResourceSoakReports(report, otherPlatformReport)).toMatchObject({
      passed: false,
      failures: ["identity_mismatch:sourceIdentity"],
    });
  }, RESOURCE_SOAK_TEST_TIMEOUT_MS);

  it("fails closed when the frozen runtime source identity drifts", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-code-intel-soak-config-"));
    temporaryRoots.push(temporaryRoot);
    const config = await readJson(configPath);
    config.sourceIdentity.files[0].sha256 = "0".repeat(64);
    const copiedConfigPath = path.join(temporaryRoot, "resource-soak.json");
    await fs.writeFile(copiedConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

    await expect(buildCodeIntelResourceSoakReport({
      platform: currentPlatform(),
      configPath: copiedConfigPath,
      generatedAt: "2026-08-09T09:00:00.000Z",
      forceGc: () => {},
    })).rejects.toThrow(/source hash mismatch/u);
  });

  it("writes a completed report once and refuses to overwrite it", async () => {
    const report = await buildCodeIntelResourceSoakReport({
      platform: currentPlatform(),
      configPath,
      generatedAt: "2026-08-09T09:00:00.000Z",
      forceGc: () => {},
      memoryUsage: stableMemoryUsage,
    });
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-code-intel-soak-report-"));
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");

    await writeCodeIntelResourceSoakReport(report, outputPath);
    await expect(writeCodeIntelResourceSoakReport(report, outputPath)).rejects.toThrow(/already exists/u);
    expect(sha256(await fs.readFile(outputPath))).toBe(sha256(`${JSON.stringify(report, null, 2)}\n`));
  }, RESOURCE_SOAK_TEST_TIMEOUT_MS);

  it("parses only explicit platform, config, and output arguments", () => {
    const platform = currentPlatform();
    expect(parseCodeIntelResourceSoakCliArguments([
      "--platform", platform,
      "--config", "benchmarks/code-intel/v1/resource-soak.json",
      "--output", "artifacts/code-intel/resource-soak.json",
    ])).toEqual({
      platform,
      configPath: path.resolve("benchmarks/code-intel/v1/resource-soak.json"),
      outputPath: path.resolve("artifacts/code-intel/resource-soak.json"),
    });
    expect(() => parseCodeIntelResourceSoakCliArguments(["--unknown", "value"]))
      .toThrow(/Unknown argument/u);
  });
});

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

function stableMemoryUsage() {
  return { heapUsed: 64 * 1024 * 1024, rss: 128 * 1024 * 1024 };
}
