import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getModeLogSuffix, resolveDistributionMode, resolvePortableArtifactRoot } from "./distribution-mode.mjs";
import {
  assertRuntimeDependencyReport,
  createRuntimeDependencyReportTarget,
} from "./runtime-dependency-report-policy.mjs";
import { guardedRemovePath } from "./sandbox-paths.mjs";

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
const artifactsRoot = path.join(workspaceRoot, "artifacts");
const executablePath = path.join(portableRoot, "star-sanctuary.exe");
const entryScript = path.join(
  portableRoot,
  "runtime",
  "packages",
  "star-sanctuary-distribution",
  "dist",
  "portable-runtime-check.js",
);
const reportPath = path.join(portableRoot, "portable-deps-report.json");
const stdoutPath = path.join(workspaceRoot, "artifacts", `portable-verify${suffix}.stdout.log`);
const stderrPath = path.join(workspaceRoot, "artifacts", `portable-verify${suffix}.stderr.log`);

async function main() {
  if (!fs.existsSync(executablePath) || !fs.existsSync(entryScript)) {
    throw new Error(`Portable artifact is missing for mode=${mode}. Run 'corepack pnpm build:portable${mode === "full" ? ":full" : ""}' first.`);
  }

  guardedRemovePath(reportPath, { allowedRoots: [portableRoot], label: "reset portable deps report" });
  guardedRemovePath(stdoutPath, { allowedRoots: [artifactsRoot], label: "reset portable deps stdout log" });
  guardedRemovePath(stderrPath, { allowedRoots: [artifactsRoot], label: "reset portable deps stderr log" });

  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");

  const child = spawn(executablePath, [entryScript], {
    cwd: portableRoot,
    env: {
      ...process.env,
      AUTO_OPEN_BROWSER: "false",
      STAR_SANCTUARY_PORTABLE_REPORT_PATH: reportPath,
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);

  const stdoutText = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8").trim() : "";
  const stderrText = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8").trim() : "";

  if (exitCode !== 0) {
    throw new Error(`Portable dependency verification failed.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }

  if (!fs.existsSync(reportPath)) {
    throw new Error(`Portable dependency report was not generated.\n--- stdout ---\n${stdoutText}\n--- stderr ---\n${stderrText}`);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  assertRuntimeDependencyReport(report, createRuntimeDependencyReportTarget({
    mode,
    platform,
    arch,
    nodeAbi: process.versions.modules,
  }));

  console.log(`[portable-verify] Dependency report (${mode}) written to ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main();
