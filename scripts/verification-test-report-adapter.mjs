import crypto from "node:crypto";
import path from "node:path";

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_REPORT_ITEMS = 1_000_000;
const MAX_GO_EVENTS = 200_000;
const GO_ACTIONS = new Set(["start", "run", "pause", "cont", "pass", "bench", "fail", "output", "skip"]);
const GO_TERMINAL_COUNT_KEYS = { pass: "passed", fail: "failed", skip: "skipped" };
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowedKeys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function normalizeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 1000, `${label} must be a relative path.`);
  assert(!value.includes("\\") && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), `${label} must be a relative path.`);
  assert(value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."), `${label} must be a relative path.`);
  return value;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeCount(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0 && value <= MAX_REPORT_ITEMS, `${label} must be a bounded non-negative integer.`);
  return value;
}

function normalizeSafeText(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === "")) return "";
  assert(
    typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\r\n\0]/.test(value),
    `${label} must be bounded single-line text.`,
  );
  return value;
}

function normalizeInput(input) {
  assertExactKeys(input, ["framework", "format", "runnerVersion", "artifact", "content"], "testReport");
  assert(input.framework === "vitest" || input.framework === "go-test", "testReport.framework is unsupported.");
  assert(typeof input.content === "string", "testReport.content must be UTF-8 text.");
  const contentBytes = Buffer.byteLength(input.content, "utf8");
  assert(contentBytes > 0 && contentBytes <= MAX_REPORT_BYTES, `testReport.content must be between 1 and ${MAX_REPORT_BYTES} UTF-8 bytes.`);
  assertExactKeys(input.artifact, ["path", "sha256"], "testReport.artifact");
  const artifactPath = normalizeRelativePath(input.artifact.path, "testReport.artifact.path");
  assert(typeof input.artifact.sha256 === "string" && SHA256_PATTERN.test(input.artifact.sha256), "testReport.artifact.sha256 must be a SHA-256.");
  assert(sha256(input.content) === input.artifact.sha256, "testReport artifact SHA-256 does not match its content.");

  if (input.framework === "vitest") {
    assert(input.format === "vitest-json/v3.2.7" && input.runnerVersion === "3.2.7", "Only Vitest 3.2.7 JSON reports are supported.");
  } else {
    assert(input.format === "go-test-json/v1", "Go test reports must use go-test-json/v1.");
    assert(typeof input.runnerVersion === "string" && /^go1\.(?:2[0-9]|[3-9][0-9])(?:\.\d+)?$/.test(input.runnerVersion), "Go test runnerVersion must identify Go 1.20 or newer.");
  }

  return {
    framework: input.framework,
    format: input.format,
    runnerVersion: input.runnerVersion,
    artifact: { path: artifactPath, sha256: input.artifact.sha256 },
    content: input.content,
  };
}

function classifyCounts(groups, tests) {
  if (groups.failed > 0 || tests.failed > 0) {
    return { status: "failed", reason: "test_failures" };
  }
  if (tests.passed === 0) {
    return { status: "not_run", reason: "no_tests_executed" };
  }
  return { status: "passed", reason: "all_tests_passed" };
}

function projectVitest(input) {
  let report;
  try {
    report = JSON.parse(input.content);
  } catch {
    throw new Error("Vitest report must be valid JSON.");
  }
  assert(report && typeof report === "object" && !Array.isArray(report), "Vitest report must be an object.");
  const groups = {
    total: normalizeCount(report.numTotalTestSuites, "Vitest suite total"),
    passed: normalizeCount(report.numPassedTestSuites, "Vitest passed suites"),
    failed: normalizeCount(report.numFailedTestSuites, "Vitest failed suites"),
    skipped: normalizeCount(report.numPendingTestSuites, "Vitest pending suites"),
  };
  const tests = {
    total: normalizeCount(report.numTotalTests, "Vitest test total"),
    passed: normalizeCount(report.numPassedTests, "Vitest passed tests"),
    failed: normalizeCount(report.numFailedTests, "Vitest failed tests"),
    skipped: normalizeCount(report.numPendingTests, "Vitest pending tests"),
    todo: normalizeCount(report.numTodoTests, "Vitest todo tests"),
  };
  assert(groups.passed + groups.failed + groups.skipped === groups.total, "Vitest suite counts are inconsistent.");
  assert(tests.passed + tests.failed + tests.skipped + tests.todo === tests.total, "Vitest test counts are inconsistent.");
  assert(typeof report.success === "boolean", "Vitest success must be boolean.");
  assert(Array.isArray(report.testResults) && report.testResults.length <= MAX_REPORT_ITEMS, "Vitest testResults must be bounded.");

  const assertionCounts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const [resultIndex, result] of report.testResults.entries()) {
    assert(result && typeof result === "object" && !Array.isArray(result), `Vitest testResults[${resultIndex}] must be an object.`);
    assert(Array.isArray(result.assertionResults), `Vitest testResults[${resultIndex}].assertionResults must be an array.`);
    for (const [assertionIndex, assertion] of result.assertionResults.entries()) {
      const status = assertion?.status;
      if (status === "passed") assertionCounts.passed += 1;
      else if (status === "failed") assertionCounts.failed += 1;
      else if (status === "todo") assertionCounts.todo += 1;
      else if (status === "skipped" || status === "pending" || status === "disabled") assertionCounts.skipped += 1;
      else throw new Error(`Vitest assertion status is unsupported at ${resultIndex}:${assertionIndex}.`);
    }
  }
  assert(
    assertionCounts.passed === tests.passed
      && assertionCounts.failed === tests.failed
      && assertionCounts.skipped === tests.skipped
      && assertionCounts.todo === tests.todo,
    "Vitest assertion counts do not match the report summary.",
  );
  assert(!(report.success && (groups.failed > 0 || tests.failed > 0)), "Vitest success is inconsistent with failed counts.");

  let classification = classifyCounts(groups, tests);
  if (classification.status === "passed" && !report.success) {
    classification = { status: "not_run", reason: "runner_incomplete" };
  }
  return {
    ...classification,
    evidence: {
      framework: input.framework,
      format: input.format,
      runnerVersion: input.runnerVersion,
      artifact: input.artifact,
      status: classification.status === "not_run" ? "incomplete" : classification.status,
      reason: classification.reason,
      groupKind: "suite",
      groups,
      tests,
      failedBuilds: 0,
    },
  };
}

function projectGoTest(input) {
  const lines = input.content.split(/\r?\n/).filter((line) => line.length > 0);
  assert(lines.length > 0 && lines.length <= MAX_GO_EVENTS, `Go test report must contain at most ${MAX_GO_EVENTS} events.`);
  const packages = new Map();
  const runningTests = new Set();
  const terminalTests = new Map();
  let failedBuilds = 0;

  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Go test event ${index} must be valid JSON.`);
    }
    assert(event && typeof event === "object" && !Array.isArray(event), `Go test event ${index} must be an object.`);
    assert(GO_ACTIONS.has(event.Action), `Go test event ${index} has an unsupported Action.`);
    const packageName = normalizeSafeText(event.Package, `Go test event ${index}.Package`);
    const testName = normalizeSafeText(event.Test, `Go test event ${index}.Test`, { optional: true });
    if (event.Elapsed !== undefined) {
      assert(typeof event.Elapsed === "number" && Number.isFinite(event.Elapsed) && event.Elapsed >= 0, `Go test event ${index}.Elapsed is invalid.`);
    }

    let packageState = packages.get(packageName);
    if (event.Action === "start" && !testName) {
      assert(!packageState, `Go test package ${packageName} has duplicate start events.`);
      packageState = { terminal: null };
      packages.set(packageName, packageState);
      continue;
    }
    assert(packageState, `Go test package ${packageName} emitted an event before start.`);

    const testKey = testName ? `${packageName}\0${testName}` : "";
    if (event.Action === "run" && testName) runningTests.add(testKey);
    if ((event.Action === "pass" || event.Action === "fail" || event.Action === "skip") && testName) {
      assert(!terminalTests.has(testKey), `Go test ${testName} has duplicate terminal events.`);
      terminalTests.set(testKey, event.Action);
      runningTests.delete(testKey);
    }
    if ((event.Action === "pass" || event.Action === "fail" || event.Action === "skip") && !testName) {
      assert(packageState.terminal === null, `Go test package ${packageName} has duplicate terminal events.`);
      packageState.terminal = event.Action;
      if (event.FailedBuild !== undefined && event.FailedBuild !== "") {
        assert(event.Action === "fail", `Go test package ${packageName} has FailedBuild without failure.`);
        normalizeSafeText(event.FailedBuild, `Go test event ${index}.FailedBuild`);
        failedBuilds += 1;
      }
    }
  }

  assert(packages.size > 0, "Go test report must contain a package start event.");
  assert(runningTests.size === 0, "Go test report ended before every running test had a terminal event.");
  assert(Array.from(packages.values()).every((value) => value.terminal !== null), "Go test report ended before every package had a terminal event.");

  const groups = { total: packages.size, passed: 0, failed: 0, skipped: 0 };
  for (const state of packages.values()) groups[GO_TERMINAL_COUNT_KEYS[state.terminal]] += 1;
  const tests = { total: terminalTests.size, passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const terminal of terminalTests.values()) tests[GO_TERMINAL_COUNT_KEYS[terminal]] += 1;
  const classification = classifyCounts(groups, tests);
  return {
    ...classification,
    evidence: {
      framework: input.framework,
      format: input.format,
      runnerVersion: input.runnerVersion,
      artifact: input.artifact,
      status: classification.status === "not_run" ? "incomplete" : classification.status,
      reason: classification.reason,
      groupKind: "package",
      groups,
      tests,
      failedBuilds,
    },
  };
}

/** Converts a hash-bound native test report into a content-free verification projection. */
export function projectStructuredTestReport(value) {
  const input = normalizeInput(value);
  return input.framework === "vitest" ? projectVitest(input) : projectGoTest(input);
}
