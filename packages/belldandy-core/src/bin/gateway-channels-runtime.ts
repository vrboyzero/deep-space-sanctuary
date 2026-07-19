import fs from "node:fs";
import path from "node:path";

import type { AgentRegistry, BelldandyAgent } from "@belldandy/agent";
import type {
  ToolExecutor,
  TranscribeOptions,
  TranscribeResult,
} from "@belldandy/skills";
import { createJoinRoomTool, createLeaveRoomTool } from "@belldandy/skills";
import type { TokenUsageUploadConfig } from "@belldandy/protocol";
import { extractOwnerUuid } from "@belldandy/protocol";
import {
  ChannelIngressScheduler,
  CommunityChannel,
  createChannelRouter,
  DefaultChannelManager,
  DiscordChannel,
  FeishuChannel,
  getCommunityConfigPath,
  loadCommunityConfig,
  loadReplyChunkingConfig,
  QqChannel,
  type Channel,
  type ChannelConversationLifecycle,
  type ChannelSecurityApprovalRequestInput,
  type CurrentConversationBindingStore,
} from "@belldandy/channels";
import type { BelldandyLogger } from "../logger/index.js";
import type { ResidentConversationStore } from "../resident-conversation-store.js";
import {
  DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  parseAssistantExternalDeliveryPreference,
} from "../assistant-mode-runtime.js";
import { upsertChannelSecurityApprovalRequest } from "../channel-security-store.js";
import { createChannelConversationLifecycle } from "../channel-conversation-lifecycle.js";
import type {
  ExternalOutboundChannel,
  ExternalOutboundSenderRegistry,
} from "../external-outbound-sender-registry.js";
import type { TopLevelConversationLifecycle } from "../top-level-conversation-lifecycle.js";

type GatewayChannelsRuntimeInput = {
  stateDir: string;
  logger: Pick<BelldandyLogger, "debug" | "info" | "warn" | "error">;
  channelRouterEnabled: boolean;
  channelRouterConfigPath: string;
  channelRouterDefaultAgentId: string;
  channelSecurityConfigPath: string;
  channelReplyChunkingConfigPath: string;
  agentRegistry?: AgentRegistry;
  createAgent?: () => BelldandyAgent;
  conversationStore: ResidentConversationStore;
  topLevelConversationLifecycle?: TopLevelConversationLifecycle;
  currentConversationBindingStore: CurrentConversationBindingStore;
  externalOutboundSenderRegistry: ExternalOutboundSenderRegistry;
  toolsEnabled: boolean;
  toolExecutor: ToolExecutor;
  serverBroadcast?: (msg: unknown) => void;
  sttTranscribe: (opts: TranscribeOptions) => Promise<TranscribeResult | null>;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuAgentId?: string;
  qqAppId?: string;
  qqAppSecret?: string;
  qqAgentId?: string;
  qqSandbox: boolean;
  discordEnabled: boolean;
  discordBotToken?: string;
  readEnv: (name: string) => string | undefined;
};

function readPositiveInt(readEnv: GatewayChannelsRuntimeInput["readEnv"], name: string): number | undefined {
  const value = Number(readEnv(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function createGatewayChannelsRuntime(input: GatewayChannelsRuntimeInput) {
  // Shared by all adapters so global and per-channel capacity are enforced across channel boundaries.
  const channelIngressScheduler = new ChannelIngressScheduler({
    maxConcurrent: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT"),
    maxConcurrentPerChannel: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT_PER_CHANNEL"),
    maxPendingPerSession: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_PENDING_PER_SESSION"),
    maxQueued: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED"),
    maxWaitMs: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_WAIT_MS"),
    maxPayloadBytes: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_PAYLOAD_BYTES"),
    maxQueuedPayloadBytes: readPositiveInt(input.readEnv, "BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED_PAYLOAD_BYTES"),
  });
  const channelManager = new DefaultChannelManager();
  const conversationLifecycle: ChannelConversationLifecycle | undefined = input.topLevelConversationLifecycle
    ? createChannelConversationLifecycle({
        lifecycle: input.topLevelConversationLifecycle,
        conversationStore: input.conversationStore,
      })
    : undefined;
  const managedChannels = new Map<ExternalOutboundChannel, Channel>();
  const backgroundStartTasks = new Map<ExternalOutboundChannel, Promise<void>>();
  let channelsConfigured = false;
  let stopChannelsPromise: Promise<void> | undefined;

  const registerManagedChannel = async (channelKind: ExternalOutboundChannel, channel: Channel): Promise<void> => {
    await channelManager.register(channel);
    managedChannels.set(channelKind, channel);
  };

  const startManagedChannel = (channelKind: ExternalOutboundChannel, channel: Channel): void => {
    const task = channel.start()
      .then(() => {
        // A stopped/replaced instance may complete startup late; it must not reclaim outbound ownership.
        if (channelManager.get(channel.name) !== channel) return;
        input.externalOutboundSenderRegistry.register(channelKind, channel);
      })
      .catch(async (error: unknown) => {
        input.logger.error(channelKind, "Channel Error", error);
        if (channelManager.get(channel.name) === channel) {
          try {
            await channelManager.unregister(channel.name);
          } catch (stopError) {
            input.logger.error(channelKind, "Failed to clean up channel after startup error", stopError);
          }
        }
        if (managedChannels.get(channelKind) === channel) {
          managedChannels.delete(channelKind);
        }
      })
      .finally(() => {
        if (backgroundStartTasks.get(channelKind) === task) {
          backgroundStartTasks.delete(channelKind);
        }
      });
    backgroundStartTasks.set(channelKind, task);
  };
  const communityConfigured = Boolean(input.createAgent && fs.existsSync(getCommunityConfigPath()));
  const requiredSecurityChannels = [
    input.feishuAppId && input.feishuAppSecret ? "feishu" : undefined,
    input.qqAppId && input.qqAppSecret ? "qq" : undefined,
    input.discordEnabled && input.discordBotToken ? "discord" : undefined,
    communityConfigured ? "community" : undefined,
  ].filter((channel): channel is "feishu" | "qq" | "discord" | "community" => Boolean(channel));
  const channelRouter = createChannelRouter({
    enabled: input.channelRouterEnabled,
    configPath: input.channelRouterConfigPath,
    securityConfigPath: input.channelSecurityConfigPath,
    requiredSecurityChannels,
    defaultAgentId: input.channelRouterDefaultAgentId,
    logger: {
      debug: (message, data) => input.logger.debug("channel-router", message, data),
      info: (message, data) => input.logger.info("channel-router", message, data),
      warn: (message, data) => input.logger.warn("channel-router", message, data),
    },
  });
  const channelReplyChunkingConfig = loadReplyChunkingConfig(input.channelReplyChunkingConfigPath);
  const assistantExternalDeliveryPreference = parseAssistantExternalDeliveryPreference(
    input.readEnv("BELLDANDY_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE")
      ?? DEFAULT_ASSISTANT_EXTERNAL_DELIVERY_PREFERENCE,
  );

  const deliverToLatestBoundExternalChannel = async (
    source: "heartbeat" | "cron",
    message: string,
  ): Promise<boolean> => {
    const resolved = await input.externalOutboundSenderRegistry.resolvePreferredLatestTarget([
      ...assistantExternalDeliveryPreference,
    ]);
    if (!resolved.ok) {
      input.logger.warn(
        source,
        `Failed to deliver to external channel: ${resolved.message}`,
        { attemptedChannels: resolved.attemptedChannels },
      );
      return false;
    }
    input.logger.info(
      source,
      `Delivering to user via ${resolved.channel}...`,
      { sessionKey: resolved.resolvedSessionKey, resolution: resolved.resolution },
    );
    const sent = await input.externalOutboundSenderRegistry.sendResolvedText({
      channel: resolved.channel,
      content: message,
      resolvedSessionKey: resolved.resolvedSessionKey,
    });
    if (!sent.ok) {
      input.logger.warn(
        source,
        `Failed to deliver via ${resolved.channel}: ${sent.message}`,
        { sessionKey: resolved.resolvedSessionKey },
      );
      return false;
    }
    return true;
  };

  const resolveChannelAgent = (requestedAgentId?: string): BelldandyAgent => {
    if (input.agentRegistry) {
      try {
        return input.agentRegistry.create(requestedAgentId);
      } catch (error) {
        input.logger.warn("channel-router", `Failed to resolve agent "${requestedAgentId ?? "default"}", fallback to default`, error);
        return input.agentRegistry.create("default");
      }
    }
    if (input.createAgent) {
      return input.createAgent();
    }
    throw new Error("No agent available for channel routing");
  };

  const recordChannelSecurityApprovalRequest = async (approvalInput: ChannelSecurityApprovalRequestInput) => {
    try {
      const request = await upsertChannelSecurityApprovalRequest(input.stateDir, approvalInput);
      if (!request.id) return;
      input.serverBroadcast?.({
        type: "event",
        event: "channel.security.pending",
        payload: {
          ...request,
          isNew: request.seenCount <= 1,
        },
      });
      input.logger.warn("channel-security", `Pending approval recorded: channel=${approvalInput.channel}, sender=${approvalInput.senderId}, chat=${approvalInput.chatId}`);
    } catch (error) {
      input.logger.warn("channel-security", `Failed to record pending approval for ${approvalInput.channel}:${approvalInput.senderId}`, error);
    }
  };

  const logChannelRuntimeConfiguration = () => {
    if (input.channelRouterEnabled) {
      input.logger.info("channel-router", `enabled (config: ${input.channelRouterConfigPath}, defaultAgent: ${input.channelRouterDefaultAgentId})`);
    } else {
      input.logger.info("channel-router", `manual rules disabled; security fallback config: ${input.channelSecurityConfigPath}`);
    }
    input.logger.info("channel-chunking", `runtime strategy config: ${input.channelReplyChunkingConfigPath}`);
  };

  const startChannels = async (): Promise<void> => {
    if (channelsConfigured) return;
    if (stopChannelsPromise) {
      await stopChannelsPromise;
    }
    channelsConfigured = true;
    let feishuChannel: FeishuChannel | undefined;
    if (input.feishuAppId && input.feishuAppSecret && input.createAgent) {
      try {
        const agent = (input.agentRegistry && input.feishuAgentId)
          ? input.agentRegistry.create(input.feishuAgentId)
          : input.createAgent();
        feishuChannel = new FeishuChannel({
          appId: input.feishuAppId,
          appSecret: input.feishuAppSecret,
          agent,
          agentId: input.feishuAgentId,
          defaultAgentId: input.channelRouterDefaultAgentId,
          router: channelRouter,
          replyChunkingConfig: channelReplyChunkingConfig,
          currentConversationBindingStore: input.currentConversationBindingStore,
          agentResolver: resolveChannelAgent,
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
          conversationStore: input.conversationStore,
          conversationLifecycle,
          sttTranscribe: async (opts) => {
            const result = await input.sttTranscribe(opts);
            if (result) input.logger.info("feishu", `Transcribed audio (${result.durationSec?.toFixed(1) ?? "?"}s) from ${result.provider}`);
            return result;
          },
        });
        await registerManagedChannel("feishu", feishuChannel);
        startManagedChannel("feishu", feishuChannel);
      } catch {
        input.logger.warn("feishu", "Agent creation failed (likely missing config), skipping Feishu startup.");
      }
    } else if ((input.feishuAppId || input.feishuAppSecret) && !input.createAgent) {
      input.logger.warn("feishu", "Credentials present but no Agent configured (provider not openai?), skipping.");
    }

    let qqChannel: QqChannel | undefined;
    if (input.qqAppId && input.qqAppSecret && input.createAgent) {
      try {
        const agent = (input.agentRegistry && input.qqAgentId)
          ? input.agentRegistry.create(input.qqAgentId)
          : input.createAgent();
        const qqChannelConfig = {
          appId: input.qqAppId,
          appSecret: input.qqAppSecret,
          sandbox: input.qqSandbox,
          agent,
          agentId: input.qqAgentId,
          defaultAgentId: input.channelRouterDefaultAgentId,
          router: channelRouter,
          replyChunkingConfig: channelReplyChunkingConfig,
          currentConversationBindingStore: input.currentConversationBindingStore,
          ingressScheduler: channelIngressScheduler,
          agentResolver: resolveChannelAgent,
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
          conversationStore: input.conversationStore,
          conversationLifecycle,
          sttTranscribe: async (opts: TranscribeOptions) => {
            const result = await input.sttTranscribe(opts);
            if (result) input.logger.info("qq", `Transcribed audio (${result.durationSec?.toFixed(1) ?? "?"}s) from ${result.provider}`);
            return result;
          },
          eventSampleCapture: {
            enabled: String(input.readEnv("BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED") ?? "false").toLowerCase() === "true",
            dir: input.readEnv("BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR")?.trim()
              || path.join(input.stateDir, "tmp", "qq-event-samples"),
          },
        } as ConstructorParameters<typeof QqChannel>[0];
        qqChannel = new QqChannel(qqChannelConfig);
        await registerManagedChannel("qq", qqChannel);
        if (String(input.readEnv("BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED") ?? "false").toLowerCase() === "true") {
          input.logger.info("qq", `QQ event sample capture enabled: ${input.readEnv("BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR")?.trim() || path.join(input.stateDir, "tmp", "qq-event-samples")}`);
        }
        startManagedChannel("qq", qqChannel);
      } catch {
        input.logger.warn("qq", "Agent creation failed (likely missing config), skipping QQ startup.");
      }
    } else if ((input.qqAppId || input.qqAppSecret) && !input.createAgent) {
      input.logger.warn("qq", "Credentials present but no Agent configured, skipping.");
    }

    let discordChannel: DiscordChannel | undefined;
    if (input.discordEnabled && input.discordBotToken && input.createAgent) {
      try {
        discordChannel = new DiscordChannel({
          agent: input.createAgent(),
          botToken: input.discordBotToken,
          defaultAgentId: input.channelRouterDefaultAgentId,
          router: channelRouter,
          replyChunkingConfig: channelReplyChunkingConfig,
          currentConversationBindingStore: input.currentConversationBindingStore,
          ingressScheduler: channelIngressScheduler,
          agentResolver: resolveChannelAgent,
          conversationLifecycle,
          sttTranscribe: async (opts) => {
            const result = await input.sttTranscribe(opts);
            if (result) input.logger.info("discord", `Transcribed audio (${result.durationSec?.toFixed(1) ?? "?"}s) from ${result.provider}`);
            return result;
          },
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
        });
        await registerManagedChannel("discord", discordChannel);
        startManagedChannel("discord", discordChannel);
        input.logger.info("discord", "Discord channel initialized");
      } catch (error) {
        input.logger.warn("discord", "Failed to initialize Discord channel", error);
      }
    } else if (input.discordEnabled && !input.discordBotToken) {
      input.logger.warn("discord", "Discord enabled but BELLDANDY_DISCORD_BOT_TOKEN not set, skipping.");
    } else if (input.discordEnabled && !input.createAgent) {
      input.logger.warn("discord", "Discord enabled but no Agent configured, skipping.");
    }

    try {
      const communityConfigPath = getCommunityConfigPath();
      if (fs.existsSync(communityConfigPath) && input.createAgent) {
        const communityConfig = loadCommunityConfig();
        const communityOwnerUserUuid = await extractOwnerUuid(input.stateDir);
        const communityTokenUsageStrictUuid = String(process.env.BELLDANDY_TOKEN_USAGE_STRICT_UUID ?? "false").toLowerCase() === "true";
        const communityTokenUsageUploadConfig: TokenUsageUploadConfig = {
          enabled: String(process.env.BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED ?? "false").toLowerCase() === "true",
          url: input.readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_URL")?.trim() || undefined,
          token:
            input.readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY")?.trim()
            || input.readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_TOKEN")?.trim()
            || undefined,
          timeoutMs: Number(input.readEnv("BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS") ?? "3000") || 3000,
        };
        if (communityTokenUsageUploadConfig.enabled && communityTokenUsageStrictUuid && !communityOwnerUserUuid) {
          input.logger.warn("community", "Token usage upload is enabled but owner UUID was not found in root IDENTITY.md; community uploads may fail when strict UUID validation is enabled.");
        }

        const communityChannel = new CommunityChannel({
          endpoint: communityConfig.endpoint,
          agents: communityConfig.agents,
          agent: input.createAgent(),
          conversationStore: input.conversationStore,
          defaultAgentId: input.channelRouterDefaultAgentId,
          router: channelRouter,
          replyChunkingConfig: channelReplyChunkingConfig,
          currentConversationBindingStore: input.currentConversationBindingStore,
          ingressScheduler: channelIngressScheduler,
          agentResolver: resolveChannelAgent,
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
          reconnect: communityConfig.reconnect,
          tokenUsageUpload: communityTokenUsageUploadConfig,
          ownerUserUuid: communityOwnerUserUuid,
          conversationLifecycle,
        });

        await registerManagedChannel("community", communityChannel);
        if (input.toolsEnabled) {
          input.toolExecutor.registerTool(createLeaveRoomTool(communityChannel), { origin: "channel", silentReplace: true });
          input.logger.info("community", "Registered leave_room tool with channel instance");
          input.toolExecutor.registerTool(createJoinRoomTool(communityChannel), { origin: "channel", silentReplace: true });
          input.logger.info("community", "Registered join_room tool with channel instance");
        }

        startManagedChannel("community", communityChannel);
        input.logger.info("community", `Started with ${communityConfig.agents.length} agent(s)`);
      }
    } catch (error) {
      input.logger.warn("community", "Failed to load community config, skipping startup:", error);
    }
  };

  const stopChannels = async (): Promise<void> => {
    if (stopChannelsPromise) {
      await stopChannelsPromise;
      return;
    }

    const stopPromise = (async () => {
      const entries = Array.from(managedChannels.entries());
      // Remove the send route before awaiting stop so background jobs cannot target an instance being drained.
      for (const [channelKind] of entries) {
        input.externalOutboundSenderRegistry.register(channelKind, undefined);
      }

      const failures: unknown[] = [];
      await Promise.all(entries.map(async ([channelKind, channel]) => {
        try {
          await channelManager.unregister(channel.name);
          if (managedChannels.get(channelKind) === channel) {
            managedChannels.delete(channelKind);
          }
        } catch (error) {
          failures.push(error);
          input.logger.error(channelKind, "Failed to stop managed channel", error);
        }
      }));
      await Promise.all(Array.from(backgroundStartTasks.values()));
      backgroundStartTasks.clear();

      if (failures.length > 0) {
        throw failures[0];
      }
      channelsConfigured = false;
    })();
    stopChannelsPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (stopChannelsPromise === stopPromise) {
        stopChannelsPromise = undefined;
      }
    }
  };

  return {
    channelRouter,
    channelReplyChunkingConfig,
    deliverToLatestBoundExternalChannel,
    recordChannelSecurityApprovalRequest,
    logChannelRuntimeConfiguration,
    startChannels,
    stopChannels,
    getRuntimeResourceQueueSnapshots: () => channelIngressScheduler.getRuntimeSnapshots(),
  };
}
