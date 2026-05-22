import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
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
const lifecycleStateDir = path.join(workspaceRoot, "artifacts", `portable-state-lifecycle${suffix}`);
const reportPath = path.join(portableRoot, "portable-lifecycle-report.json");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function ensureArtifactExists() {
  if (!fs.existsSync(executablePath) || !fs.existsSync(entryScript)) {
    throw new Error(`Portable artifact is missing for mode=${mode}. Run 'corepack pnpm build:portable${mode === "full" ? ":full" : ""}' first.`);
  }
}

function rebuildPortableArtifact() {
  const scriptName = mode === "full" ? "build:portable:full" : "build:portable";
  const result = spawnSync("corepack", ["pnpm", scriptName], {
    cwd: workspaceRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      CI: "true",
    },
  });

  if (result.status !== 0) {
    throw new Error(`Portable lifecycle rebuild failed for ${scriptName} with exit code ${result.status ?? 1}`);
  }
}

async function runPortable(params) {
  const {
    label,
    expectHealthy,
    maxWaitSeconds = resolveStartupWaitSeconds(mode, {
      slim: 25,
      full: 50,
    }),
  } = params;
  const stdoutPath = path.join(workspaceRoot, "artifacts", `portable-lifecycle-${label}${suffix}.stdout.log`);
  const stderrPath = path.join(workspaceRoot, "artifacts", `portable-lifecycle-${label}${suffix}.stderr.log`);

  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const port = await reserveFreePort();
  const relayPort = await reserveFreePort();
  const child = spawn(executablePath, [entryScript], {
    cwd: portableRoot,
    env: {
      ...process.env,
      BELLDANDY_STATE_DIR: lifecycleStateDir,
      BELLDANDY_PORT: String(port),
      BELLDANDY_RELAY_PORT: String(relayPort),
      AUTO_OPEN_BROWSER: "false",
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });

  let healthy = false;
  try {
    for (let i = 0; i < maxWaitSeconds; i += 1) {
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

  const stdoutText = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
  const stderrText = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";

  if (expectHealthy && !healthy) {
    throw new Error(`Portable lifecycle step '${label}' failed.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }
  if (!expectHealthy && healthy) {
    throw new Error(`Portable lifecycle step '${label}' was expected to fail but /health responded.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }

  return {
    healthy,
    stdoutText,
    stderrText,
  };
}

async function main() {
  ensureArtifactExists();

  fs.rmSync(lifecycleStateDir, { recursive: true, force: true });
  fs.rmSync(reportPath, { force: true });

  const envMarkerPath = path.join(lifecycleStateDir, ".env.local");
  const stateMarkerPath = path.join(lifecycleStateDir, "workspace", "marker.txt");
  fs.mkdirSync(path.dirname(envMarkerPath), { recursive: true });
  fs.mkdirSync(path.dirname(stateMarkerPath), { recursive: true });
  fs.writeFileSync(envMarkerPath, "PORTABLE_LIFECYCLE=preserve\n", "utf-8");
  fs.writeFileSync(stateMarkerPath, "portable-state-preserved\n", "utf-8");

  const initialRun = await runPortable({
    label: "initial",
    expectHealthy: true,
  });

  const reuseRun = await runPortable({
    label: "reuse",
    expectHealthy: true,
  });

  rebuildPortableArtifact();
  ensureArtifactExists();
  const postUpgradeRun = await runPortable({
    label: "upgrade",
    expectHealthy: true,
  });

  const gatewayPath = path.join(portableRoot, "runtime", "packages", "belldandy-core", "dist", "bin", "gateway.js");
  const originalGatewaySha = sha256File(gatewayPath);
  fs.writeFileSync(gatewayPath, "export default 0; // corrupted by portable lifecycle test\n", "utf-8");
  const corruptedGatewaySha = sha256File(gatewayPath);

  const recoveryRun = await runPortable({
    label: "recovery",
    expectHealthy: true,
    maxWaitSeconds: resolveStartupWaitSeconds(mode, {
      slim: 60,
      full: 90,
    }),
  });
  const restoredGatewaySha = sha256File(gatewayPath);

  const report = {
    productName: "Star Sanctuary",
    mode,
    scenarios: {
      initialStart: {
        ok: initialRun.healthy,
      },
      reuseExistingState: {
        ok: reuseRun.healthy,
      },
      preserveStateAndEnvAcrossUpgrade: {
        ok: postUpgradeRun.healthy && fs.existsSync(envMarkerPath) && fs.existsSync(stateMarkerPath),
        envMarkerPath,
        stateMarkerPath,
      },
      recoverCorruptedRuntime: {
        ok: recoveryRun.healthy && corruptedGatewaySha !== originalGatewaySha && restoredGatewaySha === originalGatewaySha,
        originalSha256: originalGatewaySha,
        corruptedSha256: corruptedGatewaySha,
        restoredSha256: restoredGatewaySha,
      },
    },
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const failures = Object.entries(report.scenarios)
    .filter(([, scenario]) => !scenario.ok)
    .map(([scenarioName]) => scenarioName);
  if (failures.length > 0) {
    throw new Error(`Portable lifecycle verification failed for: ${failures.join(", ")}.\n${JSON.stringify(report, null, 2)}`);
  }

  console.log(`[portable-lifecycle] Lifecycle report (${mode}) written to ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main();
