import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webPublicDir = path.join(repoRoot, "apps", "web", "public");
const assetsDir = path.join(webPublicDir, "assets");
const assetPublicPrefix = "/assets/";

const THIRD_PARTY_SCRIPTS = [
  { id: "marked", packageName: "marked", source: "node_modules/marked/marked.min.js" },
  { id: "dagre", packageName: "dagre", source: "node_modules/dagre/dist/dagre.min.js" },
  { id: "dompurify", packageName: "dompurify", source: "node_modules/dompurify/dist/purify.min.js" },
];

const FONT_STYLESHEETS = [
  "node_modules/@fontsource/outfit/300.css",
  "node_modules/@fontsource/outfit/400.css",
  "node_modules/@fontsource/outfit/500.css",
  "node_modules/@fontsource/outfit/600.css",
  "node_modules/@fontsource/outfit/700.css",
  "node_modules/@fontsource/jetbrains-mono/400.css",
  "node_modules/@fontsource/jetbrains-mono/500.css",
];

const WEB_ASSET_LOADER_SOURCE = `(() => {
  const manifest = window.__BELLDANDY_WEB_ASSET_MANIFEST__;
  const assets = manifest && typeof manifest === "object" ? manifest.assets : null;
  const required = ["dompurify", "marked", "dagre"];
  const getTrustedScriptUrlPolicy = () => {
    const trustedTypes = window.trustedTypes;
    if (!trustedTypes || typeof trustedTypes.createPolicy !== "function") return null;
    if (window.__BELLDANDY_WEB_ASSET_TRUSTED_TYPES_POLICY__) {
      return window.__BELLDANDY_WEB_ASSET_TRUSTED_TYPES_POLICY__;
    }
    const policy = trustedTypes.createPolicy("belldandy-web-assets", {
      // 仅接受同源的 hash 资产路径，避免 loader 被错误复用为任意脚本 URL 的通道。
      createScriptURL: (value) => {
        const url = new URL(value, window.location.origin);
        if (url.origin !== window.location.origin || !url.pathname.startsWith("/assets/")) {
          throw new TypeError("Web asset URL must be same-origin and inside /assets/.");
        }
        return url.toString();
      },
    });
    window.__BELLDANDY_WEB_ASSET_TRUSTED_TYPES_POLICY__ = policy;
    return policy;
  };
  const trustedScriptUrlPolicy = getTrustedScriptUrlPolicy();
  const loadScript = (asset) => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = trustedScriptUrlPolicy ? trustedScriptUrlPolicy.createScriptURL(asset.path) : asset.path;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Required local Web asset failed to load."));
    document.head.appendChild(script);
  });
  window.__BELLDANDY_WEB_ASSETS_READY__ = !assets || required.some((key) => !assets[key])
    ? Promise.reject(new Error("Required local Web asset manifest is unavailable."))
    : Promise.all(required.map((key) => loadScript(assets[key]))).then(() => undefined);
  window.__BELLDANDY_WEB_ASSETS_READY__.catch((error) => {
    console.error("[web-assets] required local assets failed to load", error);
  });
})();
`;

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sanitizeFileToken(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function toPublicPath(fileName) {
  return `${assetPublicPrefix}${fileName}`;
}

function assertWithin(baseDir, targetPath, label) {
  const relative = path.relative(baseDir, targetPath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`${label} escapes its package directory.`);
}

async function readRequiredFile(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Required Web asset is unavailable: ${path.relative(repoRoot, filePath)} (${message})`);
  }
}

async function writeIfChanged(filePath, content) {
  const existing = await fs.readFile(filePath).catch(() => null);
  if (existing && Buffer.compare(existing, Buffer.from(content)) === 0) {
    return false;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return true;
}

async function copyHashedAsset({ id, sourcePath, assets, sourceCache }) {
  const resolvedSource = path.resolve(sourcePath);
  const cached = sourceCache.get(resolvedSource);
  if (cached) return cached;

  const content = await readRequiredFile(resolvedSource);
  const hash = sha256(content);
  const extension = path.extname(resolvedSource);
  const fileName = `${sanitizeFileToken(id)}.${hash.slice(0, 16)}${extension}`;
  const outputPath = path.join(assetsDir, fileName);
  await writeIfChanged(outputPath, content);

  const descriptor = {
    path: toPublicPath(fileName),
    sha256: hash,
    bytes: content.byteLength,
  };
  assets[id] = descriptor;
  sourceCache.set(resolvedSource, descriptor);
  return descriptor;
}

async function rewriteFontStylesheet(sourcePath, assets, sourceCache) {
  const source = await readRequiredFile(sourcePath);
  const css = source.toString("utf8");
  const sourceDir = path.dirname(sourcePath);
  let rewritten = "";
  let cursor = 0;
  const matches = css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g);

  for (const match of matches) {
    const fullMatch = match[0];
    const rawUrl = match[2];
    const index = match.index ?? 0;
    rewritten += css.slice(cursor, index);
    cursor = index + fullMatch.length;

    if (!rawUrl.startsWith(".")) {
      throw new Error(`Font stylesheet contains a non-local URL: ${rawUrl}`);
    }
    const fontPath = path.resolve(sourceDir, rawUrl);
    assertWithin(sourceDir, fontPath, "Font asset");
    const fontDescriptor = await copyHashedAsset({
      id: `font-${path.basename(fontPath)}`,
      sourcePath: fontPath,
      assets,
      sourceCache,
    });
    rewritten += `url("${fontDescriptor.path}")`;
  }

  return `${rewritten}${css.slice(cursor)}`;
}

async function readPackageMetadata(packageName) {
  const packagePath = path.join(repoRoot, "node_modules", ...packageName.split("/"), "package.json");
  const content = await readRequiredFile(packagePath);
  const parsed = JSON.parse(content.toString("utf8"));
  return {
    name: parsed.name,
    version: parsed.version,
    license: parsed.license ?? "UNSPECIFIED",
  };
}

async function main() {
  await fs.mkdir(assetsDir, { recursive: true });
  const assets = {};
  const sourceCache = new Map();

  for (const script of THIRD_PARTY_SCRIPTS) {
    await copyHashedAsset({
      id: script.id,
      sourcePath: path.join(repoRoot, script.source),
      assets,
      sourceCache,
    });
  }

  const fontCss = [];
  for (const stylesheet of FONT_STYLESHEETS) {
    fontCss.push(await rewriteFontStylesheet(path.join(repoRoot, stylesheet), assets, sourceCache));
  }
  const fontStylesheet = Buffer.from(`${fontCss.join("\n")}\n`, "utf8");
  const fontStylesheetHash = sha256(fontStylesheet);
  const fontStylesheetPath = path.join(assetsDir, "web-assets.css");
  await writeIfChanged(fontStylesheetPath, fontStylesheet);
  assets.fontStylesheet = {
    path: toPublicPath("web-assets.css"),
    sha256: fontStylesheetHash,
    bytes: fontStylesheet.byteLength,
  };

  const packages = await Promise.all([
    ...THIRD_PARTY_SCRIPTS.map((script) => readPackageMetadata(script.packageName)),
    readPackageMetadata("@fontsource/outfit"),
    readPackageMetadata("@fontsource/jetbrains-mono"),
  ]);
  const manifest = {
    version: 1,
    assets,
    packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeIfChanged(path.join(assetsDir, "web-assets-manifest.json"), manifestJson);
  await writeIfChanged(
    path.join(assetsDir, "web-assets-manifest.js"),
    `window.__BELLDANDY_WEB_ASSET_MANIFEST__ = Object.freeze(${JSON.stringify(manifest)});\n`,
  );
  await writeIfChanged(path.join(assetsDir, "web-assets-loader.js"), WEB_ASSET_LOADER_SOURCE);

  console.log(`[build:web-assets] generated ${Object.keys(assets).length} manifest entries`);
}

main().catch((error) => {
  console.error(`[build:web-assets] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
