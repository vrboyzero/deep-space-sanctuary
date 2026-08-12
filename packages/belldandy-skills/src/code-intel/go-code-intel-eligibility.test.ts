import { describe, expect, it } from "vitest";

import { projectGoCanaryEligibility } from "./go-code-intel-eligibility.js";

describe("projectGoCanaryEligibility", () => {
  it("opens only for a complete passing comparator evidence", () => {
    expect(projectGoCanaryEligibility(passingComparatorReport())).toEqual({
      status: "proven",
      goCanaryEligible: true,
      productionEligible: false,
    });
  });

  it("fails closed for missing, invalid, or incomplete comparator evidence", () => {
    expect(projectGoCanaryEligibility(undefined)).toMatchObject({
      status: "unverified",
      goCanaryEligible: false,
      diagnosticCode: "comparator_missing",
    });
    expect(projectGoCanaryEligibility({ schemaVersion: "other" })).toMatchObject({
      status: "unverified",
      goCanaryEligible: false,
      diagnosticCode: "comparator_schema_invalid",
    });
    const failed = passingComparatorReport();
    failed.gate.passed = false;
    expect(projectGoCanaryEligibility(failed)).toMatchObject({
      status: "unverified",
      goCanaryEligible: false,
      diagnosticCode: "comparator_gate_failed",
    });
    const incomplete = passingComparatorReport();
    incomplete.evidence.wsl2Oci.rssPassed = false;
    expect(projectGoCanaryEligibility(incomplete)).toMatchObject({
      status: "unverified",
      goCanaryEligible: false,
      diagnosticCode: "comparator_evidence_incomplete",
    });
  });

  it("never projects production eligibility", () => {
    const report = passingComparatorReport();
    report.governance.productionEligible = true;
    expect(projectGoCanaryEligibility(report)).toMatchObject({
      goCanaryEligible: false,
      productionEligible: false,
      diagnosticCode: "comparator_evidence_incomplete",
    });
  });
});

function passingComparatorReport() {
  return {
    schemaVersion: "code-intel-go-canary-comparator-report/v1",
    identity: {
      truthSetId: "p1-a2-go-canary-v1",
      manifestSha256: "a".repeat(64),
      fixtureAggregateSha256: "b".repeat(64),
      matchedSharedRuntimeFileCount: 9,
    },
    toolchain: {
      goVersion: "go1.24.2",
      goplsVersion: "v0.21.0",
      windowsPlatform: "windows/amd64",
      ociPlatform: "linux/amd64",
    },
    truth: { caseCount: 6, positionCount: 10, matched: true },
    evidence: {
      windowsNative: {
        gatePassed: true,
        lifecyclePassed: true,
        responsePassed: true,
        concurrencyPassed: true,
        stateCleanupPassed: true,
      },
      wsl2Oci: {
        gatePassed: true,
        providerAdmissionPassed: true,
        inspectPassed: true,
        rssPassed: true,
        cleanupPassed: true,
        readinessTimelinePassed: true,
      },
    },
    gate: { passed: true, failures: [] },
    governance: { comparatorPassed: true, productionEligible: false },
  };
}
