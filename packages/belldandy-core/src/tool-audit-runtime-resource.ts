import type { RuntimeResourceQueueSnapshot } from "./runtime-resource-observability.js";

export type ToolAuditRuntimeSnapshotSource = {
  getAuditRuntimeSnapshot(): {
    active: boolean;
    queuedCount: number;
    maxQueueSize: number;
    droppedCount: number;
    disposed: boolean;
  } | undefined;
};

/**
 * 将 Tool 审计旁路映射到通用资源水位，避免 Doctor 接触审计事件正文或错误详情。
 */
export function getToolAuditRuntimeResourceQueueSnapshots(
  source?: ToolAuditRuntimeSnapshotSource,
): RuntimeResourceQueueSnapshot[] {
  const snapshot = source?.getAuditRuntimeSnapshot();
  if (!snapshot || snapshot.disposed) {
    return [];
  }

  return [{
    id: "tool_audit",
    activeCount: snapshot.active ? 1 : 0,
    queuedCount: snapshot.queuedCount,
    capacity: snapshot.maxQueueSize,
    // dropped 表示旁路队列拒绝接收；sink failure 不属于 admission 拒绝，保持在 Skills 层计数。
    rejectedCount: snapshot.droppedCount,
  }];
}
