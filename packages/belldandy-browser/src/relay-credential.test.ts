import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getRelayCredentialPath,
  resolveRelayCredential,
} from "./relay-credential.js";

describe("relay credential", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("为同一 stateDir 生成并复用高熵 Relay 凭据", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-relay-credential-"));
    tempDirs.push(stateDir);

    const first = await resolveRelayCredential({ stateDir });
    const second = await resolveRelayCredential({ stateDir });

    expect(first.source).toBe("generated");
    expect(second).toEqual({ token: first.token, source: "state" });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    await expect(fs.readFile(getRelayCredentialPath(stateDir), "utf-8")).resolves.toContain(first.token);
  });

  it("优先使用显式配置的凭据而不覆盖本机状态", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-relay-credential-"));
    tempDirs.push(stateDir);
    const token = "a".repeat(43);

    await expect(resolveRelayCredential({ stateDir, configuredToken: token })).resolves.toEqual({
      token,
      source: "configured",
    });
    await expect(fs.stat(getRelayCredentialPath(stateDir))).rejects.toThrow();
  });

  it("对损坏或弱凭据 fail-closed", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-relay-credential-"));
    tempDirs.push(stateDir);
    await fs.writeFile(getRelayCredentialPath(stateDir), JSON.stringify({ version: 1, token: "weak" }), "utf-8");

    await expect(resolveRelayCredential({ stateDir })).rejects.toThrow(/invalid relay credential/i);
    await expect(resolveRelayCredential({ stateDir, configuredToken: "weak" })).rejects.toThrow(/invalid relay credential/i);
  });
});
