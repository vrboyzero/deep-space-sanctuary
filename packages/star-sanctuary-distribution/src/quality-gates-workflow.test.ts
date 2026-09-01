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

function readDependabotConfig(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, ".github", "dependabot.yml"), "utf-8");
}

function readWorkflowJob(workflow: string, jobName: string): string {
  const normalized = workflow.replace(/\r\n/g, "\n");
  const marker = `  ${jobName}:\n`;
  const start = normalized.indexOf(marker);
  if (start < 0) {
    throw new Error(`Workflow job not found: ${jobName}`);
  }
  const afterMarker = normalized.slice(start + marker.length);
  const nextJobOffset = afterMarker.search(/^  [a-zA-Z0-9_-]+:\n/m);
  return nextJobOffset < 0
    ? normalized.slice(start)
    : normalized.slice(start, start + marker.length + nextJobOffset);
}

function readDockerfile(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, "Dockerfile"), "utf-8");
}

function readDockerignore(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, ".dockerignore"), "utf-8");
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

test("quality gate pins every remote action to a full commit SHA", () => {
  const workflow = readQualityGatesWorkflow();
  const actionRefs = Array.from(workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm), (match) => match[1]);

  expect(actionRefs.length).toBeGreaterThan(0);
  for (const actionRef of actionRefs) {
    expect(actionRef).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
});

test("quality gate verifies coding CI compatibility on Windows and Linux", () => {
  const workflow = readQualityGatesWorkflow();
  const codingCiJob = readWorkflowJob(workflow, "coding-ci-contract");

  expect(codingCiJob).toContain("runs-on: ${{ matrix.os }}");
  expect(codingCiJob).toContain("ubuntu-latest");
  expect(codingCiJob).toContain("windows-latest");
  expect(codingCiJob).toContain("persist-credentials: false");
  expect(codingCiJob).toContain("run: pnpm build");
  expect(codingCiJob).toContain("run: pnpm verify:coding-ci");
  expect(codingCiJob).not.toMatch(/\b(?:contents|packages|actions|attestations|id-token): write\b/);
});

test("coding CI lanes retain native reports and receipts after trustworthy test failures", () => {
  const workflow = readQualityGatesWorkflow();
  const codingCiJob = readWorkflowJob(workflow, "coding-ci-contract");
  const rootPackage = readRootPackageJson();

  expect(rootPackage.scripts?.["verify:coding-run-client"]).toMatch(
    /--reporter=json --outputFile=artifacts\/coding-run-client-ci\/vitest-report\.json$/,
  );
  expect(codingCiJob).toMatch(
    /name: Verify coding-run client conformance\s+id: coding-run-client-verification\s+run: pnpm verify:coding-run-client/,
  );
  expect(codingCiJob).toMatch(
    /name: Produce coding-run client CI lane receipt\s+if: always\(\) && github\.event_name != 'pull_request'\s+run: >-\s+node --import tsx scripts\/run-coding-run-client-ci-lane-receipt\.mjs/,
  );
  expect(codingCiJob).toContain("--report artifacts/coding-run-client-ci/vitest-report.json");
  expect(codingCiJob).toContain("--output artifacts/coding-run-client-ci/lane-receipt.json");
  expect(codingCiJob).toContain("--platform ${{ matrix.os }}");
  expect(codingCiJob).toContain(
    "--test-outcome ${{ steps.coding-run-client-verification.outcome }}",
  );
  expect(codingCiJob).toMatch(
    /name: Upload coding-run client CI evidence\s+if: always\(\) && github\.event_name != 'pull_request'\s+uses: actions\/upload-artifact@[0-9a-f]{40}/,
  );
  expect(codingCiJob).toContain("name: coding-run-client-ci-${{ matrix.os }}");
  expect(codingCiJob).toMatch(
    /path: \|\s+artifacts\/coding-run-client-ci\/lane-receipt\.json\s+artifacts\/coding-run-client-ci\/vitest-report\.json/,
  );
  expect(codingCiJob).toContain("if-no-files-found: error");

  const verificationIndex = codingCiJob.indexOf("name: Verify coding-run client conformance");
  const producerIndex = codingCiJob.indexOf("name: Produce coding-run client CI lane receipt");
  const uploadIndex = codingCiJob.indexOf("name: Upload coding-run client CI evidence");
  expect(verificationIndex).toBeGreaterThan(-1);
  expect(producerIndex).toBeGreaterThan(verificationIndex);
  expect(uploadIndex).toBeGreaterThan(producerIndex);
  expect(codingCiJob.slice(verificationIndex, producerIndex)).not.toContain("continue-on-error");
});

test("Docker workflow grants repository write permission only to the GitHub Release job", () => {
  const workflow = readDockerWorkflow();
  const buildAndTestJob = readWorkflowJob(workflow, "build-and-test");
  const dockerHubPublishJob = readWorkflowJob(workflow, "publish");
  const githubReleaseJob = readWorkflowJob(workflow, "release");
  const windowsAssetsJob = readWorkflowJob(workflow, "release-windows-assets");

  for (const job of [buildAndTestJob, dockerHubPublishJob, windowsAssetsJob]) {
    expect(job).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(job).not.toMatch(/\b(?:contents|packages|actions|attestations|id-token): write\b/);
  }
  expect(githubReleaseJob).toMatch(/permissions:\s*\n\s+contents: write/);
  expect(githubReleaseJob).not.toMatch(/\b(?:packages|actions|attestations|id-token): write\b/);
});

test("Docker workflow pins every remote action to a full commit SHA", () => {
  const workflow = readDockerWorkflow();
  const actionRefs = Array.from(workflow.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm), (match) => match[1]);

  expect(actionRefs.length).toBeGreaterThan(0);
  for (const actionRef of actionRefs) {
    expect(actionRef).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
});

test("Dependabot keeps pinned GitHub Actions on a bounded weekly update path", () => {
  const config = readDependabotConfig();
  const githubActionsOwners = config.match(/package-ecosystem:\s*["']github-actions["']/g) ?? [];

  expect(config).toMatch(/^version:\s*2\s*$/m);
  expect(githubActionsOwners).toHaveLength(1);
  expect(config).toMatch(/directory:\s*["']\/["']/);
  expect(config).toMatch(/interval:\s*["']weekly["']/);
  expect(config).toMatch(/open-pull-requests-limit:\s*5\s*$/m);
});

test("Docker publishers share a full workspace test gate before image construction", () => {
  const workflow = readDockerWorkflow();
  const buildAndTestJob = readWorkflowJob(workflow, "build-and-test");
  const dockerHubPublishJob = readWorkflowJob(workflow, "publish");
  const githubReleaseJob = readWorkflowJob(workflow, "release");

  expect(buildAndTestJob).toContain(
    "uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa",
  );
  expect(buildAndTestJob).toContain("version: 10.23.0");
  expect(buildAndTestJob).toContain(
    "uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  );
  expect(buildAndTestJob).toContain("node-version: 22");

  const installIndex = buildAndTestJob.indexOf("run: pnpm install --frozen-lockfile");
  const buildIndex = buildAndTestJob.indexOf("run: pnpm build");
  const testIndex = buildAndTestJob.indexOf("run: pnpm test");
  const imageBuildIndex = buildAndTestJob.indexOf("- name: Build Docker image (test)");
  expect(installIndex).toBeGreaterThan(-1);
  expect(buildIndex).toBeGreaterThan(installIndex);
  expect(testIndex).toBeGreaterThan(buildIndex);
  expect(imageBuildIndex).toBeGreaterThan(testIndex);
  expect(dockerHubPublishJob).toContain("needs: build-and-test");
  expect(githubReleaseJob).toContain("needs: build-and-test");
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

test("Docker context excludes TypeScript outputs and incremental build state", () => {
  const patterns = readDockerignore()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  expect(patterns).toContain("**/dist");
  expect(patterns).toContain("**/*.tsbuildinfo");
});

test("Dockerfile pins every external base image to a readable tag and manifest digest", () => {
  const dockerfile = readDockerfile();
  const declaredStages = new Set<string>();
  const externalBaseImages: string[] = [];

  for (const match of dockerfile.matchAll(/^FROM\s+(\S+)\s+AS\s+(\S+)\s*$/gm)) {
    const [, imageRef, stageName] = match;
    if (!declaredStages.has(imageRef)) {
      externalBaseImages.push(imageRef);
    }
    declaredStages.add(stageName);
  }

  expect(externalBaseImages).toHaveLength(2);
  for (const imageRef of externalBaseImages) {
    expect(imageRef).toMatch(/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/);
  }
});

test("Docker dependency stages copy pnpm patches before frozen installs", () => {
  const dockerfile = readDockerfile();
  const depsStart = dockerfile.indexOf("FROM base AS deps");
  const builderStart = dockerfile.indexOf("FROM base AS builder");
  const runtimeStart = dockerfile.indexOf(
    "FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime",
  );

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

test("release jobs use the explicit clean BuildGraph without changing ordinary CI builds", () => {
  const workflow = readDockerWorkflow();
  const rootPackage = readRootPackageJson();
  const buildAndTestJob = readWorkflowJob(workflow, "build-and-test");
  const releaseJob = readWorkflowJob(workflow, "release");
  const windowsReleaseJob = readWorkflowJob(workflow, "release-windows-assets");

  expect(rootPackage.scripts?.["build:release"]).toBe("pnpm run rebuild");
  expect(buildAndTestJob).toContain("run: pnpm build");
  expect(buildAndTestJob).not.toContain("run: pnpm build:release");
  expect(releaseJob).toContain("run: pnpm build:release");
  expect(windowsReleaseJob).toContain("run: pnpm build:release");
  expect(workflow.match(/run: pnpm build:release$/gm)).toHaveLength(2);
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
    descriptionStep.indexOf(
      "uses: peter-evans/dockerhub-description@432a30c9e07499fd01da9f8a49f0faf9e0ca5b77",
    ),
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
  const portablePrefetchIndex = workflow.indexOf("pnpm prefetch:portable");
  const portableBuildIndex = workflow.indexOf("pnpm build:portable");
  const relayProbeIndex = workflow.indexOf("pnpm verify:portable-artifacts");
  const portableSmokeIndex = workflow.indexOf("pnpm smoke:portable");
  const wingetBuildIndex = workflow.indexOf("pnpm build:winget");

  expect(portablePrefetchIndex).toBeGreaterThan(-1);
  expect(portableBuildIndex).toBeGreaterThan(portablePrefetchIndex);
  expect(relayProbeIndex).toBeGreaterThan(portableBuildIndex);
  expect(portableSmokeIndex).toBeGreaterThan(relayProbeIndex);
  expect(wingetBuildIndex).toBeGreaterThan(portableSmokeIndex);
});
