import { redactSensitiveText, redactSensitiveValue } from "@belldandy/protocol";

/**
 * MCP 日志适配器
 *
 * 支持外部注入 logger，未注入时回退到 console。
 * 便于 belldandy-core 传入统一 Logger 实现日志聚合。
 */

export type MCPLogAdapter = {
  debug?(module: string, message: string, data?: unknown): void;
  info(module: string, message: string, data?: unknown): void;
  warn(module: string, message: string, data?: unknown): void;
  error(module: string, message: string, data?: unknown): void;
};

let adapter: MCPLogAdapter | null = null;

export function setMCPLogger(logger: MCPLogAdapter): void {
  adapter = logger;
}

export function mcpLog(module: string, message: string, data?: unknown): void {
  const safeMessage = redactSensitiveText(message);
  const safeData = data === undefined ? undefined : redactSensitiveValue(data);
  if (adapter) {
    adapter.info(module, safeMessage, safeData);
  } else {
    console.log(`[${module}] ${safeMessage}`, safeData ?? "");
  }
}

export function mcpDebug(module: string, message: string, data?: unknown): void {
  const safeMessage = redactSensitiveText(message);
  const safeData = data === undefined ? undefined : redactSensitiveValue(data);
  if (adapter?.debug) {
    adapter.debug(module, safeMessage, safeData);
  } else {
    console.debug(`[${module}] ${safeMessage}`, safeData ?? "");
  }
}

export function mcpWarn(module: string, message: string, data?: unknown): void {
  const safeMessage = redactSensitiveText(message);
  const safeData = data === undefined ? undefined : redactSensitiveValue(data);
  if (adapter) {
    adapter.warn(module, safeMessage, safeData);
  } else {
    console.warn(`[${module}] ${safeMessage}`, safeData ?? "");
  }
}

export function mcpError(module: string, message: string, data?: unknown): void {
  const safeMessage = redactSensitiveText(message);
  const safeData = data === undefined ? undefined : redactSensitiveValue(data);
  if (adapter) {
    adapter.error(module, safeMessage, safeData);
  } else {
    console.error(`[${module}] ${safeMessage}`, safeData ?? "");
  }
}
