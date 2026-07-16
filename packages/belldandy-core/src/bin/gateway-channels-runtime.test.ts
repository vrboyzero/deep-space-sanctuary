import { expect, test } from "vitest";

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
