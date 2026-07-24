import { describe, expect, it, vi } from "vitest";

import { createNaturalVoiceInput } from "./natural-voice-input.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness() {
  const track = new EventTarget();
  track.stop = vi.fn();
  const stream = { getTracks: () => [track] };
  const source = { connect: vi.fn(), disconnect: vi.fn() };

  class FakeAudioContext {
    static instances = [];

    constructor() {
      this.state = "running";
      this.sampleRate = 1_000;
      this.destination = {};
      this.audioWorklet = {
        addModule: vi.fn().mockResolvedValue(undefined),
      };
      this.close = vi.fn().mockResolvedValue(undefined);
      this.resume = vi.fn().mockResolvedValue(undefined);
      FakeAudioContext.instances.push(this);
    }

    createMediaStreamSource() {
      return source;
    }

    createGain() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1 },
      };
    }
  }

  class FakeAudioWorkletNode {
    static instances = [];

    constructor(_context, name) {
      this.name = name;
      this.connect = vi.fn();
      this.disconnect = vi.fn();
      this.port = {
        close: vi.fn(),
        onmessage: null,
        start: vi.fn(),
      };
      FakeAudioWorkletNode.instances.push(this);
    }

    emit(samples) {
      this.port.onmessage?.({ data: { samples: Float32Array.from(samples) } });
    }
  }

  const mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
  };
  const runtime = {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    mediaDevices,
  };

  return {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    emit(level, durationMs) {
      const samples = new Float32Array(Math.max(1, Math.round(durationMs))).fill(level);
      FakeAudioWorkletNode.instances.at(-1)?.emit(samples);
    },
    mediaDevices,
    runtime,
    source,
    stream,
    track,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("natural voice input", () => {
  it("includes quiet audio from before the start threshold in the submitted WAV", async () => {
    const harness = createHarness();
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        minSpeechMs: 20,
        prerollMs: 30,
        speechContinueThreshold: 0.05,
        speechEndMs: 800,
        speechStartMs: 20,
        speechStartThreshold: 0.1,
      },
      onTurnReady,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.02, 10);
    harness.emit(0.2, 10);
    harness.emit(0.2, 10);
    harness.emit(0, 800);
    await flushPromises();

    expect(onTurnReady).toHaveBeenCalledTimes(1);
    const turn = onTurnReady.mock.calls[0][0];
    expect(turn.mimeType).toBe("audio/wav");
    const wav = await turn.blob.arrayBuffer();
    const samples = new Int16Array(wav.slice(44));
    expect(samples.length).toBe(480);
    expect(samples[0]).toBeGreaterThan(500);
    expect(samples[0]).toBeLessThan(800);
    expect(samples[320]).toBeGreaterThan(6_000);

    input.dispose();
  });

  it("closes partially initialized media when the worklet graph setup fails", async () => {
    const harness = createHarness();
    class FailingAudioContext extends harness.AudioContext {
      createMediaStreamSource() {
        throw new Error("audio graph unavailable");
      }
    }
    const onError = vi.fn();
    const input = createNaturalVoiceInput({
      onError,
      runtime: { ...harness.runtime, AudioContext: FailingAudioContext },
    });

    await expect(input.start()).resolves.toBe(false);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(FailingAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "start_failed" }));
    expect(input.getSnapshot()).toMatchObject({
      state: "error",
      activeAudioContextCount: 0,
      activeAudioWorkletCount: 0,
    });
  });

  it("uses the current start threshold without restarting the media session", async () => {
    const harness = createHarness();
    let threshold = 0.3;
    const onSpeechStarted = vi.fn();
    const input = createNaturalVoiceInput({
      config: { minSpeechMs: 100, speechStartMs: 100, speechThreshold: 0.1 },
      getSpeechThreshold: () => threshold,
      onSpeechStarted,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.2, 120);
    expect(input.getSnapshot()).toMatchObject({ state: "listening" });

    threshold = 0.1;
    harness.emit(0.2, 100);
    expect(onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(input.getSnapshot()).toMatchObject({
      state: "capturing",
      activeAudioWorkletCount: 1,
      activeRecorderCount: 0,
    });
    expect(harness.AudioWorkletNode.instances).toHaveLength(1);

    input.dispose();
  });

  it("reports an error and releases media when the microphone track ends", async () => {
    const harness = createHarness();
    const onError = vi.fn();
    const input = createNaturalVoiceInput({
      onError,
      runtime: harness.runtime,
    });

    await input.start();
    harness.track.dispatchEvent(new Event("ended"));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "microphone_ended" }));
    expect(input.getSnapshot()).toMatchObject({
      state: "error",
      hasMicrophone: false,
      activeAudioWorkletCount: 0,
      activeAudioContextCount: 0,
    });
  });

  it("reports an error and releases media when the worklet cannot start", async () => {
    const harness = createHarness();
    class FailingAudioWorkletNode {
      constructor() {
        throw new Error("worklet unavailable");
      }
    }
    const onError = vi.fn();
    const input = createNaturalVoiceInput({
      onError,
      runtime: { ...harness.runtime, AudioWorkletNode: FailingAudioWorkletNode },
    });

    await expect(input.start()).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "start_failed" }));
    expect(input.getSnapshot()).toMatchObject({
      state: "error",
      hasMicrophone: false,
      activeAudioWorkletCount: 0,
      activeAudioContextCount: 0,
    });
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
  });

  it("shares one permission request across repeated start calls", async () => {
    const harness = createHarness();
    const permission = createDeferred();
    harness.mediaDevices.getUserMedia = vi.fn(() => permission.promise);
    const input = createNaturalVoiceInput({ runtime: harness.runtime });

    const firstStart = input.start();
    const secondStart = input.start();
    expect(harness.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    permission.resolve(harness.stream);
    await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([true, true]);
    expect(input.getSnapshot()).toMatchObject({ state: "listening", hasMicrophone: true });

    input.dispose();
  });

  it("submits one WAV turn after sustained speech reaches the configured silence", async () => {
    const harness = createHarness();
    const onSpeechStarted = vi.fn();
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        maxTurnMs: 2_000,
        minSpeechMs: 100,
        speechEndMs: 800,
        speechStartMs: 100,
        speechThreshold: 0.1,
      },
      onSpeechStarted,
      onTurnReady,
      runtime: harness.runtime,
    });

    await expect(input.start()).resolves.toBe(true);
    harness.emit(0.2, 100);
    expect(onSpeechStarted).toHaveBeenCalledTimes(1);
    expect(input.getSnapshot()).toMatchObject({ state: "capturing", isCapturing: true });

    harness.emit(0, 799);
    expect(onTurnReady).not.toHaveBeenCalled();
    harness.emit(0, 1);
    await flushPromises();

    expect(onTurnReady).toHaveBeenCalledTimes(1);
    expect(onTurnReady).toHaveBeenCalledWith(expect.objectContaining({
      blob: expect.any(Blob),
      mimeType: "audio/wav",
      reason: "silence",
    }));
    expect(input.getSnapshot()).toMatchObject({
      state: "listening",
      pendingTurnCount: 0,
    });

    input.dispose();
  });

  it("discards short noise before speech is confirmed", async () => {
    const harness = createHarness();
    const onSpeechStarted = vi.fn();
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        minSpeechMs: 100,
        speechEndMs: 800,
        speechStartMs: 100,
        speechThreshold: 0.1,
      },
      onSpeechStarted,
      onTurnReady,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.2, 50);
    harness.emit(0, 100);
    await flushPromises();

    expect(onSpeechStarted).not.toHaveBeenCalled();
    expect(onTurnReady).not.toHaveBeenCalled();
    expect(input.getSnapshot()).toMatchObject({
      state: "listening",
      pendingTurnCount: 0,
    });

    input.dispose();
  });

  it("submits a confirmed turn at the maximum duration", async () => {
    const harness = createHarness();
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        maxTurnMs: 300,
        minSpeechMs: 100,
        speechEndMs: 800,
        speechStartMs: 100,
        speechThreshold: 0.1,
      },
      onTurnReady,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.2, 100);
    harness.emit(0.2, 200);
    await flushPromises();

    expect(onTurnReady).toHaveBeenCalledTimes(1);
    expect(onTurnReady).toHaveBeenCalledWith(expect.objectContaining({
      reason: "max_duration",
    }));
    expect(input.getSnapshot()).toMatchObject({ state: "listening", pendingTurnCount: 0 });

    input.dispose();
  });

  it("keeps one turn across normal pauses and submits at the default 1.8 seconds", async () => {
    const harness = createHarness();
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        minSpeechMs: 100,
        speechContinueThreshold: 0.05,
        speechStartMs: 100,
        speechStartThreshold: 0.1,
      },
      onTurnReady,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.2, 100);
    harness.emit(0, 1_000);
    expect(onTurnReady).not.toHaveBeenCalled();
    harness.emit(0.2, 100);
    harness.emit(0, 1_500);
    expect(onTurnReady).not.toHaveBeenCalled();
    harness.emit(0.2, 100);
    harness.emit(0, 1_800);
    await flushPromises();

    expect(onTurnReady).toHaveBeenCalledTimes(1);
    expect(onTurnReady).toHaveBeenCalledWith(expect.objectContaining({ reason: "silence" }));

    input.dispose();
  });

  it("uses the lower continuation threshold to refresh the silence timer", async () => {
    const harness = createHarness();
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        minSpeechMs: 100,
        speechContinueThreshold: 0.05,
        speechEndMs: 800,
        speechStartMs: 100,
        speechStartThreshold: 0.1,
      },
      onTurnReady,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.2, 100);
    harness.emit(0, 600);
    harness.emit(0.06, 100);
    harness.emit(0, 700);
    expect(onTurnReady).not.toHaveBeenCalled();
    harness.emit(0, 100);
    await flushPromises();

    expect(onTurnReady).toHaveBeenCalledTimes(1);

    input.dispose();
  });

  it("snapshots the configured silence duration when each turn starts", async () => {
    const harness = createHarness();
    let speechEndMs = 1_000;
    const onTurnReady = vi.fn().mockResolvedValue(undefined);
    const input = createNaturalVoiceInput({
      config: {
        minSpeechMs: 100,
        speechStartMs: 100,
        speechThreshold: 0.1,
      },
      getSpeechEndMs: () => speechEndMs,
      onTurnReady,
      runtime: harness.runtime,
    });

    await input.start();
    harness.emit(0.2, 100);
    speechEndMs = 3_000;
    harness.emit(0, 1_000);
    await flushPromises();
    expect(onTurnReady).toHaveBeenCalledTimes(1);

    harness.emit(0.2, 100);
    harness.emit(0, 1_000);
    expect(onTurnReady).toHaveBeenCalledTimes(1);
    harness.emit(0, 2_000);
    await flushPromises();
    expect(onTurnReady).toHaveBeenCalledTimes(2);

    input.dispose();
  });

  it("aborts a pending turn and releases worklet resources when paused", async () => {
    const harness = createHarness();
    const submission = createDeferred();
    let turnSignal;
    const input = createNaturalVoiceInput({
      config: {
        minSpeechMs: 100,
        speechEndMs: 800,
        speechStartMs: 100,
        speechThreshold: 0.1,
      },
      onTurnReady: vi.fn((turn) => {
        turnSignal = turn.signal;
        return submission.promise;
      }),
      runtime: harness.runtime,
    });

    await input.start();
    const context = harness.AudioContext.instances[0];
    const worklet = harness.AudioWorkletNode.instances[0];
    harness.emit(0.2, 100);
    harness.emit(0, 800);
    expect(input.getSnapshot()).toMatchObject({ state: "submitting", pendingTurnCount: 1 });

    input.pause("page_hidden");
    expect(turnSignal?.aborted).toBe(true);
    expect(worklet.port.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(input.getSnapshot()).toMatchObject({
      state: "paused",
      hasMicrophone: false,
      pendingTurnCount: 0,
      activeAudioWorkletCount: 0,
      activeAudioContextCount: 0,
    });

    submission.resolve();
    await flushPromises();
    expect(input.getSnapshot().state).toBe("paused");
  });
});
