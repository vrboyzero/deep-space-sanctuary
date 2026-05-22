import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { getModeLogSuffix, resolveDistributionMode, resolveSingleExeArtifactRoot } from "./distribution-mode.mjs";
import {
  checkHealth,
  reserveFreePort,
  resolveStartupWaitSeconds,
  terminateChild,
  wait,
} from "./runtime-process.mjs";
import { resolveSingleExeVerifyRoots } from "./single-exe-verify-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const platform = process.platform;
const arch = process.arch;
const distribution = resolveDistributionMode();
const { mode } = distribution;
const suffix = getModeLogSuffix(mode);
const singleExeRoot = resolveSingleExeArtifactRoot({
  workspaceRoot,
  platform,
  arch,
  mode,
});
const verifyRoots = resolveSingleExeVerifyRoots({
  kind: "lifecycle",
  suffix,
});
const executablePath = path.join(singleExeRoot, "star-sanctuary-single.exe");
const metadataPath = path.join(singleExeRoot, "single-exe.json");
const lifecycleHome = verifyRoots.homeDir;
const stateDir = verifyRoots.stateDir;
const reportPath = path.join(singleExeRoot, "single-exe-lifecycle-report.json");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function readMetadata() {
  return JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
}

function getVersionKey(metadata) {
  return `${metadata.version}-${metadata.platform}-${metadata.arch}`;
}

function getVersionRootDir(versionKey) {
  return path.join(lifecycleHome, "runtime", versionKey);
}

function getGatewayEntryPath(versionKey) {
  return path.join(
    getVersionRootDir(versionKey),
    "runtime",
    "packages",
    "belldandy-core",
    "dist",
    "bin",
    "gateway.js",
  );
}

function normalizeDirNames(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function setDirectoryMtime(dirPath, timestampMs) {
  const time = new Date(timestampMs);
  fs.utimesSync(dirPath, time, time);
}

function writeRuntimeActivityMarker(versionRootDir, pid) {
  const markerPath = path.join(versionRootDir, ".runtime-active.json");
  const now = new Date().toISOString();
  fs.writeFileSync(markerPath, `${JSON.stringify({
    pid,
    startedAt: now,
    updatedAt: now,
  }, null, 2)}\n`, "utf-8");
}

async function runSingleExe(params) {
  const {
    label,
    expectPrepared,
    expectReused,
    maxWaitSeconds = resolveStartupWaitSeconds(mode, {
      slim: 45,
      full: 90,
    }),
  } = params;
  const stdoutPath = path.join(workspaceRoot, "artifacts", `single-exe-lifecycle-${label}${suffix}.stdout.log`);
  const stderrPath = path.join(workspaceRoot, "artifacts", `single-exe-lifecycle-${label}${suffix}.stderr.log`);

  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const port = await reserveFreePort();
  const relayPort = await reserveFreePort();
  const child = spawn(executablePath, [], {
    cwd: singleExeRoot,
    env: {
      ...process.env,
      STAR_SANCTUARY_SINGLE_EXE_HOME: lifecycleHome,
      BELLDANDY_STATE_DIR: stateDir,
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      AUTO_OPEN_BROWSER: "false",
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });

  let healthy = false;
  try {
    for (let i = 0; i < maxWaitSeconds; i += 1) {
      await wait(1000);
      if (child.exitCode != null) break;
      if (await checkHealth(`http://127.0.0.1:${port}/health`)) {
        healthy = true;
        break;
      }
    }
  } finally {
    await terminateChild(child);
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }

  const stdoutText = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
  const stderrText = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";

  if (!healthy) {
    throw new Error(`Single-exe lifecycle step '${label}' failed.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }

  if (expectPrepared && !stdoutText.includes("Prepared runtime")) {
    throw new Error(`Lifecycle step '${label}' expected runtime extraction, but stdout did not include 'Prepared runtime'.\n${stdoutText}`);
  }
  if (expectReused && !stdoutText.includes("Reusing runtime")) {
    throw new Error(`Lifecycle step '${label}' expected runtime reuse, but stdout did not include 'Reusing runtime'.\n${stdoutText}`);
  }

  return {
    stdoutPath,
    stderrPath,
    stdoutText,
    stderrText,
  };
}

async function main() {
  if (!fs.existsSync(executablePath) || !fs.existsSync(metadataPath)) {
    throw new Error(`Single-exe artifact is missing for mode=${mode}. Run 'corepack pnpm build:single-exe${mode === "full" ? ":full" : ""}' first.`);
  }

  const metadata = readMetadata();
  const versionKey = getVersionKey(metadata);
  const versionRootDir = getVersionRootDir(versionKey);
  const runtimeBaseDir = path.join(lifecycleHome, "runtime");
  const envMarkerPath = path.join(stateDir, ".env.local");
  const stateMarkerPath = path.join(stateDir, "workspace", "marker.txt");

  fs.rmSync(lifecycleHome, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(reportPath, { force: true });

  fs.mkdirSync(path.dirname(envMarkerPath), { recursive: true });
  fs.mkdirSync(path.dirname(stateMarkerPath), { recursive: true });
  fs.writeFileSync(envMarkerPath, "LIFECYCLE_MARKER=preserve\n", "utf-8");
  fs.writeFileSync(stateMarkerPath, "state-preserved\n", "utf-8");

  const initialRun = await runSingleExe({
    label: "initial",
    expectPrepared: true,
    expectReused: false,
    maxWaitSeconds: resolveStartupWaitSeconds(mode, {
      slim: 90,
      full: 180,
    }),
  });

  ensureExists(versionRootDir, "version runtime root after initial boot");
  const gatewayPath = getGatewayEntryPath(versionKey);
  ensureExists(gatewayPath, "gateway entry after initial boot");
  const originalGatewaySha = sha256File(gatewayPath);
  const dirsAfterInitial = normalizeDirNames(runtimeBaseDir);

  const reuseRun = await runSingleExe({
    label: "reuse",
    expectPrepared: false,
    expectReused: true,
  });
  const dirsAfterReuse = normalizeDirNames(runtimeBaseDir);

  fs.writeFileSync(gatewayPath, "export default 0; // corrupted by lifecycle test\n", "utf-8");
  const corruptedGatewaySha = sha256File(gatewayPath);
  const recoveryRun = await runSingleExe({
    label: "recovery",
    expectPrepared: true,
    expectReused: false,
    maxWaitSeconds: resolveStartupWaitSeconds(mode, {
      slim: 90,
      full: 180,
    }),
  });
  const restoredGatewaySha = sha256File(gatewayPath);

  const olderVersionDir = path.join(runtimeBaseDir, "0.0.1-win32-x64");
  const activeVersionDir = path.join(runtimeBaseDir, "0.0.2-win32-x64");
  const newerVersionDir = path.join(runtimeBaseDir, "0.0.3-win32-x64");
  fs.mkdirSync(olderVersionDir, { recursive: true });
  fs.mkdirSync(activeVersionDir, { recursive: true });
  fs.mkdirSync(newerVersionDir, { recursive: true });
  const now = Date.now();
  setDirectoryMtime(olderVersionDir, now - 10_000);
  setDirectoryMtime(activeVersionDir, now - 5_000);
  setDirectoryMtime(newerVersionDir, now - 1_000);
  writeRuntimeActivityMarker(activeVersionDir, process.pid);
  const staleStagingDir = path.join(runtimeBaseDir, `${versionKey}.staging-123-${now - 60 * 60 * 1000}`);
  const staleCorruptDir = path.join(runtimeBaseDir, `${versionKey}.corrupt-${now - 60 * 60 * 1000}`);
  const recentStagingDir = path.join(runtimeBaseDir, `${versionKey}.staging-321-${now}`);
  fs.mkdirSync(staleStagingDir, { recursive: true });
  fs.mkdirSync(staleCorruptDir, { recursive: true });
  fs.mkdirSync(recentStagingDir, { recursive: true });

  const cleanupRun = await runSingleExe({
    label: "cleanup",
    expectPrepared: false,
    expectReused: true,
  });
  const dirsAfterCleanup = normalizeDirNames(runtimeBaseDir);

  const report = {
    productName: metadata.productName,
    mode,
    versionKey,
    scenarios: {
      initialExtract: {
        ok: initialRun.stdoutText.includes("Prepared runtime"),
        runtimeDirs: dirsAfterInitial,
      },
      reuseExistingRuntime: {
        ok: reuseRun.stdoutText.includes("Reusing runtime"),
        runtimeDirs: dirsAfterReuse,
      },
      recoverCorruptedRuntime: {
        ok: restoredGatewaySha === originalGatewaySha && corruptedGatewaySha !== originalGatewaySha,
        gatewayPath,
        originalSha256: originalGatewaySha,
        corruptedSha256: corruptedGatewaySha,
        restoredSha256: restoredGatewaySha,
      },
      cleanupOldVersions: {
        ok: dirsAfterCleanup.includes(versionKey)
          && dirsAfterCleanup.includes("0.0.2-win32-x64")
          && dirsAfterCleanup.includes("0.0.3-win32-x64")
          && !dirsAfterCleanup.includes("0.0.1-win32-x64")
          && !dirsAfterCleanup.includes(path.basename(staleStagingDir))
          && !dirsAfterCleanup.includes(path.basename(staleCorruptDir))
          && dirsAfterCleanup.includes(path.basename(recentStagingDir)),
        runtimeDirs: dirsAfterCleanup,
      },
      preserveStateAndEnv: {
        ok: fs.existsSync(envMarkerPath) && fs.existsSync(stateMarkerPath),
        envMarkerPath,
        stateMarkerPath,
      },
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = Object.entries(report.scenarios)
    .filter(([, scenario]) => !scenario.ok)
    .map(([scenarioName]) => scenarioName);
  if (failures.length > 0) {
    throw new Error(`Single-exe lifecycle verification failed for: ${failures.join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[single-exe-lifecycle] Lifecycle report (${mode}) written to ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));

  void recoveryRun;
  void cleanupRun;
}

main();
