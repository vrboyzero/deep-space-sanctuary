import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";

import {
  ErrorCodes,
  ResponseError,
} from "vscode-jsonrpc";
import {
  ExitNotification,
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  createProtocolConnection,
  type InitializeParams,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/node.js";

const DEFAULT_STDERR_MAX_BYTES = 32 * 1024;
const DEFAULT_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000;
const EXIT_REAP_TIMEOUT_MS = 2_000;
const WORK_DONE_PROGRESS_QUIET_MS = 500;
const MAX_TIMELINE_EVENTS = 128;

export type LspProcessHostState = "idle" | "starting" | "running" | "stopping" | "stopped" | "failed";

export type LspProcessHostErrorCode =
  | "invalid_request"
  | "busy"
  | "disposed"
  | "timeout"
  | "cancelled"
  | "spawn_failed"
  | "initialize_failed"
  | "request_failed"
  | "response_too_large"
  | "server_crashed";

export type LspProcessHostTimelineEventKind =
  | "request_started"
  | "request_completed"
  | "request_failed"
  | "notification_started"
  | "notification_sent"
  | "notification_failed"
  | "work_done_progress_created"
  | "work_done_progress_begin"
  | "work_done_progress_end"
  | "work_done_wait_started"
  | "work_done_wait_completed"
  | "readiness_started"
  | "readiness_completed"
  | "readiness_failed";

export interface LspProcessHostTimelineEvent {
  sequence: number;
  atMs: number;
  kind: LspProcessHostTimelineEventKind;
  method?: string;
  resultCount?: number;
  errorCode?: LspProcessHostErrorCode;
  activeProgressCount?: number;
}

export interface LspProcessHostReadinessTimelineSummary {
  firstDidOpenStartedSequence: number | null;
  firstDidOpenSentSequence: number | null;
  readinessStartedSequence: number | null;
  readinessCompletedSequence: number | null;
  firstProgressCreatedSequence: number | null;
  firstProgressCompletedSequence: number | null;
  firstReferencesStartedSequence: number | null;
  firstReferencesCompletedSequence: number | null;
  firstReferencesActiveProgressCount: number | null;
  lateProgressCreatedCount: number;
  referencesAfterReadiness: boolean | null;
  didOpenBeforeReadiness: boolean | null;
  progressClosedBeforeFirstReferences: boolean | null;
  readinessDurationMs: number | null;
}

export function summarizeLspReadinessTimeline(
  timeline: LspProcessHostDiagnostics["timeline"],
): LspProcessHostReadinessTimelineSummary {
  const events = timeline.events;
  const firstDidOpenStartedSequence = events.find(
    (event) => event.kind === "notification_started" && event.method === "textDocument/didOpen",
  )?.sequence ?? null;
  const firstDidOpenSentSequence = events.find(
    (event) => event.kind === "notification_sent" && event.method === "textDocument/didOpen",
  )?.sequence ?? null;
  const readinessStartedSequence = events.find((event) => event.kind === "readiness_started")?.sequence ?? null;
  const readinessCompletedSequence = events.find((event) => event.kind === "readiness_completed")?.sequence ?? null;
  const firstProgressCreatedSequence = events.find(
    (event) => event.kind === "work_done_progress_created",
  )?.sequence ?? null;
  const firstProgressCompletedSequence = events.find(
    (event) => event.kind === "work_done_progress_end",
  )?.sequence ?? null;
  const firstReferencesStartedEvent = events.find(
    (event) => event.kind === "request_started" && event.method === "textDocument/references",
  );
  const firstReferencesStartedSequence = events.find(
    (event) => event.kind === "request_started" && event.method === "textDocument/references",
  )?.sequence ?? null;
  const firstReferencesCompletedSequence = events.find(
    (event) => event.kind === "request_completed" && event.method === "textDocument/references",
  )?.sequence ?? null;
  const lateProgressCreatedCount = readinessCompletedSequence === null
    ? 0
    : events.filter((event) => (
      event.kind === "work_done_progress_created"
      && event.sequence > readinessCompletedSequence
    )).length;
  return {
    firstDidOpenStartedSequence,
    firstDidOpenSentSequence,
    readinessStartedSequence,
    readinessCompletedSequence,
    firstProgressCreatedSequence,
    firstProgressCompletedSequence,
    firstReferencesStartedSequence,
    firstReferencesCompletedSequence,
    firstReferencesActiveProgressCount: firstReferencesStartedEvent?.activeProgressCount ?? null,
    lateProgressCreatedCount,
    referencesAfterReadiness: readinessCompletedSequence === null
      || firstReferencesStartedSequence === null
      ? null
      : firstReferencesStartedSequence > readinessCompletedSequence,
    didOpenBeforeReadiness: firstDidOpenSentSequence === null || readinessStartedSequence === null
      ? null
      : firstDidOpenSentSequence < readinessStartedSequence,
    progressClosedBeforeFirstReferences: firstReferencesStartedSequence === null
      ? null
      : firstProgressCompletedSequence === null
        ? false
        : firstProgressCompletedSequence < firstReferencesStartedSequence,
    readinessDurationMs: readinessStartedSequence === null || readinessCompletedSequence === null
      ? null
      : (() => {
        const started = events.find((event) => event.sequence === readinessStartedSequence);
        const completed = events.find((event) => event.sequence === readinessCompletedSequence);
        return started && completed ? Math.max(0, completed.atMs - started.atMs) : null;
      })(),
  };
}

export interface LspServerProcessProfile {
  id: string;
  version: string;
  command: string;
  args: string[];
  environment: Record<string, string>;
  workspaceFolders?: string[];
  clientNotificationMethods?: string[];
  initializationOptions?: unknown;
  serverRequests?: LspServerRequestPolicy;
}

export interface LspServerRequestPolicy {
  workspaceConfiguration?: Record<string, unknown>;
  dynamicRegistrationMethods?: string[];
  workDoneProgress?: boolean;
}

export interface LspProcessHostOptions {
  profile: LspServerProcessProfile;
  workspaceRoot: string;
  stderrMaxBytes?: number;
  responseMaxBytes?: number;
  shutdownTimeoutMs?: number;
}

export interface LspProcessRequest {
  method: string;
  params?: unknown;
  deadlineAtMs: number;
  signal?: AbortSignal;
}

export type LspProcessNotification = LspProcessRequest;

export interface LspProcessHostDiagnostics {
  state: LspProcessHostState;
  serverId: string;
  serverVersion: string;
  processId?: number;
  processStartCount: number;
  unexpectedExitCount: number;
  requestCount: number;
  notificationCount: number;
  forcedTerminationCount: number;
  stderr: {
    text: string;
    retainedBytes: number;
    truncatedBytes: number;
    totalBytes: number;
  };
  responses: {
    maxBytes: number;
    lastBytes: number;
    peakBytes: number;
    rejectedCount: number;
  };
  concurrency: {
    maxRequests: 1;
    activeRequests: number;
    peakActiveRequests: number;
    rejectedCount: number;
  };
  lastFailure?: {
    code: LspProcessHostErrorCode;
    message: string;
  };
  lastExit?: {
    code: number | null;
    signal: NodeJS.Signals | null;
  };
  serverRequests: {
    handledCount: number;
    rejectedCount: number;
    registeredCapabilityMethods: string[];
  };
  workDoneProgress: {
    createdCount: number;
    begunCount: number;
    completedCount: number;
    activeCount: number;
    peakActiveCount: number;
  };
  timeline: {
    events: LspProcessHostTimelineEvent[];
    truncated: boolean;
  };
}

export class LspProcessHostError extends Error {
  constructor(
    readonly code: LspProcessHostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LspProcessHostError";
  }
}

/**
 * Owns one stdio LSP process. Callers see requests and bounded diagnostics;
 * framing, initialization, cancellation, shutdown, and process reaping stay local.
 */
export class LspProcessHost {
  private readonly profile: LspServerProcessProfile;
  private readonly workspaceRoot: string;
  private readonly workspaceFolders: string[];
  private readonly shutdownTimeoutMs: number;
  private readonly responseMaxBytes: number;
  private readonly stderr: BoundedStderrBuffer;
  private state: LspProcessHostState = "idle";
  private child: ChildProcessWithoutNullStreams | undefined;
  private connection: ProtocolConnection | undefined;
  private exitPromise: Promise<LspProcessHostDiagnostics["lastExit"]> | undefined;
  private resolveExit: ((exit: NonNullable<LspProcessHostDiagnostics["lastExit"]>) => void) | undefined;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private activeRequest = false;
  private disposed = false;
  private requestCount = 0;
  private notificationCount = 0;
  private processStartCount = 0;
  private unexpectedExitCount = 0;
  private forcedTerminationCount = 0;
  private lastResponseBytes = 0;
  private peakResponseBytes = 0;
  private rejectedResponseCount = 0;
  private peakActiveRequestCount = 0;
  private rejectedConcurrentRequestCount = 0;
  private handledServerRequestCount = 0;
  private rejectedServerRequestCount = 0;
  private readonly registeredCapabilityMethods = new Set<string>();
  private readonly outstandingWorkDoneProgressTokens = new Set<string>();
  private readonly activeWorkDoneProgressTokens = new Set<string>();
  private readonly workDoneProgressWaiters = new Set<() => void>();
  private workDoneProgressCreatedCount = 0;
  private workDoneProgressBegunCount = 0;
  private workDoneProgressCompletedCount = 0;
  private peakActiveWorkDoneProgressCount = 0;
  private readonly timelineStartedAtMs = performance.now();
  private timelineSequence = 0;
  private readonly timelineEvents: LspProcessHostTimelineEvent[] = [];
  private timelineTruncated = false;
  private lastFailure: LspProcessHostDiagnostics["lastFailure"];
  private lastExit: LspProcessHostDiagnostics["lastExit"];

  constructor(options: LspProcessHostOptions) {
    validateOptions(options);
    this.profile = {
      ...options.profile,
      args: [...options.profile.args],
      environment: { ...options.profile.environment },
      ...(options.profile.workspaceFolders
        ? { workspaceFolders: [...options.profile.workspaceFolders] }
        : {}),
      ...(options.profile.clientNotificationMethods
        ? { clientNotificationMethods: [...new Set(options.profile.clientNotificationMethods)] }
        : {}),
      ...(options.profile.serverRequests
        ? { serverRequests: cloneServerRequestPolicy(options.profile.serverRequests) }
        : {}),
    };
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.workspaceFolders = normalizeWorkspaceFolders(
      this.workspaceRoot,
      options.profile.workspaceFolders,
    );
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.responseMaxBytes = options.responseMaxBytes ?? DEFAULT_RESPONSE_MAX_BYTES;
    this.stderr = new BoundedStderrBuffer(options.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES);
  }

  async request<Result = unknown>(request: LspProcessRequest): Promise<Result> {
    validateRequest(request);
    if (this.disposed) {
      throw new LspProcessHostError("disposed", "LSP process host has been disposed.");
    }
    if (request.signal?.aborted) {
      throw new LspProcessHostError("cancelled", "LSP request was cancelled by the caller.");
    }
    if (request.deadlineAtMs <= Date.now()) {
      throw new LspProcessHostError("timeout", "LSP request deadline has already elapsed.");
    }
    if (this.activeRequest) {
      this.rejectedConcurrentRequestCount += 1;
      throw new LspProcessHostError("busy", "LSP process host already has an active request.");
    }

    this.activeRequest = true;
    this.peakActiveRequestCount = 1;
    this.recordTimelineEvent({
      kind: "request_started",
      method: request.method,
      activeProgressCount: this.activeWorkDoneProgressTokens.size,
    });
    try {
      await this.ensureRunning(request.deadlineAtMs, request.signal);
      this.requestCount += 1;
      const result = await this.sendRequest<Result>(request);
      this.recordTimelineEvent({
        kind: "request_completed",
        method: request.method,
        ...resultCount(result),
      });
      return result;
    } catch (error) {
      const failure = toHostError(error, "request_failed", "LSP request failed.");
      this.recordTimelineEvent({
        kind: "request_failed",
        method: request.method,
        errorCode: failure.code,
      });
      throw failure;
    } finally {
      this.activeRequest = false;
    }
  }

  async notify(notification: LspProcessNotification): Promise<void> {
    validateRequest(notification);
    if (!this.profile.clientNotificationMethods?.includes(notification.method)) {
      throw new LspProcessHostError("invalid_request", "LSP client notification is not allowed by the profile.");
    }
    if (this.disposed) {
      throw new LspProcessHostError("disposed", "LSP process host has been disposed.");
    }
    if (notification.signal?.aborted) {
      throw new LspProcessHostError("cancelled", "LSP notification was cancelled by the caller.");
    }
    if (notification.deadlineAtMs <= Date.now()) {
      throw new LspProcessHostError("timeout", "LSP notification deadline has already elapsed.");
    }
    if (this.activeRequest) {
      this.rejectedConcurrentRequestCount += 1;
      throw new LspProcessHostError("busy", "LSP process host already has an active request.");
    }

    this.activeRequest = true;
    this.peakActiveRequestCount = 1;
    this.recordTimelineEvent({ kind: "notification_started", method: notification.method });
    try {
      await this.ensureRunning(notification.deadlineAtMs, notification.signal);
      if (notification.signal?.aborted) {
        throw new LspProcessHostError("cancelled", "LSP notification was cancelled by the caller.");
      }
      if (notification.deadlineAtMs <= Date.now()) {
        throw new LspProcessHostError("timeout", "LSP notification exceeded its deadline.");
      }
      const connection = this.connection;
      if (!connection) {
        throw new LspProcessHostError("server_crashed", "LSP server process is not running.");
      }
      await connection.sendNotification(notification.method, notification.params ?? null);
      this.notificationCount += 1;
      this.recordTimelineEvent({ kind: "notification_sent", method: notification.method });
    } catch (error) {
      const failure = toHostError(error, "request_failed", "LSP client notification failed.");
      this.recordFailure(failure);
      this.recordTimelineEvent({
        kind: "notification_failed",
        method: notification.method,
        errorCode: failure.code,
      });
      if (failure.code === "timeout"
        || failure.code === "cancelled"
        || failure.code === "server_crashed") {
        await this.stopImmediately();
      }
      throw failure;
    } finally {
      this.activeRequest = false;
    }
  }

  getDiagnostics(): LspProcessHostDiagnostics {
    return {
      state: this.state,
      serverId: this.profile.id,
      serverVersion: this.profile.version,
      processId: this.child?.pid,
      processStartCount: this.processStartCount,
      unexpectedExitCount: this.unexpectedExitCount,
      requestCount: this.requestCount,
      notificationCount: this.notificationCount,
      forcedTerminationCount: this.forcedTerminationCount,
      stderr: this.stderr.snapshot(),
      responses: {
        maxBytes: this.responseMaxBytes,
        lastBytes: this.lastResponseBytes,
        peakBytes: this.peakResponseBytes,
        rejectedCount: this.rejectedResponseCount,
      },
      concurrency: {
        maxRequests: 1,
        activeRequests: this.activeRequest ? 1 : 0,
        peakActiveRequests: this.peakActiveRequestCount,
        rejectedCount: this.rejectedConcurrentRequestCount,
      },
      serverRequests: {
        handledCount: this.handledServerRequestCount,
        rejectedCount: this.rejectedServerRequestCount,
        registeredCapabilityMethods: [...this.registeredCapabilityMethods].sort(),
      },
      workDoneProgress: {
        createdCount: this.workDoneProgressCreatedCount,
        begunCount: this.workDoneProgressBegunCount,
        completedCount: this.workDoneProgressCompletedCount,
        activeCount: this.activeWorkDoneProgressTokens.size,
        peakActiveCount: this.peakActiveWorkDoneProgressCount,
      },
      timeline: {
        events: this.timelineEvents.map((event) => ({ ...event })),
        truncated: this.timelineTruncated,
      },
      ...(this.lastFailure === undefined ? {} : { lastFailure: { ...this.lastFailure } }),
      ...(this.lastExit === undefined ? {} : { lastExit: { ...this.lastExit } }),
    };
  }

  async waitForWorkDoneProgress(deadlineAtMs: number, signal?: AbortSignal): Promise<void> {
    if (!this.profile.serverRequests?.workDoneProgress) return;
    this.recordTimelineEvent({ kind: "work_done_wait_started" });
    while (true) {
      if (this.disposed) {
        throw new LspProcessHostError("disposed", "LSP process host has been disposed.");
      }
      if (this.outstandingWorkDoneProgressTokens.size > 0) {
        await this.waitForWorkDoneProgressChange(deadlineAtMs, signal);
        continue;
      }
      const createdCount = this.workDoneProgressCreatedCount;
      const changed = await this.waitForWorkDoneProgressChange(
        deadlineAtMs,
        signal,
        WORK_DONE_PROGRESS_QUIET_MS,
      );
      if (!changed
        && this.outstandingWorkDoneProgressTokens.size === 0
        && this.workDoneProgressCreatedCount === createdCount) {
        this.recordTimelineEvent({ kind: "work_done_wait_completed" });
        return;
      }
    }
  }

  recordTimelineMarker(
    kind: Extract<LspProcessHostTimelineEventKind, "readiness_started" | "readiness_completed" | "readiness_failed">,
    errorCode?: LspProcessHostErrorCode,
  ): void {
    this.recordTimelineEvent({ kind, ...(errorCode === undefined ? {} : { errorCode }) });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.stopPromise) {
      await this.stopPromise;
      return;
    }
    this.stopPromise = this.stopGracefully();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }

  private async ensureRunning(deadlineAtMs: number, signal: AbortSignal | undefined): Promise<void> {
    if (this.state === "running" && this.child && this.connection) return;
    if (this.state === "failed") {
      this.cleanupStoppedState();
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.start(deadlineAtMs, signal);
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async start(deadlineAtMs: number, signal: AbortSignal | undefined): Promise<void> {
    this.state = "starting";
    this.lastExit = undefined;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.profile.command, this.profile.args, {
        cwd: this.workspaceRoot,
        env: { ...this.profile.environment },
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.installChildLifecycle(child);
      await waitForSpawn(child);
      this.processStartCount += 1;
      if (this.disposed) {
        await this.stopImmediately();
        return;
      }
    } catch {
      const failure = new LspProcessHostError("spawn_failed", "LSP server process failed to start.");
      this.recordFailure(failure);
      await this.stopImmediately();
      throw failure;
    }

    const connection = createProtocolConnection(child.stdout, createTolerantLspStdin(child));
    this.connection = connection;
    this.installServerRequestHandlers(connection);
    connection.listen();

    try {
      const rootUri = pathToFileURL(this.workspaceRoot).href;
      const initializeParams: InitializeParams = {
        processId: process.pid,
        clientInfo: { name: "star-sanctuary" },
        rootPath: this.workspaceRoot,
        rootUri,
        capabilities: this.buildClientCapabilities(),
        initializationOptions: this.profile.initializationOptions,
        workspaceFolders: this.projectWorkspaceFolders(),
        trace: "off",
      };
      this.recordTimelineEvent({
        kind: "request_started",
        method: InitializeRequest.method,
        activeProgressCount: this.activeWorkDoneProgressTokens.size,
      });
      await this.sendProtocolRequest(
        InitializeRequest.method,
        initializeParams,
        deadlineAtMs,
        signal,
        "initialize_failed",
      );
      this.recordTimelineEvent({
        kind: "request_completed",
        method: InitializeRequest.method,
      });
      connection.sendNotification(InitializedNotification.type, {}).catch(() => undefined);
      this.recordTimelineEvent({ kind: "notification_sent", method: InitializedNotification.method });
      this.state = "running";
    } catch (error) {
      const failure = toHostError(error, "initialize_failed", "LSP server failed to initialize.");
      this.recordFailure(failure);
      this.recordTimelineEvent({
        kind: "request_failed",
        method: InitializeRequest.method,
        errorCode: failure.code,
      });
      await this.stopImmediately();
      throw failure;
    }
  }

  private buildClientCapabilities(): InitializeParams["capabilities"] {
    const policy = this.profile.serverRequests;
    const dynamicRegistrationMethods = new Set(policy?.dynamicRegistrationMethods ?? []);
    return {
      workspace: {
        workspaceFolders: true,
        ...(policy?.workspaceConfiguration ? { configuration: true } : {}),
        ...(dynamicRegistrationMethods.has("workspace/didChangeConfiguration")
          ? { didChangeConfiguration: { dynamicRegistration: true } }
          : {}),
      },
      ...(policy?.workDoneProgress ? { window: { workDoneProgress: true } } : {}),
    };
  }

  private installServerRequestHandlers(connection: ProtocolConnection): void {
    connection.onRequest("workspace/workspaceFolders", () => {
      this.handledServerRequestCount += 1;
      return this.projectWorkspaceFolders();
    });
    connection.onRequest("workspace/configuration", (params: unknown) => (
      this.handleWorkspaceConfigurationRequest(params)
    ));
    connection.onRequest("client/registerCapability", (params: unknown) => (
      this.handleRegisterCapabilityRequest(params)
    ));
    connection.onRequest("window/workDoneProgress/create", (params: unknown) => (
      this.handleWorkDoneProgressCreateRequest(params)
    ));
    connection.onNotification("$/progress", (params: unknown) => {
      this.handleWorkDoneProgressNotification(params);
    });
  }

  private projectWorkspaceFolders(): Array<{ uri: string; name: string }> {
    return this.workspaceFolders.map((folder) => ({
      uri: pathToFileURL(folder).href,
      name: path.basename(folder),
    }));
  }

  private handleWorkspaceConfigurationRequest(params: unknown): unknown[] | ResponseError<void> {
    if (!isObjectRecord(params) || !Array.isArray(params.items)) {
      return this.rejectServerRequest(
        ErrorCodes.InvalidParams,
        "LSP workspace configuration request is invalid.",
      );
    }
    const configuration = this.profile.serverRequests?.workspaceConfiguration ?? {};
    const values: unknown[] = [];
    for (const item of params.items) {
      if (!isObjectRecord(item)
        || (item.section !== undefined && typeof item.section !== "string")
        || (item.scopeUri !== undefined && typeof item.scopeUri !== "string")) {
        return this.rejectServerRequest(
          ErrorCodes.InvalidParams,
          "LSP workspace configuration item is invalid.",
        );
      }
      values.push(resolveConfigurationSection(configuration, item.section));
    }
    this.handledServerRequestCount += 1;
    return values;
  }

  private handleRegisterCapabilityRequest(params: unknown): null | ResponseError<void> {
    if (!isObjectRecord(params) || !Array.isArray(params.registrations)) {
      return this.rejectServerRequest(
        ErrorCodes.InvalidParams,
        "LSP dynamic capability registration request is invalid.",
      );
    }
    const registrations = params.registrations;
    const allowedMethods = new Set(this.profile.serverRequests?.dynamicRegistrationMethods ?? []);
    if (registrations.some((registration) => (
      !isObjectRecord(registration)
      || !isNonEmptyString(registration.id)
      || !isNonEmptyString(registration.method)
      || !allowedMethods.has(registration.method)
    ))) {
      return this.rejectServerRequest(
        ErrorCodes.InvalidParams,
        "LSP dynamic capability registration is outside the host profile allowlist.",
      );
    }
    for (const registration of registrations) {
      this.registeredCapabilityMethods.add(String(registration.method));
    }
    this.handledServerRequestCount += 1;
    return null;
  }

  private handleWorkDoneProgressCreateRequest(params: unknown): null | ResponseError<void> {
    if (!this.profile.serverRequests?.workDoneProgress
      || !isObjectRecord(params)
      || (typeof params.token !== "string" && typeof params.token !== "number")) {
      return this.rejectServerRequest(
        ErrorCodes.InvalidParams,
        "LSP work-done progress request is not enabled or is invalid.",
      );
    }
    const token = workDoneProgressTokenKey(params.token);
    if (this.outstandingWorkDoneProgressTokens.has(token)) {
      return this.rejectServerRequest(
        ErrorCodes.InvalidParams,
        "LSP work-done progress token is already active.",
      );
    }
    this.outstandingWorkDoneProgressTokens.add(token);
    this.workDoneProgressCreatedCount += 1;
    this.recordTimelineEvent({
      kind: "work_done_progress_created",
      activeProgressCount: this.activeWorkDoneProgressTokens.size,
    });
    this.handledServerRequestCount += 1;
    this.resolveWorkDoneProgressWaiters();
    return null;
  }

  private handleWorkDoneProgressNotification(params: unknown): void {
    if (!this.profile.serverRequests?.workDoneProgress
      || !isObjectRecord(params)
      || (typeof params.token !== "string" && typeof params.token !== "number")
      || !isObjectRecord(params.value)
      || typeof params.value.kind !== "string") return;
    const token = workDoneProgressTokenKey(params.token);
    if (!this.outstandingWorkDoneProgressTokens.has(token)) return;
    if (params.value.kind === "begin") {
      if (!this.activeWorkDoneProgressTokens.has(token)) {
        this.activeWorkDoneProgressTokens.add(token);
        this.workDoneProgressBegunCount += 1;
        this.recordTimelineEvent({
          kind: "work_done_progress_begin",
          activeProgressCount: this.activeWorkDoneProgressTokens.size,
        });
        this.peakActiveWorkDoneProgressCount = Math.max(
          this.peakActiveWorkDoneProgressCount,
          this.activeWorkDoneProgressTokens.size,
        );
      }
      return;
    }
    if (params.value.kind !== "end") return;
    this.activeWorkDoneProgressTokens.delete(token);
    this.outstandingWorkDoneProgressTokens.delete(token);
    this.workDoneProgressCompletedCount += 1;
    this.recordTimelineEvent({
      kind: "work_done_progress_end",
      activeProgressCount: this.activeWorkDoneProgressTokens.size,
    });
    if (this.outstandingWorkDoneProgressTokens.size === 0) {
      this.resolveWorkDoneProgressWaiters();
    }
  }

  private waitForWorkDoneProgressChange(
    deadlineAtMs: number,
    signal: AbortSignal | undefined,
    quietTimeoutMs?: number,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const remainingMs = deadlineAtMs - Date.now();
      if (remainingMs <= 0) {
        reject(new LspProcessHostError("timeout", "LSP work-done progress exceeded its deadline."));
        return;
      }
      if (signal?.aborted) {
        reject(new LspProcessHostError("cancelled", "LSP work-done progress was cancelled."));
        return;
      }
      let abortListener: (() => void) | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        this.workDoneProgressWaiters.delete(complete);
        if (signal && abortListener) signal.removeEventListener("abort", abortListener);
      };
      const complete = () => {
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        if (quietTimeoutMs !== undefined) {
          resolve(false);
          return;
        }
        reject(new LspProcessHostError("timeout", "LSP work-done progress exceeded its deadline."));
      }, quietTimeoutMs === undefined ? remainingMs : Math.min(remainingMs, quietTimeoutMs));
      timer.unref?.();
      this.workDoneProgressWaiters.add(complete);
      if (signal) {
        abortListener = () => {
          cleanup();
          reject(new LspProcessHostError("cancelled", "LSP work-done progress was cancelled."));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }
    });
  }

  private resolveWorkDoneProgressWaiters(): void {
    for (const resolve of [...this.workDoneProgressWaiters]) resolve();
  }

  private rejectServerRequest(code: number, message: string): ResponseError<void> {
    this.rejectedServerRequestCount += 1;
    return new ResponseError(code, message);
  }

  private async sendRequest<Result>(request: LspProcessRequest): Promise<Result> {
    try {
      return await this.sendProtocolRequest<Result>(
        request.method,
        request.params,
        request.deadlineAtMs,
        request.signal,
        "request_failed",
      );
    } catch (error) {
      const failure = toHostError(error, "request_failed", "LSP server request failed.");
      this.recordFailure(failure);
      if (failure.code === "timeout"
        || failure.code === "cancelled"
        || failure.code === "response_too_large"
        || failure.code === "server_crashed") {
        await this.stopImmediately();
      }
      throw failure;
    }
  }

  private async sendProtocolRequest<Result>(
    method: string,
    params: unknown,
    deadlineAtMs: number,
    signal: AbortSignal | undefined,
    fallbackCode: LspProcessHostErrorCode,
  ): Promise<Result> {
    const connection = this.connection;
    const exitPromise = this.exitPromise;
    if (!connection || !exitPromise) {
      throw new LspProcessHostError("server_crashed", "LSP server process is not running.");
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const interruption = new Promise<never>((_resolve, reject) => {
      const remainingMs = deadlineAtMs - Date.now();
      if (remainingMs <= 0) {
        reject(new LspProcessHostError("timeout", "LSP request exceeded its deadline."));
        return;
      }
      if (signal?.aborted) {
        reject(new LspProcessHostError("cancelled", "LSP request was cancelled by the caller."));
        return;
      }
      timeoutHandle = setTimeout(() => {
        reject(new LspProcessHostError("timeout", "LSP request exceeded its deadline."));
      }, remainingMs);
      timeoutHandle.unref?.();
      if (signal) {
        abortListener = () => {
          reject(new LspProcessHostError("cancelled", "LSP request was cancelled by the caller."));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }
    });
    const unexpectedExit = exitPromise.then(() => {
      throw new LspProcessHostError("server_crashed", "LSP server exited before completing the request.");
    });

    // Timeout and cancellation are enforced by killing the child process, so no
    // jsonrpc cancellation token is needed. The raced request promise is handled
    // below because its transport can reject after the process dies (write EPIPE
    // on Linux) and must not surface as an unhandled rejection; the race outcomes
    // above are authoritative.
    const protocolRequest = connection.sendRequest<Result>(method, params ?? null);
    protocolRequest.catch(() => undefined);
    try {
      const result = await Promise.race([
        protocolRequest,
        interruption,
        unexpectedExit,
      ]);
      this.recordResponseBytes(result);
      return result;
    } catch (error) {
      throw toHostError(error, fallbackCode, "LSP protocol request failed.");
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    }
  }

  private installChildLifecycle(child: ChildProcessWithoutNullStreams): void {
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    child.stderr.on("data", (chunk: Buffer | string) => this.stderr.push(chunk));
    child.once("exit", (code, signal) => {
      const exit = { code, signal };
      this.lastExit = exit;
      this.resolveExit?.(exit);
      this.resolveExit = undefined;
      if (this.state !== "stopping" && this.state !== "stopped") {
        this.unexpectedExitCount += 1;
        this.state = "failed";
      }
    });
  }

  private async stopGracefully(): Promise<void> {
    if (!this.child) {
      this.cleanupStoppedState();
      return;
    }
    if (!this.connection) {
      this.state = "stopping";
      await this.forceTerminateCurrentChild();
      this.cleanupStoppedState();
      return;
    }
    this.state = "stopping";
    try {
      await withTimeout(
        this.connection.sendRequest(ShutdownRequest.type),
        this.shutdownTimeoutMs,
      );
      this.connection.sendNotification(ExitNotification.type).catch(() => undefined);
      await withTimeout(this.exitPromise ?? Promise.resolve(undefined), this.shutdownTimeoutMs);
    } catch {
      await this.forceTerminateCurrentChild();
    } finally {
      this.cleanupStoppedState();
    }
  }

  private async stopImmediately(): Promise<void> {
    if (!this.child) {
      this.cleanupStoppedState();
      return;
    }
    this.state = "stopping";
    await this.forceTerminateCurrentChild();
    this.cleanupStoppedState();
  }

  private async forceTerminateCurrentChild(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    this.forcedTerminationCount += 1;
    await forceTerminateProcessTree(child);
    await withTimeout(this.exitPromise ?? Promise.resolve(undefined), EXIT_REAP_TIMEOUT_MS).catch(() => undefined);
  }

  private cleanupStoppedState(): void {
    try {
      this.connection?.dispose();
    } catch {
      // The process may already have closed the transport.
    }
    this.connection = undefined;
    this.child = undefined;
    this.exitPromise = undefined;
    this.resolveExit = undefined;
    this.outstandingWorkDoneProgressTokens.clear();
    this.activeWorkDoneProgressTokens.clear();
    this.resolveWorkDoneProgressWaiters();
    this.state = "stopped";
  }

  private recordFailure(error: LspProcessHostError): void {
    this.lastFailure = { code: error.code, message: error.message };
  }

  private recordResponseBytes(response: unknown): void {
    const serialized = JSON.stringify(response) ?? "null";
    const bytes = Buffer.byteLength(serialized, "utf-8");
    this.lastResponseBytes = bytes;
    this.peakResponseBytes = Math.max(this.peakResponseBytes, bytes);
    if (bytes > this.responseMaxBytes) {
      this.rejectedResponseCount += 1;
      throw new LspProcessHostError(
        "response_too_large",
        "LSP server response exceeded the configured byte limit.",
      );
    }
  }

  private recordTimelineEvent(event: Omit<LspProcessHostTimelineEvent, "sequence" | "atMs">): void {
    const entry: LspProcessHostTimelineEvent = {
      sequence: ++this.timelineSequence,
      atMs: Math.max(0, Math.round(performance.now() - this.timelineStartedAtMs)),
      ...event,
    };
    if (this.timelineEvents.length >= MAX_TIMELINE_EVENTS) {
      this.timelineEvents.shift();
      this.timelineTruncated = true;
    }
    this.timelineEvents.push(entry);
  }
}

class BoundedStderrBuffer {
  private readonly chunks: Buffer[] = [];
  private retainedBytes = 0;
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer | string): void {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
    this.totalBytes += value.byteLength;
    const remaining = this.maxBytes - this.retainedBytes;
    if (remaining <= 0) return;
    const retained = value.subarray(0, remaining);
    this.chunks.push(Buffer.from(retained));
    this.retainedBytes += retained.byteLength;
  }

  snapshot(): LspProcessHostDiagnostics["stderr"] {
    return {
      text: Buffer.concat(this.chunks, this.retainedBytes).toString("utf-8"),
      retainedBytes: this.retainedBytes,
      truncatedBytes: this.totalBytes - this.retainedBytes,
      totalBytes: this.totalBytes,
    };
  }
}

function validateOptions(options: LspProcessHostOptions): void {
  if (!options || typeof options !== "object"
    || !isNonEmptyString(options.profile?.id)
    || !isNonEmptyString(options.profile?.version)
    || !path.isAbsolute(options.profile?.command ?? "")
    || !Array.isArray(options.profile?.args)
    || options.profile.args.some((arg) => typeof arg !== "string")
    || !isStringRecord(options.profile?.environment)
    || !isWorkspaceFolderList(options.workspaceRoot, options.profile?.workspaceFolders)
    || !isMethodList(options.profile?.clientNotificationMethods)
    || !isServerRequestPolicy(options.profile?.serverRequests)
    || !path.isAbsolute(options.workspaceRoot)) {
    throw new LspProcessHostError("invalid_request", "LSP process host options are invalid.");
  }
  if (options.stderrMaxBytes !== undefined
    && (!Number.isSafeInteger(options.stderrMaxBytes) || options.stderrMaxBytes < 1)) {
    throw new LspProcessHostError("invalid_request", "LSP stderrMaxBytes must be a positive integer.");
  }
  if (options.responseMaxBytes !== undefined
    && (!Number.isSafeInteger(options.responseMaxBytes) || options.responseMaxBytes < 1)) {
    throw new LspProcessHostError("invalid_request", "LSP responseMaxBytes must be a positive integer.");
  }
  if (options.shutdownTimeoutMs !== undefined
    && (!Number.isSafeInteger(options.shutdownTimeoutMs) || options.shutdownTimeoutMs < 1)) {
    throw new LspProcessHostError("invalid_request", "LSP shutdownTimeoutMs must be a positive integer.");
  }
}

function isMethodList(value: unknown): value is string[] | undefined {
  return value === undefined
    || (Array.isArray(value)
      && value.length > 0
      && value.length <= 64
      && value.every(isNonEmptyString));
}

function normalizeWorkspaceFolders(workspaceRoot: string, folders: string[] | undefined): string[] {
  const values = folders ?? [workspaceRoot];
  return [...new Map(values.map((folder) => {
    const resolved = path.resolve(folder);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    return [key, resolved];
  })).values()];
}

function isWorkspaceFolderList(workspaceRoot: string, value: unknown): value is string[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  return value.every((folder) => typeof folder === "string"
    && path.isAbsolute(folder)
    && isPathInside(workspaceRoot, folder));
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function cloneServerRequestPolicy(policy: LspServerRequestPolicy): LspServerRequestPolicy {
  return {
    ...(policy.workspaceConfiguration
      ? { workspaceConfiguration: structuredClone(policy.workspaceConfiguration) }
      : {}),
    ...(policy.dynamicRegistrationMethods
      ? { dynamicRegistrationMethods: [...new Set(policy.dynamicRegistrationMethods)] }
      : {}),
    ...(policy.workDoneProgress === undefined ? {} : { workDoneProgress: policy.workDoneProgress }),
  };
}

function isServerRequestPolicy(value: unknown): value is LspServerRequestPolicy | undefined {
  if (value === undefined) return true;
  return isObjectRecord(value)
    && (value.workspaceConfiguration === undefined || isObjectRecord(value.workspaceConfiguration))
    && (value.dynamicRegistrationMethods === undefined
      || (Array.isArray(value.dynamicRegistrationMethods)
        && value.dynamicRegistrationMethods.every(isNonEmptyString)))
    && (value.workDoneProgress === undefined || typeof value.workDoneProgress === "boolean");
}

function workDoneProgressTokenKey(token: string | number): string {
  return `${typeof token}:${String(token)}`;
}

function resultCount(result: unknown): { resultCount?: number } {
  if (Array.isArray(result)) return { resultCount: result.length };
  if (isObjectRecord(result) && Array.isArray(result.items)) {
    return { resultCount: result.items.length };
  }
  return {};
}

function resolveConfigurationSection(
  configuration: Record<string, unknown>,
  section: unknown,
): unknown {
  if (typeof section !== "string" || !section.trim()) {
    return structuredClone(configuration);
  }
  let current: unknown = configuration;
  for (const segment of section.split(".")) {
    if (!segment || !isObjectRecord(current) || !Object.hasOwn(current, segment)) {
      return null;
    }
    current = current[segment];
  }
  return current === undefined ? null : structuredClone(current);
}

function validateRequest(request: LspProcessRequest): void {
  if (!request || typeof request !== "object"
    || !isNonEmptyString(request.method)
    || !Number.isFinite(request.deadlineAtMs)) {
    throw new LspProcessHostError("invalid_request", "LSP process request is invalid.");
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null
    && typeof value === "object"
    && Object.entries(value).every(([key, entry]) => isNonEmptyString(key) && typeof entry === "string");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toHostError(
  error: unknown,
  fallbackCode: LspProcessHostErrorCode,
  fallbackMessage: string,
): LspProcessHostError {
  if (error instanceof LspProcessHostError) return error;
  return new LspProcessHostError(fallbackCode, fallbackMessage);
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

/**
 * Wraps the LSP child stdin so a late transport failure can never surface as an
 * unhandled rejection. vscode-jsonrpc's sendRequest runs inside an async promise
 * executor whose rejection is discarded when a write fails, so a frame written
 * while the child is being terminated (write EPIPE on Linux) would escape every
 * caller-level catch. Frames addressed to a child that is already gone are
 * dropped here; the request outcome is decided by the host's timeout /
 * cancellation / exit races instead, and non-EPIPE write errors still propagate
 * through the wrapper stream.
 */
export function createTolerantLspStdin(child: ChildProcessWithoutNullStreams): Writable {
  // The underlying stream's own "error" event must never fire unhandled.
  child.stdin.on("error", () => undefined);
  return new Writable({
    write(chunk, _encoding, callback) {
      if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) {
        callback();
        return;
      }
      child.stdin.write(chunk, (error) => {
        const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
        callback(error === null || error === undefined || code === "EPIPE" ? undefined : error);
      });
    },
  });
}

async function forceTerminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const taskkill = systemRoot
      ? path.join(systemRoot, "System32", "taskkill.exe")
      : "taskkill.exe";
    try {
      await waitForChild(spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      }));
      return;
    } catch {
      child.kill("SIGKILL");
      return;
    }
  }

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function waitForChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process terminator exited with code ${String(code)}.`));
    });
  });
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error("Operation timed out.")), timeoutMs);
    handle.unref?.();
    operation.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
}
