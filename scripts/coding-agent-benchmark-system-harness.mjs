import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import puppeteer from "puppeteer-core";

import { executeParallelReadIsolationHarness } from "./coding-agent-benchmark-parallel-read-harness.mjs";
import { executeParallelWriteFanInHarness } from "./coding-agent-benchmark-parallel-write-harness.mjs";
import { executeRestartDeliveryReconciliationHarness } from "./coding-agent-benchmark-restart-delivery-harness.mjs";

export const CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT = "browser-screenshot.png";

const MAX_BROWSER_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SYSTEM_EVIDENCE_VERSION = "coding-agent-benchmark-system-evidence/v1";
const SYSTEM_SCENARIO_VERSION = "coding-agent-benchmark-system-scenario/v1";
const BROWSER_TASK_ID = "system.browser-behavior";
const BROWSER_CAPABILITY = "browserBehavior";
const BROWSER_GENERATOR_ID = "browser-behavior-v1";
const BROWSER_BINDING_VERSION = "coding-agent-benchmark-browser-binding/v1";
const PARALLEL_READ_TASK_ID = "system.parallel-read-isolation";
const PARALLEL_READ_CAPABILITY = "parallelReadIsolation";
const PARALLEL_WRITE_TASK_ID = "system.parallel-write-fan-in";
const PARALLEL_WRITE_CAPABILITY = "parallelWriteFanIn";
const RESTART_DELIVERY_TASK_ID = "system.restart-delivery-reconciliation";
const RESTART_DELIVERY_CAPABILITY = "restartDeliveryReconciliation";
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SENSITIVE_ASSIGNMENT_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie)\s*[:=]/gi;
const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");

export async function createCodingAgentBenchmarkV3SystemHarness(options = {}, dependencies = {}) {
  const resolveBrowserExecutable = dependencies.resolveBrowserExecutable ?? resolveBenchmarkBrowserExecutable;
  const resolveWorkflowBatchRunner = dependencies.resolveWorkflowBatchRunner
    ?? resolveBenchmarkWorkflowBatchRunner;
  const resolveParallelWriteRuntimes = dependencies.resolveParallelWriteRuntimes
    ?? resolveBenchmarkParallelWriteRuntimes;
  const resolveRestartDeliveryRuntimes = dependencies.resolveRestartDeliveryRuntimes
    ?? resolveBenchmarkRestartDeliveryRuntimes;
  const [executablePath, workflowBatchRunner, parallelWriteRuntimes, restartDeliveryRuntimes] = await Promise.all([
    resolveBrowserExecutable(options).catch(() => null),
    resolveWorkflowBatchRunner(options).catch(() => null),
    resolveParallelWriteRuntimes(options).catch(() => null),
    resolveRestartDeliveryRuntimes(options).catch(() => null),
  ]);
  const browserExecutablePath = typeof executablePath === "string" && executablePath.trim()
    ? executablePath.trim()
    : null;
  const parallelReadRunner = typeof workflowBatchRunner === "function" ? workflowBatchRunner : null;
  const parallelWriteDependencies = parallelReadRunner
    && typeof parallelWriteRuntimes?.ManagedWorktreeRuntime === "function"
    && typeof parallelWriteRuntimes?.UserWorktreeRuntime === "function"
    ? {
        runWorkflowBatch: parallelReadRunner,
        ManagedWorktreeRuntime: parallelWriteRuntimes.ManagedWorktreeRuntime,
        UserWorktreeRuntime: parallelWriteRuntimes.UserWorktreeRuntime,
      }
    : null;
  const runBrowserScenario = dependencies.runBrowserScenario ?? runPuppeteerBrowserScenario;

  return Object.freeze({
    capabilities: Object.freeze({
      browserBehavior: browserExecutablePath !== null,
      parallelReadIsolation: parallelReadRunner !== null,
      parallelWriteFanIn: parallelWriteDependencies !== null,
      restartDeliveryReconciliation: restartDeliveryRuntimes !== null,
    }),
    async execute(input) {
      if (input?.scenario?.requiredCapability === BROWSER_CAPABILITY
        && input?.task?.id === BROWSER_TASK_ID) {
        if (!browserExecutablePath) {
          throw new Error("Coding benchmark browser behavior harness is unavailable.");
        }
        return await executeBrowserBehaviorHarness({
          ...input,
          executablePath: browserExecutablePath,
        }, { runBrowserScenario });
      }
      if (input?.scenario?.requiredCapability === PARALLEL_READ_CAPABILITY
        && input?.task?.id === PARALLEL_READ_TASK_ID) {
        if (!parallelReadRunner) {
          throw new Error("Coding benchmark parallel read isolation harness is unavailable.");
        }
        return await executeParallelReadIsolationHarness({
          ...input,
          barrierTimeoutMs: options.parallelReadBarrierTimeoutMs,
        }, { runWorkflowBatch: parallelReadRunner });
      }
      if (input?.scenario?.requiredCapability === PARALLEL_WRITE_CAPABILITY
        && input?.task?.id === PARALLEL_WRITE_TASK_ID) {
        if (!parallelWriteDependencies) {
          throw new Error("Coding benchmark parallel write fan-in harness is unavailable.");
        }
        return await executeParallelWriteFanInHarness({
          ...input,
          barrierTimeoutMs: options.parallelWriteBarrierTimeoutMs,
        }, parallelWriteDependencies);
      }
      if (input?.scenario?.requiredCapability === RESTART_DELIVERY_CAPABILITY
        && input?.task?.id === RESTART_DELIVERY_TASK_ID) {
        if (!restartDeliveryRuntimes) {
          throw new Error("Coding benchmark restart delivery reconciliation harness is unavailable.");
        }
        return await executeRestartDeliveryReconciliationHarness({
          ...input,
          failurePhase: options.restartDeliveryFailurePhase,
          processTimeoutMs: options.restartDeliveryProcessTimeoutMs,
        }, restartDeliveryRuntimes);
      }
      throw new Error(`Coding benchmark native system harness does not support task ${String(input?.task?.id)}.`);
    },
  });
}

export async function resolveBenchmarkWorkflowBatchRunner(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? workspaceRoot);
  const runnerPath = path.join(
    sourceRoot,
    "packages",
    "belldandy-core",
    "dist",
    "workflow-batch-runner.js",
  );
  const stats = await fs.stat(runnerPath).catch(() => null);
  if (!stats?.isFile()) return null;
  const module = await import(pathToFileURL(runnerPath).href);
  return typeof module.runWorkflowBatch === "function" ? module.runWorkflowBatch : null;
}

export async function resolveBenchmarkParallelWriteRuntimes(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? workspaceRoot);
  const managedWorktreePath = path.join(
    sourceRoot,
    "packages",
    "belldandy-core",
    "dist",
    "managed-worktree.js",
  );
  const userWorktreeRuntimePath = path.join(
    sourceRoot,
    "packages",
    "belldandy-core",
    "dist",
    "user-worktree-runtime.js",
  );
  const [managedStats, userStats] = await Promise.all([
    fs.stat(managedWorktreePath).catch(() => null),
    fs.stat(userWorktreeRuntimePath).catch(() => null),
  ]);
  if (!managedStats?.isFile() || !userStats?.isFile()) return null;
  const [managedModule, userModule] = await Promise.all([
    import(pathToFileURL(managedWorktreePath).href),
    import(pathToFileURL(userWorktreeRuntimePath).href),
  ]);
  if (typeof managedModule.ManagedWorktreeRuntime !== "function"
    || typeof userModule.UserWorktreeRuntime !== "function") return null;
  return {
    ManagedWorktreeRuntime: managedModule.ManagedWorktreeRuntime,
    UserWorktreeRuntime: userModule.UserWorktreeRuntime,
  };
}

export async function resolveBenchmarkRestartDeliveryRuntimes(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? workspaceRoot);
  const modulePaths = {
    reconciliationJournal: path.join(
      sourceRoot,
      "packages",
      "belldandy-core",
      "dist",
      "coding-run",
      "reconciliation-journal.js",
    ),
    workspaceRevision: path.join(
      sourceRoot,
      "packages",
      "belldandy-core",
      "dist",
      "workspace-revision.js",
    ),
    userWorktreeRuntime: path.join(
      sourceRoot,
      "packages",
      "belldandy-core",
      "dist",
      "user-worktree-runtime.js",
    ),
    fileTool: path.join(
      sourceRoot,
      "packages",
      "belldandy-skills",
      "dist",
      "builtin",
      "file.js",
    ),
  };
  const stats = await Promise.all(Object.values(modulePaths)
    .map((modulePath) => fs.stat(modulePath).catch(() => null)));
  if (stats.some((entry) => !entry?.isFile())) return null;
  const [journalModule, revisionModule, userWorktreeModule, fileToolModule] = await Promise.all([
    import(pathToFileURL(modulePaths.reconciliationJournal).href),
    import(pathToFileURL(modulePaths.workspaceRevision).href),
    import(pathToFileURL(modulePaths.userWorktreeRuntime).href),
    import(pathToFileURL(modulePaths.fileTool).href),
  ]);
  if (typeof journalModule.CodingRunReconciliationJournal !== "function"
    || typeof revisionModule.WorkspaceRevisionRuntime !== "function"
    || typeof userWorktreeModule.UserWorktreeRuntime !== "function"
    || typeof fileToolModule.fileWriteTool?.execute !== "function") {
    return null;
  }
  return {
    CodingRunReconciliationJournal: journalModule.CodingRunReconciliationJournal,
    UserWorktreeRuntime: userWorktreeModule.UserWorktreeRuntime,
    modulePaths,
  };
}

export async function resolveBenchmarkBrowserExecutable(options = {}) {
  const candidates = [
    options.browserExecutablePath,
    process.env.BELLDANDY_CHROME_PATH,
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate) => typeof candidate === "string" && candidate.trim());

  for (const candidate of candidates) {
    const target = candidate.trim();
    const stats = await fs.stat(target).catch(() => null);
    if (stats?.isFile()) return target;
  }
  return null;
}

async function executeBrowserBehaviorHarness(input, dependencies) {
  assertBrowserHarnessInput(input);
  const artifactDir = path.resolve(input.artifactDir);
  const screenshotPath = path.join(artifactDir, CODING_AGENT_BENCHMARK_BROWSER_SCREENSHOT_ARTIFACT);
  const scenarioResult = await dependencies.runBrowserScenario({
    executablePath: input.executablePath,
    runId: input.runId,
    platform: input.platform,
    workspace: path.resolve(input.workspace),
    artifactDir,
  });
  const screenshot = toBoundedScreenshot(scenarioResult?.screenshot);
  const consoleErrors = Array.isArray(scenarioResult?.consoleErrors)
    ? scenarioResult.consoleErrors.map((value) => String(value))
    : [];
  const domBefore = requireString(scenarioResult?.domBefore, "browser DOM before interaction");
  const domAfter = requireString(scenarioResult?.domAfter, "browser DOM after interaction");
  const probeRequestCount = requireNonNegativeInteger(
    scenarioResult?.probeRequestCount,
    "browser probe request count",
  );
  const blockedExternalRequestCount = requireNonNegativeInteger(
    scenarioResult?.blockedExternalRequestCount,
    "browser blocked external request count",
  );
  const sensitiveFindingCount = requireNonNegativeInteger(
    scenarioResult?.sensitiveFindingCount,
    "browser sensitive finding count",
  );
  const orphanResourceCount = requireNonNegativeInteger(
    scenarioResult?.orphanResourceCount,
    "browser orphan resource count",
  );
  const requestStatus = requireHttpStatus(scenarioResult?.requestStatus);
  const domAfterSha256 = sha256(domAfter);
  const screenshotSha256 = sha256(screenshot);
  const duplicateSideEffectCount = Math.max(0, probeRequestCount - 1);
  const passed = scenarioResult?.pageLoaded === true
    && consoleErrors.length === 0
    && domBefore !== domAfter
    && requestStatus === 200
    && blockedExternalRequestCount === 0
    && probeRequestCount === 1
    && sensitiveFindingCount === 0
    && orphanResourceCount === 0;

  await fs.writeFile(screenshotPath, screenshot, { flag: "wx" });
  return {
    schemaVersion: SYSTEM_EVIDENCE_VERSION,
    taskId: BROWSER_TASK_ID,
    generatorId: BROWSER_GENERATOR_ID,
    fixtureVersion: 1,
    runId: input.runId,
    platform: input.platform,
    status: passed ? "passed" : "failed",
    sensitiveFindingCount,
    orphanResourceCount,
    duplicateSideEffectCount,
    observations: {
      pageLoaded: scenarioResult.pageLoaded === true,
      consoleErrorCount: consoleErrors.length,
      domChanged: domBefore !== domAfter,
      domAfterSha256,
      requestStatus,
      networkScope: "loopback-only",
      screenshotSha256,
      screenshotBindingSha256: sha256([
        BROWSER_BINDING_VERSION,
        input.runId,
        screenshotSha256,
        domAfterSha256,
      ].join("\0")),
    },
  };
}

async function runPuppeteerBrowserScenario(input) {
  const serverState = { probeRequestCount: 0 };
  const server = createBrowserFixtureServer(serverState);
  let browser;
  let result;
  let executionError;
  try {
    const baseUrl = await listenLoopback(server);
    const allowedOrigin = new URL(baseUrl).origin;
    browser = await puppeteer.launch({
      executablePath: input.executablePath,
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 640, deviceScaleFactor: 1 });
    const consoleErrors = [];
    let blockedExternalRequestCount = 0;
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        if (new URL(request.url()).origin === allowedOrigin) {
          void request.continue();
          return;
        }
      } catch {
        // Invalid and non-HTTP request URLs are blocked below.
      }
      blockedExternalRequestCount += 1;
      void request.abort("blockedbyclient");
    });

    const navigation = await page.goto(`${baseUrl}/fixture.html`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    const domBefore = await page.$eval("#state", (element) => element.outerHTML);
    const responsePromise = page.waitForResponse((response) => {
      return response.url() === `${baseUrl}/probe` && response.request().method() === "POST";
    }, { timeout: 30_000 });
    await page.click("#verify");
    const probeResponse = await responsePromise;
    await page.waitForFunction(() => {
      return document.querySelector("#state")?.getAttribute("data-state") === "verified";
    }, { timeout: 30_000 });
    const domAfter = await page.$eval("#state", (element) => element.outerHTML);
    const screenshot = Buffer.from(await page.screenshot({ type: "png" }));
    const sensitiveFindingCount = countSensitiveFindings([domAfter, ...consoleErrors].join("\n"));
    result = {
      pageLoaded: navigation?.ok() === true,
      consoleErrors,
      domBefore,
      domAfter,
      requestStatus: probeResponse.status(),
      blockedExternalRequestCount,
      probeRequestCount: serverState.probeRequestCount,
      sensitiveFindingCount,
      orphanResourceCount: 0,
      screenshot,
    };
  } catch (error) {
    executionError = error;
  }

  const cleanupErrors = [];
  if (browser) {
    await browser.close().catch((error) => cleanupErrors.push(error));
  }
  await closeServer(server).catch((error) => cleanupErrors.push(error));
  if (executionError) throw executionError;
  if (cleanupErrors.length > 0) {
    throw new Error(`Coding benchmark browser harness cleanup failed: ${safeMessage(cleanupErrors[0])}`);
  }
  return result;
}

function createBrowserFixtureServer(state) {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/fixture.html") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(browserFixtureHtml());
      return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/probe") {
      state.probeRequestCount += 1;
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("verified");
      return;
    }
    response.writeHead(404, { "cache-control": "no-store" });
    response.end("not found");
  });
}

function browserFixtureHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico">
  <title>SS browser behavior fixture</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f4f5f7; color: #15171a; }
    main { width: 560px; margin: 96px auto; padding: 32px; border: 1px solid #c6cad1; background: #fff; }
    button { padding: 10px 16px; border: 1px solid #1b5e45; background: #267c5b; color: #fff; }
    output { display: block; margin-top: 20px; padding: 12px; border: 1px solid #c6cad1; }
  </style>
</head>
<body>
  <main>
    <h1>Browser behavior fixture</h1>
    <button id="verify" type="button">Verify</button>
    <output id="state" data-state="pending">pending</output>
  </main>
  <script>
    document.querySelector("#verify").addEventListener("click", async () => {
      const response = await fetch("/probe", { method: "POST" });
      const state = document.querySelector("#state");
      state.textContent = await response.text();
      state.setAttribute("data-state", response.ok ? "verified" : "failed");
    });
  </script>
</body>
</html>`;
}

async function listenLoopback(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Coding benchmark browser harness did not obtain a loopback port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function assertBrowserHarnessInput(input) {
  if (input?.scenario?.schemaVersion !== SYSTEM_SCENARIO_VERSION
    || input.scenario.taskId !== BROWSER_TASK_ID
    || input.scenario.generatorId !== BROWSER_GENERATOR_ID
    || input.scenario.fixtureVersion !== 1
    || input.scenario.requiredCapability !== BROWSER_CAPABILITY
    || input.scenario.evidenceSchemaVersion !== SYSTEM_EVIDENCE_VERSION) {
    throw new Error("Coding benchmark browser harness scenario contract drifted.");
  }
  if (input.task?.id !== BROWSER_TASK_ID
    || input.task?.fixture?.generatorId !== BROWSER_GENERATOR_ID
    || input.task?.fixture?.version !== 1) {
    throw new Error("Coding benchmark browser harness task contract drifted.");
  }
  if (input.platform !== input.scenario.platform
    || (input.platform !== "windows-native" && input.platform !== "wsl2-linux")) {
    throw new Error("Coding benchmark browser harness platform binding drifted.");
  }
  if (typeof input.runId !== "string" || !RUN_ID_PATTERN.test(input.runId) || input.runId.length > 200) {
    throw new Error("Coding benchmark browser harness run binding is invalid.");
  }
  for (const field of ["workspace", "artifactDir"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new Error(`Coding benchmark browser harness ${field} is required.`);
    }
  }
}

function toBoundedScreenshot(value) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    throw new Error("Coding benchmark browser harness did not produce a screenshot.");
  }
  const screenshot = Buffer.from(value);
  if (screenshot.length === 0 || screenshot.length > MAX_BROWSER_SCREENSHOT_BYTES) {
    throw new Error("Coding benchmark browser harness screenshot size is invalid.");
  }
  return screenshot;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
  return value;
}

function requireHttpStatus(value) {
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error("Browser request status is invalid.");
  }
  return value;
}

function countSensitiveFindings(value) {
  return [...String(value).matchAll(SENSITIVE_ASSIGNMENT_PATTERN)].length;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
