import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const schemaPath = path.resolve(import.meta.dirname, "../benchmarks/coding-agent/v3/candidate-runner-config.schema.json");
let validator;

export async function validateCodingAgentCandidateConfig(input, options = {}) {
  if (!validator) {
    const compiled = compileOutputSchema(JSON.parse(await fs.readFile(schemaPath, "utf8")));
    if (!compiled.ok) throw new Error("Candidate runner configuration schema is invalid.");
    validator = compiled.validator;
  }
  if (!validator.validateOutput(JSON.stringify(input)).ok) throw new Error("Candidate runner configuration does not match its schema.");
  const config = structuredClone(input);
  const resolve = (value) => {
    if (!path.isAbsolute(value)) throw new Error("Candidate runner paths must be absolute.");
    return path.resolve(value);
  };
  config.workspaceRoot = resolve(config.workspaceRoot);
  config.windowsHarnessRoot = resolve(config.windowsHarnessRoot);
  config.wsl.harnessRoot = resolve(config.wsl.harnessRoot);
  config.providerEnvPath = resolve(config.providerEnvPath);
  for (const field of ["toolchainBin", "chromePath", "libraryPath"]) {
    if (!path.posix.isAbsolute(config.wsl[field]) || config.wsl[field].includes("\\")
      || config.wsl[field].split("/").includes("..")) throw new Error("Candidate WSL runtime paths must be absolute Linux paths.");
  }
  for (const [label, root] of Object.entries(config.roots)) config.roots[label] = resolve(root);
  for (const label of ["artifacts", "fixtures", "ledger"]) {
    assertCandidatePathWithin(config.workspaceRoot, config.roots[label]);
  }
  assertCandidatePathWithin(options.systemTempRoot ?? os.tmpdir(), config.roots.state);
  const roots = Object.values(config.roots);
  for (let index = 0; index < roots.length; index += 1) {
    for (const other of roots.slice(index + 1)) {
      if (containsPath(roots[index], other) || containsPath(other, roots[index])) {
        throw new Error("Candidate output roots must be disjoint.");
      }
    }
    for (const harness of [config.windowsHarnessRoot, config.wsl.harnessRoot]) {
      if (containsPath(roots[index], harness) || containsPath(harness, roots[index])) {
        throw new Error("Candidate outputs must be outside the harness source tree.");
      }
    }
  }
  for (const file of [config.costBaseline, ...Object.values(config.repositoryConfigs)]) file.path = resolve(file.path);
  if (config.mode === "formal") {
    if (!config.contracts.expectedReportPlan || config.selection.length !== 144) {
      throw new Error("Formal candidate requires a frozen plan and 144 selected slots.");
    }
    config.contracts.expectedReportPlan.path = resolve(config.contracts.expectedReportPlan.path);
  } else if (config.contracts.expectedReportPlan !== null || config.selection.length > 12) {
    throw new Error("Exploration requires a preselected cohort of at most 12 slots and no formal plan.");
  }
  if (new Set(config.selection.map(candidateSlotKey)).size !== config.selection.length) {
    throw new Error("Candidate selection contains duplicate slots.");
  }
  return config;
}

export async function loadCodingAgentCandidateConfig(configPath) {
  const text = await readCandidateFile(configPath, 1024 * 1024);
  let input;
  try { input = JSON.parse(text); } catch { throw new Error("Candidate runner configuration is not valid JSON."); }
  const config = await validateCodingAgentCandidateConfig(input);
  return { config, configSha256: candidateSha256(JSON.stringify(config)) };
}

export function candidateSlotKey(slot) {
  return `${slot.taskId}.${slot.platform}.a${slot.attempt}`;
}

export function candidateSha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function readCandidateFile(filePath, maxBytes = 16 * 1024 * 1024) {
  await assertCandidateOrdinaryPath(filePath);
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.size > maxBytes) throw new Error("Candidate input must be a bounded ordinary file.");
  return fs.readFile(filePath, "utf8");
}

export async function assertCandidateOrdinaryPath(target, allowMissing = false) {
  let current = path.resolve(target);
  while (true) {
    const stats = await fs.lstat(current).catch((error) => {
      if (allowMissing && error.code === "ENOENT") return null;
      throw error;
    });
    if (stats?.isSymbolicLink()) throw new Error("Candidate paths must not traverse a link or reparse point.");
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function assertCandidatePathWithin(root, target) {
  if (path.resolve(root) === path.resolve(target) || !containsPath(root, target)) {
    throw new Error("Candidate path escaped its allowed root.");
  }
}

function containsPath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
