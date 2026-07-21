import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { verifyWebAssetBundle } from "./web-asset-bundle-verifier.mjs";

const repoRoot = process.cwd();
const webPublicDir = path.join(repoRoot, "apps", "web", "public");
const entryFile = path.join(webPublicDir, "app.js");
const canvasFile = path.join(webPublicDir, "canvas.js");
const configFile = path.join(webPublicDir, "config.js");
const bootstrapStartupFile = path.join(webPublicDir, "bootstrap-startup.js");
const appDir = path.join(webPublicDir, "app");
const indexFile = path.join(webPublicDir, "index.html");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectJsFiles(dirPath) {
  if (!(await exists(dirPath))) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return collectJsFiles(resolved);
    if (entry.isFile() && entry.name.endsWith(".js")) return [resolved];
    return [];
  }));
  return files.flat().sort();
}

async function runNodeCheck(filePath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filePath], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`node --check failed for ${path.relative(repoRoot, filePath)}`));
    });
    child.on("error", reject);
  });
}

function collectRelativeImports(source) {
  const results = [];
  const staticImport = /\bfrom\s+["'](\.[^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  let match = null;
  while ((match = staticImport.exec(source)) !== null) {
    results.push(match[1]);
  }
  while ((match = dynamicImport.exec(source)) !== null) {
    results.push(match[1]);
  }
  return results;
}

async function assertRelativeImportsExist(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const imports = collectRelativeImports(source);
  for (const specifier of imports) {
    const resolved = path.resolve(path.dirname(filePath), specifier);
    const candidates = [
      resolved,
      `${resolved}.js`,
      path.join(resolved, "index.js"),
    ];
    const found = await Promise.any(
      candidates.map(async (candidate) => {
        if (await exists(candidate)) return candidate;
        throw new Error(candidate);
      }),
    ).catch(() => null);
    if (!found) {
      throw new Error(
        `Missing relative import target in ${path.relative(repoRoot, filePath)}: ${specifier}`,
      );
    }
  }
}

async function main() {
  const indexHtml = await fs.readFile(indexFile, "utf8");
  if (!indexHtml.includes('<script type="module" src="/app.js"></script>')) {
    throw new Error("index.html is missing the ES module entry for /app.js");
  }
  if (!indexHtml.includes('<script src="/bootstrap-startup.js"></script>')) {
    throw new Error("index.html is missing the external startup bootstrap");
  }
  await verifyWebAssetBundle({
    webPublicDir,
    lockfilePath: path.join(repoRoot, "pnpm-lock.yaml"),
  });

  const filesToCheck = [
    entryFile,
    canvasFile,
    configFile,
    bootstrapStartupFile,
    ...(await collectJsFiles(appDir)),
  ];

  for (const filePath of filesToCheck) {
    await assertRelativeImportsExist(filePath);
    await runNodeCheck(filePath);
  }

  console.log(`[verify:webchat] verified ${filesToCheck.length} files and local asset manifest`);
}

main().catch((error) => {
  console.error("[verify:webchat] failed:", error.message);
  process.exitCode = 1;
});
