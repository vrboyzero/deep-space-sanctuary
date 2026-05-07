import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type StateDirBootstrapSource = "process_env" | "bootstrap_env" | "default_home";

export type StateDirBootstrapInfo = {
  env: NodeJS.ProcessEnv;
  source: StateDirBootstrapSource;
  bootstrapFilePath?: string;
};

const STATE_DIR_BOOTSTRAP_ALLOWED_KEYS = new Set([
  "BELLDANDY_STATE_DIR",
  "BELLDANDY_STATE_DIR_WINDOWS",
  "BELLDANDY_STATE_DIR_WSL",
]);

function hasExplicitStateDirEnv(env: NodeJS.ProcessEnv): boolean {
  return [...STATE_DIR_BOOTSTRAP_ALLOWED_KEYS].some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function loadAllowedEnvFileInto(
  targetEnv: NodeJS.ProcessEnv,
  filePath: string,
  protectedKeys?: ReadonlySet<string>,
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
    if (!key || !STATE_DIR_BOOTSTRAP_ALLOWED_KEYS.has(key)) continue;
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

export function resolveStateDirBootstrapEnvPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".star_sanctuary-bootstrap", ".env.local");
}

export function loadStateDirBootstrapInfo(
  baseEnv: NodeJS.ProcessEnv,
  options: { homeDir?: string } = {},
): StateDirBootstrapInfo {
  if (hasExplicitStateDirEnv(baseEnv)) {
    return {
      env: { ...baseEnv },
      source: "process_env",
    };
  }

  const bootstrapFilePath = resolveStateDirBootstrapEnvPath(options.homeDir);
  const env = { ...baseEnv };
  loadAllowedEnvFileInto(env, bootstrapFilePath, new Set(Object.keys(baseEnv)));

  if (hasExplicitStateDirEnv(env)) {
    return {
      env,
      source: "bootstrap_env",
      bootstrapFilePath,
    };
  }

  return {
    env,
    source: "default_home",
    bootstrapFilePath,
  };
}
