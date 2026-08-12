import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LspProcessHost,
  LspProcessHostError,
  summarizeLspReadinessTimeline,
  type LspProcessHostOptions,
} from "./lsp-process-host.js";

const fixturePath = fileURLToPath(new URL("./fixtures/fake-lsp-server.mjs", import.meta.url));
const hosts: LspProcessHost[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(hosts.splice(0).map(async (host) => host.dispose()));
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe("LspProcessHost", () => {
  it("hides initialize framing and serves requests through one interface", async () => {
    const host = await createHost();

    await expect(host.request<{ params: { value: number } }>({
      method: "test/echo",
      params: { value: 42 },
      deadlineAtMs: Date.now() + 3_000,
    })).resolves.toEqual({ params: { value: 42 } });

    const state = await host.request<{ initialized: boolean; rootUri: string; clientName: string }>({
      method: "test/state",
      deadlineAtMs: Date.now() + 3_000,
    });
    expect(state).toEqual({
      initialized: true,
      rootUri: expect.stringMatching(/^file:/),
      clientName: "star-sanctuary",
    });
    expect(host.getDiagnostics()).toMatchObject({
      state: "running",
      serverId: "fake-lsp",
      serverVersion: "1.0.0",
      requestCount: 2,
      forcedTerminationCount: 0,
    });
  });

  it("uses an explicit environment instead of inheriting caller secrets", async () => {
    vi.stubEnv("SS_LSP_SECRET_TEST", "must-not-leak");
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: {
          ...minimumPlatformEnvironment(),
          SS_LSP_VISIBLE_TEST: "visible",
        },
      },
    });

    await expect(host.request<Record<string, string | undefined>>({
      method: "test/environment",
      params: { keys: ["SS_LSP_VISIBLE_TEST", "SS_LSP_SECRET_TEST"] },
      deadlineAtMs: Date.now() + 3_000,
    })).resolves.toEqual({ SS_LSP_VISIBLE_TEST: "visible" });
  });

  it("serves only profile-governed workspace, configuration, registration, and progress requests", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        serverRequests: {
          workspaceConfiguration: {
            gopls: {
              buildFlags: ["-tags=integration"],
            },
          },
          dynamicRegistrationMethods: ["workspace/didChangeConfiguration"],
          workDoneProgress: true,
        },
      },
    });

    const response = await host.request<any>({
      method: "test/server-requests",
      deadlineAtMs: Date.now() + 3_000,
    });

    expect(response).toMatchObject({
      workspaceFolders: [{
        uri: expect.stringMatching(/^file:/),
        name: expect.stringMatching(/^ss-lsp-host-/),
      }],
      configuration: [
        { buildFlags: ["-tags=integration"] },
        ["-tags=integration"],
        null,
      ],
      registration: { ok: true, value: null },
      progress: { ok: true, value: null },
      unknown: {
        ok: false,
        code: -32601,
      },
    });
    expect(host.getDiagnostics()).toMatchObject({
      serverRequests: {
        handledCount: 4,
        rejectedCount: 0,
        registeredCapabilityMethods: ["workspace/didChangeConfiguration"],
      },
    });
  });

  it("waits for profile-governed work-done progress before readiness", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        serverRequests: { workDoneProgress: true },
      },
    });

    await host.request({
      method: "test/start-work-done-progress",
      params: { startDelayMs: 25, delayMs: 75 },
      deadlineAtMs: Date.now() + 3_000,
    });
    await host.waitForWorkDoneProgress(Date.now() + 3_000);

    expect(host.getDiagnostics().workDoneProgress).toEqual({
      createdCount: 1,
      begunCount: 1,
      completedCount: 1,
      activeCount: 0,
      peakActiveCount: 1,
    });
  });

  it("does not wait forever for a late progress token and records its timeline", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        serverRequests: { workDoneProgress: true },
      },
    });

    await host.request({
      method: "test/start-work-done-progress",
      params: { startDelayMs: 650, delayMs: 10 },
      deadlineAtMs: Date.now() + 3_000,
    });
    const waitStartedAt = Date.now();
    await host.waitForWorkDoneProgress(Date.now() + 3_000);
    const waitDuration = Date.now() - waitStartedAt;
    expect(waitDuration).toBeGreaterThanOrEqual(450);
    expect(waitDuration).toBeLessThan(650);

    await new Promise((resolve) => setTimeout(resolve, 750));
    const events = host.getDiagnostics().timeline.events;
    const waitCompleted = events.find((event) => event.kind === "work_done_wait_completed");
    const lateCreate = events.find((event) => event.kind === "work_done_progress_created");
    expect(waitCompleted).toBeDefined();
    expect(lateCreate).toBeDefined();
    expect(lateCreate?.sequence).toBeGreaterThan(waitCompleted?.sequence ?? 0);
  });

  it("initializes and serves only the profile-declared workspace folders", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ss-lsp-host-folders-"));
    tempDirs.push(workspaceRoot);
    const appRoot = path.join(workspaceRoot, "app");
    const libraryRoot = path.join(workspaceRoot, "library");
    await Promise.all([mkdir(appRoot), mkdir(libraryRoot)]);
    const host = new LspProcessHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        workspaceFolders: [appRoot, libraryRoot],
      },
      workspaceRoot,
    });
    hosts.push(host);

    const response = await host.request<any>({
      method: "test/server-requests",
      deadlineAtMs: Date.now() + 3_000,
    });

    expect(response.workspaceFolders).toEqual([
      { uri: pathToFileURL(appRoot).href, name: "app" },
      { uri: pathToFileURL(libraryRoot).href, name: "library" },
    ]);
  });

  it("sends only profile-allowlisted client notifications", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        clientNotificationMethods: ["textDocument/didOpen"],
      },
    });
    const documentUri = "file:///workspace/main.go";

    await host.notify({
      method: "textDocument/didOpen",
      params: { textDocument: { uri: documentUri, languageId: "go", version: 1, text: "package main\n" } },
      deadlineAtMs: Date.now() + 3_000,
    });
    await expect(host.request<string[]>({
      method: "test/open-documents",
      deadlineAtMs: Date.now() + 3_000,
    })).resolves.toEqual([documentUri]);
    await expect(host.notify({
      method: "workspace/didChangeWatchedFiles",
      params: { changes: [] },
      deadlineAtMs: Date.now() + 3_000,
    })).rejects.toEqual(expect.objectContaining<LspProcessHostError>({ code: "invalid_request" }));
    expect(host.getDiagnostics()).toMatchObject({ notificationCount: 1 });
  });

  it("records a bounded, redacted readiness timeline with response counts", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        clientNotificationMethods: ["textDocument/didOpen"],
        serverRequests: { workDoneProgress: true },
      },
    });

    await host.notify({
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///workspace/main.go", languageId: "go", version: 1, text: "package main\n" } },
      deadlineAtMs: Date.now() + 3_000,
    });
    await expect(host.request<string[]>({
      method: "test/open-documents",
      deadlineAtMs: Date.now() + 3_000,
    })).resolves.toEqual(["file:///workspace/main.go"]);
    await host.request({
      method: "test/start-work-done-progress",
      params: { startDelayMs: 10, delayMs: 20 },
      deadlineAtMs: Date.now() + 3_000,
    });
    await host.waitForWorkDoneProgress(Date.now() + 3_000);

    const timeline = host.getDiagnostics().timeline;
    expect(timeline.truncated).toBe(false);
    expect(timeline.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "notification_started",
      "notification_sent",
      "request_completed",
      "work_done_progress_created",
      "work_done_progress_begin",
      "work_done_progress_end",
      "work_done_wait_started",
      "work_done_wait_completed",
    ]));
    const didOpen = timeline.events.find((event) => (
      event.kind === "notification_sent" && event.method === "textDocument/didOpen"
    ));
    const firstQuery = timeline.events.find((event) => (
      event.kind === "request_completed" && event.method === "test/open-documents"
    ));
    expect(didOpen?.sequence).toBeLessThan(firstQuery?.sequence ?? 0);
    expect(firstQuery?.resultCount).toBe(1);
    expect(JSON.stringify(timeline)).not.toContain("main.go\n");
    expect(timeline.events.every((event) => Object.keys(event).every((key) => (
      ["sequence", "atMs", "kind", "method", "resultCount", "errorCode", "activeProgressCount"].includes(key)
    )))).toBe(true);
    expect(timeline.events.every((event, index, events) => (
      index === 0
      || (event.sequence > events[index - 1].sequence && event.atMs >= events[index - 1].atMs)
    ))).toBe(true);
  });

  it("summarizes readiness timing without treating late progress as a failure", () => {
    expect(summarizeLspReadinessTimeline({
      events: [
        { sequence: 1, atMs: 1, kind: "notification_started", method: "textDocument/didOpen" },
        { sequence: 2, atMs: 2, kind: "notification_sent", method: "textDocument/didOpen" },
        { sequence: 3, atMs: 3, kind: "readiness_started" },
        { sequence: 4, atMs: 4, kind: "work_done_progress_created", activeProgressCount: 0 },
        { sequence: 5, atMs: 5, kind: "work_done_progress_begin", activeProgressCount: 1 },
        { sequence: 6, atMs: 6, kind: "work_done_progress_end", activeProgressCount: 0 },
        { sequence: 7, atMs: 7, kind: "readiness_completed" },
        { sequence: 8, atMs: 8, kind: "request_started", method: "textDocument/references", activeProgressCount: 0 },
        { sequence: 9, atMs: 9, kind: "request_completed", method: "textDocument/references", resultCount: 4 },
        { sequence: 10, atMs: 10, kind: "work_done_progress_created", activeProgressCount: 0 },
      ],
      truncated: false,
    })).toEqual({
      firstDidOpenStartedSequence: 1,
      firstDidOpenSentSequence: 2,
      readinessStartedSequence: 3,
      readinessCompletedSequence: 7,
      firstProgressCreatedSequence: 4,
      firstProgressCompletedSequence: 6,
      firstReferencesStartedSequence: 8,
      firstReferencesCompletedSequence: 9,
      firstReferencesActiveProgressCount: 0,
      lateProgressCreatedCount: 1,
      referencesAfterReadiness: true,
      didOpenBeforeReadiness: true,
      progressClosedBeforeFirstReferences: true,
      readinessDurationMs: 4,
    });
  });

  it("rejects dynamic capability registration outside the profile allowlist", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath],
        environment: minimumPlatformEnvironment(),
        serverRequests: {
          dynamicRegistrationMethods: ["workspace/didChangeConfiguration"],
          workDoneProgress: true,
        },
      },
    });

    const response = await host.request<any>({
      method: "test/server-requests",
      params: { registrationMethod: "workspace/didChangeWatchedFiles" },
      deadlineAtMs: Date.now() + 3_000,
    });

    expect(response.registration).toMatchObject({
      ok: false,
      code: -32602,
    });
    expect(host.getDiagnostics().serverRequests).toMatchObject({
      rejectedCount: 1,
      registeredCapabilityMethods: [],
    });
  });

  it("cancels a timed-out request and reaps the child process", async () => {
    const host = await createHost();
    const pending = host.request({
      method: "test/hang",
      deadlineAtMs: Date.now() + 100,
    });

    await expect(pending).rejects.toMatchObject({ code: "timeout" });
    await expect(waitFor(() => host.getDiagnostics().state === "stopped")).resolves.toBe(true);
    expect(host.getDiagnostics()).toMatchObject({
      state: "stopped",
      lastFailure: { code: "timeout" },
      forcedTerminationCount: 1,
    });
  });

  it("propagates caller cancellation and reaps the child process", async () => {
    const host = await createHost();
    const controller = new AbortController();
    const pending = host.request({
      method: "test/hang",
      deadlineAtMs: Date.now() + 3_000,
      signal: controller.signal,
    });

    controller.abort(new Error("caller stopped"));

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await expect(waitFor(() => host.getDiagnostics().state === "stopped")).resolves.toBe(true);
    expect(host.getDiagnostics().forcedTerminationCount).toBe(1);
  });

  it("rejects concurrent requests without sending extra LSP traffic", async () => {
    const host = await createHost();
    const controller = new AbortController();
    const pending = host.request({
      method: "test/hang",
      deadlineAtMs: Date.now() + 3_000,
      signal: controller.signal,
    });
    await expect(waitFor(() => host.getDiagnostics().requestCount === 1)).resolves.toBe(true);

    await expect(host.request({
      method: "test/echo",
      params: { shouldNotRun: true },
      deadlineAtMs: Date.now() + 3_000,
    })).rejects.toMatchObject({ code: "busy" });

    expect(host.getDiagnostics()).toMatchObject({
      requestCount: 1,
      concurrency: {
        maxRequests: 1,
        activeRequests: 1,
        peakActiveRequests: 1,
        rejectedCount: 1,
      },
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(host.getDiagnostics().concurrency.activeRequests).toBe(0);
  });

  it("keeps stderr bounded without exposing unbounded child output", async () => {
    const host = await createHost({ stderrMaxBytes: 128 });

    await host.request({
      method: "test/stderr",
      params: { text: "x".repeat(2_048) },
      deadlineAtMs: Date.now() + 3_000,
    });
    await expect(waitFor(() => host.getDiagnostics().stderr.truncatedBytes > 0)).resolves.toBe(true);

    const stderr = host.getDiagnostics().stderr;
    expect(Buffer.byteLength(stderr.text, "utf-8")).toBeLessThanOrEqual(128);
    expect(stderr.truncatedBytes).toBeGreaterThan(0);
  });

  it("rejects an oversized decoded response and reaps the child process", async () => {
    const host = await createHost({ responseMaxBytes: 256 });

    await expect(host.request({
      method: "test/large-response",
      params: { bytes: 2_048 },
      deadlineAtMs: Date.now() + 3_000,
    })).rejects.toMatchObject({ code: "response_too_large" });

    expect(host.getDiagnostics()).toMatchObject({
      state: "stopped",
      lastFailure: { code: "response_too_large" },
      responses: {
        maxBytes: 256,
        peakBytes: expect.any(Number),
        rejectedCount: 1,
      },
    });
    expect(host.getDiagnostics().responses.peakBytes).toBeGreaterThan(256);
  });

  it("classifies a server crash and remains safely disposable", async () => {
    const host = await createHost();

    await expect(host.request({
      method: "test/crash",
      deadlineAtMs: Date.now() + 3_000,
    })).rejects.toMatchObject({ code: "server_crashed" });
    await expect(host.dispose()).resolves.toBeUndefined();
    await expect(host.dispose()).resolves.toBeUndefined();
    expect(host.getDiagnostics()).toMatchObject({
      state: "stopped",
      lastFailure: { code: "server_crashed" },
    });
  });

  it("restarts with a fresh process after a server crash", async () => {
    const host = await createHost();

    await expect(host.request({
      method: "test/crash",
      deadlineAtMs: Date.now() + 3_000,
    })).rejects.toMatchObject({ code: "server_crashed" });
    await expect(host.request<{ params: { recovered: boolean } }>({
      method: "test/echo",
      params: { recovered: true },
      deadlineAtMs: Date.now() + 3_000,
    })).resolves.toEqual({ params: { recovered: true } });

    expect(host.getDiagnostics()).toMatchObject({
      state: "running",
      processStartCount: 2,
      unexpectedExitCount: 1,
    });
    await host.dispose();
    expect(host.getDiagnostics().state).toBe("stopped");
  });

  it("forces and reaps a server that ignores the exit notification", async () => {
    const host = await createHost({
      profile: {
        id: "fake-lsp",
        version: "1.0.0",
        command: process.execPath,
        args: [fixturePath, "--ignore-exit"],
        environment: minimumPlatformEnvironment(),
      },
      shutdownTimeoutMs: 100,
    });
    await host.request({
      method: "test/echo",
      params: { ready: true },
      deadlineAtMs: Date.now() + 3_000,
    });
    const processId = host.getDiagnostics().processId;

    await host.dispose();

    expect(host.getDiagnostics()).toMatchObject({
      state: "stopped",
      forcedTerminationCount: 1,
    });
    expect(processId).toBeTypeOf("number");
    expect(isProcessAlive(processId)).toBe(false);
  });

  it("rejects invalid or already-expired requests without starting a process", async () => {
    const host = await createHost();

    await expect(host.request({ method: "", deadlineAtMs: Date.now() + 3_000 }))
      .rejects.toEqual(expect.objectContaining<LspProcessHostError>({ code: "invalid_request" }));
    await expect(host.request({ method: "test/echo", deadlineAtMs: Date.now() - 1 }))
      .rejects.toEqual(expect.objectContaining<LspProcessHostError>({ code: "timeout" }));
    expect(host.getDiagnostics()).toMatchObject({ state: "idle", processId: undefined });
  });
});

async function createHost(overrides: Partial<LspProcessHostOptions> = {}): Promise<LspProcessHost> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ss-lsp-host-"));
  tempDirs.push(workspaceRoot);
  const host = new LspProcessHost({
    profile: {
      id: "fake-lsp",
      version: "1.0.0",
      command: process.execPath,
      args: [fixturePath],
      environment: minimumPlatformEnvironment(),
    },
    workspaceRoot,
    shutdownTimeoutMs: 500,
    ...overrides,
  });
  hosts.push(host);
  return host;
}

function minimumPlatformEnvironment(): Record<string, string> {
  return Object.fromEntries([
    ["SystemRoot", process.env.SystemRoot],
    ["WINDIR", process.env.WINDIR],
    ["TMP", process.env.TMP],
    ["TEMP", process.env.TEMP],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

function isProcessAlive(processId: number | undefined): boolean {
  if (processId === undefined) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
