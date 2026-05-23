import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  getForegroundPidFile,
  preflightGatewayCleanup,
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
  const alive = new Set([ownedPid]);
  fs.writeFileSync(getForegroundPidFile(stateDir), `${ownedPid}\n`, "utf-8");

  const runner: GatewayPreflightRunner = {
    async inspectProcess(pid) {
      return {
        pid,
        commandLine: `node --import tsx E:\\project\\star-sanctuary\\packages\\belldandy-core\\src\\bin\\gateway.ts`,
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
    ownershipTokens: ["E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway.ts"],
    runner,
  });

  expect(result.cleanedPids).toEqual([ownedPid]);
  expect(fs.existsSync(getForegroundPidFile(stateDir))).toBe(false);
});

test("preflight reads BELLDANDY_PORT from env files and blocks unknown external listeners", async () => {
  const stateDir = createTempStateDir();
  let seenPort: number | null = null;
  fs.writeFileSync(path.join(stateDir, ".env.local"), "BELLDANDY_PORT=38889\n", "utf-8");

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

  await expect(preflightGatewayCleanup({
    label: "Test",
    stateDir,
    ownershipTokens: ["E:/project/star-sanctuary/packages/belldandy-core/src/bin/gateway.ts"],
    runner,
  })).rejects.toThrow("Port 38889 is already in use by PID 9988");

  expect(seenPort).toBe(38889);
});
