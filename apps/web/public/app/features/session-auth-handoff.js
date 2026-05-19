const HANDOFF_PARAM = "authHandoff";
const HANDOFF_STORAGE_PREFIX = "belldandy.webchat.authHandoff.";
const HANDOFF_MAX_AGE_MS = 60 * 1000;

function safeLocalStorageRead(readFn) {
  try {
    return readFn(globalThis.localStorage);
  } catch {
    return undefined;
  }
}

function safeLocalStorageWrite(writeFn) {
  try {
    writeFn(globalThis.localStorage);
  } catch {
    // ignore storage failures
  }
}

function buildUrlWithHandoff(currentUrl, handoffId) {
  const base = globalThis.location?.href || "http://127.0.0.1/";
  const nextUrl = new URL(currentUrl || base, base);
  nextUrl.searchParams.set(HANDOFF_PARAM, handoffId);
  return nextUrl.toString();
}

function stripHandoffParam(currentLocation, currentHistory) {
  try {
    const params = new URLSearchParams(currentLocation.search);
    if (!params.has(HANDOFF_PARAM)) return;
    params.delete(HANDOFF_PARAM);
    const query = params.toString();
    const nextUrl = `${currentLocation.pathname}${query ? `?${query}` : ""}${currentLocation.hash || ""}`;
    currentHistory?.replaceState?.({}, "", nextUrl);
  } catch {
    // ignore URL rewrite failures
  }
}

export function createSessionAuthHandoffUrl({
  currentUrl = globalThis.location?.href || "/",
  authMode,
  authValue,
  now = Date.now(),
  idFactory,
} = {}) {
  const normalizedMode = typeof authMode === "string" ? authMode.trim() : "";
  const normalizedValue = typeof authValue === "string" ? authValue.trim() : "";
  if (normalizedMode !== "token" || !normalizedValue) {
    return currentUrl;
  }

  const handoffId = typeof idFactory === "function"
    ? String(idFactory())
    : `${now}-${Math.random().toString(36).slice(2, 10)}`;

  safeLocalStorageWrite((storage) => {
    storage.setItem(
      `${HANDOFF_STORAGE_PREFIX}${handoffId}`,
      JSON.stringify({
        mode: normalizedMode,
        value: normalizedValue,
        createdAt: now,
      }),
    );
  });

  return buildUrlWithHandoff(currentUrl, handoffId);
}

export function consumeSessionAuthHandoff({
  location = globalThis.location,
  history = globalThis.history,
  now = Date.now(),
  maxAgeMs = HANDOFF_MAX_AGE_MS,
} = {}) {
  try {
    const params = new URLSearchParams(location?.search || "");
    const handoffId = params.get(HANDOFF_PARAM);
    if (!handoffId) return null;

    const storageKey = `${HANDOFF_STORAGE_PREFIX}${handoffId}`;
    const raw = safeLocalStorageRead((storage) => storage.getItem(storageKey));
    safeLocalStorageWrite((storage) => storage.removeItem(storageKey));
    stripHandoffParam(location, history);

    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") return null;

    const mode = typeof payload.mode === "string" ? payload.mode.trim() : "";
    const value = typeof payload.value === "string" ? payload.value.trim() : "";
    const createdAt = Number(payload.createdAt);
    if (mode !== "token" || !value) return null;
    if (!Number.isFinite(createdAt) || now - createdAt > maxAgeMs) return null;

    return { mode, value };
  } catch {
    return null;
  }
}
