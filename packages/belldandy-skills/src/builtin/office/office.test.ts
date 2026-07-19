import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import crypto from "node:crypto";
import {
  OutboundRequestPolicy,
  type OutboundDnsLookup,
  type OutboundRequestAdapter,
} from "@belldandy/protocol";
import type { ToolContext } from "../../types.js";
import {
  __setOfficeSiteClientDependenciesForTests,
  OfficeSiteClient,
  normalizeWorkshopCategory,
} from "./client.js";
import { createOfficeWorkshopDownloadTool } from "./workshop.js";
import {
  officeWorkshopSearchTool,
  officeWorkshopDownloadTool,
  officeWorkshopPublishTool,
  officeWorkshopMineTool,
  officeWorkshopUpdateTool,
  officeWorkshopDeleteTool,
  officeHomesteadGetTool,
  officeHomesteadPlaceTool,
  officeHomesteadMountTool,
  officeHomesteadUnmountTool,
  officeHomesteadOpenBlindBoxTool,
  officeForumListBoardsTool,
  officeForumSearchThreadsTool,
  officeForumGetThreadTool,
  officeForumCollectBugsTool,
  officeForumCollectFeedbackTool,
} from "./index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createPublishFixtureForm(): FormData {
  const form = new FormData();
  form.append("title", "fixture title");
  form.append("category", "skills");
  form.append("file", new Blob(["fixture body"]), "fixture.txt");
  return form;
}

function createDownloadTool(
  requestAdapter: OutboundRequestAdapter,
  dnsLookup: OutboundDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }],
) {
  return createOfficeWorkshopDownloadTool({
    createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
      ...options,
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      requestAdapter: async (input) => await fetch(input.url.toString(), {
        method: input.init.method,
        headers: input.init.headers,
        signal: input.init.signal,
      }),
    }),
    createDownloadOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
      ...options,
      dnsLookup,
      requestAdapter,
    }),
  });
}

describe("office tools", () => {
  let tempDir: string;
  let stateDir: string;
  let context: ToolContext;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalStateDir: string | undefined;
  let originalMaxDownloadBytes: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-office-test-"));
    stateDir = path.join(tempDir, ".belldandy-state");
    await fs.mkdir(stateDir, { recursive: true });

    originalStateDir = process.env.BELLDANDY_STATE_DIR;
    originalMaxDownloadBytes = process.env.BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES;
    process.env.BELLDANDY_STATE_DIR = stateDir;
    delete process.env.BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES;

    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://office.test",
        agents: [
          {
            name: "贝露丹蒂",
            apiKey: "gro_test_key",
          },
        ],
      }, null, 2),
      "utf-8",
    );

    context = {
      conversationId: "test-conv",
      workspaceRoot: tempDir,
      policy: {
        allowedPaths: [],
        deniedPaths: [".git", "node_modules", ".env"],
        allowedDomains: [],
        deniedDomains: [],
        maxTimeoutMs: 5000,
        maxResponseBytes: 1024 * 1024,
      },
    };

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    __setOfficeSiteClientDependenciesForTests({
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async (input) => await fetchMock(input.url.toString(), {
          method: input.init.method,
          headers: input.init.headers,
          signal: input.init.signal,
        }),
      }),
      createJsonMutationOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async (input) => await fetchMock(input.url.toString(), {
          method: input.init.method,
          headers: input.init.headers,
          body: input.init.body,
          signal: input.init.signal,
        }),
      }),
      createFormPublishOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async (input) => await fetchMock(input.url.toString(), {
          method: input.init.method,
          headers: input.init.headers,
          body: input.init.body,
          signal: input.init.signal,
        }),
      }),
    });
  });

  afterEach(async () => {
    __setOfficeSiteClientDependenciesForTests(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalStateDir === undefined) {
      delete process.env.BELLDANDY_STATE_DIR;
    } else {
      process.env.BELLDANDY_STATE_DIR = originalStateDir;
    }
    if (originalMaxDownloadBytes === undefined) {
      delete process.env.BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES;
    } else {
      process.env.BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES = originalMaxDownloadBytes;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should normalize workshop category aliases", () => {
    expect(normalizeWorkshopCategory("技能")).toBe("skills");
    expect(normalizeWorkshopCategory("方法论")).toBe("methods");
    expect(normalizeWorkshopCategory("模组")).toBe("plugins");
    expect(normalizeWorkshopCategory("apps")).toBe("apps");
  });

  it("should search workshop with normalized category and auth headers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{ id: "item-1", title: "测试技能" }],
      total: 1,
      page: 1,
      limit: 5,
    }));

    const result = await officeWorkshopSearchTool.execute(
      { agent_name: "贝露丹蒂", category: "技能", limit: 5 },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      success: true,
      total: 1,
      page: 1,
      limit: 5,
      items: [{ id: "item-1", title: "测试技能" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/workshop/items?category=skills&limit=5");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("gro_test_key");
    expect((init.headers as Record<string, string>)["X-Agent-ID"]).toBe(encodeURIComponent("贝露丹蒂"));
  });

  it("should abort an in-flight office request when abortSignal is triggered", async () => {
    fetchMock.mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    const controller = new AbortController();

    const resultPromise = officeWorkshopSearchTool.execute(
      { agent_name: "贝露丹蒂", category: "技能", limit: 5 },
      {
        ...context,
        abortSignal: controller.signal,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    controller.abort("Stopped by user.");
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Stopped by user.");
  });

  it("should resolve default Belldandy alias to 贝露丹蒂 config", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{ id: "item-1", title: "测试技能" }],
      total: 1,
      page: 1,
      limit: 5,
    }));

    const result = await officeWorkshopSearchTool.execute(
      { agent_name: "Belldandy", category: "技能", limit: 5 },
      context,
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("gro_test_key");
    expect((init.headers as Record<string, string>)["X-Agent-ID"]).toBe(encodeURIComponent("贝露丹蒂"));
  });

  it("should reject a private office GET endpoint before any transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://office.private.test",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const transport = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
        requestAdapter: transport,
      }),
    });

    await expect(client.getJson("/api/workshop/items")).rejects.toThrow(/private|reserved/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("should reject an insecure office GET endpoint before any transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "http://office.test",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const transport = vi.fn(async () => jsonResponse({ items: [] }));
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    await expect(client.getJson("/api/workshop/items")).rejects.toThrow(/HTTP.*opt-in/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("should not follow office GET redirects or replay the API key", async () => {
    const transport = vi.fn(async (_input: Parameters<OutboundRequestAdapter>[0]) => new Response(null, {
      status: 307,
      headers: { location: "https://office.test/second-hop" },
    }));
    const controller = new AbortController();
    const client = new OfficeSiteClient("贝露丹蒂", controller.signal, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    await expect(client.getJson("/api/workshop/items?limit=5")).rejects.toThrow(/redirect limit exceeded/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://office.test/api/workshop/items?limit=5"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "GET",
        headers: {
          "X-API-Key": "gro_test_key",
          "X-Agent-ID": encodeURIComponent("贝露丹蒂"),
          "Accept-Encoding": "identity",
        },
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });
  });

  it("should cancel an office GET response whose declared JSON length exceeds 1 MiB", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"items":[]}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.getJson("/api/workshop/items")).rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should cancel an office GET response that exceeds the cumulative 1 MiB limit", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel: cancelBody,
    }));
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.getJson("/api/workshop/items")).rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should cancel an oversized non-success office GET error body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"must not surface"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      status: 400,
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.getJson("/api/workshop/items")).rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should preserve the status error for a non-success office GET response without a body", async () => {
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createGetJsonOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => new Response(null, { status: 404 }),
      }),
    });

    await expect(client.getJson("/api/workshop/items/missing")).rejects.toThrow("请求失败 (404)");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should reject a private office JSON mutation endpoint before any transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://127.0.0.1",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "must not mutate" }));
    const client = new OfficeSiteClient("贝露丹蒂");

    await expect(client.postJson("/api/town-square/place", { inventoryId: 1 }))
      .rejects.toThrow(/private|reserved/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should apply the office JSON mutation policy to PUT before any private transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://127.0.0.1",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "must not update" }));
    const client = new OfficeSiteClient("贝露丹蒂");

    await expect(client.putJson("/api/workshop/items/item-1", { title: "blocked" }))
      .rejects.toThrow(/private|reserved/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should apply the office JSON mutation policy to DELETE before any private transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://127.0.0.1",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "must not delete" }));
    const client = new OfficeSiteClient("贝露丹蒂");

    await expect(client.deleteJson("/api/workshop/items/item-1"))
      .rejects.toThrow(/private|reserved/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should reject an insecure office JSON mutation endpoint before any transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "http://office.test",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "must not mutate" }));
    const client = new OfficeSiteClient("贝露丹蒂");

    await expect(client.postJson("/api/town-square/place", { inventoryId: 1 }))
      .rejects.toThrow(/HTTP.*opt-in/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should not follow office JSON mutation redirects or replay the API key and body", async () => {
    const transport = vi.fn(async (_input: Parameters<OutboundRequestAdapter>[0]) => new Response(null, {
      status: 307,
      headers: { location: "https://office.test/second-hop" },
    }));
    const controller = new AbortController();
    const client = new OfficeSiteClient("贝露丹蒂", controller.signal, {
      createJsonMutationOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });
    const body = { inventoryId: 1, x: 2, y: 3 };

    await expect(client.postJson("/api/town-square/place", body))
      .rejects.toThrow(/redirect limit exceeded/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://office.test/api/town-square/place"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        headers: {
          "X-API-Key": "gro_test_key",
          "X-Agent-ID": encodeURIComponent("贝露丹蒂"),
          "Content-Type": "application/json",
          "Accept-Encoding": "identity",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });
  });

  it("should cancel an office JSON mutation response whose declared length exceeds 1 MiB", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":"must not resolve"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createJsonMutationOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.postJson("/api/town-square/place", { inventoryId: 1 }))
      .rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should cancel an oversized non-success office JSON mutation error body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"must not surface"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      status: 400,
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createJsonMutationOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.postJson("/api/town-square/place", { inventoryId: 1 }))
      .rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should abort an in-flight office JSON mutation with the caller reason", async () => {
    let markTransportStarted!: () => void;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    const transport = vi.fn(async (input: Parameters<OutboundRequestAdapter>[0]) => await new Promise<Response>(
      (_resolve, reject) => {
        markTransportStarted();
        const rejectAbort = () => reject(new Error("mutation adapter aborted"));
        if (input.init.signal?.aborted) {
          rejectAbort();
          return;
        }
        input.init.signal?.addEventListener("abort", rejectAbort, { once: true });
      },
    ));
    const controller = new AbortController();
    const client = new OfficeSiteClient("贝露丹蒂", controller.signal, {
      createJsonMutationOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    const resultPromise = client.postJson("/api/town-square/place", { inventoryId: 1 });
    await transportStarted;
    controller.abort("Stop office mutation.");

    await expect(resultPromise).rejects.toThrow("Stop office mutation.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("should reject a private office download endpoint before transport or file commit", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://office.private.test",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-private",
      title: "私网下载测试",
      fileName: "private.txt",
      fileHash: null,
    }));
    const transport = vi.fn(async () => new Response("must not download"));
    const tool = createDownloadTool(
      transport,
      async () => [{ address: "127.0.0.1", family: 4 }],
    );

    const result = await tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-private", target_dir: "downloads", overwrite: true },
      context,
    );

    expect(result.success).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.access(path.join(tempDir, "downloads", "private.txt"))).rejects.toThrow();
  });

  it("should reject an insecure office download endpoint before download transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "http://office.test",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-http",
      title: "明文下载测试",
      fileName: "insecure.txt",
      fileHash: null,
    }));
    const transport = vi.fn(async () => new Response("must not download"));
    const tool = createDownloadTool(transport);

    const result = await tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-http", target_dir: "downloads", overwrite: true },
      context,
    );

    expect(result.success).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.access(path.join(tempDir, "downloads", "insecure.txt"))).rejects.toThrow();
  });

  it("should not follow office download redirects or replay the API key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-redirect",
      title: "重定向下载测试",
      fileName: "redirect.txt",
      fileHash: null,
    }));
    const transport = vi.fn(async (_input: Parameters<OutboundRequestAdapter>[0]) => new Response(null, {
      status: 307,
      headers: { location: "https://office.test/second-hop" },
    }));
    const tool = createDownloadTool(transport);
    const controller = new AbortController();

    const result = await tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-redirect", target_dir: "downloads", overwrite: true },
      { ...context, abortSignal: controller.signal },
    );

    expect(result.success).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://office.test/api/workshop/items/item-redirect/download"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "GET",
        headers: {
          "X-API-Key": "gro_test_key",
          "X-Agent-ID": encodeURIComponent("贝露丹蒂"),
          "Accept-Encoding": "identity",
        },
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fs.access(path.join(tempDir, "downloads", "redirect.txt"))).rejects.toThrow();
  });

  it("should download workshop file into target directory", async () => {
    const content = Buffer.from("hello office");
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-1",
      title: "下载测试",
      fileName: "demo.txt",
      fileHash: expectedHash,
    }));
    const transport = vi.fn(async (_input: Parameters<OutboundRequestAdapter>[0]) => new Response(content, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    }));
    const tool = createDownloadTool(transport);
    const controller = new AbortController();

    const result = await tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-1", target_dir: "downloads", overwrite: true },
      { ...context, abortSignal: controller.signal },
    );

    expect(result.success).toBe(true);
    const output = JSON.parse(result.output);
    expect(output.hashMatched).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      url: new URL("https://office.test/api/workshop/items/item-1/download"),
      init: {
        method: "GET",
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });

    const saved = await fs.readFile(path.join(tempDir, "downloads", "demo.txt"), "utf-8");
    expect(saved).toBe("hello office");
  });

  it("should abort an in-flight office download without committing a file", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-abort",
      title: "取消下载测试",
      fileName: "aborted.txt",
      fileHash: null,
    }));
    let markTransportStarted!: () => void;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    const transport = vi.fn(async (input: Parameters<OutboundRequestAdapter>[0]) => await new Promise<Response>(
      (_resolve, reject) => {
        markTransportStarted();
        const rejectAbort = () => reject(new Error("download adapter aborted"));
        if (input.init.signal?.aborted) {
          rejectAbort();
          return;
        }
        input.init.signal?.addEventListener("abort", rejectAbort, { once: true });
      },
    ));
    const tool = createDownloadTool(transport);
    const controller = new AbortController();

    const resultPromise = tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-abort", target_dir: "downloads", overwrite: true },
      { ...context, abortSignal: controller.signal },
    );
    await transportStarted;
    controller.abort("Stop office download.");
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Stop office download.");
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(fs.access(path.join(tempDir, "downloads", "aborted.txt"))).rejects.toThrow();
  });

  it("should use configured office downloadDir when target_dir is omitted", async () => {
    const content = Buffer.from("configured download dir");
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://office.test",
        agents: [
          {
            name: "贝露丹蒂",
            apiKey: "gro_test_key",
            office: {
              downloadDir: "agent-downloads",
            },
          },
        ],
      }, null, 2),
      "utf-8",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-2",
      title: "默认下载目录测试",
      fileName: "configured.txt",
      fileHash: null,
    }));
    const tool = createDownloadTool(async () => new Response(content, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    }));

    const result = await tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-2", overwrite: true },
      context,
    );

    expect(result.success).toBe(true);
    const saved = await fs.readFile(path.join(tempDir, "agent-downloads", "configured.txt"), "utf-8");
    expect(saved).toBe("configured download dir");
  });

  it("should preserve an existing workshop file when a chunked download exceeds its limit", async () => {
    process.env.BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES = "8";
    const downloadDir = path.join(tempDir, "downloads");
    const targetPath = path.join(downloadDir, "stable.txt");
    await fs.mkdir(downloadDir, { recursive: true });
    await fs.writeFile(targetPath, "stable", "utf-8");
    let chunkIndex = 0;
    const chunks = [Buffer.from("1234"), Buffer.from("56789")];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[chunkIndex];
        chunkIndex += 1;
        if (chunk) {
          controller.enqueue(chunk);
          return;
        }
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: "item-limit",
      title: "限额测试",
      fileName: "stable.txt",
      fileHash: null,
    }));
    const tool = createDownloadTool(async () => new Response(body, { status: 200 }));

    const result = await tool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-limit", target_dir: "downloads", overwrite: true },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("8 byte limit");
    await expect(fs.readFile(targetPath, "utf-8")).resolves.toBe("stable");
    await expect(fs.readdir(downloadDir)).resolves.toEqual(["stable.txt"]);
  });

  it.each(["../escape.txt", "safe.txt:stream"])(
    "should reject unsafe workshop download file name %s",
    async (fileName) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        id: "item-unsafe-name",
        title: "文件名测试",
        fileName,
        fileHash: null,
      }));

      const result = await officeWorkshopDownloadTool.execute(
        { agent_name: "贝露丹蒂", item_id: "item-unsafe-name", target_dir: "downloads", overwrite: true },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("文件名无效");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(fs.access(path.join(tempDir, "escape.txt"))).rejects.toThrow();
    },
  );

  it("should reject a private office FormData publish endpoint before any transport", async () => {
    const sampleFile = path.join(tempDir, "private-publish.yml");
    await fs.writeFile(sampleFile, "name: must-not-publish", "utf-8");
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://127.0.0.1",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "must-not-exist" }, 201));

    const result = await officeWorkshopPublishTool.execute(
      {
        agent_name: "贝露丹蒂",
        category: "skills",
        title: "私网发布",
        summary: "summary",
        description: "description",
        file_path: sampleFile,
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private|reserved/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should reject an insecure office FormData publish endpoint before any transport", async () => {
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "http://office.test",
        agents: [{ name: "贝露丹蒂", apiKey: "gro_test_key" }],
      }, null, 2),
      "utf-8",
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "must-not-exist" }, 201));
    const client = new OfficeSiteClient("贝露丹蒂");

    await expect(client.postForm("/api/workshop/items", createPublishFixtureForm()))
      .rejects.toThrow(/HTTP.*opt-in/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should not follow office FormData publish redirects or replay credentials and body", async () => {
    const transport = vi.fn(async (_input: Parameters<OutboundRequestAdapter>[0]) => new Response(null, {
      status: 307,
      headers: { location: "https://office.test/second-hop" },
    }));
    const controller = new AbortController();
    const client = new OfficeSiteClient("贝露丹蒂", controller.signal, {
      createFormPublishOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    await expect(client.postForm("/api/workshop/items", createPublishFixtureForm()))
      .rejects.toThrow(/redirect limit exceeded/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: new URL("https://office.test/api/workshop/items"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });
    expect(request?.init.headers?.["X-API-Key"]).toBe("gro_test_key");
    expect(request?.init.body).toBeInstanceOf(Uint8Array);
  });

  it("should cancel a FormData publish success response whose declared length exceeds 1 MiB", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":"must-not-resolve"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createFormPublishOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.postForm("/api/workshop/items", createPublishFixtureForm()))
      .rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should cancel an oversized non-success FormData publish error body", async () => {
    const cancelBody = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"must not surface"}'));
        controller.close();
      },
      cancel: cancelBody,
    }), {
      status: 400,
      headers: { "Content-Length": String(1024 * 1024 + 1) },
    });
    const client = new OfficeSiteClient("贝露丹蒂", undefined, {
      createFormPublishOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: async () => response,
      }),
    });

    await expect(client.postForm("/api/workshop/items", createPublishFixtureForm()))
      .rejects.toThrow(/1048576 byte limit/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it("should abort an in-flight office FormData publish with the caller reason", async () => {
    let markTransportStarted!: () => void;
    const transportStarted = new Promise<void>((resolve) => {
      markTransportStarted = resolve;
    });
    const transport = vi.fn(async (input: Parameters<OutboundRequestAdapter>[0]) => await new Promise<Response>(
      (_resolve, reject) => {
        markTransportStarted();
        const rejectAbort = () => reject(new Error("publish adapter aborted"));
        if (input.init.signal?.aborted) {
          rejectAbort();
          return;
        }
        input.init.signal?.addEventListener("abort", rejectAbort, { once: true });
      },
    ));
    const controller = new AbortController();
    const client = new OfficeSiteClient("贝露丹蒂", controller.signal, {
      createFormPublishOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });

    const resultPromise = client.postForm("/api/workshop/items", createPublishFixtureForm());
    await transportStarted;
    controller.abort("Stop office publish.");

    await expect(resultPromise).rejects.toThrow("Stop office publish.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("should block publish when file path escapes workspace", async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-office-outside-"));
    const outsideFile = path.join(outsideDir, "secret.yml");
    await fs.writeFile(outsideFile, "secret", "utf-8");

    try {
      const result = await officeWorkshopPublishTool.execute(
        {
          agent_name: "贝露丹蒂",
          category: "methods",
          title: "越界发布",
          summary: "summary",
          description: "description",
          file_path: outsideFile,
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("越界");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("should allow publish from configured office uploadRoots outside workspace", async () => {
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-office-upload-root-"));
    const uploadFile = path.join(uploadRoot, "publish.json");
    await fs.writeFile(uploadFile, "{\"name\":\"demo\"}", "utf-8");
    await fs.writeFile(
      path.join(stateDir, "community.json"),
      JSON.stringify({
        endpoint: "https://office.test",
        agents: [
          {
            name: "贝露丹蒂",
            apiKey: "gro_test_key",
            office: {
              uploadRoots: [uploadRoot],
            },
          },
        ],
      }, null, 2),
      "utf-8",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "item-upload-1", message: "发布成功" }, 201));

    try {
      const result = await officeWorkshopPublishTool.execute(
        {
          agent_name: "贝露丹蒂",
          category: "skills",
          title: "上传白名单测试",
          summary: "summary",
          description: "description",
          file_path: uploadFile,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://office.test/api/workshop/items");
      expect(init.method).toBe("POST");
    } finally {
      await fs.rm(uploadRoot, { recursive: true, force: true });
    }
  });

  it("should publish workshop file successfully", async () => {
    const sampleFile = path.join(tempDir, "publish.yml");
    const manifestFile = path.join(tempDir, "manifest.json");
    await fs.writeFile(sampleFile, "name: publish-test", "utf-8");
    await fs.writeFile(manifestFile, JSON.stringify({ app: "demo" }), "utf-8");

    const transport = vi.fn(async (_input: Parameters<OutboundRequestAdapter>[0]) => (
      jsonResponse({ id: "new-item", message: "发布成功" })
    ));
    __setOfficeSiteClientDependenciesForTests({
      createFormPublishOutboundRequestPolicy: (options) => new OutboundRequestPolicy({
        ...options,
        dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        requestAdapter: transport,
      }),
    });
    const controller = new AbortController();

    const result = await officeWorkshopPublishTool.execute(
      {
        agent_name: "贝露丹蒂",
        category: "应用",
        title: "发布测试",
        summary: "summary",
        description: "description",
        file_path: sampleFile,
        manifest_path: manifestFile,
        app_run_type: "download",
      },
      { ...context, abortSignal: controller.signal },
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      success: true,
      category: "apps",
      fileName: "publish.yml",
      filePath: sampleFile,
      result: { id: "new-item", message: "发布成功" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: new URL("https://office.test/api/workshop/items"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
      init: {
        method: "POST",
        signal: controller.signal,
        maxRedirects: 0,
        idleTimeoutMs: 15_000,
      },
    });
    const headers = request?.init.headers;
    expect(headers?.["X-API-Key"]).toBe("gro_test_key");
    expect(headers?.["X-Agent-ID"]).toBe(encodeURIComponent("贝露丹蒂"));
    expect(headers?.["Accept-Encoding"]).toBe("identity");
    expect(headers?.["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/i);
    const body = request?.init.body;
    expect(body).toBeInstanceOf(Uint8Array);
    if (!(body instanceof Uint8Array) || !headers?.["Content-Type"]) {
      throw new Error("Expected serialized Office multipart request body");
    }
    expect(headers["Content-Length"]).toBe(String(body.byteLength));

    const sentForm = await new Response(body, {
      headers: { "Content-Type": headers["Content-Type"] },
    }).formData();
    expect(sentForm.get("title")).toBe("发布测试");
    expect(sentForm.get("summary")).toBe("summary");
    expect(sentForm.get("description")).toBe("description");
    expect(sentForm.get("category")).toBe("apps");
    expect(sentForm.get("version")).toBe("1.0.0");
    expect(sentForm.get("price")).toBe("0");
    expect(sentForm.get("tags")).toBe("[]");
    expect(sentForm.get("appRunType")).toBe("download");
    expect(sentForm.get("manifest")).toBe(JSON.stringify({ app: "demo" }));
    const sentFile = sentForm.get("file");
    expect(sentFile).not.toBeNull();
    expect(typeof sentFile).not.toBe("string");
    if (!sentFile || typeof sentFile === "string") {
      throw new Error("Expected serialized Office publish file");
    }
    expect(sentFile.name).toBe("publish.yml");
    expect(await sentFile.text()).toBe("name: publish-test");
  });

  it("should read my homestead successfully", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      homestead: { id: "a10001", name: "我的家园" },
      placedItems: [],
      inventoryItems: [],
    }));

    const result = await officeHomesteadGetTool.execute({ agent_name: "贝露丹蒂" }, context);

    expect(result.success).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/town-square/my-homestead");
  });

  it("should place homestead item with correct payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      message: "放置成功",
      prosperity: 10,
      placedItems: [{ inventoryId: 1 }],
      inventoryItems: [],
    }));

    const result = await officeHomesteadPlaceTool.execute(
      { agent_name: "贝露丹蒂", inventory_id: 7, x: 2, y: -1 },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      success: true,
      message: "放置成功",
      prosperity: 10,
      placedItems: [{ inventoryId: 1 }],
      inventoryItems: [],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/town-square/place");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ inventoryId: 7, x: 2, y: -1 }));
  });

  it("should list my workshop items", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ id: "mine-1", title: "我的作品" }] }));

    const result = await officeWorkshopMineTool.execute({ agent_name: "贝露丹蒂" }, context);

    expect(result.success).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/workshop/mine");
  });

  it("should reject workshop update without changed fields", async () => {
    const result = await officeWorkshopUpdateTool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-1" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("至少提供一个要更新的字段");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should update workshop item with correct payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "更新成功" }));

    const result = await officeWorkshopUpdateTool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-1", title: "新标题", tags: ["a", "b"] },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({ success: true, message: "更新成功" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/workshop/items/item-1");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ title: "新标题", tags: ["a", "b"] }));
  });

  it("should delete workshop item", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "删除成功" }));

    const result = await officeWorkshopDeleteTool.execute(
      { agent_name: "贝露丹蒂", item_id: "item-1" },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({ success: true, message: "删除成功" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/workshop/items/item-1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("should mount homestead item with correct payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "挂载成功", prosperity: 12, placedItems: [], inventoryItems: [] }));

    const result = await officeHomesteadMountTool.execute(
      { agent_name: "贝露丹蒂", inventory_id: 7, host_inventory_id: 8, offset_x: 12, offset_y: 6 },
      context,
    );

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/town-square/mount");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ inventoryId: 7, hostInventoryId: 8, offsetX: 12, offsetY: 6 }));
  });

  it("should unmount homestead item", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "已取消挂载", prosperity: 8, placedItems: [], inventoryItems: [] }));

    const result = await officeHomesteadUnmountTool.execute(
      { agent_name: "贝露丹蒂", inventory_id: 9 },
      context,
    );

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/town-square/unmount");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ inventoryId: 9 }));
  });

  it("should open blind box", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "开启成功", rewards: [{ itemId: 1, count: 1 }], inventoryItems: [] }));

    const result = await officeHomesteadOpenBlindBoxTool.execute(
      { agent_name: "贝露丹蒂", inventory_id: 11 },
      context,
    );

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/town-square/open-blind-box");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ inventoryId: 11 }));
  });

  it("should list forum boards with realm filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [
        { id: "b1", slug: "bug", name: "BUG区", realm: "renshijian" },
        { id: "b2", slug: "wulingjie", name: "物灵界", realm: "wulingjie" },
      ],
    }));

    const result = await officeForumListBoardsTool.execute(
      { agent_name: "贝露丹蒂", realm: "renshijian" },
      context,
    );

    expect(result.success).toBe(true);
    const output = JSON.parse(result.output);
    expect(output.total).toBe(1);
    expect(output.items[0].slug).toBe("bug");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/forum/boards");
  });

  it("should search forum threads with board slug and keyword", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{ id: "t1", title: "登录异常", content: "无法登录", authorType: "user" }],
      total: 1,
      page: 1,
      pageSize: 20,
    }));

    const result = await officeForumSearchThreadsTool.execute(
      { agent_name: "贝露丹蒂", board_slug: "bug", keyword: "登录" },
      context,
    );

    expect(result.success).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://office.test/api/forum/threads?boardSlug=bug&q=%E7%99%BB%E5%BD%95&pinned=all&page=1&pageSize=20");
    const output = JSON.parse(result.output);
    expect(output.filteredCount).toBe(1);
    expect(output.items[0].title).toBe("登录异常");
  });

  it("should get forum thread and replies", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        thread: { id: "thread-1", title: "主题", content: "正文", authorType: "user" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "reply-1", threadId: "thread-1", content: "回复", authorType: "agent" }],
        total: 1,
        page: 1,
        pageSize: 50,
      }));

    const result = await officeForumGetThreadTool.execute(
      { agent_name: "贝露丹蒂", thread_id: "thread-1", include_replies: true },
      context,
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [threadUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [replyUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(threadUrl).toBe("https://office.test/api/forum/threads/thread-1");
    expect(replyUrl).toBe("https://office.test/api/forum/threads/thread-1/replies?page=1&pageSize=50");
    const output = JSON.parse(result.output);
    expect(output.repliesTotal).toBe(1);
    expect(output.replies[0].id).toBe("reply-1");
  });

  it("should collect bug threads with time filter and limit", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "b1", slug: "bug", name: "BUG区", realm: "renshijian", realmLabel: "人世间", threadCount: 3 }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            id: "thread-old",
            title: "旧 BUG",
            content: "旧内容",
            authorType: "user",
            createdAt: "2026-04-20T10:00:00.000Z",
            updatedAt: "2026-04-20T10:00:00.000Z",
            lastReplyAt: "2026-04-20T10:00:00.000Z",
            replyCount: 1,
            board: { id: "b1", slug: "bug", name: "BUG区", realm: "renshijian" },
          },
          {
            id: "thread-new",
            title: "新 BUG",
            content: "新内容",
            authorType: "user",
            createdAt: "2026-04-25T10:00:00.000Z",
            updatedAt: "2026-04-25T10:00:00.000Z",
            lastReplyAt: "2026-04-25T10:00:00.000Z",
            replyCount: 2,
            board: { id: "b1", slug: "bug", name: "BUG区", realm: "renshijian" },
          },
        ],
        total: 2,
        page: 1,
        pageSize: 2,
      }));

    const result = await officeForumCollectBugsTool.execute(
      { agent_name: "贝露丹蒂", from: "2026-04-24T00:00:00.000Z", limit: 1 },
      context,
    );

    expect(result.success).toBe(true);
    const output = JSON.parse(result.output);
    expect(output.board.slug).toBe("bug");
    expect(output.totalMatched).toBe(1);
    expect(output.items[0].title).toBe("新 BUG");
  });

  it("should collect feedback threads from suggestions board", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: "s1", slug: "suggestions", name: "建议区", realm: "renshijian", realmLabel: "人世间", threadCount: 1 }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            id: "thread-suggestion",
            title: "建议增加导出",
            content: "希望增加 CSV 导出",
            authorType: "user",
            createdAt: "2026-04-25T09:00:00.000Z",
            updatedAt: "2026-04-25T09:00:00.000Z",
            lastReplyAt: "2026-04-25T09:00:00.000Z",
            replyCount: 0,
            board: { id: "s1", slug: "suggestions", name: "建议区", realm: "renshijian" },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      }));

    const result = await officeForumCollectFeedbackTool.execute(
      { agent_name: "贝露丹蒂", keyword: "导出" },
      context,
    );

    expect(result.success).toBe(true);
    const [boardsUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [threadsUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(boardsUrl).toBe("https://office.test/api/forum/boards");
    expect(threadsUrl).toContain("/api/forum/threads?boardSlug=suggestions&q=%E5%AF%BC%E5%87%BA");
    const output = JSON.parse(result.output);
    expect(output.board.slug).toBe("suggestions");
    expect(output.items[0].title).toBe("建议增加导出");
  });
});
