import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getModeLogSuffix, resolveDistributionMode, resolveSingleExeArtifactRoot } from "./distribution-mode.mjs";
import { guardedRemovePath } from "./sandbox-paths.mjs";
import {
  checkHealth,
  reserveFreePort,
  resolveStartupWaitSeconds,
  terminateChild,
  wait,
} from "./runtime-process.mjs";
import { assertPathInsideRoots, resolveSingleExeVerifyRoots } from "./single-exe-verify-paths.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", "..", "..");
const platform = process.platform;
const arch = process.arch;
const distribution = resolveDistributionMode();
const { mode } = distribution;
const suffix = getModeLogSuffix(mode);
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const singleExeRoot = resolveSingleExeArtifactRoot({
  workspaceRoot,
  platform,
  arch,
  mode,
});
const executablePath = path.join(singleExeRoot, "star-sanctuary-single.exe");
const smokeVerifyRoots = resolveSingleExeVerifyRoots({
  kind: "smoke",
  suffix,
});
const singleExeHome = smokeVerifyRoots.homeDir;
const stateDir = smokeVerifyRoots.stateDir;
const stdoutPath = path.join(workspaceRoot, "artifacts", `single-exe-smoke${suffix}.stdout.log`);
const stderrPath = path.join(workspaceRoot, "artifacts", `single-exe-smoke${suffix}.stderr.log`);
const SINGLE_EXE_SMOKE_MAX_WAIT_SECONDS = resolveStartupWaitSeconds(mode, {
  slim: 90,
  full: 180,
});

async function main() {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Single-exe artifact is missing for mode=${mode}. Run 'corepack pnpm build:single-exe${mode === "full" ? ":full" : ""}' first.`);
  }

  guardedRemovePath(stdoutPath, { allowedRoots: [artifactsRoot], label: "reset single-exe smoke stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [artifactsRoot], label: "reset single-exe smoke stderr log" });
  guardedRemovePath(assertPathInsideRoots(singleExeHome, [smokeVerifyRoots.runRoot], "reset single-exe smoke home"), {
    allowedRoots: [smokeVerifyRoots.runRoot],
    label: "reset single-exe smoke home",
  });
  guardedRemovePath(assertPathInsideRoots(stateDir, [smokeVerifyRoots.runRoot], "reset single-exe smoke state dir"), {
    allowedRoots: [smokeVerifyRoots.runRoot],
    label: "reset single-exe smoke state dir",
  });
  const port = await reserveFreePort();
  const relayPort = await reserveFreePort();

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  const child = spawn(executablePath, [], {
    cwd: singleExeRoot,
    env: {
      ...process.env,
      STAR_SANCTUARY_SINGLE_EXE_HOME: singleExeHome,
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
    for (let i = 0; i < SINGLE_EXE_SMOKE_MAX_WAIT_SECONDS; i += 1) {
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
    throw new Error(`Single-exe smoke test failed.\n--- stdout ---\n${stdoutTail}\n--- stderr ---\n${stderrTail}`);
  }

  console.log(`[single-exe-smoke] Single-exe package (${mode}) started successfully and /health responded.`);
}

main();
