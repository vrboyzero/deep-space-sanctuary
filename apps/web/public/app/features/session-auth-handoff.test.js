// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { consumeSessionAuthHandoff, createSessionAuthHandoffUrl } from "./session-auth-handoff.js";

describe("session auth handoff", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
  });

  it("creates a multi-page url that carries a local auth handoff id", () => {
    const nextUrl = createSessionAuthHandoffUrl({
      currentUrl: "http://127.0.0.1:28889/?foo=1",
      authMode: "token",
      authValue: "runtime-token",
      now: 1000,
      idFactory: () => "handoff-1",
    });

    expect(nextUrl).toBe("http://127.0.0.1:28889/?foo=1&authHandoff=handoff-1");
    const raw = localStorage.getItem("belldandy.webchat.authHandoff.handoff-1");
    expect(raw).toContain("\"value\":\"runtime-token\"");
  });

  it("consumes a handoff payload into the new page and removes the query token", () => {
    localStorage.setItem(
      "belldandy.webchat.authHandoff.handoff-2",
      JSON.stringify({
        mode: "token",
        value: "runtime-token-2",
        createdAt: 1000,
      }),
    );
    history.replaceState({}, "", "/?authHandoff=handoff-2&foo=1");

    const result = consumeSessionAuthHandoff({ now: 1200 });

    expect(result).toEqual({ mode: "token", value: "runtime-token-2" });
    expect(localStorage.getItem("belldandy.webchat.authHandoff.handoff-2")).toBeNull();
    expect(window.location.search).toBe("?foo=1");
  });
});
