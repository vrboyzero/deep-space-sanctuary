import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateWebAssetPackageProvenance } from "./web-asset-manifest-policy.mjs";

const REQUIRED_ASSET_NAMES = ["marked", "dagre", "dompurify", "fontStylesheet"];
const REQUIRED_INDEX_REFERENCES = [
  "/assets/web-assets.css",
  "/assets/web-assets-manifest.js",
  "/assets/web-assets-loader.js",
];

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveManifestAssetPath(webPublicDir, assetPath) {
  if (typeof assetPath !== "string" || !assetPath.startsWith("/assets/")) {
    throw new Error(`Web asset manifest contains an invalid public path: ${assetPath}`);
  }
  const resolved = path.resolve(webPublicDir, `.${assetPath}`);
  const relative = path.relative(webPublicDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Web asset manifest path escapes public directory: ${assetPath}`);
  }
  return resolved;
}

export async function verifyWebAssetBundle({ webPublicDir, lockfilePath }) {
  const indexFile = path.join(webPublicDir, "index.html");
  const webAssetsDir = path.join(webPublicDir, "assets");
  const manifestPath = path.join(webAssetsDir, "web-assets-manifest.json");
  const indexHtml = await fs.readFile(indexFile, "utf8");

  if (/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(indexHtml)) {
    throw new Error("index.html must not load executable scripts from a remote origin");
  }
  if (/<link\b[^>]*\bhref\s*=\s*["']https?:\/\//i.test(indexHtml)) {
    throw new Error("index.html must not load stylesheets from a remote origin");
  }
  for (const requiredReference of REQUIRED_INDEX_REFERENCES) {
    if (!indexHtml.includes(requiredReference)) {
      throw new Error(`index.html is missing local Web asset reference: ${requiredReference}`);
    }
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  validateWebAssetPackageProvenance(manifest);
  const lockfileSha256 = sha256(await fs.readFile(lockfilePath));
  if (manifest.provenance.lockfileSha256 !== lockfileSha256) {
    throw new Error("Web asset manifest lockfile SHA-256 mismatch");
  }

  for (const assetName of REQUIRED_ASSET_NAMES) {
    if (!manifest.assets?.[assetName]) {
      throw new Error(`Web asset manifest is missing ${assetName}`);
    }
  }

  for (const [assetName, descriptor] of Object.entries(manifest.assets ?? {})) {
    if (!descriptor || typeof descriptor !== "object") {
      throw new Error(`Web asset manifest has an invalid descriptor for ${assetName}`);
    }
    const assetPath = resolveManifestAssetPath(webPublicDir, descriptor.path);
    const content = await fs.readFile(assetPath);
    if (sha256(content) !== descriptor.sha256) {
      throw new Error(`Web asset hash mismatch for ${assetName}`);
    }
    if (content.byteLength !== descriptor.bytes) {
      throw new Error(`Web asset byte length mismatch for ${assetName}`);
    }
  }

  const fontCss = await fs.readFile(path.join(webAssetsDir, "web-assets.css"), "utf8");
  if (/https?:\/\//i.test(fontCss)) {
    throw new Error("Local Web font stylesheet must not reference a remote origin");
  }
  const manifestScript = await fs.readFile(path.join(webAssetsDir, "web-assets-manifest.js"), "utf8");
  const expectedManifestScript = `window.__BELLDANDY_WEB_ASSET_MANIFEST__ = Object.freeze(${JSON.stringify(manifest)});\n`;
  if (manifestScript !== expectedManifestScript) {
    throw new Error("Web asset manifest script does not match its JSON manifest");
  }
  const loader = await fs.readFile(path.join(webAssetsDir, "web-assets-loader.js"), "utf8");
  if (!loader.includes("__BELLDANDY_WEB_ASSETS_READY__")) {
    throw new Error("Web asset loader does not expose the readiness contract");
  }

  return {
    assetCount: Object.keys(manifest.assets ?? {}).length,
    manifest,
  };
}
