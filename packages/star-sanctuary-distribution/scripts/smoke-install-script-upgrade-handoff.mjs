import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const tmpRoot = path.join(workspaceRoot, "tmp");
const smokeRoot = path.join(workspaceRoot, "tmp", "install-script-upgrade-handoff-smoke");
const reportPath = path.join(workspaceRoot, "tmp", "install-script-upgrade-handoff-smoke-report.json");
const installPs1Path = path.join(workspaceRoot, "install.ps1");
const builtBddEntryPath = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");

function ensureWindowsHost() {
  if (!fs.existsSync(builtBddEntryPath)) {
    throw new Error(`Built CLI entry is missing at ${builtBddEntryPath}. Run 'corepack pnpm build' first.`);
  }
  if (process.platform !== "win32") {
    throw new Error("smoke-install-script-upgrade-handoff currently runs the real install.ps1 path on Windows only.");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function sanitizeEnv(extraEnv = {}) {
  const env = { ...process.env };
  delete env.STAR_SANCTUARY_RUNTIME_DIR;
  delete env.BELLDANDY_RUNTIME_DIR;
  delete env.STAR_SANCTUARY_ENV_DIR;
  delete env.BELLDANDY_ENV_DIR;
  delete env.STAR_SANCTUARY_RUNTIME_MODE;
  delete env.BELLDANDY_RUNTIME_MODE;
  delete env.STAR_SANCTUARY_INSTALL_TEST_FAIL_AT;
  return { ...env, ...extraEnv };
}

async function terminateChild(child) {
  if (child.exitCode != null) {
    return;
  }

  if (child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await wait(1000);
  }
}

async function runCommandToCompletion(params) {
  const {
    command,
    args,
    cwd,
    env,
    stdoutPath,
    stderrPath,
    shell,
    timeoutMs = 0,
  } = params;

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script upgrade handoff stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script upgrade handoff stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
    shell,
  });

  let timedOut = false;
  let timeoutHandle = null;
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(async () => {
        timedOut = true;
        await terminateChild(child);
        resolve(-1);
      }, timeoutMs);
    }
  });

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  return {
    exitCode,
    timedOut,
    stdoutText: fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "",
    stderrText: fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "",
  };
}

async function runStartUntilHealthy(params) {
  const { command, args, cwd, env, port, stdoutPath, stderrPath } = params;
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script upgrade handoff start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script upgrade handoff start stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
    shell: "cmd.exe",
  });

  let healthy = false;
  try {
    for (let i = 0; i < 60; i += 1) {
      await wait(1000);
      if (child.exitCode != null) {
        break;
      }
      if (await checkHealth(port)) {
        healthy = true;
        break;
      }
    }
  } finally {
    await terminateChild(child);
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }

  return {
    healthy,
    stdoutText: fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "",
    stderrText: fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "",
  };
}

function parseJsonOrThrow(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON.\n--- stdout ---\n${text}\n--- parse ---\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  ensureWindowsHost();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [tmpRoot],
    label: "reset install script upgrade handoff smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [tmpRoot],
    label: "reset install script upgrade handoff report",
  });

  const installRoot = path.join(smokeRoot, "windows-install-root");
  const stateDir = path.join(smokeRoot, "windows-install-state");
  const envPath = path.join(stateDir, ".env");
  const envLocalPath = path.join(stateDir, ".env.local");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const firstStartNoticePath = path.join(installRoot, "first-start-notice.txt");
  const backupRoot = path.join(installRoot, "backups");
  const currentRoot = path.join(installRoot, "current");
  const stateMarkerPath = path.join(stateDir, "workspace", "upgrade-handoff-marker.txt");
  const port = 29731;
  const relayPort = 29732;
  const envMarkerLine = "INSTALL_SCRIPT_UPGRADE_HANDOFF=preserved";

  const installArgsBase = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", installPs1Path,
    "-InstallDir", installRoot,
    "-SourceDir", workspaceRoot,
    "-SkipInstallBuild",
    "-NoDesktopShortcut",
  ];

  const firstInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [...installArgsBase, "-NoSetup", "-Version", "v1.0.0-handoff-smoke"],
    cwd: workspaceRoot,
    env: sanitizeEnv({
      BELLDANDY_STATE_DIR: stateDir,
      CI: "true",
    }),
    stdoutPath: path.join(smokeRoot, "install-1.stdout.log"),
    stderrPath: path.join(smokeRoot, "install-1.stderr.log"),
    timeoutMs: 10 * 60 * 1000,
  });
  if (firstInstall.exitCode !== 0) {
    throw new Error(`Initial install.ps1 run failed.\n--- stdout ---\n${firstInstall.stdoutText}\n--- stderr ---\n${firstInstall.stderrText}`);
  }

  fs.mkdirSync(path.dirname(envLocalPath), { recursive: true });
  fs.writeFileSync(envLocalPath, `${envMarkerLine}\nBELLDANDY_AUTH_MODE=none\n`, "utf-8");
  fs.mkdirSync(path.dirname(stateMarkerPath), { recursive: true });
  fs.writeFileSync(stateMarkerPath, "upgrade-handoff-state\n", "utf-8");

  const upgradeInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [...installArgsBase, "-Version", "v2.0.0-handoff-smoke"],
    cwd: workspaceRoot,
    env: sanitizeEnv({
      BELLDANDY_STATE_DIR: stateDir,
      CI: "true",
    }),
    stdoutPath: path.join(smokeRoot, "install-2.stdout.log"),
    stderrPath: path.join(smokeRoot, "install-2.stderr.log"),
    timeoutMs: 10 * 60 * 1000,
  });
  if (upgradeInstall.exitCode !== 0) {
    throw new Error(`Upgrade install.ps1 run failed.\n--- stdout ---\n${upgradeInstall.stdoutText}\n--- stderr ---\n${upgradeInstall.stderrText}`);
  }
  const noticePresentAfterUpgradeInstall = fs.existsSync(firstStartNoticePath);

  const upgradeStart = await runStartUntilHealthy({
    command: path.join(installRoot, "start.bat"),
    args: [],
    cwd: installRoot,
    env: sanitizeEnv({
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      BELLDANDY_STATE_DIR: stateDir,
      AUTO_OPEN_BROWSER: "false",
      CI: "true",
    }),
    port,
    stdoutPath: path.join(smokeRoot, "start-upgrade.stdout.log"),
    stderrPath: path.join(smokeRoot, "start-upgrade.stderr.log"),
  });
  if (!upgradeStart.healthy) {
    throw new Error(`Upgrade start.bat run failed.\n--- stdout ---\n${upgradeStart.stdoutText}\n--- stderr ---\n${upgradeStart.stderrText}`);
  }
  const noticeClearedAfterUpgradeStart = !fs.existsSync(firstStartNoticePath);

  const forceSetupInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [...installArgsBase, "-ForceSetup", "-Version", "v3.0.0-handoff-smoke"],
    cwd: workspaceRoot,
    env: sanitizeEnv({
      BELLDANDY_STATE_DIR: stateDir,
      CI: "true",
      STAR_SANCTUARY_INSTALL_TEST_FAIL_AT: "before_setup",
    }),
    stdoutPath: path.join(smokeRoot, "install-3-force-setup.stdout.log"),
    stderrPath: path.join(smokeRoot, "install-3-force-setup.stderr.log"),
    timeoutMs: 10 * 60 * 1000,
  });
  if (forceSetupInstall.exitCode === 0) {
    throw new Error("Force-setup upgrade run was expected to fail at before_setup, but it exited 0.");
  }

  const rollbackStart = await runStartUntilHealthy({
    command: path.join(installRoot, "start.bat"),
    args: [],
    cwd: installRoot,
    env: sanitizeEnv({
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      BELLDANDY_STATE_DIR: stateDir,
      AUTO_OPEN_BROWSER: "false",
      CI: "true",
    }),
    port,
    stdoutPath: path.join(smokeRoot, "start-rollback.stdout.log"),
    stderrPath: path.join(smokeRoot, "start-rollback.stderr.log"),
  });
  if (!rollbackStart.healthy) {
    throw new Error(`Rollback start.bat run failed after force-setup failure.\n--- stdout ---\n${rollbackStart.stdoutText}\n--- stderr ---\n${rollbackStart.stderrText}`);
  }

  const doctor = await runCommandToCompletion({
    command: "cmd.exe",
    args: ["/c", path.join(installRoot, "bdd.cmd"), "doctor", "--json", "--state-dir", stateDir],
    cwd: installRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "doctor.stdout.log"),
    stderrPath: path.join(smokeRoot, "doctor.stderr.log"),
    timeoutMs: 3 * 60 * 1000,
  });
  if (doctor.exitCode !== 0) {
    throw new Error(`doctor failed after upgrade handoff smoke.\n--- stdout ---\n${doctor.stdoutText}\n--- stderr ---\n${doctor.stderrText}`);
  }

  if (!fs.existsSync(envPath)) {
    throw new Error(`Expected generated .env at ${envPath}`);
  }

  const doctorJson = parseJsonOrThrow(doctor.stdoutText, "doctor");
  const checks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = checks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = checks.find((item) => item?.name === ".env.local");
  const installInfo = parseJsonOrThrow(fs.readFileSync(installInfoPath, "utf-8"), "install-info");
  const currentStat = fs.lstatSync(currentRoot);
  const backupEntries = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("current-")) : [];
  const envLocalText = fs.readFileSync(envLocalPath, "utf-8");
  const stateMarkerText = fs.readFileSync(stateMarkerPath, "utf-8");
  const forceFailureCombined = `${forceSetupInstall.stdoutText}\n${forceSetupInstall.stderrText}`;

  const ok = currentStat.isSymbolicLink()
    && backupEntries.length >= 1
    && upgradeInstall.stdoutText.includes("skipping bdd setup for upgrade handoff")
    && upgradeInstall.stdoutText.includes("-ForceSetup")
    && upgradeInstall.stdoutText.includes("First start:")
    && !upgradeInstall.stdoutText.includes("Launching bdd setup")
    && noticePresentAfterUpgradeInstall
    && noticeClearedAfterUpgradeStart
    && upgradeStart.stdoutText.includes("Post-install note:")
    && upgradeStart.stdoutText.includes("Upgrade preserved your existing .env.local and skipped bdd setup.")
    && forceFailureCombined.includes("Launching bdd setup (-ForceSetup)")
    && forceFailureCombined.includes("Installer test failpoint triggered at before_setup.")
    && installInfo.tag === "v2.0.0-handoff-smoke"
    && installInfo.version === "v2.0.0-handoff-smoke"
    && environmentCheck?.message === stateDir
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === envLocalPath
    && envLocalText.includes(envMarkerLine)
    && stateMarkerText.includes("upgrade-handoff-state")
    && rollbackStart.healthy;

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-script-upgrade-handoff",
    generatedAt: new Date().toISOString(),
    scenario: {
      id: "windows-install-ps1-upgrade-handoff",
      installRoot,
      stateDir,
      currentIsSymlink: currentStat.isSymbolicLink(),
      backupEntries,
      installInfo,
      doctorEnvironmentDir: environmentCheck?.message ?? null,
      doctorEnvLocalPath: envLocalCheck?.message ?? null,
      doctorEnvLocalStatus: envLocalCheck?.status ?? null,
      upgradeAutoSkippedSetup: upgradeInstall.stdoutText.includes("skipping bdd setup for upgrade handoff"),
      upgradeSummaryPrintedFirstStartHint: upgradeInstall.stdoutText.includes("First start:"),
      noticePresentAfterUpgradeInstall,
      noticeClearedAfterUpgradeStart,
      upgradeStartPrintedNotice: upgradeStart.stdoutText.includes("Post-install note:"),
      forceSetupReachedSetupPath: forceFailureCombined.includes("Launching bdd setup (-ForceSetup)"),
      rollbackHealthy: rollbackStart.healthy,
      preservedEnvMarker: envLocalText.includes(envMarkerLine),
      preservedStateMarker: stateMarkerText.includes("upgrade-handoff-state"),
      ok,
      firstInstallStdoutTail: firstInstall.stdoutText.slice(-2500),
      firstInstallStderrTail: firstInstall.stderrText.slice(-2500),
      upgradeInstallStdoutTail: upgradeInstall.stdoutText.slice(-2500),
      upgradeInstallStderrTail: upgradeInstall.stderrText.slice(-2500),
      forceSetupInstallStdoutTail: forceSetupInstall.stdoutText.slice(-2500),
      forceSetupInstallStderrTail: forceSetupInstall.stderrText.slice(-2500),
      rollbackStartStdoutTail: rollbackStart.stdoutText.slice(-2500),
      rollbackStartStderrTail: rollbackStart.stderrText.slice(-2500),
      doctorStdoutTail: doctor.stdoutText.slice(-2500),
      doctorStderrTail: doctor.stderrText.slice(-2500),
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  if (!ok) {
    throw new Error(`Install-script upgrade handoff smoke failed.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log("[install-script-upgrade-handoff-smoke] install.ps1 upgrade setup/skip-setup handoff passed.");
  console.log(JSON.stringify(report, null, 2));
}

main();
