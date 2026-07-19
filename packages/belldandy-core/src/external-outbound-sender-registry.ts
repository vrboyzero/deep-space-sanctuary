import type {
  Channel,
  CurrentConversationBindingRecord,
  CurrentConversationBindingStore,
} from "@belldandy/channels";

export type ExternalOutboundChannel = "feishu" | "qq" | "discord" | "community";
export type ExternalOutboundResolutionMode = "explicit_session_key" | "latest_binding";

export type ExternalOutboundResolveResult =
  | {
    ok: true;
    channel: ExternalOutboundChannel;
    resolution: ExternalOutboundResolutionMode;
    binding: CurrentConversationBindingRecord;
    resolvedSessionKey: string;
    targetChatId?: string;
    targetAccountId?: string;
  }
  | {
    ok: false;
    channel: ExternalOutboundChannel;
    code: "channel_unavailable" | "binding_not_found" | "invalid_target";
    message: string;
  };

export type ExternalOutboundSendResult =
  | {
    ok: true;
    channel: ExternalOutboundChannel;
    resolvedSessionKey: string;
  }
  | {
    ok: false;
    channel: ExternalOutboundChannel;
    code: "channel_unavailable" | "content_required" | "send_failed";
    message: string;
  };

export type ExternalOutboundPreferredResolveResult =
  | ExternalOutboundResolveResult & { attemptedChannels: ExternalOutboundChannel[] }
  | {
    ok: false;
    code: "channel_unavailable" | "binding_not_found";
    message: string;
    attemptedChannels: ExternalOutboundChannel[];
  };

type BindingStoreLike = Pick<CurrentConversationBindingStore, "get" | "getLatestByChannel">;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickTargetChatId(binding: CurrentConversationBindingRecord): string | undefined {
  return normalizeString(
    binding.target.chatId
    || binding.target.channelId
    || binding.target.roomId
    || binding.chatId,
  ) || undefined;
}

function pickTargetAccountId(binding: CurrentConversationBindingRecord): string | undefined {
  return normalizeString(binding.target.accountId || binding.accountId) || undefined;
}

export class ExternalOutboundSenderRegistry {
  private readonly senders = new Map<ExternalOutboundChannel, Channel>();

  constructor(private readonly bindingStore: BindingStoreLike) {}

  register(channel: ExternalOutboundChannel, sender?: Channel): void {
    if (!sender) {
      this.senders.delete(channel);
      return;
    }
    this.senders.set(channel, sender);
  }

  has(channel: ExternalOutboundChannel): boolean {
    return this.senders.has(channel);
  }

  async resolveTarget(input: {
    channel: ExternalOutboundChannel;
    sessionKey?: string;
  }): Promise<ExternalOutboundResolveResult> {
    const channel = input.channel;
    if (!this.has(channel)) {
      return {
        ok: false,
        channel,
        code: "channel_unavailable",
        message: `目标渠道当前不可用: ${channel}`,
      };
    }

    const explicitSessionKey = normalizeString(input.sessionKey);
    if (explicitSessionKey) {
      const binding = await this.bindingStore.get(explicitSessionKey);
      if (!binding) {
        return {
          ok: false,
          channel,
          code: "binding_not_found",
          message: `未找到 sessionKey 对应的当前会话绑定: ${explicitSessionKey}`,
        };
      }
      if (binding.channel !== channel) {
        return {
          ok: false,
          channel,
          code: "invalid_target",
          message: `sessionKey 绑定的渠道为 ${binding.channel}，与目标渠道 ${channel} 不一致。`,
        };
      }
      return {
        ok: true,
        channel,
        resolution: "explicit_session_key",
        binding,
        resolvedSessionKey: binding.sessionKey,
        targetChatId: pickTargetChatId(binding),
        targetAccountId: pickTargetAccountId(binding),
      };
    }

    const binding = await this.bindingStore.getLatestByChannel({ channel });
    if (!binding) {
      return {
        ok: false,
        channel,
        code: "binding_not_found",
        message: `当前没有可用于 ${channel} 的最新会话绑定，请先在目标渠道产生一条会话。`,
      };
    }
    return {
      ok: true,
      channel,
      resolution: "latest_binding",
      binding,
      resolvedSessionKey: binding.sessionKey,
      targetChatId: pickTargetChatId(binding),
      targetAccountId: pickTargetAccountId(binding),
    };
  }

  async resolvePreferredLatestTarget(
    channels: ExternalOutboundChannel[],
  ): Promise<ExternalOutboundPreferredResolveResult> {
    const attemptedChannels = Array.from(new Set(channels.filter((channel) => Boolean(channel))));
    let hasAvailableChannel = false;
    for (const channel of attemptedChannels) {
      const result = await this.resolveTarget({ channel });
      if (result.ok) {
        return {
          ...result,
          attemptedChannels,
        };
      }
      if (result.code === "channel_unavailable") {
        continue;
      }
      hasAvailableChannel = true;
    }
    return {
      ok: false,
      code: hasAvailableChannel ? "binding_not_found" : "channel_unavailable",
      message: hasAvailableChannel
        ? `当前没有可用于这些渠道的最新会话绑定: ${attemptedChannels.join(", ")}`
        : `这些目标渠道当前均不可用: ${attemptedChannels.join(", ")}`,
      attemptedChannels,
    };
  }

  async sendResolvedText(input: {
    channel: ExternalOutboundChannel;
    content: string;
    resolvedSessionKey: string;
    idempotencyKey?: string;
  }): Promise<ExternalOutboundSendResult> {
    const channel = input.channel;
    const sender = this.senders.get(channel);
    if (!sender) {
      return {
        ok: false,
        channel,
        code: "channel_unavailable",
        message: `目标渠道当前不可用: ${channel}`,
      };
    }
    const content = normalizeString(input.content);
    if (!content) {
      return {
        ok: false,
        channel,
        code: "content_required",
        message: "发送内容不能为空。",
      };
    }
    const resolvedSessionKey = normalizeString(input.resolvedSessionKey);
    const idempotencyKey = normalizeString(input.idempotencyKey);
    const sent = idempotencyKey
      ? await sender.sendProactiveMessage(content, { sessionKey: resolvedSessionKey }, { idempotencyKey })
      : await sender.sendProactiveMessage(content, { sessionKey: resolvedSessionKey });
    if (!sent) {
      return {
        ok: false,
        channel,
        code: "send_failed",
        message: `渠道 ${channel} 外发失败，目标可能已失效或当前连接不可用。`,
      };
    }
    return {
      ok: true,
      channel,
      resolvedSessionKey,
    };
  }
}
