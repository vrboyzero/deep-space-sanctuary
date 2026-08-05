import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createTuiPerformancePlatformResult,
  createTuiPerformanceReport,
} from "./tui-performance-contract.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function verifyTuiPerformanceReportData(report, baseline) {
  if (!report || report.schemaVersion !== "tui-performance-report/v1") {
    throw new Error("report.schemaVersion must be tui-performance-report/v1.");
  }
  if (!Array.isArray(report.platforms) || report.platforms.length === 0) {
    throw new Error("report.platforms must contain at least one platform.");
  }
  const minimumSampleCount = baseline?.minimumSampleCount;
  const platformResults = report.platforms.map((entry) => createTuiPerformancePlatformResult({
    platform: entry.platform,
    environment: entry.environment,
    samples: entry.samples,
    minimumSampleCount,
  }));
  const recomputed = createTuiPerformanceReport({
    generatedAt: report.generatedAt,
    source: report.source,
    fixture: report.fixture,
    platformResults,
    baseline,
    requiredPlatforms: report.platforms.map((entry) => entry.platform),
  });
  try {
    assert.deepEqual(report, recomputed);
  } catch (error) {
    throw new Error(`TUI performance report does not match recomputed samples and baseline: ${error.message}`);
  }
  if (!recomputed.gate.passed) {
    throw new Error(`TUI performance Gate failed:\n${recomputed.gate.failures.join("\n")}`);
  }
  return recomputed;
}

function parseArgs(argv) {
  const args = {
    input: "artifacts/benchmarks/p1b-tui-performance.json",
    baseline: "benchmarks/tui-performance/v1/baseline.json",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }
    if (argument !== "--input" && argument !== "--baseline") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value.`);
    args[argument === "--input" ? "input" : "baseline"] = value;
    index += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/verify-tui-performance-report.mjs [--input <report>] [--baseline <baseline>]");
    return;
  }
  const [report, baseline] = await Promise.all([
    fs.readFile(path.resolve(workspaceRoot, args.input), "utf-8").then(JSON.parse),
    fs.readFile(path.resolve(workspaceRoot, args.baseline), "utf-8").then(JSON.parse),
  ]);
  const verified = verifyTuiPerformanceReportData(report, baseline);
  console.log(
    `[verify:tui-performance] ${verified.platforms.map((entry) => entry.platform).join(", ")} passed with zero residual processes.`,
  );
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[verify:tui-performance] ${error.message}`);
    process.exitCode = 1;
  });
}
