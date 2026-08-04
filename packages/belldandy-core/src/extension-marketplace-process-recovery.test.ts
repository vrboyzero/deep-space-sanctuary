import { fork, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  listMarketplaceExtensionAudits,
  reconcileMarketplaceExtensionAudits,
} from "./extension-marketplace-audit.js";
import {
  installMarketplaceExtension,
  previewMarketplaceExtensionInstall,
  previewMarketplaceExtensionUninstall,
  previewMarketplaceExtensionUpdate,
  uninstallMarketplaceExtension,
  updateMarketplaceExtension,
} from "./extension-marketplace-service.js";
import {
  getInstalledExtension,
  type InstalledExtensionRecord,
} from "./extension-marketplace-state.js";

const temporaryDirectories: string[] = [];
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => forceTerminate(child)));
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

describe("marketplace mutation process crash recovery", () => {
  it("reopens a confirmed install as uncertain when the process dies before mutation", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "confirmed");

    await waitForPhase(child, "confirmed");
    await forceTerminate(child);

    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId)).resolves.toBeUndefined();
    await expect(reconcileMarketplaceExtensionAudits(fixture.stateDir)).resolves.toEqual([
      expect.objectContaining({
        operation: "install",
        extensionId: fixture.extensionId,
        confirmationHash: fixture.confirmationHash,
        status: "uncertain",
      }),
    ]);
    await expectReplayRejected(fixture, "Unresolved marketplace extension audit blocks mutation");
    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId)).resolves.toBeUndefined();
  });

  it("reconciles a committed install without replaying it when completion audit was lost", async () => {
    const fixture = await createFixture();
    const child = startCrashChild(fixture, "installed");

    await waitForPhase(child, "installed");
    await forceTerminate(child);

    const installedBeforeReconcile = await getInstalledExtension(fixture.stateDir, fixture.extensionId);
    expect(installedBeforeReconcile).toMatchObject({
      id: fixture.extensionId,
      status: "installed",
      contentSha256: fixture.contentSha256,
    });
    await expect(reconcileMarketplaceExtensionAudits(fixture.stateDir)).resolves.toEqual([
      expect.objectContaining({
        operation: "install",
        extensionId: fixture.extensionId,
        confirmationHash: fixture.confirmationHash,
        status: "completed",
      }),
    ]);
    await expectReplayRejected(fixture, "Marketplace extension audit already completed");
    const installedAfterReplayAttempt = await getInstalledExtension(fixture.stateDir, fixture.extensionId);
    expect(installedAfterReplayAttempt).toEqual(installedBeforeReconcile);
    await expect(listMarketplaceExtensionAudits(fixture.stateDir)).resolves.toHaveLength(1);
  });

  it("keeps the previous install when an update process dies before mutation", async () => {
    const fixture = await createUpdateFixture();
    const child = startUpdateCrashChild(fixture, "confirmed");

    await waitForPhase(child, "confirmed");
    await forceTerminate(child);

    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId))
      .resolves.toEqual(fixture.previousInstalled);
    await expect(reconcileMarketplaceExtensionAudits(fixture.stateDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "update",
          extensionId: fixture.extensionId,
          confirmationHash: fixture.confirmationHash,
          previousContentSha256: fixture.previousInstalled.contentSha256,
          contentSha256: fixture.contentSha256,
          status: "uncertain",
        }),
      ]),
    );
    await expectUpdateReplayRejected(fixture, "Unresolved marketplace extension audit blocks mutation");
    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId))
      .resolves.toEqual(fixture.previousInstalled);
  });

  it("reconciles a committed update without materializing it again", async () => {
    const fixture = await createUpdateFixture();
    const child = startUpdateCrashChild(fixture, "installed");

    await waitForPhase(child, "installed");
    await forceTerminate(child);

    const installedBeforeReconcile = await getInstalledExtension(fixture.stateDir, fixture.extensionId);
    expect(installedBeforeReconcile).toMatchObject({
      id: fixture.extensionId,
      version: "2.0.0",
      status: "installed",
      contentSha256: fixture.contentSha256,
      installedAt: fixture.previousInstalled.installedAt,
    });
    expect(installedBeforeReconcile?.contentSha256).not.toBe(fixture.previousInstalled.contentSha256);
    const materializedEntryPath = path.join(installedBeforeReconcile!.installPath, "dist", "plugin.mjs");
    const materializedBeforeReplay = await fs.readFile(materializedEntryPath, "utf-8");
    expect(materializedBeforeReplay).toContain('version: "2.0.0"');

    await expect(reconcileMarketplaceExtensionAudits(fixture.stateDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "update",
          extensionId: fixture.extensionId,
          confirmationHash: fixture.confirmationHash,
          previousContentSha256: fixture.previousInstalled.contentSha256,
          contentSha256: fixture.contentSha256,
          status: "completed",
        }),
      ]),
    );

    await fs.writeFile(path.join(fixture.sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "crash-plugin",
      kind: "plugin",
      version: "3.0.0",
      compatibility: { hostApi: 1 },
      permissions: [],
      entry: { pluginModule: "dist/plugin.mjs" },
    }, null, 2), "utf-8");
    await fs.writeFile(
      path.join(fixture.sourceDir, "dist", "plugin.mjs"),
      "export default { name: \"crash-plugin\", version: \"3.0.0\" };\n",
      "utf-8",
    );
    await expectUpdateReplayRejected(fixture, "Marketplace extension audit already completed");
    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId))
      .resolves.toEqual(installedBeforeReconcile);
    await expect(fs.readFile(materializedEntryPath, "utf-8"))
      .resolves.toBe(materializedBeforeReplay);
    await expect(listMarketplaceExtensionAudits(fixture.stateDir)).resolves.toHaveLength(2);
  });

  it("keeps the installed version when an uninstall process dies before deletion", async () => {
    const fixture = await createUninstallFixture();
    const child = startUninstallCrashChild(fixture, "confirmed");

    await waitForPhase(child, "confirmed");
    await forceTerminate(child);

    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId))
      .resolves.toEqual(fixture.installed);
    await expect(fs.access(fixture.installed.installPath)).resolves.toBeUndefined();
    await expect(reconcileMarketplaceExtensionAudits(fixture.stateDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "uninstall",
          extensionId: fixture.extensionId,
          confirmationHash: fixture.confirmationHash,
          contentSha256: fixture.installed.contentSha256,
          status: "uncertain",
        }),
      ]),
    );
    await expectUninstallReplayRejected(fixture, "Unresolved marketplace extension audit blocks mutation");
    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId))
      .resolves.toEqual(fixture.installed);
    await expect(fs.access(fixture.installed.installPath)).resolves.toBeUndefined();
  });

  it("reconciles a committed uninstall without deleting a later reinstall", async () => {
    const fixture = await createUninstallFixture();
    const child = startUninstallCrashChild(fixture, "removed");

    await waitForPhase(child, "removed");
    await forceTerminate(child);

    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId)).resolves.toBeUndefined();
    await expect(fs.access(fixture.installed.installPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(reconcileMarketplaceExtensionAudits(fixture.stateDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "uninstall",
          extensionId: fixture.extensionId,
          confirmationHash: fixture.confirmationHash,
          contentSha256: fixture.installed.contentSha256,
          status: "completed",
        }),
      ]),
    );

    await fs.writeFile(path.join(fixture.sourceDir, "belldandy-extension.json"), JSON.stringify({
      schemaVersion: 1,
      name: "crash-plugin",
      kind: "plugin",
      version: "2.0.0",
      compatibility: { hostApi: 1 },
      permissions: [],
      entry: { pluginModule: "dist/plugin.mjs" },
    }, null, 2), "utf-8");
    await fs.writeFile(
      path.join(fixture.sourceDir, "dist", "plugin.mjs"),
      "export default { name: \"crash-plugin\", version: \"2.0.0\" };\n",
      "utf-8",
    );
    const reinstallPreview = await previewMarketplaceExtensionInstall({
      stateDir: fixture.stateDir,
      marketplace: "crash-market",
      source: { source: "directory", path: fixture.sourceDir },
    });
    expect(reinstallPreview.extensionId).toBe(fixture.extensionId);
    const reinstalled = await installMarketplaceExtension({
      stateDir: fixture.stateDir,
      marketplace: "crash-market",
      source: { source: "directory", path: fixture.sourceDir },
      confirmationHash: reinstallPreview.confirmationHash,
    });
    expect(reinstalled.installed.contentSha256).not.toBe(fixture.installed.contentSha256);

    await expectUninstallReplayRejected(fixture, "Marketplace extension audit already completed");
    await expect(getInstalledExtension(fixture.stateDir, fixture.extensionId))
      .resolves.toEqual(reinstalled.installed);
    await expect(fs.readFile(path.join(reinstalled.installed.installPath, "dist", "plugin.mjs"), "utf-8"))
      .resolves.toContain('version: "2.0.0"');
    await expect(listMarketplaceExtensionAudits(fixture.stateDir)).resolves.toHaveLength(3);
  });
});

type CrashPhase = "confirmed" | "installed" | "removed";

type Fixture = {
  rootDir: string;
  stateDir: string;
  sourceDir: string;
  extensionId: string;
  confirmationHash: string;
  contentSha256: string;
};

type UpdateFixture = Fixture & {
  previousInstalled: InstalledExtensionRecord;
};

type UninstallFixture = Fixture & {
  installed: InstalledExtensionRecord;
};

async function createFixture(): Promise<Fixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-marketplace-crash-"));
  const stateDir = path.join(rootDir, "state");
  const sourceDir = path.join(rootDir, "source");
  await fs.mkdir(path.join(sourceDir, "dist"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "belldandy-extension.json"), JSON.stringify({
    schemaVersion: 1,
    name: "crash-plugin",
    kind: "plugin",
    version: "1.0.0",
    compatibility: { hostApi: 1 },
    permissions: [],
    entry: { pluginModule: "dist/plugin.mjs" },
  }, null, 2), "utf-8");
  await fs.writeFile(
    path.join(sourceDir, "dist", "plugin.mjs"),
    "export default { name: \"crash-plugin\" };\n",
    "utf-8",
  );
  temporaryDirectories.push(rootDir);
  const preview = await previewMarketplaceExtensionInstall({
    stateDir,
    marketplace: "crash-market",
    source: { source: "directory", path: sourceDir },
  });
  return {
    rootDir,
    stateDir,
    sourceDir,
    extensionId: preview.extensionId,
    confirmationHash: preview.confirmationHash,
    contentSha256: preview.contentSha256,
  };
}

async function createUpdateFixture(): Promise<UpdateFixture> {
  const fixture = await createFixture();
  const installed = await installMarketplaceExtension({
    stateDir: fixture.stateDir,
    marketplace: "crash-market",
    source: { source: "directory", path: fixture.sourceDir },
    confirmationHash: fixture.confirmationHash,
  });
  await fs.writeFile(path.join(fixture.sourceDir, "belldandy-extension.json"), JSON.stringify({
    schemaVersion: 1,
    name: "crash-plugin",
    kind: "plugin",
    version: "2.0.0",
    compatibility: { hostApi: 1 },
    permissions: [],
    entry: { pluginModule: "dist/plugin.mjs" },
  }, null, 2), "utf-8");
  await fs.writeFile(
    path.join(fixture.sourceDir, "dist", "plugin.mjs"),
    "export default { name: \"crash-plugin\", version: \"2.0.0\" };\n",
    "utf-8",
  );
  const preview = await previewMarketplaceExtensionUpdate({
    stateDir: fixture.stateDir,
    extensionId: fixture.extensionId,
  });
  return {
    ...fixture,
    confirmationHash: preview.confirmationHash,
    contentSha256: preview.contentSha256,
    previousInstalled: installed.installed,
  };
}

async function createUninstallFixture(): Promise<UninstallFixture> {
  const fixture = await createFixture();
  const installed = await installMarketplaceExtension({
    stateDir: fixture.stateDir,
    marketplace: "crash-market",
    source: { source: "directory", path: fixture.sourceDir },
    confirmationHash: fixture.confirmationHash,
  });
  const preview = await previewMarketplaceExtensionUninstall({
    stateDir: fixture.stateDir,
    extensionId: fixture.extensionId,
  });
  return {
    ...fixture,
    confirmationHash: preview.confirmationHash,
    installed: installed.installed,
  };
}

function startCrashChild(fixture: Fixture, phase: CrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/extension-marketplace-crash-child.mjs", import.meta.url)),
    [fixture.stateDir, fixture.sourceDir, fixture.confirmationHash, phase],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function startUpdateCrashChild(fixture: UpdateFixture, phase: CrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/extension-marketplace-crash-child.mjs", import.meta.url)),
    [
      fixture.stateDir,
      fixture.sourceDir,
      fixture.confirmationHash,
      phase,
      "update",
      fixture.extensionId,
    ],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function startUninstallCrashChild(fixture: UninstallFixture, phase: CrashPhase): ChildProcess {
  const child = fork(
    fileURLToPath(new URL("./fixtures/extension-marketplace-crash-child.mjs", import.meta.url)),
    [
      fixture.stateDir,
      fixture.sourceDir,
      fixture.confirmationHash,
      phase,
      "uninstall",
      fixture.extensionId,
    ],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  return child;
}

function waitForPhase(child: ChildProcess, phase: CrashPhase): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Marketplace crash child timed out waiting for ${phase}.\n${stderr}`));
    }, 10_000);
    timer.unref?.();

    const onMessage = (message: { type?: string; message?: string }) => {
      if (message?.type === "error") {
        cleanup();
        reject(new Error(`Marketplace crash child failed: ${message.message ?? "unknown error"}\n${stderr}`));
        return;
      }
      if (message?.type !== phase) return;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Marketplace crash child exited before ${phase} with code ${String(code)}.\n${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function forceTerminate(child: ChildProcess): Promise<void> {
  if (!children.delete(child) || child.exitCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32" && typeof child.pid === "number") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await once(killer, "exit");
  } else {
    child.kill("SIGKILL");
  }
  await exited;
}

async function expectReplayRejected(fixture: Fixture, expectedMessage: string): Promise<void> {
  await expect(installMarketplaceExtension({
    stateDir: fixture.stateDir,
    marketplace: "crash-market",
    source: { source: "directory", path: fixture.sourceDir },
    confirmationHash: fixture.confirmationHash,
  })).rejects.toThrow(expectedMessage);
}

async function expectUpdateReplayRejected(fixture: UpdateFixture, expectedMessage: string): Promise<void> {
  await expect(updateMarketplaceExtension({
    stateDir: fixture.stateDir,
    extensionId: fixture.extensionId,
    confirmationHash: fixture.confirmationHash,
  })).rejects.toThrow(expectedMessage);
}

async function expectUninstallReplayRejected(fixture: UninstallFixture, expectedMessage: string): Promise<void> {
  await expect(uninstallMarketplaceExtension({
    stateDir: fixture.stateDir,
    extensionId: fixture.extensionId,
    confirmationHash: fixture.confirmationHash,
  })).rejects.toThrow(expectedMessage);
}
