import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(
  workspaceRoot,
  "benchmarks",
  "coding-agent",
  "v3",
  "candidate-coding-run-client-ci-evidence-receipt.schema.json",
);
const laneSchemaPath = path.join(
  workspaceRoot,
  "benchmarks",
  "coding-agent",
  "v3",
  "coding-run-client-ci-lane-evidence.schema.json",
);

const testFiles = [
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
];

describe("coding agent candidate coding-run client CI evidence receipt", () => {
  it("freezes one current-candidate GitHub run across exact Ubuntu and Windows jobs without scoring", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const receipt = candidateCodingRunClientCiReceipt();
    expect(schema.properties.schemaVersion.const).toBe(
      "coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1",
    );
    expect(compiled.validator.validateOutput(JSON.stringify(receipt))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...receipt,
      numericScore: 9.5,
    }))).toMatchObject({ ok: false });

    const missingLane = structuredClone(receipt);
    missingLane.lanes.pop();
    expect(compiled.validator.validateOutput(JSON.stringify(missingLane))).toMatchObject({ ok: false });

    const reorderedLanes = structuredClone(receipt);
    reorderedLanes.lanes.reverse();
    expect(compiled.validator.validateOutput(JSON.stringify(reorderedLanes))).toMatchObject({ ok: false });

    const wrongStep = structuredClone(receipt);
    wrongStep.lanes[0].verificationStep.name = "Run a workflow-shaped substitute";
    expect(compiled.validator.validateOutput(JSON.stringify(wrongStep))).toMatchObject({ ok: false });

    const expiredArtifact = structuredClone(receipt);
    expiredArtifact.lanes[1].artifact.expired = true;
    expect(compiled.validator.validateOutput(JSON.stringify(expiredArtifact))).toMatchObject({ ok: false });

    const trustworthyFailure = structuredClone(receipt);
    trustworthyFailure.lanes[0].job.conclusion = "failure";
    trustworthyFailure.lanes[0].verificationStep.conclusion = "failure";
    expect(compiled.validator.validateOutput(JSON.stringify(trustworthyFailure)))
      .toMatchObject({ ok: true });
  });

  it("freezes the job-produced lane receipt before candidate aggregation", async () => {
    const schema = JSON.parse(await fs.readFile(laneSchemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const lane = codingRunClientCiLaneEvidence({
      platform: "ubuntu-latest",
      runnerOs: "Linux",
      reportSeed: "a",
    });
    expect(schema.properties.schemaVersion.const).toBe(
      "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1",
    );
    expect(compiled.validator.validateOutput(JSON.stringify(lane))).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...lane,
      github: { ...lane.github, runAttempt: 0 },
    }))).toMatchObject({ ok: false });

    const wrongRunner = structuredClone(lane);
    wrongRunner.runner.os = "Windows";
    expect(compiled.validator.validateOutput(JSON.stringify(wrongRunner))).toMatchObject({ ok: false });

    const failedReport = structuredClone(lane);
    failedReport.report.status = "failed";
    expect(compiled.validator.validateOutput(JSON.stringify(failedReport))).toMatchObject({ ok: true });
  });
});

function candidateCodingRunClientCiReceipt() {
  const harness = repositoryIdentity("e");
  return {
    schemaVersion:
      "coding-agent-benchmark-candidate-coding-run-client-ci-evidence-receipt/v1",
    generatedAt: "2026-09-01T13:30:00.000Z",
    aggregate: {
      manifestSha256: "a".repeat(64),
      reportSha256: "b".repeat(64),
      indexSha256: "c".repeat(64),
      source: repositoryIdentity("d"),
      harness,
    },
    provider: "github-actions",
    github: {
      repository: {
        id: 1182285910,
        fullName: "vrboyzero/deep-space-sanctuary",
        private: true,
      },
      workflow: {
        id: 314160461,
        name: "Quality Gates",
        path: ".github/workflows/quality-gates.yml",
      },
      run: {
        id: 33415964382,
        attempt: 1,
        event: "push",
        headBranch: "main",
        headSha: harness.commit,
        status: "completed",
        conclusion: "failure",
        createdAt: "2026-09-01T13:00:00.000Z",
        updatedAt: "2026-09-01T13:20:00.000Z",
        htmlUrl:
          "https://github.com/vrboyzero/deep-space-sanctuary/actions/runs/33415964382",
      },
      apiEvidence: {
        run: githubApiReference(
          "candidate-evidence/coding-run-client/ci/github-run.json",
          "1",
        ),
        jobs: githubApiReference(
          "candidate-evidence/coding-run-client/ci/github-jobs.json",
          "2",
        ),
        artifacts: githubApiReference(
          "candidate-evidence/coding-run-client/ci/github-artifacts.json",
          "3",
        ),
      },
    },
    lanes: [
      codingRunClientCiLane({
        platform: "ubuntu-latest",
        runnerOs: "Linux",
        jobId: 99566546813,
        reportSeed: "4",
        artifactId: 9768000001,
      }),
      codingRunClientCiLane({
        platform: "windows-latest",
        runnerOs: "Windows",
        jobId: 99566547216,
        reportSeed: "7",
        artifactId: 9768000002,
      }),
    ],
  };
}

function codingRunClientCiLane(input) {
  return {
    platform: input.platform,
    runnerOs: input.runnerOs,
    job: {
      id: input.jobId,
      name: `Coding CI contract (${input.platform})`,
      headSha: "e".repeat(40),
      status: "completed",
      conclusion: "success",
      startedAt: "2026-09-01T13:00:10.000Z",
      completedAt: "2026-09-01T13:05:00.000Z",
    },
    verificationStep: {
      number: 8,
      name: "Verify coding-run client conformance",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-09-01T13:03:00.000Z",
      completedAt: "2026-09-01T13:04:00.000Z",
    },
    uploadStep: {
      number: 9,
      name: "Upload coding-run client CI evidence",
      status: "completed",
      conclusion: "success",
      startedAt: "2026-09-01T13:04:00.000Z",
      completedAt: "2026-09-01T13:04:10.000Z",
    },
    artifact: {
      id: input.artifactId,
      name: `coding-run-client-ci-${input.platform}`,
      digest: `sha256:${input.reportSeed.repeat(64)}`,
      sizeInBytes: 4096,
      expired: false,
      createdAt: "2026-09-01T13:04:10.000Z",
      expiresAt: "2026-09-15T13:04:10.000Z",
      workflowRun: {
        id: 33415964382,
        repositoryId: 1182285910,
        headRepositoryId: 1182285910,
        headBranch: "main",
        headSha: "e".repeat(40),
      },
    },
    archive: {
      format: "zip",
      path: `candidate-evidence/coding-run-client/ci/${input.platform}/artifact.zip`,
      sha256: input.reportSeed.repeat(64),
    },
    laneReceipt: {
      artifactSchemaVersion:
        "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1",
      entry: "lane-receipt.json",
      sha256: nextSeed(input.reportSeed).repeat(64),
    },
    nativeTestReport: {
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      entry: "vitest-report.json",
      sha256: nextSeed(nextSeed(input.reportSeed)).repeat(64),
    },
    testFiles: [...testFiles],
  };
}

function codingRunClientCiLaneEvidence(input) {
  return {
    schemaVersion: "coding-agent-benchmark-coding-run-client-ci-lane-evidence/v1",
    generatedAt: "2026-09-01T13:04:00.000Z",
    command: "corepack pnpm verify:coding-run-client",
    github: {
      repositoryId: 1182285910,
      repository: "vrboyzero/deep-space-sanctuary",
      workflow: "Quality Gates",
      workflowRef:
        "vrboyzero/deep-space-sanctuary/.github/workflows/quality-gates.yml@refs/heads/main",
      job: "coding-ci-contract",
      runId: 33415964382,
      runAttempt: 1,
      sha: "e".repeat(40),
      ref: "refs/heads/main",
    },
    runner: {
      platform: input.platform,
      os: input.runnerOs,
      arch: "X64",
    },
    report: {
      status: "passed",
      framework: "vitest",
      format: "vitest-json/v3.2.7",
      runnerVersion: "3.2.7",
      path: "vitest-report.json",
      sha256: input.reportSeed.repeat(64),
      testFiles: [...testFiles],
    },
  };
}

function githubApiReference(artifactPath, seed) {
  return {
    format: "github-rest-json/2022-11-28",
    path: artifactPath,
    sha256: seed.repeat(64),
  };
}

function nextSeed(seed) {
  return ((Number.parseInt(seed, 16) + 1) % 16).toString(16);
}

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}
