import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, expect, test } from "vitest";
import WebSocket from "ws";

import { type BelldandyAgent, MockAgent } from "@belldandy/agent";
import {
  ToolExecutor,
  createToolSettingsControlTool,
  TOOL_SETTINGS_CONTROL_NAME,
} from "@belldandy/skills";

import { upsertChannelSecurityApprovalRequest } from "./channel-security-store.js";
import { startGatewayServer } from "./server.js";
import {
  cleanupGlobalMemoryManagersForTest,
  createTestTool,
  pairWebSocketClient,
  resolveWebRoot,
  sleep,
  waitFor,
  withEnv,
} from "./server-testkit.js";
import { ToolControlConfirmationStore } from "./tool-control-confirmation-store.js";
import { ToolsConfigManager } from "./tools-config.js";
import { clearAutoTaskReportsForTest } from "./task-auto-report.js";
import { IdempotencyManager } from "./webhook/index.js";

// MemoryManager 内部会初始化 OpenAIEmbeddingProvider，需要 OPENAI_API_KEY
// 测试环境中设置一个占位值，避免构造函数抛错（不会实际调用 API）
beforeAll(() => {
  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "test-placeholder-key";
  }
});

afterEach(async () => {
  await cleanupGlobalMemoryManagersForTest();
  clearAutoTaskReportsForTest();
});

test("/api/message is disabled by default", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: undefined,
    BELLDANDY_COMMUNITY_API_TOKEN: undefined,
    BELLDANDY_AUTH_TOKEN: undefined,
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello", conversationId: "conv-1" }),
      });
      const payload = await res.json();
      expect(res.status).toBe(404);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("API_DISABLED");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/message rejects missing bearer token", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello", conversationId: "conv-2" }),
      });
      const payload = await res.json();
      expect(res.status).toBe(401);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("UNAUTHORIZED");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/message rejects wrong bearer token", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({ text: "hello", conversationId: "conv-3" }),
      });
      const payload = await res.json();
      expect(res.status).toBe(401);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("UNAUTHORIZED");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/message accepts valid bearer token", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-test-token",
        },
        body: JSON.stringify({
          text: "hello from community",
          conversationId: "conv-4",
          from: "office.goddess.ai",
          senderInfo: { id: "u-1", name: "tester", type: "user" },
          roomContext: { environment: "community", roomId: "room-1", members: [] },
        }),
      });
      const payload = await res.json();
      expect(res.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.payload?.conversationId).toBe("conv-4");
      expect(String(payload.payload?.response ?? "")).toContain("hello from community");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("api.message and webhook append auto task report summary when enabled", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
    BELLDANDY_AUTO_TASK_TIME_ENABLED: "true",
    BELLDANDY_AUTO_TASK_TOKEN_ENABLED: "true",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" as const };
        yield {
          type: "usage" as const,
          systemPromptTokens: 2,
          contextTokens: 4,
          inputTokens: 10,
          outputTokens: 6,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield { type: "final" as const, text: `echo:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    };

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
      webhookConfig: {
        version: 1,
        webhooks: [
          {
            id: "audit",
            enabled: true,
            token: "webhook-trace-token",
          },
        ],
      },
      webhookIdempotency: new IdempotencyManager(60_000),
    });

    try {
      const communityRes = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-test-token",
        },
        body: JSON.stringify({
          text: "hello from community",
          conversationId: "conv-http-auto-report",
          from: "office.goddess.ai",
        }),
      });
      const communityPayload = await communityRes.json();
      expect(communityRes.status).toBe(200);
      expect(String(communityPayload.payload?.response ?? "")).toContain("执行统计");
      expect(String(communityPayload.payload?.response ?? "")).toContain("- Token：IN 10 / OUT 6 / TOTAL 16");

      const webhookRes = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-trace-token",
        },
        body: JSON.stringify({
          text: "hello runtime webhook",
          conversationId: "conv-webhook-auto-report",
        }),
      });
      const webhookPayload = await webhookRes.json();
      expect(webhookRes.status).toBe(200);
      expect(String(webhookPayload.payload?.response ?? "")).toContain("执行统计");
      expect(String(webhookPayload.payload?.response ?? "")).toContain("- Token：IN 10 / OUT 6 / TOTAL 16");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("api.message strips think blocks from HTTP response", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const agent: BelldandyAgent = {
      async *run(input) {
        yield { type: "status", status: "running" as const };
        yield { type: "final" as const, text: `<think>secret:${input.text}</think>\n\necho:${input.text}` };
        yield { type: "status" as const, status: "done" };
      },
    };

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
    });

    try {
      const communityRes = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-test-token",
        },
        body: JSON.stringify({
          text: "隐藏推理",
          conversationId: "conv-http-strip-think",
          from: "office.goddess.ai",
        }),
      });
      const communityPayload = await communityRes.json();
      expect(communityRes.status).toBe(200);
      expect(String(communityPayload.payload?.response ?? "")).not.toContain("<think>");
      expect(String(communityPayload.payload?.response ?? "")).not.toContain("secret:隐藏推理");
      expect(String(communityPayload.payload?.response ?? "")).toContain("echo:隐藏推理");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/message applies community room mention gate with explicit accountId", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    await fs.promises.writeFile(path.join(stateDir, "channel-security.json"), JSON.stringify({
      channels: {
        community: {
          accounts: {
            alpha: {
              mentionRequired: {
                room: true,
              },
            },
          },
        },
      },
    }, null, 2), "utf-8");
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
      onChannelSecurityApprovalRequired: async (input) => {
        await upsertChannelSecurityApprovalRequest(stateDir, input);
      },
    });

    try {
      const blockedRes = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-test-token",
        },
        body: JSON.stringify({
          text: "hello room",
          conversationId: "conv-room-blocked",
          accountId: "alpha",
          senderInfo: { id: "u-room-1", name: "tester", type: "user" },
          roomContext: { environment: "community", roomId: "room-alpha", members: [] },
        }),
      });
      const blockedPayload = await blockedRes.json();
      expect(blockedRes.status).toBe(403);
      expect(blockedPayload.error?.code).toBe("CHANNEL_SECURITY_BLOCKED");

      const allowedRes = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-test-token",
        },
        body: JSON.stringify({
          text: "@alpha hello room",
          conversationId: "conv-room-allowed",
          accountId: "alpha",
          senderInfo: { id: "u-room-1", name: "tester", type: "user" },
          roomContext: { environment: "community", roomId: "room-alpha", members: [] },
        }),
      });
      const allowedPayload = await allowedRes.json();
      expect(allowedRes.status).toBe(200);
      expect(allowedPayload.ok).toBe(true);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/message records pending approval for community dm allowlist with explicit accountId", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-test-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    await fs.promises.writeFile(path.join(stateDir, "channel-security.json"), JSON.stringify({
      channels: {
        community: {
          accounts: {
            alpha: {
              dmPolicy: "allowlist",
              allowFrom: [],
            },
          },
        },
      },
    }, null, 2), "utf-8");
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
      onChannelSecurityApprovalRequired: async (input) => {
        await upsertChannelSecurityApprovalRequest(stateDir, input);
      },
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-test-token",
        },
        body: JSON.stringify({
          text: "hello dm",
          conversationId: "conv-dm-blocked",
          accountId: "alpha",
          senderInfo: { id: "u-dm-1", name: "tester", type: "user" },
        }),
      });
      const payload = await res.json();
      expect(res.status).toBe(403);
      expect(payload.error?.code).toBe("CHANNEL_SECURITY_BLOCKED");

      const pendingStore = JSON.parse(
        await fs.promises.readFile(path.join(stateDir, "channel-security-approvals.json"), "utf-8"),
      ) as { pending?: Array<Record<string, unknown>> };
      expect(pendingStore.pending).toEqual([
        expect.objectContaining({
          channel: "community",
          accountId: "alpha",
          senderId: "u-dm-1",
        }),
      ]);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/webhook reuses in-flight response for concurrent idempotency key", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  let runCount = 0;
  const agent: BelldandyAgent = {
    async *run(input) {
      runCount += 1;
      await sleep(25);
      yield { type: "final", text: `webhook:${input.text}` };
    },
  };

  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    agentFactory: () => agent,
    webhookConfig: {
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "webhook-test-token",
        },
      ],
    },
    webhookIdempotency: new IdempotencyManager(60_000),
  });

  try {
    const request = () =>
      fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-test-token",
          "x-idempotency-key": "dup-1",
        },
        body: JSON.stringify({ text: "hello from webhook" }),
      });

    const [first, second] = await Promise.all([request(), request()]);
    const payloads = await Promise.all([first.json(), second.json()]) as Array<{ ok?: boolean; duplicate?: boolean; payload?: { response?: string } }>;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(runCount).toBe(1);
    expect(payloads.every((item) => item.ok === true)).toBe(true);
    expect(payloads.every((item) => item.payload?.response === "webhook:hello from webhook")).toBe(true);
    expect(payloads.filter((item) => item.duplicate === true)).toHaveLength(1);
  } finally {
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("/api/webhook rejects non-json content-type before auth", async () => {
  const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
    webhookConfig: {
      version: 1,
      webhooks: [
        {
          id: "audit",
          enabled: true,
          token: "webhook-test-token",
        },
      ],
    },
    webhookIdempotency: new IdempotencyManager(60_000),
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: "hello",
    });

    expect(response.status).toBe(415);
    expect(await response.text()).toContain("Unsupported Media Type");
  } finally {
    await server.close();
    await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("/api/webhook enforces pre-auth body size limit", async () => {
  await withEnv({
    BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "24",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      webhookConfig: {
        version: 1,
        webhooks: [
          {
            id: "audit",
            enabled: true,
            token: "webhook-test-token",
          },
        ],
      },
      webhookIdempotency: new IdempotencyManager(60_000),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "this body should exceed pre-auth limit" }),
      });

      expect(response.status).toBe(413);
      expect(await response.text()).toContain("Payload Too Large");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/webhook rate limits repeated requests from the same client", async () => {
  await withEnv({
    BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "1",
    BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    let runCount = 0;
    const agent: BelldandyAgent = {
      async *run(input) {
        runCount += 1;
        yield { type: "final", text: `webhook:${input.text}` };
      },
    };

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
      webhookConfig: {
        version: 1,
        webhooks: [
          {
            id: "audit",
            enabled: true,
            token: "webhook-test-token",
          },
        ],
      },
      webhookIdempotency: new IdempotencyManager(60_000),
    });

    try {
      const request = () =>
        fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer webhook-test-token",
          },
          body: JSON.stringify({ text: "hello from webhook" }),
        });

      const first = await request();
      const second = await request();

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(runCount).toBe(1);
      expect(await second.text()).toContain("Too Many Requests");
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("/api/webhook limits concurrent in-flight requests per client", async () => {
  await withEnv({
    BELLDANDY_WEBHOOK_MAX_IN_FLIGHT_PER_KEY: "1",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    let runCount = 0;
    const agent: BelldandyAgent = {
      async *run(input) {
        runCount += 1;
        await sleep(40);
        yield { type: "final", text: `webhook:${input.text}` };
      },
    };

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => agent,
      webhookConfig: {
        version: 1,
        webhooks: [
          {
            id: "audit",
            enabled: true,
            token: "webhook-test-token",
          },
        ],
      },
      webhookIdempotency: new IdempotencyManager(60_000),
    });

    try {
      const request = () =>
        fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer webhook-test-token",
          },
          body: JSON.stringify({ text: "hello from webhook" }),
        });

      const [first, second] = await Promise.all([request(), request()]);

      expect([first.status, second.status].sort()).toEqual([200, 429]);
      expect(runCount).toBe(1);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("api.message and webhook guard pick up updated env without restarting server", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "false",
    BELLDANDY_COMMUNITY_API_TOKEN: undefined,
    BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "24",
    BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "2",
    BELLDANDY_WEBHOOK_RATE_LIMIT_WINDOW_MS: "60000",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "token", token: "fallback-auth-token" },
      webRoot: resolveWebRoot(),
      stateDir,
      agentFactory: () => new MockAgent(),
      webhookConfig: {
        version: 1,
        webhooks: [
          {
            id: "audit",
            enabled: true,
            token: "webhook-test-token",
          },
        ],
      },
      webhookIdempotency: new IdempotencyManager(60_000),
    });

    try {
      const disabledCommunity = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fallback-auth-token",
        },
        body: JSON.stringify({ text: "hello", conversationId: "conv-hot-community-off" }),
      });
      expect(disabledCommunity.status).toBe(404);

      process.env.BELLDANDY_COMMUNITY_API_ENABLED = "true";
      process.env.BELLDANDY_COMMUNITY_API_TOKEN = "community-hot-token";
      const enabledCommunity = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-hot-token",
        },
        body: JSON.stringify({
          text: "hello after hot enable",
          conversationId: "conv-hot-community-on",
          from: "office.goddess.ai",
        }),
      });
      const enabledPayload = await enabledCommunity.json();
      expect(enabledCommunity.status).toBe(200);
      expect(enabledPayload.ok).toBe(true);

      const tooLargeBefore = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "this body should exceed pre-auth limit" }),
      });
      expect(tooLargeBefore.status).toBe(413);

      process.env.BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES = "4096";
      process.env.BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS = "1";

      const first = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-test-token",
        },
        body: JSON.stringify({ text: "hello after hot webhook change" }),
      });
      const second = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-test-token",
        },
        body: JSON.stringify({ text: "hello after hot webhook change" }),
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    } finally {
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("system.doctor exposes api.message and webhook query runtime lifecycle traces", async () => {
  await withEnv({
    BELLDANDY_COMMUNITY_API_ENABLED: "true",
    BELLDANDY_COMMUNITY_API_TOKEN: "community-trace-token",
  }, async () => {
    const stateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "belldandy-test-"));
    const toolsConfigManager = new ToolsConfigManager(stateDir);
    await toolsConfigManager.load();
    const confirmationStore = new ToolControlConfirmationStore();
    let toolExecutor!: ToolExecutor;
    const agent: BelldandyAgent = {
      async *run(input) {
        const request = {
          id: `tool-call-${input.conversationId}`,
          name: TOOL_SETTINGS_CONTROL_NAME,
          arguments: {
            action: "apply",
            disableBuiltin: ["alpha_builtin"],
          },
        };
        yield {
          type: "tool_call" as const,
          id: request.id,
          name: request.name,
          arguments: request.arguments,
        };
        const result = await toolExecutor.execute(
          request,
          input.conversationId,
          input.agentId,
          input.userUuid,
          input.senderInfo,
          input.roomContext,
        );
        yield {
          type: "tool_result" as const,
          id: result.id,
          name: result.name,
          success: result.success,
          output: result.output,
          error: result.error,
        };
        yield {
          type: "usage" as const,
          systemPromptTokens: 1,
          contextTokens: 2,
          inputTokens: 3,
          outputTokens: 4,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          modelCalls: 1,
        };
        yield { type: "final", text: `http:${input.text}` };
      },
    };
    toolExecutor = new ToolExecutor({
      tools: [
        createTestTool("alpha_builtin"),
        createToolSettingsControlTool({
          toolsConfigManager,
          getControlMode: () => "auto",
          listRegisteredTools: () => toolExecutor.getRegisteredToolNames(),
          confirmationStore,
        }),
      ],
      workspaceRoot: process.cwd(),
      alwaysEnabledTools: [TOOL_SETTINGS_CONTROL_NAME],
    });

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
      toolsConfigManager,
      toolExecutor,
      agentFactory: () => agent,
      webhookConfig: {
        version: 1,
        webhooks: [
          {
            id: "audit",
            enabled: true,
            token: "webhook-trace-token",
          },
        ],
      },
      webhookIdempotency: new IdempotencyManager(60_000),
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
    const frames: any[] = [];
    const closeP = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf-8"))));

    try {
      const communityRes = await fetch(`http://127.0.0.1:${server.port}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer community-trace-token",
        },
        body: JSON.stringify({
          text: "hello runtime api",
          conversationId: "conv-http-trace",
          from: "office.goddess.ai",
        }),
      });
      expect(communityRes.status).toBe(200);

      const webhookRes = await fetch(`http://127.0.0.1:${server.port}/api/webhook/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer webhook-trace-token",
        },
        body: JSON.stringify({
          text: "hello runtime webhook",
          conversationId: "conv-webhook-trace",
        }),
      });
      expect(webhookRes.status).toBe(200);

      await pairWebSocketClient(ws, frames, stateDir);

      ws.send(JSON.stringify({ type: "req", id: "system-doctor-http-trace", method: "system.doctor", params: {} }));
      await waitFor(() => frames.some((f) => f.type === "res" && f.id === "system-doctor-http-trace"));
      const response = frames.find((f) => f.type === "res" && f.id === "system-doctor-http-trace");

      expect(response.ok).toBe(true);
      const traces = response.payload?.queryRuntime?.traces ?? [];
      const apiTrace = traces.find((item: any) => item.method === "api.message" && item.conversationId === "conv-http-trace");
      const webhookTrace = traces.find((item: any) => item.method === "webhook.receive" && item.conversationId === "conv-webhook-trace");

      expect(apiTrace).toMatchObject({
        method: "api.message",
        status: "completed",
        conversationId: "conv-http-trace",
      });
      expect(webhookTrace).toMatchObject({
        method: "webhook.receive",
        status: "completed",
        conversationId: "conv-webhook-trace",
      });

      expect(apiTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
        "auth_checked",
        "request_validated",
        "agent_created",
        "agent_running",
        "tool_call_emitted",
        "tool_result_emitted",
        "tool_event_emitted",
        "task_result_recorded",
        "response_built",
        "completed",
      ]));
      expect(webhookTrace?.stages.map((item: any) => item.stage)).toEqual(expect.arrayContaining([
        "webhook_rule_loaded",
        "auth_checked",
        "idempotency_checked",
        "prompt_built",
        "request_validated",
        "agent_created",
        "agent_running",
        "tool_call_emitted",
        "tool_result_emitted",
        "tool_event_emitted",
        "task_result_recorded",
        "response_built",
        "completed",
      ]));
      expect(toolsConfigManager.getConfig().disabled.builtin).toEqual(["alpha_builtin"]);
    } finally {
      ws.close();
      await closeP;
      await server.close();
      await fs.promises.rm(stateDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
