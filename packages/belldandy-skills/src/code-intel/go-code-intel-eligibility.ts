export const GO_CANARY_COMPARATOR_REPORT_VERSION =
  "code-intel-go-canary-comparator-report/v1" as const;

export type GoCanaryEligibilityStatus = "proven" | "unverified";

export type GoCanaryEligibilityDiagnosticCode =
  | "comparator_missing"
  | "comparator_schema_invalid"
  | "comparator_gate_failed"
  | "comparator_evidence_incomplete";

export interface GoCanaryEligibilityProjection {
  status: GoCanaryEligibilityStatus;
  goCanaryEligible: boolean;
  productionEligible: false;
  diagnosticCode?: GoCanaryEligibilityDiagnosticCode;
}

export function projectGoCanaryEligibility(
  comparatorReport: unknown,
): GoCanaryEligibilityProjection {
  if (comparatorReport === undefined || comparatorReport === null) {
    return unverified("comparator_missing");
  }
  if (!isRecord(comparatorReport)
    || comparatorReport.schemaVersion !== GO_CANARY_COMPARATOR_REPORT_VERSION) {
    return unverified("comparator_schema_invalid");
  }
  if (!isRecord(comparatorReport.gate)
    || comparatorReport.gate.passed !== true
    || !Array.isArray(comparatorReport.gate.failures)
    || comparatorReport.gate.failures.length !== 0) {
    return unverified("comparator_gate_failed");
  }
  if (!hasCompletePassingEvidence(comparatorReport)) {
    return unverified("comparator_evidence_incomplete");
  }
  return {
    status: "proven",
    goCanaryEligible: true,
    productionEligible: false,
  };
}

function hasCompletePassingEvidence(report: Record<string, unknown>): boolean {
  const identity = record(report.identity);
  const toolchain = record(report.toolchain) ?? {};
  const truth = record(report.truth) ?? {};
  const evidence = record(report.evidence) ?? {};
  const windows = record(evidence.windowsNative);
  const oci = record(evidence.wsl2Oci);
  const governance = record(report.governance) ?? {};
  return identity?.truthSetId === "p1-a2-go-canary-v1"
    && isSha256(identity?.manifestSha256)
    && isSha256(identity?.fixtureAggregateSha256)
    && identity.matchedSharedRuntimeFileCount === 9
    && toolchain.goVersion === "go1.24.2"
    && toolchain.goplsVersion === "v0.21.0"
    && toolchain.windowsPlatform === "windows/amd64"
    && toolchain.ociPlatform === "linux/amd64"
    && truth.caseCount === 6
    && truth.positionCount === 10
    && truth.matched === true
    && allTrue(windows, [
      "gatePassed", "lifecyclePassed", "responsePassed", "concurrencyPassed", "stateCleanupPassed",
    ])
    && allTrue(oci, [
      "gatePassed", "providerAdmissionPassed", "inspectPassed", "rssPassed", "cleanupPassed",
      "readinessTimelinePassed",
    ])
    && governance?.comparatorPassed === true
    && governance.productionEligible === false;
}

function allTrue(recordValue: Record<string, unknown> | undefined, keys: string[]): boolean {
  return recordValue !== undefined && keys.every((key) => recordValue[key] === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function unverified(
  diagnosticCode: GoCanaryEligibilityDiagnosticCode,
): GoCanaryEligibilityProjection {
  return {
    status: "unverified",
    goCanaryEligible: false,
    productionEligible: false,
    diagnosticCode,
  };
}
