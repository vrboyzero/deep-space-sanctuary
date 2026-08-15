import { describe, expect, it } from "vitest";

import { buildAnthropicRequest, convertMessagesToAnthropic } from "./anthropic.js";
import type { ProviderNativeSystemBlock } from "./system-prompt.js";

describe("anthropic provider-native system blocks", () => {
  const providerNativeSystemBlocks: ProviderNativeSystemBlock[] = [
    {
      id: "provider-native-static-persona",
      blockType: "static-persona",
      text: "# Persona",
      sourceSectionIds: ["core", "workspace-soul"],
      sourceDeltaIds: [],
      cacheControlEligible: true,
    },
    {
      id: "provider-native-static-capability",
      blockType: "static-capability",
      text: "# Capability",
      sourceSectionIds: ["methodology"],
      sourceDeltaIds: [],
      cacheControlEligible: true,
    },
    {
      id: "provider-native-dynamic-runtime",
      blockType: "dynamic-runtime",
      text: "## Runtime Identity",
      sourceSectionIds: [],
      sourceDeltaIds: ["runtime-identity"],
      cacheControlEligible: false,
    },
  ];

  it("prefers provider-native system blocks over legacy system messages", () => {
    const converted = convertMessagesToAnthropic(
      [
        { role: "system", content: "legacy system prompt" },
        { role: "user", content: "hello" },
      ],
      {
        cacheSystemPrompt: true,
        providerNativeSystemBlocks,
      },
    );

    expect(converted.system).toEqual([
      { type: "text", text: "# Persona", cache_control: { type: "ephemeral" } },
      { type: "text", text: "# Capability", cache_control: { type: "ephemeral" } },
      { type: "text", text: "## Runtime Identity" },
    ]);
    expect(converted.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("serializes provider-native system blocks into the request payload", () => {
    const request = buildAnthropicRequest({
      profile: {
        baseUrl: "https://api.anthropic.com",
        apiKey: "test-key",
        model: "claude-test",
      },
      messages: [
        { role: "system", content: "legacy system prompt" },
        { role: "user", content: "hello" },
      ],
      maxTokens: 512,
      enableCaching: true,
      providerNativeSystemBlocks,
    });

    const payload = JSON.parse(String(request.init.body));
    expect(payload.system).toEqual([
      { type: "text", text: "# Persona", cache_control: { type: "ephemeral" } },
      { type: "text", text: "# Capability", cache_control: { type: "ephemeral" } },
      { type: "text", text: "## Runtime Identity" },
    ]);
    expect(payload.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("maps a required tool choice to Anthropic any semantics", () => {
    const request = buildAnthropicRequest({
      profile: {
        baseUrl: "https://api.anthropic.com",
        apiKey: "test-key",
        model: "claude-test",
      },
      messages: [{ role: "user", content: "change the file" }],
      tools: [{
        type: "function",
        function: {
          name: "apply_patch",
          description: "Apply one patch",
          parameters: { type: "object", properties: {} },
        },
      }],
      toolChoice: "required",
    });

    const payload = JSON.parse(String(request.init.body));
    expect(payload.tool_choice).toEqual({ type: "any" });
  });
});
