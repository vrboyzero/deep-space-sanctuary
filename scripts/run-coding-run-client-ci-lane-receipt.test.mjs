import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const execFile = promisify(execFileCallback);
const workspaceRoot = path.resolve(import.meta.dirname, "..");
const producerPath = path.join(
  workspaceRoot,
  "scripts",
  "run-coding-run-client-ci-lane-receipt.mjs",
);
const schemaPath = path.join(
  workspaceRoot,
  "benchmarks",
  "coding-agent",
  "v3",
  "coding-run-client-ci-lane-evidence.schema.json",
);
const testFiles = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);

describe("coding-run client CI lane receipt producer", () => {
  it("writes a schema-valid success receipt bound to GitHub Actions and the native report", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-run-client-ci-lane-"));
    try {
      const reportPath = path.join(fixtureRoot, "vitest-report.json");
      const outputPath = path.join(fixtureRoot, "lane-receipt.json");
      const reportText = serializeJson(createVitestReport("passed"));
      await fs.writeFile(reportPath, reportText, "utf-8");

      await runProducer({
        reportPath,
        outputPath,
        platform: "ubuntu-latest",
        testOutcome: "success",
        runnerOs: "Linux",
      });

      const outputText = await fs.readFile(outputPath, "utf-8");
      const receipt = JSON.parse(outputText);
      const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
      const compiled = compileOutputSchema(schema);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.validator.validateOutput(outputText)).toMatchObject({ ok: true });
      expect(receipt).toMatchObject({
        schemaVersion: "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1",
        command: "corepack pnpm verify:coding-run-client",
        github: {
          repositoryId: 1_182_285_910,
          repository: "vrboyzero/deep-space-sanctuary",
          workflow: "Quality Gates",
          workflowRef:
            "vrboyzero/deep-space-sanctuary/.github/workflows/quality-gates.yml@refs/heads/main",
          job: "coding-ci-contract",
          runId: 33_415_964_382,
          runAttempt: 1,
          sha: "e".repeat(40),
          ref: "refs/heads/main",
        },
        runner: { platform: "ubuntu-latest", os: "Linux", arch: "X64" },
        report: {
          status: "passed",
          path: "vitest-report.json",
          sha256: sha256(reportText),
          testFiles: [...testFiles],
        },
      });
      expect(Date.parse(receipt.generatedAt)).not.toBeNaN();
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("writes a failed receipt when the native report and GitHub step outcome both fail", async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-run-client-ci-lane-"));
    try {
      const reportPath = path.join(fixtureRoot, "vitest-report.json");
      const outputPath = path.join(fixtureRoot, "lane-receipt.json");
      await fs.writeFile(reportPath, serializeJson(createVitestReport("failed")), "utf-8");

      await runProducer({
        reportPath,
        outputPath,
        platform: "windows-latest",
        testOutcome: "failure",
        runnerOs: "Windows",
      });

      expect(JSON.parse(await fs.readFile(outputPath, "utf-8"))).toMatchObject({
        runner: { platform: "windows-latest", os: "Windows", arch: "X64" },
        report: { status: "failed" },
      });
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects outcome or test-selection drift without leaving a receipt", async () => {
    for (const drift of ["outcome", "selection"]) {
      const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "coding-run-client-ci-lane-"));
      try {
        const reportPath = path.join(fixtureRoot, "vitest-report.json");
        const outputPath = path.join(fixtureRoot, "lane-receipt.json");
        const report = createVitestReport("passed");
        if (drift === "selection") {
          report.testResults[0].name = path.join(workspaceRoot, "scripts", "unrelated.test.mjs");
        }
        await fs.writeFile(reportPath, serializeJson(report), "utf-8");

        await expect(runProducer({
          reportPath,
          outputPath,
          platform: "ubuntu-latest",
          testOutcome: drift === "outcome" ? "failure" : "success",
          runnerOs: "Linux",
        }), drift).rejects.toThrow(
          drift === "outcome" ? /outcome.*report drifted/i : /test selection drifted/i,
        );
        await expect(fs.stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(fixtureRoot, { recursive: true, force: true });
      }
    }
  });
});

async function runProducer(input) {
  return await execFile(process.execPath, [
    "--import",
    "tsx",
    producerPath,
    "--report",
    input.reportPath,
    "--output",
    input.outputPath,
    "--platform",
    input.platform,
    "--test-outcome",
    input.testOutcome,
  ], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY_ID: "1182285910",
      GITHUB_REPOSITORY: "vrboyzero/deep-space-sanctuary",
      GITHUB_WORKFLOW: "Quality Gates",
      GITHUB_WORKFLOW_REF:
        "vrboyzero/deep-space-sanctuary/.github/workflows/quality-gates.yml@refs/heads/main",
      GITHUB_JOB: "coding-ci-contract",
      GITHUB_RUN_ID: "33415964382",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: "e".repeat(40),
      GITHUB_REF: "refs/heads/main",
      RUNNER_OS: input.runnerOs,
      RUNNER_ARCH: "X64",
    },
  });
}

function createVitestReport(status) {
  const results = testFiles.map((relativePath, index) => {
    const testStatus = status === "failed" && index === 0 ? "failed" : "passed";
    return {
      name: path.join(workspaceRoot, ...relativePath.split("/")),
      status: testStatus,
      message: testStatus === "failed" ? "deterministic CI fixture failure" : "",
      assertionResults: [{
        ancestorTitles: [],
        fullName: `coding-run client CI ${index}`,
        status: testStatus,
        title: `coding-run client CI ${index}`,
        duration: 1,
        failureMessages: testStatus === "failed"
          ? ["deterministic CI fixture failure"]
          : [],
      }],
    };
  });
  const failedCount = status === "failed" ? 1 : 0;
  const passedCount = results.length - failedCount;
  return {
    numTotalTestSuites: results.length,
    numPassedTestSuites: passedCount,
    numFailedTestSuites: failedCount,
    numPendingTestSuites: 0,
    numTotalTests: results.length,
    numPassedTests: passedCount,
    numFailedTests: failedCount,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1,
    success: status === "passed",
    testResults: results,
  };
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
