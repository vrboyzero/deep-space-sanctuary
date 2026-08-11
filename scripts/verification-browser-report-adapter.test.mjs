import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(workspaceRoot, "benchmarks/verification/v1/browser-evidence.schema.json");
const screenshotContent = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const revision = {
  commit: "b32004a8ae6eeed9fa29b8c837bbc95fdee3566e",
  workspaceHash: sha256("workspace"),
};

describe("verification browser report adapter", () => {
  it("projects a Schema-valid passed report without retaining DOM, console, request, or screenshot content", async () => {
    const input = passingInput();
    const evidence = projectVerificationBrowserReport(input);
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.validator.validateOutput(JSON.stringify(evidence))).toMatchObject({ ok: true });
    expect(evidence).toMatchObject({
      status: "passed",
      reason: "all_checks_passed",
      route: "/fixture.html",
      viewport: { width: 960, height: 640, deviceScaleFactor: 1 },
      dom: { changed: true, assertions: { total: 2, failed: 0 } },
      console: { errorCount: 0, warningCount: 1 },
      requests: {
        observedCount: 1,
        outcomes: [{ method: "POST", route: "/probe", status: 200, count: 1 }],
      },
      screenshot: { bytes: screenshotContent.length, width: 1, height: 1 },
      lifecycle: { status: "settled", pageClosed: true, browserClosed: true },
    });
    expect(JSON.stringify(evidence)).not.toContain("console message");
    expect(JSON.stringify(evidence)).not.toContain("data-state");
    expect(JSON.stringify(evidence)).not.toContain(screenshotContent.toString("base64"));
  });

  it("classifies page, console, DOM, and request failures from bounded fields", () => {
    const pageFailure = sourceReport({ page: { loaded: false, finalRoute: "/fixture.html" } });
    expect(projectVerificationBrowserReport(wrapReport(pageFailure))).toMatchObject({ status: "failed", reason: "page_load_failed" });

    const consoleFailure = sourceReport({ console: { errorCount: 1, warningCount: 0 } });
    expect(projectVerificationBrowserReport(wrapReport(consoleFailure))).toMatchObject({ status: "failed", reason: "console_error" });

    const domFailure = sourceReport({ dom: { ...sourceReport().dom, assertions: { total: 2, failed: 1 } } });
    expect(projectVerificationBrowserReport(wrapReport(domFailure))).toMatchObject({ status: "failed", reason: "dom_assertion_failed" });

    const requestFailure = sourceReport({ requests: { ...sourceReport().requests, failedCount: 1, assertions: { total: 1, failed: 1 } } });
    expect(projectVerificationBrowserReport(wrapReport(requestFailure))).toMatchObject({ status: "failed", reason: "request_failure" });
  });

  it("keeps an unsettled Browser Relay lifecycle incomplete", () => {
    const report = sourceReport({
      lifecycle: { status: "incomplete", pageClosed: true, browserClosed: false, pendingRequestCount: 1, orphanResourceCount: 0 },
    });

    expect(projectVerificationBrowserReport(wrapReport(report))).toMatchObject({
      status: "incomplete",
      reason: "lifecycle_incomplete",
      lifecycle: { browserClosed: false, pendingRequestCount: 1 },
    });
  });

  it("rejects report, screenshot, revision, and contract drift", () => {
    const input = passingInput();
    expect(() => projectVerificationBrowserReport({ ...input, content: `${input.content} ` })).toThrow(/report artifact hash/u);
    expect(() => projectVerificationBrowserReport({ ...input, screenshotContent: Buffer.from("not-png") })).toThrow(/PNG/u);
    expect(() => projectVerificationBrowserReport({ ...input, expectedRevision: { ...revision, commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } })).toThrow(/revision does not match/u);
    const report = sourceReport();
    report.console.message = "must not enter the contract";
    expect(() => projectVerificationBrowserReport(wrapReport(report))).toThrow(/unsupported fields/u);
  });
});

function passingInput() {
  return wrapReport(sourceReport());
}

function sourceReport(overrides = {}) {
  const beforeSha256 = sha256("<div data-state=idle>");
  const afterSha256 = sha256("<div data-state=verified>");
  return {
    schemaVersion: "browser-relay-verification/v1",
    runnerVersion: "browser-relay/v1",
    revision,
    observedAt: "2026-08-11T12:00:00.000Z",
    route: "/fixture.html",
    viewport: { width: 960, height: 640, deviceScaleFactor: 1 },
    page: { loaded: true, finalRoute: "/fixture.html" },
    dom: { changed: true, beforeSha256, afterSha256, assertions: { total: 2, failed: 0 } },
    console: { errorCount: 0, warningCount: 1 },
    requests: {
      observedCount: 1,
      failedCount: 0,
      blockedExternalCount: 0,
      assertions: { total: 1, failed: 0 },
      outcomes: [{ method: "POST", route: "/probe", status: 200, count: 1 }],
    },
    screenshot: {
      artifact: { path: "artifacts/verification/browser-screenshot.png", sha256: sha256(screenshotContent) },
      bytes: screenshotContent.length,
      width: 1,
      height: 1,
    },
    lifecycle: { status: "settled", pageClosed: true, browserClosed: true, pendingRequestCount: 0, orphanResourceCount: 0 },
    ...overrides,
  };
}

function wrapReport(report) {
  const content = JSON.stringify(report);
  return {
    artifact: { path: "artifacts/verification/browser-report.json", sha256: sha256(content) },
    content,
    screenshotContent,
    expectedRevision: revision,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
