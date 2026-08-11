import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";

const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 1 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowedKeys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function normalizeWorkspaceRelativePath(value, label) {
  assert(
    typeof value === "string"
      && value.length > 0
      && value.length <= 1000
      && !value.includes("\\")
      && !path.posix.isAbsolute(value)
      && !path.win32.isAbsolute(value),
    `${label} must be a safe workspace-relative path.`,
  );
  assert(
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    `${label} must be a safe workspace-relative path.`,
  );
  return value;
}

function isWorkspaceChild(workspaceRoot, target) {
  const relative = path.relative(workspaceRoot, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function readBoundedWorkspaceFile(workspaceRoot, relativePath, label, maximumBytes) {
  const target = path.resolve(workspaceRoot, ...relativePath.split("/"));
  assert(isWorkspaceChild(workspaceRoot, target), `${label} must remain inside the workspace.`);
  let handle;
  try {
    handle = await fs.open(target, "r");
    const [realTarget, stat] = await Promise.all([fs.realpath(target), handle.stat()]);
    assert(isWorkspaceChild(workspaceRoot, realTarget), `${label} must remain inside the workspace.`);
    assert(stat.isFile(), `${label} must identify a regular file.`);
    assert(stat.size > 0 && stat.size <= maximumBytes, `${label} must be between 1 and ${maximumBytes} bytes.`);
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    assert(total > 0 && total <= maximumBytes, `${label} must be between 1 and ${maximumBytes} bytes.`);
    return buffer.subarray(0, total);
  } finally {
    await handle?.close();
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseJson(content, label) {
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

export async function loadVerificationBrowserArtifacts({
  browserArtifacts,
  expectedRevision,
  workspaceRoot,
} = {}) {
  assertExactKeys(browserArtifacts, ["reportPath", "screenshotPath", "evidencePath"], "browserArtifacts");
  const paths = {
    report: normalizeWorkspaceRelativePath(browserArtifacts.reportPath, "browserArtifacts.reportPath"),
    screenshot: normalizeWorkspaceRelativePath(browserArtifacts.screenshotPath, "browserArtifacts.screenshotPath"),
    evidence: normalizeWorkspaceRelativePath(browserArtifacts.evidencePath, "browserArtifacts.evidencePath"),
  };
  assert(new Set(Object.values(paths)).size === 3, "browserArtifacts paths must identify three distinct files.");
  assert(typeof workspaceRoot === "string" && path.isAbsolute(workspaceRoot), "workspaceRoot must be absolute.");
  const realWorkspaceRoot = await fs.realpath(workspaceRoot);
  const [reportBytes, screenshotContent, evidenceBytes] = await Promise.all([
    readBoundedWorkspaceFile(realWorkspaceRoot, paths.report, "browserArtifacts.reportPath", MAX_REPORT_BYTES),
    readBoundedWorkspaceFile(realWorkspaceRoot, paths.screenshot, "browserArtifacts.screenshotPath", MAX_SCREENSHOT_BYTES),
    readBoundedWorkspaceFile(realWorkspaceRoot, paths.evidence, "browserArtifacts.evidencePath", MAX_EVIDENCE_BYTES),
  ]);
  const reportContent = reportBytes.toString("utf8");
  const artifact = { path: paths.report, sha256: sha256(reportBytes) };
  const projected = projectVerificationBrowserReport({
    artifact,
    content: reportContent,
    screenshotContent,
    expectedRevision,
  });
  assert(projected.source.path === paths.report, "Browser report source path does not match browserArtifacts.reportPath.");
  assert(projected.screenshot.artifact.path === paths.screenshot, "Browser screenshot path does not match browserArtifacts.screenshotPath.");
  const producerEvidence = parseJson(evidenceBytes, "browserArtifacts.evidencePath");
  assert(
    isDeepStrictEqual(producerEvidence, projected),
    "Browser evidence does not match the projected Browser report.",
  );
  const status = projected.status === "incomplete" ? "not_run" : projected.status;
  return {
    status,
    message: `browser-artifact:${projected.reason}`,
    ...(status === "failed" ? { kind: "browser" } : {}),
    evidence: { path: paths.evidence, sha256: sha256(evidenceBytes) },
    browserReport: { artifact, content: reportContent, screenshotContent },
  };
}
