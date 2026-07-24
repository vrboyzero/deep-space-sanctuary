import {
  createPcmTurnBuffer,
  encodePcm16Wav,
  normalizeNaturalVoiceSilenceMs,
  resamplePcm,
} from "./natural-voice-audio.js";

const WORKLET_PROCESSOR_NAME = "belldandy-natural-voice-capture";
const DEFAULT_CONFIG = Object.freeze({
  maxTurnMs: 60_000,
  minSpeechMs: 240,
  prerollMs: 1_000,
  speechContinueThreshold: 0.028,
  speechEndMs: 1_800,
  speechStartMs: 160,
  speechStartThreshold: 0.045,
  targetSampleRate: 16_000,
});

function resolveRuntime(runtime = {}) {
  return {
    AudioContext: runtime.AudioContext
      || globalThis.AudioContext
      || globalThis.webkitAudioContext,
    AudioWorkletNode: runtime.AudioWorkletNode || globalThis.AudioWorkletNode,
    mediaDevices: runtime.mediaDevices || globalThis.navigator?.mediaDevices,
    workletModuleUrl: runtime.workletModuleUrl
      || new URL("./natural-voice-audio-worklet.js", import.meta.url).href,
  };
}

function normalizeConfig(config = {}) {
  const normalized = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(normalized)) {
    const value = Number(config[key]);
    if (Number.isFinite(value) && value > 0) normalized[key] = value;
  }
  const legacyThreshold = Number(config.speechThreshold);
  if (!Number.isFinite(Number(config.speechStartThreshold))
    && Number.isFinite(legacyThreshold)
    && legacyThreshold > 0) {
    normalized.speechStartThreshold = legacyThreshold;
  }
  normalized.speechEndMs = normalizeNaturalVoiceSilenceMs(normalized.speechEndMs);
  return normalized;
}

function toFloat32Array(samples) {
  if (samples instanceof Float32Array) return samples;
  if (ArrayBuffer.isView(samples) || Array.isArray(samples)) return Float32Array.from(samples);
  return new Float32Array(0);
}

function calculateRms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function normalizeThreshold(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

export function createNaturalVoiceInput({
  config: configInput,
  getSpeechEndMs: getSpeechEndMsInput,
  getSpeechThreshold: getSpeechThresholdInput,
  getSpeechThresholds: getSpeechThresholdsInput,
  onError = () => {},
  onSpeechStarted = () => {},
  onStateChange = () => {},
  onTurnReady = async () => {},
  runtime: runtimeInput,
} = {}) {
  const config = normalizeConfig(configInput);
  const runtime = resolveRuntime(runtimeInput);
  let state = "paused";
  let disposed = false;
  let generation = 0;
  let stream = null;
  let audioContext = null;
  let sourceNode = null;
  let workletNode = null;
  let silentGainNode = null;
  let pcmBuffer = null;
  let sampleRate = config.targetSampleRate;
  let recorderSession = null;
  let pendingTurnCount = 0;
  let pendingTurnController = null;
  let startPromise = null;
  const trackEndEntries = [];

  function getSnapshot() {
    return {
      state,
      hasMicrophone: Boolean(stream),
      isCapturing: state === "capturing",
      pendingTurnCount,
      activeFrameCount: 0,
      activeStreamCount: stream ? 1 : 0,
      activeRecorderCount: 0,
      activeAudioWorkletCount: workletNode ? 1 : 0,
      activeAudioContextCount: audioContext ? 1 : 0,
      disposed,
    };
  }

  function setState(nextState) {
    if (state === nextState) return;
    state = nextState;
    onStateChange(getSnapshot());
  }

  function stopStream(targetStream) {
    if (!targetStream) return;
    try {
      targetStream.getTracks().forEach((track) => track.stop());
    } catch {
      // The browser may revoke a track concurrently with local cleanup.
    }
  }

  function bindTrackEndListeners(targetStream) {
    for (const track of targetStream?.getTracks?.() || []) {
      if (typeof track?.addEventListener !== "function") continue;
      const handleEnded = () => {
        if (!disposed && stream === targetStream) {
          fail("microphone_ended", new Error("The microphone is no longer available."));
        }
      };
      track.addEventListener("ended", handleEnded);
      trackEndEntries.push({ handleEnded, track });
    }
  }

  function unbindTrackEndListeners() {
    for (const { handleEnded, track } of trackEndEntries) {
      track.removeEventListener?.("ended", handleEnded);
    }
    trackEndEntries.length = 0;
  }

  function getCurrentThresholds() {
    const dynamicThresholds = typeof getSpeechThresholdsInput === "function"
      ? getSpeechThresholdsInput()
      : null;
    const legacyStartThreshold = typeof getSpeechThresholdInput === "function"
      ? getSpeechThresholdInput()
      : undefined;
    const start = normalizeThreshold(
      dynamicThresholds?.start ?? legacyStartThreshold,
      config.speechStartThreshold,
    );
    const continuationFallback = Math.min(config.speechContinueThreshold, start * 0.75);
    const continuation = normalizeThreshold(
      dynamicThresholds?.continue,
      continuationFallback,
    );
    return {
      start,
      continue: Math.min(start, continuation),
    };
  }

  function getNextSpeechEndMs() {
    const dynamicValue = typeof getSpeechEndMsInput === "function"
      ? getSpeechEndMsInput()
      : config.speechEndMs;
    return normalizeNaturalVoiceSilenceMs(dynamicValue);
  }

  async function submitRecorderSession(session, pcm, reason, sessionGeneration) {
    if (disposed || sessionGeneration !== generation) return;
    if (pcm.length === 0 || session.voiceMs < config.minSpeechMs) {
      setState("listening");
      return;
    }

    const outputPcm = resamplePcm(pcm, sampleRate, config.targetSampleRate);
    const wav = encodePcm16Wav(outputPcm, config.targetSampleRate);
    const blob = new Blob([wav], { type: "audio/wav" });
    pendingTurnCount = 1;
    const turnController = new AbortController();
    pendingTurnController = turnController;
    setState("submitting");
    try {
      await onTurnReady({
        blob,
        durationMs: Math.round(pcm.length * 1_000 / sampleRate),
        mimeType: "audio/wav",
        reason,
        signal: turnController.signal,
      });
    } catch (error) {
      if (turnController.signal.aborted || disposed || sessionGeneration !== generation) return;
      fail("turn_submit_failed", error);
      return;
    } finally {
      if (pendingTurnController === turnController) {
        pendingTurnController = null;
        pendingTurnCount = 0;
      }
    }
    if (!disposed && sessionGeneration === generation && state !== "error") {
      setState("listening");
    }
  }

  function finishRecorderSession(shouldSubmit, reason) {
    const session = recorderSession;
    if (!session) return;
    recorderSession = null;
    if (!shouldSubmit) {
      pcmBuffer?.discardTurn();
      if (!disposed && state !== "paused" && state !== "error") setState("listening");
      return;
    }

    const trimEndSamples = reason === "silence" ? session.trailingSilenceSamples : 0;
    const pcm = pcmBuffer?.finishTurn({ trimEndSamples }) || new Float32Array(0);
    const sessionGeneration = generation;
    setState("submitting");
    void submitRecorderSession(session, pcm, reason, sessionGeneration);
  }

  function confirmRecorderSession(session) {
    if (session.confirmed) return;
    session.confirmed = true;
    setState("capturing");
    onSpeechStarted(getSnapshot());
  }

  function processPcmChunk(samplesInput) {
    if (disposed || !pcmBuffer) return;
    const samples = toFloat32Array(samplesInput);
    if (samples.length === 0) return;
    pcmBuffer.pushPreroll(samples);
    if (state === "preparing" || state === "submitting" || state === "paused" || state === "error") {
      return;
    }

    const chunkMs = samples.length * 1_000 / sampleRate;
    const level = calculateRms(samples);
    if (!recorderSession) {
      const thresholds = getCurrentThresholds();
      if (level < thresholds.start) return;
      pcmBuffer.beginTurn();
      recorderSession = {
        confirmed: false,
        elapsedMs: chunkMs,
        silenceMs: 0,
        speechEndMs: getNextSpeechEndMs(),
        thresholds,
        trailingSilenceSamples: 0,
        voiceMs: chunkMs,
      };
      if (recorderSession.voiceMs >= config.speechStartMs) {
        confirmRecorderSession(recorderSession);
      }
      return;
    }

    const session = recorderSession;
    pcmBuffer.appendTurn(samples);
    session.elapsedMs += chunkMs;
    const activeThreshold = session.confirmed
      ? session.thresholds.continue
      : session.thresholds.start;
    if (level >= activeThreshold) {
      session.silenceMs = 0;
      session.trailingSilenceSamples = 0;
      session.voiceMs += chunkMs;
      if (!session.confirmed && session.voiceMs >= config.speechStartMs) {
        confirmRecorderSession(session);
      }
    } else {
      session.silenceMs += chunkMs;
      session.trailingSilenceSamples += samples.length;
      if (session.confirmed && session.silenceMs >= session.speechEndMs) {
        finishRecorderSession(true, "silence");
        return;
      }
      if (!session.confirmed && session.silenceMs >= config.speechStartMs) {
        finishRecorderSession(false, "short_noise");
        return;
      }
    }

    if (recorderSession === session && session.elapsedMs >= config.maxTurnMs) {
      finishRecorderSession(session.confirmed, "max_duration");
    }
  }

  function handleWorkletMessage(event) {
    processPcmChunk(event?.data?.samples ?? event?.data);
  }

  function releaseMedia() {
    pendingTurnController?.abort();
    pendingTurnController = null;
    pendingTurnCount = 0;
    recorderSession = null;
    pcmBuffer?.discardTurn();
    pcmBuffer = null;

    if (workletNode?.port) {
      workletNode.port.onmessage = null;
      try {
        workletNode.port.close?.();
      } catch {
        // The message port may already be closed during browser teardown.
      }
    }
    for (const node of [sourceNode, workletNode, silentGainNode]) {
      try {
        node?.disconnect?.();
      } catch {
        // Audio nodes may already be disconnected by the browser.
      }
    }
    sourceNode = null;
    workletNode = null;
    silentGainNode = null;

    const context = audioContext;
    audioContext = null;
    try {
      void context?.close?.();
    } catch {
      // Closing an already closed AudioContext is harmless.
    }

    unbindTrackEndListeners();
    stopStream(stream);
    stream = null;
  }

  function fail(code, error) {
    generation += 1;
    releaseMedia();
    setState("error");
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    onError({ code, message: normalizedError.message, error: normalizedError });
  }

  async function startInternal() {
    if (disposed) return false;
    if (!runtime.mediaDevices?.getUserMedia || !runtime.AudioContext || !runtime.AudioWorkletNode) {
      fail("unsupported", new Error("Natural voice input requires AudioWorklet support."));
      return false;
    }

    const startGeneration = ++generation;
    setState("preparing");
    let nextStream;
    let nextContext;
    let nextSourceNode;
    let nextWorkletNode;
    let nextSilentGainNode;
    try {
      nextStream = await runtime.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (disposed || startGeneration !== generation) {
        stopStream(nextStream);
        return false;
      }
      nextContext = new runtime.AudioContext();
      if (nextContext.state === "suspended") await nextContext.resume();
      if (typeof nextContext.audioWorklet?.addModule !== "function") {
        throw new Error("AudioWorklet modules are not supported by this browser.");
      }
      await nextContext.audioWorklet.addModule(runtime.workletModuleUrl);
      if (disposed || startGeneration !== generation) {
        stopStream(nextStream);
        await nextContext.close?.();
        return false;
      }
      nextSourceNode = nextContext.createMediaStreamSource(nextStream);
      nextWorkletNode = new runtime.AudioWorkletNode(nextContext, WORKLET_PROCESSOR_NAME);
      nextSilentGainNode = nextContext.createGain();
      nextSilentGainNode.gain.value = 0;
      nextWorkletNode.port.onmessage = handleWorkletMessage;
      nextWorkletNode.port.start?.();
      nextWorkletNode.onprocessorerror = () => {
        if (!disposed && workletNode === nextWorkletNode) {
          fail("worklet_error", new Error("Natural voice audio processing stopped."));
        }
      };
      nextSourceNode.connect(nextWorkletNode);
      nextWorkletNode.connect(nextSilentGainNode);
      nextSilentGainNode.connect(nextContext.destination);

      stream = nextStream;
      audioContext = nextContext;
      sourceNode = nextSourceNode;
      workletNode = nextWorkletNode;
      silentGainNode = nextSilentGainNode;
      sampleRate = normalizeThreshold(nextContext.sampleRate, config.targetSampleRate);
      pcmBuffer = createPcmTurnBuffer({ sampleRate, prerollMs: config.prerollMs });
      bindTrackEndListeners(nextStream);
      setState("listening");
      return true;
    } catch (error) {
      if (nextWorkletNode?.port) nextWorkletNode.port.onmessage = null;
      for (const node of [nextSourceNode, nextWorkletNode, nextSilentGainNode]) {
        try {
          node?.disconnect?.();
        } catch {
          // Partial audio graph cleanup remains best-effort.
        }
      }
      stopStream(nextStream);
      if (nextContext && audioContext !== nextContext) {
        try {
          await nextContext.close?.();
        } catch {
          // The context may already be closed after a partial setup failure.
        }
      }
      if (!disposed && startGeneration === generation) fail("start_failed", error);
      return false;
    }
  }

  function start() {
    if (disposed) return Promise.resolve(false);
    if (state === "listening" || state === "capturing" || state === "submitting") {
      return Promise.resolve(true);
    }
    if (startPromise) return startPromise;
    startPromise = startInternal().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  function pause(_reason = "user") {
    if (disposed) return;
    generation += 1;
    releaseMedia();
    setState("paused");
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    releaseMedia();
    state = "paused";
  }

  return {
    dispose,
    getSnapshot,
    pause,
    start,
  };
}
