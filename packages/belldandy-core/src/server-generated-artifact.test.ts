import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startGatewayServer, type GatewayServer } from "./server.js";
import { cleanupGlobalMemoryManagersForTest, resolveWebRoot } from "./server-testkit.js";

const tempDirs: string[] = [];
const servers: GatewayServer[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

async function requestWithoutFetchCacheHeaders(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    request.once("error", reject);
  });
}

async function requestRawPath(port: number, requestPath: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    request.once("error", reject);
  });
}

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await cleanupGlobalMemoryManagersForTest();
  await Promise.allSettled(tempDirs.splice(0).map((tempDir) => (
    fs.rm(tempDir, { recursive: true, force: true })
  )));
});

describe("generated artifact HTTP admission", () => {
  it("does not serve an encoded parent traversal outside the generated root", async () => {
    const stateDir = await createTempDir("belldandy-generated-traversal-");
    const outsideContent = "encoded-parent-traversal-must-not-be-served";
    await fs.mkdir(path.join(stateDir, "generated"), { recursive: true });
    await fs.writeFile(path.join(stateDir, "outside.txt"), outsideContent, "utf-8");

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    servers.push(server);

    const response = await requestRawPath(
      server.port,
      "/generated/%2e%2e%2foutside.txt",
    );

    expect(response.status).toBe(404);
    expect(response.body).not.toContain(outsideContent);
  });

  it("does not serve a file through a directory link that escapes the generated root", async () => {
    const stateDir = await createTempDir("belldandy-generated-state-");
    const outsideDir = await createTempDir("belldandy-generated-outside-");
    const generatedDir = path.join(stateDir, "generated");
    const outsideFileName = "outside-secret.txt";
    const outsideContent = "generated-root-escape-must-not-be-served";

    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, outsideFileName), outsideContent, "utf-8");
    // Windows 使用 junction 避免管理员权限依赖；两种平台都验证目录链接后的 canonical target。
    await fs.symlink(
      outsideDir,
      path.join(generatedDir, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    servers.push(server);

    const response = await fetch(
      `http://127.0.0.1:${server.port}/generated/escape/${outsideFileName}`,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(outsideContent);
  });

  it("keeps GET and HEAD metadata behavior for a regular generated file", async () => {
    const stateDir = await createTempDir("belldandy-generated-regular-");
    const generatedDir = path.join(stateDir, "generated");
    const artifactContent = "regular-generated-artifact";
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(path.join(generatedDir, "artifact.txt"), artifactContent, "utf-8");

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    servers.push(server);
    const artifactUrl = `http://127.0.0.1:${server.port}/generated/artifact.txt`;

    const getResponse = await fetch(artifactUrl);
    const headResponse = await fetch(artifactUrl, { method: "HEAD" });

    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toBe(artifactContent);
    expect(getResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(getResponse.headers.get("content-length")).toBe(String(Buffer.byteLength(artifactContent)));
    expect(getResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(getResponse.headers.get("cache-control")).toBe("public, max-age=0");
    expect(getResponse.headers.get("etag")).toBeTruthy();
    expect(getResponse.headers.get("last-modified")).toBeTruthy();

    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");
    expect(headResponse.headers.get("content-type")).toBe(getResponse.headers.get("content-type"));
    expect(headResponse.headers.get("content-length")).toBe(getResponse.headers.get("content-length"));
    expect(headResponse.headers.get("etag")).toBe(getResponse.headers.get("etag"));
    expect(headResponse.headers.get("last-modified")).toBe(getResponse.headers.get("last-modified"));
  });

  it("does not redirect or serve an index for a generated directory", async () => {
    const stateDir = await createTempDir("belldandy-generated-directory-");
    const generatedDir = path.join(stateDir, "generated", "nested");
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(path.join(generatedDir, "index.html"), "directory-index", "utf-8");

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    servers.push(server);

    const response = await fetch(
      `http://127.0.0.1:${server.port}/generated/nested`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("directory-index");
  });

  it("keeps single byte range behavior for GET and HEAD", async () => {
    const stateDir = await createTempDir("belldandy-generated-range-");
    const generatedDir = path.join(stateDir, "generated");
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(path.join(generatedDir, "range.txt"), "abcdef", "utf-8");

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    servers.push(server);
    const artifactUrl = `http://127.0.0.1:${server.port}/generated/range.txt`;
    const headers = { Range: "bytes=2-4" };

    const getResponse = await fetch(artifactUrl, { headers });
    const headResponse = await fetch(artifactUrl, { method: "HEAD", headers });

    expect(getResponse.status).toBe(206);
    expect(await getResponse.text()).toBe("cde");
    expect(getResponse.headers.get("content-range")).toBe("bytes 2-4/6");
    expect(getResponse.headers.get("content-length")).toBe("3");
    expect(headResponse.status).toBe(206);
    expect(await headResponse.text()).toBe("");
    expect(headResponse.headers.get("content-range")).toBe("bytes 2-4/6");
    expect(headResponse.headers.get("content-length")).toBe("3");
  });

  it("keeps conditional cache responses for an unchanged generated file", async () => {
    const stateDir = await createTempDir("belldandy-generated-cache-");
    const generatedDir = path.join(stateDir, "generated");
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(path.join(generatedDir, "cache.txt"), "cacheable", "utf-8");

    const server = await startGatewayServer({
      port: 0,
      auth: { mode: "none" },
      webRoot: resolveWebRoot(),
      stateDir,
    });
    servers.push(server);
    const artifactUrl = `http://127.0.0.1:${server.port}/generated/cache.txt`;
    const initialResponse = await fetch(artifactUrl);
    const etag = initialResponse.headers.get("etag");
    const lastModified = initialResponse.headers.get("last-modified");
    expect(etag).toBeTruthy();
    expect(lastModified).toBeTruthy();
    await initialResponse.arrayBuffer();

    const etagResponse = await requestWithoutFetchCacheHeaders(artifactUrl, {
      "If-None-Match": String(etag),
    });
    const modifiedResponse = await requestWithoutFetchCacheHeaders(artifactUrl, {
      "If-Modified-Since": String(lastModified),
    });

    expect(etagResponse.status).toBe(304);
    expect(etagResponse.body).toBe("");
    expect(modifiedResponse.status).toBe(304);
    expect(modifiedResponse.body).toBe("");
  });
});
