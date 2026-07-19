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
  const voiceDurationEl = document.createElement("span");
  document.body.append(promptEl, composerSection, voiceButtonEl, voiceDurationEl);

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
      listenerCount: 7,
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
      activeRecognitionCount: 0,
      pendingFileReaderCount: 0,
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
