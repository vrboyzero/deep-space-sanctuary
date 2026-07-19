// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCredentialSession } from "./persistence.js";

describe("credential session controls lifecycle", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("owns auth control listeners and clears the in-memory credential on dispose", () => {
    document.body.innerHTML = `
      <select id="mode">
        <option value="none">None</option>
        <option value="token">Token</option>
        <option value="password">Password</option>
      </select>
      <input id="value" />
      <input id="remember" type="checkbox" />
    `;
    const authModeEl = document.getElementById("mode");
    const authValueEl = document.getElementById("value");
    const rememberSessionEl = document.getElementById("remember");
    const onModeChange = vi.fn();
    const onValueInput = vi.fn();
    const onDispose = vi.fn();
    const credentialSession = createCredentialSession({
      storeKey: "test.auth",
      sessionStoreKey: "test.auth.token",
      rememberSessionKey: "test.auth.remember",
      authModeEl,
      authValueEl,
      rememberSessionEl,
    });
    credentialSession.bindControls({ onModeChange, onValueInput, onDispose });

    expect(credentialSession.getRuntimeSnapshot()).toEqual({ listenerCount: 3, disposed: false });
    authValueEl.value = "transient-password";
    authModeEl.value = "password";
    authModeEl.dispatchEvent(new Event("change"));
    expect(onModeChange).toHaveBeenCalledWith("password");
    expect(authValueEl.value).toBe("");

    authModeEl.value = "token";
    authModeEl.dispatchEvent(new Event("change"));
    rememberSessionEl.checked = true;
    authValueEl.value = "opted-in-token";
    authValueEl.dispatchEvent(new Event("input"));
    expect(onValueInput).toHaveBeenCalledWith("opted-in-token");
    expect(sessionStorage.getItem("test.auth.token")).toBe("opted-in-token");

    credentialSession.dispose();
    credentialSession.dispose();
    expect(credentialSession.getRuntimeSnapshot()).toEqual({ listenerCount: 0, disposed: true });
    expect(authValueEl.value).toBe("");
    expect(onDispose).toHaveBeenCalledTimes(1);

    authModeEl.value = "password";
    authModeEl.dispatchEvent(new Event("change"));
    authValueEl.value = "late-secret";
    authValueEl.dispatchEvent(new Event("input"));
    credentialSession.setCredential({ mode: "token", value: "late-token" });
    expect(onModeChange).toHaveBeenCalledTimes(2);
    expect(onValueInput).toHaveBeenCalledTimes(1);
    expect(authValueEl.value).toBe("late-secret");
    expect(sessionStorage.getItem("test.auth.token")).toBe("opted-in-token");
  });
});
