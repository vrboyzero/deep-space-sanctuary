import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  detectStaleWorkspaceBuildPackages,
  ensureFreshWorkspaceBuildsForDevRuntime,
  resolveWorkspaceBuildGuardMode,
  type GuardedPackage,
} from "./workspace-build-guard.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function createGuardedPackageFixture(): Promise<GuardedPackage> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-build-guard-"));
  tempDirs.push(root);
  const packageDir = path.join(root, "packages", "belldandy-agent");
  await fs.mkdir(path.join(packageDir, "src"), { recursive: true });
  await fs.mkdir(path.join(packageDir, "dist"), { recursive: true });

  const sourceFiles = [
    "system-prompt.ts",
    "runtime-prompt-deltas.ts",
    "tool-agent.ts",
    "openai.ts",
  ];
  const distFiles = [
    "system-prompt.js",
    "runtime-prompt-deltas.js",
    "tool-agent.js",
    "openai.js",
    "index.js",
  ];

  for (const fileName of sourceFiles) {
    await fs.writeFile(path.join(packageDir, "src", fileName), `src:${fileName}`, "utf-8");
  }
  for (const fileName of distFiles) {
    await fs.writeFile(path.join(packageDir, "dist", fileName), `dist:${fileName}`, "utf-8");
  }

  return {
    name: "@belldandy/agent",
    dir: packageDir,
    criticalArtifacts: [
      { sourceFile: path.join("src", "system-prompt.ts"), distFile: path.join("dist", "system-prompt.js") },
      { sourceFile: path.join("src", "runtime-prompt-deltas.ts"), distFile: path.join("dist", "runtime-prompt-deltas.js") },
      { sourceFile: path.join("src", "tool-agent.ts"), distFile: path.join("dist", "tool-agent.js") },
      { sourceFile: path.join("src", "openai.ts"), distFile: path.join("dist", "openai.js") },
    ],
  };
}

async function markSourceNewerThanDist(sourcePath: string, distPath: string): Promise<void> {
  // 连续写入在部分文件系统会落在相同 mtime 粒度，fixture 必须显式构造 stale 边界。
  const distStat = await fs.stat(distPath);
  const newerAt = new Date(Math.max(Date.now(), distStat.mtimeMs) + 2_000);
  await fs.utimes(sourcePath, newerAt, newerAt);
}

test("resolveWorkspaceBuildGuardMode defaults to build and accepts warn/off", () => {
  expect(resolveWorkspaceBuildGuardMode({} as NodeJS.ProcessEnv)).toBe("build");
  expect(resolveWorkspaceBuildGuardMode({ BELLDANDY_DEV_RUNTIME_DIST_GUARD: "warn" } as NodeJS.ProcessEnv)).toBe("warn");
  expect(resolveWorkspaceBuildGuardMode({ BELLDANDY_DEV_RUNTIME_DIST_GUARD: "off" } as NodeJS.ProcessEnv)).toBe("off");
});

test("detectStaleWorkspaceBuildPackages reports stale dist when source is newer", async () => {
  const fixture = await createGuardedPackageFixture();
  const sourcePath = path.join(fixture.dir, "src", "system-prompt.ts");
  await fs.writeFile(sourcePath, "newer source", "utf-8");
  await markSourceNewerThanDist(sourcePath, path.join(fixture.dir, "dist", "system-prompt.js"));

  const stale = detectStaleWorkspaceBuildPackages([fixture]);
  expect(stale).toEqual(["@belldandy/agent"]);
});

test("ensureFreshWorkspaceBuildsForDevRuntime returns verified in warn mode without rebuilding", async () => {
  const fixture = await createGuardedPackageFixture();
  const sourcePath = path.join(fixture.dir, "src", "system-prompt.ts");
  await fs.writeFile(sourcePath, "newer source", "utf-8");
  await markSourceNewerThanDist(sourcePath, path.join(fixture.dir, "dist", "system-prompt.js"));

  const result = ensureFreshWorkspaceBuildsForDevRuntime({
    env: { BELLDANDY_DEV_RUNTIME_DIST_GUARD: "warn" } as NodeJS.ProcessEnv,
    packages: [fixture],
    buildRunner: () => {
      throw new Error("buildRunner should not run in warn mode");
    },
  });

  expect(result).toEqual({
    ok: true,
    mode: "verified",
    packageNames: ["@belldandy/agent"],
    reason: "warn_only",
  });
});

test("ensureFreshWorkspaceBuildsForDevRuntime triggers rebuild and returns rebuilt when stale", async () => {
  const fixture = await createGuardedPackageFixture();
  const sourcePath = path.join(fixture.dir, "src", "system-prompt.ts");
  await fs.writeFile(sourcePath, "newer source", "utf-8");
  await markSourceNewerThanDist(sourcePath, path.join(fixture.dir, "dist", "system-prompt.js"));

  const result = ensureFreshWorkspaceBuildsForDevRuntime({
    packages: [fixture],
    buildRunner: () => {
      const now = new Date(fsSync.statSync(sourcePath).mtimeMs + 2_000);
      for (const artifact of fixture.criticalArtifacts) {
        const absolutePath = path.join(fixture.dir, artifact.distFile);
        fsSync.utimesSync(absolutePath, now, now);
      }
      return { status: 0 } as any;
    },
  });

  expect(result).toEqual({
    ok: true,
    mode: "rebuilt",
    packageNames: ["@belldandy/agent"],
  });
});
