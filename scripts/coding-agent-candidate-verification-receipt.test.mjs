import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(
  workspaceRoot,
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-verification-evidence-receipt.schema.json",
);

describe("coding agent candidate Verification evidence receipt", () => {
  it("freezes one current-candidate receipt across impact, structured test, replay, and Browser Relay owners", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const receipt = candidateVerificationReceipt();
    expect(schema.properties.schemaVersion.const).toBe(
      "coding-agent-benchmark-candidate-verification-evidence-receipt/v1",
    );
    expect(compiled.validator.validateOutput(JSON.stringify(receipt))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...receipt,
      numericScore: 9.6,
    }))).toMatchObject({ ok: false });

    const driftedViewport = structuredClone(receipt);
    driftedViewport.browserRelay.runs[0].viewport.width = 390;
    expect(compiled.validator.validateOutput(JSON.stringify(driftedViewport))).toMatchObject({ ok: false });
  });
});

function candidateVerificationReceipt() {
  return {
    schemaVersion: "coding-agent-benchmark-candidate-verification-evidence-receipt/v1",
    generatedAt: "2026-09-01T03:00:00.000Z",
    aggregate: {
      manifestSha256: "a".repeat(64),
      reportSha256: "b".repeat(64),
      indexSha256: "c".repeat(64),
      source: repositoryIdentity("d"),
      harness: repositoryIdentity("e"),
    },
    impactTruthSet: artifactReference(
      "verification-impact-truth-set-report/v1",
      "candidate-evidence/verification/impact-truth-set-report.json",
      "f",
    ),
    structuredTestAudit: {
      verificationDag: artifactReference(
        "verification-dag/v1",
        "candidate-evidence/verification/structured-test-verification-dag.json",
        "1",
      ),
      nativeTestReport: {
        framework: "vitest",
        format: "vitest-json/v3.2.7",
        runnerVersion: "3.2.7",
        path: "candidate-evidence/verification/structured-test-vitest-report.json",
        sha256: "2".repeat(64),
      },
      testFiles: [
        "scripts/run-verification-impact-truth-set.test.mjs",
        "scripts/verification-test-report-adapter.test.mjs",
        "scripts/run-verification-dag.test.mjs",
        "scripts/verification-browser-report-adapter.test.mjs",
      ],
    },
    failureReplay: {
      fixtureId: "verification-dag-reproducible-failure-v1",
      nodeId: "verification.failure-replay",
      expectedClassification: "reproducible_failure",
      replayBinding: {
        environmentHash: "b".repeat(64),
        inputHash: "c".repeat(64),
      },
      initialFailureFingerprint: "d".repeat(64),
      verificationDag: artifactReference(
        "verification-dag/v1",
        "candidate-evidence/verification/failure-replay-verification-dag.json",
        "3",
      ),
    },
    browserRelay: {
      artifactSchemaVersion: "verification-browser-evidence/v1",
      runs: [
        browserRun("mobile", 375, 667, "4"),
        browserRun("tablet", 768, 1024, "7"),
        browserRun("desktop", 1440, 900, "a"),
      ],
    },
  };
}

function browserRun(runId, width, height, seed) {
  return {
    runId,
    viewport: { width, height, deviceScaleFactor: 1 },
    report: artifact(`${runId}-browser-report.json`, seed),
    evidence: artifact(`${runId}-browser-evidence.json`, nextSeed(seed, 1)),
    screenshot: artifact(`${runId}-browser-screenshot.png`, nextSeed(seed, 2)),
  };
}

function artifactReference(artifactSchemaVersion, artifactPath, seed) {
  return {
    artifactSchemaVersion,
    ...artifact(artifactPath, seed),
  };
}

function artifact(artifactPath, seed) {
  return { path: artifactPath, sha256: seed.repeat(64) };
}

function nextSeed(seed, increment) {
  return ((Number.parseInt(seed, 16) + increment) % 16).toString(16);
}

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}
