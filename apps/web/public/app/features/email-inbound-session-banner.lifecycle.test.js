// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createEmailInboundSessionBannerFeature } from "./email-inbound-session-banner.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const CONVERSATION_ID = "channel=email:provider=imap:account=primary:thread=thread-1:scope=per-account-thread";

describe("email inbound session banner lifecycle", () => {
  it("settles a disposed audit read without restoring retained banner DOM", async () => {
    const request = createDeferred();
    const container = document.createElement("div");
    const feature = createEmailInboundSessionBannerFeature({
      sendReq: vi.fn(() => request.promise),
      t: (_key, _params, fallback) => fallback || "",
    });
    feature.renderBanner(container, "existing email context");

    const load = feature.loadBannerText(CONVERSATION_ID);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingEmailInboundBannerReadCount: 1,
      retainedEmailInboundBannerCount: 1,
    });

    feature.dispose();
    expect(container.querySelector("[data-email-inbound-session-banner]")).toBeNull();
    expect(feature.getRuntimeSnapshot().pendingEmailInboundBannerReadCount).toBe(1);
    request.resolve({
      ok: true,
      payload: {
        items: [{ conversationId: CONVERSATION_ID, triageSummary: "late summary" }],
      },
    });

    await expect(load).resolves.toBe("");
    expect(feature.renderBanner(container, "late banner")).toBeNull();
    expect(container.childElementCount).toBe(0);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingEmailInboundBannerReadCount: 0,
      retainedEmailInboundBannerCount: 0,
    });
  });

  it("settles a disposed rejected audit read without restoring retained banner DOM", async () => {
    const request = createDeferred();
    const container = document.createElement("div");
    const feature = createEmailInboundSessionBannerFeature({
      sendReq: vi.fn(() => request.promise),
      t: (_key, _params, fallback) => fallback || "",
    });
    feature.renderBanner(container, "existing email context");

    const load = feature.loadBannerText(CONVERSATION_ID);
    feature.dispose();
    request.reject(new Error("late audit failure"));

    await expect(load).resolves.toBe("");
    expect(feature.renderBanner(container, "late banner")).toBeNull();
    expect(container.childElementCount).toBe(0);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      disposed: true,
      pendingEmailInboundBannerReadCount: 0,
      retainedEmailInboundBannerCount: 0,
    });
  });

  it("preserves the active audit text and banner replacement contract", async () => {
    const sendReq = vi.fn(async () => ({
      ok: true,
      payload: {
        items: [{
          conversationId: CONVERSATION_ID,
          threadId: "thread-1",
          triageSummary: "reply with the requested invoice",
          messageId: "message-1",
        }],
      },
    }));
    const container = document.createElement("div");
    const feature = createEmailInboundSessionBannerFeature({
      sendReq,
      t: (_key, _params, fallback) => fallback || "",
    });

    const text = await feature.loadBannerText(CONVERSATION_ID);
    const banner = feature.renderBanner(container, text);

    expect(sendReq.mock.calls[0][0].method).toBe("email_inbound.audit.list");
    expect(text).toContain("reply with the requested invoice");
    expect(text).toContain("send_email.replyToMessageId=message-1");
    expect(banner?.textContent).toBe(text);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingEmailInboundBannerReadCount: 0,
      retainedEmailInboundBannerCount: 1,
    });

    expect(feature.renderBanner(container, "")).toBeNull();
    expect(container.childElementCount).toBe(0);
    expect(feature.getRuntimeSnapshot().retainedEmailInboundBannerCount).toBe(0);
  });

  it("allows only the latest audit read to return renderable text", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const sendReq = vi.fn()
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    const feature = createEmailInboundSessionBannerFeature({
      sendReq,
      t: (_key, _params, fallback) => fallback || "",
    });

    const firstLoad = feature.loadBannerText(CONVERSATION_ID);
    const secondLoad = feature.loadBannerText(CONVERSATION_ID);
    expect(feature.getRuntimeSnapshot().pendingEmailInboundBannerReadCount).toBe(2);

    firstRequest.resolve({
      ok: true,
      payload: { items: [{ conversationId: CONVERSATION_ID, triageSummary: "stale summary" }] },
    });
    await expect(firstLoad).resolves.toBe("");
    expect(feature.getRuntimeSnapshot().pendingEmailInboundBannerReadCount).toBe(1);

    secondRequest.resolve({
      ok: true,
      payload: { items: [{ conversationId: CONVERSATION_ID, triageSummary: "fresh summary" }] },
    });
    await expect(secondLoad).resolves.toContain("fresh summary");
    expect(feature.getRuntimeSnapshot().pendingEmailInboundBannerReadCount).toBe(0);
  });
});
