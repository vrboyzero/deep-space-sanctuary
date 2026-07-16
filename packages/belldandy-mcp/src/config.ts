/**
 * MCP 配置加载与管理
 * 
 * 负责从状态目录中的 mcp.json 加载和验证 MCP 服务器配置。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { mcpLog } from "./logger-adapter.js";
import { z } from "zod";
import { resolveStateDir } from "@belldandy/protocol";
import {
  type MCPConfig,
  type MCPServerConfig,
  DEFAULT_MCP_CONFIG,
  DEFAULT_SERVER_CONFIG,
} from "./types.js";

// ============================================================================
// 配置路径常量
// ============================================================================

/** Belldandy 用户目录 */
function getBelldandyDir(): string {
  return resolveStateDir(process.env);
}

const BELLDANDY_DIR = getBelldandyDir();

/** MCP 配置文件路径 */
function getMcpConfigPath(): string {
  return join(getBelldandyDir(), "mcp.json");
}

const MCP_CONFIG_PATH = getMcpConfigPath();

const MAX_MCP_CONFIG_BYTES = 1 * 1024 * 1024;
const MAX_MCP_SERVERS = 128;
const MAX_MCP_SERVER_ARGS = 128;
const MAX_MCP_SERVER_ENV_ENTRIES = 64;
const MAX_MCP_SERVER_HEADER_ENTRIES = 64;
const RENAME_RETRIES = 3;
const RENAME_RETRY_DELAY_MS = 50;

/** 同一进程内的 read-modify-write 队列，避免配置更新互相覆盖。 */
let configMutationQueue: Promise<void> = Promise.resolve();

// ============================================================================
// Zod 验证 Schema
// ============================================================================

/**
 * stdio 传输配置验证
 */
const StdioEnvironmentSchema = z.record(z.string()).refine(
  (entries) => Object.keys(entries).length <= MAX_MCP_SERVER_ENV_ENTRIES,
  `环境变量不能超过 ${MAX_MCP_SERVER_ENV_ENTRIES} 项`,
);

const SSEHeadersSchema = z.record(z.string()).refine(
  (entries) => Object.keys(entries).length <= MAX_MCP_SERVER_HEADER_ENTRIES,
  `请求头不能超过 ${MAX_MCP_SERVER_HEADER_ENTRIES} 项`,
);

const StdioConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1, "命令不能为空"),
  args: z.array(z.string()).max(MAX_MCP_SERVER_ARGS, `参数不能超过 ${MAX_MCP_SERVER_ARGS} 项`).optional(),
  env: StdioEnvironmentSchema.optional(),
  cwd: z.string().optional(),
});

/**
 * SSE 传输配置验证
 */
const SSEConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string().url("必须是有效的 URL"),
  headers: SSEHeadersSchema.optional(),
  allowInsecureHttp: z.boolean().optional(),
  allowPrivateNetwork: z.boolean().optional(),
});

/**
 * 传输配置验证（联合类型）
 */
const TransportConfigSchema = z.discriminatedUnion("type", [
  StdioConfigSchema,
  SSEConfigSchema,
]);

/**
 * 单个服务器配置验证
 */
const ServerConfigSchema = z.object({
  id: z.string().min(1, "服务器 ID 不能为空"),
  name: z.string().min(1, "服务器名称不能为空"),
  description: z.string().optional(),
  transport: TransportConfigSchema,
  autoConnect: z.boolean().optional().default(DEFAULT_SERVER_CONFIG.autoConnect),
  enabled: z.boolean().optional().default(DEFAULT_SERVER_CONFIG.enabled),
  timeout: z.number().positive().optional().default(DEFAULT_SERVER_CONFIG.timeout),
  retryCount: z.number().int().min(0).optional().default(DEFAULT_SERVER_CONFIG.retryCount),
  retryDelay: z.number().positive().optional().default(DEFAULT_SERVER_CONFIG.retryDelay),
});

/**
 * 全局设置验证
 */
const SettingsSchema = z.object({
  defaultTimeout: z.number().positive().optional().default(30000),
  debug: z.boolean().optional().default(false),
  toolPrefix: z.boolean().optional().default(true),
});

/**
 * 完整配置验证
 */
const MCPConfigSchema = z.object({
  version: z.string().optional().default("1.0.0"),
  revision: z.number().int().min(0).optional().default(0),
  servers: z.array(ServerConfigSchema).max(MAX_MCP_SERVERS, `服务器不能超过 ${MAX_MCP_SERVERS} 个`).default([]),
  settings: SettingsSchema.optional(),
});

// ============================================================================
// 外部格式兼容（Claude Desktop / Cursor 等通用 MCP 配置格式）
// ============================================================================

/**
 * 外部 MCP 配置格式（事实标准）
 *
 * 形如：
 * ```json
 * {
 *   "mcpServers": {
 *     "server-id": {
 *       "command": "npx",
 *       "args": ["-y", "some-package"],
 *       "env": { "KEY": "value" }
 *     },
 *     "remote-server": {
 *       "url": "https://example.com/mcp",
 *       "headers": { "Authorization": "Bearer ..." }
 *     }
 *   }
 * }
 * ```
 */
interface ExternalServerEntry {
  /** stdio: 命令 */
  command?: string;
  /** stdio: 参数 */
  args?: string[];
  /** stdio: 环境变量 */
  env?: Record<string, string>;
  /** stdio: 工作目录 */
  cwd?: string;
  /** stdio: 显式 type 标记（部分工具会写） */
  type?: string;
  /** SSE/HTTP: url 字段 */
  url?: string;
  /** SSE/HTTP: baseUrl 字段（部分工具用这个） */
  baseUrl?: string;
  /** SSE/HTTP: 请求头 */
  headers?: Record<string, string>;
  /** SSE/HTTP: 显式允许明文 HTTP */
  allowInsecureHttp?: boolean;
  /** SSE/HTTP: 显式允许私网或 loopback */
  allowPrivateNetwork?: boolean;
  /** 可选：是否自动连接 */
  autoConnect?: boolean;
  /** 可选：是否禁用 */
  disabled?: boolean;
}

interface ExternalMCPConfig {
  mcpServers: Record<string, ExternalServerEntry>;
  imports?: string[];
}

/**
 * 检测 JSON 对象是否为外部格式（含 mcpServers 键）
 */
function isExternalFormat(raw: unknown): raw is ExternalMCPConfig {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "mcpServers" in raw &&
    typeof (raw as Record<string, unknown>).mcpServers === "object"
  );
}

/**
 * 将外部格式转换为 Belldandy 内部 MCPConfig
 *
 * 转换规则：
 * - 对象 key → id + name
 * - command/args/env/cwd → transport { type: "stdio", ... }
 * - url 或 baseUrl → transport { type: "sse", url, headers? }
 * - autoConnect: false → autoConnect: false
 * - disabled: true → enabled: false
 * - 其余字段使用默认值
 */
function convertExternalConfig(external: ExternalMCPConfig): Record<string, unknown> {
  const servers: Record<string, unknown>[] = [];

  for (const [id, entry] of Object.entries(external.mcpServers)) {
    if (!entry || typeof entry !== "object") continue;

    // 判断传输类型
    const sseUrl = entry.url || entry.baseUrl;
    const isSSE = !!sseUrl && !entry.command;

    let transport: Record<string, unknown>;
    if (isSSE) {
      transport = {
        type: "sse",
        url: sseUrl,
        ...(entry.headers ? { headers: entry.headers } : {}),
        ...(entry.allowInsecureHttp === true ? { allowInsecureHttp: true } : {}),
        ...(entry.allowPrivateNetwork === true ? { allowPrivateNetwork: true } : {}),
      };
    } else {
      transport = {
        type: "stdio",
        command: entry.command ?? "",
        ...(entry.args ? { args: entry.args } : {}),
        ...(entry.env ? { env: entry.env } : {}),
        ...(entry.cwd ? { cwd: entry.cwd } : {}),
      };
    }

    servers.push({
      id,
      name: id,
      transport,
      ...(typeof entry.autoConnect === "boolean" ? { autoConnect: entry.autoConnect } : {}),
      enabled: entry.disabled === true ? false : true,
    });
  }

  mcpLog("MCP", `检测到外部格式（mcpServers），已转换 ${servers.length} 个服务器`);

  return {
    version: "1.0.0",
    servers,
  };
}

// ============================================================================
// 配置加载函数
// ============================================================================

function createDefaultConfigSnapshot(): MCPConfig {
  return {
    version: DEFAULT_MCP_CONFIG.version,
    revision: DEFAULT_MCP_CONFIG.revision ?? 0,
    servers: [],
    settings: DEFAULT_MCP_CONFIG.settings ? { ...DEFAULT_MCP_CONFIG.settings } : undefined,
  };
}

function formatValidationErrors(errors: z.ZodIssue[]): string {
  return errors
    .map((error) => `  - ${error.path.join(".")}: ${error.message}`)
    .join("\n");
}

function validateConfig(config: unknown, errorPrefix: string): MCPConfig {
  const result = MCPConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`${errorPrefix}:\n${formatValidationErrors(result.error.errors)}`);
  }

  const serverIds = new Set<string>();
  for (const server of result.data.servers) {
    if (serverIds.has(server.id)) {
      throw new Error(`MCP 配置错误: 服务器 ID "${server.id}" 重复`);
    }
    serverIds.add(server.id);
  }

  return result.data as MCPConfig;
}

function validateServerConfig(server: unknown, errorPrefix: string): MCPServerConfig {
  const result = ServerConfigSchema.safeParse(server);
  if (!result.success) {
    throw new Error(`${errorPrefix}:\n${formatValidationErrors(result.error.errors)}`);
  }
  return result.data as MCPServerConfig;
}

function ensureConfigContentSize(content: string): void {
  const byteLength = Buffer.byteLength(content, "utf-8");
  if (byteLength > MAX_MCP_CONFIG_BYTES) {
    throw new Error(`MCP 配置文件不能超过 ${MAX_MCP_CONFIG_BYTES} 字节`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueConfigMutation<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  const task = configMutationQueue.then(operation, operation);
  configMutationQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function configFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function enforcePrivateConfigFileMode(filePath: string): Promise<void> {
  try {
    if (process.platform !== "win32") {
      const mode = (await fs.stat(filePath)).mode & 0o777;
      if (mode === 0o600) {
        return;
      }
    }
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }
  }
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < RENAME_RETRIES - 1) {
        await delay(RENAME_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

function isRecoverableWindowsRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EBUSY" || code === "EEXIST";
}

async function replaceConfigFileWithBackup(tempPath: string, configPath: string): Promise<void> {
  const backupPath = join(dirname(configPath), `.${basename(configPath)}.${randomUUID()}.bak`);
  let backupCreated = false;

  try {
    await fs.rename(configPath, backupPath);
    backupCreated = true;
    await renameWithRetry(tempPath, configPath);
    await fs.unlink(backupPath).catch(() => {});
    backupCreated = false;
  } catch (error) {
    if (backupCreated) {
      try {
        await renameWithRetry(backupPath, configPath);
        backupCreated = false;
      } catch {
        throw new Error("MCP 配置原子替换失败，旧配置已保留在同目录备份文件中。");
      }
    }
    throw new Error("无法原子替换 MCP 配置文件。");
  }
}

async function replaceConfigFileAtomically(tempPath: string, configPath: string): Promise<void> {
  try {
    await renameWithRetry(tempPath, configPath);
    return;
  } catch (error) {
    if (
      process.platform !== "win32"
      || !isRecoverableWindowsRenameError(error)
      || !(await configFileExists(configPath))
    ) {
      throw new Error("无法原子替换 MCP 配置文件。");
    }
  }

  await replaceConfigFileWithBackup(tempPath, configPath);
}

async function writeConfigFileAtomically(configPath: string, content: string): Promise<void> {
  const configDir = dirname(configPath);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });

  const tempPath = join(configDir, `.${basename(configPath)}.${randomUUID()}.tmp`);
  let tempExists = false;
  try {
    const tempFile = await fs.open(tempPath, "wx", 0o600);
    tempExists = true;
    try {
      await tempFile.writeFile(content, "utf-8");
      await tempFile.sync();
    } finally {
      await tempFile.close();
    }

    await enforcePrivateConfigFileMode(tempPath);
    await replaceConfigFileAtomically(tempPath, configPath);
    tempExists = false;
    await enforcePrivateConfigFileMode(configPath);
  } finally {
    if (tempExists) {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}

async function saveConfigUnlocked(config: MCPConfig): Promise<void> {
  const normalized = validateConfig(config, "无效的 MCP 配置");
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  ensureConfigContentSize(content);

  const configPath = getMcpConfigPath();
  await writeConfigFileAtomically(configPath, content);
  mcpLog("MCP", `配置已保存到: ${configPath}`);
}

async function mutateConfig(mutator: (config: MCPConfig) => MCPConfig): Promise<void> {
  await enqueueConfigMutation(async () => {
    const current = await loadConfig();
    const next = mutator(current);
    await saveConfigUnlocked({
      ...next,
      revision: (current.revision ?? 0) + 1,
    });
  });
}

/**
 * 检查配置文件是否存在
 */
export async function configExists(): Promise<boolean> {
  return configFileExists(getMcpConfigPath());
}

/**
 * 加载 MCP 配置
 * 
 * @returns 解析后的 MCP 配置
 * @throws 如果配置文件无效或不存在
 */
export async function loadConfig(): Promise<MCPConfig> {
  const configPath = getMcpConfigPath();

  // 检查配置文件是否存在
  if (!(await configExists())) {
    mcpLog("MCP", `配置文件不存在: ${configPath}`);
    mcpLog("MCP", "使用默认配置（无服务器）");
    return createDefaultConfigSnapshot();
  }

  try {
    // mcp.json 可包含 Authorization header 和 env，读取时也修复历史宽权限文件。
    await enforcePrivateConfigFileMode(configPath);

    // 读取配置文件
    const content = await fs.readFile(configPath, "utf-8");
    ensureConfigContentSize(content);
    let rawConfig = JSON.parse(content);

    // 兼容外部格式（Claude Desktop / Cursor 等 mcpServers 格式）
    if (isExternalFormat(rawConfig)) {
      rawConfig = convertExternalConfig(rawConfig);
    }

    const config = validateConfig(rawConfig, "MCP 配置验证失败");

    mcpLog("MCP", `已加载配置，共 ${config.servers.length} 个服务器`);
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`MCP 配置文件 JSON 格式错误: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 保存 MCP 配置
 * 
 * @param config 要保存的配置
 */
export async function saveConfig(config: MCPConfig): Promise<void> {
  await enqueueConfigMutation(async () => {
    await saveConfigUnlocked(config);
  });
}

/**
 * 创建默认配置文件
 * 
 * 如果配置文件不存在，则创建一个包含示例服务器的默认配置。
 */
export async function createDefaultConfig(): Promise<void> {
  await enqueueConfigMutation(async () => {
    if (await configExists()) {
      mcpLog("MCP", `配置文件已存在: ${getMcpConfigPath()}`);
      return;
    }

    const defaultConfig: MCPConfig = {
      version: "1.0.0",
      revision: 0,
      servers: [
        {
          id: "example-filesystem",
          name: "文件系统服务器 (示例)",
          description: "示例：提供文件系统访问能力的 MCP 服务器",
          transport: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          },
          autoConnect: false,
          enabled: false,
        },
      ],
      settings: {
        defaultTimeout: 30000,
        debug: false,
        toolPrefix: true,
      },
    };

    await saveConfigUnlocked(defaultConfig);
    mcpLog("MCP", `已创建默认配置文件: ${getMcpConfigPath()}`);
  });
}

// ============================================================================
// 配置操作函数
// ============================================================================

/**
 * 添加服务器配置
 * 
 * @param server 服务器配置
 */
export async function addServer(server: MCPServerConfig): Promise<void> {
  await mutateConfig((config) => {
    // 检查 ID 是否已存在
    if (config.servers.some((item) => item.id === server.id)) {
      throw new Error(`服务器 ID "${server.id}" 已存在`);
    }

    const validatedServer = validateServerConfig(server, "无效的服务器配置");
    return {
      ...config,
      servers: [...config.servers, validatedServer],
    };
  });
}

/**
 * 移除服务器配置
 * 
 * @param serverId 服务器 ID
 */
export async function removeServer(serverId: string): Promise<void> {
  await mutateConfig((config) => {
    const index = config.servers.findIndex((server) => server.id === serverId);
    if (index === -1) {
      throw new Error(`服务器 "${serverId}" 不存在`);
    }
    return {
      ...config,
      servers: config.servers.filter((server) => server.id !== serverId),
    };
  });
}

/**
 * 更新服务器配置
 * 
 * @param serverId 服务器 ID
 * @param updates 要更新的字段
 */
export async function updateServer(
  serverId: string,
  updates: Partial<MCPServerConfig>
): Promise<void> {
  await mutateConfig((config) => {
    const index = config.servers.findIndex((server) => server.id === serverId);
    if (index === -1) {
      throw new Error(`服务器 "${serverId}" 不存在`);
    }

    // 不允许更改 ID，避免配置索引与已连接客户端漂移。
    if (updates.id !== undefined && updates.id !== serverId) {
      throw new Error("不允许更改服务器 ID");
    }

    const updatedServer = validateServerConfig({
      ...config.servers[index],
      ...updates,
      id: serverId,
    }, "更新后的配置无效");
    const servers = [...config.servers];
    servers[index] = updatedServer;
    return { ...config, servers };
  });
}

/**
 * 获取服务器配置
 * 
 * @param serverId 服务器 ID
 * @returns 服务器配置，如果不存在则返回 undefined
 */
export async function getServer(
  serverId: string
): Promise<MCPServerConfig | undefined> {
  const config = await loadConfig();
  return config.servers.find((s) => s.id === serverId);
}

/**
 * 获取所有启用的服务器配置
 * 
 * @returns 启用的服务器配置列表
 */
export async function getEnabledServers(): Promise<MCPServerConfig[]> {
  const config = await loadConfig();
  return config.servers.filter((s) => s.enabled !== false);
}

/**
 * 获取所有自动连接的服务器配置
 * 
 * @returns 自动连接的服务器配置列表
 */
export async function getAutoConnectServers(): Promise<MCPServerConfig[]> {
  const config = await loadConfig();
  return config.servers.filter(
    (s) => s.enabled !== false && s.autoConnect !== false
  );
}

// ============================================================================
// 导出配置路径
// ============================================================================

export { BELLDANDY_DIR, MCP_CONFIG_PATH };
