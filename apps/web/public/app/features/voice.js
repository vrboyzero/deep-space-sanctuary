function createNoopVoiceInputController() {
  return {
    isSupported: false,
    isRecording() {
      return false;
    },
    async toggle() {
      return false;
    },
    updateTitle() {},
    dispose() {},
    getRuntimeSnapshot() {
      return {
        voiceButtonListenerCount: 0,
        activeTimerCount: 0,
        pendingMediaRequestCount: 0,
        activeStreamCount: 0,
        activeRecorderCount: 0,
        activeRecognitionCount: 0,
        pendingFileReaderCount: 0,
      };
    },
  };
}

function cloneShortcut(shortcut) {
  return shortcut ? { ...shortcut } : null;
}

export function createVoiceFeature({
  storageKey,
  disabledValue,
  defaultShortcut,
  promptEl,
  composerSection,
  voiceButtonEl,
  voiceDurationEl,
  getIsSettingsOpen,
  syncPromptHeight,
  estimateDataUrlBytes,
  estimatePendingAttachmentTotalBytes,
  getAttachmentLimits,
  formatBytes,
  addAttachment,
  renderAttachmentsPreview,
  onSendMessage,
  t = (_key, _params, fallback) => fallback ?? "",
  getSpeechRecognitionLocale = () => "zh-CN",
}) {
  let disposed = false;
  let shortcutBinding = loadVoiceShortcutSetting();
  let shortcutCaptureActive = false;
  let shortcutInputEl = null;
  let shortcutStatusEl = null;
  let shortcutDefaultBtn = null;
  let shortcutClearBtn = null;
  let globalKeyTarget = null;
  const settingsListenerEntries = [];
  let voiceInputController = initVoiceInput();

  function getDefaultVoiceShortcut() {
    return cloneShortcut(defaultShortcut);
  }

  function isVoiceShortcutFunctionKey(code) {
    return /^F\d{1,2}$/.test(code);
  }

  function isModifierOnlyCode(code) {
    return [
      "ControlLeft",
      "ControlRight",
      "AltLeft",
      "AltRight",
      "ShiftLeft",
      "ShiftRight",
      "MetaLeft",
      "MetaRight",
    ].includes(code);
  }

  function normalizeVoiceShortcut(shortcut) {
    if (!shortcut || typeof shortcut !== "object") return null;
    const code = typeof shortcut.code === "string" ? shortcut.code.trim() : "";
    if (!code || isModifierOnlyCode(code)) return null;
    const normalized = {
      code,
      ctrlKey: shortcut.ctrlKey === true,
      altKey: shortcut.altKey === true,
      shiftKey: shortcut.shiftKey === true,
      metaKey: shortcut.metaKey === true,
    };
    if (!isVoiceShortcutFunctionKey(code) && !(normalized.ctrlKey || normalized.altKey || normalized.metaKey)) {
      return null;
    }
    return normalized;
  }

  function loadVoiceShortcutSetting() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return getDefaultVoiceShortcut();
      if (raw === disabledValue) return null;
      return normalizeVoiceShortcut(JSON.parse(raw)) || getDefaultVoiceShortcut();
    } catch {
      return getDefaultVoiceShortcut();
    }
  }

  function formatVoiceShortcutKey(code) {
    if (typeof code !== "string" || !code) return "";
    if (code.startsWith("Key")) return code.slice(3).toUpperCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) {
      const suffix = code.slice(6);
      const mapped = {
        Add: "Num+",
        Subtract: "Num-",
        Multiply: "Num*",
        Divide: "Num/",
        Decimal: "Num.",
        Enter: "NumEnter",
      };
      return mapped[suffix] || `Num${suffix}`;
    }
    const mapped = {
      Space: "Space",
      Escape: "Esc",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Backquote: "`",
      Minus: "-",
      Equal: "=",
      BracketLeft: "[",
      BracketRight: "]",
      Backslash: "\\",
      Semicolon: ";",
      Quote: "'",
      Comma: ",",
      Period: ".",
      Slash: "/",
      Enter: "Enter",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
    };
    return mapped[code] || code;
  }

  function formatVoiceShortcut(shortcut) {
    if (!shortcut) return t("voice.shortcutDisabled", {}, "Disabled");
    const parts = [];
    if (shortcut.ctrlKey) parts.push("Ctrl");
    if (shortcut.altKey) parts.push("Alt");
    if (shortcut.shiftKey) parts.push("Shift");
    if (shortcut.metaKey) parts.push("Meta");
    parts.push(formatVoiceShortcutKey(shortcut.code));
    return parts.join("+");
  }

  function describeVoiceShortcutForTitle() {
    return shortcutBinding
      ? t("voice.titleWithShortcut", { shortcut: formatVoiceShortcut(shortcutBinding) }, "Voice input (click or {shortcut} to toggle recording)")
      : t("voice.titleWithoutShortcut", {}, "Voice input (click to toggle recording)");
  }

  function buildVoiceShortcutFromEvent(event) {
    if (!event || typeof event.code !== "string") return null;
    return normalizeVoiceShortcut({
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });
  }

  function matchesVoiceShortcut(event, shortcut) {
    if (!shortcut) return false;
    return (
      event.code === shortcut.code &&
      event.ctrlKey === shortcut.ctrlKey &&
      event.altKey === shortcut.altKey &&
      event.shiftKey === shortcut.shiftKey &&
      event.metaKey === shortcut.metaKey
    );
  }

  function renderVoiceShortcutSetting(message = "") {
    if (shortcutInputEl) {
      shortcutInputEl.value = formatVoiceShortcut(shortcutBinding);
    }
    if (shortcutStatusEl) {
      if (shortcutCaptureActive) {
        shortcutStatusEl.textContent = message || t("voice.shortcutCapture", {}, "Press a new shortcut. Esc cancels, Backspace/Delete disables it.");
      } else if (message) {
        shortcutStatusEl.textContent = message;
      } else {
        shortcutStatusEl.textContent = t(
          "voice.shortcutStatus",
          {
            current: formatVoiceShortcut(shortcutBinding),
            default: formatVoiceShortcut(defaultShortcut),
          },
          "Local shortcut, current: {current}. Default {default}. This is not written to server config.",
        );
      }
    }
  }

  function persistVoiceShortcutSetting(shortcut) {
    if (disposed) return;
    const normalized = normalizeVoiceShortcut(shortcut);
    shortcutBinding = shortcut === null ? null : (normalized || getDefaultVoiceShortcut());
    try {
      if (shortcutBinding === null) {
        localStorage.setItem(storageKey, disabledValue);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(shortcutBinding));
      }
    } catch {
      // ignore local persistence failures
    }
    renderVoiceShortcutSetting();
    voiceInputController.updateTitle();
  }

  function shouldHandleVoiceShortcut(event) {
    if (disposed) return false;
    if (!shortcutBinding || !voiceInputController.isSupported) return false;
    if (!matchesVoiceShortcut(event, shortcutBinding)) return false;
    if (event.defaultPrevented || event.repeat || event.isComposing) return false;
    if (shortcutCaptureActive) return false;
    if (getIsSettingsOpen?.()) return false;
    if (!composerSection || composerSection.classList.contains("hidden")) return false;
    return true;
  }

  function bindSettingsUI({ inputEl, statusEl, defaultBtn, clearBtn }) {
    if (disposed) return;
    unbindSettingsUI();
    shortcutInputEl = inputEl || null;
    shortcutStatusEl = statusEl || null;
    shortcutDefaultBtn = defaultBtn || null;
    shortcutClearBtn = clearBtn || null;

    const handleShortcutFocus = () => {
      if (disposed) return;
      shortcutCaptureActive = true;
      renderVoiceShortcutSetting(
        t("voice.shortcutCapture", {}, "Press a new shortcut. Esc cancels, Backspace/Delete disables it."),
      );
    };
    const handleShortcutBlur = () => {
      if (disposed) return;
      shortcutCaptureActive = false;
      renderVoiceShortcutSetting();
    };
    const handleShortcutKeydown = (event) => {
      if (disposed) return;
      if (event.key === "Tab") {
        shortcutCaptureActive = false;
        renderVoiceShortcutSetting();
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        shortcutCaptureActive = false;
        shortcutInputEl.blur();
        renderVoiceShortcutSetting();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        persistVoiceShortcutSetting(null);
        shortcutCaptureActive = false;
        shortcutInputEl.blur();
        renderVoiceShortcutSetting();
        return;
      }

      const nextShortcut = buildVoiceShortcutFromEvent(event);
      if (!nextShortcut) {
        renderVoiceShortcutSetting(
          t("voice.shortcutCapture", {}, "Press a new shortcut. Esc cancels, Backspace/Delete disables it."),
        );
        return;
      }

      persistVoiceShortcutSetting(nextShortcut);
      shortcutCaptureActive = false;
      shortcutInputEl.blur();
      renderVoiceShortcutSetting(
        t("voice.shortcutSaved", { shortcut: formatVoiceShortcut(nextShortcut) }, "Shortcut saved as {shortcut}."),
      );
    };
    const handleShortcutDefault = () => {
      if (disposed) return;
      persistVoiceShortcutSetting(getDefaultVoiceShortcut());
      renderVoiceShortcutSetting(
        t("voice.shortcutRestored", { shortcut: formatVoiceShortcut(shortcutBinding) }, "Restored default shortcut {shortcut}."),
      );
    };
    const handleShortcutClear = () => {
      if (disposed) return;
      persistVoiceShortcutSetting(null);
      renderVoiceShortcutSetting();
    };

    if (shortcutInputEl) {
      addSettingsListener(shortcutInputEl, "focus", handleShortcutFocus);
      addSettingsListener(shortcutInputEl, "blur", handleShortcutBlur);
      addSettingsListener(shortcutInputEl, "keydown", handleShortcutKeydown);
    }
    if (shortcutDefaultBtn) {
      addSettingsListener(shortcutDefaultBtn, "click", handleShortcutDefault);
    }
    if (shortcutClearBtn) {
      addSettingsListener(shortcutClearBtn, "click", handleShortcutClear);
    }
  }

  function addSettingsListener(target, type, handler) {
    target.addEventListener(type, handler);
    settingsListenerEntries.push({ target, type, handler });
  }

  function unbindSettingsUI() {
    for (const { target, type, handler } of settingsListenerEntries) {
      target.removeEventListener(type, handler);
    }
    settingsListenerEntries.length = 0;
    shortcutCaptureActive = false;
    shortcutInputEl = null;
    shortcutStatusEl = null;
    shortcutDefaultBtn = null;
    shortcutClearBtn = null;
  }

  function bindGlobalKeyTarget(target) {
    if (disposed || target === globalKeyTarget) return;
    if (globalKeyTarget) {
      globalKeyTarget.removeEventListener("keydown", handleGlobalKeydown);
    }
    globalKeyTarget = target || null;
    if (globalKeyTarget) {
      globalKeyTarget.addEventListener("keydown", handleGlobalKeydown);
    }
  }

  function onSettingsToggle(show) {
    if (disposed) return;
    if (show) {
      renderVoiceShortcutSetting();
      return;
    }
    shortcutCaptureActive = false;
  }

  function handleGlobalKeydown(event) {
    if (disposed || !shouldHandleVoiceShortcut(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    void voiceInputController.toggle();
    return true;
  }

  function initVoiceInput() {
    if (!voiceButtonEl) return createNoopVoiceInputController();

    const MediaRecorderCtor = window.MediaRecorder;
    const hasMediaRecorder = !!(navigator.mediaDevices?.getUserMedia && MediaRecorderCtor);
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasWebSpeech = !!SpeechRecognitionCtor;

    if (!hasMediaRecorder && !hasWebSpeech) {
      voiceButtonEl.style.display = "none";
      return createNoopVoiceInputController();
    }

    let activeMediaRecorder = null;
    let activeRecognition = null;
    let activeStream = null;
    let startTime = 0;
    let timerInterval = null;
    let isRecording = false;
    let voiceButtonListenerBound = false;
    let mediaGeneration = 0;
    const pendingMediaRequests = new Set();
    const pendingFileReaders = new Set();
    const stoppedStreams = new WeakSet();

    const controller = {
      isSupported: true,
      isRecording() {
        return isRecording;
      },
      async toggle() {
        if (disposed) return false;
        if (pendingMediaRequests.size > 0) {
          mediaGeneration += 1;
          return false;
        }
        if (isRecording || activeMediaRecorder || activeRecognition) {
          stopRecording();
          return false;
        }
        return startRecording();
      },
      updateTitle() {
        if (disposed) return;
        const title = describeVoiceShortcutForTitle();
        voiceButtonEl.title = title;
        voiceButtonEl.setAttribute("aria-label", title);
      },
      dispose: disposeVoiceInput,
      getRuntimeSnapshot() {
        return {
          voiceButtonListenerCount: voiceButtonListenerBound ? 1 : 0,
          activeTimerCount: timerInterval === null ? 0 : 1,
          pendingMediaRequestCount: pendingMediaRequests.size,
          activeStreamCount: activeStream ? 1 : 0,
          activeRecorderCount: activeMediaRecorder ? 1 : 0,
          activeRecognitionCount: activeRecognition ? 1 : 0,
          pendingFileReaderCount: pendingFileReaders.size,
        };
      },
    };

    function handleVoiceButtonClick() {
      if (disposed) return;
      void controller.toggle();
    }

    controller.updateTitle();
    voiceButtonEl.addEventListener("click", handleVoiceButtonClick);
    voiceButtonListenerBound = true;

    function stopOwnedStream(stream) {
      if (!stream || stoppedStreams.has(stream)) return;
      stoppedStreams.add(stream);
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Media cleanup is best-effort because a browser may revoke the stream concurrently.
      }
    }

    function reportStartFailure(error, generation) {
      if (disposed || generation !== mediaGeneration) return;
      console.error("Failed to start recording:", error);
      alert(t("voice.startFailed", { message: error?.message || String(error) }, "Failed to start recording: {message}"));
      isRecording = false;
      updateUI(false);
    }

    async function startRecording() {
      if (disposed || isRecording || activeMediaRecorder || activeRecognition || pendingMediaRequests.size > 0) {
        return false;
      }

      const generation = ++mediaGeneration;
      if (hasMediaRecorder) {
        pendingMediaRequests.add(generation);
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
          pendingMediaRequests.delete(generation);
          reportStartFailure(error, generation);
          return false;
        }
        pendingMediaRequests.delete(generation);

        // Permission prompts cannot be cancelled; stale grants must release tracks immediately.
        if (disposed || generation !== mediaGeneration) {
          stopOwnedStream(stream);
          return false;
        }

        try {
          let mimeType = "audio/webm;codecs=opus";
          if (!MediaRecorderCtor.isTypeSupported(mimeType)) {
            mimeType = "audio/mp4";
            if (!MediaRecorderCtor.isTypeSupported(mimeType)) {
              mimeType = "";
            }
          }

          const recorder = new MediaRecorderCtor(stream, mimeType ? { mimeType } : undefined);
          const audioChunks = [];
          activeStream = stream;
          activeMediaRecorder = recorder;

          recorder.ondataavailable = (event) => {
            if (disposed || activeMediaRecorder !== recorder) return;
            if (event.data.size > 0) audioChunks.push(event.data);
          };

          recorder.onstop = () => {
            stopOwnedStream(stream);
            if (activeStream === stream) activeStream = null;
            if (activeMediaRecorder === recorder) activeMediaRecorder = null;
            isRecording = false;
            updateUI(false);
            if (disposed) {
              audioChunks.length = 0;
              return;
            }

            const mime = recorder.mimeType || "audio/webm";
            const blob = new Blob(audioChunks, { type: mime });
            audioChunks.length = 0;
            const reader = new FileReader();
            pendingFileReaders.add(reader);
            reader.onloadend = () => {
              const wasPending = pendingFileReaders.delete(reader);
              reader.onloadend = null;
              if (!wasPending || disposed) return;

              const ext = mime.includes("mp4") ? "m4a" : (mime.includes("wav") ? "wav" : "webm");
              const fileName = `voice_${Date.now()}.${ext}`;
              const content = typeof reader.result === "string" ? reader.result : "";
              const audioBytes = estimateDataUrlBytes(content);
              const attachmentLimits = getAttachmentLimits();

              if (audioBytes > attachmentLimits.maxFileBytes) {
                renderAttachmentsPreview(
                  `⚠️ 语音附件未加入：${fileName} 超过单文件上限 ${formatBytes(attachmentLimits.maxFileBytes)}。`,
                );
                return;
              }
              if (estimatePendingAttachmentTotalBytes() + audioBytes > attachmentLimits.maxTotalBytes) {
                renderAttachmentsPreview(
                  `⚠️ 语音附件未加入：加入后总大小会超过 ${formatBytes(attachmentLimits.maxTotalBytes)}。`,
                );
                return;
              }

              addAttachment({ name: fileName, type: "audio", mimeType: mime, content });
              renderAttachmentsPreview();
              onSendMessage?.();
            };
            try {
              reader.readAsDataURL(blob);
            } catch (error) {
              pendingFileReaders.delete(reader);
              reader.onloadend = null;
              if (!disposed) console.error("Failed to read voice recording:", error);
            }
          };

          recorder.start();
          isRecording = true;
          updateUI(true);
          return true;
        } catch (error) {
          stopOwnedStream(stream);
          if (activeStream === stream) activeStream = null;
          activeMediaRecorder = null;
          reportStartFailure(error, generation);
          return false;
        }
      }

      if (hasWebSpeech) {
        try {
          const recognition = new SpeechRecognitionCtor();
          recognition.lang = getSpeechRecognitionLocale();
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;

          recognition.onstart = () => {
            if (disposed || activeRecognition !== recognition) return;
            isRecording = true;
            updateUI(true, "listening");
          };
          recognition.onresult = (event) => {
            if (disposed || activeRecognition !== recognition) return;
            const text = event.results[0][0].transcript;
            if (promptEl.value) promptEl.value += ` ${text}`;
            else promptEl.value = text;
            syncPromptHeight?.();
          };
          recognition.onerror = (event) => {
            if (disposed || activeRecognition !== recognition) return;
            console.error("Speech recognition error", event.error);
            stopRecording();
          };
          recognition.onend = () => {
            if (activeRecognition !== recognition) return;
            activeRecognition = null;
            isRecording = false;
            updateUI(false);
          };

          activeRecognition = recognition;
          recognition.start();
          return true;
        } catch (error) {
          activeRecognition = null;
          reportStartFailure(error, generation);
          return false;
        }
      }
      return false;
    }

    function stopRecording() {
      mediaGeneration += 1;
      isRecording = false;
      updateUI(false);

      const recorder = activeMediaRecorder;
      if (recorder) {
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          stopOwnedStream(activeStream);
          activeMediaRecorder = null;
          activeStream = null;
        }
        return;
      }

      const recognition = activeRecognition;
      if (recognition && typeof recognition.stop === "function") {
        try {
          recognition.stop();
        } catch {
          activeRecognition = null;
        }
      }
    }

    function clearRecordingTimer() {
      if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }

    function updateUI(recording, mode = "recording") {
      clearRecordingTimer();
      if (recording) {
        voiceButtonEl.classList.remove("recording", "listening");
        voiceButtonEl.classList.add(mode);
        if (voiceDurationEl) {
          voiceDurationEl.classList.remove("hidden");
          startTime = Date.now();
          voiceDurationEl.textContent = "00:00";
          timerInterval = setInterval(() => {
            if (disposed) return;
            const diff = Math.floor((Date.now() - startTime) / 1000);
            const m = Math.floor(diff / 60).toString().padStart(2, "0");
            const s = (diff % 60).toString().padStart(2, "0");
            voiceDurationEl.textContent = `${m}:${s}`;
          }, 1000);
        }
        return;
      }
      voiceButtonEl.classList.remove("recording", "listening");
      voiceDurationEl?.classList.add("hidden");
    }

    function disposeVoiceInput() {
      mediaGeneration += 1;
      clearRecordingTimer();
      isRecording = false;
      voiceButtonEl.classList.remove("recording", "listening");
      voiceDurationEl?.classList.add("hidden");

      if (voiceButtonListenerBound) {
        voiceButtonEl.removeEventListener("click", handleVoiceButtonClick);
        voiceButtonListenerBound = false;
      }

      for (const reader of pendingFileReaders) reader.onloadend = null;
      pendingFileReaders.clear();

      const recorder = activeMediaRecorder;
      activeMediaRecorder = null;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          // The stream cleanup below remains authoritative.
        }
      }

      const recognition = activeRecognition;
      activeRecognition = null;
      if (recognition) {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.stop?.();
        } catch {
          // Recognition may already have ended between pagehide and disposal.
        }
      }

      stopOwnedStream(activeStream);
      activeStream = null;
    }

    return controller;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    unbindSettingsUI();
    if (globalKeyTarget) {
      globalKeyTarget.removeEventListener("keydown", handleGlobalKeydown);
      globalKeyTarget = null;
    }
    voiceInputController.dispose();
  }

  function getRuntimeSnapshot() {
    const inputSnapshot = voiceInputController.getRuntimeSnapshot();
    return {
      listenerCount:
        settingsListenerEntries.length
        + (globalKeyTarget ? 1 : 0)
        + inputSnapshot.voiceButtonListenerCount,
      activeTimerCount: inputSnapshot.activeTimerCount,
      pendingMediaRequestCount: inputSnapshot.pendingMediaRequestCount,
      activeStreamCount: inputSnapshot.activeStreamCount,
      activeRecorderCount: inputSnapshot.activeRecorderCount,
      activeRecognitionCount: inputSnapshot.activeRecognitionCount,
      pendingFileReaderCount: inputSnapshot.pendingFileReaderCount,
      disposed,
    };
  }

  return {
    bindGlobalKeyTarget,
    bindSettingsUI,
    dispose,
    getRuntimeSnapshot,
    handleGlobalKeydown,
    onSettingsToggle,
    refreshLocale() {
      if (disposed) return;
      renderVoiceShortcutSetting();
      voiceInputController.updateTitle();
    },
  };
}
