import { describe, expect, it } from "vitest";

import {
  EXTENSION_RUNTIME_PROTOCOL_VERSION,
  parseExtensionRuntimeHostResponseLine,
  parseExtensionRuntimeRequestLine,
} from "./extension-runtime-contract.js";

describe("extension runtime contract", () => {
  it("parses a versioned activation request", () => {
    expect(parseExtensionRuntimeRequestLine(JSON.stringify({
      version: EXTENSION_RUNTIME_PROTOCOL_VERSION,
      type: "activate",
      id: "activate-1",
      pluginModuleRelativePath: "dist/plugin.mjs",
    }))).toEqual({
      version: 1,
      type: "activate",
      id: "activate-1",
      pluginModuleRelativePath: "dist/plugin.mjs",
    });
  });

  it("rejects unknown, oversized, and mismatched response frames", () => {
    expect(() => parseExtensionRuntimeRequestLine(JSON.stringify({
      version: 1,
      type: "unknown",
      id: "request-1",
    }))).toThrow(/unsupported.*request type/i);
    expect(() => parseExtensionRuntimeRequestLine("x".repeat(1024 * 1024 + 1))).toThrow(/size limit/i);
    expect(() => parseExtensionRuntimeHostResponseLine(JSON.stringify({
      version: 99,
      type: "result",
      id: "response-1",
      ok: true,
      result: {},
    }))).toThrow(/protocol version/i);
  });
});
