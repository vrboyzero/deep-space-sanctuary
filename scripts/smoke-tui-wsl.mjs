import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function decodeMaybeUtf16(buffer) {
  if (!buffer || buffer.length === 0) return "";
  for (let index = 1; index < buffer.length; index += 2) {
    if (buffer[index] === 0) return buffer.toString("utf16le");
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
  return distros.find((line) => line.toLowerCase().includes("ubuntu")) ?? distros[0];
}

function toWslPath(windowsPath) {
  const normalized = path.resolve(windowsPath).replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):(.*)$/);
  if (!match) throw new Error(`Cannot convert path to WSL form: ${windowsPath}`);
  return `/mnt/${match[1].toLowerCase()}${match[2]}`;
}

function main() {
  if (process.platform !== "win32") {
    throw new Error("smoke:tui:wsl requires a Windows host with WSL. Use python3 scripts/smoke-tui-pty.py on Unix.");
  }
  const distro = detectWslDistro();
  if (!distro) throw new Error("No usable WSL distro found.");
  const workspaceRootWsl = toWslPath(workspaceRoot);
  const result = spawnSync(
    "wsl.exe",
    [
      "-d",
      distro,
      "--cd",
      workspaceRootWsl,
      "--",
      "python3",
      "scripts/smoke-tui-pty.py",
      "--repo",
      workspaceRootWsl,
    ],
    {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: "inherit",
      timeout: 90_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  console.error(`[tui-wsl-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
