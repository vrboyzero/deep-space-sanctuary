import fs from "node:fs/promises";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createAvatarStaticHttpHandler } from "./avatar-static-http.js";
import { startGatewayServer, type GatewayServer } from "./server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot } from "./server-testkit.js";

const tempDirs: string[] = [];
const gatewayServers: GatewayServer[] = [];
const handlerServers: Server[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

async function startAvatarHandler(options: Parameters<typeof createAvatarStaticHttpHandler>[0]): Promise<number> {
  const app = express();
  app.use("/avatar", createAvatarStaticHttpHandler(options));
  app.use((_req, res) => res.status(404).end());

  const server = http.createServer(app);
  handlerServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Avatar handler did not bind a TCP port.");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(async () => {
  await Promise.allSettled(gatewayServers.splice(0).map((server) => server.close()));
  await Promise.allSettled(handlerServers.splice(0).map((server) => closeServer(server)));
  await cleanupGlobalMemoryManagersForTest();
  await Promise.allSettled(tempDirs.splice(0).map((tempDir) => (
    fs.rm(tempDir, { recursive: true, force: true })
  )));
});

describe("avatar static HTTP admission", () => {
  it("keeps GET and HEAD behavior for a regular avatar file", async () => {
    const avatarDir = await createTempDir("belldandy-avatar-regular-");
    const avatarContent = "regular-avatar-content";
    await fs.writeFile(path.join(avatarDir, "avatar.txt"), avatarContent, "utf-8");

    const port = await startAvatarHandler({ avatarDir });
    const avatarUrl = `http://127.0.0.1:${port}/avatar/avatar.txt`;
    const getResponse = await fetch(avatarUrl);
    const headResponse = await fetch(avatarUrl, { method: "HEAD" });

    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toBe(avatarContent);
    expect(getResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(getResponse.headers.get("content-length")).toBe(String(Buffer.byteLength(avatarContent)));
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");
    expect(headResponse.headers.get("content-length")).toBe(getResponse.headers.get("content-length"));
  });

  it("does not serve a file through a directory link that escapes the avatar root", async () => {
    const avatarDir = await createTempDir("belldandy-avatar-root-");
    const outsideDir = await createTempDir("belldandy-avatar-outside-");
    const outsideContent = "avatar-root-escape-must-not-be-served";
    await fs.writeFile(path.join(outsideDir, "outside.txt"), outsideContent, "utf-8");
    await fs.symlink(
      outsideDir,
      path.join(avatarDir, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const port = await startAvatarHandler({ avatarDir });
    const response = await fetch(`http://127.0.0.1:${port}/avatar/escape/outside.txt`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(outsideContent);
  });

  it("does not serve a file when its parent is replaced during admission", async () => {
    const avatarDir = await createTempDir("belldandy-avatar-replacement-");
    const outsideDir = await createTempDir("belldandy-avatar-replacement-outside-");
    const nestedDir = path.join(avatarDir, "nested");
    const avatarPath = path.join(nestedDir, "avatar.txt");
    const insideContent = "opened-avatar-must-not-be-sent-after-replacement";
    const outsideContent = "replacement-outside-content-must-not-be-served";
    await fs.mkdir(nestedDir);
    await fs.writeFile(avatarPath, insideContent, "utf-8");
    await fs.writeFile(path.join(outsideDir, "avatar.txt"), outsideContent, "utf-8");

    const port = await startAvatarHandler({
      avatarDir,
      testHooks: {
        beforeRevalidate: async () => {
          await fs.rename(nestedDir, path.join(avatarDir, "nested-before-revalidation"));
          await fs.symlink(
            outsideDir,
            nestedDir,
            process.platform === "win32" ? "junction" : "dir",
          );
        },
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}/avatar/nested/avatar.txt`);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(insideContent);
    expect(body).not.toContain(outsideContent);
  });

  it("keeps the Gateway avatar route compatible while rejecting a linked escape", async () => {
    const stateDir = await createTempDir("belldandy-avatar-gateway-");
    const avatarDir = path.join(stateDir, "avatar");
    const outsideDir = await createTempDir("belldandy-avatar-gateway-outside-");
    const avatarContent = "gateway-avatar-content";
    const outsideContent = "gateway-avatar-root-escape-must-not-be-served";
    await fs.mkdir(avatarDir, { recursive: true });
    await fs.writeFile(path.join(avatarDir, "avatar.txt"), avatarContent, "utf-8");
    await fs.writeFile(path.join(outsideDir, "outside.txt"), outsideContent, "utf-8");
    await fs.symlink(
      outsideDir,
      path.join(avatarDir, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    gatewayServers.push(server);

    const avatarUrl = `http://127.0.0.1:${server.port}/avatar/avatar.txt`;
    const getResponse = await fetch(avatarUrl);
    const headResponse = await fetch(avatarUrl, { method: "HEAD" });
    const escapeResponse = await fetch(`http://127.0.0.1:${server.port}/avatar/escape/outside.txt`);

    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toBe(avatarContent);
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");
    expect(escapeResponse.status).toBe(404);
    expect(await escapeResponse.text()).not.toContain(outsideContent);
  });
});
