import type { BridgeSubtaskKind, BridgeSubtaskSemantics } from "@belldandy/skills";

import type {
  SubTaskBridgeSessionLaunch,
  SubTaskBridgeSessionRuntimeState,
  SubTaskRecord,
} from "./task-runtime.js";

type BridgeSessionCloseReason = NonNullable<SubTaskBridgeSessionRuntimeState["closeReason"]>;

export type SubTaskBridgeView = {
  kind: BridgeSubtaskKind;
  label: string;
  badge: string;
  targetRef?: string;
  summaryLine: string;
};

export type SubTaskBridgeIndex = {
  badge: string;
  kind: BridgeSubtaskKind;
  targetId?: string;
  action?: string;
  targetRef?: string;
  goalId?: string;
  goalNodeId?: string;
};

export type SubTaskBridgeSessionView = {
  label: string;
  badge: string;
  targetRef: string;
  transport: "pty";
  cwd: string;
  commandPreview: string;
  runtimeState: "active" | "closed" | "runtime-lost" | "orphaned";
  closeReason?: BridgeSessionCloseReason;
  artifactPath?: string;
  transcriptPath?: string;
  blockReason?: string;
  summaryLine: string;
};

export type SubTaskBridgeSessionIndex = {
  badge: string;
  targetId: string;
  action: string;
  targetRef: string;
  transport: "pty";
  runtimeState: "active" | "closed" | "runtime-lost" | "orphaned";
  closeReason?: BridgeSessionCloseReason;
  artifactPath?: string;
  transcriptPath?: string;
  blockReason?: string;
};

export type SubTaskBridgeProjection = {
  bridgeSubtaskView: SubTaskBridgeView | null;
  bridgeSubtaskIndex: SubTaskBridgeIndex | null;
  bridgeSessionView: SubTaskBridgeSessionView | null;
  bridgeSessionIndex: SubTaskBridgeSessionIndex | null;
};

type BridgeProjectionRecord = Pick<
  SubTaskRecord,
  "kind" | "launchSpec" | "status" | "sessionId" | "error" | "outputPreview" | "bridgeSessionRuntime"
>;

function normalizeText(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function buildTargetRef(bridgeSubtask: BridgeSubtaskSemantics): string | undefined {
  const targetId = normalizeText(bridgeSubtask.targetId);
  const action = normalizeText(bridgeSubtask.action);
  if (targetId && action) return `${targetId}.${action}`;
  return targetId || action;
}

function buildSummaryLine(
  kind: BridgeSubtaskKind,
  targetRef: string | undefined,
  declaredSummary: string | undefined,
): string {
  const kindLabel = `Bridge ${kind}`;
  if (declaredSummary && targetRef) {
    return `${kindLabel} via ${targetRef}: ${declaredSummary}`;
  }
  if (declaredSummary) {
    return `${kindLabel}: ${declaredSummary}`;
  }
  if (targetRef) {
    return `${kindLabel} via ${targetRef}`;
  }
  return `${kindLabel} subtask`;
}

function buildBridgeSessionTargetRef(launch: SubTaskBridgeSessionLaunch): string {
  return `${launch.targetId}.${launch.action}`;
}

function extractCloseReasonFromOutputPreview(outputPreview: string | undefined): BridgeSessionCloseReason | undefined {
  const normalized = normalizeText(outputPreview);
  if (!normalized) return undefined;
  const match = normalized.match(/Bridge session closed \((manual|idle-timeout|runtime-lost|orphan)\)/i);
  if (!match?.[1]) return undefined;
  const reason = match[1].toLowerCase();
  return reason === "manual" || reason === "idle-timeout" || reason === "runtime-lost" || reason === "orphan"
    ? reason
    : undefined;
}

function extractArtifactPathFromOutputPreview(outputPreview: string | undefined): string | undefined {
  const normalized = normalizeText(outputPreview);
  if (!normalized) return undefined;
  const marker = "Audit artifact:";
  const index = normalized.indexOf(marker);
  if (index < 0) return undefined;
  const path = normalized.slice(index + marker.length).trim();
  return path || undefined;
}

function deriveBridgeSessionRuntime(
  record: BridgeProjectionRecord,
): SubTaskBridgeSessionRuntimeState | undefined {
  if (record.bridgeSessionRuntime) {
    return { ...record.bridgeSessionRuntime };
  }
  if (record.kind !== "bridge_session" || !record.launchSpec.bridgeSession) {
    return undefined;
  }

  const closeReason = extractCloseReasonFromOutputPreview(record.outputPreview);
  const artifactPath = extractArtifactPathFromOutputPreview(record.outputPreview);
  if (/runtime lost/i.test(record.error || "") || /runtime-lost/i.test(record.outputPreview || "")) {
    return {
      state: "runtime-lost",
      closeReason: "runtime-lost",
      ...(artifactPath ? { artifactPath } : {}),
    };
  }
  if (/orphan session/i.test(record.error || "") || /closed \(orphan\)/i.test(record.outputPreview || "")) {
    return {
      state: "orphaned",
      closeReason: "orphan",
      ...(artifactPath ? { artifactPath } : {}),
    };
  }
  if (record.status === "running" && record.sessionId) {
    return {
      state: "active",
    };
  }
  if (record.status === "done" || record.status === "error" || record.status === "timeout"
    || record.status === "stopped" || record.status === "interrupted") {
    return {
      state: "closed",
      ...(closeReason ? { closeReason } : {}),
      ...(artifactPath ? { artifactPath } : {}),
    };
  }
  return undefined;
}

function buildBridgeSessionSummaryLine(
  launch: SubTaskBridgeSessionLaunch,
  runtime: SubTaskBridgeSessionRuntimeState | undefined,
): string {
  const targetRef = buildBridgeSessionTargetRef(launch);
  const declaredSummary = normalizeText(launch.summary);
  const prefix = runtime?.state === "runtime-lost"
    ? "Bridge session runtime-lost"
    : runtime?.state === "orphaned"
      ? "Bridge session orphaned"
    : runtime?.state === "active"
      ? "Bridge session active"
      : runtime?.closeReason
        ? `Bridge session closed (${runtime.closeReason})`
        : "Bridge session";
  if (declaredSummary) {
    return `${prefix} via ${targetRef}: ${declaredSummary}`;
  }
  return `${prefix} via ${targetRef}`;
}

export function getSubTaskBridgeProjection(
  record: BridgeProjectionRecord,
): SubTaskBridgeProjection {
  const bridgeSubtask = record.launchSpec.bridgeSubtask;
  const bridgeSession = record.launchSpec.bridgeSession;
  const bridgeSessionRuntime = deriveBridgeSessionRuntime(record);

  const bridgeSubtaskProjection = !bridgeSubtask
    ? {
        bridgeSubtaskView: null,
        bridgeSubtaskIndex: null,
      }
    : (() => {
        const targetRef = buildTargetRef(bridgeSubtask);
        const summaryLine = buildSummaryLine(
          bridgeSubtask.kind,
          targetRef,
          normalizeText(bridgeSubtask.summary),
        );
        const badge = `bridge/${bridgeSubtask.kind}`;

        return {
          bridgeSubtaskView: {
            kind: bridgeSubtask.kind,
            label: `Bridge ${bridgeSubtask.kind}`,
            badge,
            targetRef,
            summaryLine,
          },
          bridgeSubtaskIndex: {
            badge,
            kind: bridgeSubtask.kind,
            targetId: normalizeText(bridgeSubtask.targetId),
            action: normalizeText(bridgeSubtask.action),
            targetRef,
            goalId: normalizeText(bridgeSubtask.goalId),
            goalNodeId: normalizeText(bridgeSubtask.goalNodeId),
          },
        };
      })();

  const bridgeSessionProjection = !bridgeSession
    ? {
        bridgeSessionView: null,
        bridgeSessionIndex: null,
      }
    : (() => {
        const targetRef = buildBridgeSessionTargetRef(bridgeSession);
        const badge = "bridge/session";
        const runtimeState = bridgeSessionRuntime?.state
          ?? (record.status === "running" ? "active" : "closed");
        return {
          bridgeSessionView: {
            label: "Bridge session",
            badge,
            targetRef,
            transport: bridgeSession.transport,
            cwd: bridgeSession.cwd,
            commandPreview: bridgeSession.commandPreview,
            runtimeState,
            ...(bridgeSessionRuntime?.closeReason ? { closeReason: bridgeSessionRuntime.closeReason } : {}),
            ...(bridgeSessionRuntime?.artifactPath ? { artifactPath: bridgeSessionRuntime.artifactPath } : {}),
            ...(bridgeSessionRuntime?.transcriptPath ? { transcriptPath: bridgeSessionRuntime.transcriptPath } : {}),
            ...(bridgeSessionRuntime?.blockReason ? { blockReason: bridgeSessionRuntime.blockReason } : {}),
            summaryLine: buildBridgeSessionSummaryLine(bridgeSession, bridgeSessionRuntime),
          },
          bridgeSessionIndex: {
            badge,
            targetId: bridgeSession.targetId,
            action: bridgeSession.action,
            targetRef,
            transport: bridgeSession.transport,
            runtimeState,
            ...(bridgeSessionRuntime?.closeReason ? { closeReason: bridgeSessionRuntime.closeReason } : {}),
            ...(bridgeSessionRuntime?.artifactPath ? { artifactPath: bridgeSessionRuntime.artifactPath } : {}),
            ...(bridgeSessionRuntime?.transcriptPath ? { transcriptPath: bridgeSessionRuntime.transcriptPath } : {}),
            ...(bridgeSessionRuntime?.blockReason ? { blockReason: bridgeSessionRuntime.blockReason } : {}),
          },
        };
      })();

  return {
    ...bridgeSubtaskProjection,
    ...bridgeSessionProjection,
  };
}

export function attachSubTaskBridgeProjection<T extends BridgeProjectionRecord>(
  record: T,
): T & SubTaskBridgeProjection {
  return {
    ...record,
    ...getSubTaskBridgeProjection(record),
  };
}
