// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatEventsFeature } from "./chat-events.js";

describe("chat events pairing", () => {
  it("pauses the assistant audio that it started automatically", () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const target = document.createElement("div");
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => target),
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      renderAssistantMessage: (element) => {
        element.innerHTML = '<audio controls src="/generated/reply.mp3"></audio>';
      },
    });

    feature.handleEvent("chat.final", { text: "reply" });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(feature.isAssistantAudioPlaying()).toBe(true);

    expect(feature.pauseAssistantAudio()).toBe(true);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(feature.isAssistantAudioPlaying()).toBe(false);

    feature.dispose();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("bounds tool notice dedupe keys and resets them with the connection generation", () => {
    const showNotice = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => document.createElement("div")),
      showNotice,
      dedupeMaxEntries: 2,
      getCanvasApp: () => null,
    });
    const switchFacet = (runId) => feature.handleEvent("tool_result", {
      runId,
      success: true,
      name: "switch_facet",
      output: "ok",
      metadata: {
        facetName: "coder",
        targetLabel: "root",
      },
    });

    switchFacet("run-1");
    switchFacet("run-2");
    switchFacet("run-3");
    switchFacet("run-3");
    switchFacet("run-1");

    expect(showNotice).toHaveBeenCalledTimes(4);
    expect(feature.getRetentionSnapshot()).toMatchObject({
      renderedToolResultPreviewKeyCount: 0,
      handledToolNoticeKeyCount: 2,
      evictedDedupeKeyCount: 2,
      generationClearCount: 0,
      disposed: false,
    });

    feature.clearGeneration();
    switchFacet("run-3");
    expect(showNotice).toHaveBeenCalledTimes(5);
    expect(feature.getRetentionSnapshot()).toMatchObject({
      handledToolNoticeKeyCount: 1,
      generationClearCount: 1,
    });

    feature.dispose();
    expect(feature.getRetentionSnapshot()).toMatchObject({
      renderedToolResultPreviewKeyCount: 0,
      handledToolNoticeKeyCount: 0,
      disposed: true,
    });
  });

  it("cancels the pending frame flush when clearing the connection generation", () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 42));
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => document.createElement("div")),
      queueGoalUpdateEvent: vi.fn(),
    });

    feature.handleEvent("goal.update", { goal: { id: "goal-pending" } });
    expect(feature.getRetentionSnapshot()).toMatchObject({
      pendingGoalUpdateCount: 1,
      pendingFrameFlush: true,
    });

    feature.clearGeneration();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(feature.getRetentionSnapshot()).toMatchObject({
      pendingGoalUpdateCount: 0,
      pendingSubtaskUpdateCount: 0,
      pendingFrameFlush: false,
    });
  });

  it("consumes structured budget exhaustion before the following error final", () => {
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => document.createElement("div")),
    });

    const handled = feature.handleEvent("agent.budget_exhausted", {
      conversationId: "conv-budget",
      budget: "tool_calls",
      limit: 32,
      observed: 33,
    });

    expect(handled).toBe(true);
  });

  it("delegates pairing.required to the provided WebChat approval handler", () => {
    const target = { innerHTML: "" };
    const appendMessage = vi.fn(() => target);
    const onPairingRequired = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage,
      onPairingRequired,
      escapeHtml: (value) => String(value),
    });

    const handled = feature.handleEvent("pairing.required", {
      code: "ABCD1234",
      message: "pairing required: approve this code to allow messages",
    });

    expect(handled).toBe(true);
    expect(appendMessage).toHaveBeenCalledWith("bot", "", expect.any(Object));
    expect(onPairingRequired).toHaveBeenCalledTimes(1);
    expect(onPairingRequired).toHaveBeenCalledWith({
      target,
      code: "ABCD1234",
      clientId: "",
      message: "pairing required: approve this code to allow messages",
    });
  });

  it("renders pairing fallback code as text when no HTML escaper is provided", () => {
    const target = document.createElement("div");
    const code = '</b><img src=x onerror="alert(1)">';
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => target),
    });

    const handled = feature.handleEvent("pairing.required", {
      code,
    });

    expect(handled).toBe(true);
    expect(target.querySelector("img")).toBeNull();
    expect(target.querySelector("[onerror]")).toBeNull();
    expect(target.textContent).toContain(code);
  });

  it("batches token and live update events into a single frame flush", () => {
    const frameCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });

    const updateTokenUsage = vi.fn();
    const setTokenUsageRunning = vi.fn();
    const queueGoalUpdateEvent = vi.fn();
    const onSubtaskUpdated = vi.fn();
    const onAgentStatusEvent = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => document.createElement("div")),
      onPairingRequired: vi.fn(),
      showRestartCountdown: vi.fn(),
      setTokenUsageRunning,
      updateTokenUsage,
      showTaskTokenResult: vi.fn(),
      onChannelSecurityPending: vi.fn(),
      queueGoalUpdateEvent,
      onSubtaskUpdated,
      onToolSettingsConfirmRequired: vi.fn(),
      onToolSettingsConfirmResolved: vi.fn(),
      onExternalOutboundConfirmRequired: vi.fn(),
      onExternalOutboundConfirmResolved: vi.fn(),
      onEmailOutboundConfirmRequired: vi.fn(),
      onEmailOutboundConfirmResolved: vi.fn(),
      onToolsConfigUpdated: vi.fn(),
      onConversationDigestUpdated: vi.fn(),
      stripThinkBlocks: (value) => value,
      configureMarkedOnce: vi.fn(),
      renderAssistantMessage: vi.fn(),
      updateMessageMeta: vi.fn(),
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "conv-1",
      onAgentStatusEvent,
      onConversationDelta: vi.fn(),
      onConversationFinal: vi.fn(),
      onConversationStopped: vi.fn(),
      getStoppedMessageText: () => "Interrupted",
      escapeHtml: (value) => String(value),
    });

    feature.handleEvent("agent.status", { conversationId: "conv-1", status: "running" });
    feature.handleEvent("token.usage", { inputTokens: 1 });
    feature.handleEvent("token.usage", { inputTokens: 3, retainedContextEstimate: { tokens: 12 }, nextTurnContextEstimate: { tokens: 20 } });
    feature.handleEvent("goal.update", { goal: { id: "goal-1", title: "v1" } });
    feature.handleEvent("goal.update", { goal: { id: "goal-1", title: "v2" } });
    feature.handleEvent("subtask.update", { item: { id: "task-1", title: "v1" } });
    feature.handleEvent("subtask.update", { item: { id: "task-1", title: "v2" } });

    expect(onAgentStatusEvent).toHaveBeenCalledTimes(1);
    expect(frameCallbacks).toHaveLength(1);
    expect(setTokenUsageRunning).not.toHaveBeenCalled();
    expect(updateTokenUsage).not.toHaveBeenCalled();
    expect(queueGoalUpdateEvent).not.toHaveBeenCalled();
    expect(onSubtaskUpdated).not.toHaveBeenCalled();

    frameCallbacks[0](0);

    expect(setTokenUsageRunning).toHaveBeenCalledWith(true);
    expect(updateTokenUsage).toHaveBeenCalledTimes(1);
    expect(updateTokenUsage).toHaveBeenCalledWith({ inputTokens: 3, retainedContextEstimate: { tokens: 12 }, nextTurnContextEstimate: { tokens: 20 } });
    expect(queueGoalUpdateEvent).toHaveBeenCalledTimes(1);
    expect(queueGoalUpdateEvent).toHaveBeenCalledWith({ goal: { id: "goal-1", title: "v2" } });
    expect(onSubtaskUpdated).toHaveBeenCalledTimes(1);
    expect(onSubtaskUpdated).toHaveBeenCalledWith({ item: { id: "task-1", title: "v2" } });
  });

  it("flushes distinct goal and subtask ids separately within the same frame", () => {
    const frameCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });

    const queueGoalUpdateEvent = vi.fn();
    const onSubtaskUpdated = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => document.createElement("div")),
      onPairingRequired: vi.fn(),
      showRestartCountdown: vi.fn(),
      setTokenUsageRunning: vi.fn(),
      updateTokenUsage: vi.fn(),
      showTaskTokenResult: vi.fn(),
      onChannelSecurityPending: vi.fn(),
      queueGoalUpdateEvent,
      onSubtaskUpdated,
      onToolSettingsConfirmRequired: vi.fn(),
      onToolSettingsConfirmResolved: vi.fn(),
      onExternalOutboundConfirmRequired: vi.fn(),
      onExternalOutboundConfirmResolved: vi.fn(),
      onEmailOutboundConfirmRequired: vi.fn(),
      onEmailOutboundConfirmResolved: vi.fn(),
      onToolsConfigUpdated: vi.fn(),
      onConversationDigestUpdated: vi.fn(),
      stripThinkBlocks: (value) => value,
      configureMarkedOnce: vi.fn(),
      renderAssistantMessage: vi.fn(),
      updateMessageMeta: vi.fn(),
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "",
      onAgentStatusEvent: vi.fn(),
      onConversationDelta: vi.fn(),
      onConversationFinal: vi.fn(),
      onConversationStopped: vi.fn(),
      getStoppedMessageText: () => "Interrupted",
      escapeHtml: (value) => String(value),
    });

    feature.handleEvent("goal.update", { goal: { id: "goal-1", title: "A" } });
    feature.handleEvent("goal.update", { goal: { id: "goal-2", title: "B" } });
    feature.handleEvent("subtask.update", { item: { id: "task-1", title: "A" } });
    feature.handleEvent("subtask.update", { item: { id: "task-2", title: "B" } });

    expect(frameCallbacks).toHaveLength(1);
    frameCallbacks[0](0);

    expect(queueGoalUpdateEvent).toHaveBeenCalledTimes(2);
    expect(queueGoalUpdateEvent).toHaveBeenNthCalledWith(1, { goal: { id: "goal-1", title: "A" } });
    expect(queueGoalUpdateEvent).toHaveBeenNthCalledWith(2, { goal: { id: "goal-2", title: "B" } });
    expect(onSubtaskUpdated).toHaveBeenCalledTimes(2);
    expect(onSubtaskUpdated).toHaveBeenNthCalledWith(1, { item: { id: "task-1", title: "A" } });
    expect(onSubtaskUpdated).toHaveBeenNthCalledWith(2, { item: { id: "task-2", title: "B" } });
  });

  it("forwards conversation.plan.updated to the plan panel callback", () => {
    const onConversationPlanUpdated = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => document.createElement("div")),
      onPairingRequired: vi.fn(),
      showRestartCountdown: vi.fn(),
      setTokenUsageRunning: vi.fn(),
      updateTokenUsage: vi.fn(),
      showTaskTokenResult: vi.fn(),
      onChannelSecurityPending: vi.fn(),
      queueGoalUpdateEvent: vi.fn(),
      onSubtaskUpdated: vi.fn(),
      onToolSettingsConfirmRequired: vi.fn(),
      onToolSettingsConfirmResolved: vi.fn(),
      onExternalOutboundConfirmRequired: vi.fn(),
      onExternalOutboundConfirmResolved: vi.fn(),
      onEmailOutboundConfirmRequired: vi.fn(),
      onEmailOutboundConfirmResolved: vi.fn(),
      onToolsConfigUpdated: vi.fn(),
      onConversationDigestUpdated: vi.fn(),
      onConversationPlanUpdated,
      stripThinkBlocks: (value) => value,
      configureMarkedOnce: vi.fn(),
      renderAssistantMessage: vi.fn(),
      updateMessageMeta: vi.fn(),
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "conv-plan",
      onAgentStatusEvent: vi.fn(),
      onConversationDelta: vi.fn(),
      onConversationFinal: vi.fn(),
      onConversationStopped: vi.fn(),
      getStoppedMessageText: () => "Interrupted",
      escapeHtml: (value) => String(value),
    });

    const handled = feature.handleEvent("conversation.plan.updated", {
      conversationId: "conv-plan",
      source: "tool",
      planState: { title: "Current plan" },
    });

    expect(handled).toBe(true);
    expect(onConversationPlanUpdated).toHaveBeenCalledWith({
      conversationId: "conv-plan",
      source: "tool",
      planState: { title: "Current plan" },
    });
  });

  it("replaces an empty streaming bubble with an interrupted system message when conversation.run.stopped arrives", () => {
    document.body.innerHTML = "<div id=\"messages\"></div>";
    const messagesEl = document.getElementById("messages");
    const appendMessage = vi.fn((kind, text) => {
      if (kind === "system") {
        const systemEl = document.createElement("div");
        systemEl.className = "system-msg";
        systemEl.textContent = text;
        messagesEl.appendChild(systemEl);
        return systemEl;
      }
      const wrapper = document.createElement("div");
      wrapper.className = `msg-wrapper ${kind}`;
      const bubble = document.createElement("div");
      bubble.className = `msg ${kind}`;
      bubble.textContent = text;
      wrapper.appendChild(bubble);
      messagesEl.appendChild(wrapper);
      return bubble;
    });
    const onConversationStopped = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage,
      onPairingRequired: vi.fn(),
      showRestartCountdown: vi.fn(),
      setTokenUsageRunning: vi.fn(),
      updateTokenUsage: vi.fn(),
      showTaskTokenResult: vi.fn(),
      onChannelSecurityPending: vi.fn(),
      queueGoalUpdateEvent: vi.fn(),
      onSubtaskUpdated: vi.fn(),
      onToolSettingsConfirmRequired: vi.fn(),
      onToolSettingsConfirmResolved: vi.fn(),
      onExternalOutboundConfirmRequired: vi.fn(),
      onExternalOutboundConfirmResolved: vi.fn(),
      onToolsConfigUpdated: vi.fn(),
      onConversationDigestUpdated: vi.fn(),
      stripThinkBlocks: (value) => value,
      configureMarkedOnce: vi.fn(),
      renderAssistantMessage: vi.fn(),
      updateMessageMeta: vi.fn(),
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "",
      onAgentStatusEvent: vi.fn(),
      onConversationDelta: vi.fn(),
      onConversationFinal: vi.fn(),
      onConversationStopped,
      getStoppedMessageText: () => "Interrupted",
      escapeHtml: (value) => String(value),
    });

    feature.beginStreamingReply({ timestampMs: 1, isLatest: false });
    expect(messagesEl.querySelectorAll(".msg-wrapper.bot")).toHaveLength(1);

    const handled = feature.handleEvent("conversation.run.stopped", {
      conversationId: "conv-stop",
      runId: "run-stop",
      reason: "Stopped by user.",
    });

    expect(handled).toBe(true);
    expect(onConversationStopped).toHaveBeenCalledWith({
      conversationId: "conv-stop",
      runId: "run-stop",
      reason: "Stopped by user.",
    });
    expect(messagesEl.querySelectorAll(".msg-wrapper.bot")).toHaveLength(0);
    expect(messagesEl.querySelector(".system-msg")?.textContent).toBe("Interrupted");
  });

  it("preserves the partial bubble and shows an interrupted state for the active conversation", () => {
    document.body.innerHTML = "<div id=\"messages\"></div>";
    const messagesEl = document.getElementById("messages");
    const appendMessage = vi.fn((kind, text) => {
      if (kind === "system") {
        const systemEl = document.createElement("div");
        systemEl.className = "system-msg";
        systemEl.textContent = text;
        messagesEl.appendChild(systemEl);
        return systemEl;
      }
      const wrapper = document.createElement("div");
      wrapper.className = `msg-wrapper ${kind}`;
      const bubble = document.createElement("div");
      bubble.className = `msg ${kind}`;
      bubble.textContent = text;
      wrapper.appendChild(bubble);
      messagesEl.appendChild(wrapper);
      return bubble;
    });
    const renderAssistantMessage = vi.fn((target, text) => {
      target.textContent = text;
    });
    const onConversationStopped = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage,
      renderAssistantMessage,
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "conv-interrupted",
      onConversationDelta: vi.fn(),
      onConversationFinal: vi.fn(),
      onConversationStopped,
      getStoppedMessageText: () => "Interrupted",
    });

    feature.beginStreamingReply({ timestampMs: 1, isLatest: false });
    feature.handleEvent("chat.delta", {
      conversationId: "conv-interrupted",
      delta: "partial answer",
    });

    const handled = feature.handleEvent("conversation.run.interrupted", {
      conversationId: "conv-interrupted",
      runId: "run-interrupted",
      reason: "provider_stream_error",
      hadPartialResponse: true,
    });

    expect(handled).toBe(true);
    expect(onConversationStopped).toHaveBeenCalledWith({
      conversationId: "conv-interrupted",
      runId: "run-interrupted",
      reason: "provider_stream_error",
      hadPartialResponse: true,
    });
    expect(messagesEl.querySelectorAll(".msg-wrapper.bot")).toHaveLength(1);
    expect(messagesEl.querySelector(".msg.bot")?.textContent).toBe("partial answer");
    expect(messagesEl.querySelectorAll(".system-msg")).toHaveLength(1);
    expect(messagesEl.querySelector(".system-msg")?.textContent).toBe("Interrupted");

    feature.handleEvent("chat.delta", {
      conversationId: "conv-interrupted",
      delta: "new reply",
    });
    expect(messagesEl.querySelectorAll(".msg-wrapper.bot")).toHaveLength(2);
  });

  it("does not change the active bubble when another conversation is interrupted", () => {
    document.body.innerHTML = "<div id=\"messages\"></div>";
    const messagesEl = document.getElementById("messages");
    const appendMessage = vi.fn((kind, text) => {
      if (kind === "system") {
        const systemEl = document.createElement("div");
        systemEl.className = "system-msg";
        systemEl.textContent = text;
        messagesEl.appendChild(systemEl);
        return systemEl;
      }
      const wrapper = document.createElement("div");
      wrapper.className = `msg-wrapper ${kind}`;
      const bubble = document.createElement("div");
      bubble.className = `msg ${kind}`;
      wrapper.appendChild(bubble);
      messagesEl.appendChild(wrapper);
      return bubble;
    });
    const renderAssistantMessage = vi.fn((target, text) => {
      target.textContent = text;
    });
    const onConversationStopped = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage,
      renderAssistantMessage,
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "conv-active",
      onConversationDelta: vi.fn(),
      onConversationStopped,
      getStoppedMessageText: () => "Interrupted",
    });

    feature.beginStreamingReply();
    feature.handleEvent("chat.delta", {
      conversationId: "conv-active",
      delta: "active partial",
    });
    const handled = feature.handleEvent("conversation.run.interrupted", {
      conversationId: "conv-background",
      runId: "run-background",
      hadPartialResponse: true,
    });
    feature.handleEvent("chat.delta", {
      conversationId: "conv-active",
      delta: " continues",
    });

    expect(handled).toBe(true);
    expect(onConversationStopped).toHaveBeenCalledWith({
      conversationId: "conv-background",
      runId: "run-background",
      hadPartialResponse: true,
    });
    expect(messagesEl.querySelectorAll(".msg-wrapper.bot")).toHaveLength(1);
    expect(messagesEl.querySelector(".msg.bot")?.textContent).toBe("active partial continues");
    expect(messagesEl.querySelector(".system-msg")).toBeNull();
  });

  it("measures 10/100/1000-character streaming renders without forwarding message content", () => {
    const target = document.createElement("div");
    const measureStreamingRender = vi.fn((input, render) => render());
    const renderAssistantMessage = vi.fn();
    const feature = createChatEventsFeature({
      appendMessage: vi.fn(() => target),
      renderAssistantMessage,
      measureStreamingRender,
      forceScrollToBottom: vi.fn(),
      getCanvasApp: () => null,
      getActiveConversationId: () => "",
    });

    feature.beginStreamingReply();
    feature.handleEvent("chat.delta", { delta: "a".repeat(10) });
    feature.handleEvent("chat.delta", { delta: "b".repeat(90) });
    feature.handleEvent("chat.delta", { delta: "c".repeat(900) });

    expect(measureStreamingRender).toHaveBeenNthCalledWith(
      1,
      { kind: "delta", renderedChars: 10 },
      expect.any(Function),
    );
    expect(measureStreamingRender).toHaveBeenNthCalledWith(
      2,
      { kind: "delta", renderedChars: 100 },
      expect.any(Function),
    );
    expect(measureStreamingRender).toHaveBeenNthCalledWith(
      3,
      { kind: "delta", renderedChars: 1000 },
      expect.any(Function),
    );
    expect(renderAssistantMessage).toHaveBeenCalledTimes(3);
    expect(measureStreamingRender.mock.calls.flatMap(([input]) => Object.values(input))).not.toContain("a".repeat(10));
  });
});
