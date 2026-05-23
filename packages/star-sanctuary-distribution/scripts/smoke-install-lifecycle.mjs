import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const smokeRoot = path.join(workspaceRoot, "artifacts", "install-lifecycle-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "install-lifecycle-smoke-report.json");
const builtBddEntryPath = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");

const START_BAT_CONTENT = [
  "@echo off",
  "setlocal",
  "set \"INSTALL_ROOT=%~dp0\"",
  "set \"STAR_SANCTUARY_RUNTIME_MODE=source\"",
  "set \"BELLDANDY_RUNTIME_MODE=source\"",
  "set \"STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
  "set \"BELLDANDY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
  "call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" start %*",
  "exit /b %ERRORLEVEL%",
  "",
].join("\r\n");

const BDD_CMD_CONTENT = [
  "@echo off",
  "setlocal",
  "set \"INSTALL_ROOT=%~dp0\"",
  "set \"STAR_SANCTUARY_RUNTIME_MODE=source\"",
  "set \"BELLDANDY_RUNTIME_MODE=source\"",
  "set \"STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
  "set \"BELLDANDY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
  "call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" %*",
  "",
].join("\r\n");

const START_SH_CONTENT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
  "export STAR_SANCTUARY_RUNTIME_MODE=\"source\"",
  "export BELLDANDY_RUNTIME_MODE=\"source\"",
  "export STAR_SANCTUARY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
  "export BELLDANDY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
  "exec node \"${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js\" start \"$@\"",
  "",
].join("\n");

const BDD_SH_CONTENT = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
  "export STAR_SANCTUARY_RUNTIME_MODE=\"source\"",
  "export BELLDANDY_RUNTIME_MODE=\"source\"",
  "export STAR_SANCTUARY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
  "export BELLDANDY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
  "exec node \"${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js\" \"$@\"",
  "",
].join("\n");

const SCENARIOS = [
  {
    id: "windows-lifecycle",
    cliWrapper: "bdd.cmd",
    startWrapper: "start.bat",
    cliExpectedSnippets: [
      "set \"STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
      "call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" %*",
    ],
    startExpectedSnippets: [
      "set \"STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
      "call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" start %*",
    ],
  },
  {
    id: "unix-lifecycle",
    cliWrapper: "bdd",
    startWrapper: "start.sh",
    cliExpectedSnippets: [
      "export STAR_SANCTUARY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
      "exec node \"${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js\" \"$@\"",
    ],
    startExpectedSnippets: [
      "export STAR_SANCTUARY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
      "exec node \"${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js\" start \"$@\"",
    ],
  },
];

const SCRUBBED_ENV_KEYS = [
  "BELLDANDY_AGENT_PROVIDER",
  "BELLDANDY_OPENAI_BASE_URL",
  "BELLDANDY_OPENAI_API_KEY",
  "BELLDANDY_OPENAI_MODEL",
  "BELLDANDY_HOST",
  "BELLDANDY_PORT",
  "BELLDANDY_RELAY_PORT",
  "BELLDANDY_AUTH_MODE",
  "BELLDANDY_AUTH_TOKEN",
  "BELLDANDY_AUTH_PASSWORD",
  "STAR_SANCTUARY_RUNTIME_DIR",
  "BELLDANDY_RUNTIME_DIR",
  "STAR_SANCTUARY_RUNTIME_MODE",
  "BELLDANDY_RUNTIME_MODE",
];

function ensureBuildExists() {
  if (!fs.existsSync(builtBddEntryPath)) {
    throw new Error(`Built CLI entry is missing at ${builtBddEntryPath}. Run 'corepack pnpm build' first.`);
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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function canUseBash() {
  if (process.platform === "win32") {
    return false;
  }

  const result = spawnSync("bash", ["-lc", "exit 0"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

function sanitizeEnv() {
  const env = { ...process.env };
  for (const key of SCRUBBED_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

function buildWrapperEnv(installRoot, extraEnv = {}) {
  return {
    ...sanitizeEnv(),
    ...extraEnv,
    STAR_SANCTUARY_RUNTIME_MODE: "source",
    BELLDANDY_RUNTIME_MODE: "source",
    STAR_SANCTUARY_RUNTIME_DIR: path.join(installRoot, "current"),
    BELLDANDY_RUNTIME_DIR: path.join(installRoot, "current"),
  };
}

function writeInstallFixture(installRoot, options = {}) {
  const {
    reset = true,
    tag = "smoke",
    version = "smoke",
  } = options;

  if (reset) {
    resetSandboxDir(installRoot, {
      allowedRoots: [smokeRoot],
      label: "reset install lifecycle fixture root",
    });
  } else {
    fs.mkdirSync(installRoot, { recursive: true });
    guardedRemovePath(path.join(installRoot, "current"), {
      allowedRoots: [installRoot],
      label: "remove install lifecycle fixture current",
    });
    guardedRemovePath(path.join(installRoot, "start.bat"), {
      allowedRoots: [installRoot],
      label: "remove install lifecycle fixture start.bat",
    });
    guardedRemovePath(path.join(installRoot, "bdd.cmd"), {
      allowedRoots: [installRoot],
      label: "remove install lifecycle fixture bdd.cmd",
    });
    guardedRemovePath(path.join(installRoot, "start.sh"), {
      allowedRoots: [installRoot],
      label: "remove install lifecycle fixture start.sh",
    });
    guardedRemovePath(path.join(installRoot, "bdd"), {
      allowedRoots: [installRoot],
      label: "remove install lifecycle fixture bdd",
    });
    guardedRemovePath(path.join(installRoot, "install-info.json"), {
      allowedRoots: [installRoot],
      label: "remove install lifecycle fixture install-info",
    });
  }

  fs.symlinkSync(workspaceRoot, path.join(installRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  writeFile(path.join(installRoot, "start.bat"), START_BAT_CONTENT);
  writeFile(path.join(installRoot, "bdd.cmd"), BDD_CMD_CONTENT);
  writeFile(path.join(installRoot, "start.sh"), START_SH_CONTENT);
  writeFile(path.join(installRoot, "bdd"), BDD_SH_CONTENT);
  fs.chmodSync(path.join(installRoot, "start.sh"), 0o755);
  fs.chmodSync(path.join(installRoot, "bdd"), 0o755);
  writeFile(
    path.join(installRoot, "install-info.json"),
    `${JSON.stringify({
      productName: "Star Sanctuary",
      tag,
      version,
      currentDir: "current",
      entrypoints: {
        startBat: "start.bat",
        startSh: "start.sh",
        startPs1: "start.ps1",
        bddCmd: "bdd.cmd",
        bdd: "bdd",
      },
    }, null, 2)}\n`,
  );
}

function validateWrapperContract(wrapperPath, expectedSnippets) {
  const content = fs.readFileSync(wrapperPath, "utf-8");
  const missing = expectedSnippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    throw new Error(`${path.basename(wrapperPath)} is missing expected wrapper contract snippets:\n${missing.join("\n")}`);
  }
}

function spawnNativeWindowsWrapper(wrapperPath, args, env, stdout, stderr) {
  return spawn(wrapperPath, args, {
    cwd: path.dirname(wrapperPath),
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
    shell: "cmd.exe",
  });
}

function spawnNativeUnixWrapper(wrapperPath, args, env, stdout, stderr) {
  return spawn("bash", [`./${path.basename(wrapperPath)}`, ...args], {
    cwd: path.dirname(wrapperPath),
    env,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
}

function spawnSemanticCli(installRoot, args, env, stdout, stderr) {
  return spawn(process.execPath, [path.join(installRoot, "current", "packages", "belldandy-core", "dist", "bin", "bdd.js"), ...args], {
    cwd: installRoot,
    env: buildWrapperEnv(installRoot, env),
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
}

async function terminateChild(child) {
  if (child.exitCode != null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    await wait(1000);
    return;
  }

  child.kill("SIGTERM");
  await wait(1000);
  if (child.exitCode == null) {
    child.kill("SIGKILL");
  }
}

async function runCommandToCompletion(params) {
  const {
    installRoot,
    wrapperPath,
    args,
    env,
    stdoutPath,
    stderrPath,
    preferNativeWindows,
    preferNativeUnix,
  } = params;

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install lifecycle stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install lifecycle stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  let launchMode = "semantic";
  let child;
  if (preferNativeWindows && process.platform === "win32") {
    launchMode = "native-cmd";
    child = spawnNativeWindowsWrapper(wrapperPath, args, buildWrapperEnv(installRoot, env), stdout, stderr);
  } else if (preferNativeUnix && canUseBash()) {
    launchMode = "native-bash";
    child = spawnNativeUnixWrapper(wrapperPath, args, buildWrapperEnv(installRoot, env), stdout, stderr);
  } else {
    child = spawnSemanticCli(installRoot, args, env, stdout, stderr);
  }

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });

  fs.closeSync(stdout);
  fs.closeSync(stderr);

  const stdoutText = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
  const stderrText = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";

  return {
    launchMode,
    exitCode,
    stdoutText,
    stderrText,
  };
}

async function runStartUntilHealthy(params) {
  const {
    installRoot,
    wrapperPath,
    env,
    port,
    stdoutPath,
    stderrPath,
    preferNativeWindows,
    preferNativeUnix,
  } = params;

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install lifecycle start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install lifecycle start stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  let launchMode = "semantic";
  let child;
  if (preferNativeWindows && process.platform === "win32") {
    launchMode = "native-cmd";
    child = spawnNativeWindowsWrapper(wrapperPath, [], buildWrapperEnv(installRoot, env), stdout, stderr);
  } else if (preferNativeUnix && canUseBash()) {
    launchMode = "native-bash";
    child = spawnNativeUnixWrapper(wrapperPath, [], buildWrapperEnv(installRoot, env), stdout, stderr);
  } else {
    child = spawnSemanticCli(installRoot, ["start"], env, stdout, stderr);
  }

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

  const stdoutText = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
  const stderrText = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";

  return {
    launchMode,
    healthy,
    stdoutText,
    stderrText,
  };
}

function parseJsonOrThrow(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON.\n--- stdout ---\n${text}\n--- stderr/parse ---\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runDoctorSnapshot(params) {
  const {
    installRoot,
    wrapperPath,
    stateDir,
    logPrefix,
    preferNativeWindows,
    preferNativeUnix,
  } = params;

  const result = await runCommandToCompletion({
    installRoot,
    wrapperPath,
    args: ["doctor", "--json", "--state-dir", stateDir],
    env: {
      CI: "true",
    },
    stdoutPath: path.join(smokeRoot, `${logPrefix}-doctor.stdout.log`),
    stderrPath: path.join(smokeRoot, `${logPrefix}-doctor.stderr.log`),
    preferNativeWindows,
    preferNativeUnix,
  });

  if (result.exitCode !== 0) {
    throw new Error(`${logPrefix} doctor failed.\n--- stdout ---\n${result.stdoutText}\n--- stderr ---\n${result.stderrText}`);
  }

  const doctorJson = parseJsonOrThrow(result.stdoutText, `${logPrefix} doctor`);
  const checks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = checks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = checks.find((item) => item?.name === ".env.local");

  return {
    launchMode: result.launchMode,
    environmentDir: environmentCheck?.message ?? null,
    envLocalPath: envLocalCheck?.message ?? null,
    envLocalStatus: envLocalCheck?.status ?? null,
    stdoutText: result.stdoutText,
    stderrText: result.stderrText,
  };
}

async function runLifecycleStep(params) {
  const {
    id,
    installRoot,
    startWrapperPath,
    stateDir,
    port,
    relayPort,
    preferNativeWindows,
    preferNativeUnix,
  } = params;

  const startResult = await runStartUntilHealthy({
    installRoot,
    wrapperPath: startWrapperPath,
    env: {
      BELLDANDY_STATE_DIR: stateDir,
      BELLDANDY_RELAY_PORT: String(relayPort),
      AUTO_OPEN_BROWSER: "false",
      CI: "true",
    },
    port,
    stdoutPath: path.join(smokeRoot, `${id}-start.stdout.log`),
    stderrPath: path.join(smokeRoot, `${id}-start.stderr.log`),
    preferNativeWindows,
    preferNativeUnix,
  });

  const doctorSnapshot = await runDoctorSnapshot({
    installRoot,
    wrapperPath: path.join(installRoot, path.basename(startWrapperPath).endsWith(".bat") ? "bdd.cmd" : "bdd"),
    stateDir,
    logPrefix: id,
    preferNativeWindows,
    preferNativeUnix,
  });

  return {
    startLaunchMode: startResult.launchMode,
    doctorLaunchMode: doctorSnapshot.launchMode,
    healthy: startResult.healthy,
    doctorEnvironmentDir: doctorSnapshot.environmentDir,
    doctorEnvLocalPath: doctorSnapshot.envLocalPath,
    doctorEnvLocalStatus: doctorSnapshot.envLocalStatus,
    startStdoutTail: startResult.stdoutText.slice(-4000),
    startStderrTail: startResult.stderrText.slice(-4000),
    doctorStdoutTail: doctorSnapshot.stdoutText.slice(-4000),
    doctorStderrTail: doctorSnapshot.stderrText.slice(-4000),
  };
}

async function runScenario(scenario, index) {
  const installRoot = path.join(smokeRoot, scenario.id);
  const stateDir = path.join(smokeRoot, `${scenario.id}-state`);
  const port = 29189 + (index * 4);
  const relayPort = port + 1;
  const envLocalPath = path.join(stateDir, ".env.local");
  const envPath = path.join(stateDir, ".env");
  const stateMarkerPath = path.join(stateDir, "workspace", "install-lifecycle-marker.txt");
  const stateMarkerText = `${scenario.id}-state-preserved`;
  const envMarkerLine = `INSTALL_LIFECYCLE_MARKER=${scenario.id}`;
  const cliWrapperPath = path.join(installRoot, scenario.cliWrapper);
  const startWrapperPath = path.join(installRoot, scenario.startWrapper);
  const preferNativeWindows = scenario.cliWrapper.endsWith(".cmd");
  const preferNativeUnix = scenario.cliWrapper === "bdd";

  writeInstallFixture(installRoot, { reset: true, tag: "smoke-initial", version: "1.0.0-smoke" });
  guardedRemovePath(stateDir, {
    allowedRoots: [smokeRoot],
    label: "reset install lifecycle state dir",
  });
  validateWrapperContract(cliWrapperPath, scenario.cliExpectedSnippets);
  validateWrapperContract(startWrapperPath, scenario.startExpectedSnippets);

  const setupResult = await runCommandToCompletion({
    installRoot,
    wrapperPath: cliWrapperPath,
    args: [
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
    env: {
      CI: "true",
    },
    stdoutPath: path.join(smokeRoot, `${scenario.id}-setup.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-setup.stderr.log`),
    preferNativeWindows,
    preferNativeUnix,
  });
  if (setupResult.exitCode !== 0) {
    throw new Error(`${scenario.id} setup failed.\n--- stdout ---\n${setupResult.stdoutText}\n--- stderr ---\n${setupResult.stderrText}`);
  }

  const setupJson = parseJsonOrThrow(setupResult.stdoutText, `${scenario.id} setup`);
  if (!fs.existsSync(envLocalPath)) {
    throw new Error(`${scenario.id} did not create ${envLocalPath}`);
  }

  fs.appendFileSync(envLocalPath, `${envMarkerLine}\n`, "utf-8");
  fs.mkdirSync(path.dirname(stateMarkerPath), { recursive: true });
  fs.writeFileSync(stateMarkerPath, `${stateMarkerText}\n`, "utf-8");

  const initialStep = await runLifecycleStep({
    id: `${scenario.id}-initial`,
    installRoot,
    startWrapperPath,
    stateDir,
    port,
    relayPort,
    preferNativeWindows,
    preferNativeUnix,
  });

  const preservedEnvBeforeRefresh = fs.readFileSync(envLocalPath, "utf-8");
  const envExistsBeforeRefresh = fs.existsSync(envPath);

  writeInstallFixture(installRoot, { reset: false, tag: "smoke-reinstall", version: "1.0.1-smoke" });
  validateWrapperContract(cliWrapperPath, scenario.cliExpectedSnippets);
  validateWrapperContract(startWrapperPath, scenario.startExpectedSnippets);
  const reinstallStep = await runLifecycleStep({
    id: `${scenario.id}-reinstall`,
    installRoot,
    startWrapperPath,
    stateDir,
    port,
    relayPort,
    preferNativeWindows,
    preferNativeUnix,
  });

  const preservedEnvAfterReinstall = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";
  const stateMarkerAfterReinstall = fs.existsSync(stateMarkerPath) ? fs.readFileSync(stateMarkerPath, "utf-8") : "";

  writeInstallFixture(installRoot, { reset: false, tag: "smoke-upgrade", version: "2.0.0-smoke" });
  validateWrapperContract(cliWrapperPath, scenario.cliExpectedSnippets);
  validateWrapperContract(startWrapperPath, scenario.startExpectedSnippets);
  const upgradeStep = await runLifecycleStep({
    id: `${scenario.id}-upgrade`,
    installRoot,
    startWrapperPath,
    stateDir,
    port,
    relayPort,
    preferNativeWindows,
    preferNativeUnix,
  });

  const installInfo = parseJsonOrThrow(fs.readFileSync(path.join(installRoot, "install-info.json"), "utf-8"), `${scenario.id} install-info`);
  const finalEnvText = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";
  const finalStateMarkerText = fs.existsSync(stateMarkerPath) ? fs.readFileSync(stateMarkerPath, "utf-8") : "";

  const initialOk = setupJson?.path === envLocalPath
    && initialStep.healthy
    && initialStep.doctorEnvironmentDir === stateDir
    && initialStep.doctorEnvLocalPath === envLocalPath
    && initialStep.doctorEnvLocalStatus === "pass"
    && envExistsBeforeRefresh;
  const reinstallOk = reinstallStep.healthy
    && reinstallStep.doctorEnvironmentDir === stateDir
    && reinstallStep.doctorEnvLocalPath === envLocalPath
    && reinstallStep.doctorEnvLocalStatus === "pass"
    && preservedEnvAfterReinstall === preservedEnvBeforeRefresh
    && stateMarkerAfterReinstall.trim() === stateMarkerText
    && fs.existsSync(envPath);
  const upgradeOk = upgradeStep.healthy
    && upgradeStep.doctorEnvironmentDir === stateDir
    && upgradeStep.doctorEnvLocalPath === envLocalPath
    && upgradeStep.doctorEnvLocalStatus === "pass"
    && installInfo?.tag === "smoke-upgrade"
    && installInfo?.version === "2.0.0-smoke"
    && finalEnvText === preservedEnvBeforeRefresh
    && finalStateMarkerText.trim() === stateMarkerText
    && fs.existsSync(envPath);

  return {
    id: scenario.id,
    setupWrapper: scenario.cliWrapper,
    startWrapper: scenario.startWrapper,
    envPath,
    envExistsBeforeRefresh,
    envLocalPath,
    stateDir,
    stateMarkerPath,
    setupLaunchMode: setupResult.launchMode,
    setupConfigPath: setupJson?.path ?? null,
    initialStart: {
      ok: initialOk,
      ...initialStep,
    },
    reinstallRestart: {
      ok: reinstallOk,
      ...reinstallStep,
    },
    upgradeRestart: {
      ok: upgradeOk,
      ...upgradeStep,
      installInfo,
    },
    preservedEnvMarker: finalEnvText.includes(envMarkerLine),
    preservedStateMarker: finalStateMarkerText.trim() === stateMarkerText,
    ok: initialOk && reinstallOk && upgradeOk,
    setupStdoutTail: setupResult.stdoutText.slice(-4000),
    setupStderrTail: setupResult.stderrText.slice(-4000),
  };
}

async function main() {
  ensureBuildExists();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset install lifecycle smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset install lifecycle report",
  });

  const scenarios = [];
  for (const [index, scenario] of SCENARIOS.entries()) {
    scenarios.push(await runScenario(scenario, index));
  }

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-lifecycle",
    generatedAt: new Date().toISOString(),
    scenarios,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = scenarios.filter((scenario) => !scenario.ok);
  if (failures.length > 0) {
    throw new Error(`Install-lifecycle smoke failed for: ${failures.map((scenario) => scenario.id).join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[install-lifecycle-smoke] Reinstall/upgrade restart lifecycle passed for ${scenarios.length} install-state scenarios.`);
  console.log(JSON.stringify(report, null, 2));
}

main();
