import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const smokeRoot = path.join(workspaceRoot, "artifacts", "install-script-rollback-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "install-script-rollback-smoke-report.json");
const installPs1Path = path.join(workspaceRoot, "install.ps1");
const builtBddEntryPath = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");

const FAILPOINTS = [
  { id: "after-backup", failAt: "after_backup", useSetup: false },
  { id: "after-promote", failAt: "after_promote", useSetup: false },
  { id: "before-install-build", failAt: "before_install_build", useSetup: false },
  { id: "before-setup", failAt: "before_setup", useSetup: true },
];

function ensureBuildExists() {
  if (!fs.existsSync(builtBddEntryPath)) {
    throw new Error(`Built CLI entry is missing at ${builtBddEntryPath}. Run 'corepack pnpm build' first.`);
  }
  if (process.platform !== "win32") {
    throw new Error("smoke-install-script-rollback currently runs the real install.ps1 path on Windows only.");
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
  delete env.BELLDANDY_AUTH_MODE;
  delete env.BELLDANDY_AUTH_TOKEN;
  delete env.BELLDANDY_AUTH_PASSWORD;
  delete env.BELLDANDY_COMMUNITY_API_ENABLED;
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
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script rollback stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script rollback stderr log" });

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
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script rollback start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script rollback start stderr log" });

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

async function runScenario(scenario, index) {
  const installRoot = path.join(smokeRoot, scenario.id);
  const stateDir = path.join(smokeRoot, `${scenario.id}-state`);
  const brokenSourceDir = path.join(smokeRoot, `${scenario.id}-broken-source`);
  const envPath = path.join(stateDir, ".env");
  const envLocalPath = path.join(stateDir, ".env.local");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const backupRoot = path.join(installRoot, "backups");
  const port = 29489 + (index * 2);
  const relayPort = port + 1;
  const envMarkerLine = `INSTALL_SCRIPT_ROLLBACK_${scenario.failAt}=preserved`;
  const stateMarkerPath = path.join(stateDir, "workspace", `${scenario.id}-marker.txt`);

  guardedRemovePath(installRoot, { allowedRoots: [smokeRoot], label: "reset install script rollback install root" });
  guardedRemovePath(stateDir, { allowedRoots: [smokeRoot], label: "reset install script rollback state dir" });
  guardedRemovePath(brokenSourceDir, { allowedRoots: [smokeRoot], label: "reset install script rollback broken source dir" });
  fs.mkdirSync(brokenSourceDir, { recursive: true });

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

  const initialInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [...installArgsBase, "-Version", "1.0.0-smoke"],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, `${scenario.id}-install-initial.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-install-initial.stderr.log`),
  });
  if (initialInstall.exitCode !== 0) {
    throw new Error(`${scenario.id} initial install failed.\n--- stdout ---\n${initialInstall.stdoutText}\n--- stderr ---\n${initialInstall.stderrText}`);
  }

  const initialStart = await runStartUntilHealthy({
    command: path.join(installRoot, "start.bat"),
    args: [],
    cwd: installRoot,
    env: sanitizeEnv({
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      BELLDANDY_STATE_DIR: stateDir,
      BELLDANDY_AUTH_MODE: "none",
      BELLDANDY_COMMUNITY_API_ENABLED: "false",
      AUTO_OPEN_BROWSER: "false",
      CI: "true",
    }),
    port,
    stdoutPath: path.join(smokeRoot, `${scenario.id}-start-initial.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-start-initial.stderr.log`),
  });
  if (!initialStart.healthy) {
    throw new Error(`${scenario.id} initial start failed.\n--- stdout ---\n${initialStart.stdoutText}\n--- stderr ---\n${initialStart.stderrText}`);
  }
  if (!fs.existsSync(envPath)) {
    throw new Error(`${scenario.id} expected generated .env at ${envPath}`);
  }

  fs.writeFileSync(envLocalPath, `${envMarkerLine}\n`, "utf-8");
  fs.mkdirSync(path.dirname(stateMarkerPath), { recursive: true });
  fs.writeFileSync(stateMarkerPath, `${scenario.id}-state\n`, "utf-8");

  const failureArgs = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", installPs1Path,
    "-InstallDir", installRoot,
    "-SourceDir", brokenSourceDir,
    "-SkipInstallBuild",
    "-NoDesktopShortcut",
    "-Version", "2.0.0-smoke",
  ];
  if (!scenario.useSetup) {
    failureArgs.splice(failureArgs.length - 2, 0, "-NoSetup");
  }

  const failedInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: failureArgs,
    cwd: workspaceRoot,
    env: sanitizeEnv({
      CI: "true",
      STAR_SANCTUARY_INSTALL_TEST_FAIL_AT: scenario.failAt,
    }),
    stdoutPath: path.join(smokeRoot, `${scenario.id}-install-fail.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-install-fail.stderr.log`),
  });
  if (failedInstall.exitCode === 0) {
    throw new Error(`${scenario.id} expected install.ps1 to fail at ${scenario.failAt}, but it exited 0.`);
  }

  const rollbackStart = await runStartUntilHealthy({
    command: path.join(installRoot, "start.bat"),
    args: [],
    cwd: installRoot,
    env: sanitizeEnv({
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      BELLDANDY_STATE_DIR: stateDir,
      BELLDANDY_AUTH_MODE: "none",
      BELLDANDY_COMMUNITY_API_ENABLED: "false",
      AUTO_OPEN_BROWSER: "false",
      CI: "true",
    }),
    port,
    stdoutPath: path.join(smokeRoot, `${scenario.id}-start-rollback.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-start-rollback.stderr.log`),
  });

  const doctor = await runCommandToCompletion({
    command: "cmd.exe",
    args: ["/c", path.join(installRoot, "bdd.cmd"), "doctor", "--json", "--state-dir", stateDir],
    cwd: installRoot,
    env: sanitizeEnv({
      BELLDANDY_AUTH_MODE: "none",
      BELLDANDY_COMMUNITY_API_ENABLED: "false",
      CI: "true",
    }),
    stdoutPath: path.join(smokeRoot, `${scenario.id}-doctor.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-doctor.stderr.log`),
  });
  if (doctor.exitCode !== 0) {
    throw new Error(`${scenario.id} doctor failed after rollback.\n--- stdout ---\n${doctor.stdoutText}\n--- stderr ---\n${doctor.stderrText}`);
  }

  const doctorJson = parseJsonOrThrow(doctor.stdoutText, `${scenario.id} doctor`);
  const checks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = checks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = checks.find((item) => item?.name === ".env.local");
  const installInfo = parseJsonOrThrow(fs.readFileSync(installInfoPath, "utf-8"), `${scenario.id} install-info`);
  const envLocalText = fs.readFileSync(envLocalPath, "utf-8");
  const stateMarkerText = fs.readFileSync(stateMarkerPath, "utf-8");
  const backupEntries = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("current-")) : [];

  const ok = failedInstall.stderrText.includes(`Installer test failpoint triggered at ${scenario.failAt}`)
    && rollbackStart.healthy
    && installInfo.tag === "v1.0.0-smoke"
    && installInfo.version === "v1.0.0-smoke"
    && environmentCheck?.message === stateDir
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === envLocalPath
    && envLocalText.includes(envMarkerLine)
    && stateMarkerText.includes(`${scenario.id}-state`)
    && backupEntries.length === 0;

  return {
    id: scenario.id,
    failAt: scenario.failAt,
    useSetup: scenario.useSetup,
    backupEntries,
    installInfo,
    doctorEnvironmentDir: environmentCheck?.message ?? null,
    doctorEnvLocalPath: envLocalCheck?.message ?? null,
    doctorEnvLocalStatus: envLocalCheck?.status ?? null,
    rollbackHealthy: rollbackStart.healthy,
    preservedEnvMarker: envLocalText.includes(envMarkerLine),
    preservedStateMarker: stateMarkerText.includes(`${scenario.id}-state`),
    ok,
    failedInstallStdoutTail: failedInstall.stdoutText.slice(-2500),
    failedInstallStderrTail: failedInstall.stderrText.slice(-2500),
    rollbackStartStdoutTail: rollbackStart.stdoutText.slice(-2500),
    rollbackStartStderrTail: rollbackStart.stderrText.slice(-2500),
    doctorStdoutTail: doctor.stdoutText.slice(-2500),
    doctorStderrTail: doctor.stderrText.slice(-2500),
  };
}

async function main() {
  ensureBuildExists();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset install script rollback smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset install script rollback report",
  });

  const scenarios = [];
  for (const [index, scenario] of FAILPOINTS.entries()) {
    scenarios.push(await runScenario(scenario, index));
  }

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-script-rollback",
    generatedAt: new Date().toISOString(),
    scenarios,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = scenarios.filter((scenario) => !scenario.ok);
  if (failures.length > 0) {
    throw new Error(`Install-script rollback smoke failed for: ${failures.map((scenario) => scenario.id).join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[install-script-rollback-smoke] install.ps1 rollback passed for ${scenarios.length} failpoints.`);
  console.log(JSON.stringify(report, null, 2));
}

main();
