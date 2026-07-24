function toFloat32Array(samples) {
  if (samples instanceof Float32Array) return samples;
  if (ArrayBuffer.isView(samples) || Array.isArray(samples)) return Float32Array.from(samples);
  return new Float32Array(0);
}

function concatFloat32(chunks, totalSamples) {
  const output = new Float32Array(Math.max(0, totalSamples));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= output.length) break;
    const remaining = output.length - offset;
    output.set(chunk.subarray(0, remaining), offset);
    offset += Math.min(chunk.length, remaining);
  }
  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export const DEFAULT_NATURAL_VOICE_SILENCE_MS = 1_800;
export const MIN_NATURAL_VOICE_SILENCE_MS = 800;
export const MAX_NATURAL_VOICE_SILENCE_MS = 5_000;
export const NATURAL_VOICE_SILENCE_STEP_MS = 100;

export function normalizeNaturalVoiceSilenceMs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)
    || numericValue < MIN_NATURAL_VOICE_SILENCE_MS
    || numericValue > MAX_NATURAL_VOICE_SILENCE_MS) {
    return DEFAULT_NATURAL_VOICE_SILENCE_MS;
  }
  return Math.round(numericValue / NATURAL_VOICE_SILENCE_STEP_MS)
    * NATURAL_VOICE_SILENCE_STEP_MS;
}

export function resamplePcm(samplesInput, sourceSampleRate, targetSampleRate = 16_000) {
  const samples = toFloat32Array(samplesInput);
  const sourceRate = Number(sourceSampleRate);
  const targetRate = Number(targetSampleRate);
  if (samples.length === 0) return new Float32Array(0);
  if (!Number.isFinite(sourceRate) || sourceRate <= 0
    || !Number.isFinite(targetRate) || targetRate <= 0) {
    return samples.slice();
  }
  if (sourceRate === targetRate) return samples.slice();

  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  if (targetRate < sourceRate) {
    const sourcePerTarget = sourceRate / targetRate;
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = outputIndex * sourcePerTarget;
      const end = Math.min(samples.length, (outputIndex + 1) * sourcePerTarget);
      let cursor = start;
      let weightedSum = 0;
      let weightTotal = 0;
      while (cursor < end) {
        const sourceIndex = Math.min(samples.length - 1, Math.floor(cursor));
        const nextBoundary = Math.min(end, sourceIndex + 1);
        const weight = nextBoundary - cursor;
        weightedSum += samples[sourceIndex] * weight;
        weightTotal += weight;
        cursor = nextBoundary;
      }
      output[outputIndex] = weightTotal > 0 ? weightedSum / weightTotal : 0;
    }
    return output;
  }

  if (outputLength === 1 || samples.length === 1) {
    output.fill(samples[0]);
    return output;
  }
  const sourceSpan = samples.length - 1;
  const outputSpan = outputLength - 1;
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = outputIndex * sourceSpan / outputSpan;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    output[outputIndex] = samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
  }
  return output;
}

export function encodePcm16Wav(samplesInput, sampleRate = 16_000) {
  const samples = toFloat32Array(samplesInput);
  const normalizedSampleRate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0
    ? Math.round(Number(sampleRate))
    : 16_000;
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, normalizedSampleRate, true);
  view.setUint32(28, normalizedSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const pcm = sample < 0 ? Math.round(sample * 32_768) : Math.round(sample * 32_767);
    view.setInt16(44 + index * 2, pcm, true);
  }
  return buffer;
}

export function createPcmTurnBuffer({ sampleRate, prerollMs }) {
  const normalizedSampleRate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0
    ? Number(sampleRate)
    : 16_000;
  const normalizedPrerollMs = Number.isFinite(Number(prerollMs)) && Number(prerollMs) > 0
    ? Number(prerollMs)
    : 1_000;
  const maxPrerollSamples = Math.max(
    1,
    Math.ceil(normalizedSampleRate * normalizedPrerollMs / 1_000),
  );
  let preroll = new Float32Array(0);
  let turnChunks = null;
  let turnSamples = 0;

  function pushPreroll(samplesInput) {
    const samples = toFloat32Array(samplesInput);
    if (samples.length === 0) return;
    const combined = concatFloat32([preroll, samples], preroll.length + samples.length);
    preroll = combined.length > maxPrerollSamples
      ? combined.slice(combined.length - maxPrerollSamples)
      : combined;
  }

  function beginTurn() {
    turnChunks = preroll.length > 0 ? [preroll.slice()] : [];
    turnSamples = preroll.length;
  }

  function appendTurn(samplesInput) {
    if (!turnChunks) return;
    const samples = toFloat32Array(samplesInput);
    if (samples.length === 0) return;
    turnChunks.push(samples.slice());
    turnSamples += samples.length;
  }

  function discardTurn() {
    turnChunks = null;
    turnSamples = 0;
  }

  function finishTurn({ trimEndSamples = 0 } = {}) {
    if (!turnChunks) return new Float32Array(0);
    const trim = Number.isFinite(Number(trimEndSamples))
      ? Math.max(0, Math.floor(Number(trimEndSamples)))
      : 0;
    const output = concatFloat32(turnChunks, Math.max(0, turnSamples - trim));
    discardTurn();
    return output;
  }

  function getSnapshot() {
    return {
      activeTurn: Boolean(turnChunks),
      prerollSamples: preroll.length,
      turnSamples,
    };
  }

  return {
    appendTurn,
    beginTurn,
    discardTurn,
    finishTurn,
    getSnapshot,
    pushPreroll,
  };
}
