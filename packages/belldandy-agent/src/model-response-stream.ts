export type ModelResponseProtocol = "openai" | "anthropic";
export type ModelResponseWireApi = "chat_completions" | "responses";

export const DEFAULT_MODEL_STREAM_MAX_EVENT_BYTES = 1024 * 1024;
export const DEFAULT_MODEL_STREAM_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES = 1024 * 1024;
export const DEFAULT_MODEL_STREAM_MAX_TOOL_CALLS = 128;

export type ModelResponseStreamUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  raw: Record<string, unknown>;
};

export type ModelResponseStreamToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelResponseStreamResult = {
  content: string;
  reasoningContent?: string;
  toolCalls: ModelResponseStreamToolCall[];
  usage?: ModelResponseStreamUsage;
  finishReason?: string;
};

export type ModelResponseStreamItem =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | {
    type: "tool_call_delta";
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  }
  | { type: "usage"; usage: ModelResponseStreamUsage }
  | { type: "completed"; response: ModelResponseStreamResult };

export type ModelResponseStreamErrorCode =
  | "aborted"
  | "invalid_utf8"
  | "event_too_large"
  | "invalid_event_json"
  | "provider_error"
  | "response_too_large"
  | "too_many_tool_calls"
  | "tool_arguments_too_large"
  | "invalid_tool_call"
  | "incomplete_stream";

export class ModelResponseStreamError extends Error {
  readonly code: ModelResponseStreamErrorCode;

  constructor(code: ModelResponseStreamErrorCode, message: string) {
    super(message);
    this.name = code === "aborted" ? "AbortError" : "ModelResponseStreamError";
    this.code = code;
  }
}

export type ModelResponseStreamOptions = {
  protocol: ModelResponseProtocol;
  wireApi: ModelResponseWireApi;
  signal?: AbortSignal;
  maxEventBytes?: number;
  maxResponseBytes?: number;
  maxToolArgumentBytes?: number;
  maxToolCalls?: number;
};

type ResolvedModelResponseStreamOptions = {
  protocol: ModelResponseProtocol;
  wireApi: ModelResponseWireApi;
  signal?: AbortSignal;
  maxEventBytes: number;
  maxResponseBytes: number;
  maxToolArgumentBytes: number;
  maxToolCalls: number;
};

type SseData = { data: string };

type MutableToolCall = {
  index: number;
  id: string;
  name: string;
  arguments: string;
};

type HandlerResult = {
  items: ModelResponseStreamItem[];
  completed: boolean;
};

class ModelResponseAccumulator {
  private readonly contentParts: string[] = [];
  private readonly reasoningParts: string[] = [];
  private readonly toolsByIndex = new Map<number, MutableToolCall>();
  private readonly toolsByAlias = new Map<string, MutableToolCall>();
  private responseBytes = 0;
  private usage: ModelResponseStreamUsage | undefined;
  private finishReason: string | undefined;

  constructor(private readonly options: ResolvedModelResponseStreamOptions) {}

  addText(delta: string): ModelResponseStreamItem[] {
    if (!delta) return [];
    this.reserveResponseBytes(byteLength(delta));
    this.contentParts.push(delta);
    return [{ type: "text_delta", delta }];
  }

  addReasoning(delta: string): ModelResponseStreamItem[] {
    if (!delta) return [];
    this.reserveResponseBytes(byteLength(delta));
    this.reasoningParts.push(delta);
    return [{ type: "reasoning_delta", delta }];
  }

  addToolFragment(input: {
    index?: number;
    alias?: string;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  }): ModelResponseStreamItem[] {
    const tool = this.resolveTool(input.index, input.alias);
    if (input.alias) this.toolsByAlias.set(input.alias, tool);
    if (input.id) tool.id = mergeIdentityFragment(tool.id, input.id);
    if (input.name) tool.name = mergeIdentityFragment(tool.name, input.name);
    if (input.argumentsDelta) {
      this.reserveToolArgumentBytes(tool, input.argumentsDelta);
      tool.arguments += input.argumentsDelta;
    }
    return [{
      type: "tool_call_delta",
      index: tool.index,
      ...(input.id ? { id: input.id } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.argumentsDelta ? { argumentsDelta: input.argumentsDelta } : {}),
    }];
  }

  setToolArguments(input: { index?: number; alias?: string; arguments: string }): void {
    const tool = this.resolveTool(input.index, input.alias);
    const previousBytes = byteLength(tool.arguments);
    const nextBytes = byteLength(input.arguments);
    if (nextBytes > this.options.maxToolArgumentBytes) {
      throw new ModelResponseStreamError(
        "tool_arguments_too_large",
        `Model tool arguments exceeded ${this.options.maxToolArgumentBytes} bytes.`,
      );
    }
    this.responseBytes = this.responseBytes - previousBytes + nextBytes;
    if (this.responseBytes > this.options.maxResponseBytes) {
      throw new ModelResponseStreamError(
        "response_too_large",
        `Model stream response exceeded ${this.options.maxResponseBytes} bytes.`,
      );
    }
    tool.arguments = input.arguments;
  }

  setFinishReason(value: unknown): void {
    if (typeof value === "string" && value) this.finishReason = value;
  }

  updateUsage(raw: unknown): ModelResponseStreamItem[] {
    if (!isRecord(raw)) return [];
    const normalized = normalizeUsage(raw, this.usage);
    this.usage = normalized;
    return [{ type: "usage", usage: cloneUsage(normalized) }];
  }

  complete(): ModelResponseStreamResult {
    const toolCalls = [...this.toolsByIndex.values()]
      .sort((left, right) => left.index - right.index)
      .map((tool) => {
        if (!tool.id || !tool.name) {
          throw new ModelResponseStreamError(
            "invalid_tool_call",
            `Model stream tool call at index ${tool.index} is missing an id or name.`,
          );
        }
        return {
          id: tool.id,
          name: tool.name,
          arguments: tool.arguments || "{}",
        };
      });
    const reasoningContent = this.reasoningParts.join("");
    return {
      content: this.contentParts.join(""),
      ...(reasoningContent ? { reasoningContent } : {}),
      toolCalls,
      ...(this.usage ? { usage: cloneUsage(this.usage) } : {}),
      ...(this.finishReason ? { finishReason: this.finishReason } : {}),
    };
  }

  private resolveTool(index?: number, alias?: string): MutableToolCall {
    if (alias) {
      const aliased = this.toolsByAlias.get(alias);
      if (aliased) return aliased;
    }
    if (typeof index === "number") {
      const indexed = this.toolsByIndex.get(index);
      if (indexed) return indexed;
    }
    if (this.toolsByIndex.size >= this.options.maxToolCalls) {
      throw new ModelResponseStreamError(
        "too_many_tool_calls",
        `Model stream exceeded ${this.options.maxToolCalls} tool calls.`,
      );
    }
    const resolvedIndex = typeof index === "number" ? index : nextToolIndex(this.toolsByIndex);
    const tool: MutableToolCall = { index: resolvedIndex, id: "", name: "", arguments: "" };
    this.toolsByIndex.set(resolvedIndex, tool);
    if (alias) this.toolsByAlias.set(alias, tool);
    return tool;
  }

  private reserveToolArgumentBytes(tool: MutableToolCall, delta: string): void {
    if (byteLength(tool.arguments) + byteLength(delta) > this.options.maxToolArgumentBytes) {
      throw new ModelResponseStreamError(
        "tool_arguments_too_large",
        `Model tool arguments exceeded ${this.options.maxToolArgumentBytes} bytes.`,
      );
    }
    this.reserveResponseBytes(byteLength(delta));
  }

  private reserveResponseBytes(bytes: number): void {
    this.responseBytes += bytes;
    if (this.responseBytes > this.options.maxResponseBytes) {
      throw new ModelResponseStreamError(
        "response_too_large",
        `Model stream response exceeded ${this.options.maxResponseBytes} bytes.`,
      );
    }
  }
}

export async function* readModelResponseStream(
  body: ReadableStream<Uint8Array>,
  options: ModelResponseStreamOptions,
): AsyncIterable<ModelResponseStreamItem> {
  const resolved = resolveOptions(options);
  const accumulator = new ModelResponseAccumulator(resolved);

  for await (const event of readSseData(body, resolved)) {
    if (event.data === "[DONE]") {
      if (resolved.protocol === "openai" && resolved.wireApi === "chat_completions") {
        yield { type: "completed", response: accumulator.complete() };
        return;
      }
      continue;
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(event.data);
      if (!isRecord(parsed)) throw new Error("SSE data is not an object.");
      payload = parsed;
    } catch {
      throw new ModelResponseStreamError("invalid_event_json", "Model stream returned invalid event JSON.");
    }

    const handled = resolved.protocol === "anthropic"
      ? handleAnthropicEvent(payload, accumulator)
      : resolved.wireApi === "responses"
        ? handleResponsesEvent(payload, accumulator)
        : handleChatCompletionsEvent(payload, accumulator);
    for (const item of handled.items) yield item;
    if (handled.completed) {
      yield { type: "completed", response: accumulator.complete() };
      return;
    }
  }

  throw new ModelResponseStreamError(
    "incomplete_stream",
    "Model stream ended without a protocol completion marker.",
  );
}

function handleChatCompletionsEvent(
  payload: Record<string, unknown>,
  accumulator: ModelResponseAccumulator,
): HandlerResult {
  const items: ModelResponseStreamItem[] = [];
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const rawChoice of choices) {
    if (!isRecord(rawChoice)) continue;
    accumulator.setFinishReason(rawChoice.finish_reason);
    const delta = isRecord(rawChoice.delta) ? rawChoice.delta : undefined;
    if (!delta) continue;
    if (typeof delta.content === "string") items.push(...accumulator.addText(delta.content));
    const reasoning = firstString(delta.reasoning_content, delta.reasoning);
    if (reasoning) items.push(...accumulator.addReasoning(reasoning));
    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const rawToolCall of toolCalls) {
      if (!isRecord(rawToolCall)) continue;
      const fn = isRecord(rawToolCall.function) ? rawToolCall.function : undefined;
      items.push(...accumulator.addToolFragment({
        index: toNonNegativeInteger(rawToolCall.index),
        id: typeof rawToolCall.id === "string" ? rawToolCall.id : undefined,
        name: typeof fn?.name === "string" ? fn.name : undefined,
        argumentsDelta: typeof fn?.arguments === "string" ? fn.arguments : undefined,
      }));
    }
  }
  items.push(...accumulator.updateUsage(payload.usage));
  return { items, completed: false };
}

function handleResponsesEvent(
  payload: Record<string, unknown>,
  accumulator: ModelResponseAccumulator,
): HandlerResult {
  const type = typeof payload.type === "string" ? payload.type : "";
  if (type === "response.error" || type === "error" || type === "response.failed") {
    throw providerError(payload);
  }
  if (type === "response.output_text.delta" && typeof payload.delta === "string") {
    return { items: accumulator.addText(payload.delta), completed: false };
  }
  if (
    (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta")
    && typeof payload.delta === "string"
  ) {
    return { items: accumulator.addReasoning(payload.delta), completed: false };
  }
  if (type === "response.output_item.added") {
    const item = isRecord(payload.item) ? payload.item : undefined;
    if (item?.type === "function_call") {
      const alias = typeof item.id === "string" ? item.id : undefined;
      const items = accumulator.addToolFragment({
        index: toNonNegativeInteger(payload.output_index),
        alias,
        id: firstString(item.call_id, item.id),
        name: typeof item.name === "string" ? item.name : undefined,
        argumentsDelta: typeof item.arguments === "string" && item.arguments ? item.arguments : undefined,
      });
      return { items, completed: false };
    }
  }
  if (type === "response.function_call_arguments.delta" && typeof payload.delta === "string") {
    return {
      items: accumulator.addToolFragment({
        index: toNonNegativeInteger(payload.output_index),
        alias: typeof payload.item_id === "string" ? payload.item_id : undefined,
        id: typeof payload.call_id === "string" ? payload.call_id : undefined,
        argumentsDelta: payload.delta,
      }),
      completed: false,
    };
  }
  if (type === "response.function_call_arguments.done" && typeof payload.arguments === "string") {
    accumulator.setToolArguments({
      index: toNonNegativeInteger(payload.output_index),
      alias: typeof payload.item_id === "string" ? payload.item_id : undefined,
      arguments: payload.arguments,
    });
    return { items: [], completed: false };
  }
  if (type === "response.completed") {
    const response = isRecord(payload.response) ? payload.response : undefined;
    const items = accumulator.updateUsage(response?.usage ?? payload.usage);
    return { items, completed: true };
  }
  return { items: [], completed: false };
}

function handleAnthropicEvent(
  payload: Record<string, unknown>,
  accumulator: ModelResponseAccumulator,
): HandlerResult {
  const type = typeof payload.type === "string" ? payload.type : "";
  if (type === "error") throw providerError(payload);
  if (type === "message_start") {
    const message = isRecord(payload.message) ? payload.message : undefined;
    return { items: accumulator.updateUsage(message?.usage), completed: false };
  }
  if (type === "content_block_start") {
    const block = isRecord(payload.content_block) ? payload.content_block : undefined;
    if (block?.type === "tool_use") {
      const index = toNonNegativeInteger(payload.index);
      const alias = typeof block.id === "string" ? block.id : undefined;
      const items = accumulator.addToolFragment({
        index,
        alias,
        id: alias,
        name: typeof block.name === "string" ? block.name : undefined,
      });
      if (isRecord(block.input) && Object.keys(block.input).length > 0) {
        accumulator.setToolArguments({ index, alias, arguments: JSON.stringify(block.input) });
      }
      return { items, completed: false };
    }
  }
  if (type === "content_block_delta") {
    const delta = isRecord(payload.delta) ? payload.delta : undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return { items: accumulator.addText(delta.text), completed: false };
    }
    if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      return { items: accumulator.addReasoning(delta.thinking), completed: false };
    }
    if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
      return {
        items: accumulator.addToolFragment({
          index: toNonNegativeInteger(payload.index),
          argumentsDelta: delta.partial_json,
        }),
        completed: false,
      };
    }
  }
  if (type === "message_delta") {
    const delta = isRecord(payload.delta) ? payload.delta : undefined;
    accumulator.setFinishReason(delta?.stop_reason);
    return { items: accumulator.updateUsage(payload.usage), completed: false };
  }
  return { items: [], completed: type === "message_stop" };
}

async function* readSseData(
  body: ReadableStream<Uint8Array>,
  options: ResolvedModelResponseStreamOptions,
): AsyncIterable<SseData> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let readerDone = false;
  let abortReject: ((error: ModelResponseStreamError) => void) | undefined;
  const abortError = () => new ModelResponseStreamError(
    "aborted",
    readAbortReason(options.signal) || "Model stream was aborted.",
  );
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortReject = reject;
  });
  const onAbort = () => {
    const error = abortError();
    abortReject?.(error);
    void reader.cancel(error).catch(() => {});
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (options.signal?.aborted) throw abortError();
    while (true) {
      const read = options.signal
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read();
      if (read.done) {
        readerDone = true;
        try {
          buffer += decoder.decode();
        } catch {
          throw new ModelResponseStreamError("invalid_utf8", "Model stream returned invalid UTF-8.");
        }
        break;
      }
      try {
        buffer += decoder.decode(read.value, { stream: true });
      } catch {
        throw new ModelResponseStreamError("invalid_utf8", "Model stream returned invalid UTF-8.");
      }
      while (true) {
        const boundary = findSseBoundary(buffer);
        if (!boundary) break;
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        yield* parseSseBlock(block, options.maxEventBytes);
      }
      ensureEventWithinLimit(buffer, options.maxEventBytes);
    }
    if (buffer.trim()) yield* parseSseBlock(buffer, options.maxEventBytes);
  } catch (error) {
    const normalized = normalizeStreamError(error, options.signal);
    try {
      await reader.cancel(normalized);
    } catch {
      // The original stream failure remains the diagnostic owner.
    }
    throw normalized;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (!readerDone) {
      try {
        await reader.cancel();
      } catch {
        // Returning after a protocol terminal event still releases the lock.
      }
    }
    reader.releaseLock();
  }
}

function* parseSseBlock(block: string, maxEventBytes: number): Iterable<SseData> {
  if (!block.trim()) return;
  ensureEventWithinLimit(block, maxEventBytes);
  const dataLines: string[] = [];
  for (const line of block.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    if (field !== "data") continue;
    let value = separator >= 0 ? line.slice(separator + 1) : "";
    if (value.startsWith(" ")) value = value.slice(1);
    dataLines.push(value);
  }
  if (dataLines.length > 0) yield { data: dataLines.join("\n") };
}

function resolveOptions(options: ModelResponseStreamOptions): ResolvedModelResponseStreamOptions {
  return {
    protocol: options.protocol,
    wireApi: options.wireApi,
    signal: options.signal,
    maxEventBytes: normalizePositiveInteger(options.maxEventBytes, DEFAULT_MODEL_STREAM_MAX_EVENT_BYTES),
    maxResponseBytes: normalizePositiveInteger(options.maxResponseBytes, DEFAULT_MODEL_STREAM_MAX_RESPONSE_BYTES),
    maxToolArgumentBytes: normalizePositiveInteger(
      options.maxToolArgumentBytes,
      DEFAULT_MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES,
    ),
    maxToolCalls: normalizePositiveInteger(options.maxToolCalls, DEFAULT_MODEL_STREAM_MAX_TOOL_CALLS),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function findSseBoundary(buffer: string): { index: number; length: number } | undefined {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match?.index === undefined ? undefined : { index: match.index, length: match[0].length };
}

function ensureEventWithinLimit(value: string, maxEventBytes: number): void {
  if (byteLength(value) > maxEventBytes) {
    throw new ModelResponseStreamError(
      "event_too_large",
      `Model stream event exceeded ${maxEventBytes} bytes.`,
    );
  }
}

function normalizeStreamError(error: unknown, signal?: AbortSignal): ModelResponseStreamError {
  if (error instanceof ModelResponseStreamError) return error;
  if (signal?.aborted) {
    return new ModelResponseStreamError("aborted", readAbortReason(signal) || "Model stream was aborted.");
  }
  return new ModelResponseStreamError(
    "incomplete_stream",
    error instanceof Error ? error.message : String(error),
  );
}

function providerError(payload: Record<string, unknown>): ModelResponseStreamError {
  const error = isRecord(payload.error) ? payload.error : undefined;
  const message = firstString(error?.message, payload.message) || "Model provider stream returned an error.";
  return new ModelResponseStreamError("provider_error", message);
}

function normalizeUsage(
  raw: Record<string, unknown>,
  previous?: ModelResponseStreamUsage,
): ModelResponseStreamUsage {
  return {
    ...(previous ?? { raw: {} }),
    ...numberField(raw, ["input_tokens", "prompt_tokens"], "inputTokens"),
    ...numberField(raw, ["output_tokens", "completion_tokens"], "outputTokens"),
    ...numberField(raw, ["total_tokens"], "totalTokens"),
    ...numberField(raw, ["cache_creation_input_tokens"], "cacheCreationInputTokens"),
    ...numberField(raw, ["cache_read_input_tokens"], "cacheReadInputTokens"),
    ...numberField(raw, ["prompt_cache_hit_tokens"], "promptCacheHitTokens"),
    ...numberField(raw, ["prompt_cache_miss_tokens"], "promptCacheMissTokens"),
    raw: { ...(previous?.raw ?? {}), ...raw },
  };
}

function numberField(
  source: Record<string, unknown>,
  keys: string[],
  target: keyof Omit<ModelResponseStreamUsage, "raw">,
): Partial<ModelResponseStreamUsage> {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return { [target]: value };
    }
  }
  return {};
}

function cloneUsage(usage: ModelResponseStreamUsage): ModelResponseStreamUsage {
  return { ...usage, raw: { ...usage.raw } };
}

function mergeIdentityFragment(current: string, fragment: string): string {
  if (!current) return fragment;
  if (fragment === current) return current;
  if (fragment.startsWith(current)) return fragment;
  return current + fragment;
}

function nextToolIndex(tools: Map<number, MutableToolCall>): number {
  let index = 0;
  while (tools.has(index)) index += 1;
  return index;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function readAbortReason(signal?: AbortSignal): string {
  if (!signal?.aborted) return "";
  if (typeof signal.reason === "string") return signal.reason;
  if (signal.reason instanceof Error) return signal.reason.message;
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
