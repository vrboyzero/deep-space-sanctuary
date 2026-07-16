import { generateBootstrapAuthToken } from "@star-sanctuary/distribution";

export type GatewayAuthMode = "none" | "token" | "password";

export interface ResolveLauncherSetupAuthParams {
  authMode: GatewayAuthMode;
  authToken?: string;
  autoOpenBrowser: boolean;
  setupToken?: string;
  generateSetupToken?: () => string;
}

export interface ResolveLauncherSetupAuthResult {
  authToken?: string;
  setupToken?: string;
}

export function resolveLauncherSetupAuth(
  params: ResolveLauncherSetupAuthParams,
): ResolveLauncherSetupAuthResult {
  if (params.authMode !== "token") {
    return { authToken: params.authToken };
  }

  const authToken = params.authToken?.trim();
  if (authToken) {
    return {
      authToken,
      setupToken: params.autoOpenBrowser ? authToken : undefined,
    };
  }

  if (!params.autoOpenBrowser) {
    return {};
  }

  const setupToken = params.setupToken?.trim() || (params.generateSetupToken ?? generateBootstrapAuthToken)();
  return {
    authToken: setupToken,
    setupToken,
  };
}

export function buildAutoOpenTargetUrl(params: {
  host: string;
  port: number;
  authMode: GatewayAuthMode;
  setupToken?: string;
}): string {
  const openUrlHost = (params.host === "0.0.0.0" || params.host === "::") ? "localhost" : params.host;
  const tokenQuery = params.authMode === "token" && params.setupToken ? `?token=${params.setupToken}` : "";
  return `http://${openUrlHost}:${params.port}/${tokenQuery}`;
}
