// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createVoiceFeature } from "./voice.js";

const originalMediaDevices = navigator.mediaDevices;
const originalMediaRecorder = window.MediaRecorder;
const originalSpeechRecognition = window.SpeechRecognition;
const originalWebkitSpeechRecognition = window.webkitSpeechRecognition;
const originalFileReader = window.FileReader;

function setBrowserValue(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
    writable: true,
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: () => [track],
    track,
  };
}

class FakeMediaRecorder {
  static instances = [];

  static isTypeSupported() {
    return true;
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || "audio/webm";
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

class DeferredFileReader {
  static instances = [];

  constructor() {
    this.onloadend = null;
    this.result = "data:audio/webm;base64,dm9pY2U=";
    DeferredFileReader.instances.push(this);
  }

  readAsDataURL(blob) {
    this.blob = blob;
  }
}

function installMediaRecorder(getUserMedia) {
  setBrowserValue(navigator, "mediaDevices", { getUserMedia });
  setBrowserValue(window, "MediaRecorder", FakeMediaRecorder);
  setBrowserValue(globalThis, "MediaRecorder", FakeMediaRecorder);
  setBrowserValue(window, "FileReader", DeferredFileReader);
  setBrowserValue(globalThis, "FileReader", DeferredFileReader);
  setBrowserValue(window, "SpeechRecognition", undefined);
  setBrowserValue(window, "webkitSpeechRecognition", undefined);
}

function createFeature(overrides = {}) {
  const promptEl = document.createElement("textarea");
  const composerSection = document.createElement("section");
  const voiceButtonEl = document.createElement("button");
  const naturalButtonEl = document.createElement("button");
  const voiceDurationEl = document.createElement("span");
  document.body.append(promptEl, composerSection, voiceButtonEl, naturalButtonEl, voiceDurationEl);

  const callbacks = {
    addAttachment: vi.fn(),
    renderAttachmentsPreview: vi.fn(),
    onSendMessage: vi.fn(),
    syncPromptHeight: vi.fn(),
  };
  const feature = createVoiceFeature({
    storageKey: "voice-shortcut-test",
    disabledValue: "disabled",
    defaultShortcut: {
      code: "KeyV",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    },
    promptEl,
    composerSection,
    voiceButtonEl,
    naturalButtonEl,
    voiceDurationEl,
    getIsSettingsOpen: () => false,
    syncPromptHeight: callbacks.syncPromptHeight,
    estimateDataUrlBytes: () => 16,
    estimatePendingAttachmentTotalBytes: () => 0,
    getAttachmentLimits: () => ({ maxFileBytes: 1024, maxTotalBytes: 2048 }),
    formatBytes: (value) => `${value} B`,
    addAttachment: callbacks.addAttachment,
    renderAttachmentsPreview: callbacks.renderAttachmentsPreview,
    onSendMessage: callbacks.onSendMessage,
    ...overrides,
  });

  return {
    callbacks,
    composerSection,
    feature,
    promptEl,
    voiceButtonEl,
    naturalButtonEl,
    voiceDurationEl,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  FakeMediaRecorder.instances = [];
  DeferredFileReader.instances = [];
  document.body.replaceChildren();
  localStorage.clear();
  setBrowserValue(navigator, "mediaDevices", originalMediaDevices);
  setBrowserValue(window, "MediaRecorder", originalMediaRecorder);
  setBrowserValue(globalThis, "MediaRecorder", originalMediaRecorder);
  setBrowserValue(window, "SpeechRecognition", originalSpeechRecognition);
  setBrowserValue(window, "webkitSpeechRecognition", originalWebkitSpeechRecognition);
  setBrowserValue(window, "FileReader", originalFileReader);
  setBrowserValue(globalThis, "FileReader", originalFileReader);
});

describe("voice feature lifecycle", () => {
  it("switches between the composer natural button and immediate manual recording", async () => {
    const stream = createStream();
    installMediaRecorder(vi.fn().mockResolvedValue(stream));
    const naturalController = {
      dispose: vi.fn(),
      getSnapshot: vi.fn(() => ({ state: "paused", hasMicrophone: false })),
      pause: vi.fn(),
      start: vi.fn().mockResolvedValue(true),
    };
    const { feature, naturalButtonEl, voiceButtonEl } = createFeature({
      createNaturalVoiceInputFactory: vi.fn(() => naturalController),
      modeStorageKey: "voice-mode-composer-test",
    });

    naturalButtonEl.click();
    await flushPromises();
    expect(naturalController.start).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("voice-mode-composer-test")).toBe("natural");
    expect(naturalButtonEl.getAttribute("aria-pressed")).toBe("true");

    voiceButtonEl.click();
    await flushPromises();
    expect(naturalController.pause).toHaveBeenCalledWith("manual_recording");
    expect(localStorage.getItem("voice-mode-composer-test")).toBe("manual");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      voiceMode: "manual",
      activeRecorderCount: 1,
      activeAudioWorkletCount: 0,
    });

    feature.dispose();
  });

  it("persists the user pause duration and exposes the normalized value", async () => {
    const naturalController = {
      dispose: vi.fn(),
      getSnapshot: vi.fn(() => ({ state: "paused", hasMicrophone: false })),
      pause: vi.fn(),
      start: vi.fn().mockResolvedValue(true),
    };
    localStorage.setItem("voice-silence-test", "invalid");
    const { feature } = createFeature({
      createNaturalVoiceInputFactory: vi.fn(() => naturalController),
      silenceStorageKey: "voice-silence-test",
    });
    const modeNaturalBtn = document.createElement("button");
    const silenceEl = document.createElement("input");
    const silenceValueEl = document.createElement("output");
    silenceEl.type = "range";
    silenceEl.min = "0.8";
    silenceEl.max = "5";
    silenceEl.step = "0.1";

    feature.bindSettingsUI({ modeNaturalBtn, silenceEl, silenceValueEl });
    expect(silenceEl.value).toBe("1.8");
    expect(feature.getRuntimeSnapshot().voiceSilenceMs).toBe(1_800);

    modeNaturalBtn.click();
    await flushPromises();
    silenceEl.value = "2.4";
    silenceEl.dispatchEvent(new Event("input"));

    expect(localStorage.getItem("voice-silence-test")).toBe("2400");
    expect(feature.getRuntimeSnapshot().voiceSilenceMs).toBe(2_400);
    expect(silenceValueEl.value).toBe("2.4 s");

    feature.dispose();
  });

  it("does not acquire the microphone when natural mode cannot send", async () => {
    const naturalController = {
      dispose: vi.fn(),
      getSnapshot: vi.fn(() => ({ state: "paused", hasMicrophone: false })),
      pause: vi.fn(),
      start: vi.fn().mockResolvedValue(true),
    };
    const onNaturalVoiceError = vi.fn();
    const { feature } = createFeature({
      canStartNaturalVoice: () => false,
      createNaturalVoiceInputFactory: vi.fn(() => naturalController),
      modeStorageKey: "voice-mode-offline-test",
      onNaturalVoiceError,
    });
    const modeNaturalBtn = document.createElement("button");

    feature.bindSettingsUI({ modeNaturalBtn });
    modeNaturalBtn.click();
    await flushPromises();

    expect(naturalController.start).not.toHaveBeenCalled();
    expect(onNaturalVoiceError).toHaveBeenCalledWith(expect.objectContaining({ code: "not_connected" }));
    expect(localStorage.getItem("voice-mode-offline-test")).toBe("manual");

    feature.dispose();
  });

  it("settles a natural turn without mutating the manual attachment queue", async () => {
    let naturalCallbacks;
    const naturalController = {
      dispose: vi.fn(),
      getSnapshot: vi.fn(() => ({ state: "paused", hasMicrophone: false })),
      pause: vi.fn(),
      start: vi.fn().mockResolvedValue(true),
    };
    const onNaturalTurnReady = vi.fn().mockResolvedValue(undefined);
    const { callbacks, feature } = createFeature({
      createNaturalVoiceInputFactory: vi.fn((options) => {
        naturalCallbacks = options;
        return naturalController;
      }),
      onNaturalTurnReady,
    });

    await naturalCallbacks.onTurnReady({
      blob: new Blob(["voice"], { type: "audio/wav" }),
      durationMs: 640,
      mimeType: "audio/wav",
      reason: "silence",
      signal: new AbortController().signal,
    });

    expect(onNaturalTurnReady).toHaveBeenCalledWith(expect.objectContaining({
      attachment: expect.objectContaining({
        name: expect.stringMatching(/^natural_voice_\d+\.wav$/),
        type: "audio",
        mimeType: "audio/wav",
        content: expect.stringMatching(/^data:audio\/wav/),
      }),
      durationMs: 640,
      reason: "silence",
    }));
    expect(callbacks.addAttachment).not.toHaveBeenCalled();
    expect(callbacks.onSendMessage).not.toHaveBeenCalled();

    feature.dispose();
  });

  it("starts remembered natural mode only after an explicit user action", async () => {
    const naturalController = {
      dispose: vi.fn(),
      getSnapshot: vi.fn(() => ({ state: "paused", hasMicrophone: false })),
      pause: vi.fn(),
      start: vi.fn().mockResolvedValue(true),
    };
    const createNaturalVoiceInputFactory = vi.fn(() => naturalController);
    const naturalStatusEl = document.createElement("span");
    localStorage.setItem("voice-mode-test", "natural");
    const { feature } = createFeature({
      createNaturalVoiceInputFactory,
      modeStorageKey: "voice-mode-test",
      naturalStatusEl,
      sensitivityStorageKey: "voice-sensitivity-test",
    });
    const modeManualBtn = document.createElement("button");
    const modeNaturalBtn = document.createElement("button");
    const sensitivityEl = document.createElement("select");
    const modeStatusEl = document.createElement("span");

    feature.bindSettingsUI({ modeManualBtn, modeNaturalBtn, modeStatusEl, sensitivityEl });
    expect(createNaturalVoiceInputFactory).toHaveBeenCalledTimes(1);
    expect(naturalController.start).not.toHaveBeenCalled();
    expect(modeNaturalBtn.getAttribute("aria-pressed")).toBe("true");
    expect(naturalStatusEl.classList.contains("hidden")).toBe(false);

    modeNaturalBtn.click();
    await flushPromises();
    expect(naturalController.start).toHaveBeenCalledTimes(1);

    modeManualBtn.click();
    expect(naturalController.pause).toHaveBeenCalledWith("manual_mode");
    expect(localStorage.getItem("voice-mode-test")).toBe("manual");
    expect(modeManualBtn.getAttribute("aria-pressed")).toBe("true");
    expect(naturalStatusEl.classList.contains("hidden")).toBe(true);

    feature.dispose();
    expect(naturalController.dispose).toHaveBeenCalledTimes(1);
  });

  it("owns settings, button, global key, timer, recorder, and stream resources", async () => {
    vi.useFakeTimers();
    const stream = createStream();
    installMediaRecorder(vi.fn().mockResolvedValue(stream));
    const { feature, voiceButtonEl } = createFeature();
    const inputEl = document.createElement("input");
    const statusEl = document.createElement("span");
    const defaultBtn = document.createElement("button");
    const clearBtn = document.createElement("button");

    feature.bindSettingsUI({ inputEl, statusEl, defaultBtn, clearBtn });
    feature.bindGlobalKeyTarget(document);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      listenerCount: 9,
      activeTimerCount: 0,
      disposed: false,
    });

    voiceButtonEl.click();
    await flushPromises();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      activeStreamCount: 1,
      activeRecorderCount: 1,
      pendingMediaRequestCount: 0,
    });

    feature.dispose();
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
    expect(feature.getRuntimeSnapshot()).toEqual({
      listenerCount: 0,
      activeTimerCount: 0,
      pendingMediaRequestCount: 0,
      activeStreamCount: 0,
      activeRecorderCount: 0,
      activeAudioWorkletCount: 0,
      activeAudioContextCount: 0,
      activeRecognitionCount: 0,
      pendingFileReaderCount: 0,
      pendingNaturalTurnCount: 0,
      voiceMode: "manual",
      voiceSensitivity: "standard",
      voiceSilenceMs: 1800,
      disposed: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    voiceButtonEl.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", ctrlKey: true }));
    defaultBtn.click();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(localStorage.getItem("voice-shortcut-test")).toBeNull();
  });

  it("stops tracks from a late getUserMedia grant after dispose", async () => {
    const permission = createDeferred();
    const stream = createStream();
    installMediaRecorder(vi.fn(() => permission.promise));
    const { feature, voiceButtonEl } = createFeature();

    voiceButtonEl.click();
    expect(feature.getRuntimeSnapshot().pendingMediaRequestCount).toBe(1);
    feature.dispose();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      pendingMediaRequestCount: 1,
      disposed: true,
    });

    permission.resolve(stream);
    await flushPromises();
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(feature.getRuntimeSnapshot().pendingMediaRequestCount).toBe(0);
  });

  it("ignores recorder and FileReader callbacks after dispose", async () => {
    const stream = createStream();
    installMediaRecorder(vi.fn().mockResolvedValue(stream));
    const { callbacks, feature, voiceButtonEl } = createFeature();

    voiceButtonEl.click();
    await flushPromises();
    const recorder = FakeMediaRecorder.instances[0];
    recorder.ondataavailable({ data: new Blob(["voice"], { type: "audio/webm" }) });
    voiceButtonEl.click();
    const reader = DeferredFileReader.instances[0];
    const lateReaderCallback = reader.onloadend;
    expect(feature.getRuntimeSnapshot().pendingFileReaderCount).toBe(1);

    feature.dispose();
    lateReaderCallback();
    expect(callbacks.addAttachment).not.toHaveBeenCalled();
    expect(callbacks.renderAttachmentsPreview).not.toHaveBeenCalled();
    expect(callbacks.onSendMessage).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot().pendingFileReaderCount).toBe(0);
  });

  it("preserves normal recording attachment settlement", async () => {
    const stream = createStream();
    installMediaRecorder(vi.fn().mockResolvedValue(stream));
    const { callbacks, feature, voiceButtonEl } = createFeature();

    voiceButtonEl.click();
    await flushPromises();
    const recorder = FakeMediaRecorder.instances[0];
    recorder.ondataavailable({ data: new Blob(["voice"], { type: "audio/webm" }) });
    voiceButtonEl.click();
    const reader = DeferredFileReader.instances[0];
    reader.onloadend();

    expect(callbacks.addAttachment).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^voice_\d+\.webm$/),
      type: "audio",
      mimeType: "audio/webm;codecs=opus",
      content: "data:audio/webm;base64,dm9pY2U=",
    }));
    expect(callbacks.renderAttachmentsPreview).toHaveBeenCalledWith();
    expect(callbacks.onSendMessage).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      activeStreamCount: 0,
      activeRecorderCount: 0,
      pendingFileReaderCount: 0,
      disposed: false,
    });
  });

  it("stops WebSpeech and ignores late result and end callbacks", () => {
    vi.useFakeTimers();
    const recognitions = [];
    class FakeSpeechRecognition {
      constructor() {
        this.stop = vi.fn();
        recognitions.push(this);
      }

      start() {
        this.onstart?.();
      }
    }
    setBrowserValue(navigator, "mediaDevices", undefined);
    setBrowserValue(window, "MediaRecorder", undefined);
    setBrowserValue(globalThis, "MediaRecorder", undefined);
    setBrowserValue(window, "SpeechRecognition", FakeSpeechRecognition);
    setBrowserValue(window, "webkitSpeechRecognition", undefined);
    const { callbacks, feature, promptEl, voiceButtonEl } = createFeature();

    voiceButtonEl.click();
    const recognition = recognitions[0];
    const lateResult = recognition.onresult;
    const lateEnd = recognition.onend;
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 1,
      activeRecognitionCount: 1,
    });

    feature.dispose();
    lateResult({ results: [[{ transcript: "late transcript" }]] });
    lateEnd();
    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(promptEl.value).toBe("");
    expect(callbacks.syncPromptHeight).not.toHaveBeenCalled();
    expect(feature.getRuntimeSnapshot()).toMatchObject({
      activeTimerCount: 0,
      activeRecognitionCount: 0,
      disposed: true,
    });
  });
});
