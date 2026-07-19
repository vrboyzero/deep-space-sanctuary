import {
  createMediaFingerprint,
  readCachedAudioTranscription as readSharedCachedAudioTranscription,
  readCachedImageUnderstanding as readSharedCachedImageUnderstanding,
  readCachedVideoUnderstanding as readSharedCachedVideoUnderstanding,
  runMediaUnderstandingCacheSingleFlight as runSharedMediaUnderstandingCacheSingleFlight,
  writeCachedAudioTranscription as writeSharedCachedAudioTranscription,
  writeCachedImageUnderstanding as writeSharedCachedImageUnderstanding,
  writeCachedVideoUnderstanding as writeSharedCachedVideoUnderstanding,
  type CachedAudioTranscriptionRecord,
  type CachedImageUnderstandingRecord,
  type CachedVideoUnderstandingRecord,
  type ImageUnderstandResult,
  type TranscribeResult,
  type VideoUnderstandResult,
} from "@belldandy/skills";

export function createAttachmentFingerprint(input: {
  buffer: Buffer;
  mime?: string;
}): string {
  return createMediaFingerprint(input);
}

export const runMediaUnderstandingCacheSingleFlight = runSharedMediaUnderstandingCacheSingleFlight;

export {
  clearMediaUnderstandingCache,
  resolveMediaUnderstandingCacheDir,
  resolveMediaUnderstandingCacheRoot,
} from "@belldandy/skills";
export type { MediaUnderstandingCacheKind } from "@belldandy/skills";

export async function readCachedAudioTranscription(input: {
  stateDir: string;
  fingerprint: string;
}): Promise<CachedAudioTranscriptionRecord | undefined> {
  return readSharedCachedAudioTranscription(input);
}

export async function writeCachedAudioTranscription(input: {
  stateDir: string;
  fingerprint: string;
  mime?: string;
  result: TranscribeResult;
}): Promise<void> {
  await writeSharedCachedAudioTranscription(input);
}

export async function readCachedImageUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
}): Promise<CachedImageUnderstandingRecord | undefined> {
  return readSharedCachedImageUnderstanding(input);
}

export async function writeCachedImageUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
  mime?: string;
  result: ImageUnderstandResult;
}): Promise<void> {
  await writeSharedCachedImageUnderstanding(input);
}

export async function readCachedVideoUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
}): Promise<CachedVideoUnderstandingRecord | undefined> {
  return readSharedCachedVideoUnderstanding(input);
}

export async function writeCachedVideoUnderstanding(input: {
  stateDir: string;
  fingerprint: string;
  mime?: string;
  result: VideoUnderstandResult;
}): Promise<void> {
  await writeSharedCachedVideoUnderstanding(input);
}
