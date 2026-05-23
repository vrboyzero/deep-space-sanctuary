import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const smokeRoot = path.join(workspaceRoot, "artifacts", "install-script-lifecycle-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "install-script-lifecycle-smoke-report.json");
const installPs1Path = path.join(workspaceRoot, "install.ps1");
const builtBddEntryPath = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");

function ensureBuildExists() {
  if (!fs.existsSync(builtBddEntryPath)) {
    throw new Error(`Built CLI entry is missing at ${builtBddEntryPath}. Run 'corepack pnpm build' first.`);
  }
  if (process.platform !== "win32") {
    throw new Error("smoke-install-script-lifecycle currently runs the real install.ps1 path on Windows only.");
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
  const { command, args, cwd, env, stdoutPath, stderrPath, shell } = params;
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script lifecycle stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script lifecycle stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
    shell,
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  return {
    exitCode,
    stdoutText: fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "",
    stderrText: fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "",
  };
}

async function runStartUntilHealthy(params) {
  const { command, args, cwd, env, port, stdoutPath, stderrPath } = params;
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script lifecycle start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script lifecycle start stderr log" });

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
    for (let i = 0; i < 30; i += 1) {
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
  ensureBuildExists();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset install script lifecycle smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset install script lifecycle report",
  });

  const installRoot = path.join(smokeRoot, "windows-install-root");
  const stateDir = path.join(smokeRoot, "windows-install-state");
  const envPath = path.join(stateDir, ".env");
  const envLocalPath = path.join(stateDir, ".env.local");
  const backupRoot = path.join(installRoot, "backups");
  const currentRoot = path.join(installRoot, "current");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const stateMarkerPath = path.join(stateDir, "workspace", "installer-script-marker.txt");
  const port = 29389;
  const relayPort = 29390;
  const envMarkerLine = "INSTALL_SCRIPT_LIFECYCLE=preserved";

  const installArgsBase = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", installPs1Path,
    "-InstallDir", installRoot,
    "-SourceDir", workspaceRoot,
    "-SkipInstallBuild",
    "-NoSetup",
    "-NoDesktopShortcut",
  ];

  const firstInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [...installArgsBase, "-Version", "1.0.0-smoke"],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "install-1.stdout.log"),
    stderrPath: path.join(smokeRoot, "install-1.stderr.log"),
  });
  if (firstInstall.exitCode !== 0) {
    throw new Error(`First install.ps1 run failed.\n--- stdout ---\n${firstInstall.stdoutText}\n--- stderr ---\n${firstInstall.stderrText}`);
  }

  fs.mkdirSync(path.dirname(envLocalPath), { recursive: true });
  fs.writeFileSync(envLocalPath, `${envMarkerLine}\nBELLDANDY_AUTH_MODE=none\n`, "utf-8");
  fs.mkdirSync(path.dirname(stateMarkerPath), { recursive: true });
  fs.writeFileSync(stateMarkerPath, "installer-script-state\n", "utf-8");

  const firstStart = await runStartUntilHealthy({
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
    stdoutPath: path.join(smokeRoot, "start-1.stdout.log"),
    stderrPath: path.join(smokeRoot, "start-1.stderr.log"),
  });
  if (!firstStart.healthy) {
    throw new Error(`First start.bat run failed.\n--- stdout ---\n${firstStart.stdoutText}\n--- stderr ---\n${firstStart.stderrText}`);
  }
  if (!fs.existsSync(envPath)) {
    throw new Error(`Expected generated .env at ${envPath}`);
  }

  const secondInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [...installArgsBase, "-Version", "2.0.0-smoke"],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "install-2.stdout.log"),
    stderrPath: path.join(smokeRoot, "install-2.stderr.log"),
  });
  if (secondInstall.exitCode !== 0) {
    throw new Error(`Second install.ps1 run failed.\n--- stdout ---\n${secondInstall.stdoutText}\n--- stderr ---\n${secondInstall.stderrText}`);
  }

  const secondStart = await runStartUntilHealthy({
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
    stdoutPath: path.join(smokeRoot, "start-2.stdout.log"),
    stderrPath: path.join(smokeRoot, "start-2.stderr.log"),
  });
  if (!secondStart.healthy) {
    throw new Error(`Second start.bat run failed.\n--- stdout ---\n${secondStart.stdoutText}\n--- stderr ---\n${secondStart.stderrText}`);
  }

  const doctor = await runCommandToCompletion({
    command: "cmd.exe",
    args: ["/c", path.join(installRoot, "bdd.cmd"), "doctor", "--json", "--state-dir", stateDir],
    cwd: installRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "doctor.stdout.log"),
    stderrPath: path.join(smokeRoot, "doctor.stderr.log"),
  });
  if (doctor.exitCode !== 0) {
    throw new Error(`doctor failed.\n--- stdout ---\n${doctor.stdoutText}\n--- stderr ---\n${doctor.stderrText}`);
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

  const ok = currentStat.isSymbolicLink()
    && backupEntries.length >= 1
    && installInfo.tag === "v2.0.0-smoke"
    && installInfo.version === "v2.0.0-smoke"
    && environmentCheck?.message === stateDir
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === envLocalPath
    && envLocalText.includes(envMarkerLine)
    && stateMarkerText.includes("installer-script-state");

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-script-lifecycle",
    generatedAt: new Date().toISOString(),
    scenario: {
      id: "windows-install-ps1-rerun",
      installRoot,
      stateDir,
      currentIsSymlink: currentStat.isSymbolicLink(),
      backupEntries,
      installInfo,
      doctorEnvironmentDir: environmentCheck?.message ?? null,
      doctorEnvLocalPath: envLocalCheck?.message ?? null,
      doctorEnvLocalStatus: envLocalCheck?.status ?? null,
      preservedEnvMarker: envLocalText.includes(envMarkerLine),
      preservedStateMarker: stateMarkerText.includes("installer-script-state"),
      ok,
      firstInstallStdoutTail: firstInstall.stdoutText.slice(-2500),
      firstInstallStderrTail: firstInstall.stderrText.slice(-2500),
      secondInstallStdoutTail: secondInstall.stdoutText.slice(-2500),
      secondInstallStderrTail: secondInstall.stderrText.slice(-2500),
      doctorStdoutTail: doctor.stdoutText.slice(-2500),
      doctorStderrTail: doctor.stderrText.slice(-2500),
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  if (!ok) {
    throw new Error(`Install-script lifecycle smoke failed.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log("[install-script-lifecycle-smoke] install.ps1 rerun lifecycle passed.");
  console.log(JSON.stringify(report, null, 2));
}

main();
