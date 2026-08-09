import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
  CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION,
  buildNavigationCandidateV2Evidence,
  buildNavigationCandidateV2Profile,
  buildNavigationCandidateV2Prompt,
  parseNavigationCandidateV2CliArguments,
  writeNavigationCandidateV2Artifact,
} from "./run-coding-agent-benchmark-navigation-candidate-v2.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent navigation candidate v2 offline preflight", () => {
  it("derives a prompt-constrained profile without changing the frozen workspace-write tools", () => {
    const profile = buildNavigationCandidateV2Profile(manifestFixture());
    const prompt = buildNavigationCandidateV2Prompt("Fix the frozen regression.");

    expect(profile).toMatchObject({
      id: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID,
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
      manifestModified: false,
      strategy: {
        id: "bounded-localize-before-read/v1",
        enforcement: "prompt_contract",
        runtimeToolGuard: false,
      },
    });
    expect(prompt).toContain("## Navigation Budget Contract");
    expect(prompt).toContain("maxResults=4");
    expect(prompt).toContain("contextLines=5");
    expect(prompt).toContain("Do not read the complete lib/request.js before text_search");
    expect(() => buildNavigationCandidateV2Prompt(prompt)).toThrow(/already contains/i);
  });

  it("builds Schema-valid evidence only for the bounded three-call replay", async () => {
    const input = evidenceFixture();
    const artifact = buildNavigationCandidateV2Evidence(input);

    expect(artifact).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION,
      platform: "windows-native",
      status: "eligible_for_shadow_readiness",
      candidate: { id: CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_ID },
      execution: {
        mode: "offline-replay",
        modelCalls: 0,
        providerCostUsd: 0,
        networkCalls: 0,
        hostCommandToolCalls: 0,
      },
      replay: {
        toolCallCount: 3,
        sequence: ["file_glob", "file_read", "text_search"],
        modelVisibleResponseBytes: 2212,
        fileContentBytesExposed: 446,
        fullTargetReadCount: 0,
      },
      comparison: {
        baselineModelVisibleResponseBytes: 6141,
        candidateV1ActualModelVisibleResponseBytes: 8373,
        candidateV2ReplayModelVisibleResponseBytes: 2212,
        tokenImpact: { status: "not_measured", reason: "no_model_call" },
      },
      security: {
        workspaceUnchanged: true,
        textSearchTraversalRejected: true,
        fileGlobTraversalRejected: true,
      },
      decision: {
        status: "eligible_for_shadow_readiness",
        requiresNewProviderAuthorization: true,
      },
    });

    const schema = JSON.parse(await fs.readFile(path.resolve(
      "benchmarks/coding-agent/v3/navigation-candidate-v2.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(artifact))).toMatchObject({ ok: true });
    }
  });

  it("fails closed on prior-decision, workspace, or route drift", () => {
    const decisionDrift = evidenceFixture();
    decisionDrift.analysis.decision.nextCandidate = "unknown";
    expect(() => buildNavigationCandidateV2Evidence(decisionDrift)).toThrow(/analysis decision/i);

    const workspaceDrift = evidenceFixture();
    workspaceDrift.gitAfter.status = " M lib/request.js";
    expect(() => buildNavigationCandidateV2Evidence(workspaceDrift)).toThrow(/workspace/i);

    const routeDrift = evidenceFixture();
    routeDrift.replay.calls[2].arguments.maxResults = 50;
    expect(() => buildNavigationCandidateV2Evidence(routeDrift)).toThrow(/bounded navigation route/i);
  });

  it("parses explicit roots and writes only to a new output root", async () => {
    expect(parseNavigationCandidateV2CliArguments([
      "--platform", "wsl2-linux",
      "--source-root", "/mnt/e/project/star-sanctuary",
      "--analysis-root", "/mnt/e/project/star-sanctuary/artifacts/p0.21",
      "--shadow-root", "/mnt/e/project/star-sanctuary/artifacts/p0.20/wsl2-linux",
      "--navigation-root", "/mnt/e/project/star-sanctuary/artifacts/p0.19/wsl2-linux",
      "--workspace-root", "/var/tmp/express/workspace",
      "--output-root", "/var/tmp/navigation-v2",
      "--generated-at", "2026-08-09T00:00:00.000Z",
    ])).toEqual({
      platform: "wsl2-linux",
      sourceRoot: "/mnt/e/project/star-sanctuary",
      analysisRoot: "/mnt/e/project/star-sanctuary/artifacts/p0.21",
      shadowRoot: "/mnt/e/project/star-sanctuary/artifacts/p0.20/wsl2-linux",
      navigationRoot: "/mnt/e/project/star-sanctuary/artifacts/p0.19/wsl2-linux",
      workspaceRoot: "/var/tmp/express/workspace",
      outputRoot: "/var/tmp/navigation-v2",
      generatedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(() => parseNavigationCandidateV2CliArguments(["--unknown", "value"]))
      .toThrow(/unknown navigation candidate v2 argument/i);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "navigation-candidate-v2-"));
    tempRoots.push(root);
    const outputRoot = path.join(root, "output");
    const artifact = buildNavigationCandidateV2Evidence(evidenceFixture());
    await writeNavigationCandidateV2Artifact(outputRoot, artifact);
    await expect(fs.readFile(path.join(outputRoot, "navigation-candidate-v2.json"), "utf-8"))
      .resolves.toContain(CODING_AGENT_BENCHMARK_NAVIGATION_CANDIDATE_V2_VERSION);
    await expect(writeNavigationCandidateV2Artifact(outputRoot, artifact))
      .rejects.toThrow(/already exists/i);
  });
});

function evidenceFixture() {
  const manifest = manifestFixture();
  const manifestText = JSON.stringify(manifest);
  const navigationEvidence = {
    schemaVersion: "coding-agent-benchmark-navigation-efficiency/v1",
    platform: "windows-native",
    status: "eligible_for_canary",
    profile: { id: "workspace-write-navigation-candidate-v1", manifestModified: false },
    baseline: {
      runId: "baseline-run",
      modelVisibleResponseBytes: 6141,
    },
    candidate: {
      toolCallCount: 3,
      modelVisibleResponseBytes: 2212,
      fileContentBytesExposed: 446,
    },
    comparison: { tokenImpact: { status: "not_measured", reason: "no_model_call" } },
  };
  const navigationEvidenceText = JSON.stringify(navigationEvidence);
  const shadowArtifact = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-real/v1",
    status: "completed",
    taskId: "real-js.bug-fix",
    platform: "windows-native",
    candidate: { id: "workspace-write-navigation-candidate-v1", manifestModified: false },
    execution: { v3AggregateEligible: false, hostCommandToolCalls: 0 },
    outcome: { runId: "shadow-run" },
    source: {
      navigationEvidenceSha256: sha256(navigationEvidenceText),
      manifestSha256: sha256(manifestText),
      candidateFixtureBaselineCommit: "a".repeat(40),
      repositorySnapshotIdentitySha256: "b".repeat(64),
    },
  };
  const shadowArtifactText = JSON.stringify(shadowArtifact);
  const analysis = {
    schemaVersion: "coding-agent-benchmark-navigation-shadow-analysis/v1",
    status: "completed",
    candidateId: "workspace-write-navigation-candidate-v1",
    decision: {
      status: "do_not_promote",
      nextCandidate: "navigation-candidate-v2-required",
      requiresNewProviderAuthorization: true,
    },
    execution: { mode: "offline-analysis", modelCalls: 0, providerCostUsd: 0 },
    platforms: [{
      platform: "windows-native",
      tools: { modelVisibleResponseBytes: 8373 },
      source: {
        shadowArtifactSha256: sha256(shadowArtifactText),
        navigationEvidenceSha256: sha256(navigationEvidenceText),
        manifestSha256: sha256(manifestText),
        baselineCommit: "c".repeat(40),
        repositorySnapshotIdentitySha256: "b".repeat(64),
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
    shadowArtifact,
    shadowArtifactText,
    navigationEvidence,
    navigationEvidenceText,
    basePrompt: "Fix the frozen regression.",
    gitBefore: { head: "a".repeat(40), status: "" },
    gitAfter: { head: "a".repeat(40), status: "" },
    replay: replayFixture(),
  };
}

function replayFixture() {
  return {
    calls: [
      toolCall("file_glob", {
        include: ["test/benchmark-v3/real-js-bug-fix.js", "lib/**/*.js"],
        maxResults: 20,
      }, 473, 0, false, null),
      toolCall("file_read", {
        path: "test/benchmark-v3/real-js-bug-fix.js",
      }, 700, 446, true, "test/benchmark-v3/real-js-bug-fix.js"),
      toolCall("text_search", {
        query: "this.app.get('subdomain offset')",
        mode: "fixed",
        path: "lib",
        glob: "**/*.js",
        maxResults: 4,
        contextLines: 5,
      }, 1039, 0, false, null),
    ],
    targetLocalized: true,
    bugSignatureObserved: true,
    textSearchTraversalRejected: true,
    fileGlobTraversalRejected: true,
  };
}

function toolCall(name, argumentsValue, responseBytes, fileContentBytes, fullFileRead, relativePath) {
  return {
    name,
    arguments: argumentsValue,
    success: true,
    responseBytes,
    fileContentBytes,
    fullFileRead,
    relativePath,
    outputSha256: "d".repeat(64),
  };
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
