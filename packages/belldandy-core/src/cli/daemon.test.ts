import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { reloadLauncherEnv } from "./daemon.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("reloadLauncherEnv reloads the latest env.local values for restart launches", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-daemon-env-"));
  tempDirs.push(stateDir);

  await fs.writeFile(path.join(stateDir, ".env"), 'BELLDANDY_OPENAI_MODEL="from-env"\n', "utf-8");
  await fs.writeFile(path.join(stateDir, ".env.local"), 'BELLDANDY_OPENAI_MODEL="from-local-v1"\n', "utf-8");

  const baseEnv = {
    PATH: process.env.PATH ?? "",
  } as NodeJS.ProcessEnv;

  const firstEnv = reloadLauncherEnv(baseEnv, stateDir);
  expect(firstEnv.BELLDANDY_OPENAI_MODEL).toBe("from-local-v1");

  await fs.writeFile(path.join(stateDir, ".env.local"), 'BELLDANDY_OPENAI_MODEL="from-local-v2"\n', "utf-8");

  const secondEnv = reloadLauncherEnv(baseEnv, stateDir);
  expect(secondEnv.BELLDANDY_OPENAI_MODEL).toBe("from-local-v2");
});
