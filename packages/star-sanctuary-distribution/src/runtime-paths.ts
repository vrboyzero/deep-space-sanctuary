import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadStateDirBootstrapInfo, type StateDirBootstrapSource } from "./state-dir-bootstrap.js";
import { resolveStateDir } from "./state-dir.js";

export type RuntimeMode = "source" | "portable" | "single-exe";

export type GatewayRuntimePaths = {
  mode: RuntimeMode;
  cwd: string;
  stateDir: string;
  stateDirSource: StateDirBootstrapSource;
  stateDirBootstrapFilePath?: string;
  envDir: string;
  envSource: EnvDirSource;
  runtimeDir?: string;
  webRoot: string;
  bundledSkillsDir: string;
};

export type EnvDirSource = "explicit" | "installed_source" | "legacy_root" | "state_dir";

export type ResolveGatewayRuntimePathsOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stateDir?: string;
  envDir?: string;
  runtimeDir?: string;
  webRoot?: string;
  bundledSkillsDir?: string;
  gatewayModuleUrl?: string;
  mode?: RuntimeMode;
};

export type ResolvePreferredEnvDirOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stateDir?: string;
  envDir?: string;
  runtimeDir?: string;
  exists?: (filePath: string) => boolean;
};

export type ResolvePreferredEnvDirResult = {
  envDir: string;
  source: EnvDirSource;
};

export type ResolveWorkspaceTemplateDirOptions = {
  env?: NodeJS.ProcessEnv;
  runtimeDir?: string;
  templatesDir?: string;
  agentModuleUrl?: string;
  mode?: RuntimeMode;
};

function readTrimmedEnv(
  env: NodeJS.ProcessEnv,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function resolveMaybePath(value: string | undefined): string | undefined {
  return value ? path.resolve(value) : undefined;
}

function pickFirstExistingPath(candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore broken candidates and continue searching.
    }
  }
  return fallback;
}

function resolveFromModuleUrl(moduleUrl: string, relativePath: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), relativePath);
}

export function resolveRuntimeDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return resolveMaybePath(
    readTrimmedEnv(env, "STAR_SANCTUARY_RUNTIME_DIR", "BELLDANDY_RUNTIME_DIR"),
  );
}

export function resolveRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
  runtimeDir?: string,
  mode?: RuntimeMode,
): RuntimeMode {
  if (mode) return mode;
  const explicitMode = readTrimmedEnv(env, "STAR_SANCTUARY_RUNTIME_MODE", "BELLDANDY_RUNTIME_MODE");
  if (explicitMode === "source" || explicitMode === "portable" || explicitMode === "single-exe") {
    return explicitMode;
  }
  return runtimeDir ? "portable" : "source";
}

export function resolveEnvFilePaths(params?: { envDir?: string }): { envDir: string; envPath: string; envLocalPath: string } {
  const envDir = path.resolve(params?.envDir ?? process.cwd());
  return {
    envDir,
    envPath: path.join(envDir, ".env"),
    envLocalPath: path.join(envDir, ".env.local"),
  };
}

export function resolvePreferredEnvDir(
  options: ResolvePreferredEnvDirOptions = {},
): string {
  return resolvePreferredEnvDirInfo(options).envDir;
}

export function resolvePreferredEnvDirInfo(
  options: ResolvePreferredEnvDirOptions = {},
): ResolvePreferredEnvDirResult {
  const bootstrap = loadStateDirBootstrapInfo(options.env ?? process.env);
  const resolvedEnv = bootstrap.env;
  const explicitEnvDir = resolveMaybePath(
    options.envDir
      ?? readTrimmedEnv(resolvedEnv, "STAR_SANCTUARY_ENV_DIR", "BELLDANDY_ENV_DIR"),
  );
  if (explicitEnvDir) {
    return {
      envDir: explicitEnvDir,
      source: "explicit",
    };
  }
  const stateDir = path.resolve(options.stateDir ?? resolveStateDir(resolvedEnv));
  return {
    envDir: stateDir,
    source: "state_dir",
  };
}

export function resolveGatewayRuntimePaths(
  options: ResolveGatewayRuntimePathsOptions = {},
): GatewayRuntimePaths {
  const bootstrap = loadStateDirBootstrapInfo(options.env ?? process.env);
  const env = bootstrap.env;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runtimeDir = resolveMaybePath(
    options.runtimeDir
      ?? readTrimmedEnv(env, "STAR_SANCTUARY_RUNTIME_DIR", "BELLDANDY_RUNTIME_DIR"),
  );
  const mode = resolveRuntimeMode(env, runtimeDir, options.mode);
  const stateDir = path.resolve(options.stateDir ?? resolveStateDir(env));
  const envSelection = resolvePreferredEnvDirInfo({
    env,
    cwd,
    stateDir,
    envDir: options.envDir,
    runtimeDir,
  });
  const envDir = envSelection.envDir;

  const webRootFallback = runtimeDir
    ? pickFirstExistingPath(
        [
          path.join(runtimeDir, "apps", "web", "public"),
          path.join(runtimeDir, "web"),
        ],
        path.join(runtimeDir, "apps", "web", "public"),
      )
    : path.join(cwd, "apps", "web", "public");
  const webRoot = path.resolve(
    options.webRoot
      ?? readTrimmedEnv(env, "STAR_SANCTUARY_WEB_ROOT", "BELLDANDY_WEB_ROOT")
      ?? webRootFallback,
  );

  const sourceBundledFromModule = options.gatewayModuleUrl
    ? [
        resolveFromModuleUrl(options.gatewayModuleUrl, "../../../belldandy-skills/dist/bundled-skills"),
        resolveFromModuleUrl(options.gatewayModuleUrl, "../../../belldandy-skills/src/bundled-skills"),
      ]
    : [];
  const sourceBundledFromCwd = [
    path.join(cwd, "packages", "belldandy-skills", "dist", "bundled-skills"),
    path.join(cwd, "packages", "belldandy-skills", "src", "bundled-skills"),
  ];
  const bundledFallback = sourceBundledFromCwd[sourceBundledFromCwd.length - 1];
  const bundledSkillsDir = options.bundledSkillsDir
    ? path.resolve(options.bundledSkillsDir)
    : resolveMaybePath(readTrimmedEnv(env, "STAR_SANCTUARY_BUNDLED_SKILLS_DIR", "BELLDANDY_BUNDLED_SKILLS_DIR"))
      ?? pickFirstExistingPath(
        [
          runtimeDir ? path.join(runtimeDir, "bundled-skills") : "",
          ...sourceBundledFromModule,
          ...sourceBundledFromCwd,
        ],
        bundledFallback,
      );

  return {
    mode,
    cwd,
    stateDir,
    stateDirSource: options.stateDir ? "process_env" : bootstrap.source,
    ...(bootstrap.bootstrapFilePath ? { stateDirBootstrapFilePath: bootstrap.bootstrapFilePath } : {}),
    envDir,
    envSource: envSelection.source,
    runtimeDir,
    webRoot,
    bundledSkillsDir,
  };
}

export function resolveWorkspaceTemplateDir(
  options: ResolveWorkspaceTemplateDirOptions = {},
): { mode: RuntimeMode; runtimeDir?: string; templatesDir: string } {
  const env = options.env ?? process.env;
  const runtimeDir = resolveMaybePath(
    options.runtimeDir
      ?? readTrimmedEnv(env, "STAR_SANCTUARY_RUNTIME_DIR", "BELLDANDY_RUNTIME_DIR"),
  );
  const mode = resolveRuntimeMode(env, runtimeDir, options.mode);

  if (options.templatesDir) {
    return { mode, runtimeDir, templatesDir: path.resolve(options.templatesDir) };
  }

  const envTemplateDir = resolveMaybePath(
    readTrimmedEnv(env, "STAR_SANCTUARY_TEMPLATES_DIR", "BELLDANDY_TEMPLATES_DIR"),
  );
  if (envTemplateDir) {
    return { mode, runtimeDir, templatesDir: envTemplateDir };
  }

  const candidates: string[] = [];
  if (runtimeDir) {
    candidates.push(path.join(runtimeDir, "templates"));
  }
  if (options.agentModuleUrl) {
    candidates.push(resolveFromModuleUrl(options.agentModuleUrl, "templates"));
    candidates.push(resolveFromModuleUrl(options.agentModuleUrl, "../src/templates"));
    candidates.push(resolveFromModuleUrl(options.agentModuleUrl, "../dist/templates"));
  }

  const fallback = candidates[candidates.length - 1] ?? path.resolve("templates");
  return {
    mode,
    runtimeDir,
    templatesDir: pickFirstExistingPath(candidates, fallback),
  };
}
