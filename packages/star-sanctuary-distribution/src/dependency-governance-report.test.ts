import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
const normalizerPath = path.join(workspaceRoot, "scripts", "normalize-osv-report.mjs");

test("dependency audit report-only adapter records a clean OSV fixture as zero findings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-osv-clean-"));
  const outputPath = path.join(tempDir, "report.json");
  const inputPath = path.join(currentDir, "fixtures", "osv", "clean-report.json");

  try {
    const result = spawnSync(process.execPath, [
      normalizerPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--expect-status",
      "zero_findings",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      schemaVersion: "dependency-governance-report/v1",
      scanner: {
        name: "osv-scanner",
        version: "2.3.8",
      },
      status: "zero_findings",
      summary: {
        sources: 1,
        affectedPackages: 0,
        vulnerabilityGroups: 0,
      },
      findings: [],
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit report-only adapter preserves findings from a known vulnerable OSV fixture", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-osv-vulnerable-"));
  const outputPath = path.join(tempDir, "report.json");
  const inputPath = path.join(currentDir, "fixtures", "osv", "vulnerable-report.json");

  try {
    const result = spawnSync(process.execPath, [
      normalizerPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--expect-status",
      "findings_present",
      "--require-vulnerability",
      "GHSA-vh95-rmgr-6w4m",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      status: "findings_present",
      summary: {
        sources: 1,
        affectedPackages: 1,
        vulnerabilityGroups: 2,
      },
      findings: [
        {
          package: {
            ecosystem: "npm",
            name: "minimist",
            version: "0.0.8",
          },
          vulnerabilityIds: expect.arrayContaining([
            "GHSA-vh95-rmgr-6w4m",
            "GHSA-xvch-5gv4-984h",
          ]),
        },
      ],
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit report-only adapter does not require a predetermined repository status", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-osv-report-only-"));
  const outputPath = path.join(tempDir, "report.json");
  const inputPath = path.join(currentDir, "fixtures", "osv", "clean-report.json");

  try {
    const result = spawnSync(process.execPath, [
      normalizerPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      status: "zero_findings",
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit adapter records missing scanner output as scan failed when requested", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-osv-scan-failed-"));
  const outputPath = path.join(tempDir, "report.json");
  const missingInputPath = path.join(tempDir, "missing.raw.json");

  try {
    const result = spawnSync(process.execPath, [
      normalizerPath,
      "--input",
      missingInputPath,
      "--output",
      outputPath,
      "--record-failure",
      "true",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      schemaVersion: "dependency-governance-report/v1",
      status: "scan_failed",
      summary: {
        sources: 0,
        affectedPackages: 0,
        vulnerabilityGroups: 0,
      },
      findings: [],
      failure: {
        code: "scanner_output_unavailable",
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit adapter records malformed scanner JSON shape as scan failed", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-osv-scan-malformed-"));
  const inputPath = path.join(tempDir, "malformed.raw.json");
  const outputPath = path.join(tempDir, "report.json");
  fs.writeFileSync(inputPath, JSON.stringify({ message: "upstream unavailable" }));

  try {
    const result = spawnSync(process.execPath, [
      normalizerPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--record-failure",
      "true",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      status: "scan_failed",
      failure: {
        code: "scanner_output_unavailable",
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
