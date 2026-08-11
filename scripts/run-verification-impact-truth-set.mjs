import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { selectVerificationNodes } from "./run-verification-dag.mjs";

export const VERIFICATION_IMPACT_TRUTH_SET_REPORT_VERSION = "verification-impact-truth-set-report/v1";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(workspaceRoot, "benchmarks/verification/v1/impact-truth-set.json");
const selectorSourcePath = path.join(workspaceRoot, "scripts/run-verification-dag.mjs");
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SELECTION_SCOPES = new Set(["targeted", "expanded", "browser"]);
const SELECTION_REASONS = new Set([
  "affected-paths",
  "scope-unavailable",
  "impact-unknown",
  "impact-evidence",
  "browser-required",
  "no-nodes",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowedKeys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(", ")}.`);
}

function assertId(value, label) {
  assert(typeof value === "string" && value.length <= 160 && ID_PATTERN.test(value), `${label} must be a valid id.`);
}

function assertUniqueIds(values, label, { minItems = 0 } = {}) {
  assert(Array.isArray(values) && values.length >= minItems, `${label} must contain at least ${minItems} item(s).`);
  values.forEach((value, index) => assertId(value, `${label}[${index}]`));
  assert(new Set(values).size === values.length, `${label} must not contain duplicates.`);
}

function assertThreshold(value, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0.95 && value <= 1, `${label} must be between 0.95 and 1.`);
}

function normalizeSelection(value, label) {
  assertExactKeys(value, ["scope", "expanded", "reason"], label);
  assert(SELECTION_SCOPES.has(value.scope), `${label}.scope is unsupported.`);
  assert(typeof value.expanded === "boolean", `${label}.expanded must be boolean.`);
  assert(SELECTION_REASONS.has(value.reason), `${label}.reason is unsupported.`);
  assert(
    value.scope === "browser" || value.expanded === (value.scope === "expanded"),
    `${label}.scope and expanded are inconsistent.`,
  );
  return { scope: value.scope, expanded: value.expanded, reason: value.reason };
}

export function validateVerificationImpactTruthSetManifest(manifest) {
  assertExactKeys(
    manifest,
    ["schemaVersion", "id", "contractVersion", "thresholds", "verificationCommands", "browser", "cases"],
    "manifest",
  );
  assert(manifest.schemaVersion === "verification-impact-truth-set/v1", "Unsupported verification impact truth set schemaVersion.");
  assertId(manifest.id, "manifest.id");
  assert(manifest.contractVersion === "verification-impact/v1", "Unsupported verification impact contractVersion.");
  assertExactKeys(manifest.thresholds, ["precision", "recall", "exactCaseRate"], "manifest.thresholds");
  assertThreshold(manifest.thresholds.precision, "manifest.thresholds.precision");
  assertThreshold(manifest.thresholds.recall, "manifest.thresholds.recall");
  assertThreshold(manifest.thresholds.exactCaseRate, "manifest.thresholds.exactCaseRate");
  assert(Array.isArray(manifest.verificationCommands) && manifest.verificationCommands.length > 0 && manifest.verificationCommands.length <= 100, "manifest.verificationCommands must contain 1-100 commands.");
  const commandIds = manifest.verificationCommands.map((command, index) => {
    assert(command && typeof command === "object" && !Array.isArray(command), `manifest.verificationCommands[${index}] must be an object.`);
    assertId(command.id, `manifest.verificationCommands[${index}].id`);
    return command.id;
  });
  assert(new Set(commandIds).size === commandIds.length, "manifest.verificationCommands ids must be unique.");
  assertExactKeys(manifest.browser, ["required", "affectedPaths", "command"], "manifest.browser");
  assert(manifest.browser.required === true && manifest.browser.command === null, "manifest.browser must require a commandless Browser Relay.");
  assert(Array.isArray(manifest.cases) && manifest.cases.length > 0 && manifest.cases.length <= 100, "manifest.cases must contain 1-100 cases.");
  const knownNodeIds = new Set([...commandIds, "browser.relay"]);
  const caseIds = new Set();
  for (const [index, testCase] of manifest.cases.entries()) {
    const label = `manifest.cases[${index}]`;
    assertExactKeys(testCase, ["id", "changedPaths", "expectedNodeIds", "expectedSelection"], label);
    assertId(testCase.id, `${label}.id`);
    assert(!caseIds.has(testCase.id), `manifest.cases contains duplicate id: ${testCase.id}.`);
    caseIds.add(testCase.id);
    assert(Array.isArray(testCase.changedPaths) && testCase.changedPaths.length > 0, `${label}.changedPaths must not be empty.`);
    assertUniqueIds(testCase.expectedNodeIds, `${label}.expectedNodeIds`, { minItems: 1 });
    assert(testCase.expectedNodeIds.every((nodeId) => knownNodeIds.has(nodeId)), `${label}.expectedNodeIds contains an unknown node.`);
    normalizeSelection(testCase.expectedSelection, `${label}.expectedSelection`);
    // Validate every scenario through the production selector before a report is emitted.
    selectVerificationNodes({
      changedPaths: testCase.changedPaths,
      verificationCommands: manifest.verificationCommands,
      browser: manifest.browser,
    });
  }
  return manifest;
}

export async function buildVerificationImpactTruthSetReport({
  manifestPath = defaultManifestPath,
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedGeneratedAt = requireIsoTimestamp(generatedAt);
  const resolvedManifestPath = path.resolve(manifestPath);
  const [manifestText, selectorSource] = await Promise.all([
    fs.readFile(resolvedManifestPath, "utf8"),
    fs.readFile(selectorSourcePath),
  ]);
  const manifest = validateVerificationImpactTruthSetManifest(JSON.parse(manifestText));
  const cases = manifest.cases.map((testCase) => evaluateCase(manifest, testCase));
  const metrics = summarizeMetrics(cases, manifest.thresholds);
  const failures = [
    ...(metrics.precision >= metrics.precisionThreshold ? [] : ["precision_below_threshold"]),
    ...(metrics.recall >= metrics.recallThreshold ? [] : ["recall_below_threshold"]),
    ...(metrics.exactCaseRate >= metrics.exactCaseRateThreshold ? [] : ["exact_case_rate_below_threshold"]),
  ];
  return {
    schemaVersion: VERIFICATION_IMPACT_TRUTH_SET_REPORT_VERSION,
    generatedAt: normalizedGeneratedAt,
    truthSet: {
      id: manifest.id,
      manifestPath: toReportPath(resolvedManifestPath),
      manifestSha256: sha256(manifestText),
      contractVersion: manifest.contractVersion,
    },
    selector: {
      strategy: "changed-paths-v1",
      sourcePath: "scripts/run-verification-dag.mjs",
      sourceSha256: sha256(selectorSource),
    },
    metrics,
    cases,
    gate: { passed: failures.length === 0, failures },
    execution: {
      selectionEvaluations: cases.length,
      commandsExecuted: false,
      providerCalls: 0,
      gatewayCalls: 0,
      modelCalls: 0,
      networkCalls: 0,
      credentialsRead: false,
      mutationCount: 0,
    },
  };
}

function evaluateCase(manifest, testCase) {
  const result = selectVerificationNodes({
    changedPaths: testCase.changedPaths,
    verificationCommands: manifest.verificationCommands,
    browser: manifest.browser,
  });
  const expectedNodeIds = sortedUnique(testCase.expectedNodeIds);
  const actualNodeIds = sortedUnique(result.nodes.map((node) => node.id));
  const expectedSet = new Set(expectedNodeIds);
  const actualSet = new Set(actualNodeIds);
  const truePositiveNodeIds = actualNodeIds.filter((nodeId) => expectedSet.has(nodeId));
  const falsePositiveNodeIds = actualNodeIds.filter((nodeId) => !expectedSet.has(nodeId));
  const falseNegativeNodeIds = expectedNodeIds.filter((nodeId) => !actualSet.has(nodeId));
  const expectedSelection = normalizeSelection(testCase.expectedSelection, `${testCase.id}.expectedSelection`);
  const actualSelection = normalizeSelection({
    scope: result.selection.scope,
    expanded: result.selection.expanded,
    reason: result.selection.reason,
  }, `${testCase.id}.actualSelection`);
  const nodeSetExact = falsePositiveNodeIds.length === 0 && falseNegativeNodeIds.length === 0;
  const selectionExact = JSON.stringify(actualSelection) === JSON.stringify(expectedSelection);
  return {
    id: testCase.id,
    status: nodeSetExact && selectionExact ? "passed" : "failed",
    expectedNodeIds,
    actualNodeIds,
    truePositiveNodeIds,
    falsePositiveNodeIds,
    falseNegativeNodeIds,
    expectedSelection,
    actualSelection,
    nodeSetExact,
    selectionExact,
  };
}

function summarizeMetrics(cases, thresholds) {
  const totals = cases.reduce((summary, testCase) => ({
    expected: summary.expected + testCase.expectedNodeIds.length,
    returned: summary.returned + testCase.actualNodeIds.length,
    truePositive: summary.truePositive + testCase.truePositiveNodeIds.length,
    falsePositive: summary.falsePositive + testCase.falsePositiveNodeIds.length,
    falseNegative: summary.falseNegative + testCase.falseNegativeNodeIds.length,
    exactCases: summary.exactCases + (testCase.status === "passed" ? 1 : 0),
  }), { expected: 0, returned: 0, truePositive: 0, falsePositive: 0, falseNegative: 0, exactCases: 0 });
  const precision = totals.returned === 0 ? 0 : totals.truePositive / totals.returned;
  const recall = totals.expected === 0 ? 1 : totals.truePositive / totals.expected;
  const exactCaseRate = totals.exactCases / cases.length;
  const passed = precision >= thresholds.precision
    && recall >= thresholds.recall
    && exactCaseRate >= thresholds.exactCaseRate;
  return {
    ...totals,
    precision,
    recall,
    totalCases: cases.length,
    exactCaseRate,
    precisionThreshold: thresholds.precision,
    recallThreshold: thresholds.recall,
    exactCaseRateThreshold: thresholds.exactCaseRate,
    passed,
  };
}

export async function runVerificationImpactTruthSet(input = {}) {
  const outputPath = path.resolve(requireText(input.outputPath, "outputPath"));
  const report = await buildVerificationImpactTruthSetReport(input);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(outputPath, "wx");
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Verification impact truth set output already exists: ${outputPath}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return report;
}

export function parseVerificationImpactTruthSetCliArguments(argv) {
  const args = { help: false, manifestPath: defaultManifestPath, outputPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }
    if (argument !== "--manifest" && argument !== "--output") {
      throw new Error(`Unsupported argument ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    if (argument === "--manifest") args.manifestPath = path.resolve(value);
    else args.outputPath = path.resolve(value);
    index += 1;
  }
  if (!args.help) requireText(args.outputPath, "outputPath");
  return args;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toReportPath(filePath) {
  const relative = path.relative(workspaceRoot, filePath);
  const insideWorkspace = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  return (insideWorkspace ? relative : filePath).split(path.sep).join("/");
}

function requireIsoTimestamp(value) {
  assert(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)), "generatedAt must be an ISO date-time.");
  return value;
}

function requireText(value, label) {
  assert(typeof value === "string" && value.trim().length > 0, `${label} is required.`);
  return value;
}

async function main() {
  const args = parseVerificationImpactTruthSetCliArguments(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/run-verification-impact-truth-set.mjs [--manifest truth-set.json] --output report.json");
    return;
  }
  const report = await runVerificationImpactTruthSet(args);
  console.log(JSON.stringify({ output: args.outputPath, metrics: report.metrics, gate: report.gate }));
  if (!report.gate.passed) process.exitCode = 1;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`[verification-impact-truth-set] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
