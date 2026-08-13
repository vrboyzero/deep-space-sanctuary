import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  TypeScriptLanguageServiceProvider,
  buildGoCodeIntelDoctorReport,
  probeLocalOciImage,
  probeOciCommandSandboxRuntime,
  resolveOciCommandSandboxConfig,
  type GoCodeIntelDoctorReport,
  type OciCommandSandboxConfig,
  type OciRuntimeProbeResult,
} from "@belldandy/skills";

import {
  buildOptionalCapabilitiesDoctorReport,
  type OptionalCapabilitiesDoctorReport,
} from "./optional-capabilities-doctor.js";

export const CODING_RUNTIME_PREFLIGHT_DOCTOR_SCHEMA_VERSION = "coding-runtime-preflight-doctor/v1" as const;

export type CodingRuntimePreflightStatus =
  | "inactive"
  | "available"
  | "degraded"
  | "unavailable"
  | "incompatible"
  | "unknown";

export type CodingRuntimePreflightItemId =
  | "oci_configuration"
  | "oci_runtime"
  | "oci_local_image"
  | "native_pty"
  | "process_tree_cleanup"
  | "persisted_sandbox_leases"
  | "typescript_javascript"
  | "go_gopls";

export interface CodingRuntimePreflightDoctorItem {
  id: CodingRuntimePreflightItemId;
  name: string;
  active: boolean;
  required: boolean;
  status: CodingRuntimePreflightStatus;
  reasonCode: string;
  blocking: boolean;
  details?: Record<string, string | number | boolean>;
  setup?: {
    action: string;
    commands: string[];
  };
}

export interface CodingRuntimePreflightDoctorReport {
  schemaVersion: typeof CODING_RUNTIME_PREFLIGHT_DOCTOR_SCHEMA_VERSION;
  summary: {
    startupReady: boolean;
    activeCount: number;
    requiredCount: number;
    availableCount: number;
    blockingCount: number;
    headline: string;
  };
  languages: {
    enabled: string[];
    available: string[];
    unavailable: string[];
  };
  items: CodingRuntimePreflightDoctorItem[];
}

type OptionalCapabilitiesProjection = {
  items: Array<Pick<OptionalCapabilitiesDoctorReport["items"][number], "id" | "mode" | "status">>;
};
type GoCodeIntelProjection = {
  summary: Pick<GoCodeIntelDoctorReport["summary"], "active" | "status" | "canaryReady">;
};

export interface BuildCodingRuntimePreflightDoctorReportOptions {
  stateDir: string;
  environment?: Record<string, string | undefined>;
  optionalCapabilities?: OptionalCapabilitiesProjection;
  goCodeIntel?: GoCodeIntelProjection;
  probeRuntime?: (config: OciCommandSandboxConfig) => Promise<OciRuntimeProbeResult>;
  probeImage?: (config: OciCommandSandboxConfig) => Promise<OciRuntimeProbeResult>;
  probeProcessTreeCleanup?: () => Promise<{ available: boolean }> | { available: boolean };
  probeTypeScriptToolchain?: () => { available: boolean; version?: string };
}

type PersistedLeaseSummary = {
  recordCount: number;
  activeLeaseCount: number;
  invalidRecordCount: number;
};

/**
 * Builds one read-only startup projection. Probes are limited to module loading,
 * OCI `version` / local `image inspect`, and bounded state metadata reads.
 */
export async function buildCodingRuntimePreflightDoctorReport(
  options: BuildCodingRuntimePreflightDoctorReportOptions,
): Promise<CodingRuntimePreflightDoctorReport> {
  const environment = options.environment ?? process.env;
  const toolsActive = isEnabled(environment.BELLDANDY_TOOLS_ENABLED);
  const goActive = isEnabled(environment.BELLDANDY_CODE_INTEL_GO_ENABLED);

  if (!toolsActive && !goActive) {
    return buildReport(inactiveItems(), []);
  }

  const [optionalCapabilities, goCodeIntel] = await Promise.all([
    options.optionalCapabilities ?? buildOptionalCapabilitiesDoctorReport({ env: environment }),
    options.goCodeIntel ?? buildGoCodeIntelDoctorReport({ environment }),
  ]);
  const items: CodingRuntimePreflightDoctorItem[] = [];

  if (toolsActive) {
    items.push(...await buildSandboxItems({
      environment,
      probeRuntime: options.probeRuntime ?? probeOciCommandSandboxRuntime,
      probeImage: options.probeImage ?? probeLocalOciImage,
    }));
    items.push(buildPtyItem(optionalCapabilities));
    items.push(await buildProcessTreeCleanupItem(options.probeProcessTreeCleanup));
    items.push(await buildPersistedLeaseItem(options.stateDir));
    items.push(buildTypeScriptItem(options.probeTypeScriptToolchain));
  } else {
    items.push(...inactiveItems().filter((item) => item.id !== "go_gopls"));
  }

  items.push(buildGoItem(goActive, goCodeIntel));
  const enabledLanguages = [
    ...(toolsActive ? ["typescript/javascript"] : []),
    ...(goActive ? ["go"] : []),
  ];
  return buildReport(items, enabledLanguages);
}

function inactiveItems(): CodingRuntimePreflightDoctorItem[] {
  return [
    inactive("oci_configuration", "OCI Sandbox Configuration"),
    inactive("oci_runtime", "OCI Runtime"),
    inactive("oci_local_image", "OCI Local Image"),
    inactive("native_pty", "Native PTY"),
    inactive("process_tree_cleanup", "Process-tree Cleanup"),
    inactive("persisted_sandbox_leases", "Persisted Sandbox Leases"),
    inactive("typescript_javascript", "TypeScript/JavaScript Toolchain"),
    inactive("go_gopls", "Go/gopls Toolchain"),
  ];
}

function inactive(id: CodingRuntimePreflightItemId, name: string): CodingRuntimePreflightDoctorItem {
  return {
    id,
    name,
    active: false,
    required: false,
    status: "inactive",
    reasonCode: "not_enabled",
    blocking: false,
  };
}

async function buildSandboxItems(input: {
  environment: Record<string, string | undefined>;
  probeRuntime: (config: OciCommandSandboxConfig) => Promise<OciRuntimeProbeResult>;
  probeImage: (config: OciCommandSandboxConfig) => Promise<OciRuntimeProbeResult>;
}): Promise<CodingRuntimePreflightDoctorItem[]> {
  const readEnv = (name: string) => input.environment[name];
  const config = resolveOciCommandSandboxConfig({ readEnv });
  if (!config) {
    const configured = normalize(input.environment.BELLDANDY_COMMAND_SANDBOX_BACKEND) !== undefined;
    const reasonCode = configured ? "invalid_configuration" : "not_configured";
    const status = configured ? "incompatible" as const : "unavailable" as const;
    return [
      item("oci_configuration", "OCI Sandbox Configuration", status, reasonCode, true, true, {
        action: "Configure a digest-pinned OCI sandbox backend before starting coding tasks.",
        commands: ["bdd doctor --json"],
      }),
      dependencyUnknown("oci_runtime", "OCI Runtime", "configuration_unavailable"),
      dependencyUnknown("oci_local_image", "OCI Local Image", "configuration_unavailable"),
    ];
  }

  const runtime = await safeProbe(() => input.probeRuntime(config));
  const runtimeItem = runtime.available
    ? item("oci_runtime", "OCI Runtime", "available", "runtime_available", true, false, {
      action: "Re-run the local runtime control-plane probe.",
      commands: [`${config.runtime} version --format {{.Server.Version}}`],
    })
    : item("oci_runtime", "OCI Runtime", "unavailable", "runtime_unavailable", true, true, {
      action: "Start or repair the configured OCI runtime, then repeat the read-only probe.",
      commands: [`${config.runtime} version --format {{.Server.Version}}`],
    });

  let imageItem: CodingRuntimePreflightDoctorItem;
  if (!runtime.available) {
    imageItem = dependencyUnknown("oci_local_image", "OCI Local Image", "runtime_probe_failed");
  } else {
    const image = await safeProbe(() => input.probeImage(config));
    imageItem = image.available
      ? item("oci_local_image", "OCI Local Image", "available", "local_image_available", true, false, {
        action: "Re-run local image inspection without pulling or starting a container.",
        commands: [`${config.runtime} image inspect --format {{.Id}} <configured-digest-image>`],
      })
      : item("oci_local_image", "OCI Local Image", "unavailable", "local_image_unavailable", true, true, {
        action: "Provision the configured digest-pinned image through the approved offline/setup flow.",
        commands: [`${config.runtime} image inspect --format {{.Id}} <configured-digest-image>`],
      });
  }

  return [
    item("oci_configuration", "OCI Sandbox Configuration", "available", "configuration_valid", true, false),
    runtimeItem,
    imageItem,
  ];
}

function buildPtyItem(optionalCapabilities: OptionalCapabilitiesProjection): CodingRuntimePreflightDoctorItem {
  const pty = optionalCapabilities.items.find((entry) => entry.id === "pty");
  const available = pty?.mode === "ready";
  return available
    ? item("native_pty", "Native PTY", "available", "native_pty_available", true, false)
    : item("native_pty", "Native PTY", "degraded", "native_pty_unavailable", true, false, {
      action: "Rebuild the existing optional PTY dependency when full terminal fidelity is required.",
      commands: ["corepack pnpm --filter @belldandy/skills rebuild node-pty", "bdd doctor --json"],
    });
}

async function buildProcessTreeCleanupItem(
  probe?: BuildCodingRuntimePreflightDoctorReportOptions["probeProcessTreeCleanup"],
): Promise<CodingRuntimePreflightDoctorItem> {
  const result = await safeProbe(async () => (
    probe ? await probe() : { available: isSupportedProcessTreePlatform(process.platform) }
  ));
  return result.available
    ? item("process_tree_cleanup", "Process-tree Cleanup", "available", "cleanup_supported", true, false)
    : item("process_tree_cleanup", "Process-tree Cleanup", "unavailable", "cleanup_unavailable", true, true, {
      action: "Use a supported runtime platform with process-group or taskkill tree termination.",
      commands: ["node -p process.platform", "bdd doctor --json"],
    });
}

async function buildPersistedLeaseItem(stateDir: string): Promise<CodingRuntimePreflightDoctorItem> {
  const summary = await readPersistedLeaseSummary(stateDir);
  if (summary.activeLeaseCount > 0) {
    return {
      ...item(
        "persisted_sandbox_leases",
        "Persisted Sandbox Leases",
        "degraded",
        "lease_reconciliation_required",
        true,
        false,
        {
          action: "Start the Gateway owner to reconcile persisted command leases, then run Doctor again.",
          commands: ["bdd doctor --json"],
        },
      ),
      details: summary,
    };
  }
  if (summary.invalidRecordCount > 0) {
    return {
      ...item(
        "persisted_sandbox_leases",
        "Persisted Sandbox Leases",
        "unknown",
        "lease_records_invalid",
        true,
        false,
        {
          action: "Inspect command-job state through the owning runtime; Doctor will not mutate invalid records.",
          commands: ["bdd doctor --json"],
        },
      ),
      details: summary,
    };
  }
  return {
    ...item(
      "persisted_sandbox_leases",
      "Persisted Sandbox Leases",
      "available",
      "no_pending_reconciliation",
      true,
      false,
    ),
    details: summary,
  };
}

function buildTypeScriptItem(
  probe?: BuildCodingRuntimePreflightDoctorReportOptions["probeTypeScriptToolchain"],
): CodingRuntimePreflightDoctorItem {
  let result: { available: boolean; version?: string };
  try {
    result = probe ? probe() : probeTypeScriptLanguageService();
  } catch {
    result = { available: false };
  }
  return result.available
    ? {
      ...item(
        "typescript_javascript",
        "TypeScript/JavaScript Toolchain",
        "available",
        "typescript_language_service_available",
        true,
        false,
      ),
      ...(result.version ? { details: { providerVersion: sanitizeVersion(result.version) } } : {}),
    }
    : item(
      "typescript_javascript",
      "TypeScript/JavaScript Toolchain",
      "unavailable",
      "typescript_language_service_unavailable",
      true,
      true,
      {
        action: "Restore the workspace-pinned TypeScript dependency and rebuild Skills.",
        commands: ["corepack pnpm --filter @belldandy/skills build", "bdd doctor --json"],
      },
    );
}

function buildGoItem(active: boolean, report: GoCodeIntelProjection): CodingRuntimePreflightDoctorItem {
  if (!active) return inactive("go_gopls", "Go/gopls Toolchain");
  if (report.summary.status === "canary-ready") {
    return item("go_gopls", "Go/gopls Toolchain", "available", "go_canary_ready", true, false);
  }
  const status = report.summary.status === "incompatible" ? "incompatible" : "unavailable";
  return item("go_gopls", "Go/gopls Toolchain", status, `go_${report.summary.status}`, true, true, {
    action: "Configure the pinned Go/gopls canary toolchain with absolute executable paths.",
    commands: ["bdd doctor --json"],
  });
}

function buildReport(
  items: CodingRuntimePreflightDoctorItem[],
  enabledLanguages: string[],
): CodingRuntimePreflightDoctorReport {
  const active = items.filter((entry) => entry.active);
  const blockingCount = active.filter((entry) => entry.blocking).length;
  const availableLanguages = [
    ...(isAvailable(items, "typescript_javascript") ? ["typescript/javascript"] : []),
    ...(isAvailable(items, "go_gopls") ? ["go"] : []),
  ];
  const unavailableLanguages = enabledLanguages.filter((language) => !availableLanguages.includes(language));
  return {
    schemaVersion: CODING_RUNTIME_PREFLIGHT_DOCTOR_SCHEMA_VERSION,
    summary: {
      startupReady: blockingCount === 0,
      activeCount: active.length,
      requiredCount: active.filter((entry) => entry.required).length,
      availableCount: active.filter((entry) => entry.status === "available").length,
      blockingCount,
      headline: active.length === 0
        ? "Coding runtime prerequisites are inactive."
        : blockingCount === 0
        ? "Active coding runtime prerequisites are ready; degraded optional paths remain explicit."
        : `${blockingCount} coding runtime prerequisite(s) block a fully capable startup.`,
    },
    languages: {
      enabled: enabledLanguages,
      available: availableLanguages,
      unavailable: unavailableLanguages,
    },
    items,
  };
}

function item(
  id: CodingRuntimePreflightItemId,
  name: string,
  status: CodingRuntimePreflightStatus,
  reasonCode: string,
  required: boolean,
  blocking: boolean,
  setup?: CodingRuntimePreflightDoctorItem["setup"],
): CodingRuntimePreflightDoctorItem {
  return {
    id,
    name,
    active: true,
    required,
    status,
    reasonCode,
    blocking,
    ...(setup ? { setup } : {}),
  };
}

function dependencyUnknown(
  id: CodingRuntimePreflightItemId,
  name: string,
  reasonCode: string,
): CodingRuntimePreflightDoctorItem {
  return item(id, name, "unknown", reasonCode, true, false);
}

async function readPersistedLeaseSummary(stateDir: string): Promise<PersistedLeaseSummary> {
  const directory = path.join(path.resolve(stateDir), "command-jobs");
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    return isMissingPath(error)
      ? { recordCount: 0, activeLeaseCount: 0, invalidRecordCount: 0 }
      : { recordCount: 0, activeLeaseCount: 0, invalidRecordCount: 1 };
  }

  const jsonEntries = entries.filter((entry) => entry.endsWith(".json"));
  let activeLeaseCount = 0;
  let invalidRecordCount = 0;
  for (const entry of jsonEntries) {
    try {
      const raw = await readFile(path.join(directory, entry), "utf8");
      const record = JSON.parse(raw) as unknown;
      if (!isCommandJobLeaseRecord(record)) {
        invalidRecordCount += 1;
      } else if ((record.status === "starting" || record.status === "running") && record.persistedSandbox) {
        activeLeaseCount += 1;
      }
    } catch {
      invalidRecordCount += 1;
    }
  }
  return { recordCount: jsonEntries.length, activeLeaseCount, invalidRecordCount };
}

function isCommandJobLeaseRecord(value: unknown): value is {
  status: string;
  persistedSandbox?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.jobId === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.jobId)
    && ["starting", "running", "completed", "cancelled", "failed", "lost"].includes(String(record.status));
}

function probeTypeScriptLanguageService(): { available: boolean; version?: string } {
  const provider = new TypeScriptLanguageServiceProvider();
  try {
    return {
      available: provider.profile.status === "available",
      version: provider.profile.version,
    };
  } finally {
    provider.dispose();
  }
}

async function safeProbe(probe: () => Promise<{ available: boolean }>): Promise<{ available: boolean }> {
  try {
    const result = await probe();
    return { available: result.available === true };
  } catch {
    return { available: false };
  }
}

function isAvailable(items: CodingRuntimePreflightDoctorItem[], id: CodingRuntimePreflightItemId): boolean {
  return items.some((entry) => entry.id === id && entry.status === "available");
}

function isSupportedProcessTreePlatform(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "linux" || platform === "darwin";
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function sanitizeVersion(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length <= 64 ? normalized : normalized.slice(0, 64);
}

function isMissingPath(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
