export function shouldDebugToolAuditLog(log: {
  toolName: string;
  arguments?: Record<string, unknown> | null;
}): boolean {
  return log.toolName === "mcp_starweaver_central_agent_wake_notifications"
    && log.arguments?.ackMatched !== true;
}
