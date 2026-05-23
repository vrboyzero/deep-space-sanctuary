import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { guardedRemovePath, resetSandboxDir } from "./sandbox-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const installPs1Path = path.join(workspaceRoot, "install.ps1");
const tmpRoot = path.join(workspaceRoot, "tmp");
const smokeRoot = path.join(workspaceRoot, "tmp", "install-desktop-shortcut-smoke");
const reportPath = path.join(workspaceRoot, "tmp", "install-desktop-shortcut-smoke-report.json");

function ensureWindowsHost() {
  if (process.platform !== "win32") {
    throw new Error("smoke-install-desktop-shortcut currently runs on Windows only.");
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

  guardedRemovePath(stdoutPath, { allowedRoots: [smokeRoot], label: "reset desktop shortcut stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [smokeRoot], label: "reset desktop shortcut stderr log" });

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
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
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

function parseJsonOrThrow(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON.\n--- stdout ---\n${text}\n--- parse ---\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function getDesktopDir() {
  const candidates = [
    path.join(os.homedir(), "Desktop"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Desktop directory was not found for the current Windows user.");
}

async function main() {
  ensureWindowsHost();
  resetSandboxDir(smokeRoot, {
    allowedRoots: [tmpRoot],
    label: "reset desktop shortcut smoke root",
  });
  guardedRemovePath(reportPath, {
    allowedRoots: [tmpRoot],
    label: "reset desktop shortcut report",
  });

  const desktopDir = getDesktopDir();
  const shortcutPath = path.join(desktopDir, "Star Sanctuary.lnk");
  const backupShortcutPath = path.join(smokeRoot, "Star Sanctuary.original.lnk");
  const installRoot = path.join(smokeRoot, "windows-install-root");
  const expectedTargetPath = path.join(installRoot, "start.bat");
  const expectedIconPath = path.join(installRoot, "current", "apps", "web", "public", "logo06-256.ico");

  const hadExistingShortcut = fs.existsSync(shortcutPath);
  if (hadExistingShortcut) {
    fs.copyFileSync(shortcutPath, backupShortcutPath);
    guardedRemovePath(shortcutPath, {
      allowedRoots: [desktopDir],
      label: "remove existing desktop shortcut",
    });
  }

  try {
    const install = await runCommandToCompletion({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", installPs1Path,
        "-InstallDir", installRoot,
        "-SourceDir", workspaceRoot,
        "-SkipInstallBuild",
        "-NoSetup",
        "-Version", "v3.0.0-shortcut-smoke",
      ],
      cwd: workspaceRoot,
      env: sanitizeEnv({ CI: "true" }),
      stdoutPath: path.join(smokeRoot, "install.stdout.log"),
      stderrPath: path.join(smokeRoot, "install.stderr.log"),
      timeoutMs: 10 * 60 * 1000,
    });

    if (install.exitCode !== 0) {
      const reason = install.timedOut ? "timed out" : "failed";
      throw new Error(`install.ps1 ${reason} for desktop shortcut smoke.\n--- stdout ---\n${install.stdoutText}\n--- stderr ---\n${install.stderrText}`);
    }

    if (!fs.existsSync(shortcutPath)) {
      throw new Error(`Expected desktop shortcut at ${shortcutPath}, but it was not created.`);
    }

    const inspect = await runCommandToCompletion({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        [
          `$shell = New-Object -ComObject WScript.Shell`,
          `$shortcut = $shell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
          `[pscustomobject]@{`,
          `  TargetPath = $shortcut.TargetPath`,
          `  WorkingDirectory = $shortcut.WorkingDirectory`,
          `  IconLocation = $shortcut.IconLocation`,
          `} | ConvertTo-Json -Compress`,
        ].join("\n"),
      ],
      cwd: workspaceRoot,
      env: sanitizeEnv({ CI: "true" }),
      stdoutPath: path.join(smokeRoot, "inspect.stdout.log"),
      stderrPath: path.join(smokeRoot, "inspect.stderr.log"),
      timeoutMs: 60 * 1000,
    });

    if (inspect.exitCode !== 0) {
      throw new Error(`Failed to inspect desktop shortcut.\n--- stdout ---\n${inspect.stdoutText}\n--- stderr ---\n${inspect.stderrText}`);
    }

    const shortcut = parseJsonOrThrow(inspect.stdoutText, "shortcut inspection");
    const actualTargetPath = String(shortcut.TargetPath ?? "");
    const actualWorkingDirectory = String(shortcut.WorkingDirectory ?? "");
    const actualIconLocation = String(shortcut.IconLocation ?? "");
    const normalizedActualIconPath = actualIconLocation.split(",")[0].trim();

    const ok = fs.existsSync(expectedIconPath)
      && actualTargetPath.toLowerCase() === expectedTargetPath.toLowerCase()
      && actualWorkingDirectory.toLowerCase() === installRoot.toLowerCase()
      && normalizedActualIconPath.toLowerCase() === expectedIconPath.toLowerCase();

    const report = {
      productName: "Star Sanctuary",
      smoke: "install-desktop-shortcut",
      generatedAt: new Date().toISOString(),
      scenario: {
        id: "windows-install-ps1-desktop-shortcut-icon",
        desktopDir,
        shortcutPath,
        hadExistingShortcut,
        installRoot,
        expectedTargetPath,
        expectedIconPath,
        actualTargetPath,
        actualWorkingDirectory,
        actualIconLocation,
        ok,
        installStdoutTail: install.stdoutText.slice(-4000),
        installStderrTail: install.stderrText.slice(-4000),
        inspectStdoutTail: inspect.stdoutText.slice(-4000),
        inspectStderrTail: inspect.stderrText.slice(-4000),
      },
    };

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    if (!ok) {
      throw new Error(`Desktop shortcut smoke failed.\n${JSON.stringify(report, null, 2)}`);
    }

    console.log("[install-desktop-shortcut-smoke] desktop shortcut icon passed.");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (fs.existsSync(shortcutPath)) {
      guardedRemovePath(shortcutPath, {
        allowedRoots: [desktopDir],
        label: "cleanup desktop shortcut smoke artifact",
      });
    }
    if (hadExistingShortcut && fs.existsSync(backupShortcutPath)) {
      fs.copyFileSync(backupShortcutPath, shortcutPath);
    }
  }
}

main();
