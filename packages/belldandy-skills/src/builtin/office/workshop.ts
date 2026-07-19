import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool, ToolCallResult } from "../../types.js";
import { parsePositiveByteLimit } from "../remote-response-file.js";
import {
  OfficeSiteClient,
  normalizeWorkshopCategory,
  resolveWritableDir,
  type OfficeDownloadRequestPolicyFactory,
  type OfficeGetJsonRequestPolicyFactory,
} from "./client.js";

const DEFAULT_OFFICE_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

type OfficeWorkshopDownloadToolDependencies = {
  createDownloadOutboundRequestPolicy?: OfficeDownloadRequestPolicyFactory;
  createGetJsonOutboundRequestPolicy?: OfficeGetJsonRequestPolicyFactory;
};

type WorkshopListResponse = {
  items: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  limit?: number;
};

type WorkshopItemDetail = {
  id: string;
  category: string;
  title: string;
  summary: string;
  description: string;
  version: string;
  price: number;
  tags: string[];
  downloads: number;
  fileName: string;
  fileSize: number;
  fileHash?: string | null;
  status: string;
  appRunType?: string | null;
  appRunUrl?: string | null;
  appManifest?: string | null;
  author?: Record<string, unknown>;
};

function normalizeDownloadedFileName(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const fileName = path.posix.basename(normalized);
  const hasWindowsReservedSyntax = /[<>:"|?*\u0000-\u001f]/u.test(fileName)
    || /[. ]$/u.test(fileName)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(fileName);
  if (!fileName
    || fileName === "."
    || fileName === ".."
    || fileName !== normalized
    || hasWindowsReservedSyntax) {
    throw new Error("工坊下载文件名无效");
  }
  return fileName;
}

function makeResult(name: string, start: number, success: boolean, payload: unknown, error?: string): ToolCallResult {
  return {
    id: "",
    name,
    success,
    output: success ? JSON.stringify(payload, null, 2) : "",
    error,
    durationMs: Date.now() - start,
  };
}

export const officeWorkshopSearchTool: Tool = {
  definition: {
    name: "office_workshop_search",
    description: "搜索 office.goddess.ai 工坊作品，可按分类、关键词、价格和排序筛选。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
        category: { type: "string", description: "分类：skills、methods、apps、plugins、facets、mcp；支持中文别名" },
        keyword: { type: "string", description: "搜索关键词，将匹配标题、摘要、标签" },
        sort: { type: "string", description: "排序方式", enum: ["newest", "popular", "price_asc", "price_desc"] },
        free: { type: "boolean", description: "是否仅看免费作品" },
        page: { type: "number", description: "页码，从 1 开始" },
        limit: { type: "number", description: "每页数量，最大 50" },
      },
      required: ["agent_name"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_search";
    try {
      const agentName = String(input.agent_name || "").trim();
      if (!agentName) return makeResult(name, start, false, null, "agent_name 参数必填");

      const client = new OfficeSiteClient(agentName, context.abortSignal);
      const qs = new URLSearchParams();
      if (input.category) qs.set("category", normalizeWorkshopCategory(String(input.category)));
      if (input.keyword) qs.set("q", String(input.keyword).trim());
      if (input.sort) qs.set("sort", String(input.sort));
      if (typeof input.free === "boolean") qs.set("free", String(input.free));
      if (typeof input.page === "number") qs.set("page", String(Math.max(1, Math.trunc(input.page))));
      if (typeof input.limit === "number") qs.set("limit", String(Math.min(50, Math.max(1, Math.trunc(input.limit)))));

      const query = qs.toString();
      const payload = await client.getJson<WorkshopListResponse>(`/api/workshop/items${query ? `?${query}` : ""}`);

      return makeResult(name, start, true, {
        success: true,
        total: payload.total ?? payload.items.length,
        page: payload.page ?? 1,
        limit: payload.limit ?? payload.items.length,
        items: payload.items,
      });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
  },
};

export const officeWorkshopGetItemTool: Tool = {
  definition: {
    name: "office_workshop_get_item",
    description: "获取 office.goddess.ai 工坊单个作品详情。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
        item_id: { type: "string", description: "工坊作品 ID" },
      },
      required: ["agent_name", "item_id"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_get_item";
    try {
      const agentName = String(input.agent_name || "").trim();
      const itemId = String(input.item_id || "").trim();
      if (!agentName || !itemId) return makeResult(name, start, false, null, "agent_name 和 item_id 参数必填");

      const client = new OfficeSiteClient(agentName, context.abortSignal);
      const payload = await client.getJson<WorkshopItemDetail>(`/api/workshop/items/${encodeURIComponent(itemId)}`);
      return makeResult(name, start, true, { success: true, item: payload });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
  },
};

export const officeWorkshopDownloadTool: Tool = createOfficeWorkshopDownloadTool();

/** 仅为文件下载注入受控网络边界；其他 Office JSON/FormData 请求保持原 owner。 */
export function createOfficeWorkshopDownloadTool(
  dependencies: OfficeWorkshopDownloadToolDependencies = {},
): Tool {
  return {
  definition: {
    name: "office_workshop_download",
    description: "下载工坊作品到本地目录，并在有 fileHash 时校验 SHA-256。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
        item_id: { type: "string", description: "工坊作品 ID" },
        target_dir: { type: "string", description: "下载目录，默认写入 workspaceRoot/downloads/office" },
        overwrite: { type: "boolean", description: "目标文件已存在时是否覆盖，默认 false" },
      },
      required: ["agent_name", "item_id"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_download";
    try {
      const agentName = String(input.agent_name || "").trim();
      const itemId = String(input.item_id || "").trim();
      const overwrite = input.overwrite === true;
      if (!agentName || !itemId) return makeResult(name, start, false, null, "agent_name 和 item_id 参数必填");

      const client = new OfficeSiteClient(agentName, context.abortSignal, dependencies);
      const item = await client.getJson<WorkshopItemDetail>(`/api/workshop/items/${encodeURIComponent(itemId)}`);
      const targetDir = input.target_dir
        ? resolveWritableDir(String(input.target_dir), context).absolute
        : client.getDownloadDir(context);

      await fs.mkdir(targetDir, { recursive: true });
      const fileName = normalizeDownloadedFileName(item.fileName);
      const targetPath = path.join(targetDir, fileName);
      try {
        await fs.access(targetPath);
        if (!overwrite) {
          return makeResult(name, start, false, null, `目标文件已存在：${targetPath}`);
        }
      } catch {
      }

      const downloaded = await client.downloadToFile(
        `/api/workshop/items/${encodeURIComponent(itemId)}/download`,
        {
          targetPath,
          maxBytes: parsePositiveByteLimit(
            process.env.BELLDANDY_OFFICE_MAX_DOWNLOAD_BYTES,
            DEFAULT_OFFICE_MAX_DOWNLOAD_BYTES,
          ),
          overwrite,
        },
      );
      const actualHash = downloaded.sha256;
      const expectedHash = item.fileHash || null;

      return makeResult(name, start, true, {
        success: true,
        itemId,
        title: item.title,
        fileName,
        targetPath,
        fileSize: downloaded.byteLength,
        expectedHash,
        actualHash,
        hashMatched: expectedHash ? expectedHash === actualHash : null,
      });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
    },
  };
}

export const officeWorkshopPublishTool: Tool = {
  definition: {
    name: "office_workshop_publish",
    description: "上传并发布工坊作品，支持技能、方法、应用、插件等分类。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
        category: { type: "string", description: "作品分类，支持 skills、methods、apps、plugins、facets、mcp 及常见中文别名" },
        title: { type: "string", description: "作品标题" },
        summary: { type: "string", description: "作品简介" },
        description: { type: "string", description: "作品详细描述" },
        file_path: { type: "string", description: "本地文件路径，必须位于工作区允许目录内" },
        version: { type: "string", description: "版本号，默认 1.0.0" },
        price: { type: "number", description: "价格，单位分，默认 0" },
        tags: { type: "array", description: "标签数组", items: { type: "string" } },
        app_run_type: { type: "string", description: "apps 分类运行方式", enum: ["web", "download", "redirect"] },
        app_run_url: { type: "string", description: "apps 分类运行 URL（redirect 模式必填）" },
        manifest_path: { type: "string", description: "apps 分类 manifest 文件路径（可选）" },
      },
      required: ["agent_name", "category", "title", "summary", "description", "file_path"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_publish";
    try {
      const agentName = String(input.agent_name || "").trim();
      const category = normalizeWorkshopCategory(String(input.category || ""));
      const title = String(input.title || "").trim();
      const summary = String(input.summary || "").trim();
      const description = String(input.description || "").trim();
      const filePathArg = String(input.file_path || "").trim();
      if (!agentName || !category || !title || !summary || !description || !filePathArg) {
        return makeResult(name, start, false, null, "agent_name、category、title、summary、description、file_path 参数必填");
      }

      const client = new OfficeSiteClient(agentName, context.abortSignal);
      const filePath = client.resolveUploadPath(filePathArg, context).absolute;
      const fileBuffer = await fs.readFile(filePath);
      const fileName = path.basename(filePath);
      const form = new FormData();
      form.append("title", title);
      form.append("summary", summary);
      form.append("description", description);
      form.append("category", category);
      form.append("version", String(input.version || "1.0.0"));
      form.append("price", String(typeof input.price === "number" ? Math.max(0, Math.trunc(input.price)) : 0));
      form.append("tags", JSON.stringify(Array.isArray(input.tags) ? input.tags.map((entry) => String(entry)) : []));

      if (input.app_run_type) form.append("appRunType", String(input.app_run_type));
      if (input.app_run_url) form.append("appRunUrl", String(input.app_run_url));
      if (input.manifest_path) {
        const manifestPath = client.resolveUploadPath(String(input.manifest_path), context).absolute;
        const manifest = await fs.readFile(manifestPath, "utf-8");
        form.append("manifest", manifest);
      }

      form.append("file", new Blob([fileBuffer]), fileName);
      const payload = await client.postForm<Record<string, unknown>>("/api/workshop/items", form);

      return makeResult(name, start, true, {
        success: true,
        category,
        fileName,
        filePath,
        result: payload,
      });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
  },
};

export const officeWorkshopMineTool: Tool = {
  definition: {
    name: "office_workshop_mine",
    description: "查看当前 Agent 主人用户在工坊中发布的作品列表。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
      },
      required: ["agent_name"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_mine";
    try {
      const agentName = String(input.agent_name || "").trim();
      if (!agentName) return makeResult(name, start, false, null, "agent_name 参数必填");

      const client = new OfficeSiteClient(agentName, context.abortSignal);
      const payload = await client.getJson<Record<string, unknown>>("/api/workshop/mine");
      return makeResult(name, start, true, { success: true, ...payload });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
  },
};

export const officeWorkshopUpdateTool: Tool = {
  definition: {
    name: "office_workshop_update",
    description: "更新工坊作品的标题、简介、描述、版本、价格、标签或状态。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
        item_id: { type: "string", description: "工坊作品 ID" },
        title: { type: "string", description: "新的标题" },
        summary: { type: "string", description: "新的简介" },
        description: { type: "string", description: "新的详细描述" },
        version: { type: "string", description: "新的版本号" },
        price: { type: "number", description: "新的价格，单位分" },
        tags: { type: "array", description: "新的标签数组", items: { type: "string" } },
        status: { type: "string", description: "作品状态", enum: ["draft", "pending", "published", "rejected", "removed"] },
      },
      required: ["agent_name", "item_id"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_update";
    try {
      const agentName = String(input.agent_name || "").trim();
      const itemId = String(input.item_id || "").trim();
      if (!agentName || !itemId) return makeResult(name, start, false, null, "agent_name 和 item_id 参数必填");

      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = String(input.title);
      if (input.summary !== undefined) body.summary = String(input.summary);
      if (input.description !== undefined) body.description = String(input.description);
      if (input.version !== undefined) body.version = String(input.version);
      if (input.price !== undefined) body.price = Number(input.price);
      if (input.tags !== undefined) body.tags = Array.isArray(input.tags) ? input.tags.map((entry) => String(entry)) : [];
      if (input.status !== undefined) body.status = String(input.status);

      if (Object.keys(body).length === 0) {
        return makeResult(name, start, false, null, "至少提供一个要更新的字段");
      }

      const client = new OfficeSiteClient(agentName, context.abortSignal);
      const payload = await client.putJson<Record<string, unknown>>(`/api/workshop/items/${encodeURIComponent(itemId)}`, body);
      return makeResult(name, start, true, { success: true, ...payload });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
  },
};

export const officeWorkshopDeleteTool: Tool = {
  definition: {
    name: "office_workshop_delete",
    description: "删除当前 Agent 主人用户发布的工坊作品。",
    parameters: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "community.json 中已配置 apiKey 的 Agent 名称" },
        item_id: { type: "string", description: "要删除的工坊作品 ID" },
      },
      required: ["agent_name", "item_id"],
    },
  },
  async execute(input, context): Promise<ToolCallResult> {
    const start = Date.now();
    const name = "office_workshop_delete";
    try {
      const agentName = String(input.agent_name || "").trim();
      const itemId = String(input.item_id || "").trim();
      if (!agentName || !itemId) return makeResult(name, start, false, null, "agent_name 和 item_id 参数必填");

      const client = new OfficeSiteClient(agentName, context.abortSignal);
      const payload = await client.deleteJson<Record<string, unknown>>(`/api/workshop/items/${encodeURIComponent(itemId)}`);
      return makeResult(name, start, true, { success: true, ...payload });
    } catch (error) {
      return makeResult(name, start, false, null, error instanceof Error ? error.message : String(error));
    }
  },
};
