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
  if (adapter) {
    adapter.info(module, message, data);
  } else {
    console.log(`[${module}] ${message}`, data ?? "");
  }
}

export function mcpDebug(module: string, message: string, data?: unknown): void {
  if (adapter?.debug) {
    adapter.debug(module, message, data);
  } else {
    console.debug(`[${module}] ${message}`, data ?? "");
  }
}

export function mcpWarn(module: string, message: string, data?: unknown): void {
  if (adapter) {
    adapter.warn(module, message, data);
  } else {
    console.warn(`[${module}] ${message}`, data ?? "");
  }
}

export function mcpError(module: string, message: string, data?: unknown): void {
  if (adapter) {
    adapter.error(module, message, data);
  } else {
    console.error(`[${module}] ${message}`, data ?? "");
  }
}
