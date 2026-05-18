import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { resolveAgentWorkspaceDir, type AgentRegistry, type ConversationStore } from "@belldandy/agent";
import type { Request, Response, Express } from "express";

import type { QueryRuntimeHttpJsonResponse } from "./query-runtime-http.js";
import type { QueryRuntimeTraceStore } from "./query-runtime-trace.js";
import type { RegisterGatewayHttpRoutesContext } from "./server-http-routes.js";
import type { GatewayServerOptions } from "./server.js";
import { BELLDANDY_VERSION } from "./version.generated.js";
import {
  createFixedWindowRateLimiter,
  createWebhookInFlightLimiter,
  WEBHOOK_BODY_READ_DEFAULTS,
  WEBHOOK_IN_FLIGHT_DEFAULTS,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
} from "./webhook/index.js";

const AVATAR_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ALLOWED_MIME_TYPES = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
]);

type AvatarUploadRole = "user" | "agent";
type AvatarUploadFileLike = File;

type GatewayHttpRuntimeContextInput = {
  app: Express;
  stateDir: string;
  log: RegisterGatewayHttpRoutesContext["log"];
  options: Pick<
    GatewayServerOptions,
    | "auth"
    | "webRoot"
    | "stateDir"
    | "agentFactory"
    | "agentRegistry"
    | "webhookConfig"
    | "webhookIdempotency"
    | "onChannelSecurityApprovalRequired"
    | "startupObservability"
  >;
  getGovernanceDetailMode?: () => "compact" | "full";
  setGovernanceDetailMode?: (value: string | undefined) => void;
  getConversationStore: () => ConversationStore;
  getQueryRuntimeTraceStore: () => QueryRuntimeTraceStore;
  writeBinaryFileAtomic: RegisterGatewayHttpRoutesContext["writeBinaryFileAtomic"];
  writeTextFileAtomic: RegisterGatewayHttpRoutesContext["writeTextFileAtomic"];
  emitAutoRunTaskTokenResult: RegisterGatewayHttpRoutesContext["emitAutoRunTaskTokenResult"];
};

type GatewayHttpRuntimeSettings = Pick<
  RegisterGatewayHttpRoutesContext,
  | "communityApiEnabled"
  | "communityApiToken"
  | "getCommunityApiSettings"
  | "webConfig"
  | "getWebConfig"
  | "webhookEnabled"
  | "webhookPreAuthMaxBytes"
  | "webhookPreAuthTimeoutMs"
  | "webhookRateLimitWindowMs"
  | "webhookRateLimitMaxRequests"
  | "webhookMaxInFlightPerKey"
  | "webhookRateLimiter"
  | "webhookInFlightLimiter"
  | "getWebhookRuntimeSettings"
>;

type GatewayWebConfig = NonNullable<RegisterGatewayHttpRoutesContext["webConfig"]>;

export function buildGatewayHttpRoutesContext(
  input: GatewayHttpRuntimeContextInput,
): RegisterGatewayHttpRoutesContext {
  const avatarDir = path.join(input.stateDir, "avatar");
  const runtimeSettings = readGatewayHttpRuntimeSettings(input);

  return {
    app: input.app,
    version: BELLDANDY_VERSION,
    stateDir: input.stateDir,
    avatarDir,
    webRoot: input.options.webRoot,
    generatedDir: input.options.stateDir ? path.join(input.options.stateDir, "generated") : undefined,
    auth: input.options.auth,
    agentFactory: input.options.agentFactory,
    agentRegistry: input.options.agentRegistry,
    webhookConfig: input.options.webhookConfig,
    webhookIdempotency: input.options.webhookIdempotency,
    onChannelSecurityApprovalRequired: input.options.onChannelSecurityApprovalRequired,
    startupObservability: input.options.startupObservability,
    ...runtimeSettings,
    log: input.log,
    getConversationStore: input.getConversationStore,
    getQueryRuntimeTraceStore: input.getQueryRuntimeTraceStore,
    requestToFormData,
    isAuthorizedAvatarUpload,
    normalizeAvatarUploadRole,
    isAvatarUploadFileLike,
    resolveAvatarUploadExtension,
    resolveAgentIdentityDir: (rootDir, agentRegistry, requestedAgentId) => {
      const resolved = resolveAgentIdentityDir(rootDir, agentRegistry, requestedAgentId);
      return resolved
        ? { dir: resolved.dir, agentId: resolved.profileId }
        : null;
    },
    replaceAvatarMarkdown,
    writeBinaryFileAtomic: input.writeBinaryFileAtomic,
    writeTextFileAtomic: input.writeTextFileAtomic,
    sendHttpJson,
    resolveWebhookRequestGuardKey,
    emitAutoRunTaskTokenResult: input.emitAutoRunTaskTokenResult,
    avatarUploadMaxBytes: AVATAR_UPLOAD_MAX_BYTES,
  };
}

function readGatewayHttpRuntimeSettings(
  input: Pick<GatewayHttpRuntimeContextInput, "options" | "getGovernanceDetailMode">,
): GatewayHttpRuntimeSettings {
  const governanceDetailMode = input.getGovernanceDetailMode?.() ?? readGovernanceDetailModeEnv();
  const experienceDraftGenerateNoticeEnabled = readExperienceDraftGenerateNoticeEnabledEnv();
  const staticWebConfig = readStaticWebConfigFile(input.options.webRoot);
  const communityApiSettings = readCommunityApiRuntimeSettings(input.options.auth);
  const limiterCache = createWebhookRuntimeLimiterCache();
  const webhookRuntimeSettings = readWebhookRuntimeSettings(input.options.webhookConfig, limiterCache);

  return {
    communityApiEnabled: communityApiSettings.enabled,
    communityApiToken: communityApiSettings.token,
    getCommunityApiSettings: () => readCommunityApiRuntimeSettings(input.options.auth),
    webConfig: {
      governanceDetailMode,
      experienceDraftGenerateNoticeEnabled,
      ...staticWebConfig,
    },
    getWebConfig: () => ({
      governanceDetailMode: input.getGovernanceDetailMode?.() ?? readGovernanceDetailModeEnv(),
      experienceDraftGenerateNoticeEnabled: readExperienceDraftGenerateNoticeEnabledEnv(),
      ...readStaticWebConfigFile(input.options.webRoot),
    }),
    webhookEnabled: webhookRuntimeSettings.enabled,
    webhookPreAuthMaxBytes: webhookRuntimeSettings.preAuthMaxBytes,
    webhookPreAuthTimeoutMs: webhookRuntimeSettings.preAuthTimeoutMs,
    webhookRateLimitWindowMs: webhookRuntimeSettings.rateLimitWindowMs,
    webhookRateLimitMaxRequests: webhookRuntimeSettings.rateLimitMaxRequests,
    webhookMaxInFlightPerKey: webhookRuntimeSettings.maxInFlightPerKey,
    webhookRateLimiter: webhookRuntimeSettings.rateLimiter,
    webhookInFlightLimiter: webhookRuntimeSettings.inFlightLimiter,
    getWebhookRuntimeSettings: () => readWebhookRuntimeSettings(input.options.webhookConfig, limiterCache),
  };
}

function readStaticWebConfigFile(webRoot: string): Pick<
  GatewayWebConfig,
  "recommendApiUrl" | "aliyunOneKeyUrl" | "officialHomeUrl" | "workshopUrl"
> {
  const configPath = path.join(webRoot, "config.js");
  const emptyConfig = {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const match = raw.match(/window\.BELLDANDY_WEB_CONFIG\s*=\s*(\{[\s\S]*?\});?/);
    if (!match?.[1]) {
      return emptyConfig;
    }
    const normalized = match[1]
      .replace(/^\uFEFF/, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .trim();
    const parsed = Function(`"use strict"; return (${normalized});`)();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyConfig;
    }
    return {
      recommendApiUrl: typeof parsed.recommendApiUrl === "string" ? parsed.recommendApiUrl : undefined,
      aliyunOneKeyUrl: typeof parsed.aliyunOneKeyUrl === "string" ? parsed.aliyunOneKeyUrl : undefined,
      officialHomeUrl: typeof parsed.officialHomeUrl === "string" ? parsed.officialHomeUrl : undefined,
      workshopUrl: typeof parsed.workshopUrl === "string" ? parsed.workshopUrl : undefined,
    };
  } catch {
    return emptyConfig;
  }
}

function readCommunityApiRuntimeSettings(
  auth: GatewayServerOptions["auth"],
): { enabled: boolean; token?: string } {
  return {
    enabled: String(process.env.BELLDANDY_COMMUNITY_API_ENABLED ?? "false").toLowerCase() === "true",
    token:
      process.env.BELLDANDY_COMMUNITY_API_TOKEN
      ?? process.env.BELLDANDY_AUTH_TOKEN
      ?? (auth.mode === "token" ? auth.token : undefined),
  };
}

type WebhookRuntimeSettingsSnapshot = {
  enabled: boolean;
  preAuthMaxBytes: number;
  preAuthTimeoutMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  rateLimitMaxTrackedKeys: number;
  maxInFlightPerKey: number;
  maxInFlightTrackedKeys: number;
  rateLimiter: ReturnType<typeof createFixedWindowRateLimiter>;
  inFlightLimiter: ReturnType<typeof createWebhookInFlightLimiter>;
};

function createWebhookRuntimeLimiterCache() {
  let rateLimitSignature = "";
  let inFlightSignature = "";
  let rateLimiter = createFixedWindowRateLimiter();
  let inFlightLimiter = createWebhookInFlightLimiter();

  return {
    resolveRateLimiter(windowMs: number, maxRequests: number, maxTrackedKeys: number) {
      const nextSignature = `${windowMs}:${maxRequests}:${maxTrackedKeys}`;
      if (nextSignature !== rateLimitSignature) {
        rateLimitSignature = nextSignature;
        rateLimiter = createFixedWindowRateLimiter({ windowMs, maxRequests, maxTrackedKeys });
      }
      return rateLimiter;
    },
    resolveInFlightLimiter(maxInFlightPerKey: number, maxTrackedKeys: number) {
      const nextSignature = `${maxInFlightPerKey}:${maxTrackedKeys}`;
      if (nextSignature !== inFlightSignature) {
        inFlightSignature = nextSignature;
        inFlightLimiter = createWebhookInFlightLimiter({ maxInFlightPerKey, maxTrackedKeys });
      }
      return inFlightLimiter;
    },
  };
}

function readWebhookRuntimeSettings(
  webhookConfig: GatewayServerOptions["webhookConfig"] | undefined,
  limiterCache: ReturnType<typeof createWebhookRuntimeLimiterCache>,
): WebhookRuntimeSettingsSnapshot {
  const preAuthMaxBytes = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES",
    WEBHOOK_BODY_READ_DEFAULTS.preAuth.maxBytes,
  );
  const preAuthTimeoutMs = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS",
    WEBHOOK_BODY_READ_DEFAULTS.preAuth.timeoutMs,
  );
  const rateLimitWindowMs = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS",
    WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
  );
  const rateLimitMaxRequests = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS",
    WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests,
  );
  const rateLimitMaxTrackedKeys = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS",
    WEBHOOK_RATE_LIMIT_DEFAULTS.maxTrackedKeys,
  );
  const maxInFlightPerKey = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY",
    WEBHOOK_IN_FLIGHT_DEFAULTS.maxInFlightPerKey,
  );
  const maxInFlightTrackedKeys = parsePositiveIntEnv(
    "BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS",
    WEBHOOK_IN_FLIGHT_DEFAULTS.maxTrackedKeys,
  );

  return {
    enabled: Boolean(webhookConfig && webhookConfig.webhooks.length > 0),
    preAuthMaxBytes,
    preAuthTimeoutMs,
    rateLimitWindowMs,
    rateLimitMaxRequests,
    rateLimitMaxTrackedKeys,
    maxInFlightPerKey,
    maxInFlightTrackedKeys,
    rateLimiter: limiterCache.resolveRateLimiter(
      rateLimitWindowMs,
      rateLimitMaxRequests,
      rateLimitMaxTrackedKeys,
    ),
    inFlightLimiter: limiterCache.resolveInFlightLimiter(
      maxInFlightPerKey,
      maxInFlightTrackedKeys,
    ),
  };
}

function readGovernanceDetailModeEnv(): GatewayWebConfig["governanceDetailMode"] {
  const normalized = String(process.env.BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "full") return "full";
  return "compact";
}

function readExperienceDraftGenerateNoticeEnabledEnv(): boolean {
  const normalized = String(process.env.BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return false;
  }
  return true;
}

function parsePositiveIntEnv(varName: string, fallback: number): number {
  const raw = process.env[varName];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveWebhookRequestGuardKey(req: Request, webhookId: string): string {
  const remoteAddress = req.socket.remoteAddress?.trim() || "unknown";
  return `${webhookId}:${remoteAddress}`;
}

function normalizeAvatarUploadRole(value: unknown): AvatarUploadRole | null {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (role === "user" || role === "agent") {
    return role;
  }
  return null;
}

function isAvatarUploadFileLike(value: FormDataEntryValue | null): value is AvatarUploadFileLike {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as AvatarUploadFileLike).arrayBuffer === "function"
    && typeof (value as AvatarUploadFileLike).size === "number"
    && typeof (value as AvatarUploadFileLike).type === "string"
    && typeof (value as AvatarUploadFileLike).name === "string";
}

function resolveAvatarUploadExtension(file: AvatarUploadFileLike): string | null {
  const mimeType = file.type.trim().toLowerCase();
  if (AVATAR_ALLOWED_MIME_TYPES.has(mimeType)) {
    return AVATAR_ALLOWED_MIME_TYPES.get(mimeType) ?? null;
  }

  const ext = path.extname(file.name).toLowerCase();
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp") {
    if (ext === ".jpeg") return ".jpg";
    return ext;
  }

  return null;
}

function replaceAvatarMarkdown(content: string, avatarPath: string): string {
  const avatarLinePattern = /^(\s*[-*]?\s*\*\*头像[：:]\*\*\s*)(.*)$/m;
  if (avatarLinePattern.test(content)) {
    return content.replace(avatarLinePattern, `$1${avatarPath}`);
  }

  const emojiLinePattern = /^(\s*[-*]?\s*\*\*Emoji[：:]\*\*\s*.*)$/m;
  const avatarLine = `- **头像：** ${avatarPath}`;
  if (!content.trim()) {
    return `${avatarLine}\n`;
  }
  if (emojiLinePattern.test(content)) {
    return content.replace(emojiLinePattern, `$1\n${avatarLine}`);
  }

  const nameLinePattern = /^(\s*[-*]?\s*\*\*名字[：:]\*\*\s*.*)$/m;
  if (nameLinePattern.test(content)) {
    return content.replace(nameLinePattern, `$1\n${avatarLine}`);
  }

  return `${content.trimEnd()}\n\n${avatarLine}\n`;
}

function resolveAgentIdentityDir(
  rootDir: string,
  agentRegistry: AgentRegistry | undefined,
  agentId: string | undefined,
): { dir: string; profileId: string } | null {
  const resolvedAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
  if (resolvedAgentId === "default") {
    return { dir: rootDir, profileId: "default" };
  }

  const profile = agentRegistry?.getProfile(resolvedAgentId);
  if (!profile) return null;

  const workspaceDir = resolveAgentWorkspaceDir(profile);
  return {
    dir: path.join(rootDir, "agents", workspaceDir),
    profileId: profile.id,
  };
}

function readHeaderValue(headers: Request["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  return undefined;
}

function isAuthorizedAvatarUpload(req: Request, auth: GatewayServerOptions["auth"]): boolean {
  if (auth.mode === "none") {
    return true;
  }

  if (auth.mode === "token") {
    const bearer = readHeaderValue(req.headers, "authorization");
    const token = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : "";
    return Boolean(auth.token?.trim()) && token === auth.token?.trim();
  }

  const password = readHeaderValue(req.headers, "x-belldandy-password");
  return Boolean(auth.password?.trim()) && password === auth.password?.trim();
}

async function requestToFormData(req: Request): Promise<FormData> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "undefined") continue;
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else {
      headers.set(name, value);
    }
  }

  const url = `http://127.0.0.1${req.url ?? "/"}`;
  const request = new Request(url, {
    method: req.method ?? "POST",
    headers,
    body: Readable.toWeb(req) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  return request.formData();
}

function sendHttpJson(
  res: Response,
  response: QueryRuntimeHttpJsonResponse,
) {
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    res.setHeader(key, value);
  }
  return res.status(response.status).json(response.body);
}
