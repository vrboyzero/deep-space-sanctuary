import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(
  workspaceRoot,
  "benchmarks/coding-agent/v3/candidate-code-intel-evidence-receipt.schema.json",
);

describe("coding agent candidate CodeIntel evidence receipt", () => {
  it("freezes one current-candidate receipt across six independent contracts", async () => {
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
    const compiled = compileOutputSchema(schema);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const receipt = candidateCodeIntelReceipt();
    expect(schema.properties.schemaVersion.const).toBe(
      "coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1",
    );
    const validation = compiled.validator.validateOutput(JSON.stringify(receipt));
    expect(validation, JSON.stringify(validation)).toMatchObject({ ok: true });
    expect(compiled.validator.validateOutput(JSON.stringify({
      ...receipt,
      numericScore: 9.5,
    }))).toMatchObject({ ok: false });

    const platformDrift = structuredClone(receipt);
    platformDrift.truthSet[0].platform = "wsl2-linux";
    expect(compiled.validator.validateOutput(JSON.stringify(platformDrift)))
      .toMatchObject({ ok: false });

    const selectionDrift = structuredClone(receipt);
    selectionDrift.selection.agentUplift.taskIds[3] = "real-go.bug-fix";
    expect(compiled.validator.validateOutput(JSON.stringify(selectionDrift)))
      .toMatchObject({ ok: false });
  });
});

function candidateCodeIntelReceipt() {
  return {
    schemaVersion: "coding-agent-benchmark-candidate-code-intel-evidence-receipt/v1",
    generatedAt: "2026-09-02T09:00:00.000Z",
    aggregate: aggregateBinding(),
    sourceIdentity: {
      harness: repositoryIdentity("e"),
      files: [{
        path: "packages/belldandy-skills/src/code-intel/types.ts",
        sha256: "f".repeat(64),
      }],
      aggregateSha256: "1".repeat(64),
    },
    selection: {
      truthSet: {
        id: "p1-a1-ts-js-core-v1",
        manifestSha256: "2".repeat(64),
        platforms: ["windows-native", "wsl2-linux"],
      },
      contextInspector: {
        contractVersion: "code-intel/v1",
        projection: "projectCodeIntelQueryResult",
        coordinateSystem: "zero-based-line-column",
        mutationAuthority: "none",
      },
      resourceSoak: {
        id: "p1-a1-typescript-provider-resource-soak-v1",
        configSha256: "3".repeat(64),
        platforms: ["windows-native", "wsl2-linux"],
      },
      agentUplift: {
        candidateId: "code-intel-semantic-live-v1",
        attempt: 1,
        taskIds: [
          "real-ts.api-migration",
          "real-ts.cross-package-refactor",
          "real-js.bug-fix",
          "real-js.failed-test-fix",
        ],
        platforms: ["windows-native", "wsl2-linux"],
      },
      goCanary: {
        truthSetId: "p1-a2-go-canary-v1",
        manifestSha256: "4".repeat(64),
        sharedRuntimeFileCount: 9,
      },
    },
    summary: {
      truthSet: { platformCount: 2, caseCount: 7, expected: 14, passed: true },
      contextInspector: { scenarioCount: 3, passed: true },
      resourceSoak: {
        platformCount: 2,
        attemptsPerPlatform: 23,
        expectedRejectedPerPlatform: 1,
        passed: true,
      },
      agentUplift: {
        pairCount: 8,
        semanticSuccessfulRuns: 8,
        binaryOutcomeRegressionCount: 0,
        contextWasteNoRegression: true,
        contextWasteImprovementAlternativePassed: true,
      },
      goCanary: {
        caseCount: 6,
        positionCount: 10,
        goCanaryEligible: true,
        productionEligible: false,
      },
    },
    truthSet: [
      platformArtifact(
        "windows-native",
        "code-intel-truth-set-report/v1",
        "candidate-evidence/code-intel/truth-set/windows-native-report.json",
        "5",
      ),
      platformArtifact(
        "wsl2-linux",
        "code-intel-truth-set-report/v1",
        "candidate-evidence/code-intel/truth-set/wsl2-linux-report.json",
        "6",
      ),
    ],
    contextInspector: artifactReference(
      "code-intel-context-inspector-audit-report/v1",
      "candidate-evidence/code-intel/context-inspector-audit-report.json",
      "7",
    ),
    resourceSoak: [
      platformArtifact(
        "windows-native",
        "code-intel-resource-soak-report/v1",
        "candidate-evidence/code-intel/resource-soak/windows-native-report.json",
        "8",
      ),
      platformArtifact(
        "wsl2-linux",
        "code-intel-resource-soak-report/v1",
        "candidate-evidence/code-intel/resource-soak/wsl2-linux-report.json",
        "9",
      ),
    ],
    agentUplift: {
      aggregate: artifactReference(
        "code-intel-agent-uplift-report/v1",
        "candidate-evidence/code-intel/agent-uplift/aggregate-report.json",
        "a",
      ),
      platformReports: [
        platformArtifact(
          "windows-native",
          "code-intel-agent-uplift-platform/v1",
          "candidate-evidence/code-intel/agent-uplift/windows-native-report.json",
          "b",
        ),
        platformArtifact(
          "wsl2-linux",
          "code-intel-agent-uplift-platform/v1",
          "candidate-evidence/code-intel/agent-uplift/wsl2-linux-report.json",
          "c",
        ),
      ],
    },
    goCanary: {
      comparator: artifactReference(
        "code-intel-go-canary-comparator-report/v1",
        "candidate-evidence/code-intel/go-canary/comparator-report.json",
        "d",
      ),
      windowsNative: artifactReference(
        "code-intel-go-truth-set-report/v1",
        "candidate-evidence/code-intel/go-canary/windows-native-report.json",
        "e",
      ),
      wsl2Oci: artifactReference(
        "code-intel-go-oci-promotion-gate-report/v1",
        "candidate-evidence/code-intel/go-canary/wsl2-oci-report.json",
        "f",
      ),
    },
  };
}

function aggregateBinding() {
  return {
    manifestSha256: "a".repeat(64),
    reportSha256: "b".repeat(64),
    indexSha256: "c".repeat(64),
    source: repositoryIdentity("d"),
    harness: repositoryIdentity("e"),
  };
}

function platformArtifact(platform, schemaVersion, artifactPath, seed) {
  return {
    platform,
    ...artifactReference(schemaVersion, artifactPath, seed),
  };
}

function artifactReference(artifactSchemaVersion, artifactPath, seed) {
  return {
    artifactSchemaVersion,
    path: artifactPath,
    sha256: seed.repeat(64),
  };
}

function repositoryIdentity(seed) {
  return {
    commit: seed.repeat(40),
    workspaceDirty: false,
    lockfileSha256: seed.repeat(64),
    worktreeContentSha256: seed.repeat(64),
  };
}
