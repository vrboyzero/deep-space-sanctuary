import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";
import WebSocket from "ws";

import { startGatewayServer } from "./server.js";
import { resolveWebRoot } from "./server-testkit.js";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("server.close force closes an active WebSocket without waiting indefinitely", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-close-websocket-"));
  const server = await startGatewayServer({
    port: 0,
    auth: { mode: "none" },
    webRoot: resolveWebRoot(),
    stateDir,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: "http://127.0.0.1" });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const socketClosed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  let closePromise: Promise<void> | undefined;

  try {
    await opened;
    closePromise = server.close();

    await expect(Promise.race([
      closePromise.then(() => "closed"),
      wait(2_000).then(() => "timeout"),
    ])).resolves.toBe("closed");
    await expect(Promise.race([
      socketClosed.then(() => "closed"),
      wait(2_000).then(() => "timeout"),
    ])).resolves.toBe("closed");
  } finally {
    ws.terminate();
    await closePromise;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
