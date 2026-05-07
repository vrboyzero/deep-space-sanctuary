import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  resolveEnvFilePaths,
  resolveWorkspaceTemplateDir,
  type ResolveWorkspaceTemplateDirOptions,
} from "./runtime-paths.js";

const DEFAULT_ENV_TEMPLATE = `# Star Sanctuary default bootstrap config
# Auto-generated on first launch when no .env or .env.local exists yet.
# Put secrets and personal overrides in .env.local via WebChat settings or bdd setup.

# Runtime
BELLDANDY_AGENT_PROVIDER=openai
BELLDANDY_OPENAI_BASE_URL=https://api.openai.com/v1
BELLDANDY_OPENAI_MODEL=gpt-4o-mini
BELLDANDY_HOST=127.0.0.1
BELLDANDY_PORT=28889
BELLDANDY_AUTH_MODE=none
BELLDANDY_UPDATE_CHECK=true

# Tools / automation
BELLDANDY_TOOLS_ENABLED=true
BELLDANDY_DANGEROUS_TOOLS_ENABLED=false
BELLDANDY_MCP_ENABLED=false
BELLDANDY_BROWSER_RELAY_ENABLED=false
BELLDANDY_ASSISTANT_MODE_ENABLED=true
BELLDANDY_CRON_ENABLED=true
BELLDANDY_HEARTBEAT_ENABLED=true
BELLDANDY_HEARTBEAT_INTERVAL=30m
BELLDANDY_HEARTBEAT_ACTIVE_HOURS=08:00-23:00

# Memory / token (balanced baseline)
BELLDANDY_EMBEDDING_ENABLED=false
BELLDANDY_CONTEXT_INJECTION=true
BELLDANDY_CONTEXT_INJECTION_LIMIT=4
BELLDANDY_AUTO_RECALL_ENABLED=true
BELLDANDY_AUTO_RECALL_LIMIT=3
BELLDANDY_AUTO_RECALL_MIN_SCORE=0.35
BELLDANDY_MEMORY_SUMMARY_ENABLED=true
BELLDANDY_MEMORY_EVOLUTION_ENABLED=true
BELLDANDY_MEMORY_EVOLUTION_MIN_MESSAGES=8
BELLDANDY_TASK_MEMORY_ENABLED=true
BELLDANDY_TASK_SUMMARY_ENABLED=false
BELLDANDY_EXPERIENCE_AUTO_PROMOTION_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_METHOD_ENABLED=true
BELLDANDY_EXPERIENCE_AUTO_SKILL_ENABLED=false
BELLDANDY_MEMORY_DEEP_RETRIEVAL=false
BELLDANDY_RERANKER_MIN_SCORE=0.20
BELLDANDY_RERANKER_LENGTH_NORM_ANCHOR=500
BELLDANDY_MAX_INPUT_TOKENS=20000
BELLDANDY_MAX_OUTPUT_TOKENS=6144
BELLDANDY_COMPACTION_ENABLED=true
BELLDANDY_COMPACTION_THRESHOLD=15000
BELLDANDY_COMPACTION_KEEP_RECENT=10
BELLDANDY_COMPACTION_TRIGGER_FRACTION=0.75
BELLDANDY_COMPACTION_ARCHIVAL_THRESHOLD=2000
BELLDANDY_TOOL_GROUPS=methodology,system
BELLDANDY_ROOM_INJECT_THRESHOLD=6
BELLDANDY_ROOM_MEMBERS_CACHE_TTL=600000
BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED=false
`;

const DEFAULT_ENV_LOCAL_TEMPLATE = `# Star Sanctuary local overrides
# Auto-generated when .env.local is missing.
# Put secrets and personal machine overrides here.
`;

export type DefaultEnvTemplates = {
  env: string;
  envLocal: string;
};

export type EnsureDefaultEnvFilesResult = {
  envDir: string;
  envPath: string;
  envLocalPath: string;
  createdEnv: boolean;
  createdEnvLocal: boolean;
};

export type ResolveDefaultEnvTemplatePathsOptions = Pick<
  ResolveWorkspaceTemplateDirOptions,
  "env" | "runtimeDir" | "templatesDir" | "agentModuleUrl" | "mode"
>;

export function resolveDefaultEnvTemplatePaths(
  options: ResolveDefaultEnvTemplatePathsOptions = {},
): {
  templatesDir: string;
  envTemplatePath: string;
  envLocalTemplatePath: string;
} {
  const { templatesDir } = resolveWorkspaceTemplateDir({
    agentModuleUrl: import.meta.url,
    ...options,
  });
  return {
    templatesDir,
    envTemplatePath: path.join(templatesDir, "default-env", "runtime.env"),
    envLocalTemplatePath: path.join(templatesDir, "default-env", "runtime.env.local"),
  };
}

function readOptionalTextFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.replace(/^\uFEFF/, "");
  } catch {
    return undefined;
  }
}

function readEnvValueFromText(text: string, key: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;

    const candidateKey = normalized.slice(0, eq).trim();
    if (candidateKey !== key) continue;

    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    return value && value.trim() ? value.trim() : undefined;
  }

  return undefined;
}

function ensureBootstrapAuthTokenInEnvLocal(templates: DefaultEnvTemplates): string {
  const authMode = readEnvValueFromText(templates.envLocal, "BELLDANDY_AUTH_MODE")
    ?? readEnvValueFromText(templates.env, "BELLDANDY_AUTH_MODE");
  const authToken = readEnvValueFromText(templates.envLocal, "BELLDANDY_AUTH_TOKEN")
    ?? readEnvValueFromText(templates.env, "BELLDANDY_AUTH_TOKEN");
  if (authMode !== "token" || authToken) {
    return templates.envLocal;
  }

  const generatedToken = `setup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const suffix = templates.envLocal.endsWith("\n") || !templates.envLocal ? "" : "\n";
  return `${templates.envLocal}${suffix}# Auto-generated bootstrap token for first launch\nBELLDANDY_AUTH_TOKEN=${generatedToken}\n`;
}

export function readDefaultEnvTemplates(
  options: ResolveDefaultEnvTemplatePathsOptions = {},
): DefaultEnvTemplates {
  const templatePaths = resolveDefaultEnvTemplatePaths(options);
  const env = readOptionalTextFile(templatePaths.envTemplatePath) ?? DEFAULT_ENV_TEMPLATE;
  const envLocal = readOptionalTextFile(templatePaths.envLocalTemplatePath) ?? DEFAULT_ENV_LOCAL_TEMPLATE;
  return {
    env,
    envLocal: ensureBootstrapAuthTokenInEnvLocal({ env, envLocal }),
  };
}

function loadEnvFileInto(
  targetEnv: NodeJS.ProcessEnv,
  filePath: string,
  protectedKeys?: ReadonlySet<string>,
  allowedKeys?: ReadonlySet<string>,
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim();
    if (!key) continue;
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (protectedKeys?.has(key)) continue;

    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    targetEnv[key] = value;
  }
}

export function loadRuntimeEnvFiles(baseEnv: NodeJS.ProcessEnv, envDir: string): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const protectedKeys = new Set(Object.keys(baseEnv));
  const envFiles = resolveEnvFilePaths({ envDir });
  loadEnvFileInto(env, envFiles.envPath, protectedKeys);
  loadEnvFileInto(env, envFiles.envLocalPath, protectedKeys);
  return env;
}

export function readTrimmedEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() ? value.trim() : undefined;
}

export function resolveRuntimeEnvDir(params: {
  baseEnv: NodeJS.ProcessEnv;
  fallbackEnvDir: string;
}): string {
  const explicitEnvDir = readTrimmedEnv(params.baseEnv, "STAR_SANCTUARY_ENV_DIR")
    ?? readTrimmedEnv(params.baseEnv, "BELLDANDY_ENV_DIR");
  if (explicitEnvDir) {
    return explicitEnvDir;
  }
  return params.fallbackEnvDir;
}

export function ensureDefaultEnvFiles(
  envDir: string,
  options: ResolveDefaultEnvTemplatePathsOptions = {},
): EnsureDefaultEnvFilesResult {
  const paths = resolveEnvFilePaths({ envDir });
  const templates = readDefaultEnvTemplates(options);
  let createdEnv = false;
  let createdEnvLocal = false;

  if (!fs.existsSync(paths.envPath)) {
    fs.mkdirSync(paths.envDir, { recursive: true });
    fs.writeFileSync(paths.envPath, templates.env, "utf-8");
    createdEnv = true;
  }

  if (!fs.existsSync(paths.envLocalPath)) {
    fs.mkdirSync(paths.envDir, { recursive: true });
    fs.writeFileSync(paths.envLocalPath, templates.envLocal, "utf-8");
    createdEnvLocal = true;
  }

  return {
    envDir: paths.envDir,
    envPath: paths.envPath,
    envLocalPath: paths.envLocalPath,
    createdEnv,
    createdEnvLocal,
  };
}

export function ensureDefaultEnvFile(
  envDir: string,
  options: ResolveDefaultEnvTemplatePathsOptions = {},
): {
  created: boolean;
  envPath: string;
  envLocalPath: string;
} {
  const result = ensureDefaultEnvFiles(envDir, options);
  return {
    created: result.createdEnv,
    envPath: result.envPath,
    envLocalPath: result.envLocalPath,
  };
}
