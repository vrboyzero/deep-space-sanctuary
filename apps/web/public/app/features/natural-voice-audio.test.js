import { describe, expect, it } from "vitest";

import {
  createPcmTurnBuffer,
  encodePcm16Wav,
  normalizeNaturalVoiceSilenceMs,
  resamplePcm,
} from "./natural-voice-audio.js";

describe("natural voice audio", () => {
  it("prepends the bounded preroll and trims trailing silence from a turn", () => {
    const buffer = createPcmTurnBuffer({ sampleRate: 10, prerollMs: 300 });

    buffer.pushPreroll(new Float32Array([1, 2]));
    buffer.pushPreroll(new Float32Array([3, 4]));
    buffer.beginTurn();
    buffer.appendTurn(new Float32Array([5, 6]));

    expect(Array.from(buffer.finishTurn({ trimEndSamples: 1 }))).toEqual([2, 3, 4, 5]);
    expect(buffer.getSnapshot()).toEqual({
      activeTurn: false,
      prerollSamples: 3,
      turnSamples: 0,
    });
  });

  it("encodes known mono samples as a valid 16-bit PCM WAV", () => {
    const wav = encodePcm16Wav(new Float32Array([-1, 0, 1]), 16_000);
    const view = new DataView(wav);
    const text = (offset, length) => String.fromCharCode(
      ...new Uint8Array(wav, offset, length),
    );

    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(text(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
  });

  it("downsamples PCM by averaging each source time window", () => {
    const output = resamplePcm(new Float32Array([1, 1, -1, -1]), 4, 2);

    expect(Array.from(output)).toEqual([1, -1]);
  });

  it("normalizes the user pause duration to the supported range and step", () => {
    expect(normalizeNaturalVoiceSilenceMs(undefined)).toBe(1_800);
    expect(normalizeNaturalVoiceSilenceMs("2400")).toBe(2_400);
    expect(normalizeNaturalVoiceSilenceMs(2_349)).toBe(2_300);
    expect(normalizeNaturalVoiceSilenceMs(799)).toBe(1_800);
    expect(normalizeNaturalVoiceSilenceMs(5_001)).toBe(1_800);
  });
});
