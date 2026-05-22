import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getModeLogSuffix, resolveDistributionMode, resolvePortableArtifactRoot } from "./distribution-mode.mjs";
import {
  checkHealth,
  reserveFreePort,
  resolveStartupWaitSeconds,
  terminateChild,
  wait,
} from "./runtime-process.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const platform = process.platform;
const arch = process.arch;
const distribution = resolveDistributionMode();
const { mode } = distribution;
const suffix = getModeLogSuffix(mode);
const portableRoot = resolvePortableArtifactRoot({
  workspaceRoot,
  platform,
  arch,
  mode,
});
const executablePath = path.join(portableRoot, "star-sanctuary.exe");
const entryScript = path.join(portableRoot, "launcher", "portable-entry.js");
const stateDir = path.join(workspaceRoot, "artifacts", `portable-state-smoke${suffix}`);
const stdoutPath = path.join(workspaceRoot, "artifacts", `portable-smoke${suffix}.stdout.log`);
const stderrPath = path.join(workspaceRoot, "artifacts", `portable-smoke${suffix}.stderr.log`);
const PORTABLE_SMOKE_MAX_WAIT_SECONDS = resolveStartupWaitSeconds(mode, {
  slim: 20,
  full: 45,
});

async function main() {
  if (!fs.existsSync(executablePath) || !fs.existsSync(entryScript)) {
    throw new Error(`Portable artifact is missing for mode=${mode}. Run 'corepack pnpm build:portable${mode === "full" ? ":full" : ""}' first.`);
  }

  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
  const port = await reserveFreePort();
  const relayPort = await reserveFreePort();

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  const child = spawn(executablePath, [entryScript], {
    cwd: portableRoot,
    env: {
      ...process.env,
      BELLDANDY_STATE_DIR: stateDir,
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      AUTO_OPEN_BROWSER: "false",
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });

  let healthy = false;
  try {
    for (let i = 0; i < PORTABLE_SMOKE_MAX_WAIT_SECONDS; i += 1) {
      await wait(1000);
      if (child.exitCode != null) break;
      if (await checkHealth(`http://127.0.0.1:${port}/health`)) {
        healthy = true;
        break;
      }
    }
  } finally {
    await terminateChild(child);
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }

  if (!healthy) {
    const stdoutTail = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
    const stderrTail = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";
    throw new Error(`Portable smoke test failed.\n--- stdout ---\n${stdoutTail}\n--- stderr ---\n${stderrTail}`);
  }

  console.log(`[portable-smoke] Portable package (${mode}) started successfully and /health responded on port ${port}.`);
}

main();
