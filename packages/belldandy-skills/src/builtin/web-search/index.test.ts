import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";
import { webSearchTool } from "./index.js";

describe("web_search tool", () => {
  const context: ToolContext = {
    conversationId: "conv-web-search",
    workspaceRoot: "/tmp/test",
    policy: {
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      deniedDomains: [],
      maxTimeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    },
  };

  beforeEach(() => {
    process.env.BRAVE_API_KEY = "brave-test-key";
    delete process.env.SERPAPI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.BRAVE_API_KEY;
    delete process.env.SERPAPI_API_KEY;
  });

  it("preserves the reason for a search aborted before provider transport", async () => {
    const legacyFetch = vi.fn();
    vi.stubGlobal("fetch", legacyFetch);
    const controller = new AbortController();
    controller.abort("Stopped by user.");

    const result = await webSearchTool.execute({
      query: "belldandy tools",
    }, {
      ...context,
      abortSignal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Stopped by user.");
    expect(result.failureKind).toBe("environment_error");
    expect(legacyFetch).not.toHaveBeenCalled();
  });

  it("classifies missing query as input_error", async () => {
    const result = await webSearchTool.execute({
      query: "",
    }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("query 必须是非空字符串");
    expect(result.failureKind).toBe("input_error");
  });
});
