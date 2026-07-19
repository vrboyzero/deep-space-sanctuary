import { describe, expect, it, vi } from "vitest";

import type { Channel } from "@belldandy/channels";

import { ExternalOutboundSenderRegistry } from "./external-outbound-sender-registry.js";

function createChannel(): Channel {
  return {
    name: "mock",
    isRunning: true,
    lifecycleState: "running",
    async start() {},
    async stop() {},
    async sendProactiveMessage() {
      return true;
    },
  };
}

describe("external outbound sender registry", () => {
  it("resolves latest binding for a channel", async () => {
    const registry = new ExternalOutboundSenderRegistry({
      async get() {
        return undefined;
      },
      async getLatestByChannel() {
        return {
          channel: "feishu",
          sessionKey: "channel=feishu:chat=chat-1",
          sessionScope: "per-chat",
          legacyConversationId: "legacy-1",
          chatKind: "dm",
          chatId: "chat-1",
          updatedAt: Date.now(),
          target: { chatId: "chat-1" },
        };
      },
    });
    registry.register("feishu", createChannel());

    const result = await registry.resolveTarget({ channel: "feishu" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolution).toBe("latest_binding");
    expect(result.resolvedSessionKey).toBe("channel=feishu:chat=chat-1");
    expect(result.targetChatId).toBe("chat-1");
  });

  it("rejects explicit sessionKey when channel mismatches", async () => {
    const registry = new ExternalOutboundSenderRegistry({
      async get() {
        return {
          channel: "qq",
          sessionKey: "channel=qq:chat=chat-1",
          sessionScope: "per-chat",
          legacyConversationId: "legacy-1",
          chatKind: "dm",
          chatId: "chat-1",
          updatedAt: Date.now(),
          target: { chatId: "chat-1" },
        };
      },
      async getLatestByChannel() {
        return undefined;
      },
    });
    registry.register("feishu", createChannel());

    const result = await registry.resolveTarget({
      channel: "feishu",
      sessionKey: "channel=qq:chat=chat-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_target");
  });

  it("resolves the first preferred channel with a latest binding", async () => {
    const registry = new ExternalOutboundSenderRegistry({
      async get() {
        return undefined;
      },
      async getLatestByChannel(input) {
        if (input.channel === "qq") {
          return {
            channel: "qq",
            sessionKey: "channel=qq:chat=chat-2",
            sessionScope: "per-chat",
            legacyConversationId: "legacy-2",
            chatKind: "dm",
            chatId: "chat-2",
            updatedAt: Date.now(),
            target: { chatId: "chat-2" },
          };
        }
        return undefined;
      },
    });
    registry.register("feishu", createChannel());
    registry.register("qq", createChannel());

    const result = await registry.resolvePreferredLatestTarget(["feishu", "qq", "discord"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.channel).toBe("qq");
    expect(result.resolvedSessionKey).toBe("channel=qq:chat=chat-2");
    expect(result.attemptedChannels).toEqual(["feishu", "qq", "discord"]);
  });

  it("reports unavailable preferred channels when none are registered", async () => {
    const registry = new ExternalOutboundSenderRegistry({
      async get() {
        return undefined;
      },
      async getLatestByChannel() {
        return undefined;
      },
    });

    const result = await registry.resolvePreferredLatestTarget(["feishu", "qq"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("channel_unavailable");
    expect(result.attemptedChannels).toEqual(["feishu", "qq"]);
  });

  it("forwards an explicit idempotency key to the managed channel", async () => {
    const sendProactiveMessage = vi.fn(async () => true);
    const registry = new ExternalOutboundSenderRegistry({
      async get() {
        return undefined;
      },
      async getLatestByChannel() {
        return undefined;
      },
    });
    registry.register("feishu", {
      ...createChannel(),
      sendProactiveMessage,
    });

    const result = await registry.sendResolvedText({
      channel: "feishu",
      content: "hello",
      resolvedSessionKey: "channel=feishu:chat=chat-1",
      idempotencyKey: "OUTBOUND-1",
    });

    expect(result.ok).toBe(true);
    expect(sendProactiveMessage).toHaveBeenCalledWith(
      "hello",
      { sessionKey: "channel=feishu:chat=chat-1" },
      { idempotencyKey: "OUTBOUND-1" },
    );
  });
});
