import { describe, expect, it } from "vitest";

import { applyOpenAICompatibleToolChoice } from "./openai-tool-choice.js";

describe("OpenAI-compatible tool choice", () => {
  it("requires a Tool and disables DeepSeek thinking", () => {
    const payload: Record<string, unknown> = {
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    };

    applyOpenAICompatibleToolChoice({
      payload,
      profile: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-v4-flash",
      },
      toolChoice: "required",
    });

    expect(payload).toMatchObject({
      tool_choice: "required",
      thinking: { type: "disabled" },
      reasoning_effort: "max",
    });
  });

  it("does not change other providers' thinking when a Tool is required", () => {
    const payload: Record<string, unknown> = { thinking: { type: "enabled" } };

    applyOpenAICompatibleToolChoice({
      payload,
      profile: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-test",
      },
      toolChoice: "required",
    });

    expect(payload).toEqual({
      thinking: { type: "enabled" },
      tool_choice: "required",
    });
  });

  it("keeps ordinary tool-enabled calls on auto", () => {
    const payload: Record<string, unknown> = {};

    applyOpenAICompatibleToolChoice({
      payload,
      profile: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-v4-flash",
      },
      toolChoice: "auto",
    });

    expect(payload).toEqual({ tool_choice: "auto" });
  });
});
