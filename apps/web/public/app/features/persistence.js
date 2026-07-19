import { createPanelTaskScope } from "./panel-task-scope.js";

function safeStorageRead(readFn) {
  try {
    return readFn(globalThis.localStorage);
  } catch {
    return undefined;
  }
}

function safeStorageWrite(writeFn) {
  try {
    writeFn(globalThis.localStorage);
  } catch {
    // ignore storage failures
  }
}

function safeSessionStorageRead(readFn) {
  try {
    return readFn(globalThis.sessionStorage);
  } catch {
    return undefined;
  }
}

function safeSessionStorageWrite(writeFn) {
  try {
    writeFn(globalThis.sessionStorage);
  } catch {
    // ignore storage failures
  }
}

export function restoreAuthFields({ storeKey, authModeEl, authValueEl }) {
  const raw = safeStorageRead((storage) => storage.getItem(storeKey));
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid auth storage payload");
    const mode = ["none", "token", "password"].includes(String(parsed.mode))
      ? String(parsed.mode)
      : "none";
    if (authModeEl) authModeEl.value = mode;
    if (authValueEl) authValueEl.value = "";
    safeStorageWrite((storage) => {
      // 升级时主动覆盖旧版 { mode, value }，避免明文 secret 在恢复后继续残留。
      storage.setItem(storeKey, JSON.stringify({ mode }));
    });
  } catch {
    if (authValueEl) authValueEl.value = "";
    safeStorageWrite((storage) => storage.removeItem(storeKey));
  }
}

export function persistAuthFields({ storeKey, authModeEl }) {
  if (!authModeEl) return;
  const mode = authModeEl.value;
  safeStorageWrite((storage) => {
    // localStorage 只保留非敏感模式，token/password 的生命周期由 CredentialSession 管理。
    storage.setItem(storeKey, JSON.stringify({ mode }));
  });
}

export function restoreSessionAuthToken({ sessionStoreKey, authModeEl, authValueEl, rememberSession = false }) {
  if (!sessionStoreKey || !authModeEl || !authValueEl) return null;
  if (rememberSession !== true) {
    safeSessionStorageWrite((storage) => storage.removeItem(sessionStoreKey));
    return null;
  }
  const token = safeSessionStorageRead((storage) => storage.getItem(sessionStoreKey));
  if (!token) return null;
  authModeEl.value = "token";
  authValueEl.value = String(token);
  return String(token);
}

export function persistSessionAuthToken({ sessionStoreKey, authModeEl, authValueEl, rememberSession = false }) {
  if (!sessionStoreKey || !authModeEl || !authValueEl) return;
  const mode = authModeEl.value;
  const value = authValueEl.value.trim();
  safeSessionStorageWrite((storage) => {
    if (rememberSession === true && mode === "token" && value) {
      storage.setItem(sessionStoreKey, value);
      return;
    }
    storage.removeItem(sessionStoreKey);
  });
}

export function restoreSessionAuthPreference({ rememberSessionKey, rememberSessionEl }) {
  if (!rememberSessionKey || !rememberSessionEl) return false;
  const rememberSession = safeSessionStorageRead((storage) => storage.getItem(rememberSessionKey)) === "true";
  rememberSessionEl.checked = rememberSession;
  return rememberSession;
}

export function persistSessionAuthPreference({ rememberSessionKey, rememberSessionEl }) {
  if (!rememberSessionKey || !rememberSessionEl) return false;
  const rememberSession = rememberSessionEl.checked === true;
  safeSessionStorageWrite((storage) => {
    if (rememberSession) {
      storage.setItem(rememberSessionKey, "true");
      return;
    }
    storage.removeItem(rememberSessionKey);
  });
  return rememberSession;
}

function syncRememberSessionControl({ authModeEl, rememberSessionEl }) {
  if (!rememberSessionEl) return;
  rememberSessionEl.disabled = authModeEl?.value !== "token";
}

export function createCredentialSession({
  storeKey,
  sessionStoreKey,
  rememberSessionKey,
  authModeEl,
  authValueEl,
  rememberSessionEl,
}) {
  let disposed = false;
  let controlsBound = false;
  let disposeHook = null;
  const listenerEntries = [];

  function addOwnedListener(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listenerEntries.push({ target, type, handler });
  }

  const credentialSession = {
    restore() {
      if (disposed) return null;
      restoreAuthFields({ storeKey, authModeEl, authValueEl });
      const rememberSession = restoreSessionAuthPreference({ rememberSessionKey, rememberSessionEl });
      const restoredToken = restoreSessionAuthToken({
        sessionStoreKey,
        authModeEl,
        authValueEl,
        rememberSession,
      });
      syncRememberSessionControl({ authModeEl, rememberSessionEl });
      return restoredToken;
    },
    persist() {
      if (disposed) return;
      persistAuthFields({ storeKey, authModeEl });
      const rememberSession = persistSessionAuthPreference({ rememberSessionKey, rememberSessionEl });
      persistSessionAuthToken({
        sessionStoreKey,
        authModeEl,
        authValueEl,
        rememberSession,
      });
      syncRememberSessionControl({ authModeEl, rememberSessionEl });
    },
    setCredential({ mode, value } = {}) {
      if (disposed) return;
      const normalizedMode = ["none", "token", "password"].includes(String(mode))
        ? String(mode)
        : "none";
      if (authModeEl) authModeEl.value = normalizedMode;
      if (authValueEl) {
        authValueEl.value = normalizedMode === "none" ? "" : String(value ?? "");
      }
      credentialSession.persist();
    },
    setMode(mode) {
      if (disposed) return;
      const normalizedMode = ["none", "token", "password"].includes(String(mode))
        ? String(mode)
        : "none";
      if (authModeEl) authModeEl.value = normalizedMode;
      if (authValueEl) authValueEl.value = "";
      credentialSession.persist();
    },
    bindControls({ onModeChange, onValueInput, onDispose } = {}) {
      if (disposed || controlsBound) return;
      controlsBound = true;
      disposeHook = typeof onDispose === "function" ? onDispose : null;
      addOwnedListener(authModeEl, "change", () => {
        if (disposed) return;
        onModeChange?.(authModeEl.value);
        credentialSession.setMode(authModeEl.value);
      });
      addOwnedListener(authValueEl, "input", () => {
        if (disposed) return;
        onValueInput?.(authValueEl.value);
        credentialSession.persist();
      });
      addOwnedListener(rememberSessionEl, "change", () => {
        if (disposed) return;
        credentialSession.persist();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { target, type, handler } of listenerEntries) {
        target.removeEventListener(type, handler);
      }
      listenerEntries.length = 0;
      // 页面生命周期结束时主动移除仍停留在 DOM input 中的敏感值。
      if (authValueEl) authValueEl.value = "";
      disposeHook?.();
      disposeHook = null;
    },
    getRuntimeSnapshot() {
      return {
        listenerCount: listenerEntries.length,
        disposed,
      };
    },
  };
  return credentialSession;
}

export function createModelSelectionPersistenceFeature({ select, storageKey } = {}) {
  const taskScope = createPanelTaskScope();

  function handleSelectionChange() {
    if (!taskScope.isActive() || !storageKey) return;
    const selected = select?.value || "";
    safeStorageWrite((storage) => {
      if (selected) {
        storage.setItem(storageKey, selected);
        return;
      }
      // 空选择表示继续使用服务端默认模型，不保留过期的本地覆盖值。
      storage.removeItem(storageKey);
    });
  }

  function activate() {
    if (!taskScope.activate()) return false;
    taskScope.addEventListener(select, "change", handleSelectionChange);
    return true;
  }

  function deactivate() {
    return taskScope.deactivate();
  }

  function dispose() {
    return taskScope.dispose();
  }

  function getRuntimeSnapshot() {
    const snapshot = taskScope.getRuntimeSnapshot();
    return {
      listenerCount: snapshot.listenerCount,
      disposed: snapshot.disposed,
    };
  }

  activate();

  return {
    activate,
    deactivate,
    dispose,
    getRuntimeSnapshot,
  };
}

export function restoreWorkspaceRootsField({ workspaceRootsKey, workspaceRootsEl }) {
  const saved = safeStorageRead((storage) => storage.getItem(workspaceRootsKey));
  if (saved && workspaceRootsEl) {
    workspaceRootsEl.value = saved;
  }
}

export function persistWorkspaceRootsField({ workspaceRootsKey, workspaceRootsEl }) {
  if (!workspaceRootsEl) return;
  safeStorageWrite((storage) => {
    storage.setItem(workspaceRootsKey, workspaceRootsEl.value);
  });
}

export function restoreUuidField({ uuidKey, userUuidEl }) {
  const saved = safeStorageRead((storage) => storage.getItem(uuidKey));
  if (saved && userUuidEl) {
    userUuidEl.value = saved;
  }
}

export function persistUuidField({ uuidKey, userUuidEl }) {
  if (!userUuidEl) return;
  safeStorageWrite((storage) => {
    storage.setItem(uuidKey, userUuidEl.value.trim());
  });
}

export function persistConnectionFields({
  storeKey,
  workspaceRootsKey,
  uuidKey,
  authModeEl,
  authValueEl,
  workspaceRootsEl,
  userUuidEl,
  transientUrlToken = null,
}) {
  persistAuthFields({ storeKey, authModeEl, authValueEl, transientUrlToken });
  persistWorkspaceRootsField({ workspaceRootsKey, workspaceRootsEl });
  persistUuidField({ uuidKey, userUuidEl });
}
