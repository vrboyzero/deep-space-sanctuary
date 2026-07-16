import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

function readQualityGatesWorkflow(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(
    path.join(workspaceRoot, ".github", "workflows", "quality-gates.yml"),
    "utf-8",
  );
}

function readDockerWorkflow(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(
    path.join(workspaceRoot, ".github", "workflows", "docker.yml"),
    "utf-8",
  );
}

function readRootPackageJson(): Record<string, any> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, "package.json"), "utf-8"));
}

test("quality gate builds the workspace and runs the full test suite on pull requests", () => {
  const workflow = readQualityGatesWorkflow();

  expect(workflow).toContain("name: Quality Gates");
  expect(workflow).toMatch(/pull_request:\s*\n\s+branches:\s*\n\s+- main/);
  expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
  expect(workflow).toContain("name: Build and full test suite");
  expect(workflow).toContain("version: 10.23.0");
  expect(workflow).toContain("node-version: 22");
  expect(workflow).toContain("run: pnpm install --frozen-lockfile");
  expect(workflow).toContain("run: pnpm build");
  expect(workflow).toContain("run: pnpm test");
});

test("quality gate exposes stable WebChat, CSP/Trusted Types, and Distribution contract checks", () => {
  const workflow = readQualityGatesWorkflow();
  const rootPackage = readRootPackageJson();

  expect(workflow).toContain("webchat-contract:");
  expect(workflow).toContain("name: WebChat 123-file contract");
  expect(workflow).toContain("name: Install dependencies");
  expect(workflow).toContain("run: pnpm verify:webchat");
  expect(rootPackage.scripts?.["verify:webchat:security"]).toBe(
    "node scripts/verify-webchat-security-policy.mjs",
  );
  expect(workflow).toContain("name: Verify WebChat CSP and Trusted Types fixtures");
  expect(workflow).toContain("run: pnpm verify:webchat:security");
  expect(workflow).toContain("distribution-contract:");
  expect(workflow).toContain("name: Distribution contract");
  expect(workflow).toContain("pnpm exec vitest run");

  for (const fixture of [
    "artifact-contract.test.ts",
    "bootstrap-auth-token.test.ts",
    "env.test.ts",
    "gateway-preflight.test.ts",
    "install-script-wrappers.test.ts",
    "portable-artifact-contract.test.ts",
    "portable-runtime.test.ts",
    "release-light-assets.test.ts",
    "runtime-paths.test.ts",
    "sandbox-paths.test.ts",
  ]) {
    expect(workflow).toContain(`packages/star-sanctuary-distribution/src/${fixture}`);
  }
});

test("quality gate runs a pinned OSV scanner against fixtures and the repository in report-only mode", () => {
  const workflow = readQualityGatesWorkflow();

  expect(workflow).toContain("dependency-audit-report:");
  expect(workflow).toContain("name: Dependency audit report");
  expect(workflow).toContain(
    "google/osv-scanner-action/osv-scanner-action@9a498708959aeaef5ef730655706c5a1df1edbc2",
  );
  expect(workflow).toContain("fixtures/osv/clean/package-lock.json");
  expect(workflow).toContain("fixtures/osv/vulnerable/package-lock.json");
  expect(workflow).toContain("--lockfile=pnpm-lock.yaml");
  expect(workflow).toContain("node scripts/normalize-osv-report.mjs");
  expect(workflow).toContain("--expect-status zero_findings");
  expect(workflow).toContain("--expect-status findings_present");
  expect(workflow).toContain("--require-vulnerability GHSA-vh95-rmgr-6w4m");
  expect(workflow).toContain("continue-on-error: true");
  expect(workflow).toContain("name: dependency-audit-report");
});

test("dependency audit workflow records scanner failures and enforces a fresh gate decision", () => {
  const workflow = readQualityGatesWorkflow();

  expect(workflow).toContain("--record-failure true");
  expect(workflow).toContain("name: Enforce dependency audit gate");
  expect(workflow).toContain("node scripts/evaluate-dependency-audit-gate.mjs");
  expect(workflow).toContain("--input artifacts/dependency-audit/repository.normalized.json");
  expect(workflow).toContain("--output artifacts/dependency-audit/repository.gate.json");
  expect(workflow).toContain("--max-age-hours 24");
  expect(workflow).toMatch(/name: Upload dependency audit report\s+if: always\(\)/);
});

test("quality gate publishes a report-only B00 build benchmark without performance thresholds", () => {
  const workflow = readQualityGatesWorkflow();
  const rootPackage = readRootPackageJson();

  expect(rootPackage.scripts?.["benchmark:build"]).toBe("node scripts/run-build-benchmark.mjs");
  expect(workflow).toContain("build-benchmark-report:");
  expect(workflow).toContain("name: B00 build benchmark report");
  expect(workflow).toContain("pnpm benchmark:build");
  expect(workflow).toContain("--output artifacts/benchmarks/b00-build.json");
  expect(workflow).toContain("--warmup-runs 1");
  expect(workflow).toContain("--sample-runs 3");
  expect(workflow).toContain("name: b00-build-benchmark");
  expect(workflow).toContain("path: artifacts/benchmarks/b00-build.json");
  expect(workflow).toMatch(/name: Upload B00 build benchmark\s+if: always\(\)/);
  expect(workflow).not.toContain("--max-duration-ms");
});

test("tag release forwards its resolved version to release-light build and verification", () => {
  const workflow = readDockerWorkflow();

  expect(workflow).toContain(
    "run: pnpm build:release-light -- --version=${{ steps.version.outputs.VERSION }}",
  );
  expect(workflow).toContain(
    "run: pnpm verify:release-light -- --version=${{ steps.version.outputs.VERSION }}",
  );
});

test("tag release probes the packaged portable Relay before winget staging", () => {
  const workflow = readDockerWorkflow();
  const rootPackage = readRootPackageJson();

  expect(rootPackage.scripts?.["verify:portable-artifacts"]).toBe(
    "node packages/star-sanctuary-distribution/scripts/verify-portable-artifacts.mjs",
  );
  const portableBuildIndex = workflow.indexOf("pnpm build:portable");
  const relayProbeIndex = workflow.indexOf("pnpm verify:portable-artifacts");
  const portableSmokeIndex = workflow.indexOf("pnpm smoke:portable");
  const wingetBuildIndex = workflow.indexOf("pnpm build:winget");

  expect(portableBuildIndex).toBeGreaterThan(-1);
  expect(relayProbeIndex).toBeGreaterThan(portableBuildIndex);
  expect(portableSmokeIndex).toBeGreaterThan(relayProbeIndex);
  expect(wingetBuildIndex).toBeGreaterThan(portableSmokeIndex);
});
