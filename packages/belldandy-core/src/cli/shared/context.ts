/**
 * CLIContext — shared context for all CLI commands.
 * Provides stateDir resolution, output mode, and logging helpers.
 */
import pc from "picocolors";
import {
  resolveEnvFilePaths,
  type EnvDirSource,
  type StateDirBootstrapSource,
} from "@star-sanctuary/distribution";
import { loadStateDirBootstrapInfo } from "../../../../star-sanctuary-distribution/src/state-dir-bootstrap.js";
import { resolveStateDir, loadProjectEnvFiles } from "./env-loader.js";

export interface CLIContext {
  stateDir: string;
  envDir: string;
  envSource: EnvDirSource;
  stateDirSource: StateDirBootstrapSource;
  stateDirBootstrapFilePath?: string;
  json: boolean;
  verbose: boolean;
  log: (msg: string) => void;
  error: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  /** --json → JSON.stringify, otherwise human-friendly */
  output: (data: unknown) => void;
}

export function createCLIContext(args: {
  json?: boolean;
  stateDir?: string;
  verbose?: boolean;
}): CLIContext {
  const bootstrap = loadStateDirBootstrapInfo(process.env);
  const resolvedEnv = bootstrap.env;
  const stateDir = args.stateDir ?? resolveStateDir(resolvedEnv);
  const envDir = stateDir;
  const envFiles = resolveEnvFilePaths({ envDir });
  loadProjectEnvFiles({
    envPath: envFiles.envPath,
    envLocalPath: envFiles.envLocalPath,
  });

  const json = args.json ?? false;

  return {
    stateDir,
    envDir,
    envSource: "state_dir" as EnvDirSource,
    stateDirSource: args.stateDir ? "process_env" : bootstrap.source,
    ...(bootstrap.bootstrapFilePath ? { stateDirBootstrapFilePath: bootstrap.bootstrapFilePath } : {}),
    json,
    verbose: args.verbose ?? false,
    log: (msg) => {
      if (!json) console.log(msg);
    },
    error: (msg) => {
      console.error(json ? "" : pc.red(`✗ ${msg}`));
    },
    success: (msg) => {
      if (!json) console.log(pc.green(`✓ ${msg}`));
    },
    warn: (msg) => {
      if (!json) console.log(pc.yellow(`⚠ ${msg}`));
    },
    output: (data) => {
      if (json) {
        console.log(JSON.stringify(data, null, 2));
      } else if (Array.isArray(data)) {
        data.forEach((row) => console.log(row));
      } else {
        console.log(data);
      }
    },
  };
}
