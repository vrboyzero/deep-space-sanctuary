import { execFile as execFileCallback } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const CANDIDATE_PLATFORMS = ["windows-native", "wsl2-linux"];
const execFile = promisify(execFileCallback);

export async function collectCodingAgentCandidateGlobalEvidence(input, dependencies = {}) {
  const sensitiveRoots = requireSensitiveRoots(input?.sensitiveRoots);
  const sensitivePatterns = requireSensitivePatterns(input?.sensitiveValues);
  const collectResourceSweep = dependencies.collectResourceSweep;
  if (typeof collectResourceSweep !== "function") {
    throw new Error("Coding benchmark candidate evidence requires a resource sweep adapter.");
  }

  const sensitiveScan = await scanCandidateSensitiveValues({
    roots: sensitiveRoots,
    patterns: sensitivePatterns,
  });
  const resourceSweeps = [];
  for (const platform of CANDIDATE_PLATFORMS) {
    resourceSweeps.push(await collectResourceSweep({ platform }));
  }
  return { sensitiveScan, resourceSweeps };
}

export async function collectCodingAgentCandidateOwnedResourceSweep(input, dependencies = {}) {
  if (!CANDIDATE_PLATFORMS.includes(input?.platform)) {
    throw new Error(
      "Coding benchmark candidate resource sweep platform must be windows-native or wsl2-linux.",
    );
  }
  requireListenerInventory(input?.inventory?.listeners);
  requireProcessInventory(input?.inventory?.processIds);
  requireWindowsAbsolutePathInventory(
    input?.platform,
    "runtimeMarkers",
    input?.inventory?.runtimeMarkers,
  );
  requireWindowsAbsolutePathInventory(
    input?.platform,
    "runtimeEnvFiles",
    input?.inventory?.runtimeEnvFiles,
  );
  requirePosixAbsolutePathInventory(
    input?.platform,
    "runtimeMarkers",
    input?.inventory?.runtimeMarkers,
  );
  requirePosixAbsolutePathInventory(
    input?.platform,
    "runtimeEnvFiles",
    input?.inventory?.runtimeEnvFiles,
  );
  requireDistinctRuntimePathInventories(
    input?.platform,
    input?.inventory?.runtimeMarkers,
    input?.inventory?.runtimeEnvFiles,
  );
  const distribution = requireWslDistribution(input?.platform, input?.distribution);
  const probeOwnedResources = dependencies.probeOwnedResources;
  if (typeof probeOwnedResources !== "function") {
    throw new Error("Coding benchmark candidate resource sweep requires an owned-resource probe adapter.");
  }
  const observed = await probeOwnedResources({
    platform: input?.platform,
    ...(distribution ? { distribution } : {}),
    inventory: input?.inventory,
  });
  for (const key of ["listeners", "processIds", "runtimeMarkers", "runtimeEnvFiles"]) {
    if (!Array.isArray(observed?.[key])
      || observed[key].length !== input?.inventory?.[key]?.length) {
      throw new Error(
        `Coding benchmark candidate resource observation ${key} length must match inventory.`,
      );
    }
    if (observed[key].some((value) => typeof value !== "boolean")) {
      throw new Error(
        `Coding benchmark candidate resource observation ${key} values must be boolean.`,
      );
    }
  }
  const remainingListenerCount = countPresent(observed.listeners);
  const remainingOwnedProcessCount = countPresent(observed.processIds);
  const remainingRuntimeMarkerCount = countPresent(observed.runtimeMarkers);
  const remainingRuntimeEnvFileCount = countPresent(observed.runtimeEnvFiles);
  return {
    platform: input?.platform,
    status: "completed",
    scope: "candidate_owned_resources",
    remainingListenerCount,
    remainingOwnedProcessCount,
    remainingRuntimeMarkerCount,
    remainingRuntimeEnvFileCount,
    orphanResourceCount: remainingListenerCount
      + remainingOwnedProcessCount
      + remainingRuntimeMarkerCount
      + remainingRuntimeEnvFileCount,
  };
}

export async function probeCodingAgentCandidateOwnedResources(input) {
  if (input?.platform === "wsl2-linux") {
    const runtimePaths = [
      ...input.inventory.runtimeMarkers,
      ...input.inventory.runtimeEnvFiles,
    ];
    const [listeners, processIds, observedRuntimePaths] = await Promise.all([
      probeWslListeners(input.distribution, input.inventory.listeners),
      probeWslProcesses(input.distribution, input.inventory.processIds),
      probeWslExactPaths(input.distribution, runtimePaths),
    ]);
    const markerCount = input.inventory.runtimeMarkers.length;
    return {
      listeners,
      processIds,
      runtimeMarkers: observedRuntimePaths.slice(0, markerCount),
      runtimeEnvFiles: observedRuntimePaths.slice(markerCount),
    };
  }
  if (input?.platform !== "windows-native") {
    throw new Error("Coding benchmark owned-resource production probe requires a candidate platform.");
  }
  return {
    listeners: await probeWindowsListeners(input.inventory.listeners),
    processIds: await probeWindowsProcesses(input.inventory.processIds),
    runtimeMarkers: await Promise.all(input.inventory.runtimeMarkers.map(probeExactPathExists)),
    runtimeEnvFiles: await Promise.all(input.inventory.runtimeEnvFiles.map(probeExactPathExists)),
  };
}

async function scanCandidateSensitiveValues(input) {
  const counts = {
    regularFileCount: 0,
    unreadableFileCount: 0,
    symlinkOrReparsePointCount: 0,
    findingCount: 0,
  };
  for (const root of input.roots) {
    const rootStat = await fs.lstat(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error("Coding benchmark candidate sensitive scan roots must be regular directories.");
    }
    await scanDirectory(root, input.patterns, counts);
  }
  return {
    status: "completed",
    scope: "candidate_declared_roots",
    linkPolicy: "count_do_not_follow",
    contentPolicy: "exact_values_non_echoing",
    rootCount: input.roots.length,
    ...counts,
  };
}

async function scanDirectory(root, patterns, counts) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    counts.unreadableFileCount += 1;
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch {
      counts.unreadableFileCount += 1;
      continue;
    }
    if (stat.isSymbolicLink()) {
      counts.symlinkOrReparsePointCount += 1;
      continue;
    }
    if (stat.isDirectory()) {
      await scanDirectory(target, patterns, counts);
      continue;
    }
    if (!stat.isFile()) continue;
    counts.regularFileCount += 1;
    try {
      counts.findingCount += await countExactMatches(target, patterns);
    } catch {
      counts.unreadableFileCount += 1;
    }
  }
}

async function countExactMatches(filePath, patterns) {
  const maximumPatternLength = Math.max(...patterns.map((pattern) => pattern.length));
  let pending = Buffer.alloc(0);
  let findingCount = 0;
  for await (const chunk of createReadStream(filePath)) {
    const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    const safeStartCount = Math.max(0, combined.length - maximumPatternLength + 1);
    findingCount += countBufferMatches(combined, patterns, safeStartCount);
    pending = combined.subarray(safeStartCount);
  }
  return findingCount + countBufferMatches(pending, patterns, pending.length);
}

function countBufferMatches(buffer, patterns, startLimit) {
  let findingCount = 0;
  for (const pattern of patterns) {
    let offset = 0;
    while (offset < startLimit) {
      const matchIndex = buffer.indexOf(pattern, offset);
      if (matchIndex < 0 || matchIndex >= startLimit) break;
      findingCount += 1;
      offset = matchIndex + 1;
    }
  }
  return findingCount;
}

function requireSensitiveRoots(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Coding benchmark candidate evidence requires sensitive scan roots.");
  }
  const roots = value.map((root) => {
    if (typeof root !== "string" || !root.trim()) {
      throw new Error("Coding benchmark candidate sensitive scan roots must be paths.");
    }
    return path.resolve(root);
  });
  if (new Set(roots.map((root) => normalizePathIdentity(root))).size !== roots.length) {
    throw new Error("Coding benchmark candidate sensitive scan roots must be unique.");
  }
  for (let index = 0; index < roots.length; index += 1) {
    for (let candidateIndex = index + 1; candidateIndex < roots.length; candidateIndex += 1) {
      if (isPathContainedBy(roots[index], roots[candidateIndex])
        || isPathContainedBy(roots[candidateIndex], roots[index])) {
        throw new Error("Coding benchmark candidate sensitive scan roots must not overlap.");
      }
    }
  }
  return roots;
}

function requireSensitivePatterns(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Coding benchmark candidate evidence requires exact sensitive values.");
  }
  const values = [...new Set(value.map((item) => {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error("Coding benchmark candidate sensitive values must be non-empty strings.");
    }
    return item;
  }))];
  return values.map((item) => Buffer.from(item, "utf-8"));
}

function normalizePathIdentity(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function countPresent(values) {
  return values.filter((value) => value === true).length;
}

async function probeExactPathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function probeWindowsListeners(listeners) {
  if (listeners.length === 0) return [];
  const command = [
    "$items = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |",
    "  Select-Object -Property LocalAddress,LocalPort)",
    "ConvertTo-Json -Compress -InputObject $items",
  ].join("\n");
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch {
    throw new Error("Coding benchmark Windows listener probe returned invalid JSON.");
  }
  if (!Array.isArray(rows) || rows.some((row) => {
    return !row
      || typeof row.LocalAddress !== "string"
      || !Number.isSafeInteger(Number(row.LocalPort));
  })) {
    throw new Error("Coding benchmark Windows listener probe returned invalid rows.");
  }
  const identities = new Set(rows.map((row) => {
    return JSON.stringify([row.LocalAddress.toLowerCase(), Number(row.LocalPort)]);
  }));
  return listeners.map((listener) => {
    return identities.has(JSON.stringify([listener.host.toLowerCase(), listener.port]));
  });
}

async function probeWindowsProcesses(processIds) {
  if (processIds.length === 0) return [];
  const command = [
    "$items = @(Get-Process -ErrorAction Stop |",
    "  Where-Object { $_.Id -gt 0 } |",
    "  ForEach-Object { [int64]$_.Id })",
    "ConvertTo-Json -Compress -InputObject $items",
  ].join("\n");
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  let observedProcessIds;
  try {
    observedProcessIds = JSON.parse(stdout);
  } catch {
    throw new Error("Coding benchmark Windows process probe returned invalid JSON.");
  }
  if (!Array.isArray(observedProcessIds)
    || observedProcessIds.some((processId) => !Number.isSafeInteger(processId) || processId < 1)) {
    throw new Error("Coding benchmark Windows process probe returned invalid identifiers.");
  }
  const observed = new Set(observedProcessIds);
  return processIds.map((processId) => observed.has(processId));
}

async function probeWslExactPaths(distribution, targets) {
  if (targets.length === 0) return [];
  const script = [
    "const fs=require('node:fs');",
    "const values=process.argv.slice(1).map((target)=>{",
    "  try { fs.lstatSync(target); return true; }",
    "  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }",
    "});",
    "process.stdout.write(JSON.stringify(values));",
  ].join("");
  const { stdout } = await execFile(
    "wsl.exe",
    ["--distribution", distribution, "--exec", "node", "-e", script, ...targets],
    {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  let observed;
  try {
    observed = JSON.parse(stdout);
  } catch {
    throw new Error("Coding benchmark WSL2 path probe returned invalid JSON.");
  }
  if (!Array.isArray(observed)
    || observed.length !== targets.length
    || observed.some((value) => typeof value !== "boolean")) {
    throw new Error("Coding benchmark WSL2 path probe returned invalid observations.");
  }
  return observed;
}

async function probeWslListeners(distribution, listeners) {
  if (listeners.length === 0) return [];
  const { stdout } = await execFile(
    "wsl.exe",
    ["--distribution", distribution, "--exec", "ss", "-H", "-ltn"],
    {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const identities = new Set();
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0] !== "LISTEN") {
      throw new Error("Coding benchmark WSL2 listener probe returned an invalid row.");
    }
    const endpoint = parseWslListenerEndpoint(fields[3]);
    if (endpoint) identities.add(JSON.stringify([endpoint.host, endpoint.port]));
  }
  return listeners.map((listener) => {
    return identities.has(JSON.stringify([listener.host, listener.port]));
  });
}

async function probeWslProcesses(distribution, processIds) {
  if (processIds.length === 0) return [];
  const script = [
    "const values=process.argv.slice(1).map((value)=>{",
    "  const processId=Number(value);",
    "  if (!Number.isSafeInteger(processId)||processId<1) throw new Error('invalid process id');",
    "  try { process.kill(processId,0); return true; }",
    "  catch (error) {",
    "    if (error?.code === 'ESRCH') return false;",
    "    if (error?.code === 'EPERM') return true;",
    "    throw error;",
    "  }",
    "});",
    "process.stdout.write(JSON.stringify(values));",
  ].join("");
  const { stdout } = await execFile(
    "wsl.exe",
    [
      "--distribution", distribution,
      "--exec", "node", "-e", script,
      ...processIds.map((processId) => String(processId)),
    ],
    {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  let observed;
  try {
    observed = JSON.parse(stdout);
  } catch {
    throw new Error("Coding benchmark WSL2 process probe returned invalid JSON.");
  }
  if (!Array.isArray(observed)
    || observed.length !== processIds.length
    || observed.some((value) => typeof value !== "boolean")) {
    throw new Error("Coding benchmark WSL2 process probe returned invalid observations.");
  }
  return observed;
}

function parseWslListenerEndpoint(value) {
  const bracketed = value.match(/^\[([^\]]+)]:(\d+)$/);
  if (bracketed) {
    const port = Number(bracketed[2]);
    return net.isIP(bracketed[1]) > 0 && isValidPort(port)
      ? { host: bracketed[1], port }
      : null;
  }
  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex < 1) return null;
  const host = value.slice(0, separatorIndex);
  const port = Number(value.slice(separatorIndex + 1));
  return net.isIP(host) > 0 && isValidPort(port) ? { host, port } : null;
}

function isValidPort(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function requireListenerInventory(value) {
  if (!Array.isArray(value) || value.some((listener) => {
    return !listener
      || typeof listener !== "object"
      || net.isIP(listener.host) === 0
      || !Number.isSafeInteger(listener.port)
      || listener.port < 1
      || listener.port > 65_535;
  })) {
    throw new Error(
      "Coding benchmark candidate resource inventory listeners require an IP host and valid port.",
    );
  }
  const identities = value.map((listener) => JSON.stringify([listener.host, listener.port]));
  if (new Set(identities).size !== identities.length) {
    throw new Error("Coding benchmark candidate resource inventory listeners must be unique.");
  }
}

function requireProcessInventory(value) {
  if (!Array.isArray(value)
    || value.some((processId) => !Number.isSafeInteger(processId)
      || processId < 1
      || processId > 2_147_483_647)) {
    throw new Error(
      "Coding benchmark candidate resource inventory processIds must be positive signed 32-bit integers.",
    );
  }
  if (new Set(value).size !== value.length) {
    throw new Error("Coding benchmark candidate resource inventory processIds must be unique.");
  }
}

function requireWindowsAbsolutePathInventory(platform, key, value) {
  if (platform !== "windows-native") return;
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== "string"
      || !item.trim()
      || !path.win32.isAbsolute(item))) {
    throw new Error(
      `Coding benchmark candidate resource inventory ${key} requires Windows absolute paths.`,
    );
  }
  const identities = value.map((item) => path.win32.normalize(item).toLowerCase());
  if (new Set(identities).size !== identities.length) {
    throw new Error(
      `Coding benchmark candidate resource inventory ${key} paths must be unique.`,
    );
  }
}

function requirePosixAbsolutePathInventory(platform, key, value) {
  if (platform !== "wsl2-linux") return;
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== "string"
      || !item.trim()
      || !path.posix.isAbsolute(item))) {
    throw new Error(
      `Coding benchmark candidate resource inventory ${key} requires POSIX absolute paths.`,
    );
  }
  const identities = value.map((item) => path.posix.normalize(item));
  if (new Set(identities).size !== identities.length) {
    throw new Error(
      `Coding benchmark candidate resource inventory ${key} paths must be unique.`,
    );
  }
}

function requireDistinctRuntimePathInventories(platform, runtimeMarkers, runtimeEnvFiles) {
  const normalize = platform === "windows-native"
    ? (item) => path.win32.normalize(item).toLowerCase()
    : (item) => path.posix.normalize(item);
  const markerIdentities = new Set(runtimeMarkers.map(normalize));
  if (runtimeEnvFiles.some((item) => markerIdentities.has(normalize(item)))) {
    throw new Error(
      "Coding benchmark candidate resource inventory runtimeMarkers and runtimeEnvFiles must be distinct.",
    );
  }
}

function requireWslDistribution(platform, value) {
  if (platform !== "wsl2-linux") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Coding benchmark WSL2 resource sweep distribution is required.");
  }
  return value.trim();
}

function isPathContainedBy(parent, candidate) {
  const relative = path.relative(
    normalizePathIdentity(parent),
    normalizePathIdentity(candidate),
  );
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}
