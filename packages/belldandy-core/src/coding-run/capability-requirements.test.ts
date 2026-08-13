import { describe, expect, it } from "vitest";

import { parseCodingRunCapabilityRequirements } from "./capability-requirements.js";

describe("coding run capability requirements", () => {
  it("normalizes and deduplicates a strict v1 declaration", () => {
    expect(parseCodingRunCapabilityRequirements({
      schemaVersion: 1,
      capabilities: ["journal", "trace", "journal"],
      tools: [" file_read ", "file_read"],
      mcpServers: ["repo-index", "repo-index"],
      plugins: ["review-plugin"],
      skills: ["review"],
    })).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        capabilities: ["journal", "trace"],
        tools: ["file_read"],
        mcpServers: ["repo-index"],
        plugins: ["review-plugin"],
        skills: ["review"],
      },
    });
  });

  it("rejects unknown fields, capability names, and content-shaped fields", () => {
    expect(parseCodingRunCapabilityRequirements({ schemaVersion: 1, prompt: "secret" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("prompt"),
    });
    expect(parseCodingRunCapabilityRequirements({
      schemaVersion: 1,
      capabilities: ["futureCapability"],
    })).toMatchObject({ ok: false });
  });

  it("requires exact ids for tool, MCP, plugin, and skill capability categories", () => {
    for (const capability of ["tools", "mcp", "plugin", "skill"] as const) {
      expect(parseCodingRunCapabilityRequirements({
        schemaVersion: 1,
        capabilities: [capability],
      })).toMatchObject({
        ok: false,
        message: expect.stringContaining(capability),
      });
    }
  });

  it("rejects empty, oversized, or invalid identifiers", () => {
    expect(parseCodingRunCapabilityRequirements({ schemaVersion: 1 })).toMatchObject({ ok: false });
    expect(parseCodingRunCapabilityRequirements({
      schemaVersion: 1,
      tools: Array.from({ length: 65 }, (_, index) => `tool-${index}`),
    })).toMatchObject({ ok: false });
    expect(parseCodingRunCapabilityRequirements({
      schemaVersion: 1,
      tools: ["x".repeat(161)],
    })).toMatchObject({ ok: false });
    expect(parseCodingRunCapabilityRequirements({
      schemaVersion: 1,
      tools: ["file_read\ncontent"],
    })).toMatchObject({ ok: false });
  });
});
