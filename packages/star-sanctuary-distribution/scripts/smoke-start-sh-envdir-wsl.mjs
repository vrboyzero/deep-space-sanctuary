import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { assertPathInsideRoots, guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const smokeRoot = path.join(workspaceRoot, "artifacts", "start-sh-envdir-wsl-smoke");
const reportPath = path.join(workspaceRoot, "artifacts", "start-sh-envdir-wsl-smoke-report.json");

const STAGED_SOURCE_ENTRIES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".npmrc",
  "start.sh",
  "apps",
  "config",
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
    throw new Error("smoke-start-sh-envdir-wsl currently expects Windows host + WSL.");
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

function ensureWslToolchain(distro) {
  const result = spawnSync("wsl.exe", ["-d", distro, "bash", "-lc", "node -v && corepack --version && pnpm -v"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      "WSL toolchain is not ready. Install Node.js 22 + corepack + pnpm inside the distro first.\n"
      + `--- stdout ---\n${decodeMaybeUtf16(result.stdout)}\n`
      + `--- stderr ---\n${decodeMaybeUtf16(result.stderr)}`,
    );
  }
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
    label: "reset start-sh envdir wsl staged source root",
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
    await wait(1500);
  }
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
  } = params;
  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset start-sh envdir wsl stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset start-sh envdir wsl stderr log" });

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
    for (let i = 0; i < 300; i += 1) {
      await wait(2000);
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

async function main() {
  ensureWindowsHost();
  const distro = detectWslDistro();
  ensureWslToolchain(distro);
  removePathWithWslFallback(smokeRoot, {
    allowedRoots: [artifactsRoot],
    label: "reset start-sh envdir wsl smoke root",
    distro,
  });
  fs.mkdirSync(smokeRoot, { recursive: true });
  guardedRemovePath(reportPath, {
    allowedRoots: [artifactsRoot],
    label: "reset start-sh envdir wsl report",
  });

  const sourceRoot = path.join(smokeRoot, "linux-source-stage");
  const envDir = path.join(smokeRoot, "env");
  const stateDir = path.join(smokeRoot, "state");
  const envLocalPath = path.join(envDir, ".env.local");
  const port = 29911;
  const relayPort = 29912;

  createLinuxBuildSource(sourceRoot);
  fs.mkdirSync(envDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    envLocalPath,
    [
      "BELLDANDY_AGENT_PROVIDER=mock",
      "BELLDANDY_AUTH_MODE=none",
      "BELLDANDY_COMMUNITY_API_ENABLED=false",
      `BELLDANDY_PORT=${port}`,
      `BELLDANDY_GATEWAY_PORT=${port}`,
      `BELLDANDY_RELAY_PORT=${relayPort}`,
      "BELLDANDY_MCP_ENABLED=false",
      "AUTO_OPEN_BROWSER=false",
      "",
    ].join("\n"),
    "utf-8",
  );

  const sourceRootWsl = toWslPath(sourceRoot);
  const envDirWsl = toWslPath(envDir);
  const stateDirWsl = toWslPath(stateDir);
  const startScript = [
    `cd ${shellQuote(sourceRootWsl)} &&`,
    "chmod +x ./start.sh &&",
    `STAR_SANCTUARY_ENV_DIR=${shellQuote(envDirWsl)}`,
    `BELLDANDY_ENV_DIR=${shellQuote(envDirWsl)}`,
    `BELLDANDY_STATE_DIR=${shellQuote(stateDirWsl)}`,
    "AUTO_OPEN_BROWSER='false'",
    "CI='true'",
    "bash ./start.sh",
  ].join(" ");

  const start = await runStartUntilHealthy({
    command: "wsl.exe",
    args: ["-d", distro, "bash", "-lc", startScript],
    cwd: workspaceRoot,
    env: sanitizeEnv({ CI: "true" }),
    port,
    stdoutPath: path.join(smokeRoot, "start.stdout.log"),
    stderrPath: path.join(smokeRoot, "start.stderr.log"),
  });

  const portDownAfterStop = !(await checkHealth(port));
  const runningMarker = `Belldandy Gateway running: http://127.0.0.1:${port}`;
  const bddStartMarker = "node --import tsx packages/belldandy-core/src/bin/bdd.ts start";
  const generatedEnvPath = path.join(envDir, ".env");
  const unexpectedStateEnvPath = path.join(stateDir, ".env");
  const envDirWasUsed = fs.existsSync(generatedEnvPath) && !fs.existsSync(unexpectedStateEnvPath);

  const ok = start.healthy
    && portDownAfterStop
    && envDirWasUsed
    && start.stdoutText.includes("[Star Sanctuary Launcher] Starting Gateway...")
    && start.stdoutText.includes(bddStartMarker)
    && start.stdoutText.includes(runningMarker);

  const report = {
    productName: "Star Sanctuary",
    smoke: "start-sh-envdir-wsl",
    generatedAt: new Date().toISOString(),
    scenario: {
      id: "wsl-root-start-sh-envdir",
      distro,
      sourceRoot,
      envDir,
      stateDir,
      port,
      relayPort,
      healthy: start.healthy,
      portDownAfterStop,
      envDirWasUsed,
      generatedEnvPath,
      unexpectedStateEnvPathExists: fs.existsSync(unexpectedStateEnvPath),
      sawLauncherBanner: start.stdoutText.includes("[Star Sanctuary Launcher] Starting Gateway..."),
      sawBddStart: start.stdoutText.includes(bddStartMarker),
      sawCustomPort: start.stdoutText.includes(runningMarker),
      ok,
      startStdoutTail: start.stdoutText.slice(-4000),
      startStderrTail: start.stderrText.slice(-4000),
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  if (!ok) {
    throw new Error(`start.sh ENV_DIR WSL smoke failed.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log("[start-sh-envdir-wsl-smoke] root start.sh + ENV_DIR flow passed.");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[start-sh-envdir-wsl-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
