import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function* walkFiles(rootPath) {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
      continue;
    }
    if (entry.isFile()) {
      yield entryPath;
      continue;
    }
    throw new Error(`Release content contains an unsupported entry type: ${path.relative(rootPath, entryPath)}`);
  }
}

export function collectReleaseContentManifest(rootPath) {
  const files = [];
  for (const absolutePath of walkFiles(rootPath)) {
    const stat = fs.statSync(absolutePath);
    files.push({
      path: path.relative(rootPath, absolutePath).replaceAll("\\", "/"),
      size: stat.size,
      sha256: sha256File(absolutePath),
      mode: stat.mode & 0o777,
    });
  }
  files.sort((left, right) => (left.path === right.path ? 0 : (left.path < right.path ? -1 : 1)));
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, item) => sum + item.size, 0),
    files,
  };
}

export function assertReleaseContentManifest({ rootPath, expectedFiles, label }) {
  if (!Array.isArray(expectedFiles)) {
    throw new Error(`${label} manifest is missing its file inventory.`);
  }

  // 先枚举受信 staged root，再按字符串 identity 比较；不按 manifest 路径执行文件 I/O。
  const actual = collectReleaseContentManifest(rootPath);
  const expectedByPath = new Map();
  for (const entry of expectedFiles) {
    const entryPath = typeof entry?.path === "string" ? entry.path : "";
    if (!entryPath || expectedByPath.has(entryPath)) {
      throw new Error(`${label} manifest contains an invalid or duplicate file path: ${entryPath || "(empty)"}`);
    }
    expectedByPath.set(entryPath, entry);
  }

  for (const actualEntry of actual.files) {
    const expectedEntry = expectedByPath.get(actualEntry.path);
    if (!expectedEntry) {
      throw new Error(`${label} has an unexpected staged file: ${actualEntry.path}`);
    }
    if (expectedEntry.sha256 !== actualEntry.sha256) {
      throw new Error(`${label} SHA-256 mismatch for ${actualEntry.path}`);
    }
    if (expectedEntry.size !== actualEntry.size) {
      throw new Error(`${label} size mismatch for ${actualEntry.path}`);
    }
    if (expectedEntry.mode !== actualEntry.mode) {
      throw new Error(`${label} mode mismatch for ${actualEntry.path}`);
    }
    expectedByPath.delete(actualEntry.path);
  }

  if (expectedByPath.size > 0) {
    throw new Error(`${label} is missing staged files: ${[...expectedByPath.keys()].join(", ")}`);
  }
  return actual;
}
