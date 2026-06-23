import { describe, expect, it } from "vitest";

/**
 * DeepSeek live cache probe（env-gated）
 *
 * 触发条件：设置 DEEPSEEK_API_KEY 后运行
 *   DEEPSEEK_API_KEY=sk-xxx node node_modules/vitest/vitest.mjs run \
 *     packages/belldandy-agent/src/deepseek-realcache.probe.test.ts --reporter verbose
 *
 * 无 key 时 it.skipIf 会自动跳过，不是失败。
 *
 * 本探针覆盖 Phase 0 需要的四类 live 证据：
 * 1. repeated-prefix cache hit/miss（cold vs warm）
 * 2. reasoning_content round-trip 对 prompt tokens 的抬升
 * 3. tool_calls turn 缺 reasoning_content 的兼容性（是否 400）
 * 4. tool_calls 历史 + 缓存交互（带 tool_calls 的历史是否冲击 cache hit）
 */

const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim();

type ProbeUsage = {
  prompt: number;
  completion: number;
  hit: number;
  miss: number;
  cacheCreation: number;
  cacheRead: number;
};

type ProbeResponse = {
  ok: boolean;
  status: number;
  body: any;
  usage: ProbeUsage;
};

describe("deepseek real cache probe", () => {
  it.skipIf(!deepSeekApiKey)(
    "measures repeated-prefix cache, reasoning-history amplification, tool_calls compatibility and tool_calls cache impact",
    async () => {
      const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
      const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
      // 构造一个足够长的稳定前缀，模拟真实 system prompt 体积
      const bigHead = "You are a coding agent. Keep the prefix stable across turns. ".repeat(60);

      const send = async (messages: Array<Record<string, unknown>>, opts?: { maxTokens?: number }): Promise<ProbeResponse> => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deepSeekApiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: opts?.maxTokens ?? 16,
            messages,
          }),
        });
        const body = await response.json().catch(() => ({}));
        const usage = body?.usage ?? {};
        return {
          ok: response.ok,
          status: response.status,
          body,
          usage: {
            prompt: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
            completion: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
            hit: Number(usage.prompt_cache_hit_tokens ?? 0),
            miss: Number(usage.prompt_cache_miss_tokens ?? 0),
            cacheCreation: Number(usage.cache_creation_input_tokens ?? 0),
            cacheRead: Number(usage.cache_read_input_tokens ?? 0),
          },
        };
      };

      // ===== 探针 1：repeated-prefix cache hit/miss =====
      const baseMessages = [
        { role: "system", content: bigHead },
        { role: "user", content: "Reply with the single word: ok." },
      ];

      const cold = await send(baseMessages);
      expect(cold.ok).toBe(true);
      // 等待 cache 写入完成
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const warm = await send(baseMessages);
      expect(warm.ok).toBe(true);

      // ===== 探针 2：reasoning_content round-trip =====
      const withReasoning = [
        { role: "system", content: bigHead },
        { role: "user", content: "Read the config and tell me the model." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{\"path\":\"config.toml\"}",
            },
          }],
          reasoning_content: "Let me think carefully about each requirement and weigh the trade-offs. ".repeat(40),
        },
        { role: "tool", tool_call_id: "call_1", content: "model = deepseek-chat" },
        { role: "user", content: "Thanks. Now reply with the single word: ok." },
      ];
      const withoutReasoning = withReasoning.map((message, index) => (
        index === 2
          ? {
            role: message.role,
            content: message.content,
            tool_calls: message.tool_calls,
          }
          : message
      ));

      // 先各跑一次让 cache 写入
      const withReasoningPrime = await send(withReasoning);
      const withoutReasoningPrime = await send(withoutReasoning);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // 再各跑一次测量
      const withReasoningMeasured = await send(withReasoning);
      const withoutReasoningMeasured = await send(withoutReasoning);

      // ===== 探针 3：tool_calls 缺 reasoning_content 的兼容性 =====
      // 直接发送一个 tool_calls turn 没有 reasoning_content 的请求
      // 如果 API 报 400，说明该模型要求 tool_calls turn 必须带 reasoning_content
      const toolCallsNoReasoning = [
        { role: "system", content: bigHead },
        { role: "user", content: "Read the config." },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_compat_1",
            type: "function",
            function: {
              name: "read_file",
              arguments: "{\"path\":\"config.toml\"}",
            },
          }],
          // 故意不带 reasoning_content
        },
        { role: "tool", tool_call_id: "call_compat_1", content: "ok" },
        { role: "user", content: "Reply with the single word: ok." },
      ];
      const toolCallsCompat = await send(toolCallsNoReasoning);

      // ===== 探针 4：tool_calls 历史对 cache 的影响 =====
      // 重复发送带 tool_calls 历史的请求，看 cache hit 是否稳定
      await send(withReasoning);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const toolCallsCacheRepeat = await send(withReasoning);

      // ===== 汇总输出 =====
      const summary = {
        model,
        baseUrl,
        timestamp: new Date().toISOString(),
        repeatedPrefix: {
          cold: cold.usage,
          warm: warm.usage,
          cacheHitDelta: warm.usage.hit - cold.usage.hit,
          promptTokenDelta: warm.usage.prompt - cold.usage.prompt,
        },
        reasoningRoundTrip: {
          withReasoning: withReasoningMeasured.usage,
          withoutReasoning: withoutReasoningMeasured.usage,
          promptDelta: withReasoningMeasured.usage.prompt - withoutReasoningMeasured.usage.prompt,
          cacheHitDelta: withReasoningMeasured.usage.hit - withoutReasoningMeasured.usage.hit,
        },
        toolCallsCompatibility: {
          ok: toolCallsCompat.ok,
          status: toolCallsCompat.status,
          // 如果 ok=false 且 status=400，说明该模型要求 tool_calls turn 必须带 reasoning_content
          requiresReasoningOnToolCalls: !toolCallsCompat.ok && toolCallsCompat.status === 400,
          usage: toolCallsCompat.usage,
          errorBody: !toolCallsCompat.ok ? JSON.stringify(toolCallsCompat.body?.error ?? toolCallsCompat.body).slice(0, 500) : undefined,
        },
        toolCallsCacheImpact: {
          first: withReasoningPrime.usage,
          repeat: toolCallsCacheRepeat.usage,
          cacheHitStable: toolCallsCacheRepeat.usage.hit > 0,
        },
      };

      // 基础断言：确保请求成功
      expect(warm.usage.prompt).toBeGreaterThan(0);
      expect(withReasoningMeasured.usage.prompt).toBeGreaterThan(0);
      expect(withoutReasoningMeasured.usage.prompt).toBeGreaterThan(0);

      // 输出完整探针结果，供 Phase 0 证据收集
      console.log("=== DeepSeek real cache probe result ===");
      console.log(JSON.stringify(summary, null, 2));
      console.log("=== probe end ===");
    },
    180000,
  );
});
