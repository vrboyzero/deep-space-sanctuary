param(
  [string]$Version = "latest",
  [string]$InstallDir,
  [string]$RepoOwner = "vrboyzero",
  [string]$RepoName = "star-sanctuary",
  [string]$SourceDir,
  [switch]$SkipInstallBuild,
  [switch]$NoSetup,
  [switch]$ForceSetup,
  [switch]$NoDesktopShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$MinimumNodeMajor = 22
$MinimumNodeMinor = 12
$FirstStartNoticeFileName = "first-start-notice.txt"
$MaxReleaseArchiveBytes = 512MB
$MaxReleaseMetadataBytes = 1MB
$MaxReleaseArchiveEntries = 100000
$MaxReleaseArchiveEntryBytes = 256MB
$MaxReleaseArchiveUnpackedBytes = 2GB

function Write-Step {
  param([string]$Message)
  Write-Host "[install] $Message"
}

function Write-InstallHintBlock {
  param([string]$Message)

  $hints = @()

  if ($Message -match "Node\.js was not found" -or $Message -match "Node\.js v.* is too old" -or $Message -match "Failed to detect Node\.js version") {
    $hints += "Use Node.js v22.12+ LTS, then reopen the terminal so node/corepack are available on PATH."
  }

  if ($Message -match "corepack was not found" -or $Message -match "corepack prepare .* failed") {
    $hints += "Install or repair a Node.js distribution that includes corepack, then rerun the installer."
  }

  if ($Message -match "corepack pnpm install failed" -or $Message -match "corepack pnpm build failed") {
    $hints += "Default install/start does not require optional native features like node-pty, fastembed, protobufjs, or onnxruntime-node."
    $hints += "A plain 'pnpm approve-builds' reminder is not a blocker for the default install/build path."
    $hints += "If the log mentions better-sqlite3, native bindings, ABI, or postinstall failures, switch to Node.js v22.12+ LTS and rerun."
    $hints += "If the log mentions registry, tarball, ECONNRESET, ETIMEDOUT, or proxy access, fix network/registry access and rerun."
  }

  if ($Message -match "'bdd setup' exited with code") {
    $hints += "Install/build already completed. Fix the setup issue and rerun '$InstallDir\\bdd.cmd setup' or rerun the installer with -ForceSetup."
  }

  if ($hints.Count -eq 0) {
    return
  }

  foreach ($hint in $hints | Select-Object -Unique) {
    Write-Host "[install] HINT: $hint" -ForegroundColor Yellow
  }
}

function New-TempDirectory {
  param([string]$BaseDir)

  $root = if ([string]::IsNullOrWhiteSpace($BaseDir)) {
    [System.IO.Path]::GetTempPath()
  } else {
    $BaseDir
  }

  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $path = Join-Path $root ("star-sanctuary-install-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $path | Out-Null
  return $path
}

function Normalize-Version {
  param([string]$RawVersion)
  if ([string]::IsNullOrWhiteSpace($RawVersion) -or $RawVersion -eq "latest") {
    return "latest"
  }

  if ($RawVersion.StartsWith("v")) {
    return $RawVersion
  }

  return "v$RawVersion"
}

function Get-GitHubHeaders {
  $headers = @{
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "Star-Sanctuary-Installer"
  }

  if ($env:GITHUB_TOKEN) {
    $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
  }

  return $headers
}

function Get-PublicGitHubHeaders {
  return @{
    "User-Agent" = "Star-Sanctuary-Installer"
  }
}

function Assert-GitHubRepositoryIdentity {
  param(
    [string]$Owner,
    [string]$Name,
    [string]$RequestedVersion
  )

  if ($Owner -notmatch "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$" -or $Name -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$") {
    throw "Repository owner or name contains unsupported characters."
  }
  if ($RequestedVersion -ne "latest" -and $RequestedVersion -notmatch "^v?[A-Za-z0-9][A-Za-z0-9._-]*$") {
    throw "Requested release version contains unsupported characters."
  }
}

function Get-ReleaseMetadata {
  param(
    [string]$Owner,
    [string]$Name,
    [string]$RequestedVersion
  )

  $normalizedVersion = Normalize-Version -RawVersion $RequestedVersion
  $endpoint = if ($normalizedVersion -eq "latest") {
    "https://api.github.com/repos/$Owner/$Name/releases/latest"
  } else {
    "https://api.github.com/repos/$Owner/$Name/releases/tags/$normalizedVersion"
  }
  Write-Step "Fetching release metadata from $endpoint"
  return Invoke-RestMethod -Headers (Get-GitHubHeaders) -Uri $endpoint
}

function Get-ReleasePageUri {
  param(
    [string]$Owner,
    [string]$Name,
    [string]$RequestedVersion
  )

  $normalizedVersion = Normalize-Version -RawVersion $RequestedVersion
  if ($normalizedVersion -eq "latest") {
    return "https://github.com/$Owner/$Name/releases/latest"
  }

  return "https://github.com/$Owner/$Name/releases/tag/$normalizedVersion"
}

function Resolve-ReleaseTagFromPage {
  param(
    [string]$Owner,
    [string]$Name,
    [string]$RequestedVersion
  )

  $pageUri = Get-ReleasePageUri -Owner $Owner -Name $Name -RequestedVersion $RequestedVersion
  Write-Step "Falling back to release page resolution via $pageUri"
  # 页面回退不需要令牌；避免把认证信息转发给任何页面重定向目标。
  $response = Invoke-WebRequest -Headers (Get-PublicGitHubHeaders) -MaximumRedirection 5 -Uri $pageUri
  $resolvedUri = $response.BaseResponse.ResponseUri.AbsoluteUri
  $ownerPattern = [Regex]::Escape($Owner)
  $namePattern = [Regex]::Escape($Name)
  if ($resolvedUri -match "^https://github\.com/$ownerPattern/$namePattern/releases/tag/(?<tag>v[A-Za-z0-9][A-Za-z0-9._-]*)$") {
    return $Matches["tag"]
  }

  throw "Failed to resolve release tag from GitHub release page."
}

function Get-ReleaseVersionNumberFromTag {
  param([string]$TagName)

  if ([string]::IsNullOrWhiteSpace($TagName)) {
    return ""
  }
  if ($TagName.StartsWith("v")) {
    return $TagName.Substring(1)
  }
  return $TagName
}

function Get-InstallPayloadKindFromRoot {
  param([string]$SourceRoot)

  if (Test-Path (Join-Path $SourceRoot "README-release-light.md") -PathType Leaf) {
    return "release-light"
  }
  return "source"
}

function Resolve-RemoteInstallPayloadPlan {
  param(
    [object]$Release,
    [string]$Owner,
    [string]$Name
  )

  return New-ReleaseLightPayloadPlan -Owner $Owner -Name $Name -TagName ([string]$Release.tag_name) -Release $Release
}

function Resolve-RemoteInstallPayloadPlanFromTag {
  param(
    [string]$Owner,
    [string]$Name,
    [string]$TagName,
    [string]$RequestedVersion
  )

  return New-ReleaseLightPayloadPlan -Owner $Owner -Name $Name -TagName $TagName -RequestedVersion $RequestedVersion
}

function New-ReleaseLightPayloadPlan {
  param(
    [string]$Owner,
    [string]$Name,
    [string]$TagName,
    [object]$Release,
    [string]$RequestedVersion
  )

  Assert-GitHubRepositoryIdentity -Owner $Owner -Name $Name -RequestedVersion (Normalize-Version -RawVersion $RequestedVersion)

  $versionNumber = Get-ReleaseVersionNumberFromTag -TagName $TagName
  if ([string]::IsNullOrWhiteSpace($versionNumber) -or $versionNumber -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]*$") {
    throw "Failed to resolve a safe release version number from tag."
  }

  $archiveName = "star-sanctuary-dist-v$versionNumber.zip"
  $manifestName = "star-sanctuary-dist-v$versionNumber.manifest.json"
  $sha256Name = "star-sanctuary-dist-v$versionNumber.sha256"

  if ($Release) {
    $assets = @{}
    foreach ($asset in @($Release.assets)) {
      $assetName = [string]$asset.name
      if (-not [string]::IsNullOrWhiteSpace($assetName)) {
        $assets[$assetName] = $asset
      }
    }

    $requiredNames = @($archiveName, $manifestName, $sha256Name)
    foreach ($requiredName in $requiredNames) {
      if (-not $assets.ContainsKey($requiredName) -or [string]::IsNullOrWhiteSpace([string]$assets[$requiredName].browser_download_url)) {
        throw "The selected release is missing required verified release-light asset: $requiredName"
      }
    }

    $archiveSize = [Int64]$assets[$archiveName].size
    if ($archiveSize -le 0 -or $archiveSize -gt $MaxReleaseArchiveBytes) {
      throw "The release-light archive size is outside the installer limit."
    }

    return @{
      kind = "release-light"
      sourceType = "github-release-light"
      archiveName = $archiveName
      archiveUrl = [string]$assets[$archiveName].browser_download_url
      archiveExpectedSize = $archiveSize
      archiveApiDigest = [string]$assets[$archiveName].digest
      manifestUrl = [string]$assets[$manifestName].browser_download_url
      sha256Url = [string]$assets[$sha256Name].browser_download_url
      downloadLabel = "verified GitHub release-light archive"
      extractLabel = "verified release-light archive"
    }
  }

  $normalizedVersion = Normalize-Version -RawVersion $RequestedVersion
  $assetBaseUrl = if ($normalizedVersion -eq "latest") {
    "https://github.com/$Owner/$Name/releases/latest/download/"
  } else {
    "https://github.com/$Owner/$Name/releases/download/$TagName/"
  }

  return @{
    kind = "release-light"
    sourceType = "github-release-light"
    archiveName = $archiveName
    archiveUrl = "$assetBaseUrl$archiveName"
    archiveExpectedSize = $null
    archiveApiDigest = ""
    manifestUrl = "$assetBaseUrl$manifestName"
    sha256Url = "$assetBaseUrl$sha256Name"
    downloadLabel = "verified GitHub release-light archive"
    extractLabel = "verified release-light archive"
  }
}

function Invoke-TrustedPayloadDownload {
  param(
    [string]$Uri,
    [string]$OutputPath,
    [Int64]$MaximumBytes,
    [string]$Label
  )

  if ($MaximumBytes -le 0) {
    throw "Invalid download limit for $Label."
  }

  # 逐跳检查 GitHub 下载重定向，避免将令牌或归档内容交给任意 Host。
  $nodeScript = @'
const fs = require("node:fs");
const https = require("node:https");
const { URL } = require("node:url");

const args = process.argv.slice(1);
if (args[0] === "-") args.shift();
const [sourceUrl, outputPath, maxBytesRaw] = args;
const maxBytes = Number(maxBytesRaw);
const allowedHosts = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const maxRedirects = 5;
const requestTimeoutMs = 120_000;

function fail(message) {
  throw new Error(message);
}

function assertTrustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    fail("release download URL is outside the trusted HTTPS host allowlist");
  }
  return url;
}

function headersFor(url) {
  const headers = {
    "User-Agent": "Star-Sanctuary-Installer",
    "Accept": "application/octet-stream",
  };
  const host = url.hostname.toLowerCase();
  if (process.env.GITHUB_TOKEN && (host === "github.com" || host === "api.github.com")) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function request(url, redirectCount, partialPath) {
  const current = assertTrustedUrl(url);
  return new Promise((resolve, reject) => {
    const req = https.request(current, { method: "GET", headers: headersFor(current) }, (res) => {
      const status = Number(res.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location;
        res.resume();
        if (!location) return reject(new Error("release download redirect did not include a location"));
        if (redirectCount >= maxRedirects) return reject(new Error("release download exceeded redirect limit"));
        return resolve(request(new URL(location, current).toString(), redirectCount + 1, partialPath));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`release download returned HTTP ${status}`));
      }

      const declaredBytes = Number(res.headers["content-length"]);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        res.resume();
        return reject(new Error("release download exceeds configured byte limit"));
      }

      let bytes = 0;
      let settled = false;
      const output = fs.createWriteStream(partialPath, { flags: "w" });
      const failOnce = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        reject(error);
      };

      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          res.destroy(new Error("release download exceeds configured byte limit"));
        }
      });
      res.on("error", failOnce);
      output.on("error", failOnce);
      output.on("finish", () => {
        if (settled) return;
        settled = true;
        output.close((error) => {
          if (error) return reject(error);
          try {
            fs.renameSync(partialPath, outputPath);
            resolve(bytes);
          } catch (renameError) {
            reject(renameError);
          }
        });
      });
      res.pipe(output);
    });
    req.setTimeout(requestTimeoutMs, () => req.destroy(new Error("release download timed out")));
    req.on("error", reject);
    req.end();
  });
}

if (!sourceUrl || !outputPath || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
  fail("invalid trusted release download arguments");
}

const partialPath = `${outputPath}.part`;
fs.rmSync(partialPath, { force: true });
request(sourceUrl, 0, partialPath)
  .then((bytes) => process.stdout.write(String(bytes)))
  .catch((error) => {
    fs.rmSync(partialPath, { force: true });
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
'@

  $null = & node -e $nodeScript $Uri $OutputPath ([string]$MaximumBytes)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $OutputPath -PathType Leaf)) {
    throw "Failed to download $Label through the trusted release transport."
  }
}

function Get-VerifiedReleaseIdentity {
  param(
    [string]$ManifestPath,
    [string]$ChecksumPath,
    [string]$ArchiveName,
    [string]$ExpectedVersion
  )

  # `.sha256` 与 manifest 互相校验；签名/attestation 的独立信任根仍由后续发行任务提供。
  $nodeScript = @'
const crypto = require("node:crypto");
const fs = require("node:fs");

const args = process.argv.slice(1);
if (args[0] === "-") args.shift();
const [manifestPath, checksumPath, archiveName, expectedVersion, maxArchiveBytesRaw, maxEntriesRaw, maxUnpackedBytesRaw] = args;
const maxArchiveBytes = Number(maxArchiveBytesRaw);
const maxEntries = Number(maxEntriesRaw);
const maxUnpackedBytes = Number(maxUnpackedBytesRaw);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const rootName = `star-sanctuary-dist-v${expectedVersion}`;
const manifestName = `${rootName}.manifest.json`;
const expectedNames = new Set([`${rootName}.zip`, `${rootName}.tar.gz`, manifestName]);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert(manifest && typeof manifest === "object", "release manifest must be an object");
assert(manifest.schemaVersion === 1, "unsupported release manifest schema");
assert(manifest.product === "star-sanctuary" && manifest.version === expectedVersion, "release manifest identity mismatch");
assert(manifest.releaseKind === "light" && manifest.currentInstallerInput === "release-light-archive", "release manifest is not an installer payload");
assert(manifest.packageRoot === rootName, "release manifest package root mismatch");

const checksums = new Map();
for (const line of fs.readFileSync(checksumPath, "utf8").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  const match = /^([a-f0-9]{64})\s+([A-Za-z0-9._-]+)$/i.exec(line);
  assert(match, "invalid release checksum entry");
  const [, hash, name] = match;
  assert(expectedNames.has(name) && !checksums.has(name), "unexpected or duplicate release checksum entry");
  checksums.set(name, hash.toLowerCase());
}
assert(checksums.size === expectedNames.size, "release checksum file is incomplete");
assert(checksums.get(manifestName) === sha256File(manifestPath), "release manifest checksum mismatch");

const archive = Array.isArray(manifest.archives)
  ? manifest.archives.find((item) => item && item.fileName === archiveName)
  : undefined;
assert(archive && archive.format === "zip", "release manifest archive entry is missing or invalid");
assert(typeof archive.sha256 === "string" && /^[a-f0-9]{64}$/i.test(archive.sha256), "release manifest archive hash is invalid");
assert(Number.isSafeInteger(archive.size) && archive.size > 0 && archive.size <= maxArchiveBytes, "release manifest archive size is outside the installer limit");
assert(checksums.get(archiveName) === archive.sha256.toLowerCase(), "release manifest and checksum archive hashes disagree");

const content = manifest.content;
assert(content && Number.isSafeInteger(content.fileCount) && content.fileCount >= 0 && content.fileCount <= maxEntries, "release manifest file count is outside the installer limit");
assert(Number.isSafeInteger(content.totalBytes) && content.totalBytes >= 0 && content.totalBytes <= maxUnpackedBytes, "release manifest unpacked size is outside the installer limit");
process.stdout.write(JSON.stringify({
  packageRoot: rootName,
  archiveSha256: archive.sha256.toLowerCase(),
  archiveSize: archive.size,
  contentFileCount: content.fileCount,
  contentTotalBytes: content.totalBytes,
}));
'@

  $rawIdentity = (& node -e $nodeScript $ManifestPath $ChecksumPath $ArchiveName $ExpectedVersion ([string]$MaxReleaseArchiveBytes) ([string]$MaxReleaseArchiveEntries) ([string]$MaxReleaseArchiveUnpackedBytes)) -join ""
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rawIdentity)) {
    throw "Release identity validation failed."
  }

  try {
    return $rawIdentity | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Release identity validation returned invalid data."
  }
}

function Assert-SafeReleaseArchive {
  param(
    [string]$ArchivePath,
    [string]$ExtractionRoot,
    [string]$ExpectedRoot,
    [Int64]$ExpectedFileCount,
    [Int64]$ExpectedUnpackedBytes
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $rootPath = [System.IO.Path]::GetFullPath($ExtractionRoot)
  $rootPrefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar
  $seenEntries = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  [Int64]$entryCount = 0
  [Int64]$fileCount = 0
  [Int64]$unpackedBytes = 0
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)

  try {
    foreach ($entry in $archive.Entries) {
      $entryCount += 1
      if ($entryCount -gt $MaxReleaseArchiveEntries) {
        throw "Release archive contains too many entries."
      }

      $rawName = [string]$entry.FullName
      if ([string]::IsNullOrWhiteSpace($rawName)) {
        throw "Release archive contains an unsafe entry path."
      }

      # Compress-Archive 在 Windows 上写入反斜杠；统一后再做一次 canonical containment 检查。
      $normalizedName = $rawName.Replace("\", "/").TrimEnd("/")
      $isDirectory = $rawName.EndsWith("/") -or $rawName.EndsWith("\")
      if ($normalizedName -notmatch "^[A-Za-z0-9._/-]+$" -or $normalizedName.StartsWith("/") -or $normalizedName -match "(^|/)(\.|\.\.)(/|$)" -or $normalizedName.Contains("//")) {
        throw "Release archive contains an unsafe entry path."
      }
      if ($normalizedName -ne $ExpectedRoot -and -not $normalizedName.StartsWith("$ExpectedRoot/", [System.StringComparison]::Ordinal)) {
        throw "Release archive entry is outside the declared package root."
      }
      if (-not $seenEntries.Add($normalizedName)) {
        throw "Release archive contains a duplicate entry path."
      }

      $relativePath = $normalizedName.Replace("/", [string][System.IO.Path]::DirectorySeparatorChar)
      $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))
      if (-not $candidatePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release archive entry escapes the extraction root."
      }

      $unixFileType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($unixFileType -eq 0xA000) {
        throw "Release archive symlink entries are not allowed."
      }
      if ($isDirectory) {
        continue
      }

      [Int64]$entryBytes = $entry.Length
      if ($entryBytes -gt $MaxReleaseArchiveEntryBytes -or $unpackedBytes -gt ($MaxReleaseArchiveUnpackedBytes - $entryBytes)) {
        throw "Release archive exceeds the configured unpacked byte limit."
      }
      $fileCount += 1
      $unpackedBytes += $entryBytes
    }
  } finally {
    $archive.Dispose()
  }

  if ($fileCount -ne $ExpectedFileCount -or $unpackedBytes -ne $ExpectedUnpackedBytes) {
    throw "Release archive content does not match its manifest."
  }
}

function Ensure-Command {
  param([string]$Name, [string]$Message)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw $Message
  }
}

function Ensure-NodeRuntime {
  Ensure-Command -Name "node" -Message "Node.js was not found. Install Node.js v22.12+ first."
  Ensure-Command -Name "corepack" -Message "corepack was not found. Install a Node.js distribution that includes corepack."

  $rawVersion = (& node -p "process.versions.node").Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rawVersion)) {
    throw "Failed to detect Node.js version."
  }

  $parts = $rawVersion.Split(".")
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  if ($major -lt $MinimumNodeMajor -or ($major -eq $MinimumNodeMajor -and $minor -lt $MinimumNodeMinor)) {
    throw "Node.js v$rawVersion is too old. Install Node.js v22.12+ first."
  }

  Write-Step "Detected Node.js v$rawVersion"
}

function New-SourceJunction {
  param(
    [string]$LinkPath,
    [string]$TargetPath
  )

  $null = New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath
}

function Copy-SourceTree {
  param(
    [string]$SourceRoot,
    [string]$TargetRoot
  )

  New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
  foreach ($entry in (Get-ChildItem -LiteralPath $SourceRoot -Force)) {
    Copy-Item -LiteralPath $entry.FullName -Destination $TargetRoot -Recurse -Force
  }
}

function Invoke-TestFailPoint {
  param([string]$Point)

  if ($env:STAR_SANCTUARY_INSTALL_TEST_FAIL_AT -eq $Point) {
    throw "Installer test failpoint triggered at $Point."
  }
}

function Get-RequiredPackageManager {
  param([string]$SourceRoot)
  $packageManager = (& node -e "const fs=require('fs');const path=require('path');const pkg=JSON.parse(fs.readFileSync(path.join(process.argv[1],'package.json'),'utf8'));process.stdout.write(pkg.packageManager || 'pnpm@10');" $SourceRoot)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($packageManager)) {
    throw "Failed to resolve packageManager from package.json."
  }

  return $packageManager.Trim()
}

function Invoke-InSourceRoot {
  param(
    [string]$SourceRoot,
    [scriptblock]$Action
  )

  Push-Location $SourceRoot
  try {
    & $Action
  } finally {
    Pop-Location
  }
}

function Write-File {
  param(
    [string]$Path,
    [string]$Content
  )

  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Backup-InstallRootFiles {
  param(
    [string]$Root,
    [string]$BackupDir,
    [string[]]$Files
  )

  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  foreach ($file in $Files) {
    $sourcePath = Join-Path $Root $file
    if (Test-Path $sourcePath) {
      $targetPath = Join-Path $BackupDir $file
      $targetDir = Split-Path -Parent $targetPath
      if (-not [string]::IsNullOrWhiteSpace($targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
      }
      Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    }
  }
}

function Restore-InstallRootFiles {
  param(
    [string]$Root,
    [string]$BackupDir,
    [string[]]$Files
  )

  foreach ($file in $Files) {
    $targetPath = Join-Path $Root $file
    $backupPath = Join-Path $BackupDir $file
    if (Test-Path $backupPath) {
      Copy-Item -LiteralPath $backupPath -Destination $targetPath -Force
    } elseif (Test-Path $targetPath) {
      Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Write-WindowsWrappers {
  param([string]$Root)

  $startBat = @"
@echo off
setlocal
set "INSTALL_ROOT=%~dp0"
set "FIRST_START_NOTICE=%INSTALL_ROOT%$FirstStartNoticeFileName"
set "STAR_SANCTUARY_RUNTIME_MODE=source"
set "BELLDANDY_RUNTIME_MODE=source"
set "STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current"
set "BELLDANDY_RUNTIME_DIR=%INSTALL_ROOT%current"
if exist "%FIRST_START_NOTICE%" (
echo [Star Sanctuary Launcher] Post-install note:
type "%FIRST_START_NOTICE%"
del /f /q "%FIRST_START_NOTICE%" >nul 2>nul
echo.
)
if not defined AUTO_OPEN_BROWSER set "AUTO_OPEN_BROWSER=true"
if /I "%CI%"=="true" set "AUTO_OPEN_BROWSER=false"
echo [Star Sanctuary Launcher] Starting Gateway...
echo [Star Sanctuary Launcher] WebChat: http://localhost:28889
echo.
call node "%INSTALL_ROOT%current\packages\belldandy-core\dist\bin\bdd.js" start %*
exit /b %ERRORLEVEL%
"@
  Write-File -Path (Join-Path $Root "start.bat") -Content ($startBat.TrimStart("`r", "`n") + "`r`n")

  $startPs1 = @'
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$noticePath = Join-Path $scriptDir 'first-start-notice.txt'
$env:STAR_SANCTUARY_RUNTIME_MODE = 'source'
$env:BELLDANDY_RUNTIME_MODE = 'source'
$env:STAR_SANCTUARY_RUNTIME_DIR = Join-Path $scriptDir 'current'
$env:BELLDANDY_RUNTIME_DIR = $env:STAR_SANCTUARY_RUNTIME_DIR
if (Test-Path $noticePath) {
  Write-Host '[Star Sanctuary Launcher] Post-install note:'
  Get-Content -LiteralPath $noticePath
  Remove-Item -LiteralPath $noticePath -Force -ErrorAction SilentlyContinue
  Write-Host ''
}
if ([string]::IsNullOrWhiteSpace($env:AUTO_OPEN_BROWSER)) {
  $env:AUTO_OPEN_BROWSER = if ($env:CI -eq 'true') { 'false' } else { 'true' }
} elseif ($env:CI -eq 'true') {
  $env:AUTO_OPEN_BROWSER = 'false'
}
Write-Host '[Star Sanctuary Launcher] Starting Gateway...'
Write-Host '[Star Sanctuary Launcher] WebChat: http://localhost:28889'
Write-Host ''
& node (Join-Path $scriptDir 'current\packages\belldandy-core\dist\bin\bdd.js') 'start' @args
'@
  Write-File -Path (Join-Path $Root "start.ps1") -Content ($startPs1.TrimStart("`r", "`n") + "`r`n")

  $bddCmd = @"
@echo off
setlocal
set "INSTALL_ROOT=%~dp0"
set "STAR_SANCTUARY_RUNTIME_MODE=source"
set "BELLDANDY_RUNTIME_MODE=source"
set "STAR_SANCTUARY_RUNTIME_DIR=%INSTALL_ROOT%current"
set "BELLDANDY_RUNTIME_DIR=%INSTALL_ROOT%current"
call node "%INSTALL_ROOT%current\packages\belldandy-core\dist\bin\bdd.js" %*
"@
  Write-File -Path (Join-Path $Root "bdd.cmd") -Content ($bddCmd.TrimStart("`r", "`n") + "`r`n")
}

function Write-InstallMetadata {
  param(
    [string]$Root,
    [string]$TagName,
    [string]$VersionName,
    [string]$Owner,
    [string]$Name,
    [string]$SourceType
  )

  $payload = @{
    productName = "Star Sanctuary"
    tag = $TagName
    version = $VersionName
    source = @{
      type = $SourceType
      owner = $Owner
      repo = $Name
    }
    installedAt = [DateTimeOffset]::UtcNow.ToString("o")
    currentDir = "current"
    entrypoints = @{
      startBat = "start.bat"
      startPs1 = "start.ps1"
      bddCmd = "bdd.cmd"
    }
    notices = @{
      firstStart = $FirstStartNoticeFileName
    }
  }

  Write-File -Path (Join-Path $Root "install-info.json") -Content (($payload | ConvertTo-Json -Depth 5) + "`n")
}

function Write-FirstStartNotice {
  param(
    [string]$Root,
    [string[]]$Lines
  )

  $noticePath = Join-Path $Root $FirstStartNoticeFileName
  $normalizedLines = @($Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($normalizedLines.Count -eq 0) {
    Remove-Item -LiteralPath $noticePath -Force -ErrorAction SilentlyContinue
    return
  }

  Write-File -Path $noticePath -Content (($normalizedLines -join "`r`n") + "`r`n")
}

function Resolve-InstallerStateDir {
  $homeDir = $HOME
  if ([string]::IsNullOrWhiteSpace($homeDir)) {
    $homeDir = $env:USERPROFILE
  }
  if ([string]::IsNullOrWhiteSpace($homeDir)) {
    throw "Unable to resolve home directory for state dir."
  }

  function Resolve-ExplicitStateDir {
    param(
      [string]$RawPath,
      [string]$ResolvedHomeDir
    )

    if ([string]::IsNullOrWhiteSpace($RawPath)) {
      return $null
    }

    $trimmed = $RawPath.Trim()
    if ($trimmed -eq "~") {
      return [System.IO.Path]::GetFullPath($ResolvedHomeDir)
    }
    if ($trimmed.StartsWith("~/") -or $trimmed.StartsWith('~\')) {
      return [System.IO.Path]::GetFullPath((Join-Path $ResolvedHomeDir $trimmed.Substring(2)))
    }
    return [System.IO.Path]::GetFullPath($trimmed)
  }

  if (-not [string]::IsNullOrWhiteSpace($env:BELLDANDY_STATE_DIR_WINDOWS)) {
    return Resolve-ExplicitStateDir -RawPath $env:BELLDANDY_STATE_DIR_WINDOWS -ResolvedHomeDir $homeDir
  }
  if (-not [string]::IsNullOrWhiteSpace($env:BELLDANDY_STATE_DIR)) {
    return Resolve-ExplicitStateDir -RawPath $env:BELLDANDY_STATE_DIR -ResolvedHomeDir $homeDir
  }

  $preferred = Join-Path $homeDir ".star_sanctuary"
  if (Test-Path $preferred) {
    return [System.IO.Path]::GetFullPath($preferred)
  }

  $legacy = Join-Path $homeDir ".belldandy"
  if (Test-Path $legacy) {
    return [System.IO.Path]::GetFullPath($legacy)
  }

  return [System.IO.Path]::GetFullPath($preferred)
}

function Get-SetupPlan {
  param(
    [string]$InstallRoot,
    [string]$StateDir,
    [switch]$NoSetup,
    [switch]$ForceSetup
  )

  $envLocalPath = Join-Path $StateDir ".env.local"
  if ($NoSetup) {
    return @{
      ShouldRun = $false
      StepMessage = "Skipping bdd setup (-NoSetup)"
      Summary = "skipped by -NoSetup; run $InstallRoot\bdd.cmd setup when you are ready to refresh config"
      FirstStartSummary = $null
      FirstStartNotice = @()
    }
  }

  if ($ForceSetup) {
    return @{
      ShouldRun = $true
      StepMessage = "Launching bdd setup (-ForceSetup)"
      Summary = "re-ran during install (-ForceSetup)"
      FirstStartSummary = $null
      FirstStartNotice = @()
    }
  }

  if (Test-Path $envLocalPath -PathType Leaf) {
    return @{
      ShouldRun = $false
      StepMessage = "Detected existing .env.local at $envLocalPath; skipping bdd setup for upgrade handoff"
      Summary = "skipped by default because existing .env.local was preserved; run $InstallRoot\bdd.cmd setup or rerun installer with -ForceSetup to refresh config"
      FirstStartSummary = "will reuse preserved .env.local; run $InstallRoot\bdd.cmd setup later if provider/channel/auth config needs refresh"
      FirstStartNotice = @(
        "[NOTICE] Upgrade preserved your existing .env.local and skipped bdd setup.",
        "[NOTICE] This first start will reuse your current config.",
        "[NOTICE] If provider, channel, or auth settings need refresh, run: $InstallRoot\bdd.cmd setup",
        "[NOTICE] Or rerun the installer with -ForceSetup."
      )
    }
  }

  return @{
    ShouldRun = $true
    StepMessage = "Launching bdd setup"
    Summary = "completed during install"
    FirstStartSummary = $null
    FirstStartNotice = @()
  }
}

function New-DesktopShortcut {
  param([string]$InstallRoot)

  $desktopDir = [Environment]::GetFolderPath("Desktop")
  if ([string]::IsNullOrWhiteSpace($desktopDir) -or -not (Test-Path $desktopDir)) {
    Write-Step "Desktop directory was not found. Skipping desktop shortcut."
    return
  }

  $shortcutPath = Join-Path $desktopDir "Star Sanctuary.lnk"
  $targetPath = Join-Path $InstallRoot "start.bat"
  $workingDir = $InstallRoot
  $iconPath = Join-Path $InstallRoot "current\apps\web\public\logo06-256.ico"

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $workingDir
  $shortcut.Description = "Start Star Sanctuary"
  if (Test-Path $iconPath -PathType Leaf) {
    $shortcut.IconLocation = $iconPath
  } else {
    Write-Step "Shortcut icon was not found at $iconPath. Creating desktop shortcut without a custom icon."
  }
  $shortcut.Save()

  Write-Step "Desktop shortcut created at $shortcutPath"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw "LOCALAPPDATA is not available. Pass -InstallDir explicitly."
  }
  $InstallDir = Join-Path $env:LOCALAPPDATA "StarSanctuary"
}

if ($NoSetup -and $ForceSetup) {
  throw "-NoSetup and -ForceSetup cannot be used together."
}

$installRoot = [System.IO.Path]::GetFullPath($InstallDir)
$currentRoot = Join-Path $installRoot "current"
$backupRoot = Join-Path $installRoot "backups"
$stagingBaseDir = Join-Path ([System.IO.Path]::GetDirectoryName($installRoot)) ".install-staging"
$tempRoot = New-TempDirectory -BaseDir $stagingBaseDir
$managedInstallFiles = @("start.bat", "start.ps1", "bdd.cmd", "install-info.json", $FirstStartNoticeFileName)
$installRootFilesBackupDir = Join-Path $tempRoot "install-root-files-backup"
$backupPath = $null
$installSucceeded = $false
$setupPlan = $null
$resolvedStateDir = Resolve-InstallerStateDir

try {
  Ensure-NodeRuntime
  $localSourceRoot = $null
  $release = $null
  $resolvedTag = $null
  $versionName = $null
  $installPayloadKind = $null
  $installSourceType = $null
  $remotePayloadPlan = $null
  $normalizedVersion = Normalize-Version -RawVersion $Version

  if (-not [string]::IsNullOrWhiteSpace($SourceDir)) {
    $localSourceRoot = [System.IO.Path]::GetFullPath($SourceDir)
    if (-not (Test-Path $localSourceRoot -PathType Container)) {
      throw "SourceDir was not found: $localSourceRoot"
    }

    $installPayloadKind = Get-InstallPayloadKindFromRoot -SourceRoot $localSourceRoot
    $installSourceType = if ($installPayloadKind -eq "release-light") { "local-release-light" } else { "local-source" }
    $resolvedTag = if ($normalizedVersion -eq "latest") { $installSourceType } else { $normalizedVersion }
    $versionName = $resolvedTag
    Write-Step "Using local $installPayloadKind override from $localSourceRoot"
  } else {
    Assert-GitHubRepositoryIdentity -Owner $RepoOwner -Name $RepoName -RequestedVersion $normalizedVersion
    try {
      $release = Get-ReleaseMetadata -Owner $RepoOwner -Name $RepoName -RequestedVersion $Version
    } catch {
      Write-Step "GitHub API release metadata fetch failed; falling back to GitHub release page resolution. Set GITHUB_TOKEN to raise API rate limits when available."
    }

    if ($release) {
      $resolvedTag = [string]$release.tag_name
      if ([string]::IsNullOrWhiteSpace($resolvedTag)) {
        throw "Failed to resolve release tag from GitHub metadata."
      }

      $versionName = (([string]$release.name).Trim())
      if ([string]::IsNullOrWhiteSpace($versionName)) {
        $versionName = $resolvedTag
      }
      $remotePayloadPlan = Resolve-RemoteInstallPayloadPlan -Release $release -Owner $RepoOwner -Name $RepoName
    } else {
      $resolvedTag = Resolve-ReleaseTagFromPage -Owner $RepoOwner -Name $RepoName -RequestedVersion $Version
      $versionName = $resolvedTag
      $remotePayloadPlan = Resolve-RemoteInstallPayloadPlanFromTag -Owner $RepoOwner -Name $RepoName -TagName $resolvedTag -RequestedVersion $Version
    }

    $installPayloadKind = [string]$remotePayloadPlan.kind
    $installSourceType = [string]$remotePayloadPlan.sourceType
  }

  Write-Step "Installing Star Sanctuary $resolvedTag into $installRoot"

  $sourceRoot = $null
  if ($localSourceRoot) {
    $sourceRoot = Get-Item -LiteralPath $localSourceRoot
  } else {
    $archivePath = Join-Path $tempRoot ([string]$remotePayloadPlan.archiveName)
    $manifestPath = Join-Path $tempRoot "release-light.manifest.json"
    $checksumPath = Join-Path $tempRoot "release-light.sha256"
    $extractRoot = Join-Path $tempRoot "extract"
    New-Item -ItemType Directory -Path $extractRoot | Out-Null

    Write-Step "Downloading release identity metadata"
    Invoke-TrustedPayloadDownload -Uri ([string]$remotePayloadPlan.manifestUrl) -OutputPath $manifestPath -MaximumBytes $MaxReleaseMetadataBytes -Label "release manifest"
    Invoke-TrustedPayloadDownload -Uri ([string]$remotePayloadPlan.sha256Url) -OutputPath $checksumPath -MaximumBytes $MaxReleaseMetadataBytes -Label "release checksum"
    $releaseIdentity = Get-VerifiedReleaseIdentity -ManifestPath $manifestPath -ChecksumPath $checksumPath -ArchiveName ([string]$remotePayloadPlan.archiveName) -ExpectedVersion (Get-ReleaseVersionNumberFromTag -TagName $resolvedTag)

    if ($null -ne $remotePayloadPlan.archiveExpectedSize -and [Int64]$remotePayloadPlan.archiveExpectedSize -ne [Int64]$releaseIdentity.archiveSize) {
      throw "Release metadata and manifest archive sizes disagree."
    }
    $apiDigest = [string]$remotePayloadPlan.archiveApiDigest
    if (-not [string]::IsNullOrWhiteSpace($apiDigest)) {
      if ($apiDigest -notmatch "^sha256:[a-f0-9]{64}$" -or $apiDigest.Substring(7).ToLowerInvariant() -ne [string]$releaseIdentity.archiveSha256) {
        throw "Release metadata and manifest archive hashes disagree."
      }
    }

    Write-Step "Downloading $($remotePayloadPlan.downloadLabel)"
    Invoke-TrustedPayloadDownload -Uri ([string]$remotePayloadPlan.archiveUrl) -OutputPath $archivePath -MaximumBytes $MaxReleaseArchiveBytes -Label "release archive"
    $archiveItem = Get-Item -LiteralPath $archivePath
    if ([Int64]$archiveItem.Length -ne [Int64]$releaseIdentity.archiveSize) {
      throw "Release archive size does not match its manifest."
    }
    $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ($archiveHash -ne [string]$releaseIdentity.archiveSha256) {
      throw "Release archive hash does not match its manifest."
    }

    Write-Step "Scanning verified archive entries before extracting"
    Assert-SafeReleaseArchive -ArchivePath $archivePath -ExtractionRoot $extractRoot -ExpectedRoot ([string]$releaseIdentity.packageRoot) -ExpectedFileCount ([Int64]$releaseIdentity.contentFileCount) -ExpectedUnpackedBytes ([Int64]$releaseIdentity.contentTotalBytes)

    Write-Step "Extracting $($remotePayloadPlan.extractLabel)"
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force

    $sourceRootPath = Join-Path $extractRoot ([string]$releaseIdentity.packageRoot)
    if (-not (Test-Path $sourceRootPath -PathType Container)) {
      throw "Failed to locate the verified extracted package root."
    }
    $sourceRoot = Get-Item -LiteralPath $sourceRootPath
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  Backup-InstallRootFiles -Root $installRoot -BackupDir $installRootFilesBackupDir -Files $managedInstallFiles

  if (Test-Path $currentRoot) {
    $backupName = "current-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    $backupPath = Join-Path $backupRoot $backupName
    Write-Step "Backing up existing installation to $backupPath"
    Move-Item -LiteralPath $currentRoot -Destination $backupPath
    Invoke-TestFailPoint -Point "after_backup"
  }

  if ($localSourceRoot) {
    if ($SkipInstallBuild) {
      Write-Step "Promoting local source override into current/ via junction"
      New-SourceJunction -LinkPath $currentRoot -TargetPath $sourceRoot.FullName
    } else {
      Write-Step "Copying local source override into current/ for isolated install/build"
      Copy-SourceTree -SourceRoot $sourceRoot.FullName -TargetRoot $currentRoot
    }
  } else {
    Write-Step "Promoting extracted source tree into current/"
    Move-Item -LiteralPath $sourceRoot.FullName -Destination $currentRoot
  }
  Invoke-TestFailPoint -Point "after_promote"

  Invoke-TestFailPoint -Point "before_install_build"
  if (-not $SkipInstallBuild) {
    $packageManager = Get-RequiredPackageManager -SourceRoot $currentRoot

    Write-Step "Activating $packageManager via corepack"
    & corepack prepare $packageManager --activate
    if ($LASTEXITCODE -ne 0) {
      throw "corepack prepare $packageManager failed."
    }

    Invoke-InSourceRoot -SourceRoot $currentRoot -Action {
      if ($installPayloadKind -eq "release-light") {
        Write-Step "Installing production workspace dependencies from release-light package"
        & corepack pnpm install --prod --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
          throw "corepack pnpm install failed."
        }
      } else {
        Write-Step "Installing workspace dependencies"
        & corepack pnpm install
        if ($LASTEXITCODE -ne 0) {
          throw "corepack pnpm install failed."
        }

        Write-Step "Building workspace"
        & corepack pnpm build
        if ($LASTEXITCODE -ne 0) {
          throw "corepack pnpm build failed."
        }
      }
    }
  } else {
    Write-Step "Skipping dependency install/build (-SkipInstallBuild)"
  }

  Write-WindowsWrappers -Root $installRoot
  Write-InstallMetadata -Root $installRoot -TagName $resolvedTag -VersionName $versionName -Owner $RepoOwner -Name $RepoName -SourceType $installSourceType

  if (-not $NoDesktopShortcut) {
    New-DesktopShortcut -InstallRoot $installRoot
  }

  $setupPlan = Get-SetupPlan -InstallRoot $installRoot -StateDir $resolvedStateDir -NoSetup:$NoSetup -ForceSetup:$ForceSetup
  if ($setupPlan.ShouldRun) {
    Write-Step $setupPlan.StepMessage
    Invoke-TestFailPoint -Point "before_setup"
    & (Join-Path $installRoot "bdd.cmd") "setup"
    if ($LASTEXITCODE -ne 0) {
      throw "'bdd setup' exited with code $LASTEXITCODE."
    }
  } else {
    Write-Step $setupPlan.StepMessage
  }
  Write-FirstStartNotice -Root $installRoot -Lines $setupPlan.FirstStartNotice

  Write-Step "Install complete."
  Write-Host "  Install root: $installRoot"
  Write-Host "  Start:        $installRoot\start.bat"
  Write-Host "  CLI:          $installRoot\bdd.cmd"
  if ($setupPlan) {
    Write-Host "  Setup:        $($setupPlan.Summary)"
    if ($setupPlan.FirstStartSummary) {
      Write-Host "  First start:  $($setupPlan.FirstStartSummary)"
    }
  }
  $installSucceeded = $true
} catch {
  Write-InstallHintBlock -Message $_.Exception.Message
  if (-not $installSucceeded) {
    if (Test-Path $currentRoot) {
      Remove-Item -LiteralPath $currentRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($backupPath -and (Test-Path $backupPath)) {
      Move-Item -LiteralPath $backupPath -Destination $currentRoot -Force
    }
    Restore-InstallRootFiles -Root $installRoot -BackupDir $installRootFilesBackupDir -Files $managedInstallFiles
  }
  throw
} finally {
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
