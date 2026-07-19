import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { createGatewayLaunchConfig } from "./gateway-launch-config.js";

const tempDirs = new Set<string>();

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "star-gateway-launch-config-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("creates one launch config from the current env files and resolves its port", async () => {
  const stateDir = await createTempDir();
  await fs.writeFile(path.join(stateDir, ".env"), "BELLDANDY_PORT=28889\n", "utf-8");
  await fs.writeFile(path.join(stateDir, ".env.local"), "BELLDANDY_PORT=38889\n", "utf-8");
  const readFileSyncSpy = vi.spyOn(fsSync, "readFileSync");

  try {
    const config = createGatewayLaunchConfig({}, stateDir);
    const envReadPaths = readFileSyncSpy.mock.calls
      .map(([filePath]) => String(filePath))
      .filter((filePath) => filePath.endsWith(".env") || filePath.endsWith(".env.local"));

    expect(config.port).toBe(38889);
    expect(config.env.BELLDANDY_PORT).toBe("38889");
    expect(envReadPaths).toEqual([
      path.join(stateDir, ".env"),
      path.join(stateDir, ".env.local"),
    ]);
  } finally {
    readFileSyncSpy.mockRestore();
  }
});
