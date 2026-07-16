import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createChannelRouter } from "./index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("createChannelRouter", () => {
  it("keeps channel security fallback active when manual rules are disabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-channel-router-"));
    tempDirs.push(stateDir);
    const securityConfigPath = path.join(stateDir, "channel-security.json");
    await fs.writeFile(securityConfigPath, JSON.stringify({
      channels: {
        discord: {
          dmPolicy: "allowlist",
          allowFrom: ["u-safe"],
        },
      },
    }, null, 2), "utf-8");

    const router = createChannelRouter({
      enabled: false,
      securityConfigPath,
      defaultAgentId: "default",
    });

    expect(router.decide({
      channel: "discord",
      chatKind: "dm",
      chatId: "dm-1",
      text: "hello",
      senderId: "u-blocked",
    })).toEqual({
      allow: false,
      reason: "channel_security:dm_allowlist_blocked",
    });

    expect(router.decide({
      channel: "discord",
      chatKind: "dm",
      chatId: "dm-1",
      text: "hello",
      senderId: "u-safe",
    })).toEqual({
      allow: true,
      reason: "channel_security:dm_allowlist",
      agentId: "default",
    });
  });

  it("fails closed for an enabled security-backed channel when its policy is unavailable", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-channel-router-"));
    tempDirs.push(stateDir);
    const router = createChannelRouter({
      enabled: false,
      securityConfigPath: path.join(stateDir, "missing-channel-security.json"),
      requiredSecurityChannels: ["discord"],
      defaultAgentId: "default",
    });

    expect(router.admitIngress?.({
      channel: "discord",
      chatKind: "dm",
      chatId: "dm-1",
      text: "",
      senderId: "u-blocked",
    })).toEqual({
      allow: false,
      reason: "channel_security:config_unavailable",
    });
  });

  it("does not let a permissive routing rule bypass an ingress security rejection", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-channel-router-"));
    tempDirs.push(stateDir);
    const securityConfigPath = path.join(stateDir, "channel-security.json");
    const routerConfigPath = path.join(stateDir, "router.json");
    await fs.writeFile(securityConfigPath, JSON.stringify({
      channels: { discord: { dmPolicy: "allowlist", allowFrom: ["u-safe"] } },
    }), "utf-8");
    await fs.writeFile(routerConfigPath, JSON.stringify({
      rules: [{ id: "allow-all", enabled: true, priority: 1, action: { allow: true } }],
    }), "utf-8");

    const router = createChannelRouter({
      enabled: true,
      configPath: routerConfigPath,
      securityConfigPath,
      requiredSecurityChannels: ["discord"],
    });
    expect(router.decide({
      channel: "discord",
      chatKind: "dm",
      chatId: "dm-1",
      text: "hello",
      senderId: "u-blocked",
    })).toEqual({
      allow: false,
      reason: "channel_security:dm_allowlist_blocked",
    });
  });
});
