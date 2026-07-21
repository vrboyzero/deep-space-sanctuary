import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { afterEach, expect, test } from "vitest";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installPs1Path = path.join(workspaceRoot, "install.ps1");
const installShPath = path.join(workspaceRoot, "install.sh");
const cleanupPaths: string[] = [];

type ArchiveEntry = {
  name: string;
  data?: string;
  directory?: boolean;
};

afterEach(() => {
  for (const targetPath of cleanupPaths.splice(0)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

function createSandbox(): string {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), "star-sanctuary-r04-"));
  cleanupPaths.push(targetPath);
  return targetPath;
}

function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8").replaceAll("\r\n", "\n");
}

function extractShellArchiveValidator(): string {
  return extractShellNodeScript("validate_release_archive() {");
}

function extractShellNodeScript(functionMarker: string): string {
  const source = readNormalized(installShPath);
  const functionStart = source.indexOf(functionMarker);
  const heredocStart = source.indexOf("<<'NODE'", functionStart);
  const scriptStart = source.indexOf("\n", heredocStart) + 1;
  const scriptEnd = source.indexOf("\nNODE\n", scriptStart);

  if (functionStart < 0 || heredocStart < 0 || scriptStart <= heredocStart || scriptEnd < 0) {
    throw new Error(`Could not extract install.sh Node script for ${functionMarker}.`);
  }

  return source.slice(scriptStart, scriptEnd);
}

function extractPowerShellArchiveValidator(): string {
  return extractPowerShellNodeScript("function Assert-SafeReleaseArchive {", "\nfunction Ensure-Command");
}

function extractPowerShellNodeScript(functionMarker: string, endMarker: string): string {
  const source = readNormalized(installPs1Path);
  const functionStart = source.indexOf(functionMarker);
  const functionEnd = source.indexOf(endMarker, functionStart);

  if (functionStart < 0 || functionEnd < 0) {
    throw new Error(`Could not extract install.ps1 function for ${functionMarker}.`);
  }

  return source.slice(functionStart, functionEnd);
}

function extractPowerShellEmbeddedNodeScript(functionMarker: string): string {
  const source = readNormalized(installPs1Path);
  const functionStart = source.indexOf(functionMarker);
  const scriptStartMarker = "$nodeScript = @'\n";
  const scriptStart = source.indexOf(scriptStartMarker, functionStart) + scriptStartMarker.length;
  const scriptEnd = source.indexOf("\n'@", scriptStart);

  if (functionStart < 0 || scriptStart <= functionStart || scriptEnd < 0) {
    throw new Error(`Could not extract install.ps1 Node script for ${functionMarker}.`);
  }

  return source.slice(scriptStart, scriptEnd);
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  target.write(`${text}\0`, offset, length, "ascii");
}

function createTarHeader(name: string, type: "0" | "5", size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf-8");
  writeOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function writeTarGz(filePath: string, entries: ArchiveEntry[]): void {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "", "utf-8");
    const type = entry.directory ? "5" : "0";
    parts.push(createTarHeader(entry.name, type, data.length), data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  fs.writeFileSync(filePath, gzipSync(Buffer.concat(parts)));
}

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeStoredZip(filePath: string, entries: ArchiveEntry[]): void {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const entryName = entry.directory && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name;
    const name = Buffer.from(entryName, "utf-8");
    const data = Buffer.from(entry.data ?? "", "utf-8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0o100644 * 0x10000, 38);
    central.writeUInt32LE(localOffset, 42);

    localParts.push(local, name, data);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  fs.writeFileSync(filePath, Buffer.concat([...localParts, ...centralParts, end]));
}

function runShellArchiveValidator(params: {
  archivePath: string;
  expectedRoot: string;
  expectedFileCount: number;
  expectedTotalBytes: number;
  sandbox: string;
}) {
  const validatorPath = path.join(params.sandbox, "validate-release-archive.cjs");
  fs.writeFileSync(validatorPath, extractShellArchiveValidator(), "utf-8");
  return spawnSync(process.execPath, [
    validatorPath,
    params.archivePath,
    params.expectedRoot,
    String(params.expectedFileCount),
    String(params.expectedTotalBytes),
    "100",
    "1024",
    "4096",
  ], { encoding: "utf-8", windowsHide: true });
}

function runShellNodeScript(script: string, args: string[], sandbox: string, label: string) {
  const scriptPath = path.join(sandbox, `${label}.cjs`);
  fs.writeFileSync(scriptPath, script, "utf-8");
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf-8", windowsHide: true });
}

function runPowerShellNodeScript(script: string, args: string[]) {
  return spawnSync(process.execPath, ["-e", script, ...args], { encoding: "utf-8", windowsHide: true });
}

function writeMismatchedReleaseIdentity(params: {
  sandbox: string;
  archiveName: string;
  archiveFormat: "zip" | "tar.gz";
}) {
  const expectedVersion = "0.0.0";
  const packageRoot = `star-sanctuary-dist-v${expectedVersion}`;
  const manifestPath = path.join(params.sandbox, `${params.archiveFormat}.manifest.json`);
  const checksumPath = path.join(params.sandbox, `${params.archiveFormat}.sha256`);
  const manifestName = `${packageRoot}.manifest.json`;
  const manifest = {
    schemaVersion: 1,
    product: "star-sanctuary",
    version: expectedVersion,
    releaseKind: "light",
    currentInstallerInput: "release-light-archive",
    packageRoot,
    content: { fileCount: 0, totalBytes: 0 },
    archives: [{
      fileName: params.archiveName,
      format: params.archiveFormat,
      sha256: "0".repeat(64),
      size: 1,
    }],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf-8");
  const manifestHash = crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  fs.writeFileSync(checksumPath, [
    `${"1".repeat(64)}  ${packageRoot}.zip`,
    `${"2".repeat(64)}  ${packageRoot}.tar.gz`,
    `${manifestHash}  ${manifestName}`,
    "",
  ].join("\n"), "utf-8");
  return { manifestPath, checksumPath, expectedVersion };
}

function runPowerShellArchiveValidator(params: {
  archivePath: string;
  expectedRoot: string;
  expectedFileCount: number;
  expectedTotalBytes: number;
  sandbox: string;
}) {
  const validatorPath = path.join(params.sandbox, "validate-release-archive.ps1");
  const extractionRoot = path.join(params.sandbox, "extract");
  fs.writeFileSync(validatorPath, [
    "param([string]$ArchivePath, [string]$ExtractionRoot, [string]$ExpectedRoot, [Int64]$ExpectedFileCount, [Int64]$ExpectedUnpackedBytes)",
    "$ErrorActionPreference = 'Stop'",
    "$MaxReleaseArchiveEntries = 100",
    "$MaxReleaseArchiveEntryBytes = 1024",
    "$MaxReleaseArchiveUnpackedBytes = 4096",
    extractPowerShellArchiveValidator(),
    "Assert-SafeReleaseArchive -ArchivePath $ArchivePath -ExtractionRoot $ExtractionRoot -ExpectedRoot $ExpectedRoot -ExpectedFileCount $ExpectedFileCount -ExpectedUnpackedBytes $ExpectedUnpackedBytes",
  ].join("\r\n"), "utf-8");
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    validatorPath,
    params.archivePath,
    extractionRoot,
    params.expectedRoot,
    String(params.expectedFileCount),
    String(params.expectedTotalBytes),
  ], { encoding: "utf-8", windowsHide: true });
}

test("install.sh archive preflight rejects a file with child entries", () => {
  const sandbox = createSandbox();
  const expectedRoot = "star-sanctuary-dist-v0.0.0";
  const archivePath = path.join(sandbox, "conflicting.tar.gz");
  writeTarGz(archivePath, [
    { name: `${expectedRoot}/node`, data: "a" },
    { name: `${expectedRoot}/node/child`, data: "b" },
  ]);

  const result = runShellArchiveValidator({
    archivePath,
    expectedRoot,
    expectedFileCount: 2,
    expectedTotalBytes: 2,
    sandbox,
  });

  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toContain("parent file");
});

test("install.sh archive preflight rejects a file after child entries", () => {
  const sandbox = createSandbox();
  const expectedRoot = "star-sanctuary-dist-v0.0.0";
  const archivePath = path.join(sandbox, "reverse-conflicting.tar.gz");
  writeTarGz(archivePath, [
    { name: `${expectedRoot}/node/child`, data: "a" },
    { name: `${expectedRoot}/node`, data: "b" },
  ]);

  const result = runShellArchiveValidator({
    archivePath,
    expectedRoot,
    expectedFileCount: 2,
    expectedTotalBytes: 2,
    sandbox,
  });

  expect(result.status, result.stderr).not.toBe(0);
  expect(result.stderr).toContain("child entries");
});

test("install.sh archive preflight accepts an explicit directory with children", () => {
  const sandbox = createSandbox();
  const expectedRoot = "star-sanctuary-dist-v0.0.0";
  const archivePath = path.join(sandbox, "valid.tar.gz");
  writeTarGz(archivePath, [
    { name: `${expectedRoot}/`, directory: true },
    { name: `${expectedRoot}/node/`, directory: true },
    { name: `${expectedRoot}/node/child`, data: "a" },
  ]);

  const result = runShellArchiveValidator({
    archivePath,
    expectedRoot,
    expectedFileCount: 1,
    expectedTotalBytes: 1,
    sandbox,
  });

  expect(result.status, result.stderr).toBe(0);
});

test("install scripts reject an untrusted HTTPS download host before a request", () => {
  const sandbox = createSandbox();
  const outputPath = path.join(sandbox, "payload.bin");
  const args = ["https://example.com/release.zip", outputPath, "1024"];
  const shellResult = runShellNodeScript(
    extractShellNodeScript("download_trusted_payload() {"),
    args,
    sandbox,
    "download-trusted-payload",
  );
  const powerShellResult = runPowerShellNodeScript(
    extractPowerShellEmbeddedNodeScript("function Invoke-TrustedPayloadDownload {"),
    args,
  );

  expect(shellResult.status, shellResult.stderr).not.toBe(0);
  expect(powerShellResult.status, powerShellResult.stderr).not.toBe(0);
  expect(shellResult.stderr).toContain("trusted HTTPS host allowlist");
  expect(powerShellResult.stderr).toContain("trusted HTTPS host allowlist");
  expect(fs.existsSync(outputPath)).toBe(false);
});

test("install scripts reject a manifest and checksum archive hash mismatch", () => {
  const sandbox = createSandbox();
  const expectedVersion = "0.0.0";
  const packageRoot = `star-sanctuary-dist-v${expectedVersion}`;
  const zip = writeMismatchedReleaseIdentity({
    sandbox,
    archiveName: `${packageRoot}.zip`,
    archiveFormat: "zip",
  });
  const tarGz = writeMismatchedReleaseIdentity({
    sandbox,
    archiveName: `${packageRoot}.tar.gz`,
    archiveFormat: "tar.gz",
  });
  const powerShellResult = runPowerShellNodeScript(
    extractPowerShellEmbeddedNodeScript("function Get-VerifiedReleaseIdentity {"),
    [zip.manifestPath, zip.checksumPath, `${packageRoot}.zip`, expectedVersion, "1024", "100", "4096"],
  );
  const shellResult = runShellNodeScript(
    extractShellNodeScript("get_verified_release_identity() {"),
    [tarGz.manifestPath, tarGz.checksumPath, `${packageRoot}.tar.gz`, expectedVersion, "1024", "100", "4096"],
    sandbox,
    "get-verified-release-identity",
  );

  expect(powerShellResult.status, powerShellResult.stderr).not.toBe(0);
  expect(shellResult.status, shellResult.stderr).not.toBe(0);
  expect(powerShellResult.stderr).toContain("release manifest and checksum archive hashes disagree");
  expect(shellResult.stderr).toContain("release manifest and checksum archive hashes disagree");
});

test("install scripts validate release archives before extraction and promotion", () => {
  const powerShell = readNormalized(installPs1Path);
  const shell = readNormalized(installShPath);

  expect(powerShell.indexOf("Assert-SafeReleaseArchive -ArchivePath")).toBeLessThan(powerShell.indexOf("Expand-Archive -LiteralPath"));
  expect(powerShell.indexOf("Assert-SafeReleaseArchive -ArchivePath")).toBeLessThan(powerShell.indexOf("Backup-InstallRootFiles -Root $installRoot"));
  expect(shell.indexOf("validate_release_archive \"${ARCHIVE_PATH}\"")).toBeLessThan(shell.indexOf("tar -xzf \"${ARCHIVE_PATH}\""));
  expect(shell.indexOf("validate_release_archive \"${ARCHIVE_PATH}\"")).toBeLessThan(shell.indexOf("backup_install_root_files \"${INSTALL_ROOT}\""));
});

if (process.platform === "win32") {
  test("install.ps1 archive preflight rejects a file with child entries", () => {
    const sandbox = createSandbox();
    const expectedRoot = "star-sanctuary-dist-v0.0.0";
    const archivePath = path.join(sandbox, "conflicting.zip");
    writeStoredZip(archivePath, [
      { name: `${expectedRoot}/node`, data: "a" },
      { name: `${expectedRoot}/node/child`, data: "b" },
    ]);

    const result = runPowerShellArchiveValidator({
      archivePath,
      expectedRoot,
      expectedFileCount: 2,
      expectedTotalBytes: 2,
      sandbox,
    });

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("parent file");
  });

  test("install.ps1 archive preflight rejects a file after child entries", () => {
    const sandbox = createSandbox();
    const expectedRoot = "star-sanctuary-dist-v0.0.0";
    const archivePath = path.join(sandbox, "reverse-conflicting.zip");
    writeStoredZip(archivePath, [
      { name: `${expectedRoot}/node/child`, data: "a" },
      { name: `${expectedRoot}/node`, data: "b" },
    ]);

    const result = runPowerShellArchiveValidator({
      archivePath,
      expectedRoot,
      expectedFileCount: 2,
      expectedTotalBytes: 2,
      sandbox,
    });

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("child entries");
  });

  test("install.ps1 archive preflight accepts an explicit directory with children", () => {
    const sandbox = createSandbox();
    const expectedRoot = "star-sanctuary-dist-v0.0.0";
    const archivePath = path.join(sandbox, "valid.zip");
    writeStoredZip(archivePath, [
      { name: `${expectedRoot}/`, directory: true },
      { name: `${expectedRoot}/node/`, directory: true },
      { name: `${expectedRoot}/node/child`, data: "a" },
    ]);

    const result = runPowerShellArchiveValidator({
      archivePath,
      expectedRoot,
      expectedFileCount: 1,
      expectedTotalBytes: 1,
      sandbox,
    });

    expect(result.status, result.stderr).toBe(0);
  });
}
