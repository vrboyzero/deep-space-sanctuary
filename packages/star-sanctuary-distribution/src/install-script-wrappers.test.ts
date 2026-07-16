import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

function readInstallScript(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, "install.ps1"), "utf-8");
}

function readInstallShScript(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, "install.sh"), "utf-8");
}

function readRootStartShScript(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(currentDir, "..", "..", "..");
  return fs.readFileSync(path.join(workspaceRoot, "start.sh"), "utf-8");
}

test("install.ps1 Windows start.bat wrapper defaults AUTO_OPEN_BROWSER safely", () => {
  const script = readInstallScript();

  expect(script).toContain('if not defined AUTO_OPEN_BROWSER set "AUTO_OPEN_BROWSER=true"');
  expect(script).toContain('if /I "%CI%"=="true" set "AUTO_OPEN_BROWSER=false"');
  expect(script).toContain("echo [Star Sanctuary Launcher] Starting Gateway...");
  expect(script).toContain("echo [Star Sanctuary Launcher] WebChat: http://localhost:28889");
  expect(script).toContain("call node \"%INSTALL_ROOT%current\\packages\\belldandy-core\\dist\\bin\\bdd.js\" start %*");
});

test("install.ps1 Windows start.ps1 wrapper defaults AUTO_OPEN_BROWSER safely", () => {
  const script = readInstallScript();

  expect(script).toContain("if ([string]::IsNullOrWhiteSpace($env:AUTO_OPEN_BROWSER)) {");
  expect(script).toContain("$env:AUTO_OPEN_BROWSER = if ($env:CI -eq 'true') { 'false' } else { 'true' }");
  expect(script).toContain("} elseif ($env:CI -eq 'true') {");
  expect(script).toContain("$env:AUTO_OPEN_BROWSER = 'false'");
  expect(script).toContain("Write-Host '[Star Sanctuary Launcher] Starting Gateway...'");
  expect(script).toContain("Write-Host '[Star Sanctuary Launcher] WebChat: http://localhost:28889'");
  expect(script).toContain("& node (Join-Path $scriptDir 'current\\packages\\belldandy-core\\dist\\bin\\bdd.js') 'start' @args");
});

test("install.ps1 desktop shortcut uses the packaged ico when available", () => {
  const script = readInstallScript();

  expect(script).toContain('$iconPath = Join-Path $InstallRoot "current\\apps\\web\\public\\logo06-256.ico"');
  expect(script).toContain("if (Test-Path $iconPath -PathType Leaf) {");
  expect(script).toContain("$shortcut.IconLocation = $iconPath");
});

test("install scripts fall back to GitHub release pages when API metadata is unavailable", () => {
  const psScript = readInstallScript();
  const shScript = readInstallShScript();

  expect(psScript).toContain("falling back to GitHub release page resolution");
  expect(psScript).toContain("https://github.com/$Owner/$Name/releases/latest/download/");
  expect(psScript).toContain('"star-sanctuary-dist-v$versionNumber.manifest.json"');
  expect(psScript).toContain('"star-sanctuary-dist-v$versionNumber.sha256"');
  expect(psScript).not.toContain("https://github.com/$Owner/$Name/archive/refs/tags/$TagName.zip");

  expect(shScript).toContain("falling back to GitHub release page resolution");
  expect(shScript).toContain('asset_base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/"');
  expect(shScript).toContain('manifest_name="star-sanctuary-dist-v${version_number}.manifest.json"');
  expect(shScript).toContain('sha256_name="star-sanctuary-dist-v${version_number}.sha256"');
  expect(shScript).not.toContain("https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/tags/${tag_name}.tar.gz");
});

test("install scripts verify a bounded release-light payload before promotion", () => {
  const psScript = readInstallScript();
  const shScript = readInstallShScript();

  expect(psScript).toContain("$MaxReleaseArchiveBytes = 512MB");
  expect(psScript).toContain("Invoke-TrustedPayloadDownload");
  expect(psScript).toContain("Get-VerifiedReleaseIdentity");
  expect(psScript).toContain("Assert-SafeReleaseArchive");
  expect(psScript).toContain("before extracting");

  expect(shScript).toContain("MAX_RELEASE_ARCHIVE_BYTES=$((512 * 1024 * 1024))");
  expect(shScript).toContain("download_trusted_payload");
  expect(shScript).toContain("get_verified_release_identity");
  expect(shScript).toContain("validate_release_archive");
  expect(shScript).toContain("before extracting");
});

test("root start.sh uses the shared bdd start launcher path", () => {
  const script = readRootStartShScript();

  expect(script).toContain('echo "[Star Sanctuary Launcher] Starting Gateway..."');
  expect(script).toContain('echo "[Star Sanctuary Launcher] WebChat: http://localhost:28889"');
  expect(script).toContain("corepack pnpm bdd start");
  expect(script).not.toContain("corepack pnpm dev:gateway");
});
