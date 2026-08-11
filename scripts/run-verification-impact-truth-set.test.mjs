import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  buildVerificationImpactTruthSetReport,
  parseVerificationImpactTruthSetCliArguments,
  runVerificationImpactTruthSet,
  validateVerificationImpactTruthSetManifest,
} from "./run-verification-impact-truth-set.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(workspaceRoot, "benchmarks/verification/v1/impact-truth-set.json");
const manifestSchemaPath = path.join(workspaceRoot, "benchmarks/verification/v1/impact-truth-set.schema.json");
const reportSchemaPath = path.join(workspaceRoot, "benchmarks/verification/v1/impact-truth-set-report.schema.json");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("verification impact truth set", () => {
  it("publishes closed schemas for the frozen manifest and report", async () => {
    const [manifest, manifestSchema, reportSchema, report] = await Promise.all([
      readJson(manifestPath),
      readJson(manifestSchemaPath),
      readJson(reportSchemaPath),
      buildPassingReport(),
    ]);

    expect(validateAgainstSchema(manifestSchema, manifest)).toMatchObject({ ok: true });
    expect(validateAgainstSchema(reportSchema, report)).toMatchObject({ ok: true });
    expect(validateAgainstSchema(reportSchema, { ...report, unsupported: true }).ok).toBe(false);
  });

  it("meets the frozen 95 percent Gate with exact zero-execution evidence", async () => {
    const report = await buildPassingReport();

    expect(report.truthSet).toMatchObject({
      id: "p1-b-verification-impact-v1",
      contractVersion: "verification-impact/v1",
    });
    expect(report.selector).toMatchObject({
      strategy: "changed-paths-v1",
      sourcePath: "scripts/run-verification-dag.mjs",
    });
    expect(report.metrics).toEqual({
      expected: 24,
      returned: 24,
      truePositive: 24,
      falsePositive: 0,
      falseNegative: 0,
      exactCases: 8,
      precision: 1,
      recall: 1,
      totalCases: 8,
      exactCaseRate: 1,
      precisionThreshold: 0.95,
      recallThreshold: 0.95,
      exactCaseRateThreshold: 0.95,
      passed: true,
    });
    expect(report.cases.find((testCase) => testCase.id === "web-browser")).toMatchObject({
      actualNodeIds: ["browser.relay", "build.shared", "test.web"],
      actualSelection: { scope: "browser", expanded: false, reason: "browser-required" },
      status: "passed",
    });
    expect(report.cases.find((testCase) => testCase.id === "unknown-impact")).toMatchObject({
      actualNodeIds: ["build.shared", "lint.config", "test.core", "test.go", "test.shared", "test.web", "typecheck.core"],
      actualSelection: { scope: "expanded", expanded: true, reason: "impact-unknown" },
      status: "passed",
    });
    expect(report.gate).toEqual({ passed: true, failures: [] });
    expect(report.execution).toEqual({
      selectionEvaluations: 8,
      commandsExecuted: false,
      providerCalls: 0,
      gatewayCalls: 0,
      modelCalls: 0,
      networkCalls: 0,
      credentialsRead: false,
      mutationCount: 0,
    });
  });

  it("fails closed when the expected node set drifts below the frozen thresholds", async () => {
    const temporaryRoot = await makeTemporaryRoot();
    const driftedManifestPath = path.join(temporaryRoot, "truth-set.json");
    const manifest = await readJson(manifestPath);
    manifest.cases[0].expectedNodeIds = ["build.shared"];
    await fs.writeFile(driftedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const report = await buildVerificationImpactTruthSetReport({
      manifestPath: driftedManifestPath,
      generatedAt: "2026-08-11T12:00:00.000Z",
    });

    expect(report.metrics).toMatchObject({
      expected: 22,
      returned: 24,
      truePositive: 22,
      falsePositive: 2,
      falseNegative: 0,
      exactCases: 7,
      recall: 1,
      exactCaseRate: 0.875,
      passed: false,
    });
    expect(report.metrics.precision).toBeCloseTo(22 / 24);
    expect(report.gate).toEqual({
      passed: false,
      failures: ["precision_below_threshold", "exact_case_rate_below_threshold"],
    });
  });

  it("writes one report and refuses to overwrite an existing artifact", async () => {
    const temporaryRoot = await makeTemporaryRoot();
    const outputPath = path.join(temporaryRoot, "report.json");
    const input = { outputPath, manifestPath, generatedAt: "2026-08-11T12:00:00.000Z" };

    await expect(runVerificationImpactTruthSet(input)).resolves.toMatchObject({ gate: { passed: true } });
    await expect(runVerificationImpactTruthSet(input)).rejects.toThrow(/already exists/u);
  });

  it("rejects manifest ambiguity and parses only explicit CLI arguments", async () => {
    const manifest = await readJson(manifestPath);
    expect(() => validateVerificationImpactTruthSetManifest({
      ...manifest,
      cases: [...manifest.cases, manifest.cases[0]],
    })).toThrow(/duplicate id/u);
    expect(() => validateVerificationImpactTruthSetManifest({
      ...manifest,
      cases: [{ ...manifest.cases[0], expectedNodeIds: ["unknown.node"] }],
    })).toThrow(/unknown node/u);

    expect(parseVerificationImpactTruthSetCliArguments([
      "--manifest", manifestPath,
      "--output", "artifacts/verification/impact-report.json",
    ])).toEqual({
      help: false,
      manifestPath,
      outputPath: path.resolve("artifacts/verification/impact-report.json"),
    });
    expect(parseVerificationImpactTruthSetCliArguments(["--help"])).toMatchObject({ help: true });
    expect(() => parseVerificationImpactTruthSetCliArguments(["--unknown", "value"])).toThrow(/Unsupported argument/u);
  });
});

function buildPassingReport() {
  return buildVerificationImpactTruthSetReport({
    manifestPath,
    generatedAt: "2026-08-11T12:00:00.000Z",
  });
}

async function makeTemporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ss-verification-impact-"));
  temporaryRoots.push(root);
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function validateAgainstSchema(schema, value) {
  const compiled = compileOutputSchema(schema);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return compiled;
  return compiled.validator.validateOutput(JSON.stringify(value));
}
