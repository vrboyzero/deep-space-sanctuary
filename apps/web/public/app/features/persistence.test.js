import { beforeEach, describe, expect, it } from "vitest";

import {
  createCredentialSession,
  persistAuthFields,
  persistSessionAuthToken,
  restoreAuthFields,
  restoreSessionAuthToken,
} from "./persistence.js";

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

describe("session auth token persistence", () => {
  beforeEach(() => {
    globalThis.localStorage = createStorage();
    globalThis.sessionStorage = createStorage();
  });

  it("persists the auth mode without writing the token to local storage", () => {
    persistAuthFields({
      storeKey: "test.auth",
      authModeEl: { value: "token" },
      authValueEl: { value: "long-lived-token" },
    });

    const raw = globalThis.localStorage.getItem("test.auth");
    expect(JSON.parse(raw)).toEqual({ mode: "token" });
    expect(raw).not.toContain("long-lived-token");
  });

  it("scrubs a legacy local storage secret while restoring its auth mode", () => {
    globalThis.localStorage.setItem("test.auth", JSON.stringify({
      mode: "password",
      value: "legacy-password",
    }));
    const authModeEl = { value: "none" };
    const authValueEl = { value: "" };

    restoreAuthFields({ storeKey: "test.auth", authModeEl, authValueEl });

    expect(authModeEl.value).toBe("password");
    expect(authValueEl.value).toBe("");
    expect(JSON.parse(globalThis.localStorage.getItem("test.auth"))).toEqual({ mode: "password" });
  });

  it("restores a session token into auth controls", () => {
    globalThis.sessionStorage.setItem("test.session.auth", "token-from-session");
    const authModeEl = { value: "none" };
    const authValueEl = { value: "" };

    const restored = restoreSessionAuthToken({
      sessionStoreKey: "test.session.auth",
      authModeEl,
      authValueEl,
      rememberSession: true,
    });

    expect(restored).toBe("token-from-session");
    expect(authModeEl.value).toBe("token");
    expect(authValueEl.value).toBe("token-from-session");
  });

  it("persists the current token into session storage", () => {
    const authModeEl = { value: "token" };
    const authValueEl = { value: "current-runtime-token" };

    persistSessionAuthToken({
      sessionStoreKey: "test.session.auth",
      authModeEl,
      authValueEl,
      rememberSession: true,
    });

    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBe("current-runtime-token");
  });

  it("does not persist a token without explicit session opt-in", () => {
    persistSessionAuthToken({
      sessionStoreKey: "test.session.auth",
      authModeEl: { value: "token" },
      authValueEl: { value: "memory-only-token" },
    });

    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBeNull();
  });

  it("restores an explicitly opted-in token through CredentialSession", () => {
    globalThis.localStorage.setItem("test.auth", JSON.stringify({ mode: "token" }));
    globalThis.sessionStorage.setItem("test.auth.remember", "true");
    globalThis.sessionStorage.setItem("test.session.auth", "session-token");
    const authModeEl = { value: "none" };
    const authValueEl = { value: "" };
    const rememberSessionEl = { checked: false, disabled: false };

    const credentialSession = createCredentialSession({
      storeKey: "test.auth",
      sessionStoreKey: "test.session.auth",
      rememberSessionKey: "test.auth.remember",
      authModeEl,
      authValueEl,
      rememberSessionEl,
    });
    const restored = credentialSession.restore();

    expect(restored).toBe("session-token");
    expect(authModeEl.value).toBe("token");
    expect(authValueEl.value).toBe("session-token");
    expect(rememberSessionEl.checked).toBe(true);
    expect(rememberSessionEl.disabled).toBe(false);
  });

  it("persists an explicitly opted-in token through CredentialSession", () => {
    const authModeEl = { value: "token" };
    const authValueEl = { value: "opted-in-token" };
    const rememberSessionEl = { checked: true, disabled: false };
    const credentialSession = createCredentialSession({
      storeKey: "test.auth",
      sessionStoreKey: "test.session.auth",
      rememberSessionKey: "test.auth.remember",
      authModeEl,
      authValueEl,
      rememberSessionEl,
    });

    credentialSession.persist();

    expect(JSON.parse(globalThis.localStorage.getItem("test.auth"))).toEqual({ mode: "token" });
    expect(globalThis.localStorage.getItem("test.auth.remember")).toBeNull();
    expect(globalThis.sessionStorage.getItem("test.auth.remember")).toBe("true");
    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBe("opted-in-token");
  });

  it("keeps a programmatically supplied token memory-only by default", () => {
    const authModeEl = { value: "none" };
    const authValueEl = { value: "" };
    const rememberSessionEl = { checked: false, disabled: true };
    const credentialSession = createCredentialSession({
      storeKey: "test.auth",
      sessionStoreKey: "test.session.auth",
      rememberSessionKey: "test.auth.remember",
      authModeEl,
      authValueEl,
      rememberSessionEl,
    });

    credentialSession.setCredential({ mode: "token", value: "handoff-token" });

    expect(authModeEl.value).toBe("token");
    expect(authValueEl.value).toBe("handoff-token");
    expect(rememberSessionEl.disabled).toBe(false);
    expect(JSON.parse(globalThis.localStorage.getItem("test.auth"))).toEqual({ mode: "token" });
    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBeNull();
  });

  it("never persists a password even when token session opt-in remains checked", () => {
    globalThis.sessionStorage.setItem("test.session.auth", "stale-token");
    const authModeEl = { value: "password" };
    const authValueEl = { value: "memory-only-password" };
    const rememberSessionEl = { checked: true, disabled: false };
    const credentialSession = createCredentialSession({
      storeKey: "test.auth",
      sessionStoreKey: "test.session.auth",
      rememberSessionKey: "test.auth.remember",
      authModeEl,
      authValueEl,
      rememberSessionEl,
    });

    credentialSession.persist();

    const raw = globalThis.localStorage.getItem("test.auth");
    expect(JSON.parse(raw)).toEqual({ mode: "password" });
    expect(raw).not.toContain("memory-only-password");
    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBeNull();
    expect(rememberSessionEl.disabled).toBe(true);
  });

  it("clears the previous secret before persisting a user-selected auth mode", () => {
    const authModeEl = { value: "password" };
    const authValueEl = { value: "password-must-not-become-token" };
    const rememberSessionEl = { checked: true, disabled: true };
    const credentialSession = createCredentialSession({
      storeKey: "test.auth",
      sessionStoreKey: "test.session.auth",
      rememberSessionKey: "test.auth.remember",
      authModeEl,
      authValueEl,
      rememberSessionEl,
    });

    credentialSession.setMode("token");

    expect(authModeEl.value).toBe("token");
    expect(authValueEl.value).toBe("");
    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBeNull();
    expect(rememberSessionEl.disabled).toBe(false);
  });

  it("clears the session token when auth mode changes away from token", () => {
    globalThis.sessionStorage.setItem("test.session.auth", "stale-token");
    const authModeEl = { value: "none" };
    const authValueEl = { value: "" };

    persistSessionAuthToken({
      sessionStoreKey: "test.session.auth",
      authModeEl,
      authValueEl,
    });

    expect(globalThis.sessionStorage.getItem("test.session.auth")).toBeNull();
  });
});
