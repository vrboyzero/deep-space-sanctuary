type ToolAuditContentSummary = {
  bytes: number;
  sha256: string;
};

type ToolAuditLogView = {
  toolName: string;
  success: boolean;
  durationMs: number;
  failureKind?: string;
  errorSummary?: ToolAuditContentSummary;
  /** 只用于兼容旧调用方；格式化时禁止回显。 */
  error?: string;
};

export function shouldDebugToolAuditLog(log: {
  toolName: string;
  safeArguments?: { ackMatched?: boolean } | null;
  arguments?: Record<string, unknown> | null;
}): boolean {
  return log.toolName === "mcp_starweaver_central_agent_wake_notifications"
    && (log.safeArguments?.ackMatched ?? log.arguments?.ackMatched) !== true;
}

export function formatToolAuditLogMessage(log: ToolAuditLogView): string {
  if (log.success) {
    return `${log.toolName} completed in ${log.durationMs}ms`;
  }

  const failureKind = log.failureKind ?? "unknown";
  const errorSummary = log.errorSummary
    ? `; ${log.errorSummary.bytes} bytes; sha256=${log.errorSummary.sha256.slice(0, 12)}`
    : "";
  return `${log.toolName} failed in ${log.durationMs}ms (${failureKind}${errorSummary})`;
}
