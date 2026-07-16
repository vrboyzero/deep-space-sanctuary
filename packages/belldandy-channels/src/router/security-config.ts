import fs from "node:fs";
import path from "node:path";

import type { ChannelRouterLogger, ChatKind, RouteContext, RouteDecision } from "./types.js";

export type SecurityBackedChannelKind = "discord" | "feishu" | "qq" | "community";
export type ChannelDmPolicy = "open" | "allowlist";
export type SecurityMentionChatKind = Exclude<ChatKind, "dm">;

export interface ChannelSecurityAccountPolicy {
  enabled?: boolean;
  dmPolicy?: ChannelDmPolicy;
  allowFrom?: string[];
  mentionRequired?: Partial<Record<SecurityMentionChatKind, boolean>>;
}

export interface ChannelSecurityPolicy extends ChannelSecurityAccountPolicy {
  accounts?: Record<string, ChannelSecurityAccountPolicy>;
}

export interface ChannelSecurityConfig {
  version: 1;
  channels: Partial<Record<SecurityBackedChannelKind, ChannelSecurityPolicy>>;
}

export type ChannelSecurityConfigLoadStatus = "loaded" | "missing" | "invalid" | "not_configured";

export interface ChannelSecurityConfigLoadResult {
  config: ChannelSecurityConfig;
  status: ChannelSecurityConfigLoadStatus;
}

const SECURITY_CHANNELS = ["discord", "feishu", "qq", "community"] as const satisfies readonly SecurityBackedChannelKind[];
const MENTION_CHAT_KINDS = ["group", "channel", "room"] as const satisfies readonly SecurityMentionChatKind[];

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUniqueStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const unique = Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
  return unique.length ? unique : undefined;
}

function normalizeMentionRequired(
  value: unknown,
): Partial<Record<SecurityMentionChatKind, boolean>> | undefined {
  if (typeof value === "boolean") {
    return Object.fromEntries(MENTION_CHAT_KINDS.map((kind) => [kind, value])) as Partial<
      Record<SecurityMentionChatKind, boolean>
    >;
  }

  if (Array.isArray(value)) {
    const enabledKinds = new Set(
      value
        .map((item) => normalizeString(item))
        .filter((item): item is SecurityMentionChatKind =>
          MENTION_CHAT_KINDS.includes(item as SecurityMentionChatKind),
        ),
    );
    if (!enabledKinds.size) return undefined;
    return Object.fromEntries(
      MENTION_CHAT_KINDS.map((kind) => [kind, enabledKinds.has(kind)]),
    ) as Partial<Record<SecurityMentionChatKind, boolean>>;
  }

  if (!value || typeof value !== "object") return undefined;

  const raw = value as Record<string, unknown>;
  const normalized: Partial<Record<SecurityMentionChatKind, boolean>> = {};
  for (const kind of MENTION_CHAT_KINDS) {
    if (typeof raw[kind] === "boolean") {
      normalized[kind] = raw[kind] as boolean;
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeChannelSecurityAccountPolicy(value: unknown): ChannelSecurityAccountPolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const dmPolicyRaw = normalizeString(raw.dmPolicy).toLowerCase();
  const dmPolicy: ChannelDmPolicy | undefined = dmPolicyRaw === "allowlist"
    ? "allowlist"
    : dmPolicyRaw === "open"
      ? "open"
      : undefined;
  const allowFrom = normalizeUniqueStringList(raw.allowFrom);
  const mentionRequired = normalizeMentionRequired(raw.mentionRequired);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : undefined;

  if (enabled === undefined && !dmPolicy && !allowFrom?.length && !mentionRequired) {
    return undefined;
  }

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(dmPolicy ? { dmPolicy } : {}),
    ...(allowFrom?.length ? { allowFrom } : {}),
    ...(mentionRequired ? { mentionRequired } : {}),
  };
}

function normalizeAccountPolicies(value: unknown): Record<string, ChannelSecurityAccountPolicy> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const normalized: Record<string, ChannelSecurityAccountPolicy> = {};
  for (const [rawAccountId, rawPolicy] of Object.entries(value as Record<string, unknown>)) {
    const accountId = normalizeString(rawAccountId);
    if (!accountId) continue;
    const policy = normalizeChannelSecurityAccountPolicy(rawPolicy);
    if (policy) {
      normalized[accountId] = policy;
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeChannelSecurityPolicy(value: unknown): ChannelSecurityPolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const basePolicy = normalizeChannelSecurityAccountPolicy(value);
  const accounts = normalizeAccountPolicies(raw.accounts);
  if (!basePolicy && !accounts) return undefined;
  return {
    ...(basePolicy ?? {}),
    ...(accounts ? { accounts } : {}),
  };
}

function pickBaseChannelSecurityPolicy(policy: ChannelSecurityPolicy | undefined): ChannelSecurityAccountPolicy | undefined {
  if (!policy) return undefined;
  const base: ChannelSecurityAccountPolicy = {
    ...(policy.enabled !== undefined ? { enabled: policy.enabled } : {}),
    ...(policy.dmPolicy ? { dmPolicy: policy.dmPolicy } : {}),
    ...(policy.allowFrom?.length ? { allowFrom: policy.allowFrom } : {}),
    ...(policy.mentionRequired ? { mentionRequired: policy.mentionRequired } : {}),
  };
  return Object.keys(base).length ? base : undefined;
}

function mergeChannelSecurityPolicy(
  base: ChannelSecurityAccountPolicy | undefined,
  override: ChannelSecurityAccountPolicy | undefined,
): ChannelSecurityAccountPolicy | undefined {
  if (!base && !override) return undefined;
  const merged: ChannelSecurityAccountPolicy = {
    ...(base?.enabled !== undefined ? { enabled: base.enabled } : {}),
    ...(base?.dmPolicy ? { dmPolicy: base.dmPolicy } : {}),
    ...(base?.allowFrom?.length ? { allowFrom: base.allowFrom } : {}),
    ...(base?.mentionRequired ? { mentionRequired: base.mentionRequired } : {}),
    ...(override?.enabled !== undefined ? { enabled: override.enabled } : {}),
    ...(override?.dmPolicy ? { dmPolicy: override.dmPolicy } : {}),
    ...(override?.allowFrom?.length ? { allowFrom: override.allowFrom } : {}),
    ...(override?.mentionRequired ? { mentionRequired: override.mentionRequired } : {}),
  };
  return Object.keys(merged).length ? merged : undefined;
}

export function normalizeChannelSecurityConfig(raw: unknown): ChannelSecurityConfig {
  const fallback: ChannelSecurityConfig = { version: 1, channels: {} };
  if (!raw || typeof raw !== "object") return fallback;

  const rawChannels = (raw as Record<string, unknown>).channels;
  if (!rawChannels || typeof rawChannels !== "object") return fallback;

  const channels: Partial<Record<SecurityBackedChannelKind, ChannelSecurityPolicy>> = {};
  for (const channel of SECURITY_CHANNELS) {
    const policy = normalizeChannelSecurityPolicy((rawChannels as Record<string, unknown>)[channel]);
    if (policy) channels[channel] = policy;
  }

  return { version: 1, channels };
}

export function resolveChannelSecurityConfigPath(stateDir: string): string {
  return path.join(stateDir, "channel-security.json");
}

export function loadChannelSecurityConfigResult(
  configPath: string | undefined,
  logger?: ChannelRouterLogger,
): ChannelSecurityConfigLoadResult {
  const fallback: ChannelSecurityConfig = { version: 1, channels: {} };
  if (!configPath || !configPath.trim()) {
    logger?.info?.("no channel security config path provided, use empty channel security policy");
    return { config: fallback, status: "not_configured" };
  }

  const resolvedPath = path.resolve(configPath.trim());
  try {
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("channel security config root must be an object");
    }
    const config = normalizeChannelSecurityConfig(parsed);
    logger?.info?.("loaded channel security config", {
      path: resolvedPath,
      channels: Object.keys(config.channels).length,
    });
    return { config, status: "loaded" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      logger?.warn?.("channel security config file not found, use empty policy", { path: resolvedPath });
      return { config: fallback, status: "missing" };
    }
    logger?.warn?.("failed to load channel security config, use empty policy", {
      path: resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { config: fallback, status: "invalid" };
  }
}

export function loadChannelSecurityConfig(
  configPath: string | undefined,
  logger?: ChannelRouterLogger,
): ChannelSecurityConfig {
  return loadChannelSecurityConfigResult(configPath, logger).config;
}

export function hasChannelSecurityPolicy(config: ChannelSecurityConfig | undefined): boolean {
  if (!config) return false;
  return SECURITY_CHANNELS.some((channel) => Boolean(config.channels[channel]));
}

export function resolveChannelSecurityPolicy(
  config: ChannelSecurityConfig | undefined,
  channel: SecurityBackedChannelKind,
  accountId?: string,
): ChannelSecurityAccountPolicy | undefined {
  const policy = config?.channels[channel];
  if (!policy) return undefined;
  const basePolicy = pickBaseChannelSecurityPolicy(policy);
  const normalizedAccountId = normalizeString(accountId);
  if (!normalizedAccountId) return basePolicy;
  return mergeChannelSecurityPolicy(basePolicy, policy.accounts?.[normalizedAccountId]) ?? basePolicy;
}

function isSecurityBackedChannel(channel: string): channel is SecurityBackedChannelKind {
  return SECURITY_CHANNELS.includes(channel as SecurityBackedChannelKind);
}

function isMentionChatKind(kind: ChatKind): kind is SecurityMentionChatKind {
  return kind === "group" || kind === "channel" || kind === "room";
}

export function evaluateChannelSecurityPolicy(
  config: ChannelSecurityConfig | undefined,
  ctx: RouteContext,
): RouteDecision | null {
  if (!config || !isSecurityBackedChannel(ctx.channel)) return null;
  const policy = resolveChannelSecurityPolicy(config, ctx.channel, ctx.accountId);
  if (!policy || policy.enabled === false) return null;

  const mentioned = Boolean(ctx.mentioned) || Boolean(ctx.mentions && ctx.mentions.length > 0);
  if (ctx.chatKind === "dm") {
    if ((policy.dmPolicy ?? "open") !== "allowlist") return null;
    const senderId = normalizeString(ctx.senderId);
    const allowFrom = policy.allowFrom ?? [];
    const allowed = Boolean(senderId) && allowFrom.includes(senderId);
    return {
      allow: allowed,
      reason: allowed
        ? "channel_security:dm_allowlist"
        : "channel_security:dm_allowlist_blocked",
    };
  }

  if (!isMentionChatKind(ctx.chatKind)) return null;
  if (policy.mentionRequired?.[ctx.chatKind] !== true) return null;
  return {
    allow: mentioned,
    reason: mentioned
      ? "channel_security:mention_required"
      : "channel_security:mention_required_blocked",
  };
}

/**
 * 已启用的外部渠道必须有可读取的显式 policy；否则在任何媒体下载、正文解析或
 * Agent 执行前拒绝。未列入 requiredChannels 的渠道保持旧的兼容行为。
 */
export function evaluateChannelIngressSecurity(
  config: ChannelSecurityConfig | undefined,
  ctx: RouteContext,
  options: {
    loadStatus?: ChannelSecurityConfigLoadStatus;
    requiredChannels?: readonly SecurityBackedChannelKind[];
  } = {},
): RouteDecision | null {
  if (!isSecurityBackedChannel(ctx.channel)) return null;
  const required = options.requiredChannels?.includes(ctx.channel) === true;
  if (required) {
    if ((options.loadStatus ?? "loaded") !== "loaded") {
      return { allow: false, reason: "channel_security:config_unavailable" };
    }
    const policy = resolveChannelSecurityPolicy(config, ctx.channel, ctx.accountId);
    if (!policy) {
      return { allow: false, reason: "channel_security:policy_missing" };
    }
    if (policy.enabled === false) {
      return { allow: false, reason: "channel_security:policy_disabled" };
    }
  }
  return evaluateChannelSecurityPolicy(config, ctx);
}
