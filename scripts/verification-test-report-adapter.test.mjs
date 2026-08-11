import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { projectStructuredTestReport } from "./verification-test-report-adapter.mjs";

const execFile = promisify(execFileCallback);
const workspaceRoot = path.resolve(import.meta.dirname, "..");
const vitestPath = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");

function hash(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function input(framework, content, overrides = {}) {
  return {
    framework,
    format: framework === "vitest" ? "vitest-json/v3.2.7" : "go-test-json/v1",
    runnerVersion: framework === "vitest" ? "3.2.7" : "go1.26.5",
    artifact: {
      path: framework === "vitest" ? "artifacts/vitest-report.json" : "artifacts/go-test-report.jsonl",
      sha256: hash(content),
    },
    content,
    ...overrides,
  };
}

describe("structured verification test report adapter", () => {
  it("projects an actual Vitest 3.2.7 JSON report without retaining test names or messages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "verification-vitest-native-"));
    const testPath = path.join(root, "native.test.js");
    const reportPath = path.join(root, "report.json");
    try {
      await fs.writeFile(testPath, [
        "test('native secret title', () => expect(1 + 1).toBe(2));",
        "test.skip('skipped secret title', () => {});",
        "test.todo('todo secret title');",
      ].join("\n"), "utf8");
      await execFile(process.execPath, [
        vitestPath,
        "run",
        testPath,
        "--root",
        root,
        "--globals",
        "--reporter=json",
        `--outputFile=${reportPath}`,
      ], { cwd: workspaceRoot });
      const content = await fs.readFile(reportPath, "utf8");

      const projection = projectStructuredTestReport(input("vitest", content));

      expect(projection).toMatchObject({
        status: "passed",
        reason: "all_tests_passed",
        evidence: {
          framework: "vitest",
          format: "vitest-json/v3.2.7",
          runnerVersion: "3.2.7",
          groupKind: "suite",
          groups: { total: 1, passed: 1, failed: 0, skipped: 0 },
          tests: { total: 3, passed: 1, failed: 0, skipped: 1, todo: 1 },
          failedBuilds: 0,
        },
      });
      expect(JSON.stringify(projection)).not.toContain("secret title");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("projects Vitest failures from counters while dropping failureMessages and file paths", () => {
    const content = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTestSuites: 0,
      numFailedTestSuites: 1,
      numPendingTestSuites: 0,
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      startTime: 1,
      success: false,
      snapshot: {},
      testResults: [{
        name: "C:/private/workspace/secret.test.ts",
        status: "failed",
        message: "private failure body",
        assertionResults: [{
          status: "failed",
          title: "private test title",
          failureMessages: ["credential-shaped private failure"],
        }],
      }],
    });

    const projection = projectStructuredTestReport(input("vitest", content));

    expect(projection).toMatchObject({
      status: "failed",
      reason: "test_failures",
      evidence: { tests: { total: 1, passed: 0, failed: 1, skipped: 0, todo: 0 } },
    });
    expect(JSON.stringify(projection)).not.toMatch(/private|credential-shaped|workspace/i);
  });

  it("projects interleaved Go test2json package and test terminal events without retaining Output", () => {
    const content = [
      { Time: "2026-08-11T00:00:00Z", Action: "start", Package: "example/a" },
      { Time: "2026-08-11T00:00:00Z", Action: "start", Package: "example/b" },
      { Time: "2026-08-11T00:00:01Z", Action: "run", Package: "example/a", Test: "TestAlpha" },
      { Time: "2026-08-11T00:00:01Z", Action: "output", Package: "example/a", Test: "TestAlpha", Output: "private output body\n" },
      { Time: "2026-08-11T00:00:02Z", Action: "pass", Package: "example/a", Test: "TestAlpha", Elapsed: 0.1 },
      { Time: "2026-08-11T00:00:02Z", Action: "skip", Package: "example/b", Test: "TestBeta", Elapsed: 0 },
      { Time: "2026-08-11T00:00:03Z", Action: "pass", Package: "example/a", Elapsed: 0.2 },
      { Time: "2026-08-11T00:00:03Z", Action: "pass", Package: "example/b", Elapsed: 0.2 },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";

    const projection = projectStructuredTestReport(input("go-test", content));

    expect(projection).toMatchObject({
      status: "passed",
      reason: "all_tests_passed",
      evidence: {
        framework: "go-test",
        format: "go-test-json/v1",
        runnerVersion: "go1.26.5",
        groupKind: "package",
        groups: { total: 2, passed: 2, failed: 0, skipped: 0 },
        tests: { total: 2, passed: 1, failed: 0, skipped: 1, todo: 0 },
        failedBuilds: 0,
      },
    });
    expect(JSON.stringify(projection)).not.toContain("private output body");
    expect(JSON.stringify(projection)).not.toContain("example/a");
  });

  it("classifies a Go failed build without parsing its compiler output", () => {
    const content = [
      { Action: "start", Package: "example/broken" },
      { Action: "output", Package: "example/broken", Output: "private compiler diagnostic\n" },
      { Action: "fail", Package: "example/broken", Elapsed: 0.01, FailedBuild: "example/dependency" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";

    const projection = projectStructuredTestReport(input("go-test", content));

    expect(projection).toMatchObject({
      status: "failed",
      reason: "test_failures",
      evidence: {
        groups: { total: 1, passed: 0, failed: 1, skipped: 0 },
        tests: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
        failedBuilds: 1,
      },
    });
    expect(JSON.stringify(projection)).not.toContain("private compiler diagnostic");
  });

  it("marks reports with no executed tests incomplete instead of completed", () => {
    const content = [
      { Action: "start", Package: "example/empty" },
      { Action: "skip", Package: "example/empty", Elapsed: 0 },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";

    expect(projectStructuredTestReport(input("go-test", content))).toMatchObject({
      status: "not_run",
      reason: "no_tests_executed",
    });
  });

  it("rejects hash drift, unsupported runners, inconsistent Vitest counts, and truncated Go streams", () => {
    const vitestContent = JSON.stringify({
      numTotalTestSuites: 1,
      numPassedTestSuites: 1,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [{ assertionResults: [{ status: "failed" }] }],
    });
    expect(() => projectStructuredTestReport(input("vitest", vitestContent))).toThrow(/count/i);
    expect(() => projectStructuredTestReport(input("vitest", vitestContent, {
      artifact: { path: "artifacts/report.json", sha256: "0".repeat(64) },
    }))).toThrow(/SHA-256.*content/i);
    expect(() => projectStructuredTestReport(input("vitest", vitestContent, {
      runnerVersion: "3.3.0",
    }))).toThrow(/Vitest 3\.2\.7/i);

    const truncatedGo = [
      { Action: "start", Package: "example/truncated" },
      { Action: "run", Package: "example/truncated", Test: "TestPending" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";
    expect(() => projectStructuredTestReport(input("go-test", truncatedGo))).toThrow(/terminal event/i);
  });
});
