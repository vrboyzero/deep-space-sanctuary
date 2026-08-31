import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODING_AGENT_BENCHMARK_WEB_UI_TRUTH_SET_VERSION =
  "coding-agent-benchmark-web-ui-truth-set/v1";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..");
const TRUTH_SET_ID = "real-web-ui-regression-v1";
const TRUTH_SET_PATH = "benchmarks/coding-agent/v3/real-web-ui-regression-truth-set.json";
const SOURCE_PATH = "src/diff/props.js";
const VISIBLE_TEST_PATH = "test/shared/benchmark-v3-ui-regression.test.js";
const TEST_COMMAND =
  "npm exec --offline -- vitest run --config vitest.benchmark-v3.config.mjs test/shared/benchmark-v3-ui-regression.test.js";

export async function loadCodingAgentBenchmarkWebUiTruthSet(task, input = {}) {
  assertTruthSetIdentity(task?.truthSet);
  const sourceRoot = input.workspaceRoot ? path.resolve(input.workspaceRoot) : workspaceRoot;
  const content = await fs.readFile(path.join(sourceRoot, ...TRUTH_SET_PATH.split("/")));
  const actualSha256 = crypto.createHash("sha256").update(content).digest("hex");
  if (actualSha256 !== task.truthSet.sha256) {
    throw new Error("Benchmark v3 Web UI truth set SHA-256 drifted from the task manifest.");
  }
  let truthSet;
  try {
    truthSet = JSON.parse(content.toString("utf-8"));
  } catch {
    throw new Error("Benchmark v3 Web UI truth set is not valid JSON.");
  }
  validateCodingAgentBenchmarkWebUiTruthSet(truthSet);
  assertTaskBinding(task, truthSet);
  return structuredClone(truthSet);
}

export function validateCodingAgentBenchmarkWebUiTruthSet(truthSet) {
  assertExactKeys(truthSet, [
    "baselineSourceContract",
    "boundaries",
    "brokenSourceContract",
    "cases",
    "id",
    "schemaVersion",
    "sourcePath",
    "taskId",
    "taskText",
    "testCommand",
    "visibleTestPath",
  ], "truth set");
  if (truthSet.schemaVersion !== CODING_AGENT_BENCHMARK_WEB_UI_TRUTH_SET_VERSION
    || truthSet.id !== TRUTH_SET_ID
    || truthSet.taskId !== "real-web.ui-regression"
    || truthSet.sourcePath !== SOURCE_PATH
    || truthSet.visibleTestPath !== VISIBLE_TEST_PATH
    || truthSet.testCommand !== TEST_COMMAND
    || truthSet.baselineSourceContract !== "value != NULL && (value !== false || name[4] == '-')"
    || truthSet.brokenSourceContract !== "value != NULL && value !== false") {
    throw new Error("Benchmark v3 Web UI truth set identity or frozen paths drifted.");
  }
  if (typeof truthSet.taskText !== "string" || truthSet.taskText.trim().length < 100) {
    throw new Error("Benchmark v3 Web UI truth set requires concrete task text.");
  }
  if (!Array.isArray(truthSet.boundaries)
    || truthSet.boundaries.length < 4
    || truthSet.boundaries.some((boundary) => typeof boundary !== "string" || boundary.length < 20)) {
    throw new Error("Benchmark v3 Web UI truth set requires bounded behavior descriptions.");
  }
  if (!Array.isArray(truthSet.cases) || truthSet.cases.length < 6 || truthSet.cases.length > 12) {
    throw new Error("Benchmark v3 Web UI truth set requires six to twelve cases.");
  }

  const caseIds = new Set();
  const caseInputs = new Set();
  for (const testCase of truthSet.cases) validateTruthCase(testCase, caseIds, caseInputs);
  const hasCase = (predicate) => truthSet.cases.some(predicate);
  const hasOrdinaryFalseCase = (attributeName) => hasCase((testCase) => (
    testCase.attributeName === attributeName
      && testCase.valueKind === "false"
      && testCase.expected.operation === "remove"
  ));
  if (!hasOrdinaryFalseCase("align") || !hasOrdinaryFalseCase("draggable")) {
    throw new Error(
      "Benchmark v3 Web UI truth set requires ordinary a-prefix and d-prefix false witnesses.",
    );
  }
  if (!hasOrdinaryFalseCase("archive")) {
    throw new Error(
      "Benchmark v3 Web UI truth set requires an ordinary ar-prefix false witness.",
    );
  }
  if (!hasCase((testCase) => testCase.attributeName.startsWith("aria-")
      && testCase.valueKind === "false" && testCase.expected.operation === "set")
    || !hasCase((testCase) => testCase.attributeName.startsWith("data-")
      && testCase.valueKind === "false" && testCase.expected.operation === "set")
    || !hasCase((testCase) => !testCase.attributeName.startsWith("aria-")
      && !testCase.attributeName.startsWith("data-")
      && testCase.valueKind === "false" && testCase.expected.operation === "remove")
    || !hasCase((testCase) => testCase.valueKind === "null"
      && testCase.expected.operation === "remove")
    || !hasCase((testCase) => testCase.valueKind === "undefined"
      && testCase.expected.operation === "remove")) {
    throw new Error("Benchmark v3 Web UI truth set is missing a required positive or negative witness.");
  }
  return truthSet;
}

export function renderCodingAgentBenchmarkWebUiPromptSuffix(truthSet) {
  validateCodingAgentBenchmarkWebUiTruthSet(truthSet);
  return [
    `Use the frozen behavior truth set ${truthSet.id}.`,
    `The deterministic checks are in ${truthSet.visibleTestPath}.`,
    ...truthSet.boundaries,
    `Do not modify tests, dependencies, package metadata, or any path other than ${truthSet.sourcePath}.`,
    "Return exactly one JSON object with a non-empty summary.",
  ].join(" ");
}

export function renderCodingAgentBenchmarkWebUiVisibleTest(truthSet) {
  validateCodingAgentBenchmarkWebUiTruthSet(truthSet);
  const renderedCases = truthSet.cases.map((testCase) => {
    const value = testCase.valueKind === "false" ? "false" : testCase.valueKind;
    const expected = testCase.expected.operation === "set"
      ? [["set", testCase.attributeName, testCase.expected.value]]
      : [["remove", testCase.attributeName]];
    return `\t{ id: ${JSON.stringify(testCase.id)}, name: ${JSON.stringify(testCase.attributeName)}, value: ${value}, expected: ${JSON.stringify(expected)} },`;
  });
  return [
    "import { setProperty } from '../../src/diff/props';",
    "",
    `const truthSetId = ${JSON.stringify(truthSet.id)};`,
    "const cases = [",
    ...renderedCases,
    "];",
    "",
    "describe(`benchmark v3 attribute contract ${truthSetId}`, () => {",
    "\tit.each(cases)('$id', ({ name, value, expected }) => {",
    "\t\tconst calls = [];",
    "\t\tconst dom = {",
    "\t\t\tsetAttribute(attributeName, attributeValue) {",
    "\t\t\t\tcalls.push(['set', attributeName, String(attributeValue)]);",
    "\t\t\t},",
    "\t\t\tremoveAttribute(attributeName) {",
    "\t\t\t\tcalls.push(['remove', attributeName]);",
    "\t\t\t}",
    "\t\t};",
    "\t\tsetProperty(dom, name, value, undefined, undefined);",
    "\t\texpect(calls).toEqual(expected);",
    "\t});",
    "});",
    "",
  ].join("\n");
}

function assertTaskBinding(task, truthSet) {
  if (task?.id !== truthSet.taskId
    || task.prompt !== truthSet.taskText
    || task.fixture?.generatorId !== "real-web-ui-regression-v2"
    || task.fixture?.version !== 2
    || task.evaluator?.kind !== "machine"
    || task.evaluator?.id !== "real-web-ui-regression-v2"
    || JSON.stringify(task.acceptance?.testCommands) !== JSON.stringify([{
      command: truthSet.testCommand,
      expectedExitCode: 0,
    }])
    || JSON.stringify(task.acceptance?.requiredChangedPaths) !== JSON.stringify([truthSet.sourcePath])
    || JSON.stringify(task.acceptance?.allowedChangedPaths) !== JSON.stringify([truthSet.sourcePath])) {
    throw new Error("Benchmark v3 Web UI task drifted from its versioned truth set.");
  }
}

function assertTruthSetIdentity(identity) {
  assertExactKeys(identity, ["id", "path", "sha256"], "truth set identity");
  if (identity.id !== TRUTH_SET_ID || identity.path !== TRUTH_SET_PATH
    || typeof identity.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(identity.sha256)) {
    throw new Error("Benchmark v3 Web UI task has an invalid truth set identity.");
  }
}

function validateTruthCase(testCase, caseIds, caseInputs) {
  assertExactKeys(testCase, ["attributeName", "expected", "id", "valueKind"], "truth case");
  if (typeof testCase.id !== "string" || !/^[a-z][a-z0-9-]{1,49}$/.test(testCase.id)
    || caseIds.has(testCase.id)) {
    throw new Error("Benchmark v3 Web UI truth case id is invalid or duplicated.");
  }
  caseIds.add(testCase.id);
  if (typeof testCase.attributeName !== "string"
    || !/^[a-z][a-z0-9-]{0,49}$/.test(testCase.attributeName)
    || !["false", "null", "undefined"].includes(testCase.valueKind)) {
    throw new Error(`Benchmark v3 Web UI truth case ${testCase.id} has invalid input.`);
  }
  const inputKey = `${testCase.attributeName}\0${testCase.valueKind}`;
  if (caseInputs.has(inputKey)) {
    throw new Error(`Benchmark v3 Web UI truth case ${testCase.id} has a duplicate input.`);
  }
  caseInputs.add(inputKey);
  const preservesFalse = testCase.valueKind === "false"
    && (testCase.attributeName.startsWith("aria-")
      || testCase.attributeName.startsWith("data-"));
  const expectedOperation = preservesFalse ? "set" : "remove";
  if (testCase.expected?.operation !== expectedOperation) {
    throw new Error(`Benchmark v3 Web UI truth case ${testCase.id} contradicts the frozen behavior.`);
  }
  const expectedKeys = expectedOperation === "set" ? ["operation", "value"] : ["operation"];
  assertExactKeys(testCase.expected, expectedKeys, `truth case ${testCase.id} expectation`);
  if (expectedOperation === "set" && testCase.expected.value !== "false") {
    throw new Error(`Benchmark v3 Web UI truth case ${testCase.id} has an invalid set expectation.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Benchmark v3 Web UI ${label} must be an object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpected)) {
    throw new Error(`Benchmark v3 Web UI ${label} fields are invalid.`);
  }
}
