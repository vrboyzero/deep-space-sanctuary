import { describe, expect, it } from "vitest";

const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim();

describe("deepseek real cache probe", () => {
  it.skipIf(!deepSeekApiKey)("measures repeated-prefix cache and reasoning-history amplification on the live provider", async () => {
    const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
    const bigHead = "You are a coding agent. Keep the prefix stable across turns. ".repeat(60);

    const send = async (messages: Array<Record<string, unknown>>) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${deepSeekApiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 16,
          messages,
        }),
      });
      expect(response.ok).toBe(true);
      return response.json();
    };

    const baseMessages = [
      { role: "system", content: bigHead },
      { role: "user", content: "Reply with the single word: ok." },
    ];

    const cold = await send(baseMessages);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const warm = await send(baseMessages);

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
      { role: "tool", tool_call_id: "call_1", content: "model = deepseek-v4-flash" },
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

    await send(withReasoning);
    await send(withoutReasoning);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const withReasoningMeasured = await send(withReasoning);
    const withoutReasoningMeasured = await send(withoutReasoning);

    const readUsage = (payload: any) => {
      const usage = payload?.usage ?? {};
      return {
        prompt: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
        hit: Number(usage.prompt_cache_hit_tokens ?? 0),
        miss: Number(usage.prompt_cache_miss_tokens ?? 0),
      };
    };

    const coldUsage = readUsage(cold);
    const warmUsage = readUsage(warm);
    const withReasoningUsage = readUsage(withReasoningMeasured);
    const withoutReasoningUsage = readUsage(withoutReasoningMeasured);

    expect(warmUsage.prompt).toBeGreaterThan(0);
    expect(withReasoningUsage.prompt).toBeGreaterThan(0);
    expect(withoutReasoningUsage.prompt).toBeGreaterThan(0);

    console.log("DeepSeek real cache probe", {
      model,
      repeatedPrefix: {
        cold: coldUsage,
        warm: warmUsage,
      },
      reasoningRoundTrip: {
        withReasoning: withReasoningUsage,
        withoutReasoning: withoutReasoningUsage,
        promptDelta: withReasoningUsage.prompt - withoutReasoningUsage.prompt,
      },
    });
  }, 120000);
});
