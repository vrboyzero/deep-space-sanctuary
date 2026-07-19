import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { loadRuntimeEnvFiles, readTrimmedEnv } from "./env.js";

const execFileAsync = promisify(execFile);
const DEFAULT_GATEWAY_PORT = 28889;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const PID_POLL_INTERVAL_MS = 150;

export type GatewayProcessInfo = {
  pid: number;
  commandLine?: string | null;
  name?: string | null;
};

export type GatewayPreflightRunner = {
  inspectProcess(pid: number): Promise<GatewayProcessInfo | null>;
  findPortOwner(port: number): Promise<GatewayProcessInfo | null>;
  forceKill(pid: number): Promise<void>;
  isProcessRunning?(pid: number): boolean;
};

export type GatewayPreflightParams = {
  label: string;
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  ownershipTokens: string[];
  port?: number;
  stopTimeoutMs?: number;
  runner?: GatewayPreflightRunner;
  logger?: Pick<Console, "log" | "warn">;
};

export type GatewayPreflightResult = {
  port: number;
  cleanedPids: number[];
};

type CleanupSource = "daemon_pid" | "foreground_pid" | "port_owner";

function normalizeCommandToken(value: string): string {
  return value.trim().replace(/\//g, "\\").toLowerCase();
}

function uniqueOwnershipTokens(values: string[]): string[] {
  const normalized = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const normalizedValue = normalizeCommandToken(path.resolve(trimmed));
    if (normalized.has(normalizedValue)) continue;
    normalized.add(normalizedValue);
    result.push(normalizedValue);
  }
  return result;
}

function commandLineMatchesOwnership(commandLine: string | null | undefined, ownershipTokens: string[]): boolean {
  if (!commandLine) return false;
  const normalized = normalizeCommandToken(commandLine);
  return ownershipTokens.some((token) => normalized.includes(token));
}

function getDaemonPidFile(stateDir: string): string {
  return path.join(stateDir, "gateway.pid");
}

export function getForegroundPidFile(stateDir: string): string {
  return path.join(stateDir, "gateway-foreground.pid");
}

function readPidFile(filePath: string): number | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(filePath: string, pid: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${pid}\n`, "utf-8");
}

function removePidFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore missing files.
  }
}

export function writeForegroundPid(stateDir: string, pid: number): void {
  writePidFile(getForegroundPidFile(stateDir), pid);
}

export function removeForegroundPid(stateDir: string): void {
  removePidFile(getForegroundPidFile(stateDir));
}

function isProcessRunning(pid: number, runner?: GatewayPreflightRunner | null): boolean {
  if (runner?.isProcessRunning) {
    return runner.isProcessRunning(pid);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number, runner?: GatewayPreflightRunner | null): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid, runner)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, PID_POLL_INTERVAL_MS));
  }
  return !isProcessRunning(pid, runner);
}

export function resolveGatewayPortFromEnv(env: NodeJS.ProcessEnv, explicitPort?: number): number {
  if (Number.isFinite(explicitPort) && explicitPort && explicitPort > 0) {
    return explicitPort;
  }
  const portValue = Number.parseInt(readTrimmedEnv(env, "BELLDANDY_PORT") ?? String(DEFAULT_GATEWAY_PORT), 10);
  return Number.isFinite(portValue) && portValue > 0 ? portValue : DEFAULT_GATEWAY_PORT;
}

function resolveGatewayPort(baseEnv: NodeJS.ProcessEnv, stateDir: string, explicitPort?: number): number {
  return resolveGatewayPortFromEnv(loadRuntimeEnvFiles(baseEnv, stateDir), explicitPort);
}

function stringifyCommandForLog(commandLine: string | null | undefined): string {
  const normalized = commandLine?.trim();
  if (!normalized) return "(command line unavailable)";
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function createPowerShellRunner(): GatewayPreflightRunner {
  const runPowerShellJson = async (script: string): Promise<GatewayProcessInfo | null> => {
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ], {
        windowsHide: true,
      }));
    } catch (error) {
      const execError = error as ExecFileException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      const stderrText = String(execError.stderr ?? "").trim();
      stdout = String(execError.stdout ?? "");
      if (stderrText) {
        throw error;
      }
      if (!stdout.trim()) {
        return null;
      }
    }
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const parsed = JSON.parse(trimmed) as {
      pid?: number;
      commandLine?: string | null;
      name?: string | null;
    };
    if (!parsed?.pid || !Number.isFinite(parsed.pid)) {
      return null;
    }
    return {
      pid: parsed.pid,
      commandLine: parsed.commandLine ?? null,
      name: parsed.name ?? null,
    };
  };

  const buildProcessScript = (pid: number) => `
$proc = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue
if ($proc) {
  [pscustomobject]@{ pid = [int]$proc.ProcessId; commandLine = $proc.CommandLine; name = $proc.Name } | ConvertTo-Json -Compress
}
exit 0
`.trim();

  return {
    async inspectProcess(pid: number) {
      return runPowerShellJson(buildProcessScript(pid));
    },
    async findPortOwner(port: number) {
      const script = `
$conn = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
  if ($proc) {
    [pscustomobject]@{ pid = [int]$proc.ProcessId; commandLine = $proc.CommandLine; name = $proc.Name } | ConvertTo-Json -Compress
  } else {
    [pscustomobject]@{ pid = [int]$conn.OwningProcess } | ConvertTo-Json -Compress
  }
}
exit 0
`.trim();
      return runPowerShellJson(script);
    },
    async forceKill(pid: number) {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
    },
  };
}

async function cleanupProcessByPid(params: {
  pid: number;
  source: CleanupSource;
  ownershipTokens: string[];
  stopTimeoutMs: number;
  runner: GatewayPreflightRunner;
  logger: Pick<Console, "log" | "warn">;
  label: string;
}): Promise<boolean> {
  const { pid, source, ownershipTokens, stopTimeoutMs, runner, logger, label } = params;
  const processInfo = await runner.inspectProcess(pid);
  if (!processInfo) {
    return !isProcessRunning(pid, runner);
  }
  if (!commandLineMatchesOwnership(processInfo.commandLine, ownershipTokens)) {
    logger.warn(
      `[${label}] Gateway preflight ignored ${source} PID ${pid}: command does not match this runtime (${stringifyCommandForLog(processInfo.commandLine)})`,
    );
    return false;
  }
  logger.log(`[${label}] Gateway preflight terminating existing gateway PID ${pid} (${source}).`);
  await runner.forceKill(pid);
  const exited = await waitForProcessExit(pid, stopTimeoutMs, runner);
  if (!exited) {
    throw new Error(`Timed out waiting for gateway PID ${pid} to exit during startup preflight.`);
  }
  return true;
}

async function cleanupPidReference(params: {
  pidFilePath: string;
  source: CleanupSource;
  ownershipTokens: string[];
  stopTimeoutMs: number;
  runner: GatewayPreflightRunner | null;
  logger: Pick<Console, "log" | "warn">;
  label: string;
  cleanedPids: number[];
}): Promise<void> {
  const { pidFilePath, source, ownershipTokens, stopTimeoutMs, runner, logger, label, cleanedPids } = params;
  const pid = readPidFile(pidFilePath);
  if (pid === null) {
    if (fs.existsSync(pidFilePath)) {
      removePidFile(pidFilePath);
    }
    return;
  }
  if (!isProcessRunning(pid, runner)) {
    removePidFile(pidFilePath);
    return;
  }
  if (!runner) {
    return;
  }
  const cleaned = await cleanupProcessByPid({
    pid,
    source,
    ownershipTokens,
    stopTimeoutMs,
    runner,
    logger,
    label,
  });
  if (cleaned) {
    removePidFile(pidFilePath);
    cleanedPids.push(pid);
    return;
  }
  removePidFile(pidFilePath);
}

export async function preflightGatewayCleanup(params: GatewayPreflightParams): Promise<GatewayPreflightResult> {
  const stateDir = path.resolve(params.stateDir);
  const logger = params.logger ?? console;
  const stopTimeoutMs = params.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const ownershipTokens = uniqueOwnershipTokens(params.ownershipTokens);
  const port = resolveGatewayPort(params.env ?? process.env, stateDir, params.port);
  const runner = params.runner ?? (process.platform === "win32" ? createPowerShellRunner() : null);
  const cleanedPids: number[] = [];
  const checkedPids = new Set<number>();

  await cleanupPidReference({
    pidFilePath: getDaemonPidFile(stateDir),
    source: "daemon_pid",
    ownershipTokens,
    stopTimeoutMs,
    runner,
    logger,
    label: params.label,
    cleanedPids,
  });
  for (const pid of cleanedPids) checkedPids.add(pid);

  await cleanupPidReference({
    pidFilePath: getForegroundPidFile(stateDir),
    source: "foreground_pid",
    ownershipTokens,
    stopTimeoutMs,
    runner,
    logger,
    label: params.label,
    cleanedPids,
  });
  for (const pid of cleanedPids) checkedPids.add(pid);

  if (runner) {
    const portOwner = await runner.findPortOwner(port);
    if (portOwner && !checkedPids.has(portOwner.pid)) {
      const cleaned = await cleanupProcessByPid({
        pid: portOwner.pid,
        source: "port_owner",
        ownershipTokens,
        stopTimeoutMs,
        runner,
        logger,
        label: params.label,
      });
      if (cleaned) {
        cleanedPids.push(portOwner.pid);
        checkedPids.add(portOwner.pid);
      } else {
        throw new Error(
          `Port ${port} is already in use by PID ${portOwner.pid} and does not look like this Star Sanctuary gateway: ${stringifyCommandForLog(portOwner.commandLine)}`,
        );
      }
    }
  }

  return { port, cleanedPids };
}
