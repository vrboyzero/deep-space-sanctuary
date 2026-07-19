import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Tool, ToolCallResult, ToolContext } from "../../types.js";
import { buildFailureToolCallResult } from "../../failure-kind.js";
import { createLinkedAbortController, isAbortError, toAbortError } from "../../abort-utils.js";
import { resolveRuntimeFilesystemScope } from "../../runtime-policy.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  createOpenAIClient,
  guessVideoMimeFromFilePath,
  normalizeOptionalString,
  normalizeStringArray,
  parsePositiveInt,
  parseTimeoutMs,
  stripMarkdownCodeFences,
  uploadFileToOpenAICompatible,
  type OpenAICompatibleUploadOutboundRequestPolicy,
} from "./understand-shared.js";
import { understandVideoFileByFrameSampling } from "./video-frame-fallback.js";
import {
  MediaFileLimitError,
  readMediaFileAsBase64,
} from "./media-file-stream.js";

const DEFAULT_VIDEO_UNDERSTAND_MODEL = "kimi-k2.5";
const DEFAULT_VIDEO_UNDERSTAND_PROMPT = "请准确概括这个视频的主要内容、动作过程、场景变化，并尽量识别画面中的可见文字。";
const DEFAULT_MAX_INPUT_MB = 100;
const DEFAULT_TIMELINE_ITEMS = 5;
const DEFAULT_VIDEO_TRANSPORT = "auto";
export const MAX_INLINE_VIDEO_INPUT_BYTES = 20 * 1024 * 1024;

export type VideoUnderstandFocusMode = "overview" | "timeline" | "timestamp_query";
export type VideoUnderstandTransport = "auto" | "openai_files" | "inline_data_url";

export type VideoUnderstandConfig = {
  enabled: boolean;
  autoOnAttachment: boolean;
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  prompt: string;
  maxInputBytes: number;
  transport: VideoUnderstandTransport;
  fps?: number;
  uploadApiKey: string;
  uploadBaseURL: string;
};

export type VideoUnderstandOptions = {
  filePath: string;
  prompt?: string;
  mimeType?: string;
  abortSignal?: AbortSignal;
  focusMode?: VideoUnderstandFocusMode;
  targetTimestamp?: string;
  includeTimeline?: boolean;
  maxTimelineItems?: number;
};

export type VideoUnderstandDependencies = {
  uploadOutboundRequestPolicy?: OpenAICompatibleUploadOutboundRequestPolicy;
};

export type VideoTimelineEntry = {
  timestamp: string;
  summary: string;
  ocrText?: string;
};

export type VideoTargetMoment = {
  requestedTimestamp?: string;
  matchedTimestamp?: string;
  summary: string;
  ocrText?: string;
  note?: string;
};

export type VideoUnderstandResult = {
  summary: string;
  tags: string[];
  ocrText?: string;
  content: string;
  durationText?: string;
  timeline: VideoTimelineEntry[];
  targetMoment?: VideoTargetMoment;
  focusMode: VideoUnderstandFocusMode;
  targetTimestamp?: string;
  analysisMode?: "native_video" | "frame_sampling_fallback";
  provider: string;
  model: string;
  mimeType: string;
  sourcePath: string;
  nativeErrorMessage?: string;
};

type VideoUnderstandPayload = {
  summary?: unknown;
  tags?: unknown;
  ocrText?: unknown;
  content?: unknown;
  durationText?: unknown;
  timeline?: unknown;
  targetMoment?: unknown;
};

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  return raw.trim().toLowerCase() !== "false";
}

function normalizeVideoTransport(value: unknown): VideoUnderstandTransport {
  if (value === "openai_files" || value === "inline_data_url") return value;
  return "auto";
}

function parseVideoFps(value: unknown): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 10) return undefined;
  return parsed;
}

export function readVideoUnderstandConfig(): VideoUnderstandConfig {
  const maxInputMb = parsePositiveInt(process.env.BELLDANDY_VIDEO_UNDERSTAND_MAX_INPUT_MB, DEFAULT_MAX_INPUT_MB);
  const apiKey = normalizeOptionalString(process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY) ?? "";
  const baseURL = normalizeOptionalString(process.env.BELLDANDY_VIDEO_UNDERSTAND_OPENAI_BASE_URL) ?? DEFAULT_OPENAI_BASE_URL;
  return {
    enabled: readBoolEnv("BELLDANDY_VIDEO_UNDERSTAND_ENABLED", false),
    autoOnAttachment: readBoolEnv("BELLDANDY_VIDEO_UNDERSTAND_AUTO_ON_ATTACHMENT", true),
    provider: normalizeOptionalString(process.env.BELLDANDY_VIDEO_UNDERSTAND_PROVIDER) ?? "openai",
    apiKey,
    baseURL,
    model: normalizeOptionalString(process.env.BELLDANDY_VIDEO_UNDERSTAND_MODEL) ?? DEFAULT_VIDEO_UNDERSTAND_MODEL,
    timeoutMs: parseTimeoutMs(process.env.BELLDANDY_VIDEO_UNDERSTAND_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    prompt: normalizeOptionalString(process.env.BELLDANDY_VIDEO_UNDERSTAND_PROMPT) ?? DEFAULT_VIDEO_UNDERSTAND_PROMPT,
    maxInputBytes: maxInputMb * 1024 * 1024,
    transport: normalizeVideoTransport(
      normalizeOptionalString(process.env.BELLDANDY_VIDEO_UNDERSTAND_TRANSPORT) ?? DEFAULT_VIDEO_TRANSPORT,
    ),
    fps: parseVideoFps(process.env.BELLDANDY_VIDEO_UNDERSTAND_FPS),
    uploadApiKey: normalizeOptionalString(process.env.BELLDANDY_VIDEO_FILE_API_KEY) ?? apiKey,
    uploadBaseURL: normalizeOptionalString(process.env.BELLDANDY_VIDEO_FILE_API_URL) ?? baseURL,
  };
}

function normalizeVideoUnderstandResult(input: {
  rawText: string;
  config: VideoUnderstandConfig;
  filePath: string;
  mimeType: string;
  focusMode: VideoUnderstandFocusMode;
  targetTimestamp?: string;
}): VideoUnderstandResult {
  const cleaned = stripMarkdownCodeFences(input.rawText);
  let parsed: VideoUnderstandPayload | undefined;

  try {
    parsed = JSON.parse(cleaned) as VideoUnderstandPayload;
  } catch {
    parsed = undefined;
  }

  const summary = normalizeOptionalString(parsed?.summary) ?? normalizeOptionalString(cleaned) ?? "已完成视频识别。";
  const tags = normalizeStringArray(parsed?.tags);
  const ocrText = normalizeOptionalString(parsed?.ocrText);
  const durationText = normalizeOptionalString(parsed?.durationText);
  const content = normalizeOptionalString(parsed?.content)
    ?? [summary, ocrText].filter(Boolean).join("\n\n");
  const timeline = normalizeVideoTimeline(parsed?.timeline);
  const targetMoment = normalizeVideoTargetMoment(parsed?.targetMoment, input.targetTimestamp);

  return {
    summary,
    tags,
    ocrText,
    content: content || summary,
    durationText,
    timeline,
    targetMoment,
    focusMode: input.focusMode,
    targetTimestamp: input.targetTimestamp,
    analysisMode: "native_video",
    provider: input.config.provider,
    model: input.config.model,
    mimeType: input.mimeType,
    sourcePath: input.filePath,
  };
}

function buildVideoUnderstandPrompt(input: {
  fileName: string;
  prompt: string;
  focusMode: VideoUnderstandFocusMode;
  targetTimestamp?: string;
  includeTimeline: boolean;
  maxTimelineItems?: number;
}): string {
  const focusLines: string[] = [];
  if (input.focusMode === "timestamp_query" && input.targetTimestamp) {
    focusLines.push(`重点回答时间点：${input.targetTimestamp}`);
    focusLines.push("请优先说明该时间点附近发生了什么；如果无法精确定位，请给出最接近的时间片段并说明不确定性。");
  } else if (input.focusMode === "timeline") {
    focusLines.push("请特别重视时间线拆解，按时间顺序提炼关键片段。");
  } else {
    focusLines.push("请先给出视频总览，再补充关键片段。");
  }

  return [
    `${input.prompt}`,
    "",
    `文件名：${input.fileName}`,
    "",
    ...focusLines,
    "",
    "请只输出 JSON，对象字段固定为 summary、tags、ocrText、content、durationText、timeline、targetMoment。",
    "summary 要概括视频主线；tags 是字符串数组；ocrText 放视频整体可见文字，没有则留空；content 给出更完整说明；durationText 填可感知时长线索，没有则留空。",
    typeof input.maxTimelineItems === "number" && input.maxTimelineItems > 0
      ? `timeline 必须是数组，每项字段固定为 timestamp、summary、ocrText；最多返回 ${input.maxTimelineItems} 项。`
      : "timeline 必须是数组，每项字段固定为 timestamp、summary、ocrText；请按内容需要返回关键时间片段，尽量覆盖从开头到结尾的完整流程；如视频内容分段明显，可以返回较多项，不要只给 5 条示例，也不要因为固定上限而省略重要片段。",
    input.includeTimeline ? "timeline 需要覆盖关键时间片段，时间戳尽量写成 mm:ss 或 hh:mm:ss。" : "timeline 返回空数组。",
    input.focusMode === "timestamp_query"
      ? "targetMoment 填指定时间点的回答，对象字段固定为 requestedTimestamp、matchedTimestamp、summary、ocrText、note。"
      : "targetMoment 返回 null。",
  ].join("\n");
}

function normalizeMaxTimelineItems(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMELINE_ITEMS;
  }
  if (value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(12, Math.trunc(value)));
}

function normalizeVideoTimeline(value: unknown): VideoTimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<VideoTimelineEntry | undefined>((item) => {
      const record = (item && typeof item === "object") ? item as Record<string, unknown> : undefined;
      const timestamp = normalizeOptionalString(record?.timestamp);
      const summary = normalizeOptionalString(record?.summary);
      if (!timestamp || !summary) return undefined;
      return {
        timestamp,
        summary,
        ocrText: normalizeOptionalString(record?.ocrText),
      };
    })
    .filter(isDefined);
}

function normalizeVideoTargetMoment(value: unknown, requestedTimestamp?: string): VideoTargetMoment | undefined {
  const record = (value && typeof value === "object") ? value as Record<string, unknown> : undefined;
  const summary = normalizeOptionalString(record?.summary);
  if (!summary && !requestedTimestamp) return undefined;
  return {
    requestedTimestamp: normalizeOptionalString(record?.requestedTimestamp) ?? requestedTimestamp,
    matchedTimestamp: normalizeOptionalString(record?.matchedTimestamp),
    summary: summary ?? "模型未返回该时间点的明确结论。",
    ocrText: normalizeOptionalString(record?.ocrText),
    note: normalizeOptionalString(record?.note),
  };
}

function normalizeFocusMode(value: unknown): VideoUnderstandFocusMode {
  if (value === "timeline" || value === "timestamp_query") return value;
  return "overview";
}

function shouldUseDashScopeInlineTransport(baseURL: string): boolean {
  try {
    const parsed = new URL(baseURL);
    return parsed.hostname.toLowerCase() === "dashscope.aliyuncs.com"
      && parsed.pathname.toLowerCase().includes("/compatible-mode");
  } catch {
    return false;
  }
}

function resolveVideoTransport(config: VideoUnderstandConfig): Exclude<VideoUnderstandTransport, "auto"> {
  if (config.transport === "openai_files" || config.transport === "inline_data_url") {
    return config.transport;
  }
  if (shouldUseDashScopeInlineTransport(config.baseURL)) {
    return "inline_data_url";
  }
  return "openai_files";
}

async function buildNativeVideoContentPart(input: {
  config: VideoUnderstandConfig;
  filePath: string;
  mimeType: string;
  abortSignal?: AbortSignal;
  dependencies: VideoUnderstandDependencies;
}): Promise<{ type: "video_url"; video_url: { url: string; fps?: number } }> {
  const transport = resolveVideoTransport(input.config);
  if (transport === "inline_data_url") {
    const encoded = await readMediaFileAsBase64({
      filePath: input.filePath,
      maxBytes: Math.min(input.config.maxInputBytes, MAX_INLINE_VIDEO_INPUT_BYTES),
      label: "inline video payload",
      abortSignal: input.abortSignal,
    });
    return {
      type: "video_url",
      video_url: {
        url: `data:${input.mimeType};base64,${encoded}`,
        ...(typeof input.config.fps === "number" ? { fps: input.config.fps } : {}),
      },
    };
  }

  const fileId = await uploadFileToOpenAICompatible({
    filePath: input.filePath,
    apiKey: input.config.uploadApiKey,
    baseURL: input.config.uploadBaseURL,
    purpose: "video",
    maxBytes: input.config.maxInputBytes,
    abortSignal: input.abortSignal,
    outboundRequestPolicy: input.dependencies.uploadOutboundRequestPolicy,
  });
  return {
    type: "video_url",
    video_url: {
      url: `ms://${fileId}`,
      ...(typeof input.config.fps === "number" ? { fps: input.config.fps } : {}),
    },
  };
}

export async function understandVideoFile(
  input: VideoUnderstandOptions,
  dependencies: VideoUnderstandDependencies = {},
): Promise<VideoUnderstandResult> {
  const config = readVideoUnderstandConfig();
  if (!config.enabled) {
    throw new Error("BELLDANDY_VIDEO_UNDERSTAND_ENABLED is false.");
  }
  if (config.provider !== "openai") {
    throw new Error(`Unsupported BELLDANDY_VIDEO_UNDERSTAND_PROVIDER: ${config.provider}.`);
  }
  if (!config.apiKey) {
    throw new Error("BELLDANDY_VIDEO_UNDERSTAND_OPENAI_API_KEY is required for video understanding.");
  }

  const filePath = path.resolve(input.filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (stat.size > config.maxInputBytes) {
    throw new Error(`Video file too large (${stat.size} bytes > ${config.maxInputBytes} bytes).`);
  }

  const mimeType = normalizeOptionalString(input.mimeType) ?? guessVideoMimeFromFilePath(filePath);
  if (!mimeType.startsWith("video/")) {
    throw new Error(`Unsupported video mime type: ${mimeType}`);
  }
  if (resolveVideoTransport(config) === "inline_data_url" && stat.size > MAX_INLINE_VIDEO_INPUT_BYTES) {
    throw new Error(
      `inline video payload too large (${stat.size} bytes > ${MAX_INLINE_VIDEO_INPUT_BYTES} bytes); use openai_files transport for larger videos.`,
    );
  }
  const focusMode = normalizeFocusMode(input.focusMode);
  const includeTimeline = input.includeTimeline !== false;
  const maxTimelineItems = normalizeMaxTimelineItems(input.maxTimelineItems);

  const linkedAbort = createLinkedAbortController({
    signal: input.abortSignal,
    timeoutMs: config.timeoutMs > 0 ? config.timeoutMs : undefined,
    timeoutReason: config.timeoutMs > 0 ? `Video understanding timed out after ${config.timeoutMs}ms.` : undefined,
  });
  const openai = createOpenAIClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeoutMs: config.timeoutMs,
  });

  try {
    try {
      const videoContentPart = await buildNativeVideoContentPart({
        config,
        filePath,
        mimeType,
        abortSignal: linkedAbort.controller.signal,
        dependencies,
      });

      const response = await openai.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "你是视频识别助手。只输出 JSON，不要输出 Markdown 代码块。",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildVideoUnderstandPrompt({
                  fileName: path.basename(filePath),
                  prompt: normalizeOptionalString(input.prompt) ?? config.prompt,
                  focusMode,
                  targetTimestamp: normalizeOptionalString(input.targetTimestamp),
                  includeTimeline,
                  maxTimelineItems,
                }),
              },
              videoContentPart,
            ],
          },
        ],
      } as any, {
        signal: linkedAbort.controller.signal,
      });

      const rawText = response.choices?.[0]?.message?.content ?? "";
      const result = normalizeVideoUnderstandResult({
        rawText,
        config,
        filePath,
        mimeType,
        focusMode,
        targetTimestamp: normalizeOptionalString(input.targetTimestamp),
      });
      return result;
    } catch (nativeError) {
      if (linkedAbort.controller.signal.aborted) {
        throw toAbortError(linkedAbort.controller.signal.reason);
      }
      if (isAbortError(nativeError) || nativeError instanceof MediaFileLimitError) {
        throw nativeError;
      }
      const fallback = await understandVideoFileByFrameSampling({
        filePath,
        mimeType,
        focusMode,
        targetTimestamp: normalizeOptionalString(input.targetTimestamp),
        includeTimeline,
        maxTimelineItems,
        abortSignal: linkedAbort.controller.signal,
        nativeErrorMessage: nativeError instanceof Error ? nativeError.message : String(nativeError),
      });
      return {
        summary: fallback.summary,
        tags: fallback.tags,
        ocrText: fallback.ocrText,
        content: fallback.content,
        durationText: fallback.durationText,
        timeline: fallback.timeline,
        targetMoment: fallback.targetMoment,
        focusMode,
        targetTimestamp: normalizeOptionalString(input.targetTimestamp),
        analysisMode: "frame_sampling_fallback",
        provider: fallback.provider,
        model: fallback.model,
        mimeType,
        sourcePath: filePath,
        nativeErrorMessage: fallback.nativeErrorMessage,
      };
    }
  } finally {
    linkedAbort.cleanup();
  }
}

function isUnderRoot(absolute: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, absolute);
  return !(relative.startsWith("..") || path.isAbsolute(relative));
}

function resolveVideoPath(
  rawPath: string,
  context: ToolContext,
): { ok: true; absolutePath: string } | { ok: false; error: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) return { ok: false, error: "path is required." };

  const scope = resolveRuntimeFilesystemScope(context);
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(scope.workspaceRoot, trimmed);

  const roots = [
    scope.workspaceRoot,
    ...(scope.extraWorkspaceRoots ?? []),
    ...(context.stateDir ? [context.stateDir] : []),
  ].map((item) => path.resolve(item));

  if (!roots.some((root) => isUnderRoot(candidate, root))) {
    return { ok: false, error: "路径越界：不允许访问工作区或当前 stateDir 之外的视频文件" };
  }

  return { ok: true, absolutePath: candidate };
}

export function createVideoUnderstandTool(dependencies: VideoUnderstandDependencies = {}): Tool {
  return {
  definition: {
    name: "video_understand",
    description: "Analyze a video file with the configured standalone video understanding model.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the video file. Supports workspace-relative paths and absolute paths inside the workspace or current stateDir.",
        },
        prompt: {
          type: "string",
          description: "Optional custom instruction for what to focus on in the video.",
        },
        focus_mode: {
          type: "string",
          enum: ["overview", "timeline", "timestamp_query"],
          description: "How to focus the analysis. overview = overall content, timeline = emphasize key moments, timestamp_query = answer a specific time point.",
        },
        target_timestamp: {
          type: "string",
          description: "Optional target timestamp such as 00:17 or 01:02:30. Best used with focus_mode=timestamp_query.",
        },
        include_timeline: {
          type: "boolean",
          description: "Whether to ask the model for a key-moments timeline in addition to the overview summary.",
        },
        max_timeline_items: {
          type: "number",
          description: "Maximum number of timeline items to request from the model. Use 0 for no explicit limit.",
        },
      },
      required: ["file_path"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "video_understand";

    const pathArg = typeof args.file_path === "string" ? args.file_path : "";
    if (!pathArg.trim()) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: "参数错误：file_path 必须是非空字符串",
        failureKind: "input_error",
      });
    }

    const resolved = resolveVideoPath(pathArg, context);
    if (!resolved.ok) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: resolved.error,
        failureKind: "permission_or_policy",
      });
    }

    try {
      const result = await understandVideoFile({
        filePath: resolved.absolutePath,
        prompt: typeof args.prompt === "string" ? args.prompt : undefined,
        focusMode: typeof args.focus_mode === "string" ? normalizeFocusMode(args.focus_mode) : undefined,
        targetTimestamp: typeof args.target_timestamp === "string" ? args.target_timestamp : undefined,
        includeTimeline: typeof args.include_timeline === "boolean" ? args.include_timeline : undefined,
        maxTimelineItems: typeof args.max_timeline_items === "number" ? args.max_timeline_items : undefined,
        abortSignal: context.abortSignal,
      }, dependencies);
      if (result.analysisMode === "frame_sampling_fallback" && result.nativeErrorMessage) {
        context.logger?.warn(
          `video_understand native path failed; falling back to frame sampling: ${result.nativeErrorMessage}`,
        );
      }
      context.logger?.info(
        result.analysisMode === "frame_sampling_fallback"
          ? `video_understand completed via frame_sampling_fallback (model=${result.model}, timelineItems=${result.timeline.length})`
          : `video_understand completed via native_video (model=${result.model}, timelineItems=${result.timeline.length})`,
      );
      return {
        id,
        name,
        success: true,
        output: JSON.stringify(result),
        durationMs: Date.now() - start,
        metadata: {
          model: result.model,
          mimeType: result.mimeType,
          sourcePath: result.sourcePath,
        },
      };
    } catch (error) {
      return buildFailureToolCallResult({
        id,
        name,
        start,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  };
}

export const videoUnderstandTool: Tool = createVideoUnderstandTool();
