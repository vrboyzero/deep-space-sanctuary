import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import express, { type Express, type Request, type Response } from "express";
import type { BelldandyAgent, AgentRegistry, ConversationStore } from "@belldandy/agent";
import { DEFAULT_STATE_DIR_DISPLAY } from "@belldandy/protocol";

import type { BelldandyLogger } from "./logger/index.js";
import type { QueryRuntimeTraceStore } from "./query-runtime-trace.js";
import type { TopLevelConversationLifecycle } from "./top-level-conversation-lifecycle.js";
import {
  handleCommunityMessageWithQueryRuntime,
  handleWebhookReceiveWithQueryRuntime,
  type QueryRuntimeHttpJsonResponse,
} from "./query-runtime-http.js";
import {
  beginWebhookRequestPipelineOrReject,
  type FixedWindowRateLimiter,
  type WebhookInFlightLimiter,
} from "./webhook/index.js";
import type { GatewayServerOptions } from "./server.js";

const WEBCHAT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "media-src 'self' https:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
].join("; ");

export type RegisterGatewayHttpRoutesContext = {
  app: Express;
  version: string;
  stateDir: string;
  avatarDir: string;
  webRoot: string;
  generatedDir?: string;
  webConfig?: {
    governanceDetailMode?: "compact" | "full";
    experienceDraftGenerateNoticeEnabled?: boolean;
    recommendApiUrl?: string;
    aliyunOneKeyUrl?: string;
    officialHomeUrl?: string;
    workshopUrl?: string;
  };
  getWebConfig?: () => {
    governanceDetailMode?: "compact" | "full";
    experienceDraftGenerateNoticeEnabled?: boolean;
    recommendApiUrl?: string;
    aliyunOneKeyUrl?: string;
    officialHomeUrl?: string;
    workshopUrl?: string;
  };
  getCommunityApiSettings?: () => {
    enabled: boolean;
    token?: string;
  };
  startupObservability?: GatewayServerOptions["startupObservability"];
  auth: GatewayServerOptions["auth"];
  agentFactory?: () => BelldandyAgent;
  agentRegistry?: AgentRegistry;
  webhookConfig?: GatewayServerOptions["webhookConfig"];
  webhookIdempotency?: GatewayServerOptions["webhookIdempotency"];
  onChannelSecurityApprovalRequired?: GatewayServerOptions["onChannelSecurityApprovalRequired"];
  communityApiEnabled: boolean;
  communityApiToken?: string;
  webhookEnabled: boolean;
  webhookPreAuthMaxBytes: number;
  webhookPreAuthTimeoutMs: number;
  webhookRateLimitWindowMs: number;
  webhookRateLimitMaxRequests: number;
  webhookMaxInFlightPerKey: number;
  webhookRateLimiter: FixedWindowRateLimiter;
  webhookInFlightLimiter: WebhookInFlightLimiter;
  getWebhookRuntimeSettings?: () => {
    enabled: boolean;
    preAuthMaxBytes: number;
    preAuthTimeoutMs: number;
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    rateLimitMaxTrackedKeys: number;
    maxInFlightPerKey: number;
    maxInFlightTrackedKeys: number;
    rateLimiter: FixedWindowRateLimiter;
    inFlightLimiter: WebhookInFlightLimiter;
  };
  log: {
    info: (scope: string, message: string, meta?: unknown) => void;
    error: (scope: string, message: string, meta?: unknown) => void;
  } | BelldandyLogger;
  getConversationStore: () => ConversationStore;
  getTopLevelConversationLifecycle: () => TopLevelConversationLifecycle;
  getQueryRuntimeTraceStore: () => QueryRuntimeTraceStore;
  requestToFormData: (req: Request) => Promise<FormData>;
  isAuthorizedAvatarUpload: (req: Request, auth: GatewayServerOptions["auth"]) => boolean;
  normalizeAvatarUploadRole: (value: FormDataEntryValue | null) => "user" | "agent" | null;
  isAvatarUploadFileLike: (value: FormDataEntryValue | null) => value is File;
  resolveAvatarUploadExtension: (file: File) => string | null;
  resolveAgentIdentityDir: (
    stateDir: string,
    agentRegistry: AgentRegistry | undefined,
    requestedAgentId: string,
  ) => { dir: string; agentId: string } | null;
  replaceAvatarMarkdown: (markdown: string, avatarPath: string) => string;
  writeBinaryFileAtomic: (
    filePath: string,
    content: Buffer,
    options?: { ensureParent?: boolean; mode?: number },
  ) => Promise<void>;
  writeTextFileAtomic: (
    filePath: string,
    content: string,
    options?: { ensureParent?: boolean; mode?: number },
  ) => Promise<void>;
  sendHttpJson: (res: Response, response: QueryRuntimeHttpJsonResponse) => void;
  resolveWebhookRequestGuardKey: (req: Request, webhookId: string) => string;
  emitAutoRunTaskTokenResult: (store: ConversationStore, payload: {
    conversationId: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    inputCostUsd?: number;
    outputCostUsd?: number;
    totalCostUsd?: number;
  }) => void;
  avatarUploadMaxBytes: number;
};

export async function registerGatewayHttpRoutes(ctx: RegisterGatewayHttpRoutesContext): Promise<void> {
  const startupStaticPaths = new Set(["/", "/index.html", "/app.js", "/config.js"]);
  let firstStaticWebRequestObserved = false;
  let firstBootstrapAssetRequestObserved = false;
  ctx.app.use((req, _res, next) => {
    if (!firstStaticWebRequestObserved && req.method === "GET" && startupStaticPaths.has(req.path)) {
      firstStaticWebRequestObserved = true;
      ctx.startupObservability?.onFirstStaticWebRequest?.({
        timestampMs: Date.now(),
        method: req.method,
        path: req.path,
        userAgent: req.get("user-agent") ?? null,
        referer: req.get("referer") ?? null,
      });
    }
    if (!firstBootstrapAssetRequestObserved && req.method === "GET" && req.path === "/app.js") {
      firstBootstrapAssetRequestObserved = true;
      ctx.startupObservability?.onFirstBootstrapAssetRequest?.({
        timestampMs: Date.now(),
        method: req.method,
        path: req.path,
        userAgent: req.get("user-agent") ?? null,
        referer: req.get("referer") ?? null,
      });
    }
    next();
  });

  // WebChat 的首屏脚本和第三方资产均为同源文件后，可直接强制 CSP；Trusted Types
  // 仍以专用浏览器 fixture 收敛，不在未迁移的全局 UI 上提前启用。
  ctx.app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", WEBCHAT_CSP);
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()");
    next();
  });

  if (ctx.generatedDir) {
    try {
      await fsp.mkdir(ctx.generatedDir, { recursive: true });
    } catch {
      // ignore
    }
    ctx.app.use("/generated", express.static(ctx.generatedDir));
    ctx.log.info("gateway", `Static: serving /generated -> ${ctx.generatedDir}`);
  }

  ctx.app.use("/avatar", express.static(ctx.avatarDir));
  ctx.log.info("gateway", `Static: serving /avatar -> ${ctx.avatarDir}`);
  ctx.app.get("/config.js", (_req, res) => {
    res.type("application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(buildGatewayWebConfigScript(ctx.getWebConfig?.() ?? ctx.webConfig));
  });
  ctx.app.use(express.static(ctx.webRoot));

  ctx.app.get("/", (_req, res) => {
    res.sendFile(path.join(ctx.webRoot, "index.html"));
  });

  ctx.app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: ctx.version,
    });
  });

  ctx.app.post("/api/avatar/upload", async (req, res) => {
    try {
      if (!ctx.isAuthorizedAvatarUpload(req, ctx.auth)) {
        const challenge = ctx.auth.mode === "token"
          ? { header: "WWW-Authenticate", value: 'Bearer realm="belldandy-upload"' }
          : null;
        if (challenge) {
          res.setHeader(challenge.header, challenge.value);
        }
        return res.status(401).json({
          ok: false,
          error: {
            code: "unauthorized",
            message: ctx.auth.mode === "password"
              ? "Missing or invalid x-belldandy-password header."
              : "Missing or invalid bearer token.",
          },
        });
      }

      const formData = await ctx.requestToFormData(req);
      const role = ctx.normalizeAvatarUploadRole(formData.get("role"));
      const rawAgentId = formData.get("agentId");
      const requestedAgentId = typeof rawAgentId === "string" && rawAgentId.trim()
        ? rawAgentId.trim()
        : undefined;
      if (!role) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_role", message: 'role must be "user" or "agent".' },
        });
      }

      const rawFile = formData.get("file");
      if (!ctx.isAvatarUploadFileLike(rawFile)) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_file", message: "file is required." },
        });
      }
      if (rawFile.size <= 0) {
        return res.status(400).json({
          ok: false,
          error: { code: "missing_file", message: "file is empty." },
        });
      }
      if (rawFile.size > ctx.avatarUploadMaxBytes) {
        return res.status(413).json({
          ok: false,
          error: { code: "file_too_large", message: `file exceeds ${ctx.avatarUploadMaxBytes} bytes.` },
        });
      }

      const ext = ctx.resolveAvatarUploadExtension(rawFile);
      if (!ext) {
        return res.status(400).json({
          ok: false,
          error: { code: "invalid_file_type", message: "Only png, jpg, gif, and webp images are allowed." },
        });
      }

      await fsp.mkdir(ctx.avatarDir, { recursive: true });
      const fileName = `avatar-${role}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
      const avatarPath = `/avatar/${fileName}`;
      const targetFile = path.join(ctx.avatarDir, fileName);
      let mdPath = path.join(ctx.stateDir, role === "user" ? "USER.md" : "IDENTITY.md");
      if (role === "agent" && requestedAgentId) {
        const identityTarget = ctx.resolveAgentIdentityDir(ctx.stateDir, ctx.agentRegistry, requestedAgentId);
        if (!identityTarget) {
          return res.status(404).json({
            ok: false,
            error: { code: "invalid_agent", message: `Agent "${requestedAgentId}" does not exist.` },
          });
        }
        mdPath = path.join(identityTarget.dir, "IDENTITY.md");
      }

      let previousMarkdown = "";
      try {
        previousMarkdown = await fsp.readFile(mdPath, "utf-8");
      } catch (error) {
        const err = error as NodeJS.ErrnoException | undefined;
        if (err?.code === "ENOENT") {
          return res.status(404).json({
            ok: false,
            error: { code: "md_not_found", message: `${path.basename(mdPath)} does not exist.` },
          });
        }
        throw error;
      }

      const fileBuffer = Buffer.from(await rawFile.arrayBuffer());
      await ctx.writeBinaryFileAtomic(targetFile, fileBuffer, { ensureParent: true, mode: 0o600 });

      try {
        const nextMarkdown = ctx.replaceAvatarMarkdown(previousMarkdown, avatarPath);
        await ctx.writeTextFileAtomic(mdPath, nextMarkdown, { ensureParent: true, mode: 0o600 });
      } catch (error) {
        await fsp.unlink(targetFile).catch(() => {});
        return res.status(500).json({
          ok: false,
          error: { code: "md_update_failed", message: error instanceof Error ? error.message : String(error) },
        });
      }

      return res.status(200).json({
        ok: true,
        role,
        agentId: role === "agent" ? requestedAgentId ?? "default" : undefined,
        avatarPath,
        mdPath,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: { code: "write_failed", message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  const communityJsonParser = express.json();
  ctx.app.post("/api/message", communityJsonParser, async (req, res) => {
    const communityApiSettings = ctx.getCommunityApiSettings?.() ?? {
      enabled: ctx.communityApiEnabled,
      token: ctx.communityApiToken,
    };
    if (!communityApiSettings.enabled) {
      res.status(404).json({
        ok: false,
        error: {
          code: "API_DISABLED",
          message: "Community API is disabled. Set BELLDANDY_COMMUNITY_API_ENABLED=true to enable.",
        },
      });
      return;
    }

    const conversationStore = ctx.getConversationStore();
    const queryRuntimeTraceStore = ctx.getQueryRuntimeTraceStore();
    const response = await handleCommunityMessageWithQueryRuntime({
      requestId: `api.message:${crypto.randomUUID()}`,
      authorization: req.headers.authorization,
      communityApiToken: communityApiSettings.token,
      body: req.body,
      stateDir: ctx.stateDir,
      agentFactory: ctx.agentFactory,
      agentRegistry: ctx.agentRegistry,
      conversationStore,
      topLevelConversationLifecycle: ctx.getTopLevelConversationLifecycle(),
      log: ctx.log,
      runtimeObserver: queryRuntimeTraceStore.createObserver<"api.message">(),
      onChannelSecurityApprovalRequired: ctx.onChannelSecurityApprovalRequired,
      emitAutoRunTaskTokenResult: (store, payload) => {
        ctx.emitAutoRunTaskTokenResult(store, payload);
      },
    });
    ctx.sendHttpJson(res, response);
  });

  ctx.app.post("/api/webhook/:id", async (req, res) => {
    const webhookRuntimeSettings = ctx.getWebhookRuntimeSettings?.() ?? {
      enabled: ctx.webhookEnabled,
      preAuthMaxBytes: ctx.webhookPreAuthMaxBytes,
      preAuthTimeoutMs: ctx.webhookPreAuthTimeoutMs,
      rateLimitWindowMs: ctx.webhookRateLimitWindowMs,
      rateLimitMaxRequests: ctx.webhookRateLimitMaxRequests,
      rateLimitMaxTrackedKeys: 0,
      maxInFlightPerKey: ctx.webhookMaxInFlightPerKey,
      maxInFlightTrackedKeys: 0,
      rateLimiter: ctx.webhookRateLimiter,
      inFlightLimiter: ctx.webhookInFlightLimiter,
    };
    if (!webhookRuntimeSettings.enabled) {
      res.status(404).json({
        ok: false,
        error: {
          code: "WEBHOOK_DISABLED",
          message: `Webhook API is disabled. Configure webhooks in ${DEFAULT_STATE_DIR_DISPLAY}/webhooks.json to enable.`,
        },
      });
      return;
    }

    const webhookGuardKey = ctx.resolveWebhookRequestGuardKey(req, req.params.id);
    const pipeline = beginWebhookRequestPipelineOrReject({
      req,
      res,
      rateLimiter: webhookRuntimeSettings.rateLimiter,
      rateLimitKey: webhookGuardKey,
      requireJsonContentType: true,
      inFlightLimiter: webhookRuntimeSettings.inFlightLimiter,
      inFlightKey: webhookGuardKey,
    });
    if (!pipeline.ok) {
      return;
    }

    try {
      const bodyResult = await import("./webhook/index.js").then(({ readJsonWebhookBodyOrReject }) => readJsonWebhookBodyOrReject({
        req,
        res,
        profile: "pre-auth",
        maxBytes: webhookRuntimeSettings.preAuthMaxBytes,
        timeoutMs: webhookRuntimeSettings.preAuthTimeoutMs,
        emptyObjectOnEmpty: true,
        invalidJsonMessage: "Invalid JSON",
      }));
      if (!bodyResult.ok) {
        return;
      }

      const conversationStore = ctx.getConversationStore();
      const queryRuntimeTraceStore = ctx.getQueryRuntimeTraceStore();
      const response = await handleWebhookReceiveWithQueryRuntime({
        requestId: `webhook.receive:${crypto.randomUUID()}`,
        webhookId: req.params.id,
        authorization: req.headers.authorization,
        idempotencyKey: typeof req.headers["x-idempotency-key"] === "string" ? req.headers["x-idempotency-key"] : undefined,
        body: bodyResult.value as any,
        agentFactory: ctx.agentFactory,
        agentRegistry: ctx.agentRegistry,
        webhookConfig: ctx.webhookConfig,
        webhookIdempotency: ctx.webhookIdempotency,
        conversationStore,
        topLevelConversationLifecycle: ctx.getTopLevelConversationLifecycle(),
        log: ctx.log,
        runtimeObserver: queryRuntimeTraceStore.createObserver<"webhook.receive">(),
        emitAutoRunTaskTokenResult: (store, payload) => {
          ctx.emitAutoRunTaskTokenResult(store, payload);
        },
      });
      ctx.sendHttpJson(res, response);
    } finally {
      pipeline.release();
    }
  });

  if (ctx.webhookEnabled || ctx.getWebhookRuntimeSettings) {
    const webhookRuntimeSettings = ctx.getWebhookRuntimeSettings?.() ?? {
      enabled: ctx.webhookEnabled,
      preAuthMaxBytes: ctx.webhookPreAuthMaxBytes,
      preAuthTimeoutMs: ctx.webhookPreAuthTimeoutMs,
      rateLimitWindowMs: ctx.webhookRateLimitWindowMs,
      rateLimitMaxRequests: ctx.webhookRateLimitMaxRequests,
      rateLimitMaxTrackedKeys: 0,
      maxInFlightPerKey: ctx.webhookMaxInFlightPerKey,
      maxInFlightTrackedKeys: 0,
      rateLimiter: ctx.webhookRateLimiter,
      inFlightLimiter: ctx.webhookInFlightLimiter,
    };
    if (webhookRuntimeSettings.enabled) {
    ctx.log.info(
      "webhook",
        `Ingress guard enabled (preAuthMaxBytes=${webhookRuntimeSettings.preAuthMaxBytes}, preAuthTimeoutMs=${webhookRuntimeSettings.preAuthTimeoutMs}, rateLimit=${webhookRuntimeSettings.rateLimitMaxRequests}/${webhookRuntimeSettings.rateLimitWindowMs}ms, maxInFlightPerKey=${webhookRuntimeSettings.maxInFlightPerKey})`,
    );
    }
  }
}

function buildGatewayWebConfigScript(
  webConfig: RegisterGatewayHttpRoutesContext["webConfig"],
): string {
  const configObject = {
    governanceDetailMode: webConfig?.governanceDetailMode === "full" ? "full" : "compact",
    experienceDraftGenerateNoticeEnabled: webConfig?.experienceDraftGenerateNoticeEnabled !== false,
    recommendApiUrl: typeof webConfig?.recommendApiUrl === "string" ? webConfig.recommendApiUrl : undefined,
    aliyunOneKeyUrl: typeof webConfig?.aliyunOneKeyUrl === "string" ? webConfig.aliyunOneKeyUrl : undefined,
    officialHomeUrl: typeof webConfig?.officialHomeUrl === "string" ? webConfig.officialHomeUrl : undefined,
    workshopUrl: typeof webConfig?.workshopUrl === "string" ? webConfig.workshopUrl : undefined,
  };
  const serialized = JSON.stringify(configObject, null, 2);
  return [
    "// Generated at runtime by Gateway.",
    "window.BELLDANDY_WEB_CONFIG = {",
    "  ...(window.BELLDANDY_WEB_CONFIG || {}),",
    `  ...${serialized}`,
    "};",
    "",
  ].join("\n");
}
