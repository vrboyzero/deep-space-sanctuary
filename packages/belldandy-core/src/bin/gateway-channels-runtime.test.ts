import { expect, test, vi } from "vitest";

const channelMocks = vi.hoisted(() => {
  const discordInstances: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const discordConfigs: unknown[] = [];
  const qqConfigs: unknown[] = [];
  const feishuConfigs: unknown[] = [];
  class DiscordChannel {
    readonly name = "discord";
    isRunning = false;
    lifecycleState: "stopped" | "running" = "stopped";
    readonly start = vi.fn(async () => {
      this.isRunning = true;
      this.lifecycleState = "running" as const;
    });
    readonly stop = vi.fn(async () => {
      this.isRunning = false;
      this.lifecycleState = "stopped" as const;
    });
    async sendProactiveMessage() {
      return true;
    }

    constructor(config: unknown) {
      discordInstances.push(this);
      discordConfigs.push(config);
    }
  }
  class QqChannel {
    readonly name = "qq";
    isRunning = false;
    lifecycleState: "stopped" | "running" = "stopped";
    readonly start = vi.fn(async () => {
      this.isRunning = true;
      this.lifecycleState = "running" as const;
    });
    readonly stop = vi.fn(async () => {
      this.isRunning = false;
      this.lifecycleState = "stopped" as const;
    });
    async sendProactiveMessage() {
      return true;
    }

    constructor(config: unknown) {
      qqConfigs.push(config);
    }
  }
  class FeishuChannel {
    readonly name = "feishu";
    isRunning = false;
    lifecycleState: "stopped" | "running" = "stopped";
    readonly start = vi.fn(async () => {
      this.isRunning = true;
      this.lifecycleState = "running" as const;
    });
    readonly stop = vi.fn(async () => {
      this.isRunning = false;
      this.lifecycleState = "stopped" as const;
    });
    async sendProactiveMessage() {
      return true;
    }

    constructor(config: unknown) {
      feishuConfigs.push(config);
    }
  }
  return {
    DiscordChannel,
    QqChannel,
    FeishuChannel,
    discordInstances,
    discordConfigs,
    qqConfigs,
    feishuConfigs,
  };
});

vi.mock("@belldandy/channels", async () => {
  const actual = await vi.importActual<typeof import("@belldandy/channels")>("@belldandy/channels");
  return {
    ...actual,
    DiscordChannel: channelMocks.DiscordChannel,
    QqChannel: channelMocks.QqChannel,
    FeishuChannel: channelMocks.FeishuChannel,
  };
});

import { createGatewayChannelsRuntime } from "./gateway-channels-runtime.js";

test("gateway channel runtime exposes the configured shared ingress scheduler snapshot", () => {
  const values: Record<string, string> = {
    BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT: "3",
    BELLDANDY_CHANNEL_INGRESS_MAX_CONCURRENT_PER_CHANNEL: "1",
    BELLDANDY_CHANNEL_INGRESS_MAX_PENDING_PER_SESSION: "7",
    BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED: "21",
    BELLDANDY_CHANNEL_INGRESS_MAX_WAIT_MS: "45000",
    BELLDANDY_CHANNEL_INGRESS_MAX_PAYLOAD_BYTES: "4096",
    BELLDANDY_CHANNEL_INGRESS_MAX_QUEUED_PAYLOAD_BYTES: "8192",
  };
  const runtime = createGatewayChannelsRuntime({
    stateDir: "state-dir",
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    channelRouterEnabled: false,
    channelRouterConfigPath: "channels-routing.json",
    channelRouterDefaultAgentId: "default",
    channelSecurityConfigPath: "channel-security.json",
    channelReplyChunkingConfigPath: "channel-reply-chunking.json",
    conversationStore: {} as any,
    currentConversationBindingStore: {} as any,
    externalOutboundSenderRegistry: {} as any,
    toolsEnabled: false,
    toolExecutor: {} as any,
    sttTranscribe: async () => null,
    qqSandbox: true,
    discordEnabled: false,
    readEnv: (name) => values[name],
  });

  expect(runtime.getRuntimeResourceQueueSnapshots()).toEqual([
    {
      id: "channel_ingress",
      activeCount: 0,
      queuedCount: 0,
      capacity: 3,
      oldestWaitMs: 0,
      rejectedCount: 0,
      aggregate: true,
    },
  ]);
});

test("gateway channel runtime injects configurable Feishu HTTP limits", async () => {
  channelMocks.feishuConfigs.length = 0;
  const values: Record<string, string> = {
    BELLDANDY_FEISHU_JSON_MAX_RESPONSE_BYTES: "2097152",
    BELLDANDY_FEISHU_RESOURCE_MAX_RESPONSE_BYTES: "41943040",
    BELLDANDY_FEISHU_HTTP_IDLE_TIMEOUT_MS: "45000",
  };
  const runtime = createGatewayChannelsRuntime({
    stateDir: "state-dir",
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    channelRouterEnabled: false,
    channelRouterConfigPath: "channels-routing.json",
    channelRouterDefaultAgentId: "default",
    channelSecurityConfigPath: "channel-security.json",
    channelReplyChunkingConfigPath: "channel-reply-chunking.json",
    createAgent: () => ({}) as any,
    conversationStore: {} as any,
    currentConversationBindingStore: {} as any,
    externalOutboundSenderRegistry: { register: vi.fn() } as any,
    toolsEnabled: false,
    toolExecutor: {} as any,
    sttTranscribe: async () => null,
    feishuAppId: "feishu-app-id",
    feishuAppSecret: "feishu-app-secret",
    qqSandbox: true,
    discordEnabled: false,
    readEnv: (name) => values[name],
  });

  await runtime.startChannels();

  expect(channelMocks.feishuConfigs).toHaveLength(1);
  expect(channelMocks.feishuConfigs[0]).toEqual(expect.objectContaining({
    restJsonMaxResponseBytes: 2_097_152,
    resourceMaxResponseBytes: 41_943_040,
    restIdleTimeoutMs: 45_000,
  }));
  await runtime.stopChannels();
});

test("gateway channel runtime drains managed channels and removes their external sender", async () => {
  channelMocks.discordInstances.length = 0;
  channelMocks.discordConfigs.length = 0;
  const externalOutboundSenderRegistry = {
    register: vi.fn(),
  };
  const runtime = createGatewayChannelsRuntime({
    stateDir: "state-dir",
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    channelRouterEnabled: false,
    channelRouterConfigPath: "channels-routing.json",
    channelRouterDefaultAgentId: "default",
    channelSecurityConfigPath: "channel-security.json",
    channelReplyChunkingConfigPath: "channel-reply-chunking.json",
    createAgent: () => ({}) as any,
    conversationStore: {} as any,
    currentConversationBindingStore: {} as any,
    externalOutboundSenderRegistry: externalOutboundSenderRegistry as any,
    toolsEnabled: false,
    toolExecutor: {} as any,
    sttTranscribe: async () => null,
    qqSandbox: true,
    discordEnabled: true,
    discordBotToken: "discord-token",
    readEnv: () => undefined,
  });

  await runtime.startChannels();
  const channel = channelMocks.discordInstances[0];
  expect(channel?.start).toHaveBeenCalledTimes(1);
  expect(externalOutboundSenderRegistry.register).toHaveBeenCalledWith("discord", channel);

  await runtime.stopChannels();

  expect(channel?.stop).toHaveBeenCalledTimes(1);
  expect(externalOutboundSenderRegistry.register).toHaveBeenLastCalledWith("discord", undefined);
});

test("gateway channel runtime injects the shared conversation lifecycle into QQ", async () => {
  channelMocks.qqConfigs.length = 0;
  const runtime = createGatewayChannelsRuntime({
    stateDir: "state-dir",
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    channelRouterEnabled: false,
    channelRouterConfigPath: "channels-routing.json",
    channelRouterDefaultAgentId: "default",
    channelSecurityConfigPath: "channel-security.json",
    channelReplyChunkingConfigPath: "channel-reply-chunking.json",
    createAgent: () => ({}) as any,
    conversationStore: {} as any,
    topLevelConversationLifecycle: {} as any,
    currentConversationBindingStore: {} as any,
    externalOutboundSenderRegistry: { register: vi.fn() } as any,
    toolsEnabled: false,
    toolExecutor: {} as any,
    sttTranscribe: async () => null,
    qqAppId: "qq-app-id",
    qqAppSecret: "qq-app-secret",
    qqSandbox: true,
    discordEnabled: false,
    readEnv: () => undefined,
  });

  await runtime.startChannels();

  expect(channelMocks.qqConfigs).toHaveLength(1);
  expect(channelMocks.qqConfigs[0]).toEqual(expect.objectContaining({
    conversationLifecycle: expect.objectContaining({
      acquire: expect.any(Function),
    }),
  }));
  await runtime.stopChannels();
});

test("gateway channel runtime injects the shared conversation lifecycle into Discord", async () => {
  channelMocks.discordInstances.length = 0;
  channelMocks.discordConfigs.length = 0;
  const runtime = createGatewayChannelsRuntime({
    stateDir: "state-dir",
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    channelRouterEnabled: false,
    channelRouterConfigPath: "channels-routing.json",
    channelRouterDefaultAgentId: "default",
    channelSecurityConfigPath: "channel-security.json",
    channelReplyChunkingConfigPath: "channel-reply-chunking.json",
    createAgent: () => ({}) as any,
    conversationStore: {} as any,
    topLevelConversationLifecycle: {} as any,
    currentConversationBindingStore: {} as any,
    externalOutboundSenderRegistry: { register: vi.fn() } as any,
    toolsEnabled: false,
    toolExecutor: {} as any,
    sttTranscribe: async () => null,
    qqSandbox: true,
    discordEnabled: true,
    discordBotToken: "discord-token",
    readEnv: () => undefined,
  });

  await runtime.startChannels();

  expect(channelMocks.discordConfigs).toHaveLength(1);
  expect(channelMocks.discordConfigs[0]).toEqual(expect.objectContaining({
    conversationLifecycle: expect.objectContaining({
      acquire: expect.any(Function),
    }),
  }));
  await runtime.stopChannels();
});

test("gateway channel runtime injects configurable Discord REST limits", async () => {
  channelMocks.discordInstances.length = 0;
  channelMocks.discordConfigs.length = 0;
  const values: Record<string, string> = {
    BELLDANDY_DISCORD_REST_MAX_RESPONSE_BYTES: "2097152",
    BELLDANDY_DISCORD_REST_TIMEOUT_MS: "45000",
  };
  const runtime = createGatewayChannelsRuntime({
    stateDir: "state-dir",
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    channelRouterEnabled: false,
    channelRouterConfigPath: "channels-routing.json",
    channelRouterDefaultAgentId: "default",
    channelSecurityConfigPath: "channel-security.json",
    channelReplyChunkingConfigPath: "channel-reply-chunking.json",
    createAgent: () => ({}) as any,
    conversationStore: {} as any,
    currentConversationBindingStore: {} as any,
    externalOutboundSenderRegistry: { register: vi.fn() } as any,
    toolsEnabled: false,
    toolExecutor: {} as any,
    sttTranscribe: async () => null,
    qqSandbox: true,
    discordEnabled: true,
    discordBotToken: "discord-token",
    readEnv: (name) => values[name],
  });

  await runtime.startChannels();

  expect(channelMocks.discordConfigs).toHaveLength(1);
  expect(channelMocks.discordConfigs[0]).toEqual(expect.objectContaining({
    restMaxResponseBytes: 2_097_152,
    restTimeoutMs: 45_000,
  }));
  await runtime.stopChannels();
});
