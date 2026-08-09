import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import {
  CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_CANARY_VERSION,
  buildNavigationShadowCanaryPreflight,
  parseNavigationShadowCanaryCliArguments,
  runNavigationShadowCanaryDryRun,
} from "./run-coding-agent-benchmark-navigation-shadow-canary.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("coding agent navigation shadow canary readiness", () => {
  it("blocks execution while preserving the candidate and frozen-manifest identities", () => {
    const result = buildNavigationShadowCanaryPreflight({
      platform: "windows-native",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      maxCostCny: 2,
      navigationEvidence: navigationEvidenceFixture(),
      manifestSha256: "c".repeat(64),
      workspace: {
        head: "5".repeat(40),
        status: "",
      },
      baselineCommit: "5".repeat(40),
    });

    expect(result).toEqual({
      status: "ready_for_authorization",
      taskId: "real-js.bug-fix",
      platform: "windows-native",
      candidateId: "workspace-write-navigation-candidate-v1",
      frozen: {
        manifestModified: false,
        manifestSha256: "c".repeat(64),
        baselineCommit: "5".repeat(40),
      },
      authorization: {
        status: "pending_confirmation",
        provider: "deepseek",
        modelId: "deepseek-v4-flash",
        maxCostCny: 2,
        credentialsRead: false,
        requiresExplicitUserConfirmation: true,
      },
      execution: {
        mode: "dry-run",
        modelCalls: 0,
        providerCostUsd: 0,
        networkCalls: 0,
        hostCommandToolCalls: 0,
        tokenImpact: {
          status: "not_measured",
          reason: "dry_run_no_model_call",
        },
      },
      workspace: {
        unchanged: true,
        dirty: false,
      },
      diagnostics: [],
    });
  });

  it("fails closed when the offline candidate is not eligible", () => {
    expect(() => buildNavigationShadowCanaryPreflight({
      platform: "wsl2-linux",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      maxCostCny: 2,
      navigationEvidence: {
        ...navigationEvidenceFixture(),
        status: "insufficient",
      },
      manifestSha256: "c".repeat(64),
      workspace: { head: "5".repeat(40), status: "" },
      baselineCommit: "5".repeat(40),
    })).toThrow(/navigation evidence must be eligible_for_canary/i);
  });

  it("writes a dry-run artifact and rejects a confirmed authorization claim", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-navigation-shadow-"));
    tempRoots.push(root);
    const navigationRoot = path.join(root, "navigation");
    const sourceRoot = path.join(root, "source");
    const workspaceRoot = path.join(root, "workspace");
    const outputRoot = path.join(root, "nested", "output");
    await Promise.all([
      fs.mkdir(navigationRoot, { recursive: true }),
      fs.mkdir(sourceRoot, { recursive: true }),
      fs.mkdir(workspaceRoot, { recursive: true }),
    ]);
    await fs.writeFile(path.join(navigationRoot, "navigation-efficiency.json"), JSON.stringify(navigationEvidenceFixture()));
    await fs.mkdir(path.join(sourceRoot, "benchmarks/coding-agent/v3"), { recursive: true });
    await fs.writeFile(
      path.join(sourceRoot, "benchmarks/coding-agent/v3/task-manifest.json"),
      JSON.stringify({ schemaVersion: "coding-agent-benchmark-manifest/v3", tasks: [] }),
    );

    const result = await runNavigationShadowCanaryDryRun({
      sourceRoot,
      navigationEvidenceRoot: navigationRoot,
      workspaceRoot,
      outputRoot,
      platform: "windows-native",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      maxCostCny: 2,
      generatedAt: "2026-08-09T00:00:00.000Z",
    }, {
      readGitState: async () => ({ head: "5".repeat(40), status: "" }),
      validateManifest: (manifest) => {
        expect(manifest.schemaVersion).toBe("coding-agent-benchmark-manifest/v3");
      },
    });

    expect(result).toMatchObject({
      schemaVersion: CODING_AGENT_BENCHMARK_NAVIGATION_SHADOW_CANARY_VERSION,
      status: "ready_for_authorization",
      execution: { mode: "dry-run", modelCalls: 0, providerCostUsd: 0 },
      authorization: { status: "pending_confirmation", credentialsRead: false },
    });
    const schema = JSON.parse(await fs.readFile(path.join(
      path.resolve("."),
      "benchmarks/coding-agent/v3/navigation-shadow-canary.schema.json",
    ), "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.validator.validateOutput(JSON.stringify(result))).toMatchObject({ ok: true });
      const confirmed = structuredClone(result);
      confirmed.authorization.status = "confirmed";
      expect(compiled.validator.validateOutput(JSON.stringify(confirmed))).toMatchObject({ ok: false });
    }
    await expect(runNavigationShadowCanaryDryRun({
      sourceRoot,
      navigationEvidenceRoot: navigationRoot,
      workspaceRoot,
      outputRoot,
      platform: "windows-native",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      maxCostCny: 2,
    }, {
      readGitState: async () => ({ head: "5".repeat(40), status: "" }),
    })).rejects.toThrow(/output root already exists/i);
  });

  it("parses an explicit non-sensitive dry-run command and rejects unknown flags", () => {
    expect(parseNavigationShadowCanaryCliArguments([
      "--platform", "wsl2-linux",
      "--source-root", "/mnt/e/project/star-sanctuary",
      "--navigation-evidence-root", "/mnt/e/project/star-sanctuary/artifacts/navigation",
      "--workspace-root", "/mnt/e/project/star-sanctuary/tmp/workspace",
      "--output-root", "/var/tmp/navigation-shadow",
      "--provider", "deepseek",
      "--model-id", "deepseek-v4-flash",
      "--max-cost-cny", "2",
    ])).toEqual({
      platform: "wsl2-linux",
      sourceRoot: "/mnt/e/project/star-sanctuary",
      navigationEvidenceRoot: "/mnt/e/project/star-sanctuary/artifacts/navigation",
      workspaceRoot: "/mnt/e/project/star-sanctuary/tmp/workspace",
      outputRoot: "/var/tmp/navigation-shadow",
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      maxCostCny: 2,
    });
    expect(() => parseNavigationShadowCanaryCliArguments(["--unknown", "value"]))
      .toThrow(/unknown coding benchmark navigation shadow canary argument/i);
  });
});

function navigationEvidenceFixture() {
  return {
    schemaVersion: "coding-agent-benchmark-navigation-efficiency/v1",
    status: "eligible_for_canary",
    platform: "windows-native",
    source: {
      baselineRunId: "real-js-bug-fix-windows-a1",
      baselineTaskId: "real-js.bug-fix",
      baselineCommit: "5".repeat(40),
    },
    profile: {
      id: "workspace-write-navigation-candidate-v1",
      baseProfile: "workspace-write",
      manifestModified: false,
    },
    comparison: {
      tokenImpact: { status: "not_measured", reason: "no_model_call" },
    },
  };
}
