import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webPublicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registryPath = path.join(webPublicDir, "app", "features", "runtime-style-registry.js");
const sourceRoots = [
  path.join(webPublicDir, "app"),
  path.join(webPublicDir, "app.js"),
  path.join(webPublicDir, "bootstrap-startup.js"),
  path.join(webPublicDir, "canvas.js"),
];
const directStyleWritePatterns = [
  /\.style\.[A-Za-z_$][\w$]*/g,
  /\.style\s*=(?!=)/g,
  /\.style\s*\[/g,
  /Object\.assign\(\s*[^,\r\n]+\.style\s*,/g,
  /\.setAttribute\(\s*["']style["']/g,
];

function collectJavaScriptFiles(entryPath, files = []) {
  const stat = fs.statSync(entryPath);
  if (stat.isFile()) {
    if (entryPath.endsWith(".js") && !entryPath.endsWith(".test.js")) files.push(entryPath);
    return files;
  }
  for (const entry of fs.readdirSync(entryPath, { withFileTypes: true })) {
    collectJavaScriptFiles(path.join(entryPath, entry.name), files);
  }
  return files;
}

function getLineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function collectDirectStyleWriters() {
  const writers = [];
  for (const sourcePath of sourceRoots.flatMap((entryPath) => collectJavaScriptFiles(entryPath))) {
    if (sourcePath === registryPath) continue;
    const source = fs.readFileSync(sourcePath, "utf8");
    for (const pattern of directStyleWritePatterns) {
      for (const match of source.matchAll(pattern)) {
        writers.push(`${path.relative(webPublicDir, sourcePath)}:${getLineNumber(source, match.index ?? 0)}:${match[0]}`);
      }
    }
  }
  return writers.sort();
}

describe("UI03 runtime style closure", () => {
  it("keeps production WebChat code free of unowned style attributes and CSSOM writes", () => {
    expect(collectDirectStyleWriters()).toEqual([]);
  });

  it("keeps the only dynamic CSS rule owner bound to the preloaded same-origin stylesheet", () => {
    const registrySource = fs.readFileSync(registryPath, "utf8");

    expect(registrySource).toContain('RUNTIME_STYLESHEET_ID = "webchatRuntimeStylesheet"');
    expect(registrySource).toContain("styleSheet.insertRule");
    expect(registrySource).not.toMatch(/createElement\(\s*["']style["']/);
    expect(registrySource).not.toMatch(/\.setAttribute\(\s*["']style["']/);
  });
});
