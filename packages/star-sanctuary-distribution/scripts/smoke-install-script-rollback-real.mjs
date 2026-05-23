import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const tmpRoot = path.join(workspaceRoot, "tmp");
const smokeRoot = path.join(workspaceRoot, "tmp", "install-script-rollback-real-smoke");
const reportPath = path.join(workspaceRoot, "tmp", "install-script-rollback-real-smoke-report.json");
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

const REAL_FAILURE_SCENARIOS = [
  {
    id: "missing-package-manager-source",
    version: "v2.0.0-build-failure",
    useSetup: false,
    skipInstallBuild: false,
    expectedFailureTexts: ["Failed to resolve packageManager from package.json."],
    prepareBrokenSource(sourceRoot) {
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.writeFileSync(path.join(sourceRoot, "README.txt"), "missing package.json\n", "utf-8");
    },
  },
  {
    id: "invalid-package-manager-prepare",
    version: "v2.0.0-corepack-failure",
    useSetup: false,
    skipInstallBuild: false,
    expectedFailureTexts: ["corepack prepare pnpm@0.0.0-impossible failed."],
    prepareBrokenSource(sourceRoot) {
      createWorkspaceSource(sourceRoot);
      const packageJsonPath = path.join(sourceRoot, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      packageJson.packageManager = "pnpm@0.0.0-impossible";
      writeJsonFile(packageJsonPath, packageJson);
    },
  },
  {
    id: "unreachable-dependency-install",
    version: "v2.0.0-install-failure",
    useSetup: false,
    skipInstallBuild: false,
    expectedFailureTexts: ["corepack pnpm install failed.", "127.0.0.1:9/rollback-external-dep-probe.tgz"],
    prepareBrokenSource(sourceRoot) {
      createWorkspaceSource(sourceRoot);
      const packageJsonPath = path.join(sourceRoot, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      packageJson.devDependencies = {
        ...(packageJson.devDependencies ?? {}),
        __rollback_external_dep_probe__: "http://127.0.0.1:9/rollback-external-dep-probe.tgz",
      };
      writeJsonFile(packageJsonPath, packageJson);
    },
    getFailureEnv({ scenarioCacheRoot }) {
      return {
        CI: "false",
        PNPM_FROZEN_LOCKFILE: "false",
        npm_config_frozen_lockfile: "false",
        npm_config_store_dir: path.join(scenarioCacheRoot, "pnpm-store"),
      };
    },
  },
  {
    id: "unreachable-registry-install",
    version: "v2.0.0-registry-install-failure",
    useSetup: false,
    skipInstallBuild: false,
    expectedFailureTexts: ["corepack pnpm install failed.", "127.0.0.1:9"],
    prepareBrokenSource(sourceRoot) {
      createWorkspaceSource(sourceRoot);
      const npmrcPath = path.join(sourceRoot, ".npmrc");
      const packageJsonPath = path.join(sourceRoot, "package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      const existingNpmrc = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, "utf-8").trimEnd() : "";

      packageJson.devDependencies = {
        ...(packageJson.devDependencies ?? {}),
        "rollback-registry-fetch-probe": "1.0.0",
      };
      writeJsonFile(packageJsonPath, packageJson);
      fs.writeFileSync(
        npmrcPath,
        `${existingNpmrc ? `${existingNpmrc}\n` : ""}registry=http://127.0.0.1:9/\n`,
        "utf-8",
      );
    },
    getFailureEnv({ scenarioCacheRoot }) {
      return {
        CI: "false",
        PNPM_FROZEN_LOCKFILE: "false",
        npm_config_frozen_lockfile: "false",
        npm_config_store_dir: path.join(scenarioCacheRoot, "pnpm-store"),
      };
    },
  },
  {
    id: "missing-bdd-entry-setup",
    version: "v2.0.0-setup-failure",
    useSetup: true,
    skipInstallBuild: true,
    expectedFailureTexts: ["Cannot find module", "'bdd setup' exited with code 1."],
    prepareBrokenSource(sourceRoot) {
      fs.mkdirSync(path.join(sourceRoot, "packages", "belldandy-core"), { recursive: true });
      fs.writeFileSync(
        path.join(sourceRoot, "package.json"),
        `${JSON.stringify({
          name: "star-sanctuary-broken-setup-fixture",
          private: true,
          type: "module",
          packageManager: "pnpm@10.23.0",
        }, null, 2)}\n`,
        "utf-8",
      );
    },
  },
];

function ensureWindowsHost() {
  if (process.platform !== "win32") {
    throw new Error("smoke-install-script-rollback-real currently runs the real install.ps1 path on Windows only.");
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

function createWorkspaceSource(sourceRoot) {
  guardedRemovePath(sourceRoot, {
    allowedRoots: [smokeRoot],
    label: "reset install script rollback real staged source root",
  });
  fs.mkdirSync(sourceRoot, { recursive: true });

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

function writeJsonFile(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function runCommandToCompletion(params) {
  const { command, args, cwd, env, stdoutPath, stderrPath, shell, timeoutMs = 0 } = params;
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script rollback real stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script rollback real stderr log" });

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
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install script rollback real start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install script rollback real start stderr log" });

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

async function runScenario(scenario, index) {
  const installRoot = path.join(smokeRoot, scenario.id);
  const stateDir = path.join(smokeRoot, `${scenario.id}-state`);
  const brokenSourceDir = path.join(smokeRoot, `${scenario.id}-broken-source`);
  const scenarioCacheRoot = path.join(smokeRoot, `${scenario.id}-cache`);
  const envPath = path.join(installRoot, ".env");
  const envLocalPath = path.join(installRoot, ".env.local");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const backupRoot = path.join(installRoot, "backups");
  const currentRoot = path.join(installRoot, "current");
  const port = 29711 + (index * 2);
  const relayPort = port + 1;
  const envMarkerLine = `INSTALL_SCRIPT_REAL_ROLLBACK_${scenario.id}=preserved`;
  const stateMarkerPath = path.join(stateDir, "workspace", `${scenario.id}-marker.txt`);

  guardedRemovePath(installRoot, { allowedRoots: [smokeRoot], label: "reset install script rollback real install root" });
  guardedRemovePath(stateDir, { allowedRoots: [smokeRoot], label: "reset install script rollback real state dir" });
  guardedRemovePath(brokenSourceDir, { allowedRoots: [smokeRoot], label: "reset install script rollback real broken source dir" });
  guardedRemovePath(scenarioCacheRoot, { allowedRoots: [smokeRoot], label: "reset install script rollback real scenario cache root" });
  fs.mkdirSync(scenarioCacheRoot, { recursive: true });
  scenario.prepareBrokenSource(brokenSourceDir);

  const baselineInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", installPs1Path,
      "-InstallDir", installRoot,
      "-SourceDir", workspaceRoot,
      "-SkipInstallBuild",
      "-NoSetup",
      "-NoDesktopShortcut",
      "-Version", "v1.0.0-smoke",
    ],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, `${scenario.id}-install-initial.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-install-initial.stderr.log`),
    timeoutMs: 10 * 60 * 1000,
  });
  if (baselineInstall.exitCode !== 0) {
    throw new Error(`${scenario.id} baseline install failed.\n--- stdout ---\n${baselineInstall.stdoutText}\n--- stderr ---\n${baselineInstall.stderrText}`);
  }

  const baselineStart = await runStartUntilHealthy({
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
    stdoutPath: path.join(smokeRoot, `${scenario.id}-start-initial.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-start-initial.stderr.log`),
  });
  if (!baselineStart.healthy) {
    throw new Error(`${scenario.id} baseline start failed.\n--- stdout ---\n${baselineStart.stdoutText}\n--- stderr ---\n${baselineStart.stderrText}`);
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
    "-NoDesktopShortcut",
    "-Version", scenario.version,
  ];
  if (scenario.skipInstallBuild) {
    failureArgs.splice(failureArgs.length - 2, 0, "-SkipInstallBuild");
  }
  if (!scenario.useSetup) {
    failureArgs.splice(failureArgs.length - 2, 0, "-NoSetup");
  }

  const failedInstall = await runCommandToCompletion({
    command: "powershell.exe",
    args: failureArgs,
    cwd: workspaceRoot,
    env: sanitizeEnv(typeof scenario.getFailureEnv === "function"
      ? scenario.getFailureEnv({ installRoot, stateDir, brokenSourceDir, scenarioCacheRoot, port, relayPort })
      : { CI: "true" }),
    stdoutPath: path.join(smokeRoot, `${scenario.id}-install-fail.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-install-fail.stderr.log`),
    timeoutMs: 10 * 60 * 1000,
  });
  if (failedInstall.exitCode === 0) {
    throw new Error(`${scenario.id} expected install.ps1 to fail, but it exited 0.`);
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
    stdoutPath: path.join(smokeRoot, `${scenario.id}-start-rollback.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-start-rollback.stderr.log`),
  });

  const doctor = await runCommandToCompletion({
    command: "cmd.exe",
    args: ["/c", path.join(installRoot, "bdd.cmd"), "doctor", "--json", "--state-dir", stateDir],
    cwd: installRoot,
    env: sanitizeEnv({ CI: "true" }),
    stdoutPath: path.join(smokeRoot, `${scenario.id}-doctor.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-doctor.stderr.log`),
    timeoutMs: 3 * 60 * 1000,
  });
  if (doctor.exitCode !== 0) {
    throw new Error(`${scenario.id} doctor failed after rollback.\n--- stdout ---\n${doctor.stdoutText}\n--- stderr ---\n${doctor.stderrText}`);
  }

  const doctorJson = parseJsonOrThrow(doctor.stdoutText, `${scenario.id} doctor`);
  const checks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = checks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = checks.find((item) => item?.name === ".env.local");
  const installInfo = parseJsonOrThrow(fs.readFileSync(installInfoPath, "utf-8"), `${scenario.id} install-info`);
  const currentStat = fs.lstatSync(currentRoot);
  const envLocalText = fs.readFileSync(envLocalPath, "utf-8");
  const stateMarkerText = fs.readFileSync(stateMarkerPath, "utf-8");
  const backupEntries = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).filter((name) => name.startsWith("current-")) : [];
  const failureCombined = `${failedInstall.stdoutText}\n${failedInstall.stderrText}`;

  const failureMatches = scenario.expectedFailureTexts.every((text) => failureCombined.includes(text));
  const ok = failureMatches
    && rollbackStart.healthy
    && currentStat.isSymbolicLink()
    && installInfo.tag === "v1.0.0-smoke"
    && installInfo.version === "v1.0.0-smoke"
    && environmentCheck?.message === installRoot
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === envLocalPath
    && envLocalText.includes(envMarkerLine)
    && stateMarkerText.includes(`${scenario.id}-state`)
    && backupEntries.length === 0;

  return {
    id: scenario.id,
    expectedFailureTexts: scenario.expectedFailureTexts,
    skipInstallBuild: scenario.skipInstallBuild,
    useSetup: scenario.useSetup,
    currentIsSymlink: currentStat.isSymbolicLink(),
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
  ensureWindowsHost();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [tmpRoot],
    label: "reset install script rollback real smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [tmpRoot],
    label: "reset install script rollback real report",
  });

  const scenarios = [];
  for (const [index, scenario] of REAL_FAILURE_SCENARIOS.entries()) {
    scenarios.push(await runScenario(scenario, index));
  }

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-script-rollback-real",
    generatedAt: new Date().toISOString(),
    scenarios,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = scenarios.filter((scenario) => !scenario.ok);
  if (failures.length > 0) {
    throw new Error(`Install-script real rollback smoke failed for: ${failures.map((scenario) => scenario.id).join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[install-script-rollback-real-smoke] install.ps1 rollback passed for ${scenarios.length} real failure scenarios.`);
  console.log(JSON.stringify(report, null, 2));
}

main();
