function buildWebSocketUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

function readStartupObservability() {
  if (typeof globalThis !== "object" || !globalThis) return null;
  return globalThis.__SS_WEBCHAT_STARTUP__ ?? null;
}

function markStartupObservability(stage, extra = {}) {
  const startup = readStartupObservability();
  const markFn = typeof startup?.mark === "function" ? startup.mark : null;
  if (markFn) {
    return markFn(stage, extra);
  }
  try {
    console.info("[WebChat startup]", stage, extra);
  } catch {
    // ignore console failures
  }
  return null;
}

function ensureDisconnectHint(statusEl, message) {
  if (!statusEl?.parentElement) return;
  const existingHint = document.getElementById("status-hint");
  if (existingHint) {
    existingHint.textContent = message;
    return;
  }

  const hint = document.createElement("div");
  hint.id = "status-hint";
  hint.textContent = message;
  statusEl.parentElement.appendChild(hint);
}

function normalizeTokenValue(value) {
  if (value.startsWith("setup-")) return value;
  if (/^\d+-\d+$/.test(value)) return `setup-${value}`;
  return value;
}

export const PENDING_AGENT_SELECTION_KEY = "pending-agent-selection-id";

function normalizeAgentCandidate(candidate) {
  return typeof candidate === "string" ? candidate.trim() : "";
}

function hasAgentCandidate(agents, candidate) {
  const normalized = normalizeAgentCandidate(candidate);
  return Boolean(normalized) && agents.some((agent) => agent?.id === normalized);
}

export function resolvePreferredAgentSelection(agents, currentValue = "", savedValue = "", pendingValue = "") {
  const items = Array.isArray(agents) ? agents : [];

  if (hasAgentCandidate(items, pendingValue)) {
    return normalizeAgentCandidate(pendingValue);
  }
  if (hasAgentCandidate(items, currentValue)) {
    return normalizeAgentCandidate(currentValue);
  }
  if (hasAgentCandidate(items, savedValue)) {
    return normalizeAgentCandidate(savedValue);
  }
  return typeof items[0]?.id === "string" ? items[0].id : "";
}

export function syncAgentSelectOptions(agentSelectEl, agents) {
  if (!agentSelectEl) return;
  const items = Array.isArray(agents) ? agents : [];
  agentSelectEl.innerHTML = "";
  for (const agent of items) {
    if (!agent || typeof agent !== "object" || !agent.id) continue;
    const opt = document.createElement("option");
    opt.value = agent.id;
    opt.textContent = agent.displayName || agent.id;
    agentSelectEl.appendChild(opt);
  }
}

export const MANUAL_MODEL_SENTINEL = "__manual_model__";
export const MANUAL_MODEL_PREFIX = "manual:";

export function isManualModelValue(value) {
  return typeof value === "string" && value.trim().startsWith(MANUAL_MODEL_PREFIX);
}

export function parseManualModelValue(value) {
  if (!isManualModelValue(value)) return "";
  return value.trim().slice(MANUAL_MODEL_PREFIX.length).trim();
}

export function buildManualModelValue(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? `${MANUAL_MODEL_PREFIX}${normalized}` : "";
}

export function normalizeRequestFrame(frame, makeId = null) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return null;
  }

  const normalized = { ...frame };
  if (typeof normalized.type !== "string" || !normalized.type.trim()) {
    normalized.type = "req";
  }
  if ((typeof normalized.id !== "string" || !normalized.id.trim()) && typeof makeId === "function") {
    normalized.id = makeId();
  }
  if (normalized.type === "req" && (typeof normalized.method !== "string" || !normalized.method.trim())) {
    return null;
  }
  if (typeof normalized.id !== "string" || !normalized.id.trim()) {
    return null;
  }
  return normalized;
}

export function shouldClearTransientSetupTokenOnClose({ event, authMode, authValue }) {
  if (authMode !== "token") return false;
  const normalizedValue = typeof authValue === "string" ? authValue.trim() : "";
  if (!normalizedValue.startsWith("setup-")) return false;
  if (Number(event?.code) !== 4403) return false;
  const reason = typeof event?.reason === "string" ? event.reason.trim() : "";
  return reason.toLowerCase() === "invalid token";
}

export function formatModelOptionLabel(model, t = (_key, _params, fallback) => fallback ?? "") {
  if (!model || typeof model !== "object") return "";
  const baseLabel = model.displayName || model.model || model.id || t("composer.defaultModel", {}, "Default Model");
  const suffixes = [];
  if (model.authStatus === "missing") {
    suffixes.push(t("composer.modelAuthMissing", {}, "auth missing"));
  }
  return suffixes.length > 0 ? `${baseLabel} · ${suffixes.join(" · ")}` : baseLabel;
}

export function normalizeModelCatalogFilter(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function modelMatchesCatalogFilter(model, filterValue) {
  const normalizedFilter = normalizeModelCatalogFilter(filterValue);
  if (!normalizedFilter) return true;
  if (!model || typeof model !== "object") return false;
  const haystack = [
    model.displayName,
    model.model,
    model.id,
    model.providerLabel,
    model.providerId,
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedFilter);
}

export function buildModelCatalogGroups(models, currentDefault = "", preferredProviderIds = []) {
  const items = Array.isArray(models) ? models.filter((item) => item && typeof item === "object") : [];
  const normalizedCurrentDefault = typeof currentDefault === "string" ? currentDefault.trim() : "";
  const defaultModel = items.find((item) => item.id === normalizedCurrentDefault);
  const normalizedPreferredProviderIds = Array.isArray(preferredProviderIds)
    ? preferredProviderIds
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().toLowerCase())
    : [];
  const inferredPreferredProviderId =
    defaultModel?.providerId
    || items.find((item) => item.id === "primary")?.providerId
    || "";
  const preferredProviderOrder = normalizedPreferredProviderIds.length > 0
    ? normalizedPreferredProviderIds
    : inferredPreferredProviderId
      ? [String(inferredPreferredProviderId).trim().toLowerCase()]
      : [];

  const groups = new Map();
  for (const model of items) {
    const providerId = typeof model.providerId === "string" && model.providerId.trim() ? model.providerId.trim() : "custom";
    const providerOrderIndex = preferredProviderOrder.indexOf(providerId.toLowerCase());
    const existing = groups.get(providerId) ?? {
      providerId,
      providerLabel: typeof model.providerLabel === "string" && model.providerLabel.trim()
        ? model.providerLabel.trim()
        : providerId,
      preferred: providerOrderIndex >= 0,
      preferredOrder: providerOrderIndex >= 0 ? providerOrderIndex : Number.POSITIVE_INFINITY,
      hasReadyAuth: false,
      hasPrimarySource: false,
      models: [],
    };
    existing.preferred = existing.preferred || providerOrderIndex >= 0;
    existing.preferredOrder = Math.min(
      existing.preferredOrder,
      providerOrderIndex >= 0 ? providerOrderIndex : Number.POSITIVE_INFINITY,
    );
    existing.hasReadyAuth = existing.hasReadyAuth || model.authStatus !== "missing";
    existing.hasPrimarySource = existing.hasPrimarySource || model.source === "primary";
    existing.models.push(model);
    groups.set(providerId, existing);
  }

  const compareGroups = (left, right) => {
    if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
    if (left.preferredOrder !== right.preferredOrder) return left.preferredOrder - right.preferredOrder;
    if (left.hasReadyAuth !== right.hasReadyAuth) return left.hasReadyAuth ? -1 : 1;
    if (left.hasPrimarySource !== right.hasPrimarySource) return left.hasPrimarySource ? -1 : 1;
    return String(left.providerLabel).localeCompare(String(right.providerLabel), "zh-Hans-CN-u-co-pinyin");
  };

  const compareModels = (left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    if ((left.source === "primary") !== (right.source === "primary")) return left.source === "primary" ? -1 : 1;
    if ((left.authStatus !== "missing") !== (right.authStatus !== "missing")) return left.authStatus !== "missing" ? -1 : 1;
    return String(left.displayName || left.model || left.id).localeCompare(
      String(right.displayName || right.model || right.id),
      "zh-Hans-CN-u-co-pinyin",
    );
  };

  return [...groups.values()]
    .sort(compareGroups)
    .map((group) => ({
      ...group,
      models: [...group.models].sort(compareModels),
    }));
}

export function formatModelProviderGroupLabel(group, t = (_key, _params, fallback) => fallback ?? "") {
  if (!group || typeof group !== "object") return "";
  const suffixes = [];
  if (group.preferred) {
    suffixes.push(t("composer.modelProviderPreferred", {}, "preferred"));
  }
  if (!group.hasReadyAuth) {
    suffixes.push(t("composer.modelAuthMissing", {}, "auth missing"));
  }
  return suffixes.length > 0
    ? `${group.providerLabel} · ${suffixes.join(" · ")}`
    : String(group.providerLabel || "");
}

export function resolvePreferredModelSelection(models, currentValue = "", savedValue = "", manualEntrySupported = false) {
  const items = Array.isArray(models) ? models : [];
  const normalizedCurrent = typeof currentValue === "string" ? currentValue.trim() : "";
  const normalizedSaved = typeof savedValue === "string" ? savedValue.trim() : "";
  const hasListedModel = (candidate) => Boolean(candidate) && items.some((model) => model?.id === candidate);
  const hasManual = (candidate) => manualEntrySupported && Boolean(parseManualModelValue(candidate));

  if (hasListedModel(normalizedCurrent) || hasManual(normalizedCurrent)) {
    return normalizedCurrent;
  }
  if (hasListedModel(normalizedSaved) || hasManual(normalizedSaved)) {
    return normalizedSaved;
  }
  return "";
}

export function createChatNetworkFeature({
  refs,
  keys,
  getTransientUrlToken,
  getSocket,
  setSocket,
  getReady,
  setReady,
  persistConnectionFields,
  setStatus,
  safeJsonParse,
  makeId,
  debugLog,
  onHelloOk,
  onAgentListLoaded,
  onEvent,
  onConnectionStateChanged,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  const {
    statusEl,
    sendBtn,
    authModeEl,
    authValueEl,
    workspaceRootsEl,
    userUuidEl,
    agentSelectEl,
    modelPickerEl,
    modelFilterEl,
    modelSelectEl,
  } = refs;

  const {
    storeKey,
    sessionAuthTokenKey,
    workspaceRootsKey,
    uuidKey,
    agentIdKey,
    modelIdKey,
    clientId,
  } = keys;

  const pendingReq = new Map();
  let currentStatus = {
    key: "status.disconnected",
    params: {},
    fallback: "disconnected",
  };
  let lastModelListState = null;
  let lastAgentListState = null;

  function refreshModelFilterVisibility(models) {
    if (!modelFilterEl) return;
    modelFilterEl.classList.add("hidden");
    modelFilterEl.value = "";
  }

  function syncModelPickerVisibility() {
    if (!modelPickerEl) return;
    const hasVisibleControl =
      Boolean(modelFilterEl && !modelFilterEl.classList.contains("hidden"))
      || Boolean(modelSelectEl && !modelSelectEl.classList.contains("hidden"));
    modelPickerEl.classList.toggle("hidden", !hasVisibleControl);
  }

  function upsertManualModelOption(manualValue) {
    if (!modelSelectEl) return;
    const manualModel = parseManualModelValue(manualValue);
    if (!manualModel) return;

    let option = [...modelSelectEl.options].find((item) => isManualModelValue(item.value));
    if (!option) {
      option = document.createElement("option");
      const manualEntryOption = [...modelSelectEl.options].find((item) => item.value === MANUAL_MODEL_SENTINEL);
      if (manualEntryOption?.parentNode) {
        manualEntryOption.parentNode.insertBefore(option, manualEntryOption);
      } else {
        modelSelectEl.appendChild(option);
      }
    }
    option.value = manualValue;
    option.textContent = t(
      "composer.manualModelSelected",
      { name: manualModel },
      `Manual Model (${manualModel})`,
    );
  }

  function promptManualModelValue() {
    const promptFn = typeof globalThis.prompt === "function" ? globalThis.prompt.bind(globalThis) : null;
    if (!promptFn) return "";
    const previousManual = parseManualModelValue(localStorage.getItem(modelIdKey) || "");
    return buildManualModelValue(promptFn(
      t(
        "composer.manualModelPrompt",
        {},
        "Enter a model name to use with the current primary provider.",
      ),
      previousManual || "",
    ));
  }

  function isConnected() {
    return Boolean(getSocket() && getReady());
  }

  function applyLocalizedStatus() {
    setStatus(t(currentStatus.key, currentStatus.params, currentStatus.fallback));
  }

  function setLocalizedStatus(key, params = {}, fallback = key) {
    currentStatus = { key, params, fallback };
    applyLocalizedStatus();
  }

  function isAuthRejectedClose(event) {
    return Number(event?.code) === 4403;
  }

  function formatCloseReason(event, fallback) {
    const reason = typeof event?.reason === "string" ? event.reason.trim() : "";
    return reason || fallback;
  }

  function getStatusHintMessage(statusKey) {
    if (statusKey === "status.disconnectedRetrying") {
      return t(
        "status.disconnectHint",
        {},
        "If this persists in WSL, try accessing via IP (e.g. 172.x.x.x) instead of localhost.",
      );
    }
    if (statusKey === "status.authRequired") {
      return t(
        "status.authRequiredHint",
        {},
        "Enter the correct token/password in the Auth controls, then click Connect manually. If you just changed .env, restart the service first.",
      );
    }
    return "";
  }

  function teardown() {
    const socket = getSocket();
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore close failures
      }
    }
    setSocket(null);
    setReady(false);
  }

  function clearTransientSetupTokenAuth() {
    if (!authModeEl || !authValueEl) return;
    authValueEl.value = "";
    try {
      if (sessionAuthTokenKey) {
        globalThis.sessionStorage?.removeItem(sessionAuthTokenKey);
      }
    } catch {
      // ignore storage failures
    }
  }

  function sendConnect() {
    const socket = getSocket();
    if (!socket) return;

    const mode = authModeEl?.value || "none";
    const rawValue = authValueEl?.value.trim() || "";
    const uuid = userUuidEl ? userUuidEl.value.trim() : "";
    debugLog?.("[UUID] sendConnect", { hasUuid: Boolean(uuid) });

    const auth =
      mode === "token"
        ? { mode: "token", token: normalizeTokenValue(rawValue) }
        : mode === "password"
          ? { mode: "password", password: rawValue }
          : { mode: "none" };

    const connectFrame = {
      type: "connect",
      role: "web",
      clientId,
      auth,
      clientName: "belldandy-webchat",
      clientVersion: "0.0.0",
    };

    if (uuid) {
      connectFrame.userUuid = uuid;
      debugLog?.("[UUID] Adding UUID to connect frame");
    } else {
      debugLog?.("[UUID] No UUID to send in connect frame");
    }

    socket.send(JSON.stringify(connectFrame));
  }

  function sendReq(frame) {
    const socket = getSocket();
    if (!socket) return Promise.resolve(null);
    const normalizedFrame = normalizeRequestFrame(frame, makeId);
    if (!normalizedFrame) {
      debugLog?.("[ws] dropped invalid request frame", frame);
      return Promise.resolve(null);
    }
    const rawTimeoutMs = Number(normalizedFrame.timeoutMs);
    const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? rawTimeoutMs
      : 30_000;
    delete normalizedFrame.timeoutMs;

    socket.send(JSON.stringify(normalizedFrame));
    return new Promise((resolve) => {
      pendingReq.set(normalizedFrame.id, { resolve });
      setTimeout(() => {
        if (pendingReq.has(normalizedFrame.id)) {
          pendingReq.delete(normalizedFrame.id);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  async function loadAgentList() {
    if (!isConnected() || !agentSelectEl) return;
    const currentSelectedAgentId = typeof agentSelectEl.value === "string" ? agentSelectEl.value.trim() : "";
    const pendingSelectedAgentId = typeof sessionStorage?.getItem === "function"
      ? (sessionStorage.getItem(PENDING_AGENT_SELECTION_KEY) || "")
      : "";

    let res = await sendReq({
      type: "req",
      id: makeId(),
      method: "agents.roster.get",
    });

    if (!res || !res.ok || !Array.isArray(res.payload?.agents)) {
      res = await sendReq({
        type: "req",
        id: makeId(),
        method: "agents.list",
      });
    }

    if (!res || !res.ok || !Array.isArray(res.payload?.agents)) return;

    const agents = res.payload.agents;
    lastAgentListState = agents;
    syncAgentSelectOptions(agentSelectEl, agents);
    if (agents.length <= 1) {
      agentSelectEl.classList.add("hidden");
      const selectedAgentId = resolvePreferredAgentSelection(
        agents,
        currentSelectedAgentId,
        localStorage.getItem(agentIdKey) || "",
        pendingSelectedAgentId,
      );
      if (selectedAgentId) {
        agentSelectEl.value = selectedAgentId;
        localStorage.setItem(agentIdKey, selectedAgentId);
        if (selectedAgentId === pendingSelectedAgentId) {
          sessionStorage.removeItem(PENDING_AGENT_SELECTION_KEY);
        }
      }
      onAgentListLoaded?.(agents, selectedAgentId || agentSelectEl.value || agents[0]?.id || "");
      return;
    }

    const selectedAgentId = resolvePreferredAgentSelection(
      agents,
      currentSelectedAgentId,
      localStorage.getItem(agentIdKey) || "",
      pendingSelectedAgentId,
    );
    if (selectedAgentId) {
      agentSelectEl.value = selectedAgentId;
      localStorage.setItem(agentIdKey, selectedAgentId);
      if (selectedAgentId === pendingSelectedAgentId) {
        sessionStorage.removeItem(PENDING_AGENT_SELECTION_KEY);
      }
    }

    // agentSelect dropdown stays hidden — right-side Agent panel is used instead
    onAgentListLoaded?.(agents, selectedAgentId || agentSelectEl.value || agents[0]?.id || "");
    return agents;
  }

  async function loadModelList() {
    if (!isConnected() || !modelSelectEl) return;
    const modelCatalog = await requestModelCatalog();
    if (!modelCatalog) return;
    lastModelListState = modelCatalog;
    renderModelOptions(
      modelCatalog.models,
      modelCatalog.currentDefault,
      modelCatalog.preferredProviderIds,
      modelCatalog.manualEntrySupported,
    );
  }

  async function requestModelCatalog() {
    if (!isConnected()) return null;

    const res = await sendReq({
      type: "req",
      id: makeId(),
      method: "models.list",
    });

    if (!res || !res.ok || !Array.isArray(res.payload?.models)) return null;

    return {
      models: Array.isArray(res.payload.models) ? res.payload.models : [],
      currentDefault: typeof res.payload.currentDefault === "string" && res.payload.currentDefault.trim()
        ? res.payload.currentDefault.trim()
        : "primary",
      preferredProviderIds: Array.isArray(res.payload?.preferredProviderIds)
        ? res.payload.preferredProviderIds
        : [],
      manualEntrySupported: res.payload?.manualEntrySupported !== false,
    };
  }

  function renderModelOptions(models, currentDefault, preferredProviderIds = [], manualEntrySupported = false) {
    if (!modelSelectEl) return;

    const currentValue = modelSelectEl.value;
    const defaultModel = models.find((model) => model.id === currentDefault);
    const defaultLabel =
      formatModelOptionLabel(defaultModel, t) ||
      t("composer.defaultModel", {}, "Default Model");
    refreshModelFilterVisibility(models);
    const normalizedFilter = normalizeModelCatalogFilter(modelFilterEl?.value || "");
    const groupedModels = buildModelCatalogGroups(models, currentDefault, preferredProviderIds)
      .map((group) => ({
        ...group,
        models: group.models.filter((model) =>
          !normalizedFilter || model.id === currentValue || modelMatchesCatalogFilter(model, normalizedFilter)
        ),
      }))
      .filter((group) => group.models.length > 0);

    modelSelectEl.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = defaultLabel;
    modelSelectEl.appendChild(defaultOpt);

    for (const group of groupedModels) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = formatModelProviderGroupLabel(group, t);
      for (const model of group.models) {
        if (!model || typeof model !== "object") continue;
        if (model.id === currentDefault) continue;
        const opt = document.createElement("option");
        opt.value = model.id;
        opt.textContent = formatModelOptionLabel(model, t);
        optgroup.appendChild(opt);
      }
      if (optgroup.children.length > 0) {
        modelSelectEl.appendChild(optgroup);
      }
    }

    const saved = localStorage.getItem(modelIdKey);
    const preferredValue = resolvePreferredModelSelection(models, currentValue, saved || "", manualEntrySupported);
    if (isManualModelValue(preferredValue)) {
      upsertManualModelOption(preferredValue);
    }
    if (manualEntrySupported) {
      const manualOpt = document.createElement("option");
      manualOpt.value = MANUAL_MODEL_SENTINEL;
      manualOpt.textContent = t("composer.manualModelAction", {}, "Manual Model...");
      modelSelectEl.appendChild(manualOpt);
    }
    if (preferredValue && [...modelSelectEl.options].some((opt) => opt.value === preferredValue)) {
      modelSelectEl.value = preferredValue;
    } else {
      modelSelectEl.value = "";
    }

    modelSelectEl.classList.toggle("hidden", modelSelectEl.options.length <= 1 && !manualEntrySupported);
    syncModelPickerVisibility();
  }

  function connect() {
    const url = buildWebSocketUrl();
    markStartupObservability("chat-network.connect.called", {
      url,
      authMode: authModeEl?.value || "none",
      hasAuthValue: Boolean(authValueEl?.value?.trim?.()),
      hasUserUuid: Boolean(userUuidEl?.value?.trim?.()),
    });
    persistConnectionFields({
      storeKey,
      workspaceRootsKey,
      uuidKey,
      authModeEl,
      authValueEl,
      workspaceRootsEl,
      userUuidEl,
      transientUrlToken: getTransientUrlToken?.(),
    });

    teardown();

    markStartupObservability("chat-network.websocket.create", { url });
    const socket = new WebSocket(url);
    setSocket(socket);
    setReady(false);
    onConnectionStateChanged?.({ connected: false, ready: false });

    if (sendBtn) {
      sendBtn.disabled = true;
    }
    setLocalizedStatus("status.connecting", {}, "connecting");

    socket.addEventListener("open", () => {
      markStartupObservability("chat-network.websocket.open", { url });
      setLocalizedStatus("status.awaitingChallenge", {}, "connected (awaiting challenge)");
    });

    socket.addEventListener("error", () => {
      markStartupObservability("chat-network.websocket.error", { url });
    });

    socket.addEventListener("close", (event) => {
      markStartupObservability("chat-network.websocket.close", {
        url,
        code: Number(event?.code) || 0,
        reason: typeof event?.reason === "string" ? event.reason : "",
      });
      setReady(false);
      onConnectionStateChanged?.({ connected: false, ready: false });
      if (sendBtn) {
        sendBtn.disabled = true;
      }
      if (isAuthRejectedClose(event)) {
        if (shouldClearTransientSetupTokenOnClose({
          event,
          authMode: authModeEl?.value || "",
          authValue: authValueEl?.value || "",
        })) {
          clearTransientSetupTokenAuth();
        }
        const reason = formatCloseReason(event, "token required");
        setLocalizedStatus(
          "status.authRequired",
          { reason },
          `connection rejected (authentication required: ${reason})`,
        );
        ensureDisconnectHint(statusEl, getStatusHintMessage("status.authRequired"));
        return;
      }

      const url = buildWebSocketUrl();
      setLocalizedStatus("status.disconnectedRetrying", { url }, `disconnected (retrying ${url} in 3s...)`);
      ensureDisconnectHint(statusEl, getStatusHintMessage("status.disconnectedRetrying"));
      setTimeout(() => {
        const currentSocket = getSocket();
        if (!currentSocket || currentSocket.readyState === WebSocket.CLOSED) {
          connect();
        }
      }, 3000);
    });

    socket.addEventListener("message", (evt) => {
      const frame = safeJsonParse(evt.data);
      if (!frame || typeof frame !== "object") return;

      if (frame.type === "connect.challenge") {
        markStartupObservability("chat-network.connect.challenge", { url });
        sendConnect();
        return;
      }

      if (frame.type === "hello-ok") {
        markStartupObservability("chat-network.hello.ok", {
          url,
          clientId: frame.clientId || "",
        });
        setReady(true);
        onConnectionStateChanged?.({ connected: true, ready: true });
        if (sendBtn) {
          sendBtn.disabled = false;
        }
        setLocalizedStatus("status.ready", {}, "ready");
        onHelloOk?.(frame);
        return;
      }

      if (frame.type === "res") {
        const inflight = pendingReq.get(frame.id);
        if (inflight) {
          pendingReq.delete(frame.id);
          inflight.resolve(frame);
        }
        return;
      }

      if (frame.type === "event") {
        onEvent?.(frame.event, frame.payload || {});
      }
    });
  }

  if (modelSelectEl) {
    modelSelectEl.addEventListener("change", () => {
      if (modelSelectEl.value !== MANUAL_MODEL_SENTINEL) return;
      const manualValue = promptManualModelValue();
      if (manualValue) {
        upsertManualModelOption(manualValue);
        modelSelectEl.value = manualValue;
        return;
      }
      const fallbackValue = resolvePreferredModelSelection(
        lastModelListState?.models ?? [],
        "",
        localStorage.getItem(modelIdKey) || "",
        lastModelListState?.manualEntrySupported !== false,
      );
      modelSelectEl.value = fallbackValue;
    });
  }

  if (modelFilterEl) {
    modelFilterEl.addEventListener("input", () => {
      if (!lastModelListState) return;
      renderModelOptions(
        lastModelListState.models,
        lastModelListState.currentDefault,
        lastModelListState.preferredProviderIds,
        lastModelListState.manualEntrySupported,
      );
    });
  }

  syncModelPickerVisibility();

  return {
    connect,
    isConnected,
    loadAgentList,
    loadModelList,
    requestModelCatalog,
    refreshLocale() {
      applyLocalizedStatus();
      const statusHintMessage = getStatusHintMessage(currentStatus.key);
      if (statusHintMessage) {
        ensureDisconnectHint(statusEl, statusHintMessage);
      }
      if (lastModelListState) {
        renderModelOptions(
          lastModelListState.models,
          lastModelListState.currentDefault,
          lastModelListState.preferredProviderIds,
          lastModelListState.manualEntrySupported,
        );
      }
      if (lastAgentListState) {
        onAgentListLoaded?.(lastAgentListState, agentSelectEl?.value || lastAgentListState[0]?.id || "");
      }
    },
    sendReq,
    teardown,
  };
}
