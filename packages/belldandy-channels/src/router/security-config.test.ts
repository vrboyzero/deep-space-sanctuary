import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateChannelSecurityPolicy,
  loadChannelSecurityConfig,
  loadChannelSecurityConfigResult,
  normalizeChannelSecurityConfig,
  resolveChannelSecurityConfigPath,
} from "./security-config.js";
import type { RouteContext } from "./types.js";

const tempDirs: string[] = [];

function makeContext(partial: Partial<RouteContext> = {}): RouteContext {
  return {
    channel: "discord",
    chatKind: "channel",
    chatId: "room-1",
    text: "hello world",
    senderId: "u-1",
    ...partial,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("channel security config", () => {
  it("normalizes channel policies and mentionRequired shorthands", () => {
    expect(normalizeChannelSecurityConfig({
      channels: {
        discord: {
          dmPolicy: "allowlist",
          allowFrom: [" 123 ", "", "123", "456"],
          mentionRequired: ["channel", "room"],
          accounts: {
            " personal ": {
              allowFrom: [" 789 ", "789"],
            },
          },
        },
      },
    })).toEqual({
      version: 1,
      channels: {
        discord: {
          dmPolicy: "allowlist",
          allowFrom: ["123", "456"],
          mentionRequired: {
            group: false,
            channel: true,
            room: true,
          },
          accounts: {
            personal: {
              allowFrom: ["789"],
            },
          },
        },
      },
    });
  });

  it("loads channel-security.json from the state dir path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-channel-security-"));
    tempDirs.push(dir);
    const filePath = resolveChannelSecurityConfigPath(dir);
    await fs.writeFile(filePath, JSON.stringify({
      channels: {
        feishu: {
          dmPolicy: "allowlist",
          allowFrom: ["ou_123"],
          mentionRequired: true,
        },
      },
    }, null, 2), "utf-8");

    expect(loadChannelSecurityConfig(filePath)).toEqual({
      version: 1,
      channels: {
        feishu: {
          dmPolicy: "allowlist",
          allowFrom: ["ou_123"],
          mentionRequired: {
            group: true,
            channel: true,
            room: true,
          },
        },
      },
    });
  });

  it("reports missing and malformed security configuration without silently treating it as loaded", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-channel-security-"));
    tempDirs.push(dir);
    const filePath = resolveChannelSecurityConfigPath(dir);

    expect(loadChannelSecurityConfigResult(filePath)).toMatchObject({ status: "missing", config: { channels: {} } });
    await fs.writeFile(filePath, "{invalid", "utf-8");
    expect(loadChannelSecurityConfigResult(filePath)).toMatchObject({ status: "invalid", config: { channels: {} } });
  });

  it("blocks DMs from unknown senders when dmPolicy is allowlist", () => {
    const config = normalizeChannelSecurityConfig({
      channels: {
        discord: {
          dmPolicy: "allowlist",
          allowFrom: ["u-allowed"],
        },
      },
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      chatKind: "dm",
      senderId: "u-blocked",
    }))).toEqual({
      allow: false,
      reason: "channel_security:dm_allowlist_blocked",
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      chatKind: "dm",
      senderId: "u-allowed",
    }))).toEqual({
      allow: true,
      reason: "channel_security:dm_allowlist",
    });
  });

  it("blocks non-mentioned group messages when mentionRequired is enabled", () => {
    const config = normalizeChannelSecurityConfig({
      channels: {
        qq: {
          mentionRequired: {
            group: true,
          },
        },
      },
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      channel: "qq",
      chatKind: "group",
      mentioned: false,
      mentions: [],
    }))).toEqual({
      allow: false,
      reason: "channel_security:mention_required_blocked",
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      channel: "qq",
      chatKind: "group",
      mentioned: true,
      mentions: ["__mention__"],
    }))).toEqual({
      allow: true,
      reason: "channel_security:mention_required",
    });
  });

  it("resolves per-account overrides for the same channel", () => {
    const config = normalizeChannelSecurityConfig({
      channels: {
        community: {
          mentionRequired: {
            room: true,
          },
          accounts: {
            alpha: {
              dmPolicy: "allowlist",
              allowFrom: ["user-alpha"],
            },
            beta: {
              allowFrom: ["user-beta"],
              mentionRequired: {
                room: false,
              },
            },
          },
        },
      },
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      channel: "community",
      accountId: "alpha",
      chatKind: "dm",
      senderId: "user-alpha",
    }))).toEqual({
      allow: true,
      reason: "channel_security:dm_allowlist",
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      channel: "community",
      accountId: "alpha",
      chatKind: "dm",
      senderId: "user-other",
    }))).toEqual({
      allow: false,
      reason: "channel_security:dm_allowlist_blocked",
    });

    expect(evaluateChannelSecurityPolicy(config, makeContext({
      channel: "community",
      accountId: "beta",
      chatKind: "room",
      mentioned: false,
      mentions: [],
    }))).toBeNull();
  });
});
