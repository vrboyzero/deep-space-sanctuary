import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";

export type WorkspacePackageBuildGuardResult = {
  ok: boolean;
  mode: "noop" | "verified" | "rebuilt" | "failed";
  packageNames: string[];
  reason?: string;
};

export type WorkspaceBuildGuardMode = "build" | "warn" | "off";

const CORE_SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(CORE_SRC_DIR, "..", "..", "..", "..");

export type GuardedPackage = {
  name: string;
  dir: string;
  criticalArtifacts: Array<{
    sourceFile: string;
    distFile: string;
  }>;
};

const GUARDED_PACKAGES: GuardedPackage[] = [
  {
    name: "@belldandy/agent",
    dir: path.join(WORKSPACE_ROOT, "packages", "belldandy-agent"),
    criticalArtifacts: [
      {
        sourceFile: path.join("src", "system-prompt.ts"),
        distFile: path.join("dist", "system-prompt.js"),
      },
      {
        sourceFile: path.join("src", "runtime-prompt-deltas.ts"),
        distFile: path.join("dist", "runtime-prompt-deltas.js"),
      },
      {
        sourceFile: path.join("src", "tool-agent.ts"),
        distFile: path.join("dist", "tool-agent.js"),
      },
      {
        sourceFile: path.join("src", "openai.ts"),
        distFile: path.join("dist", "openai.js"),
      },
    ],
  },
];

function artifactNeedsRebuild(pkg: GuardedPackage, artifact: { sourceFile: string; distFile: string }): boolean {
  const sourceMtime = fileMtimeMs(path.join(pkg.dir, artifact.sourceFile));
  if (!Number.isFinite(sourceMtime)) {
    return false;
  }
  const distMtime = fileMtimeMs(path.join(pkg.dir, artifact.distFile));
  if (!Number.isFinite(distMtime)) {
    return true;
  }
  return sourceMtime > distMtime;
}

function packageNeedsRebuild(pkg: GuardedPackage): boolean {
  return pkg.criticalArtifacts.some((artifact) => artifactNeedsRebuild(pkg, artifact));
}
type BuildRunner = (input: {
  workspaceRoot: string;
  packageNames: string[];
  env: NodeJS.ProcessEnv;
}) => SpawnSyncReturns<Buffer>;

function fileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return Number.NaN;
  }
}

export function resolveWorkspaceBuildGuardMode(env: NodeJS.ProcessEnv = process.env): WorkspaceBuildGuardMode {
  const raw = String(env.BELLDANDY_DEV_RUNTIME_DIST_GUARD ?? "").trim().toLowerCase();
  if (!raw) {
    return "build";
  }
  if (raw === "warn") {
    return "warn";
  }
  if (raw === "off" || raw === "false" || raw === "0" || raw === "disabled" || raw === "no") {
    return "off";
  }
  return "build";
}

export function detectStaleWorkspaceBuildPackages(packages: GuardedPackage[] = GUARDED_PACKAGES): string[] {
  return packages
    .filter((pkg) => packageNeedsRebuild(pkg))
    .map((pkg) => pkg.name);
}

export function ensureFreshWorkspaceBuildsForDevRuntime(input?: {
  env?: NodeJS.ProcessEnv;
  packages?: GuardedPackage[];
  buildRunner?: BuildRunner;
}): WorkspacePackageBuildGuardResult {
  const env = input?.env ?? process.env;
  const packages = input?.packages ?? GUARDED_PACKAGES;
  const buildRunner = input?.buildRunner ?? defaultBuildRunner;
  const mode = resolveWorkspaceBuildGuardMode(env);

  if (mode === "off") {
    return {
      ok: true,
      mode: "noop",
      packageNames: [],
    };
  }

  const stalePackages = detectStaleWorkspaceBuildPackages(packages);
  if (stalePackages.length === 0) {
    return {
      ok: true,
      mode: "verified",
      packageNames: [],
    };
  }

  if (mode === "warn") {
    return {
      ok: true,
      mode: "verified",
      packageNames: stalePackages,
      reason: "warn_only",
    };
  }

  const result = buildRunner({
    workspaceRoot: WORKSPACE_ROOT,
    packageNames: stalePackages,
    env,
  });

  if (result.status !== 0) {
    return {
      ok: false,
      mode: "failed",
      packageNames: stalePackages,
      reason: `Workspace package build guard failed while rebuilding: ${stalePackages.join(", ")}`,
    };
  }

  const remaining = detectStaleWorkspaceBuildPackages(packages);
  if (remaining.length > 0) {
    return {
      ok: false,
      mode: "failed",
      packageNames: remaining,
      reason: `Workspace package build guard still detects stale artifacts after rebuild: ${remaining.join(", ")}`,
    };
  }

  return {
    ok: true,
    mode: "rebuilt",
    packageNames: stalePackages,
  };
}

function defaultBuildRunner(input: {
  workspaceRoot: string;
  packageNames: string[];
  env: NodeJS.ProcessEnv;
}): SpawnSyncReturns<Buffer> {
  return spawnSync("corepack", [
    "pnpm",
    ...input.packageNames.flatMap((name) => ["--filter", name]),
    "build",
  ], {
    cwd: input.workspaceRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: input.env,
  });
}
