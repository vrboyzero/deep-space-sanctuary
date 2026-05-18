import type { JsonObject } from "@belldandy/protocol";

import type { AgentRunInput, AgentStreamItem, BelldandyAgent } from "./index.js";
import { FailoverClient, type ModelProfile, type FailoverExecutionSummary, type FailoverLogger } from "./failover-client.js";
import { applyOpenAICompatibleReasoningConfig } from "./openai-reasoning.js";
import { buildUrl, preprocessMultimodalContent, type VideoUploadConfig } from "./multimodal.js";
import {
  createAgentPromptSnapshot,
  readPromptSnapshotDeltas,
  readPromptSnapshotRunId,
  type AgentPromptSnapshot,
} from "./prompt-snapshot.js";
import { buildProviderNativeSystemBlocks, type SystemPromptSection } from "./system-prompt.js";

export type OpenAIWireApi = "chat_completions" | "responses";

export type OpenAIChatAgentOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  stream?: boolean;
  systemPrompt?: string;
  /** 备用 Profile 列表（模型容灾） */
  fallbacks?: ModelProfile[];
  /** 容灾日志接口 */
  failoverLogger?: FailoverLogger;
  /** 视频文件上传专用配置（当聊天代理不支持 /files 端点时） */
  videoUploadConfig?: VideoUploadConfig;
  /** 强制指定 API 协议（默认自动检测） */
  protocol?: ApiProtocol;
  /** 单次模型调用最大输出 token 数（默认 4096；调大可避免长输出被截断） */
  maxOutputTokens?: number;
  /** OpenAI 协议底层线路：chat.completions（默认）或 responses */
  wireApi?: OpenAIWireApi;
  /** 同一 profile 最大重试次数（不含首次请求） */
  maxRetries?: number;
  /** 同一 profile 重试退避基线（毫秒） */
  retryBackoffMs?: number;
  /** primary profile 专用代理 URL（可选） */
  proxyUrl?: string;
  /** OpenAI-compatible 思考模式配置（primary profile） */
  thinking?: Record<string, unknown>;
  /** OpenAI-compatible 推理强度（primary profile） */
  reasoningEffort?: string;
  /** OpenAI-compatible / provider-specific options（primary profile） */
  options?: Record<string, unknown>;
  /** 启动阶段预置冷却（毫秒） */
  bootstrapProfileCooldowns?: Record<string, number>;
  /** 记录本次 run 实际发给模型的 prompt snapshot */
  onPromptSnapshot?: (snapshot: AgentPromptSnapshot) => void;
  /** 当前 system prompt 的结构化 sections，供 snapshot / inspect 复用 */
  systemPromptSections?: SystemPromptSection[];
  /** 预置到 prompt snapshot 的 system prompt 观测元数据 */
  systemPromptMetadata?: JsonObject;
  /** runtime resilience 观察回调 */
  onRuntimeResilienceEvent?: (event: {
    source: "openai_chat";
    phase: "primary_chat";
    agentId?: string;
    conversationId: string;
    summary: FailoverExecutionSummary;
  }) => void;
};

type ApiProtocol = "openai" | "anthropic";
const MIN_MULTIMODAL_REQUEST_TIMEOUT_MS = 300_000;
const LARGE_TEXT_ATTACHMENT_TRIGGER_CHARS = 12_000;
const HUGE_TEXT_ATTACHMENT_TRIGGER_CHARS = 30_000;
const MIN_LARGE_TEXT_ATTACHMENT_TIMEOUT_MS = 120_000;
const MIN_HUGE_TEXT_ATTACHMENT_TIMEOUT_MS = 300_000;

/**
 * 检测 API 协议类型
 * - 如果指定了 forceProtocol 参数，优先使用该值
 * - 否则根据 baseUrl 自动检测
 * - Anthropic 协议：Anthropic 官方、Kimi Code 等
 * - OpenAI 协议：OpenAI、Azure、Moonshot、Gemini 等
 */
function detectProtocol(baseUrl: string, forceProtocol?: ApiProtocol): ApiProtocol {
  // 优先使用强制指定的协议
  if (forceProtocol) {
    return forceProtocol;
  }

  const lowerUrl = baseUrl.toLowerCase();
  // Anthropic 官方 API 或兼容端点
  if (lowerUrl.includes("anthropic.com") || lowerUrl.includes("kimi.com/coding")) {
    return "anthropic";
  }
  return "openai";
}

function normalizeWireApi(raw?: string): OpenAIWireApi | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "responses") return "responses";
  if (value === "chat_completions") return "chat_completions";
  return undefined;
}

function resolveWireApiForProfile(
  profile: { id?: string; wireApi?: string },
  defaultWireApi: OpenAIWireApi,
): OpenAIWireApi {
  const fromProfile = normalizeWireApi(profile.wireApi);
  if (fromProfile) return fromProfile;
  // fallback profile 默认走 chat_completions，避免全局 responses 导致兼容模型 404
  if (profile.id && profile.id !== "primary") return "chat_completions";
  return defaultWireApi;
}

function hasMultimodalContentInMessages(messages: Array<{ role: string; content: any }>): boolean {
  return messages.some((m) =>
    Array.isArray(m.content) && m.content.some((part: any) => typeof part?.type === "string" && part.type !== "text")
  );
}

function readTextAttachmentChars(meta?: JsonObject): number {
  if (!meta || typeof meta !== "object") return 0;
  const stats = (meta as any).attachmentStats;
  const value = stats?.promptAugmentationChars ?? stats?.textAttachmentChars;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function resolveMinimumAdaptiveTimeoutMs(
  messages: Array<{ role: string; content: any }>,
  textAttachmentChars: number,
): number | undefined {
  let minimumTimeoutMs = 0;

  if (hasMultimodalContentInMessages(messages)) {
    minimumTimeoutMs = Math.max(minimumTimeoutMs, MIN_MULTIMODAL_REQUEST_TIMEOUT_MS);
  }

  if (textAttachmentChars >= HUGE_TEXT_ATTACHMENT_TRIGGER_CHARS) {
    minimumTimeoutMs = Math.max(minimumTimeoutMs, MIN_HUGE_TEXT_ATTACHMENT_TIMEOUT_MS);
  } else if (textAttachmentChars >= LARGE_TEXT_ATTACHMENT_TRIGGER_CHARS) {
    minimumTimeoutMs = Math.max(minimumTimeoutMs, MIN_LARGE_TEXT_ATTACHMENT_TIMEOUT_MS);
  }

  return minimumTimeoutMs > 0 ? minimumTimeoutMs : undefined;
}

export class OpenAIChatAgent implements BelldandyAgent {
  private readonly opts: Required<Pick<OpenAIChatAgentOptions, "timeoutMs" | "stream" | "wireApi" | "maxRetries" | "retryBackoffMs">> &
    Omit<OpenAIChatAgentOptions, "timeoutMs" | "stream" | "wireApi" | "maxRetries" | "retryBackoffMs">;
  private readonly failoverClient: FailoverClient;
  private readonly protocol: ApiProtocol;

  constructor(opts: OpenAIChatAgentOptions) {
    this.opts = {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 60_000,
      stream: opts.stream ?? true,
      wireApi: opts.wireApi ?? "chat_completions",
      maxRetries: opts.maxRetries ?? 0,
      retryBackoffMs: opts.retryBackoffMs ?? 300,
    };

    // 检测 API 协议类型（优先使用用户指定的协议）
    this.protocol = detectProtocol(opts.baseUrl, opts.protocol);

    // 初始化容灾客户端
    this.failoverClient = new FailoverClient({
      primary: {
        id: "primary",
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
        proxyUrl: opts.proxyUrl,
        thinking: opts.thinking,
        reasoningEffort: opts.reasoningEffort,
        options: opts.options,
      },
      fallbacks: opts.fallbacks,
      logger: opts.failoverLogger,
      bootstrapCooldowns: opts.bootstrapProfileCooldowns,
    });
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentStreamItem> {
    yield { type: "status", status: "running" };

    try {
      let content = input.content || input.text;

      // Preprocess: upload local videos to Moonshot
      const needsVideoUpload = Array.isArray(content) &&
        content.some((p: any) => p.type === "video_url" && p.video_url?.url?.startsWith("file://"));
      if (needsVideoUpload) {
        yield { type: "status", status: "uploading_video" as any };
        const profiles = this.failoverClient.getProfiles();
        const profile = profiles.find(p => p.id === "primary") || profiles[0];
        if (profile) {
          const result = await preprocessMultimodalContent(content, profile, this.opts.videoUploadConfig);
          content = result.content;
        }
      }

      const messages = buildMessages(this.opts.systemPrompt, content, input.history);
      const promptDeltas = readPromptSnapshotDeltas(input.meta);
      const providerNativeSystemBlocks = buildProviderNativeSystemBlocks({
        sections: this.opts.systemPromptSections,
        deltas: promptDeltas,
        fallbackText: this.opts.systemPrompt,
      });
      this.opts.onPromptSnapshot?.(createAgentPromptSnapshot({
        agentId: input.agentId,
        conversationId: input.conversationId,
        runId: readPromptSnapshotRunId(input.meta),
        messages,
        deltas: promptDeltas,
        providerNativeSystemBlocks,
        inputMeta: mergePromptSnapshotInputMeta(this.opts.systemPromptMetadata, input.meta),
      }));
      const textAttachmentChars = readTextAttachmentChars(input.meta);
      const minimumAdaptiveTimeoutMs = resolveMinimumAdaptiveTimeoutMs(messages, textAttachmentChars);
      const requestTimeoutMs = minimumAdaptiveTimeoutMs
        ? Math.max(this.opts.timeoutMs, minimumAdaptiveTimeoutMs)
        : this.opts.timeoutMs;

      // 使用容灾客户端发送请求
      const { response: res, profile: usedProfile } = await this.failoverClient.fetchWithFailover({
        signal: input.abortSignal,
        timeoutMs: requestTimeoutMs,
        minimumTimeoutMs: minimumAdaptiveTimeoutMs,
        maxRetries: this.opts.maxRetries,
        retryBackoffMs: this.opts.retryBackoffMs,
        onSummary: (summary) => {
          this.opts.onRuntimeResilienceEvent?.({
            source: "openai_chat",
            phase: "primary_chat",
            agentId: input.agentId,
            conversationId: input.conversationId,
            summary,
          });
        },
        buildRequest: (profile) => this.buildRequest(profile, messages),
      });

      // 实际使用的协议（跟随 failover 选中的 profile）
      const actualProtocol: ApiProtocol = (usedProfile.protocol as ApiProtocol) ?? this.protocol;
      const actualWireApi = resolveWireApiForProfile(usedProfile, this.opts.wireApi);

      if (!res.ok) {
        const text = await safeReadText(res);
        yield { type: "final", text: `模型调用失败（HTTP ${res.status}）：${text}` };
        yield { type: "status", status: "error" };
        return;
      }

      if (!this.opts.stream) {
        const json = (await res.json()) as JsonObject;
        const content = this.getNonStreamContent(json, actualProtocol, actualWireApi);
        yield* emitChunkedFinal(content);
        return;
      }

      const body = res.body;
      if (!body) {
        yield { type: "final", text: "模型调用失败：响应体为空" };
        yield { type: "status", status: "error" };
        return;
      }

      let out = "";
      for await (const item of parseSseStream(body as any, actualProtocol, actualWireApi)) {
        if (item.type === "delta") {
          out += item.delta;
          yield item;
        }
        if (item.type === "final") {
          yield { type: "final", text: out };
          yield { type: "status", status: "done" };
          return;
        }
        if (item.type === "error") {
          yield { type: "final", text: item.message };
          yield { type: "status", status: "error" };
          return;
        }
      }

      yield { type: "final", text: out };
      yield { type: "status", status: "done" };
    } catch (err) {
      if (wasExternallyAborted(err, input.abortSignal)) {
        yield { type: "status", status: "stopped" };
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "final", text: `模型调用异常：${msg}` };
      yield { type: "status", status: "error" };
    }
  }

  private buildRequest(
    profile: {
      id?: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      protocol?: string;
      wireApi?: string;
      thinking?: Record<string, unknown>;
      reasoningEffort?: string;
      options?: Record<string, unknown>;
    },
    messages: Array<{ role: string; content: any }>
  ): { url: string; init: RequestInit } {
    // 优先使用 profile 自身的 protocol（models.json 配置），再 fallback 到 agent 级别协议
    const effectiveProtocol = (profile.protocol as ApiProtocol) ?? this.protocol;
    const effectiveWireApi = resolveWireApiForProfile(profile, this.opts.wireApi);

    if (effectiveProtocol === "anthropic") {
      // Anthropic 协议：提取 system 消息，使用数组格式支持 prompt caching
      const systemMessage = messages.find(m => m.role === "system")?.content;
      const chatMessages = messages.filter(m => m.role !== "system");

      const payload: any = {
        model: profile.model,
        messages: chatMessages,
        max_tokens: this.opts.maxOutputTokens ?? 4096,
        stream: this.opts.stream,
      };

      // System prompt 使用数组格式 + cache_control 启用 prompt caching
      if (systemMessage) {
        payload.system = [
          {
            type: "text",
            text: typeof systemMessage === "string" ? systemMessage : JSON.stringify(systemMessage),
            cache_control: { type: "ephemeral" },
          },
        ];
      }

      // 标准 Anthropic API headers
      // 注意：某些服务（如 Kimi Code）可能有额外的客户端校验
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      };

      return {
        url: buildUrl(profile.baseUrl, "/v1/messages"),
        init: {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
      };
    }

    // OpenAI 协议
    if (effectiveWireApi === "responses") {
      const payload: Record<string, unknown> = {
        model: profile.model,
        input: buildResponsesInput(messages),
        max_output_tokens: this.opts.maxOutputTokens ?? 4096,
        stream: this.opts.stream,
      };
      applyOpenAICompatibleReasoningConfig(payload, profile);

      return {
        url: buildUrl(profile.baseUrl, "/responses"),
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${profile.apiKey}`,
          },
          body: JSON.stringify(payload),
        },
      };
    }

    const payload: Record<string, unknown> = {
      model: profile.model,
      messages,
      max_tokens: this.opts.maxOutputTokens ?? 4096,
      stream: this.opts.stream,
    };
    applyOpenAICompatibleReasoningConfig(payload, profile);

    return {
      url: buildUrl(profile.baseUrl, "/chat/completions"),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${profile.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
    };
  }

  private getNonStreamContent(json: JsonObject, protocol?: ApiProtocol, wireApi?: OpenAIWireApi): string {
    if ((protocol ?? this.protocol) === "anthropic") {
      // Anthropic 格式：{ content: [{ type: "text", text: "..." }] }
      const content = (json.content as unknown) as Array<any> | undefined;
      return content?.[0]?.text ?? "";
    }

    if ((wireApi ?? this.opts.wireApi) === "responses") {
      return extractResponsesText(json);
    }

    // OpenAI Chat Completions 格式：{ choices: [{ message: { content: "..." } }] }
    const choices = (json.choices as unknown) as Array<any> | undefined;
    return choices?.[0]?.message?.content ?? "";
  }
}

function mergePromptSnapshotInputMeta(
  systemPromptMetadata?: JsonObject,
  runMeta?: JsonObject,
): JsonObject | undefined {
  if (!systemPromptMetadata && !runMeta) {
    return undefined;
  }
  const merged: Record<string, unknown> = {
    ...(systemPromptMetadata ? { ...systemPromptMetadata } : {}),
    ...(runMeta ? { ...runMeta } : {}),
  };
  delete merged.promptDeltas;
  return merged as JsonObject;
}


function buildMessages(
  systemPrompt: string | undefined,
  userContent: string | Array<any>,
  history?: Array<{ role: "user" | "assistant"; content: string | Array<any> }>,
) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: any }> = [];

  // Layer 1: System
  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: "system", content: systemPrompt.trim() });
  }

  // Layer 2: History
  if (history && history.length > 0) {
    messages.push(...history);
  }

  // Layer 3: Current User Message
  messages.push({ role: "user", content: userContent });

  return messages;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return "";
  }
}

async function* emitChunkedFinal(text: string): AsyncIterable<AgentStreamItem> {
  const chunks = splitText(text, 16);
  let out = "";
  for (const delta of chunks) {
    out += delta;
    yield { type: "delta", delta };
  }
  yield { type: "final", text: out };
  yield { type: "status", status: "done" };
}

function splitText(text: string, size: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + Math.max(1, size)));
    i += Math.max(1, size);
  }
  return out;
}

function wasExternallyAborted(_error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

type ParsedSseItem =
  | { type: "delta"; delta: string }
  | { type: "final" }
  | { type: "error"; message: string };

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  protocol: ApiProtocol,
  wireApi: OpenAIWireApi
): AsyncIterable<ParsedSseItem> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx < 0) break;
      const eventBlock = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const dataLines = eventBlock
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice("data:".length).trim());

      for (const data of dataLines) {
        if (data === "[DONE]") {
          yield { type: "final" };
          return;
        }
        try {
          const json = JSON.parse(data) as any;

          if (protocol === "anthropic") {
            // Anthropic SSE 格式
            // { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
            if (json.type === "content_block_delta" && json.delta?.text) {
              yield { type: "delta", delta: json.delta.text };
            }
            // 消息结束标记
            if (json.type === "message_stop") {
              yield { type: "final" };
              return;
            }
          } else {
            if (wireApi === "responses") {
              // Responses SSE: response.output_text.delta / response.completed
              if (json?.type === "response.output_text.delta" && typeof json.delta === "string" && json.delta.length) {
                yield { type: "delta", delta: json.delta };
                continue;
              }
              if (json?.type === "response.completed") {
                yield { type: "final" };
                return;
              }
              if (json?.type === "response.error" || json?.type === "error") {
                const message = json?.error?.message ?? "模型流返回错误";
                yield { type: "error", message };
                return;
              }
            } else {
              // OpenAI Chat Completions SSE 格式
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length) {
                yield { type: "delta", delta };
              }
            }
          }
        } catch {
          yield { type: "error", message: "模型流解析失败" };
          return;
        }
      }
    }
  }
}

function buildResponsesInput(messages: Array<{ role: string; content: any }>): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    const role = toResponsesRole(message.role);
    const content = toResponsesContent(message.content);
    if (typeof content === "undefined") continue;
    input.push({ role, content });
  }
  return input;
}

function toResponsesRole(role: string): "developer" | "user" | "assistant" {
  if (role === "system" || role === "developer") return "developer";
  if (role === "assistant") return "assistant";
  return "user";
}

function toResponsesContent(content: any): string | Array<Record<string, unknown>> | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const mapped = content
      .map((part) => {
        if (!part || typeof part !== "object") return undefined;
        if (part.type === "text" && typeof part.text === "string") {
          return { type: "input_text", text: part.text };
        }
        if (part.type === "image_url" && typeof part.image_url?.url === "string") {
          return { type: "input_image", image_url: part.image_url.url };
        }
        if (part.type === "video_url" && typeof part.video_url?.url === "string") {
          return { type: "input_text", text: `[Video] ${part.video_url.url}` };
        }
        return undefined;
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    return mapped.length > 0 ? mapped : undefined;
  }
  if (content === null || typeof content === "undefined") {
    return undefined;
  }
  return String(content);
}

function extractResponsesText(json: JsonObject): string {
  const direct = (json as any).output_text;
  if (typeof direct === "string") {
    return direct;
  }

  const output = Array.isArray((json as any).output) ? (json as any).output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!part || typeof part !== "object") continue;
        if (typeof part.text === "string" && part.text.length > 0) {
          chunks.push(part.text);
        }
      }
    }
  }

  return chunks.join("");
}
