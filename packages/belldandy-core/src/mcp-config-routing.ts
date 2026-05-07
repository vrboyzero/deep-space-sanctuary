import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export type MCPRoutingTransport = "stdio" | "sse" | "unknown";

export interface MCPRoutingServerView {
  id: string;
  enabled: boolean;
  autoConnect: boolean;
  transport: MCPRoutingTransport;
  command?: string;
  url?: string;
  authHeaderPlaceholder?: boolean;
}

export interface MCPRoutingRuntimeProbe {
  target?: string;
  reachable: boolean;
  error?: string;
}

export interface MCPRoutingDoctorReport {
  configPath: string;
  exists: boolean;
  parseError?: string;
  serverCount: number;
  servers: MCPRoutingServerView[];
  starweaver: {
    local: MCPRoutingServerView | null;
    central: MCPRoutingServerView | null;
    status:
      | "not_configured"
      | "central_primary"
      | "central_primary_placeholder_key"
      | "central_primary_unreachable"
      | "central_primary_placeholder_key_unreachable"
      | "local_fallback_active"
      | "inactive";
    headline: string;
    fix?: string;
    runtimeProbe?: MCPRoutingRuntimeProbe;
  };
}

type ExternalServerEntry = {
  command?: unknown;
  type?: unknown;
  url?: unknown;
  baseUrl?: unknown;
  headers?: unknown;
  disabled?: unknown;
  autoConnect?: unknown;
};

const STARWEAVER_SSE_KEY_PLACEHOLDER = "Bearer replace-with-your-sse-api-key";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isPlaceholderAuthorizationHeader(entry: ExternalServerEntry): boolean {
  const headers = asObject(entry.headers);
  const authorization = readString(headers?.Authorization) ?? readString(headers?.authorization);
  return authorization === STARWEAVER_SSE_KEY_PLACEHOLDER;
}

function resolveExternalTransport(entry: ExternalServerEntry): MCPRoutingTransport {
  const explicitType = readString(entry.type)?.toLowerCase();
  if (explicitType === "stdio" || explicitType === "sse") {
    return explicitType;
  }
  if (readString(entry.url) || readString(entry.baseUrl)) {
    return readString(entry.command) ? "stdio" : "sse";
  }
  if (readString(entry.command)) {
    return "stdio";
  }
  return "unknown";
}

function normalizeExternalServers(raw: Record<string, unknown>): MCPRoutingServerView[] {
  const externalServers = asObject(raw.mcpServers);
  if (!externalServers) {
    return [];
  }

  return Object.entries(externalServers).flatMap(([id, value]) => {
    const entry = asObject(value) as ExternalServerEntry | null;
    if (!entry) {
      return [];
    }
    return [{
      id,
      enabled: readBoolean(entry.disabled, false) ? false : true,
      autoConnect: readBoolean(entry.autoConnect, true),
      transport: resolveExternalTransport(entry),
      command: readString(entry.command),
      url: readString(entry.url) ?? readString(entry.baseUrl),
      authHeaderPlaceholder: isPlaceholderAuthorizationHeader(entry),
    } satisfies MCPRoutingServerView];
  });
}

function normalizeInternalServers(raw: Record<string, unknown>): MCPRoutingServerView[] {
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  return servers.flatMap((value) => {
    const entry = asObject(value);
    if (!entry) {
      return [];
    }
    const transport = asObject(entry.transport);
    const transportType = readString(transport?.type)?.toLowerCase();
    return [{
      id: readString(entry.id) ?? "",
      enabled: readBoolean(entry.enabled, true),
      autoConnect: readBoolean(entry.autoConnect, true),
      transport: transportType === "stdio" || transportType === "sse" ? transportType : "unknown",
      command: readString(transport?.command),
      url: readString(transport?.url),
      authHeaderPlaceholder: false,
    } satisfies MCPRoutingServerView];
  }).filter((server) => server.id);
}

function inspectStarweaverRouting(
  servers: MCPRoutingServerView[],
  runtimeProbe?: MCPRoutingRuntimeProbe,
) {
  const local = servers.find((server) => server.id === "starweaver") ?? null;
  const central = servers.find((server) => server.id === "starweaver-central") ?? null;
  const localActive = Boolean(local) && local.enabled !== false && local.autoConnect !== false;
  const centralActive = Boolean(central) && central.enabled !== false && central.autoConnect !== false;
  const placeholderKey = central?.authHeaderPlaceholder === true;
  const centralUnreachable = centralActive && runtimeProbe?.reachable === false;

  if (!local && !central) {
    return {
      local,
      central,
      status: "not_configured" as const,
      headline: "No starweaver MCP route is configured in mcp.json.",
      fix: "Add starweaver-central for shared-host SSE, and keep local starweaver only as an explicit fallback.",
    };
  }

  if (localActive) {
    return {
      local,
      central,
      status: "local_fallback_active" as const,
      headline: centralActive
        ? "Gateway still auto-connects local starweaver stdio; starweaver-central is configured but not exclusive."
        : "Gateway auto-connects local starweaver stdio; this is a local fallback path, not the shared-host default.",
      fix: "Set starweaver.disabled=true or autoConnect=false, then keep starweaver-central enabled for the shared SSE host.",
    };
  }

  if (centralActive) {
    if (placeholderKey && centralUnreachable) {
      return {
        local,
        central,
        runtimeProbe,
        status: "central_primary_placeholder_key_unreachable" as const,
        headline: local
          ? "starweaver-central SSE is primary, but it still uses the placeholder API key and the shared host is unreachable; local starweaver fallback remains inactive."
          : "starweaver-central SSE is primary, but it still uses the placeholder API key and the shared host is unreachable.",
        fix: "Start Star_Weaver_Engine with 'pnpm host:central', then replace Authorization 'Bearer replace-with-your-sse-api-key' with a real SSE API key.",
      };
    }
    if (placeholderKey) {
      return {
        local,
        central,
        runtimeProbe,
        status: "central_primary_placeholder_key" as const,
        headline: local
          ? "starweaver-central SSE is primary, but it still uses the placeholder API key; local starweaver fallback is present but inactive."
          : "starweaver-central SSE is primary, but it still uses the placeholder API key.",
        fix: "Replace Authorization 'Bearer replace-with-your-sse-api-key' with a real SSE API key before relying on shared-host SSE.",
      };
    }
    if (centralUnreachable) {
      return {
        local,
        central,
        runtimeProbe,
        status: "central_primary_unreachable" as const,
        headline: local
          ? "starweaver-central SSE is primary, but the shared host is unreachable; local starweaver fallback is present but inactive."
          : "starweaver-central SSE is primary, but the shared host is unreachable.",
        fix: "Start Star_Weaver_Engine with 'pnpm host:central', or fix the configured SSE url before expecting Star Weaver tools.",
      };
    }
    return {
      local,
      central,
      runtimeProbe,
      status: "central_primary" as const,
      headline: local
        ? "starweaver-central SSE is primary; local starweaver fallback is present but inactive."
        : "starweaver-central SSE is primary.",
      fix: local
        ? "Keep local starweaver disabled or autoConnect=false unless you intentionally need stdio fallback."
        : undefined,
    };
  }

  return {
    local,
    central,
    runtimeProbe,
    status: "inactive" as const,
    headline: "Starweaver MCP entries exist, but neither local nor central route will auto-connect.",
    fix: "Enable starweaver-central, or manually connect a route before expecting Star Weaver tools.",
  };
}

function buildCentralProbeTarget(url: string): { host: string; port: number; target: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const port = Number(parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : ""));
    if (!host || !Number.isFinite(port) || port <= 0) {
      return null;
    }
    return {
      host,
      port,
      target: `${host}:${port}`,
    };
  } catch {
    return null;
  }
}

export async function probeMcpRoutingRuntime(servers: MCPRoutingServerView[]): Promise<MCPRoutingRuntimeProbe | undefined> {
  const central = servers.find((server) => server.id === "starweaver-central");
  if (!central || central.enabled === false || central.autoConnect === false || central.transport !== "sse" || !central.url) {
    return undefined;
  }
  const target = buildCentralProbeTarget(central.url);
  if (!target) {
    return {
      target: central.url,
      reachable: false,
      error: "invalid_url",
    };
  }

  return await new Promise<MCPRoutingRuntimeProbe>((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const finish = (value: MCPRoutingRuntimeProbe) => {
      if (!socket.destroyed) {
        socket.destroy();
      }
      resolve(value);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => finish({ target: target.target, reachable: true }));
    socket.once("timeout", () => finish({ target: target.target, reachable: false, error: "timeout" }));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish({
        target: target.target,
        reachable: false,
        error: error.code ?? error.message,
      });
    });
  });
}

export function inspectMcpConfigRouting(
  raw: unknown,
  configPath = "mcp.json",
  runtimeProbe?: MCPRoutingRuntimeProbe,
): MCPRoutingDoctorReport {
  const objectValue = asObject(raw);
  if (!objectValue) {
    return {
      configPath,
      exists: true,
      parseError: "Root JSON must be an object.",
      serverCount: 0,
      servers: [],
      starweaver: {
        local: null,
        central: null,
        status: "inactive",
        headline: "Invalid mcp.json structure.",
        fix: "Fix the JSON structure before using MCP routes.",
        runtimeProbe,
      },
    };
  }

  const servers = objectValue.mcpServers
    ? normalizeExternalServers(objectValue)
    : normalizeInternalServers(objectValue);

  return {
    configPath,
    exists: true,
    serverCount: servers.length,
    servers,
    starweaver: inspectStarweaverRouting(servers, runtimeProbe),
  };
}

export async function readMcpRoutingDoctorReport(stateDir: string): Promise<MCPRoutingDoctorReport> {
  const configPath = path.join(stateDir, "mcp.json");
  if (!fs.existsSync(configPath)) {
    return {
      configPath,
      exists: false,
      serverCount: 0,
      servers: [],
      starweaver: {
        local: null,
        central: null,
        status: "not_configured",
        headline: "mcp.json is not configured.",
        fix: "Add starweaver-central for shared-host SSE if this Gateway should consume Star Weaver tools.",
      },
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const initialReport = inspectMcpConfigRouting(raw, configPath);
    const runtimeProbe = await probeMcpRoutingRuntime(initialReport.servers);
    return inspectMcpConfigRouting(raw, configPath, runtimeProbe);
  } catch (error) {
    return {
      configPath,
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
      serverCount: 0,
      servers: [],
      starweaver: {
        local: null,
        central: null,
        status: "inactive",
        headline: "mcp.json could not be parsed.",
        fix: "Fix the parse error before relying on MCP routing.",
      },
    };
  }
}
