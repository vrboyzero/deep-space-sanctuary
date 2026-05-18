import fsp from "node:fs/promises";

import { resolveEnvFilePaths } from "@star-sanctuary/distribution";
import type { GatewayReqFrame, GatewayResFrame } from "@belldandy/protocol";

import { normalizePreferredProviderIds } from "../provider-model-catalog.js";
import {
  getChannelReplyChunkingConfigContent,
  parseChannelReplyChunkingConfigContent,
  writeChannelReplyChunkingConfig,
} from "../channel-reply-chunking-store.js";
import {
  approveChannelSecurityApprovalRequest,
  getChannelSecurityConfigContent,
  parseChannelSecurityConfigContent,
  readChannelSecurityApprovalStore,
  rejectChannelSecurityApprovalRequest,
  writeChannelSecurityConfig,
} from "../channel-security-store.js";
import { areAllConfigKeysHotReload } from "../config-hot-reload.js";
import type { GatewayWebSocketRequestContext } from "../server-websocket-dispatch.js";

type ConfigChannelMethodContext = Pick<
  GatewayWebSocketRequestContext,
  "envDir" | "auth" | "stateDir" | "preferredProviderIds"
> & {
  statIfExists: (targetPath: string) => Promise<{ isFile: () => boolean } | null>;
  readEnvFileIntoConfig: (filePath: string, config: Record<string, string>) => Promise<void>;
  updateEnvFile: (filePath: string, changes: Record<string, string>) => Promise<boolean>;
  onConfigUpdating?: (updates: Record<string, string>) => void;
  onConfigUpdated?: (updates: Record<string, string>) => void;
  writeTextFileAtomic: (
    filePath: string,
    content: string,
    options?: { ensureParent?: boolean; mode?: number },
  ) => Promise<void>;
};

const REDACT_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /(?:^|_)(?:AUTH|API|BOT|UPLOAD)?_?TOKEN$/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /(?:^|_)PASS(?:$|_)/i,
];
const SAFE_UPDATE_KEYS = new Set([
  "BELLDANDY_HOST", "BELLDANDY_PORT", "BELLDANDY_GATEWAY_PORT",
  "BELLDANDY_UPDATE_CHECK", "BELLDANDY_UPDATE_CHECK_TIMEOUT_MS", "BELLDANDY_UPDATE_CHECK_API_URL",
  "BELLDANDY_AUTH_MODE", "BELLDANDY_AUTH_TOKEN", "BELLDANDY_AUTH_PASSWORD",
  "BELLDANDY_ALLOWED_ORIGINS",
  "BELLDANDY_ATTACHMENT_MAX_FILE_BYTES", "BELLDANDY_ATTACHMENT_MAX_TOTAL_BYTES",
  "BELLDANDY_ATTACHMENT_TEXT_CHAR_LIMIT", "BELLDANDY_ATTACHMENT_TEXT_TOTAL_CHAR_LIMIT",
  "BELLDANDY_AUDIO_TRANSCRIPT_APPEND_CHAR_LIMIT",
  "BELLDANDY_OPENAI_BASE_URL", "BELLDANDY_OPENAI_MODEL",
  "BELLDANDY_OPENAI_STREAM", "BELLDANDY_OPENAI_WIRE_API",
  "BELLDANDY_OPENAI_THINKING", "BELLDANDY_OPENAI_REASONING_EFFORT",
  "BELLDANDY_RESPONSES_SANITIZE_TOOL_SCHEMA",
  "BELLDANDY_OPENAI_MAX_RETRIES", "BELLDANDY_OPENAI_RETRY_BACKOFF_MS",
  "BELLDANDY_OPENAI_PROXY_URL",
  "BELLDANDY_PRIMARY_WARMUP_ENABLED", "BELLDANDY_PRIMARY_WARMUP_TIMEOUT_MS",
  "BELLDANDY_PRIMARY_WARMUP_COOLDOWN_MS",
  "BELLDANDY_OPENAI_SYSTEM_PROMPT",
  "BELLDANDY_MODEL_PREFERRED_PROVIDERS",
  "BELLDANDY_ASSISTANT_MODE_ENABLED",
  "BELLDANDY_HEARTBEAT_ENABLED", "BELLDANDY_HEARTBEAT_INTERVAL",
  "BELLDANDY_HEARTBEAT_ACTIVE_HOURS", "BELLDANDY_AGENT_TIMEOUT_MS",
  "BELLDANDY_OPENAI_STREAM", "BELLDANDY_MEMORY_ENABLED",
  "BELLDANDY_AGENT_PROTOCOL",
  "BELLDANDY_VIDEO_FILE_API_URL", "BELLDANDY_VIDEO_FILE_API_KEY",
  "BELLDANDY_EXTRA_WORKSPACE_ROOTS",
  "BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED", "BELLDANDY_TOKEN_USAGE_UPLOAD_URL",
  "BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY", "BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS",
  "BELLDANDY_TOKEN_USAGE_STRICT_UUID",
  "BELLDANDY_AUTO_TASK_TIME_ENABLED", "BELLDANDY_AUTO_TASK_TOKEN_ENABLED",
  "BELLDANDY_OPENAI_API_KEY", "BELLDANDY_AGENT_PROVIDER",
  "BELLDANDY_BROWSER_RELAY_ENABLED", "BELLDANDY_RELAY_PORT",
  "BELLDANDY_BROWSER_ALLOWED_DOMAINS", "BELLDANDY_BROWSER_DENIED_DOMAINS",
  "BELLDANDY_MCP_ENABLED", "BELLDANDY_CRON_ENABLED",
  "BELLDANDY_TOOLS_ENABLED",
  "BELLDANDY_AGENT_BRIDGE_ENABLED",
  "BELLDANDY_TOOL_GROUPS",
  "BELLDANDY_MAX_INPUT_TOKENS", "BELLDANDY_MAX_OUTPUT_TOKENS",
  "BELLDANDY_TOOL_LOOP_ITERATION_BUDGET", "BELLDANDY_TOOL_LOOP_WARNING_FRACTION",
  "BELLDANDY_AGENT_TOOL_CONTROL_MODE",
  "BELLDANDY_AGENT_TOOL_CONTROL_CONFIRM_PASSWORD",
  "BELLDANDY_EXTERNAL_OUTBOUND_REQUIRE_CONFIRMATION",
  "BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE",
  "BELLDANDY_MEMORY_ENABLED",
  "BELLDANDY_EMBEDDING_ENABLED", "BELLDANDY_EMBEDDING_PROVIDER",
  "BELLDANDY_EMBEDDING_OPENAI_API_KEY", "BELLDANDY_EMBEDDING_OPENAI_BASE_URL",
  "BELLDANDY_EMBEDDING_MODEL", "BELLDANDY_LOCAL_EMBEDDING_MODEL",
  "BELLDANDY_EMBEDDING_BATCH_SIZE",
  "BELLDANDY_CONTEXT_INJECTION", "BELLDANDY_CONTEXT_INJECTION_LIMIT",
  "BELLDANDY_CONTEXT_INJECTION_INCLUDE_SESSION", "BELLDANDY_CONTEXT_INJECTION_TASK_LIMIT",
  "BELLDANDY_CONTEXT_INJECTION_ALLOWED_CATEGORIES",
  "BELLDANDY_AUTO_RECALL_ENABLED", "BELLDANDY_AUTO_RECALL_LIMIT",
  "BELLDANDY_AUTO_RECALL_MIN_SCORE", "BELLDANDY_TOOL_RESULT_TRANSCRIPT_CHAR_LIMIT",
  "BELLDANDY_MIND_PROFILE_RUNTIME_ENABLED", "BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINES",
  "BELLDANDY_MIND_PROFILE_RUNTIME_MAX_LINE_LENGTH", "BELLDANDY_MIND_PROFILE_RUNTIME_MAX_CHARS",
  "BELLDANDY_MIND_PROFILE_RUNTIME_MIN_SIGNAL_COUNT",
  "BELLDANDY_MEMORY_SUMMARY_ENABLED", "BELLDANDY_MEMORY_SUMMARY_MODEL",
  "BELLDANDY_MEMORY_SUMMARY_BASE_URL",
  "BELLDANDY_MEMORY_EVOLUTION_ENABLED", "BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES",
  "BELLDANDY_MEMORY_EVOLUTION_MODEL", "BELLDANDY_MEMORY_EVOLUTION_BASE_URL",
  "BELLDANDY_MEMORY_SESSION_DIGEST_MAX_RUNS", "BELLDANDY_MEMORY_SESSION_DIGEST_WINDOW_MS",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_MAX_RUNS", "BELLDANDY_MEMORY_DURABLE_EXTRACTION_WINDOW_MS",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_PENDING_MESSAGES",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_MIN_MESSAGE_DELTA",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_SUCCESS_COOLDOWN_MS",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MS",
  "BELLDANDY_MEMORY_DURABLE_EXTRACTION_FAILURE_BACKOFF_MAX_MS",
  "BELLDANDY_TEAM_SHARED_MEMORY_ENABLED", "BELLDANDY_SHARED_REVIEW_CLAIM_TIMEOUT_MS",
  "BELLDANDY_TASK_MEMORY_ENABLED", "BELLDANDY_TASK_SUMMARY_ENABLED",
  "BELLDANDY_TASK_SUMMARY_MODEL", "BELLDANDY_TASK_SUMMARY_BASE_URL",
  "BELLDANDY_TASK_SUMMARY_MIN_DURATION_MS", "BELLDANDY_TASK_SUMMARY_MIN_TOOL_CALLS",
  "BELLDANDY_TASK_SUMMARY_MIN_TOKEN_TOTAL",
  "BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED", "BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED",
  "BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED",
  "BELLDANDY_METHOD_GENERATION_CONFIRM_REQUIRED", "BELLDANDY_SKILL_GENERATION_CONFIRM_REQUIRED",
  "BELLDANDY_METHOD_PUBLISH_CONFIRM_REQUIRED", "BELLDANDY_SKILL_PUBLISH_CONFIRM_REQUIRED",
  "BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SIMILAR_SOURCES",
  "BELLDANDY_EXPERIENCE_SYNTHESIS_MAX_SOURCE_CONTENT_CHARS",
  "BELLDANDY_EXPERIENCE_SYNTHESIS_TOTAL_SOURCE_CONTENT_CHAR_BUDGET",
  "BELLDANDY_MEMORY_DEEP_RETRIEVAL", "BELLDANDY_EMBEDDING_QUERY_PREFIX",
  "BELLDANDY_EMBEDDING_PASSAGE_PREFIX", "BELLDANDY_RERANKER_MIN_SCORE",
  "BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR", "BELLDANDY_MEMORY_INDEXER_VERBOSE_WATCH",
  "BELLDANDY_TTS_ENABLED", "BELLDANDY_TTS_PROVIDER", "BELLDANDY_TTS_VOICE", "BELLDANDY_TTS_MODEL",
  "BELLDANDY_TTS_OPENAI_API_KEY", "BELLDANDY_TTS_OPENAI_BASE_URL",
  "BELLDANDY_CAMERA_NATIVE_HELPER_COMMAND", "BELLDANDY_CAMERA_NATIVE_HELPER_ARGS_JSON",
  "BELLDANDY_CAMERA_NATIVE_HELPER_ENV_JSON", "BELLDANDY_CAMERA_NATIVE_HELPER_CWD",
  "BELLDANDY_CAMERA_NATIVE_HELPER_STARTUP_TIMEOUT_MS",
  "BELLDANDY_CAMERA_NATIVE_HELPER_REQUEST_TIMEOUT_MS",
  "BELLDANDY_CAMERA_NATIVE_HELPER_IDLE_SHUTDOWN_MS",
  "BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_COMMAND",
  "BELLDANDY_CAMERA_NATIVE_HELPER_POWERSHELL_ARGS_JSON",
  "BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_COMMAND",
  "BELLDANDY_CAMERA_NATIVE_HELPER_FFMPEG_ARGS_JSON",
  "BELLDANDY_DANGEROUS_TOOLS_ENABLED", "BELLDANDY_TOOLS_POLICY_FILE",
  "BELLDANDY_SUB_AGENT_MAX_CONCURRENT", "BELLDANDY_SUB_AGENT_MAX_QUEUE_SIZE",
  "BELLDANDY_SUB_AGENT_TIMEOUT_MS", "BELLDANDY_SUB_AGENT_MAX_DEPTH",
  "BELLDANDY_IMAGE_ENABLED", "BELLDANDY_IMAGE_PROVIDER",
  "BELLDANDY_IMAGE_OPENAI_API_KEY", "BELLDANDY_IMAGE_OPENAI_BASE_URL",
  "BELLDANDY_IMAGE_MODEL", "BELLDANDY_IMAGE_OUTPUT_FORMAT", "BELLDANDY_IMAGE_TIMEOUT_MS",
  "BELLDANDY_IMAGE_UNDERSTAND_ENABLED", "BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT",
  "BELLDANDY_BROWSER_SCREENSHOT_AUTO_UNDERSTAND",
  "BELLDANDY_CAMERA_SNAP_AUTO_UNDERSTAND",
  "BELLDANDY_SCREEN_CAPTURE_AUTO_UNDERSTAND",
  "BELLDANDY_IMAGE_UNDERSTAND_PROVIDER",
  "BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY", "BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL",
  "BELLDANDY_IMAGE_UNDERSTAND_MODEL", "BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS",
  "BELLDANDY_IMAGE_UNDERSTAND_PROMPT", "BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB",
  "BELLDANDY_VIDEO_UNDERSTAND_ENABLED", "BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT",
  "BELLDANDY_VIDEO_UNDERSTAND_PROVIDER",
  "BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY", "BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL",
  "BELLDANDY_VIDEO_UNDERSTAND_MODEL", "BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS",
  "BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT",
  "BELLDANDY_VIDEO_UNDERSTAND_FPS",
  "BELLDANDY_VIDEO_UNDERSTAND_PROMPT", "BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB",
  "BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_MAX_TIMELINE_ITEMS",
  "BELLDANDY_VIDEO_UNDERSTAND_AUTO_ATTACHMENT_SUMMARY_CHAR_LIMIT",
  "BELLDANDY_STT_PROVIDER", "BELLDANDY_STT_MODEL", "BELLDANDY_STT_LANGUAGE",
  "BELLDANDY_STT_OPENAI_API_KEY", "BELLDANDY_STT_OPENAI_BASE_URL",
  "BELLDANDY_STT_GROQ_API_KEY", "BELLDANDY_STT_GROQ_BASE_URL",
  "BELLDANDY_ROOM_INJECT_THRESHOLD", "BELLDANDY_ROOM_MEMBERS_CACHE_TTL",
  "DASHSCOPE_API_KEY",
  "BELLDANDY_COMPACTION_ENABLED", "BELLDANDY_COMPACTION_THRESHOLD",
  "BELLDANDY_COMPACTION_KEEP_RECENT", "BELLDANDY_COMPACTION_TRIGGER_FRACTION",
  "BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD", "BELLDANDY_COMPACTION_WARNING_THRESHOLD",
  "BELLDANDY_COMPACTION_BLOCKING_THRESHOLD", "BELLDANDY_COMPACTION_MAX_CONSECUTIVE_FAILURES",
  "BELLDANDY_COMPACTION_MAX_PTL_RETRIES", "BELLDANDY_COMPACTION_CONTEXT_WINDOW_FRACTION",
  "BELLDANDY_COMPACTION_MODEL_ROUTE", "BELLDANDY_COMPACTION_MODEL",
  "BELLDANDY_DEEPSEEK_ROUTE_POLICY_ENABLED",
  "BELLDANDY_COMPACTION_BASE_URL",
  "BELLDANDY_COMPACTION_API_KEY",
  "BELLDANDY_MEMORY_EVOLUTION_API_KEY",
  "BELLDANDY_MEMORY_SUMMARY_API_KEY",
  "BELLDANDY_TASK_SUMMARY_API_KEY",
  "BELLDANDY_FACET_ANCHOR",
  "BELLDANDY_INJECT_AGENTS", "BELLDANDY_INJECT_SOUL", "BELLDANDY_INJECT_MEMORY",
  "BELLDANDY_INJECT_METHOD_SKILL_LIST",
  "BELLDANDY_MAX_SYSTEM_PROMPT_CHARS", "BELLDANDY_MAX_HISTORY", "BELLDANDY_CONVERSATION_ALLOWED_KINDS",
  "BELLDANDY_PROMPT_FOCUS_ENABLED",
  "BELLDANDY_PROMPT_EXPERIMENT_DISABLE_SECTIONS",
  "BELLDANDY_PROMPT_EXPERIMENT_SECTION_PRIORITY_OVERRIDES",
  "BELLDANDY_PROMPT_EXPERIMENT_DISABLE_TOOL_CONTRACTS",
  "BELLDANDY_PROMPT_SNAPSHOT_MAX_RUNS", "BELLDANDY_PROMPT_SNAPSHOT_MAX_PERSISTED_RUNS",
  "BELLDANDY_PROMPT_SNAPSHOT_EMAIL_THREAD_MAX_RUNS", "BELLDANDY_PROMPT_SNAPSHOT_HEARTBEAT_MAX_RUNS",
  "BELLDANDY_PROMPT_SNAPSHOT_RETENTION_DAYS",
  "BELLDANDY_TASK_DEDUP_GUARD_ENABLED", "BELLDANDY_TASK_DEDUP_WINDOW_MINUTES",
  "BELLDANDY_TASK_DEDUP_MODE", "BELLDANDY_TASK_DEDUP_POLICY",
  "BELLDANDY_COMMUNITY_API_ENABLED", "BELLDANDY_COMMUNITY_API_TOKEN",
  "BELLDANDY_EMAIL_OUTBOUND_REQUIRE_CONFIRMATION", "BELLDANDY_EMAIL_DEFAULT_PROVIDER",
  "BELLDANDY_EMAIL_SMTP_ENABLED", "BELLDANDY_EMAIL_SMTP_ACCOUNT_ID", "BELLDANDY_EMAIL_SMTP_HOST",
  "BELLDANDY_EMAIL_SMTP_PORT", "BELLDANDY_EMAIL_SMTP_SECURE", "BELLDANDY_EMAIL_SMTP_USER",
  "BELLDANDY_EMAIL_SMTP_PASS", "BELLDANDY_EMAIL_SMTP_FROM_ADDRESS", "BELLDANDY_EMAIL_SMTP_FROM_NAME",
  "BELLDANDY_EMAIL_INBOUND_AGENT_ID",
  "BELLDANDY_EMAIL_IMAP_ENABLED", "BELLDANDY_EMAIL_IMAP_ACCOUNT_ID", "BELLDANDY_EMAIL_IMAP_HOST",
  "BELLDANDY_EMAIL_IMAP_PORT", "BELLDANDY_EMAIL_IMAP_SECURE", "BELLDANDY_EMAIL_IMAP_USER",
  "BELLDANDY_EMAIL_IMAP_PASS", "BELLDANDY_EMAIL_IMAP_MAILBOX",
  "BELLDANDY_EMAIL_IMAP_POLL_INTERVAL_MS", "BELLDANDY_EMAIL_IMAP_CONNECT_TIMEOUT_MS",
  "BELLDANDY_EMAIL_IMAP_SOCKET_TIMEOUT_MS", "BELLDANDY_EMAIL_IMAP_BOOTSTRAP_MODE",
  "BELLDANDY_EMAIL_IMAP_RECENT_WINDOW_LIMIT",
  "BELLDANDY_CHANNEL_ROUTER_ENABLED", "BELLDANDY_CHANNEL_ROUTER_CONFIG_PATH",
  "BELLDANDY_CHANNEL_ROUTER_DEFAULT_AGENT_ID",
  "BELLDANDY_FEISHU_APP_ID", "BELLDANDY_FEISHU_APP_SECRET", "BELLDANDY_FEISHU_AGENT_ID",
  "BELLDANDY_QQ_APP_ID", "BELLDANDY_QQ_APP_SECRET", "BELLDANDY_QQ_AGENT_ID", "BELLDANDY_QQ_SANDBOX",
  "BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED", "BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR",
  "BELLDANDY_QQ_STT_FALLBACK_PROVIDERS",
  "BELLDANDY_DISCORD_ENABLED", "BELLDANDY_DISCORD_BOT_TOKEN", "BELLDANDY_DISCORD_DEFAULT_CHANNEL_ID",
  "BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES", "BELLDANDY_WEBHOOK_PREAUTH_TIMEOUT_MS",
  "BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS", "BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS",
  "BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_TRACKED_KEYS", "BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY",
  "BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_TRACKED_KEYS",
  "BELLDANDY_WEBHOOK_CONFIG_PATH", "BELLDANDY_WEBHOOK_IDEMPOTENCY_WINDOW_MS",
  "BELLDANDY_STATE_DIR", "BELLDANDY_STATE_DIR_WINDOWS", "BELLDANDY_STATE_DIR_WSL",
  "BELLDANDY_WORKSPACE_DIR", "BELLDANDY_WEB_ROOT", "BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE",
  "BELLDANDY_COMMANDER_MODE", "BELLDANDY_COMMANDER_AGENT_ID",
  "BELLDANDY_GOAL_EXECUTION_MODE", "BELLDANDY_GOAL_GOVERNANCE_MODE",
  "BELLDANDY_COMMANDER_AUTO_REWORK_ENABLED",
  "BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED",
  "BELLDANDY_LOG_LEVEL", "BELLDANDY_LOG_CONSOLE", "BELLDANDY_LOG_FILE",
  "BELLDANDY_LOG_DIR", "BELLDANDY_LOG_MAX_SIZE", "BELLDANDY_LOG_RETENTION_DAYS",
  "BELLDANDY_DREAM_AUTO_HEARTBEAT_ENABLED", "BELLDANDY_DREAM_AUTO_CRON_ENABLED",
  "BELLDANDY_DREAM_OBSIDIAN_ENABLED", "BELLDANDY_DREAM_OBSIDIAN_VAULT_PATH",
  "BELLDANDY_DREAM_OBSIDIAN_ROOT_DIR",
  "BELLDANDY_DREAM_OPENAI_THINKING", "BELLDANDY_DREAM_OPENAI_REASONING_EFFORT",
  "BELLDANDY_DREAM_OPENAI_TIMEOUT_MS", "BELLDANDY_DREAM_OPENAI_MAX_TOKENS",
  "BELLDANDY_COMMONS_OBSIDIAN_ENABLED", "BELLDANDY_COMMONS_OBSIDIAN_VAULT_PATH",
  "BELLDANDY_COMMONS_OBSIDIAN_ROOT_DIR",
]);

function normalizeConfigValue(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function applyProcessEnvUpdates(updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
      continue;
    }
    delete process.env[key];
  }
}

export async function handleConfigChannelMethod(
  req: GatewayReqFrame,
  ctx: ConfigChannelMethodContext,
): Promise<GatewayResFrame | null> {
  switch (req.method) {
    case "config.read": {
      const { envPath, envLocalPath: localEnvPath } = resolveEnvFilePaths({ envDir: ctx.envDir });
      const config: Record<string, string> = {};
      await ctx.readEnvFileIntoConfig(envPath, config);
      await ctx.readEnvFileIntoConfig(localEnvPath, config);
      for (const key of Object.keys(config)) {
        if (REDACT_PATTERNS.some((pattern) => pattern.test(key))) {
          config[key] = "[REDACTED]";
        }
      }
      return { type: "res", id: req.id, ok: true, payload: { config } };
    }

    case "config.update": {
      const params = req.params as { updates: Record<string, string> } | undefined;
      const updates = params?.updates;
      if (!updates || typeof updates !== "object") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "Missing updates" } };
      }
      for (const key of Object.keys(updates)) {
        if (!SAFE_UPDATE_KEYS.has(key)) {
          return { type: "res", id: req.id, ok: false, error: { code: "forbidden", message: `不允许修改配置项: ${key}` } };
        }
      }

      const { envPath, envLocalPath } = resolveEnvFilePaths({ envDir: ctx.envDir });
      const currentConfig: Record<string, string> = {};
      await ctx.readEnvFileIntoConfig(envPath, currentConfig);
      await ctx.readEnvFileIntoConfig(envLocalPath, currentConfig);

      const effectiveUpdates: Record<string, string> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (normalizeConfigValue(currentConfig[key]) !== normalizeConfigValue(value)) {
          effectiveUpdates[key] = value;
        }
      }

      const mergedConfig = { ...currentConfig, ...effectiveUpdates };
      const effectiveAuthMode = String(
        mergedConfig.BELLDANDY_AUTH_MODE
        ?? (ctx.auth.mode === "token" ? "token" : ctx.auth.mode === "password" ? "password" : "none"),
      ).trim().toLowerCase();
      const communityApiEnabled = String(mergedConfig.BELLDANDY_COMMUNITY_API_ENABLED ?? "false").trim().toLowerCase() === "true";
      if (communityApiEnabled && effectiveAuthMode === "none") {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "community_api_requires_auth",
            message: "BELLDANDY_COMMUNITY_API_ENABLED=true cannot be used with BELLDANDY_AUTH_MODE=none",
          },
        };
      }

      const envUpdates: Record<string, string> = {};
      const localUpdates: Record<string, string> = {};
      for (const key of Object.keys(effectiveUpdates)) {
        if (key === "BELLDANDY_EXTRA_WORKSPACE_ROOTS") {
          envUpdates[key] = effectiveUpdates[key];
        } else {
          localUpdates[key] = effectiveUpdates[key];
        }
      }

      ctx.onConfigUpdating?.(effectiveUpdates);
      const envOk = await ctx.updateEnvFile(envPath, envUpdates);
      const localOk = await ctx.updateEnvFile(envLocalPath, localUpdates);
      if (!envOk || !localOk) {
        return { type: "res", id: req.id, ok: false, error: { code: "write_failed", message: "Failed to write config files" } };
      }

      if (Object.prototype.hasOwnProperty.call(effectiveUpdates, "BELLDANDY_MODEL_PREFERRED_PROVIDERS")) {
        const preferredProviderIds = normalizePreferredProviderIds(effectiveUpdates.BELLDANDY_MODEL_PREFERRED_PROVIDERS);
        ctx.preferredProviderIds.splice(0, ctx.preferredProviderIds.length, ...preferredProviderIds);
      }
      if (areAllConfigKeysHotReload(Object.keys(effectiveUpdates))) {
        applyProcessEnvUpdates(effectiveUpdates);
      }
      ctx.onConfigUpdated?.(effectiveUpdates);

      return { type: "res", id: req.id, ok: true };
    }

    case "channel.reply_chunking.get": {
      return { type: "res", id: req.id, ok: true, payload: getChannelReplyChunkingConfigContent(ctx.stateDir) };
    }

    case "channel.reply_chunking.update": {
      const params = asRecord(req.params);
      const content = typeof params.content === "string" ? params.content : "";
      try {
        const config = parseChannelReplyChunkingConfigContent(content);
        await writeChannelReplyChunkingConfig(ctx.stateDir, config);
        return { type: "res", id: req.id, ok: true, payload: getChannelReplyChunkingConfigContent(ctx.stateDir) };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "invalid_channel_reply_chunking_config",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "channel.security.get": {
      return { type: "res", id: req.id, ok: true, payload: getChannelSecurityConfigContent(ctx.stateDir) };
    }

    case "channel.security.update": {
      const params = asRecord(req.params);
      const content = typeof params.content === "string" ? params.content : "";
      try {
        const config = parseChannelSecurityConfigContent(content);
        await writeChannelSecurityConfig(ctx.stateDir, config);
        return { type: "res", id: req.id, ok: true, payload: getChannelSecurityConfigContent(ctx.stateDir) };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "invalid_channel_security_config",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "channel.security.pending.list": {
      const store = await readChannelSecurityApprovalStore(ctx.stateDir);
      return { type: "res", id: req.id, ok: true, payload: { pending: store.pending } };
    }

    case "channel.security.approve": {
      const params = asRecord(req.params);
      const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
      if (!requestId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "requestId is required" } };
      }
      try {
        const approved = await approveChannelSecurityApprovalRequest(ctx.stateDir, requestId);
        return {
          type: "res",
          id: req.id,
          ok: true,
          payload: {
            request: approved.request,
            config: approved.config,
            content: getChannelSecurityConfigContent(ctx.stateDir).content,
          },
        };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "channel_security_approve_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "channel.security.reject": {
      const params = asRecord(req.params);
      const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
      if (!requestId) {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "requestId is required" } };
      }
      try {
        const rejected = await rejectChannelSecurityApprovalRequest(ctx.stateDir, requestId);
        return { type: "res", id: req.id, ok: true, payload: { request: rejected } };
      } catch (error) {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: {
            code: "channel_security_reject_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    case "config.readRaw": {
      const { envPath } = resolveEnvFilePaths({ envDir: ctx.envDir });
      try {
        const stat = await ctx.statIfExists(envPath);
        if (!stat?.isFile()) {
          return { type: "res", id: req.id, ok: false, error: { code: "not_found", message: ".env 文件不存在" } };
        }
        const content = await fsp.readFile(envPath, "utf-8");
        return { type: "res", id: req.id, ok: true, payload: { content } };
      } catch (error) {
        return { type: "res", id: req.id, ok: false, error: { code: "read_failed", message: String(error) } };
      }
    }

    case "config.writeRaw": {
      const content = (req.params as { content?: unknown } | undefined)?.content;
      if (typeof content !== "string") {
        return { type: "res", id: req.id, ok: false, error: { code: "invalid_params", message: "Missing content" } };
      }
      const { envPath } = resolveEnvFilePaths({ envDir: ctx.envDir });
      try {
        await ctx.writeTextFileAtomic(envPath, content, { ensureParent: true });
        return { type: "res", id: req.id, ok: true };
      } catch (error) {
        return { type: "res", id: req.id, ok: false, error: { code: "write_failed", message: String(error) } };
      }
    }

    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
