import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { LspServerProcessProfile } from "./lsp-process-host.js";
import type { CodeIntelOperation } from "./types.js";

export const GOPLS_PROFILE_CONTRACT_VERSION = "gopls-profile/v1" as const;
export const PINNED_GOPLS_VERSION = "v0.21.0" as const;
export const GOPLS_DECODED_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const GOPLS_MAX_CONCURRENT_REQUESTS_PER_HOST = 1 as const;

const PROBE_TIMEOUT_MS = 3_000;
const PROBE_MAX_BUFFER_BYTES = 64 * 1024;
const GOPLS_CAPABILITIES = [
  "symbols",
  "definition",
  "references",
  "implementation",
] as const satisfies readonly CodeIntelOperation[];

export interface GoplsProbeDiagnostic {
  code:
    | "gopls_unavailable"
    | "gopls_version_invalid"
    | "gopls_version_mismatch"
    | "go_unavailable"
    | "go_version_invalid";
  message: string;
}

export type GoplsToolchainProbe = {
  status: "available" | "unavailable" | "incompatible";
  pinnedGoplsVersion: typeof PINNED_GOPLS_VERSION;
  gopls: {
    command: string;
    version?: string;
  };
  go: {
    command: string;
    version?: string;
    platform?: string;
  };
  diagnostics: GoplsProbeDiagnostic[];
};

export interface GoplsCommandResult {
  stdout: string;
  stderr: string;
}

export type GoplsCommandRunner = (
  command: string,
  args: string[],
  options: { environment: Record<string, string> },
) => Promise<GoplsCommandResult>;

export interface ProbeGoplsToolchainOptions {
  goplsCommand: string;
  goCommand: string;
  environment: Record<string, string>;
  runCommand?: GoplsCommandRunner;
}

export interface GoplsStatePaths {
  goCache: string;
  goModCache: string;
  goPath: string;
  temp: string;
  home: string;
}

export interface GoplsProcessProfile {
  contractVersion: typeof GOPLS_PROFILE_CONTRACT_VERSION;
  profile: LspServerProcessProfile;
  workspaceRoot: string;
  externalEvidenceRoots: string[];
  stateRoot: string;
  statePaths: GoplsStatePaths;
  toolchain: {
    goCommand: string;
    goVersion: string;
    platform: string;
  };
  resourceLimits: {
    decodedResponseMaxBytes: number;
    maxConcurrentRequestsPerHost: typeof GOPLS_MAX_CONCURRENT_REQUESTS_PER_HOST;
    processMemoryHardLimitBytes: null;
    processMemoryStatus: "unverified";
  };
  governance: {
    capabilities: CodeIntelOperation[];
    dependencyRestore: "denied";
    networkPolicy: "environment-deny";
    sandboxStatus: "unverified";
    productionEligible: false;
  };
}

export interface CreateGoplsProcessProfileOptions {
  probe: GoplsToolchainProbe;
  workspaceRoot: string;
  workspaceFolders?: string[];
  externalEvidenceRoots?: string[];
  stateRoot: string;
  buildTags?: string[];
  platformEnvironment: Record<string, string | undefined>;
}

export async function probeGoplsToolchain(
  options: ProbeGoplsToolchainOptions,
): Promise<GoplsToolchainProbe> {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const result: GoplsToolchainProbe = {
    status: "unavailable",
    pinnedGoplsVersion: PINNED_GOPLS_VERSION,
    gopls: { command: options.goplsCommand },
    go: { command: options.goCommand },
    diagnostics: [],
  };

  let goplsVersionOutput: GoplsCommandResult;
  try {
    goplsVersionOutput = await runCommand(
      options.goplsCommand,
      ["version"],
      { environment: { ...options.environment } },
    );
  } catch {
    result.diagnostics.push({
      code: "gopls_unavailable",
      message: "Pinned gopls executable is unavailable.",
    });
    return result;
  }

  const goplsVersion = parseGoplsVersion(goplsVersionOutput.stdout);
  if (!goplsVersion) {
    result.status = "incompatible";
    result.diagnostics.push({
      code: "gopls_version_invalid",
      message: "gopls returned an unrecognized version response.",
    });
    return result;
  }
  result.gopls.version = goplsVersion;
  if (goplsVersion !== PINNED_GOPLS_VERSION) {
    result.status = "incompatible";
    result.diagnostics.push({
      code: "gopls_version_mismatch",
      message: `gopls version ${goplsVersion} does not match pinned ${PINNED_GOPLS_VERSION}.`,
    });
    return result;
  }

  let goVersionOutput: GoplsCommandResult;
  try {
    goVersionOutput = await runCommand(
      options.goCommand,
      ["version"],
      { environment: { ...options.environment } },
    );
  } catch {
    result.diagnostics.push({
      code: "go_unavailable",
      message: "Configured Go toolchain is unavailable.",
    });
    return result;
  }

  const goVersion = parseGoVersion(goVersionOutput.stdout);
  if (!goVersion) {
    result.status = "incompatible";
    result.diagnostics.push({
      code: "go_version_invalid",
      message: "Go toolchain returned an unrecognized version response.",
    });
    return result;
  }
  result.go.version = goVersion.version;
  result.go.platform = goVersion.platform;
  result.status = "available";
  return result;
}

export function createGoplsProcessProfile(
  options: CreateGoplsProcessProfileOptions,
): GoplsProcessProfile {
  if (options.probe.status !== "available"
    || options.probe.gopls.version !== PINNED_GOPLS_VERSION
    || !options.probe.go.version
    || !options.probe.go.platform) {
    throw new Error("Pinned gopls toolchain is not available.");
  }
  if (!path.isAbsolute(options.workspaceRoot)
    || !path.isAbsolute(options.stateRoot)
    || !path.isAbsolute(options.probe.gopls.command)
    || !path.isAbsolute(options.probe.go.command)) {
    throw new Error("gopls profile paths and commands must be absolute.");
  }

  const workspaceRoot = path.resolve(options.workspaceRoot);
  const stateRoot = path.resolve(options.stateRoot);
  if (isPathInside(workspaceRoot, stateRoot)) {
    throw new Error("gopls state root must stay outside the workspace.");
  }
  const workspaceFolders = normalizeWorkspaceFolders(workspaceRoot, options.workspaceFolders);
  const externalEvidenceRoots = normalizeExternalEvidenceRoots(
    workspaceRoot,
    options.externalEvidenceRoots,
  );

  const buildTags = normalizeBuildTags(options.buildTags ?? []);
  const statePaths: GoplsStatePaths = {
    goCache: path.join(stateRoot, "go-build"),
    goModCache: path.join(stateRoot, "go-mod"),
    goPath: path.join(stateRoot, "gopath"),
    temp: path.join(stateRoot, "tmp"),
    home: path.join(stateRoot, "home"),
  };
  const environment: Record<string, string> = {
    ...pickPlatformEnvironment(options.platformEnvironment),
    PATH: path.dirname(options.probe.go.command),
    GOCACHE: statePaths.goCache,
    GOMODCACHE: statePaths.goModCache,
    GOPATH: statePaths.goPath,
    GOTMPDIR: statePaths.temp,
    TMP: statePaths.temp,
    TEMP: statePaths.temp,
    HOME: statePaths.home,
    USERPROFILE: statePaths.home,
    GOPROXY: "off",
    GOSUMDB: "off",
    GOTOOLCHAIN: "local",
    GOENV: "off",
    GOTELEMETRY: "off",
    // 省略 GOWORK 以自动发现 go.work；固定 gopls 会把显式 auto 当成文件路径。
    GOFLAGS: "-mod=readonly",
    CGO_ENABLED: "0",
  };
  const goplsSettings = buildTags.length > 0
    ? { buildFlags: [`-tags=${buildTags.join(",")}`] }
    : {};

  return {
    contractVersion: GOPLS_PROFILE_CONTRACT_VERSION,
    profile: {
      id: "gopls",
      version: PINNED_GOPLS_VERSION,
      command: options.probe.gopls.command,
      args: ["serve"],
      environment,
      ...(workspaceFolders === undefined ? {} : { workspaceFolders }),
      clientNotificationMethods: ["textDocument/didOpen"],
      initializationOptions: { settings: { gopls: goplsSettings } },
      serverRequests: {
        workspaceConfiguration: { gopls: goplsSettings },
        dynamicRegistrationMethods: ["workspace/didChangeConfiguration"],
        workDoneProgress: true,
      },
    },
    workspaceRoot,
    externalEvidenceRoots,
    stateRoot,
    statePaths,
    toolchain: {
      goCommand: options.probe.go.command,
      goVersion: options.probe.go.version,
      platform: options.probe.go.platform,
    },
    resourceLimits: {
      decodedResponseMaxBytes: GOPLS_DECODED_RESPONSE_MAX_BYTES,
      maxConcurrentRequestsPerHost: GOPLS_MAX_CONCURRENT_REQUESTS_PER_HOST,
      processMemoryHardLimitBytes: null,
      processMemoryStatus: "unverified",
    },
    governance: {
      capabilities: [...GOPLS_CAPABILITIES],
      dependencyRestore: "denied",
      networkPolicy: "environment-deny",
      sandboxStatus: "unverified",
      productionEligible: false,
    },
  };
}

function normalizeExternalEvidenceRoots(workspaceRoot: string, roots: string[] | undefined): string[] {
  const values = roots ?? [];
  if (values.length > 32) {
    throw new Error("gopls external evidence roots exceed the canary limit.");
  }
  return [...new Map(values.map((root) => {
    if (!path.isAbsolute(root) || isPathInside(workspaceRoot, root)) {
      throw new Error("gopls external evidence roots must be absolute workspace-external paths.");
    }
    const resolved = path.resolve(root);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    return [key, resolved];
  })).values()];
}

function normalizeWorkspaceFolders(
  workspaceRoot: string,
  folders: string[] | undefined,
): string[] | undefined {
  if (folders === undefined) return undefined;
  if (folders.length === 0 || folders.length > 64) {
    throw new Error("gopls workspace folders must contain between 1 and 64 paths.");
  }
  const normalized = [...new Map(folders.map((folder) => {
    if (!path.isAbsolute(folder) || !isPathInside(workspaceRoot, folder)) {
      throw new Error("gopls workspace folders must stay inside the workspace root.");
    }
    const resolved = path.resolve(folder);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    return [key, resolved];
  })).values()];
  return normalized;
}

export async function prepareGoplsStateRoot(profile: GoplsProcessProfile): Promise<void> {
  await Promise.all(Object.values(profile.statePaths).map(async (directory) => {
    if (!isPathInside(profile.stateRoot, directory)) {
      throw new Error("gopls state directory escaped the declared state root.");
    }
    await mkdir(directory, { recursive: true });
  }));
}

function defaultRunCommand(
  command: string,
  args: string[],
  options: { environment: Record<string, string> },
): Promise<GoplsCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      env: { ...options.environment },
      encoding: "utf-8",
      maxBuffer: PROBE_MAX_BUFFER_BYTES,
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseGoplsVersion(stdout: string): string | undefined {
  return stdout.match(/\bgopls\s+(v\d+\.\d+\.\d+)\b/)?.[1];
}

function parseGoVersion(stdout: string): { version: string; platform: string } | undefined {
  const match = stdout.match(/^go version\s+(go\d+\.\d+(?:\.\d+)?)\s+([^\s]+)\s*$/m);
  if (!match) return undefined;
  return { version: match[1], platform: match[2] };
}

function pickPlatformEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["SystemRoot", "WINDIR"]) {
    const value = environment[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function normalizeBuildTags(tags: string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (normalized.some((tag) => !/^[A-Za-z0-9_.]+$/.test(tag))) {
    throw new Error("gopls build tags contain unsupported characters.");
  }
  return normalized;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
