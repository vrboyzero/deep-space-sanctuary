import type { Tool, ToolCallResult } from "../../types.js";
import OpenAI from "openai";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createLinkedAbortController } from "../../abort-utils.js";

type ImageOutputFormat = "png" | "jpeg" | "webp";
type ImageResponseTransport = "base64" | "url";
type GeneratedImageAsset = {
  buffer: Buffer;
  detectedFormat: ImageOutputFormat | null;
};

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_SDK_TIMEOUT_MS = 2_147_483_647;
const REVEAL_PREFIX = "#generated-image-reveal:";
const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";

function readImageConfig() {
  return {
    enabled: (process.env.BELLDANDY_IMAGE_ENABLED ?? "true").trim().toLowerCase() !== "false",
    provider: (process.env.BELLDANDY_IMAGE_PROVIDER ?? "openai").trim().toLowerCase(),
    apiKey: process.env.BELLDANDY_IMAGE_OPENAI_API_KEY?.trim() ?? "",
    baseURL: process.env.BELLDANDY_IMAGE_OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: process.env.BELLDANDY_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
    outputFormat: normalizeOutputFormat(process.env.BELLDANDY_IMAGE_OUTPUT_FORMAT),
    timeoutMs: parseTimeoutMs(process.env.BELLDANDY_IMAGE_TIMEOUT_MS),
  };
}

function normalizeOutputFormat(value: string | undefined): ImageOutputFormat {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "webp") return normalized;
  return "png";
}

function parseTimeoutMs(value: string | undefined): number {
  if ((value ?? "").trim() === "0") {
    return 0;
  }
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

function normalizeResponseTransport(value: unknown): ImageResponseTransport {
  return typeof value === "string" && value.trim().toLowerCase() === "url" ? "url" : "base64";
}

function normalizeInputImages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAgnesImageModel(model: string): boolean {
  return model.trim().toLowerCase() === AGNES_IMAGE_MODEL;
}

function buildTimestamp(): string {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return parts.join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildOutput(input: {
  webPath: string;
  relativePath: string;
  model: string;
}): string {
  const safeWebPath = escapeHtml(input.webPath);
  const safeRelativePath = escapeHtml(input.relativePath);
  const safeRevealHref = escapeHtml(`${REVEAL_PREFIX}${input.webPath}`);
  const safeModel = escapeHtml(input.model);
  return [
    `<div class="generated-image-result">`,
    `  <img src="${safeWebPath}" alt="Generated Image">`,
    `  <div class="generated-image-path">保存位置：<a href="${safeRevealHref}" title="打开保存目录">${safeRelativePath}</a></div>`,
    `  <div class="generated-image-meta">模型：${safeModel}</div>`,
    `</div>`,
  ].join("\n");
}

function getGeneratedImagesDir(context: { stateDir?: string; workspaceRoot: string }): string {
  const baseDir = context.stateDir?.trim() || context.workspaceRoot;
  return path.join(baseDir, "generated", "images");
}

function detectImageOutputFormat(buffer: Buffer): ImageOutputFormat | null {
  if (buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a) {
    return "png";
  }

  if (buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff) {
    return "jpeg";
  }

  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }

  return null;
}

async function readGeneratedImageAsset(item: Record<string, unknown>, abortSignal?: AbortSignal): Promise<GeneratedImageAsset> {
  const b64Json = typeof item.b64_json === "string" ? item.b64_json : "";
  if (b64Json) {
    const buffer = Buffer.from(b64Json, "base64");
    return {
      buffer,
      detectedFormat: detectImageOutputFormat(buffer),
    };
  }

  const imageUrl = typeof item.url === "string" ? item.url : "";
  if (imageUrl) {
    const response = await fetch(imageUrl, { signal: abortSignal });
    if (!response.ok) {
      throw new Error(`Failed to download generated image (${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      detectedFormat: detectImageOutputFormat(buffer),
    };
  }

  throw new Error("Image generation response did not include b64_json or url.");
}

export const imageGenerateTool: Tool = {
  definition: {
    name: "image_generate",
    description: "Generate an image using the configured standalone image model.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The description of the image to generate.",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1536x1024", "1024x1536", "1024x768", "768x1024", "auto"],
          description: "Resolution of the generated image (default: 1024x1024). Agnes-compatible providers may also accept additional custom sizes.",
        },
        quality: {
          type: "string",
          enum: ["low", "medium", "high", "auto"],
          description: "Quality of the generated image (default: auto).",
        },
        output_format: {
          type: "string",
          enum: ["png", "jpeg", "webp"],
          description: "Output format written to generated/images (default: png).",
        },
        response_transport: {
          type: "string",
          enum: ["base64", "url"],
          description: "How the provider should return the generated image before we persist it locally (default: base64).",
        },
        input_images: {
          type: "array",
          items: { type: "string" },
          description: "Optional input images for image-to-image workflows. Supports public URLs or Data URI Base64 strings.",
        },
      },
      required: ["prompt"],
    },
  },

  async execute(args, context): Promise<ToolCallResult> {
    const start = Date.now();
    const id = crypto.randomUUID();
    const name = "image_generate";
    const config = readImageConfig();

    if (!config.enabled) {
      return {
        id,
        name,
        success: false,
        output: "",
        error: "BELLDANDY_IMAGE_ENABLED is false.",
        durationMs: Date.now() - start,
      };
    }

    if (config.provider !== "openai") {
      return {
        id,
        name,
        success: false,
        output: "",
        error: `Unsupported BELLDANDY_IMAGE_PROVIDER: ${config.provider}.`,
        durationMs: Date.now() - start,
      };
    }

    if (!config.apiKey) {
      return {
        id,
        name,
        success: false,
        output: "",
        error: "BELLDANDY_IMAGE_OPENAI_API_KEY is required for image generation.",
        durationMs: Date.now() - start,
      };
    }

    try {
      const outputFormat = normalizeOutputFormat(typeof args.output_format === "string" ? args.output_format : config.outputFormat);
      const responseTransport = normalizeResponseTransport(args.response_transport);
      const inputImages = normalizeInputImages(args.input_images);
      const isAgnes = isAgnesImageModel(config.model);
      const linkedAbort = createLinkedAbortController({
        signal: context.abortSignal,
        timeoutMs: config.timeoutMs > 0 ? config.timeoutMs : undefined,
        timeoutReason: config.timeoutMs > 0 ? `Image generation timed out after ${config.timeoutMs}ms.` : undefined,
      });
      const openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs > 0 ? config.timeoutMs : MAX_SDK_TIMEOUT_MS,
      });

      try {
        const payload: Record<string, unknown> = {
          model: config.model,
          prompt: String(args.prompt ?? ""),
          size: typeof args.size === "string" ? args.size : "1024x1024",
        };

        if (isAgnes) {
          // Agnes Image 2.1 Flash 的 OpenAI 兼容字段与默认 OpenAI 生图字段不同。
          if (inputImages.length > 0) {
            payload.extra_body = {
              image: inputImages,
              response_format: responseTransport === "url" ? "url" : "b64_json",
            };
          } else if (responseTransport === "url") {
            payload.extra_body = {
              response_format: "url",
            };
          } else {
            payload.return_base64 = true;
          }
        } else {
          payload.quality = typeof args.quality === "string" ? args.quality : "auto";
          payload.output_format = outputFormat;
        }

        const response = await (openai.images.generate as any)(
          payload,
          { signal: linkedAbort.controller.signal },
        );

        const firstItem = Array.isArray(response?.data) ? response.data[0] : undefined;
        if (!firstItem || typeof firstItem !== "object") {
          throw new Error("Image generation response was empty.");
        }

        const asset = await readGeneratedImageAsset(firstItem as Record<string, unknown>, linkedAbort.controller.signal);
        const persistedOutputFormat = isAgnes ? asset.detectedFormat ?? outputFormat : outputFormat;
        const generatedImagesDir = getGeneratedImagesDir(context);
        await fs.mkdir(generatedImagesDir, { recursive: true });

        const fileName = `image-${buildTimestamp()}-${crypto.randomUUID().slice(0, 8)}.${persistedOutputFormat}`;
        const filePath = path.join(generatedImagesDir, fileName);
        await fs.writeFile(filePath, asset.buffer);

        const relativePath = `generated/images/${fileName}`;
        const webPath = `/generated/images/${fileName}`;

        return {
          id,
          name,
          success: true,
          output: buildOutput({
            webPath,
            relativePath,
            model: config.model,
          }),
          durationMs: Date.now() - start,
          metadata: {
            model: config.model,
            webPath,
            relativePath,
            outputFormat: persistedOutputFormat,
          },
        };
      } finally {
        linkedAbort.cleanup();
      }
    } catch (err) {
      return {
        id,
        name,
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  },
};
