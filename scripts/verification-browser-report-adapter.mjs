import crypto from "node:crypto";

export const VERIFICATION_BROWSER_EVIDENCE_VERSION = "verification-browser-evidence/v1";
const SOURCE_SCHEMA_VERSION = "browser-relay-verification/v1";
const RUNNER_CONTRACT_VERSION = "browser-relay/v1";
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowedKeys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 1000, `${label} must be a safe relative path.`);
  assert(!value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:\//.test(value), `${label} must be a safe relative path.`);
  assert(value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."), `${label} must be a safe relative path.`);
  return value;
}

function normalizeRoute(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 1000, `${label} must be a bounded route.`);
  assert(value.startsWith("/") && !value.startsWith("//") && !/[?#\\\r\n\0]/.test(value), `${label} must contain only a local path.`);
  return value;
}

function normalizeSha256(value, label) {
  assert(typeof value === "string" && SHA256_PATTERN.test(value), `${label} must be a SHA-256.`);
  return value;
}

function normalizeNonNegativeInteger(value, label) {
  assert(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer.`);
  return value;
}

function normalizePositiveInteger(value, label, maximum) {
  assert(Number.isSafeInteger(value) && value >= 1 && value <= maximum, `${label} must be between 1 and ${maximum}.`);
  return value;
}

function normalizeArtifact(value, label) {
  assertExactKeys(value, ["path", "sha256"], label);
  return {
    path: normalizeRelativePath(value.path, `${label}.path`),
    sha256: normalizeSha256(value.sha256, `${label}.sha256`),
  };
}

function normalizeRevision(value, label) {
  assertExactKeys(value, ["commit", "workspaceHash"], label);
  assert(typeof value.commit === "string" && /^[0-9a-f]{7,64}$/.test(value.commit), `${label}.commit must identify a source revision.`);
  return { commit: value.commit, workspaceHash: normalizeSha256(value.workspaceHash, `${label}.workspaceHash`) };
}

function normalizeAssertions(value, label) {
  assertExactKeys(value, ["total", "failed"], label);
  const total = normalizePositiveInteger(value.total, `${label}.total`, 10_000);
  const failed = normalizeNonNegativeInteger(value.failed, `${label}.failed`);
  assert(failed <= total, `${label}.failed cannot exceed total.`);
  return { total, failed };
}

export function projectVerificationBrowserReport({
  artifact,
  content,
  screenshotContent,
  expectedRevision,
} = {}) {
  const source = normalizeArtifact(artifact, "artifact");
  assert(typeof content === "string" && Buffer.byteLength(content, "utf8") > 0 && Buffer.byteLength(content, "utf8") <= MAX_REPORT_BYTES, `Browser report must be between 1 and ${MAX_REPORT_BYTES} bytes.`);
  assert(sha256(Buffer.from(content, "utf8")) === source.sha256, "Browser report artifact hash does not match its content.");
  let report;
  try {
    report = JSON.parse(content);
  } catch {
    throw new Error("Browser report must be valid JSON.");
  }
  assertExactKeys(report, ["schemaVersion", "runnerVersion", "revision", "observedAt", "route", "viewport", "page", "dom", "console", "requests", "screenshot", "lifecycle"], "browserReport");
  assert(report.schemaVersion === SOURCE_SCHEMA_VERSION && report.runnerVersion === RUNNER_CONTRACT_VERSION, "Browser report runner identity is unsupported.");
  const revision = normalizeRevision(report.revision, "browserReport.revision");
  const normalizedExpectedRevision = normalizeRevision(expectedRevision, "expectedRevision");
  assert(revision.commit === normalizedExpectedRevision.commit && revision.workspaceHash === normalizedExpectedRevision.workspaceHash, "Browser report revision does not match the verification revision.");
  assert(typeof report.observedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(report.observedAt) && !Number.isNaN(Date.parse(report.observedAt)), "browserReport.observedAt must be an ISO UTC timestamp.");
  const route = normalizeRoute(report.route, "browserReport.route");
  assertExactKeys(report.viewport, ["width", "height", "deviceScaleFactor"], "browserReport.viewport");
  const viewport = {
    width: normalizePositiveInteger(report.viewport.width, "browserReport.viewport.width", 4096),
    height: normalizePositiveInteger(report.viewport.height, "browserReport.viewport.height", 4096),
    deviceScaleFactor: report.viewport.deviceScaleFactor,
  };
  assert(viewport.width >= 320 && viewport.height >= 240, "browserReport.viewport is below the supported minimum.");
  assert(typeof viewport.deviceScaleFactor === "number" && Number.isFinite(viewport.deviceScaleFactor) && viewport.deviceScaleFactor >= 1 && viewport.deviceScaleFactor <= 4, "browserReport.viewport.deviceScaleFactor is unsupported.");
  assertExactKeys(report.page, ["loaded", "finalRoute"], "browserReport.page");
  assert(typeof report.page.loaded === "boolean", "browserReport.page.loaded must be boolean.");
  const page = { loaded: report.page.loaded, finalRoute: normalizeRoute(report.page.finalRoute, "browserReport.page.finalRoute") };
  assertExactKeys(report.dom, ["changed", "beforeSha256", "afterSha256", "assertions"], "browserReport.dom");
  assert(typeof report.dom.changed === "boolean", "browserReport.dom.changed must be boolean.");
  const dom = {
    changed: report.dom.changed,
    beforeSha256: normalizeSha256(report.dom.beforeSha256, "browserReport.dom.beforeSha256"),
    afterSha256: normalizeSha256(report.dom.afterSha256, "browserReport.dom.afterSha256"),
    assertions: normalizeAssertions(report.dom.assertions, "browserReport.dom.assertions"),
  };
  assert(dom.changed === (dom.beforeSha256 !== dom.afterSha256), "browserReport.dom.changed is inconsistent with its hashes.");
  assertExactKeys(report.console, ["errorCount", "warningCount"], "browserReport.console");
  const consoleSummary = {
    errorCount: normalizeNonNegativeInteger(report.console.errorCount, "browserReport.console.errorCount"),
    warningCount: normalizeNonNegativeInteger(report.console.warningCount, "browserReport.console.warningCount"),
  };
  const requests = normalizeRequests(report.requests);
  const screenshot = normalizeScreenshot(report.screenshot, screenshotContent);
  const lifecycle = normalizeLifecycle(report.lifecycle);
  const outcome = classifyBrowserReport({ page, dom, consoleSummary, requests, lifecycle });
  return {
    schemaVersion: VERIFICATION_BROWSER_EVIDENCE_VERSION,
    runner: { id: "browser-relay", contractVersion: RUNNER_CONTRACT_VERSION },
    source,
    revision,
    observedAt: report.observedAt,
    route,
    viewport,
    status: outcome.status,
    reason: outcome.reason,
    page,
    dom,
    console: consoleSummary,
    requests,
    screenshot,
    lifecycle,
  };
}

function normalizeRequests(value) {
  assertExactKeys(value, ["observedCount", "failedCount", "blockedExternalCount", "assertions", "outcomes"], "browserReport.requests");
  const observedCount = normalizeNonNegativeInteger(value.observedCount, "browserReport.requests.observedCount");
  const failedCount = normalizeNonNegativeInteger(value.failedCount, "browserReport.requests.failedCount");
  const blockedExternalCount = normalizeNonNegativeInteger(value.blockedExternalCount, "browserReport.requests.blockedExternalCount");
  assert(failedCount <= observedCount, "browserReport.requests.failedCount cannot exceed observedCount.");
  const assertions = normalizeAssertions(value.assertions, "browserReport.requests.assertions");
  assert(Array.isArray(value.outcomes) && value.outcomes.length > 0 && value.outcomes.length <= 50, "browserReport.requests.outcomes must contain 1-50 entries.");
  const outcomeKeys = new Set();
  let outcomeCount = 0;
  const outcomes = value.outcomes.map((entry, index) => {
    const label = `browserReport.requests.outcomes[${index}]`;
    assertExactKeys(entry, ["method", "route", "status", "count"], label);
    assert(HTTP_METHODS.has(entry.method), `${label}.method is unsupported.`);
    const route = normalizeRoute(entry.route, `${label}.route`);
    const status = normalizePositiveInteger(entry.status, `${label}.status`, 599);
    assert(status >= 100, `${label}.status must be an HTTP status.`);
    const count = normalizePositiveInteger(entry.count, `${label}.count`, 10_000);
    const key = `${entry.method}\0${route}\0${status}`;
    assert(!outcomeKeys.has(key), `${label} duplicates a request outcome.`);
    outcomeKeys.add(key);
    outcomeCount += count;
    return { method: entry.method, route, status, count };
  });
  assert(outcomeCount <= observedCount, "browserReport.requests outcomes exceed observedCount.");
  return { observedCount, failedCount, blockedExternalCount, assertions, outcomes };
}

function normalizeScreenshot(value, screenshotContent) {
  assertExactKeys(value, ["artifact", "bytes", "width", "height"], "browserReport.screenshot");
  const artifact = normalizeArtifact(value.artifact, "browserReport.screenshot.artifact");
  assert(Buffer.isBuffer(screenshotContent) || screenshotContent instanceof Uint8Array, "Browser screenshot content must be bytes.");
  const bytes = Buffer.from(screenshotContent);
  assert(bytes.length > 0 && bytes.length <= MAX_SCREENSHOT_BYTES, `Browser screenshot must be between 1 and ${MAX_SCREENSHOT_BYTES} bytes.`);
  assert(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), "Browser screenshot must be a PNG.");
  assert(normalizePositiveInteger(value.bytes, "browserReport.screenshot.bytes", MAX_SCREENSHOT_BYTES) === bytes.length, "Browser screenshot byte count drifted.");
  assert(sha256(bytes) === artifact.sha256, "Browser screenshot artifact hash does not match its content.");
  return {
    artifact,
    bytes: bytes.length,
    width: normalizePositiveInteger(value.width, "browserReport.screenshot.width", 16_384),
    height: normalizePositiveInteger(value.height, "browserReport.screenshot.height", 16_384),
  };
}

function normalizeLifecycle(value) {
  assertExactKeys(value, ["status", "pageClosed", "browserClosed", "pendingRequestCount", "orphanResourceCount"], "browserReport.lifecycle");
  assert(value.status === "settled" || value.status === "incomplete", "browserReport.lifecycle.status is unsupported.");
  assert(typeof value.pageClosed === "boolean" && typeof value.browserClosed === "boolean", "browserReport.lifecycle close states must be boolean.");
  const lifecycle = {
    status: value.status,
    pageClosed: value.pageClosed,
    browserClosed: value.browserClosed,
    pendingRequestCount: normalizeNonNegativeInteger(value.pendingRequestCount, "browserReport.lifecycle.pendingRequestCount"),
    orphanResourceCount: normalizeNonNegativeInteger(value.orphanResourceCount, "browserReport.lifecycle.orphanResourceCount"),
  };
  const settled = lifecycle.pageClosed && lifecycle.browserClosed && lifecycle.pendingRequestCount === 0 && lifecycle.orphanResourceCount === 0;
  assert((lifecycle.status === "settled") === settled, "browserReport.lifecycle.status is inconsistent with resource state.");
  return lifecycle;
}

function classifyBrowserReport({ page, dom, consoleSummary, requests, lifecycle }) {
  if (lifecycle.status !== "settled") return { status: "incomplete", reason: "lifecycle_incomplete" };
  if (!page.loaded) return { status: "failed", reason: "page_load_failed" };
  if (!dom.changed || dom.assertions.failed > 0) return { status: "failed", reason: "dom_assertion_failed" };
  if (consoleSummary.errorCount > 0) return { status: "failed", reason: "console_error" };
  if (requests.failedCount > 0 || requests.blockedExternalCount > 0 || requests.assertions.failed > 0) {
    return { status: "failed", reason: "request_failure" };
  }
  return { status: "passed", reason: "all_checks_passed" };
}
