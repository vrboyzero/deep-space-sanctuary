import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createTuiPerformancePlatformResult,
  createTuiPerformanceReport,
} from "./tui-performance-contract.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "artifacts/benchmarks/p1b-tui-performance.json";
const defaultBaseline = "benchmarks/tui-performance/v1/baseline.json";
const replayMarker = "TUI_PERF_END";
const replayCharacterCount = 256;
const maxCaptureBytes = 2_000_000;

function parseInteger(value, label, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseTuiPerformanceBenchmarkArgs(argv) {
  const args = {
    platform: "all",
    output: defaultOutput,
    baseline: defaultBaseline,
    warmupRuns: 1,
    sampleRuns: 7,
    startupTimeoutSeconds: 30,
    calibration: false,
    help: false,
  };
  const valueArguments = new Set([
    "--platform",
    "--output",
    "--baseline",
    "--warmup-runs",
    "--sample-runs",
    "--startup-timeout-seconds",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      args.help = true;
      continue;
    }
    if (argument === "--calibration") {
      args.calibration = true;
      continue;
    }
    if (!valueArguments.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} requires a value.`);
    if (argument === "--platform") {
      if (!["all", "windows-native", "wsl2-linux"].includes(value)) {
        throw new Error("--platform must be all, windows-native, or wsl2-linux.");
      }
      args.platform = value;
    } else if (argument === "--output") {
      args.output = value;
    } else if (argument === "--baseline") {
      args.baseline = value;
    } else if (argument === "--warmup-runs") {
      args.warmupRuns = parseInteger(value, "--warmup-runs", { minimum: 0, maximum: 20 });
    } else if (argument === "--sample-runs") {
      args.sampleRuns = parseInteger(value, "--sample-runs", { minimum: 5, maximum: 100 });
    } else if (argument === "--startup-timeout-seconds") {
      args.startupTimeoutSeconds = parseInteger(value, "--startup-timeout-seconds", {
        minimum: 5,
        maximum: 120,
      });
    }
    index += 1;
  }
  return args;
}

export function createTuiPerformanceReplayInput(characterCount = replayCharacterCount) {
  if (!Number.isSafeInteger(characterCount) || characterCount < replayMarker.length) {
    throw new Error(`TUI replay character count must be at least ${replayMarker.length}.`);
  }
  return `${"x".repeat(characterCount - replayMarker.length)}${replayMarker}`;
}

export async function isPathAbsent(targetPath, access = fs.access) {
  try {
    await access(targetPath);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function terminateWindowsProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return;
  spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
    windowsHide: true,
    stdio: "ignore",
    shell: false,
  });
}

function createChildEnvironment() {
  const blocked = /(?:^BELLDANDY_|TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL)/i;
  return Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => typeof value === "string" && !blocked.test(key)));
}

function loadNodePty() {
  const requireFromSkills = createRequire(path.join(
    workspaceRoot,
    "packages",
    "belldandy-skills",
    "package.json",
  ));
  try {
    return requireFromSkills("node-pty");
  } catch (error) {
    throw new Error(`Windows TUI performance Gate requires optional dependency node-pty: ${error.message}`);
  }
}

async function runWindowsSample({ pty, entry, startupTimeoutSeconds, replayInput, sequence }) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-tui-performance-"));
  const startedAt = performance.now();
  const child = pty.spawn(process.execPath, [entry, "tui", "--state-dir", stateDir, "--cwd", workspaceRoot], {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: workspaceRoot,
    env: { ...createChildEnvironment(), TERM: "xterm-256color" },
    useConptyDll: true,
  });
  let transcript = "";
  let capturedBytes = 0;
  let stage = "startup";
  let stageOffset = 0;
  let resizeStartedAt;
  let inputStartedAt;
  let exitStartedAt;
  let firstFrame = false;
  let narrowFallback = false;
  let wideLayoutRestored = false;
  let mouseChangesRendered = false;
  let mouseTabNavigation = false;
  let inputReplayRendered = false;
  let ctrlCSent = false;
  const durationsMs = {};
  let collected;

  let dataDisposable;
  let exitDisposable;
  let timeout;
  let interactionTimer;
  let exited = false;
  try {
    const exit = await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      timeout = setTimeout(() => {
        fail(new Error(`windows-native TUI sample ${sequence} timed out during ${stage}.`));
      }, startupTimeoutSeconds * 1000);
      dataDisposable = child.onData((chunk) => {
        capturedBytes += Buffer.byteLength(chunk, "utf-8");
        if (capturedBytes > maxCaptureBytes) {
          fail(new Error(`windows-native TUI sample ${sequence} exceeded the capture limit.`));
          return;
        }
        transcript += chunk;
        const current = transcript.slice(stageOffset);
        const now = performance.now();
        if (stage === "startup" && current.includes("Star Sanctuary")) {
          firstFrame = true;
          durationsMs.startup = now - startedAt;
          resizeStartedAt = now;
          stageOffset = transcript.length;
          child.resize(24, 8);
          stage = "narrow";
        } else if (stage === "narrow" && current.includes("Terminal too small.")) {
          narrowFallback = true;
          stageOffset = transcript.length;
          child.resize(72, 20);
          stage = "restore";
        } else if (stage === "restore" && current.includes("Star Sanctuary")) {
          wideLayoutRestored = true;
          durationsMs.resize = now - resizeStartedAt;
          stage = "mouse_changes_wait";
          interactionTimer = setTimeout(() => {
            if (stage !== "mouse_changes_wait") return;
            stageOffset = transcript.length;
            child.write("\x1b[<0;18;2M");
            stage = "mouse_changes";
          }, 500);
        } else if (stage === "mouse_changes" && current.includes("Revision Checkpoints")) {
          mouseChangesRendered = true;
          stage = "mouse_chat_wait";
          interactionTimer = setTimeout(() => {
            if (stage !== "mouse_chat_wait") return;
            stageOffset = transcript.length;
            child.write("\x1b[<0;3;2M");
            stage = "mouse_chat";
          }, 500);
        } else if (stage === "mouse_chat" && current.includes("Activity")) {
          mouseTabNavigation = mouseChangesRendered;
          inputStartedAt = now;
          stageOffset = transcript.length;
          child.write(replayInput);
          stage = "input";
        } else if (stage === "input" && current.includes(replayMarker)) {
          inputReplayRendered = true;
          durationsMs.inputReplay = now - inputStartedAt;
          stage = "exit_wait";
          interactionTimer = setTimeout(() => {
            if (stage !== "exit_wait") return;
            ctrlCSent = true;
            exitStartedAt = performance.now();
            child.write("\x03");
            stage = "exit";
            clearTimeout(timeout);
            timeout = setTimeout(() => {
              fail(new Error(`windows-native TUI sample ${sequence} did not exit after Ctrl+C.`));
            }, 8_000);
          }, 500);
        }
      });
      exitDisposable = child.onExit((event) => {
        exited = true;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (exitStartedAt !== undefined) durationsMs.exit = performance.now() - exitStartedAt;
        setTimeout(() => resolve(event), 75);
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const alternateScreenLeaveAt = transcript.lastIndexOf("\x1b[?1049l");
    const bracketedPasteLeaveAt = transcript.lastIndexOf("\x1b[?2004l");
    const mouseTrackingLeaveAt = transcript.lastIndexOf("\x1b[?1000l");
    const sgrMouseLeaveAt = transcript.lastIndexOf("\x1b[?1006l");
    collected = {
      sequence,
      durationsMs,
      capturedBytes,
      lifecycle: {
        firstFrame,
        narrowFallback,
        wideLayoutRestored,
        mouseTabNavigation,
        inputReplayRendered,
        ctrlCSent,
        bracketedPasteRestored: transcript.includes("\x1b[?2004h") && bracketedPasteLeaveAt >= 0,
        mouseTrackingRestored: transcript.includes("\x1b[?1000h") && mouseTrackingLeaveAt >= 0,
        sgrMouseRestored: transcript.includes("\x1b[?1006h") && sgrMouseLeaveAt >= 0,
        alternateScreenRestored: transcript.includes("\x1b[?1049h") && alternateScreenLeaveAt >= 0,
        inputModesRestoredBeforeScreen: alternateScreenLeaveAt >= 0
          && bracketedPasteLeaveAt >= 0 && bracketedPasteLeaveAt < alternateScreenLeaveAt
          && mouseTrackingLeaveAt >= 0 && mouseTrackingLeaveAt < alternateScreenLeaveAt
          && sgrMouseLeaveAt >= 0 && sgrMouseLeaveAt < alternateScreenLeaveAt,
        exitCode: exit.exitCode,
        timedOut: false,
        observedProcessCount: 1,
        residualProcessCount: isProcessAlive(child.pid) ? 1 : 0,
        stateDirRemoved: false,
      },
    };
    return collected;
  } finally {
    clearTimeout(timeout);
    clearTimeout(interactionTimer);
    dataDisposable?.dispose();
    exitDisposable?.dispose();
    try {
      child.kill();
    } catch {}
    if (!exited || isProcessAlive(child.pid)) terminateWindowsProcessTree(child.pid);
    await fs.rm(stateDir, { recursive: true, force: true });
    if (collected) {
      collected.lifecycle.stateDirRemoved = await isPathAbsent(stateDir);
    }
  }
}

async function collectWindowsPlatform(args) {
  if (process.platform !== "win32") {
    throw new Error("windows-native TUI performance Gate requires a Windows host.");
  }
  const entry = path.join(workspaceRoot, "packages", "belldandy-core", "dist", "bin", "bdd.js");
  await fs.access(entry).catch(() => {
    throw new Error(`Built CLI entry is missing: ${entry}. Run corepack pnpm build first.`);
  });
  const pty = loadNodePty();
  const replayInput = createTuiPerformanceReplayInput();
  for (let index = 0; index < args.warmupRuns; index += 1) {
    console.log(`[benchmark:tui-performance] windows-native warm-up ${index + 1}/${args.warmupRuns}`);
    await runWindowsSample({
      pty,
      entry,
      startupTimeoutSeconds: args.startupTimeoutSeconds,
      replayInput,
      sequence: index + 1,
    });
  }
  const samples = [];
  for (let index = 0; index < args.sampleRuns; index += 1) {
    console.log(`[benchmark:tui-performance] windows-native sample ${index + 1}/${args.sampleRuns}`);
    const collected = await runWindowsSample({
      pty,
      entry,
      startupTimeoutSeconds: args.startupTimeoutSeconds,
      replayInput,
      sequence: index + 1,
    });
    samples.push(collected);
  }
  return createTuiPerformancePlatformResult({
    platform: "windows-native",
    environment: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version,
      terminalBackend: "conpty",
      wsl: false,
    },
    samples,
    minimumSampleCount: 5,
  });
}

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
  if (result.error || result.status !== 0) {
    throw new Error(`Failed to list WSL distros: ${decodeMaybeUtf16(result.stderr).trim()}`);
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

function collectWslPlatform(args) {
  if (process.platform !== "win32") {
    throw new Error("wsl2-linux TUI performance Gate requires a Windows host with WSL.");
  }
  const distro = detectWslDistro();
  if (!distro) throw new Error("No usable WSL distro found.");
  const workspaceRootWsl = toWslPath(workspaceRoot);
  const timeoutMs = (args.warmupRuns + args.sampleRuns) * (args.startupTimeoutSeconds + 10) * 1000;
  const result = spawnSync("wsl.exe", [
    "-d", distro,
    "--cd", workspaceRootWsl,
    "--",
    "python3", "scripts/run-tui-performance-pty.py",
    "--repo", workspaceRootWsl,
    "--warmup-runs", String(args.warmupRuns),
    "--sample-runs", String(args.sampleRuns),
    "--replay-character-count", String(replayCharacterCount),
    "--startup-timeout-seconds", String(args.startupTimeoutSeconds),
  ], {
    cwd: workspaceRoot,
    windowsHide: true,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wsl2-linux collector exited with code ${result.status}.`);
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`wsl2-linux collector returned invalid JSON: ${error.message}`);
  }
  return createTuiPerformancePlatformResult({
    ...payload,
    minimumSampleCount: 5,
  });
}

function readGit(args) {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf-8",
    windowsHide: true,
    shell: false,
  });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

async function writeJson(relativePath, value) {
  const target = path.resolve(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  return target;
}

function printHelp() {
  console.log(`Usage: node scripts/run-tui-performance-benchmark.mjs [options]

Options:
  --platform <value>                 all, windows-native, or wsl2-linux (default: all)
  --output <path>                    JSON report path (default: ${defaultOutput})
  --baseline <path>                  Fixed historical baseline (default: ${defaultBaseline})
  --warmup-runs <n>                  Warm-up samples (default: 1)
  --sample-runs <n>                  Measured samples, minimum 5 (default: 7)
  --startup-timeout-seconds <n>      Per-sample startup timeout (default: 30)
  --calibration                      Emit an ungated candidate; never updates baseline
  --help                             Show this help message`);
}

async function main() {
  const args = parseTuiPerformanceBenchmarkArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const platforms = args.platform === "all"
    ? ["windows-native", "wsl2-linux"]
    : [args.platform];
  const platformResults = [];
  for (const platform of platforms) {
    platformResults.push(platform === "windows-native"
      ? await collectWindowsPlatform(args)
      : collectWslPlatform(args));
  }
  const commit = readGit(["rev-parse", "HEAD"]);
  const status = readGit(["status", "--porcelain"]);
  if (!commit || status === null) throw new Error("TUI performance Gate requires readable Git source identity.");
  const source = { commit, workspaceDirty: status.length > 0 };
  const fixture = {
    warmupRuns: args.warmupRuns,
    sampleRuns: args.sampleRuns,
    replayCharacterCount,
  };
  if (args.calibration) {
    const calibration = {
      schemaVersion: "tui-performance-calibration/v1",
      generatedAt: new Date().toISOString(),
      source,
      fixture,
      platforms: platformResults,
    };
    const output = await writeJson(args.output, calibration);
    console.log(`[benchmark:tui-performance] calibration only; baseline unchanged: ${output}`);
    return;
  }

  const baseline = JSON.parse(await fs.readFile(path.resolve(workspaceRoot, args.baseline), "utf-8"));
  const report = createTuiPerformanceReport({
    generatedAt: new Date().toISOString(),
    source,
    fixture,
    platformResults,
    baseline,
    requiredPlatforms: platforms,
  });
  const output = await writeJson(args.output, report);
  for (const result of report.platforms) {
    for (const [phase, summary] of Object.entries(result.metrics)) {
      console.log(
        `[benchmark:tui-performance] ${result.platform}/${phase}: p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms p99=${summary.p99Ms}ms jitter=${summary.jitterRate}`,
      );
    }
  }
  console.log(`[benchmark:tui-performance] report: ${output}`);
  if (!report.gate.passed) {
    throw new Error(`TUI performance Gate failed:\n${report.gate.failures.join("\n")}`);
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`[benchmark:tui-performance] failed: ${error.message}\n`, () => process.exit(1));
    },
  );
}
