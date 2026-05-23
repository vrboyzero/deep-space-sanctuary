import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assertPathInsideRoots, guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const smokeRoot = path.join(workspaceRoot, "artifacts", "install-script-build-wsl-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "install-script-build-wsl-smoke-report.json");
const installShPath = path.join(workspaceRoot, "install.sh");

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
    throw new Error("smoke-install-script-build-wsl currently expects Windows host + WSL.");
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

function removePathWithWslFallback(targetPath, { allowedRoots, label, distro }) {
  const resolvedTargetPath = assertPathInsideRoots(targetPath, allowedRoots, label);
  if (!fs.existsSync(resolvedTargetPath)) {
    return;
  }

  try {
    guardedRemovePath(resolvedTargetPath, { allowedRoots, label });
    return;
  } catch (error) {
    if (!distro || process.platform !== "win32") {
      throw error;
    }
  }

  const targetPathWsl = toWslPath(resolvedTargetPath);
  const result = spawnSync("wsl.exe", ["-d", distro, "bash", "-lc", `rm -rf ${shellQuote(targetPathWsl)}`], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to remove ${resolvedTargetPath} via WSL fallback.\n${decodeMaybeUtf16(result.stderr)}`);
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

function decodeMaybeUtf16(buffer) {
  if (!buffer || buffer.length === 0) {
    return "";
  }
  for (let i = 1; i < buffer.length; i += 2) {
    if (buffer[i] === 0) {
      return buffer.toString("utf16le");
    }
  }
  return buffer.toString("utf8");
}

function checkHealthInWsl(distro, port) {
  const script = `node -e "fetch('http://127.0.0.1:${port}/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"`;
  const result = spawnSync("wsl.exe", ["-d", distro, "bash", "-lc", script], {
    windowsHide: true,
    stdio: "ignore",
  });
  return result.status === 0;
}

function detectWslDistro() {
  const result = spawnSync("wsl.exe", ["-l", "-q"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to list WSL distros.\n${decodeMaybeUtf16(result.stderr)}`);
  }

  const distros = decodeMaybeUtf16(result.stdout)
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().includes("docker-desktop"));

  const ubuntu = distros.find((line) => line.toLowerCase().includes("ubuntu"));
  if (ubuntu) {
    return ubuntu;
  }
  if (distros.length > 0) {
    return distros[0];
  }
  throw new Error("No usable WSL distro found.");
}

function toWslPath(windowsPath) {
  const normalized = path.resolve(windowsPath).replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):(.*)$/);
  if (!match) {
    throw new Error(`Cannot convert path to WSL form: ${windowsPath}`);
  }
  return `/mnt/${match[1].toLowerCase()}${match[2]}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

function createLinuxBuildSource(sourceRoot) {
  resetSandboxDir(sourceRoot, {
    allowedRoots: [smokeRoot],
    label: "reset install script build wsl staged source root",
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
    timeoutMs = 0,
  } = params;

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script build wsl stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script build wsl stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
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
  const {
    command,
    args,
    cwd,
    env,
    port,
    stdoutPath,
    stderrPath,
    checkHealthy,
  } = params;
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script build wsl start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script build wsl start stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });

  let healthy = false;
  try {
    for (let i = 0; i < 120; i += 1) {
      await wait(1000);
      if (child.exitCode != null) {
        break;
      }
      const isHealthy = typeof checkHealthy === "function"
        ? await checkHealthy()
        : await checkHealth(port);
      if (isHealthy) {
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
  const distro = detectWslDistro();
  removePathWithWslFallback(smokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset install script build wsl smoke root",
    distro,
  });
  fs.mkdirSync(smokeRoot, { recursive: true });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset install script build wsl report",
  });
  const stagedSourceRoot = path.join(smokeRoot, "linux-source-stage");
  const installRoot = path.join(smokeRoot, "linux-install-root");
  const stateDir = path.join(smokeRoot, "linux-install-state");
  const envLocalPath = path.join(installRoot, ".env.local");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const backupRoot = path.join(installRoot, "backups");
  const port = 29691;
  const relayPort = 29692;

  createLinuxBuildSource(stagedSourceRoot);

  const stagedSourceRootWsl = toWslPath(stagedSourceRoot);
  const installRootWsl = toWslPath(installRoot);
  const stateDirWsl = toWslPath(stateDir);
  const installShWsl = toWslPath(installShPath);

  const installScript = [
    `${shellQuote(installShWsl)} --install-dir ${shellQuote(installRootWsl)} --source-dir ${shellQuote(stagedSourceRootWsl)} --no-setup --version v3.0.0-build-smoke`,
  ].join(" ");
  const setupScript = [
    `cd ${shellQuote(installRootWsl)} &&`,
    `CI='true'`,
    `${shellQuote(path.posix.join(installRootWsl, "bdd"))} setup --json --flow quickstart --scenario local --provider mock --host 127.0.0.1 --auth-mode none --port ${shellQuote(String(port))} --state-dir ${shellQuote(stateDirWsl)}`,
  ].join(" ");
  const startScript = [
    `cd ${shellQuote(installRootWsl)} &&`,
    `BELLDANDY_PORT=${shellQuote(String(port))}`,
    `BELLDANDY_RELAY_PORT=${shellQuote(String(relayPort))}`,
    `BELLDANDY_STATE_DIR=${shellQuote(stateDirWsl)}`,
    `AUTO_OPEN_BROWSER='false'`,
    `CI='true'`,
    `${shellQuote(path.posix.join(installRootWsl, "start.sh"))}`,
  ].join(" ");
  const doctorScript = [
    `cd ${shellQuote(installRootWsl)} &&`,
    `CI='true'`,
    `${shellQuote(path.posix.join(installRootWsl, "bdd"))} doctor --json --state-dir ${shellQuote(stateDirWsl)}`,
  ].join(" ");
  const betterSqliteScript = [
    `cd ${shellQuote(path.posix.join(installRootWsl, "current", "packages", "belldandy-memory"))} &&`,
    `node -e "require('better-sqlite3'); process.stdout.write('better-sqlite3-ok\\n')"`,
  ].join(" ");

  const install = await runCommandToCompletion({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", installScript],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "install.stdout.log"),
    stderrPath: path.join(smokeRoot, "install.stderr.log"),
    timeoutMs: 20 * 60 * 1000,
  });
  if (install.exitCode !== 0) {
    const reason = install.timedOut ? "timed out" : "failed";
    throw new Error(`install.sh ${reason} for real-source WSL build smoke.\n--- stdout ---\n${install.stdoutText}\n--- stderr ---\n${install.stderrText}`);
  }

  const setup = await runCommandToCompletion({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", setupScript],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "setup.stdout.log"),
    stderrPath: path.join(smokeRoot, "setup.stderr.log"),
    timeoutMs: 5 * 60 * 1000,
  });
  if (setup.exitCode !== 0) {
    const reason = setup.timedOut ? "timed out" : "failed";
    throw new Error(`bdd setup ${reason} after WSL install build smoke.\n--- stdout ---\n${setup.stdoutText}\n--- stderr ---\n${setup.stderrText}`);
  }

  const start = await runStartUntilHealthy({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", startScript],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    port,
    stdoutPath: path.join(smokeRoot, "start.stdout.log"),
    stderrPath: path.join(smokeRoot, "start.stderr.log"),
    checkHealthy: () => checkHealthInWsl(distro, port),
  });
  if (!start.healthy) {
    throw new Error(`start.sh failed after WSL install build smoke.\n--- stdout ---\n${start.stdoutText}\n--- stderr ---\n${start.stderrText}`);
  }

  const doctor = await runCommandToCompletion({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", doctorScript],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "doctor.stdout.log"),
    stderrPath: path.join(smokeRoot, "doctor.stderr.log"),
    timeoutMs: 3 * 60 * 1000,
  });
  if (doctor.exitCode !== 0) {
    throw new Error(`doctor failed after WSL install build smoke.\n--- stdout ---\n${doctor.stdoutText}\n--- stderr ---\n${doctor.stderrText}`);
  }

  const betterSqlite = await runCommandToCompletion({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", betterSqliteScript],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "better-sqlite3.stdout.log"),
    stderrPath: path.join(smokeRoot, "better-sqlite3.stderr.log"),
    timeoutMs: 2 * 60 * 1000,
  });
  if (betterSqlite.exitCode !== 0) {
    throw new Error(`better-sqlite3 load failed after WSL install build smoke.\n--- stdout ---\n${betterSqlite.stdoutText}\n--- stderr ---\n${betterSqlite.stderrText}`);
  }

  const currentCopyCheck = await runCommandToCompletion({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", `test ! -L ${shellQuote(path.posix.join(installRootWsl, "current"))}`],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, "current-copy.stdout.log"),
    stderrPath: path.join(smokeRoot, "current-copy.stderr.log"),
    timeoutMs: 60 * 1000,
  });

  const setupJson = parseJsonOrThrow(setup.stdoutText, "setup");
  const doctorJson = parseJsonOrThrow(doctor.stdoutText, "doctor");
  const installInfo = parseJsonOrThrow(fs.readFileSync(installInfoPath, "utf-8"), "install-info");
  const checks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = checks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = checks.find((item) => item?.name === ".env.local");
  const backupEntries = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("current-")) : [];
  const envLocalText = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";
  const approveBuildsWarningPresent = install.stdoutText.includes("Run \"pnpm approve-builds\"")
    || install.stdoutText.includes("Ignored build scripts:");

  const ok = currentCopyCheck.exitCode === 0
    && install.stdoutText.includes("Installing workspace dependencies")
    && install.stdoutText.includes("Building workspace")
    && !install.stdoutText.includes("Skipping dependency install/build")
    && start.healthy
    && setupJson?.path === path.posix.join(installRootWsl, ".env.local")
    && installInfo.tag === "v3.0.0-build-smoke"
    && installInfo.version === "v3.0.0-build-smoke"
    && environmentCheck?.message === installRootWsl
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === path.posix.join(installRootWsl, ".env.local")
    && envLocalText.includes("BELLDANDY_AGENT_PROVIDER")
    && envLocalText.includes("BELLDANDY_AUTH_MODE")
    && betterSqlite.stdoutText.includes("better-sqlite3-ok")
    && backupEntries.length === 0
    && !approveBuildsWarningPresent;

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-script-build-wsl",
    generatedAt: new Date().toISOString(),
    scenario: {
      id: "wsl-install-sh-real-source-build",
      distro,
      stagedSourceRoot,
      installRoot,
      stateDir,
      currentIsCopy: currentCopyCheck.exitCode === 0,
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
    throw new Error(`Install-script build WSL smoke failed.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log("[install-script-build-wsl-smoke] install.sh real-source build + setup + start + /health passed.");
  console.log(JSON.stringify(report, null, 2));
}

main();
