import path from "node:path";

import {
  PINNED_GOPLS_VERSION,
  probeGoplsToolchain,
  type GoplsCommandRunner,
  type GoplsProbeDiagnostic,
} from "./gopls-profile.js";
import {
  projectGoCanaryEligibility,
  type GoCanaryEligibilityProjection,
} from "./go-code-intel-eligibility.js";
import type { CodeIntelOperation } from "./types.js";

export type GoCodeIntelDoctorStatus =
  | "inactive"
  | "unavailable"
  | "incompatible"
  | "canary-ready";

export type GoCodeIntelDoctorDiagnostic = GoplsProbeDiagnostic | {
  code: "configuration_missing" | "command_path_invalid";
  message: string;
};

export interface GoCodeIntelDoctorReport {
  summary: {
    status: GoCodeIntelDoctorStatus;
    active: boolean;
    canaryReady: boolean;
    goCanaryEligible: boolean;
    productionEligible: false;
    headline: string;
  };
  configuration: {
    goplsCommandConfigured: boolean;
    goCommandConfigured: boolean;
  };
  toolchain: {
    pinnedGoplsVersion: typeof PINNED_GOPLS_VERSION;
    goplsVersion?: string;
    goVersion?: string;
    platform?: string;
  };
  governance: {
    capabilities: CodeIntelOperation[];
    dependencyRestore: "denied";
    networkPolicy: "environment-deny";
    sandboxStatus: "unverified";
    goCanaryEligible: boolean;
    productionEligible: false;
  };
  eligibility: GoCanaryEligibilityProjection;
  diagnostics: GoCodeIntelDoctorDiagnostic[];
}

export interface BuildGoCodeIntelDoctorReportOptions {
  environment?: Record<string, string | undefined>;
  runCommand?: GoplsCommandRunner;
  comparatorReport?: unknown;
}

const CAPABILITIES = [
  "symbols",
  "definition",
  "references",
  "implementation",
] as const satisfies readonly CodeIntelOperation[];

const BASE_GOVERNANCE = {
  capabilities: [...CAPABILITIES],
  dependencyRestore: "denied",
  networkPolicy: "environment-deny",
  sandboxStatus: "unverified",
  productionEligible: false,
} as const;

export async function buildGoCodeIntelDoctorReport(
  options: BuildGoCodeIntelDoctorReportOptions = {},
): Promise<GoCodeIntelDoctorReport> {
  const environment = options.environment ?? process.env;
  const active = isEnabled(environment.BELLDANDY_CODE_INTEL_GO_ENABLED);
  const goplsCommand = normalizeConfigValue(environment.BELLDANDY_CODE_INTEL_GOPLS_COMMAND);
  const goCommand = normalizeConfigValue(environment.BELLDANDY_CODE_INTEL_GO_COMMAND);
  const configuration = {
    goplsCommandConfigured: Boolean(goplsCommand),
    goCommandConfigured: Boolean(goCommand),
  };

  if (!active) {
    return buildReport({
      status: "inactive",
      active: false,
      configuration,
      diagnostics: [],
      eligibility: projectGoCanaryEligibility(options.comparatorReport),
    });
  }

  if (!goplsCommand || !goCommand) {
    return buildReport({
      status: "unavailable",
      active: true,
      configuration,
      diagnostics: [{
        code: "configuration_missing",
        message: "Go CodeIntel is enabled, but required executable configuration is missing.",
      }],
      eligibility: projectGoCanaryEligibility(options.comparatorReport),
    });
  }

  if (!path.isAbsolute(goplsCommand) || !path.isAbsolute(goCommand)) {
    return buildReport({
      status: "incompatible",
      active: true,
      configuration,
      diagnostics: [{
        code: "command_path_invalid",
        message: "Configured Go CodeIntel executables must use absolute paths.",
      }],
      eligibility: projectGoCanaryEligibility(options.comparatorReport),
    });
  }

  const probe = await probeGoplsToolchain({
    goplsCommand,
    goCommand,
    environment: pickProbeEnvironment(environment),
    ...(options.runCommand ? { runCommand: options.runCommand } : {}),
  });
  const status: GoCodeIntelDoctorStatus = probe.status === "available"
    ? "canary-ready"
    : probe.status;

  return buildReport({
    status,
    active: true,
    configuration,
    toolchain: {
      ...(probe.gopls.version ? { goplsVersion: probe.gopls.version } : {}),
      ...(probe.go.version ? { goVersion: probe.go.version } : {}),
      ...(probe.go.platform ? { platform: probe.go.platform } : {}),
    },
    diagnostics: probe.diagnostics,
    eligibility: projectGoCanaryEligibility(options.comparatorReport),
  });
}

function buildReport(input: {
  status: GoCodeIntelDoctorStatus;
  active: boolean;
  configuration: GoCodeIntelDoctorReport["configuration"];
  toolchain?: Omit<GoCodeIntelDoctorReport["toolchain"], "pinnedGoplsVersion">;
  diagnostics: GoCodeIntelDoctorDiagnostic[];
  eligibility: GoCanaryEligibilityProjection;
}): GoCodeIntelDoctorReport {
  return {
    summary: {
      status: input.status,
      active: input.active,
      canaryReady: input.status === "canary-ready",
      goCanaryEligible: input.eligibility.goCanaryEligible,
      productionEligible: false,
      headline: buildHeadline(input.status),
    },
    configuration: input.configuration,
    toolchain: {
      pinnedGoplsVersion: PINNED_GOPLS_VERSION,
      ...input.toolchain,
    },
    governance: {
      ...BASE_GOVERNANCE,
      capabilities: [...BASE_GOVERNANCE.capabilities],
      goCanaryEligible: input.eligibility.goCanaryEligible,
    },
    eligibility: input.eligibility,
    diagnostics: input.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function buildHeadline(status: GoCodeIntelDoctorStatus): string {
  switch (status) {
    case "inactive":
      return "Go CodeIntel canary is inactive.";
    case "unavailable":
      return "Go CodeIntel canary is enabled, but the pinned toolchain is unavailable.";
    case "incompatible":
      return "Go CodeIntel toolchain is incompatible with the pinned canary profile.";
    case "canary-ready":
      return "Go CodeIntel pinned toolchain is ready for canary use; production gates remain closed.";
  }
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function normalizeConfigValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function pickProbeEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["SystemRoot", "WINDIR"]) {
    const value = environment[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
