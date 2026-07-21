import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webPublicDir = path.join(repoRoot, "apps", "web", "public");
const WEBCHAT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "media-src 'self' https:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
].join("; ");
const TRUSTED_TYPES_CSP = `${WEBCHAT_CSP}; trusted-types belldandy-web-assets belldandy-rich-content dompurify; require-trusted-types-for 'script'`;
const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const RICH_CONTENT_FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script src="/assets/web-assets-manifest.js"></script>
  <script src="/assets/web-assets-loader.js"></script>
  <script type="module" src="/__webchat-rich-content-fixture__.js"></script>
</head>
<body><main id="fixture-target"></main></body>
</html>`;

const RICH_CONTENT_FIXTURE_SOURCE = `
await window.__BELLDANDY_WEB_ASSETS_READY__;
const { sanitizeRichContent } = await import("/app/features/rich-content-renderer.js");
const target = document.querySelector("#fixture-target");
const richHtml = sanitizeRichContent('<strong>safe</strong><div class="css-url-probe" style="background-image:url(/__webchat-css-url-probe__.png)">probe</div><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(1)">blocked</a>');
target.innerHTML = richHtml;
window.__WEBCHAT_SECURITY_FIXTURE__ = {
  html: target.innerHTML,
  hasSafeMarkup: target.querySelector("strong")?.textContent === "safe",
  hasInlineStyle: target.querySelector(".css-url-probe")?.hasAttribute("style"),
  hasScript: Boolean(target.querySelector("script")),
  hasEventHandler: Boolean(target.querySelector("[onerror]")),
  hasUnsafeLink: Boolean(target.querySelector('a[href^="javascript:"]')),
  hasUnsafeMedia: Boolean(target.querySelector('img[src]')),
};
`;

function isWithinWebPublicDir(filePath) {
  const relative = path.relative(webPublicDir, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 尝试下一个平台默认位置或显式配置路径。
    }
  }
  throw new Error("Chrome/Chromium is required for the WebChat security fixture. Set BELLDANDY_CHROME_PATH when it is not installed in a default location.");
}

function createFixtureServer() {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const fixturePolicy = pathname.startsWith("/__webchat-rich-content-fixture__")
      ? TRUSTED_TYPES_CSP
      : WEBCHAT_CSP;
    try {
      if (pathname === "/__webchat-rich-content-fixture__.html") {
        res.writeHead(200, { "content-security-policy": TRUSTED_TYPES_CSP, "content-type": "text/html" });
        res.end(RICH_CONTENT_FIXTURE_HTML);
        return;
      }
      if (pathname === "/__webchat-rich-content-fixture__.js") {
        res.writeHead(200, { "content-security-policy": TRUSTED_TYPES_CSP, "content-type": "text/javascript" });
        res.end(RICH_CONTENT_FIXTURE_SOURCE);
        return;
      }
      const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
      const filePath = path.resolve(webPublicDir, relativePath);
      if (!isWithinWebPublicDir(filePath)) throw new Error("Path escapes WebChat public directory.");
      const content = await fs.readFile(filePath);
      res.writeHead(200, {
        "content-security-policy": fixturePolicy,
        "content-type": CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404, { "content-security-policy": fixturePolicy, "content-type": "text/plain" });
      res.end("Not found");
    }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Security fixture server did not expose a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function openSecurityPage(browser, url) {
  const page = await browser.newPage();
  const violations = [];
  const pageErrors = [];
  const requestedUrls = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.evaluateOnNewDocument(() => {
    window.__WEBCHAT_POLICY_VIOLATIONS__ = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__WEBCHAT_POLICY_VIOLATIONS__.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
      });
    });
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  violations.push(...await page.evaluate(() => window.__WEBCHAT_POLICY_VIOLATIONS__));
  return { page, pageErrors, requestedUrls, violations };
}

function assertNoSecurityFailures(label, violations, pageErrors) {
  if (violations.length > 0) {
    throw new Error(`${label} emitted CSP/Trusted Types violations: ${JSON.stringify(violations)}`);
  }
  const policyErrors = pageErrors.filter((message) => /trusted(html|scripturl)|content security policy|csp/i.test(message));
  if (policyErrors.length > 0) {
    throw new Error(`${label} raised security-policy errors: ${policyErrors.join(" | ")}`);
  }
}

async function main() {
  const executablePath = await resolveChromeExecutable();
  const server = createFixtureServer();
  const baseUrl = await listen(server);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-default-browser-check", "--no-first-run"],
  });

  try {
    const shell = await openSecurityPage(browser, `${baseUrl}/`);
    try {
      const shellState = await shell.page.evaluate(() => ({
        startupReady: Boolean(window.__SS_WEBCHAT_STARTUP__),
        assetsReady: Boolean(window.DOMPurify && window.marked && window.dagre),
        appShellPresent: Boolean(document.querySelector("main.layout")),
      }));
      if (!shellState.startupReady || !shellState.assetsReady || !shellState.appShellPresent) {
        throw new Error(`WebChat CSP fixture did not reach the expected shell state: ${JSON.stringify(shellState)}`);
      }
      assertNoSecurityFailures("WebChat CSP fixture", shell.violations, shell.pageErrors);
    } finally {
      await shell.page.close();
    }

    const richContent = await openSecurityPage(browser, `${baseUrl}/__webchat-rich-content-fixture__.html`);
    try {
      await richContent.page.waitForFunction(() => window.__WEBCHAT_SECURITY_FIXTURE__, { timeout: 10_000 });
      const richContentState = await richContent.page.evaluate(() => window.__WEBCHAT_SECURITY_FIXTURE__);
      const cssUrlProbeRequested = richContent.requestedUrls.some((url) => url.includes("/__webchat-css-url-probe__.png"));
      if (!richContentState.hasSafeMarkup || richContentState.hasInlineStyle || cssUrlProbeRequested
        || richContentState.hasScript || richContentState.hasEventHandler
        || richContentState.hasUnsafeLink || richContentState.hasUnsafeMedia) {
        throw new Error(`Rich content Trusted Types fixture rendered an unsafe result: ${JSON.stringify({ ...richContentState, cssUrlProbeRequested })}`);
      }
      assertNoSecurityFailures("Rich content Trusted Types fixture", richContent.violations, richContent.pageErrors);
    } finally {
      await richContent.page.close();
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }

  console.log(`[verify:webchat:security] CSP and Trusted Types fixtures passed with ${executablePath}`);
}

main().catch((error) => {
  console.error(`[verify:webchat:security] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
