import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE,
  CODING_AGENT_BENCHMARK_MANIFEST_VERSION,
  CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_VERSION,
  CODING_AGENT_BENCHMARK_REPORT_V2_VERSION,
  CODING_AGENT_BENCHMARK_RUN_VERSION,
  CODING_AGENT_BENCHMARK_RUN_V2_VERSION,
  loadCodingAgentBenchmarkManifest,
} from "./coding-agent-benchmark-contract.mjs";
import { resolveCodingCiProfile } from "./run-coding-agent-ci.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function collectCodingAgentBenchmarkContractFailures(input = {}) {
  const workspaceRoot = input.workspaceRoot
    ? path.resolve(input.workspaceRoot)
    : path.resolve(path.dirname(scriptPath), "..");
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
  const manifestPath = "benchmarks/coding-agent/v1/task-manifest.json";
  const manifest = await readJson(manifestPath);
  const manifestSchema = await readJson("benchmarks/coding-agent/v1/task-manifest.schema.json");
  const runSchema = await readJson("benchmarks/coding-agent/v1/benchmark-run.schema.json");
  const reportSchema = await readJson("benchmarks/coding-agent/v1/benchmark-report.schema.json");
  const faultSchema = await readJson("benchmarks/coding-agent/v1/fault-injection.schema.json");
  const cancelSchema = await readJson("benchmarks/coding-agent/v1/cancel-injection.schema.json");
  const restartSchema = await readJson("benchmarks/coding-agent/v1/restart-injection.schema.json");
  const manifestV2Path = "benchmarks/coding-agent/v2/task-manifest.json";
  const manifestV2 = await readJson(manifestV2Path);
  const benchmarkAgentsV2 = await readJson("benchmarks/coding-agent/v2/agents.json");
  const manifestV2Schema = await readJson("benchmarks/coding-agent/v2/task-manifest.schema.json");
  const runV2Schema = await readJson("benchmarks/coding-agent/v2/benchmark-run.schema.json");
  const reportV2Schema = await readJson("benchmarks/coding-agent/v2/benchmark-report.schema.json");
  const preflightSchema = await readJson("benchmarks/coding-agent/v2/preflight.schema.json");
  const approvalContractSchema = await readJson("benchmarks/coding-agent/v2/approval-contract.schema.json");
  const approvalEvidenceSchema = await readJson("benchmarks/coding-agent/v2/approval-evidence.schema.json");
  const faultV2Schema = await readJson("benchmarks/coding-agent/v2/fault-injection.schema.json");
  const cancelV2Schema = await readJson("benchmarks/coding-agent/v2/cancel-injection.schema.json");
  const restartV2Schema = await readJson("benchmarks/coding-agent/v2/restart-injection.schema.json");
  const readme = await readText("benchmarks/coding-agent/README.md");
  await readText("scripts/coding-agent-benchmark-fixtures.mjs");
  await readText("scripts/coding-agent-benchmark-approval.mjs");
  await readText("scripts/coding-agent-benchmark-preflight.mjs");
  await readText("scripts/coding-agent-recovery-harness.mjs");
  await readText("scripts/coding-agent-process-restart-harness.mjs");
  await readText("scripts/coding-agent-process-restart-gateway.mjs");
  await readText("scripts/aggregate-coding-agent-benchmark.mjs");
  await readText("scripts/run-coding-agent-benchmark.mjs");
  await readText("scripts/run-coding-agent-benchmark-wsl.mjs");
  const projectMap = await readText("docs/project-map.md");
  const qualityGates = await readText(".github/workflows/quality-gates.yml");

  if (manifest) {
    try {
      await loadCodingAgentBenchmarkManifest(path.join(workspaceRoot, manifestPath));
    } catch (error) {
      failures.push(`coding benchmark manifest failed semantic validation: ${safeMessage(error)}`);
    }
  }
  if (manifestV2) {
    try {
      await loadCodingAgentBenchmarkManifest(path.join(workspaceRoot, manifestV2Path));
    } catch (error) {
      failures.push(`coding benchmark v2 manifest failed semantic validation: ${safeMessage(error)}`);
    }
  }
  validateSchema(failures, "task manifest", manifestSchema, manifest);
  validateSchema(failures, "benchmark run", runSchema);
  validateSchema(failures, "benchmark report", reportSchema);
  validateSchema(failures, "fault injection", faultSchema);
  validateSchema(failures, "cancel injection", cancelSchema);
  validateSchema(failures, "restart injection", restartSchema);
  validateSchema(failures, "v2 task manifest", manifestV2Schema, manifestV2);
  validateSchema(failures, "v2 benchmark run", runV2Schema);
  validateSchema(failures, "v2 benchmark report", reportV2Schema);
  validateSchema(failures, "v2 preflight", preflightSchema);
  validateSchema(failures, "v2 approval contract", approvalContractSchema);
  validateSchema(failures, "v2 approval evidence", approvalEvidenceSchema);
  validateSchema(failures, "v2 fault injection", faultV2Schema);
  validateSchema(failures, "v2 cancel injection", cancelV2Schema);
  validateSchema(failures, "v2 restart injection", restartV2Schema);
  if (JSON.stringify(benchmarkAgentsV2) !== JSON.stringify({
    agents: [CODING_AGENT_BENCHMARK_COMMAND_CONTROL_AGENT_PROFILE],
  })) {
    failures.push("v2 benchmark Agent profile drifted from the isolated command-control contract.");
  }

  if (manifestSchema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_MANIFEST_VERSION) {
    failures.push("task manifest Schema version drifted from the public contract.");
  }
  if (runSchema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_RUN_VERSION) {
    failures.push("benchmark run Schema version drifted from the public contract.");
  }
  if (reportSchema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_REPORT_VERSION) {
    failures.push("benchmark report Schema version drifted from the public contract.");
  }
  if (manifestV2Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_MANIFEST_V2_VERSION) {
    failures.push("v2 task manifest Schema version drifted from the corrected contract.");
  }
  if (runV2Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_RUN_V2_VERSION) {
    failures.push("v2 benchmark run Schema version drifted from the corrected contract.");
  }
  if (reportV2Schema?.properties?.schemaVersion?.const !== CODING_AGENT_BENCHMARK_REPORT_V2_VERSION) {
    failures.push("v2 benchmark report Schema version drifted from the corrected contract.");
  }
  if (packageJson?.scripts?.["verify:coding-benchmark"]
    !== "node --import tsx scripts/verify-coding-agent-benchmark-contract.mjs") {
    failures.push("package.json must expose verify:coding-benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0b"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native") {
    failures.push("package.json must expose benchmark:coding-agent:stage0b.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs") {
    failures.push("package.json must expose benchmark:coding-agent:stage0c:wsl.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:interactive:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id command.interactive-control") {
    failures.push("package.json must expose the Windows interactive-control benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:interactive:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id command.interactive-control") {
    failures.push("package.json must expose the WSL2 interactive-control benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:safety:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id safety.boundary-enforcement") {
    failures.push("package.json must expose the Windows safety-boundary benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:safety:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id safety.boundary-enforcement") {
    failures.push("package.json must expose the WSL2 safety-boundary benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:recovery:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.disconnect-recovery") {
    failures.push("package.json must expose the Windows gateway-recovery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:recovery:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.disconnect-recovery") {
    failures.push("package.json must expose the WSL2 gateway-recovery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:cancel:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.client-cancel") {
    failures.push("package.json must expose the Windows client-cancel benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:cancel:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.client-cancel") {
    failures.push("package.json must expose the WSL2 client-cancel benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:restart:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id gateway.process-restart") {
    failures.push("package.json must expose the Windows Gateway process-restart benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:restart:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id gateway.process-restart") {
    failures.push("package.json must expose the WSL2 Gateway process-restart benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:git:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id git.dirty-worktree,git.delivery-guard") {
    failures.push("package.json must expose the Windows Git local-delivery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0c:git:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id git.dirty-worktree,git.delivery-guard") {
    failures.push("package.json must expose the WSL2 Git local-delivery benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0d:core:windows"]
    !== "node scripts/run-coding-agent-benchmark.mjs --platform windows-native --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository") {
    failures.push("package.json must expose the Windows Stage 0D core benchmark.");
  }
  if (packageJson?.scripts?.["benchmark:coding-agent:stage0d:core:wsl"]
    !== "node scripts/run-coding-agent-benchmark-wsl.mjs --task-id feature.cross-file,tests.failed-diagnosis,navigation.large-repository") {
    failures.push("package.json must expose the WSL2 Stage 0D core benchmark.");
  }
  if (packageJson?.scripts?.["aggregate:coding-agent:baseline"]
    !== "node scripts/aggregate-coding-agent-benchmark.mjs") {
    failures.push("package.json must expose the Stage 0D baseline aggregator.");
  }
  if (manifest) validateRunnerProfiles(failures, manifest, "v1");
  if (manifestV2) validateRunnerProfiles(failures, manifestV2, "v2");
  for (const requiredText of [
    "coding-agent-benchmark-manifest/v1",
    "coding-agent-benchmark-run/v1",
    "coding-agent-benchmark-report/v1",
    "coding-agent-benchmark-manifest/v2",
    "coding-agent-benchmark-run/v2",
    "coding-agent-benchmark-report/v2",
    "--manifest-revision v2",
    "--source-root",
    "preflight.json",
    "v2/agents.json",
    "taskBudgetOverrides",
    "maxTokens=36000",
    "maxHighRiskToolCalls=5",
    "approval-contract.json",
    "approval-evidence.json",
    "阶段 0A",
    "阶段 0B",
    "benchmark:coding-agent:stage0b",
    "benchmark:coding-agent:stage0c:wsl",
    "benchmark:coding-agent:stage0c:interactive:windows",
    "benchmark:coding-agent:stage0c:interactive:wsl",
    "benchmark:coding-agent:stage0c:safety:windows",
    "benchmark:coding-agent:stage0c:safety:wsl",
    "benchmark:coding-agent:stage0c:recovery:windows",
    "benchmark:coding-agent:stage0c:recovery:wsl",
    "benchmark:coding-agent:stage0c:cancel:windows",
    "benchmark:coding-agent:stage0c:cancel:wsl",
    "benchmark:coding-agent:stage0c:restart:windows",
    "benchmark:coding-agent:stage0c:restart:wsl",
    "benchmark:coding-agent:stage0c:git:windows",
    "benchmark:coding-agent:stage0c:git:wsl",
    "benchmark:coding-agent:stage0d:core:windows",
    "benchmark:coding-agent:stage0d:core:wsl",
    "aggregate:coding-agent:baseline",
    "baseline-index.json",
    "command.interactive-control",
    "safety.boundary-enforcement",
    "gateway.disconnect-recovery",
    "gateway.client-cancel",
    "gateway.process-restart",
    "git.dirty-worktree",
    "git.delivery-guard",
    "feature.cross-file",
    "tests.failed-diagnosis",
    "navigation.large-repository",
    "git-local",
    "fault-injection.json",
    "cancel-injection.json",
    "restart-injection.json",
    "CODING_BENCHMARK_EVENTS_PATH",
    "BELLDANDY_DANGEROUS_TOOLS_ENABLED=true",
    "--prior-observed-cost-usd",
    "WSLENV",
    "回退到 primary",
    "coding-agent-benchmark-fixtures.mjs",
    "工作区外",
  ]) {
    if (!readme.includes(requiredText)) {
      failures.push(`coding benchmark README must document ${requiredText}.`);
    }
  }
  for (const requiredPath of [
    "benchmarks/coding-agent/v1/",
    "benchmarks/coding-agent/v2/",
    "benchmarks/coding-agent/v2/agents.json",
    "scripts/coding-agent-benchmark-contract.mjs",
    "scripts/coding-agent-benchmark-fixtures.mjs",
    "scripts/coding-agent-benchmark-approval.mjs",
    "scripts/coding-agent-benchmark-preflight.mjs",
    "scripts/coding-agent-recovery-harness.mjs",
    "scripts/coding-agent-process-restart-harness.mjs",
    "scripts/coding-agent-process-restart-gateway.mjs",
    "scripts/aggregate-coding-agent-benchmark.mjs",
    "scripts/run-coding-agent-benchmark.mjs",
    "scripts/run-coding-agent-benchmark-wsl.mjs",
    "scripts/verify-coding-agent-benchmark-contract.mjs",
  ]) {
    if (!projectMap.includes(requiredPath)) {
      failures.push(`docs/project-map.md must describe ${requiredPath}.`);
    }
  }
  if (!qualityGates.includes("run: pnpm verify:coding-benchmark")) {
    failures.push("quality-gates.yml must run pnpm verify:coding-benchmark.");
  }
  if (!qualityGates.includes("matrix.os")
    || !qualityGates.includes("windows-latest")
    || !qualityGates.includes("ubuntu-latest")) {
    failures.push("coding benchmark contract must be gated on both Windows and Linux runners.");
  }

  return failures;
}

function validateRunnerProfiles(failures, manifest, revision) {
  for (const mode of ["plan", "navigation-read", "workspace-write", "command-control", "safety-probe", "recovery-control", "git-local"]) {
    const actual = resolveCodingCiProfile(mode, revision);
    const expected = manifest.suite?.executionProfiles?.[mode];
    const expectedToolDeny = mode === "command-control" || mode === "safety-probe"
      ? ["spawn_subagent"]
      : mode === "recovery-control"
        ? ["run_command", "spawn_subagent", "file_delete"]
        : mode === "git-local"
          ? ["spawn_subagent", "apply_patch", "file_write", "file_delete"]
        : ["run_command", "spawn_subagent"];
    const actualToolDeny = actual.toolDeny ?? (actual.toolAllow.includes("run_command")
      ? ["spawn_subagent"]
      : ["run_command", "spawn_subagent"]);
    if (actual.permissionMode !== expected?.permissionMode
      || actual.agentId !== expected?.agentId
      || actual.maxHighRiskToolCalls !== expected?.maxHighRiskToolCalls
      || JSON.stringify(actual.toolAllow) !== JSON.stringify(expected?.toolAllow)
      || JSON.stringify(actualToolDeny) !== JSON.stringify(expectedToolDeny)
      || JSON.stringify(expected?.toolDeny) !== JSON.stringify(expectedToolDeny)) {
      failures.push(`Coding benchmark ${mode} profile drifted from run-coding-agent-ci.mjs.`);
    }
  }
}

function validateSchema(failures, label, schema, sample) {
  if (!schema) return;
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) {
    failures.push(`${label} Schema does not compile: ${compiled.message}`);
    return;
  }
  if (sample) {
    const result = compiled.validator.validateOutput(JSON.stringify(sample));
    if (!result.ok) failures.push(`${label} does not accept its checked-in sample: ${result.message}`);
  }
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

async function main() {
  const failures = await collectCodingAgentBenchmarkContractFailures();
  if (failures.length === 0) {
    console.log("[verify:coding-benchmark] manifest, schemas, docs, and platform gates are aligned");
    return;
  }
  console.error("[verify:coding-benchmark] contract failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(scriptPath)) {
  main().catch((error) => {
    console.error(`[verify:coding-benchmark] failed: ${safeMessage(error)}`);
    process.exitCode = 1;
  });
}
