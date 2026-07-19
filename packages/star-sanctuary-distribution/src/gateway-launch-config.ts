import {
  ensureDefaultEnvFiles,
  loadRuntimeEnvFiles,
  readTrimmedEnv,
  resolveRuntimeEnvDir,
} from "./env.js";
import { resolveGatewayPortFromEnv } from "./gateway-preflight.js";

export type GatewayLaunchConfig = Readonly<{
  env: NodeJS.ProcessEnv;
  port: number;
}>;

/**
 * 每次 launch 仍重新加载用户配置，但 preflight 与 spawn 共享同一份环境和端口快照。
 */
export function createGatewayLaunchConfig(
  baseEnv: NodeJS.ProcessEnv,
  stateDir: string,
): GatewayLaunchConfig {
  const envDir = resolveRuntimeEnvDir({
    baseEnv,
    fallbackEnvDir: stateDir,
  });
  ensureDefaultEnvFiles(envDir);
  const env = loadRuntimeEnvFiles(baseEnv, envDir);
  env.AUTO_OPEN_BROWSER = readTrimmedEnv(env, "AUTO_OPEN_BROWSER") ?? "true";

  return Object.freeze({
    env,
    port: resolveGatewayPortFromEnv(env),
  });
}
