import type { BridgeSubtaskSemantics } from "../../types.js";

export const BRIDGE_CONFIG_FILE_NAME = "agent-bridge.json";
export const BRIDGE_ARTIFACTS_DIR = "generated/agent-bridge";

export type BridgeCategory = "agent-cli" | "ide-cli" | "mcp";
export type BridgeTransport = "exec" | "pty" | "acp-stdio" | "mcp";
export type BridgeSessionMode = "oneshot" | "persistent";
export type BridgeCwdPolicy = "workspace-only" | "target-default";

export type BridgeActionConfig = {
  template: string[];
  allowStructuredArgs?: string[];
  description?: string;
  mcpToolName?: string;
  firstTurnStrategy?: "start-args-prompt" | "write";
  firstTurnHint?: string;
  recommendedReadWaitMs?: number;
  startupReadWaitMs?: number;
  startupReadyText?: string;
  startupReadyWaitMs?: number;
  startupSequence?: Array<{
    data: string;
    waitMs?: number;
  }>;
};

export type BridgeTargetConfig = {
  id: string;
  category: BridgeCategory;
  transport: BridgeTransport;
  enabled: boolean;
  entry: {
    binary?: string;
    env?: Record<string, string>;
    mcp?: {
      serverId: string;
      toolName: string;
    };
  };
  cwdPolicy: BridgeCwdPolicy;
  sessionMode: BridgeSessionMode;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  idleTimeoutMs?: number;
  defaultCwd?: string;
  actions: Record<string, BridgeActionConfig>;
};

export type BridgeConfig = {
  version: string;
  workspaceRoots?: string[];
  extraWorkspaceRoots?: string[];
  targets: BridgeTargetConfig[];
};

export type BridgeTargetListItem = {
  id: string;
  category: BridgeCategory;
  transport: BridgeTransport;
  enabled: boolean;
  sessionMode: BridgeSessionMode;
  cwdPolicy: BridgeCwdPolicy;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  idleTimeoutMs?: number;
  actions: Array<{
    name: string;
    description?: string;
    allowStructuredArgs: string[];
    mcpToolName?: string;
    firstTurnStrategy?: "start-args-prompt" | "write";
    firstTurnHint?: string;
    recommendedReadWaitMs?: number;
  }>;
};

export type BridgeRunParsedProcessResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorSummary?: string;
};

export type BridgeRunArtifactSummary = {
  version: 1;
  runId: string;
  targetId: string;
  action: string;
  bridgeSubtask?: BridgeSubtaskSemantics;
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  cwd: string;
  commandPreview: string;
  durationMs: number;
  createdAt: string;
  stdout: {
    bytes: number;
    truncated: boolean;
    path?: string;
  };
  stderr: {
    bytes: number;
    truncated: boolean;
    path?: string;
  };
  errorSummary?: string;
};

export type BridgeSessionTranscriptEvent = {
  timestamp: number;
  direction: "input" | "output" | "system";
  content: string;
  bytes: number;
  truncated: boolean;
};

export type BridgeSessionArtifactSummary = {
  version: 1;
  sessionId: string;
  targetId: string;
  action: string;
  transport: "pty";
  cwd: string;
  commandPreview: string;
  status: BridgeSessionStatus;
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  eventCount: number;
  inputEventCount: number;
  outputEventCount: number;
  inputBytes: number;
  outputBytes: number;
  transcriptPath?: string;
};

export type BridgeSessionStatus = "active" | "closed";

export type BridgeSessionRecord = {
  id: string;
  runtimeSessionId: string;
  targetId: string;
  action: string;
  transport: "pty";
  taskId?: string;
  workspaceRoot: string;
  cwd: string;
  commandPreview: string;
  cols: number;
  rows: number;
  firstTurnStrategy?: BridgeActionConfig["firstTurnStrategy"];
  firstTurnHint?: string;
  recommendedReadWaitMs?: number;
  firstTurnPromptProvided?: boolean;
  firstTurnWriteObservedAt?: number;
  idleTimeoutMs?: number;
  idleDeadlineAt?: number;
  createdAt: number;
  updatedAt: number;
  status: BridgeSessionStatus;
  closedAt?: number;
  closeReason?: "manual" | "idle-timeout" | "runtime-lost" | "orphan";
  artifactPath?: string;
  transcriptPath?: string;
};
