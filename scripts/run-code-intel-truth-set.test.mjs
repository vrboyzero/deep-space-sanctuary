import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { hashCanonicalText } from "./coding-agent-benchmark-contract.mjs";
import {
  buildCodeIntelTruthSetReport,
  calculateLocationMetrics,
  parseCodeIntelTruthSetCliArguments,
  runCodeIntelTruthSet,
} from "./run-code-intel-truth-set.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/truth-set.json");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CodeIntel truth set", () => {
  it("publishes the frozen real-agent uplift Gate before consumer implementation", async () => {
    const [gate, schema, currentTaskManifest, truthSet] = await Promise.all([
      readJson(path.join(workspaceRoot, "benchmarks/code-intel/v1/agent-uplift-gate.json")),
      readJson(path.join(workspaceRoot, "benchmarks/code-intel/v1/agent-uplift-gate.schema.json")),
      fs.readFile(path.join(workspaceRoot, "benchmarks/coding-agent/v3/task-manifest.json")),
      fs.readFile(manifestPath),
    ]);

    expect(validateAgainstSchema(schema, gate)).toMatchObject({ ok: true });
    expect(gate.sourceIdentity).toEqual({
      taskManifest: {
        path: "benchmarks/coding-agent/v3/task-manifest.json",
        sha256: "9039313b6b193cd12ae63bbb92aa55a79db76c07e2f68953c146a9629a67c1ea",
      },
      truthSet: {
        path: "benchmarks/code-intel/v1/truth-set.json",
        sha256: hashCanonicalText(truthSet.toString("utf-8")),
      },
    });
    expect(hashCanonicalText(currentTaskManifest.toString("utf-8"))).toBe(
      "aed0bcd54af52560fc16fb2fd2ddd07e49cd8c338e86f52ab1a6d6e4731006dd",
    );
    expect(hashCanonicalText(currentTaskManifest.toString("utf-8"))).not.toBe(
      gate.sourceIdentity.taskManifest.sha256,
    );
    expect(gate.cohort.map((entry) => entry.taskId)).toEqual([
      "real-ts.api-migration",
      "real-ts.cross-package-refactor",
      "real-js.bug-fix",
      "real-js.failed-test-fix",
    ]);
    expect(gate.pairedRuns).toMatchObject({
      platforms: ["windows-native", "wsl2-linux"],
      attemptsPerCell: 1,
      totalPairs: 8,
      onlyAllowedCandidateDifference: "append-code_intel-to-toolAllow",
    });
    expect(gate.gates).toMatchObject({
      regressionCount: 0,
      semanticAdoption: {
        requiredCapability: "semantic-live",
        minimumSuccessfulRuns: 6,
        minimumSuccessfulRunsPerPlatform: 3,
      },
      binaryOutcomes: {
        metrics: ["taskSuccess", "patchAcceptance", "testSuccess"],
        comparison: "candidate-gte-baseline-per-pair",
      },
      contextWaste: {
        noRegression: [
          "modelVisibleNavigationBytes",
          "nonTargetWholeFileReadCalls",
        ],
        comparison: "candidate-cohort-total-lte-baseline-cohort-total",
        minimumImprovementAlternatives: [
          {
            metric: "modelVisibleNavigationBytes",
            relativeReduction: 0.15,
          },
          {
            metric: "nonTargetWholeFileReadCalls",
            relativeReduction: 0.25,
            absoluteReduction: 2,
          },
        ],
      },
    });
  });

  it("publishes schemas that accept the frozen manifest and a real report", async () => {
    const [manifest, manifestSchema, reportSchema] = await Promise.all([
      readJson(manifestPath),
      readJson(path.join(workspaceRoot, "benchmarks/code-intel/v1/truth-set.schema.json")),
      readJson(path.join(workspaceRoot, "benchmarks/code-intel/v1/report.schema.json")),
    ]);
    const report = await buildCodeIntelTruthSetReport({
      platform: currentPlatform(),
      manifestPath,
      generatedAt: "2026-08-09T07:00:00.000Z",
    });

    expect(validateAgainstSchema(manifestSchema, manifest)).toMatchObject({ ok: true });
    expect(validateAgainstSchema(reportSchema, report)).toMatchObject({ ok: true });
  });

  it("calculates micro precision and recall from exact location sets", () => {
    expect(calculateLocationMetrics(
      new Set(["a", "b", "c"]),
      new Set(["b", "c", "d"]),
    )).toEqual({
      expected: 3,
      returned: 3,
      truePositive: 2,
      falsePositive: 1,
      falseNegative: 1,
      precision: 2 / 3,
      recall: 2 / 3,
    });
  });

  it("meets the frozen 95 percent Gate on the TS/JS core truth set", async () => {
    const report = await buildCodeIntelTruthSetReport({
      platform: currentPlatform(),
      manifestPath,
      generatedAt: "2026-08-09T07:00:00.000Z",
    });

    expect(report.truthSet).toMatchObject({
      id: "p1-a1-ts-js-core-v1",
      contractVersion: "code-intel/v1",
      workspaceRevision: "p1-a1-ts-js-core-v1",
    });
    expect(report.provider).toMatchObject({
      id: "typescript-language-service",
      capability: "semantic-live",
    });
    expect(report.metrics).toMatchObject({
      expected: 14,
      precisionThreshold: 0.95,
      recallThreshold: 0.95,
      passed: true,
    });
    expect(report.metrics.precision).toBeGreaterThanOrEqual(0.95);
    expect(report.metrics.recall).toBeGreaterThanOrEqual(0.95);
    expect(report.cases).toHaveLength(7);
    expect(report.cases.every((entry) => entry.status === "passed")).toBe(true);
  });

  it("accepts a CRLF-only checkout while preserving the frozen LF identity", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-code-intel-truth-crlf-"));
    temporaryRoots.push(temporaryRoot);
    await fs.cp(path.dirname(manifestPath), temporaryRoot, { recursive: true });
    const copiedManifest = path.join(temporaryRoot, "truth-set.json");
    const manifest = await readJson(copiedManifest);
    const textPaths = [
      copiedManifest,
      ...manifest.workspace.sourceFiles.map((sourceFile) => (
        path.join(temporaryRoot, manifest.workspace.root, sourceFile.path)
      )),
    ];
    for (const filePath of textPaths) {
      const text = await fs.readFile(filePath, "utf-8");
      await fs.writeFile(filePath, text.replace(/\r?\n/g, "\r\n"), "utf-8");
    }

    const report = await buildCodeIntelTruthSetReport({
      platform: currentPlatform(),
      manifestPath: copiedManifest,
      generatedAt: "2026-08-09T07:00:00.000Z",
    });

    expect(report.metrics.passed).toBe(true);
    expect(report.truthSet.manifestSha256).toBe(
      hashCanonicalText(await fs.readFile(manifestPath, "utf-8")),
    );
    expect(report.sourceIdentity.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/caller.ts", sha256: "bda552f7425c3956b5aa83b5756b08a2659deac365ed605104849f5006f4d389" }),
    ]));
  });

  it("fails closed when a frozen source file drifts", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-code-intel-truth-drift-"));
    temporaryRoots.push(temporaryRoot);
    await fs.cp(path.dirname(manifestPath), temporaryRoot, { recursive: true });
    const copiedManifest = path.join(temporaryRoot, "truth-set.json");
    await fs.appendFile(path.join(temporaryRoot, "fixtures/ts-js-core/src/model.ts"), "// drift\n", "utf-8");

    await expect(buildCodeIntelTruthSetReport({
      platform: currentPlatform(),
      manifestPath: copiedManifest,
      generatedAt: "2026-08-09T07:00:00.000Z",
    })).rejects.toThrow(/source hash mismatch/u);
  });

  it("writes a report once and refuses to overwrite an existing artifact", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ss-code-intel-truth-report-"));
    temporaryRoots.push(temporaryRoot);
    const outputPath = path.join(temporaryRoot, "report.json");
    const first = await runCodeIntelTruthSet({
      platform: currentPlatform(),
      manifestPath,
      outputPath,
      generatedAt: "2026-08-09T07:00:00.000Z",
    });

    expect(first.metrics.passed).toBe(true);
    await expect(runCodeIntelTruthSet({
      platform: currentPlatform(),
      manifestPath,
      outputPath,
      generatedAt: "2026-08-09T07:00:00.000Z",
    })).rejects.toThrow(/already exists/u);
  });

  it("parses only explicit platform, manifest, and output arguments", () => {
    const platform = currentPlatform();
    expect(parseCodeIntelTruthSetCliArguments([
      "--platform", platform,
      "--manifest", "benchmarks/code-intel/v1/truth-set.json",
      "--output", "artifacts/code-intel/report.json",
    ])).toEqual({
      platform,
      manifestPath: path.resolve("benchmarks/code-intel/v1/truth-set.json"),
      outputPath: path.resolve("artifacts/code-intel/report.json"),
    });
    expect(() => parseCodeIntelTruthSetCliArguments(["--unknown", "value"]))
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
