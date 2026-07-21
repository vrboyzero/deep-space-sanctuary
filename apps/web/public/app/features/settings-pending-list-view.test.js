// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { createSettingsPendingListView } from "./settings-pending-list-view.js";

describe("settings pending list view", () => {
  it("renders both pending lists as text and attributes without innerHTML", () => {
    const view = createSettingsPendingListView({
      ownerDocument: document,
      formatDateTime: () => "2026-04-12 09:30:00",
      t: (key, _params, fallback) => key === "settings.channelSecurityApprove"
        ? '<img src=x onerror="alert(1)">Approve'
        : fallback ?? "",
    });
    const channelList = document.createElement("div");
    const pairingList = document.createElement("div");
    for (const list of [channelList, pairingList]) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
      Object.defineProperty(list, "innerHTML", {
        configurable: true,
        get() {
          return descriptor.get.call(this);
        },
        set(value) {
          if (value) throw new Error("Settings pending list must not use innerHTML");
          descriptor.set.call(this, value);
        },
      });
    }

    view.renderChannelSecurityPending(channelList, [{
      id: "security-1",
      channel: "feishu",
      accountId: "acct-1",
      senderId: "sender-1",
      senderName: '<img src=x onerror="alert(1)">Sender',
      chatId: "chat-1",
      updatedAt: "2026-04-12T09:30:00.000Z",
      seenCount: 2,
      messagePreview: "Preview",
    }]);
    const securityCard = channelList.querySelector(".memory-detail-card");
    expect(securityCard?.querySelector(".memory-detail-label")?.textContent).toBe("feishu/acct-1:sender-1");
    expect(securityCard?.querySelector(".memory-detail-text")?.textContent).toContain("<img src=x");
    expect(securityCard?.querySelector("img, [onerror]")).toBeNull();
    expect(securityCard?.querySelector("[data-channel-security-action='approve']")?.getAttribute("data-channel-security-request-id")).toBe("security-1");
    expect(securityCard?.querySelector("[data-channel-security-action='reject']")?.getAttribute("data-channel-security-request-id")).toBe("security-1");

    view.renderPairingPending(pairingList, [{
      code: "ABCD1234",
      clientId: "client-1",
      message: '<svg onload="alert(1)">Pairing</svg>',
      updatedAt: "2026-04-12T09:30:00.000Z",
    }]);
    const pairingCard = pairingList.querySelector(".memory-detail-card");
    expect(pairingCard?.querySelector(".memory-detail-label")?.textContent).toBe("Pairing Code: ABCD1234");
    expect(pairingCard?.querySelector(".memory-detail-text")?.textContent).toContain("<svg");
    expect(pairingCard?.querySelector("svg, [onload]")).toBeNull();
    expect(pairingCard?.querySelector("[data-pairing-action='approve']")?.getAttribute("data-pairing-code")).toBe("ABCD1234");

    view.renderChannelSecurityPending(channelList, []);
    view.renderPairingPending(pairingList, []);
    expect(channelList.querySelectorAll(".memory-viewer-empty")).toHaveLength(1);
    expect(pairingList.querySelectorAll(".memory-viewer-empty")).toHaveLength(1);
  });
});
