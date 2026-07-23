import { describe, expect, it } from "vitest";
import type { Tool, ToolCallResult } from "./types.js";
import { withToolContract } from "./tool-contract.js";
import { applyToolResultOutputAdmission } from "./tool-execution-admission.js";

function createAdmittedTextTool(): Tool {
  return withToolContract({
    definition: {
      name: "network_read_fixture",
      description: "network read admission fixture",
      parameters: { type: "object", properties: {} },
    },
    async execute(): Promise<ToolCallResult> {
      return {
        id: "fixture",
        name: "network_read_fixture",
        success: true,
        output: "",
        durationMs: 0,
      };
    },
  }, {
    family: "network-read",
    isReadOnly: true,
    isConcurrencySafe: true,
    needsPermission: false,
    riskLevel: "low",
    channels: ["gateway"],
    safeScopes: ["remote-safe"],
    activityDescription: "Read a remote resource",
    resultSchema: { kind: "text", description: "plain text" },
    outputPersistencePolicy: "conversation",
    executionAdmission: {
      deadline: "policy",
      output: "utf8-text-policy",
    },
  });
}

describe("tool execution admission", () => {
  it("truncates opted-in text output at a UTF-8 boundary and records only size metadata", () => {
    const tool = createAdmittedTextTool();
    const result = applyToolResultOutputAdmission(tool, {
      id: "fixture",
      name: "network_read_fixture",
      success: true,
      output: "猫咪abc",
      durationMs: 0,
    }, {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 5_000,
      maxResponseBytes: 4,
    });

    expect(result).toMatchObject({
      success: true,
      output: "猫",
      metadata: {
        outputTruncated: true,
        outputBytes: 3,
        outputOriginalBytes: 9,
        outputLimitBytes: 4,
      },
    });
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(4);
  });
});
