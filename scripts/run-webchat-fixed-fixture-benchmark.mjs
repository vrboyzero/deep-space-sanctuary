import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import puppeteer from "puppeteer-core";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webPublicDir = path.join(workspaceRoot, "apps", "web", "public");
const defaultOutput = "artifacts/benchmarks/b00-webchat-fixed-fixture.json";
const defaultMessageCounts = [100, 1_000];
const defaultMessageBytes = 256;
const defaultViewport = { width: 1_280, height: 720 };
const minimumStartupResourceCount = 10;
const expectedRenderModuleResourceCount = 6;
const startupCacheModes = ["cold", "hot"];
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseCount(value, label, { allowZero = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseWebchatFixedFixtureBenchmarkArgs(argv) {
  const args = {
    output: defaultOutput,
    warmupRuns: 1,
    sampleRuns: 5,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;

    if (argument === "--output") {
      args.output = value;
    } else if (argument === "--warmup-runs") {
      args.warmupRuns = parseCount(value, argument, { allowZero: true, maximum: 20 });
    } else if (argument === "--sample-runs") {
      args.sampleRuns = parseCount(value, argument, { maximum: 20 });
    } else {
      throw new Error(`Unsupported argument ${argument}.`);
    }
  }

  return args;
}

function normalizeFixtureCounts(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one value.`);
  }
  const normalized = value.map((entry, index) => parseCount(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function requireNumber(value, label, { minimum = 0 } = {}) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number greater than or equal to ${minimum}.`);
  }
  return Number(value);
}

function requireSamples(samples, expectedCount, scenarioId) {
  if (!Array.isArray(samples) || samples.length !== expectedCount) {
    throw new Error(`${scenarioId} must contain exactly ${expectedCount} samples.`);
  }
}

function summarizeValues(values, unit) {
  const sorted = values.slice().sort((left, right) => left - right);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((total, sample) => total + sample, 0) / sampleCount;
  const variance = sorted.reduce(
    (total, sample) => total + ((sample - mean) ** 2),
    0,
  ) / sampleCount;
  const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sampleCount) - 1)];

  return {
    unit,
    sampleCount,
    min: round(sorted[0]),
    max: round(sorted[sampleCount - 1]),
    mean: round(mean),
    median: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    variance: round(variance),
    standardDeviation: round(Math.sqrt(variance)),
    percentileMethod: "nearest-rank",
    varianceMethod: "population",
  };
}

function normalizeStartupScenario(scenario, sampleRuns, minimumResourceCount) {
  if (scenario.target !== "full_shell") {
    throw new Error(`${scenario.id}.target must equal full_shell.`);
  }
  const operationCount = parseCount(scenario.operationCount, `${scenario.id}.operationCount`);
  if (operationCount !== 1) {
    throw new Error(`${scenario.id}.operationCount must equal 1.`);
  }
  requireSamples(scenario.samples, sampleRuns, scenario.id);
  const samples = scenario.samples.map((sample, index) => {
    const prefix = `${scenario.id}.samples[${index}]`;
    const durationMs = requireNumber(sample?.durationMs, `${prefix}.durationMs`);
    const resourceCount = parseCount(sample?.resourceCount, `${prefix}.resourceCount`);
    if (resourceCount < minimumResourceCount) {
      throw new Error(`${prefix}.resourceCount must be at least ${minimumResourceCount}.`);
    }
    const startupMarkCount = parseCount(sample?.startupMarkCount, `${prefix}.startupMarkCount`);
    const domNodeCount = parseCount(sample?.domNodeCount, `${prefix}.domNodeCount`);
    const assetGlobalCount = parseCount(sample?.assetGlobalCount, `${prefix}.assetGlobalCount`);
    if (assetGlobalCount !== 3 || sample?.appBootstrapReady !== true || sample?.appShellPresent !== true) {
      throw new Error(`${prefix} did not reach the expected full WebChat shell state.`);
    }
    if (
      sample?.firstInteractionName !== "theme_toggle"
      || sample?.firstInteractionStateChanged !== true
    ) {
      throw new Error(`${prefix} did not complete the fixed first interaction.`);
    }
    if (sample?.panelId !== "settings" || sample?.panelVisible !== true) {
      throw new Error(`${prefix} did not complete the fixed Settings first-open interaction.`);
    }
    if (
      sample?.experiencePanelId !== "experience"
      || sample?.experiencePanelVisible !== true
      || sample?.experienceModuleLoadedBeforeOpen !== false
      || sample?.experienceModuleLoaded !== true
      || sample?.experienceContentReady !== true
    ) {
      throw new Error(`${prefix} did not complete the Experience first-open interaction.`);
    }
    const experienceResourceDelta = parseCount(
      sample?.experienceResourceDelta,
      `${prefix}.experienceResourceDelta`,
    );
    const pageErrorCount = parseCount(
      sample?.pageErrorCount,
      `${prefix}.pageErrorCount`,
      { allowZero: true },
    );
    if (pageErrorCount !== 0) {
      throw new Error(`${prefix} raised a page error during full-shell startup.`);
    }
    return {
      durationMs: round(durationMs),
      resourceCount,
      transferSizeBytes: Math.round(requireNumber(sample?.transferSizeBytes, `${prefix}.transferSizeBytes`)),
      decodedBodySizeBytes: Math.round(requireNumber(sample?.decodedBodySizeBytes, `${prefix}.decodedBodySizeBytes`)),
      startupMarkCount,
      domNodeCount,
      assetGlobalCount,
      appBootstrapReady: true,
      appShellPresent: true,
      firstInteractionName: "theme_toggle",
      firstInteractionDurationMs: round(requireNumber(
        sample?.firstInteractionDurationMs,
        `${prefix}.firstInteractionDurationMs`,
      )),
      firstInteractionStateChanged: true,
      panelId: "settings",
      panelFirstOpenDurationMs: round(requireNumber(
        sample?.panelFirstOpenDurationMs,
        `${prefix}.panelFirstOpenDurationMs`,
      )),
      panelVisible: true,
      panelResourceDelta: parseCount(
        sample?.panelResourceDelta,
        `${prefix}.panelResourceDelta`,
        { allowZero: true },
      ),
      panelDomNodeDelta: parseCount(
        sample?.panelDomNodeDelta,
        `${prefix}.panelDomNodeDelta`,
        { allowZero: true },
      ),
      experiencePanelId: "experience",
      experienceFirstOpenDurationMs: round(requireNumber(
        sample?.experienceFirstOpenDurationMs,
        `${prefix}.experienceFirstOpenDurationMs`,
      )),
      experiencePanelVisible: true,
      experienceModuleLoadedBeforeOpen: false,
      experienceModuleLoaded: true,
      experienceContentReady: true,
      experienceResourceDelta,
      experienceDomNodeDelta: Math.round(requireNumber(
        sample?.experienceDomNodeDelta,
        `${prefix}.experienceDomNodeDelta`,
        { minimum: Number.MIN_SAFE_INTEGER },
      )),
      pageErrorCount,
    };
  });
  return {
    id: scenario.id,
    kind: "startup",
    target: "full_shell",
    cacheMode: scenario.cacheMode,
    operationCount,
    samples,
    summary: summarizeValues(samples.map((sample) => sample.durationMs), "milliseconds_per_fixture"),
    transferSummary: summarizeValues(
      samples.map((sample) => sample.transferSizeBytes),
      "bytes_per_fixture",
    ),
    resourceCountSummary: summarizeValues(
      samples.map((sample) => sample.resourceCount),
      "resources_per_fixture",
    ),
    domNodeSummary: summarizeValues(
      samples.map((sample) => sample.domNodeCount),
      "dom_nodes_per_fixture",
    ),
    firstInteractionSummary: summarizeValues(
      samples.map((sample) => sample.firstInteractionDurationMs),
      "milliseconds_per_fixture",
    ),
    panelFirstOpenSummary: summarizeValues(
      samples.map((sample) => sample.panelFirstOpenDurationMs),
      "milliseconds_per_fixture",
    ),
    panelResourceDeltaSummary: summarizeValues(
      samples.map((sample) => sample.panelResourceDelta),
      "resources_per_fixture",
    ),
    panelDomNodeDeltaSummary: summarizeValues(
      samples.map((sample) => sample.panelDomNodeDelta),
      "dom_nodes_per_fixture",
    ),
    experienceFirstOpenSummary: summarizeValues(
      samples.map((sample) => sample.experienceFirstOpenDurationMs),
      "milliseconds_per_fixture",
    ),
    experienceResourceDeltaSummary: summarizeValues(
      samples.map((sample) => sample.experienceResourceDelta),
      "resources_per_fixture",
    ),
    experienceDomNodeDeltaSummary: summarizeValues(
      samples.map((sample) => sample.experienceDomNodeDelta),
      "dom_nodes_per_fixture",
    ),
  };
}

function normalizeRenderScenario(scenario, sampleRuns, messageBytes) {
  const messageCount = parseCount(scenario.messageCount, `${scenario.id}.messageCount`);
  const resultCount = parseCount(scenario.resultCount, `${scenario.id}.resultCount`);
  const wrapperCount = parseCount(scenario.wrapperCount, `${scenario.id}.wrapperCount`);
  const assistantBodyCount = parseCount(
    scenario.assistantBodyCount,
    `${scenario.id}.assistantBodyCount`,
    { allowZero: true },
  );
  if (resultCount !== messageCount || wrapperCount !== messageCount) {
    throw new Error(`${scenario.id} must render exactly one wrapper per configured message.`);
  }
  if (assistantBodyCount !== Math.floor(messageCount / 2)) {
    throw new Error(`${scenario.id}.assistantBodyCount does not match the alternating fixture.`);
  }
  requireSamples(scenario.samples, sampleRuns, scenario.id);
  const samples = scenario.samples.map((sample, index) => {
    const prefix = `${scenario.id}.samples[${index}]`;
    return {
      durationMs: round(requireNumber(sample?.durationMs, `${prefix}.durationMs`)),
      syncDurationMs: round(requireNumber(sample?.syncDurationMs, `${prefix}.syncDurationMs`)),
      heapDeltaBytes: Math.round(requireNumber(
        sample?.heapDeltaBytes,
        `${prefix}.heapDeltaBytes`,
        { minimum: Number.MIN_SAFE_INTEGER },
      )),
      domNodeCount: parseCount(sample?.domNodeCount, `${prefix}.domNodeCount`),
    };
  });
  return {
    id: scenario.id,
    kind: "render",
    messageCount,
    messageBytes,
    resultCount,
    wrapperCount,
    assistantBodyCount,
    samples,
    summary: summarizeValues(samples.map((sample) => sample.durationMs), "milliseconds_per_fixture"),
    syncSummary: summarizeValues(samples.map((sample) => sample.syncDurationMs), "milliseconds_per_fixture"),
    heapDeltaSummary: summarizeValues(samples.map((sample) => sample.heapDeltaBytes), "bytes_per_fixture"),
  };
}

export function createWebchatFixedFixtureBenchmarkReport({
  generatedAt,
  environment,
  source,
  fixture,
  scenarios,
}) {
  const warmupRuns = parseCount(fixture?.warmupRuns, "fixture.warmupRuns", {
    allowZero: true,
    maximum: 20,
  });
  const sampleRuns = parseCount(fixture?.sampleRuns, "fixture.sampleRuns", { maximum: 20 });
  const messageCounts = normalizeFixtureCounts(fixture?.messageCounts, "fixture.messageCounts");
  const messageBytes = parseCount(fixture?.messageBytes, "fixture.messageBytes", { maximum: 1_048_576 });
  const viewport = {
    width: parseCount(fixture?.viewport?.width, "fixture.viewport.width", { maximum: 8_192 }),
    height: parseCount(fixture?.viewport?.height, "fixture.viewport.height", { maximum: 8_192 }),
  };
  if (fixture?.startupTarget !== "full_webchat_shell") {
    throw new Error("fixture.startupTarget must equal full_webchat_shell.");
  }
  const minimumResourceCount = parseCount(
    fixture?.minimumStartupResourceCount,
    "fixture.minimumStartupResourceCount",
    { maximum: 1_000 },
  );
  const renderModuleResourceCount = parseCount(
    fixture?.renderModuleResourceCount,
    "fixture.renderModuleResourceCount",
    { maximum: 100 },
  );
  const expectedScenarioCount = startupCacheModes.length + messageCounts.length;
  if (!Array.isArray(scenarios) || scenarios.length !== expectedScenarioCount) {
    throw new Error("WebChat fixture requires cold/hot startup and every configured render scale exactly once.");
  }

  const expectedKeys = new Set([
    ...startupCacheModes.map((cacheMode) => `startup:${cacheMode}`),
    ...messageCounts.map((messageCount) => `render:${messageCount}`),
  ]);
  const normalizedScenarios = scenarios.map((scenario) => {
    if (typeof scenario?.id !== "string" || !scenario.id) {
      throw new Error("Each WebChat benchmark scenario requires an id.");
    }
    let key;
    if (scenario.kind === "startup" && startupCacheModes.includes(scenario.cacheMode)) {
      key = `startup:${scenario.cacheMode}`;
    } else if (scenario.kind === "render") {
      key = `render:${scenario.messageCount}`;
    } else {
      throw new Error(`${scenario.id} has an unsupported WebChat fixture kind.`);
    }
    if (!expectedKeys.delete(key)) {
      throw new Error(`${scenario.id} does not map to a unique configured WebChat fixture.`);
    }
    return scenario.kind === "startup"
      ? normalizeStartupScenario(scenario, sampleRuns, minimumResourceCount)
      : normalizeRenderScenario(scenario, sampleRuns, messageBytes);
  });
  if (expectedKeys.size !== 0) {
    throw new Error("WebChat fixture requires cold/hot startup and every configured render scale exactly once.");
  }

  return {
    schemaVersion: "performance-benchmark-report/v1",
    status: "completed",
    generatedAt,
    benchmark: {
      id: "webchat-fixed-fixture",
      mode: "report_only",
      adapter: "headless_chromium_loopback_fixture",
      thresholdApplied: false,
    },
    environment,
    source,
    fixture: {
      warmupRuns,
      sampleRuns,
      messageCounts,
      messageBytes,
      viewport,
      startupTarget: "full_webchat_shell",
      minimumStartupResourceCount: minimumResourceCount,
      renderModuleResourceCount,
      externalRequestCount: 0,
    },
    scenarios: normalizedScenarios,
  };
}

function buildFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WebChat benchmark fixture</title>
  </head>
  <body>
    <section class="chat-section"><div class="messages"></div></section>
    <script>window.__SS_WEBCHAT_FIXTURE_STARTED_AT__ = performance.now();</script>
    <script type="module" src="/fixture.js"></script>
  </body>
</html>`;
}

function buildFixtureModuleSource() {
  return `import { createChatUiFeature } from "/app/features/chat-ui.js";

const messagesEl = document.querySelector(".messages");
const chatSection = document.querySelector(".chat-section");
const encoder = new TextEncoder();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\\\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMessage(targetBytes) {
  const prefix = "webchat fixed benchmark message ";
  const prefixBytes = encoder.encode(prefix).byteLength;
  if (prefixBytes > targetBytes) {
    throw new Error("WebChat benchmark message prefix exceeds the fixture budget.");
  }
  const message = prefix + "x".repeat(targetBytes - prefixBytes);
  if (encoder.encode(message).byteLength !== targetBytes) {
    throw new Error("WebChat benchmark message fixture has an invalid byte length.");
  }
  return message;
}

const feature = createChatUiFeature({
  refs: { messagesEl, chatSection },
  getAgentProfile: () => ({ name: "Belldandy", avatar: "B" }),
  getUserProfile: () => ({ name: "User", avatar: "U" }),
  getCurrentAgentId: () => "default",
  revealGeneratedArtifactPath: undefined,
  escapeHtml,
  showNotice: () => {},
  getAvatarUploadHeaders: () => ({}),
  onAvatarUploaded: () => {},
  t: (_key, _params, fallback) => fallback || "",
});
const fixedMessage = buildMessage(${defaultMessageBytes});

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function readHeapBytes() {
  return Number.isFinite(performance.memory?.usedJSHeapSize)
    ? performance.memory.usedJSHeapSize
    : 0;
}

async function resetRenderFixture() {
  messagesEl.replaceChildren();
  await nextFrame();
}

async function runRender(messageCount) {
  const heapBeforeBytes = readHeapBytes();
  const startedAt = performance.now();
  for (let index = 0; index < messageCount; index += 1) {
    const kind = index % 2 === 0 ? "me" : "bot";
    const bubble = feature.appendMessage(kind, fixedMessage, {
      timestampMs: 1_700_000_000_000 + index,
      isLatest: index === messageCount - 1,
    });
    if (kind === "bot") {
      feature.renderAssistantMessage(bubble, fixedMessage);
    }
  }
  const syncDurationMs = performance.now() - startedAt;
  await nextFrame();
  const durationMs = performance.now() - startedAt;
  const heapAfterBytes = readHeapBytes();
  return {
    durationMs,
    syncDurationMs,
    heapDeltaBytes: heapAfterBytes - heapBeforeBytes,
    domNodeCount: document.querySelectorAll("*").length,
    resultCount: messagesEl.children.length,
    wrapperCount: messagesEl.querySelectorAll(".msg-wrapper").length,
    assistantBodyCount: messagesEl.querySelectorAll(".msg-wrapper.bot .msg-body").length,
  };
}

function readStartupSample() {
  const resources = performance.getEntriesByType("resource")
    .filter((entry) => entry.initiatorType === "script");
  return {
    durationMs: performance.now() - window.__SS_WEBCHAT_FIXTURE_STARTED_AT__,
    resourceCount: resources.length,
    transferSizeBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
    decodedBodySizeBytes: resources.reduce((total, entry) => total + (entry.decodedBodySize || 0), 0),
  };
}

window.__SS_WEBCHAT_BENCHMARK__ = {
  resetRenderFixture,
  runRender,
  readStartupSample,
};
window.__SS_WEBCHAT_BENCHMARK_READY__ = true;
`;
}

function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(parentDir, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function createFixtureServer() {
  const fixtureHtml = buildFixtureHtml();
  const fixtureModule = buildFixtureModuleSource();
  return http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/fixture.html") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(fixtureHtml);
        return;
      }
      if (requestUrl.pathname === "/fixture.js") {
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=3600, immutable",
        });
        response.end(fixtureModule);
        return;
      }
      if (requestUrl.pathname.startsWith("/app/")) {
        const filePath = path.resolve(webPublicDir, decodeURIComponent(requestUrl.pathname.slice(1)));
        if (!isPathInside(webPublicDir, filePath)) {
          response.writeHead(403).end();
          return;
        }
        const content = await fs.readFile(filePath);
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=3600, immutable",
        });
        response.end(content);
        return;
      }
      const relativePath = requestUrl.pathname === "/"
        ? "index.html"
        : decodeURIComponent(requestUrl.pathname.slice(1));
      const filePath = path.resolve(webPublicDir, relativePath);
      if (!isPathInside(webPublicDir, filePath)) {
        response.writeHead(403).end();
        return;
      }
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
        "cache-control": relativePath === "index.html"
          ? "no-store"
          : "public, max-age=3600, immutable",
      });
      response.end(content);
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("WebChat fixture server did not expose a loopback port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function resolveChromeExecutable() {
  const candidates = [
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
      return candidate;
    } catch {
      // Continue through the explicit and platform-default candidates.
    }
  }
  throw new Error("Chrome executable not found. Set BELLDANDY_CHROME_PATH or CHROME_BIN.");
}

async function navigateRenderFixture(page, baseUrl, sequence) {
  await page.goto(`${baseUrl}/fixture.html?sample=${sequence}`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  const ready = await page.evaluate(() => globalThis.__SS_WEBCHAT_BENCHMARK_READY__ === true);
  if (!ready) {
    throw new Error("WebChat fixed fixture did not initialize its production ChatUi module.");
  }
  return page.evaluate(() => globalThis.__SS_WEBCHAT_BENCHMARK__.readStartupSample());
}

async function navigateFullShell(page, pageErrors, baseUrl, sequence) {
  const pageErrorStart = pageErrors.length;
  await page.goto(`${baseUrl}/?sample=${sequence}`, {
    waitUntil: "load",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => globalThis.__SS_WEBCHAT_STARTUP__?.marks?.some((mark) => mark?.stage === "app.bootstrap.ready"),
    { timeout: 30_000 },
  );
  const sample = await page.evaluate(async () => {
    const startup = globalThis.__SS_WEBCHAT_STARTUP__;
    const marks = Array.isArray(startup?.marks) ? startup.marks : [];
    const readyMark = marks.findLast((mark) => mark?.stage === "app.bootstrap.ready");
    const resources = performance.getEntriesByType("resource");
    const startupDomNodeCount = document.querySelectorAll("*").length;
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const themeToggle = document.querySelector("#themeToggleBtn");
    const themeBefore = document.documentElement.dataset.theme || "";
    const firstInteractionStartedAt = performance.now();
    themeToggle?.click();
    await nextFrame();
    const firstInteractionDurationMs = performance.now() - firstInteractionStartedAt;
    const themeAfter = document.documentElement.dataset.theme || "";

    const openSettings = document.querySelector("#openSettings");
    const settingsModal = document.querySelector("#settingsModal");
    const panelResourcesBefore = performance.getEntriesByType("resource").length;
    const panelDomNodesBefore = document.querySelectorAll("*").length;
    const panelFirstOpenStartedAt = performance.now();
    openSettings?.click();
    await nextFrame();
    const panelFirstOpenDurationMs = performance.now() - panelFirstOpenStartedAt;
    const panelResourcesAfter = performance.getEntriesByType("resource").length;
    const panelDomNodesAfter = document.querySelectorAll("*").length;
    const panelVisible = Boolean(settingsModal) && !settingsModal.classList.contains("hidden");

    document.querySelector("#closeSettings")?.click();
    await nextFrame();
    const experienceButton = document.querySelector("#switchExperience");
    const experienceSection = document.querySelector("#experienceWorkbenchSection");
    const experienceContent = document.querySelector("#experienceWorkbenchCapabilityOverview");
    const experienceContentBefore = experienceContent?.textContent || "";
    const experienceResourcesBefore = performance.getEntriesByType("resource");
    const isExperienceModuleResource = (entry) => {
      try {
        return new URL(entry?.name || "").pathname.endsWith("/app/features/experience-workbench.js");
      } catch {
        return false;
      }
    };
    const experienceModuleLoadedBeforeOpen = experienceResourcesBefore.some(isExperienceModuleResource);
    const experienceDomNodesBefore = document.querySelectorAll("*").length;
    const experienceFirstOpenStartedAt = performance.now();
    experienceButton?.click();
    const experienceDeadline = performance.now() + 10_000;
    let experienceModuleLoaded = false;
    let experienceContentReady = false;
    let experiencePanelVisible = false;
    while (performance.now() < experienceDeadline) {
      const currentResources = performance.getEntriesByType("resource");
      experienceModuleLoaded = currentResources.some(isExperienceModuleResource);
      experienceContentReady = Boolean(experienceContent)
        && (experienceContent.textContent || "") !== experienceContentBefore;
      experiencePanelVisible = Boolean(experienceSection)
        && !experienceSection.classList.contains("hidden");
      if (experienceModuleLoaded && experienceContentReady && experiencePanelVisible) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await nextFrame();
    const experienceFirstOpenDurationMs = performance.now() - experienceFirstOpenStartedAt;
    const experienceResourcesAfter = performance.getEntriesByType("resource").length;
    const experienceDomNodesAfter = document.querySelectorAll("*").length;
    return {
      durationMs: readyMark.atMs - startup.parseStartedAtMs,
      resourceCount: resources.length,
      transferSizeBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
      decodedBodySizeBytes: resources.reduce((total, entry) => total + (entry.decodedBodySize || 0), 0),
      startupMarkCount: marks.length,
      domNodeCount: startupDomNodeCount,
      assetGlobalCount: [globalThis.marked, globalThis.dagre, globalThis.DOMPurify]
        .filter(Boolean).length,
      appBootstrapReady: Boolean(readyMark),
      appShellPresent: Boolean(document.querySelector("main.layout")),
      firstInteractionName: "theme_toggle",
      firstInteractionDurationMs,
      firstInteractionStateChanged: Boolean(themeToggle) && themeBefore !== themeAfter,
      panelId: "settings",
      panelFirstOpenDurationMs,
      panelVisible,
      panelResourceDelta: panelResourcesAfter - panelResourcesBefore,
      panelDomNodeDelta: panelDomNodesAfter - panelDomNodesBefore,
      experiencePanelId: "experience",
      experienceFirstOpenDurationMs,
      experiencePanelVisible,
      experienceModuleLoadedBeforeOpen,
      experienceModuleLoaded,
      experienceContentReady,
      experienceResourceDelta: experienceResourcesAfter - experienceResourcesBefore.length,
      experienceDomNodeDelta: experienceDomNodesAfter - experienceDomNodesBefore,
    };
  });
  return {
    ...sample,
    pageErrorCount: pageErrors.length - pageErrorStart,
  };
}

async function runStartupScenario(
  page,
  pageErrors,
  baseUrl,
  cacheMode,
  warmupRuns,
  sampleRuns,
  sequenceRef,
) {
  await page.setCacheEnabled(cacheMode === "hot");
  if (cacheMode === "hot") {
    await navigateFullShell(page, pageErrors, baseUrl, sequenceRef.value++);
  }
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:webchat-fixture] startup_${cacheMode} warm-up ${index + 1}/${warmupRuns}`);
    await navigateFullShell(page, pageErrors, baseUrl, sequenceRef.value++);
  }
  const samples = [];
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:webchat-fixture] startup_${cacheMode} sample ${index + 1}/${sampleRuns}`);
    samples.push(await navigateFullShell(page, pageErrors, baseUrl, sequenceRef.value++));
  }
  return {
    id: `startup_${cacheMode}`,
    kind: "startup",
    target: "full_shell",
    cacheMode,
    operationCount: 1,
    samples,
  };
}

async function runRenderSample(page, cdpSession, messageCount) {
  await page.evaluate(() => globalThis.__SS_WEBCHAT_BENCHMARK__.resetRenderFixture());
  await cdpSession.send("HeapProfiler.collectGarbage");
  return page.evaluate(
    (count) => globalThis.__SS_WEBCHAT_BENCHMARK__.runRender(count),
    messageCount,
  );
}

async function runRenderScenario(page, cdpSession, messageCount, warmupRuns, sampleRuns) {
  for (let index = 0; index < warmupRuns; index += 1) {
    console.log(`[benchmark:webchat-fixture] render_${messageCount} warm-up ${index + 1}/${warmupRuns}`);
    await runRenderSample(page, cdpSession, messageCount);
  }
  const samples = [];
  let counters = null;
  for (let index = 0; index < sampleRuns; index += 1) {
    console.log(`[benchmark:webchat-fixture] render_${messageCount} sample ${index + 1}/${sampleRuns}`);
    const sample = await runRenderSample(page, cdpSession, messageCount);
    const currentCounters = {
      resultCount: sample.resultCount,
      wrapperCount: sample.wrapperCount,
      assistantBodyCount: sample.assistantBodyCount,
    };
    if (counters === null) {
      counters = currentCounters;
    } else if (JSON.stringify(currentCounters) !== JSON.stringify(counters)) {
      throw new Error(`render_${messageCount} returned unstable DOM counters.`);
    }
    samples.push({
      durationMs: sample.durationMs,
      syncDurationMs: sample.syncDurationMs,
      heapDeltaBytes: sample.heapDeltaBytes,
      domNodeCount: sample.domNodeCount,
    });
  }
  return {
    id: `render_${messageCount}`,
    kind: "render",
    messageCount,
    ...counters,
    samples,
  };
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function readGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

async function collectReportContext(browser) {
  const rootPackage = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf-8"));
  const cpus = os.cpus();
  const status = readGit(["status", "--porcelain"]);
  return {
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      packageManager: rootPackage.packageManager,
      browserVersion: await browser.version(),
      cpuModel: cpus[0]?.model ?? "unknown",
      logicalCpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
      ci: process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.GITHUB_ACTIONS),
    },
    source: {
      commit: readGit(["rev-parse", "HEAD"]),
      workspaceDirty: status === null ? null : status.length > 0,
      lockfileSha256: await sha256File(path.join(workspaceRoot, "pnpm-lock.yaml")),
    },
  };
}

async function writeReport(outputPath, report) {
  const resolvedOutput = path.resolve(workspaceRoot, outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return resolvedOutput;
}

function printHelp() {
  console.log(`Usage: node scripts/run-webchat-fixed-fixture-benchmark.mjs [options]

Options:
  --output <path>       JSON report path (default: ${defaultOutput})
  --warmup-runs <n>     Warm-up runs per fixture (default: 1)
  --sample-runs <n>     Measured runs per fixture (default: 5)
  --help                Show this help message`);
}

async function main() {
  const args = parseWebchatFixedFixtureBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const executablePath = await resolveChromeExecutable();
  const server = createFixtureServer();
  let browser;
  try {
    const baseUrl = await listen(server);
    const allowedOrigin = new URL(baseUrl).origin;
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--enable-precise-memory-info",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
    const page = await browser.newPage();
    await page.setViewport(defaultViewport);
    let externalRequestCount = 0;
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      try {
        if (new URL(request.url()).origin === allowedOrigin) {
          void request.continue();
          return;
        }
      } catch {
        // Invalid or non-HTTP URLs are blocked below.
      }
      externalRequestCount += 1;
      void request.abort("blockedbyclient");
    });

    const sequenceRef = { value: 1 };
    const scenarios = [];
    for (const cacheMode of startupCacheModes) {
      scenarios.push(await runStartupScenario(
        page,
        pageErrors,
        baseUrl,
        cacheMode,
        args.warmupRuns,
        args.sampleRuns,
        sequenceRef,
      ));
    }
    await page.setCacheEnabled(true);
    const renderFixtureStartup = await navigateRenderFixture(page, baseUrl, sequenceRef.value++);
    if (renderFixtureStartup.resourceCount !== expectedRenderModuleResourceCount) {
      throw new Error(
        `WebChat render fixture loaded ${renderFixtureStartup.resourceCount} module resources; expected ${expectedRenderModuleResourceCount}.`,
      );
    }
    const cdpSession = await page.createCDPSession();
    await cdpSession.send("HeapProfiler.enable");
    for (const messageCount of defaultMessageCounts) {
      scenarios.push(await runRenderScenario(
        page,
        cdpSession,
        messageCount,
        args.warmupRuns,
        args.sampleRuns,
      ));
    }
    await cdpSession.detach();
    if (externalRequestCount !== 0) {
      throw new Error(`WebChat fixture attempted ${externalRequestCount} non-loopback page requests.`);
    }

    const context = await collectReportContext(browser);
    const report = createWebchatFixedFixtureBenchmarkReport({
      generatedAt: new Date().toISOString(),
      environment: context.environment,
      source: context.source,
      fixture: {
        warmupRuns: args.warmupRuns,
        sampleRuns: args.sampleRuns,
        messageCounts: defaultMessageCounts,
        messageBytes: defaultMessageBytes,
        viewport: defaultViewport,
        startupTarget: "full_webchat_shell",
        minimumStartupResourceCount,
        renderModuleResourceCount: expectedRenderModuleResourceCount,
      },
      scenarios,
    });
    const outputPath = await writeReport(args.output, report);
    for (const scenario of report.scenarios) {
      console.log(
        `[benchmark:webchat-fixture] ${scenario.id}: median=${scenario.summary.median}ms p95=${scenario.summary.p95}ms samples=${scenario.summary.sampleCount}`,
      );
    }
    console.log(`[benchmark:webchat-fixture] report-only: ${outputPath}`);
  } finally {
    await browser?.close().catch(() => {});
    await closeServer(server).catch(() => {});
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[benchmark:webchat-fixture] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
