import fs from "node:fs/promises";
import path from "node:path";

const SCANNER_VERSION = "2.3.8";
const SCANNER_ACTION_COMMIT = "9a498708959aeaef5ef730655706c5a1df1edbc2";

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

async function writeReport(outputPath, report) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

async function recordScanFailure(outputPath) {
  const failureReport = {
    schemaVersion: "dependency-governance-report/v1",
    scanner: {
      name: "osv-scanner",
      version: SCANNER_VERSION,
      actionCommit: SCANNER_ACTION_COMMIT,
    },
    generatedAt: new Date().toISOString(),
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
  };
  await writeReport(outputPath, failureReport);
  console.log(`[dependency-audit] scan_failed: ${outputPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(requireString(args.input, "--input"));
  const outputPath = path.resolve(requireString(args.output, "--output"));
  const expectedStatus = args["expect-status"];
  let rawReport;
  try {
    rawReport = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  } catch (error) {
    if (args["record-failure"] !== "true") {
      throw error;
    }
    await recordScanFailure(outputPath);
    return;
  }
  const sources = Array.isArray(rawReport.results) ? rawReport.results : null;

  if (!sources) {
    if (args["record-failure"] === "true") {
      await recordScanFailure(outputPath);
      return;
    }
    throw new Error("OSV report must contain a results array.");
  }

  const affectedPackages = sources.flatMap((source) => (
    Array.isArray(source?.packages)
      ? source.packages.filter((entry) => Array.isArray(entry?.vulnerabilities) && entry.vulnerabilities.length > 0)
      : []
  ));
  const findings = affectedPackages.map((entry) => {
    const packageInfo = entry?.package;
    if (
      typeof packageInfo?.name !== "string"
      || typeof packageInfo?.version !== "string"
      || typeof packageInfo?.ecosystem !== "string"
    ) {
      throw new Error("Affected OSV package is missing name, version, or ecosystem.");
    }

    const vulnerabilityIds = [...new Set(
      entry.vulnerabilities
        .map((vulnerability) => vulnerability?.id)
        .filter((id) => typeof id === "string" && id.length > 0),
    )].sort();
    const vulnerabilityGroups = Array.isArray(entry.groups) && entry.groups.length > 0
      ? entry.groups.length
      : vulnerabilityIds.length;

    return {
      package: {
        ecosystem: packageInfo.ecosystem,
        name: packageInfo.name,
        version: packageInfo.version,
      },
      vulnerabilityIds,
      vulnerabilityGroups,
    };
  });
  const status = findings.length > 0 ? "findings_present" : "zero_findings";
  if (expectedStatus && expectedStatus !== status) {
    throw new Error(`Expected status ${expectedStatus}, received ${status}.`);
  }

  const requiredVulnerability = args["require-vulnerability"];
  if (
    requiredVulnerability
    && !findings.some((finding) => finding.vulnerabilityIds.includes(requiredVulnerability))
  ) {
    throw new Error(`Required vulnerability ${requiredVulnerability} was not found.`);
  }

  const report = {
    schemaVersion: "dependency-governance-report/v1",
    scanner: {
      name: "osv-scanner",
      version: SCANNER_VERSION,
      actionCommit: SCANNER_ACTION_COMMIT,
    },
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      sources: sources.length,
      affectedPackages: findings.length,
      vulnerabilityGroups: findings.reduce(
        (total, finding) => total + finding.vulnerabilityGroups,
        0,
      ),
    },
    findings: findings.map(({ vulnerabilityGroups: _vulnerabilityGroups, ...finding }) => finding),
  };

  await writeReport(outputPath, report);
  console.log(`[dependency-audit] ${status}: ${outputPath}`);
}

main().catch((error) => {
  console.error(`[dependency-audit] failed: ${error.message}`);
  process.exitCode = 1;
});
