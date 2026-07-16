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
  CommunityChannel,
  createChannelRouter,
  DiscordChannel,
  FeishuChannel,
  getCommunityConfigPath,
  loadCommunityConfig,
  loadReplyChunkingConfig,
  QqChannel,
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
import type { ExternalOutboundSenderRegistry } from "../external-outbound-sender-registry.js";

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

export function createGatewayChannelsRuntime(input: GatewayChannelsRuntimeInput) {
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
          sttTranscribe: async (opts) => {
            const result = await input.sttTranscribe(opts);
            if (result) input.logger.info("feishu", `Transcribed audio (${result.durationSec?.toFixed(1) ?? "?"}s) from ${result.provider}`);
            return result;
          },
        });
        input.externalOutboundSenderRegistry.register("feishu", feishuChannel);
        feishuChannel.start().catch((error: unknown) => {
          input.logger.error("feishu", "Channel Error", error);
        });
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
          agentResolver: resolveChannelAgent,
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
          conversationStore: input.conversationStore,
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
        input.externalOutboundSenderRegistry.register("qq", qqChannel);
        if (String(input.readEnv("BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_ENABLED") ?? "false").toLowerCase() === "true") {
          input.logger.info("qq", `QQ event sample capture enabled: ${input.readEnv("BELLDANDY_QQ_EVENT_SAMPLE_CAPTURE_DIR")?.trim() || path.join(input.stateDir, "tmp", "qq-event-samples")}`);
        }
        qqChannel.start().catch((error: unknown) => {
          input.logger.error("qq", "Channel Error", error);
        });
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
          agentResolver: resolveChannelAgent,
          sttTranscribe: async (opts) => {
            const result = await input.sttTranscribe(opts);
            if (result) input.logger.info("discord", `Transcribed audio (${result.durationSec?.toFixed(1) ?? "?"}s) from ${result.provider}`);
            return result;
          },
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
        });
        input.externalOutboundSenderRegistry.register("discord", discordChannel);
        discordChannel.start().catch((error: unknown) => {
          input.logger.error("discord", "Channel Error", error);
        });
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
          agentResolver: resolveChannelAgent,
          onChannelSecurityApprovalRequired: recordChannelSecurityApprovalRequest,
          reconnect: communityConfig.reconnect,
          tokenUsageUpload: communityTokenUsageUploadConfig,
          ownerUserUuid: communityOwnerUserUuid,
        });

        input.externalOutboundSenderRegistry.register("community", communityChannel);
        if (input.toolsEnabled) {
          input.toolExecutor.registerTool(createLeaveRoomTool(communityChannel), { origin: "channel", silentReplace: true });
          input.logger.info("community", "Registered leave_room tool with channel instance");
          input.toolExecutor.registerTool(createJoinRoomTool(communityChannel), { origin: "channel", silentReplace: true });
          input.logger.info("community", "Registered join_room tool with channel instance");
        }

        communityChannel.start().catch((error: unknown) => {
          input.logger.error("community", "Channel Error", error);
        });
        input.logger.info("community", `Started with ${communityConfig.agents.length} agent(s)`);
      }
    } catch (error) {
      input.logger.warn("community", "Failed to load community config, skipping startup:", error);
    }
  };

  return {
    channelRouter,
    channelReplyChunkingConfig,
    deliverToLatestBoundExternalChannel,
    recordChannelSecurityApprovalRequest,
    logChannelRuntimeConfiguration,
    startChannels,
  };
}
