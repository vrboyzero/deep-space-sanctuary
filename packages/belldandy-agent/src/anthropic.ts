/**
 * Anthropic Messages API 协议工具模块
 *
 * 负责：
 * - OpenAI 格式 ↔ Anthropic 格式的消息转换
 * - 工具定义转换（OpenAI function calling → Anthropic tool_use）
 * - Prompt Caching 标记注入
 * - Anthropic 响应解析
 */

import type { ProviderNativeSystemBlock } from "./system-prompt.js";

// ─── Types ───────────────────────────────────────────────────────────────

/** Anthropic content block */
export type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string }; cache_control?: CacheControl }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[] };

/** Anthropic cache control marker */
export type CacheControl = { type: "ephemeral" };

/** Anthropic message */
export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

/** Anthropic tool definition */
export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
};

/** Anthropic Messages API request payload */
export type AnthropicRequestPayload = {
  model: string;
  max_tokens: number;
  system?: AnthropicSystemTextBlock[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: "auto" } | { type: "any" } | { type: "tool"; name: string };
  stream?: boolean;
};

export type AnthropicSystemTextBlock = { type: "text"; text: string; cache_control?: CacheControl };

/** Anthropic usage info from response */
export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

/** Anthropic response content block */
export type AnthropicResponseBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/** Parsed Anthropic response (non-streaming) */
export type ParsedAnthropicResponse = {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage?: AnthropicUsage;
  stopReason?: string;
};

// ─── OpenAI ↔ Anthropic 格式转换 ─────────────────────────────────────────

/** OpenAI 格式的消息（tool-agent 内部使用） */
type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Array<any> }
  | { role: "assistant"; content?: string | null; tool_calls?: OpenAIToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** OpenAI 格式的工具定义 */
type OpenAIToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/**
 * 将 OpenAI 格式的消息数组转换为 Anthropic 格式。
 *
 * - system 消息提取为顶层 system 字段（数组格式，支持 cache_control）
 * - assistant + tool_calls → assistant content blocks (text + tool_use)
 * - tool role → user message with tool_result content blocks
 * - 连续同角色消息合并（Anthropic 要求严格交替）
 */
export function convertMessagesToAnthropic(
  messages: OpenAIMessage[],
  options?: { cacheSystemPrompt?: boolean; providerNativeSystemBlocks?: ProviderNativeSystemBlock[] },
): {
  system: AnthropicRequestPayload["system"];
  messages: AnthropicMessage[];
} {
  const providerNativeSystemBlocks = options?.providerNativeSystemBlocks
    ? convertProviderNativeSystemBlocksToAnthropic(options.providerNativeSystemBlocks, {
      cacheSystemPrompt: options.cacheSystemPrompt,
    })
    : undefined;
  const systemBlocks: AnthropicSystemTextBlock[] = providerNativeSystemBlocks
    ? [...providerNativeSystemBlocks]
    : [];
  const anthropicMessages: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (providerNativeSystemBlocks) {
        continue;
      }
      systemBlocks.push({ type: "text" as const, text: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];

      // 文本内容
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }

      // 工具调用 → tool_use blocks
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = { raw: tc.function.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      if (blocks.length > 0) {
        anthropicMessages.push({ role: "assistant", content: blocks });
      } else if (msg.content) {
        // 纯文本 assistant 消息
        anthropicMessages.push({ role: "assistant", content: msg.content });
      }
      continue;
    }

    if (msg.role === "tool") {
      // tool result → user message with tool_result block
      // Anthropic 要求 tool_result 在 user 角色消息中
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: msg.content,
      };

      // 尝试合并到前一个 user 消息（如果前一个也是 tool_result）
      const prev = anthropicMessages[anthropicMessages.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content)) {
        prev.content.push(block);
      } else {
        anthropicMessages.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "user") {
      // 普通用户消息
      if (typeof msg.content === "string") {
        anthropicMessages.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // 多模态内容：转换 image_url 格式
        const blocks = msg.content.map((part: any) => {
          if (part.type === "image_url" && part.image_url?.url) {
            const url: string = part.image_url.url;
            if (url.startsWith("data:")) {
              // data URI → Anthropic base64 格式
              const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (match) {
                return {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: match[1], data: match[2] },
                };
              }
            }
            // 非 data URI 的图片 URL，Anthropic 不直接支持，转为文本提示
            return { type: "text" as const, text: `[Image: ${url}]` };
          }
          if (part.type === "text") {
            return { type: "text" as const, text: part.text };
          }
          return { type: "text" as const, text: JSON.stringify(part) };
        });
        anthropicMessages.push({ role: "user", content: blocks });
      }
      continue;
    }
  }

  // 注入 system prompt 缓存标记
  if (!providerNativeSystemBlocks && options?.cacheSystemPrompt && systemBlocks.length > 0) {
    systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };
  }

  // 合并连续同角色消息（Anthropic 要求严格 user/assistant 交替）
  const merged = mergeConsecutiveRoles(anthropicMessages);

  return {
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
    messages: merged,
  };
}

export function convertProviderNativeSystemBlocksToAnthropic(
  blocks: ProviderNativeSystemBlock[],
  options?: { cacheSystemPrompt?: boolean },
): AnthropicSystemTextBlock[] {
  return blocks
    .map((block) => {
      const text = block.text.trim();
      if (!text) {
        return undefined;
      }
      return {
        type: "text" as const,
        text,
        ...(options?.cacheSystemPrompt && block.cacheControlEligible
          ? { cache_control: { type: "ephemeral" as const } }
          : {}),
      };
    })
    .filter(Boolean) as AnthropicSystemTextBlock[];
}

/**
 * 合并连续同角色消息。
 * Anthropic API 要求消息严格 user/assistant 交替。
 */
function mergeConsecutiveRoles(messages: AnthropicMessage[]): AnthropicMessage[] {
  if (messages.length === 0) return [];

  const result: AnthropicMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const current = messages[i];
    const prev = result[result.length - 1];

    if (current.role === prev.role) {
      // 合并内容
      const prevBlocks = toContentBlocks(prev.content);
      const currBlocks = toContentBlocks(current.content);
      prev.content = [...prevBlocks, ...currBlocks];
    } else {
      result.push(current);
    }
  }

  return result;
}

function toContentBlocks(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/**
 * 将 OpenAI 格式的工具定义转换为 Anthropic 格式。
 * 可选在最后一个工具上注入 cache_control。
 */
export function convertToolsToAnthropic(
  tools: OpenAIToolDef[],
  options?: { cacheTools?: boolean },
): AnthropicTool[] {
  const anthropicTools: AnthropicTool[] = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  // 在最后一个工具上注入缓存标记
  if (options?.cacheTools && anthropicTools.length > 0) {
    anthropicTools[anthropicTools.length - 1].cache_control = { type: "ephemeral" };
  }

  return anthropicTools;
}

/**
 * 解析 Anthropic Messages API 的非流式响应。
 * 提取文本内容、工具调用、usage 信息。
 */
export function parseAnthropicResponse(json: any): ParsedAnthropicResponse {
  const content: string[] = [];
  const toolCalls: ParsedAnthropicResponse["toolCalls"] = [];

  const blocks = json.content as AnthropicResponseBlock[] | undefined;
  if (blocks) {
    for (const block of blocks) {
      if (block.type === "text") {
        content.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }
  }

  return {
    content: content.join(""),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: json.usage as AnthropicUsage | undefined,
    stopReason: json.stop_reason,
  };
}

/**
 * 构建 Anthropic Messages API 的完整请求。
 */
export function buildAnthropicRequest(params: {
  profile: { baseUrl: string; apiKey: string; model: string };
  messages: OpenAIMessage[];
  tools?: OpenAIToolDef[];
  maxTokens?: number;
  stream?: boolean;
  enableCaching?: boolean;
  providerNativeSystemBlocks?: ProviderNativeSystemBlock[];
}): { url: string; init: RequestInit } {
  const {
    profile,
    messages,
    tools,
    maxTokens = 4096,
    stream = false,
    enableCaching = true,
    providerNativeSystemBlocks,
  } = params;

  // 转换消息
  const { system, messages: anthropicMessages } = convertMessagesToAnthropic(messages, {
    cacheSystemPrompt: enableCaching,
    providerNativeSystemBlocks,
  });

  // 构建 payload
  const payload: AnthropicRequestPayload = {
    model: profile.model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
    stream,
  };

  if (system) {
    payload.system = system;
  }

  // 转换并注入工具
  if (tools && tools.length > 0) {
    payload.tools = convertToolsToAnthropic(tools, { cacheTools: enableCaching });
    payload.tool_choice = { type: "auto" };
  }

  // 构建 URL：确保以 /v1/messages 结尾
  const baseUrl = profile.baseUrl.replace(/\/+$/, "");
  const url = baseUrl.includes("/v1/messages") ? baseUrl : `${baseUrl}/v1/messages`;

  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    },
  };
}
