import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getModeLogSuffix, resolveDistributionMode, resolveSingleExeArtifactRoot } from "./distribution-mode.mjs";
import { guardedRemovePath } from "./sandbox-paths.mjs";
import {
  checkHealth,
  reserveFreePort,
  resolveStartupWaitSeconds,
  terminateChild,
  wait,
} from "./runtime-process.mjs";
import { assertPathInsideRoots, resolveSingleExeVerifyRoots } from "./single-exe-verify-paths.mjs";

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
  kind: "deps",
  suffix,
});
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const metadataPath = path.join(singleExeRoot, "single-exe.json");
const executablePath = path.join(singleExeRoot, "star-sanctuary-single.exe");
const singleExeHome = verifyRoots.homeDir;
const stateDir = verifyRoots.stateDir;
const stdoutPath = path.join(workspaceRoot, "artifacts", `single-exe-verify${suffix}.stdout.log`);
const stderrPath = path.join(workspaceRoot, "artifacts", `single-exe-verify${suffix}.stderr.log`);
const reportPath = path.join(singleExeRoot, "single-exe-deps-report.json");
const extractedVerifyStdoutPath = path.join(workspaceRoot, "artifacts", `single-exe-runtime-check${suffix}.stdout.log`);
const extractedVerifyStderrPath = path.join(workspaceRoot, "artifacts", `single-exe-runtime-check${suffix}.stderr.log`);
const portableArtifactVerifierPath = path.join(
  workspaceRoot,
  "packages",
  "star-sanctuary-distribution",
  "scripts",
  "verify-portable-artifacts.mjs",
);

async function waitForChildExit(child) {
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function buildVersionKey(metadata) {
  return `${metadata.version}-${metadata.platform}-${metadata.arch}`;
}

function ensureArtifactExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

async function runSingleExeForExtraction() {
  guardedRemovePath(stdoutPath, { allowedRoots: [artifactsRoot], label: "reset single-exe deps stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [artifactsRoot], label: "reset single-exe deps stderr log" });
  guardedRemovePath(assertPathInsideRoots(singleExeHome, [verifyRoots.runRoot], "reset single-exe verify home"), {
    allowedRoots: [verifyRoots.runRoot],
    label: "reset single-exe verify home",
  });
  guardedRemovePath(assertPathInsideRoots(stateDir, [verifyRoots.runRoot], "reset single-exe verify state dir"), {
    allowedRoots: [verifyRoots.runRoot],
    label: "reset single-exe verify state dir",
  });
  const port = await reserveFreePort();
  const relayPort = await reserveFreePort();

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  const child = spawn(executablePath, [], {
    cwd: singleExeRoot,
    env: {
      ...process.env,
      STAR_SANCTUARY_SINGLE_EXE_HOME: singleExeHome,
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
    for (let i = 0; i < resolveStartupWaitSeconds(mode, { slim: 90, full: 180 }); i += 1) {
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

  if (!healthy) {
    const stdoutText = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
    const stderrText = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";
    throw new Error(`Single-exe dependency extraction failed.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }
}

async function runExtractedRuntimeCheck() {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  const versionKey = buildVersionKey(metadata);
  const versionRootDir = path.join(singleExeHome, "runtime", versionKey);
  const runtimeExecutable = path.join(versionRootDir, platform === "win32" ? "node-runtime.exe" : "node-runtime");
  const entryScript = path.join(
    versionRootDir,
    "runtime",
    "packages",
    "star-sanctuary-distribution",
    "dist",
    "portable-runtime-check.js",
  );

  ensureArtifactExists(runtimeExecutable, "extracted runtime executable");
  ensureArtifactExists(entryScript, "single-exe runtime check entry");

  guardedRemovePath(reportPath, { allowedRoots: [singleExeRoot], label: "reset single-exe deps report" });
  guardedRemovePath(extractedVerifyStdoutPath, { allowedRoots: [artifactsRoot], label: "reset single-exe runtime-check stdout log" });
  guardedRemovePath(extractedVerifyStderrPath, { allowedRoots: [artifactsRoot], label: "reset single-exe runtime-check stderr log" });

  const stdout = fs.openSync(extractedVerifyStdoutPath, "w");
  const stderr = fs.openSync(extractedVerifyStderrPath, "w");
  const child = spawn(runtimeExecutable, [entryScript], {
    cwd: versionRootDir,
    env: {
      ...process.env,
      STAR_SANCTUARY_PORTABLE_REPORT_PATH: reportPath,
      AUTO_OPEN_BROWSER: "false",
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });

  const exitCode = await waitForChildExit(child);
  fs.closeSync(stdout);
  fs.closeSync(stderr);

  if (exitCode !== 0) {
    const stdoutText = fs.existsSync(extractedVerifyStdoutPath)
      ? fs.readFileSync(extractedVerifyStdoutPath, "utf-8")
      : "";
    const stderrText = fs.existsSync(extractedVerifyStderrPath)
      ? fs.readFileSync(extractedVerifyStderrPath, "utf-8")
      : "";
    throw new Error(`Single-exe runtime dependency check failed.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }

  if (!fs.existsSync(reportPath)) {
    throw new Error("Single-exe dependency report was not generated.");
  }

  return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
}

function runExtractedRelayArtifactVerifier() {
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  const versionRootDir = path.join(singleExeHome, "runtime", buildVersionKey(metadata));
  const runtimeExecutable = path.join(
    versionRootDir,
    platform === "win32" ? "node-runtime.exe" : "node-runtime",
  );
  const result = spawnSync(process.execPath, [
    portableArtifactVerifierPath,
    `--mode=${mode}`,
    `--runtime-version-root=${versionRootDir}`,
    `--runtime-executable=${runtimeExecutable}`,
  ], {
    cwd: workspaceRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Single-exe extracted Relay artifact verification failed.\n${result.stderr || result.stdout}`,
    );
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

function assertReport(report) {
  const nodePtyOk = mode !== "full"
    || (report.nodePty?.installed && report.nodePty?.backend === "node-pty");

  if (
    !report.betterSqlite3?.ok
    || !report.sqliteVec?.ok
    || !nodePtyOk
    || !report.protobufjs?.ok
    || !report.launcher?.openModule?.ok
    || !report.browserToolchain?.puppeteerCore?.ok
    || !report.browserToolchain?.browserToolsModule?.ok
    || !report.browserToolchain?.readability?.ok
    || !report.browserToolchain?.turndown?.ok
  ) {
    throw new Error(`Single-exe dependency verification reported failures.\n${JSON.stringify(report, null, 2)}`);
  }
}

async function main() {
  if (!fs.existsSync(executablePath) || !fs.existsSync(metadataPath)) {
    throw new Error(`Single-exe artifact is missing for mode=${mode}. Run 'corepack pnpm build:single-exe${mode === "full" ? ":full" : ""}' first.`);
  }

  await runSingleExeForExtraction();
  const report = await runExtractedRuntimeCheck();
  assertReport(report);
  runExtractedRelayArtifactVerifier();

  console.log(`[single-exe-verify] Dependency report (${mode}) written to ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main();
