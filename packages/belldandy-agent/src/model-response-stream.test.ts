import { describe, expect, it, vi } from "vitest";

import {
  ModelResponseStreamError,
  readModelResponseStream,
  type ModelResponseStreamItem,
  type ModelResponseStreamOptions,
} from "./model-response-stream.js";

const encoder = new TextEncoder();

function createByteStream(
  chunks: Uint8Array[],
  options: { keepOpen?: boolean; onCancel?: (reason: unknown) => void } = {},
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!options.keepOpen) controller.close();
    },
    cancel(reason) {
      options.onCancel?.(reason);
    },
  });
}

function encodeChunks(...chunks: string[]): Uint8Array[] {
  return chunks.map((chunk) => encoder.encode(chunk));
}

async function collect(
  body: ReadableStream<Uint8Array>,
  options: ModelResponseStreamOptions,
): Promise<ModelResponseStreamItem[]> {
  const items: ModelResponseStreamItem[] = [];
  for await (const item of readModelResponseStream(body, options)) items.push(item);
  return items;
}

function getCompleted(items: ModelResponseStreamItem[]) {
  const item = items.find((candidate) => candidate.type === "completed");
  if (!item || item.type !== "completed") throw new Error("Expected a completed stream item.");
  return item.response;
}

describe("readModelResponseStream", () => {
  it("parses OpenAI chat text, reasoning, multiple fragmented tool calls and usage across CRLF and UTF-8 chunks", async () => {
    const utf8 = encoder.encode("星");
    const body = createByteStream([
      ...encodeChunks(
        "data: {\"choices\":[\r\n",
        "data: {\"delta\":{\"content\":\"你\"}}]}\r\n\r\n",
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden\"}}]}\r\n\r\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":\\\"\"}},{\"index\":1,\"id\":\"call_2\",\"function\":{\"name\":\"other\",\"arguments\":\"{}\"}}]}}]}\r\n\r\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"",
      ),
      utf8.slice(0, 1),
      utf8.slice(1),
      ...encodeChunks(
        "\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\r\n\r\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}}\r\n\r\n",
        "data: [DONE]\r\n\r\n",
      ),
    ]);

    const items = await collect(body, { protocol: "openai", wireApi: "chat_completions" });
    const completed = getCompleted(items);

    expect(items).toContainEqual({ type: "text_delta", delta: "你" });
    expect(items).toContainEqual({ type: "reasoning_delta", delta: "hidden" });
    expect(completed).toMatchObject({
      content: "你",
      reasoningContent: "hidden",
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call_1", name: "lookup", arguments: "{\"q\":\"星\"}" },
        { id: "call_2", name: "other", arguments: "{}" },
      ],
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
    expect(body.locked).toBe(false);
  });

  it("removes a split provider control-frame suffix from a JSON response", async () => {
    const expected = '{"summary":"done"}';
    const body = createByteStream(encodeChunks(
      `data: ${JSON.stringify({ choices: [{ delta: { content: `${expected}</｜｜DS` } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "ML｜｜parameter>\n<" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "/｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "calls>" }, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ));

    const items = await collect(body, { protocol: "openai", wireApi: "chat_completions" });

    expect(items.filter((item) => item.type === "text_delta").map((item) => item.delta).join(""))
      .toBe(expected);
    expect(getCompleted(items).content).toBe(expected);
  });

  it("removes a provider control-frame suffix after an explicit JSON code block", async () => {
    const expected = "```json\n{\"summary\":\"done\"}\n```";
    const body = createByteStream(encodeChunks(
      `data: ${JSON.stringify({ choices: [{ delta: { content: `${expected}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>` } }] })}\n\n`,
      "data: [DONE]\n\n",
    ));

    const items = await collect(body, { protocol: "openai", wireApi: "chat_completions" });

    expect(getCompleted(items).content).toBe(expected);
  });

  it.each([
    {
      name: "ordinary text",
      content: "Document this literal: </｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>",
    },
    {
      name: "a JSON string value",
      content: '"</｜｜DSML｜｜parameter>\\n</｜｜DSML｜｜invoke>\\n</｜｜DSML｜｜tool_calls>"',
    },
    {
      name: "an incomplete trailing frame",
      content: '{"summary":"done"}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜inv',
    },
  ])("preserves $name byte-for-byte", async ({ content }) => {
    const body = createByteStream(encodeChunks(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      "data: [DONE]\n\n",
    ));

    const items = await collect(body, { protocol: "openai", wireApi: "chat_completions" });

    expect(items.filter((item) => item.type === "text_delta").map((item) => item.delta).join(""))
      .toBe(content);
    expect(getCompleted(items).content).toBe(content);
  });

  it("parses OpenAI Responses text, reasoning, function arguments and completed usage", async () => {
    const body = createByteStream(encodeChunks(
      "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello \"}\n\n",
      "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"private\"}\n\n",
      "data: {\"type\":\"response.output_item.added\",\"output_index\":1,\"item\":{\"id\":\"fc_1\",\"call_id\":\"call_1\",\"type\":\"function_call\",\"name\":\"search\",\"arguments\":\"\"}}\n\n",
      "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"output_index\":1,\"delta\":\"{\\\"q\\\":\"}\n\n",
      "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"output_index\":1,\"delta\":\"\\\"docs\\\"}\"}\n\n",
      "data: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"fc_1\",\"output_index\":1,\"arguments\":\"{\\\"q\\\":\\\"docs\\\"}\"}\n\n",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"world\"}\n\n",
      "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":5,\"output_tokens\":6,\"total_tokens\":11}}}\n\n",
    ));

    const items = await collect(body, { protocol: "openai", wireApi: "responses" });
    const completed = getCompleted(items);

    expect(completed).toMatchObject({
      content: "Hello world",
      reasoningContent: "private",
      toolCalls: [{ id: "call_1", name: "search", arguments: "{\"q\":\"docs\"}" }],
      usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
    });
  });

  it("removes a split control-frame suffix from an OpenAI Responses stream", async () => {
    const expected = '{"summary":"done"}';
    const body = createByteStream(encodeChunks(
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: `${expected}</｜｜DSML｜｜para` })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "meter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>" })}\n\n`,
      `data: ${JSON.stringify({ type: "response.completed", response: {} })}\n\n`,
    ));

    const items = await collect(body, { protocol: "openai", wireApi: "responses" });

    expect(getCompleted(items).content).toBe(expected);
  });

  it("parses Anthropic text, thinking, input_json_delta and split usage", async () => {
    const body = createByteStream(encodeChunks(
      "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":8,\"cache_read_input_tokens\":2}}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hidden\"}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Working\"}}\n\n",
      "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"read\",\"input\":{}}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\"}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"a.txt\\\"}\"}}\n\n",
      "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":9}}\n\n",
      "data: {\"type\":\"message_stop\"}\n\n",
    ));

    const items = await collect(body, { protocol: "anthropic", wireApi: "chat_completions" });
    const completed = getCompleted(items);

    expect(completed).toMatchObject({
      content: "Working",
      reasoningContent: "hidden",
      finishReason: "tool_use",
      toolCalls: [{ id: "tool_1", name: "read", arguments: "{\"path\":\"a.txt\"}" }],
      usage: { inputTokens: 8, outputTokens: 9, cacheReadInputTokens: 2 },
    });
  });

  it("preserves control-frame-like text from the Anthropic protocol", async () => {
    const content = '{"summary":"done"}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>';
    const body = createByteStream(encodeChunks(
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ));

    const items = await collect(body, { protocol: "anthropic", wireApi: "chat_completions" });

    expect(getCompleted(items).content).toBe(content);
  });

  it("rejects invalid event JSON and cancels the reader", async () => {
    const onCancel = vi.fn();
    const body = createByteStream(encodeChunks("data: {not-json}\n\n"), { keepOpen: true, onCancel });

    await expect(collect(body, { protocol: "openai", wireApi: "chat_completions" }))
      .rejects.toMatchObject({ code: "invalid_event_json" });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("rejects oversized SSE events before parsing them", async () => {
    const body = createByteStream(encodeChunks(`data: ${"x".repeat(80)}\n\n`));

    await expect(collect(body, {
      protocol: "openai",
      wireApi: "chat_completions",
      maxEventBytes: 32,
    })).rejects.toMatchObject({ code: "event_too_large" });
  });

  it("rejects oversized accumulated tool arguments", async () => {
    const body = createByteStream(encodeChunks(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"write\",\"arguments\":\"12345\"}}]}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"67890\"}}]}}]}\n\n",
      "data: [DONE]\n\n",
    ));

    await expect(collect(body, {
      protocol: "openai",
      wireApi: "chat_completions",
      maxToolArgumentBytes: 8,
    })).rejects.toMatchObject({ code: "tool_arguments_too_large" });
  });

  it("rejects an oversized accumulated response across otherwise valid events", async () => {
    const body = createByteStream(encodeChunks(
      "data: {\"choices\":[{\"delta\":{\"content\":\"12345\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"67890\"}}]}\n\n",
      "data: [DONE]\n\n",
    ));

    await expect(collect(body, {
      protocol: "openai",
      wireApi: "chat_completions",
      maxResponseBytes: 8,
    })).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("counts removable provider control frames against the raw response limit", async () => {
    const body = createByteStream(encodeChunks(
      `data: ${JSON.stringify({ choices: [{ delta: {
        content: '{"ok":true}</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
      } }] })}\n\n`,
      "data: [DONE]\n\n",
    ));

    await expect(collect(body, {
      protocol: "openai",
      wireApi: "chat_completions",
      maxResponseBytes: 32,
    })).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("rejects more tool calls than the bounded accumulator allows", async () => {
    const body = createByteStream(encodeChunks(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"one\",\"arguments\":\"{}\"}},{\"index\":1,\"id\":\"call_2\",\"function\":{\"name\":\"two\",\"arguments\":\"{}\"}}]}}]}\n\n",
      "data: [DONE]\n\n",
    ));

    await expect(collect(body, {
      protocol: "openai",
      wireApi: "chat_completions",
      maxToolCalls: 1,
    })).rejects.toMatchObject({ code: "too_many_tool_calls" });
  });

  it("rejects invalid UTF-8 instead of replacing bytes in protocol JSON", async () => {
    const body = createByteStream([
      encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\""),
      new Uint8Array([0xc3, 0x28]),
      encoder.encode("\"}}]}\n\n"),
    ]);

    await expect(collect(body, { protocol: "openai", wireApi: "chat_completions" }))
      .rejects.toMatchObject({ code: "invalid_utf8" });
  });

  it("rejects EOF without a protocol completion marker", async () => {
    const body = createByteStream(encodeChunks(
      "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
    ));

    await expect(collect(body, { protocol: "openai", wireApi: "chat_completions" }))
      .rejects.toMatchObject({ code: "incomplete_stream" });
  });

  it("surfaces provider stream errors without completing", async () => {
    const body = createByteStream(encodeChunks(
      "data: {\"type\":\"response.error\",\"error\":{\"message\":\"upstream failed\"}}\n\n",
    ));

    await expect(collect(body, { protocol: "openai", wireApi: "responses" }))
      .rejects.toMatchObject({ code: "provider_error", message: "upstream failed" });
  });

  it("aborts a pending read, cancels the body and releases its lock", async () => {
    const onCancel = vi.fn();
    const body = createByteStream([], { keepOpen: true, onCancel });
    const controller = new AbortController();
    const pending = collect(body, {
      protocol: "openai",
      wireApi: "chat_completions",
      signal: controller.signal,
    });

    controller.abort("user stopped");

    await expect(pending).rejects.toBeInstanceOf(ModelResponseStreamError);
    await expect(pending).rejects.toMatchObject({ name: "AbortError", code: "aborted" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
});
