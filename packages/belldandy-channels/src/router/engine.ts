import type {
  ChannelKind,
  ChannelRouter,
  ChannelRouterConfig,
  ChannelRouterLogger,
  ChatKind,
  RouteContext,
  RouteDecision,
  RouteRule,
  RouteRuleAction,
  RouteRuleMatch,
} from "./types.js";
import {
  evaluateChannelIngressSecurity,
  type ChannelSecurityConfig,
  type ChannelSecurityConfigLoadStatus,
  type SecurityBackedChannelKind,
} from "./security-config.js";

export interface RuleBasedRouterOptions {
  defaultAgentId?: string;
  defaultAllow?: boolean;
  logger?: ChannelRouterLogger;
  securityConfig?: ChannelSecurityConfig;
  securityLoadStatus?: ChannelSecurityConfigLoadStatus;
  requiredSecurityChannels?: readonly SecurityBackedChannelKind[];
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = values.map((v) => String(v).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAction(action: RouteRuleAction | undefined, fallbackAgentId?: string, fallbackAllow = true): RouteRuleAction {
  if (!action) {
    return { allow: fallbackAllow, agentId: fallbackAgentId };
  }
  return {
    allow: action.allow,
    agentId: action.agentId?.trim() || fallbackAgentId,
  };
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  const input = text.toLowerCase();
  return keywords.some((keyword) => input.includes(keyword.toLowerCase()));
}

function inList(value: string | undefined, list: string[] | undefined): boolean {
  if (!list || list.length === 0) return true;
  if (!value) return false;
  return list.includes(value);
}

function isRuleMatch(match: RouteRuleMatch | undefined, ctx: RouteContext): boolean {
  if (!match) return true;

  if (match.channels && match.channels.length > 0 && !match.channels.includes(ctx.channel)) {
    return false;
  }

  if (match.chatKinds && match.chatKinds.length > 0 && !match.chatKinds.includes(ctx.chatKind)) {
    return false;
  }

  if (match.chatIds && match.chatIds.length > 0 && !match.chatIds.includes(ctx.chatId)) {
    return false;
  }

  const senderAllowlist = normalizeList(match.senderAllowlist);
  const senderDenylist = normalizeList(match.senderDenylist);

  if (!inList(ctx.senderId, senderAllowlist)) {
    return false;
  }

  if (senderDenylist && senderDenylist.length > 0 && !senderDenylist.includes(ctx.senderId ?? "")) {
    return false;
  }

  const keywordsAny = normalizeList(match.keywordsAny);
  if (keywordsAny && keywordsAny.length > 0 && !containsAnyKeyword(ctx.text, keywordsAny)) {
    return false;
  }

  if (match.mentionRequired !== undefined) {
    const mentioned = Boolean(ctx.mentioned) || Boolean(ctx.mentions && ctx.mentions.length > 0);
    if (mentioned !== match.mentionRequired) {
      return false;
    }
  }

  return true;
}

export function createRuleBasedRouter(
  config: ChannelRouterConfig,
  options: RuleBasedRouterOptions = {},
): ChannelRouter {
  const rules = [...(config.rules ?? [])]
    .filter((rule) => rule && typeof rule.id === "string" && rule.id.trim())
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const logger = options.logger;
  const defaultAction = normalizeAction(
    config.defaultAction,
    options.defaultAgentId,
    options.defaultAllow ?? true,
  );

  const admitIngress = (ctx: RouteContext): RouteDecision => {
    const securityDecision = evaluateChannelIngressSecurity(options.securityConfig, ctx, {
      loadStatus: options.securityLoadStatus,
      requiredChannels: options.requiredSecurityChannels,
    });
    return securityDecision ?? { allow: true, reason: "channel_security:admitted" };
  };

  return {
    admitIngress,
    decide(ctx: RouteContext): RouteDecision {
      const securityDecision = admitIngress(ctx);
      if (!securityDecision.allow) {
        logger?.debug?.("channel ingress security rejected", { decision: securityDecision, context: ctx });
        return securityDecision;
      }
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (!isRuleMatch(rule.match, ctx)) continue;

        const action = normalizeAction(rule.action, defaultAction.agentId, defaultAction.allow);
        const decision: RouteDecision = {
          allow: action.allow,
          reason: `matched_rule:${rule.id}`,
          matchedRuleId: rule.id,
          agentId: action.agentId,
        };
        logger?.debug?.("matched route rule", { ruleId: rule.id, decision, context: ctx });
        return decision;
      }

      if (securityDecision.reason !== "channel_security:admitted") {
        const decision: RouteDecision = {
          ...securityDecision,
          ...(securityDecision.allow && defaultAction.agentId
            ? { agentId: defaultAction.agentId }
            : {}),
        };
        logger?.debug?.("channel security fallback applied", { decision, context: ctx });
        return decision;
      }

      const decision: RouteDecision = {
        allow: defaultAction.allow,
        agentId: defaultAction.agentId,
        reason: "default_action",
      };
      logger?.debug?.("no route rule matched, use default action", { decision, context: ctx });
      return decision;
    },
  };
}

export function createDisabledRouter(defaultAgentId?: string): ChannelRouter {
  return {
    admitIngress(): RouteDecision {
      return { allow: true, reason: "router_disabled" };
    },
    decide(): RouteDecision {
      return {
        allow: true,
        reason: "router_disabled",
        agentId: defaultAgentId,
      };
    },
  };
}

export function normalizeRouterConfig(raw: unknown): ChannelRouterConfig {
  const fallback: ChannelRouterConfig = { version: 1, rules: [] };
  if (!raw || typeof raw !== "object") return fallback;

  const obj = raw as Record<string, unknown>;
  const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: RouteRule[] = [];

  for (const item of rulesRaw) {
    if (!item || typeof item !== "object") continue;
    const ruleObj = item as Record<string, unknown>;
    const id = typeof ruleObj.id === "string" ? ruleObj.id.trim() : "";
    if (!id) continue;

    const actionObj = (ruleObj.action && typeof ruleObj.action === "object")
      ? (ruleObj.action as Record<string, unknown>)
      : undefined;

    const actionAllow = typeof actionObj?.allow === "boolean" ? actionObj.allow : true;
    const actionAgentId = typeof actionObj?.agentId === "string" ? actionObj.agentId.trim() : undefined;

    const matchObj = (ruleObj.match && typeof ruleObj.match === "object")
      ? (ruleObj.match as Record<string, unknown>)
      : undefined;

    rules.push({
      id,
      enabled: typeof ruleObj.enabled === "boolean" ? ruleObj.enabled : true,
      priority: typeof ruleObj.priority === "number" ? ruleObj.priority : 0,
      match: matchObj ? {
        channels: Array.isArray(matchObj.channels)
          ? matchObj.channels.filter((v): v is ChannelKind => typeof v === "string")
          : undefined,
        chatKinds: Array.isArray(matchObj.chatKinds)
          ? matchObj.chatKinds.filter((v): v is ChatKind => typeof v === "string")
          : undefined,
        chatIds: Array.isArray(matchObj.chatIds) ? matchObj.chatIds.map((v) => String(v)) : undefined,
        senderAllowlist: Array.isArray(matchObj.senderAllowlist) ? matchObj.senderAllowlist.map((v) => String(v)) : undefined,
        senderDenylist: Array.isArray(matchObj.senderDenylist) ? matchObj.senderDenylist.map((v) => String(v)) : undefined,
        keywordsAny: Array.isArray(matchObj.keywordsAny) ? matchObj.keywordsAny.map((v) => String(v)) : undefined,
        mentionRequired: typeof matchObj.mentionRequired === "boolean" ? matchObj.mentionRequired : undefined,
      } : undefined,
      action: {
        allow: actionAllow,
        agentId: actionAgentId || undefined,
      },
    });
  }

  const defaultActionObj = (obj.defaultAction && typeof obj.defaultAction === "object")
    ? (obj.defaultAction as Record<string, unknown>)
    : undefined;
  const defaultAction = defaultActionObj
    ? {
      allow: typeof defaultActionObj.allow === "boolean" ? defaultActionObj.allow : true,
      agentId: typeof defaultActionObj.agentId === "string" ? defaultActionObj.agentId.trim() || undefined : undefined,
    }
    : undefined;

  return {
    version: 1,
    rules,
    defaultAction,
  };
}
