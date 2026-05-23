import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const smokeRoot = path.join(workspaceRoot, "artifacts", "install-journey-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "install-journey-smoke-report.json");
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
    id: "windows-journey",
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
    id: "unix-journey",
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

function writeInstallFixture(installRoot) {
  resetSandboxDir(installRoot, {
    allowedRoots: [smokeRoot],
    label: "reset install journey fixture root",
  });

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
      tag: "smoke",
      version: "smoke",
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

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install journey stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install journey stderr log" });

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

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset install journey start stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset install journey start stderr log" });

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

async function runScenario(scenario, index) {
  const installRoot = path.join(smokeRoot, scenario.id);
  const stateDir = path.join(smokeRoot, `${scenario.id}-state`);
  const port = 29089 + (index * 2);
  const relayPort = port + 1;
  const envLocalPath = path.join(stateDir, ".env.local");
  const cliWrapperPath = path.join(installRoot, scenario.cliWrapper);
  const startWrapperPath = path.join(installRoot, scenario.startWrapper);

  writeInstallFixture(installRoot);
  guardedRemovePath(stateDir, {
    allowedRoots: [smokeRoot],
    label: "reset install journey state dir",
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
    preferNativeWindows: scenario.cliWrapper.endsWith(".cmd"),
    preferNativeUnix: scenario.cliWrapper === "bdd",
  });
  if (setupResult.exitCode !== 0) {
    throw new Error(`${scenario.id} setup failed.\n--- stdout ---\n${setupResult.stdoutText}\n--- stderr ---\n${setupResult.stderrText}`);
  }

  const setupJson = parseJsonOrThrow(setupResult.stdoutText, `${scenario.id} setup`);
  const envLocalExists = fs.existsSync(envLocalPath);
  const envLocalText = envLocalExists ? fs.readFileSync(envLocalPath, "utf-8") : "";

  const doctorResult = await runCommandToCompletion({
    installRoot,
    wrapperPath: cliWrapperPath,
    args: [
      "doctor",
      "--json",
      "--state-dir", stateDir,
    ],
    env: {
      CI: "true",
    },
    stdoutPath: path.join(smokeRoot, `${scenario.id}-doctor.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-doctor.stderr.log`),
    preferNativeWindows: scenario.cliWrapper.endsWith(".cmd"),
    preferNativeUnix: scenario.cliWrapper === "bdd",
  });
  if (doctorResult.exitCode !== 0) {
    throw new Error(`${scenario.id} doctor failed.\n--- stdout ---\n${doctorResult.stdoutText}\n--- stderr ---\n${doctorResult.stderrText}`);
  }

  const doctorJson = parseJsonOrThrow(doctorResult.stdoutText, `${scenario.id} doctor`);
  const doctorChecks = Array.isArray(doctorJson.checks) ? doctorJson.checks : [];
  const environmentCheck = doctorChecks.find((item) => item?.name === "Environment directory");
  const envLocalCheck = doctorChecks.find((item) => item?.name === ".env.local");

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
    stdoutPath: path.join(smokeRoot, `${scenario.id}-start.stdout.log`),
    stderrPath: path.join(smokeRoot, `${scenario.id}-start.stderr.log`),
    preferNativeWindows: scenario.startWrapper.endsWith(".bat"),
    preferNativeUnix: scenario.startWrapper === "start.sh",
  });

  const ok = setupJson?.path === envLocalPath
    && envLocalExists
    && envLocalText.includes("BELLDANDY_AGENT_PROVIDER")
    && envLocalText.includes("BELLDANDY_AUTH_MODE")
    && environmentCheck?.message === stateDir
    && envLocalCheck?.status === "pass"
    && envLocalCheck?.message === envLocalPath
    && startResult.healthy;

  return {
    id: scenario.id,
    setupWrapper: scenario.cliWrapper,
    startWrapper: scenario.startWrapper,
    setupLaunchMode: setupResult.launchMode,
    startLaunchMode: startResult.launchMode,
    port,
    relayPort,
    envLocalPath,
    envLocalExists,
    doctorEnvironmentDir: environmentCheck?.message ?? null,
    doctorEnvLocal: envLocalCheck?.message ?? null,
    doctorEnvLocalStatus: envLocalCheck?.status ?? null,
    setupConfigPath: setupJson?.path ?? null,
    setupFlow: setupJson?.flow ?? null,
    setupScenario: setupJson?.scenario ?? null,
    healthy: startResult.healthy,
    ok,
    setupStdoutTail: setupResult.stdoutText.slice(-4000),
    setupStderrTail: setupResult.stderrText.slice(-4000),
    doctorStdoutTail: doctorResult.stdoutText.slice(-4000),
    doctorStderrTail: doctorResult.stderrText.slice(-4000),
    startStdoutTail: startResult.stdoutText.slice(-4000),
    startStderrTail: startResult.stderrText.slice(-4000),
  };
}

async function main() {
  ensureBuildExists();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset install journey smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset install journey report",
  });

  const scenarios = [];
  for (const [index, scenario] of SCENARIOS.entries()) {
    scenarios.push(await runScenario(scenario, index));
  }

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-journey",
    generatedAt: new Date().toISOString(),
    scenarios,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = scenarios.filter((scenario) => !scenario.ok);
  if (failures.length > 0) {
    throw new Error(`Install-journey smoke failed for: ${failures.map((scenario) => scenario.id).join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[install-journey-smoke] Setup -> doctor -> start -> /health passed for ${scenarios.length} install-state scenarios.`);
  console.log(JSON.stringify(report, null, 2));
}

main();
