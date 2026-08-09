import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

import {
  buildNavigationCandidateV2Prompt,
} from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";

import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION,
  buildNavigationCandidateV3Evidence,
  buildNavigationCandidateV3Profile,
  buildNavigationCandidateV3Prompt,
  parseNavigationCandidateV3CliArguments,
  runNavigationCandidateV3Preflight,
  writeNavigationCandidateV3Artifact,
} from "./run-coding-agent-benchmark-navigation-candidate-v3.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent navigation candidate v3 runtime-contract preflight", () => {
  it("upgrades the v2 navigation profile to an explicit runtime argument contract", () => {
    const profile = buildNavigationCandidateV3Profile(manifestFixture());
    const prompt = buildNavigationCandidateV3Prompt("Fix the frozen regression.");

    expect(profile).toMatchObject({
      id: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
      baseProfile: "workspace-write",
      permissionMode: "acceptEdits",
      toolAllow: [
        "file_read",
        "list_files",
        "text_search",
        "file_glob",
        "file_edit",
        "apply_patch",
        "file_write",
        "file_delete",
      ],
      toolDeny: ["run_command", "spawn_subagent"],
      toolArgumentPolicy: "bounded-navigation-v1",
      manifestModified: false,
      strategy: {
        id: "bounded-navigation-runtime-contract/v1",
        enforcement: "runtime_contract",
        runtimeToolGuard: true,
      },
    });
    expect(prompt).toContain("Candidate: workspace-write-navigation-candidate-v3");
    expect(prompt).toContain("file_glob include must be one non-empty string");
    expect(prompt).toContain("maxResults=4");
    expect(() => buildNavigationCandidateV3Prompt(prompt)).toThrow(/already contains/i);
  });

  it("builds Schema-valid evidence from the actual bounded policy replay and fails closed on drift", async () => {
    const artifact = buildNavigationCandidateV3Evidence(evidenceFixture());

    expect(artifact).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION,
      platform: "windows-native",
      status: "eligible_for_shadow_readiness",
      candidate: {
        id: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_ID,
        toolArgumentPolicy: "bounded-navigation-v1",
      },
      execution: {
        mode: "offline-runtime-replay",
        modelCalls: 0,
        providerCostUsd: 0,
        networkCalls: 0,
        hostCommandToolCalls: 0,
      },
      runtimeContract: {
        policyId: "bounded-navigation-v1",
        runtimeToolGuard: true,
        missingIncludeBlocked: true,
        arrayIncludeBlocked: true,
        rootWideIncludeBlocked: true,
        missingMaxResultsCappedTo: 20,
        oversizedMaxResultsCappedTo: 20,
        policyMetadataObserved: true,
      },
      replay: {
        toolCallCount: 4,
        sequence: ["file_glob", "file_glob", "file_read", "text_search"],
        modelVisibleResponseBytes: 2400,
        fileContentBytesExposed: 446,
        fullTargetReadCount: 0,
        targetLocalized: true,
        bugSignatureObserved: true,
      },
      comparison: {
        candidateV2ReplayModelVisibleResponseBytes: 2212,
        candidateV3ReplayModelVisibleResponseBytes: 2400,
        tokenImpact: { status: "not_measured", reason: "no_model_call" },
      },
      decision: {
        status: "eligible_for_shadow_readiness",
        requiresNewProviderAuthorization: true,
      },
    });

    const drift = evidenceFixture();
    drift.replay.policyProbes[1].metadata.argumentValidation.toolArgumentPolicy = "unknown";
    expect(() => buildNavigationCandidateV3Evidence(drift)).toThrow(/runtime contract/i);

    const schema = JSON.parse(await fs.readFile(path.resolve(
      "benchmarks/coding-agent/v3/navigation-candidate-v3.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("parses explicit roots and writes the artifact only into a new output root", async () => {
    expect(parseNavigationCandidateV3CliArguments([
      "--platform", "wsl2-linux",
      "--source-root", "/mnt/e/project/star-sanctuary",
      "--analysis-root", "/mnt/e/project/star-sanctuary/artifacts/p0.24",
      "--candidate-v2-root", "/mnt/e/project/star-sanctuary/artifacts/p0.22/wsl2-linux",
      "--shadow-v2-root", "/mnt/e/project/star-sanctuary/artifacts/p0.23/wsl2-linux",
      "--workspace-root", "/var/tmp/express/workspace",
      "--output-root", "/var/tmp/navigation-v3",
      "--generated-at", "2026-08-09T00:00:00.000Z",
    ])).toEqual({
      platform: "wsl2-linux",
      sourceRoot: "/mnt/e/project/star-sanctuary",
      analysisRoot: "/mnt/e/project/star-sanctuary/artifacts/p0.24",
      candidateV2Root: "/mnt/e/project/star-sanctuary/artifacts/p0.22/wsl2-linux",
      shadowV2Root: "/mnt/e/project/star-sanctuary/artifacts/p0.23/wsl2-linux",
      workspaceRoot: "/var/tmp/express/workspace",
      outputRoot: "/var/tmp/navigation-v3",
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(() => parseNavigationCandidateV3CliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation candidate v3 argument/i);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "navigation-candidate-v3-"));
    tempRoots.push(root);
    const outputRoot = path.join(root, "output");
    const artifact = buildNavigationCandidateV3Evidence(evidenceFixture());
    await writeNavigationCandidateV3Artifact(outputRoot, artifact);
    await expect(fs.readFile(path.join(outputRoot, "navigation-candidate-v3.json"), "utf-8"))
      .resolves.toContain(CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION);
    await expect(writeNavigationCandidateV3Artifact(outputRoot, artifact))
      .rejects.toThrow(/already exists/i);
  });

  it("orchestrates read-only bound inputs before writing one offline artifact", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "navigation-candidate-v3-run-"));
    tempRoots.push(root);
    const sourceRoot = path.join(root, "source");
    const analysisRoot = path.join(root, "analysis");
    const candidateV2Root = path.join(root, "candidate-v2");
    const shadowV2Root = path.join(root, "shadow-v2");
    const workspaceRoot = path.join(root, "workspace");
    const outputRoot = path.join(root, "output");
    const fixture = evidenceFixture();
    fixture.shadowV2.outcome = { runId: "shadow-run" };
    fixture.shadowV2Text = JSON.stringify(fixture.shadowV2);
    fixture.analysis.platforms[0].source.shadowArtifactSha256 = sha256(fixture.shadowV2Text);
    fixture.analysisText = JSON.stringify(fixture.analysis);

    await Promise.all([
      fs.mkdir(path.join(sourceRoot, "benchmarks/coding-agent/v3"), { recursive: true }),
      fs.mkdir(analysisRoot, { recursive: true }),
      fs.mkdir(candidateV2Root, { recursive: true }),
      fs.mkdir(path.join(shadowV2Root, "execution/shadow-run"), { recursive: true }),
      fs.mkdir(workspaceRoot, { recursive: true }),
      ...runtimeSourceFixture().map((file) => fs.mkdir(
        path.dirname(path.join(sourceRoot, file.path)),
        { recursive: true },
      )),
    ]);
    await Promise.all([
      fs.writeFile(
        path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json"),
        fixture.manifestText,
        "utf-8",
      ),
      fs.writeFile(path.join(analysisRoot, "navigation-shadow-v2-analysis.json"), fixture.analysisText, "utf-8"),
      fs.writeFile(path.join(candidateV2Root, "navigation-candidate-v2.json"), fixture.candidateV2Text, "utf-8"),
      fs.writeFile(path.join(shadowV2Root, "navigation-shadow-real-v2.json"), fixture.shadowV2Text, "utf-8"),
      fs.writeFile(
        path.join(shadowV2Root, "execution/shadow-run/prompt.md"),
        `${buildNavigationCandidateV2Prompt("Fix the frozen regression.")}\n`,
        "utf-8",
      ),
      ...runtimeSourceFixture().map((file) => fs.writeFile(
        path.join(sourceRoot, file.path),
        `${file.path}\n`,
        "utf-8",
      )),
    ]);

    const artifact = await runNavigationCandidateV3Preflight({
      platform: "windows-native",
      sourceRoot,
      analysisRoot,
      candidateV2Root,
      shadowV2Root,
      workspaceRoot,
      outputRoot,
      generatedAt: "2026-08-09T00:00:00.000Z",
    }, {
      readGitState: async () => ({ head: "b".repeat(40), status: "" }),
      executeReplay: async () => replayFixture(),
    });

    expect(artifact).toMatchObject({
      platform: "windows-native",
      status: "eligible_for_shadow_readiness",
      prompt: { basePromptSha256: sha256("Fix the frozen regression.") },
    });
    await expect(fs.readFile(path.join(outputRoot, "navigation-candidate-v3.json"), "utf-8"))
      .resolves.toContain(CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V3_VERSION);

    await fs.writeFile(
      path.join(shadowV2Root, "execution/shadow-run/prompt.md"),
      `${buildNavigationCandidateV2Prompt("Tampered regression prompt.")}\n`,
      "utf-8",
    );
    await expect(runNavigationCandidateV3Preflight({
      platform: "windows-native",
      sourceRoot,
      analysisRoot,
      candidateV2Root,
      shadowV2Root,
      workspaceRoot,
      outputRoot: path.join(root, "tampered-output"),
      generatedAt: "2026-08-09T00:00:00.000Z",
    }, {
      readGitState: async () => ({ head: "b".repeat(40), status: "" }),
      executeReplay: async () => replayFixture(),
    })).rejects.toThrow(/rendered prompt hash drifted/i);
  });
});

function evidenceFixture() {
  const manifest = manifestFixture();
  const manifestText = JSON.stringify(manifest);
  const basePrompt = "Fix the frozen regression.";
  const renderedPrompt = buildNavigationCandidateV2Prompt(basePrompt);
  const historicalRawBasePromptSha256 = sha256(`${basePrompt}\n`);
  const candidateV2 = {
    schemaVersion: "coding-agent-benchmark-navigation-candidate-v2/v1",
    platform: "windows-native",
    status: "eligible_for_shadow_readiness",
    candidate: { id: "workspace-write-navigation-candidate-v2", manifestModified: false },
    prompt: {
      basePromptSha256: historicalRawBasePromptSha256,
      renderedPromptSha256: sha256(renderedPrompt),
    },
    replay: { modelVisibleResponseBytes: 2212 },
    source: {
      manifestSha256: sha256(manifestText),
      baselineCommit: "a".repeat(40),
      candidateFixtureBaselineCommit: "b".repeat(40),
      repositorySnapshotIdentitySha256: "c".repeat(64),
      basePromptSha256: historicalRawBasePromptSha256,
    },
  };
  const candidateV2Text = JSON.stringify(candidateV2);
  const shadowV2 = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-real-v2/v1",
    platform: "windows-native",
    status: "completed",
    taskId: "real-js.bug-fix",
    candidate: { id: "workspace-write-navigation-candidate-v2", manifestModified: false },
    execution: { v3AggregateEligible: false, hostCommandToolCalls: 0 },
    source: {
      candidateEvidenceSha256: sha256(candidateV2Text),
      manifestSha256: sha256(manifestText),
      baselineCommit: "a".repeat(40),
      candidateFixtureBaselineCommit: "b".repeat(40),
      repositorySnapshotIdentitySha256: "c".repeat(64),
    },
  };
  const shadowV2Text = JSON.stringify(shadowV2);
  const analysis = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-v2-analysis/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    candidateId: "workspace-write-navigation-candidate-v2",
    decision: {
      status: "do_not_promote",
      technicalDebtDecision: "split_task",
      nextCandidate: "navigation-candidate-v3-runtime-contract-required",
      requiresNewProviderAuthorization: true,
    },
    execution: { mode: "offline-analysis", modelCalls: 0, providerCostUsd: 0 },
    platforms: [{
      platform: "windows-native",
      source: {
        shadowArtifactSha256: sha256(shadowV2Text),
        candidateEvidenceSha256: sha256(candidateV2Text),
        manifestSha256: sha256(manifestText),
        baselineCommit: "a".repeat(40),
        repositorySnapshotIdentitySha256: "c".repeat(64),
      },
    }],
  };
  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    platform: "windows-native",
    manifest,
    manifestText,
    analysis,
    analysisText: JSON.stringify(analysis),
    candidateV2,
    candidateV2Text,
    shadowV2,
    shadowV2Text,
    basePrompt,
    gitBefore: { head: "b".repeat(40), status: "" },
    gitAfter: { head: "b".repeat(40), status: "" },
    runtimeSourceFiles: runtimeSourceFixture(),
    replay: replayFixture(),
  };
}

function replayFixture() {
  return {
    calls: [
      globCall({ include: "test/benchmark-v3/real-js-bug-fix.js" }, 20, 400),
      globCall({ include: "lib/**/*.js", maxResults: 200 }, 20, 500),
      {
        name: "file_read",
        arguments: { path: "test/benchmark-v3/real-js-bug-fix.js" },
        success: true,
        responseBytes: 700,
        outputSha256: "d".repeat(64),
        fileContentBytes: 446,
        fullFileRead: true,
        relativePath: "test/benchmark-v3/real-js-bug-fix.js",
      },
      {
        name: "text_search",
        arguments: {
          query: "this.app.get('subdomain offset')",
          mode: "fixed",
          path: "lib",
          glob: "**/*.js",
          maxResults: 4,
          contextLines: 5,
        },
        success: true,
        responseBytes: 800,
        outputSha256: "e".repeat(64),
        fileContentBytes: 0,
        fullFileRead: false,
        relativePath: null,
      },
    ],
    policyProbes: [
      blockedProbe("missing-include", {}),
      blockedProbe("array-include", { include: ["lib/**/*.js"] }),
      blockedProbe("root-wide-include", { include: "**/*" }),
    ],
    targetLocalized: true,
    bugSignatureObserved: true,
    textSearchTraversalRejected: true,
    fileGlobTraversalRejected: true,
  };
}

function globCall(argumentsValue, effectiveMaxResults, responseBytes) {
  return {
    name: "file_glob",
    arguments: argumentsValue,
    effectiveMaxResults,
    success: true,
    responseBytes,
    outputSha256: "f".repeat(64),
    fileContentBytes: 0,
    fullFileRead: false,
    relativePath: null,
    metadata: policyMetadata(false, true),
  };
}

function blockedProbe(id, argumentsValue) {
  return {
    id,
    arguments: argumentsValue,
    success: false,
    failureKind: "input_error",
    metadata: policyMetadata(true, false),
  };
}

function policyMetadata(blocked, corrected) {
  return {
    repairAction: blocked ? "tool_arguments_invalid" : "tool_arguments_corrected",
    argumentValidation: {
      blocked,
      corrected,
      toolArgumentPolicy: "bounded-navigation-v1",
    },
  };
}

function runtimeSourceFixture() {
  return [
    "packages/belldandy-protocol/src/index.ts",
    "packages/belldandy-core/src/server.ts",
    "packages/belldandy-core/src/query-runtime-message-send.ts",
    "packages/belldandy-core/src/cli/commands/agent/run.ts",
    "packages/belldandy-skills/src/types.ts",
    "packages/belldandy-skills/src/executor.ts",
  ].map((filePath, index) => ({ path: filePath, sha256: String(index + 1).repeat(64) }));
}

function manifestFixture() {
  return {
    schemaVersion: "coding-agent-benchmark-manifest/v3",
    suite: {
      executionProfiles: {
        "navigation-read": {
          permissionMode: "plan",
          toolAllow: ["file_read", "list_files", "text_search", "file_glob"],
          toolDeny: ["run_command", "spawn_subagent"],
        },
        "workspace-write": {
          permissionMode: "acceptEdits",
          toolAllow: [
            "file_read",
            "list_files",
            "file_edit",
            "apply_patch",
            "file_write",
            "file_delete",
          ],
          toolDeny: ["run_command", "spawn_subagent"],
        },
      },
    },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
