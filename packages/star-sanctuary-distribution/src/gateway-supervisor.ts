import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  createGatewaySupervisorLifecycle,
  RESTART_DELAY_MS,
  RESTART_EXIT_CODE,
} from "./gateway-supervisor-lifecycle.js";
import {
  ensureDefaultEnvFiles,
  loadRuntimeEnvFiles,
  readTrimmedEnv,
  resolveRuntimeEnvDir,
  preflightGatewayCleanup,
  removeForegroundPid,
  writeForegroundPid,
} from "./index.js";

export { RESTART_DELAY_MS, RESTART_EXIT_CODE } from "./gateway-supervisor-lifecycle.js";

export type GatewaySupervisorParams = {
  label: string;
  gatewayEntry: string;
  runtimeExecutable?: string;
  cwd: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
};

function reloadSupervisorEnv(baseEnv: NodeJS.ProcessEnv, stateDir: string): NodeJS.ProcessEnv {
  const envDir = resolveRuntimeEnvDir({
    baseEnv,
    fallbackEnvDir: stateDir,
  });
  ensureDefaultEnvFiles(envDir);
  const env = loadRuntimeEnvFiles(baseEnv, envDir);
  env.AUTO_OPEN_BROWSER = readTrimmedEnv(env, "AUTO_OPEN_BROWSER") ?? "true";
  return env;
}

export async function startGatewaySupervisor(params: GatewaySupervisorParams): Promise<void> {
  const { label, gatewayEntry, runtimeExecutable, cwd, stateDir, env } = params;
  const lifecycle = createGatewaySupervisorLifecycle({
    label,
    restartExitCode: RESTART_EXIT_CODE,
    restartDelayMs: RESTART_DELAY_MS,
    signalTarget: process,
    removeForegroundPid: () => removeForegroundPid(stateDir),
    onExit: (exitCode) => process.exit(exitCode),
    launch: async () => {
      const launchEnv = reloadSupervisorEnv(env, stateDir);
      await preflightGatewayCleanup({
        label,
        stateDir,
        env: launchEnv,
        ownershipTokens: [gatewayEntry],
      });
      console.log(`[${label}] Starting Gateway...`);
      fs.mkdirSync(cwd, { recursive: true });

      const child = spawn(runtimeExecutable ?? process.execPath, [gatewayEntry], {
        stdio: "inherit",
        cwd,
        env: launchEnv,
      });
      if (child.pid) {
        writeForegroundPid(stateDir, child.pid);
      }
      return child;
    },
  });

  await lifecycle.start();
}
