import type { Tool } from "../../types.js";
import { withToolContract } from "../../tool-contract.js";
import { multimediaCacheClearTool as baseMultimediaCacheClearTool } from "./cache-clear.js";
import { imageGenerateTool as baseImageGenerateTool } from "./image.js";
import {
  imageUnderstandTool as baseImageUnderstandTool,
  readImageUnderstandConfig,
  understandImageFile,
} from "./image-understand.js";
import type { ImageUnderstandConfig, ImageUnderstandOptions, ImageUnderstandResult } from "./image-understand.js";
import {
  createMediaFingerprint,
  createMediaFingerprintFromFile,
  clearMediaUnderstandingCache,
  readCachedAudioTranscription,
  readCachedImageUnderstanding,
  resolveMediaUnderstandingCacheDir,
  resolveMediaUnderstandingCacheRoot,
  writeCachedImageUnderstanding,
  writeCachedAudioTranscription,
  readCachedVideoUnderstanding,
  runMediaUnderstandingCacheSingleFlight,
  writeCachedVideoUnderstanding,
} from "./understanding-cache.js";
import type {
  CachedAudioTranscriptionRecord,
  CachedImageUnderstandingRecord,
  CachedVideoUnderstandingRecord,
  MediaUnderstandingCacheKind,
} from "./understanding-cache.js";
import {
  videoUnderstandTool as baseVideoUnderstandTool,
  readVideoUnderstandConfig,
  understandVideoFile,
} from "./video-understand.js";
import type { VideoUnderstandConfig, VideoUnderstandOptions, VideoUnderstandResult } from "./video-understand.js";
import { textToSpeechTool as baseTextToSpeechTool } from "./tts.js";
import { synthesizeSpeech } from "./tts-synthesize.js";
import type { SynthesizeResult, SynthesizeOptions } from "./tts-synthesize.js";
import { transcribeSpeech, transcribeSpeechWithCache } from "./stt-transcribe.js";
import type { TranscribeResult, TranscribeOptions, TranscribeWithCacheResult } from "./stt-transcribe.js";
import {
  cameraDeviceMemoryTool as baseCameraDeviceMemoryTool,
  cameraListTool as baseCameraListTool,
  cameraSnapTool as baseCameraSnapTool,
} from "./camera.js";
import {
  screenCaptureTool as baseScreenCaptureTool,
  screenListTargetsTool as baseScreenListTargetsTool,
} from "./screen.js";
export {
  buildCameraRuntimeDoctorReport,
} from "./camera-doctor.js";
export type {
  BuildCameraRuntimeDoctorReportOptions,
  CameraRuntimeDoctorReport,
  CameraRuntimeDoctorProvider,
} from "./camera-doctor.js";

function withMultimediaContract(
  tool: Tool,
  options: {
    activityDescription: string;
    safeScopes: readonly ("remote-safe" | "bridge-safe" | "local-safe")[];
    riskLevel?: "low" | "medium" | "high";
    needsPermission?: boolean;
    isReadOnly?: boolean;
    isConcurrencySafe?: boolean;
  },
): Tool {
  return withToolContract(tool, {
    family: "other",
    isReadOnly: options.isReadOnly ?? false,
    isConcurrencySafe: options.isConcurrencySafe ?? false,
    needsPermission: options.needsPermission ?? true,
    riskLevel: options.riskLevel ?? "medium",
    channels: ["gateway", "web"],
    safeScopes: options.safeScopes,
    activityDescription: options.activityDescription,
    resultSchema: {
      kind: "text",
      description: "Multimedia generation result text or artifact reference.",
    },
    outputPersistencePolicy: "artifact",
  });
}

export const imageGenerateTool = withMultimediaContract(baseImageGenerateTool, {
  activityDescription: "Generate an image from a text prompt",
  safeScopes: ["remote-safe"],
});
export const multimediaCacheClearTool = withMultimediaContract(baseMultimediaCacheClearTool, {
  activityDescription: "Clear persisted multimedia understanding cache files in the current state directory",
  safeScopes: ["local-safe"],
  riskLevel: "medium",
});
export const imageUnderstandTool = withMultimediaContract(baseImageUnderstandTool, {
  activityDescription: "Analyze an image file with the configured standalone image understanding model",
  safeScopes: ["remote-safe", "local-safe"],
  isReadOnly: true,
  isConcurrencySafe: true,
});
export const videoUnderstandTool = withMultimediaContract(baseVideoUnderstandTool, {
  activityDescription: "Analyze a video file with the configured standalone video understanding model",
  safeScopes: ["remote-safe", "local-safe"],
  isReadOnly: true,
  isConcurrencySafe: true,
});
export const textToSpeechTool = withMultimediaContract(baseTextToSpeechTool, {
  activityDescription: "Synthesize spoken audio from text",
  safeScopes: ["remote-safe", "local-safe"],
});
export { readImageUnderstandConfig, understandImageFile };
export type { ImageUnderstandConfig, ImageUnderstandOptions, ImageUnderstandResult };
export { readVideoUnderstandConfig, understandVideoFile };
export type { VideoUnderstandConfig, VideoUnderstandOptions, VideoUnderstandResult };
export {
  createMediaFingerprint,
  createMediaFingerprintFromFile,
  clearMediaUnderstandingCache,
  readCachedAudioTranscription,
  readCachedImageUnderstanding,
  resolveMediaUnderstandingCacheDir,
  resolveMediaUnderstandingCacheRoot,
  writeCachedImageUnderstanding,
  writeCachedAudioTranscription,
  readCachedVideoUnderstanding,
  runMediaUnderstandingCacheSingleFlight,
  writeCachedVideoUnderstanding,
};
export type {
  CachedAudioTranscriptionRecord,
  CachedImageUnderstandingRecord,
  CachedVideoUnderstandingRecord,
  MediaUnderstandingCacheKind,
};
export { synthesizeSpeech };
export type { SynthesizeResult, SynthesizeOptions };
export { transcribeSpeech, transcribeSpeechWithCache };
export type { TranscribeResult, TranscribeOptions, TranscribeWithCacheResult };
export const cameraListTool = withMultimediaContract(baseCameraListTool, {
  activityDescription: "List available camera devices through the connected browser",
  safeScopes: ["bridge-safe"],
  riskLevel: "high",
});
export const cameraDeviceMemoryTool = withMultimediaContract(baseCameraDeviceMemoryTool, {
  activityDescription: "Manage remembered camera aliases and favorite devices in local state",
  safeScopes: ["local-safe"],
  riskLevel: "medium",
});
export const cameraSnapTool = withMultimediaContract(baseCameraSnapTool, {
  activityDescription: "Capture a camera snapshot through the connected browser",
  safeScopes: ["bridge-safe"],
  riskLevel: "high",
});
export const screenListTargetsTool = withMultimediaContract(baseScreenListTargetsTool, {
  activityDescription: "List available desktop display and window capture targets on the local machine",
  safeScopes: ["local-safe"],
  riskLevel: "medium",
  isReadOnly: true,
  isConcurrencySafe: true,
});
export const screenCaptureTool = withMultimediaContract(baseScreenCaptureTool, {
  activityDescription: "Capture a desktop, display, window, or region screenshot on the local machine",
  safeScopes: ["local-safe"],
  riskLevel: "high",
});
