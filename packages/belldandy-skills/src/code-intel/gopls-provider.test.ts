import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodeIntel } from "./code-intel.js";
import {
  createGoplsProcessProfile,
  PINNED_GOPLS_VERSION,
} from "./gopls-profile.js";
import {
  GoplsCodeIntelProvider,
  type GoplsCodeIntelHost,
  type GoplsCodeIntelHostFactory,
} from "./gopls-provider.js";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GoplsCodeIntelProvider", () => {
  it("satisfies the public CodeIntel query, cursor, provenance, and async disposal contract", async () => {
    const fixture = await createFixture();
    const symbols = [0, 1].map((line) => ({
      name: `symbol-${line}`,
      kind: 12,
      location: {
        uri: pathToFileURL(path.join(fixture.workspace, "main.go")).href,
        range: { start: { line, character: 0 }, end: { line, character: 1 } },
      },
    }));
    const host = new FakeHost({ "workspace/symbol": symbols });
    const provider = createProvider(fixture, host);
    const codeIntel = new CodeIntel({ providers: [provider], now: () => 1_000 });
    const request = {
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols" as const,
      query: "symbol",
      requiredCapability: "semantic-live" as const,
      deadlineAtMs: 2_000,
      limit: 1,
    };

    const first = await codeIntel.query(request);
    expect(host.events.slice(0, 3)).toEqual([
      "notify:textDocument/didOpen",
      "wait:workspaceReady",
      "request:workspace/symbol",
    ]);
    expect(first).toMatchObject({
      ok: true,
      result: {
        status: "partial",
        items: [{ location: { scope: "workspace", path: "main.go" }, symbolKind: "function" }],
        page: { returned: 1, truncated: true, nextCursor: expect.any(String) },
        provenance: {
          providerId: "gopls",
          providerVersion: PINNED_GOPLS_VERSION,
          capability: "semantic-live",
          workspaceRevision: "revision-1",
          observedAtMs: 1_000,
        },
      },
    });
    if (!first.ok || !first.result.page.nextCursor) {
      throw new Error("Expected a public continuation cursor.");
    }

    const second = await codeIntel.query({ ...request, cursor: first.result.page.nextCursor });
    expect(second).toMatchObject({
      ok: true,
      result: { status: "completed", page: { returned: 1, truncated: false } },
    });

    await codeIntel.disposeAsync();
    expect(host.disposeCalls).toBe(1);
  });

  it("maps workspace and allowlisted external LSP symbols into the public evidence contract", async () => {
    const fixture = await createFixture();
    const externalRoot = path.join(fixture.root, "external");
    await mkdir(externalRoot, { recursive: true });
    await writeFile(path.join(externalRoot, "dependency.go"), "package dependency\n\nfunc External() {}\n", "utf8");
    const host = new FakeHost({
      "workspace/symbol": [
        {
          name: "Hello",
          kind: 12,
          location: {
            uri: pathToFileURL(path.join(fixture.workspace, "main.go")).href,
            range: { start: { line: 2, character: 5 }, end: { line: 2, character: 10 } },
          },
        },
        {
          name: "External",
          kind: 12,
          location: {
            uri: pathToFileURL(path.join(externalRoot, "dependency.go")).href,
            range: { start: { line: 2, character: 5 }, end: { line: 2, character: 13 } },
          },
        },
        {
          name: "Blocked",
          kind: 12,
          location: {
            uri: pathToFileURL(path.join(fixture.root, "blocked.go")).href,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          },
        },
      ],
    });
    const provider = createProvider(
      fixture,
      host,
      undefined,
      undefined,
      [externalRoot],
    );

    const result = await provider.query({
      workspace: {
        rootPath: fixture.workspace,
        revision: "revision-1",
        externalRoots: [externalRoot],
      },
      operation: "symbols",
      query: "Hello",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
      limit: 10,
    }, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: "partial",
      capability: "semantic-live",
      freshness: { status: "fresh" },
      items: [
        {
          location: {
            scope: "workspace",
            path: "main.go",
            range: {
              start: { line: 2, column: 5 },
              end: { line: 2, column: 10 },
            },
          },
          symbolKind: "function",
          documentRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        {
          location: {
            scope: "external",
            path: path.join(externalRoot, "dependency.go"),
          },
          symbolKind: "function",
          documentRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      ],
      diagnostics: [
        { code: "external_location_not_allowed", message: expect.any(String) },
      ],
    });
    expect(host.requests[0]).toMatchObject({
      method: "workspace/symbol",
      params: { query: "Hello" },
    });
  });

  it("maps all location operations with stable LSP request payloads", async () => {
    const fixture = await createFixture();
    const uri = pathToFileURL(path.join(fixture.workspace, "main.go")).href;
    const location = {
      uri,
      range: { start: { line: 2, character: 5 }, end: { line: 2, character: 10 } },
    };
    const host = new FakeHost({
      "textDocument/definition": [location],
      "textDocument/references": [location],
      "textDocument/implementation": [location],
    });
    const provider = createProvider(fixture, host);
    const base = {
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      requiredCapability: "semantic-live" as const,
      deadlineAtMs: Date.now() + 3_000,
      location: { path: "main.go", line: 2, column: 5 },
    };

    for (const operation of ["definition", "references", "implementation"] as const) {
      const result = await provider.query({ ...base, operation }, { signal: new AbortController().signal });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        location: { path: "main.go", scope: "workspace" },
        symbolKind: "unknown",
      });
    }

    expect(host.requests.map((request) => request.method)).toEqual([
      "textDocument/definition",
      "textDocument/references",
      "textDocument/implementation",
    ]);
    expect(host.requests[1].params).toMatchObject({
      textDocument: { uri },
      position: { line: 2, character: 5 },
      context: { includeDeclaration: true },
    });
    expect(host.notifications).toHaveLength(1);
    expect(host.notifications[0]).toMatchObject({
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId: "go", version: 1 } },
    });
  });

  it("applies the profile response byte limit to each Host", async () => {
    const fixture = await createFixture();
    const host = new FakeHost({ "workspace/symbol": [] });
    let responseMaxBytes: number | undefined;
    const provider = createProvider(fixture, undefined, (input) => {
      responseMaxBytes = input.responseMaxBytes;
      return host;
    });

    await provider.query({
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols",
      query: "Hello",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
    }, { signal: new AbortController().signal });

    expect(responseMaxBytes).toBe(4 * 1024 * 1024);
  });

  it("waits for asynchronous Host admission before sending LSP traffic", async () => {
    const fixture = await createFixture();
    const host = new FakeHost({ "workspace/symbol": [] });
    let admitHost: (() => void) | undefined;
    const admission = new Promise<void>((resolve) => {
      admitHost = resolve;
    });
    const provider = createProvider(fixture, undefined, async () => {
      await admission;
      return host;
    });

    const query = provider.query({
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols",
      query: "Hello",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
    }, { signal: new AbortController().signal });
    await Promise.resolve();

    expect(host.notifications).toHaveLength(0);
    expect(host.requests).toHaveLength(0);
    admitHost?.();
    await expect(query).resolves.toMatchObject({ items: [] });
  });

  it("requires both Provider and request allowlists for external evidence", async () => {
    const fixture = await createFixture();
    const externalRoot = path.join(fixture.root, "external");
    const externalFile = path.join(externalRoot, "dependency.go");
    await mkdir(externalRoot, { recursive: true });
    await writeFile(externalFile, "package dependency\n\nfunc External() {}\n", "utf8");
    const host = new FakeHost({
      "workspace/symbol": [{
        name: "External",
        kind: 12,
        location: {
          uri: pathToFileURL(externalFile).href,
          range: { start: { line: 2, character: 5 }, end: { line: 2, character: 13 } },
        },
      }],
    });
    const provider = createProvider(fixture, host);

    const result = await provider.query({
      workspace: {
        rootPath: fixture.workspace,
        revision: "revision-1",
        externalRoots: [externalRoot],
      },
      operation: "symbols",
      query: "External",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
    }, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: "partial",
      items: [],
      diagnostics: [{
        code: "profile_external_location_not_allowed",
        message: expect.any(String),
      }],
    });
  });

  it("paginates bounded results and rebuilds the process when the workspace revision changes", async () => {
    const fixture = await createFixture();
    const symbols = [0, 1, 2].map((line) => ({
      name: `symbol-${line}`,
      kind: 12,
      location: {
        uri: pathToFileURL(path.join(fixture.workspace, "main.go")).href,
        range: { start: { line, character: 0 }, end: { line, character: 1 } },
      },
    }));
    const hosts: FakeHost[] = [];
    const provider = createProvider(fixture, undefined, (profile) => {
      const host = new FakeHost({ "workspace/symbol": symbols });
      hosts.push(host);
      return host;
    });

    const request = {
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols" as const,
      query: "symbol",
      requiredCapability: "semantic-live" as const,
      deadlineAtMs: Date.now() + 3_000,
      limit: 2,
    };
    const first = await provider.query(request, { signal: new AbortController().signal });
    const second = await provider.query({ ...request, cursor: first.nextCursor }, { signal: new AbortController().signal });
    await provider.query({ ...request, workspace: { ...request.workspace, revision: "revision-2" } }, {
      signal: new AbortController().signal,
    });

    expect(first).toMatchObject({ status: "partial", items: expect.any(Array), nextCursor: expect.any(String) });
    expect(second.items).toHaveLength(1);
    expect(hosts).toHaveLength(2);
    expect(hosts[0].disposeCalls).toBe(1);
    await provider.disposeAsync();
    expect(hosts[1].disposeCalls).toBe(1);
  });

  it("does not create a replacement Host when disposal races with a revision restart", async () => {
    const fixture = await createFixture();
    let releaseStaleHost: (() => void) | undefined;
    let markStaleHostDisposing: (() => void) | undefined;
    const staleHostDisposing = new Promise<void>((resolve) => {
      markStaleHostDisposing = resolve;
    });
    const staleHostReleased = new Promise<void>((resolve) => {
      releaseStaleHost = resolve;
    });
    let hostFactoryCalls = 0;
    const provider = createProvider(fixture, undefined, () => {
      hostFactoryCalls += 1;
      return {
        async request<Result>(): Promise<Result> {
          return [] as Result;
        },
        async notify(): Promise<void> {},
        async dispose(): Promise<void> {
          markStaleHostDisposing?.();
          await staleHostReleased;
        },
      };
    });
    const request = {
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols" as const,
      query: "Hello",
      requiredCapability: "semantic-live" as const,
      deadlineAtMs: Date.now() + 3_000,
    };
    await provider.query(request, { signal: new AbortController().signal });

    const restartedQuery = provider.query({
      ...request,
      workspace: { ...request.workspace, revision: "revision-2" },
    }, { signal: new AbortController().signal });
    await staleHostDisposing;
    await provider.disposeAsync();
    releaseStaleHost?.();

    await expect(restartedQuery).rejects.toThrow("disposed");
    expect(hostFactoryCalls).toBe(1);
  });

  it.each(["request", "notify"] as const)(
    "disposes a Host after a %s failure and creates a fresh Host for recovery",
    async (failurePoint) => {
      const fixture = await createFixture();
      const hosts: FakeHost[] = [];
      const provider = createProvider(fixture, undefined, () => {
        const host = new FakeHost({ "workspace/symbol": [] });
        if (hosts.length === 0) {
          if (failurePoint === "request") host.requestError = new Error("request failed");
          else host.notifyError = new Error("notify failed");
        }
        hosts.push(host);
        return host;
      });
      const request = {
        workspace: { rootPath: fixture.workspace, revision: "revision-1" },
        operation: "symbols" as const,
        query: "Hello",
        requiredCapability: "semantic-live" as const,
        deadlineAtMs: Date.now() + 3_000,
      };

      await expect(provider.query(request, { signal: new AbortController().signal }))
        .rejects.toThrow(`${failurePoint} failed`);
      expect(hosts).toHaveLength(1);
      expect(hosts[0].disposeCalls).toBe(1);

      await expect(provider.query(request, { signal: new AbortController().signal }))
        .resolves.toMatchObject({ status: "completed", items: [] });
      expect(hosts).toHaveLength(2);
      expect(hosts[1].disposeCalls).toBe(0);
      await provider.disposeAsync();
      expect(hosts[1].disposeCalls).toBe(1);
    },
  );

  it("waits for an in-flight failed Host cleanup during Provider disposal", async () => {
    const fixture = await createFixture();
    let rejectRequest: ((error: Error) => void) | undefined;
    let markRequestStarted: (() => void) | undefined;
    let markDisposeStarted: (() => void) | undefined;
    let releaseDispose: (() => void) | undefined;
    const requestFailure = new Promise<never>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const disposeStarted = new Promise<void>((resolve) => {
      markDisposeStarted = resolve;
    });
    const disposeReleased = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const provider = createProvider(fixture, undefined, () => ({
      async request<Result>(): Promise<Result> {
        markRequestStarted?.();
        return await requestFailure;
      },
      async notify(): Promise<void> {},
      async dispose(): Promise<void> {
        markDisposeStarted?.();
        await disposeReleased;
      },
    }));
    const query = provider.query({
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols",
      query: "Hello",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
    }, { signal: new AbortController().signal });
    const observedQuery = query.then(
      () => undefined,
      (error: unknown) => error,
    );

    await requestStarted;
    rejectRequest?.(new Error("request failed"));
    await disposeStarted;
    let disposalSettled = false;
    const disposal = provider.disposeAsync().then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    expect(disposalSettled).toBe(false);

    releaseDispose?.();
    await expect(observedQuery).resolves.toMatchObject({ message: "request failed" });
    await disposal;
    expect(disposalSettled).toBe(true);
  });

  it("fails closed on malformed LSP locations without exposing process errors", async () => {
    const fixture = await createFixture();
    const host = new FakeHost({
      "workspace/symbol": [
        { name: "BadRange", kind: 12, location: { uri: "https://example.invalid/a.go", range: {} } },
        { name: "BadShape", kind: "function", location: null },
      ],
    });
    const provider = createProvider(fixture, host);

    const result = await provider.query({
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols",
      query: "Bad",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
    }, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: "partial",
      items: [],
      diagnostics: [
        { code: "invalid_location", message: expect.any(String) },
        { code: "invalid_location", message: expect.any(String) },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("example.invalid");
  });

  it("fails closed before LSP traffic when workspace synchronization exceeds its byte limit", async () => {
    const fixture = await createFixture();
    const host = new FakeHost({ "workspace/symbol": [] });
    const provider = createProvider(fixture, host, undefined, () => "x".repeat(1024 * 1024 + 1));

    await expect(provider.query({
      workspace: { rootPath: fixture.workspace, revision: "revision-1" },
      operation: "symbols",
      query: "Hello",
      requiredCapability: "semantic-live",
      deadlineAtMs: Date.now() + 3_000,
    }, { signal: new AbortController().signal })).rejects.toThrow(/byte limit/u);
    expect(host.notifications).toHaveLength(0);
    expect(host.requests).toHaveLength(0);
    await provider.disposeAsync();
  });
});

class FakeHost implements GoplsCodeIntelHost {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly notifications: Array<{ method: string; params: unknown }> = [];
  readonly events: string[] = [];
  disposeCalls = 0;
  requestError: Error | undefined;
  notifyError: Error | undefined;

  constructor(private readonly responses: Record<string, unknown>) {}

  async request<Result>(request: { method: string; params?: unknown }): Promise<Result> {
    this.events.push(`request:${request.method}`);
    this.requests.push({ method: request.method, params: request.params });
    if (this.requestError) throw this.requestError;
    return this.responses[request.method] as Result;
  }

  async notify(notification: { method: string; params?: unknown }): Promise<void> {
    this.events.push(`notify:${notification.method}`);
    this.notifications.push({ method: notification.method, params: notification.params });
    if (this.notifyError) throw this.notifyError;
  }

  async waitForWorkspaceReady(): Promise<void> {
    this.events.push("wait:workspaceReady");
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }
}

async function createFixture(): Promise<{ root: string; workspace: string; stateRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "ss-gopls-provider-"));
  tempDirs.push(root);
  const workspace = path.join(root, "workspace");
  const stateRoot = path.join(root, "state");
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "main.go"), "package main\n\nfunc Hello() string { return \"hello\" }\n", "utf8");
  return { root, workspace, stateRoot };
}

function createProvider(
  fixture: { root: string; workspace: string; stateRoot: string },
  host?: FakeHost,
  hostFactory?: GoplsCodeIntelHostFactory,
  readFile?: (filePath: string) => string,
  externalEvidenceRoots: string[] = [],
): GoplsCodeIntelProvider {
  const profile = createGoplsProcessProfile({
    probe: {
      status: "available",
      pinnedGoplsVersion: PINNED_GOPLS_VERSION,
      gopls: { command: path.join(fixture.root, "gopls.exe"), version: PINNED_GOPLS_VERSION },
      go: { command: path.join(fixture.root, "go.exe"), version: "go1.24.2", platform: "windows/amd64" },
      diagnostics: [],
    },
    workspaceRoot: fixture.workspace,
    externalEvidenceRoots,
    stateRoot: fixture.stateRoot,
    platformEnvironment: {},
  });
  return new GoplsCodeIntelProvider({
    profile,
    hostFactory: hostFactory
      ? (input) => hostFactory(input)
      : () => host!,
    ...(readFile ? { readFile } : {}),
  });
}
