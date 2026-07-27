import fs from "node:fs/promises";
import path from "node:path";

const LEASE_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const CONTAINER_NAME_PATTERN = /^belldandy-extension-[a-f0-9]{32}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export type PersistedExtensionRuntimeLease = {
  version: 1;
  runtime: "docker" | "podman";
  leaseId: string;
  containerName: string;
  extensionId: string;
  contentSha256: string;
};

export type LoadedExtensionRuntimeLease = PersistedExtensionRuntimeLease & {
  directory: string;
};

export function getExtensionRuntimeLeaseRoot(stateDir: string): string {
  return path.join(stateDir, "extensions", "runtime", "leases");
}

function parseLease(value: unknown, directory: string): LoadedExtensionRuntimeLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extension runtime lease state is invalid.");
  }
  const lease = value as Record<string, unknown>;
  if (
    lease.version !== 1
    || (lease.runtime !== "docker" && lease.runtime !== "podman")
    || typeof lease.leaseId !== "string"
    || !LEASE_ID_PATTERN.test(lease.leaseId)
    || typeof lease.containerName !== "string"
    || !CONTAINER_NAME_PATTERN.test(lease.containerName)
    || typeof lease.extensionId !== "string"
    || !lease.extensionId
    || typeof lease.contentSha256 !== "string"
    || !SHA256_PATTERN.test(lease.contentSha256)
    || path.basename(directory) !== lease.leaseId
  ) {
    throw new Error("Extension runtime lease state is invalid.");
  }
  return {
    version: 1,
    runtime: lease.runtime,
    leaseId: lease.leaseId,
    containerName: lease.containerName,
    extensionId: lease.extensionId,
    contentSha256: lease.contentSha256.toLowerCase(),
    directory,
  };
}

export async function writeExtensionRuntimeLease(
  stateDir: string,
  lease: PersistedExtensionRuntimeLease,
): Promise<string> {
  const directory = path.join(getExtensionRuntimeLeaseRoot(stateDir), lease.leaseId);
  const validated = parseLease(lease, directory);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "lease.json"),
    JSON.stringify({
      version: validated.version,
      runtime: validated.runtime,
      leaseId: validated.leaseId,
      containerName: validated.containerName,
      extensionId: validated.extensionId,
      contentSha256: validated.contentSha256,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  return directory;
}

export async function listExtensionRuntimeLeases(stateDir: string): Promise<LoadedExtensionRuntimeLease[]> {
  const root = getExtensionRuntimeLeaseRoot(stateDir);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const leases: LoadedExtensionRuntimeLease[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      throw new Error("Extension runtime lease state is invalid.");
    }
    const directory = path.join(root, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(directory, "lease.json"), "utf8")) as unknown;
    } catch {
      throw new Error("Extension runtime lease state is invalid.");
    }
    leases.push(parseLease(parsed, directory));
  }
  return leases;
}

export async function assertExtensionRuntimeInactive(stateDir: string, extensionId: string): Promise<void> {
  const leases = await listExtensionRuntimeLeases(stateDir);
  if (leases.some((lease) => lease.extensionId === extensionId)) {
    throw new Error(`Marketplace extension runtime is active; revoke it before mutation: ${extensionId}`);
  }
}
