import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
const evaluatorPath = path.join(workspaceRoot, "scripts", "evaluate-dependency-audit-gate.mjs");

test("dependency audit gate allows a fresh zero-findings report", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-dependency-gate-clean-"));
  const inputPath = path.join(tempDir, "report.json");
  const outputPath = path.join(tempDir, "decision.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: "dependency-governance-report/v1",
    scanner: { name: "osv-scanner", version: "2.3.8" },
    generatedAt: "2026-07-15T00:00:00.000Z",
    status: "zero_findings",
    summary: { sources: 1, affectedPackages: 0, vulnerabilityGroups: 0 },
    findings: [],
  }));

  try {
    const result = spawnSync(process.execPath, [
      evaluatorPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--now",
      "2026-07-15T01:00:00.000Z",
      "--max-age-hours",
      "24",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      schemaVersion: "dependency-governance-gate/v1",
      status: "zero_findings",
      allowed: true,
      reportStatus: "zero_findings",
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit gate blocks findings while preserving a machine-readable decision", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-dependency-gate-findings-"));
  const inputPath = path.join(tempDir, "report.json");
  const outputPath = path.join(tempDir, "decision.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: "dependency-governance-report/v1",
    scanner: { name: "osv-scanner", version: "2.3.8" },
    generatedAt: "2026-07-15T00:00:00.000Z",
    status: "findings_present",
    summary: { sources: 1, affectedPackages: 1, vulnerabilityGroups: 2 },
    findings: [{
      package: { ecosystem: "npm", name: "minimist", version: "0.0.8" },
      vulnerabilityIds: ["GHSA-vh95-rmgr-6w4m"],
    }],
  }));

  try {
    const result = spawnSync(process.execPath, [
      evaluatorPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--now",
      "2026-07-15T01:00:00.000Z",
      "--max-age-hours",
      "24",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      status: "findings_present",
      allowed: false,
      reportStatus: "findings_present",
      summary: {
        affectedPackages: 1,
        vulnerabilityGroups: 2,
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit gate blocks scanner failures as an explicit unknown state", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-dependency-gate-failed-"));
  const inputPath = path.join(tempDir, "report.json");
  const outputPath = path.join(tempDir, "decision.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: "dependency-governance-report/v1",
    scanner: { name: "osv-scanner", version: "2.3.8" },
    generatedAt: "2026-07-15T00:00:00.000Z",
    status: "scan_failed",
    summary: { sources: 0, affectedPackages: 0, vulnerabilityGroups: 0 },
    findings: [],
    failure: { code: "scanner_output_unavailable" },
  }));

  try {
    const result = spawnSync(process.execPath, [
      evaluatorPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--now",
      "2026-07-15T01:00:00.000Z",
      "--max-age-hours",
      "24",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      status: "scan_failed",
      allowed: false,
      reportStatus: "scan_failed",
      failure: {
        code: "scanner_output_unavailable",
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dependency audit gate blocks stale reports even when they contain zero findings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-dependency-gate-stale-"));
  const inputPath = path.join(tempDir, "report.json");
  const outputPath = path.join(tempDir, "decision.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    schemaVersion: "dependency-governance-report/v1",
    scanner: { name: "osv-scanner", version: "2.3.8" },
    generatedAt: "2026-07-13T00:00:00.000Z",
    status: "zero_findings",
    summary: { sources: 1, affectedPackages: 0, vulnerabilityGroups: 0 },
    findings: [],
  }));

  try {
    const result = spawnSync(process.execPath, [
      evaluatorPath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--now",
      "2026-07-15T01:00:00.000Z",
      "--max-age-hours",
      "24",
    ], {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      status: "stale",
      allowed: false,
      reportStatus: "zero_findings",
      ageHours: 49,
      maxAgeHours: 24,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
