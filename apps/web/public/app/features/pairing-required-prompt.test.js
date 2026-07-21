// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createPairingRequiredPromptRenderer,
  renderPairingRequiredFallback,
} from "./pairing-required-prompt.js";

function createRenderer(overrides = {}) {
  return createPairingRequiredPromptRenderer({
    t: (_key, params, fallback) => String(fallback ?? "").replace(/\{(\w+)\}/g, (_match, name) => String(params?.[name] ?? "")),
    openPairingPending: vi.fn(),
    approvePairing: vi.fn(async () => ({ ok: true })),
    showNotice: vi.fn(),
    ...overrides,
  });
}

describe("pairing required prompt", () => {
  it("renders the CLI-only fallback as text without dropping an unsafe-looking code", () => {
    const target = document.createElement("div");
    const code = '</b><img src=x onerror="alert(1)">';

    renderPairingRequiredFallback(target, {
      code,
      t: (_key, _params, fallback) => fallback ?? "",
    });

    expect(target.querySelector("img")).toBeNull();
    expect(target.querySelector("[onerror]")).toBeNull();
    expect(target.textContent).toContain(code);
    expect(target.textContent).toContain(`corepack pnpm bdd pairing approve ${code}`);
  });

  it("renders Gateway payload values as text without creating attacker markup", () => {
    const target = document.createElement("div");
    const render = createRenderer();

    render(target, {
      code: '</b><img src=x onerror="alert(1)">',
      message: '<script>window.pwned=true</script>',
      clientId: '<svg onload="alert(1)">',
    });

    expect(target.querySelector("img")).toBeNull();
    expect(target.querySelector("script")).toBeNull();
    expect(target.querySelector("svg")).toBeNull();
    expect(target.querySelector("[onerror], [onload]")).toBeNull();
    expect(target.querySelector(".pairing-required-card")).not.toBeNull();
    expect(target.textContent).toContain('<SCRIPT>WINDOW.PWNED=TRUE</SCRIPT>'.toLowerCase());
    expect(target.textContent).toContain('<svg onload="alert(1)">');
  });

  it("preserves open-settings and successful approval behavior", async () => {
    const target = document.createElement("div");
    const openPairingPending = vi.fn();
    const approvePairing = vi.fn(async () => ({ ok: true, clientId: "client-1" }));
    const showNotice = vi.fn();
    const render = createRenderer({ openPairingPending, approvePairing, showNotice });

    render(target, { code: " abcd1234 " });
    const openSettingsButton = target.querySelector(".pairing-open-settings-btn");
    const approveButton = target.querySelector(".pairing-approve-btn");
    openSettingsButton.click();
    approveButton.click();

    await vi.waitFor(() => expect(approvePairing).toHaveBeenCalledWith("ABCD1234"));
    expect(openPairingPending).toHaveBeenCalledTimes(1);
    expect(approveButton.disabled).toBe(true);
    expect(openSettingsButton.disabled).toBe(true);
    expect(approveButton.textContent).toBe("Approved");
    expect(target.querySelector(".pairing-status-text")?.textContent).toBe("Pairing approved. You can resend your message now.");
    expect(showNotice).toHaveBeenCalledWith(
      "Pairing approved",
      "Pairing code ABCD1234 was approved. You can continue in the current WebChat session.",
      "success",
      3200,
    );
  });

  it("keeps missing-code and approval failure states fail closed", async () => {
    const missingTarget = document.createElement("div");
    const approvePairing = vi.fn(async () => ({ ok: false, message: "Denied" }));
    const render = createRenderer({ approvePairing });
    render(missingTarget);

    missingTarget.querySelector(".pairing-approve-btn").click();
    expect(approvePairing).not.toHaveBeenCalled();
    expect(missingTarget.querySelector(".pairing-status-text")?.textContent).toBe("Pairing code is required.");

    const failureTarget = document.createElement("div");
    render(failureTarget, { code: "retry-code" });
    const approveButton = failureTarget.querySelector(".pairing-approve-btn");
    const openSettingsButton = failureTarget.querySelector(".pairing-open-settings-btn");
    approveButton.click();

    await vi.waitFor(() => expect(approvePairing).toHaveBeenCalledWith("RETRY-CODE"));
    expect(failureTarget.querySelector(".pairing-status-text")?.textContent).toBe("Denied");
    expect(approveButton.disabled).toBe(false);
    expect(openSettingsButton.disabled).toBe(false);
  });

  it("keeps the oversized app entrypoint limited to prompt wiring", () => {
    const appSource = fs.readFileSync(path.join(process.cwd(), "apps/web/public/app.js"), "utf8");

    expect(appSource).toContain("import { createPairingRequiredPromptRenderer }");
    expect(appSource).toContain('"./app/features/pairing-required-prompt.js";');
    expect(appSource).toContain("const renderPairingRequiredPrompt = createPairingRequiredPromptRenderer({");
    expect(appSource).not.toContain("function renderPairingRequiredPrompt(");
    expect(appSource).not.toContain('class="pairing-required-card"');

    const chatEventsStart = appSource.indexOf("chatEventsFeature = createChatEventsFeature({");
    const chatEventsEnd = appSource.indexOf("\n});", chatEventsStart);
    expect(appSource.slice(chatEventsStart, chatEventsEnd)).not.toContain("escapeHtml,");
  });
});
