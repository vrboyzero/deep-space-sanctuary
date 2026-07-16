import { loadChannelRouterConfig } from "./config.js";
import { createDisabledRouter, createRuleBasedRouter } from "./engine.js";
import { hasChannelSecurityPolicy, loadChannelSecurityConfigResult, type SecurityBackedChannelKind } from "./security-config.js";
import type { ChannelRouter, ChannelRouterLogger } from "./types.js";

export type CreateChannelRouterOptions = {
  enabled?: boolean;
  configPath?: string;
  securityConfigPath?: string;
  defaultAgentId?: string;
  requiredSecurityChannels?: readonly SecurityBackedChannelKind[];
  logger?: ChannelRouterLogger;
};

export function createChannelRouter(options: CreateChannelRouterOptions = {}): ChannelRouter {
  const securityLoad = loadChannelSecurityConfigResult(options.securityConfigPath, options.logger);
  if (!options.enabled && !hasChannelSecurityPolicy(securityLoad.config) && !options.requiredSecurityChannels?.length) {
    options.logger?.info?.("channel router disabled");
    return createDisabledRouter(options.defaultAgentId);
  }

  const config = options.enabled
    ? loadChannelRouterConfig(options.configPath, options.logger)
    : { version: 1 as const, rules: [] };
  return createRuleBasedRouter(config, {
    defaultAgentId: options.defaultAgentId,
    defaultAllow: true,
    logger: options.logger,
    securityConfig: securityLoad.config,
    securityLoadStatus: securityLoad.status,
    requiredSecurityChannels: options.requiredSecurityChannels,
  });
}

export * from "./types.js";
export * from "./engine.js";
export * from "./config.js";
export * from "./security-config.js";

