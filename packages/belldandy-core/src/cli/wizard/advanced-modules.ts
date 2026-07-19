/**
 * Advanced module wizards for `bdd configure <module>`.
 * Install-time `bdd setup` no longer enters this module chain directly.
 */
import fs from "node:fs/promises";
import path from "node:path";

import * as p from "@clack/prompts";
import WebSocket from "ws";
import {
  loadCommunityConfig,
  removeAgentConfig,
  saveCommunityConfig,
} from "@belldandy/channels";
import type { CommunityAgentConfig } from "@belldandy/channels";
import {
  readModelFallbackConfig,
  resolveModelFallbackConfigPath,
  writeModelFallbackConfig,
} from "../../model-fallback-config.js";
import { CronStore } from "../../cron/index.js";
import type { CronJob, CronPayload, CronSchedule, CronSessionTarget } from "../../cron/index.js";
import { approvePairingCode } from "../../security/store.js";
import { updateEnvValue, removeEnvValue, parseEnvFile } from "../shared/env-loader.js";
import { generatePromptFromPayload, loadWebhookConfig } from "../../webhook/config.js";
import type { WebhookConfig } from "../../webhook/types.js";
import {
  removeCommunityAgents,
  sortCommunityAgents,
  updateCommunityAgentsOffice,
  updateCommunityAgentsRoom,
  type CommunityOrganizeAction,
} from "./advanced-modules-community-organize.js";
import { buildCommunityReconnectOfficeDiagnostics } from "./advanced-modules-community-diagnostics.js";
import {
  buildModelCatalogPickerLinkLines,
  buildModelProviderProtocolDiagnostics,
} from "./advanced-modules-models-diagnostics.js";
import {
  applyModelFallbackAdvancedBatchPatch,
  promptModelFallbackIdsToManage,
  promptModelFallbackAdvancedBatchPatch,
  summarizeModelFallbackAdvancedBatchPatch,
} from "./advanced-modules-models-organize.js";
import {
  buildPreferredProviderConfigPreviewLines,
  summarizePreferredProviderConfig,
  validatePreferredProviderInput,
} from "./advanced-modules-models-preferred-providers.js";
import {
  buildWebhookOrganizeSelectionLabel,
  buildWebhookOrganizePreviewLines,
  buildWebhookOrganizeCriteriaFromFilterMode,
  buildWebhookOrganizeStrategySaveLines,
  clearWebhookOrganizeCustomPresets,
  filterWebhookRulesByCriteria,
  filterWebhookRulesForOrganize,
  formatWebhookOrganizeActionLabel,
  formatWebhookOrganizeFilterLabel,
  getWebhookOrganizePreset,
  getWebhookOrganizeStatePath,
  listWebhookOrganizePresets,
  loadWebhookOrganizeState,
  removeWebhookOrganizeCustomPreset,
  renameWebhookOrganizeCustomPreset,
  saveWebhookOrganizeState,
  slugifyWebhookOrganizePresetLabel,
  storeWebhookOrganizeLastPreview,
  storeWebhookOrganizeLastSelection,
  summarizeWebhookOrganizeCriteria,
  type WebhookOrganizeAction,
  type WebhookOrganizeFilterMode,
  type WebhookOrganizePresetId,
  upsertWebhookOrganizeCustomPreset,
} from "./advanced-modules-webhook-organize.js";
import {
  buildWebhookPayloadComparisonLines,
  buildWebhookPayloadSchemaLines,
  buildWebhookRequestPreviewComparisonLines,
  buildWebhookRequestPreviewLines,
} from "./advanced-modules-webhook-preview.js";
import {
  buildCronOrganizePreviewLines,
  buildCronOrganizeRecommendations,
  clearCronOrganizeCustomPresets,
  getCronOrganizeStatePath,
  loadCronOrganizeState,
  removeCronOrganizeCustomPreset,
  renameCronOrganizeCustomPreset,
  saveCronOrganizeState,
  storeCronOrganizeLastSelection,
  storeCronOrganizeLastPreview,
  type PersistedCronOrganizeCustomPreset,
} from "./advanced-modules-cron-organize.js";
import type { SetupAuthMode } from "./onboard-shared.js";
import {
  filterCronJobsByCriteria,
  filterCronJobsForOrganize,
  getCronOrganizePreset,
  listCronOrganizePresets,
  type CronOrganizeAction,
  type CronOrganizeBatchCriteria,
  type CronOrganizeEnabledMode,
  type CronOrganizeFilterMode,
  type CronOrganizeLastStatusMode,
  type CronOrganizePayloadKindMode,
  type CronOrganizePresetId,
  parseBooleanEnv,
  removeModelFallbackProfiles,
  removeModelFallbackProfile,
  removeWebhookRule,
  sortModelFallbackProfiles,
  validateHeartbeatInterval,
  validateHttpUrl,
  validateOptionalActiveHours,
  validateOptionalNonNegativeInt,
  validateOptionalPositiveInt,
  validateOptionalUrl,
  validateWebhookId,
  upsertModelFallbackProfile,
  upsertWebhookRule,
} from "./advanced-modules-shared.js";
import type { AdvancedModule } from "./advanced-modules-shared.js";
import {
  checkGatewayRuntimeReachability,
  resolveGatewayBaseUrl,
} from "./gateway-runtime-reachability.js";

export interface AdvancedModulesWizardOptions {
  envPath: string;
  stateDir: string;
  authMode: SetupAuthMode;
  modules?: AdvancedModule[];
}

export interface AdvancedModulesWizardResult {
  configuredModules: AdvancedModule[];
  notes: string[];
}

const CRON_RUN_NOW_TICK_HINT = "~30s";

type GatewayConnectAuth =
  | { mode: "none" }
  | { mode: "token"; token: string }
  | { mode: "password"; password: string };

type GatewayMethodResult<T> =
  | {
    ok: true;
    wsUrl: string;
    paired: boolean;
    payload: T;
  }
  | {
    ok: false;
    wsUrl: string;
    paired: boolean;
    error: string;
  };

type GatewayCronRunNowPayload = {
  status: "ok" | "error" | "skipped";
  runId?: string;
  summary?: string;
  reason?: string;
};

type GatewayCronRecoveryOutcome = "succeeded" | "failed" | "throttled" | "skipped_not_eligible";

type GatewayCronRecoveryPayload = {
  outcome: GatewayCronRecoveryOutcome;
  sourceRunId?: string;
  recoveryRunId?: string;
  reason?: string;
};

type GatewayBackgroundContinuationEntry = {
  kind: "cron" | "heartbeat" | "subtask";
  runId: string;
  sourceId: string;
  label: string;
  status: "running" | "ran" | "skipped" | "failed";
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  durationMs?: number;
  summary?: string;
  reason?: string;
  recoveredFromRunId?: string;
  latestRecoveryAttemptAt?: number;
  latestRecoveryOutcome?: GatewayCronRecoveryOutcome;
  latestRecoveryRunId?: string;
  latestRecoveryReason?: string;
};

type GatewayBackgroundContinuationRuntimePayload = {
  recentEntries: GatewayBackgroundContinuationEntry[];
};

function resolvePromptValue<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value;
}

async function promptSecret(message: string, existingValue?: string): Promise<string> {
  if (existingValue) {
    const keepExisting = resolvePromptValue(await p.confirm({
      message: `Keep existing ${message}?`,
      initialValue: true,
      active: "Keep",
      inactive: "Re-enter",
    }));
    if (keepExisting) {
      return existingValue;
    }
  }

  return resolvePromptValue(await p.password({
    message,
    validate: (value) => (!value.trim() ? `${message} is required` : undefined),
  }));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function getEnvMap(envPath: string): Map<string, string> {
  return new Map(parseEnvFile(envPath).map((entry) => [entry.key, entry.value]));
}

async function withStateDirEnv<T>(stateDir: string, action: () => Promise<T>): Promise<T> {
  const previousStateDir = process.env.BELLDANDY_STATE_DIR;
  process.env.BELLDANDY_STATE_DIR = stateDir;
  try {
    return await action();
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.BELLDANDY_STATE_DIR;
    } else {
      process.env.BELLDANDY_STATE_DIR = previousStateDir;
    }
  }
}

function showCurrentConfigNote(title: string, lines: string[]): void {
  p.note(lines.join("\n"), title);
}

function formatCommunityAgentSummary(agent: CommunityAgentConfig): string {
  const details = [agent.room?.name ? `room=${agent.room.name}` : "room=none"];
  if (agent.office?.downloadDir?.trim()) {
    details.push("office.downloadDir");
  }
  if ((agent.office?.uploadRoots?.length ?? 0) > 0) {
    details.push(`office.uploadRoots=${agent.office?.uploadRoots?.length ?? 0}`);
  }
  return `${agent.name} (${details.join(", ")})`;
}

function formatCommunityReconnectSummary(config: {
  reconnect?: {
    enabled?: boolean;
    maxRetries?: number;
    backoffMs?: number;
  };
}): string {
  const enabled = config.reconnect?.enabled ?? true;
  const maxRetries = config.reconnect?.maxRetries ?? 10;
  const backoffMs = config.reconnect?.backoffMs ?? 5000;
  return `${enabled ? "enabled" : "disabled"} (maxRetries=${maxRetries}, backoffMs=${backoffMs})`;
}

function isNonLocalHttpUrl(value: string): boolean {
  return value.startsWith("http://") && !value.includes("localhost") && !value.includes("127.0.0.1");
}

function buildCommunityApiRiskLines(input: {
  authMode: SetupAuthMode;
  communityApiEnabled: boolean;
  hasDedicatedCommunityToken: boolean;
  communityToken?: string;
  gatewayAuthToken?: string;
  endpoint: string;
  host?: string;
  agentCount: number;
}): string[] {
  const lines: string[] = [];
  const host = String(input.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const publicHost = host === "0.0.0.0" || host === "::" || host === "[::]";
  const gatewayAuthToken = input.gatewayAuthToken?.trim() ?? "";
  const communityToken = input.communityToken?.trim() ?? "";

  if (input.communityApiEnabled && input.authMode === "none") {
    lines.push("Community HTTP API is enabled while auth mode is none; gateway startup will reject this combination.");
  }
  if (input.communityApiEnabled && publicHost) {
    lines.push(`Gateway host is ${host}, so Community HTTP API is reachable beyond localhost.`);
  }
  if (input.communityApiEnabled && isNonLocalHttpUrl(input.endpoint)) {
    lines.push("Community endpoint is using plain HTTP; prefer HTTPS outside local development.");
  }
  if (input.communityApiEnabled && input.agentCount === 0) {
    lines.push("Community HTTP API is enabled but no community agents are configured yet.");
  }
  if (input.communityApiEnabled && input.authMode === "token" && !input.hasDedicatedCommunityToken) {
    lines.push("Community HTTP API is currently reusing the gateway auth token, so one token can call both gateway and community routes.");
  }
  if (input.communityApiEnabled && input.authMode === "token" && input.hasDedicatedCommunityToken && gatewayAuthToken && communityToken === gatewayAuthToken) {
    lines.push("Dedicated Community API token matches the gateway auth token, so credential blast radius is unchanged.");
  }
  if (input.communityApiEnabled && input.authMode === "password") {
    lines.push("Gateway password auth does not cover Community HTTP API clients; they must hold the dedicated Community API token.");
  }
  if (!input.communityApiEnabled && input.hasDedicatedCommunityToken) {
    lines.push("Community API token is still stored in env while Community HTTP API is disabled.");
  }

  return lines;
}

function toConfigSummaryTimestamp(value?: number): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function formatDurationMs(value?: number): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return `${Math.floor(value)}ms`;
}

function truncateForSummary(value: string, limit = 80): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 3))}...`;
}

function formatSummaryList(values: string[], limit = 3): string {
  if (values.length <= limit) {
    return values.join(", ");
  }
  return `${values.slice(0, limit).join(", ")} +${values.length - limit} more`;
}

function resolveGatewayConnectAuth(envValues: Map<string, string>): GatewayConnectAuth {
  const authMode = (envValues.get("BELLDANDY_AUTH_MODE") ?? "none").trim();
  if (authMode === "token") {
    return {
      mode: "token",
      token: (envValues.get("BELLDANDY_AUTH_TOKEN") ?? "").trim(),
    };
  }
  if (authMode === "password") {
    return {
      mode: "password",
      password: (envValues.get("BELLDANDY_AUTH_PASSWORD") ?? "").trim(),
    };
  }
  return { mode: "none" };
}

async function invokeGatewayCronRunNow(input: {
  envValues: Map<string, string>;
  stateDir: string;
  jobId: string;
}): Promise<GatewayMethodResult<GatewayCronRunNowPayload>> {
  return invokeGatewayMethod({
    envValues: input.envValues,
    stateDir: input.stateDir,
    method: "cron.run_now",
    params: { jobId: input.jobId },
    requestIdPrefix: "cron-run-now",
    parsePayload: parseCronRunNowPayload,
  });
}

async function invokeGatewayCronRecoveryRun(input: {
  envValues: Map<string, string>;
  stateDir: string;
  jobId: string;
}): Promise<GatewayMethodResult<GatewayCronRecoveryPayload>> {
  return invokeGatewayMethod({
    envValues: input.envValues,
    stateDir: input.stateDir,
    method: "cron.recovery.run",
    params: { jobId: input.jobId },
    requestIdPrefix: "cron-recovery-run",
    parsePayload: parseCronRecoveryPayload,
  });
}

async function invokeGatewayBackgroundContinuationRuntime(input: {
  envValues: Map<string, string>;
  stateDir: string;
}): Promise<GatewayMethodResult<GatewayBackgroundContinuationRuntimePayload>> {
  return invokeGatewayMethod({
    envValues: input.envValues,
    stateDir: input.stateDir,
    method: "system.doctor",
    params: {},
    requestIdPrefix: "system-doctor-background-continuation",
    timeoutMs: 4_000,
    parsePayload: parseBackgroundContinuationRuntimePayload,
  });
}

async function invokeGatewayMethod<T>(input: {
  envValues: Map<string, string>;
  stateDir: string;
  method: string;
  params: Record<string, unknown>;
  requestIdPrefix: string;
  timeoutMs?: number;
  parsePayload: (payload: Record<string, unknown>) => T;
}): Promise<GatewayMethodResult<T>> {
  const baseUrl = resolveGatewayBaseUrl(input.envValues).replace(/\/+$/, "");
  const wsUrl = baseUrl.replace(/^http/i, "ws");
  const auth = resolveGatewayConnectAuth(input.envValues);
  const clientId = "bdd-cli-configure-cron";

  return await new Promise((resolve) => {
    let settled = false;
    let paired = false;
    let currentRequestId = "";
    let requestSequence = 0;
    let pendingPairingRetry = false;
    let requestInFlight = false;

    const finish = (
      result:
        | {
          ok: true;
          payload: T;
        }
        | {
          ok: false;
          error: string;
        },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (result.ok) {
        resolve({
          ok: true,
          wsUrl,
          paired,
          payload: result.payload,
        });
        return;
      }
      resolve({
        ok: false,
        wsUrl,
        paired,
        error: result.error,
      });
    };

    const sendRunNowRequest = () => {
      if (settled || requestInFlight) return;
      currentRequestId = `${input.requestIdPrefix}-${Date.now()}-${requestSequence += 1}`;
      requestInFlight = true;
      socket.send(JSON.stringify({
        type: "req",
        id: currentRequestId,
        method: input.method,
        params: input.params,
      }));
    };

    const socket = new WebSocket(wsUrl, {
      origin: baseUrl,
    });

    const timeout = setTimeout(() => {
      finish({ ok: false, error: `Timed out while calling ${wsUrl}` });
    }, input.timeoutMs ?? 2_500);

    socket.on("message", async (data) => {
      if (settled) return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data.toString("utf-8")) as Record<string, unknown>;
      } catch {
        finish({ ok: false, error: "Gateway returned invalid websocket JSON." });
        return;
      }

      if (frame.type === "connect.challenge") {
        socket.send(JSON.stringify({
          type: "connect",
          role: "cli",
          clientId,
          auth,
          clientName: "bdd configure cron",
        }));
        return;
      }

      if (frame.type === "hello-ok") {
        setTimeout(() => {
          if (!settled && !pendingPairingRetry && !requestInFlight) {
            sendRunNowRequest();
          }
        }, 20);
        return;
      }

      if (frame.type === "event" && frame.event === "pairing.required") {
        const payload = frame.payload && typeof frame.payload === "object"
          ? frame.payload as Record<string, unknown>
          : {};
        const code = typeof payload.code === "string" ? payload.code.trim() : "";
        if (!code) {
          finish({ ok: false, error: "Gateway pairing is required, but no pairing code was returned." });
          return;
        }
        const approved = await approvePairingCode({
          code,
          stateDir: input.stateDir,
        });
        if (!approved.ok) {
          finish({ ok: false, error: approved.message });
          return;
        }
        paired = true;
        pendingPairingRetry = false;
        requestInFlight = false;
        sendRunNowRequest();
        return;
      }

      if (frame.type === "res" && frame.id === currentRequestId) {
        requestInFlight = false;
        if (frame.ok === true) {
          const payload = frame.payload && typeof frame.payload === "object"
            ? frame.payload as Record<string, unknown>
            : {};
          try {
            finish({
              ok: true,
              payload: input.parsePayload(payload),
            });
          } catch (error) {
            finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        const error = frame.error && typeof frame.error === "object"
          ? frame.error as Record<string, unknown>
          : {};
        const errorCode = typeof error.code === "string" ? error.code : "request_failed";
        const errorMessage = typeof error.message === "string" ? error.message : "Gateway request failed.";
        if (errorCode === "pairing_required") {
          pendingPairingRetry = true;
          return;
        }
        finish({ ok: false, error: errorMessage });
      }
    });

    socket.on("error", (error) => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

    socket.on("close", () => {
      if (!settled) {
        finish({ ok: false, error: `Gateway websocket ${wsUrl} closed before ${input.method} completed.` });
      }
    });
  });
}

function parseGatewayTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseGatewayTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCronRunNowPayload(payload: Record<string, unknown>): GatewayCronRunNowPayload {
  const status = payload.status === "ok" || payload.status === "error" || payload.status === "skipped"
    ? payload.status
    : "skipped";
  return {
    status,
    ...(parseGatewayTrimmedString(payload.runId) ? { runId: parseGatewayTrimmedString(payload.runId) } : {}),
    ...(parseGatewayTrimmedString(payload.summary) ? { summary: parseGatewayTrimmedString(payload.summary) } : {}),
    ...(parseGatewayTrimmedString(payload.reason) ? { reason: parseGatewayTrimmedString(payload.reason) } : {}),
  };
}

function parseCronRecoveryPayload(payload: Record<string, unknown>): GatewayCronRecoveryPayload {
  const outcome = payload.outcome === "succeeded"
    || payload.outcome === "failed"
    || payload.outcome === "throttled"
    || payload.outcome === "skipped_not_eligible"
    ? payload.outcome
    : "skipped_not_eligible";
  return {
    outcome,
    ...(parseGatewayTrimmedString(payload.sourceRunId) ? { sourceRunId: parseGatewayTrimmedString(payload.sourceRunId) } : {}),
    ...(parseGatewayTrimmedString(payload.recoveryRunId) ? { recoveryRunId: parseGatewayTrimmedString(payload.recoveryRunId) } : {}),
    ...(parseGatewayTrimmedString(payload.reason) ? { reason: parseGatewayTrimmedString(payload.reason) } : {}),
  };
}

function parseBackgroundContinuationRuntimePayload(
  payload: Record<string, unknown>,
): GatewayBackgroundContinuationRuntimePayload {
  const runtime = payload.backgroundContinuationRuntime && typeof payload.backgroundContinuationRuntime === "object"
    ? payload.backgroundContinuationRuntime as Record<string, unknown>
    : {};
  const recentEntries = Array.isArray(runtime.recentEntries)
    ? runtime.recentEntries
      .map((item) => parseBackgroundContinuationEntry(item))
      .filter((item): item is GatewayBackgroundContinuationEntry => Boolean(item))
    : [];
  return { recentEntries };
}

function parseBackgroundContinuationEntry(value: unknown): GatewayBackgroundContinuationEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const kind = item.kind === "cron" || item.kind === "heartbeat" || item.kind === "subtask"
    ? item.kind
    : null;
  const status = item.status === "running" || item.status === "ran" || item.status === "skipped" || item.status === "failed"
    ? item.status
    : null;
  const runId = parseGatewayTrimmedString(item.runId);
  const sourceId = parseGatewayTrimmedString(item.sourceId);
  const label = parseGatewayTrimmedString(item.label);
  const startedAt = parseGatewayTimestamp(item.startedAt);
  const updatedAt = parseGatewayTimestamp(item.updatedAt);
  if (!kind || !status || !runId || !sourceId || !label || startedAt === undefined || updatedAt === undefined) {
    return null;
  }
  const latestRecoveryOutcome = item.latestRecoveryOutcome === "succeeded"
    || item.latestRecoveryOutcome === "failed"
    || item.latestRecoveryOutcome === "throttled"
    || item.latestRecoveryOutcome === "skipped_not_eligible"
    ? item.latestRecoveryOutcome
    : undefined;
  return {
    kind,
    runId,
    sourceId,
    label,
    status,
    startedAt,
    updatedAt,
    ...(parseGatewayTimestamp(item.finishedAt) !== undefined ? { finishedAt: parseGatewayTimestamp(item.finishedAt) } : {}),
    ...(parseGatewayTimestamp(item.durationMs) !== undefined ? { durationMs: parseGatewayTimestamp(item.durationMs) } : {}),
    ...(parseGatewayTrimmedString(item.summary) ? { summary: parseGatewayTrimmedString(item.summary) } : {}),
    ...(parseGatewayTrimmedString(item.reason) ? { reason: parseGatewayTrimmedString(item.reason) } : {}),
    ...(parseGatewayTrimmedString(item.recoveredFromRunId) ? { recoveredFromRunId: parseGatewayTrimmedString(item.recoveredFromRunId) } : {}),
    ...(parseGatewayTimestamp(item.latestRecoveryAttemptAt) !== undefined
      ? { latestRecoveryAttemptAt: parseGatewayTimestamp(item.latestRecoveryAttemptAt) }
      : {}),
    ...(latestRecoveryOutcome ? { latestRecoveryOutcome } : {}),
    ...(parseGatewayTrimmedString(item.latestRecoveryRunId) ? { latestRecoveryRunId: parseGatewayTrimmedString(item.latestRecoveryRunId) } : {}),
    ...(parseGatewayTrimmedString(item.latestRecoveryReason) ? { latestRecoveryReason: parseGatewayTrimmedString(item.latestRecoveryReason) } : {}),
  };
}

function buildCronRecoveryHintLines(input: {
  job: CronJob;
  runtimeReachable: boolean;
  healthUrl: string;
  cronEnabled: boolean;
  heartbeatActiveHours: string;
}): string[] {
  const { job, runtimeReachable, healthUrl, cronEnabled, heartbeatActiveHours } = input;
  const lines = [
    `Job summary: ${formatCronJobSummary(job)}`,
  ];
  if (!cronEnabled) {
    lines.push("Cron runtime is disabled in env, so queued runs and automatic recovery will not execute until you enable it.");
  } else if (runtimeReachable) {
    lines.push(`Gateway runtime is reachable at ${healthUrl}. Queued run-now requests should be picked up on the next scheduler tick (${CRON_RUN_NOW_TICK_HINT}).`);
  } else {
    lines.push(`Gateway runtime is not reachable at ${healthUrl}. Queued run-now requests and automatic recovery will wait until the gateway is running again.`);
  }
  if (!job.enabled) {
    lines.push("This job is currently disabled. Re-enable it before expecting scheduler or recovery activity.");
  }
  if (job.enabled && typeof job.state.nextRunAtMs !== "number") {
    lines.push("This enabled job has no computed next run. Re-save the schedule or inspect timezone / interval fields.");
  }
  if (job.state.lastStatus === "error" || Boolean(job.state.lastError?.trim())) {
    lines.push(`Last failure: ${truncateForSummary(job.state.lastError ?? "error")}`);
  }
  if (job.state.lastStatus === "skipped" && job.state.lastError?.trim()) {
    if (job.state.lastError.includes("outside active hours")) {
      lines.push(`Last run was skipped by active hours${heartbeatActiveHours.trim() ? ` (${heartbeatActiveHours.trim()})` : ""}.`);
    } else if (job.state.lastError.includes("scheduler is busy")) {
      lines.push("Last run was skipped because the scheduler was busy. Retry during a quieter window or reduce concurrent load.");
    } else {
      lines.push(`Last skip reason: ${truncateForSummary(job.state.lastError)}`);
    }
  }
  if (job.delivery.mode === "none" && (job.failureDestination?.mode ?? "none") === "none") {
    lines.push("This is a silent job: success and failure stay in cron state/logs only.");
  } else if ((job.failureDestination?.mode ?? "none") === "none") {
    lines.push("Failure delivery is disabled. During troubleshooting, switch failure delivery to user for faster feedback.");
  }
  if (job.payload.kind === "goalApprovalScan" && (job.failureDestination?.mode ?? "none") === "none") {
    lines.push("Goal approval scan failures will stay silent. Prefer failure delivery=user while diagnosing missed approvals or escalations.");
  }
  if (job.payload.kind === "systemEvent") {
    lines.push("System event jobs depend on the agent/model runtime. If failures continue, re-check provider/model connectivity.");
  }
  if (job.schedule.kind === "at") {
    if (!job.enabled && job.deleteAfterRun !== true && job.state.lastStatus === "ok") {
      lines.push("This one-shot job most likely already ran once and was auto-disabled. Edit its timestamp before re-enabling it.");
    } else if (job.enabled && job.deleteAfterRun !== true) {
      lines.push("This one-shot job will auto-disable after it runs once. Set deleteAfterRun if you want it removed instead.");
    }
  }
  return lines;
}

function formatCronRecoveryOutcomeLabel(outcome: GatewayCronRecoveryOutcome): string {
  switch (outcome) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "throttled":
      return "throttled";
    case "skipped_not_eligible":
      return "skipped";
    default:
      return outcome;
  }
}

function buildCronRecoveryReplayLines(input: {
  job: CronJob;
  entries: GatewayBackgroundContinuationEntry[];
}): string[] {
  const { job, entries } = input;
  const lines = [
    `Job summary: ${formatCronJobSummary(job)}`,
  ];
  if (entries.length === 0) {
    lines.push("No background continuation entries were found for this job in the current runtime ledger.");
    return lines;
  }

  const latest = entries[0]!;
  const latestFailed = entries.find((item) => item.status === "failed");
  const recoveryAnchor = latestFailed ?? entries.find((item) => item.latestRecoveryOutcome) ?? latest;
  const recoveryRun = recoveryAnchor.latestRecoveryRunId
    ? entries.find((item) => item.runId === recoveryAnchor.latestRecoveryRunId)
    : latestFailed
      ? entries.find((item) => item.recoveredFromRunId === latestFailed.runId)
      : undefined;
  const latestTs = latest.finishedAt ?? latest.updatedAt ?? latest.startedAt;

  lines.push(`Tracked background runs: ${entries.length}`);
  lines.push(`Latest tracked run: ${latest.runId} (${latest.status}) @ ${toConfigSummaryTimestamp(latestTs) ?? "unknown time"}`);
  if (latest.summary) {
    lines.push(`Latest summary: ${truncateForSummary(latest.summary, 140)}`);
  }
  if (latest.reason) {
    lines.push(`Latest reason: ${truncateForSummary(latest.reason, 140)}`);
  }
  if (latest.durationMs !== undefined) {
    lines.push(`Latest duration: ${formatDurationMs(latest.durationMs)}`);
  }

  if (latestFailed) {
    lines.push(`Latest failed run: ${latestFailed.runId} @ ${toConfigSummaryTimestamp(latestFailed.finishedAt ?? latestFailed.updatedAt ?? latestFailed.startedAt) ?? "unknown time"}`);
    if (latestFailed.summary) {
      lines.push(`Failed summary: ${truncateForSummary(latestFailed.summary, 140)}`);
    }
    if (latestFailed.reason) {
      lines.push(`Failed reason: ${truncateForSummary(latestFailed.reason, 140)}`);
    }
  }

  if (recoveryAnchor.latestRecoveryOutcome) {
    lines.push(
      `Latest recovery attempt: ${formatCronRecoveryOutcomeLabel(recoveryAnchor.latestRecoveryOutcome)}`
      + `${recoveryAnchor.latestRecoveryAttemptAt ? ` @ ${toConfigSummaryTimestamp(recoveryAnchor.latestRecoveryAttemptAt) ?? "unknown time"}` : ""}`,
    );
    if (recoveryAnchor.latestRecoveryRunId) {
      lines.push(`Recovery run id: ${recoveryAnchor.latestRecoveryRunId}`);
    }
    if (recoveryAnchor.latestRecoveryReason) {
      lines.push(`Recovery reason: ${truncateForSummary(recoveryAnchor.latestRecoveryReason, 140)}`);
    }
  }

  if (recoveryRun) {
    lines.push(`Recovery replay: ${recoveryRun.runId} (${recoveryRun.status}) @ ${toConfigSummaryTimestamp(recoveryRun.finishedAt ?? recoveryRun.updatedAt ?? recoveryRun.startedAt) ?? "unknown time"}`);
    if (recoveryRun.summary) {
      lines.push(`Replay summary: ${truncateForSummary(recoveryRun.summary, 140)}`);
    }
    if (recoveryRun.reason) {
      lines.push(`Replay reason: ${truncateForSummary(recoveryRun.reason, 140)}`);
    }
    if (recoveryRun.durationMs !== undefined) {
      lines.push(`Replay duration: ${formatDurationMs(recoveryRun.durationMs)}`);
    }
  }

  return lines;
}

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatFallbackSummary(profile: {
  id?: string;
  displayName?: string;
  model?: string;
  baseUrl?: string;
  protocol?: string;
  wireApi?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  proxyUrl?: string;
}): string {
  const id = profile.id?.trim() || "<missing-id>";
  const model = profile.model?.trim() || "<missing-model>";
  const baseUrl = profile.baseUrl?.trim() || "<missing-base-url>";
  const meta: string[] = [];
  if (profile.displayName?.trim()) meta.push(`name=${profile.displayName.trim()}`);
  if (profile.protocol?.trim()) meta.push(`protocol=${profile.protocol.trim()}`);
  if (profile.wireApi?.trim()) meta.push(`wire=${profile.wireApi.trim()}`);
  if (typeof profile.requestTimeoutMs === "number") meta.push(`timeout=${profile.requestTimeoutMs}ms`);
  if (typeof profile.maxRetries === "number") meta.push(`retries=${profile.maxRetries}`);
  if (typeof profile.retryBackoffMs === "number") meta.push(`backoff=${profile.retryBackoffMs}ms`);
  if (profile.proxyUrl?.trim()) meta.push("proxy=custom");
  return meta.length > 0
    ? `${id} -> ${model} @ ${baseUrl} [${meta.join(", ")}]`
    : `${id} -> ${model} @ ${baseUrl}`;
}

function formatWebhookSummary(rule: {
  id: string;
  enabled?: boolean;
  defaultAgentId?: string;
  promptTemplate?: string;
}): string {
  const enabled = rule.enabled === false ? "disabled" : "enabled";
  const agent = rule.defaultAgentId?.trim() || "default";
  const template = rule.promptTemplate?.trim() ? ", promptTemplate=custom" : "";
  return `${rule.id} (${enabled}, agent=${agent}${template})`;
}

function extractWebhookTemplatePlaceholders(template: string): string[] {
  const values = Array.from(template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g))
    .map((match) => String(match[1] ?? "").trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function findUnsupportedWebhookPlaceholderKeys(placeholders: string[]): string[] {
  return placeholders.filter((key) => key.includes(".") || key.includes("[") || key.includes("]"));
}

function validateOptionalWebhookPreviewPayloads(
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return "Preview payload array must include at least one JSON object";
      }
      if (parsed.length > 5) {
        return "Preview payload array supports at most 5 samples";
      }
      const invalidIndex = parsed.findIndex((item) => !item || typeof item !== "object" || Array.isArray(item));
      if (invalidIndex >= 0) {
        return `Preview payload sample ${invalidIndex + 1} must be a JSON object`;
      }
      return undefined;
    }
    if (!parsed || typeof parsed !== "object") {
      return "Preview payload must be a JSON object or JSON object array";
    }
    return undefined;
  } catch {
    return "Preview payload must be valid JSON";
  }
}

function parseOptionalWebhookPreviewPayloads(
  value: string,
): Record<string, unknown>[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }
  return [parsed as Record<string, unknown>];
}

function formatCronScheduleSummary(schedule: CronSchedule): string {
  if (schedule.kind === "at") {
    return `at ${schedule.at}`;
  }
  if (schedule.kind === "every") {
    return `every ${schedule.everyMs}ms`;
  }
  if (schedule.kind === "dailyAt") {
    return `daily ${schedule.time} @ ${schedule.timezone}`;
  }
  return `weekly [${schedule.weekdays.join(",")}] ${schedule.time} @ ${schedule.timezone}`;
}

function formatCronPayloadSummary(payload: CronPayload): string {
  if (payload.kind === "systemEvent") {
    return "systemEvent";
  }
  if (payload.allGoals) {
    return "goalApprovalScan allGoals";
  }
  if (payload.goalId?.trim()) {
    return `goalApprovalScan ${payload.goalId.trim()}`;
  }
  const goalCount = payload.goalIds?.length ?? 0;
  return `goalApprovalScan ${goalCount} goals`;
}

function formatCronJobSummary(job: CronJob): string {
  const parts = [
    job.enabled ? "enabled" : "disabled",
    formatCronScheduleSummary(job.schedule),
    formatCronPayloadSummary(job.payload),
    `session=${job.sessionTarget}`,
    `delivery=${job.delivery.mode}`,
  ];
  if (job.failureDestination?.mode && job.failureDestination.mode !== "none") {
    parts.push(`failure=${job.failureDestination.mode}`);
  }
  if (job.deleteAfterRun) {
    parts.push("deleteAfterRun");
  }
  const nextRun = toConfigSummaryTimestamp(job.state.nextRunAtMs);
  if (nextRun) {
    parts.push(`next=${nextRun}`);
  } else if (job.enabled) {
    parts.push("next=missing");
  }
  if (job.state.lastStatus) {
    parts.push(`last=${job.state.lastStatus}`);
  }
  if (job.state.lastError?.trim()) {
    parts.push(`error=${truncateForSummary(job.state.lastError)}`);
  }
  const lastDuration = formatDurationMs(job.state.lastDurationMs);
  if (lastDuration) {
    parts.push(`duration=${lastDuration}`);
  }
  return `${job.name} (${parts.join(", ")})`;
}

function formatCronOrganizeFilterLabel(mode: CronOrganizeFilterMode): string {
  switch (mode) {
    case "enabled":
      return "enabled jobs";
    case "disabled":
      return "disabled jobs";
    case "failed":
      return "jobs with recent failures";
    case "skipped":
      return "jobs with recent skips";
    case "ok":
      return "jobs with recent success";
    case "silent":
      return "silent jobs";
    case "goal_approval_scan":
      return "goal approval scan jobs";
    case "system_event":
      return "system event jobs";
    case "missing_next_run":
      return "enabled jobs missing next run";
    case "all":
    default:
      return "all jobs";
  }
}

function formatCronOrganizeActionLabel(action: CronOrganizeAction): string {
  switch (action) {
    case "enable_multiple":
      return "enable";
    case "disable_multiple":
      return "disable";
    case "remove_multiple":
      return "remove";
    default:
      return "update";
  }
}

function summarizeCronOrganizeCriteria(criteria: CronOrganizeBatchCriteria): string {
  const parts: string[] = [];
  if (criteria.enabled !== "any") parts.push(criteria.enabled);
  if (criteria.lastStatus !== "any") parts.push(`last=${criteria.lastStatus}`);
  if (criteria.payloadKind !== "any") parts.push(`payload=${criteria.payloadKind}`);
  if (criteria.silentOnly) parts.push("silent");
  if (criteria.missingNextRunOnly) parts.push("missing next run");
  if (criteria.failureDeliveryOffOnly) parts.push("failureDelivery=none");
  if (criteria.oneShotOnly) parts.push("one-shot");
  return parts.length > 0 ? parts.join(", ") : "all jobs";
}

function slugifyCronOrganizePresetLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "preset";
}

function buildCronOrganizeSelectionLabel(input: {
  title: string;
  jobNames: string[];
}): string {
  return `${input.title}: ${formatSummaryList(input.jobNames, 5)}`;
}

async function promptWebhookIdsToManage(
  rules: Array<{ id: string; enabled?: boolean; defaultAgentId?: string; promptTemplate?: string }>,
  intent: string,
): Promise<string[]> {
  const selected: string[] = [];
  while (true) {
    const remaining = rules.filter((rule) => !selected.includes(rule.id));
    if (remaining.length === 0) {
      break;
    }
    const chosen = resolvePromptValue(await p.select<string>({
      message: selected.length === 0 ? `Choose webhook to ${intent}` : `Choose another webhook to ${intent}`,
      options: [
        ...remaining.map((rule) => ({
          value: rule.id,
          label: rule.id,
          hint: formatWebhookSummary(rule),
        })),
        { value: "__done__", label: "Done", hint: `${selected.length} selected` },
      ],
      initialValue: remaining[0]?.id ?? "__done__",
    }));
    if (chosen === "__done__") {
      break;
    }
    selected.push(chosen);
    const addMore = resolvePromptValue(await p.confirm({
      message: `Select another webhook to ${intent}?`,
      initialValue: remaining.length > 1,
      active: "Yes",
      inactive: "Done",
    }));
    if (!addMore) {
      break;
    }
  }
  return selected;
}

async function promptCronJobIdsToManage(
  jobs: CronJob[],
  intent: string,
): Promise<string[]> {
  const selected: string[] = [];
  while (true) {
    const remaining = jobs.filter((job) => !selected.includes(job.id));
    if (remaining.length === 0) {
      break;
    }
    const chosen = resolvePromptValue(await p.select<string>({
      message: selected.length === 0 ? `Choose cron job to ${intent}` : `Choose another cron job to ${intent}`,
      options: [
        ...remaining.map((job) => ({
          value: job.id,
          label: job.name,
          hint: formatCronJobSummary(job),
        })),
        { value: "__done__", label: "Done", hint: `${selected.length} selected` },
      ],
      initialValue: remaining[0]?.id ?? "__done__",
    }));
    if (chosen === "__done__") {
      break;
    }
    selected.push(chosen);
    const addMore = resolvePromptValue(await p.confirm({
      message: `Select another cron job to ${intent}?`,
      initialValue: remaining.length > 1,
      active: "Yes",
      inactive: "Done",
    }));
    if (!addMore) {
      break;
    }
  }
  return selected;
}

async function promptCommunityAgentNamesToManage(
  agents: CommunityAgentConfig[],
  intent: string,
): Promise<string[]> {
  const selected: string[] = [];
  while (true) {
    const remaining = agents.filter((agent) => !selected.includes(agent.name));
    if (remaining.length === 0) {
      break;
    }
    const chosen = resolvePromptValue(await p.select<string>({
      message: selected.length === 0 ? `Choose community agent to ${intent}` : `Choose another community agent to ${intent}`,
      options: [
        ...remaining.map((agent) => ({
          value: agent.name,
          label: agent.name,
          hint: formatCommunityAgentSummary(agent),
        })),
        { value: "__done__", label: "Done", hint: `${selected.length} selected` },
      ],
      initialValue: remaining[0]?.name ?? "__done__",
    }));
    if (chosen === "__done__") {
      break;
    }
    selected.push(chosen);
    const addMore = resolvePromptValue(await p.confirm({
      message: `Select another community agent to ${intent}?`,
      initialValue: remaining.length > 1,
      active: "Yes",
      inactive: "Done",
    }));
    if (!addMore) {
      break;
    }
  }
  return selected;
}

async function promptCronOrganizeCriteria(): Promise<CronOrganizeBatchCriteria> {
  const enabled = resolvePromptValue(await p.select<CronOrganizeEnabledMode>({
    message: "Condition: enabled state",
    options: [
      { value: "any", label: "Any state" },
      { value: "enabled", label: "Enabled only" },
      { value: "disabled", label: "Disabled only" },
    ],
    initialValue: "any",
  }));
  const lastStatus = resolvePromptValue(await p.select<CronOrganizeLastStatusMode>({
    message: "Condition: last run status",
    options: [
      { value: "any", label: "Any status" },
      { value: "error", label: "Failed only" },
      { value: "skipped", label: "Skipped only" },
      { value: "ok", label: "Succeeded only" },
    ],
    initialValue: "any",
  }));
  const payloadKind = resolvePromptValue(await p.select<CronOrganizePayloadKindMode>({
    message: "Condition: payload kind",
    options: [
      { value: "any", label: "Any payload" },
      { value: "goalApprovalScan", label: "Goal approval scan" },
      { value: "systemEvent", label: "System event" },
    ],
    initialValue: "any",
  }));
  const silentOnly = resolvePromptValue(await p.confirm({
    message: "Only include silent jobs?",
    initialValue: false,
    active: "Yes",
    inactive: "No",
  }));
  const missingNextRunOnly = resolvePromptValue(await p.confirm({
    message: "Only include enabled jobs missing next run?",
    initialValue: false,
    active: "Yes",
    inactive: "No",
  }));
  const failureDeliveryOffOnly = resolvePromptValue(await p.confirm({
    message: "Only include jobs with failure delivery off?",
    initialValue: false,
    active: "Yes",
    inactive: "No",
  }));
  const oneShotOnly = resolvePromptValue(await p.confirm({
    message: "Only include one-shot jobs?",
    initialValue: false,
    active: "Yes",
    inactive: "No",
  }));
  return {
    enabled,
    lastStatus,
    payloadKind,
    silentOnly,
    missingNextRunOnly,
    failureDeliveryOffOnly,
    oneShotOnly,
  };
}

function validateCronIsoTimestamp(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Run at timestamp is required";
  }
  if (!Number.isFinite(new Date(trimmed).getTime())) {
    return "Run at timestamp must be a valid ISO-8601 datetime";
  }
  return undefined;
}

function validateCronTimeOfDay(value: string): string | undefined {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim())
    ? undefined
    : "Time must use HH:mm format";
}

function validateCronTimeZone(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Timezone is required";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date(0));
    return undefined;
  } catch {
    return "Timezone must be a valid IANA timezone";
  }
}

function parseCronEveryIntervalMs(value: string): number | undefined {
  const match = /^(\d+)(m|h|d)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 60 * 60_000;
  return amount * 24 * 60 * 60_000;
}

function validateCronEveryInterval(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Every interval is required";
  }
  const parsed = parseCronEveryIntervalMs(trimmed);
  if (parsed === undefined) {
    return "Every interval must be like 30m, 1h, or 2d";
  }
  if (parsed < 60_000) {
    return "Every interval must be at least 1 minute";
  }
  return undefined;
}

function parseCronWeekdays(value: string): number[] {
  return Array.from(new Set(
    value
      .split(",")
      .map((item) => Number.parseInt(item.trim(), 10))
      .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7),
  )).sort((left, right) => left - right);
}

function validateCronWeekdays(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Weekdays are required";
  }
  const items = trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) {
    return "Weekdays are required";
  }
  const parsed = parseCronWeekdays(trimmed);
  if (parsed.length !== items.length) {
    return "Weekdays must be unique numbers between 1 and 7";
  }
  return undefined;
}

async function promptCronSchedule(
  existingSchedule?: CronSchedule,
  existingDeleteAfterRun?: boolean,
): Promise<{ schedule: CronSchedule; deleteAfterRun: boolean }> {
  const kind = resolvePromptValue(await p.select<CronSchedule["kind"]>({
    message: "Cron job schedule",
    options: [
      { value: "every", label: "Every interval", hint: "Repeat every N minutes/hours/days" },
      { value: "dailyAt", label: "Daily at time", hint: "Run once per day in a timezone" },
      { value: "weeklyAt", label: "Weekly at time", hint: "Run on selected weekdays" },
      { value: "at", label: "Run once at timestamp", hint: "One-shot ISO-8601 datetime" },
    ],
    initialValue: existingSchedule?.kind ?? "every",
  }));

  const staggerDefault = existingSchedule && existingSchedule.kind !== "at" && existingSchedule.staggerMs != null
    ? String(existingSchedule.staggerMs)
    : "";

  if (kind === "at") {
    const at = resolvePromptValue(await p.text({
      message: "Run at timestamp",
      defaultValue: existingSchedule?.kind === "at" ? existingSchedule.at : "",
      placeholder: "2026-04-14T09:00:00+08:00",
      validate: (value) => validateCronIsoTimestamp(value),
    }));
    const deleteAfterRun = resolvePromptValue(await p.confirm({
      message: "Delete the job after it runs once?",
      initialValue: existingSchedule?.kind === "at" ? (existingDeleteAfterRun ?? true) : true,
      active: "Delete",
      inactive: "Keep",
    }));
    return {
      schedule: { kind: "at", at: at.trim() },
      deleteAfterRun,
    };
  }

  if (kind === "every") {
    const every = resolvePromptValue(await p.text({
      message: "Every interval",
      defaultValue: existingSchedule?.kind === "every"
        ? `${Math.max(1, Math.floor(existingSchedule.everyMs / 60_000))}m`
        : "30m",
      placeholder: "30m",
      validate: (value) => validateCronEveryInterval(value),
    }));
    const staggerMs = resolvePromptValue(await p.text({
      message: "Stagger window ms (optional)",
      defaultValue: staggerDefault,
      validate: (value) => validateOptionalNonNegativeInt(value, "Stagger window"),
    }));
    return {
      schedule: {
        kind: "every",
        everyMs: parseCronEveryIntervalMs(every) ?? 30 * 60_000,
        ...(parseOptionalNonNegativeInt(staggerMs) !== undefined ? { staggerMs: parseOptionalNonNegativeInt(staggerMs) } : {}),
      },
      deleteAfterRun: false,
    };
  }

  if (kind === "dailyAt") {
    const time = resolvePromptValue(await p.text({
      message: "Daily time",
      defaultValue: existingSchedule?.kind === "dailyAt" ? existingSchedule.time : "09:00",
      placeholder: "09:00",
      validate: (value) => validateCronTimeOfDay(value),
    }));
    const timezone = resolvePromptValue(await p.text({
      message: "Timezone",
      defaultValue: existingSchedule?.kind === "dailyAt" ? existingSchedule.timezone : "Asia/Shanghai",
      validate: (value) => validateCronTimeZone(value),
    }));
    const staggerMs = resolvePromptValue(await p.text({
      message: "Stagger window ms (optional)",
      defaultValue: staggerDefault,
      validate: (value) => validateOptionalNonNegativeInt(value, "Stagger window"),
    }));
    return {
      schedule: {
        kind: "dailyAt",
        time: time.trim(),
        timezone: timezone.trim(),
        ...(parseOptionalNonNegativeInt(staggerMs) !== undefined ? { staggerMs: parseOptionalNonNegativeInt(staggerMs) } : {}),
      },
      deleteAfterRun: false,
    };
  }

  const weekdays = resolvePromptValue(await p.text({
    message: "Weekdays (1=Mon ... 7=Sun, comma-separated)",
    defaultValue: existingSchedule?.kind === "weeklyAt" ? existingSchedule.weekdays.join(",") : "1,2,3,4,5",
    placeholder: "1,3,5",
    validate: (value) => validateCronWeekdays(value),
  }));
  const time = resolvePromptValue(await p.text({
    message: "Weekly time",
    defaultValue: existingSchedule?.kind === "weeklyAt" ? existingSchedule.time : "09:00",
    placeholder: "09:00",
    validate: (value) => validateCronTimeOfDay(value),
  }));
  const timezone = resolvePromptValue(await p.text({
    message: "Timezone",
    defaultValue: existingSchedule?.kind === "weeklyAt" ? existingSchedule.timezone : "Asia/Shanghai",
    validate: (value) => validateCronTimeZone(value),
  }));
  const staggerMs = resolvePromptValue(await p.text({
    message: "Stagger window ms (optional)",
    defaultValue: staggerDefault,
    validate: (value) => validateOptionalNonNegativeInt(value, "Stagger window"),
  }));
  return {
    schedule: {
      kind: "weeklyAt",
      weekdays: parseCronWeekdays(weekdays),
      time: time.trim(),
      timezone: timezone.trim(),
      ...(parseOptionalNonNegativeInt(staggerMs) !== undefined ? { staggerMs: parseOptionalNonNegativeInt(staggerMs) } : {}),
    },
    deleteAfterRun: false,
  };
}

async function promptCronPayload(existingPayload?: CronPayload): Promise<CronPayload> {
  const kind = resolvePromptValue(await p.select<CronPayload["kind"]>({
    message: "Cron job payload",
    options: [
      { value: "systemEvent", label: "System event", hint: "Send text to the agent/runtime" },
      { value: "goalApprovalScan", label: "Goal approval scan", hint: "Run structured approval scan" },
    ],
    initialValue: existingPayload?.kind ?? "systemEvent",
  }));

  if (kind === "systemEvent") {
    const text = resolvePromptValue(await p.text({
      message: "System event text",
      defaultValue: existingPayload?.kind === "systemEvent" ? existingPayload.text : "",
      validate: (value) => (!value.trim() ? "System event text is required" : undefined),
    }));
    return {
      kind: "systemEvent",
      text: text.trim(),
    };
  }

  const targetMode = resolvePromptValue(await p.select<"all" | "single" | "list">({
    message: "Goal scan target",
    options: [
      { value: "all", label: "All goals" },
      { value: "single", label: "Single goal" },
      { value: "list", label: "Multiple goals" },
    ],
    initialValue: existingPayload?.kind === "goalApprovalScan"
      ? existingPayload.allGoals
        ? "all"
        : existingPayload.goalId?.trim()
          ? "single"
          : "list"
      : "all",
  }));
  const autoEscalate = resolvePromptValue(await p.confirm({
    message: "Auto escalate overdue approvals?",
    initialValue: existingPayload?.kind === "goalApprovalScan" ? existingPayload.autoEscalate !== false : true,
    active: "Auto",
    inactive: "Manual",
  }));

  if (targetMode === "all") {
    return {
      kind: "goalApprovalScan",
      allGoals: true,
      autoEscalate,
    };
  }

  if (targetMode === "single") {
    const goalId = resolvePromptValue(await p.text({
      message: "Goal id",
      defaultValue: existingPayload?.kind === "goalApprovalScan" ? existingPayload.goalId ?? "" : "",
      validate: (value) => (!value.trim() ? "Goal id is required" : undefined),
    }));
    return {
      kind: "goalApprovalScan",
      goalId: goalId.trim(),
      autoEscalate,
    };
  }

  const goalIdsInput = resolvePromptValue(await p.text({
    message: "Goal ids (comma-separated)",
    defaultValue: existingPayload?.kind === "goalApprovalScan" ? existingPayload.goalIds?.join(", ") ?? "" : "",
    validate: (value) => parseCommaSeparatedList(value).length > 0 ? undefined : "At least one goal id is required",
  }));
  return {
    kind: "goalApprovalScan",
    goalIds: parseCommaSeparatedList(goalIdsInput),
    autoEscalate,
  };
}

const MODEL_PROTOCOL_CHOICES = [
  { value: "__unset__", label: "Inherit global default", hint: "Do not override protocol" },
  { value: "openai", label: "openai", hint: "OpenAI-compatible providers" },
  { value: "anthropic", label: "anthropic", hint: "Anthropic API wire protocol" },
] as const;

const MODEL_WIRE_API_CHOICES = [
  { value: "__unset__", label: "Inherit global default", hint: "Do not override wire API" },
  { value: "chat_completions", label: "chat_completions", hint: "Classic /chat/completions route" },
  { value: "responses", label: "responses", hint: "OpenAI Responses API route" },
] as const;

function parseOptionalPositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed ? Number.parseInt(trimmed, 10) : undefined;
}

function parseOptionalNonNegativeInt(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed ? Number.parseInt(trimmed, 10) : undefined;
}

async function promptOptionalChoice(
  message: string,
  options: readonly { value: string; label: string; hint?: string }[],
  currentValue?: string,
): Promise<string | undefined> {
  const normalizedCurrent = currentValue?.trim() || "__unset__";
  const initialValue = options.some((item) => item.value === normalizedCurrent)
    ? normalizedCurrent
    : "__unset__";
  const value = resolvePromptValue(await p.select<string>({
    message,
    options: options.map((item) => ({ value: item.value, label: item.label, hint: item.hint })),
    initialValue,
  }));
  return value === "__unset__" ? undefined : value;
}

async function promptFallbackIdsToRemove(
  profiles: Array<{ id?: string; model?: string; baseUrl?: string }>,
): Promise<string[]> {
  const selected: string[] = [];
  while (true) {
    const remaining = profiles.filter((profile) => !selected.includes(profile.id ?? ""));
    if (remaining.length === 0) {
      break;
    }
    const chosen = resolvePromptValue(await p.select<string>({
      message: selected.length === 0 ? "Choose fallback to remove" : "Choose another fallback to remove",
      options: [
        ...remaining.map((profile) => ({
          value: profile.id ?? "",
          label: profile.id ?? "<missing-id>",
          hint: profile.model ?? profile.baseUrl ?? "configured fallback",
        })),
        { value: "__done__", label: "Done", hint: `${selected.length} selected` },
      ],
      initialValue: remaining[0]?.id ?? "__done__",
    }));
    if (chosen === "__done__") {
      break;
    }
    selected.push(chosen);
    const addMore = resolvePromptValue(await p.confirm({
      message: "Remove another fallback?",
      initialValue: remaining.length > 1,
      active: "Yes",
      inactive: "Done",
    }));
    if (!addMore) {
      break;
    }
  }
  return selected;
}

async function runCommunityModule(options: AdvancedModulesWizardOptions): Promise<string[]> {
  const notes: string[] = [];
  const envValues = getEnvMap(options.envPath);
  const existingConfig = await withStateDirEnv(options.stateDir, async () => loadCommunityConfig());
  const communityApiEnabledBefore = parseBooleanEnv(envValues.get("BELLDANDY_COMMUNITY_API_ENABLED"), false);
  const communityApiTokenBefore = (envValues.get("BELLDANDY_COMMUNITY_API_TOKEN") ?? "").trim();
  const gatewayAuthToken = (envValues.get("BELLDANDY_AUTH_TOKEN") ?? "").trim();
  const gatewayHost = (envValues.get("BELLDANDY_HOST") ?? "127.0.0.1").trim() || "127.0.0.1";
  const reconnectConfig = existingConfig.reconnect ?? {
    enabled: true,
    maxRetries: 10,
    backoffMs: 5000,
  };

  showCurrentConfigNote("Current community config", [
    `Endpoint: ${existingConfig.endpoint}`,
    `Reconnect: ${formatCommunityReconnectSummary(existingConfig)}`,
    `Agents: ${existingConfig.agents.length === 0 ? "none" : existingConfig.agents.map(formatCommunityAgentSummary).join(", ")}`,
    `Community API: ${options.authMode === "none" ? "disabled by auth=none" : communityApiEnabledBefore ? "enabled" : "disabled"}`,
  ]);
  const communityWarnings: string[] = [];
  communityWarnings.push(...buildCommunityReconnectOfficeDiagnostics({
    reconnect: reconnectConfig,
    agents: existingConfig.agents,
  }));
  communityWarnings.push(...buildCommunityApiRiskLines({
    authMode: options.authMode,
    communityApiEnabled: communityApiEnabledBefore,
    hasDedicatedCommunityToken: Boolean(communityApiTokenBefore),
    communityToken: communityApiTokenBefore,
    gatewayAuthToken,
    endpoint: existingConfig.endpoint,
    host: gatewayHost,
    agentCount: existingConfig.agents.length,
  }));
  if (communityWarnings.length > 0) {
    p.note(communityWarnings.join("\n"), "Community diagnostics");
  }

  const shouldConfigure = resolvePromptValue(await p.confirm({
    message: "Configure community access now?",
    initialValue: existingConfig.agents.length > 0 || communityApiEnabledBefore,
    active: "Yes",
    inactive: "Skip",
  }));
  if (!shouldConfigure) {
    return notes;
  }

  const endpoint = resolvePromptValue(await p.text({
    message: "Community endpoint",
    defaultValue: existingConfig.endpoint,
    validate: (value) => validateHttpUrl(value, "Community endpoint"),
  }));

  const reconnectEnabled = resolvePromptValue(await p.confirm({
    message: "Enable community reconnect?",
    initialValue: reconnectConfig.enabled,
    active: "Enable",
    inactive: "Disable",
  }));
  const reconnectMaxRetriesInput = resolvePromptValue(await p.text({
    message: "Reconnect max retries",
    defaultValue: String(reconnectConfig.maxRetries),
    validate: (value) => {
      if (!value.trim()) return "Reconnect max retries is required";
      return validateOptionalNonNegativeInt(value, "Reconnect max retries");
    },
  }));
  const reconnectBackoffMsInput = resolvePromptValue(await p.text({
    message: "Reconnect backoff ms",
    defaultValue: String(reconnectConfig.backoffMs),
    validate: (value) => {
      if (!value.trim()) return "Reconnect backoff ms is required";
      return validateOptionalNonNegativeInt(value, "Reconnect backoff ms");
    },
  }));

  await withStateDirEnv(options.stateDir, async () => {
    saveCommunityConfig({
      ...existingConfig,
      endpoint,
      reconnect: {
        enabled: reconnectEnabled,
        maxRetries: parseOptionalNonNegativeInt(reconnectMaxRetriesInput) ?? reconnectConfig.maxRetries,
        backoffMs: parseOptionalNonNegativeInt(reconnectBackoffMsInput) ?? reconnectConfig.backoffMs,
      },
    });
  });
  notes.push(`Community config saved: ${path.join(options.stateDir, "community.json")}`);

  const agentAction = existingConfig.agents.length > 0
    ? resolvePromptValue(await p.select<"upsert" | "remove" | "organize" | "skip">({
      message: "Community agent action",
      options: [
        { value: "upsert", label: "Add or update one agent", hint: `${existingConfig.agents.length} existing` },
        { value: "remove", label: "Remove one agent" },
        { value: "organize", label: "Organize agents", hint: "Sort or remove multiple agents" },
        { value: "skip", label: "Skip agent changes" },
      ],
      initialValue: "upsert",
    }))
    : resolvePromptValue(await p.confirm({
      message: "Add one community agent now?",
      initialValue: true,
      active: "Yes",
      inactive: "Skip",
    })) ? "upsert" : "skip";

  if (agentAction === "upsert") {
    const targetAgentName = existingConfig.agents.length > 0
      ? resolvePromptValue(await p.select<string>({
        message: "Choose community agent",
        options: [
          { value: "__new__", label: "Create new agent", hint: "Keep existing agents" },
          ...existingConfig.agents.map((agent) => ({
            value: agent.name,
            label: agent.name,
            hint: agent.room?.name ? `room=${agent.room.name}` : "room not set",
          })),
        ],
        initialValue: existingConfig.agents[0]?.name ?? "__new__",
      }))
      : "__new__";
    const existingAgent = targetAgentName === "__new__"
      ? undefined
      : existingConfig.agents.find((item) => item.name === targetAgentName);
    const name = resolvePromptValue(await p.text({
      message: "Community agent name",
      defaultValue: existingAgent?.name ?? (existingConfig.agents.length === 0 ? "default" : `agent-${existingConfig.agents.length + 1}`),
      validate: (value) => (!value.trim() ? "Agent name is required" : undefined),
    }));
    const apiKey = await promptSecret("Community agent API key", existingAgent?.apiKey);
    const roomName = resolvePromptValue(await p.text({
      message: "Room name (optional)",
      defaultValue: existingAgent?.room?.name ?? "",
    }));
    const roomPassword = roomName
      ? resolvePromptValue(await p.text({
        message: "Room password (optional)",
        defaultValue: existingAgent?.room?.password ?? "",
      }))
      : "";
    const officeDownloadDir = resolvePromptValue(await p.text({
      message: "Office download dir (optional)",
      defaultValue: existingAgent?.office?.downloadDir ?? "",
    }));
    const officeUploadRootsInput = resolvePromptValue(await p.text({
      message: "Office upload roots (optional, comma-separated)",
      defaultValue: existingAgent?.office?.uploadRoots?.join(", ") ?? "",
    }));
    const officeUploadRoots = parseCommaSeparatedList(officeUploadRootsInput);
    const office = officeDownloadDir.trim() || officeUploadRoots.length > 0
      ? {
        downloadDir: officeDownloadDir.trim() || undefined,
        uploadRoots: officeUploadRoots.length > 0 ? officeUploadRoots : undefined,
      }
      : undefined;

    const agentConfig: CommunityAgentConfig = {
      name,
      apiKey,
      office,
      room: roomName
        ? {
          name: roomName,
          password: roomPassword.trim() || undefined,
        }
        : undefined,
    };
    await withStateDirEnv(options.stateDir, async () => {
      const latestConfig = loadCommunityConfig();
      const insertIndex = targetAgentName === "__new__"
        ? latestConfig.agents.length
        : Math.max(0, latestConfig.agents.findIndex((item) => item.name === targetAgentName));
      const nextAgents = latestConfig.agents.filter((item) => item.name !== targetAgentName && item.name !== name);
      nextAgents.splice(Math.min(insertIndex, nextAgents.length), 0, agentConfig);
      saveCommunityConfig({
        ...latestConfig,
        agents: nextAgents,
      });
    });
    notes.push(`Community agent updated: ${name}`);
  } else if (agentAction === "remove") {
    const agentName = resolvePromptValue(await p.select<string>({
      message: "Choose community agent to remove",
      options: existingConfig.agents.map((agent) => ({
        value: agent.name,
        label: agent.name,
        hint: agent.room?.name ? `room=${agent.room.name}` : "room not set",
      })),
      initialValue: existingConfig.agents[0]?.name,
    }));
    const confirmed = resolvePromptValue(await p.confirm({
      message: `Remove community agent "${agentName}"?`,
      initialValue: false,
      active: "Remove",
      inactive: "Keep",
    }));
    if (confirmed) {
      await withStateDirEnv(options.stateDir, async () => {
        removeAgentConfig(agentName);
      });
      notes.push(`Community agent removed: ${agentName}`);
    }
  } else if (agentAction === "organize") {
    const organizeAction = resolvePromptValue(await p.select<CommunityOrganizeAction>({
      message: "Organize community agents",
      options: [
        { value: "sort_name", label: "Sort by agent name" },
        { value: "sort_room", label: "Sort by room name" },
        { value: "sort_office", label: "Sort by office readiness", hint: "Agents with office config first" },
        { value: "edit_room_multiple", label: "Edit room for multiple agents", hint: "Batch set or clear room name/password" },
        { value: "edit_office_multiple", label: "Edit office for multiple agents", hint: "Batch set or clear office paths" },
        { value: "remove_multiple", label: "Remove multiple agents" },
      ],
      initialValue: "sort_name",
    }));
    if (organizeAction === "remove_multiple") {
      const names = await promptCommunityAgentNamesToManage(existingConfig.agents, "remove");
      if (names.length === 0) {
        return notes;
      }
      const confirmed = resolvePromptValue(await p.confirm({
        message: `Remove ${names.length} community agent(s)?`,
        initialValue: false,
        active: "Remove",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      await withStateDirEnv(options.stateDir, async () => {
        const latestConfig = loadCommunityConfig();
        saveCommunityConfig({
          ...latestConfig,
          agents: removeCommunityAgents(latestConfig.agents, names),
        });
      });
      notes.push(`Community agents removed: ${names.join(", ")}`);
    } else if (organizeAction === "edit_room_multiple") {
      const names = await promptCommunityAgentNamesToManage(existingConfig.agents, "update room for");
      if (names.length === 0) {
        return notes;
      }
      const roomName = resolvePromptValue(await p.text({
        message: "Batch room name (blank to clear room)",
        defaultValue: "",
      }));
      const roomPassword = roomName.trim()
        ? resolvePromptValue(await p.text({
          message: "Batch room password (optional)",
          defaultValue: "",
        }))
        : "";
      const confirmed = resolvePromptValue(await p.confirm({
        message: roomName.trim()
          ? `Update room for ${names.length} community agent(s)?`
          : `Clear room for ${names.length} community agent(s)?`,
        initialValue: false,
        active: "Apply",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      await withStateDirEnv(options.stateDir, async () => {
        const latestConfig = loadCommunityConfig();
        saveCommunityConfig({
          ...latestConfig,
          agents: updateCommunityAgentsRoom(latestConfig.agents, names, {
            roomName,
            roomPassword,
          }),
        });
      });
      notes.push(
        roomName.trim()
          ? `Community agents room updated: ${names.join(", ")} -> room=${roomName.trim()}`
          : `Community agents room cleared: ${names.join(", ")}`,
      );
    } else if (organizeAction === "edit_office_multiple") {
      const names = await promptCommunityAgentNamesToManage(existingConfig.agents, "update office for");
      if (names.length === 0) {
        return notes;
      }
      const officeDownloadDir = resolvePromptValue(await p.text({
        message: "Batch office download dir (blank to clear)",
        defaultValue: "",
      }));
      const officeUploadRootsInput = resolvePromptValue(await p.text({
        message: "Batch office upload roots (blank to clear, comma-separated)",
        defaultValue: "",
      }));
      const officeUploadRoots = parseCommaSeparatedList(officeUploadRootsInput);
      const confirmed = resolvePromptValue(await p.confirm({
        message: officeDownloadDir.trim() || officeUploadRoots.length > 0
          ? `Update office for ${names.length} community agent(s)?`
          : `Clear office for ${names.length} community agent(s)?`,
        initialValue: false,
        active: "Apply",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      await withStateDirEnv(options.stateDir, async () => {
        const latestConfig = loadCommunityConfig();
        saveCommunityConfig({
          ...latestConfig,
          agents: updateCommunityAgentsOffice(latestConfig.agents, names, {
            downloadDir: officeDownloadDir,
            uploadRoots: officeUploadRoots,
          }),
        });
      });
      notes.push(
        officeDownloadDir.trim() || officeUploadRoots.length > 0
          ? `Community agents office updated: ${names.join(", ")}` +
            `${officeDownloadDir.trim() ? ` downloadDir=${officeDownloadDir.trim()}` : ""}` +
            `${officeUploadRoots.length > 0 ? ` uploadRoots=${officeUploadRoots.join(", ")}` : ""}`
          : `Community agents office cleared: ${names.join(", ")}`,
      );
    } else {
      await withStateDirEnv(options.stateDir, async () => {
        const latestConfig = loadCommunityConfig();
        saveCommunityConfig({
          ...latestConfig,
          agents: sortCommunityAgents(latestConfig.agents, organizeAction),
        });
      });
      notes.push(`Community agents organized: ${organizeAction.replace("sort_", "sort by ")}`);
    }
  }

  if (options.authMode === "none") {
    p.note(
      "Current auth mode is none. Community HTTP API stays disabled until token/password auth is enabled.",
      "Community API skipped",
    );
    updateEnvValue(options.envPath, "BELLDANDY_COMMUNITY_API_ENABLED", "false");
    removeEnvValue(options.envPath, "BELLDANDY_COMMUNITY_API_TOKEN");
    return notes;
  }

  const communityApiEnabled = resolvePromptValue(await p.confirm({
    message: "Enable Community HTTP API (/api/message)?",
    initialValue: parseBooleanEnv(envValues.get("BELLDANDY_COMMUNITY_API_ENABLED"), false),
    active: "Enable",
    inactive: "Disable",
  }));
  updateEnvValue(options.envPath, "BELLDANDY_COMMUNITY_API_ENABLED", communityApiEnabled ? "true" : "false");
  const latestCommunityConfig = await withStateDirEnv(options.stateDir, async () => loadCommunityConfig());

  if (communityApiEnabled) {
    const existingToken = envValues.get("BELLDANDY_COMMUNITY_API_TOKEN");
    const useDedicatedToken = options.authMode === "password"
      ? true
      : resolvePromptValue(await p.confirm({
        message: "Use a dedicated Community API token instead of falling back to gateway auth?",
        initialValue: Boolean(existingToken),
        active: "Dedicated",
        inactive: "Reuse gateway auth",
      }));
    let configuredCommunityToken = "";
    if (useDedicatedToken) {
      const token = await promptSecret("Community API token", existingToken);
      updateEnvValue(options.envPath, "BELLDANDY_COMMUNITY_API_TOKEN", token);
      configuredCommunityToken = token;
      notes.push("Community HTTP API enabled with dedicated token");
    } else {
      removeEnvValue(options.envPath, "BELLDANDY_COMMUNITY_API_TOKEN");
      notes.push("Community HTTP API enabled and will reuse gateway auth token");
    }
    const apiRiskLines = buildCommunityApiRiskLines({
      authMode: options.authMode,
      communityApiEnabled: true,
      hasDedicatedCommunityToken: useDedicatedToken,
      communityToken: configuredCommunityToken,
      gatewayAuthToken,
      endpoint,
      host: gatewayHost,
      agentCount: latestCommunityConfig.agents.length,
    });
    if (apiRiskLines.length > 0) {
      p.note(apiRiskLines.join("\n"), "Community API risk");
    }
  } else {
    removeEnvValue(options.envPath, "BELLDANDY_COMMUNITY_API_TOKEN");
    notes.push("Community HTTP API disabled");
    if (communityApiTokenBefore) {
      p.note(
        "Community API token was removed because Community HTTP API is disabled.",
        "Community API risk",
      );
    }
  }

  return notes;
}

async function runModelsModule(options: AdvancedModulesWizardOptions): Promise<string[]> {
  const notes: string[] = [];
  const configPath = resolveModelFallbackConfigPath(options.stateDir);
  const existingConfig = await readModelFallbackConfig(configPath);
  const envValues = getEnvMap(options.envPath);
  const preferredProviderValue = envValues.get("BELLDANDY_MODEL_PREFERRED_PROVIDERS") ?? "";

  showCurrentConfigNote("Current fallback models", [
    `Count: ${existingConfig.fallbacks.length}`,
    `Entries: ${existingConfig.fallbacks.length === 0 ? "none" : existingConfig.fallbacks.map(formatFallbackSummary).join(", ")}`,
    `Preferred providers: ${summarizePreferredProviderConfig(preferredProviderValue)}`,
  ]);
  const modelWarnings = buildModelProviderProtocolDiagnostics({
    fallbacks: existingConfig.fallbacks,
  });
  if (modelWarnings.length > 0) {
    p.note(modelWarnings.join("\n"), "Model diagnostics");
  }
  const catalogLinkLines = buildModelCatalogPickerLinkLines({
    fallbacks: existingConfig.fallbacks,
    preferredProviderValue,
  });
  if (catalogLinkLines.length > 0) {
    p.note(catalogLinkLines.join("\n"), "Catalog / picker link");
  }

  const shouldConfigure = resolvePromptValue(await p.confirm({
    message: "Configure fallback models now?",
    initialValue: existingConfig.fallbacks.length > 0,
    active: "Yes",
    inactive: "Skip",
  }));
  if (!shouldConfigure) {
    return notes;
  }

  const action = existingConfig.fallbacks.length > 0
    ? resolvePromptValue(await p.select<"upsert" | "preferred_providers" | "remove" | "organize" | "clear">({
      message: "Fallback model action",
      options: [
        { value: "upsert", label: "Add or update one fallback", hint: `${existingConfig.fallbacks.length} existing` },
        { value: "preferred_providers", label: "Edit preferred provider order", hint: "BELLDANDY_MODEL_PREFERRED_PROVIDERS" },
        { value: "remove", label: "Remove one fallback" },
        { value: "organize", label: "Organize fallbacks", hint: "Sort or remove multiple entries" },
        { value: "clear", label: "Clear all fallbacks" },
      ],
      initialValue: "upsert",
    }))
    : resolvePromptValue(await p.select<"upsert" | "preferred_providers">({
      message: "Fallback model action",
      options: [
        { value: "upsert", label: "Add first fallback" },
        { value: "preferred_providers", label: "Edit preferred provider order", hint: "BELLDANDY_MODEL_PREFERRED_PROVIDERS" },
      ],
      initialValue: "upsert",
    }));

  if (action === "preferred_providers") {
    const nextPreferredProviders = resolvePromptValue(await p.text({
      message: "Preferred provider order (comma-separated, optional)",
      placeholder: "anthropic, moonshot, openai",
      defaultValue: preferredProviderValue,
      validate: validatePreferredProviderInput,
    }));
    const previewLines = buildPreferredProviderConfigPreviewLines({
      fallbacks: existingConfig.fallbacks,
      currentValue: preferredProviderValue,
      nextValue: nextPreferredProviders,
    });
    if (previewLines.length > 0) {
      p.note(previewLines.join("\n"), "Preferred providers preview");
    }
    const confirmed = resolvePromptValue(await p.confirm({
      message: nextPreferredProviders.trim()
        ? "Apply preferred provider order?"
        : "Clear preferred provider order?",
      initialValue: false,
      active: nextPreferredProviders.trim() ? "Apply" : "Clear",
      inactive: "Keep",
    }));
    if (!confirmed) {
      return notes;
    }
    if (nextPreferredProviders.trim()) {
      updateEnvValue(options.envPath, "BELLDANDY_MODEL_PREFERRED_PROVIDERS", nextPreferredProviders.trim());
      notes.push(`Preferred providers updated: ${summarizePreferredProviderConfig(nextPreferredProviders)}`);
    } else {
      removeEnvValue(options.envPath, "BELLDANDY_MODEL_PREFERRED_PROVIDERS");
      notes.push("Preferred providers cleared; picker will infer order from the current default provider bucket");
    }
    return notes;
  }

  if (action === "clear") {
    await writeModelFallbackConfig(configPath, { fallbacks: [] });
    notes.push(`Cleared fallback models: ${configPath}`);
    return notes;
  }

  if (action === "remove") {
    const fallbackId = resolvePromptValue(await p.select<string>({
      message: "Choose fallback to remove",
      options: existingConfig.fallbacks.map((profile) => ({
        value: profile.id ?? "",
        label: profile.id ?? "<missing-id>",
        hint: profile.model ?? profile.baseUrl ?? "configured fallback",
      })),
      initialValue: existingConfig.fallbacks[0]?.id ?? "",
    }));
    const confirmed = resolvePromptValue(await p.confirm({
      message: `Remove fallback "${fallbackId}"?`,
      initialValue: false,
      active: "Remove",
      inactive: "Keep",
    }));
    if (!confirmed) {
      return notes;
    }
    const nextConfig = removeModelFallbackProfile(existingConfig, fallbackId);
    await writeModelFallbackConfig(configPath, nextConfig);
    notes.push(`Removed fallback model: ${fallbackId} (${nextConfig.fallbacks.length} remaining)`);
    return notes;
  }

  if (action === "organize") {
    const organizeAction = resolvePromptValue(await p.select<"sort_id" | "sort_display_name" | "sort_model" | "edit_advanced_multiple" | "remove_multiple">({
      message: "Organize fallback list",
      options: [
        { value: "sort_id", label: "Sort by id" },
        { value: "sort_display_name", label: "Sort by display name" },
        { value: "sort_model", label: "Sort by model name" },
        { value: "edit_advanced_multiple", label: "Batch edit advanced fields", hint: "protocol / wireApi / timeout / retries / proxy" },
        { value: "remove_multiple", label: "Remove multiple fallbacks" },
      ],
      initialValue: "sort_id",
    }));

    if (organizeAction === "remove_multiple") {
      const idsToRemove = await promptFallbackIdsToRemove(existingConfig.fallbacks);
      if (idsToRemove.length === 0) {
        return notes;
      }
      const confirmed = resolvePromptValue(await p.confirm({
        message: `Remove ${idsToRemove.length} fallback(s)?`,
        initialValue: false,
        active: "Remove",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      const nextConfig = removeModelFallbackProfiles(existingConfig, idsToRemove);
      await writeModelFallbackConfig(configPath, nextConfig);
      notes.push(`Removed ${idsToRemove.length} fallback model(s): ${idsToRemove.join(", ")}`);
      notes.push(`Fallback models saved: ${configPath} (${nextConfig.fallbacks.length} total)`);
      return notes;
    }

    if (organizeAction === "edit_advanced_multiple") {
      const idsToEdit = await promptModelFallbackIdsToManage(existingConfig.fallbacks, "batch edit");
      if (idsToEdit.length === 0) {
        return notes;
      }
      const patch = await promptModelFallbackAdvancedBatchPatch();
      const patchSummary = summarizeModelFallbackAdvancedBatchPatch(patch);
      if (patchSummary.length === 0) {
        return notes;
      }
      const confirmed = resolvePromptValue(await p.confirm({
        message: `Apply advanced field updates to ${idsToEdit.length} fallback(s)?`,
        initialValue: false,
        active: "Apply",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      const nextConfig = {
        fallbacks: applyModelFallbackAdvancedBatchPatch(existingConfig.fallbacks, idsToEdit, patch),
      };
      await writeModelFallbackConfig(configPath, nextConfig);
      notes.push(`Updated advanced fields for ${idsToEdit.length} fallback(s): ${idsToEdit.join(", ")}`);
      notes.push(`Advanced fields: ${patchSummary.join("; ")}`);
      notes.push(`Fallback models saved: ${configPath} (${nextConfig.fallbacks.length} total)`);
      return notes;
    }

    const sortMode = organizeAction === "sort_display_name"
      ? "displayName"
      : organizeAction === "sort_model"
        ? "model"
        : "id";
    const nextConfig = sortModelFallbackProfiles(existingConfig, sortMode);
    const previousOrder = existingConfig.fallbacks.map((item) => item.id ?? "").join("\n");
    const nextOrder = nextConfig.fallbacks.map((item) => item.id ?? "").join("\n");
    if (previousOrder === nextOrder) {
      return notes;
    }
    await writeModelFallbackConfig(configPath, nextConfig);
    notes.push(`Fallback models sorted by ${sortMode}`);
    notes.push(`Fallback models saved: ${configPath} (${nextConfig.fallbacks.length} total)`);
    return notes;
  }

  const selectedFallbackId = existingConfig.fallbacks.length > 0
    ? resolvePromptValue(await p.select<string>({
      message: "Choose fallback to edit",
      options: [
        { value: "__new__", label: "Create new fallback", hint: "Keep existing fallbacks" },
        ...existingConfig.fallbacks.map((profile) => ({
          value: profile.id ?? "",
          label: profile.id ?? "<missing-id>",
          hint: profile.model ?? profile.baseUrl ?? "configured fallback",
        })),
      ],
      initialValue: existingConfig.fallbacks[0]?.id ?? "__new__",
    }))
    : "__new__";
  const defaultProfile = selectedFallbackId === "__new__"
    ? undefined
    : existingConfig.fallbacks.find((item) => item.id === selectedFallbackId);
  const id = resolvePromptValue(await p.text({
    message: "Fallback id",
    defaultValue: defaultProfile?.id ?? `fallback-${existingConfig.fallbacks.length + 1}`,
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "Fallback id is required";
      }
      const conflict = existingConfig.fallbacks.find((item) => item.id === trimmed);
      if (conflict && trimmed !== (defaultProfile?.id ?? "")) {
        return `Fallback id "${trimmed}" already exists`;
      }
      return undefined;
    },
  }));
  const existingProfile = defaultProfile;
  const displayName = resolvePromptValue(await p.text({
    message: "Display name (optional)",
    defaultValue: existingProfile?.displayName ?? "",
  }));
  const baseUrl = resolvePromptValue(await p.text({
    message: "Fallback API Base URL",
    defaultValue: existingProfile?.baseUrl ?? "https://api.openai.com/v1",
    validate: (value) => validateHttpUrl(value, "Fallback API Base URL"),
  }));
  const apiKey = await promptSecret("Fallback API key", existingProfile?.apiKey);
  const model = resolvePromptValue(await p.text({
    message: "Fallback model name",
    defaultValue: existingProfile?.model ?? "",
    validate: (value) => (!value.trim() ? "Model name is required" : undefined),
  }));
  const protocol = await promptOptionalChoice("Protocol override (optional)", MODEL_PROTOCOL_CHOICES, existingProfile?.protocol);
  const wireApi = await promptOptionalChoice("Wire API override (optional)", MODEL_WIRE_API_CHOICES, existingProfile?.wireApi);
  const requestTimeoutMsRaw = resolvePromptValue(await p.text({
    message: "Request timeout ms (optional)",
    defaultValue: existingProfile?.requestTimeoutMs != null ? String(existingProfile.requestTimeoutMs) : "",
    validate: (value) => validateOptionalPositiveInt(value, "Request timeout"),
  }));
  const maxRetriesRaw = resolvePromptValue(await p.text({
    message: "Max retries (optional)",
    defaultValue: existingProfile?.maxRetries != null ? String(existingProfile.maxRetries) : "",
    validate: (value) => validateOptionalNonNegativeInt(value, "Max retries"),
  }));
  const retryBackoffMsRaw = resolvePromptValue(await p.text({
    message: "Retry backoff ms (optional)",
    defaultValue: existingProfile?.retryBackoffMs != null ? String(existingProfile.retryBackoffMs) : "",
    validate: (value) => validateOptionalPositiveInt(value, "Retry backoff"),
  }));
  const proxyUrl = resolvePromptValue(await p.text({
    message: "Proxy URL (optional)",
    defaultValue: existingProfile?.proxyUrl ?? "",
    validate: (value) => validateOptionalUrl(value, "Proxy URL"),
  }));

  const baseConfig = defaultProfile && defaultProfile.id !== id
    ? removeModelFallbackProfile(existingConfig, defaultProfile.id ?? "")
    : existingConfig;
  const nextConfig = upsertModelFallbackProfile(baseConfig, {
    id,
    displayName: displayName.trim() || undefined,
    baseUrl,
    apiKey,
    model,
    protocol,
    wireApi,
    requestTimeoutMs: parseOptionalPositiveInt(requestTimeoutMsRaw),
    maxRetries: parseOptionalNonNegativeInt(maxRetriesRaw),
    retryBackoffMs: parseOptionalPositiveInt(retryBackoffMsRaw),
    proxyUrl: proxyUrl.trim() || undefined,
  });
  await writeModelFallbackConfig(configPath, nextConfig);
  notes.push(`Fallback models saved: ${configPath} (${nextConfig.fallbacks.length} total)`);
  return notes;
}

async function runWebhookModule(options: AdvancedModulesWizardOptions): Promise<string[]> {
  const notes: string[] = [];
  const configPath = path.join(options.stateDir, "webhooks.json");
  let organizeState = await loadWebhookOrganizeState(options.stateDir);
  const organizeStatePath = getWebhookOrganizeStatePath(options.stateDir);
  const existingConfig = loadWebhookConfig(configPath);
  const enabledRuleCount = existingConfig.webhooks.filter((rule) => rule.enabled !== false).length;
  const disabledRuleCount = existingConfig.webhooks.length - enabledRuleCount;
  const customTemplateCount = existingConfig.webhooks.filter((rule) => Boolean(rule.promptTemplate?.trim())).length;
  const defaultTemplateCount = existingConfig.webhooks.length - customTemplateCount;

  showCurrentConfigNote("Current webhook config", [
    `Count: ${existingConfig.webhooks.length}`,
    `Enabled: ${enabledRuleCount}; Disabled: ${disabledRuleCount}; Custom templates: ${customTemplateCount}`,
    `Entries: ${existingConfig.webhooks.length === 0 ? "none" : existingConfig.webhooks.map(formatWebhookSummary).join(", ")}`,
    `Organize presets: ${organizeState.customPresets.length}`,
    ...(organizeState.lastSelection ? [`Last organize hit: ${organizeState.lastSelection.label}`] : []),
    ...(organizeState.lastPreview
      ? [`Last preview: ${formatWebhookOrganizeActionLabel(organizeState.lastPreview.action)} -> ${organizeState.lastPreview.label}`]
      : []),
  ]);
  const webhookWarnings: string[] = [];
  if (enabledRuleCount > 0 && defaultTemplateCount > 0) {
    webhookWarnings.push(`${defaultTemplateCount} webhook rule(s) still use JSON.stringify(payload) fallback.`);
  }
  if (disabledRuleCount > 0) {
    webhookWarnings.push(`${disabledRuleCount} webhook rule(s) are currently disabled.`);
  }
  const templatePlaceholderWarnings = existingConfig.webhooks
    .filter((rule) => Boolean(rule.promptTemplate?.trim()))
    .flatMap((rule) => {
      const placeholders = extractWebhookTemplatePlaceholders(rule.promptTemplate ?? "");
      const warnings: string[] = [];
      if (placeholders.length === 0) {
        warnings.push(`Webhook "${rule.id}" uses a custom template but has no {{placeholders}}.`);
      }
      const unsupported = findUnsupportedWebhookPlaceholderKeys(placeholders);
      if (unsupported.length > 0) {
        warnings.push(`Webhook "${rule.id}" uses unsupported nested placeholders: ${unsupported.join(", ")}`);
      }
      return warnings;
    });
  webhookWarnings.push(...templatePlaceholderWarnings);
  if (webhookWarnings.length > 0) {
    p.note(webhookWarnings.join("\n"), "Webhook diagnostics");
  }

  const shouldConfigure = resolvePromptValue(await p.confirm({
    message: "Configure webhook API now?",
    initialValue: existingConfig.webhooks.length > 0,
    active: "Yes",
    inactive: "Skip",
  }));
  if (!shouldConfigure) {
    return notes;
  }

  const action = existingConfig.webhooks.length > 0
    ? resolvePromptValue(await p.select<"upsert" | "remove" | "organize" | "clear">({
      message: "Webhook action",
      options: [
        { value: "upsert", label: "Add or update one webhook", hint: `${existingConfig.webhooks.length} existing` },
        { value: "remove", label: "Remove one webhook" },
        { value: "organize", label: "Organize webhooks", hint: "Batch enable, disable, or remove" },
        { value: "clear", label: "Clear all webhooks" },
      ],
      initialValue: "upsert",
    }))
    : "upsert";

  if (action === "clear") {
    const cleared: WebhookConfig = { version: 1, webhooks: [] };
    await writeJsonFile(configPath, cleared);
    notes.push(`Cleared webhook config: ${configPath}`);
    return notes;
  }

  if (action === "remove") {
    const webhookId = resolvePromptValue(await p.select<string>({
      message: "Choose webhook to remove",
      options: existingConfig.webhooks.map((rule) => ({
        value: rule.id,
        label: rule.id,
        hint: rule.defaultAgentId ?? "default agent",
      })),
      initialValue: existingConfig.webhooks[0]?.id,
    }));
    const confirmed = resolvePromptValue(await p.confirm({
      message: `Remove webhook "${webhookId}"?`,
      initialValue: false,
      active: "Remove",
      inactive: "Keep",
    }));
    if (!confirmed) {
      return notes;
    }
    const nextConfig = removeWebhookRule(existingConfig, webhookId);
    await writeJsonFile(configPath, nextConfig);
    notes.push(`Webhook removed: ${webhookId} (${nextConfig.webhooks.length} remaining)`);
    return notes;
  }

  if (action === "organize") {
    const organizeAction = resolvePromptValue(await p.select<WebhookOrganizeAction | "preset_strategy" | "saved_strategy" | "manage_saved_strategies" | "reuse_preview_result">({
      message: "Organize webhook list",
      options: [
        { value: "enable_multiple", label: "Enable multiple webhooks" },
        { value: "disable_multiple", label: "Disable multiple webhooks" },
        { value: "remove_multiple", label: "Remove multiple webhooks" },
        { value: "preset_strategy", label: "Apply strategy preset", hint: "Use a recommended state + template combination" },
        ...(organizeState.customPresets.length > 0
          ? [
            { value: "saved_strategy" as const, label: "Apply saved custom strategy", hint: `${organizeState.customPresets.length} saved` },
            { value: "manage_saved_strategies" as const, label: "Manage saved custom strategies", hint: "Rename, remove, or clear saved presets" },
          ]
          : []),
        ...(organizeState.lastPreview
          ? [{
            value: "reuse_preview_result" as const,
            label: "Reuse last preview result",
            hint: `${formatWebhookOrganizeActionLabel(organizeState.lastPreview.action)}; ${organizeState.lastPreview.label}`,
          }]
          : []),
      ],
      initialValue: "enable_multiple",
    }));
    let selectedAction: WebhookOrganizeAction = organizeAction === "enable_multiple"
      || organizeAction === "disable_multiple"
      || organizeAction === "remove_multiple"
      ? organizeAction
      : "enable_multiple";
    let selectedRules = existingConfig.webhooks;
    let selectionLabel = "All webhooks";
    let selectedCriteria: ReturnType<typeof buildWebhookOrganizeCriteriaFromFilterMode> | null = {
      enabled: "any",
      template: "any",
    };
    if (organizeAction === "reuse_preview_result") {
      const lastPreview = organizeState.lastPreview;
      selectedRules = lastPreview
        ? existingConfig.webhooks.filter((rule) => lastPreview.webhookIds.includes(rule.id))
        : [];
      selectedAction = lastPreview?.action ?? "enable_multiple";
      selectionLabel = lastPreview?.label ?? "Last preview result";
      selectedCriteria = null;
      if (selectedRules.length === 0) {
        p.note(
          lastPreview
            ? `Last preview result no longer matches available webhooks: ${lastPreview.label}.`
            : "No reusable last preview result is available.",
          "Webhook reuse preview",
        );
        return notes;
      }
      p.note(
        `Reusing last preview result (${selectedRules.length}): ${selectedRules.map((rule) => rule.id).join(", ")}`,
        "Webhook reuse preview",
      );
    } else if (organizeAction === "saved_strategy") {
      const presetId = resolvePromptValue(await p.select<string>({
        message: "Choose saved custom strategy",
        options: organizeState.customPresets.map((preset) => ({
          value: preset.id,
          label: preset.label,
          hint: `${formatWebhookOrganizeActionLabel(preset.action)}; ${summarizeWebhookOrganizeCriteria(preset.criteria)}`,
        })),
        initialValue: organizeState.customPresets[0]?.id,
      }));
      const preset = organizeState.customPresets.find((item) => item.id === presetId);
      if (!preset) {
        return notes;
      }
      selectedAction = preset.action;
      selectedCriteria = preset.criteria;
      selectedRules = filterWebhookRulesByCriteria(existingConfig.webhooks, preset.criteria);
      selectionLabel = `Saved preset ${preset.label}`;
      if (selectedRules.length === 0) {
        p.note(
          `Saved preset "${preset.label}" matched no webhooks. Criteria: ${summarizeWebhookOrganizeCriteria(preset.criteria)}.`,
          "Webhook saved strategy",
        );
        return notes;
      }
      p.note(
        [
          `Saved preset: ${preset.label}`,
          `Action: ${formatWebhookOrganizeActionLabel(preset.action)}`,
          `Criteria: ${summarizeWebhookOrganizeCriteria(preset.criteria)}`,
          `Matched webhook IDs: ${selectedRules.map((rule) => rule.id).join(", ")}`,
        ].join("\n"),
        "Webhook saved strategy",
      );
    } else if (organizeAction === "manage_saved_strategies") {
      const manageAction = resolvePromptValue(await p.select<"rename_one" | "remove_one" | "clear_all">({
        message: "Manage saved custom strategies",
        options: [
          { value: "rename_one", label: "Rename one strategy" },
          { value: "remove_one", label: "Remove one strategy" },
          { value: "clear_all", label: "Clear all saved strategies", hint: `${organizeState.customPresets.length} saved` },
        ],
        initialValue: "rename_one",
      }));
      if (manageAction === "clear_all") {
        const confirmed = resolvePromptValue(await p.confirm({
          message: `Clear all ${organizeState.customPresets.length} saved custom strategy entries?`,
          initialValue: false,
          active: "Clear",
          inactive: "Keep",
        }));
        if (!confirmed) {
          return notes;
        }
        organizeState = clearWebhookOrganizeCustomPresets(organizeState);
        await saveWebhookOrganizeState(options.stateDir, organizeState);
        p.note(`Cleared all saved custom strategies from ${organizeStatePath}.`, "Webhook saved strategy");
        notes.push(`Cleared saved webhook strategies: ${organizeStatePath}`);
        return notes;
      }
      const presetId = resolvePromptValue(await p.select<string>({
        message: manageAction === "rename_one" ? "Choose saved strategy to rename" : "Choose saved strategy to remove",
        options: organizeState.customPresets.map((preset) => ({
          value: preset.id,
          label: preset.label,
          hint: `${formatWebhookOrganizeActionLabel(preset.action)}; ${summarizeWebhookOrganizeCriteria(preset.criteria)}`,
        })),
        initialValue: organizeState.customPresets[0]?.id,
      }));
      const preset = organizeState.customPresets.find((item) => item.id === presetId);
      if (!preset) {
        return notes;
      }
      if (manageAction === "rename_one") {
        const label = resolvePromptValue(await p.text({
          message: "Saved strategy name",
          defaultValue: preset.label,
          validate: (value) => (!value.trim() ? "Saved strategy name is required" : undefined),
        }));
        organizeState = renameWebhookOrganizeCustomPreset(organizeState, preset.id, label);
        await saveWebhookOrganizeState(options.stateDir, organizeState);
        p.note(`Renamed saved strategy "${preset.label}" to "${label.trim()}" in ${organizeStatePath}.`, "Webhook saved strategy");
        notes.push(`Renamed saved webhook strategy: ${preset.label} -> ${label.trim()}`);
        return notes;
      }
      const confirmed = resolvePromptValue(await p.confirm({
        message: `Remove saved strategy "${preset.label}"?`,
        initialValue: false,
        active: "Remove",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      organizeState = removeWebhookOrganizeCustomPreset(organizeState, preset.id);
      await saveWebhookOrganizeState(options.stateDir, organizeState);
      p.note(`Removed saved strategy "${preset.label}" from ${organizeStatePath}.`, "Webhook saved strategy");
      notes.push(`Removed saved webhook strategy: ${preset.label}`);
      return notes;
    } else if (organizeAction === "preset_strategy") {
      const presetOptions = listWebhookOrganizePresets();
      const presetId = resolvePromptValue(await p.select<WebhookOrganizePresetId>({
        message: "Choose webhook strategy preset",
        options: presetOptions.map((preset) => ({
          value: preset.id,
          label: preset.label,
          hint: `${formatWebhookOrganizeActionLabel(preset.action)}; ${preset.description}`,
        })),
        initialValue: presetOptions[0]?.id,
      }));
      const preset = getWebhookOrganizePreset(presetId);
      if (!preset) {
        return notes;
      }
      selectedAction = preset.action;
      selectedCriteria = preset.criteria;
      selectedRules = filterWebhookRulesByCriteria(existingConfig.webhooks, preset.criteria);
      if (selectedRules.length === 0) {
        p.note(
          `Preset "${preset.label}" matched no webhooks. Criteria: ${summarizeWebhookOrganizeCriteria(preset.criteria)}.`,
          "Webhook organize preset",
        );
        return notes;
      }
      selectionLabel = `Preset ${preset.label}`;
      p.note(
        [
          `Preset: ${preset.label}`,
          `Action: ${formatWebhookOrganizeActionLabel(preset.action)}`,
          `Criteria: ${summarizeWebhookOrganizeCriteria(preset.criteria)}`,
          `Matched webhook IDs: ${selectedRules.map((rule) => rule.id).join(", ")}`,
        ].join("\n"),
        "Webhook organize preset",
      );
    } else {
      const selectionMode = resolvePromptValue(await p.select<"all" | "filter" | "reuse_last_selection">({
        message: "How should webhooks be selected?",
        options: [
          { value: "all", label: "All webhooks" },
          { value: "filter", label: "Filter webhooks first", hint: "Limit the batch by current state or template usage" },
          ...(organizeState.lastSelection
            ? [{
              value: "reuse_last_selection" as const,
              label: "Reuse last selected webhooks",
              hint: organizeState.lastSelection.label,
            }]
            : []),
        ],
        initialValue: "all",
      }));
      if (selectionMode === "reuse_last_selection") {
        const lastSelection = organizeState.lastSelection;
        selectedRules = lastSelection
          ? existingConfig.webhooks.filter((rule) => lastSelection.webhookIds.includes(rule.id))
          : [];
        selectionLabel = lastSelection?.label ?? "Last selected webhooks";
        selectedCriteria = null;
        if (selectedRules.length === 0) {
          p.note(
            lastSelection
              ? `Last selected webhooks no longer exist in webhooks.json: ${lastSelection.label}.`
              : "No reusable last selection is available.",
            "Webhook reuse selection",
          );
          return notes;
        }
        p.note(
          `Reusing last selected webhooks (${selectedRules.length}): ${selectedRules.map((rule) => rule.id).join(", ")}`,
          "Webhook reuse selection",
        );
      } else if (selectionMode === "filter") {
        const filterMode = resolvePromptValue(await p.select<WebhookOrganizeFilterMode>({
          message: "Filter webhooks before organizing",
          options: [
            { value: "all", label: "All webhooks", hint: `${existingConfig.webhooks.length} total` },
            { value: "enabled", label: "Enabled webhooks" },
            { value: "disabled", label: "Disabled webhooks" },
            { value: "custom_template", label: "Custom templates" },
            { value: "default_template", label: "JSON fallback templates" },
          ],
          initialValue: "all",
        }));
        selectedCriteria = buildWebhookOrganizeCriteriaFromFilterMode(filterMode);
        selectedRules = filterWebhookRulesForOrganize(existingConfig.webhooks, filterMode);
        if (selectedRules.length === 0) {
          p.note(
            `No webhook rules matched filter "${formatWebhookOrganizeFilterLabel(filterMode)}".`,
            "Webhook organize filter",
          );
          return notes;
        }
        selectionLabel = filterMode === "all"
          ? "All webhooks"
          : `Filter ${formatWebhookOrganizeFilterLabel(filterMode)}`;
        if (filterMode !== "all") {
          p.note(
            `Filter "${formatWebhookOrganizeFilterLabel(filterMode)}" matched ${selectedRules.length} webhook(s): ${selectedRules.map((rule) => rule.id).join(", ")}`,
            "Webhook organize filter",
          );
        }
      }
    }
    const previewLabel = selectionLabel || buildWebhookOrganizeSelectionLabel({
      title: "Matched webhooks",
      ruleIds: selectedRules.map((rule) => rule.id),
    });
    organizeState = storeWebhookOrganizeLastPreview(organizeState, {
      label: previewLabel,
      action: selectedAction,
      webhookIds: selectedRules.map((rule) => rule.id),
    });
    await saveWebhookOrganizeState(options.stateDir, organizeState);
    p.note(
      buildWebhookOrganizePreviewLines({
        action: selectedAction,
        selectionLabel: previewLabel,
        rules: selectedRules,
      }).join("\n"),
      "Webhook organize preview",
    );
    const applyMode = resolvePromptValue(await p.select<"review_and_pick" | "apply_all_matched" | "save_as_selection" | "save_as_strategy">({
      message: "How should the matched webhooks proceed?",
      options: [
        { value: "review_and_pick", label: "Review and pick webhooks" },
        { value: "apply_all_matched", label: "Apply to all matched webhooks", hint: `${selectedRules.length} matched` },
        { value: "save_as_selection", label: "Save matched webhooks as selection", hint: "Keep this matched set for reuse without applying changes" },
        ...(selectedCriteria
          ? [{ value: "save_as_strategy" as const, label: "Save matched result as strategy", hint: "Name this action + criteria for later reuse" }]
          : []),
      ],
      initialValue: "review_and_pick",
    }));
    if (applyMode === "save_as_selection") {
      organizeState = storeWebhookOrganizeLastSelection(organizeState, {
        label: previewLabel,
        webhookIds: selectedRules.map((rule) => rule.id),
      });
      await saveWebhookOrganizeState(options.stateDir, organizeState);
      p.note(
        `Saved ${selectedRules.length} matched webhook(s) as reusable selection: ${previewLabel}.`,
        "Webhook saved selection",
      );
      notes.push(`Saved webhook selection from preview: ${selectedRules.length} webhook(s)`);
      notes.push(`Webhook organize state saved: ${organizeStatePath}`);
      return notes;
    }
    if (applyMode === "save_as_strategy" && selectedCriteria) {
      const label = resolvePromptValue(await p.text({
        message: "Saved strategy name",
        defaultValue: previewLabel,
        validate: (value) => (!value.trim() ? "Saved strategy name is required" : undefined),
      }));
      const presetId = slugifyWebhookOrganizePresetLabel(label);
      const existingPreset = organizeState.customPresets.find((item) => item.id === presetId);
      organizeState = upsertWebhookOrganizeCustomPreset(organizeState, {
        id: presetId,
        label: label.trim(),
        action: selectedAction,
        criteria: selectedCriteria,
      });
      await saveWebhookOrganizeState(options.stateDir, organizeState);
      p.note(
        buildWebhookOrganizeStrategySaveLines({
          mode: existingPreset ? "updated" : "saved",
          label: label.trim(),
          action: selectedAction,
          criteria: selectedCriteria,
          rules: selectedRules,
          statePath: organizeStatePath,
        }).join("\n"),
        "Webhook saved strategy",
      );
      notes.push(`${existingPreset ? "Updated" : "Saved"} webhook strategy: ${label.trim()}`);
      notes.push(`Webhook organize state saved: ${organizeStatePath}`);
      return notes;
    }
    const ids = applyMode === "apply_all_matched"
      ? selectedRules.map((rule) => rule.id)
      : await promptWebhookIdsToManage(
        selectedRules,
        selectedAction === "remove_multiple"
          ? "remove"
          : selectedAction === "enable_multiple"
            ? "enable"
            : "disable",
      );
    if (ids.length === 0) {
      return notes;
    }
    const confirmed = resolvePromptValue(await p.confirm({
      message: selectedAction === "remove_multiple"
        ? `Remove ${ids.length} webhook(s)?`
        : `${selectedAction === "enable_multiple" ? "Enable" : "Disable"} ${ids.length} webhook(s)?`,
      initialValue: false,
      active: selectedAction === "remove_multiple" ? "Remove" : "Apply",
      inactive: "Keep",
    }));
    if (!confirmed) {
      return notes;
    }
    organizeState = storeWebhookOrganizeLastSelection(organizeState, {
      label: applyMode === "apply_all_matched"
        ? previewLabel
        : buildWebhookOrganizeSelectionLabel({
          title: "Picked webhooks",
          ruleIds: ids,
        }),
      webhookIds: ids,
    });
    await saveWebhookOrganizeState(options.stateDir, organizeState);
    const targets = new Set(ids);
    const nextConfig: WebhookConfig = selectedAction === "remove_multiple"
      ? {
        version: 1,
        webhooks: existingConfig.webhooks.filter((rule) => !targets.has(rule.id)),
      }
      : {
        version: 1,
        webhooks: existingConfig.webhooks.map((rule) => (
          targets.has(rule.id)
            ? { ...rule, enabled: selectedAction === "enable_multiple" }
            : rule
        )),
      };
    await writeJsonFile(configPath, nextConfig);
    notes.push(
      selectedAction === "remove_multiple"
        ? `Removed ${ids.length} webhook(s): ${ids.join(", ")}`
        : `${selectedAction === "enable_multiple" ? "Enabled" : "Disabled"} ${ids.length} webhook(s): ${ids.join(", ")}`,
    );
    notes.push(`Webhook organize state saved: ${organizeStatePath}`);
    notes.push(`Webhook config saved: ${configPath} (${nextConfig.webhooks.length} total)`);
    return notes;
  }

  const selectedWebhookId = existingConfig.webhooks.length > 0
    ? resolvePromptValue(await p.select<string>({
      message: "Choose webhook to edit",
      options: [
        { value: "__new__", label: "Create new webhook", hint: "Keep existing rules" },
        ...existingConfig.webhooks.map((rule) => ({
          value: rule.id,
          label: rule.id,
          hint: rule.defaultAgentId ?? "default agent",
        })),
      ],
      initialValue: existingConfig.webhooks[0]?.id ?? "__new__",
    }))
    : "__new__";
  const defaultRule = selectedWebhookId === "__new__"
    ? undefined
    : existingConfig.webhooks.find((item) => item.id === selectedWebhookId);
  const id = resolvePromptValue(await p.text({
    message: "Webhook id",
    defaultValue: defaultRule?.id ?? "audit",
    validate: (value) => {
      const baseValidation = validateWebhookId(value);
      if (baseValidation) {
        return baseValidation;
      }
      const trimmed = value.trim();
      const conflict = existingConfig.webhooks.find((item) => item.id === trimmed);
      if (conflict && trimmed !== (defaultRule?.id ?? "")) {
        return `Webhook id "${trimmed}" already exists`;
      }
      return undefined;
    },
  }));
  const existingRule = defaultRule;
  const enabled = resolvePromptValue(await p.confirm({
    message: "Enable this webhook rule?",
    initialValue: existingRule?.enabled ?? true,
    active: "Enable",
    inactive: "Disable",
  }));
  const token = await promptSecret("Webhook bearer token", existingRule?.token);
  const defaultAgentId = resolvePromptValue(await p.text({
    message: "Default agent id (optional)",
    defaultValue: existingRule?.defaultAgentId ?? "default",
  }));
  const conversationIdPrefix = resolvePromptValue(await p.text({
    message: "Conversation id prefix (optional)",
    defaultValue: existingRule?.conversationIdPrefix ?? "",
  }));
  const promptTemplate = resolvePromptValue(await p.text({
    message: "Prompt template (optional)",
    defaultValue: existingRule?.promptTemplate ?? "",
    placeholder: "Use {{field}} placeholders from webhook payload",
  }));
  const previewPayloadInput = resolvePromptValue(await p.text({
    message: "Preview payload JSON (optional)",
    defaultValue: "",
    placeholder: "{\"event\":\"deploy\",\"status\":\"ok\"} or [{...},{...}]",
    validate: (value) => validateOptionalWebhookPreviewPayloads(value),
  }));
  if (!promptTemplate.trim()) {
    p.note(
      "Blank prompt template means webhook payload will fall back to JSON.stringify(payload). This is fine for diagnostics, but custom templates usually produce cleaner prompts.",
      "Webhook template fallback",
    );
  } else {
    const placeholders = extractWebhookTemplatePlaceholders(promptTemplate);
    if (placeholders.length === 0) {
      p.note(
        "This template does not reference any {{payload}} fields, so every webhook request will produce the same prompt text.",
        "Webhook template diagnostics",
      );
    } else {
      p.note(`Template placeholders: ${placeholders.join(", ")}`, "Webhook template placeholders");
      const unsupported = findUnsupportedWebhookPlaceholderKeys(placeholders);
      if (unsupported.length > 0) {
        p.note(
          `Only top-level payload keys are supported. Nested placeholders like ${unsupported.join(", ")} will not be resolved.`,
          "Webhook template field support",
        );
      }
      p.note(
        "Template placeholders read only from request.payload top-level keys. text / agentId / conversationId are request params and are not available as {{placeholders}} unless you copy them into payload.",
        "Webhook template field source",
      );
    }
  }
  const previewPayloads = parseOptionalWebhookPreviewPayloads(previewPayloadInput);
  if (previewPayloads.length > 0) {
    const previewRule = {
      id,
      enabled,
      token,
      defaultAgentId: defaultAgentId.trim() || undefined,
      conversationIdPrefix: conversationIdPrefix.trim() || undefined,
      promptTemplate: promptTemplate.trim() || undefined,
    };
    const previewResults = previewPayloads.map((payload, index) => ({
      label: `Sample ${index + 1}`,
      payload,
      previewText: generatePromptFromPayload(previewRule, payload),
    }));
    const unresolvedSummaries = previewResults
      .map((sample) => {
        const unresolvedPlaceholders = extractWebhookTemplatePlaceholders(sample.previewText);
        return unresolvedPlaceholders.length > 0
          ? `${sample.label}: unresolved placeholders ${unresolvedPlaceholders.join(", ")}`
          : "";
      })
      .filter(Boolean);
    const placeholderKeys = extractWebhookTemplatePlaceholders(promptTemplate);
    const missingFieldSummaries = previewResults
      .map((sample) => {
        const missingKeys = placeholderKeys.filter((key) => !(key in sample.payload));
        return missingKeys.length > 0
          ? `${sample.label}: missing top-level keys ${missingKeys.join(", ")}`
          : "";
      })
      .filter(Boolean);
    p.note(
      previewResults.length === 1
        ? `Prompt preview:\n${previewResults[0]?.previewText || "(empty)"}`
        : [
          `Compared prompt samples: ${previewResults.length}`,
          ...previewResults.map((sample) => `${sample.label} prompt preview: ${sample.previewText || "(empty)"}`),
        ].join("\n"),
      "Webhook template preview",
    );
    p.note(
      (previewResults.length === 1
        ? buildWebhookPayloadSchemaLines(previewResults[0]!.payload)
        : buildWebhookPayloadComparisonLines(previewResults.map((sample) => sample.payload))).join("\n"),
      "Webhook payload schema",
    );
    p.note(
      (previewResults.length === 1
        ? buildWebhookRequestPreviewLines({
          rule: previewRule,
          payload: previewResults[0]!.payload,
          resolvedPrompt: previewResults[0]!.previewText,
        })
        : buildWebhookRequestPreviewComparisonLines({
          rule: previewRule,
          samples: previewResults.map((sample) => ({
            payload: sample.payload,
            resolvedPrompt: sample.previewText,
          })),
        })).join("\n"),
      "Webhook request preview",
    );
    if (unresolvedSummaries.length > 0) {
      p.note(
        unresolvedSummaries.join("\n"),
        "Webhook template warning",
      );
    }
    if (missingFieldSummaries.length > 0) {
      p.note(
        missingFieldSummaries.join("\n"),
        "Webhook preview missing fields",
      );
    }
  }

  const baseConfig = defaultRule && defaultRule.id !== id
    ? removeWebhookRule(existingConfig, defaultRule.id)
    : existingConfig;
  const nextConfig = upsertWebhookRule(baseConfig, {
    id,
    enabled,
    token,
    defaultAgentId: defaultAgentId.trim() || undefined,
    conversationIdPrefix: conversationIdPrefix.trim() || undefined,
    promptTemplate: promptTemplate.trim() || undefined,
  });
  await writeJsonFile(configPath, nextConfig);
  notes.push(`Webhook config saved: ${configPath} (/api/webhook/${id})`);
  return notes;
}

async function runCronModule(options: AdvancedModulesWizardOptions): Promise<string[]> {
  const notes: string[] = [];
  const envValues = getEnvMap(options.envPath);
  const cronStore = new CronStore(options.stateDir);
  const cronOrganizeState = await loadCronOrganizeState(options.stateDir);
  const existingJobs = await cronStore.list();
  const cronJobsPath = path.join(options.stateDir, "cron-jobs.json");
  const cronOrganizeStatePath = getCronOrganizeStatePath(options.stateDir);
  const cronEnabledBefore = parseBooleanEnv(envValues.get("BELLDANDY_CRON_ENABLED"), true);
  const heartbeatEnabledBefore = parseBooleanEnv(envValues.get("BELLDANDY_HEARTBEAT_ENABLED"), true);
  const heartbeatIntervalBefore = envValues.get("BELLDANDY_HEARTBEAT_INTERVAL") ?? "30m";
  const heartbeatActiveHoursBefore = envValues.get("BELLDANDY_HEARTBEAT_ACTIVE_HOURS") ?? "";
  const enabledJobCount = existingJobs.filter((job) => job.enabled).length;
  const disabledJobCount = existingJobs.length - enabledJobCount;
  const invalidNextRunCount = existingJobs.filter((job) => job.enabled && typeof job.state.nextRunAtMs !== "number").length;
  const organizeRecommendations = buildCronOrganizeRecommendations(existingJobs);

  showCurrentConfigNote("Current automation switches", [
    `Cron runtime: ${cronEnabledBefore ? "enabled" : "disabled"}`,
    `Heartbeat runtime: ${heartbeatEnabledBefore ? `enabled (${heartbeatIntervalBefore}${heartbeatActiveHoursBefore ? `, active=${heartbeatActiveHoursBefore}` : ""})` : "disabled"}`,
    `Cron jobs: ${existingJobs.length === 0 ? "none" : `${existingJobs.length} configured (${enabledJobCount} enabled, ${disabledJobCount} disabled)`}`,
    ...(existingJobs.length === 0 ? [] : existingJobs.map((job) => `- ${formatCronJobSummary(job)}`)),
    `Cron jobs file: ${cronJobsPath}`,
    `Organize presets: ${cronOrganizeState.customPresets.length}`,
    ...(cronOrganizeState.lastSelection
      ? [`Last organize hit: ${cronOrganizeState.lastSelection.label}`]
      : []),
    ...(cronOrganizeState.lastPreview
      ? [`Last preview: ${formatCronOrganizeActionLabel(cronOrganizeState.lastPreview.action)} -> ${cronOrganizeState.lastPreview.label}`]
      : []),
    ...(organizeRecommendations.length > 0
      ? [`Suggested organize presets: ${formatSummaryList(organizeRecommendations.map((item) => `${item.label} (${item.matchCount})`), 3)}`]
      : []),
    `Organize state file: ${cronOrganizeStatePath}`,
  ]);
  const cronWarnings: string[] = [];
  if (existingJobs.length > 0 && !cronEnabledBefore) {
    cronWarnings.push("Cron jobs exist but cron runtime is disabled.");
  }
  if (invalidNextRunCount > 0) {
    cronWarnings.push(`${invalidNextRunCount} enabled cron job(s) currently have no computed next run.`);
  }
  const nextRunCandidates = existingJobs
    .filter((job) => job.enabled && typeof job.state.nextRunAtMs === "number")
    .map((job) => ({ name: job.name, nextRunAtMs: job.state.nextRunAtMs as number }))
    .sort((left, right) => left.nextRunAtMs - right.nextRunAtMs);
  if (nextRunCandidates.length > 0) {
    cronWarnings.push(`Earliest next run: ${nextRunCandidates[0]!.name} @ ${toConfigSummaryTimestamp(nextRunCandidates[0]!.nextRunAtMs)}`);
  }
  const lastFailedJobs = existingJobs
    .filter((job) => job.state.lastStatus === "error" || Boolean(job.state.lastError?.trim()))
    .slice(0, 3)
    .map((job) => `${job.name}: ${truncateForSummary(job.state.lastError ?? job.state.lastStatus ?? "error")}`);
  if (lastFailedJobs.length > 0) {
    cronWarnings.push(`Recent failures: ${lastFailedJobs.join(" | ")}`);
  }
  const deliveryUserCount = existingJobs.filter((job) => job.delivery.mode === "user").length;
  const failureUserCount = existingJobs.filter((job) => (job.failureDestination?.mode ?? "none") === "user").length;
  if (existingJobs.length > 0) {
    cronWarnings.push(`Delivery summary: success->user ${deliveryUserCount}, failure->user ${failureUserCount}`);
  }
  const retainedOneShotJobs = existingJobs
    .filter((job) => job.enabled && job.schedule.kind === "at" && job.deleteAfterRun !== true)
    .map((job) => job.name);
  if (retainedOneShotJobs.length > 0) {
    cronWarnings.push(`One-shot jobs kept after run: ${formatSummaryList(retainedOneShotJobs)}. They will be disabled instead of removed.`);
  }
  const silentJobs = existingJobs
    .filter((job) => job.enabled && job.delivery.mode === "none" && (job.failureDestination?.mode ?? "none") === "none")
    .map((job) => job.name);
  if (silentJobs.length > 0) {
    cronWarnings.push(`Silent jobs: ${formatSummaryList(silentJobs)}. Success and failure will stay in cron state/logs only.`);
  }
  const silentGoalApprovalJobs = existingJobs
    .filter((job) => job.enabled && job.payload.kind === "goalApprovalScan" && (job.failureDestination?.mode ?? "none") === "none")
    .map((job) => job.name);
  if (silentGoalApprovalJobs.length > 0) {
    cronWarnings.push(`Goal approval scan jobs without failure delivery: ${formatSummaryList(silentGoalApprovalJobs)}.`);
  }
  if (heartbeatEnabledBefore && !heartbeatActiveHoursBefore.trim()) {
    cronWarnings.push("Heartbeat active hours are empty, so heartbeat can run all day.");
  }
  if (cronWarnings.length > 0) {
    p.note(cronWarnings.join("\n"), "Automation diagnostics");
  }
  if (organizeRecommendations.length > 0) {
    p.note(
      organizeRecommendations
        .slice(0, 3)
        .map((item) => `${item.label}: ${item.matchCount} match(es), action=${formatCronOrganizeActionLabel(item.action)}, runtime=${item.historySummary}, examples=${item.sampleSummary} (${item.description})`)
        .join("\n"),
      "Cron organize suggestions",
    );
  }

  const shouldConfigure = resolvePromptValue(await p.confirm({
    message: "Configure automation switches now?",
    initialValue: existingJobs.length > 0 || !cronEnabledBefore || !heartbeatEnabledBefore || envValues.has("BELLDANDY_HEARTBEAT_INTERVAL") || envValues.has("BELLDANDY_HEARTBEAT_ACTIVE_HOURS"),
    active: "Yes",
    inactive: "Skip",
  }));
  if (!shouldConfigure) {
    return notes;
  }

  const cronEnabled = resolvePromptValue(await p.confirm({
    message: "Enable cron runtime?",
    initialValue: parseBooleanEnv(envValues.get("BELLDANDY_CRON_ENABLED"), true),
    active: "Enable",
    inactive: "Disable",
  }));
  const heartbeatEnabled = resolvePromptValue(await p.confirm({
    message: "Enable heartbeat runtime?",
    initialValue: parseBooleanEnv(envValues.get("BELLDANDY_HEARTBEAT_ENABLED"), true),
    active: "Enable",
    inactive: "Disable",
  }));
  let heartbeatInterval = envValues.get("BELLDANDY_HEARTBEAT_INTERVAL") ?? "30m";
  let heartbeatActiveHours = envValues.get("BELLDANDY_HEARTBEAT_ACTIVE_HOURS") ?? "";
  if (heartbeatEnabled) {
    heartbeatInterval = resolvePromptValue(await p.text({
      message: "Heartbeat interval",
      defaultValue: heartbeatInterval,
      validate: (value) => validateHeartbeatInterval(value),
    }));
    heartbeatActiveHours = resolvePromptValue(await p.text({
      message: "Heartbeat active hours (optional)",
      defaultValue: heartbeatActiveHours,
      placeholder: "08:00-23:00",
      validate: (value) => validateOptionalActiveHours(value, "Heartbeat active hours"),
    }));
  }

  updateEnvValue(options.envPath, "BELLDANDY_CRON_ENABLED", cronEnabled ? "true" : "false");
  updateEnvValue(options.envPath, "BELLDANDY_HEARTBEAT_ENABLED", heartbeatEnabled ? "true" : "false");
  if (heartbeatEnabled) {
    updateEnvValue(options.envPath, "BELLDANDY_HEARTBEAT_INTERVAL", heartbeatInterval);
    if (heartbeatActiveHours.trim()) {
      updateEnvValue(options.envPath, "BELLDANDY_HEARTBEAT_ACTIVE_HOURS", heartbeatActiveHours.trim());
    } else {
      removeEnvValue(options.envPath, "BELLDANDY_HEARTBEAT_ACTIVE_HOURS");
    }
  } else {
    removeEnvValue(options.envPath, "BELLDANDY_HEARTBEAT_INTERVAL");
    removeEnvValue(options.envPath, "BELLDANDY_HEARTBEAT_ACTIVE_HOURS");
  }

  notes.push(`Automation switches updated (.env.local); cron=${cronEnabled ? "enabled" : "disabled"}, heartbeat=${heartbeatEnabled ? `${heartbeatInterval}${heartbeatActiveHours.trim() ? `, active=${heartbeatActiveHours.trim()}` : ""}` : "disabled"}`);
  notes.push(`Cron jobs live in ${cronJobsPath}`);

  const jobAction = existingJobs.length > 0
    ? resolvePromptValue(await p.select<"upsert" | "remove" | "organize" | "run_now" | "recovery_run" | "recovery_replay" | "recovery_hint" | "skip">({
      message: "Cron job action",
      options: [
        { value: "upsert", label: "Add or update one job", hint: `${existingJobs.length} existing` },
        { value: "remove", label: "Remove one job" },
        { value: "organize", label: "Organize cron jobs", hint: "Batch enable, disable, or remove" },
        { value: "run_now", label: "Queue one job to run now", hint: "Mark it due for the next scheduler tick" },
        { value: "recovery_run", label: "Run one recovery action", hint: "Retry the latest failed background run for one job" },
        { value: "recovery_replay", label: "Replay recovery result", hint: "Show the latest failure and recovery result summary" },
        { value: "recovery_hint", label: "Inspect recovery hint", hint: "Show targeted failure / skipped guidance" },
        { value: "skip", label: "Skip job changes" },
      ],
      initialValue: "upsert",
    }))
    : resolvePromptValue(await p.confirm({
      message: "Add one cron job now?",
      initialValue: false,
      active: "Add",
      inactive: "Skip",
    })) ? "upsert" : "skip";

  if (jobAction === "remove") {
    const jobId = resolvePromptValue(await p.select<string>({
      message: "Choose cron job to remove",
      options: existingJobs.map((job) => ({
        value: job.id,
        label: job.name,
        hint: formatCronScheduleSummary(job.schedule),
      })),
      initialValue: existingJobs[0]?.id,
    }));
    const targetJob = existingJobs.find((job) => job.id === jobId);
    const confirmed = resolvePromptValue(await p.confirm({
      message: `Remove cron job "${targetJob?.name ?? jobId}"?`,
      initialValue: false,
      active: "Remove",
      inactive: "Keep",
    }));
    if (confirmed) {
      await cronStore.remove(jobId);
      const nextJobs = await cronStore.list();
      notes.push(`Cron job removed: ${targetJob?.name ?? jobId}`);
      notes.push(`Cron jobs saved: ${cronJobsPath} (${nextJobs.length} total)`);
    }
    return notes;
  }

  if (jobAction === "organize") {
    let organizeState = cronOrganizeState;
    const organizeAction = resolvePromptValue(await p.select<"enable_multiple" | "disable_multiple" | "remove_multiple" | "preset_strategy" | "saved_strategy" | "manage_saved_strategies" | "reuse_preview_result">({
      message: "Organize cron jobs",
      options: [
        { value: "enable_multiple", label: "Enable multiple jobs" },
        { value: "disable_multiple", label: "Disable multiple jobs" },
        { value: "remove_multiple", label: "Remove multiple jobs" },
        { value: "preset_strategy", label: "Apply strategy preset", hint: "Use a recommended batch action + criteria combo" },
        ...(organizeState.customPresets.length > 0
          ? [
            { value: "saved_strategy" as const, label: "Apply saved custom strategy", hint: `${organizeState.customPresets.length} saved` },
            { value: "manage_saved_strategies" as const, label: "Manage saved custom strategies", hint: "Rename, remove, or clear saved presets" },
          ]
          : []),
        ...(organizeState.lastPreview
          ? [{
            value: "reuse_preview_result" as const,
            label: "Reuse last preview result",
            hint: `${formatCronOrganizeActionLabel(organizeState.lastPreview.action)}; ${organizeState.lastPreview.label}`,
          }]
          : []),
      ],
      initialValue: "enable_multiple",
    }));
    let selectedAction: CronOrganizeAction = "enable_multiple";
    let filteredJobs: CronJob[] = [];
    let selectionLabel = "";
    if (organizeAction === "preset_strategy") {
      const presetOptions = listCronOrganizePresets();
      const presetId = resolvePromptValue(await p.select<CronOrganizePresetId>({
        message: "Choose batch strategy preset",
        options: presetOptions.map((preset) => ({
          value: preset.id,
          label: preset.label,
          hint: `${formatCronOrganizeActionLabel(preset.action)}; ${preset.description}`,
        })),
        initialValue: presetOptions[0]?.id,
      }));
      const preset = getCronOrganizePreset(presetId);
      if (!preset) {
        return notes;
      }
      selectedAction = preset.action;
      filteredJobs = filterCronJobsByCriteria(existingJobs, preset.criteria);
      selectionLabel = buildCronOrganizeSelectionLabel({
        title: `Preset ${preset.label}`,
        jobNames: filteredJobs.map((job) => job.name),
      });
      if (filteredJobs.length === 0) {
        p.note(
          `Preset "${preset.label}" matched no cron jobs. Criteria: ${summarizeCronOrganizeCriteria(preset.criteria)}.`,
          "Cron organize preset",
        );
        return notes;
      }
      p.note(
        [
          `Preset: ${preset.label}`,
          `Action: ${formatCronOrganizeActionLabel(preset.action)}`,
          `Criteria: ${summarizeCronOrganizeCriteria(preset.criteria)}`,
          `Matched ${filteredJobs.length} job(s): ${formatSummaryList(filteredJobs.map((job) => job.name), 5)}`,
        ].join("\n"),
        "Cron organize preset",
      );
    } else if (organizeAction === "saved_strategy") {
      const presetId = resolvePromptValue(await p.select<string>({
        message: "Choose saved custom strategy",
        options: organizeState.customPresets.map((preset) => ({
          value: preset.id,
          label: preset.label,
          hint: `${formatCronOrganizeActionLabel(preset.action)}; ${summarizeCronOrganizeCriteria(preset.criteria)}`,
        })),
        initialValue: organizeState.customPresets[0]?.id,
      }));
      const preset = organizeState.customPresets.find((item) => item.id === presetId);
      if (!preset) {
        return notes;
      }
      selectedAction = preset.action;
      filteredJobs = filterCronJobsByCriteria(existingJobs, preset.criteria);
      selectionLabel = buildCronOrganizeSelectionLabel({
        title: `Saved preset ${preset.label}`,
        jobNames: filteredJobs.map((job) => job.name),
      });
      if (filteredJobs.length === 0) {
        p.note(
          `Saved preset "${preset.label}" matched no cron jobs. Criteria: ${summarizeCronOrganizeCriteria(preset.criteria)}.`,
          "Cron saved strategy",
        );
        return notes;
      }
      p.note(
        [
          `Saved preset: ${preset.label}`,
          `Action: ${formatCronOrganizeActionLabel(preset.action)}`,
          `Criteria: ${summarizeCronOrganizeCriteria(preset.criteria)}`,
          `Matched ${filteredJobs.length} job(s): ${formatSummaryList(filteredJobs.map((job) => job.name), 5)}`,
        ].join("\n"),
        "Cron saved strategy",
      );
    } else if (organizeAction === "manage_saved_strategies") {
      const manageAction = resolvePromptValue(await p.select<"rename_one" | "remove_one" | "clear_all">({
        message: "Manage saved custom strategies",
        options: [
          { value: "rename_one", label: "Rename one strategy" },
          { value: "remove_one", label: "Remove one strategy" },
          { value: "clear_all", label: "Clear all saved strategies", hint: `${organizeState.customPresets.length} saved` },
        ],
        initialValue: "rename_one",
      }));
      if (manageAction === "clear_all") {
        const confirmed = resolvePromptValue(await p.confirm({
          message: `Clear all ${organizeState.customPresets.length} saved custom strategy entries?`,
          initialValue: false,
          active: "Clear",
          inactive: "Keep",
        }));
        if (!confirmed) {
          return notes;
        }
        organizeState = clearCronOrganizeCustomPresets(organizeState);
        await saveCronOrganizeState(options.stateDir, organizeState);
        p.note(`Cleared all saved custom strategies from ${cronOrganizeStatePath}.`, "Cron saved strategy");
        notes.push(`Cleared saved cron strategies: ${cronOrganizeStatePath}`);
        return notes;
      }
      const presetId = resolvePromptValue(await p.select<string>({
        message: manageAction === "rename_one" ? "Choose saved strategy to rename" : "Choose saved strategy to remove",
        options: organizeState.customPresets.map((preset) => ({
          value: preset.id,
          label: preset.label,
          hint: `${formatCronOrganizeActionLabel(preset.action)}; ${summarizeCronOrganizeCriteria(preset.criteria)}`,
        })),
        initialValue: organizeState.customPresets[0]?.id,
      }));
      const preset = organizeState.customPresets.find((item) => item.id === presetId);
      if (!preset) {
        return notes;
      }
      if (manageAction === "rename_one") {
        const label = resolvePromptValue(await p.text({
          message: "Saved strategy name",
          defaultValue: preset.label,
          validate: (value) => (!value.trim() ? "Saved strategy name is required" : undefined),
        }));
        organizeState = renameCronOrganizeCustomPreset(organizeState, preset.id, label);
        await saveCronOrganizeState(options.stateDir, organizeState);
        p.note(`Renamed saved strategy "${preset.label}" to "${label.trim()}" in ${cronOrganizeStatePath}.`, "Cron saved strategy");
        notes.push(`Renamed saved cron strategy: ${preset.label} -> ${label.trim()}`);
        return notes;
      }
      const confirmed = resolvePromptValue(await p.confirm({
        message: `Remove saved strategy "${preset.label}"?`,
        initialValue: false,
        active: "Remove",
        inactive: "Keep",
      }));
      if (!confirmed) {
        return notes;
      }
      organizeState = removeCronOrganizeCustomPreset(organizeState, preset.id);
      await saveCronOrganizeState(options.stateDir, organizeState);
      p.note(`Removed saved strategy "${preset.label}" from ${cronOrganizeStatePath}.`, "Cron saved strategy");
      notes.push(`Removed saved cron strategy: ${preset.label}`);
      return notes;
    } else if (organizeAction === "reuse_preview_result") {
      const lastPreview = organizeState.lastPreview;
      filteredJobs = lastPreview
        ? existingJobs.filter((job) => lastPreview.jobIds.includes(job.id))
        : [];
      selectedAction = lastPreview?.action ?? "enable_multiple";
      selectionLabel = lastPreview?.label ?? "Last preview result";
      if (filteredJobs.length === 0) {
        p.note(
          lastPreview
            ? `Last preview result no longer matches available cron jobs: ${lastPreview.label}.`
            : "No reusable preview result is available.",
          "Cron reuse preview",
        );
        return notes;
      }
      p.note(
        [
          `Reusing last preview result: ${selectionLabel}`,
          `Action: ${formatCronOrganizeActionLabel(selectedAction)}`,
          `Matched ${filteredJobs.length} current job(s): ${formatSummaryList(filteredJobs.map((job) => job.name), 5)}`,
        ].join("\n"),
        "Cron reuse preview",
      );
      selectedAction = resolvePromptValue(await p.select<CronOrganizeAction>({
        message: "How should this preview result be orchestrated?",
        options: [
          { value: selectedAction, label: `Keep ${formatCronOrganizeActionLabel(selectedAction)}`, hint: "Reuse the same action from the last preview" },
          ...(["enable_multiple", "disable_multiple", "remove_multiple"] as const)
            .filter((action) => action !== selectedAction)
            .map((action) => ({
              value: action,
              label: action === "enable_multiple"
                ? "Switch to enable"
                : action === "disable_multiple"
                  ? "Switch to disable"
                  : "Switch to remove",
              hint: "Reuse the same matched jobs with a different action",
            })),
        ],
        initialValue: selectedAction,
      }));
    } else {
      selectedAction = organizeAction;
      const selectionMode = resolvePromptValue(await p.select<"simple_filter" | "combined_conditions" | "reuse_last_selection">({
        message: "How should cron jobs be selected?",
        options: [
          { value: "simple_filter", label: "Simple filter", hint: "Pick one common filter first" },
          { value: "combined_conditions", label: "Combined conditions", hint: "Stack multiple conditions before selecting jobs" },
          ...(organizeState.lastSelection
            ? [{ value: "reuse_last_selection" as const, label: "Reuse last selected jobs", hint: organizeState.lastSelection.label }]
            : []),
        ],
        initialValue: "simple_filter",
      }));
      if (selectionMode === "simple_filter") {
        const filterMode = resolvePromptValue(await p.select<CronOrganizeFilterMode>({
          message: "Filter cron jobs before organizing",
          options: [
            { value: "all", label: "All jobs", hint: `${existingJobs.length} total` },
            { value: "enabled", label: "Enabled jobs" },
            { value: "disabled", label: "Disabled jobs" },
            { value: "failed", label: "Recent failures" },
            { value: "skipped", label: "Recent skips" },
            { value: "ok", label: "Recent success" },
            { value: "silent", label: "Silent jobs", hint: "success/failure both stay in cron state only" },
            { value: "goal_approval_scan", label: "Goal approval scan jobs" },
            { value: "system_event", label: "System event jobs" },
            { value: "missing_next_run", label: "Missing next run", hint: "enabled jobs with no computed next run" },
          ],
          initialValue: "all",
        }));
        filteredJobs = filterCronJobsForOrganize(existingJobs, filterMode);
        selectionLabel = buildCronOrganizeSelectionLabel({
          title: `Filter ${formatCronOrganizeFilterLabel(filterMode)}`,
          jobNames: filteredJobs.map((job) => job.name),
        });
        if (filteredJobs.length === 0) {
          p.note(
            `No cron jobs matched filter "${formatCronOrganizeFilterLabel(filterMode)}".`,
            "Cron organize filter",
          );
          return notes;
        }
        if (filterMode !== "all") {
          p.note(
            `Filter "${formatCronOrganizeFilterLabel(filterMode)}" matched ${filteredJobs.length} job(s): ${formatSummaryList(filteredJobs.map((job) => job.name), 5)}`,
            "Cron organize filter",
          );
        }
      } else if (selectionMode === "combined_conditions") {
        const criteria = await promptCronOrganizeCriteria();
        filteredJobs = filterCronJobsByCriteria(existingJobs, criteria);
        selectionLabel = buildCronOrganizeSelectionLabel({
          title: `Conditions ${summarizeCronOrganizeCriteria(criteria)}`,
          jobNames: filteredJobs.map((job) => job.name),
        });
        if (filteredJobs.length === 0) {
          p.note(
            `No cron jobs matched combined conditions: ${summarizeCronOrganizeCriteria(criteria)}.`,
            "Cron organize conditions",
          );
          return notes;
        }
        p.note(
          `Combined conditions "${summarizeCronOrganizeCriteria(criteria)}" matched ${filteredJobs.length} job(s): ${formatSummaryList(filteredJobs.map((job) => job.name), 5)}`,
          "Cron organize conditions",
        );
        const saveAsCustomPreset = resolvePromptValue(await p.confirm({
          message: "Save these combined conditions as a custom strategy?",
          initialValue: false,
          active: "Save",
          inactive: "Skip",
        }));
        if (saveAsCustomPreset) {
          const label = resolvePromptValue(await p.text({
            message: "Custom strategy name",
            defaultValue: `${selectedAction === "remove_multiple" ? "remove" : selectedAction === "enable_multiple" ? "enable" : "disable"} ${criteria.payloadKind === "any" ? "filtered jobs" : criteria.payloadKind}`,
            validate: (value) => (!value.trim() ? "Custom strategy name is required" : undefined),
          }));
          const now = Date.now();
          const presetId = slugifyCronOrganizePresetLabel(label);
          const existingPreset = organizeState.customPresets.find((item) => item.id === presetId);
          const nextPreset: PersistedCronOrganizeCustomPreset = {
            id: presetId,
            label: label.trim(),
            action: selectedAction,
            criteria,
            createdAt: existingPreset?.createdAt ?? now,
            updatedAt: now,
          };
          organizeState = {
            ...organizeState,
            customPresets: [
              ...organizeState.customPresets.filter((item) => item.id !== presetId),
              nextPreset,
            ].sort((left, right) => left.label.localeCompare(right.label)),
          };
          await saveCronOrganizeState(options.stateDir, organizeState);
          p.note(
            `Saved custom strategy "${nextPreset.label}" to ${cronOrganizeStatePath}.`,
            "Cron saved strategy",
          );
        }
      } else {
        const lastSelection = organizeState.lastSelection;
        filteredJobs = lastSelection
          ? existingJobs.filter((job) => lastSelection.jobIds.includes(job.id))
          : [];
        selectionLabel = lastSelection?.label ?? "Last selected jobs";
        if (filteredJobs.length === 0) {
          p.note(
            lastSelection
              ? `Last selected jobs no longer exist in cron-jobs.json: ${lastSelection.label}.`
              : "No reusable last selection is available.",
            "Cron reuse last selection",
          );
          return notes;
        }
        p.note(
          `Reusing last selected jobs (${filteredJobs.length}): ${formatSummaryList(filteredJobs.map((job) => job.name), 5)}`,
          "Cron reuse last selection",
        );
      }
    }
    organizeState = storeCronOrganizeLastPreview(organizeState, {
      label: selectionLabel || buildCronOrganizeSelectionLabel({
        title: "Matched jobs",
        jobNames: filteredJobs.map((job) => job.name),
      }),
      action: selectedAction,
      jobIds: filteredJobs.map((job) => job.id),
    });
    await saveCronOrganizeState(options.stateDir, organizeState);
    p.note(
      buildCronOrganizePreviewLines({
        action: selectedAction,
        selectionLabel: selectionLabel || buildCronOrganizeSelectionLabel({
          title: "Matched jobs",
          jobNames: filteredJobs.map((job) => job.name),
        }),
        jobs: filteredJobs,
      }).join("\n"),
      "Cron organize preview",
    );
    const previewAction = resolvePromptValue(await p.select<"select_subset" | "apply_all_matched" | "save_as_selection" | "dry_run_only">({
      message: "How should the matched cron jobs proceed?",
      options: [
        { value: "select_subset", label: "Review and pick jobs", hint: "Choose the exact jobs to update" },
        { value: "apply_all_matched", label: "Apply to all matched jobs", hint: `${filteredJobs.length} matched` },
        { value: "save_as_selection", label: "Save matched jobs as selection", hint: "Keep this matched set for reuse without applying changes" },
        { value: "dry_run_only", label: "Dry-run only", hint: "Preview only, do not write cron-jobs.json" },
      ],
      initialValue: "select_subset",
    }));
    if (previewAction === "dry_run_only") {
      notes.push(
        `Cron organize dry-run: ${formatCronOrganizeActionLabel(selectedAction)} ${filteredJobs.length} matched job(s)`,
      );
      return notes;
    }
    if (previewAction === "save_as_selection") {
      organizeState = storeCronOrganizeLastSelection(organizeState, {
        label: selectionLabel || buildCronOrganizeSelectionLabel({
          title: "Saved selection",
          jobNames: filteredJobs.map((job) => job.name),
        }),
        jobIds: filteredJobs.map((job) => job.id),
      });
      await saveCronOrganizeState(options.stateDir, organizeState);
      p.note(
        `Saved ${filteredJobs.length} matched job(s) as reusable selection: ${selectionLabel || formatSummaryList(filteredJobs.map((job) => job.name), 5)}.`,
        "Cron saved selection",
      );
      notes.push(`Saved cron selection from preview: ${filteredJobs.length} job(s)`);
      return notes;
    }
    const jobIds = previewAction === "apply_all_matched"
      ? filteredJobs.map((job) => job.id)
      : await promptCronJobIdsToManage(
        filteredJobs,
        selectedAction === "remove_multiple"
          ? "remove"
          : selectedAction === "enable_multiple"
            ? "enable"
            : "disable",
      );
    if (jobIds.length === 0) {
      return notes;
    }
    const confirmed = resolvePromptValue(await p.confirm({
      message: selectedAction === "remove_multiple"
        ? `Remove ${jobIds.length} cron job(s)?`
        : `${selectedAction === "enable_multiple" ? "Enable" : "Disable"} ${jobIds.length} cron job(s)?`,
      initialValue: false,
      active: selectedAction === "remove_multiple" ? "Remove" : "Apply",
      inactive: "Keep",
    }));
    if (!confirmed) {
      return notes;
    }
    organizeState = storeCronOrganizeLastSelection(organizeState, {
      label: selectionLabel || buildCronOrganizeSelectionLabel({
        title: `${selectedAction === "remove_multiple" ? "Removed" : selectedAction === "enable_multiple" ? "Enabled" : "Disabled"} selection`,
        jobNames: filteredJobs.filter((job) => jobIds.includes(job.id)).map((job) => job.name),
      }),
      jobIds: [...jobIds],
    });
    await saveCronOrganizeState(options.stateDir, organizeState);
    if (selectedAction === "remove_multiple") {
      for (const jobId of jobIds) {
        await cronStore.remove(jobId);
      }
    } else {
      for (const jobId of jobIds) {
        const target = existingJobs.find((job) => job.id === jobId);
        if (!target) continue;
        await cronStore.update(jobId, { enabled: selectedAction === "enable_multiple" });
      }
    }
    const nextJobs = await cronStore.list();
    notes.push(
      selectedAction === "remove_multiple"
        ? `Removed ${jobIds.length} cron job(s): ${jobIds.join(", ")}`
        : `${selectedAction === "enable_multiple" ? "Enabled" : "Disabled"} ${jobIds.length} cron job(s): ${jobIds.join(", ")}`,
    );
    notes.push(`Cron jobs saved: ${cronJobsPath} (${nextJobs.length} total)`);
    return notes;
  }

  if (jobAction === "run_now") {
    const runnableJobs = existingJobs.filter((job) => job.enabled);
    if (runnableJobs.length === 0) {
      p.note(
        "No enabled cron jobs are available. Enable or create a job first, then run it.",
        "Cron run now",
      );
      return notes;
    }
    const jobId = resolvePromptValue(await p.select<string>({
      message: "Choose cron job to run now",
      options: runnableJobs.map((job) => ({
        value: job.id,
        label: job.name,
        hint: `${formatCronScheduleSummary(job.schedule)}; next=${toConfigSummaryTimestamp(job.state.nextRunAtMs) ?? "missing"}`,
      })),
      initialValue: runnableJobs[0]?.id,
    }));
    const selectedJob = runnableJobs.find((job) => job.id === jobId);
    const confirmed = resolvePromptValue(await p.confirm({
      message: `Run cron job "${selectedJob?.name ?? jobId}" now?`,
      initialValue: true,
      active: "Run",
      inactive: "Cancel",
    }));
    if (!confirmed) {
      return notes;
    }
    const envValues = getEnvMap(options.envPath);
    const runtime = await checkGatewayRuntimeReachability(envValues);
    const nextJobs = await cronStore.list();
    const targetJob = nextJobs.find((job) => job.id === jobId);
    let runtimeRunFailure: string | undefined;
    if (!targetJob || !targetJob.enabled) {
      p.note(
        `Cron job "${selectedJob?.name ?? jobId}" is no longer enabled, so it could not be run.`,
        "Cron run now",
      );
      return notes;
    }
    if (runtime.reachable) {
      const runtimeRun = await invokeGatewayCronRunNow({
        envValues,
        stateDir: options.stateDir,
        jobId: targetJob.id,
      });
      if (runtimeRun.ok) {
        p.note(
          [
            runtimeRun.payload.status === "ok"
              ? `Executed "${targetJob.name}" immediately via runtime.`
              : runtimeRun.payload.status === "error"
                ? `Runtime execution for "${targetJob.name}" finished with error.`
                : `Runtime execution for "${targetJob.name}" was skipped.`,
            ...(runtimeRun.payload.summary ? [`Summary: ${runtimeRun.payload.summary}`] : []),
            ...(runtimeRun.payload.reason ? [`Reason: ${runtimeRun.payload.reason}`] : []),
            ...(runtimeRun.payload.runId ? [`Run id: ${runtimeRun.payload.runId}`] : []),
            ...(runtimeRun.paired ? ["CLI pairing was auto-approved for this local runtime call."] : []),
            ...buildCronRecoveryHintLines({
              job: targetJob,
              runtimeReachable: runtime.reachable,
              healthUrl: runtime.healthUrl,
              cronEnabled,
              heartbeatActiveHours,
            }).slice(2),
          ].join("\n"),
          "Cron run now",
        );
        notes.push(`Cron job run now executed: ${targetJob.name} (${runtimeRun.payload.status})`);
        return notes;
      }
      runtimeRunFailure = runtimeRun.error;
    }
    targetJob.state.nextRunAtMs = Date.now();
    targetJob.updatedAtMs = Date.now();
    await cronStore.saveJobs(nextJobs);
    p.note(
      [
        runtime.reachable
          ? `Immediate runtime run-now was unavailable, so "${targetJob.name}" was queued for the next scheduler tick (${CRON_RUN_NOW_TICK_HINT}).`
          : `Queued "${targetJob.name}" in cron-jobs.json, but the gateway runtime is not reachable at ${runtime.healthUrl}. It will run after the next successful gateway start.`,
        ...(runtime.reachable ? [`Runtime call failed; fell back to queue mode.${runtimeRunFailure ? ` ${runtimeRunFailure}` : ""}`] : []),
        ...buildCronRecoveryHintLines({
          job: targetJob,
          runtimeReachable: runtime.reachable,
          healthUrl: runtime.healthUrl,
          cronEnabled,
          heartbeatActiveHours,
        }).slice(2),
      ].join("\n"),
      "Cron run now",
    );
    notes.push(`Cron job queued for next run: ${targetJob.name}`);
    notes.push(`Cron jobs saved: ${cronJobsPath} (${nextJobs.length} total)`);
    return notes;
  }

  if (jobAction === "recovery_run") {
    const jobId = resolvePromptValue(await p.select<string>({
      message: "Choose cron job to recover",
      options: existingJobs.map((job) => ({
        value: job.id,
        label: job.name,
        hint: formatCronJobSummary(job),
      })),
      initialValue: existingJobs[0]?.id,
    }));
    const targetJob = existingJobs.find((job) => job.id === jobId);
    if (!targetJob) {
      return notes;
    }
    const confirmed = resolvePromptValue(await p.confirm({
      message: `Run recovery for cron job "${targetJob.name}"?`,
      initialValue: true,
      active: "Recover",
      inactive: "Cancel",
    }));
    if (!confirmed) {
      return notes;
    }
    const runtimeEnvValues = getEnvMap(options.envPath);
    const runtime = await checkGatewayRuntimeReachability(runtimeEnvValues);
    if (!runtime.reachable) {
      p.note(
        [
          `Gateway runtime is not reachable at ${runtime.healthUrl}. Recovery actions need the runtime ledger and executor to be online.`,
          ...buildCronRecoveryHintLines({
            job: targetJob,
            runtimeReachable: runtime.reachable,
            healthUrl: runtime.healthUrl,
            cronEnabled,
            heartbeatActiveHours,
          }).slice(1),
        ].join("\n"),
        "Cron recovery run",
      );
      return notes;
    }
    const recoveryRun = await invokeGatewayCronRecoveryRun({
      envValues: runtimeEnvValues,
      stateDir: options.stateDir,
      jobId: targetJob.id,
    });
    if (!recoveryRun.ok) {
      p.note(
        [
          `Recovery request failed for "${targetJob.name}".`,
          recoveryRun.error,
          ...buildCronRecoveryHintLines({
            job: targetJob,
            runtimeReachable: runtime.reachable,
            healthUrl: runtime.healthUrl,
            cronEnabled,
            heartbeatActiveHours,
          }).slice(1),
        ].join("\n"),
        "Cron recovery run",
      );
      return notes;
    }
    const replay = await invokeGatewayBackgroundContinuationRuntime({
      envValues: runtimeEnvValues,
      stateDir: options.stateDir,
    });
    const replayLines = replay.ok
      ? buildCronRecoveryReplayLines({
        job: targetJob,
        entries: replay.payload.recentEntries.filter((item) => item.kind === "cron" && item.sourceId === targetJob.id),
      })
      : [`Recovery replay was unavailable: ${replay.error}`];
    p.note(
      [
        `Recovery outcome: ${formatCronRecoveryOutcomeLabel(recoveryRun.payload.outcome)}`,
        ...(recoveryRun.payload.sourceRunId ? [`Source run id: ${recoveryRun.payload.sourceRunId}`] : []),
        ...(recoveryRun.payload.recoveryRunId ? [`Recovery run id: ${recoveryRun.payload.recoveryRunId}`] : []),
        ...(recoveryRun.payload.reason ? [`Reason: ${recoveryRun.payload.reason}`] : []),
        ...(recoveryRun.paired ? ["CLI pairing was auto-approved for this local runtime call."] : []),
        "",
        ...replayLines,
      ].join("\n"),
      "Cron recovery run",
    );
    notes.push(`Cron recovery executed: ${targetJob.name} (${recoveryRun.payload.outcome})`);
    return notes;
  }

  if (jobAction === "recovery_replay") {
    const jobId = resolvePromptValue(await p.select<string>({
      message: "Choose cron job to replay",
      options: existingJobs.map((job) => ({
        value: job.id,
        label: job.name,
        hint: formatCronJobSummary(job),
      })),
      initialValue: existingJobs[0]?.id,
    }));
    const targetJob = existingJobs.find((job) => job.id === jobId);
    if (!targetJob) {
      return notes;
    }
    const runtimeEnvValues = getEnvMap(options.envPath);
    const runtime = await checkGatewayRuntimeReachability(runtimeEnvValues);
    if (!runtime.reachable) {
      p.note(
        [
          `Gateway runtime is not reachable at ${runtime.healthUrl}. Recovery replay reads from the live background continuation ledger.`,
          ...buildCronRecoveryHintLines({
            job: targetJob,
            runtimeReachable: runtime.reachable,
            healthUrl: runtime.healthUrl,
            cronEnabled,
            heartbeatActiveHours,
          }).slice(1),
        ].join("\n"),
        "Cron recovery replay",
      );
      return notes;
    }
    const replay = await invokeGatewayBackgroundContinuationRuntime({
      envValues: runtimeEnvValues,
      stateDir: options.stateDir,
    });
    if (!replay.ok) {
      p.note(
        [
          `Recovery replay request failed for "${targetJob.name}".`,
          replay.error,
        ].join("\n"),
        "Cron recovery replay",
      );
      return notes;
    }
    p.note(
      buildCronRecoveryReplayLines({
        job: targetJob,
        entries: replay.payload.recentEntries.filter((item) => item.kind === "cron" && item.sourceId === targetJob.id),
      }).join("\n"),
      "Cron recovery replay",
    );
    return notes;
  }

  if (jobAction === "recovery_hint") {
    const jobId = resolvePromptValue(await p.select<string>({
      message: "Choose cron job to inspect",
      options: existingJobs.map((job) => ({
        value: job.id,
        label: job.name,
        hint: formatCronJobSummary(job),
      })),
      initialValue: existingJobs[0]?.id,
    }));
    const targetJob = existingJobs.find((job) => job.id === jobId);
    if (!targetJob) {
      return notes;
    }
    const runtime = await checkGatewayRuntimeReachability(getEnvMap(options.envPath));
    p.note(
      buildCronRecoveryHintLines({
        job: targetJob,
        runtimeReachable: runtime.reachable,
        healthUrl: runtime.healthUrl,
        cronEnabled,
        heartbeatActiveHours,
      }).join("\n"),
      "Cron recovery hint",
    );
    return notes;
  }

  if (jobAction === "upsert") {
    const selectedJobId = existingJobs.length > 0
      ? resolvePromptValue(await p.select<string>({
        message: "Choose cron job",
        options: [
          { value: "__new__", label: "Create new job", hint: "Keep existing jobs" },
          ...existingJobs.map((job) => ({
            value: job.id,
            label: job.name,
            hint: `${formatCronScheduleSummary(job.schedule)}; ${formatCronPayloadSummary(job.payload)}`,
          })),
        ],
        initialValue: existingJobs[0]?.id ?? "__new__",
      }))
      : "__new__";
    const existingJob = selectedJobId === "__new__"
      ? undefined
      : existingJobs.find((job) => job.id === selectedJobId);
    const name = resolvePromptValue(await p.text({
      message: "Cron job name",
      defaultValue: existingJob?.name ?? `cron-job-${existingJobs.length + 1}`,
      validate: (value) => (!value.trim() ? "Cron job name is required" : undefined),
    }));
    const description = resolvePromptValue(await p.text({
      message: "Description (optional)",
      defaultValue: existingJob?.description ?? "",
    }));
    const enabled = resolvePromptValue(await p.confirm({
      message: "Enable this cron job?",
      initialValue: existingJob?.enabled ?? true,
      active: "Enable",
      inactive: "Disable",
    }));
    const { schedule, deleteAfterRun } = await promptCronSchedule(existingJob?.schedule, existingJob?.deleteAfterRun);
    const payload = await promptCronPayload(existingJob?.payload);
    const sessionTarget: CronSessionTarget = payload.kind === "goalApprovalScan"
      ? "isolated"
      : resolvePromptValue(await p.select<CronSessionTarget>({
        message: "Session target",
        options: [
          { value: "main", label: "main", hint: "Reuse stable cron-main:<jobId> conversation" },
          { value: "isolated", label: "isolated", hint: "Create a fresh conversation for each run" },
        ],
        initialValue: existingJob?.sessionTarget ?? "main",
      }));
    if (payload.kind === "goalApprovalScan") {
      p.note("Goal approval scan jobs currently always use sessionTarget=isolated.", "Cron session target");
    }
    const deliveryMode = resolvePromptValue(await p.select<"user" | "none">({
      message: "Success delivery",
      options: [
        { value: "user", label: "user", hint: "Send success result through the user-facing channel" },
        { value: "none", label: "none", hint: "Do not send a success delivery message" },
      ],
      initialValue: existingJob?.delivery.mode ?? "user",
    }));
    const failureMode = resolvePromptValue(await p.select<"user" | "none">({
      message: "Failure delivery",
      options: [
        { value: "user", label: "user", hint: "Send failures to the user-facing channel" },
        { value: "none", label: "none", hint: "Do not send failure delivery messages" },
      ],
      initialValue: existingJob?.failureDestination?.mode ?? "none",
    }));

    if (existingJob) {
      await cronStore.update(existingJob.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        enabled,
        deleteAfterRun,
        schedule,
        payload,
        sessionTarget,
        delivery: { mode: deliveryMode },
        failureDestination: { mode: failureMode },
      });
      const nextJobs = await cronStore.list();
      notes.push(`Cron job updated: ${name.trim()}`);
      notes.push(`Cron jobs saved: ${cronJobsPath} (${nextJobs.length} total)`);
      return notes;
    }

    await cronStore.add({
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      deleteAfterRun,
      schedule,
      payload,
      sessionTarget,
      delivery: { mode: deliveryMode },
      failureDestination: { mode: failureMode },
    });
    const nextJobs = await cronStore.list();
    notes.push(`Cron job added: ${name.trim()}`);
    notes.push(`Cron jobs saved: ${cronJobsPath} (${nextJobs.length} total)`);
  }

  return notes;
}

export async function runAdvancedModulesWizard(
  options: AdvancedModulesWizardOptions,
): Promise<AdvancedModulesWizardResult> {
  const configuredModules: AdvancedModule[] = [];
  const notes: string[] = [];
  const modules = options.modules ?? ["community", "models", "webhook", "cron"];

  for (const module of modules) {
    let nextNotes: string[] = [];
    if (module === "community") {
      nextNotes = await runCommunityModule(options);
    } else if (module === "models") {
      nextNotes = await runModelsModule(options);
    } else if (module === "webhook") {
      nextNotes = await runWebhookModule(options);
    } else if (module === "cron") {
      nextNotes = await runCronModule(options);
    }

    if (nextNotes.length > 0) {
      configuredModules.push(module);
      notes.push(...nextNotes);
    }
  }

  return {
    configuredModules,
    notes,
  };
}
