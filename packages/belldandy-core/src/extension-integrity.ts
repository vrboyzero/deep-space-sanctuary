import fs from "node:fs/promises";
import path from "node:path";

import {
  assertSafeFilesystemRelativePath,
  FilesystemCapability,
} from "@belldandy/protocol";
import {
  isSupportedExtensionHostApi,
  parseExtensionManifest,
  type ExtensionManifest,
  type ExtensionPermission,
} from "@belldandy/plugins";

import type { InstalledExtensionRecord } from "./extension-marketplace-state.js";
import {
  computeMaterializedExtensionContentSha256,
  getExtensionMarketplaceMaterializedDir,
  getMaterializedExtensionPath,
} from "./extension-marketplace-source.js";

const SOURCE_KEY_PATTERN = /^[a-f0-9]{16}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type VerifiedInstalledMarketplaceExtension = {
  installPath: string;
  manifestPath: string;
  manifest: ExtensionManifest;
  pluginModulePath?: string;
  skillDirs: string[];
};

function isSamePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function assertApprovedExtensionRecord(
  extension: InstalledExtensionRecord,
): asserts extension is InstalledExtensionRecord & {
  sourceKey: string;
  contentSha256: string;
  approvedAt: string;
  approvedHostApi: number;
  approvedPermissions: ExtensionPermission[];
} {
  if (extension.status !== "installed" || !extension.enabled) {
    throw new Error("Marketplace extension is not approved for activation.");
  }
  if (!extension.sourceKey || !SOURCE_KEY_PATTERN.test(extension.sourceKey)) {
    throw new Error("Marketplace extension source identity is unavailable.");
  }
  if (!extension.contentSha256 || !SHA256_PATTERN.test(extension.contentSha256)) {
    throw new Error("Marketplace extension integrity approval is unavailable; reinstall the extension.");
  }
  if (!extension.approvedAt) {
    throw new Error("Marketplace extension approval timestamp is unavailable; reinstall the extension.");
  }
  if (
    typeof extension.approvedHostApi !== "number"
    || !Number.isSafeInteger(extension.approvedHostApi)
    || extension.approvedHostApi < 1
  ) {
    throw new Error("Marketplace extension host API approval is unavailable; reinstall the extension.");
  }
  if (!Array.isArray(extension.approvedPermissions)) {
    throw new Error("Marketplace extension permission approval is unavailable; reinstall the extension.");
  }
  if (!isSupportedExtensionHostApi(extension.kind, extension.approvedHostApi)) {
    throw new Error("Marketplace extension approved host API is no longer supported; reinstall the extension.");
  }
}

function haveSamePermissions(left: readonly ExtensionPermission[], right: readonly ExtensionPermission[]): boolean {
  if (left.length !== right.length) return false;
  const rightPermissions = new Set(right);
  return left.every((permission) => rightPermissions.has(permission));
}

async function assertFile(pathname: string, label: string): Promise<void> {
  const stat = await fs.stat(pathname);
  if (!stat.isFile()) {
    throw new Error(`Marketplace extension ${label} must be a file.`);
  }
}

async function assertDirectory(pathname: string, label: string): Promise<void> {
  const stat = await fs.stat(pathname);
  if (!stat.isDirectory()) {
    throw new Error(`Marketplace extension ${label} must be a directory.`);
  }
}

/**
 * Marketplace state 只是批准记录，真正执行前仍必须重新验证物化目录。这里集中完成
 * source identity、真实路径、内容摘要和 manifest identity 校验，调用方只能获得已验证路径。
 */
export async function verifyInstalledMarketplaceExtension(input: {
  stateDir: string;
  extension: InstalledExtensionRecord;
}): Promise<VerifiedInstalledMarketplaceExtension> {
  const { extension } = input;
  assertApprovedExtensionRecord(extension);

  const expectedInstallPath = getMaterializedExtensionPath(
    input.stateDir,
    extension.marketplace,
    extension.name,
  );
  if (!isSamePath(extension.installPath, expectedInstallPath)) {
    throw new Error("Marketplace extension install path does not match its approved identity.");
  }

  let materializedRoot: FilesystemCapability;
  try {
    materializedRoot = new FilesystemCapability({
      rootPath: getExtensionMarketplaceMaterializedDir(input.stateDir),
      label: "marketplace materialized root",
    });
  } catch {
    throw new Error("Marketplace extension materialized root is unavailable.");
  }

  let installPath: string;
  let expectedCanonicalInstallPath: string;
  try {
    installPath = materializedRoot.resolveExistingPath(extension.installPath, "marketplace extension install path");
    expectedCanonicalInstallPath = materializedRoot.resolveExistingPath(
      expectedInstallPath,
      "marketplace extension expected install path",
    );
  } catch {
    throw new Error("Marketplace extension install path escapes the approved materialized root.");
  }
  if (!isSamePath(installPath, expectedCanonicalInstallPath)) {
    throw new Error("Marketplace extension install path does not resolve to its approved identity.");
  }

  let extensionRoot: FilesystemCapability;
  try {
    extensionRoot = new FilesystemCapability({
      rootPath: installPath,
      label: `marketplace extension ${extension.id}`,
    });
  } catch {
    throw new Error("Marketplace extension install root is unavailable.");
  }

  const currentContentSha256 = await computeMaterializedExtensionContentSha256(extensionRoot.rootPath);
  if (currentContentSha256 !== extension.contentSha256.toLowerCase()) {
    throw new Error("Marketplace extension content integrity mismatch; reinstall the extension.");
  }

  const manifestRelativePath = assertSafeFilesystemRelativePath(
    extension.manifestPath?.trim() || "belldandy-extension.json",
    "marketplace extension manifest path",
  );
  const manifestPath = extensionRoot.resolveExistingRelative(manifestRelativePath, "marketplace extension manifest");
  await assertFile(manifestPath, "manifest");
  const manifest = parseExtensionManifest(JSON.parse(await fs.readFile(manifestPath, "utf-8")) as unknown);
  if (manifest.name !== extension.name || manifest.kind !== extension.kind || manifest.version !== extension.version) {
    throw new Error("Marketplace extension manifest does not match its approved identity.");
  }
  if (manifest.compatibility?.hostApi !== extension.approvedHostApi) {
    throw new Error("Marketplace extension host compatibility does not match the approved trust decision.");
  }
  if (!manifest.permissions || !haveSamePermissions(manifest.permissions, extension.approvedPermissions)) {
    throw new Error("Marketplace extension permissions do not match the approved trust decision.");
  }

  let pluginModulePath: string | undefined;
  if (manifest.entry.pluginModule) {
    pluginModulePath = extensionRoot.resolveExistingRelative(
      assertSafeFilesystemRelativePath(manifest.entry.pluginModule, "marketplace extension plugin module"),
      "marketplace extension plugin module",
    );
    await assertFile(pluginModulePath, "plugin module");
  }

  const skillDirs: string[] = [];
  for (const skillDir of manifest.entry.skillDirs ?? []) {
    const verifiedSkillDir = extensionRoot.resolveExistingRelative(
      assertSafeFilesystemRelativePath(skillDir, "marketplace extension skill directory"),
      "marketplace extension skill directory",
    );
    await assertDirectory(verifiedSkillDir, "skill directory");
    skillDirs.push(verifiedSkillDir);
  }

  return {
    installPath: extensionRoot.rootPath,
    manifestPath,
    manifest,
    pluginModulePath,
    skillDirs,
  };
}
