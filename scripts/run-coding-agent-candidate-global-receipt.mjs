import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  collectCodingAgentCandidateGlobalEvidence,
  collectCodingAgentCandidateOwnedResourceSweep,
  probeCodingAgentCandidateOwnedResources,
} from "./coding-agent-candidate-evidence.mjs";
import { writeCodingAgentCandidateGlobalReceipt } from "./coding-agent-candidate-qualification.mjs";

export const CODING_AGENT_CANDIDATE_GLOBAL_RUNNER_INPUT_VERSION =
  "coding-agent-benchmark-candidate-global-runner-input/v1";

const MAXIMUM_RUNNER_INPUT_BYTES = 1024 * 1024;
const scriptPath = fileURLToPath(import.meta.url);

export async function runCodingAgentCandidateGlobalReceipt(input, dependencies = {}) {
  const collectGlobalEvidence = dependencies.collectGlobalEvidence
    ?? collectCodingAgentCandidateGlobalEvidence;
  const collectResourceSweep = dependencies.collectResourceSweep
    ?? collectCodingAgentCandidateOwnedResourceSweep;
  const probeOwnedResources = dependencies.probeOwnedResources
    ?? probeCodingAgentCandidateOwnedResources;
  const writeReceipt = dependencies.writeReceipt
    ?? writeCodingAgentCandidateGlobalReceipt;

  const evidence = await collectGlobalEvidence({
    sensitiveRoots: input?.sensitiveRoots,
    sensitiveValues: input?.sensitiveValues,
  }, {
    collectResourceSweep: async ({ platform }) => {
      return await collectResourceSweep({
        platform,
        ...(platform === "wsl2-linux"
          ? { distribution: input?.wslDistribution }
          : {}),
        inventory: input?.resourceInventories?.[platform],
      }, { probeOwnedResources });
    },
  });

  return await writeReceipt({
    aggregateRoot: input?.aggregateRoot,
    generatedAt: input?.generatedAt,
    ...(input?.scorecardPath ? { scorecardPath: input.scorecardPath } : {}),
    sensitiveScan: evidence.sensitiveScan,
    resourceSweeps: evidence.resourceSweeps,
  });
}

export async function runCodingAgentCandidateGlobalReceiptFromFile(inputPath, dependencies = {}) {
  const input = await loadCodingAgentCandidateGlobalRunnerInput(inputPath, dependencies);
  return await runCodingAgentCandidateGlobalReceipt(input, dependencies);
}

export async function loadCodingAgentCandidateGlobalRunnerInput(inputPath, dependencies = {}) {
  const resolvedInputPath = path.resolve(requireInput(inputPath, "input path"));
  const inputText = await readRegularInputFile(resolvedInputPath);
  const validator = await loadRunnerInputValidator();
  if (!validator.validateOutput(inputText).ok) {
    throw new Error("Coding benchmark candidate-global runner input does not match its schema.");
  }
  const parsed = JSON.parse(inputText);
  if (!Number.isFinite(Date.parse(parsed.generatedAt))) {
    throw new Error("Coding benchmark candidate-global runner input does not match its schema.");
  }
  const environment = dependencies.environment ?? process.env;
  const sensitiveValues = parsed.sensitiveValueEnvironmentVariables.map((name) => {
    const value = environment?.[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Coding benchmark candidate-global runner requires non-empty environment variable ${name}.`,
      );
    }
    return value;
  });
  const {
    schemaVersion: _schemaVersion,
    sensitiveValueEnvironmentVariables: _sensitiveValueEnvironmentVariables,
    ...runnerInput
  } = parsed;
  return { ...runnerInput, sensitiveValues };
}

export function parseCodingAgentCandidateGlobalReceiptCliArguments(argv) {
  let inputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--input") {
      throw new Error(`Unknown candidate-global receipt argument: ${String(flag)}.`);
    }
    if (inputPath !== undefined) {
      throw new Error("--input may only be provided once.");
    }
    inputPath = path.resolve(requireInput(argv[index + 1], "--input"));
    index += 1;
  }
  if (inputPath === undefined) {
    throw new Error("Candidate-global receipt runner requires --input.");
  }
  return { inputPath };
}

async function readRegularInputFile(inputPath) {
  let stat;
  try {
    stat = await fs.stat(inputPath);
  } catch {
    throw new Error("Unable to read candidate-global runner input file.");
  }
  if (!stat.isFile()) {
    throw new Error("Candidate-global runner input must be a regular file.");
  }
  if (stat.size > MAXIMUM_RUNNER_INPUT_BYTES) {
    throw new Error("Candidate-global runner input exceeds the 1 MiB size limit.");
  }
  try {
    return await fs.readFile(inputPath, "utf-8");
  } catch {
    throw new Error("Unable to read candidate-global runner input file.");
  }
}

async function loadRunnerInputValidator() {
  const schemaPath = path.resolve(
    import.meta.dirname,
    "..",
    "benchmarks",
    "coding-agent",
    "v3",
    "candidate-global-runner-input.schema.json",
  );
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    throw new Error("Coding benchmark candidate-global runner input schema is invalid.");
  }
  return compiled.validator;
}

function requireInput(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Coding benchmark candidate-global runner requires ${label}.`);
  }
  return value;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const { inputPath } = parseCodingAgentCandidateGlobalReceiptCliArguments(process.argv.slice(2));
  const receipt = await runCodingAgentCandidateGlobalReceiptFromFile(inputPath);
  console.log(`[coding-agent-candidate-global] wrote ${receipt.schemaVersion}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[coding-agent-candidate-global] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
