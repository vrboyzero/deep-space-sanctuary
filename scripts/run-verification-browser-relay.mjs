import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import puppeteer from "puppeteer-core";
import WebSocket from "ws";

import { RelayServer } from "../packages/belldandy-browser/src/relay.ts";
import { projectVerificationBrowserReport } from "./verification-browser-report-adapter.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SCHEMA_VERSION = "browser-relay-verification/v1";
const RUNNER_VERSION = "browser-relay/v1";
const DEFAULT_VIEWPORT = { width: 960, height: 640, deviceScaleFactor: 1 };
const DEFAULT_TIMEOUT_MS = 30_000;
const ARTIFACT_NAMES = {
  report: "browser-report.json",
  screenshot: "browser-screenshot.png",
  evidence: "browser-evidence.json",
};

export class VerificationBrowserRelayFixtureError extends Error {
  constructor(message, { reason, lifecycle, diagnostics, cause }) {
    super(message, { cause });
    this.name = "VerificationBrowserRelayFixtureError";
    this.reason = reason;
    this.lifecycle = lifecycle;
    this.diagnostics = diagnostics;
  }
}

const FIXTURE_REASONS = new Set(["timed_out", "cancelled", "failed"]);

/** 顶层 CLI 只输出稳定的生命周期诊断，不回显 fixture/浏览器错误正文。 */
export function serializeVerificationBrowserRelayError(error) {
  const reason = FIXTURE_REASONS.has(error?.reason) ? error.reason : "failed";
  const lifecycle = isRecord(error?.lifecycle)
    ? {
      status: error.lifecycle.status,
      pageClosed: Boolean(error.lifecycle.pageClosed),
      browserClosed: Boolean(error.lifecycle.browserClosed),
      pendingRequestCount: boundedCount(error.lifecycle.pendingRequestCount),
      orphanResourceCount: boundedCount(error.lifecycle.orphanResourceCount),
    }
    : null;
  const diagnostics = isRecord(error?.diagnostics)
    ? {
      relay: isRecord(error.diagnostics.relay)
        ? {
          state: error.diagnostics.relay.state,
          httpListening: Boolean(error.diagnostics.relay.httpListening),
          extensionConnected: Boolean(error.diagnostics.relay.extensionConnected),
          extensionConnectionCount: boundedCount(error.diagnostics.relay.extensionConnectionCount),
          cdpClientCount: boundedCount(error.diagnostics.relay.cdpClientCount),
          pendingRequestCount: boundedCount(error.diagnostics.relay.pendingRequestCount),
        }
        : null,
      proxy: isRecord(error.diagnostics.proxy)
        ? {
          openSocketCount: boundedCount(error.diagnostics.proxy.openSocketCount),
          pendingCommandCount: boundedCount(error.diagnostics.proxy.pendingCommandCount),
        }
        : null,
      cleanupErrorCount: boundedCount(error.diagnostics.cleanupErrorCount),
    }
    : { errorType: typeof error?.name === "string" ? error.name : "Error" };
  return { reason, lifecycle, diagnostics };
}

export function attachVerificationBrowserRelaySigint(controller, signalTarget = process) {
  const onSigint = () => controller.abort(new Error("SIGINT"));
  signalTarget.once("SIGINT", onSigint);
  return () => signalTarget.off("SIGINT", onSigint);
}

export function parseVerificationBrowserRelayArgs(argv) {
  const args = {
    help: false,
    outputDir: null,
    chromePath: null,
    extensionPath: null,
    commit: null,
    workspaceHash: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    sessionTimeoutMs: null,
    viewport: { ...DEFAULT_VIEWPORT },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    if (argument === "--output-dir") args.outputDir = value;
    else if (argument === "--chrome-path") args.chromePath = value;
    else if (argument === "--extension-path") args.extensionPath = value;
    else if (argument === "--commit") args.commit = normalizeCommit(value, argument);
    else if (argument === "--workspace-hash") args.workspaceHash = normalizeSha256(value, argument);
    else if (argument === "--timeout-ms") args.timeoutMs = normalizeTimeout(value, argument);
    else if (argument === "--session-timeout-ms") args.sessionTimeoutMs = normalizeSessionTimeout(value, argument);
    else if (argument === "--viewport") args.viewport = parseViewport(value, argument);
    else throw new Error(`Unsupported argument ${argument}.`);
  }
  return args;
}

export async function runVerificationBrowserRelayFixture({
  revision,
  chromeExecutablePath,
  extensionPath = null,
  artifactPaths,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sessionTimeoutMs = null,
  probeDelayMs = 0,
  cleanupTimeoutMs = 5_000,
  reconnectMv3ExtensionBeforeInteraction = false,
  restartMv3ServiceWorker = false,
  signal,
  viewport = DEFAULT_VIEWPORT,
} = {}) {
  const normalizedRevision = normalizeRevision(revision);
  const normalizedArtifactPaths = normalizeArtifactPaths(artifactPaths);
  const normalizedTimeoutMs = normalizeRuntimeDuration(timeoutMs, "timeoutMs", { minimum: 1_000 });
  const normalizedSessionTimeoutMs = sessionTimeoutMs == null
    ? null
    : normalizeRuntimeDuration(sessionTimeoutMs, "sessionTimeoutMs", { minimum: 1 });
  const normalizedProbeDelayMs = normalizeRuntimeDuration(probeDelayMs, "probeDelayMs", { minimum: 0 });
  const normalizedCleanupTimeoutMs = normalizeRuntimeDuration(cleanupTimeoutMs, "cleanupTimeoutMs", { minimum: 100 });
  const normalizedViewport = normalizeViewport(viewport, "viewport");
  const extensionDirectory = extensionPath == null
    ? null
    : await resolveVerificationBrowserExtensionPath(extensionPath);
  const executablePath = extensionDirectory
    ? await resolveMv3ChromeExecutable(chromeExecutablePath)
    : await resolveChromeExecutable(chromeExecutablePath);
  const fixtureServer = createFixtureServer(normalizedProbeDelayMs);
  const relayToken = crypto.randomBytes(32).toString("base64url");
  const relay = new RelayServer(0, {
    token: relayToken,
    requestTimeoutMs: normalizedTimeoutMs,
    shutdownGraceMs: Math.min(normalizedCleanupTimeoutMs, 1_000),
  });
  let chromeBrowser;
  let relayBrowser;
  let relayPage;
  let sourcePage;
  let extensionOptionsPage;
  let proxy;
  let screenshotContent;
  let interaction;
  let operationError;
  let sessionAbortScope;
  const cleanupErrors = [];
  const requestState = createRequestState();
  const consoleState = { errorCount: 0, warningCount: 0 };

  if (signal?.aborted) {
    operationError = toAbortError(signal.reason);
  } else try {
    const baseUrl = await listen(fixtureServer);
    chromeBrowser = await puppeteer.launch({
      executablePath,
      headless: true,
      ...(extensionDirectory ? { ignoreDefaultArgs: ["--disable-extensions"] } : {}),
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--no-default-browser-check",
        "--no-first-run",
        ...(extensionDirectory
          ? [
            `--disable-extensions-except=${extensionDirectory}`,
            `--load-extension=${extensionDirectory}`,
          ]
          : []),
      ],
    });
    sourcePage = (await chromeBrowser.pages())[0] ?? await chromeBrowser.newPage();
    await relay.start();
    if (extensionDirectory) {
      const extension = await configureRealMv3Extension(
        chromeBrowser,
        relay,
        relayToken,
        normalizedTimeoutMs,
      );
      extensionOptionsPage = extension.optionsPage;
      if (restartMv3ServiceWorker) {
        await restartRealMv3ServiceWorker(
          relay,
          extension.serviceWorkerTarget,
          extension.optionsPage,
          normalizedTimeoutMs,
        );
      }
      await closeResource("extension options page", async () => extensionOptionsPage?.close(), cleanupErrors, normalizedCleanupTimeoutMs);
      extensionOptionsPage = undefined;
      await sourcePage.bringToFront();
    } else {
      const targetId = getPuppeteerTargetId(sourcePage.target());
      proxy = new ChromeRelayProtocolProxy({
        relayPort: relay.port,
        relayToken,
        chromeEndpoint: chromeBrowser.wsEndpoint(),
        targetId,
      });
      await withTimeout(proxy.start(), normalizedTimeoutMs, "Relay protocol proxy");
    }
    relayBrowser = await withTimeout(puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${relay.port}/cdp`,
      headers: { Authorization: `Bearer ${relayToken}` },
      defaultViewport: null,
      protocolTimeout: normalizedTimeoutMs,
    }), normalizedTimeoutMs, "Puppeteer Relay connection");
    relayPage = await waitForRelayPage(relayBrowser, normalizedTimeoutMs);
    await relayPage.setViewport(normalizedViewport);
    await attachPageObservers(relayPage, baseUrl, requestState, consoleState);
    if (extensionDirectory && reconnectMv3ExtensionBeforeInteraction) {
      await reconnectRealMv3Extension(relay, normalizedTimeoutMs);
    }
    sessionAbortScope = createSessionAbortScope(signal, normalizedSessionTimeoutMs);
    try {
      interaction = await runFixtureInteraction(
        relayPage,
        baseUrl,
        normalizedTimeoutMs,
        sessionAbortScope.signal,
      );
      screenshotContent = Buffer.from(await raceWithSignal(
        relayPage.screenshot({ type: "png" }),
        sessionAbortScope.signal,
      ));
    } finally {
      sessionAbortScope.dispose();
    }
  } catch (error) {
    operationError = error;
  }

  await closeResource(
    extensionDirectory ? "source page" : "relay page",
    async () => (extensionDirectory ? sourcePage?.close() : relayPage?.close()),
    cleanupErrors,
    normalizedCleanupTimeoutMs,
  );
  await closeResource("extension options page", async () => extensionOptionsPage?.close(), cleanupErrors, normalizedCleanupTimeoutMs);
  await closeResource("Relay Puppeteer client", async () => relayBrowser?.disconnect(), cleanupErrors, normalizedCleanupTimeoutMs);
  await closeResource("Relay protocol proxy", async () => proxy?.stop(), cleanupErrors, normalizedCleanupTimeoutMs);
  await closeResource("Chrome browser", async () => chromeBrowser?.close(), cleanupErrors, normalizedCleanupTimeoutMs);
  await closeResource("Relay server", async () => relay.stop(), cleanupErrors, normalizedCleanupTimeoutMs);
  await closeResource("fixture server", async () => closeServer(fixtureServer), cleanupErrors, normalizedCleanupTimeoutMs);

  const relayLifecycle = relay.getLifecycleSnapshot();
  const proxyLifecycle = proxy?.getLifecycleSnapshot() ?? { openSocketCount: 0, pendingCommandCount: 0 };
  const pageClosed = (!relayPage && !sourcePage) || Boolean(relayPage?.isClosed() || sourcePage?.isClosed());
  const browserClosed = !chromeBrowser || !chromeBrowser.isConnected();
  // 页面已关闭后，迟到的 Puppeteer requestfailed 事件不再代表仍存活的网络资源。
  if (pageClosed) requestState.pending.clear();
  const pendingRequestCount = requestState.pending.size + relayLifecycle.pendingRequestCount + proxyLifecycle.pendingCommandCount;
  const orphanResourceCount = cleanupErrors.length
    + Number(relayLifecycle.httpListening)
    + Number(relayLifecycle.extensionConnected)
    + relayLifecycle.cdpClientCount
    + proxyLifecycle.openSocketCount
    + Number(fixtureServer.listening)
    + Number(!pageClosed)
    + Number(!browserClosed);
  const lifecycleStatus = pageClosed
    && browserClosed
    && pendingRequestCount === 0
    && orphanResourceCount === 0
    ? "settled"
    : "incomplete";
  const lifecycle = {
    status: lifecycleStatus,
    pageClosed,
    browserClosed,
    pendingRequestCount,
    orphanResourceCount,
  };
  const diagnostics = {
    relay: relayLifecycle,
    proxy: proxyLifecycle,
    cleanupErrorCount: cleanupErrors.length,
    cleanupErrorLabels: cleanupErrors.map((entry) => entry.label),
  };
  if (operationError) {
    const reason = classifyFixtureError(operationError, sessionAbortScope, signal);
    throw new VerificationBrowserRelayFixtureError(
      `Browser Relay verification fixture ${reason}: ${normalizeError(operationError)}`,
      { reason, lifecycle, diagnostics, cause: operationError },
    );
  }
  if (!interaction || !screenshotContent) {
    throw new VerificationBrowserRelayFixtureError(
      "Browser Relay verification fixture did not produce interaction evidence.",
      { reason: "failed", lifecycle, diagnostics },
    );
  }
  const requestSummary = finalizeRequests(requestState);
  const screenshotSha256 = sha256(screenshotContent);
  const report = {
    schemaVersion: SOURCE_SCHEMA_VERSION,
    runnerVersion: RUNNER_VERSION,
    revision: normalizedRevision,
    observedAt: new Date().toISOString(),
    route: "/fixture.html",
    viewport: normalizedViewport,
    page: {
      loaded: interaction.pageLoaded,
      finalRoute: interaction.finalRoute,
    },
    dom: {
      changed: interaction.beforeSha256 !== interaction.afterSha256,
      beforeSha256: interaction.beforeSha256,
      afterSha256: interaction.afterSha256,
      assertions: {
        total: 2,
        failed: Number(interaction.statusText !== "verified")
          + Number(interaction.beforeSha256 === interaction.afterSha256),
      },
    },
    console: consoleState,
    requests: requestSummary,
    screenshot: {
      artifact: {
        path: normalizedArtifactPaths.screenshot,
        sha256: screenshotSha256,
      },
      bytes: screenshotContent.length,
      width: normalizedViewport.width,
      height: normalizedViewport.height,
    },
    lifecycle,
  };
  const reportContent = `${JSON.stringify(report, null, 2)}\n`;
  const evidence = projectVerificationBrowserReport({
    artifact: {
      path: normalizedArtifactPaths.report,
      sha256: sha256(reportContent),
    },
    content: reportContent,
    screenshotContent,
    expectedRevision: normalizedRevision,
  });
  return {
    report,
    reportContent,
    screenshotContent,
    evidence,
    diagnostics,
  };
}

export async function writeVerificationBrowserRelayArtifacts(outputDir, result) {
  const targetDir = resolveWorkspaceOutputDirectory(outputDir);
  await fs.mkdir(targetDir, { recursive: true });
  const targets = {
    report: path.join(targetDir, ARTIFACT_NAMES.report),
    screenshot: path.join(targetDir, ARTIFACT_NAMES.screenshot),
    evidence: path.join(targetDir, ARTIFACT_NAMES.evidence),
  };
  for (const target of Object.values(targets)) {
    try {
      await fs.access(target);
      throw new Error(`Browser Relay artifact already exists: ${target}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await writeExclusive(targets.screenshot, result.screenshotContent);
  await writeExclusive(targets.report, result.reportContent);
  await writeExclusive(targets.evidence, `${JSON.stringify(result.evidence, null, 2)}\n`);
  return targets;
}

export async function resolveVerificationRevision({ commit, workspaceHash } = {}) {
  const normalizedCommit = commit == null
    ? normalizeCommit(readGit(["rev-parse", "HEAD"]), "git commit")
    : normalizeCommit(commit, "commit");
  const normalizedWorkspaceHash = workspaceHash == null
    ? await hashWorkspaceFiles()
    : normalizeSha256(workspaceHash, "workspaceHash");
  return { commit: normalizedCommit, workspaceHash: normalizedWorkspaceHash };
}

export function getVerificationBrowserArtifactPaths(outputDir) {
  const targetDir = resolveWorkspaceOutputDirectory(outputDir);
  const relativeDir = path.relative(workspaceRoot, targetDir).replaceAll("\\", "/");
  return {
    report: path.posix.join(relativeDir, ARTIFACT_NAMES.report),
    screenshot: path.posix.join(relativeDir, ARTIFACT_NAMES.screenshot),
    evidence: path.posix.join(relativeDir, ARTIFACT_NAMES.evidence),
  };
}

export async function resolveVerificationBrowserExtensionPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("--extension-path must identify a workspace child directory.");
  }
  const target = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Browser Relay extension path must be a child of the workspace.");
  }
  const stat = await fs.stat(target);
  if (!stat.isDirectory()) throw new Error("Browser Relay extension path must be a directory.");
  let manifest;
  try {
    const content = await fs.readFile(path.join(target, "manifest.json"), "utf8");
    manifest = JSON.parse(content.replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error("Browser Relay extension path must contain a valid manifest.json.");
  }
  if (manifest?.manifest_version !== 3 || typeof manifest?.background?.service_worker !== "string") {
    throw new Error("Browser Relay extension path must contain an MV3 service worker manifest.");
  }
  return target;
}

class ChromeRelayProtocolProxy {
  #relayPort;
  #relayToken;
  #chromeEndpoint;
  #targetId;
  #extensionSocket = null;
  #chromeSocket = null;
  #nextCommandId = 1;
  #pending = new Map();

  constructor({ relayPort, relayToken, chromeEndpoint, targetId }) {
    this.#relayPort = relayPort;
    this.#relayToken = relayToken;
    this.#chromeEndpoint = chromeEndpoint;
    this.#targetId = targetId;
  }

  async start() {
    this.#chromeSocket = new WebSocket(this.#chromeEndpoint);
    this.#extensionSocket = new WebSocket(
      `ws://127.0.0.1:${this.#relayPort}/extension`,
      `belldandy-relay-v1.${this.#relayToken}`,
      { origin: "chrome-extension://verification-fixture" },
    );
    this.#chromeSocket.on("message", (data) => this.#handleChromeMessage(data));
    this.#extensionSocket.on("message", (data) => this.#handleExtensionMessage(data));
    await Promise.all([
      waitForSocketOpen(this.#chromeSocket, "Chrome CDP proxy"),
      waitForSocketOpen(this.#extensionSocket, "Relay extension proxy"),
    ]);
  }

  async stop() {
    this.#pending.clear();
    const sockets = [this.#extensionSocket, this.#chromeSocket].filter(Boolean);
    await Promise.all(sockets.map((socket) => closeWebSocket(socket)));
    this.#extensionSocket = null;
    this.#chromeSocket = null;
  }

  getLifecycleSnapshot() {
    return {
      openSocketCount: [this.#extensionSocket, this.#chromeSocket]
        .filter((socket) => socket?.readyState === WebSocket.OPEN).length,
      pendingCommandCount: this.#pending.size,
    };
  }

  #handleExtensionMessage(data) {
    const message = parseJsonObject(data);
    if (!message) return;
    if (message.method === "ping") {
      sendSocketJson(this.#extensionSocket, { method: "pong" });
      return;
    }
    if (message.method !== "forwardCDPCommand" || !Number.isSafeInteger(message.id)) return;
    const params = message.params;
    if (!params || typeof params !== "object" || typeof params.method !== "string") return;
    const commandId = this.#nextCommandId;
    this.#nextCommandId += 1;
    this.#pending.set(commandId, message.id);
    const commandParams = remapTargetParams(params.params, this.#targetId);
    const command = {
      id: commandId,
      method: params.method,
      ...(commandParams === undefined ? {} : { params: commandParams }),
      ...(typeof params.sessionId === "string" ? { sessionId: params.sessionId } : {}),
    };
    if (!sendSocketJson(this.#chromeSocket, command)) {
      this.#pending.delete(commandId);
      sendSocketJson(this.#extensionSocket, { id: message.id, error: "Chrome CDP proxy is not writable" });
    }
  }

  #handleChromeMessage(data) {
    const message = parseJsonObject(data);
    if (!message) return;
    if (Number.isSafeInteger(message.id)) {
      const relayId = this.#pending.get(message.id);
      if (relayId === undefined) return;
      this.#pending.delete(message.id);
      sendSocketJson(this.#extensionSocket, {
        id: relayId,
        ...(message.error
          ? { error: normalizeCdpError(message.error) }
          : { result: message.result ?? {} }),
      });
      return;
    }
    if (typeof message.method !== "string") return;
    sendSocketJson(this.#extensionSocket, {
      method: "forwardCDPEvent",
      params: {
        method: message.method,
        params: remapTargetEvent(message.method, message.params, this.#targetId),
        ...(typeof message.sessionId === "string" ? { sessionId: message.sessionId } : {}),
      },
    });
  }
}

function createFixtureServer(probeDelayMs = 0) {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && requestUrl.pathname === "/fixture.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`<!doctype html>
<html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Relay verification</title></head>
<body><main><button id="verify" type="button">Verify</button><output id="status">idle</output></main>
<script>
document.querySelector("#verify").addEventListener("click", async () => {
  const response = await fetch("/probe", { method: "POST", body: "verification" });
  document.querySelector("#status").textContent = response.ok ? "verified" : "failed";
});
</script></body></html>`);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/probe") {
      request.resume();
      let timer;
      const clearProbeTimer = () => clearTimeout(timer);
      const respond = () => {
        if (response.destroyed || response.writableEnded) return;
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end('{"ok":true}');
      };
      request.once("aborted", clearProbeTimer);
      response.once("close", clearProbeTimer);
      if (probeDelayMs === 0) respond();
      else {
        timer = setTimeout(respond, probeDelayMs);
        timer.unref();
      }
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  });
}

async function runFixtureInteraction(page, baseUrl, timeoutMs, signal) {
  const response = await raceWithSignal(page.goto(`${baseUrl}/fixture.html`, {
    waitUntil: "load",
    timeout: timeoutMs,
  }), signal);
  const beforeSha256 = sha256(await raceWithSignal(page.content(), signal));
  await raceWithSignal(page.click("#verify"), signal);
  await raceWithSignal(page.waitForFunction(
    () => document.querySelector("#status")?.textContent === "verified",
    { timeout: timeoutMs },
  ), signal);
  const statusText = await raceWithSignal(
    page.$eval("#status", (element) => element.textContent ?? ""),
    signal,
  );
  const afterSha256 = sha256(await raceWithSignal(page.content(), signal));
  return {
    pageLoaded: Boolean(response?.ok()),
    finalRoute: new URL(page.url()).pathname,
    statusText,
    beforeSha256,
    afterSha256,
  };
}

function createRequestState() {
  return {
    observedCount: 0,
    failedCount: 0,
    blockedExternalCount: 0,
    pending: new Set(),
    outcomes: new Map(),
    probePassed: false,
  };
}

async function attachPageObservers(page, baseUrl, state, consoleState) {
  const allowedOrigin = new URL(baseUrl).origin;
  page.on("console", (message) => {
    if (message.type() === "error") consoleState.errorCount += 1;
    if (message.type() === "warn" || message.type() === "warning") consoleState.warningCount += 1;
  });
  page.on("pageerror", () => {
    consoleState.errorCount += 1;
  });
  page.on("request", (request) => {
    let url;
    try {
      url = new URL(request.url());
    } catch {
      state.blockedExternalCount += 1;
      void request.abort("blockedbyclient");
      return;
    }
    if (url.origin !== allowedOrigin) {
      state.blockedExternalCount += 1;
      void request.abort("blockedbyclient");
      return;
    }
    state.observedCount += 1;
    state.pending.add(request);
    void request.continue();
  });
  page.on("response", (response) => {
    const request = response.request();
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (url.origin !== allowedOrigin) return;
    state.pending.delete(request);
    const status = response.status();
    if (status >= 400) state.failedCount += 1;
    const key = `${request.method()}\0${url.pathname}\0${status}`;
    const previous = state.outcomes.get(key) ?? {
      method: request.method(),
      route: url.pathname,
      status,
      count: 0,
    };
    previous.count += 1;
    state.outcomes.set(key, previous);
    if (request.method() === "POST" && url.pathname === "/probe" && status === 200) {
      state.probePassed = true;
    }
  });
  page.on("requestfailed", (request) => {
    if (!state.pending.delete(request)) return;
    state.failedCount += 1;
  });
  await page.setRequestInterception(true);
}

function finalizeRequests(state) {
  return {
    observedCount: state.observedCount,
    failedCount: state.failedCount,
    blockedExternalCount: state.blockedExternalCount,
    assertions: { total: 1, failed: Number(!state.probePassed) },
    outcomes: [...state.outcomes.values()].sort((left, right) => (
      `${left.method}\0${left.route}\0${left.status}`.localeCompare(`${right.method}\0${right.route}\0${right.status}`)
    )),
  };
}

async function waitForRelayPage(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const pages = await browser.pages();
    const page = pages.find((entry) => !entry.isClosed());
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Relay did not expose a page before the verification deadline.");
}

async function configureRealMv3Extension(browser, relay, relayToken, timeoutMs) {
  const serviceWorkerTarget = await browser.waitForTarget((target) => {
    if (target.type() !== "service_worker") return false;
    try {
      const targetUrl = new URL(target.url());
      return targetUrl.protocol === "chrome-extension:" && targetUrl.pathname === "/background.js";
    } catch {
      return false;
    }
  }, { timeout: timeoutMs });
  const extensionId = new URL(serviceWorkerTarget.url()).hostname;
  const optionsPage = await browser.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "load",
    timeout: timeoutMs,
  });
  await optionsPage.evaluate(async ({ relayPort, credential }) => {
    await chrome.storage.local.set({ relayPort: String(relayPort), relayToken: credential });
  }, { relayPort: relay.port, credential: relayToken });
  await waitForCondition(
    () => relay.getLifecycleSnapshot().extensionConnected,
    timeoutMs,
    "MV3 extension Relay connection",
  );
  return { optionsPage, serviceWorkerTarget };
}

async function restartRealMv3ServiceWorker(relay, serviceWorkerTarget, optionsPage, timeoutMs) {
  const pageSession = await optionsPage.createCDPSession();
  let onVersionUpdated;
  try {
    const versionPromise = new Promise((resolve) => {
      onVersionUpdated = (event) => {
        const version = event.versions.find((entry) => (
          entry.scriptURL === serviceWorkerTarget.url() && entry.runningStatus === "running"
        ));
        if (version) resolve(version);
      };
      pageSession.on("ServiceWorker.workerVersionUpdated", onVersionUpdated);
    });
    await pageSession.send("ServiceWorker.enable");
    const version = await withTimeout(versionPromise, timeoutMs, "MV3 extension service worker version");
    const connectionCount = relay.getLifecycleSnapshot().extensionConnectionCount;
    await pageSession.send("ServiceWorker.stopWorker", { versionId: version.versionId });
    await waitForCondition(
      () => !relay.getLifecycleSnapshot().extensionConnected,
      timeoutMs,
      "MV3 extension service worker disconnect",
    );
    await optionsPage.evaluate(async (wakeNonce) => {
      await chrome.storage.local.set({ verificationWakeNonce: wakeNonce });
    }, crypto.randomBytes(16).toString("hex"));
    await waitForCondition(() => {
      const current = relay.getLifecycleSnapshot();
      return current.extensionConnected && current.extensionConnectionCount > connectionCount;
    }, timeoutMs, "MV3 extension service worker reconnect");
  } finally {
    if (onVersionUpdated) pageSession.off("ServiceWorker.workerVersionUpdated", onVersionUpdated);
    await pageSession.send("ServiceWorker.disable").catch(() => {});
    await pageSession.detach().catch(() => {});
  }
}

async function reconnectRealMv3Extension(relay, timeoutMs) {
  const connectionCount = relay.getLifecycleSnapshot().extensionConnectionCount;
  if (!relay.requestExtensionReconnect()) {
    throw new Error("MV3 extension Relay connection is unavailable for reconnect.");
  }
  await waitForCondition(
    () => !relay.getLifecycleSnapshot().extensionConnected,
    timeoutMs,
    "MV3 extension Relay disconnect",
  );
  await waitForCondition(() => {
    const current = relay.getLifecycleSnapshot();
    return current.extensionConnected && current.extensionConnectionCount > connectionCount;
  }, timeoutMs, "MV3 extension Relay reconnect");
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms.`);
}

function remapTargetParams(value, targetId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.targetId !== "page-1") return value;
  return { ...value, targetId };
}

function remapTargetEvent(method, value, targetId) {
  if (method !== "Target.attachedToTarget" || !value || typeof value !== "object") return value;
  const targetInfo = value.targetInfo;
  if (!targetInfo || typeof targetInfo !== "object" || targetInfo.targetId !== targetId) return value;
  return { ...value, targetInfo: { ...targetInfo, targetId: "page-1" } };
}

function getPuppeteerTargetId(target) {
  const targetId = target?._targetId ?? target?._targetInfo?.targetId;
  if (typeof targetId !== "string" || !targetId) {
    throw new Error("Chrome fixture target ID is unavailable.");
  }
  return targetId;
}

function parseJsonObject(data) {
  try {
    const value = JSON.parse(data.toString());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function sendSocketJson(socket, value) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

async function waitForSocketOpen(socket, label) {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(new Error(`${label} failed: ${normalizeError(error)}`));
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

async function closeWebSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("close", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      socket.terminate();
      finish();
    }, 1_000);
    timer.unref?.();
    socket.once("close", finish);
    try {
      socket.close(1000, "verification fixture settled");
    } catch {
      finish();
    }
  });
}

async function closeResource(label, close, errors, timeoutMs) {
  try {
    await withTimeout(Promise.resolve().then(close), timeoutMs, `${label} cleanup`);
  } catch (error) {
    errors.push({ label, error: normalizeError(error) });
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Browser Relay fixture did not expose a loopback port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function resolveChromeExecutable(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.BELLDANDY_CHROME_PATH,
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return path.resolve(candidate);
    } catch {
      // Continue through explicit and platform-default candidates.
    }
  }
  throw new Error("Chrome executable not found. Set --chrome-path or BELLDANDY_CHROME_PATH.");
}

export async function resolveMv3ChromeExecutable(explicitPath) {
  const playwrightCandidates = await findPlaywrightChromiumCandidates();
  const candidates = [
    explicitPath,
    process.env.BELLDANDY_MV3_CHROME_PATH,
    process.env.CHROME_FOR_TESTING_BIN,
    "C:/Program Files/Google/Chrome for Testing/Application/chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google/Chrome for Testing/Application/chrome.exe")
      : null,
    ...playwrightCandidates,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return path.resolve(candidate);
    } catch {
      // Continue through explicit and local extension-capable candidates.
    }
  }
  throw new Error("MV3-capable Chromium executable not found. Set --chrome-path or BELLDANDY_MV3_CHROME_PATH.");
}

async function findPlaywrightChromiumCandidates() {
  if (!process.env.LOCALAPPDATA) return [];
  const cacheRoot = path.join(process.env.LOCALAPPDATA, "ms-playwright");
  let entries;
  try {
    entries = await fs.readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name, "en", { numeric: true }))
    .flatMap((entry) => [
      path.join(cacheRoot, entry.name, "chrome-win", "chrome.exe"),
      path.join(cacheRoot, entry.name, "chrome-win64", "chrome.exe"),
    ]);
}

function resolveWorkspaceOutputDirectory(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("--output-dir is required.");
  }
  const target = path.resolve(workspaceRoot, value);
  const relative = path.relative(workspaceRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Browser Relay output directory must be a child of the workspace.");
  }
  return target;
}

function normalizeArtifactPaths(value) {
  if (!value || typeof value !== "object") throw new Error("artifactPaths are required.");
  return {
    report: normalizeRelativePath(value.report, "artifactPaths.report"),
    screenshot: normalizeRelativePath(value.screenshot, "artifactPaths.screenshot"),
    evidence: normalizeRelativePath(value.evidence, "artifactPaths.evidence"),
  };
}

function normalizeRevision(value) {
  if (!value || typeof value !== "object") throw new Error("revision is required.");
  return {
    commit: normalizeCommit(value.commit, "revision.commit"),
    workspaceHash: normalizeSha256(value.workspaceHash, "revision.workspaceHash"),
  };
}

function normalizeRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.length > 1000 || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return value;
}

function normalizeCommit(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{7,64}$/.test(value)) {
    throw new Error(`${label} must identify a source revision.`);
  }
  return value;
}

function normalizeSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256.`);
  }
  return value;
}

function normalizeTimeout(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new Error(`${label} must be between 1000 and 120000 milliseconds.`);
  }
  return parsed;
}

function normalizeSessionTimeout(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 120_000) {
    throw new Error(`${label} must be between 1 and 120000 milliseconds.`);
  }
  return parsed;
}

function parseViewport(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must use WIDTHxHEIGHT or WIDTHxHEIGHT@SCALE.`);
  const matched = /^(\d{1,4})x(\d{1,4})(?:@(\d(?:\.\d+)?))?$/u.exec(value);
  if (!matched) throw new Error(`${label} must use WIDTHxHEIGHT or WIDTHxHEIGHT@SCALE.`);
  return normalizeViewport({
    width: Number(matched[1]),
    height: Number(matched[2]),
    deviceScaleFactor: matched[3] == null ? 1 : Number(matched[3]),
  }, label);
}

function normalizeViewport(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const width = value.width;
  const height = value.height;
  const deviceScaleFactor = value.deviceScaleFactor;
  if (!Number.isSafeInteger(width) || width < 320 || width > 4_096) {
    throw new Error(`${label}.width must be between 320 and 4096.`);
  }
  if (!Number.isSafeInteger(height) || height < 240 || height > 4_096) {
    throw new Error(`${label}.height must be between 240 and 4096.`);
  }
  if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 1 || deviceScaleFactor > 4) {
    throw new Error(`${label}.deviceScaleFactor must be between 1 and 4.`);
  }
  return { width, height, deviceScaleFactor };
}

function normalizeRuntimeDuration(value, label, { minimum }) {
  if (!Number.isSafeInteger(value) || value < minimum || value > 120_000) {
    throw new Error(`${label} must be between ${minimum} and 120000 milliseconds.`);
  }
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function createSessionAbortScope(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let deadlineTriggered = false;
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = timeoutMs == null
    ? null
    : setTimeout(() => {
      deadlineTriggered = true;
      controller.abort(new Error(`Browser Relay session deadline exceeded after ${timeoutMs}ms.`));
    }, timeoutMs);
  timer?.unref();
  return {
    signal: controller.signal,
    get deadlineTriggered() {
      return deadlineTriggered;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function classifyFixtureError(error, sessionAbortScope, parentSignal) {
  if (sessionAbortScope?.deadlineTriggered || /timed out|deadline exceeded/i.test(normalizeError(error))) {
    return "timed_out";
  }
  if (sessionAbortScope?.signal.aborted || parentSignal?.aborted) return "cancelled";
  return "failed";
}

function toAbortError(reason) {
  const error = new Error(reason instanceof Error ? reason.message : "Browser Relay verification was cancelled.");
  error.name = "AbortError";
  return error;
}

async function raceWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => {});
    throw toAbortError(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(toAbortError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function normalizeCdpError(value) {
  if (value && typeof value === "object" && typeof value.message === "string") return value.message;
  return "Chrome CDP command failed";
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeExclusive(target, content) {
  const handle = await fs.open(target, "wx");
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

function readGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

async function hashWorkspaceFiles() {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: workspaceRoot,
    encoding: "buffer",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) throw new Error("git ls-files failed.");
  const files = listed.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  const hash = crypto.createHash("sha256");
  for (const relativePath of files) {
    const filePath = path.resolve(workspaceRoot, relativePath);
    const relative = path.relative(workspaceRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("git ls-files returned a path outside the workspace.");
    }
    const stat = await fs.lstat(filePath);
    hash.update(relativePath.replaceAll("\\", "/"));
    hash.update("\0");
    if (stat.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await fs.readlink(filePath));
    } else if (stat.isFile()) {
      hash.update(await fs.readFile(filePath));
    } else {
      hash.update("non-file");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function printHelp() {
  console.log(`Usage: node --import tsx scripts/run-verification-browser-relay.mjs --output-dir <workspace-relative-dir> [options]

Options:
  --output-dir <path>       New artifact directory inside the workspace (required)
  --chrome-path <path>      Chrome/Chromium executable path
  --extension-path <path>   Workspace-relative unpacked MV3 extension (requires Chromium/CfT)
  --commit <hash>           Revision commit; defaults to git HEAD
  --workspace-hash <sha>    Workspace SHA-256; defaults to a tracked/untracked file hash
  --timeout-ms <n>          Connection and interaction deadline (default: ${DEFAULT_TIMEOUT_MS})
  --session-timeout-ms <n>  Optional page interaction and screenshot deadline
  --viewport <WxH[@scale]>  Browser viewport (default: 960x640@1)
  --help                    Show this help message`);
}

async function main() {
  let abortController;
  let detachSigint;
  try {
    const args = parseVerificationBrowserRelayArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }
    abortController = new AbortController();
    detachSigint = attachVerificationBrowserRelaySigint(abortController);
    const artifactPaths = getVerificationBrowserArtifactPaths(args.outputDir);
    const revision = await resolveVerificationRevision(args);
    const result = await runVerificationBrowserRelayFixture({
      revision,
      chromeExecutablePath: args.chromePath,
      extensionPath: args.extensionPath,
      artifactPaths,
      timeoutMs: args.timeoutMs,
      sessionTimeoutMs: args.sessionTimeoutMs,
      signal: abortController.signal,
      viewport: args.viewport,
    });
    const targets = await writeVerificationBrowserRelayArtifacts(args.outputDir, result);
    console.log(JSON.stringify({
      status: result.evidence.status,
      reason: result.evidence.reason,
      report: targets.report,
      screenshot: targets.screenshot,
      evidence: targets.evidence,
      lifecycle: result.evidence.lifecycle,
    }));
    if (result.evidence.status !== "passed") process.exitCode = 1;
  } finally {
    detachSigint?.();
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify(serializeVerificationBrowserRelayError(error)));
    process.exitCode = 1;
  });
}
