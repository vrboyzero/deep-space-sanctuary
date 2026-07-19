import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  OutboundRequestPolicy,
  resolveStateDir,
  type OutboundRequestInit,
  type OutboundRequestPolicyOptions,
} from "@belldandy/protocol";
import type { ToolContext } from "../../types.js";
import { throwIfAborted, toAbortError } from "../../abort-utils.js";
import {
  persistBoundedResponseToFile,
  type BoundedResponseFileResult,
} from "../remote-response-file.js";
import {
  readBoundedOfficeJsonResponse,
  readBoundedOfficeResponseText,
} from "./response-reader.js";
import { serializeOfficeMultipartForm } from "./multipart-form.js";

export type OfficeCommunityAgentConfig = {
  name: string;
  apiKey: string;
  office?: {
    downloadDir?: string;
    uploadRoots?: string[];
  };
};

type OfficeCommunityConfig = {
  endpoint: string;
  agents: OfficeCommunityAgentConfig[];
};

type OfficeApiErrorBody = {
  error?: string;
  message?: string;
};

export type OfficeRequestPolicyFactory = (
  options: OutboundRequestPolicyOptions,
) => Pick<OutboundRequestPolicy, "request">;

export type OfficeDownloadRequestPolicyFactory = OfficeRequestPolicyFactory;
export type OfficeGetJsonRequestPolicyFactory = OfficeRequestPolicyFactory;
export type OfficeJsonMutationRequestPolicyFactory = OfficeRequestPolicyFactory;
export type OfficeFormPublishRequestPolicyFactory = OfficeRequestPolicyFactory;

export type OfficeSiteClientDependencies = {
  createDownloadOutboundRequestPolicy?: OfficeDownloadRequestPolicyFactory;
  createGetJsonOutboundRequestPolicy?: OfficeGetJsonRequestPolicyFactory;
  createJsonMutationOutboundRequestPolicy?: OfficeJsonMutationRequestPolicyFactory;
  createFormPublishOutboundRequestPolicy?: OfficeFormPublishRequestPolicyFactory;
};

let officeSiteClientTestDependencies: OfficeSiteClientDependencies | undefined;

/** 测试只替换外部 DNS/transport capability；每个 fixture 必须在 afterEach 重置。 */
export function __setOfficeSiteClientDependenciesForTests(
  dependencies: OfficeSiteClientDependencies | undefined,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("OfficeSiteClient test dependencies are only available in the test environment.");
  }
  officeSiteClientTestDependencies = dependencies;
}

const SENSITIVE_PATTERNS = [
  ".env",
  ".env.local",
  ".env.production",
  "credentials",
  "secret",
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  "id_rsa",
  "id_ed25519",
  ".ssh",
  "password",
  "token",
];

const DEFAULT_BELLDANDY_AGENT_LOOKUP_KEY = "__default_belldandy__";
const OFFICE_DOWNLOAD_MAX_REDIRECTS = 0;
const OFFICE_DOWNLOAD_IDLE_TIMEOUT_MS = 15_000;
const OFFICE_GET_JSON_MAX_REDIRECTS = 0;
const OFFICE_GET_JSON_IDLE_TIMEOUT_MS = 15_000;
const OFFICE_JSON_MAX_RESPONSE_BYTES = 1024 * 1024;
const OFFICE_JSON_MUTATION_MAX_REDIRECTS = 0;
const OFFICE_JSON_MUTATION_IDLE_TIMEOUT_MS = 15_000;
const OFFICE_FORM_PUBLISH_MAX_REDIRECTS = 0;
const OFFICE_FORM_PUBLISH_IDLE_TIMEOUT_MS = 15_000;

function normalizeAgentLookupName(input: string): string {
  return input.trim().replace(/[\s_-]+/g, "").toLowerCase();
}

function canonicalizeAgentLookupName(input: string): string {
  const normalized = normalizeAgentLookupName(input);
  if (normalized === "belldandy" || normalized === "贝露丹蒂") {
    return DEFAULT_BELLDANDY_AGENT_LOOKUP_KEY;
  }
  return normalized;
}

function findAgentConfig(
  agents: OfficeCommunityAgentConfig[],
  requestedAgentName: string,
): OfficeCommunityAgentConfig | undefined {
  const exactMatch = agents.find((agent) => agent.name === requestedAgentName);
  if (exactMatch) return exactMatch;

  const lookupKey = canonicalizeAgentLookupName(requestedAgentName);
  return agents.find((agent) => canonicalizeAgentLookupName(agent.name) === lookupKey);
}

function getCommunityConfigPath(): string {
  return path.join(resolveStateDir(process.env), "community.json");
}

function isUnderRoot(absolute: string, root: string): { ok: true; relative: string } | { ok: false } {
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false };
  return { ok: true, relative: rel.replace(/\\/g, "/") };
}

function isDeniedPath(relativePath: string, deniedPaths: string[]): string | null {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  for (const denied of deniedPaths) {
    const deniedNorm = denied.replace(/\\/g, "/").toLowerCase();
    if (normalized.includes(deniedNorm)) {
      return denied;
    }
  }
  return null;
}

function isSensitivePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return SENSITIVE_PATTERNS.some((entry) => lower.includes(entry));
}

function resolveAndValidatePath(
  pathArg: string,
  workspaceRoot: string,
  extraWorkspaceRoots?: string[],
): { absolute: string; relative: string } {
  const trimmed = (pathArg || "").trim();
  if (!trimmed) {
    throw new Error("路径不能为空");
  }

  const normalized = trimmed.replace(/\\/g, "/");
  const mainRoot = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(normalized) || /^[A-Za-z]:/.test(trimmed)
    ? path.resolve(normalized)
    : path.resolve(mainRoot, normalized);

  const underMain = isUnderRoot(absolute, mainRoot);
  if (underMain.ok) {
    return { absolute, relative: underMain.relative };
  }

  for (const extraRoot of extraWorkspaceRoots ?? []) {
    const underExtra = isUnderRoot(absolute, path.resolve(extraRoot));
    if (underExtra.ok) {
      return { absolute, relative: underExtra.relative };
    }
  }

  throw new Error("路径越界：不允许访问工作区外的文件");
}

function resolveConfiguredRoots(roots: string[] | undefined, workspaceRoot: string): string[] {
  return (roots ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const normalized = entry.replace(/\\/g, "/");
      return path.isAbsolute(normalized) || /^[A-Za-z]:/.test(entry)
        ? path.resolve(normalized)
        : path.resolve(workspaceRoot, normalized);
    });
}

function mergeRoots(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).map((entry) => path.resolve(entry)))];
}

export function resolveReadablePath(
  pathArg: string,
  context: ToolContext,
  extraWorkspaceRoots?: string[],
): { absolute: string; relative: string } {
  const resolved = resolveAndValidatePath(
    pathArg,
    context.workspaceRoot,
    mergeRoots(context.extraWorkspaceRoots, extraWorkspaceRoots),
  );
  const denied = isDeniedPath(resolved.relative, context.policy.deniedPaths);
  if (denied) {
    throw new Error(`禁止访问路径：${denied}`);
  }
  if (isSensitivePath(resolved.relative)) {
    throw new Error("禁止读取敏感文件（如 .env、密钥、凭证等）");
  }
  return resolved;
}

export function resolveWritableDir(
  pathArg: string,
  context: ToolContext,
  extraWorkspaceRoots?: string[],
): { absolute: string; relative: string } {
  const resolved = resolveAndValidatePath(
    pathArg,
    context.workspaceRoot,
    mergeRoots(context.extraWorkspaceRoots, extraWorkspaceRoots),
  );
  const denied = isDeniedPath(resolved.relative, context.policy.deniedPaths);
  if (denied) {
    throw new Error(`禁止写入路径：${denied}`);
  }
  if (isSensitivePath(resolved.relative)) {
    throw new Error("禁止写入敏感路径");
  }
  return resolved;
}

export function normalizeWorkshopCategory(input: string): string {
  const value = (input || "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    skills: "skills",
    skill: "skills",
    "技能": "skills",
    methods: "methods",
    method: "methods",
    "方法": "methods",
    "方法论": "methods",
    apps: "apps",
    app: "apps",
    "应用": "apps",
    plugins: "plugins",
    plugin: "plugins",
    "插件": "plugins",
    "模组": "plugins",
    facets: "facets",
    facet: "facets",
    mcp: "mcp",
  };
  return aliases[value] ?? value;
}

export class OfficeSiteClient {
  private readonly endpoint: string;
  private readonly agentConfig: OfficeCommunityAgentConfig;
  private readonly abortSignal?: AbortSignal;
  private readonly createDownloadOutboundRequestPolicy: OfficeDownloadRequestPolicyFactory;
  private readonly createGetJsonOutboundRequestPolicy: OfficeGetJsonRequestPolicyFactory;
  private readonly createJsonMutationOutboundRequestPolicy: OfficeJsonMutationRequestPolicyFactory;
  private readonly createFormPublishOutboundRequestPolicy: OfficeFormPublishRequestPolicyFactory;

  constructor(
    agentName: string,
    abortSignal?: AbortSignal,
    dependencies: OfficeSiteClientDependencies = {},
  ) {
    const resolvedDependencies = {
      ...officeSiteClientTestDependencies,
      ...dependencies,
    };
    const config = this.loadConfig();
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.agentConfig = findAgentConfig(config.agents, agentName)
      ?? (() => {
        throw new Error(`community.json 未找到 Agent 配置: ${agentName}`);
      })();
    this.abortSignal = abortSignal;
    this.createDownloadOutboundRequestPolicy = resolvedDependencies.createDownloadOutboundRequestPolicy
      ?? ((options) => new OutboundRequestPolicy(options));
    this.createGetJsonOutboundRequestPolicy = resolvedDependencies.createGetJsonOutboundRequestPolicy
      ?? ((options) => new OutboundRequestPolicy(options));
    this.createJsonMutationOutboundRequestPolicy = resolvedDependencies.createJsonMutationOutboundRequestPolicy
      ?? ((options) => new OutboundRequestPolicy(options));
    this.createFormPublishOutboundRequestPolicy = resolvedDependencies.createFormPublishOutboundRequestPolicy
      ?? ((options) => new OutboundRequestPolicy(options));

    if (!this.agentConfig.apiKey) {
      throw new Error(`Agent ${agentName} 缺少 apiKey 配置`);
    }
  }

  getUploadRoots(context: ToolContext): string[] {
    return resolveConfiguredRoots(this.agentConfig.office?.uploadRoots, context.workspaceRoot);
  }

  resolveUploadPath(pathArg: string, context: ToolContext): { absolute: string; relative: string } {
    return resolveReadablePath(pathArg, context, this.getUploadRoots(context));
  }

  getDownloadDir(context: ToolContext): string {
    const configured = this.agentConfig.office?.downloadDir?.trim();
    if (!configured) {
      return path.join(context.workspaceRoot, "downloads", "office");
    }
    return resolveWritableDir(
      configured,
      context,
      mergeRoots(this.getUploadRoots(context), resolveConfiguredRoots([configured], context.workspaceRoot)),
    ).absolute;
  }

  async getJson<T>(apiPath: string): Promise<T> {
    throwIfAborted(this.abortSignal);
    const requestUrl = this.buildUrl(apiPath);
    const endpointHost = new URL(this.endpoint).hostname;
    const requestPolicy = this.createGetJsonOutboundRequestPolicy({
      allowedHosts: [endpointHost],
      maxRedirects: OFFICE_GET_JSON_MAX_REDIRECTS,
    });
    let res: Response;
    try {
      const result = await requestPolicy.request({
        url: requestUrl,
        method: "GET",
        headers: {
          ...this.buildHeaders(),
          "Accept-Encoding": "identity",
        },
        signal: this.abortSignal,
        maxRedirects: OFFICE_GET_JSON_MAX_REDIRECTS,
        idleTimeoutMs: OFFICE_GET_JSON_IDLE_TIMEOUT_MS,
      });
      res = result.response;
    } catch (error) {
      if (this.abortSignal?.aborted) {
        throw toAbortError(this.abortSignal.reason);
      }
      throw error;
    }

    if (!res.ok) {
      throw await this.buildBoundedJsonResponseError(res);
    }

    throwIfAborted(this.abortSignal);
    return await readBoundedOfficeJsonResponse({
      response: res,
      maxBytes: OFFICE_JSON_MAX_RESPONSE_BYTES,
      abortSignal: this.abortSignal,
    }) as T;
  }

  async postJson<T>(apiPath: string, body: unknown): Promise<T> {
    return this.requestJsonMutation<T>(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async putJson<T>(apiPath: string, body: unknown): Promise<T> {
    return this.requestJsonMutation<T>(apiPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async deleteJson<T>(apiPath: string): Promise<T> {
    return this.requestJsonMutation<T>(apiPath, {
      method: "DELETE",
    });
  }

  async postForm<T>(apiPath: string, form: FormData): Promise<T> {
    throwIfAborted(this.abortSignal);
    const requestUrl = this.buildUrl(apiPath);
    const endpointHost = new URL(this.endpoint).hostname;
    const requestPolicy = this.createFormPublishOutboundRequestPolicy({
      allowedHosts: [endpointHost],
      maxRedirects: OFFICE_FORM_PUBLISH_MAX_REDIRECTS,
    });
    const multipart = await serializeOfficeMultipartForm(form, this.abortSignal);
    let res: Response;
    try {
      const result = await requestPolicy.request({
        url: requestUrl,
        method: "POST",
        headers: {
          ...this.buildHeaders(),
          "Content-Type": multipart.contentType,
          "Content-Length": String(multipart.body.byteLength),
          "Accept-Encoding": "identity",
        },
        body: multipart.body,
        signal: this.abortSignal,
        maxRedirects: OFFICE_FORM_PUBLISH_MAX_REDIRECTS,
        idleTimeoutMs: OFFICE_FORM_PUBLISH_IDLE_TIMEOUT_MS,
      });
      res = result.response;
    } catch (error) {
      if (this.abortSignal?.aborted) {
        throw toAbortError(this.abortSignal.reason);
      }
      throw error;
    }

    if (!res.ok) {
      throw await this.buildBoundedJsonResponseError(res);
    }

    throwIfAborted(this.abortSignal);
    return await readBoundedOfficeJsonResponse({
      response: res,
      maxBytes: OFFICE_JSON_MAX_RESPONSE_BYTES,
      abortSignal: this.abortSignal,
    }) as T;
  }

  async downloadToFile(apiPath: string, input: {
    targetPath: string;
    maxBytes: number;
    overwrite: boolean;
  }): Promise<BoundedResponseFileResult> {
    throwIfAborted(this.abortSignal);
    const downloadUrl = this.buildUrl(apiPath);
    const endpointHost = new URL(this.endpoint).hostname;
    // Office 下载携带 API key；只允许配置 endpoint 的已审查首跳，禁止 redirect 重放凭据。
    const requestPolicy = this.createDownloadOutboundRequestPolicy({
      allowedHosts: [endpointHost],
      maxRedirects: OFFICE_DOWNLOAD_MAX_REDIRECTS,
    });
    let res: Response;
    try {
      const result = await requestPolicy.request({
        url: downloadUrl,
        method: "GET",
        headers: {
          ...this.buildHeaders(),
          "Accept-Encoding": "identity",
        },
        signal: this.abortSignal,
        maxRedirects: OFFICE_DOWNLOAD_MAX_REDIRECTS,
        idleTimeoutMs: OFFICE_DOWNLOAD_IDLE_TIMEOUT_MS,
      });
      res = result.response;
    } catch (error) {
      if (this.abortSignal?.aborted) {
        throw toAbortError(this.abortSignal.reason);
      }
      throw error;
    }

    if (!res.ok) {
      throw await this.buildResponseError(res);
    }

    return await persistBoundedResponseToFile({
      response: res,
      targetPath: input.targetPath,
      maxBytes: input.maxBytes,
      label: "Office download",
      abortSignal: this.abortSignal,
      overwrite: input.overwrite,
    });
  }

  private loadConfig(): OfficeCommunityConfig {
    const configPath = getCommunityConfigPath();
    let raw: string;
    try {
      raw = fsSync.readFileSync(configPath, "utf-8");
    } catch {
      throw new Error(`community.json 不存在：${configPath}`);
    }

    let parsed: OfficeCommunityConfig;
    try {
      parsed = JSON.parse(raw) as OfficeCommunityConfig;
    } catch (error) {
      throw new Error(`community.json 解析失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!parsed.endpoint || !Array.isArray(parsed.agents)) {
      throw new Error("community.json 缺少 endpoint 或 agents 配置");
    }
    return parsed;
  }

  private async requestJsonMutation<T>(
    apiPath: string,
    init: Pick<OutboundRequestInit, "method" | "headers" | "body">,
  ): Promise<T> {
    throwIfAborted(this.abortSignal);
    const requestUrl = this.buildUrl(apiPath);
    const endpointHost = new URL(this.endpoint).hostname;
    // JSON mutation 携带 API key 与可重放 body，只允许配置 endpoint 的已审查首跳。
    const requestPolicy = this.createJsonMutationOutboundRequestPolicy({
      allowedHosts: [endpointHost],
      maxRedirects: OFFICE_JSON_MUTATION_MAX_REDIRECTS,
    });
    let res: Response;
    try {
      const result = await requestPolicy.request({
        url: requestUrl,
        method: init.method ?? "POST",
        headers: {
          ...this.buildHeaders(),
          ...(init.headers ?? {}),
          "Accept-Encoding": "identity",
        },
        body: init.body,
        signal: this.abortSignal,
        maxRedirects: OFFICE_JSON_MUTATION_MAX_REDIRECTS,
        idleTimeoutMs: OFFICE_JSON_MUTATION_IDLE_TIMEOUT_MS,
      });
      res = result.response;
    } catch (error) {
      if (this.abortSignal?.aborted) {
        throw toAbortError(this.abortSignal.reason);
      }
      throw error;
    }

    if (!res.ok) {
      throw await this.buildBoundedJsonResponseError(res);
    }

    throwIfAborted(this.abortSignal);
    return await readBoundedOfficeJsonResponse({
      response: res,
      maxBytes: OFFICE_JSON_MAX_RESPONSE_BYTES,
      abortSignal: this.abortSignal,
    }) as T;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "X-API-Key": this.agentConfig.apiKey,
      "X-Agent-ID": encodeURIComponent(this.agentConfig.name),
    };
  }

  private buildUrl(apiPath: string): string {
    if (/^https?:\/\//i.test(apiPath)) return apiPath;
    return `${this.endpoint}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
  }

  private async buildBoundedJsonResponseError(res: Response): Promise<Error> {
    let message = `请求失败 (${res.status})`;
    if (!res.body) {
      return new Error(message);
    }
    const bodyText = await readBoundedOfficeResponseText({
      response: res,
      maxBytes: OFFICE_JSON_MAX_RESPONSE_BYTES,
      abortSignal: this.abortSignal,
    });
    try {
      const body = JSON.parse(bodyText) as unknown;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const errorBody = body as OfficeApiErrorBody;
        message = errorBody.error || errorBody.message || message;
      }
    } catch {
      if (bodyText.trim()) {
        message = bodyText.trim().slice(0, 300);
      }
    }
    return new Error(message);
  }

  private async buildResponseError(res: Response): Promise<Error> {
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json() as OfficeApiErrorBody;
      message = body.error || body.message || message;
    } catch {
      const bodyText = await res.text().catch(() => "");
      if (bodyText.trim()) {
        message = bodyText.trim().slice(0, 300);
      }
    }
    return new Error(message);
  }
}
