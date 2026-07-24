import { isExperienceDraftGenerateNoticeEnabled } from "./experience-draft-notice-mode.js";
import { renderPairingRequiredFallback } from "./pairing-required-prompt.js";

export function createChatEventsFeature({
  appendMessage,
  showNotice,
  onPairingRequired,
  showRestartCountdown,
  setTokenUsageRunning,
  updateTokenUsage,
  showTaskTokenResult,
  onChannelSecurityPending,
  queueGoalUpdateEvent,
  onSubtaskUpdated,
  onToolSettingsConfirmRequired,
  onToolSettingsConfirmResolved,
  onExternalOutboundConfirmRequired,
  onExternalOutboundConfirmResolved,
  onEmailOutboundConfirmRequired,
  onEmailOutboundConfirmResolved,
  onToolsConfigUpdated,
  onConversationDigestUpdated,
  onConversationPlanUpdated,
  stripThinkBlocks,
  configureMarkedOnce,
  renderAssistantMessage,
  measureStreamingRender,
  updateMessageMeta,
  forceScrollToBottom,
  getCanvasApp,
  getActiveConversationId,
  onAgentStatusEvent,
  onConversationDelta,
  onConversationFinal,
  onConversationStopped,
  getStoppedMessageText,
  dedupeMaxEntries = 512,
  t = (_key, _params, fallback) => fallback ?? "",
}) {
  let botMessageEl = null;
  let botRawHtmlBuffer = "";
  let botMessageMeta = null;
  let pendingFrameFlushHandle = null;
  let cancelPendingFrameFlush = null;
  let pendingTokenUsagePayload = null;
  let pendingTokenUsageRunning = null;
  const pendingGoalUpdates = new Map();
  const pendingSubtaskUpdates = new Map();
  const renderedToolResultPreviewKeys = createBoundedKeySet(dedupeMaxEntries);
  const handledToolNoticeKeys = createBoundedKeySet(dedupeMaxEntries);
  let generationClearCount = 0;
  let disposed = false;
  let activeAssistantAudio = null;

  function scheduleFrameFlush() {
    if (pendingFrameFlushHandle !== null) {
      return;
    }
    const flush = () => {
      pendingFrameFlushHandle = null;
      cancelPendingFrameFlush = null;
      flushPendingUiEvents();
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      pendingFrameFlushHandle = globalThis.requestAnimationFrame(flush);
      cancelPendingFrameFlush = () => {
        globalThis.cancelAnimationFrame?.(pendingFrameFlushHandle);
      };
      return;
    }
    pendingFrameFlushHandle = globalThis.setTimeout(flush, 16);
    cancelPendingFrameFlush = () => {
      globalThis.clearTimeout(pendingFrameFlushHandle);
    };
  }

  function flushPendingUiEvents() {
    if (pendingTokenUsageRunning !== null) {
      setTokenUsageRunning?.(pendingTokenUsageRunning);
      pendingTokenUsageRunning = null;
    }

    if (pendingTokenUsagePayload) {
      updateTokenUsage?.(pendingTokenUsagePayload);
      pendingTokenUsagePayload = null;
    }

    if (pendingGoalUpdates.size > 0) {
      for (const payload of pendingGoalUpdates.values()) {
        queueGoalUpdateEvent?.(payload);
      }
      pendingGoalUpdates.clear();
    }

    if (pendingSubtaskUpdates.size > 0) {
      for (const payload of pendingSubtaskUpdates.values()) {
        onSubtaskUpdated?.(payload);
      }
      pendingSubtaskUpdates.clear();
    }
  }

  function resetStreamingState() {
    botMessageEl = null;
    botRawHtmlBuffer = "";
    botMessageMeta = null;
  }

  function beginStreamingReply(initialMeta = {}) {
    resetStreamingState();
    return ensureBotMessage(initialMeta);
  }

  function ensureBotMessage(initialMeta = {}) {
    if (!botMessageEl) {
      botMessageMeta = {
        timestampMs: typeof initialMeta.timestampMs === "number" ? initialMeta.timestampMs : Date.now(),
        displayTimeText: typeof initialMeta.displayTimeText === "string" ? initialMeta.displayTimeText : "",
        isLatest: Boolean(initialMeta.isLatest),
      };
      botMessageEl = appendMessage("bot", "", botMessageMeta);
      botRawHtmlBuffer = "";
    }
    return botMessageEl;
  }

  function renderStreamingMarkdown(rawText, kind = "delta") {
    const render = () => {
      const target = ensureBotMessage();
      botRawHtmlBuffer = rawText;
      renderAssistantMessage?.(target, botRawHtmlBuffer);
      if (botMessageMeta) {
        updateMessageMeta?.(target, { ...botMessageMeta, isLatest: true });
      }
      return target;
    };
    if (typeof measureStreamingRender === "function") {
      return measureStreamingRender({
        kind,
        renderedChars: typeof rawText === "string" ? rawText.length : 0,
      }, render);
    }
    return render();
  }

  function discardStreamingBubbleIfEmpty() {
    if (!botMessageEl) return false;
    const hasPartialText = typeof botRawHtmlBuffer === "string" && botRawHtmlBuffer.trim().length > 0;
    if (hasPartialText) return false;
    const wrapper = botMessageEl.closest(".msg-wrapper");
    wrapper?.remove();
    return true;
  }

  function autoplayAssistantAudio(target) {
    const audioEl = target?.querySelector("audio");
    if (!audioEl) return;
    pauseAssistantAudio();
    activeAssistantAudio = audioEl;
    const clearIfCurrent = () => {
      if (activeAssistantAudio === audioEl) activeAssistantAudio = null;
    };
    audioEl.addEventListener("ended", clearIfCurrent, { once: true });
    audioEl.addEventListener("pause", clearIfCurrent, { once: true });
    try {
      const playback = audioEl.play();
      playback?.catch?.((err) => {
        clearIfCurrent();
        console.warn("Auto-play blocked:", err);
      });
    } catch (err) {
      clearIfCurrent();
      console.warn("Auto-play blocked:", err);
    }
  }

  function pauseAssistantAudio() {
    const audioEl = activeAssistantAudio;
    if (!audioEl) return false;
    activeAssistantAudio = null;
    try {
      audioEl.pause();
    } catch {
      // Playback may have ended between voice detection and the pause request.
    }
    return true;
  }

  function isAssistantAudioPlaying() {
    return Boolean(activeAssistantAudio && !activeAssistantAudio.ended);
  }

  function isActiveConversationPayload(payload) {
    const activeConversationId = typeof getActiveConversationId === "function"
      ? getActiveConversationId()
      : "";
    const payloadConversationId = payload && typeof payload.conversationId === "string"
      ? payload.conversationId
      : "";
    if (!activeConversationId || !payloadConversationId) {
      return true;
    }
    return payloadConversationId === activeConversationId;
  }

  function clearPendingUiEvents() {
    cancelPendingFrameFlush?.();
    pendingFrameFlushHandle = null;
    cancelPendingFrameFlush = null;
    pendingTokenUsagePayload = null;
    pendingTokenUsageRunning = null;
    pendingGoalUpdates.clear();
    pendingSubtaskUpdates.clear();
  }

  function clearGeneration() {
    if (disposed) return;
    pauseAssistantAudio();
    clearPendingUiEvents();
    renderedToolResultPreviewKeys.clear();
    handledToolNoticeKeys.clear();
    resetStreamingState();
    generationClearCount += 1;
  }

  function dispose() {
    if (disposed) return;
    pauseAssistantAudio();
    clearPendingUiEvents();
    renderedToolResultPreviewKeys.dispose();
    handledToolNoticeKeys.dispose();
    resetStreamingState();
    disposed = true;
  }

  function getRetentionSnapshot() {
    const previewSnapshot = renderedToolResultPreviewKeys.getSnapshot();
    const noticeSnapshot = handledToolNoticeKeys.getSnapshot();
    return {
      renderedToolResultPreviewKeyCount: previewSnapshot.size,
      handledToolNoticeKeyCount: noticeSnapshot.size,
      dedupeMaxEntries: previewSnapshot.maxEntries,
      evictedDedupeKeyCount: previewSnapshot.evictedCount + noticeSnapshot.evictedCount,
      pendingGoalUpdateCount: pendingGoalUpdates.size,
      pendingSubtaskUpdateCount: pendingSubtaskUpdates.size,
      pendingFrameFlush: pendingFrameFlushHandle !== null,
      generationClearCount,
      disposed,
    };
  }

  function readRenderableToolResultHtml(payload) {
    if (!payload || payload.success !== true) {
      return null;
    }
    const output = typeof payload.output === "string" ? payload.output.trim() : "";
    if (!output) {
      return null;
    }
    const hasRenderableMedia = /<(?:img|video|audio)\b/i.test(output)
      || /(?:generated-image-result|generated-image-path|generated-image-meta)/i.test(output);
    if (!hasRenderableMedia) {
      return null;
    }
    const webPath = readToolResultWebPath(payload, output);
    return {
      html: output,
      webPath,
      runId: typeof payload.runId === "string" ? payload.runId.trim() : "",
    };
  }

  function readToolResultWebPath(payload, output) {
    const metadataWebPath = typeof payload?.metadata?.webPath === "string"
      ? payload.metadata.webPath.trim()
      : "";
    if (metadataWebPath) {
      return metadataWebPath;
    }
    const matched = output.match(/(?:src|href)\s*=\s*"([^"]*\/generated\/[^"]+)"/i);
    return matched?.[1]?.trim() || "";
  }

  function buildToolResultPreviewKey(info) {
    if (!info || !info.runId || !info.webPath) {
      return "";
    }
    return `${info.runId}::${info.webPath}`;
  }

  function renderToolResultPreview(payload) {
    const info = readRenderableToolResultHtml(payload);
    if (!info) {
      return false;
    }
    const previewKey = buildToolResultPreviewKey(info);
    if (previewKey && renderedToolResultPreviewKeys.has(previewKey)) {
      return false;
    }
    const bubble = appendMessage("bot", "", {
      timestampMs: Date.now(),
      isLatest: false,
    });
    if (!(bubble instanceof HTMLElement)) {
      return false;
    }
    renderAssistantMessage?.(bubble, info.html);
    updateMessageMeta?.(bubble, {
      timestampMs: Date.now(),
      isLatest: false,
    });
    if (previewKey) {
      renderedToolResultPreviewKeys.add(previewKey);
    }
    return true;
  }

  function readToolResultNoticeInfo(payload) {
    if (!payload || payload.success !== true) {
      return null;
    }
    const toolName = typeof payload.name === "string" ? payload.name.trim() : "";
    const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : null;
    if (toolName === "switch_faqi" && metadata) {
      const currentFaqi = typeof metadata.currentFaqi === "string" ? metadata.currentFaqi.trim() : "";
      const agentId = typeof metadata.agentId === "string" ? metadata.agentId.trim() : "";
      if (!currentFaqi) return null;
      return {
        key: `switch_faqi:${payload.runId || ""}:${agentId}:${currentFaqi}`,
        title: t("runtime.switchFaqiNoticeTitle", {}, "FAQI 已切换"),
        message: t(
          "runtime.switchFaqiNoticeMessage",
          { agentId: agentId || "default", faqi: currentFaqi },
          `Agent「${agentId || "default"}」已切换到 FAQI「${currentFaqi}」。`,
        ),
      };
    }
    if (toolName === "switch_facet" && metadata) {
      const facetName = typeof metadata.facetName === "string"
        ? metadata.facetName.trim()
        : (typeof metadata.facet_name === "string" ? metadata.facet_name.trim() : "");
      const targetLabel = typeof metadata.targetLabel === "string"
        ? metadata.targetLabel.trim()
        : (typeof metadata.label === "string"
          ? metadata.label.trim()
          : (typeof metadata.target === "string" ? metadata.target.trim() : ""));
      if (!facetName) return null;
      return {
        key: `switch_facet:${payload.runId || ""}:${targetLabel}:${facetName}`,
        title: t("runtime.switchFacetNoticeTitle", {}, "FACET 已切换"),
        message: t(
          "runtime.switchFacetNoticeMessage",
          { facet: facetName, target: targetLabel || "root" },
          `FACET 已切换为「${facetName}」(${targetLabel || "root"})。`,
        ),
      };
    }
    if (toolName === "switch_facet") {
      const output = typeof payload.output === "string" ? payload.output.trim() : "";
      const matched = output.match(/FACET(?:\s+模组)?已切换为[「"](.+?)[」"]\((.+?)\)/i);
      const facetName = matched?.[1]?.trim() || "";
      const targetLabel = matched?.[2]?.trim() || "";
      if (!facetName) return null;
      return {
        key: `switch_facet:${payload.runId || ""}:${targetLabel}:${facetName}`,
        title: t("runtime.switchFacetNoticeTitle", {}, "FACET 已切换"),
        message: t(
          "runtime.switchFacetNoticeMessage",
          { facet: facetName, target: targetLabel || "root" },
          `FACET 已切换为「${facetName}」(${targetLabel || "root"})。`,
        ),
      };
    }
    return null;
  }

  function maybeShowToolResultNotice(payload) {
    const info = readToolResultNoticeInfo(payload);
    if (!info?.key || handledToolNoticeKeys.has(info.key)) {
      return false;
    }
    handledToolNoticeKeys.add(info.key);
    showNotice?.(info.title, info.message, "success", 2600);
    return true;
  }

  function readExperienceDraftNoticeInfo(payload) {
    if (!isExperienceDraftGenerateNoticeEnabled()) {
      return null;
    }
    if (!payload || payload.kind !== "experience_draft_generated") {
      return null;
    }
    const candidateType = typeof payload.candidateType === "string" ? payload.candidateType.trim().toLowerCase() : "";
    if (candidateType !== "method" && candidateType !== "skill") {
      return null;
    }
    const candidateId = typeof payload.candidateId === "string" ? payload.candidateId.trim() : "";
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
    const key = `experience_draft_generated:${candidateType}:${candidateId || taskId || title}`;
    return {
      key,
      title: candidateType === "skill"
        ? t("memory.skillDraftGenerateSuccessTitle", {}, "Skill Draft 已生成")
        : t("memory.methodDraftGenerateSuccessTitle", {}, "Method Draft 已生成"),
      message: title
        || (candidateType === "skill"
          ? t("memory.skillDraftGenerateSuccessMessage", {}, "已为当前任务生成新的 Skill Draft。")
          : t("memory.methodDraftGenerateSuccessMessage", {}, "已为当前任务生成新的 Method Draft。")),
    };
  }

  function maybeShowExperienceDraftNotice(payload) {
    const info = readExperienceDraftNoticeInfo(payload);
    if (!info?.key || handledToolNoticeKeys.has(info.key)) {
      return false;
    }
    handledToolNoticeKeys.add(info.key);
    showNotice?.(info.title, info.message, "success", 2600);
    return true;
  }

  function handleEvent(event, payload) {
    if (disposed) return false;
    if (event === "pairing.required") {
      const code = payload && payload.code ? String(payload.code) : "";
      const target = ensureBotMessage();
      if (typeof onPairingRequired === "function") {
        onPairingRequired({
          target,
          code,
          clientId: payload && payload.clientId ? String(payload.clientId) : "",
          message: payload && payload.message ? String(payload.message) : "",
        });
        return true;
      }
      renderPairingRequiredFallback(target, { code, t });
      return true;
    }

    if (event === "agent.status") {
      onAgentStatusEvent?.(payload);
      if (payload && payload.status === "restarting" && payload.countdown !== undefined) {
        showRestartCountdown(payload.countdown, payload.reason || "");
      }
      if (isActiveConversationPayload(payload)) {
        pendingTokenUsageRunning = payload?.status === "running";
        scheduleFrameFlush();
      }
      return true;
    }

    if (event === "agent.budget_exhausted") {
      // 紧随其后的 error/final 会负责可见反馈；这里仅消费结构化诊断事件。
      return true;
    }

    if (event === "token.usage") {
      pendingTokenUsagePayload = payload || null;
      scheduleFrameFlush();
      return true;
    }

    if (event === "token.counter.result") {
      showTaskTokenResult(payload);
      return true;
    }

    if (event === "channel.security.pending") {
      onChannelSecurityPending?.(payload);
      return true;
    }

    if (event === "goal.update") {
      const goalId = typeof payload?.goal?.id === "string" ? payload.goal.id : "";
      if (goalId) {
        pendingGoalUpdates.set(goalId, payload);
        scheduleFrameFlush();
      } else {
        queueGoalUpdateEvent?.(payload);
      }
      return true;
    }

    if (event === "subtask.update") {
      const taskId = typeof payload?.item?.id === "string" ? payload.item.id : "";
      if (taskId) {
        pendingSubtaskUpdates.set(taskId, payload);
        scheduleFrameFlush();
      } else {
        onSubtaskUpdated?.(payload);
      }
      return true;
    }

    if (event === "tool_settings.confirm.required") {
      onToolSettingsConfirmRequired(payload);
      return true;
    }

    if (event === "tool_settings.confirm.resolved") {
      onToolSettingsConfirmResolved(payload);
      return true;
    }

    if (event === "external_outbound.confirm.required") {
      onExternalOutboundConfirmRequired?.(payload);
      return true;
    }

    if (event === "external_outbound.confirm.resolved") {
      onExternalOutboundConfirmResolved?.(payload);
      return true;
    }

    if (event === "email_outbound.confirm.required") {
      onEmailOutboundConfirmRequired?.(payload);
      return true;
    }

    if (event === "email_outbound.confirm.resolved") {
      onEmailOutboundConfirmResolved?.(payload);
      return true;
    }

    if (event === "tools.config.updated") {
      onToolsConfigUpdated(payload);
      return true;
    }

    if (event === "conversation.digest.updated") {
      onConversationDigestUpdated?.(payload);
      return true;
    }

    if (event === "conversation.plan.updated") {
      onConversationPlanUpdated?.(payload);
      return true;
    }

    if (event === "chat.delta") {
      const delta = payload && payload.delta ? String(payload.delta) : "";
      if (!delta) return true;
      onConversationDelta?.(payload);
      if (!isActiveConversationPayload(payload)) {
        return true;
      }
      renderStreamingMarkdown(botRawHtmlBuffer + delta, "delta");
      forceScrollToBottom();
      return true;
    }

    if (event === "chat.final") {
      const text = payload && payload.text ? String(payload.text) : "";
      onConversationFinal?.(payload);
      if (!isActiveConversationPayload(payload)) {
        return true;
      }
      const target = renderStreamingMarkdown(text, "final");
      const meta = payload?.messageMeta && typeof payload.messageMeta === "object"
        ? payload.messageMeta
        : {};
      if (meta && typeof meta === "object") {
        botMessageMeta = {
          timestampMs: typeof meta.timestampMs === "number" ? meta.timestampMs : (botMessageMeta?.timestampMs ?? Date.now()),
          displayTimeText: typeof meta.displayTimeText === "string" ? meta.displayTimeText : (botMessageMeta?.displayTimeText ?? ""),
          isLatest: meta.isLatest === true,
        };
        updateMessageMeta?.(target, { ...botMessageMeta, isLatest: true });
      } else if (botMessageMeta) {
        updateMessageMeta?.(target, { ...botMessageMeta, isLatest: true });
      }
      autoplayAssistantAudio(target);
      forceScrollToBottom();
      getCanvasApp()?.handleReactFinal(text);
      return true;
    }

    if (event === "conversation.run.stopped" || event === "conversation.run.interrupted") {
      onConversationStopped?.(payload);
      if (!isActiveConversationPayload(payload)) {
        return true;
      }
      const removedEmptyBubble = discardStreamingBubbleIfEmpty();
      if (event === "conversation.run.interrupted" || removedEmptyBubble) {
        appendMessage("system", getStoppedMessageText?.(payload) || t("common.interrupted", {}, "Interrupted"));
      }
      resetStreamingState();
      forceScrollToBottom();
      return true;
    }

    if (event === "canvas.update") {
      if (payload) {
      const canvasApp = getCanvasApp();
      const boardId = payload.boardId;
      const action = payload.action;
      const data = payload.payload;
      if (canvasApp && canvasApp.currentBoardId === boardId) {
          canvasApp.handleCanvasEvent(action, data);
        }
      }
      return true;
    }

    if (event === "tool_call") {
      if (!isActiveConversationPayload(payload)) {
        return true;
      }
      getCanvasApp()?.handleReactEvent("tool_call", payload);
      return true;
    }

    if (event === "tool_result") {
      if (!isActiveConversationPayload(payload)) {
        return true;
      }
      maybeShowToolResultNotice(payload);
      if (renderToolResultPreview(payload)) {
        forceScrollToBottom();
      }
      getCanvasApp()?.handleReactEvent("tool_result", payload);
      return true;
    }

    if (event === "tool_event") {
      if (!isActiveConversationPayload(payload)) {
        return true;
      }
      maybeShowExperienceDraftNotice(payload);
      getCanvasApp()?.handleReactEvent("tool_event", payload);
      return true;
    }

    return false;
  }

  return {
    beginStreamingReply,
    handleEvent,
    isAssistantAudioPlaying,
    pauseAssistantAudio,
    resetStreamingState,
    clearGeneration,
    dispose,
    getRetentionSnapshot,
  };
}

function createBoundedKeySet(maxEntriesValue) {
  const keys = new Set();
  const maxEntries = normalizeNonNegativeInteger(maxEntriesValue, 512);
  let evictedCount = 0;
  let disposed = false;

  return {
    has(key) {
      if (disposed || !keys.has(key)) return false;
      // 命中即变为最近使用，容量淘汰保留活跃 dedupe key。
      keys.delete(key);
      keys.add(key);
      return true;
    },
    add(key) {
      if (disposed || !key) return;
      keys.delete(key);
      keys.add(key);
      while (keys.size > maxEntries) {
        const oldest = keys.values().next().value;
        if (oldest === undefined) break;
        keys.delete(oldest);
        evictedCount += 1;
      }
    },
    clear() {
      if (disposed) return;
      keys.clear();
    },
    dispose() {
      keys.clear();
      disposed = true;
    },
    getSnapshot() {
      return {
        size: keys.size,
        maxEntries,
        evictedCount,
        disposed,
      };
    },
  };
}

function normalizeNonNegativeInteger(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
