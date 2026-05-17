import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildGatewayHttpRoutesContext } from "./server-http-runtime.js";
import { withEnv } from "./server-testkit.js";

function createRuntimeInput(): Parameters<typeof buildGatewayHttpRoutesContext>[0] {
  return {
    app: {} as never,
    stateDir: "E:/tmp/belldandy-test",
    log: {
      info() {},
      error() {},
    },
    options: {
      auth: { mode: "none" },
      webRoot: "E:/tmp/web",
      stateDir: "E:/tmp/belldandy-test",
      agentFactory: undefined,
      agentRegistry: undefined,
      webhookConfig: undefined,
      webhookIdempotency: undefined,
      onChannelSecurityApprovalRequired: undefined,
    },
    getConversationStore: (() => ({})) as never,
    getQueryRuntimeTraceStore: (() => ({})) as never,
    writeBinaryFileAtomic: (async () => {}) as never,
    writeTextFileAtomic: (async () => {}) as never,
    emitAutoRunTaskTokenResult: (() => {}) as never,
  };
}

describe("buildGatewayHttpRoutesContext governance detail mode", () => {
  it("defaults to compact when env is missing or invalid", async () => {
    await withEnv({
      BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: undefined,
    }, async () => {
      const context = buildGatewayHttpRoutesContext(createRuntimeInput());
      expect(context.webConfig?.governanceDetailMode).toBe("compact");
    });

    await withEnv({
      BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "invalid-mode",
    }, async () => {
      const context = buildGatewayHttpRoutesContext(createRuntimeInput());
      expect(context.webConfig?.governanceDetailMode).toBe("compact");
    });
  });

  it("keeps full only when env explicitly requests full", async () => {
    await withEnv({
      BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "full",
    }, async () => {
      const context = buildGatewayHttpRoutesContext(createRuntimeInput());
      expect(context.webConfig?.governanceDetailMode).toBe("full");
    });
  });

  it("prefers runtime getter for current governance detail mode in getWebConfig", async () => {
    await withEnv({
      BELLDANDY_WEB_GOVERNANCE_DETAIL_MODE: "compact",
    }, async () => {
      const context = buildGatewayHttpRoutesContext({
        ...createRuntimeInput(),
        getGovernanceDetailMode: () => "full",
      });
      expect(context.webConfig?.governanceDetailMode).toBe("full");
      expect(context.getWebConfig?.().governanceDetailMode).toBe("full");
    });
  });

  it("enables draft generate notice by default and allows env override", async () => {
    await withEnv({
      BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED: undefined,
    }, async () => {
      const context = buildGatewayHttpRoutesContext(createRuntimeInput());
      expect(context.webConfig?.experienceDraftGenerateNoticeEnabled).toBe(true);
      expect(context.getWebConfig?.().experienceDraftGenerateNoticeEnabled).toBe(true);
    });

    await withEnv({
      BELLDANDY_WEB_EXPERIENCE_DRAFT_GENERATE_NOTICE_ENABLED: "false",
    }, async () => {
      const context = buildGatewayHttpRoutesContext(createRuntimeInput());
      expect(context.webConfig?.experienceDraftGenerateNoticeEnabled).toBe(false);
      expect(context.getWebConfig?.().experienceDraftGenerateNoticeEnabled).toBe(false);
    });
  });

  it("loads external web links from webRoot config.js into runtime web config", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-web-config-"));
    await fs.writeFile(
      path.join(tempRoot, "config.js"),
      [
        "window.BELLDANDY_WEB_CONFIG = {",
        "  recommendApiUrl: \"https://example.com/recommend\",",
        "  aliyunOneKeyUrl: \"https://example.com/aliyun\",",
        "  officialHomeUrl: \"https://example.com/home\",",
        "  workshopUrl: \"https://example.com/workshop\"",
        "};",
      ].join("\n"),
      "utf-8",
    );

    try {
      await withEnv({}, async () => {
        const context = buildGatewayHttpRoutesContext({
          ...createRuntimeInput(),
          options: {
            ...createRuntimeInput().options,
            webRoot: tempRoot,
          },
        });
        expect(context.webConfig?.recommendApiUrl).toBe("https://example.com/recommend");
        expect(context.webConfig?.aliyunOneKeyUrl).toBe("https://example.com/aliyun");
        expect(context.webConfig?.officialHomeUrl).toBe("https://example.com/home");
        expect(context.webConfig?.workshopUrl).toBe("https://example.com/workshop");
        expect(context.getWebConfig?.().officialHomeUrl).toBe("https://example.com/home");
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("reads Community API and Webhook guard settings through runtime getters", async () => {
    await withEnv({
      BELLDANDY_COMMUNITY_API_ENABLED: "false",
      BELLDANDY_COMMUNITY_API_TOKEN: undefined,
      BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES: "65536",
      BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS: "120",
    }, async () => {
      const input = createRuntimeInput();
      input.options.auth = { mode: "token", token: "fallback-token" };
      input.options.webhookConfig = { webhooks: [{}] } as never;
      const context = buildGatewayHttpRoutesContext(input);

      expect(context.communityApiEnabled).toBe(false);
      expect(context.getCommunityApiSettings?.().enabled).toBe(false);
      expect(context.getCommunityApiSettings?.().token).toBe("fallback-token");
      expect(context.webhookPreAuthMaxBytes).toBe(65536);
      expect(context.getWebhookRuntimeSettings?.().rateLimitMaxRequests).toBe(120);

      process.env.BELLDANDY_COMMUNITY_API_ENABLED = "true";
      process.env.BELLDANDY_COMMUNITY_API_TOKEN = "community-secret";
      process.env.BELLDANDY_WEBHOOK_PREAUTH_MAX_BYTES = "2048";
      process.env.BELLDANDY_WEBHOOK_RATE_LIMIT_MAX_REQUESTS = "5";

      expect(context.getCommunityApiSettings?.().enabled).toBe(true);
      expect(context.getCommunityApiSettings?.().token).toBe("community-secret");
      expect(context.getWebhookRuntimeSettings?.().preAuthMaxBytes).toBe(2048);
      expect(context.getWebhookRuntimeSettings?.().rateLimitMaxRequests).toBe(5);
    });
  });
});
