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

function readDockerfile(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf-8");
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
  expect(workflow).toContain("name: Generate workspace version metadata");
  expect(workflow).toContain("run: pnpm version:generate");
  expect(workflow).toContain("pnpm benchmark:build");
  expect(workflow).toContain("--output artifacts/benchmarks/b00-build.json");
  expect(workflow).toContain("--warmup-runs 1");
  expect(workflow).toContain("--sample-runs 3");
  expect(workflow).toContain("name: b00-build-benchmark");
  expect(workflow).toContain("path: artifacts/benchmarks/b00-build.json");
  expect(workflow).toMatch(/name: Upload B00 build benchmark\s+if: always\(\)/);
  expect(workflow).not.toContain("--max-duration-ms");
});

test("Docker runtime starts the built CLI without invoking the dev-only asset builder", () => {
  const dockerfile = readDockerfile();

  expect(dockerfile).toContain('CMD ["node", "packages/belldandy-core/dist/bin/bdd.js", "start"]');
  expect(dockerfile).not.toContain('CMD ["pnpm", "start"]');
});

test("Docker dependency stages copy pnpm patches before frozen installs", () => {
  const dockerfile = readDockerfile();
  const depsStart = dockerfile.indexOf("FROM base AS deps");
  const builderStart = dockerfile.indexOf("FROM base AS builder");
  const runtimeStart = dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime");

  expect(depsStart).toBeGreaterThan(-1);
  expect(builderStart).toBeGreaterThan(depsStart);
  expect(runtimeStart).toBeGreaterThan(builderStart);

  for (const stage of [
    dockerfile.slice(depsStart, builderStart),
    dockerfile.slice(builderStart, runtimeStart),
  ]) {
    const patchCopyIndex = stage.indexOf("COPY patches ./patches");
    const frozenInstallIndex = stage.indexOf("pnpm install --frozen-lockfile");

    expect(patchCopyIndex).toBeGreaterThan(-1);
    expect(frozenInstallIndex).toBeGreaterThan(patchCopyIndex);
  }
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

test("tag release-light stays independent from Docker Hub publishing while Windows assets remain opt-in", () => {
  const workflow = readDockerWorkflow().replace(/\r\n/g, "\n");
  const publishStart = workflow.indexOf("  publish:\n");
  const releaseStart = workflow.indexOf("  release:\n");
  const windowsReleaseStart = workflow.indexOf("  release-windows-assets:\n");

  expect(publishStart).toBeGreaterThan(-1);
  expect(releaseStart).toBeGreaterThan(publishStart);
  expect(windowsReleaseStart).toBeGreaterThan(releaseStart);

  const publishJob = workflow.slice(publishStart, releaseStart);
  const releaseJob = workflow.slice(releaseStart, windowsReleaseStart);
  const windowsReleaseJob = workflow.slice(windowsReleaseStart);
  const descriptionStep = publishJob.slice(
    publishJob.indexOf("- name: Update Docker Hub description"),
  );

  // Docker Hub README synchronization needs an optional Delete scope; image publishing must not depend on it.
  expect(descriptionStep).toContain("continue-on-error: true");
  expect(descriptionStep.indexOf("continue-on-error: true")).toBeLessThan(
    descriptionStep.indexOf("uses: peter-evans/dockerhub-description@v4"),
  );
  expect(releaseJob).toContain("needs: build-and-test");
  expect(releaseJob).not.toContain("needs: publish");
  expect(releaseJob).toContain("Docker image publishing runs independently");
  expect(windowsReleaseJob).toContain("needs: release");
  expect(windowsReleaseJob).toContain(
    "if: startsWith(github.ref, 'refs/tags/v') && vars.ENABLE_WINDOWS_PACKAGING == 'true'",
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
