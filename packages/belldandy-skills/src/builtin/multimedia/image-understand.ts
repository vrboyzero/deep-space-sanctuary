import crypto from "node:crypto";
import path from "node:path";

import type { Tool, ToolCallResult, ToolContext } from "../../types.js";
import { buildFailureToolCallResult } from "../../failure-kind.js";
import { createLinkedAbortController } from "../../abort-utils.js";
import { resolveRuntimeFilesystemScope } from "../../runtime-policy.js";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  createOpenAIClient,
  guessImageMimeFromFilePath,
  normalizeOptionalString,
  normalizeStringArray,
  parsePositiveInt,
  parseTimeoutMs,
  stripMarkdownCodeFences,
} from "./understand-shared.js";
import { readMediaFileAsBase64 } from "./media-file-stream.js";

const DEFAULT_IMAGE_UNDERSTAND_MODEL = "gpt-4.1-mini";
const DEFAULT_IMAGE_UNDERSTAND_PROMPT = "请准确描述这张图片，提炼关键内容，并尽量识别可见文字。";
const DEFAULT_MAX_INPUT_MB = 10;
const DEFAULT_KEY_REGION_ITEMS = 4;
export const MAX_IMAGE_INLINE_INPUT_BYTES = 20 * 1024 * 1024;

export type ImageUnderstandFocusMode = "overview" | "detail_query";

export type ImageUnderstandConfig = {
  enabled: boolean;
  autoOnAttachment: boolean;
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  prompt: string;
  maxInputBytes: number;
};

export type ImageUnderstandOptions = {
  filePath: string;
  prompt?: string;
  mimeType?: string;
  abortSignal?: AbortSignal;
  focusMode?: ImageUnderstandFocusMode;
  focusTarget?: string;
  includeKeyRegions?: boolean;
  maxKeyRegions?: number;
};

export type ImageKeyRegion = {
  label: string;
  summary: string;
  ocrText?: string;
};

export type ImageTargetDetail = {
  target?: string;
  summary: string;
  ocrText?: string;
  note?: string;
};

export type ImageUnderstandResult = {
  summary: string;
  tags: string[];
  ocrText?: string;
  content: string;
  keyRegions: ImageKeyRegion[];
  targetDetail?: ImageTargetDetail;
  focusMode: ImageUnderstandFocusMode;
  focusTarget?: string;
  provider: string;
  model: string;
  mimeType: string;
  sourcePath: string;
};

type ImageUnderstandPayload = {
  summary?: unknown;
  tags?: unknown;
  ocrText?: unknown;
  content?: unknown;
  keyRegions?: unknown;
  targetDetail?: unknown;
};

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  return raw.trim().toLowerCase() !== "false";
}

export function readImageUnderstandConfig(): ImageUnderstandConfig {
  const maxInputMb = parsePositiveInt(process.env.BELLDANDY_IMAGE_UNDERSTAND_MAX_INPUT_MB, DEFAULT_MAX_INPUT_MB);
  return {
    enabled: readBoolEnv("BELLDANDY_IMAGE_UNDERSTAND_ENABLED", false),
    autoOnAttachment: readBoolEnv("BELLDANDY_IMAGE_UNDERSTAND_AUTO_ON_ATTACHMENT", true),
    provider: normalizeOptionalString(process.env.BELLDANDY_IMAGE_UNDERSTAND_PROVIDER) ?? "openai",
    apiKey: normalizeOptionalString(process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY) ?? "",
    baseURL: normalizeOptionalString(process.env.BELLDANDY_IMAGE_UNDERSTAND_OPENAI_BASE_URL) ?? DEFAULT_OPENAI_BASE_URL,
    model: normalizeOptionalString(process.env.BELLDANDY_IMAGE_UNDERSTAND_MODEL) ?? DEFAULT_IMAGE_UNDERSTAND_MODEL,
    timeoutMs: parseTimeoutMs(process.env.BELLDANDY_IMAGE_UNDERSTAND_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    prompt: normalizeOptionalString(process.env.BELLDANDY_IMAGE_UNDERSTAND_PROMPT) ?? DEFAULT_IMAGE_UNDERSTAND_PROMPT,
    maxInputBytes: Math.min(maxInputMb * 1024 * 1024, MAX_IMAGE_INLINE_INPUT_BYTES),
  };
}

function normalizeImageUnderstandResult(input: {
  rawText: string;
  config: ImageUnderstandConfig;
  filePath: string;
  mimeType: string;
  focusMode: ImageUnderstandFocusMode;
  focusTarget?: string;
}): ImageUnderstandResult {
  const cleaned = stripMarkdownCodeFences(input.rawText);
  let parsed: ImageUnderstandPayload | undefined;

  try {
    parsed = JSON.parse(cleaned) as ImageUnderstandPayload;
  } catch {
    parsed = undefined;
  }

  const summary = normalizeOptionalString(parsed?.summary) ?? normalizeOptionalString(cleaned) ?? "已完成图片识别。";
  const tags = normalizeStringArray(parsed?.tags);
  const ocrText = normalizeOptionalString(parsed?.ocrText);
  const content = normalizeOptionalString(parsed?.content)
    ?? [summary, ocrText].filter(Boolean).join("\n\n");
  const keyRegions = normalizeImageKeyRegions(parsed?.keyRegions);
  const targetDetail = normalizeImageTargetDetail(parsed?.targetDetail, input.focusTarget);

  return {
    summary,
    tags,
    ocrText,
    content: content || summary,
    keyRegions,
    targetDetail,
    focusMode: input.focusMode,
    focusTarget: input.focusTarget,
    provider: input.config.provider,
    model: input.config.model,
    mimeType: input.mimeType,
    sourcePath: input.filePath,
  };
}

function buildImageUnderstandPrompt(input: {
  fileName: string;
  prompt: string;
  focusMode: ImageUnderstandFocusMode;
  focusTarget?: string;
  includeKeyRegions: boolean;
  maxKeyRegions: number;
}): string {
  const focusLines: string[] = [];
  if (input.focusMode === "detail_query" && input.focusTarget) {
    focusLines.push(`重点关注：${input.focusTarget}`);
    focusLines.push("请优先回答这个对象、区域、文字或细节本身；如果无法明确定位，请说明不确定性。");
  } else {
    focusLines.push("请先给出图片总览，再提炼关键区域。");
  }

  return [
    `${input.prompt}`,
    "",
    `文件名：${input.fileName}`,
    "",
    ...focusLines,
    "",
    "请只输出 JSON，对象字段固定为 summary、tags、ocrText、content、keyRegions、targetDetail。",
    "summary 要简洁概括图片重点；tags 是字符串数组；ocrText 放图片中的可见文字，没有则留空；content 给出更完整说明。",
    `keyRegions 必须是数组，每项字段固定为 label、summary、ocrText；最多返回 ${input.maxKeyRegions} 项。`,
    input.includeKeyRegions ? "keyRegions 需要覆盖图片中最值得关注的区域、主体或文字块。" : "keyRegions 返回空数组。",
    input.focusMode === "detail_query"
      ? "targetDetail 填当前重点关注对象的回答，对象字段固定为 target、summary、ocrText、note。"
      : "targetDetail 返回 null。",
  ].join("\n");
}

function normalizeImageKeyRegions(value: unknown): ImageKeyRegion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<ImageKeyRegion | undefined>((item) => {
      const record = (item && typeof item === "object") ? item as Record<string, unknown> : undefined;
      const label = normalizeOptionalString(record?.label);
      const summary = normalizeOptionalString(record?.summary);
      if (!label || !summary) return undefined;
      return {
        label,
        summary,
        ocrText: normalizeOptionalString(record?.ocrText),
      };
    })
    .filter(isDefined);
}

function normalizeImageTargetDetail(value: unknown, requestedTarget?: string): ImageTargetDetail | undefined {
  const record = (value && typeof value === "object") ? value as Record<string, unknown> : undefined;
  const summary = normalizeOptionalString(record?.summary);
  if (!summary && !requestedTarget) return undefined;
  return {
    target: normalizeOptionalString(record?.target) ?? requestedTarget,
    summary: summary ?? "模型未返回该重点对象的明确结论。",
    ocrText: normalizeOptionalString(record?.ocrText),
    note: normalizeOptionalString(record?.note),
  };
}

function normalizeFocusMode(value: unknown): ImageUnderstandFocusMode {
  if (value === "detail_query") return value;
  return "overview";
}

export async function understandImageFile(input: ImageUnderstandOptions): Promise<ImageUnderstandResult> {
  const config = readImageUnderstandConfig();
  if (!config.enabled) {
    throw new Error("BELLDANDY_IMAGE_UNDERSTAND_ENABLED is false.");
  }
  if (config.provider !== "openai") {
    throw new Error(`Unsupported BELLDANDY_IMAGE_UNDERSTAND_PROVIDER: ${config.provider}.`);
  }
  if (!config.apiKey) {
    throw new Error("BELLDANDY_IMAGE_UNDERSTAND_OPENAI_API_KEY is required for image understanding.");
  }

  const filePath = path.resolve(input.filePath);
  const linkedAbort = createLinkedAbortController({
    signal: input.abortSignal,
    timeoutMs: config.timeoutMs > 0 ? config.timeoutMs : undefined,
    timeoutReason: config.timeoutMs > 0 ? `Image understanding timed out after ${config.timeoutMs}ms.` : undefined,
  });

  try {
    const mimeType = normalizeOptionalString(input.mimeType) ?? guessImageMimeFromFilePath(filePath);
    if (!mimeType.startsWith("image/")) {
      throw new Error(`Unsupported image mime type: ${mimeType}`);
    }
    const focusMode = normalizeFocusMode(input.focusMode);
    const includeKeyRegions = input.includeKeyRegions !== false;
    const maxKeyRegions = Math.max(1, Math.min(8, input.maxKeyRegions ?? DEFAULT_KEY_REGION_ITEMS));
    const encoded = await readMediaFileAsBase64({
      filePath,
      maxBytes: config.maxInputBytes,
      label: "Image file",
      abortSignal: linkedAbort.controller.signal,
    });
    const openai = createOpenAIClient({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeoutMs: config.timeoutMs,
    });
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是图片识别助手。只输出 JSON，不要输出 Markdown 代码块。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildImageUnderstandPrompt({
                fileName: path.basename(filePath),
                prompt: normalizeOptionalString(input.prompt) ?? config.prompt,
                focusMode,
                focusTarget: normalizeOptionalString(input.focusTarget),
                includeKeyRegions,
                maxKeyRegions,
              }),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${encoded}`,
              },
            },
          ],
        },
      ],
    } as any, {
      signal: linkedAbort.controller.signal,
    });

    const rawText = response.choices?.[0]?.message?.content ?? "";
    return normalizeImageUnderstandResult({
      rawText,
      config,
      filePath,
      mimeType,
      focusMode,
      focusTarget: normalizeOptionalString(input.focusTarget),
    });
  } finally {
    linkedAbort.cleanup();
  }
}

function isUnderRoot(absolute: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, absolute);
  return !(relative.startsWith("..") || path.isAbsolute(relative));
}

function resolveImagePath(
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
    return { ok: false, error: "路径越界：不允许访问工作区或当前 stateDir 之外的图片文件" };
  }

  return { ok: true, absolutePath: candidate };
}

export const imageUnderstandTool: Tool = {
  definition: {
    name: "image_understand",
    description: "Analyze an image file with the configured standalone image understanding model.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the image file. Supports workspace-relative paths and absolute paths inside the workspace or current stateDir.",
        },
        prompt: {
          type: "string",
          description: "Optional custom instruction for what to focus on in the image.",
        },
        focus_mode: {
          type: "string",
          enum: ["overview", "detail_query"],
          description: "How to focus the analysis. overview = overall content, detail_query = answer a specific object, region, text, or detail in the image.",
        },
        focus_target: {
          type: "string",
          description: "Optional target to focus on, such as a person, object, area, text block, or UI element. Best used with focus_mode=detail_query.",
        },
        include_key_regions: {
          type: "boolean",
          description: "Whether to ask the model for a list of key regions or notable areas in the image.",
        },
        max_key_regions: {
          type: "number",
          description: "Maximum number of key regions to request from the model.",
        },
      },
      required: ["file_path"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "image_understand";

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

    const resolved = resolveImagePath(pathArg, context);
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
      const result = await understandImageFile({
        filePath: resolved.absolutePath,
        prompt: typeof args.prompt === "string" ? args.prompt : undefined,
        focusMode: typeof args.focus_mode === "string" ? normalizeFocusMode(args.focus_mode) : undefined,
        focusTarget: typeof args.focus_target === "string" ? args.focus_target : undefined,
        includeKeyRegions: typeof args.include_key_regions === "boolean" ? args.include_key_regions : undefined,
        maxKeyRegions: typeof args.max_key_regions === "number" ? args.max_key_regions : undefined,
        abortSignal: context.abortSignal,
      });
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
