import fs from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CODING_CI_AUTOMATION_PROFILE,
  CODING_CI_CONTRACT_VERSION,
  CODING_CI_LIMITS,
} from "./run-coding-agent-ci.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function collectCodingCiContractFailures(input = {}) {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? path.dirname(scriptPath), input.workspaceRoot ? "." : "..");
  const failures = [];
  const readJson = async (relativePath) => {
    try {
      return JSON.parse(await fs.readFile(path.join(workspaceRoot, relativePath), "utf-8"));
    } catch (error) {
      failures.push(`${relativePath} is missing or invalid JSON: ${safeMessage(error)}`);
      return undefined;
    }
  };
  const readText = async (relativePath) => {
    try {
      return await fs.readFile(path.join(workspaceRoot, relativePath), "utf-8");
    } catch (error) {
      failures.push(`${relativePath} is missing: ${safeMessage(error)}`);
      return "";
    }
  };

  const packageJson = await readJson("package.json");
  const compatibility = await readJson("examples/ci/compatibility.json");
  const eventSchema = await readJson("examples/ci/schemas/agent-run-event-v1.json");
  const outputSchema = await readJson("examples/ci/review-output.schema.json");
  const workflow = await readText("examples/ci/github-actions/coding-agent-review.yml");
  const prompt = await readText("examples/ci/review-prompt.md");
  const readme = await readText("examples/ci/README.md");
  const qualityGates = await readText(".github/workflows/quality-gates.yml");

  let core;
  let compileOutputSchema;
  try {
    core = await import(pathToFileURL(path.join(
      workspaceRoot,
      "packages",
      "belldandy-core",
      "dist",
      "coding-run",
      "contracts.js",
    )).href);
    ({ compileOutputSchema } = await import(pathToFileURL(path.join(
      workspaceRoot,
      "packages",
      "belldandy-core",
      "dist",
      "cli",
      "shared",
      "output-schema.js",
    )).href));
  } catch (error) {
    failures.push(`built Core contract is unavailable; run pnpm build first: ${safeMessage(error)}`);
  }

  if (core && eventSchema && !isDeepStrictEqual(eventSchema, core.agentRunEventV1JsonSchema)) {
    failures.push("examples/ci/schemas/agent-run-event-v1.json drifted from the Core v1 schema export.");
  }
  if (typeof compileOutputSchema === "function") {
    for (const [label, schema] of [["event", eventSchema], ["review output", outputSchema]]) {
      if (!schema) continue;
      const result = compileOutputSchema(schema);
      if (!result.ok) failures.push(`${label} schema does not compile: ${result.message}`);
    }
  }

  if (packageJson && compatibility && core) {
    expectEqual(failures, "compatibility testedPackageVersion", compatibility.testedPackageVersion, packageJson.version);
    expectEqual(failures, "compatibility nodeEngine", compatibility.nodeEngine, packageJson.engines?.node);
    expectEqual(
      failures,
      "compatibility packageManager",
      compatibility.packageManager,
      packageJson.packageManager,
    );
    expectEqual(failures, "compatibility protocolVersion", compatibility.protocolVersion, core.CODING_RUN_PROTOCOL_VERSION);
    expectEqual(
      failures,
      "compatibility capabilitySchemaVersion",
      compatibility.capabilitySchemaVersion,
      core.CODING_RUN_CAPABILITIES.schemaVersion,
    );
    expectEqual(
      failures,
      "compatibility automationProfile",
      compatibility.automationProfile,
      CODING_CI_AUTOMATION_PROFILE,
    );
    expectEqual(
      failures,
      "compatibility artifactSchemaVersion",
      compatibility.artifactSchemaVersion,
      CODING_CI_CONTRACT_VERSION,
    );
    expectEqual(failures, "compatibility limits", compatibility.limits, CODING_CI_LIMITS);
    expectEqual(failures, "compatibility exitCodes", compatibility.exitCodes, core.CODING_RUN_EXIT_CODES);
    expectEqual(failures, "compatibility supportedOperatingSystems", compatibility.supportedOperatingSystems, ["linux", "windows"]);
    if (packageJson.scripts?.["verify:coding-ci"] !== "node scripts/verify-coding-ci-contract.mjs") {
      failures.push("package.json must expose verify:coding-ci for release and CI gates.");
    }
  }

  if (workflow) {
    if (!/permissions:\s*\n\s+contents: read/.test(workflow)) failures.push("CI example must grant contents: read only.");
    if (!workflow.includes("persist-credentials: false")) failures.push("CI example must not persist checkout credentials.");
    if (!workflow.includes("BELLDANDY_OPENAI_API_KEY is required")) failures.push("CI example must fail explicitly when the model key is missing.");
    if (!workflow.includes("github.event.pull_request.head.repo.full_name == github.repository")) {
      failures.push("CI example must exclude untrusted fork pull requests from the secret-bearing job.");
    }
    if (/\b(?:contents|packages|actions|attestations|id-token): write\b/.test(workflow)) {
      failures.push("CI example must not grant repository write permissions.");
    }
    if (/\bgit\s+(?:push|merge)\b/.test(workflow) || workflow.includes("pull_request_target")) {
      failures.push("CI example must not push, merge, or use pull_request_target.");
    }
    const actionRefs = Array.from(workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm), (match) => match[1]);
    if (actionRefs.length === 0 || actionRefs.some((ref) => !/^[^@\s]+@[0-9a-f]{40}$/.test(ref))) {
      failures.push("CI example must pin every remote Action to a full commit SHA.");
    }
  }

  if (!prompt.trim()) failures.push("examples/ci/review-prompt.md must not be empty.");
  if (!readme.includes("## 兼容、迁移与回滚")) failures.push("CI README must retain compatibility, migration, and rollback guidance.");
  if (!qualityGates.includes("coding-ci-contract:")) failures.push("quality-gates.yml must include the coding CI compatibility job.");
  if (!qualityGates.includes("matrix.os") || !qualityGates.includes("windows-latest") || !qualityGates.includes("ubuntu-latest")) {
    failures.push("coding CI compatibility must be gated on both Windows and Linux runners.");
  }
  if (!qualityGates.includes("run: pnpm verify:coding-ci")) failures.push("quality-gates.yml must run pnpm verify:coding-ci.");

  return failures;
}

function expectEqual(failures, label, actual, expected) {
  if (!isDeepStrictEqual(actual, expected)) {
    failures.push(`${label} drifted: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const failures = await collectCodingCiContractFailures();
  if (failures.length === 0) {
    console.log("[verify:coding-ci] schemas, templates, and compatibility gates are aligned");
    return;
  }
  console.error("[verify:coding-ci] contract failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[verify:coding-ci] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
