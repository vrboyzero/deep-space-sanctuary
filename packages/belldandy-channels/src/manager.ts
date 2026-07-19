/**
 * 渠道管理器 - 统一管理多个渠道
 */

import type { Channel, ChannelManager } from "./types.js";

/**
 * 默认渠道管理器实现
 * 
 * @example
 * ```typescript
 * const manager = new DefaultChannelManager();
 * 
 * // 注册渠道
 * manager.register(new FeishuChannel(config));
 * manager.register(new TelegramChannel(config));
 * 
 * // 启动所有渠道
 * await manager.startAll();
 * 
 * // 广播消息到所有渠道
 * await manager.broadcast("系统维护通知");
 * ```
 */
export class DefaultChannelManager implements ChannelManager {
    private readonly channels = new Map<string, Channel>();
    private lifecycleQueue: Promise<void> = Promise.resolve();

    /**
     * 注册渠道
     */
    async register(channel: Channel): Promise<void> {
        await this.enqueueLifecycle(async () => {
            const previous = this.channels.get(channel.name);
            if (previous === channel) return;
            if (previous) {
                console.warn(`[ChannelManager] Channel "${channel.name}" already registered, stopping previous owner before replacement.`);
                await previous.stop();
            }
            this.channels.set(channel.name, channel);
            console.log(`[ChannelManager] Registered channel: ${channel.name}`);
        });
    }

    /**
     * 注销渠道
     */
    async unregister(channelName: string): Promise<void> {
        await this.enqueueLifecycle(async () => {
            const channel = this.channels.get(channelName);
            if (!channel) return;
            await channel.stop();
            this.channels.delete(channelName);
            console.log(`[ChannelManager] Unregistered channel: ${channelName}`);
        });
    }

    /**
     * 获取渠道
     */
    get(channelName: string): Channel | undefined {
        return this.channels.get(channelName);
    }

    /**
     * 获取所有渠道
     */
    getAll(): Channel[] {
        return Array.from(this.channels.values());
    }

    /**
     * 获取所有渠道名称
     */
    getNames(): string[] {
        return Array.from(this.channels.keys());
    }

    /**
     * 启动所有渠道
     */
    async startAll(): Promise<void> {
        await this.enqueueLifecycle(async () => {
            const promises = Array.from(this.channels.values()).map(async (channel) => {
                try {
                    await channel.start();
                } catch (e) {
                    console.error(`[ChannelManager] Failed to start channel "${channel.name}":`, e);
                }
            });
            await Promise.all(promises);
        });
    }

    /**
     * 停止所有渠道
     */
    async stopAll(): Promise<void> {
        await this.enqueueLifecycle(async () => {
            const promises = Array.from(this.channels.values()).map(async (channel) => {
                try {
                    await channel.stop();
                } catch (e) {
                    console.error(`[ChannelManager] Failed to stop channel "${channel.name}":`, e);
                }
            });
            await Promise.all(promises);
        });
    }

    /**
     * 向所有渠道广播消息
     * @returns Map<渠道名称, 是否发送成功>
     */
    async broadcast(content: string): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();
        
        const promises = Array.from(this.channels.entries()).map(async ([name, channel]) => {
            try {
                const success = await channel.sendProactiveMessage(content);
                results.set(name, success);
            } catch (e) {
                console.error(`[ChannelManager] Failed to broadcast to "${name}":`, e);
                results.set(name, false);
            }
        });
        
        await Promise.all(promises);
        return results;
    }

    /**
     * 获取渠道状态摘要
     */
    getStatus(): { name: string; running: boolean }[] {
        return Array.from(this.channels.values()).map((channel) => ({
            name: channel.name,
            running: channel.isRunning,
        }));
    }

    /**
     * 同一 Manager 内的 replace/unregister/start/stop 不能交叉执行，否则旧连接可能在
     * 新 owner 发布后才关闭。失败不会阻塞后续操作，但会原样返回给当前调用方。
     */
    private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
        const pending = this.lifecycleQueue.then(operation, operation);
        this.lifecycleQueue = pending.then(
            () => undefined,
            () => undefined,
        );
        return pending;
    }
}
