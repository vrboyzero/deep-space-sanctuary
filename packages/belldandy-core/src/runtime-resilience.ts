import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { FailoverExecutionStatus, FailoverExecutionSummary } from "@belldandy/agent";

export type RuntimeResilienceRoute = {
  profileId: string;
  provider: string;
  model: string;
  protocol?: string;
  wireApi?: string;
};

export type RuntimeResilienceDoctorReport = {
  version: 1;
  updatedAt: number;
  routing: {
    primary: RuntimeResilienceRoute;
    fallbacks: RuntimeResilienceRoute[];
    compaction?: {
      configured: boolean;
      sharesPrimaryRoute: boolean;
      route?: RuntimeResilienceRoute;
      auxSummaryVerdict?: {
        strategy: "deepseek_flash_preferred" | "configured_route" | "manual_override" | "default_primary";
        enabled: boolean;
        reason: string;
      };
    };
  };
  totals: {
    observedRuns: number;
    degradedRuns: number;
    failedRuns: number;
    sameProfileRetries: number;
    crossProfileFallbacks: number;
    cooldownSkips: number;
    terminalFailures: number;
  };
  summary: {
    available: boolean;
    configuredFallbackCount: number;
    lastOutcome: "idle" | FailoverExecutionStatus;
    headline: string;
  };
  reasonCounts: Record<string, number>;
  latest?: {
    source: "openai_chat" | "tool_agent" | "compaction";
    phase: string;
    agentId?: string;
    conversationId?: string;
    finalStatus: FailoverExecutionStatus;
    finalProfileId?: string;
    finalProvider?: string;
    finalModel?: string;
    finalReason?: string;
    requestCount: number;
    failedStageCount: number;
    degraded: boolean;
    stepCounts: {
      cooldownSkips: number;
      sameProfileRetries: number;
      crossProfileFallbacks: number;
      terminalFailures: number;
    };
    reasonCounts: Record<string, number>;
    updatedAt: number;
    headline: string;
  };
};

type RuntimeResilienceEvent = {
  source: "openai_chat" | "tool_agent" | "compaction";
  phase: string;
  agentId?: string;
  conversationId?: string;
  summary: FailoverExecutionSummary;
};

const REPORT_VERSION = 1 as const;

function normalizeString(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function cloneRoute(route: RuntimeResilienceRoute): RuntimeResilienceRoute {
  return {
    profileId: route.profileId,
    provider: route.provider,
    model: route.model,
    ...(route.protocol ? { protocol: route.protocol } : {}),
    ...(route.wireApi ? { wireApi: route.wireApi } : {}),
  };
}

function cloneReport(report: RuntimeResilienceDoctorReport): RuntimeResilienceDoctorReport {
  return {
    version: REPORT_VERSION,
    updatedAt: report.updatedAt,
    routing: {
      primary: cloneRoute(report.routing.primary),
      fallbacks: report.routing.fallbacks.map(cloneRoute),
      ...(report.routing.compaction
        ? {
          compaction: {
            configured: report.routing.compaction.configured,
            sharesPrimaryRoute: report.routing.compaction.sharesPrimaryRoute,
            ...(report.routing.compaction.route ? { route: cloneRoute(report.routing.compaction.route) } : {}),
            ...(report.routing.compaction.auxSummaryVerdict
              ? {
                auxSummaryVerdict: {
                  strategy: report.routing.compaction.auxSummaryVerdict.strategy,
                  enabled: report.routing.compaction.auxSummaryVerdict.enabled,
                  reason: report.routing.compaction.auxSummaryVerdict.reason,
                },
              }
              : {}),
          },
        }
        : {}),
    },
    totals: { ...report.totals },
    summary: { ...report.summary },
    reasonCounts: { ...report.reasonCounts },
    ...(report.latest
      ? {
        latest: {
          ...report.latest,
          stepCounts: { ...report.latest.stepCounts },
          reasonCounts: { ...report.latest.reasonCounts },
        },
      }
      : {}),
  };
}

function buildLatestHeadline(summary: FailoverExecutionSummary): string {
  const counts = summary.stepCounts;
  const routeLabel = summary.finalProfileId
    ? `${summary.finalProfileId}/${summary.finalModel ?? "-"}`
    : "unknown route";
  if (summary.finalStatus === "success" && !summary.degraded) {
    return `Latest run stayed on primary route (${routeLabel}).`;
  }
  if (summary.finalStatus === "success") {
    return `Latest run recovered via fallback (${routeLabel}); retry=${counts.sameProfileRetries}, switch=${counts.crossProfileFallbacks}, cooldown=${counts.cooldownSkips}.`;
  }
  if (summary.finalStatus === "non_retryable") {
    return `Latest run stopped on non-retryable ${summary.finalReason ?? "error"} (${routeLabel}).`;
  }
  if (summary.finalStatus === "exhausted") {
    return `Latest run exhausted all configured routes; retry=${counts.sameProfileRetries}, switch=${counts.crossProfileFallbacks}.`;
  }
  return "Latest run was aborted before failover finished.";
}

function buildSummaryHeadline(report: RuntimeResilienceDoctorReport): string {
  const primary = report.routing.primary;
  const fallbackCount = report.routing.fallbacks.length;
  const prefix = `Primary ${primary.provider}/${primary.model}, ${fallbackCount} fallback profile(s) configured.`;
  if (!report.latest) {
    return `${prefix} No runtime failover signal yet.`;
  }
  return `${prefix} ${report.latest.headline}`;
}

function createReport(input: RuntimeResilienceDoctorReport["routing"]): RuntimeResilienceDoctorReport {
  const base: RuntimeResilienceDoctorReport = {
    version: REPORT_VERSION,
    updatedAt: Date.now(),
    routing: {
      primary: cloneRoute(input.primary),
      fallbacks: input.fallbacks.map(cloneRoute),
      ...(input.compaction
        ? {
          compaction: {
            configured: input.compaction.configured,
            sharesPrimaryRoute: input.compaction.sharesPrimaryRoute,
            ...(input.compaction.route ? { route: cloneRoute(input.compaction.route) } : {}),
            ...(input.compaction.auxSummaryVerdict
              ? {
                auxSummaryVerdict: {
                  strategy: input.compaction.auxSummaryVerdict.strategy,
                  enabled: input.compaction.auxSummaryVerdict.enabled,
                  reason: input.compaction.auxSummaryVerdict.reason,
                },
              }
              : {}),
          },
        }
        : {}),
    },
    totals: {
      observedRuns: 0,
      degradedRuns: 0,
      failedRuns: 0,
      sameProfileRetries: 0,
      crossProfileFallbacks: 0,
      cooldownSkips: 0,
      terminalFailures: 0,
    },
    summary: {
      available: true,
      configuredFallbackCount: input.fallbacks.length,
      lastOutcome: "idle",
      headline: "",
    },
    reasonCounts: {},
  };
  base.summary.headline = buildSummaryHeadline(base);
  return base;
}

function normalizeRoute(value: unknown): RuntimeResilienceRoute | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const profileId = normalizeString(record.profileId);
  const provider = normalizeString(record.provider);
  const model = normalizeString(record.model);
  if (!profileId || !provider || !model) return undefined;
  return {
    profileId,
    provider,
    model,
    ...(normalizeString(record.protocol) ? { protocol: normalizeString(record.protocol) } : {}),
    ...(normalizeString(record.wireApi) ? { wireApi: normalizeString(record.wireApi) } : {}),
  };
}

function normalizeReport(value: unknown): RuntimeResilienceDoctorReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const primary = normalizeRoute((record.routing as Record<string, unknown> | undefined)?.primary);
  const fallbacksRaw = (record.routing as Record<string, unknown> | undefined)?.fallbacks;
  const fallbacks = Array.isArray(fallbacksRaw)
    ? fallbacksRaw.map(normalizeRoute).filter((item): item is RuntimeResilienceRoute => Boolean(item))
    : [];
  if (!primary) return undefined;
  const compactionRaw = (record.routing as Record<string, unknown> | undefined)?.compaction;
  const report = createReport({
    primary,
    fallbacks,
    ...(compactionRaw && typeof compactionRaw === "object" && !Array.isArray(compactionRaw)
      ? {
        compaction: {
          configured: (compactionRaw as Record<string, unknown>).configured === true,
          sharesPrimaryRoute: (compactionRaw as Record<string, unknown>).sharesPrimaryRoute === true,
          ...(normalizeRoute((compactionRaw as Record<string, unknown>).route)
            ? { route: normalizeRoute((compactionRaw as Record<string, unknown>).route) }
            : {}),
          ...(() => {
            const verdict = (compactionRaw as Record<string, unknown>).auxSummaryVerdict;
            if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) {
              return {};
            }
            const verdictRecord = verdict as Record<string, unknown>;
            const strategy = normalizeString(verdictRecord.strategy);
            const reason = normalizeString(verdictRecord.reason);
            if (!strategy || !reason) {
              return {};
            }
            return {
              auxSummaryVerdict: {
                strategy: strategy as "deepseek_flash_preferred" | "configured_route" | "manual_override" | "default_primary",
                enabled: verdictRecord.enabled === true,
                reason,
              },
            };
          })(),
        },
      }
      : {}),
  });

  const totals = record.totals as Record<string, unknown> | undefined;
  if (totals) {
    report.totals.observedRuns = toCount(totals.observedRuns);
    report.totals.degradedRuns = toCount(totals.degradedRuns);
    report.totals.failedRuns = toCount(totals.failedRuns);
    report.totals.sameProfileRetries = toCount(totals.sameProfileRetries);
    report.totals.crossProfileFallbacks = toCount(totals.crossProfileFallbacks);
    report.totals.cooldownSkips = toCount(totals.cooldownSkips);
    report.totals.terminalFailures = toCount(totals.terminalFailures);
  }

  const latest = record.latest as Record<string, unknown> | undefined;
  if (latest) {
    const finalStatus = normalizeString(latest.finalStatus) as FailoverExecutionStatus | undefined;
    if (finalStatus) {
      const latestSource = normalizeString(latest.source) as "openai_chat" | "tool_agent" | "compaction" | undefined;
      report.latest = {
        source: latestSource ?? "openai_chat",
        phase: normalizeString(latest.phase) ?? "unknown",
        ...(normalizeString(latest.agentId) ? { agentId: normalizeString(latest.agentId) } : {}),
        ...(normalizeString(latest.conversationId) ? { conversationId: normalizeString(latest.conversationId) } : {}),
        finalStatus,
        ...(normalizeString(latest.finalProfileId) ? { finalProfileId: normalizeString(latest.finalProfileId) } : {}),
        ...(normalizeString(latest.finalProvider) ? { finalProvider: normalizeString(latest.finalProvider) } : {}),
        ...(normalizeString(latest.finalModel) ? { finalModel: normalizeString(latest.finalModel) } : {}),
        ...(normalizeString(latest.finalReason) ? { finalReason: normalizeString(latest.finalReason) } : {}),
        requestCount: toCount(latest.requestCount),
        failedStageCount: toCount(latest.failedStageCount),
        degraded: latest.degraded === true,
        stepCounts: {
          cooldownSkips: toCount((latest.stepCounts as Record<string, unknown> | undefined)?.cooldownSkips),
          sameProfileRetries: toCount((latest.stepCounts as Record<string, unknown> | undefined)?.sameProfileRetries),
          crossProfileFallbacks: toCount((latest.stepCounts as Record<string, unknown> | undefined)?.crossProfileFallbacks),
          terminalFailures: toCount((latest.stepCounts as Record<string, unknown> | undefined)?.terminalFailures),
        },
        reasonCounts: normalizeReasonCounts(latest.reasonCounts),
        updatedAt: toCount(latest.updatedAt) || Date.now(),
        headline: normalizeString(latest.headline) ?? "Latest runtime signal available.",
      };
    }
  }

  report.updatedAt = toCount(record.updatedAt) || Date.now();
  report.reasonCounts = normalizeReasonCounts(record.reasonCounts);
  report.summary = {
    available: true,
    configuredFallbackCount: fallbacks.length,
    lastOutcome: report.latest?.finalStatus ?? "idle",
    headline: buildSummaryHeadline(report),
  };
  return report;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeReasonCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) continue;
    output[normalizedKey] = toCount(count);
  }
  return output;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
  await fsp.rename(tempPath, filePath);
}

export function resolveRuntimeResilienceReportPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), "diagnostics", "runtime-resilience.json");
}

export async function readRuntimeResilienceDoctorReport(
  stateDir: string,
): Promise<RuntimeResilienceDoctorReport | undefined> {
  try {
    const raw = await fsp.readFile(resolveRuntimeResilienceReportPath(stateDir), "utf-8");
    const parsed = raw.trim() ? JSON.parse(raw) as unknown : undefined;
    return normalizeReport(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export class RuntimeResilienceTracker {
  private readonly filePath: string;
  private report: RuntimeResilienceDoctorReport;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(input: {
    stateDir: string;
    routing: RuntimeResilienceDoctorReport["routing"];
  }) {
    this.filePath = resolveRuntimeResilienceReportPath(input.stateDir);
    const persisted = this.readPersisted();
    this.report = persisted
      ? {
        ...persisted,
        routing: createReport(input.routing).routing,
      }
      : createReport(input.routing);
    this.report.summary = {
      available: true,
      configuredFallbackCount: this.report.routing.fallbacks.length,
      lastOutcome: this.report.latest?.finalStatus ?? "idle",
      headline: buildSummaryHeadline(this.report),
    };
    this.persist();
  }

  record(event: RuntimeResilienceEvent): void {
    const summary = event.summary;
    this.report.updatedAt = summary.updatedAt;
    this.report.totals.observedRuns += 1;
    this.report.totals.sameProfileRetries += summary.stepCounts.sameProfileRetries;
    this.report.totals.crossProfileFallbacks += summary.stepCounts.crossProfileFallbacks;
    this.report.totals.cooldownSkips += summary.stepCounts.cooldownSkips;
    this.report.totals.terminalFailures += summary.stepCounts.terminalFailures;
    if (summary.degraded) {
      this.report.totals.degradedRuns += 1;
    }
    if (summary.finalStatus !== "success") {
      this.report.totals.failedRuns += 1;
    }
    for (const [reason, count] of Object.entries(summary.reasonCounts)) {
      this.report.reasonCounts[reason] = (this.report.reasonCounts[reason] ?? 0) + toCount(count);
    }
    this.report.latest = {
      source: event.source,
      phase: event.phase,
      ...(normalizeString(event.agentId) ? { agentId: normalizeString(event.agentId) } : {}),
      ...(normalizeString(event.conversationId) ? { conversationId: normalizeString(event.conversationId) } : {}),
      finalStatus: summary.finalStatus,
      ...(normalizeString(summary.finalProfileId) ? { finalProfileId: normalizeString(summary.finalProfileId) } : {}),
      ...(normalizeString(summary.finalProvider) ? { finalProvider: normalizeString(summary.finalProvider) } : {}),
      ...(normalizeString(summary.finalModel) ? { finalModel: normalizeString(summary.finalModel) } : {}),
      ...(normalizeString(summary.finalReason) ? { finalReason: normalizeString(summary.finalReason) } : {}),
      requestCount: summary.requestCount,
      failedStageCount: summary.failedStageCount,
      degraded: summary.degraded,
      stepCounts: { ...summary.stepCounts },
      reasonCounts: normalizeReasonCounts(summary.reasonCounts),
      updatedAt: summary.updatedAt,
      headline: buildLatestHeadline(summary),
    };
    this.report.summary = {
      available: true,
      configuredFallbackCount: this.report.routing.fallbacks.length,
      lastOutcome: summary.finalStatus,
      headline: buildSummaryHeadline(this.report),
    };
    this.persist();
  }

  getReport(): RuntimeResilienceDoctorReport {
    return cloneReport(this.report);
  }

  async waitForPendingWrite(): Promise<void> {
    await this.writeQueue;
  }

  private readPersisted(): RuntimeResilienceDoctorReport | undefined {
    try {
      if (!fs.existsSync(this.filePath)) {
        return undefined;
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = raw.trim() ? JSON.parse(raw) as unknown : undefined;
      return normalizeReport(parsed);
    } catch {
      return undefined;
    }
  }

  private persist(): void {
    const snapshot = cloneReport(this.report);
    const next = this.writeQueue.then(async () => {
      await writeJsonAtomic(this.filePath, snapshot);
    });
    this.writeQueue = next.then(() => undefined, () => undefined);
  }
}
