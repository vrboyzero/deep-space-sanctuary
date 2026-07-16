import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}.`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function parseTimestamp(value, label) {
  const timestamp = Date.parse(requireString(value, label));
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(requireString(args.input, "--input"));
  const outputPath = path.resolve(requireString(args.output, "--output"));
  const now = parseTimestamp(args.now ?? new Date().toISOString(), "--now");
  const maxAgeHours = Number(requireString(args["max-age-hours"], "--max-age-hours"));
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("--max-age-hours must be a positive number.");
  }

  const report = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  if (report?.schemaVersion !== "dependency-governance-report/v1") {
    throw new Error("Unsupported dependency governance report schema.");
  }
  if (!["zero_findings", "findings_present", "scan_failed"].includes(report.status)) {
    throw new Error(`Gate status ${String(report.status)} is not supported yet.`);
  }

  const generatedAt = parseTimestamp(report.generatedAt, "report.generatedAt");
  const ageMs = now - generatedAt;
  const ageHours = ageMs / (60 * 60 * 1000);
  const stale = ageMs < 0 || ageHours > maxAgeHours;
  const status = stale ? "stale" : report.status;
  const allowed = status === "zero_findings";
  const decision = {
    schemaVersion: "dependency-governance-gate/v1",
    evaluatedAt: new Date(now).toISOString(),
    status,
    allowed,
    reportStatus: report.status,
    reportGeneratedAt: new Date(generatedAt).toISOString(),
    ageHours: Number(ageHours.toFixed(3)),
    maxAgeHours,
    summary: {
      affectedPackages: Number(report.summary?.affectedPackages ?? 0),
      vulnerabilityGroups: Number(report.summary?.vulnerabilityGroups ?? 0),
    },
    ...(report.status === "scan_failed"
      ? {
          failure: {
            code: report.failure?.code === "scanner_output_unavailable"
              ? report.failure.code
              : "scanner_failed",
          },
        }
      : {}),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(decision, null, 2)}\n`, "utf-8");
  if (allowed) {
    console.log(`[dependency-audit-gate] allowed: ${decision.status}`);
    return;
  }

  console.error(`[dependency-audit-gate] blocked: ${decision.status}`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[dependency-audit-gate] failed: ${error.message}`);
  process.exitCode = 1;
});
