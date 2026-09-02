import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CodeIntel,
  TypeScriptLanguageServiceProvider,
} from "../packages/belldandy-skills/dist/code-intel/index.js";
import { hashCanonicalText } from "./coding-agent-benchmark-contract.mjs";

export const CODE_INTEL_TRUTH_SET_REPORT_VERSION = "code-intel-truth-set-report/v1";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(workspaceRoot, "benchmarks/code-intel/v1/truth-set.json");
const sourceContractPath = "packages/belldandy-skills/src/code-intel/typescript-provider.ts";
const executableContractPath = "packages/belldandy-skills/dist/code-intel/typescript-provider.js";

export async function buildCodeIntelTruthSetReport(input) {
  const platform = requirePlatform(input?.platform);
  const generatedAt = requireIsoTimestamp(input?.generatedAt ?? new Date().toISOString());
  const manifestPath = path.resolve(input?.manifestPath ?? defaultManifestPath);
  const manifestText = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestText);
  validateManifestShape(manifest);
  const manifestDirectory = path.dirname(manifestPath);
  const fixtureRoot = path.resolve(manifestDirectory, manifest.workspace.root);
  const sourceFiles = await verifySourceFiles(fixtureRoot, manifest.workspace.sourceFiles);
  const manifestSha256 = hashCanonicalText(manifestText);
  const provider = new TypeScriptLanguageServiceProvider();
  const codeIntel = new CodeIntel({ providers: [provider] });
  const startedAt = Date.now();
  const caseResults = [];

  try {
    for (const testCase of manifest.cases) {
      caseResults.push(await runCase({ codeIntel, fixtureRoot, revision: manifest.workspace.revision, testCase }));
    }
  } finally {
    codeIntel.dispose();
  }

  const metrics = summarizeCaseMetrics(caseResults, manifest.thresholds);
  const [runtimeSourceSha256, runtimeExecutableSha256] = await Promise.all([
    hashTextFile(path.join(workspaceRoot, sourceContractPath)),
    hashTextFile(path.join(workspaceRoot, executableContractPath)),
  ]);
  const report = {
    schemaVersion: CODE_INTEL_TRUTH_SET_REPORT_VERSION,
    generatedAt,
    platform,
    truthSet: {
      id: manifest.id,
      manifestPath: toReportPath(manifestPath),
      manifestSha256,
      contractVersion: manifest.contractVersion,
      workspaceRevision: manifest.workspace.revision,
    },
    sourceIdentity: {
      aggregateSha256: sha256(JSON.stringify(sourceFiles)),
      files: sourceFiles,
      runtimeSourceSha256,
      runtimeExecutableSha256,
    },
    provider: {
      id: provider.profile.id,
      version: provider.profile.version,
      capability: "semantic-live",
    },
    metrics,
    cases: caseResults,
    execution: {
      durationMs: Date.now() - startedAt,
      gatewayCalls: 0,
      modelCalls: 0,
      providerNetworkCalls: 0,
      hostCommands: 0,
      credentialsRead: false,
      workspaceMutations: 0,
    },
  };
  return report;
}

export async function runCodeIntelTruthSet(input) {
  const outputPath = path.resolve(requireText(input?.outputPath, "outputPath"));
  const report = await buildCodeIntelTruthSetReport(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.open(outputPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf-8");
  } finally {
    await handle.close();
  }
  return report;
}

export function calculateLocationMetrics(expected, returned) {
  const truePositive = [...returned].filter((key) => expected.has(key)).length;
  const falsePositive = returned.size - truePositive;
  const falseNegative = expected.size - truePositive;
  return {
    expected: expected.size,
    returned: returned.size,
    truePositive,
    falsePositive,
    falseNegative,
    precision: returned.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositive / returned.size,
    recall: expected.size === 0 ? 1 : truePositive / expected.size,
  };
}

export function parseCodeIntelTruthSetCliArguments(argv) {
  let platform;
  let manifestPath;
  let outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--platform" || argument === "--manifest" || argument === "--output") {
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === "--platform") platform = value;
      if (argument === "--manifest") manifestPath = path.resolve(value);
      if (argument === "--output") outputPath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    platform: requirePlatform(platform),
    manifestPath: manifestPath ?? defaultManifestPath,
    outputPath: requireText(outputPath, "outputPath"),
  };
}

async function runCase({ codeIntel, fixtureRoot, revision, testCase }) {
  const expectedLocations = new Set(testCase.expected.map((item) => expectedLocationKey(fixtureRoot, item)));
  const requestAnchor = testCase.location === undefined
    ? undefined
    : resolveAnchor(await readFixtureFile(fixtureRoot, testCase.location.path), testCase.location.anchor);
  const request = {
    workspace: { rootPath: fixtureRoot, revision },
    operation: testCase.operation,
    requiredCapability: "semantic-live",
    deadlineAtMs: Date.now() + 30_000,
    ...(testCase.query === undefined ? {} : { query: testCase.query }),
    ...(testCase.location === undefined ? {} : {
      location: {
        path: testCase.location.path,
        line: requestAnchor.line,
        column: requestAnchor.column,
      },
    }),
  };
  const outcome = await codeIntel.query(request);
  if (!outcome.ok) {
    return {
      id: testCase.id,
      operation: testCase.operation,
      status: "query_error",
      expected: expectedLocations.size,
      returned: 0,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: expectedLocations.size,
      precision: 0,
      recall: 0,
      errorCode: outcome.error.code,
      items: [],
    };
  }
  const actualLocations = new Set(outcome.result.items.map((item) => actualLocationKey(item)));
  const metrics = calculateLocationMetrics(expectedLocations, actualLocations);
  return {
    id: testCase.id,
    operation: testCase.operation,
    status: metrics.falsePositive === 0 && metrics.falseNegative === 0 ? "passed" : "failed",
    ...metrics,
    errorCode: null,
    items: outcome.result.items.map((item) => ({
      location: item.location,
      symbolKind: item.symbolKind,
      documentRevision: item.documentRevision,
      matched: expectedLocations.has(actualLocationKey(item)),
    })),
  };
}

async function verifySourceFiles(fixtureRoot, sourceFiles) {
  const entries = [];
  for (const sourceFile of sourceFiles) {
    const filePath = path.resolve(fixtureRoot, sourceFile.path);
    if (!isPathInside(fixtureRoot, filePath)) {
      throw new Error(`Truth set source path escapes fixture root: ${sourceFile.path}`);
    }
    const actual = await hashTextFile(filePath);
    if (actual !== sourceFile.sha256) {
      throw new Error(`Truth set source hash mismatch: ${sourceFile.path}`);
    }
    entries.push({ path: sourceFile.path.replaceAll("\\", "/"), sha256: actual });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function validateManifestShape(manifest) {
  if (manifest?.schemaVersion !== "code-intel-truth-set/v1"
    || manifest.contractVersion !== "code-intel/v1"
    || typeof manifest.id !== "string"
    || !manifest.workspace
    || !Array.isArray(manifest.workspace.sourceFiles)
    || !Array.isArray(manifest.cases)
    || typeof manifest.thresholds?.precision !== "number"
    || typeof manifest.thresholds?.recall !== "number"
    || manifest.thresholds.precision < 0.95
    || manifest.thresholds.recall < 0.95) {
    throw new Error("Invalid CodeIntel truth set manifest.");
  }
  const caseIds = new Set();
  for (const testCase of manifest.cases) {
    if (!testCase?.id || caseIds.has(testCase.id) || !["symbols", "definition", "references", "implementation"].includes(testCase.operation)) {
      throw new Error("Invalid or duplicate CodeIntel truth set case.");
    }
    caseIds.add(testCase.id);
    if ((testCase.query === undefined) === (testCase.location === undefined)) {
      throw new Error(`Truth set case must have exactly one query/location: ${testCase.id}`);
    }
  }
}

function resolveAnchor(source, anchor) {
  const offsets = [];
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(anchor.text)}(?![A-Za-z0-9_$])`, "gu");
  for (const match of source.matchAll(pattern)) offsets.push(match.index);
  const offset = offsets[anchor.occurrence - 1];
  if (offset === undefined) {
    throw new Error(`Truth set anchor not found: ${anchor.text} #${anchor.occurrence}`);
  }
  const start = offsetToPosition(source, offset);
  const end = offsetToPosition(source, offset + anchor.text.length);
  return {
    ...start,
    endLine: end.line,
    endColumn: end.column,
  };
}

function expectedLocationKey(fixtureRoot, expected) {
  const filePath = path.resolve(fixtureRoot, expected.path);
  return locationKey(expected.scope, toPortableRelativePath(fixtureRoot, filePath), resolveAnchorCached(fixtureRoot, expected.path, expected.anchor));
}

function resolveAnchorCached(fixtureRoot, relativePath, anchor) {
  // The caller supplies already hash-verified fixture files; sync reads keep key construction deterministic.
  const source = readFileSync(path.resolve(fixtureRoot, relativePath), "utf-8");
  return resolveAnchor(source, anchor);
}

function actualLocationKey(item) {
  const range = item.location.range;
  return locationKey(item.location.scope, item.location.path, {
    line: range.start.line,
    column: range.start.column,
    endLine: range.end.line,
    endColumn: range.end.column,
  });
}

function locationKey(scope, filePath, position) {
  return JSON.stringify([scope, filePath.replaceAll("\\", "/"), position]);
}

function summarizeCaseMetrics(caseResults, thresholds) {
  const totals = caseResults.reduce((sum, entry) => ({
    expected: sum.expected + entry.expected,
    returned: sum.returned + entry.returned,
    truePositive: sum.truePositive + entry.truePositive,
    falsePositive: sum.falsePositive + entry.falsePositive,
    falseNegative: sum.falseNegative + entry.falseNegative,
  }), { expected: 0, returned: 0, truePositive: 0, falsePositive: 0, falseNegative: 0 });
  return {
    ...totals,
    precision: totals.returned === 0 ? 0 : totals.truePositive / totals.returned,
    recall: totals.expected === 0 ? 1 : totals.truePositive / totals.expected,
    precisionThreshold: thresholds.precision,
    recallThreshold: thresholds.recall,
    passed: totals.truePositive / totals.returned >= thresholds.precision
      && totals.truePositive / totals.expected >= thresholds.recall
      && caseResults.every((entry) => entry.status === "passed"),
  };
}

function toReportPath(filePath) {
  return isPathInside(workspaceRoot, filePath)
    ? path.relative(workspaceRoot, filePath).split(path.sep).join("/")
    : filePath;
}

async function readFixtureFile(root, relativePath) {
  return fs.readFile(path.resolve(root, relativePath), "utf-8");
}

function offsetToPosition(source, offset) {
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length - 1,
    column: lines.at(-1)?.length ?? 0,
  };
}

async function hashTextFile(filePath) {
  return hashCanonicalText(await fs.readFile(filePath, "utf-8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toPortableRelativePath(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requireIsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("CodeIntel truth set generatedAt must be an ISO timestamp.");
  }
  return value;
}

function requireText(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requirePlatform(value) {
  if (value !== "windows-native" && value !== "wsl2-linux") {
    throw new Error("CodeIntel truth set platform must be windows-native or wsl2-linux.");
  }
  const actual = process.platform === "win32" ? "windows-native" : "wsl2-linux";
  if (value !== actual) {
    throw new Error(`CodeIntel truth set platform mismatch: expected ${actual}, received ${value}.`);
  }
  return value;
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseCodeIntelTruthSetCliArguments(process.argv.slice(2));
    const report = await runCodeIntelTruthSet(args);
    process.stdout.write(`${JSON.stringify({ outputPath: args.outputPath, metrics: report.metrics })}\n`);
    if (!report.metrics.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
