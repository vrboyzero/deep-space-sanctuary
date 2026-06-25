import fs from "node:fs/promises";
import path from "node:path";

export type CompatibleMcpServerConfig = {
  id: string;
  name?: string;
  description?: string;
  transport?: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
  };
  autoConnect?: boolean;
  enabled?: boolean;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
};

export type CompatibleMcpConfig = {
  version?: string;
  servers?: CompatibleMcpServerConfig[];
  settings?: {
    defaultTimeout?: number;
    debug?: boolean;
    toolPrefix?: boolean;
  };
};

type ExternalMcpServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  type?: string;
  url?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  autoConnect?: boolean;
  disabled?: boolean;
};

type ExternalMcpConfig = {
  mcpServers?: Record<string, ExternalMcpServerEntry>;
  imports?: string[];
};

export type LoadedCompatibleMcpConfig = {
  existed: boolean;
  format: "internal" | "external";
  internal: CompatibleMcpConfig;
  external?: ExternalMcpConfig;
};

function normalizeExternalMcpConfig(input: ExternalMcpConfig | undefined): ExternalMcpConfig {
  return {
    mcpServers: input?.mcpServers && typeof input.mcpServers === "object"
      ? { ...input.mcpServers }
      : {},
    ...(Array.isArray(input?.imports) ? { imports: [...input.imports] } : {}),
  };
}

function isExternalMcpConfig(raw: unknown): raw is ExternalMcpConfig {
  return Boolean(
    raw
    && typeof raw === "object"
    && "mcpServers" in raw
    && typeof (raw as Record<string, unknown>).mcpServers === "object",
  );
}

function convertExternalToInternal(
  external: ExternalMcpConfig,
  fallback: CompatibleMcpConfig,
): CompatibleMcpConfig {
  const servers = Object.entries(external.mcpServers ?? {}).map(([id, entry]) => {
    const sseUrl = entry.url || entry.baseUrl;
    const isSse = Boolean(sseUrl && !entry.command);
    return {
      id,
      name: id,
      transport: isSse
        ? {
            type: "sse",
            url: sseUrl,
            ...(entry.headers ? { headers: entry.headers } : {}),
          }
        : {
            type: "stdio",
            command: entry.command,
            ...(entry.args ? { args: entry.args } : {}),
            ...(entry.env ? { env: entry.env } : {}),
            ...(entry.cwd ? { cwd: entry.cwd } : {}),
          },
      ...(typeof entry.autoConnect === "boolean" ? { autoConnect: entry.autoConnect } : {}),
      ...(entry.disabled === true ? { enabled: false } : {}),
    } satisfies CompatibleMcpServerConfig;
  });

  return {
    version: fallback.version,
    settings: fallback.settings,
    servers,
  };
}

function convertInternalServerToExternal(server: CompatibleMcpServerConfig): ExternalMcpServerEntry {
  const transport = server.transport ?? {};
  if (transport.type === "sse") {
    return {
      url: transport.url,
      ...(transport.headers ? { headers: transport.headers } : {}),
      ...(typeof server.autoConnect === "boolean" ? { autoConnect: server.autoConnect } : {}),
      ...(server.enabled === false ? { disabled: true } : {}),
    };
  }

  return {
    command: transport.command,
    ...(transport.args ? { args: transport.args } : {}),
    ...(transport.env ? { env: transport.env } : {}),
    ...(transport.cwd ? { cwd: transport.cwd } : {}),
    ...(transport.type ? { type: transport.type } : {}),
    ...(typeof server.autoConnect === "boolean" ? { autoConnect: server.autoConnect } : {}),
    ...(server.enabled === false ? { disabled: true } : {}),
  };
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index === -1) {
    return [...items, nextItem];
  }
  const cloned = [...items];
  cloned[index] = nextItem;
  return cloned;
}

export async function readCompatibleMcpConfig(
  filePath: string,
  fallback: CompatibleMcpConfig,
): Promise<LoadedCompatibleMcpConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (isExternalMcpConfig(parsed)) {
      const external = normalizeExternalMcpConfig(parsed);
      return {
        existed: true,
        format: "external",
        internal: convertExternalToInternal(external, fallback),
        external,
      };
    }
    return {
      existed: true,
      format: "internal",
      internal: parsed as CompatibleMcpConfig,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        existed: false,
        format: "internal",
        internal: fallback,
      };
    }
    throw error;
  }
}

export function buildCompatibleMcpOutput(
  loaded: LoadedCompatibleMcpConfig,
  fallback: CompatibleMcpConfig,
  server: CompatibleMcpServerConfig,
): {
  changed: boolean;
  value: CompatibleMcpConfig | ExternalMcpConfig;
} {
  const nextInternal: CompatibleMcpConfig = {
    version: loaded.internal.version ?? fallback.version,
    servers: upsertById(
      Array.isArray(loaded.internal.servers) ? [...loaded.internal.servers] : [],
      server,
    ),
    settings: loaded.internal.settings ?? fallback.settings,
  };

  if (loaded.format === "external") {
    const nextExternal = normalizeExternalMcpConfig(loaded.external);
    const before = JSON.stringify(nextExternal);
    nextExternal.mcpServers ??= {};
    nextExternal.mcpServers[server.id] = convertInternalServerToExternal(server);
    const after = JSON.stringify(nextExternal);
    return {
      changed: !loaded.existed || before !== after,
      value: nextExternal,
    };
  }

  const before = JSON.stringify(loaded.internal);
  const after = JSON.stringify(nextInternal);
  return {
    changed: !loaded.existed || before !== after,
    value: nextInternal,
  };
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
