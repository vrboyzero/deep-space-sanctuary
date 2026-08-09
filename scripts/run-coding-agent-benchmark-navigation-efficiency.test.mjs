import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

import {
  CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION,
  analyzeNavigationEfficiencyBaseline,
  buildNavigationCandidateProfile,
  evaluateNavigationEfficiencyCandidate,
  parseNavigationEfficiencyCliArguments,
  runNavigationEfficiencyProbe,
} from "./run-coding-agent-benchmark-navigation-efficiency.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent benchmark navigation efficiency probe", () => {
  it("recomputes the historical budget failure and model-visible navigation baseline", () => {
    const fixture = baselineFixture();
    const baseline = analyzeNavigationEfficiencyBaseline(fixture);

    expect(baseline).toMatchObject({
      runId: "real-js-bug-fix-windows-a1",
      taskId: "real-js.bug-fix",
      baselineCommit: "a".repeat(40),
      modelCalls: 4,
      inputTokens: 23_078,
      outputTokens: 2_773,
      totalTokens: 25_851,
      tokenLimit: 24_000,
      budgetExhausted: true,
      changedFileCount: 0,
      toolCallCount: 5,
      fileContentBytesExposed: 27_843,
      irrelevantFullFileReadBytes: 14_584,
    });
    expect(baseline.modelVisibleResponseBytes).toBeGreaterThan(0);
    expect(baseline.calls.map((call) => call.name)).toEqual([
      "list_files",
      "file_read",
      "file_read",
      "file_read",
      "list_files",
    ]);
  });

  it("derives a candidate by adding only the existing read-only navigation tools", () => {
    const profile = buildNavigationCandidateProfile(v3ManifestFixture());

    expect(profile).toEqual({
      id: "workspace-write-navigation-candidate-v1",
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
    });
  });

  it("marks a byte-efficient candidate eligible without claiming token uplift", () => {
    const result = evaluateNavigationEfficiencyCandidate({
      baseline: {
        modelVisibleResponseBytes: 6_000,
        fileContentBytesExposed: 27_843,
        irrelevantFullFileReadBytes: 14_584,
      },
      candidate: {
        modelVisibleResponseBytes: 2_400,
        fileContentBytesExposed: 446,
        irrelevantFullFileReadBytes: 0,
        targetLocalized: true,
        bugSignatureObserved: true,
      },
      security: {
        textSearchTraversalRejected: true,
        fileGlobTraversalRejected: true,
        workspaceUnchanged: true,
      },
    });

    expect(result).toEqual({
      status: "eligible_for_canary",
      comparison: {
        modelVisibleResponseReductionRatio: 0.6,
        fileContentExposureReductionRatio: 0.983982,
        thresholds: {
          minimumModelVisibleResponseReductionRatio: 0.5,
          maximumIrrelevantFullFileReadBytes: 0,
        },
        tokenImpact: {
          status: "not_measured",
          reason: "no_model_call",
        },
      },
      diagnostics: [],
    });

    expect(evaluateNavigationEfficiencyCandidate({
      baseline: {
        modelVisibleResponseBytes: 6_000,
        fileContentBytesExposed: 27_843,
        irrelevantFullFileReadBytes: 14_584,
      },
      candidate: {
        modelVisibleResponseBytes: 3_500,
        fileContentBytesExposed: 446,
        irrelevantFullFileReadBytes: 0,
        targetLocalized: false,
        bugSignatureObserved: false,
      },
      security: {
        textSearchTraversalRejected: true,
        fileGlobTraversalRejected: true,
        workspaceUnchanged: true,
      },
    })).toMatchObject({
      status: "insufficient",
      diagnostics: expect.arrayContaining([
        "model_visible_response_reduction_below_threshold",
        "target_not_localized",
        "bug_signature_not_observed",
      ]),
    });
  });

  it("writes one versioned artifact from an injected no-model probe", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-navigation-efficiency-"));
    tempRoots.push(root);
    const baselineRunRoot = path.join(root, "baseline");
    const workspaceRoot = path.join(root, "workspace");
    const outputRoot = path.join(root, "nested", "output");
    await fs.mkdir(baselineRunRoot, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });
    const fixture = baselineFixture();
    await fs.writeFile(path.join(baselineRunRoot, "manifest.json"), JSON.stringify(fixture.manifest));
    await fs.writeFile(
      path.join(baselineRunRoot, "events.jsonl"),
      `${fixture.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );

    const result = await runNavigationEfficiencyProbe({
      sourceRoot: path.resolve("."),
      baselineRunRoot,
      workspaceRoot,
      outputRoot,
      platform: "windows-native",
      generatedAt: "2026-08-09T00:00:00.000Z",
    }, {
      manifest: v3ManifestFixture(),
      readGitState: async () => ({ head: "a".repeat(40), status: "" }),
      executeCandidate: async () => ({
        calls: [
          toolCall("file_glob", 300, 0),
          toolCall("file_read", 700, 446),
          toolCall("text_search", 1_000, 0),
        ],
        targetLocalized: true,
        bugSignatureObserved: true,
        textSearchTraversalRejected: true,
        fileGlobTraversalRejected: true,
      }),
    });

    expect(result).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION,
      status: "eligible_for_canary",
      platform: "windows-native",
      modelCalls: 0,
      providerCostUsd: 0,
      source: {
        baselineRunId: "real-js-bug-fix-windows-a1",
        baselineCommit: "a".repeat(40),
      },
      candidate: {
        toolCallCount: 3,
        modelVisibleResponseBytes: 2_000,
        fileContentBytesExposed: 446,
      },
      security: { workspaceUnchanged: true },
    });
    await expect(fs.readFile(path.join(outputRoot, "navigation-efficiency.json"), "utf-8"))
      .resolves.toContain(CODING_AGENT_BENCHMARK_NAVIGATION_EFFICIENCY_VERSION);
    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-efficiency.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(result))).toMatchObject({ ok: true });
      const withoutTokenImpact = structuredClone(result);
      delete withoutTokenImpact.comparison.tokenImpact;
      expect(compiled.validator.validateOutput(JSON.stringify(withoutTokenImpact)))
        .toMatchObject({ ok: false });
    }
    await expect(runNavigationEfficiencyProbe({
      sourceRoot: path.resolve("."),
      baselineRunRoot,
      workspaceRoot,
      outputRoot,
      platform: "windows-native",
    }, {
      manifest: v3ManifestFixture(),
      readGitState: async () => ({ head: "a".repeat(40), status: "" }),
      executeCandidate: async () => { throw new Error("must not run"); },
    })).rejects.toThrow(/output root already exists/i);
  });

  it("parses only explicit local roots and supported platforms", () => {
    expect(parseNavigationEfficiencyCliArguments([
      "--platform", "wsl2-linux",
      "--source-root", "/mnt/e/project/star-sanctuary",
      "--baseline-run-root", "/mnt/e/project/star-sanctuary/artifacts/baseline/run",
      "--workspace-root", "/var/tmp/express/workspace",
      "--output-root", "/var/tmp/navigation-output",
    ])).toEqual({
      platform: "wsl2-linux",
      sourceRoot: "/mnt/e/project/star-sanctuary",
      baselineRunRoot: "/mnt/e/project/star-sanctuary/artifacts/baseline/run",
      workspaceRoot: "/var/tmp/express/workspace",
      outputRoot: "/var/tmp/navigation-output",
    });
    expect(() => parseNavigationEfficiencyCliArguments([
      "--platform", "darwin",
      "--baseline-run-root", "baseline",
      "--workspace-root", "workspace",
      "--output-root", "output",
    ])).toThrow(/windows-native or wsl2-linux/i);
    expect(() => parseNavigationEfficiencyCliArguments(["--unknown", "value"]))
      .toThrow(/unknown coding benchmark navigation efficiency argument/i);
  });

  it("rejects an output root inside the measured workspace before executing tools", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-navigation-boundary-"));
    tempRoots.push(root);
    const baselineRunRoot = path.join(root, "baseline");
    const workspaceRoot = path.join(root, "workspace");
    await fs.mkdir(baselineRunRoot, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });
    const fixture = baselineFixture();
    await fs.writeFile(path.join(baselineRunRoot, "manifest.json"), JSON.stringify(fixture.manifest));
    await fs.writeFile(
      path.join(baselineRunRoot, "events.jsonl"),
      `${fixture.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );

    await expect(runNavigationEfficiencyProbe({
      sourceRoot: path.resolve("."),
      baselineRunRoot,
      workspaceRoot,
      outputRoot: path.join(workspaceRoot, "evidence"),
      platform: "windows-native",
    }, {
      manifest: v3ManifestFixture(),
      executeCandidate: async () => { throw new Error("must not run"); },
    })).rejects.toThrow(/outputRoot and workspaceRoot must be disjoint/i);
  });
});

function baselineFixture() {
  const runId = "real-js-bug-fix-windows-a1";
  const calls = [
    ["call-1", "list_files", { path: ".", depth: 2 }, JSON.stringify({ entries: [] })],
    ["call-2", "file_read", { path: "test/benchmark-v3/real-js-bug-fix.js" }, fileReadOutput(446, 446)],
    ["call-3", "file_read", { path: "lib/request.js" }, fileReadOutput(12_813, 1_850)],
    ["call-4", "file_read", { path: "lib/application.js" }, fileReadOutput(14_584, 1_850)],
    ["call-5", "list_files", { path: "lib" }, JSON.stringify({ entries: [] })],
  ];
  const events = [];
  let seq = 1;
  for (const [id, name, args, output] of calls) {
    events.push(agentEvent(seq++, "tool.started", { tool: { id, name, arguments: args } }));
    events.push(agentEvent(seq++, "tool.completed", { tool: { id, name, success: true, output } }));
  }
  events.push(agentEvent(seq++, "run.usage", {
    usage: { input: 23_078, output: 2_773, modelCalls: 4 },
  }));
  events.push(agentEvent(seq++, "run.budget_exhausted", {
    budget: { budget: "total_tokens", limit: 24_000, observed: 25_851 },
  }));
  events.push(agentEvent(seq, "run.failed", {
    error: { code: "budget_exhausted" },
    changes: { changedFileCount: 0 },
  }));
  return {
    manifest: {
      schemaVersion: "coding-agent-benchmark-run/v3",
      runId,
      taskId: "real-js.bug-fix",
      platform: "windows-native",
      fixture: { baselineCommit: "a".repeat(40) },
      status: "failed",
      execution: { profile: "workspace-write", budgets: { maxTokens: 24_000 } },
    },
    events,
  };
}

function v3ManifestFixture() {
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
          toolAllow: ["file_read", "list_files", "file_edit", "apply_patch", "file_write", "file_delete"],
          toolDeny: ["run_command", "spawn_subagent"],
        },
      },
    },
  };
}

function agentEvent(seq, type, payload) {
  return { version: "v1", seq, type, payload };
}

function fileReadOutput(bytesRead, visibleContentBytes) {
  return JSON.stringify({
    size: bytesRead,
    bytesRead,
    truncated: false,
    content: "x".repeat(visibleContentBytes),
  });
}

function toolCall(name, responseBytes, fileContentBytes) {
  return {
    name,
    success: true,
    responseBytes,
    fileContentBytes,
    fullFileRead: name === "file_read",
    relativePath: name === "file_read" ? "test/benchmark-v3/real-js-bug-fix.js" : null,
    outputSha256: "b".repeat(64),
  };
}
