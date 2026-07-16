import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import {
  collectPackageArtifactFailures,
  collectPackageNonDistBinArtifacts,
} from "../../../scripts/artifact-contract.mjs";
import {
  getModeLogSuffix,
  resolveDistributionMode,
  resolvePortableArtifactRoot,
} from "./distribution-mode.mjs";
import { guardedRemovePath } from "./sandbox-paths.mjs";
import { reserveFreePort, terminateChild, wait } from "./runtime-process.mjs";

const workspaceRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  "..",
  "..",
  "..",
);
const distribution = resolveDistributionMode();
const { mode } = distribution;
const portableRootArg = process.argv.find((arg) => arg.startsWith("--portable-root="));
const portableRoot = portableRootArg
  ? path.resolve(portableRootArg.slice("--portable-root=".length))
  : resolvePortableArtifactRoot({
      workspaceRoot,
      platform: process.platform,
      arch: process.arch,
      mode,
    });
const runtimeVersionRootArg = process.argv.find((arg) => arg.startsWith("--runtime-version-root="));
const runtimeExecutableArg = process.argv.find((arg) => arg.startsWith("--runtime-executable="));
if (runtimeVersionRootArg && !runtimeExecutableArg) {
  throw new Error("--runtime-executable is required with --runtime-version-root.");
}
const runtimeVersionRoot = runtimeVersionRootArg
  ? path.resolve(runtimeVersionRootArg.slice("--runtime-version-root=".length))
  : portableRoot;
const runtimeExecutablePath = runtimeExecutableArg
  ? path.resolve(runtimeExecutableArg.slice("--runtime-executable=".length))
  : resolveDefaultRuntimeExecutable(portableRoot);
const verifyRecoveryPayload = !runtimeVersionRootArg;
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const MAX_CAPTURED_OUTPUT_CHARS = 16 * 1024;
const RELAY_PROBE_TIMEOUT_MS = 10_000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function resolveDefaultRuntimeExecutable(rootDir) {
  const versionPath = path.join(rootDir, "version.json");
  const targetPlatform = fs.existsSync(versionPath)
    ? String(readJson(versionPath).platform || process.platform)
    : process.platform;
  return path.join(rootDir, targetPlatform === "win32" ? "star-sanctuary.exe" : "star-sanctuary");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collectPortablePackageArtifactFailures() {
  const packagesDir = path.join(runtimeVersionRoot, "runtime", "packages");
  if (!fs.existsSync(packagesDir)) {
    return ["portable -> missing runtime/packages"];
  }

  const failures = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const packageJsonPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const packageJson = readJson(packageJsonPath);
    if (
      typeof packageJson.name !== "string"
      || (!packageJson.name.startsWith("@belldandy/")
        && !packageJson.name.startsWith("@star-sanctuary/"))
    ) {
      continue;
    }
    failures.push(...collectPackageArtifactFailures({ packageDir, packageJson }));
  }
  return failures;
}

function resolveRelayArtifact() {
  const browserPackageDir = path.join(
    runtimeVersionRoot,
    "runtime",
    "packages",
    "belldandy-browser",
  );
  const packageJson = readJson(path.join(browserPackageDir, "package.json"));
  const relayArtifact = collectPackageNonDistBinArtifacts({
    packageDir: browserPackageDir,
    packageJson,
  }).find((asset) => asset.commandName === "belldandy-relay");
  if (!relayArtifact) {
    throw new Error("Portable @belldandy/browser does not declare a non-dist belldandy-relay bin.");
  }
  return relayArtifact;
}

function verifyRelayRecoveryContract(relayArtifact) {
  const runtimeRelativePath = [
    "packages",
    "belldandy-browser",
    ...relayArtifact.relativePath.split("/"),
  ].join("/");
  const runtimeManifestPath = path.join(runtimeVersionRoot, "runtime-manifest.json");
  const runtimeManifest = readJson(runtimeManifestPath);
  const manifestEntry = runtimeManifest.files?.find(
    (entry) => entry?.type === "file" && entry.path === runtimeRelativePath,
  );
  if (!manifestEntry) {
    throw new Error(`Portable runtime manifest is missing Relay bin: ${runtimeRelativePath}`);
  }

  const relayBytes = fs.readFileSync(relayArtifact.sourcePath);
  if (manifestEntry.size !== relayBytes.length || manifestEntry.sha256 !== sha256(relayBytes)) {
    throw new Error(`Portable runtime manifest Relay bin metadata is stale: ${runtimeRelativePath}`);
  }

  if (verifyRecoveryPayload) {
    const recoveryPath = path.join(
      runtimeVersionRoot,
      "payload",
      "runtime-files",
      ...runtimeRelativePath.split("/"),
    ) + ".gz";
    if (!fs.existsSync(recoveryPath)) {
      throw new Error(`Portable recovery payload is missing Relay bin: ${runtimeRelativePath}.gz`);
    }
    const recoveredBytes = gunzipSync(fs.readFileSync(recoveryPath));
    if (sha256(recoveredBytes) !== manifestEntry.sha256) {
      throw new Error(`Portable recovery payload Relay bin hash mismatch: ${runtimeRelativePath}.gz`);
    }
  }
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk.toString("utf-8")}`;
  return next.length <= MAX_CAPTURED_OUTPUT_CHARS
    ? next
    : next.slice(-MAX_CAPTURED_OUTPUT_CHARS);
}

async function probeRelayCli(relayArtifact) {
  if (!fs.existsSync(runtimeExecutablePath)) {
    throw new Error(`Portable runtime executable is missing: ${runtimeExecutablePath}`);
  }

  fs.mkdirSync(artifactsRoot, { recursive: true });
  const probeRoot = fs.mkdtempSync(
    path.join(artifactsRoot, `portable-relay-probe${getModeLogSuffix(mode)}-`),
  );
  let stdout = "";
  let stderr = "";
  let spawnError;
  let child;
  let relayVersion;
  try {
    const stateDir = path.join(probeRoot, "state");
    const homeDir = path.join(probeRoot, "home");
    const tempDir = path.join(probeRoot, "temp");
    const appDataDir = path.join(probeRoot, "app-data");
    const localAppDataDir = path.join(probeRoot, "local-app-data");
    for (const dirPath of [stateDir, homeDir, tempDir, appDataDir, localAppDataDir]) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const relayPort = await reserveFreePort();
    child = spawn(runtimeExecutablePath, [relayArtifact.sourcePath], {
      cwd: runtimeVersionRoot,
      env: {
        ...process.env,
        APPDATA: appDataDir,
        AUTO_OPEN_BROWSER: "false",
        BELLDANDY_RELAY_PORT: String(relayPort),
        BELLDANDY_STATE_DIR: stateDir,
        HOME: homeDir,
        LOCALAPPDATA: localAppDataDir,
        TEMP: tempDir,
        TMP: tempDir,
        USERPROFILE: homeDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once("error", (error) => {
      spawnError = error;
    });

    const deadline = Date.now() + RELAY_PROBE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode != null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${relayPort}/json/version`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          relayVersion = await response.json();
          break;
        }
      } catch {
        // The CLI may still be importing the packaged Relay module; retry within the fixed budget.
      }
      await wait(100);
    }
  } finally {
    try {
      if (child?.pid) {
        await terminateChild(child);
      }
    } finally {
      guardedRemovePath(probeRoot, {
        allowedRoots: [artifactsRoot],
        label: "cleanup portable Relay probe root",
      });
    }
  }

  if (
    relayVersion?.Browser !== "Star Sanctuary/Relay"
    || relayVersion?.["Protocol-Version"] !== "1.3"
  ) {
    throw new Error(
      `Portable Relay CLI probe failed.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
}

async function main() {
  const failures = collectPortablePackageArtifactFailures();
  if (failures.length > 0) {
    throw new Error(
      `portable package artifacts are incomplete:\n- ${failures.join("\n- ")}`,
    );
  }

  const relayArtifact = resolveRelayArtifact();
  verifyRelayRecoveryContract(relayArtifact);
  await probeRelayCli(relayArtifact);

  console.log(
    `[verify:portable-artifacts] verified ${runtimeVersionRoot} and probed belldandy-relay on loopback.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
