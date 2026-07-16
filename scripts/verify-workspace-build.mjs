import fs from "node:fs";
import path from "node:path";
import { collectPackageArtifactFailures } from "./artifact-contract.mjs";

const workspaceRoot = process.cwd();
const packagesDir = path.join(workspaceRoot, "packages");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const failures = [];

for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const packageDir = path.join(packagesDir, entry.name);
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;

  const packageJson = readJson(packageJsonPath);
  if (
    typeof packageJson.name !== "string"
    || (!packageJson.name.startsWith("@belldandy/") && !packageJson.name.startsWith("@star-sanctuary/"))
  ) {
    continue;
  }

  failures.push(...collectPackageArtifactFailures({ packageDir, packageJson }));
}

if (failures.length > 0) {
  console.error("[verify:build] workspace package artifacts are incomplete:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[verify:build] all workspace package entrypoints are present");
