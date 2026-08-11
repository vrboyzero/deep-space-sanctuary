import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GOPLS_PROFILE_CONTRACT_VERSION,
  PINNED_GOPLS_VERSION,
  createGoplsProcessProfile,
  prepareGoplsStateRoot,
  probeGoplsToolchain,
  type GoplsCommandRunner,
} from "./gopls-profile.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })));
});

describe("probeGoplsToolchain", () => {
  it("accepts only the pinned gopls version and records the Go platform", async () => {
    const run = vi.fn<GoplsCommandRunner>(async (command) => command.endsWith("gopls.exe")
      ? { stdout: "golang.org/x/tools/gopls v0.21.0\n", stderr: "" }
      : { stdout: "go version go1.24.2 windows/amd64\n", stderr: "" });

    const result = await probeGoplsToolchain({
      goplsCommand: "C:\\tools\\gopls.exe",
      goCommand: "C:\\Go\\bin\\go.exe",
      environment: { SystemRoot: "C:\\Windows" },
      runCommand: run,
    });

    expect(result).toEqual({
      status: "available",
      pinnedGoplsVersion: PINNED_GOPLS_VERSION,
      gopls: { command: "C:\\tools\\gopls.exe", version: "v0.21.0" },
      go: {
        command: "C:\\Go\\bin\\go.exe",
        version: "go1.24.2",
        platform: "windows/amd64",
      },
      diagnostics: [],
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fails closed for a different gopls version", async () => {
    const result = await probeGoplsToolchain({
      goplsCommand: "/opt/ss/gopls",
      goCommand: "/opt/go/bin/go",
      environment: {},
      runCommand: async (command) => command.endsWith("gopls")
        ? { stdout: "golang.org/x/tools/gopls v0.20.0\n", stderr: "" }
        : { stdout: "go version go1.24.2 linux/amd64\n", stderr: "" },
    });

    expect(result).toMatchObject({
      status: "incompatible",
      pinnedGoplsVersion: PINNED_GOPLS_VERSION,
      gopls: { version: "v0.20.0" },
      diagnostics: [expect.objectContaining({ code: "gopls_version_mismatch" })],
    });
  });

  it("reports a missing command as unavailable without throwing", async () => {
    const result = await probeGoplsToolchain({
      goplsCommand: "/opt/ss/gopls",
      goCommand: "/opt/go/bin/go",
      environment: {},
      runCommand: async () => {
        throw new Error("ENOENT: internal host path should not be copied into user-facing output");
      },
    });

    expect(result).toMatchObject({
      status: "unavailable",
      diagnostics: [{
        code: "gopls_unavailable",
        message: "Pinned gopls executable is unavailable.",
      }],
    });
  });
});

describe("createGoplsProcessProfile", () => {
  it("builds a workspace-external state layout and an explicit offline environment", async () => {
    const base = await createTempRoot("ss-gopls-profile-");
    const workspaceRoot = path.join(base, "workspace");
    const stateRoot = path.join(base, "state");
    const appRoot = path.join(workspaceRoot, "app");
    const libraryRoot = path.join(workspaceRoot, "library");
    const externalRoot = path.join(base, "external");
    const goplsCommand = path.join(base, process.platform === "win32" ? "gopls.exe" : "gopls");
    const goCommand = path.join(base, "go", "bin", process.platform === "win32" ? "go.exe" : "go");

    const result = createGoplsProcessProfile({
      probe: {
        status: "available",
        pinnedGoplsVersion: PINNED_GOPLS_VERSION,
        gopls: { command: goplsCommand, version: PINNED_GOPLS_VERSION },
        go: { command: goCommand, version: "go1.24.2", platform: `${process.platform}/x64` },
        diagnostics: [],
      },
      workspaceRoot,
      workspaceFolders: [appRoot, libraryRoot],
      externalEvidenceRoots: [externalRoot],
      stateRoot,
      buildTags: ["integration", "linux"],
      platformEnvironment: { SystemRoot: "C:\\Windows", SS_SECRET: "do-not-copy" },
    });

    expect(result.contractVersion).toBe(GOPLS_PROFILE_CONTRACT_VERSION);
    expect(result.externalEvidenceRoots).toEqual([externalRoot]);
    expect(result.profile).toMatchObject({
      id: "gopls",
      version: PINNED_GOPLS_VERSION,
      command: goplsCommand,
      args: ["serve"],
      workspaceFolders: [appRoot, libraryRoot],
      clientNotificationMethods: ["textDocument/didOpen"],
      environment: {
        GOPROXY: "off",
        GOSUMDB: "off",
        GOTOOLCHAIN: "local",
        GOENV: "off",
        GOTELEMETRY: "off",
        GOFLAGS: "-mod=readonly",
        CGO_ENABLED: "0",
        SystemRoot: "C:\\Windows",
      },
    });
    expect(result.profile.environment).not.toHaveProperty("SS_SECRET");
    expect(result.profile.environment.PATH).toBe(path.dirname(goCommand));
    expect(result.profile.initializationOptions).toEqual({
      settings: { gopls: { buildFlags: ["-tags=integration,linux"] } },
    });
    expect(result.profile.serverRequests).toEqual({
      workspaceConfiguration: {
        gopls: { buildFlags: ["-tags=integration,linux"] },
      },
      dynamicRegistrationMethods: ["workspace/didChangeConfiguration"],
      workDoneProgress: true,
    });
    expect(result.governance).toEqual({
      capabilities: ["symbols", "definition", "references", "implementation"],
      dependencyRestore: "denied",
      networkPolicy: "environment-deny",
      sandboxStatus: "unverified",
      productionEligible: false,
    });
    expect(result.resourceLimits).toEqual({
      decodedResponseMaxBytes: 4 * 1024 * 1024,
      maxConcurrentRequestsPerHost: 1,
      processMemoryHardLimitBytes: null,
      processMemoryStatus: "unverified",
    });
    for (const directory of Object.values(result.statePaths)) {
      expect(path.relative(workspaceRoot, directory).startsWith("..")).toBe(true);
    }
  });

  it("prepares only the declared state directories", async () => {
    const stateRoot = await createTempRoot("ss-gopls-state-");
    const workspaceRoot = path.join(stateRoot, "..", "workspace");
    const goplsCommand = path.join(stateRoot, "bin", process.platform === "win32" ? "gopls.exe" : "gopls");
    const goCommand = path.join(stateRoot, "go", "bin", process.platform === "win32" ? "go.exe" : "go");
    const profile = createGoplsProcessProfile({
      probe: {
        status: "available",
        pinnedGoplsVersion: PINNED_GOPLS_VERSION,
        gopls: { command: goplsCommand, version: PINNED_GOPLS_VERSION },
        go: { command: goCommand, version: "go1.24.2", platform: `${process.platform}/x64` },
        diagnostics: [],
      },
      workspaceRoot,
      stateRoot,
      platformEnvironment: {},
    });

    await prepareGoplsStateRoot(profile);

    await expect(Promise.all(Object.values(profile.statePaths).map(async (directory) => {
      const info = await stat(directory);
      expect(info.isDirectory()).toBe(true);
    }))).resolves.toBeDefined();
  });

  it("rejects state inside the workspace and an unavailable probe", async () => {
    const root = await createTempRoot("ss-gopls-invalid-");
    const workspaceRoot = path.join(root, "workspace");
    const availableProbe = {
      status: "available" as const,
      pinnedGoplsVersion: PINNED_GOPLS_VERSION,
      gopls: { command: path.join(root, "gopls"), version: PINNED_GOPLS_VERSION },
      go: { command: path.join(root, "go"), version: "go1.24.2", platform: "linux/amd64" },
      diagnostics: [],
    };

    expect(() => createGoplsProcessProfile({
      probe: availableProbe,
      workspaceRoot,
      stateRoot: path.join(workspaceRoot, ".cache"),
      platformEnvironment: {},
    })).toThrowError(/outside the workspace/i);

    expect(() => createGoplsProcessProfile({
      probe: { ...availableProbe, status: "unavailable" },
      workspaceRoot,
      stateRoot: path.join(root, "state"),
      platformEnvironment: {},
    })).toThrowError(/not available/i);

    expect(() => createGoplsProcessProfile({
      probe: availableProbe,
      workspaceRoot,
      workspaceFolders: [path.join(root, "outside")],
      stateRoot: path.join(root, "state"),
      platformEnvironment: {},
    })).toThrowError(/workspace folders/i);

    expect(() => createGoplsProcessProfile({
      probe: availableProbe,
      workspaceRoot,
      externalEvidenceRoots: [path.join(workspaceRoot, "nested")],
      stateRoot: path.join(root, "state"),
      platformEnvironment: {},
    })).toThrowError(/external evidence roots/i);

    expect(() => createGoplsProcessProfile({
      probe: availableProbe,
      workspaceRoot,
      externalEvidenceRoots: ["relative-external-root"],
      stateRoot: path.join(root, "state"),
      platformEnvironment: {},
    })).toThrowError(/external evidence roots/i);

    expect(() => createGoplsProcessProfile({
      probe: availableProbe,
      workspaceRoot,
      externalEvidenceRoots: Array.from(
        { length: 33 },
        (_, index) => path.join(root, `external-${index}`),
      ),
      stateRoot: path.join(root, "state"),
      platformEnvironment: {},
    })).toThrowError(/canary limit/i);
  });
});

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}
