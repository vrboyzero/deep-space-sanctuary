import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryStore } from "../../belldandy-memory/dist/index.js";
import { PtyManager } from "../../belldandy-skills/dist/builtin/system/pty.js";
import { guardedRemovePath } from "./sandbox-paths.mjs";

function getPortableContext() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const runtimeDir = path.resolve(scriptDir, "..", "..", "..");
  const portableRoot = path.resolve(runtimeDir, "..");
  const versionPath = path.join(portableRoot, "version.json");
  const version = JSON.parse(fs.readFileSync(versionPath, "utf-8"));
  return { runtimeDir, portableRoot, version };
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main() {
  const { version } = getPortableContext();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-sanctuary-portable-check-"));
  const dbPath = path.join(tempDir, "memory.sqlite");

  const result = {
    productName: "Star Sanctuary",
    mode: version.includeOptionalNative ? "full" : "slim",
    betterSqlite3: { ok: false },
    sqliteVec: { ok: false },
    nodePty: { installed: false, backend: "child_process" },
    protobufjs: { ok: false },
    browserToolchain: {
      puppeteerCore: { ok: false },
      browserToolsModule: { ok: false },
      readability: { ok: false },
      turndown: { ok: false },
    },
    launcher: {
      openModule: { ok: false },
    },
  };

  try {
    const store = new MemoryStore(dbPath);
    result.betterSqlite3.ok = true;
    try {
      store.prepareVectorStore(4);
      result.sqliteVec.ok = true;
    } catch (error) {
      result.sqliteVec.error = normalizeError(error);
    } finally {
      store.close();
    }
  } catch (error) {
    const message = normalizeError(error);
    result.betterSqlite3.error = message;
    if (!result.sqliteVec.error) {
      result.sqliteVec.error = message;
    }
  }

  try {
    const nodePtyStatus = await PtyManager.getInstance().inspectBackend();
    result.nodePty.installed = nodePtyStatus.installed;
    result.nodePty.backend = nodePtyStatus.backend;
    result.nodePty.resolvedFrom = nodePtyStatus.resolvedFrom;
    result.nodePty.error = nodePtyStatus.error;
  } catch (error) {
    result.nodePty.error = normalizeError(error);
  }

  try {
    await import("../../belldandy-channels/dist/feishu.js");
    result.protobufjs.ok = true;
    result.protobufjs.resolvedFrom = "../../belldandy-channels/dist/feishu.js";
  } catch (error) {
    result.protobufjs.error = normalizeError(error);
  }

  try {
    const puppeteerModule = await import("puppeteer-core");
    const defaultExport = puppeteerModule.default;
    if (typeof defaultExport?.connect !== "function") {
      throw new Error("puppeteer-core default export is missing connect()");
    }
    result.browserToolchain.puppeteerCore.ok = true;
  } catch (error) {
    result.browserToolchain.puppeteerCore.error = normalizeError(error);
  }

  try {
    const browserToolsModule = await import("../../belldandy-skills/dist/builtin/browser/tools.js");
    const exportedTools = [
      "browserOpenTool",
      "browserNavigateTool",
      "browserClickTool",
      "browserTypeTool",
      "browserScreenshotTool",
      "browserGetContentTool",
    ].filter((toolName) => toolName in browserToolsModule);
    if (exportedTools.length !== 6) {
      throw new Error(`Expected 6 browser tools, found ${exportedTools.length}`);
    }
    result.browserToolchain.browserToolsModule.ok = true;
    result.browserToolchain.browserToolsModule.exportedTools = exportedTools;
  } catch (error) {
    result.browserToolchain.browserToolsModule.error = normalizeError(error);
  }

  try {
    const { extractReadabilityContent, htmlToMarkdown } = await import("../../belldandy-skills/dist/builtin/browser/utils.js");
    const sampleHtml = [
      "<html><head><title>Portable Browser Check</title></head><body>",
      "<main><article><h1>Portable Browser Check</h1>",
      "<p>Star Sanctuary keeps browser automation and web extraction enabled in the default portable package.</p>",
      "<p>This paragraph verifies readability parsing and markdown conversion.</p>",
      "</article></main></body></html>",
    ].join("");
    const sampleUrl = "https://example.com/portable-browser-check";

    const readabilityResult = extractReadabilityContent(sampleHtml, sampleUrl);
    if (!readabilityResult?.content) {
      throw new Error("extractReadabilityContent() returned no content");
    }
    result.browserToolchain.readability.ok = true;
    result.browserToolchain.readability.title = readabilityResult.title;
    result.browserToolchain.readability.excerpt = readabilityResult.excerpt;

    const markdown = htmlToMarkdown("<h1>Portable Browser Check</h1><p>Browser markdown conversion works.</p>");
    if (!markdown || !/Portable Browser Check/i.test(markdown)) {
      throw new Error("htmlToMarkdown() returned unexpected content");
    }
    result.browserToolchain.turndown.ok = true;
    result.browserToolchain.turndown.snippet = markdown.slice(0, 120);
  } catch (error) {
    const message = normalizeError(error);
    if (!result.browserToolchain.readability.error) {
      result.browserToolchain.readability.error = message;
    }
    if (!result.browserToolchain.turndown.error) {
      result.browserToolchain.turndown.error = message;
    }
  }

  try {
    const gatewayRequire = createRequire(new URL("../../belldandy-core/dist/bin/gateway.js", import.meta.url));
    const openModulePath = gatewayRequire.resolve("open");
    const openModule = await import(pathToFileURL(openModulePath).href);
    if (typeof openModule.default !== "function") {
      throw new Error("open default export is not a function");
    }
    result.launcher.openModule.ok = true;
    result.launcher.openModule.resolvedFrom = openModulePath;
  } catch (error) {
    result.launcher.openModule.error = normalizeError(error);
  }

  guardedRemovePath(tempDir, { allowedRoots: [tempDir], label: "cleanup portable runtime check temp dir" });
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (process.env.STAR_SANCTUARY_PORTABLE_REPORT_PATH) {
    fs.writeFileSync(process.env.STAR_SANCTUARY_PORTABLE_REPORT_PATH, payload, "utf-8");
  } else {
    console.log(payload.trimEnd());
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
