import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTool } from "./fetch.js";
import type { ToolContext } from "../types.js";

const baseContext: ToolContext = {
  conversationId: "test-conv",
  workspaceRoot: "/tmp/test",
  policy: {
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: [],
    deniedDomains: ["evil.com", "blocked.org"],
    maxTimeoutMs: 5000,
    maxResponseBytes: 1024,
  },
};

describe("web_fetch tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("security checks", () => {
    it("should block non-http protocols", async () => {
      const result = await fetchTool.execute({ url: "file:///etc/passwd" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("不支持的协议");
    });

    it("should block ftp protocol", async () => {
      const result = await fetchTool.execute({ url: "ftp://example.com/file" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("不支持的协议");
    });

    it("should block localhost", async () => {
      const result = await fetchTool.execute({ url: "http://localhost/admin" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("内网地址");
    });

    it("should block 127.0.0.1", async () => {
      const result = await fetchTool.execute({ url: "http://127.0.0.1:8080/api" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("内网地址");
    });

    it("should block 192.168.x.x", async () => {
      const result = await fetchTool.execute({ url: "http://192.168.1.1/admin" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("内网地址");
    });

    it("should block 10.x.x.x", async () => {
      const result = await fetchTool.execute({ url: "http://10.0.0.1/internal" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("内网地址");
    });

    it("should block 172.16-31.x.x", async () => {
      const result = await fetchTool.execute({ url: "http://172.16.0.1/private" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("内网地址");
    });

    it("should block denied domains", async () => {
      const result = await fetchTool.execute({ url: "https://evil.com/api" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("域名被禁止");
      expect(result.failureKind).toBe("permission_or_policy");
    });

    it("should block subdomains of denied domains", async () => {
      const result = await fetchTool.execute({ url: "https://api.evil.com/data" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("域名被禁止");
    });

    it("should enforce allowedDomains when configured", async () => {
      const restrictedContext: ToolContext = {
        ...baseContext,
        policy: {
          ...baseContext.policy,
          allowedDomains: ["example.com", "trusted.org"],
        },
      };

      const result = await fetchTool.execute(
        { url: "https://untrusted.com/api" },
        restrictedContext
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("不在白名单中");
    });

    it("should allow ENOTFOUND DNS failures to fall through to fetch", async () => {
      const dnsError = Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), {
        code: "ENOTFOUND",
      });
      vi.spyOn(dns, "lookup").mockRejectedValue(dnsError);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      );

      const result = await fetchTool.execute({ url: "https://example.com/api" }, baseContext);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it("should block timed out DNS lookups before fetch", async () => {
      const dnsError = Object.assign(new Error("dns lookup timeout"), {
        code: "ETIMEOUT",
      });
      vi.spyOn(dns, "lookup").mockRejectedValue(dnsError);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("should-not-run", {
          status: 200,
        })
      );

      const result = await fetchTool.execute({ url: "https://example.com/api" }, baseContext);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("DNS");
      expect(result.failureKind).toBe("permission_or_policy");
    });
  });

  describe("input validation", () => {
    it("should reject empty url", async () => {
      const result = await fetchTool.execute({ url: "" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("非空字符串");
    });

    it("should reject invalid url", async () => {
      const result = await fetchTool.execute({ url: "not-a-valid-url" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain("无效的 URL");
      expect(result.failureKind).toBe("input_error");
    });

    it("should reject missing url", async () => {
      const result = await fetchTool.execute({}, baseContext);
      expect(result.success).toBe(false);
    });
  });

  describe("tool definition", () => {
    it("should have correct name and description", () => {
      expect(fetchTool.definition.name).toBe("web_fetch");
      expect(fetchTool.definition.description).toContain("HTTP");
    });

    it("should require url parameter", () => {
      expect(fetchTool.definition.parameters.required).toContain("url");
    });

    it("should support GET and POST methods", () => {
      const methodParam = fetchTool.definition.parameters.properties.method;
      expect(methodParam.enum).toContain("GET");
      expect(methodParam.enum).toContain("POST");
    });
  });

  describe("abort handling", () => {
    it("should stop an in-flight fetch when abortSignal is aborted", async () => {
      vi.spyOn(dns, "lookup").mockResolvedValue({
        address: "93.184.216.34",
        family: 4,
      } as Awaited<ReturnType<typeof dns.lookup>>);
      const controller = new AbortController();
      let markFetchStarted!: () => void;
      const fetchStarted = new Promise<void>((resolve) => {
        markFetchStarted = resolve;
      });
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        markFetchStarted();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal?.aborted) {
            const error = new Error("Stopped by user.");
            error.name = "AbortError";
            reject(error);
            return;
          }
          signal?.addEventListener("abort", () => {
            const error = new Error("Stopped by user.");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      });

      const resultPromise = fetchTool.execute({ url: "https://example.com/api" }, {
        ...baseContext,
        abortSignal: controller.signal,
      });

      await fetchStarted;
      controller.abort("Stopped by user.");
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Stopped by user.");
      expect(result.failureKind).toBe("environment_error");
    });
  });
});
