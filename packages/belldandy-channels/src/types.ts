/**
 * Belldandy Channel 通用接口
 * 所有外部渠道（飞书、Telegram、Discord 等）都应实现此接口
 */

import type { BelldandyAgent } from "@belldandy/agent";
import type { CurrentConversationBindingStore } from "./current-conversation-binding-store.js";
import type { ChannelRouter } from "./router/types.js";
import type { SecurityBackedChannelKind } from "./router/security-config.js";
import type { ReplyChunkingConfig } from "./reply-chunking-config.js";
import type { ChannelIngressScheduler } from "./channel-ingress-scheduler.js";

export type ChannelAgentResolver = (agentId?: string) => BelldandyAgent;
export type ChannelProactiveTarget = string | {
    chatId?: string;
    sessionKey?: string;
    accountId?: string;
};
export type ChannelSecurityApprovalRequestInput = {
    channel: SecurityBackedChannelKind;
    accountId?: string;
    senderId: string;
    senderName?: string;
    chatId: string;
    chatKind: "dm";
    messagePreview?: string;
};

/**
 * 渠道基础配置
 */
export interface ChannelConfig {
    /** Agent 实例，用于处理消息 */
    agent: BelldandyAgent;
    /** 可选：渠道消息路由器 */
    router?: ChannelRouter;
    /** 可选：统一 outbound chunking runtime 策略 */
    replyChunkingConfig?: ReplyChunkingConfig;
    /** 可选：根据 agentId 解析 Agent 实例（用于多 Agent 路由） */
    agentResolver?: ChannelAgentResolver;
    /** 可选：路由默认 Agent ID */
    defaultAgentId?: string;
    /** 可选：current conversation binding 持久层 */
    currentConversationBindingStore?: CurrentConversationBindingStore;
    /** 可选：当渠道 DM 命中 allowlist 阻断时记录待审批请求 */
    onChannelSecurityApprovalRequired?: (input: ChannelSecurityApprovalRequestInput) => void | Promise<void>;
    /** 可选：Gateway 注入的共享入站调度器；独立渠道实例会创建本地 fallback。 */
    ingressScheduler?: ChannelIngressScheduler;
}

/**
 * 渠道事件类型
 */
export type ChannelEvent =
    | { type: "started"; channel: string }
    | { type: "stopped"; channel: string }
    | { type: "message_received"; channel: string; messageId: string; chatId: string }
    | { type: "message_sent"; channel: string; messageId?: string; chatId: string }
    | { type: "media_received"; channel: string; messageId: string; chatId: string; mediaType: "audio" | "image" | "video"; buffer?: Buffer; mime?: string }
    | { type: "error"; channel: string; error: Error };

/**
 * 渠道事件监听器
 */
export type ChannelEventListener = (event: ChannelEvent) => void;

/**
 * Channel 通用接口
 * 
 * 实现此接口的渠道可以被 Gateway 统一管理
 * 
 * @example
 * ```typescript
 * class TelegramChannel implements Channel {
 *     readonly name = "telegram";
 *     // ... 实现其他方法
 * }
 * ```
 */
export interface Channel {
    /**
     * 渠道名称（唯一标识符）
     * 例如: "feishu", "telegram", "discord"
     */
    readonly name: string;

    /**
     * 渠道是否正在运行
     */
    readonly isRunning: boolean;

    /**
     * 启动渠道
     * - 建立连接（WebSocket/HTTP Long Polling 等）
     * - 开始监听消息
     */
    start(): Promise<void>;

    /**
     * 停止渠道
     * - 断开连接
     * - 清理资源
     */
    stop(): Promise<void>;

    /**
     * 主动发送消息（非回复）
     * 用于心跳提醒、定时任务等场景
     * 
     * @param content - 消息内容
     * @param target - 可选，指定发送目标。支持旧 `chatId` 字符串，也支持 `{ sessionKey }`
     * @returns 是否发送成功
     */
    sendProactiveMessage(content: string, target?: ChannelProactiveTarget): Promise<boolean>;

    /**
     * 添加事件监听器（可选实现）
     */
    addEventListener?(listener: ChannelEventListener): void;

    /**
     * 移除事件监听器（可选实现）
     */
    removeEventListener?(listener: ChannelEventListener): void;
}

/**
 * 渠道管理器接口
 * 用于 Gateway 统一管理多个渠道
 */
export interface ChannelManager {
    /**
     * 注册渠道
     */
    register(channel: Channel): void;

    /**
     * 注销渠道
     */
    unregister(channelName: string): void;

    /**
     * 获取渠道
     */
    get(channelName: string): Channel | undefined;

    /**
     * 获取所有渠道
     */
    getAll(): Channel[];

    /**
     * 启动所有渠道
     */
    startAll(): Promise<void>;

    /**
     * 停止所有渠道
     */
    stopAll(): Promise<void>;

    /**
     * 向所有渠道广播消息
     */
    broadcast(content: string): Promise<Map<string, boolean>>;
}
