import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  getForegroundPidFile,
  preflightGatewayCleanup,
  resolveGatewayPortFromEnv,
  type GatewayPreflightRunner,
} from "./gateway-preflight.js";
import { guardedRemovePath } from "./sandbox-paths.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    guardedRemovePath(dir, [dir], "cleanup gateway preflight temp dir");
  }
});

function createTempStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-gateway-preflight-"));
  tempDirs.push(dir);
  return dir;
}

test("preflight kills owned gateway PID from foreground marker and clears the marker file", async () => {
  const stateDir = createTempStateDir();
  const ownedPid = 43210;
  const gatewayEntryPath = path.join(
    process.cwd(),
    "packages",
    "belldandy-core",
    "src",
    "bin",
    "gateway.ts",
  );
  const alive = new Set([ownedPid]);
  fs.writeFileSync(getForegroundPidFile(stateDir), `${ownedPid}\n`, "utf-8");

  const runner: GatewayPreflightRunner = {
    async inspectProcess(pid) {
      return {
        pid,
        commandLine: `node --import tsx ${gatewayEntryPath}`,
      };
    },
    async findPortOwner() {
      return null;
    },
    async forceKill(pid) {
      alive.delete(pid);
    },
    isProcessRunning(pid) {
      return alive.has(pid);
    },
  };

  const result = await preflightGatewayCleanup({
    label: "Test",
    stateDir,
    ownershipTokens: [gatewayEntryPath],
    runner,
  });

  expect(result.cleanedPids).toEqual([ownedPid]);
  expect(fs.existsSync(getForegroundPidFile(stateDir))).toBe(false);
});

test("preflight reads BELLDANDY_PORT from env files and blocks unknown external listeners", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const stateDir = createTempStateDir();
  const listener = net.createServer();
  const occupiedPort = await listenOnEphemeralPort(listener);
  let seenPort: number | null = null;
  fs.writeFileSync(path.join(stateDir, ".env.local"), `BELLDANDY_PORT=${occupiedPort}\n`, "utf-8");

  const runner: GatewayPreflightRunner = {
    async inspectProcess(pid) {
      return {
        pid,
        commandLine: "C:\\tools\\other-app.exe --serve 38889",
      };
    },
    async findPortOwner(port) {
      seenPort = port;
      return {
        pid: 9988,
        commandLine: "C:\\tools\\other-app.exe --serve 38889",
      };
    },
    async forceKill() {
      throw new Error("should not kill unknown process");
    },
    isProcessRunning() {
      return true;
    },
  };

  try {
    await expect(preflightGatewayCleanup({
      label: "Test",
      stateDir,
      ownershipTokens: ["E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway.ts"],
      runner,
    })).rejects.toThrow(`Port ${occupiedPort} is already in use by PID 9988`);
  } finally {
    await closeServer(listener);
  }

  expect(seenPort).toBe(occupiedPort);
});

test("preflight skips the owner runner only when the dual-stack probe proves a marker-free port is available", async () => {
  const stateDir = createTempStateDir();
  const port = await reserveFreePort();
  const findPortOwner = vi.fn(async () => null);
  const runner: GatewayPreflightRunner = {
    async inspectProcess() {
      throw new Error("marker-free preflight must not inspect a process");
    },
    findPortOwner,
    async forceKill() {
      throw new Error("marker-free preflight must not kill a process");
    },
  };

  await expect(preflightGatewayCleanup({
    label: "Test",
    stateDir,
    port,
    ownershipTokens: ["marker-free-test"],
    runner,
  })).resolves.toEqual({ port, cleanedPids: [] });

  expect(findPortOwner).not.toHaveBeenCalled();
});

test("resolves a gateway port from an already loaded environment", () => {
  expect(resolveGatewayPortFromEnv({ BELLDANDY_PORT: "38889" })).toBe(38889);
  expect(resolveGatewayPortFromEnv({ BELLDANDY_PORT: "not-a-port" })).toBe(28889);
});

async function reserveFreePort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve test port."));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function listenOnEphemeralPort(server: net.Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve test port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
