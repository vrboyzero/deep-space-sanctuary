import fs from "node:fs/promises";
import path from "node:path";

import { defineCommand } from "citty";

import { createCLIContext } from "../../shared/context.js";

const MCP_CONFIG_FILE_NAME = "mcp.json";

type ExternalMcpServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  type?: string;
  url?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  autoConnect?: boolean;
};

type ExternalMcpConfig = {
  mcpServers?: Record<string, ExternalMcpServerEntry>;
};

export interface ConfigureStarweaverCentralOptions {
  stateDir: string;
  workspaceRoot: string;
  localHostEntryCommand?: string;
  localHostEntryArgs?: string[];
  localHostCwd?: string;
  centralUrl: string;
  authorizationHeader: string;
  localServerId: string;
  centralServerId: string;
}

export interface ConfigureStarweaverCentralResult {
  changed: boolean;
  stateDir: string;
  workspaceRoot: string;
  mcpPath: string;
  localServerId: string;
  centralServerId: string;
  centralUrl: string;
  createdFiles: string[];
  updatedFiles: string[];
  nextSteps: string[];
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<{ existed: boolean; value: T }> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as T;
    return { existed: true, value: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { existed: false, value: fallback };
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function buildDefaultLocalHostArgs(workspaceRoot: string): string[] {
  return [
    "--import",
    "tsx",
    path.join(workspaceRoot, "Star_Weaver_Engine", "host", "mcpSouthboundHost.ts"),
  ];
}

function normalizeConfig(input: ExternalMcpConfig): ExternalMcpConfig {
  return {
    mcpServers: input.mcpServers && typeof input.mcpServers === "object"
      ? { ...input.mcpServers }
      : {},
  };
}

function buildLocalFallbackEntry(options: ConfigureStarweaverCentralOptions): ExternalMcpServerEntry {
  return {
    command: options.localHostEntryCommand ?? "node",
    args: options.localHostEntryArgs ?? buildDefaultLocalHostArgs(options.workspaceRoot),
    env: {},
    cwd: options.localHostCwd ?? options.workspaceRoot,
    type: "stdio",
    autoConnect: false,
  };
}

function buildCentralEntry(options: ConfigureStarweaverCentralOptions): ExternalMcpServerEntry {
  return {
    url: options.centralUrl,
    headers: {
      Authorization: options.authorizationHeader,
    },
    autoConnect: true,
  };
}

export async function configureStarweaverCentral(
  options: ConfigureStarweaverCentralOptions,
): Promise<ConfigureStarweaverCentralResult> {
  const stateDir = path.resolve(options.stateDir);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const mcpPath = path.join(stateDir, MCP_CONFIG_FILE_NAME);

  const loaded = await readJsonFile<ExternalMcpConfig>(mcpPath, { mcpServers: {} });
  const nextConfig = normalizeConfig(loaded.value);
  const before = JSON.stringify(nextConfig);

  nextConfig.mcpServers ??= {};
  nextConfig.mcpServers[options.localServerId] = buildLocalFallbackEntry({
    ...options,
    stateDir,
    workspaceRoot,
  });
  nextConfig.mcpServers[options.centralServerId] = buildCentralEntry({
    ...options,
    stateDir,
    workspaceRoot,
  });

  const after = JSON.stringify(nextConfig);
  const changed = before !== after || !loaded.existed;

  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];
  if (changed) {
    await writeJsonFile(mcpPath, nextConfig);
    if (loaded.existed) {
      updatedFiles.push(mcpPath);
    } else {
      createdFiles.push(mcpPath);
    }
  }

  return {
    changed,
    stateDir,
    workspaceRoot,
    mcpPath,
    localServerId: options.localServerId,
    centralServerId: options.centralServerId,
    centralUrl: options.centralUrl,
    createdFiles,
    updatedFiles,
    nextSteps: [
      `先在 ${workspaceRoot}\\Star_Weaver_Engine 中启动 shared host：pnpm host:central`,
      "运行 `bdd doctor`，确认 Starweaver MCP Routing 显示 starweaver-central 为 primary。",
      "如果需要本地回退，可手动 connect 本地 starweaver；默认不要恢复 autoConnect=true。",
    ],
  };
}

export default defineCommand({
  meta: {
    name: "starweaver-central",
    description: "Generate the recommended Star Weaver shared-host MCP routing template",
  },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    "workspace-root": { type: "string", description: "Workspace root that contains Star_Weaver_Engine" },
    "central-url": { type: "string", description: "Starweaver shared-host SSE url", default: "http://127.0.0.1:28767/sse" },
    "authorization-header": { type: "string", description: "Authorization header value for starweaver-central", default: "Bearer replace-with-your-sse-api-key" },
    "local-server-id": { type: "string", description: "Local fallback server id", default: "starweaver" },
    "central-server-id": { type: "string", description: "Central shared-host server id", default: "starweaver-central" },
    "local-host-command": { type: "string", description: "Optional local fallback command", default: "node" },
    "local-host-args-json": { type: "string", description: "Optional JSON array override for local fallback args" },
    "local-host-cwd": { type: "string", description: "Optional local fallback cwd" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    const workspaceRoot = args["workspace-root"] ? String(args["workspace-root"]) : process.cwd();
    const localHostArgs = args["local-host-args-json"]
      ? JSON.parse(String(args["local-host-args-json"]))
      : undefined;
    if (localHostArgs !== undefined && !Array.isArray(localHostArgs)) {
      throw new Error("local-host-args-json must be a JSON string array");
    }

    const result = await configureStarweaverCentral({
      stateDir: ctx.stateDir,
      workspaceRoot,
      localHostEntryCommand: String(args["local-host-command"] ?? "node"),
      localHostEntryArgs: Array.isArray(localHostArgs)
        ? localHostArgs.map((item) => String(item))
        : undefined,
      localHostCwd: args["local-host-cwd"] ? String(args["local-host-cwd"]) : undefined,
      centralUrl: String(args["central-url"] ?? "http://127.0.0.1:28767/sse"),
      authorizationHeader: String(args["authorization-header"] ?? "Bearer replace-with-your-sse-api-key"),
      localServerId: String(args["local-server-id"] ?? "starweaver"),
      centralServerId: String(args["central-server-id"] ?? "starweaver-central"),
    });

    if (ctx.json) {
      ctx.output(result);
      return;
    }

    if (result.changed) {
      ctx.success("Starweaver shared-host MCP 模板已生成");
    } else {
      ctx.log("Starweaver shared-host MCP 模板已是最新状态");
    }
    ctx.log(`  stateDir: ${result.stateDir}`);
    ctx.log(`  mcp.json: ${result.mcpPath}`);
    ctx.log(`  localServerId: ${result.localServerId}`);
    ctx.log(`  centralServerId: ${result.centralServerId}`);
    ctx.log(`  centralUrl: ${result.centralUrl}`);
    for (const step of result.nextSteps) {
      ctx.log(`  next: ${step}`);
    }
  },
});
