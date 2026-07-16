export type ChannelKind = "feishu" | "discord" | "qq" | "community" | "webhook";

export type ChatKind = "dm" | "group" | "channel" | "room";

export interface RouteContext {
  channel: ChannelKind;
  accountId?: string;
  chatKind: ChatKind;
  chatId: string;
  sessionScope?: string;
  sessionKey?: string;
  text: string;
  senderId?: string;
  senderName?: string;
  mentions?: string[];
  mentioned?: boolean;
  eventType?: string;
}

export interface RouteRuleMatch {
  channels?: ChannelKind[];
  chatKinds?: ChatKind[];
  chatIds?: string[];
  senderAllowlist?: string[];
  senderDenylist?: string[];
  keywordsAny?: string[];
  mentionRequired?: boolean;
}

export interface RouteRuleAction {
  allow: boolean;
  agentId?: string;
}

export interface RouteRule {
  id: string;
  enabled: boolean;
  priority: number;
  match?: RouteRuleMatch;
  action: RouteRuleAction;
}

export interface RouteDecision {
  allow: boolean;
  reason: string;
  agentId?: string;
  matchedRuleId?: string;
}

export interface ChannelRouter {
  /**
   * 在下载附件、转码或解析正文前执行的安全预检。
   * 普通业务路由仍由 decide() 在完整文本可用后完成。
   */
  admitIngress?(ctx: RouteContext): RouteDecision;
  decide(ctx: RouteContext): RouteDecision;
}

export interface ChannelRouterConfig {
  version: 1;
  defaultAction?: RouteRuleAction;
  rules: RouteRule[];
}

export interface ChannelRouterLogger {
  debug?: (message: string, data?: unknown) => void;
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
}

