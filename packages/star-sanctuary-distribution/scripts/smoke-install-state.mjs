import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const installSmokeRoot = path.join(workspaceRoot, "artifacts", "install-state-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "install-state-smoke-report.json");
const bddEntryPath = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");

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
    id: "start-bat",
    fileName: "start.bat",
    args: [],
    expectedSnippets: [
      "set \"STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
      "call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" start %*",
    ],
  },
  {
    id: "bdd-cmd-start",
    fileName: "bdd.cmd",
    args: ["start"],
    expectedSnippets: [
      "set \"STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current\"",
      "call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" %*",
    ],
  },
  {
    id: "start-sh",
    fileName: "start.sh",
    args: [],
    expectedSnippets: [
      "export STAR_SANCTUARY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
      "exec node \"${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js\" start \"$@\"",
    ],
  },
  {
    id: "bdd-start",
    fileName: "bdd",
    args: ["start"],
    expectedSnippets: [
      "export STAR_SANCTUARY_RUNTIME_DIR=\"${SCRIPT_DIR}/current\"",
      "exec node \"${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js\" \"$@\"",
    ],
  },
];

function ensureBuildExists() {
  if (!fs.existsSync(bddEntryPath)) {
    throw new Error(`Built CLI entry is missing at ${bddEntryPath}. Run 'corepack pnpm build' first.`);
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
    windowsHide: true,
    stdio: "ignore",
  });
  return result.status === 0;
}

function writeInstallFixture(installRoot) {
  resetSandboxDir(installRoot, {
    allowedRoots: [installSmokeRoot],
    label: "reset install state fixture root",
  });

  const currentPath = path.join(installRoot, "current");
  fs.symlinkSync(workspaceRoot, currentPath, process.platform === "win32" ? "junction" : "dir");

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

function buildSemanticEnv(installRoot, env) {
  return {
    ...env,
    STAR_SANCTUARY_RUNTIME_MODE: "source",
    BELLDANDY_RUNTIME_MODE: "source",
    STAR_SANCTUARY_RUNTIME_DIR: path.join(installRoot, "current"),
    BELLDANDY_RUNTIME_DIR: path.join(installRoot, "current"),
  };
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

function spawnSemanticWrapper(installRoot, args, env, stdout, stderr) {
  return spawn(process.execPath, [path.join(installRoot, "current", "packages", "belldandy-core", "dist", "bin", "bdd.js"), ...args], {
    cwd: installRoot,
    env: buildSemanticEnv(installRoot, env),
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

async function runScenario(scenario, index, useNativeBash) {
  const installRoot = path.join(installSmokeRoot, scenario.id);
  const stateDir = path.join(installSmokeRoot, `${scenario.id}-state`);
  const stdoutPath = path.join(installSmokeRoot, `${scenario.id}.stdout.log`);
  const stderrPath = path.join(installSmokeRoot, `${scenario.id}.stderr.log`);
  const port = 28989 + (index * 2);
  const relayPort = port + 1;

  writeInstallFixture(installRoot);
  guardedRemovePath(stateDir, {
    allowedRoots: [installSmokeRoot],
    label: "reset install state scenario state dir",
  });
  guardedRemovePath(stdoutPath, {
    allowedRoots: [installSmokeRoot],
    label: "reset install state stdout log",
  });
  guardedRemovePath(stderrPath, {
    allowedRoots: [installSmokeRoot],
    label: "reset install state stderr log",
  });

  const wrapperPath = path.join(installRoot, scenario.fileName);
  validateWrapperContract(wrapperPath, scenario.expectedSnippets);

  const env = {
    ...process.env,
    BELLDANDY_PORT: String(port),
    BELLDANDY_RELAY_PORT: String(relayPort),
    BELLDANDY_STATE_DIR: stateDir,
    AUTO_OPEN_BROWSER: "false",
    CI: "true",
  };

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  let launchMode = "semantic";
  let child;
  if ((scenario.fileName === "start.bat" || scenario.fileName === "bdd.cmd") && process.platform === "win32") {
    launchMode = "native-cmd";
    child = spawnNativeWindowsWrapper(wrapperPath, scenario.args, env, stdout, stderr);
  } else if ((scenario.fileName === "start.sh" || scenario.fileName === "bdd") && useNativeBash) {
    launchMode = "native-bash";
    child = spawnNativeUnixWrapper(wrapperPath, scenario.args, env, stdout, stderr);
  } else {
    child = spawnSemanticWrapper(installRoot, ["start"], env, stdout, stderr);
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
  const generatedEnvPath = path.join(stateDir, ".env");
  const installInfoPath = path.join(installRoot, "install-info.json");
  const passed = healthy && fs.existsSync(generatedEnvPath) && fs.existsSync(installInfoPath);

  return {
    id: scenario.id,
    wrapper: scenario.fileName,
    launchMode,
    port,
    relayPort,
    healthy,
    generatedEnvPath,
    generatedEnvExists: fs.existsSync(generatedEnvPath),
    installInfoPath,
    installInfoExists: fs.existsSync(installInfoPath),
    ok: passed,
    stdoutPath,
    stderrPath,
    stdoutTail: stdoutText.slice(-4000),
    stderrTail: stderrText.slice(-4000),
  };
}

async function main() {
  ensureBuildExists();
  resetSandboxDir(installSmokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset install state smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset install state report",
  });

  const useNativeBash = canUseBash();
  const scenarios = [];
  for (const [index, scenario] of SCENARIOS.entries()) {
    scenarios.push(await runScenario(scenario, index, useNativeBash));
  }

  const report = {
    productName: "Star Sanctuary",
    smoke: "install-state",
    generatedAt: new Date().toISOString(),
    nativeUnixWrapperAvailable: useNativeBash,
    scenarios,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = scenarios.filter((scenario) => !scenario.ok);
  if (failures.length > 0) {
    throw new Error(`Install-state smoke failed for: ${failures.map((scenario) => scenario.id).join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[install-state-smoke] Install-state wrapper smoke passed for ${scenarios.length} entrypoints.`);
  console.log(JSON.stringify(report, null, 2));
}

main();
