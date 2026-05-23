import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const tmpRoot = path.join(workspaceRoot, "tmp");
const smokeRoot = path.join(workspaceRoot, "tmp", "install-script-build-smoke");
const reportPath = path.join(workspaceRoot, "tmp", "install-script-build-smoke-report.json");
const installPs1Path = path.join(workspaceRoot, "install.ps1");

const STAGED_SOURCE_ENTRIES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".npmrc",
  "apps",
  "scripts",
  "packages",
];

const STAGED_SOURCE_EXCLUDED_PARTS = new Set([
  ".git",
  ".playwright-mcp",
  "artifacts",
  "node_modules",
  "tmp",
  ".tmp",
]);

function ensureWindowsHost() {
  if (process.platform !== "win32") {
    throw new Error("smoke-install-script-build currently runs the real install.ps1 build path on Windows only.");
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

function shouldCopyToStaging(sourcePath) {
  const relative = path.relative(workspaceRoot, sourcePath);
  if (!relative || relative === "") {
    return true;
  }

  const parts = relative.split(path.sep);
  if (parts.some((part) => STAGED_SOURCE_EXCLUDED_PARTS.has(part))) {
    return false;
  }

  const base = path.basename(sourcePath);
  if (base === "dist" || base.endsWith(".tsbuildinfo")) {
    return false;
  }

  return true;
}

function createWindowsBuildSource(sourceRoot) {
  resetSandboxDir(sourceRoot, {
    allowedRoots: [smokeRoot],
    label: "reset install script build staged source root",
  });
  for (const entry of STAGED_SOURCE_ENTRIES) {
    const sourcePath = path.join(workspaceRoot, entry);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing staging source entry: ${sourcePath}`);
    }
    const destinationPath = path.join(sourceRoot, entry);
    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      force: true,
      filter: shouldCopyToStaging,
    });
  }
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

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script build stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script build stderr log" });

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
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script build start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script build start stderr log" });

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
    for (let i = 0; i < 120; i += 1) {
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
    label: "reset install script build smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [tmpRoot],
    label: "reset install script build report",
  });

  const stagedSourceRoot = path.join(smokeRoot, "windows-source-stage");
  const installRoot = path.join(smokeRoot, "windows-install-root");
  const stateDir = path.join(smokeRoot, "windows-install-state");
  const envLocalPath = path.join(stateDir, ".env.local");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const backupRoot = path.join(installRoot, "backups");
  const port = 29681;
  const relayPort = 29682;

  createWindowsBuildSource(stagedSourceRoot);

  const install = await runCommandToCompletion({
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", installPs1Path,
      "-InstallDir", installRoot,
      "-SourceDir", stagedSourceRoot,
      "-NoSetup",
      "-NoDesktopShortcut",
      "-Version", "v3.0.0-build-smoke",
    ],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "install.stdout.log"),
    stderrPath: path.join(smokeRoot, "install.stderr.log"),
    timeoutMs: 20 * 60 * 1000,
  });
  if (install.exitCode !== 0) {
    const reason = install.timedOut ? "timed out" : "failed";
    throw new Error(`install.ps1 ${reason} for real-source Windows build smoke.\n--- stdout ---\n${install.stdoutText}\n--- stderr ---\n${install.stderrText}`);
  }

  const setup = await runCommandToCompletion({
    command: "cmd.exe",
    args: [
      "/c",
      path.join(installRoot, "bdd.cmd"),
      "setup",
      "--json",
      "--flow", "quickstart",
      "--scenario", "local",
      "--provider", "mock",
      "--host", "127.0.0.1",
      "--auth-mode", "none",
      "--port", String(port),
      "--state-dir", stateDir,
    ],
    cwd: installRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "setup.stdout.log"),
    stderrPath: path.join(smokeRoot, "setup.stderr.log"),
    timeoutMs: 5 * 60 * 1000,
  });
  if (setup.exitCode !== 0) {
    const reason = setup.timedOut ? "timed out" : "failed";
    throw new Error(`bdd setup ${reason} after Windows install build smoke.\n--- stdout ---\n${setup.stdoutText}\n--- stderr ---\n${setup.stderrText}`);
  }

  const start = await runStartUntilHealthy({
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
    stdoutPath: path.join(smokeRoot, "start.stdout.log"),
    stderrPath: path.join(smokeRoot, "start.stderr.log"),
  });
  if (!start.healthy) {
    throw new Error(`start.bat failed after Windows install build smoke.\n--- stdout ---\n${start.stdoutText}\n--- stderr ---\n${start.stderrText}`);
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
    throw new Error(`doctor failed after Windows install build smoke.\n--- stdout ---\n${doctor.stdoutText}\n--- stderr ---\n${doctor.stderrText}`);
  }

  const betterSqlite = await runCommandToCompletion({
    command: "node",
    args: ["-e", "require('better-sqlite3'); process.stdout.write('better-sqlite3-ok\\n')"],
    cwd: path.join(installRoot, "current", "packages", "belldandy-memory"),
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "better-sqlite3.stdout.log"),
    stderrPath: path.join(smokeRoot, "better-sqlite3.stderr.log"),
    timeoutMs: 2 * 60 * 1000,
  });
  if (betterSqlite.exitCode !== 0) {
    throw new Error(`better-sqlite3 load failed after Windows install build smoke.\n--- stdout ---\n${betterSqlite.stdoutText}\n--- stderr ---\n${betterSqlite.stderrText}`);
  }

  const setupJson = parseJsonOrThrow(setup.stdoutText, "setup");
  const doctorJson = parseJsonOrThrow(doctor.stdoutText, "doctor");
  const installInfo = parseJsonOrThrow(fs.readFileSync(installInfoPath, "utf-8"), "install-info");
  const currentStat = fs.lstatSync(path.join(installRoot, "current"));
  const checks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = checks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = checks.find((item) => item?.name === ".env.local");
  const backupEntries = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("current-")) : [];
  const envLocalText = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";
  const approveBuildsWarningPresent = install.stdoutText.includes("Run \"pnpm approve-builds\"")
    || install.stdoutText.includes("Ignored build scripts:");

  const ok = !currentStat.isSymbolicLink()
    && install.stdoutText.includes("Installing workspace dependencies")
    && install.stdoutText.includes("Building workspace")
    && !install.stdoutText.includes("Skipping dependency install/build")
    && start.healthy
    && setupJson?.path === envLocalPath
    && installInfo.tag === "v3.0.0-build-smoke"
    && installInfo.version === "v3.0.0-build-smoke"
    && environmentCheck?.message === stateDir
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === envLocalPath
    && envLocalText.includes("BELLDANDY_AGENT_PROVIDER")
    && envLocalText.includes("BELLDANDY_AUTH_MODE")
    && betterSqlite.stdoutText.includes("better-sqlite3-ok")
    && backupEntries.length === 0
    && !approveBuildsWarningPresent
    && !install.stdoutText.includes("Failed to create bin");

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-script-build",
    generatedAt: new Date().toISOString(),
    scenario: {
      id: "windows-install-ps1-real-source-build",
      stagedSourceRoot,
      installRoot,
      stateDir,
      currentIsCopy: !currentStat.isSymbolicLink(),
      backupEntries,
      installInfo,
      setupPath: setupJson?.path ?? null,
      startHealthy: start.healthy,
      doctorEnvironmentDir: environmentCheck?.message ?? null,
      doctorEnvLocalPath: envLocalCheck?.message ?? null,
      doctorEnvLocalStatus: envLocalCheck?.status ?? null,
      betterSqliteLoaded: betterSqlite.stdoutText.includes("better-sqlite3-ok"),
      approveBuildsWarningPresent,
      ok,
      installStdoutTail: install.stdoutText.slice(-4000),
      installStderrTail: install.stderrText.slice(-4000),
      setupStdoutTail: setup.stdoutText.slice(-4000),
      setupStderrTail: setup.stderrText.slice(-4000),
      startStdoutTail: start.stdoutText.slice(-4000),
      startStderrTail: start.stderrText.slice(-4000),
      doctorStdoutTail: doctor.stdoutText.slice(-4000),
      doctorStderrTail: doctor.stderrText.slice(-4000),
      betterSqliteStdoutTail: betterSqlite.stdoutText.slice(-4000),
      betterSqliteStderrTail: betterSqlite.stderrText.slice(-4000),
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  if (!ok) {
    throw new Error(`Install-script build smoke failed.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log("[install-script-build-smoke] install.ps1 real-source build + setup + start + /health passed.");
  console.log(JSON.stringify(report, null, 2));
}

main();
